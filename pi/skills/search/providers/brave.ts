import { fillResultsContent } from "../lib/content.ts";
import type { SearchResult } from "../lib/types.ts";

export function isBraveConfigured(): boolean {
	return Boolean(process.env.BRAVE_API_KEY && process.env.BRAVE_API_KEY.trim());
}

function getApiKey(): string | null {
	return process.env.BRAVE_API_KEY?.trim() || null;
}

async function fetchBraveResults(query: string, limit: number, apiKey: string): Promise<SearchResult[]> {
	const params = new URLSearchParams({
		q: query,
		count: Math.min(limit, 20).toString(),
		country: "US",
	});

	const url = `https://api.search.brave.com/res/v1/web/search?${params.toString()}`;

	const response = await fetch(url, {
		headers: {
			Accept: "application/json",
			"Accept-Encoding": "gzip",
			"X-Subscription-Token": apiKey,
		},
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`HTTP ${response.status}: ${response.statusText}\n${errorText}`);
	}

	const data = await response.json();

	const results: SearchResult[] = [];
	if (data.web?.results) {
		for (const result of data.web.results) {
			if (results.length >= limit) break;
			results.push({
				title: result.title || "",
				link: result.url || "",
				snippet: result.description || "",
				age: result.age || result.page_age || "",
				content: null,
			});
		}
	}

	return results;
}

export async function searchBrave(
	query: string,
	{ limit = 5, content = false }: { limit?: number; content?: boolean } = {}
): Promise<SearchResult[]> {
	const apiKey = getApiKey();
	if (!apiKey) {
		throw new Error("BRAVE_API_KEY environment variable is required.");
	}

	const cappedLimit = Math.min(Math.max(1, limit), 20);
	const results = await fetchBraveResults(query, cappedLimit, apiKey);

	if (content) {
		await fillResultsContent(results, { concurrency: 5 });
	}

	return results;
}
