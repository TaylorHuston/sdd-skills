import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parseDocument } from "yaml";

import {
  assertValidConfig,
  findWorkspaceRoot,
  readConfig,
  relativeWorkspacePath,
  resolveIdeaPlanningPath,
  resolveRepositoryPath,
  resolveWorkspacePath,
} from "../config.js";
import { CHANGE_STATUSES, parseChangeStatus } from "../change-status.js";
import { SddError } from "../errors.js";
import { isDirectory, pathExists } from "../fs.js";

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
      resolvedPath: resolveRepositoryPath(config, repository).split("\\").join("/"),
    };
    if (!repositories.has(resolved.resolvedPath)) repositories.set(resolved.resolvedPath, resolved);
  }
  return [...repositories.values()];
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
  const validStoredStatus = CHANGE_STATUSES.includes(storedStatus);
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
  };
}

async function listChanges(workspaceRoot, config, repository) {
  const repositoryRoot = resolveWorkspacePath(workspaceRoot, repository.resolvedPath);
  const activeRoot = join(repositoryRoot, config.repositoryArtifacts.activeChanges);
  const closedRoot = join(repositoryRoot, config.repositoryArtifacts.closedChanges);
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
  };
}

async function listEpics(workspaceRoot, config, repository) {
  const repositoryRoot = resolveWorkspacePath(workspaceRoot, repository.resolvedPath);
  const epicsRoot = join(repositoryRoot, config.repositoryArtifacts.epics);
  const epics = [];
  for (const directory of await listDirectories(epicsRoot)) {
    const epicPath = join(epicsRoot, directory, "epic.md");
    if (await pathExists(epicPath)) {
      epics.push(await readEpic(workspaceRoot, repository, epicPath));
    }
  }
  return epics;
}

async function buildSpace(workspaceRoot, config, spaceId, space, { detail = false } = {}) {
  const repositories = resolvedRepositories(config, space);
  const changes = (await Promise.all(
    repositories.map((repository) => listChanges(workspaceRoot, config, repository)),
  )).flat().sort(compareRecent);
  const activeChanges = changes.filter((change) => !change.closed);
  const repositoryActivity = repositories.map((repository) => {
    const repositoryActiveChanges = activeChanges.filter(
      (change) => change.repository === repository.resolvedPath,
    );
    return {
      ...repository,
      activeChangeCount: repositoryActiveChanges.length,
      activeChanges: repositoryActiveChanges,
    };
  });
  const selectedChange = (activeChanges.length > 0 ? activeChanges : changes)[0] ?? null;
  const result = {
    spaceId,
    planningPath: resolveIdeaPlanningPath(config, spaceId, space).split("\\").join("/"),
    repositories,
    activeChangeCount: activeChanges.length,
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
    changes: changes
      .filter((change) => change.repository === repository.resolvedPath)
      .slice(0, 5),
  }));
  return {
    ...result,
    epics,
    changes: changes.slice(0, 5),
    repositoryDetails,
  };
}

export async function getStatus(startPath, spaceId = null) {
  const workspaceRoot = await findWorkspaceRoot(startPath);
  const config = await readConfig(workspaceRoot);
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
      ...(await buildSpace(workspaceRoot, config, spaceId, config.ideas[spaceId], { detail: true })),
    };
  }

  const spaces = [];
  for (const [id, space] of Object.entries(config.ideas).sort(([left], [right]) => left.localeCompare(right))) {
    spaces.push(await buildSpace(workspaceRoot, config, id, space));
  }
  return { command: "status", mode: "summary", workspaceRoot, spaces };
}
