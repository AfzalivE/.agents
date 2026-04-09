---
name: daily-agenda
description: Retrieve the active daily agenda against the current local time. Use when the user asks for today's agenda, says "agenda now", asks what they should be doing now or next, asks where they are in the schedule, or wants a concise current-block recap. Prefer this over re-triaging Twist, GitHub, Todoist, calendar, or the wider repo unless the user explicitly asks to replan.
---

# Daily Agenda

Use the active daily agenda as the execution source of truth for the current day.

## Behavior

1. Run `node "$HOME/.agents/skills/daily-agenda/scripts/agenda-now.js"` first.
2. Use the script output as the default source of truth for:
   - current local time
   - active daily note path
   - current block
   - next block
   - remaining blocks
3. Answer tersely unless the user asks for more. Default shape:
   - current local time
   - current block, or the gap before the next block
   - next block
   - remaining major blocks
   - whether the user is on-plan, slightly slipped, or explicitly off-plan
4. If the user asks to adjust the day, update the active daily note after incorporating the new timing or constraints.
5. Only broaden beyond the agenda when the user explicitly asks to replan or re-triage. Until then, do not inspect Twist, GitHub, Todoist, calendar, or the wider repo.

## Fallback

- If the script cannot find today's note, read `~/.agents/agent-brain/Agenda MOC.md` and the active `Daily/YYYY-MM-DD.md` note directly.
- If no active agenda exists, then fall back to the normal morning-triage or day-planning workflow.

## Gotchas

- Do not turn "what should I do now?" into a fresh inbox sweep.
- A schedule slip is not a reprioritization. Keep the plan intact unless the user changes it.
- Use the current local time, not stale timestamps from earlier chat messages.
- When a block has already ended, say so directly and move to the next block rather than pretending the user is still in it.
