---
name: td
description: "Todoist CLI for task and project management — tasks, projects, sections, labels, comments, reminders, filters, and activity. Use when managing Todoist tasks or projects."
---

# Todoist CLI (`td`)

## Global Flags

| Flag | Purpose |
|------|---------|
| `--json` | Output as JSON |
| `--ndjson` | Output as newline-delimited JSON |
| `--full` | Include all fields in JSON output (default shows essential fields) |
| `--no-spinner` | Suppress loading animations |
| `-v` to `-vvvv` | Increase verbosity (up to 4 levels) |

Always use `--json` or `--ndjson` for programmatic parsing.

**Important:** Agents should use `td task add` (structured flags), not `td add` (natural language shorthand).

## Quick Reference

| Task | Command |
|------|---------|
| Today's tasks | `td today` |
| This week | `td upcoming` |
| Inbox | `td inbox` |
| Add task | `td task add "content" --due tomorrow --priority p1 --project MyProject` |
| Complete task | `td task complete <ref>` |
| List by project | `td task list --project "ProjectName"` |
| Search with filter | `td task list --filter "today & p1"` |
| View task | `td task view <ref>` |
| View by URL | `td view <url>` |

## Quick Views

### Today

```
td today [options]
```

Shows tasks due today and overdue. Default: only tasks assigned to me or unassigned.

| Option | Description |
|--------|-------------|
| `--any-assignee` | Show tasks assigned to anyone |
| `--workspace <name>` | Filter to workspace |
| `--personal` | Filter to personal projects |
| `--show-urls` | Include web app URLs |

### Upcoming

```
td upcoming [days] [options]
```

Tasks due in next N days (default: 7). Same options as `today`.

### Inbox

```
td inbox [options]
```

| Option | Description |
|--------|-------------|
| `--priority <p1-p4>` | Filter by priority |
| `--due <date>` | Filter by due date (`today`, `overdue`, or `YYYY-MM-DD`) |

### Completed

```
td completed [options]
```

| Option | Description |
|--------|-------------|
| `--since <date>` | Start date (default: today) |
| `--until <date>` | End date (default: tomorrow) |
| `--project <name>` | Filter by project |

## Tasks (`td task`)

### Add

```
td task add [content] [options]
```

| Option | Description |
|--------|-------------|
| `--due <date>` | Due date (natural language or `YYYY-MM-DD`) |
| `--deadline <date>` | Deadline date (`YYYY-MM-DD`) |
| `--priority <p1-p4>` | Priority (`p1` = highest/urgent, `p4` = lowest/default) |
| `--project <name>` | Project name or `id:xxx` |
| `--section <ref>` | Section (name with `--project`, or `id:xxx`) |
| `--labels <a,b>` | Comma-separated labels |
| `--parent <ref>` | Parent task reference |
| `--description <text>` | Task description |
| `--assignee <ref>` | Assign to user (name, email, `id:xxx`, or `"me"`) |
| `--duration <time>` | Duration (e.g., `30m`, `1h`, `2h15m`) |

### List

```
td task list [options]
```

| Option | Description |
|--------|-------------|
| `--project <name>` | Filter by project name or `id:xxx` |
| `--parent <ref>` | Filter subtasks of a parent |
| `--label <name>` | Filter by label (comma-separated for multiple) |
| `--priority <p1-p4>` | Filter by priority |
| `--due <date>` | Filter by due date (`today`, `overdue`, or `YYYY-MM-DD`) |
| `--filter <query>` | Raw Todoist filter query |
| `--assignee <ref>` | Filter by assignee (`me` or `id:xxx`) |
| `--unassigned` | Only unassigned tasks |
| `--workspace <name>` | Filter to workspace |
| `--personal` | Filter to personal projects |
| `--show-urls` | Include web app URLs |

### View

```
td task view [ref] [--json] [--full] [--raw]
```

### Update

```
td task update [ref] [options]
```

| Option | Description |
|--------|-------------|
| `--content <text>` | New content |
| `--due <date>` | New due date |
| `--deadline <date>` | New deadline (`YYYY-MM-DD`) |
| `--no-deadline` | Remove deadline |
| `--priority <p1-p4>` | New priority |
| `--labels <a,b>` | New labels (replaces existing) |
| `--description <text>` | New description |
| `--assignee <ref>` | Assign to user |
| `--unassign` | Remove assignee |
| `--duration <time>` | Duration |

### Complete / Uncomplete

```
td task complete [ref] [--forever]   # --forever stops recurrence
td task uncomplete [ref]             # Reopen (requires id:xxx)
```

### Move

```
td task move [ref] [options]
```

| Option | Description |
|--------|-------------|
| `--project <ref>` | Target project |
| `--section <ref>` | Target section |
| `--parent <ref>` | Parent task |
| `--no-parent` | Remove parent (move to project root) |
| `--no-section` | Remove section |

### Delete / Browse

```
td task delete [ref]
td task browse [ref]    # Open in browser
```

## Projects (`td project`)

```
td project list [--json]
td project view [ref]
td project create [options]
td project update [ref] [options]
td project archive [ref]
td project unarchive [ref]
td project collaborators [ref]
td project delete [ref]            # Must have no uncompleted tasks
td project browse [ref]
```

## Sections (`td section`)

```
td section list [project]
td section create [options]
td section update [id]
td section delete [id]
td section browse [id]
```

## Labels (`td label`)

```
td label list
td label view [ref]
td label create [options]
td label update [ref]
td label delete [name]
td label browse [ref]
```

## Comments (`td comment`)

```
td comment list [ref]              # Task comments (--project for project comments)
td comment add [ref] [options]
td comment update [id]
td comment delete [id]
td comment view [id]
td comment browse [id]
```

## Reminders (`td reminder`)

```
td reminder list [task]
td reminder add [task] [options]
td reminder update [id]
td reminder delete [id]
```

## Filters (`td filter`)

```
td filter list
td filter create [options]
td filter update [ref]
td filter delete [ref]
td filter view [ref]               # Shows tasks matching the filter
td filter browse [ref]
```

## Activity

```
td activity [options]
```

| Option | Description |
|--------|-------------|
| `--since <date>` | Start date (`YYYY-MM-DD`) |
| `--until <date>` | End date |
| `--type <type>` | `task`, `comment`, or `project` |
| `--event <type>` | `added`, `completed`, `updated`, `deleted`, `uncompleted`, `archived`, `unarchived`, `shared`, `left`, `reordered`, `moved` |
| `--project <name>` | Filter by project |
| `--by <user>` | Filter by initiator (`me` for yourself) |

## Other

| Command | Purpose |
|---------|---------|
| `td stats` | Productivity stats and karma |
| `td stats goals` | Update daily/weekly goals |
| `td stats vacation` | Toggle vacation mode |
| `td workspace list/view/projects/users` | Workspace management |
| `td settings view/update/themes` | User settings |
| `td notification list/view/accept/reject/read/unread` | Notifications & invitations |
| `td view <url>` | View any Todoist entity by URL |
| `td add "natural language"` | Quick add (human shorthand, not for agents) |
| `td skill list/install/update/uninstall` | Agent skill integrations |
| `td completion` | Shell completions |

## Tips

- Priority: `p1` = highest (urgent), `p2` = high, `p3` = medium, `p4` = lowest/default.
- `td task list --filter` accepts raw Todoist filter syntax (e.g., `"today & p1"`, `"overdue | no date"`).
- `td today` and `td upcoming` default to only your tasks + unassigned; use `--any-assignee` for all.
- `--show-urls` adds web app links to task output — useful for sharing.
- Refs can be task names, IDs (`id:xxx`), or URLs.
