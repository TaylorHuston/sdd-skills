import { assertValidConfig, findWorkspaceRoot, readConfig } from "../config.js";
import { applySkillSync, planSkillSync } from "../skills.js";

export async function updateWorkspace(startPath, { force = false, dryRun = false } = {}) {
  const workspaceRoot = await findWorkspaceRoot(startPath);
  const config = await readConfig(workspaceRoot);
  assertValidConfig(config, "update managed skills");
  const plan = await planSkillSync(workspaceRoot, config, { force });
  const skills = await applySkillSync(workspaceRoot, plan, { dryRun });
  return { command: "update", workspaceRoot, dryRun, skills };
}
