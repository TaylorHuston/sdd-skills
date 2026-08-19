import { lstatSync, realpathSync } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, win32 } from "node:path";
import { parseDocument, stringify } from "yaml";

import {
  CONFIG_DIRECTORY_NAME,
  CONFIG_FILE_NAME,
  DEFAULT_ARTIFACT_PATHS,
  INSTALL_LOCK_FILE_NAME,
  REPOSITORY_CONFIG_VERSION,
  REPOSITORY_SCHEMA_VERSION,
  WORKSPACE_CONFIG_VERSION,
  WORKSPACE_SCHEMA_VERSION,
} from "./constants.js";
import { SddError } from "./errors.js";
import { publishConfigFile } from "./config-publication.js";
import {
  isDirectory,
  isPathInside,
  isPathPhysicallyInside,
  pathExists,
  readBoundRegularFile,
  resolvePhysicalPath,
} from "./fs.js";

export const WORKSPACE_STATUSES = Object.freeze(["active", "inactive", "archived"]);

export function resolveWorkspaceStatus(value) {
  return value ?? "active";
}

function getOwnerConfigDirectory(ownerRoot) {
  return join(ownerRoot, CONFIG_DIRECTORY_NAME);
}

function getOwnerConfigPath(ownerRoot) {
  return join(getOwnerConfigDirectory(ownerRoot), CONFIG_FILE_NAME);
}

export function getWorkspaceConfigDirectory(workspaceRoot) {
  return getOwnerConfigDirectory(workspaceRoot);
}

export function getWorkspaceConfigPath(workspaceRoot) {
  return getOwnerConfigPath(workspaceRoot);
}

export function getWorkspaceInstallLockPath(workspaceRoot) {
  return join(getWorkspaceConfigDirectory(workspaceRoot), INSTALL_LOCK_FILE_NAME);
}

export function getRepositoryConfigPath(repositoryRoot) {
  return getOwnerConfigPath(repositoryRoot);
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

async function readOwnerConfigFile(
  ownerRoot,
  path,
  {
    allowMissing = false,
    returnMissingBinding = false,
    label = "SDD configuration",
    afterRead = null,
    expectedOwnerBinding = undefined,
  } = {},
) {
  const file = await readBoundRegularFile(path, {
    ownerRoot,
    allowMissing,
    returnMissingBinding,
    label,
    unsafeCode: "UNSAFE_CONFIG_PATH",
    afterRead,
    expectedOwnerBinding,
  });
  if (
    file !== null
    && file.missing !== true
    && !file.bytes.equals(Buffer.from(file.source, "utf8"))
  ) {
    throw new SddError(`Cannot parse YAML at ${path}: configuration is not valid UTF-8.`, {
      code: "INVALID_YAML",
    });
  }
  return file;
}

function parsedConfigSnapshot(file, path) {
  return {
    config: parseYaml(file.source, path),
    source: file.source,
    identity: file.identity,
    mode: file.mode,
    ownerBinding: file.ownerBinding,
  };
}

export async function readWorkspaceConfigSnapshot(workspaceRoot, { afterRead = null } = {}) {
  const path = getWorkspaceConfigPath(workspaceRoot);
  const file = await readOwnerConfigFile(workspaceRoot, path, {
    allowMissing: true,
    label: "Workspace configuration",
    afterRead,
  });
  if (file === null) {
    throw new SddError(
      `No SDD workspace configuration found at ${path}. Run \`sdd setup ${workspaceRoot}\` first.`,
      { code: "WORKSPACE_NOT_INITIALIZED" },
    );
  }
  return parsedConfigSnapshot(file, path);
}

export async function readWorkspaceConfig(workspaceRoot, options) {
  return (await readWorkspaceConfigSnapshot(workspaceRoot, options)).config;
}

export async function readRepositoryConfigSnapshot(
  repositoryRoot,
  { afterRead = null, includeMissingBinding = false } = {},
) {
  const path = getRepositoryConfigPath(repositoryRoot);
  const file = await readOwnerConfigFile(repositoryRoot, path, {
    allowMissing: true,
    returnMissingBinding: includeMissingBinding,
    label: "Repository configuration",
    afterRead,
  });
  if (file === null || file.missing === true) return file;
  return parsedConfigSnapshot(file, path);
}

export async function readRepositoryConfig(repositoryRoot, options) {
  const snapshot = await readRepositoryConfigSnapshot(repositoryRoot, options);
  return snapshot?.config?.kind === "repository" ? snapshot.config : null;
}

function configSnapshotChanged(path, label, error = null) {
  return new SddError(`${label} changed after it was read: ${path}`, {
    code: "CONCURRENT_CHANGE",
    ...(error ? { details: [error.message] } : {}),
  });
}

async function assertOwnerConfigSnapshotCurrent(ownerRoot, path, expected, label, options = {}) {
  let current;
  try {
    current = await readOwnerConfigFile(ownerRoot, path, {
      allowMissing: true,
      returnMissingBinding: expected?.missing === true,
      label,
      afterRead: options.afterRead ?? null,
      expectedOwnerBinding: expected?.ownerBinding,
    });
  } catch (error) {
    if (["CONCURRENT_CHANGE", "INVALID_YAML", "UNSAFE_CONFIG_PATH"].includes(error?.code)) {
      throw configSnapshotChanged(path, label, error);
    }
    throw error;
  }
  if (expected?.missing === true) {
    if (current?.missing !== true) throw configSnapshotChanged(path, label);
    return true;
  }
  if (expected === null) {
    if (current !== null) throw configSnapshotChanged(path, label);
    return true;
  }
  if (
    current === null
    || typeof expected?.source !== "string"
    || current.identity.dev !== expected?.identity?.dev
    || current.identity.ino !== expected?.identity?.ino
    || (expected?.mode !== undefined && current.mode !== expected.mode)
    || !current.bytes.equals(Buffer.from(expected.source, "utf8"))
  ) {
    throw configSnapshotChanged(path, label);
  }
  return true;
}

export function assertWorkspaceConfigSnapshotCurrent(workspaceRoot, expected, options) {
  return assertOwnerConfigSnapshotCurrent(
    workspaceRoot,
    getWorkspaceConfigPath(workspaceRoot),
    expected,
    "Workspace configuration",
    options,
  );
}

export function assertRepositoryConfigSnapshotCurrent(repositoryRoot, expected, options) {
  return assertOwnerConfigSnapshotCurrent(
    repositoryRoot,
    getRepositoryConfigPath(repositoryRoot),
    expected,
    "Repository configuration",
    options,
  );
}

async function requireConfigOwnerRoot(ownerRoot) {
  const root = resolve(ownerRoot);
  let state;
  try {
    state = await lstat(root);
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "ELOOP"].includes(error?.code)) {
      throw new SddError(
        `SDD configuration owner root must already exist as a real directory: ${root}`,
        { code: "UNSAFE_CONFIG_PATH", details: [root] },
      );
    }
    throw error;
  }
  if (state.isSymbolicLink() || !state.isDirectory()) {
    throw new SddError(
      `SDD configuration owner root must be a real directory: ${root}`,
      { code: "UNSAFE_CONFIG_PATH", details: [root] },
    );
  }
  return root;
}

async function writeOwnerConfig(
  ownerRoot,
  path,
  config,
  {
    expected,
    beforePublish = null,
    afterDisplace = null,
    afterPublish = null,
  } = {},
) {
  const absoluteOwnerRoot = await requireConfigOwnerRoot(ownerRoot);
  const current = await readOwnerConfigFile(absoluteOwnerRoot, path, {
    allowMissing: true,
    returnMissingBinding: true,
    label: "SDD configuration",
  });
  if (!(await isPathPhysicallyInside(absoluteOwnerRoot, path))) {
    throw new SddError(`SDD configuration path resolves outside its owner root: ${path}`, {
      code: "UNSAFE_CONFIG_PATH",
    });
  }
  const source = stringify(config, { lineWidth: 0, sortMapEntries: false });
  const writeExpected = expected === undefined
    ? current
    : expected === null
      ? { missing: true, ownerBinding: current.ownerBinding }
      : expected;
  await publishConfigFile(absoluteOwnerRoot, path, source, {
    expected: writeExpected,
    beforePublish,
    afterDisplace,
    afterPublish,
  });
  return source;
}

export function writeWorkspaceConfig(workspaceRoot, config, options) {
  return writeOwnerConfig(
    workspaceRoot,
    getWorkspaceConfigPath(workspaceRoot),
    config,
    options,
  );
}

export function writeRepositoryConfig(repositoryRoot, config, options) {
  return writeOwnerConfig(
    repositoryRoot,
    getRepositoryConfigPath(repositoryRoot),
    config,
    options,
  );
}

async function readWorkspaceCandidate(candidateRoot) {
  const path = getWorkspaceConfigPath(candidateRoot);
  const file = await readOwnerConfigFile(candidateRoot, path, {
    allowMissing: true,
    label: "Workspace discovery configuration",
  });
  if (file === null) return undefined;
  return parseYaml(file.source, path);
}

async function requireWorkspaceRoot(candidateRoot, source) {
  const root = resolve(candidateRoot);
  const path = getWorkspaceConfigPath(root);
  const config = await readWorkspaceCandidate(root);
  if (config === undefined) {
    throw new SddError(`${source} does not contain an SDD workspace configuration: ${path}`, {
      code: "WORKSPACE_NOT_INITIALIZED",
    });
  }
  if (config?.kind === "repository") {
    throw new SddError(`${source} points to a repository contract, not a workspace: ${path}`, {
      code: "INVALID_WORKSPACE_ROOT",
    });
  }
  return root;
}

function unsafeAncestorSearchStart(path, reason) {
  return new SddError(`Configuration discovery start path ${reason}: ${path}`, {
    code: "UNSAFE_CONFIG_PATH",
    details: [path],
  });
}

async function resolveAncestorSearchStart(startPath) {
  const start = resolve(startPath);
  let candidate = start;
  while (true) {
    let state;
    try {
      state = await lstat(candidate);
    } catch (error) {
      if (error?.code === "ENOENT") {
        const parent = dirname(candidate);
        if (parent === candidate) return candidate;
        candidate = parent;
        continue;
      }
      if (["ELOOP", "ENOTDIR"].includes(error?.code)) {
        throw unsafeAncestorSearchStart(start, "has an unsafe ancestor");
      }
      throw error;
    }
    if (state.isSymbolicLink()) {
      throw unsafeAncestorSearchStart(candidate, "cannot be a symbolic link");
    }
    if (state.isDirectory()) return candidate;
    if (state.isFile() && candidate === start) return dirname(start);
    throw unsafeAncestorSearchStart(
      candidate,
      candidate === start
        ? "must be a regular file, directory, or missing path"
        : "is not a directory ancestor",
    );
  }
}

async function findAncestorWorkspaceRoot(startPath, env) {
  let current = await resolveAncestorSearchStart(startPath);
  while (true) {
    const path = getWorkspaceConfigPath(current);
    const candidate = await readWorkspaceCandidate(current);
    if (candidate !== undefined) {
      if (candidate?.kind === "repository") {
        // Portable repository contracts do not identify their owning workspace.
      } else {
        return current;
      }
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function pathContainsTarget(ownerPath, targetPath) {
  if (isPathInside(ownerPath, targetPath)) return true;
  try {
    const [physicalOwner, physicalTarget] = await Promise.all([
      resolvePhysicalPath(ownerPath),
      resolvePhysicalPath(targetPath),
    ]);
    return isPathInside(physicalOwner, physicalTarget);
  } catch {
    return false;
  }
}

async function workspaceMapsTarget(workspaceRoot, config, targetPath) {
  for (const [ideaId, idea] of Object.entries(config?.ideas ?? {})) {
    const planning = resolveIdeaPlanningPath(config, ideaId, idea);
    if (await pathContainsTarget(resolveWorkspacePath(workspaceRoot, planning), targetPath)) {
      return true;
    }
    for (const repository of idea.repositories ?? []) {
      const configuredPath = resolveRepositoryPath(config, repository);
      if (await pathContainsTarget(resolveWorkspacePath(workspaceRoot, configuredPath), targetPath)) {
        return true;
      }
    }
  }
  return false;
}

export async function findWorkspaceRoot(
  startPath,
  { workspaceRoot, cwd = process.cwd(), env = process.env } = {},
) {
  const resolvedCwd = resolve(cwd);
  const targetPath = resolve(resolvedCwd, startPath);
  if (workspaceRoot !== undefined && workspaceRoot !== null) {
    return requireWorkspaceRoot(
      resolve(resolvedCwd, workspaceRoot),
      "Explicit workspace root",
      env,
    );
  }
  if (env?.SDD_WORKSPACE_ROOT) {
    return requireWorkspaceRoot(
      resolve(resolvedCwd, env.SDD_WORKSPACE_ROOT),
      "SDD_WORKSPACE_ROOT",
      env,
    );
  }

  const targetWorkspaceRoot = await findAncestorWorkspaceRoot(targetPath, env);
  if (targetWorkspaceRoot) return targetWorkspaceRoot;

  const cwdWorkspaceRoot = await findAncestorWorkspaceRoot(resolvedCwd, env);
  if (cwdWorkspaceRoot) {
    const config = await readWorkspaceConfig(cwdWorkspaceRoot);
    assertValidConfig(config, "resolve workspace target ownership");
    if (await workspaceMapsTarget(cwdWorkspaceRoot, config, targetPath)) {
      return cwdWorkspaceRoot;
    }
    throw new SddError(
      `Workspace ${cwdWorkspaceRoot} does not map external target ${targetPath}.`,
      { code: "WORKSPACE_TARGET_UNMAPPED" },
    );
  }

  throw new SddError(
    `No SDD workspace configuration was found for ${targetPath}. Pass --workspace, set SDD_WORKSPACE_ROOT, or run the command from a workspace that maps the target.`,
    { code: "WORKSPACE_NOT_FOUND" },
  );
}

export async function findRepositoryRoot(startPath) {
  let current = await resolveAncestorSearchStart(startPath);
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
    if (typeof path !== "string" || !path || path.includes("\0")) {
      throw new SddError("Legacy repository roots must be non-empty paths without NUL bytes.", {
        code: "INVALID_CONFIG",
        details: [`repositories.roots[${index}] is invalid.`],
      });
    }
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
  // Released idea manifests resolve relative repository paths from the workspace,
  // independently of where planning and repository roots happen to converge.
  const repositoryPath = isAbsolute(repository.path)
    ? resolve(repository.path)
    : resolve(workspaceRoot, repository.path);
  const matches = Object.entries(repositoryRoots)
    .map(([root, path]) => ({ root, path, absolutePath: resolveWorkspacePath(workspaceRoot, path) }))
    .filter((entry) =>
      entry.absolutePath === repositoryPath || isPathInside(entry.absolutePath, repositoryPath))
    .sort((left, right) => right.absolutePath.length - left.absolutePath.length);

  const role = repository.role ? { role: repository.role } : {};
  const status = { status: resolveWorkspaceStatus(repository.status) };
  if (matches.length === 0) {
    const path = repositoryPath === resolve(workspaceRoot)
      || isPathInside(resolve(workspaceRoot), repositoryPath)
      ? relative(resolve(workspaceRoot), repositoryPath)
      : repositoryPath;
    return { path: normalizePath(path), ...role, ...status };
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

  const normalizedPlanningRoot = normalizeWorkspaceConfiguredPath(
    workspaceRoot,
    detectedPlanningRoot,
  );
  const normalizedRepositoryRoots = detectedRepositoryRoots.map((path) =>
    normalizeWorkspaceConfiguredPath(workspaceRoot, path));
  const repositoryRootMap = createRepositoryRootMap(normalizedRepositoryRoots);
  const config = {
    version: WORKSPACE_CONFIG_VERSION,
    schema: WORKSPACE_SCHEMA_VERSION,
    skills: {
      directory: normalizeWorkspaceConfiguredPath(
        workspaceRoot,
        skillsDirectory ?? ".agents/skills",
      ),
    },
    planning: {
      root: normalizedPlanningRoot,
    },
    repositories: {
      roots: repositoryRootMap,
    },
    repositoryArtifacts: { ...DEFAULT_ARTIFACT_PATHS },
    ideas: await importIdeas(workspaceRoot, normalizedPlanningRoot, repositoryRootMap),
  };
  assertValidConfig(config, "create the initial workspace configuration");
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

export function resolveIdeaPlanningPath(
  config,
  ideaId,
  idea,
  { platform = process.platform } = {},
) {
  if (idea.planningPath !== undefined && idea.planningPath !== null) {
    assertSupportedConfiguredPathSyntax(idea.planningPath, platform, "idea planningPath");
    return idea.planningPath;
  }
  assertSupportedConfiguredPathSyntax(config.planning.root, platform, "planning.root");
  const planning = idea.planning ?? ideaId;
  assertConfiguredRelativePathSyntax(planning, platform, "idea planning path");
  return pathImplementation(platform).join(config.planning.root, planning);
}

export function resolveRepositoryPath(
  config,
  repository,
  { platform = process.platform } = {},
) {
  if (!repository.root) {
    assertSupportedConfiguredPathSyntax(
      repository.path,
      platform,
      "rootless repository path",
    );
    return repository.path;
  }
  const root = config.repositories.roots[repository.root];
  assertSupportedConfiguredPathSyntax(root, platform, "repository root");
  assertConfiguredRelativePathSyntax(repository.path, platform, "repository path");
  return pathImplementation(platform).join(root, repository.path);
}

export function validateConfig(config) {
  const findings = [];
  const error = (message) => findings.push({ level: "error", message });
  const rejectUnknownKeys = (label, value, allowed) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) error(`${label} contains unknown key: ${key}.`);
    }
  };
  const containsNullByte = (value) => typeof value === "string" && value.includes("\0");
  const validatePath = (label, path) => {
    if (typeof path !== "string" || !path) {
      error(`${label} must be a non-empty path.`);
      return false;
    }
    if (containsNullByte(path)) {
      error(`${label} must not contain NUL bytes.`);
      return false;
    }
    if (path === "~" || path.startsWith("~/") || path.startsWith("~\\")) {
      error(`${label} must not use home-directory shorthand.`);
      return false;
    }
    if (/^[A-Za-z]:(?![\\/])/.test(path)) {
      error(`${label} must not use a drive-relative path.`);
      return false;
    }
    if (path.split(/[\\/]/).includes("..")) {
      error(`${label} cannot traverse to a parent directory.`);
      return false;
    }
    return true;
  };
  const validateRelativePath = (label, path) => {
    if (!validatePath(label, path)) return false;
    if (isAbsolute(path) || /^[\\/]/.test(path) || /^[A-Za-z]:/.test(path)) {
      error(`${label} must be workspace-relative.`);
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
    ["version", "schema", "skills", "planning", "repositories", "repositoryArtifacts", "ideas"],
  );
  rejectUnknownKeys("skills", config.skills, ["directory"]);
  rejectUnknownKeys("planning", config.planning, ["root"]);
  rejectUnknownKeys("repositories", config.repositories, ["roots"]);
  if (config.version !== WORKSPACE_CONFIG_VERSION) {
    error(`Configuration version must be ${WORKSPACE_CONFIG_VERSION}.`);
  }
  if (config.schema !== WORKSPACE_SCHEMA_VERSION) {
    error(`Configuration schema must be ${WORKSPACE_SCHEMA_VERSION}.`);
  }
  validateRelativePath("skills.directory", config.skills?.directory);
  validatePath("planning.root", config.planning?.root);
  if (
    !config.repositories?.roots ||
    typeof config.repositories.roots !== "object" ||
    Array.isArray(config.repositories.roots) ||
    Object.keys(config.repositories.roots).length === 0
  ) {
    error("repositories.roots must contain at least one named path for a workspace configuration.");
  } else {
    for (const [rootId, path] of Object.entries(config.repositories.roots)) {
      if (!rootId || containsNullByte(rootId)) {
        error("repositories.roots keys must be non-empty and must not contain NUL bytes.");
      }
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
      validateRelativePath(`repositoryArtifacts.${key}`, config.repositoryArtifacts[key]);
    }
    validateArtifactRelationships(config.repositoryArtifacts, "repositoryArtifacts", error);
  }
  if (!config.ideas || typeof config.ideas !== "object" || Array.isArray(config.ideas)) {
    error("ideas must be a mapping.");
  } else {
    const claimedRepositories = new Map();
    for (const [ideaId, idea] of Object.entries(config.ideas)) {
      if (!ideaId || containsNullByte(ideaId)) {
        error("ideas keys must be non-empty and must not contain NUL bytes.");
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
        validateRelativePath(`ideas.${ideaId}.planning`, idea.planning);
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
        const repositoryPathValid = repository.root !== undefined
          ? validateRelativePath(`ideas.${ideaId}.repositories path`, repository.path)
          : validatePath(`ideas.${ideaId}.repositories path`, repository.path);
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
        if (containsNullByte(repository.root)) {
          error(`ideas.${ideaId}.repositories root must not contain NUL bytes.`);
        }
        if (
          !repositoryPathValid
          || containsNullByte(repository.root)
          || (
            repository.root !== undefined
            && typeof config.repositories?.roots?.[repository.root] !== "string"
          )
        ) continue;
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
      if (
        typeof path !== "string"
        || !path
        || path.includes("\0")
        || path === "~"
        || path.startsWith("~/")
        || path.startsWith("~\\")
        || isAbsolute(path)
        || /^[\\/]/.test(path)
        || /^[A-Za-z]:/.test(path)
        || path.split(/[\\/]/).includes("..")
      ) {
        error(`artifacts.${key} must be a repository-relative path without NUL bytes.`);
      }
    }
    validateArtifactRelationships(config.artifacts, "artifacts", error);
  }
  return findings;
}

function validateArtifactRelationships(artifacts, label, error) {
  const entries = Object.entries(DEFAULT_ARTIFACT_PATHS)
    .filter(([key]) =>
      typeof artifacts[key] === "string" && !artifacts[key].includes("\0"))
    .map(([key]) => [
      key,
      normalizePath(resolve("/", artifacts[key])),
    ]);
  for (const [key, path] of entries) {
    if (path === "/") error(`${label}.${key} must not own the repository root.`);
  }
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const [leftKey, leftPath] = entries[leftIndex];
      const [rightKey, rightPath] = entries[rightIndex];
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

function configuredPathFailure(configuredPath, label, code, reason) {
  return new SddError(`${label} ${reason}: ${String(configuredPath)}`, {
    code,
    details: [String(configuredPath)],
  });
}

function hasWindowsAbsoluteSyntax(configuredPath) {
  return /^[A-Za-z]:[\\/]/.test(configuredPath)
    || configuredPath.startsWith("\\")
    || /^\/\/[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/.test(configuredPath);
}

function pathImplementation(platform) {
  return platform === "win32" ? win32 : posix;
}

function assertSupportedConfiguredPathSyntax(
  configuredPath,
  platform,
  label = "Configured path",
) {
  if (
    typeof configuredPath !== "string"
    || configuredPath.length === 0
    || configuredPath.includes("\0")
  ) {
    throw configuredPathFailure(
      configuredPath,
      label,
      "INVALID_CONFIG",
      "must be a non-empty path without NUL bytes",
    );
  }
  if (/^[A-Za-z]:(?![\\/])/.test(configuredPath)) {
    throw configuredPathFailure(
      configuredPath,
      label,
      "UNSUPPORTED_CONFIG_PATH",
      "uses drive-relative syntax",
    );
  }

  const windowsSyntax = hasWindowsAbsoluteSyntax(configuredPath);
  const windowsAbsolute = win32.isAbsolute(configuredPath);
  const posixAbsolute = posix.isAbsolute(configuredPath);
  const foreignAbsolute = platform === "win32"
    ? posixAbsolute && !windowsSyntax
    : windowsAbsolute && windowsSyntax;
  if (foreignAbsolute) {
    throw configuredPathFailure(
      configuredPath,
      label,
      "UNSUPPORTED_CONFIG_PATH",
      `uses absolute syntax for a non-${platform === "win32" ? "Windows" : "POSIX"} platform`,
    );
  }
}

function assertConfiguredRelativePathSyntax(configuredPath, platform, label) {
  assertSupportedConfiguredPathSyntax(configuredPath, platform, label);
  if (posix.isAbsolute(configuredPath) || win32.isAbsolute(configuredPath)) {
    throw configuredPathFailure(
      configuredPath,
      label,
      "INVALID_CONFIG",
      "must be relative on POSIX and Windows",
    );
  }
}

export function resolveWorkspacePath(
  workspaceRoot,
  configuredPath,
  { platform = process.platform } = {},
) {
  assertSupportedConfiguredPathSyntax(configuredPath, platform);
  return pathImplementation(platform).resolve(workspaceRoot, configuredPath);
}

export function resolveRepositoryArtifactPath(
  repositoryRoot,
  configuredPath,
  { platform = process.platform } = {},
) {
  assertConfiguredRelativePathSyntax(configuredPath, platform, "Repository artifact path");
  return pathImplementation(platform).resolve(repositoryRoot, configuredPath);
}

function resolvePhysicalPathSynchronously(inputPath) {
  const absolutePath = resolve(inputPath);
  const missingSegments = [];
  let candidate = absolutePath;
  while (true) {
    try {
      lstatSync(candidate);
      return resolve(realpathSync(candidate), ...missingSegments.reverse());
    } catch (error) {
      if (error?.code === "ENOTDIR") return null;
      if (error?.code !== "ENOENT") throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw error;
      missingSegments.push(basename(candidate));
      candidate = parent;
    }
  }
}

function boundPhysicalWorkspaceRoot(workspaceRoot) {
  const root = resolve(workspaceRoot);
  let before;
  try {
    before = lstatSync(root, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (before.isSymbolicLink() || !before.isDirectory()) {
    throw new SddError(`Workspace root must be a real directory: ${root}`, {
      code: "UNSAFE_CONFIG_PATH",
      details: [root],
    });
  }
  const physicalRoot = realpathSync(root);
  const after = lstatSync(root, { bigint: true });
  if (
    !after.isDirectory()
    || after.isSymbolicLink()
    || before.dev !== after.dev
    || before.ino !== after.ino
  ) {
    throw new SddError(`Workspace root changed while normalizing configuration paths: ${root}`, {
      code: "CONCURRENT_CHANGE",
      details: [root],
    });
  }
  return physicalRoot;
}

export function toWorkspaceConfigPath(workspaceRoot, absolutePath) {
  const root = resolve(workspaceRoot);
  const path = resolve(absolutePath);
  const physicalRoot = boundPhysicalWorkspaceRoot(root);
  if (physicalRoot !== null) {
    const physicalPath = resolvePhysicalPathSynchronously(path);
    return physicalPath !== null && isPathInside(physicalRoot, physicalPath)
      ? normalizePath(relative(physicalRoot, physicalPath))
      : normalizePath(path);
  }
  return isPathInside(root, path)
    ? normalizePath(relative(root, path))
    : normalizePath(path);
}

export function normalizeWorkspaceConfiguredPath(workspaceRoot, configuredPath) {
  if (typeof configuredPath !== "string" || !configuredPath) return configuredPath;
  assertSupportedConfiguredPathSyntax(
    configuredPath,
    process.platform,
    "Configured workspace path",
  );
  return isAbsolute(configuredPath)
    ? toWorkspaceConfigPath(workspaceRoot, configuredPath)
    : normalizePath(configuredPath);
}

export function normalizeWorkspaceConfigPaths(workspaceRoot, config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return config;
  const normalized = structuredClone(config);
  if (normalized.skills && typeof normalized.skills === "object") {
    normalized.skills.directory = normalizeWorkspaceConfiguredPath(
      workspaceRoot,
      normalized.skills.directory,
    );
  }
  if (normalized.planning && typeof normalized.planning === "object") {
    normalized.planning.root = normalizeWorkspaceConfiguredPath(
      workspaceRoot,
      normalized.planning.root,
    );
  }
  if (
    normalized.repositories?.roots
    && typeof normalized.repositories.roots === "object"
    && !Array.isArray(normalized.repositories.roots)
  ) {
    normalized.repositories.roots = Object.fromEntries(
      Object.entries(normalized.repositories.roots).map(([rootId, path]) => [
        rootId,
        normalizeWorkspaceConfiguredPath(workspaceRoot, path),
      ]),
    );
  }
  if (normalized.ideas && typeof normalized.ideas === "object" && !Array.isArray(normalized.ideas)) {
    for (const idea of Object.values(normalized.ideas)) {
      if (!idea || typeof idea !== "object" || Array.isArray(idea)) continue;
      if (typeof idea.planning === "string") idea.planning = normalizePath(idea.planning);
      if (idea.planningPath !== undefined) {
        idea.planningPath = normalizeWorkspaceConfiguredPath(workspaceRoot, idea.planningPath);
      }
      if (!Array.isArray(idea.repositories)) continue;
      for (const repository of idea.repositories) {
        if (!repository || typeof repository !== "object" || typeof repository.path !== "string") {
          continue;
        }
        repository.path = repository.root === undefined
          ? normalizeWorkspaceConfiguredPath(workspaceRoot, repository.path)
          : normalizePath(repository.path);
      }
    }
  }
  return normalized;
}

export async function resolveWorkspaceSkillsDirectory(
  workspaceRoot,
  configuredDirectory,
  { platform = process.platform } = {},
) {
  if (
    typeof configuredDirectory === "string"
    && configuredDirectory.length > 0
    && !configuredDirectory.includes("\0")
  ) {
    assertSupportedConfiguredPathSyntax(
      configuredDirectory,
      platform,
      "Managed skill directory",
    );
  }
  const invalid = typeof configuredDirectory !== "string"
    || !configuredDirectory
    || configuredDirectory.includes("\0")
    || configuredDirectory === "~"
    || configuredDirectory.startsWith("~/")
    || configuredDirectory.startsWith("~\\")
    || isAbsolute(configuredDirectory)
    || /^[\\/]/.test(configuredDirectory)
    || /^[A-Za-z]:/.test(configuredDirectory)
    || configuredDirectory.split(/[\\/]/).includes("..");
  const target = invalid
    ? null
    : resolveWorkspacePath(workspaceRoot, configuredDirectory, { platform });
  if (!target
    || !isPathInside(workspaceRoot, target)
    || !(await isPathPhysicallyInside(workspaceRoot, target))) {
    throw new SddError(
      `Managed skill directory must remain physically inside the workspace: ${configuredDirectory}`,
      { code: "UNSAFE_SKILL_DIRECTORY" },
    );
  }
  return target;
}

export function resolveRepositoryArtifacts(config, repository) {
  return repository?.artifacts ?? config.repositoryArtifacts;
}

export function relativeWorkspacePath(workspaceRoot, absolutePath) {
  return relative(workspaceRoot, absolutePath).split("\\").join("/") || ".";
}
