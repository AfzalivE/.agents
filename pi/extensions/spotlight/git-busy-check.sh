#!/bin/bash
# Checks if a git repository has an operation in progress that would prevent committing.
# Matches detection logic from Git's contrib/completion/git-prompt.sh
#
# Usage: git-busy-check.sh <workspace-path>
# Output: "clean" | "busy:rebase" | "busy:merge" | "busy:cherry-pick" | "busy:revert"
# Exit codes: 0 = success, 2 = invalid path or not a git repo

cd "$1" || { echo "error: bad path"; exit 2; }

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  echo "error: not a git repo"
  exit 2
}

# Check for rebase (directory-based, matching git-prompt.sh)
# Directories are more reliable than REBASE_HEAD which is only created when paused
if [ -d "$(git rev-parse --git-path rebase-merge)" ] || \
   [ -d "$(git rev-parse --git-path rebase-apply)" ]; then
  echo "busy:rebase"
  exit 0
fi

# Check for merge (file-based)
if [ -e "$(git rev-parse --git-path MERGE_HEAD)" ]; then
  echo "busy:merge"
  exit 0
fi

# Check for cherry-pick (file-based)
if [ -e "$(git rev-parse --git-path CHERRY_PICK_HEAD)" ]; then
  echo "busy:cherry-pick"
  exit 0
fi

# Check for revert (file-based)
if [ -e "$(git rev-parse --git-path REVERT_HEAD)" ]; then
  echo "busy:revert"
  exit 0
fi

echo "clean"
