import { dirname, join, relative, resolve, sep } from "node:path";

import {
  assertValidConfig,
  assertValidRepositoryConfig,
  findRepositoryRoot,
  findWorkspaceRoot,
  readConfig,
  readRepositoryConfig,
  resolveIdeaPlanningPath,
  resolveRepositoryArtifacts,
  resolveRepositoryPath,
  resolveWorkspaceStatus,
  resolveWorkspacePath,
} from "./config.js";
import { WORKFLOW_SOURCE_PATH } from "./constants.js";
import { SddError } from "./errors.js";
import { isPathInside, isPathPhysicallyInside, resolvePhysicalPath } from "./fs.js";

function normalizeRelativePath(value) {
  return value.split(sep).join("/") || ".";
}

export async function resolveWorkspaceContext(startPath) {
  const targetPath = resolve(startPath);
  const workspaceRoot = await findWorkspaceRoot(targetPath);
  const config = structuredClone(await readConfig(workspaceRoot));
  assertValidConfig(config, "resolve workspace context");
  const physicalRepositoryOwners = new Map();
  for (const [ideaId, idea] of Object.entries(config.ideas ?? {})) {
    for (const repository of idea.repositories ?? []) {
      const configuredPath = resolveRepositoryPath(config, repository);
      const absolutePath = resolveWorkspacePath(workspaceRoot, configuredPath);
      const physicalPath = await resolvePhysicalPath(absolutePath);
      const previous = physicalRepositoryOwners.get(physicalPath);
      if (previous) {
        throw new SddError("Cannot resolve context with duplicate physical repository ownership.", {
          code: "INVALID_CONFIG",
          details: [
            `${configuredPath} resolves to ${physicalPath}, already claimed by ${previous.ideaId} (${previous.configuredPath}).`,
          ],
        });
      }
      physicalRepositoryOwners.set(physicalPath, { ideaId, configuredPath });
    }
  }
  const repositoryRoot = await findRepositoryRoot(targetPath);
  const repositoryConfig = repositoryRoot ? await readRepositoryConfig(repositoryRoot) : null;
  if (repositoryConfig) {
    assertValidRepositoryConfig(repositoryConfig);
    let mapped = false;
    for (const idea of Object.values(config.ideas ?? {})) {
      for (const repository of idea.repositories ?? []) {
        const absolutePath = resolveWorkspacePath(
          workspaceRoot,
          resolveRepositoryPath(config, repository),
        );
        if (await resolvePhysicalPath(absolutePath) === await resolvePhysicalPath(repositoryRoot)) {
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
      config.repositories.roots[rootId] = repositoryRoot;
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
  for (const [ideaId, idea] of Object.entries(config.ideas ?? {})) {
    for (const repository of idea.repositories ?? []) {
      const repositoryPath = resolveWorkspacePath(
        workspaceRoot,
        resolveRepositoryPath(config, repository),
      );
      const artifacts = resolveRepositoryArtifacts(config, repository);
      const physicalArtifacts = new Map();
      for (const [key, configuredPath] of Object.entries(artifacts)) {
        const artifactPath = join(repositoryPath, configuredPath);
        if (!(await isPathPhysicallyInside(repositoryPath, artifactPath))) {
          throw new SddError("Cannot resolve context with an artifact root outside its repository.", {
            code: "UNSAFE_ARTIFACT_PATH",
            details: [`${ideaId}.${key} resolves outside ${repositoryPath}: ${artifactPath}.`],
          });
        }
        physicalArtifacts.set(key, await resolvePhysicalPath(artifactPath));
      }
      const artifactEntries = [...physicalArtifacts.entries()];
      for (let leftIndex = 0; leftIndex < artifactEntries.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < artifactEntries.length; rightIndex += 1) {
          const [leftKey, leftPath] = artifactEntries[leftIndex];
          const [rightKey, rightPath] = artifactEntries[rightIndex];
          const allowedClosedChild = leftKey === "activeChanges" && rightKey === "closedChanges"
            && dirname(rightPath) === leftPath;
          if (allowedClosedChild) continue;
          if (isPathInside(leftPath, rightPath) || isPathInside(rightPath, leftPath)) {
            throw new SddError("Cannot resolve context with overlapping physical artifact roots.", {
              code: "INVALID_CONFIG",
              details: [`${ideaId}.${leftKey} overlaps ${ideaId}.${rightKey}.`],
            });
          }
        }
      }
    }
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
    if (planningPath && isPathInside(planningPath, targetPath)) {
      matches.push({
        kind: "planning",
        idea: ideaId,
        ideaStatus,
        spaceId: ideaId,
        matchedPath: planningPath,
        planningPath: normalizeRelativePath(resolvedPlanningPath),
        repositories: resolvedRepositories,
      });
    }

    for (const repository of resolvedRepositories) {
      const repositoryPath = resolveWorkspacePath(
        workspaceRoot,
        repository.resolvedPath,
      );
      if (isPathInside(repositoryPath, targetPath)) {
        matches.push({
          kind: "repository",
          idea: repositoryOnly ? null : ideaId,
          ideaStatus: repositoryOnly ? null : ideaStatus,
          spaceId: ideaId,
          repository,
          matchedPath: repositoryPath,
          planningPath: resolvedPlanningPath === null ? null : normalizeRelativePath(resolvedPlanningPath),
          repositories: resolvedRepositories,
        });
      }
    }
  }

  matches.sort((left, right) => right.matchedPath.length - left.matchedPath.length);
  const match = matches[0] ?? null;
  const withinWorkspace = isPathInside(workspaceRoot, targetPath);

  return {
    workspaceRoot,
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
    workflowPath: WORKFLOW_SOURCE_PATH,
  };
}

export async function resolveOperationConfiguration(startPath) {
  const context = await resolveWorkspaceContext(startPath);
  return { workspaceRoot: context.workspaceRoot, config: context.config, context };
}
