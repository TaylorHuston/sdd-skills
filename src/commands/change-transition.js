import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { assertValidChangeId } from "../change-id.js";
import { resolvedActiveRepositories, selectRepositories } from "../change-repositories.js";
import {
  CHANGE_STATUSES,
  canTransitionChangeStatus,
  parseChangeStatus,
  replaceChangeStatus,
} from "../change-status.js";
import {
  assertValidConfig,
  findWorkspaceRoot,
  readConfig,
  resolveWorkspacePath,
  resolveWorkspaceStatus,
} from "../config.js";
import { SddError } from "../errors.js";
import { isDirectory, pathExists } from "../fs.js";

function normalizePath(value) {
  return value.split("\\").join("/");
}

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
  { repositories = [], from, to, dryRun = false } = {},
) {
  assertValidChangeId(changeId);
  assertTransition(from, to);
  const workspaceRoot = await findWorkspaceRoot(startPath);
  const config = await readConfig(workspaceRoot);
  assertValidConfig(config, "transition a Change");
  const space = config.ideas[spaceId];
  if (!space) {
    throw new SddError(`Unknown Space ID: ${spaceId}`, {
      code: "SPACE_NOT_FOUND",
      details: Object.keys(config.ideas).sort().map((id) => `Available Space ID: ${id}`),
    });
  }
  if (resolveWorkspaceStatus(space.status) !== "active") {
    throw new SddError(
      `Space ${spaceId} is not active. Update its .sdd status before transitioning work.`,
      { code: "SPACE_NOT_ACTIVE" },
    );
  }

  const selected = selectRepositories(
    resolvedActiveRepositories(config, space),
    repositories,
    { allowNone: false },
  );
  const transitions = [];
  for (const repository of selected) {
    const repositoryPath = resolveWorkspacePath(workspaceRoot, repository.resolvedPath);
    if (!(await isDirectory(repositoryPath))) {
      throw new SddError(`Configured repository does not exist: ${repository.resolvedPath}`, {
        code: "REPOSITORY_NOT_FOUND",
      });
    }

    const changeRelativePath = normalizePath(
      join(config.repositoryArtifacts.activeChanges, changeId),
    );
    const changeAbsolutePath = join(repositoryPath, changeRelativePath);
    const changePath = normalizePath(join(repository.resolvedPath, changeRelativePath));
    const tasksAbsolutePath = join(changeAbsolutePath, "tasks.md");
    const tasksPath = normalizePath(join(changePath, "tasks.md"));

    if (!(await isDirectory(changeAbsolutePath))) {
      throw new SddError(`Active Change does not exist: ${changePath}`, {
        code: "CHANGE_NOT_FOUND",
      });
    }
    if (!(await pathExists(tasksAbsolutePath))) {
      throw new SddError(`Active Change is missing tasks.md: ${changePath}`, {
        code: "INCOMPLETE_CHANGE",
      });
    }

    const source = await readFile(tasksAbsolutePath, "utf8");
    const parsed = parseChangeStatus(source);
    if (parsed.error) {
      throw new SddError(`Cannot parse Change status in ${tasksPath}: ${parsed.error}`, {
        code: "INVALID_CHANGE_STATUS",
      });
    }
    if (parsed.status !== from) {
      throw new SddError(`Change status no longer matches --from ${from}: ${tasksPath}`, {
        code: "CHANGE_STATUS_MISMATCH",
        details: [`Current status: ${parsed.status ?? "missing"}`],
      });
    }
    const updatedSource = replaceChangeStatus(source, to);
    if (updatedSource == null) {
      throw new SddError(`Change must contain exactly one status field in ${tasksPath}.`, {
        code: "INVALID_CHANGE_STATUS",
      });
    }
    transitions.push({
      ...repository,
      path: changePath,
      tasksPath,
      tasksAbsolutePath,
      source,
      updatedSource,
      from,
      to,
    });
  }

  if (!dryRun) {
    const nonce = `${process.pid}-${Date.now()}`;
    const staged = [];
    const committed = [];
    try {
      for (const transition of transitions) {
        const temporaryPath = join(
          dirname(transition.tasksAbsolutePath),
          `.tasks.md.sdd-transition-${nonce}`,
        );
        const backupPath = join(
          dirname(transition.tasksAbsolutePath),
          `.tasks.md.sdd-backup-${nonce}`,
        );
        await writeFile(temporaryPath, transition.updatedSource, "utf8");
        staged.push({ ...transition, temporaryPath, backupPath });
      }
      for (const transition of staged) {
        await rename(transition.tasksAbsolutePath, transition.backupPath);
        try {
          await rename(transition.temporaryPath, transition.tasksAbsolutePath);
          committed.push(transition);
        } catch (error) {
          await rename(transition.backupPath, transition.tasksAbsolutePath);
          throw error;
        }
      }
    } catch (error) {
      for (const transition of committed.reverse()) {
        await rm(transition.tasksAbsolutePath, { force: true });
        await rename(transition.backupPath, transition.tasksAbsolutePath).catch(() => {});
      }
      throw error;
    } finally {
      for (const transition of staged) {
        await rm(transition.temporaryPath, { force: true }).catch(() => {});
        if (await pathExists(transition.tasksAbsolutePath)) {
          await rm(transition.backupPath, { force: true }).catch(() => {});
        }
      }
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
    repositories: transitions.map(
      ({ tasksAbsolutePath, source, updatedSource, ...transition }) => transition,
    ),
  };
}
