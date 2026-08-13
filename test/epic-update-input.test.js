import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { resolveEpicUpdateInput } from "../src/commands/epic-update-input.js";
import {
  createInitialConfig,
  createRepositoryConfig,
  writeRepositoryConfig,
  writeWorkspaceConfig,
} from "../src/config.js";
import { SddError } from "../src/errors.js";

const execFileAsync = promisify(execFile);

async function git(root, ...args) {
  return execFileAsync("git", ["-C", root, ...args]);
}

async function fixture(t) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "sdd-epic-update-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const repositoryRoot = join(workspaceRoot, "code", "sample-web");
  await mkdir(repositoryRoot, { recursive: true });
  await git(repositoryRoot, "init", "-q");
  await git(repositoryRoot, "config", "user.email", "test@example.com");
  await git(repositoryRoot, "config", "user.name", "Test User");
  await writeRepositoryConfig(repositoryRoot, createRepositoryConfig("sample-web"));
  await writeFile(join(repositoryRoot, "tracked.txt"), "baseline\n", "utf8");
  await git(repositoryRoot, "add", ".");
  await git(repositoryRoot, "commit", "-qm", "baseline");
  const { stdout } = await git(repositoryRoot, "rev-parse", "HEAD");
  const baseline = stdout.trim();

  const config = await createInitialConfig(workspaceRoot, {
    planningRoot: "ideas",
    repositoryRoots: ["code"],
  });
  config.ideas.sample = {
    status: "active",
    repositories: [{ root: "code", path: "sample-web", role: "web", status: "active" }],
  };
  await mkdir(join(workspaceRoot, "ideas", "sample"), { recursive: true });
  await writeWorkspaceConfig(workspaceRoot, config);
  return { workspaceRoot, repositoryRoot, baseline };
}

test("epic update input resolves an immutable committed candidate and changed paths", async (t) => {
  const { workspaceRoot, repositoryRoot, baseline } = await fixture(t);
  await writeFile(join(repositoryRoot, "tracked.txt"), "candidate\n", "utf8");
  await git(repositoryRoot, "add", "tracked.txt");
  await git(repositoryRoot, "commit", "-qm", "candidate");
  const { stdout } = await git(repositoryRoot, "rev-parse", "HEAD");
  const candidate = stdout.trim();

  const result = await resolveEpicUpdateInput(repositoryRoot, {
    workspaceRoot,
    baseline,
    candidate: "HEAD",
  });

  assert.equal(result.command, "epic-update-input");
  assert.equal(result.spaceId, "sample");
  assert.equal(result.repository.id, "sample-web");
  assert.equal(result.baseline, baseline);
  assert.equal(result.candidate.kind, "commit");
  assert.equal(result.candidate.commit, candidate);
  assert.deepEqual(result.changedPaths, [{ status: "M", path: "tracked.txt" }]);
  assert.equal(result.validation.command, "sdd");
  assert.deepEqual(result.validation.args, [
    "validate",
    "sample",
    "--repo",
    "sample-web",
    "--workspace",
    workspaceRoot,
    "--json",
  ]);
});

test("epic update input inventories staged, unstaged, and untracked working-tree state", async (t) => {
  const { workspaceRoot, repositoryRoot, baseline } = await fixture(t);
  await writeFile(join(repositoryRoot, "tracked.txt"), "staged\n", "utf8");
  await git(repositoryRoot, "add", "tracked.txt");
  await writeFile(join(repositoryRoot, "tracked.txt"), "unstaged\n", "utf8");
  await writeFile(join(repositoryRoot, "new file.txt"), "untracked\n", "utf8");

  const result = await resolveEpicUpdateInput(repositoryRoot, {
    workspaceRoot,
    baseline,
    candidate: "working-tree",
  });

  assert.equal(result.candidate.kind, "working-tree");
  assert.equal(result.candidate.head, baseline);
  assert.deepEqual(result.candidate.staged, ["tracked.txt"]);
  assert.deepEqual(result.candidate.unstaged, ["tracked.txt"]);
  assert.deepEqual(result.candidate.untracked, ["new file.txt"]);
  assert.match(result.candidate.watermark, new RegExp(`^working-tree:${baseline}:sha256:[a-f0-9]{64}$`));
  assert.deepEqual(result.changedPaths, [
    { status: "?", path: "new file.txt" },
    { status: "M", path: "tracked.txt" },
  ]);
});

test("epic update input watermark changes when tracked or untracked content changes", async (t) => {
  const { workspaceRoot, repositoryRoot, baseline } = await fixture(t);
  await writeFile(join(repositoryRoot, "tracked.txt"), "first\n", "utf8");
  await writeFile(join(repositoryRoot, "new.txt"), "first\n", "utf8");
  const first = await resolveEpicUpdateInput(repositoryRoot, {
    workspaceRoot,
    baseline,
    candidate: "working-tree",
  });

  await writeFile(join(repositoryRoot, "tracked.txt"), "second\n", "utf8");
  const tracked = await resolveEpicUpdateInput(repositoryRoot, {
    workspaceRoot,
    baseline,
    candidate: "working-tree",
  });
  assert.notEqual(tracked.candidate.watermark, first.candidate.watermark);

  await writeFile(join(repositoryRoot, "new.txt"), "second\n", "utf8");
  const untracked = await resolveEpicUpdateInput(repositoryRoot, {
    workspaceRoot,
    baseline,
    candidate: "working-tree",
  });
  assert.notEqual(untracked.candidate.watermark, tracked.candidate.watermark);

  await execFileAsync("chmod", ["755", join(repositoryRoot, "new.txt")]);
  const executable = await resolveEpicUpdateInput(repositoryRoot, {
    workspaceRoot,
    baseline,
    candidate: "working-tree",
  });
  assert.notEqual(executable.candidate.watermark, untracked.candidate.watermark);
});

test("epic update input disables repository-configured content filters", async (t) => {
  const { workspaceRoot, repositoryRoot, baseline } = await fixture(t);
  const sentinel = join(repositoryRoot, "filter-ran.txt");
  const filter = join(repositoryRoot, "filter.sh");
  await writeFile(filter, `#!/bin/sh\ntouch ${JSON.stringify(sentinel)}\ncat\n`, "utf8");
  await execFileAsync("chmod", ["755", filter]);
  await writeFile(join(repositoryRoot, ".gitattributes"), "tracked.txt filter=unsafe\n", "utf8");
  await git(repositoryRoot, "config", "filter.unsafe.clean", filter);
  await git(repositoryRoot, "config", "filter.unsafe.required", "true");
  await writeFile(join(repositoryRoot, "tracked.txt"), "candidate\n", "utf8");

  await resolveEpicUpdateInput(repositoryRoot, {
    workspaceRoot,
    baseline,
    candidate: "working-tree",
  });

  await assert.rejects(() => readFile(sentinel, "utf8"), (error) => error?.code === "ENOENT");
});

test("epic update input is read-only", async (t) => {
  const { workspaceRoot, repositoryRoot, baseline } = await fixture(t);
  await writeFile(join(repositoryRoot, "tracked.txt"), "candidate\n", "utf8");
  const before = await git(repositoryRoot, "status", "--porcelain=v2", "--untracked-files=normal");
  const configBefore = await readFile(join(repositoryRoot, ".sdd", "config.yaml"), "utf8");

  await resolveEpicUpdateInput(repositoryRoot, {
    workspaceRoot,
    baseline,
    candidate: "working-tree",
  });

  const after = await git(repositoryRoot, "status", "--porcelain=v2", "--untracked-files=normal");
  assert.equal(after.stdout, before.stdout);
  assert.equal(await readFile(join(repositoryRoot, ".sdd", "config.yaml"), "utf8"), configBefore);
});

test("epic update input rejects a baseline that is not an ancestor of a committed candidate", async (t) => {
  const { workspaceRoot, repositoryRoot } = await fixture(t);
  await git(repositoryRoot, "checkout", "-qb", "other");
  await git(repositoryRoot, "commit", "--allow-empty", "-qm", "other");
  const { stdout: candidateOutput } = await git(repositoryRoot, "rev-parse", "HEAD");
  await git(repositoryRoot, "checkout", "-q", "-");
  await git(repositoryRoot, "commit", "--allow-empty", "-qm", "diverged");
  const { stdout: baselineOutput } = await git(repositoryRoot, "rev-parse", "HEAD");

  await assert.rejects(
    () => resolveEpicUpdateInput(repositoryRoot, {
      workspaceRoot,
      baseline: baselineOutput.trim(),
      candidate: candidateOutput.trim(),
    }),
    (error) => error instanceof SddError && error.code === "BASELINE_NOT_ANCESTOR",
  );
});
