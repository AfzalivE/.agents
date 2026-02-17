---
name: gh
description: "GitHub CLI for issues, PRs, Actions, search, and raw API calls. Use when interacting with GitHub repositories, pull requests, issues, or workflows."
---

# GitHub CLI (`gh`)

## Repo Targeting

Most commands auto-detect repo from cwd. Override with `-R OWNER/REPO`.
Placeholders `{owner}`, `{repo}`, `{branch}` work in `gh api` endpoints.

## Quick Reference

| Task | Command |
|------|---------|
| List open PRs | `gh pr list` |
| View PR | `gh pr view <number>` |
| Create PR | `gh pr create -t "title" -b "body"` |
| PR diff | `gh pr diff <number>` |
| PR checks | `gh pr checks <number>` |
| Merge PR | `gh pr merge <number> --squash -d` |
| Checkout PR | `gh pr checkout <number>` |
| Review PR | `gh pr review <number> --approve` |
| Comment on PR | `gh pr comment <number> -b "text"` |
| List issues | `gh issue list` |
| View issue | `gh issue view <number>` |
| Create issue | `gh issue create -t "title" -b "body"` |
| My status | `gh status` |
| Open in browser | `gh browse <number>` |
| Raw API call | `gh api <endpoint>` |

## Pull Requests

### List

```
gh pr list [-s state] [-l label] [-a assignee] [-A author] [-B base] [-S search] [-L limit] [--json fields]
```

- **Default:** open PRs, limit 30
- **States:** `open` (default), `closed`, `merged`, `all`

### Create

```
gh pr create -t "title" -b "body" [-B base] [-H head] [-r reviewer] [-l label] [-a assignee] [-d] [-f]
```

- `-f` / `--fill` autofills title+body from commits
- `-d` marks as draft
- `--fill-verbose` uses commit msg+body for description
- `-F file` reads body from file

### View

```
gh pr view [<number>|<url>|<branch>] [-c] [--json fields] [-w]
```

- `-c` shows comments
- `--json` fields: `additions, assignees, author, body, changedFiles, commits, files, headRefName, labels, mergeStateStatus, number, reviewDecision, reviews, state, statusCheckRollup, title, url` (and more)

### Merge

```
gh pr merge [<number>] [-m|--merge] [-s|--squash] [-r|--rebase] [-d] [--auto] [-b body]
```

- `-d` deletes branch after merge
- `--auto` enables auto-merge when checks pass

### Review

```
gh pr review [<number>] [-a|--approve] [-c|--comment] [-r|--request-changes] [-b body]
```

### Checks

```
gh pr checks [<number>] [--watch] [--required] [--json fields]
```

Exit code 8 = checks pending. `--watch` polls until done. `--fail-fast` exits on first failure.

### Diff

```
gh pr diff [<number>] [--name-only] [--patch]
```

### Comment

```
gh pr comment [<number>] -b "text"
gh pr comment [<number>] --edit-last -b "updated"
gh pr comment [<number>] --delete-last --yes
```

## Issues

### List

```
gh issue list [-s state] [-l label] [-a assignee] [-A author] [-S search] [-m milestone] [-L limit] [--json fields]
```

- **Default:** open issues, limit 30

### Create

```
gh issue create -t "title" -b "body" [-l label] [-a assignee] [-m milestone] [-p project]
```

- `-a @me` self-assigns

### View

```
gh issue view <number> [-c] [--json fields] [-w]
```

### Other

```
gh issue close <number>
gh issue reopen <number>
gh issue comment <number> -b "text"
gh issue edit <number> [--add-label x] [--title "new"]
gh issue develop <number>          # manage linked branches
```

## Search

### Issues/PRs

```
gh search issues <query> [--repo R] [--owner O] [--state S] [--label L] [--assignee A] [--author A] [-L limit]
```

- `--include-prs` to include PRs
- Sort: `comments`, `created`, `interactions`, `reactions`, `updated` (default: `best-match`)

### Code

```
gh search code <query> [--repo R] [--owner O] [--language L] [--filename F] [--extension E] [-L limit]
```

### Exclude syntax

Use `--` before query with `-` prefix: `gh search issues -- "-label:bug"`

## Actions / Runs

```
gh run list [-L limit] [--json fields]
gh run view <run-id> [-v] [--log] [--log-failed] [-j job-id] [--web]
gh run watch <run-id>
gh run rerun <run-id> [--failed]
```

- `-v` shows job steps
- `--log-failed` shows only failed step logs

## Raw API

```
gh api <endpoint> [-X method] [-F key=value] [-f key=value] [-H header] [--jq expr] [--paginate] [--cache duration]
```

- Endpoint relative to `/api/v3/` (REST) or `graphql` for v4
- `-F` does type coercion (booleans, ints, `@file`); `-f` sends raw strings
- `--paginate --slurp` collects all pages into one JSON array
- `--jq` filters response (jq syntax)
- `--cache 1h` caches response

### Common API Patterns

```bash
# PR comments
gh api repos/{owner}/{repo}/pulls/123/comments

# Issue timeline
gh api repos/{owner}/{repo}/issues/123/timeline --paginate

# Repo info
gh api repos/{owner}/{repo}

# User info
gh api user
```

## Other Commands

| Command | Purpose |
|---------|---------|
| `gh status` | Assigned issues/PRs, review requests, mentions across all repos |
| `gh browse [number\|path]` | Open in browser (`-n` prints URL instead) |
| `gh browse main.go:312` | Open file at line in browser |
| `gh gist create -f name file` | Create gist |
| `gh gist list` | List your gists |
| `gh release list` | List releases |
| `gh release create tag` | Create release |
| `gh repo view` | View repo info |
| `gh repo clone OWNER/REPO` | Clone repo |
| `gh label list [-S search]` | List/search labels |

## JSON Output

Most commands support `--json fields` + `--jq expr` for structured output:

```bash
gh pr list --json number,title,headRefName --jq '.[] | "\(.number) \(.title)"'
gh issue list --json number,title,labels --jq '.[] | select(.labels | length > 0)'
```
