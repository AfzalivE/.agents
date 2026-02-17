---
name: qmd
description: "Local semantic search engine for markdown knowledge bases. Use when searching for information across indexed collections."
---

# QMD

On-device search engine for markdown documents. Combines BM25 full-text search, vector semantic search, and LLM reranking — all running locally.

## Quick Reference

| Task | Command |
|------|---------|
| Keyword search | `qmd search "query"` |
| Semantic search | `qmd query "query"` |
| Vector search | `qmd vsearch "query"` |
| Search in collection | `qmd search "query" -c <name>` |
| Get a document | `qmd get <file>` |
| Get multiple docs | `qmd multi-get <pattern>` |
| List collection files | `qmd ls <collection>` |
| Index status | `qmd status` |
| Re-index after changes | `qmd update` |
| Rebuild embeddings | `qmd embed` |

## Search Commands

### `qmd search` — Fast keyword search (BM25)

```
qmd search <query> [-n num] [-c collection] [--min-score N] [--full] [--line-numbers] [--files] [--json|--csv|--md|--xml]
```

Best for: exact terms, function names, specific phrases.

### `qmd query` — Semantic search with reranking

```
qmd query <query> [-n num] [-c collection] [--min-score N] [--full] [--line-numbers] [--files] [--json|--csv|--md|--xml]
```

Best for: natural language questions, conceptual searches. Uses query expansion + LLM reranking. Downloads reranker/expander models on first use (~1.7GB).

### `qmd vsearch` — Vector similarity search

```
qmd vsearch <query> [-n num] [-c collection] [--min-score N] [--full] [--line-numbers] [--files] [--json|--csv|--md|--xml]
```

Best for: finding semantically similar content without reranking overhead.

### Common Options

- `-n <num>` — Number of results (default: 5, or 20 for `--files`)
- `--all` — Return all matches (combine with `--min-score` to filter)
- `--full` — Output full document instead of snippet
- `--line-numbers` — Add line numbers to output
- `--files` — Output `docid,score,filepath,context` (default: 20 results)
- `--json` / `--csv` / `--md` / `--xml` — Output format
- `-c <name>` — Filter to a specific collection

## Document Retrieval

### `qmd get` — Single document

```
qmd get <file>[:line] [-l N] [--from N]
```

Accepts filepath or `qmd://<collection>/path`. Optional line range.

### `qmd multi-get` — Multiple documents

```
qmd multi-get <pattern> [-l N] [--max-bytes N] [--json|--csv|--md|--xml|--files]
```

Accepts glob patterns or comma-separated list. `--max-bytes` skips large files (default: 10240).

## Collection Management

```
qmd collection add <path> --name <name> [--mask <pattern>]
qmd collection list
qmd collection remove <name>
qmd collection rename <old> <new>
qmd ls [collection[/path]]
```

## Context

Contexts are descriptions that help searches understand content relationships.

```
qmd context add [path] "description"
qmd context list
qmd context rm <path>
```

## Maintenance

```
qmd update [--pull]    # Re-index all collections (--pull: git pull first)
qmd embed [-f]         # Generate/refresh embeddings (-f: force all)
qmd cleanup            # Remove cache, orphaned data, vacuum DB
```

## Tips

- Use `qmd search` for fast lookups, `qmd query` for best quality
- Filter with `-c` when you know which collection has the answer
- Use `--xml` output for structured agent consumption
- Run `qmd update && qmd embed` after adding/changing documents
- Use `--full` to get complete documents instead of snippets
