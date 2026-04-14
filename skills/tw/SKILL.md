---
name: tw
description: "Twist CLI for team messaging — threads, conversations, messages, comments, search, reactions, and workspace navigation. Use when reading or responding to Twist messages."
---

# Twist CLI (`tw`)

Validated against CLI version: `2.27.0`

## Global Flags

| Flag | Purpose |
|------|---------|
| `--json` | Output as JSON |
| `--ndjson` | Output as newline-delimited JSON |
| `--full` | Include all fields in JSON output (default shows essential fields) |
| `--no-spinner` | Suppress loading animations |
| `--include-private-channels` | Include joined private channels when a command supports them |
| `--progress-jsonl [path]` | Emit progress events as JSONL to stderr or file |
| `--accessible` | Add text labels to color-coded output |
| `--non-interactive` | Disable prompts/editor flows |
| `--interactive` | Force interactive mode |

Always use `--json` or `--ndjson` for programmatic parsing.

## Quick Reference

| Task | Command |
|------|---------|
| Check inbox | `tw inbox` |
| Unread inbox | `tw inbox --unread` |
| Unread DMs/groups | `tw conversation unread` |
| Read a thread | `tw thread view <ref>` |
| Reply to a thread | `tw thread reply <ref> "text"` |
| Create a thread | `tw thread create <channel-ref> "Title" "Body"` |
| Read a DM/group | `tw conversation view <ref>` |
| Reply in a DM/group | `tw conversation reply <ref> "text"` |
| Find 1:1 with a user | `tw conversation with <user-ref>` |
| Search | `tw search "query"` |
| React | `tw react thread <ref> +1` |
| View by URL | `tw view <url>` |

## Workspace & Directory

```bash
tw workspaces
tw workspace use <ref>
tw user
tw users [workspace] [--search text]
tw groups [workspace] [--search text]
tw channels [workspace] [--scope joined|public|discoverable] [--state active|all|archived]
```

## Inbox

```bash
tw inbox [workspace] [options]
```

| Option | Description |
|--------|-------------|
| `--workspace <ref>` | Workspace ID or name |
| `--channel <filter>` | Fuzzy match channel name |
| `--unread` | Only unread threads |
| `--since <date>` | ISO date lower bound |
| `--until <date>` | ISO date upper bound |
| `--limit <n>` | Max items (default: 50) |

## Threads (`tw thread`)

### View

```bash
tw thread view <thread-ref> [options]
```

| Option | Description |
|--------|-------------|
| `--comment <id>` | Show only a specific comment |
| `--unread` | Only unread comments, with original post for context |
| `--context <n>` | Include N read comments before unread |
| `--limit <n>` | Max comments (default: 50) |
| `--since <date>` | Comments newer than |
| `--until <date>` | Comments older than |
| `--raw` | Raw markdown instead of rendered |

### Reply / Create

```bash
tw thread reply <thread-ref> [content] [options]
tw thread create <channel-ref> <title> [content] [options]
```

- `reply`: `--notify <recipients>`, `--close`, `--reopen`, `--dry-run`
- `create`: `--notify <recipients>`, `--dry-run`
- Both accept content from stdin.

### Manage

```bash
tw thread done <thread-ref> [--dry-run]
tw thread delete <thread-ref> [--yes] [--dry-run]
tw thread mute <thread-ref> [--minutes <n>] [--dry-run]
tw thread unmute <thread-ref> [--dry-run]
tw thread rename <thread-ref> <title> [--dry-run]
```

## Conversations (`tw conversation` / `tw convo`)

Use `conversation` for DMs and group conversations. `msg` is only for single-message view/edit/delete.

```bash
tw conversation unread [workspace]
tw conversation view <conversation-ref> [--limit <n>] [--since <date>] [--until <date>] [--raw]
tw conversation with <user-ref> [workspace] [--include-groups] [--snippet]
tw conversation reply <conversation-ref> [content] [--dry-run]
tw conversation done <conversation-ref> [--dry-run]
tw conversation mute <conversation-ref> [--minutes <n>] [--dry-run]
tw conversation unmute <conversation-ref> [--dry-run]
```

## Messages (`tw msg` / `tw message`)

```bash
tw msg view <message-ref> [--raw]
tw msg update <message-ref> [content] [--dry-run]
tw msg delete <message-ref> [--dry-run]
```

## Comments (`tw comment`)

```bash
tw comment view <comment-ref> [--raw]
tw comment update <comment-ref> [content] [--dry-run]
tw comment delete <comment-ref> [--dry-run]
```

## Search

```bash
tw search <query> [workspace] [options]
```

| Option | Description |
|--------|-------------|
| `--workspace <ref>` | Workspace ID or name |
| `--type <type>` | `threads`, `messages`, or `all` |
| `--channel <refs>` | Filter by channels (comma-separated refs) |
| `--author <refs>` | Filter by author (comma-separated refs) |
| `--to <refs>` | Messages sent to user |
| `--title-only` | Search thread titles only |
| `--conversation <refs>` | Limit to specific conversations |
| `--mention-me` | Only results mentioning current user |
| `--since <date>` | Content from date |
| `--until <date>` | Content until date |
| `--limit <n>` | Max results (default: 50) |
| `--cursor <cursor>` | Pagination cursor |

## Reactions

```bash
tw react <target-type> <target-ref> <emoji> [--dry-run]
tw unreact <target-type> <target-ref> <emoji> [--dry-run]
```

Target types: `thread`, `comment`, `message`.

## Away Status

```bash
tw away
tw away set <type> [until] [--from YYYY-MM-DD] [--dry-run]
tw away clear [--dry-run]
```

Away types: `vacation`, `parental`, `sickleave`, `other`.

## Other Useful Commands

| Command | Purpose |
|---------|---------|
| `tw auth login|token|status|logout` | Authentication |
| `tw view <url>` | Route any Twist URL to the right viewer |
| `tw doctor [--json] [--offline]` | Diagnose CLI/environment problems |
| `tw changelog [-n 10]` | Show recent CLI releases |
| `tw update --check` / `tw update switch` | Check or change CLI update channel |
| `tw skill list/install/update/uninstall` | Agent skill integrations |
| `tw completion install zsh` | Install shell completions |

## Tips

- Use `--dry-run` on mutating commands when available.
- `tw channels` defaults to active joined channels; use `--scope`/`--state` to widen, and `--include-private-channels` for joined private channels.
- `tw conversation` replaces the old DM/group workflow; `tw msg` and `tw comment` are single-entity operations.
- Refs can usually be IDs or Twist URLs.
- Date filters use ISO format (for example `2025-01-15`).
