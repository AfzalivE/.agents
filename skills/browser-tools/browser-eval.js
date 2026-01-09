#!/usr/bin/env node

import { connectBrowser, getActivePage, printResult } from "./utils.js";

const code = process.argv.slice(2).join(" ");
if (!code) {
  console.log("Usage: browser-eval.js 'code'");
  console.log("\nExamples:");
  console.log('  browser-eval.js "document.title"');
  console.log("  browser-eval.js \"document.querySelectorAll('a').length\"");
  process.exit(1);
}

const browser = await connectBrowser();
const page = await getActivePage(browser);

const result = await page.evaluate((c) => {
  const AsyncFunction = (async () => {}).constructor;
  return new AsyncFunction(`return (${c})`)();
}, code);

printResult(result);

await browser.disconnect();
