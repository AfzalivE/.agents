---
name: cald
description: "Apple Calendar CLI for listing calendars, reading events, and creating events through macOS EventKit. Use when inspecting Apple Calendar data on this Mac or adding calendar events from the command line."
---

# Apple Calendar CLI (`cald`)

`cald` reads and creates events in Apple Calendar through macOS EventKit. It works against the calendars already configured on this Mac.

## Global Notes

- Add `--json` for machine-readable output. `calendars` and `events` return plain arrays; `event` and `create` return a single object.
- Supported date inputs include `today`, `tomorrow`, `yesterday`, relative offsets like `+3`, date-only values like `2026-04-09`, and local/ISO date-times.
- Use `--date` for a single-day query. Use `--from` and `--to` for ranges.
- Creating events writes immediately to Apple Calendar. Confirm with the user before making changes that will sync externally.

## Quick Reference

| Task | Command |
|------|---------|
| List calendars | `cald calendars` |
| List calendars as JSON | `cald calendars --json` |
| Show today's events | `cald events --date today` |
| Show a range | `cald events --from today --to +7` |
| Filter by calendar | `cald events --date today --calendar Work` |
| Text search events | `cald events --date today --filter "standup"` |
| Show raw IDs | `cald events --date today --id` |
| Get one event | `cald event <id>` |
| Create event | `cald create --title "..." --start ... --end ...` |
| Create all-day event | `cald create --title "..." --start 2026-04-09 --end 2026-04-10 --all-day` |

## Common Workflows

### Inspect available calendars

```bash
cald calendars --json | jq '.[] | {title, source, allowsModification, type}'
```

Use this before creating events if calendar names are ambiguous or you need to avoid read-only calendars.

### Read events

```bash
cald events --date today --json
cald events --from today --to +14 --calendar Work --json
cald events --date tomorrow --filter "1:1" --limit 10 --json
```

`events` defaults to the next 7 days across all calendars, so narrow aggressively when the user asks calendar-specific questions.

### Create events

```bash
cald create --title "Team Standup" \
  --start 2026-04-09T09:00:00 \
  --end 2026-04-09T09:30:00 \
  --calendar Work \
  --url "https://meet.example.com/standup"
```

```bash
cald create --title "Vacation" \
  --start 2026-08-10 \
  --end 2026-08-15 \
  --all-day \
  --calendar Home
```

## Gotchas

- `events` searches all calendars by default, including subscriptions, birthdays, and holiday calendars. That often adds noise or duplicate-looking entries; use `--calendar` and `--filter`.
- `--calendar` matches calendar titles, not IDs. Matching is case-insensitive, but duplicate titles across accounts can still be ambiguous. Inspect `source` and `allowsModification` first with `cald calendars --json`.
- `create` has no `--dry-run`. It writes immediately and may sync to Google, iCloud, Exchange, or other connected accounts.
- For all-day events, prefer date-only `--start` and `--end` values together with `--all-day`.
- `cald event <number>` is convenient for ad hoc terminal use, but it depends on the last numbered `cald events` listing. For automation, prefer the raw `id` from `cald events --json`.
- Event detail lookups can surface raw macOS EventKit/XPC failures, including `Mach error 4099`. If `cald event` fails, retry with the raw event ID and fall back to `cald events --json` if you only need summary fields.
