import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { parseDocument } from "yaml";

import {
  readStoredChangesSnapshot,
  readRequiredChangeFileSnapshot,
  relativeChangeStorePath,
} from "../change-store.js";
import { resolveRepositoryTargetsForStatus } from "../change-repositories.js";
import {
  CHANGE_STATUSES,
  LEGACY_CHANGE_STATUSES,
  isRepositoryOnlyChangeMetadata,
  parseChangeMetadata,
} from "../change-status.js";
import {
  assertValidConfig,
  relativeWorkspacePath,
  resolveIdeaPlanningPath,
  resolveRepositoryArtifacts,
  resolveWorkspaceStatus,
  resolveWorkspacePath,
} from "../config.js";
import {
  isMetadataOnlyRepositorySpace,
  resolveOperationConfiguration,
  synthesizeRepositoryOnlySpaceFromChangeMetadata,
} from "../workspace.js";
import { SddError } from "../errors.js";
import { isDirectory, pathExists } from "../fs.js";

const execFileAsync = promisify(execFile);

function changeDate(name) {
  return /^\d{4}-\d{2}-\d{2}(?=-|$)/.exec(name)?.[0] ?? null;
}

function compareRecent(left, right) {
  return (right.date ?? "").localeCompare(left.date ?? "")
    || right.changeId.localeCompare(left.changeId);
}

function parseFrontmatter(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return {};
  const document = parseDocument(match[1]);
  if (document.errors.length > 0) return {};
  const value = document.toJS();
  return value && typeof value === "object" ? value : {};
}

async function listDirectories(root) {
  if (!(await isDirectory(root))) return [];
  return (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export async function readGitStatus(
  repositoryRoot,
  { command = "git", timeoutMs = 10_000 } = {},
) {
  try {
    const { stdout } = await execFileAsync(
      command,
      ["-C", repositoryRoot, "status", "--porcelain=v2", "--branch", "--untracked-files=normal"],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, timeout: timeoutMs, killSignal: "SIGTERM" },
    );
    let branch = null;
    let head = null;
    let detached = false;
    let staged = 0;
    let unstaged = 0;
    let untracked = 0;
    let conflicted = 0;
    for (const line of stdout.split(/\r?\n/)) {
      if (line.startsWith("# branch.head ")) {
        const value = line.slice("# branch.head ".length);
        detached = value === "(detached)";
        branch = detached ? null : value;
      } else if (line.startsWith("# branch.oid ")) {
        const value = line.slice("# branch.oid ".length);
        head = value === "(initial)" ? null : value;
      } else if (line.startsWith("? ")) {
        untracked += 1;
      } else if (line.startsWith("u ")) {
        conflicted += 1;
      } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
        const state = line.split(" ", 3)[1] ?? "..";
        if (state[0] !== ".") staged += 1;
        if (state[1] !== ".") unstaged += 1;
      }
    }
    return {
      available: true,
      branch,
      head,
      detached,
      dirty: staged + unstaged + untracked + conflicted > 0,
      staged,
      unstaged,
      untracked,
      conflicted,
    };
  } catch (error) {
    const detail = typeof error?.stderr === "string" ? error.stderr : "";
    return {
      available: false,
      branch: null,
      head: null,
      detached: false,
      dirty: null,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      conflicted: 0,
      error: error?.killed || error?.signal === "SIGTERM"
        ? "Git status timed out"
        : detail.includes("not a git repository")
          ? "not a Git worktree"
          : "Git status unavailable",
    };
  }
}

async function readCentralChanges(
  workspaceRoot,
  {
    afterChangeFileRead = null,
    afterClosedChangeInventory = null,
    afterStoredChangesInventory = null,
  } = {},
) {
  return readStoredChangesSnapshot(
    workspaceRoot,
    async (records) => {
      const seen = new Set();
      const changes = [];
      for (const record of records) {
        if (seen.has(record.changeId)) {
          throw new SddError(`Change exists in both active and closed central locations: ${record.changeId}`, {
            code: "CHANGE_LOCATION_COLLISION",
          });
        }
        seen.add(record.changeId);
        const changeFilePath = join(record.path, "change.md");
        const changeSnapshot = await readRequiredChangeFileSnapshot(
          record.path,
          "change.md",
          workspaceRoot,
          {
            afterRead: afterChangeFileRead
              ? (observation) => afterChangeFileRead({
                  changeId: record.changeId,
                  closed: record.closed,
                  fileName: "change.md",
                  ...observation,
                })
              : null,
          },
        );
        if (changeSnapshot === null) {
          throw new SddError(`Change is missing change.md: ${relativeChangeStorePath(record.path, workspaceRoot)}`, {
            code: "INCOMPLETE_CHANGE",
          });
        }
        const metadata = parseChangeMetadata(changeSnapshot.source);
        if (metadata.error) {
          throw new SddError(
            `Cannot parse Change metadata in ${relativeChangeStorePath(changeFilePath, workspaceRoot)}: ${metadata.error}`,
            { code: "INVALID_CHANGE_METADATA" },
          );
        }
        const statusValid = CHANGE_STATUSES.includes(metadata.status)
          || (record.closed && LEGACY_CHANGE_STATUSES.includes(metadata.status));
        if (metadata.status !== "proposed") {
          const tasksSnapshot = await readRequiredChangeFileSnapshot(
            record.path,
            "tasks.md",
            workspaceRoot,
            {
              afterRead: afterChangeFileRead
                ? (observation) => afterChangeFileRead({
                    changeId: record.changeId,
                    closed: record.closed,
                    fileName: "tasks.md",
                    ...observation,
                  })
                : null,
            },
          );
          if (tasksSnapshot === null) {
            throw new SddError(
              `Change is missing tasks.md: ${relativeChangeStorePath(record.path, workspaceRoot)}`,
              { code: "INCOMPLETE_CHANGE" },
            );
          }
        }
        changes.push({
          changeId: record.changeId,
          date: changeDate(record.changeId),
          status: record.closed ? "closed" : statusValid ? metadata.status : "unknown",
          storedStatus: metadata.status,
          statusValid,
          statusError: null,
          closed: record.closed,
          path: relativeChangeStorePath(record.path, workspaceRoot),
          spaceId: metadata.space,
          repositories: [...metadata.repositories],
        });
      }
      return changes.sort(compareRecent);
    },
    {
      afterInventory: afterStoredChangesInventory,
      listOptions: {
        afterClosedInventory: afterClosedChangeInventory,
      },
    },
  );
}

async function readEpic(workspaceRoot, repository, epicPath) {
  const source = await readFile(epicPath, "utf8");
  const frontmatter = parseFrontmatter(source);
  const folder = basename(dirname(epicPath));
  const heading = /^#\s+(.+)$/m.exec(source)?.[1]?.trim() ?? folder;
  const id = typeof frontmatter.id === "string" && frontmatter.id ? frontmatter.id : folder;
  const title = heading.startsWith(`${id} `) ? heading.slice(id.length + 1) : heading;
  return {
    id,
    title,
    status: typeof frontmatter.status === "string" ? frontmatter.status : null,
    path: relativeWorkspacePath(workspaceRoot, epicPath),
    repository: repository.resolvedPath,
    repositoryId: repository.id,
    role: repository.role ?? null,
    repositoryStatus: repository.status,
  };
}

async function listEpics(workspaceRoot, config, repository) {
  const repositoryRoot = resolveWorkspacePath(workspaceRoot, repository.resolvedPath);
  const artifacts = resolveRepositoryArtifacts(config, repository);
  const epicsRoot = join(repositoryRoot, artifacts.epics);
  const epics = [];
  for (const directory of await listDirectories(epicsRoot)) {
    const epicPath = join(epicsRoot, directory, "epic.md");
    if (await pathExists(epicPath)) epics.push(await readEpic(workspaceRoot, repository, epicPath));
  }
  return epics;
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const run = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, run));
  return results;
}

async function buildSpace(
  workspaceRoot,
  config,
  spaceId,
  space,
  centralChanges,
  {
    detail = false,
    includeInactiveRepositories = true,
    gitCommand = "git",
    gitTimeoutMs = 10_000,
    gitConcurrency = 4,
  } = {},
) {
  const resolution = isMetadataOnlyRepositorySpace(space)
    ? { repositories: [], diagnostics: [] }
    : await resolveRepositoryTargetsForStatus(workspaceRoot, config, space);
  const resolved = resolution.repositories;
  const selectedRepositories = resolved
    .filter((repository) => includeInactiveRepositories || repository.status === "active");
  const repositories = await mapWithConcurrency(
    selectedRepositories,
    gitConcurrency,
    async (repository) => ({
      ...repository,
      git: await readGitStatus(resolveWorkspacePath(workspaceRoot, repository.resolvedPath), {
        command: gitCommand,
        timeoutMs: gitTimeoutMs,
      }),
    }),
  );
  const resolvedRepositoryIds = new Set(resolved.map((repository) => repository.id));
  const allSpaceChanges = centralChanges
    .filter((change) => change.spaceId === spaceId)
    .map((change) => ({
      ...change,
      unresolvedRepositoryIds: change.repositories
        .filter((repositoryId) => !resolvedRepositoryIds.has(repositoryId))
        .sort((left, right) => left.localeCompare(right)),
    }));
  const changes = allSpaceChanges;
  const unresolvedRepositoryIds = [...new Set(
    changes.flatMap((change) => change.unresolvedRepositoryIds),
  )].sort((left, right) => left.localeCompare(right));
  const activeChanges = changes.filter((change) => !change.closed);
  const closedChanges = changes.filter((change) => change.closed);
  const repositoryActivity = repositories.map((repository) => {
    const repositoryChanges = changes.filter((change) => change.repositories.includes(repository.id));
    const repositoryActiveChanges = repositoryChanges.filter((change) => !change.closed);
    const repositoryClosedChanges = repositoryChanges.filter((change) => change.closed);
    return {
      ...repository,
      activeChangeCount: repositoryActiveChanges.length,
      activeChanges: repositoryActiveChanges,
      recentChanges: repositoryClosedChanges.slice(0, 5),
      change: (repositoryActiveChanges.length > 0 ? repositoryActiveChanges : repositoryChanges)[0] ?? null,
    };
  });
  const result = {
    spaceId,
    status: resolveWorkspaceStatus(space.status),
    planningPath: space._repositoryOnly === true
      ? null
      : resolveIdeaPlanningPath(config, spaceId, space).split("\\").join("/"),
    repositories,
    activeChangeCount: activeChanges.length,
    activeChanges,
    recentChanges: closedChanges.slice(0, 5),
    unresolvedRepositoryIds,
    repositoryDiagnostics: resolution.diagnostics,
    repositoryActivity,
    change: (activeChanges.length > 0 ? activeChanges : changes)[0] ?? null,
  };
  if (!detail) return result;

  const epics = (await Promise.all(
    repositories.map((repository) => listEpics(workspaceRoot, config, repository)),
  )).flat().sort((left, right) => left.id.localeCompare(right.id)
    || left.repository.localeCompare(right.repository));
  return {
    ...result,
    epics,
    repositoryDetails: repositoryActivity.map((repository) => ({
      ...repository,
      epics: epics.filter((epic) => epic.repositoryId === repository.id),
    })),
  };
}

export async function getStatus(
  startPath,
  spaceId = null,
  {
    includeAll = false,
    gitCommand = "git",
    gitTimeoutMs = 10_000,
    gitConcurrency = 4,
    workspaceRoot: requestedWorkspaceRoot = null,
    afterChangeFileRead = null,
    afterClosedChangeInventory = null,
    afterStoredChangesInventory = null,
  } = {},
) {
  const { workspaceRoot, config } = await resolveOperationConfiguration(
    startPath,
    {
      ...(requestedWorkspaceRoot ? { workspaceRoot: requestedWorkspaceRoot } : {}),
      repositoryTopology: "observational",
    },
  );
  assertValidConfig(config, "read SDD status");
  const configuredSpaceIds = new Set(Object.keys(config.ideas ?? {}));
  const centralChanges = await readCentralChanges(workspaceRoot, {
    afterChangeFileRead,
    afterClosedChangeInventory,
    afterStoredChangesInventory,
  });
  for (const change of centralChanges) {
    const metadata = {
      error: null,
      space: change.spaceId,
      repositories: change.repositories,
    };
    synthesizeRepositoryOnlySpaceFromChangeMetadata(config, metadata);
    const repositoryOnlyContext = config.ideas?.[change.spaceId]?._repositoryOnly === true;
    if (
      (!configuredSpaceIds.has(change.spaceId) || repositoryOnlyContext)
      && !isRepositoryOnlyChangeMetadata(metadata)
    ) {
      throw new SddError(
        `Change ${change.changeId} references unknown Space ID ${change.spaceId}.`,
        {
          code: "SPACE_NOT_FOUND",
          details: Object.keys(config.ideas)
            .filter((id) =>
              configuredSpaceIds.has(id) && config.ideas[id]?._repositoryOnly !== true)
            .sort()
            .map((id) => `Available Space ID: ${id}`),
        },
      );
    }
  }

  if (spaceId !== null) {
    if (!Object.hasOwn(config.ideas, spaceId)) {
      throw new SddError(`Unknown Space ID: ${spaceId}`, {
        code: "SPACE_NOT_FOUND",
        details: Object.keys(config.ideas).sort().map((id) => `Available Space ID: ${id}`),
      });
    }
    return {
      command: "status",
      mode: "space",
      workspaceRoot,
      ...(await buildSpace(workspaceRoot, config, spaceId, config.ideas[spaceId], centralChanges, {
        detail: true,
        gitCommand,
        gitTimeoutMs,
        gitConcurrency,
      })),
    };
  }

  const spaces = [];
  for (const [id, space] of Object.entries(config.ideas).sort(([left], [right]) => left.localeCompare(right))) {
    if (
      space._repositoryOnly === true
      && !isMetadataOnlyRepositorySpace(space)
      && !centralChanges.some((change) => change.spaceId === id)
    ) {
      continue;
    }
    if (!includeAll && resolveWorkspaceStatus(space.status) !== "active") continue;
    spaces.push(await buildSpace(workspaceRoot, config, id, space, centralChanges, {
      includeInactiveRepositories: includeAll,
      gitCommand,
      gitTimeoutMs,
      gitConcurrency,
    }));
  }
  return {
    command: "status",
    mode: "summary",
    workspaceRoot,
    filter: includeAll ? "all" : "active",
    spaces,
  };
}
