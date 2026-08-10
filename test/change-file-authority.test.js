import assert from "node:assert/strict";
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { closeChange } from "../src/commands/change-close.js";
import { transitionChange } from "../src/commands/change-transition.js";
import { diagnoseWorkspace } from "../src/commands/doctor.js";
import { setupInstallation } from "../src/commands/init-installation.js";
import { getStatus } from "../src/commands/status.js";
import { validateArtifacts } from "../src/commands/validate.js";
import {
  getActiveChangePath,
  getClosedChangePath,
  REQUIRED_CHANGE_FILES,
} from "../src/change-store.js";
import {
  createRepositoryConfig,
  writeRepositoryConfig,
} from "../src/config.js";
import { SddError } from "../src/errors.js";
import { pathExists } from "../src/fs.js";

async function createWorkspace(t, prefix = "sdd-change-file-authority-") {
  const root = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "ideas", "sample"), { recursive: true });
  await mkdir(join(root, "code", "sample-web"), { recursive: true });
  await writeRepositoryConfig(
    join(root, "code", "sample-web"),
    createRepositoryConfig("sample-web"),
  );
  await writeFile(
    join(root, "ideas", "sample", "sample.md"),
    [
      "---",
      "repositories:",
      "  - path: code/sample-web",
      "    role: web",
      "---",
      "# Sample",
      "",
    ].join("\n"),
    "utf8",
  );
  await setupInstallation(root, { skillsDirectory: ".agents/skills" });
  return root;
}

function changeSources(changeId, status) {
  return {
    "proposal.md": [
      `# Proposal: ${changeId}`,
      "",
      "## Why",
      "",
      "A concrete reason.",
      "",
      "## What Changes",
      "",
      "A bounded change.",
      "",
      "## Impact",
      "",
      "A focused impact.",
      "",
      "## Open Questions",
      "",
      "None.",
      "",
    ].join("\n"),
    "design.md": [
      `# Design: ${changeId}`,
      "",
      "## Context",
      "",
      "Current context.",
      "",
      "## Selected Approach",
      "",
      "A selected approach.",
      "",
      "## Risks / Trade-Offs",
      "",
      "Known trade-offs.",
      "",
    ].join("\n"),
    "tasks.md": [
      "---",
      `status: ${status}`,
      "space: sample",
      "repositories:",
      "  - sample-web",
      "---",
      `# Tasks: ${changeId}`,
      "",
      "## Resume Here",
      "",
      "Ready.",
      "",
      "## Task Checklist",
      "",
      "- [ ] Exercise the contract.",
      "",
      "## Implementation Ledger",
      "",
      "No implementation yet.",
      "",
      "## Verification Ledger",
      "",
      "No verification yet.",
      "",
      "## Blockers / Open Questions",
      "",
      "None.",
      "",
      "## Closeout",
      "",
      "Pending.",
      "",
    ].join("\n"),
  };
}

async function writeCanonicalChange(root, changeId, status) {
  const changePath = getActiveChangePath(changeId, root);
  const sources = changeSources(changeId, status);
  await mkdir(changePath, { recursive: true });
  await Promise.all(Object.entries(sources).map(([fileName, source]) =>
    writeFile(join(changePath, fileName), source, "utf8")));
  return { changePath, sources };
}

async function replaceRequiredFilesWithSymlinks(t, root, changeId, status, kind) {
  const { changePath, sources } = await writeCanonicalChange(root, changeId, status);
  const externalRoot = kind === "external"
    ? await mkdtemp(join(tmpdir(), "sdd-external-change-authority-"))
    : null;
  if (externalRoot) t.after(() => rm(externalRoot, { recursive: true, force: true }));
  const targets = new Map();
  for (const fileName of REQUIRED_CHANGE_FILES) {
    const target = kind === "external"
      ? join(externalRoot, `${changeId}-${fileName}`)
      : join(changePath, `.authority-${fileName}`);
    await writeFile(target, sources[fileName], "utf8");
    await rm(join(changePath, fileName));
    await symlink(target, join(changePath, fileName));
    targets.set(fileName, target);
  }
  return { changePath, sources, targets };
}

function rejectsUnsafeRequiredFile(changeId, fileName = "tasks.md") {
  return (error) => error instanceof SddError
    && error.code === "UNSAFE_ARTIFACT_PATH"
    && error.details.includes(`.sdd/changes/${changeId}/${fileName}`);
}

async function assertAuthorityTargetsUnchanged(record) {
  for (const [fileName, target] of record.targets) {
    assert.equal(await readFile(target, "utf8"), record.sources[fileName]);
  }
}

async function replaceWithSameBytes(path, suffix) {
  const bytes = await readFile(path);
  const displacedPath = `${path}.${suffix}`;
  await rename(path, displacedPath);
  await writeFile(path, bytes);
  return { bytes, displacedPath };
}

function sameByteReadHook(suffix) {
  let replacement = null;
  return {
    hook: async ({ fileName, path }) => {
      if (fileName !== "tasks.md" || replacement !== null) return;
      replacement = await replaceWithSameBytes(path, suffix);
    },
    replacement: () => replacement,
  };
}

async function assertSameByteReplacement(path, replacement) {
  assert.ok(replacement);
  assert.deepEqual(await readFile(path), replacement.bytes);
  assert.deepEqual(await readFile(replacement.displacedPath), replacement.bytes);
  assert.notEqual((await lstat(path)).ino, (await lstat(replacement.displacedPath)).ino);
}

test("external and internal required-file symlinks never supply Change authority", async (t) => {
  for (const kind of ["external", "internal"]) {
    const root = await createWorkspace(t, `sdd-${kind}-change-authority-`);
    const inventoryId = `2026-08-09-${kind}-inventory-authority`;
    const inventory = await replaceRequiredFilesWithSymlinks(
      t,
      root,
      inventoryId,
      "in_progress",
      kind,
    );

    await assert.rejects(() => getStatus(root), rejectsUnsafeRequiredFile(inventoryId));
    await assert.rejects(() => diagnoseWorkspace(root), rejectsUnsafeRequiredFile(inventoryId));

    const validation = await validateArtifacts(root, { changeId: inventoryId });
    assert.equal(validation.valid, false);
    assert.deepEqual(validation.scope.repositories, []);
    assert.deepEqual(
      validation.findings
        .filter((finding) => finding.code === "UNSAFE_ARTIFACT_PATH")
        .map((finding) => finding.path),
      REQUIRED_CHANGE_FILES.map((fileName) => `.sdd/changes/${inventoryId}/${fileName}`),
    );
    await assertAuthorityTargetsUnchanged(inventory);

    const closeId = `2026-08-09-${kind}-close-authority`;
    const closeRecord = await replaceRequiredFilesWithSymlinks(
      t,
      root,
      closeId,
      "in_review",
      kind,
    );
    await assert.rejects(
      () => closeChange(root, "sample", closeId),
      rejectsUnsafeRequiredFile(closeId),
    );
    assert.equal(await pathExists(getActiveChangePath(closeId, root)), true);
    assert.equal(await pathExists(getClosedChangePath(closeId, root)), false);
    await assertAuthorityTargetsUnchanged(closeRecord);

    const transitionId = `2026-08-09-${kind}-transition-authority`;
    const transitionRecord = await replaceRequiredFilesWithSymlinks(
      t,
      root,
      transitionId,
      "in_progress",
      kind,
    );
    await assert.rejects(
      () => transitionChange(root, "sample", transitionId, {
        from: "in_progress",
        to: "in_review",
      }),
      rejectsUnsafeRequiredFile(transitionId),
    );
    assert.equal(await pathExists(getActiveChangePath(transitionId, root)), true);
    assert.equal(await pathExists(getClosedChangePath(transitionId, root)), false);
    await assertAuthorityTargetsUnchanged(transitionRecord);
  }
});

test("validation and inventory distinguish missing and non-file Change artifacts", async (t) => {
  const root = await createWorkspace(t);
  const changeId = "2026-08-09-invalid-required-files";
  const { changePath } = await writeCanonicalChange(root, changeId, "in_progress");
  await rm(join(changePath, "proposal.md"));
  await rm(join(changePath, "design.md"));
  await mkdir(join(changePath, "design.md"));

  const validation = await validateArtifacts(root, { changeId });
  assert.equal(validation.valid, false);
  assert.deepEqual(
    validation.findings
      .filter((finding) => ["MISSING_CHANGE_FILE", "UNSAFE_ARTIFACT_PATH"].includes(finding.code))
      .map((finding) => [finding.code, finding.path]),
    [
      ["MISSING_CHANGE_FILE", `.sdd/changes/${changeId}/proposal.md`],
      ["UNSAFE_ARTIFACT_PATH", `.sdd/changes/${changeId}/design.md`],
    ],
  );

  await rm(join(changePath, "tasks.md"));
  await assert.rejects(
    () => getStatus(root),
    (error) => error instanceof SddError && error.code === "INCOMPLETE_CHANGE",
  );
  const diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, false);
  assert.ok(diagnosis.findings.some((finding) =>
    finding.level === "error"
      && finding.message === `Change is missing tasks.md: .sdd/changes/${changeId}/tasks.md.`));

  await mkdir(join(changePath, "tasks.md"));
  await assert.rejects(() => getStatus(root), rejectsUnsafeRequiredFile(changeId));
  await assert.rejects(() => diagnoseWorkspace(root), rejectsUnsafeRequiredFile(changeId));
});

test("validate projections consume only the bound proposal snapshot", async (t) => {
  const root = await createWorkspace(t, "sdd-proposal-projection-authority-");
  const externalRoot = await mkdtemp(join(tmpdir(), "sdd-external-proposal-projection-"));
  t.after(() => rm(externalRoot, { recursive: true, force: true }));

  for (const kind of ["directory", "external-symlink"]) {
    const changeId = `2026-08-09-${kind}-proposal-projection`;
    const { changePath } = await writeCanonicalChange(root, changeId, "in_progress");
    const proposalPath = join(changePath, "proposal.md");
    await rm(proposalPath);

    let externalProposalPath = null;
    let externalProposal = null;
    if (kind === "directory") {
      await mkdir(proposalPath);
    } else {
      externalProposalPath = join(externalRoot, `${changeId}.md`);
      externalProposal = [
        `# Proposal: ${changeId}`,
        "",
        "## Epic Actions",
        "",
        "- Modify `docs/epics/forged-external/epic.md`.",
        "",
      ].join("\n");
      await writeFile(externalProposalPath, externalProposal, "utf8");
      await symlink(externalProposalPath, proposalPath);
    }

    const validation = await validateArtifacts(root, { changeId });
    assert.equal(validation.valid, false);
    assert.deepEqual(validation.scope.repositories, ["code/sample-web"]);
    assert.equal(validation.summary.repositories, 1);
    assert.deepEqual(
      validation.findings
        .filter((finding) => finding.path === `.sdd/changes/${changeId}/proposal.md`)
        .map((finding) => finding.code),
      ["UNSAFE_ARTIFACT_PATH"],
    );
    assert.equal(
      validation.findings.some((finding) => finding.code === "AFFECTED_EPIC_NOT_FOUND"),
      false,
    );
    if (externalProposalPath) {
      assert.equal(await readFile(externalProposalPath, "utf8"), externalProposal);
    }
  }
});

test("status, doctor, and validate reject same-byte Change authority inode swaps", async (t) => {
  const readers = [
    {
      name: "status",
      invoke: (root, changeId, hook) => getStatus(root, null, { afterChangeFileRead: hook }),
      assertResult: async (promise) => assert.rejects(
        promise,
        (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
      ),
    },
    {
      name: "doctor",
      invoke: (root, changeId, hook) => diagnoseWorkspace(root, { afterChangeFileRead: hook }),
      assertResult: async (promise) => assert.rejects(
        promise,
        (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
      ),
    },
    {
      name: "validate",
      invoke: (root, changeId, hook) => validateArtifacts(root, {
        changeId,
        afterChangeFileRead: hook,
      }),
      assertResult: async (promise) => {
        const result = await promise;
        assert.equal(result.valid, false);
        assert.ok(result.findings.some((finding) =>
          finding.code === "CONCURRENT_CHANGE" && finding.path.endsWith("/tasks.md")));
      },
    },
  ];

  for (const reader of readers) {
    const root = await createWorkspace(t, `sdd-${reader.name}-inode-authority-`);
    const changeId = `2026-08-09-${reader.name}-inode-authority`;
    const { changePath } = await writeCanonicalChange(root, changeId, "in_progress");
    const tasksPath = join(changePath, "tasks.md");
    const swap = sameByteReadHook(`${reader.name}-original`);
    await reader.assertResult(reader.invoke(root, changeId, swap.hook));
    await assertSameByteReplacement(tasksPath, swap.replacement());
  }
});

test("close and transition cannot commit after same-byte tasks inode substitution", async (t) => {
  const lifecycles = [
    {
      name: "close",
      status: "in_review",
      invoke: (root, changeId, beforeCommit) => closeChange(root, "sample", changeId, {
        beforeCommit,
      }),
    },
    {
      name: "transition",
      status: "in_progress",
      invoke: (root, changeId, beforeCommit) => transitionChange(root, "sample", changeId, {
        from: "in_progress",
        to: "in_review",
        beforeCommit,
      }),
    },
  ];

  for (const lifecycle of lifecycles) {
    const root = await createWorkspace(t, `sdd-${lifecycle.name}-inode-authority-`);
    const changeId = `2026-08-09-${lifecycle.name}-inode-authority`;
    const { changePath } = await writeCanonicalChange(root, changeId, lifecycle.status);
    const tasksPath = join(changePath, "tasks.md");
    let replacement;

    await assert.rejects(
      () => lifecycle.invoke(root, changeId, async () => {
        replacement = await replaceWithSameBytes(tasksPath, `${lifecycle.name}-original`);
      }),
      (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
    );

    await assertSameByteReplacement(tasksPath, replacement);
    assert.equal(await pathExists(getActiveChangePath(changeId, root)), true);
    assert.equal(await pathExists(getClosedChangePath(changeId, root)), false);
  }
});
