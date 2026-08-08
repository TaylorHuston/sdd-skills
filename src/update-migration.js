import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseDocument, stringify } from "yaml";

import { isValidChangeId } from "./change-id.js";
import {
  assertValidConfig,
  assertValidRepositoryConfig,
  getConfigPath,
  getUserRoot,
  isSupportedLegacyConfig,
  isSupportedLegacyRepositoryConfig,
  migrateConfig,
  readConfig,
  migrateRepositoryConfig,
  resolveIdeaPlanningPath,
  resolveRepositoryPath,
  resolveWorkspacePath,
  resolveWorkspaceStatus,
} from "./config.js";
import {
  assertChangeStoreConfinement,
  getActiveChangePath,
  getClosedChangePath,
  getChangesRoot,
  listStoredChanges,
} from "./change-store.js";
import { parseChangeMetadata, setChangeMetadata } from "./change-status.js";
import { CHANGE_BRIEFS_DIRECTORY_NAME } from "./constants.js";
import { SddError } from "./errors.js";
import {
  hashDirectory,
  hashFile,
  isPathInside,
  isPathPhysicallyInside,
  pathExists,
  replaceFileAtomically,
  resolvePhysicalPath,
  writeJson,
  writeFileAtomically,
} from "./fs.js";

function normalizePath(value) {
  return value.split(sep).join("/") || ".";
}

function sourceHash(source) {
  return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}

function migrationError(message, code, details = []) {
  return new SddError(message, {
    code,
    ...(details.length > 0 ? { details: [...details].sort((left, right) => left.localeCompare(right)) } : {}),
  });
}

function parseYaml(source, sourcePath) {
  const document = parseDocument(source);
  if (document.errors.length > 0) {
    throw migrationError(
      `Cannot parse legacy configuration: ${sourcePath}`,
      "INVALID_YAML",
      [document.errors[0].message],
    );
  }
  return document.toJS();
}

function assertLegacyRelativePath(value, label) {
  if (
    typeof value !== "string"
    || value.length === 0
    || isAbsolute(value)
    || /^[\\/]/.test(value)
    || /^[A-Za-z]:[\\/]/.test(value)
    || value === "~"
    || value.startsWith("~/")
    || value.startsWith("~\\")
    || value.split(/[\\/]/).includes("..")
  ) {
    throw migrationError(
      `${label} is not a safe owner-relative legacy path.`,
      "UNSAFE_CONFIG_PATH",
      [`Configured value: ${String(value)}`],
    );
  }
  return value;
}

async function pathState(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error?.code)) return null;
    throw error;
  }
}

async function assertDirectoryRoot(ownerRoot, root, label) {
  const state = await pathState(root);
  if (!state) return false;
  if (state.isSymbolicLink() || !state.isDirectory()) {
    throw migrationError(`${label} is not a real directory: ${root}`, "UNSAFE_ARTIFACT_PATH");
  }
  if (!(await isPathPhysicallyInside(ownerRoot, root))) {
    throw migrationError(`${label} resolves outside its owner: ${root}`, "UNSAFE_ARTIFACT_PATH");
  }
  return true;
}

function fileIdentity(state) {
  return { dev: String(state.dev), ino: String(state.ino) };
}

function sameFileIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino;
}

function isStrictlyInside(parent, child) {
  return resolve(parent) !== resolve(child) && isPathInside(parent, child);
}

async function captureDirectoryAnchor(path, label, code = "UNSAFE_ARTIFACT_PATH") {
  const state = await pathState(path);
  if (!state?.isDirectory() || state.isSymbolicLink()) {
    throw migrationError(`${label} is unavailable or is not a real directory: ${path}`, code);
  }
  const physicalPath = await resolvePhysicalPath(path);
  const physicalState = await pathState(physicalPath);
  if (!physicalState?.isDirectory() || physicalState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(state), fileIdentity(physicalState))) {
    throw migrationError(`${label} changed while its physical identity was captured: ${path}`, code);
  }
  return {
    logicalPath: resolve(path),
    physicalPath,
    ...fileIdentity(physicalState),
  };
}

async function assertStoredDirectoryAnchor(path, expected, label) {
  const current = await captureDirectoryAnchor(path, label, "CONCURRENT_CHANGE");
  if (current.logicalPath !== expected.logicalPath
    || current.physicalPath !== expected.physicalPath
    || !sameFileIdentity(current, expected)) {
    throw migrationError(`${label} changed physical identity: ${path}`, "CONCURRENT_CHANGE", [
      `Expected: ${expected.physicalPath} (${expected.dev}:${expected.ino})`,
      `Actual: ${current.physicalPath} (${current.dev}:${current.ino})`,
    ]);
  }
  return current;
}

function sourceOwnerAnchor(root) {
  return {
    logicalPath: resolve(root.ownerRoot),
    physicalPath: root.ownerPhysicalPath,
    dev: root.ownerIdentity.dev,
    ino: root.ownerIdentity.ino,
  };
}

function sourceDirectoryAnchor(root) {
  return {
    logicalPath: resolve(root.path),
    physicalPath: root.physicalPath,
    dev: root.identity.dev,
    ino: root.identity.ino,
  };
}

async function captureSourceRoot(path, ownerRoot) {
  const owner = await captureDirectoryAnchor(ownerRoot, "Legacy source owner");
  const source = await captureDirectoryAnchor(path, "Legacy source root");
  if (!isStrictlyInside(owner.physicalPath, source.physicalPath)) {
    throw migrationError(
      `Legacy source root is not physically confined beneath its owner: ${path}`,
      "UNSAFE_ARTIFACT_PATH",
      [ownerRoot],
    );
  }
  const hash = await hashDirectory(source.physicalPath);
  const [verifiedOwner, verifiedSource] = await Promise.all([
    assertStoredDirectoryAnchor(ownerRoot, owner, "Legacy source owner"),
    assertStoredDirectoryAnchor(path, source, "Legacy source root"),
  ]);
  return {
    path,
    hash,
    ownerRoot,
    physicalPath: verifiedSource.physicalPath,
    identity: { dev: verifiedSource.dev, ino: verifiedSource.ino },
    ownerPhysicalPath: verifiedOwner.physicalPath,
    ownerIdentity: { dev: verifiedOwner.dev, ino: verifiedOwner.ino },
  };
}

async function assertSourceRootAnchor(root, { verifyHash = true } = {}) {
  const [owner, source] = await Promise.all([
    assertStoredDirectoryAnchor(root.ownerRoot, sourceOwnerAnchor(root), "Legacy source owner"),
    assertStoredDirectoryAnchor(root.path, sourceDirectoryAnchor(root), "Legacy source root"),
  ]);
  if (!isStrictlyInside(owner.physicalPath, source.physicalPath)) {
    throw migrationError(
      `Legacy source root escaped its preflighted owner: ${root.path}`,
      "UNSAFE_ARTIFACT_PATH",
      [root.ownerRoot],
    );
  }
  if (verifyHash && await hashDirectory(source.physicalPath) !== root.hash) {
    throw migrationError(`Legacy source changed after migration preflight: ${root.path}`, "CONCURRENT_CHANGE");
  }
  return source;
}

async function collectTreeEntries(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  const collected = [];
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    const relativePath = normalizePath(relative(root, absolutePath));
    if (entry.isSymbolicLink()) {
      throw migrationError(
        `Legacy Change contains a symbolic link: ${absolutePath}`,
        "UNSAFE_ARTIFACT_PATH",
      );
    }
    if (entry.isDirectory()) {
      collected.push({ type: "directory", relativePath, absolutePath });
      collected.push(...await collectTreeEntries(root, absolutePath));
    } else if (entry.isFile()) {
      collected.push({ type: "file", relativePath, absolutePath });
    } else {
      throw migrationError(
        `Legacy Change contains an unsupported filesystem entry: ${absolutePath}`,
        "UNSAFE_ARTIFACT_PATH",
      );
    }
  }
  return collected;
}

async function canonicalDirectoryHash(root, tasksSource) {
  const hash = createHash("sha256");
  for (const entry of await collectTreeEntries(root)) {
    hash.update(`${entry.type}\0${entry.relativePath}\0`);
    if (entry.type === "file") {
      hash.update(entry.relativePath === "tasks.md" ? tasksSource : await readFile(entry.absolutePath));
    }
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

async function readChangeCandidate(path, details) {
  await collectTreeEntries(path);
  const tasksPath = join(path, "tasks.md");
  const tasksState = await pathState(tasksPath);
  if (!tasksState?.isFile()) {
    throw migrationError(
      `Legacy Change is missing a regular tasks.md file: ${path}`,
      "INVALID_CHANGE_METADATA",
    );
  }
  const tasksSource = await readFile(tasksPath, "utf8");
  if (setChangeMetadata(tasksSource, { space: details.spaceId, repositories: [] }) === null) {
    throw migrationError(
      `Legacy Change has malformed tasks.md frontmatter: ${tasksPath}`,
      "INVALID_CHANGE_METADATA",
    );
  }
  return {
    ...details,
    path,
    tasksSource,
    hash: await hashDirectory(path),
  };
}

async function readRootEntries(root) {
  const entries = await readdir(root, { withFileTypes: true });
  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

function legacyPlannedTargetPaths(source, proposalPath) {
  const section = /^## Target Repositories\s*\r?\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(source);
  if (!section) return null;
  if (/None selected; this Space has no mapped implementation repository yet\./.test(section[1])) {
    return [];
  }
  const paths = [...section[1].matchAll(/^-\s+`([^`\r\n]+)`(?:\s+\([^)]+\))?\s*$/gm)]
    .map((match) => normalizePath(match[1]));
  if (paths.length === 0) {
    throw migrationError(
      `Legacy planned Change has no recoverable target repository paths: ${proposalPath}`,
      "MIGRATION_TARGET_REQUIRED",
    );
  }
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
}

async function resolveLegacyPlannedRepositoryIds(changePath, spaceId, mappedContexts) {
  const proposalPath = join(changePath, "proposal.md");
  const proposalState = await pathState(proposalPath);
  if (!proposalState?.isFile()) {
    throw migrationError(
      `Legacy planned Change is missing a regular proposal.md file: ${changePath}`,
      "INVALID_CHANGE_METADATA",
    );
  }
  const recordedPaths = legacyPlannedTargetPaths(await readFile(proposalPath, "utf8"), proposalPath);
  if (recordedPaths === null) {
    if (mappedContexts.length === 0) return [];
    if (mappedContexts.length === 1 && mappedContexts[0].repositoryId) {
      return [mappedContexts[0].repositoryId];
    }
    throw migrationError(
      `Legacy planned Change has ambiguous target repositories: ${changePath}`,
      "MIGRATION_TARGET_REQUIRED",
      mappedContexts.map((context) => context.resolvedPath),
    );
  }
  if (recordedPaths.length === 0) {
    if (mappedContexts.length === 0) return [];
    throw migrationError(
      `Legacy planned Change recorded no repositories but the Space now has mapped targets: ${changePath}`,
      "MIGRATION_TARGET_REQUIRED",
      mappedContexts.map((context) => context.resolvedPath),
    );
  }

  const selected = [];
  for (const recordedPath of recordedPaths) {
    const matches = mappedContexts.filter((context) => context.resolvedPath === recordedPath);
    if (matches.length !== 1) {
      throw migrationError(
        `Legacy planned Change target cannot be resolved for ${spaceId}: ${recordedPath}`,
        "MIGRATION_TARGET_REQUIRED",
        [proposalPath, ...mappedContexts.map((context) => context.resolvedPath)],
      );
    }
    if (!matches[0].repositoryId) {
      throw migrationError(
        `Legacy planned Change target has no portable repository identity: ${recordedPath}`,
        "MIGRATION_IDENTITY_REQUIRED",
        [matches[0].repositoryRoot],
      );
    }
    selected.push(matches[0].repositoryId);
  }
  return [...new Set(selected)].sort((left, right) => left.localeCompare(right));
}

async function scanPlannedRoot(root, planningRoot, spaceId, mappedContexts) {
  if (!(await assertDirectoryRoot(planningRoot, root, `Legacy planned Change root for ${spaceId}`))) {
    return { candidates: [], briefs: [], sourceRoot: null };
  }
  const candidates = [];
  const briefs = [];
  for (const entry of await readRootEntries(root)) {
    const sourcePath = join(root, entry.name);
    if (entry.isSymbolicLink()) {
      throw migrationError(`Legacy planned entry is a symbolic link: ${sourcePath}`, "UNSAFE_ARTIFACT_PATH");
    }
    if (entry.isDirectory() && isValidChangeId(entry.name)) {
      const repositoryIds = await resolveLegacyPlannedRepositoryIds(sourcePath, spaceId, mappedContexts);
      candidates.push(await readChangeCandidate(sourcePath, {
        changeId: entry.name,
        spaceId,
        repositoryIds,
        closed: false,
        origin: "planned",
      }));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md") && !isValidChangeId(entry.name.slice(0, -3))) {
      const destination = join(planningRoot, CHANGE_BRIEFS_DIRECTORY_NAME, entry.name);
      if (!(await isPathPhysicallyInside(planningRoot, destination))) {
        throw migrationError(`Change Brief destination escapes its planning root: ${destination}`, "UNSAFE_ARTIFACT_PATH");
      }
      if (await pathExists(destination)) {
        throw migrationError(
          `Change Brief migration destination already exists: ${destination}`,
          "CHANGE_BRIEF_COLLISION",
          [`Source: ${sourcePath}`],
        );
      }
      briefs.push({
        kind: "brief",
        spaceId,
        sourcePath,
        destination,
        ownerRoot: planningRoot,
        source: await readFile(sourcePath),
        hash: await hashFile(sourcePath),
      });
      continue;
    }
    throw migrationError(
      `Unsupported entry in legacy planned Change root: ${sourcePath}`,
      "UNSUPPORTED_LEGACY_CHANGE_ENTRY",
    );
  }
  return {
    candidates,
    briefs,
    sourceRoot: await captureSourceRoot(root, planningRoot),
  };
}

async function scanRepositoryChangeRoot(root, repositoryRoot, spaceId, repositoryId, closed, skipPath = null) {
  if (!(await assertDirectoryRoot(repositoryRoot, root, `Legacy repository Change root for ${repositoryId}`))) {
    return { candidates: [], sourceRoot: null };
  }
  const candidates = [];
  for (const entry of await readRootEntries(root)) {
    const sourcePath = join(root, entry.name);
    if (skipPath && resolve(sourcePath) === resolve(skipPath)) continue;
    if (entry.isSymbolicLink()) {
      throw migrationError(`Legacy repository Change entry is a symbolic link: ${sourcePath}`, "UNSAFE_ARTIFACT_PATH");
    }
    if (!entry.isDirectory() || !isValidChangeId(entry.name)) {
      throw migrationError(
        `Unsupported entry in legacy repository Change root: ${sourcePath}`,
        "UNSUPPORTED_LEGACY_CHANGE_ENTRY",
      );
    }
    candidates.push(await readChangeCandidate(sourcePath, {
      changeId: entry.name,
      spaceId,
      repositoryIds: [repositoryId],
      closed,
      origin: closed ? "closed" : "active",
    }));
  }
  return {
    candidates,
    sourceRoot: await captureSourceRoot(root, repositoryRoot),
  };
}

function serializeConfig(config) {
  return stringify(config, { lineWidth: 0, sortMapEntries: false });
}

async function createConfigWrite(ownerRoot, config, nextConfig, kind) {
  const path = getConfigPath(ownerRoot);
  const originalSource = await readFile(path, "utf8");
  const nextSource = serializeConfig(nextConfig);
  return {
    kind,
    ownerRoot,
    path,
    originalSource,
    originalHash: sourceHash(originalSource),
    nextSource,
    nextHash: sourceHash(nextSource),
    fromVersion: config.version,
    fromSchema: config.schema,
    toVersion: nextConfig.version,
    toSchema: nextConfig.schema,
  };
}

async function loadRepositoryConfiguration(repositoryRoot) {
  const path = getConfigPath(repositoryRoot);
  if (!(await pathExists(path))) return null;
  const source = await readFile(path, "utf8");
  const config = parseYaml(source, path);
  if (config?.kind !== "repository") {
    throw migrationError(
      `Mapped repository has a non-repository SDD configuration: ${path}`,
      "INVALID_REPOSITORY_CONFIG",
    );
  }
  const migrated = migrateRepositoryConfig(config);
  assertValidRepositoryConfig(migrated.config);
  return {
    config,
    nextConfig: migrated.config,
    migratedFrom: migrated.migratedFrom,
    path,
  };
}

function legacyRepositoryArtifacts(rawRepositoryConfig, rawConfig) {
  const repositoryArtifacts = rawRepositoryConfig?.artifacts;
  if (repositoryArtifacts?.activeChanges !== undefined || repositoryArtifacts?.closedChanges !== undefined) {
    return repositoryArtifacts;
  }
  const workspaceArtifacts = rawConfig?.repositoryArtifacts;
  if (workspaceArtifacts?.activeChanges !== undefined || workspaceArtifacts?.closedChanges !== undefined) {
    return workspaceArtifacts;
  }
  return null;
}

function addSourceRoot(sourceRoots, root) {
  if (!root) return;
  const key = root.physicalPath;
  const previous = sourceRoots.get(key);
  if (previous && (
    previous.hash !== root.hash
    || !sameFileIdentity(previous.identity, root.identity)
    || resolve(previous.path) !== resolve(root.path)
  )) {
    throw migrationError(
      `Legacy source root has ambiguous physical aliases: ${root.path}`,
      "LEGACY_SOURCE_COLLISION",
      [previous.path, root.path],
    );
  }
  sourceRoots.set(key, root);
}

function assertNonOverlappingSourceRoots(sourceRoots) {
  const roots = [...sourceRoots.values()]
    .sort((left, right) => left.physicalPath.localeCompare(right.physicalPath));
  for (let index = 0; index < roots.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < roots.length; otherIndex += 1) {
      if (isPathInside(roots[index].physicalPath, roots[otherIndex].physicalPath)
        || isPathInside(roots[otherIndex].physicalPath, roots[index].physicalPath)) {
        throw migrationError(
          "Legacy migration source roots overlap physically.",
          "LEGACY_SOURCE_COLLISION",
          [roots[index].path, roots[otherIndex].path],
        );
      }
    }
  }
}

function publicActionSort(left, right) {
  return left.kind.localeCompare(right.kind)
    || String(left.changeId ?? left.to ?? left.path).localeCompare(String(right.changeId ?? right.to ?? right.path));
}

export async function planUpdateMigration(
  workspaceRoot,
  rawConfig,
  {
    userRoot = getUserRoot(),
    legacyWorkspaceRoot: requestedLegacyWorkspaceRoot = null,
  } = {},
) {
  const migrated = migrateConfig(rawConfig, workspaceRoot);
  let config = migrated.config;
  assertValidConfig(config, "update the SDD installation");

  const candidates = [];
  const briefs = [];
  const sourceRoots = new Map();
  const configWrites = [];
  const readGuards = [];
  const warnings = [];
  if (migrated.migratedFrom !== null) {
    configWrites.push(await createConfigWrite(workspaceRoot, rawConfig, config, "configuration"));
  }

  let legacyConfig = rawConfig;
  let legacyWorkspaceRoot = workspaceRoot;
  if (requestedLegacyWorkspaceRoot
    && resolve(requestedLegacyWorkspaceRoot) !== resolve(workspaceRoot)) {
    legacyWorkspaceRoot = resolve(requestedLegacyWorkspaceRoot);
    const legacyRootState = await pathState(legacyWorkspaceRoot);
    if (!legacyRootState?.isDirectory() || legacyRootState.isSymbolicLink()) {
      throw migrationError(
        `Legacy migration workspace is unavailable or unsafe: ${legacyWorkspaceRoot}`,
        "MIGRATION_SOURCE_UNAVAILABLE",
      );
    }
    const legacyConfigPath = getConfigPath(legacyWorkspaceRoot);
    const legacyConfigState = await pathState(legacyConfigPath);
    if (!legacyConfigState?.isFile() || legacyConfigState.isSymbolicLink()) {
      throw migrationError(
        `Legacy migration configuration is unavailable or unsafe: ${legacyConfigPath}`,
        "MIGRATION_SOURCE_UNAVAILABLE",
      );
    }
    const beforeReadHash = await hashFile(legacyConfigPath);
    legacyConfig = await readConfig(legacyWorkspaceRoot);
    const afterReadHash = await hashFile(legacyConfigPath);
    if (beforeReadHash !== afterReadHash) {
      throw migrationError(
        `Legacy migration configuration changed during preflight: ${legacyConfigPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    if (!isSupportedLegacyConfig(legacyConfig)) {
      throw migrationError(
        `Configured legacy migration source is not supported: ${legacyConfigPath}`,
        "MIGRATION_SOURCE_UNAVAILABLE",
      );
    }
    assertValidConfig(
      migrateConfig(legacyConfig, legacyWorkspaceRoot).config,
      "read the legacy migration source",
    );
    readGuards.push({ path: legacyConfigPath, hash: afterReadHash });
    if (config.migration !== undefined) {
      const nextConfig = structuredClone(config);
      delete nextConfig.migration;
      configWrites.push(await createConfigWrite(
        workspaceRoot,
        rawConfig,
        nextConfig,
        "configuration",
      ));
      config = nextConfig;
    }
  }

  const unavailableSources = [];
  const repositoryContexts = new Map();
  for (const [spaceId, space] of Object.entries(config.ideas ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    for (const repository of space.repositories ?? []) {
      const configuredPath = resolveRepositoryPath(config, repository);
      const repositoryRoot = resolveWorkspacePath(workspaceRoot, configuredPath);
      const physicalPath = await resolvePhysicalPath(repositoryRoot);
      let context = repositoryContexts.get(physicalPath);
      if (!context) {
        context = {
          repositoryRoot,
          physicalPath,
          resolvedPath: normalizePath(configuredPath),
          owners: [],
          repository,
          configuration: null,
          legacyArtifacts: null,
          candidates: [],
          sourceRoots: [],
        };
        repositoryContexts.set(physicalPath, context);
      }
      context.owners.push({ spaceId, repository, status: resolveWorkspaceStatus(repository.status) });
    }
  }

  for (const context of [...repositoryContexts.values()].sort((left, right) => left.repositoryRoot.localeCompare(right.repositoryRoot))) {
    const repositoryState = await pathState(context.repositoryRoot);
    if (!repositoryState) {
      if (isSupportedLegacyConfig(legacyConfig)) {
        unavailableSources.push(context.repositoryRoot);
      } else {
        warnings.push(`Mapped repository is unavailable and has no discoverable legacy source: ${context.repositoryRoot}`);
      }
      continue;
    }
    if (repositoryState.isSymbolicLink() || !repositoryState.isDirectory()) {
      throw migrationError(`Mapped repository is not a real directory: ${context.repositoryRoot}`, "UNSAFE_CONFIG_PATH");
    }
    context.configuration = await loadRepositoryConfiguration(context.repositoryRoot);
    const rawRepositoryConfig = context.configuration?.config ?? null;
    context.legacyArtifacts = legacyRepositoryArtifacts(rawRepositoryConfig, legacyConfig);
    if (context.configuration?.migratedFrom !== null && context.configuration) {
      configWrites.push(await createConfigWrite(
        context.repositoryRoot,
        context.configuration.config,
        context.configuration.nextConfig,
        "repository-config",
      ));
    }
    const repositoryId = context.configuration?.nextConfig.id ?? null;
    context.repositoryId = repositoryId;
    if (!context.legacyArtifacts) continue;

    const activeRelative = assertLegacyRelativePath(
      context.legacyArtifacts.activeChanges,
      `Legacy active Change root for ${context.repositoryRoot}`,
    );
    const closedRelative = assertLegacyRelativePath(
      context.legacyArtifacts.closedChanges,
      `Legacy closed Change root for ${context.repositoryRoot}`,
    );
    const activeRoot = join(context.repositoryRoot, activeRelative);
    const closedRoot = join(context.repositoryRoot, closedRelative);
    const closedNested = dirname(closedRoot) === activeRoot;
    const ownerSpaces = [...new Set(context.owners.map((owner) => owner.spaceId))];
    const provisionalSpace = ownerSpaces.length === 1 ? ownerSpaces[0] : null;

    const activeScan = repositoryId && provisionalSpace
      ? await scanRepositoryChangeRoot(
          activeRoot,
          context.repositoryRoot,
          provisionalSpace,
          repositoryId,
          false,
          closedNested ? closedRoot : null,
        )
      : await scanRepositoryChangeRootWithoutIdentity(activeRoot, context.repositoryRoot, closedNested ? closedRoot : null);
    const closedScan = repositoryId && provisionalSpace
      ? await scanRepositoryChangeRoot(closedRoot, context.repositoryRoot, provisionalSpace, repositoryId, true)
      : await scanRepositoryChangeRootWithoutIdentity(closedRoot, context.repositoryRoot);
    const discoveredCount = activeScan.candidates.length + closedScan.candidates.length;
    if (discoveredCount > 0 && !repositoryId) {
      throw migrationError(
        `Legacy repository Changes have no portable repository identity: ${context.repositoryRoot}`,
        "MIGRATION_IDENTITY_REQUIRED",
      );
    }
    if (discoveredCount > 0 && !provisionalSpace) {
      throw migrationError(
        `Legacy repository Changes are claimed by multiple Spaces: ${context.repositoryRoot}`,
        "CROSS_SPACE_CHANGE_COLLISION",
        ownerSpaces,
      );
    }
    context.candidates.push(...activeScan.candidates, ...closedScan.candidates);
    context.sourceRoots.push(activeScan.sourceRoot);
    if (!closedNested) context.sourceRoots.push(closedScan.sourceRoot);
  }

  const repositoryIds = new Map();
  for (const context of repositoryContexts.values()) {
    if (!context.repositoryId) continue;
    const entries = repositoryIds.get(context.repositoryId) ?? [];
    entries.push(context);
    repositoryIds.set(context.repositoryId, entries);
  }
  const ambiguousRepositoryIds = new Set(
    [...repositoryIds.entries()].filter(([, contexts]) => contexts.length > 1).map(([repositoryId]) => repositoryId),
  );
  for (const context of repositoryContexts.values()) {
    candidates.push(...context.candidates);
    for (const root of context.sourceRoots) addSourceRoot(sourceRoots, root);
  }

  if (isSupportedLegacyConfig(legacyConfig)) {
    const plannedDirectory = assertLegacyRelativePath(
      legacyConfig.planning?.plannedChangesDirectory,
      "planning.plannedChangesDirectory",
    );
    const planningContexts = [];
    for (const [spaceId, space] of Object.entries(config.ideas ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
      const planningConfiguredPath = resolveIdeaPlanningPath(config, spaceId, space);
      const planningRoot = resolveWorkspacePath(workspaceRoot, planningConfiguredPath);
      const planningState = await pathState(planningRoot);
      if (!planningState) {
        unavailableSources.push(planningRoot);
      } else if (planningState.isSymbolicLink() || !planningState.isDirectory()) {
        throw migrationError(`Legacy planning owner is not a real directory: ${planningRoot}`, "UNSAFE_CONFIG_PATH");
      }
      planningContexts.push({ spaceId, space, planningRoot });
    }
    if (unavailableSources.length > 0) {
      throw migrationError(
        "Legacy Change source owners are unavailable; migration cannot safely remove their locators.",
        "MIGRATION_SOURCE_UNAVAILABLE",
        unavailableSources,
      );
    }
    for (const { spaceId, space, planningRoot } of planningContexts) {
      const plannedRoot = join(planningRoot, plannedDirectory);
      const mappedContexts = [...repositoryContexts.values()].filter((context) =>
        context.owners.some((owner) => owner.spaceId === spaceId && owner.status === "active"),
      );
      const scan = await scanPlannedRoot(plannedRoot, planningRoot, spaceId, mappedContexts);
      candidates.push(...scan.candidates);
      briefs.push(...scan.briefs);
      addSourceRoot(sourceRoots, scan.sourceRoot);
    }
  }
  for (const repositoryId of [...ambiguousRepositoryIds].sort((left, right) => left.localeCompare(right))) {
    if (!candidates.some((candidate) => candidate.repositoryIds.includes(repositoryId))) continue;
    throw migrationError(
      `Portable repository ID is ambiguous during Change migration: ${repositoryId}`,
      "MIGRATION_IDENTITY_REQUIRED",
      repositoryIds.get(repositoryId).map((entry) => entry.repositoryRoot),
    );
  }

  assertNonOverlappingSourceRoots(sourceRoots);

  const existingById = new Map();
  for (const record of await listStoredChanges(userRoot)) {
    const records = existingById.get(record.changeId) ?? [];
    records.push(record);
    existingById.set(record.changeId, records);
  }

  const groups = new Map();
  for (const candidate of candidates) {
    const group = groups.get(candidate.changeId) ?? [];
    group.push(candidate);
    groups.set(candidate.changeId, group);
  }

  const changes = [];
  for (const [changeId, group] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const spaces = [...new Set(group.map((candidate) => candidate.spaceId))];
    if (spaces.length !== 1) {
      throw migrationError(
        `Legacy Change ID is reused across Spaces: ${changeId}`,
        "CROSS_SPACE_CHANGE_COLLISION",
        spaces,
      );
    }
    const locations = [...new Set(group.map((candidate) => candidate.closed))];
    if (locations.length !== 1) {
      throw migrationError(
        `Legacy Change exists in both active and closed locations: ${changeId}`,
        "CHANGE_LOCATION_COLLISION",
        group.map((candidate) => candidate.path),
      );
    }
    const hashes = [...new Set(group.map((candidate) => candidate.hash))];
    if (hashes.length !== 1) {
      throw migrationError(
        `Legacy Change copies diverge: ${changeId}`,
        "DIVERGENT_CHANGE_COPIES",
        group.map((candidate) => `${candidate.hash} ${candidate.path}`),
      );
    }
    const repositories = [...new Set(group.flatMap((candidate) => candidate.repositoryIds))]
      .sort((left, right) => left.localeCompare(right));
    const representative = group[0];
    for (const candidate of group) {
      const metadata = parseChangeMetadata(candidate.tasksSource);
      if (!metadata.error) {
        const existingRepositories = [...metadata.repositories].sort((left, right) => left.localeCompare(right));
        if (metadata.space !== spaces[0]
          || JSON.stringify(existingRepositories) !== JSON.stringify(repositories)) {
          throw migrationError(
            `Legacy Change ownership metadata conflicts with resolved topology: ${candidate.path}`,
            "INVALID_CHANGE_METADATA",
          );
        }
      } else if (metadata.space !== null || metadata.repositories !== null) {
        throw migrationError(
          `Legacy Change contains incomplete or malformed ownership metadata: ${candidate.path}`,
          "INVALID_CHANGE_METADATA",
          [metadata.error],
        );
      }
    }
    const canonicalTasksSource = setChangeMetadata(representative.tasksSource, {
      space: spaces[0],
      repositories,
    });
    if (canonicalTasksSource === null) {
      throw migrationError(
        `Legacy Change cannot receive canonical ownership metadata: ${representative.path}`,
        "INVALID_CHANGE_METADATA",
      );
    }
    const canonicalHash = await canonicalDirectoryHash(representative.path, canonicalTasksSource);
    const closed = locations[0];
    const destination = closed
      ? getClosedChangePath(changeId, userRoot)
      : getActiveChangePath(changeId, userRoot);
    await assertChangeStoreConfinement(destination, userRoot);
    const existing = existingById.get(changeId) ?? [];
    if (existing.length > 1) {
      throw migrationError(
        `Central Change exists in multiple locations: ${changeId}`,
        "CHANGE_LOCATION_COLLISION",
        existing.map((record) => record.path),
      );
    }
    if (existing.length === 1) {
      if (existing[0].closed !== closed || await hashDirectory(existing[0].path) !== canonicalHash) {
        throw migrationError(
          `Central Change destination conflicts with legacy content: ${changeId}`,
          "CHANGE_DESTINATION_CONFLICT",
          [existing[0].path, representative.path],
        );
      }
    }
    changes.push({
      changeId,
      spaceId: spaces[0],
      repositories,
      closed,
      destination,
      representative,
      sources: group.map((candidate) => candidate.path).sort((left, right) => left.localeCompare(right)),
      canonicalTasksSource,
      canonicalHash,
      existing: existing[0] ?? null,
    });
  }

  const briefDestinations = new Set();
  for (const brief of briefs) {
    const key = resolve(brief.destination);
    if (briefDestinations.has(key)) {
      throw migrationError(
        `Multiple legacy Change Briefs target the same destination: ${brief.destination}`,
        "CHANGE_BRIEF_COLLISION",
      );
    }
    briefDestinations.add(key);
  }

  const actions = [
    ...changes.map((change) => ({
      kind: "change",
      action: change.existing ? "consolidate" : "migrate",
      changeId: change.changeId,
      space: change.spaceId,
      repositories: change.repositories,
      closed: change.closed,
      from: change.sources,
      to: normalizePath(change.destination),
    })),
    ...briefs.map((brief) => ({
      kind: "brief",
      action: "move",
      space: brief.spaceId,
      from: normalizePath(brief.sourcePath),
      to: normalizePath(brief.destination),
    })),
    ...configWrites.map((write) => ({
      kind: write.kind,
      action: "upgrade",
      path: normalizePath(write.path),
      from: write.fromSchema,
      to: write.toSchema,
    })),
    ...[...sourceRoots.values()].map((root) => ({
      kind: "legacy-root",
      action: "remove",
      path: normalizePath(root.path),
    })),
  ].sort(publicActionSort);

  return {
    workspaceRoot,
    userRoot,
    rawConfig,
    config,
    changes,
    briefs: briefs.sort((left, right) => left.destination.localeCompare(right.destination)),
    configWrites: configWrites.sort((left, right) => left.path.localeCompare(right.path)),
    readGuards: readGuards.sort((left, right) => left.path.localeCompare(right.path)),
    sourceRoots: [...sourceRoots.values()].sort((left, right) => left.path.localeCompare(right.path)),
    existingDestinations: changes.filter((change) => change.existing),
    result: {
      required: actions.length > 0,
      actions,
      warnings: warnings.sort((left, right) => left.localeCompare(right)),
    },
  };
}

async function scanRepositoryChangeRootWithoutIdentity(root, repositoryRoot, skipPath = null) {
  if (!(await assertDirectoryRoot(repositoryRoot, root, "Legacy repository Change root"))) {
    return { candidates: [], sourceRoot: null };
  }
  const candidates = [];
  for (const entry of await readRootEntries(root)) {
    const sourcePath = join(root, entry.name);
    if (skipPath && resolve(sourcePath) === resolve(skipPath)) continue;
    if (entry.isSymbolicLink()) {
      throw migrationError(`Legacy repository Change entry is a symbolic link: ${sourcePath}`, "UNSAFE_ARTIFACT_PATH");
    }
    if (!entry.isDirectory() || !isValidChangeId(entry.name)) {
      throw migrationError(
        `Unsupported entry in legacy repository Change root: ${sourcePath}`,
        "UNSUPPORTED_LEGACY_CHANGE_ENTRY",
      );
    }
    candidates.push({ path: sourcePath });
  }
  return {
    candidates,
    sourceRoot: await captureSourceRoot(root, repositoryRoot),
  };
}

async function verifyMigrationPlan(plan) {
  for (const guard of plan.readGuards ?? []) {
    if (await hashFile(guard.path).catch(() => null) !== guard.hash) {
      throw migrationError(`Migration input changed after preflight: ${guard.path}`, "CONCURRENT_CHANGE");
    }
  }
  for (const write of plan.configWrites) {
    if (await hashFile(write.path).catch(() => null) !== write.originalHash) {
      throw migrationError(`Configuration changed after migration preflight: ${write.path}`, "CONCURRENT_CHANGE");
    }
  }
  for (const root of plan.sourceRoots) {
    await assertSourceRootAnchor(root);
  }
  assertNonOverlappingSourceRoots(new Map(
    plan.sourceRoots.map((root) => [root.physicalPath, root]),
  ));
  for (const change of plan.changes) {
    if (change.existing) {
      if (await hashDirectory(change.destination) !== change.canonicalHash) {
        throw migrationError(`Central Change changed after migration preflight: ${change.destination}`, "CONCURRENT_CHANGE");
      }
    } else if (await pathExists(change.destination)) {
      throw migrationError(`Central Change appeared after migration preflight: ${change.destination}`, "CONCURRENT_CHANGE");
    }
  }
  for (const brief of plan.briefs) {
    if (await pathExists(brief.destination)) {
      throw migrationError(`Change Brief destination appeared after migration preflight: ${brief.destination}`, "CONCURRENT_CHANGE");
    }
  }
}

async function verifyMigrationDestinations(plan) {
  for (const change of plan.changes) {
    await assertChangeStoreConfinement(change.destination, plan.userRoot);
    const state = await pathState(change.destination);
    if (!state?.isDirectory() || state.isSymbolicLink()
      || await hashDirectory(change.destination) !== change.canonicalHash) {
      throw migrationError(
        `Central Change destination changed before legacy source removal: ${change.destination}`,
        "CONCURRENT_CHANGE",
      );
    }
  }
  for (const brief of plan.briefs) {
    if (!(await isPathPhysicallyInside(brief.ownerRoot, brief.destination))) {
      throw migrationError(`Change Brief destination escapes its owner: ${brief.destination}`, "UNSAFE_ARTIFACT_PATH");
    }
    const state = await pathState(brief.destination);
    if (!state?.isFile() || state.isSymbolicLink()
      || await hashFile(brief.destination) !== brief.hash) {
      throw migrationError(
        `Change Brief destination changed before legacy source removal: ${brief.destination}`,
        "CONCURRENT_CHANGE",
      );
    }
  }
}

const MIGRATION_JOURNAL_VERSION = 1;
const MIGRATION_JOURNAL_NAME = "transaction.json";
const MIGRATION_STAGING_PREFIX = ".sdd-update-";

async function publishDirectoryWithoutReplace(
  source,
  target,
  record,
  beforeEntryPublish = null,
  afterReservation = null,
) {
  await mkdir(dirname(target), { recursive: true });
  await mkdir(target);
  const marker = join(target, `.sdd-migration-owner-${record.ownerToken}`);
  const handle = await open(marker, "wx", 0o600);
  try {
    await handle.writeFile(record.ownerToken);
    await handle.sync();
  } finally {
    await handle.close();
  }
  record.reserved = true;
  if (afterReservation) await afterReservation(record);
  const entries = await readdir(source);
  let index = 0;
  for (const entry of entries.sort((left, right) => left.localeCompare(right))) {
    if (beforeEntryPublish) await beforeEntryPublish({ source, target, entry, index });
    await rename(join(source, entry), join(target, entry));
    index += 1;
  }
  await rm(source, { recursive: true, force: true });
  await rm(marker);
  record.published = true;
}

async function publishFileWithoutReplace(path, source, stagedPath, record, beforeLink = null) {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(stagedPath, "wx", 0o600);
  try {
    await handle.writeFile(source);
    await handle.sync();
  } finally {
    await handle.close();
  }
  record.phase = "prepared";
  if (beforeLink) await beforeLink({ path, stagedPath });
  await link(stagedPath, path);
  record.published = true;
  record.phase = "published";
}

function serializeTransaction(state) {
  return {
    version: MIGRATION_JOURNAL_VERSION,
    status: state.status,
    workspaceAnchor: state.workspaceAnchor,
    userRoot: resolve(state.userRoot),
    stagingRoot: state.stagingRoot,
    readGuards: state.readGuards,
    changes: state.publishedChanges.map((record) => ({
      destination: record.destination,
      canonicalHash: record.canonicalHash,
      stagedPath: record.stagedPath,
      ownerToken: record.ownerToken,
      reserved: record.reserved,
      published: record.published,
      phase: record.phase,
    })),
    briefs: state.publishedBriefs.map((record) => ({
      destination: record.destination,
      ownerRoot: record.ownerRoot,
      stagedPath: record.stagedPath,
      hash: record.hash,
      published: record.published,
      phase: record.phase,
    })),
    configs: state.writtenConfigs.map((record) => ({
      path: record.path,
      ownerRoot: record.ownerRoot,
      ownerAnchor: record.ownerAnchor,
      originalHash: record.originalHash,
      nextHash: record.nextHash,
      originalPath: record.originalPath,
      nextPath: record.nextPath,
      replacementTemporary: record.replacementTemporary,
      replacementBackup: record.replacementBackup,
      phase: record.phase,
    })),
    sources: state.removedSources.map((record) => ({
      path: record.path,
      hash: record.hash,
      ownerRoot: record.ownerRoot,
      physicalPath: record.physicalPath,
      identity: record.identity,
      ownerPhysicalPath: record.ownerPhysicalPath,
      ownerIdentity: record.ownerIdentity,
      backup: record.backup,
      phase: record.phase,
    })),
  };
}

async function persistTransaction(state) {
  if (!state.durable || state.finished) return;
  await writeJson(state.journalPath, serializeTransaction(state));
}

async function createTransactionState(plan, stagingRoot) {
  const workspaceAnchor = await captureDirectoryAnchor(
    plan.workspaceRoot,
    "Migration workspace",
    "CONCURRENT_CHANGE",
  );
  const publishedChanges = plan.changes
    .filter((change) => !change.existing)
    .map((change) => ({
      ...change,
      stagedPath: join(stagingRoot, change.changeId),
      ownerToken: randomUUID(),
      reserved: false,
      published: false,
      phase: "pending",
    }));
  const publishedBriefs = plan.briefs.map((brief, index) => ({
    ...brief,
    stagedPath: join(stagingRoot, `.brief-${index}`),
    published: false,
    phase: "pending",
  }));
  const writtenConfigs = [];
  for (const [index, write] of plan.configWrites.entries()) {
    const ownerAnchor = await captureDirectoryAnchor(
      write.ownerRoot,
      "Configuration owner",
      "UNSAFE_CONFIG_PATH",
    );
    if (!(await isPathPhysicallyInside(ownerAnchor.physicalPath, write.path))) {
      throw migrationError(`Configuration path escapes its owner: ${write.path}`, "UNSAFE_CONFIG_PATH");
    }
    writtenConfigs.push({
      ...write,
      index,
      ownerAnchor,
      originalPath: join(stagingRoot, `.config-${index}-original`),
      nextPath: join(stagingRoot, `.config-${index}-next`),
      phase: "pending",
      replacementTemporary: null,
      replacementBackup: null,
    });
  }
  const removedSources = plan.sourceRoots.map((root) => {
    const backup = join(
      dirname(root.physicalPath),
      `.${basename(root.physicalPath)}.sdd-migration-${randomUUID()}`,
    );
    if (!isStrictlyInside(root.ownerPhysicalPath, backup)) {
      throw migrationError(`Migration backup escapes its source owner: ${backup}`, "UNSAFE_ARTIFACT_PATH");
    }
    return { ...root, backup, phase: "pending" };
  });
  const durable = plan.result.required;
  return {
    plan,
    userRoot: plan.userRoot,
    workspaceAnchor,
    readGuards: plan.readGuards ?? [],
    stagingRoot,
    journalPath: join(stagingRoot, MIGRATION_JOURNAL_NAME),
    publishedChanges,
    publishedBriefs,
    writtenConfigs,
    removedSources,
    status: "applying",
    durable,
    finished: !durable,
  };
}

async function initializeTransaction(state) {
  if (!state.durable) return;
  await mkdir(state.stagingRoot, { recursive: true });
  await persistTransaction(state);
  for (const write of state.writtenConfigs) {
    await writeFileAtomically(write.originalPath, write.originalSource);
    await writeFileAtomically(write.nextPath, write.nextSource);
    if (await hashFile(write.originalPath) !== write.originalHash
      || await hashFile(write.nextPath) !== write.nextHash) {
      throw migrationError(`Staged configuration hash mismatch: ${write.path}`, "MIGRATION_STAGING_FAILED");
    }
    write.phase = "prepared";
    await persistTransaction(state);
  }
}

function journalFailure(journalPath, detail) {
  return migrationError(
    `Update migration recovery journal is invalid: ${journalPath}`,
    "MUTATION_RECOVERY_FAILED",
    [detail, "Inspect the journal and migration staging directory before removing either manually."],
  );
}

function requireJournalString(value, label, journalPath) {
  if (typeof value !== "string" || value.length === 0 || !isAbsolute(value)) {
    throw journalFailure(journalPath, `${label} must be an absolute path.`);
  }
}

function requireJournalAnchor(anchor, label, journalPath) {
  if (!anchor || typeof anchor !== "object") {
    throw journalFailure(journalPath, `${label} is missing.`);
  }
  requireJournalString(anchor.logicalPath, `${label}.logicalPath`, journalPath);
  requireJournalString(anchor.physicalPath, `${label}.physicalPath`, journalPath);
  if (typeof anchor.dev !== "string" || typeof anchor.ino !== "string") {
    throw journalFailure(journalPath, `${label} has an invalid filesystem identity.`);
  }
}

function requireJournalRecords(
  records,
  label,
  requiredStrings,
  requiredPaths,
  journalPath,
) {
  if (!Array.isArray(records)) throw journalFailure(journalPath, `${label} must be an array.`);
  for (const [index, record] of records.entries()) {
    if (!record || typeof record !== "object") {
      throw journalFailure(journalPath, `${label}[${index}] must be an object.`);
    }
    for (const property of requiredStrings) {
      if (typeof record[property] !== "string" || record[property].length === 0) {
        throw journalFailure(journalPath, `${label}[${index}].${property} is invalid.`);
      }
    }
    for (const property of requiredPaths) {
      requireJournalString(record[property], `${label}[${index}].${property}`, journalPath);
    }
  }
}

function requireJournalPhase(record, phases, label, journalPath) {
  if (!phases.includes(record.phase)) {
    throw journalFailure(journalPath, `${label}.phase is invalid.`);
  }
}

function requireJournalBoolean(value, label, journalPath) {
  if (typeof value !== "boolean") {
    throw journalFailure(journalPath, `${label} must be a boolean.`);
  }
}

function requireExactJournalPath(actual, expected, label, journalPath) {
  if (resolve(actual) !== resolve(expected)) {
    throw journalFailure(journalPath, `${label} does not match its deterministic transaction path.`);
  }
}

async function resolveRecoveryAuthority(journal, stagingRoot, journalPath, userRoot) {
  const userConfigPath = getConfigPath(userRoot);
  const userConfigRecord = journal.configs.find(
    (record) => resolve(record.path) === resolve(userConfigPath),
  );
  const candidates = [
    userConfigPath,
    userConfigRecord?.originalPath,
    userConfigRecord?.nextPath,
  ].filter(Boolean);
  let config = null;
  for (const candidate of candidates) {
    const state = await pathState(candidate);
    if (!state || !state.isFile() || state.isSymbolicLink()) continue;
    if (resolve(candidate) !== resolve(userConfigPath)
      && !(await isPathPhysicallyInside(stagingRoot, candidate))) {
      continue;
    }
    try {
      const rawConfig = parseYaml(await readFile(candidate, "utf8"), candidate);
      if (!isSupportedLegacyConfig(rawConfig)) continue;
      const migrated = migrateConfig(rawConfig, userRoot).config;
      assertValidConfig(migrated, "recover an interrupted migration");
      config = migrated;
      break;
    } catch {
      // A later candidate may be the intact pre- or post-migration user configuration.
    }
  }
  if (!config) {
    throw journalFailure(journalPath, "Cannot establish user topology authority for recovery.");
  }
  const planningOwners = new Set();
  const repositoryOwners = new Set();
  for (const [spaceId, space] of Object.entries(config.ideas)) {
    const planningOwner = resolveWorkspacePath(
      userRoot,
      resolveIdeaPlanningPath(config, spaceId, space),
    );
    planningOwners.add(resolve(planningOwner));
    planningOwners.add(resolve(await resolvePhysicalPath(planningOwner)));
    for (const repository of space.repositories) {
      const repositoryOwner = resolveWorkspacePath(
        userRoot,
        resolveRepositoryPath(config, repository),
      );
      repositoryOwners.add(resolve(repositoryOwner));
      repositoryOwners.add(resolve(await resolvePhysicalPath(repositoryOwner)));
    }
  }
  return { planningOwners, repositoryOwners };
}

async function requireAuthorizedOwner(ownerRoot, allowedOwners, label, journalPath) {
  const physicalOwner = resolve(await resolvePhysicalPath(ownerRoot));
  if (!allowedOwners.has(resolve(ownerRoot)) && !allowedOwners.has(physicalOwner)) {
    throw journalFailure(journalPath, `${label} is not owned by the configured user topology.`);
  }
}

async function hydrateTransaction(journal, stagingRoot, journalPath, userRoot) {
  if (!journal || journal.version !== MIGRATION_JOURNAL_VERSION
    || !["applying", "rolling-back", "committed"].includes(journal.status)) {
    throw journalFailure(journalPath, "Unsupported journal version or status.");
  }
  requireJournalAnchor(journal.workspaceAnchor, "workspaceAnchor", journalPath);
  requireJournalString(journal.userRoot, "userRoot", journalPath);
  requireJournalString(journal.stagingRoot, "stagingRoot", journalPath);
  if (resolve(journal.userRoot) !== resolve(userRoot)
    || resolve(journal.stagingRoot) !== resolve(stagingRoot)) {
    throw journalFailure(journalPath, "Journal roots do not match their containing user store.");
  }
  requireJournalRecords(
    journal.changes,
    "changes",
    ["canonicalHash", "ownerToken"],
    ["destination", "stagedPath"],
    journalPath,
  );
  requireJournalRecords(
    journal.briefs,
    "briefs",
    ["hash"],
    ["destination", "ownerRoot", "stagedPath"],
    journalPath,
  );
  requireJournalRecords(
    journal.configs,
    "configs",
    ["originalHash", "nextHash"],
    ["path", "ownerRoot", "originalPath", "nextPath"],
    journalPath,
  );
  requireJournalRecords(
    journal.sources,
    "sources",
    ["hash"],
    ["path", "ownerRoot", "physicalPath", "ownerPhysicalPath", "backup"],
    journalPath,
  );
  for (const [index, record] of journal.changes.entries()) {
    const changeId = basename(record.destination);
    if (!isValidChangeId(changeId)) {
      throw journalFailure(journalPath, `changes[${index}].destination has an invalid Change ID.`);
    }
    const activePath = getActiveChangePath(changeId, userRoot);
    const closedPath = getClosedChangePath(changeId, userRoot);
    if (![resolve(activePath), resolve(closedPath)].includes(resolve(record.destination))) {
      throw journalFailure(journalPath, `changes[${index}].destination is outside canonical Change locations.`);
    }
    requireExactJournalPath(
      record.stagedPath,
      join(stagingRoot, changeId),
      `changes[${index}].stagedPath`,
      journalPath,
    );
    requireJournalBoolean(record.reserved, `changes[${index}].reserved`, journalPath);
    requireJournalBoolean(record.published, `changes[${index}].published`, journalPath);
    requireJournalPhase(
      record,
      ["pending", "staged", "reserved", "published", "verified", "removed"],
      `changes[${index}]`,
      journalPath,
    );
  }
  for (const [index, record] of journal.briefs.entries()) {
    if (!basename(record.destination).endsWith(".md")) {
      throw journalFailure(journalPath, `briefs[${index}].destination is not a Markdown Change Brief.`);
    }
    requireExactJournalPath(
      record.destination,
      join(record.ownerRoot, CHANGE_BRIEFS_DIRECTORY_NAME, basename(record.destination)),
      `briefs[${index}].destination`,
      journalPath,
    );
    requireExactJournalPath(
      record.stagedPath,
      join(stagingRoot, `.brief-${index}`),
      `briefs[${index}].stagedPath`,
      journalPath,
    );
    requireJournalBoolean(record.published, `briefs[${index}].published`, journalPath);
    requireJournalPhase(
      record,
      ["pending", "prepared", "published", "verified", "removed"],
      `briefs[${index}]`,
      journalPath,
    );
  }
  if (!Array.isArray(journal.readGuards)) {
    throw journalFailure(journalPath, "readGuards must be an array.");
  }
  for (const [index, guard] of journal.readGuards.entries()) {
    requireJournalString(guard?.path, `readGuards[${index}].path`, journalPath);
    if (typeof guard?.hash !== "string") {
      throw journalFailure(journalPath, `readGuards[${index}].hash is invalid.`);
    }
  }
  for (const [index, record] of journal.configs.entries()) {
    requireJournalAnchor(record.ownerAnchor, `configs[${index}].ownerAnchor`, journalPath);
    requireExactJournalPath(
      record.path,
      getConfigPath(record.ownerRoot),
      `configs[${index}].path`,
      journalPath,
    );
    requireExactJournalPath(
      record.ownerAnchor.logicalPath,
      record.ownerRoot,
      `configs[${index}].ownerAnchor.logicalPath`,
      journalPath,
    );
    requireExactJournalPath(
      record.originalPath,
      join(stagingRoot, `.config-${index}-original`),
      `configs[${index}].originalPath`,
      journalPath,
    );
    requireExactJournalPath(
      record.nextPath,
      join(stagingRoot, `.config-${index}-next`),
      `configs[${index}].nextPath`,
      journalPath,
    );
    requireJournalPhase(
      record,
      ["pending", "prepared", "replacing", "published", "verified", "unchanged", "restoring", "restored"],
      `configs[${index}]`,
      journalPath,
    );
    const temporary = record.replacementTemporary;
    const backup = record.replacementBackup;
    const replacementPathsAbsent = temporary === null && backup === null;
    if (!replacementPathsAbsent) {
      requireJournalString(temporary, `configs[${index}].replacementTemporary`, journalPath);
      requireJournalString(backup, `configs[${index}].replacementBackup`, journalPath);
      const name = basename(record.path);
      const temporaryPrefix = `.${name}.sdd-new-`;
      const backupPrefix = `.${name}.sdd-old-`;
      const temporaryName = basename(temporary);
      const backupName = basename(backup);
      const temporaryNonce = temporaryName.slice(temporaryPrefix.length);
      const backupNonce = backupName.slice(backupPrefix.length);
      if (resolve(dirname(temporary)) !== resolve(dirname(record.path))
        || resolve(dirname(backup)) !== resolve(dirname(record.path))
        || !temporaryName.startsWith(temporaryPrefix)
        || !backupName.startsWith(backupPrefix)
        || temporaryNonce !== backupNonce
        || !/^\d+-\d+$/.test(temporaryNonce)) {
        throw journalFailure(journalPath, `configs[${index}] has invalid replacement paths.`);
      }
    }
  }
  for (const [index, record] of journal.sources.entries()) {
    if (!record.identity || typeof record.identity.dev !== "string" || typeof record.identity.ino !== "string"
      || !record.ownerIdentity
      || typeof record.ownerIdentity.dev !== "string"
      || typeof record.ownerIdentity.ino !== "string") {
      throw journalFailure(journalPath, `sources[${index}] has an invalid filesystem identity.`);
    }
    requireJournalPhase(
      record,
      ["pending", "removing", "removed", "restored", "cleaned"],
      `sources[${index}]`,
      journalPath,
    );
    if (!isPathInside(record.ownerRoot, record.path)
      || !isPathInside(record.ownerPhysicalPath, record.physicalPath)
      || resolve(dirname(record.backup)) !== resolve(dirname(record.physicalPath))) {
      throw journalFailure(journalPath, `sources[${index}] escapes its physical owner.`);
    }
    const backupPrefix = `.${basename(record.physicalPath)}.sdd-migration-`;
    const backupName = basename(record.backup);
    if (!backupName.startsWith(backupPrefix)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(backupName.slice(backupPrefix.length))) {
      throw journalFailure(journalPath, `sources[${index}].backup is not a migration-generated sibling.`);
    }
  }
  if (
    journal.status === "committed"
    && (
      journal.changes.some((record) => record.phase !== "verified")
      || journal.briefs.some((record) => record.phase !== "verified")
      || journal.configs.some((record) => record.phase !== "verified")
      || journal.sources.some((record) => !["removed", "cleaned"].includes(record.phase))
    )
  ) {
    throw journalFailure(journalPath, "Committed journal status contradicts incomplete record phases.");
  }
  const recoveryPaths = [
    ...journal.changes.map((record) => record.stagedPath),
    ...journal.briefs.map((record) => record.stagedPath),
    ...journal.configs.flatMap((record) => [record.originalPath, record.nextPath]),
  ];
  const authority = await resolveRecoveryAuthority(journal, stagingRoot, journalPath, userRoot);
  for (const [index, record] of journal.briefs.entries()) {
    await requireAuthorizedOwner(
      record.ownerRoot,
      authority.planningOwners,
      `briefs[${index}].ownerRoot`,
      journalPath,
    );
  }
  const physicalUserRoot = resolve(await resolvePhysicalPath(userRoot));
  for (const [index, record] of journal.configs.entries()) {
    const owner = resolve(record.ownerRoot);
    const physicalOwner = resolve(await resolvePhysicalPath(record.ownerRoot));
    if (owner !== resolve(userRoot)
      && physicalOwner !== physicalUserRoot
      && !authority.repositoryOwners.has(owner)
      && !authority.repositoryOwners.has(physicalOwner)) {
      throw journalFailure(
        journalPath,
        `configs[${index}].ownerRoot is not owned by the configured user topology.`,
      );
    }
  }
  const sourceOwners = new Set([...authority.planningOwners, ...authority.repositoryOwners]);
  for (const [index, record] of journal.sources.entries()) {
    await requireAuthorizedOwner(
      record.ownerRoot,
      sourceOwners,
      `sources[${index}].ownerRoot`,
      journalPath,
    );
  }
  if (recoveryPaths.some((path) => !isPathInside(stagingRoot, path))) {
    throw journalFailure(journalPath, "A staged recovery path escapes its transaction directory.");
  }
  return {
    plan: null,
    userRoot: resolve(userRoot),
    workspaceAnchor: journal.workspaceAnchor,
    readGuards: journal.readGuards,
    stagingRoot: resolve(stagingRoot),
    journalPath,
    publishedChanges: journal.changes,
    publishedBriefs: journal.briefs,
    writtenConfigs: journal.configs,
    removedSources: journal.sources,
    status: journal.status,
    durable: true,
    finished: false,
  };
}

async function listTransactionStates(userRoot) {
  const changesRoot = getChangesRoot(userRoot);
  await assertChangeStoreConfinement(changesRoot, userRoot);
  const rootState = await pathState(changesRoot);
  if (!rootState) return [];
  if (!rootState.isDirectory() || rootState.isSymbolicLink()) {
    throw migrationError(`Change store is not a real directory: ${changesRoot}`, "UNSAFE_ARTIFACT_PATH");
  }
  const states = [];
  for (const entry of await readdir(changesRoot, { withFileTypes: true })) {
    if (!entry.name.startsWith(MIGRATION_STAGING_PREFIX)) continue;
    const stagingRoot = join(changesRoot, entry.name);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw journalFailure(stagingRoot, "Migration staging entry is not a real directory.");
    }
    await assertChangeStoreConfinement(stagingRoot, userRoot);
    const journalPath = join(stagingRoot, MIGRATION_JOURNAL_NAME);
    const journalState = await pathState(journalPath);
    if (!journalState || !journalState.isFile() || journalState.isSymbolicLink()
      || !(await isPathPhysicallyInside(stagingRoot, journalPath))) {
      throw journalFailure(journalPath, "Migration journal is not a confined regular file.");
    }
    let journal;
    try {
      journal = JSON.parse(await readFile(journalPath, "utf8"));
    } catch (error) {
      throw journalFailure(journalPath, `Cannot read the journal: ${error.message}`);
    }
    states.push(await hydrateTransaction(journal, stagingRoot, journalPath, userRoot));
  }
  return states.sort((left, right) => left.stagingRoot.localeCompare(right.stagingRoot));
}

function matchingWorkspaceAnchor(left, right) {
  return left.physicalPath === right.physicalPath && sameFileIdentity(left, right);
}

async function inspectSourceBackup(record) {
  await assertStoredDirectoryAnchor(
    record.ownerRoot,
    sourceOwnerAnchor(record),
    "Legacy source owner",
  );
  const backupState = await pathState(record.backup);
  if (!backupState) return null;
  if (!backupState.isDirectory() || backupState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(backupState), record.identity)) {
    throw migrationError(`Migration backup changed physical identity: ${record.backup}`, "CONCURRENT_CHANGE");
  }
  const backupPhysicalPath = await resolvePhysicalPath(record.backup);
  if (backupPhysicalPath !== resolve(record.backup)
    || !isStrictlyInside(record.ownerPhysicalPath, backupPhysicalPath)
    || await hashDirectory(backupPhysicalPath) !== record.hash) {
    throw migrationError(`Migration backup changed before recovery: ${record.backup}`, "CONCURRENT_CHANGE");
  }
  return backupState;
}

async function rollbackRemovedSource(record) {
  if (record.phase === "pending") return;
  const sourceState = await pathState(record.physicalPath);
  const backupState = await inspectSourceBackup(record);
  if (sourceState) {
    const sourceMatches = sourceState.isDirectory()
      && !sourceState.isSymbolicLink()
      && sameFileIdentity(fileIdentity(sourceState), record.identity);
    if (sourceMatches && !backupState) return;
    throw migrationError(
      `Newer legacy source preserved; backup retained at ${record.backup}.`,
      "CONCURRENT_CHANGE",
    );
  }
  if (!backupState) {
    throw migrationError(`Legacy source and migration backup are both missing: ${record.path}`, "CONCURRENT_CHANGE");
  }
  await rename(record.backup, record.physicalPath);
  await assertSourceRootAnchor(record);
  record.phase = "restored";
}

async function inspectConfigReplacementFile(write, path, expectedHash, label) {
  if (path === null) return null;
  if (resolve(dirname(path)) !== resolve(dirname(write.path))
    || !(await isPathPhysicallyInside(write.ownerAnchor.physicalPath, path))) {
    throw migrationError(`${label} escapes its configuration owner: ${path}`, "UNSAFE_CONFIG_PATH");
  }
  const state = await pathState(path);
  if (!state) return null;
  if (!state.isFile() || state.isSymbolicLink()
    || await hashFile(path).catch(() => null) !== expectedHash) {
    throw migrationError(`${label} changed before recovery: ${path}`, "CONCURRENT_CHANGE");
  }
  return state;
}

async function removeConfigReplacementFiles(write, temporaryState, backupState) {
  if (temporaryState) await rm(write.replacementTemporary, { force: true });
  if (backupState) await rm(write.replacementBackup, { force: true });
}

async function rollbackConfigWrite(
  write,
  { persist = null, afterBackup = null } = {},
) {
  await assertStoredDirectoryAnchor(write.ownerRoot, write.ownerAnchor, "Configuration owner");
  if (!(await isPathPhysicallyInside(write.ownerAnchor.physicalPath, write.path))) {
    throw migrationError(`Configuration path escapes its owner: ${write.path}`, "UNSAFE_CONFIG_PATH");
  }
  const restoring = write.phase === "restoring";
  const temporaryState = await inspectConfigReplacementFile(
    write,
    write.replacementTemporary,
    restoring ? write.originalHash : write.nextHash,
    "Configuration replacement temporary",
  );
  const backupState = await inspectConfigReplacementFile(
    write,
    write.replacementBackup,
    restoring ? write.nextHash : write.originalHash,
    "Configuration replacement backup",
  );
  const currentHash = await hashFile(write.path).catch(() => null);
  if (currentHash === write.originalHash) {
    await removeConfigReplacementFiles(write, temporaryState, backupState);
    write.phase = "restored";
    return;
  }
  if (currentHash === null) {
    const recoveryPath = restoring && temporaryState
      ? write.replacementTemporary
      : backupState && !restoring
        ? write.replacementBackup
        : null;
    if (!recoveryPath) {
      throw migrationError(`Configuration recovery source is unavailable: ${write.path}.`, "CONCURRENT_CHANGE");
    }
    await rename(recoveryPath, write.path);
    if (await hashFile(write.path).catch(() => null) !== write.originalHash) {
      throw migrationError(`Configuration rollback verification failed: ${write.path}`, "CONCURRENT_CHANGE");
    }
    await removeConfigReplacementFiles(write, temporaryState, backupState);
    write.phase = "restored";
    return;
  }
  if (currentHash !== write.nextHash) {
    if (["pending", "prepared", "unchanged"].includes(write.phase)) return;
    throw migrationError(`Newer configuration preserved: ${write.path}.`, "CONCURRENT_CHANGE");
  }
  if (await hashFile(write.originalPath).catch(() => null) !== write.originalHash) {
    throw migrationError(`Configuration recovery source is unavailable: ${write.originalPath}`, "CONCURRENT_CHANGE");
  }
  await removeConfigReplacementFiles(write, temporaryState, backupState);
  await replaceFileAtomically(write.originalPath, write.path, {
    expectedHash: write.nextHash,
    beforeReplace: async (replacement) => {
      write.phase = "restoring";
      write.replacementTemporary = replacement.temporary;
      write.replacementBackup = replacement.backup;
      if (persist) await persist();
    },
    afterBackup,
  });
  if (await hashFile(write.path).catch(() => null) !== write.originalHash) {
    throw migrationError(`Configuration rollback verification failed: ${write.path}`, "CONCURRENT_CHANGE");
  }
  write.phase = "restored";
}

async function rollbackBrief(brief) {
  const destinationState = await pathState(brief.destination);
  if (!destinationState) return;
  if (!(await isPathPhysicallyInside(brief.ownerRoot, brief.destination))) {
    throw migrationError(`Change Brief destination escapes its owner: ${brief.destination}`, "UNSAFE_ARTIFACT_PATH");
  }
  const stagedState = await pathState(brief.stagedPath);
  const ownsDestination = destinationState.isFile()
    && !destinationState.isSymbolicLink()
    && stagedState?.isFile()
    && !stagedState.isSymbolicLink()
    && sameFileIdentity(fileIdentity(destinationState), fileIdentity(stagedState))
    && await hashFile(brief.destination).catch(() => null) === brief.hash;
  if (!ownsDestination) {
    throw migrationError(`Newer Change Brief preserved: ${brief.destination}.`, "CONCURRENT_CHANGE");
  }
  await rm(brief.destination, { force: true });
  brief.phase = "removed";
}

async function rollbackChange(change, userRoot) {
  await assertChangeStoreConfinement(change.destination, userRoot);
  const destinationState = await pathState(change.destination);
  if (!destinationState) return;
  if (!destinationState.isDirectory() || destinationState.isSymbolicLink()) {
    throw migrationError(`Newer central Change preserved: ${change.destination}.`, "CONCURRENT_CHANGE");
  }
  const marker = join(change.destination, `.sdd-migration-owner-${change.ownerToken}`);
  const ownsPartial = await readFile(marker, "utf8").catch(() => null) === change.ownerToken;
  const ownsComplete = change.reserved
    && await hashDirectory(change.destination).catch(() => null) === change.canonicalHash;
  const ownsEmptyReservation = change.reserved
    && (await readdir(change.destination).catch(() => ["occupied"])).length === 0;
  if (!ownsPartial && !ownsComplete && !ownsEmptyReservation) {
    throw migrationError(`Newer central Change preserved: ${change.destination}.`, "CONCURRENT_CHANGE");
  }
  await rm(change.destination, { recursive: true, force: true });
  change.phase = "removed";
}

async function rollbackTransaction(state, { afterConfigRestoreBackup = null } = {}) {
  if (!state || state.finished) return;
  if (state.status === "committed") {
    throw migrationError(
      "Committed update migration cleanup cannot be rolled back.",
      "MUTATION_RECOVERY_FAILED",
      [state.journalPath],
    );
  }
  const failures = [];
  state.status = "rolling-back";
  await persistTransaction(state).catch((error) => {
    failures.push(`Persist rollback state ${state.journalPath}: ${error.message}`);
  });
  for (const removed of [...state.removedSources].reverse()) {
    try {
      await rollbackRemovedSource(removed);
      await persistTransaction(state);
    } catch (error) {
      failures.push(`Restore ${removed.path}: ${error.message}`);
    }
  }
  for (const write of [...state.writtenConfigs].reverse()) {
    try {
      await rollbackConfigWrite(write, {
        persist: () => persistTransaction(state),
        afterBackup: afterConfigRestoreBackup
          ? (replacement) => afterConfigRestoreBackup({ write, replacement })
          : null,
      });
      await persistTransaction(state);
    } catch (error) {
      failures.push(`Restore ${write.path}: ${error.message}`);
    }
  }
  for (const brief of [...state.publishedBriefs].reverse()) {
    try {
      await rollbackBrief(brief);
      await persistTransaction(state);
    } catch (error) {
      failures.push(`Remove ${brief.destination}: ${error.message}`);
    }
  }
  for (const change of [...state.publishedChanges].reverse()) {
    try {
      await rollbackChange(change, state.userRoot);
      await persistTransaction(state);
    } catch (error) {
      failures.push(`Remove ${change.destination}: ${error.message}`);
    }
  }
  if (failures.length === 0) {
    await rm(state.stagingRoot, { recursive: true, force: true }).catch((error) => {
      failures.push(`Remove migration staging root ${state.stagingRoot}: ${error.message}`);
    });
  }
  if (failures.length > 0) {
    throw migrationError(
      "Update migration failed and recovery was incomplete.",
      "MUTATION_RECOVERY_FAILED",
      failures,
    );
  }
  state.finished = true;
}

async function finalizeTransaction(state) {
  if (!state || state.finished) return;
  const failures = [];
  for (const write of state.writtenConfigs) {
    if (await hashFile(write.path).catch(() => null) !== write.nextHash) {
      failures.push(`Retain migration backups: Published configuration changed before migration commit: ${write.path}`);
    }
  }
  if (state.status === "committed") {
    for (const change of state.publishedChanges) {
      if (await hashDirectory(change.destination).catch(() => null) !== change.canonicalHash) {
        failures.push(`Retain migration backups: Published central Change is incomplete: ${change.destination}`);
      }
    }
    for (const brief of state.publishedBriefs) {
      if (await hashFile(brief.destination).catch(() => null) !== brief.hash) {
        failures.push(`Retain migration backups: Published Change Brief is incomplete: ${brief.destination}`);
      }
    }
    for (const removed of state.removedSources) {
      const sourceState = await pathState(removed.physicalPath);
      const backupState = await pathState(removed.backup);
      if (sourceState) {
        failures.push(`Retain migration backups: Committed legacy source still exists: ${removed.path}`);
      }
      if (removed.phase === "cleaned" && backupState) {
        failures.push(`Retain migration backups: Cleaned legacy source backup still exists: ${removed.backup}`);
      }
    }
  }
  if (state.status !== "committed") {
    try {
      await verifyMigrationDestinations(state.plan);
      if (failures.length > 0) {
        throw migrationError("Published configuration state is incomplete.", "CONCURRENT_CHANGE");
      }
      for (const removed of state.removedSources) {
        if (removed.phase !== "removed") {
          throw migrationError(`Legacy source was not durably removed: ${removed.path}`, "CONCURRENT_CHANGE");
        }
        await inspectSourceBackup(removed);
      }
      state.status = "committed";
      await persistTransaction(state);
    } catch (error) {
      failures.push(`Retain migration backups: ${error.message}`);
    }
  }
  if (failures.length === 0) {
    for (const removed of state.removedSources) {
      try {
        const backupState = await pathState(removed.backup);
        if (backupState) {
          await inspectSourceBackup(removed);
          await rm(removed.backup, { recursive: true, force: true });
        }
        removed.phase = "cleaned";
        await persistTransaction(state);
      } catch (error) {
        failures.push(`Remove migration backup ${removed.backup}: ${error.message}`);
      }
    }
  }
  if (failures.length === 0) {
    await rm(state.stagingRoot, { recursive: true, force: true }).catch((error) => {
      failures.push(`Remove migration staging root ${state.stagingRoot}: ${error.message}`);
    });
  }
  if (failures.length > 0) {
    throw migrationError(
      "Update migration committed but cleanup was incomplete.",
      "MUTATION_RECOVERY_FAILED",
      failures,
    );
  }
  state.finished = true;
}

export async function recoverUpdateMigration(
  workspaceRoot,
  {
    userRoot = getUserRoot(),
    dryRun = false,
    afterConfigRestoreBackup = null,
  } = {},
) {
  const workspaceAnchor = await captureDirectoryAnchor(
    workspaceRoot,
    "Migration workspace",
    "MIGRATION_RECOVERY_FAILED",
  );
  const states = (await listTransactionStates(userRoot))
    .filter((state) => matchingWorkspaceAnchor(state.workspaceAnchor, workspaceAnchor));
  if (states.length === 0) return { recovered: 0 };
  if (dryRun) {
    throw migrationError(
      "A previous update migration requires recovery before dry-run planning can continue.",
      "MIGRATION_RECOVERY_REQUIRED",
      [
        ...states.map((state) => `Journal: ${state.journalPath}`),
        "Run sdd update without --dry-run to recover the interrupted migration.",
      ],
    );
  }
  for (const state of states) {
    if (state.status === "committed") await finalizeTransaction(state);
    else await rollbackTransaction(state, { afterConfigRestoreBackup });
  }
  return { recovered: states.length };
}

export async function applyUpdateMigration(
  plan,
  {
    beforeCommit = null,
    beforeSourceRemoval = null,
    beforeSourceRename = null,
    beforeChangeEntryPublish = null,
    beforeBriefLink = null,
    beforeConfigWrite = null,
    afterConfigBackup = null,
    afterConfigPublish = null,
    afterConfigWrite = null,
    replaceConfig = replaceFileAtomically,
  } = {},
) {
  if (beforeCommit) await beforeCommit(plan);
  await verifyMigrationPlan(plan);
  const stagingRoot = join(
    getChangesRoot(plan.userRoot),
    `${MIGRATION_STAGING_PREFIX}${process.pid}-${randomUUID()}`,
  );
  await assertChangeStoreConfinement(stagingRoot, plan.userRoot);
  const state = await createTransactionState(plan, stagingRoot);
  try {
    await initializeTransaction(state);
    for (const record of state.publishedChanges) {
      await cp(record.representative.path, record.stagedPath, {
        recursive: true,
        verbatimSymlinks: true,
      });
      await writeFileAtomically(join(record.stagedPath, "tasks.md"), record.canonicalTasksSource);
      if (await hashDirectory(record.stagedPath) !== record.canonicalHash) {
        throw migrationError(`Staged central Change hash mismatch: ${record.changeId}`, "MIGRATION_STAGING_FAILED");
      }
      record.phase = "staged";
      await persistTransaction(state);
      await publishDirectoryWithoutReplace(
        record.stagedPath,
        record.destination,
        record,
        beforeChangeEntryPublish,
        async () => {
          record.phase = "reserved";
          await persistTransaction(state);
        },
      );
      record.phase = "published";
      await persistTransaction(state);
      if (await hashDirectory(record.destination) !== record.canonicalHash) {
        throw migrationError(`Published central Change hash mismatch: ${record.changeId}`, "MIGRATION_STAGING_FAILED");
      }
      record.phase = "verified";
      await persistTransaction(state);
    }
    for (const record of state.publishedBriefs) {
      await publishFileWithoutReplace(
        record.destination,
        record.source,
        record.stagedPath,
        record,
        beforeBriefLink,
      );
      await persistTransaction(state);
      if (await hashFile(record.destination) !== record.hash) {
        throw migrationError(`Published Change Brief hash mismatch: ${record.destination}`, "MIGRATION_STAGING_FAILED");
      }
      record.phase = "verified";
      await persistTransaction(state);
    }
    for (const record of state.writtenConfigs) {
      if (beforeConfigWrite) await beforeConfigWrite({ write: record, index: record.index });
      record.phase = "replacing";
      await persistTransaction(state);
      try {
        await replaceConfig(record.nextPath, record.path, {
          expectedHash: record.originalHash,
          beforeReplace: async (publication) => {
            record.replacementTemporary = publication.temporary;
            record.replacementBackup = publication.backup;
            await persistTransaction(state);
          },
          afterBackup: async (publication) => {
            if (afterConfigBackup) {
              await afterConfigBackup({ write: record, index: record.index, publication });
            }
          },
          afterPublish: async (publication) => {
            record.phase = "published";
            await persistTransaction(state);
            if (afterConfigPublish) {
              await afterConfigPublish({ write: record, index: record.index, publication });
            }
          },
        });
      } catch (error) {
        if (error?.code === "CONCURRENT_CHANGE" && record.phase === "replacing") {
          record.phase = "unchanged";
          await persistTransaction(state);
        }
        throw error;
      }
      if (record.phase === "replacing") {
        record.phase = "published";
        await persistTransaction(state);
      }
      if (afterConfigWrite) await afterConfigWrite({ write: record, index: record.index });
      if (await hashFile(record.path) !== record.nextHash) {
        throw migrationError(`Published configuration hash mismatch: ${record.path}`, "MIGRATION_STAGING_FAILED");
      }
      record.phase = "verified";
      await persistTransaction(state);
    }
    if (beforeSourceRemoval) await beforeSourceRemoval(plan);
    for (const root of plan.sourceRoots) await assertSourceRootAnchor(root);
    assertNonOverlappingSourceRoots(new Map(
      plan.sourceRoots.map((root) => [root.physicalPath, root]),
    ));
    for (const record of state.removedSources) {
      await verifyMigrationDestinations(plan);
      if (beforeSourceRename) await beforeSourceRename({ root: record });
      await assertSourceRootAnchor(record);
      if (await pathState(record.backup)) {
        throw migrationError(`Migration backup path already exists: ${record.backup}`, "CONCURRENT_CHANGE");
      }
      record.phase = "removing";
      await persistTransaction(state);
      await rename(record.physicalPath, record.backup);
      await inspectSourceBackup(record);
      record.phase = "removed";
      await persistTransaction(state);
    }
    await verifyMigrationDestinations(plan);
  } catch (error) {
    try {
      await rollbackTransaction(state);
    } catch (recoveryError) {
      if (recoveryError.code === "MUTATION_RECOVERY_FAILED") {
        recoveryError.details = [`Original error: ${error.message}`, ...(recoveryError.details ?? [])];
      }
      throw recoveryError;
    }
    throw error;
  }

  return {
    rollback: () => rollbackTransaction(state),
    finalize: () => finalizeTransaction(state),
  };
}
