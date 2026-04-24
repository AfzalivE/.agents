---
name: td
description: "Todoist CLI for task and project management — tasks, projects, sections, labels, comments, reminders, filters, and activity. Use when managing Todoist tasks or projects."
---

# Todoist CLI (`td`)

Validated against CLI version: `1.40.0`

Use CLI help as the source of truth when flags conflict with this skill:

```bash
td <command> --help
```

## Common flags

- UX: `--no-spinner`, `--progress-jsonl [path]`, `-v` to `-vvvv`, `--accessible`, `--quiet`
- Output on most read commands: `--json`, `--ndjson`, `--full`
- Pagination on list commands: `--limit <n>`, `--cursor <cursor>`, `--all`
- Render control on task/text views: `--raw`

Always use `--json` or `--ndjson` for programmatic parsing.

**Agent rule:** use `td task add`, not `td add`.

## Quick reference

| Task | Command |
|------|---------|
| Today's tasks | `td today` |
| This week | `td upcoming` |
| Inbox | `td inbox` |
| Add task | `td task add "content" --due tomorrow --priority p1 --project MyProject` |
| Complete task | `td task complete <ref>` |
| Reschedule recurring task | `td task reschedule <ref> <date>` |
| List by project | `td task list --project "ProjectName"` |
| Search with filter | `td task list --filter "today & p1"` |
| View task | `td task view <ref>` |
| View any Todoist URL | `td view <url>` |

## Daily views

```bash
td today [options]
td upcoming [days] [options]
td inbox [options]
td completed [options]
```

- `today` / `upcoming`: `--any-assignee`, `--workspace <name>`, `--personal`, `--show-urls`
- `inbox`: `--priority <p1-p4>`, `--due <date>`, `--show-urls`
- `completed`: `--since <date>`, `--until <date>`, `--project <name>`, `--show-urls`

## Tasks (`td task`)

```bash
td task list [options]
td task view [ref]
td task add [content] [options]
td task update [ref] [options]
td task complete [ref] [--forever]
td task uncomplete [ref]
td task move [ref] [options]
td task reschedule [ref] [date]
td task delete [ref]
td task browse [ref]
```

### Common task options

- `add`
  - `--due <date>`, `--deadline <date>`, `--priority <p1-p4>`
  - `--project <name>`, `--section <ref>`, `--parent <ref>`
  - `--labels <a,b>`, `--description <text>`, `--stdin`
  - `--assignee <ref>`, `--duration <time>`
  - `--uncompletable`, `--order <number>`, `--json`, `--dry-run`
- `list`
  - `--project <name>`, `--parent <ref>`, `--label <name>`
  - `--priority <p1-p4>`, `--due <date>`, `--filter <query>`
  - `--assignee <ref>`, `--unassigned`, `--workspace <name>`, `--personal`, `--show-urls`
- `update`
  - `--content <text>`, `--due <date>`, `--deadline <date>`, `--no-deadline`
  - `--priority <p1-p4>`, `--labels <a,b>`, `--description <text>`, `--stdin`
  - `--assignee <ref>`, `--unassign`, `--duration <time>`
  - `--uncompletable`, `--completable`, `--order <number>`, `--json`, `--dry-run`
- `move`
  - `--project <ref>`, `--section <ref>`, `--parent <ref>`, `--no-parent`, `--no-section`, `--dry-run`
- `complete`
  - `--forever` permanently stops recurrence
- `reschedule`
  - Preserves recurrence; supports `--json` and `--dry-run`

## Projects (`td project`)

```bash
td project list
td project view [ref]
td project collaborators [ref]
td project create [options]
td project update [ref] [options]
td project archive [ref]
td project unarchive [ref]
td project delete [ref]
td project browse [ref]
td project move [ref] [options]
td project archived-count
td project permissions
td project join <id>
td project progress [ref]
td project health [ref]
td project health-context [ref]
td project activity-stats [ref]
td project analyze-health [ref]
```

### Common project options

- `list`: `--personal`, `--show-urls`
- `view`: `--detailed`, `--show-urls`
- `create` / `update`
  - `--name <name>`, `--color <color>`, `--favorite`
  - `--view-style list|board|calendar`
  - `create` also supports `--parent <ref>`
  - `update` also supports `--no-favorite`
  - both support `--json` and `--dry-run`
- `move`
  - `--to-workspace <ref>`, `--to-personal`
  - `--folder <ref>`, `--visibility restricted|team|public`
  - `--yes`, `--dry-run`
- Analysis / reporting
  - `progress`, `health`, `health-context`, `activity-stats`, `analyze-health`

## Other entities

- `td section`
  - `list`, `create`, `update`, `delete`, `archive`, `unarchive`, `browse`
- `td label`
  - `list`, `view`, `create`, `update`, `delete`, `browse`
  - `create`: `--name <name>`, `--color <color>`, `--favorite`, `--json`, `--dry-run`
- `td comment`
  - `list`, `add`, `update`, `delete`, `view`, `browse`
  - `add`: `--project`, `--content <text>`, `--stdin`, `--file <path>`, `--json`, `--dry-run`
- `td reminder`
  - `list`, `add`, `update`, `delete`
  - `add`: `--task <ref>`, `--before <duration>`, `--at <datetime>`, `--json`, `--dry-run`
- `td filter`
  - `list`, `create`, `update`, `delete`, `view|show`, `browse`
  - `create`: `--name <name>`, `--query <query>`, `--color <color>`, `--favorite`, `--json`, `--dry-run`
- `td attachment`
  - `view [url]`
- `td template`
  - `export-file`, `export-url`, `create`, `import-file`, `import-id`

## Workspaces, account, and activity

```bash
td workspace list
td workspace view [ref]
td workspace projects [ref]
td workspace users [ref]
td workspace insights [ref]

td activity [options]
td settings view|update|themes
td notification list|view|accept|reject|read|unread
td stats
td stats goals
td stats vacation
td auth login|logout|status|token
td update [--check|--channel]
td update switch
td skill list|install|update|uninstall
td completion install|uninstall
td view <url>
```

### Activity filters

- `--since <date>`, `--until <date>`
- `--type task|comment|project`
- `--event added|completed|updated|deleted|uncompleted|archived|unarchived|shared|left|reordered|moved`
- `--project <name>`, `--by <user>`

## Tips

- Priority mapping: `p1` highest, `p4` lowest/default.
- `td task list --filter` accepts raw Todoist filter syntax.
- Prefer `td task reschedule` for recurring tasks; it preserves recurrence semantics.
- `--show-urls` is useful when you need shareable links.
- Refs are usually names, `id:xxx`, or Todoist URLs depending on the command.
- Some commands require IDs specifically, for example `td task uncomplete id:123`.
