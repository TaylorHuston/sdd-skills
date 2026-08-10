import { createHash } from "node:crypto";

import { getWorkspaceInstallLockPath } from "./config.js";

import { SddError } from "./errors.js";
import {
  isPathPhysicallyInside,
  readBoundDirectory,
  readBoundRegularFile,
  sameBoundFileOwner,
  removeBoundRegularFile,
  writeFileAtomically,
} from "./fs.js";
import { applySkillSync, validateManagedInstallationLock } from "./skills.js";
import { applyWorkflowSync } from "./workflow.js";
export function serializeManagedInstallationLock(skillPlan, workflowPlan = null) {
  const lock = {
    ...skillPlan.lock,
    ...(workflowPlan ? { managedWorkflow: workflowPlan.lock } : {}),
  };
  validateManagedInstallationLock(lock, { requireStrongSkillHashes: true });
  return `${JSON.stringify(lock, null, 2)}\n`;
}

function lockSnapshotMissing(snapshot) {
  return snapshot === null || snapshot?.missing === true;
}

function sameLockSnapshot(left, right) {
  if (lockSnapshotMissing(left) || lockSnapshotMissing(right)) {
    return lockSnapshotMissing(left)
      && lockSnapshotMissing(right)
      && sameBoundFileOwner(left?.ownerBinding ?? null, right?.ownerBinding ?? null);
  }
  return Buffer.isBuffer(left?.bytes)
    && Buffer.isBuffer(right?.bytes)
    && left.identity?.dev === right.identity?.dev
    && left.identity?.ino === right.identity?.ino
    && (right.mode === undefined || left.mode === right.mode)
    && left.bytes.equals(right.bytes)
    && sameBoundFileOwner(left.ownerBinding ?? null, right.ownerBinding ?? null);
}

function sameOptionalLockSnapshot(left, right) {
  return sameLockSnapshot(left, right);
}

function installLockChanged(lockPath, error = null) {
  const failure = new SddError(`Installation lock changed concurrently: ${lockPath}`, {
    code: "CONCURRENT_CHANGE",
    ...(error ? { details: [error.message] } : {}),
  });
  failure.retainedPaths = [lockPath];
  return failure;
}

async function readManagedInstallationLock(
  workspaceRoot,
  lockPath,
  allowMissing = true,
  expected = undefined,
) {
  return readBoundRegularFile(lockPath, {
    ownerRoot: workspaceRoot,
    allowMissing,
    returnMissingBinding: allowMissing,
    label: "Installation lock",
    unsafeCode: "UNSAFE_CONFIG_PATH",
    expectedOwnerBinding: expected?.ownerBinding,
  });
}

async function assertManagedInstallationLockCurrent(workspaceRoot, lockPath, expected) {
  let current;
  try {
    current = await readManagedInstallationLock(workspaceRoot, lockPath, true, expected);
  } catch (error) {
    throw installLockChanged(lockPath, error);
  }
  if (!sameLockSnapshot(current, expected)) throw installLockChanged(lockPath);
  return current;
}

function managedArtifactChanged(path, label, error = null) {
  const failure = new SddError(`${label} changed concurrently: ${path}`, {
    code: "CONCURRENT_CHANGE",
    ...(error ? { details: [error.message] } : {}),
  });
  failure.retainedPaths = [path];
  return failure;
}

function managedFileHash(snapshot) {
  return snapshot === null
    ? null
    : `sha256:${createHash("sha256").update(snapshot.bytes).digest("hex")}`;
}

function sameManagedFile(left, right) {
  return left === null && right === null
    ? true
    : left !== null
      && right !== null
      && left.identity.dev === right.identity.dev
      && left.identity.ino === right.identity.ino
      && (right.mode === undefined || left.mode === right.mode)
      && left.bytes.equals(right.bytes);
}

function sameManagedIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino;
}

function sameManagedDirectoryEntry(left, right) {
  if (
    left?.type !== right?.type
    || left?.relativePath !== right?.relativePath
    || left?.mode !== right?.mode
    || !sameManagedIdentity(left?.identity, right?.identity)
  ) {
    return false;
  }
  if (left.type === "file") return left.bytes.equals(right.bytes);
  if (left.type === "directory") return true;
  return Buffer.isBuffer(left.linkTarget)
    ? Buffer.isBuffer(right.linkTarget) && left.linkTarget.equals(right.linkTarget)
    : left.linkTarget === right.linkTarget;
}

function sameManagedDirectory(left, right) {
  if (left === null || right === null) return left === right;
  if (left.missing || right.missing) {
    return left.missing === true && right.missing === true;
  }
  return left.hash === right.hash
    && left.root?.mode === right.root?.mode
    && sameManagedIdentity(left.root?.identity, right.root?.identity)
    && left.entries?.length === right.entries?.length
    && left.entries.every((entry, index) =>
      sameManagedDirectoryEntry(entry, right.entries[index]));
}

async function readManagedSkillTarget(workspaceRoot, { target, skillName }, expected = undefined) {
  try {
    return await readBoundDirectory(target, {
      ownerRoot: workspaceRoot,
      returnMissingBinding: true,
      allowMissing: true,
      label: `Managed skill ${skillName}`,
      unsafeCode: "UNSAFE_SKILL_DIRECTORY",
      expectedBinding: expected?.binding,
    });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw managedArtifactChanged(target, `Managed skill ${skillName}`, error);
  }
}

async function readManagedWorkflowTarget(workspaceRoot, { path }, expected = undefined) {
  try {
    return await readBoundRegularFile(path, {
      ownerRoot: workspaceRoot,
      allowMissing: true,
      label: "Managed workflow",
      unsafeCode: "UNSAFE_CONFIG_PATH",
      expectedOwnerBinding: expected?.ownerBinding,
    });
  } catch (error) {
    throw managedArtifactChanged(path, "Managed workflow", error);
  }
}

async function captureManagedArtifacts(workspaceRoot, skillPlan, workflowPlan) {
  const plannedWorkflow = workflowPlan
    ? { path: workflowPlan.target, sourceHash: workflowPlan.sourceHash }
    : null;
  const plannedSkills = skillPlan.actions.map((entry) => ({
    target: entry.target,
    skillName: entry.skillName,
    sourceHash: entry.sourceHash,
    targetBinding: entry.targetBinding,
  }));
  let workflow = null;
  if (plannedWorkflow) {
    const snapshot = await readManagedWorkflowTarget(workspaceRoot, plannedWorkflow);
    if (managedFileHash(snapshot) !== plannedWorkflow.sourceHash) {
      throw managedArtifactChanged(plannedWorkflow.path, "Managed workflow");
    }
    workflow = { ...plannedWorkflow, snapshot };
  }

  const skills = await Promise.all(plannedSkills.map(async (entry) => {
    const snapshot = await readManagedSkillTarget(
      workspaceRoot,
      entry,
      { binding: entry.targetBinding },
    );
    if ((snapshot?.hash ?? null) !== entry.sourceHash) {
      throw managedArtifactChanged(entry.target, `Managed skill ${entry.skillName}`);
    }
    return { ...entry, snapshot };
  }));
  return { workflow, skills };
}

async function assertManagedArtifactsCurrent(workspaceRoot, expected) {
  if (expected.workflow) {
    const current = await readManagedWorkflowTarget(
      workspaceRoot,
      expected.workflow,
      expected.workflow.snapshot,
    );
    if (
      managedFileHash(current) !== expected.workflow.sourceHash
      || !sameManagedFile(current, expected.workflow.snapshot)
    ) {
      throw managedArtifactChanged(expected.workflow.path, "Managed workflow");
    }
  }
  for (const expectedSkill of expected.skills) {
    const current = await readManagedSkillTarget(
      workspaceRoot,
      expectedSkill,
      expectedSkill.snapshot,
    );
    if (
      (current?.hash ?? null) !== expectedSkill.sourceHash
      || !sameManagedDirectory(current, expectedSkill.snapshot)
    ) {
      throw managedArtifactChanged(
        expectedSkill.target,
        `Managed skill ${expectedSkill.skillName}`,
      );
    }
  }
}

function collectRetainedPaths(error, paths = new Set(), seen = new Set()) {
  if (error === null || typeof error !== "object" || seen.has(error)) return paths;
  seen.add(error);
  if (typeof error.retainedBackup?.path === "string") paths.add(error.retainedBackup.path);
  for (const path of error.retainedPaths ?? []) {
    if (typeof path === "string") paths.add(path);
  }
  for (const detail of error.details ?? []) {
    if (typeof detail !== "string") continue;
    const match = detail.match(
      /(?:Retained path(?: requiring inspection)?|Retained backup|Retained installation lock path|Concurrent\/opaque retained path): (.+)$/,
    );
    if (match) paths.add(match[1]);
  }
  for (const nested of error.errors ?? []) collectRetainedPaths(nested, paths, seen);
  return paths;
}

function labeledFailureDetails(label, error) {
  const code = typeof error?.code === "string" ? ` [${error.code}]` : "";
  return [
    `${label}${code}: ${error?.message ?? String(error)}`,
    ...(error?.details ?? []).map((detail) => `${label} detail: ${detail}`),
  ];
}

function combinedInstallationFailure(
  message,
  failures,
  { originalError = null } = {},
) {
  const records = [
    ...(originalError === null ? [] : [{ label: "Original error", error: originalError }]),
    ...failures,
  ];
  const errors = records.map(({ error }) => error);
  const retainedPaths = [...records.reduce(
    (paths, { error }) => collectRetainedPaths(error, paths),
    new Set(),
  )];
  const failure = new SddError(message, {
    code: "MUTATION_RECOVERY_FAILED",
    details: [
      ...records.flatMap(({ label, error }) => labeledFailureDetails(label, error)),
      ...retainedPaths.map((path) => `Retained path requiring inspection: ${path}`),
    ],
  });
  failure.errors = errors;
  failure.failures = failures;
  failure.cause = new AggregateError(errors, failure.message);
  failure.retainedPaths = retainedPaths;
  if (originalError !== null) {
    failure.originalError = originalError;
    if (originalError.retainedBackup) failure.retainedBackup = originalError.retainedBackup;
    if (originalError.published) failure.published = originalError.published;
  }
  return failure;
}

function retainedInstallationPath(message, path) {
  const error = new SddError(message, {
    code: "CONCURRENT_CHANGE",
    details: [`Retained path: ${path}`],
  });
  error.retainedPaths = [path];
  return error;
}

function committedInstallationError(error) {
  const failure = error instanceof Error
    ? error
    : new SddError(`Managed installation post-commit failure: ${String(error)}`, {
      code: "MUTATION_RECOVERY_FAILED",
    });
  failure.committed = true;
  failure.retainedPaths = [...collectRetainedPaths(failure)];
  return failure;
}

export async function applyManagedInstallation(
  workspaceRoot,
  {
    skillPlan,
    workflowPlan = null,
    dryRun = false,
    beforeLockCommit = null,
    afterCommit = null,
    afterLockPublish = null,
    beforeSuccess = null,
    assertCommitReady = null,
    commit = null,
    finalizeCommit = null,
    onFailure = null,
    onCommitted = null,
    writeLock = writeFileAtomically,
  },
) {
  let workflow = null;
  let skills = null;
  let publishedLock = null;
  let lockPublicationObserved = false;
  let managedArtifacts = null;
  let committedFailure = null;
  const lockPath = getWorkspaceInstallLockPath(workspaceRoot);
  if (!(await isPathPhysicallyInside(workspaceRoot, lockPath))) {
    throw new SddError(`Installation lock path resolves outside its workspace: ${lockPath}`, {
      code: "UNSAFE_CONFIG_PATH",
    });
  }
  const plannedLockSnapshot = [skillPlan, workflowPlan]
    .find((plan) => plan && Object.hasOwn(plan, "installLockSnapshot"))
    ?.installLockSnapshot;
  const originalLock = await readManagedInstallationLock(
    workspaceRoot,
    lockPath,
    true,
    plannedLockSnapshot,
  );
  for (const plan of [skillPlan, workflowPlan]) {
    if (plan && Object.hasOwn(plan, "installLockSnapshot")
      && !sameOptionalLockSnapshot(plan.installLockSnapshot, originalLock)) {
      throw installLockChanged(lockPath);
    }
  }
  const nextLock = serializeManagedInstallationLock(skillPlan, workflowPlan);
  try {
    workflow = workflowPlan
      ? await applyWorkflowSync(workflowPlan, { dryRun, ownerRoot: workspaceRoot })
      : null;
    skills = await applySkillSync(workspaceRoot, skillPlan, { dryRun });
    if (!dryRun) {
      managedArtifacts = await captureManagedArtifacts(workspaceRoot, skillPlan, workflowPlan);
      if (beforeLockCommit) await beforeLockCommit({ workflow, skills, lockPath });
      await assertManagedArtifactsCurrent(workspaceRoot, managedArtifacts);
      await workflow?.verify?.();
      await skills.verify();
      await assertManagedArtifactsCurrent(workspaceRoot, managedArtifacts);
      publishedLock = await writeLock(lockPath, nextLock, {
        expected: originalLock,
        ownerRoot: workspaceRoot,
        onPublished: async (snapshot) => {
          publishedLock = snapshot;
          lockPublicationObserved = true;
          await afterLockPublish?.({ workflow, skills, lockPath, publishedLock: snapshot });
        },
      });
      if (publishedLock == null) {
        publishedLock = await readManagedInstallationLock(workspaceRoot, lockPath, false);
      }
      if (!lockPublicationObserved) {
        lockPublicationObserved = true;
        await afterLockPublish?.({ workflow, skills, lockPath, publishedLock });
      }
      if (publishedLock.source !== nextLock) throw installLockChanged(lockPath);
      await assertManagedInstallationLockCurrent(workspaceRoot, lockPath, publishedLock);
      await workflow?.verify?.();
      await skills.verify();
      if (afterCommit) await afterCommit({ workflow, skills, lockPath });
      await assertManagedInstallationLockCurrent(workspaceRoot, lockPath, publishedLock);
      await beforeSuccess?.({ workflow, skills, lockPath, publishedLock });
      await assertManagedInstallationLockCurrent(workspaceRoot, lockPath, publishedLock);
      await assertManagedArtifactsCurrent(workspaceRoot, managedArtifacts);
      await assertManagedInstallationLockCurrent(workspaceRoot, lockPath, publishedLock);
      await assertCommitReady?.({ workflow, skills, lockPath, publishedLock });
      await assertManagedInstallationLockCurrent(workspaceRoot, lockPath, publishedLock);
      await assertManagedArtifactsCurrent(workspaceRoot, managedArtifacts);
      try {
        await commit?.({ workflow, skills, lockPath, publishedLock });
      } catch (error) {
        if (error?.committed !== true) throw error;
        committedFailure = error;
      }
    }
  } catch (error) {
    if (publishedLock === null && error?.published) publishedLock = error.published;
    let restoredInstallLockSnapshot;
    let recoveredPublishedLock = false;
    const recoveryFailures = [];
    for (const [label, operation] of [
      ["Managed skills rollback", skills],
      ["Managed workflow rollback", workflow],
    ]) {
      if (!operation?.rollback) continue;
      try {
        await operation.rollback(error);
      } catch (recoveryError) {
        recoveryFailures.push({ label, error: recoveryError });
      }
    }
    if (!dryRun && publishedLock !== null) {
      try {
        const currentLock = await readManagedInstallationLock(
          workspaceRoot,
          lockPath,
          true,
          publishedLock,
        );
        if (sameLockSnapshot(currentLock, publishedLock)) {
          if (!lockSnapshotMissing(originalLock)) {
            restoredInstallLockSnapshot = await writeFileAtomically(
              lockPath,
              originalLock.bytes,
              {
                expected: publishedLock,
                ownerRoot: workspaceRoot,
              },
            );
            recoveredPublishedLock = true;
          } else {
            await removeBoundRegularFile(lockPath, publishedLock, {
              ownerRoot: workspaceRoot,
              label: "Published installation lock",
            });
            recoveredPublishedLock = true;
          }
        } else {
          recoveryFailures.push({
            label: "Installation lock recovery",
            error: retainedInstallationPath(
              `Installation lock changed concurrently and was preserved: ${lockPath}`,
              lockPath,
            ),
          });
        }
      } catch (recoveryError) {
        recoveryFailures.push({
          label: "Installation lock recovery",
          error: recoveryError,
        });
      }
    }
    if (recoveredPublishedLock && error?.retainedBackup) {
      const { path: retainedPath, snapshot: retainedSnapshot } = error.retainedBackup;
      if (!sameLockSnapshot(retainedSnapshot, originalLock)) {
        recoveryFailures.push({
          label: "Installation lock backup cleanup",
          error: retainedInstallationPath(
            `Retained installation-lock backup did not match the original: ${retainedPath}`,
            retainedPath,
          ),
        });
      } else {
        try {
          await removeBoundRegularFile(retainedPath, retainedSnapshot, {
            ownerRoot: workspaceRoot,
            label: "Retained installation lock backup",
          });
        } catch (recoveryError) {
          recoveryFailures.push({
            label: "Installation lock backup cleanup",
            error: recoveryError,
          });
        }
      }
    }
    if (!dryRun && onFailure) {
      try {
        await onFailure(error, { restoredInstallLockSnapshot });
      } catch (recoveryError) {
        recoveryFailures.push({
          label: "Managed installation failure callback",
          error: recoveryError,
        });
      }
    }
    if (recoveryFailures.length > 0) {
      throw combinedInstallationFailure(
        "Managed installation failed and recovery was incomplete.",
        recoveryFailures,
        { originalError: error },
      );
    }
    throw error;
  }
  if (!dryRun) {
    const postCommitFailures = committedFailure === null
      ? []
      : [{ label: "Shared commit", error: committedFailure }];
    try {
      await assertManagedInstallationLockCurrent(workspaceRoot, lockPath, publishedLock);
      await assertManagedArtifactsCurrent(workspaceRoot, managedArtifacts);
      await workflow?.verify?.();
      await skills.verify();
    } catch (error) {
      postCommitFailures.push({
        label: "Managed installation post-commit verification",
        error,
      });
    }
    try {
      await onCommitted?.({ workflow, skills, lockPath, publishedLock });
    } catch (error) {
      postCommitFailures.push({
        label: "Managed installation commit notification",
        error,
      });
    }
    for (const [label, operation] of [
      ["Shared commit finalization", finalizeCommit
        ? { finalize: () => finalizeCommit({ workflow, skills, lockPath, publishedLock }) }
        : null],
      ["Managed workflow finalization", workflow],
      ["Managed skills finalization", skills],
    ]) {
      if (!operation?.finalize) continue;
      try {
        await operation.finalize();
      } catch (error) {
        postCommitFailures.push({ label, error });
      }
    }
    if (postCommitFailures.length === 1) {
      throw committedInstallationError(postCommitFailures[0].error);
    }
    if (postCommitFailures.length > 1) {
      throw committedInstallationError(combinedInstallationFailure(
        "Managed installation committed but post-commit work failed.",
        postCommitFailures,
      ));
    }
  }
  return { workflow, skills };
}
