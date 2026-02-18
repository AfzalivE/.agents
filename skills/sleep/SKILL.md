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

Use the thresholds from `config/sleep.yaml`:
- **Strong → Weak**: File untouched for `weaken_days`+ days AND still linked in MOC. Action: remove its `[[wikilink]]` from the relevant MOC page.
- **Weak → Dormant**: File untouched for `archive_days`+ days AND already unlinked. Action: `mv` the file to `agent-brain/archive/`.

Never weaken or archive files listed in `config/sleep.yaml` under `protected_files`.

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
