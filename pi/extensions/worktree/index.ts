/**
 * Worktree Extension
 *
 * Commands:
 *  - /worktree new <branch> [--from <ref>]
 *      Creates a new worktree at ../<project>-<branch-normalized>
 *
 *  - /worktree archive <branch>
 *      Removes the worktree for <branch> and deletes the local branch if it's pushed (has upstream).
 *
 *  - /worktree clean
 *      Archives all worktrees whose checked out branch has an upstream.
 *
 *  - /worktree list
 *      Lists worktrees and their status.
 *
 * Note on working directory:
 *  /worktree new calls process.chdir() so the entire pi process moves into
 *  the new worktree. pi's ctx.cwd is frozen at startup and won't reflect this
 *  change. Any extension that needs the actual working directory after a
 *  worktree switch must use process.cwd() instead of ctx.cwd.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

const STATUS_KEY = "worktree";
const FETCH_TIMEOUT_MS = 60_000;

type Subcommand = "new" | "archive" | "clean" | "list";

type DirtyAction = "skip" | "stash" | "force" | "prompt";

type DirtyState = "clean" | "dirty" | "unknown";

interface WorktreeInfo {
	path: string;
	head?: string;
	branchRef?: string;
	detached?: boolean;
	locked?: boolean;
	lockedReason?: string;
}

interface RepoInfo {
	/** Root of the main/original worktree (parent of the common .git dir) */
	mainRoot: string;
	/** Root of the current worktree */
	currentRoot: string;
	/** Directory name of mainRoot (used for naming worktrees) */
	projectName: string;
	/** Parent directory where worktrees will be created */
	parentDir: string;
}

interface ArchiveOutcome {
	branch: string;
	worktreePath: string;
	removed: boolean;
	branchDeleted: boolean;
	skippedReason?: string;
}

interface SwitchMainResult {
	proceed: boolean;
	switched: boolean;
	stashedHash?: string;
}

interface SetupAction {
	label: string;
	command: string;
	source: string;
}

function tokenizeArgs(args: string): string[] {
	const trimmed = args.trim();
	if (!trimmed) return [];
	return trimmed.split(/\s+/g).filter(Boolean);
}

function normalizeBranchForPath(branch: string): string {
	return branch
		.trim()
		.replace(/^refs\/heads\//, "")
		.toLowerCase()
		// Only allow lowercase letters, numbers and dashes in the final path segment.
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+/, "")
		.replace(/-+$/, "");
}

function stripRefsHeadsPrefix(branch: string): string {
	return branch.trim().replace(/^refs\/heads\//, "");
}

function shellQuote(value: string): string {
	if (value.length === 0) return "''";
	return `'${value.replace(/'/g, "'\\''")}'`;
}

function realpathOrResolve(p: string): string {
	try {
		return fs.realpathSync(p);
	} catch {
		return path.resolve(p);
	}
}

function isSameOrInsidePath(childPath: string, parentPath: string): boolean {
	const rel = path.relative(realpathOrResolve(parentPath), realpathOrResolve(childPath));
	return rel === "" || (!rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel));
}

async function withStatus<T>(ctx: ExtensionCommandContext, text: string, fn: () => Promise<T>): Promise<T> {
	if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, text);
	try {
		return await fn();
	} finally {
		if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
	}
}

async function git(
	pi: ExtensionAPI,
	cwd: string,
	args: string[],
	options?: { timeout?: number; signal?: AbortSignal },
) {
	return pi.exec("git", args, { cwd, ...options });
}

async function mustGitStdout(pi: ExtensionAPI, cwd: string, args: string[], errorPrefix: string): Promise<string> {
	const result = await git(pi, cwd, args);
	if (result.code !== 0) {
		const details = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
		throw new Error(`${errorPrefix}${details ? `\n${details}` : ""}`);
	}
	return result.stdout;
}

async function getRepoInfo(pi: ExtensionAPI, cwd: string): Promise<RepoInfo> {
	const currentRoot = (await mustGitStdout(
		pi,
		cwd,
		["rev-parse", "--path-format=absolute", "--show-toplevel"],
		"Not a git repository",
	)).trim();

	const commonDir = (await mustGitStdout(
		pi,
		cwd,
		["rev-parse", "--path-format=absolute", "--git-common-dir"],
		"Not a git repository",
	)).trim();

	const mainRoot = path.dirname(commonDir);
	const projectName = path.basename(mainRoot);
	const parentDir = path.dirname(mainRoot);

	return { mainRoot, currentRoot, projectName, parentDir };
}

function parseWorktreeListPorcelain(stdout: string): WorktreeInfo[] {
	const lines = stdout.split("\n");
	const worktrees: WorktreeInfo[] = [];

	let current: Partial<WorktreeInfo> | null = null;
	for (const rawLine of lines) {
		const line = rawLine.trimEnd();

		if (line.trim() === "") {
			if (current?.path) {
				worktrees.push(current as WorktreeInfo);
			}
			current = null;
			continue;
		}

		if (line.startsWith("worktree ")) {
			if (current?.path) {
				worktrees.push(current as WorktreeInfo);
			}
			current = { path: line.slice("worktree ".length).trim() };
			continue;
		}

		if (!current) continue;

		if (line.startsWith("HEAD ")) {
			current.head = line.slice("HEAD ".length).trim();
			continue;
		}

		if (line.startsWith("branch ")) {
			current.branchRef = line.slice("branch ".length).trim();
			continue;
		}

		if (line === "detached") {
			current.detached = true;
			continue;
		}

		if (line === "locked") {
			current.locked = true;
			continue;
		}

		if (line.startsWith("locked ")) {
			current.locked = true;
			current.lockedReason = line.slice("locked ".length).trim();
			continue;
		}
	}

	if (current?.path) {
		worktrees.push(current as WorktreeInfo);
	}

	return worktrees;
}

async function pruneWorktrees(pi: ExtensionAPI, repoRoot: string): Promise<void> {
	// Best-effort: remove stale worktree entries.
	// Locked worktrees are not pruned.
	await git(pi, repoRoot, ["worktree", "prune"]);
}

async function listWorktrees(pi: ExtensionAPI, repoRoot: string): Promise<WorktreeInfo[]> {
	const stdout = await mustGitStdout(pi, repoRoot, ["worktree", "list", "--porcelain"], "Failed to list worktrees");
	return parseWorktreeListPorcelain(stdout);
}

function branchNameFromRef(ref: string): string {
	return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

async function getHeadBranch(pi: ExtensionAPI, cwd: string): Promise<string | null> {
	const result = await git(pi, cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
	if (result.code !== 0) return null;
	const name = result.stdout.trim();
	if (!name || name === "HEAD") return null;
	return name;
}

async function isDirty(pi: ExtensionAPI, cwd: string): Promise<boolean> {
	const result = await git(pi, cwd, ["status", "--porcelain"]);
	if (result.code !== 0) return false;
	return result.stdout.trim().length > 0;
}

async function getDirtyState(pi: ExtensionAPI, cwd: string): Promise<DirtyState> {
	const result = await git(pi, cwd, ["status", "--porcelain"]);
	if (result.code !== 0) return "unknown";
	return result.stdout.trim().length > 0 ? "dirty" : "clean";
}

async function stashAll(pi: ExtensionAPI, cwd: string, message: string): Promise<string | undefined> {
	const result = await git(pi, cwd, ["stash", "push", "-u", "-m", message]);
	if (result.code !== 0) {
		const details = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
		throw new Error(`Failed to stash changes${details ? `\n${details}` : ""}`);
	}

	// Capture the stash commit hash so we can optionally apply it later.
	const ref = await git(pi, cwd, ["rev-parse", "--verify", "--quiet", "stash@{0}"]);
	if (ref.code !== 0) return undefined;
	const hash = ref.stdout.trim();
	return hash.length > 0 ? hash : undefined;
}

async function findStashIndexByHash(pi: ExtensionAPI, repoRoot: string, stashHash: string): Promise<number | null> {
	const result = await git(pi, repoRoot, ["stash", "list", "--format=%H"]);
	if (result.code !== 0) return null;

	const hashes = result.stdout
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);

	const idx = hashes.findIndex((h) => h === stashHash);
	return idx >= 0 ? idx : null;
}

async function applyStashToWorktree(
	pi: ExtensionAPI,
	repoRoot: string,
	worktreePath: string,
	stashHash: string,
): Promise<void> {
	const idx = await findStashIndexByHash(pi, repoRoot, stashHash);

	if (idx !== null) {
		const pop = await git(pi, worktreePath, ["stash", "pop", `stash@{${idx}}`]);
		if (pop.code !== 0) {
			const details = [pop.stdout.trim(), pop.stderr.trim()].filter(Boolean).join("\n");
			throw new Error(`Failed to pop stash into ${worktreePath}${details ? `\n${details}` : ""}`);
		}
		return;
	}

	// Fallback: apply by hash (doesn't drop the stash entry).
	const apply = await git(pi, worktreePath, ["stash", "apply", stashHash]);
	if (apply.code !== 0) {
		const details = [apply.stdout.trim(), apply.stderr.trim()].filter(Boolean).join("\n");
		throw new Error(`Failed to apply stash into ${worktreePath}${details ? `\n${details}` : ""}`);
	}
}

async function localBranchExists(pi: ExtensionAPI, repoRoot: string, branch: string): Promise<boolean> {
	const result = await git(pi, repoRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
	return result.code === 0;
}

async function getUpstream(pi: ExtensionAPI, repoRoot: string, branch: string): Promise<string | null> {
	const result = await git(pi, repoRoot, [
		"for-each-ref",
		"--format=%(upstream:short)",
		`refs/heads/${branch}`,
	]);
	if (result.code !== 0) return null;
	const upstream = result.stdout.trim();
	return upstream.length > 0 ? upstream : null;
}

async function getAheadBehind(
	pi: ExtensionAPI,
	repoRoot: string,
	branch: string,
	upstream: string,
): Promise<{ ahead: number; behind: number } | null> {
	const result = await git(pi, repoRoot, ["rev-list", "--left-right", "--count", `${branch}...${upstream}`]);
	if (result.code !== 0) return null;

	const parts = result.stdout.trim().split(/\s+/g);
	const ahead = Number.parseInt(parts[0] ?? "", 10);
	const behind = Number.parseInt(parts[1] ?? "", 10);

	if (!Number.isFinite(ahead) || !Number.isFinite(behind)) return null;
	return { ahead, behind };
}

async function getDefaultMainBranch(pi: ExtensionAPI, repoRoot: string): Promise<string> {
	const remoteHead = await git(pi, repoRoot, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
	if (remoteHead.code === 0) {
		const full = remoteHead.stdout.trim();
		if (full.startsWith("origin/")) {
			const candidate = full.slice("origin/".length);
			if (await localBranchExists(pi, repoRoot, candidate)) return candidate;
			return candidate;
		}
	}

	for (const candidate of ["main", "master", "trunk"]) {
		if (await localBranchExists(pi, repoRoot, candidate)) return candidate;
	}

	return "main";
}

function defaultWorktreePath(repo: RepoInfo, branch: string): string | null {
	const normalized = normalizeBranchForPath(branch);
	if (!normalized) return null;
	return path.join(repo.parentDir, `${repo.projectName}-${normalized}`);
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function isFile(p: string): boolean {
	try {
		return fs.statSync(p).isFile();
	} catch {
		return false;
	}
}

type WorktreePathState = "ok" | "missing" | "invalid-path" | "inaccessible";

function getWorktreePathState(p: string): WorktreePathState {
	try {
		const stat = fs.statSync(p);
		return stat.isDirectory() ? "ok" : "invalid-path";
	} catch (err) {
		const code = (err as NodeJS.ErrnoException | null | undefined)?.code;
		if (code === "ENOENT" || code === "ENOTDIR") return "missing";
		if (code === "EACCES" || code === "EPERM") return "inaccessible";
		return "inaccessible";
	}
}

function worktreeAtPath(worktrees: WorktreeInfo[], candidatePath: string): WorktreeInfo | undefined {
	const resolved = realpathOrResolve(candidatePath);
	return worktrees.find((w) => realpathOrResolve(w.path) === resolved);
}

function pathExistsAndIsNotEmptyDir(p: string): boolean {
	if (!fs.existsSync(p)) return false;
	if (!isDirectory(p)) return true;

	try {
		return fs.readdirSync(p).length > 0;
	} catch {
		return true;
	}
}

async function resolveWorktreePath(
	ctx: ExtensionCommandContext,
	repo: RepoInfo,
	worktrees: WorktreeInfo[],
	branch: string,
): Promise<string | null> {
	let candidate = defaultWorktreePath(repo, branch);

	if (!candidate) {
		if (!ctx.hasUI) {
			throw new Error(`Branch name cannot be normalized to a directory name: ${branch}`);
		}

		const suggested = path.join(repo.parentDir, `${repo.projectName}-worktree`);
		ctx.ui.notify(
			`Branch name "${branch}" normalizes to an empty directory name. Please choose a worktree directory.`,
			"warning",
		);
		const input = await ctx.ui.input("Enter worktree directory", suggested);
		if (!input) return null;
		candidate = path.isAbsolute(input) ? input : path.resolve(repo.currentRoot, input);
	}

	while (true) {
		const existingWt = worktreeAtPath(worktrees, candidate);
		const nonEmpty = pathExistsAndIsNotEmptyDir(candidate);

		if (!existingWt && !nonEmpty) return candidate;

		const reason = existingWt
			? `Path is already used by an existing worktree (${existingWt.branchRef ? branchNameFromRef(existingWt.branchRef) : "detached"})`
			: "Path already exists and is not empty";

		if (!ctx.hasUI) {
			throw new Error(`${reason}: ${candidate}`);
		}

		ctx.ui.notify(`${reason}: ${candidate}`, "warning");
		const input = await ctx.ui.input("Enter a different worktree directory", candidate);
		if (!input) return null;

		candidate = path.isAbsolute(input) ? input : path.resolve(repo.currentRoot, input);
	}
}

function asNonEmptyString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function readJsonFile(filePath: string): unknown | null {
	try {
		const raw = fs.readFileSync(filePath, "utf8");
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function inferSetupActions(worktreeRoot: string): SetupAction[] {
	const actions: SetupAction[] = [];

	const conductorConfigPath = path.join(worktreeRoot, "conductor.json");
	const conductorConfig = readJsonFile(conductorConfigPath) as any;
	const conductorSetup = asNonEmptyString(conductorConfig?.scripts?.setup);
	if (conductorSetup) {
		actions.push({ label: "Conductor setup", command: conductorSetup, source: "conductor.json" });
	}

	const oneCodeConfigPath = path.join(worktreeRoot, "1code.json");
	const oneCodeConfig = readJsonFile(oneCodeConfigPath) as any;
	const oneCodeSetup = asNonEmptyString(oneCodeConfig?.scripts?.setup);
	if (oneCodeSetup) {
		actions.push({ label: "1Code setup", command: oneCodeSetup, source: "1code.json" });
	}

	const scriptProviders = [
		{ dir: path.join(worktreeRoot, ".claude", "scripts"), relDir: ".claude/scripts", label: "CCPM" },
		{ dir: path.join(worktreeRoot, ".codex", "scripts"), relDir: ".codex/scripts", label: "Codex" },
	];

	const knownScripts = ["bootstrap.sh", "setup.sh", "init.sh"];
	for (const provider of scriptProviders) {
		if (!fs.existsSync(provider.dir) || !isDirectory(provider.dir)) continue;

		for (const script of knownScripts) {
			const absScript = path.join(provider.dir, script);
			if (!fs.existsSync(absScript) || !isFile(absScript)) continue;

			const relScript = `./${provider.relDir}/${script}`;
			actions.push({
				label: `${provider.label}: ${provider.relDir}/${script}`,
				command: `bash ${shellQuote(relScript)}`,
				source: `${provider.relDir}/${script}`,
			});
		}
	}

	return actions;
}

async function maybeRunSetupFromProjectFiles(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	worktreeRoot: string,
): Promise<void> {
	if (!ctx.hasUI) return;

	const actions = inferSetupActions(worktreeRoot);
	if (actions.length === 0) return;

	let chosen: SetupAction | undefined;

	if (actions.length === 1) {
		const action = actions[0];
		const ok = await ctx.ui.confirm(
			"Run worktree setup?",
			`${action.label}\n\nCommand:\n${action.command}`,
		);
		if (!ok) return;
		chosen = action;
	} else {
		const options = ["Skip", ...actions.map((a) => `${a.label} (${a.source})`)];
		const choice = await ctx.ui.select("Choose setup to run", options);
		if (!choice || choice === "Skip") return;

		const idx = options.indexOf(choice) - 1;
		chosen = actions[idx];
		if (!chosen) return;

		const ok = await ctx.ui.confirm(
			"Run worktree setup?",
			`${chosen.label}\n\nCommand:\n${chosen.command}`,
		);
		if (!ok) return;
	}

	await withStatus(ctx, `Running setup: ${chosen.label}`, async () => {
		const result = await pi.exec("bash", ["-c", chosen.command], { cwd: worktreeRoot });
		if (result.code !== 0) {
			throw new Error(
				`Setup failed (exit ${result.code}). Run this manually in ${worktreeRoot}:\n${chosen.command}`,
			);
		}
	});

	ctx.ui.notify(`Setup finished: ${chosen.label}`, "info");
}

async function ensureCanPrompt(ctx: ExtensionCommandContext, message: string): Promise<boolean> {
	if (ctx.hasUI) return true;
	// No UI - can't safely proceed with anything requiring confirmation
	// (still return false so callers can abort gracefully)
	console.error(message);
	return false;
}

async function maybeSwitchMainToDefaultBranch(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	repo: RepoInfo,
	defaultBranch: string,
	reason: string,
	options?: { required: boolean },
): Promise<SwitchMainResult> {
	const current = await getHeadBranch(pi, repo.mainRoot);
	if (!current || current === defaultBranch) return { proceed: true, switched: false };

	const required = options?.required ?? false;

	if (!ctx.hasUI) {
		if (required) {
			throw new Error(
				`Cannot proceed without UI: need to checkout ${defaultBranch} in main worktree to ${reason}.`,
			);
		}
		return { proceed: true, switched: false };
	}

	const title = required ? "Switch main worktree?" : "Switch main worktree branch?";
	const ok = await ctx.ui.confirm(
		title,
		`Main worktree is on ${current}. Checkout ${defaultBranch} to ${reason}?`,
	);

	if (!ok) {
		return required ? { proceed: false, switched: false } : { proceed: true, switched: false };
	}

	let stashedHash: string | undefined;

	if (await isDirty(pi, repo.mainRoot)) {
		const choice = await ctx.ui.select(
			"Main worktree has uncommitted changes",
			["Stash changes (including untracked) and continue", "Cancel"],
		);

		if (!choice || choice.startsWith("Cancel")) {
			return required ? { proceed: false, switched: false } : { proceed: true, switched: false };
		}

		stashedHash = await stashAll(
			pi,
			repo.mainRoot,
			`worktree: stash before switching main worktree to ${defaultBranch}`,
		);
	}

	const checkout = await git(pi, repo.mainRoot, ["checkout", defaultBranch]);
	if (checkout.code !== 0) {
		const details = [checkout.stdout.trim(), checkout.stderr.trim()].filter(Boolean).join("\n");
		throw new Error(
			`Failed to checkout ${defaultBranch} in main worktree${details ? `\n${details}` : ""}`,
		);
	}

	return { proceed: true, switched: true, stashedHash };
}

async function handleNew(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string): Promise<void> {
	const tokens = tokenizeArgs(args);
	let branch = tokens[0];
	if (!branch || branch.startsWith("-")) {
		if (ctx.hasUI) {
			ctx.ui.notify("Usage: /worktree new <branch> [--from <ref>]", "warning");
		}
		return;
	}

	branch = stripRefsHeadsPrefix(branch);
	if (!branch || branch.startsWith("-")) {
		if (ctx.hasUI) {
			ctx.ui.notify("Usage: /worktree new <branch> [--from <ref>]", "warning");
		}
		return;
	}

	let fromRef: string | undefined;
	for (let i = 1; i < tokens.length; i++) {
		const t = tokens[i];
		if (t === "--from") {
			fromRef = tokens[i + 1];
			i++;
			continue;
		}
		if (t.startsWith("--from=")) {
			fromRef = t.slice("--from=".length);
			continue;
		}
	}

	await ctx.waitForIdle();

	await withStatus(ctx, `Creating worktree: ${branch}`, async () => {
		const repo = await getRepoInfo(pi, ctx.cwd);
		const defaultMain = await getDefaultMainBranch(pi, repo.mainRoot);

		await pruneWorktrees(pi, repo.mainRoot);
		const worktrees = await listWorktrees(pi, repo.mainRoot);
		const existing = worktrees.find((w) => w.branchRef === `refs/heads/${branch}`);

		// Branch already checked out in a worktree
		if (existing && existing.path !== repo.mainRoot) {
			process.chdir(existing.path);
			if (ctx.hasUI) {
				ctx.ui.notify(`Branch ${branch} is already checked out at: ${existing.path}`, "info");
			}
			return;
		}

		if (existing && existing.path === repo.mainRoot && branch === defaultMain) {
			if (ctx.hasUI) {
				ctx.ui.notify(
					`Branch ${branch} is already checked out in the main worktree (${repo.mainRoot}); can't create another worktree for it.`,
					"warning",
				);
			}
			return;
		}

		const targetPath = await resolveWorktreePath(ctx, repo, worktrees, branch);
		if (!targetPath) {
			if (ctx.hasUI) ctx.ui.notify("Cancelled", "warning");
			return;
		}

		let stashedHashToApply: string | undefined;
		let mainWorktreeSwitched = false;

		// If the branch is currently checked out in the main worktree, we must switch main away first.
		if (existing && existing.path === repo.mainRoot) {
			const result = await maybeSwitchMainToDefaultBranch(pi, ctx, repo, defaultMain, `free branch ${branch}`, {
				required: true,
			});

			if (!result.proceed) {
				if (ctx.hasUI) ctx.ui.notify("Cancelled", "warning");
				return;
			}

			mainWorktreeSwitched = result.switched;
			stashedHashToApply = result.stashedHash;

			if (result.switched && ctx.hasUI) {
				ctx.ui.notify(
					`Switched main worktree (${repo.mainRoot}) from ${branch} to ${defaultMain} to free the branch. The new worktree will be on ${branch}.`,
					"info",
				);
			}
		}

		const exists = await localBranchExists(pi, repo.mainRoot, branch);
		if (exists && fromRef) {
			if (ctx.hasUI) {
				const ok = await ctx.ui.confirm(
					"Branch exists",
					`Branch ${branch} already exists.

Continuing will use the existing branch at its current state; --from (${fromRef}) will have no effect.

Continue?`,
				);
				if (!ok) {
					ctx.ui.notify("Cancelled", "warning");
					return;
				}
			} else {
				console.error(`Branch ${branch} already exists. Ignoring --from ${fromRef}.`);
			}
		}

		let addArgs: string[];
		if (exists) {
			addArgs = ["worktree", "add", targetPath, branch];
		} else {
			const baseCommit = (
				await mustGitStdout(
					pi,
					repo.currentRoot,
					["rev-parse", fromRef ?? "HEAD"],
					`Failed to resolve base ref: ${fromRef ?? "HEAD"}`,
				)
			).trim();
			addArgs = ["worktree", "add", "-b", branch, targetPath, baseCommit];
		}

		const add = await git(pi, repo.mainRoot, addArgs);
		if (add.code !== 0) {
			const details = [add.stdout.trim(), add.stderr.trim()].filter(Boolean).join("\n");
			throw new Error(`Failed to create worktree${details ? `\n${details}` : ""}`);
		}

		process.chdir(targetPath);

		if (ctx.hasUI) {
			ctx.ui.notify(`Worktree created: ${targetPath}`, "info");
		}

		if (mainWorktreeSwitched && ctx.hasUI) {
			ctx.ui.notify(
				`Main worktree is now on ${defaultMain}. Worktree ${targetPath} is on ${branch}.`,
				"info",
			);
		}

		if (stashedHashToApply && ctx.hasUI) {
			const apply = await ctx.ui.confirm(
				"Apply stashed changes?",
				"I stashed changes in the main worktree to switch branches. Applying may cause conflicts. Apply them to the new worktree?",
			);

			if (apply) {
				try {
					await applyStashToWorktree(pi, repo.mainRoot, targetPath, stashedHashToApply);
					ctx.ui.notify("Applied stashed changes to the new worktree", "info");
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					const firstLine = message.split("\n")[0] || message;
					ctx.ui.notify(`Failed to apply stash: ${firstLine}`, "error");
					ctx.ui.notify(
						`The stash was kept. You can re-apply it manually in ${targetPath}: git stash apply ${stashedHashToApply}`,
						"warning",
					);
				}
			} else {
				ctx.ui.notify("Changes remain stashed (git stash list)", "warning");
			}
		}

		await maybeRunSetupFromProjectFiles(pi, ctx, targetPath);
	});
}

async function archiveWorktree(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	repo: RepoInfo,
	branch: string,
	dirtyAction: DirtyAction,
	defaultMain: string,
	worktree?: WorktreeInfo,
): Promise<ArchiveOutcome> {
	const wt =
		worktree ??
		(await listWorktrees(pi, repo.mainRoot)).find((w) => w.branchRef === `refs/heads/${branch}`);
	if (!wt) {
		return { branch, worktreePath: "", removed: false, branchDeleted: false, skippedReason: "no-worktree" };
	}

	if (wt.path === repo.mainRoot) {
		return {
			branch,
			worktreePath: wt.path,
			removed: false,
			branchDeleted: false,
			skippedReason: "main-worktree",
		};
	}

	if (wt.locked) {
		const reason = wt.lockedReason ? `locked: ${wt.lockedReason}` : "locked";
		return {
			branch,
			worktreePath: wt.path,
			removed: false,
			branchDeleted: false,
			skippedReason: reason,
		};
	}

	if (isSameOrInsidePath(ctx.cwd, wt.path)) {
		return {
			branch,
			worktreePath: wt.path,
			removed: false,
			branchDeleted: false,
			skippedReason: "current-cwd",
		};
	}

	const dirty = await isDirty(pi, wt.path);
	let force = false;

	if (dirty) {
		let effectiveAction: DirtyAction = dirtyAction;

		if (dirtyAction === "prompt") {
			if (!ctx.hasUI) {
				throw new Error(`Cannot archive dirty worktree without UI: ${wt.path}`);
			}

			const choice = await ctx.ui.select(`Worktree has uncommitted changes: ${wt.path}`, [
				"Stash changes (including untracked) and archive",
				"Force remove (lose changes)",
				"Cancel",
			]);

			if (!choice || choice === "Cancel") {
				return {
					branch,
					worktreePath: wt.path,
					removed: false,
					branchDeleted: false,
					skippedReason: "cancelled",
				};
			}

			effectiveAction = choice.startsWith("Stash") ? "stash" : "force";
		}

		if (effectiveAction === "skip") {
			return {
				branch,
				worktreePath: wt.path,
				removed: false,
				branchDeleted: false,
				skippedReason: "dirty",
			};
		}

		if (effectiveAction === "stash") {
			await stashAll(pi, wt.path, `worktree: stash before archiving ${branch}`);
		}

		if (effectiveAction === "force") {
			force = true;
		}
	}

	const removeArgs = force ? ["worktree", "remove", "--force", wt.path] : ["worktree", "remove", wt.path];
	const remove = await git(pi, repo.mainRoot, removeArgs);
	if (remove.code !== 0) {
		const details = [remove.stdout.trim(), remove.stderr.trim()].filter(Boolean).join("\n");
		throw new Error(`Failed to remove worktree ${wt.path}${details ? `\n${details}` : ""}`);
	}

	const upstream = await getUpstream(pi, repo.mainRoot, branch);
	let branchDeleted = false;

	// Never delete the default branch automatically.
	if (branch === defaultMain) {
		return {
			branch,
			worktreePath: wt.path,
			removed: true,
			branchDeleted: false,
		};
	}

	if (upstream) {
		const aheadBehind = await getAheadBehind(pi, repo.mainRoot, branch, upstream);
		const ahead = aheadBehind?.ahead;

		if (aheadBehind && ahead > 0) {
			// Branch has commits not on upstream (not fully pushed)
			if (ctx.hasUI) {
				const ok = await ctx.ui.confirm(
					"Delete local branch?",
					`Branch ${branch} is ahead of ${upstream} by ${ahead} commit(s). Delete it anyway?`,
				);
				if (ok) {
					const del = await git(pi, repo.mainRoot, ["branch", "-D", branch]);
					branchDeleted = del.code === 0;
				}
			}
		} else if (!aheadBehind) {
			// Couldn't determine ahead/behind; be conservative.
			if (ctx.hasUI) {
				const ok = await ctx.ui.confirm(
					"Delete local branch?",
					`Branch ${branch} has an upstream (${upstream}), but I couldn't determine if it's fully pushed. Delete it anyway?`,
				);
				if (ok) {
					const del = await git(pi, repo.mainRoot, ["branch", "-D", branch]);
					branchDeleted = del.code === 0;
				}
			}
		} else {
			// Fully pushed (or behind) - safe to delete locally.
			// Use -d (not -D) as an extra safety net (refuses if the branch isn't merged into the current HEAD).
			const del = await git(pi, repo.mainRoot, ["branch", "-d", branch]);
			branchDeleted = del.code === 0;

			if (!branchDeleted && ctx.hasUI) {
				const details = [del.stdout.trim(), del.stderr.trim()].filter(Boolean).join("\n");
				const ok = await ctx.ui.confirm(
					"Force delete local branch?",
					`git branch -d ${branch} failed.${details ? `\n\n${details}` : ""}\n\nThis usually means the branch isn't merged into the main worktree's current branch.\n\nThe branch appears fully pushed to ${upstream}. Force delete it with -D?`,
				);
				if (ok) {
					const forceDel = await git(pi, repo.mainRoot, ["branch", "-D", branch]);
					branchDeleted = forceDel.code === 0;
					if (!branchDeleted) {
						const forceDetails = [forceDel.stdout.trim(), forceDel.stderr.trim()].filter(Boolean).join("\n");
						const firstLine = (forceDetails || "unknown error").split("\n")[0] || "unknown error";
						ctx.ui.notify(`Failed to delete branch ${branch}: ${firstLine}`, "error");
					}
				}
			}
		}
	} else {
		if (ctx.hasUI) {
			const ok = await ctx.ui.confirm(
				"Delete local branch?",
				`Branch ${branch} has no upstream. Delete it anyway?`,
			);
			if (ok) {
				const del = await git(pi, repo.mainRoot, ["branch", "-D", branch]);
				branchDeleted = del.code === 0;
			}
		}
	}

	return {
		branch,
		worktreePath: wt.path,
		removed: true,
		branchDeleted,
	};
}

async function handleArchive(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string): Promise<void> {
	const tokens = tokenizeArgs(args);
	let branch = tokens[0];
	if (!branch || branch.startsWith("-")) {
		if (ctx.hasUI) ctx.ui.notify("Usage: /worktree archive <branch>", "warning");
		return;
	}

	branch = stripRefsHeadsPrefix(branch);
	if (!branch || branch.startsWith("-")) {
		if (ctx.hasUI) ctx.ui.notify("Usage: /worktree archive <branch>", "warning");
		return;
	}

	await ctx.waitForIdle();

	await withStatus(ctx, `Archiving worktree: ${branch}`, async () => {
		const repo = await getRepoInfo(pi, ctx.cwd);
		const defaultMain = await getDefaultMainBranch(pi, repo.mainRoot);

		await pruneWorktrees(pi, repo.mainRoot);
		const outcome = await archiveWorktree(pi, ctx, repo, branch, "prompt", defaultMain);

		if (!ctx.hasUI) return;

		if (outcome.removed) {
			ctx.ui.notify(
				`Archived ${branch} (${outcome.branchDeleted ? "branch deleted" : "branch kept"})`,
				"info",
			);
			return;
		}

		if (outcome.skippedReason === "cancelled") {
			ctx.ui.notify("Cancelled", "warning");
			return;
		}

		if (outcome.skippedReason === "no-worktree") {
			ctx.ui.notify(`No worktree found for branch: ${branch}`, "warning");
			return;
		}

		if (outcome.skippedReason === "main-worktree") {
			ctx.ui.notify(
				`Branch ${branch} is checked out in the main worktree; can't archive it. Use /worktree new ${branch} first.`,
				"warning",
			);
			return;
		}

		if (outcome.skippedReason === "current-cwd") {
			ctx.ui.notify(
				`Can't archive the worktree you're currently in. cd elsewhere and retry: ${outcome.worktreePath}`,
				"warning",
			);
			return;
		}

		ctx.ui.notify(`Skipped ${branch} (${outcome.skippedReason ?? "unknown"})`, "warning");
	});
}

async function handleClean(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	if (!(await ensureCanPrompt(ctx, "Cannot clean without UI"))) return;

	await ctx.waitForIdle();

	await withStatus(ctx, "Cleaning pushed worktrees", async () => {
		const repo = await getRepoInfo(pi, ctx.cwd);
		const defaultMain = await getDefaultMainBranch(pi, repo.mainRoot);

		// Ensure upstream info is up to date before deciding what's "pushed".
		const remotes = await git(pi, repo.mainRoot, ["remote"]);
		if (remotes.code === 0 && remotes.stdout.trim().length > 0) {
			if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, "Fetching remotes...");
			const fetch = await git(pi, repo.mainRoot, ["fetch", "--all", "--prune"], { timeout: FETCH_TIMEOUT_MS });
			if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, "Cleaning pushed worktrees");

			if (fetch.killed || fetch.code !== 0) {
				const details = [fetch.stdout.trim(), fetch.stderr.trim()].filter(Boolean).join("\n");
				throw new Error(
					`git fetch failed${
						fetch.killed ? ` (timed out after ${Math.round(FETCH_TIMEOUT_MS / 1000)}s)` : ""
					}${details ? `\n${details}` : ""}`,
				);
			}
		}

		await pruneWorktrees(pi, repo.mainRoot);
		const worktrees = await listWorktrees(pi, repo.mainRoot);

		const candidates: Array<{ branch: string; worktree: WorktreeInfo; dirty: boolean }> = [];
		const locked: ArchiveOutcome[] = [];

		for (const wt of worktrees) {
			if (!wt.branchRef || wt.detached) continue;
			if (wt.path === repo.mainRoot) continue;
			if (isSameOrInsidePath(ctx.cwd, wt.path)) continue;

			const branch = branchNameFromRef(wt.branchRef);
			const upstream = await getUpstream(pi, repo.mainRoot, branch);
			if (!upstream) continue;

			if (wt.locked) {
				locked.push({
					branch,
					worktreePath: wt.path,
					removed: false,
					branchDeleted: false,
					skippedReason: wt.lockedReason ? `locked: ${wt.lockedReason}` : "locked",
				});
				continue;
			}

			candidates.push({ branch, worktree: wt, dirty: await isDirty(pi, wt.path) });
		}

		if (candidates.length === 0) {
			if (locked.length === 0) {
				ctx.ui.notify("No pushed worktrees to archive", "info");
				return;
			}

			const lines = [
				"Archived worktrees: 0",
				"",
				`Skipped: ${locked.length}`,
				...locked.map((o) => `- ${o.branch} -> ${o.worktreePath} (${o.skippedReason ?? "unknown"})`),
			];

			ctx.ui.notify("No removable pushed worktrees (some are locked)", "warning");
			await ctx.ui.editor("Worktree clean results", lines.join("\n"));
			return;
		}

		let dirtyAction: DirtyAction = "skip";
		const dirtyCount = candidates.filter((c) => c.dirty).length;

		if (dirtyCount > 0) {
			const choice = await ctx.ui.select(
				`Found ${candidates.length} pushed worktree(s): ${candidates.length - dirtyCount} clean, ${dirtyCount} dirty`,
				[
					"Archive clean only (skip dirty)",
					"Stash dirty (including untracked) and archive all",
					"Force remove dirty and archive all (lose changes)",
					"Cancel",
				],
			);

			if (!choice || choice === "Cancel") {
				ctx.ui.notify("Cancelled", "warning");
				return;
			}

			dirtyAction = choice.startsWith("Stash") ? "stash" : choice.startsWith("Force") ? "force" : "skip";
		} else {
			const ok = await ctx.ui.confirm(
				"Archive pushed worktrees?",
				`Archive ${candidates.length} pushed worktree(s)?`,
			);
			if (!ok) {
				ctx.ui.notify("Cancelled", "warning");
				return;
			}
			dirtyAction = "stash";
		}

		const archived: ArchiveOutcome[] = [];
		const skipped: ArchiveOutcome[] = [...locked];

		for (const c of candidates) {
			const outcome = await archiveWorktree(pi, ctx, repo, c.branch, dirtyAction, defaultMain, c.worktree);
			if (outcome.removed) archived.push(outcome);
			else skipped.push(outcome);
		}

		const lines: string[] = [];
		lines.push(`Archived worktrees: ${archived.length}`);
		for (const o of archived) {
			lines.push(`- ${o.branch} -> ${o.worktreePath}${o.branchDeleted ? " (branch deleted)" : ""}`);
		}

		if (skipped.length > 0) {
			lines.push("");
			lines.push(`Skipped: ${skipped.length}`);
			for (const o of skipped) {
				lines.push(`- ${o.branch} -> ${o.worktreePath || "(unknown)"} (${o.skippedReason ?? "unknown"})`);
			}
		}

		if (ctx.hasUI) {
			ctx.ui.notify(`Archived ${archived.length} worktree(s)`, "info");
			await ctx.ui.editor("Worktree clean results", lines.join("\n"));
		}
	});
}

async function handleList(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	await ctx.waitForIdle();

	await withStatus(ctx, "Listing worktrees", async () => {
		const repo = await getRepoInfo(pi, ctx.cwd);
		const worktrees = await listWorktrees(pi, repo.mainRoot);

		const currentReal = realpathOrResolve(repo.currentRoot);
		const mainReal = realpathOrResolve(repo.mainRoot);

		const lines: string[] = [];
		lines.push(`Worktrees: ${worktrees.length}`);
		lines.push("");

		for (const wt of worktrees) {
			const wtReal = realpathOrResolve(wt.path);
			const isCurrent = wtReal === currentReal;
			const isMain = wtReal === mainReal;
			const marker = isCurrent ? "*" : " ";

			let branchLabel = "unknown";
			let upstream: string | null = null;

			if (wt.branchRef) {
				const branch = branchNameFromRef(wt.branchRef);
				branchLabel = branch;
				upstream = await getUpstream(pi, repo.mainRoot, branch);
			} else if (wt.detached) {
				branchLabel = wt.head ? `detached@${wt.head.slice(0, 7)}` : "detached";
			}

			const pathState = getWorktreePathState(wt.path);
			const status = pathState === "ok" ? await getDirtyState(pi, wt.path) : "unknown";

			const meta: string[] = [status];
			if (pathState !== "ok") meta.push(pathState);
			if (upstream) meta.push(`upstream:${upstream}`);
			if (wt.locked) meta.push(wt.lockedReason ? `locked:${wt.lockedReason}` : "locked");

			lines.push(`${marker} ${branchLabel} (${meta.join(", ")})${isMain ? " [main]" : ""}`);
			lines.push(`    ${wt.path}`);
		}

		if (ctx.hasUI) {
			await ctx.ui.editor("Worktrees", lines.join("\n"));
		} else {
			console.log(lines.join("\n"));
		}
	});
}

function parseSubcommand(args: string): { subcommand: Subcommand | null; rest: string } {
	const tokens = tokenizeArgs(args);
	const sub = tokens[0] as Subcommand | undefined;
	if (sub === "new" || sub === "archive" || sub === "clean" || sub === "list") {
		return { subcommand: sub, rest: tokens.slice(1).join(" ") };
	}
	return { subcommand: null, rest: args };
}

export default function worktreeExtension(pi: ExtensionAPI) {
	pi.registerCommand("worktree", {
		description: "Create and manage git worktrees",
		getArgumentCompletions: (argumentPrefix) => {
			const prefix = argumentPrefix ?? "";
			const tokens = tokenizeArgs(prefix);
			if (tokens.length === 0) {
				return [
					{ value: "new ", label: "new" },
					{ value: "archive ", label: "archive" },
					{ value: "clean", label: "clean" },
					{ value: "list", label: "list" },
				];
			}

			if (tokens.length === 1 && !prefix.endsWith(" ")) {
				const subcommands = ["new", "archive", "clean", "list"];
				return subcommands
					.filter((s) => s.startsWith(tokens[0]))
					.map((s) => ({
						value: s + (s === "new" || s === "archive" ? " " : ""),
						label: s,
					}));
			}

			// Keep it minimal and fast (no git calls here; completions must be sync)
			return null;
		},
		handler: async (args, ctx) => {
			const { subcommand, rest } = parseSubcommand(args);
			if (!subcommand) {
				if (ctx.hasUI) {
					ctx.ui.notify(
						"Usage: /worktree new <branch> [--from <ref>] | /worktree archive <branch> | /worktree clean | /worktree list",
						"info",
					);
				}
				return;
			}

			try {
				if (subcommand === "new") {
					await handleNew(pi, ctx, rest);
					return;
				}

				if (subcommand === "archive") {
					await handleArchive(pi, ctx, rest);
					return;
				}

				if (subcommand === "clean") {
					await handleClean(pi, ctx);
					return;
				}

				if (subcommand === "list") {
					await handleList(pi, ctx);
					return;
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				if (ctx.hasUI) ctx.ui.notify(message, "error");
				else throw err;
			}
		},
	});
}
