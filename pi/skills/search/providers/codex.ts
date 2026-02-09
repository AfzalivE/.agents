import os from "node:os";
import { spawnSync } from "node:child_process";

const CLI_TIMEOUT_MS = 60_000;

function buildPrompt(query: string): string {
	return `Answer the user query using web search to ensure the information is up to date.

User query: ${query}

Requirements:
- Use web search.
- Prefer primary sources.
- Be concise.
- Include a "Sources" section with URLs.`;
}

export async function searchCodex(query: string): Promise<string> {
	const prompt = buildPrompt(query);

	const args = [
		"exec",
		"--skip-git-repo-check",
		"--color",
		"never",
		"-c",
		"web_search=\"live\"",
		prompt,
	];

	const res = spawnSync("codex", args, {
		cwd: os.tmpdir(),
		encoding: "utf8",
		timeout: CLI_TIMEOUT_MS,
		killSignal: "SIGKILL",
		maxBuffer: 1024 * 1024 * 20,
	});

	if (res.error) {
		const code = (res.error as any).code;
		if (code === "ETIMEDOUT") {
			throw new Error(`codex timed out after ${CLI_TIMEOUT_MS / 1000}s`);
		}
		throw res.error;
	}

	if (res.status !== 0) {
		const msg = `${res.stderr || ""}\n${res.stdout || ""}`.trim();
		throw new Error(msg || `codex exited with code ${res.status}`);
	}

	return (res.stdout || "").trim();
}
