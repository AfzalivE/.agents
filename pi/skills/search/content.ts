#!/usr/bin/env node

import { fetchReadableMarkdown } from "./lib/content.ts";

const url = process.argv[2];

if (!url) {
	console.log("Usage: content.ts <url>");
	console.log("\nExtracts readable content from a webpage as markdown.");
	console.log("\nExamples:");
	console.log("  content.ts https://example.com/article");
	console.log("  content.ts https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html");
	process.exit(1);
}

try {
	const { title, markdown } = await fetchReadableMarkdown(url);

	if (title) {
		console.log(`# ${title}\n`);
	}
	console.log(markdown);
} catch (e) {
	console.error(e.message);
	process.exit(1);
}
