# telegram (prototype)

A pi extension + local daemon that lets you interact with pi via a Telegram bot.

## Install

Dependencies:

```bash
cd "$HOME/.agents/pi/extensions/telegram"
npm install
```

## Config

Stored at:

- `~/.pi/agent/telegram/config.json`

Example:

```json
{
  "botToken": "123:abc...",
  "pairedChatId": 123456789
}
```

## Usage (in pi)

- Pair Telegram globally (starts the daemon and registers this window):

```text
/telegram pair
```

First time:
- pi will ask for the bot token and save it (one time)
- pi will show a 6-digit PIN

Once paired, all open pi windows auto-register and appear in Telegram `/windows`.

- Status:

```text
/telegram status
```

- Unpair globally (revokes Telegram pairing and disconnects all windows):

```text
/telegram unpair
```

## Usage (in Telegram)

- `/pin 123456` – complete global pairing (6-digit PIN from `/telegram pair`)

Once paired:

- `/windows` – list connected pi windows
- `/window N` – switch active window and replay its last completed turn
- `/unpair` – unpair Telegram and disconnect all windows
- `/esc` – abort current run in the active window
- `/steer <message>` – interrupt (steer) the active window
- plain text – send to active window (queued as follow-up if the agent is busy)

## Notes

- The daemon is started on-demand by `/telegram pair`, auto-restarts when a paired window opens, and auto-stops ~60s after the last window disconnects.
- While paired, all open pi windows auto-register with Telegram `/windows`.
- Output mirrored to Telegram is the assistant’s final text at `turn_end` (no tool output in this first version).
  - For short messages we try Telegram `Markdown` formatting; if Telegram rejects the formatting, we fall back to plain text.
  - Long messages are sent as plain text chunks.
- System/daemon messages (e.g. window switch notifications) are sent in italics.
- While the active window is busy (agent running), the daemon sends Telegram `typing…` chat actions periodically.
