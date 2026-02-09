import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

import type { SearchResult } from "./types.ts";

export interface ContentSnippetOptions {
	timeoutMs?: number;
	maxChars?: number;
}

export interface FillContentOptions extends ContentSnippetOptions {
	concurrency?: number;
}

export interface ReadableMarkdownOptions {
	timeoutMs?: number;
}

export function htmlToMarkdown(html: string): string {
	const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
	turndown.use(gfm);
	turndown.addRule("removeEmptyLinks", {
		filter: (node) => node.nodeName === "A" && !node.textContent?.trim(),
		replacement: () => "",
	});
	return turndown
		.turndown(html)
		.replace(/\[\\?\[\s*\\?\]\]\([^)]*\)/g, "")
		.replace(/ +/g, " ")
		.replace(/\s+,/g, ",")
		.replace(/\s+\./g, ".")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

async function forEachWithConcurrency<T>(
	items: T[],
	concurrency: number,
	fn: (item: T, index: number) => Promise<void>
): Promise<void> {
	if (items.length === 0) return;

	const limit = Math.max(1, Math.floor(concurrency));
	let nextIndex = 0;

	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (true) {
			const index = nextIndex++;
			if (index >= items.length) break;
			await fn(items[index], index);
		}
	});

	await Promise.all(workers);
}

export async function fetchPageContentSnippet(
	url: string,
	{ timeoutMs = 10000, maxChars = 5000 }: ContentSnippetOptions = {}
): Promise<string | null> {
	try {
		const response = await fetch(url, {
			headers: {
				"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
				Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
			},
			signal: AbortSignal.timeout(timeoutMs),
		});

		if (!response.ok) {
			return null;
		}

		const html = await response.text();
		const dom = new JSDOM(html, { url });
		const reader = new Readability(dom.window.document);
		const article = reader.parse();

		if (article?.content) {
			const markdown = htmlToMarkdown(article.content);
			if (markdown) return markdown.substring(0, maxChars);
		}

		// Fallback: try to get main content
		const fallbackDoc = new JSDOM(html, { url });
		const body = fallbackDoc.window.document;
		body.querySelectorAll("script, style, noscript, nav, header, footer, aside").forEach((el) => el.remove());
		const main = body.querySelector("main, article, [role='main'], .content, #content") || body.body;
		const text = main?.textContent || "";
		const cleaned = text.trim();

		if (cleaned.length > 100) {
			return cleaned.substring(0, maxChars);
		}

		return null;
	} catch {
		return null;
	}
}

export async function fillResultsContent(
	results: SearchResult[],
	{ concurrency = 5, timeoutMs = 10000, maxChars = 5000 }: FillContentOptions = {}
): Promise<void> {
	await forEachWithConcurrency(results, concurrency, async (r) => {
		if (!r.link) return;
		r.content = await fetchPageContentSnippet(r.link, { timeoutMs, maxChars });
	});
}

export async function fetchReadableMarkdown(
	url: string,
	{ timeoutMs = 15000 }: ReadableMarkdownOptions = {}
): Promise<{ title: string | null; markdown: string }> {
	const response = await fetch(url, {
		headers: {
			"User-Agent":
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
			"Accept-Language": "en-US,en;q=0.9",
		},
		signal: AbortSignal.timeout(timeoutMs),
	});

	if (!response.ok) {
		throw new Error(`HTTP ${response.status}: ${response.statusText}`);
	}

	const html = await response.text();
	const dom = new JSDOM(html, { url });
	const reader = new Readability(dom.window.document);
	const article = reader.parse();

	if (article?.content) {
		return {
			title: article.title || null,
			markdown: htmlToMarkdown(article.content),
		};
	}

	// Fallback: try to extract main content
	const fallbackDoc = new JSDOM(html, { url });
	const body = fallbackDoc.window.document;
	body.querySelectorAll("script, style, noscript, nav, header, footer, aside").forEach((el) => el.remove());

	const title = body.querySelector("title")?.textContent?.trim() || null;
	const main = body.querySelector("main, article, [role='main'], .content, #content") || body.body;

	const contentHtml = main?.innerHTML || "";
	if (contentHtml.trim().length > 100) {
		return {
			title,
			markdown: htmlToMarkdown(contentHtml),
		};
	}

	throw new Error("Could not extract readable content from this page.");
}
