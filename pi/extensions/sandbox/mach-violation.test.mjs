import test from "node:test";
import assert from "node:assert/strict";

import {
  detectMachLookupViolationFromLine,
  detectMachLookupViolations,
  getMachErrorFallback,
  getMachLookupArgumentCompletions,
  hasMacOSMachError,
  isValidMachLookupRule,
  matchesMachLookupRule,
  mutateMachLookupAllowList,
} from "./mach-violation.ts";

test("detects mach-lookup sandbox violations", () => {
  assert.deepEqual(
    detectMachLookupViolationFromLine("cald(12345) deny(1) mach-lookup com.apple.CalendarAgent"),
    {
      service: "com.apple.CalendarAgent",
      processName: "cald",
    },
  );
});

test("detects quoted mach-lookup services", () => {
  assert.deepEqual(
    detectMachLookupViolationFromLine('node(12345) deny(1) mach-lookup "com.apple.CoreServices.coreservicesd"'),
    {
      service: "com.apple.CoreServices.coreservicesd",
      processName: "node",
    },
  );
});

test("detects global-name formatted mach-lookup services", () => {
  assert.deepEqual(
    detectMachLookupViolationFromLine('node(12345) deny(1) mach-lookup (global-name "com.apple.foo")'),
    {
      service: "com.apple.foo",
      processName: "node",
    },
  );
});

test("ignores non mach-lookup violations", () => {
  assert.equal(
    detectMachLookupViolationFromLine("bash(12345) deny(1) file-read-data /Users/example/.ssh/id_rsa"),
    null,
  );
});

test("detects mach-lookup violations from sandbox annotations", () => {
  assert.deepEqual(
    detectMachLookupViolations(
      [
        "prefix",
        "<sandbox_violations>",
        "node(12345) deny(1) mach-lookup com.apple.foo",
        "node(12345) deny(1) mach-lookup com.apple.bar",
        "</sandbox_violations>",
      ].join("\n"),
      1,
    ),
    [{ service: "com.apple.bar", processName: "node" }],
  );
});

test("detects macOS Mach error output", () => {
  assert.equal(
    hasMacOSMachError("Error: The operation couldn’t be completed. (Mach error 4099 - unknown error code)"),
    true,
  );
  assert.equal(hasMacOSMachError("Mach error: 4099"), true);
  assert.equal(hasMacOSMachError("Operation not permitted"), false);
});

test("validates allowMachLookup rules", () => {
  assert.equal(isValidMachLookupRule("com.apple.CalendarAgent"), true);
  assert.equal(isValidMachLookupRule("com.apple.*"), true);
  assert.equal(isValidMachLookupRule("*"), true);
  assert.equal(isValidMachLookupRule("com.*.CalendarAgent"), false);
  assert.equal(isValidMachLookupRule("com.apple.Calendar Agent"), false);
});

test("matches exact and prefix allowMachLookup rules", () => {
  assert.equal(matchesMachLookupRule("com.apple.CalendarAgent", "com.apple.CalendarAgent"), true);
  assert.equal(matchesMachLookupRule("com.apple.CalendarAgent", "com.apple.*"), true);
  assert.equal(matchesMachLookupRule("com.apple.CalendarAgent", "*"), true);
  assert.equal(matchesMachLookupRule("com.apple.CalendarAgent", "com.apple.contacts"), false);
});

test("mutates the Mach lookup allow list", () => {
  const runtimeConfig = {
    network: {
      allowedDomains: [],
      deniedDomains: [],
      allowMachLookup: ["com.apple.foo"],
    },
    filesystem: {
      denyRead: [],
      allowWrite: [],
      denyWrite: [],
    },
  };

  assert.equal(mutateMachLookupAllowList(runtimeConfig, "add", "com.apple.bar"), true);
  assert.deepEqual(runtimeConfig.network.allowMachLookup, ["com.apple.foo", "com.apple.bar"]);
  assert.equal(mutateMachLookupAllowList(runtimeConfig, "add", "com.apple.bar"), false);
  assert.equal(mutateMachLookupAllowList(runtimeConfig, "remove", "com.apple.foo"), true);
  assert.deepEqual(runtimeConfig.network.allowMachLookup, ["com.apple.bar"]);
});

test("suggests Mach lookup remove completions from the allow list", () => {
  const completions = getMachLookupArgumentCompletions({
    tokens: ["mach-lookup", "remove", "com.apple.C"],
    endsWithSpace: false,
    runtimeConfig: {
      network: {
        allowedDomains: [],
        deniedDomains: [],
        allowMachLookup: ["com.apple.CalendarAgent", "com.apple.foo"],
      },
      filesystem: {
        denyRead: [],
        allowWrite: [],
        denyWrite: [],
      },
    },
    operationOptions: [
      { value: "add ", label: "add" },
      { value: "remove ", label: "remove" },
    ],
    getCommandCompletions: () => null,
    getStringValueCompletions: (base, _partial, values) =>
      values.map((value) => ({ value: `${base}${value}`, label: value })),
  });

  assert.deepEqual(completions, [
    {
      value: "mach-lookup remove com.apple.CalendarAgent",
      label: "com.apple.CalendarAgent",
    },
    {
      value: "mach-lookup remove com.apple.foo",
      label: "com.apple.foo",
    },
  ]);
});

test("builds a fallback event for generic Mach errors", () => {
  const fallback = getMachErrorFallback({
    output: "Error: Mach error 4099",
    command: "cald list",
    cwd: "/tmp",
  });

  assert.ok(fallback);
  assert.match(fallback.message, /macOS Mach error/);
  assert.deepEqual(
    {
      kind: fallback.event.kind,
      outcome: fallback.event.outcome,
      reason: fallback.event.reason,
      command: fallback.event.command,
      cwd: fallback.event.cwd,
    },
    {
      kind: "mach",
      outcome: "blocked",
      reason: "unknown",
      command: "cald list",
      cwd: "/tmp",
    },
  );
  assert.equal(getMachErrorFallback({ output: "permission denied", command: "cald list" }), null);
});
