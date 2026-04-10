/**
 * Multi-engineer plan convergence extension.
 *
 * What this extension does:
 * - /converge runs multiple independent engineer planning passes
 *   (architect, implementer, maintainer, skeptic) across the same scoped context.
 * - It then compares those candidate plans/specs and synthesizes one recommended plan.
 * - Results are emitted as markdown plus a typed custom message payload
 *   (customType: "plan-convergence").
 *
 * Command:
 * - /converge [goal=<text>] [models=<a,b>] [context=<text>]
 *
 * Scope resolution:
 * - /converge always plans against the current repository snapshot.
 * - If the working tree has local changes, those diffs become mandatory planning context.
 * - If the working tree is clean, /converge plans from the clean checkout and includes
 *   committed branch diff context vs the default branch when available.
 *
 * Goal resolution:
 * - If goal= is provided, it is used directly.
 * - Otherwise, /converge uses the latest non-command user message on the current branch.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { matchesKey } from "@mariozechner/pi-tui";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";

const CONVERGE_TOOLS = "read,bash,grep,find,ls";
const CONVERGE_TASK_TIMEOUT_MS = 30 * 60 * 1000;
const CONVERGE_STARTUP_RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000] as const;
const CONVERGE_STARTUP_RETRY_JITTER_RATIO = 0.2;
const CONVERGE_UNTRACKED_HASH_DISABLED = "__disabled__";
const CONVERGE_CANCELLED_ERROR = "Plan convergence aborted";
const CONVERGE_STALE_SECTION_TITLE = "Repository changed";
const CONVERGE_STALE_WARNING = "Repository changed while /converge was running.";
const CONVERGE_STALE_NEXT_STEP = "Results are shown anyway. Run /converge again to refresh them.";
const CONVERGE_EVENT_START = "converge:start";
const CONVERGE_EVENT_END = "converge:end";
const CONVERGE_ARGUMENT_HINTS = ["help", "goal=", "models=", "context="] as const;

const STATUS_KEY = "0-converge";
const STATUS_SPINNER_INTERVAL_MS = 80;
const STATUS_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const PLAN_OUTPUT_CONTRACT_PROMPT = `Output JSON only, with this exact shape:
{
  "summary": "concise overview of the proposed plan",
  "approach": "short label for the approach",
  "scope_boundaries": ["what is included or excluded"],
  "steps": [
    {
      "title": "step title",
      "rationale": "why this step exists and why it is sequenced here",
      "verification": "how to verify the step"
    }
  ],
  "acceptance_criteria": ["observable outcomes"],
  "risks": ["meaningful execution risks"],
  "open_questions": ["unresolved questions that matter"]
}

Requirements:
- Return valid JSON only. Do not wrap in markdown fences.
- Be concrete and implementation-oriented.
- Prefer a small number of steps with strong sequencing over a long checklist.
- Use empty arrays when a section has no items.
- Before sending, self-check that JSON.parse(output) would succeed.`;

const CONVERGENCE_OUTPUT_CONTRACT_PROMPT = `Output JSON only, with this exact shape:
{
  "summary": "concise overview of the recommended plan",
  "why_this_plan": ["why this converged plan is better than the alternatives"],
  "key_decisions": [
    {
      "topic": "decision area",
      "decision": "chosen direction",
      "rationale": "why this wins",
      "sources": ["architect/default", "implementer/default"]
    }
  ],
  "steps": [
    {
      "title": "step title",
      "rationale": "why this step exists and why it is sequenced here",
      "verification": "how to verify the step",
      "sources": ["architect/default", "maintainer/default"]
    }
  ],
  "acceptance_criteria": ["observable outcomes"],
  "risks": ["meaningful execution risks"],
  "open_questions": ["unresolved questions that matter"],
  "first_slice": ["the narrowest first implementation slice"]
}

Requirements:
- Return valid JSON only. Do not wrap in markdown fences.
- Compare the candidate plans instead of averaging them.
- Preserve the best ideas, reject weaker ones, and make explicit decisions.
- Prefer the narrowest plan that still fully addresses the goal.
- Use empty arrays when a section has no items.
- Before sending, self-check that JSON.parse(output) would succeed.`;

type EngineerName = "architect" | "implementer" | "maintainer" | "skeptic";
type EngineerDefinition = { suffix: string; context: string };
type ConvergeRunOutcome = "success" | "failed" | "cancelled";

const PLAN_ENGINEERS: Record<EngineerName, EngineerDefinition> = {
  architect: {
    suffix: " specializing in architecture and boundaries",
    context: `Priorities:
1. Define clear module boundaries, interfaces, and ownership.
2. Prefer designs that fit the repo's long-term shape rather than one-off local hacks.
3. Make sequencing explicit when one choice unlocks or constrains later work.
4. Call out scope boundaries so the first slice does not silently grow.`,
  },
  implementer: {
    suffix: " specializing in pragmatic implementation planning",
    context: `Priorities:
1. Find the smallest correct slice that can be implemented quickly.
2. Minimize moving parts and avoid speculative abstractions.
3. Prefer direct edits to existing code over new frameworks or wrapper layers.
4. Make the first coding step obvious and concrete.`,
  },
  maintainer: {
    suffix: " specializing in maintainability and repo fit",
    context: `Priorities:
1. Reuse existing patterns, helpers, and extension conventions instead of inventing new ones.
2. Keep APIs and configuration surfaces small.
3. Delete or avoid unnecessary complexity when possible.
4. Ensure the plan remains readable, testable, and easy for another engineer to pick up.`,
  },
  skeptic: {
    suffix: " specializing in risk analysis and failure modes",
    context: `Priorities:
1. Challenge hidden assumptions and call out where the plan could fail.
2. Surface migration, staleness, concurrency, and verification risks.
3. Favor plans with predictable rollback or retry behavior over brittle flows.
4. Push the plan to define acceptance criteria and unresolved questions clearly.`,
  },
};

const PLAN_ENGINEER_NAMES = Object.keys(PLAN_ENGINEERS) as EngineerName[];

type ParsedRequest = {
  models: string[];
  rawArgs: string;
  goal?: string;
  additionalContext?: string;
};

type PlanningFingerprint = {
  headSha: string;
  branch: string;
  trackedDiffHash: string;
  untrackedHash: string;
};

type PlanningStaleness = {
  status: "stale";
  warning: string;
  nextStep: string;
};

type PlanStep = {
  title: string;
  rationale: string;
  verification: string;
};

type CandidatePlan = {
  engineer: EngineerName;
  model: string;
  summary: string;
  approach: string;
  scopeBoundaries: string[];
  steps: PlanStep[];
  acceptanceCriteria: string[];
  risks: string[];
  openQuestions: string[];
};

type CandidateTask = {
  engineer: EngineerName;
  modelArg: string | undefined;
  modelLabel: string;
  prompt: string;
};

type CandidateTaskErrorKind = "lock_contention" | "missing_api_key" | "rate_limit" | "other";

type CandidateTaskResult = {
  engineer: EngineerName;
  model: string;
  ok: boolean;
  output?: CandidatePlan;
  error?: string;
  errorKind?: CandidateTaskErrorKind;
  missingApiProvider?: string;
};

type ConvergedPlanStep = {
  title: string;
  rationale: string;
  verification: string;
  sources: string[];
};

type ConvergedKeyDecision = {
  topic: string;
  decision: string;
  rationale: string;
  sources: string[];
};

type ConvergedPlan = {
  summary: string;
  whyThisPlan: string[];
  keyDecisions: ConvergedKeyDecision[];
  steps: ConvergedPlanStep[];
  acceptanceCriteria: string[];
  risks: string[];
  openQuestions: string[];
  firstSlice: string[];
};

type ConvergeMessageDetails = {
  generatedAt: string;
  request: {
    goalSource: "argument" | "last-user";
    models: string[];
    rawArgs: string;
    additionalContext?: string;
  };
  goal: string;
  scope: {
    mode: ResolvedScope["kind"];
    description: string;
  };
  fingerprint: PlanningFingerprint;
  staleness?: PlanningStaleness;
  engineerStatus: Array<{
    engineer: EngineerName;
    model: string;
    ok: boolean;
    error?: string;
  }>;
  candidates: CandidatePlan[];
  convergence: ConvergedPlan;
};

type ConvergeRunResult =
  | { ok: false; error: string }
  | { ok: true; details: ConvergeMessageDetails };

type RepoSnapshotComparison = {
  baseBranch: string;
  mergeBase: string | null;
  diffFiles: string[];
};

type ResolvedScope =
  | {
      kind: "working-tree";
      trackedFiles: string[];
      untrackedFiles: string[];
      hasHead: boolean;
      description: string;
    }
  | {
      kind: "repo-snapshot";
      branch: string;
      comparison: RepoSnapshotComparison;
      description: string;
    };

type ExecutionControl = {
  isCancelled: () => boolean;
  registerProcess: (proc: ChildProcess) => () => void;
};

type PiJsonTaskStatus =
  | "ok"
  | "cancelled"
  | "timeout"
  | "spawn_error"
  | "non_zero_exit"
  | "assistant_error";

type PiJsonTaskResult = {
  status: PiJsonTaskStatus;
  assistantOutput: string;
  stderr: string;
  exitCode?: number;
  error?: string;
};

type PiJsonTaskOptions = {
  args: string[];
  prompt: string;
  cwd: string;
  timeoutMs: number;
  control?: ExecutionControl;
};

type PreparedConvergeRun = {
  goal: string;
  goalSource: "argument" | "last-user";
  scope: ResolvedScope;
  includeUntracked: boolean;
  baselineFingerprint: PlanningFingerprint;
  models: Array<{ modelArg: string | undefined; modelLabel: string }>;
  convergenceModel: { modelArg: string | undefined; modelLabel: string };
  tasks: CandidateTask[];
};

const runtimeState = {
  activeConvergeRuns: new Set<string>(),
  activeConvergeCancels: new Map<string, () => void>(),
  activePromptCount: 0,
};

function notify(
  ctx: ExtensionContext,
  message: string,
  type: "info" | "warning" | "error" = "info",
) {
  if (!ctx.hasUI) return;
  ctx.ui.notify(message, type);
}

function getSessionKey(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionFile() ?? `session:${ctx.sessionManager.getSessionId()}`;
}

async function withSpinner<T>(
  ctx: ExtensionContext,
  buildStatusText: () => string,
  run: () => Promise<T>,
): Promise<T> {
  if (!ctx.hasUI) return run();

  let frame = 0;
  const render = () => {
    const spinner = STATUS_SPINNER_FRAMES[frame % STATUS_SPINNER_FRAMES.length];
    ctx.ui.setStatus(STATUS_KEY, `${spinner} ${buildStatusText()}`);
  };

  render();
  const timer = setInterval(() => {
    frame = (frame + 1) % STATUS_SPINNER_FRAMES.length;
    render();
  }, STATUS_SPINNER_INTERVAL_MS);

  try {
    return await run();
  } finally {
    clearInterval(timer);
    ctx.ui.setStatus(STATUS_KEY, undefined);
  }
}

function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function withJitter(baseMs: number): number {
  const range = Math.max(0, Math.floor(baseMs * CONVERGE_STARTUP_RETRY_JITTER_RATIO));
  if (range === 0) return baseMs;
  const offset = Math.floor(Math.random() * (range * 2 + 1) - range);
  return Math.max(0, baseMs + offset);
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  if (hours > 0) return `${hours}h${minutes}m${seconds}s`;
  if (totalMinutes > 0) return `${totalMinutes}m${seconds}s`;
  return `${seconds}s`;
}

function appendMarkdownListSection(markdown: string, title: string, items: string[]): string {
  if (items.length === 0) return markdown;
  return `${markdown.trimEnd()}\n\n${title}:\n${items.map((item) => `- ${item}`).join("\n")}\n`;
}

function buildStaleness(): PlanningStaleness {
  return {
    status: "stale",
    warning: CONVERGE_STALE_WARNING,
    nextStep: CONVERGE_STALE_NEXT_STEP,
  };
}

function buildFooterNotes(staleness: PlanningStaleness | undefined): string[] {
  if (!staleness) return [];
  return [staleness.warning, staleness.nextStep];
}

function buildScopedPlanLine(scope: ResolvedScope, durationMs: number): string {
  return `Converged plan for ${scope.description} in ${formatDuration(durationMs)}.`;
}

function buildFailureMarkdown(failedTasks: CandidateTaskResult[]): string {
  const runWord = failedTasks.length === 1 ? "engineer run" : "engineer runs";
  let table = "| Engineer | Model | Error |\n";
  table += "|---|---|---|\n";
  for (const task of failedTasks) {
    table += `| ${escapeCell(task.engineer)} | ${escapeCell(task.model)} | ${escapeCell(task.error ?? "Unknown failure")} |\n`;
  }
  return `${failedTasks.length} ${runWord} failed:\n\n${table}\n`;
}

function buildCandidateSummariesTable(candidates: CandidatePlan[]): string {
  let table = "| Engineer | Model | Approach | Summary |\n";
  table += "|---|---|---|---|\n";
  for (const candidate of candidates) {
    table += `| ${escapeCell(candidate.engineer)} | ${escapeCell(candidate.model)} | ${escapeCell(candidate.approach)} | ${escapeCell(truncateText(candidate.summary, 180))} |\n`;
  }
  return table;
}

function buildCandidateSummaryMarkdown(options: {
  scopeLine: string;
  goal: string;
  candidates: CandidatePlan[];
  completedCandidates: number;
  totalCandidates: number;
  footerNotes?: string[];
}): string {
  const {
    scopeLine,
    goal,
    candidates,
    completedCandidates,
    totalCandidates,
    footerNotes = [],
  } = options;
  const runWord = totalCandidates === 1 ? "engineer run" : "engineer runs";
  const completionLine =
    completedCandidates === totalCandidates
      ? `All ${totalCandidates} ${runWord} completed`
      : `${completedCandidates} of ${totalCandidates} ${runWord} completed`;

  const markdown = `${scopeLine}\n\nGoal:\n${goal.trim()}\n\n${completionLine}.\n\n## Candidate Summaries\n\n${buildCandidateSummariesTable(candidates)}\n`;
  return appendMarkdownListSection(markdown, CONVERGE_STALE_SECTION_TITLE, footerNotes);
}

function buildConvergenceMarkdown(options: {
  scopeLine: string;
  goal: string;
  result: ConvergedPlan;
  candidates: CandidatePlan[];
  completedCandidates: number;
  totalCandidates: number;
  footerNotes?: string[];
}): string {
  const {
    scopeLine,
    goal,
    result,
    candidates,
    completedCandidates,
    totalCandidates,
    footerNotes = [],
  } = options;
  const runWord = totalCandidates === 1 ? "engineer run" : "engineer runs";
  const completionLine =
    completedCandidates === totalCandidates
      ? `All ${totalCandidates} ${runWord} completed`
      : `${completedCandidates} of ${totalCandidates} ${runWord} completed`;

  const sections: string[] = [
    scopeLine,
    "",
    "Goal:",
    goal.trim(),
    "",
    `${completionLine}.`,
    "",
    "## Recommended Plan",
    "",
    result.summary,
  ];

  if (result.whyThisPlan.length > 0) {
    sections.push("", "## Why This Plan", "", ...result.whyThisPlan.map((item) => `- ${item}`));
  }

  if (result.keyDecisions.length > 0) {
    let table = "| Topic | Decision | Rationale | Sources |\n";
    table += "|---|---|---|---|\n";
    for (const item of result.keyDecisions) {
      table += `| ${escapeCell(item.topic)} | ${escapeCell(item.decision)} | ${escapeCell(item.rationale)} | ${escapeCell(item.sources.join(", "))} |\n`;
    }
    sections.push("", "## Key Decisions", "", table.trimEnd());
  }

  if (result.steps.length > 0) {
    sections.push("", "## Steps", "");
    result.steps.forEach((step, index) => {
      sections.push(`${index + 1}. ${step.title}`);
      sections.push(`   Why: ${step.rationale}`);
      sections.push(`   Verify: ${step.verification}`);
      if (step.sources.length > 0) {
        sections.push(`   Sources: ${step.sources.join(", ")}`);
      }
      if (index < result.steps.length - 1) sections.push("");
    });
  }

  if (result.acceptanceCriteria.length > 0) {
    sections.push(
      "",
      "## Acceptance Criteria",
      "",
      ...result.acceptanceCriteria.map((item) => `- ${item}`),
    );
  }

  if (result.firstSlice.length > 0) {
    sections.push("", "## First Slice", "", ...result.firstSlice.map((item) => `- ${item}`));
  }

  if (result.risks.length > 0) {
    sections.push("", "## Risks", "", ...result.risks.map((item) => `- ${item}`));
  }

  if (result.openQuestions.length > 0) {
    sections.push("", "## Open Questions", "", ...result.openQuestions.map((item) => `- ${item}`));
  }

  sections.push(
    "",
    "## Candidate Summaries",
    "",
    buildCandidateSummariesTable(candidates).trimEnd(),
  );
  return appendMarkdownListSection(sections.join("\n"), CONVERGE_STALE_SECTION_TITLE, footerNotes);
}

function isHelpRequest(args: string | undefined): boolean {
  const tokens = tokenizeArgs(args?.trim() ?? "");
  if (tokens.length === 0) return false;
  const first = unquoteToken(tokens[0]).toLowerCase();
  return first === "help";
}

function getArgumentCompletions(prefix: string): Array<{ value: string; label: string }> | null {
  const trimmed = prefix.trim().toLowerCase();
  if (trimmed.includes(" ")) return null;

  const matches = CONVERGE_ARGUMENT_HINTS.filter((value) => value.startsWith(trimmed));
  if (matches.length === 0) return null;
  return matches.map((value) => ({ value, label: value }));
}

function showHelp(pi: ExtensionAPI) {
  pi.sendMessage({
    customType: "plan-convergence-help",
    display: true,
    content: `## /converge help

Run multiple independent engineer planning passes, then synthesize one best plan/spec.

### Syntax
- \`/converge [goal=<text>] [models=<a,b>] [context=<text>]\`

### Scope
- \`/converge\` always plans from the current repository snapshot.
- If the working tree has local changes, those diffs are mandatory planning context.
- If the working tree is clean, \`/converge\` still plans from the clean checkout and includes committed branch diff context vs the default branch when available.

### Goal Resolution
- \`goal=<text>\`: explicit planning objective.
- If \`goal=\` is omitted, \`/converge\` uses the latest non-command user message on the current branch.

### Options
- \`models=<a,b>\`: run all engineer passes for each listed model.
- \`context=<text>\`: add short inline steering to every engineer pass and the final convergence step.
- Long-form context: put \`context=\` last, then place a multi-line formatted block on the following lines.

### Engineer Lenses
- \`architect\`: boundaries, interfaces, and long-term fit.
- \`implementer\`: smallest correct slice and concrete first steps.
- \`maintainer\`: reuse, simplicity, and repo fit.
- \`skeptic\`: risks, verification, and failure modes.

### Examples
- \`/converge\`
- \`/converge goal="design auth migration plan"\`
- \`/converge context="optimize for the smallest safe first slice"\`
- \`/converge goal="design a new plan-convergence extension" models=sonnet,gpt-5\`
- Long-form context example:

\`\`\`text
/converge goal="design a new plan-convergence extension" models=gpt-5 context=
## Constraints
- Keep the first slice narrow
- Preserve review-style orchestration
- Prefer existing repo patterns over new abstractions
\`\`\`

### Behavior
- Runs engineer passes in parallel in the background.
- Uses the current session model for the final convergence step.
- Emits one markdown result plus a typed \`customType: "plan-convergence"\` payload.
- Marks results stale when repository state changes while planning is running.`,
  });
}

function tokenizeArgs(input: string): string[] {
  return input.match(/[^\s"'=]+=(?:"[^"]*"|'[^']*')|"[^"]*"|'[^']*'|\S+/g) ?? [];
}

function unquoteToken(token: string): string {
  const quoted = token.match(/^(['"])([\s\S]*)\1$/);
  if (!quoted) return token;
  return quoted[2] ?? "";
}

function parseKeyValueOption(
  token: string,
  key: "models" | "model" | "context" | "goal",
): string | undefined {
  const pattern = new RegExp(`^${key}=(?:"([\\s\\S]*)"|'([\\s\\S]*)'|(\\S+))$`);
  const match = token.match(pattern);
  if (!match) return undefined;
  return (match[1] ?? match[2] ?? match[3] ?? "").trim();
}

function extractTrailingLongFormContext(raw: string): {
  argsWithoutBlock: string;
  blockContext?: string;
} {
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (inSingleQuote || inDoubleQuote) continue;

    if (index > 0 && !/\s/.test(raw[index - 1] ?? "")) continue;
    if (!raw.startsWith("context=", index)) continue;

    let valueStart = index + "context=".length;
    while (raw[valueStart] === " " || raw[valueStart] === "\t") {
      valueStart += 1;
    }

    const nextChar = raw[valueStart];
    if (nextChar !== "\n" && nextChar !== "\r") continue;

    const newlineLength = nextChar === "\r" && raw[valueStart + 1] === "\n" ? 2 : 1;
    const blockContext = raw.slice(valueStart + newlineLength);
    return {
      argsWithoutBlock: raw.slice(0, index).trimEnd(),
      blockContext: blockContext.length > 0 ? blockContext : undefined,
    };
  }

  return { argsWithoutBlock: raw };
}

function normalizeAdditionalContextChunk(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n");
  if (!normalized.includes("\n")) return normalized.trim();

  const lines = normalized.split("\n");
  while (lines.length > 0 && lines[0]?.trim().length === 0) {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1]?.trim().length === 0) {
    lines.pop();
  }
  return lines.join("\n").trimEnd();
}

function parseRequestArgs(args: string | undefined): ParsedRequest {
  const raw = args?.trim() ?? "";
  if (!raw) {
    return { models: [], rawArgs: raw };
  }

  const { argsWithoutBlock, blockContext } = extractTrailingLongFormContext(raw);
  const tokens = tokenizeArgs(argsWithoutBlock);
  const rawModels: string[] = [];
  const rawContext: string[] = [];
  const positionalTokens: string[] = [];
  let goal: string | undefined;

  for (const token of tokens) {
    const modelsValue = parseKeyValueOption(token, "models") ?? parseKeyValueOption(token, "model");
    if (modelsValue !== undefined) {
      if (!modelsValue) continue;
      for (const model of modelsValue.split(",")) {
        const trimmed = model.trim();
        if (trimmed) rawModels.push(trimmed);
      }
      continue;
    }

    const contextValue = parseKeyValueOption(token, "context");
    if (contextValue !== undefined) {
      if (contextValue) rawContext.push(contextValue);
      continue;
    }

    const goalValue = parseKeyValueOption(token, "goal");
    if (goalValue !== undefined) {
      goal = goalValue || undefined;
      continue;
    }

    positionalTokens.push(unquoteToken(token));
  }

  if (positionalTokens.length > 0) {
    const suffix = positionalTokens.length === 1 ? "" : "s";
    throw new Error(
      `Unexpected positional arg${suffix}: ${positionalTokens.join(", ")}. /converge no longer accepts modes or positional args; use goal=..., models=..., and/or context=....`,
    );
  }

  if (blockContext !== undefined) {
    rawContext.push(blockContext);
  }

  const models = Array.from(new Set(rawModels));
  const additionalContextJoined = rawContext
    .map(normalizeAdditionalContextChunk)
    .filter((value) => value.trim().length > 0)
    .join("\n\n");
  const additionalContext =
    additionalContextJoined.length > 0 ? additionalContextJoined : undefined;

  return {
    models,
    rawArgs: raw,
    goal,
    additionalContext,
  };
}

function parseCommandRequest(
  pi: ExtensionAPI,
  args: string | undefined,
  ctx: ExtensionCommandContext,
): ParsedRequest | null {
  if (isHelpRequest(args)) {
    showHelp(pi);
    return null;
  }

  try {
    return parseRequestArgs(args);
  } catch (error) {
    notify(ctx, error instanceof Error ? error.message : String(error), "error");
    return null;
  }
}

async function runGit(
  pi: ExtensionAPI,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  const { stdout, stderr, code } = await pi.exec("git", args);
  return { stdout, stderr, code };
}

async function isGitRepo(pi: ExtensionAPI): Promise<boolean> {
  const result = await runGit(pi, ["rev-parse", "--git-dir"]);
  return result.code === 0;
}

async function getCurrentBranch(pi: ExtensionAPI): Promise<string | null> {
  const { stdout, code } = await runGit(pi, ["branch", "--show-current"]);
  if (code !== 0) return null;
  const branch = stdout.trim();
  return branch.length > 0 ? branch : null;
}

async function resolveHeadSha(pi: ExtensionAPI): Promise<string | null> {
  const { code, stdout } = await runGit(pi, ["rev-parse", "--verify", "HEAD"]);
  if (code !== 0) return null;
  const sha = stdout.trim();
  return sha.length > 0 ? sha : null;
}

async function hasHeadCommit(pi: ExtensionAPI): Promise<boolean> {
  return (await resolveHeadSha(pi)) !== null;
}

async function getDefaultBranch(pi: ExtensionAPI): Promise<string> {
  const remoteHead = await runGit(pi, ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"]);
  if (remoteHead.code === 0 && remoteHead.stdout.trim()) {
    return remoteHead.stdout.trim().replace(/^origin\//, "");
  }

  const branches = await runGit(pi, ["branch", "--format=%(refname:short)"]);
  if (branches.code === 0) {
    const names = parseGitFileList(branches.stdout);
    if (names.includes("main")) return "main";
    if (names.includes("master")) return "master";
    if (names.length > 0) return names[0];
  }

  return "main";
}

async function getMergeBase(pi: ExtensionAPI, branch: string): Promise<string | null> {
  const { stdout, code } = await runGit(pi, ["merge-base", "HEAD", branch]);
  if (code !== 0) return null;
  const sha = stdout.trim();
  return sha.length > 0 ? sha : null;
}

function parseGitFileList(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function getTrackedChangedFiles(pi: ExtensionAPI, hasHead?: boolean): Promise<string[]> {
  const headAvailable = hasHead ?? (await hasHeadCommit(pi));
  if (!headAvailable) {
    const [staged, unstaged] = await Promise.all([
      runGit(pi, ["diff", "--cached", "--name-only"]),
      runGit(pi, ["diff", "--name-only"]),
    ]);

    const files = new Set<string>([
      ...(staged.code === 0 ? parseGitFileList(staged.stdout) : []),
      ...(unstaged.code === 0 ? parseGitFileList(unstaged.stdout) : []),
    ]);
    return Array.from(files).sort((a, b) => a.localeCompare(b));
  }

  const { stdout, code } = await runGit(pi, ["diff", "HEAD", "--name-only"]);
  if (code !== 0) return [];
  return parseGitFileList(stdout);
}

async function getUntrackedFiles(pi: ExtensionAPI): Promise<string[]> {
  const { stdout, code } = await runGit(pi, ["ls-files", "--others", "--exclude-standard"]);
  if (code !== 0) return [];
  return parseGitFileList(stdout);
}

async function getDiffFilesInRange(pi: ExtensionAPI, range: string): Promise<string[]> {
  const { stdout, code } = await runGit(pi, ["diff", "--name-only", range]);
  if (code !== 0) return [];
  return parseGitFileList(stdout);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function getLastUserGoal(ctx: ExtensionContext): string | null {
  const branch = ctx.sessionManager.getBranch();
  for (let i = branch.length - 1; i >= 0; i -= 1) {
    const entry = branch[i];
    if (entry.type !== "message") continue;
    const msg = entry.message;
    if (!("role" in msg) || msg.role !== "user" || !Array.isArray(msg.content)) continue;
    const text = msg.content
      .filter((item): item is { type: "text"; text: string } => item.type === "text")
      .map((item) => item.text)
      .join("\n")
      .trim();
    if (!text) continue;
    if (text.startsWith("/converge")) continue;
    return text;
  }
  return null;
}

function resolveGoal(
  ctx: ExtensionContext,
  request: ParsedRequest,
): { ok: true; goal: string; goalSource: "argument" | "last-user" } | { ok: false; error: string } {
  const explicitGoal = request.goal?.trim();
  if (explicitGoal) {
    return { ok: true, goal: explicitGoal, goalSource: "argument" };
  }

  const branchGoal = getLastUserGoal(ctx)?.trim();
  if (branchGoal) {
    return { ok: true, goal: branchGoal, goalSource: "last-user" };
  }

  return {
    ok: false,
    error:
      "No planning goal found. Provide goal=... or ask for a plan/spec in the conversation before running /converge.",
  };
}

async function loadProjectPlanningGuidelines(cwd: string): Promise<string | null> {
  let currentDir = path.resolve(cwd);

  while (true) {
    const piDir = path.join(currentDir, ".pi");
    const piStats = await fs.stat(piDir).catch(() => null);
    if (piStats?.isDirectory()) {
      for (const filename of ["PLAN_GUIDELINES.md", "REVIEW_GUIDELINES.md"]) {
        const candidate = path.join(currentDir, filename);
        try {
          const content = await fs.readFile(candidate, "utf8");
          const trimmed = content.trim();
          if (trimmed.length > 0) return trimmed;
        } catch {
          // Continue looking.
        }
      }
      return null;
    }

    const parent = path.dirname(currentDir);
    if (parent === currentDir) return null;
    currentDir = parent;
  }
}

async function hashGitDiff(pi: ExtensionAPI): Promise<string> {
  const head = await runGit(pi, ["diff", "--no-ext-diff", "HEAD"]);
  if (head.code === 0) return hashString(head.stdout);

  const [staged, unstaged] = await Promise.all([
    runGit(pi, ["diff", "--no-ext-diff", "--cached"]),
    runGit(pi, ["diff", "--no-ext-diff"]),
  ]);
  const stagedHash = staged.code === 0 ? hashString(staged.stdout) : null;
  const unstagedHash = unstaged.code === 0 ? hashString(unstaged.stdout) : null;
  if (!stagedHash && !unstagedHash) return hashString("");
  return hashString(`${stagedHash ?? ""}\n${unstagedHash ?? ""}`);
}

function hashObjectBatch(cwd: string, files: string[]): Promise<string[]> {
  return new Promise((resolve) => {
    const proc = spawn("git", ["hash-object", "--stdin-paths"], {
      cwd,
      stdio: ["pipe", "pipe", "ignore"],
    });
    let stdout = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.on("error", () => resolve([]));
    proc.on("close", (code) => {
      resolve(code === 0 ? stdout.trim().split("\n") : []);
    });
    proc.stdin.on("error", () => {
      /* ignore broken pipe */
    });
    proc.stdin.end(files.join("\n"));
  });
}

async function computeUntrackedContentHash(
  pi: ExtensionAPI,
  cwd: string,
  precomputedUntrackedFiles?: string[],
): Promise<string> {
  const untrackedFiles = [...(precomputedUntrackedFiles ?? (await getUntrackedFiles(pi)))].sort(
    (a, b) => a.localeCompare(b),
  );
  if (untrackedFiles.length === 0) return hashString("");

  const hashes = await hashObjectBatch(cwd, untrackedFiles);
  const entries = untrackedFiles.map((file, i) => `${file}\0${hashes[i] ?? "missing"}`);
  return hashString(entries.join("\n"));
}

async function computeCurrentFingerprint(
  pi: ExtensionAPI,
  cwd: string,
  includeUntracked: boolean,
  precomputedUntrackedFiles?: string[],
): Promise<PlanningFingerprint> {
  const [headSha, branch, trackedDiffHash, untrackedHash] = await Promise.all([
    resolveHeadSha(pi).then((sha) => sha ?? ""),
    getCurrentBranch(pi).then((branch) => branch ?? ""),
    hashGitDiff(pi),
    includeUntracked
      ? computeUntrackedContentHash(pi, cwd, precomputedUntrackedFiles)
      : Promise.resolve(CONVERGE_UNTRACKED_HASH_DISABLED),
  ]);

  return { headSha, branch, trackedDiffHash, untrackedHash };
}

function fingerprintsEqual(a: PlanningFingerprint, b: PlanningFingerprint): boolean {
  return (
    a.headSha === b.headSha &&
    a.branch === b.branch &&
    a.trackedDiffHash === b.trackedDiffHash &&
    a.untrackedHash === b.untrackedHash
  );
}

async function resolveRepoSnapshotComparison(
  pi: ExtensionAPI,
  baseBranch: string,
): Promise<RepoSnapshotComparison> {
  const mergeBase = await getMergeBase(pi, baseBranch);
  if (!mergeBase) {
    return { baseBranch, mergeBase: null, diffFiles: [] };
  }

  return {
    baseBranch,
    mergeBase,
    diffFiles: await getDiffFilesInRange(pi, `${mergeBase}..HEAD`),
  };
}

function describeRepoSnapshotScope(branch: string, comparison: RepoSnapshotComparison): string {
  if (!comparison.mergeBase) {
    return `repo snapshot on ${branch} (clean; no merge-base vs ${comparison.baseBranch})`;
  }
  if (comparison.diffFiles.length === 0) {
    return `repo snapshot on ${branch} (clean; no committed diff vs ${comparison.baseBranch})`;
  }
  return `repo snapshot on ${branch} (clean; ${comparison.diffFiles.length} committed files vs ${comparison.baseBranch})`;
}

async function resolveScope(pi: ExtensionAPI): Promise<{ scope?: ResolvedScope; error?: string }> {
  const untrackedPromise = getUntrackedFiles(pi);
  const headSha = await resolveHeadSha(pi);
  const hasHead = headSha !== null;
  const [trackedFiles, untrackedFiles] = await Promise.all([
    getTrackedChangedFiles(pi, hasHead),
    untrackedPromise,
  ]);
  if (trackedFiles.length > 0 || untrackedFiles.length > 0) {
    return {
      scope: {
        kind: "working-tree",
        trackedFiles,
        untrackedFiles,
        hasHead,
        description: `working tree (tracked: ${trackedFiles.length}, untracked: ${untrackedFiles.length})`,
      },
    };
  }

  const [baseBranch, currentBranch] = await Promise.all([
    getDefaultBranch(pi),
    getCurrentBranch(pi).then((branch) => branch ?? "detached HEAD"),
  ]);
  const comparison = await resolveRepoSnapshotComparison(pi, baseBranch);
  return {
    scope: {
      kind: "repo-snapshot",
      branch: currentBranch,
      comparison,
      description: describeRepoSnapshotScope(currentBranch, comparison),
    },
  };
}

function buildScopeInstructions(scope: ResolvedScope): string {
  switch (scope.kind) {
    case "working-tree": {
      const trackedCommand = scope.hasHead
        ? "`git diff HEAD`"
        : "`git diff --cached` and `git diff`";
      const tracked =
        scope.trackedFiles.length > 0
          ? `- First capture the full tracked diff with: ${trackedCommand} (treat this diff as mandatory planning context).\n- Tracked files (${scope.trackedFiles.length}):\n${scope.trackedFiles.map((f) => `  - ${f}`).join("\n")}`
          : "- There are no tracked-file diffs.";
      const untracked =
        scope.untrackedFiles.length > 0
          ? `- Also inspect untracked files as snapshots by reading them directly.\n- Untracked files (${scope.untrackedFiles.length}):\n${scope.untrackedFiles.map((f) => `  - ${f}`).join("\n")}`
          : "- There are no untracked files.";
      return `Scope: working tree planning.\n${tracked}\n${untracked}`;
    }
    case "repo-snapshot": {
      const { comparison } = scope;
      const header = `Scope: current repository snapshot planning.\n- The authoritative code state is the current checkout on ${scope.branch}. Inspect relevant files directly; do not require a diff to define the plan.\n- The working tree is clean.`;
      if (!comparison.mergeBase) {
        return `${header}\n- Default-branch comparison against ${comparison.baseBranch} is unavailable because no merge-base could be determined. Use direct repo inspection only.`;
      }
      if (comparison.diffFiles.length === 0) {
        return `${header}\n- There is no committed branch diff vs ${comparison.baseBranch}. Plan from the current repo snapshot directly.`;
      }
      return `${header}\n- There are already committed changes on this branch relative to ${comparison.baseBranch}. Inspect them with: \`git diff ${comparison.mergeBase}..HEAD\` to understand branch-specific context, but treat the current repo snapshot as the primary planning context.\n- Committed diff files (${comparison.diffFiles.length}):\n${comparison.diffFiles.map((f) => `  - ${f}`).join("\n")}`;
    }
  }
}

function buildAdditionalContextSection(additionalContext: string | undefined): string {
  const normalized = additionalContext?.trimEnd();
  if (!normalized || normalized.trim().length === 0) return "";
  return `Additional context from user:
<<<USER_CONTEXT
${normalized}
USER_CONTEXT

`;
}

function buildCandidatePrompt(
  engineer: EngineerName,
  goal: string,
  scopeInstructions: string,
  projectGuidelines: string | null,
  additionalContext: string | undefined,
): string {
  const engineerDef = PLAN_ENGINEERS[engineer];
  const additionalContextSection = buildAdditionalContextSection(additionalContext);
  const projectGuidelinesSection = projectGuidelines
    ? `Project-specific planning guidelines:\n${projectGuidelines}\n\n`
    : "";

  return `You are a senior software engineer${engineerDef.suffix}.

You are one of several independent engineers producing a plan/spec for the same task.
Do not try to converge with unseen peers. Produce the strongest plan from your own lens.

Objective:
- Produce a concrete implementation plan/spec for the stated goal.
- Prefer the simplest design consistent with the existing repo.
- Be explicit about scope boundaries, sequencing, verification, and unresolved questions.
- Reuse existing patterns and utilities when possible.
- This is planning only. Do not modify files or repository state; do not run mutating commands.

Goal:
${goal.trim()}

${scopeInstructions}

Engineer lens:
${engineerDef.context}

${additionalContextSection}${projectGuidelinesSection}${PLAN_OUTPUT_CONTRACT_PROMPT}`;
}

function buildCandidateSourceLabel(candidate: CandidatePlan): string {
  return `${candidate.engineer}/${candidate.model}`;
}

function buildConvergencePrompt(options: {
  goal: string;
  scope: ResolvedScope;
  candidates: CandidatePlan[];
  projectGuidelines: string | null;
  additionalContext?: string;
}): string {
  const { goal, scope, candidates, projectGuidelines, additionalContext } = options;
  const additionalContextSection = buildAdditionalContextSection(additionalContext);
  const projectGuidelinesSection = projectGuidelines
    ? `Project-specific planning guidelines:\n${projectGuidelines}\n\n`
    : "";
  const payload = JSON.stringify(
    {
      goal,
      scope: {
        mode: scope.kind,
        description: scope.description,
      },
      candidates: candidates.map((candidate) => ({
        source: buildCandidateSourceLabel(candidate),
        engineer: candidate.engineer,
        model: candidate.model,
        summary: candidate.summary,
        approach: candidate.approach,
        scope_boundaries: candidate.scopeBoundaries,
        steps: candidate.steps,
        acceptance_criteria: candidate.acceptanceCriteria,
        risks: candidate.risks,
        open_questions: candidate.openQuestions,
      })),
    },
    null,
    2,
  );

  return `You are synthesizing multiple independent engineering plans/specs into a single recommended plan.

Your job:
1. Compare the candidate plans carefully.
2. Preserve the best ideas, reject weaker ones, and resolve conflicts explicitly.
3. Prefer the narrowest plan that still fully addresses the goal.
4. Keep the output implementable: concrete steps, verification, acceptance criteria, and open questions.
5. Do not just average the candidates. Make decisions.
6. Do not inspect the repository or use tools. Rely only on the input below.

${additionalContextSection}${projectGuidelinesSection}Authoritative input JSON:
${payload}

${CONVERGENCE_OUTPUT_CONTRACT_PROMPT}`;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item !== "object" || item === null) return "";
      if (!("type" in item) || item.type !== "text") return "";
      if (!("text" in item) || typeof item.text !== "string") return "";
      return item.text;
    })
    .filter(Boolean)
    .join("\n");
}

function extractAssistantMessageFromEvent(event: unknown): Record<string, unknown> | null {
  const record = asRecord(event);
  if (!record || typeof record.type !== "string") return null;

  if (record.type === "message_end" || record.type === "turn_end") {
    const message = asRecord(record.message);
    return message?.role === "assistant" ? message : null;
  }

  if (record.type !== "agent_end" || !Array.isArray(record.messages)) return null;
  for (let i = record.messages.length - 1; i >= 0; i -= 1) {
    const message = asRecord(record.messages[i]);
    if (message?.role === "assistant") {
      return message;
    }
  }
  return null;
}

function parsePossiblyWrappedJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Empty output");

  const codeFenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = codeFenceMatch?.[1]?.trim() || trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const sliced = candidate.slice(firstBrace, lastBrace + 1);
      return JSON.parse(sliced);
    }
    throw new Error("Output is not valid JSON");
  }
}

function validatePlanSteps(value: unknown, label: string): PlanStep[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  const steps: PlanStep[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const rationale = typeof record.rationale === "string" ? record.rationale.trim() : "";
    const verification = typeof record.verification === "string" ? record.verification.trim() : "";
    if (!title || !rationale || !verification) continue;
    steps.push({ title, rationale, verification });
  }

  if (steps.length === 0) {
    throw new Error(`${label} contains no valid steps.`);
  }
  return steps;
}

function validateCandidateOutput(parsed: unknown): Omit<CandidatePlan, "engineer" | "model"> {
  const record = asRecord(parsed);
  if (!record) {
    throw new Error("Candidate output must be a JSON object.");
  }

  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  const approach = typeof record.approach === "string" ? record.approach.trim() : "";
  if (!summary) {
    throw new Error('Candidate output is missing required "summary".');
  }
  if (!approach) {
    throw new Error('Candidate output is missing required "approach".');
  }

  return {
    summary,
    approach,
    scopeBoundaries: getStringArray(record.scope_boundaries),
    steps: validatePlanSteps(record.steps, "steps"),
    acceptanceCriteria: getStringArray(record.acceptance_criteria),
    risks: getStringArray(record.risks),
    openQuestions: getStringArray(record.open_questions),
  };
}

function getUniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function validateConvergedPlanSteps(value: unknown): ConvergedPlanStep[] {
  if (!Array.isArray(value)) {
    throw new Error('Convergence output is missing required "steps" array.');
  }

  const steps: ConvergedPlanStep[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const rationale = typeof record.rationale === "string" ? record.rationale.trim() : "";
    const verification = typeof record.verification === "string" ? record.verification.trim() : "";
    const sources = getUniqueStrings(getStringArray(record.sources));
    if (!title || !rationale || !verification) continue;
    steps.push({ title, rationale, verification, sources });
  }

  if (steps.length === 0) {
    throw new Error("Convergence output contains no valid steps.");
  }
  return steps;
}

function validateKeyDecisions(value: unknown): ConvergedKeyDecision[] {
  if (!Array.isArray(value)) return [];

  const items: ConvergedKeyDecision[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;
    const topic = typeof record.topic === "string" ? record.topic.trim() : "";
    const decision = typeof record.decision === "string" ? record.decision.trim() : "";
    const rationale = typeof record.rationale === "string" ? record.rationale.trim() : "";
    const sources = getUniqueStrings(getStringArray(record.sources));
    if (!topic || !decision || !rationale) continue;
    items.push({ topic, decision, rationale, sources });
  }
  return items;
}

function validateConvergenceOutput(parsed: unknown): ConvergedPlan {
  const record = asRecord(parsed);
  if (!record) {
    throw new Error("Convergence output must be a JSON object.");
  }

  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  if (!summary) {
    throw new Error('Convergence output is missing required "summary".');
  }

  return {
    summary,
    whyThisPlan: getStringArray(record.why_this_plan),
    keyDecisions: validateKeyDecisions(record.key_decisions),
    steps: validateConvergedPlanSteps(record.steps),
    acceptanceCriteria: getStringArray(record.acceptance_criteria),
    risks: getStringArray(record.risks),
    openQuestions: getStringArray(record.open_questions),
    firstSlice: getStringArray(record.first_slice),
  };
}

function classifyTaskError(errorText: string): {
  errorKind: CandidateTaskErrorKind;
  missingApiProvider?: string;
} {
  if (/Lock file is already being held/i.test(errorText)) {
    return { errorKind: "lock_contention" };
  }

  const apiKeyMatch = errorText.match(/No API key found for\s+([\w.-]+)/i);
  if (apiKeyMatch?.[1]) {
    return { errorKind: "missing_api_key", missingApiProvider: apiKeyMatch[1] };
  }

  const authFailedMatch = errorText.match(/Authentication failed for\s+"([\w.-]+)"/i);
  if (authFailedMatch?.[1]) {
    return { errorKind: "missing_api_key", missingApiProvider: authFailedMatch[1] };
  }

  if (/rate.?limit|too many requests|\b429\b/i.test(errorText)) {
    return { errorKind: "rate_limit" };
  }

  return { errorKind: "other" };
}

function createCancelledCandidateResult(task: CandidateTask): CandidateTaskResult {
  return {
    engineer: task.engineer,
    model: task.modelLabel,
    ok: false,
    error: CONVERGE_CANCELLED_ERROR,
    errorKind: "other",
  };
}

async function runPiJsonTask({
  args,
  prompt,
  cwd,
  timeoutMs,
  control,
}: PiJsonTaskOptions): Promise<PiJsonTaskResult> {
  if (control?.isCancelled()) {
    return {
      status: "cancelled",
      assistantOutput: "",
      stderr: "",
    };
  }

  return new Promise<PiJsonTaskResult>((resolve) => {
    const proc = spawn("pi", [...args, prompt], {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    const unregisterProcess = control?.registerProcess(proc);

    let stdoutBuffer = "";
    let latestAssistantOutput = "";
    let latestAssistantError = "";
    let stderr = "";
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: PiJsonTaskResult) => {
      if (settled) return;
      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      unregisterProcess?.();
      resolve(result);
    };

    const processLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const event = JSON.parse(trimmed);
        const message = extractAssistantMessageFromEvent(event);
        if (message) {
          const text = extractTextContent(message.content);
          if (text) latestAssistantOutput = text;
          latestAssistantError =
            message.stopReason === "error" && typeof message.errorMessage === "string"
              ? message.errorMessage
              : "";
        }
      } catch {
        // Ignore non-JSON lines.
      }
    };

    if (control?.isCancelled()) {
      try {
        proc.kill("SIGKILL");
      } catch {
        // Best effort.
      }
      finish({
        status: "cancelled",
        assistantOutput: latestAssistantOutput,
        stderr,
      });
      return;
    }

    timeoutId = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // Best effort.
      }
      finish({
        status: "timeout",
        assistantOutput: latestAssistantOutput,
        stderr,
      });
    }, timeoutMs);

    proc.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        processLine(line);
      }
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", (error) => {
      finish({
        status: "spawn_error",
        assistantOutput: latestAssistantOutput,
        stderr,
        error: error.message,
      });
    });

    proc.on("close", (code) => {
      if (stdoutBuffer.trim()) {
        processLine(stdoutBuffer);
      }

      if ((code ?? 1) !== 0) {
        finish({
          status: "non_zero_exit",
          assistantOutput: latestAssistantOutput,
          stderr,
          exitCode: code ?? 1,
        });
        return;
      }

      if (latestAssistantError) {
        finish({
          status: "assistant_error",
          assistantOutput: latestAssistantOutput,
          stderr,
          error: latestAssistantError,
          exitCode: 0,
        });
        return;
      }

      finish({
        status: "ok",
        assistantOutput: latestAssistantOutput,
        stderr,
        exitCode: 0,
      });
    });
  });
}

async function runCandidateTaskAttempt(
  task: CandidateTask,
  cwd: string,
  control?: ExecutionControl,
): Promise<CandidateTaskResult> {
  const args = [
    "--mode",
    "json",
    "-p",
    "--no-session",
    "--tools",
    CONVERGE_TOOLS,
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
  ];
  if (task.modelArg) {
    args.push("--model", task.modelArg);
  }

  const taskResult = await runPiJsonTask({
    args,
    prompt: task.prompt,
    cwd,
    timeoutMs: CONVERGE_TASK_TIMEOUT_MS,
    control,
  });

  if (taskResult.status === "cancelled") {
    return createCancelledCandidateResult(task);
  }

  if (taskResult.status === "timeout") {
    return {
      engineer: task.engineer,
      model: task.modelLabel,
      ok: false,
      error: "Engineer planning run timed out after 30 minutes.",
      errorKind: "other",
    };
  }

  if (taskResult.status === "spawn_error") {
    const error = `Failed to start engineer planning process: ${taskResult.error ?? "unknown error"}`;
    return {
      engineer: task.engineer,
      model: task.modelLabel,
      ok: false,
      error,
      ...classifyTaskError(error),
    };
  }

  if (taskResult.status === "non_zero_exit") {
    const stderr = taskResult.stderr.trim();
    const error = `Engineer run exited with code ${taskResult.exitCode ?? 1}${stderr ? `: ${stderr}` : ""}`;
    return {
      engineer: task.engineer,
      model: task.modelLabel,
      ok: false,
      error,
      ...classifyTaskError(`${taskResult.stderr}\n${error}`),
    };
  }

  if (taskResult.status === "assistant_error") {
    const classification = classifyTaskError(taskResult.error ?? "");
    const error =
      classification.errorKind === "missing_api_key"
        ? `Missing API key for provider '${classification.missingApiProvider ?? "unknown"}'. Use /login or configure credentials for that provider.`
        : classification.errorKind === "rate_limit"
          ? "Engineer run failed due to rate limiting. Try again later or switch models."
          : "Engineer run failed due to a provider error.";
    return {
      engineer: task.engineer,
      model: task.modelLabel,
      ok: false,
      error,
      ...classification,
    };
  }

  const assistantOutput = taskResult.assistantOutput;
  if (!assistantOutput.trim()) {
    return {
      engineer: task.engineer,
      model: task.modelLabel,
      ok: false,
      error: "Engineer run returned no assistant output.",
      errorKind: "other",
    };
  }

  try {
    const parsed = parsePossiblyWrappedJson(assistantOutput);
    const plan = validateCandidateOutput(parsed);
    return {
      engineer: task.engineer,
      model: task.modelLabel,
      ok: true,
      output: {
        engineer: task.engineer,
        model: task.modelLabel,
        ...plan,
      },
    };
  } catch (error) {
    return {
      engineer: task.engineer,
      model: task.modelLabel,
      ok: false,
      error: `Engineer output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      errorKind: "other",
    };
  }
}

async function runCandidateTask(
  task: CandidateTask,
  cwd: string,
  control?: ExecutionControl,
): Promise<CandidateTaskResult> {
  if (control?.isCancelled()) {
    return createCancelledCandidateResult(task);
  }

  for (let attempt = 0; ; attempt += 1) {
    const result = await runCandidateTaskAttempt(task, cwd, control);
    if (result.ok || attempt >= CONVERGE_STARTUP_RETRY_DELAYS_MS.length) return result;

    const retryable =
      result.errorKind === "lock_contention" || result.errorKind === "missing_api_key";
    if (!retryable) return result;
    if (control?.isCancelled()) return createCancelledCandidateResult(task);

    const baseDelayMs =
      CONVERGE_STARTUP_RETRY_DELAYS_MS[attempt] ??
      CONVERGE_STARTUP_RETRY_DELAYS_MS[CONVERGE_STARTUP_RETRY_DELAYS_MS.length - 1];
    await new Promise((resolve) => setTimeout(resolve, withJitter(baseDelayMs)));
  }
}

async function runConvergenceTask(options: {
  ctx: ExtensionCommandContext;
  cwd: string;
  prompt: string;
  model: { modelArg: string | undefined; modelLabel: string };
  control?: ExecutionControl;
}): Promise<{ ok: true; result: ConvergedPlan } | { ok: false; error: string }> {
  const { ctx, cwd, prompt, model, control } = options;
  const args = [
    "--mode",
    "json",
    "-p",
    "--no-session",
    "--no-tools",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
  ];
  if (model.modelArg) {
    args.push("--model", model.modelArg);
  }

  for (let attempt = 0; ; attempt += 1) {
    if (control?.isCancelled()) {
      return { ok: false, error: CONVERGE_CANCELLED_ERROR };
    }

    const taskResult = await withSpinner(
      ctx,
      () => `converging candidate plans with ${model.modelLabel}`,
      () =>
        runPiJsonTask({
          args,
          prompt,
          cwd,
          timeoutMs: CONVERGE_TASK_TIMEOUT_MS,
          control,
        }),
    );

    if (taskResult.status === "cancelled") {
      return { ok: false, error: CONVERGE_CANCELLED_ERROR };
    }
    if (taskResult.status === "timeout") {
      return { ok: false, error: "Convergence step timed out after 30 minutes." };
    }
    if (taskResult.status === "spawn_error") {
      return {
        ok: false,
        error: `Failed to start convergence process: ${taskResult.error ?? "unknown error"}`,
      };
    }
    if (taskResult.status === "non_zero_exit") {
      const stderr = taskResult.stderr.trim();
      const error = `Convergence exited with code ${taskResult.exitCode ?? 1}${stderr ? `: ${stderr}` : ""}`;
      const classification = classifyTaskError(`${taskResult.stderr}\n${error}`);
      if (classification.errorKind === "missing_api_key") {
        return {
          ok: false,
          error: `Missing API key for provider '${classification.missingApiProvider ?? "unknown"}'. Use /login or configure credentials for that provider.`,
        };
      }
      if (
        classification.errorKind === "lock_contention" &&
        attempt < CONVERGE_STARTUP_RETRY_DELAYS_MS.length
      ) {
        const baseDelayMs =
          CONVERGE_STARTUP_RETRY_DELAYS_MS[attempt] ??
          CONVERGE_STARTUP_RETRY_DELAYS_MS[CONVERGE_STARTUP_RETRY_DELAYS_MS.length - 1];
        await new Promise((resolve) => setTimeout(resolve, withJitter(baseDelayMs)));
        continue;
      }
      return { ok: false, error };
    }
    if (taskResult.status === "assistant_error") {
      const classification = classifyTaskError(taskResult.error ?? "");
      if (classification.errorKind === "missing_api_key") {
        return {
          ok: false,
          error: `Missing API key for provider '${classification.missingApiProvider ?? "unknown"}'. Use /login or configure credentials for that provider.`,
        };
      }
      if (classification.errorKind === "rate_limit") {
        return {
          ok: false,
          error: "Convergence failed due to rate limiting. Try again later or switch models.",
        };
      }
      return { ok: false, error: "Convergence failed due to a provider error." };
    }

    const assistantOutput = taskResult.assistantOutput;
    if (!assistantOutput.trim()) {
      return { ok: false, error: "Convergence returned no assistant output." };
    }

    try {
      const parsed = parsePossiblyWrappedJson(assistantOutput);
      return { ok: true, result: validateConvergenceOutput(parsed) };
    } catch (error) {
      return {
        ok: false,
        error: `Convergence output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

function pickPreferredModelCandidate<T extends { id: string; provider: string }>(
  candidates: T[],
  currentProvider: string | undefined,
): T {
  const preferredProviderCandidates = currentProvider
    ? candidates.filter(
        (candidate) => candidate.provider.toLowerCase() === currentProvider.toLowerCase(),
      )
    : [];
  const pool = preferredProviderCandidates.length > 0 ? preferredProviderCandidates : candidates;

  const aliases = pool.filter(
    (candidate) => candidate.id.endsWith("-latest") || !/-\d{8}$/.test(candidate.id),
  );
  const ranked = (aliases.length > 0 ? aliases : pool).slice();
  ranked.sort((a, b) => b.id.localeCompare(a.id));
  return ranked[0];
}

function resolveUnqualifiedModelPattern(
  modelPattern: string,
  availableModels: Array<{ id: string; name?: string; provider: string }>,
  currentProvider: string | undefined,
): { modelArg: string; modelLabel: string } | undefined {
  const normalizedPattern = modelPattern.toLowerCase();
  const exactMatches = availableModels.filter(
    (model) => model.id.toLowerCase() === normalizedPattern,
  );
  const candidates =
    exactMatches.length > 0
      ? exactMatches
      : availableModels.filter((model) => {
          const byId = model.id.toLowerCase().includes(normalizedPattern);
          const byName = model.name?.toLowerCase().includes(normalizedPattern) ?? false;
          return byId || byName;
        });
  if (candidates.length === 0) return undefined;

  const preferred = pickPreferredModelCandidate(candidates, currentProvider);
  return {
    modelArg: `${preferred.provider}/${preferred.id}`,
    modelLabel: modelPattern,
  };
}

async function resolveModels(
  ctx: ExtensionContext,
  requestedModels: string[],
): Promise<Array<{ modelArg: string | undefined; modelLabel: string }>> {
  const currentProvider = typeof ctx.model?.provider === "string" ? ctx.model.provider : undefined;
  const currentModelId = ctx.model?.id;
  const availableModels = ctx.modelRegistry.getAvailable();

  const resolveRequestedModel = (
    modelPattern: string,
  ): { modelArg: string; modelLabel: string } => {
    const slash = modelPattern.indexOf("/");
    const explicitProvider = slash > 0 ? modelPattern.slice(0, slash).trim() : "";
    if (explicitProvider) {
      return { modelArg: modelPattern, modelLabel: modelPattern };
    }

    const hasWildcard =
      modelPattern.includes("*") || modelPattern.includes("?") || modelPattern.includes("[");
    if (!hasWildcard) {
      const resolved = resolveUnqualifiedModelPattern(
        modelPattern,
        availableModels,
        currentProvider,
      );
      if (resolved) return resolved;
    }

    return {
      modelArg: modelPattern,
      modelLabel: modelPattern,
    };
  };

  if (requestedModels.length > 0) {
    return requestedModels.map(resolveRequestedModel);
  }

  const modelArg = currentModelId
    ? currentProvider
      ? `${currentProvider}/${currentModelId}`
      : currentModelId
    : undefined;
  return [{ modelArg, modelLabel: currentModelId ?? "default" }];
}

function resolveConvergenceModel(
  ctx: ExtensionContext,
  models: Array<{ modelArg: string | undefined; modelLabel: string }>,
): { modelArg: string | undefined; modelLabel: string } {
  if (ctx.model?.id) {
    const provider = typeof ctx.model.provider === "string" ? ctx.model.provider : undefined;
    return {
      modelArg: provider ? `${provider}/${ctx.model.id}` : ctx.model.id,
      modelLabel: ctx.model.id,
    };
  }
  return models[0] ?? { modelArg: undefined, modelLabel: "default" };
}

function buildCandidateTasks(
  scope: ResolvedScope,
  goal: string,
  guidelines: string | null,
  additionalContext: string | undefined,
  models: Array<{ modelArg: string | undefined; modelLabel: string }>,
): CandidateTask[] {
  const scopeInstructions = buildScopeInstructions(scope);
  const tasks: CandidateTask[] = [];

  for (const model of models) {
    for (const engineer of PLAN_ENGINEER_NAMES) {
      tasks.push({
        engineer,
        modelArg: model.modelArg,
        modelLabel: model.modelLabel,
        prompt: buildCandidatePrompt(
          engineer,
          goal,
          scopeInstructions,
          guidelines,
          additionalContext,
        ),
      });
    }
  }

  return tasks;
}

async function prepareConvergeRun(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  request: ParsedRequest,
): Promise<{ ok: false; error: string } | { ok: true; data: PreparedConvergeRun }> {
  if (!(await isGitRepo(pi))) {
    return { ok: false, error: "Not a git repository." };
  }

  const goalResult = resolveGoal(ctx, request);
  if (!goalResult.ok) {
    return { ok: false, error: goalResult.error };
  }

  const resolved = await resolveScope(pi);
  if (!resolved.scope) {
    return { ok: false, error: resolved.error ?? "Failed to resolve planning scope." };
  }

  const scope = resolved.scope;
  const includeUntracked = true;
  const scopeUntrackedFiles = scope.kind === "working-tree" ? scope.untrackedFiles : undefined;
  const [baselineFingerprint, guidelines, models] = await Promise.all([
    computeCurrentFingerprint(pi, ctx.cwd, includeUntracked, scopeUntrackedFiles),
    loadProjectPlanningGuidelines(ctx.cwd),
    resolveModels(ctx, request.models),
  ]);

  return {
    ok: true,
    data: {
      goal: goalResult.goal,
      goalSource: goalResult.goalSource,
      scope,
      includeUntracked,
      baselineFingerprint,
      models,
      convergenceModel: resolveConvergenceModel(ctx, models),
      tasks: buildCandidateTasks(
        scope,
        goalResult.goal,
        guidelines,
        request.additionalContext,
        models,
      ),
    },
  };
}

async function runCandidateTasks(
  ctx: ExtensionCommandContext,
  cwd: string,
  tasks: CandidateTask[],
  control: ExecutionControl,
): Promise<CandidateTaskResult[]> {
  let completed = 0;
  return withSpinner(
    ctx,
    () => `planning (completed ${completed}/${tasks.length})`,
    () =>
      Promise.all(
        tasks.map(async (task) => {
          try {
            if (control.isCancelled()) return createCancelledCandidateResult(task);
            return await runCandidateTask(task, cwd, control);
          } finally {
            completed = Math.min(tasks.length, completed + 1);
          }
        }),
      ),
  );
}

function acquireRunLock(ctx: ExtensionContext, busyMessage: string): string | null {
  const sessionKey = getSessionKey(ctx);
  if (runtimeState.activeConvergeRuns.has(sessionKey)) {
    notify(ctx, busyMessage, "warning");
    return null;
  }

  runtimeState.activeConvergeRuns.add(sessionKey);
  return sessionKey;
}

function releaseRunLock(sessionKey: string): void {
  runtimeState.activeConvergeRuns.delete(sessionKey);
}

async function runConvergePipeline(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  request: ParsedRequest,
): Promise<ConvergeRunResult> {
  const sessionKey = getSessionKey(ctx);
  const startedAtMs = Date.now();

  const activeProcesses = new Set<ChildProcess>();
  let cancelRequested = false;
  let convergeOutcome: ConvergeRunOutcome = "failed";
  let convergeStarted = false;

  const cancelActiveProcesses = () => {
    for (const proc of activeProcesses) {
      try {
        proc.kill("SIGKILL");
      } catch {
        // Best effort.
      }
    }
    activeProcesses.clear();
  };

  const requestCancellation = () => {
    if (cancelRequested) return;
    cancelRequested = true;
    cancelActiveProcesses();
  };

  const executionControl: ExecutionControl = {
    isCancelled: () => cancelRequested,
    registerProcess: (proc) => {
      activeProcesses.add(proc);
      return () => {
        activeProcesses.delete(proc);
      };
    },
  };

  let unsubscribeInterrupt: (() => void) | undefined;

  try {
    const prepared = await prepareConvergeRun(pi, ctx, request);
    if (!prepared.ok) {
      return { ok: false, error: prepared.error };
    }

    const {
      goal,
      goalSource,
      scope,
      includeUntracked,
      baselineFingerprint,
      models,
      convergenceModel,
      tasks,
    } = prepared.data;

    pi.events.emit(CONVERGE_EVENT_START, { sessionKey });
    convergeStarted = true;
    runtimeState.activeConvergeCancels.set(sessionKey, requestCancellation);
    unsubscribeInterrupt = ctx.hasUI
      ? ctx.ui.onTerminalInput((data) => {
          if (!matchesKey(data, "escape")) return undefined;
          if (runtimeState.activePromptCount > 0) return undefined;
          requestCancellation();
          return { consume: true };
        })
      : undefined;

    const modelsText = models.map((model) => model.modelArg ?? model.modelLabel).join(", ");
    notify(
      ctx,
      `Engineer lenses: ${PLAN_ENGINEER_NAMES.join(", ")} · models: ${modelsText}.`,
      "info",
    );

    const candidateResults = await runCandidateTasks(ctx, ctx.cwd, tasks, executionControl);
    if (cancelRequested) {
      convergeOutcome = "cancelled";
      return { ok: false, error: CONVERGE_CANCELLED_ERROR };
    }

    const failedTasks = candidateResults.filter((task) => !task.ok);
    const failedCount = failedTasks.length;
    const totalCandidates = candidateResults.length;
    const completedCandidates = totalCandidates - failedCount;
    const successfulCandidates = candidateResults.filter(
      (result): result is CandidateTaskResult & { output: CandidatePlan } =>
        Boolean(result.ok && result.output),
    );

    if (successfulCandidates.length === 0) {
      if (failedCount > 0) {
        const scopeLine = buildScopedPlanLine(scope, Date.now() - startedAtMs);
        pi.sendMessage(
          {
            customType: "plan-errors",
            content: `${scopeLine}\n\n${buildFailureMarkdown(failedTasks)}`,
            display: true,
          },
          { deliverAs: "followUp" },
        );
      }

      const missingApiProvider = failedTasks.find(
        (task) => task.errorKind === "missing_api_key" && Boolean(task.missingApiProvider),
      )?.missingApiProvider;
      if (missingApiProvider) {
        return {
          ok: false,
          error: `All engineer runs failed. Missing API key for provider '${missingApiProvider}'. Use /login or configure credentials for that provider.`,
        };
      }

      const sampleError =
        candidateResults.find((task) => task.error)?.error ?? "Unknown engineer failure";
      return {
        ok: false,
        error: `All engineer runs failed. ${sampleError}`,
      };
    }

    const guidelines = await loadProjectPlanningGuidelines(ctx.cwd);
    const preConvergenceFingerprint = await computeCurrentFingerprint(
      pi,
      ctx.cwd,
      includeUntracked,
    );
    let staleness: PlanningStaleness | undefined;
    if (!fingerprintsEqual(baselineFingerprint, preConvergenceFingerprint)) {
      staleness = buildStaleness();
    }

    const candidates = successfulCandidates.map((result) => result.output);
    const convergenceResult = await runConvergenceTask({
      ctx,
      cwd: ctx.cwd,
      prompt: buildConvergencePrompt({
        goal,
        scope,
        candidates,
        projectGuidelines: guidelines,
        additionalContext: request.additionalContext,
      }),
      model: convergenceModel,
      control: executionControl,
    });
    if (!convergenceResult.ok) {
      const scopeLine = buildScopedPlanLine(scope, Date.now() - startedAtMs);
      pi.sendMessage(
        {
          customType: "plan-candidates",
          content: buildCandidateSummaryMarkdown({
            scopeLine,
            goal,
            candidates,
            completedCandidates,
            totalCandidates,
            footerNotes: buildFooterNotes(staleness),
          }),
          display: true,
          details: {
            generatedAt: new Date().toISOString(),
            goal,
            scope: {
              mode: scope.kind,
              description: scope.description,
            },
            candidates,
          },
        },
        { deliverAs: "followUp" },
      );
      return { ok: false, error: convergenceResult.error };
    }

    const endingFingerprint = await computeCurrentFingerprint(pi, ctx.cwd, includeUntracked);
    if (!staleness && !fingerprintsEqual(baselineFingerprint, endingFingerprint)) {
      staleness = buildStaleness();
    }

    if (cancelRequested) {
      convergeOutcome = "cancelled";
      return { ok: false, error: CONVERGE_CANCELLED_ERROR };
    }

    if (failedCount > 0) {
      pi.sendMessage(
        {
          customType: "plan-errors",
          content: buildFailureMarkdown(failedTasks),
          display: true,
        },
        { deliverAs: "followUp" },
      );
    }

    const scopeLine = buildScopedPlanLine(scope, Date.now() - startedAtMs);
    const details: ConvergeMessageDetails = {
      generatedAt: new Date().toISOString(),
      request: {
        goalSource,
        models: request.models,
        rawArgs: request.rawArgs,
        ...(request.additionalContext ? { additionalContext: request.additionalContext } : {}),
      },
      goal,
      scope: {
        mode: scope.kind,
        description: scope.description,
      },
      fingerprint: staleness ? baselineFingerprint : endingFingerprint,
      staleness,
      engineerStatus: candidateResults.map((task) => ({
        engineer: task.engineer,
        model: task.model,
        ok: task.ok,
        error: task.error,
      })),
      candidates,
      convergence: convergenceResult.result,
    };

    pi.sendMessage(
      {
        customType: "plan-convergence",
        content: buildConvergenceMarkdown({
          scopeLine,
          goal,
          result: convergenceResult.result,
          candidates,
          completedCandidates,
          totalCandidates,
          footerNotes: buildFooterNotes(staleness),
        }),
        display: true,
        details,
      },
      { deliverAs: "followUp" },
    );

    if (staleness) {
      if (failedCount > 0) {
        notify(
          ctx,
          `Plan convergence completed with stale partial results: ${failedCount} engineer run(s) failed.`,
          "warning",
        );
      } else {
        notify(
          ctx,
          `Plan convergence completed with stale results from ${candidates.length} candidate plan(s).`,
          "warning",
        );
      }
    } else if (failedCount > 0) {
      notify(
        ctx,
        `Plan convergence completed with partial results: ${failedCount} engineer run(s) failed.`,
        "warning",
      );
    } else {
      notify(
        ctx,
        `Plan convergence completed from ${candidates.length} candidate plan(s).`,
        "info",
      );
    }

    convergeOutcome = "success";
    return { ok: true, details };
  } finally {
    unsubscribeInterrupt?.();
    cancelActiveProcesses();
    if (runtimeState.activeConvergeCancels.get(sessionKey) === requestCancellation) {
      runtimeState.activeConvergeCancels.delete(sessionKey);
    }
    if (convergeStarted) {
      pi.events.emit(CONVERGE_EVENT_END, { sessionKey, outcome: convergeOutcome });
    }
  }
}

export default function convergeExtension(pi: ExtensionAPI) {
  pi.events.on("ui:prompt_start", () => {
    runtimeState.activePromptCount += 1;
  });

  pi.events.on("ui:prompt_end", () => {
    runtimeState.activePromptCount = Math.max(0, runtimeState.activePromptCount - 1);
  });

  pi.on("session_start", async (_event, ctx) => {
    runtimeState.activePromptCount = 0;
    const sessionKey = getSessionKey(ctx);
    for (const [key, cancel] of runtimeState.activeConvergeCancels) {
      if (key !== sessionKey) cancel();
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    runtimeState.activeConvergeCancels.get(sessionKey)?.();
    runtimeState.activeConvergeCancels.delete(sessionKey);
    runtimeState.activeConvergeRuns.delete(sessionKey);
    runtimeState.activePromptCount = 0;
  });

  pi.registerCommand("converge", {
    description:
      "Run multiple engineer planning passes, then converge them into one recommended plan/spec. Use /converge help for full usage.",
    getArgumentCompletions,
    handler: async (args, ctx) => {
      const request = parseCommandRequest(pi, args, ctx);
      if (!request) return;

      const sessionKey = acquireRunLock(ctx, "A /converge run is already active in this session.");
      if (!sessionKey) return;

      notify(ctx, "Starting plan convergence in background...", "info");
      void (async () => {
        try {
          const result = await runConvergePipeline(pi, ctx, request);
          if (!result.ok) {
            notify(ctx, result.error, "error");
          }
        } catch (error) {
          notify(
            ctx,
            `Plan convergence failed: ${error instanceof Error ? error.message : String(error)}`,
            "error",
          );
        } finally {
          releaseRunLock(sessionKey);
        }
      })();
    },
  });
}
