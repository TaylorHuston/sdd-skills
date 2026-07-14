import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertValidConfig,
  createInitialConfig,
  getConfigDirectory,
  getConfigPath,
  getInstallLockPath,
  migrateConfig,
  readConfig,
  writeConfig,
} from "../config.js";
import { SddError } from "../errors.js";
import { pathExists, writeJson } from "../fs.js";
import { applySkillSync, planSkillSync } from "../skills.js";
import { applyWorkflowSync, planWorkflowSync } from "../workflow.js";

export async function initWorkspace(
  targetPath,
  { planningRoot, repositoryRoots, skillsDirectory, force = false, dryRun = false } = {},
) {
  const workspaceRoot = resolve(targetPath);
  const existing = await pathExists(getConfigPath(workspaceRoot));
  const requestedOverrides = [planningRoot, repositoryRoots, skillsDirectory].some(
    (value) => value !== undefined,
  );
  if (existing && requestedOverrides) {
    throw new SddError(
      "Workspace layout overrides only apply when creating .sdd/config.yaml. Edit the existing configuration directly.",
      { code: "CONFIG_ALREADY_EXISTS" },
    );
  }
  const loadedConfig = existing
    ? await readConfig(workspaceRoot)
    : await createInitialConfig(workspaceRoot, {
        planningRoot,
        repositoryRoots,
        skillsDirectory,
      });
  const { config, migratedFrom } = migrateConfig(loadedConfig, workspaceRoot);

  assertValidConfig(config, "initialize");

  const skillPlan = await planSkillSync(workspaceRoot, config, { force });
  const workflowPlan = await planWorkflowSync(workspaceRoot, { force });
  if (!dryRun) {
    if (!existing || migratedFrom) {
      await writeConfig(workspaceRoot, config);
    }
    if (!existing) {
      await mkdir(getConfigDirectory(workspaceRoot), { recursive: true });
      await writeFile(`${getConfigDirectory(workspaceRoot)}/.gitignore`, "cache/\n", "utf8");
    }
  }
  const workflow = await applyWorkflowSync(workflowPlan, { dryRun });
  const skills = await applySkillSync(workspaceRoot, skillPlan, { dryRun });
  if (!dryRun) {
    await writeJson(getInstallLockPath(workspaceRoot), {
      ...skillPlan.lock,
      managedWorkflow: workflowPlan.lock,
    });
  }

  return {
    command: "init",
    workspaceRoot,
    created: !existing,
    migratedFrom,
    dryRun,
    configPath: getConfigPath(workspaceRoot),
    ideasImported: Object.keys(config.ideas ?? {}).length,
    config,
    workflow,
    skills,
  };
}
