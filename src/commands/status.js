import { readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { parseDocument } from "yaml";

import {
  assertValidConfig,
  relativeWorkspacePath,
  resolveRepositoryArtifacts,
  resolveIdeaPlanningPath,
  resolveRepositoryPath,
  resolveWorkspaceStatus,
  resolveWorkspacePath,
} from "../config.js";
import { resolveOperationConfiguration } from "../workspace.js";
import {
  CHANGE_STATUSES,
  LEGACY_CHANGE_STATUSES,
  parseChangeStatus,
} from "../change-status.js";
import { SddError } from "../errors.js";
import { isDirectory, pathExists } from "../fs.js";

const execFileAsync = promisify(execFile);

function changeDate(name) {
  return /^\d{4}-\d{2}-\d{2}(?=-|$)/.exec(name)?.[0] ?? null;
}

function compareRecent(left, right) {
  return (right.date ?? "").localeCompare(left.date ?? "") ||
    right.changeId.localeCompare(left.changeId) ||
    left.repository.localeCompare(right.repository);
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

function resolvedRepositories(config, space) {
  const repositories = new Map();
  for (const repository of space.repositories ?? []) {
    const resolved = {
      ...repository,
      ...(repository.artifacts ? { artifacts: repository.artifacts } : {}),
      status: resolveWorkspaceStatus(repository.status),
      resolvedPath: resolveRepositoryPath(config, repository).split("\\").join("/"),
    };
    if (!repositories.has(resolved.resolvedPath)) repositories.set(resolved.resolvedPath, resolved);
  }
  return [...repositories.values()];
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

async function readChange(workspaceRoot, repository, root, changeId, closed) {
  const changePath = join(root, changeId);
  const tasksPath = join(changePath, "tasks.md");
  let storedStatus = null;
  let statusError = null;
  if (await pathExists(tasksPath)) {
    const parsed = parseChangeStatus(await readFile(tasksPath, "utf8"));
    storedStatus = typeof parsed.status === "string" ? parsed.status : null;
    statusError = parsed.error;
  } else {
    statusError = "missing tasks.md";
  }
  const validStoredStatus = CHANGE_STATUSES.includes(storedStatus) ||
    (closed && LEGACY_CHANGE_STATUSES.includes(storedStatus));
  return {
    changeId,
    date: changeDate(changeId),
    status: closed ? "closed" : validStoredStatus ? storedStatus : "unknown",
    storedStatus,
    statusValid: validStoredStatus,
    statusError,
    closed,
    path: relativeWorkspacePath(workspaceRoot, changePath),
    repository: repository.resolvedPath,
    role: repository.role ?? null,
    repositoryStatus: repository.status,
  };
}

async function listChanges(workspaceRoot, config, repository) {
  const repositoryRoot = resolveWorkspacePath(workspaceRoot, repository.resolvedPath);
  const artifacts = resolveRepositoryArtifacts(config, repository);
  const activeRoot = join(repositoryRoot, artifacts.activeChanges);
  const closedRoot = join(repositoryRoot, artifacts.closedChanges);
  const active = await Promise.all(
    (await listDirectories(activeRoot))
      .filter((name) => join(activeRoot, name) !== closedRoot)
      .map((name) => readChange(workspaceRoot, repository, activeRoot, name, false)),
  );
  const closed = await Promise.all(
    (await listDirectories(closedRoot)).map((name) =>
      readChange(workspaceRoot, repository, closedRoot, name, true),
    ),
  );
  return [...active, ...closed];
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
    if (await pathExists(epicPath)) {
      epics.push(await readEpic(workspaceRoot, repository, epicPath));
    }
  }
  return epics;
}

async function buildSpace(
  workspaceRoot,
  config,
  spaceId,
  space,
  {
    detail = false,
    includeInactiveRepositories = true,
    gitCommand = "git",
    gitTimeoutMs = 10_000,
    gitConcurrency = 4,
  } = {},
) {
  const selectedRepositories = resolvedRepositories(config, space)
    .filter((repository) => includeInactiveRepositories || repository.status === "active");
  const repositories = await mapWithConcurrency(
    selectedRepositories,
    gitConcurrency,
    async (repository) => {
        const repositoryRoot = resolveWorkspacePath(workspaceRoot, repository.resolvedPath);
        return {
          ...repository,
          git: await readGitStatus(repositoryRoot, { command: gitCommand, timeoutMs: gitTimeoutMs }),
        };
      },
  );
  const changes = (await Promise.all(
    repositories.map((repository) => listChanges(workspaceRoot, config, repository)),
  )).flat().sort(compareRecent);
  const activeChanges = changes.filter((change) => !change.closed);
  const closedChanges = changes.filter((change) => change.closed);
  const repositoryActivity = repositories.map((repository) => {
    const repositoryChanges = changes.filter(
      (change) => change.repository === repository.resolvedPath,
    );
    const repositoryActiveChanges = activeChanges.filter(
      (change) => change.repository === repository.resolvedPath,
    );
    const repositoryClosedChanges = closedChanges.filter(
      (change) => change.repository === repository.resolvedPath,
    );
    return {
      ...repository,
      activeChangeCount: repositoryActiveChanges.length,
      activeChanges: repositoryActiveChanges,
      recentChanges: repositoryClosedChanges.slice(0, 5),
      change: (repositoryActiveChanges.length > 0 ? repositoryActiveChanges : repositoryChanges)[0] ?? null,
    };
  });
  const selectedChange = (activeChanges.length > 0 ? activeChanges : changes)[0] ?? null;
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
    repositoryActivity,
    change: selectedChange,
  };
  if (!detail) return result;

  const epics = (await Promise.all(
    repositories.map((repository) => listEpics(workspaceRoot, config, repository)),
  )).flat().sort((left, right) => left.id.localeCompare(right.id) || left.repository.localeCompare(right.repository));
  const repositoryDetails = repositoryActivity.map((repository) => ({
    ...repository,
    epics: epics.filter((epic) => epic.repository === repository.resolvedPath),
  }));
  return {
    ...result,
    epics,
    repositoryDetails,
  };
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

export async function getStatus(
  startPath,
  spaceId = null,
  { includeAll = false, gitCommand = "git", gitTimeoutMs = 10_000, gitConcurrency = 4 } = {},
) {
  const { workspaceRoot, config } = await resolveOperationConfiguration(startPath);
  assertValidConfig(config, "read SDD status");

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
      ...(await buildSpace(workspaceRoot, config, spaceId, config.ideas[spaceId], {
        detail: true,
        gitCommand,
        gitTimeoutMs,
        gitConcurrency,
      })),
    };
  }

  const spaces = [];
  for (const [id, space] of Object.entries(config.ideas).sort(([left], [right]) => left.localeCompare(right))) {
    if (space._repositoryOnly === true) continue;
    if (!includeAll && resolveWorkspaceStatus(space.status) !== "active") continue;
    spaces.push(await buildSpace(workspaceRoot, config, id, space, {
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
