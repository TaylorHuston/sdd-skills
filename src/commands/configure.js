import { readdir } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

import {
  assertValidConfig,
  findWorkspaceRoot,
  getConfigPath,
  readConfig,
  resolveWorkspacePath,
  writeConfig,
} from "../config.js";
import { SddError } from "../errors.js";
import { isDirectory } from "../fs.js";

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

async function collectDirectories(workspaceRoot, maxDepth = 3) {
  const directories = [];
  async function visit(directory, depth) {
    if (depth >= maxDepth) return;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name)) continue;
      const absolutePath = join(directory, entry.name);
      const configuredPath = normalizePath(relative(workspaceRoot, absolutePath));
      directories.push({ absolutePath, configuredPath });
      await visit(absolutePath, depth + 1);
    }
  }
  await visit(workspaceRoot, 0);
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

export async function inspectWorkspaceConfiguration(startPath) {
  const workspaceRoot = await findWorkspaceRoot(startPath);
  const config = await readConfig(workspaceRoot);
  assertValidConfig(config, "configure workspace paths");
  const candidates = await collectDirectories(workspaceRoot);

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

  return { workspaceRoot, config, planning, repositoryRoots };
}

export async function configureWorkspace(
  startPath,
  {
    planningRoot,
    repositoryRoots = {},
    acceptSuggestions = false,
    dryRun = false,
  } = {},
) {
  const inspection = await inspectWorkspaceConfiguration(startPath);
  const { workspaceRoot, config, planning } = inspection;
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
  const selectedPlanningRoot =
    planningRoot ?? (planning.missing && acceptSuggestions ? planning.suggestion : null);
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
    if (selected) selectedRepositoryRoots[root.rootId] = selected;
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
    if (!(await isDirectory(resolveWorkspacePath(workspaceRoot, selected.path)))) {
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
  if (!dryRun && changes.length > 0) await writeConfig(workspaceRoot, nextConfig);
  return {
    command: "configure",
    workspaceRoot,
    configPath: getConfigPath(workspaceRoot),
    dryRun,
    changed: changes.length > 0,
    changes,
    planningRoot: nextConfig.planning.root,
    repositoryRoots: nextConfig.repositories.roots,
  };
}
