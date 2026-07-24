import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  chmod,
  mkdtemp,
  mkdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
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

test("orphan audit rejects option-like changed-from input without Git side effects", async (t) => {
  const root = await createRepository();
  const injectedOutput = `${root}-git-output`;
  const sideEffectPath = `${injectedOutput}...HEAD`;
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(sideEffectPath, { force: true }));

  await write(root, "src/core.ts");
  await writeEpic(root, "app-e001-core", "APP-E001", ["src/core.ts"], []);
  await git(root, "add", ".");
  await git(root, "commit", "-m", "fixture");

  await assert.rejects(
    execFileAsync(
      "python3",
      [
        auditScript,
        root,
        "--format",
        "json",
        `--changed-from=--output=${injectedOutput}`,
      ],
    ),
    (error) => {
      assert.equal(error.code, 2);
      assert.match(error.stderr, /Unable to resolve changed-file scope from Git ref/);
      return true;
    },
  );
  await assert.rejects(access(sideEffectPath), { code: "ENOENT" });
});

test("orphan audit fails promptly with an actionable Git timeout", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-orphan-audit-timeout-"));
  const fakeBin = join(root, "bin");
  const fakeGit = join(fakeBin, "git");
  t.after(() => rm(root, { recursive: true, force: true }));

  await mkdir(fakeBin, { recursive: true });
  await writeFile(
    fakeGit,
    [
      "#!/usr/bin/env python3",
      "import time",
      "time.sleep(0.4)",
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(fakeGit, 0o755);

  await assert.rejects(
    execFileAsync(
      "python3",
      [auditScript, root, "--format", "json"],
      {
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          SDD_ORPHAN_AUDIT_GIT_TIMEOUT_SECONDS: "0.05",
        },
      },
    ),
    (error) => {
      assert.equal(error.code, 2);
      assert.match(
        error.stderr,
        /Git command timed out after 0.05 seconds while listing tracked files; verify Git is responsive and retry/,
      );
      return true;
    },
  );
});

test("orphan audit fails closed when any changed-surface Git command fails", async (t) => {
  const root = await createRepository();
  const fakeBinRoot = await mkdtemp(join(tmpdir(), "sdd-orphan-audit-fake-git-"));
  const fakeGit = join(fakeBinRoot, "git");
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(fakeBinRoot, { recursive: true, force: true }));

  await write(root, "src/core.ts", "export const value = 1;\n");
  await writeEpic(root, "app-e001-core", "APP-E001", [], []);
  await git(root, "add", ".");
  await git(root, "commit", "-m", "fixture");
  await write(root, "src/core.ts", "export const value = 2;\n");
  await write(root, "src/untracked.ts");

  await writeFile(
    fakeGit,
    [
      "#!/usr/bin/env python3",
      "import os",
      "import sys",
      "",
      "args = sys.argv[1:]",
      "mode = os.environ['SDD_TEST_FAIL_GIT_MODE']",
      "should_fail = (",
      "    (mode == 'baseline' and 'diff' in args and '--end-of-options' in args)",
      "    or (mode == 'unstaged' and args[-4:] == ['diff', '--name-only', '-z', '--'])",
      "    or (mode == 'staged' and args[-5:] == ['diff', '--cached', '--name-only', '-z', '--'])",
      "    or (mode == 'untracked' and args[-4:] == ['ls-files', '-z', '--others', '--exclude-standard'])",
      ")",
      "if should_fail:",
      "    sys.stderr.write(f'injected {mode} failure\\n')",
      "    raise SystemExit(73)",
      "environment = os.environ.copy()",
      "environment['PATH'] = environment['SDD_TEST_REAL_PATH']",
      "os.execvpe('git', ['git', *args], environment)",
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(fakeGit, 0o755);

  const failures = new Map([
    ["baseline", "comparing the changed-file baseline"],
    ["unstaged", "listing unstaged changes"],
    ["staged", "listing staged changes"],
    ["untracked", "listing untracked changes"],
  ]);
  for (const [mode, operation] of failures) {
    await assert.rejects(
      execFileAsync(
        "python3",
        [
          auditScript,
          root,
          "--format",
          "json",
          "--epic",
          "APP-E001",
          "--changed-from",
          "HEAD",
        ],
        {
          env: {
            ...process.env,
            PATH: `${fakeBinRoot}:${process.env.PATH}`,
            SDD_TEST_FAIL_GIT_MODE: mode,
            SDD_TEST_REAL_PATH: process.env.PATH,
          },
        },
      ),
      (error) => {
        assert.equal(error.code, 2);
        assert.match(
          error.stderr,
          new RegExp(
            `Git command failed while ${operation}; verify Git repository state and retry`,
          ),
        );
        return true;
      },
    );
  }
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
