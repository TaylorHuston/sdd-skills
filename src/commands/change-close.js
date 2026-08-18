import { mkdir, rename } from "node:fs/promises";

import { assertValidChangeId } from "../change-id.js";
import {
  assertChangeStoreConfinement,
  assertRequiredChangeFileSnapshotCurrent,
  getActiveChangePath,
  getClosedChangePath,
  getClosedChangesRoot,
  readRequiredChangeFileSnapshot,
  relativeChangeStorePath,
} from "../change-store.js";
import {
  assertSelectedRepositorySnapshotsCurrent,
  resolveRepositoriesForMetadata,
} from "../change-repositories.js";
import { CHANGE_SCHEMA_V2, parseChangeMetadata } from "../change-status.js";
import { assertValidConfig, resolveWorkspaceStatus } from "../config.js";
import { SddError } from "../errors.js";
import { isDirectory, pathExists } from "../fs.js";
import { withWorkspaceMutationLock } from "../mutation.js";
import {
  assertOperationConfigurationCurrent,
  resolveOperationConfiguration,
} from "../workspace.js";

export async function closeChange(
  startPath,
  spaceId,
  changeId,
  {
    dryRun = false,
    beforeCommit = null,
    workspaceRoot: requestedWorkspaceRoot = null,
    lockToken = null,
  } = {},
) {
  assertValidChangeId(changeId);
  const operation = await resolveOperationConfiguration(
    startPath,
    requestedWorkspaceRoot ? { workspaceRoot: requestedWorkspaceRoot } : {},
  );
  const { workspaceRoot, config } = operation;
  if (!dryRun && lockToken === null) {
    return withWorkspaceMutationLock(workspaceRoot, (mutationLock) =>
      closeChange(startPath, spaceId, changeId, {
        dryRun,
        beforeCommit,
        workspaceRoot,
        lockToken: mutationLock,
      }));
  }

  assertValidConfig(config, "close a Change");
  const space = config.ideas[spaceId];
  if (!space) {
    throw new SddError(`Unknown Space ID: ${spaceId}`, {
      code: "SPACE_NOT_FOUND",
    });
  }
  if (resolveWorkspaceStatus(space.status) !== "active") {
    throw new SddError(`Space ${spaceId} is not active.`, {
      code: "SPACE_NOT_ACTIVE",
    });
  }

  const sourceAbsolutePath = getActiveChangePath(changeId, workspaceRoot);
  const destinationAbsolutePath = getClosedChangePath(changeId, workspaceRoot);
  const sourcePath = relativeChangeStorePath(sourceAbsolutePath, workspaceRoot);
  const destinationPath = relativeChangeStorePath(destinationAbsolutePath, workspaceRoot);
  await assertChangeStoreConfinement(sourceAbsolutePath, workspaceRoot);
  await assertChangeStoreConfinement(destinationAbsolutePath, workspaceRoot);

  if (await pathExists(destinationAbsolutePath)) {
    throw new SddError(`Closed Change already exists: ${destinationPath}`, {
      code: await isDirectory(sourceAbsolutePath)
        ? "CHANGE_LOCATION_COLLISION"
        : "CHANGE_ALREADY_CLOSED",
    });
  }
  if (!(await isDirectory(sourceAbsolutePath))) {
    throw new SddError(`Active Change does not exist: ${sourcePath}`, {
      code: "CHANGE_NOT_FOUND",
    });
  }

  const snapshot = await readRequiredChangeFileSnapshot(
    sourceAbsolutePath,
    "change.md",
    workspaceRoot,
  );
  if (snapshot === null) {
    throw new SddError(`Active Change is missing change.md: ${sourcePath}`, {
      code: "INCOMPLETE_CHANGE",
    });
  }
  const metadata = parseChangeMetadata(snapshot.source);
  if (metadata.error) {
    throw new SddError(`Cannot parse Change metadata in ${sourcePath}/change.md: ${metadata.error}`, {
      code: "INVALID_CHANGE_METADATA",
    });
  }
  if (metadata.schema !== CHANGE_SCHEMA_V2) {
    throw new SddError("Current Change closeout requires schema: sdd-change-v2; schema-less Changes are unsupported history.", {
      code: "UNSUPPORTED_CHANGE_SCHEMA",
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
  const selectedRepositories = await resolveRepositoriesForMetadata(
    workspaceRoot,
    config,
    space,
    metadata.repositories,
  );

  if (!dryRun) {
    await beforeCommit?.({
      sourcePath: sourceAbsolutePath,
      destinationPath: destinationAbsolutePath,
    });
    await assertOperationConfigurationCurrent(operation);
    await assertSelectedRepositorySnapshotsCurrent(
      workspaceRoot,
      config,
      space,
      selectedRepositories,
    );
    await assertRequiredChangeFileSnapshotCurrent(
      sourceAbsolutePath,
      "change.md",
      workspaceRoot,
      snapshot,
    );
    if (await pathExists(destinationAbsolutePath)) {
      throw new SddError(`Closed Change appeared before close: ${destinationPath}`, {
        code: "CONCURRENT_CHANGE",
      });
    }
    await mkdir(getClosedChangesRoot(workspaceRoot), { recursive: true });
    try {
      await rename(sourceAbsolutePath, destinationAbsolutePath);
    } catch (error) {
      if (["EEXIST", "ENOTEMPTY"].includes(error?.code)) {
        throw new SddError(`Closed Change appeared during close: ${destinationPath}`, {
          code: "CONCURRENT_CHANGE",
        });
      }
      throw error;
    }
  }

  return {
    command: "change-close",
    workspaceRoot,
    dryRun,
    spaceId,
    changeId,
    sourcePath,
    path: destinationPath,
    repositories: selectedRepositories,
  };
}
