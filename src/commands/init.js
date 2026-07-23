import { mkdir, readFile, rm } from "node:fs/promises";
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
import { pathExists, writeFileAtomically } from "../fs.js";
import { planSkillSync } from "../skills.js";
import { planWorkflowSync } from "../workflow.js";
import { applyManagedInstallation } from "../installation.js";
import { withWorkspaceMutationLock } from "../mutation.js";

export async function initWorkspace(
  targetPath,
  options = {},
) {
  const workspaceRoot = resolve(targetPath);
  if (options.dryRun) return initWorkspaceUnlocked(workspaceRoot, options);
  return withWorkspaceMutationLock(
    workspaceRoot,
    () => initWorkspaceUnlocked(workspaceRoot, options),
  );
}

async function initWorkspaceUnlocked(
  workspaceRoot,
  {
    planningRoot,
    repositoryRoots,
    skillsDirectory,
    force = false,
    dryRun = false,
    writeLock = null,
    restoreConfig = writeFileAtomically,
  } = {},
) {
  const existing = await pathExists(getConfigPath(workspaceRoot));
  const originalConfigSource = existing
    ? await readFile(getConfigPath(workspaceRoot), "utf8")
    : null;
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
  const ignorePath = `${getConfigDirectory(workspaceRoot)}/.gitignore`;
  const ignoreExists = await pathExists(ignorePath);
  let createdIgnore = false;
  let migratedConfigSource = null;
  let workflow;
  let skills;
  try {
    if (!dryRun) {
      if (!existing || migratedFrom) {
        const writtenSource = await writeConfig(workspaceRoot, config);
        if (migratedFrom) migratedConfigSource = writtenSource;
      }
      if (!existing) {
        await mkdir(getConfigDirectory(workspaceRoot), { recursive: true });
        if (!ignoreExists) {
          await writeFileAtomically(ignorePath, "cache/\n");
          createdIgnore = true;
        }
      }
    }
    ({ workflow, skills } = await applyManagedInstallation(workspaceRoot, {
      skillPlan,
      workflowPlan,
      dryRun,
      ...(writeLock ? { writeLock } : {}),
    }));
  } catch (error) {
    if (!dryRun && !existing && !(await pathExists(getInstallLockPath(workspaceRoot)))) {
      const configPath = getConfigPath(workspaceRoot);
      const currentConfig = await readConfig(workspaceRoot).catch(() => null);
      if (JSON.stringify(currentConfig) === JSON.stringify(config)) {
        await rm(configPath, { force: true }).catch(() => {});
      }
      if (createdIgnore && await readFile(ignorePath, "utf8").catch(() => null) === "cache/\n") {
        await rm(ignorePath, { force: true }).catch(() => {});
      }
    }
    if (!dryRun && existing && migratedFrom && originalConfigSource !== null) {
      const configPath = getConfigPath(workspaceRoot);
      const currentConfigSource = await readFile(configPath, "utf8").catch(() => null);
      if (migratedConfigSource !== null && currentConfigSource === migratedConfigSource) {
        try {
          await restoreConfig(configPath, originalConfigSource);
        } catch (recoveryError) {
          throw new SddError("Installation failed and the migrated configuration could not be restored.", {
            code: "MUTATION_RECOVERY_FAILED",
            details: [
              `Original error: ${error.message}`,
              `Retained migrated configuration: ${configPath}`,
              `Restore error: ${recoveryError.message}`,
            ],
          });
        }
      } else if (migratedConfigSource !== null && currentConfigSource !== migratedConfigSource) {
        throw new SddError("Installation failed after the migrated configuration changed concurrently.", {
          code: "MUTATION_RECOVERY_FAILED",
          details: [
            `Original error: ${error.message}`,
            `Newer configuration preserved: ${configPath}`,
          ],
        });
      }
    }
    throw error;
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
