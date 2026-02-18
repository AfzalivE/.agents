---
name: tw
description: "Twist CLI for team messaging — threads, DMs, channels, inbox, search, and reactions. Use when reading or responding to Twist messages."
---

# Twist CLI (`tw`)

## Global Flags

| Flag | Purpose |
|------|---------|
| `--json` | Output as JSON |
| `--ndjson` | Output as newline-delimited JSON |
| `--full` | Include all fields in JSON output (default shows essential fields) |
| `--no-spinner` | Suppress loading animations |
| `--include-private-channels` | Include private channels in output |
| `--progress-jsonl [path]` | Emit progress events as JSONL to stderr or file |

Always use `--json` or `--ndjson` for programmatic parsing.

## Quick Reference

| Task | Command |
|------|---------|
| Check inbox | `tw inbox` |
| Unread inbox | `tw inbox --unread` |
| Unread DMs | `tw msg unread` |
| Read a thread | `tw thread view <ref>` |
| Reply to thread | `tw thread reply <ref> "text"` |
| Read a DM | `tw msg view <ref>` |
| Reply to DM | `tw msg reply <ref> "text"` |
| Search | `tw search "query"` |
| React | `tw react thread <ref> :emoji:` |

## Workspace & Users

```
tw workspaces                         # List all workspaces
tw workspace use <ref>                # Set current workspace
tw user                               # Show current user info
tw users [workspace] [--search text]  # List users (fuzzy filter)
tw channels [workspace]               # List channels
```

## Inbox

```
tw inbox [workspace] [options]
```

| Option | Description |
|--------|-------------|
| `--unread` | Only unread threads |
| `--channel <filter>` | Fuzzy match channel name |
| `--since <date>` | ISO date lower bound |
| `--until <date>` | ISO date upper bound |
| `--limit <n>` | Max items (default: 50) |

## Threads

### View

```
tw thread view <thread-ref> [options]
```

| Option | Description |
|--------|-------------|
| `--unread` | Only unread comments (with original post for context) |
| `--context <n>` | Include N read comments before unread (use with `--unread`) |
| `--comment <id>` | Show only a specific comment |
| `--limit <n>` | Max comments (default: 50) |
| `--since <date>` | Comments newer than |
| `--until <date>` | Comments older than |
| `--raw` | Raw markdown instead of rendered |

### Reply

```
tw thread reply <thread-ref> [content] [options]
```

| Option | Description |
|--------|-------------|
| `--notify <recipients>` | `EVERYONE`, `EVERYONE_IN_THREAD`, or comma-separated user IDs (default: `EVERYONE_IN_THREAD`) |
| `--dry-run` | Preview without posting |

### Archive

```
tw thread done <thread-ref>
```

## Direct Messages / Group Conversations

### Unread

```
tw msg unread [workspace]
```

### View

```
tw msg view <conversation-ref> [options]
```

Options: `--limit`, `--since`, `--until`, `--raw`, `--json`, `--ndjson`, `--full`.

### Reply

```
tw msg reply <conversation-ref> [content] [--dry-run]
```

### Archive

```
tw msg done <conversation-ref>
```

## Search

```
tw search <query> [workspace] [options]
```

| Option | Description |
|--------|-------------|
| `--type <type>` | `threads`, `messages`, or `all` |
| `--channel <refs>` | Filter by channels (comma-separated IDs) |
| `--author <refs>` | Filter by author (comma-separated IDs) |
| `--to <refs>` | Messages sent to user |
| `--title-only` | Search thread titles only |
| `--conversation <refs>` | Limit to specific conversations |
| `--mention-me` | Only results mentioning current user |
| `--since <date>` | Content from date |
| `--until <date>` | Content until date |
| `--limit <n>` | Max results (default: 50) |
| `--cursor <cursor>` | Pagination cursor |

## Reactions

```
tw react <target-type> <target-ref> <emoji> [--dry-run]
tw unreact <target-type> <target-ref> <emoji> [--dry-run]
```

Target types: `thread`, `comment`, `message`.

## Agent Skills

```
tw skill list              # List available agents and install status
tw skill install <agent>   # Install an agent skill
tw skill uninstall <agent> # Uninstall an agent skill
```

## Tips

- Use `--dry-run` on `thread reply`, `msg reply`, `react`, and `unreact` to preview before sending.
- Thread and comment refs can typically be IDs or URLs.
- Date filters use ISO format (e.g., `2025-01-15`).
