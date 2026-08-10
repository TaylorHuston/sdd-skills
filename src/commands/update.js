import { resolve } from "node:path";

import {
  assertValidConfig,
  assertWorkspaceConfigSnapshotCurrent,
  getWorkspaceConfigPath,
  isSupportedLegacyWorkspaceConfig,
  migrateWorkspaceConfig,
  resolveIdeaPlanningPath,
  resolveRepositoryPath,
  resolveWorkspacePath,
  readWorkspaceConfigSnapshot,
} from "../config.js";
import { SddError } from "../errors.js";
import { isPathPhysicallyInside } from "../fs.js";
import { applyManagedInstallation } from "../installation.js";
import { withWorkspaceMutationLock } from "../mutation.js";
import { planSkillSync, readInstallLockSnapshot } from "../skills.js";
import {
  applyUpdateMigration,
  findPendingUpdateMigrationWorkspace,
  planUpdateMigration,
  recoverUpdateMigration,
} from "../update-migration.js";
import {
  findOperationConfiguration,
  resolveOperationConfiguration,
} from "../workspace.js";
import { planWorkflowSync } from "../workflow.js";
function changedWorkspaceConfig(workspaceRoot) {
  return new SddError(
    `Workspace configuration changed concurrently: ${getWorkspaceConfigPath(workspaceRoot)}`,
    { code: "CONCURRENT_CHANGE" },
  );
}
async function assertMigratedWorkspaceMapsTarget(workspaceRoot, config, targetPath) {
  if (await isPathPhysicallyInside(workspaceRoot, targetPath)) return;
  const configuredOwners = new Set([
    resolveWorkspacePath(workspaceRoot, config.planning.root),
    ...Object.values(config.repositories.roots).map((path) =>
      resolveWorkspacePath(workspaceRoot, path)),
  ]);
  for (const [spaceId, space] of Object.entries(config.ideas ?? {})) {
    configuredOwners.add(resolveWorkspacePath(
      workspaceRoot,
      resolveIdeaPlanningPath(config, spaceId, space),
    ));
    for (const repository of space.repositories ?? []) {
      configuredOwners.add(resolveWorkspacePath(
        workspaceRoot,
        resolveRepositoryPath(config, repository),
      ));
    }
  }
  for (const owner of configuredOwners) {
    if (await isPathPhysicallyInside(owner, targetPath)) return;
  }
  throw new SddError(
    `Workspace ${workspaceRoot} does not map external target ${targetPath}.`,
    { code: "WORKSPACE_TARGET_UNMAPPED" },
  );
}



export async function updateWorkspace(
  startPath = process.cwd(),
  {
    workspaceRoot: explicitWorkspaceRoot,
    force = false,
    dryRun = false,
    targetSpecified = false,
    installationOptions = {},
    migrationOptions = {},
  } = {},
) {
  const invocationCwd = process.cwd();
  const targetPath = resolve(invocationCwd, startPath);
  const workspaceRoot = explicitWorkspaceRoot
    ? resolve(invocationCwd, explicitWorkspaceRoot)
    : null;
  const environmentWorkspaceRoot = typeof process.env.SDD_WORKSPACE_ROOT === "string"
    && process.env.SDD_WORKSPACE_ROOT.length > 0
    ? resolve(invocationCwd, process.env.SDD_WORKSPACE_ROOT)
    : null;
  const authorityWorkspaceRoot = workspaceRoot ?? environmentWorkspaceRoot;
  let recoveryWorkspaceRoot = authorityWorkspaceRoot
    ? await findPendingUpdateMigrationWorkspace(targetPath, {
        workspaceRoot: authorityWorkspaceRoot,
      })
    : await findPendingUpdateMigrationWorkspace(targetPath);
  if (
    !recoveryWorkspaceRoot
    && !authorityWorkspaceRoot
    && targetPath !== invocationCwd
  ) {
    recoveryWorkspaceRoot = await findPendingUpdateMigrationWorkspace(targetPath, {
      discoveryStartPath: invocationCwd,
    });
  }
  if (recoveryWorkspaceRoot) {
    if (dryRun) {
      await recoverUpdateMigration(recoveryWorkspaceRoot, { dryRun: true });
    } else {
      await withWorkspaceMutationLock(
        recoveryWorkspaceRoot,
        (mutationLock) => recoverUpdateMigration(recoveryWorkspaceRoot, { mutationLock }),
      );
    }
  }
  let operation = await findOperationConfiguration(targetPath, {
    ...(workspaceRoot ? { workspaceRoot } : {}),
  });
  const legacyConfig = isSupportedLegacyWorkspaceConfig(operation.config);
  if (!legacyConfig && (targetSpecified || targetPath !== invocationCwd)) {
    operation = await resolveOperationConfiguration(targetPath, {
      workspaceRoot: operation.workspaceRoot,
    });
  }
  const validationConfig = legacyConfig
    ? migrateWorkspaceConfig(operation.config, operation.workspaceRoot).config
    : operation.config;
  assertValidConfig(validationConfig, "update the SDD installation");
  const options = { force, dryRun, migrationOptions, installationOptions };
  if (
    legacyConfig
    && (targetSpecified || targetPath !== invocationCwd)
  ) {
    await assertMigratedWorkspaceMapsTarget(
      operation.workspaceRoot,
      validationConfig,
      targetPath,
    );
  }
  if (dryRun) return updateWorkspaceUnlocked(operation.workspaceRoot, options);
  return withWorkspaceMutationLock(
    operation.workspaceRoot,
    (mutationLock) => updateWorkspaceUnlocked(operation.workspaceRoot, { ...options, mutationLock }),
  );
}

async function updateWorkspaceUnlocked(
  workspaceRoot,
  {
    force,
    dryRun,
    migrationOptions,
    installationOptions,
    mutationLock = null,
  },
) {
  await recoverUpdateMigration(workspaceRoot, { dryRun, mutationLock });
  const workspaceConfigSnapshot = await readWorkspaceConfigSnapshot(workspaceRoot);
  const rawConfig = workspaceConfigSnapshot.config;
  const migrationPlan = await planUpdateMigration(workspaceRoot, rawConfig, {
    workspaceConfigSnapshot,
  });
  const config = migrationPlan.config;
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
  let migrationTransaction = null;
  let applied;
  let currentConfigSnapshot = workspaceConfigSnapshot;
  applied = await applyManagedInstallation(workspaceRoot, {
    skillPlan,
    workflowPlan,
    dryRun,
    beforeLockCommit: async () => {
      migrationTransaction = await applyUpdateMigration(migrationPlan, {
        ...migrationOptions,
        mutationLock,
      });
      currentConfigSnapshot = migrationTransaction.workspaceConfigSnapshot;
      if (!currentConfigSnapshot) throw changedWorkspaceConfig(workspaceRoot);
      await installationOptions.afterMigrationApply?.({
        migrationTransaction,
        workspaceConfigSnapshot: currentConfigSnapshot,
      });
      await assertWorkspaceConfigSnapshotCurrent(workspaceRoot, currentConfigSnapshot);
    },
    afterLockPublish: async (context) => {
      await installationOptions.afterLockPublish?.(context);
      await assertWorkspaceConfigSnapshotCurrent(workspaceRoot, currentConfigSnapshot);
    },
    beforeSuccess: async (context) => {
      await installationOptions.beforeSuccess?.(context);
      await assertWorkspaceConfigSnapshotCurrent(workspaceRoot, currentConfigSnapshot);
    },
    assertCommitReady: async () => {
      await assertWorkspaceConfigSnapshotCurrent(workspaceRoot, currentConfigSnapshot);
      await migrationTransaction?.assertCommitReady();
    },
    commit: async () => {
      await assertWorkspaceConfigSnapshotCurrent(workspaceRoot, currentConfigSnapshot);
      await migrationTransaction?.commit();
    },
    finalizeCommit: async () => {
      const transaction = migrationTransaction;
      await transaction?.finalizeCleanup();
      migrationTransaction = null;
    },
    onFailure: async () => {
      const transaction = migrationTransaction;
      migrationTransaction = null;
      await transaction?.rollback();
    },
  });
  return {
    command: "update",
    mode: "workspace",
    workspaceRoot,
    workspaceConfigPath: getWorkspaceConfigPath(workspaceRoot),
    dryRun,
    migration: migrationPlan.result,
    workflow: applied.workflow,
    skills: applied.skills,
  };
}
