#!/usr/bin/env bash
# @referToSpec checkpointer
set -euo pipefail

# checkpointer: save/restore/diff repo checkpoints using private refs
# - Non-disruptive capture (no HEAD move, no file changes)
# - Full reversion (HEAD + index + working tree, including untracked)
# - Full diffs between checkpoints or vs current
#
# Exit codes:
#   0   - Success
#   1   - Error (general failure)
#   101 - Skipped: merge/rebase in progress (not an error, just can't checkpoint)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GIT_BUSY_CHECK="$SCRIPT_DIR/git-busy-check.sh"

die() { echo "checkpointer: $*" >&2; exit 1; }
timestamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
zeros="0000000000000000000000000000000000000000"

ensure_repo() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not inside a git working tree"
}

repo_root() {
  git rev-parse --show-toplevel
}

# Extract metadata fields from a checkpoint commit object
# usage: get_meta <commit_oid> <key>
get_meta() {
  local commit_oid="$1" key="$2"
  git cat-file commit "$commit_oid" | sed -n "s/^$key //p" | head -n1
}

save() {
  ensure_repo
  local root; root="$(repo_root)"

  # Check for in-progress git operations that would prevent committing
  if [[ "$("$GIT_BUSY_CHECK" "$root")" != "clean" ]]; then
    exit 101
  fi
  local id="" force="false"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -i|--id) id="${2:-}"; shift 2 ;;
      -f|--force) force="true"; shift ;;
      -h|--help) echo "Usage: checkpointer save [--id <id>] [--force]"; return 0 ;;
      *) die "unknown argument to save: $1" ;;
    esac
  done

  if [[ -z "${id}" ]]; then
    id="cp-$(date -u +%Y%m%dT%H%M%SZ)"
  fi
  local ref="refs/conductor-checkpoints/$id"

  if git rev-parse -q --verify "$ref" >/dev/null 2>&1; then
    if [[ "$force" != "true" ]]; then
      die "checkpoint '$id' already exists (use --force to overwrite)"
    fi
  fi

  # HEAD OID (handle unborn HEAD)
  local head_oid
  if ! head_oid="$(git rev-parse -q --verify HEAD 2>/dev/null)"; then
    head_oid="$zeros"
  fi

  # Index tree (staged state). Fails if index has unresolved merges.
  local index_tree
  if ! index_tree="$(git -C "$root" write-tree 2>/dev/null)"; then
    die "cannot save: index has unresolved merges (resolve or stash conflicts first)"
  fi

  # Full working tree snapshot (tracked + untracked, honoring .gitignore) via a temp index.
  # Note: we seed the temp index with the current index tree so tracked files are preserved even
  # if they match .gitignore (gitignore only applies to untracked paths).
  # Important: GIT_INDEX_FILE must point at a path that does NOT exist yet.
  # Using mktemp to create a file leads to "index file smaller than expected".
  local tmp_dir tmp_index
  tmp_dir="$(mktemp -d -t chkpt-index.XXXXXX)"
  trap 'rm -rf "$tmp_dir"' EXIT
  tmp_index="$tmp_dir/index"
  GIT_INDEX_FILE="$tmp_index" git -C "$root" read-tree "$index_tree"
  GIT_INDEX_FILE="$tmp_index" git -C "$root" add -A -- .
  local worktree_tree
  worktree_tree="$(GIT_INDEX_FILE="$tmp_index" git -C "$root" write-tree)"
  rm -rf "$tmp_dir"; trap - EXIT

  # Create the checkpoint commit with the worktree tree; encode metadata in message.
  local now; now="$(timestamp)"
  local msg
  msg=$(cat <<EOF
checkpoint:$id
head $head_oid
index-tree $index_tree
worktree-tree $worktree_tree
created $now
EOF
)

  # Use neutral identity to avoid depending on user config
  local checkpoint_commit
  checkpoint_commit="$(
    GIT_AUTHOR_NAME="Checkpointer" \
    GIT_AUTHOR_EMAIL="checkpointer@noreply" \
    GIT_AUTHOR_DATE="$now" \
    GIT_COMMITTER_NAME="Checkpointer" \
    GIT_COMMITTER_EMAIL="checkpointer@noreply" \
    GIT_COMMITTER_DATE="$now" \
    git -C "$root" commit-tree "$worktree_tree" <<<"$msg"
  )"

  # Update private ref (no HEAD movement, no working tree changes)
  git -C "$root" update-ref "$ref" "$checkpoint_commit"

  echo "$id"
}

restore() {
  ensure_repo
  local root; root="$(repo_root)"
  local id="${1:-}"
  [[ -z "$id" ]] && die "Usage: checkpointer restore <id>"
  local ref="refs/conductor-checkpoints/$id"

  local commit_oid
  commit_oid="$(git -C "$root" rev-parse -q --verify "$ref" 2>/dev/null || true)"
  [[ -z "$commit_oid" ]] && die "checkpoint not found: $id"

  local head_oid index_tree worktree_tree
  head_oid="$(get_meta "$commit_oid" "head")"
  index_tree="$(get_meta "$commit_oid" "index-tree")"
  worktree_tree="$(get_meta "$commit_oid" "worktree-tree")"

  [[ -z "$worktree_tree" || -z "$index_tree" || -z "$head_oid" ]] && \
    die "checkpoint is missing metadata (id: $id)"

  # 1) Restore HEAD state
  if [[ "$head_oid" == "$zeros" ]]; then
    die "cannot restore: checkpoint saved with unborn HEAD (no commits)"
  fi
  git -C "$root" reset --hard "$head_oid"

  # 2) Make working tree and index match the saved worktree snapshot
  git -C "$root" read-tree --reset -u "$worktree_tree"
  # Remove any extra untracked files/dirs not present in the snapshot (keep ignored files)
  git -C "$root" clean -fd

  # 3) Restore the index (staged state) to its saved snapshot without touching files
  git -C "$root" read-tree --reset "$index_tree"

  echo "restored checkpoint: $id"
}

diff_cmd() {
  ensure_repo
  local root; root="$(repo_root)"
  if [[ $# -lt 2 ]]; then
    echo "Usage: checkpointer diff <id1> <id2|current> [-- <extra git diff args>]" >&2
    exit 1
  fi

  local a="$1" b="$2"; shift 2
  local a_obj b_obj

  # Resolve left side
  if git -C "$root" rev-parse -q --verify "refs/conductor-checkpoints/$a" >/dev/null 2>&1; then
    a_obj="refs/conductor-checkpoints/$a"
  else
    die "unknown checkpoint: $a"
  fi

  # Resolve right side
  if [[ "$b" == "current" ]]; then
    # Build a transient tree of the current full working tree
    # Seed the temp index from HEAD so tracked files are preserved even if they
    # match .gitignore (gitignore only applies to untracked paths).
    local tmp_dir tmp_index
    tmp_dir="$(mktemp -d -t chkpt-cur.XXXXXX)"
    trap 'rm -rf "$tmp_dir"' EXIT
    tmp_index="$tmp_dir/index"
    local head_oid
    if head_oid="$(git -C "$root" rev-parse -q --verify HEAD 2>/dev/null)"; then
      GIT_INDEX_FILE="$tmp_index" git -C "$root" read-tree "$head_oid"
    fi
    GIT_INDEX_FILE="$tmp_index" git -C "$root" add -A -- .
    b_obj="$(GIT_INDEX_FILE="$tmp_index" git -C "$root" write-tree)"
    rm -rf "$tmp_dir"; trap - EXIT
  else
    if git -C "$root" rev-parse -q --verify "refs/conductor-checkpoints/$b" >/dev/null 2>&1; then
      b_obj="refs/conductor-checkpoints/$b"
    else
      die "unknown checkpoint or 'current' expected: $b"
    fi
  fi

  # Allow passing additional git diff flags after an optional '--'.
  # We intentionally do not inject our own '--' since callers may only
  # be providing flags (e.g., --name-status). If the caller wants to pass
  # a pathspec, they can include their own '-- <paths>'.
  if [[ $# -gt 0 && "$1" == "--" ]]; then shift; fi

  # Full diff of user-visible files between the two snapshots
  git -C "$root" -c core.quotePath=false diff "$a_obj" "$b_obj" "$@"
}

usage() {
  cat <<EOF
checkpointer: save/restore/diff Git checkpoints using private refs

Usage:
  checkpointer save [--id <id>] [--force]
  checkpointer restore <id>
  checkpointer diff <id1> <id2|current> [-- <extra git diff args>]

Examples:
  checkpointer save
  checkpointer save --id session-1
  checkpointer restore session-1
  checkpointer diff session-1 session-2 -- --stat
  checkpointer diff session-1 current

Notes:
- save never touches files on disk or HEAD; it writes Git objects and refs/conductor-checkpoints/<id>.
- restore will move HEAD (like 'git reset --hard <saved HEAD>') and then restore files and index.
- restore from checkpoints saved with unborn HEAD (no commits) is unsupported and will fail.
- diff compares the full working-tree snapshots (including untracked, honoring .gitignore).
EOF
}

main() {
  local cmd="${1:-}"; shift || true
  case "$cmd" in
    save) save "$@" ;;
    restore) restore "$@" ;;
    diff) diff_cmd "$@" ;;
    ""|-h|--help|help) usage ;;
    *) die "unknown command: $cmd (use --help)" ;;
  esac
}

main "$@"
