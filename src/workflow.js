import { resolve } from "node:path";

import { WORKFLOW_RELATIVE_PATH, WORKFLOW_SOURCE_PATH } from "./constants.js";
import { SddError } from "./errors.js";
import { hashFile, pathExists, replaceFileAtomically } from "./fs.js";
import { readInstallLock } from "./skills.js";

export async function planWorkflowSync(workspaceRoot, { force = false } = {}) {
  const target = resolve(workspaceRoot, WORKFLOW_RELATIVE_PATH);
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
    action,
    source: WORKFLOW_SOURCE_PATH,
    target,
    sourceHash,
    targetHash,
    previousHash,
    lock: { path: WORKFLOW_RELATIVE_PATH, hash: sourceHash },
  };
}

export async function applyWorkflowSync(plan, { dryRun = false } = {}) {
  if (!dryRun && ["install", "update", "update-forced", "replace-forced"].includes(plan.action)) {
    await replaceFileAtomically(plan.source, plan.target);
  }
  return { path: WORKFLOW_RELATIVE_PATH, action: plan.action, hash: plan.sourceHash };
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
