import { lstat, mkdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import {
  assertValidConfig,
  assertWorkspaceConfigSnapshotCurrent,
  assertValidRepositoryConfig,
  createInitialConfig,
  createRepositoryConfig,
  createRepositoryRootMap,
  getRepositoryConfigPath,
  getWorkspaceConfigDirectory,
  getWorkspaceConfigPath,
  normalizeWorkspaceConfiguredPath,
  readRepositoryConfigSnapshot,
  readWorkspaceConfigSnapshot,
  writeRepositoryConfig,
  writeWorkspaceConfig,
} from "../config.js";
import { assertChangeStoreConfinement } from "../change-store.js";
import {
  CHANGES_DIRECTORY_NAME,
  CLOSED_CHANGES_DIRECTORY_NAME,
  WORKFLOW_RELATIVE_PATH,
} from "../constants.js";
import { SddError } from "../errors.js";
import { isPathPhysicallyInside } from "../fs.js";
import { applyManagedInstallation } from "../installation.js";
import { publishManagedFile } from "../managed-file-publication.js";
import { withWorkspaceMutationLock } from "../mutation.js";
import { planSkillSync, readInstallLockSnapshot } from "../skills.js";
import { findOperationConfiguration } from "../workspace.js";
import { planWorkflowSync } from "../workflow.js";

function defaultRepositoryId(repositoryRoot) {
  return basename(repositoryRoot)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function installationResult(workspaceRoot, config, {
  createdWorkspaceConfig,
  dryRun,
  workflow,
  skills,
}) {
  return {
    command: "setup",
    mode: "workspace",
    workspaceRoot,
    createdWorkspaceConfig,
    dryRun,
    workspaceConfigPath: getWorkspaceConfigPath(workspaceRoot),
    config,
    workflowPath: resolve(workspaceRoot, WORKFLOW_RELATIVE_PATH),
    workflow,
    skills,
  };
}

async function lstatIfPresent(path) {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function inspectFixedSetupFile(workspaceRoot, path, label) {
  const state = await lstatIfPresent(path);
  if (
    !(await isPathPhysicallyInside(workspaceRoot, path))
    || state?.isSymbolicLink()
    || (state && !state.isFile())
  ) {
    throw new SddError(`${label} must be a confined regular file: ${path}`, {
      code: "UNSAFE_CONFIG_PATH",
    });
  }
  return state;
}

async function ensureSetupDirectory(
  workspaceRoot,
  path,
  label,
  assertOwnerCurrent = null,
  beforeMutation = null,
) {
  if (!(await isPathPhysicallyInside(workspaceRoot, path))) {
    throw new SddError(`${label} resolves outside its workspace: ${path}`, {
      code: "UNSAFE_ARTIFACT_PATH",
    });
  }
  try {
    await beforeMutation?.({ path, label });
    await assertOwnerCurrent?.();
    await mkdir(path, { recursive: true, mode: 0o755 });
    await assertOwnerCurrent?.();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const state = await lstatIfPresent(path);
  if (
    !state
    || state.isSymbolicLink()
    || !state.isDirectory()
    || !(await isPathPhysicallyInside(workspaceRoot, path))
  ) {
    throw new SddError(`${label} must be a confined real directory: ${path}`, {
      code: "UNSAFE_ARTIFACT_PATH",
    });
  }
}

function sameRepositoryRootMap(left, right) {
  const keys = Object.keys(left).sort((a, b) => a.localeCompare(b));
  const rightKeys = Object.keys(right).sort((a, b) => a.localeCompare(b));
  return keys.length === rightKeys.length
    && keys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

export async function setupInstallation(
  workspacePath = process.cwd(),
  options = {},
) {
  const workspaceRoot = resolve(workspacePath);
  if (options.dryRun) return setupInstallationUnlocked(workspaceRoot, options);
  return withWorkspaceMutationLock(
    workspaceRoot,
    ({ assertCurrent }) => setupInstallationUnlocked(workspaceRoot, {
      ...options,
      mutationAuthority: assertCurrent,
    }),
  );
}

async function setupInstallationUnlocked(
  workspaceRoot,
  {
    planningRoot,
    repositoryRoots,
    skillsDirectory,
    force = false,
    dryRun = false,
    writeLock = null,
    beforeSetupMutation = null,
    beforeSetupDirectoryMutation = null,
    beforeManagedInstallationSuccess = null,
    mutationAuthority = null,
  } = {},
) {
  const normalizedPlanningRoot = planningRoot === undefined
    ? undefined
    : normalizeWorkspaceConfiguredPath(workspaceRoot, planningRoot);
  const normalizedRepositoryRoots = repositoryRoots === undefined
    ? undefined
    : repositoryRoots.map((path) => normalizeWorkspaceConfiguredPath(workspaceRoot, path));
  const normalizedSkillsDirectory = skillsDirectory === undefined
    ? undefined
    : normalizeWorkspaceConfiguredPath(workspaceRoot, skillsDirectory);
  const configDirectory = getWorkspaceConfigDirectory(workspaceRoot);
  const configPath = getWorkspaceConfigPath(workspaceRoot);
  const ignorePath = join(configDirectory, ".gitignore");
  const existing = (await inspectFixedSetupFile(
    workspaceRoot,
    configPath,
    "Workspace configuration",
  )) !== null;
  const ignoreExists = (await inspectFixedSetupFile(
    workspaceRoot,
    ignorePath,
    "Workspace SDD ignore file",
  )) !== null;
  const changesRoot = join(configDirectory, CHANGES_DIRECTORY_NAME);
  const closedChangesRoot = join(changesRoot, CLOSED_CHANGES_DIRECTORY_NAME);
  let workspaceConfigSnapshot = existing
    ? await readWorkspaceConfigSnapshot(workspaceRoot)
    : null;
  const config = workspaceConfigSnapshot === null
    ? await createInitialConfig(workspaceRoot, {
        planningRoot: normalizedPlanningRoot,
        repositoryRoots: normalizedRepositoryRoots,
        skillsDirectory: normalizedSkillsDirectory,
      })
    : workspaceConfigSnapshot.config;

  if (existing) {
    const requestedRepositoryRoots = normalizedRepositoryRoots === undefined
      ? null
      : createRepositoryRootMap(normalizedRepositoryRoots);
    const hasConflictingOverride = (
      (normalizedPlanningRoot !== undefined && normalizedPlanningRoot !== config.planning.root)
      || (normalizedSkillsDirectory !== undefined
        && normalizedSkillsDirectory !== config.skills.directory)
      || (requestedRepositoryRoots !== null
        && !sameRepositoryRootMap(requestedRepositoryRoots, config.repositories.roots))
    );
    if (hasConflictingOverride) {
      throw new SddError(
        "Workspace layout overrides only apply when creating .sdd/config.yaml. Edit the existing configuration directly.",
        { code: "CONFIG_ALREADY_EXISTS" },
      );
    }
  }

  assertValidConfig(config, "set up the workspace installation");
  await assertChangeStoreConfinement(closedChangesRoot, workspaceRoot);
  const installLockSnapshot = await readInstallLockSnapshot(workspaceRoot, {
    includeMissingBinding: true,
  });
  const skillPlan = await planSkillSync(workspaceRoot, config, {
    force,
    installLockSnapshot,
  });
  const workflowPlan = await planWorkflowSync(workspaceRoot, {
    force,
    installLockSnapshot,
  });
  await assertWorkspaceConfigSnapshotCurrent(workspaceRoot, workspaceConfigSnapshot);

  if (dryRun) {
    return installationResult(workspaceRoot, config, {
      createdWorkspaceConfig: !existing,
      dryRun: true,
      workflow: {
        path: WORKFLOW_RELATIVE_PATH,
        action: workflowPlan.action,
        hash: workflowPlan.sourceHash,
      },
      skills: {
        skillsDirectory: skillPlan.skillsDirectory,
        actions: skillPlan.actions.map(({ skillName, action, sourceHash }) => ({
          skillName,
          action,
          hash: sourceHash,
        })),
      },
    });
  }

  await beforeSetupMutation?.({ workspaceRoot });
  await mutationAuthority?.();
  let createdWorkspaceConfig = false;
  if (!existing) {
    await mutationAuthority?.();
    await writeWorkspaceConfig(workspaceRoot, config, { expected: null });
    await mutationAuthority?.();
    workspaceConfigSnapshot = await readWorkspaceConfigSnapshot(workspaceRoot);
    createdWorkspaceConfig = true;
  }
  await mutationAuthority?.();
  await ensureSetupDirectory(
    workspaceRoot,
    changesRoot,
    "Workspace Change store",
    mutationAuthority,
    beforeSetupDirectoryMutation,
  );
  await mutationAuthority?.();
  await ensureSetupDirectory(
    workspaceRoot,
    closedChangesRoot,
    "Workspace closed Change store",
    mutationAuthority,
    beforeSetupDirectoryMutation,
  );
  if (!ignoreExists) {
    await mutationAuthority?.();
    await publishManagedFile(workspaceRoot, ignorePath, "cache/\n", {
      expected: null,
      label: "Workspace SDD ignore file",
      assertOwnerCurrent: mutationAuthority,
    });
  }
  await assertWorkspaceConfigSnapshotCurrent(workspaceRoot, workspaceConfigSnapshot);
  await assertChangeStoreConfinement(closedChangesRoot, workspaceRoot);
  const currentInstallLockSnapshot = await readInstallLockSnapshot(workspaceRoot, {
    includeMissingBinding: true,
  });
  skillPlan.installLockSnapshot = currentInstallLockSnapshot;
  workflowPlan.installLockSnapshot = currentInstallLockSnapshot;

  let workflow;
  let skills;
  try {
    await mutationAuthority?.();
    ({ workflow, skills } = await applyManagedInstallation(workspaceRoot, {
      skillPlan,
      workflowPlan,
      assertOwnerCurrent: mutationAuthority,
      beforeSuccess: async (context) => {
        await beforeManagedInstallationSuccess?.(context);
        await mutationAuthority?.();
        await assertWorkspaceConfigSnapshotCurrent(workspaceRoot, workspaceConfigSnapshot);
        await assertChangeStoreConfinement(closedChangesRoot, workspaceRoot);
      },
      ...(writeLock ? { writeLock } : {}),
    }));
  } catch (error) {
    if (createdWorkspaceConfig && error instanceof SddError) {
      error.details = [
        ...error.details,
        `Preserved workspace configuration: ${configPath}`,
        "Retry the same setup command after inspecting the preserved state.",
      ];
    }
    throw error;
  }

  return installationResult(workspaceRoot, config, {
    createdWorkspaceConfig: !existing,
    dryRun: false,
    workflow,
    skills,
  });
}

export async function initRepository(
  targetPath,
  {
    repositoryId,
    dryRun = false,
    workspaceRoot: explicitWorkspaceRoot,
    beforeConfigPublish = null,
  } = {},
) {
  const repositoryRoot = resolve(targetPath);
  const operation = await findOperationConfiguration(repositoryRoot, {
    ...(explicitWorkspaceRoot ? { workspaceRoot: explicitWorkspaceRoot } : {}),
  });
  assertValidConfig(operation.config, "initialize a repository");
  return initRepositoryUnlocked(repositoryRoot, {
    repositoryId,
    dryRun,
    workspaceRoot: operation.workspaceRoot,
    workspaceConfig: operation.config,
    beforeConfigPublish,
  });
}

async function initRepositoryUnlocked(
  repositoryRoot,
  { repositoryId, dryRun, workspaceRoot, workspaceConfig, beforeConfigPublish },
) {
  const targetConfigPath = getRepositoryConfigPath(repositoryRoot);
  const targetConfigSnapshot = await readRepositoryConfigSnapshot(repositoryRoot);
  const existingRepositoryConfig = targetConfigSnapshot?.config?.kind === "repository"
    ? targetConfigSnapshot.config
    : null;
  if (targetConfigSnapshot !== null && existingRepositoryConfig === null) {
    throw new SddError(
      `A non-repository SDD configuration already exists at ${targetConfigPath}.`,
      { code: "EXISTING_WORKSPACE_CONFIG" },
    );
  }
  const repositoryConfig = existingRepositoryConfig ?? createRepositoryConfig(
    repositoryId ?? defaultRepositoryId(repositoryRoot),
  );
  assertValidRepositoryConfig(repositoryConfig);
  if (!dryRun && !existingRepositoryConfig) {
    await writeRepositoryConfig(repositoryRoot, repositoryConfig, {
      expected: null,
      beforePublish: beforeConfigPublish,
    });
  }
  return {
    command: "init",
    mode: "repository",
    workspaceRoot,
    repositoryRoot,
    createdRepositoryConfig: !existingRepositoryConfig,
    dryRun,
    workspaceConfigPath: getWorkspaceConfigPath(workspaceRoot),
    repositoryConfigPath: targetConfigPath,
    workspaceConfig,
    repositoryConfig,
    workflowPath: resolve(workspaceRoot, WORKFLOW_RELATIVE_PATH),
  };
}
