---
name: git-rebase-check
description: Verify that a rebased branch preserved the same cumulative patch as its pre-rebase ref or another comparison ref. Use when the user mentions `git-rebase-check`, wants to confirm a rebase did not lose changes, or asks whether a rewritten branch still matches the original.
---

# Git Rebase Check

Use this skill after rewriting a branch, usually after rebasing it onto `origin/main`, when you need patch equivalence rather than commit equivalence.

The bundled script lives at `scripts/git-rebase-check`. Prefer that path from skills so the check does not depend on shell dotfiles or a separately installed copy.

## What it checks

`git-rebase-check` compares:

- `git diff <local-base>..<local-ref>`
- `git diff <remote-base>..<remote-ref>`

If those cumulative diffs match exactly, the rebased branch preserved the same net file changes.

This is a tree-diff check. It does not verify commit hashes, commit order, or commit messages.

## Defaults

- `local-ref`: current branch
- `remote-ref`: upstream of `local-ref`
- `local-base`: `origin/main`
- `remote-base`: `git merge-base origin/main <remote-ref>`

These defaults are tuned for: "I rebased my feature branch onto the current `origin/main`; compare it to the pre-rebase remote branch."

Aliases:

- `--branch` = `--local-ref`
- `--remote-branch` = `--remote-ref`

## Workflow

1. Identify the rebased branch you want to validate.
2. If its upstream still points at the pre-rebase branch, run:

```bash
scripts/git-rebase-check
```

3. If there is no upstream, or you want a different comparison target, pass `--remote-ref`:

```bash
scripts/git-rebase-check --local-ref my-feature --remote-ref origin/my-feature
```

4. If you want to compare against a specific commit instead of a branch:

```bash
scripts/git-rebase-check --local-ref my-feature --remote-ref abc1234
```

5. If the rebase target was not `origin/main`, override both bases:

```bash
remote_base="$(git merge-base origin/release origin/my-feature)"

scripts/git-rebase-check \
  --local-ref my-feature \
  --remote-ref origin/my-feature \
  --local-base origin/release \
  --remote-base "$remote_base"
```

## Interpreting the result

- Exit `0`: no diff; the rebased ref is patch-equivalent to the comparison ref.
- Exit `1`: differences found, invalid args, or no upstream when `--remote-ref` was omitted.

On success it prints the local ref/base and remote ref/base it actually used.

On failure it prints a diff of the mismatched cumulative patches before the summary lines.

## Important constraints

- It compares refs, not the working tree. Uncommitted changes are ignored.
- It expects a branch name when relying on defaults. In detached HEAD or an in-progress/conflicted rebase, it can fail with `could not determine current branch; use --local-ref`.
- If the branch has no tracking branch, you must pass `--remote-ref`.
- The default `--local-base` is literally `origin/main`, not the merge-base with the local ref. That is correct for post-rebase verification onto `origin/main`, but wrong for arbitrary branch comparisons.
- Matching output means the final patch matches. It does not prove the rewritten history is clean.

## When to use something else

- Use `git range-diff` when you care about commit-to-commit correspondence.
- Use `git diff`, `git log`, or `git show` after a failure to inspect the actual drift.
- Use explicit base overrides if the branch was rebased onto anything other than `origin/main`.
