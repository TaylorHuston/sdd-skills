import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readGitStatus } from "../src/commands/status.js";
import { findObsoleteGuidanceReferences } from "../src/guidance.js";

test("guidance diagnostics ignore negated historical and quoted obsolete references", () => {
  const references = findObsoleteGuidanceReferences([
    "Do not use /sdd-propose.",
    "Never read .sdd/story-driven-development.md.",
    "Historically we used /sdd-propose.",
    "The former workflow was .sdd/story-driven-development.md.",
    "We migrated from `Use /sdd-propose` to /sdd-change --plan.",
    "The instruction `Use /sdd-propose` appears in imported documentation.",
    "> Example: Use /sdd-propose.",
    "```md",
    "Use /sdd-propose.",
    "```",
  ].join("\n"));

  assert.deepEqual([...references], []);
});

test("guidance diagnostics still report affirmative obsolete instructions", () => {
  const references = findObsoleteGuidanceReferences([
    "Do not use /sdd-propose.",
    "Use /sdd-propose before implementation.",
    "Read .sdd/story-driven-development.md before working.",
    "/sdd-propose is required before implementation.",
    "The workflow is .sdd/story-driven-development.md and must be read before work.",
  ].join("\n"));

  assert.deepEqual([...references].sort(), ["command", "workflow"]);
});

test("guidance diagnostics classify each migration, negation, and modal form independently", () => {
  const cases = [
    ["We replaced Use /sdd-propose with /sdd-change --plan.", []],
    ["Agents are not required to read .sdd/story-driven-development.md.", []],
    ["It is incorrect to use /sdd-propose.", []],
    ["/sdd-propose is required before implementation.", ["command"]],
    [".sdd/story-driven-development.md is required reading.", ["workflow"]],
  ];
  for (const [source, expected] of cases) {
    assert.deepEqual([...findObsoleteGuidanceReferences(source)], expected, source);
  }
});

test("Git status returns a bounded degraded result when Git stalls", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-status-timeout-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fakeGit = join(root, "fake-git");
  await writeFile(fakeGit, "#!/bin/sh\nsleep 5\n", "utf8");
  await chmod(fakeGit, 0o755);

  const started = Date.now();
  const result = await readGitStatus(root, { command: fakeGit, timeoutMs: 30 });

  assert.equal(result.available, false);
  assert.equal(result.error, "Git status timed out");
  assert.ok(Date.now() - started < 2_000);
});
