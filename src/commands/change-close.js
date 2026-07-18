import { mkdir, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

import { assertValidChangeId } from "../change-id.js";
import { resolvedActiveRepositories, selectRepositories } from "../change-repositories.js";
import { parseChangeStatus } from "../change-status.js";
import {
  assertValidConfig,
  resolveRepositoryArtifacts,
  resolveWorkspacePath,
  resolveWorkspaceStatus,
} from "../config.js";
import { resolveOperationConfiguration } from "../workspace.js";
import { SddError } from "../errors.js";
import { isDirectory, pathExists } from "../fs.js";

function normalizePath(value) {
  return value.split("\\").join("/");
}

async function assertInReview(sourcePath, displayPath) {
  const tasksPath = join(sourcePath, "tasks.md");
  if (!(await pathExists(tasksPath))) {
    throw new SddError(`Active Change is missing tasks.md: ${displayPath}`, {
      code: "INCOMPLETE_CHANGE",
    });
  }

  const { status, error } = parseChangeStatus(await readFile(tasksPath, "utf8"));
  if (error) {
    throw new SddError(`Cannot parse Change status in ${displayPath}/tasks.md: ${error}`, {
      code: "INVALID_CHANGE_STATUS",
    });
  }
  if (status !== "in_review") {
    throw new SddError("Only a Change with status in_review can be closed.", {
      code: "CHANGE_NOT_IN_REVIEW",
      details: [`Current status: ${status ?? "missing"}`],
    });
  }
}

export async function closeChange(
  startPath,
  spaceId,
  changeId,
  { repositories = [], dryRun = false } = {},
) {
  assertValidChangeId(changeId);
  const { workspaceRoot, config } = await resolveOperationConfiguration(startPath);
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

  const selected = selectRepositories(
    resolvedActiveRepositories(config, space),
    repositories,
    { allowNone: false },
  );
  const transitions = [];
  for (const repository of selected) {
    const artifacts = resolveRepositoryArtifacts(config, repository);
    const repositoryPath = resolveWorkspacePath(workspaceRoot, repository.resolvedPath);
    if (!(await isDirectory(repositoryPath))) {
      throw new SddError(`Configured repository does not exist: ${repository.resolvedPath}`, {
        code: "REPOSITORY_NOT_FOUND",
      });
    }

    const activePath = normalizePath(join(artifacts.activeChanges, changeId));
    const closedPath = normalizePath(join(artifacts.closedChanges, changeId));
    const sourceAbsolutePath = join(repositoryPath, activePath);
    const destinationAbsolutePath = join(repositoryPath, closedPath);
    const sourcePath = normalizePath(join(repository.resolvedPath, activePath));
    const destinationPath = normalizePath(join(repository.resolvedPath, closedPath));

    if (await pathExists(destinationAbsolutePath)) {
      throw new SddError(`Closed Change already exists: ${destinationPath}`, {
        code: "CHANGE_ALREADY_CLOSED",
      });
    }
    if (!(await isDirectory(sourceAbsolutePath))) {
      throw new SddError(`Active Change does not exist: ${sourcePath}`, {
        code: "CHANGE_NOT_FOUND",
      });
    }
    await assertInReview(sourceAbsolutePath, sourcePath);
    transitions.push({
      ...repository,
      sourcePath,
      path: destinationPath,
      sourceAbsolutePath,
      destinationAbsolutePath,
    });
  }

  if (!dryRun) {
    const moved = [];
    try {
      for (const transition of transitions) {
        await mkdir(dirname(transition.destinationAbsolutePath), { recursive: true });
        await rename(transition.sourceAbsolutePath, transition.destinationAbsolutePath);
        moved.push(transition);
      }
    } catch (error) {
      for (const transition of moved.reverse()) {
        await rename(transition.destinationAbsolutePath, transition.sourceAbsolutePath).catch(
          () => {},
        );
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
    repositories: transitions.map(
      ({ sourceAbsolutePath, destinationAbsolutePath, ...transition }) => transition,
    ),
  };
}
