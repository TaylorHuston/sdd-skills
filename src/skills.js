import { cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { BUNDLED_SKILLS_DIRECTORY, PACKAGE_JSON_PATH } from "./constants.js";
import { getInstallLockPath, resolveWorkspacePath } from "./config.js";
import { SddError } from "./errors.js";
import {
  hashDirectory,
  isDirectory,
  isPathInside,
  isPathPhysicallyInside,
  pathExists,
  readJson,
  replaceDirectoryAtomically,
} from "./fs.js";

async function readPackageVersion() {
  const packageJson = JSON.parse(await readFile(PACKAGE_JSON_PATH, "utf8"));
  return packageJson.version;
}

export async function listBundledSkills() {
  const entries = await readdir(BUNDLED_SKILLS_DIRECTORY, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("sdd-"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export async function readInstallLock(workspaceRoot) {
  const path = getInstallLockPath(workspaceRoot);
  if (!(await pathExists(path))) {
    return null;
  }
  try {
    return await readJson(path);
  } catch (error) {
    throw new SddError(`Cannot parse SDD installation lock at ${path}: ${error.message}`, {
      code: "INVALID_INSTALL_LOCK",
    });
  }
}

async function assertSkillDirectoryInsideWorkspace(workspaceRoot, configuredDirectory) {
  const target = resolveWorkspacePath(workspaceRoot, configuredDirectory);
  if (!isPathInside(workspaceRoot, target) || !(await isPathPhysicallyInside(workspaceRoot, target))) {
    throw new SddError(
      `Skill directory ${configuredDirectory} resolves outside the configured user or legacy workspace root.`,
      { code: "UNSAFE_SKILL_DIRECTORY" },
    );
  }
  return target;
}

export async function planSkillSync(workspaceRoot, config, { force = false } = {}) {
  const skillsDirectory = await assertSkillDirectoryInsideWorkspace(
    workspaceRoot,
    config.skills.directory,
  );
  const previousLock = await readInstallLock(workspaceRoot);
  const previousSkills = previousLock?.managedSkills ?? {};
  const actions = [];
  const bundledSkills = await listBundledSkills();
  const bundledSkillNames = new Set(bundledSkills);

  for (const skillName of bundledSkills) {
    const source = join(BUNDLED_SKILLS_DIRECTORY, skillName);
    const target = join(skillsDirectory, skillName);
    const sourceHash = await hashDirectory(source);
    const targetExists = await isDirectory(target);
    const targetHash = targetExists ? await hashDirectory(target) : null;
    const previousHash = previousSkills[skillName] ?? null;

    let action;
    if (!targetExists) {
      action = "install";
    } else if (targetHash === sourceHash) {
      action = previousHash ? "unchanged" : "adopt";
    } else if (force) {
      action = previousHash ? "update-forced" : "replace-forced";
    } else if (previousHash && targetHash === previousHash) {
      action = "update";
    } else {
      action = "conflict";
    }

    actions.push({ skillName, action, source, target, sourceHash, targetHash, previousHash });
  }

  for (const [skillName, previousHash] of Object.entries(previousSkills)) {
    if (bundledSkillNames.has(skillName) || !/^sdd-[a-z0-9-]+$/.test(skillName)) continue;
    const target = join(skillsDirectory, skillName);
    if (!(await isDirectory(target))) continue;
    const targetHash = await hashDirectory(target);
    const action = targetHash === previousHash ? "remove" : force ? "remove-forced" : "conflict";
    actions.push({
      skillName,
      action,
      source: null,
      target,
      sourceHash: null,
      targetHash,
      previousHash,
    });
  }

  const conflicts = actions.filter((entry) => entry.action === "conflict");
  if (conflicts.length > 0) {
    throw new SddError(
      "Managed skill installation would overwrite local changes. Resolve the conflicts or rerun with --force.",
      {
        code: "SKILL_CONFLICT",
        details: conflicts.map((entry) => `${entry.skillName}: ${relative(workspaceRoot, entry.target)}`),
      },
    );
  }

  return {
    skillsDirectory,
    actions,
    lock: {
      version: config.version,
      packageVersion: await readPackageVersion(),
      schemaVersion: config.schema,
      skillsDirectory: config.skills.directory,
      managedSkills: Object.fromEntries(
        actions
          .filter((entry) => entry.sourceHash)
          .map((entry) => [entry.skillName, entry.sourceHash]),
      ),
    },
  };
}

export async function applySkillSync(
  workspaceRoot,
  plan,
  { dryRun = false, replaceDirectory = replaceDirectoryAtomically } = {},
) {
  const mutatingActions = new Set([
    "install",
    "update",
    "update-forced",
    "replace-forced",
    "remove",
    "remove-forced",
  ]);
  const candidates = plan.actions.filter((entry) => mutatingActions.has(entry.action));
  const nonce = `${process.pid}-${Date.now()}`;
  const backupRoot = join(plan.skillsDirectory, `.sdd-sync-backup-${nonce}`);
  const snapshots = [];
  const applied = [];

  const rollback = async (originalError = null) => {
    const failures = [];
    for (const snapshot of [...applied].reverse()) {
      try {
        const currentExists = await isDirectory(snapshot.entry.target);
        const expectedHash = snapshot.entry.sourceHash;
        const currentHash = currentExists ? await hashDirectory(snapshot.entry.target) : null;
        if (currentHash === snapshot.entry.targetHash) continue;
        if (currentExists && expectedHash && currentHash !== expectedHash) {
          failures.push(`${snapshot.entry.skillName}: newer target content preserved.`);
          continue;
        }
        if (currentExists && !expectedHash) {
          failures.push(`${snapshot.entry.skillName}: unexpected target content preserved.`);
          continue;
        }
        if (snapshot.existed) {
          await replaceDirectoryAtomically(snapshot.backupPath, snapshot.entry.target);
        } else {
          await rm(snapshot.entry.target, { recursive: true, force: true });
        }
      } catch (error) {
        failures.push(`${snapshot.entry.skillName}: ${error.message}`);
      }
    }
    if (failures.length > 0) {
      throw new SddError("Managed skill update failed and recovery was incomplete.", {
        code: "MUTATION_RECOVERY_FAILED",
        details: [
          ...(originalError ? [`Original error: ${originalError.message}`] : []),
          ...failures,
          `Recovery snapshots: ${backupRoot}`,
        ],
      });
    }
    await rm(backupRoot, { recursive: true, force: true });
  };

  if (!dryRun) {
    for (const entry of candidates) {
      if (!(await isPathPhysicallyInside(workspaceRoot, entry.target))) {
        throw new SddError(
          `Managed skill target resolves outside the configured user or legacy workspace root: ${entry.target}`,
          { code: "UNSAFE_SKILL_DIRECTORY" },
        );
      }
      const currentExists = await isDirectory(entry.target);
      const currentHash = currentExists ? await hashDirectory(entry.target) : null;
      if (currentHash !== entry.targetHash) {
        throw new SddError(
          `Managed skill changed after update planning: ${entry.skillName}`,
          { code: "SKILL_CONFLICT" },
        );
      }
    }
    if (candidates.length > 0) await mkdir(backupRoot, { recursive: true });
    for (const entry of candidates) {
      const existed = await isDirectory(entry.target);
      const backupPath = join(backupRoot, entry.skillName);
      if (existed) await cp(entry.target, backupPath, { recursive: true, verbatimSymlinks: true });
      snapshots.push({ entry, existed, backupPath });
    }
    try {
      for (const snapshot of snapshots) {
        const { entry } = snapshot;
        try {
          const currentExists = await isDirectory(entry.target);
          const currentHash = currentExists ? await hashDirectory(entry.target) : null;
          if (currentHash !== entry.targetHash) {
            throw new SddError(
              `Managed skill changed immediately before update: ${entry.skillName}`,
              { code: "SKILL_CONFLICT" },
            );
          }
          applied.push(snapshot);
          if (["install", "update", "update-forced", "replace-forced"].includes(entry.action)) {
            await replaceDirectory(entry.source, entry.target, { expectedHash: entry.targetHash });
          } else if (["remove", "remove-forced"].includes(entry.action)) {
            await rm(entry.target, { recursive: true, force: true });
          }
        } catch (error) {
          throw error;
        }
      }
      await verifySkillSyncPlan(plan);
    } catch (error) {
      await rollback(error);
      throw error;
    }
  }

  const result = {
    skillsDirectory: plan.skillsDirectory,
    actions: plan.actions.map(({ skillName, action, sourceHash }) => ({
      skillName,
      action,
      hash: sourceHash,
    })),
  };
  Object.defineProperties(result, {
    rollback: { value: rollback, enumerable: false },
    finalize: {
      value: () => rm(backupRoot, { recursive: true, force: true }),
      enumerable: false,
    },
    verify: {
      value: () => verifySkillSyncPlan(plan),
      enumerable: false,
    },
  });
  return result;
}

async function verifySkillSyncPlan(plan) {
  for (const entry of plan.actions) {
    const currentExists = await isDirectory(entry.target);
    const expectedHash = entry.sourceHash;
    const currentHash = currentExists ? await hashDirectory(entry.target) : null;
    if (currentHash !== expectedHash) {
      throw new SddError(`Managed skill changed before installation lock commit: ${entry.skillName}`, {
        code: "SKILL_CONFLICT",
      });
    }
  }
}

export async function inspectSkillInstallation(workspaceRoot, config) {
  const findings = [];
  let plan;
  try {
    plan = await planSkillSync(workspaceRoot, config);
  } catch (error) {
    if (error instanceof SddError && error.code === "SKILL_CONFLICT") {
      return error.details.map((detail) => ({
        level: "error",
        message: `Locally modified managed skill: ${detail}`,
      }));
    }
    throw error;
  }

  const lock = await readInstallLock(workspaceRoot);
  if (!lock) {
    findings.push({ level: "error", message: "Missing .sdd/install-lock.json." });
  } else if (lock.skillsDirectory !== config.skills.directory) {
    findings.push({
      level: "error",
      message: "The installation lock skill directory does not match config.yaml.",
    });
  }

  for (const entry of plan.actions) {
    if (entry.action === "install") {
      findings.push({ level: "error", message: `Missing managed skill: ${entry.skillName}.` });
    } else if (entry.action === "update") {
      findings.push({ level: "warning", message: `Managed skill update available: ${entry.skillName}.` });
    } else if (entry.action === "adopt") {
      findings.push({
        level: "warning",
        message: `Skill ${entry.skillName} matches the package but is not recorded in the installation lock.`,
      });
    } else if (entry.action === "remove") {
      findings.push({
        level: "warning",
        message: `Retired managed skill is still installed: ${entry.skillName}.`,
      });
    }
  }
  return findings;
}
