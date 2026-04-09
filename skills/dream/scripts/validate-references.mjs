#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_VAULT_DIR = path.join(process.env.HOME ?? "", ".agents", "agent-brain");

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const vaultDir = path.resolve(options.vaultDir);
  const notes = await loadNotes(vaultDir);
  const index = buildIndex(notes);
  const analysis = analyzeReferences(notes, index);

  let appliedFixes = [];
  let finalAnalysis = analysis;

  if (options.apply && analysis.safeFixes.length > 0) {
    appliedFixes = await applySafeFixes(analysis.safeFixes);
    const rescannedNotes = await loadNotes(vaultDir);
    finalAnalysis = analyzeReferences(rescannedNotes, buildIndex(rescannedNotes));
  }

  printReport({
    label: options.label,
    filesScanned: notes.length,
    appliedFixes,
    analysis: finalAnalysis,
  });

  process.exit(finalAnalysis.unresolved.length > 0 ? 1 : 0);
}

function parseArgs(argv) {
  const options = {
    apply: false,
    label: "",
    vaultDir: DEFAULT_VAULT_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--apply":
        options.apply = true;
        break;
      case "--label":
        index += 1;
        options.label = requireValue("--label", argv[index]);
        break;
      case "--vault":
        index += 1;
        options.vaultDir = requireValue("--vault", argv[index]);
        break;
      case "-h":
      case "--help":
        printUsage();
        process.exit(0);
      default:
        fail(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function requireValue(flag, value) {
  if (!value) {
    fail(`Missing value for ${flag}`);
  }
  return value;
}

function printUsage() {
  console.log(`Usage: validate-references.mjs [--apply] [--label <name>] [--vault <path>]

Scans the agent-brain vault for broken wikilinks and markdown note links.

Options:
  --apply         Apply high-confidence fixes in-place, then re-scan
  --label <name>  Include a label in the report header
  --vault <path>  Vault root (default: ~/.agents/agent-brain)
`);
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(2);
}

async function loadNotes(vaultDir) {
  const relativePaths = await walkMarkdownFiles(vaultDir, "");
  const notes = [];

  for (const relativePath of relativePaths.sort()) {
    const absolutePath = path.join(vaultDir, relativePath);
    const content = await fs.readFile(absolutePath, "utf8");
    notes.push(createNote(vaultDir, relativePath, absolutePath, content));
  }

  return notes;
}

async function walkMarkdownFiles(rootDir, relativeDir) {
  const directoryPath = path.join(rootDir, relativeDir);
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const entryRelativePath = relativeDir ? path.posix.join(relativeDir, entry.name) : entry.name;
    const entryAbsolutePath = path.join(rootDir, entryRelativePath);

    if (entry.isDirectory()) {
      files.push(...(await walkMarkdownFiles(rootDir, entryRelativePath)));
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(entryRelativePath);
    }
  }

  return files;
}

function createNote(vaultDir, relativePath, absolutePath, content) {
  const posixPath = toPosix(relativePath);
  const pathWithoutExtension = stripMarkdownExtension(posixPath);
  const basename = path.posix.basename(pathWithoutExtension);
  const aliases = parseAliases(content);
  const headings = parseHeadings(content);

  return {
    absolutePath,
    basename,
    content,
    headings,
    pathKey: normalizePathKey(pathWithoutExtension),
    pathWithoutExtension,
    relativePath: posixPath,
    scanContent: maskIgnoredMarkdown(content),
    sourceDir: path.posix.dirname(posixPath) === "." ? "" : path.posix.dirname(posixPath),
    titleKey: normalizeNameKey(basename),
    aliasKeys: aliases.map(normalizeNameKey).filter(Boolean),
    aliases,
    vaultDir,
  };
}

function parseAliases(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return [];
  }

  const lines = match[1].split(/\r?\n/);
  const aliases = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const inlineMatch = line.match(/^aliases\s*:\s*(.*)$/);
    if (!inlineMatch) {
      continue;
    }

    const rest = inlineMatch[1].trim();
    if (!rest) {
      index += 1;
      while (index < lines.length) {
        const itemMatch = lines[index].match(/^\s*-\s+(.*)$/);
        if (!itemMatch) {
          index -= 1;
          break;
        }
        aliases.push(unquote(itemMatch[1].trim()));
        index += 1;
      }
      continue;
    }

    if (rest.startsWith("[") && rest.endsWith("]")) {
      for (const part of rest.slice(1, -1).split(",")) {
        const value = unquote(part.trim());
        if (value) {
          aliases.push(value);
        }
      }
      continue;
    }

    aliases.push(unquote(rest));
  }

  return aliases.filter(Boolean);
}

function parseHeadings(content) {
  const headings = [];
  const regex = /^(#{1,6})\s+(.*?)\s*#*\s*$/gm;

  for (const match of content.matchAll(regex)) {
    const rawText = match[2].trim();
    if (!rawText) {
      continue;
    }

    headings.push({
      rawText,
      textKey: normalizeHeadingText(rawText),
      slugKey: slugifyHeading(rawText),
    });
  }

  return headings;
}

function buildIndex(notes) {
  const byPath = new Map();
  const byBasename = new Map();
  const byAlias = new Map();
  const fuzzyCandidates = [];

  for (const note of notes) {
    addToIndex(byPath, note.pathKey, note);
    addToIndex(byBasename, normalizePathKey(note.basename), note);

    for (const aliasKey of note.aliasKeys) {
      addToIndex(byAlias, aliasKey, note);
    }

    fuzzyCandidates.push({
      key: note.titleKey,
      note,
      reason: "note title",
    });

    for (const alias of note.aliases) {
      const aliasKey = normalizeNameKey(alias);
      if (!aliasKey) {
        continue;
      }

      fuzzyCandidates.push({
        key: aliasKey,
        note,
        reason: `alias "${alias}"`,
      });
    }
  }

  return {
    byAlias,
    byBasename,
    byPath,
    fuzzyCandidates,
    notes,
  };
}

function addToIndex(map, key, note) {
  if (!key) {
    return;
  }

  const existing = map.get(key);
  if (existing) {
    existing.push(note);
    return;
  }

  map.set(key, [note]);
}

function analyzeReferences(notes, index) {
  const unresolved = [];
  const safeFixes = [];
  let referenceCount = 0;

  for (const note of notes) {
    const references = [
      ...findWikilinks(note),
      ...findMarkdownLinks(note),
    ].sort((left, right) => left.start - right.start);

    referenceCount += references.length;

    for (const reference of references) {
      const resolution = resolveReference(reference, note, index);
      if (resolution.ok) {
        continue;
      }

      unresolved.push(resolution);
      if (resolution.safeFix) {
        safeFixes.push(resolution.safeFix);
      }
    }
  }

  return {
    referenceCount,
    safeFixes,
    unresolved,
  };
}

function findWikilinks(note) {
  const references = [];
  const regex = /\[\[([^[\]]+?)\]\]/g;

  for (const match of note.scanContent.matchAll(regex)) {
    const fullMatch = match[0];
    const body = match[1];
    const separatorIndex = body.indexOf("|");
    const targetPart = separatorIndex >= 0 ? body.slice(0, separatorIndex) : body;
    const aliasPart = separatorIndex >= 0 ? body.slice(separatorIndex + 1) : "";
    const [rawTarget, rawAnchor = ""] = splitAtFirst(targetPart, "#");

    references.push({
      alias: aliasPart,
      anchor: rawAnchor.trim(),
      displayTarget: targetPart.trim(),
      end: match.index + fullMatch.length,
      kind: "wikilink",
      original: fullMatch,
      rawTarget: rawTarget.trim(),
      start: match.index,
    });
  }

  return references;
}

function findMarkdownLinks(note) {
  const references = [];
  const regex = /(?<bang>!?)\[(?<label>[^\]]*)\]\((?<destination>[^)]+)\)/g;

  for (const match of note.scanContent.matchAll(regex)) {
    if (match.groups?.bang === "!") {
      continue;
    }

    const destination = match.groups?.destination ?? "";
    const split = splitMarkdownDestination(destination);
    if (!split.target) {
      continue;
    }

    const decodedTarget = decodeTarget(split.target);
    if (isExternalTarget(decodedTarget)) {
      continue;
    }

    const [rawTarget, rawAnchor = ""] = splitAtFirst(decodedTarget, "#");

    references.push({
      anchor: rawAnchor.trim(),
      destinationSuffix: split.suffix,
      displayTarget: split.target,
      end: match.index + match[0].length,
      kind: "markdown",
      label: match.groups?.label ?? "",
      original: match[0],
      rawTarget: rawTarget.trim(),
      start: match.index,
      wrappedInAngles: split.wrappedInAngles,
    });
  }

  return references;
}

function splitMarkdownDestination(destination) {
  const trimmed = destination.trim();
  if (!trimmed) {
    return { suffix: "", target: "", wrappedInAngles: false };
  }

  if (trimmed.startsWith("<")) {
    const closingIndex = trimmed.indexOf(">");
    if (closingIndex >= 0) {
      return {
        suffix: trimmed.slice(closingIndex + 1).trim(),
        target: trimmed.slice(1, closingIndex),
        wrappedInAngles: true,
      };
    }
  }

  const parts = trimmed.split(/\s+/, 2);
  return {
    suffix: trimmed.slice(parts[0].length).trim(),
    target: parts[0],
    wrappedInAngles: false,
  };
}

function decodeTarget(target) {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function isExternalTarget(target) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target);
}

function resolveReference(reference, sourceNote, index) {
  const noteResolution = resolveTargetNote(reference, sourceNote, index);
  if (!noteResolution.ok) {
    return buildNoteFailure(reference, sourceNote, noteResolution);
  }

  if (!reference.anchor) {
    return { ok: true };
  }

  const headingResolution = resolveHeading(reference.anchor, noteResolution.note, reference.kind);
  if (headingResolution.ok) {
    return { ok: true };
  }

  return buildHeadingFailure(reference, sourceNote, noteResolution.note, headingResolution);
}

function resolveTargetNote(reference, sourceNote, index) {
  if (!reference.rawTarget || reference.rawTarget === ".") {
    return {
      note: sourceNote,
      ok: true,
      targetStyle: "self",
    };
  }

  const rawTarget = reference.rawTarget.replace(/\\/g, "/");
  const exactPathMatches = uniqueMatches(index.byPath.get(normalizePathKey(stripMarkdownExtension(rawTarget))));

  if (reference.kind === "markdown") {
    const exactMarkdownMatch = resolveMarkdownPath(rawTarget, sourceNote, index);
    if (exactMarkdownMatch) {
      return {
        note: exactMarkdownMatch,
        ok: true,
        targetStyle: "markdown",
      };
    }

    return {
      ok: false,
      suggestions: suggestNotes(rawTarget, index),
    };
  }

  if (rawTarget.includes("/")) {
    if (exactPathMatches.length === 1) {
      return {
        note: exactPathMatches[0],
        ok: true,
        targetStyle: "path",
      };
    }

    return {
      ok: false,
      suggestions: suggestNotes(rawTarget, index),
    };
  }

  if (exactPathMatches.length === 1) {
    return {
      note: exactPathMatches[0],
      ok: true,
      targetStyle: "path",
    };
  }

  const basenameKey = normalizePathKey(path.posix.basename(stripMarkdownExtension(rawTarget)));
  const basenameMatches = uniqueMatches(index.byBasename.get(basenameKey));
  if (basenameMatches.length === 1) {
    return {
      note: basenameMatches[0],
      ok: true,
      targetStyle: "basename",
    };
  }

  const aliasMatches = uniqueMatches(index.byAlias.get(normalizeNameKey(rawTarget)));
  if (aliasMatches.length === 1) {
    return {
      note: aliasMatches[0],
      ok: true,
      targetStyle: "alias",
    };
  }

  const suggestions = suggestNotes(rawTarget, index);
  return {
    ok: false,
    suggestions,
  };
}

function resolveMarkdownPath(rawTarget, sourceNote, index) {
  const sourceDirectory = sourceNote.sourceDir || ".";
  const withExtension = rawTarget.toLowerCase().endsWith(".md") ? rawTarget : `${rawTarget}.md`;
  const resolved = path.posix.normalize(path.posix.join(sourceDirectory, withExtension));
  const normalized = normalizePathKey(stripMarkdownExtension(resolved));
  const matches = uniqueMatches(index.byPath.get(normalized));
  return matches.length === 1 ? matches[0] : null;
}

function buildNoteFailure(reference, sourceNote, noteResolution) {
  const line = lineNumberAt(sourceNote.content, reference.start);
  const primarySuggestion = noteResolution.suggestions[0] ?? null;
  const rewritten = primarySuggestion && primarySuggestion.confidence === "high"
    ? rewriteReference(reference, sourceNote, primarySuggestion.note, reference.anchor)
    : null;

  return {
    kind: "missing-note",
    line,
    note: sourceNote,
    original: reference.original,
    rawTarget: reference.displayTarget || reference.rawTarget,
    safeFix: rewritten && primarySuggestion?.confidence === "high"
      ? {
          end: reference.end,
          filePath: sourceNote.absolutePath,
          line,
          reason: primarySuggestion.reason,
          replacement: rewritten,
          start: reference.start,
        }
      : null,
    suggestions: noteResolution.suggestions,
  };
}

function resolveHeading(rawAnchor, note, kind) {
  const normalizedAnchor = normalizeHeadingText(rawAnchor);
  const slugAnchor = slugifyHeading(rawAnchor);

  for (const heading of note.headings) {
    if (kind === "wikilink" && heading.textKey === normalizedAnchor) {
      return { ok: true };
    }

    if (heading.slugKey === slugAnchor || heading.textKey === normalizedAnchor) {
      return { ok: true };
    }
  }

  const suggestions = suggestHeadings(rawAnchor, note);
  return {
    ok: false,
    suggestions,
  };
}

function buildHeadingFailure(reference, sourceNote, targetNote, headingResolution) {
  const line = lineNumberAt(sourceNote.content, reference.start);
  const primarySuggestion = headingResolution.suggestions[0] ?? null;
  const rewritten = primarySuggestion && primarySuggestion.confidence === "high"
    ? rewriteReference(reference, sourceNote, targetNote, primarySuggestion.heading.rawText)
    : null;

  return {
    kind: "missing-heading",
    line,
    note: sourceNote,
    original: reference.original,
    rawTarget: reference.displayTarget || reference.rawTarget,
    safeFix: rewritten && primarySuggestion?.confidence === "high"
      ? {
          end: reference.end,
          filePath: sourceNote.absolutePath,
          line,
          reason: `${primarySuggestion.reason} in ${formatNoteReference(targetNote)}`,
          replacement: rewritten,
          start: reference.start,
        }
      : null,
    suggestions: headingResolution.suggestions.map((suggestion) => ({
      confidence: suggestion.confidence,
      display: `${formatNoteReference(targetNote)}#${suggestion.heading.rawText}`,
      reason: suggestion.reason,
    })),
  };
}

function rewriteReference(reference, sourceNote, targetNote, anchor) {
  if (reference.kind === "wikilink") {
    return rewriteWikilink(reference, sourceNote, targetNote, anchor);
  }

  return rewriteMarkdownLink(reference, sourceNote, targetNote, anchor);
}

function rewriteWikilink(reference, sourceNote, targetNote, anchor) {
  const target = formatWikilinkTarget(sourceNote, targetNote, anchor);
  const aliasSuffix = reference.alias ? `|${reference.alias}` : "";
  return `[[${target}${aliasSuffix}]]`;
}

function formatWikilinkTarget(sourceNote, targetNote, anchor) {
  if (targetNote.absolutePath === sourceNote.absolutePath && anchor) {
    return `#${anchor}`;
  }

  let target = targetNote.pathWithoutExtension;
  if (anchor) {
    target += `#${anchor}`;
  }
  return target;
}

function rewriteMarkdownLink(reference, sourceNote, targetNote, anchor) {
  const sourceDirectory = sourceNote.sourceDir || ".";
  let destination = targetNote.absolutePath === sourceNote.absolutePath && anchor
    ? ""
    : path.posix.relative(sourceDirectory, targetNote.relativePath) || path.posix.basename(targetNote.relativePath);

  if (!reference.rawTarget.toLowerCase().endsWith(".md")) {
    destination = stripMarkdownExtension(destination);
  }

  if (reference.wrappedInAngles) {
    destination = `<${destination}>`;
  }

  if (anchor) {
    const anchorFragment = slugifyHeading(anchor);
    destination = destination ? `${destination}#${anchorFragment}` : `#${anchorFragment}`;
  }

  const suffix = reference.destinationSuffix ? ` ${reference.destinationSuffix}` : "";
  return `[${reference.label}](${destination}${suffix})`;
}

function suggestNotes(rawTarget, index) {
  const simpleKey = normalizeNameKey(path.posix.basename(stripMarkdownExtension(rawTarget)));
  const candidates = [];

  for (const candidate of index.fuzzyCandidates) {
    const score = similarityScore(simpleKey, candidate.key);
    if (score < 0.55) {
      continue;
    }

    candidates.push({
      confidence: score >= 0.88 ? "high" : score >= 0.72 ? "medium" : "low",
      display: formatNoteReference(candidate.note),
      note: candidate.note,
      reason: candidate.reason,
      score,
    });
  }

  return uniqueSuggestions(candidates)
    .sort((left, right) => right.score - left.score || left.display.localeCompare(right.display))
    .slice(0, 3);
}

function suggestHeadings(rawAnchor, note) {
  const anchorKey = normalizeHeadingText(rawAnchor);
  const suggestions = [];

  for (const heading of note.headings) {
    const score = Math.max(
      similarityScore(anchorKey, heading.textKey),
      similarityScore(slugifyHeading(rawAnchor), heading.slugKey),
    );

    if (score < 0.6) {
      continue;
    }

    suggestions.push({
      confidence: score >= 0.9 ? "high" : score >= 0.75 ? "medium" : "low",
      heading,
      reason: "similar heading",
      score,
    });
  }

  return suggestions
    .sort((left, right) => right.score - left.score || left.heading.rawText.localeCompare(right.heading.rawText))
    .slice(0, 3);
}

function uniqueSuggestions(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = candidate.note.absolutePath;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function similarityScore(left, right) {
  if (!left || !right) {
    return 0;
  }

  if (left === right) {
    return 1;
  }

  const distance = levenshteinDistance(left, right);
  const maxLength = Math.max(left.length, right.length);
  return maxLength === 0 ? 1 : 1 - distance / maxLength;
}

function levenshteinDistance(left, right) {
  const matrix = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));

  for (let row = 0; row <= left.length; row += 1) {
    matrix[row][0] = row;
  }

  for (let column = 0; column <= right.length; column += 1) {
    matrix[0][column] = column;
  }

  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + substitutionCost,
      );
    }
  }

  return matrix[left.length][right.length];
}

async function applySafeFixes(fixes) {
  const fixesByFile = new Map();

  for (const fix of fixes) {
    const existing = fixesByFile.get(fix.filePath);
    if (existing) {
      existing.push(fix);
      continue;
    }
    fixesByFile.set(fix.filePath, [fix]);
  }

  const applied = [];

  for (const [filePath, fileFixes] of fixesByFile) {
    const original = await fs.readFile(filePath, "utf8");
    let updated = original;

    for (const fix of [...fileFixes].sort((left, right) => right.start - left.start)) {
      updated = `${updated.slice(0, fix.start)}${fix.replacement}${updated.slice(fix.end)}`;
      applied.push(fix);
    }

    if (updated !== original) {
      await fs.writeFile(filePath, updated, "utf8");
    }
  }

  return applied.sort((left, right) => left.filePath.localeCompare(right.filePath) || left.line - right.line);
}

function printReport({ label, filesScanned, appliedFixes, analysis }) {
  const labelSuffix = label ? ` (${label})` : "";
  console.log(`=== Reference Integrity${labelSuffix} ===`);
  console.log(
    `SUMMARY files=${filesScanned} references=${analysis.referenceCount} fixed=${appliedFixes.length} unresolved=${analysis.unresolved.length}`,
  );

  if (appliedFixes.length > 0) {
    console.log("Applied fixes:");
    for (const fix of appliedFixes) {
      console.log(
        `  - ${path.basename(fix.filePath)}:${fix.line} -> ${truncateForReport(fix.replacement)} (${fix.reason})`,
      );
    }
  }

  if (analysis.unresolved.length === 0) {
    console.log("No broken references found.");
    return;
  }

  console.log("Broken references:");
  for (const issue of analysis.unresolved) {
    console.log(`  - ${path.basename(issue.note.absolutePath)}:${issue.line} ${truncateForReport(issue.original)}`);
    if (issue.suggestions.length === 0) {
      console.log("    suggestion: none");
      continue;
    }

    for (const suggestion of issue.suggestions) {
      console.log(`    suggestion (${suggestion.confidence}): ${suggestion.display} [${suggestion.reason}]`);
    }
  }
}

function truncateForReport(value) {
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

function maskIgnoredMarkdown(content) {
  let masked = content;
  const patterns = [
    /```[\s\S]*?```/g,
    /~~~[\s\S]*?~~~/g,
    /`[^`\n]*`/g,
  ];

  for (const pattern of patterns) {
    masked = masked.replace(pattern, (match) => match.replace(/[^\n]/g, " "));
  }

  return masked;
}

function uniqueMatches(matches = []) {
  const seen = new Set();
  return matches.filter((match) => {
    if (seen.has(match.absolutePath)) {
      return false;
    }
    seen.add(match.absolutePath);
    return true;
  });
}

function formatNoteReference(note) {
  return note.pathWithoutExtension;
}

function lineNumberAt(content, offset) {
  return content.slice(0, offset).split("\n").length;
}

function splitAtFirst(value, separator) {
  const index = value.indexOf(separator);
  if (index < 0) {
    return [value];
  }

  return [value.slice(0, index), value.slice(index + separator.length)];
}

function normalizePathKey(value) {
  return stripMarkdownExtension(value).replace(/\\/g, "/").replace(/^\.?\//, "").trim().toLowerCase();
}

function normalizeNameKey(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\.md$/iu, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeHeadingText(value) {
  return normalizeNameKey(
    String(value ?? "")
      .replace(/`+/g, "")
      .replace(/\*\*/g, "")
      .replace(/__/g, ""),
  );
}

function slugifyHeading(value) {
  return normalizeHeadingText(value).replace(/\s+/g, "-");
}

function stripMarkdownExtension(value) {
  return String(value ?? "").replace(/\.md$/iu, "");
}

function unquote(value) {
  return String(value ?? "").replace(/^['"]|['"]$/gu, "");
}

function toPosix(value) {
  return value.split(path.sep).join(path.posix.sep);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
