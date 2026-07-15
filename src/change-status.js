import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { parseDocument } from "yaml";

import { resolveRepositoryPath } from "./config.js";
import { isDirectory, pathExists } from "./fs.js";

export const CHANGE_STATUSES = Object.freeze([
  "proposed",
  "planned",
  "in_progress",
  "in_review",
]);

export const LEGACY_CHANGE_STATUSES = Object.freeze([
  "review",
  "replanning",
  "ready_to_close",
]);

export const CHANGE_STATUS_TRANSITIONS = Object.freeze({
  proposed: Object.freeze(["planned"]),
  planned: Object.freeze(["proposed", "in_progress"]),
  in_progress: Object.freeze(["proposed", "in_review"]),
  in_review: Object.freeze(["proposed", "in_progress"]),
});

export function canTransitionChangeStatus(from, to) {
  return CHANGE_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export function replaceChangeStatus(source, nextStatus) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;
  const statusLines = [...match[1].matchAll(/^status:\s*.*$/gm)];
  if (statusLines.length !== 1) return null;

  const updatedFrontmatter = match[1].replace(
    /^status:\s*.*$/m,
    `status: ${nextStatus}`,
  );
  const updatedBlock = match[0].replace(match[1], updatedFrontmatter);
  return `${updatedBlock}${source.slice(match[0].length)}`;
}

export function parseChangeStatus(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { status: null, error: null };

  const document = parseDocument(match[1]);
  if (document.errors.length > 0) {
    return { status: null, error: document.errors[0].message };
  }
  const frontmatter = document.toJS();
  return {
    status: frontmatter && typeof frontmatter === "object" ? frontmatter.status : null,
    error: null,
  };
}

async function listChangeDirectories(root) {
  if (!(await isDirectory(root))) return [];
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => join(root, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

async function inspectTasks(workspaceRoot, changePath, { historical = false } = {}) {
  const tasksPath = join(changePath, "tasks.md");
  const displayPath = relative(workspaceRoot, tasksPath);
  if (!(await pathExists(tasksPath))) {
    return [{ level: "error", message: `Change is missing tasks.md: ${displayPath}.` }];
  }

  const { status, error } = parseChangeStatus(await readFile(tasksPath, "utf8"));
  if (error) {
    return [{ level: "error", message: `Cannot parse Change status in ${displayPath}: ${error}` }];
  }
  if (status == null) {
    return [{ level: "error", message: `Change is missing tasks.md status: ${displayPath}.` }];
  }
  if (!CHANGE_STATUSES.includes(status)) {
    if (historical && LEGACY_CHANGE_STATUSES.includes(status)) return [];
    return [{
      level: "error",
      message: `Invalid Change status ${JSON.stringify(status)} in ${displayPath}. Expected one of: ${CHANGE_STATUSES.join(", ")}.`,
    }];
  }
  return [];
}

async function workspaceRepositoryPaths(workspaceRoot, config) {
  const paths = new Set();
  for (const idea of Object.values(config.ideas ?? {})) {
    for (const repository of idea.repositories ?? []) {
      paths.add(resolve(workspaceRoot, resolveRepositoryPath(config, repository)));
    }
  }
  for (const repositoryRoot of Object.values(config.repositories?.roots ?? {})) {
    const rootPath = resolve(workspaceRoot, repositoryRoot);
    if (!(await isDirectory(rootPath))) continue;
    const entries = await readdir(rootPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        paths.add(join(rootPath, entry.name));
      }
    }
  }
  return [...paths].sort((left, right) => left.localeCompare(right));
}

export async function inspectChangeStatuses(workspaceRoot, config) {
  const findings = [];
  const activeRelative = config.repositoryArtifacts.activeChanges;
  const closedRelative = config.repositoryArtifacts.closedChanges;

  for (const repositoryPath of await workspaceRepositoryPaths(workspaceRoot, config)) {
    if (!(await isDirectory(repositoryPath))) continue;
    const activeRoot = join(repositoryPath, activeRelative);
    const closedRoot = join(repositoryPath, closedRelative);

    for (const changePath of await listChangeDirectories(activeRoot)) {
      if (resolve(changePath) === resolve(closedRoot)) {
        continue;
      }
      findings.push(...(await inspectTasks(workspaceRoot, changePath)));
    }
    for (const changePath of await listChangeDirectories(closedRoot)) {
      findings.push(...(await inspectTasks(workspaceRoot, changePath, { historical: true })));
    }
  }
  return findings;
}
