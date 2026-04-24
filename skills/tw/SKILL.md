---
name: tw
description: "Twist CLI for team messaging — threads, conversations, messages, comments, search, reactions, and workspace navigation. Use when reading or responding to Twist messages."
---

# Twist CLI (`tw`)

Validated against CLI version: `2.27.0`

Use CLI help as the source of truth when flags conflict with this skill:

```bash
tw <command> --help
```

## Common flags

- UX: `--no-spinner`, `--progress-jsonl [path]`, `--include-private-channels`, `--accessible`, `--non-interactive`, `--interactive`
- Output on most read commands: `--json`, `--ndjson`, `--full`

Always use `--json` or `--ndjson` for programmatic parsing.

## Quick reference

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
| React / unreact | `tw react thread <ref> +1` / `tw unreact thread <ref> +1` |
| View by URL | `tw view <url>` |

## Workspace and directory

```bash
tw workspaces
tw workspace use <ref>
tw user
tw users [workspace-ref]
tw groups [workspace-ref]
tw channels [workspace-ref]
```

- `tw users`: `--workspace <ref>`, `--search <text>`
- `tw groups`: `--workspace <ref>`, `--search <text>`
- `tw channels`: `--workspace <ref>`, `--scope joined|public|discoverable`, `--state active|all|archived`

## Inbox

```bash
tw inbox [workspace-ref] [options]
```

- `--workspace <ref>`
- `--channel <filter>`
- `--unread`
- `--since <date>`, `--until <date>`
- `--limit <n>`

## Threads (`tw thread`)

```bash
tw thread view [thread-ref]
tw thread reply <thread-ref> [content]
tw thread create <channel-ref> <title> [content]
tw thread done <thread-ref>
tw thread delete <thread-ref>
tw thread mute <thread-ref>
tw thread rename <thread-ref> <title>
tw thread unmute <thread-ref>
```

### Common thread options

- `view`
  - `--comment <id>`, `--unread`, `--context <n>`
  - `--limit <n>`, `--since <date>`, `--until <date>`, `--raw`
- `reply`
  - `--notify <recipients>`
  - `--close`, `--reopen`, `--dry-run`, `--json`, `--full`
  - accepts content from stdin
- `create`
  - `--notify <comma-separated-user-ids>`, `--dry-run`, `--json`, `--full`
  - accepts content from stdin
- `done`, `delete`, `mute`, `rename`, `unmute`
  - mutating ops generally support `--dry-run`
  - `delete` requires `--yes` for execution
  - `mute` supports `--minutes <n>`

## Conversations (`tw conversation` / `tw convo`)

```bash
tw conversation unread [workspace-ref]
tw conversation view [conversation-ref]
tw conversation with <user-ref> [workspace-ref]
tw conversation reply <conversation-ref> [content]
tw conversation done <conversation-ref>
tw conversation mute <conversation-ref>
tw conversation unmute <conversation-ref>
```

- `unread`: supports `--workspace <ref>`
- `view`: `--limit <n>`, `--since <date>`, `--until <date>`, `--raw`
- `with`: `--workspace <ref>`, `--include-groups`, `--snippet`
- `reply`: supports stdin, `--dry-run`, `--json`, `--full`
- `done`, `mute`, `unmute`: mutating ops with `--dry-run`; `mute` also supports `--minutes <n>`

## Messages and comments

```bash
tw msg view [message-ref]
tw msg update <message-ref> [content]
tw msg delete <message-ref>

tw comment view [comment-ref]
tw comment update <comment-ref> [content]
tw comment delete <comment-ref>
```

- `view`: `--raw`, plus JSON output flags where supported
- `update`: accepts content arg or stdin, plus `--dry-run`, `--json`, `--full`
- `delete`: supports `--dry-run` and `--json`

## Search, reactions, away

```bash
tw search <query> [workspace-ref] [options]
tw react <target-type> <target-ref> <emoji>
tw unreact <target-type> <target-ref> <emoji>
tw away
tw away set <type> [until]
tw away clear
```

### Search filters

- `--workspace <ref>`
- `--channel <channel-refs>`
- `--author <user-refs>`
- `--to <user-refs>`
- `--type threads|messages|all`
- `--title-only`
- `--conversation <refs>`
- `--mention-me`
- `--since <date>`, `--until <date>`
- `--limit <n>`, `--cursor <cursor>`

### Reactions and away

- `react` / `unreact` target types: `thread`, `comment`, `message`
- `away set` types: `vacation`, `parental`, `sickleave`, `other`
- `away set` also supports `--from <date>`, `--dry-run`, `--json`, `--full`
- `away clear` supports `--dry-run`, `--json`, `--full`

## Other useful commands

```bash
tw auth login|token|status|logout
tw view <url>
tw doctor [--json] [--offline]
tw update [--check|--channel]
tw update switch
tw skill list|install|update|uninstall
tw completion install|uninstall
```

## Tips

- `tw channels` defaults to active joined channels.
- Joined private channels only show up when you pass `--include-private-channels`.
- `tw conversation` is the DM/group workflow; `tw msg` and `tw comment` are single-entity operations.
- Many mutating commands support `--dry-run`; use it when available.
- Refs are usually Twist IDs or Twist URLs.
- Date filters use ISO format like `2026-04-23`.
