import { lstatSync, realpathSync } from "node:fs";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, win32 } from "node:path";
import { parseDocument, stringify } from "yaml";

import {
  CONFIG_DIRECTORY_NAME,
  CONFIG_FILE_NAME,
  DEFAULT_ARTIFACT_PATHS,
  INSTALL_LOCK_FILE_NAME,
  LEGACY_USER_CONFIG_SIGNATURES,
  REPOSITORY_CONFIG_VERSION,
  REPOSITORY_SCHEMA_VERSION,
  WORKSPACE_CONFIG_VERSION,
  WORKSPACE_SCHEMA_VERSION,
} from "./constants.js";
import { SddError } from "./errors.js";
import {
  isDirectory,
  isPathInside,
  isPathPhysicallyInside,
  pathExists,
  readBoundRegularFile,
  resolvePhysicalPath,
  writeFileAtomically,
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

export function getLegacyUserConfigPath(legacyUserRoot) {
  return getOwnerConfigPath(legacyUserRoot);
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

export async function readLegacyUserConfigSnapshot(legacyUserRoot, { afterRead = null } = {}) {
  const path = getLegacyUserConfigPath(legacyUserRoot);
  const file = await readOwnerConfigFile(legacyUserRoot, path, {
    allowMissing: true,
    label: "Legacy user SDD configuration",
    afterRead,
  });
  if (file === null) {
    throw new SddError(`No legacy user SDD configuration found at ${path}.`, {
      code: "LEGACY_USER_CONFIG_NOT_FOUND",
    });
  }
  const snapshot = parsedConfigSnapshot(file, path);
  assertValidLegacyUserConfig(snapshot.config);
  return snapshot;
}

export async function readLegacyUserConfig(legacyUserRoot, options) {
  return (await readLegacyUserConfigSnapshot(legacyUserRoot, options)).config;
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
    writeFile = writeFileAtomically,
    expected,
    beforePublish = null,
    ...writeOptions
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
  await writeFile(path, source, {
    ...writeOptions,
    expected: writeExpected,
    beforePublish,
    ownerRoot: absoluteOwnerRoot,
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

async function physicalDirectoryIdentity(path) {
  try {
    const state = await stat(path, { bigint: true });
    return state.isDirectory() ? { dev: state.dev, ino: state.ino } : null;
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error?.code)) return null;
    throw error;
  }
}

function isSamePhysicalIdentity(left, right) {
  return left !== null
    && right !== null
    && left.dev === right.dev
    && left.ino === right.ino;
}

async function isLegacyHomeRoot(candidateRoot, env) {
  const root = resolve(candidateRoot);
  const configuredHomes = [env?.SDD_USER_HOME, env?.HOME, homedir()]
    .filter((candidate) => typeof candidate === "string" && candidate.length > 0);
  const candidates = [...new Set(configuredHomes)];
  if (candidates.length === 0) return false;
  if (candidates.some((candidate) => resolve(candidate) === root)) return true;

  const [physicalRoot, rootIdentity] = await Promise.all([
    resolvePhysicalPath(root),
    physicalDirectoryIdentity(root),
  ]);
  for (const candidate of candidates) {
    try {
      const [physicalCandidate, candidateIdentity] = await Promise.all([
        resolvePhysicalPath(candidate),
        physicalDirectoryIdentity(candidate),
      ]);
      if (
        physicalCandidate === physicalRoot
        || isSamePhysicalIdentity(candidateIdentity, rootIdentity)
      ) {
        return true;
      }
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes(error?.code)) continue;
      throw error;
    }
  }
  return false;
}

function throwLegacyHomeMigrationRequired(configPath) {
  throw new SddError(
    `Legacy home-root configuration at ${configPath} is migration input, not workspace authority. Run \`sdd setup <workspace> --from-user <legacy-user-root>\`.`,
    { code: "LEGACY_USER_MIGRATION_REQUIRED" },
  );
}

export async function assertWorkspaceRootIsNotLegacyHome(candidateRoot, env = process.env) {
  const root = resolve(candidateRoot);
  if (await isLegacyHomeRoot(root, env)) {
    throwLegacyHomeMigrationRequired(getWorkspaceConfigPath(root));
  }
  return root;
}

async function rejectMigrationOnlyAuthority(config, configPath, candidateRoot, env) {
  const homeWorkspace = config?.kind !== "repository"
    && await isLegacyHomeRoot(candidateRoot, env);
  if (config?.kind !== "user" && !homeWorkspace) return;
  throwLegacyHomeMigrationRequired(configPath);
}

async function requireWorkspaceRoot(candidateRoot, source, env) {
  const root = resolve(candidateRoot);
  const path = getWorkspaceConfigPath(root);
  const config = await readWorkspaceCandidate(root);
  if (config === undefined) {
    throw new SddError(`${source} does not contain an SDD workspace configuration: ${path}`, {
      code: "WORKSPACE_NOT_INITIALIZED",
    });
  }
  await rejectMigrationOnlyAuthority(config, path, root, env);
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
        await rejectMigrationOnlyAuthority(candidate, path, current, env);
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
    let operationalConfig;
    try {
      operationalConfig = migrateWorkspaceConfig(config, cwdWorkspaceRoot).config;
    } catch (error) {
      if (error instanceof SddError) throw error;
      throw new SddError(
        "Cannot resolve workspace target ownership with an invalid SDD workspace configuration.",
        {
          code: "INVALID_CONFIG",
          details: [String(error?.message ?? error)],
        },
      );
    }
    assertValidConfig(operationalConfig, "resolve workspace target ownership");
    if (await workspaceMapsTarget(cwdWorkspaceRoot, operationalConfig, targetPath)) {
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

function legacyUserConfigSignature(config) {
  if (
    !config
    || typeof config !== "object"
    || Array.isArray(config)
    || config.kind !== "user"
  ) return null;
  return LEGACY_USER_CONFIG_SIGNATURES.find(
    ({ version, schema }) => config.version === version && config.schema === schema,
  ) ?? null;
}

function isLegacyUserV1Config(config) {
  return legacyUserConfigSignature(config)?.version === 1;
}

export function resolveLegacyUserPath(legacyUserRoot, configuredPath) {
  if (configuredPath === "~") return resolve(legacyUserRoot);
  if (configuredPath.startsWith("~/") || configuredPath.startsWith("~\\")) {
    return resolve(legacyUserRoot, configuredPath.slice(2));
  }
  return resolve(legacyUserRoot, configuredPath);
}

function rebaseLegacyUserPath(legacyUserRoot, workspaceRoot, configuredPath) {
  return toWorkspaceConfigPath(
    workspaceRoot,
    resolveLegacyUserPath(legacyUserRoot, configuredPath),
  );
}

function normalizeLegacyUserIdea(
  legacyConfig,
  idea,
  legacyUserRoot,
  workspaceRoot,
) {
  if (!idea || typeof idea !== "object" || Array.isArray(idea)) return idea;
  const normalized = { ...idea };
  const planningChild = canonicalizeLegacyLiteralTildeChild(idea.planning);
  if (typeof planningChild === "string") normalized.planning = planningChild;
  const versionOne = isLegacyUserV1Config(legacyConfig);
  if (typeof idea.planningPath === "string") {
    normalized.planningPath = rebaseLegacyUserPath(
      legacyUserRoot,
      workspaceRoot,
      idea.planningPath,
    );
  } else if (
    versionOne
    && typeof idea.planning === "string"
    && typeof legacyConfig.planning?.root === "string"
  ) {
    const sourcePlanningRoot = resolveLegacyUserPath(
      legacyUserRoot,
      legacyConfig.planning.root,
    );
    const sourcePlanningPath = resolveLegacyUserPath(
      legacyUserRoot,
      join(legacyConfig.planning.root, planningChild),
    );
    const relativePlanningPath = normalizePath(
      relative(sourcePlanningRoot, sourcePlanningPath),
    );
    delete normalized.planning;
    if (isPathInside(sourcePlanningRoot, sourcePlanningPath)) {
      normalized.planning = canonicalizeLegacyLiteralTildeChild(relativePlanningPath);
    } else {
      normalized.planningPath = toWorkspaceConfigPath(
        workspaceRoot,
        sourcePlanningPath,
      );
    }
  }
  if (!Array.isArray(idea.repositories)) return normalized;
  normalized.repositories = idea.repositories.map((repository) => {
    if (
      !repository
      || typeof repository !== "object"
      || Array.isArray(repository)
      || typeof repository.path !== "string"
    ) return repository;
    const normalizedRepository = { ...repository };
    const repositoryChild = canonicalizeLegacyLiteralTildeChild(repository.path);
    if (repository.root === undefined) {
      normalizedRepository.path = rebaseLegacyUserPath(
        legacyUserRoot,
        workspaceRoot,
        repository.path,
      );
      return normalizedRepository;
    }
    if (!versionOne) {
      normalizedRepository.path = normalizePath(repositoryChild);
      return normalizedRepository;
    }
    const configuredRoot = legacyConfig.repositories?.roots?.[repository.root];
    if (typeof configuredRoot !== "string") return normalizedRepository;
    const sourceRepositoryRoot = resolveLegacyUserPath(
      legacyUserRoot,
      configuredRoot,
    );
    const sourceRepositoryPath = resolveLegacyUserPath(
      legacyUserRoot,
      join(configuredRoot, repositoryChild),
    );
    if (isPathInside(sourceRepositoryRoot, sourceRepositoryPath)) {
      normalizedRepository.path = canonicalizeLegacyLiteralTildeChild(
        normalizePath(relative(sourceRepositoryRoot, sourceRepositoryPath)),
      );
    } else {
      delete normalizedRepository.root;
      normalizedRepository.path = toWorkspaceConfigPath(
        workspaceRoot,
        sourceRepositoryPath,
      );
    }
    return normalizedRepository;
  });
  return normalized;
}

function normalizeLegacyUserConfigForWorkspace(
  legacyConfig,
  legacyUserRoot,
  workspaceRoot,
  skillsDirectory,
) {
  const normalized = structuredClone(legacyConfig);
  const versionOne = isLegacyUserV1Config(legacyConfig);
  delete normalized.kind;
  if (!versionOne) delete normalized.migration;
  normalized.version = WORKSPACE_CONFIG_VERSION;
  normalized.schema = WORKSPACE_SCHEMA_VERSION;
  if (normalized.skills && typeof normalized.skills === "object") {
    normalized.skills.directory = normalizeWorkspaceConfiguredPath(
      workspaceRoot,
      skillsDirectory,
    );
  }
  if (normalized.planning && typeof normalized.planning === "object") {
    if (versionOne) delete normalized.planning.plannedChangesDirectory;
    if (typeof normalized.planning.root === "string") {
      normalized.planning.root = rebaseLegacyUserPath(
        legacyUserRoot,
        workspaceRoot,
        normalized.planning.root,
      );
    }
  }
  if (
    normalized.repositories?.roots
    && typeof normalized.repositories.roots === "object"
    && !Array.isArray(normalized.repositories.roots)
  ) {
    normalized.repositories.roots = Object.fromEntries(
      Object.entries(normalized.repositories.roots).map(([rootId, path]) => [
        rootId,
        typeof path === "string"
          ? rebaseLegacyUserPath(legacyUserRoot, workspaceRoot, path)
          : path,
      ]),
    );
    if (Object.keys(normalized.repositories.roots).length === 0) {
      normalized.repositories.roots.workspace = ".";
    }
  }
  if (
    normalized.repositoryArtifacts
    && typeof normalized.repositoryArtifacts === "object"
    && !Array.isArray(normalized.repositoryArtifacts)
  ) {
    normalized.repositoryArtifacts = Object.fromEntries(
      Object.entries(normalized.repositoryArtifacts).map(([key, path]) => [
        key,
        canonicalizeLegacyLiteralTildeChild(path),
      ]),
    );
  }
  if (
    versionOne
    && normalized.repositoryArtifacts
    && typeof normalized.repositoryArtifacts === "object"
    && !Array.isArray(normalized.repositoryArtifacts)
  ) {
    delete normalized.repositoryArtifacts.activeChanges;
    delete normalized.repositoryArtifacts.closedChanges;
  }
  if (
    normalized.ideas
    && typeof normalized.ideas === "object"
    && !Array.isArray(normalized.ideas)
  ) {
    normalized.ideas = Object.fromEntries(
      Object.entries(normalized.ideas).map(([ideaId, idea]) => [
        ideaId,
        normalizeLegacyUserIdea(
          legacyConfig,
          idea,
          legacyUserRoot,
          workspaceRoot,
        ),
      ]),
    );
  }
  return normalizeWorkspaceConfigPaths(workspaceRoot, normalized);
}

export function createWorkspaceConfigFromLegacyHome(
  legacyConfig,
  legacyHomeRoot,
  workspaceRoot,
  { skillsDirectory = ".agents/skills" } = {},
) {
  if (legacyConfig?.kind === "user") {
    assertValidLegacyUserConfig(legacyConfig);
    const config = normalizeLegacyUserConfigForWorkspace(
      legacyConfig,
      legacyHomeRoot,
      workspaceRoot,
      skillsDirectory,
    );
    assertValidConfig(config, "migrate the legacy user installation");
    return config;
  }
  assertValidConfig(legacyConfig, "migrate the legacy home-root installation");
  const repositoryRoots = Object.fromEntries(
    Object.entries(legacyConfig.repositories.roots).map(([rootId, path]) => [
      rootId,
      rebaseLegacyUserPath(legacyHomeRoot, workspaceRoot, path),
    ]),
  );
  if (Object.keys(repositoryRoots).length === 0) repositoryRoots.workspace = ".";

  const ideas = Object.fromEntries(
    Object.entries(legacyConfig.ideas).map(([ideaId, idea]) => [
      ideaId,
      {
        ...idea,
        ...(idea.planningPath !== undefined
          ? {
              planningPath: rebaseLegacyUserPath(
                legacyHomeRoot,
                workspaceRoot,
                idea.planningPath,
              ),
            }
          : {}),
        repositories: idea.repositories.map((repository) =>
          repository.root
            ? { ...repository, path: normalizePath(repository.path) }
            : {
                ...repository,
                path: rebaseLegacyUserPath(
                  legacyHomeRoot,
                  workspaceRoot,
                  repository.path,
                ),
              }),
      },
    ]),
  );
  const config = normalizeWorkspaceConfigPaths(workspaceRoot, {
    version: WORKSPACE_CONFIG_VERSION,
    schema: WORKSPACE_SCHEMA_VERSION,
    skills: {
      directory: normalizeWorkspaceConfiguredPath(workspaceRoot, skillsDirectory),
    },
    planning: {
      root: rebaseLegacyUserPath(
        legacyHomeRoot,
        workspaceRoot,
        legacyConfig.planning.root,
      ),
    },
    repositories: { roots: repositoryRoots },
    repositoryArtifacts: currentArtifactPaths(legacyConfig.repositoryArtifacts),
    ideas,
  });
  assertValidConfig(config, "migrate the legacy home-root installation");
  return config;
}

export function isSupportedLegacyUserConfig(config) {
  return legacyUserConfigSignature(config) !== null;
}

export function isSupportedLegacyWorkspaceConfig(config) {
  return Boolean(
    config
    && typeof config === "object"
    && !Array.isArray(config)
    && config.kind === undefined
    && (
      (config.version === 2 && config.schema === "sdd-v2")
      || (config.version === 1 && config.schema === "sdd-v1")
    )
  );
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


export function isSupportedLegacyRepositoryConfig(config) {
  return Boolean(
    config
    && typeof config === "object"
    && !Array.isArray(config)
    && config.kind === "repository"
    && config.version === 1
    && config.schema === "sdd-repository-v1"
  );
}

function currentArtifactPaths(artifacts) {
  return Object.fromEntries(
    Object.keys(DEFAULT_ARTIFACT_PATHS).map((key) => [key, artifacts?.[key]]),
  );
}

export function migrateRepositoryConfig(config) {
  if (!isSupportedLegacyRepositoryConfig(config)) {
    return { config, migratedFrom: null };
  }
  return {
    migratedFrom: config.version,
    config: {
      kind: "repository",
      version: REPOSITORY_CONFIG_VERSION,
      schema: REPOSITORY_SCHEMA_VERSION,
      id: config.id,
      artifacts: currentArtifactPaths(config.artifacts),
    },
  };
}


function expandLegacyWorkspaceTildePath(legacyHomeRoot, configuredPath) {
  if (typeof configuredPath !== "string") return configuredPath;
  const usesHome = configuredPath === "~"
    || configuredPath.startsWith("~/")
    || configuredPath.startsWith("~\\");
  if (!usesHome) return configuredPath;
  if (
    typeof legacyHomeRoot !== "string"
    || legacyHomeRoot.length === 0
    || legacyHomeRoot.includes("\0")
  ) {
    throw new SddError(
      "Cannot migrate legacy workspace home-directory shorthand without a legacy home root.",
      { code: "INVALID_CONFIG", details: [configuredPath] },
    );
  }
  return configuredPath === "~"
    ? resolve(legacyHomeRoot)
    : resolve(legacyHomeRoot, configuredPath.slice(2));
}

function canonicalizeLegacyLiteralTildeChild(configuredPath) {
  if (typeof configuredPath !== "string") return configuredPath;
  if (configuredPath === "~") return "./~";
  if (configuredPath.startsWith("~/") || configuredPath.startsWith("~\\")) {
    return `./${normalizePath(configuredPath)}`;
  }
  return configuredPath;
}

function expandLegacyWorkspaceTildePaths(config, legacyHomeRoot) {
  const expanded = structuredClone(config);
  if (expanded.skills && typeof expanded.skills === "object" && !Array.isArray(expanded.skills)) {
    expanded.skills.directory = expandLegacyWorkspaceTildePath(
      legacyHomeRoot,
      expanded.skills.directory,
    );
  }
  if (
    expanded.planning
    && typeof expanded.planning === "object"
    && !Array.isArray(expanded.planning)
  ) {
    expanded.planning.root = expandLegacyWorkspaceTildePath(
      legacyHomeRoot,
      expanded.planning.root,
    );
  }

  if (
    expanded.repositoryArtifacts
    && typeof expanded.repositoryArtifacts === "object"
    && !Array.isArray(expanded.repositoryArtifacts)
  ) {
    expanded.repositoryArtifacts = Object.fromEntries(
      Object.entries(expanded.repositoryArtifacts).map(([artifact, path]) => [
        artifact,
        canonicalizeLegacyLiteralTildeChild(path),
      ]),
    );
  }

  const roots = expanded.repositories?.roots;
  if (Array.isArray(roots)) {
    expanded.repositories.roots = roots.map((path) =>
      expandLegacyWorkspaceTildePath(legacyHomeRoot, path),
    );
  } else if (roots && typeof roots === "object") {
    expanded.repositories.roots = Object.fromEntries(
      Object.entries(roots).map(([rootId, path]) => [
        rootId,
        expandLegacyWorkspaceTildePath(legacyHomeRoot, path),
      ]),
    );
  }

  if (expanded.ideas && typeof expanded.ideas === "object" && !Array.isArray(expanded.ideas)) {
    for (const idea of Object.values(expanded.ideas)) {
      if (!idea || typeof idea !== "object" || Array.isArray(idea)) continue;
      if (typeof idea.planning === "string") {
        idea.planning = expanded.version === 1
          ? expandLegacyWorkspaceTildePath(legacyHomeRoot, idea.planning)
          : canonicalizeLegacyLiteralTildeChild(idea.planning);
      }
      if (typeof idea.planningPath === "string") {
        idea.planningPath = expandLegacyWorkspaceTildePath(
          legacyHomeRoot,
          idea.planningPath,
        );
      }
      if (!Array.isArray(idea.repositories)) continue;
      for (const repository of idea.repositories) {
        if (
          !repository
          || typeof repository !== "object"
          || typeof repository.path !== "string"
        ) {
          continue;
        }
        repository.path = expanded.version === 1 || repository.root === undefined
          ? expandLegacyWorkspaceTildePath(legacyHomeRoot, repository.path)
          : canonicalizeLegacyLiteralTildeChild(repository.path);
      }
    }
  }
  return expanded;
}

export function migrateWorkspaceConfig(
  config,
  workspaceRoot,
  { legacyHomeRoot: requestedLegacyHomeRoot } = {},
) {
  if (!isSupportedLegacyWorkspaceConfig(config)) {
    return { config, migratedFrom: null };
  }

  const legacyHomeRoot = requestedLegacyHomeRoot === undefined
    ? workspaceRoot
    : requestedLegacyHomeRoot;
  const expanded = expandLegacyWorkspaceTildePaths(config, legacyHomeRoot);
  let normalized = expanded;
  if (expanded.version === 1 && expanded.schema === "sdd-v1") {
    const legacyRoots = Array.isArray(expanded.repositories?.roots)
      ? expanded.repositories.roots
      : [];
    const repositoryRoots = createRepositoryRootMap(legacyRoots);
    const planningRoot = expanded.planning?.root;
    const ideas = {};

    for (const [ideaId, idea] of Object.entries(expanded.ideas ?? {})) {
      const migratedIdea = {
        status: resolveWorkspaceStatus(idea?.status),
        repositories: [],
      };
      if (typeof idea?.planning === "string" && typeof planningRoot === "string") {
        const absolutePlanningRoot = resolve(workspaceRoot, planningRoot);
        const absoluteIdeaPlanning = resolve(workspaceRoot, idea.planning);
        if (isPathInside(absolutePlanningRoot, absoluteIdeaPlanning)) {
          const relativePlanning = normalizePath(relative(absolutePlanningRoot, absoluteIdeaPlanning));
          if (relativePlanning !== ideaId) migratedIdea.planning = relativePlanning;
        } else {
          migratedIdea.planningPath = normalizePath(idea.planning);
        }
      }
      migratedIdea.repositories = (idea?.repositories ?? []).map((repository) =>
        toRepositoryReference(workspaceRoot, repository, repositoryRoots));
      ideas[ideaId] = migratedIdea;
    }
    normalized = {
      ...expanded,
      repositories: { roots: repositoryRoots },
      ideas,
    };
  }

  return {
    migratedFrom: config.version,
    config: normalizeWorkspaceConfigPaths(workspaceRoot, {
      version: WORKSPACE_CONFIG_VERSION,
      schema: WORKSPACE_SCHEMA_VERSION,
      skills: normalized.skills,
      planning: { root: normalized.planning?.root },
      repositories: normalized.repositories,
      repositoryArtifacts: currentArtifactPaths(normalized.repositoryArtifacts),
      ideas: normalized.ideas,
    }),
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

function legacyOwnerPathForValidation(value) {
  if (typeof value !== "string" || !value || value.includes("\0")) return value;
  return normalizePath(resolveLegacyUserPath("/legacy-user", value));
}

function inspectLegacyMigrationLocator(config) {
  if (!Object.hasOwn(config, "migration")) {
    return { findings: [], sourceWorkspace: null };
  }
  const migration = config.migration;
  if (!migration || typeof migration !== "object" || Array.isArray(migration)) {
    return {
      findings: [{
        level: "error",
        message: "Legacy migration must be a mapping.",
      }],
      sourceWorkspace: null,
    };
  }

  const findings = [];
  for (const key of Object.keys(migration)) {
    if (key !== "sourceWorkspace") {
      findings.push({
        level: "error",
        message: `Legacy migration contains unknown key: ${key}.`,
      });
    }
  }
  const sourceWorkspace = migration.sourceWorkspace;
  if (typeof sourceWorkspace !== "string" || !sourceWorkspace.trim()) {
    findings.push({
      level: "error",
      message: "Legacy migration.sourceWorkspace must be a non-empty path.",
    });
  } else if (sourceWorkspace.includes("\0")) {
    findings.push({
      level: "error",
      message: "Legacy migration.sourceWorkspace must not contain NUL bytes.",
    });
  } else if (
    sourceWorkspace === "~"
    || sourceWorkspace.startsWith("~/")
    || sourceWorkspace.startsWith("~\\")
  ) {
    findings.push({
      level: "error",
      message: "Legacy migration.sourceWorkspace must not use home-directory shorthand.",
    });
  } else if (sourceWorkspace.split(/[\\/]/).includes("..")) {
    findings.push({
      level: "error",
      message: "Legacy migration.sourceWorkspace cannot traverse to a parent directory.",
    });
  }

  return {
    findings,
    sourceWorkspace: findings.length === 0 ? sourceWorkspace : null,
  };
}

function inspectLegacyUserV1Layout(config) {
  const findings = [];
  const inspectTopologyPath = (label, path) => {
    if (typeof path !== "string" || !path || path.includes("\0")) {
      findings.push({
        level: "error",
        message: `Legacy ${label} must be a non-empty path without NUL bytes.`,
      });
    }
  };
  inspectTopologyPath("planning.root", config.planning?.root);
  if (
    config.repositories?.roots
    && typeof config.repositories.roots === "object"
    && !Array.isArray(config.repositories.roots)
  ) {
    for (const [rootId, path] of Object.entries(config.repositories.roots)) {
      inspectTopologyPath(`repositories.roots.${rootId}`, path);
    }
  }
  if (config.ideas && typeof config.ideas === "object" && !Array.isArray(config.ideas)) {
    for (const [ideaId, idea] of Object.entries(config.ideas)) {
      if (!idea || typeof idea !== "object" || Array.isArray(idea)) continue;
      if (idea.planning !== undefined) {
        inspectTopologyPath(`ideas.${ideaId}.planning`, idea.planning);
      }
      if (idea.planningPath !== undefined) {
        inspectTopologyPath(`ideas.${ideaId}.planningPath`, idea.planningPath);
      }
      if (!Array.isArray(idea.repositories)) continue;
      for (const repository of idea.repositories) {
        if (!repository || typeof repository !== "object" || Array.isArray(repository)) continue;
        inspectTopologyPath(`ideas.${ideaId}.repositories path`, repository.path);
        if (
          typeof repository.root === "string"
          && repository.root
          && !Object.hasOwn(config.repositories?.roots ?? {}, repository.root)
        ) {
          findings.push({
            level: "error",
            message: `Legacy ideas.${ideaId}.repositories references unknown root ${repository.root}.`,
          });
        }
      }
    }
  }
  const plannedChangesDirectory = config.planning?.plannedChangesDirectory;
  if (
    typeof plannedChangesDirectory !== "string"
    || !plannedChangesDirectory
    || plannedChangesDirectory.includes("\0")
  ) {
    findings.push({
      level: "error",
      message: "Legacy planning.plannedChangesDirectory must be a non-empty path without NUL bytes.",
    });
  } else if (
    isAbsolute(plannedChangesDirectory)
    || /^[A-Za-z]:/.test(plannedChangesDirectory)
    || plannedChangesDirectory === "."
    || plannedChangesDirectory === "~"
    || plannedChangesDirectory.startsWith("~/")
    || plannedChangesDirectory.startsWith("~\\")
    || plannedChangesDirectory.split(/[\\/]/).includes("..")
  ) {
    findings.push({
      level: "error",
      message: "Legacy planning.plannedChangesDirectory must be owner-relative and cannot traverse to a parent directory.",
    });
  }
  for (const key of ["activeChanges", "closedChanges"]) {
    const path = canonicalizeLegacyLiteralTildeChild(config.repositoryArtifacts?.[key]);
    if (typeof path !== "string" || !path || path.includes("\0")) {
      findings.push({
        level: "error",
        message: `Legacy repositoryArtifacts.${key} must be a non-empty path without NUL bytes.`,
      });
    }
    if (
      typeof path === "string"
      && path
      && (
        isAbsolute(path)
        || /^[\\/]/.test(path)
        || /^[A-Za-z]:/.test(path)
        || path === "~"
        || path.startsWith("~/")
        || path.startsWith("~\\")
        || path.split(/[\\/]/).includes("..")
      )
    ) {
      findings.push({
        level: "error",
        message: `Legacy repositoryArtifacts.${key} must be repository-relative and cannot traverse to a parent directory.`,
      });
    }
  }
  const artifactEntries = [
    "activeChanges",
    "closedChanges",
    ...Object.keys(DEFAULT_ARTIFACT_PATHS),
  ].flatMap((key) => {
    const path = canonicalizeLegacyLiteralTildeChild(config.repositoryArtifacts?.[key]);
    return typeof path === "string" && path && !path.includes("\0")
      ? [[key, normalizePath(resolve("/", path))]]
      : [];
  });
  for (const [key, path] of artifactEntries) {
    if (path === "/") {
      findings.push({
        level: "error",
        message: `Legacy repositoryArtifacts.${key} must not own the repository root.`,
      });
    }
  }
  for (let leftIndex = 0; leftIndex < artifactEntries.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < artifactEntries.length;
      rightIndex += 1
    ) {
      const [leftKey, leftPath] = artifactEntries[leftIndex];
      const [rightKey, rightPath] = artifactEntries[rightIndex];
      const allowedClosedChild = leftKey === "activeChanges"
        && rightKey === "closedChanges"
        && dirname(rightPath) === leftPath;
      if (
        !allowedClosedChild
        && (
          leftPath === rightPath
          || isPathInside(leftPath, rightPath)
          || isPathInside(rightPath, leftPath)
        )
      ) {
        findings.push({
          level: "error",
          message: `Legacy repositoryArtifacts.${leftKey} and repositoryArtifacts.${rightKey} overlap invalidly.`,
        });
      }
    }
  }
  return findings;
}

function projectLegacyUserV2ForValidation(config) {
  const projected = structuredClone(config);
  delete projected.kind;
  delete projected.migration;
  projected.version = WORKSPACE_CONFIG_VERSION;
  projected.schema = WORKSPACE_SCHEMA_VERSION;
  if (projected.skills && typeof projected.skills === "object") {
    projected.skills.directory = ".agents/skills";
  }
  if (projected.planning && typeof projected.planning === "object") {
    projected.planning.root = legacyOwnerPathForValidation(projected.planning.root);
  }
  if (
    projected.repositories?.roots
    && typeof projected.repositories.roots === "object"
    && !Array.isArray(projected.repositories.roots)
  ) {
    projected.repositories.roots = Object.fromEntries(
      Object.entries(projected.repositories.roots).map(([id, path]) => [
        id,
        legacyOwnerPathForValidation(path),
      ]),
    );
    if (Object.keys(projected.repositories.roots).length === 0) {
      projected.repositories.roots.workspace = ".";
    }
  }
  if (
    projected.repositoryArtifacts
    && typeof projected.repositoryArtifacts === "object"
    && !Array.isArray(projected.repositoryArtifacts)
  ) {
    projected.repositoryArtifacts = Object.fromEntries(
      Object.entries(projected.repositoryArtifacts).map(([key, path]) => [
        key,
        canonicalizeLegacyLiteralTildeChild(path),
      ]),
    );
  }
  if (
    projected.ideas
    && typeof projected.ideas === "object"
    && !Array.isArray(projected.ideas)
  ) {
    for (const idea of Object.values(projected.ideas)) {
      if (!idea || typeof idea !== "object" || Array.isArray(idea)) continue;
      if (idea.planning !== undefined) {
        idea.planning = canonicalizeLegacyLiteralTildeChild(idea.planning);
      }
      if (idea.planningPath !== undefined) {
        idea.planningPath = legacyOwnerPathForValidation(idea.planningPath);
      }
      if (!Array.isArray(idea.repositories)) continue;
      for (const repository of idea.repositories) {
        if (!repository || typeof repository !== "object") continue;
        repository.path = repository.root
          ? canonicalizeLegacyLiteralTildeChild(repository.path)
          : legacyOwnerPathForValidation(repository.path);
      }
    }
  }
  return projected;
}

function projectLegacyUserV1ForValidation(config) {
  return normalizeLegacyUserConfigForWorkspace(
    config,
    "/legacy-user",
    "/workspace",
    ".agents/skills",
  );
}

export function validateLegacyUserConfig(config) {
  const signature = legacyUserConfigSignature(config);
  if (!signature) {
    return [{
      level: "error",
      message: "Legacy user configuration must match a released migration input: kind user with version 1/schema sdd-user-v1 or version 2/schema sdd-user-v2.",
    }];
  }
  const locator = signature.version === 2
    ? inspectLegacyMigrationLocator(config)
    : { findings: [], sourceWorkspace: null };
  const findings = [
    ...locator.findings,
    ...(signature.version === 1 ? inspectLegacyUserV1Layout(config) : []),
  ];
  if (locator.sourceWorkspace !== null) {
    findings.push({
      level: "error",
      message: "Legacy migration.sourceWorkspace must be migrated before this user configuration can become workspace authority.",
    });
  }
  if (
    typeof config.skills?.directory !== "string"
    || !config.skills.directory
    || config.skills.directory.includes("\0")
  ) {
    findings.push({
      level: "error",
      message: "Legacy skills.directory must be a non-empty path without NUL bytes.",
    });
  }
  let projected;
  try {
    projected = signature.version === 1
      ? projectLegacyUserV1ForValidation(config)
      : projectLegacyUserV2ForValidation(config);
  } catch (error) {
    findings.push({
      level: "error",
      message: error?.message ?? "Legacy user configuration could not be normalized.",
    });
    return findings;
  }
  return [...findings, ...validateConfig(projected)];
}

export function assertValidLegacyUserConfig(config) {
  const signature = legacyUserConfigSignature(config);
  const locator = signature?.version === 2
    ? inspectLegacyMigrationLocator(config)
    : { findings: [], sourceWorkspace: null };
  if (locator.sourceWorkspace !== null) {
    throw new SddError(
      "Legacy migration.sourceWorkspace remains unresolved. Complete that source-workspace migration before running `sdd setup <workspace> --from-user <legacy-user-root>`.",
      {
        code: "MIGRATION_SOURCE_UNAVAILABLE",
        details: [locator.sourceWorkspace],
      },
    );
  }
  const errors = validateLegacyUserConfig(config)
    .filter((finding) => finding.level === "error");
  if (errors.length > 0) {
    throw new SddError("Cannot migrate an invalid legacy user SDD configuration.", {
      code: "INVALID_LEGACY_USER_CONFIG",
      details: errors.map((finding) => finding.message),
    });
  }
  return config;
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
  if (isSupportedLegacyRepositoryConfig(config)) {
    throw new SddError("Repository configuration migration is required. Run `sdd update` before using this repository.", {
      code: "CONFIG_MIGRATION_REQUIRED",
    });
  }
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
  if (isSupportedLegacyUserConfig(config)) {
    throw new SddError(
      "Legacy user configuration is migration input only. Run `sdd setup <workspace> --from-user <legacy-user-root>`.",
      { code: "LEGACY_USER_MIGRATION_REQUIRED" },
    );
  }
  if (isSupportedLegacyWorkspaceConfig(config)) {
    throw new SddError(
      "SDD workspace configuration migration is required. Run `sdd update` before using this workspace.",
      { code: "CONFIG_MIGRATION_REQUIRED" },
    );
  }
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
