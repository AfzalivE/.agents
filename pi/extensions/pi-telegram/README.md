# pi-telegram (prototype)

A pi extension + local daemon that lets you interact with pi via a Telegram bot.

## Install

Dependencies:

```bash
cd "$HOME/.agents/pi/extensions/pi-telegram"
npm install
```

## Config

Stored at:

- `~/.pi/agent/pi-telegram/config.json`

Example:

```json
{
  "botToken": "123:abc...",
  "pairedChatId": 123456789
}
```

## Usage (in pi)

- Pair/connect this pi window:

```text
/telegram pair
```

First time:
- pi will ask for the bot token and save it (one time)
- pi will show a 6-digit PIN

- Status:

```text
/telegram status
```

- Unpair (clears paired chat id):

```text
/telegram unpair
```

- Disconnect this pi window (removes it from Telegram `/windows`):

```text
/telegram stop
```

## Usage (in Telegram)

- `/pin 123456` – complete pairing of the current pi window (6-digit PIN from `/telegram pair`)

Once paired:

- `/windows` – list connected pi windows
- `/window N` – switch active window and replay its last completed turn
- `/unpair` – disconnect the active window (removes it from `/windows`)
- `/esc` – abort current run in the active window
- `/steer <message>` – interrupt (steer) the active window
- plain text – send to active window (queued as follow-up if the agent is busy)

## Notes

- The daemon is started on-demand by `/telegram pair` and auto-stops ~60s after the last window disconnects.
- Output mirrored to Telegram is the assistant’s final text at `turn_end` (no tool output in this first version).
  - For short messages we try Telegram `Markdown` formatting; if Telegram rejects the formatting, we fall back to plain text.
  - Long messages are sent as plain text chunks.
- System/daemon messages (e.g. window switch notifications) are sent in italics.
- While the active window is busy (agent running), the daemon sends Telegram `typing…` chat actions periodically.
