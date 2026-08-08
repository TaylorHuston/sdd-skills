import {
  assertValidRepositoryConfig,
  readRepositoryConfig,
  resolveRepositoryPath,
  resolveWorkspacePath,
  resolveWorkspaceStatus,
} from "./config.js";
import { SddError } from "./errors.js";

function normalizePath(value) {
  return value.split("\\").join("/");
}

function resolvedRepository(config, repository) {
  return {
    ...repository,
    ...(repository.id ? { id: repository.id } : {}),
    ...(repository.artifacts ? { artifacts: repository.artifacts } : {}),
    status: resolveWorkspaceStatus(repository.status),
    resolvedPath: normalizePath(resolveRepositoryPath(config, repository)),
  };
}

// Epic creation still selects by mapped path and does not need portable identity.
export function resolvedActiveRepositories(config, space) {
  return (space.repositories ?? [])
    .map((repository) => resolvedRepository(config, repository))
    .filter((repository) => repository.status === "active");
}

export async function resolveRepositoryTargets(
  workspaceRoot,
  config,
  space,
  { activeOnly = false } = {},
) {
  const targets = [];
  const claimedIds = new Map();
  for (const repository of space.repositories ?? []) {
    const resolved = resolvedRepository(config, repository);
    if (activeOnly && resolved.status !== "active") continue;
    const repositoryRoot = resolveWorkspacePath(workspaceRoot, resolved.resolvedPath);
    const repositoryConfig = await readRepositoryConfig(repositoryRoot);
    if (!repositoryConfig) {
      throw new SddError(`Mapped repository has no portable SDD repository identity: ${resolved.resolvedPath}`, {
        code: "REPOSITORY_ID_REQUIRED",
        details: ["Run `sdd init` in the repository before targeting it from a Change."],
      });
    }
    assertValidRepositoryConfig(repositoryConfig);
    const previous = claimedIds.get(repositoryConfig.id);
    if (previous && previous !== resolved.resolvedPath) {
      throw new SddError(`Repository ID ${repositoryConfig.id} is claimed by multiple mapped repositories.`, {
        code: "REPOSITORY_ID_COLLISION",
        details: [previous, resolved.resolvedPath],
      });
    }
    claimedIds.set(repositoryConfig.id, resolved.resolvedPath);
    targets.push({ ...resolved, id: repositoryConfig.id, artifacts: repositoryConfig.artifacts });
  }
  return targets;
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
      details: available.map((repository) =>
        `Available repository: ${repository.id ? `${repository.id} (${repository.resolvedPath})` : repository.resolvedPath}`),
    });
  }

  const selected = new Map();
  for (const value of requested) {
    const matches = available.filter(
      (repository) => repository.id === value
        || repository.resolvedPath === value
        || repository.path === value,
    );
    if (matches.length !== 1) {
      throw new SddError(`Unknown repository for this Space: ${value}`, {
        code: "REPOSITORY_NOT_FOUND",
        details: available.map((repository) =>
          `Available repository: ${repository.id ? `${repository.id} (${repository.resolvedPath})` : repository.resolvedPath}`),
      });
    }
    selected.set(matches[0].id ?? matches[0].resolvedPath, matches[0]);
  }
  return [...selected.values()];
}

export function repositoriesForMetadata(available, repositoryIds) {
  const byId = new Map(available.map((repository) => [repository.id, repository]));
  const selected = [];
  for (const repositoryId of repositoryIds) {
    const repository = byId.get(repositoryId);
    if (!repository) {
      throw new SddError(`Change references an unknown repository ID for its Space: ${repositoryId}`, {
        code: "REPOSITORY_NOT_FOUND",
        details: available.map((entry) => `Available repository: ${entry.id} (${entry.resolvedPath})`),
      });
    }
    selected.push(repository);
  }
  return selected;
}
