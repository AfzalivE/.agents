---
name: oracle
description: Get a second opinion by bundling a prompt + a curated file set, then asking another powerful LLM for debugging, refactor advice, design checks, or cross-validation.
---

# Oracle (cross-agent)

Use this skill when you want a fast “second brain” pass from the other agent:

- **In Codex**: bundle context, then ask **Claude CLI** (Opus 4.5) for review.
- **In Claude**: bundle context, then ask **Codex CLI** (GPT‑5.2, `xhigh` reasoning) for review.

This skill uses a tiny local bundler script.

## Workflow

1. Pick the smallest file set that contains the truth (avoid secrets by default).
2. Verify the selected files / bundle look right.
3. Run the Oracle script for your current agent.

## Commands

- When running in **Codex**:
  - Preview selection: `"$HOME/.agents/skills/oracle/scripts/oracle-bundle" --dry-run -p "<task>" --file "src/**" --file "!**/*.test.*"`
  - Preview bundle: `"$HOME/.agents/skills/oracle/scripts/oracle-bundle" -p "<task>" --file "src/**" --file "!**/*.test.*"`
  - Run: `"$HOME/.agents/skills/oracle/scripts/oracle-to-claude" -p "<task>" --file "src/**" --file "!**/*.test.*"`

- When running in **Claude** or any other agent:
  - Preview selection: `"$HOME/.agents/skills/oracle/scripts/oracle-bundle" --dry-run -p "<task>" --file "src/**" --file "!**/*.test.*"`
  - Preview bundle: `"$HOME/.agents/skills/oracle/scripts/oracle-bundle" -p "<task>" --file "src/**" --file "!**/*.test.*"`
  - Run: `"$HOME/.agents/skills/oracle/scripts/oracle-to-codex" -p "<task>" --file "src/**" --file "!**/*.test.*"`

## Tips

- Prefer a minimal file set over “whole repo”.
- If you need diffs reviewed, paste the diff into the prompt or attach the diff file via `--file`.
- Make the prompt completely standalone: include error text, constraints, and the desired output format (plan vs patch vs pros/cons).
- Never include secrets (`.env`, tokens, key files).
