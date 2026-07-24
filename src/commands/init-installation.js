import { mkdir, readFile, rm } from "node:fs/promises";
import { basename, resolve } from "node:path";

import {
  assertValidConfig,
  assertValidRepositoryConfig,
  createRepositoryConfig,
  createUserConfig,
  createUserConfigFromWorkspace,
  getConfigDirectory,
  getConfigPath,
  getInstallLockPath,
  getUserRoot,
  readConfig,
  readRepositoryConfig,
  writeConfig,
} from "../config.js";
import { SddError } from "../errors.js";
import { pathExists, writeFileAtomically } from "../fs.js";
import { planSkillSync } from "../skills.js";
import { WORKFLOW_SOURCE_PATH } from "../constants.js";
import { withWorkspaceMutationLock } from "../mutation.js";
import { applyManagedInstallation } from "../installation.js";

function defaultRepositoryId(repositoryRoot) {
  return basename(repositoryRoot)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function setupInstallation(
  options = {},
) {
  const userRoot = getUserRoot();
  if (options.dryRun) return setupInstallationUnlocked(userRoot, options);
  return withWorkspaceMutationLock(
    userRoot,
    () => setupInstallationUnlocked(userRoot, options),
  );
}

async function setupInstallationUnlocked(
  userRoot,
  {
    planningRoot,
    repositoryRoots,
    skillsDirectory,
    fromWorkspace,
    force = false,
    dryRun = false,
    writeLock = null,
  },
) {
  const userConfigExists = await pathExists(getConfigPath(userRoot));
  const requestedOverrides = [planningRoot, repositoryRoots, skillsDirectory, fromWorkspace].some(
    (value) => value !== undefined,
  );
  if (userConfigExists && requestedOverrides) {
    throw new SddError(
      "User-level path overrides only apply when creating ~/.sdd/config.yaml. Edit the existing user configuration or run sdd configure.",
      { code: "CONFIG_ALREADY_EXISTS" },
    );
  }

  const userConfig = userConfigExists
    ? await readConfig(userRoot)
    : fromWorkspace
      ? await createUserConfigFromWorkspace(userRoot, resolve(fromWorkspace), { skillsDirectory })
      : await createUserConfig(userRoot, { planningRoot, repositoryRoots, skillsDirectory });
  assertValidConfig(userConfig, "set up the user installation");

  const skillPlan = await planSkillSync(userRoot, userConfig, { force });
  const ignorePath = `${getConfigDirectory(userRoot)}/.gitignore`;
  const ignoreExists = await pathExists(ignorePath);
  let createdIgnore = false;
  let skills;
  try {
    if (!dryRun && !userConfigExists) {
      await writeConfig(userRoot, userConfig);
      await mkdir(getConfigDirectory(userRoot), { recursive: true });
      if (!ignoreExists) {
        await writeFileAtomically(ignorePath, "cache/\n");
        createdIgnore = true;
      }
    }
    ({ skills } = await applyManagedInstallation(userRoot, {
      skillPlan,
      dryRun,
      ...(writeLock ? { writeLock } : {}),
    }));
  } catch (error) {
    if (!dryRun && !userConfigExists && !(await pathExists(getInstallLockPath(userRoot)))) {
      const configPath = getConfigPath(userRoot);
      const currentConfig = await readConfig(userRoot).catch(() => null);
      if (JSON.stringify(currentConfig) === JSON.stringify(userConfig)) {
        await rm(configPath, { force: true }).catch(() => {});
      }
      if (createdIgnore && await readFile(ignorePath, "utf8").catch(() => null) === "cache/\n") {
        await rm(ignorePath, { force: true }).catch(() => {});
      }
    }
    throw error;
  }

  return {
    command: "setup",
    mode: "user",
    userRoot,
    createdUserConfig: !userConfigExists,
    migratedFromWorkspace: fromWorkspace ? resolve(fromWorkspace) : null,
    dryRun,
    userConfigPath: getConfigPath(userRoot),
    config: userConfig,
    workflowPath: WORKFLOW_SOURCE_PATH,
    skills,
  };
}

export async function initRepository(
  targetPath,
  { repositoryId, dryRun = false } = {},
) {
  const repositoryRoot = resolve(targetPath);
  const userRoot = getUserRoot();
  if (!(await pathExists(getConfigPath(userRoot)))) {
    throw new SddError("No user-level SDD installation found. Run `sdd setup` first.", {
      code: "USER_SETUP_REQUIRED",
    });
  }

  const userConfig = await readConfig(userRoot);
  assertValidConfig(userConfig, "initialize a repository");
  if (userConfig.kind !== "user") {
    throw new SddError("The user-level SDD configuration is not a user installation.", {
      code: "INVALID_USER_CONFIG",
    });
  }

  const options = { repositoryId, dryRun, userRoot, userConfig };
  if (dryRun) return initRepositoryUnlocked(repositoryRoot, options);
  return withWorkspaceMutationLock(
    repositoryRoot,
    () => initRepositoryUnlocked(repositoryRoot, options),
  );
}

async function initRepositoryUnlocked(
  repositoryRoot,
  { repositoryId, dryRun, userRoot, userConfig },
) {

  const targetConfigPath = getConfigPath(repositoryRoot);
  const targetConfigExists = await pathExists(targetConfigPath);
  const existingRepositoryConfig = await readRepositoryConfig(repositoryRoot);
  if (targetConfigExists && !existingRepositoryConfig) {
    throw new SddError(
      `A non-repository SDD configuration already exists at ${targetConfigPath}.`,
      {
        code: "EXISTING_WORKSPACE_CONFIG",
        details: ["Use `sdd init --legacy-workspace` only for the deprecated workspace model."],
      },
    );
  }

  const repositoryConfig = existingRepositoryConfig ?? createRepositoryConfig(
    repositoryId ?? defaultRepositoryId(repositoryRoot),
  );
  assertValidRepositoryConfig(repositoryConfig);
  if (!dryRun && !existingRepositoryConfig) {
    await writeConfig(repositoryRoot, repositoryConfig);
  }

  return {
    command: "init",
    mode: "repository",
    userRoot,
    repositoryRoot,
    createdRepositoryConfig: !existingRepositoryConfig,
    dryRun,
    userConfigPath: getConfigPath(userRoot),
    repositoryConfigPath: targetConfigPath,
    repositoryConfig,
    workflowPath: WORKFLOW_SOURCE_PATH,
  };
}
