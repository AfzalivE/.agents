import type { SearchResult } from "./types.ts";

export function printSearchResults(results: SearchResult[] | null | undefined): void {
	if (!results || results.length === 0) {
		console.error("No results found.");
		return;
	}

	for (let i = 0; i < results.length; i++) {
		const r = results[i];
		console.log(`--- Result ${i + 1} ---`);
		console.log(`Title: ${r.title || ""}`);
		console.log(`Link: ${r.link || ""}`);
		if (r.age) {
			console.log(`Age: ${r.age}`);
		}
		console.log(`Snippet: ${r.snippet || ""}`);
		if (r.content) {
			console.log(`Content:\n${r.content}`);
		}
		console.log("");
	}
}
