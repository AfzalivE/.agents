#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_VAULT_DIR = path.join(process.env.HOME ?? "", ".agents", "agent-brain");
const MIN_SHRINK_RATIO = 0.85;
const MIN_RETENTION_RATIO = 0.93;
const MAX_ABSOLUTE_LINE_CHANGES = 2;

async function main() {
  const options = parseArgs(process.argv.slice(2));

  switch (options.command) {
    case "snapshot":
      await writeSnapshot(options);
      return;
    case "verify":
      await verifySnapshot(options);
      return;
    default:
      fail(`Unknown command: ${options.command}`);
  }
}

function parseArgs(argv) {
  const options = {
    command: "",
    label: "",
    output: "",
    snapshot: "",
    tags: ["planning"],
    vaultDir: DEFAULT_VAULT_DIR,
  };

  if (argv.length === 0) {
    printUsage();
    process.exit(2);
  }

  options.command = argv[0];

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--vault":
        index += 1;
        options.vaultDir = requireValue("--vault", argv[index]);
        break;
      case "--output":
        index += 1;
        options.output = requireValue("--output", argv[index]);
        break;
      case "--snapshot":
        index += 1;
        options.snapshot = requireValue("--snapshot", argv[index]);
        break;
      case "--label":
        index += 1;
        options.label = requireValue("--label", argv[index]);
        break;
      case "--tags":
        index += 1;
        options.tags = requireValue("--tags", argv[index])
          .split(",")
          .map((tag) => unquote(tag.trim()).toLowerCase())
          .filter(Boolean);
        if (options.tags.length === 0) {
          fail("Missing value for --tags");
        }
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
  console.log(`Usage:
  check-plan-integrity.mjs snapshot --vault <path> --output <file> [--tags <tag1,tag2>]
  check-plan-integrity.mjs verify --vault <path> --snapshot <file> [--label <name>] [--tags <tag1,tag2>]

Protects configured note tags from being trimmed, summarized, or rewritten during dream runs.
`);
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(2);
}

async function writeSnapshot({ output, tags, vaultDir }) {
  if (!output) {
    fail("snapshot requires --output");
  }

  const protectedNotes = await loadProtectedNotes(path.resolve(vaultDir), tags);
  const payload = {
    createdAt: new Date().toISOString(),
    notes: protectedNotes.map(serializeSnapshotNote),
  };

  await fs.writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function verifySnapshot({ label, snapshot, tags, vaultDir }) {
  if (!snapshot) {
    fail("verify requires --snapshot");
  }

  const snapshotData = JSON.parse(await fs.readFile(snapshot, "utf8"));
  const previousNotes = Array.isArray(snapshotData.notes) ? snapshotData.notes : [];
  const currentNotes = await loadProtectedNotes(path.resolve(vaultDir), tags);
  const verification = compareSnapshots(previousNotes, currentNotes);

  printVerificationReport(label, tags, verification);
  process.exit(verification.violations.length > 0 ? 1 : 0);
}

function serializeSnapshotNote(note) {
  return {
    bodyLines: note.bodyLines,
    hash: note.hash,
    relativePath: note.relativePath,
    title: note.title,
  };
}

async function loadProtectedNotes(vaultDir, tags) {
  const relativePaths = await walkMarkdownFiles(vaultDir, "");
  const notes = [];

  for (const relativePath of relativePaths.sort()) {
    const absolutePath = path.join(vaultDir, relativePath);
    const content = await fs.readFile(absolutePath, "utf8");
    if (!hasProtectedTag(content, tags)) {
      continue;
    }

    const body = stripFrontmatter(content);
    notes.push({
      absolutePath,
      bodyLines: normalizeBodyLines(body),
      hash: hashContent(content),
      relativePath: toPosix(relativePath),
      title: extractTitle(body, relativePath),
    });
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

function hasProtectedTag(content, protectedTags) {
  const tags = parseTagList(content);
  return protectedTags.some((tag) => tags.includes(tag));
}

function parseTagList(content) {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatterMatch) {
    return [];
  }

  const lines = frontmatterMatch[1].split(/\r?\n/);
  const tags = [];

  for (let index = 0; index < lines.length; index += 1) {
    const inlineMatch = lines[index].match(/^tags\s*:\s*(.*)$/);
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

        const value = unquote(itemMatch[1].trim()).toLowerCase();
        if (value) {
          tags.push(value);
        }
        index += 1;
      }
      continue;
    }

    if (rest.startsWith("[") && rest.endsWith("]")) {
      for (const part of rest.slice(1, -1).split(",")) {
        const value = unquote(part.trim()).toLowerCase();
        if (value) {
          tags.push(value);
        }
      }
      continue;
    }

    const single = unquote(rest).toLowerCase();
    if (single) {
      tags.push(single);
    }
  }

  return tags;
}

function stripFrontmatter(content) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
}

function normalizeBodyLines(body) {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

function extractTitle(body, relativePath) {
  const headingMatch = body.match(/^#\s+(.*)$/m);
  return headingMatch ? headingMatch[1].trim() : path.posix.basename(relativePath, ".md");
}

function hashContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function compareSnapshots(previousNotes, currentNotes) {
  const currentByHash = new Map();
  const currentByPath = new Map();

  for (const note of currentNotes) {
    const hashMatches = currentByHash.get(note.hash);
    if (hashMatches) {
      hashMatches.push(note);
    } else {
      currentByHash.set(note.hash, [note]);
    }

    currentByPath.set(note.relativePath, note);
  }

  const preserved = [];
  const changed = [];
  const violations = [];

  for (const previousNote of previousNotes) {
    const exactMatches = currentByHash.get(previousNote.hash) ?? [];
    if (exactMatches.length > 0) {
      preserved.push({
        from: previousNote.relativePath,
        to: exactMatches[0].relativePath,
        type: exactMatches[0].relativePath === previousNote.relativePath ? "unchanged" : "moved-intact",
      });
      continue;
    }

    const bestCandidate = findBestCandidate(previousNote, currentNotes, currentByPath);
    if (bestCandidate && isAllowedPlanChange(bestCandidate.metrics)) {
      changed.push({
        from: previousNote.relativePath,
        to: bestCandidate.note.relativePath,
        ...bestCandidate.metrics,
      });
      continue;
    }

    violations.push({
      bestCandidate: bestCandidate
        ? {
            metrics: bestCandidate.metrics,
            relativePath: bestCandidate.note.relativePath,
          }
        : null,
      relativePath: previousNote.relativePath,
      title: previousNote.title,
    });
  }

  return {
    changed,
    preserved,
    total: previousNotes.length,
    violations,
  };
}

function findBestCandidate(previousNote, currentNotes, currentByPath) {
  const preferred = [];
  const seen = new Set();

  const samePath = currentByPath.get(previousNote.relativePath);
  if (samePath) {
    preferred.push(samePath);
    seen.add(samePath.relativePath);
  }

  for (const note of currentNotes) {
    if (seen.has(note.relativePath)) {
      continue;
    }
    preferred.push(note);
  }

  let best = null;

  for (const note of preferred) {
    const metrics = comparePlanBodies(previousNote.bodyLines, note.bodyLines);
    const titleBonus = note.title === previousNote.title ? 1 : 0;
    const pathBonus = note.relativePath === previousNote.relativePath ? 1 : 0;

    const candidate = {
      metrics,
      note,
      score: [
        pathBonus,
        titleBonus,
        metrics.retentionRatio,
        metrics.shrinkRatio,
      ],
    };

    if (!best || compareScores(candidate.score, best.score) > 0) {
      best = candidate;
    }
  }

  return best;
}

function comparePlanBodies(previousLines, currentLines) {
  const lcs = longestCommonSubsequence(previousLines, currentLines);
  const previousCount = previousLines.length;
  const currentCount = currentLines.length;
  const removedLines = Math.max(0, previousCount - lcs);

  return {
    commonLines: lcs,
    currentCount,
    previousCount,
    removedLines,
    retentionRatio: previousCount === 0 ? 1 : lcs / previousCount,
    shrinkRatio: previousCount === 0 ? 1 : currentCount / previousCount,
  };
}

function isAllowedPlanChange(metrics) {
  return (
    metrics.shrinkRatio >= MIN_SHRINK_RATIO &&
    (metrics.retentionRatio >= MIN_RETENTION_RATIO || metrics.removedLines <= MAX_ABSOLUTE_LINE_CHANGES)
  );
}

function longestCommonSubsequence(left, right) {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array(columns).fill(0));

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      if (left[row - 1] === right[column - 1]) {
        matrix[row][column] = matrix[row - 1][column - 1] + 1;
      } else {
        matrix[row][column] = Math.max(matrix[row - 1][column], matrix[row][column - 1]);
      }
    }
  }

  return matrix[left.length][right.length];
}

function compareScores(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === right[index]) {
      continue;
    }
    return left[index] > right[index] ? 1 : -1;
  }

  return 0;
}

function printVerificationReport(label, tags, verification) {
  const labelSuffix = label ? ` (${label})` : "";
  console.log(`=== Protected Note Integrity${labelSuffix} ===`);
  console.log(
    `SUMMARY tags=${tags.join(",")} notes=${verification.total} preserved=${verification.preserved.length} changed=${verification.changed.length} violations=${verification.violations.length}`,
  );

  if (verification.changed.length > 0) {
    console.log("Allowed protected-note edits:");
    for (const change of verification.changed) {
      console.log(
        `  - ${change.from} -> ${change.to} [retained=${formatRatio(change.retentionRatio)}, shrink=${formatRatio(change.shrinkRatio)}]`,
      );
    }
  }

  if (verification.violations.length === 0) {
    console.log("No protected-note trimming, summarization, or rewrites detected.");
    return;
  }

  console.log("Protected-note integrity violations:");
  for (const violation of verification.violations) {
    console.log(`  - ${violation.relativePath}`);
    if (!violation.bestCandidate) {
      console.log("    no matching post-run protected note found");
      continue;
    }

    console.log(
      `    best match: ${violation.bestCandidate.relativePath} [retained=${formatRatio(violation.bestCandidate.metrics.retentionRatio)}, shrink=${formatRatio(violation.bestCandidate.metrics.shrinkRatio)}]`,
    );
  }
}

function formatRatio(value) {
  return `${Math.round(value * 100)}%`;
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
