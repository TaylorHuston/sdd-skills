import { createHash, randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { WORKFLOW_RELATIVE_PATH, WORKFLOW_SOURCE_PATH } from "./constants.js";
import { SddError } from "./errors.js";
import {
  hashFile,
  isPathPhysicallyInside,
  pathExists,
  readBoundRegularFile,
  removeBoundRegularFile,
  replaceFileAtomically,
} from "./fs.js";
import { readInstallLockSnapshot, validateManagedInstallationLock } from "./skills.js";

export async function planWorkflowSync(
  workspaceRoot,
  { force = false, installLockSnapshot: requestedInstallLockSnapshot } = {},
) {
  const target = resolve(workspaceRoot, WORKFLOW_RELATIVE_PATH);
  if (!(await isPathPhysicallyInside(workspaceRoot, target))) {
    throw new SddError(`Managed workflow path resolves outside its owner root: ${target}`, {
      code: "UNSAFE_CONFIG_PATH",
    });
  }
  const installLockSnapshot = requestedInstallLockSnapshot === undefined
    ? await readInstallLockSnapshot(workspaceRoot, { includeMissingBinding: true })
    : requestedInstallLockSnapshot;
  const previousLock = installLockSnapshot?.config ?? null;
  if (previousLock !== null) validateManagedInstallationLock(previousLock);
  const previousHash = previousLock?.managedWorkflow?.hash ?? null;
  const sourceHash = await hashFile(WORKFLOW_SOURCE_PATH);
  const targetExists = await pathExists(target);
  const targetHash = targetExists ? await hashFile(target) : null;

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
    throw new SddError(
      "The managed SDD workflow document contains local changes. Reconcile it or rerun with --force.",
      {
        code: "WORKFLOW_CONFLICT",
        details: [WORKFLOW_RELATIVE_PATH],
      },
    );
  }

  const plan = {
    workspaceRoot,
    action,
    source: WORKFLOW_SOURCE_PATH,
    target,
    sourceHash,
    targetHash,
    previousHash,
    lock: { path: WORKFLOW_RELATIVE_PATH, hash: sourceHash },
  };
  Object.defineProperty(plan, "installLockSnapshot", {
    value: installLockSnapshot,
    enumerable: false,
    writable: true,
  });
  return plan;
}
function workflowFileHash(snapshot) {
  if (snapshot === null) return null;
  return `sha256:${createHash("sha256").update(snapshot.bytes).digest("hex")}`;
}

function sameWorkflowFile(left, right, { identities = true } = {}) {
  return left !== null
    && left !== undefined
    && right !== null
    && right !== undefined
    && (!identities
      || (left.identity.dev === right.identity.dev && left.identity.ino === right.identity.ino))
    && left.bytes.equals(right.bytes);
}

function sameOptionalWorkflowFile(left, right, options) {
  return (left === null && right === null) || sameWorkflowFile(left, right, options);
}

function workflowRecoveryFailure(
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

function captureWorkflowFile(path, ownerRoot, label, allowMissing = false) {
  return readBoundRegularFile(path, {
    ownerRoot,
    allowMissing,
    label,
    unsafeCode: "UNSAFE_CONFIG_PATH",
  });
}

async function cleanupWorkflowFile(
  path,
  snapshot,
  {
    ownerRoot,
    label,
    phase,
    beforeWorkflowCleanup,
  },
) {
  try {
    await beforeWorkflowCleanup?.({ path, phase, label });
    await removeBoundRegularFile(path, snapshot, { ownerRoot, label });
    return { removed: true, failures: [], retainedPaths: [] };
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

export async function applyWorkflowSync(
  plan,
  {
    dryRun = false,
    replaceFile = replaceFileAtomically,
    beforeWorkflowCleanup = null,
    ownerRoot: requestedOwnerRoot = null,
  } = {},
) {
  const mutating = ["install", "update", "update-forced", "replace-forced"].includes(plan.action);
  const plannedOwnerRoot = plan.workspaceRoot ? resolve(plan.workspaceRoot) : null;
  const explicitOwnerRoot = requestedOwnerRoot ? resolve(requestedOwnerRoot) : null;
  if (
    plannedOwnerRoot !== null
    && explicitOwnerRoot !== null
    && plannedOwnerRoot !== explicitOwnerRoot
  ) {
    throw new SddError("Managed workflow plan belongs to a different workspace.", {
      code: "UNSAFE_CONFIG_PATH",
      details: [
        `Planned workspace: ${plannedOwnerRoot}`,
        `Requested workspace: ${explicitOwnerRoot}`,
      ],
    });
  }
  const ownerRoot = explicitOwnerRoot ?? plannedOwnerRoot ?? resolve(dirname(plan.target));
  const backup = join(
    dirname(plan.target),
    `.sdd-workflow-backup-${process.pid}-${randomUUID()}`,
  );
  let original = null;
  let backupSnapshot = null;
  let publishedSnapshot = null;
  let restoredSnapshot = null;
  let applied = false;

  const cleanupBackup = async (phase) => {
    if (backupSnapshot === null) {
      return { removed: false, failures: [], retainedPaths: [] };
    }
    const cleanup = await cleanupWorkflowFile(backup, backupSnapshot, {
      ownerRoot,
      label: "Managed workflow recovery backup",
      phase,
      beforeWorkflowCleanup,
    });
    if (cleanup.removed) backupSnapshot = null;
    return cleanup;
  };

  const recover = async (originalError, targetPhase, backupPhase) => {
    const failures = [];
    const retainedPaths = [];
    let current;
    try {
      current = await captureWorkflowFile(
        plan.target,
        ownerRoot,
        "Managed workflow rollback target",
        true,
      );
    } catch (error) {
      failures.push({ label: "Managed workflow target inspection", error });
      retainedPaths.push(plan.target);
      current = undefined;
    }

    if (
      current !== undefined
      && publishedSnapshot !== null
      && !sameOptionalWorkflowFile(current, restoredSnapshot ?? original)
    ) {
      const cleanup = await cleanupWorkflowFile(plan.target, publishedSnapshot, {
        ownerRoot,
        label: "Managed workflow rollback target",
        phase: targetPhase,
        beforeWorkflowCleanup,
      });
      failures.push(...cleanup.failures);
      retainedPaths.push(...cleanup.retainedPaths);
      try {
        current = await captureWorkflowFile(
          plan.target,
          ownerRoot,
          "Managed workflow rollback target",
          true,
        );
      } catch (error) {
        failures.push({ label: "Managed workflow post-cleanup inspection", error });
        retainedPaths.push(plan.target);
        current = undefined;
      }
    }

    let restored = current !== undefined
      && sameOptionalWorkflowFile(current, restoredSnapshot ?? original);
    if (!restored && current === null && original !== null) {
      try {
        const currentBackup = await captureWorkflowFile(
          backup,
          ownerRoot,
          "Managed workflow recovery backup",
        );
        if (!sameWorkflowFile(currentBackup, backupSnapshot)) {
          throw new SddError(`Managed workflow recovery backup changed: ${backup}`, {
            code: "CONCURRENT_CHANGE",
          });
        }
        let restoredPublication = null;
        await replaceFileAtomically(backup, plan.target, {
          expectedHash: null,
          ownerRoot,
          afterPublish: async () => {
            restoredPublication = await captureWorkflowFile(
              plan.target,
              ownerRoot,
              "Restored managed workflow",
            );
          },
        });
        const candidateRestoredSnapshot = await captureWorkflowFile(
          plan.target,
          ownerRoot,
          "Restored managed workflow",
        );
        if (
          restoredPublication === null
          || !sameWorkflowFile(candidateRestoredSnapshot, restoredPublication)
        ) {
          throw new SddError(
            "Managed workflow recovery target changed after publication.",
            { code: "CONCURRENT_CHANGE" },
          );
        }
        if (!sameWorkflowFile(candidateRestoredSnapshot, original, { identities: false })) {
          throw new SddError("Managed workflow recovery restored unexpected content.", {
            code: "CONCURRENT_CHANGE",
          });
        }
        restoredSnapshot = candidateRestoredSnapshot;
        restored = true;
      } catch (error) {
        failures.push({ label: "Managed workflow restore", error });
        retainedPaths.push(plan.target, backup);
      }
    } else if (!restored && current !== null && current !== undefined) {
      failures.push({
        label: "Managed workflow rollback collision",
        error: new Error("Newer target content was preserved."),
      });
      retainedPaths.push(plan.target);
    }

    if (restored) {
      const cleanup = await cleanupBackup(backupPhase);
      failures.push(...cleanup.failures);
      retainedPaths.push(...cleanup.retainedPaths);
    } else if (backupSnapshot !== null) {
      retainedPaths.push(backup);
    }

    if (failures.length > 0) {
      throw workflowRecoveryFailure(
        originalError
          ? "Managed workflow update failed and recovery was incomplete."
          : "Managed workflow rollback was incomplete.",
        { originalError, failures, retainedPaths },
      );
    }
    publishedSnapshot = null;
    applied = false;
    restoredSnapshot = null;
  };

  if (!dryRun && mutating) {
    if (!(await isPathPhysicallyInside(ownerRoot, plan.target))) {
      throw new SddError(`Managed workflow path resolves outside its owner root: ${plan.target}`, {
        code: "UNSAFE_CONFIG_PATH",
        details: [`Owner root: ${ownerRoot}`],
      });
    }
    original = await captureWorkflowFile(
      plan.target,
      ownerRoot,
      "Managed workflow",
      true,
    );
    if (workflowFileHash(original) !== plan.targetHash) {
      throw new SddError("The managed workflow changed after update planning.", {
        code: "WORKFLOW_CONFLICT",
        details: [WORKFLOW_RELATIVE_PATH],
      });
    }

    try {
      if (original !== null) {
        let backupPublicationCaptured = false;
        await replaceFileAtomically(plan.target, backup, {
          expectedHash: null,
          ownerRoot,
          afterPublish: async () => {
            backupSnapshot = await captureWorkflowFile(
              backup,
              ownerRoot,
              "Managed workflow recovery backup",
            );
            backupPublicationCaptured = true;
          },
        });
        if (!backupPublicationCaptured) {
          throw new SddError(
            `Managed workflow backup publisher did not authenticate its result: ${backup}`,
            { code: "MUTATION_RECOVERY_FAILED" },
          );
        }
        const currentBackup = await captureWorkflowFile(
          backup,
          ownerRoot,
          "Managed workflow recovery backup",
        );
        const current = await captureWorkflowFile(
          plan.target,
          ownerRoot,
          "Managed workflow",
        );
        if (
          !sameWorkflowFile(current, original)
          || !sameWorkflowFile(currentBackup, backupSnapshot)
          || !sameWorkflowFile(backupSnapshot, original, { identities: false })
        ) {
          throw new SddError("The managed workflow changed while creating its recovery backup.", {
            code: "WORKFLOW_CONFLICT",
            details: [WORKFLOW_RELATIVE_PATH],
          });
        }
      }

      const commitSnapshot = await captureWorkflowFile(
        plan.target,
        ownerRoot,
        "Managed workflow",
        true,
      );
      if (!sameOptionalWorkflowFile(commitSnapshot, original)) {
        throw new SddError("The managed workflow changed immediately before update.", {
          code: "WORKFLOW_CONFLICT",
          details: [WORKFLOW_RELATIVE_PATH],
        });
      }

      let publicationCaptured = false;
      await replaceFile(plan.source, plan.target, {
        expectedHash: plan.targetHash,
        ownerRoot,
        afterPublish: async () => {
          publishedSnapshot = await captureWorkflowFile(
            plan.target,
            ownerRoot,
            "Published managed workflow",
          );
          publicationCaptured = true;
        },
      });
      if (!publicationCaptured) {
        throw new SddError(
          `Managed workflow publisher did not authenticate its result: ${plan.target}`,
          {
            code: "MUTATION_RECOVERY_FAILED",
            details: [`Retained path requiring inspection: ${plan.target}`],
          },
        );
      }
      applied = true;
    } catch (error) {
      await recover(error, "failure-target", "failure-backup");
      throw error;
    }
  }

  const result = { path: WORKFLOW_RELATIVE_PATH, action: plan.action, hash: plan.sourceHash };
  Object.defineProperties(result, {
    rollback: {
      enumerable: false,
      value: async () => {
        if (!applied) return;
        await recover(null, "rollback-target", "rollback-backup");
      },
    },
    finalize: {
      enumerable: false,
      value: async () => {
        const cleanup = await cleanupBackup("finalize-backup");
        if (cleanup.failures.length > 0) {
          throw workflowRecoveryFailure(
            "Managed workflow recovery-backup cleanup was incomplete.",
            {
              failures: cleanup.failures,
              retainedPaths: cleanup.retainedPaths,
            },
          );
        }
        publishedSnapshot = null;
        applied = false;
      },
    },
    verify: {
      enumerable: false,
      value: async () => {
        const currentHash = await pathExists(plan.target) ? await hashFile(plan.target) : null;
        if (currentHash !== plan.sourceHash) {
          throw new SddError("Managed workflow changed before installation lock commit.", {
            code: "WORKFLOW_CONFLICT",
            details: [WORKFLOW_RELATIVE_PATH],
          });
        }
      },
    },
  });
  return result;
}

export async function inspectWorkflowInstallation(workspaceRoot) {
  try {
    const plan = await planWorkflowSync(workspaceRoot);
    if (plan.action === "install") {
      return [{ level: "error", message: `Missing managed workflow: ${WORKFLOW_RELATIVE_PATH}.` }];
    }
    if (plan.action === "update") {
      return [{ level: "warning", message: "Managed SDD workflow update available." }];
    }
    if (plan.action === "adopt") {
      return [{ level: "warning", message: "The SDD workflow matches the package but is not recorded in the installation lock." }];
    }
    return [];
  } catch (error) {
    if (error instanceof SddError && error.code === "WORKFLOW_CONFLICT") {
      return [{ level: "error", message: `Locally modified managed workflow: ${WORKFLOW_RELATIVE_PATH}.` }];
    }
    throw error;
  }
}
