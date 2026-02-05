# .agents

Reusable agent harness shared across Codex, Claude, and Pi.

## Layout

- `AGENTS.md`: Shared base instructions (synced into each agent folder)
- `skills/`: Shared skill source of truth (each skill is a folder with `SKILL.md` + optional `scripts/`, `references/`, `assets/`)
- `bin/`: Helper scripts (not loaded as skills)
- `pi/`: Pi-specific extras (e.g. extensions)

## Syncing to Codex + Claude + Pi

Codex, Claude, and Pi load skills from their own folders:

- Codex: `~/.codex/skills/`
- Claude: `~/.claude/skills/`
- Pi: `~/.pi/agent/skills/`

### Symlinked

Skills are **symlinked** from `~/.agents/skills/` into each agent folder using:

- `~/.agents/bin/sync`

The shared `AGENTS.md` is also symlinked:

- Codex: `~/.codex/AGENTS.md`
- Claude: `~/.claude/CLAUDE.md`
- Pi: `~/.pi/agent/AGENTS.md`

Pi extensions are also synced:

- Source: `~/.agents/pi/extensions/`
- Target: `~/.pi/agent/extensions/`

Typical sync:

```bash
~/.agents/bin/sync --prune
```
