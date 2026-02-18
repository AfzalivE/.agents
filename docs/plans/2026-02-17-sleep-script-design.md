# Sleep Script Design

Nightly maintenance for the agent-brain vault. Consolidates scattered knowledge, reorganizes structure, and gradually weakens stale content — analogous to what sleep does for the brain.

## Deliverables

1. `skills/sleep/SKILL.md` — Skill instructions for vault maintenance
2. `bin/sleep` — Bash wrapper for cron/CLI invocation

## Operations

### Consolidation
Merge scattered notes on the same topic. When multiple files contain overlapping content, combine them into the canonical location and remove duplication.

### Reorganization
Split files that have grown too large. Ensure the MOC structure (Index.md → topic pages) stays coherent. Create new notes when a topic within a file deserves its own page. When a MOC page outgrows a single page, split it into sub-categories (e.g., "Troubleshooting - Python", "Troubleshooting - Infra") and update Index.md to link to the new pages.

### Three-tier memory weakening

Files move through three states based on staleness (time since last git modification):

| State | Location | MOC linked | Loaded into context |
|-------|----------|------------|-------------------|
| **Strong** | `agent-brain/` | Yes | Yes |
| **Weak** | `agent-brain/` | No (unlinked from MOC) | Yes, but less discoverable |
| **Dormant** | `agent-brain/archive/` | No | No |

Transitions:
- **Strong → Weak**: File untouched for 60+ days. Unlink from MOC pages but keep in vault.
- **Weak → Dormant**: File still untouched after another cycle (90+ days total). Move to `archive/`.
- **Dormant → Strong**: When a session needs archived content, it checks `archive/`, restores the file to the main vault, and re-links it in the MOC. Fully automatic.

### Deletion

Separate from weakening. Only for entries that are factually wrong or superseded. High confidence required — when in doubt, weaken instead.

## Autonomy model

Fully autonomous. The vault is the agent's own memory — no human management required. The sleep script runs unattended (e.g., via cron) and commits changes directly.

Safety relies on conservatism, not detection. Only archiving self-heals naturally (a session that needs archived content restores it). For consolidation, reorganization, and deletion there is no automatic way to detect a bad change — so the primary protection is not making bold changes in the first place. Git history is a last resort.

Conservative guardrails:
- Weakening thresholds default to 60/90 days, stored in `agent-brain/.sleep-config.md` so the sleep script can tune them over time based on vault behavior
- Deletion requires high confidence
- When in doubt: skip rather than weaken, weaken rather than archive, archive rather than delete

## Skill Phases

### Phase 1: Audit (cheap, mostly bash)

The bash wrapper handles this before invoking Claude:

1. `git log` per file — last modified date, frequency of changes
2. `ls -la` — file sizes
3. Check MOC link status — which files are linked from Index.md
4. Build a context summary of files that need attention

Only files flagged by the audit are fed to the LLM.

### Phase 2: Plan changes (LLM)

Claude reads flagged files and plans actions:

- **Consolidate**: Merge overlapping content into the canonical location
- **Reorganize**: Split large files, update Index.md
- **Weaken**: Unlink stale files from MOC (strong → weak)
- **Archive**: Move long-stale files to archive/ (weak → dormant)
- **Delete**: Remove factually wrong entries (high confidence only)

### Phase 3: Apply

Execute planned changes:

- Edit, move, and delete files as planned
- Update MOC links in Index.md and cross-references
- Commit via git-commit skill

## Rules

- Never populate stub files — only maintain what already has content
- Never delete content that's merely old — only content that's wrong
- Weaken and archive conservatively — generous thresholds, skip when in doubt
- Always keep Index.md as the central hub (it links to strong files only)
- The `archive/` directory mirrors the main vault's structure
- All sessions must know the archive exists: document it in vault conventions so any session can restore archived content when needed

## Sandboxing

The LLM invocation is wrapped with `srt` (Anthropic's [Sandbox Runtime](https://github.com/anthropic-experimental/sandbox-runtime)) for OS-level isolation. On macOS this uses `sandbox-exec` with Seatbelt profiles — no containers needed.

Three layers of defense:

1. **`srt`** (OS-level) — restricts filesystem writes and network access:
   - Writes allowed only to `~/.agents`
   - Network allowed only to `*.anthropic.com`
   - Mandatory deny paths auto-protect `.claude/commands/`, `.claude/agents/`, `.git/hooks/`, `.git/config`
2. **`--allowedTools`** (Claude Code) — Bash restricted to `git`, `mv`, `mkdir`
3. **`--max-budget-usd 0.50`** — cost cap per run

Settings stored in `config/sleep-srt.json`:

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

Requires: `npm install -g @anthropic-ai/sandbox-runtime`

## Bash wrapper (`bin/sleep`)

Follows `bin/sync` conventions:

- `--dry-run` — Run pre-audit, print summary, no LLM call
- Default: fully autonomous (audit → srt-sandboxed Claude → plan → apply → commit)

Pre-audit runs entirely on the host (pure bash, no LLM). Only files needing attention are passed to Claude via `--append-system-prompt`.

### Pre-audit output

```
=== Agent Brain Sleep Audit ===
Files: 11 (8 strong, 2 weak, 1 dormant)
Total size: 4.2 KB
Thresholds: weaken=60d, archive=90d

Candidates for attention:
  WEAKEN (60+ days untouched, still linked):
    GitHub CLI.md — last modified 92 days ago
  ARCHIVE (90+ days untouched, already unlinked):
    (none)
  LARGE (>5KB, may need splitting):
    (none)
  RECENTLY CHANGED (last 7 days, may need consolidation):
    Environment.md, Tools & Skills.md
```

### Invocation

Runs `srt claude -p` with the `config/sleep-srt.json` settings and the pre-audit summary appended to the system prompt.

## Archive structure

```
agent-brain/
  Index.md              ← links only to strong files
  Preferences.md        ← strong (linked, active)
  GitHub CLI.md         ← weak (in vault, unlinked from MOC)
  archive/
    OldTool.md          ← dormant (not loaded)
```

## Scaling

Each layer of the vault stays bounded:

- **Index.md** — Links to MOC categories only, not individual notes. Grows slowly (new category maybe once or twice a year). MOC splitting adds entries, but weakening removes them.
- **MOC pages** — Link to individual notes. Weakening unlinks stale entries, archiving removes them entirely. If a MOC page still outgrows a single page, the sleep script splits it into sub-categories.
- **Individual notes** — Atomic. Split if they grow too large. Created during sessions, weakened/archived by sleep.
- **Archive** — Grows indefinitely but is never loaded into context. Just a git-tracked safety net.

Self-regulating: weakening and archiving keep the active vault small, which keeps future runs cheap. The bash pre-audit ensures only files needing attention are read by the LLM.
