import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { WORKFLOW_RELATIVE_PATH, WORKFLOW_SOURCE_PATH } from "./constants.js";
import { SddError } from "./errors.js";
import {
  hashFile,
  isPathPhysicallyInside,
  pathExists,
  readBoundRegularFile,
} from "./fs.js";
import { publishManagedFile } from "./managed-file-publication.js";
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

function workflowRefreshFailure(plan, error, retainedHash) {
  const retainedState = retainedHash === null
    ? `Managed workflow remains absent: ${plan.target}`
    : retainedHash === plan.sourceHash
      ? `Managed workflow contains the packaged version: ${plan.target}`
      : `Managed workflow preserves other complete content: ${plan.target}`;
  const failure = new SddError("Managed workflow refresh stopped with preserved state.", {
    code: "MUTATION_RECOVERY_FAILED",
    details: [
      `Original error: ${error?.code ? `${error.code}: ` : ""}${error?.message ?? String(error)}`,
      ...(error?.details ?? []).map((detail) => `Original detail: ${detail}`),
      retainedState,
      `Installation evidence was not advanced for this workflow refresh: ${WORKFLOW_RELATIVE_PATH}`,
      "Inspect the retained workflow. Retry the same setup or update command if it is the intended complete state; otherwise reconcile it manually or rerun with --force.",
    ],
  });
  failure.errors = [error];
  failure.cause = error;
  failure.retainedPaths = retainedHash === null ? [] : [plan.target];
  return failure;
}

export async function applyWorkflowSync(
  plan,
  {
    dryRun = false,
    publishFile = publishManagedFile,
    ownerRoot: requestedOwnerRoot = null,
    assertOwnerCurrent = null,
  } = {},
) {
  const mutating = ["install", "update", "update-forced", "replace-forced"].includes(plan.action);
  const plannedOwnerRoot = plan.workspaceRoot ? resolve(plan.workspaceRoot) : null;
  const explicitOwnerRoot = requestedOwnerRoot ? resolve(requestedOwnerRoot) : null;
  if (plannedOwnerRoot && explicitOwnerRoot && plannedOwnerRoot !== explicitOwnerRoot) {
    throw new SddError("Managed workflow plan belongs to a different workspace.", {
      code: "UNSAFE_CONFIG_PATH",
      details: [
        `Planned workspace: ${plannedOwnerRoot}`,
        `Requested workspace: ${explicitOwnerRoot}`,
      ],
    });
  }
  const ownerRoot = explicitOwnerRoot ?? plannedOwnerRoot;
  if (!ownerRoot || !(await isPathPhysicallyInside(ownerRoot, plan.target))) {
    throw new SddError(`Managed workflow path resolves outside its owner root: ${plan.target}`, {
      code: "UNSAFE_CONFIG_PATH",
      details: ownerRoot ? [`Owner root: ${ownerRoot}`] : [],
    });
  }

  if (!dryRun && mutating) {
    const expected = await readBoundRegularFile(plan.target, {
      ownerRoot,
      allowMissing: true,
      returnMissingBinding: true,
      label: "Managed workflow",
      unsafeCode: "UNSAFE_CONFIG_PATH",
    });
    const currentHash = expected?.missing === true ? null : await hashFile(plan.target);
    if (currentHash !== plan.targetHash) {
      throw new SddError("The managed workflow changed after update planning.", {
        code: "WORKFLOW_CONFLICT",
        details: [WORKFLOW_RELATIVE_PATH],
      });
    }
    try {
      await publishFile(ownerRoot, plan.target, await readFile(plan.source, "utf8"), {
        expected,
        label: "Managed workflow",
        assertOwnerCurrent,
      });
    } catch (error) {
      const retainedHash = await pathExists(plan.target) ? await hashFile(plan.target) : null;
      if (error?.code === "CONCURRENT_CHANGE" && retainedHash !== plan.sourceHash) {
        throw new SddError("The managed workflow changed during refresh and was preserved.", {
          code: "WORKFLOW_CONFLICT",
          details: [
            WORKFLOW_RELATIVE_PATH,
            `Preserved workflow: ${plan.target}`,
            "Inspect the preserved workflow, then retry or rerun with --force if replacement is intended.",
          ],
        });
      }
      throw workflowRefreshFailure(plan, error, retainedHash);
    }
  }

  const result = { path: WORKFLOW_RELATIVE_PATH, action: plan.action, hash: plan.sourceHash };
  Object.defineProperty(result, "verify", {
    enumerable: false,
    value: async () => {
      const currentHash = await pathExists(plan.target) ? await hashFile(plan.target) : null;
      if (currentHash !== plan.sourceHash) {
        throw new SddError("Managed workflow changed before installation evidence was published.", {
          code: "WORKFLOW_CONFLICT",
          details: [WORKFLOW_RELATIVE_PATH],
        });
      }
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
