---
name: dream
description: Nightly vault maintenance — consolidate, reorganize, and weaken stale content in agent-brain.
---

# Dream — Vault Maintenance

You are running autonomous nightly maintenance on the agent-brain vault at `~/.agents/agent-brain/`.

The bash wrapper has already run a pre-audit and appended it to your system prompt as `DREAM_AUDIT`. Use it to decide which files need attention. The audit includes a reference-integrity report; treat unresolved broken references as blocking work, not advisory noise. Reference integrity is broader than link syntax: outdated referential prose is part of the same problem.

## Operations (in priority order)

### 1. Reference integrity
- Fix broken note references before any consolidation, weakening, archiving, or deletion decisions.
- Validate both Obsidian wikilinks (`[[Note]]`, `[[Note#Heading]]`) and markdown note links (`[label](Note.md)` / relative `.md` paths).
- Treat stale semantic references as first-class reference problems even when the literal link still resolves. Examples: a note says "see X under Y", quotes a heading/title that no longer exists, points at an old canonical note after a merge/rename, or describes a location that has moved.
- Use `node skills/dream/scripts/validate-references.mjs --apply --label during-run` when Bash + `node` are available. Otherwise use the report embedded in `DREAM_AUDIT`, then repair links directly with read/edit/search tools.
- Use the scripted validator for syntactic link breakage, then manually inspect the surrounding sentence/paragraph for stale reference prose that the validator cannot detect.
- Best-effort repair means: prefer exact path matches, exact basename matches, unique aliases, recently moved files, archive destinations, and current canonical notes before considering fuzzy matches. Use surrounding context, backlinks, headings, and `git log` when needed to disambiguate.
- When a reference mentions a note section or location in prose, verify that the named heading/location still exists. If the content moved, update both the link and the prose so the instruction remains true.
- Never create empty placeholder notes just to satisfy a broken link.
- After any move, split, archive, unlink, merge, rename, or deletion, re-run validation and also sweep touched notes for stale referential wording introduced by the change.
- Plans and decision notes often contain narrative references to implementation notes, rationale, or follow-up docs. Audit those sentences explicitly; they are common sources of stale references.

### 2. Consolidation
- Read files flagged as RECENTLY CHANGED in the audit
- If multiple files contain overlapping content on the same topic, merge into the canonical location
- Remove duplication after merging
- **Protected notes** (configured in `config/dream.yaml` under `protected_note_tags`, currently `agenda` and `planning`): never trim, summarize, condense, paraphrase, or rewrite their content. These are reference artifacts — their detailed steps have value even after implementation.
- For protected notes, allowed edits are narrow: fix broken/stale references, update obsolete note/heading names, or move the entire file intact when archiving a shipped technical plan.
- Do not replace a protected note body with a retrospective summary, status blurb, or short “see X” note.
- Assume the wrapper will run a post-maintenance integrity check that fails the run if a protected note is materially shortened or rewritten.
- If `DREAM_AUDIT` includes a plan-integrity verifier command, run it before committing and treat any violation as a stop condition.

### 3. Reorganization
- Read files flagged as LARGE in the audit
- If a file exceeds ~5KB or covers multiple distinct topics, split it into separate notes
- If a MOC page has grown too large, split into sub-categories (e.g., "Troubleshooting - Python")
- Update Index.md and cross-references after any split

### 4. Weakening (three-tier memory)

Files move through three states based on staleness:

| State | Location | MOC linked |
|-------|----------|------------|
| **Strong** | `agent-brain/` | Yes |
| **Weak** | `agent-brain/` | No |
| **Dormant** | `agent-brain/archive/` | No |

Use the thresholds from `config/dream.yaml`:
- **Strong → Weak**: File untouched for `weaken_days`+ days AND still linked in MOC. Action: remove its `[[wikilink]]` from the relevant MOC page.
- **Weak → Dormant**: File untouched for `archive_days`+ days AND already unlinked. Action: `mv` the file to `agent-brain/archive/`.

Never weaken or archive files listed in `config/dream.yaml` under `protected_files`.

### 5. Archiving shipped technical plans
- When a technical plan file (tagged `planning`) has a **Status** of "Shipped", move it intact to `archive/plans/`.
- "Shipped" means the work was merged in a PR. Other statuses like "Implemented" or "In Progress" mean the plan is still active — leave it in place.
- Do NOT trim, summarize, or gut the plan content — move the full file as-is.
- Update any wikilinks in MOC pages to point to the new location.
- Never determine shipped status on your own. Only act on an explicit `Status: Shipped` field in the plan file itself.

### 6. Deletion
- Only delete entries that are **factually wrong or superseded** (e.g., a tool path that changed, a version that's wrong)
- High confidence required — when in doubt, skip
- Never delete content that's merely old
- Never delete or reduce protected notes — archive them intact instead (see step 4)

## Rules

- Never populate stub files (files with only a template/header and no real content)
- When in doubt: skip rather than weaken, weaken rather than archive, archive rather than delete
- Always keep Index.md as the central hub linking to all strong files
- If a broken reference changes the apparent strong/weak state of a note, repair the reference first and only then trust the audit classification
- A reference is only valid if both the destination and the surrounding description are still accurate
- Protected notes are protected artifacts. Preserve their body text verbatim except for surgical reference corrections or intact archival moves.
- Commit changes using the git-commit skill when done
- If the audit shows nothing needs attention, do nothing and exit

## Commit guidelines

- One commit for all dream maintenance changes
- Subject: "Dream: <brief summary of what changed>"
- Body: list each action taken (consolidated X, weakened Y, archived Z)
