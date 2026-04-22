import test from "node:test";
import assert from "node:assert/strict";

import { findBlockedCommand } from "./command-policy.ts";

test("blocks a direct executable match", () => {
  assert.deepEqual(findBlockedCommand("npx create-vite@latest", ["npx"]), {
    blocked: "npx",
    executable: "npx",
    rawExecutable: "npx",
  });
});

test("blocks executables after env assignments and shell separators", () => {
  assert.deepEqual(findBlockedCommand("FOO=1 npm test && BAR=2 npx vitest", ["npx"]), {
    blocked: "npx",
    executable: "npx",
    rawExecutable: "npx",
  });
});

test("blocks nested shell command strings", () => {
  assert.deepEqual(findBlockedCommand("bash -lc 'npx create-vite@latest'", ["npx"]), {
    blocked: "npx",
    executable: "npx",
    rawExecutable: "npx",
  });
});

test("matches by basename for full executable paths", () => {
  assert.deepEqual(findBlockedCommand("/opt/homebrew/bin/npx prisma generate", ["npx"]), {
    blocked: "npx",
    executable: "npx",
    rawExecutable: "/opt/homebrew/bin/npx",
  });
});

test("supports exact raw executable matches", () => {
  assert.deepEqual(
    findBlockedCommand("/opt/homebrew/bin/npx prisma generate", ["/opt/homebrew/bin/npx"]),
    {
      blocked: "/opt/homebrew/bin/npx",
      executable: "npx",
      rawExecutable: "/opt/homebrew/bin/npx",
    },
  );
});

test("does not block non-command mentions", () => {
  assert.equal(findBlockedCommand("echo npx", ["npx"]), null);
  assert.equal(findBlockedCommand('printf "%s\n" "npx"', ["npx"]), null);
});
