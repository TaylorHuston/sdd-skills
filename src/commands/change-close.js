import { mkdir, rename } from "node:fs/promises";

import { assertValidChangeId } from "../change-id.js";
import {
  assertChangeStoreConfinement,
  assertRequiredChangeFileSnapshotCurrent,
  changeStoreEntryExists,
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
import { isDirectory } from "../fs.js";
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
    beforeMove = null,
    workspaceRoot: requestedWorkspaceRoot = null,
  } = {},
) {
  assertValidChangeId(changeId);
  const operation = await resolveOperationConfiguration(
    startPath,
    requestedWorkspaceRoot ? { workspaceRoot: requestedWorkspaceRoot } : {},
  );
  const { workspaceRoot, config } = operation;

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

  if (await changeStoreEntryExists(destinationAbsolutePath)) {
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
    const assertCloseCurrent = async () => {
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
      if (await changeStoreEntryExists(destinationAbsolutePath)) {
        throw new SddError(`Closed Change appeared before close: ${destinationPath}`, {
          code: "CONCURRENT_CHANGE",
        });
      }
    };

    await beforeCommit?.({
      sourcePath: sourceAbsolutePath,
      destinationPath: destinationAbsolutePath,
    });
    await assertCloseCurrent();
    const closedRoot = getClosedChangesRoot(workspaceRoot);
    await assertChangeStoreConfinement(closedRoot, workspaceRoot);
    await mkdir(closedRoot, { recursive: true });
    await assertChangeStoreConfinement(closedRoot, workspaceRoot);
    await beforeMove?.({
      sourcePath: sourceAbsolutePath,
      destinationPath: destinationAbsolutePath,
    });
    await assertCloseCurrent();

    try {
      await rename(sourceAbsolutePath, destinationAbsolutePath);
    } catch (error) {
      if (["EEXIST", "ENOTEMPTY", "ENOENT", "ENOTDIR"].includes(error?.code)) {
        throw new SddError(`Change moved or closed concurrently: ${destinationPath}`, {
          code: "CONCURRENT_CHANGE",
          details: [error.message],
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
