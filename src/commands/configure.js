import { readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import {
  assertValidConfig,
  getWorkspaceConfigPath,
  normalizeWorkspaceConfiguredPath,
  resolveWorkspacePath,
  writeWorkspaceConfig,
} from "../config.js";
import { SddError } from "../errors.js";
import { isDirectory, resolvePhysicalPath } from "../fs.js";
import {
  assertDistinctRepositoryOwnership,
  assertValidRepositoryArtifactTopology,
  findOperationConfiguration,
} from "../workspace.js";

const IGNORED_DIRECTORIES = new Set([
  ".agents",
  ".git",
  ".sdd",
  ".obsidian",
  ".next",
  "dist",
  "node_modules",
]);

function normalizePath(value) {
  return value.split("\\").join("/") || ".";
}

async function collectDirectories(searchRoot, configurationRoot = searchRoot, maxDepth = 3) {
  const directories = [];
  async function visit(directory, depth) {
    if (depth >= maxDepth) return;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name)) continue;
      const absolutePath = join(directory, entry.name);
      const configuredPath = normalizeWorkspaceConfiguredPath(configurationRoot, absolutePath);
      directories.push({ absolutePath, configuredPath });
      await visit(absolutePath, depth + 1);
    }
  }
  await visit(searchRoot, 0);
  return directories;
}

function suffixMatchCount(left, right) {
  const leftParts = normalizePath(left).split("/").reverse();
  const rightParts = normalizePath(right).split("/").reverse();
  let matches = 0;
  while (matches < leftParts.length && leftParts[matches] === rightParts[matches]) {
    matches += 1;
  }
  return matches;
}

async function scoreCandidate(candidate, configuredPath, expectedChildren) {
  let coverage = 0;
  for (const child of expectedChildren) {
    if (await isDirectory(join(candidate.absolutePath, child))) coverage += 1;
  }
  const basenameMatch = basename(candidate.configuredPath) === basename(configuredPath) ? 1 : 0;
  const suffixMatches = suffixMatchCount(candidate.configuredPath, configuredPath);
  const depth = candidate.configuredPath.split("/").length;
  return {
    ...candidate,
    coverage,
    score: coverage * 1000 + basenameMatch * 100 + suffixMatches * 10 - depth,
    eligible: coverage > 0 || basenameMatch > 0,
  };
}

async function suggestPath(candidates, configuredPath, expectedChildren) {
  const scored = await Promise.all(
    candidates.map((candidate) => scoreCandidate(candidate, configuredPath, expectedChildren)),
  );
  return scored
    .filter((candidate) => candidate.eligible)
    .sort(
      (left, right) =>
        right.score - left.score || left.configuredPath.localeCompare(right.configuredPath),
    )[0]?.configuredPath ?? null;
}

export async function inspectWorkspaceConfiguration(
  startPath,
  { workspaceRoot: requestedWorkspaceRoot = null } = {},
) {
  const { workspaceRoot, workspaceConfigSnapshot, config } = await findOperationConfiguration(
    startPath,
    requestedWorkspaceRoot ? { workspaceRoot: requestedWorkspaceRoot } : {},
  );
  assertValidConfig(config, "configure workspace paths");
  const searchRoot = resolve(startPath);
  const candidates = await collectDirectories(searchRoot, workspaceRoot);

  const planningMissing = !(await isDirectory(
    resolveWorkspacePath(workspaceRoot, config.planning.root),
  ));
  const planningChildren = Object.entries(config.ideas)
    .filter(([, idea]) => idea.planningPath === undefined)
    .map(([ideaId, idea]) => idea.planning ?? ideaId);
  const planning = {
    kind: "planning",
    from: config.planning.root,
    missing: planningMissing,
    suggestion: planningMissing
      ? await suggestPath(candidates, config.planning.root, planningChildren)
      : config.planning.root,
  };

  const repositoryRoots = [];
  for (const [rootId, configuredPath] of Object.entries(config.repositories.roots)) {
    const missing = !(await isDirectory(resolveWorkspacePath(workspaceRoot, configuredPath)));
    const expectedChildren = Object.values(config.ideas)
      .flatMap((idea) => idea.repositories ?? [])
      .filter((repository) => repository.root === rootId)
      .map((repository) => repository.path);
    repositoryRoots.push({
      kind: "repository",
      rootId,
      from: configuredPath,
      missing,
      suggestion: missing
        ? await suggestPath(candidates, configuredPath, expectedChildren)
        : configuredPath,
    });
  }

  return { workspaceRoot, workspaceConfigSnapshot, config, planning, repositoryRoots };
}

export async function configureWorkspace(
  startPath,
  {
    planningRoot,
    repositoryRoots = {},
    acceptSuggestions = false,
    dryRun = false,
    workspaceRoot: requestedWorkspaceRoot = null,
    beforeConfigPublish = null,
  } = {},
) {
  const inspection = await inspectWorkspaceConfiguration(startPath, {
    workspaceRoot: requestedWorkspaceRoot,
  });
  const { workspaceRoot, workspaceConfigSnapshot, config, planning } = inspection;
  const unknownRootIds = Object.keys(repositoryRoots).filter(
    (rootId) => !Object.hasOwn(config.repositories.roots, rootId),
  );
  if (unknownRootIds.length > 0) {
    throw new SddError("Unknown repository root name.", {
      code: "REPOSITORY_ROOT_NOT_FOUND",
      details: unknownRootIds.map((rootId) => `Unknown repository root: ${rootId}`),
    });
  }

  const pending = [];
  const requestedPlanningRoot =
    planningRoot ?? (planning.missing && acceptSuggestions ? planning.suggestion : null);
  const selectedPlanningRoot = requestedPlanningRoot
    ? normalizeWorkspaceConfiguredPath(workspaceRoot, requestedPlanningRoot)
    : null;
  if (planning.missing && !selectedPlanningRoot) {
    pending.push(
      `Planning root ${planning.from} is missing.${planning.suggestion ? ` Suggested: ${planning.suggestion}.` : ""}`,
    );
  }

  const selectedRepositoryRoots = {};
  for (const root of inspection.repositoryRoots) {
    const selected =
      repositoryRoots[root.rootId] ?? (root.missing && acceptSuggestions ? root.suggestion : null);
    if (root.missing && !selected) {
      pending.push(
        `Repository root ${root.rootId} (${root.from}) is missing.${root.suggestion ? ` Suggested: ${root.suggestion}.` : ""}`,
      );
    }
    if (selected) {
      selectedRepositoryRoots[root.rootId] = normalizeWorkspaceConfiguredPath(
        workspaceRoot,
        selected,
      );
    }
  }
  if (pending.length > 0) {
    throw new SddError("Workspace paths require configuration.", {
      code: "CONFIG_INPUT_REQUIRED",
      details: [
        ...pending,
        "Run interactively, pass explicit path flags, or use --yes to accept available suggestions.",
      ],
    });
  }

  const selectedPaths = [
    ...(selectedPlanningRoot ? [{ label: "Planning root", path: selectedPlanningRoot }] : []),
    ...Object.entries(selectedRepositoryRoots).map(([rootId, path]) => ({
      label: `Repository root ${rootId}`,
      path,
    })),
  ];
  for (const selected of selectedPaths) {
    const absolutePath = resolveWorkspacePath(workspaceRoot, selected.path);
    if (!(await isDirectory(await resolvePhysicalPath(absolutePath)))) {
      throw new SddError(`${selected.label} does not exist: ${selected.path}`, {
        code: "CONFIG_PATH_NOT_FOUND",
      });
    }
  }

  const nextConfig = structuredClone(config);
  if (selectedPlanningRoot) nextConfig.planning.root = selectedPlanningRoot;
  for (const [rootId, configuredPath] of Object.entries(selectedRepositoryRoots)) {
    nextConfig.repositories.roots[rootId] = configuredPath;
  }
  assertValidConfig(nextConfig, "configure workspace paths");
  await assertDistinctRepositoryOwnership(workspaceRoot, nextConfig);
  await assertValidRepositoryArtifactTopology(workspaceRoot, nextConfig);

  const changes = [];
  if (nextConfig.planning.root !== config.planning.root) {
    changes.push({ kind: "planning", from: config.planning.root, to: nextConfig.planning.root });
  }
  for (const [rootId, configuredPath] of Object.entries(nextConfig.repositories.roots)) {
    if (configuredPath !== config.repositories.roots[rootId]) {
      changes.push({
        kind: "repository",
        rootId,
        from: config.repositories.roots[rootId],
        to: configuredPath,
      });
    }
  }
  if (!dryRun && changes.length > 0) {
    await writeWorkspaceConfig(workspaceRoot, nextConfig, {
      expected: workspaceConfigSnapshot,
      beforePublish: beforeConfigPublish,
    });
  }
  return {
    command: "configure",
    workspaceRoot,
    workspaceConfigPath: getWorkspaceConfigPath(workspaceRoot),
    dryRun,
    changed: changes.length > 0,
    changes,
    planningRoot: nextConfig.planning.root,
    repositoryRoots: nextConfig.repositories.roots,
  };
}
