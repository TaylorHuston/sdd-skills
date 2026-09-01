import { relative, resolve, sep } from "node:path";

import { assertRepositoryArtifactRoots } from "./change-repositories.js";
import { isRepositoryOnlyChangeMetadata } from "./change-status.js";

import {
  assertWorkspaceConfigSnapshotCurrent,
  assertValidConfig,
  assertValidRepositoryConfig,
  findRepositoryRoot,
  findWorkspaceRoot,
  getWorkspaceConfigPath,
  readRepositoryConfig,
  readWorkspaceConfigSnapshot,
  resolveIdeaPlanningPath,
  resolveRepositoryArtifacts,
  resolveRepositoryPath,
  resolveWorkspaceStatus,
  resolveWorkspacePath,
} from "./config.js";
import { WORKFLOW_RELATIVE_PATH } from "./constants.js";
import { SddError } from "./errors.js";
import { isPathInside, isPathPhysicallyInside, resolvePhysicalPath } from "./fs.js";

function normalizeRelativePath(value) {
  return value.split(sep).join("/") || ".";
}

export function isMetadataOnlyRepositorySpace(space) {
  return space?._repositoryOnly === true && space?._metadataOnly === true;
}

export function synthesizeRepositoryOnlySpaceFromChangeMetadata(config, metadata) {
  if (!isRepositoryOnlyChangeMetadata(metadata)) return null;
  const existing = Object.hasOwn(config.ideas ?? {}, metadata.space)
    ? config.ideas[metadata.space]
    : null;
  if (existing !== null) {
    return isMetadataOnlyRepositorySpace(existing) ? existing : null;
  }

  const space = {
    status: "active",
    repositories: [],
  };
  Object.defineProperties(space, {
    _repositoryOnly: { value: true, enumerable: false },
    _metadataOnly: { value: true, enumerable: false },
    _unresolvedRepositoryIds: {
      value: Object.freeze([metadata.space]),
      enumerable: false,
    },
  });
  config.ideas[metadata.space] = space;
  return space;
}

async function pathContainment(ownerPath, physicalTargetPath) {
  const physicalOwnerPath = await resolvePhysicalPath(ownerPath);
  if (!isPathInside(physicalOwnerPath, physicalTargetPath)) return null;
  return {
    physicalOwnerPath,
    physicalDepth: physicalOwnerPath.split(sep).filter(Boolean).length,
  };
}

async function contextPathContainment(
  ownerPath,
  physicalTargetPath,
  observational,
) {
  try {
    return await pathContainment(ownerPath, physicalTargetPath);
  } catch (error) {
    if (!observational) throw error;
    // Status resolves mapped repositories independently and retains their diagnostics.
    return null;
  }
}

export async function assertDistinctRepositoryOwnership(workspaceRoot, config) {
  const owners = [];
  for (const [ideaId, idea] of Object.entries(config.ideas ?? {})) {
    for (const [repositoryIndex, repository] of (idea.repositories ?? []).entries()) {
      const configuredPath = resolveRepositoryPath(config, repository);
      const absolutePath = resolveWorkspacePath(workspaceRoot, configuredPath);
      owners.push({
        ideaId,
        repositoryIndex,
        configuredPath,
        physicalPath: await resolvePhysicalPath(absolutePath),
      });
    }
  }
  owners.sort((left, right) =>
    left.physicalPath.localeCompare(right.physicalPath)
    || left.ideaId.localeCompare(right.ideaId)
    || left.configuredPath.localeCompare(right.configuredPath)
    || left.repositoryIndex - right.repositoryIndex);

  const firstOwnerByPhysicalPath = new Map();
  const details = [];
  for (const owner of owners) {
    const previous = firstOwnerByPhysicalPath.get(owner.physicalPath);
    if (!previous) {
      firstOwnerByPhysicalPath.set(owner.physicalPath, owner);
      continue;
    }
    details.push(
      `${owner.configuredPath} resolves to ${owner.physicalPath}, already claimed by ${previous.ideaId} (${previous.configuredPath}).`,
    );
  }
  if (details.length > 0) {
    throw new SddError("Cannot resolve context with duplicate physical repository ownership.", {
      code: "INVALID_CONFIG",
      details,
    });
  }
  return config;
}

export async function assertValidRepositoryArtifactTopology(workspaceRoot, config) {
  for (const idea of Object.values(config.ideas ?? {})) {
    for (const repository of idea.repositories ?? []) {
      const resolvedPath = resolveRepositoryPath(config, repository);
      await assertRepositoryArtifactRoots(
        resolveWorkspacePath(workspaceRoot, resolvedPath),
        resolveRepositoryArtifacts(config, repository),
        { repositoryPath: normalizeRelativePath(resolvedPath) },
      );
    }
  }
  return config;
}

export async function findOperationConfiguration(startPath, options = {}) {
  const workspaceRoot = await findWorkspaceRoot(startPath, options);
  const snapshot = await readWorkspaceConfigSnapshot(workspaceRoot);
  const workspaceConfigSnapshot = structuredClone(snapshot);
  const config = structuredClone(workspaceConfigSnapshot.config);
  return {
    workspaceRoot,
    workspaceConfigPath: getWorkspaceConfigPath(workspaceRoot),
    workspaceConfigSnapshot,
    config,
  };
}

export async function assertOperationConfigurationCurrent(operation) {
  const {
    workspaceRoot,
    workspaceConfigSnapshot,
  } = operation;
  if (!workspaceConfigSnapshot) {
    throw new SddError("Workspace configuration authority changed after operation selection.", {
      code: "CONCURRENT_CHANGE",
    });
  }
  await assertWorkspaceConfigSnapshotCurrent(workspaceRoot, workspaceConfigSnapshot);
  return true;
}

export async function resolveWorkspaceContext(startPath, options = {}) {
  const observationalRepositoryTopology = options.repositoryTopology === "observational";
  const targetPath = resolve(options.cwd ?? process.cwd(), startPath);
  const {
    workspaceRoot,
    workspaceConfigPath,
    workspaceConfigSnapshot,
    config,
  } = await findOperationConfiguration(targetPath, options);
  assertValidConfig(config, "resolve workspace context");
  if (!observationalRepositoryTopology) {
    await assertDistinctRepositoryOwnership(workspaceRoot, config);
  }
  const physicalTargetPath = await resolvePhysicalPath(targetPath);
  const repositoryRoot = await findRepositoryRoot(targetPath);
  const physicalRepositoryRoot = repositoryRoot
    ? await resolvePhysicalPath(repositoryRoot)
    : null;
  let repositoryConfig = null;
  try {
    repositoryConfig = repositoryRoot ? await readRepositoryConfig(repositoryRoot) : null;
    if (repositoryConfig) assertValidRepositoryConfig(repositoryConfig);
  } catch (error) {
    if (!observationalRepositoryTopology) throw error;
    repositoryConfig = null;
  }
  if (repositoryConfig) {
    let mapped = false;
    for (const idea of Object.values(config.ideas ?? {})) {
      for (const repository of idea.repositories ?? []) {
        const absolutePath = resolveWorkspacePath(
          workspaceRoot,
          resolveRepositoryPath(config, repository),
        );
        if (await resolvePhysicalPath(absolutePath) === physicalRepositoryRoot) {
          Object.defineProperties(repository, {
            id: { value: repositoryConfig.id, enumerable: false },
            artifacts: { value: repositoryConfig.artifacts, enumerable: false },
          });
          mapped = true;
        }
      }
    }
    if (!mapped) {
      if (Object.hasOwn(config.ideas, repositoryConfig.id)) {
        throw new SddError("Cannot resolve repository-only context with an ID already owned by an Idea.", {
          code: "REPOSITORY_ID_COLLISION",
          details: [`Repository ID: ${repositoryConfig.id}`],
        });
      }
      let rootId = `repository-${repositoryConfig.id}`;
      let suffix = 2;
      while (Object.hasOwn(config.repositories.roots, rootId)) {
        rootId = `repository-${repositoryConfig.id}-${suffix}`;
        suffix += 1;
      }
      config.repositories.roots[rootId] = resolve(repositoryRoot);
      const repositoryOnlySpace = {
        status: "active",
        repositories: [{
          root: rootId,
          path: ".",
          status: "active",
        }],
      };
      Object.defineProperty(repositoryOnlySpace, "_repositoryOnly", {
        value: true,
        enumerable: false,
      });
      Object.defineProperties(repositoryOnlySpace.repositories[0], {
        id: { value: repositoryConfig.id, enumerable: false },
        artifacts: { value: repositoryConfig.artifacts, enumerable: false },
      });
      config.ideas[repositoryConfig.id] = repositoryOnlySpace;
    }
  }
  if (!observationalRepositoryTopology) {
    await assertValidRepositoryArtifactTopology(workspaceRoot, config);
  }
  const matches = [];

  for (const [ideaId, idea] of Object.entries(config.ideas ?? {})) {
    const repositoryOnly = idea._repositoryOnly === true;
    const ideaStatus = resolveWorkspaceStatus(idea.status);
    const resolvedPlanningPath = repositoryOnly ? null : resolveIdeaPlanningPath(config, ideaId, idea);
    const planningPath = resolvedPlanningPath === null
      ? null
      : resolveWorkspacePath(workspaceRoot, resolvedPlanningPath);
    const resolvedRepositories = (idea.repositories ?? []).map((repository) => ({
      ...repository,
      ...(repository.id ? { id: repository.id } : {}),
      ...(repository.artifacts ? { artifacts: repository.artifacts } : {}),
      status: resolveWorkspaceStatus(repository.status),
      resolvedPath: normalizeRelativePath(resolveRepositoryPath(config, repository)),
    }));
    if (planningPath) {
      const containment = await contextPathContainment(
        planningPath,
        physicalTargetPath,
        observationalRepositoryTopology,
      );
      if (containment) {
        matches.push({
          kind: "planning",
          idea: ideaId,
          ideaStatus,
          spaceId: ideaId,
          matchedPath: planningPath,
          planningPath: normalizeRelativePath(resolvedPlanningPath),
          repositories: resolvedRepositories,
          ...containment,
          exactRepositoryRoot: false,
        });
      }
    }

    for (const repository of resolvedRepositories) {
      const repositoryPath = resolveWorkspacePath(
        workspaceRoot,
        repository.resolvedPath,
      );
      const containment = await contextPathContainment(
        repositoryPath,
        physicalTargetPath,
        observationalRepositoryTopology,
      );
      if (containment) {
        matches.push({
          kind: "repository",
          idea: repositoryOnly ? null : ideaId,
          ideaStatus: repositoryOnly ? null : ideaStatus,
          spaceId: ideaId,
          repository,
          matchedPath: repositoryPath,
          planningPath: resolvedPlanningPath === null ? null : normalizeRelativePath(resolvedPlanningPath),
          repositories: resolvedRepositories,
          ...containment,
          exactRepositoryRoot: physicalRepositoryRoot !== null
            && containment.physicalOwnerPath === physicalRepositoryRoot,
        });
      }
    }
  }

  matches.sort((left, right) =>
    Number(right.exactRepositoryRoot) - Number(left.exactRepositoryRoot)
    || right.physicalDepth - left.physicalDepth
    || left.physicalOwnerPath.localeCompare(right.physicalOwnerPath)
    || Number(right.kind === "repository") - Number(left.kind === "repository")
    || String(left.spaceId).localeCompare(String(right.spaceId)));
  const match = matches[0] ?? null;
  const withinWorkspace = await isPathPhysicallyInside(workspaceRoot, targetPath);
  if (!match && !withinWorkspace) {
    throw new SddError(
      `Workspace ${workspaceRoot} does not map external target ${targetPath}.`,
      { code: "WORKSPACE_TARGET_UNMAPPED" },
    );
  }

  const context = {
    workspaceRoot,
    workspaceConfigPath,
    relativePath: normalizeRelativePath(relative(workspaceRoot, targetPath)),
    kind: match?.kind ?? (targetPath === workspaceRoot ? "workspace" : withinWorkspace ? "unmapped" : "external"),
    idea: match?.idea ?? null,
    ideaStatus: match?.ideaStatus ?? null,
    spaceId: match?.spaceId ?? null,
    planningPath: match?.planningPath ?? null,
    repository: match?.repository ?? null,
    relatedRepositories: match?.repositories ?? [],
    config,
    repositoryConfig,
    workflowPath: resolve(workspaceRoot, WORKFLOW_RELATIVE_PATH),
  };
  Object.defineProperty(context, "workspaceConfigSnapshot", {
    value: workspaceConfigSnapshot,
    enumerable: false,
  });
  return context;
}

export async function resolveOperationConfiguration(startPath, options = {}) {
  const context = await resolveWorkspaceContext(startPath, options);
  return {
    workspaceRoot: context.workspaceRoot,
    workspaceConfigPath: context.workspaceConfigPath,
    config: context.config,
    workspaceConfigSnapshot: context.workspaceConfigSnapshot,
    context,
  };
}
