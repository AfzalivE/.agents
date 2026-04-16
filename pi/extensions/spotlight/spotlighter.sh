#!/usr/bin/env bash
# @referToSpec checkpointer
# watch-checkpointer.sh
# Watches the current directory and on changes:
# 1) runs checkpointer.sh save
# 2) captures the single-word id
# 3) cd's to $SPOTLIGHT_ROOT_PATH
# 4) runs checkpointer.sh restore <id>

set -euo pipefail

# Set up logging to /tmp file
SPOTLIGHT_LOG_FILE="/tmp/spotlight-$$.log"
echo "Spotlight logging to: $SPOTLIGHT_LOG_FILE"

# Redirect all output to both stdout and log file
exec > >(tee -a "$SPOTLIGHT_LOG_FILE") 2>&1

# Ensure prerequisites
: "${SPOTLIGHT_CHECKPOINTER_PATH:?Environment variable SPOTLIGHT_CHECKPOINTER_PATH must be set}"
CHECKPOINTER="$SPOTLIGHT_CHECKPOINTER_PATH"
if [[ ! -x "$CHECKPOINTER" ]]; then
  echo "Error: checkpointer not found or not executable at: $CHECKPOINTER" >&2
  exit 1
fi

# Use watchexec from SPOTLIGHT_WATCHEXEC_PATH
: "${SPOTLIGHT_WATCHEXEC_PATH:?Environment variable SPOTLIGHT_WATCHEXEC_PATH must be set}"
WATCHEXEC="$SPOTLIGHT_WATCHEXEC_PATH"
if [[ ! -x "$WATCHEXEC" ]]; then
  echo "Error: watchexec not found or not executable at: $WATCHEXEC" >&2
  exit 1
fi

: "${SPOTLIGHT_ROOT_PATH:?Environment variable SPOTLIGHT_ROOT_PATH must be set}"
if [[ ! -d "$SPOTLIGHT_ROOT_PATH" ]]; then
  echo "Error: SPOTLIGHT_ROOT_PATH does not exist or is not a directory: $SPOTLIGHT_ROOT_PATH" >&2
  exit 1
fi

checkpoint_suffix="${EPOCHSECONDS:-$(date +%s)}-$$"
CHECKPOINT_ID="cp-spotlight-${checkpoint_suffix}"

export CHECKPOINTER SPOTLIGHT_ROOT_PATH CHECKPOINT_ID

# Notes:
# - watchexec ensures only one run at a time; if N new changes occur, the latest will be queued until the current run completes.
# - --shell=none prevents watchexec from wrapping our command in another shell, so the
#   multi-line script below is passed as a single argument to "bash -c" without
#   getting truncated at the first newline.
# - We explicitly use bash (not $SHELL) because runner_script uses bash syntax.
runner_script=$(cat <<'EOS'
set -euo pipefail

echo -e "\nStarting sync..."

# Log which files triggered this sync (set by watchexec via --emit-events-to=environment)
# Note: paths are relative to WATCHEXEC_COMMON_PATH (if set), and multiple paths are colon-separated
if [[ -n "${WATCHEXEC_COMMON_PATH:-}" ]]; then
  echo "Common path: $WATCHEXEC_COMMON_PATH"
fi
if [[ -n "${WATCHEXEC_WRITTEN_PATH:-}" ]]; then
  echo "Triggered by file write: $WATCHEXEC_WRITTEN_PATH"
fi
if [[ -n "${WATCHEXEC_CREATED_PATH:-}" ]]; then
  echo "Triggered by file create: $WATCHEXEC_CREATED_PATH"
fi
if [[ -n "${WATCHEXEC_REMOVED_PATH:-}" ]]; then
  echo "Triggered by file remove: $WATCHEXEC_REMOVED_PATH"
fi
if [[ -n "${WATCHEXEC_RENAMED_PATH:-}" ]]; then
  echo "Triggered by file rename: $WATCHEXEC_RENAMED_PATH"
fi
if [[ -n "${WATCHEXEC_META_CHANGED_PATH:-}" ]]; then
  echo "Triggered by metadata change: $WATCHEXEC_META_CHANGED_PATH"
fi
if [[ -n "${WATCHEXEC_OTHERWISE_CHANGED_PATH:-}" ]]; then
  echo "Triggered by other change: $WATCHEXEC_OTHERWISE_CHANGED_PATH"
fi

# Save checkpoint - checkpointer exits 101 if merge/rebase in progress
# Suppress stdout (the checkpoint id), but keep stderr so errors show up in our log file.
"$CHECKPOINTER" save --id "$CHECKPOINT_ID" --force >/dev/null || {
  exit_code=$?
  if [[ $exit_code -eq 101 ]]; then
    echo "Skipping sync: merge/rebase in progress"
  else
    echo "Skipping sync: checkpoint save failed"
  fi
  exit 0
}
echo "Saved checkpoint: ${CHECKPOINT_ID}"

# Attempt restore - if it fails, warn but don't crash
if ! (cd "$SPOTLIGHT_ROOT_PATH" && "$CHECKPOINTER" restore "$CHECKPOINT_ID" 2>&1); then
  echo "Warning: checkpoint restore failed in ${SPOTLIGHT_ROOT_PATH}"
  exit 0
fi
echo "Restored checkpoint ${CHECKPOINT_ID} in ${SPOTLIGHT_ROOT_PATH}"
EOS
)

exec "$WATCHEXEC" \
  --quiet \
  --color=never \
  --shell=none \
  --watch . \
  --project-origin . \
  --emit-events-to=environment \
  --ignore '*.tmp.*' \
  --ignore '.context/**' \
  -- bash -c "$runner_script"
