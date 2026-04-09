import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const SCRIPT = "/Users/afzal/.agents/skills/dream/scripts/check-plan-integrity.mjs";

test("allows intact plan moves", async () => {
  const vaultDir = await createVault({
    "Agentist - Scope Reauth Plan.md": [
      "---",
      "tags: [agenda]",
      "---",
      "",
      "# Agentist Scope Reauth Plan",
      "",
      "- step one",
      "- step two",
      "",
    ].join("\n"),
  });
  const snapshot = path.join(vaultDir, "snapshot.json");

  await execFile("node", [SCRIPT, "snapshot", "--vault", vaultDir, "--output", snapshot, "--tags", "agenda"]);
  await fs.mkdir(path.join(vaultDir, "archive", "plans"), { recursive: true });
  await fs.rename(
    path.join(vaultDir, "Agentist - Scope Reauth Plan.md"),
    path.join(vaultDir, "archive", "plans", "Agentist - Scope Reauth Plan.md"),
  );

  const { stdout } = await execFile("node", [SCRIPT, "verify", "--vault", vaultDir, "--snapshot", snapshot, "--label", "test", "--tags", "agenda"]);
  assert.match(stdout, /SUMMARY tags=agenda notes=1 preserved=1 changed=0 violations=0/);
});

test("allows small surgical plan edits", async () => {
  const vaultDir = await createVault({
    "Agentist - Scope Reauth Plan.md": [
      "---",
      "tags: [planning]",
      "---",
      "",
      "# Agentist Scope Reauth Plan",
      "",
      "Implementation notes are in [[Old Note]].",
      "Architectural rationale is in [[Decisions Log]].",
      "Keep the full checklist below.",
      "- step one",
      "- step two",
      "",
    ].join("\n"),
  });
  const snapshot = path.join(vaultDir, "snapshot.json");

  await execFile("node", [SCRIPT, "snapshot", "--vault", vaultDir, "--output", snapshot, "--tags", "planning"]);
  await fs.writeFile(
    path.join(vaultDir, "Agentist - Scope Reauth Plan.md"),
    [
      "---",
      "tags: [planning]",
      "---",
      "",
      "# Agentist Scope Reauth Plan",
      "",
      "Implementation notes are in [[MCP & Scope Reauth - Agentist]].",
      "Architectural rationale is in [[Decisions Log]].",
      "Keep the full checklist below.",
      "- step one",
      "- step two",
      "",
    ].join("\n"),
    "utf8",
  );

  const { stdout } = await execFile("node", [SCRIPT, "verify", "--vault", vaultDir, "--snapshot", snapshot, "--label", "test", "--tags", "planning"]);
  assert.match(stdout, /SUMMARY tags=planning notes=1 preserved=0 changed=1 violations=0/);
});

test("fails when a plan is trimmed into a summary", async () => {
  const vaultDir = await createVault({
    "Agentist - Scope Reauth Plan.md": [
      "---",
      "tags: [agenda]",
      "---",
      "",
      "# Agentist Scope Reauth Plan",
      "",
      "Original plan captured from .context.",
      "",
      "## Goals",
      "- preserve OAuth scope checks",
      "- add validation before execution",
      "- test reconnect flows",
      "",
      "## Tasks",
      "1. update service",
      "2. add tests",
      "3. document rollout",
      "",
    ].join("\n"),
  });
  const snapshot = path.join(vaultDir, "snapshot.json");

  await execFile("node", [SCRIPT, "snapshot", "--vault", vaultDir, "--output", snapshot, "--tags", "agenda"]);
  await fs.writeFile(
    path.join(vaultDir, "Agentist - Scope Reauth Plan.md"),
    [
      "---",
      "tags: [agenda]",
      "---",
      "",
      "# Agentist Scope Reauth Plan",
      "",
      "Implemented on 2026-02-24. See project notes for details.",
      "",
    ].join("\n"),
    "utf8",
  );

  await assert.rejects(
    execFile("node", [SCRIPT, "verify", "--vault", vaultDir, "--snapshot", snapshot, "--label", "test", "--tags", "agenda"]),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout, /violations=1/);
      assert.match(error.stdout, /Protected-note integrity violations:/);
      return true;
    },
  );
});

async function createVault(files) {
  const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "dream-plan-guard-"));

  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(vaultDir, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, contents, "utf8");
  }

  return vaultDir;
}
