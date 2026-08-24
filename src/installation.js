import { createHash } from "node:crypto";

import { getWorkspaceInstallLockPath } from "./config.js";
import { SddError } from "./errors.js";
import {
  isPathPhysicallyInside,
  readBoundDirectory,
  readBoundRegularFile,
  sameBoundFileOwner,
} from "./fs.js";
import { publishManagedFile } from "./managed-file-publication.js";
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

function installLockChanged(lockPath, error = null) {
  const failure = new SddError(`Installation lock changed concurrently: ${lockPath}`, {
    code: "CONCURRENT_CHANGE",
    details: [
      ...(error ? [error.message] : []),
      `Preserved installation evidence: ${lockPath}`,
      "Inspect the preserved installation evidence and managed artifacts, then retry setup or update.",
    ],
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

function managedFileHash(snapshot) {
  return snapshot === null || snapshot?.missing === true
    ? null
    : `sha256:${createHash("sha256").update(snapshot.bytes).digest("hex")}`;
}

function sameIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino;
}

function sameManagedFile(left, right) {
  return left === null || left?.missing === true || right === null || right?.missing === true
    ? (left === null || left?.missing === true) && (right === null || right?.missing === true)
    : sameIdentity(left.identity, right.identity)
      && (right.mode === undefined || left.mode === right.mode)
      && left.bytes.equals(right.bytes);
}

function sameManagedDirectoryEntry(left, right) {
  if (
    left?.type !== right?.type
    || left?.relativePath !== right?.relativePath
    || left?.mode !== right?.mode
    || !sameIdentity(left?.identity, right?.identity)
  ) return false;
  if (left.type === "file") return left.bytes.equals(right.bytes);
  if (left.type === "directory") return true;
  return Buffer.isBuffer(left.linkTarget)
    ? Buffer.isBuffer(right.linkTarget) && left.linkTarget.equals(right.linkTarget)
    : left.linkTarget === right.linkTarget;
}

function sameManagedDirectory(left, right) {
  if (left === null || right === null) return left === right;
  if (left.missing || right.missing) return left.missing === true && right.missing === true;
  return left.hash === right.hash
    && left.root?.mode === right.root?.mode
    && sameIdentity(left.root?.identity, right.root?.identity)
    && left.entries?.length === right.entries?.length
    && left.entries.every((entry, index) => sameManagedDirectoryEntry(entry, right.entries[index]));
}

async function captureManagedArtifacts(workspaceRoot, skillPlan, workflowPlan) {
  const workflow = workflowPlan
    ? await readBoundRegularFile(workflowPlan.target, {
        ownerRoot: workspaceRoot,
        label: "Managed workflow",
        unsafeCode: "UNSAFE_CONFIG_PATH",
      })
    : null;
  if (workflowPlan && managedFileHash(workflow) !== workflowPlan.sourceHash) {
    throw new SddError(`Managed workflow changed concurrently: ${workflowPlan.target}`, {
      code: "CONCURRENT_CHANGE",
    });
  }

  const skills = [];
  for (const entry of skillPlan.actions) {
    const snapshot = await readBoundDirectory(entry.target, {
      ownerRoot: workspaceRoot,
      allowMissing: true,
      returnMissingBinding: true,
      label: `Managed skill ${entry.skillName}`,
      unsafeCode: "UNSAFE_SKILL_DIRECTORY",
      expectedBinding: entry.targetBinding,
    });
    if ((snapshot.missing === true ? null : snapshot.hash) !== entry.sourceHash) {
      throw new SddError(`Managed skill changed concurrently: ${entry.skillName}`, {
        code: "CONCURRENT_CHANGE",
      });
    }
    skills.push({ entry, snapshot });
  }
  return { workflow, skills };
}

async function assertManagedArtifactsCurrent(workspaceRoot, expected, workflowPlan) {
  if (workflowPlan) {
    const current = await readBoundRegularFile(workflowPlan.target, {
      ownerRoot: workspaceRoot,
      label: "Managed workflow",
      unsafeCode: "UNSAFE_CONFIG_PATH",
      expectedOwnerBinding: expected.workflow.ownerBinding,
    });
    if (managedFileHash(current) !== workflowPlan.sourceHash
      || !sameManagedFile(current, expected.workflow)) {
      throw new SddError(`Managed workflow changed concurrently: ${workflowPlan.target}`, {
        code: "CONCURRENT_CHANGE",
      });
    }
  }
  for (const { entry, snapshot } of expected.skills) {
    const current = await readBoundDirectory(entry.target, {
      ownerRoot: workspaceRoot,
      allowMissing: true,
      returnMissingBinding: true,
      label: `Managed skill ${entry.skillName}`,
      unsafeCode: "UNSAFE_SKILL_DIRECTORY",
      expectedBinding: snapshot.binding,
    });
    if ((current.missing === true ? null : current.hash) !== entry.sourceHash
      || !sameManagedDirectory(current, snapshot)) {
      throw new SddError(`Managed skill changed concurrently: ${entry.skillName}`, {
        code: "CONCURRENT_CHANGE",
      });
    }
  }
}

function describeError(error) {
  return `${error?.code ? `${error.code}: ` : ""}${error?.message ?? String(error)}`;
}

async function inspectPreservedWorkflow(
  workspaceRoot,
  workflowPlan,
  workflowApplied,
  assertOwnerCurrent,
) {
  if (!workflowPlan) {
    return { detail: "Managed workflow was not part of this operation.", retained: false };
  }
  if (!workflowApplied) {
    return {
      detail: `Managed workflow was not refreshed: ${workflowPlan.target}`,
      retained: false,
    };
  }
  try {
    await assertOwnerCurrent?.();
    const current = await readBoundRegularFile(workflowPlan.target, {
      ownerRoot: workspaceRoot,
      allowMissing: true,
      returnMissingBinding: true,
      label: "Preserved managed workflow",
      unsafeCode: "UNSAFE_CONFIG_PATH",
    });
    if (current?.missing === true || current === null) {
      return {
        detail: `Managed workflow is absent after partial refresh: ${workflowPlan.target}`,
        retained: false,
      };
    }
    return managedFileHash(current) === workflowPlan.sourceHash
      ? {
          detail: `Preserved managed workflow at packaged content: ${workflowPlan.target}`,
          retained: true,
        }
      : {
          detail: `Preserved managed workflow with other complete content: ${workflowPlan.target}`,
          retained: true,
        };
  } catch (inspectionError) {
    return {
      detail: `Managed workflow state requires inspection: ${workflowPlan.target} (${describeError(inspectionError)})`,
      retained: true,
    };
  }
}

async function managedRefreshFailure(
  error,
  {
    workspaceRoot,
    workflowPlan,
    workflowApplied,
    skillsApplied,
    skillsRolledBack,
    lockPath,
    lockState,
    recoveryError = null,
    assertOwnerCurrent = null,
  },
) {
  const workflowState = await inspectPreservedWorkflow(
    workspaceRoot,
    workflowPlan,
    workflowApplied,
    assertOwnerCurrent,
  );
  const details = [
    `Original error: ${describeError(error)}`,
    ...(error?.details ?? []).map((detail) => `Original detail: ${detail}`),
    workflowState.detail,
    skillsApplied
      ? skillsRolledBack
        ? "Managed skill changes were returned to their pre-refresh state."
        : "Managed skill refresh state was preserved for inspection."
      : "Managed skills were not changed by this operation.",
    `Installation evidence state: ${lockState}: ${lockPath}`,
    ...(recoveryError
      ? [
          `Managed skill recovery error: ${describeError(recoveryError)}`,
          ...(recoveryError?.details ?? []).map((detail) => `Managed skill recovery detail: ${detail}`),
        ]
      : []),
    "Inspect the named workflow, managed skills, and parseable installation evidence. Retry the same setup or update command when the preserved state is intended; otherwise reconcile local changes or use --force deliberately.",
  ];
  const failure = new SddError("Managed installation refresh stopped with preserved partial state.", {
    code: "MUTATION_RECOVERY_FAILED",
    details,
  });
  failure.errors = [error, ...(recoveryError ? [recoveryError] : [])];
  failure.cause = recoveryError
    ? new AggregateError(failure.errors, failure.message)
    : error;
  failure.retainedPaths = [
    ...(workflowState.retained ? [workflowPlan.target] : []),
    lockPath,
  ];
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
    onCommitted = null,
    writeLock = null,
    assertOwnerCurrent = null,
  },
) {
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
      && !sameLockSnapshot(plan.installLockSnapshot, originalLock)) {
      throw installLockChanged(lockPath);
    }
  }
  const nextLock = serializeManagedInstallationLock(skillPlan, workflowPlan);
  if (dryRun) {
    return {
      workflow: workflowPlan
        ? await applyWorkflowSync(workflowPlan, { dryRun: true, ownerRoot: workspaceRoot })
        : null,
      skills: await applySkillSync(workspaceRoot, skillPlan, { dryRun: true }),
    };
  }

  let workflow = null;
  let skills = null;
  let managedArtifacts = null;
  let publishedLock = null;
  let workflowApplied = false;
  let skillsApplied = false;
  let lockState = lockSnapshotMissing(originalLock) ? "absent" : "previous complete lock preserved";
  try {
    await assertOwnerCurrent?.();
    workflow = workflowPlan
      ? await applyWorkflowSync(workflowPlan, {
          ownerRoot: workspaceRoot,
          assertOwnerCurrent,
        })
      : null;
    workflowApplied = Boolean(workflowPlan
      && ["install", "update", "update-forced", "replace-forced"].includes(workflowPlan.action));
    await assertOwnerCurrent?.();
    skills = await applySkillSync(workspaceRoot, skillPlan, { assertOwnerCurrent });
    skillsApplied = skillPlan.actions.some(({ action }) => [
      "install", "update", "update-forced", "replace-forced", "remove", "remove-forced",
    ].includes(action));
    managedArtifacts = await captureManagedArtifacts(workspaceRoot, skillPlan, workflowPlan);
    await beforeLockCommit?.({ workflow, skills, lockPath });
    await assertManagedArtifactsCurrent(workspaceRoot, managedArtifacts, workflowPlan);
    await workflow?.verify?.();
    await skills.verify();
    await assertOwnerCurrent?.();
    const publishLock = writeLock ?? ((path, source, options) =>
      publishManagedFile(workspaceRoot, path, source, {
        ...options,
        label: "Installation evidence",
        assertOwnerCurrent,
      }));
    publishedLock = await publishLock(lockPath, nextLock, {
      expected: originalLock,
      onPublished: async (snapshot) => {
        publishedLock = snapshot;
        lockState = "requested complete lock published";
        await afterLockPublish?.({ workflow, skills, lockPath, publishedLock: snapshot });
      },
    });
    if (publishedLock == null) {
      publishedLock = await readManagedInstallationLock(workspaceRoot, lockPath, false);
      if (publishedLock.source === nextLock) lockState = "requested complete lock published";
      await afterLockPublish?.({ workflow, skills, lockPath, publishedLock });
    }
    if (publishedLock.source !== nextLock) throw installLockChanged(lockPath);
    await assertManagedInstallationLockCurrent(workspaceRoot, lockPath, publishedLock);
    await assertManagedArtifactsCurrent(workspaceRoot, managedArtifacts, workflowPlan);
    await workflow?.verify?.();
    await skills.verify();
    await afterCommit?.({ workflow, skills, lockPath });
    await assertManagedInstallationLockCurrent(workspaceRoot, lockPath, publishedLock);
    await beforeSuccess?.({ workflow, skills, lockPath, publishedLock });
    await assertOwnerCurrent?.();
    await assertManagedInstallationLockCurrent(workspaceRoot, lockPath, publishedLock);
    await assertManagedArtifactsCurrent(workspaceRoot, managedArtifacts, workflowPlan);
    await onCommitted?.({ workflow, skills, lockPath, publishedLock });
  } catch (error) {
    if (publishedLock === null && error?.published) publishedLock = error.published;
    if (publishedLock !== null) {
      try {
        const current = await readManagedInstallationLock(workspaceRoot, lockPath, true);
        lockState = current?.source === nextLock
          ? "requested complete lock published"
          : current === null || current?.missing === true
            ? "absent"
            : "other complete lock preserved";
      } catch {
        lockState = "retained lock requires inspection";
      }
    }
    let recoveryError = null;
    let skillsRolledBack = false;
    if (skills?.rollback && lockState !== "requested complete lock published") {
      try {
        await skills.rollback(error);
        skillsRolledBack = true;
      } catch (rollbackError) {
        recoveryError = rollbackError;
      }
    }
    throw await managedRefreshFailure(error, {
      workspaceRoot,
      workflowPlan,
      workflowApplied,
      skillsApplied,
      skillsRolledBack,
      lockPath,
      lockState,
      recoveryError,
      assertOwnerCurrent,
    });
  }

  try {
    await skills.finalize?.();
  } catch (error) {
    throw await managedRefreshFailure(error, {
      workspaceRoot,
      workflowPlan,
      workflowApplied,
      skillsApplied,
      skillsRolledBack: false,
      lockPath,
      lockState: "requested complete lock published",
      assertOwnerCurrent,
    });
  }
  return { workflow, skills };
}
