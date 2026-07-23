import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseDocument, stringify } from "yaml";

import {
  CONFIG_DIRECTORY_NAME,
  CONFIG_FILE_NAME,
  CONFIG_VERSION,
  DEFAULT_ARTIFACT_PATHS,
  INSTALL_LOCK_FILE_NAME,
  REPOSITORY_CONFIG_VERSION,
  REPOSITORY_SCHEMA_VERSION,
  SCHEMA_VERSION,
  USER_CONFIG_VERSION,
  USER_SCHEMA_VERSION,
} from "./constants.js";
import { SddError } from "./errors.js";
import {
  isDirectory,
  isPathInside,
  isPathPhysicallyInside,
  pathExists,
  writeFileAtomically,
} from "./fs.js";

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

export function getUserRoot() {
  return resolve(process.env.SDD_USER_HOME || homedir());
}

export function getUserConfigPath() {
  return getConfigPath(getUserRoot());
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
    throw new SddError(`No SDD configuration found at ${workspaceRoot}. Run \`sdd setup\` for the user or \`sdd init\` in a repository.`, {
      code: "WORKSPACE_NOT_INITIALIZED",
    });
  }
  return parseYaml(await readFile(path, "utf8"), path);
}

export async function readRepositoryConfig(repositoryRoot) {
  const path = getConfigPath(repositoryRoot);
  if (!(await pathExists(path))) return null;
  const config = parseYaml(await readFile(path, "utf8"), path);
  return config?.kind === "repository" ? config : null;
}

export async function writeConfig(workspaceRoot, config) {
  const path = getConfigPath(workspaceRoot);
  if (!(await isPathPhysicallyInside(workspaceRoot, path))) {
    throw new SddError(`SDD configuration path resolves outside its owner root: ${path}`, {
      code: "UNSAFE_CONFIG_PATH",
    });
  }
  const source = stringify(config, { lineWidth: 0, sortMapEntries: false });
  await writeFileAtomically(path, source);
  return source;
}

export async function findWorkspaceRoot(startPath) {
  let current = resolve(startPath);
  while (true) {
    if (await pathExists(getConfigPath(current))) {
      const candidate = parseYaml(await readFile(getConfigPath(current), "utf8"), getConfigPath(current));
      if (candidate?.kind !== "repository") return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  const userRoot = getUserRoot();
  if (await pathExists(getConfigPath(userRoot))) return userRoot;
  throw new SddError(
    `No user SDD configuration found at ${getConfigPath(userRoot)} and no legacy workspace configuration was found from ${resolve(startPath)} upward. Run \`sdd setup\` first, then \`sdd init\` in the repository.`,
    { code: "WORKSPACE_NOT_FOUND" },
  );
}

export async function findRepositoryRoot(startPath) {
  let current = resolve(startPath);
  while (true) {
    const config = await readRepositoryConfig(current);
    if (config) return current;
    const parent = dirname(current);
    if (parent === current) return null;
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
  const repositoryPath = resolveWorkspacePath(workspaceRoot, repository.path);
  const matches = Object.entries(repositoryRoots)
    .map(([root, path]) => ({ root, path, absolutePath: resolveWorkspacePath(workspaceRoot, path) }))
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
  const absolutePlanningRoot = resolveWorkspacePath(workspaceRoot, planningRoot);
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
    const manifestPath = join(absolutePlanningRoot, directory.name, `${directory.name}.md`);
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
    repositoryRoots !== undefined
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

export async function createUserConfig(
  userRoot,
  { planningRoot, repositoryRoots, skillsDirectory } = {},
) {
  const config = await createInitialConfig(userRoot, {
    planningRoot: planningRoot ?? "planning",
    repositoryRoots: repositoryRoots ?? [],
    skillsDirectory: skillsDirectory ?? ".agents/skills",
  });
  return {
    ...config,
    kind: "user",
    version: USER_CONFIG_VERSION,
    schema: USER_SCHEMA_VERSION,
  };
}

export async function createUserConfigFromWorkspace(
  userRoot,
  workspaceRoot,
  { skillsDirectory } = {},
) {
  const source = await readConfig(workspaceRoot);
  if (source.kind === "user") {
    throw new SddError(`${getConfigPath(workspaceRoot)} is already a user-level configuration.`, {
      code: "INVALID_MIGRATION_SOURCE",
    });
  }
  const migrated = migrateConfig(source, workspaceRoot).config;
  assertValidConfig(migrated, "migrate the legacy workspace");

  const ideas = Object.fromEntries(
    Object.entries(migrated.ideas ?? {}).map(([ideaId, idea]) => [
      ideaId,
      {
        ...idea,
        ...(idea.planningPath !== undefined
          ? { planningPath: resolveWorkspacePath(workspaceRoot, idea.planningPath) }
          : {}),
        repositories: (idea.repositories ?? []).map((repository) =>
          repository.root
            ? { ...repository }
            : {
                ...repository,
                path: resolveWorkspacePath(workspaceRoot, repository.path),
              },
        ),
      },
    ]),
  );

  const config = {
    kind: "user",
    version: USER_CONFIG_VERSION,
    schema: USER_SCHEMA_VERSION,
    skills: { directory: skillsDirectory ?? ".agents/skills" },
    planning: {
      ...migrated.planning,
      root: resolveWorkspacePath(workspaceRoot, migrated.planning.root),
    },
    repositories: {
      roots: Object.fromEntries(
        Object.entries(migrated.repositories.roots).map(([rootId, path]) => [
          rootId,
          resolveWorkspacePath(workspaceRoot, path),
        ]),
      ),
    },
    repositoryArtifacts: { ...migrated.repositoryArtifacts },
    ideas,
  };
  assertValidConfig(config, "create the user installation from a legacy workspace");
  return config;
}

export function createRepositoryConfig(repositoryId) {
  return {
    kind: "repository",
    version: REPOSITORY_CONFIG_VERSION,
    schema: REPOSITORY_SCHEMA_VERSION,
    id: repositoryId,
    artifacts: { ...DEFAULT_ARTIFACT_PATHS },
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
  const userConfig = config?.kind === "user";
  const rejectUnknownKeys = (label, value, allowed) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) error(`${label} contains unknown key: ${key}.`);
    }
  };
  const validatePath = (label, path) => {
    if (typeof path !== "string" || !path) {
      error(`${label} must be a non-empty path.`);
      return false;
    }
    if (!userConfig && (
      isAbsolute(path) ||
      /^[A-Za-z]:[\\/]/.test(path) ||
      path.split(/[\\/]/).includes("..")
    )) {
      error(`${label} must be relative and cannot traverse to a parent directory.`);
      return false;
    }
    return true;
  };
  const validateOwnerRelativePath = (label, path) => {
    if (typeof path !== "string" || !path) {
      error(`${label} must be a non-empty path.`);
      return false;
    }
    if (
      isAbsolute(path) ||
      /^[\\/]/.test(path) ||
      /^[A-Za-z]:[\\/]/.test(path) ||
      path === "~" ||
      path.startsWith("~/") ||
      path.startsWith("~\\") ||
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
  rejectUnknownKeys(
    "Configuration",
    config,
    userConfig
      ? ["kind", "version", "schema", "skills", "planning", "repositories", "repositoryArtifacts", "ideas"]
      : ["version", "schema", "skills", "planning", "repositories", "repositoryArtifacts", "ideas"],
  );
  rejectUnknownKeys("skills", config.skills, ["directory"]);
  rejectUnknownKeys("planning", config.planning, ["root", "plannedChangesDirectory"]);
  rejectUnknownKeys("repositories", config.repositories, ["roots"]);
  const expectedVersion = userConfig ? USER_CONFIG_VERSION : CONFIG_VERSION;
  const expectedSchema = userConfig ? USER_SCHEMA_VERSION : SCHEMA_VERSION;
  if (config.version !== expectedVersion) {
    error(`Configuration version must be ${expectedVersion}.`);
  }
  if (config.schema !== expectedSchema) {
    error(`Configuration schema must be ${expectedSchema}.`);
  }
  validatePath("skills.directory", config.skills?.directory);
  validatePath("planning.root", config.planning?.root);
  validateOwnerRelativePath("planning.plannedChangesDirectory", config.planning?.plannedChangesDirectory);
  if (
    !config.repositories?.roots ||
    typeof config.repositories.roots !== "object" ||
    Array.isArray(config.repositories.roots) ||
    (!userConfig && Object.keys(config.repositories.roots).length === 0)
  ) {
    error("repositories.roots must contain at least one named path for a legacy workspace.");
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
    rejectUnknownKeys("repositoryArtifacts", config.repositoryArtifacts, Object.keys(DEFAULT_ARTIFACT_PATHS));
    for (const key of Object.keys(DEFAULT_ARTIFACT_PATHS)) {
      validatePath(`repositoryArtifacts.${key}`, config.repositoryArtifacts[key]);
    }
    validateArtifactRelationships(config.repositoryArtifacts, "repositoryArtifacts", error);
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
      rejectUnknownKeys(`ideas.${ideaId}`, idea, ["status", "planning", "planningPath", "repositories"]);
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
        rejectUnknownKeys(
          `ideas.${ideaId}.repositories entry`,
          repository,
          ["root", "path", "role", "status"],
        );
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
        const repositoryIdentity = normalizePath(resolve("/", resolvedRepository));
        const existingOwner = claimedRepositories.get(repositoryIdentity);
        if (existingOwner && existingOwner !== ideaId) {
          error(`Repository ${resolvedRepository} is claimed by both ${existingOwner} and ${ideaId}.`);
        } else {
          claimedRepositories.set(repositoryIdentity, ideaId);
        }
      }
    }
  }
  return findings;
}

export function validateRepositoryConfig(config) {
  const findings = [];
  const error = (message) => findings.push({ level: "error", message });
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return [{ level: "error", message: "Repository configuration must be a YAML mapping." }];
  }
  const rejectUnknownKeys = (label, value, allowed) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) error(`${label} contains unknown key: ${key}.`);
    }
  };
  rejectUnknownKeys("Repository configuration", config, ["kind", "version", "schema", "id", "artifacts"]);
  if (config.kind !== "repository") error('Repository configuration kind must be "repository".');
  if (config.version !== REPOSITORY_CONFIG_VERSION) {
    error(`Repository configuration version must be ${REPOSITORY_CONFIG_VERSION}.`);
  }
  if (config.schema !== REPOSITORY_SCHEMA_VERSION) {
    error(`Repository configuration schema must be ${REPOSITORY_SCHEMA_VERSION}.`);
  }
  if (typeof config.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(config.id)) {
    error("Repository id must use lowercase letters, numbers, and hyphens.");
  }
  if (!config.artifacts || typeof config.artifacts !== "object" || Array.isArray(config.artifacts)) {
    error("Repository artifacts must be a mapping.");
  } else {
    rejectUnknownKeys("artifacts", config.artifacts, Object.keys(DEFAULT_ARTIFACT_PATHS));
    for (const key of Object.keys(DEFAULT_ARTIFACT_PATHS)) {
      const path = config.artifacts[key];
      if (typeof path !== "string" || !path || isAbsolute(path) || path.split(/[\\/]/).includes("..")) {
        error(`artifacts.${key} must be a repository-relative path.`);
      }
    }
    validateArtifactRelationships(config.artifacts, "artifacts", error);
  }
  return findings;
}

function validateArtifactRelationships(artifacts, label, error) {
  const entries = Object.entries(DEFAULT_ARTIFACT_PATHS).map(([key]) => [
    key,
    normalizePath(resolve("/", artifacts[key] ?? ".")),
  ]);
  for (const [key, path] of entries) {
    if (path === "/") error(`${label}.${key} must not own the repository root.`);
  }
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const [leftKey, leftPath] = entries[leftIndex];
      const [rightKey, rightPath] = entries[rightIndex];
      const allowedClosedChild = leftKey === "activeChanges" && rightKey === "closedChanges"
        && dirname(rightPath) === leftPath;
      if (allowedClosedChild) continue;
      if (leftPath === rightPath || isPathInside(leftPath, rightPath) || isPathInside(rightPath, leftPath)) {
        error(`${label}.${leftKey} and ${label}.${rightKey} overlap invalidly.`);
      }
    }
  }
}

export function assertValidRepositoryConfig(config) {
  const errors = validateRepositoryConfig(config).filter((finding) => finding.level === "error");
  if (errors.length) {
    throw new SddError("Cannot use an invalid SDD repository configuration.", {
      code: "INVALID_REPOSITORY_CONFIG",
      details: errors.map((finding) => finding.message),
    });
  }
  return config;
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
  if (configuredPath === "~") return getUserRoot();
  if (configuredPath.startsWith("~/") || configuredPath.startsWith("~\\")) {
    return resolve(getUserRoot(), configuredPath.slice(2));
  }
  return resolve(workspaceRoot, configuredPath);
}

export function resolveRepositoryArtifacts(config, repository) {
  return repository?.artifacts ?? config.repositoryArtifacts;
}

export function relativeWorkspacePath(workspaceRoot, absolutePath) {
  return relative(workspaceRoot, absolutePath).split("\\").join("/") || ".";
}
