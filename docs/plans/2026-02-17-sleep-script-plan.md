# Sleep Script Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a nightly vault maintenance skill and bash wrapper that autonomously consolidates, reorganizes, and weakens stale content in the agent-brain vault, sandboxed with `srt`.

**Architecture:** A `skills/sleep/SKILL.md` defines the LLM's maintenance instructions. A `bin/sleep` bash wrapper runs a cheap pre-audit on the host (git log, file sizes, MOC link status), then invokes `srt claude -p` with OS-level sandboxing (writes restricted to `~/.agents`, network restricted to `*.anthropic.com`). Claude plans and applies changes autonomously, commits via git-commit skill. Three defense layers: `srt` (OS), `--allowedTools` (Claude Code), `--max-budget-usd` (cost).

**Tech Stack:** Bash, srt (`@anthropic-ai/sandbox-runtime`), Claude CLI (`claude -p`), Obsidian-flavored Markdown

---

### Task 1: Create the sleep config file

**Files:**
- Create: `agent-brain/.sleep-config.md`

**Step 1: Write the config file**

```markdown
---
tags: [system]
---

# Sleep Config

Settings for the nightly vault maintenance script. The sleep script may tune these values over time.

## Thresholds

- **weaken_days**: 60 — Days since last git modification before a strong file is weakened (unlinked from MOC)
- **archive_days**: 90 — Days since last git modification before a weak file is archived (moved to archive/)

## Protected files

Files that should never be weakened or archived:

- Index.md
- .sleep-config.md
```

**Step 2: Commit**

```
git add agent-brain/.sleep-config.md
git commit  # use git-commit skill
```

---

### Task 2: Create the sleep skill

**Files:**
- Create: `skills/sleep/SKILL.md`

**Step 1: Write the skill file**

The skill file instructs Claude on how to perform vault maintenance. It assumes the bash wrapper has already run the pre-audit and appended it to the system prompt.

```markdown
---
name: sleep
description: Nightly vault maintenance — consolidate, reorganize, and weaken stale content in agent-brain.
---

# Sleep — Vault Maintenance

You are running autonomous nightly maintenance on the agent-brain vault at `~/.agents/agent-brain/`.

The bash wrapper has already run a pre-audit and appended it to your system prompt as `SLEEP_AUDIT`. Use it to decide which files need attention.

## Operations (in priority order)

### 1. Consolidation
- Read files flagged as RECENTLY CHANGED in the audit
- If multiple files contain overlapping content on the same topic, merge into the canonical location
- Remove duplication after merging

### 2. Reorganization
- Read files flagged as LARGE in the audit
- If a file exceeds ~5KB or covers multiple distinct topics, split it into separate notes
- If a MOC page has grown too large, split into sub-categories (e.g., "Troubleshooting - Python")
- Update Index.md and cross-references after any split

### 3. Weakening (three-tier memory)

Files move through three states based on staleness:

| State | Location | MOC linked |
|-------|----------|------------|
| **Strong** | `agent-brain/` | Yes |
| **Weak** | `agent-brain/` | No |
| **Dormant** | `agent-brain/archive/` | No |

Use the thresholds from `agent-brain/.sleep-config.md`:
- **Strong → Weak**: File untouched for `weaken_days`+ days AND still linked in MOC. Action: remove its `[[wikilink]]` from the relevant MOC page.
- **Weak → Dormant**: File untouched for `archive_days`+ days AND already unlinked. Action: `mv` the file to `agent-brain/archive/`.

Never weaken or archive files listed in `.sleep-config.md` under "Protected files".

### 4. Deletion
- Only delete entries that are **factually wrong or superseded** (e.g., a tool path that changed, a version that's wrong)
- High confidence required — when in doubt, skip
- Never delete content that's merely old

## Rules

- Never populate stub files (files with only a template/header and no real content)
- When in doubt: skip rather than weaken, weaken rather than archive, archive rather than delete
- Always keep Index.md as the central hub linking to all strong files
- Commit changes using the git-commit skill when done
- If the audit shows nothing needs attention, do nothing and exit

## Commit guidelines

- One commit for all sleep maintenance changes
- Subject: "Sleep: <brief summary of what changed>"
- Body: list each action taken (consolidated X, weakened Y, archived Z)
```

**Step 2: Commit**

```
git add skills/sleep/SKILL.md
git commit  # use git-commit skill
```

---

### Task 3: Create the srt sandbox config

**Files:**
- Create: `config/sleep-srt.json`

**Step 1: Write the srt settings file**

Restricts the sandboxed Claude process to only write within `~/.agents` and only reach `*.anthropic.com` on the network. All other writes and network access are denied at the OS level.

```json
{
  "network": {
    "allowedDomains": ["*.anthropic.com"]
  },
  "filesystem": {
    "allowWrite": ["~/.agents"]
  }
}
```

**Step 2: Commit**

```
git add config/sleep-srt.json
git commit  # use git-commit skill
```

---

### Task 4: Create the bash wrapper

**Files:**
- Create: `bin/sleep`

**Step 1: Write the bash wrapper**

The script does the cheap pre-audit on the host (no LLM), then invokes `srt claude -p` with OS-level sandboxing via `config/sleep-srt.json`.

Key details:
- `VAULT_DIR="${HOME}/.agents/agent-brain"`
- `ARCHIVE_DIR="${VAULT_DIR}/archive"`
- Parse `.sleep-config.md` for thresholds (grep for `weaken_days` and `archive_days` values)
- For each `.md` file in the vault (excluding `archive/` and `.sleep-config.md`):
  - Get last modified date via `git -C "$VAULT_DIR" log -1 --format="%at" -- "$file"` (unix timestamp)
  - Get file size via `wc -c`
  - Check if linked from any MOC page via `grep -l` for `[[filename]]` pattern in Index.md and other MOC files
  - Calculate days since last modification
- Classify files into categories:
  - `WEAKEN`: linked in MOC, untouched for `weaken_days`+ days, not protected
  - `ARCHIVE`: not linked in MOC, untouched for `archive_days`+ days, not protected
  - `LARGE`: >5KB
  - `RECENTLY_CHANGED`: modified in the last 7 days (candidates for consolidation)
- Format the audit as a structured summary
- If `--dry-run`: print summary and exit (no LLM)
- If nothing needs attention: print summary and exit (no LLM)
- Otherwise: invoke `srt --settings config/sleep-srt.json claude -p` with:
  - `--append-system-prompt "SLEEP_AUDIT:\n$audit_summary"`
  - `--dangerously-skip-permissions` (safe — srt is the real sandbox)
  - `--allowedTools "Read,Edit,Write,Glob,Grep,Skill,Bash(git:*,mv:*,mkdir:*)"` (defense in depth)
  - `--model sonnet` (cheaper for routine maintenance)
  - `--max-budget-usd 0.50` (cost cap)
  - Prompt: `"Run the /sleep skill to perform vault maintenance based on the SLEEP_AUDIT in your system prompt. Work autonomously — plan changes, apply them, and commit."`
  - Working directory: `$HOME/.agents`
- srt sandbox (OS-level):
  - Writes allowed only to `~/.agents`
  - Network allowed only to `*.anthropic.com`
  - Mandatory deny paths auto-protect `.claude/commands/`, `.claude/agents/`, `.git/hooks/`, `.git/config`

```bash
#!/usr/bin/env bash
set -euo pipefail

VAULT_DIR="${HOME}/.agents/agent-brain"
ARCHIVE_DIR="${VAULT_DIR}/archive"
CONFIG_FILE="${VAULT_DIR}/.sleep-config.md"
AGENTS_DIR="${HOME}/.agents"
SRT_SETTINGS="${AGENTS_DIR}/config/sleep-srt.json"

DRY_RUN=0

usage() {
  cat <<'EOF'
Nightly vault maintenance for agent-brain.

Usage:
  sleep [--dry-run]

Options:
  --dry-run   Run pre-audit only, print summary, no LLM call

EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

# --- Parse config ---
WEAKEN_DAYS=60
ARCHIVE_DAYS=90
if [[ -f "$CONFIG_FILE" ]]; then
  val=$(grep -oP 'weaken_days\*\*:\s*\K\d+' "$CONFIG_FILE" 2>/dev/null || true)
  [[ -n "$val" ]] && WEAKEN_DAYS="$val"
  val=$(grep -oP 'archive_days\*\*:\s*\K\d+' "$CONFIG_FILE" 2>/dev/null || true)
  [[ -n "$val" ]] && ARCHIVE_DAYS="$val"
fi

# --- Parse protected files ---
declare -a PROTECTED=("Index.md" ".sleep-config.md")
if [[ -f "$CONFIG_FILE" ]]; then
  while IFS= read -r line; do
    file=$(echo "$line" | sed 's/^- //')
    PROTECTED+=("$file")
  done < <(awk '/^## Protected files/{found=1; next} found && /^- /{print; next} found && /^#/{exit}' "$CONFIG_FILE")
fi

is_protected() {
  local name="$1"
  for p in "${PROTECTED[@]}"; do
    [[ "$name" == "$p" ]] && return 0
  done
  return 1
}

# --- Collect MOC files ---
moc_files=("$VAULT_DIR/Index.md")
for f in "$VAULT_DIR"/*MOC*.md; do
  [[ -f "$f" ]] && moc_files+=("$f")
done

is_linked_in_moc() {
  local basename="$1"
  local link_name="${basename%.md}"
  for moc in "${moc_files[@]}"; do
    [[ -f "$moc" ]] && grep -q "\[\[${link_name}\]\]" "$moc" && return 0
  done
  return 1
}

# --- Audit each file ---
NOW=$(date +%s)
declare -a WEAKEN_LIST=()
declare -a ARCHIVE_LIST=()
declare -a LARGE_LIST=()
declare -a RECENT_LIST=()

total_files=0
strong_count=0
weak_count=0
total_size=0

mkdir -p "$ARCHIVE_DIR"

for filepath in "$VAULT_DIR"/*.md; do
  [[ -f "$filepath" ]] || continue
  filename=$(basename "$filepath")
  [[ "$filename" == .* ]] && continue

  total_files=$((total_files + 1))

  size=$(wc -c < "$filepath")
  total_size=$((total_size + size))

  last_mod=$(git -C "$VAULT_DIR" log -1 --format="%at" -- "$filename" 2>/dev/null || echo "$NOW")
  days_ago=$(( (NOW - last_mod) / 86400 ))

  linked=0
  is_linked_in_moc "$filename" && linked=1

  if [[ $linked -eq 1 ]]; then
    strong_count=$((strong_count + 1))
  else
    weak_count=$((weak_count + 1))
  fi

  if is_protected "$filename"; then
    continue
  fi

  if [[ $linked -eq 1 && $days_ago -ge $WEAKEN_DAYS ]]; then
    WEAKEN_LIST+=("$filename — last modified ${days_ago} days ago")
  fi

  if [[ $linked -eq 0 && $days_ago -ge $ARCHIVE_DAYS ]]; then
    ARCHIVE_LIST+=("$filename — last modified ${days_ago} days ago")
  fi

  if [[ $size -gt 5120 ]]; then
    LARGE_LIST+=("$filename — $(( size / 1024 ))KB")
  fi

  if [[ $days_ago -le 7 ]]; then
    RECENT_LIST+=("$filename")
  fi
done

# Count dormant files
dormant_count=0
for f in "$ARCHIVE_DIR"/*.md; do
  [[ -f "$f" ]] && dormant_count=$((dormant_count + 1))
done

# --- Format audit ---
audit="=== Agent Brain Sleep Audit ===
Files: ${total_files} (${strong_count} strong, ${weak_count} weak, ${dormant_count} dormant)
Total size: $(( total_size / 1024 ))KB
Thresholds: weaken=${WEAKEN_DAYS}d, archive=${ARCHIVE_DAYS}d

Candidates for attention:"

if [[ ${#WEAKEN_LIST[@]} -gt 0 ]]; then
  audit+=$'\n  WEAKEN ('"${WEAKEN_DAYS}"'+ days untouched, still linked):'
  for item in "${WEAKEN_LIST[@]}"; do
    audit+=$'\n    '"$item"
  done
else
  audit+=$'\n  WEAKEN: (none)'
fi

if [[ ${#ARCHIVE_LIST[@]} -gt 0 ]]; then
  audit+=$'\n  ARCHIVE ('"${ARCHIVE_DAYS}"'+ days untouched, already unlinked):'
  for item in "${ARCHIVE_LIST[@]}"; do
    audit+=$'\n    '"$item"
  done
else
  audit+=$'\n  ARCHIVE: (none)'
fi

if [[ ${#LARGE_LIST[@]} -gt 0 ]]; then
  audit+=$'\n  LARGE (>5KB, may need splitting):'
  for item in "${LARGE_LIST[@]}"; do
    audit+=$'\n    '"$item"
  done
else
  audit+=$'\n  LARGE: (none)'
fi

if [[ ${#RECENT_LIST[@]} -gt 0 ]]; then
  audit+=$'\n  RECENTLY CHANGED (last 7 days, may need consolidation):'
  audit+=$'\n    '"$(IFS=', '; echo "${RECENT_LIST[*]}")"
else
  audit+=$'\n  RECENTLY CHANGED: (none)'
fi

echo "$audit"
echo ""

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "(dry run — no LLM call)"
  exit 0
fi

# --- Check if anything needs attention ---
if [[ ${#WEAKEN_LIST[@]} -eq 0 && ${#ARCHIVE_LIST[@]} -eq 0 && ${#LARGE_LIST[@]} -eq 0 && ${#RECENT_LIST[@]} -eq 0 ]]; then
  echo "Nothing needs attention. Skipping LLM call."
  exit 0
fi

# --- Invoke Claude inside srt sandbox ---
echo "Invoking Claude inside srt sandbox for vault maintenance..."

unset CLAUDECODE 2>/dev/null || true

srt --settings "$SRT_SETTINGS" \
  claude -p \
  --append-system-prompt "$(printf 'SLEEP_AUDIT:\n%s' "$audit")" \
  --dangerously-skip-permissions \
  --allowedTools "Read,Edit,Write,Glob,Grep,Skill,Bash(git:*,mv:*,mkdir:*)" \
  --model sonnet \
  --max-budget-usd 0.50 \
  "Run the /sleep skill to perform vault maintenance based on the SLEEP_AUDIT in your system prompt. Work autonomously — plan changes, apply them, and commit. If nothing meaningful needs changing, say so and exit." \
  2>&1

echo ""
echo "Sleep maintenance complete."
```

**Step 2: Make executable**

```bash
chmod +x bin/sleep
```

**Step 3: Commit**

```
git add bin/sleep
git commit  # use git-commit skill
```

---

### Task 5: Update vault conventions

**Files:**
- Modify: `agent-brain/Conventions.md`

**Step 1: Add archive convention**

Append to the "This Vault" section in `Conventions.md`:

```markdown
- An `archive/` directory holds dormant notes — stale but valid content moved out of the active vault
- If you need information that seems like it should exist but doesn't, check `archive/` and restore it to the main vault if needed
- The `sleep` skill runs nightly to consolidate, reorganize, and weaken stale content
- See `.sleep-config.md` for weakening thresholds and protected files
```

**Step 2: Commit**

```
git add agent-brain/Conventions.md
git commit  # use git-commit skill
```

---

### Task 6: Register the sleep skill in AGENTS.md

**Files:**
- Modify: `AGENTS.md`

**Step 1: Add sleep to the Skills section**

Add to the Skills list in `AGENTS.md`:

```markdown
- Use the `sleep` skill for nightly vault maintenance — consolidation, reorganization, and memory weakening.
```

**Step 2: Commit**

```
git add AGENTS.md
git commit  # use git-commit skill
```

---

### Task 7: Test with dry-run

**Step 1: Run the dry-run**

```bash
bin/sleep --dry-run
```

Expected: prints the audit summary showing current vault state, exits without Claude invocation.

**Step 2: Verify audit output is reasonable**

Check that:
- File counts match actual vault contents
- Strong/weak classification matches MOC link status
- Days-since-modification values are plausible
- Protected files are excluded from WEAKEN/ARCHIVE candidates

**Step 3: Fix any issues found, commit fixes**

---

### Task 8: Verify srt sandbox isolation

**Step 1: Verify srt is installed**

```bash
srt --help
```

If not installed: `npm install -g @anthropic-ai/sandbox-runtime`

**Step 2: Test sandbox blocks writes outside ~/.agents**

```bash
srt --settings config/sleep-srt.json bash -c 'echo test > /tmp/should-fail.txt'
```

Expected: write denied by sandbox.

**Step 3: Test sandbox blocks network outside *.anthropic.com**

```bash
srt --settings config/sleep-srt.json curl https://example.com
```

Expected: network access denied.

**Step 4: Test sandbox allows writes inside ~/.agents**

```bash
srt --settings config/sleep-srt.json bash -c 'echo test > ~/.agents/sandbox-test.txt && rm ~/.agents/sandbox-test.txt'
```

Expected: succeeds.

---

### Task 9: Test full run

**Step 1: Run the full sleep script**

```bash
bin/sleep
```

Expected: runs pre-audit, invokes Claude inside srt sandbox, Claude reads the audit, decides what (if anything) needs changing, applies changes, and commits.

**Step 2: Verify results**

```bash
git log -3 --oneline
```

Check that any commit made by the sleep script is reasonable and follows conventions.

**Step 3: Fix any issues found, commit fixes**
