import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";

import { readWorkspaceConfig } from "../src/config.js";
import { publishConfigFile } from "../src/config-publication.js";
import { setupInstallation } from "../src/commands/init-installation.js";
import { WORKFLOW_SOURCE_PATH } from "../src/constants.js";
import {
  hashDirectory,
  hashFile,
  pathExists,
} from "../src/fs.js";
import {
  applyManagedInstallation,
  serializeManagedInstallationLock,
} from "../src/installation.js";
import { publishManagedFile } from "../src/managed-file-publication.js";
import { withWorkspaceMutationLock } from "../src/mutation.js";
import {
  applySkillSync,
  readInstallLock,
} from "../src/skills.js";
import { applyWorkflowSync } from "../src/workflow.js";

function mutationLockPath(root) {
  return join(root, ".sdd", "mutation.lock");
}

async function createSkill(root, skillName, source) {
  const path = join(root, "source", skillName);
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "SKILL.md"), source);
  return { path, hash: await hashDirectory(path) };
}

test("install locks reject unsupported legacy, unknown, and malformed skill hashes", async (t) => {
  const variants = [
    { label: "legacy", hash: `sha256:${"0".repeat(64)}` },
    { label: "unknown", hash: `sha256-directory-v99:${"0".repeat(64)}` },
    { label: "malformed", hash: "sha256:not-a-digest" },
  ];
  for (const variant of variants) {
    await t.test(variant.label, async (t) => {
      const root = await mkdtemp(join(tmpdir(), `sdd-lock-${variant.label}-`));
      t.after(() => rm(root, { recursive: true, force: true }));
      await mkdir(join(root, ".sdd"));
      await writeFile(join(root, ".sdd", "install-lock.json"), `${JSON.stringify({
        managedSkills: { "sdd-example": variant.hash },
      }, null, 2)}\n`);
      await assert.rejects(
        readInstallLock(root),
        (error) => error.code === "INVALID_INSTALL_LOCK",
      );
    });
  }
  assert.throws(
    () => serializeManagedInstallationLock({
      lock: { managedSkills: { "sdd-example": `sha256:${"0".repeat(64)}` } },
    }),
    (error) => error.code === "INVALID_INSTALL_LOCK",
  );
});

test("directory hashes distinguish framing collisions and include modes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-directory-hash-"));
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
    for (const name of (await readdir(directory)).sort()) {
      hash.update(`file\0${name}\0`);
      hash.update(await readFile(join(directory, name)));
      hash.update("\0");
    }
    return hash.digest("hex");
  };
  assert.equal(await releasedHash(single), await releasedHash(split));
  assert.notEqual(await hashDirectory(single), await hashDirectory(split));

  await rm(split, { recursive: true });
  await mkdir(split);
  await writeFile(join(split, "a"), "x\0file\0b\0y");
  assert.equal(await hashDirectory(single), await hashDirectory(split));
  await chmod(join(split, "a"), 0o600);
  assert.notEqual(await hashDirectory(single), await hashDirectory(split));
});

test("config publication reports recovery path when displacement read fails", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-config-recovery-read-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, ".sdd", "config.yaml");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, "schema: sdd-v3\n", { mode: 0o640 });
  await chmod(target, 0o640);
  let recordedStagingPath;
  let failure;

  await assert.rejects(
    () => publishConfigFile(root, target, "schema: replacement\n", {
      afterDisplace: ({ temporary }) => {
        recordedStagingPath = temporary;
        throw Object.assign(new Error("injected displaced-config read failure"), { code: "EIO" });
      },
    }),
    (error) => {
      failure = error;
      return error.code === "MUTATION_RECOVERY_FAILED"
        && error.details.some((detail) => detail.includes("injected displaced-config read failure"))
        && error.details.some((detail) => detail.includes("Recovery path recorded before inspection failure:"))
        && error.details.some((detail) => detail.includes("retry"));
    },
  );

  assert.equal(failure.retainedPaths.length, 1);
  assert.deepEqual(failure.recordedRecoveryPaths, failure.retainedPaths);
  assert.deepEqual(failure.recordedResiduePaths, []);
  assert.equal(await pathExists(recordedStagingPath), false);
  assert.equal(await pathExists(target), false);
  assert.equal(await readFile(failure.retainedPaths[0], "utf8"), "schema: sdd-v3\n");
  assert.equal((await lstat(failure.retainedPaths[0])).mode & 0o777, 0o640);
});

test("managed file publication reports recovery path when displacement read fails", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-managed-recovery-read-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, ".sdd", "story-driven-development.md");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, "# Previous workflow\n", { mode: 0o640 });
  await chmod(target, 0o640);
  let recordedStagingPath;
  let failure;

  await assert.rejects(
    () => publishManagedFile(root, target, "# Packaged workflow\n", {
      label: "Managed workflow",
      afterDisplace: ({ temporary }) => {
        recordedStagingPath = temporary;
        throw Object.assign(new Error("injected displaced-managed-file read failure"), { code: "EIO" });
      },
    }),
    (error) => {
      failure = error;
      return error.code === "MUTATION_RECOVERY_FAILED"
        && error.details.some((detail) => detail.includes("injected displaced-managed-file read failure"))
        && error.details.some((detail) => detail.includes("Recovery path recorded before inspection failure:"))
        && error.details.some((detail) => detail.includes("retry"));
    },
  );

  assert.equal(failure.retainedPaths.length, 1);
  assert.deepEqual(failure.recordedRecoveryPaths, failure.retainedPaths);
  assert.deepEqual(failure.recordedResiduePaths, []);
  assert.equal(await pathExists(recordedStagingPath), false);
  assert.equal(await pathExists(target), false);
  assert.equal(await readFile(failure.retainedPaths[0], "utf8"), "# Previous workflow\n");
  assert.equal((await lstat(failure.retainedPaths[0])).mode & 0o777, 0o640);
});

test("config publication reports recorded recovery name after owner-parent movement", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-config-recovery-owner-move-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const targetParent = join(root, ".sdd");
  const movedParent = join(root, ".sdd-moved");
  const target = join(targetParent, "config.yaml");
  await mkdir(targetParent);
  await writeFile(target, "schema: sdd-v3\n", { mode: 0o640 });
  await chmod(target, 0o640);
  let recordedPath;
  let recordedStagingPath;
  let failure;

  await assert.rejects(
    () => publishConfigFile(root, target, "schema: replacement\n", {
      afterDisplace: async ({ recoveryPath, temporary }) => {
        recordedPath = recoveryPath;
        recordedStagingPath = temporary;
        await rename(targetParent, movedParent);
        await mkdir(targetParent);
      },
    }),
    (error) => {
      failure = error;
      return error.code === "MUTATION_RECOVERY_FAILED"
        && error.cause?.code === "CONCURRENT_CHANGE"
        && error.recordedRecoveryPaths?.includes(recordedPath)
        && error.recordedResiduePaths?.includes(recordedStagingPath)
        && error.details.some((detail) => detail.includes("same-user actor moved a staging file or owner ancestor concurrently"))
        && error.details.some((detail) => detail.includes("Staging path recorded before cleanup could be verified:"));
    },
  );

  const actualPath = join(movedParent, basename(recordedPath));
  const actualStagingPath = join(movedParent, basename(recordedStagingPath));
  const movedNames = (await readdir(movedParent)).sort();
  assert.deepEqual(movedNames, [basename(recordedPath), basename(recordedStagingPath)].sort());
  assert.deepEqual(
    movedNames.filter((name) => name.includes(".sdd-config-") && !name.includes("-recovery-")),
    failure.recordedResiduePaths.map((path) => basename(path)),
  );
  assert.equal(await pathExists(recordedPath), false);
  assert.equal(await pathExists(recordedStagingPath), false);
  assert.equal(await readFile(actualPath, "utf8"), "schema: sdd-v3\n");
  assert.equal((await lstat(actualPath)).mode & 0o777, 0o640);
  assert.equal(await readFile(actualStagingPath, "utf8"), "schema: replacement\n");
  assert.equal((await lstat(actualStagingPath)).mode & 0o777, 0o640);
});

test("managed file publication reports recorded recovery name after owner-parent movement", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-managed-recovery-owner-move-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const targetParent = join(root, ".sdd");
  const movedParent = join(root, ".sdd-moved");
  const target = join(targetParent, "story-driven-development.md");
  await mkdir(targetParent);
  await writeFile(target, "# Previous workflow\n", { mode: 0o640 });
  await chmod(target, 0o640);
  let recordedPath;
  let recordedStagingPath;
  let failure;

  await assert.rejects(
    () => publishManagedFile(root, target, "# Packaged workflow\n", {
      label: "Managed workflow",
      afterDisplace: async ({ recoveryPath, temporary }) => {
        recordedPath = recoveryPath;
        recordedStagingPath = temporary;
        await rename(targetParent, movedParent);
        await mkdir(targetParent);
      },
    }),
    (error) => {
      failure = error;
      return error.code === "MUTATION_RECOVERY_FAILED"
        && error.cause?.code === "CONCURRENT_CHANGE"
        && error.recordedRecoveryPaths?.includes(recordedPath)
        && error.recordedResiduePaths?.includes(recordedStagingPath)
        && error.details.some((detail) => detail.includes("same-user actor moved a staging file or owner ancestor concurrently"))
        && error.details.some((detail) => detail.includes("Staging path recorded before cleanup could be verified:"));
    },
  );

  const actualPath = join(movedParent, basename(recordedPath));
  const actualStagingPath = join(movedParent, basename(recordedStagingPath));
  const movedNames = (await readdir(movedParent)).sort();
  assert.deepEqual(movedNames, [basename(recordedPath), basename(recordedStagingPath)].sort());
  assert.deepEqual(
    movedNames.filter((name) => name.includes(".sdd-managed-") && !name.includes("-recovery-")),
    failure.recordedResiduePaths.map((path) => basename(path)),
  );
  assert.equal(await pathExists(recordedPath), false);
  assert.equal(await pathExists(recordedStagingPath), false);
  assert.equal(await readFile(actualPath, "utf8"), "# Previous workflow\n");
  assert.equal((await lstat(actualPath)).mode & 0o777, 0o640);
  assert.equal(await readFile(actualStagingPath, "utf8"), "# Packaged workflow\n");
  assert.equal((await lstat(actualStagingPath)).mode & 0o777, 0o640);
});

test("config publication reports staging movement during final cleanup", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-config-final-cleanup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, ".sdd", "config.yaml");
  const movedStagingPath = join(root, "moved-config-staging");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, "schema: sdd-v3\n", { mode: 0o640 });
  await chmod(target, 0o640);
  let recordedStagingPath;
  let failure;

  await assert.rejects(
    () => publishConfigFile(root, target, "schema: replacement\n", {
      afterPublish: async ({ temporary }) => {
        recordedStagingPath = temporary;
        await rename(temporary, movedStagingPath);
      },
    }),
    (error) => {
      failure = error;
      return error.code === "MUTATION_RECOVERY_FAILED"
        && error.recordedResiduePaths?.includes(recordedStagingPath)
        && error.details.some((detail) => detail.includes("Staging path recorded before cleanup could be verified:"));
    },
  );

  assert.deepEqual(failure.recordedRecoveryPaths, []);
  assert.equal(failure.retainedPaths.includes(recordedStagingPath), true);
  assert.equal(await pathExists(recordedStagingPath), false);
  assert.equal(await readFile(target, "utf8"), "schema: replacement\n");
  assert.equal((await lstat(target)).mode & 0o777, 0o640);
  assert.equal(await readFile(movedStagingPath, "utf8"), "schema: replacement\n");
  assert.equal((await lstat(movedStagingPath)).mode & 0o777, 0o640);
});

test("managed file publication reports staging movement during final cleanup", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-managed-final-cleanup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, ".sdd", "story-driven-development.md");
  const movedStagingPath = join(root, "moved-managed-staging");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, "# Previous workflow\n", { mode: 0o640 });
  await chmod(target, 0o640);
  let recordedStagingPath;
  let failure;

  await assert.rejects(
    () => publishManagedFile(root, target, "# Packaged workflow\n", {
      label: "Managed workflow",
      afterPublish: async ({ temporary }) => {
        recordedStagingPath = temporary;
        await rename(temporary, movedStagingPath);
      },
    }),
    (error) => {
      failure = error;
      return error.code === "MUTATION_RECOVERY_FAILED"
        && error.recordedResiduePaths?.includes(recordedStagingPath)
        && error.details.some((detail) => detail.includes("Staging path recorded before cleanup could be verified:"));
    },
  );

  assert.deepEqual(failure.recordedRecoveryPaths, []);
  assert.equal(failure.retainedPaths.includes(recordedStagingPath), true);
  assert.equal(await pathExists(recordedStagingPath), false);
  assert.equal(await readFile(target, "utf8"), "# Packaged workflow\n");
  assert.equal((await lstat(target)).mode & 0o777, 0o640);
  assert.equal(await readFile(movedStagingPath, "utf8"), "# Packaged workflow\n");
  assert.equal((await lstat(movedStagingPath)).mode & 0o777, 0o640);
});

test("config publication reports recovery movement during final cleanup", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-config-recovery-cleanup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, ".sdd", "config.yaml");
  const movedRecoveryPath = join(root, "moved-config-recovery");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, "schema: sdd-v3\n", { mode: 0o640 });
  await chmod(target, 0o640);
  let recordedRecoveryPath;
  let recordedStagingPath;
  let failure;

  await assert.rejects(
    () => publishConfigFile(root, target, "schema: replacement\n", {
      afterPublish: async ({ recoveryPath, temporary }) => {
        recordedRecoveryPath = recoveryPath;
        recordedStagingPath = temporary;
        await rename(recoveryPath, movedRecoveryPath);
      },
    }),
    (error) => {
      failure = error;
      return error.code === "MUTATION_RECOVERY_FAILED"
        && error.recordedRecoveryPaths?.includes(recordedRecoveryPath)
        && error.details.some((detail) => detail.includes("Recovery path recorded before inspection failure:"));
    },
  );

  assert.deepEqual(failure.recordedResiduePaths, []);
  assert.equal(await pathExists(recordedRecoveryPath), false);
  assert.equal(await pathExists(recordedStagingPath), false);
  assert.equal(await readFile(target, "utf8"), "schema: replacement\n");
  assert.equal((await lstat(target)).mode & 0o777, 0o640);
  assert.equal(await readFile(movedRecoveryPath, "utf8"), "schema: sdd-v3\n");
  assert.equal((await lstat(movedRecoveryPath)).mode & 0o777, 0o640);
});

test("managed file publication reports recovery movement during final cleanup", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-managed-recovery-cleanup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, ".sdd", "story-driven-development.md");
  const movedRecoveryPath = join(root, "moved-managed-recovery");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, "# Previous workflow\n", { mode: 0o640 });
  await chmod(target, 0o640);
  let recordedRecoveryPath;
  let recordedStagingPath;
  let failure;

  await assert.rejects(
    () => publishManagedFile(root, target, "# Packaged workflow\n", {
      label: "Managed workflow",
      afterPublish: async ({ recoveryPath, temporary }) => {
        recordedRecoveryPath = recoveryPath;
        recordedStagingPath = temporary;
        await rename(recoveryPath, movedRecoveryPath);
      },
    }),
    (error) => {
      failure = error;
      return error.code === "MUTATION_RECOVERY_FAILED"
        && error.recordedRecoveryPaths?.includes(recordedRecoveryPath)
        && error.details.some((detail) => detail.includes("Recovery path recorded before inspection failure:"));
    },
  );

  assert.deepEqual(failure.recordedResiduePaths, []);
  assert.equal(await pathExists(recordedRecoveryPath), false);
  assert.equal(await pathExists(recordedStagingPath), false);
  assert.equal(await readFile(target, "utf8"), "# Packaged workflow\n");
  assert.equal((await lstat(target)).mode & 0o777, 0o640);
  assert.equal(await readFile(movedRecoveryPath, "utf8"), "# Previous workflow\n");
  assert.equal((await lstat(movedRecoveryPath)).mode & 0o777, 0o640);
});

test("config publication combines retained recovery and unverified staging cleanup", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-config-combined-cleanup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, ".sdd", "config.yaml");
  const movedStagingPath = join(root, "moved-config-combined-staging");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, "schema: sdd-v3\n", { mode: 0o640 });
  await chmod(target, 0o640);
  let recordedRecoveryPath;
  let recordedStagingPath;
  let failure;

  await assert.rejects(
    () => publishConfigFile(root, target, "schema: replacement\n", {
      afterPublish: async ({ recoveryPath, temporary }) => {
        recordedRecoveryPath = recoveryPath;
        recordedStagingPath = temporary;
        await rename(temporary, movedStagingPath);
        await rm(recoveryPath);
        await writeFile(recoveryPath, "schema: concurrent-recovery\n", { mode: 0o600 });
      },
    }),
    (error) => {
      failure = error;
      return error.code === "MUTATION_RECOVERY_FAILED"
        && error.retainedPaths?.includes(recordedRecoveryPath)
        && error.recordedResiduePaths?.includes(recordedStagingPath)
        && error.details.some((detail) => detail.includes(`Retained path requiring inspection: ${recordedRecoveryPath}`))
        && error.details.some((detail) => detail.includes(`Staging path recorded before cleanup could be verified: ${recordedStagingPath}`));
    },
  );

  assert.deepEqual(failure.recordedRecoveryPaths, []);
  assert.equal(await pathExists(recordedStagingPath), false);
  assert.equal(await readFile(target, "utf8"), "schema: replacement\n");
  assert.equal((await lstat(target)).mode & 0o777, 0o640);
  assert.equal(await readFile(recordedRecoveryPath, "utf8"), "schema: concurrent-recovery\n");
  assert.equal((await lstat(recordedRecoveryPath)).mode & 0o777, 0o600);
  assert.equal(await readFile(movedStagingPath, "utf8"), "schema: replacement\n");
  assert.equal((await lstat(movedStagingPath)).mode & 0o777, 0o640);
});

test("managed skill refresh preserves completed work and reports residual actions without rollback", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-skill-partial-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".sdd"));
  const skillsDirectory = join(root, ".agents", "skills");
  const actions = [];
  for (const skillName of ["sdd-first", "sdd-second", "sdd-third"]) {
    const source = await createSkill(root, skillName, `${skillName} packaged\n`);
    actions.push({
      skillName,
      action: "install",
      source: source.path,
      target: join(skillsDirectory, skillName),
      sourceHash: source.hash,
      targetHash: null,
    });
  }
  const skillPlan = {
    skillsDirectory,
    actions,
    lock: {
      version: 3,
      packageVersion: "test",
      schemaVersion: "sdd-v3",
      skillsDirectory: ".agents/skills",
      managedSkills: Object.fromEntries(actions.map((entry) => [entry.skillName, entry.sourceHash])),
    },
  };
  const secondTarget = actions[1].target;
  await assert.rejects(
    () => applyManagedInstallation(root, {
      skillPlan,
      skillOptions: {
        beforeSkillPublication: ({ phase, path }) => {
          if (phase === "publish-root" && path === secondTarget) {
            throw new Error("injected second skill failure");
          }
        },
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes("Completed managed skill preserved: sdd-first"))
      && error.details.some((detail) => detail.includes("Failed managed skill: sdd-second"))
      && error.details.some((detail) => detail.includes("Residual managed skill action: sdd-third"))
      && error.details.some((detail) => detail.includes("Installation evidence was not advanced")),
  );

  assert.equal(await readFile(join(actions[0].target, "SKILL.md"), "utf8"), "sdd-first packaged\n");
  assert.equal(await pathExists(actions[1].target), false);
  assert.equal(await pathExists(actions[2].target), false);
  assert.equal(await pathExists(join(root, ".sdd", "install-lock.json")), false);

  skillPlan.actions[0] = {
    ...skillPlan.actions[0],
    action: "adopt",
    targetHash: actions[0].sourceHash,
  };
  await applyManagedInstallation(root, { skillPlan });
  assert.deepEqual(
    (await readInstallLock(root)).managedSkills,
    skillPlan.lock.managedSkills,
  );
});

test("skill replacement preserves a newer target as named residual state", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-skill-newer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = await createSkill(root, "sdd-example", "packaged skill\n");
  const skillsDirectory = join(root, "skills");
  const target = join(skillsDirectory, "sdd-example");
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "SKILL.md"), "previous skill\n");
  const targetHash = await hashDirectory(target);
  let retained;

  await assert.rejects(
    () => applySkillSync(root, {
      skillsDirectory,
      actions: [{
        skillName: "sdd-example",
        action: "update",
        source: source.path,
        target,
        sourceHash: source.hash,
        targetHash,
      }],
    }, {
      beforeSkillPublication: async ({ phase }) => {
        if (phase === "preserve-target") {
          await writeFile(join(target, "SKILL.md"), "concurrent skill\n");
        }
      },
    }),
    (error) => {
      retained = error.retainedPaths.find((path) => path.includes("sdd-preserved"));
      return error.code === "MUTATION_RECOVERY_FAILED" && typeof retained === "string";
    },
  );
  assert.equal(await readFile(join(retained, "SKILL.md"), "utf8"), "concurrent skill\n");
});

test("managed skill publication preserves nested modes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-skill-modes-"));
  const source = await createSkill(root, "sdd-example", "packaged skill\n");
  const nested = join(source.path, "assets");
  await mkdir(nested, { mode: 0o700 });
  await writeFile(join(nested, "reference.md"), "reference\n", { mode: 0o400 });
  await chmod(nested, 0o500);
  source.hash = await hashDirectory(source.path);
  const target = join(root, "skills", "sdd-example");
  t.after(async () => {
    await chmod(nested, 0o700).catch(() => {});
    await chmod(join(target, "assets"), 0o700).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  await applySkillSync(root, {
    skillsDirectory: join(root, "skills"),
    actions: [{
      skillName: "sdd-example",
      action: "install",
      source: source.path,
      target,
      sourceHash: source.hash,
      targetHash: null,
    }],
  });
  assert.equal(await hashDirectory(target), source.hash);
  assert.equal((await stat(join(target, "assets"))).mode & 0o777, 0o500);
  assert.equal((await stat(join(target, "assets", "reference.md"))).mode & 0o777, 0o400);
});

test("managed skill registry staging rejects an external symlink replacement", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-skill-registry-"));
  const external = await mkdtemp(join(tmpdir(), "sdd-skill-registry-external-"));
  const displaced = join(root, ".agents.displaced");
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  });
  const source = await createSkill(root, "sdd-example", "packaged skill\n");
  await mkdir(join(root, ".agents"));
  await assert.rejects(
    () => applySkillSync(root, {
      skillsDirectory: join(root, ".agents", "skills"),
      actions: [{
        skillName: "sdd-example",
        action: "install",
        source: source.path,
        target: join(root, ".agents", "skills", "sdd-example"),
        sourceHash: source.hash,
        targetHash: null,
      }],
    }, {
      beforeSkillPublication: async ({ phase }) => {
        if (phase !== "registry") return;
        await rename(join(root, ".agents"), displaced);
        await symlink(external, join(root, ".agents"), "dir");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes("Residual managed skill action")),
  );
  assert.deepEqual(await readdir(external), []);
});

test("managed writer rejects a selected workspace replacement before lock-directory creation", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-lock-owner-"));
  const external = await mkdtemp(join(tmpdir(), "sdd-lock-owner-external-"));
  const displaced = `${root}-displaced`;
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(displaced, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  });
  await assert.rejects(
    () => withWorkspaceMutationLock(root, async () => {}, {
      beforeLockDirectoryCreate: async () => {
        await rename(root, displaced);
        await symlink(external, root, "dir");
      },
    }),
    (error) => error.code === "UNSAFE_CONFIG_PATH",
  );
  assert.deepEqual(await readdir(external), []);
});

test("fixed SDD mutation paths reject a symlinked config directory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-fixed-path-owner-"));
  const external = await mkdtemp(join(tmpdir(), "sdd-fixed-path-external-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(external, { recursive: true, force: true }));
  await symlink(external, join(root, ".sdd"), "dir");
  await assert.rejects(
    () => setupInstallation(root, {
      planningRoot: "ideas",
      repositoryRoots: ["repos"],
      skillsDirectory: ".agents/skills",
    }),
    (error) => error.code === "UNSAFE_CONFIG_PATH",
  );
  assert.deepEqual(await readdir(external), []);
});

test("setup rejects a selected workspace root replacement before managed writes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-workspace-owner-"));
  const external = await mkdtemp(join(tmpdir(), "sdd-workspace-owner-external-"));
  const displaced = `${root}-displaced`;
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(displaced, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  });
  await assert.rejects(
    () => setupInstallation(root, {
      planningRoot: "ideas",
      repositoryRoots: ["repos"],
      skillsDirectory: ".agents/skills",
      beforeSetupDirectoryMutation: async () => {
        await rename(root, displaced);
        await symlink(external, root, "dir");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes("Selected workspace authority changed")),
  );
  assert.deepEqual(await readdir(external), []);
  assert.equal(await pathExists(join(displaced, ".sdd", "config.yaml")), true);
  assert.equal(await pathExists(join(displaced, ".sdd", "changes")), false);
});

test("managed skill staging rejects a selected workspace root replacement", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-skill-owner-"));
  const external = await mkdtemp(join(tmpdir(), "sdd-skill-owner-external-"));
  const displaced = `${root}-displaced`;
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(displaced, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  });
  const source = await createSkill(root, "sdd-example", "packaged skill\n");
  const target = join(root, ".agents", "skills", "sdd-example");
  const selected = await stat(root, { bigint: true });
  let replaced = false;
  const assertOwnerCurrent = async () => {
    const current = await stat(root, { bigint: true });
    if (current.dev !== selected.dev || current.ino !== selected.ino) {
      throw new Error("selected workspace owner changed");
    }
  };
  await assert.rejects(
    () => applySkillSync(root, {
      skillsDirectory: join(root, ".agents", "skills"),
      actions: [{
        skillName: "sdd-example",
        action: "install",
        source: source.path,
        target,
        sourceHash: source.hash,
        targetHash: null,
      }],
    }, {
      assertOwnerCurrent,
      beforeSkillPublication: async () => {
        if (replaced) return;
        replaced = true;
        await rename(root, displaced);
        await symlink(external, root, "dir");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED",
  );
  assert.deepEqual(await readdir(external), []);
});

test("managed setup and update serialize one current writer", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-current-writer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let entered = false;
  const owner = withWorkspaceMutationLock(root, async () => {
    entered = true;
    await held;
  });
  while (!entered) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(typeof JSON.parse(await readFile(mutationLockPath(root), "utf8")).token, "string");
  await assert.rejects(
    () => withWorkspaceMutationLock(root, async () => {}),
    (error) => error.code === "OPERATION_IN_PROGRESS",
  );
  release();
  await owner;
  assert.equal(await pathExists(mutationLockPath(root)), false);
});

test("managed writer release preserves a replacement lock", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-current-writer-release-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const displaced = join(root, "owned-mutation.lock");
  const replacement = `${JSON.stringify({
    pid: process.pid,
    token: "replacement",
    createdAt: new Date().toISOString(),
  })}\n`;
  await assert.rejects(
    () => withWorkspaceMutationLock(root, async () => {}, {
      beforeLockRelease: async ({ lockPath }) => {
        await rename(lockPath, displaced);
        await writeFile(lockPath, replacement, { mode: 0o600 });
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED",
  );
  assert.equal(await readFile(mutationLockPath(root), "utf8"), replacement);
  assert.equal((await lstat(displaced)).isFile(), true);
});

test("managed-file staging rejects a selected workspace root replacement", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-managed-file-owner-"));
  const external = await mkdtemp(join(tmpdir(), "sdd-managed-file-owner-external-"));
  const displaced = `${root}-displaced`;
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(displaced, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  });
  const target = join(root, "managed", "workflow.md");
  await mkdir(dirname(target), { recursive: true });
  const selected = await stat(root, { bigint: true });
  const assertOwnerCurrent = async () => {
    const current = await stat(root, { bigint: true });
    if (current.dev !== selected.dev || current.ino !== selected.ino) {
      throw new Error("selected workspace owner changed");
    }
  };
  await assert.rejects(
    () => publishManagedFile(root, target, "packaged workflow\n", {
      expected: null,
      assertOwnerCurrent,
      beforeStage: async () => {
        await rename(root, displaced);
        await symlink(external, root, "dir");
      },
    }),
    /selected workspace owner changed/,
  );
  assert.deepEqual(await readdir(external), []);
});

test("workflow refresh preserves a concurrent complete replacement", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-workflow-conflict-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source.md");
  const target = join(root, "target.md");
  await writeFile(source, "packaged workflow\n");
  await writeFile(target, "previous workflow\n");
  const plan = {
    workspaceRoot: root,
    action: "update",
    source,
    target,
    sourceHash: await hashFile(source),
    targetHash: await hashFile(target),
  };
  await assert.rejects(
    () => applyWorkflowSync(plan, {
      publishFile: async (...args) => {
        await writeFile(target, "concurrent workflow\n");
        return publishManagedFile(...args);
      },
    }),
    (error) => error.code === "WORKFLOW_CONFLICT",
  );
  assert.equal(await readFile(target, "utf8"), "concurrent workflow\n");
});

test("workflow refresh writes one complete file and preserves its mode", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-workflow-complete-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source.md");
  const target = join(root, "target.md");
  const packaged = `# Packaged workflow\n\n${"complete line\n".repeat(500)}`;
  await writeFile(source, packaged);
  await writeFile(target, "previous workflow\n", { mode: 0o640 });
  await chmod(target, 0o640);
  await applyWorkflowSync({
    workspaceRoot: root,
    action: "update",
    source,
    target,
    sourceHash: await hashFile(source),
    targetHash: await hashFile(target),
  });
  assert.equal(await readFile(target, "utf8"), packaged);
  assert.equal((await stat(target)).mode & 0o777, 0o640);
});

test("workflow refresh reports packaged partial state without rolling back", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-workflow-partial-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source.md");
  const target = join(root, "target.md");
  await writeFile(source, "packaged workflow\n");
  await writeFile(target, "previous workflow\n");
  const plan = {
    workspaceRoot: root,
    action: "update",
    source,
    target,
    sourceHash: await hashFile(source),
    targetHash: await hashFile(target),
  };
  await assert.rejects(
    () => applyWorkflowSync(plan, {
      publishFile: async (...args) => {
        await publishManagedFile(...args);
        throw new Error("injected post-publication failure");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes("contains the packaged version")),
  );
  assert.equal(await readFile(target, "utf8"), "packaged workflow\n");
});

test("managed installation preserves completed skills and prior evidence on lock failure", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-managed-partial-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workflowSource = join(root, "workflow-source.md");
  const workflowTarget = join(root, "managed", "workflow.md");
  const skill = await createSkill(root, "sdd-example", "new skill\n");
  const skillTarget = join(root, "managed", "skills", "sdd-example");
  const lockPath = join(root, ".sdd", "install-lock.json");
  await mkdir(join(root, ".sdd"), { recursive: true });
  await mkdir(dirname(workflowTarget), { recursive: true });
  await mkdir(skillTarget, { recursive: true });
  await writeFile(workflowSource, "new workflow\n");
  await writeFile(workflowTarget, "old workflow\n");
  await writeFile(join(skillTarget, "SKILL.md"), "old skill\n");
  const priorLock = {
    managedSkills: { "sdd-example": await hashDirectory(skillTarget) },
    managedWorkflow: { path: "managed/workflow.md", hash: await hashFile(workflowTarget) },
  };
  await writeFile(lockPath, `${JSON.stringify(priorLock, null, 2)}\n`);
  await assert.rejects(
    async () => applyManagedInstallation(root, {
      workflowPlan: {
        workspaceRoot: root,
        action: "update",
        source: workflowSource,
        target: workflowTarget,
        sourceHash: await hashFile(workflowSource),
        targetHash: await hashFile(workflowTarget),
        lock: { path: "managed/workflow.md", hash: await hashFile(workflowSource) },
      },
      skillPlan: {
        skillsDirectory: join(root, "managed", "skills"),
        actions: [{
          skillName: "sdd-example",
          action: "update",
          source: skill.path,
          target: skillTarget,
          sourceHash: skill.hash,
          targetHash: await hashDirectory(skillTarget),
        }],
        lock: { managedSkills: { "sdd-example": skill.hash } },
      },
      writeLock: async () => { throw new Error("injected evidence failure"); },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes("Preserved managed workflow at packaged content"))
      && error.details.some((detail) => detail.includes("Completed managed skill changes were preserved")),
  );
  assert.equal(await readFile(workflowTarget, "utf8"), "new workflow\n");
  assert.equal(await readFile(join(skillTarget, "SKILL.md"), "utf8"), "new skill\n");
  assert.deepEqual(JSON.parse(await readFile(lockPath, "utf8")), priorLock);
});

test("managed installation preserves a concurrent complete installation-evidence winner", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-install-evidence-winner-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lockPath = join(root, ".sdd", "install-lock.json");
  await mkdir(join(root, ".sdd"), { recursive: true });
  const priorLock = { managedSkills: {} };
  const winner = {
    managedSkills: {},
    managedWorkflow: { path: ".sdd/story-driven-development.md", hash: `sha256:${"a".repeat(64)}` },
  };
  await writeFile(lockPath, `${JSON.stringify(priorLock, null, 2)}\n`);
  await assert.rejects(
    () => applyManagedInstallation(root, {
      skillPlan: { skillsDirectory: join(root, ".agents", "skills"), actions: [], lock: priorLock },
      writeLock: async (path, source, options) => {
        await writeFile(path, `${JSON.stringify(winner, null, 2)}\n`);
        return publishManagedFile(root, path, source, { ...options, label: "Installation evidence" });
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes("previous complete lock preserved")),
  );
  assert.deepEqual(JSON.parse(await readFile(lockPath, "utf8")), winner);
});

test("managed installation preserves a workflow replacement at the final success boundary", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-final-workflow-winner-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workflowSource = join(root, "workflow-source.md");
  const workflowTarget = join(root, ".sdd", "story-driven-development.md");
  const lockPath = join(root, ".sdd", "install-lock.json");
  const displacedWorkflow = join(root, "published-workflow.md");
  await mkdir(join(root, ".sdd"), { recursive: true });
  await writeFile(workflowSource, "packaged workflow\n");
  await writeFile(workflowTarget, "previous workflow\n");
  const previousHash = await hashFile(workflowTarget);
  await writeFile(lockPath, `${JSON.stringify({
    managedSkills: {},
    managedWorkflow: { path: ".sdd/story-driven-development.md", hash: previousHash },
  }, null, 2)}\n`);
  const sourceHash = await hashFile(workflowSource);
  await assert.rejects(
    () => applyManagedInstallation(root, {
      workflowPlan: {
        workspaceRoot: root,
        action: "update",
        source: workflowSource,
        target: workflowTarget,
        sourceHash,
        targetHash: previousHash,
        lock: { path: ".sdd/story-driven-development.md", hash: sourceHash },
      },
      skillPlan: { skillsDirectory: join(root, ".agents", "skills"), actions: [], lock: { managedSkills: {} } },
      beforeSuccess: async () => {
        await rename(workflowTarget, displacedWorkflow);
        await writeFile(workflowTarget, "concurrent workflow winner\n");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes("other complete content")),
  );
  assert.equal(await readFile(workflowTarget, "utf8"), "concurrent workflow winner\n");
  assert.equal(await readFile(displacedWorkflow, "utf8"), "packaged workflow\n");
  assert.equal(typeof JSON.parse(await readFile(lockPath, "utf8")).managedWorkflow.hash, "string");
});

test("managed installation preserves an installation-evidence replacement at the final success boundary", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-final-lock-winner-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lockPath = join(root, ".sdd", "install-lock.json");
  const displacedLock = join(root, "published-install-lock.json");
  await mkdir(join(root, ".sdd"), { recursive: true });
  await writeFile(lockPath, `${JSON.stringify({ managedSkills: {} }, null, 2)}\n`);
  const winner = {
    managedSkills: {},
    managedWorkflow: { path: ".sdd/story-driven-development.md", hash: `sha256:${"b".repeat(64)}` },
  };
  await assert.rejects(
    () => applyManagedInstallation(root, {
      skillPlan: { skillsDirectory: join(root, ".agents", "skills"), actions: [], lock: { managedSkills: {} } },
      beforeSuccess: async () => {
        await rename(lockPath, displacedLock);
        await writeFile(lockPath, `${JSON.stringify(winner, null, 2)}\n`);
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes("other complete lock preserved")),
  );
  assert.deepEqual(JSON.parse(await readFile(lockPath, "utf8")), winner);
  assert.deepEqual(JSON.parse(await readFile(displacedLock, "utf8")), { managedSkills: {} });
});

test("first setup preserves complete config and reports bounded retry state", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-setup-partial-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = join(root, ".sdd", "config.yaml");
  await assert.rejects(
    () => setupInstallation(root, {
      planningRoot: "ideas",
      repositoryRoots: ["repos"],
      skillsDirectory: ".agents/skills",
      writeLock: async () => { throw new Error("injected setup evidence failure"); },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.includes(`Preserved workspace configuration: ${configPath}`),
  );
  assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v3");
  assert.equal(
    await readFile(join(root, ".sdd", "story-driven-development.md"), "utf8"),
    await readFile(WORKFLOW_SOURCE_PATH, "utf8"),
  );
  assert.equal(await pathExists(join(root, ".sdd", "install-lock.json")), false);
});
