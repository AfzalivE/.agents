import os from "node:os";
import { spawnSync } from "node:child_process";

const CLI_TIMEOUT_MS = 60_000;

function buildPrompt(query: string): string {
	return `Answer the user query. Search the web to ensure the information is up to date.

User query: ${query}

Requirements:
- Be concise.
- If you use sources, include a "Sources" section with URLs.`;
}

export async function searchClaudeCode(query: string): Promise<string> {
	const prompt = buildPrompt(query);

	// We want web access, but no filesystem/shell access. Claude Code's safest control is allowlisting.
	const args = [
		"-p",
		"--output-format",
		"text",
		"--permission-mode",
		"bypassPermissions",
		"--allowed-tools",
		"Search",
		"--disable-slash-commands",
		"--",
		prompt,
	];

	const res = spawnSync("claude", args, {
		cwd: os.tmpdir(),
		encoding: "utf8",
		timeout: CLI_TIMEOUT_MS,
		killSignal: "SIGKILL",
		maxBuffer: 1024 * 1024 * 20,
	});

	if (res.error) {
		const code = (res.error as any).code;
		if (code === "ETIMEDOUT") {
			throw new Error(`claude timed out after ${CLI_TIMEOUT_MS / 1000}s`);
		}
		throw res.error;
	}

	if (res.status !== 0) {
		const msg = `${res.stderr || ""}\n${res.stdout || ""}`.trim();
		throw new Error(msg || `claude exited with code ${res.status}`);
	}

	return (res.stdout || "").trim();
}
