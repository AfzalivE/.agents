---
name: ms-openapi-explorer
description: Explore Microsoft Graph API v1.0 OpenAPI specs. Use yq to query cached YAML files for endpoint discovery, schemas, and permissions.
---

# Microsoft OpenAPI Explorer

Explore Microsoft Graph API v1.0 endpoints before building MCP connectors or integrations.

## Cache Location

```
~/.agents/skills/ms-openapi-explorer/cache/
├── graph-v1.0-openapi.yaml      # Full spec
└── domains/
    ├── calendar.yaml            # /calendar, /events
    ├── mail.yaml                # /messages, /mailFolders
    ├── drive.yaml               # /drive, /drives
    ├── users.yaml               # /users
    ├── groups.yaml              # /groups
    ├── teams.yaml               # /teams, /chats
    ├── planner.yaml             # /planner
    ├── contacts.yaml            # /contacts
    ├── onenote.yaml             # /onenote
    └── todo.yaml                # /todo
```

## Refresh Cache

```bash
"$HOME/.agents/skills/ms-openapi-explorer/scripts/fetch-spec"         # if stale (>7 days)
"$HOME/.agents/skills/ms-openapi-explorer/scripts/fetch-spec" --force # force refresh
```

## Query Patterns (yq)

Use these yq patterns to explore the spec. Prefer domain files for faster queries.

### Find endpoints by keyword

```bash
# List paths containing a keyword
yq '.paths | keys | map(select(test("(?i)event")))' ~/.agents/skills/ms-openapi-explorer/cache/domains/calendar.yaml

# Search in path, summary, or description
yq '.paths | to_entries | map(select(
  (.key | test("(?i)event")) or
  (.value.get.summary // "" | test("(?i)event")) or
  (.value.post.summary // "" | test("(?i)event"))
)) | .[].key' ~/.agents/skills/ms-openapi-explorer/cache/domains/calendar.yaml
```

### Get endpoint details

```bash
# Full endpoint spec
yq '.paths["/users/{user-id}/calendar/events"]' ~/.agents/skills/ms-openapi-explorer/cache/domains/calendar.yaml

# Just the GET operation
yq '.paths["/users/{user-id}/calendar/events"].get' ~/.agents/skills/ms-openapi-explorer/cache/domains/calendar.yaml

# List all operations for an endpoint
yq '.paths["/users/{user-id}/calendar/events"] | keys' ~/.agents/skills/ms-openapi-explorer/cache/domains/calendar.yaml
```

### Get schemas

```bash
# List all schema names
yq '.components.schemas | keys' ~/.agents/skills/ms-openapi-explorer/cache/graph-v1.0-openapi.yaml

# Get a specific schema
yq '.components.schemas["microsoft.graph.event"]' ~/.agents/skills/ms-openapi-explorer/cache/graph-v1.0-openapi.yaml

# Find schemas by keyword
yq '.components.schemas | keys | map(select(test("(?i)calendar")))' ~/.agents/skills/ms-openapi-explorer/cache/graph-v1.0-openapi.yaml
```

### Get permissions

```bash
# Permissions are in x-ms-docs-required-delegated-scopes or similar fields
yq '.paths["/me/calendar/events"].get' ~/.agents/skills/ms-openapi-explorer/cache/domains/calendar.yaml
```

## Tips

- Use domain files for focused, faster queries on specific areas
- Domain files include all schemas (components section), so you can resolve `$ref` locally
- The `(?i)` flag makes regex case-insensitive
- Use the full spec when searching across multiple domains
