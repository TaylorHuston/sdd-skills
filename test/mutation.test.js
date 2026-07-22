import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeConfig } from "../src/config.js";
import { setupInstallation } from "../src/commands/init-installation.js";
import { initWorkspace } from "../src/commands/init.js";
import {
  hashDirectory,
  hashFile,
  pathExists,
  replaceDirectoryAtomically,
  replaceFileAtomically,
  writeFileAtomically,
  writeJson,
} from "../src/fs.js";
import { applyManagedInstallation } from "../src/installation.js";
import { withWorkspaceMutationLock } from "../src/mutation.js";
import { applySkillSync } from "../src/skills.js";
import { applyWorkflowSync, planWorkflowSync } from "../src/workflow.js";

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
  const lockPath = join(root, ".sdd", "mutation.lock");
  await mkdir(join(root, ".sdd"), { recursive: true });
  await writeFile(lockPath, `${JSON.stringify({ pid: 99_999_999, createdAt: "2026-01-01T00:00:00.000Z" })}\n`);

  const result = await withWorkspaceMutationLock(root, async () => "completed");

  assert.equal(result, "completed");
  assert.equal(await pathExists(lockPath), false);
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
    () => writeConfig(root, { version: 1 }),
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

test("mutation lock cleans up a failed acquisition write", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-lock-acquire-fail-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lockPath = join(root, ".sdd", "mutation.lock");

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

test("mutation lock preserves a replacement owned by another operation", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-lock-replaced-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lockPath = join(root, ".sdd", "mutation.lock");
  const replacement = `${JSON.stringify({ pid: process.pid, token: "replacement" })}\n`;

  await withWorkspaceMutationLock(root, async () => {
    await writeFile(lockPath, replacement);
  });

  assert.equal(await readFile(lockPath, "utf8"), replacement);
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

test("managed installation refuses adopt drift before committing its lock", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-adopt-drift-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source", "sdd-example");
  const target = join(root, "skills", "sdd-example");
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

  await assert.rejects(
    () => applyManagedInstallation(root, {
      skillPlan: plan,
      beforeLockCommit: () => writeFile(join(target, "SKILL.md"), "concurrent edit\n"),
    }),
    (error) => error.code === "SKILL_CONFLICT",
  );
  assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "concurrent edit\n");
  assert.equal(await pathExists(join(root, ".sdd", "install-lock.json")), false);
});

test("managed installation refuses workflow adopt drift before committing its lock", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-workflow-adopt-drift-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "workflow-source.md");
  const target = join(root, "workflow-target.md");
  await writeFile(source, "matching workflow\n");
  await writeFile(target, "matching workflow\n");
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
      beforeLockCommit: () => writeFile(target, "concurrent workflow edit\n"),
    }),
    (error) => error.code === "WORKFLOW_CONFLICT",
  );
  assert.equal(await readFile(target, "utf8"), "concurrent workflow edit\n");
  assert.equal(await pathExists(join(root, ".sdd", "install-lock.json")), false);
});

test("first-time setup removes its new config when managed installation fails", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-setup-rollback-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousHome = process.env.SDD_USER_HOME;
  process.env.SDD_USER_HOME = root;
  t.after(() => {
    if (previousHome === undefined) delete process.env.SDD_USER_HOME;
    else process.env.SDD_USER_HOME = previousHome;
  });

  await assert.rejects(
    () => setupInstallation({
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
    (error) => error.code === "MUTATION_RECOVERY_FAILED",
  );
  assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "concurrent skill\n");
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

test("first-time setup does not follow a dangling gitignore symlink", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-setup-ignore-symlink-"));
  const external = await mkdtemp(join(tmpdir(), "sdd-ignore-external-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(external, { recursive: true, force: true }));
  await mkdir(join(root, ".sdd"), { recursive: true });
  const externalTarget = join(external, "created-by-symlink");
  await symlink(externalTarget, join(root, ".sdd", ".gitignore"));
  const previousHome = process.env.SDD_USER_HOME;
  process.env.SDD_USER_HOME = root;
  t.after(() => {
    if (previousHome === undefined) delete process.env.SDD_USER_HOME;
    else process.env.SDD_USER_HOME = previousHome;
  });

  await assert.rejects(
    () => setupInstallation({
      planningRoot: "ideas",
      repositoryRoots: ["repos"],
      skillsDirectory: "skills",
      writeLock: async () => { throw new Error("injected setup failure"); },
    }),
    /injected setup failure/,
  );
  assert.equal(await pathExists(externalTarget), false);
});

test("first-time legacy init removes new durable state when installation fails", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-init-rollback-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "ideas"), { recursive: true });
  await mkdir(join(root, "code"), { recursive: true });

  await assert.rejects(
    () => initWorkspace(root, {
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

test("failed installation after v1 migration restores the original config", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-migration-rollback-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "ideas"));
  await mkdir(join(root, "code"));
  await writeConfig(root, {
    version: 1,
    schema: "sdd-v1",
    skills: { directory: ".agents/skills" },
    planning: { root: "ideas", plannedChangesDirectory: "planned-changes" },
    repositories: { roots: ["code"] },
    repositoryArtifacts: {
      activeChanges: "docs/changes",
      closedChanges: "docs/changes/closed",
      epics: "docs/epics",
      adrs: "docs/adrs",
      audits: "docs/audits",
    },
    ideas: {},
  });
  const configPath = join(root, ".sdd", "config.yaml");
  const originalConfig = await readFile(configPath, "utf8");

  await assert.rejects(
    () => initWorkspace(root, {
      writeLock: async () => { throw new Error("injected migration lock failure"); },
    }),
    /injected migration lock failure/,
  );

  assert.equal(await readFile(configPath, "utf8"), originalConfig);
  assert.equal(await pathExists(join(root, ".sdd", "install-lock.json")), false);
});

test("failed v1 config restoration reports incomplete recovery", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-migration-recovery-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "ideas"));
  await mkdir(join(root, "code"));
  await writeConfig(root, {
    version: 1,
    schema: "sdd-v1",
    skills: { directory: ".agents/skills" },
    planning: { root: "ideas", plannedChangesDirectory: "planned-changes" },
    repositories: { roots: ["code"] },
    repositoryArtifacts: {
      activeChanges: "docs/changes",
      closedChanges: "docs/changes/closed",
      epics: "docs/epics",
      adrs: "docs/adrs",
      audits: "docs/audits",
    },
    ideas: {},
  });
  const configPath = join(root, ".sdd", "config.yaml");

  await assert.rejects(
    () => initWorkspace(root, {
      writeLock: async () => { throw new Error("injected installation failure"); },
      restoreConfig: async () => { throw new Error("injected restoration failure"); },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail === `Retained migrated configuration: ${configPath}`)
      && error.details.some((detail) => detail.includes("injected restoration failure")),
  );

  assert.match(await readFile(configPath, "utf8"), /^version: 2$/m);
});
