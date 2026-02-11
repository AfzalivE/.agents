import { BorderedLoader, type ExtensionAPI, type ExtensionContext, type ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fsp from "node:fs/promises";
import { spawn } from "node:child_process";

type DaemonToClientMessage =
  | { type: "registered"; windowId: string; windowNo: number; pairedChatId: number | null; activeWindowNo: number | null }
  | { type: "pin"; code: string; expiresAt: number }
  | { type: "pong" }
  | { type: "ok" }
  | { type: "error"; error: string }
  | { type: "inject"; mode: "followUp" | "steer"; text: string }
  | { type: "abort" };

type ClientToDaemonMessage =
  | { type: "register"; windowId: string; cwd: string; sessionName?: string; busy: boolean }
  | { type: "meta"; cwd: string; sessionName?: string; busy: boolean }
  | { type: "request_pin" }
  | { type: "unpair" }
  | { type: "turn_end"; text: string }
  | { type: "ping" };

type Config = {
  botToken?: string;
  pairedChatId?: number;
};

const AGENT_DIR = path.join(os.homedir(), ".pi", "agent");
const RUN_DIR = path.join(AGENT_DIR, "run");
const SOCKET_PATH = path.join(RUN_DIR, "telegram.sock");
const CONFIG_DIR = path.join(AGENT_DIR, "telegram");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error("Cancelled"));
    };

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };

    if (!signal) return;
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error("Cancelled");
  }
}

async function runWithLoader<T>(
  ctx: ExtensionContext,
  message: string,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<{ cancelled: boolean; value?: T; error?: string }> {
  if (!ctx.hasUI) {
    const controller = new AbortController();
    try {
      const value = await task(controller.signal);
      return { cancelled: false, value };
    } catch (error) {
      return {
        cancelled: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const result = await ctx.ui.custom<{ cancelled: boolean; value?: T; error?: string }>((tui, theme, _kb, done) => {
    const loader = new BorderedLoader(tui, theme, message);
    let settled = false;
    const finish = (value: { cancelled: boolean; value?: T; error?: string }) => {
      if (settled) return;
      settled = true;
      done(value);
    };

    loader.onAbort = () => finish({ cancelled: true });

    task(loader.signal)
      .then((value) => finish({ cancelled: false, value }))
      .catch((error) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        finish({ cancelled: false, error: errorMessage });
      });

    return loader;
  });

  return result;
}

async function loadConfig(): Promise<Config> {
  try {
    const raw = await fsp.readFile(CONFIG_PATH, "utf8");
    return JSON.parse(raw) as Config;
  } catch {
    return {};
  }
}

async function saveConfig(cfg: Config): Promise<void> {
  await fsp.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const tmp = CONFIG_PATH + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
  await fsp.rename(tmp, CONFIG_PATH);
}

function parseArgs(args: string | undefined): string[] {
  if (!args) return [];
  const trimmed = args.trim();
  if (!trimmed) return [];
  return trimmed.split(/\s+/g);
}

function extractTextFromMessage(message: any): string {
  const content = message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (!c) return "";
        if (typeof c === "string") return c;
        if (c.type === "text" && typeof c.text === "string") return c.text;
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

function jsonlWrite(socket: net.Socket, msg: ClientToDaemonMessage) {
  socket.write(JSON.stringify(msg) + "\n");
}

function createJsonlReader(socket: net.Socket, onMessage: (msg: DaemonToClientMessage) => void) {
  socket.setEncoding("utf8");
  let buf = "";
  socket.on("data", (data: string) => {
    buf += data;
    while (true) {
      const idx = buf.indexOf("\n");
      if (idx === -1) break;
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg && typeof msg.type === "string") onMessage(msg as DaemonToClientMessage);
      } catch {
        // ignore
      }
    }
  });
}

async function canConnectSocket(): Promise<boolean> {
  return await new Promise((resolve) => {
    const s = net.connect(SOCKET_PATH);
    s.once("connect", () => {
      s.end();
      resolve(true);
    });
    s.once("error", () => resolve(false));
  });
}

async function ensureDaemonRunning(daemonPath: string, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await fsp.mkdir(RUN_DIR, { recursive: true, mode: 0o700 });

  throwIfAborted(signal);
  if (await canConnectSocket()) return;

  const child = spawn(process.execPath, [daemonPath], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();

  for (let i = 0; i < 40; i++) {
    throwIfAborted(signal);
    if (await canConnectSocket()) return;
    await sleep(100, signal);
  }

  throw new Error("Failed to start telegram daemon (socket not available)");
}

async function sendEphemeral(msg: ClientToDaemonMessage): Promise<void> {
  const socket = net.connect(SOCKET_PATH);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("error", (e) => reject(e));
  });
  socket.write(JSON.stringify(msg) + "\n");
  socket.end();
}

export default function (pi: ExtensionAPI) {
  const extensionDir = path.dirname(fileURLToPath(import.meta.url));
  const daemonPath = path.join(extensionDir, "daemon.mjs");

  const state = {
    socket: null as net.Socket | null,
    windowId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    windowNo: null as number | null,
    busy: false,
    lastCtx: null as ExtensionContext | null,
  };

  const daemonMessageHandlers = new Set<(msg: DaemonToClientMessage) => void>();

  function isConnected() {
    return !!(state.socket && !state.socket.destroyed && state.windowNo !== null);
  }

  function disconnect() {
    if (state.socket && !state.socket.destroyed) {
      try {
        state.socket.end();
      } catch {}
      try {
        state.socket.destroy();
      } catch {}
    }
    state.socket = null;
    state.windowNo = null;
  }

  function send(msg: ClientToDaemonMessage) {
    if (!state.socket || state.socket.destroyed) return;
    try {
      jsonlWrite(state.socket, msg);
    } catch {
      // ignore
    }
  }

  function updateMeta(ctx: ExtensionContext) {
    const sessionName = pi.getSessionName() ?? undefined;
    send({
      type: "meta",
      cwd: ctx.cwd,
      sessionName,
      busy: state.busy,
    });
  }

  async function connectPersistent(ctx: ExtensionContext, signal?: AbortSignal): Promise<void> {
    if (state.socket && !state.socket.destroyed) return;

    await ensureDaemonRunning(daemonPath, signal);
    throwIfAborted(signal);

    const socket = net.connect(SOCKET_PATH);

    await new Promise<void>((resolve, reject) => {
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onAbort = () => {
        cleanup();
        try {
          socket.destroy();
        } catch {}
        reject(new Error("Cancelled"));
      };
      const cleanup = () => {
        socket.off("connect", onConnect);
        socket.off("error", onError);
        signal?.removeEventListener("abort", onAbort);
      };

      socket.once("connect", onConnect);
      socket.once("error", onError);

      if (!signal) return;
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    });

    state.socket = socket;
    createJsonlReader(socket, handleDaemonMessage);

    socket.once("close", () => {
      disconnect();
      if (state.lastCtx?.hasUI) {
        state.lastCtx.ui.setStatus("telegram", undefined);
        state.lastCtx.ui.setWidget("telegram", undefined);
      }
    });

    socket.once("error", () => {
      disconnect();
      if (state.lastCtx?.hasUI) {
        state.lastCtx.ui.setStatus("telegram", undefined);
        state.lastCtx.ui.setWidget("telegram", undefined);
      }
    });

    jsonlWrite(socket, {
      type: "register",
      windowId: state.windowId,
      cwd: ctx.cwd,
      sessionName: pi.getSessionName() ?? undefined,
      busy: state.busy,
    });
  }

  async function requestPin(signal?: AbortSignal): Promise<{ code: string; expiresAt: number } | null> {
    if (!state.socket || state.socket.destroyed) return null;

    return await new Promise((resolve) => {
      const finish = (value: { code: string; expiresAt: number } | null) => {
        daemonMessageHandlers.delete(handler);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      };

      const handler = (msg: DaemonToClientMessage) => {
        if (msg.type === "pin") {
          finish({ code: msg.code, expiresAt: msg.expiresAt });
          return;
        }
        if (msg.type === "error") {
          finish(null);
        }
      };

      const onAbort = () => {
        finish(null);
      };

      if (signal) {
        if (signal.aborted) {
          finish(null);
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      daemonMessageHandlers.add(handler);
      send({ type: "request_pin" });
    });
  }

  function handleDaemonMessage(msg: DaemonToClientMessage) {
    for (const h of [...daemonMessageHandlers]) {
      try {
        h(msg);
      } catch {
        // ignore
      }
    }

    if (msg.type === "registered") {
      state.windowNo = msg.windowNo;
      if (state.lastCtx?.hasUI) {
        state.lastCtx.ui.setStatus("telegram", `telegram: connected (window ${msg.windowNo})`);
      }
      return;
    }

    if (msg.type === "inject") {
      const ctx = state.lastCtx;
      if (!ctx) return;
      const text = msg.text;
      if (!text) return;

      if (!ctx.isIdle()) {
        pi.sendUserMessage(text, { deliverAs: msg.mode });
      } else {
        pi.sendUserMessage(text);
      }
      return;
    }

    if (msg.type === "abort") {
      const ctx = state.lastCtx;
      if (!ctx) return;
      ctx.abort();
      return;
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    state.lastCtx = ctx;
  });
  pi.on("session_switch", async (_event, ctx) => {
    state.lastCtx = ctx;
    if (state.socket && !state.socket.destroyed) updateMeta(ctx);
  });

  pi.on("agent_start", async (_event, ctx) => {
    state.busy = true;
    if (state.socket && !state.socket.destroyed) updateMeta(ctx);
  });
  pi.on("agent_end", async (_event, ctx) => {
    state.busy = false;
    if (state.socket && !state.socket.destroyed) updateMeta(ctx);
  });

  pi.on("turn_end", async (event: any) => {
    if (!state.socket || state.socket.destroyed) return;
    const text = extractTextFromMessage(event.message);
    if (!text) return;
    send({ type: "turn_end", text });
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    disconnect();
    if (ctx.hasUI) {
      ctx.ui.setStatus("telegram", undefined);
      ctx.ui.setWidget("telegram", undefined);
    }
  });

  pi.registerCommand("telegram", {
    description: "Telegram bridge: /telegram pair | status | unpair | stop",
    handler: async (args, ctx: ExtensionCommandContext) => {
      const [sub] = parseArgs(args);

      const notify = (text: string, level: "info" | "warning" | "error" = "info") => {
        if (ctx.hasUI) ctx.ui.notify(text, level);
      };

      if (!sub || sub === "help") {
        notify("Usage: /telegram pair | status | unpair | stop", "info");
        return;
      }

      if (sub === "status") {
        const cfg = await loadConfig();
        const tokenState = cfg.botToken ? "configured" : "missing";
        const paired = cfg.pairedChatId ? `paired (${cfg.pairedChatId})` : "unpaired";
        const daemonUp = await canConnectSocket();

        const lines = [
          `Config: token ${tokenState}, ${paired}`,
          `Daemon: ${daemonUp ? "running" : "not running"}`,
          `This window: ${isConnected() ? `connected (window ${state.windowNo})` : "not connected"}`,
        ];
        notify(lines.join("\n"), "info");
        return;
      }

      if (sub === "stop") {
        disconnect();
        if (ctx.hasUI) {
          ctx.ui.setStatus("telegram", undefined);
          ctx.ui.setWidget("telegram", undefined);
        }
        notify("Disconnected (this window removed from Telegram /windows).", "info");
        return;
      }

      if (sub === "unpair") {
        const cfg = await loadConfig();
        if (!cfg.botToken) {
          notify(`No bot token configured. Run /telegram pair first or edit ${CONFIG_PATH}.`, "error");
          return;
        }

        delete cfg.pairedChatId;
        await saveConfig(cfg);

        if (await canConnectSocket()) {
          try {
            await sendEphemeral({ type: "unpair" });
          } catch {
            // ignore
          }
        }

        notify("Unpaired. Next /telegram pair will show a new PIN.", "info");
        return;
      }

      if (sub === "pair") {
        const cfg = await loadConfig();
        if (!cfg.botToken) {
          if (!ctx.hasUI) {
            throw new Error(`Missing botToken. Create ${CONFIG_PATH} with {\"botToken\": \"...\"}.`);
          }
          const token = await ctx.ui.input(
            "Telegram bot token",
            "Paste the bot token (saved to ~/.pi/agent/telegram/config.json)",
          );
          if (!token) {
            notify("Cancelled.", "info");
            return;
          }
          await saveConfig({ ...cfg, botToken: token.trim() });
        }

        const connectResult = await runWithLoader(ctx, "Connecting to Telegram daemon...", (signal) =>
          connectPersistent(ctx, signal),
        );
        if (connectResult.cancelled) {
          notify("Cancelled.", "info");
          return;
        }
        if (connectResult.error) {
          notify(`Failed to connect: ${connectResult.error}`, "error");
          return;
        }

        updateMeta(ctx);

        const freshCfg = await loadConfig();
        if (!freshCfg.pairedChatId) {
          const pinResult = await runWithLoader(ctx, "Requesting Telegram pairing PIN...", (signal) =>
            requestPin(signal),
          );
          if (pinResult.cancelled) {
            notify("Cancelled.", "info");
            return;
          }
          if (pinResult.error) {
            notify(`Failed to request PIN: ${pinResult.error}`, "error");
            return;
          }

          const pin = pinResult.value;
          if (!pin) {
            notify("Failed to request PIN from daemon.", "error");
            return;
          }

          if (ctx.hasUI) {
            ctx.ui.notify(`Send this in Telegram: /pin ${pin.code} (valid 60s)`, "info");
            ctx.ui.setWidget("telegram", [
              `Telegram pairing: send /pin ${pin.code} (valid 60s)`,
              "After pairing, use /windows and /window N in Telegram.",
              "Use /telegram stop to disconnect this window.",
            ]);
          }
          return;
        }

        notify("Connected. Use Telegram /windows to list windows.", "info");
        return;
      }

      notify(`Unknown subcommand: ${sub}. Use /telegram help`, "error");
    },
  });
}
