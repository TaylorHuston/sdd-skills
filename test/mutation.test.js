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

import { readWorkspaceConfig } from "../src/config.js";
import { setupInstallation } from "../src/commands/init-installation.js";
import { WORKFLOW_SOURCE_PATH } from "../src/constants.js";
import {
  hashDirectory,
  hashFile,
  pathExists,
  readBoundDirectory,
  readBoundRegularFile,
  removeBoundDirectory,
  replaceDirectoryAtomically,
} from "../src/fs.js";
import {
  applyManagedInstallation,
  serializeManagedInstallationLock,
} from "../src/installation.js";
import { publishManagedFile } from "../src/managed-file-publication.js";
import { withWorkspaceMutationLock } from "../src/mutation.js";
import {
  applySkillSync,
  planSkillSync,
  readInstallLock,
} from "../src/skills.js";
import { applyWorkflowSync, planWorkflowSync } from "../src/workflow.js";

function mutationLockPath(root) {
  return join(root, ".sdd", "mutation.lock");
}

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
    (error) => error.code === "UNSAFE_CONFIG_PATH"
      && error.message.includes("Selected workspace authority changed"),
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
  const source = join(root, "source", "sdd-example");
  const target = join(root, ".agents", "skills", "sdd-example");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "SKILL.md"), "packaged skill\n");
  const sourceHash = await hashDirectory(source);
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
        source,
        target,
        sourceHash,
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
  let entered;
  const owner = withWorkspaceMutationLock(root, async () => {
    entered = true;
    await held;
  });
  while (!entered) await new Promise((resolve) => setTimeout(resolve, 5));

  const source = await readFile(mutationLockPath(root), "utf8");
  assert.equal(typeof JSON.parse(source).token, "string");
  await assert.rejects(
    () => withWorkspaceMutationLock(root, async () => {}),
    (error) => error.code === "OPERATION_IN_PROGRESS"
      && error.details.some((detail) => detail.includes("remove the retained lock manually")),
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
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.message.includes("replacement mutation lock")
      && error.retainedPaths.includes(mutationLockPath(root)),
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
    (error) => error.code === "WORKFLOW_CONFLICT"
      && error.details.some((detail) => detail.includes("Inspect the preserved workflow")),
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
      && error.details.some((detail) => detail.includes("contains the packaged version"))
      && error.details.some((detail) => detail.includes("Retry the same setup or update command")),
  );
  assert.equal(await readFile(target, "utf8"), "packaged workflow\n");
});

test("managed installation preserves refreshed workflow and parseable prior evidence on lock failure", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-managed-partial-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workflowSource = join(root, "workflow-source.md");
  const workflowTarget = join(root, "managed", "workflow.md");
  const skillSource = join(root, "skill-source");
  const skillTarget = join(root, "managed", "skills", "sdd-example");
  const lockPath = join(root, ".sdd", "install-lock.json");
  await mkdir(join(root, ".sdd"), { recursive: true });
  await mkdir(join(workflowTarget, ".."), { recursive: true });
  await mkdir(skillSource, { recursive: true });
  await mkdir(skillTarget, { recursive: true });
  await writeFile(workflowSource, "new workflow\n");
  await writeFile(workflowTarget, "old workflow\n");
  await writeFile(join(skillSource, "SKILL.md"), "new skill\n");
  await writeFile(join(skillTarget, "SKILL.md"), "old skill\n");
  const priorLock = {
    managedSkills: { "sdd-example": await hashDirectory(skillTarget) },
    managedWorkflow: { path: "managed/workflow.md", hash: await hashFile(workflowTarget) },
  };
  await writeFile(lockPath, `${JSON.stringify(priorLock, null, 2)}\n`);
  const workflowHash = await hashFile(workflowSource);
  const workflowTargetHash = await hashFile(workflowTarget);
  const skillHash = await hashDirectory(skillSource);
  const skillTargetHash = await hashDirectory(skillTarget);

  await assert.rejects(
    () => applyManagedInstallation(root, {
      workflowPlan: {
        workspaceRoot: root,
        action: "update",
        source: workflowSource,
        target: workflowTarget,
        sourceHash: workflowHash,
        targetHash: workflowTargetHash,
        lock: { path: "managed/workflow.md", hash: workflowHash },
      },
      skillPlan: {
        skillsDirectory: join(root, "managed", "skills"),
        actions: [{
          skillName: "sdd-example",
          action: "update",
          source: skillSource,
          target: skillTarget,
          sourceHash: skillHash,
          targetHash: skillTargetHash,
        }],
        lock: { managedSkills: { "sdd-example": skillHash } },
      },
      writeLock: async () => { throw new Error("injected evidence failure"); },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes("Preserved managed workflow at packaged content"))
      && error.details.some((detail) => detail.includes("pre-refresh state")),
  );

  assert.equal(await readFile(workflowTarget, "utf8"), "new workflow\n");
  assert.equal(await readFile(join(skillTarget, "SKILL.md"), "utf8"), "old skill\n");
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
    managedWorkflow: {
      path: ".sdd/story-driven-development.md",
      hash: `sha256:${"a".repeat(64)}`,
    },
  };
  await writeFile(lockPath, `${JSON.stringify(priorLock, null, 2)}\n`);

  await assert.rejects(
    () => applyManagedInstallation(root, {
      skillPlan: {
        skillsDirectory: join(root, ".agents", "skills"),
        actions: [],
        lock: { managedSkills: {} },
      },
      writeLock: async (path, source, options) => {
        await writeFile(path, `${JSON.stringify(winner, null, 2)}\n`);
        return publishManagedFile(root, path, source, {
          ...options,
          label: "Installation evidence",
        });
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes("Original detail: Preserved path"))
      && error.details.some((detail) => detail.includes("previous complete lock preserved"))
      && error.details.some((detail) => detail.includes("Retry the same setup or update command")),
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
      skillPlan: {
        skillsDirectory: join(root, ".agents", "skills"),
        actions: [],
        lock: { managedSkills: {} },
      },
      beforeSuccess: async () => {
        await rename(workflowTarget, displacedWorkflow);
        await writeFile(workflowTarget, "concurrent workflow winner\n");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes("requested complete lock published"))
      && error.details.some((detail) => detail.includes(
        "Preserved managed workflow with other complete content",
      ))
      && !error.details.some((detail) => detail.includes(
        "Preserved managed workflow at packaged content",
      )),
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
    managedWorkflow: {
      path: ".sdd/story-driven-development.md",
      hash: `sha256:${"b".repeat(64)}`,
    },
  };

  await assert.rejects(
    () => applyManagedInstallation(root, {
      skillPlan: {
        skillsDirectory: join(root, ".agents", "skills"),
        actions: [],
        lock: { managedSkills: {} },
      },
      beforeSuccess: async () => {
        await rename(lockPath, displacedLock);
        await writeFile(lockPath, `${JSON.stringify(winner, null, 2)}\n`);
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes("other complete lock preserved"))
      && error.details.some((detail) => detail.includes("Retry the same setup or update command")),
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
      && error.details.includes(`Preserved workspace configuration: ${configPath}`)
      && error.details.some((detail) => detail.includes("Retry the same setup command")),
  );

  assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v3");
  assert.equal(
    await readFile(join(root, ".sdd", "story-driven-development.md"), "utf8"),
    await readFile(WORKFLOW_SOURCE_PATH, "utf8"),
  );
  assert.equal(await pathExists(join(root, ".sdd", "install-lock.json")), false);
});
