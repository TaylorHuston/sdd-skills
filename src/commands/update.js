import {
  assertValidConfig,
  findWorkspaceRoot,
  readConfig,
} from "../config.js";
import { planSkillSync } from "../skills.js";
import { planWorkflowSync } from "../workflow.js";
import { WORKFLOW_SOURCE_PATH } from "../constants.js";
import { withWorkspaceMutationLock } from "../mutation.js";
import { applyManagedInstallation } from "../installation.js";

export async function updateWorkspace(startPath, { force = false, dryRun = false } = {}) {
  const workspaceRoot = await findWorkspaceRoot(startPath);
  if (dryRun) return updateWorkspaceUnlocked(workspaceRoot, { force, dryRun });
  return withWorkspaceMutationLock(
    workspaceRoot,
    () => updateWorkspaceUnlocked(workspaceRoot, { force, dryRun }),
  );
}

async function updateWorkspaceUnlocked(workspaceRoot, { force, dryRun }) {
  const config = await readConfig(workspaceRoot);
  assertValidConfig(config, "update managed skills");
  const plan = await planSkillSync(workspaceRoot, config, { force });
  const workflowPlan = config.kind === "user"
    ? null
    : await planWorkflowSync(workspaceRoot, { force });
  const applied = await applyManagedInstallation(workspaceRoot, {
    skillPlan: plan,
    workflowPlan,
    dryRun,
  });
  const workflow = applied.workflow ?? { path: WORKFLOW_SOURCE_PATH, action: "bundled" };
  const { skills } = applied;
  return {
    command: "update",
    mode: config.kind === "user" ? "user" : "legacy-workspace",
    workspaceRoot,
    dryRun,
    workflow,
    skills,
  };
}
