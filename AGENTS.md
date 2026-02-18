## Workflow

- Starting a task: Read this guide end-to-end. Re-skim when major decisions arise or requirements shift.
- Reviewing git status or diffs: Treat them as read-only. Never revert or assume missing changes were yours.
- Planning: Study the existing codebase’s architecture, patterns, and conventions first; use external docs only when needed. Prioritize consistency, then simplicity.
- Trade-offs: If there's meaningful tension between approaches, ask the user before committing.
- Adding a dependency: Research well-maintained options and confirm fit with the user before adding.
- Starting to code: Don't start building until asked to.

## Code Quality

- Writing code: Write idiomatic, simple, maintainable code consistent with surrounding code. Optimize for the simplest, most intuitive solution.
- Before writing new code: Search the codebase for existing utilities, helpers, and patterns. Reuse and extend what exists rather than inventing new abstractions unless they’re clearly reused.
- Structuring code: Prefer the best design consistent with surrounding code, even if it means editing more code. If designs are equivalent, prefer fewer moving parts (smaller API surface, fewer changes).
- Organizing code: Follow the step-down rule. Keep high-level behavior at the top and details below. In classes: constructor, then public API methods, then private helpers. Prefer top-down call flow when practical.
- Editing code: No breadcrumbs. If you delete, move, or rename code, do not leave a comment in the old place.
- Fixing code: Reason from first principles, find the root cause of an issue, and fix it. Don't apply band-aids on top.
- Cleaning up: Clean up unused code ruthlessly. If a function no longer needs a parameter or a helper becomes unused, delete and update callers instead of letting junk linger. Never implement backward compatibility unless explicitly asked.

## Collaboration

- When review feedback is numbered, respond point-by-point and clearly mark what was addressed vs. deferred.
- Never push or open pull requests without the user explicitly asking you to.

## Communication

- Be direct, technical, and intellectually honest. No praise, filler, or performative politeness.
- If an idea is wrong or suboptimal, say so and explain why. Challenge assumptions and propose better alternatives.

## Skills

- Use the `oracle` skill when you need a review, a second opinion, or you're stuck.
- Use the `git-commit` skill when you will commit changes or propose commit messages.
- Use the `git-clean-history` skill when you need to create a clean branch with a refined commit history.
- Use the `git-worktree` skill when you need to manage git worktrees for multiple branches in separate directories.
- Use the `browser-tools` skill when you need to interact with web pages or automate browser actions.
- Use the `homeassistant-ops` skill when you need to operate/refactor a Home Assistant instance.
- Use the `ms-openapi-explorer` skill when you need to explore Microsoft Graph API v1.0 OpenAPI endpoints, schemas, and permissions.
- Use the `openscad` skill when you need to create and render OpenSCAD 3D models.
- Use the `sentry` skill when you need to fetch and analyze Sentry issues, events, and logs. Prefer the `sentry` CLI (see Tools) over the skill scripts.
- Use the `web-design` skill when you need to design and implement distinctive, production-ready web interfaces.
- Use the `update-changelog` skill when you need to update CHANGELOG.md following Keep a Changelog.
- Use the `sleep` skill for nightly vault maintenance — consolidation, reorganization, and memory weakening.

## Brain

Long-term memory is stored in an Obsidian vault at `~/.agents/agent-brain/`. This is the shared brain across every project and session — treat it as your persistent context about the user, their projects, and how they work.

**Read** the vault (start from `Index.md`) when prior context would help — especially at the start of non-trivial work.

**Write** to the vault proactively. Don't wait for an explicit ask. Write when:
- You learn something about a project's architecture, conventions, or quirks
- The user expresses a preference or corrects your approach
- You solve a tricky debugging problem (root cause + fix)
- An architectural decision is made and the rationale matters
- You discover environment details, key paths, or tooling nuances

Do not write in-progress or branch-specific state — use per-project auto-memory for that. The brain is for stable, cross-session knowledge.

Key files: `Index.md`, `Projects MOC.md`, `Preferences.md`, `Patterns.md`, `Troubleshooting.md`, `Tools & Skills.md`, `Decisions Log.md`, `Environment.md`, `Conventions.md`


## Tools

- Prefer `gh` to access GitHub issues, pull requests, etc.
- Use `git log` and `git blame` when historical context would help.
- Use the `sentry` skill when you need to investigate Sentry issues, events, logs, or traces.
- Use the `qmd` skill when you need to search across indexed markdown knowledge bases.
- Use the `tw` CLI when you need to read or respond to Twist messages, threads, DMs, or search Twist content.
- Use the `td` CLI when you need to manage Todoist tasks, projects, labels, or view activity. Agents: use `td task add` (not `td add`).
