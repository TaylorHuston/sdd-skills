import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { assertValidChangeId } from "../change-id.js";
import {
  assertChangeStoreConfinement,
  getActiveChangePath,
  getClosedChangePath,
  relativeChangeStorePath,
} from "../change-store.js";
import { repositoriesForMetadata, resolveRepositoryTargets } from "../change-repositories.js";
import {
  CHANGE_STATUSES,
  canTransitionChangeStatus,
  parseChangeMetadata,
  replaceChangeStatus,
} from "../change-status.js";
import { assertValidConfig, getUserRoot, resolveWorkspaceStatus } from "../config.js";
import { resolveOperationConfiguration } from "../workspace.js";
import { SddError } from "../errors.js";
import { isDirectory, pathExists } from "../fs.js";
import { withWorkspaceMutationLock } from "../mutation.js";

const CENTRAL_CHANGE_LOCK = Symbol("central-change-lock");

function assertTransition(from, to) {
  if (!CHANGE_STATUSES.includes(from) || !CHANGE_STATUSES.includes(to)) {
    throw new SddError("Change transition requires valid --from and --to statuses.", {
      code: "INVALID_CHANGE_TRANSITION",
      details: [`Expected one of: ${CHANGE_STATUSES.join(", ")}`],
    });
  }
  if (!canTransitionChangeStatus(from, to)) {
    throw new SddError(`Change status cannot transition from ${from} to ${to}.`, {
      code: "INVALID_CHANGE_TRANSITION",
      details: [
        "Allowed transitions follow proposed -> planned -> in_progress -> in_review,",
        "with planning invalidation returning to proposed and review remediation returning to in_progress.",
      ],
    });
  }
}

export async function transitionChange(
  startPath,
  spaceId,
  changeId,
  {
    from,
    to,
    dryRun = false,
    beforeCommit = null,
    userRoot = null,
    lockToken = null,
  } = {},
) {
  assertValidChangeId(changeId);
  assertTransition(from, to);
  userRoot ??= getUserRoot();
  if (!dryRun && lockToken !== CENTRAL_CHANGE_LOCK) {
    return withWorkspaceMutationLock(userRoot, () => transitionChange(startPath, spaceId, changeId, {
      from,
      to,
      dryRun,
      beforeCommit,
      userRoot,
      lockToken: CENTRAL_CHANGE_LOCK,
    }));
  }
  const { workspaceRoot, config } = await resolveOperationConfiguration(startPath, { userRoot });
  assertValidConfig(config, "transition a Change");
  const space = config.ideas[spaceId];
  if (!space) {
    throw new SddError(`Unknown Space ID: ${spaceId}`, {
      code: "SPACE_NOT_FOUND",
      details: Object.keys(config.ideas).sort().map((id) => `Available Space ID: ${id}`),
    });
  }
  if (resolveWorkspaceStatus(space.status) !== "active") {
    throw new SddError(`Space ${spaceId} is not active. Update its .sdd status before transitioning work.`, {
      code: "SPACE_NOT_ACTIVE",
    });
  }

  const changePath = getActiveChangePath(changeId, userRoot);
  const closedPath = getClosedChangePath(changeId, userRoot);
  await assertChangeStoreConfinement(changePath, userRoot);
  await assertChangeStoreConfinement(closedPath, userRoot);
  const displayPath = relativeChangeStorePath(changePath, userRoot);
  if (await pathExists(closedPath)) {
    throw new SddError(`Change ID exists in closed history: ${changeId}`, {
      code: await isDirectory(changePath) ? "CHANGE_LOCATION_COLLISION" : "CHANGE_ALREADY_CLOSED",
    });
  }
  if (!(await isDirectory(changePath))) {
    throw new SddError(`Active Change does not exist: ${displayPath}`, { code: "CHANGE_NOT_FOUND" });
  }
  const tasksAbsolutePath = join(changePath, "tasks.md");
  const tasksPath = relativeChangeStorePath(tasksAbsolutePath, userRoot);
  if (!(await pathExists(tasksAbsolutePath))) {
    throw new SddError(`Active Change is missing tasks.md: ${displayPath}`, {
      code: "INCOMPLETE_CHANGE",
    });
  }

  const source = await readFile(tasksAbsolutePath, "utf8");
  const metadata = parseChangeMetadata(source);
  if (metadata.error) {
    throw new SddError(`Cannot parse Change metadata in ${tasksPath}: ${metadata.error}`, {
      code: "INVALID_CHANGE_METADATA",
    });
  }
  if (metadata.space !== spaceId) {
    throw new SddError(`Change belongs to Space ${metadata.space}, not ${spaceId}.`, {
      code: "CHANGE_SPACE_MISMATCH",
    });
  }
  const available = await resolveRepositoryTargets(workspaceRoot, config, space);
  const selectedRepositories = repositoriesForMetadata(available, metadata.repositories);
  if (metadata.status !== from) {
    throw new SddError(`Change status no longer matches --from ${from}: ${tasksPath}`, {
      code: "CHANGE_STATUS_MISMATCH",
      details: [`Current status: ${metadata.status}`],
    });
  }
  const updatedSource = replaceChangeStatus(source, to);
  if (updatedSource === null) {
    throw new SddError(`Change must contain exactly one status field in ${tasksPath}.`, {
      code: "INVALID_CHANGE_STATUS",
    });
  }

  if (!dryRun) {
    const nonce = `${process.pid}-${Date.now()}`;
    const temporaryPath = join(dirname(tasksAbsolutePath), `.tasks.md.sdd-transition-${nonce}`);
    const backupPath = join(dirname(tasksAbsolutePath), `.tasks.md.sdd-backup-${nonce}`);
    await writeFile(temporaryPath, updatedSource, "utf8");
    let committed = false;
    try {
      if (beforeCommit) await beforeCommit({ tasksPath: tasksAbsolutePath, temporaryPath, backupPath });
      await assertChangeStoreConfinement(tasksAbsolutePath, userRoot);
      if (await pathExists(closedPath)) {
        throw new SddError(`Change moved to closed history during transition: ${changeId}`, {
          code: "CONCURRENT_CHANGE",
        });
      }
      await rename(tasksAbsolutePath, backupPath);
      const commitSource = await readFile(backupPath, "utf8");
      if (commitSource !== source) {
        await rename(backupPath, tasksAbsolutePath);
        throw new SddError(`Change changed during transition: ${tasksPath}`, {
          code: "CONCURRENT_CHANGE",
        });
      }
      try {
        await rename(temporaryPath, tasksAbsolutePath);
        committed = true;
      } catch (error) {
        await rename(backupPath, tasksAbsolutePath);
        throw error;
      }
    } catch (error) {
      if (committed && await pathExists(tasksAbsolutePath)) {
        const currentSource = await readFile(tasksAbsolutePath, "utf8");
        if (currentSource === updatedSource) {
          await rm(tasksAbsolutePath, { force: true });
          await rename(backupPath, tasksAbsolutePath);
        } else {
          throw new SddError("Change transition failed and recovery was incomplete.", {
            code: "MUTATION_RECOVERY_FAILED",
            details: [`Original error: ${error.message}`, `${tasksPath}: newer content preserved; original retained at ${backupPath}.`],
          });
        }
      }
      throw error;
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => {});
      if (await pathExists(tasksAbsolutePath) && await pathExists(backupPath)) {
        await rm(backupPath, { force: true }).catch(() => {});
      }
    }
  }

  return {
    command: "change-transition",
    workspaceRoot,
    userRoot,
    dryRun,
    spaceId,
    changeId,
    from,
    to,
    path: displayPath,
    tasksPath,
    repositories: selectedRepositories,
  };
}
