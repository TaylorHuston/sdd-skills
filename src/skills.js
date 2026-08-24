import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

import { BUNDLED_SKILLS_DIRECTORY, PACKAGE_JSON_PATH } from "./constants.js";
import {
  getWorkspaceInstallLockPath,
  resolveWorkspaceSkillsDirectory,
} from "./config.js";
import { SddError } from "./errors.js";
import {
  hashDirectory,
  pathExists,
  readBoundDirectory,
  readBoundRegularFile,
} from "./fs.js";
import {
  ensureManagedSkillRegistry,
  publishManagedSkill,
} from "./managed-skill-publication.js";

const STRONG_DIRECTORY_HASH = /^sha256-directory-v2:[a-f0-9]{64}$/;
const MUTATING_ACTIONS = new Set([
  "install",
  "update",
  "update-forced",
  "replace-forced",
  "remove",
  "remove-forced",
]);

async function readPackageVersion() {
  const packageJson = JSON.parse(await readFile(PACKAGE_JSON_PATH, "utf8"));
  return packageJson.version;
}

function invalidInstallLock(message) {
  return new SddError(message, { code: "INVALID_INSTALL_LOCK" });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateManagedInstallationLock(lock) {
  if (!isRecord(lock) || !isRecord(lock.managedSkills)) {
    throw invalidInstallLock("Installation lock must contain a managedSkills object.");
  }
  if (
    (lock.version !== undefined && (!Number.isSafeInteger(lock.version) || lock.version < 1))
    || (lock.packageVersion !== undefined
      && (typeof lock.packageVersion !== "string" || !lock.packageVersion))
    || (lock.schemaVersion !== undefined
      && (typeof lock.schemaVersion !== "string" || !lock.schemaVersion))
    || (lock.skillsDirectory !== undefined
      && (typeof lock.skillsDirectory !== "string" || !lock.skillsDirectory))
  ) {
    throw invalidInstallLock("Installation lock metadata is malformed.");
  }
  for (const [skillName, hash] of Object.entries(lock.managedSkills)) {
    if (!/^sdd-[a-z0-9-]+$/.test(skillName) || !STRONG_DIRECTORY_HASH.test(hash)) {
      throw invalidInstallLock(`Installation lock has an invalid managed skill hash: ${skillName}`);
    }
  }
  if (
    lock.managedWorkflow !== undefined
    && (
      !isRecord(lock.managedWorkflow)
      || typeof lock.managedWorkflow.path !== "string"
      || !lock.managedWorkflow.path
      || !/^sha256:[a-f0-9]{64}$/.test(lock.managedWorkflow.hash)
    )
  ) {
    throw invalidInstallLock("Installation lock has invalid managed workflow ownership.");
  }
  return lock;
}

export async function listBundledSkills() {
  const entries = await readdir(BUNDLED_SKILLS_DIRECTORY, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("sdd-"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export async function readInstallLockSnapshot(
  workspaceRoot,
  { includeMissingBinding = false } = {},
) {
  const path = getWorkspaceInstallLockPath(workspaceRoot);
  const file = await readBoundRegularFile(path, {
    ownerRoot: workspaceRoot,
    allowMissing: true,
    returnMissingBinding: includeMissingBinding,
    label: "Installation lock",
    unsafeCode: "UNSAFE_CONFIG_PATH",
  });
  if (file === null || file.missing === true) return file;
  if (!file.bytes.equals(Buffer.from(file.source, "utf8"))) {
    throw new SddError(`Cannot parse SDD installation lock at ${path}: lock is not valid UTF-8.`, {
      code: "INVALID_INSTALL_LOCK",
    });
  }
  try {
    return { ...file, config: validateManagedInstallationLock(JSON.parse(file.source)) };
  } catch (error) {
    throw new SddError(`Cannot parse SDD installation lock at ${path}: ${error.message}`, {
      code: "INVALID_INSTALL_LOCK",
    });
  }
}

export async function readInstallLock(workspaceRoot) {
  return (await readInstallLockSnapshot(workspaceRoot))?.config ?? null;
}

export async function planSkillSync(
  workspaceRoot,
  config,
  { force = false, installLockSnapshot: requestedInstallLockSnapshot } = {},
) {
  const skillsDirectory = await resolveWorkspaceSkillsDirectory(
    workspaceRoot,
    config.skills.directory,
  );
  const installLockSnapshot = requestedInstallLockSnapshot === undefined
    ? await readInstallLockSnapshot(workspaceRoot, { includeMissingBinding: true })
    : requestedInstallLockSnapshot;
  const previousLock = installLockSnapshot?.config ?? null;
  if (previousLock !== null) validateManagedInstallationLock(previousLock);
  const previousSkills = previousLock?.managedSkills ?? {};
  const bundledSkills = await listBundledSkills();
  const bundledNames = new Set(bundledSkills);
  const actions = [];

  for (const skillName of bundledSkills) {
    const source = join(BUNDLED_SKILLS_DIRECTORY, skillName);
    const target = join(skillsDirectory, skillName);
    const sourceHash = await hashDirectory(source);
    const targetSnapshot = await readBoundDirectory(target, {
      ownerRoot: workspaceRoot,
      allowMissing: true,
      returnMissingBinding: true,
      label: `Managed skill ${skillName}`,
      unsafeCode: "UNSAFE_SKILL_DIRECTORY",
    });
    const targetHash = targetSnapshot.missing === true ? null : targetSnapshot.hash;
    const previousHash = previousSkills[skillName] ?? null;
    let action;
    if (targetHash === null) action = "install";
    else if (targetHash === sourceHash) action = previousHash ? "unchanged" : "adopt";
    else if (force) action = previousHash ? "update-forced" : "replace-forced";
    else if (previousHash !== null && targetHash === previousHash) action = "update";
    else action = "conflict";
    actions.push({
      skillName,
      action,
      source,
      target,
      sourceHash,
      targetHash,
      previousHash,
    });
  }

  for (const [skillName, previousHash] of Object.entries(previousSkills)) {
    if (bundledNames.has(skillName) || !/^sdd-[a-z0-9-]+$/.test(skillName)) continue;
    const target = join(skillsDirectory, skillName);
    if (!(await pathExists(target))) continue;
    const targetHash = await hashDirectory(target);
    actions.push({
      skillName,
      action: targetHash === previousHash
        ? "remove"
        : force
          ? "remove-forced"
          : "conflict",
      source: null,
      target,
      sourceHash: null,
      targetHash,
      previousHash,
    });
  }

  const conflicts = actions.filter(({ action }) => action === "conflict");
  if (conflicts.length > 0) {
    throw new SddError(
      "Managed skill installation would overwrite local changes. Resolve the conflicts or rerun with --force.",
      {
        code: "SKILL_CONFLICT",
        details: conflicts.map(({ skillName, target }) =>
          `${skillName}: ${relative(workspaceRoot, target)}`),
      },
    );
  }

  const plan = {
    skillsDirectory,
    actions,
    lock: {
      version: config.version,
      packageVersion: await readPackageVersion(),
      schemaVersion: config.schema,
      skillsDirectory: config.skills.directory,
      managedSkills: Object.fromEntries(
        actions
          .filter(({ sourceHash }) => sourceHash !== null)
          .map(({ skillName, sourceHash }) => [skillName, sourceHash]),
      ),
    },
  };
  Object.defineProperty(plan, "installLockSnapshot", {
    value: installLockSnapshot,
    enumerable: false,
    writable: true,
  });
  return plan;
}

function sameIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino;
}

function sameSkillSnapshot(left, right) {
  if (left?.missing === true || right?.missing === true) {
    return left?.missing === true && right?.missing === true;
  }
  return left?.hash === right?.hash
    && left.root?.mode === right.root?.mode
    && sameIdentity(left.root?.identity, right.root?.identity)
    && left.entries?.length === right.entries?.length
    && left.entries.every((entry, index) => {
      const other = right.entries[index];
      if (
        entry.type !== other?.type
        || entry.relativePath !== other.relativePath
        || entry.mode !== other.mode
        || !sameIdentity(entry.identity, other.identity)
      ) return false;
      if (entry.type === "file") return entry.bytes.equals(other.bytes);
      if (entry.type === "symlink") {
        return Buffer.isBuffer(entry.linkTarget)
          && Buffer.isBuffer(other.linkTarget)
          && entry.linkTarget.equals(other.linkTarget);
      }
      return true;
    });
}

async function captureExpectedSkills(workspaceRoot, plan) {
  const expected = [];
  for (const entry of plan.actions) {
    const snapshot = await readBoundDirectory(entry.target, {
      ownerRoot: workspaceRoot,
      allowMissing: true,
      returnMissingBinding: true,
      label: `Managed skill ${entry.skillName}`,
      unsafeCode: "UNSAFE_SKILL_DIRECTORY",
    });
    const hash = snapshot.missing === true ? null : snapshot.hash;
    if (hash !== entry.sourceHash) {
      throw new SddError(`Managed skill changed before installation lock commit: ${entry.skillName}`, {
        code: "SKILL_CONFLICT",
      });
    }
    expected.push({ entry, snapshot });
  }
  return expected;
}

async function verifyExpectedSkills(workspaceRoot, expected) {
  for (const { entry, snapshot } of expected) {
    const current = await readBoundDirectory(entry.target, {
      ownerRoot: workspaceRoot,
      allowMissing: true,
      returnMissingBinding: true,
      label: `Managed skill ${entry.skillName}`,
      unsafeCode: "UNSAFE_SKILL_DIRECTORY",
    });
    if (!sameSkillSnapshot(current, snapshot)) {
      throw new SddError(`Managed skill changed before installation lock commit: ${entry.skillName}`, {
        code: "SKILL_CONFLICT",
      });
    }
  }
}

function partialSkillFailure(error, state) {
  const details = [
    `Original error: ${error.message}`,
    ...(error?.details ?? []).map((detail) => `Original detail: ${detail}`),
    ...state.completed.map(({ skillName, action }) =>
      `Completed managed skill: ${skillName} (${action}).`),
    ...state.unchanged.map(({ skillName, action }) =>
      `Unchanged managed skill: ${skillName} (${action}).`),
    ...(state.failed
      ? [`Failed managed skill: ${state.failed.skillName} (${state.failed.action}).`]
      : []),
    ...state.pending.map(({ skillName, action }) =>
      `Residual managed skill action: ${skillName} (${action}).`),
    ...state.retainedPaths.map((path) => `Retained path requiring inspection: ${path}`),
    "Installation evidence was not advanced. Inspect retained state, retry the same setup or update command when it is intended, use --force only to replace deliberate local content, or recover the named path manually.",
  ];
  const failure = new SddError("Managed skill refresh stopped with preserved partial state.", {
    code: "MUTATION_RECOVERY_FAILED",
    details,
  });
  failure.cause = error;
  failure.skillState = state;
  failure.retainedPaths = state.retainedPaths;
  return failure;
}

export async function applySkillSync(
  workspaceRoot,
  plan,
  {
    dryRun = false,
    assertOwnerCurrent = null,
    beforeSkillPublication = null,
  } = {},
) {
  const resultActions = plan.actions.map(({ skillName, action, sourceHash }) => ({
    skillName,
    action,
    hash: sourceHash,
  }));
  if (dryRun) return { skillsDirectory: plan.skillsDirectory, actions: resultActions };

  const candidates = plan.actions.filter(({ action }) => MUTATING_ACTIONS.has(action));
  const state = {
    completed: [],
    unchanged: plan.actions
      .filter(({ action }) => !MUTATING_ACTIONS.has(action))
      .map(({ skillName, action }) => ({ skillName, action })),
    failed: null,
    pending: candidates.map(({ skillName, action }) => ({ skillName, action })),
    retainedPaths: [],
  };
  let assertRegistry = null;
  if (candidates.length > 0) {
    try {
      assertRegistry = await ensureManagedSkillRegistry(workspaceRoot, plan.skillsDirectory, {
        assertOwnerCurrent,
        beforeMutation: beforeSkillPublication,
      });
    } catch (error) {
      throw partialSkillFailure(error, state);
    }
  }

  for (const entry of candidates) {
    state.pending.shift();
    try {
      const completed = await publishManagedSkill(workspaceRoot, entry, {
        assertRegistry,
        assertOwnerCurrent,
        beforeMutation: beforeSkillPublication,
      });
      state.completed.push({ skillName: completed.skillName, action: completed.action });
    } catch (error) {
      if (error?.completed) {
        state.completed.push({ skillName: entry.skillName, action: entry.action });
      } else {
        state.failed = { skillName: entry.skillName, action: entry.action };
      }
      state.retainedPaths.push(...(error?.retainedPaths ?? []));
      throw partialSkillFailure(error, state);
    }
  }

  let expected;
  try {
    expected = await captureExpectedSkills(workspaceRoot, plan);
  } catch (error) {
    throw partialSkillFailure(error, state);
  }
  const result = { skillsDirectory: plan.skillsDirectory, actions: resultActions };
  Object.defineProperty(result, "verify", {
    value: () => verifyExpectedSkills(workspaceRoot, expected),
    enumerable: false,
  });
  return result;
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
  if (!lock) findings.push({ level: "error", message: "Missing .sdd/install-lock.json." });
  else if (lock.skillsDirectory !== config.skills.directory) {
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
