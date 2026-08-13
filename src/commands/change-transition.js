import { rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { assertValidChangeId } from "../change-id.js";
import { formatStructuredTaskIssues, parseStructuredChangeTasks } from "../change-tasks.js";
import {
  assertChangeStoreConfinement,
  assertRequiredChangeFileSnapshotCurrent,
  getActiveChangePath,
  getClosedChangePath,
  missingCompatibleDesignSections,
  missingPlannedChangeSections,
  readRequiredChangeFileSnapshot,
  relativeChangeStorePath,
} from "../change-store.js";
import {
  assertSelectedRepositorySnapshotsCurrent,
  resolveRepositoriesForMetadata,
} from "../change-repositories.js";
import {
  CHANGE_STATUSES,
  canTransitionChangeStatus,
  parseChangeMetadata,
  replaceChangeStatus,
} from "../change-status.js";
import { assertValidConfig, resolveWorkspaceStatus } from "../config.js";
import { SddError } from "../errors.js";
import { isDirectory, pathExists } from "../fs.js";
import { withWorkspaceMutationLock } from "../mutation.js";
import {
  assertOperationConfigurationCurrent,
  resolveOperationConfiguration,
} from "../workspace.js";

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
    });
  }
}

async function assertPlanningComplete(changePath, workspaceRoot, metadata, changeSource, changeId) {
  const tasks = await readRequiredChangeFileSnapshot(
    changePath,
    "tasks.md",
    workspaceRoot,
  );
  const existingDesign = await readRequiredChangeFileSnapshot(
    changePath,
    "design.md",
    workspaceRoot,
  );
  const missing = tasks === null ? ["tasks.md"] : [];
  const missingSections = existingDesign === null
    ? missingPlannedChangeSections(changeSource)
    : missingCompatibleDesignSections(existingDesign.source);
  const taskIssues = tasks === null
    ? []
    : parseStructuredChangeTasks(tasks.source, {
        changeId,
        repositoryIds: metadata.repositories,
      }).issues;
  if (missing.length > 0 || missingSections.length > 0 || taskIssues.length > 0) {
    const planningFile = existingDesign === null ? "change.md" : "design.md";
    const details = [
      ...missing,
      ...missingSections.map((section) => `${planningFile}: ${section}`),
      ...formatStructuredTaskIssues(taskIssues).map((detail) => `tasks.md: ${detail}`),
    ];
    throw new SddError(
      `Planning is incomplete: ${details.join("; ")}.`,
      { code: "INCOMPLETE_CHANGE", details },
    );
  }
  if (metadata.repositories.length === 0) {
    throw new SddError(
      "A Change must select at least one repository before it becomes planned.",
      { code: "REPOSITORY_REQUIRED" },
    );
  }
  return { tasks, existingDesign };
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
    workspaceRoot: requestedWorkspaceRoot = null,
    lockToken = null,
  } = {},
) {
  assertValidChangeId(changeId);
  assertTransition(from, to);
  const operation = await resolveOperationConfiguration(
    startPath,
    requestedWorkspaceRoot ? { workspaceRoot: requestedWorkspaceRoot } : {},
  );
  const { workspaceRoot, config } = operation;
  if (!dryRun && lockToken === null) {
    return withWorkspaceMutationLock(workspaceRoot, (mutationLock) =>
      transitionChange(startPath, spaceId, changeId, {
        from,
        to,
        dryRun,
        beforeCommit,
        workspaceRoot,
        lockToken: mutationLock,
      }));
  }

  assertValidConfig(config, "transition a Change");
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

  const activePath = getActiveChangePath(changeId, workspaceRoot);
  const closedPath = getClosedChangePath(changeId, workspaceRoot);
  if (await pathExists(closedPath)) {
    throw new SddError(`Change ID exists in closed history: ${changeId}`, {
      code: await isDirectory(activePath)
        ? "CHANGE_LOCATION_COLLISION"
        : "CHANGE_ALREADY_CLOSED",
    });
  }
  if (!(await isDirectory(activePath))) {
    throw new SddError(`Active Change does not exist: ${changeId}`, {
      code: "CHANGE_NOT_FOUND",
    });
  }

  const snapshot = await readRequiredChangeFileSnapshot(
    activePath,
    "change.md",
    workspaceRoot,
  );
  if (snapshot === null) {
    throw new SddError(`Active Change is missing change.md: ${changeId}`, {
      code: "INCOMPLETE_CHANGE",
    });
  }
  const metadata = parseChangeMetadata(snapshot.source);
  const changeFilePath = relativeChangeStorePath(
    join(activePath, "change.md"),
    workspaceRoot,
  );
  if (metadata.error) {
    throw new SddError(
      `Cannot parse Change metadata in ${changeFilePath}: ${metadata.error}`,
      { code: "INVALID_CHANGE_METADATA" },
    );
  }
  if (metadata.space !== spaceId) {
    throw new SddError(`Change belongs to Space ${metadata.space}, not ${spaceId}.`, {
      code: "CHANGE_SPACE_MISMATCH",
    });
  }
  if (metadata.status !== from) {
    throw new SddError(`Change status no longer matches --from ${from}.`, {
      code: "CHANGE_STATUS_MISMATCH",
      details: [`Current status: ${metadata.status}`],
    });
  }
  const planningSnapshots = from === "proposed" && to === "planned"
    ? await assertPlanningComplete(activePath, workspaceRoot, metadata, snapshot.source, changeId)
    : null;

  const selectedRepositories = await resolveRepositoriesForMetadata(
    workspaceRoot,
    config,
    space,
    metadata.repositories,
  );
  const updatedSource = replaceChangeStatus(snapshot.source, to);
  if (updatedSource === null) {
    throw new SddError(`Change must contain exactly one status field in ${changeFilePath}.`, {
      code: "INVALID_CHANGE_STATUS",
    });
  }

  if (!dryRun) {
    await beforeCommit?.({
      changePath: activePath,
      changeFilePath: join(activePath, "change.md"),
    });
    await assertOperationConfigurationCurrent(operation);
    await assertSelectedRepositorySnapshotsCurrent(
      workspaceRoot,
      config,
      space,
      selectedRepositories,
    );
    await assertRequiredChangeFileSnapshotCurrent(
      activePath,
      "change.md",
      workspaceRoot,
      snapshot,
    );
    if (planningSnapshots) {
      await assertRequiredChangeFileSnapshotCurrent(
        activePath,
        "tasks.md",
        workspaceRoot,
        planningSnapshots.tasks,
      );
      if (planningSnapshots.existingDesign) {
        await assertRequiredChangeFileSnapshotCurrent(
          activePath,
          "design.md",
          workspaceRoot,
          planningSnapshots.existingDesign,
        );
      } else if (await readRequiredChangeFileSnapshot(
        activePath,
        "design.md",
        workspaceRoot,
      ) !== null) {
        throw new SddError(
          `Change design.md appeared after planning was validated: ${changeId}`,
          { code: "CONCURRENT_CHANGE" },
        );
      }
    }
    if (await pathExists(closedPath)) {
      throw new SddError(`Change moved to closed history: ${changeId}`, {
        code: "CONCURRENT_CHANGE",
      });
    }

    const temporaryPath = join(
      dirname(join(activePath, "change.md")),
      `.change.md.sdd-transition-${process.pid}-${Date.now()}`,
    );
    await assertChangeStoreConfinement(temporaryPath, workspaceRoot);
    try {
      await writeFile(temporaryPath, updatedSource, {
        flag: "wx",
        mode: snapshot.mode,
      });
      await rename(temporaryPath, join(activePath, "change.md"));
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  return {
    command: "change-transition",
    workspaceRoot,
    dryRun,
    spaceId,
    changeId,
    from,
    to,
    path: relativeChangeStorePath(activePath, workspaceRoot),
    changeFilePath,
    repositories: selectedRepositories,
  };
}
