import { randomUUID } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

import { BUNDLED_SKILLS_DIRECTORY, PACKAGE_JSON_PATH } from "./constants.js";
import {
  getWorkspaceInstallLockPath,
  resolveWorkspaceSkillsDirectory,
} from "./config.js";
import { SddError } from "./errors.js";
import {
  createBoundDirectory,
  directoryHashMatches,
  directoryManifestHashVersions,
  directoryHashVersion,
  hashDirectory,
  sameBoundDirectoryBinding,
  isDirectory,
  isPathPhysicallyInside,
  pathExists,
  readBoundDirectory,
  readBoundRegularFile,
  removeBoundDirectory,
  replaceDirectoryAtomically,
} from "./fs.js";

async function readPackageVersion() {
  const packageJson = JSON.parse(await readFile(PACKAGE_JSON_PATH, "utf8"));
  return packageJson.version;
}

function invalidInstallLock(message) {
  return new SddError(message, { code: "INVALID_INSTALL_LOCK" });
}

function isInstallLockRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateManagedInstallationLock(
  lock,
  { requireStrongSkillHashes = false } = {},
) {
  if (!isInstallLockRecord(lock) || !isInstallLockRecord(lock.managedSkills)) {
    throw invalidInstallLock("Installation lock must contain a managedSkills object.");
  }
  if (
    (lock.version !== undefined
      && (!Number.isSafeInteger(lock.version) || lock.version < 1))
    || (lock.packageVersion !== undefined
      && (typeof lock.packageVersion !== "string" || !lock.packageVersion))
    || (lock.schemaVersion !== undefined
      && (typeof lock.schemaVersion !== "string" || !lock.schemaVersion))
    || (lock.skillsDirectory !== undefined
      && (typeof lock.skillsDirectory !== "string" || !lock.skillsDirectory))
  ) {
    throw invalidInstallLock("Installation lock metadata is malformed.");
  }

  const versions = new Set();
  for (const [skillName, hash] of Object.entries(lock.managedSkills)) {
    const version = directoryHashVersion(hash);
    if (!/^sdd-[a-z0-9-]+$/.test(skillName) || version === null) {
      throw invalidInstallLock(`Installation lock has an invalid managed skill hash: ${skillName}`);
    }
    if (requireStrongSkillHashes && version !== "strong") {
      throw invalidInstallLock(`New installation lock cannot persist a legacy skill hash: ${skillName}`);
    }
    versions.add(version);
  }
  if (versions.size > 1) {
    throw invalidInstallLock("Installation lock mixes managed skill hash versions.");
  }

  if (
    lock.managedWorkflow !== undefined
    && (
      !isInstallLockRecord(lock.managedWorkflow)
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
    const config = validateManagedInstallationLock(JSON.parse(file.source));
    return { ...file, config };
  } catch (error) {
    throw new SddError(`Cannot parse SDD installation lock at ${path}: ${error.message}`, {
      code: "INVALID_INSTALL_LOCK",
    });
  }
}

export async function readInstallLock(workspaceRoot) {
  return (await readInstallLockSnapshot(workspaceRoot))?.config ?? null;
}

async function assertSkillDirectoryInsideWorkspace(workspaceRoot, configuredDirectory) {
  return resolveWorkspaceSkillsDirectory(workspaceRoot, configuredDirectory);
}
function sameDirectoryIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino;
}

function sameDirectoryEntry(left, right, { identities = true } = {}) {
  if (
    left?.type !== right?.type
    || left?.relativePath !== right?.relativePath
    || left?.mode !== right?.mode
    || (identities && !sameDirectoryIdentity(left.identity, right.identity))
  ) {
    return false;
  }
  if (left.type === "directory") return true;
  if (left.type === "file") return left.bytes.equals(right.bytes);
  return Buffer.isBuffer(left.linkTarget)
    ? Buffer.isBuffer(right.linkTarget) && left.linkTarget.equals(right.linkTarget)
    : left.linkTarget === right.linkTarget;
}

function sameDirectoryManifest(
  left,
  right,
  { identities = true, binding = identities } = {},
) {
  return left !== null
    && right !== null
    && left.missing !== true
    && right.missing !== true
    && (!binding || sameBoundDirectoryBinding(left.binding, right.binding))
    && (!identities || sameDirectoryIdentity(left.root?.identity, right.root?.identity))
    && left.root?.mode === right.root?.mode
    && left.entries?.length === right.entries?.length
    && left.entries.every((entry, index) =>
      sameDirectoryEntry(entry, right.entries[index], { identities }));
}
function sameOptionalDirectoryManifest(left, right, options) {
  return (left === null && right === null)
    || sameDirectoryManifest(left, right, options);
}

function sameDirectoryBindingExtension(previous, current) {
  if (
    !previous
    || !current
    || !Array.isArray(previous.ancestors)
    || !Array.isArray(current.ancestors)
    || previous.ancestors.length > current.ancestors.length
  ) {
    return false;
  }
  return sameBoundDirectoryBinding(previous, {
    ...current,
    ancestors: current.ancestors.slice(0, previous.ancestors.length),
  });
}

function backupRootMatchesSnapshots(root, snapshots) {
  const expected = new Map();
  for (const snapshot of snapshots) {
    if (snapshot.backupManifest === null) continue;
    const prefix = snapshot.entry.skillName;
    expected.set(prefix, {
      type: "directory",
      relativePath: prefix,
      identity: snapshot.backupManifest.root.identity,
      mode: snapshot.backupManifest.root.mode,
    });
    for (const entry of snapshot.backupManifest.entries) {
      const relativePath = `${prefix}/${entry.relativePath}`;
      expected.set(relativePath, { ...entry, relativePath });
    }
  }
  return root.entries.length === expected.size
    && root.entries.every((entry) => sameDirectoryEntry(entry, expected.get(entry.relativePath)));
}

function skillRecoveryFailure(
  message,
  {
    originalError = null,
    failures = [],
    retainedPaths = [],
  } = {},
) {
  const errors = [
    ...(originalError ? [originalError] : []),
    ...failures.map(({ error }) => error),
  ];
  const failure = new SddError(message, {
    code: "MUTATION_RECOVERY_FAILED",
    details: [
      ...(originalError ? [`Original error: ${originalError.message}`] : []),
      ...failures.flatMap(({ label, error }) => [
        `${label}: ${error.message}`,
        ...(error?.details ?? []).map((detail) => `${label} detail: ${detail}`),
      ]),
      ...[...new Set(retainedPaths)]
        .map((path) => `Retained path requiring inspection: ${path}`),
    ],
  });
  if (errors.length > 0) {
    failure.errors = errors;
    failure.cause = new AggregateError(errors, failure.message);
  }
  return failure;
}

async function captureSkillDirectory(
  path,
  ownerRoot,
  label,
  {
    expectedBinding = undefined,
    returnMissingBinding = false,
  } = {},
) {
  const manifest = await readBoundDirectory(path, {
    ownerRoot,
    allowMissing: true,
    returnMissingBinding,
    label,
    unsafeCode: "UNSAFE_SKILL_DIRECTORY",
    expectedBinding,
  });
  return manifest?.missing === true && !returnMissingBinding ? null : manifest;
}

async function cleanupSkillDirectory(
  path,
  manifest,
  {
    ownerRoot,
    label,
    phase,
    skillName = null,
    beforeSkillCleanup,
    cleanupMkdir,
    cleanupRmdir,
    cleanupUnlink,
  },
) {
  try {
    const cleanup = await removeBoundDirectory(path, manifest, {
      ownerRoot,
      label,
      unsafeCode: "UNSAFE_SKILL_DIRECTORY",
      beforeCleanup: beforeSkillCleanup
        ? (cleanupState) => beforeSkillCleanup({
          ...cleanupState,
          phase,
          skillName,
        })
        : null,
      cleanupMkdir,
      cleanupRmdir,
      cleanupUnlink,
    });
    if (cleanup.failures.length > 0) {
      try {
        await lstat(path);
        cleanup.retainedPaths.push(path);
      } catch {
        // The original bound name is absent; the helper reports any retained quarantine.
      }
      cleanup.retainedPaths = [...new Set(cleanup.retainedPaths)];
    }
    return cleanup;
  } catch (error) {
    let retained = false;
    try {
      await lstat(path);
      retained = true;
    } catch {
      // The bound name was removed; any retained quarantine is reported by the nested error.
    }
    return {
      removed: false,
      failures: [{ label, error }],
      retainedPaths: retained ? [path] : [],
    };
  }
}

export async function planSkillSync(
  workspaceRoot,
  config,
  { force = false, installLockSnapshot: requestedInstallLockSnapshot } = {},
) {
  const skillsDirectory = await assertSkillDirectoryInsideWorkspace(
    workspaceRoot,
    config.skills.directory,
  );
  const installLockSnapshot = requestedInstallLockSnapshot === undefined
    ? await readInstallLockSnapshot(workspaceRoot, { includeMissingBinding: true })
    : requestedInstallLockSnapshot;
  const previousLock = installLockSnapshot?.config ?? null;
  if (previousLock !== null) validateManagedInstallationLock(previousLock);
  const previousSkills = previousLock?.managedSkills ?? {};
  const actions = [];
  const bundledSkills = await listBundledSkills();
  const bundledSkillNames = new Set(bundledSkills);

  for (const skillName of bundledSkills) {
    const source = join(BUNDLED_SKILLS_DIRECTORY, skillName);
    const target = join(skillsDirectory, skillName);
    const targetPathExists = await pathExists(target);
    const sourceHash = await hashDirectory(source);
    const targetSnapshot = await readBoundDirectory(target, {
      ownerRoot: workspaceRoot,
      allowMissing: true,
      returnMissingBinding: true,
      label: `Managed skill ${skillName}`,
      unsafeCode: "UNSAFE_SKILL_DIRECTORY",
    });
    const targetExists = targetSnapshot.missing !== true;
    const targetHashes = targetExists
      ? directoryManifestHashVersions(targetSnapshot)
      : null;
    const targetHash = targetHashes?.strong ?? null;
    if (targetPathExists && !targetExists) {
      throw new SddError(`Managed skill target is not a directory: ${target}`, {
        code: "UNSAFE_SKILL_DIRECTORY",
      });
    }
    const previousHash = previousSkills[skillName] ?? null;

    let action;
    if (!targetExists) {
      action = "install";
    } else if (targetHash === sourceHash) {
      action = previousHash ? "unchanged" : "adopt";
    } else if (force) {
      action = previousHash ? "update-forced" : "replace-forced";
    // Released hashes did not cover modes. Accept their exact historical ownership here,
    // then carry the strong target hash into apply so any post-plan byte or mode drift fails closed.
    } else if (previousHash && directoryHashMatches(targetHashes, previousHash)) {
      action = "update";
    } else {
      action = "conflict";
    }

    const plannedAction = {
      skillName,
      action,
      source,
      target,
      sourceHash,
      targetHash,
      previousHash,
    };
    Object.defineProperty(plannedAction, "targetBinding", {
      value: targetSnapshot.binding,
      enumerable: false,
      writable: true,
    });
    actions.push(plannedAction);
  }

  for (const [skillName, previousHash] of Object.entries(previousSkills)) {
    if (bundledSkillNames.has(skillName) || !/^sdd-[a-z0-9-]+$/.test(skillName)) continue;
    const target = join(skillsDirectory, skillName);
    if (!(await pathExists(target))) continue;
    const targetSnapshot = await readBoundDirectory(target, {
      ownerRoot: workspaceRoot,
      label: `Managed skill ${skillName}`,
      unsafeCode: "UNSAFE_SKILL_DIRECTORY",
    });
    const targetHashes = directoryManifestHashVersions(targetSnapshot);
    const targetHash = targetHashes.strong;
    const action = directoryHashMatches(targetHashes, previousHash)
      ? "remove"
      : force
        ? "remove-forced"
        : "conflict";
    const plannedAction = {
      skillName,
      action,
      source: null,
      target,
      sourceHash: null,
      targetHash,
      previousHash,
    };
    Object.defineProperty(plannedAction, "targetBinding", {
      value: targetSnapshot.binding,
      enumerable: false,
      writable: true,
    });
    actions.push(plannedAction);
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
          .filter((entry) => entry.sourceHash)
          .map((entry) => [entry.skillName, entry.sourceHash]),
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

export async function applySkillSync(
  workspaceRoot,
  plan,
  {
    dryRun = false,
    replaceDirectory = replaceDirectoryAtomically,
    beforeSkillCleanup = null,
    cleanupMkdir,
    cleanupRmdir,
    cleanupUnlink,
    assertOwnerCurrent = null,
    beforeSkillPublication = null,
  } = {},
) {
  const checkOwner = async () => assertOwnerCurrent?.();
  const checkSkillPublication = async (context) => {
    await beforeSkillPublication?.(context);
    await checkOwner();
  };
  const guardedSkillCleanup = async (context) => {
    await checkOwner();
    await beforeSkillCleanup?.(context);
    await checkOwner();
  };
  const mutatingActions = new Set([
    "install",
    "update",
    "update-forced",
    "replace-forced",
    "remove",
    "remove-forced",
  ]);
  const candidates = plan.actions.filter((entry) => mutatingActions.has(entry.action));
  const backupRoot = join(
    plan.skillsDirectory,
    `.sdd-sync-backup-${process.pid}-${randomUUID()}`,
  );

  const setTargetBinding = (snapshot, binding) => {
    if (Object.hasOwn(snapshot.entry, "targetBinding")) {
      snapshot.entry.targetBinding = binding;
    } else {
      Object.defineProperty(snapshot.entry, "targetBinding", {
        value: binding,
        enumerable: false,
        writable: true,
      });
    }
    snapshot.targetBinding = binding;
  };

  const rebaseAbsentTargetBindings = async (publishedSnapshot) => {
    if (publishedSnapshot.existed) return;
    for (const snapshot of snapshots) {
      if (snapshot.existed) continue;
      const current = snapshot === publishedSnapshot
        ? snapshot.publishedManifest
        : await captureSkillDirectory(
          snapshot.entry.target,
          workspaceRoot,
          `Managed skill ${snapshot.entry.skillName}`,
          { returnMissingBinding: true },
        );
      const publishedBinding = publishedSnapshot.publishedManifest?.binding;
      const samePublishedParent = publishedBinding
        && sameBoundDirectoryBinding(current?.binding, {
          ...publishedBinding,
          path: current?.binding?.path,
        });
      if (
        current === null
        || !sameDirectoryBindingExtension(snapshot.targetBinding, current.binding)
        || !samePublishedParent
      ) {
        throw new SddError(
          `Managed skill owner authority changed during parent creation: ${snapshot.entry.skillName}`,
          { code: "CONCURRENT_CHANGE" },
        );
      }
      setTargetBinding(snapshot, current.binding);
      snapshot.targetSnapshot = current;
    }
  };
  const snapshots = [];
  const applied = [];
  let backupRootAuthority = null;
  let backupRootManifest = null;

  const captureBackupRoot = async () => {
    const current = await readBoundDirectory(backupRoot, {
      ownerRoot: workspaceRoot,
      label: "Managed skill recovery backup",
      unsafeCode: "UNSAFE_SKILL_DIRECTORY",
    });
    if (
      !sameDirectoryIdentity(current.root.identity, backupRootAuthority?.root?.identity)
      || !backupRootMatchesSnapshots(current, snapshots)
    ) {
      throw new SddError(`Managed skill recovery backup changed: ${backupRoot}`, {
        code: "CONCURRENT_CHANGE",
      });
    }
    return current;
  };

  const cleanupBackupRoot = async (phase) => {
    if (backupRootManifest === null) {
      return { removed: false, failures: [], retainedPaths: [] };
    }
    const cleanup = await cleanupSkillDirectory(backupRoot, backupRootManifest, {
      ownerRoot: workspaceRoot,
      label: "Managed skill recovery backup",
      phase,
      beforeSkillCleanup: guardedSkillCleanup,
      cleanupMkdir,
      cleanupRmdir,
      cleanupUnlink,
    });
    if (cleanup.removed) backupRootManifest = null;
    return cleanup;
  };

  const restoreSnapshot = async (snapshot, failures, retainedPaths) => {
    try {
      backupRootManifest = await captureBackupRoot();
      let restoredPublication = null;
      await replaceDirectoryAtomically(snapshot.backupPath, snapshot.entry.target, {
        expectedHash: null,
        expectedSnapshot: { missing: true, binding: snapshot.targetBinding },
        expectedSourceSnapshot: snapshot.backupManifest,
        ownerRoot: workspaceRoot,
        beforeReplace: checkSkillPublication,
        afterBackup: checkOwner,
        beforePublish: checkOwner,
        afterPublish: async () => {
          await checkOwner();
          restoredPublication = await captureSkillDirectory(
            snapshot.entry.target,
            workspaceRoot,
            `Restored managed skill ${snapshot.entry.skillName}`,
            { expectedBinding: snapshot.targetBinding },
          );
          await checkOwner();
        },
      });
      const restored = await captureSkillDirectory(
        snapshot.entry.target,
        workspaceRoot,
        `Restored managed skill ${snapshot.entry.skillName}`,
        { expectedBinding: snapshot.targetBinding },
      );
      if (
        restoredPublication === null
        || !sameDirectoryManifest(restored, restoredPublication)
      ) {
        throw new SddError(
          `Managed skill recovery target changed after publication: ${snapshot.entry.target}`,
          { code: "CONCURRENT_CHANGE" },
        );
      }
      if (!sameDirectoryManifest(restored, snapshot.targetManifest, { identities: false })) {
        throw new SddError(
          `Managed skill recovery restored unexpected content: ${snapshot.entry.target}`,
          { code: "CONCURRENT_CHANGE" },
        );
      }
      snapshot.restoredManifest = restored;
      backupRootManifest = await captureBackupRoot();
    } catch (error) {
      failures.push({ label: `${snapshot.entry.skillName} restore`, error });
      retainedPaths.push(snapshot.entry.target, backupRoot);
    }
  };

  const rollback = async (originalError = null) => {
    const failures = [];
    const retainedPaths = [];
    for (const snapshot of [...applied].reverse()) {
      const { entry } = snapshot;
      let current;
      try {
        current = await captureSkillDirectory(
          entry.target,
          workspaceRoot,
          `Managed skill rollback target ${entry.skillName}`,
          { expectedBinding: snapshot.targetBinding },
        );
      } catch (error) {
        failures.push({ label: `${entry.skillName} target inspection`, error });
        retainedPaths.push(entry.target);
        continue;
      }

      const acceptedOriginal = snapshot.restoredManifest ?? snapshot.targetManifest;
      if (sameOptionalDirectoryManifest(current, acceptedOriginal)) continue;

      if (snapshot.publishedManifest !== null) {
        const cleanup = await cleanupSkillDirectory(entry.target, snapshot.publishedManifest, {
          ownerRoot: workspaceRoot,
          label: `Managed skill rollback target ${entry.skillName}`,
          phase: "rollback-target",
          skillName: entry.skillName,
          beforeSkillCleanup: guardedSkillCleanup,
          cleanupMkdir,
          cleanupRmdir,
          cleanupUnlink,
        });
        failures.push(...cleanup.failures);
        retainedPaths.push(...cleanup.retainedPaths);
        try {
          current = await captureSkillDirectory(
            entry.target,
            workspaceRoot,
            `Managed skill rollback target ${entry.skillName}`,
            { expectedBinding: snapshot.targetBinding },
          );
        } catch (error) {
          failures.push({ label: `${entry.skillName} post-cleanup inspection`, error });
          retainedPaths.push(entry.target);
          continue;
        }
      }

      if (sameOptionalDirectoryManifest(current, acceptedOriginal)) continue;
      if (current !== null) {
        failures.push({
          label: `${entry.skillName} rollback collision`,
          error: new Error("Newer target content was preserved."),
        });
        retainedPaths.push(entry.target, backupRoot);
        continue;
      }
      if (snapshot.existed) {
        await restoreSnapshot(snapshot, failures, retainedPaths);
      }
    }

    if (failures.length > 0) {
      retainedPaths.push(backupRoot);
      throw skillRecoveryFailure(
        "Managed skill update failed and recovery was incomplete.",
        { originalError, failures, retainedPaths },
      );
    }

    const cleanup = await cleanupBackupRoot("rollback-backup");
    if (cleanup.failures.length > 0) {
      throw skillRecoveryFailure(
        "Managed skill update failed and recovery-backup cleanup was incomplete.",
        {
          originalError,
          failures: cleanup.failures,
          retainedPaths: cleanup.retainedPaths,
        },
      );
    }
    applied.length = 0;
  };

  if (!dryRun) {
    await checkOwner();
    for (const entry of candidates) {
      await checkOwner();
      if (!(await isPathPhysicallyInside(workspaceRoot, entry.target))) {
        throw new SddError(
          `Managed skill target resolves outside its workspace: ${entry.target}`,
          { code: "UNSAFE_SKILL_DIRECTORY" },
        );
      }
      const targetSnapshot = await captureSkillDirectory(
        entry.target,
        workspaceRoot,
        `Managed skill ${entry.skillName}`,
        {
          expectedBinding: entry.targetBinding,
          returnMissingBinding: true,
        },
      );
      const targetManifest = targetSnapshot.missing === true ? null : targetSnapshot;
      if ((targetManifest?.hash ?? null) !== entry.targetHash) {
        throw new SddError(
          `Managed skill changed after update planning: ${entry.skillName}`,
          { code: "SKILL_CONFLICT" },
        );
      }
      const snapshot = {
        entry,
        existed: targetManifest !== null,
        targetSnapshot,
        targetManifest,
        targetBinding: targetSnapshot.binding,
        backupPath: join(backupRoot, entry.skillName),
        backupManifest: null,
        publishedManifest: null,
        restoredManifest: null,
      };
      setTargetBinding(snapshot, targetSnapshot.binding);
      snapshots.push(snapshot);
    }

    if (snapshots.some((snapshot) => snapshot.existed)) {
      try {
        await checkOwner();
        backupRootAuthority = await createBoundDirectory(backupRoot, {
          ownerRoot: workspaceRoot,
          label: "Managed skill recovery backup",
          unsafeCode: "UNSAFE_SKILL_DIRECTORY",
          mode: 0o700,
        });
        await checkOwner();
        backupRootManifest = backupRootAuthority;
      } catch (error) {
        throw skillRecoveryFailure(
          "Managed skill recovery-backup authority could not be captured.",
          {
            originalError: error,
            retainedPaths: [backupRoot],
          },
        );
      }
      try {
        for (const snapshot of snapshots) {
          if (!snapshot.existed) continue;
          let backupPublicationCaptured = false;
          await replaceDirectoryAtomically(snapshot.entry.target, snapshot.backupPath, {
            expectedHash: null,
            expectedSourceSnapshot: snapshot.targetManifest,
            ownerRoot: workspaceRoot,
            beforeReplace: checkSkillPublication,
            afterBackup: checkOwner,
            beforePublish: checkOwner,
            afterPublish: async () => {
              await checkOwner();
              snapshot.backupManifest = await readBoundDirectory(snapshot.backupPath, {
                ownerRoot: workspaceRoot,
                label: `Managed skill backup ${snapshot.entry.skillName}`,
                unsafeCode: "UNSAFE_SKILL_DIRECTORY",
              });
              await checkOwner();
              backupPublicationCaptured = true;
            },
          });
          if (!backupPublicationCaptured) {
            throw new SddError(
              `Managed skill backup publisher did not authenticate its result: ${snapshot.backupPath}`,
              { code: "MUTATION_RECOVERY_FAILED" },
            );
          }
          const current = await captureSkillDirectory(
            snapshot.entry.target,
            workspaceRoot,
            `Managed skill ${snapshot.entry.skillName}`,
            { expectedBinding: snapshot.targetBinding },
          );
          if (
            !sameDirectoryManifest(current, snapshot.targetManifest)
            || !sameDirectoryManifest(
              snapshot.backupManifest,
              snapshot.targetManifest,
              { identities: false },
            )
          ) {
            throw new SddError(
              `Managed skill changed while creating its recovery backup: ${snapshot.entry.skillName}`,
              { code: "SKILL_CONFLICT" },
            );
          }
          backupRootManifest = await captureBackupRoot();
        }
      } catch (error) {
        const failures = [];
        const retainedPaths = [];
        try {
          backupRootManifest = await captureBackupRoot();
          const cleanup = await cleanupBackupRoot("backup-construction");
          failures.push(...cleanup.failures);
          retainedPaths.push(...cleanup.retainedPaths);
        } catch (cleanupError) {
          failures.push({ label: "Managed skill backup cleanup", error: cleanupError });
          retainedPaths.push(backupRoot);
        }
        if (failures.length > 0) {
          throw skillRecoveryFailure(
            "Managed skill backup creation failed and cleanup was incomplete.",
            { originalError: error, failures, retainedPaths },
          );
        }
        throw error;
      }
    }

    try {
      for (const snapshot of snapshots) {
        const { entry } = snapshot;
        const current = await captureSkillDirectory(
          entry.target,
          workspaceRoot,
          `Managed skill ${entry.skillName}`,
          { expectedBinding: snapshot.targetBinding },
        );
        if (!sameOptionalDirectoryManifest(current, snapshot.targetManifest)) {
          throw new SddError(
            `Managed skill changed immediately before update: ${entry.skillName}`,
            { code: "SKILL_CONFLICT" },
          );
        }
        applied.push(snapshot);
        if (["install", "update", "update-forced", "replace-forced"].includes(entry.action)) {
          let publicationCaptured = false;
          await replaceDirectory(entry.source, entry.target, {
            expectedHash: entry.targetHash,
            expectedSnapshot: snapshot.targetSnapshot,
            ownerRoot: workspaceRoot,
            beforeReplace: checkSkillPublication,
            afterBackup: checkOwner,
            beforePublish: checkOwner,
            afterPublish: async () => {
              await checkOwner();
              snapshot.publishedManifest = await readBoundDirectory(entry.target, {
                ownerRoot: workspaceRoot,
                label: `Published managed skill ${entry.skillName}`,
                unsafeCode: "UNSAFE_SKILL_DIRECTORY",
              });
              await rebaseAbsentTargetBindings(snapshot);
              await checkOwner();
              publicationCaptured = true;
            },
          });
          if (!publicationCaptured) {
            throw new SddError(
              `Managed skill publisher did not authenticate its result: ${entry.target}`,
              {
                code: "MUTATION_RECOVERY_FAILED",
                details: [`Retained path requiring inspection: ${entry.target}`],
              },
            );
          }
        } else if (["remove", "remove-forced"].includes(entry.action)) {
          const cleanup = await cleanupSkillDirectory(entry.target, snapshot.targetManifest, {
            ownerRoot: workspaceRoot,
            label: `Managed skill removal ${entry.skillName}`,
            phase: "remove-target",
            skillName: entry.skillName,
            beforeSkillCleanup: guardedSkillCleanup,
            cleanupMkdir,
            cleanupRmdir,
            cleanupUnlink,
          });
          if (cleanup.failures.length > 0) {
            throw skillRecoveryFailure("Managed skill removal was incomplete.", {
              failures: cleanup.failures,
              retainedPaths: cleanup.retainedPaths,
            });
          }
        }
      }
      await checkOwner();
      await verifySkillSyncPlan(workspaceRoot, plan);
      await checkOwner();
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
      value: async () => {
        const cleanup = await cleanupBackupRoot("finalize-backup");
        if (cleanup.failures.length > 0) {
          throw skillRecoveryFailure(
            "Managed skill recovery-backup cleanup was incomplete.",
            {
              failures: cleanup.failures,
              retainedPaths: cleanup.retainedPaths,
            },
          );
        }
        applied.length = 0;
      },
      enumerable: false,
    },
    verify: {
      value: () => verifySkillSyncPlan(workspaceRoot, plan),
      enumerable: false,
    },
  });
  return result;
}

async function verifySkillSyncPlan(workspaceRoot, plan) {
  for (const entry of plan.actions) {
    const current = await readBoundDirectory(entry.target, {
      ownerRoot: workspaceRoot,
      allowMissing: true,
      returnMissingBinding: true,
      label: `Managed skill ${entry.skillName}`,
      unsafeCode: "UNSAFE_SKILL_DIRECTORY",
      expectedBinding: entry.targetBinding,
    });
    const expectedHash = entry.sourceHash;
    const currentHash = current.missing === true ? null : current.hash;
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
