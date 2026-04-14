---
name: review-breaker
description: Break a large review branch into a temporary stack of smaller, reviewer-friendly commits without touching the original branch. Use when a PR or local branch has a few oversized commits and you want to review it commit-by-commit while preserving the exact final patch.
argument-hint: "[source-branch] [base-ref]"
---

# /review-breaker

Split a large branch into a local-only, reviewable commit stack.

## Usage

- `/skill:review-breaker`
- `/skill:review-breaker my-branch b8cc4d4`

If arguments are omitted, default the source to the current branch and ask for the base ref when it is not obvious.

## Behavior

1. Confirm the source branch/ref and base ref.
   - Keep the original branch untouched unless the user explicitly asks otherwise.
   - If the goal is a local review aid, say so clearly and do not treat the new branch as something to push by default.

2. Validate the starting state.
   - Stop if the source worktree has uncommitted changes or merge conflicts.
   - Inspect the commit range and cumulative file diff from base to source before choosing a split.

3. Plan a reviewer-first stack.
   - Break the cumulative diff into smaller logical commits.
   - Prefer one coherent idea per commit.
   - Keep tests/docs with the change they explain unless separating them makes the review materially easier.
   - When there is tension between "clean history" and "easy review", optimize for review.

4. Create a temporary branch and separate worktree.
   - Default branch name: `<source>-split`.
   - If that name already exists, pick a nearby unique variant.
   - Use a writable sibling directory for the worktree so the source branch remains available for comparison.
   - Follow the naming and cleanup conventions in `references/naming-and-cleanup.md`.

5. Reconstruct the branch from the base.
   - Restore only the files or hunks needed for the next logical slice from the source branch.
   - Commit each slice with a concise message.
   - Use `git commit --no-verify` for intermediate commits when hooks would block partial states.
   - Do not rewrite, reset, or force-update the source branch.

6. Verify patch equivalence.
   - Compare the source and split tree hashes.
   - Run `git diff --name-only <source>..<split>` and expect no output.
   - Use the `git-rebase-check` skill and run the bundled `../git-rebase-check/scripts/git-rebase-check --local-ref <split> --remote-ref <source> --local-base <base> --remote-base <base>`.
   - If verification fails, treat the split as invalid and fix it before presenting it.

7. Report back with:
   - split branch name
   - worktree path
   - ordered commit list
   - verification result
   - suggested starting point for review

8. Unless the user asks, do not push, open PRs, or delete the temporary branch/worktree.

## When to use something else

- Use `git-clean-history` when the goal is a publishable cleaned-up branch rather than a local review aid.
- Use `git-rebase-check` when you only need patch-equivalence validation.
- Use `git-worktree` when you just need raw worktree operations.

## Gotchas

- `git-rebase-check` defaults are usually wrong for this workflow. Use the `git-rebase-check` skill and pass explicit refs and both base refs.
- Success means the final tree matches, not that the split reused the original commit boundaries.
- Large commits often mix groundwork and behavior changes. Pull groundwork into earlier commits even when the original history did not.
- If a rename or delete is involved, stage the full logical move in one commit. Partial staging around renames can create misleading diffs.
- Worktree creation can fail for path or permission reasons. Retry in a writable sibling directory instead of falling back to rewriting the source branch.
- Intermediate commits may fail hooks. Do not distort the review split just to satisfy partial-state hooks.
- This skill is for reviewer comprehension, not archaeology. Choose the split that makes the review easiest to reason about.
