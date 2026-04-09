#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");

const brainRoot = path.join(os.homedir(), ".agents", "agent-brain");
const agendaMocPath = path.join(brainRoot, "Agenda MOC.md");

function pad(value) {
  return String(value).padStart(2, "0");
}

function toLocalDateString(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toCurrentTimeLabel(date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(date);
}

function toMinutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function extractSection(markdown, headingPattern) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => headingPattern.test(line));
  if (start === -1) {
    return null;
  }

  const sectionLines = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      break;
    }
    sectionLines.push(lines[index]);
  }

  return sectionLines.join("\n").trim();
}

function parseAgendaLinks(markdown) {
  const section = extractSection(markdown, /^## Current Daily Agendas\s*$/i);
  if (!section) {
    return [];
  }

  return Array.from(section.matchAll(/\[\[Daily\/([0-9]{4}-[0-9]{2}-[0-9]{2})\]\]/g)).map(
    (match) => match[1]
  );
}

function resolveDailyNotePath(dateString) {
  const todayPath = path.join(brainRoot, "Daily", `${dateString}.md`);
  if (fs.existsSync(todayPath)) {
    return todayPath;
  }

  if (!fs.existsSync(agendaMocPath)) {
    return null;
  }

  const agendaMoc = readText(agendaMocPath);
  const agendaDates = parseAgendaLinks(agendaMoc);
  const fallbackDate = agendaDates.find((entry) => entry === dateString) || agendaDates[0];
  if (!fallbackDate) {
    return null;
  }

  const fallbackPath = path.join(brainRoot, "Daily", `${fallbackDate}.md`);
  return fs.existsSync(fallbackPath) ? fallbackPath : null;
}

function parseClockLabel(label, referenceMinutes = null) {
  const match = label.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  const candidates =
    hour === 12
      ? [minute, 12 * 60 + minute]
      : [hour * 60 + minute, (hour + 12) * 60 + minute];

  if (referenceMinutes === null) {
    if (hour >= 7 && hour <= 11) {
      return hour * 60 + minute;
    }
    if (hour === 12) {
      return 12 * 60 + minute;
    }
    return (hour % 12 + 12) * 60 + minute;
  }

  const nextCandidate = candidates.find((candidate) => candidate >= referenceMinutes);
  return nextCandidate === undefined ? candidates[candidates.length - 1] : nextCandidate;
}

function parseScheduleBlocks(markdown) {
  const section = extractSection(markdown, /^## .*schedule\s*$/i);
  if (!section) {
    return [];
  }

  const blocks = [];
  let lastEndMinutes = null;

  for (const line of section.split(/\r?\n/)) {
    const match = line.match(/^- `([^`]+)`\s+(.*)$/);
    if (!match) {
      continue;
    }

    const [startLabel, endLabel] = match[1].split("-").map((part) => part.trim());
    if (!startLabel || !endLabel) {
      continue;
    }

    const startMinutes = parseClockLabel(startLabel, lastEndMinutes);
    const endMinutes = parseClockLabel(endLabel, startMinutes);
    if (startMinutes === null || endMinutes === null || endMinutes < startMinutes) {
      continue;
    }

    blocks.push({
      rawRange: match[1],
      startLabel,
      endLabel,
      startMinutes,
      endMinutes,
      label: match[2],
    });

    lastEndMinutes = endMinutes;
  }

  return blocks;
}

function blockSummary(block) {
  if (!block) {
    return null;
  }

  return {
    rawRange: block.rawRange,
    startLabel: block.startLabel,
    endLabel: block.endLabel,
    label: block.label,
  };
}

function main() {
  const now = new Date();
  const localDate = toLocalDateString(now);
  const dailyNotePath = resolveDailyNotePath(localDate);

  if (!dailyNotePath) {
    console.log(
      JSON.stringify(
        {
          currentDate: localDate,
          currentTime: toCurrentTimeLabel(now),
          agendaMocPath,
          dailyNotePath: null,
          relation: "missing_agenda",
          currentBlock: null,
          previousBlock: null,
          nextBlock: null,
          remainingBlocks: [],
        },
        null,
        2
      )
    );
    return;
  }

  const dailyNote = readText(dailyNotePath);
  const blocks = parseScheduleBlocks(dailyNote);
  const nowMinutes = toMinutesSinceMidnight(now);

  let previousBlock = null;
  let currentBlock = null;
  let nextBlock = null;

  for (const block of blocks) {
    if (nowMinutes >= block.startMinutes && nowMinutes < block.endMinutes) {
      currentBlock = block;
      continue;
    }

    if (block.endMinutes <= nowMinutes) {
      previousBlock = block;
      continue;
    }

    if (block.startMinutes > nowMinutes) {
      nextBlock = block;
      break;
    }
  }

  let relation = "after_schedule";
  if (currentBlock) {
    relation = "in_block";
  } else if (blocks.length > 0 && nowMinutes < blocks[0].startMinutes) {
    relation = "before_first_block";
  } else if (nextBlock) {
    relation = "between_blocks";
  }

  const remainingBlocks = blocks
    .filter((block) => block.endMinutes > nowMinutes)
    .map((block) => blockSummary(block));

  console.log(
    JSON.stringify(
      {
        currentDate: localDate,
        currentTime: toCurrentTimeLabel(now),
        agendaMocPath,
        dailyNotePath,
        relation,
        currentBlock: blockSummary(currentBlock),
        previousBlock: blockSummary(previousBlock),
        nextBlock: blockSummary(nextBlock),
        remainingBlocks,
      },
      null,
      2
    )
  );
}

main();
