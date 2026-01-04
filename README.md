# .agents

Reusable agent harness shared across Codex and Claude.

## Layout

- `AGENTS.md`: Shared base instructions (synced into both agent folders)
- `skills/`: Shared skill source of truth (each skill is a folder with `SKILL.md` + optional `scripts/`, `references/`, `assets/`)
- `bin/`: Helper scripts (not loaded as skills)

## Syncing to Codex + Claude

Codex and Claude load skills from their own folders:

- Codex: `~/.codex/skills/`
- Claude: `~/.claude/skills/`

### Copied, not symlinked

Codex currently ignores symlinked skill directories, so skills are **copied** from `~/.agents/skills/` into both agent folders using:

- `~/.agents/bin/sync-agent-skills`

The shared `AGENTS.md` is also synced:

- Codex: `~/.codex/AGENTS.md`
- Claude: `~/.claude/CLAUDE.md`

Typical sync:

```bash
~/.agents/bin/sync-agent-skills --prune
```

When [Codex supports symlinked skills](https://github.com/openai/codex/issues/8369), I'll switch to using symlinks (see the comment in `~/.agents/bin/sync-agent-skills`).
