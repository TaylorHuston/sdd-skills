import { copyFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { WORKFLOW_RELATIVE_PATH, WORKFLOW_SOURCE_PATH } from "./constants.js";
import { SddError } from "./errors.js";
import { hashFile, isPathPhysicallyInside, pathExists, replaceFileAtomically } from "./fs.js";
import { readInstallLock } from "./skills.js";

export async function planWorkflowSync(workspaceRoot, { force = false } = {}) {
  const target = resolve(workspaceRoot, WORKFLOW_RELATIVE_PATH);
  if (!(await isPathPhysicallyInside(workspaceRoot, target))) {
    throw new SddError(`Managed workflow path resolves outside its owner root: ${target}`, {
      code: "UNSAFE_CONFIG_PATH",
    });
  }
  const previousLock = await readInstallLock(workspaceRoot);
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

  return {
    workspaceRoot,
    action,
    source: WORKFLOW_SOURCE_PATH,
    target,
    sourceHash,
    targetHash,
    previousHash,
    lock: { path: WORKFLOW_RELATIVE_PATH, hash: sourceHash },
  };
}

export async function applyWorkflowSync(
  plan,
  { dryRun = false, replaceFile = replaceFileAtomically } = {},
) {
  const mutating = ["install", "update", "update-forced", "replace-forced"].includes(plan.action);
  const backup = join(dirname(plan.target), `.sdd-workflow-backup-${process.pid}-${Date.now()}`);
  let applied = false;
  if (!dryRun && mutating) {
    if (plan.workspaceRoot && !(await isPathPhysicallyInside(plan.workspaceRoot, plan.target))) {
      throw new SddError(`Managed workflow path resolves outside its owner root: ${plan.target}`, {
        code: "UNSAFE_CONFIG_PATH",
      });
    }
    const currentExists = await pathExists(plan.target);
    const currentHash = currentExists ? await hashFile(plan.target) : null;
    if (currentHash !== plan.targetHash) {
      throw new SddError("The managed workflow changed after update planning.", {
        code: "WORKFLOW_CONFLICT",
        details: [WORKFLOW_RELATIVE_PATH],
      });
    }
    if (currentExists) await copyFile(plan.target, backup);
    const commitHash = await pathExists(plan.target) ? await hashFile(plan.target) : null;
    if (commitHash !== plan.targetHash) {
      await rm(backup, { force: true });
      throw new SddError("The managed workflow changed immediately before update.", {
        code: "WORKFLOW_CONFLICT",
        details: [WORKFLOW_RELATIVE_PATH],
      });
    }
    try {
      await replaceFile(plan.source, plan.target, { expectedHash: plan.targetHash });
      applied = true;
    } catch (error) {
      const currentHash = await pathExists(plan.target)
        ? await hashFile(plan.target).catch(() => null)
        : null;
      if (currentHash === plan.sourceHash) {
        try {
          if (plan.targetHash === null) await rm(plan.target, { force: true });
          else await replaceFileAtomically(backup, plan.target);
          await rm(backup, { force: true });
        } catch (recoveryError) {
          throw new SddError("Managed workflow update failed after commit and recovery was incomplete.", {
            code: "MUTATION_RECOVERY_FAILED",
            details: [
              `Original error: ${error.message}`,
              `Retained backup: ${backup}`,
              recoveryError.message,
            ],
          });
        }
      } else if (currentHash === plan.targetHash) {
        await rm(backup, { force: true });
      } else {
        throw new SddError("Managed workflow update failed with an unexpected target state.", {
          code: "MUTATION_RECOVERY_FAILED",
          details: [`Original error: ${error.message}`, `Retained backup: ${backup}`],
        });
      }
      throw error;
    }
  }
  const result = { path: WORKFLOW_RELATIVE_PATH, action: plan.action, hash: plan.sourceHash };
  Object.defineProperties(result, {
    rollback: {
      enumerable: false,
      value: async () => {
        if (!applied) return;
        if (!(await pathExists(plan.target)) || await hashFile(plan.target) !== plan.sourceHash) {
          throw new SddError("Managed workflow changed after it was updated; newer content was preserved.", {
            code: "MUTATION_RECOVERY_FAILED",
            details: [`Retained backup: ${backup}`],
          });
        }
        if (plan.targetHash === null) await rm(plan.target, { force: true });
        else await replaceFileAtomically(backup, plan.target);
        await rm(backup, { force: true });
        applied = false;
      },
    },
    finalize: {
      enumerable: false,
      value: () => rm(backup, { force: true }),
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
