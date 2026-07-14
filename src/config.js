import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseDocument, stringify } from "yaml";

import {
  CONFIG_DIRECTORY_NAME,
  CONFIG_FILE_NAME,
  CONFIG_VERSION,
  DEFAULT_ARTIFACT_PATHS,
  INSTALL_LOCK_FILE_NAME,
  SCHEMA_VERSION,
} from "./constants.js";
import { SddError } from "./errors.js";
import { isDirectory, isPathInside, pathExists } from "./fs.js";

export const WORKSPACE_STATUSES = Object.freeze(["active", "inactive", "archived"]);

export function resolveWorkspaceStatus(value) {
  return value ?? "active";
}

export function getConfigDirectory(workspaceRoot) {
  return join(workspaceRoot, CONFIG_DIRECTORY_NAME);
}

export function getConfigPath(workspaceRoot) {
  return join(getConfigDirectory(workspaceRoot), CONFIG_FILE_NAME);
}

export function getInstallLockPath(workspaceRoot) {
  return join(getConfigDirectory(workspaceRoot), INSTALL_LOCK_FILE_NAME);
}

function parseYaml(source, sourcePath) {
  const document = parseDocument(source);
  if (document.errors.length > 0) {
    throw new SddError(`Cannot parse YAML at ${sourcePath}: ${document.errors[0].message}`, {
      code: "INVALID_YAML",
    });
  }
  return document.toJS();
}

export async function readConfig(workspaceRoot) {
  const path = getConfigPath(workspaceRoot);
  if (!(await pathExists(path))) {
    throw new SddError(`No SDD workspace found at ${workspaceRoot}. Run \`sdd init\` first.`, {
      code: "WORKSPACE_NOT_INITIALIZED",
    });
  }
  return parseYaml(await readFile(path, "utf8"), path);
}

export async function writeConfig(workspaceRoot, config) {
  const path = getConfigPath(workspaceRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stringify(config, { lineWidth: 0, sortMapEntries: false }), "utf8");
}

export async function findWorkspaceRoot(startPath) {
  let current = resolve(startPath);
  while (true) {
    if (await pathExists(getConfigPath(current))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new SddError(`No .sdd/${CONFIG_FILE_NAME} found from ${resolve(startPath)} upward.`, {
        code: "WORKSPACE_NOT_FOUND",
      });
    }
    current = parent;
  }
}

async function detectRoot(workspaceRoot, candidates, fallback) {
  for (const candidate of candidates) {
    if (await isDirectory(join(workspaceRoot, candidate))) {
      return candidate;
    }
  }
  return fallback;
}

function parseFrontmatter(source, sourcePath) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return {};
  }
  const parsed = parseYaml(match[1], sourcePath);
  return parsed && typeof parsed === "object" ? parsed : {};
}

function normalizeRepositoryEntries(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (typeof entry === "string") {
      return [{ path: entry, status: "active" }];
    }
    if (!entry || typeof entry !== "object" || typeof entry.path !== "string") {
      return [];
    }
    return [{
      path: entry.path,
      ...(entry.role ? { role: String(entry.role) } : {}),
      status: WORKSPACE_STATUSES.includes(entry.status) ? entry.status : "active",
    }];
  });
}

function normalizePath(value) {
  return value.split("\\").join("/") || ".";
}

export function createRepositoryRootMap(paths) {
  const roots = {};
  for (const [index, path] of paths.entries()) {
    const baseId =
      basename(path)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || `repository-${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (Object.hasOwn(roots, id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    roots[id] = normalizePath(path);
  }
  return roots;
}

function toRepositoryReference(workspaceRoot, repository, repositoryRoots) {
  const repositoryPath = resolve(workspaceRoot, repository.path);
  const matches = Object.entries(repositoryRoots)
    .map(([root, path]) => ({ root, path, absolutePath: resolve(workspaceRoot, path) }))
    .filter((entry) => isPathInside(entry.absolutePath, repositoryPath))
    .sort((left, right) => right.absolutePath.length - left.absolutePath.length);

  const role = repository.role ? { role: repository.role } : {};
  const status = { status: resolveWorkspaceStatus(repository.status) };
  if (matches.length === 0) {
    return { path: normalizePath(repository.path), ...role, ...status };
  }
  const match = matches[0];
  return {
    root: match.root,
    path: normalizePath(relative(match.absolutePath, repositoryPath)),
    ...role,
    ...status,
  };
}

export async function importIdeas(workspaceRoot, planningRoot, repositoryRoots) {
  const absolutePlanningRoot = join(workspaceRoot, planningRoot);
  if (!(await isDirectory(absolutePlanningRoot))) {
    return {};
  }

  const entries = await readdir(absolutePlanningRoot, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .sort((left, right) => left.name.localeCompare(right.name));

  const ideas = {};
  for (const directory of directories) {
    const planningPath = join(planningRoot, directory.name);
    const manifestPath = join(workspaceRoot, planningPath, `${directory.name}.md`);
    let repositories = [];
    let status = "active";
    if (await pathExists(manifestPath)) {
      const frontmatter = parseFrontmatter(await readFile(manifestPath, "utf8"), manifestPath);
      status = WORKSPACE_STATUSES.includes(frontmatter.status) ? frontmatter.status : "active";
      repositories = normalizeRepositoryEntries(frontmatter.repositories).map((repository) =>
        toRepositoryReference(workspaceRoot, repository, repositoryRoots),
      );
    }
    ideas[directory.name] = {
      status,
      repositories,
    };
  }
  return ideas;
}

export async function createInitialConfig(
  workspaceRoot,
  { planningRoot, repositoryRoots, skillsDirectory } = {},
) {
  const detectedPlanningRoot =
    planningRoot ??
    (await detectRoot(
      workspaceRoot,
      ["03-spaces/ideas", "spaces/ideas", "ideas", "planning"],
      "planning",
    ));
  const detectedRepositoryRoots =
    repositoryRoots?.length > 0
      ? repositoryRoots
      : [
          await detectRoot(
            workspaceRoot,
            ["03-spaces/code", "spaces/code", "code", "repositories"],
            "code",
          ),
        ];
  const repositoryRootMap = createRepositoryRootMap(detectedRepositoryRoots);

  return {
    version: CONFIG_VERSION,
    schema: SCHEMA_VERSION,
    skills: {
      directory: skillsDirectory ?? ".agents/skills",
    },
    planning: {
      root: detectedPlanningRoot,
      plannedChangesDirectory: "planned-changes",
    },
    repositories: {
      roots: repositoryRootMap,
    },
    repositoryArtifacts: { ...DEFAULT_ARTIFACT_PATHS },
    ideas: await importIdeas(workspaceRoot, detectedPlanningRoot, repositoryRootMap),
  };
}

export function migrateConfig(config, workspaceRoot) {
  if (config?.version !== 1 || config?.schema !== "sdd-v1") {
    return { config, migratedFrom: null };
  }

  const legacyRoots = Array.isArray(config.repositories?.roots) ? config.repositories.roots : [];
  const repositoryRoots = createRepositoryRootMap(legacyRoots);
  const planningRoot = config.planning?.root;
  const ideas = {};

  for (const [ideaId, idea] of Object.entries(config.ideas ?? {})) {
    const migratedIdea = {
      status: resolveWorkspaceStatus(idea?.status),
      repositories: [],
    };
    if (typeof idea?.planning === "string" && typeof planningRoot === "string") {
      const absolutePlanningRoot = resolve(workspaceRoot, planningRoot);
      const absoluteIdeaPlanning = resolve(workspaceRoot, idea.planning);
      if (isPathInside(absolutePlanningRoot, absoluteIdeaPlanning)) {
        const relativePlanning = normalizePath(relative(absolutePlanningRoot, absoluteIdeaPlanning));
        if (relativePlanning !== ideaId) {
          migratedIdea.planning = relativePlanning;
        }
      } else {
        migratedIdea.planningPath = normalizePath(idea.planning);
      }
    }
    migratedIdea.repositories = (idea?.repositories ?? []).map((repository) =>
      toRepositoryReference(workspaceRoot, repository, repositoryRoots),
    );
    ideas[ideaId] = migratedIdea;
  }

  return {
    migratedFrom: 1,
    config: {
      ...config,
      version: CONFIG_VERSION,
      schema: SCHEMA_VERSION,
      repositories: { roots: repositoryRoots },
      ideas,
    },
  };
}

export function resolveIdeaPlanningPath(config, ideaId, idea) {
  return idea.planningPath ?? join(config.planning.root, idea.planning ?? ideaId);
}

export function resolveRepositoryPath(config, repository) {
  return repository.root
    ? join(config.repositories.roots[repository.root], repository.path)
    : repository.path;
}

export function validateConfig(config) {
  const findings = [];
  const error = (message) => findings.push({ level: "error", message });
  const validatePath = (label, path) => {
    if (typeof path !== "string" || !path) {
      error(`${label} must be a non-empty path.`);
      return false;
    }
    if (
      isAbsolute(path) ||
      /^[A-Za-z]:[\\/]/.test(path) ||
      path.split(/[\\/]/).includes("..")
    ) {
      error(`${label} must be relative and cannot traverse to a parent directory.`);
      return false;
    }
    return true;
  };

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return [{ level: "error", message: "Configuration must be a YAML mapping." }];
  }
  if (config.version !== CONFIG_VERSION) {
    error(`Configuration version must be ${CONFIG_VERSION}.`);
  }
  if (config.schema !== SCHEMA_VERSION) {
    error(`Configuration schema must be ${SCHEMA_VERSION}.`);
  }
  validatePath("skills.directory", config.skills?.directory);
  validatePath("planning.root", config.planning?.root);
  validatePath("planning.plannedChangesDirectory", config.planning?.plannedChangesDirectory);
  if (
    !config.repositories?.roots ||
    typeof config.repositories.roots !== "object" ||
    Array.isArray(config.repositories.roots) ||
    Object.keys(config.repositories.roots).length === 0
  ) {
    error("repositories.roots must contain at least one named path.");
  } else {
    for (const [rootId, path] of Object.entries(config.repositories.roots)) {
      validatePath(`repositories.roots.${rootId}`, path);
    }
  }
  if (
    !config.repositoryArtifacts ||
    typeof config.repositoryArtifacts !== "object" ||
    Array.isArray(config.repositoryArtifacts)
  ) {
    error("repositoryArtifacts must be a mapping.");
  } else {
    for (const key of Object.keys(DEFAULT_ARTIFACT_PATHS)) {
      validatePath(`repositoryArtifacts.${key}`, config.repositoryArtifacts[key]);
    }
  }
  if (!config.ideas || typeof config.ideas !== "object" || Array.isArray(config.ideas)) {
    error("ideas must be a mapping.");
  } else {
    const claimedRepositories = new Map();
    for (const [ideaId, idea] of Object.entries(config.ideas)) {
      if (!ideaId) {
        error("ideas keys must be non-empty Space IDs.");
        continue;
      }
      if (!idea || typeof idea !== "object" || Array.isArray(idea)) {
        error(`ideas.${ideaId} must be a mapping.`);
        continue;
      }
      if (idea.status !== undefined && !WORKSPACE_STATUSES.includes(idea.status)) {
        error(`ideas.${ideaId}.status must be one of: ${WORKSPACE_STATUSES.join(", ")}.`);
      }
      if (idea.planning !== undefined) {
        validatePath(`ideas.${ideaId}.planning`, idea.planning);
      }
      if (idea.planningPath !== undefined) {
        validatePath(`ideas.${ideaId}.planningPath`, idea.planningPath);
      }
      if (idea.planning !== undefined && idea.planningPath !== undefined) {
        error(`ideas.${ideaId} cannot define both planning and planningPath.`);
      }
      if (!Array.isArray(idea.repositories)) {
        error(`ideas.${ideaId}.repositories must be a list.`);
        continue;
      }
      for (const repository of idea.repositories) {
        if (!repository || typeof repository.path !== "string") {
          error(`ideas.${ideaId}.repositories entries must contain a path.`);
          continue;
        }
        validatePath(`ideas.${ideaId}.repositories path`, repository.path);
        if (repository.root !== undefined) {
          if (typeof repository.root !== "string" || !repository.root) {
            error(`ideas.${ideaId}.repositories root must be a non-empty name.`);
          } else if (!Object.hasOwn(config.repositories?.roots ?? {}, repository.root)) {
            error(`ideas.${ideaId}.repositories references unknown root ${repository.root}.`);
          }
        }
        if (repository.role !== undefined && (typeof repository.role !== "string" || !repository.role)) {
          error(`ideas.${ideaId}.repositories role must be a non-empty string.`);
        }
        if (repository.status !== undefined && !WORKSPACE_STATUSES.includes(repository.status)) {
          error(
            `ideas.${ideaId}.repositories status must be one of: ${WORKSPACE_STATUSES.join(", ")}.`,
          );
        }
        const resolvedRepository =
          repository.root && Object.hasOwn(config.repositories?.roots ?? {}, repository.root)
            ? resolveRepositoryPath(config, repository)
            : repository.path;
        const existingOwner = claimedRepositories.get(resolvedRepository);
        if (existingOwner && existingOwner !== ideaId) {
          error(`Repository ${resolvedRepository} is claimed by both ${existingOwner} and ${ideaId}.`);
        } else {
          claimedRepositories.set(resolvedRepository, ideaId);
        }
      }
    }
  }
  return findings;
}

export function assertValidConfig(config, operation = "use this workspace") {
  const errors = validateConfig(config).filter((finding) => finding.level === "error");
  if (errors.length > 0) {
    throw new SddError(`Cannot ${operation} with an invalid SDD workspace configuration.`, {
      code: "INVALID_CONFIG",
      details: errors.map((finding) => finding.message),
    });
  }
  return config;
}

export function resolveWorkspacePath(workspaceRoot, configuredPath) {
  return resolve(workspaceRoot, configuredPath);
}

export function relativeWorkspacePath(workspaceRoot, absolutePath) {
  return relative(workspaceRoot, absolutePath).split("\\").join("/") || ".";
}
