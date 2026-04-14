# Naming and cleanup

## Default naming

- Split branch: `<source>-split`
- If that already exists, prefer a small numeric suffix such as `<source>-split-2`
- Worktree path: use a writable sibling directory whose basename matches the split branch

## Cleanup

Do not clean up automatically unless the user asks.

When the user is done reviewing:

```bash
cd <outside-the-worktree>
git worktree remove <worktree-path>
git branch -D <split-branch>
```

If the worktree directory was deleted manually:

```bash
git worktree prune
```

## Notes

- Keep the original branch checked out elsewhere for easy comparison.
- Prefer deleting the temporary branch only after the user confirms the review is complete.
