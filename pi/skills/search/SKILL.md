---
name: search
description: Unified web search with automatic provider selection (Kagi, Brave Search, Claude Code, Codex CLI). Use for searching documentation, facts, or current information.
---

# Search

Unified web search that automatically selects the best available provider.

## Provider precedence

1. **Kagi Search API** (when `KAGI_API_KEY` is set)
2. **Brave Search API** (when `BRAVE_API_KEY` is set)
3. **Claude Code CLI** (when `claude` is installed)
4. **Codex CLI** (when `codex` is installed)

The command prints which provider it chose, e.g.:

- `Searching using Kagi...`
- `Searching using Brave Search (Kagi: no key)...`
- `Searching using Claude Code (Kagi: no key, Brave Search: no key)...`
- `Searching using Codex (Kagi: no key, Brave Search: no key, Claude Code: not installed)...`

If a provider is available but fails at runtime (auth, quota, transient errors), it automatically falls back to the next provider and marks it as `failed` in the status list.

## Setup

Install dependencies (run once):

```bash
cd "$HOME/.agents/pi/skills/search"
npm install
```

### (Optional) Configure API keys

Kagi:

```bash
export KAGI_API_KEY="your-kagi-api-token"
```

Brave Search:

```bash
export BRAVE_API_KEY="your-brave-api-key"
```

### (Optional) Install AI CLIs

- Claude Code: `claude` must be on `PATH` (and authenticated).
- Codex CLI: `codex` must be on `PATH` (and you must be logged in via `codex login`).

## Search

```bash
"$HOME/.agents/pi/skills/search/index.ts" "query"          # Basic search (5 results)
"$HOME/.agents/pi/skills/search/index.ts" "query" -n 10     # More results
"$HOME/.agents/pi/skills/search/index.ts" "query" --content # Include page content as markdown (Kagi/Brave)
```

### Options

- `-n <num>` - Number of results (default: 5, max: 20)
- `--content` - Fetch and include page content as markdown (only for Kagi/Brave; fetched concurrently)

## Extract page content

```bash
"$HOME/.agents/pi/skills/search/content.ts" https://example.com/article
```
