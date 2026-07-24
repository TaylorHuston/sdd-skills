import { resolveRepositoryPath, resolveWorkspaceStatus } from "./config.js";
import { SddError } from "./errors.js";

function normalizePath(value) {
  return value.split("\\").join("/");
}

export function resolvedActiveRepositories(config, space) {
  return (space.repositories ?? []).map((repository) => ({
    ...repository,
    ...(repository.id ? { id: repository.id } : {}),
    ...(repository.artifacts ? { artifacts: repository.artifacts } : {}),
    status: resolveWorkspaceStatus(repository.status),
    resolvedPath: normalizePath(resolveRepositoryPath(config, repository)),
  })).filter((repository) => repository.status === "active");
}

export function selectRepositories(available, requested, { allowNone = true } = {}) {
  if (requested.length === 0) {
    if (available.length === 1 || (allowNone && available.length === 0)) return available;
    if (available.length === 0) {
      throw new SddError("This Space has no active repository to receive the Change.", {
        code: "REPOSITORY_REQUIRED",
      });
    }
    throw new SddError("This Space maps to multiple repositories; select at least one with --repo.", {
      code: "REPOSITORY_REQUIRED",
      details: available.map((repository) => `Available repository: ${repository.resolvedPath}`),
    });
  }

  const selected = new Map();
  for (const value of requested) {
    const matches = available.filter(
      (repository) => repository.resolvedPath === value || repository.path === value,
    );
    if (matches.length !== 1) {
      throw new SddError(`Unknown repository for this Space: ${value}`, {
        code: "REPOSITORY_NOT_FOUND",
        details: available.map((repository) => `Available repository: ${repository.resolvedPath}`),
      });
    }
    selected.set(matches[0].resolvedPath, matches[0]);
  }
  return [...selected.values()];
}
