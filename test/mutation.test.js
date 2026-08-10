import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  link,
  mkdir,
  lstat,
  mkdtemp,
  open,
  readFile,
  readlink,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { writeWorkspaceConfig } from "../src/config.js";
import { setupInstallation } from "../src/commands/init-installation.js";
import {
  hashDirectory,
  hashFile,
  pathExists,
  readBoundDirectory,
  readBoundRegularFile,
  removeBoundDirectory,
  removeBoundRegularFile,
  replaceDirectoryAtomically,
  replaceFileAtomically,
  writeFileAtomically,
  writeJson,
} from "../src/fs.js";
import {
  applyManagedInstallation,
  serializeManagedInstallationLock,
} from "../src/installation.js";
import { withWorkspaceMutationLock } from "../src/mutation.js";
import {
  applySkillSync,
  planSkillSync,
  readInstallLock,
} from "../src/skills.js";
import { applyWorkflowSync, planWorkflowSync } from "../src/workflow.js";

function mutationLockPath(root) {
  return join(root, ".sdd-mutation.lock");
}

function mutationReclaimPath(root) {
  return join(root, ".sdd-mutation.lock.reclaim");
}

async function authenticatedMutationLockSource(root, owner) {
  const configDirectory = join(root, ".sdd");
  const [workspaceState, configState] = await Promise.all([
    stat(root),
    lstat(configDirectory),
  ]);
  return `${JSON.stringify({
    ...owner,
    workspaceIdentity: {
      dev: String(workspaceState.dev),
      ino: String(workspaceState.ino),
    },
    configIdentity: {
      dev: String(configState.dev),
      ino: String(configState.ino),
    },
  })}\n`;
}

test("atomic JSON writes leave one complete parseable document", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-atomic-json-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, ".sdd", "install-lock.json");

  await Promise.all(
    Array.from({ length: 20 }, (_, index) => writeJson(path, {
      index,
      payload: String(index).repeat(2_000),
    })),
  );

  const result = JSON.parse(await readFile(path, "utf8"));
  assert.equal(typeof result.index, "number");
  assert.equal(result.payload, String(result.index).repeat(2_000));
});

test("atomic JSON writes preserve the existing file mode", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-atomic-mode-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "config.json");
  await writeFile(path, "{}\n", { mode: 0o640 });
  await chmod(path, 0o640);

  await writeJson(path, { updated: true });

  assert.equal((await stat(path)).mode & 0o777, 0o640);
});

test("workspace mutation lock recovers a stale dead-owner lock", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-stale-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lockPath = mutationLockPath(root);
  const configDirectory = join(root, ".sdd");
  await mkdir(configDirectory, { recursive: true });
  const [workspaceState, configState] = await Promise.all([
    stat(root),
    lstat(configDirectory),
  ]);
  await writeFile(lockPath, `${JSON.stringify({
    pid: 99_999_999,
    createdAt: "2026-01-01T00:00:00.000Z",
    workspaceIdentity: {
      dev: String(workspaceState.dev),
      ino: String(workspaceState.ino),
    },
    configIdentity: {
      dev: String(configState.dev),
      ino: String(configState.ino),
    },
  })}\n`);

  const result = await withWorkspaceMutationLock(root, async () => "completed");

  assert.equal(result, "completed");
  assert.equal(await pathExists(lockPath), false);
});

test("identity-less dead-owner canonical lock is opaque and preserved", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-stale-opaque-root-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lockPath = mutationLockPath(root);
  const reclaimPath = mutationReclaimPath(root);
  const lockSource = `${JSON.stringify({
    pid: 99_999_999,
    token: "identity-less-root",
    createdAt: "2026-01-01T00:00:00.000Z",
  })}\n`;
  await mkdir(join(root, ".sdd"));
  await writeFile(lockPath, lockSource);
  let entered = false;

  await assert.rejects(
    () => withWorkspaceMutationLock(root, async () => {
      entered = true;
    }),
    (error) => error.code === "OPERATION_IN_PROGRESS"
      && error.details.includes(
        "The canonical lock is missing or mismatches required workspace/configuration-directory identities.",
      ),
  );

  assert.equal(entered, false);
  assert.equal(await readFile(lockPath, "utf8"), lockSource);
  assert.equal(await pathExists(reclaimPath), false);
});

test("stale recovery reclaims paired root and legacy guards from one dead owner", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-stale-paired-guards-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configDirectory = join(root, ".sdd");
  const lockPath = mutationLockPath(root);
  const legacyLockPath = join(configDirectory, "mutation.lock");
  await mkdir(configDirectory);
  const [workspaceState, configState] = await Promise.all([
    stat(root),
    lstat(configDirectory),
  ]);
  const lockSource = `${JSON.stringify({
    pid: 99_999_999,
    createdAt: "2026-01-01T00:00:00.000Z",
    workspaceIdentity: {
      dev: String(workspaceState.dev),
      ino: String(workspaceState.ino),
    },
    configIdentity: {
      dev: String(configState.dev),
      ino: String(configState.ino),
    },
  })}\n`;
  await writeFile(lockPath, lockSource);
  await link(lockPath, legacyLockPath);

  const result = await withWorkspaceMutationLock(root, async () => "completed");

  assert.equal(result, "completed");
  assert.equal(await pathExists(lockPath), false);
  assert.equal(await pathExists(legacyLockPath), false);
});

test("stale recovery reclaims a legacy-only guard after root release", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-stale-legacy-only-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configDirectory = join(root, ".sdd");
  const legacyLockPath = join(configDirectory, "mutation.lock");
  await mkdir(configDirectory);
  const [workspaceState, configState] = await Promise.all([
    stat(root),
    lstat(configDirectory),
  ]);
  const lockSource = `${JSON.stringify({
    pid: 99_999_999,
    createdAt: "2026-01-01T00:00:00.000Z",
    workspaceIdentity: {
      dev: String(workspaceState.dev),
      ino: String(workspaceState.ino),
    },
    configIdentity: {
      dev: String(configState.dev),
      ino: String(configState.ino),
    },
  })}\n`;
  await writeFile(legacyLockPath, lockSource);

  const result = await withWorkspaceMutationLock(root, async () => "completed");

  assert.equal(result, "completed");
  assert.equal(await pathExists(mutationLockPath(root)), false);
  assert.equal(await pathExists(legacyLockPath), false);
});

test("legacy-only stale recovery accepts an explicit identity-less sentinel", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-stale-legacy-compatible-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configDirectory = join(root, ".sdd");
  const legacyLockPath = join(configDirectory, "mutation.lock");
  const legacySource = `${JSON.stringify({
    pid: 99_999_999,
    token: "legacy-compatible",
    createdAt: "2026-01-01T00:00:00.000Z",
  })}\n`;
  await mkdir(configDirectory);
  await writeFile(legacyLockPath, legacySource);

  const result = await withWorkspaceMutationLock(root, async () => "completed");

  assert.equal(result, "completed");
  assert.equal(await pathExists(mutationLockPath(root)), false);
  assert.equal(await pathExists(legacyLockPath), false);
});

test("stale lock recovery refuses authority retained across a config swap", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-stale-lock-authority-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configDirectory = join(root, ".sdd");
  const displacedDirectory = join(root, ".sdd-displaced");
  const lockPath = mutationLockPath(root);
  await mkdir(configDirectory);
  const [workspaceState, configState] = await Promise.all([
    stat(root),
    lstat(configDirectory),
  ]);
  await rename(configDirectory, displacedDirectory);
  await mkdir(configDirectory);
  const lockSource = `${JSON.stringify({
    pid: 99_999_999,
    createdAt: "2026-01-01T00:00:00.000Z",
    workspaceIdentity: {
      dev: String(workspaceState.dev),
      ino: String(workspaceState.ino),
    },
    configIdentity: {
      dev: String(configState.dev),
      ino: String(configState.ino),
    },
  })}\n`;
  await writeFile(lockPath, lockSource);
  let entered = false;

  await assert.rejects(
    () => withWorkspaceMutationLock(root, async () => {
      entered = true;
    }),
    (error) => error.code === "OPERATION_IN_PROGRESS"
      && error.details.includes(
        "The canonical lock is missing or mismatches required workspace/configuration-directory identities.",
      ),
  );

  assert.equal(entered, false);
  assert.equal(await readFile(lockPath, "utf8"), lockSource);
  assert.equal((await lstat(configDirectory)).isDirectory(), true);
});

test("stale lock reclamation admits only one contender", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-stale-lock-contenders-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lockPath = mutationLockPath(root);
  await mkdir(join(root, ".sdd"), { recursive: true });
  await writeFile(lockPath, await authenticatedMutationLockSource(root, {
    pid: 99_999_999,
    token: "stale",
    createdAt: "2026-01-01T00:00:00.000Z",
  }));

  let observedCount = 0;
  let releaseObserved;
  const bothObserved = new Promise((resolve) => {
    releaseObserved = resolve;
  });
  const afterStaleLockObserved = async () => {
    observedCount += 1;
    if (observedCount === 2) releaseObserved();
    await bothObserved;
  };
  let signalQuarantined;
  const quarantined = new Promise((resolve) => {
    signalQuarantined = resolve;
  });
  let releaseQuarantine;
  const quarantineHeld = new Promise((resolve) => {
    releaseQuarantine = resolve;
  });
  let entered = 0;
  const options = {
    afterStaleLockObserved,
    afterStaleLockQuarantined: async () => {
      signalQuarantined();
      await quarantineHeld;
    },
  };
  const contenders = [
    withWorkspaceMutationLock(root, async () => {
      entered += 1;
      return "first";
    }, options),
    withWorkspaceMutationLock(root, async () => {
      entered += 1;
      return "second";
    }, options),
  ];
  const outcomes = contenders.map((contender) => contender.then(
    (value) => ({ status: "fulfilled", value }),
    (reason) => ({ status: "rejected", reason }),
  ));

  await quarantined;
  const rejected = await Promise.race(outcomes.map((outcome) => outcome.then(
    (result) => result.status === "rejected" ? result.reason : null,
  )));
  assert.equal(rejected.code, "OPERATION_IN_PROGRESS");
  assert.equal(entered, 0);
  releaseQuarantine();
  const settled = await Promise.all(outcomes);

  assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(settled.filter((result) => result.status === "rejected").length, 1);
  assert.equal(entered, 1);
  assert.equal(await pathExists(lockPath), false);
});

test("stale lock reclamation preserves a replacement that wins the observation race", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-stale-lock-replaced-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lockPath = mutationLockPath(root);
  await mkdir(join(root, ".sdd"), { recursive: true });
  await writeFile(lockPath, await authenticatedMutationLockSource(root, {
    pid: 99_999_999,
    token: "stale",
    createdAt: "2026-01-01T00:00:00.000Z",
  }));
  const replacement = `${JSON.stringify({
    pid: process.pid,
    token: "replacement",
    createdAt: new Date().toISOString(),
  })}\n`;
  let entered = false;

  await assert.rejects(
    withWorkspaceMutationLock(root, async () => {
      entered = true;
    }, {
      afterStaleLockObserved: async () => {
        await rm(lockPath);
        await writeFile(lockPath, replacement);
      },
    }),
    (error) => error.code === "OPERATION_IN_PROGRESS",
  );

  assert.equal(entered, false);
  assert.equal(await readFile(lockPath, "utf8"), replacement);
});

test("stale lock reclamation preserves paths replaced after quarantine", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-stale-lock-hook-replaced-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configDirectory = join(root, ".sdd");
  const lockPath = mutationLockPath(root);
  const reclaimPath = mutationReclaimPath(root);
  const quarantineReplacementPath = join(configDirectory, "quarantine-replacement");
  const reclaimReplacementPath = join(configDirectory, "reclaim-replacement");
  const quarantineReplacement = `${JSON.stringify({
    pid: process.pid,
    token: "replacement-quarantine",
  })}\n`;
  const reclaimReplacement = `${JSON.stringify({
    pid: process.pid,
    token: "replacement-reclaim",
  })}\n`;
  await mkdir(configDirectory, { recursive: true });
  await writeFile(lockPath, await authenticatedMutationLockSource(root, {
    pid: 99_999_999,
    token: "stale",
    createdAt: "2026-01-01T00:00:00.000Z",
  }));
  await writeFile(quarantineReplacementPath, quarantineReplacement);
  await writeFile(reclaimReplacementPath, reclaimReplacement);
  let retainedQuarantinePath;
  let entered = false;

  await assert.rejects(
    withWorkspaceMutationLock(root, async () => {
      entered = true;
    }, {
      afterStaleLockQuarantined: async ({ quarantinePath }) => {
        retainedQuarantinePath = quarantinePath;
        await rename(quarantineReplacementPath, quarantinePath);
        await rename(reclaimReplacementPath, reclaimPath);
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.includes(
        `Retained lock path requiring inspection: ${retainedQuarantinePath}`,
      )
      && error.details.includes(`Retained lock path requiring inspection: ${reclaimPath}`),
  );

  assert.equal(entered, false);
  assert.equal(await readFile(retainedQuarantinePath, "utf8"), quarantineReplacement);
  assert.equal(await readFile(reclaimPath, "utf8"), reclaimReplacement);
});

test("stale reclamation preserves an opaque replacement of its reclaim claim", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-stale-claim-replaced-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configDirectory = join(root, ".sdd");
  const lockPath = mutationLockPath(root);
  const reclaimPath = mutationReclaimPath(root);
  const replacementPath = join(configDirectory, "reclaim-replacement");
  const stale = await authenticatedMutationLockSource(root, {
    pid: 99_999_999,
    token: "stale",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const replacement = `${JSON.stringify({
    pid: process.pid,
    token: "opaque-reclaim-replacement",
  })}\n`;
  await mkdir(configDirectory, { recursive: true });
  await writeFile(lockPath, stale);
  await writeFile(replacementPath, replacement);
  let entered = false;

  await assert.rejects(
    () => withWorkspaceMutationLock(root, async () => {
      entered = true;
    }, {
      afterStaleReclaimLinked: async () => {
        await rename(replacementPath, reclaimPath);
      },
    }),
    (error) => error.code === "OPERATION_IN_PROGRESS"
      && error.details.includes(`Reclaim retained for inspection: ${reclaimPath}`),
  );

  assert.equal(entered, false);
  assert.equal(await readFile(lockPath, "utf8"), stale);
  assert.equal(await readFile(reclaimPath, "utf8"), replacement);
});

test("stale reclamation removes its owned claim when the canonical lock disappears", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-stale-lock-disappears-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configDirectory = join(root, ".sdd");
  const lockPath = mutationLockPath(root);
  const reclaimPath = mutationReclaimPath(root);
  await mkdir(configDirectory, { recursive: true });
  await writeFile(lockPath, await authenticatedMutationLockSource(root, {
    pid: 99_999_999,
    token: "stale",
    createdAt: "2026-01-01T00:00:00.000Z",
  }));
  let removed = false;

  const result = await withWorkspaceMutationLock(root, async () => "completed", {
    afterStaleReclaimLinked: async () => {
      if (removed) return;
      removed = true;
      await rm(lockPath);
    },
  });

  assert.equal(result, "completed");
  assert.equal(removed, true);
  assert.equal(await pathExists(lockPath), false);
  assert.equal(await pathExists(reclaimPath), false);
});

test("managed installation rolls back workflow and skills when lock persistence fails", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-install-rollback-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workflowSource = join(root, "workflow-source.md");
  const workflowTarget = join(root, "managed", "workflow.md");
  const skillSource = join(root, "skill-source");
  const skillTarget = join(root, "managed", "skills", "sdd-example");
  await writeFile(workflowSource, "# Workflow\n");
  await mkdir(skillSource, { recursive: true });
  await writeFile(join(skillSource, "SKILL.md"), "# Skill\n");
  const workflowHash = await hashFile(workflowSource);
  const skillHash = await hashDirectory(skillSource);

  await assert.rejects(
    () => applyManagedInstallation(root, {
      workflowPlan: {
        action: "install",
        source: workflowSource,
        target: workflowTarget,
        sourceHash: workflowHash,
        targetHash: null,
        previousHash: null,
        lock: { path: "workflow.md", hash: workflowHash },
      },
      skillPlan: {
        skillsDirectory: join(root, "managed", "skills"),
        actions: [{
          skillName: "sdd-example",
          action: "install",
          source: skillSource,
          target: skillTarget,
          sourceHash: skillHash,
          targetHash: null,
          previousHash: null,
        }],
        lock: {
          version: 1,
          packageVersion: "test",
          schemaVersion: "test",
          skillsDirectory: "managed/skills",
          managedSkills: { "sdd-example": skillHash },
        },
      },
      writeLock: async () => { throw new Error("injected lock persistence failure"); },
    }),
    /injected lock persistence failure/,
  );

  assert.equal(await pathExists(workflowTarget), false);
  assert.equal(await pathExists(skillTarget), false);
});

test("managed installation removes workflow recovery backups after update rollback", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-update-backup-cleanup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const managed = join(root, "managed");
  const source = join(root, "workflow-source.md");
  const target = join(managed, "workflow.md");
  await mkdir(managed, { recursive: true });
  await writeFile(source, "new workflow\n");
  await writeFile(target, "old workflow\n");
  const sourceHash = await hashFile(source);
  const targetHash = await hashFile(target);

  await assert.rejects(
    () => applyManagedInstallation(root, {
      workflowPlan: {
        workspaceRoot: root,
        action: "update",
        source,
        target,
        sourceHash,
        targetHash,
        lock: { path: "managed/workflow.md", hash: sourceHash },
      },
      skillPlan: {
        skillsDirectory: join(root, "skills"),
        actions: [],
        lock: { managedSkills: {} },
      },
      writeLock: async () => { throw new Error("injected lock failure after workflow update"); },
    }),
    /injected lock failure after workflow update/,
  );

  assert.equal(await readFile(target, "utf8"), "old workflow\n");
  assert.equal((await readdir(managed)).some((name) => name.startsWith(".sdd-workflow-backup-")), false);
});

test("managed installation preserves retained backup details after finalization fails", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-install-finalize-details-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const managed = join(root, "managed");
  const source = join(root, "workflow-source.md");
  const target = join(managed, "workflow.md");
  let backup;
  let displacedBackup;
  await mkdir(managed, { recursive: true });
  await writeFile(source, "new workflow\n");
  await writeFile(target, "old workflow\n");
  const sourceHash = await hashFile(source);
  const targetHash = await hashFile(target);

  await assert.rejects(
    () => applyManagedInstallation(root, {
      workflowPlan: {
        workspaceRoot: root,
        action: "update",
        source,
        target,
        sourceHash,
        targetHash,
        lock: { path: "managed/workflow.md", hash: sourceHash },
      },
      skillPlan: {
        skillsDirectory: join(root, "skills"),
        actions: [],
        lock: { managedSkills: {} },
      },
      afterCommit: async () => {
        const name = (await readdir(managed))
          .find((entry) => entry.startsWith(".sdd-workflow-backup-"));
        backup = join(managed, name);
        displacedBackup = `${backup}.displaced`;
        await rename(backup, displacedBackup);
        await mkdir(join(backup, "nested"), { recursive: true });
        await writeFile(join(backup, "nested", "opaque.txt"), "opaque backup\n");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.committed === true
      && error.retainedPaths.includes(backup)
      && error.details.some((detail) => detail.includes(backup))
      && error.errors?.length === 1,
  );

  assert.equal(await readFile(target, "utf8"), "new workflow\n");
  assert.equal(await readFile(join(backup, "nested", "opaque.txt"), "utf8"), "opaque backup\n");
  assert.equal((await lstat(displacedBackup)).isFile(), true);
  assert.equal(await pathExists(join(root, ".sdd", "install-lock.json")), true);
});

test("managed installation rejects a workflow plan owned by another workspace", async (t) => {
  const requestedRoot = await mkdtemp(join(tmpdir(), "sdd-install-requested-owner-"));
  const plannedRoot = await mkdtemp(join(tmpdir(), "sdd-install-planned-owner-"));
  t.after(() => rm(requestedRoot, { recursive: true, force: true }));
  t.after(() => rm(plannedRoot, { recursive: true, force: true }));
  const source = join(plannedRoot, "source.md");
  const target = join(plannedRoot, "managed", "workflow.md");
  await writeFile(source, "managed workflow\n");
  const sourceHash = await hashFile(source);

  await assert.rejects(
    () => applyManagedInstallation(requestedRoot, {
      workflowPlan: {
        workspaceRoot: plannedRoot,
        action: "install",
        source,
        target,
        sourceHash,
        targetHash: null,
        lock: { path: "managed/workflow.md", hash: sourceHash },
      },
      skillPlan: {
        skillsDirectory: join(requestedRoot, "skills"),
        actions: [],
        lock: { managedSkills: {} },
      },
    }),
    (error) => error.code === "UNSAFE_CONFIG_PATH"
      && error.details.includes(`Planned workspace: ${plannedRoot}`)
      && error.details.includes(`Requested workspace: ${requestedRoot}`),
  );

  assert.equal(await pathExists(target), false);
  assert.equal(await pathExists(join(requestedRoot, ".sdd", "install-lock.json")), false);
});

test("fixed SDD mutation paths reject a symlinked config directory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-config-symlink-"));
  const external = await mkdtemp(join(tmpdir(), "sdd-config-external-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(external, { recursive: true, force: true }));
  await symlink(external, join(root, ".sdd"));

  await assert.rejects(
    () => withWorkspaceMutationLock(root, async () => {}),
    (error) => error.code === "UNSAFE_CONFIG_PATH",
  );
  await assert.rejects(
    () => planWorkflowSync(root),
    (error) => error.code === "UNSAFE_CONFIG_PATH",
  );
  await assert.rejects(
    () => writeWorkspaceConfig(root, { version: 1 }),
    (error) => error.code === "UNSAFE_CONFIG_PATH",
  );
  await assert.rejects(
    () => applyManagedInstallation(root, {
      skillPlan: { skillsDirectory: join(root, "skills"), actions: [], lock: {} },
    }),
    (error) => error.code === "UNSAFE_CONFIG_PATH",
  );
  assert.equal((await stat(external)).isDirectory(), true);
  assert.equal((await readdir(external)).length, 0);
});

test("workspace-root guard survives a config-directory swap during lock acquisition", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-lock-config-acquire-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configDirectory = join(root, ".sdd");
  const displacedDirectory = join(root, ".sdd-displaced");
  const replacementMarker = join(configDirectory, "replacement-marker");
  const lockPath = mutationLockPath(root);
  await mkdir(configDirectory, { recursive: true });
  await writeFile(join(configDirectory, "original-marker"), "original\n");
  let swapped = false;
  let firstEntered = false;
  let secondEntered = false;
  let secondOutcome;

  await assert.rejects(
    () => withWorkspaceMutationLock(root, async () => {
      firstEntered = true;
    }, {
      openFile: async (...args) => {
        const handle = await open(...args);
        return {
          stat: async (...statArgs) => {
            const state = await handle.stat(...statArgs);
            if (!swapped) {
              swapped = true;
              await rename(configDirectory, displacedDirectory);
              await mkdir(configDirectory);
              await writeFile(replacementMarker, "replacement\n");
              secondOutcome = await withWorkspaceMutationLock(root, async () => {
                secondEntered = true;
              }).then(
                (value) => ({ status: "fulfilled", value }),
                (reason) => ({ status: "rejected", reason }),
              );
            }
            return state;
          },
          close: (...closeArgs) => handle.close(...closeArgs),
          writeFile: (...writeArgs) => handle.writeFile(...writeArgs),
          sync: (...syncArgs) => handle.sync(...syncArgs),
        };
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes(
        "Configuration directory identity changed",
      ))
      && error.details.includes(`Retained lock path requiring inspection: ${lockPath}`),
  );

  assert.equal(firstEntered, false);
  assert.equal(secondEntered, false);
  assert.equal(secondOutcome.status, "rejected");
  assert.equal(secondOutcome.reason.code, "OPERATION_IN_PROGRESS");
  assert.equal(await readFile(replacementMarker, "utf8"), "replacement\n");
  assert.equal(
    await readFile(join(displacedDirectory, "original-marker"), "utf8"),
    "original\n",
  );
  assert.equal((await lstat(lockPath)).isFile(), true);
});

test("workspace-root guard admits exactly one callback while config authority is swapped", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-lock-config-callback-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configDirectory = join(root, ".sdd");
  const displacedDirectory = join(root, ".sdd-displaced");
  const replacementMarker = join(configDirectory, "replacement-marker");
  const lockPath = mutationLockPath(root);
  await mkdir(configDirectory, { recursive: true });
  await writeFile(join(configDirectory, "original-marker"), "original\n");
  let callbacks = 0;
  let contenderOutcome;

  await assert.rejects(
    () => withWorkspaceMutationLock(root, async () => {
      callbacks += 1;
      await rename(configDirectory, displacedDirectory);
      contenderOutcome = await withWorkspaceMutationLock(root, async () => {
        callbacks += 1;
      }).then(
        (value) => ({ status: "fulfilled", value }),
        (reason) => ({ status: "rejected", reason }),
      );
      assert.equal(await pathExists(configDirectory), false);
      await mkdir(configDirectory);
      await writeFile(replacementMarker, "replacement\n");
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes(
        "Configuration directory identity changed",
      ))
      && error.details.includes(`Retained lock path requiring inspection: ${lockPath}`),
  );

  assert.equal(callbacks, 1);
  assert.equal(contenderOutcome.status, "rejected");
  assert.equal(contenderOutcome.reason.code, "OPERATION_IN_PROGRESS");
  assert.equal(await readFile(replacementMarker, "utf8"), "replacement\n");
  assert.equal(
    await readFile(join(displacedDirectory, "original-marker"), "utf8"),
    "original\n",
  );
  assert.equal((await lstat(lockPath)).isFile(), true);
});

test("workspace-root guard rejects a pre-existing legacy lock without modifying it", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-lock-legacy-guard-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configDirectory = join(root, ".sdd");
  const legacyLockPath = join(configDirectory, "mutation.lock");
  const legacySource = `${JSON.stringify({
    pid: process.pid,
    token: "legacy-owner",
    createdAt: "2026-01-01T00:00:00.000Z",
  })}\n`;
  await mkdir(configDirectory, { recursive: true });
  await writeFile(legacyLockPath, legacySource);
  let entered = false;

  await assert.rejects(
    () => withWorkspaceMutationLock(root, async () => {
      entered = true;
    }),
    (error) => error.code === "OPERATION_IN_PROGRESS",
  );

  assert.equal(entered, false);
  assert.equal(await readFile(legacyLockPath, "utf8"), legacySource);
  assert.equal(await pathExists(mutationLockPath(root)), false);
});

test("workspace-root guard holds an authenticated legacy sentinel through the callback", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-lock-legacy-sentinel-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const legacyLockPath = join(root, ".sdd", "mutation.lock");
  const lockPath = mutationLockPath(root);

  const result = await withWorkspaceMutationLock(root, async ({ source }) => {
    assert.equal(await readFile(legacyLockPath, "utf8"), source);
    const configState = await lstat(join(root, ".sdd"));
    assert.deepEqual(JSON.parse(source).configIdentity, {
      dev: String(configState.dev),
      ino: String(configState.ino),
    });
    await assert.rejects(
      () => open(legacyLockPath, "wx", 0o600),
      (error) => error.code === "EEXIST",
    );
    return "completed";
  });

  assert.equal(result, "completed");
  assert.equal(await pathExists(legacyLockPath), false);
  assert.equal(await pathExists(lockPath), false);
});

test("mutation lock cleans up a failed acquisition write", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-lock-acquire-fail-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lockPath = mutationLockPath(root);

  await assert.rejects(
    () => withWorkspaceMutationLock(root, async () => {}, {
      openFile: async (...args) => {
        const handle = await open(...args);
        return {
          stat: (...statArgs) => handle.stat(...statArgs),
          close: (...closeArgs) => handle.close(...closeArgs),
          writeFile: async () => { throw new Error("injected lock write failure"); },
          sync: (...syncArgs) => handle.sync(...syncArgs),
        };
      },
    }),
    /injected lock write failure/,
  );
  assert.equal(await pathExists(lockPath), false);
});

test("config-directory creation failure releases the owned workspace-root guard", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-lock-config-create-fail-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lockPath = mutationLockPath(root);
  const configDirectory = join(root, ".sdd");
  let entered = false;

  await assert.rejects(
    () => withWorkspaceMutationLock(root, async () => {
      entered = true;
    }, {
      createDirectory: async () => {
        throw new Error("injected config creation failure");
      },
    }),
    /injected config creation failure/,
  );

  assert.equal(entered, false);
  assert.equal(await pathExists(lockPath), false);
  assert.equal(await pathExists(configDirectory), false);
});

test("config-directory creation binds the inode returned by its creation step", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-lock-config-create-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configDirectory = join(root, ".sdd");
  const displacedDirectory = join(root, ".sdd-displaced");
  const replacementMarker = join(configDirectory, "replacement-marker");
  const lockPath = mutationLockPath(root);
  let entered = false;

  await assert.rejects(
    () => withWorkspaceMutationLock(root, async () => {
      entered = true;
    }, {
      createDirectory: async (path) => {
        await mkdir(path);
        const createdState = await lstat(path);
        await rename(path, displacedDirectory);
        await mkdir(path);
        await writeFile(replacementMarker, "replacement\n");
        return createdState;
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes(
        "Configuration directory identity changed",
      ))
      && error.details.includes(`Retained lock path requiring inspection: ${lockPath}`),
  );

  assert.equal(entered, false);
  assert.equal(await readFile(replacementMarker, "utf8"), "replacement\n");
  assert.equal((await lstat(displacedDirectory)).isDirectory(), true);
  assert.equal((await lstat(lockPath)).isFile(), true);
});

test("acquisition race reports both ownership and close failures", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-lock-acquire-close-fail-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lockPath = mutationLockPath(root);
  const reclaimPath = mutationReclaimPath(root);
  let injectedReclaim = false;
  let entered = false;

  await assert.rejects(
    () => withWorkspaceMutationLock(root, async () => {
      entered = true;
    }, {
      openFile: async (...args) => {
        const handle = await open(...args);
        return {
          stat: async (...statArgs) => {
            const state = await handle.stat(...statArgs);
            if (!injectedReclaim) {
              injectedReclaim = true;
              await writeFile(reclaimPath, "opaque reclaim\n");
            }
            return state;
          },
          close: async () => {
            await handle.close();
            throw new Error("injected acquisition close failure");
          },
          writeFile: (...writeArgs) => handle.writeFile(...writeArgs),
          sync: (...syncArgs) => handle.sync(...syncArgs),
        };
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.startsWith(
        "Original error: OPERATION_IN_PROGRESS:",
      ))
      && error.details.includes("Close error: injected acquisition close failure"),
  );

  assert.equal(entered, false);
  assert.equal(await pathExists(lockPath), false);
  assert.equal(await readFile(reclaimPath, "utf8"), "opaque reclaim\n");
});

test("mutation lock reports a retained lock when release loses directory permission", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-lock-release-fail-"));
  const lockPath = mutationLockPath(root);
  t.after(async () => {
    await chmod(root, 0o700).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });

  await assert.rejects(
    () => withWorkspaceMutationLock(root, async () => {
      await chmod(root, 0o500);
      return "completed";
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.includes(`Retained lock path requiring inspection: ${lockPath}`)
      && error.details.some((detail) => detail.includes("EACCES"))
      && error.details.some((detail) => detail.includes("confirming no SDD mutation is active")),
  );

  await chmod(root, 0o700);
  const retainedSource = await readFile(lockPath, "utf8");
  await assert.rejects(
    () => withWorkspaceMutationLock(root, async () => "must not run"),
    (error) => error.code === "OPERATION_IN_PROGRESS",
  );
  assert.equal(await readFile(lockPath, "utf8"), retainedSource);
});

test("mutation lock reports release failure and preserves a replacement owner", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-lock-replaced-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lockPath = mutationLockPath(root);
  const replacement = `${JSON.stringify({ pid: process.pid, token: "replacement" })}\n`;

  await assert.rejects(
    () => withWorkspaceMutationLock(root, async () => {
      await rm(lockPath);
      await writeFile(lockPath, replacement);
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.includes(`Retained lock path requiring inspection: ${lockPath}`),
  );

  assert.equal(await readFile(lockPath, "utf8"), replacement);
  await assert.rejects(
    () => withWorkspaceMutationLock(root, async () => "must not run"),
    (error) => error.code === "OPERATION_IN_PROGRESS",
  );
  assert.equal(await readFile(lockPath, "utf8"), replacement);
});

test("mutation release preserves an opaque replacement of its release guard", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-release-guard-replaced-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configDirectory = join(root, ".sdd");
  const lockPath = mutationLockPath(root);
  const reclaimPath = mutationReclaimPath(root);
  const replacementPath = join(configDirectory, "reclaim-replacement");
  const replacement = `${JSON.stringify({
    pid: process.pid,
    token: "opaque-release-guard-replacement",
  })}\n`;
  await mkdir(configDirectory, { recursive: true });
  await writeFile(replacementPath, replacement);
  let ownedSource;

  await assert.rejects(
    () => withWorkspaceMutationLock(root, async ({ source }) => {
      ownedSource = source;
    }, {
      afterReleaseGuardLinked: async () => {
        await rename(replacementPath, reclaimPath);
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.includes(`Retained lock path requiring inspection: ${lockPath}`)
      && error.details.includes(`Retained lock path requiring inspection: ${reclaimPath}`),
  );

  assert.equal(await readFile(lockPath, "utf8"), ownedSource);
  assert.equal(await readFile(reclaimPath, "utf8"), replacement);
});

test("mutation release preserves an occupied exclusive quarantine target", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-lock-quarantine-collision-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lockPath = mutationLockPath(root);
  const reclaimPath = mutationReclaimPath(root);
  const legacyLockPath = join(root, ".sdd", "mutation.lock");
  const winner = `${JSON.stringify({
    pid: process.pid,
    token: "quarantine-winner",
  })}\n`;
  let ownedSource;
  let quarantinePath;

  await assert.rejects(
    () => withWorkspaceMutationLock(root, async ({ source }) => {
      ownedSource = source;
    }, {
      afterLockObserved: async (context) => {
        quarantinePath = context.quarantinePath;
        await writeFile(quarantinePath, winner, { flag: "wx" });
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.includes(`Retained lock path requiring inspection: ${lockPath}`)
      && error.details.includes(`Retained lock path requiring inspection: ${quarantinePath}`)
      && error.details.includes(`Retained lock path requiring inspection: ${legacyLockPath}`),
  );

  assert.equal(await readFile(lockPath, "utf8"), ownedSource);
  assert.equal(await readFile(quarantinePath, "utf8"), winner);
  assert.equal(await readFile(legacyLockPath, "utf8"), ownedSource);
  assert.equal(await pathExists(reclaimPath), false);
  await assert.rejects(
    () => withWorkspaceMutationLock(root, async () => "must not run"),
    (error) => error.code === "OPERATION_IN_PROGRESS",
  );
  assert.equal(await readFile(lockPath, "utf8"), ownedSource);
  assert.equal(await readFile(quarantinePath, "utf8"), winner);
});

test("release-claim cleanup preserves an occupied exclusive quarantine target", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-reclaim-quarantine-collision-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lockPath = mutationLockPath(root);
  const reclaimPath = mutationReclaimPath(root);
  const legacyLockPath = join(root, ".sdd", "mutation.lock");
  const winner = `${JSON.stringify({
    pid: process.pid,
    token: "reclaim-quarantine-winner",
  })}\n`;
  let ownedSource;
  let quarantinePath;

  await assert.rejects(
    () => withWorkspaceMutationLock(root, async ({ source }) => {
      ownedSource = source;
    }, {
      afterOwnedPathObserved: async (context) => {
        if (context.path !== reclaimPath) return;
        quarantinePath = context.quarantinePath;
        await writeFile(quarantinePath, winner, { flag: "wx" });
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.includes(`Retained lock path requiring inspection: ${reclaimPath}`)
      && error.details.includes(`Retained lock path requiring inspection: ${quarantinePath}`)
      && error.details.includes(`Retained lock path requiring inspection: ${legacyLockPath}`),
  );

  assert.equal(await pathExists(lockPath), false);
  assert.equal(await readFile(reclaimPath, "utf8"), ownedSource);
  assert.equal(await readFile(quarantinePath, "utf8"), winner);
  assert.equal(await readFile(legacyLockPath, "utf8"), ownedSource);
  let entered = false;
  await assert.rejects(
    () => withWorkspaceMutationLock(root, async () => {
      entered = true;
    }),
    (error) => error.code === "OPERATION_IN_PROGRESS",
  );
  assert.equal(entered, false);
  assert.equal(await readFile(reclaimPath, "utf8"), ownedSource);
  assert.equal(await readFile(quarantinePath, "utf8"), winner);
});

test("release-claim cleanup preserves a source replaced after observation", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-reclaim-source-replaced-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lockPath = mutationLockPath(root);
  const reclaimPath = mutationReclaimPath(root);
  const legacyLockPath = join(root, ".sdd", "mutation.lock");
  const replacement = `${JSON.stringify({
    pid: process.pid,
    token: "reclaim-source-replacement",
  })}\n`;
  let quarantinePath;

  await assert.rejects(
    () => withWorkspaceMutationLock(root, async () => {}, {
      afterOwnedPathObserved: async (context) => {
        if (context.path !== reclaimPath) return;
        quarantinePath = context.quarantinePath;
        await rm(reclaimPath);
        await writeFile(reclaimPath, replacement, { flag: "wx" });
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.includes(`Retained lock path requiring inspection: ${reclaimPath}`)
      && error.details.includes(`Retained lock path requiring inspection: ${legacyLockPath}`),
  );

  assert.equal(await pathExists(lockPath), false);
  assert.equal(await readFile(reclaimPath, "utf8"), replacement);
  assert.equal(await pathExists(quarantinePath), false);
  assert.equal((await lstat(legacyLockPath)).isFile(), true);
  let entered = false;
  await assert.rejects(
    () => withWorkspaceMutationLock(root, async () => {
      entered = true;
    }),
    (error) => error.code === "OPERATION_IN_PROGRESS",
  );
  assert.equal(entered, false);
  assert.equal(await readFile(reclaimPath, "utf8"), replacement);
});

test("mutation release never displaces a replacement for a third contender", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-lock-release-three-way-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configDirectory = join(root, ".sdd");
  const lockPath = mutationLockPath(root);
  const reclaimPath = mutationReclaimPath(root);
  const replacementPath = join(configDirectory, "replacement.lock");
  const replacement = `${JSON.stringify({
    pid: process.pid,
    token: "replacement",
    createdAt: new Date().toISOString(),
  })}\n`;
  await mkdir(configDirectory, { recursive: true });
  await writeFile(replacementPath, replacement);
  let signalQuarantined;
  const quarantined = new Promise((resolve) => {
    signalQuarantined = resolve;
  });
  let resumeRelease;
  const releaseHeld = new Promise((resolve) => {
    resumeRelease = resolve;
  });
  let thirdEntered = false;

  const ownerOutcome = withWorkspaceMutationLock(root, async () => "first", {
    afterLockObserved: async () => {
      await rename(replacementPath, lockPath);
    },
    afterLockQuarantined: async () => {
      signalQuarantined();
      await releaseHeld;
    },
  }).then(
    (value) => ({ status: "fulfilled", value }),
    (reason) => ({ status: "rejected", reason }),
  );

  await quarantined;
  const contenderResult = await withWorkspaceMutationLock(root, async () => {
    thirdEntered = true;
    return "third";
  }).then(
    (value) => ({ status: "fulfilled", value }),
    (reason) => ({ status: "rejected", reason }),
  );
  resumeRelease();
  const ownerResult = await ownerOutcome;

  assert.equal(ownerResult.status, "rejected");
  assert.equal(ownerResult.reason.code, "MUTATION_RECOVERY_FAILED");
  assert.equal(contenderResult.status, "rejected");
  assert.equal(contenderResult.reason.code, "OPERATION_IN_PROGRESS");
  assert.equal(thirdEntered, false);
  assert.equal(await readFile(lockPath, "utf8"), replacement);
  assert.equal(await pathExists(reclaimPath), false);
});

test("mutation callback and release failures preserve both causes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-lock-callback-release-fail-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lockPath = mutationLockPath(root);
  const reclaimPath = mutationReclaimPath(root);
  const legacyLockPath = join(root, ".sdd", "mutation.lock");
  let ownedSource;

  await assert.rejects(
    () => withWorkspaceMutationLock(root, async ({ source }) => {
      ownedSource = source;
      throw new Error("injected callback failure");
    }, {
      afterReleaseGuardLinked: async () => {
        assert.equal(await readFile(legacyLockPath, "utf8"), ownedSource);
        await assert.rejects(
          () => open(legacyLockPath, "wx", 0o600),
          (error) => error.code === "EEXIST",
        );
        throw new Error("injected release failure");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.includes("Original error: injected callback failure")
      && error.details.includes(`Retained lock path requiring inspection: ${lockPath}`)
      && error.details.includes(`Retained lock path requiring inspection: ${reclaimPath}`)
      && error.details.includes(`Retained lock path requiring inspection: ${legacyLockPath}`)
      && error.details.some((detail) => detail.includes("injected release failure"))
      && error.errors?.some((cause) => cause.message === "injected callback failure")
      && error.errors?.some((cause) => cause.code === "MUTATION_RECOVERY_FAILED"),
  );

  assert.equal(await readFile(lockPath, "utf8"), ownedSource);
  assert.equal(await readFile(reclaimPath, "utf8"), ownedSource);
  assert.equal(await readFile(legacyLockPath, "utf8"), ownedSource);
});

test("mutation callback and close failures preserve both causes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-lock-callback-close-fail-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lockPath = mutationLockPath(root);

  await assert.rejects(
    () => withWorkspaceMutationLock(root, async () => {
      throw new Error("injected callback failure");
    }, {
      openFile: async (...args) => {
        const handle = await open(...args);
        return {
          stat: (...statArgs) => handle.stat(...statArgs),
          close: async () => {
            await handle.close();
            throw new Error("injected close failure");
          },
          writeFile: (...writeArgs) => handle.writeFile(...writeArgs),
          truncate: (...truncateArgs) => handle.truncate(...truncateArgs),
          write: (...writeArgs) => handle.write(...writeArgs),
          sync: (...syncArgs) => handle.sync(...syncArgs),
        };
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.includes("Original error: injected callback failure")
      && error.details.includes("Close error: injected close failure")
      && error.errors?.some((cause) => cause.message === "injected callback failure")
      && error.errors?.some((cause) => cause.message === "injected close failure"),
  );

  assert.equal(await pathExists(lockPath), false);
});

test("workflow sync restores the old target when replacement commits then throws", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-workflow-post-commit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source.md");
  const target = join(root, "target.md");
  await writeFile(source, "new workflow\n");
  await writeFile(target, "old workflow\n");
  const plan = {
    action: "update",
    source,
    target,
    sourceHash: await hashFile(source),
    targetHash: await hashFile(target),
  };

  await assert.rejects(
    () => applyWorkflowSync(plan, {
      replaceFile: async (...args) => {
        await replaceFileAtomically(...args);
        throw new Error("injected post-commit cleanup failure");
      },
    }),
    /injected post-commit cleanup failure/,
  );
  assert.equal(await readFile(target, "utf8"), "old workflow\n");
});

test("skill sync restores the old target when replacement commits then throws", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-skill-post-commit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source", "sdd-example");
  const target = join(root, "skills", "sdd-example");
  await mkdir(source, { recursive: true });
  await mkdir(target, { recursive: true });
  await writeFile(join(source, "SKILL.md"), "new skill\n");
  await writeFile(join(target, "SKILL.md"), "old skill\n");
  const plan = {
    skillsDirectory: join(root, "skills"),
    actions: [{
      skillName: "sdd-example",
      action: "update",
      source,
      target,
      sourceHash: await hashDirectory(source),
      targetHash: await hashDirectory(target),
    }],
  };

  await assert.rejects(
    () => applySkillSync(root, plan, {
      replaceDirectory: async (...args) => {
        await replaceDirectoryAtomically(...args);
        throw new Error("injected post-commit skill failure");
      },
    }),
    /injected post-commit skill failure/,
  );
  assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "old skill\n");
});

test("released install lock hashes support normal skill update and removal before a strong round-trip", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-install-lock-legacy-hash-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const skillsDirectory = join(root, "skills");
  const managedTarget = join(skillsDirectory, "sdd-change");
  const retiredTarget = join(skillsDirectory, "sdd-retired");
  const releasedHash = "sha256:88f5273f09670ad8f1e007f56ff03a4e2bbcf42cd950bbb797f1c149d4e7bdeb";
  await mkdir(join(root, ".sdd"), { recursive: true });
  await mkdir(managedTarget, { recursive: true });
  await mkdir(retiredTarget, { recursive: true });
  await writeFile(join(managedTarget, "SKILL.md"), "released skill\n", "utf8");
  await writeFile(join(retiredTarget, "SKILL.md"), "released skill\n", "utf8");
  // Released ownership did not cover modes; preserve that one-time compatibility boundary.
  await chmod(join(managedTarget, "SKILL.md"), 0o600);
  await chmod(join(retiredTarget, "SKILL.md"), 0o600);
  await writeFile(
    join(root, ".sdd", "install-lock.json"),
    `${JSON.stringify({
      version: 2,
      packageVersion: "released",
      schemaVersion: "sdd-v2",
      skillsDirectory: "skills",
      managedSkills: {
        "sdd-change": releasedHash,
        "sdd-retired": releasedHash,
      },
    }, null, 2)}\n`,
    "utf8",
  );
  const config = {
    version: 3,
    schema: "sdd-v3",
    skills: { directory: "skills" },
  };

  const plan = await planSkillSync(root, config);
  assert.equal(
    plan.actions.find(({ skillName }) => skillName === "sdd-change")?.action,
    "update",
  );
  assert.equal(
    plan.actions.find(({ skillName }) => skillName === "sdd-retired")?.action,
    "remove",
  );
  // The plan immediately binds that accepted legacy tree to its strong mode-aware hash.
  await chmod(join(managedTarget, "SKILL.md"), 0o640);
  await assert.rejects(
    () => applyManagedInstallation(root, { skillPlan: plan }),
    (error) => error.code === "SKILL_CONFLICT",
  );
  assert.equal((await readInstallLock(root)).managedSkills["sdd-change"], releasedHash);

  const refreshedPlan = await planSkillSync(root, config);
  await applyManagedInstallation(root, { skillPlan: refreshedPlan });

  assert.equal(await pathExists(retiredTarget), false);
  const lock = await readInstallLock(root);
  assert.equal(lock.version, 3);
  assert.equal(lock.managedSkills["sdd-change"], await hashDirectory(managedTarget));
  assert.ok(
    Object.values(lock.managedSkills)
      .every((hash) => /^sha256-directory-v2:[a-f0-9]{64}$/.test(hash)),
  );

  const roundTrip = await planSkillSync(root, config);
  assert.ok(roundTrip.actions.every(({ action }) => action === "unchanged"));
});

test("install locks reject mixed, unknown, and malformed managed skill hash versions", async (t) => {
  const variants = [
    {
      label: "mixed",
      managedSkills: {
        "sdd-legacy": `sha256:${"0".repeat(64)}`,
        "sdd-strong": `sha256-directory-v2:${"1".repeat(64)}`,
      },
    },
    {
      label: "unknown",
      managedSkills: {
        "sdd-unknown": `sha256-directory-v99:${"0".repeat(64)}`,
      },
    },
    {
      label: "malformed",
      managedSkills: {
        "sdd-malformed": "sha256:not-a-digest",
      },
    },
  ];
  for (const variant of variants) {
    await t.test(variant.label, async (t) => {
      const root = await mkdtemp(join(tmpdir(), `sdd-install-lock-${variant.label}-`));
      t.after(() => rm(root, { recursive: true, force: true }));
      await mkdir(join(root, ".sdd"), { recursive: true });
      await writeFile(
        join(root, ".sdd", "install-lock.json"),
        `${JSON.stringify({ managedSkills: variant.managedSkills }, null, 2)}\n`,
        "utf8",
      );

      await assert.rejects(
        readInstallLock(root),
        (error) => error.code === "INVALID_INSTALL_LOCK",
      );
    });
  }

  assert.throws(
    () => serializeManagedInstallationLock({
      lock: {
        managedSkills: {
          "sdd-legacy": `sha256:${"0".repeat(64)}`,
        },
      },
    }),
    (error) => error.code === "INVALID_INSTALL_LOCK",
  );
});

test("managed installation rejects a same-byte skill inode swap before lock commit", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-adopt-drift-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source", "sdd-example");
  const target = join(root, "skills", "sdd-example");
  const displacedTarget = join(root, "published-sdd-example");
  await mkdir(source, { recursive: true });
  await mkdir(target, { recursive: true });
  await writeFile(join(source, "SKILL.md"), "matching skill\n");
  await writeFile(join(target, "SKILL.md"), "matching skill\n");
  const sourceHash = await hashDirectory(source);
  const plan = {
    skillsDirectory: join(root, "skills"),
    actions: [{
      skillName: "sdd-example",
      action: "adopt",
      source,
      target,
      sourceHash,
      targetHash: sourceHash,
    }],
    lock: {
      version: 1,
      packageVersion: "test",
      schemaVersion: "test",
      skillsDirectory: "skills",
      managedSkills: { "sdd-example": sourceHash },
    },
  };
  const publishedState = await lstat(target, { bigint: true });
  let winnerState;

  await assert.rejects(
    () => applyManagedInstallation(root, {
      skillPlan: plan,
      beforeLockCommit: async () => {
        await rename(target, displacedTarget);
        await mkdir(target);
        await writeFile(join(target, "SKILL.md"), "matching skill\n");
        assert.equal(await hashDirectory(target), sourceHash);
        winnerState = await lstat(target, { bigint: true });
      },
    }),
    (error) => error.code === "CONCURRENT_CHANGE",
  );
  assert.notEqual(String(winnerState.ino), String(publishedState.ino));
  assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "matching skill\n");
  assert.equal(
    await readFile(join(displacedTarget, "SKILL.md"), "utf8"),
    "matching skill\n",
  );
  assert.equal(await pathExists(join(root, ".sdd", "install-lock.json")), false);
});

test("managed installation rejects a same-byte workflow inode swap before lock commit", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-workflow-adopt-drift-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "workflow-source.md");
  const target = join(root, "workflow-target.md");
  await writeFile(source, "matching workflow\n");
  await writeFile(target, "matching workflow\n");
  const displacedTarget = join(root, "published-workflow.md");
  const publishedState = await lstat(target, { bigint: true });
  let winnerState;
  const sourceHash = await hashFile(source);

  await assert.rejects(
    () => applyManagedInstallation(root, {
      workflowPlan: {
        workspaceRoot: root,
        action: "adopt",
        source,
        target,
        sourceHash,
        targetHash: sourceHash,
        lock: { path: "workflow-target.md", hash: sourceHash },
      },
      skillPlan: {
        skillsDirectory: join(root, "skills"),
        actions: [],
        lock: { managedSkills: {} },
      },
      beforeLockCommit: async () => {
        await rename(target, displacedTarget);
        await writeFile(target, "matching workflow\n");
        assert.equal(await hashFile(target), sourceHash);
        winnerState = await lstat(target, { bigint: true });
      },
    }),
    (error) => error.code === "CONCURRENT_CHANGE",
  );
  assert.notEqual(String(winnerState.ino), String(publishedState.ino));
  assert.equal(await readFile(target, "utf8"), "matching workflow\n");
  assert.equal(await readFile(displacedTarget, "utf8"), "matching workflow\n");
  assert.equal(await pathExists(join(root, ".sdd", "install-lock.json")), false);
});

test("symlink-bearing forced skill updates authenticate on commit and rollback", async (t) => {
  for (const outcome of ["commit", "rollback"]) {
    await t.test(outcome, async (t) => {
      const root = await mkdtemp(join(tmpdir(), `sdd-symlink-skill-${outcome}-`));
      t.after(() => rm(root, { recursive: true, force: true }));
      const source = join(root, "source", "sdd-example");
      const target = join(root, "skills", "sdd-example");
      await mkdir(source, { recursive: true });
      await mkdir(target, { recursive: true });
      await writeFile(join(source, "SKILL.md"), "new skill\n");
      await writeFile(join(target, "SKILL.md"), "old skill\n");
      await symlink("SKILL.md", join(source, "alias.md"));
      await symlink("SKILL.md", join(target, "alias.md"));
      const sourceHash = await hashDirectory(source);
      const targetHash = await hashDirectory(target);
      const skillPlan = {
        skillsDirectory: join(root, "skills"),
        actions: [{
          skillName: "sdd-example",
          action: "update-forced",
          source,
          target,
          sourceHash,
          targetHash,
        }],
        lock: {
          managedSkills: { "sdd-example": sourceHash },
        },
      };
      const apply = () => applyManagedInstallation(root, {
        skillPlan,
        ...(outcome === "rollback"
          ? { writeLock: async () => { throw new Error("injected symlink rollback"); } }
          : {}),
      });

      if (outcome === "rollback") {
        await assert.rejects(apply, /injected symlink rollback/);
        assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "old skill\n");
        assert.equal(await pathExists(join(root, ".sdd", "install-lock.json")), false);
      } else {
        await apply();
        assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "new skill\n");
        assert.equal(await pathExists(join(root, ".sdd", "install-lock.json")), true);
      }
      assert.equal(await readlink(join(target, "alias.md")), "SKILL.md");
    });
  }
});

test("first-time setup removes its new config when managed installation fails", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-setup-rollback-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(
    () => setupInstallation(root, {
      planningRoot: "ideas",
      repositoryRoots: ["repos"],
      skillsDirectory: "skills",
      writeLock: async () => { throw new Error("injected setup lock failure"); },
    }),
    /injected setup lock failure/,
  );

  assert.equal(await pathExists(join(root, ".sdd", "config.yaml")), false);
  assert.equal(await pathExists(join(root, ".sdd", ".gitignore")), false);
  assert.equal(await pathExists(join(root, "skills", "sdd-apply")), false);
});

test("workflow replacement preserves an edit made inside the replacement window", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-workflow-cas-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source.md");
  const target = join(root, "target.md");
  await writeFile(source, "package workflow\n");
  await writeFile(target, "old workflow\n");
  const plan = {
    action: "update",
    source,
    target,
    sourceHash: await hashFile(source),
    targetHash: await hashFile(target),
  };

  await assert.rejects(
    () => applyWorkflowSync(plan, {
      replaceFile: async (...args) => {
        await writeFile(target, "concurrent workflow\n");
        await replaceFileAtomically(...args);
      },
    }),
    (error) => ["CONCURRENT_CHANGE", "MUTATION_RECOVERY_FAILED"].includes(error.code),
  );
  assert.equal(await readFile(target, "utf8"), "concurrent workflow\n");
});

test("skill replacement preserves an edit made inside the replacement window", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-skill-cas-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source", "sdd-example");
  const target = join(root, "skills", "sdd-example");
  await mkdir(source, { recursive: true });
  await mkdir(target, { recursive: true });
  await writeFile(join(source, "SKILL.md"), "package skill\n");
  await writeFile(join(target, "SKILL.md"), "old skill\n");
  const plan = {
    skillsDirectory: join(root, "skills"),
    actions: [{
      skillName: "sdd-example",
      action: "update",
      source,
      target,
      sourceHash: await hashDirectory(source),
      targetHash: await hashDirectory(target),
    }],
  };

  await assert.rejects(
    () => applySkillSync(root, plan, {
      replaceDirectory: async (...args) => {
        await writeFile(join(target, "SKILL.md"), "concurrent skill\n");
        await replaceDirectoryAtomically(...args);
      },
    }),
    (error) => ["CONCURRENT_CHANGE", "MUTATION_RECOVERY_FAILED"].includes(error.code),
  );
  assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "concurrent skill\n");
});

test("skill removal preserves a swapped target with nested opaque state", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-skill-remove-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const skillsDirectory = join(root, "skills");
  const target = join(skillsDirectory, "sdd-retired");
  const displaced = `${target}.displaced`;
  const opaque = join(target, "nested", "opaque.txt");
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "SKILL.md"), "retired skill\n");
  const targetHash = await hashDirectory(target);

  await assert.rejects(
    () => applySkillSync(root, {
      skillsDirectory,
      actions: [{
        skillName: "sdd-retired",
        action: "remove",
        source: null,
        target,
        sourceHash: null,
        targetHash,
      }],
    }, {
      beforeSkillCleanup: async ({ phase, path }) => {
        if (phase !== "remove-target") return;
        await rename(path, displaced);
        await mkdir(join(path, "nested"), { recursive: true });
        await writeFile(opaque, "opaque replacement\n");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes(target)),
  );

  assert.equal(await readFile(opaque, "utf8"), "opaque replacement\n");
  assert.equal(await readFile(join(displaced, "SKILL.md"), "utf8"), "retired skill\n");
});

test("skill removal preserves an opaque quarantine replacement", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-skill-remove-quarantine-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const skillsDirectory = join(root, "skills");
  const target = join(skillsDirectory, "sdd-retired");
  let removalCleanup = false;
  let quarantine;
  let displacedQuarantine;
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "SKILL.md"), "retired skill\n");

  await assert.rejects(
    async () => applySkillSync(root, {
      skillsDirectory,
      actions: [{
        skillName: "sdd-retired",
        action: "remove",
        source: null,
        target,
        sourceHash: null,
        targetHash: await hashDirectory(target),
      }],
    }, {
      beforeSkillCleanup: ({ phase }) => {
        removalCleanup = phase === "remove-target";
      },
      cleanupMkdir: async (...args) => {
        await mkdir(...args);
        if (!removalCleanup || quarantine) return;
        [quarantine] = args;
        displacedQuarantine = `${quarantine}.displaced`;
        await rename(quarantine, displacedQuarantine);
        await mkdir(join(quarantine, "nested"), { recursive: true });
        await writeFile(
          join(quarantine, "nested", "opaque.txt"),
          "opaque quarantine replacement\n",
        );
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes(quarantine)),
  );

  assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "retired skill\n");
  assert.equal(
    await readFile(join(quarantine, "nested", "opaque.txt"), "utf8"),
    "opaque quarantine replacement\n",
  );
  assert.equal((await lstat(displacedQuarantine)).isDirectory(), true);
});

test("skill removal preserves an external same-content ancestor replacement", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-skill-remove-ancestor-swap-"));
  const externalSkills = await mkdtemp(join(tmpdir(), "sdd-skill-remove-external-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(externalSkills, { recursive: true, force: true }));
  const skillsDirectory = join(root, "skills");
  const target = join(skillsDirectory, "sdd-retired");
  const externalTarget = join(externalSkills, "sdd-retired");
  const displacedSkills = `${skillsDirectory}.displaced`;
  await mkdir(target, { recursive: true });
  await mkdir(externalTarget, { recursive: true });
  await writeFile(join(target, "SKILL.md"), "same retired skill\n");
  await writeFile(join(externalTarget, "SKILL.md"), "same retired skill\n");

  await assert.rejects(
    async () => applySkillSync(root, {
      skillsDirectory,
      actions: [{
        skillName: "sdd-retired",
        action: "remove",
        source: null,
        target,
        sourceHash: null,
        targetHash: await hashDirectory(target),
      }],
    }, {
      beforeSkillCleanup: async ({ phase }) => {
        if (phase !== "remove-target") return;
        await rename(skillsDirectory, displacedSkills);
        await symlink(externalSkills, skillsDirectory, "dir");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED",
  );

  assert.equal(await readFile(join(externalTarget, "SKILL.md"), "utf8"), "same retired skill\n");
  assert.equal(
    await readFile(join(displacedSkills, "sdd-retired", "SKILL.md"), "utf8"),
    "same retired skill\n",
  );
  assert.equal((await lstat(skillsDirectory)).isSymbolicLink(), true);
});

test("skill install rejects an external same-content owner replacement", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-skill-install-owner-swap-"));
  const externalSkills = await mkdtemp(join(tmpdir(), "sdd-skill-install-external-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(externalSkills, { recursive: true, force: true }));
  const source = join(root, "source", "sdd-example");
  const skillsDirectory = join(root, "skills");
  const target = join(skillsDirectory, "sdd-example");
  const externalTarget = join(externalSkills, "sdd-example");
  const displacedSkills = `${skillsDirectory}.displaced`;
  await mkdir(source, { recursive: true });
  await mkdir(skillsDirectory);
  await mkdir(externalTarget);
  await writeFile(join(source, "SKILL.md"), "same managed skill\n");
  await writeFile(join(externalTarget, "SKILL.md"), "same managed skill\n");

  await assert.rejects(
    async () => applySkillSync(root, {
      skillsDirectory,
      actions: [{
        skillName: "sdd-example",
        action: "install",
        source,
        target,
        sourceHash: await hashDirectory(source),
        targetHash: null,
      }],
    }, {
      replaceDirectory: (sourcePath, targetPath, options) =>
        replaceDirectoryAtomically(sourcePath, targetPath, {
          ...options,
          beforePublish: async () => {
            await rename(skillsDirectory, displacedSkills);
            await symlink(externalSkills, skillsDirectory, "dir");
          },
        }),
    }),
    (error) => ["CONCURRENT_CHANGE", "MUTATION_RECOVERY_FAILED"].includes(error.code),
  );

  assert.equal(
    await readFile(join(externalTarget, "SKILL.md"), "utf8"),
    "same managed skill\n",
  );
  assert.equal((await lstat(skillsDirectory)).isSymbolicLink(), true);
  assert.equal((await lstat(displacedSkills)).isDirectory(), true);
});

test("skill rollback preserves a swapped installed target", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-skill-rollback-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source", "sdd-example");
  const skillsDirectory = join(root, "skills");
  const target = join(skillsDirectory, "sdd-example");
  const displaced = `${target}.published`;
  const opaque = join(target, "nested", "opaque.txt");
  await mkdir(source, { recursive: true });
  await mkdir(target, { recursive: true });
  await writeFile(join(source, "SKILL.md"), "new skill\n");
  await writeFile(join(target, "SKILL.md"), "old skill\n");

  await assert.rejects(
    async () => applySkillSync(root, {
      skillsDirectory,
      actions: [{
        skillName: "sdd-example",
        action: "update",
        source,
        target,
        sourceHash: await hashDirectory(source),
        targetHash: await hashDirectory(target),
      }],
    }, {
      replaceDirectory: async (...args) => {
        await replaceDirectoryAtomically(...args);
        throw new Error("injected post-publication failure");
      },
      beforeSkillCleanup: async ({ phase, path }) => {
        if (phase !== "rollback-target") return;
        await rename(path, displaced);
        await mkdir(join(path, "nested"), { recursive: true });
        await writeFile(opaque, "opaque rollback replacement\n");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes(target)),
  );

  assert.equal(await readFile(opaque, "utf8"), "opaque rollback replacement\n");
  assert.equal(await readFile(join(displaced, "SKILL.md"), "utf8"), "new skill\n");
});

test("skill rollback preserves a swapped recovery-backup root", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-skill-rollback-backup-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source", "sdd-example");
  const skillsDirectory = join(root, "skills");
  const target = join(skillsDirectory, "sdd-example");
  let backupRoot;
  let displacedBackup;
  await mkdir(source, { recursive: true });
  await mkdir(target, { recursive: true });
  await writeFile(join(source, "SKILL.md"), "new skill\n");
  await writeFile(join(target, "SKILL.md"), "old skill\n");

  await assert.rejects(
    async () => applySkillSync(root, {
      skillsDirectory,
      actions: [{
        skillName: "sdd-example",
        action: "update",
        source,
        target,
        sourceHash: await hashDirectory(source),
        targetHash: await hashDirectory(target),
      }],
    }, {
      replaceDirectory: async (...args) => {
        await replaceDirectoryAtomically(...args);
        throw new Error("injected rollback");
      },
      beforeSkillCleanup: async ({ phase, path }) => {
        if (phase !== "rollback-backup") return;
        backupRoot = path;
        displacedBackup = `${path}.displaced`;
        await rename(path, displacedBackup);
        await mkdir(join(path, "nested"), { recursive: true });
        await writeFile(join(path, "nested", "opaque.txt"), "opaque backup replacement\n");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes(backupRoot)),
  );

  assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "old skill\n");
  assert.equal(
    await readFile(join(backupRoot, "nested", "opaque.txt"), "utf8"),
    "opaque backup replacement\n",
  );
  assert.equal((await lstat(displacedBackup)).isDirectory(), true);
});

test("skill finalize preserves a swapped recovery-backup root", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-skill-finalize-backup-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source", "sdd-example");
  const skillsDirectory = join(root, "skills");
  const target = join(skillsDirectory, "sdd-example");
  let backupRoot;
  let displacedBackup;
  await mkdir(source, { recursive: true });
  await mkdir(target, { recursive: true });
  await writeFile(join(source, "SKILL.md"), "new skill\n");
  await writeFile(join(target, "SKILL.md"), "old skill\n");
  const result = await applySkillSync(root, {
    skillsDirectory,
    actions: [{
      skillName: "sdd-example",
      action: "update",
      source,
      target,
      sourceHash: await hashDirectory(source),
      targetHash: await hashDirectory(target),
    }],
  }, {
    beforeSkillCleanup: async ({ phase, path }) => {
      if (phase !== "finalize-backup") return;
      backupRoot = path;
      displacedBackup = `${path}.displaced`;
      await rename(path, displacedBackup);
      await mkdir(join(path, "nested"), { recursive: true });
      await writeFile(join(path, "nested", "opaque.txt"), "opaque finalize replacement\n");
    },
  });

  await assert.rejects(
    () => result.finalize(),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes(backupRoot)),
  );
  assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "new skill\n");
  assert.equal(
    await readFile(join(backupRoot, "nested", "opaque.txt"), "utf8"),
    "opaque finalize replacement\n",
  );
  assert.equal((await lstat(displacedBackup)).isDirectory(), true);
});

test("skill rollback retries backup cleanup without deleting its restored target", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-skill-rollback-retry-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source", "sdd-example");
  const skillsDirectory = join(root, "skills");
  const target = join(skillsDirectory, "sdd-example");
  let failCleanup = true;
  await mkdir(source, { recursive: true });
  await mkdir(target, { recursive: true });
  await writeFile(join(source, "SKILL.md"), "new skill\n");
  await writeFile(join(target, "SKILL.md"), "old skill\n");
  const result = await applySkillSync(root, {
    skillsDirectory,
    actions: [{
      skillName: "sdd-example",
      action: "update",
      source,
      target,
      sourceHash: await hashDirectory(source),
      targetHash: await hashDirectory(target),
    }],
  }, {
    beforeSkillCleanup: async ({ phase }) => {
      if (phase !== "rollback-backup" || !failCleanup) return;
      failCleanup = false;
      throw new Error("injected one-shot backup cleanup failure");
    },
  });

  await assert.rejects(
    () => result.rollback(),
    (error) => error.code === "MUTATION_RECOVERY_FAILED",
  );
  assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "old skill\n");
  await result.rollback();
  assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "old skill\n");
  assert.equal(
    (await readdir(skillsDirectory)).some((name) => name.startsWith(".sdd-sync-backup-")),
    false,
  );
});

test("skill rollback aggregates cleanup swaps for every applied target", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-skill-cleanup-aggregate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const skillsDirectory = join(root, "skills");
  const actions = [];
  for (const skillName of ["sdd-first", "sdd-second"]) {
    const source = join(root, "source", skillName);
    const target = join(skillsDirectory, skillName);
    await mkdir(source, { recursive: true });
    await mkdir(target, { recursive: true });
    await writeFile(join(source, "SKILL.md"), `new ${skillName}\n`);
    await writeFile(join(target, "SKILL.md"), `old ${skillName}\n`);
    actions.push({
      skillName,
      action: "update",
      source,
      target,
      sourceHash: await hashDirectory(source),
      targetHash: await hashDirectory(target),
    });
  }
  let publications = 0;

  await assert.rejects(
    () => applySkillSync(root, { skillsDirectory, actions }, {
      replaceDirectory: async (...args) => {
        await replaceDirectoryAtomically(...args);
        publications += 1;
        if (publications === actions.length) throw new Error("injected aggregate rollback");
      },
      beforeSkillCleanup: async ({ phase, path }) => {
        if (phase !== "rollback-target") return;
        await rename(path, `${path}.published`);
        await mkdir(join(path, "nested"), { recursive: true });
        await writeFile(join(path, "nested", "opaque.txt"), `opaque ${path}\n`);
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && actions.every(({ skillName }) =>
        error.details.some((detail) => detail.includes(skillName))),
  );

  for (const { target } of actions) {
    assert.equal(await readFile(join(target, "nested", "opaque.txt"), "utf8"), `opaque ${target}\n`);
    assert.equal((await lstat(`${target}.published`)).isDirectory(), true);
  }
});

test("absent workflow failure preserves a swapped published target", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-workflow-failure-target-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source.md");
  const target = join(root, "managed", "workflow.md");
  const displaced = `${target}.published`;
  await mkdir(join(root, "managed"), { recursive: true });
  await writeFile(source, "managed workflow\n");

  await assert.rejects(
    async () => applyWorkflowSync({
      workspaceRoot: root,
      action: "install",
      source,
      target,
      sourceHash: await hashFile(source),
      targetHash: null,
    }, {
      replaceFile: async (...args) => {
        await replaceFileAtomically(...args);
        throw new Error("injected workflow failure");
      },
      beforeWorkflowCleanup: async ({ phase, path }) => {
        if (phase !== "failure-target") return;
        await rename(path, displaced);
        await writeFile(path, "opaque workflow replacement\n");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes(target)),
  );

  assert.equal(await readFile(target, "utf8"), "opaque workflow replacement\n");
  assert.equal(await readFile(displaced, "utf8"), "managed workflow\n");
});

test("absent workflow rollback preserves a swapped published target", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-workflow-rollback-target-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source.md");
  const target = join(root, "managed", "workflow.md");
  const displaced = `${target}.published`;
  await mkdir(join(root, "managed"), { recursive: true });
  await writeFile(source, "managed workflow\n");
  const result = await applyWorkflowSync({
    workspaceRoot: root,
    action: "install",
    source,
    target,
    sourceHash: await hashFile(source),
    targetHash: null,
  }, {
    beforeWorkflowCleanup: async ({ phase, path }) => {
      if (phase !== "rollback-target") return;
      await rename(path, displaced);
      await writeFile(path, "opaque rollback replacement\n");
    },
  });

  await assert.rejects(
    () => result.rollback(),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes(target)),
  );
  assert.equal(await readFile(target, "utf8"), "opaque rollback replacement\n");
  assert.equal(await readFile(displaced, "utf8"), "managed workflow\n");
});

test("workflow rollback preserves an external same-content ancestor replacement", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-workflow-ancestor-swap-"));
  const externalManaged = await mkdtemp(join(tmpdir(), "sdd-workflow-external-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(externalManaged, { recursive: true, force: true }));
  const source = join(root, "source.md");
  const managed = join(root, "managed");
  const target = join(managed, "workflow.md");
  const externalTarget = join(externalManaged, "workflow.md");
  const displacedManaged = `${managed}.displaced`;
  await mkdir(managed);
  await writeFile(source, "managed workflow\n");
  await writeFile(externalTarget, "managed workflow\n");
  const result = await applyWorkflowSync({
    workspaceRoot: root,
    action: "install",
    source,
    target,
    sourceHash: await hashFile(source),
    targetHash: null,
  }, {
    beforeWorkflowCleanup: async ({ phase }) => {
      if (phase !== "rollback-target") return;
      await rename(managed, displacedManaged);
      await symlink(externalManaged, managed, "dir");
    },
  });

  await assert.rejects(
    () => result.rollback(),
    (error) => error.code === "MUTATION_RECOVERY_FAILED",
  );
  assert.equal(await readFile(externalTarget, "utf8"), "managed workflow\n");
  assert.equal(
    await readFile(join(displacedManaged, "workflow.md"), "utf8"),
    "managed workflow\n",
  );
  assert.equal((await lstat(managed)).isSymbolicLink(), true);
});

test("workflow rollback and finalize preserve swapped recovery backups", async (t) => {
  for (const operation of ["rollback", "finalize"]) {
    await t.test(operation, async (t) => {
      const root = await mkdtemp(join(tmpdir(), `sdd-workflow-${operation}-backup-swap-`));
      t.after(() => rm(root, { recursive: true, force: true }));
      const source = join(root, "source.md");
      const target = join(root, "managed", "workflow.md");
      let backup;
      let displacedBackup;
      await mkdir(join(root, "managed"), { recursive: true });
      await writeFile(source, "new workflow\n");
      await writeFile(target, "old workflow\n");
      const phase = `${operation}-backup`;
      const result = await applyWorkflowSync({
        workspaceRoot: root,
        action: "update",
        source,
        target,
        sourceHash: await hashFile(source),
        targetHash: await hashFile(target),
      }, {
        beforeWorkflowCleanup: async ({ phase: cleanupPhase, path }) => {
          if (cleanupPhase !== phase) return;
          backup = path;
          displacedBackup = `${path}.displaced`;
          await rename(path, displacedBackup);
          await mkdir(join(path, "nested"), { recursive: true });
          await writeFile(join(path, "nested", "opaque.txt"), "opaque backup replacement\n");
        },
      });

      await assert.rejects(
        () => result[operation](),
        (error) => error.code === "MUTATION_RECOVERY_FAILED"
          && error.details.some((detail) => detail.includes(backup)),
      );
      assert.equal(
        await readFile(join(backup, "nested", "opaque.txt"), "utf8"),
        "opaque backup replacement\n",
      );
      assert.equal((await lstat(displacedBackup)).isFile(), true);
      assert.equal(
        await readFile(target, "utf8"),
        operation === "rollback" ? "old workflow\n" : "new workflow\n",
      );
    });
  }
});

test("workflow rollback retries backup cleanup without deleting its restored target", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-workflow-rollback-retry-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source.md");
  const managed = join(root, "managed");
  const target = join(managed, "workflow.md");
  let failCleanup = true;
  await mkdir(managed);
  await writeFile(source, "new workflow\n");
  await writeFile(target, "old workflow\n");
  const result = await applyWorkflowSync({
    workspaceRoot: root,
    action: "update",
    source,
    target,
    sourceHash: await hashFile(source),
    targetHash: await hashFile(target),
  }, {
    beforeWorkflowCleanup: async ({ phase }) => {
      if (phase !== "rollback-backup" || !failCleanup) return;
      failCleanup = false;
      throw new Error("injected one-shot backup cleanup failure");
    },
  });

  await assert.rejects(
    () => result.rollback(),
    (error) => error.code === "MUTATION_RECOVERY_FAILED",
  );
  assert.equal(await readFile(target, "utf8"), "old workflow\n");
  await result.rollback();
  assert.equal(await readFile(target, "utf8"), "old workflow\n");
  assert.equal(
    (await readdir(managed)).some((name) => name.startsWith(".sdd-workflow-backup-")),
    false,
  );
});

test("managed installation rolls back its lock when adopt drifts during lock persistence", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-adopt-write-drift-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source", "sdd-example");
  const target = join(root, "skills", "sdd-example");
  await mkdir(source, { recursive: true });
  await mkdir(target, { recursive: true });
  await writeFile(join(source, "SKILL.md"), "matching skill\n");
  await writeFile(join(target, "SKILL.md"), "matching skill\n");
  const sourceHash = await hashDirectory(source);

  await assert.rejects(
    () => applyManagedInstallation(root, {
      skillPlan: {
        skillsDirectory: join(root, "skills"),
        actions: [{
          skillName: "sdd-example",
          action: "adopt",
          source,
          target,
          sourceHash,
          targetHash: sourceHash,
        }],
        lock: { managedSkills: { "sdd-example": sourceHash } },
      },
      writeLock: async (path, value) => {
        await writeFileAtomically(path, value);
        await writeFile(join(target, "SKILL.md"), "drift during lock write\n");
      },
    }),
    (error) => error.code === "SKILL_CONFLICT",
  );
  assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "drift during lock write\n");
  assert.equal(await pathExists(join(root, ".sdd", "install-lock.json")), false);
});

test("managed installation preserves an install lock edited before CAS publication", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-install-lock-prepublish-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lockPath = join(root, ".sdd", "install-lock.json");
  const original = "{\"owner\":\"original\"}\n";
  const winner = "{\"owner\":\"external\"}\n";
  await mkdir(join(root, ".sdd"), { recursive: true });
  await writeFile(lockPath, original, "utf8");

  await assert.rejects(
    applyManagedInstallation(root, {
      skillPlan: {
        skillsDirectory: join(root, "skills"),
        actions: [],
        lock: { managedSkills: {} },
      },
      beforeLockCommit: () => writeFile(lockPath, winner, "utf8"),
    }),
    (error) => error?.code === "CONCURRENT_CHANGE",
  );
  assert.equal(await readFile(lockPath, "utf8"), winner);
});

test("managed installation preserves a same-byte inode swapped after lock commit", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-install-lock-postcommit-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lockPath = join(root, ".sdd", "install-lock.json");
  const displaced = join(root, ".sdd", "install-lock.displaced.json");
  let publishedIdentity;
  let winnerIdentity;

  await assert.rejects(
    applyManagedInstallation(root, {
      skillPlan: {
        skillsDirectory: join(root, "skills"),
        actions: [],
        lock: { managedSkills: {} },
      },
      afterCommit: async () => {
        const source = await readFile(lockPath, "utf8");
        const publishedState = await lstat(lockPath, { bigint: true });
        publishedIdentity = `${publishedState.dev}:${publishedState.ino}`;
        await rename(lockPath, displaced);
        await writeFile(lockPath, source, "utf8");
        const winnerState = await lstat(lockPath, { bigint: true });
        winnerIdentity = `${winnerState.dev}:${winnerState.ino}`;
      },
    }),
    (error) => error?.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes(
        "Installation lock changed concurrently and was preserved",
      )),
  );
  assert.notEqual(winnerIdentity, publishedIdentity);
  assert.equal(
    await readFile(lockPath, "utf8"),
    await readFile(displaced, "utf8"),
  );
});

test("managed installation recovers its published lock when writer cleanup fails", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-install-lock-postpublish-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workflowSource = join(root, "workflow-source.md");
  const workflowTarget = join(root, "managed", "workflow.md");
  const skillSource = join(root, "skill-source");
  const skillTarget = join(root, "managed", "skills", "sdd-example");
  const lockPath = join(root, ".sdd", "install-lock.json");
  await writeFile(workflowSource, "# Workflow\n", "utf8");
  await mkdir(skillSource, { recursive: true });
  await writeFile(join(skillSource, "SKILL.md"), "# Skill\n", "utf8");
  const workflowHash = await hashFile(workflowSource);
  const skillHash = await hashDirectory(skillSource);

  await assert.rejects(
    applyManagedInstallation(root, {
      workflowPlan: {
        workspaceRoot: root,
        action: "install",
        source: workflowSource,
        target: workflowTarget,
        sourceHash: workflowHash,
        targetHash: null,
        previousHash: null,
        lock: { path: "managed/workflow.md", hash: workflowHash },
      },
      skillPlan: {
        skillsDirectory: join(root, "managed", "skills"),
        actions: [{
          skillName: "sdd-example",
          action: "install",
          source: skillSource,
          target: skillTarget,
          sourceHash: skillHash,
          targetHash: null,
          previousHash: null,
        }],
        lock: { managedSkills: { "sdd-example": skillHash } },
      },
      writeLock: (path, value, options) => writeFileAtomically(path, value, {
        ...options,
        cleanupRename: async () => {
          throw new Error("injected post-publication cleanup failure");
        },
      }),
    }),
    (error) => error?.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes(
        "injected post-publication cleanup failure",
      )),
  );
  assert.equal(await pathExists(lockPath), false);
  assert.equal(await pathExists(skillTarget), false);
  assert.equal(await pathExists(workflowTarget), false);
});

test("setup rejects an external Change-store symlink before creating closed history", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-setup-changes-symlink-"));
  const external = await mkdtemp(join(tmpdir(), "sdd-setup-changes-external-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(external, { recursive: true, force: true }));
  await mkdir(join(root, ".sdd"), { recursive: true });
  await symlink(external, join(root, ".sdd", "changes"));

  for (const dryRun of [true, false]) {
    await assert.rejects(
      () => setupInstallation(root, {
        planningRoot: "ideas",
        repositoryRoots: ["repos"],
        skillsDirectory: "skills",
        dryRun,
      }),
      (error) => error.code === "UNSAFE_ARTIFACT_PATH",
    );
  }

  assert.equal(await pathExists(join(external, "closed")), false);
});

test("first-time setup rejects a dangling workspace configuration without replacing it", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-setup-config-symlink-"));
  const external = await mkdtemp(join(tmpdir(), "sdd-config-target-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(external, { recursive: true, force: true }));
  const configDirectory = join(root, ".sdd");
  const configPath = join(configDirectory, "config.yaml");
  const externalTarget = join(external, "created-by-symlink");
  await mkdir(configDirectory, { recursive: true });
  await symlink(externalTarget, configPath);

  await assert.rejects(
    () => setupInstallation(root, {
      planningRoot: "ideas",
      repositoryRoots: ["repos"],
      skillsDirectory: "skills",
    }),
    (error) => error.code === "UNSAFE_CONFIG_PATH",
  );

  assert.equal(await pathExists(externalTarget), false);
  assert.equal((await lstat(configPath)).isSymbolicLink(), true);
});

test("first-time setup rejects a dangling gitignore without replacing it", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-setup-ignore-symlink-"));
  const external = await mkdtemp(join(tmpdir(), "sdd-ignore-external-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(external, { recursive: true, force: true }));
  const ignorePath = join(root, ".sdd", ".gitignore");
  await mkdir(join(root, ".sdd"), { recursive: true });
  const externalTarget = join(external, "created-by-symlink");
  await symlink(externalTarget, ignorePath);

  await assert.rejects(
    () => setupInstallation(root, {
      planningRoot: "ideas",
      repositoryRoots: ["repos"],
      skillsDirectory: "skills",
    }),
    (error) => error.code === "UNSAFE_CONFIG_PATH",
  );
  assert.equal(await pathExists(externalTarget), false);
  assert.equal((await lstat(ignorePath)).isSymbolicLink(), true);
});

test("first-time setup preserves dangling fixed files that appear during publication", async (t) => {
  for (const relativePath of ["config.yaml", ".gitignore"]) {
    await t.test(relativePath, async (t) => {
      const root = await mkdtemp(join(tmpdir(), "sdd-setup-publication-race-"));
      const external = await mkdtemp(join(tmpdir(), "sdd-publication-target-"));
      t.after(() => rm(root, { recursive: true, force: true }));
      t.after(() => rm(external, { recursive: true, force: true }));
      const fixedPath = join(root, ".sdd", relativePath);
      const externalTarget = join(external, "must-not-be-created");

      await assert.rejects(
        () => setupInstallation(root, {
          planningRoot: "ideas",
          repositoryRoots: ["repos"],
          skillsDirectory: "skills",
          beforeSetupFilePublish: async ({ path }) => {
            if (path === fixedPath) await symlink(externalTarget, fixedPath);
          },
        }),
        (error) => error.code === "CONCURRENT_CHANGE",
      );

      assert.equal(await pathExists(externalTarget), false);
      assert.equal((await lstat(fixedPath)).isSymbolicLink(), true);
    });
  }
});

test("setup rollback preserves a swapped authenticated quarantine", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-setup-quarantine-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let quarantine;
  let displacedQuarantine;

  await assert.rejects(
    () => setupInstallation(root, {
      planningRoot: "ideas",
      repositoryRoots: ["repos"],
      skillsDirectory: "skills",
      writeLock: async () => {
        throw new Error("injected setup rollback");
      },
      beforeSetupRollbackQuarantineRemoval: async ({
        label,
        quarantine: cleanupPath,
      }) => {
        if (label !== "Workspace configuration") return;
        quarantine = cleanupPath;
        displacedQuarantine = `${cleanupPath}.displaced`;
        await rename(cleanupPath, displacedQuarantine);
        await writeFile(cleanupPath, "opaque quarantine replacement\n");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes(quarantine)),
  );

  assert.equal(await readFile(quarantine, "utf8"), "opaque quarantine replacement\n");
  assert.match(await readFile(displacedQuarantine, "utf8"), /version:/);
});

test("setup directory rollback invokes removal hooks on its authenticated claim", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-setup-directory-claim-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const closedChangesRoot = join(root, ".sdd", "changes", "closed");
  let cleanupClaim = null;
  let displacedClaim = null;

  await assert.rejects(
    () => setupInstallation(root, {
      planningRoot: "ideas",
      repositoryRoots: ["repos"],
      skillsDirectory: "skills",
      writeLock: async () => {
        throw new Error("injected setup rollback");
      },
      beforeSetupRollbackQuarantineRemoval: async ({ label, quarantine }) => {
        if (label !== "Workspace closed Change store") return;
        cleanupClaim = quarantine;
        displacedClaim = `${quarantine}.displaced`;
        assert.deepEqual(await readdir(cleanupClaim), []);
        await rename(cleanupClaim, displacedClaim);
        await mkdir(cleanupClaim);
        await writeFile(join(cleanupClaim, "opaque.txt"), "opaque claim replacement\n");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes(cleanupClaim)),
  );

  assert.equal(
    await readFile(join(cleanupClaim, "opaque.txt"), "utf8"),
    "opaque claim replacement\n",
  );
  assert.equal((await lstat(displacedClaim)).isDirectory(), true);
  assert.equal((await lstat(closedChangesRoot)).isDirectory(), true);
});

test("setup rollback preserves a same-byte replacement installation lock", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-setup-lock-identity-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lockPath = join(root, ".sdd", "install-lock.json");
  const displacedLock = `${lockPath}.displaced`;
  const initialSource = "{}\n";
  await mkdir(join(root, ".sdd"), { recursive: true });
  await writeFile(lockPath, initialSource);

  await assert.rejects(
    () => setupInstallation(root, {
      planningRoot: "ideas",
      repositoryRoots: ["repos"],
      skillsDirectory: "skills",
      writeLock: async (path) => {
        await rename(path, displacedLock);
        await writeFile(path, initialSource);
        throw new Error("injected same-byte lock replacement");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes(lockPath)),
  );

  assert.equal(await readFile(lockPath, "utf8"), initialSource);
  assert.equal(await readFile(displacedLock, "utf8"), initialSource);
  assert.equal(await pathExists(join(root, ".sdd", "config.yaml")), true);
  assert.equal(await pathExists(join(root, ".sdd", ".gitignore")), true);
});

test("setup cleanup accepts the authenticated lock inode restored by managed recovery", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-setup-lock-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configDirectory = join(root, ".sdd");
  const lockPath = join(configDirectory, "install-lock.json");
  const initialSource = "{}\n";
  await mkdir(configDirectory);
  await writeFile(lockPath, initialSource);

  await assert.rejects(
    () => setupInstallation(root, {
      planningRoot: "ideas",
      repositoryRoots: ["repos"],
      skillsDirectory: "skills",
      writeLock: (path, value, options) => writeFileAtomically(path, value, {
        ...options,
        cleanupRename: async () => {
          throw new Error("injected post-publication cleanup failure");
        },
      }),
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED",
  );

  assert.equal(await readFile(lockPath, "utf8"), initialSource);
  assert.equal(await pathExists(join(configDirectory, "config.yaml")), false);
  assert.equal(await pathExists(join(configDirectory, ".gitignore")), false);
});

test("setup temporary cleanup preserves a same-path replacement", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-setup-temporary-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let temporary;
  let displaced;

  await assert.rejects(
    () => setupInstallation(root, {
      planningRoot: "ideas",
      repositoryRoots: ["repos"],
      skillsDirectory: "skills",
      beforeSetupTemporaryCleanup: async ({
        label,
        temporary: cleanupPath,
        published,
      }) => {
        if (label !== "Workspace configuration" || !published) return;
        temporary = cleanupPath;
        displaced = `${cleanupPath}.published`;
        await rename(cleanupPath, displaced);
        await mkdir(join(cleanupPath, "nested"), { recursive: true });
        await writeFile(
          join(cleanupPath, "nested", "opaque.txt"),
          "opaque temporary replacement\n",
        );
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes(temporary)),
  );

  assert.equal(
    await readFile(join(temporary, "nested", "opaque.txt"), "utf8"),
    "opaque temporary replacement\n",
  );
  assert.match(await readFile(displaced, "utf8"), /version:/);
});

test("first-time setup removes a new Change-store directory after ownership capture fails", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-init-directory-capture-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const changesRoot = join(root, ".sdd", "changes");
  const primaryFailure = new Error("injected directory ownership capture failure");

  await assert.rejects(
    () => setupInstallation(root, {
      planningRoot: "ideas",
      repositoryRoots: ["repos"],
      skillsDirectory: "skills",
      afterSetupDirectoryOwnershipCapture: ({ path }) => {
        if (path === changesRoot) throw primaryFailure;
      },
    }),
    (error) => error === primaryFailure,
  );

  assert.equal(await pathExists(changesRoot), false);
  assert.equal(await pathExists(join(root, ".sdd", "config.yaml")), false);
});

test("directory ownership rollback preserves a replacement and reports both failures", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-init-directory-capture-cleanup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const changesRoot = join(root, ".sdd", "changes");
  const foreignPath = join(changesRoot, "concurrent-owner");
  const primaryFailure = new Error("injected directory ownership capture failure");

  await assert.rejects(
    () => setupInstallation(root, {
      planningRoot: "ideas",
      repositoryRoots: ["repos"],
      skillsDirectory: "skills",
      afterSetupDirectoryOwnershipCapture: async ({ path }) => {
        if (path !== changesRoot) return;
        await rm(path, { recursive: true });
        await mkdir(path);
        await writeFile(foreignPath, "concurrent owner\n");
        throw primaryFailure;
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.errors[0] === primaryFailure
      && error.errors.some((failure) => failure.code === "CONCURRENT_CHANGE")
      && error.details.some((detail) => detail.includes(
        "Original error: injected directory ownership capture failure",
      ))
      && error.details.some((detail) => detail.includes(changesRoot)),
  );

  assert.equal(await readFile(foreignPath, "utf8"), "concurrent owner\n");
});

test("setup rejects a swapped SDD parent even when the Change-store inode is preserved", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-init-parent-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all([
    mkdir(join(root, "ideas"), { recursive: true }),
    mkdir(join(root, "code"), { recursive: true }),
  ]);
  const configDirectory = join(root, ".sdd");
  const displacedConfigDirectory = join(root, ".sdd-displaced");
  const changesRoot = join(configDirectory, "changes");
  const replacementMarker = join(changesRoot, "replacement-owner.txt");
  let injected = false;

  await assert.rejects(
    () => setupInstallation(root, {
      planningRoot: "ideas",
      repositoryRoots: ["code"],
      skillsDirectory: ".agents/skills",
      afterSetupDirectoryOwnershipCapture: async ({ path }) => {
        if (injected || path !== changesRoot) return;
        injected = true;
        await rename(configDirectory, displacedConfigDirectory);
        await mkdir(configDirectory);
        await rename(join(displacedConfigDirectory, "changes"), changesRoot);
        await writeFile(replacementMarker, "replacement owner\n");
      },
    }),
    (error) => error?.code === "MUTATION_RECOVERY_FAILED"
      && error.errors.some((failure) => failure?.code === "CONCURRENT_CHANGE"),
  );

  assert.equal(injected, true);
  assert.equal(await readFile(replacementMarker, "utf8"), "replacement owner\n");
  assert.equal(await pathExists(join(configDirectory, "config.yaml")), false);
});

test("first-time setup removes new durable state when installation fails", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-init-rollback-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "ideas"), { recursive: true });
  await mkdir(join(root, "code"), { recursive: true });

  await assert.rejects(
    () => setupInstallation(root, {
      planningRoot: "ideas",
      repositoryRoots: ["code"],
      skillsDirectory: ".agents/skills",
      writeLock: async () => { throw new Error("injected init lock failure"); },
    }),
    /injected init lock failure/,
  );

  assert.equal(await pathExists(join(root, ".sdd", "config.yaml")), false);
  assert.equal(await pathExists(join(root, ".sdd", ".gitignore")), false);
  assert.equal(await pathExists(join(root, ".sdd", "story-driven-development.md")), false);
  assert.equal(await pathExists(join(root, ".agents", "skills", "sdd-apply")), false);
  assert.equal(await pathExists(join(root, ".sdd", "changes")), false);
  assert.equal(await pathExists(join(root, ".sdd")), false);
});

test("failed first-time setup rolls back around a pre-existing installation lock", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-init-existing-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const installLockPath = join(root, ".sdd", "install-lock.json");
  const installLockSource = "{}\n";
  await mkdir(join(root, ".sdd"), { recursive: true });
  await writeFile(installLockPath, installLockSource);

  await assert.rejects(
    () => setupInstallation(root, {
      planningRoot: "ideas",
      repositoryRoots: ["code"],
      skillsDirectory: ".agents/skills",
      writeLock: async () => { throw new Error("injected init lock failure"); },
    }),
    /injected init lock failure/,
  );

  assert.equal(await readFile(installLockPath, "utf8"), installLockSource);
  assert.equal(await pathExists(join(root, ".sdd", "config.yaml")), false);
  assert.equal(await pathExists(join(root, ".sdd", ".gitignore")), false);
  assert.equal(await pathExists(join(root, ".sdd", "changes")), false);
});

test("failed first-time setup preserves pre-existing empty Change-store directories", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-init-existing-changes-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const changesRoot = join(root, ".sdd", "changes");
  const closedChangesRoot = join(changesRoot, "closed");
  await mkdir(closedChangesRoot, { recursive: true });

  await assert.rejects(
    () => setupInstallation(root, {
      planningRoot: "ideas",
      repositoryRoots: ["code"],
      skillsDirectory: ".agents/skills",
      writeLock: async () => { throw new Error("injected init lock failure"); },
    }),
    /injected init lock failure/,
  );

  assert.equal((await lstat(changesRoot)).isDirectory(), true);
  assert.equal((await lstat(closedChangesRoot)).isDirectory(), true);
  assert.equal(await pathExists(join(root, ".sdd", "config.yaml")), false);
  assert.equal(await pathExists(join(root, ".sdd", ".gitignore")), false);
});

test("failed first-time setup removes only the Change-store directory it created", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-init-owned-closed-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const changesRoot = join(root, ".sdd", "changes");
  const closedChangesRoot = join(changesRoot, "closed");
  await mkdir(changesRoot, { recursive: true });

  await assert.rejects(
    () => setupInstallation(root, {
      planningRoot: "ideas",
      repositoryRoots: ["code"],
      skillsDirectory: ".agents/skills",
      writeLock: async () => { throw new Error("injected init lock failure"); },
    }),
    /injected init lock failure/,
  );

  assert.equal((await lstat(changesRoot)).isDirectory(), true);
  assert.equal(await pathExists(closedChangesRoot), false);
});

test("first-time setup reports both the initiating and rollback failures", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-init-cleanup-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const closedChangesRoot = join(root, ".sdd", "changes", "closed");

  await assert.rejects(
    () => setupInstallation(root, {
      planningRoot: "ideas",
      repositoryRoots: ["code"],
      skillsDirectory: ".agents/skills",
      writeLock: async () => {
        throw new Error("injected setup primary failure");
      },
      beforeSetupRollbackQuarantine: async ({ path }) => {
        if (path !== closedChangesRoot) return;
        await rm(closedChangesRoot, { recursive: true });
        await writeFile(closedChangesRoot, "concurrent owner\n");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.cause instanceof AggregateError
      && error.errors.some((failure) =>
        failure.message.includes("injected setup primary failure"))
      && error.errors.some((failure) => failure.code === "CONCURRENT_CHANGE")
      && error.details.some((detail) => detail.includes(
        "Original error: injected setup primary failure",
      ))
      && error.details.some((detail) => detail.includes(closedChangesRoot)),
  );

  assert.equal(await readFile(closedChangesRoot, "utf8"), "concurrent owner\n");
});

test("file replacement preserves a target recreated at publish time", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-file-publish-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source.md");
  const target = join(root, "target.md");
  await writeFile(source, "package version\n");
  await writeFile(target, "original version\n");
  const expectedHash = await hashFile(target);

  await assert.rejects(
    () => replaceFileAtomically(source, target, {
      expectedHash,
      ownerRoot: root,
      beforePublish: () => writeFile(target, "recreated version\n"),
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED",
  );

  assert.equal(await readFile(target, "utf8"), "recreated version\n");
  assert.ok((await readdir(root)).some((name) => name.startsWith(".target.md.sdd-old-")));
});

test("directory replacement preserves a target recreated at publish time", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-directory-publish-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const target = join(root, "target");
  await mkdir(source);
  await mkdir(target);
  await writeFile(join(source, "SKILL.md"), "package version\n");
  await writeFile(join(target, "SKILL.md"), "original version\n");
  const expectedHash = await hashDirectory(target);

  await assert.rejects(
    () => replaceDirectoryAtomically(source, target, {
      expectedHash,
      ownerRoot: root,
      beforePublish: async () => {
        await mkdir(target);
        await writeFile(join(target, "SKILL.md"), "recreated version\n");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED",
  );

  assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "recreated version\n");
  assert.ok((await readdir(root)).some((name) => name.startsWith(".target.sdd-old-")));
});

async function createReplacementRaceWinner(root, target, kind) {
  if (kind === "file") {
    await writeFile(target, "concurrent file\n");
  } else if (kind === "symlink") {
    await symlink(join(root, "concurrent-link-target"), target);
  } else {
    await mkdir(target);
    if (kind === "nonempty-directory") {
      await writeFile(join(target, "winner.txt"), "concurrent directory\n");
    }
  }
}

async function assertReplacementRaceWinner(root, target, kind) {
  const state = await lstat(target);
  if (kind === "file") {
    assert.equal(state.isFile(), true);
    assert.equal(await readFile(target, "utf8"), "concurrent file\n");
  } else if (kind === "symlink") {
    assert.equal(state.isSymbolicLink(), true);
    assert.equal(await readlink(target), join(root, "concurrent-link-target"));
  } else {
    assert.equal(state.isDirectory(), true);
    if (kind === "empty-directory") {
      assert.deepEqual(await readdir(target), []);
    } else {
      assert.equal(await readFile(join(target, "winner.txt"), "utf8"), "concurrent directory\n");
    }
  }
}

test("file publication preserves every concurrent target entry type", async (t) => {
  for (const kind of ["file", "symlink", "empty-directory", "nonempty-directory"]) {
    await t.test(kind, async (t) => {
      const root = await mkdtemp(join(tmpdir(), `sdd-file-target-${kind}-`));
      t.after(() => rm(root, { recursive: true, force: true }));
      const source = join(root, "source.md");
      const target = join(root, "target.md");
      await writeFile(source, "package version\n");
      await writeFile(target, "original version\n");
      const expectedHash = await hashFile(target);

      await assert.rejects(
        () => replaceFileAtomically(source, target, {
          expectedHash,
          ownerRoot: root,
          beforePublish: () => createReplacementRaceWinner(root, target, kind),
        }),
        (error) => error.code === "MUTATION_RECOVERY_FAILED"
          && error.details.some((detail) => detail.includes("Retained backup:")),
      );

      await assertReplacementRaceWinner(root, target, kind);
      assert.ok((await readdir(root)).some((name) => name.startsWith(".target.md.sdd-old-")));
    });
  }
});

test("directory publication preserves every concurrent target entry type", async (t) => {
  for (const kind of ["file", "symlink", "empty-directory", "nonempty-directory"]) {
    await t.test(kind, async (t) => {
      const root = await mkdtemp(join(tmpdir(), `sdd-directory-target-${kind}-`));
      t.after(() => rm(root, { recursive: true, force: true }));
      const source = join(root, "source");
      const target = join(root, "target");
      await mkdir(source);
      await mkdir(target);
      await writeFile(join(source, "SKILL.md"), "package version\n");
      await writeFile(join(target, "SKILL.md"), "original version\n");
      const expectedHash = await hashDirectory(target);

      await assert.rejects(
        () => replaceDirectoryAtomically(source, target, {
          expectedHash,
          ownerRoot: root,
          beforePublish: () => createReplacementRaceWinner(root, target, kind),
        }),
        (error) => error.code === "MUTATION_RECOVERY_FAILED"
          && error.details.some((detail) => detail.includes("Retained backup:")),
      );

      await assertReplacementRaceWinner(root, target, kind);
      assert.ok((await readdir(root)).some((name) => name.startsWith(".target.sdd-old-")));
    });
  }
});

test("file replacement reports an authenticated backup moved to an arbitrary sibling", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-file-backup-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source.md");
  const target = join(root, "target.md");
  await writeFile(source, "package version\n");
  await writeFile(target, "original version\n");
  const expectedHash = await hashFile(target);
  let backup;
  const retainedOriginal = join(root, "original-retained.md");

  await assert.rejects(
    () => replaceFileAtomically(source, target, {
      expectedHash,
      ownerRoot: root,
      afterBackup: async (publication) => {
        backup = publication.backup;
        await rename(backup, retainedOriginal);
        await writeFile(backup, "opaque backup replacement\n");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && !error.details.includes(`Retained backup: ${backup}`)
      && error.details.includes(`Concurrent/opaque retained path: ${backup}`)
      && error.details.includes(`Retained backup: ${retainedOriginal}`)
      && error.details.includes(`Retained path: ${retainedOriginal}`),
  );

  assert.equal(await readFile(backup, "utf8"), "opaque backup replacement\n");
  assert.equal(await readFile(retainedOriginal, "utf8"), "original version\n");
});

test("directory replacement preserves an opaque backup-path swap", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-directory-backup-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const target = join(root, "target");
  await mkdir(source);
  await mkdir(target);
  await writeFile(join(source, "SKILL.md"), "package version\n");
  await writeFile(join(target, "SKILL.md"), "original version\n");
  const expectedHash = await hashDirectory(target);
  let backup;

  await assert.rejects(
    () => replaceDirectoryAtomically(source, target, {
      expectedHash,
      ownerRoot: root,
      afterBackup: async (publication) => {
        backup = publication.backup;
        await rename(backup, `${backup}.authenticated`);
        await mkdir(backup);
        await writeFile(join(backup, "opaque.txt"), "opaque backup replacement\n");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && !error.details.includes(`Retained backup: ${backup}`)
      && error.details.includes(`Concurrent/opaque retained path: ${backup}`)
      && error.details.includes(`Retained backup: ${backup}.authenticated`)
      && error.details.includes(`Retained path: ${backup}.authenticated`),
  );

  assert.equal(await readFile(join(backup, "opaque.txt"), "utf8"), "opaque backup replacement\n");
  assert.equal(
    await readFile(join(`${backup}.authenticated`, "SKILL.md"), "utf8"),
    "original version\n",
  );
});

test("file restoration never overwrites a concurrent restore winner", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-file-restore-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source.md");
  const target = join(root, "target.md");
  await writeFile(source, "package version\n");
  await writeFile(target, "original version\n");
  const expectedHash = await hashFile(target);

  await assert.rejects(
    () => replaceFileAtomically(source, target, {
      expectedHash,
      ownerRoot: root,
      afterBackup: () => {
        throw new Error("injected pre-publication failure");
      },
      beforeRestore: () => writeFile(target, "restore winner\n"),
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.errors.some((failure) => failure.message.includes("injected pre-publication failure")),
  );

  assert.equal(await readFile(target, "utf8"), "restore winner\n");
  assert.ok((await readdir(root)).some((name) => name.startsWith(".target.md.sdd-old-")));
});

test("directory restoration never overwrites a concurrent restore winner", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-directory-restore-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const target = join(root, "target");
  await mkdir(source);
  await mkdir(target);
  await writeFile(join(source, "SKILL.md"), "package version\n");
  await writeFile(join(target, "SKILL.md"), "original version\n");
  const expectedHash = await hashDirectory(target);

  await assert.rejects(
    () => replaceDirectoryAtomically(source, target, {
      expectedHash,
      ownerRoot: root,
      afterBackup: () => {
        throw new Error("injected pre-publication failure");
      },
      beforeRestore: async () => {
        await mkdir(target);
        await writeFile(join(target, "winner.txt"), "restore winner\n");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.errors.some((failure) => failure.message.includes("injected pre-publication failure")),
  );

  assert.equal(await readFile(join(target, "winner.txt"), "utf8"), "restore winner\n");
  assert.ok((await readdir(root)).some((name) => name.startsWith(".target.sdd-old-")));
});

test("file cleanup preserves an opaque temporary-path swap", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-file-temporary-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source.md");
  const target = join(root, "target.md");
  await writeFile(source, "package version\n");
  await writeFile(target, "original version\n");
  const expectedHash = await hashFile(target);
  let temporary;

  await assert.rejects(
    () => replaceFileAtomically(source, target, {
      expectedHash,
      ownerRoot: root,
      beforeCleanup: async ({ kind, path }) => {
        if (kind !== "temporary") return;
        temporary = path;
        await rename(path, `${path}.authenticated`);
        await writeFile(path, "opaque temporary replacement\n");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.includes(`Retained path: ${temporary}`),
  );

  assert.equal(await readFile(target, "utf8"), "package version\n");
  assert.equal(await readFile(temporary, "utf8"), "opaque temporary replacement\n");
});

test("directory cleanup preserves an opaque temporary-path swap", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-directory-temporary-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const target = join(root, "target");
  await mkdir(source);
  await mkdir(target);
  await writeFile(join(source, "SKILL.md"), "package version\n");
  await writeFile(join(target, "SKILL.md"), "original version\n");
  const expectedHash = await hashDirectory(target);
  let temporary;

  await assert.rejects(
    () => replaceDirectoryAtomically(source, target, {
      expectedHash,
      ownerRoot: root,
      beforeCleanup: async ({ kind, path }) => {
        if (kind !== "temporary") return;
        temporary = path;
        await rename(path, `${path}.authenticated`);
        await mkdir(path);
        await writeFile(join(path, "opaque.txt"), "opaque temporary replacement\n");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.includes(`Retained path: ${temporary}`),
  );

  assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "package version\n");
  assert.equal(
    await readFile(join(temporary, "opaque.txt"), "utf8"),
    "opaque temporary replacement\n",
  );
});

test("nested directory publication detects a reservation entry swap", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-directory-nested-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const target = join(root, "target");
  await mkdir(join(source, "nested"), { recursive: true });
  await mkdir(target);
  await writeFile(join(source, "nested", "SKILL.md"), "package version\n");
  await writeFile(join(target, "SKILL.md"), "original version\n");
  const expectedHash = await hashDirectory(target);

  await assert.rejects(
    () => replaceDirectoryAtomically(source, target, {
      expectedHash,
      ownerRoot: root,
      beforeEntryPublish: async ({ relativePath, targetPath }) => {
        if (relativePath !== "nested/SKILL.md") return;
        const nested = join(target, "nested");
        await rename(nested, `${nested}.authenticated`);
        await mkdir(nested);
        await writeFile(targetPath, "nested reservation winner\n");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.includes(`Retained path: ${target}`),
  );

  assert.equal(
    await readFile(join(target, "nested", "SKILL.md"), "utf8"),
    "nested reservation winner\n",
  );
  assert.ok((await readdir(root)).some((name) => name.startsWith(".target.sdd-old-")));
});

test("file replacement aggregates temporary and backup cleanup swaps", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-file-dual-cleanup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source.md");
  const target = join(root, "target.md");
  await writeFile(source, "package version\n");
  await writeFile(target, "original version\n");
  const expectedHash = await hashFile(target);
  const swapped = [];

  await assert.rejects(
    () => replaceFileAtomically(source, target, {
      expectedHash,
      ownerRoot: root,
      beforeCleanup: async ({ kind, path }) => {
        if (!["temporary", "backup"].includes(kind)) return;
        swapped.push(path);
        await rename(path, `${path}.authenticated`);
        await writeFile(path, `opaque ${kind}\n`);
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.errors.length >= 2
      && swapped.every((path) => error.details.includes(`Retained path: ${path}`)),
  );

  assert.equal(swapped.length, 2);
  assert.equal(await readFile(target, "utf8"), "package version\n");
  assert.deepEqual(
    new Set(await Promise.all(swapped.map((path) => readFile(path, "utf8")))),
    new Set(["opaque temporary\n", "opaque backup\n"]),
  );
});

test("directory replacement aggregates temporary and backup cleanup swaps", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-directory-dual-cleanup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const target = join(root, "target");
  await mkdir(source);
  await mkdir(target);
  await writeFile(join(source, "SKILL.md"), "package version\n");
  await writeFile(join(target, "SKILL.md"), "original version\n");
  const expectedHash = await hashDirectory(target);
  const swapped = [];

  await assert.rejects(
    () => replaceDirectoryAtomically(source, target, {
      expectedHash,
      ownerRoot: root,
      beforeCleanup: async ({ kind, path }) => {
        if (!["temporary", "backup"].includes(kind)) return;
        swapped.push(path);
        await rename(path, `${path}.authenticated`);
        await mkdir(path);
        await writeFile(join(path, "opaque.txt"), `opaque ${kind}\n`);
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.errors.length >= 2
      && swapped.every((path) => error.details.includes(`Retained path: ${path}`)),
  );

  assert.equal(swapped.length, 2);
  assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "package version\n");
  assert.deepEqual(
    new Set(await Promise.all(swapped.map(
      (path) => readFile(join(path, "opaque.txt"), "utf8"),
    ))),
    new Set(["opaque temporary\n", "opaque backup\n"]),
  );
});

test("directory cleanup preserves a colliding exclusive cleanup claim", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-directory-cleanup-claim-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const target = join(root, "target");
  await mkdir(source);
  await mkdir(target);
  await writeFile(join(source, "SKILL.md"), "package version\n");
  await writeFile(join(target, "SKILL.md"), "original version\n");
  const expectedHash = await hashDirectory(target);
  let cleanupClaim = null;

  await assert.rejects(
    () => replaceDirectoryAtomically(source, target, {
      expectedHash,
      ownerRoot: root,
      beforeCleanup: async ({ kind, quarantine }) => {
        if (kind !== "target") return;
        cleanupClaim = quarantine;
        await mkdir(cleanupClaim);
        await writeFile(join(cleanupClaim, "opaque.txt"), "opaque claim winner\n");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) =>
        detail.includes(`Retained path: ${cleanupClaim}`)),
  );

  assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "original version\n");
  assert.equal(
    await readFile(join(cleanupClaim, "opaque.txt"), "utf8"),
    "opaque claim winner\n",
  );
});

test("directory cleanup hardlinks leaves before the last replacement hook", async (t) => {
  for (const entryKind of ["file", "symlink", "empty-directory", "nonempty-directory"]) {
    await t.test(entryKind, async (t) => {
      const root = await mkdtemp(join(tmpdir(), `sdd-directory-entry-${entryKind}-`));
      t.after(() => rm(root, { recursive: true, force: true }));
      const source = join(root, "source");
      const target = join(root, "target");
      const victim = join(target, "nested", "victim");
      const relativePath = "nested/victim";
      const displaced = `${victim}.authenticated`;
      await mkdir(source);
      await mkdir(join(target, "nested"), { recursive: true });
      await writeFile(join(source, "SKILL.md"), "package version\n");
      if (entryKind === "file") {
        await writeFile(victim, "authenticated file\n");
      } else if (entryKind === "symlink") {
        await symlink(join(root, "authenticated-target"), victim);
      } else {
        await mkdir(victim);
        if (entryKind === "nonempty-directory") {
          await writeFile(join(victim, "owned.txt"), "authenticated child\n");
        }
      }
      const expectedHash = await hashDirectory(target);
      let cleanupClaim = null;
      let claimEntry = null;

      await assert.rejects(
        () => replaceDirectoryAtomically(source, target, {
          expectedHash,
          ownerRoot: root,
          beforeEntryCleanup: async ({
            kind,
            quarantine,
            relativePath: cleanupRelativePath,
            targetPath,
          }) => {
            if (kind !== "target" || cleanupRelativePath !== relativePath) return;
            cleanupClaim = quarantine;
            if (["file", "symlink"].includes(entryKind)) {
              const claimEntries = await readdir(cleanupClaim);
              assert.equal(claimEntries.length, 1);
              [claimEntry] = claimEntries;
            }
            await rename(targetPath, displaced);
            await createReplacementRaceWinner(root, targetPath, entryKind);
          },
        }),
        (error) => error.code === "MUTATION_RECOVERY_FAILED"
          && error.details.some((detail) =>
            detail.includes(`Retained path: ${target}`)),
      );

      await assertReplacementRaceWinner(root, victim, entryKind);
      if (entryKind === "file") {
        assert.equal(await readFile(displaced, "utf8"), "authenticated file\n");
        assert.equal(
          await readFile(join(cleanupClaim, claimEntry), "utf8"),
          "authenticated file\n",
        );
      } else if (entryKind === "symlink") {
        assert.equal(await readlink(displaced), join(root, "authenticated-target"));
        assert.equal(
          await readlink(join(cleanupClaim, claimEntry)),
          join(root, "authenticated-target"),
        );
      } else {
        assert.equal((await lstat(displaced)).isDirectory(), true);
      }
    });
  }
});

test("directory cleanup aggregates entry and authenticated-claim removal failures", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-directory-cleanup-dual-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, "target");
  await mkdir(target);
  await writeFile(join(target, "SKILL.md"), "authenticated original\n");
  const expected = await readBoundDirectory(target, {
    ownerRoot: root,
    label: "Owned test directory",
  });
  let cleanupClaim = null;

  const removal = await removeBoundDirectory(target, expected, {
    ownerRoot: root,
    label: "Owned test directory",
    beforeCleanup: ({ quarantine }) => {
      cleanupClaim = quarantine;
    },
    cleanupUnlink: async (path) => {
      await unlink(path);
      throw new Error("injected entry cleanup failure");
    },
    cleanupRmdir: async (path) => {
      if (path === cleanupClaim) {
        throw new Error("injected claim cleanup failure");
      }
      return rmdir(path);
    },
  });

  assert.equal(removal.removed, false);
  assert.equal(removal.failures.length, 2);
  assert.equal(
    removal.failures.some(({ error }) =>
      error.message.includes("injected entry cleanup failure")),
    true,
  );
  assert.equal(
    removal.failures.some(({ error }) =>
      error.message.includes("injected claim cleanup failure")),
    true,
  );
  assert.equal(removal.retainedPaths.includes(target), true);
  assert.equal(removal.retainedPaths.includes(cleanupClaim), true);
  const [authenticatedEntry] = await readdir(cleanupClaim);
  assert.equal(
    await readFile(join(cleanupClaim, authenticatedEntry), "utf8"),
    "authenticated original\n",
  );
});

test("directory cleanup reports a mode-widened complete backup as authenticated", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-directory-cleanup-backup-provenance-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const target = join(root, "target");
  await mkdir(source);
  await mkdir(target);
  await writeFile(join(source, "SKILL.md"), "package version\n");
  await writeFile(join(target, "SKILL.md"), "original version\n");
  await chmod(target, 0o555);
  const expectedHash = await hashDirectory(target);
  let retainedBackup = null;

  await assert.rejects(
    () => replaceDirectoryAtomically(source, target, {
      expectedHash,
      ownerRoot: root,
      beforeEntryCleanup: ({ kind, path, relativePath }) => {
        if (kind !== "backup" || relativePath !== "SKILL.md") return;
        retainedBackup = path;
        throw new Error("injected backup entry cleanup failure");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.includes(`Retained backup: ${retainedBackup}`),
  );

  assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "package version\n");
  assert.equal(
    await readFile(join(retainedBackup, "SKILL.md"), "utf8"),
    "original version\n",
  );
  assert.equal((await stat(retainedBackup)).mode & 0o777, 0o755);
});

test("replacement primitives require an explicit owner root", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-replacement-owner-required-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fileSource = join(root, "source.md");
  const fileTarget = join(root, "target.md");
  const directorySource = join(root, "source");
  const directoryTarget = join(root, "target");
  await writeFile(fileSource, "package file\n");
  await writeFile(fileTarget, "original file\n");
  await mkdir(directorySource);
  await mkdir(directoryTarget);
  await writeFile(join(directorySource, "SKILL.md"), "package directory\n");
  await writeFile(join(directoryTarget, "SKILL.md"), "original directory\n");

  await assert.rejects(
    () => replaceFileAtomically(fileSource, fileTarget),
    (error) => error.code === "UNSAFE_REPLACEMENT_PATH",
  );
  await assert.rejects(
    () => replaceDirectoryAtomically(directorySource, directoryTarget),
    (error) => error.code === "UNSAFE_REPLACEMENT_PATH",
  );

  assert.equal(await readFile(fileTarget, "utf8"), "original file\n");
  assert.equal(
    await readFile(join(directoryTarget, "SKILL.md"), "utf8"),
    "original directory\n",
  );
});

test("file replacement rejects an owner-ancestor swap to external same-content state", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-file-owner-swap-"));
  const external = await mkdtemp(join(tmpdir(), "sdd-file-owner-external-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(external, { recursive: true, force: true }));
  const managed = join(root, "managed");
  const retainedManaged = join(root, "managed-authenticated");
  const source = join(root, "source.md");
  const target = join(managed, "target.md");
  const externalTarget = join(external, "target.md");
  await mkdir(managed);
  await writeFile(source, "package version\n");
  await writeFile(target, "original version\n");
  await writeFile(externalTarget, "package version\n");
  const expectedHash = await hashFile(target);

  await assert.rejects(
    () => replaceFileAtomically(source, target, {
      expectedHash,
      ownerRoot: root,
      beforePublish: async () => {
        await rename(managed, retainedManaged);
        await symlink(external, managed);
      },
    }),
    (error) => ["CONCURRENT_CHANGE", "MUTATION_RECOVERY_FAILED"].includes(error.code),
  );

  assert.equal((await lstat(managed)).isSymbolicLink(), true);
  assert.equal(await readFile(externalTarget, "utf8"), "package version\n");
  assert.deepEqual(await readdir(external), ["target.md"]);
  assert.ok(
    (await readdir(retainedManaged)).some((name) => name.startsWith(".target.md.sdd-old-")),
  );
});

test("directory replacement rejects an owner-ancestor swap to external same-content state", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-directory-owner-swap-"));
  const external = await mkdtemp(join(tmpdir(), "sdd-directory-owner-external-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(external, { recursive: true, force: true }));
  const managed = join(root, "managed");
  const retainedManaged = join(root, "managed-authenticated");
  const source = join(root, "source");
  const target = join(managed, "target");
  const externalTarget = join(external, "target");
  await mkdir(source);
  await mkdir(managed);
  await mkdir(externalTarget);
  await writeFile(join(source, "SKILL.md"), "package version\n");
  await mkdir(target);
  await writeFile(join(target, "SKILL.md"), "original version\n");
  await writeFile(join(externalTarget, "SKILL.md"), "package version\n");
  const expectedHash = await hashDirectory(target);

  await assert.rejects(
    () => replaceDirectoryAtomically(source, target, {
      expectedHash,
      ownerRoot: root,
      beforePublish: async () => {
        await rename(managed, retainedManaged);
        await symlink(external, managed);
      },
    }),
    (error) => ["CONCURRENT_CHANGE", "MUTATION_RECOVERY_FAILED"].includes(error.code),
  );

  assert.equal((await lstat(managed)).isSymbolicLink(), true);
  assert.equal(
    await readFile(join(externalTarget, "SKILL.md"), "utf8"),
    "package version\n",
  );
  assert.deepEqual(await readdir(external), ["target"]);
  assert.ok(
    (await readdir(retainedManaged)).some((name) => name.startsWith(".target.sdd-old-")),
  );
});

test("bound regular-file removal deletes its authenticated file", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-bound-file-remove-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, "owned.txt");
  await writeFile(target, "owned bytes\n");
  const snapshot = await readBoundRegularFile(target, {
    ownerRoot: root,
    label: "Owned test file",
  });

  const removed = await removeBoundRegularFile(target, snapshot, {
    ownerRoot: root,
    label: "Owned test file",
  });

  assert.equal(removed.bytes.toString("utf8"), "owned bytes\n");
  assert.equal(await pathExists(target), false);
  assert.deepEqual(await readdir(root), []);
});

test("bound regular-file removal rejects an ancestor swap to external same-content state", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-bound-file-owner-swap-"));
  const external = await mkdtemp(join(tmpdir(), "sdd-bound-file-owner-external-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(external, { recursive: true, force: true }));
  const managed = join(root, "managed");
  const retainedManaged = join(root, "managed-authenticated");
  const target = join(managed, "owned.txt");
  const externalTarget = join(external, "owned.txt");
  await mkdir(managed);
  await writeFile(target, "same bytes\n");
  await writeFile(externalTarget, "same bytes\n");
  const snapshot = await readBoundRegularFile(target, {
    ownerRoot: root,
    label: "Owned test file",
  });

  await assert.rejects(
    () => removeBoundRegularFile(target, snapshot, {
      ownerRoot: root,
      label: "Owned test file",
      beforeCleanup: async () => {
        await rename(managed, retainedManaged);
        await symlink(external, managed);
      },
    }),
    (error) => ["CONCURRENT_CHANGE", "MUTATION_RECOVERY_FAILED"].includes(error.code),
  );

  assert.equal((await lstat(managed)).isSymbolicLink(), true);
  assert.equal(await readFile(externalTarget, "utf8"), "same bytes\n");
  assert.deepEqual(await readdir(external), ["owned.txt"]);
  assert.equal(await readFile(join(retainedManaged, "owned.txt"), "utf8"), "same bytes\n");
});

test("bound regular-file removal retains an authenticated quarantine after an entry swap", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-bound-file-quarantine-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, "owned.txt");
  await writeFile(target, "authenticated bytes\n");
  const snapshot = await readBoundRegularFile(target, {
    ownerRoot: root,
    label: "Owned test file",
  });
  let quarantine = null;
  let quarantineRoot = null;

  await assert.rejects(
    () => removeBoundRegularFile(target, snapshot, {
      ownerRoot: root,
      label: "Owned test file",
      afterQuarantine: async ({ quarantine: claimed }) => {
        quarantine = claimed;
        quarantineRoot = dirname(claimed);
        await rename(claimed, `${claimed}.authenticated`);
        await writeFile(claimed, "opaque replacement\n");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.includes(`Retained path: ${quarantineRoot}`),
  );

  assert.equal(await pathExists(target), false);
  assert.equal(await readFile(quarantine, "utf8"), "opaque replacement\n");
  assert.equal(
    await readFile(`${quarantine}.authenticated`, "utf8"),
    "authenticated bytes\n",
  );
});

test("bound regular-file removal preserves a canonical replacement made at remove-canonical", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-bound-file-remove-canonical-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, "owned.txt");
  const authenticated = join(root, "owned.authenticated.txt");
  await writeFile(target, "authenticated bytes\n");
  const snapshot = await readBoundRegularFile(target, {
    ownerRoot: root,
    label: "Owned test file",
  });
  let quarantineRoot = null;

  await assert.rejects(
    () => removeBoundRegularFile(target, snapshot, {
      ownerRoot: root,
      label: "Owned test file",
      beforeRemovalMutation: async (mutation) => {
        if (mutation.action !== "remove-canonical") return;
        quarantineRoot = dirname(mutation.target);
        await rename(mutation.path, authenticated);
        await writeFile(mutation.path, "opaque replacement\n");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.includes(`Retained path: ${quarantineRoot}`),
  );

  assert.equal(await readFile(target, "utf8"), "opaque replacement\n");
  assert.equal(await readFile(authenticated, "utf8"), "authenticated bytes\n");
  assert.equal(
    await readFile(join(quarantineRoot, "entry"), "utf8"),
    "authenticated bytes\n",
  );
});

test("bound regular-file removal preserves a quarantine replacement made at remove-source", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-bound-file-remove-source-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, "owned.txt");
  await writeFile(target, "authenticated bytes\n");
  const snapshot = await readBoundRegularFile(target, {
    ownerRoot: root,
    label: "Owned test file",
  });
  let quarantine = null;
  let authenticated = null;
  let unlinkSlot = null;

  await assert.rejects(
    () => removeBoundRegularFile(target, snapshot, {
      ownerRoot: root,
      label: "Owned test file",
      beforeRemovalMutation: async (mutation) => {
        if (mutation.action !== "remove-source") return;
        quarantine = mutation.path;
        authenticated = join(root, "quarantine-authenticated.txt");
        unlinkSlot = mutation.target;
        await rename(mutation.path, authenticated);
        await writeFile(mutation.path, "opaque replacement\n");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.includes(`Retained path: ${dirname(quarantine)}`),
  );

  assert.equal(await pathExists(target), false);
  assert.equal(await readFile(quarantine, "utf8"), "opaque replacement\n");
  assert.equal(await readFile(authenticated, "utf8"), "authenticated bytes\n");
  assert.equal(await readFile(unlinkSlot, "utf8"), "authenticated bytes\n");
});


test("first setup preserves a same-byte config replacement made by its lock writer", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-setup-config-first-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = join(root, ".sdd", "config.yaml");
  const displacedConfig = join(root, "setup-owned-config.yaml");
  let replacementSource;

  await assert.rejects(
    setupInstallation(root, {
      planningRoot: "ideas",
      repositoryRoots: ["repos"],
      skillsDirectory: ".agents/skills",
      writeLock: async (lockPath, lockSource, options) => {
        replacementSource = await readFile(configPath, "utf8");
        await rename(configPath, displacedConfig);
        await writeFile(configPath, replacementSource, "utf8");
        return writeFileAtomically(lockPath, lockSource, options);
      },
    }),
    (error) => error?.code === "MUTATION_RECOVERY_FAILED",
  );
  assert.equal(await readFile(configPath, "utf8"), replacementSource);
  assert.equal(await readFile(displacedConfig, "utf8"), replacementSource);
  assert.equal(await pathExists(join(root, ".sdd", "install-lock.json")), false);
  assert.equal(
    await pathExists(join(root, ".sdd", "story-driven-development.md")),
    false,
  );
  assert.equal(
    await pathExists(join(root, ".agents", "skills", "sdd-change")),
    false,
  );
});

test("repeated setup preserves a same-byte config replacement and restores its lock", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-setup-config-repeat-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const setupOptions = {
    planningRoot: "ideas",
    repositoryRoots: ["repos/alpha", "services/beta"],
    skillsDirectory: ".agents/skills",
  };
  await setupInstallation(root, setupOptions);
  const configPath = join(root, ".sdd", "config.yaml");
  const lockPath = join(root, ".sdd", "install-lock.json");
  const displacedConfig = join(root, "previous-config.yaml");
  const configSource = await readFile(configPath, "utf8");
  const lockSource = await readFile(lockPath, "utf8");

  await assert.rejects(
    setupInstallation(root, {
      ...setupOptions,
      repositoryRoots: [...setupOptions.repositoryRoots].reverse(),
      writeLock: async (target, source, options) => {
        await rename(configPath, displacedConfig);
        await writeFile(configPath, configSource, "utf8");
        return writeFileAtomically(target, source, options);
      },
    }),
    (error) => error?.code === "CONCURRENT_CHANGE",
  );
  assert.equal(await readFile(configPath, "utf8"), configSource);
  assert.equal(await readFile(displacedConfig, "utf8"), configSource);
  assert.equal(await readFile(lockPath, "utf8"), lockSource);
  assert.equal(
    await pathExists(join(root, ".sdd", "story-driven-development.md")),
    true,
  );
  assert.equal(
    await pathExists(join(root, ".agents", "skills", "sdd-change")),
    true,
  );
});

test("directory hashes distinguish a released NUL-framing collision", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-directory-hash-framing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const single = join(root, "single");
  const split = join(root, "split");
  await mkdir(single);
  await mkdir(split);
  await writeFile(join(single, "a"), "x\0file\0b\0y");
  await writeFile(join(split, "a"), "x");
  await writeFile(join(split, "b"), "y");

  const releasedHash = async (directory) => {
    const hash = createHash("sha256");
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      assert.equal(entry.isFile(), true);
      hash.update(`file\0${entry.name}\0`);
      hash.update(await readFile(join(directory, entry.name)));
      hash.update("\0");
    }
    return `sha256:${hash.digest("hex")}`;
  };
  assert.equal(await releasedHash(single), await releasedHash(split));

  const singleHash = await hashDirectory(single);
  const splitHash = await hashDirectory(split);
  assert.match(singleHash, /^sha256-directory-v2:[a-f0-9]{64}$/);
  assert.match(splitHash, /^sha256-directory-v2:[a-f0-9]{64}$/);
  assert.notEqual(singleHash, splitHash);
});

test("directory hashes include root and entry modes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-directory-hash-modes-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = join(root, "first");
  const second = join(root, "second");
  await mkdir(first);
  await mkdir(second);
  await writeFile(join(first, "SKILL.md"), "same bytes\n");
  await writeFile(join(second, "SKILL.md"), "same bytes\n");
  await chmod(first, 0o755);
  await chmod(second, 0o755);
  await chmod(join(first, "SKILL.md"), 0o600);
  await chmod(join(second, "SKILL.md"), 0o644);

  assert.notEqual(await hashDirectory(first), await hashDirectory(second));
  await chmod(join(second, "SKILL.md"), 0o600);
  assert.equal(await hashDirectory(first), await hashDirectory(second));
  await chmod(second, 0o700);
  assert.notEqual(await hashDirectory(first), await hashDirectory(second));
});

test("directory replacement stages read-only directory modes owner-writable then finalizes them", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-directory-read-only-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const target = join(root, "target");
  const nested = join(source, "nested");
  await mkdir(nested, { recursive: true });
  await mkdir(target);
  await writeFile(join(nested, "SKILL.md"), "read-only package\n");
  await writeFile(join(target, "SKILL.md"), "original package\n");
  await chmod(nested, 0o555);
  await chmod(source, 0o555);
  const expectedHash = await hashDirectory(target);

  await replaceDirectoryAtomically(source, target, {
    expectedHash,
    ownerRoot: root,
  });

  assert.equal((await stat(target)).mode & 0o777, 0o555);
  assert.equal((await stat(join(target, "nested"))).mode & 0o777, 0o555);
  assert.equal(
    await readFile(join(target, "nested", "SKILL.md"), "utf8"),
    "read-only package\n",
  );
});

test("file replacement reports directory fsync failures by durability phase", async (t) => {
  for (const failurePhase of [
    "backup-reservation",
    "backup-removal",
    "publication",
    "backup-cleanup",
  ]) {
    await t.test(failurePhase, async (t) => {
      const root = await mkdtemp(join(tmpdir(), `sdd-file-fsync-${failurePhase}-`));
      t.after(() => rm(root, { recursive: true, force: true }));
      const source = join(root, "source.md");
      const target = join(root, "target.md");
      await writeFile(source, "package version\n");
      await writeFile(target, "original version\n");
      const expectedHash = await hashFile(target);
      const phases = [];

      await assert.rejects(
        () => replaceFileAtomically(source, target, {
          expectedHash,
          ownerRoot: root,
          syncDirectoryPath: async (_path, metadata) => {
            phases.push(metadata.phase);
            if (metadata.phase === failurePhase) {
              throw new Error(`injected ${failurePhase} fsync failure`);
            }
          },
        }),
        (error) => error.code === "MUTATION_RECOVERY_FAILED"
          && phases.includes(failurePhase),
      );

      assert.equal(
        await readFile(target, "utf8"),
        ["backup-reservation", "backup-removal"].includes(failurePhase)
          ? "original version\n"
          : "package version\n",
      );
    });
  }
});

test("directory replacement reports tree and cleanup fsync failures by phase", async (t) => {
  for (const failurePhase of [
    "backup-tree",
    "publication",
    "backup-cleanup-parent",
  ]) {
    await t.test(failurePhase, async (t) => {
      const root = await mkdtemp(join(tmpdir(), `sdd-directory-fsync-${failurePhase}-`));
      t.after(() => rm(root, { recursive: true, force: true }));
      const source = join(root, "source");
      const target = join(root, "target");
      await mkdir(join(source, "nested"), { recursive: true });
      await mkdir(join(target, "nested"), { recursive: true });
      await writeFile(join(source, "nested", "SKILL.md"), "package version\n");
      await writeFile(join(target, "nested", "SKILL.md"), "original version\n");
      const expectedHash = await hashDirectory(target);
      const phases = [];

      await assert.rejects(
        () => replaceDirectoryAtomically(source, target, {
          expectedHash,
          ownerRoot: root,
          syncDirectoryPath: async (_path, metadata) => {
            phases.push(metadata.phase);
            if (metadata.phase === failurePhase) {
              throw new Error(`injected ${failurePhase} fsync failure`);
            }
          },
        }),
        (error) => error.code === "MUTATION_RECOVERY_FAILED"
          && phases.includes(failurePhase),
      );

      assert.equal(
        await readFile(join(target, "nested", "SKILL.md"), "utf8"),
        failurePhase === "backup-tree"
          ? "original version\n"
          : "package version\n",
      );
    });
  }
});

test("replacement primitives bind relative paths before hooks can change cwd", async (t) => {
  const previousCwd = process.cwd();
  const root = await mkdtemp(join(tmpdir(), "sdd-replacement-cwd-binding-"));
  const decoy = await mkdtemp(join(tmpdir(), "sdd-replacement-cwd-decoy-"));
  t.after(async () => {
    process.chdir(previousCwd);
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(decoy, { recursive: true, force: true }),
    ]);
  });

  try {
    const fileSource = join(root, "source.md");
    const fileTarget = join(root, "target.md");
    await writeFile(fileSource, "package file\n");
    await writeFile(fileTarget, "original file\n");
    await writeFile(join(decoy, "target.md"), "decoy file\n");
    process.chdir(root);
    await replaceFileAtomically("source.md", "target.md", {
      expectedHash: await hashFile(fileTarget),
      ownerRoot: ".",
      beforePublish: () => process.chdir(decoy),
    });
    assert.equal(await readFile(fileTarget, "utf8"), "package file\n");
    assert.equal(await readFile(join(decoy, "target.md"), "utf8"), "decoy file\n");

    const directorySource = join(root, "source");
    const directoryTarget = join(root, "target");
    await mkdir(directorySource);
    await mkdir(directoryTarget);
    await mkdir(join(decoy, "target"));
    await writeFile(join(directorySource, "SKILL.md"), "package directory\n");
    await writeFile(join(directoryTarget, "SKILL.md"), "original directory\n");
    await writeFile(join(decoy, "target", "SKILL.md"), "decoy directory\n");
    process.chdir(root);
    await replaceDirectoryAtomically("source", "target", {
      expectedHash: await hashDirectory(directoryTarget),
      ownerRoot: ".",
      beforePublish: () => process.chdir(decoy),
    });
    assert.equal(
      await readFile(join(directoryTarget, "SKILL.md"), "utf8"),
      "package directory\n",
    );
    assert.equal(
      await readFile(join(decoy, "target", "SKILL.md"), "utf8"),
      "decoy directory\n",
    );
  } finally {
    process.chdir(previousCwd);
  }
});

test("file cleanup fsync guards retain names recreated during sync", async (t) => {
  for (const kind of ["temporary", "backup"]) {
    await t.test(kind, async (t) => {
      const root = await mkdtemp(join(tmpdir(), `sdd-file-fsync-${kind}-swap-`));
      t.after(() => rm(root, { recursive: true, force: true }));
      const source = join(root, "source.md");
      const target = join(root, "target.md");
      await writeFile(source, "package version\n");
      await writeFile(target, "original version\n");
      const expectedHash = await hashFile(target);
      let recreated = null;

      await assert.rejects(
        () => replaceFileAtomically(source, target, {
          expectedHash,
          ownerRoot: root,
          syncDirectoryPath: async (_path, metadata) => {
            if (metadata.phase !== `${kind}-cleanup` || recreated !== null) return;
            recreated = metadata[kind];
            await writeFile(recreated, `opaque ${kind}\n`);
          },
        }),
        (error) => error.code === "MUTATION_RECOVERY_FAILED"
          && error.details.includes(`Retained path: ${recreated}`),
      );

      assert.equal(await readFile(target, "utf8"), "package version\n");
      assert.equal(await readFile(recreated, "utf8"), `opaque ${kind}\n`);
    });
  }
});

test("setup preserves a workflow inode swapped during its final success guard", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-setup-final-workflow-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workflowPath = join(root, ".sdd", "story-driven-development.md");
  const displacedWorkflow = join(root, "published-workflow.md");
  let workflowSource;
  let publishedIdentity;
  let winnerIdentity;
  let failure;

  await assert.rejects(
    setupInstallation(root, {
      planningRoot: "ideas",
      repositoryRoots: ["repos"],
      skillsDirectory: ".agents/skills",
      beforeManagedInstallationSuccess: async () => {
        workflowSource = await readFile(workflowPath, "utf8");
        const publishedState = await lstat(workflowPath, { bigint: true });
        publishedIdentity = `${publishedState.dev}:${publishedState.ino}`;
        await rename(workflowPath, displacedWorkflow);
        await writeFile(workflowPath, workflowSource, "utf8");
        const winnerState = await lstat(workflowPath, { bigint: true });
        winnerIdentity = `${winnerState.dev}:${winnerState.ino}`;
      },
    }),
    (error) => {
      failure = error;
      return error?.code === "MUTATION_RECOVERY_FAILED";
    },
  );
  const installationFailure = failure.message === "Managed installation failed and recovery was incomplete."
    ? failure
    : failure.errors.find((error) =>
        error?.message === "Managed installation failed and recovery was incomplete.");
  assert.equal(installationFailure.originalError.code, "CONCURRENT_CHANGE");
  assert.equal(installationFailure.errors[0], installationFailure.originalError);
  assert.equal(installationFailure.cause instanceof AggregateError, true);
  assert.equal(
    installationFailure.failures.some(({ label, error }) =>
      label === "Managed workflow rollback"
      && error.code === "MUTATION_RECOVERY_FAILED"),
    true,
  );
  assert.equal(installationFailure.retainedPaths.includes(workflowPath), true);

  assert.notEqual(winnerIdentity, publishedIdentity);
  assert.equal(await readFile(workflowPath, "utf8"), workflowSource);
  assert.equal(await readFile(displacedWorkflow, "utf8"), workflowSource);
  assert.equal(await pathExists(join(root, ".sdd", "install-lock.json")), false);
});

test("setup preserves an install-lock inode swapped during its final success guard", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-setup-final-lock-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const displacedLock = join(root, "published-install-lock.json");
  let lockSource;
  let lockPath;
  let publishedIdentity;
  let winnerIdentity;

  await assert.rejects(
    setupInstallation(root, {
      planningRoot: "ideas",
      repositoryRoots: ["repos"],
      skillsDirectory: ".agents/skills",
      beforeManagedInstallationSuccess: async (context) => {
        lockPath = context.lockPath;
        lockSource = await readFile(lockPath, "utf8");
        const publishedState = await lstat(lockPath, { bigint: true });
        publishedIdentity = `${publishedState.dev}:${publishedState.ino}`;
        await rename(lockPath, displacedLock);
        await writeFile(lockPath, lockSource, "utf8");
        const winnerState = await lstat(lockPath, { bigint: true });
        winnerIdentity = `${winnerState.dev}:${winnerState.ino}`;
      },
    }),
    (error) => error?.code === "MUTATION_RECOVERY_FAILED",
  );

  assert.notEqual(winnerIdentity, publishedIdentity);
  assert.equal(await readFile(lockPath, "utf8"), lockSource);
  assert.equal(await readFile(displacedLock, "utf8"), lockSource);
  assert.equal(
    await pathExists(join(root, ".sdd", "story-driven-development.md")),
    false,
  );
  assert.equal(
    await pathExists(join(root, ".agents", "skills", "sdd-change")),
    false,
  );
});

test("setup final invariants preserve an external Change-store replacement", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-setup-change-store-swap-"));
  const external = await mkdtemp(join(tmpdir(), "sdd-setup-change-store-external-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(external, { recursive: true, force: true }));
  const changesRoot = join(root, ".sdd", "changes");
  const displacedChanges = join(root, "owned-changes");
  const externalMarker = join(external, "opaque.txt");
  await mkdir(join(changesRoot, "closed"), { recursive: true });
  await writeFile(externalMarker, "external winner\n");

  await assert.rejects(
    setupInstallation(root, {
      planningRoot: "ideas",
      repositoryRoots: ["repos"],
      skillsDirectory: ".agents/skills",
      beforeManagedInstallationSuccess: async () => {
        await rename(changesRoot, displacedChanges);
        await symlink(external, changesRoot, "dir");
      },
    }),
    (error) => error?.code === "CONCURRENT_CHANGE"
      && error.message.includes(changesRoot),
  );

  assert.equal((await lstat(changesRoot)).isSymbolicLink(), true);
  assert.equal(await readFile(externalMarker, "utf8"), "external winner\n");
  assert.equal(
    (await lstat(join(displacedChanges, "closed"))).isDirectory(),
    true,
  );
  assert.equal(await pathExists(join(root, ".sdd", "install-lock.json")), false);
  assert.equal(
    await pathExists(join(root, ".sdd", "story-driven-development.md")),
    false,
  );
});

test("setup commit signal preserves owned directories when finalization fails", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-setup-commit-signal-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await setupInstallation(root, {
    planningRoot: "ideas",
    repositoryRoots: ["repos"],
    skillsDirectory: ".agents/skills",
  });
  const lockPath = join(root, ".sdd", "install-lock.json");
  const workflowPath = join(root, ".sdd", "story-driven-development.md");
  const changesRoot = join(root, ".sdd", "changes");
  const desiredLock = await readFile(lockPath, "utf8");
  const desiredWorkflow = await readFile(workflowPath, "utf8");
  await writeFile(workflowPath, "locally drifted workflow\n");
  await rm(changesRoot, { recursive: true, force: true });
  let backup;
  let displacedBackup;

  await assert.rejects(
    setupInstallation(root, {
      force: true,
      beforeManagedInstallationSuccess: async () => {
        const backupName = (await readdir(dirname(workflowPath)))
          .find((name) => name.startsWith(".sdd-workflow-backup-"));
        assert.equal(typeof backupName, "string");
        backup = join(dirname(workflowPath), backupName);
        displacedBackup = `${backup}.displaced`;
        await rename(backup, displacedBackup);
        await mkdir(backup);
        await writeFile(join(backup, "opaque.txt"), "opaque backup replacement\n");
      },
    }),
    (error) => error?.code === "MUTATION_RECOVERY_FAILED"
      && error.committed === true
      && error.retainedPaths.includes(backup),
  );

  assert.equal(await readFile(lockPath, "utf8"), desiredLock);
  assert.equal(await readFile(workflowPath, "utf8"), desiredWorkflow);
  assert.equal((await lstat(changesRoot)).isDirectory(), true);
  assert.equal((await lstat(join(changesRoot, "closed"))).isDirectory(), true);
  assert.equal(
    await readFile(join(backup, "opaque.txt"), "utf8"),
    "opaque backup replacement\n",
  );
  assert.equal((await lstat(displacedBackup)).isFile(), true);
  assert.equal(await pathExists(join(root, ".sdd", "config.yaml")), true);
});