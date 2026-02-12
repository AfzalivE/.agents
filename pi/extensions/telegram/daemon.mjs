import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import process from "node:process";
import TelegramBot from "node-telegram-bot-api";

const AGENT_DIR = path.join(os.homedir(), ".pi", "agent");
const RUN_DIR = path.join(AGENT_DIR, "run");
const SOCKET_PATH = path.join(RUN_DIR, "telegram.sock");
const CONFIG_DIR = path.join(AGENT_DIR, "telegram");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

const TELEGRAM_COMMANDS = [
  { command: "pin", description: "Pair this chat with pi using a 6-digit PIN" },
  { command: "windows", description: "List connected pi windows" },
  { command: "window", description: "Switch active window: /window N" },
  { command: "esc", description: "Abort current run in active window" },
  { command: "steer", description: "Interrupt active window: /steer <message>" },
  { command: "unpair", description: "Unpair Telegram and disconnect all windows" },
  { command: "help", description: "Show available commands" },
];

async function loadConfig() {
  try {
    const raw = await fsp.readFile(CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveConfig(cfg) {
  await fsp.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const tmp = CONFIG_PATH + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
  await fsp.rename(tmp, CONFIG_PATH);
}

function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function makeJsonlWriter(socket) {
  return (obj) => {
    try {
      socket.write(JSON.stringify(obj) + "\n");
    } catch {
      // ignore
    }
  };
}

function chunkText(text, max = 3500) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + max));
    i += max;
  }
  return chunks;
}

let config = await loadConfig();
if (!config || !config.botToken) {
  console.error(`[telegram] Missing botToken in ${CONFIG_PATH}.`);
  process.exit(1);
}

let bot = null;

const windows = new Map();
let nextWindowNo = 1;

let pairedChatId = config.pairedChatId;

const chatState = {
  activeWindowId: undefined,
  lastSeenSeqByWindowId: {},
};

const pendingPins = new Map();

let shutdownTimer = null;
let typingTimer = null;
let server = null;
let shuttingDown = false;

function isAuthorizedChat(chatId) {
  return pairedChatId !== undefined && chatId === pairedChatId;
}

function getActiveWindow() {
  if (!chatState.activeWindowId) return null;
  return windows.get(chatState.activeWindowId) ?? null;
}

function stopTypingIndicator() {
  if (typingTimer) {
    clearInterval(typingTimer);
    typingTimer = null;
  }
}

function startTypingIndicator() {
  if (typingTimer) return;

  const tick = async () => {
    if (!bot || !pairedChatId) return;
    try {
      await bot.sendChatAction(pairedChatId, "typing");
    } catch {
      // ignore
    }
  };

  void tick();
  typingTimer = setInterval(() => {
    void tick();
  }, 4000);
}

function updateTypingIndicator() {
  const w = getActiveWindow();
  if (!pairedChatId || !w || !w.busy) {
    stopTypingIndicator();
    return;
  }
  startTypingIndicator();
}

async function setPairedChatId(chatId) {
  pairedChatId = chatId;
  config = { ...config, pairedChatId: chatId };
  await saveConfig(config);
  updateTypingIndicator();
}

async function clearPairing() {
  pairedChatId = undefined;
  delete config.pairedChatId;
  await saveConfig(config);
  chatState.activeWindowId = undefined;
  chatState.lastSeenSeqByWindowId = {};
  updateTypingIndicator();
}

function disconnectAllWindows() {
  for (const w of [...windows.values()]) {
    try {
      w.socket.end();
    } catch {}
    try {
      w.socket.destroy();
    } catch {}
  }
  windows.clear();
  chatState.activeWindowId = undefined;
}

async function shutdownDaemon({ clearPairingState = false } = {}) {
  if (shuttingDown) return;
  shuttingDown = true;
  cancelShutdown();

  if (clearPairingState) {
    try {
      await clearPairing();
    } catch {}
  }

  stopTypingIndicator();
  disconnectAllWindows();

  try {
    await bot?.stopPolling();
  } catch {}

  if (server) {
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };

      try {
        server.close(() => finish());
      } catch {
        finish();
      }

      setTimeout(finish, 200);
    });
  }

  try {
    fs.unlinkSync(SOCKET_PATH);
  } catch {}

  process.exit(0);
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function botSend(chatId, text, opts = {}) {
  if (!bot) return;
  const chunks = chunkText(text);
  for (const c of chunks) {
    await bot.sendMessage(chatId, c, opts);
  }
}

async function botSendAssistant(chatId, text) {
  if (!bot) return;

  // Telegram Markdown is a subset and chunking can break formatting.
  // Keep it simple:
  // - short messages: try Markdown, fallback to plain text if Telegram rejects it
  // - long messages: send as plain text chunks
  if (text.length <= 3500) {
    try {
      await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
      return;
    } catch {
      // fall back
    }
  }

  await botSend(chatId, text);
}

async function botSendSystem(chatId, text) {
  if (!bot) return;
  // Keep system messages short; avoid chunking to not split HTML entities/tags.
  const safe = escapeHtml(text);
  await bot.sendMessage(chatId, `<i>${safe}</i>`, { parse_mode: "HTML" });
}

async function syncBotCommands() {
  if (!bot) return;
  try {
    await bot.setMyCommands(TELEGRAM_COMMANDS);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[telegram] Failed to sync bot commands: ${message}`);
  }
}

function listWindowsText() {
  const list = [...windows.values()].sort((a, b) => a.windowNo - b.windowNo);
  if (list.length === 0) return "No windows connected. Run /telegram pair in a pi window.";

  const lines = [];
  for (const w of list) {
    const active = chatState.activeWindowId === w.windowId ? " *" : "";
    const lastSeen = chatState.lastSeenSeqByWindowId[w.windowId] ?? 0;
    const unread = (w.lastTurnSeq ?? 0) - lastSeen;
    const unreadStr = unread > 0 ? ` [${unread} unread]` : "";
    const name = w.sessionName || path.basename(w.cwd || "") || "(unknown)";
    lines.push(`${w.windowNo}) ${name}${active}${unreadStr}`);
  }
  return "Windows:\n" + lines.join("\n") + "\n\nUse /window N to switch.";
}

async function switchWindow(chatId, windowNo) {
  const target = [...windows.values()].find((w) => w.windowNo === windowNo);
  if (!target) {
    await botSend(chatId, `No such window: ${windowNo}. Use /windows.`);
    return;
  }

  chatState.activeWindowId = target.windowId;
  chatState.lastSeenSeqByWindowId[target.windowId] = target.lastTurnSeq ?? 0;
  updateTypingIndicator();

  const name = target.sessionName || path.basename(target.cwd || "") || "(unknown)";
  await botSendSystem(chatId, `Switched to window ${target.windowNo}: ${name}`);

  if (target.lastTurnText) {
    await botSendAssistant(chatId, target.lastTurnText);
  } else {
    await botSendSystem(chatId, "(No completed turns yet in this window.)");
  }
}

function sendToActiveWindow(msg) {
  const w = getActiveWindow();
  if (!w) return false;
  const send = makeJsonlWriter(w.socket);
  send(msg);
  return true;
}

async function handleTelegramMessage(msg) {
  const chatId = msg.chat?.id;
  if (!chatId) return;

  const text = msg.text ?? "";
  if (!text) return;

  const pinMatch = text.match(/^\/pin\s+(\d{6})\s*$/);
  if (pinMatch) {
    const code = pinMatch[1];
    if (pairedChatId && pairedChatId !== chatId) {
      await botSend(chatId, "This bot is already paired with another chat.");
      return;
    }

    const pending = pendingPins.get(code);
    if (!pending) {
      await botSend(chatId, "Invalid or expired PIN. Run /telegram pair in pi to generate a new one.");
      return;
    }
    if (Date.now() > pending.expiresAt) {
      pendingPins.delete(code);
      await botSend(chatId, "PIN expired. Run /telegram pair in pi to generate a new one.");
      return;
    }

    await setPairedChatId(chatId);
    pendingPins.delete(code);

    if (pending.windowId && windows.has(pending.windowId)) {
      chatState.activeWindowId = pending.windowId;
      const w = windows.get(pending.windowId);
      chatState.lastSeenSeqByWindowId[pending.windowId] = w.lastTurnSeq ?? 0;
    }

    updateTypingIndicator();

    await botSend(chatId, "Paired successfully. Use /windows to list windows.");
    return;
  }

  if (!isAuthorizedChat(chatId)) {
    await botSend(chatId, "Not paired. Run /telegram pair in pi to generate a PIN, then send /pin <PIN> here.");
    return;
  }

  if (text === "/help") {
    await botSend(
      chatId,
      "telegram commands:\n/windows - list windows\n/window N - switch active window\n/unpair - unpair Telegram and disconnect all windows\n/esc - abort current agent run in active window\n/steer <msg> - interrupt (steer) active window\n(plain text) - send to active window (queued as follow-up if busy)\n",
    );
    return;
  }

  if (text === "/windows") {
    await botSend(chatId, listWindowsText());
    return;
  }

  const winMatch = text.match(/^\/window\s+(\d+)\s*$/);
  if (winMatch) {
    const n = Number(winMatch[1]);
    await switchWindow(chatId, n);
    return;
  }

  if (text === "/unpair") {
    try {
      await botSendSystem(chatId, "Unpaired Telegram. All windows disconnected. Run /telegram pair in pi to pair again.");
    } catch {
      // ignore
    }
    await shutdownDaemon({ clearPairingState: true });
    return;
  }

  if (text === "/esc") {
    const sent = sendToActiveWindow({ type: "abort" });
    if (!sent) await botSend(chatId, "No active window. Use /windows then /window N.");
    return;
  }

  const steerMatch = text.match(/^\/steer\s+([\s\S]+)$/);
  if (steerMatch) {
    const msgText = steerMatch[1].trim();
    if (!msgText) {
      await botSend(chatId, "Usage: /steer <message>");
      return;
    }
    const sent = sendToActiveWindow({ type: "inject", mode: "steer", text: msgText });
    if (!sent) await botSend(chatId, "No active window. Use /windows then /window N.");
    return;
  }

  if (text.startsWith("/")) {
    await botSend(chatId, "Unknown command. Use /help.");
    return;
  }

  const sent = sendToActiveWindow({ type: "inject", mode: "followUp", text });
  if (!sent) {
    await botSend(chatId, "No active window. Use /windows then /window N.");
  }
}


async function maybeShutdownSoon() {
  if (windows.size > 0) return;
  if (shutdownTimer || shuttingDown) return;

  shutdownTimer = setTimeout(() => {
    shutdownTimer = null;
    if (windows.size > 0 || shuttingDown) return;
    console.error("[telegram] No clients connected, shutting down.");
    shutdownDaemon().catch(() => {});
  }, 60_000);
}

function cancelShutdown() {
  if (shutdownTimer) {
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
  }
}

async function startServer() {
  await fsp.mkdir(RUN_DIR, { recursive: true, mode: 0o700 });

  if (fs.existsSync(SOCKET_PATH)) {
    const ok = await new Promise((resolve) => {
      const s = net.connect(SOCKET_PATH);
      s.on("connect", () => {
        s.end();
        resolve(true);
      });
      s.on("error", () => resolve(false));
    });
    if (ok) {
      console.error("[telegram] Daemon already running.");
      process.exit(0);
    }
    try {
      fs.unlinkSync(SOCKET_PATH);
    } catch {}
  }

  const srv = net.createServer((socket) => {
    cancelShutdown();

    socket.setEncoding("utf8");
    const send = makeJsonlWriter(socket);

    let buf = "";
    let windowId;

    socket.on("data", (data) => {
      buf += data;
      while (true) {
        const idx = buf.indexOf("\n");
        if (idx === -1) break;
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        const msg = safeJsonParse(line);
        if (!msg || typeof msg.type !== "string") continue;

        switch (msg.type) {
          case "register": {
            windowId = msg.windowId || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            const existing = windows.get(windowId);
            const windowNo = existing?.windowNo ?? nextWindowNo++;
            windows.set(windowId, {
              windowId,
              windowNo,
              socket,
              cwd: msg.cwd,
              sessionName: msg.sessionName,
              busy: !!msg.busy,
              lastTurnText: existing?.lastTurnText,
              lastTurnSeq: existing?.lastTurnSeq ?? 0,
            });
            send({
              type: "registered",
              windowNo,
            });
            updateTypingIndicator();
            break;
          }

          case "meta": {
            if (!windowId) break;
            const w = windows.get(windowId);
            if (!w) break;
            w.cwd = msg.cwd ?? w.cwd;
            w.sessionName = msg.sessionName ?? w.sessionName;
            w.busy = !!msg.busy;
            if (chatState.activeWindowId === windowId) updateTypingIndicator();
            break;
          }

          case "request_pin": {
            if (!windowId) {
              send({ type: "error", error: "not_registered" });
              break;
            }
            let code;
            for (let i = 0; i < 10; i++) {
              code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
              if (!pendingPins.has(code)) break;
            }
            const expiresAt = Date.now() + 60_000;
            pendingPins.set(code, { windowId, expiresAt });

            const cleanupTimer = setTimeout(() => {
              const pending = pendingPins.get(code);
              if (pending && pending.expiresAt <= Date.now()) {
                pendingPins.delete(code);
              }
            }, 60_000);
            cleanupTimer.unref?.();

            send({ type: "pin", code, expiresAt });
            break;
          }

          case "shutdown": {
            shutdownDaemon({ clearPairingState: true }).catch(() => {});
            break;
          }

          case "turn_end": {
            if (!windowId) break;
            const w = windows.get(windowId);
            if (!w) break;
            const text = typeof msg.text === "string" ? msg.text : "";
            if (!text.trim()) break;

            w.lastTurnText = text;
            w.lastTurnSeq = (w.lastTurnSeq ?? 0) + 1;

            if (pairedChatId) {
              if (chatState.activeWindowId === windowId) {
                chatState.lastSeenSeqByWindowId[windowId] = w.lastTurnSeq;
                botSendAssistant(pairedChatId, text).catch(() => {});
              } else {
                botSendSystem(pairedChatId, `[window ${w.windowNo}] new reply available (use /window ${w.windowNo})`).catch(() => {});
              }
            }
            break;
          }

          default:
            break;
        }
      }
    });

    socket.on("close", () => {
      if (windowId) {
        const w = windows.get(windowId);
        if (w && w.socket === socket) {
          windows.delete(windowId);
          if (chatState.activeWindowId === windowId) {
            chatState.activeWindowId = undefined;
          }
        }
      }
      updateTypingIndicator();
      maybeShutdownSoon().catch(() => {});
    });

    socket.on("error", () => {
      // handled by close
    });
  });

  await new Promise((resolve, reject) => {
    const onErr = (e) => {
      srv.off("listening", onListen);
      reject(e);
    };
    const onListen = () => {
      srv.off("error", onErr);
      resolve();
    };
    srv.once("error", onErr);
    srv.once("listening", onListen);
    srv.listen(SOCKET_PATH);
  });

  try {
    fs.chmodSync(SOCKET_PATH, 0o600);
  } catch {}

  return srv;
}

server = await startServer();

// Start bot polling only after we've acquired the single-instance socket.
bot = new TelegramBot(config.botToken, { polling: true });
void syncBotCommands();
bot.on("message", (msg) => {
  handleTelegramMessage(msg).catch((e) => console.error("[telegram] telegram handler error", e));
});
updateTypingIndicator();

process.on("SIGINT", () => {
  shutdownDaemon().catch(() => {});
});

process.on("SIGTERM", () => {
  shutdownDaemon().catch(() => {});
});

console.error(`[telegram] Daemon running. Socket: ${SOCKET_PATH}`);
