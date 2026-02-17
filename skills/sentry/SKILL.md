---
name: sentry
description: "Sentry CLI for issues, events, logs, and traces. Use when investigating errors, viewing stack traces, streaming logs, or analyzing performance traces."
---

# Sentry CLI

## Target Syntax

Most commands accept a target argument:

```
sentry <cmd> <org>/<project>   # explicit
sentry <cmd> <org>/            # all projects in org
sentry <cmd> <project>         # find project across orgs
sentry <cmd>                   # auto-detect from DSN/config
```

## Quick Reference

| Task | Command |
|------|---------|
| List unresolved issues | `sentry issues <target>` |
| View issue details | `sentry issue view <issue>` |
| AI root cause analysis | `sentry issue explain <issue>` |
| AI solution plan | `sentry issue plan <issue>` |
| View specific event | `sentry event view <event-id>` |
| List logs | `sentry logs <target>` |
| Stream logs (follow) | `sentry logs -f <target>` |
| View log entry | `sentry log view <log-id>` |
| List traces | `sentry traces <target>` |
| View trace | `sentry trace view <trace-id>` |
| Raw API call | `sentry api <endpoint>` |
| Open in browser | Add `-w` to any `view` command |

## Issues

### List Issues

```
sentry issues [target] [-q query] [-n limit] [-s sort] [--json]
```

- **Default limit:** 10
- **Sort:** `date` (default), `new`, `freq`, `user`
- **Query:** Sentry search syntax (see query syntax below)

### View Issue

```
sentry issue view <issue> [--spans depth] [--web] [--json]
```

Issue formats: `<org>/ID`, `<project>-suffix`, `ID`, numeric ID.
Includes latest event automatically. `--spans` controls span tree depth (default: 3, `all`, `no`).

### Explain Issue (Seer AI)

```
sentry issue explain <issue> [--force] [--json]
```

Returns root cause analysis, reproduction steps, relevant code locations.
`--force` triggers fresh analysis.

### Plan Fix (Seer AI)

```
sentry issue plan <issue> [--cause N] [--force] [--json]
```

Generates implementation steps. Runs explain first if needed.
`--cause` selects which root cause to plan for (when multiple exist).
Requires GitHub integration + code mappings.

## Events

```
sentry event view [<org>/<project>] <event-id> [--spans depth] [--web] [--json]
```

## Logs

### List/Stream Logs

```
sentry logs [target] [-q query] [-n limit] [-f [interval]] [--json]
```

- **Default limit:** 100, max 1000
- **Follow:** `-f` (2s default) or `-f 5` (5s interval)
- **Query:** `level:error`, `message:*timeout*`, etc.

### View Log Entry

```
sentry log view [<org>/<project>] <log-id> [--web] [--json]
```

## Traces

### List Traces

```
sentry traces [target] [-q query] [-n limit] [-s sort] [--json]
```

- **Default limit:** 20, max 1000
- **Sort:** `date` (default), `duration`
- **Query:** `transaction:GET /api/users`, etc.

### View Trace

```
sentry trace view [<org>/<project>] <trace-id> [--spans depth] [--web] [--json]
```

## Raw API

```
sentry api <endpoint> [-X method] [-F key=value] [-f key=value] [-H header] [--input file] [-i] [--verbose]
```

Endpoint is relative to `/api/0/`. Auth handled automatically.

Field syntax: `key=value`, `key[sub]=value` (nested), `key[]=value` (array append).

## Admin

| Command | Purpose |
|---------|---------|
| `sentry auth status` | Check auth + list orgs |
| `sentry auth login` | Authenticate |
| `sentry auth token` | Print token for scripts |
| `sentry orgs` | List orgs |
| `sentry projects [org]` | List projects (optional `--platform` filter) |
| `sentry teams [org]` | List teams |
| `sentry repos [org]` | List repos |

## Query Syntax

```
is:unresolved              Status filter
is:resolved / is:ignored
level:error                Level: error, warning, info, fatal
assigned:me                Assignment
times_seen:>100            Frequency
firstSeen:+7d              First seen > 7 days ago
lastSeen:-24h              Last seen within 24h
has:user                   Has user context
error.handled:0            Unhandled errors
user.email:*@example.com   User filter
transaction:GET /api/*     Transaction filter
```
