import { mkdir, readFile, rename } from "node:fs/promises";

import { assertValidChangeId } from "../change-id.js";
import {
  assertChangeStoreConfinement,
  getActiveChangePath,
  getClosedChangePath,
  getClosedChangesRoot,
  relativeChangeStorePath,
} from "../change-store.js";
import { repositoriesForMetadata, resolveRepositoryTargets } from "../change-repositories.js";
import { parseChangeMetadata } from "../change-status.js";
import { assertValidConfig, getUserRoot, resolveWorkspaceStatus } from "../config.js";
import { resolveOperationConfiguration } from "../workspace.js";
import { SddError } from "../errors.js";
import { isDirectory, pathExists } from "../fs.js";
import { withWorkspaceMutationLock } from "../mutation.js";

const CENTRAL_CHANGE_LOCK = Symbol("central-change-lock");

export async function closeChange(
  startPath,
  spaceId,
  changeId,
  {
    dryRun = false,
    beforeCommit = null,
    userRoot = null,
    lockToken = null,
  } = {},
) {
  assertValidChangeId(changeId);
  userRoot ??= getUserRoot();
  if (!dryRun && lockToken !== CENTRAL_CHANGE_LOCK) {
    return withWorkspaceMutationLock(userRoot, () => closeChange(startPath, spaceId, changeId, {
      dryRun,
      beforeCommit,
      userRoot,
      lockToken: CENTRAL_CHANGE_LOCK,
    }));
  }
  const { workspaceRoot, config } = await resolveOperationConfiguration(startPath, { userRoot });
  assertValidConfig(config, "close a Change");
  const space = config.ideas[spaceId];
  if (!space) {
    throw new SddError(`Unknown Space ID: ${spaceId}`, {
      code: "SPACE_NOT_FOUND",
      details: Object.keys(config.ideas).sort().map((id) => `Available Space ID: ${id}`),
    });
  }
  if (resolveWorkspaceStatus(space.status) !== "active") {
    throw new SddError(`Space ${spaceId} is not active. Update its .sdd status before closing work.`, {
      code: "SPACE_NOT_ACTIVE",
    });
  }

  const sourceAbsolutePath = getActiveChangePath(changeId, userRoot);
  const destinationAbsolutePath = getClosedChangePath(changeId, userRoot);
  await assertChangeStoreConfinement(sourceAbsolutePath, userRoot);
  await assertChangeStoreConfinement(destinationAbsolutePath, userRoot);
  const sourcePath = relativeChangeStorePath(sourceAbsolutePath, userRoot);
  const destinationPath = relativeChangeStorePath(destinationAbsolutePath, userRoot);
  if (await pathExists(destinationAbsolutePath)) {
    throw new SddError(`Closed Change already exists: ${destinationPath}`, {
      code: await isDirectory(sourceAbsolutePath) ? "CHANGE_LOCATION_COLLISION" : "CHANGE_ALREADY_CLOSED",
    });
  }
  if (!(await isDirectory(sourceAbsolutePath))) {
    throw new SddError(`Active Change does not exist: ${sourcePath}`, { code: "CHANGE_NOT_FOUND" });
  }
  const tasksPath = `${sourcePath}/tasks.md`;
  const tasksAbsolutePath = `${sourceAbsolutePath}/tasks.md`;
  if (!(await pathExists(tasksAbsolutePath))) {
    throw new SddError(`Active Change is missing tasks.md: ${sourcePath}`, {
      code: "INCOMPLETE_CHANGE",
    });
  }
  const tasksSource = await readFile(tasksAbsolutePath, "utf8");
  const metadata = parseChangeMetadata(tasksSource);
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
  if (metadata.status !== "in_review") {
    throw new SddError("Only a Change with status in_review can be closed.", {
      code: "CHANGE_NOT_IN_REVIEW",
      details: [`Current status: ${metadata.status}`],
    });
  }
  const available = await resolveRepositoryTargets(workspaceRoot, config, space);
  const selectedRepositories = repositoriesForMetadata(available, metadata.repositories);

  if (!dryRun) {
    if (beforeCommit) {
      await beforeCommit({ sourcePath: sourceAbsolutePath, destinationPath: destinationAbsolutePath });
    }
    await assertChangeStoreConfinement(sourceAbsolutePath, userRoot);
    await assertChangeStoreConfinement(destinationAbsolutePath, userRoot);
    if (await readFile(tasksAbsolutePath, "utf8") !== tasksSource) {
      throw new SddError(`Change changed during close: ${sourcePath}`, {
        code: "CONCURRENT_CHANGE",
      });
    }
    await mkdir(getClosedChangesRoot(userRoot), { recursive: true });
    if (await pathExists(destinationAbsolutePath)) {
      throw new SddError(`Closed Change appeared during close: ${destinationPath}`, {
        code: "CONCURRENT_CHANGE",
      });
    }
    await rename(sourceAbsolutePath, destinationAbsolutePath);
    try {
      if (await readFile(`${destinationAbsolutePath}/tasks.md`, "utf8") !== tasksSource) {
        throw new SddError(`Change changed during close: ${sourcePath}`, {
          code: "CONCURRENT_CHANGE",
        });
      }
    } catch (error) {
      if (!(await pathExists(sourceAbsolutePath))) {
        await rename(destinationAbsolutePath, sourceAbsolutePath);
      }
      throw error;
    }
  }

  return {
    command: "change-close",
    workspaceRoot,
    userRoot,
    dryRun,
    spaceId,
    changeId,
    sourcePath,
    path: destinationPath,
    repositories: selectedRepositories,
  };
}
