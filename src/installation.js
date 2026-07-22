import { readFile, rm } from "node:fs/promises";

import { getInstallLockPath } from "./config.js";
import { SddError } from "./errors.js";
import { isPathPhysicallyInside, pathExists, writeFileAtomically } from "./fs.js";
import { applySkillSync } from "./skills.js";
import { applyWorkflowSync } from "./workflow.js";

export async function applyManagedInstallation(
  workspaceRoot,
  {
    skillPlan,
    workflowPlan = null,
    dryRun = false,
    beforeLockCommit = null,
    writeLock = writeFileAtomically,
  },
) {
  let workflow = null;
  let skills = null;
  const lockPath = getInstallLockPath(workspaceRoot);
  if (!(await isPathPhysicallyInside(workspaceRoot, lockPath))) {
    throw new SddError(`Installation lock path resolves outside its owner root: ${lockPath}`, {
      code: "UNSAFE_CONFIG_PATH",
    });
  }
  const originalLockExists = await pathExists(lockPath);
  const originalLock = originalLockExists ? await readFile(lockPath, "utf8") : null;
  const nextLock = `${JSON.stringify({
    ...skillPlan.lock,
    ...(workflowPlan ? { managedWorkflow: workflowPlan.lock } : {}),
  }, null, 2)}\n`;
  try {
    workflow = workflowPlan ? await applyWorkflowSync(workflowPlan, { dryRun }) : null;
    skills = await applySkillSync(workspaceRoot, skillPlan, { dryRun });
    if (!dryRun) {
      if (beforeLockCommit) await beforeLockCommit({ workflow, skills, lockPath });
      await workflow?.verify?.();
      await skills.verify();
      await writeLock(lockPath, nextLock);
      await workflow?.verify?.();
      await skills.verify();
    }
  } catch (error) {
    const recoveryFailures = [];
    for (const operation of [skills, workflow]) {
      if (!operation?.rollback) continue;
      try {
        await operation.rollback(error);
      } catch (recoveryError) {
        recoveryFailures.push(recoveryError.message, ...(recoveryError.details ?? []));
      }
    }
    if (!dryRun) {
      try {
        const currentLock = await readFile(lockPath, "utf8").catch((readError) => {
          if (["ENOENT", "ENOTDIR"].includes(readError?.code)) return null;
          throw readError;
        });
        if (currentLock === nextLock) {
          if (originalLockExists) await writeFileAtomically(lockPath, originalLock);
          else await rm(lockPath, { force: true });
        } else if (currentLock !== originalLock) {
          recoveryFailures.push(`Installation lock changed concurrently and was preserved: ${lockPath}`);
        }
      } catch (recoveryError) {
        recoveryFailures.push(`Installation lock recovery failed: ${recoveryError.message}`);
      }
    }
    if (recoveryFailures.length > 0) {
      throw new SddError("Managed installation failed and recovery was incomplete.", {
        code: "MUTATION_RECOVERY_FAILED",
        details: [`Original error: ${error.message}`, ...recoveryFailures],
      });
    }
    throw error;
  }
  if (!dryRun) {
    const cleanupFailures = [];
    for (const operation of [workflow, skills]) {
      if (!operation?.finalize) continue;
      try {
        await operation.finalize();
      } catch (error) {
        cleanupFailures.push(error.message);
      }
    }
    if (cleanupFailures.length > 0) {
      throw new SddError("Managed installation committed but recovery-backup cleanup failed.", {
        code: "MUTATION_RECOVERY_FAILED",
        details: cleanupFailures,
      });
    }
  }
  return { workflow, skills };
}
