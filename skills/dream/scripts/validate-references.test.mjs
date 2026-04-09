import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const SCRIPT = "/Users/afzal/.agents/skills/dream/scripts/validate-references.mjs";

test("reports broken wikilinks with a likely suggestion", async () => {
  const vaultDir = await createVault({
    "Index.md": "# Index\n- [[Project - Agents]]\n",
    "Project - .agents.md": "# .agents\n",
  });

  await assert.rejects(
    execFile("node", [SCRIPT, "--vault", vaultDir, "--label", "test"]),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout, /SUMMARY files=2 references=1 fixed=0 unresolved=1/);
      assert.match(error.stdout, /suggestion \(high\): Project - \.agents \[note title\]/);
      return true;
    },
  );
});

test("applies high-confidence fixes for wikilinks and markdown note links", async () => {
  const vaultDir = await createVault({
    "Index.md": "# Index\n- [[Project - Agents]]\n- [Patterns](Patterns.md)\n",
    "Project - .agents.md": "# .agents\n",
    "docs/Patterns.md": "# Patterns\n",
  });

  const { stdout } = await execFile("node", [SCRIPT, "--vault", vaultDir, "--apply", "--label", "test"]);
  assert.match(stdout, /SUMMARY files=3 references=2 fixed=2 unresolved=0/);

  const indexContents = await fs.readFile(path.join(vaultDir, "Index.md"), "utf8");
  assert.match(indexContents, /\[\[Project - \.agents\]\]/);
  assert.match(indexContents, /\[Patterns\]\(docs\/Patterns\.md\)/);
});

test("ignores example links inside inline code", async () => {
  const vaultDir = await createVault({
    "Conventions.md": "# Conventions\n- Use `[[Note Name]]` for examples\n",
  });

  const { stdout } = await execFile("node", [SCRIPT, "--vault", vaultDir, "--label", "test"]);
  assert.match(stdout, /SUMMARY files=1 references=0 fixed=0 unresolved=0/);
});

async function createVault(files) {
  const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "dream-refcheck-"));

  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(vaultDir, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, contents, "utf8");
  }

  return vaultDir;
}
