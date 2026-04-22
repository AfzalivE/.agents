/**
 * Command policy helpers for sandbox extension.
 */

import { basename } from "node:path";

const SIMPLE_COMMAND_OPERATORS = new Set([
  "\n",
  ";",
  ";;",
  ";&",
  ";;&",
  "|",
  "||",
  "|&",
  "&",
  "&&",
  "(",
  ")",
]);
const SHELL_WRAPPERS = new Set(["bash", "sh", "zsh", "fish", "dash", "ksh"]);
const COMMAND_PREFIX_KEYWORDS = new Set(["!", "if", "then", "elif", "while", "until", "do"]);
const COMMAND_PREFIX_WRAPPERS = new Set(["builtin", "command", "noglob", "sudo", "time"]);

interface ShellWordToken {
  type: "word";
  value: string;
}

interface ShellOperatorToken {
  type: "operator";
  value: string;
}

type ShellToken = ShellWordToken | ShellOperatorToken;

export interface BlockedCommandMatch {
  blocked: string;
  executable: string;
  rawExecutable: string;
}

export function findBlockedCommand(
  command: string,
  blockedCommands: string[],
): BlockedCommandMatch | null {
  const normalizedBlockedCommands = blockedCommands
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (normalizedBlockedCommands.length === 0) return null;

  const tokens = tokenizeShellCommand(command);
  const words: string[] = [];

  const flush = (): BlockedCommandMatch | null => {
    if (words.length === 0) return null;

    const match = findBlockedCommandInSimpleCommand(words, normalizedBlockedCommands);
    words.length = 0;
    return match;
  };

  for (const token of tokens) {
    if (token.type === "operator") {
      const match = flush();
      if (match) return match;
      continue;
    }

    words.push(token.value);
  }

  return flush();
}

function findBlockedCommandInSimpleCommand(
  words: string[],
  blockedCommands: string[],
): BlockedCommandMatch | null {
  let index = 0;
  index = skipAssignments(words, index);

  while (index < words.length) {
    const word = words[index] ?? "";
    if (word.length === 0) {
      index += 1;
      continue;
    }

    if (COMMAND_PREFIX_KEYWORDS.has(word)) {
      index += 1;
      index = skipAssignments(words, index);
      continue;
    }

    if (word === "env") {
      index = skipEnvPrefix(words, index + 1);
      index = skipAssignments(words, index);
      continue;
    }

    if (COMMAND_PREFIX_WRAPPERS.has(word)) {
      index = skipShortOptions(words, index + 1);
      index = skipAssignments(words, index);
      continue;
    }

    const match = matchBlockedExecutable(word, blockedCommands);
    if (match) return match;

    const nestedMatch = findBlockedCommandInNestedShell(
      word,
      words.slice(index + 1),
      blockedCommands,
    );
    if (nestedMatch) return nestedMatch;

    return null;
  }

  return null;
}

function findBlockedCommandInNestedShell(
  executable: string,
  args: string[],
  blockedCommands: string[],
): BlockedCommandMatch | null {
  if (!SHELL_WRAPPERS.has(executableBasename(executable))) return null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (!isShellCommandStringFlag(arg)) continue;

    const nestedCommand = args[index + 1];
    if (typeof nestedCommand !== "string" || nestedCommand.length === 0) return null;
    return findBlockedCommand(nestedCommand, blockedCommands);
  }

  return null;
}

function isShellCommandStringFlag(value: string): boolean {
  if (value === "--command") return true;
  return /^-[A-Za-z]*c[A-Za-z]*$/.test(value);
}

function matchBlockedExecutable(
  executable: string,
  blockedCommands: string[],
): BlockedCommandMatch | null {
  const basenameValue = executableBasename(executable);

  for (const blocked of blockedCommands) {
    if (blocked === executable || blocked === basenameValue) {
      return {
        blocked,
        executable: basenameValue,
        rawExecutable: executable,
      };
    }
  }

  return null;
}

function executableBasename(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return trimmed;
  return basename(trimmed);
}

function skipAssignments(words: string[], index: number): number {
  let nextIndex = index;
  while (nextIndex < words.length && isEnvironmentAssignment(words[nextIndex] ?? "")) {
    nextIndex += 1;
  }
  return nextIndex;
}

function skipShortOptions(words: string[], index: number): number {
  let nextIndex = index;
  while (nextIndex < words.length) {
    const word = words[nextIndex] ?? "";
    if (word === "--") return nextIndex + 1;
    if (!/^-[^-]/.test(word)) return nextIndex;
    nextIndex += 1;
  }
  return nextIndex;
}

function skipEnvPrefix(words: string[], index: number): number {
  let nextIndex = index;
  while (nextIndex < words.length) {
    const word = words[nextIndex] ?? "";
    if (word === "--") return nextIndex + 1;
    if (/^-[^-]/.test(word) || isEnvironmentAssignment(word)) {
      nextIndex += 1;
      continue;
    }
    return nextIndex;
  }
  return nextIndex;
}

function isEnvironmentAssignment(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(value);
}

function tokenizeShellCommand(command: string): ShellToken[] {
  const tokens: ShellToken[] = [];
  let current = "";
  let quote: "single" | "double" | null = null;
  let escapeNext = false;
  let comment = false;

  const pushWord = (): void => {
    if (current.length === 0) return;
    tokens.push({ type: "word", value: current });
    current = "";
  };

  const pushOperator = (value: string): void => {
    pushWord();
    if (SIMPLE_COMMAND_OPERATORS.has(value)) {
      tokens.push({ type: "operator", value });
    }
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? "";

    if (comment) {
      if (char === "\n") {
        comment = false;
        pushOperator("\n");
      }
      continue;
    }

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (quote === "single") {
      if (char === "'") {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (quote === "double") {
      if (char === '"') {
        quote = null;
      } else if (char === "\\") {
        const next = command[index + 1] ?? "";
        if (next === '"' || next === "\\" || next === "$" || next === "`") {
          current += next;
          index += 1;
        } else {
          current += char;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (char === "'") {
      quote = "single";
      continue;
    }

    if (char === '"') {
      quote = "double";
      continue;
    }

    if (char === "#" && current.length === 0) {
      pushWord();
      comment = true;
      continue;
    }

    if (char === "\n") {
      pushOperator("\n");
      continue;
    }

    if (/\s/.test(char)) {
      pushWord();
      continue;
    }

    const twoCharOperator = command.slice(index, index + 2);
    const threeCharOperator = command.slice(index, index + 3);
    if (SIMPLE_COMMAND_OPERATORS.has(threeCharOperator)) {
      pushOperator(threeCharOperator);
      index += 2;
      continue;
    }
    if (SIMPLE_COMMAND_OPERATORS.has(twoCharOperator)) {
      pushOperator(twoCharOperator);
      index += 1;
      continue;
    }
    if (SIMPLE_COMMAND_OPERATORS.has(char)) {
      pushOperator(char);
      continue;
    }

    current += char;
  }

  pushWord();
  return tokens;
}
