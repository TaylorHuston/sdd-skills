import {
  assertValidConfig,
  findWorkspaceRoot,
  getInstallLockPath,
  readConfig,
} from "../config.js";
import { writeJson } from "../fs.js";
import { applySkillSync, planSkillSync } from "../skills.js";
import { applyWorkflowSync, planWorkflowSync } from "../workflow.js";

export async function updateWorkspace(startPath, { force = false, dryRun = false } = {}) {
  const workspaceRoot = await findWorkspaceRoot(startPath);
  const config = await readConfig(workspaceRoot);
  assertValidConfig(config, "update managed skills");
  const plan = await planSkillSync(workspaceRoot, config, { force });
  const workflowPlan = await planWorkflowSync(workspaceRoot, { force });
  const workflow = await applyWorkflowSync(workflowPlan, { dryRun });
  const skills = await applySkillSync(workspaceRoot, plan, { dryRun });
  if (!dryRun) {
    await writeJson(getInstallLockPath(workspaceRoot), {
      ...plan.lock,
      managedWorkflow: workflowPlan.lock,
    });
  }
  return { command: "update", workspaceRoot, dryRun, workflow, skills };
}
