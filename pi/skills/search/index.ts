#!/usr/bin/env node

import { isKagiConfigured, searchKagi } from "./providers/kagi.ts";
import { isBraveConfigured, searchBrave } from "./providers/brave.ts";
import { searchClaudeCode } from "./providers/claude-code.ts";
import { searchCodex } from "./providers/codex.ts";
import { printSearchResults } from "./lib/format.ts";
import { isCommandInstalled } from "./lib/which.ts";

const HELP = `Usage: index.ts <query> [options]

Unified web search with automatic provider selection.

Provider precedence:
  1) Kagi  (KAGI_API_KEY)
  2) Brave Search (BRAVE_API_KEY)
  3) Claude Code (claude)
  4) Codex (codex)

Options:
  -n <num>      Number of results (default: 5, max: 20)
  --content     Fetch and include page content (Kagi/Brave only)
  -h, --help    Show this help

Environment:
  KAGI_API_KEY   Kagi Search API token (optional)
  BRAVE_API_KEY  Brave Search API key (optional)
`;

type CliOptions = {
	query: string;
	limit: number;
	content: boolean;
	help: boolean;
	error: string | null;
};

function parseArgs(args: string[]): CliOptions {
	const options: CliOptions = {
		query: "",
		limit: 5,
		content: false,
		help: false,
		error: null,
	};

	const rest: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		switch (arg) {
			case "-h":
			case "--help":
				options.help = true;
				break;
			case "--content":
				options.content = true;
				break;
			case "-n": {
				const value = args[i + 1];
				if (!value) {
					options.error = "-n requires a number";
					return options;
				}

				const n = Number(value);
				if (!Number.isInteger(n)) {
					options.error = `-n must be an integer (got: ${value})`;
					return options;
				}

				if (n < 1) {
					options.error = "-n must be >= 1";
					return options;
				}

				options.limit = n;
				i++;
				break;
			}
			default:
				rest.push(arg);
		}
	}

	options.query = rest.join(" ").trim();
	return options;
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));

	if (options.help) {
		console.log(HELP);
		process.exit(0);
	}

	if (options.error) {
		console.error(options.error);
		process.exit(1);
	}

	if (!options.query) {
		console.log(HELP);
		process.exit(1);
	}

	const limit = Math.min(options.limit, 20);

	const providers = [
		{
			id: "kagi",
			name: "Kagi",
			available: isKagiConfigured(),
			reason: "no key",
			run: async () => {
				const results = await searchKagi(options.query, { limit, content: options.content });
				printSearchResults(results);
			},
		},
		{
			id: "brave",
			name: "Brave Search",
			available: isBraveConfigured(),
			reason: "no key",
			run: async () => {
				const results = await searchBrave(options.query, { limit, content: options.content });
				printSearchResults(results);
			},
		},
		{
			id: "claude",
			name: "Claude Code",
			available: isCommandInstalled("claude"),
			reason: "not installed",
			run: async () => {
				const text = await searchClaudeCode(options.query);
				if (!text) throw new Error("No output generated.");
				console.log(text);
			},
		},
		{
			id: "codex",
			name: "Codex",
			available: isCommandInstalled("codex"),
			reason: "not installed",
			run: async () => {
				const text = await searchCodex(options.query);
				if (!text) throw new Error("No output generated.");
				console.log(text);
			},
		},
	] as const;

	const skipped: string[] = [];
	let lastError: unknown = null;
	let hadAvailable = false;

	for (const provider of providers) {
		if (!provider.available) {
			skipped.push(`${provider.name}: ${provider.reason}`);
			continue;
		}

		hadAvailable = true;

		const suffix = skipped.length > 0 ? ` (${skipped.join(", ")})` : "";
		console.log(`Searching using ${provider.name}${suffix}...`);
		console.log("");

		try {
			await provider.run();
			return;
		} catch (e) {
			lastError = e;
			skipped.push(`${provider.name}: failed`);
		}
	}

	console.error(hadAvailable ? "All available search providers failed." : "No search provider available.");
	if (lastError instanceof Error && lastError.message) {
		console.error(lastError.message);
	}
	process.exit(1);
}

try {
	await main();
} catch (e) {
	console.error(e instanceof Error ? e.message : String(e));
	process.exit(1);
}
