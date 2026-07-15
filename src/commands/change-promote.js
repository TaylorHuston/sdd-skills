import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { assertValidChangeId } from "../change-id.js";
import { parseChangeStatus } from "../change-status.js";
import { resolvedActiveRepositories, selectRepositories } from "../change-repositories.js";
import {
  assertValidConfig,
  findWorkspaceRoot,
  readConfig,
  relativeWorkspacePath,
  resolveIdeaPlanningPath,
  resolveWorkspacePath,
  resolveWorkspaceStatus,
} from "../config.js";
import { SddError } from "../errors.js";
import { isDirectory, pathExists } from "../fs.js";

const REQUIRED_FILES = Object.freeze(["proposal.md", "design.md", "tasks.md"]);

function normalizePath(value) {
  return value.split("\\").join("/");
}

async function validateDraft(sourcePath, displayPath) {
  if (!(await isDirectory(sourcePath))) {
    throw new SddError(`Planned Change does not exist: ${displayPath}`, {
      code: "CHANGE_NOT_FOUND",
    });
  }
  const missing = [];
  for (const file of REQUIRED_FILES) {
    if (!(await pathExists(join(sourcePath, file)))) missing.push(file);
  }
  if (missing.length > 0) {
    throw new SddError(`Planned Change is missing required artifacts: ${displayPath}`, {
      code: "INCOMPLETE_CHANGE",
      details: missing.map((file) => `Missing file: ${file}`),
    });
  }

  const tasksPath = join(sourcePath, "tasks.md");
  const { status, error } = parseChangeStatus(await readFile(tasksPath, "utf8"));
  if (error) {
    throw new SddError(`Cannot parse Planned Change status in ${displayPath}/tasks.md: ${error}`, {
      code: "INVALID_CHANGE_STATUS",
    });
  }
  if (status !== "proposed") {
    throw new SddError("Only a Planned Change with status proposed can be promoted.", {
      code: "CHANGE_NOT_PROPOSED",
      details: [`Current status: ${status ?? "missing"}`],
    });
  }
}

async function markdownFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(root, path)));
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

function rewriteProposal(source, { activePath, role, repositoryCount }) {
  const target = role ? `- This repository (role: ${role}).` : "- This repository.";
  const coordination = repositoryCount > 1
    ? `\n- Coordinated promotion: ${repositoryCount} repository Changes total.`
    : "";
  return source
    .replace(
      /## Target Repositories\r?\n\r?\n[\s\S]*?\r?\n\r?\n## Epic Actions/,
      `## Target Repositories\n\n${target}${coordination}\n\n## Epic Actions`,
    )
    .replace(/^- Planned location:.*$/m, "- Planned location: promoted; private draft removed")
    .replace(/^- Active location:.*$/m, `- Active location: \`${activePath}/\``);
}

async function rewritePromotedMarkdown(root, context) {
  for (const path of await markdownFiles(root)) {
    let source = await readFile(path, "utf8");
    source = source.replaceAll(context.plannedPath, context.activePath);
    source = source.replaceAll(`docs/changes/${context.changeId}`, context.activePath);
    if (basename(path) === "proposal.md") source = rewriteProposal(source, context);
    if (basename(path) === "tasks.md") {
      source = source.replace(
        /^- Expected dirty files:.*$/m,
        `- Expected dirty files: \`${context.activePath}/\``,
      );
    }
    await writeFile(path, source, "utf8");
  }
}

export async function promotePlannedChange(
  startPath,
  spaceId,
  changeId,
  { repositories = [], dryRun = false } = {},
) {
  assertValidChangeId(changeId);
  const workspaceRoot = await findWorkspaceRoot(startPath);
  const config = await readConfig(workspaceRoot);
  assertValidConfig(config, "promote a planned Change");
  const space = config.ideas[spaceId];
  if (!space) {
    throw new SddError(`Unknown Space ID: ${spaceId}`, {
      code: "SPACE_NOT_FOUND",
      details: Object.keys(config.ideas).sort().map((id) => `Available Space ID: ${id}`),
    });
  }
  if (resolveWorkspaceStatus(space.status) !== "active") {
    throw new SddError(`Space ${spaceId} is not active. Update its .sdd status before promoting work.`, {
      code: "SPACE_NOT_ACTIVE",
    });
  }

  const plannedPath = normalizePath(join(
    resolveIdeaPlanningPath(config, spaceId, space),
    config.planning.plannedChangesDirectory,
    changeId,
  ));
  const sourcePath = resolveWorkspacePath(workspaceRoot, plannedPath);
  await validateDraft(sourcePath, plannedPath);

  const selected = selectRepositories(
    resolvedActiveRepositories(config, space),
    repositories,
    { allowNone: false },
  );
  const destinations = [];
  for (const repository of selected) {
    const repositoryPath = resolveWorkspacePath(workspaceRoot, repository.resolvedPath);
    if (!(await isDirectory(repositoryPath))) {
      throw new SddError(`Configured repository does not exist: ${repository.resolvedPath}`, {
        code: "REPOSITORY_NOT_FOUND",
      });
    }
    const activePath = normalizePath(join(config.repositoryArtifacts.activeChanges, changeId));
    const absolutePath = join(repositoryPath, config.repositoryArtifacts.activeChanges, changeId);
    if (await pathExists(absolutePath)) {
      throw new SddError(`Active Change already exists: ${normalizePath(join(repository.resolvedPath, activePath))}`, {
        code: "CHANGE_EXISTS",
      });
    }
    destinations.push({
      ...repository,
      activePath,
      path: normalizePath(join(repository.resolvedPath, activePath)),
      absolutePath,
    });
  }

  if (!dryRun) {
    const nonce = `${process.pid}-${Date.now()}`;
    const staged = [];
    const committed = [];
    let heldSource = null;
    try {
      for (const destination of destinations) {
        const temporaryPath = join(
          dirname(destination.absolutePath),
          `.${changeId}.sdd-promote-${nonce}`,
        );
        await mkdir(dirname(destination.absolutePath), { recursive: true });
        await cp(sourcePath, temporaryPath, { recursive: true, verbatimSymlinks: true });
        await rewritePromotedMarkdown(temporaryPath, {
          plannedPath,
          activePath: destination.activePath,
          changeId,
          role: destination.role,
          repositoryCount: destinations.length,
        });
        staged.push({ ...destination, temporaryPath });
      }

      heldSource = join(dirname(sourcePath), `.${changeId}.sdd-promoted-${nonce}`);
      await rename(sourcePath, heldSource);
      for (const destination of staged) {
        await rename(destination.temporaryPath, destination.absolutePath);
        committed.push(destination);
      }
      await rm(heldSource, { recursive: true, force: true });
      heldSource = null;
    } catch (error) {
      for (const destination of staged) {
        await rm(destination.temporaryPath, { recursive: true, force: true }).catch(() => {});
      }
      for (const destination of committed) {
        await rm(destination.absolutePath, { recursive: true, force: true }).catch(() => {});
      }
      if (heldSource && (await pathExists(heldSource)) && !(await pathExists(sourcePath))) {
        await rename(heldSource, sourcePath).catch(() => {});
      }
      throw error;
    }
  }

  return {
    command: "change-promote",
    workspaceRoot,
    dryRun,
    spaceId,
    changeId,
    sourcePath: relativeWorkspacePath(workspaceRoot, sourcePath),
    sourceRemoved: !dryRun,
    repositories: destinations.map(({ absolutePath, ...destination }) => destination),
    files: [...REQUIRED_FILES],
  };
}
