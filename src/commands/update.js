import {
  assertValidConfig,
  findWorkspaceRoot,
  getInstallLockPath,
  readConfig,
} from "../config.js";
import { writeJson } from "../fs.js";
import { applySkillSync, planSkillSync } from "../skills.js";
import { applyWorkflowSync, planWorkflowSync } from "../workflow.js";
import { WORKFLOW_SOURCE_PATH } from "../constants.js";

export async function updateWorkspace(startPath, { force = false, dryRun = false } = {}) {
  const workspaceRoot = await findWorkspaceRoot(startPath);
  const config = await readConfig(workspaceRoot);
  assertValidConfig(config, "update managed skills");
  const plan = await planSkillSync(workspaceRoot, config, { force });
  const workflowPlan = config.kind === "user"
    ? null
    : await planWorkflowSync(workspaceRoot, { force });
  const workflow = workflowPlan
    ? await applyWorkflowSync(workflowPlan, { dryRun })
    : { path: WORKFLOW_SOURCE_PATH, action: "bundled" };
  const skills = await applySkillSync(workspaceRoot, plan, { dryRun });
  if (!dryRun) {
    await writeJson(getInstallLockPath(workspaceRoot), {
      ...plan.lock,
      ...(workflowPlan ? { managedWorkflow: workflowPlan.lock } : {}),
    });
  }
  return {
    command: "update",
    mode: config.kind === "user" ? "user" : "legacy-workspace",
    workspaceRoot,
    dryRun,
    workflow,
    skills,
  };
}
