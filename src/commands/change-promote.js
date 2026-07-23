import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { assertValidChangeId } from "../change-id.js";
import { parseChangeStatus } from "../change-status.js";
import { resolvedActiveRepositories, selectRepositories } from "../change-repositories.js";
import {
  assertValidConfig,
  resolveRepositoryArtifacts,
  relativeWorkspacePath,
  resolveIdeaPlanningPath,
  resolveWorkspacePath,
  resolveWorkspaceStatus,
} from "../config.js";
import { resolveOperationConfiguration } from "../workspace.js";
import { SddError } from "../errors.js";
import { hashDirectory, isDirectory, isPathPhysicallyInside, pathExists } from "../fs.js";

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
  if (status !== "planned") {
    throw new SddError("Only a Change with status planned can be promoted.", {
      code: "CHANGE_NOT_PLANNED",
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

async function assertNoSymlinks(directory, displayPath) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new SddError(`Planned Change contains a symbolic link: ${displayPath}/${entry.name}`, {
        code: "UNSAFE_ARTIFACT_PATH",
      });
    }
    if (entry.isDirectory()) {
      await assertNoSymlinks(path, `${displayPath}/${entry.name}`);
    }
  }
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
  {
    repositories = [],
    dryRun = false,
    beforeCommit = null,
    beforeDestinationCommit = null,
  } = {},
) {
  assertValidChangeId(changeId);
  const { workspaceRoot, config, context } = await resolveOperationConfiguration(startPath);
  assertValidConfig(config, "promote a planned Change");
  const space = config.ideas[spaceId];
  if (!space) {
    throw new SddError(`Unknown Space ID: ${spaceId}`, {
      code: "SPACE_NOT_FOUND",
      details: Object.keys(config.ideas).sort().map((id) => `Available Space ID: ${id}`),
    });
  }
  if (space._repositoryOnly === true || (
    context.kind === "repository" && context.spaceId === spaceId && context.planningPath === null
  )) {
    throw new SddError(
      `Space ${spaceId} has no configured Idea planning mapping for a planned Change.`,
      { code: "PLANNING_MAPPING_REQUIRED" },
    );
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
  const planningRoot = resolveWorkspacePath(
    workspaceRoot,
    resolveIdeaPlanningPath(config, spaceId, space),
  );
  if (!(await isPathPhysicallyInside(planningRoot, sourcePath))) {
    throw new SddError(`Planned Change resolves outside its configured planning root: ${plannedPath}`, {
      code: "UNSAFE_ARTIFACT_PATH",
    });
  }
  if (!(await isDirectory(sourcePath))) {
    throw new SddError(`Planned Change does not exist: ${plannedPath}`, {
      code: "CHANGE_NOT_FOUND",
    });
  }
  await assertNoSymlinks(sourcePath, plannedPath);
  await validateDraft(sourcePath, plannedPath);
  const sourceHash = await hashDirectory(sourcePath);

  const selected = selectRepositories(
    resolvedActiveRepositories(config, space),
    repositories,
    { allowNone: false },
  );
  const destinations = [];
  for (const repository of selected) {
    const artifacts = resolveRepositoryArtifacts(config, repository);
    const repositoryPath = resolveWorkspacePath(workspaceRoot, repository.resolvedPath);
    if (!(await isDirectory(repositoryPath))) {
      throw new SddError(`Configured repository does not exist: ${repository.resolvedPath}`, {
        code: "REPOSITORY_NOT_FOUND",
      });
    }
    const activePath = normalizePath(join(artifacts.activeChanges, changeId));
    const absolutePath = join(repositoryPath, artifacts.activeChanges, changeId);
    if (await pathExists(absolutePath)) {
      throw new SddError(`Active Change already exists: ${normalizePath(join(repository.resolvedPath, activePath))}`, {
        code: "CHANGE_EXISTS",
      });
    }
    destinations.push({
      ...repository,
      repositoryPath,
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
      heldSource = join(dirname(sourcePath), `.${changeId}.sdd-promoted-${nonce}`);
      await rename(sourcePath, heldSource);
      if (await hashDirectory(heldSource) !== sourceHash) {
        await rename(heldSource, sourcePath);
        heldSource = null;
        throw new SddError(`Planned Change changed during promotion: ${plannedPath}`, {
          code: "CONCURRENT_CHANGE",
        });
      }
      for (const destination of destinations) {
        if (!(await isPathPhysicallyInside(destination.repositoryPath, destination.absolutePath))) {
          throw new SddError(`Active Change resolves outside its repository: ${destination.path}`, {
            code: "UNSAFE_ARTIFACT_PATH",
          });
        }
        const temporaryPath = join(
          dirname(destination.absolutePath),
          `.${changeId}.sdd-promote-${nonce}`,
        );
        await mkdir(dirname(destination.absolutePath), { recursive: true });
        await cp(heldSource, temporaryPath, { recursive: true, verbatimSymlinks: true });
        await assertNoSymlinks(temporaryPath, destination.path);
        await rewritePromotedMarkdown(temporaryPath, {
          plannedPath,
          activePath: destination.activePath,
          changeId,
          role: destination.role,
          repositoryCount: destinations.length,
        });
        staged.push({
          ...destination,
          temporaryPath,
          stagedHash: await hashDirectory(temporaryPath),
        });
      }
      if (beforeCommit) await beforeCommit({ sourcePath, heldSource, destinations: staged });
      if (await pathExists(sourcePath) || await hashDirectory(heldSource) !== sourceHash) {
        throw new SddError(`Planned Change changed during promotion: ${plannedPath}`, {
          code: "CONCURRENT_CHANGE",
        });
      }
      for (const [index, destination] of staged.entries()) {
        if (beforeDestinationCommit) {
          await beforeDestinationCommit({ destination, index, destinations: staged });
        }
        if (!(await isPathPhysicallyInside(destination.repositoryPath, destination.absolutePath))) {
          throw new SddError(`Active Change resolves outside its repository: ${destination.path}`, {
            code: "UNSAFE_ARTIFACT_PATH",
          });
        }
        await assertNoSymlinks(destination.temporaryPath, destination.path);
        if (await pathExists(destination.absolutePath)) {
          throw new SddError(`Active Change appeared during promotion: ${destination.path}`, {
            code: "CONCURRENT_CHANGE",
          });
        }
        await rename(destination.temporaryPath, destination.absolutePath);
        committed.push(destination);
      }
      if (await pathExists(sourcePath) || await hashDirectory(heldSource) !== sourceHash) {
        throw new SddError(`Planned Change changed during promotion: ${plannedPath}`, {
          code: "CONCURRENT_CHANGE",
        });
      }
      await rm(heldSource, { recursive: true, force: true });
      heldSource = null;
    } catch (error) {
      const recoveryFailures = [];
      for (const destination of staged) {
        try {
          await rm(destination.temporaryPath, { recursive: true, force: true });
        } catch (recoveryError) {
          recoveryFailures.push(`${destination.temporaryPath}: ${recoveryError.message}`);
        }
      }
      for (const destination of committed) {
        try {
          if (await hashDirectory(destination.absolutePath) !== destination.stagedHash) {
            recoveryFailures.push(
              `${destination.path}: newer content preserved; promoted destination was not removed.`,
            );
            continue;
          }
          await rm(destination.absolutePath, { recursive: true, force: true });
        } catch (recoveryError) {
          recoveryFailures.push(`${destination.path}: ${recoveryError.message}`);
        }
      }
      if (heldSource && await pathExists(heldSource)) {
        try {
          if (await pathExists(sourcePath)) {
            recoveryFailures.push(
              `${plannedPath}: concurrent replacement preserved; original retained at ${heldSource}.`,
            );
          } else {
            await rename(heldSource, sourcePath);
          }
        } catch (recoveryError) {
          recoveryFailures.push(`${heldSource}: ${recoveryError.message}`);
        }
      }
      if (recoveryFailures.length > 0) {
        throw new SddError("Change promotion failed and recovery was incomplete.", {
          code: "MUTATION_RECOVERY_FAILED",
          details: [`Original error: ${error.message}`, ...recoveryFailures],
        });
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
    repositories: destinations.map(
      ({ absolutePath, repositoryPath, stagedHash, ...destination }) => destination,
    ),
    files: [...REQUIRED_FILES],
  };
}
