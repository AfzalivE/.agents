import { JSDOM } from "jsdom";

import { fillResultsContent } from "../lib/content.ts";
import type { SearchResult } from "../lib/types.ts";

export function isKagiConfigured(): boolean {
	return Boolean(process.env.KAGI_API_KEY && process.env.KAGI_API_KEY.trim());
}

function getApiKey(): string | null {
	return process.env.KAGI_API_KEY?.trim() || null;
}

function htmlSnippetToText(snippet: unknown): string {
	if (!snippet) return "";

	// Kagi snippets can include HTML (e.g. <b> highlights) and entities.
	try {
		const dom = new JSDOM(`<!doctype html><body>${String(snippet)}</body>`);
		const text = dom.window.document.body.textContent || "";
		return text.replace(/\s+/g, " ").trim();
	} catch {
		return String(snippet).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
	}
}

function formatAge(timestamp: unknown): string | null {
	if (!timestamp) return null;

	const date = new Date(String(timestamp));
	if (Number.isNaN(date.getTime())) return null;

	const diffMs = Date.now() - date.getTime();
	if (diffMs < 0) return null;

	const seconds = Math.max(1, Math.floor(diffMs / 1000));
	if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"} ago`;

	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

	const days = Math.floor(hours / 24);
	if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;

	if (days < 365) {
		const months = Math.floor(days / 30);
		return `${months} month${months === 1 ? "" : "s"} ago`;
	}

	const years = Math.floor(days / 365);
	return `${years} year${years === 1 ? "" : "s"} ago`;
}

async function fetchKagiResults(query: string, limit: number, apiKey: string): Promise<any> {
	const params = new URLSearchParams({
		q: query,
		limit: Math.max(1, limit).toString(),
	});

	const url = `https://kagi.com/api/v0/search?${params.toString()}`;

	const response = await fetch(url, {
		headers: {
			Accept: "application/json",
			Authorization: `Bot ${apiKey}`,
		},
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`HTTP ${response.status}: ${response.statusText}\n${errorText}`);
	}

	return await response.json();
}

export async function searchKagi(
	query: string,
	{ limit = 5, content = false }: { limit?: number; content?: boolean } = {}
): Promise<SearchResult[]> {
	const apiKey = getApiKey();
	if (!apiKey) {
		throw new Error("KAGI_API_KEY environment variable is required.");
	}

	const cappedLimit = Math.min(Math.max(1, limit), 20);
	const data = await fetchKagiResults(query, cappedLimit, apiKey);

	const objects = Array.isArray(data?.data) ? data.data : [];
	const results: SearchResult[] = objects
		.filter((o) => o && o.t === 0)
		.slice(0, cappedLimit)
		.map((r) => ({
			title: r.title || "",
			link: r.url || "",
			snippet: htmlSnippetToText(r.snippet),
			age: formatAge(r.published),
			content: null,
		}));

	if (content) {
		await fillResultsContent(results, { concurrency: 5 });
	}

	return results;
}
