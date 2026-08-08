import { resolve } from "node:path";

import {
  assertValidConfig,
  getConfigPath,
  getUserRoot,
  isSupportedLegacyConfig,
  migrateConfig,
  readConfig,
  resolveWorkspacePath,
} from "../config.js";
import { SddError } from "../errors.js";
import { planSkillSync } from "../skills.js";
import { planWorkflowSync } from "../workflow.js";
import { WORKFLOW_SOURCE_PATH } from "../constants.js";
import { withWorkspaceMutationLock } from "../mutation.js";
import { applyManagedInstallation } from "../installation.js";
import {
  applyUpdateMigration,
  planUpdateMigration,
  recoverUpdateMigration,
} from "../update-migration.js";
import { pathExists } from "../fs.js";
import { findOperationConfiguration } from "../workspace.js";

export async function updateWorkspace(
  startPath,
  {
    force = false,
    dryRun = false,
    migrationOptions = {},
  } = {},
) {
  const canonicalUserRoot = getUserRoot();
  if (!(await pathExists(getConfigPath(canonicalUserRoot)))) {
    if (dryRun) {
      await recoverUpdateMigration(canonicalUserRoot, {
        userRoot: canonicalUserRoot,
        dryRun: true,
      });
    } else {
      await withWorkspaceMutationLock(
        canonicalUserRoot,
        () => recoverUpdateMigration(canonicalUserRoot, { userRoot: canonicalUserRoot }),
      );
    }
  }
  let operation;
  try {
    operation = await findOperationConfiguration(startPath);
  } catch (error) {
    if (error?.code !== "WORKSPACE_NOT_INITIALIZED") throw error;
    const recoveryRoot = getUserRoot();
    if (dryRun) {
      await recoverUpdateMigration(recoveryRoot, { userRoot: recoveryRoot, dryRun: true });
    } else {
      await withWorkspaceMutationLock(
        recoveryRoot,
        () => recoverUpdateMigration(recoveryRoot, { userRoot: recoveryRoot }),
      );
    }
    operation = await findOperationConfiguration(startPath);
  }
  const rawMigrationSource = operation.config.migration?.sourceWorkspace;
  if (
    rawMigrationSource !== undefined
    && (
      typeof rawMigrationSource !== "string"
      || !rawMigrationSource
      || rawMigrationSource.includes("\0")
      || rawMigrationSource.split(/[\\/]/).includes("..")
    )
  ) {
    throw new SddError("Cannot update with an invalid migration source path.", {
      code: "INVALID_CONFIG",
      details: ["migration.sourceWorkspace must be a non-empty path without NUL bytes or parent traversal."],
    });
  }
  const { workspaceRoot } = operation;
  const validatedOperationConfig = isSupportedLegacyConfig(operation.config)
    ? migrateConfig(operation.config, workspaceRoot).config
    : operation.config;
  assertValidConfig(validatedOperationConfig, "update the SDD installation");
  if (operation.config.kind === "user" && resolve(workspaceRoot) !== resolve(getUserRoot())) {
    throw new SddError(
      `User SDD configuration outside the canonical user root is not trusted: ${workspaceRoot}`,
      {
        code: "UNSAFE_CONFIG_PATH",
        details: [`Canonical user root: ${resolve(getUserRoot())}`],
      },
    );
  }
  const configuredMigrationSource = operation.config.kind === "user"
    && operation.config.migration?.sourceWorkspace
    ? resolveWorkspacePath(workspaceRoot, operation.config.migration.sourceWorkspace)
    : null;
  const discoveredMigrationSource = resolve(operation.sourceWorkspaceRoot) !== resolve(workspaceRoot)
    && isSupportedLegacyConfig(operation.sourceConfig)
    ? operation.sourceWorkspaceRoot
    : null;
  const migrationSourceRoot = configuredMigrationSource ?? discoveredMigrationSource;
  const options = { force, dryRun, migrationOptions, migrationSourceRoot };
  if (dryRun) return updateWorkspaceUnlocked(workspaceRoot, options);
  const lockRoots = [...new Set([
    workspaceRoot,
    getUserRoot(),
    ...(migrationSourceRoot ? [resolve(migrationSourceRoot)] : []),
  ])].sort((left, right) => left.localeCompare(right));
  const runWithLocks = (index) => (
    index === lockRoots.length
      ? updateWorkspaceUnlocked(workspaceRoot, options)
      : withWorkspaceMutationLock(lockRoots[index], () => runWithLocks(index + 1))
  );
  return runWithLocks(0);
}

async function updateWorkspaceUnlocked(
  workspaceRoot,
  { force, dryRun, migrationOptions, migrationSourceRoot },
) {
  await recoverUpdateMigration(workspaceRoot, { dryRun });
  const rawConfig = await readConfig(workspaceRoot);
  const migrationPlan = await planUpdateMigration(
    workspaceRoot,
    rawConfig,
    { legacyWorkspaceRoot: migrationSourceRoot },
  );
  const config = migrationPlan.config;
  const skillPlan = await planSkillSync(workspaceRoot, config, { force });
  const workflowPlan = config.kind === "user"
    ? null
    : await planWorkflowSync(workspaceRoot, { force });
  let migrationTransaction = null;
  let applied;
  try {
    applied = await applyManagedInstallation(workspaceRoot, {
      skillPlan,
      workflowPlan,
      dryRun,
      beforeLockCommit: async () => {
        migrationTransaction = await applyUpdateMigration(migrationPlan, migrationOptions);
      },
      onFailure: async () => {
        const transaction = migrationTransaction;
        migrationTransaction = null;
        await transaction?.rollback();
      },
    });
  } catch (error) {
    if (migrationTransaction) {
      await migrationTransaction.finalize();
      migrationTransaction = null;
    }
    throw error;
  }
  await migrationTransaction?.finalize();
  const workflow = applied.workflow ?? { path: WORKFLOW_SOURCE_PATH, action: "bundled" };
  const { skills } = applied;
  return {
    command: "update",
    mode: config.kind === "user" ? "user" : "legacy-workspace",
    workspaceRoot,
    dryRun,
    migration: migrationPlan.result,
    workflow,
    skills,
  };
}
