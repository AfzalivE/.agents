# .agents

Reusable agent harness shared across Codex, Claude, and Pi. Everything lives here and is symlinked into each agent's config folder.

## Layout

```
AGENTS.md          Shared base instructions (symlinked into each agent folder)
skills/            Skill source of truth (SKILL.md + optional scripts/assets)
pi/extensions/     Pi-specific extensions
bin/sync           Symlink everything into Codex, Claude, and Pi config dirs
```

## Syncing

Skills and `AGENTS.md` are **symlinked** from this repo into each agent's config:

| Content | Codex | Claude | Pi |
|---------|-------|--------|----|
| Instructions | `~/.codex/AGENTS.md` | `~/.claude/CLAUDE.md` | `~/.pi/agent/AGENTS.md` |
| Skills | `~/.codex/skills/` | `~/.claude/skills/` | `~/.pi/agent/skills/` |
| Extensions | — | — | `~/.pi/agent/extensions/` |

```bash
~/.agents/bin/sync --prune
```

## Skills

| Skill | Description |
|-------|-------------|
| `browser-tools` | Interactive browser automation via Chrome DevTools Protocol |
| `git-clean-history` | Reimplement a branch on a fresh branch off `main` with a clean commit history |
| `git-commit` | Tidy, focused commits with clear rationale in messages |
| `git-worktree` | Manage git worktrees for multiple branches in separate directories |
| `homeassistant-ops` | Operate a Home Assistant instance via REST/WebSocket APIs |
| `ms-openapi-explorer` | Explore Microsoft Graph v1.0 OpenAPI endpoints, schemas, and permissions |
| `openscad` | Create and render OpenSCAD 3D models, export STL |
| `oracle` | Second opinion from another LLM for debugging, refactors, or design checks |
| `sentry` | Fetch and analyze Sentry issues, events, and logs |
| `update-changelog` | Update CHANGELOG.md following Keep a Changelog |
| `web-design` | Distinctive, production-ready web interfaces |

## Pi Extensions

| Extension | Command | Description |
|-----------|---------|-------------|
| `answer` | `/answer` | Extract and interactively answer agent questions |
| `branch-term` | `/branch` | Fork current session into a new terminal |
| `loop` | `/loop` | Repeat a prompt until the agent signals success |
| `review` | `/review` (+ `/end-review`) | Review PRs, branches, commits, folders, or uncommitted changes |
| `session-breakdown` | `/session-breakdown` | Usage stats and contribution-style calendar |
| `todos` | `/todos` | File-based todo items with claim/release for multi-session work |
| `worktree` | `/worktree` | Create, archive, clean, and list git worktrees |
| `sandbox` | `/sandbox` | Show sandbox configuration for bash operations (`--no-sandbox` disables it) |
| `telegram` | `/telegram` | Pair a Telegram bot and interact with Pi sessions remotely (`pair`, `status`, `unpair`) |
| `git-checkpoint` | _automatic_ | Stash checkpoints each turn so `/fork` can restore code state |
| `notify` | _automatic_ | Terminal notification when the agent is waiting for input |
