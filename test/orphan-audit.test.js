import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const auditScript = join(
  import.meta.dirname,
  "..",
  "skills",
  "sdd-orphan-audit",
  "scripts",
  "sdd_orphan_audit.py",
);

async function write(root, path, content = "export const value = true;\n") {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

async function git(root, ...args) {
  return execFileAsync("git", ["-C", root, ...args]);
}

async function createRepository() {
  const root = await mkdtemp(join(tmpdir(), "sdd-orphan-audit-"));
  await git(root, "init", "--initial-branch=main");
  await git(root, "config", "user.email", "sdd@example.test");
  await git(root, "config", "user.name", "SDD Test");
  return root;
}

async function writeEpic(root, directory, id, implemented, verified) {
  await write(
    root,
    `docs/epics/${directory}/epic.md`,
    [
      "---",
      `id: ${id}`,
      "---",
      `# ${id}`,
      "",
      "#### Implemented By",
      "",
      ...implemented.map((path) => `- \`${path}\``),
      "",
      "#### Verified By",
      "",
      ...verified.map((path) => `- \`${path}\``),
      "",
    ].join("\n"),
  );
}

async function audit(root, ...args) {
  const { stdout } = await execFileAsync(
    "python3",
    [auditScript, root, "--format", "json", ...args],
  );
  return JSON.parse(stdout);
}

test("orphan audit expands globs, deduplicates basenames, and separates support files", async (t) => {
  const root = await createRepository();
  t.after(() => rm(root, { recursive: true, force: true }));

  await write(root, "src/core.ts");
  await write(root, "src/unowned.ts");
  await write(root, "migrations/001_users.ts");
  await write(root, "migrations/002_sessions.ts");
  await write(root, "test/core.test.ts");
  await write(root, "test/setup.ts");
  await write(root, "src/generated/api.ts", "// Generated file. Do not edit.\n");
  await write(root, "package.json", "{}\n");
  await writeEpic(
    root,
    "app-e001-core",
    "APP-E001",
    ["src/core.ts", "migrations/*.ts"],
    ["test/*.test.ts"],
  );
  await git(root, "add", ".");
  await git(root, "commit", "-m", "fixture");

  const report = await audit(root);

  assert.deepEqual(report.missing_implemented_refs, {});
  assert.deepEqual(report.missing_verified_refs, {});
  assert.deepEqual(report.tests_without_verified_by, []);
  assert.deepEqual(report.test_support_files, ["test/setup.ts"]);
  assert.deepEqual(report.source_without_implemented_by, ["src/unowned.ts"]);
  assert.deepEqual(report.support_files, ["package.json", "src/generated/api.ts"]);
});

test("orphan audit inventories the working tree instead of stale index entries", async (t) => {
  const root = await createRepository();
  t.after(() => rm(root, { recursive: true, force: true }));

  await write(root, "src/stale.ts");
  await writeEpic(root, "app-e001-core", "APP-E001", [], []);
  await git(root, "add", ".");
  await git(root, "commit", "-m", "fixture");
  await unlink(join(root, "src", "stale.ts"));

  const report = await audit(root);

  assert.match(report.inventory_source, /working tree/);
  assert.equal(report.source_without_implemented_by.includes("src/stale.ts"), false);
});

test("orphan audit supports Epic and changed-surface scopes", async (t) => {
  const root = await createRepository();
  t.after(() => rm(root, { recursive: true, force: true }));

  await write(root, "src/owned.ts");
  await write(root, "src/unchanged.ts");
  await writeEpic(root, "app-e001-core", "APP-E001", ["src/owned.ts"], []);
  await writeEpic(root, "app-e002-other", "APP-E002", ["src/unchanged.ts"], []);
  await git(root, "add", ".");
  await git(root, "commit", "-m", "fixture");
  await write(root, "src/changed.ts");

  const report = await audit(root, "--epic", "APP-E001", "--changed-from", "HEAD");

  assert.equal(report.counts.epics, 1);
  assert.deepEqual(report.scope.epics, ["docs/epics/app-e001-core/epic.md"]);
  assert.equal(report.scope.changed_from, "HEAD");
  assert.deepEqual(report.source_without_implemented_by, ["src/changed.ts"]);
});

test("orphan audit preserves primary and supporting implementation ownership", async (t) => {
  const root = await createRepository();
  t.after(() => rm(root, { recursive: true, force: true }));

  await write(root, "src/core.ts");
  await write(root, "src/adapter.ts");
  await write(
    root,
    "docs/epics/app-e001-core/epic.md",
    [
      "---",
      "id: APP-E001",
      "---",
      "# APP-E001",
      "",
      "#### Implemented By",
      "",
      "| Requirement / Scenario | Location / Anchor | Kind | Responsibility |",
      "|---|---|---|---|",
      "| S1/R1 | `src/core.ts#runCore` | primary | Owns behavior. |",
      "| S1/R1 | `src/adapter.ts#handleCore` | adapter | Delivers behavior. |",
      "",
      "#### Verified By",
      "",
    ].join("\n"),
  );
  await git(root, "add", ".");
  await git(root, "commit", "-m", "fixture");

  const report = await audit(root);

  assert.deepEqual(report.implementation_ownership, {
    "src/adapter.ts": {
      epics: ["docs/epics/app-e001-core/epic.md"],
      kinds: ["adapter"],
    },
    "src/core.ts": {
      epics: ["docs/epics/app-e001-core/epic.md"],
      kinds: ["primary"],
    },
  });
  assert.equal(report.counts.primary_implemented_refs, 1);
});

test("orphan audit parses canonical test anchors and ignores prose filenames", async (t) => {
  const root = await createRepository();
  t.after(() => rm(root, { recursive: true, force: true }));

  await write(root, "src/core.ts");
  await write(root, "test/core.test.ts");
  await write(root, "tasks.md", "supporting prose only\n");
  await write(
    root,
    "docs/epics/app-e001-core/epic.md",
    [
      "---",
      "id: APP-E001",
      "---",
      "# APP-E001",
      "",
      "#### Implemented By",
      "",
      "| Requirement / Scenario | Location / Anchor | Kind | Responsibility |",
      "|---|---|---|---|",
      "| S1/R1 | `src/core.ts#runCore` | primary | Owns behavior described in tasks.md. |",
      "",
      "#### Verified By",
      "",
      "| Requirement / Scenario | Evidence | Proves | Status |",
      "|---|---|---|---|",
      "| S1/R1-S1 | Automated test `test/core.test.ts#runs the core journey` | Confirms tasks.md behavior. | Passing |",
      "",
    ].join("\n"),
  );
  await git(root, "add", ".");
  await git(root, "commit", "-m", "fixture");

  const report = await audit(root);

  assert.deepEqual(report.missing_implemented_refs, {});
  assert.deepEqual(report.missing_verified_refs, {});
  assert.deepEqual(report.tests_without_verified_by, []);
  assert.equal(report.counts.verified_refs, 1);
});
