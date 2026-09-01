import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  assertRepositoryConfigSnapshotCurrent,
  assertValidRepositoryConfig,
  readRepositoryConfigSnapshot,
  resolveRepositoryPath,
  resolveRepositoryArtifactPath,
  resolveWorkspacePath,
  resolveWorkspaceStatus,
} from "./config.js";
import { SddError } from "./errors.js";
import { isPathInside, resolvePhysicalPath } from "./fs.js";

const REPOSITORY_SELECTION_AUTHORITY = Symbol("repository-selection-authority");

function normalizePath(value) {
  return value.split("\\").join("/");
}
async function captureRepositoryRootProof(repositoryRoot) {
  const logicalState = await lstat(repositoryRoot, { bigint: true });
  const physicalRoot = await resolvePhysicalPath(repositoryRoot);
  const physicalState = await lstat(physicalRoot, { bigint: true });
  if ((!logicalState.isDirectory() && !logicalState.isSymbolicLink())
    || !physicalState.isDirectory()
    || physicalState.isSymbolicLink()) {
    throw new SddError(`Mapped repository is not a real physical directory: ${repositoryRoot}`, {
      code: "UNSAFE_ARTIFACT_PATH",
    });
  }
  return {
    logicalIdentity: { dev: String(logicalState.dev), ino: String(logicalState.ino) },
    logicalMode: Number(logicalState.mode & 0o777n),
    logicalIsSymlink: logicalState.isSymbolicLink(),
    physicalRoot,
    physicalIdentity: { dev: String(physicalState.dev), ino: String(physicalState.ino) },
    physicalMode: Number(physicalState.mode & 0o777n),
  };
}


async function bindRepositorySelectionAuthority(
  target,
  mapping,
  repositoryRoot,
  snapshot,
  {
    collisionActiveOnly = false,
    collisionRequiresRepositoryKind = true,
    rootProof = null,
  } = {},
) {
  const selectedRootProof = rootProof ?? await captureRepositoryRootProof(repositoryRoot);
  const currentRootProof = await captureRepositoryRootProof(repositoryRoot);
  if (!isDeepStrictEqual(currentRootProof, selectedRootProof)) {
    throw repositorySelectionChanged(target, "Repository owner root changed during selection.");
  }
  const repositoryConfigSnapshot = snapshot === null
    ? null
    : structuredClone(snapshot);
  Object.defineProperties(target, {
    repositoryConfigSnapshot: {
      value: repositoryConfigSnapshot,
      enumerable: false,
    },
    [REPOSITORY_SELECTION_AUTHORITY]: {
      value: {
        mapping: structuredClone(mapping),
        repositoryRoot: resolve(repositoryRoot),
        collisionActiveOnly,
        collisionRequiresRepositoryKind,
        rootProof: selectedRootProof,
      },
      enumerable: false,
    },
  });
  return target;
}

function repositorySelectionChanged(repository, detail) {
  return new SddError(
    `Repository selection changed after it was resolved: ${repository.resolvedPath}`,
    {
      code: "CONCURRENT_CHANGE",
      ...(detail ? { details: [detail] } : {}),
    },
  );
}
export async function assertRepositoryArtifactRoots(
  repositoryRoot,
  artifacts,
  { repositoryPath = repositoryRoot, platform = process.platform } = {},
) {
  const absoluteRepositoryRoot = resolve(repositoryRoot);
  const configuredArtifacts = Object.entries(artifacts).map(([key, configuredPath]) => ({
    key,
    configuredPath,
    artifactRoot: resolveRepositoryArtifactPath(
      absoluteRepositoryRoot,
      configuredPath,
      { platform },
    ),
  }));
  const physicalRepositoryRoot = await resolvePhysicalPath(absoluteRepositoryRoot);
  const resolvedArtifacts = [];
  for (const { key, configuredPath, artifactRoot } of configuredArtifacts) {
    const physicalArtifactRoot = await resolvePhysicalPath(artifactRoot);
    if (
      !isPathInside(absoluteRepositoryRoot, artifactRoot)
      || !isPathInside(physicalRepositoryRoot, physicalArtifactRoot)
      || physicalArtifactRoot === physicalRepositoryRoot
    ) {
      throw new SddError("Cannot use a repository artifact root outside its physical owner.", {
        code: "UNSAFE_ARTIFACT_PATH",
        details: [`${repositoryPath}.${key}: ${configuredPath}`],
      });
    }
    resolvedArtifacts.push({ key, configuredPath, physicalPath: physicalArtifactRoot });
  }

  for (let leftIndex = 0; leftIndex < resolvedArtifacts.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < resolvedArtifacts.length;
      rightIndex += 1
    ) {
      const left = resolvedArtifacts[leftIndex];
      const right = resolvedArtifacts[rightIndex];
      if (
        isPathInside(left.physicalPath, right.physicalPath)
        || isPathInside(right.physicalPath, left.physicalPath)
      ) {
        throw new SddError("Cannot use overlapping physical repository artifact roots.", {
          code: "UNSAFE_ARTIFACT_PATH",
          details: [
            `${repositoryPath}.${left.key}: ${left.configuredPath}`,
            `${repositoryPath}.${right.key}: ${right.configuredPath}`,
          ],
        });
      }
    }
  }
  return artifacts;
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

function repositoryPathSelectors(repository) {
  const path = normalizePath(repository.path);
  return new Set([repository.id, path, repository.resolvedPath, path.split("/").at(-1)].filter(Boolean));
}

function repositoryFailureDetail(failure) {
  return `${failure.resolvedPath}: ${failure.code}`;
}

export function resolvedRepositories(config, space, { activeOnly = false } = {}) {
  return (space.repositories ?? [])
    .map((repository) => resolvedRepository(config, repository))
    .filter((repository) => !activeOnly || repository.status === "active");
}

function collisionWitnessError(error) {
  return {
    code: error instanceof SddError ? error.code : (error?.code ?? "REPOSITORY_CONFIG_UNAVAILABLE"),
    message: error?.message ?? String(error),
  };
}

async function captureRepositoryCollisionWitnesses(
  workspaceRoot,
  config,
  space,
  { activeOnly },
) {
  const witnesses = [];
  for (const mapping of resolvedRepositories(config, space, { activeOnly })) {
    const repositoryRoot = resolveWorkspacePath(workspaceRoot, mapping.resolvedPath);
    try {
      const snapshot = await readRepositoryConfigSnapshot(repositoryRoot, {
        includeMissingBinding: true,
      });
      witnesses.push({
        resolvedPath: mapping.resolvedPath,
        snapshot: structuredClone(snapshot),
      });
    } catch (error) {
      witnesses.push({
        resolvedPath: mapping.resolvedPath,
        error: collisionWitnessError(error),
      });
    }
  }
  return witnesses;
}

function collisionWitnessClaimedId(witness, requiresRepositoryKind) {
  if (!witness?.snapshot || witness.snapshot.missing === true) return null;
  if (requiresRepositoryKind && witness.snapshot.config?.kind !== "repository") return null;
  return typeof witness.snapshot.config?.id === "string"
    ? witness.snapshot.config.id
    : null;
}

function bindRepositoryCollisionWitnesses(repositories, witnesses) {
  for (const repository of repositories) {
    const authority = repository?.[REPOSITORY_SELECTION_AUTHORITY];
    if (!authority) {
      throw repositorySelectionChanged(repository, "Repository collision authority is missing.");
    }
    if (typeof repository.id !== "string") {
      authority.collisionWitnesses = [];
      continue;
    }
    const selectedWitness = witnesses.find(
      (witness) => witness.resolvedPath === authority.mapping.resolvedPath,
    );
    if (
      !selectedWitness?.snapshot
      || !isDeepStrictEqual(selectedWitness.snapshot, repository.repositoryConfigSnapshot)
    ) {
      throw repositorySelectionChanged(
        repository,
        "Selected repository contract changed while collision authority was captured.",
      );
    }
    const competing = witnesses.filter(
      (witness) =>
        witness.resolvedPath !== authority.mapping.resolvedPath
        && collisionWitnessClaimedId(
          witness,
          authority.collisionRequiresRepositoryKind,
        ) === repository.id,
    );
    if (competing.length > 0) {
      throw repositoryIdCollision(repository.id, [
        { mapping: authority.mapping },
        ...competing.map((witness) => ({
          mapping: { resolvedPath: witness.resolvedPath },
        })),
      ]);
    }
    authority.collisionWitnesses = structuredClone(witnesses);
  }
  return repositories;
}

export async function assertSelectedRepositorySnapshotsCurrent(
  workspaceRoot,
  config,
  space,
  repositories,
) {
  const currentMappings = resolvedRepositories(config, space);
  const selections = [];
  for (const repository of repositories) {
    const authority = repository?.[REPOSITORY_SELECTION_AUTHORITY];
    if (
      !authority
      || !Object.hasOwn(repository, "repositoryConfigSnapshot")
      || repository.resolvedPath !== authority.mapping.resolvedPath
      || !currentMappings.some((mapping) => isDeepStrictEqual(mapping, authority.mapping))
    ) {
      throw repositorySelectionChanged(repository, "Workspace repository mapping no longer matches.");
    }

    const repositoryRoot = resolveWorkspacePath(workspaceRoot, authority.mapping.resolvedPath);
    if (resolve(repositoryRoot) !== authority.repositoryRoot) {
      throw repositorySelectionChanged(repository, "Repository owner root no longer matches.");
    }
    let logicalState;
    let physicalRoot;
    let physicalState;
    try {
      logicalState = await lstat(repositoryRoot, { bigint: true });
      physicalRoot = await resolvePhysicalPath(repositoryRoot);
      physicalState = await lstat(physicalRoot, { bigint: true });
    } catch (error) {
      throw repositorySelectionChanged(repository, error.message);
    }
    const proof = authority.rootProof;
    if (
      !proof
      || String(logicalState.dev) !== proof.logicalIdentity?.dev
      || String(logicalState.ino) !== proof.logicalIdentity?.ino
      || Number(logicalState.mode & 0o777n) !== proof.logicalMode
      || logicalState.isSymbolicLink() !== proof.logicalIsSymlink
      || physicalRoot !== proof.physicalRoot
      || !physicalState.isDirectory()
      || physicalState.isSymbolicLink()
      || String(physicalState.dev) !== proof.physicalIdentity?.dev
      || String(physicalState.ino) !== proof.physicalIdentity?.ino
      || Number(physicalState.mode & 0o777n) !== proof.physicalMode
    ) {
      throw repositorySelectionChanged(repository, "Repository owner root changed physical identity.");
    }

    const snapshot = repository.repositoryConfigSnapshot;
    await assertRepositoryConfigSnapshotCurrent(repositoryRoot, snapshot);
    const snapshotMissing = snapshot === null || snapshot?.missing === true;
    const expectedId = snapshotMissing ? null : snapshot.config.id;
    const expectedArtifacts = snapshotMissing
      ? config.repositoryArtifacts
      : snapshot.config.artifacts;
    if (
      (snapshotMissing
        ? Object.hasOwn(repository, "id")
        : repository.id !== expectedId)
      || !isDeepStrictEqual(repository.artifacts, expectedArtifacts)
    ) {
      throw repositorySelectionChanged(
        repository,
        "Derived repository identity or artifact roots no longer match the bound contract.",
      );
    }
    if (!snapshotMissing) {
      try {
        assertValidRepositoryConfig(snapshot.config);
      } catch (error) {
        throw repositorySelectionChanged(repository, error.message);
      }
    }
    try {
      await assertRepositoryArtifactRoots(repositoryRoot, expectedArtifacts, {
        repositoryPath: repository.resolvedPath,
      });
    } catch (error) {
      throw repositorySelectionChanged(repository, error.message);
    }
    selections.push({ repository, authority });
  }

  for (const { repository, authority } of selections) {
    if (typeof repository.id !== "string") continue;
    const witnesses = authority.collisionWitnesses;
    const collisionMappings = resolvedRepositories(config, space, {
      activeOnly: authority.collisionActiveOnly,
    });
    if (
      !Array.isArray(witnesses)
      || witnesses.length !== collisionMappings.length
    ) {
      throw repositorySelectionChanged(
        repository,
        "Repository collision authority no longer matches the workspace mapping.",
      );
    }
    const witnessByPath = new Map(
      witnesses.map((witness) => [witness.resolvedPath, witness]),
    );
    for (const mapping of collisionMappings) {
      const witness = witnessByPath.get(mapping.resolvedPath);
      if (!witness) {
        throw repositorySelectionChanged(
          repository,
          `Repository collision authority is missing for ${mapping.resolvedPath}.`,
        );
      }
      const repositoryRoot = resolveWorkspacePath(workspaceRoot, mapping.resolvedPath);
      if (witness.snapshot) {
        try {
          await assertRepositoryConfigSnapshotCurrent(repositoryRoot, witness.snapshot);
        } catch (error) {
          throw repositorySelectionChanged(
            repository,
            `${mapping.resolvedPath}: ${error.message}`,
          );
        }
      } else {
        let currentError = null;
        try {
          await readRepositoryConfigSnapshot(repositoryRoot, {
            includeMissingBinding: true,
          });
        } catch (error) {
          currentError = collisionWitnessError(error);
        }
        if (
          currentError?.code === witness.error?.code
          && currentError.message === witness.error.message
        ) {
          continue;
        }
        throw repositorySelectionChanged(
          repository,
          currentError
            ? `${mapping.resolvedPath}: repository configuration error changed from ${witness.error?.code ?? "unknown"} to ${currentError.code}.`
            : `${mapping.resolvedPath}: repository configuration became readable after selection.`,
        );
      }
      if (
        mapping.resolvedPath !== authority.mapping.resolvedPath
        && collisionWitnessClaimedId(
          witness,
          authority.collisionRequiresRepositoryKind,
        ) === repository.id
      ) {
        throw repositorySelectionChanged(
          repository,
          `Repository ID ${repository.id} is now also claimed by ${mapping.resolvedPath}.`,
        );
      }
    }
  }
  return true;
}

export async function resolveRepositoryIdentity(
  workspaceRoot,
  repository,
  { collisionActiveOnly = false } = {},
) {
  const repositoryRoot = resolveWorkspacePath(workspaceRoot, repository.resolvedPath);
  const snapshot = await readRepositoryConfigSnapshot(repositoryRoot);
  const repositoryConfig = snapshot?.config?.kind === "repository"
    ? snapshot.config
    : null;
  if (!repositoryConfig) {
    throw new SddError(`Mapped repository has no portable SDD repository identity: ${repository.resolvedPath}`, {
      code: "REPOSITORY_ID_REQUIRED",
      details: ["Run `sdd init` in the repository before targeting it from a Change."],
    });
  }
  assertValidRepositoryConfig(repositoryConfig);
  const target = {
    ...repository,
    id: repositoryConfig.id,
    artifacts: repositoryConfig.artifacts,
  };
  await assertRepositoryArtifactRoots(repositoryRoot, target.artifacts, {
    repositoryPath: repository.resolvedPath,
  });
  return bindRepositorySelectionAuthority(
    target,
    repository,
    repositoryRoot,
    snapshot,
    { collisionActiveOnly },
  );
}

export async function resolveRepositoryTargets(
  workspaceRoot,
  config,
  space,
  { activeOnly = false } = {},
) {
  const targets = [];
  const claimedIds = new Map();
  for (const resolved of resolvedRepositories(config, space, { activeOnly })) {
    const target = await resolveRepositoryIdentity(
      workspaceRoot,
      resolved,
      { collisionActiveOnly: activeOnly },
    );
    const previous = claimedIds.get(target.id);
    if (previous && previous !== target.resolvedPath) {
      throw new SddError(`Repository ID ${target.id} is claimed by multiple mapped repositories.`, {
        code: "REPOSITORY_ID_COLLISION",
        details: [previous, target.resolvedPath],
      });
    }
    claimedIds.set(target.id, target.resolvedPath);
    targets.push(target);
  }
  return targets;
}

async function inspectCreateMapping(workspaceRoot, config, repository) {
  const resolved = resolvedRepository(config, repository);
  const repositoryRoot = resolveWorkspacePath(workspaceRoot, resolved.resolvedPath);
  let snapshot;
  let rootProof;
  try {
    rootProof = await captureRepositoryRootProof(repositoryRoot);
    snapshot = await readRepositoryConfigSnapshot(repositoryRoot, {
      includeMissingBinding: true,
    });
  } catch (error) {
    return {
      mapping: resolved,
      target: null,
      claimedId: null,
      missing: false,
      error,
    };
  }
  if (snapshot?.missing === true) {
    try {
      await assertRepositoryArtifactRoots(repositoryRoot, config.repositoryArtifacts, {
        repositoryPath: resolved.resolvedPath,
      });
      const target = { ...resolved, artifacts: config.repositoryArtifacts };
      delete target.id;
      return {
        mapping: resolved,
        target: await bindRepositorySelectionAuthority(
          target,
          resolved,
          repositoryRoot,
          snapshot,
          {
            collisionActiveOnly: true,
            collisionRequiresRepositoryKind: false,
            rootProof,
          },
        ),
        claimedId: null,
        missing: true,
        error: null,
      };
    } catch (error) {
      return {
        mapping: resolved,
        target: null,
        claimedId: null,
        missing: true,
        error,
      };
    }
  }

  const claimedId = typeof snapshot.config?.id === "string" ? snapshot.config.id : null;
  try {
    assertValidRepositoryConfig(snapshot.config);
    await assertRepositoryArtifactRoots(repositoryRoot, snapshot.config.artifacts, {
      repositoryPath: resolved.resolvedPath,
    });
    const target = {
      ...resolved,
      id: snapshot.config.id,
      artifacts: snapshot.config.artifacts,
    };
    return {
      mapping: resolved,
      target: await bindRepositorySelectionAuthority(
        target,
        resolved,
        repositoryRoot,
        snapshot,
        {
          collisionActiveOnly: true,
          collisionRequiresRepositoryKind: false,
          rootProof,
        },
      ),
      claimedId,
      missing: false,
      error: null,
    };
  } catch (error) {
    return {
      mapping: resolved,
      target: null,
      claimedId,
      missing: false,
      error,
    };
  }
}

function createMappingFailure(record, requireIdentity) {
  if (record.error) return record.error;
  if (record.missing && requireIdentity) {
    return new SddError(
      `Mapped repository has no portable SDD repository identity: ${record.mapping.resolvedPath}`,
      {
        code: "REPOSITORY_ID_REQUIRED",
        details: ["Run `sdd init` in the repository before targeting it from a Change."],
      },
    );
  }
  return null;
}

export async function inspectRepositoryIdentity(workspaceRoot, config, repository) {
  const record = await inspectCreateMapping(workspaceRoot, config, repository);
  return {
    claimedId: record.claimedId,
    target: record.target,
    error: createMappingFailure(record, true),
  };
}

function createSelectionDetails(records, pathFailures = []) {
  const available = records
    .filter((record) => record.target?.id)
    .map((record) =>
      `Available repository: ${record.target.id} (${record.mapping.resolvedPath})`);
  const failures = records
    .filter((record) => record.error || record.missing)
    .map((record) =>
      `${record.mapping.resolvedPath}: ${record.error?.code ?? "REPOSITORY_ID_REQUIRED"}`);
  return [...available, ...failures, ...pathFailures];
}

function repositoryIdCollision(repositoryId, records) {
  return new SddError(`Repository ID ${repositoryId} is claimed by multiple mapped repositories.`, {
    code: "REPOSITORY_ID_COLLISION",
    details: records.map((record) => record.mapping.resolvedPath),
  });
}

export async function selectRepositoryTargetsForCreate(
  workspaceRoot,
  config,
  space,
  requested,
  {
    allowNone = true,
    requireIdentity = true,
  } = {},
) {
  const mappings = resolvedRepositories(config, space, { activeOnly: true });
  const records = new Map();
  const inspect = async (mapping) => {
    const key = mapping.resolvedPath;
    if (!records.has(key)) {
      records.set(key, inspectCreateMapping(workspaceRoot, config, mapping));
    }
    return records.get(key);
  };

  let selectedMappings;
  if (requested.length === 0) {
    selectedMappings = await selectRepositories(mappings, requested, {
      allowNone,
      workspaceRoot,
    });
  } else {
    const selections = [];
    const pathFailures = [];
    for (const value of requested) {
      const matches = [];
      for (const mapping of mappings) {
        const pathOnly = { ...mapping };
        delete pathOnly.id;
        try {
          if (await repositoryMatchesSelector(workspaceRoot, pathOnly, value)) {
            matches.push(mapping);
          }
        } catch (error) {
          pathFailures.push(`${mapping.resolvedPath}: ${error?.code ?? error.message}`);
        }
      }
      if (matches.length > 1) {
        throw new SddError(`Repository selector resolves to multiple mappings: ${value}`, {
          code: "REPOSITORY_NOT_FOUND",
          details: matches.map((mapping) => `Matched repository: ${mapping.resolvedPath}`),
        });
      }
      selections.push(matches.length === 1 ? { mapping: matches[0] } : { value });
    }

    const needsIdentityLookup = selections.some((selection) => selection.value !== undefined);
    const inspected = needsIdentityLookup
      ? await Promise.all(mappings.map(inspect))
      : [];
    const selected = new Map();
    for (const selection of selections) {
      if (selection.mapping) {
        selected.set(selection.mapping.resolvedPath, selection.mapping);
        continue;
      }
      const claims = inspected.filter((record) => record.claimedId === selection.value);
      if (claims.length > 1) throw repositoryIdCollision(selection.value, claims);
      if (claims.length === 1) {
        const [record] = claims;
        const failure = createMappingFailure(record, requireIdentity);
        if (failure) throw failure;
        selected.set(record.mapping.resolvedPath, record.mapping);
        continue;
      }
      throw new SddError(`Unknown repository for this Space: ${selection.value}`, {
        code: "REPOSITORY_NOT_FOUND",
        details: createSelectionDetails(inspected, pathFailures),
      });
    }
    selectedMappings = [...selected.values()];
  }

  const selectedRecords = await Promise.all(selectedMappings.map(inspect));
  for (const record of selectedRecords) {
    const failure = createMappingFailure(record, requireIdentity);
    if (failure) throw failure;
  }

  const selectedIds = new Set(
    selectedRecords.map((record) => record.claimedId).filter(Boolean),
  );
  if (selectedIds.size > 0) {
    const inspected = await Promise.all(mappings.map(inspect));
    for (const repositoryId of selectedIds) {
      const claims = inspected.filter((record) => record.claimedId === repositoryId);
      if (claims.length > 1) throw repositoryIdCollision(repositoryId, claims);
    }
  }
  const targets = selectedRecords.map((record) => record.target);
  if (!targets.some((target) => typeof target.id === "string")) return targets;
  const witnesses = await captureRepositoryCollisionWitnesses(
    workspaceRoot,
    config,
    space,
    { activeOnly: true },
  );
  return bindRepositoryCollisionWitnesses(targets, witnesses);
}

function statusResolutionDiagnostic(repository, error) {
  return {
    level: "error",
    code: error instanceof SddError
      ? error.code
      : (error?.code ?? "REPOSITORY_CONFIG_UNAVAILABLE"),
    repository: repository.resolvedPath,
    message: `Cannot resolve mapped repository ${repository.resolvedPath}: ${error?.message ?? String(error)}`,
    details: error instanceof SddError ? error.details : [],
  };
}

function collisionDiagnostic(code, message, candidates) {
  const repositories = candidates
    .map(({ target }) => target.resolvedPath)
    .sort((left, right) => left.localeCompare(right));
  return {
    level: "error",
    code,
    repositories,
    message: `${message}: ${repositories.join(", ")}.`,
    details: repositories,
  };
}

export async function resolveRepositoryTargetsForStatus(
  workspaceRoot,
  config,
  space,
  { activeOnly = false } = {},
) {
  const candidates = [];
  const diagnostics = [];
  for (const repository of resolvedRepositories(config, space, { activeOnly })) {
    try {
      const target = await resolveRepositoryIdentity(workspaceRoot, repository);
      candidates.push({
        target,
        physicalPath: await resolvePhysicalPath(
          resolveWorkspacePath(workspaceRoot, target.resolvedPath),
        ),
      });
    } catch (error) {
      diagnostics.push(statusResolutionDiagnostic(repository, error));
    }
  }

  const candidatesById = new Map();
  const candidatesByPhysicalPath = new Map();
  for (const candidate of candidates) {
    const byId = candidatesById.get(candidate.target.id) ?? [];
    byId.push(candidate);
    candidatesById.set(candidate.target.id, byId);
    const byPhysicalPath = candidatesByPhysicalPath.get(candidate.physicalPath) ?? [];
    byPhysicalPath.push(candidate);
    candidatesByPhysicalPath.set(candidate.physicalPath, byPhysicalPath);
  }

  const conflicted = new Set();
  for (const [repositoryId, claimed] of candidatesById) {
    if (claimed.length < 2) continue;
    claimed.forEach((candidate) => conflicted.add(candidate));
    diagnostics.push(collisionDiagnostic(
      "REPOSITORY_ID_COLLISION",
      `Repository ID ${repositoryId} is claimed by multiple mapped repositories`,
      claimed,
    ));
  }
  for (const claimed of candidatesByPhysicalPath.values()) {
    if (claimed.length < 2) continue;
    claimed.forEach((candidate) => conflicted.add(candidate));
    diagnostics.push(collisionDiagnostic(
      "REPOSITORY_OWNERSHIP_COLLISION",
      "Mapped paths resolve to one physical repository",
      claimed,
    ));
  }

  return {
    repositories: candidates
      .filter((candidate) => !conflicted.has(candidate))
      .map(({ target }) => target),
    diagnostics,
  };
}

export async function repositoryMatchesSelector(workspaceRoot, repository, value) {
  if (
    repository.id === value
    || repository.resolvedPath === value
    || repository.path === value
  ) {
    return true;
  }
  if (!workspaceRoot) return false;
  try {
    const [physicalRepository, physicalSelector] = await Promise.all([
      resolvePhysicalPath(resolveWorkspacePath(workspaceRoot, repository.resolvedPath)),
      resolvePhysicalPath(resolveWorkspacePath(workspaceRoot, value)),
    ]);
    return physicalRepository === physicalSelector;
  } catch (error) {
    if (error?.code === "ENOTDIR") return false;
    throw error;
  }
}

export async function selectRepositories(
  available,
  requested,
  { allowNone = true, workspaceRoot = null } = {},
) {
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
    const matchFlags = await Promise.all(
      available.map((repository) =>
        repositoryMatchesSelector(workspaceRoot, repository, value)),
    );
    const matches = available.filter((_, index) => matchFlags[index]);
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

export async function resolveRepositoriesForMetadata(
  workspaceRoot,
  config,
  space,
  repositoryIds,
) {
  if (repositoryIds.length === 0) return [];

  const requested = new Set(repositoryIds);
  const selected = new Map();
  const available = [];
  const failures = [];

  for (const repository of space.repositories ?? []) {
    const resolved = resolvedRepository(config, repository);
    const repositoryRoot = resolveWorkspacePath(workspaceRoot, resolved.resolvedPath);
    let snapshot;
    try {
      snapshot = await readRepositoryConfigSnapshot(repositoryRoot);
    } catch (error) {
      failures.push({
        resolvedPath: resolved.resolvedPath,
        selectors: repositoryPathSelectors(resolved),
        code: error instanceof SddError ? error.code : (error?.code ?? "REPOSITORY_CONFIG_UNAVAILABLE"),
      });
      continue;
    }
    const repositoryConfig = snapshot?.config?.kind === "repository"
      ? snapshot.config
      : null;
    if (!repositoryConfig) {
      failures.push({
        resolvedPath: resolved.resolvedPath,
        selectors: repositoryPathSelectors(resolved),
        code: "REPOSITORY_ID_REQUIRED",
      });
      continue;
    }

    if (typeof repositoryConfig.id === "string") {
      available.push({ id: repositoryConfig.id, resolvedPath: resolved.resolvedPath });
    }
    if (!requested.has(repositoryConfig.id)) continue;

    try {
      assertValidRepositoryConfig(repositoryConfig);
    } catch (error) {
      failures.push({
        repositoryId: repositoryConfig.id,
        resolvedPath: resolved.resolvedPath,
        selectors: repositoryPathSelectors(resolved),
        code: error instanceof SddError ? error.code : (error?.code ?? "INVALID_REPOSITORY_CONFIG"),
      });
      continue;
    }

    const target = {
      ...resolved,
      id: repositoryConfig.id,
      artifacts: repositoryConfig.artifacts,
    };
    await assertRepositoryArtifactRoots(repositoryRoot, target.artifacts, {
      repositoryPath: target.resolvedPath,
    });
    const previous = selected.get(repositoryConfig.id);
    if (previous && previous.resolvedPath !== resolved.resolvedPath) {
      throw new SddError(`Repository ID ${repositoryConfig.id} is claimed by multiple mapped repositories.`, {
        code: "REPOSITORY_ID_COLLISION",
        details: [previous.resolvedPath, resolved.resolvedPath],
      });
    }
    selected.set(
      repositoryConfig.id,
      await bindRepositorySelectionAuthority(
        target,
        resolved,
        repositoryRoot,
        snapshot,
        {
          collisionActiveOnly: false,
          collisionRequiresRepositoryKind: true,
        },
      ),
    );
  }

  for (const repositoryId of repositoryIds) {
    const declaredFailures = failures.filter((failure) => failure.repositoryId === repositoryId);
    if (selected.has(repositoryId) && declaredFailures.length === 0) continue;
    const likelyFailures = failures.filter(
      (failure) => failure.repositoryId === repositoryId || failure.selectors.has(repositoryId),
    );
    const resolutionFailures = [
      ...likelyFailures,
      ...failures.filter((failure) => !likelyFailures.includes(failure)),
    ];
    if (resolutionFailures.length > 0) {
      throw new SddError(`Change repository ID cannot be resolved for its Space: ${repositoryId}`, {
        code: "REPOSITORY_ID_REQUIRED",
        details: [
          ...resolutionFailures.map(repositoryFailureDetail),
          "Restore or initialize the targeted repository before changing lifecycle state.",
        ],
      });
    }
    throw new SddError(`Change references an unknown repository ID for its Space: ${repositoryId}`, {
      code: "REPOSITORY_NOT_FOUND",
      details: [
        ...available.map((entry) => `Available repository: ${entry.id} (${entry.resolvedPath})`),
        ...failures.map(repositoryFailureDetail),
      ],
    });
  }

  const targets = repositoryIds.map((repositoryId) => selected.get(repositoryId));
  const witnesses = await captureRepositoryCollisionWitnesses(
    workspaceRoot,
    config,
    space,
    { activeOnly: false },
  );
  return bindRepositoryCollisionWitnesses(targets, witnesses);
}
