# .agents

Reusable agent harness shared across Codex, Claude, and Pi. Everything lives here and is symlinked into each agent's config folder.

## Layout

```
AGENTS.md              Shared base instructions (symlinked into each agent folder)
skills/                Skill source of truth (SKILL.md + optional scripts/assets)
agent-brain/           Long-term memory vault (Obsidian, kept in a separate private repo)
pi/extensions/         Pi-specific extensions
pi/agent/*.json        Repo-managed Pi JSON defaults
bin/setup              Set up selected Codex, Claude, and Pi configuration, skills, extensions, and dependencies
```

## Installing

```bash
git clone https://github.com/goncalossilva/.agents.git ~/.agents
```

`AGENTS.md` is symlinked into each agent config. Skills are symlinked to Claude, while Codex and Pi auto-discover them from `~/.agents/skills`.

| Content | Codex | Claude | Pi |
|---------|-------|--------|----|
| Instructions | `~/.codex/AGENTS.md` | `~/.claude/CLAUDE.md` | `~/.pi/agent/AGENTS.md` |
| Skills | `~/.agents/skills` | `~/.claude/skills/` | `~/.agents/skills` |
| Extensions | — | — | `~/.pi/agent/extensions/` |
| JSON config | — | — | `~/.pi/agent/*.json` |

`bin/setup` syncs the selected agent files and installs npm runtime dependencies for relevant packages.

By default it sets up all agents. Pass `--codex`, `--claude`, and/or `--pi` to limit to those agents.

```bash
~/.agents/bin/setup --prune
```

## Skills

| Skill | Description |
|-------|-------------|
| `browser-tools` | Interactive browser automation via Chrome DevTools Protocol |
| `gh` | GitHub CLI reference for issues, PRs, Actions, search, and raw API |
| `git-clean-history` | Reimplement a branch on a fresh branch off `main` with a clean commit history |
| `git-commit` | Tidy, focused commits with clear rationale in messages |
| `git-worktree` | Manage git worktrees for multiple branches in separate directories |
| `homeassistant-ops` | Operate a Home Assistant instance via REST/WebSocket APIs |
| `ms-openapi-explorer` | Explore Microsoft Graph v1.0 OpenAPI endpoints, schemas, and permissions |
| `openscad` | Create and render OpenSCAD 3D models, export STL |
| `oracle` | Second opinion from another LLM for debugging, refactors, design, or code reviews |
| `qmd` | Local semantic search engine for markdown knowledge bases |
| `sentry` | Sentry CLI reference for issues, events, logs, and traces |
| `update-changelog` | Update CHANGELOG.md following Keep a Changelog |
| `web-design` | Distinctive, production-ready web interfaces |

## Pi Extensions

## Pi Extensions

| Extension | Command / Shortcut | Description |
|-----------|--------------------|-------------|
| answer | `/answer` | Extract and interactively answer agent questions |
| branch-term | `/branch` | Open a new terminal on the current session's git branch |
| btw | `/btw` | Run a one-off side request with read-only tools and no context persistence |
| converge | `/converge` | Compare multiple engineer plans/specs and synthesize one recommended plan |
| openai-fast | `/fast` | Toggle priority service tier for supported OpenAI models |
| ghostty |  | Ghostty tab title enhancements while the agent is working, waiting, or idle |
| git-diff-stats |  | Status bar diff stats for local changes in the current repo |
| git-pr-status |  | Status bar PR number and link for the current branch |
| insights | `/insights` | Analyze Pi sessions and suggest reusable instructions, templates, skills, and extensions |
| interlude | `alt+x` <small>(configurable)</small> | Stash the current message draft, send one interlude message, then restore the draft |
| loop | `/loop` | Repeat a prompt until the agent signals success |
| memory | `/memory` | Opt-in project-local memory for learning and continuity across sessions |
| notify |  | Terminal notification when the agent is waiting for input |
| openai-verbosity | `/verbosity` | Set verbosity for supported OpenAI models |
| review | `/review`, `/triage` | Multi-focus review and PR feedback triage for PRs, branches, commits, and local changes, with integrated follow-up fixes |
| sandbox | `/sandbox` | OS-level sandboxing for bash commands with runtime overrides |
| usage | `/usage` | Historical provider usage breakdown with all-provider history and live quota snapshots |
| telegram | `/telegram` | Interact with Pi via a Telegram bot and local daemon |
| todo | `/todo` | Todoist-backed tasks with offline outbox sync for single or multi-session work |
| websearch |  | Web search via Gemini, OpenAI, or Claude, leveraging Pi or browser session credentials |
| worktree | `/worktree` | Create, list, and archive git worktrees, optionally opening them in a new terminal or tmux pane |

## Brain

The `agent-brain/` directory is an Obsidian vault that serves as long-term memory across sessions. It holds user-specific context — preferences, project notes, environment details, accumulated debugging insights — while general knowledge (CLI references, skill definitions) lives in `skills/`.

The brain is not included in this repo. To set up your own:

```bash
mkdir -p agent-brain
```

Then create these starter files:

```
agent-brain/
  Index.md              Central hub linking all topic pages
  Preferences.md        Your workflow and code style preferences
  Conventions.md        Git, code, and vault conventions
  Environment.md        Machine setup, key paths, repo structure
  Tools & Skills.md     User-specific tool context (accounts, orgs, API keys)
  Projects MOC.md       Project notes, architecture, key decisions
  Patterns.md           Proven coding patterns and idioms
  Troubleshooting.md    Debugging insights and recurring fixes
  Decisions Log.md      Architectural decisions with rationale
```

The agent will read and update these files as it learns. Keep the vault in a separate private repo if you don't want personal context in a public repo — just clone/symlink it into `agent-brain/`.
