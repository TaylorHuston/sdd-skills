import { relative, resolve, sep } from "node:path";

import {
  assertValidConfig,
  assertValidRepositoryConfig,
  findRepositoryRoot,
  findWorkspaceRoot,
  readConfig,
  readRepositoryConfig,
  resolveIdeaPlanningPath,
  resolveRepositoryPath,
  resolveWorkspaceStatus,
  resolveWorkspacePath,
} from "./config.js";
import { WORKFLOW_SOURCE_PATH } from "./constants.js";
import { isPathInside } from "./fs.js";

function normalizeRelativePath(value) {
  return value.split(sep).join("/") || ".";
}

export async function resolveWorkspaceContext(startPath) {
  const targetPath = resolve(startPath);
  const workspaceRoot = await findWorkspaceRoot(targetPath);
  const config = structuredClone(await readConfig(workspaceRoot));
  assertValidConfig(config, "resolve workspace context");
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
        if (absolutePath === repositoryRoot) {
          repository.id = repositoryConfig.id;
          repository.artifacts = repositoryConfig.artifacts;
          mapped = true;
        }
      }
    }
    if (!mapped) {
      let rootId = `repository-${repositoryConfig.id}`;
      let suffix = 2;
      while (Object.hasOwn(config.repositories.roots, rootId)) {
        rootId = `repository-${repositoryConfig.id}-${suffix}`;
        suffix += 1;
      }
      config.repositories.roots[rootId] = repositoryRoot;
      config.ideas[repositoryConfig.id] = {
        _repositoryOnly: true,
        status: "active",
        repositories: [{
          root: rootId,
          path: ".",
          status: "active",
          id: repositoryConfig.id,
          artifacts: repositoryConfig.artifacts,
        }],
      };
      config.repositoryArtifacts = repositoryConfig.artifacts;
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
