/**
 * Tri-state tool output mode for pi.
 *
 * Public Pi APIs only expose a boolean tool expansion state. To get an exact
 * three-mode `ctrl+o` cycle (standard -> expanded -> collapsed -> standard),
 * this extension patches Pi's interactive mode and tool row components.
 *
 * The selected mode is persisted in `~/.pi/agent/command-preview.json`.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI, ExtensionUIContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

// --- Constants ---

const DEFAULT_MODE: ToolOutputMode = "standard";
const PATCH_STATE_KEY = "__afzal_pi_tri_state_tool_mode__";
const CONFIG_PATH = path.join(
  process.env.PI_CODING_AGENT_DIR ?? path.join(process.env.HOME ?? ".", ".pi", "agent"),
  "command-preview.json",
);

// --- Types ---

type DistModulePath =
  | "./modes/interactive/interactive-mode.js"
  | "./modes/interactive/components/tool-execution.js"
  | "./modes/interactive/components/bash-execution.js";

type ToolOutputMode = "standard" | "expanded" | "collapsed";

type CommandPreviewConfig = {
  mode: ToolOutputMode;
};

type ContainerLike = {
  children: unknown[];
  clear: () => void;
  addChild: (child: unknown) => void;
};

type ToolExecutionPrototype = {
  updateDisplay: () => void;
  getRenderShell: () => "default" | "self";
  result?: unknown;
  contentBox: ContainerLike;
  selfRenderContainer: ContainerLike;
  imageComponents: unknown[];
  imageSpacers: unknown[];
  removeChild: (child: unknown) => void;
};

type BashExecutionStatus = "running" | "complete" | "error" | "cancelled";

type BashExecutionPrototype = {
  updateDisplay: () => void;
  contentContainer: ContainerLike;
  command: string;
  loader: unknown;
  status: BashExecutionStatus;
  exitCode?: number;
  truncationResult?: { truncated?: boolean };
  fullOutputPath?: string;
};

type InteractiveModePrototype = {
  setToolsExpanded: (expanded: boolean) => void;
  toggleToolOutputExpansion: () => void;
};

type PatchState = {
  mode: ToolOutputMode;
  interactiveModePatched?: boolean;
  toolExecutionPatched?: boolean;
  bashExecutionPatched?: boolean;
  booleanSyncSuppressDepth?: number;
};

// --- Helpers ---

function getPatchState(): PatchState {
  const globalRecord = globalThis as Record<string, unknown>;
  const existing = globalRecord[PATCH_STATE_KEY];
  if (existing && typeof existing === "object") return existing as PatchState;

  const state: PatchState = { mode: DEFAULT_MODE };
  globalRecord[PATCH_STATE_KEY] = state;
  return state;
}

function resolveInternalModule(modulePath: DistModulePath): string {
  const cliPath = process.argv[1];
  if (!cliPath) {
    throw new Error("Cannot resolve pi internals: process.argv[1] is missing.");
  }

  const resolvedCliPath = fs.realpathSync(cliPath);
  const distDir = path.dirname(resolvedCliPath);
  return pathToFileURL(path.join(distDir, modulePath)).href;
}

function isToolOutputMode(value: unknown): value is ToolOutputMode {
  return value === "standard" || value === "expanded" || value === "collapsed";
}

function loadModeFromConfig(): ToolOutputMode {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<CommandPreviewConfig>;
    return isToolOutputMode(parsed.mode) ? parsed.mode : DEFAULT_MODE;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[command-preview] Failed to load ${CONFIG_PATH}: ${message}`);
    }

    return DEFAULT_MODE;
  }
}

function saveModeToConfig(mode: ToolOutputMode): void {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, `${JSON.stringify({ mode }, null, 2)}\n`, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[command-preview] Failed to save ${CONFIG_PATH}: ${message}`);
  }
}

function setMode(mode: ToolOutputMode, options?: { persist?: boolean }): void {
  const state = getPatchState();
  state.mode = mode;

  if (options?.persist) {
    saveModeToConfig(mode);
  }
}

function nextToolOutputMode(mode: ToolOutputMode): ToolOutputMode {
  switch (mode) {
    case "standard":
      return "expanded";
    case "expanded":
      return "collapsed";
    case "collapsed":
      return "standard";
  }
}

function syncModeFromBoolean(expanded: boolean, options?: { persist?: boolean }): void {
  setMode(expanded ? "expanded" : "standard", options);
}

function withBooleanSyncSuppressed<T>(run: () => T): T {
  const state = getPatchState();
  state.booleanSyncSuppressDepth = (state.booleanSyncSuppressDepth ?? 0) + 1;

  try {
    return run();
  } finally {
    state.booleanSyncSuppressDepth -= 1;
  }
}

function isBooleanSyncSuppressed(): boolean {
  return (getPatchState().booleanSyncSuppressDepth ?? 0) > 0;
}

function applyMode(ui: ExtensionUIContext, mode: ToolOutputMode): void {
  setMode(mode);
  withBooleanSyncSuppressed(() => {
    ui.setToolsExpanded(mode === "expanded");
  });
}

function isCollapsedMode(): boolean {
  return getPatchState().mode === "collapsed";
}

function trimToolResultContent(component: ToolExecutionPrototype): void {
  const renderContainer =
    component.getRenderShell() === "self" ? component.selfRenderContainer : component.contentBox;

  if (renderContainer.children.length > 1) {
    renderContainer.children.splice(1);
  }

  for (const image of component.imageComponents) {
    component.removeChild(image);
  }
  component.imageComponents.length = 0;

  for (const spacer of component.imageSpacers) {
    component.removeChild(spacer);
  }
  component.imageSpacers.length = 0;
}

function createCollapsedBashStatus(component: BashExecutionPrototype): unknown {
  if (component.status === "running") {
    return component.loader;
  }

  const lines: string[] = [];
  if (component.status === "cancelled") {
    lines.push("(cancelled)");
  } else if (component.status === "error") {
    lines.push(`(exit ${component.exitCode ?? "?"})`);
  }

  if (component.truncationResult?.truncated && component.fullOutputPath) {
    lines.push(`Output truncated. Full output: ${component.fullOutputPath}`);
  }

  if (lines.length === 0) {
    return undefined;
  }

  return new Text(`\n${lines.join("\n")}`, 1, 0);
}

async function patchInteractiveMode(): Promise<void> {
  const state = getPatchState();
  if (state.interactiveModePatched) return;

  const module = (await import(resolveInternalModule(
    "./modes/interactive/interactive-mode.js",
  ))) as {
    InteractiveMode: { prototype: InteractiveModePrototype };
  };

  const prototype = module.InteractiveMode.prototype;
  const originalSetToolsExpanded = prototype.setToolsExpanded;

  prototype.setToolsExpanded = function patchedSetToolsExpanded(
    this: InteractiveModePrototype,
    expanded: boolean,
  ): void {
    if (!isBooleanSyncSuppressed()) {
      syncModeFromBoolean(expanded, { persist: true });
    }

    originalSetToolsExpanded.call(this, expanded);
  };

  prototype.toggleToolOutputExpansion = function patchedToggleToolOutputExpansion(
    this: InteractiveModePrototype,
  ): void {
    const nextMode = nextToolOutputMode(getPatchState().mode);
    setMode(nextMode, { persist: true });

    withBooleanSyncSuppressed(() => {
      originalSetToolsExpanded.call(this, nextMode === "expanded");
    });
  };

  state.interactiveModePatched = true;
}

async function patchToolExecutionComponent(): Promise<void> {
  const state = getPatchState();
  if (state.toolExecutionPatched) return;

  const module = (await import(resolveInternalModule(
    "./modes/interactive/components/tool-execution.js",
  ))) as {
    ToolExecutionComponent: { prototype: ToolExecutionPrototype };
  };

  const prototype = module.ToolExecutionComponent.prototype;
  const originalUpdateDisplay = prototype.updateDisplay;

  prototype.updateDisplay = function patchedToolExecutionDisplay(this: ToolExecutionPrototype): void {
    originalUpdateDisplay.call(this);

    if (!isCollapsedMode() || !this.result) return;
    trimToolResultContent(this);
  };

  state.toolExecutionPatched = true;
}

async function patchBashExecutionComponent(): Promise<void> {
  const state = getPatchState();
  if (state.bashExecutionPatched) return;

  const module = (await import(resolveInternalModule(
    "./modes/interactive/components/bash-execution.js",
  ))) as {
    BashExecutionComponent: { prototype: BashExecutionPrototype };
  };

  const prototype = module.BashExecutionComponent.prototype;
  const originalUpdateDisplay = prototype.updateDisplay;

  prototype.updateDisplay = function patchedBashExecutionDisplay(this: BashExecutionPrototype): void {
    originalUpdateDisplay.call(this);

    if (!isCollapsedMode()) return;

    const header = this.contentContainer.children[0];
    const status = createCollapsedBashStatus(this);

    this.contentContainer.clear();
    if (header) {
      this.contentContainer.addChild(header);
    }
    if (status) {
      this.contentContainer.addChild(status);
    }
  };

  state.bashExecutionPatched = true;
}

// --- Extension entrypoint ---

export default async function commandPreviewExtension(pi: ExtensionAPI): Promise<void> {
  await Promise.all([
    patchInteractiveMode(),
    patchToolExecutionComponent(),
    patchBashExecutionComponent(),
  ]);

  pi.on("session_start", (_event, ctx) => {
    const mode = loadModeFromConfig();
    if (!ctx.hasUI) {
      setMode(mode);
      return;
    }

    applyMode(ctx.ui, mode);
  });
}
