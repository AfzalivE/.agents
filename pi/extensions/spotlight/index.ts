/**
 * Spotlight extension.
 *
 * What this extension does:
 * - /spotlight start launches a detached `spotlighter.sh` watcher from a linked
 *   git worktree.
 * - The watcher mirrors worktree changes into the main worktree/root.
 * - /spotlight stop stops the watcher and restores the main worktree to the
 *   checkpoint captured at start.
 *
 * Shutdown behavior:
 * - If Pi exits while spotlight is active, the exit hook stops the detached
 *   watcher, deletes the rollback checkpoint, and clears persisted state.
 * - It does not restore the main worktree, so the mirrored root state remains
 *   in place after quitting Pi.
 *
 * Commands:
 * - /spotlight start
 * - /spotlight stop
 * - /spotlight status
 */
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { createHash, randomUUID } from "node:crypto";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// --- Constants ---

const STATUS_KEY = "0-spotlight";
const STATE_VERSION = 1;
const STARTUP_WAIT_MS = 300;
const TERMINATION_WAIT_MS = 800;

const extensionDir = fileURLToPath(new URL(".", import.meta.url));
const checkpointerPath = join(extensionDir, "checkpointer.sh");
const spotlighterPath = join(extensionDir, "spotlighter.sh");
const piAgentDir = process.env.PI_CODING_AGENT_DIR
  ? resolve(process.env.PI_CODING_AGENT_DIR)
  : resolve(process.env.HOME ?? ".", ".pi", "agent");
const stateDir = join(piAgentDir, "spotlight");
const EXIT_HOOK_KEY = "__piSpotlightExitHookInstalled";

// --- Types ---

interface RepoInfo {
  currentRoot: string;
  targetRoot: string;
}

interface SpotlightState {
  version: number;
  sourceRoot: string;
  targetRoot: string;
  pid: number;
  ownerPid?: number;
  startedAt: string;
  rootCheckpointId: string;
  watchexecPath: string;
}

// --- Helpers ---

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tokenizeArgs(args: string): string[] {
  const trimmed = args.trim();
  return trimmed.length === 0 ? [] : trimmed.split(/\s+/g);
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// Hash the target root into a stable filename under ~/.pi/agent/spotlight/.
function stateFilePath(targetRoot: string): string {
  const key = createHash("sha256").update(targetRoot).digest("hex").slice(0, 16);
  return join(stateDir, `${key}.json`);
}

function parseState(raw: string): SpotlightState | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SpotlightState>;
    if (
      parsed.version !== STATE_VERSION ||
      typeof parsed.sourceRoot !== "string" ||
      typeof parsed.targetRoot !== "string" ||
      typeof parsed.pid !== "number" ||
      (parsed.ownerPid !== undefined && typeof parsed.ownerPid !== "number") ||
      typeof parsed.startedAt !== "string" ||
      typeof parsed.rootCheckpointId !== "string" ||
      typeof parsed.watchexecPath !== "string"
    ) {
      return null;
    }

    return {
      version: parsed.version,
      sourceRoot: parsed.sourceRoot,
      targetRoot: parsed.targetRoot,
      pid: parsed.pid,
      ownerPid: parsed.ownerPid,
      startedAt: parsed.startedAt,
      rootCheckpointId: parsed.rootCheckpointId,
      watchexecPath: parsed.watchexecPath,
    };
  } catch {
    return null;
  }
}

function loadState(targetRoot: string): SpotlightState | null {
  const path = stateFilePath(targetRoot);
  if (!existsSync(path)) return null;
  return parseState(readFileSync(path, "utf8"));
}

function saveState(state: SpotlightState): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(stateFilePath(state.targetRoot), `${JSON.stringify(state, null, 2)}\n`);
}

function deleteState(targetRoot: string): void {
  rmSync(stateFilePath(targetRoot), { force: true });
}

// Process exit only gives us synchronous cleanup.
function deleteCheckpointSync(cwd: string, checkpointId: string): void {
  try {
    execFileSync("git", ["update-ref", "-d", `refs/conductor-checkpoints/${checkpointId}`], {
      cwd,
      stdio: "ignore",
    });
  } catch {
    // Best effort cleanup only.
  }
}

// On process exit, stop the watcher and forget rollback state without restoring root.
function cleanupStateWithoutRestoreSync(state: SpotlightState): void {
  try {
    killProcessGroupSync(state.pid);
  } catch {
    // Best effort cleanup only.
  }

  deleteCheckpointSync(state.targetRoot, state.rootCheckpointId);
  deleteState(state.targetRoot);
}

function cleanupOwnedSpotlightsSync(ownerPid: number): void {
  if (!existsSync(stateDir)) return;

  for (const entry of readdirSync(stateDir)) {
    const path = join(stateDir, entry);

    try {
      const state = parseState(readFileSync(path, "utf8"));
      if (!state) {
        rmSync(path, { force: true });
        continue;
      }

      if (state.ownerPid !== ownerPid) continue;
      cleanupStateWithoutRestoreSync(state);
    } catch {
      rmSync(path, { force: true, recursive: true });
    }
  }
}

function installExitHook(): void {
  const globalState = globalThis as unknown as Record<string, boolean | undefined>;
  if (globalState[EXIT_HOOK_KEY]) return;

  process.on("exit", () => {
    cleanupOwnedSpotlightsSync(process.pid);
  });

  globalState[EXIT_HOOK_KEY] = true;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function killProcessGroup(pid: number): Promise<void> {
  try {
    process.kill(-pid, "SIGTERM");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ESRCH") throw error;
    return;
  }

  await sleep(TERMINATION_WAIT_MS);

  if (!isProcessAlive(pid)) return;

  killProcessGroupSync(pid);
}

function killProcessGroupSync(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ESRCH") throw error;
  }
}

function formatStatus(state: SpotlightState, active: boolean, ctx: ExtensionContext): string {
  const theme = ctx.ui.theme;
  const symbol = active ? theme.fg("accent", "●") : theme.fg("warning", "!");
  const label = active ? "spotlight" : "spotlight stale";
  const text = `${basename(state.sourceRoot)} → ${basename(state.targetRoot)}`;
  return `${symbol}${theme.fg("dim", ` ${label}: ${text}`)}`;
}

function updateStatus(ctx: ExtensionContext, state: SpotlightState | null): void {
  if (!ctx.hasUI) return;
  if (!state) {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    return;
  }

  ctx.ui.setStatus(STATUS_KEY, formatStatus(state, isProcessAlive(state.pid), ctx));
}

async function gitStdout(pi: ExtensionAPI, cwd: string, args: string[]): Promise<string | null> {
  const result = await pi.exec("git", args, { cwd });
  if (result.code !== 0) return null;
  const output = result.stdout.trim();
  return output.length > 0 ? output : null;
}

// The parent of the shared git common dir is the main worktree/root.
async function getRepoInfo(pi: ExtensionAPI, cwd: string): Promise<RepoInfo | null> {
  const currentRoot = await gitStdout(pi, cwd, [
    "rev-parse",
    "--path-format=absolute",
    "--show-toplevel",
  ]);
  const commonDir = await gitStdout(pi, cwd, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  if (!currentRoot || !commonDir) return null;

  return {
    currentRoot,
    targetRoot: dirname(commonDir),
  };
}

// watchexec is expected to be installed on PATH.
async function resolveWatchexecPath(pi: ExtensionAPI, cwd: string): Promise<string | null> {
  const shellResult = await pi.exec("bash", ["-lc", "command -v watchexec"], { cwd });
  const shellPath = shellResult.stdout.trim();
  return shellResult.code === 0 && shellPath.length > 0 ? shellPath : null;
}

async function saveCheckpoint(
  pi: ExtensionAPI,
  cwd: string,
  checkpointId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const result = await pi.exec(checkpointerPath, ["save", "--id", checkpointId, "--force"], {
    cwd,
  });
  if (result.code === 0) return { ok: true };
  if (result.code === 101) {
    return { ok: false, message: "Cannot checkpoint while a merge or rebase is in progress." };
  }

  const details = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
  return {
    ok: false,
    message: details.length > 0 ? details : "Failed to save checkpoint.",
  };
}

async function restoreCheckpoint(
  pi: ExtensionAPI,
  cwd: string,
  checkpointId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const result = await pi.exec(checkpointerPath, ["restore", checkpointId], { cwd });
  if (result.code === 0) return { ok: true };

  const details = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
  return {
    ok: false,
    message: details.length > 0 ? details : `Failed to restore checkpoint ${checkpointId}.`,
  };
}

async function deleteCheckpoint(
  pi: ExtensionAPI,
  cwd: string,
  checkpointId: string,
): Promise<void> {
  await pi.exec("git", ["update-ref", "-d", `refs/conductor-checkpoints/${checkpointId}`], { cwd });
}

async function syncStatus(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  const repo = await getRepoInfo(pi, ctx.cwd);
  if (!repo) {
    updateStatus(ctx, null);
    return;
  }

  const state = loadState(repo.targetRoot);
  if (!state) {
    updateStatus(ctx, null);
    return;
  }

  if (state.ownerPid === undefined && isProcessAlive(state.pid)) {
    // Older state files may lack ownership metadata; adopt them for exit cleanup.
    const adoptedState: SpotlightState = { ...state, ownerPid: process.pid };
    saveState(adoptedState);
    updateStatus(ctx, adoptedState);
    return;
  }

  updateStatus(ctx, state);
}

// --- Command handlers ---

async function handleStart(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const repo = await getRepoInfo(pi, ctx.cwd);
  if (!repo) throw new Error("/spotlight start must be run inside a git repository.");
  if (repo.currentRoot === repo.targetRoot) {
    throw new Error(
      "/spotlight start must be run from a linked git worktree, not the main worktree.",
    );
  }

  if (!isExecutable(checkpointerPath)) {
    throw new Error(`Missing executable checkpointer: ${checkpointerPath}`);
  }
  if (!isExecutable(spotlighterPath)) {
    throw new Error(`Missing executable spotlighter: ${spotlighterPath}`);
  }

  const existing = loadState(repo.targetRoot);
  if (existing) {
    updateStatus(ctx, existing);
    if (isProcessAlive(existing.pid)) {
      throw new Error(
        `Spotlight is already active for ${existing.targetRoot} from ${existing.sourceRoot}. Run /spotlight stop first.`,
      );
    }

    throw new Error(
      "Found stale spotlight state for this repo. Run /spotlight stop to restore the root and clean it up before starting again.",
    );
  }

  const watchexecPath = await resolveWatchexecPath(pi, repo.currentRoot);
  if (!watchexecPath) {
    throw new Error("Could not find watchexec on PATH. Install it with Homebrew first.");
  }

  // Capture the main worktree so `/spotlight stop` can restore pre-start state.
  const rootCheckpointId = `spotlight-root-${randomUUID()}`;
  const checkpointResult = await saveCheckpoint(pi, repo.targetRoot, rootCheckpointId);
  if (!checkpointResult.ok) throw new Error(checkpointResult.message);

  let childPid: number | undefined;
  try {
    const child = spawn(spotlighterPath, [], {
      cwd: repo.currentRoot,
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        SPOTLIGHT_CHECKPOINTER_PATH: checkpointerPath,
        SPOTLIGHT_WATCHEXEC_PATH: watchexecPath,
        SPOTLIGHT_ROOT_PATH: repo.targetRoot,
      },
    });

    child.unref();
    childPid = child.pid;
    if (!childPid) throw new Error("spotlighter failed to start.");

    await sleep(STARTUP_WAIT_MS);
    if (!isProcessAlive(childPid)) {
      throw new Error("spotlighter exited immediately.");
    }
  } catch (error) {
    // Do not leave behind an unused rollback ref if startup fails.
    await deleteCheckpoint(pi, repo.targetRoot, rootCheckpointId);
    throw error;
  }

  const state: SpotlightState = {
    version: STATE_VERSION,
    sourceRoot: repo.currentRoot,
    targetRoot: repo.targetRoot,
    pid: childPid,
    ownerPid: process.pid,
    startedAt: new Date().toISOString(),
    rootCheckpointId,
    watchexecPath,
  };

  saveState(state);
  updateStatus(ctx, state);

  if (ctx.hasUI) {
    ctx.ui.notify(`Spotlight started: ${repo.currentRoot} → ${repo.targetRoot}`, "info");
  }
}

// `/spotlight stop` is the reversible path: stop the watcher, then restore root.
async function handleStop(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const repo = await getRepoInfo(pi, ctx.cwd);
  if (!repo) throw new Error("/spotlight stop must be run inside the same git repository.");

  const state = loadState(repo.targetRoot);
  if (!state) {
    updateStatus(ctx, null);
    if (ctx.hasUI) ctx.ui.notify("Spotlight is not active for this repository.", "info");
    return;
  }

  if (isProcessAlive(state.pid)) {
    await killProcessGroup(state.pid);
  }

  const restoreResult = await restoreCheckpoint(pi, state.targetRoot, state.rootCheckpointId);
  if (!restoreResult.ok) {
    updateStatus(ctx, state);
    throw new Error(restoreResult.message);
  }

  await deleteCheckpoint(pi, state.targetRoot, state.rootCheckpointId);
  deleteState(state.targetRoot);
  updateStatus(ctx, null);

  if (ctx.hasUI) {
    ctx.ui.notify(`Spotlight stopped. Restored ${state.targetRoot}.`, "info");
  }
}

async function handleStatus(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const repo = await getRepoInfo(pi, ctx.cwd);
  if (!repo) throw new Error("/spotlight status must be run inside a git repository.");

  const state = loadState(repo.targetRoot);
  if (!state) {
    updateStatus(ctx, null);
    if (ctx.hasUI) ctx.ui.notify("Spotlight is not active for this repository.", "info");
    return;
  }

  const active = isProcessAlive(state.pid);
  updateStatus(ctx, state);

  const summary = active
    ? `Spotlight active: ${state.sourceRoot} → ${state.targetRoot}`
    : `Spotlight stale: watcher exited, root restore still pending for ${state.targetRoot}`;

  if (ctx.hasUI) {
    ctx.ui.notify(summary, active ? "info" : "warning");
  } else {
    console.log(summary);
  }
}

// --- Extension entrypoint ---

function usage(): string {
  return [
    "Usage:",
    "  /spotlight start   Start syncing the current linked worktree into the main worktree",
    "  /spotlight stop    Stop syncing and restore the main worktree to its pre-start state",
    "  /spotlight status  Show whether spotlight is active for this repo",
  ].join("\n");
}

export default function spotlightExtension(pi: ExtensionAPI) {
  installExitHook();

  pi.on("session_start", async (_event, ctx) => {
    try {
      await syncStatus(pi, ctx);
    } catch {
      updateStatus(ctx, null);
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    // session_shutdown also fires for reloads and session switches.
    updateStatus(ctx, null);
  });

  pi.registerCommand("spotlight", {
    description: "Start or stop syncing a linked git worktree into the main worktree",
    handler: async (args, ctx) => {
      const [subcommand] = tokenizeArgs(args);

      try {
        switch (subcommand) {
          case "start":
            await handleStart(pi, ctx);
            return;
          case "stop":
            await handleStop(pi, ctx);
            return;
          case "status":
            await handleStatus(pi, ctx);
            return;
          case "help":
          case undefined:
            if (ctx.hasUI) ctx.ui.notify(usage(), "info");
            else console.log(usage());
            return;
          default:
            throw new Error(usage());
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (ctx.hasUI) ctx.ui.notify(message, "error");
        else console.error(message);
      }
    },
  });
}
