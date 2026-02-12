## Workflow

- Starting a task: Read this guide end-to-end. Re-skim when major decisions arise or requirements shift.
- Reviewing git status or diffs: Treat them as read-only. Never revert or assume missing changes were yours.
- Planning: Consider the architecture. Research official docs, blogs, or papers. Review the existing codebase. Combine simplicity, modern best practices, and consistency with existing patterns/code. Ask about trade-offs if unsure.
- Adding a dependency: Research well-maintained options and confirm fit with the user before adding.
- Starting to code: Don't start building until asked to.

## Code Quality

- Writing code: Always idiomatic, simple, maintainable code. Always ask yourself if this is the most simple and intuitive solution to the problem.
- Code organization: Follow the step-down rule. Keep high-level behavior at the top and details below. In classes: constructor, then public API methods, then private helpers. Prefer top-down call flow when practical.
- Editing code: No breadcrumbs. If you delete, move, or rename code, do not leave a comment in the old place.
- Fixing code: Reason from first principles, find the root cause of an issue, and fix it. Don't apply band-aids on top.
- Cleaning up: Clean up unused code ruthlessly. If a function no longer needs a parameter or a helper becomes unused, delete and update callers instead of letting junk linger.

## Collaboration

- If you're unsure about trade-offs, ask the user explicitly.
- When review feedback is numbered, respond point-by-point and clearly mark what was addressed vs. deferred.

## Skills

- Use the `oracle` skill when you need a review, a second opinion, or you're stuck.
- Use the `git-commit` skill when you will commit changes or propose commit messages.
- Use the `git-clean-history` skill when you need to create a clean branch with a refined commit history.
- Use the `git-worktree` skill when you need to manage git worktrees for multiple branches in separate directories.
- Use the `browser-tools` skill when you need to interact with web pages or automate browser actions.
- Use the `homeassistant-ops` skill when you need to operate/refactor a Home Assistant instance.
- Use the `ms-openapi-explorer` skill when you need to explore Microsoft Graph API v1.0 OpenAPI endpoints, schemas, and permissions.
- Use the `openscad` skill when you need to create and render OpenSCAD 3D models.
- Use the `sentry` skill when you need to fetch and analyze Sentry issues, events, and logs.
- Use the `web-design` skill when you need to design and implement distinctive, production-ready web interfaces.
- Use the `update-changelog` skill when you need to update CHANGELOG.md following Keep a Changelog.

## Pi Extensions

- Use `/answer` to extract questions from the last assistant message and answer them interactively.
- Use `/branch` to fork the current session into a new terminal window.
- Use `/loop` to repeat a prompt until a breakout condition is met.
- Use `/review` (and `/end-review`) to review PRs, branches, commits, uncommitted changes, or folders.
- Use `/session-breakdown` to inspect recent Pi session usage and model/cost breakdowns.
- Use `/todos` for file-based todo management in `.pi/todos`.
- Use `/worktree` to create, archive, clean, and list git worktrees.
- Use `/sandbox` to inspect active sandbox config for bash operations (`--no-sandbox` disables sandboxing).
- Use `/telegram` to pair, inspect status, or unpair the Telegram bridge.
- `git-checkpoint` runs automatically to create per-turn stash checkpoints used during forks.
- `notify` runs automatically to send terminal notifications when Pi is ready for input.

## Tools

- Use `gh` to access GitHub issues, pull requests, etc.
