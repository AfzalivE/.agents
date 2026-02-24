---
name: git-worktree
description: "Manage git worktrees for working on multiple branches simultaneously in separate directories."
---

# Git Worktree

Use this skill to manage git worktrees, allowing you to check out multiple branches of the same repository simultaneously in different directories.

## Common Operations

### List Worktrees

To see all existing worktrees:

```bash
git worktree list
```

This shows:
- The main working tree
- All linked worktrees
- Their paths and current branches

### Create a New Worktree

**Basic creation:**
```bash
git worktree add <path> <branch>
```

**Create with a new branch:**
```bash
git worktree add <path> -b <new-branch>
```

**Create from a specific commit or branch:**
```bash
git worktree add <path> -b <new-branch> <start-point>
```

**Common patterns:**
- `git worktree add ../feature-foo -b feature-foo` - Create new branch in sibling directory
- `git worktree add ../hotfix -b hotfix/urgent main` - Branch from main
- `git worktree add ../review pr-123` - Check out existing branch for review

Rules:
- Worktree paths should be outside the main repository (typically sibling directories)
- Each worktree must use a different branch (can't check out same branch twice)
- Use descriptive directory names that match the branch name

### Remove a Worktree

When you're done with a worktree:

1. **Navigate out of the worktree if you're in it**
2. **Remove the worktree:**
   ```bash
   git worktree remove <path>
   ```

**Force removal (if there are uncommitted changes):**
```bash
git worktree remove --force <path>
```

**Alternative: Delete directory first, then prune:**
```bash
rm -rf <path>
git worktree prune
```

Rules:
- Always commit or stash changes before removing
- Use `--force` only when you're certain you want to discard changes
- Clean up after yourself to avoid stale entries

### Prune Stale Worktrees

If worktree directories were deleted manually, clean up the references:

```bash
git worktree prune
```

This removes administrative files for worktrees that no longer exist.

### Move a Worktree

To relocate a worktree:

```bash
git worktree move <old-path> <new-path>
```

### Repair Worktrees

If administrative files get corrupted:

```bash
git worktree repair
```

## Common Workflows

### Working on Multiple Features

1. **List current worktrees to see what exists:**
   ```bash
   git worktree list
   ```

2. **Create worktrees for each feature:**
   ```bash
   git worktree add ../feature-a -b feature-a
   git worktree add ../feature-b -b feature-b
   ```

3. **Switch between features by changing directories:**
   ```bash
   cd ../feature-a  # Work on feature A
   cd ../feature-b  # Work on feature B
   ```

4. **Clean up when done:**
   ```bash
   git worktree remove ../feature-a
   git worktree remove ../feature-b
   ```

### Code Review

1. **Create temporary worktree for PR review:**
   ```bash
   git fetch origin pull/123/head:pr-123
   git worktree add ../review-pr-123 pr-123
   ```

2. **Review the code:**
   ```bash
   cd ../review-pr-123
   # Review, test, run builds
   ```

3. **Clean up after review:**
   ```bash
   cd <back-to-main-worktree>
   git worktree remove ../review-pr-123
   git branch -D pr-123  # Delete the temporary branch
   ```

### Hotfix While Working on Feature

1. **You're working on a feature branch, but need to create a hotfix:**
   ```bash
   git worktree add ../hotfix -b hotfix/critical-bug main
   ```

2. **Work on hotfix in the new worktree:**
   ```bash
   cd ../hotfix
   # Fix the bug, commit
   git push origin hotfix/critical-bug
   ```

3. **Return to feature work:**
   ```bash
   cd <back-to-feature-worktree>
   ```

4. **Clean up hotfix worktree:**
   ```bash
   git worktree remove ../hotfix
   ```

## Best Practices

1. **Naming Convention:** Use directory names that match branch names for clarity
2. **Location:** Keep worktrees in a sibling directory to the main repo (e.g., `../feature-name`)
3. **Cleanup:** Always remove worktrees when done to avoid clutter
4. **Branch Conflicts:** Remember that a branch can only be checked out in one worktree at a time
5. **Shared Objects:** Worktrees share the same `.git/objects`, so they're space-efficient
6. **Commit Often:** Since worktrees are isolated, commit frequently in each to avoid losing work

## Troubleshooting

**Error: "fatal: '<branch>' is already checked out at '<path>'"**
- Solution: You can't check out the same branch in multiple worktrees. Use a different branch or remove the existing worktree first.

**Error: "fatal: '<path>' already exists"**
- Solution: Choose a different path or remove the existing directory.

**Stale worktree references after manual deletion:**
- Solution: Run `git worktree prune` to clean up administrative files.

**Can't remove worktree with uncommitted changes:**
- Solution: Either commit/stash changes first, or use `git worktree remove --force` if you want to discard them.

## Integration with Other Tools

When using worktrees, be aware:
- **VSCode/IDEs:** Open each worktree as a separate workspace
- **Shell Environment:** Each worktree is independent, so tools like nvm, virtualenv work per-worktree
- **Build Artifacts:** Each worktree has its own working directory, so builds are isolated
- **Git Hooks:** Hooks in `.git/hooks` are shared across all worktrees

## Safety Rules

- Never manually edit files in `.git/worktrees/` - use git commands only
- Always be in a safe directory (not inside the worktree) when removing it
- Check `git status` before removing to ensure no uncommitted work
- Use `git worktree list` regularly to track active worktrees
