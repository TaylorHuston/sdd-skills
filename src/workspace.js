import { relative, resolve, sep } from "node:path";

import {
  assertValidConfig,
  findWorkspaceRoot,
  readConfig,
  resolveIdeaPlanningPath,
  resolveRepositoryPath,
  resolveWorkspacePath,
} from "./config.js";
import { isPathInside } from "./fs.js";

function normalizeRelativePath(value) {
  return value.split(sep).join("/") || ".";
}

export async function resolveWorkspaceContext(startPath) {
  const targetPath = resolve(startPath);
  const workspaceRoot = await findWorkspaceRoot(targetPath);
  const config = await readConfig(workspaceRoot);
  assertValidConfig(config, "resolve workspace context");
  const matches = [];

  for (const [ideaId, idea] of Object.entries(config.ideas ?? {})) {
    const resolvedPlanningPath = resolveIdeaPlanningPath(config, ideaId, idea);
    const planningPath = resolveWorkspacePath(
      workspaceRoot,
      resolvedPlanningPath,
    );
    const resolvedRepositories = (idea.repositories ?? []).map((repository) => ({
      ...repository,
      resolvedPath: normalizeRelativePath(resolveRepositoryPath(config, repository)),
    }));
    if (isPathInside(planningPath, targetPath)) {
      matches.push({
        kind: "planning",
        idea: ideaId,
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
          idea: ideaId,
          spaceId: ideaId,
          repository,
          matchedPath: repositoryPath,
          planningPath: normalizeRelativePath(resolvedPlanningPath),
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
    spaceId: match?.spaceId ?? null,
    planningPath: match?.planningPath ?? null,
    repository: match?.repository ?? null,
    relatedRepositories: match?.repositories ?? [],
    config,
  };
}
