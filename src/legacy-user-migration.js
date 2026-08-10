import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  copyFile,
  cp,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  readdir,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parseDocument } from "yaml";

import {
  assertValidConfig,
  assertValidLegacyUserConfig,
  assertValidRepositoryConfig,
  createWorkspaceConfigFromLegacyHome,
  getLegacyUserConfigPath,
  getRepositoryConfigPath,
  getWorkspaceConfigDirectory,
  getWorkspaceConfigPath,
  getWorkspaceInstallLockPath,
  migrateRepositoryConfig,
  migrateWorkspaceConfig,
  readWorkspaceConfig,
  resolveIdeaPlanningPath,
  resolveLegacyUserPath,
  resolveRepositoryPath,
  resolveWorkspacePath,
  resolveWorkspaceSkillsDirectory,
  writeWorkspaceConfig,
} from "./config.js";
import {
  BUNDLED_SKILLS_DIRECTORY,
  CHANGES_DIRECTORY_NAME,
  CHANGE_BRIEFS_DIRECTORY_NAME,
  CLOSED_CHANGES_DIRECTORY_NAME,
  CONFIG_DIRECTORY_NAME,
  INSTALL_LOCK_FILE_NAME,
  WORKFLOW_RELATIVE_PATH,
  WORKFLOW_SOURCE_PATH,
} from "./constants.js";
import { listStoredChanges } from "./change-store.js";
import { assertValidChangeId, isValidChangeId } from "./change-id.js";
import { parseChangeMetadata, setChangeMetadata } from "./change-status.js";
import { SddError } from "./errors.js";
import {
  directoryHashVersion,
  hashDirectoryVersions,
  hashDirectoryWithFileOverride,
  hashFile,
  isPathInside,
  isPathPhysicallyInside,
  pathExists,
  readJson,
  resolvePhysicalPath,
} from "./fs.js";
import { serializeManagedInstallationLock } from "./installation.js";
import { planSkillSync, readInstallLockSnapshot } from "./skills.js";
import { planWorkflowSync } from "./workflow.js";

const STAGING_PREFIX = ".sdd-from-user-";
const STAGE_RESERVATION_PREFIX = ".sdd-user-migration-reservation-";
const INCOMPLETE_STAGE_PREFIX = ".sdd-user-migration-incomplete-";
const SOURCE_WITNESS_PREFIX = ".sdd-transfer-witness-";
const STAGE_INTENT_NAME = "stage-intent.json";
const STAGE_INTENT_PROOF_NAME = "stage-intent.proof.json";
const STAGE_INTENT_AUTHORITY_PREFIX = ".sdd-user-migration-stage-authority-";
const STAGE_INTENT_VERSION = 1;
const JOURNAL_NAME = "transaction.json";
const JOURNAL_GENERATION_PATTERN = /^transaction\.(\d{12})\.json$/;
const PROVENANCE_NAME = "transaction-provenance.json";
const PROVENANCE_PROOF_NAME = "transaction-provenance.proof.json";
const PROVENANCE_AUTHORITY_PREFIX = ".sdd-user-migration-authority-";
const PROVENANCE_AUTHORITY_VERSION = 1;
const PROVENANCE_VERSION = 3;
const PROVENANCE_EVIDENCE_DIRECTORY = "provenance-evidence";
const RECEIPT_RELATIVE_PATH = ".sdd/migrations/from-user.json";
const WORKSPACE_SKILLS_RELATIVE_PATH = ".agents/skills";
const JOURNAL_VERSION = 4;
const JOURNAL_PHASES = new Set([
  "staged",
  "publishing",
  "destination-verified",
  "retiring-source",
  "committed",
]);
const PUBLICATION_STATES = new Set([
  "pending",
  "backup-intent",
  "backed-up",
  "publish-intent",
  "published",
]);
const PUBLICATION_ROLLBACK_STATES = new Set([
  "pending",
  "remove-intent",
  "removed",
  "restore-intent",
  "restored",
]);
const RETIREMENT_STATES = new Set(["pending", "retire-intent", "retired"]);
const RESERVED_SOURCE_ENTRIES = new Set([
  "config.yaml",
  INSTALL_LOCK_FILE_NAME,
  basename(WORKFLOW_RELATIVE_PATH),
  CHANGES_DIRECTORY_NAME,
  "migrations",
  "mutation.lock",
  "mutation.lock.reclaim",
]);

function fail(message, code, details = []) {
  return new SddError(message, { code, details });
}

function normalizePath(path) {
  return path.split(sep).join("/") || ".";
}

const directorySnapshotHashes = Symbol("directorySnapshotHashes");

function snapshotMatchesDirectoryHash(value, expectedHash) {
  if (value?.kind !== "directory") return false;
  if (value.hash === expectedHash) return true;
  const version = directoryHashVersion(expectedHash);
  return version !== null
    && value[directorySnapshotHashes]?.[version] === expectedHash;
}

function sameSnapshot(left, right) {
  if (left?.kind !== right?.kind) return false;
  if (left?.hash === right?.hash) return true;
  return left?.kind === "directory"
    && (
      snapshotMatchesDirectoryHash(left, right?.hash)
      || snapshotMatchesDirectoryHash(right, left?.hash)
    );
}

async function snapshot(path) {
  let state;
  try {
    state = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (state.isSymbolicLink()) {
    throw fail(`Migration path cannot be a symbolic link: ${path}`, "UNSAFE_MIGRATION_PATH");
  }
  if (state.isDirectory()) {
    const hashes = await hashDirectoryVersions(path);
    const value = { kind: "directory", hash: hashes.strong };
    Object.defineProperty(value, directorySnapshotHashes, { value: hashes });
    return value;
  }
  if (state.isFile()) return { kind: "file", hash: await hashFile(path) };
  throw fail(`Migration path must be a regular file or directory: ${path}`, "UNSAFE_MIGRATION_PATH");
}
function sameAuthorityFileObservation(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function authorityChanged(path, label) {
  return fail(`${label} changed while its authority bytes were being read: ${path}`, "CONCURRENT_CHANGE");
}

async function readBoundAuthorityFile(
  path,
  {
    label,
    allowMissing = false,
    invalidCode = "UNSAFE_MIGRATION_PATH",
    afterRead,
  },
) {
  let handle;
  try {
    handle = await open(
      path,
      fsConstants.O_RDONLY
        | (fsConstants.O_NOFOLLOW ?? 0)
        | (fsConstants.O_NONBLOCK ?? 0),
    );
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") return null;
    if (error?.code === "ELOOP") {
      throw fail(`${label} cannot be a symbolic link: ${path}`, "UNSAFE_MIGRATION_PATH");
    }
    throw error;
  }

  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) {
      throw fail(`${label} is not a regular file: ${path}`, invalidCode);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (!sameAuthorityFileObservation(before, after)) {
      throw authorityChanged(path, label);
    }

    await afterRead?.({ path });
    let current;
    try {
      current = await lstat(path, { bigint: true });
    } catch (error) {
      if (error?.code === "ENOENT") throw authorityChanged(path, label);
      throw error;
    }
    if (
      current.isSymbolicLink()
      || !current.isFile()
      || !sameAuthorityFileObservation(after, current)
    ) {
      throw authorityChanged(path, label);
    }

    return {
      source: bytes.toString("utf8"),
      state: {
        kind: "file",
        hash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      },
    };
  } finally {
    await handle.close();
  }
}

function parseAuthorityYaml(source, path) {
  const document = parseDocument(source);
  if (document.errors.length > 0) {
    throw new SddError(`Cannot parse YAML at ${path}: ${document.errors[0].message}`, {
      code: "INVALID_YAML",
    });
  }
  return document.toJS();
}


async function requireContained(owner, path, label) {
  if (!isPathInside(owner, path) || !(await isPathPhysicallyInside(owner, path))) {
    throw fail(`${label} resolves outside its owner: ${path}`, "UNSAFE_MIGRATION_PATH");
  }
}

async function assertFixedMigrationDestination(workspaceRoot, path, label, kind) {
  const root = resolve(workspaceRoot);
  const target = resolve(path);
  if (!isPathInside(root, target)) {
    throw fail(`${label} resolves outside its workspace: ${target}`, "UNSAFE_MIGRATION_PATH");
  }
  const segments = relative(root, target).split(sep).filter(Boolean);
  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    let state;
    try {
      state = await lstat(current);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      if (!(await isPathPhysicallyInside(root, target))) {
        throw fail(`${label} resolves outside its workspace: ${target}`, "UNSAFE_MIGRATION_PATH");
      }
      return;
    }
    if (state.isSymbolicLink()) {
      throw fail(`${label} uses a symbolic-link alias: ${current}`, "UNSAFE_MIGRATION_PATH");
    }
    const expectedKind = index === segments.length - 1 ? kind : "directory";
    if (
      (expectedKind === "directory" && !state.isDirectory())
      || (expectedKind === "file" && !state.isFile())
    ) {
      throw fail(
        `${label} has an unsafe ${expectedKind} boundary: ${current}`,
        "UNSAFE_MIGRATION_PATH",
      );
    }
  }
  if (!(await isPathPhysicallyInside(root, target))) {
    throw fail(`${label} resolves outside its workspace: ${target}`, "UNSAFE_MIGRATION_PATH");
  }
}

async function assertLegacyMigrationDestinationConfinement(workspaceRoot) {
  const configRoot = getWorkspaceConfigDirectory(workspaceRoot);
  const receiptPath = resolve(workspaceRoot, RECEIPT_RELATIVE_PATH);
  for (const [path, label, kind] of [
    [configRoot, "Workspace configuration root", "directory"],
    [getWorkspaceConfigPath(workspaceRoot), "Workspace configuration destination", "file"],
    [
      join(configRoot, CHANGES_DIRECTORY_NAME),
      "Workspace Change-store destination",
      "directory",
    ],
    [
      resolve(workspaceRoot, WORKFLOW_RELATIVE_PATH),
      "Workspace workflow destination",
      "file",
    ],
    [getWorkspaceInstallLockPath(workspaceRoot), "Workspace install-lock destination", "file"],
    [dirname(receiptPath), "Workspace migration-receipt root", "directory"],
    [receiptPath, "Workspace migration-receipt destination", "file"],
    [
      resolve(workspaceRoot, WORKSPACE_SKILLS_RELATIVE_PATH),
      "Workspace managed-skills destination",
      "directory",
    ],
  ]) {
    await assertFixedMigrationDestination(workspaceRoot, path, label, kind);
  }
}

async function names(path) {
  if (!(await pathExists(path))) return [];
  return (await readdir(path, { withFileTypes: true }))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}
async function assertRegularMigrationTree(root, label, path = root) {
  const state = await lstat(path);
  if (state.isSymbolicLink()) {
    throw fail(`${label} contains a symbolic link: ${path}`, "UNSAFE_MIGRATION_PATH");
  }
  await requireContained(root, path, label);
  if (state.isFile()) return;
  if (!state.isDirectory()) {
    throw fail(
      `${label} contains an unsupported filesystem entry: ${path}`,
      "UNSAFE_MIGRATION_PATH",
    );
  }
  const childNames = await readdir(path);
  childNames.sort((left, right) => left.localeCompare(right));
  for (const name of childNames) {
    await assertRegularMigrationTree(root, label, join(path, name));
  }
}

function pathsOverlap(left, right) {
  return isPathInside(left, right) || isPathInside(right, left);
}

async function migrationPathRecord(record) {
  const physicalPath = await resolvePhysicalPath(record.path);
  let identity = null;
  try {
    const state = await lstat(physicalPath);
    identity = { device: state.dev, inode: state.ino };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return { ...record, physicalPath, identity };
}

function samePathIdentity(left, right) {
  return left !== null
    && right !== null
    && left.device === right.device
    && left.inode === right.inode;
}
function migrationPathsConflict(source, destination) {
  if (
    resolve(source.path) === resolve(destination.path)
    || source.physicalPath === destination.physicalPath
    || samePathIdentity(source.identity, destination.identity)
  ) {
    return true;
  }
  return !source.aliasOnly
    && (
      pathsOverlap(source.path, destination.path)
      || pathsOverlap(source.physicalPath, destination.physicalPath)
    );
}


async function pathsPhysicallyAlias(left, right) {
  const [leftRecord, rightRecord] = await Promise.all([
    migrationPathRecord({ path: left }),
    migrationPathRecord({ path: right }),
  ]);
  return leftRecord.physicalPath === rightRecord.physicalPath
    || samePathIdentity(leftRecord.identity, rightRecord.identity);
}

async function assertNoOverlappingMigrationPaths(retirementPaths, destinationPaths) {
  const sources = await Promise.all(retirementPaths.map(migrationPathRecord));
  const destinations = await Promise.all(destinationPaths.map(migrationPathRecord));
  for (const source of sources) {
    for (const destination of destinations) {
      if (!migrationPathsConflict(source, destination)) continue;
      throw fail(
        `${source.label} overlaps ${destination.label}.`,
        "INVALID_MIGRATION_SOURCE",
        [
          `Retirement source: ${source.path}`,
          `Workspace destination: ${destination.path}`,
        ],
      );
    }
  }
}


async function readChangeMap(root, label) {
  const result = new Map();
  for (const record of await listStoredChanges(root)) {
    try {
      assertValidChangeId(record.changeId);
    } catch (error) {
      throw fail(`${label} contains an invalid Change directory: ${record.path}`, "INVALID_CHANGE_ID", [error.message]);
    }
    if (result.has(record.changeId)) {
      throw fail(`${label} stores ${record.changeId} as both active and closed.`, "CHANGE_LOCATION_COLLISION");
    }
    result.set(record.changeId, { ...record, state: await snapshot(record.path) });
  }
  return result;
}

async function planChanges(legacyUserRoot, workspaceRoot) {
  const source = join(legacyUserRoot, CONFIG_DIRECTORY_NAME, CHANGES_DIRECTORY_NAME);
  const target = join(workspaceRoot, CONFIG_DIRECTORY_NAME, CHANGES_DIRECTORY_NAME);
  const sourceState = await snapshot(source);
  const targetState = await snapshot(target);
  if (sourceState && sourceState.kind !== "directory") {
    throw fail(`Legacy Change store is not a directory: ${source}`, "UNSAFE_MIGRATION_PATH");
  }
  if (targetState && targetState.kind !== "directory") {
    throw fail(`Workspace Change store is not a directory: ${target}`, "MIGRATION_DESTINATION_COLLISION");
  }
  if (sourceState) {
    await assertRegularMigrationTree(source, "Legacy Change store");
  }
  if (targetState) {
    await assertRegularMigrationTree(target, "Workspace Change store");
  }
  const sourceChanges = await readChangeMap(legacyUserRoot, "Legacy user Change store");
  const targetChanges = await readChangeMap(workspaceRoot, "Workspace Change store");
  for (const [changeId, record] of sourceChanges) {
    const existing = targetChanges.get(changeId);
    if (existing && (existing.closed !== record.closed || !sameSnapshot(existing.state, record.state))) {
      throw fail(
        `Workspace Change destination conflicts with legacy Change ${changeId}.`,
        "CHANGE_DESTINATION_CONFLICT",
        [record.path, existing.path],
      );
    }
  }
  return { source, target, sourceState, targetState, sourceChanges, targetChanges };
}

function isReleasedLegacyUserV1(config) {
  return config?.kind === "user"
    && config.version === 1
    && config.schema === "sdd-user-v1";
}

function plannedRetirementKind(spaceId) {
  const digest = createHash("sha256").update(spaceId).digest("hex");
  return `planned:${digest}`;
}

function legacyPlannedEntryKind(entry) {
  if (entry.isSymbolicLink()) return null;
  if (entry.isDirectory() && isValidChangeId(entry.name)) return "change";
  if (entry.isFile() && entry.name.endsWith(".md")) return "brief";
  return null;
}

async function assertCanonicalChangeTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw fail(`Legacy planned Change contains a symbolic link: ${absolutePath}`, "UNSAFE_MIGRATION_PATH");
    }
    if (entry.isDirectory()) {
      await assertCanonicalChangeTree(absolutePath);
    } else if (!entry.isFile()) {
      throw fail(
        `Legacy planned Change contains an unsupported filesystem entry: ${absolutePath}`,
        "UNSAFE_MIGRATION_PATH",
      );
    }
  }
}

async function canonicalChangeState(root, tasksSource) {
  await assertCanonicalChangeTree(root);
  return {
    kind: "directory",
    hash: await hashDirectoryWithFileOverride(root, "tasks.md", tasksSource),
  };
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
    throw fail(
      `Legacy planned Change has no recoverable target repository paths: ${proposalPath}`,
      "MIGRATION_TARGET_REQUIRED",
    );
  }
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
}

async function plannedRepositoryContexts(
  legacyConfig,
  sourceConfig,
  legacyUserRoot,
  spaceId,
) {
  const rawSpace = legacyConfig.ideas?.[spaceId] ?? {};
  const sourceSpace = sourceConfig.ideas?.[spaceId] ?? {};
  const contexts = [];
  for (const [index, repository] of (sourceSpace.repositories ?? []).entries()) {
    const configuredPath = resolveRepositoryPath(sourceConfig, repository);
    const repositoryRoot = resolveWorkspacePath(legacyUserRoot, configuredPath);
    const rawRepository = rawSpace.repositories?.[index];
    const aliases = new Set([normalizePath(configuredPath)]);
    if (rawRepository && typeof rawRepository === "object") {
      aliases.add(normalizePath(resolveRepositoryPath(legacyConfig, rawRepository)));
    }
    const configPath = getRepositoryConfigPath(repositoryRoot);
    const configRecord = await readBoundAuthorityFile(configPath, {
      label: "Legacy repository config",
      allowMissing: true,
      invalidCode: "INVALID_LEGACY_REPOSITORY_CONFIG",
    });
    let repositoryId = null;
    if (configRecord) {
      const rawRepositoryConfig = parseAuthorityYaml(configRecord.source, configPath);
      const migrated = migrateRepositoryConfig(rawRepositoryConfig).config;
      assertValidRepositoryConfig(migrated);
      repositoryId = migrated.id;
    }
    contexts.push({
      repositoryRoot,
      repositoryId,
      aliases,
      configPath,
      configState: configRecord?.state ?? null,
    });
  }
  return contexts;
}

async function resolvePlannedRepositoryIds(
  changePath,
  spaceId,
  contexts,
) {
  const proposalPath = join(changePath, "proposal.md");
  const proposalState = await snapshot(proposalPath);
  if (!proposalState || proposalState.kind !== "file") {
    throw fail(
      `Legacy planned Change is missing a regular proposal.md file: ${changePath}`,
      "INVALID_CHANGE_METADATA",
    );
  }
  const recordedPaths = legacyPlannedTargetPaths(await readFile(proposalPath, "utf8"), proposalPath);
  if (recordedPaths === null) {
    if (contexts.length === 0) return [];
    if (contexts.length === 1 && contexts[0].repositoryId) return [contexts[0].repositoryId];
    throw fail(
      `Legacy planned Change has ambiguous target repositories: ${changePath}`,
      "MIGRATION_TARGET_REQUIRED",
      contexts.map((context) => context.repositoryRoot),
    );
  }
  if (recordedPaths.length === 0) {
    if (contexts.length === 0) return [];
    throw fail(
      `Legacy planned Change recorded no repositories but Space ${spaceId} has mapped targets.`,
      "MIGRATION_TARGET_REQUIRED",
      contexts.map((context) => context.repositoryRoot),
    );
  }
  const selected = [];
  for (const recordedPath of recordedPaths) {
    const matches = contexts.filter((context) => context.aliases.has(recordedPath));
    if (matches.length !== 1) {
      throw fail(
        `Legacy planned Change target cannot be resolved for ${spaceId}: ${recordedPath}`,
        "MIGRATION_TARGET_REQUIRED",
        [proposalPath, ...contexts.map((context) => context.repositoryRoot)],
      );
    }
    if (!matches[0].repositoryId) {
      throw fail(
        `Legacy planned Change target has no portable repository identity: ${recordedPath}`,
        "MIGRATION_IDENTITY_REQUIRED",
        [matches[0].repositoryRoot],
      );
    }
    selected.push(matches[0].repositoryId);
  }
  return [...new Set(selected)].sort((left, right) => left.localeCompare(right));
}

async function readPlannedChangeCandidate(path, spaceId, contexts) {
  await assertRegularMigrationTree(path, "Legacy planned Change");
  const tasksPath = join(path, "tasks.md");
  const tasksState = await snapshot(tasksPath);
  if (!tasksState || tasksState.kind !== "file") {
    throw fail(
      `Legacy planned Change is missing a regular tasks.md file: ${path}`,
      "INVALID_CHANGE_METADATA",
    );
  }
  const tasksSource = await readFile(tasksPath, "utf8");
  if (setChangeMetadata(tasksSource, { space: spaceId, repositories: [] }) === null) {
    throw fail(
      `Legacy planned Change has malformed tasks.md frontmatter: ${tasksPath}`,
      "INVALID_CHANGE_METADATA",
    );
  }
  const repositories = await resolvePlannedRepositoryIds(path, spaceId, contexts);
  return {
    changeId: basename(path),
    spaceId,
    repositories,
    path,
    state: await snapshot(path),
    tasksSource,
  };
}

function assertPlannedMetadata(candidate, spaceId, repositories) {
  const metadata = parseChangeMetadata(candidate.tasksSource);
  if (!metadata.error) {
    const existingRepositories = [...metadata.repositories]
      .sort((left, right) => left.localeCompare(right));
    if (
      metadata.space !== spaceId
      || !isDeepStrictEqual(existingRepositories, repositories)
    ) {
      throw fail(
        `Legacy planned Change ownership metadata conflicts with resolved topology: ${candidate.path}`,
        "INVALID_CHANGE_METADATA",
      );
    }
  } else if (metadata.space !== null || metadata.repositories !== null) {
    throw fail(
      `Legacy planned Change contains incomplete ownership metadata: ${candidate.path}`,
      "INVALID_CHANGE_METADATA",
      [metadata.error],
    );
  }
}

async function canonicalizePlannedCandidates(candidates) {
  const grouped = new Map();
  for (const candidate of candidates) {
    const group = grouped.get(candidate.changeId) ?? [];
    group.push(candidate);
    grouped.set(candidate.changeId, group);
  }
  const canonical = [];
  for (const [changeId, group] of [...grouped]
    .sort(([left], [right]) => left.localeCompare(right))) {
    const spaces = [...new Set(group.map((candidate) => candidate.spaceId))];
    if (spaces.length !== 1) {
      throw fail(
        `Legacy planned Change ID is reused across Spaces: ${changeId}`,
        "CROSS_SPACE_CHANGE_COLLISION",
        spaces,
      );
    }
    const hashes = [...new Set(group.map((candidate) => candidate.state.hash))];
    if (hashes.length !== 1) {
      throw fail(
        `Legacy planned Change copies diverge: ${changeId}`,
        "DIVERGENT_CHANGE_COPIES",
        group.map((candidate) => candidate.path),
      );
    }
    const repositories = [...new Set(group.flatMap((candidate) => candidate.repositories))]
      .sort((left, right) => left.localeCompare(right));
    for (const candidate of group) {
      assertPlannedMetadata(candidate, spaces[0], repositories);
    }
    const representative = group[0];
    const canonicalTasksSource = setChangeMetadata(representative.tasksSource, {
      space: spaces[0],
      repositories,
    });
    if (canonicalTasksSource === null) {
      throw fail(
        `Legacy planned Change cannot receive canonical ownership metadata: ${representative.path}`,
        "INVALID_CHANGE_METADATA",
      );
    }
    canonical.push({
      changeId,
      spaceId: spaces[0],
      repositories,
      source: representative.path,
      sourceState: representative.state,
      canonicalTasksSource,
      desired: await canonicalChangeState(representative.path, canonicalTasksSource),
    });
  }
  return canonical;
}

async function planLegacyPlannedArtifacts(
  legacyUserRoot,
  workspaceRoot,
  legacyConfig,
  workspaceConfig,
  changes,
) {
  if (!isReleasedLegacyUserV1(legacyConfig)) {
    return { roots: [], changes: [], briefs: [] };
  }
  const sourceConfig = createWorkspaceConfigFromLegacyHome(
    legacyConfig,
    legacyUserRoot,
    legacyUserRoot,
  );
  const plannedDirectory = legacyConfig.planning.plannedChangesDirectory;
  const roots = [];
  const candidates = [];
  const briefs = [];
  const rootPaths = new Set();
  const briefDestinations = new Set();
  for (const [spaceId, sourceSpace] of Object.entries(sourceConfig.ideas)
    .sort(([left], [right]) => left.localeCompare(right))) {
    const sourceOwner = resolveWorkspacePath(
      legacyUserRoot,
      resolveIdeaPlanningPath(sourceConfig, spaceId, sourceSpace),
    );
    let sourceOwnerState;
    try {
      sourceOwnerState = await lstat(sourceOwner);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      sourceOwnerState = null;
    }
    if (
      !sourceOwnerState
      || sourceOwnerState.isSymbolicLink()
      || !sourceOwnerState.isDirectory()
    ) {
      throw fail(
        `Legacy planning owner is unavailable or unsafe: ${sourceOwner}`,
        "MIGRATION_SOURCE_UNAVAILABLE",
      );
    }
    const sourceRoot = join(sourceOwner, plannedDirectory);
    const sourceState = await snapshot(sourceRoot);
    if (!sourceState) continue;
    if (sourceState.kind !== "directory") {
      throw fail(`Legacy planned Change root is not a directory: ${sourceRoot}`, "UNSAFE_MIGRATION_PATH");
    }
    if (
      resolve(sourceRoot) === resolve(sourceOwner)
      || !(await isPathPhysicallyInside(sourceOwner, sourceRoot))
    ) {
      throw fail(
        `Legacy planned Change root is not safely contained by its source owner: ${sourceRoot}`,
        "UNSAFE_MIGRATION_PATH",
      );
    }
    const normalizedRoot = resolve(sourceRoot);
    if (rootPaths.has(normalizedRoot)) {
      throw fail(
        `Multiple Spaces claim the same legacy planned Change root: ${sourceRoot}`,
        "LEGACY_SOURCE_COLLISION",
      );
    }
    rootPaths.add(normalizedRoot);
    await assertRegularMigrationTree(sourceRoot, `Legacy planned Change root for ${spaceId}`);
    const destinationSpace = workspaceConfig.ideas[spaceId];
    const destinationOwner = resolveWorkspacePath(
      workspaceRoot,
      resolveIdeaPlanningPath(workspaceConfig, spaceId, destinationSpace),
    );
    const contexts = await plannedRepositoryContexts(
      legacyConfig,
      sourceConfig,
      legacyUserRoot,
      spaceId,
    );
    for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
      const sourcePath = join(sourceRoot, entry.name);
      const entryKind = legacyPlannedEntryKind(entry);
      if (entryKind === "change") {
        candidates.push(await readPlannedChangeCandidate(sourcePath, spaceId, contexts));
      } else if (entryKind === "brief") {
        const destination = join(destinationOwner, CHANGE_BRIEFS_DIRECTORY_NAME, entry.name);
        if (!(await isPathPhysicallyInside(destinationOwner, destination))) {
          throw fail(
            `Change Brief destination escapes its planning owner: ${destination}`,
            "UNSAFE_MIGRATION_PATH",
          );
        }
        if (briefDestinations.has(resolve(destination)) || await pathExists(destination)) {
          throw fail(
            `Change Brief migration destination already exists: ${destination}`,
            "CHANGE_BRIEF_COLLISION",
            [sourcePath],
          );
        }
        briefDestinations.add(resolve(destination));
        briefs.push({
          spaceId,
          source: sourcePath,
          sourceState: await snapshot(sourcePath),
          target: destination,
          owner: destinationOwner,
        });
      } else {
        throw fail(
          `Unsupported entry in legacy planned Change root: ${sourcePath}`,
          "UNSUPPORTED_LEGACY_CHANGE_ENTRY",
        );
      }
    }
    roots.push({
      spaceId,
      kind: plannedRetirementKind(spaceId),
      owner: sourceOwner,
      source: sourceRoot,
      sourceState,
      contexts,
    });
  }

  const plannedChanges = [];
  for (const candidate of await canonicalizePlannedCandidates(candidates)) {
    const legacySource = changes.sourceChanges.get(candidate.changeId) ?? null;
    const existing = changes.targetChanges.get(candidate.changeId) ?? null;
    for (const collision of [legacySource, existing].filter(Boolean)) {
      if (collision.closed || !sameSnapshot(collision.state, candidate.desired)) {
        throw fail(
          `Central Change destination conflicts with legacy planned Change ${candidate.changeId}.`,
          "CHANGE_DESTINATION_CONFLICT",
          [collision.path, candidate.source],
        );
      }
    }
    plannedChanges.push({
      ...candidate,
      target: join(changes.target, candidate.changeId),
      satisfiedByLegacySource: legacySource !== null,
      targetState: existing?.state ?? null,
    });
  }
  return {
    roots,
    changes: plannedChanges,
    briefs: briefs.sort((left, right) => left.target.localeCompare(right.target)),
  };
}

async function configuredPlannedTopologies(
  legacyConfig,
  workspaceConfig,
  legacyUserRoot,
  workspaceRoot,
) {
  if (!isReleasedLegacyUserV1(legacyConfig)) return [];
  const sourceConfig = createWorkspaceConfigFromLegacyHome(
    legacyConfig,
    legacyUserRoot,
    legacyUserRoot,
  );
  const plannedDirectory = legacyConfig.planning.plannedChangesDirectory;
  const topologies = [];
  for (const [spaceId, sourceSpace] of Object.entries(sourceConfig.ideas)
    .sort(([left], [right]) => left.localeCompare(right))) {
    const sourceOwner = resolveWorkspacePath(
      legacyUserRoot,
      resolveIdeaPlanningPath(sourceConfig, spaceId, sourceSpace),
    );
    const destinationSpace = workspaceConfig.ideas[spaceId];
    const destinationOwner = resolveWorkspacePath(
      workspaceRoot,
      resolveIdeaPlanningPath(workspaceConfig, spaceId, destinationSpace),
    );
    topologies.push({
      spaceId,
      kind: plannedRetirementKind(spaceId),
      sourceOwner,
      sourceRoot: join(sourceOwner, plannedDirectory),
      destinationOwner,
      contexts: await plannedRepositoryContexts(
        legacyConfig,
        sourceConfig,
        legacyUserRoot,
        spaceId,
      ),
    });
  }
  return topologies;
}

async function readAuthenticatedPlannedRoot(readRoot, topology) {
  await assertRegularMigrationTree(readRoot, `Authenticated planned root for ${topology.spaceId}`);
  const candidates = [];
  const briefs = [];
  for (const entry of await readdir(readRoot, { withFileTypes: true })) {
    const sourcePath = join(readRoot, entry.name);
    const entryKind = legacyPlannedEntryKind(entry);
    if (entryKind === "change") {
      candidates.push(await readPlannedChangeCandidate(
        sourcePath,
        topology.spaceId,
        topology.contexts,
      ));
    } else if (entryKind === "brief") {
      briefs.push({
        target: join(topology.destinationOwner, CHANGE_BRIEFS_DIRECTORY_NAME, entry.name),
        state: await snapshot(sourcePath),
        owner: topology.destinationOwner,
      });
    } else {
      throw fail(
        `Unsupported entry in authenticated legacy planned root: ${sourcePath}`,
        "INVALID_MIGRATION_JOURNAL",
      );
    }
  }
  return { candidates, briefs };
}

async function copyMissingTree(source, target, output, opaque = new Set(), current = "") {
  for (const name of await names(join(source, current))) {
    const child = join(current, name);
    const sourcePath = join(source, child);
    const targetPath = join(target, child);
    const outputPath = join(output, child);
    const sourceState = await snapshot(sourcePath);
    const targetState = await snapshot(targetPath);
    if (!targetState) {
      await mkdir(dirname(outputPath), { recursive: true });
      await cp(sourcePath, outputPath, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
      continue;
    }
    if (opaque.has(child)) {
      if (!sameSnapshot(sourceState, targetState)) {
        throw fail(`Migration destination collision: ${normalizePath(child)}`, "MIGRATION_DESTINATION_COLLISION");
      }
      continue;
    }
    if (sourceState.kind === "directory" && targetState.kind === "directory") {
      await copyMissingTree(source, target, output, opaque, child);
    } else if (!sameSnapshot(sourceState, targetState)) {
      throw fail(`Migration destination collision: ${normalizePath(child)}`, "MIGRATION_DESTINATION_COLLISION");
    }
  }
}

async function planRecoveryEntries(legacyUserRoot, workspaceRoot) {
  const sourceRoot = join(legacyUserRoot, CONFIG_DIRECTORY_NAME);
  const targetRoot = getWorkspaceConfigDirectory(workspaceRoot);
  const entries = [];
  for (const name of await names(sourceRoot)) {
    if (RESERVED_SOURCE_ENTRIES.has(name)) continue;
    const source = join(sourceRoot, name);
    const target = join(targetRoot, name);
    const sourceState = await snapshot(source);
    const targetState = await snapshot(target);
    await assertRegularMigrationTree(source, `Legacy recovery entry ${name}`);
    if (targetState) {
      await assertRegularMigrationTree(target, `Workspace recovery destination ${name}`);
    }
    if (targetState && !sameSnapshot(sourceState, targetState)) {
      throw fail(`Workspace recovery destination conflicts with legacy content: ${name}`, "MIGRATION_DESTINATION_COLLISION");
    }
    entries.push({ name, source, target, sourceState, targetState });
  }
  return entries;
}

async function readOwnership(legacyUserRoot, legacyConfig, hooks = {}) {
  const skillsRoot = resolveLegacyUserPath(
    legacyUserRoot,
    legacyConfig.skills.directory,
  );
  const lockPath = join(legacyUserRoot, CONFIG_DIRECTORY_NAME, INSTALL_LOCK_FILE_NAME);
  await requireContained(legacyUserRoot, lockPath, "Legacy install lock");
  const lockRecord = await readBoundAuthorityFile(lockPath, {
    label: "Legacy install lock",
    allowMissing: true,
    invalidCode: "INVALID_INSTALL_LOCK",
    afterRead: hooks.afterLegacyInstallLockAuthorityRead,
  });
  const lockState = lockRecord?.state ?? null;
  if (!lockRecord) {
    return {
      skillsRoot,
      lockPath,
      lockState,
      ownedSkills: [],
      ownedWorkflow: null,
    };
  }
  let lock;
  try {
    lock = JSON.parse(lockRecord.source);
  } catch (error) {
    throw fail(`Cannot parse legacy install lock: ${lockPath}`, "INVALID_INSTALL_LOCK", [error.message]);
  }
  if (!lock?.managedSkills || typeof lock.managedSkills !== "object" || Array.isArray(lock.managedSkills)) {
    throw fail(`Legacy install lock is invalid: ${lockPath}`, "INVALID_INSTALL_LOCK");
  }
  const lockedDirectory = resolveLegacyUserPath(
    legacyUserRoot,
    lock.skillsDirectory ?? legacyConfig.skills.directory,
  );
  if (skillsRoot !== lockedDirectory) {
    throw fail("Legacy config and install lock disagree about the skill directory.", "INVALID_INSTALL_LOCK");
  }
  const managedSkills = Object.entries(lock.managedSkills)
    .sort(([left], [right]) => left.localeCompare(right));
  const hashVersions = new Set();
  for (const [skillName, expectedHash] of managedSkills) {
    const version = directoryHashVersion(expectedHash);
    if (!/^sdd-[a-z0-9-]+$/.test(skillName) || version === null) {
      throw fail(`Invalid managed skill ownership in legacy install lock: ${skillName}`, "INVALID_INSTALL_LOCK");
    }
    hashVersions.add(version);
  }
  if (hashVersions.size > 1) {
    throw fail("Legacy install lock mixes managed skill hash versions.", "INVALID_INSTALL_LOCK");
  }
  const ownedSkills = [];
  for (const [skillName, expectedHash] of managedSkills) {
    const path = join(skillsRoot, skillName);
    const state = await snapshot(path);
    if (state && !snapshotMatchesDirectoryHash(state, expectedHash)) {
      throw fail(`Checksum-owned legacy skill was modified: ${skillName}`, "MIGRATION_SOURCE_MODIFIED", [path]);
    }
    ownedSkills.push({ skillName, path, state });
  }
  if (
    lock.managedWorkflow !== undefined
    && (
      !isRecord(lock.managedWorkflow)
      || !/^sha256:[a-f0-9]{64}$/.test(lock.managedWorkflow.hash)
      || (lock.managedWorkflow.path !== undefined
        && typeof lock.managedWorkflow.path !== "string")
    )
  ) {
    throw fail("Legacy install lock has invalid managed workflow ownership.", "INVALID_INSTALL_LOCK");
  }
  const workflowPath = resolve(legacyUserRoot, WORKFLOW_RELATIVE_PATH);
  const workflowState = await snapshot(workflowPath);
  let ownedWorkflow = null;
  if (lock.managedWorkflow !== undefined) {
    if (!workflowState || workflowState.kind !== "file" || workflowState.hash !== lock.managedWorkflow.hash) {
      throw fail("Checksum-owned legacy workflow was modified or removed.", "MIGRATION_SOURCE_MODIFIED", [workflowPath]);
    }
    ownedWorkflow = { path: workflowPath, state: workflowState };
  }
  return {
    skillsRoot,
    lockPath,
    lockState,
    ownedSkills,
    ownedWorkflow,
  };
}

async function completedReceipt(workspaceRoot, legacyUserRoot) {
  const path = resolve(workspaceRoot, RECEIPT_RELATIVE_PATH);
  if (!(await pathExists(path))) return null;
  let value;
  try {
    value = await readJson(path);
  } catch (error) {
    throw fail(`Cannot parse migration receipt: ${path}`, "INVALID_MIGRATION_RECEIPT", [error.message]);
  }
  try {
    assertReceiptValue(value, workspaceRoot, legacyUserRoot, path);
  } catch (error) {
    throw fail(
      `Invalid migration receipt: ${path}`,
      "INVALID_MIGRATION_RECEIPT",
      [error.message],
    );
  }
  for (const name of (await names(workspaceRoot)).filter((entry) => entry.startsWith(STAGING_PREFIX))) {
    const stageRoot = join(workspaceRoot, name);
    let stageState;
    try {
      stageState = await lstat(stageRoot);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (!stageState.isDirectory() || stageState.isSymbolicLink()) {
      throw invalidJournal(stageRoot, "The transaction root is not a real directory.");
    }
    await readStageIntent(stageRoot, workspaceRoot, legacyUserRoot);
    const hasJournal = await optionalPhysicalPathIdentity(join(stageRoot, JOURNAL_NAME));
    const hasGeneration = (await names(stageRoot)).some(
      (entry) => JOURNAL_GENERATION_PATTERN.test(entry),
    );
    if (!hasJournal && !hasGeneration) {
      throw fail(
        `An interrupted legacy user migration requires recovery before its receipt can be accepted: ${stageRoot}`,
        "MIGRATION_RECOVERY_REQUIRED",
        [stageRoot],
      );
    }
    const recovered = await readRecoveryJournal(stageRoot, join(stageRoot, JOURNAL_NAME));
    await assertJournal(
      recovered.journal,
      stageRoot,
      workspaceRoot,
      legacyUserRoot,
    );
    throw fail(
      `An interrupted legacy user migration requires recovery before its receipt can be accepted: ${stageRoot}`,
      "MIGRATION_RECOVERY_REQUIRED",
      [stageRoot],
    );
  }
  return { path, value };
}
async function assertNonOverlappingMigrationPlan(plan) {
  const retirementPaths = [
    {
      label: "Legacy configuration cleanup root",
      path: join(plan.legacyUserRoot, CONFIG_DIRECTORY_NAME),
    },
    {
      label: "Legacy skill cleanup root",
      path: plan.ownership.skillsRoot,
    },
    {
      label: "Legacy skill parent cleanup root",
      path: dirname(plan.ownership.skillsRoot),
      aliasOnly: true,
    },
    ...(plan.changes.sourceState
      ? [{ label: "Legacy Change retirement root", path: plan.changes.source }]
      : []),
    ...plan.plannedArtifacts.roots.map((root) => ({
      label: `Legacy planned retirement ${root.spaceId}`,
      path: root.source,
    })),
    ...plan.recoveryEntries.map((entry) => ({
      label: `Legacy recovery retirement ${entry.name}`,
      path: entry.source,
    })),
    ...plan.ownership.ownedSkills
      .filter((entry) => entry.state)
      .map((entry) => ({
        label: `Legacy skill retirement ${entry.skillName}`,
        path: entry.path,
      })),
    ...(plan.ownership.ownedWorkflow
      ? [{
        label: "Legacy workflow retirement",
        path: plan.ownership.ownedWorkflow.path,
      }]
      : []),
    ...(plan.ownership.lockState
      ? [{ label: "Legacy install-lock retirement", path: plan.ownership.lockPath }]
      : []),
    { label: "Legacy configuration retirement", path: plan.sourceConfigPath },
  ];
  const destinationPaths = [
    {
      label: "workspace configuration root",
      path: getWorkspaceConfigDirectory(plan.workspaceRoot),
    },
    {
      label: "workspace managed skill root",
      path: plan.skillPlan.skillsDirectory,
    },
    { label: "workspace configuration destination", path: plan.destinationConfigPath },
    { label: "workspace Change destination", path: plan.changes.target },
    ...plan.plannedArtifacts.briefs.map((brief) => ({
      label: `workspace Change Brief destination ${brief.spaceId}`,
      path: brief.target,
    })),
    ...plan.recoveryEntries.map((entry) => ({
      label: `workspace recovery destination ${entry.name}`,
      path: entry.target,
    })),
    { label: "workspace workflow destination", path: plan.workflowPlan.target },
    ...plan.skillPlan.actions.map((entry) => ({
      label: `workspace skill destination ${entry.skillName}`,
      path: entry.target,
    })),
    { label: "workspace install-lock destination", path: plan.lockPath },
    { label: "workspace migration-receipt destination", path: plan.receiptPath },
  ];
  await assertNoOverlappingMigrationPaths(retirementPaths, destinationPaths);
}


export function assertSupportedLegacyMigrationSkillsDirectory(
  workspaceRootInput,
  skillsDirectory,
) {
  if (skillsDirectory === undefined) return;
  const workspaceRoot = resolve(workspaceRootInput);
  if (
    resolve(workspaceRoot, skillsDirectory)
    !== resolve(workspaceRoot, WORKSPACE_SKILLS_RELATIVE_PATH)
  ) {
    throw fail(
      `Legacy user migration must publish managed skills beneath ${WORKSPACE_SKILLS_RELATIVE_PATH}; --skills-dir cannot override it.`,
      "INVALID_MIGRATION_OPTIONS",
    );
  }
}

export async function planLegacyUserMigration(
  workspaceRootInput,
  legacyUserRootInput,
  { skillsDirectory, force = false, hooks = {} } = {},
) {
  const workspaceRoot = resolve(workspaceRootInput);
  const legacyUserRoot = resolve(legacyUserRootInput);
  assertSupportedLegacyMigrationSkillsDirectory(workspaceRoot, skillsDirectory);
  if (
    workspaceRoot === legacyUserRoot
    || await pathsPhysicallyAlias(workspaceRoot, legacyUserRoot)
  ) {
    throw fail("Legacy user source and workspace destination must differ.", "INVALID_MIGRATION_SOURCE");
  }
  await assertLegacyMigrationDestinationConfinement(workspaceRoot);
  const sourceConfigPath = getLegacyUserConfigPath(legacyUserRoot);
  await requireContained(legacyUserRoot, sourceConfigPath, "Legacy user configuration");
  const sourceConfigRecord = await readBoundAuthorityFile(sourceConfigPath, {
    label: "Legacy user configuration",
    allowMissing: true,
    afterRead: hooks.afterLegacyConfigAuthorityRead,
  });
  if (!sourceConfigRecord) {
    const receipt = await completedReceipt(workspaceRoot, legacyUserRoot);
    if (!receipt) throw fail(`Legacy user configuration does not exist: ${sourceConfigPath}`, "MIGRATION_SOURCE_UNAVAILABLE");
    return {
      completed: true,
      workspaceRoot,
      legacyUserRoot,
      config: await readWorkspaceConfig(workspaceRoot),
      receipt,
      result: { required: false, actions: [], warnings: [] },
    };
  }
  const sourceConfigState = sourceConfigRecord.state;
  const sourceConfig = parseAuthorityYaml(sourceConfigRecord.source, sourceConfigPath);
  let legacyConfig;
  if (sourceConfig?.kind === "user") {
    assertValidLegacyUserConfig(sourceConfig);
    legacyConfig = sourceConfig;
  } else {
    legacyConfig = migrateWorkspaceConfig(
      sourceConfig,
      legacyUserRoot,
      { legacyHomeRoot: legacyUserRoot },
    ).config;
    assertValidConfig(legacyConfig, "migrate the legacy home-root installation");
  }
  const config = createWorkspaceConfigFromLegacyHome(legacyConfig, legacyUserRoot, workspaceRoot, { skillsDirectory });
  assertValidConfig(config, "migrate the legacy user installation");
  const destinationConfigPath = getWorkspaceConfigPath(workspaceRoot);
  const destinationConfigRecord = await readBoundAuthorityFile(destinationConfigPath, {
    label: "Workspace config destination",
    allowMissing: true,
    invalidCode: "MIGRATION_DESTINATION_COLLISION",
    afterRead: hooks.afterDestinationConfigAuthorityRead,
  });
  const destinationConfigState = destinationConfigRecord?.state ?? null;
  if (destinationConfigRecord) {
    let existingConfig;
    try {
      existingConfig = parseAuthorityYaml(destinationConfigRecord.source, destinationConfigPath);
      assertValidConfig(existingConfig, "reuse the existing migration destination");
    } catch (error) {
      throw fail(
        `Workspace config destination is not a valid workspace configuration: ${destinationConfigPath}`,
        "MIGRATION_DESTINATION_COLLISION",
        [String(error?.message ?? error)],
      );
    }
    if (!isDeepStrictEqual(existingConfig, config)) {
      throw fail(
        "Workspace config destination differs from the migrated legacy configuration.",
        "MIGRATION_DESTINATION_COLLISION",
        [destinationConfigPath],
      );
    }
  }
  const changes = await planChanges(legacyUserRoot, workspaceRoot);
  const plannedArtifacts = await planLegacyPlannedArtifacts(
    legacyUserRoot,
    workspaceRoot,
    legacyConfig,
    config,
    changes,
  );
  const recoveryEntries = await planRecoveryEntries(legacyUserRoot, workspaceRoot);
  const ownership = await readOwnership(legacyUserRoot, legacyConfig, hooks);
  const installLockSnapshot = await readInstallLockSnapshot(workspaceRoot, {
    includeMissingBinding: true,
  });
  const skillPlan = await planSkillSync(workspaceRoot, config, { force, installLockSnapshot });
  const workflowPlan = await planWorkflowSync(workspaceRoot, { force, installLockSnapshot });
  const lockPath = getWorkspaceInstallLockPath(workspaceRoot);
  const lockState = installLockSnapshot === null || installLockSnapshot.missing === true
    ? null
    : {
        kind: "file",
        hash: `sha256:${createHash("sha256").update(installLockSnapshot.bytes).digest("hex")}`,
      };
  const receiptPath = resolve(workspaceRoot, RECEIPT_RELATIVE_PATH);
  if (await pathExists(receiptPath)) {
    throw fail(`A different user migration receipt already exists: ${receiptPath}`, "MIGRATION_DESTINATION_COLLISION");
  }
  const actions = [
    { kind: "workspace-config", action: destinationConfigState ? "reconcile" : "create", path: normalizePath(destinationConfigPath) },
    ...[...changes.sourceChanges.values()].map((change) => ({
      kind: "change",
      action: changes.targetChanges.has(change.changeId) ? "preserve" : "migrate",
      changeId: change.changeId,
      closed: change.closed,
    })),
    ...plannedArtifacts.changes.map((change) => ({
      kind: "planned-change",
      action: change.targetState || change.satisfiedByLegacySource ? "preserve" : "migrate",
      changeId: change.changeId,
      space: change.spaceId,
      repositories: change.repositories,
      closed: false,
    })),
    ...plannedArtifacts.briefs.map((brief) => ({
      kind: "brief",
      action: "migrate",
      space: brief.spaceId,
      from: normalizePath(brief.source),
      to: normalizePath(brief.target),
    })),
    ...plannedArtifacts.roots.map((root) => ({
      kind: "legacy-planned-root",
      action: "retire",
      space: root.spaceId,
      path: normalizePath(root.source),
    })),
    ...recoveryEntries.map((entry) => ({ kind: "recovery", action: entry.targetState ? "preserve" : "migrate", path: normalizePath(entry.target) })),
    { kind: "workflow", action: workflowPlan.action, path: normalizePath(workflowPlan.target) },
    ...skillPlan.actions.map((entry) => ({ kind: "skill", action: entry.action, skillName: entry.skillName })),
    ...ownership.ownedSkills.filter((entry) => entry.state).map((entry) => ({ kind: "legacy-skill", action: "retire", skillName: entry.skillName })),
    { kind: "legacy-config", action: "retire", path: normalizePath(sourceConfigPath) },
  ];
  const plan = {
    completed: false,
    workspaceRoot,
    legacyUserRoot,
    sourceConfigPath,
    sourceConfigState,
    destinationConfigPath,
    destinationConfigState,
    config,
    changes,
    recoveryEntries,
    plannedArtifacts,
    ownership,
    skillPlan,
    workflowPlan,
    lockPath,
    lockState,
    receiptPath,
    result: { required: true, actions, warnings: [] },
  };
  await assertNonOverlappingMigrationPlan(plan);
  return plan;
}

function publication(kind, target, previous, staged, desired) {
  return {
    kind,
    target,
    previous,
    staged,
    desired,
    backup: null,
    backupReservation: null,
    reservation: null,
    state: "pending",
    rollbackState: "pending",
    rollbackRemovalIdentity: null,
    rollbackRestoreIdentity: null,
  };
}

async function stageDestinationGuard(
  destinationGuards,
  payload,
  kind,
  target,
  source,
  desired,
) {
  const staged = join(payload, "guards", String(destinationGuards.length));
  await expect(source, desired, "Preserved migration source");
  await mkdir(dirname(staged), { recursive: true });
  await cp(source, staged, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
  await expect(source, desired, "Preserved migration source");
  await expect(staged, desired, "Staged preserved migration destination");
  destinationGuards.push({ kind, target, staged, desired });
}

async function stagePlannedChangeGuard(destinationGuards, payload, change) {
  const staged = join(payload, "guards", String(destinationGuards.length));
  await expect(change.source, change.sourceState, "Legacy planned Change source");
  await mkdir(dirname(staged), { recursive: true });
  await cp(change.source, staged, {
    recursive: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });
  await writeFile(join(staged, "tasks.md"), change.canonicalTasksSource, "utf8");
  await expect(change.source, change.sourceState, "Legacy planned Change source");
  await expect(staged, change.desired, "Staged planned Change destination");
  destinationGuards.push({
    kind: "change",
    target: change.target,
    staged,
    desired: change.desired,
  });
}

function journalValue(state) {
  return {
    version: JOURNAL_VERSION,
    phase: state.phase,
    workspaceRoot: state.workspaceRoot,
    legacyUserRoot: state.legacyUserRoot,
    workspaceSkillsRoot: state.workspaceSkillsRoot,
    legacySkillsRoot: state.legacySkillsRoot,
    stageRoot: state.stageRoot,
    publications: state.publications,

    destinationGuards: state.destinationGuards,
    retirements: state.retirements,
    receipt: state.receipt,
  };
}
async function requireJournalObservation(state) {
  await requireTransactionProvenanceObservation(state);
  if (!state.journalSourcePath || !state.journalSourceIdentity || !state.journalState) return;
  await requirePhysicalIdentity(
    state.journalSourcePath,
    state.journalSourceIdentity,
    "Migration journal authority",
  );
  const observation = await readBoundAuthorityFile(state.journalSourcePath, {
    label: "Migration journal authority",
    invalidCode: "INVALID_MIGRATION_JOURNAL",
  });
  if (!sameSnapshot(observation.state, state.journalState)) {
    throw fail(
      `Migration journal authority bytes changed: ${state.journalSourcePath}`,
      "CONCURRENT_CHANGE",
    );
  }
}

function journalGenerationPath(stageRoot, generation) {
  return join(stageRoot, `transaction.${String(generation).padStart(12, "0")}.json`);
}
function journalGenerationProofPath(stageRoot, generation) {
  return join(stageRoot, `transaction.${String(generation).padStart(12, "0")}.proof`);
}


async function persist(state) {
  const generation = (state.journalGeneration ?? 0) + 1;
  const generationPath = journalGenerationPath(state.stageRoot, generation);
  const serialized = `${JSON.stringify(journalValue(state), null, 2)}\n`;
  await writeDurableFileExclusive(generationPath, serialized);
  const generationIdentity = await physicalPathIdentity(generationPath);
  if (await readFile(generationPath, "utf8") !== serialized) {
    throw fail(`Migration journal generation changed: ${generationPath}`, "CONCURRENT_CHANGE");
  }
  const generationProofPath = journalGenerationProofPath(state.stageRoot, generation);
  try {
    await link(generationPath, generationProofPath);
  } catch (error) {
    throw mutationCollision(error, generationProofPath, "Migration journal generation proof");
  }
  if (!(await samePhysicalFile(generationPath, generationProofPath))) {
    throw fail(`Migration journal generation proof changed: ${generationProofPath}`, "CONCURRENT_CHANGE");
  }
  const currentIdentity = await optionalPhysicalPathIdentity(state.journalPath);
  await requireJournalObservation(state);
  if (
    (state.journalIdentity && !samePhysicalIdentity(currentIdentity, state.journalIdentity))
    || (!state.journalIdentity && currentIdentity)
  ) {
    throw fail(
      `Migration journal changed before persistence: ${state.journalPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  await state.hooks?.beforeJournalLink?.({
    state,
    generation,
    generationPath,
    journalPath: state.journalPath,
  });
  const linkedIdentity = await optionalPhysicalPathIdentity(state.journalPath);
  if (!samePhysicalIdentity(linkedIdentity, currentIdentity)) {
    throw fail(
      `Migration journal changed during persistence: ${state.journalPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  if (currentIdentity) {
    await removeOwnedLeaf(state.journalPath, currentIdentity, "Migration journal");
  }
  try {
    await link(generationPath, state.journalPath);
  } catch (error) {
    throw mutationCollision(error, state.journalPath, "Migration journal");
  }
  const journalIdentity = await physicalPathIdentity(state.journalPath);
  if (!samePhysicalIdentity(journalIdentity, generationIdentity)) {
    throw fail(
      `Migration journal publication changed physical identity: ${state.journalPath}`,
      "MUTATION_RECOVERY_FAILED",
    );
  }
  state.journalSourcePath = generationPath;
  state.journalSourceIdentity = generationIdentity;
  state.journalState = {
    kind: "file",
    hash: `sha256:${createHash("sha256").update(serialized).digest("hex")}`,
  };
  state.journalGeneration = generation;
  state.journalIdentity = journalIdentity;
  await state.hooks?.afterJournalLink?.({
    state,
    generation,
    generationPath,
    journalPath: state.journalPath,
  });
  await requirePhysicalIdentity(state.journalPath, journalIdentity, "Migration journal");
  await requirePhysicalIdentity(generationPath, generationIdentity, "Migration journal generation");
  await requirePhysicalIdentity(
    generationProofPath,
    generationIdentity,
    "Migration journal generation proof",
  );
  if (await readFile(generationPath, "utf8") !== serialized) {
    throw fail(`Migration journal changed after publication: ${state.journalPath}`, "CONCURRENT_CHANGE");
  }
}
function invalidJournal(stageRoot, message) {
  return fail(
    `Invalid migration journal: ${join(stageRoot, JOURNAL_NAME)}`,
    "INVALID_MIGRATION_JOURNAL",
    [message],
  );
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isRecord(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function assertJournalSnapshot(
  value,
  label,
  stageRoot,
  { nullable = true, kinds = ["file", "directory"] } = {},
) {
  if (value === null && nullable) return;
  const validHash = value?.kind === "directory"
    ? directoryHashVersion(value.hash) !== null
    : /^sha256:[0-9a-f]{64}$/.test(value?.hash);
  if (
    !hasExactKeys(value, ["kind", "hash"])
    || !kinds.includes(value.kind)
    || !validHash
  ) {
    throw invalidJournal(stageRoot, `${label} is not a valid filesystem snapshot.`);
  }
}

function collectJournalDirectoryHashVersions(value, versions = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) collectJournalDirectoryHashVersions(entry, versions);
    return versions;
  }
  if (!isRecord(value)) return versions;
  if (value.kind === "directory" && Object.hasOwn(value, "hash")) {
    versions.add(directoryHashVersion(value.hash));
  }
  for (const nested of Object.values(value)) {
    collectJournalDirectoryHashVersions(nested, versions);
  }
  return versions;
}

function assertJournalDirectoryIdentity(value, label, stageRoot) {
  if (value === null) return;
  if (
    !hasExactKeys(value, ["device", "inode"])
    || typeof value.device !== "string"
    || !/^\d+$/.test(value.device)
    || typeof value.inode !== "string"
    || !/^\d+$/.test(value.inode)
  ) {
    throw invalidJournal(stageRoot, `${label} is not a valid directory identity.`);
  }
}

function requireExactJournalPath(actual, expected, label, stageRoot) {
  if (typeof actual !== "string" || actual !== resolve(expected)) {
    throw invalidJournal(stageRoot, `${label} does not match its deterministic transaction path.`);
  }
}

function assertJournalRecoveryName(name, label, stageRoot) {
  if (
    typeof name !== "string"
    || !name
    || name === "."
    || name === ".."
    || name.includes("/")
    || name.includes("\\")
    || name.includes("\0")
    || basename(name) !== name
    || RESERVED_SOURCE_ENTRIES.has(name)
  ) {
    throw invalidJournal(stageRoot, `${label} is not a direct non-reserved legacy entry name.`);
  }
}

async function requireOpaqueJournalEntryContained(owner, path, label, stageRoot) {
  const resolvedPath = resolve(path);
  if (
    typeof path !== "string"
    || !isPathInside(owner, resolvedPath)
    || !(await isPathPhysicallyInside(owner, dirname(resolvedPath)))
  ) {
    throw invalidJournal(stageRoot, `${label} entry resolves outside its transaction owner.`);
  }
}

async function requireJournalContained(owner, path, label, stageRoot) {
  if (
    typeof path !== "string"
    || !isPathInside(owner, resolve(path))
    || !(await isPathPhysicallyInside(owner, resolve(path)))
  ) {
    throw invalidJournal(stageRoot, `${label} resolves outside its transaction owner.`);
  }
}

async function readAuthenticatedJournalConfigs(candidates, label, stageRoot) {
  const configs = [];
  const checked = new Set();
  for (const candidate of candidates) {
    if (!candidate.path || !candidate.expected) continue;
    const path = resolve(candidate.path);
    const key = `${path}\0${candidate.expected.kind}\0${candidate.expected.hash}`;
    if (checked.has(key)) continue;
    checked.add(key);
    let observed;
    try {
      observed = await readBoundAuthorityFile(path, {
        label,
        allowMissing: true,
        invalidCode: "INVALID_MIGRATION_JOURNAL",
      });
    } catch (error) {
      throw invalidJournal(
        stageRoot,
        `${label} is not a regular authenticated config file: ${String(error?.message ?? error)}`,
      );
    }
    if (!observed || !sameSnapshot(observed.state, candidate.expected)) continue;
    try {
      const document = parseDocument(observed.source);
      if (document.errors.length > 0) throw document.errors[0];
      const config = document.toJS();
      if (!isRecord(config)) throw new Error("Configuration must be a mapping.");
      configs.push(config);
    } catch (error) {
      throw invalidJournal(stageRoot, `${label} is invalid: ${String(error?.message ?? error)}`);
    }
  }
  if (configs.length === 0) {
    throw invalidJournal(stageRoot, `${label} does not match an authenticated transaction snapshot.`);
  }
  return configs;
}

async function assertWorkspaceConfigSkillsRoot(
  record,
  workspaceRoot,
  expectedWorkspaceSkillsRoot,
  stageRoot,
) {
  const configs = await readAuthenticatedJournalConfigs([
    { path: record.staged, expected: record.desired },
    { path: record.target, expected: record.desired },
    { path: record.target, expected: record.previous },
    { path: record.backup, expected: record.previous },
  ], "workspace config publication", stageRoot);

  const roots = [];
  for (const config of configs) {
    try {
      assertValidConfig(config, "recover the legacy user migration");
      roots.push(await resolveWorkspaceSkillsDirectory(workspaceRoot, config.skills.directory));
    } catch (error) {
      throw invalidJournal(
        stageRoot,
        `workspace config publication cannot authenticate the managed skill root: ${String(error?.message ?? error)}`,
      );
    }
  }
  if (roots.some((root) => root !== roots[0])) {
    throw invalidJournal(stageRoot, "workspace config transaction copies disagree about the managed skill root.");
  }
  if (configs.some((config) => !isDeepStrictEqual(config, configs[0]))) {
    throw invalidJournal(stageRoot, "workspace config transaction copies disagree.");
  }
  if (roots.some((root) => root !== expectedWorkspaceSkillsRoot)) {
    throw invalidJournal(
      stageRoot,
      `workspace config publication must use ${WORKSPACE_SKILLS_RELATIVE_PATH} as the managed skill root.`,
    );
  }
  return configs[0];
}

async function configuredLegacySkillsRoot(record, legacyUserRoot, stageRoot) {
  const configs = await readAuthenticatedJournalConfigs(
    record.state === "pending"
      ? [{ path: record.path, expected: record.expected }]
      : record.state === "retire-intent"
        ? [
            { path: record.path, expected: record.expected },
            { path: record.retired, expected: record.expected },
            ...(record.expected.kind === "file" && record.retired
              ? [{ path: retirementTransferPath(record), expected: record.expected }]
              : []),
          ]
        : [{ path: record.retired, expected: record.expected }],
    "legacy config retirement",
    stageRoot,
  );
  const roots = [];
  const normalizedConfigs = [];
  for (const sourceConfig of configs) {
    try {
      let config;
      if (sourceConfig?.kind === "user") {
        assertValidLegacyUserConfig(sourceConfig);
        config = sourceConfig;
      } else {
        config = migrateWorkspaceConfig(
          sourceConfig,
          legacyUserRoot,
          { legacyHomeRoot: legacyUserRoot },
        ).config;
        assertValidConfig(config, "recover the legacy user migration");
      }
      roots.push(resolveLegacyUserPath(legacyUserRoot, config.skills.directory));
      normalizedConfigs.push(config);
    } catch (error) {
      throw invalidJournal(
        stageRoot,
        `legacy config retirement cannot authenticate the managed skill root: ${String(error?.message ?? error)}`,
      );
    }
  }
  if (
    roots.some((root) => root !== roots[0])
    || normalizedConfigs.some((config) => !isDeepStrictEqual(config, normalizedConfigs[0]))
  ) {
    throw invalidJournal(stageRoot, "legacy config transaction copies disagree.");
  }
  return { root: roots[0], config: normalizedConfigs[0] };
}

function expectedStagedPath(record, stageRoot) {
  const payload = join(stageRoot, "payload");
  if (record.kind === "workspace-config") {
    return getWorkspaceConfigPath(join(payload, "workspace"));
  }
  if (record.kind === "changes") return join(payload, "changes");
  if (record.kind === "workflow") return join(payload, "workflow");
  if (record.kind === "installation-lock") return join(payload, INSTALL_LOCK_FILE_NAME);
  if (record.kind === "recovery") {
    const relativePath = normalizePath(relative(join(payload, "recovery"), resolve(record.staged ?? "")));
    if (!/^\d+$/.test(relativePath)) {
      throw invalidJournal(stageRoot, "publication.staged is not a deterministic recovery payload path.");
    }
    return join(payload, "recovery", relativePath);
  }
  if (record.kind === "planned-brief") {
    const relativePath = normalizePath(relative(
      join(payload, "planned-briefs"),
      resolve(record.staged ?? ""),
    ));
    if (!/^\d+$/.test(relativePath)) {
      throw invalidJournal(stageRoot, "publication.staged is not a deterministic Change Brief payload path.");
    }
    return join(payload, "planned-briefs", relativePath);
  }
  if (record.kind.startsWith("skill:")) {
    const skillName = record.kind.slice("skill:".length);
    if (!skillName || skillName.includes("/") || skillName.includes("\\") || skillName === "." || skillName === "..") {
      throw invalidJournal(stageRoot, "publication.kind contains an invalid skill name.");
    }
    return join(payload, "skills", skillName);
  }
  throw invalidJournal(stageRoot, `Unknown publication kind: ${String(record.kind)}`);
}

function assertReceiptValue(value, workspaceRoot, legacyUserRoot, stageRoot) {
  if (
    !hasExactKeys(value, ["version", "workspaceRoot", "legacyUserRoot", "completedAt"])
    || value.version !== 1
    || typeof value.workspaceRoot !== "string"
    || typeof value.legacyUserRoot !== "string"
    || resolve(value.workspaceRoot ?? "") !== workspaceRoot
    || resolve(value.legacyUserRoot ?? "") !== legacyUserRoot
    || typeof value.completedAt !== "string"
    || Number.isNaN(Date.parse(value.completedAt))
  ) {
    throw invalidJournal(stageRoot, "receipt.value is invalid.");
  }
}

async function authenticatedSnapshotPath(candidates, expected, label, stageRoot) {
  const checked = new Set();
  for (const candidate of candidates) {
    if (!candidate) continue;
    const path = resolve(candidate);
    if (checked.has(path)) continue;
    checked.add(path);
    let actual;
    try {
      actual = await snapshot(path);
    } catch {
      throw invalidJournal(stageRoot, `${label} is not a regular authenticated migration path.`);
    }
    if (sameSnapshot(actual, expected)) return path;
  }
  throw invalidJournal(stageRoot, `${label} does not match an authenticated transaction snapshot.`);
}

async function readChangeManifest(changesRoot, label, stageRoot) {
  await assertRegularMigrationTree(changesRoot, label);
  const manifest = new Map();
  const changeIds = new Set();
  const locations = [
    { root: changesRoot, closed: false },
    { root: join(changesRoot, CLOSED_CHANGES_DIRECTORY_NAME), closed: true },
  ];
  for (const location of locations) {
    let entries;
    try {
      entries = await readdir(location.root, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (
        !entry.isDirectory()
        || entry.name.startsWith(".")
        || (!location.closed && entry.name === CLOSED_CHANGES_DIRECTORY_NAME)
      ) {
        continue;
      }
      try {
        assertValidChangeId(entry.name);
      } catch {
        throw invalidJournal(stageRoot, `${label} contains an invalid Change ID.`);
      }
      if (changeIds.has(entry.name)) {
        throw invalidJournal(stageRoot, `${label} stores a Change as both active and closed.`);
      }
      changeIds.add(entry.name);
      const key = location.closed
        ? normalizePath(join(CLOSED_CHANGES_DIRECTORY_NAME, entry.name))
        : entry.name;
      const path = join(location.root, entry.name);
      manifest.set(key, {
        changeId: entry.name,
        closed: location.closed,
        path,
        state: await snapshot(path),
      });
    }
  }
  return manifest;
}


async function readAuthenticatedDestinationJson(destination, label, stageRoot) {
  const checked = new Set();
  for (const candidate of [destination.record.staged, destination.record.target]) {
    if (!candidate) continue;
    const path = resolve(candidate);
    if (checked.has(path)) continue;
    checked.add(path);
    let observed;
    try {
      observed = await readBoundAuthorityFile(path, {
        label,
        allowMissing: true,
        invalidCode: "INVALID_MIGRATION_JOURNAL",
      });
    } catch (error) {
      throw invalidJournal(stageRoot, `${label} is invalid: ${String(error?.message ?? error)}`);
    }

    if (!observed || !sameSnapshot(observed.state, destination.record.desired)) continue;
    try {
      const value = JSON.parse(observed.source);
      if (!isRecord(value)) throw new Error("Expected a JSON object.");
      return value;
    } catch (error) {
      throw invalidJournal(stageRoot, `${label} is invalid: ${String(error?.message ?? error)}`);
    }
  }
  throw invalidJournal(stageRoot, `${label} does not match an authenticated transaction snapshot.`);
}
async function requireAuthenticatedDirectoryContains(container, subset, label, stageRoot) {
  try {
    await assertDirectorySubset(container, subset, label);
  } catch (error) {
    throw invalidJournal(stageRoot, `${label} is incomplete: ${String(error?.message ?? error)}`);
  }
}

async function verifyPlanSources(plan, hooks = {}) {
  await expectAuthorityFile(
    plan.sourceConfigPath,
    plan.sourceConfigState,
    "Legacy migration source",
    hooks.afterLegacyConfigAuthorityVerificationRead,
  );
  if (plan.changes.sourceState) {
    await expect(plan.changes.source, plan.changes.sourceState, "Legacy migration source");
    await assertRegularMigrationTree(plan.changes.source, "Legacy Change store");
  }
  for (const root of plan.plannedArtifacts.roots) {
    await expect(root.source, root.sourceState, "Legacy planned Change root");
    await assertRegularMigrationTree(root.source, `Legacy planned Change root for ${root.spaceId}`);
    for (const context of root.contexts) {
      await expectAuthorityFile(
        context.configPath,
        context.configState,
        "Legacy repository config",
      );
    }
  }
  for (const entry of plan.recoveryEntries) {
    await expect(entry.source, entry.sourceState, "Legacy migration source");
    await assertRegularMigrationTree(entry.source, `Legacy recovery entry ${entry.name}`);
  }
  for (const entry of plan.ownership.ownedSkills) {
    if (entry.state) await expect(entry.path, entry.state, "Legacy migration source");
  }
  if (plan.ownership.ownedWorkflow) {
    await expect(
      plan.ownership.ownedWorkflow.path,
      plan.ownership.ownedWorkflow.state,
      "Legacy migration source",
    );
  }
  if (plan.ownership.lockState) {
    await expectAuthorityFile(
      plan.ownership.lockPath,
      plan.ownership.lockState,
      "Legacy migration source",
      hooks.afterLegacyInstallLockAuthorityVerificationRead,
    );
  }
}

async function captureRetiredDirectoryCleanup(retirements, legacyUserRoot) {
  const ownerIdentity = await physicalPathIdentity(legacyUserRoot);
  if (ownerIdentity.kind !== "directory") {
    throw fail(
      `Legacy migration transaction owner is not a real directory: ${legacyUserRoot}`,
      "UNSAFE_MIGRATION_PATH",
    );
  }
  const candidates = new Map();
  for (const record of retirements) {
    let candidate = dirname(record.path);
    while (candidate !== legacyUserRoot && isPathInside(legacyUserRoot, candidate)) {
      if (
        !candidates.has(candidate)
        && await isPathPhysicallyInside(legacyUserRoot, candidate)
      ) {
        const identity = await physicalPathIdentity(candidate);
        if (identity.kind === "directory") candidates.set(candidate, identity);
      }
      const parent = dirname(candidate);
      if (parent === candidate) break;
      candidate = parent;
    }
  }
  return [...candidates]
    .filter(([path]) => {
      let parent = dirname(path);
      while (parent !== legacyUserRoot) {
        if (!candidates.has(parent)) return false;
        parent = dirname(parent);
      }
      return true;
    })
    .map(([path, identity]) => ({ path, identity, ownerIdentity }))
    .sort(
      (left, right) => right.path.length - left.path.length
        || left.path.localeCompare(right.path),
    );
}


async function stage(plan, hooks = {}) {
  const workspaceSkillsRoot = resolve(plan.workspaceRoot, WORKSPACE_SKILLS_RELATIVE_PATH);
  if (
    plan.config.skills.directory !== WORKSPACE_SKILLS_RELATIVE_PATH
    || plan.skillPlan.skillsDirectory !== workspaceSkillsRoot
  ) {
    throw fail(
      `Legacy user migration must publish managed skills beneath ${WORKSPACE_SKILLS_RELATIVE_PATH}.`,
      "INVALID_MIGRATION_PLAN",
    );
  }
  await assertNonOverlappingMigrationPlan(plan);
  await verifyPlanSources(plan, hooks);
  const stageIntent = await createStageReservation(plan.workspaceRoot, plan.legacyUserRoot);
  const { stageRoot, stageIdentity } = stageIntent;
  let state = null;
  try {
    const payload = join(stageRoot, "payload");
    await mkdir(payload);
  const stagedWorkspace = join(payload, "workspace");
  await mkdir(stagedWorkspace);
  await hooks.beforeStagingWrite?.({
    kind: "workspace-config",
    target: stagedWorkspace,
  });
  await writeWorkspaceConfig(stagedWorkspace, plan.config);
  const stagedConfig = getWorkspaceConfigPath(stagedWorkspace);
  const publications = [publication(
    "workspace-config",
    plan.destinationConfigPath,
    plan.destinationConfigState,
    stagedConfig,
    await snapshot(stagedConfig),
  )];
  const destinationGuards = [];

  const stagedChanges = join(payload, "changes");
  await hooks.beforeStagingCopy?.({
    kind: "changes",
    source: plan.changes.source,
    target: stagedChanges,
  });
  if (plan.changes.targetState) {
    await cp(plan.changes.target, stagedChanges, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
  } else {
    await mkdir(stagedChanges, { recursive: true });
  }
  const opaque = new Set([...plan.changes.sourceChanges.values()].map((entry) => (
    entry.closed ? join(CLOSED_CHANGES_DIRECTORY_NAME, entry.changeId) : entry.changeId
  )));
  if (plan.changes.sourceState) {
    await copyMissingTree(plan.changes.source, plan.changes.target, stagedChanges, opaque);
  }
  await mkdir(join(stagedChanges, CLOSED_CHANGES_DIRECTORY_NAME), { recursive: true });
  for (const change of plan.plannedArtifacts.changes) {
    await expect(change.source, change.sourceState, "Legacy planned Change source");
    const stagedTarget = join(stagedChanges, change.changeId);
    if (!change.targetState && !change.satisfiedByLegacySource) {
      await cp(change.source, stagedTarget, {
        recursive: true,
        preserveTimestamps: true,
        verbatimSymlinks: true,
      });
      await writeFile(join(stagedTarget, "tasks.md"), change.canonicalTasksSource, "utf8");
    }
    await expect(change.source, change.sourceState, "Legacy planned Change source");
    await expect(stagedTarget, change.desired, "Staged planned Change destination");
  }
  const stagedChangesState = await snapshot(stagedChanges);
  if (!sameSnapshot(stagedChangesState, plan.changes.targetState)) {
    publications.push(publication("changes", plan.changes.target, plan.changes.targetState, stagedChanges, stagedChangesState));
  } else if (plan.changes.sourceState || plan.plannedArtifacts.changes.length > 0) {
    await stageDestinationGuard(
      destinationGuards,
      payload,
      "changes-root",
      plan.changes.target,
      plan.changes.target,
      plan.changes.targetState,
    );
  }
  for (const [changeId, record] of plan.changes.sourceChanges) {
    const existing = plan.changes.targetChanges.get(changeId);
    if (!existing) continue;
    await stageDestinationGuard(
      destinationGuards,
      payload,
      "change",
      existing.path,
      record.path,
      record.state,
    );
  }
  for (const change of plan.plannedArtifacts.changes) {
    if (!change.targetState || change.satisfiedByLegacySource) continue;
    await stagePlannedChangeGuard(destinationGuards, payload, change);
  }

  for (const [index, entry] of plan.recoveryEntries.entries()) {
    if (entry.targetState) {
      await stageDestinationGuard(
        destinationGuards,
        payload,
        "recovery",
        entry.target,
        entry.source,
        entry.sourceState,
      );
      continue;
    }
    const staged = join(payload, "recovery", String(index));
    await mkdir(dirname(staged), { recursive: true });
    await cp(entry.source, staged, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
    publications.push(publication("recovery", entry.target, null, staged, entry.sourceState));
  }
  for (const [index, brief] of plan.plannedArtifacts.briefs.entries()) {
    await expect(brief.source, brief.sourceState, "Legacy Change Brief source");
    const staged = join(payload, "planned-briefs", String(index));
    await mkdir(dirname(staged), { recursive: true });
    await cp(brief.source, staged);
    await expect(brief.source, brief.sourceState, "Legacy Change Brief source");
    await expect(staged, brief.sourceState, "Staged Change Brief destination");
    publications.push(publication(
      "planned-brief",
      brief.target,
      null,
      staged,
      brief.sourceState,
    ));
  }
  if (["install", "update", "update-forced", "replace-forced"].includes(plan.workflowPlan.action)) {
    const staged = join(payload, "workflow");
    await cp(WORKFLOW_SOURCE_PATH, staged);
    publications.push(publication(
      "workflow",
      plan.workflowPlan.target,
      plan.workflowPlan.targetHash ? { kind: "file", hash: plan.workflowPlan.targetHash } : null,
      staged,
      { kind: "file", hash: plan.workflowPlan.sourceHash },
    ));
  } else if (["unchanged", "adopt"].includes(plan.workflowPlan.action)) {
    await stageDestinationGuard(
      destinationGuards,
      payload,
      "workflow",
      plan.workflowPlan.target,
      WORKFLOW_SOURCE_PATH,
      { kind: "file", hash: plan.workflowPlan.sourceHash },
    );
  }
  for (const entry of plan.skillPlan.actions) {
    if (["unchanged", "adopt"].includes(entry.action)) {
      await stageDestinationGuard(
        destinationGuards,
        payload,
        `skill:${entry.skillName}`,
        entry.target,
        entry.source,
        { kind: "directory", hash: entry.sourceHash },
      );
      continue;
    }
    if (!["install", "update", "update-forced", "replace-forced", "remove", "remove-forced"].includes(entry.action)) continue;
    let staged = null;
    let desired = null;
    if (entry.sourceHash) {
      staged = join(payload, "skills", entry.skillName);
      await mkdir(dirname(staged), { recursive: true });
      await cp(join(BUNDLED_SKILLS_DIRECTORY, entry.skillName), staged, { recursive: true, verbatimSymlinks: true });
      desired = { kind: "directory", hash: entry.sourceHash };
    }
    publications.push(publication(
      `skill:${entry.skillName}`,
      entry.target,
      entry.targetHash ? { kind: "directory", hash: entry.targetHash } : null,
      staged,
      desired,
    ));
  }
  const stagedLock = join(payload, INSTALL_LOCK_FILE_NAME);
  await writeFile(stagedLock, serializeManagedInstallationLock(plan.skillPlan, plan.workflowPlan), "utf8");
  const stagedLockState = await snapshot(stagedLock);
  if (!sameSnapshot(stagedLockState, plan.lockState)) {
    publications.push(publication("installation-lock", plan.lockPath, plan.lockState, stagedLock, stagedLockState));
  } else {
    await stageDestinationGuard(
      destinationGuards,
      payload,
      "installation-lock",
      plan.lockPath,
      stagedLock,
      stagedLockState,
    );
  }

  const retirements = [
    ...(plan.changes.sourceState ? [{ kind: "changes", path: plan.changes.source, expected: plan.changes.sourceState }] : []),
    ...plan.plannedArtifacts.roots.map((root) => ({
      kind: root.kind,
      path: root.source,
      expected: root.sourceState,
    })),
    ...plan.recoveryEntries.map((entry) => ({ kind: `recovery:${entry.name}`, path: entry.source, expected: entry.sourceState })),
    ...plan.ownership.ownedSkills.filter((entry) => entry.state).map((entry) => ({ kind: `skill:${entry.skillName}`, path: entry.path, expected: entry.state })),
    ...(plan.ownership.ownedWorkflow ? [{ kind: "workflow", path: plan.ownership.ownedWorkflow.path, expected: plan.ownership.ownedWorkflow.state }] : []),
    ...(plan.ownership.lockState ? [{ kind: "install-lock", path: plan.ownership.lockPath, expected: plan.ownership.lockState }] : []),
    { kind: "config", path: plan.sourceConfigPath, expected: plan.sourceConfigState },
  ].map((entry) => ({
    ...entry,
    state: "pending",
    retired: null,
    reservation: null,
  }));
  state = {
    ...stageIntent,
    phase: "staged",
    workspaceRoot: plan.workspaceRoot,
    legacyUserRoot: plan.legacyUserRoot,
    workspaceSkillsRoot,
    legacySkillsRoot: plan.ownership.skillsRoot,
    stageRoot,
    stageIdentity,
    journalGeneration: 0,
    journalIdentity: null,
    journalPath: join(stageRoot, JOURNAL_NAME),
    publications,
    destinationGuards,
    retirements,
    retiredDirectories: await captureRetiredDirectoryCleanup(retirements, plan.legacyUserRoot),
    receipt: null,
    hooks,
    plan,
  };
  await persistTransactionProvenance(state);
  await persist(state);
  return state;
  } catch (error) {
    const cleanupFailures = [];
    if (state?.provenanceAuthorityIdentity) {
      try {
        await cleanupTransactionProvenanceAuthority(state);
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError.message);
      }
    }
    try {
      await quarantineIncompleteStage(stageIntent);
    } catch (cleanupError) {
      cleanupFailures.push(cleanupError.message);
      throw fail(
        "Legacy migration staging failed and its reservation could not be quarantined.",
        "MUTATION_RECOVERY_FAILED",
        [error.message, ...cleanupFailures],
      );
    }
    throw error;
  }
}

async function expectAuthorityFile(path, expected, label, afterRead) {
  const current = await readBoundAuthorityFile(path, {
    label,
    allowMissing: true,
    afterRead,
  });
  if (!sameSnapshot(current?.state ?? null, expected)) {
    throw fail(`${label} changed after preflight: ${path}`, "CONCURRENT_CHANGE");
  }
}

async function expect(path, expected, label) {
  if (!sameSnapshot(await snapshot(path), expected)) {
    throw fail(`${label} changed after preflight: ${path}`, "CONCURRENT_CHANGE");
  }
}

function plannedBriefOwner(state, record) {
  if (record.kind !== "planned-brief") return null;
  const target = resolve(record.target);
  const planned = state.plan?.plannedArtifacts?.briefs
    ?.find((brief) => resolve(brief.target) === target);
  return planned?.owner ?? state.plannedBriefOwners?.get(target) ?? null;
}

async function requirePublicationTargetContained(state, record, label = "publication.target") {
  const owner = plannedBriefOwner(state, record);
  if (record.kind === "planned-brief" && !owner) {
    throw invalidJournal(state.stageRoot, `${label} has no authenticated planning owner.`);
  }
  await requireJournalContained(
    owner ?? state.workspaceRoot,
    record.target,
    label,
    state.stageRoot,
  );
}

function plannedSourceOwner(state, record) {
  if (!/^planned:[a-f0-9]{64}$/.test(record.kind)) return null;
  return state.plan?.plannedArtifacts?.roots
    ?.find((root) => root.kind === record.kind)?.owner
    ?? state.plannedSourceOwners?.get(record.kind)
    ?? null;
}

function retirementSourceOwner(state, record) {
  return plannedSourceOwner(state, record)
    ?? (record.kind.startsWith("skill:") ? state.legacySkillsRoot : state.legacyUserRoot);
}

async function requireRetirementSourceContained(state, record, label = "retirement.path") {
  const owner = retirementSourceOwner(state, record);
  if (/^planned:[a-f0-9]{64}$/.test(record.kind) && !plannedSourceOwner(state, record)) {
    throw invalidJournal(state.stageRoot, `${label} has no authenticated planning owner.`);
  }
  await requireJournalContained(
    owner,
    record.path,
    label,
    state.stageRoot,
  );
}

function sameDirectoryIdentity(left, right) {
  return left?.device === right?.device && left?.inode === right?.inode;
}

async function directoryIdentity(path) {
  const state = await lstat(path, { bigint: true });
  if (!state.isDirectory() || state.isSymbolicLink()) {
    throw fail(`Migration reservation must be a real directory: ${path}`, "UNSAFE_MIGRATION_PATH");
  }
  return { device: String(state.dev), inode: String(state.ino) };
}
function physicalKind(state) {
  if (state.isSymbolicLink()) return "symlink";
  if (state.isDirectory()) return "directory";
  if (state.isFile()) return "file";
  return "opaque";
}

function identityFromState(state) {
  return {
    device: String(state.dev),
    inode: String(state.ino),
    kind: physicalKind(state),
  };
}

function samePhysicalIdentity(left, right) {
  if (!left || !right) return left === right;
  return left.device === right.device
    && left.inode === right.inode
    && left.kind === right.kind;
}

async function physicalPathIdentity(path) {
  return identityFromState(await lstat(path, { bigint: true }));
}

async function optionalPhysicalPathIdentity(path) {
  try {
    return await physicalPathIdentity(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function requirePhysicalIdentity(path, expected, label) {
  const actual = await optionalPhysicalPathIdentity(path);
  if (!samePhysicalIdentity(actual, expected)) {
    throw fail(`${label} changed physical identity: ${path}`, "CONCURRENT_CHANGE");
  }
  return actual;
}

function mutationCollision(error, path, label) {
  if (
    ["EEXIST", "EISDIR", "ENOENT", "ENOTDIR", "ENOTEMPTY", "ERR_FS_CP_EEXIST"]
      .includes(error?.code)
  ) {
    return fail(`${label} collided with concurrent state: ${path}`, "CONCURRENT_CHANGE");
  }
  return error;
}

async function writeDurableFileExclusive(path, source) {
  let handle;
  let identity = null;
  try {
    await mkdir(dirname(path), { recursive: true });
    handle = await open(path, "wx", 0o600);
    identity = identityFromState(await handle.stat({ bigint: true }));
    await handle.writeFile(source, "utf8");
    await handle.sync();
  } catch (error) {
    await handle?.close().catch(() => {});
    handle = null;
    if (identity) {
      await removeOwnedLeaf(path, identity, "Incomplete migration file").catch(() => {});
    }
    throw mutationCollision(error, path, "Migration file publication");
  } finally {
    await handle?.close().catch(() => {});
  }
}
function stageIntentPath(stageRoot) {
  return join(stageRoot, STAGE_INTENT_NAME);
}

function stageIntentProofPath(stageRoot) {
  return join(stageRoot, STAGE_INTENT_PROOF_NAME);
}

function stageIntentAuthorityPath(workspaceRoot, stageRoot) {
  return join(
    workspaceRoot,
    `${STAGE_INTENT_AUTHORITY_PREFIX}${basename(stageRoot).slice(STAGING_PREFIX.length)}.json`,
  );
}

function stageIntentAuthorityProofPath(workspaceRoot, stageRoot) {
  return `${stageIntentAuthorityPath(workspaceRoot, stageRoot)}.proof`;
}

function stageIntentSource(workspaceRoot, legacyUserRoot, stageRoot, stageIdentity) {
  return `${JSON.stringify({
    version: STAGE_INTENT_VERSION,
    workspaceRoot,
    legacyUserRoot,
    stageRoot,
    stageIdentity,
  }, null, 2)}\n`;
}

async function requireStageIntentObservation(state) {
  const intentPath = stageIntentPath(state.stageRoot);
  const proofPath = stageIntentProofPath(state.stageRoot);
  const authorityPath = stageIntentAuthorityPath(state.workspaceRoot, state.stageRoot);
  const authorityProofPath = stageIntentAuthorityProofPath(
    state.workspaceRoot,
    state.stageRoot,
  );
  await Promise.all([
    requirePhysicalIdentity(intentPath, state.stageIntentIdentity, "Migration stage intent"),
    requirePhysicalIdentity(
      proofPath,
      state.stageIntentProofIdentity,
      "Migration stage intent proof",
    ),
    requirePhysicalIdentity(
      authorityPath,
      state.stageIntentAuthorityIdentity,
      "Migration stage intent authority",
    ),
    requirePhysicalIdentity(
      authorityProofPath,
      state.stageIntentAuthorityIdentity,
      "Migration stage intent authority proof",
    ),
    requirePhysicalIdentity(state.stageRoot, state.stageIdentity, "Migration stage"),
  ]);
  const [intentSource, proofSource, authoritySource] = await Promise.all([
    readFile(intentPath, "utf8"),
    readFile(proofPath, "utf8"),
    readFile(authorityPath, "utf8"),
  ]);
  if (
    intentSource !== state.stageIntentSource
    || proofSource !== state.stageIntentSource
    || authoritySource !== state.stageIntentSource
    || !(await samePhysicalFile(authorityPath, authorityProofPath))
  ) {
    throw fail("Migration stage intent changed after authentication.", "CONCURRENT_CHANGE");
  }
}

async function createStageReservation(workspaceRoot, legacyUserRoot) {
  const suffix = `${process.pid}-${randomUUID()}`;
  const reservationRoot = join(workspaceRoot, `${STAGE_RESERVATION_PREFIX}${suffix}`);
  const stageRoot = join(workspaceRoot, `${STAGING_PREFIX}${suffix}`);
  await mkdir(reservationRoot);
  const stageIdentity = await physicalPathIdentity(reservationRoot);
  const source = stageIntentSource(
    workspaceRoot,
    legacyUserRoot,
    stageRoot,
    stageIdentity,
  );
  const reservationIntentPath = stageIntentPath(reservationRoot);
  const reservationProofPath = stageIntentProofPath(reservationRoot);
  const authorityPath = stageIntentAuthorityPath(workspaceRoot, stageRoot);
  const authorityProofPath = stageIntentAuthorityProofPath(workspaceRoot, stageRoot);
  await writeDurableFileExclusive(reservationProofPath, source);
  await writeDurableFileExclusive(reservationIntentPath, source);
  await writeDurableFileExclusive(authorityPath, source);
  try {
    await link(authorityPath, authorityProofPath);
  } catch (error) {
    throw mutationCollision(error, authorityProofPath, "Migration stage intent authority proof");
  }
  const authorityIdentity = await physicalPathIdentity(authorityPath);
  if (!(await samePhysicalFile(authorityPath, authorityProofPath))) {
    throw fail("Migration stage intent authority proof changed.", "CONCURRENT_CHANGE");
  }
  if (await optionalPhysicalPathIdentity(stageRoot)) {
    throw fail(`Migration stage reservation collided: ${stageRoot}`, "CONCURRENT_CHANGE");
  }
  await rename(reservationRoot, stageRoot);
  const state = {
    workspaceRoot,
    legacyUserRoot,
    stageRoot,
    stageIdentity,
    stageIntentSource: source,
    stageIntentIdentity: await physicalPathIdentity(stageIntentPath(stageRoot)),
    stageIntentProofIdentity: await physicalPathIdentity(stageIntentProofPath(stageRoot)),
    stageIntentAuthorityIdentity: authorityIdentity,
  };
  await requireStageIntentObservation(state);
  return state;
}

async function readStageIntent(stageRoot, workspaceRoot, legacyUserRoot) {
  const intentPath = stageIntentPath(stageRoot);
  let source;
  try {
    source = await readFile(intentPath, "utf8");
  } catch (error) {
    throw invalidJournal(
      stageRoot,
      `The transaction has no authenticated stage intent: ${String(error?.message ?? error)}`,
    );
  }
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw invalidJournal(stageRoot, `The stage intent is invalid: ${String(error?.message ?? error)}`);
  }
  if (
    !hasExactKeys(value, [
      "version",
      "workspaceRoot",
      "legacyUserRoot",
      "stageRoot",
      "stageIdentity",
    ])
    || value.version !== STAGE_INTENT_VERSION
    || value.workspaceRoot !== workspaceRoot
    || value.legacyUserRoot !== legacyUserRoot
    || value.stageRoot !== stageRoot
  ) {
    throw invalidJournal(stageRoot, "The stage intent does not match this migration.");
  }
  assertProvenanceIdentity(value.stageIdentity, "stageIntent.stageIdentity", stageRoot, {
    kind: "directory",
  });
  const state = {
    workspaceRoot,
    legacyUserRoot,
    stageRoot,
    stageIdentity: value.stageIdentity,
    stageIntentSource: source,
    stageIntentIdentity: await physicalPathIdentity(intentPath),
    stageIntentProofIdentity: await physicalPathIdentity(stageIntentProofPath(stageRoot)),
    stageIntentAuthorityIdentity: await physicalPathIdentity(
      stageIntentAuthorityPath(workspaceRoot, stageRoot),
    ),
  };
  await requireStageIntentObservation(state);
  return state;
}

async function cleanupStageIntentAuthority(state) {
  if (await optionalPhysicalPathIdentity(state.stageRoot)) {
    await requireStageIntentObservation(state);
  }
  const authorityPath = stageIntentAuthorityPath(state.workspaceRoot, state.stageRoot);
  const authorityProofPath = stageIntentAuthorityProofPath(
    state.workspaceRoot,
    state.stageRoot,
  );
  await Promise.all([
    requirePhysicalIdentity(
      authorityPath,
      state.stageIntentAuthorityIdentity,
      "Migration stage intent authority",
    ),
    requirePhysicalIdentity(
      authorityProofPath,
      state.stageIntentAuthorityIdentity,
      "Migration stage intent authority proof",
    ),
  ]);
  if (
    await readFile(authorityPath, "utf8") !== state.stageIntentSource
    || await readFile(authorityProofPath, "utf8") !== state.stageIntentSource
    || !(await samePhysicalFile(authorityPath, authorityProofPath))
  ) {
    throw fail("Migration stage intent authority changed before cleanup.", "CONCURRENT_CHANGE");
  }
  await removeOwnedLeaf(
    authorityProofPath,
    state.stageIntentAuthorityIdentity,
    "Migration stage intent authority proof",
  );
  await removeOwnedLeaf(
    authorityPath,
    state.stageIntentAuthorityIdentity,
    "Migration stage intent authority",
  );
}

async function quarantineIncompleteStage(state) {
  await requireStageIntentObservation(state);
  const suffix = basename(state.stageRoot).slice(STAGING_PREFIX.length);
  const quarantine = join(
    state.workspaceRoot,
    `${INCOMPLETE_STAGE_PREFIX}${suffix}-${randomUUID()}`,
  );
  if (await optionalPhysicalPathIdentity(quarantine)) {
    throw fail(`Incomplete migration quarantine collided: ${quarantine}`, "CONCURRENT_CHANGE");
  }
  await rename(state.stageRoot, quarantine);
  await requirePhysicalIdentity(quarantine, state.stageIdentity, "Incomplete migration quarantine");
  const authorityPath = stageIntentAuthorityPath(state.workspaceRoot, state.stageRoot);
  const authorityProofPath = stageIntentAuthorityProofPath(
    state.workspaceRoot,
    state.stageRoot,
  );
  await removeOwnedLeaf(
    authorityProofPath,
    state.stageIntentAuthorityIdentity,
    "Migration stage intent authority proof",
  );
  await removeOwnedLeaf(
    authorityPath,
    state.stageIntentAuthorityIdentity,
    "Migration stage intent authority",
  );
  return quarantine;
}
function assertProvenanceIdentity(
  value,
  label,
  stageRoot,
  { nullable = false, kind = null } = {},
) {
  if (value === null && nullable) return;
  if (
    !hasExactKeys(value, ["device", "inode", "kind"])
    || typeof value.device !== "string"
    || !/^\d+$/.test(value.device)
    || typeof value.inode !== "string"
    || !/^\d+$/.test(value.inode)
    || !["file", "directory"].includes(value.kind)
    || (kind && value.kind !== kind)
  ) {
    throw invalidJournal(stageRoot, `${label} is not a valid physical identity.`);
  }
}

async function captureAuthenticatedPathIdentity(path, expected, label) {
  const before = await physicalPathIdentity(path);
  if (before.kind !== expected.kind) {
    throw fail(`${label} changed physical kind: ${path}`, "CONCURRENT_CHANGE");
  }
  await expect(path, expected, label);
  const after = await physicalPathIdentity(path);
  if (!samePhysicalIdentity(before, after)) {
    throw fail(`${label} changed physical identity: ${path}`, "CONCURRENT_CHANGE");
  }
  return before;
}
function serializeProvenanceTree(tree) {
  return {
    identity: tree.identity,
    children: tree.children === null
      ? null
      : [...tree.children].map(([name, child]) => ({
          name,
          tree: serializeProvenanceTree(child),
        })),
  };
}

async function captureBoundProvenanceTree(path, identity, label) {
  const tree = await capturePhysicalTree(path);
  if (!samePhysicalIdentity(tree.identity, identity)) {
    throw fail(`${label} changed while recursive provenance was captured: ${path}`, "CONCURRENT_CHANGE");
  }
  return serializeProvenanceTree(tree);
}
function parseProvenanceTree(value, label, stageRoot) {
  if (
    !hasExactKeys(value, ["identity", "children"])
    || !hasExactKeys(value.identity, ["device", "inode", "kind"])
    || typeof value.identity.device !== "string"
    || !/^\d+$/.test(value.identity.device)
    || typeof value.identity.inode !== "string"
    || !/^\d+$/.test(value.identity.inode)
    || !["file", "directory", "symlink", "opaque"].includes(value.identity.kind)
  ) {
    throw invalidJournal(stageRoot, `${label} is not valid recursive provenance.`);
  }
  if (value.identity.kind !== "directory") {
    if (value.children !== null) {
      throw invalidJournal(stageRoot, `${label} leaf provenance has children.`);
    }
    return { identity: value.identity, children: null };
  }
  if (!Array.isArray(value.children)) {
    throw invalidJournal(stageRoot, `${label} directory provenance has no children.`);
  }
  const children = new Map();
  for (const child of value.children) {
    if (
      !hasExactKeys(child, ["name", "tree"])
      || typeof child.name !== "string"
      || !child.name
      || basename(child.name) !== child.name
      || child.name === "."
      || child.name === ".."
      || children.has(child.name)
    ) {
      throw invalidJournal(stageRoot, `${label} has an invalid child.`);
    }
    children.set(
      child.name,
      parseProvenanceTree(child.tree, `${label}/${child.name}`, stageRoot),
    );
  }
  return { identity: value.identity, children };
}


async function createTransactionProvenance(state) {
  const publications = [];
  for (const record of state.publications) {
    const previousIdentity = record.previous
      ? await captureAuthenticatedPathIdentity(
          record.target,
          record.previous,
          "Migration destination provenance",
        )
      : null;
    const stagedIdentity = record.staged
      ? await captureAuthenticatedPathIdentity(
          record.staged,
          record.desired,
          "Staged migration publication provenance",
        )
      : null;
    publications.push({
      kind: record.kind,
      target: record.target,
      previous: record.previous,
      staged: record.staged,
      desired: record.desired,
      previousIdentity,
      stagedIdentity,
      previousTree: record.previous?.kind === "directory"
        ? await captureBoundProvenanceTree(
            record.target,
            previousIdentity,
            "Migration destination provenance",
          )
        : null,
      stagedTree: record.desired?.kind === "directory"
        ? await captureBoundProvenanceTree(
            record.staged,
            stagedIdentity,
            "Staged migration publication provenance",
          )
        : null,
    });
  }
  const destinationGuards = [];
  for (const record of state.destinationGuards) {
    const targetIdentity = await captureAuthenticatedPathIdentity(
      record.target,
      record.desired,
      "Preserved migration destination provenance",
    );
    const stagedIdentity = await captureAuthenticatedPathIdentity(
      record.staged,
      record.desired,
      "Staged preserved destination provenance",
    );
    destinationGuards.push({
      kind: record.kind,
      target: record.target,
      staged: record.staged,
      desired: record.desired,
      targetIdentity,
      stagedIdentity,
      targetTree: record.desired.kind === "directory"
        ? await captureBoundProvenanceTree(
            record.target,
            targetIdentity,
            "Preserved migration destination provenance",
          )
        : null,
      stagedTree: record.desired.kind === "directory"
        ? await captureBoundProvenanceTree(
            record.staged,
            stagedIdentity,
            "Staged preserved destination provenance",
          )
        : null,
    });
  }
  const retirements = [];
  for (const record of state.retirements) {
    const sourceIdentity = await captureAuthenticatedPathIdentity(
      record.path,
      record.expected,
      "Legacy retirement provenance",
    );
    retirements.push({
      kind: record.kind,
      path: record.path,
      expected: record.expected,
      sourceIdentity,
      sourceTree: record.expected.kind === "directory"
        ? await captureBoundProvenanceTree(
            record.path,
            sourceIdentity,
            "Legacy retirement provenance",
          )
        : null,
    });
  }
  return {
    version: PROVENANCE_VERSION,
    workspaceRoot: state.workspaceRoot,
    legacyUserRoot: state.legacyUserRoot,
    stageRoot: state.stageRoot,
    stageIdentity: await physicalPathIdentity(state.stageRoot),
    stagePayloadTree: serializeProvenanceTree(
      await capturePhysicalTree(join(state.stageRoot, "payload")),
    ),
    publications,
    destinationGuards,
    retirements,
  };
}

function transactionProvenancePath(stageRoot) {
  return join(stageRoot, PROVENANCE_NAME);
}
function transactionProvenanceProofPath(stageRoot) {
  return join(stageRoot, PROVENANCE_PROOF_NAME);
}
function transactionProvenanceAuthorityPath(workspaceRoot, stageRoot) {
  return join(
    workspaceRoot,
    `${PROVENANCE_AUTHORITY_PREFIX}${basename(stageRoot).slice(STAGING_PREFIX.length)}.json`,
  );
}
function transactionProvenanceAuthorityProofPath(workspaceRoot, stageRoot) {
  return `${transactionProvenanceAuthorityPath(workspaceRoot, stageRoot)}.proof`;
}
function transactionProvenanceAuthoritySource(stageRoot, stageIdentity, provenanceHash) {
  return `${JSON.stringify({
    version: PROVENANCE_AUTHORITY_VERSION,
    stageRoot,
    stageIdentity,
    provenanceHash,
  }, null, 2)}\n`;
}
async function requireTransactionProvenanceObservation(state) {
  if (
    !state.provenance
    || !state.provenanceSource
    || !state.provenanceIdentity
    || !state.provenanceProofIdentity
    || !state.provenanceAuthorityIdentity
  ) {
    return;
  }
  const provenanceHash = createHash("sha256").update(state.provenanceSource).digest("hex");
  const path = transactionProvenancePath(state.stageRoot);
  const proofPath = transactionProvenanceProofPath(state.stageRoot);
  const authorityPath = transactionProvenanceAuthorityPath(state.workspaceRoot, state.stageRoot);
  const authorityProofPath = transactionProvenanceAuthorityProofPath(
    state.workspaceRoot,
    state.stageRoot,
  );
  const expectedAuthoritySource = transactionProvenanceAuthoritySource(
    state.stageRoot,
    state.provenance.stageIdentity,
    provenanceHash,
  );
  await Promise.all([
    requirePhysicalIdentity(path, state.provenanceIdentity, "Transaction provenance"),
    requirePhysicalIdentity(proofPath, state.provenanceProofIdentity, "Transaction provenance proof"),
    requirePhysicalIdentity(
      authorityPath,
      state.provenanceAuthorityIdentity,
      "Transaction provenance authority",
    ),
  ]);
  const [pathSource, proofSource, authoritySource, authorityProofIdentity] = await Promise.all([
    readFile(path, "utf8"),
    readFile(proofPath, "utf8"),
    readFile(authorityPath, "utf8"),
    optionalPhysicalPathIdentity(authorityProofPath),
  ]);
  if (
    pathSource !== state.provenanceSource
    || proofSource !== state.provenanceSource
    || authoritySource !== expectedAuthoritySource
    || !samePhysicalIdentity(authorityProofIdentity, state.provenanceAuthorityIdentity)
    || !(await samePhysicalFile(authorityPath, authorityProofPath))
  ) {
    throw fail("Transaction provenance changed after authentication.", "CONCURRENT_CHANGE");
  }
}




async function persistTransactionProvenance(state) {
  const provenance = await createTransactionProvenance(state);
  const source = `${JSON.stringify(provenance, null, 2)}\n`;
  const path = transactionProvenancePath(state.stageRoot);
  const proofPath = transactionProvenanceProofPath(state.stageRoot);
  const provenanceHash = createHash("sha256").update(source).digest("hex");
  const authorityPath = transactionProvenanceAuthorityPath(state.workspaceRoot, state.stageRoot);
  const authorityProofPath = transactionProvenanceAuthorityProofPath(
    state.workspaceRoot,
    state.stageRoot,
  );
  const authoritySource = transactionProvenanceAuthoritySource(
    state.stageRoot,
    provenance.stageIdentity,
    provenanceHash,
  );
  await requireJournalContained(
    state.workspaceRoot,
    authorityPath,
    "transaction provenance authority",
    state.stageRoot,
  );
  await writeDurableFileExclusive(proofPath, source);
  await writeDurableFileExclusive(path, source);
  await writeDurableFileExclusive(authorityPath, authoritySource);
  try {
    await link(authorityPath, authorityProofPath);
  } catch (error) {
    throw mutationCollision(error, authorityProofPath, "Transaction provenance authority proof");
  }
  assertTransactionProvenance(
    journalValue(state),
    provenance,
    state.stageRoot,
    state.workspaceRoot,
    state.legacyUserRoot,
  );
  state.provenance = provenance;
  state.provenanceSource = source;
  state.provenanceIdentity = await physicalPathIdentity(path);
  state.provenanceProofIdentity = await physicalPathIdentity(proofPath);
  state.provenanceAuthorityIdentity = await physicalPathIdentity(authorityPath);
}

function assertTransactionProvenance(journal, provenance, stageRoot, workspaceRoot, legacyUserRoot) {
  if (
    !hasExactKeys(provenance, [
      "version",
      "workspaceRoot",
      "legacyUserRoot",
      "stageRoot",
      "stageIdentity",
      "stagePayloadTree",
      "publications",
      "destinationGuards",
      "retirements",
    ])
    || provenance.version !== PROVENANCE_VERSION
    || provenance.workspaceRoot !== workspaceRoot
    || provenance.legacyUserRoot !== legacyUserRoot
    || provenance.stageRoot !== stageRoot
    || !Array.isArray(provenance.publications)
    || !Array.isArray(provenance.destinationGuards)
    || !Array.isArray(provenance.retirements)
  ) {
    throw invalidJournal(stageRoot, "The transaction provenance shape is invalid.");
  }
  assertProvenanceIdentity(provenance.stageIdentity, "provenance.stageIdentity", stageRoot, {
    kind: "directory",
  });
  provenance.stagePayloadTree = parseProvenanceTree(
    provenance.stagePayloadTree,
    "provenance.stagePayloadTree",
    stageRoot,
  );
  if (provenance.stagePayloadTree.identity.kind !== "directory") {
    throw invalidJournal(stageRoot, "The staged payload provenance is not a directory.");
  }

  for (const [index, record] of provenance.publications.entries()) {
    if (!hasExactKeys(record, [
      "kind",
      "target",
      "previous",
      "staged",
      "desired",
      "previousIdentity",
      "stagedIdentity",
      "previousTree",
      "stagedTree",
    ])) {
      throw invalidJournal(stageRoot, `provenance.publications[${index}] is invalid.`);
    }
    assertProvenanceIdentity(
      record.previousIdentity,
      `provenance.publications[${index}].previousIdentity`,
      stageRoot,
      { nullable: true, kind: record.previous?.kind ?? null },
    );
    assertProvenanceIdentity(
      record.stagedIdentity,
      `provenance.publications[${index}].stagedIdentity`,
      stageRoot,
      { nullable: true, kind: record.desired?.kind ?? null },
    );
    if (
      (record.previous === null) !== (record.previousIdentity === null)
      || (record.staged === null) !== (record.stagedIdentity === null)
    ) {
      throw invalidJournal(stageRoot, `provenance.publications[${index}] has incomplete identity evidence.`);
    }
    if ((record.previous?.kind === "directory") !== (record.previousTree !== null)) {
      throw invalidJournal(stageRoot, `provenance.publications[${index}].previousTree is incomplete.`);
    }
    if ((record.desired?.kind === "directory") !== (record.stagedTree !== null)) {
      throw invalidJournal(stageRoot, `provenance.publications[${index}].stagedTree is incomplete.`);
    }
    if (record.previousTree) {
      record.previousTree = parseProvenanceTree(
        record.previousTree,
        `provenance.publications[${index}].previousTree`,
        stageRoot,
      );
      if (!samePhysicalIdentity(record.previousTree.identity, record.previousIdentity)) {
        throw invalidJournal(stageRoot, `provenance.publications[${index}].previousTree is unbound.`);
      }
    }
    if (record.stagedTree) {
      record.stagedTree = parseProvenanceTree(
        record.stagedTree,
        `provenance.publications[${index}].stagedTree`,
        stageRoot,
      );
      if (!samePhysicalIdentity(record.stagedTree.identity, record.stagedIdentity)) {
        throw invalidJournal(stageRoot, `provenance.publications[${index}].stagedTree is unbound.`);
      }
    }
  }
  for (const [index, record] of provenance.destinationGuards.entries()) {
    if (!hasExactKeys(record, [
      "kind",
      "target",
      "staged",
      "desired",
      "targetIdentity",
      "stagedIdentity",
      "targetTree",
      "stagedTree",
    ])) {
      throw invalidJournal(stageRoot, `provenance.destinationGuards[${index}] is invalid.`);
    }
    assertProvenanceIdentity(
      record.targetIdentity,
      `provenance.destinationGuards[${index}].targetIdentity`,
      stageRoot,
      { kind: record.desired?.kind ?? null },
    );
    assertProvenanceIdentity(
      record.stagedIdentity,
      `provenance.destinationGuards[${index}].stagedIdentity`,
      stageRoot,
      { kind: record.desired?.kind ?? null },
    );
    if ((record.desired?.kind === "directory") !== (record.targetTree !== null)) {
      throw invalidJournal(stageRoot, `provenance.destinationGuards[${index}].targetTree is incomplete.`);
    }
    if ((record.desired?.kind === "directory") !== (record.stagedTree !== null)) {
      throw invalidJournal(stageRoot, `provenance.destinationGuards[${index}].stagedTree is incomplete.`);
    }
    if (record.targetTree) {
      record.targetTree = parseProvenanceTree(
        record.targetTree,
        `provenance.destinationGuards[${index}].targetTree`,
        stageRoot,
      );
      if (!samePhysicalIdentity(record.targetTree.identity, record.targetIdentity)) {
        throw invalidJournal(stageRoot, `provenance.destinationGuards[${index}].targetTree is unbound.`);
      }
    }
    if (record.stagedTree) {
      record.stagedTree = parseProvenanceTree(
        record.stagedTree,
        `provenance.destinationGuards[${index}].stagedTree`,
        stageRoot,
      );
      if (!samePhysicalIdentity(record.stagedTree.identity, record.stagedIdentity)) {
        throw invalidJournal(stageRoot, `provenance.destinationGuards[${index}].stagedTree is unbound.`);
      }
    }
  }
  for (const [index, record] of provenance.retirements.entries()) {
    if (!hasExactKeys(record, ["kind", "path", "expected", "sourceIdentity", "sourceTree"])) {
      throw invalidJournal(stageRoot, `provenance.retirements[${index}] is invalid.`);
    }
    assertProvenanceIdentity(
      record.sourceIdentity,
      `provenance.retirements[${index}].sourceIdentity`,
      stageRoot,
      { kind: record.expected?.kind ?? null },
    );
    if ((record.expected?.kind === "directory") !== (record.sourceTree !== null)) {
      throw invalidJournal(stageRoot, `provenance.retirements[${index}].sourceTree is incomplete.`);
    }
    if (record.sourceTree) {
      record.sourceTree = parseProvenanceTree(
        record.sourceTree,
        `provenance.retirements[${index}].sourceTree`,
        stageRoot,
      );
      if (!samePhysicalIdentity(record.sourceTree.identity, record.sourceIdentity)) {
        throw invalidJournal(stageRoot, `provenance.retirements[${index}].sourceTree is unbound.`);
      }
    }
  }

  const immutablePublications = journal.publications.map((record) => ({
    kind: record.kind,
    target: record.target,
    previous: record.previous,
    staged: record.staged,
    desired: record.desired,
  }));
  const provenPublications = provenance.publications.map((record) => ({
    kind: record.kind,
    target: record.target,
    previous: record.previous,
    staged: record.staged,
    desired: record.desired,
  }));
  const immutableGuards = journal.destinationGuards.map((record) => ({
    kind: record.kind,
    target: record.target,
    staged: record.staged,
    desired: record.desired,
  }));
  const provenGuards = provenance.destinationGuards.map((record) => ({
    kind: record.kind,
    target: record.target,
    staged: record.staged,
    desired: record.desired,
  }));
  const immutableRetirements = journal.retirements.map((record) => ({
    kind: record.kind,
    path: record.path,
    expected: record.expected,
  }));
  const provenRetirements = provenance.retirements.map((record) => ({
    kind: record.kind,
    path: record.path,
    expected: record.expected,
  }));
  if (
    !isDeepStrictEqual(immutablePublications, provenPublications)
    || !isDeepStrictEqual(immutableGuards, provenGuards)
    || !isDeepStrictEqual(immutableRetirements, provenRetirements)
  ) {
    throw invalidJournal(stageRoot, "The journal records do not match transaction-created provenance.");
  }
}

async function readTransactionProvenance(journal, stageRoot, workspaceRoot, legacyUserRoot) {
  const path = transactionProvenancePath(stageRoot);
  const proofPath = transactionProvenanceProofPath(stageRoot);
  const authorityPath = transactionProvenanceAuthorityPath(workspaceRoot, stageRoot);
  const authorityProofPath = transactionProvenanceAuthorityProofPath(workspaceRoot, stageRoot);
  await Promise.all([
    requireJournalContained(stageRoot, path, "transaction provenance", stageRoot),
    requireJournalContained(stageRoot, proofPath, "transaction provenance proof", stageRoot),
    requireJournalContained(
      workspaceRoot,
      authorityPath,
      "transaction provenance authority",
      stageRoot,
    ),
    requireJournalContained(
      workspaceRoot,
      authorityProofPath,
      "transaction provenance authority proof",
      stageRoot,
    ),
  ]);
  const [identity, proofIdentity, authorityIdentity, authorityProofIdentity] = await Promise.all([
    optionalPhysicalPathIdentity(path),
    optionalPhysicalPathIdentity(proofPath),
    optionalPhysicalPathIdentity(authorityPath),
    optionalPhysicalPathIdentity(authorityProofPath),
  ]);
  if (
    !identity
    || identity.kind !== "file"
    || !proofIdentity
    || proofIdentity.kind !== "file"
    || samePhysicalIdentity(identity, proofIdentity)
    || !authorityIdentity
    || authorityIdentity.kind !== "file"
    || !samePhysicalIdentity(authorityIdentity, authorityProofIdentity)
    || !(await samePhysicalFile(authorityPath, authorityProofPath))
  ) {
    throw invalidJournal(stageRoot, "The transaction provenance lacks independent creation evidence.");
  }
  let provenance;
  let source;
  try {
    const [currentSource, proofSource, authoritySource] = await Promise.all([
      readFile(path, "utf8"),
      readFile(proofPath, "utf8"),
      readFile(authorityPath, "utf8"),
    ]);
    if (currentSource !== proofSource) {
      throw new Error("the creation proof bytes differ");
    }
    provenance = JSON.parse(currentSource);
    const provenanceHash = createHash("sha256").update(currentSource).digest("hex");
    const expectedAuthoritySource = transactionProvenanceAuthoritySource(
      stageRoot,
      provenance.stageIdentity,
      provenanceHash,
    );
    if (authoritySource !== expectedAuthoritySource) {
      throw new Error("the workspace transaction authority does not match the provenance bytes");
    }
    source = currentSource;
  } catch (error) {
    throw invalidJournal(
      stageRoot,
      `The transaction provenance cannot be authenticated: ${String(error?.message ?? error)}`,
    );
  }
  assertTransactionProvenance(journal, provenance, stageRoot, workspaceRoot, legacyUserRoot);
  if (!samePhysicalIdentity(await physicalPathIdentity(stageRoot), provenance.stageIdentity)) {
    throw invalidJournal(stageRoot, "The transaction root does not match its creation identity.");
  }
  return {
    provenance,
    provenanceSource: source,
    provenanceIdentity: identity,
    provenanceProofIdentity: proofIdentity,
    provenanceAuthorityIdentity: authorityIdentity,
  };
}

function provenanceIdentityEvidencePath(state, category, index) {
  return join(
    state.stageRoot,
    PROVENANCE_EVIDENCE_DIRECTORY,
    category,
    `${String(index).padStart(6, "0")}.json`,
  );
}

function provenanceIdentityEvidenceProofPath(state, category, index) {
  return `${provenanceIdentityEvidencePath(state, category, index)}.proof`;
}

async function writeProvenanceIdentityEvidence(state, category, index, path) {
  const identity = await physicalPathIdentity(path);
  const evidencePath = provenanceIdentityEvidencePath(state, category, index);
  await requireJournalContained(state.stageRoot, evidencePath, "provenance evidence", state.stageRoot);
  await writeDurableFileExclusive(
    evidencePath,
    `${JSON.stringify({
      version: PROVENANCE_VERSION,
      path: resolve(path),
      identity,
    }, null, 2)}\n`,
  );
  const proofPath = provenanceIdentityEvidenceProofPath(state, category, index);
  try {
    await link(evidencePath, proofPath);
  } catch (error) {
    throw mutationCollision(error, proofPath, "Provenance evidence proof");
  }
  if (!(await samePhysicalFile(evidencePath, proofPath))) {
    throw fail(`Provenance evidence proof changed: ${proofPath}`, "CONCURRENT_CHANGE");
  }
  return identity;
}

async function readProvenanceIdentityEvidence(state, category, index, expectedPath) {
  const evidencePath = provenanceIdentityEvidencePath(state, category, index);
  await requireJournalContained(state.stageRoot, evidencePath, "provenance evidence", state.stageRoot);
  const proofPath = provenanceIdentityEvidenceProofPath(state, category, index);
  const evidenceIdentity = await optionalPhysicalPathIdentity(evidencePath);
  if (!evidenceIdentity) return null;
  if (evidenceIdentity.kind !== "file") {
    throw invalidJournal(state.stageRoot, `Provenance evidence is not a regular file: ${evidencePath}`);
  }
  if (!(await samePhysicalFile(evidencePath, proofPath))) {
    throw invalidJournal(state.stageRoot, `Provenance evidence proof is unowned: ${proofPath}`);
  }
  let evidence;
  try {
    evidence = await readJson(evidencePath);
  } catch (error) {
    throw invalidJournal(
      state.stageRoot,
      `Provenance evidence cannot be read: ${String(error?.message ?? error)}`,
    );
  }
  if (
    !hasExactKeys(evidence, ["version", "path", "identity"])
    || evidence.version !== PROVENANCE_VERSION
    || evidence.path !== resolve(expectedPath)
  ) {
    throw invalidJournal(state.stageRoot, `Provenance evidence does not match ${expectedPath}.`);
  }
  assertProvenanceIdentity(evidence.identity, "provenance evidence identity", state.stageRoot);
  return evidence.identity;
}
async function requireProvenancePathIdentity(state, path, expected, label) {
  const actual = await optionalPhysicalPathIdentity(path);
  if (!samePhysicalIdentity(actual, expected)) {
    throw invalidJournal(state.stageRoot, `${label} lacks transaction-created physical provenance.`);
  }
  return actual;
}
async function requireTransferProvenanceDirectory(
  path,
  identity,
  evidenceRoot,
  evidenceKind,
  label,
) {
  await requirePhysicalIdentity(path, identity, label);
  const evidence = await readTransferEntryEvidence(evidenceRoot);
  const currentNames = (await readdir(path)).sort((left, right) => left.localeCompare(right));
  const ownedNames = [...evidence.keys()].sort((left, right) => left.localeCompare(right));
  if (!isDeepStrictEqual(currentNames, ownedNames)) {
    throw fail(`${label} contains entries without transaction provenance: ${path}`, "CONCURRENT_CHANGE");
  }
  for (const name of ownedNames) {
    const ownership = evidence.get(name)?.[evidenceKind];
    if (!ownership) {
      throw fail(`${label} lacks recursive transaction provenance: ${join(path, name)}`, "CONCURRENT_CHANGE");
    }
    await requireTransferOwnedTree(
      join(path, name),
      ownership.node,
      ownership.proofRoot,
      label,
    );
  }
  await requirePhysicalIdentity(path, identity, label);
}
async function requireStagedProvenanceTree(state, path, captured, label) {
  try {
    await requireCapturedTree(path, captured, label);
  } catch (error) {
    throw invalidJournal(
      state.stageRoot,
      `${label} changed after staging: ${String(error?.message ?? error)}`,
    );
  }
}



async function publicationTargetIsProven(state, record, index) {
  if (record.desired?.kind === "file") {
    if (await samePhysicalFile(record.target, record.staged)) return true;
    const transferPath = publicationFileTransferPath(state, record, index);
    const identity = await readProvenanceIdentityEvidence(
      state,
      "publication-target-transfer",
      index,
      transferPath,
    );
    if (!identity) return false;
    return (
      samePhysicalIdentity(
        await optionalPhysicalPathIdentity(record.target),
        identity,
      )
      && sameSnapshot(await snapshot(record.target), record.desired)
    );
  }
  if (record.desired?.kind !== "directory") return false;
  const identity = await readProvenanceIdentityEvidence(
    state,
    "publication-target",
    index,
    record.target,
  );
  if (!identity) return false;
  const actual = await optionalPhysicalPathIdentity(record.target);
  if (!samePhysicalIdentity(actual, identity)) return false;
  if (
    record.reservation
    && (
      record.reservation.device !== identity.device
      || record.reservation.inode !== identity.inode
    )
  ) {
    return false;
  }
  await requireTransferProvenanceDirectory(
    record.target,
    identity,
    transferEvidenceRoot(state, "publication", index),
    "destination",
    `publications[${index}] target`,
  );
  return true;
}

async function publicationRestoreTargetIsProven(state, record, index) {
  if (await samePhysicalFile(record.backup, record.target)) return true;
  const transferPath = publicationFileTransferPath(state, record, index, "restore");
  const identity = await readProvenanceIdentityEvidence(
    state,
    "publication-restore-transfer",
    index,
    transferPath,
  );
  return Boolean(
    identity
    && samePhysicalIdentity(
      await optionalPhysicalPathIdentity(record.target),
      identity,
    )
    && sameSnapshot(await snapshot(record.target), record.previous),
  );
}

async function assertPublicationRecoveryProvenance(state, record, authority, index) {
  if (record.staged) {
    await requireProvenancePathIdentity(
      state,
      record.staged,
      authority.stagedIdentity,
      `publications[${index}].staged`,
    );
    if (authority.stagedTree) {
      await requireStagedProvenanceTree(
        state,
        record.staged,
        authority.stagedTree,
        `publications[${index}].staged`,
      );
    }
    if (!sameSnapshot(await snapshot(record.staged), record.desired)) {
      throw invalidJournal(state.stageRoot, `publications[${index}].staged changed after staging.`);
    }
  }

  let current = await snapshot(record.target);
  if (record.rollbackState === "remove-intent") {
    if (
      current
      && (
        !sameSnapshot(current, record.desired)
        || !samePhysicalIdentity(
          await optionalPhysicalPathIdentity(record.target),
          record.rollbackRemovalIdentity,
        )
        || !(await publicationTargetIsProven(state, record, index))
      )
    ) {
      throw invalidJournal(state.stageRoot, `publications[${index}] rollback removal target changed.`);
    }
  } else if (record.rollbackState === "removed") {
    if (current !== null) {
      throw invalidJournal(state.stageRoot, `publications[${index}] removed rollback target reappeared.`);
    }
  } else if (record.rollbackState === "restore-intent") {
    if (current) {
      if (!sameSnapshot(current, record.previous)) {
        if (
          record.previous?.kind !== "directory"
          || !record.rollbackRestoreIdentity
        ) {
          throw invalidJournal(state.stageRoot, `publications[${index}] partial restoration is unowned.`);
        }
        await requireTransferOwnedDirectorySubset(
          record.backup,
          record.target,
          record.rollbackRestoreIdentity,
          `publications[${index}] partial restoration`,
          transferEvidenceRoot(state, "restore", index),
        );
      } else if (record.previous.kind === "file") {
        if (!(await publicationRestoreTargetIsProven(state, record, index))) {
          throw invalidJournal(state.stageRoot, `publications[${index}] file restoration is unowned.`);
        }
      } else {
        if (!record.rollbackRestoreIdentity) {
          throw invalidJournal(state.stageRoot, `publications[${index}] directory restoration lacks identity.`);
        }
        await requireTransferProvenanceDirectory(
          record.target,
          record.rollbackRestoreIdentity,
          transferEvidenceRoot(state, "restore", index),
          "destination",
          `publications[${index}] restored target`,
        );
      }
    }
  } else if (record.rollbackState === "restored") {
    if (
      !sameSnapshot(current, record.previous)
      || !samePhysicalIdentity(
        await optionalPhysicalPathIdentity(record.target),
        record.rollbackRestoreIdentity,
      )
    ) {
      throw invalidJournal(state.stageRoot, `publications[${index}] restored target changed.`);
    }
    if (
      current
      && record.rollbackRemovalIdentity
      && record.previous.kind === "file"
      && !(await publicationRestoreTargetIsProven(state, record, index))
    ) {
      throw invalidJournal(state.stageRoot, `publications[${index}] restored file is unowned.`);
    }
    if (current && record.rollbackRemovalIdentity && record.previous.kind === "directory") {
      await requireTransferProvenanceDirectory(
        record.target,
        record.rollbackRestoreIdentity,
        transferEvidenceRoot(state, "restore", index),
        "destination",
        `publications[${index}] restored target`,
      );
    }
  } else if (record.state === "pending") {
    if (!sameSnapshot(current, record.previous)) {
      throw invalidJournal(state.stageRoot, `publications[${index}].target changed while pending.`);
    }
    if (record.previous) {
      await requireProvenancePathIdentity(
        state,
        record.target,
        authority.previousIdentity,
        `publications[${index}].target`,
      );
      if (authority.previousTree) {
        await requireCapturedTree(
          record.target,
          authority.previousTree,
          `publications[${index}].target`,
        );
      }
    }
  } else if (record.state === "backup-intent") {
    if (current) {
      if (!sameSnapshot(current, record.previous)) {
        if (
          record.previous.kind !== "directory"
          || !sameSnapshot(await snapshot(record.backup), record.previous)
        ) {
          throw invalidJournal(state.stageRoot, `publications[${index}].target changed during backup.`);
        }
        await requireProvenancePathIdentity(
          state,
          record.target,
          authority.previousIdentity,
          `publications[${index}].target`,
        );
        await requireTransferOwnedDirectorySubset(
          record.backup,
          record.target,
          authority.previousIdentity,
          `publications[${index}] partial backup removal`,
          transferEvidenceRoot(state, "backup", index),
          "source",
        );
        current = null;
      }
      await requireProvenancePathIdentity(
        state,
        record.target,
        authority.previousIdentity,
        `publications[${index}].target`,
      );
      if (authority.previousTree && current) {
        await requireCapturedTree(
          record.target,
          authority.previousTree,
          `publications[${index}].target`,
        );
      }
    }
  } else if (record.state === "backed-up") {
    if (current !== null) {
      throw invalidJournal(state.stageRoot, `publications[${index}].target reappeared after backup.`);
    }
  } else if (record.state === "publish-intent") {
    if (current && !(await publicationTargetIsProven(state, record, index))) {
      throw invalidJournal(
        state.stageRoot,
        `publications[${index}].target is not a transaction-created publication.`,
      );
    }
    if (record.desired === null && current !== null) {
      throw invalidJournal(state.stageRoot, `publications[${index}].removal target reappeared.`);
    }
  } else if (record.state === "published") {
    if (!sameSnapshot(current, record.desired)) {
      throw invalidJournal(state.stageRoot, `publications[${index}].published target changed.`);
    }
    if (current && !(await publicationTargetIsProven(state, record, index))) {
      throw invalidJournal(
        state.stageRoot,
        `publications[${index}].published target is not transaction-created.`,
      );
    }
  }

  if (record.previous && record.backup) {
    const backup = await snapshot(record.backup);
    if (record.previous.kind === "file") {
      const transferPath = publicationBackupTransferPath(record);
      const transferIdentity = await readProvenanceIdentityEvidence(
        state,
        "publication-backup-transfer",
        index,
        transferPath,
      );
      for (const path of [record.backup, transferPath]) {
        const actualIdentity = await optionalPhysicalPathIdentity(path);
        if (!actualIdentity) continue;
        const authenticated = (
          samePhysicalIdentity(actualIdentity, authority.previousIdentity)
          || (
            transferIdentity
            && samePhysicalIdentity(actualIdentity, transferIdentity)
          )
        );
        const recoverableIncompleteCopy = (
          !authenticated
          && path === transferPath
          && record.state === "backup-intent"
          && sameSnapshot(current, record.previous)
          && await isOwnedPublicationBackupTransfer(record)
        );
        if (!authenticated && !recoverableIncompleteCopy) {
          throw invalidJournal(
            state.stageRoot,
            `publications[${index}] file backup lacks physical provenance.`,
          );
        }
        if (!sameSnapshot(await snapshot(path), record.previous)) {
          throw invalidJournal(state.stageRoot, `publications[${index}] file backup changed.`);
        }
      }
      if (
        transferIdentity
        && !samePhysicalIdentity(transferIdentity, authority.previousIdentity)
      ) {
        const evidenceRoot = transferEvidenceRoot(state, "backup", index);
        if (
          record.state !== "backup-intent"
          || current === null
          || await optionalPhysicalPathIdentity(transferSourceWitnessRecordPath(evidenceRoot))
        ) {
          await requireFileSourceWitnessMatchesProvenance(
            evidenceRoot,
            dirname(record.target),
            record.target,
            authority.previousIdentity,
            `publications[${index}].target`,
          );
        }
      }
    }
    else if (backup) {
      const evidenceRoot = transferEvidenceRoot(state, "backup", index);
      if (
        record.state !== "backup-intent"
        || await optionalPhysicalPathIdentity(transferSourceWitnessRecordPath(evidenceRoot))
      ) {
        await requireSourceWitnessMatchesProvenance(
          evidenceRoot,
          record.target,
          authority.previousTree,
          `publications[${index}] backup source`,
        );
      }
      const identity = await readProvenanceIdentityEvidence(
        state,
        "publication-backup",
        index,
        record.backup,
      );
      if (!identity) {
        throw invalidJournal(state.stageRoot, `publications[${index}] directory backup lacks provenance.`);
      }
      await requireProvenancePathIdentity(
        state,
        record.backup,
        identity,
        `publications[${index}] directory backup`,
      );
      await requireTransferProvenanceDirectory(
        record.backup,
        identity,
        evidenceRoot,
        "destination",
        `publications[${index}] directory backup`,
      );
      if (
        record.state !== "backup-intent"
        && !sameSnapshot(backup, record.previous)
      ) {
        throw invalidJournal(state.stageRoot, `publications[${index}] directory backup changed.`);
      }
    }
  }

}

async function assertDestinationGuardProvenance(state, record, authority, index) {
  await requireProvenancePathIdentity(
    state,
    record.staged,
    authority.stagedIdentity,
    `destinationGuards[${index}].staged`,
  );
  if (authority.stagedTree) {
    await requireStagedProvenanceTree(
      state,
      record.staged,
      authority.stagedTree,
      `destinationGuards[${index}].staged`,
    );
  }
  const targetIdentity = await optionalPhysicalPathIdentity(record.target);
  if (!samePhysicalIdentity(targetIdentity, authority.targetIdentity)) {
    throw fail(
      `Preserved migration destination changed physical identity: ${record.target}`,
      "CONCURRENT_CHANGE",
    );
  }
  if (authority.targetTree) {
    await requireCapturedTree(
      record.target,
      authority.targetTree,
      `destinationGuards[${index}].target`,
    );
  }
  if (!sameSnapshot(await snapshot(record.staged), record.desired)) {
    throw invalidJournal(state.stageRoot, `destinationGuards[${index}].staged changed after staging.`);
  }
  if (!sameSnapshot(await snapshot(record.target), record.desired)) {
    throw fail(`Preserved migration destination changed: ${record.target}`, "CONCURRENT_CHANGE");
  }
}

async function retirementPayloadIdentity(state, record, index) {
  if (record.expected.kind === "directory") {
    if (!record.retired) return null;
    return readProvenanceIdentityEvidence(
      state,
      "retirement-reservation",
      index,
      record.retired,
    );
  }
  const transferPath = record.retired ? retirementTransferPath(record) : null;
  if (!transferPath) return null;
  return readProvenanceIdentityEvidence(
    state,
    "retirement-payload",
    index,
    transferPath,
  );
}

async function assertRetirementRecoveryProvenance(state, record, authority, index) {
  const source = await snapshot(record.path);
  if (record.state === "pending") {
    if (!source || !sameSnapshot(source, record.expected)) {
      throw invalidJournal(state.stageRoot, `retirements[${index}].pending source changed.`);
    }
    await requireProvenancePathIdentity(
      state,
      record.path,
      authority.sourceIdentity,
      `retirements[${index}].path`,
    );
    if (authority.sourceTree) {
      await requireCapturedTree(
        record.path,
        authority.sourceTree,
        `retirements[${index}].path`,
      );
    }
    return;
  }

  const payloadIdentity = await retirementPayloadIdentity(state, record, index);
  const transferPath = record.expected.kind === "file"
    ? retirementTransferPath(record)
    : null;
  const candidates = record.expected.kind === "file"
    ? [transferPath, record.retired]
    : [record.retired];
  let authenticatedPayload = false;
  for (const path of candidates) {
    if (!path || !(await optionalPhysicalPathIdentity(path))) continue;
    if (!payloadIdentity) {
      const recoverableIncompleteFileCopy = (
        record.expected.kind === "file"
        && record.state === "retire-intent"
        && path === transferPath
        && source
        && sameSnapshot(source, record.expected)
        && sameSnapshot(await snapshot(path), record.expected)
        && await isOwnedRetirementPayload(record)
      );
      if (recoverableIncompleteFileCopy) continue;
      throw invalidJournal(state.stageRoot, `retirements[${index}] payload lacks provenance.`);
    }
    await requireProvenancePathIdentity(
      state,
      path,
      payloadIdentity,
      `retirements[${index}] payload`,
    );
    if (record.expected.kind === "directory") {
      await requireTransferProvenanceDirectory(
        path,
        payloadIdentity,
        transferEvidenceRoot(state, "retirement", index),
        "destination",
        `retirements[${index}] payload`,
      );
    }
    const payload = await snapshot(path);
    if (
      record.state === "retired"
      && !sameSnapshot(payload, record.expected)
    ) {
      throw invalidJournal(state.stageRoot, `retirements[${index}] completed payload changed.`);
    }
    authenticatedPayload = true;
  }

  if (
    record.expected.kind === "file"
    && payloadIdentity
    && !samePhysicalIdentity(payloadIdentity, authority.sourceIdentity)
  ) {
    const evidenceRoot = transferEvidenceRoot(state, "retirement", index);
    if (
      record.state !== "retire-intent"
      || !sameSnapshot(source, record.expected)
      || await optionalPhysicalPathIdentity(transferSourceWitnessRecordPath(evidenceRoot))
    ) {
      await requireFileSourceWitnessMatchesProvenance(
        evidenceRoot,
        dirname(record.path),
        record.path,
        authority.sourceIdentity,
        `retirements[${index}].path`,
      );
    }
  }
  if (record.expected.kind === "directory") {
    const evidenceRoot = transferEvidenceRoot(state, "retirement", index);
    if (
      record.state === "retired"
      || await optionalPhysicalPathIdentity(transferSourceWitnessRecordPath(evidenceRoot))
    ) {
      await requireSourceWitnessMatchesProvenance(
        evidenceRoot,
        record.path,
        authority.sourceTree,
        `retirements[${index}] source`,
      );
    }
  }

  if (source) {
    if (sameSnapshot(source, record.expected)) {
      await requireProvenancePathIdentity(
        state,
        record.path,
        authority.sourceIdentity,
        `retirements[${index}].path`,
      );
      if (authority.sourceTree) {
        await requireCapturedTree(
          record.path,
          authority.sourceTree,
          `retirements[${index}].path`,
        );
      }
    } else if (
      record.expected.kind === "directory"
      && record.state === "retire-intent"
      && authenticatedPayload
    ) {
      await requireProvenancePathIdentity(
        state,
        record.path,
        authority.sourceIdentity,
        `retirements[${index}].path`,
      );
      await requireTransferOwnedDirectorySubset(
        record.retired,
        record.path,
        authority.sourceIdentity,
        `retirements[${index}].path`,
        transferEvidenceRoot(state, "retirement", index),
        "source",
      );
    } else {
      throw invalidJournal(state.stageRoot, `retirements[${index}].path changed.`);
    }
  }
  if (record.state === "retired" && (!authenticatedPayload || source)) {
    throw invalidJournal(state.stageRoot, `retirements[${index}] is not durably retired.`);
  }
  if (record.state === "retire-intent" && !source && !authenticatedPayload) {
    throw invalidJournal(state.stageRoot, `retirements[${index}] has no recoverable owned copy.`);
  }
}
async function requireRetirementSourceAtMutation(
  state,
  record,
  index,
  { complete = true } = {},
) {
  const authority = state.provenance?.retirements?.[index];
  if (!authority) {
    throw fail(`Retirement authority is missing: ${record.path}`, "MUTATION_RECOVERY_FAILED");
  }
  const actual = await optionalPhysicalPathIdentity(record.path);
  if (!samePhysicalIdentity(actual, authority.sourceIdentity)) {
    throw fail(`Legacy migration source changed physical identity: ${record.path}`, "CONCURRENT_CHANGE");
  }
  if (complete && authority.sourceTree) {
    await requireCapturedTree(
      record.path,
      authority.sourceTree,
      "Legacy migration source",
    );
  }
  return actual;
}


async function readAuthenticatedRetirementFile(state, record, authority, index, label) {
  const candidates = [{
    path: record.path,
    identity: authority.sourceIdentity,
  }];
  const payloadIdentity = await retirementPayloadIdentity(state, record, index);
  if (record.retired && payloadIdentity) {
    candidates.push(
      { path: retirementTransferPath(record), identity: payloadIdentity },
      { path: record.retired, identity: payloadIdentity },
    );
  }
  const sources = [];
  for (const candidate of candidates) {
    const actual = await optionalPhysicalPathIdentity(candidate.path);
    if (!samePhysicalIdentity(actual, candidate.identity)) continue;
    if (!sameSnapshot(await snapshot(candidate.path), record.expected)) continue;
    sources.push(await readFile(candidate.path, "utf8"));
  }
  if (sources.length === 0 || sources.some((source) => source !== sources[0])) {
    throw invalidJournal(state.stageRoot, `${label} does not match authenticated retirement bytes.`);
  }
  return sources[0];
}

async function authenticatedRetirementDirectoryMatchesHash(
  state,
  record,
  authority,
  index,
  expectedHash,
) {
  const candidates = [{
    path: record.path,
    identity: authority.sourceIdentity,
  }];
  const payloadIdentity = await retirementPayloadIdentity(state, record, index);
  if (record.retired && payloadIdentity) {
    candidates.push(
      { path: retirementTransferPath(record), identity: payloadIdentity },
      { path: record.retired, identity: payloadIdentity },
    );
  }
  for (const candidate of candidates) {
    const actual = await optionalPhysicalPathIdentity(candidate.path);
    if (!samePhysicalIdentity(actual, candidate.identity)) continue;
    const observed = await snapshot(candidate.path);
    if (
      sameSnapshot(observed, record.expected)
      && snapshotMatchesDirectoryHash(observed, expectedHash)
    ) {
      return true;
    }
  }
  return false;
}

async function assertAuthenticatedLegacyLockOwnership(state) {
  const lockIndex = state.retirements.findIndex(({ kind }) => kind === "install-lock");
  const skillRetirements = state.retirements.filter(({ kind }) => kind.startsWith("skill:"));
  const workflowRetirements = state.retirements.filter(({ kind }) => kind === "workflow");
  if (lockIndex < 0) {
    if (skillRetirements.length || workflowRetirements.length) {
      throw invalidJournal(
        state.stageRoot,
        "Managed legacy retirements have no authenticated install-lock ownership.",
      );
    }
    return;
  }
  const record = state.retirements[lockIndex];
  const source = await readAuthenticatedRetirementFile(
    state,
    record,
    state.provenance.retirements[lockIndex],
    lockIndex,
    "Legacy install lock",
  );
  let lock;
  try {
    lock = JSON.parse(source);
  } catch {
    throw invalidJournal(state.stageRoot, "Legacy install lock is not valid JSON.");
  }
  if (!isRecord(lock.managedSkills)) {
    throw invalidJournal(state.stageRoot, "Legacy install lock has invalid managedSkills ownership.");
  }
  if (
    lock.skillsDirectory !== undefined
    && resolveLegacyUserPath(state.legacyUserRoot, lock.skillsDirectory) !== state.legacySkillsRoot
  ) {
    throw invalidJournal(state.stageRoot, "Legacy install lock disagrees with the authenticated skill root.");
  }
  if (
    lock.managedWorkflow !== undefined
    && (
      !isRecord(lock.managedWorkflow)
      || !/^sha256:[a-f0-9]{64}$/.test(lock.managedWorkflow.hash)
      || (lock.managedWorkflow.path !== undefined
        && typeof lock.managedWorkflow.path !== "string")
    )
  ) {
    throw invalidJournal(state.stageRoot, "Legacy install lock has invalid workflow ownership.");
  }
  const ownershipHashVersions = new Set();
  for (const [skillName, hash] of Object.entries(lock.managedSkills)) {
    const version = directoryHashVersion(hash);
    if (
      !/^sdd-[a-z0-9-]+$/.test(skillName)
      || version === null
    ) {
      throw invalidJournal(state.stageRoot, `Legacy install lock has invalid ownership for ${skillName}.`);
    }
    ownershipHashVersions.add(version);
  }
  if (ownershipHashVersions.size > 1) {
    throw invalidJournal(state.stageRoot, "Legacy install lock mixes managed skill hash versions.");
  }
  for (const retirement of skillRetirements) {
    const skillName = retirement.kind.slice("skill:".length);
    const retirementIndex = state.retirements.indexOf(retirement);
    const authority = state.provenance.retirements[retirementIndex];
    if (
      !authority
      || !(await authenticatedRetirementDirectoryMatchesHash(
        state,
        retirement,
        authority,
        retirementIndex,
        lock.managedSkills[skillName],
      ))
    ) {
      throw invalidJournal(
        state.stageRoot,
        `Legacy install lock does not own retirement ${retirement.kind}.`,
      );
    }
  }
  if (workflowRetirements.length > 1) {
    throw invalidJournal(state.stageRoot, "Legacy workflow retirement is duplicated.");
  }
  if (
    workflowRetirements.length === 1
    && lock.managedWorkflow?.hash !== workflowRetirements[0].expected.hash
  ) {
    throw invalidJournal(state.stageRoot, "Legacy install lock does not own the workflow retirement.");
  }
}

async function assertRecoveryProvenance(state) {
  for (const [index, record] of state.publications.entries()) {
    await assertPublicationRecoveryProvenance(
      state,
      record,
      state.provenance.publications[index],
      index,
    );
  }
  for (const [index, record] of state.destinationGuards.entries()) {
    await assertDestinationGuardProvenance(
      state,
      record,
      state.provenance.destinationGuards[index],
      index,
    );
  }
  for (const [index, record] of state.retirements.entries()) {
    await assertRetirementRecoveryProvenance(
      state,
      record,
      state.provenance.retirements[index],
      index,
    );
  }
  await assertAuthenticatedLegacyLockOwnership(state);
}

async function removeOwnedLeaf(path, identity, label) {
  await requirePhysicalIdentity(path, identity, label);
  if (identity.kind === "directory") {
    throw fail(`${label} is not a leaf path: ${path}`, "MUTATION_RECOVERY_FAILED");
  }
  await rm(path);
}

function transferEvidenceRoot(state, kind, index) {
  return join(state.stageRoot, "transfer-evidence", kind, String(index));
}

function transferProofRoot(evidenceRoot, index) {
  return join(evidenceRoot, "proofs", String(index).padStart(6, "0"));
}

function transferChildProofRoot(proofRoot, index) {
  return join(proofRoot, "children", String(index).padStart(6, "0"));
}

function isValidTransferIdentity(value, kind = null) {
  return hasExactKeys(value, ["device", "inode", "kind"])
    && typeof value.device === "string"
    && /^\d+$/.test(value.device)
    && typeof value.inode === "string"
    && /^\d+$/.test(value.inode)
    && ["directory", "file"].includes(value.kind)
    && (kind === null || value.kind === kind);
}

function parseTransferEvidenceNode(value, path) {
  if (
    !hasExactKeys(value, ["identity", "proofIdentity", "children"])
    || !isValidTransferIdentity(value.identity)
    || !isValidTransferIdentity(value.proofIdentity, "file")
    || (
      value.identity.kind === "file"
        ? value.children !== null
        : !Array.isArray(value.children)
    )
  ) {
    throw fail(`Transfer ownership evidence is invalid: ${path}`, "CONCURRENT_CHANGE");
  }
  if (value.identity.kind === "file") {
    return { identity: value.identity, proofIdentity: value.proofIdentity, children: null };
  }
  const children = new Map();
  for (const child of value.children) {
    if (
      !hasExactKeys(child, ["name", "node"])
      || typeof child.name !== "string"
      || !child.name
      || basename(child.name) !== child.name
      || child.name === "."
      || child.name === ".."
      || children.has(child.name)
    ) {
      throw fail(`Transfer ownership evidence is invalid: ${path}`, "CONCURRENT_CHANGE");
    }
    children.set(child.name, parseTransferEvidenceNode(child.node, `${path}/${child.name}`));
  }
  return { identity: value.identity, proofIdentity: value.proofIdentity, children };
}

function serializeTransferEvidenceNode(node) {
  return {
    identity: node.identity,
    proofIdentity: node.proofIdentity,
    children: node.children === null
      ? null
      : [...node.children].map(([name, child]) => ({
        name,
        node: serializeTransferEvidenceNode(child),
      })),
  };
}

async function matchesTransferFileProof(path, proofPath) {
  if (await samePhysicalFile(path, proofPath)) return true;
  const [value, proof] = await Promise.all([
    snapshot(path),
    snapshot(proofPath),
  ]);
  return value?.kind === "file" && sameSnapshot(value, proof);
}

async function captureTransferOwnedTree(
  path,
  proofRoot,
  label,
  { allowCopyProof = true, forceCopyProof = false } = {},
) {
  const identity = await physicalPathIdentity(path);
  if (!["directory", "file"].includes(identity.kind)) {
    throw fail(`${label} contains an unsupported transfer entry: ${path}`, "CONCURRENT_CHANGE");
  }
  await mkdir(proofRoot, { recursive: true });
  const proofPath = join(proofRoot, "proof");
  const existingProofIdentity = await optionalPhysicalPathIdentity(proofPath);
  let proofIdentity;
  if (identity.kind === "file") {
    if (!existingProofIdentity) {
      if (forceCopyProof) {
        if (!allowCopyProof) {
          throw fail(`${label} source proof cannot cross filesystems: ${path}`, "CONCURRENT_CHANGE");
        }
        try {
          await copyFile(path, proofPath, fsConstants.COPYFILE_EXCL);
        } catch (error) {
          throw mutationCollision(error, proofPath, `${label} ownership proof`);
        }
      } else {
        try {
          await link(path, proofPath);
        } catch (error) {
          if (error?.code !== "EXDEV" || !allowCopyProof) {
            throw mutationCollision(error, proofPath, `${label} ownership proof`);
          }
          try {
            await copyFile(path, proofPath, fsConstants.COPYFILE_EXCL);
          } catch (copyError) {
            throw mutationCollision(copyError, proofPath, `${label} ownership proof`);
          }
        }
      }
    }
    proofIdentity = await physicalPathIdentity(proofPath);
    await requirePhysicalIdentity(path, identity, label);
    const proofMatches = allowCopyProof
      ? await matchesTransferFileProof(path, proofPath)
      : await samePhysicalFile(path, proofPath);
    if (!proofMatches) {
      throw fail(`${label} file ownership proof changed: ${path}`, "CONCURRENT_CHANGE");
    }
    return { identity, proofIdentity, children: null };
  }

  const markerSource = `${JSON.stringify({ path: basename(path), identity }, null, 2)}\n`;
  if (!existingProofIdentity) {
    try {
      await writeDurableFileExclusive(proofPath, markerSource);
    } catch (error) {
      throw mutationCollision(error, proofPath, `${label} ownership proof`);
    }
  } else {
    const marker = await readFile(proofPath, "utf8");
    if (marker !== markerSource) {
      throw fail(`${label} directory ownership proof changed: ${path}`, "CONCURRENT_CHANGE");
    }
  }
  proofIdentity = await physicalPathIdentity(proofPath);
  await requirePhysicalIdentity(path, identity, label);

  const childNames = (await readdir(path)).sort((left, right) => left.localeCompare(right));
  const children = new Map();
  for (const [index, name] of childNames.entries()) {
    children.set(
      name,
      await captureTransferOwnedTree(
        join(path, name),
        transferChildProofRoot(proofRoot, index),
        label,
        { allowCopyProof, forceCopyProof },
      ),
    );
  }
  await requirePhysicalIdentity(path, identity, label);
  const currentNames = (await readdir(path)).sort((left, right) => left.localeCompare(right));
  if (!isDeepStrictEqual(currentNames, childNames)) {
    throw fail(`${label} changed while ownership was captured: ${path}`, "CONCURRENT_CHANGE");
  }
  return { identity, proofIdentity, children };
}

async function requireTransferOwnedTree(path, node, proofRoot, label) {
  await requirePhysicalIdentity(path, node.identity, label);
  const proofPath = join(proofRoot, "proof");
  await requirePhysicalIdentity(proofPath, node.proofIdentity, `${label} ownership proof`);
  if (node.identity.kind === "file") {
    if (!(await matchesTransferFileProof(path, proofPath))) {
      throw fail(`${label} file no longer matches its ownership proof: ${path}`, "CONCURRENT_CHANGE");
    }
    return;
  }
  const proof = await readJson(proofPath);
  if (
    !hasExactKeys(proof, ["path", "identity"])
    || proof.path !== basename(path)
    || !samePhysicalIdentity(proof.identity, node.identity)
  ) {
    throw fail(`${label} directory no longer matches its ownership proof: ${path}`, "CONCURRENT_CHANGE");
  }
  const currentNames = (await readdir(path)).sort((left, right) => left.localeCompare(right));
  const ownedNames = [...node.children.keys()];
  if (!isDeepStrictEqual(currentNames, ownedNames)) {
    throw fail(`${label} contains unowned concurrent entries: ${path}`, "CONCURRENT_CHANGE");
  }
  let index = 0;
  for (const [name, child] of node.children) {
    await requireTransferOwnedTree(
      join(path, name),
      child,
      transferChildProofRoot(proofRoot, index),
      label,
    );
    index += 1;
  }
  await requirePhysicalIdentity(path, node.identity, label);
}

async function removeTransferOwnedTree(path, node, proofRoot, label) {
  await requirePhysicalIdentity(path, node.identity, label);
  const proofPath = join(proofRoot, "proof");
  await requirePhysicalIdentity(proofPath, node.proofIdentity, `${label} ownership proof`);
  if (node.identity.kind === "file") {
    if (!(await matchesTransferFileProof(path, proofPath))) {
      throw fail(`${label} file no longer matches its ownership proof: ${path}`, "CONCURRENT_CHANGE");
    }
    await removeOwnedLeaf(path, node.identity, label);
    return;
  }
  const proof = await readJson(proofPath);
  if (
    !hasExactKeys(proof, ["path", "identity"])
    || proof.path !== basename(path)
    || !samePhysicalIdentity(proof.identity, node.identity)
  ) {
    throw fail(`${label} directory no longer matches its ownership proof: ${path}`, "CONCURRENT_CHANGE");
  }
  const ownedNames = [...node.children.keys()];
  const currentNames = (await readdir(path)).sort((left, right) => left.localeCompare(right));
  if (!isDeepStrictEqual(currentNames, ownedNames)) {
    throw fail(`${label} contains unowned concurrent entries: ${path}`, "CONCURRENT_CHANGE");
  }
  let index = 0;
  for (const [name, child] of node.children) {
    await removeTransferOwnedTree(
      join(path, name),
      child,
      transferChildProofRoot(proofRoot, index),
      label,
    );
    index += 1;
  }
  await requirePhysicalIdentity(path, node.identity, label);
  await requirePhysicalIdentity(proofPath, node.proofIdentity, `${label} ownership proof`);

  if ((await readdir(path)).length !== 0) {
    throw fail(`${label} gained concurrent entries: ${path}`, "CONCURRENT_CHANGE");
  }
  await rmdir(path);
}
function transferSourceWitnessRoot(sourceRoot, evidenceRoot) {
  const digest = createHash("sha256")
    .update(`${resolve(sourceRoot)}\0${resolve(evidenceRoot)}`)
    .digest("hex")
  return join(dirname(sourceRoot), `${SOURCE_WITNESS_PREFIX}${digest}`);
}

function transferSourceWitnessRecordPath(evidenceRoot) {
  return join(evidenceRoot, "source-witness.json");
}

function transferSourceWitnessRecordProofPath(evidenceRoot) {
  return join(evidenceRoot, "source-witness.proof");
}

function transferSourceWitnessIntentPath(evidenceRoot) {
  return join(evidenceRoot, "source-witness-intent.json");
}

function transferSourceWitnessIntentProofPath(evidenceRoot) {
  return join(evidenceRoot, "source-witness-intent.proof");
}

function transferSourceWitnessReservationIntentPath(evidenceRoot) {
  return join(evidenceRoot, "source-witness-reservation.json");
}

function transferSourceWitnessReservationIntentProofPath(evidenceRoot) {
  return join(evidenceRoot, "source-witness-reservation.proof");
}

async function hasTransferSourceWitnessState(evidenceRoot) {
  return Boolean(
    await optionalPhysicalPathIdentity(transferSourceWitnessRecordPath(evidenceRoot))
    || await optionalPhysicalPathIdentity(transferSourceWitnessIntentPath(evidenceRoot))
    || await optionalPhysicalPathIdentity(
      transferSourceWitnessReservationIntentPath(evidenceRoot),
    ),
  );
}

async function bindTransferSourceWitnessIntentProof(path, proofPath, label) {
  const identity = await physicalPathIdentity(path);
  const existingProof = await optionalPhysicalPathIdentity(proofPath);
  if (!existingProof) {
    try {
      await link(path, proofPath);
    } catch (error) {
      throw mutationCollision(error, proofPath, `${label} proof`);
    }
  }
  await requirePhysicalIdentity(proofPath, identity, `${label} proof`);
  if (!(await samePhysicalFile(path, proofPath))) {
    throw fail(`${label} proof changed: ${path}`, "CONCURRENT_CHANGE");
  }
  return identity;
}

async function prepareTransferSourceWitness(
  evidenceRoot,
  sourceRoot,
  { afterReservation = null } = {},
) {
  const witnessRoot = transferSourceWitnessRoot(sourceRoot, evidenceRoot);
  const authorityPath = join(witnessRoot, "authority.json");
  const recordPath = transferSourceWitnessRecordPath(evidenceRoot);
  const recordProofPath = transferSourceWitnessRecordProofPath(evidenceRoot);
  const intentPath = transferSourceWitnessIntentPath(evidenceRoot);
  const intentProofPath = transferSourceWitnessIntentProofPath(evidenceRoot);
  await mkdir(evidenceRoot, { recursive: true });

  const existingRecordIdentity = await optionalPhysicalPathIdentity(recordPath);
  if (existingRecordIdentity) {
    if (!(await samePhysicalFile(recordPath, recordProofPath))) {
      throw fail(`Transfer source witness record is unowned: ${recordPath}`, "CONCURRENT_CHANGE");
    }
    const record = await readJson(recordPath);
    if (
      !hasExactKeys(record, [
        "version",
        "sourceRoot",
        "witnessRoot",
        "witnessIdentity",
        "authorityIdentity",
      ])
      || record.version !== 1
      || record.sourceRoot !== resolve(sourceRoot)
      || record.witnessRoot !== resolve(witnessRoot)
    ) {
      throw fail(`Transfer source witness record is invalid: ${recordPath}`, "CONCURRENT_CHANGE");
    }
    assertProvenanceIdentity(record.witnessIdentity, "transfer source witness", evidenceRoot);
    assertProvenanceIdentity(record.authorityIdentity, "transfer source witness authority", evidenceRoot);
    const witnessActual = await optionalPhysicalPathIdentity(witnessRoot);
    if (!witnessActual) {
      return {
        authorityIdentity: record.authorityIdentity,
        authorityPath,
        identity: record.witnessIdentity,
        removed: true,
        root: witnessRoot,
      };
    }
    if (!samePhysicalIdentity(witnessActual, record.witnessIdentity)) {
      throw fail(`Transfer source witness changed: ${witnessRoot}`, "CONCURRENT_CHANGE");
    }
    const authorityActual = await optionalPhysicalPathIdentity(authorityPath);
    if (!authorityActual) {
      if ((await readdir(witnessRoot)).length !== 0) {
        throw fail(`Transfer source witness authority disappeared: ${authorityPath}`, "CONCURRENT_CHANGE");
      }
      return {
        authorityIdentity: record.authorityIdentity,
        authorityPath,
        identity: record.witnessIdentity,
        removed: false,
        root: witnessRoot,
      };
    }
    await requirePhysicalIdentity(authorityPath, record.authorityIdentity, "Transfer source witness authority");
    const authority = await readJson(authorityPath);
    if (
      !hasExactKeys(authority, ["version", "sourceRoot", "evidenceRoot", "witnessIdentity"])
      || authority.version !== 1
      || authority.sourceRoot !== resolve(sourceRoot)
      || authority.evidenceRoot !== resolve(evidenceRoot)
      || !samePhysicalIdentity(authority.witnessIdentity, record.witnessIdentity)
    ) {
      throw fail(`Transfer source witness authority is invalid: ${authorityPath}`, "CONCURRENT_CHANGE");
    }
    return {
      authorityIdentity: record.authorityIdentity,
      authorityPath,
      identity: record.witnessIdentity,
      root: witnessRoot,
    };
  }

  const reservationIntentPath = transferSourceWitnessReservationIntentPath(evidenceRoot);
  const reservationIntentProofPath =
    transferSourceWitnessReservationIntentProofPath(evidenceRoot);
  const reservationIntentSource = `${JSON.stringify({
    version: 1,
    sourceRoot: resolve(sourceRoot),
    witnessRoot: resolve(witnessRoot),
  }, null, 2)}\n`;
  const existingReservationIntent =
    await optionalPhysicalPathIdentity(reservationIntentPath);
  if (existingReservationIntent) {
    if (await readFile(reservationIntentPath, "utf8") !== reservationIntentSource) {
      throw fail(
        `Transfer source witness reservation intent is invalid: ${reservationIntentPath}`,
        "CONCURRENT_CHANGE",
      );
    }
  } else {
    await writeDurableFileExclusive(reservationIntentPath, reservationIntentSource);
  }
  await bindTransferSourceWitnessIntentProof(
    reservationIntentPath,
    reservationIntentProofPath,
    "Transfer source witness reservation intent",
  );

  let witnessIdentity;
  const existingIntentIdentity = await optionalPhysicalPathIdentity(intentPath);
  if (existingIntentIdentity) {
    const intent = await readJson(intentPath);
    if (
      !hasExactKeys(intent, ["version", "sourceRoot", "witnessRoot", "witnessIdentity"])
      || intent.version !== 1
      || intent.sourceRoot !== resolve(sourceRoot)
      || intent.witnessRoot !== resolve(witnessRoot)
    ) {
      throw fail(`Transfer source witness intent is invalid: ${intentPath}`, "CONCURRENT_CHANGE");
    }
    assertProvenanceIdentity(
      intent.witnessIdentity,
      "transfer source witness intent",
      evidenceRoot,
      { kind: "directory" },
    );
    witnessIdentity = intent.witnessIdentity;
    await requirePhysicalIdentity(
      witnessRoot,
      witnessIdentity,
      "Transfer source witness reservation",
    );
    await bindTransferSourceWitnessIntentProof(
      intentPath,
      intentProofPath,
      "Transfer source witness intent",
    );
  } else {
    const existingWitnessIdentity = await optionalPhysicalPathIdentity(witnessRoot);
    if (existingWitnessIdentity) {
      witnessIdentity = existingWitnessIdentity;
    } else {
      try {
        await mkdir(witnessRoot, { mode: 0o700 });
      } catch (error) {
        throw mutationCollision(error, witnessRoot, "Transfer source witness reservation");
      }
      witnessIdentity = await physicalPathIdentity(witnessRoot);
    }
    if (witnessIdentity.kind !== "directory") {
      throw fail(`Transfer source witness is not a real directory: ${witnessRoot}`, "CONCURRENT_CHANGE");
    }
    await requirePhysicalIdentity(
      witnessRoot,
      witnessIdentity,
      "Transfer source witness reservation",
    );
    if ((await readdir(witnessRoot)).length !== 0) {
      throw fail(`Transfer source witness reservation is not empty: ${witnessRoot}`, "CONCURRENT_CHANGE");
    }
    await afterReservation?.();
    await writeDurableFileExclusive(
      intentPath,
      `${JSON.stringify({
        version: 1,
        sourceRoot: resolve(sourceRoot),
        witnessRoot: resolve(witnessRoot),
        witnessIdentity,
      }, null, 2)}\n`,
    );
    await bindTransferSourceWitnessIntentProof(
      intentPath,
      intentProofPath,
      "Transfer source witness intent",
    );
  }
  const authority = {
    version: 1,
    sourceRoot: resolve(sourceRoot),
    evidenceRoot: resolve(evidenceRoot),
    witnessIdentity,
  };
  const authoritySource = `${JSON.stringify(authority, null, 2)}\n`;
  const existingAuthority = await optionalPhysicalPathIdentity(authorityPath);
  if (existingAuthority) {
    if (await readFile(authorityPath, "utf8") !== authoritySource) {
      throw fail(`Transfer source witness authority conflicts: ${authorityPath}`, "CONCURRENT_CHANGE");
    }
  } else {
    if ((await readdir(witnessRoot)).length !== 0) {
      throw fail(`Transfer source witness reservation is not empty: ${witnessRoot}`, "CONCURRENT_CHANGE");
    }
    await writeDurableFileExclusive(authorityPath, authoritySource);
  }
  const authorityIdentity = await physicalPathIdentity(authorityPath);
  await writeDurableFileExclusive(
    recordPath,
    `${JSON.stringify({
      version: 1,
      sourceRoot: resolve(sourceRoot),
      witnessRoot: resolve(witnessRoot),
      witnessIdentity,
      authorityIdentity,
    }, null, 2)}\n`,
  );
  try {
    await link(recordPath, recordProofPath);
  } catch (error) {
    throw mutationCollision(error, recordProofPath, "Transfer source witness record proof");
  }
  if (!(await samePhysicalFile(recordPath, recordProofPath))) {
    throw fail(`Transfer source witness record proof changed: ${recordPath}`, "CONCURRENT_CHANGE");
  }
  return {
    authorityIdentity,
    authorityPath,
    identity: witnessIdentity,
    root: witnessRoot,
  };
}

async function removeTransferProofTreeResumable(node, proofRoot, label) {
  if (node.children) {
    let index = 0;
    for (const child of node.children.values()) {
      await removeTransferProofTreeResumable(
        child,
        transferChildProofRoot(proofRoot, index),
        label,
      );
      index += 1;
    }
    const childrenRoot = join(proofRoot, "children");
    const childrenIdentity = await optionalPhysicalPathIdentity(childrenRoot);
    if (childrenIdentity) {
      if (
        childrenIdentity.kind !== "directory"
        || (await readdir(childrenRoot)).length !== 0
      ) {
        throw fail(`${label} proof tree gained concurrent entries: ${childrenRoot}`, "CONCURRENT_CHANGE");
      }
      await rmdir(childrenRoot);
    }
  }
  const proofPath = join(proofRoot, "proof");
  const proofIdentity = await optionalPhysicalPathIdentity(proofPath);
  if (proofIdentity) {
    await requirePhysicalIdentity(proofPath, node.proofIdentity, `${label} ownership proof`);
    await removeOwnedLeaf(proofPath, node.proofIdentity, `${label} ownership proof`);
  }
  const rootIdentity = await optionalPhysicalPathIdentity(proofRoot);
  if (rootIdentity) {
    if (
      rootIdentity.kind !== "directory"
      || (await readdir(proofRoot)).length !== 0
    ) {
      throw fail(`${label} proof root gained concurrent entries: ${proofRoot}`, "CONCURRENT_CHANGE");
    }
    await rmdir(proofRoot);
  }
}

async function requireWitnessProofMatchesCaptured(
  ownership,
  captured,
  label,
) {
  if (!samePhysicalIdentity(ownership.node.identity, captured.identity)) {
    throw fail(`${label} witness identity differs from immutable provenance.`, "CONCURRENT_CHANGE");
  }
  const proofPath = join(ownership.proofRoot, "proof");
  await requirePhysicalIdentity(
    proofPath,
    ownership.node.proofIdentity,
    `${label} ownership proof`,
  );
  if (captured.identity.kind === "file") {
    if (!samePhysicalIdentity(ownership.node.proofIdentity, captured.identity)) {
      throw fail(`${label} file witness is not the original source inode.`, "CONCURRENT_CHANGE");
    }
    return;
  }
  const proof = await readJson(proofPath);
  if (
    !hasExactKeys(proof, ["path", "identity"])
    || !samePhysicalIdentity(proof.identity, captured.identity)
  ) {
    throw fail(`${label} directory witness differs from immutable provenance.`, "CONCURRENT_CHANGE");
  }
  const capturedNames = [...captured.children.keys()];
  const witnessedNames = [...ownership.node.children.keys()];
  if (!isDeepStrictEqual(witnessedNames, capturedNames)) {
    throw fail(`${label} witness tree differs from immutable provenance.`, "CONCURRENT_CHANGE");
  }
  let index = 0;
  for (const name of capturedNames) {
    await requireWitnessProofMatchesCaptured(
      {
        node: ownership.node.children.get(name),
        proofRoot: transferChildProofRoot(ownership.proofRoot, index),
      },
      captured.children.get(name),
      `${label}/${name}`,
    );
    index += 1;
  }
}

async function requireSourceWitnessMatchesProvenance(
  evidenceRoot,
  sourceRoot,
  captured,
  label,
) {
  const records = await readTransferEntryEvidence(evidenceRoot, sourceRoot);
  const capturedNames = [...captured.children.keys()];
  const witnessedNames = [...records.keys()];
  if (!isDeepStrictEqual(witnessedNames, capturedNames)) {
    throw fail(`${label} witness entries differ from immutable provenance.`, "CONCURRENT_CHANGE");
  }
  for (const name of capturedNames) {
    const ownership = records.get(name)?.source;
    if (!ownership) {
      throw fail(`${label} lacks an external source witness for ${name}.`, "CONCURRENT_CHANGE");
    }
    await requireWitnessProofMatchesCaptured(
      ownership,
      captured.children.get(name),
      `${label}/${name}`,
    );
  }
}

async function requireFileSourceWitnessMatchesProvenance(
  evidenceRoot,
  sourceRoot,
  sourcePath,
  sourceIdentity,
  label,
) {
  const records = await readTransferEntryEvidence(evidenceRoot, sourceRoot);
  const name = basename(sourcePath);
  if (records.size !== 1 || !records.has(name) || !records.get(name).source) {
    throw fail(`${label} lacks its external source witness.`, "CONCURRENT_CHANGE");
  }
  await requireWitnessProofMatchesCaptured(
    records.get(name).source,
    { identity: sourceIdentity, children: null },
    label,
  );
}

async function moveFileSourceToWitnessRecovery(
  evidenceRoot,
  sourceRoot,
  sourcePath,
  sourceIdentity,
  label,
) {
  const witness = await prepareTransferSourceWitness(evidenceRoot, sourceRoot);
  const recoveryPath = join(witness.root, "source-payload");
  const existingRecovery = await optionalPhysicalPathIdentity(recoveryPath);
  if (existingRecovery) {
    if (!samePhysicalIdentity(existingRecovery, sourceIdentity)) {
      throw fail(`${label} recovery destination changed: ${recoveryPath}`, "CONCURRENT_CHANGE");
    }
  } else {
    try {
      await link(sourcePath, recoveryPath);
    } catch (error) {
      throw mutationCollision(error, recoveryPath, `${label} recovery`);
    }
    await requirePhysicalIdentity(recoveryPath, sourceIdentity, `${label} recovery`);
  }
  const movedRecoveryPath = join(witness.root, `source-move-${randomUUID()}`);
  try {
    await rename(sourcePath, movedRecoveryPath);
  } catch (error) {
    throw mutationCollision(error, sourcePath, label);
  }
  const [sourceAfterMove, movedIdentity] = await Promise.all([
    optionalPhysicalPathIdentity(sourcePath),
    optionalPhysicalPathIdentity(movedRecoveryPath),
  ]);
  if (!samePhysicalIdentity(movedIdentity, sourceIdentity)) {
    if (movedIdentity && !sourceAfterMove) {
      await link(movedRecoveryPath, sourcePath).catch((error) => {
        if (error?.code !== "EEXIST") throw error;
      });
    }
    throw fail(`${label} changed during its atomic recovery move: ${sourcePath}`, "CONCURRENT_CHANGE");
  }
  if (sourceAfterMove) {
    throw fail(`${label} reappeared during its atomic recovery move: ${sourcePath}`, "CONCURRENT_CHANGE");
  }
  const ownership = (await readTransferEntryEvidence(evidenceRoot, sourceRoot))
    .get(basename(sourcePath))?.source;
  const proofPath = ownership ? join(ownership.proofRoot, "proof") : null;
  if (
    !proofPath
    || !(await samePhysicalFile(recoveryPath, proofPath))
    || !(await samePhysicalFile(movedRecoveryPath, proofPath))
  ) {
    throw fail(`${label} recovery lost its source witness: ${recoveryPath}`, "CONCURRENT_CHANGE");
  }
  return recoveryPath;
}

async function cleanupTransferSourceWitness(evidenceRoot, sourceRoot, label) {
  const recordPath = transferSourceWitnessRecordPath(evidenceRoot);
  const intentPath = transferSourceWitnessIntentPath(evidenceRoot);
  const reservationIntentPath =
    transferSourceWitnessReservationIntentPath(evidenceRoot);
  if (
    !(await optionalPhysicalPathIdentity(recordPath))
    && !(await optionalPhysicalPathIdentity(intentPath))
    && !(await optionalPhysicalPathIdentity(reservationIntentPath))
  ) return;
  const witness = await prepareTransferSourceWitness(evidenceRoot, sourceRoot);
  if (witness.removed) return;
  const records = await readTransferEntryEvidence(evidenceRoot, sourceRoot);
  const sourcePayload = join(witness.root, "source-payload");
  const sourcePayloadIdentity = await optionalPhysicalPathIdentity(sourcePayload);
  if (sourcePayloadIdentity) {
    if (records.size !== 1) {
      throw fail(`${label} source payload has ambiguous ownership.`, "CONCURRENT_CHANGE");
    }
    const ownership = records.values().next().value.source;
    const proofPath = join(ownership.proofRoot, "proof");
    if (
      !samePhysicalIdentity(sourcePayloadIdentity, ownership.node.identity)
      || !(await samePhysicalFile(sourcePayload, proofPath))
    ) {
      throw fail(`${label} source payload changed: ${sourcePayload}`, "CONCURRENT_CHANGE");
    }
    await removeOwnedLeaf(sourcePayload, sourcePayloadIdentity, `${label} source payload`);
  }
  const movedPayloadNames = (await readdir(witness.root))
    .filter((name) => name.startsWith("source-move-"))
    .sort((left, right) => left.localeCompare(right));
  if (movedPayloadNames.length > 0 && records.size !== 1) {
    throw fail(`${label} moved payload has ambiguous ownership.`, "CONCURRENT_CHANGE");
  }
  for (const name of movedPayloadNames) {
    const movedPayload = join(witness.root, name);
    const movedIdentity = await physicalPathIdentity(movedPayload);
    const ownership = records.values().next().value.source;
    const proofPath = join(ownership.proofRoot, "proof");
    if (
      !samePhysicalIdentity(movedIdentity, ownership.node.identity)
      || !(await samePhysicalFile(movedPayload, proofPath))
    ) {
      throw fail(`${label} moved payload changed: ${movedPayload}`, "CONCURRENT_CHANGE");
    }
    await removeOwnedLeaf(movedPayload, movedIdentity, `${label} moved payload`);
  }
  for (const ownership of records.values()) {
    await removeTransferProofTreeResumable(
      ownership.source.node,
      ownership.source.proofRoot,
      label,
    );
  }
  const entriesRoot = join(witness.root, "entries");
  const entriesIdentity = await optionalPhysicalPathIdentity(entriesRoot);
  if (entriesIdentity) {
    if (
      entriesIdentity.kind !== "directory"
      || (await readdir(entriesRoot)).length !== 0
    ) {
      throw fail(`${label} witness gained concurrent entries: ${entriesRoot}`, "CONCURRENT_CHANGE");
    }
    await rmdir(entriesRoot);
  }
  const authorityIdentity = await optionalPhysicalPathIdentity(witness.authorityPath);
  if (authorityIdentity) {
    await requirePhysicalIdentity(
      witness.authorityPath,
      witness.authorityIdentity,
      `${label} witness authority`,
    );
    await removeOwnedLeaf(
      witness.authorityPath,
      witness.authorityIdentity,
      `${label} witness authority`,
    );
  }
  const witnessIdentity = await optionalPhysicalPathIdentity(witness.root);
  if (witnessIdentity) {
    await requirePhysicalIdentity(witness.root, witness.identity, `${label} witness`);
    if ((await readdir(witness.root)).length !== 0) {
      throw fail(`${label} witness gained concurrent entries: ${witness.root}`, "CONCURRENT_CHANGE");
    }
    await rmdir(witness.root);
  }
}

async function captureTransferSourceEvidence(
  evidence,
  index,
  source,
  sourceRoot,
  label,
) {
  if (!evidence) return null;
  await mkdir(evidence.root, { recursive: true });
  await requireJournalContained(
    evidence.stageRoot,
    evidence.root,
    "transfer evidence",
    evidence.stageRoot,
  );
  await directoryIdentity(evidence.root);
  let proofRoot;
  let allowCopyProof;
  if (evidence.sourceWitness === true) {
    const witness = await prepareTransferSourceWitness(
      evidence.root,
      sourceRoot,
      { afterReservation: evidence.beforeSourceWitness },
    );
    proofRoot = join(
      witness.root,
      "entries",
      String(index).padStart(6, "0"),
    );
    allowCopyProof = false;
  } else {
    proofRoot = join(transferProofRoot(evidence.root, index), "source");
    allowCopyProof = true;
  }
  return {
    node: await captureTransferOwnedTree(
      source,
      proofRoot,
      `${label} source`,
      {
        allowCopyProof,
        forceCopyProof: allowCopyProof && evidence.forceCrossDeviceProof === true,
      },
    ),
    proofRoot,
  };
}

async function recordTransferEntryEvidence(
  evidence,
  index,
  entry,
  destination,
  label,
  sourceOwnership,
) {
  if (!evidence) return null;
  const proofRoot = transferProofRoot(evidence.root, index);
  const destinationProofRoot = join(proofRoot, "destination");
  const sourceNode = sourceOwnership.node;
  const destinationNode = await captureTransferOwnedTree(
    destination,
    destinationProofRoot,
    `${label ?? "Transfer"} destination`,
    { forceCopyProof: evidence.forceCrossDeviceProof === true },
  );
  const manifestPath = join(evidence.root, `${String(index).padStart(6, "0")}.json`);
  await writeDurableFileExclusive(
    manifestPath,
    `${JSON.stringify({
      entry,
      source: serializeTransferEvidenceNode(sourceNode),
      destination: serializeTransferEvidenceNode(destinationNode),
    }, null, 2)}\n`,
  );
  const manifestIdentity = await physicalPathIdentity(manifestPath);
  const manifestProof = join(proofRoot, "manifest");
  try {
    await link(manifestPath, manifestProof);
  } catch (error) {
    throw mutationCollision(error, manifestProof, "Transfer evidence manifest proof");
  }
  if (!(await samePhysicalFile(manifestPath, manifestProof))) {
    throw fail(`Transfer evidence manifest changed: ${manifestPath}`, "CONCURRENT_CHANGE");
  }
  return {
    source: sourceOwnership,
    destination: { node: destinationNode, proofRoot: destinationProofRoot },
    manifestIdentity,
  };
}

async function readTransferEntryEvidence(evidenceRoot, sourceRoot = null) {
  const identity = await optionalPhysicalPathIdentity(evidenceRoot);
  if (!identity) return new Map();
  if (identity.kind !== "directory") {
    throw fail(`Transfer evidence is not a real directory: ${evidenceRoot}`, "CONCURRENT_CHANGE");
  }
  const witness = sourceRoot
    ? await prepareTransferSourceWitness(evidenceRoot, sourceRoot)
    : null;
  const evidence = new Map();
  for (const name of (await readdir(evidenceRoot)).sort((left, right) => left.localeCompare(right))) {
    const match = /^(\d{6})\.json$/.exec(name);
    if (!match) continue;
    const manifestPath = join(evidenceRoot, name);
    const proofRoot = transferProofRoot(evidenceRoot, Number(match[1]));
    const manifestProof = join(proofRoot, "manifest");
    if (!(await samePhysicalFile(manifestPath, manifestProof))) {
      throw fail(`Transfer evidence manifest is unowned: ${manifestPath}`, "CONCURRENT_CHANGE");
    }
    const value = await readJson(manifestPath);
    if (
      !hasExactKeys(value, ["entry", "source", "destination"])
      || typeof value.entry !== "string"
      || !value.entry
      || basename(value.entry) !== value.entry
      || evidence.has(value.entry)
    ) {
      throw fail(`Transfer evidence is invalid: ${manifestPath}`, "CONCURRENT_CHANGE");
    }
    evidence.set(value.entry, {
      index: Number(match[1]),
      source: {
        node: parseTransferEvidenceNode(value.source, `${manifestPath}:source`),
        proofRoot: witness
          ? join(witness.root, "entries", match[1])
          : join(proofRoot, "source"),
      },
      destination: {
        node: parseTransferEvidenceNode(value.destination, `${manifestPath}:destination`),
        proofRoot: join(proofRoot, "destination"),
      },
    });
  }
  return evidence;
}


async function copyDirectoryContentsExclusive(
  source,
  target,
  targetIdentity,
  label,
  { beforeEntry = null, afterEntry = null, evidence = null } = {},
) {
  const sourceIdentity = await directoryIdentity(source);
  const entries = (await readdir(source)).sort((left, right) => left.localeCompare(right));
  const existingEvidence = evidence
    ? await readTransferEntryEvidence(
      evidence.root,
      evidence.sourceWitness === true ? source : null,
    )
    : new Map();
  for (const entry of existingEvidence.keys()) {
    if (!entries.includes(entry)) {
      throw fail(`${label} transfer evidence names an unknown source entry: ${entry}`, "CONCURRENT_CHANGE");
    }
  }
  for (const [index, entry] of entries.entries()) {
    await beforeEntry?.({ source, target, entry, index });
    if (
      !sameDirectoryIdentity(await directoryIdentity(source), sourceIdentity)
      || !sameDirectoryIdentity(await directoryIdentity(target), targetIdentity)
    ) {
      throw fail(`${label} reservation changed during transfer: ${target}`, "CONCURRENT_CHANGE");
    }
    const recorded = existingEvidence.get(entry);
    if (recorded) {
      await requireTransferOwnedTree(
        join(source, entry),
        recorded.source.node,
        recorded.source.proofRoot,
        `${label} source`,
      );
      await requireTransferOwnedTree(
        join(target, entry),
        recorded.destination.node,
        recorded.destination.proofRoot,
        `${label} destination`,
      );
      continue;
    }
    const sourcePath = join(source, entry);
    const sourceOwnership = await captureTransferSourceEvidence(
      evidence,
      index,
      sourcePath,
      source,
      label,
    );
    const destination = join(target, entry);
    try {
      await cp(sourcePath, destination, {
        recursive: true,
        force: false,
        errorOnExist: true,
        preserveTimestamps: true,
        verbatimSymlinks: true,
      });
    } catch (error) {
      throw mutationCollision(error, destination, label);
    }
    const ownership = await recordTransferEntryEvidence(
      evidence,
      index,
      entry,
      destination,
      label,
      sourceOwnership,
    );
    await afterEntry?.({ source, target, entry, index });
    if (ownership) {
      await requireTransferOwnedTree(
        sourcePath,
        ownership.source.node,
        ownership.source.proofRoot,
        `${label} source`,
      );
      await requireTransferOwnedTree(
        destination,
        ownership.destination.node,
        ownership.destination.proofRoot,
        `${label} destination`,
      );
    }
  }
  if (
    !sameDirectoryIdentity(await directoryIdentity(source), sourceIdentity)
    || !sameDirectoryIdentity(await directoryIdentity(target), targetIdentity)
  ) {
    throw fail(`${label} reservation changed during transfer: ${target}`, "CONCURRENT_CHANGE");
  }
}

async function capturePhysicalTree(path) {
  const identity = await physicalPathIdentity(path);
  if (identity.kind !== "directory") return { identity, children: null };
  const childNames = (await readdir(path)).sort((left, right) => left.localeCompare(right));
  const children = new Map();
  for (const name of childNames) {
    children.set(name, await capturePhysicalTree(join(path, name)));
  }
  await requirePhysicalIdentity(path, identity, "Migration cleanup directory");
  const currentNames = (await readdir(path)).sort((left, right) => left.localeCompare(right));
  if (!isDeepStrictEqual(currentNames, childNames)) {
    throw fail(`Migration cleanup directory changed during inspection: ${path}`, "CONCURRENT_CHANGE");
  }
  return { identity, children };
}

async function requireCapturedTree(path, captured, label) {
  await requirePhysicalIdentity(path, captured.identity, label);
  if (captured.identity.kind !== "directory") return;
  const currentNames = (await readdir(path)).sort((left, right) => left.localeCompare(right));
  const capturedNames = [...captured.children.keys()];
  if (!isDeepStrictEqual(currentNames, capturedNames)) {
    throw fail(`${label} gained concurrent entries: ${path}`, "CONCURRENT_CHANGE");
  }
  for (const name of capturedNames) {
    await requireCapturedTree(join(path, name), captured.children.get(name), label);
  }
  await requirePhysicalIdentity(path, captured.identity, label);
}

async function removeCapturedTree(path, captured, label) {
  await requirePhysicalIdentity(path, captured.identity, label);
  if (captured.identity.kind !== "directory") {
    await rm(path);
    return;
  }
  const currentNames = (await readdir(path)).sort((left, right) => left.localeCompare(right));
  const capturedNames = [...captured.children.keys()];
  if (!isDeepStrictEqual(currentNames, capturedNames)) {
    throw fail(`${label} gained concurrent entries: ${path}`, "CONCURRENT_CHANGE");
  }
  for (const name of capturedNames) {
    await removeCapturedTree(join(path, name), captured.children.get(name), label);
  }
  await requirePhysicalIdentity(path, captured.identity, label);
  await rmdir(path);
}

async function removeOwnedDirectoryTree(path, identity, label, afterCapture = null) {
  const captured = await capturePhysicalTree(path);
  if (
    captured.identity.kind !== "directory"
    || !sameDirectoryIdentity(captured.identity, identity)
  ) {
    throw fail(`${label} changed physical identity: ${path}`, "CONCURRENT_CHANGE");
  }
  await afterCapture?.({ path, identity });
  await removeCapturedTree(path, captured, label);
}

async function assertDirectorySubset(source, target, label) {
  const [sourceState, targetState] = await Promise.all([
    lstat(source),
    lstat(target),
  ]);
  if (
    !sourceState.isDirectory()
    || sourceState.isSymbolicLink()
    || !targetState.isDirectory()
    || targetState.isSymbolicLink()
  ) {
    throw fail(`${label} is not a real directory subset: ${target}`, "CONCURRENT_CHANGE");
  }
  for (const name of (await readdir(target)).sort((left, right) => left.localeCompare(right))) {
    const sourceChild = join(source, name);
    const targetChild = join(target, name);
    let sourceChildState;
    try {
      sourceChildState = await lstat(sourceChild);
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw fail(`${label} contains a concurrent entry: ${targetChild}`, "CONCURRENT_CHANGE");
      }
      throw error;
    }
    const targetChildState = await lstat(targetChild);
    if (physicalKind(sourceChildState) !== physicalKind(targetChildState)) {
      throw fail(`${label} entry changed kind: ${targetChild}`, "CONCURRENT_CHANGE");
    }
    if (targetChildState.isDirectory() && !targetChildState.isSymbolicLink()) {
      await assertDirectorySubset(sourceChild, targetChild, label);
    } else if (targetChildState.isFile() && !targetChildState.isSymbolicLink()) {
      if (await hashFile(sourceChild) !== await hashFile(targetChild)) {
        throw fail(`${label} file changed: ${targetChild}`, "CONCURRENT_CHANGE");
      }
    } else if (targetChildState.isSymbolicLink()) {
      if (await readlink(sourceChild) !== await readlink(targetChild)) {
        throw fail(`${label} symbolic link changed: ${targetChild}`, "CONCURRENT_CHANGE");
      }
    } else {
      throw fail(`${label} contains an opaque entry: ${targetChild}`, "CONCURRENT_CHANGE");
    }
  }
}

async function requireTransferOwnedDirectorySubset(
  source,
  target,
  identity,
  label,
  evidenceRoot,
  evidenceKind = "destination",
) {
  if (!sameDirectoryIdentity(await directoryIdentity(target), identity)) {
    throw fail(`${label} changed physical identity: ${target}`, "CONCURRENT_CHANGE");
  }
  await assertDirectorySubset(source, target, label);
  const evidence = await readTransferEntryEvidence(
    evidenceRoot,
    evidenceKind === "source" ? target : null,
  );
  const currentNames = (await readdir(target)).sort((left, right) => left.localeCompare(right));
  const ownedNames = currentNames;
  if (ownedNames.some((name) => !evidence.has(name))) {
    throw fail(`${label} contains unowned concurrent entries: ${target}`, "CONCURRENT_CHANGE");
  }
  for (const name of ownedNames) {
    const ownership = evidence.get(name)?.[evidenceKind];
    if (!ownership) {
      throw fail(`${label} lacks recursive ownership evidence: ${join(target, name)}`, "CONCURRENT_CHANGE");
    }
    await requireTransferOwnedTree(
      join(target, name),
      ownership.node,
      ownership.proofRoot,
      label,
    );
  }
  return { evidence, ownedNames };
}

async function removeOwnedDirectorySubset(
  source,
  target,
  identity,
  label,
  afterCapture = null,
  evidenceRoot = null,
  evidenceKind = "destination",
) {
  if (!evidenceRoot) {
    if (!sameDirectoryIdentity(await directoryIdentity(target), identity)) {
      throw fail(`${label} changed physical identity: ${target}`, "CONCURRENT_CHANGE");
    }
    await assertDirectorySubset(source, target, label);
    await removeOwnedDirectoryTree(target, identity, label, afterCapture);
    return;
  }
  const { evidence, ownedNames } = await requireTransferOwnedDirectorySubset(
    source,
    target,
    identity,
    label,
    evidenceRoot,
    evidenceKind,
  );
  await afterCapture?.({ path: target, identity });
  if (!sameDirectoryIdentity(await directoryIdentity(target), identity)) {
    throw fail(`${label} changed physical identity: ${target}`, "CONCURRENT_CHANGE");
  }
  const afterNames = (await readdir(target)).sort((left, right) => left.localeCompare(right));
  if (!isDeepStrictEqual(afterNames, ownedNames)) {
    throw fail(`${label} gained concurrent entries: ${target}`, "CONCURRENT_CHANGE");
  }
  for (const name of ownedNames) {
    const ownership = evidence.get(name)[evidenceKind];
    await requireTransferOwnedTree(
      join(target, name),
      ownership.node,
      ownership.proofRoot,
      label,
    );
  }
  for (const name of ownedNames) {
    const ownership = evidence.get(name)[evidenceKind];
    await removeTransferOwnedTree(
      join(target, name),
      ownership.node,
      ownership.proofRoot,
      label,
    );
  }
  if (!sameDirectoryIdentity(await directoryIdentity(target), identity)) {
    throw fail(`${label} changed physical identity: ${target}`, "CONCURRENT_CHANGE");
  }
  if ((await readdir(target)).length !== 0) {
    throw fail(`${label} gained concurrent entries: ${target}`, "CONCURRENT_CHANGE");
  }
  await rmdir(target);
}

async function samePhysicalFile(left, right) {
  try {
    const [leftState, rightState] = await Promise.all([
      lstat(left, { bigint: true }),
      lstat(right, { bigint: true }),
    ]);
    return leftState.isFile()
      && !leftState.isSymbolicLink()
      && rightState.isFile()
      && !rightState.isSymbolicLink()
      && leftState.dev === rightState.dev
      && leftState.ino === rightState.ino;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function isEmptyOwnedPublicationReservation(record) {
  return isEmptyOwnedDirectory(record.target, record.reservation);
}

async function isEmptyOwnedDirectory(path, identity) {
  let currentIdentity;
  try {
    currentIdentity = await directoryIdentity(path);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  return sameDirectoryIdentity(currentIdentity, identity)
    && (await readdir(path)).length === 0;
}

function publicationFileTransferPath(state, record, index, purpose = "publish") {
  return join(
    dirname(record.target),
    `.${basename(record.target)}.${basename(state.stageRoot)}.${index}.${purpose}.transfer`,
  );
}

async function requirePublicationFileTransferContained(
  state,
  record,
  path,
  label,
) {
  const owner = plannedBriefOwner(state, record) ?? state.workspaceRoot;
  await requireJournalContained(owner, path, label, state.stageRoot);
}

async function publicationFileTransferIdentity(
  state,
  record,
  index,
  {
    category,
    expected,
    path,
    source,
    label,
  },
) {
  await requirePublicationFileTransferContained(state, record, path, `${label} path`);
  const actual = await optionalPhysicalPathIdentity(path);
  let identity = await readProvenanceIdentityEvidence(
    state,
    category,
    index,
    path,
  );
  if (!actual) return { actual: null, identity };
  if (!identity) {
    await expect(source, expected, `${label} source`);
    await expect(path, expected, label);
    identity = await writeProvenanceIdentityEvidence(
      state,
      category,
      index,
      path,
    );
    await persist(state);
  }
  await requireProvenancePathIdentity(state, path, identity, label);
  await expect(path, expected, label);
  return { actual, identity };
}

async function removePublicationFileTransfer(
  state,
  record,
  index,
  options,
) {
  const transfer = await publicationFileTransferIdentity(
    state,
    record,
    index,
    options,
  );
  if (!transfer.actual) return;
  await removeOwnedLeaf(options.path, transfer.identity, options.label);
}

async function publishStagedWithoutReplace(state, record, index, hooks) {
  await mkdir(dirname(record.target), { recursive: true });
  await requirePublicationTargetContained(state, record);
  const targetParent = dirname(record.target);
  const targetParentIdentity = await physicalPathIdentity(targetParent);
  if (targetParentIdentity.kind !== "directory") {
    throw fail(`Migration publication parent is not a real directory: ${targetParent}`, "CONCURRENT_CHANGE");
  }
  if (record.desired.kind === "file") {
    const transferPath = publicationFileTransferPath(state, record, index);
    const transferOptions = {
      category: "publication-target-transfer",
      expected: record.desired,
      path: transferPath,
      source: record.staged,
      label: "Migration file publication transfer",
    };
    if (await optionalPhysicalPathIdentity(record.target)) {
      if (!(await publicationTargetIsProven(state, record, index))) {
        throw fail(`Migration destination appeared during publication: ${record.target}`, "CONCURRENT_CHANGE");
      }
      await removePublicationFileTransfer(
        state,
        record,
        index,
        transferOptions,
      );
      await expect(record.target, record.desired, "Published migration destination");
      await expect(record.staged, record.desired, "Staged migration publication");
      return;
    }

    let copiedAcrossDevices = false;
    try {
      await hooks.beforePublicationLinkAttempt?.({
        record,
        index,
        recoveryPath: transferPath,
      });
      await requirePublicationTargetContained(state, record);
      await requirePhysicalIdentity(
        targetParent,
        targetParentIdentity,
        "Migration publication parent",
      );
      await link(record.staged, record.target);
    } catch (error) {
      if (error?.code !== "EXDEV") throw error;
      copiedAcrossDevices = true;
      let transfer = await publicationFileTransferIdentity(
        state,
        record,
        index,
        transferOptions,
      );
      if (!transfer.actual) {
        await copyFile(record.staged, transferPath, fsConstants.COPYFILE_EXCL);
        transfer = await publicationFileTransferIdentity(
          state,
          record,
          index,
          transferOptions,
        );
        await hooks.afterPublicationFileTransferCopy?.({
          record,
          index,
          recoveryPath: transferPath,
        });
        await requireProvenancePathIdentity(
          state,
          transferPath,
          transfer.identity,
          transferOptions.label,
        );
      }
      await requirePublicationTargetContained(state, record);
      await requirePhysicalIdentity(
        targetParent,
        targetParentIdentity,
        "Migration publication parent",
      );
      await link(transferPath, record.target);
      if (!(await samePhysicalFile(transferPath, record.target))) {
        throw fail(
          `Published migration destination lacks transfer ownership: ${record.target}`,
          "CONCURRENT_CHANGE",
        );
      }
    }
    await hooks.afterPublicationLink?.({ record, index });
    await expect(record.target, record.desired, "Published migration destination");
    await expect(record.staged, record.desired, "Staged migration publication");
    if (copiedAcrossDevices) {
      await removePublicationFileTransfer(
        state,
        record,
        index,
        transferOptions,
      );
    }
    return;
  }

  const stagedState = await lstat(record.staged);
  if (!stagedState.isDirectory() || stagedState.isSymbolicLink()) {
    throw fail(`Staged migration publication is not a real directory: ${record.staged}`, "CONCURRENT_CHANGE");
  }
  await mkdir(record.target, { mode: stagedState.mode & 0o777 });
  record.reservation = await directoryIdentity(record.target);
  await writeProvenanceIdentityEvidence(
    state,
    "publication-target",
    index,
    record.target,
  );
  await persist(state);
  await hooks.afterPublicationReservation?.({ record, index });
  if (!(await isEmptyOwnedPublicationReservation(record))) {
    throw fail(`Migration destination reservation changed: ${record.target}`, "CONCURRENT_CHANGE");
  }
  await requireJournalContained(state.stageRoot, record.staged, "publication.staged", state.stageRoot);
  await requirePublicationTargetContained(state, record);
  await copyDirectoryContentsExclusive(
    record.staged,
    record.target,
    record.reservation,
    "Migration directory publication",
    {
      beforeEntry: async (entry) => hooks.beforePublicationEntryCopy?.({ record, index, ...entry }),
      afterEntry: async (entry) => hooks.afterPublicationEntryCopy?.({ record, index, ...entry }),
      evidence: {
        root: transferEvidenceRoot(state, "publication", index),
        forceCrossDeviceProof: await hooks.forceCrossDeviceProof?.({ record, index }) === true,
        stageRoot: state.stageRoot,
      },
    },
  );
  await expect(record.staged, record.desired, "Staged migration publication");
  await expect(record.target, record.desired, "Published migration destination");
}

async function restoreMovedPathWithoutReplace(
  state,
  source,
  sourceOwner,
  target,
  targetOwner,
  expected,
  label,
) {
  await requireJournalContained(sourceOwner, source, `${label} source`, state.stageRoot);
  await expect(source, expected, label);
  await mkdir(dirname(target), { recursive: true });
  await requireJournalContained(targetOwner, target, `${label} target`, state.stageRoot);
  if (expected.kind === "file") {
    await copyFile(source, target, fsConstants.COPYFILE_EXCL);
    await expect(target, expected, `${label} restoration`);
    await expect(source, expected, label);
    return;
  }
  const sourceState = await lstat(source);
  if (!sourceState.isDirectory() || sourceState.isSymbolicLink()) {
    throw fail(`${label} is not a real directory: ${source}`, "MUTATION_RECOVERY_FAILED");
  }
  await mkdir(target, { mode: sourceState.mode & 0o777 });
  const reservation = await directoryIdentity(target);
  await copyDirectoryContentsExclusive(source, target, reservation, `${label} restoration`);
  await expect(target, expected, `${label} restoration`);
  await expect(source, expected, label);
}

async function observeMigrationPath(path) {
  try {
    return { value: await snapshot(path), opaque: false };
  } catch (error) {
    if (error?.code === "UNSAFE_MIGRATION_PATH") {
      return { value: null, opaque: true };
    }
    throw error;
  }
}

async function restoreOpaqueMovedPathWithoutReplace(
  state,
  source,
  sourceOwner,
  target,
  targetOwner,
  label,
) {
  await requireOpaqueJournalEntryContained(sourceOwner, source, `${label} source`, state.stageRoot);
  const sourceState = await lstat(source, { bigint: true });
  await mkdir(dirname(target), { recursive: true });
  await requireJournalContained(targetOwner, target, `${label} target`, state.stageRoot);
  if (sourceState.isDirectory() && !sourceState.isSymbolicLink()) {
    await mkdir(target, { mode: Number(sourceState.mode & 0o777n) });
    const reservation = await directoryIdentity(target);
    await copyDirectoryContentsExclusive(source, target, reservation, `${label} restoration`);
    if (
      !samePhysicalIdentity(await physicalPathIdentity(source), identityFromState(sourceState))
      || !sameDirectoryIdentity(await directoryIdentity(target), reservation)
    ) {
      throw fail(`${label} restoration changed physical identity: ${target}`, "MUTATION_RECOVERY_FAILED");
    }
    return;
  }
  await link(source, target);
  const targetState = await lstat(target, { bigint: true });
  if (sourceState.dev !== targetState.dev || sourceState.ino !== targetState.ino) {
    throw fail(`${label} restoration changed physical identity: ${target}`, "MUTATION_RECOVERY_FAILED");
  }
}

function publicationBackupTransferDirectory(record) {
  return `${record.backup}.transfer`;
}

function publicationBackupTransferPath(record) {
  return join(publicationBackupTransferDirectory(record), "payload");
}

function publicationBackupReservationPath(record) {
  return record.previous?.kind === "file"
    ? publicationBackupTransferDirectory(record)
    : record.backup;
}

async function isOwnedPublicationBackupTransfer(record) {
  if (!record.backupReservation) return false;
  try {
    return sameDirectoryIdentity(
      await directoryIdentity(publicationBackupTransferDirectory(record)),
      record.backupReservation,
    );
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}


async function restoreChangedPublicationTransfer(

  state,
  record,
  recoveryPath,
  moved,
  { opaque = false } = {},
) {
  if (!(await isOwnedPublicationBackupTransfer(record))) {
    throw fail(
      `Migration backup recovery ownership changed: ${publicationBackupTransferDirectory(record)}`,
      "MUTATION_RECOVERY_FAILED",
    );
  }
  try {
    if (opaque) {
      await restoreOpaqueMovedPathWithoutReplace(
        state,
        recoveryPath,
        state.stageRoot,
        record.target,
        state.workspaceRoot,
        "Changed migration destination",
      );
    } else {
      await restoreMovedPathWithoutReplace(
        state,
        recoveryPath,
        state.stageRoot,
        record.target,
        state.workspaceRoot,
        moved,
        "Changed migration destination",
      );
    }
  } catch (error) {
    throw fail(
      `Migration destination changed and could not be restored safely: ${record.target}`,
      "MUTATION_RECOVERY_FAILED",
      [error.message],
    );
  }
  throw fail(`Migration destination changed during backup: ${record.target}`, "CONCURRENT_CHANGE");
}
async function prepareCopiedFilePublicationBackupWitness(
  state,
  record,
  index,
  hooks,
  transferPath,
  sourceIdentity,
  crossDevice = false,
) {
  const evidenceRoot = transferEvidenceRoot(state, "backup", index);
  const sourceRoot = dirname(record.target);
  const entry = basename(record.target);
  const evidence = {
    root: evidenceRoot,
    sourceWitness: true,
    beforeSourceWitness: () => hooks.beforePublicationBackupWitness?.({ record, index }),
    stageRoot: state.stageRoot,
  };
  const sourceOwnership = await captureTransferSourceEvidence(
    evidence,
    0,
    record.target,
    sourceRoot,
    "Migration copied backup",
  );
  const existing = await readTransferEntryEvidence(evidenceRoot, sourceRoot);
  if (!existing.has(entry)) {
    await recordTransferEntryEvidence(
      evidence,
      0,
      entry,
      transferPath,
      "Migration copied backup",
      sourceOwnership,
    );
  } else if (existing.size !== 1) {
    throw fail(
      `Migration copied backup witness has unexpected entries: ${evidenceRoot}`,
      "CONCURRENT_CHANGE",
    );
  }
  await requireFileSourceWitnessMatchesProvenance(
    evidenceRoot,
    sourceRoot,
    record.target,
    sourceIdentity,
    `publications[${index}].target`,
  );
  const recorded = (await readTransferEntryEvidence(evidenceRoot, sourceRoot)).get(entry);
  await requireTransferOwnedTree(
    transferPath,
    recorded.destination.node,
    recorded.destination.proofRoot,
    `publications[${index}] copied backup`,
  );
  await persist(state);
  if (crossDevice) {
    await hooks.afterPublicationBackupCrossDeviceWitness?.({
      record,
      index,
      recoveryPath: transferPath,
    });
  }
}

async function moveFilePublicationTargetToBackup(state, record, index, hooks) {
  const transferDirectory = publicationBackupTransferDirectory(record);
  const transferPath = publicationBackupTransferPath(record);
  await requireJournalContained(state.stageRoot, transferDirectory, "publication backup transfer", state.stageRoot);
  await requireJournalContained(state.stageRoot, transferPath, "publication backup transfer payload", state.stageRoot);

  await hooks.beforePublicationBackupTransfer?.({ record, index });
  let target = await observeMigrationPath(record.target);
  let backup = await observeMigrationPath(record.backup);
  let moved = await observeMigrationPath(transferPath);
  if (
    target.opaque
    || backup.opaque
    || moved.opaque
    || !sameSnapshot(target.value, record.previous)
    || backup.value !== null
    || moved.value !== null
  ) {
    throw fail(`Migration destination changed before backup transfer: ${record.target}`, "CONCURRENT_CHANGE");
  }
  const sourceIdentity = state.provenance.publications[index].previousIdentity;
  await requireProvenancePathIdentity(
    state,
    record.target,
    sourceIdentity,
    `publications[${index}].target`,
  );


  try {
    await mkdir(transferDirectory, { mode: 0o700 });
  } catch (error) {
    throw publicationCollision(error, record.target);
  }
  record.backupReservation = await directoryIdentity(transferDirectory);
  await persist(state);
  if (!(await isEmptyOwnedDirectory(transferDirectory, record.backupReservation))) {
    throw fail(`Migration backup transfer reservation changed: ${transferDirectory}`, "CONCURRENT_CHANGE");
  }

  await hooks.beforePublicationBackupMove?.({ record, index, recoveryPath: transferPath });
  await requireProvenancePathIdentity(
    state,
    record.target,
    sourceIdentity,
    `publications[${index}].target`,
  );
  target = await observeMigrationPath(record.target);
  const transferBeforeMove = await observeMigrationPath(transferPath);
  if (
    target.opaque
    || !sameSnapshot(target.value, record.previous)
    || transferBeforeMove.opaque
    || transferBeforeMove.value !== null
    || !(await isOwnedPublicationBackupTransfer(record))
  ) {
    throw fail(`Migration backup transfer destination changed: ${transferPath}`, "CONCURRENT_CHANGE");
  }
  let copiedAcrossDevices = false;
  try {
    await hooks.beforePublicationBackupRenameAttempt?.({
      record,
      index,
      recoveryPath: transferPath,
    });
    await link(record.target, transferPath);
  } catch (error) {
    if (error?.code !== "EXDEV") {
      throw publicationCollision(error, record.target);
    }
    try {
      await copyFile(record.target, transferPath, fsConstants.COPYFILE_EXCL);
    } catch (copyError) {
      throw publicationCollision(copyError, record.target);
    }
    copiedAcrossDevices = true;
  }
  await prepareCopiedFilePublicationBackupWitness(
    state,
    record,
    index,
    hooks,
    transferPath,
    sourceIdentity,
    copiedAcrossDevices,
  );
  await expect(record.target, record.previous, "Migration destination");
  await expect(transferPath, record.previous, "Migration backup transfer");
  await requireProvenancePathIdentity(
    state,
    record.target,
    sourceIdentity,
    `publications[${index}].target`,
  );
  await writeProvenanceIdentityEvidence(
    state,
    "publication-backup-transfer",
    index,
    transferPath,
  );
  await persist(state);
  if (copiedAcrossDevices) {
    await hooks.afterPublicationBackupPayloadCopy?.({
      record,
      index,
      recoveryPath: transferPath,
    });
  }
  await expect(record.target, record.previous, "Migration destination");
  await requireProvenancePathIdentity(
    state,
    record.target,
    sourceIdentity,
    `publications[${index}].target`,
  );
  await requireFileSourceWitnessMatchesProvenance(
    transferEvidenceRoot(state, "backup", index),
    dirname(record.target),
    record.target,
    sourceIdentity,
    `publications[${index}].target`,
  );
  await hooks.beforePublicationBackupSourceMove?.({
    record,
    index,
    recoveryPath: transferPath,
  });
  await expect(record.target, record.previous, "Migration destination");
  await requireProvenancePathIdentity(
    state,
    record.target,
    sourceIdentity,
    `publications[${index}].target`,
  );
  await requireFileSourceWitnessMatchesProvenance(
    transferEvidenceRoot(state, "backup", index),
    dirname(record.target),
    record.target,
    sourceIdentity,
    `publications[${index}].target`,
  );
  const sourceRecoveryPath = await moveFileSourceToWitnessRecovery(
    transferEvidenceRoot(state, "backup", index),
    dirname(record.target),
    record.target,
    sourceIdentity,
    "Migration destination",
  );
  if (copiedAcrossDevices) {
    await hooks.afterPublicationBackupCrossDeviceRemoval?.({
      record,
      index,
      recoveryPath: transferPath,
      sourceRecoveryPath,
    });
  }
  await hooks.afterPublicationBackupMove?.({ record, index, recoveryPath: transferPath });
  if (!(await isOwnedPublicationBackupTransfer(record))) {
    throw fail(
      `Migration backup recovery ownership changed: ${transferDirectory}`,
      "MUTATION_RECOVERY_FAILED",
    );
  }

  target = await observeMigrationPath(record.target);
  moved = await observeMigrationPath(transferPath);
  if (target.opaque || target.value !== null) {
    throw fail(`Migration destination changed during backup: ${record.target}`, "CONCURRENT_CHANGE");
  }
  if (moved.opaque) {
    await restoreChangedPublicationTransfer(state, record, transferPath, null, { opaque: true });
  }
  if (!sameSnapshot(moved.value, record.previous)) {
    await restoreChangedPublicationTransfer(state, record, transferPath, moved.value);
  }

  try {
    await link(transferPath, record.backup);
  } catch (error) {
    target = await observeMigrationPath(record.target);
    if (!target.opaque && target.value === null) {
      await restoreChangedPublicationTransfer(
        state,
        record,
        transferPath,
        record.previous,
      );
    }
    throw publicationCollision(error, record.target);
  }
  if (!(await isOwnedPublicationBackupTransfer(record))) {
    throw fail(
      `Migration backup recovery ownership changed: ${transferDirectory}`,
      "MUTATION_RECOVERY_FAILED",
    );
  }

  target = await observeMigrationPath(record.target);
  backup = await observeMigrationPath(record.backup);
  moved = await observeMigrationPath(transferPath);
  if (target.opaque || target.value !== null) {
    throw fail(`Migration destination changed during backup: ${record.target}`, "CONCURRENT_CHANGE");
  }
  if (moved.opaque) {
    await restoreChangedPublicationTransfer(state, record, transferPath, null, { opaque: true });
  }
  if (!sameSnapshot(moved.value, record.previous)) {
    await restoreChangedPublicationTransfer(state, record, transferPath, moved.value);
  }
  if (
    backup.opaque
    || !sameSnapshot(backup.value, record.previous)
    || !(await samePhysicalFile(transferPath, record.backup))
  ) {
    await restoreChangedPublicationTransfer(
      state,
      record,
      transferPath,
      record.previous,
    );
  }
  await removeOwnedDirectoryTree(
    transferDirectory,
    record.backupReservation,
    "Migration backup transfer reservation",
  );

  record.backupReservation = null;
  record.state = "backed-up";
  await persist(state);
}

async function movePublicationTargetToBackup(state, record, index, hooks) {
  const targetBefore = await observeMigrationPath(record.target);
  const backupBefore = await observeMigrationPath(record.backup);
  if (
    targetBefore.opaque
    || backupBefore.opaque
    || !sameSnapshot(targetBefore.value, record.previous)
    || backupBefore.value !== null
  ) {
    throw fail(`Migration destination changed before backup: ${record.target}`, "CONCURRENT_CHANGE");
  }

  if (record.previous.kind === "file") {
    await moveFilePublicationTargetToBackup(state, record, index, hooks);
    return;
  }

  const targetIdentity = await physicalPathIdentity(record.target);
  try {
    const targetState = await lstat(record.target);
    await mkdir(record.backup, { mode: targetState.mode & 0o777 });
    record.backupReservation = await directoryIdentity(record.backup);
    await writeProvenanceIdentityEvidence(
      state,
      "publication-backup",
      index,
      record.backup,
    );
    await persist(state);
    await hooks.beforePublicationBackupTransfer?.({ record, index });
    if (
      !(await isEmptyOwnedDirectory(record.backup, record.backupReservation))
      || !samePhysicalIdentity(await optionalPhysicalPathIdentity(record.target), targetIdentity)
    ) {
      throw fail(`Migration backup reservation changed: ${record.backup}`, "CONCURRENT_CHANGE");
    }
    await expect(record.target, record.previous, "Migration destination");
    await copyDirectoryContentsExclusive(
      record.target,
      record.backup,
      record.backupReservation,
      "Migration directory backup",
      {
        beforeEntry: async (entry) => hooks.beforePublicationBackupEntryCopy?.({
          record,
          index,
          ...entry,
        }),
        afterEntry: async (entry) => hooks.afterPublicationBackupEntryCopy?.({
          record,
          index,
          ...entry,
        }),
        evidence: {
          root: transferEvidenceRoot(state, "backup", index),
          forceCrossDeviceProof: await hooks.forceCrossDeviceProof?.({ record, index }) === true,
          sourceWitness: true,
          beforeSourceWitness: () => hooks.beforePublicationBackupWitness?.({ record, index }),
          stageRoot: state.stageRoot,
        },
      },
    );
    await hooks.afterPublicationBackupCopy?.({ record, index, recoveryPath: record.backup });
    await expect(record.target, record.previous, "Migration destination");
    await expect(record.backup, record.previous, "Migration backup");
    if (!samePhysicalIdentity(await optionalPhysicalPathIdentity(record.target), targetIdentity)) {
      throw fail(`Migration destination changed during backup: ${record.target}`, "CONCURRENT_CHANGE");
    }
    await removeTransferOwnedDirectoryResumable(
      record.target,
      targetIdentity,
      transferEvidenceRoot(state, "backup", index),
      "source",
      "Migration destination",
      state.provenance.publications[index].previousTree,
    );
  } catch (error) {
    throw publicationCollision(error, record.target);
  }
  await hooks.afterPublicationBackupMove?.({ record, index, recoveryPath: record.backup });

  const targetAfter = await observeMigrationPath(record.target);
  const backupAfter = await observeMigrationPath(record.backup);
  if (!targetAfter.opaque && targetAfter.value === null && backupAfter.opaque) {
    try {
      await restoreOpaqueMovedPathWithoutReplace(
        state,
        record.backup,
        state.stageRoot,
        record.target,
        state.workspaceRoot,
        "Changed migration destination",
      );
    } catch (error) {
      throw fail(
        `Migration destination changed and could not be restored safely: ${record.target}`,
        "MUTATION_RECOVERY_FAILED",
        [error.message],
      );
    }
    throw fail(`Migration destination changed during backup: ${record.target}`, "CONCURRENT_CHANGE");
  }
  if (
    targetAfter.opaque
    || backupAfter.opaque
    || targetAfter.value !== null
    || !sameSnapshot(backupAfter.value, record.previous)
  ) {
    if (!targetAfter.opaque && targetAfter.value === null && backupAfter.value) {
      try {
        await restoreMovedPathWithoutReplace(
          state,
          record.backup,
          state.stageRoot,
          record.target,
          state.workspaceRoot,
          backupAfter.value,
          "Changed migration destination",
        );
      } catch (error) {
        throw fail(
          `Migration destination changed and could not be restored safely: ${record.target}`,
          "MUTATION_RECOVERY_FAILED",
          [error.message],
        );
      }
    }
    throw fail(`Migration destination changed during backup: ${record.target}`, "CONCURRENT_CHANGE");
  }
  record.backupReservation = null;
  record.state = "backed-up";
  await persist(state);
}

function publicationCollision(error, target) {
  if (["EEXIST", "EISDIR", "ENOENT", "ENOTDIR", "ENOTEMPTY"].includes(error?.code)) {
    return fail(`Migration destination appeared during publication: ${target}`, "CONCURRENT_CHANGE");
  }
  return error;
}

async function removeTransferOwnedTreeResumable(
  path,
  node,
  proofRoot,
  label,
  { requireHardlink = false } = {},
) {
  const proofPath = join(proofRoot, "proof");
  await requirePhysicalIdentity(proofPath, node.proofIdentity, `${label} ownership proof`);
  const identity = await optionalPhysicalPathIdentity(path);
  if (!identity) return;
  if (!samePhysicalIdentity(identity, node.identity)) {
    throw fail(`${label} changed physical identity: ${path}`, "CONCURRENT_CHANGE");
  }
  if (node.identity.kind === "file") {
    if (!(requireHardlink ? await samePhysicalFile(path, proofPath) : await matchesTransferFileProof(path, proofPath))) {
      throw fail(`${label} file no longer matches its ownership proof: ${path}`, "CONCURRENT_CHANGE");
    }
    await removeOwnedLeaf(path, node.identity, label);
    return;
  }
  const proof = await readJson(proofPath);
  if (
    !hasExactKeys(proof, ["path", "identity"])
    || proof.path !== basename(path)
    || !samePhysicalIdentity(proof.identity, node.identity)
  ) {
    throw fail(`${label} directory no longer matches its ownership proof: ${path}`, "CONCURRENT_CHANGE");
  }
  const currentNames = (await readdir(path)).sort((left, right) => left.localeCompare(right));
  if (currentNames.some((name) => !node.children.has(name))) {
    throw fail(`${label} contains unowned concurrent entries: ${path}`, "CONCURRENT_CHANGE");
  }
  let childIndex = 0;
  for (const [name, child] of node.children) {
    await removeTransferOwnedTreeResumable(
      join(path, name),
      child,
      transferChildProofRoot(proofRoot, childIndex),
      label,
      { requireHardlink },
    );
    childIndex += 1;
  }
  await requirePhysicalIdentity(path, node.identity, label);
  if ((await readdir(path)).length !== 0) {
    throw fail(`${label} gained concurrent entries: ${path}`, "CONCURRENT_CHANGE");
  }
  await rmdir(path);
}

async function removeTransferOwnedDirectoryResumable(
  target,
  identity,
  evidenceRoot,
  evidenceKind,
  label,
  capturedSource = null,
) {
  if (evidenceKind === "source" && capturedSource) {
    await requireSourceWitnessMatchesProvenance(
      evidenceRoot,
      target,
      capturedSource,
      label,
    );
  }
  const currentIdentity = await optionalPhysicalPathIdentity(target);
  if (!currentIdentity) return;
  if (!samePhysicalIdentity(currentIdentity, identity)) {
    throw fail(`${label} changed physical identity: ${target}`, "CONCURRENT_CHANGE");
  }
  const evidence = await readTransferEntryEvidence(
    evidenceRoot,
    evidenceKind === "source" ? target : null,
  );
  const currentNames = (await readdir(target)).sort((left, right) => left.localeCompare(right));
  if (currentNames.some((name) => !evidence.has(name))) {
    throw fail(`${label} contains unowned concurrent entries: ${target}`, "CONCURRENT_CHANGE");
  }
  for (const name of currentNames) {
    const ownership = evidence.get(name)?.[evidenceKind];
    if (!ownership) {
      throw fail(`${label} lacks recursive ownership evidence: ${join(target, name)}`, "CONCURRENT_CHANGE");
    }
    await removeTransferOwnedTreeResumable(
      join(target, name),
      ownership.node,
      ownership.proofRoot,
      label,
      { requireHardlink: evidenceKind === "source" },
    );
  }
  await requirePhysicalIdentity(target, identity, label);
  if ((await readdir(target)).length !== 0) {
    throw fail(`${label} gained concurrent entries: ${target}`, "CONCURRENT_CHANGE");
  }
  await rmdir(target);
}

async function removePublishedPublicationForRollback(state, record, index, hooks) {
  if (record.rollbackState === "pending") {
    const current = await observeMigrationPath(record.target);
    if (record.desired === null) {
      if (current.opaque || current.value !== null) {
        throw new Error(`Newer destination preserved: ${record.target}`);
      }
      record.rollbackState = "remove-intent";
      await persist(state);
    } else {
      if (
        current.opaque
        || !sameSnapshot(current.value, record.desired)
        || !(await publicationTargetIsProven(state, record, index))
      ) {
        throw new Error(`Newer destination preserved: ${record.target}`);
      }
      record.rollbackRemovalIdentity = await physicalPathIdentity(record.target);
      record.rollbackState = "remove-intent";
      await persist(state);
    }
  }
  if (record.rollbackState !== "remove-intent") return;
  const quarantine = join(state.stageRoot, "rollback", String(index));
  await hooks.beforePublicationRollbackRename?.({ record, index, quarantine });
  const current = await observeMigrationPath(record.target);
  if (!current.opaque && current.value === null) {
    record.rollbackState = "removed";
    await persist(state);
    await hooks.afterPublicationRollbackRename?.({ record, index, quarantine });
    return;
  }
  if (
    current.opaque
    || !sameSnapshot(current.value, record.desired)
    || !samePhysicalIdentity(
      await optionalPhysicalPathIdentity(record.target),
      record.rollbackRemovalIdentity,
    )
    || !(await publicationTargetIsProven(state, record, index))
  ) {
    throw new Error(`Newer destination preserved: ${record.target}`);
  }
  if (record.desired.kind === "file") {
    await removeOwnedLeaf(
      record.target,
      record.rollbackRemovalIdentity,
      "Migration rollback destination",
    );
  } else {
    await removeTransferOwnedDirectoryResumable(
      record.target,
      record.rollbackRemovalIdentity,
      transferEvidenceRoot(state, "publication", index),
      "destination",
      "Migration rollback destination",
    );
  }
  record.rollbackState = "removed";
  await persist(state);
  await hooks.afterPublicationRollbackRename?.({ record, index, quarantine });
}

async function markUnchangedPublicationRolledBack(state, record) {
  const current = await observeMigrationPath(record.target);
  if (current.opaque || !sameSnapshot(current.value, record.previous)) {
    throw new Error(`Newer destination preserved: ${record.target}`);
  }
  record.rollbackRestoreIdentity = current.value
    ? await physicalPathIdentity(record.target)
    : null;
  record.rollbackState = "restored";
  await persist(state);
}

async function restorePublicationBackupForRollback(state, record, index, hooks) {
  if (record.rollbackState === "removed") {
    if (!record.previous) {
      record.rollbackRestoreIdentity = null;
      record.rollbackState = "restored";
      await persist(state);
      await hooks.afterPublicationRollbackRestore?.({ record, index });
      return;
    }
    record.rollbackRestoreIdentity = null;
    record.rollbackState = "restore-intent";
    await persist(state);
  }
  if (record.rollbackState === "restored") {
    const current = await observeMigrationPath(record.target);
    if (
      current.opaque
      || !sameSnapshot(current.value, record.previous)
      || !samePhysicalIdentity(
        await optionalPhysicalPathIdentity(record.target),
        record.rollbackRestoreIdentity,
      )
    ) {
      throw new Error(`Restored migration destination changed: ${record.target}`);
    }
    return;
  }
  if (record.rollbackState !== "restore-intent" || !record.previous) {
    throw new Error(`Cannot resume publication rollback: ${record.target}`);
  }
  await expect(record.backup, record.previous, "Migration backup");
  await requirePublicationTargetContained(state, record);
  let current = await observeMigrationPath(record.target);
  if (record.previous.kind === "file") {
    const transferPath = publicationFileTransferPath(state, record, index, "restore");
    const transferOptions = {
      category: "publication-restore-transfer",
      expected: record.previous,
      path: transferPath,
      source: record.backup,
      label: "Migration file rollback restoration transfer",
    };
    if (!current.opaque && current.value === null) {
      await mkdir(dirname(record.target), { recursive: true });
      const targetParent = dirname(record.target);
      await requirePublicationTargetContained(state, record);
      const targetParentIdentity = await physicalPathIdentity(targetParent);
      if (targetParentIdentity.kind !== "directory") {
        throw fail(
          `Migration rollback restoration parent is not a real directory: ${targetParent}`,
          "CONCURRENT_CHANGE",
        );
      }
      try {
        await hooks.beforePublicationRollbackRestoreLinkAttempt?.({
          record,
          index,
          recoveryPath: transferPath,
        });
        await requirePublicationTargetContained(state, record);
        await requirePhysicalIdentity(
          targetParent,
          targetParentIdentity,
          "Migration rollback restoration parent",
        );
        await link(record.backup, record.target);
      } catch (error) {
        if (error?.code !== "EXDEV") {
          throw publicationCollision(error, record.target);
        }
        let transfer = await publicationFileTransferIdentity(
          state,
          record,
          index,
          transferOptions,
        );
        if (!transfer.actual) {
          try {
            await copyFile(record.backup, transferPath, fsConstants.COPYFILE_EXCL);
          } catch (copyError) {
            throw publicationCollision(copyError, record.target);
          }
          transfer = await publicationFileTransferIdentity(
            state,
            record,
            index,
            transferOptions,
          );
          await hooks.afterPublicationRollbackRestoreFileTransferCopy?.({
            record,
            index,
            recoveryPath: transferPath,
          });
          await requireProvenancePathIdentity(
            state,
            transferPath,
            transfer.identity,
            transferOptions.label,
          );
        }
        try {
          await requirePublicationTargetContained(state, record);
          await requirePhysicalIdentity(
            targetParent,
            targetParentIdentity,
            "Migration rollback restoration parent",
          );
          await link(transferPath, record.target);
        } catch (linkError) {
          throw publicationCollision(linkError, record.target);
        }
      }
      current = await observeMigrationPath(record.target);
    }
    if (
      current.opaque
      || !sameSnapshot(current.value, record.previous)
      || !(await publicationRestoreTargetIsProven(state, record, index))
    ) {
      throw new Error(`Cannot reconcile publication restoration: ${record.target}`);
    }
    record.rollbackRestoreIdentity = await physicalPathIdentity(record.target);
    await removePublicationFileTransfer(
      state,
      record,
      index,
      transferOptions,
    );
    record.rollbackState = "restored";
    await persist(state);
    await hooks.afterPublicationRollbackRestore?.({ record, index });
    return;
  }

  if (!current.opaque && current.value === null) {
    const backupState = await lstat(record.backup);
    await mkdir(dirname(record.target), { recursive: true });
    await mkdir(record.target, { mode: backupState.mode & 0o777 });
    record.rollbackRestoreIdentity = await physicalPathIdentity(record.target);
    await writeProvenanceIdentityEvidence(
      state,
      "publication-restore-target",
      index,
      record.target,
    );
    await persist(state);
    await copyDirectoryContentsExclusive(
      record.backup,
      record.target,
      record.rollbackRestoreIdentity,
      "Migration rollback restoration",
      {
        afterEntry: async (entry) => hooks.afterPublicationRollbackRestoreEntryCopy?.({
          record,
          index,
          ...entry,
        }),
        evidence: {
          root: transferEvidenceRoot(state, "restore", index),
          forceCrossDeviceProof: await hooks.forceCrossDeviceProof?.({ record, index }) === true,
          stageRoot: state.stageRoot,
        },
      },
    );
    current = await observeMigrationPath(record.target);
  }
  if (
    current.opaque
    || !record.rollbackRestoreIdentity
    || !samePhysicalIdentity(
      await optionalPhysicalPathIdentity(record.target),
      record.rollbackRestoreIdentity,
    )
  ) {
    throw new Error(`Cannot reconcile publication restoration: ${record.target}`);
  }
  if (!sameSnapshot(current.value, record.previous)) {
    await removeTransferOwnedDirectoryResumable(
      record.target,
      record.rollbackRestoreIdentity,
      transferEvidenceRoot(state, "restore", index),
      "destination",
      "Migration rollback restoration",
    );
    record.rollbackRestoreIdentity = null;
    await persist(state);
    await restorePublicationBackupForRollback(state, record, index, hooks);
    return;
  }
  await requireTransferProvenanceDirectory(
    record.target,
    record.rollbackRestoreIdentity,
    transferEvidenceRoot(state, "restore", index),
    "destination",
    "Migration rollback restoration",
  );
  record.rollbackState = "restored";
  await persist(state);
  await hooks.afterPublicationRollbackRestore?.({ record, index });
}

async function publish(state, record, index, hooks) {
  await requirePublicationTargetContained(state, record);
  await expect(record.target, record.previous, "Migration destination");
  await hooks.beforePublish?.({ record, index });
  if (record.previous) {
    record.backup = join(state.stageRoot, "backups", String(index));
    record.state = "backup-intent";
    await persist(state);
    await mkdir(dirname(record.backup), { recursive: true });
    await requireJournalContained(state.stageRoot, record.backup, "publication.backup", state.stageRoot);
    await requirePublicationTargetContained(state, record);
    await movePublicationTargetToBackup(state, record, index, hooks);
  }
  record.state = "publish-intent";
  await persist(state);
  if (record.desired) {
    await requireJournalContained(state.stageRoot, record.staged, "publication.staged", state.stageRoot);
    await expect(record.staged, record.desired, "Staged migration publication");
    await hooks.beforePublicationPublish?.({ record, index });
    await expect(record.staged, record.desired, "Staged migration publication");
    try {
      await publishStagedWithoutReplace(state, record, index, hooks);
    } catch (error) {
      throw publicationCollision(error, record.target);
    }
    await hooks.afterPublicationRename?.({ record, index });
    await expect(record.target, record.desired, "Published migration destination");
    record.reservation = null;
  }
  record.state = "published";
  await persist(state);
}

async function reconcilePublicationBackupTransfer(state, record) {
  if (
    record.state !== "backup-intent"
    || record.previous?.kind !== "file"
    || !record.backup
  ) {
    return;
  }
  const transferDirectory = publicationBackupTransferDirectory(record);
  const transferPath = publicationBackupTransferPath(record);
  await requireJournalContained(state.stageRoot, transferDirectory, "publication backup transfer", state.stageRoot);
  await requireJournalContained(state.stageRoot, transferPath, "publication backup transfer payload", state.stageRoot);
  const transfer = await observeMigrationPath(transferDirectory);
  if (
    (transfer.opaque || transfer.value !== null)
    && !(await isOwnedPublicationBackupTransfer(record))
  ) {
    throw new Error(`Migration backup transfer ownership changed: ${transferDirectory}`);
  }
  const target = await observeMigrationPath(record.target);
  const backup = await observeMigrationPath(record.backup);
  const moved = await observeMigrationPath(transferPath);
  if (target.opaque || target.value !== null) {
    if (!moved.opaque && moved.value === null) return;
    if (
      !target.opaque
      && !moved.opaque
      && sameSnapshot(target.value, record.previous)
      && sameSnapshot(moved.value, record.previous)
      && await isOwnedPublicationBackupTransfer(record)
    ) {
      return;
    }
    throw new Error(`Migration destination and backup transfer were both preserved: ${record.target}`);
  }
  if (!moved.opaque && moved.value === null) return;
  if (moved.opaque) {
    await restoreOpaqueMovedPathWithoutReplace(
      state,
      transferPath,
      state.stageRoot,
      record.target,
      state.workspaceRoot,
      "Interrupted migration backup transfer",
    );
    return;
  }
  if (
    !sameSnapshot(moved.value, record.previous)
    || backup.opaque
    || !sameSnapshot(backup.value, record.previous)
  ) {
    await restoreMovedPathWithoutReplace(
      state,
      transferPath,
      state.stageRoot,
      record.target,
      state.workspaceRoot,
      moved.value,
      "Interrupted migration backup transfer",
    );
  }
  if (
    record.backupReservation
    && await isOwnedPublicationBackupTransfer(record)
  ) {
    await removeOwnedDirectoryTree(
      transferDirectory,
      record.backupReservation,
      "Migration backup transfer reservation",
    );
    record.backupReservation = null;
    await persist(state);
  }
}

async function rollback(state, hooks = {}) {
  await requireTransactionProvenanceObservation(state);
  const failures = [];
  for (let index = state.publications.length - 1; index >= 0; index -= 1) {
    const record = state.publications[index];
    try {
      await requirePublicationTargetContained(state, record);
      if (record.staged) {
        await requireJournalContained(state.stageRoot, record.staged, "publication.staged", state.stageRoot);
      }
      if (record.backup) {
        await requireJournalContained(state.stageRoot, record.backup, "publication.backup", state.stageRoot);
      }
      await reconcilePublicationBackupTransfer(state, record);

      if (record.rollbackState !== "pending") {
        if (record.rollbackState === "remove-intent") {
          await removePublishedPublicationForRollback(state, record, index, hooks);
        }
        await restorePublicationBackupForRollback(state, record, index, hooks);
        continue;
      }

      let current = await snapshot(record.target);
      const staged = record.staged ? await snapshot(record.staged) : null;
      let backup = record.backup ? await snapshot(record.backup) : null;

      if (record.state === "pending") {
        await markUnchangedPublicationRolledBack(state, record);
        continue;
      }

      if (record.state === "backup-intent") {
        const backupReservationPath = publicationBackupReservationPath(record);
        if (record.backupReservation && sameSnapshot(current, record.previous)) {
          await requireJournalContained(
            state.stageRoot,
            backupReservationPath,
            "publication backup reservation",
            state.stageRoot,
          );
          if (
            record.previous.kind === "directory"
            && sameDirectoryIdentity(
              await directoryIdentity(backupReservationPath).catch(() => null),
              record.backupReservation,
            )
          ) {
            await removeOwnedDirectorySubset(
              record.target,
              backupReservationPath,
              record.backupReservation,
              "Migration backup reservation",
              async () => hooks.afterPublicationBackupCleanupSnapshot?.({ record, index }),
              transferEvidenceRoot(state, "backup", index),
            );
            record.backupReservation = null;
            await persist(state);
            backup = null;
          } else if (
            record.previous.kind === "file"
            && sameDirectoryIdentity(
              await directoryIdentity(backupReservationPath).catch(() => null),
              record.backupReservation,
            )
          ) {
            await removeOwnedDirectoryTree(
              backupReservationPath,
              record.backupReservation,
              "Migration backup reservation",
              async () => hooks.afterPublicationBackupCleanupSnapshot?.({ record, index }),
            );
            record.backupReservation = null;
            await persist(state);
            backup = null;
          }
        }
        if (sameSnapshot(current, record.previous) && !backup) {
          await markUnchangedPublicationRolledBack(state, record);
          continue;
        }
        if (current || !sameSnapshot(backup, record.previous)) {
          throw new Error(`Cannot reconcile publication backup intent: ${record.target}`);
        }
      } else if (record.state === "backed-up") {
        if (current || !sameSnapshot(backup, record.previous)) {
          throw new Error(`Cannot reconcile backed-up publication: ${record.target}`);
        }
      } else if (record.state === "publish-intent") {
        if (record.desired?.kind === "file" && staged) {
          await removePublicationFileTransfer(
            state,
            record,
            index,
            {
              category: "publication-target-transfer",
              expected: record.desired,
              path: publicationFileTransferPath(state, record, index),
              source: record.staged,
              label: "Migration file publication transfer",
            },
          );
        }
        if (
          record.desired?.kind === "file"
          && current
          && staged
          && sameSnapshot(current, record.desired)
          && sameSnapshot(staged, record.desired)
          && await publicationTargetIsProven(state, record, index)
        ) {
          await removePublishedPublicationForRollback(state, record, index, hooks);
          current = null;
        } else if (
          record.reservation
          && record.desired?.kind === "directory"
          && staged
          && sameDirectoryIdentity(
            await directoryIdentity(record.target).catch(() => null),
            record.reservation,
          )
        ) {
          record.rollbackRemovalIdentity = await physicalPathIdentity(record.target);
          record.rollbackState = "remove-intent";
          await persist(state);
          await hooks.afterPublicationCleanupSnapshot?.({ record, index });
          await removeTransferOwnedDirectoryResumable(
            record.target,
            record.rollbackRemovalIdentity,
            transferEvidenceRoot(state, "publication", index),
            "destination",
            "Migration publication reservation",
          );
          record.rollbackState = "removed";
          await persist(state);
          current = null;
        }
        const publishCompleted = record.rollbackState === "removed"
          || (
            sameSnapshot(current, record.desired)
            && (record.desired === null || staged === null)
          );
        const publishNotStarted = current === null && sameSnapshot(staged, record.desired);
        if (!publishCompleted && !publishNotStarted) {
          throw new Error(`Cannot reconcile publication intent: ${record.target}`);
        }
        if (publishCompleted && current) {
          await removePublishedPublicationForRollback(state, record, index, hooks);
          current = null;
        } else if (publishNotStarted && record.rollbackState === "pending") {
          record.rollbackState = "removed";
          await persist(state);
        }
      } else if (record.state === "published") {
        await removePublishedPublicationForRollback(state, record, index, hooks);
        current = null;
      } else {
        throw new Error(`Unknown publication state: ${record.state}`);
      }

      if (record.rollbackState === "pending") {
        record.rollbackState = "removed";
        await persist(state);
      }
      if (record.previous) {
        const currentBackup = await snapshot(record.backup);
        if (!sameSnapshot(currentBackup, record.previous)) {
          throw new Error(`Migration backup changed: ${record.backup}`);
        }
      } else if (await pathExists(record.backup ?? "")) {
        throw new Error(`Unexpected migration backup: ${record.backup}`);
      }
      await restorePublicationBackupForRollback(state, record, index, hooks);
    } catch (error) {
      failures.push(error.message);
    }
  }
  if (failures.length) throw fail("Migration rollback was incomplete.", "MUTATION_RECOVERY_FAILED", failures);
}

async function verifyDestination(state) {
  await requireTransactionProvenanceObservation(state);
  for (const [index, record] of state.publications.entries()) {
    await requirePublicationTargetContained(state, record);
    await expect(record.target, record.desired, "Published migration destination");
    if (
      state.provenance?.publications?.[index]
      && record.desired !== null
      && !(await publicationTargetIsProven(state, record, index))
    ) {
      throw fail(
        `Published migration destination lacks transaction provenance: ${record.target}`,
        "CONCURRENT_CHANGE",
      );
    }
  }
  for (const [index, record] of state.destinationGuards.entries()) {
    const authority = state.provenance?.destinationGuards?.[index];
    if (authority) {
      await assertDestinationGuardProvenance(state, record, authority, index);
      continue;
    }
    await requireJournalContained(state.stageRoot, record.staged, "destinationGuard.staged", state.stageRoot);
    await expect(record.staged, record.desired, "Staged preserved migration destination");
    await requireJournalContained(state.workspaceRoot, record.target, "destinationGuard.target", state.stageRoot);
    await expect(record.target, record.desired, "Preserved migration destination");
  }
}

async function verifyRetiredSources(state) {
  for (const record of state.retirements) {
    if (record.state !== "retired") {
      throw fail(`Legacy migration source retirement is incomplete: ${record.path}`, "MUTATION_RECOVERY_FAILED");
    }
    await requireRetirementSourceContained(state, record);
    const source = await observeMigrationPath(record.path);
    if (source.opaque || source.value !== null) {
      throw fail(`Retired migration source reappeared: ${record.path}`, "CONCURRENT_CHANGE");
    }
    await requireJournalContained(state.stageRoot, record.retired, "retirement.retired", state.stageRoot);
    await expect(record.retired, record.expected, "Retired migration source");
  }
}
function retirementCollision(error, path) {
  if (["EEXIST", "EISDIR", "ENOENT", "ENOTDIR", "ENOTEMPTY"].includes(error?.code)) {
    return fail(`Legacy migration source changed during retirement: ${path}`, "CONCURRENT_CHANGE");
  }
  return error;
}

async function restoreChangedRetirement(state, record, moved, { opaque = false } = {}) {
  let recoveryRetained = false;
  try {
    if (opaque) {
      await restoreOpaqueMovedPathWithoutReplace(
        state,
        record.retired,
        state.stageRoot,
        record.path,
        retirementSourceOwner(state, record),
        "Changed legacy migration source",
      );
      recoveryRetained = true;
    } else {
      await restoreMovedPathWithoutReplace(
        state,
        record.retired,
        state.stageRoot,
        record.path,
        retirementSourceOwner(state, record),
        moved,
        "Changed legacy migration source",
      );
      recoveryRetained = moved.kind === "file";
    }
  } catch (error) {
    throw fail(
      `Legacy migration source changed and could not be restored safely: ${record.path}`,
      "MUTATION_RECOVERY_FAILED",
      [error.message],
    );
  }
  if (recoveryRetained) {
    throw fail(
      `Legacy migration source was restored with its recovery copy retained: ${record.path}`,
      "MUTATION_RECOVERY_FAILED",
    );
  }
  record.state = "pending";
  record.retired = null;
  record.reservation = null;
  await persist(state);
  throw fail(`Legacy migration source changed during retirement: ${record.path}`, "CONCURRENT_CHANGE");
}

function retirementTransferDirectory(record) {
  return `${record.retired}.transfer`;
}

function retirementTransferPath(record) {
  return join(retirementTransferDirectory(record), "payload");
}

function retirementReservationPath(record) {
  return record.expected.kind === "file"
    ? retirementTransferDirectory(record)
    : record.retired;
}

async function isOwnedRetirementTransfer(record) {
  if (!record.reservation) return false;
  try {
    return sameDirectoryIdentity(
      await directoryIdentity(retirementTransferDirectory(record)),
      record.reservation,
    );
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
async function isOwnedRetirementPayload(record) {
  return await isOwnedRetirementTransfer(record)
    && isDeepStrictEqual(await names(retirementTransferDirectory(record)), ["payload"]);
}


async function restoreChangedRetirementTransfer(
  state,
  record,
  recoveryPath,
  moved,
  { opaque = false } = {},
) {
  if (!(await isOwnedRetirementPayload(record))) {
    throw fail(
      `Legacy migration source recovery ownership changed: ${retirementTransferDirectory(record)}`,
      "MUTATION_RECOVERY_FAILED",
    );
  }
  try {
    if (opaque) {
      await restoreOpaqueMovedPathWithoutReplace(
        state,
        recoveryPath,
        state.stageRoot,
        record.path,
        retirementSourceOwner(state, record),
        "Changed legacy migration source",
      );
    } else {
      await restoreMovedPathWithoutReplace(
        state,
        recoveryPath,
        state.stageRoot,
        record.path,
        retirementSourceOwner(state, record),
        moved,
        "Changed legacy migration source",
      );
    }
  } catch (error) {
    throw fail(
      `Legacy migration source changed and could not be restored safely: ${record.path}`,
      "MUTATION_RECOVERY_FAILED",
      [error.message],
    );
  }
  throw fail(`Legacy migration source changed during retirement: ${record.path}`, "CONCURRENT_CHANGE");
}

async function finishMovedFileRetirement(state, record, index, hooks, recoveryPath) {
  if (!(await isOwnedRetirementPayload(record))) {
    throw fail(
      `Legacy migration source recovery ownership changed: ${retirementTransferDirectory(record)}`,
      "MUTATION_RECOVERY_FAILED",
    );
  }
  let source = await observeMigrationPath(record.path);
  let retired = await observeMigrationPath(record.retired);
  let moved = await observeMigrationPath(recoveryPath);
  if (source.opaque || source.value !== null) {
    throw fail(`Legacy migration source changed during retirement: ${record.path}`, "CONCURRENT_CHANGE");
  }
  if (moved.opaque) {
    await restoreChangedRetirementTransfer(state, record, recoveryPath, null, { opaque: true });
  }
  if (moved.value === null) {
    throw fail(
      `Legacy migration source recovery disappeared during retirement: ${recoveryPath}`,
      "MUTATION_RECOVERY_FAILED",
    );
  }
  if (!sameSnapshot(moved.value, record.expected)) {
    await restoreChangedRetirementTransfer(state, record, recoveryPath, moved.value);
  }
  const sourceIdentity = state.provenance.retirements[index].sourceIdentity;
  const movedIdentity = await physicalPathIdentity(recoveryPath);
  if (!samePhysicalIdentity(movedIdentity, sourceIdentity)) {
    await requireFileSourceWitnessMatchesProvenance(
      transferEvidenceRoot(state, "retirement", index),
      dirname(record.path),
      record.path,
      sourceIdentity,
      `retirements[${index}].path`,
    );
  }
  if (retired.opaque || retired.value !== null) {
    if (
      !retired.opaque
      && sameSnapshot(retired.value, record.expected)
      && await samePhysicalFile(recoveryPath, record.retired)
    ) {
      await hooks.afterSourceRetirementRename?.({ record, index });
      return;
    }
    await restoreChangedRetirementTransfer(
      state,
      record,
      recoveryPath,
      record.expected,
    );
  }

  try {
    await link(recoveryPath, record.retired);
  } catch (error) {
    source = await observeMigrationPath(record.path);
    if (!source.opaque && source.value === null) {
      await restoreChangedRetirementTransfer(
        state,
        record,
        recoveryPath,
        record.expected,
      );
    }
    throw retirementCollision(error, record.path);
  }
  if (!(await isOwnedRetirementPayload(record))) {
    throw fail(
      `Legacy migration source recovery ownership changed: ${retirementTransferDirectory(record)}`,
      "MUTATION_RECOVERY_FAILED",
    );
  }

  source = await observeMigrationPath(record.path);
  retired = await observeMigrationPath(record.retired);
  moved = await observeMigrationPath(recoveryPath);
  if (source.opaque || source.value !== null) {
    throw fail(`Legacy migration source changed during retirement: ${record.path}`, "CONCURRENT_CHANGE");
  }
  if (moved.opaque) {
    await restoreChangedRetirementTransfer(state, record, recoveryPath, null, { opaque: true });
  }
  if (moved.value === null) {
    throw fail(
      `Legacy migration source recovery disappeared during retirement: ${recoveryPath}`,
      "MUTATION_RECOVERY_FAILED",
    );

  }
  if (!sameSnapshot(moved.value, record.expected)) {
    await restoreChangedRetirementTransfer(state, record, recoveryPath, moved.value);
  }
  if (
    retired.opaque
    || !sameSnapshot(retired.value, record.expected)
    || !(await samePhysicalFile(recoveryPath, record.retired))
  ) {
    await restoreChangedRetirementTransfer(
      state,
      record,
      recoveryPath,
      record.expected,
    );
  }
  await hooks.afterSourceRetirementRename?.({ record, index });
}
async function prepareCopiedFileRetirementWitness(
  state,
  record,
  index,
  hooks,
  transferPath,
  sourceIdentity,
  crossDevice = false,
) {
  const evidenceRoot = transferEvidenceRoot(state, "retirement", index);
  const sourceRoot = dirname(record.path);
  const entry = basename(record.path);
  const evidence = {
    root: evidenceRoot,
    sourceWitness: true,
    beforeSourceWitness: () => hooks.beforeSourceRetirementWitness?.({ record, index }),
    stageRoot: state.stageRoot,
  };
  const sourceOwnership = await captureTransferSourceEvidence(
    evidence,
    0,
    record.path,
    sourceRoot,
    "Legacy migration copied retirement",
  );
  const existing = await readTransferEntryEvidence(evidenceRoot, sourceRoot);
  if (!existing.has(entry)) {
    await recordTransferEntryEvidence(
      evidence,
      0,
      entry,
      transferPath,
      "Legacy migration copied retirement",
      sourceOwnership,
    );
  } else if (existing.size !== 1) {
    throw fail(
      `Legacy migration copied retirement witness has unexpected entries: ${evidenceRoot}`,
      "CONCURRENT_CHANGE",
    );
  }
  await requireFileSourceWitnessMatchesProvenance(
    evidenceRoot,
    sourceRoot,
    record.path,
    sourceIdentity,
    `retirements[${index}].path`,
  );
  const recorded = (await readTransferEntryEvidence(evidenceRoot, sourceRoot)).get(entry);
  await requireTransferOwnedTree(
    transferPath,
    recorded.destination.node,
    recorded.destination.proofRoot,
    `retirements[${index}] copied payload`,
  );
  await persist(state);
  if (crossDevice) {
    await hooks.afterSourceRetirementCrossDeviceWitness?.({
      record,
      index,
      recoveryPath: transferPath,
    });
  }
}

async function removeCopiedRetirementSource(
  state,
  record,
  index,
  hooks,
  transferPath,
  sourceIdentity,
  crossDevice = false,
) {
  await expect(record.path, record.expected, "Legacy migration source");
  await expect(transferPath, record.expected, "Legacy migration source recovery");
  await requireProvenancePathIdentity(
    state,
    record.path,
    sourceIdentity,
    `retirements[${index}].path`,
  );
  let transferIdentity = await readProvenanceIdentityEvidence(
    state,
    "retirement-payload",
    index,
    transferPath,
  );
  if (!transferIdentity) {
    transferIdentity = await writeProvenanceIdentityEvidence(
      state,
      "retirement-payload",
      index,
      transferPath,
    );
    await persist(state);
  }
  await requireProvenancePathIdentity(
    state,
    transferPath,
    transferIdentity,
    `retirements[${index}] copied payload`,
  );
  await requireFileSourceWitnessMatchesProvenance(
    transferEvidenceRoot(state, "retirement", index),
    dirname(record.path),
    record.path,
    sourceIdentity,
    `retirements[${index}].path`,
  );
  if (crossDevice) {
    await hooks.beforeSourceRetirementCrossDeviceRemoval?.({
      record,
      index,
      recoveryPath: transferPath,
    });
  }
  await requireRetirementSourceAtMutation(state, record, index);
  await expect(record.path, record.expected, "Legacy migration source");
  await expect(transferPath, record.expected, "Legacy migration source recovery");
  await requireProvenancePathIdentity(
    state,
    record.path,
    sourceIdentity,
    `retirements[${index}].path`,
  );
  await requireProvenancePathIdentity(
    state,
    transferPath,
    transferIdentity,
    `retirements[${index}] copied payload`,
  );
  await requireFileSourceWitnessMatchesProvenance(
    transferEvidenceRoot(state, "retirement", index),
    dirname(record.path),
    record.path,
    sourceIdentity,
    `retirements[${index}].path`,
  );
  await hooks.beforeSourceRetirementWitnessMove?.({
    record,
    index,
    recoveryPath: transferPath,
  });
  await requireRetirementSourceAtMutation(state, record, index);
  await expect(record.path, record.expected, "Legacy migration source");
  await requireFileSourceWitnessMatchesProvenance(
    transferEvidenceRoot(state, "retirement", index),
    dirname(record.path),
    record.path,
    sourceIdentity,
    `retirements[${index}].path`,
  );
  await verifyDestination(state);
  const evidenceRoot = transferEvidenceRoot(state, "retirement", index);
  const sourceRecoveryPath = await moveFileSourceToWitnessRecovery(
    evidenceRoot,
    dirname(record.path),
    record.path,
    sourceIdentity,
    "Legacy migration source",
  );
  if (crossDevice) {
    await hooks.afterSourceRetirementCrossDeviceRemoval?.({
      record,
      index,
      recoveryPath: transferPath,
      sourceRecoveryPath,
    });
  }
}

async function moveFileSourceToRetired(state, record, index, hooks) {
  const transferDirectory = retirementTransferDirectory(record);
  const transferPath = retirementTransferPath(record);
  await requireJournalContained(state.stageRoot, transferDirectory, "retirement transfer", state.stageRoot);
  await requireJournalContained(state.stageRoot, transferPath, "retirement transfer payload", state.stageRoot);

  let source = await observeMigrationPath(record.path);
  let retired = await observeMigrationPath(record.retired);
  let moved = await observeMigrationPath(transferPath);
  if (
    !source.opaque
    && source.value === null
    && !retired.opaque
    && sameSnapshot(retired.value, record.expected)
  ) {
    return;
  }
  if (moved.opaque || moved.value !== null) {
    if (!(await isOwnedRetirementPayload(record))) {
      throw fail(
        `Legacy migration source recovery ownership changed: ${transferDirectory}`,
        "MUTATION_RECOVERY_FAILED",
      );
    }
    if (!moved.opaque && !sameSnapshot(moved.value, record.expected)) {
      throw fail(
        `Legacy migration source recovery changed: ${transferPath}`,
        "MUTATION_RECOVERY_FAILED",
      );
    }
    if (!source.opaque && source.value !== null) {
      const sourceIdentity = await requireRetirementSourceAtMutation(state, record, index);
      const copiedAcrossDevices = !(await samePhysicalFile(record.path, transferPath));
      await prepareCopiedFileRetirementWitness(
        state,
        record,
        index,
        hooks,
        transferPath,
        sourceIdentity,
        copiedAcrossDevices,
      );
      await removeCopiedRetirementSource(
        state,
        record,
        index,
        hooks,
        transferPath,
        sourceIdentity,
        copiedAcrossDevices,
      );
    }
    if (
      !moved.opaque
      && !(await readProvenanceIdentityEvidence(
        state,
        "retirement-payload",
        index,
        transferPath,
      ))
    ) {
      await writeProvenanceIdentityEvidence(
        state,
        "retirement-payload",
        index,
        transferPath,
      );
    }
    await hooks.afterSourceRetirementMove?.({ record, index, recoveryPath: transferPath });
    await hooks.afterSourceRetirementPayloadCopy?.({ record, index, recoveryPath: transferPath });
    await finishMovedFileRetirement(state, record, index, hooks, transferPath);
    return;
  }
  if (
    source.opaque
    || retired.opaque
    || !sameSnapshot(source.value, record.expected)
    || retired.value !== null
  ) {
    await resetUnmovedRetirement(state, record, retired);
    throw fail(`Legacy migration source changed before retirement: ${record.path}`, "CONCURRENT_CHANGE");
  }

  const sourceIdentity = await requireRetirementSourceAtMutation(state, record, index);
  await hooks.beforeSourceRetirementRename?.({ record, index });
  await requireRetirementSourceAtMutation(state, record, index);
  source = await observeMigrationPath(record.path);
  retired = await observeMigrationPath(record.retired);
  moved = await observeMigrationPath(transferPath);
  if (
    source.opaque
    || retired.opaque
    || moved.opaque
    || !sameSnapshot(source.value, record.expected)
    || retired.value !== null
    || moved.value !== null
  ) {
    await resetUnmovedRetirement(state, record, retired);
    throw fail(`Legacy migration source changed before retirement transfer: ${record.path}`, "CONCURRENT_CHANGE");
  }

  if (record.reservation) {
    if (!(await isEmptyOwnedDirectory(transferDirectory, record.reservation))) {
      throw fail(`Retired source transfer reservation changed: ${transferDirectory}`, "CONCURRENT_CHANGE");
    }
  } else {
    try {
      await mkdir(transferDirectory, { mode: 0o700 });
    } catch (error) {
      throw retirementCollision(error, record.path);
    }
    record.reservation = await directoryIdentity(transferDirectory);
    await writeProvenanceIdentityEvidence(
      state,
      "retirement-reservation",
      index,
      transferDirectory,
    );
    await persist(state);
  }
  if (!(await isEmptyOwnedDirectory(transferDirectory, record.reservation))) {
    throw fail(`Retired source transfer reservation changed: ${transferDirectory}`, "CONCURRENT_CHANGE");
  }

  source = await observeMigrationPath(record.path);
  retired = await observeMigrationPath(record.retired);
  moved = await observeMigrationPath(transferPath);
  if (
    source.opaque
    || retired.opaque
    || moved.opaque
    || !sameSnapshot(source.value, record.expected)
    || retired.value !== null
    || moved.value !== null
  ) {
    await resetUnmovedRetirement(state, record, retired);
    throw fail(`Legacy migration source changed before retirement move: ${record.path}`, "CONCURRENT_CHANGE");
  }

  await hooks.beforeSourceRetirementMove?.({ record, index, recoveryPath: transferPath });
  await requireRetirementSourceAtMutation(state, record, index);
  source = await observeMigrationPath(record.path);
  const transferBeforeMove = await observeMigrationPath(transferPath);
  if (
    source.opaque
    || !sameSnapshot(source.value, record.expected)
    || !samePhysicalIdentity(await optionalPhysicalPathIdentity(record.path), sourceIdentity)
    || transferBeforeMove.opaque
    || transferBeforeMove.value !== null
    || !(await isOwnedRetirementTransfer(record))
  ) {
    throw fail(`Retirement transfer destination changed: ${transferPath}`, "CONCURRENT_CHANGE");
  }
  await verifyDestination(state);
  let copiedAcrossDevices = false;
  try {
    await hooks.beforeSourceRetirementRenameAttempt?.({
      record,
      index,
      recoveryPath: transferPath,
    });
    await link(record.path, transferPath);
  } catch (error) {
    if (error?.code !== "EXDEV") {
      throw retirementCollision(error, record.path);
    }
    try {
      await copyFile(record.path, transferPath, fsConstants.COPYFILE_EXCL);
    } catch (copyError) {
      throw retirementCollision(copyError, record.path);
    }
    copiedAcrossDevices = true;
  }
  await prepareCopiedFileRetirementWitness(
    state,
    record,
    index,
    hooks,
    transferPath,
    sourceIdentity,
    copiedAcrossDevices,
  );
  await removeCopiedRetirementSource(
    state,
    record,
    index,
    hooks,
    transferPath,
    sourceIdentity,
    copiedAcrossDevices,
  );
  await hooks.afterSourceRetirementMove?.({ record, index, recoveryPath: transferPath });

  source = await observeMigrationPath(record.path);
  moved = await observeMigrationPath(transferPath);
  if (source.opaque || source.value !== null) {
    throw fail(`Legacy migration source changed during retirement: ${record.path}`, "CONCURRENT_CHANGE");
  }
  if (moved.opaque) {
    await restoreChangedRetirementTransfer(state, record, transferPath, null, { opaque: true });
  }
  if (moved.value === null) {
    throw fail(
      `Legacy migration source recovery disappeared during retirement: ${transferPath}`,
      "MUTATION_RECOVERY_FAILED",
    );
  }
  if (!sameSnapshot(moved.value, record.expected)) {
    await restoreChangedRetirementTransfer(state, record, transferPath, moved.value);
  }
  await hooks.afterSourceRetirementPayloadCopy?.({ record, index, recoveryPath: transferPath });

  await hooks.afterSourceRetirementCopy?.({ record, index, recoveryPath: transferPath });
  await finishMovedFileRetirement(state, record, index, hooks, transferPath);
}

async function resetUnmovedRetirement(state, record, retired) {
  if (retired.opaque || retired.value !== null) return;
  if (record.reservation) {
    const reservationPath = retirementReservationPath(record);
    if (
      !sameDirectoryIdentity(
        await directoryIdentity(reservationPath).catch(() => null),
        record.reservation,
      )
    ) return;
    await requireJournalContained(
      state.stageRoot,
      reservationPath,
      "retirement reservation",
      state.stageRoot,
    );
    await removeOwnedDirectoryTree(
      reservationPath,
      record.reservation,
      "Retirement reservation",
    );
  }
  record.state = "pending";
  record.retired = null;
  record.reservation = null;
  await persist(state);
}


async function moveSourceToRetired(state, record, index, hooks) {
  if (record.expected.kind === "file") {
    await moveFileSourceToRetired(state, record, index, hooks);
    return;
  }

  let source = await observeMigrationPath(record.path);
  let retired = await observeMigrationPath(record.retired);
  if (record.reservation) {
    if (
      !sameDirectoryIdentity(
        await directoryIdentity(record.retired).catch(() => null),
        record.reservation,
      )
    ) {
      throw fail(`Retired source reservation changed: ${record.retired}`, "CONCURRENT_CHANGE");
    }
    if (
      !source.opaque
      && source.value === null
      && !retired.opaque
      && sameSnapshot(retired.value, record.expected)
    ) {
      return;
    }
    if (
      !source.opaque
      && source.value
      && !retired.opaque
      && sameSnapshot(retired.value, record.expected)
    ) {
      const completeSource = sameSnapshot(source.value, record.expected);
      const sourceIdentity = await requireRetirementSourceAtMutation(
        state,
        record,
        index,
        { complete: completeSource },
      );
      if (!completeSource) {
        await requireTransferOwnedDirectorySubset(
          record.retired,
          record.path,
          sourceIdentity,
          "Legacy migration source",
          transferEvidenceRoot(state, "retirement", index),
          "source",
        );
      }
      await hooks.beforeSourceRetirementRemoval?.({ record, index, recoveryPath: record.retired });
      await requireRetirementSourceAtMutation(
        state,
        record,
        index,
        { complete: completeSource },
      );
      await verifyDestination(state);
      await removeOwnedDirectorySubset(
        record.retired,
        record.path,
        sourceIdentity,
        "Legacy migration source",
        async () => {
          await hooks.afterSourceRetirementRemovalSnapshot?.({ record, index });
          await verifyDestination(state);
        },
        transferEvidenceRoot(state, "retirement", index),
        "source",
      );
      await hooks.afterSourceRetirementMove?.({ record, index, recoveryPath: record.retired });
      await hooks.afterSourceRetirementRename?.({ record, index });
      return;
    }
    if (
      !source.opaque
      && sameSnapshot(source.value, record.expected)
      && !retired.opaque
      && retired.value
    ) {
      await requireRetirementSourceAtMutation(state, record, index);
      await removeOwnedDirectorySubset(
        record.path,
        record.retired,
        record.reservation,
        "Retired source reservation",
        async () => hooks.afterRetirementReservationCleanupSnapshot?.({ record, index }),
        transferEvidenceRoot(state, "retirement", index),
      );
      record.reservation = null;
      await persist(state);
      retired = { value: null, opaque: false };
    } else {
      throw fail(`Legacy migration source changed before retirement: ${record.path}`, "CONCURRENT_CHANGE");
    }
  }

  if (
    source.opaque
    || retired.opaque
    || !sameSnapshot(source.value, record.expected)
    || retired.value !== null
  ) {
    await resetUnmovedRetirement(state, record, retired);
    throw fail(`Legacy migration source changed before retirement: ${record.path}`, "CONCURRENT_CHANGE");
  }

  const sourceIdentity = await requireRetirementSourceAtMutation(state, record, index);
  await hooks.beforeSourceRetirementRename?.({ record, index });
  await requireRetirementSourceAtMutation(state, record, index);
  source = await observeMigrationPath(record.path);
  retired = await observeMigrationPath(record.retired);
  if (
    source.opaque
    || retired.opaque
    || !sameSnapshot(source.value, record.expected)
    || retired.value !== null
    || !samePhysicalIdentity(await optionalPhysicalPathIdentity(record.path), sourceIdentity)
  ) {
    await resetUnmovedRetirement(state, record, retired);
    throw fail(`Legacy migration source changed before retirement transfer: ${record.path}`, "CONCURRENT_CHANGE");
  }

  try {
    const sourceState = await lstat(record.path);
    await mkdir(record.retired, { mode: sourceState.mode & 0o777 });
    record.reservation = await directoryIdentity(record.retired);
    await writeProvenanceIdentityEvidence(
      state,
      "retirement-reservation",
      index,
      record.retired,
    );
    await persist(state);
    await hooks.afterSourceRetirementReservation?.({ record, index });
    await requireRetirementSourceAtMutation(state, record, index);
    if (
      !(await isEmptyOwnedDirectory(record.retired, record.reservation))
      || !samePhysicalIdentity(await optionalPhysicalPathIdentity(record.path), sourceIdentity)
    ) {
      throw fail(`Retired source reservation changed: ${record.retired}`, "CONCURRENT_CHANGE");
    }
    await copyDirectoryContentsExclusive(
      record.path,
      record.retired,
      record.reservation,
      "Legacy source retirement",
      {
        beforeEntry: async (entry) => hooks.beforeSourceRetirementEntryCopy?.({
          record,
          index,
          ...entry,
        }),
        afterEntry: async (entry) => hooks.afterSourceRetirementEntryCopy?.({
          record,
          index,
          ...entry,
        }),
        evidence: {
          root: transferEvidenceRoot(state, "retirement", index),
          forceCrossDeviceProof: await hooks.forceCrossDeviceProof?.({ record, index }) === true,
          sourceWitness: true,
          beforeSourceWitness: () => hooks.beforeSourceRetirementWitness?.({ record, index }),
          stageRoot: state.stageRoot,
        },
      },
    );
    await hooks.afterSourceRetirementCopy?.({ record, index, recoveryPath: record.retired });
    await requireRetirementSourceAtMutation(state, record, index);
    await expect(record.path, record.expected, "Legacy migration source");
    await expect(record.retired, record.expected, "Retired migration source");
    await requirePhysicalIdentity(record.path, sourceIdentity, "Legacy migration source");
    await hooks.beforeSourceRetirementRemoval?.({ record, index, recoveryPath: record.retired });
    await requireRetirementSourceAtMutation(state, record, index);
    await expect(record.path, record.expected, "Legacy migration source");
    await verifyDestination(state);
    await hooks.afterSourceRetirementRemovalSnapshot?.({ record, index });
    await verifyDestination(state);
    await requireTransferOwnedDirectorySubset(
      record.retired,
      record.path,
      sourceIdentity,
      "Legacy migration source",
      transferEvidenceRoot(state, "retirement", index),
      "source",
    );
    await removeTransferOwnedDirectoryResumable(
      record.path,
      sourceIdentity,
      transferEvidenceRoot(state, "retirement", index),
      "source",
      "Legacy migration source",
      state.provenance.retirements[index].sourceTree,
    );
  } catch (error) {
    throw retirementCollision(error, record.path);
  }
  await hooks.afterSourceRetirementMove?.({ record, index, recoveryPath: record.retired });
  await hooks.afterSourceRetirementRename?.({ record, index });
}

async function retire(state, hooks = {}) {
  state.phase = "retiring-source";
  await persist(state);
  for (const [index, record] of state.retirements.entries()) {
    await requireRetirementSourceContained(state, record);
    if (record.state === "retired") {
      if (await snapshot(record.path)) {
        throw fail(`Retired migration source reappeared: ${record.path}`, "CONCURRENT_CHANGE");
      }
      await requireJournalContained(state.stageRoot, record.retired, "retirement.retired", state.stageRoot);
      await expect(record.retired, record.expected, "Retired migration source");
      continue;
    }
    if (record.state === "pending") {
      await expect(record.path, record.expected, "Legacy migration source");
      await requireRetirementSourceAtMutation(state, record, index);
      await hooks.beforeSourceRetirement?.({ record, index });
      await requireRetirementSourceAtMutation(state, record, index);
      await verifyDestination(state);
      record.retired = join(state.stageRoot, "retired", String(index));
      record.state = "retire-intent";
      await persist(state);
    }
    if (record.state !== "retire-intent") {
      throw fail(`Unknown retirement state: ${record.state}`, "MUTATION_RECOVERY_FAILED");
    }
    await verifyDestination(state);
    await requireJournalContained(state.stageRoot, record.retired, "retirement.retired", state.stageRoot);
    await mkdir(dirname(record.retired), { recursive: true });
    await moveSourceToRetired(state, record, index, hooks);

    const currentSource = await observeMigrationPath(record.path);
    const currentRetired = await observeMigrationPath(record.retired);
    if (
      !currentSource.opaque
      && currentSource.value === null
      && !currentRetired.opaque
      && sameSnapshot(currentRetired.value, record.expected)
    ) {
      if (record.expected.kind === "file" && record.reservation) {
        const transferDirectory = retirementTransferDirectory(record);
        const transferPath = retirementTransferPath(record);
        const transferIdentity = {
          ...record.reservation,
          kind: "directory",
        };
        const payloadIdentity = await optionalPhysicalPathIdentity(transferPath);
        if (payloadIdentity) {
          if (!(await samePhysicalFile(transferPath, record.retired))) {
            throw fail(
              `Retirement transfer payload changed: ${transferPath}`,
              "MUTATION_RECOVERY_FAILED",
            );
          }
          await removeOwnedLeaf(
            transferPath,
            payloadIdentity,
            "Retirement transfer payload",
          );
        }
        const currentTransferIdentity = await optionalPhysicalPathIdentity(transferDirectory);
        if (currentTransferIdentity) {
          await requirePhysicalIdentity(
            transferDirectory,
            transferIdentity,
            "Retirement transfer",
          );
          if ((await readdir(transferDirectory)).length !== 0) {
            throw fail(
              `Retirement transfer gained concurrent entries: ${transferDirectory}`,
              "CONCURRENT_CHANGE",
            );
          }
          await rmdir(transferDirectory);
        }
      }
      record.reservation = null;
      record.state = "retired";
      await persist(state);
      continue;
    }
    if (!currentSource.opaque && currentSource.value === null && currentRetired.opaque) {
      await restoreChangedRetirement(state, record, null, { opaque: true });
    }
    if (
      !currentSource.opaque
      && currentSource.value === null
      && !currentRetired.opaque
      && currentRetired.value
    ) {
      await restoreChangedRetirement(state, record, currentRetired.value);
    }
    if (
      currentRetired.opaque
      || currentRetired.value
      || currentSource.opaque
    ) {
      throw fail(
        `Cannot reconcile source retirement intent without discarding newer state: ${record.path}`,
        "MUTATION_RECOVERY_FAILED",
      );
    }
    throw fail(`Legacy migration source changed during retirement: ${record.path}`, "CONCURRENT_CHANGE");
  }
}

async function publishReceiptExclusive(state, receiptPath, receipt, hooks) {
  const receiptParent = dirname(receiptPath);
  await mkdir(receiptParent, { recursive: true });
  await requireJournalContained(
    state.workspaceRoot,
    receiptParent,
    "receipt parent",
    state.stageRoot,
  );
  const receiptParentIdentity = await physicalPathIdentity(receiptParent);
  if (receiptParentIdentity.kind !== "directory") {
    throw fail(`Migration receipt parent is not a real directory: ${receiptParent}`, "CONCURRENT_CHANGE");
  }
  const temporary = join(
    dirname(receiptPath),
    `.from-user.sdd-receipt-${process.pid}-${randomUUID()}`,
  );
  await writeDurableFileExclusive(temporary, `${JSON.stringify(receipt, null, 2)}\n`);
  const temporaryIdentity = await physicalPathIdentity(temporary);
  await hooks.beforeReceiptLink?.({ state, receiptPath, temporary });
  await requireJournalContained(
    state.workspaceRoot,
    receiptParent,
    "receipt parent",
    state.stageRoot,
  );
  await requirePhysicalIdentity(
    receiptParent,
    receiptParentIdentity,
    "Migration receipt parent",
  );
  await requirePhysicalIdentity(temporary, temporaryIdentity, "Migration receipt temporary");
  if (state.stageCleanupEvidence) {
    await requirePreparedStage(state, state.stageCleanupEvidence);
  }
  await verifyDestination(state);
  await verifyRetiredSources(state);
  try {
    await link(temporary, receiptPath);
  } catch (error) {
    throw mutationCollision(error, receiptPath, "Migration receipt");
  }
  const receiptIdentity = await physicalPathIdentity(receiptPath);
  if (!samePhysicalIdentity(receiptIdentity, temporaryIdentity)) {
    throw fail(
      `Migration receipt changed physical identity: ${receiptPath}`,
      "MUTATION_RECOVERY_FAILED",
    );
  }
  const published = await readJson(receiptPath);
  if (!isDeepStrictEqual(published, receipt)) {
    throw fail(`Migration receipt changed during publication: ${receiptPath}`, "CONCURRENT_CHANGE");
  }
  await hooks.afterReceiptLink?.({ state, receiptPath, temporary });
  if (state.stageCleanupEvidence) {
    await requirePreparedStage(state, state.stageCleanupEvidence);
  }
  await requirePhysicalIdentity(receiptPath, receiptIdentity, "Migration receipt");
  await requirePhysicalIdentity(temporary, temporaryIdentity, "Migration receipt temporary");
  const confirmed = await readJson(receiptPath);
  if (!isDeepStrictEqual(confirmed, receipt)) {
    throw fail(`Migration receipt changed after publication: ${receiptPath}`, "CONCURRENT_CHANGE");
  }
  await removeOwnedLeaf(temporary, temporaryIdentity, "Migration receipt temporary");
  return receiptIdentity;
}
async function cleanupOwnedReceiptTemporaries(receiptPath, receiptIdentity) {
  const parent = dirname(receiptPath);
  for (const name of await names(parent)) {
    if (!name.startsWith(".from-user.sdd-receipt-")) continue;
    const temporary = join(parent, name);
    if (!(await samePhysicalFile(temporary, receiptPath))) continue;
    const temporaryIdentity = await physicalPathIdentity(temporary);
    if (!samePhysicalIdentity(temporaryIdentity, receiptIdentity)) continue;
    await removeOwnedLeaf(temporary, temporaryIdentity, "Migration receipt temporary");
  }
}

function createOwnedEvidenceSpec() {
  return { children: new Map(), identity: null };
}

function addOwnedEvidenceLeaf(spec, root, path, identity, label) {
  const relativePath = relative(root, path);
  if (
    !relativePath
    || relativePath === ".."
    || relativePath.startsWith(`..${sep}`)
    || resolve(root, relativePath) !== resolve(path)
  ) {
    throw fail(`${label} is outside its evidence namespace: ${path}`, "CONCURRENT_CHANGE");
  }
  const parts = relativePath.split(sep);
  let node = spec;
  for (const [index, part] of parts.entries()) {
    const leaf = index === parts.length - 1;
    let child = node.children.get(part);
    if (!child) {
      child = leaf
        ? { children: null, identity }
        : createOwnedEvidenceSpec();
      node.children.set(part, child);
    } else if (
      leaf
        ? child.children !== null || !samePhysicalIdentity(child.identity, identity)
        : child.children === null
    ) {
      throw fail(`${label} has conflicting ownership records: ${path}`, "CONCURRENT_CHANGE");
    }
    node = child;
  }
}

async function captureOwnedEvidenceDirectory(path, spec, label) {
  const identity = await physicalPathIdentity(path);
  if (identity.kind !== "directory") {
    throw fail(`${label} is not a real directory: ${path}`, "CONCURRENT_CHANGE");
  }
  if (spec.identity && !samePhysicalIdentity(identity, spec.identity)) {
    throw fail(`${label} changed physical identity: ${path}`, "CONCURRENT_CHANGE");
  }
  const currentNames = (await readdir(path)).sort((left, right) => left.localeCompare(right));
  const ownedNames = [...spec.children.keys()].sort((left, right) => left.localeCompare(right));
  if (!isDeepStrictEqual(currentNames, ownedNames)) {
    throw fail(`${label} contains entries without transaction ownership: ${path}`, "CONCURRENT_CHANGE");
  }
  const children = new Map();
  for (const name of ownedNames) {
    const childSpec = spec.children.get(name);
    const childPath = join(path, name);
    if (childSpec.children === null) {
      await requirePhysicalIdentity(childPath, childSpec.identity, label);
      children.set(name, { identity: childSpec.identity, children: null });
    } else {
      children.set(
        name,
        await captureOwnedEvidenceDirectory(childPath, childSpec, label),
      );
    }
  }
  await requirePhysicalIdentity(path, identity, label);
  return { identity, children };
}

function addTransferProofEvidence(spec, evidenceRoot, proofRoot, node, label) {
  addOwnedEvidenceLeaf(
    spec,
    evidenceRoot,
    join(proofRoot, "proof"),
    node.proofIdentity,
    label,
  );
  if (!node.children) return;
  for (const [index, child] of [...node.children.values()].entries()) {
    addTransferProofEvidence(
      spec,
      evidenceRoot,
      transferChildProofRoot(proofRoot, index),
      child,
      label,
    );
  }
}

async function captureOwnedProvenanceEvidence(state) {
  const root = join(state.stageRoot, PROVENANCE_EVIDENCE_DIRECTORY);
  const rootIdentity = await optionalPhysicalPathIdentity(root);
  if (!rootIdentity) return null;
  const spec = createOwnedEvidenceSpec();
  const categories = [
    ["publication-target", state.publications.length],
    ["publication-backup", state.publications.length],
    ["publication-backup-transfer", state.publications.length],
    ["publication-target-transfer", state.publications.length],
    ["publication-restore-target", state.publications.length],
    ["publication-restore-transfer", state.publications.length],
    ["retirement-payload", state.retirements.length],
    ["retirement-reservation", state.retirements.length],
  ];
  for (const [category, count] of categories) {
    for (let index = 0; index < count; index += 1) {
      const evidencePath = provenanceIdentityEvidencePath(state, category, index);
      const identity = await optionalPhysicalPathIdentity(evidencePath);
      if (!identity) continue;
      if (identity.kind !== "file") {
        throw fail(`Provenance evidence is not a regular file: ${evidencePath}`, "CONCURRENT_CHANGE");
      }
      const proofPath = provenanceIdentityEvidenceProofPath(state, category, index);
      await requirePhysicalIdentity(proofPath, identity, "Provenance evidence proof");
      if (!(await samePhysicalFile(evidencePath, proofPath))) {
        throw fail(`Provenance evidence proof is unowned: ${proofPath}`, "CONCURRENT_CHANGE");
      }
      addOwnedEvidenceLeaf(spec, root, evidencePath, identity, "Provenance evidence");
      addOwnedEvidenceLeaf(spec, root, proofPath, identity, "Provenance evidence proof");
    }
  }
  return captureOwnedEvidenceDirectory(root, spec, "Migration provenance evidence");
}

async function captureOwnedTransferEvidenceRoot(root, label, sourceRoot = null) {
  const rootIdentity = await optionalPhysicalPathIdentity(root);
  if (!rootIdentity) return null;
  const records = await readTransferEntryEvidence(root, sourceRoot);
  const spec = createOwnedEvidenceSpec();
  for (const ownership of records.values()) {
    const indexName = String(ownership.index).padStart(6, "0");
    const manifestPath = join(root, `${indexName}.json`);
    const manifestProof = join(transferProofRoot(root, ownership.index), "manifest");
    const manifestIdentity = await physicalPathIdentity(manifestPath);
    if (
      manifestIdentity.kind !== "file"
      || !(await samePhysicalFile(manifestPath, manifestProof))
    ) {
      throw fail(`${label} manifest is unowned: ${manifestPath}`, "CONCURRENT_CHANGE");
    }
    addOwnedEvidenceLeaf(spec, root, manifestPath, manifestIdentity, label);
    addOwnedEvidenceLeaf(spec, root, manifestProof, manifestIdentity, label);
    if (!sourceRoot) {
      addTransferProofEvidence(
        spec,
        root,
        ownership.source.proofRoot,
        ownership.source.node,
        label,
      );
    }
    addTransferProofEvidence(
      spec,
      root,
      ownership.destination.proofRoot,
      ownership.destination.node,
      label,
    );
  }
  if (sourceRoot) {
    const recordPath = transferSourceWitnessRecordPath(root);
    const recordIdentity = await physicalPathIdentity(recordPath);
    const recordProofPath = transferSourceWitnessRecordProofPath(root);
    await requirePhysicalIdentity(recordProofPath, recordIdentity, `${label} witness record proof`);
    if (!(await samePhysicalFile(recordPath, recordProofPath))) {
      throw fail(`${label} witness record is unowned: ${recordPath}`, "CONCURRENT_CHANGE");
    }
    addOwnedEvidenceLeaf(spec, root, recordPath, recordIdentity, label);
    addOwnedEvidenceLeaf(spec, root, recordProofPath, recordIdentity, label);
    const intentPath = transferSourceWitnessIntentPath(root);
    const intentIdentity = await optionalPhysicalPathIdentity(intentPath);
    if (intentIdentity) {
      const intentProofPath = transferSourceWitnessIntentProofPath(root);
      await requirePhysicalIdentity(intentProofPath, intentIdentity, `${label} witness intent proof`);
      if (!(await samePhysicalFile(intentPath, intentProofPath))) {
        throw fail(`${label} witness intent is unowned: ${intentPath}`, "CONCURRENT_CHANGE");
      }
      const intent = await readJson(intentPath);
      if (
        !hasExactKeys(intent, ["version", "sourceRoot", "witnessRoot", "witnessIdentity"])
        || intent.version !== 1
        || intent.sourceRoot !== resolve(sourceRoot)
        || intent.witnessRoot !== resolve(transferSourceWitnessRoot(sourceRoot, root))
      ) {
        throw fail(`${label} witness intent is invalid: ${intentPath}`, "CONCURRENT_CHANGE");
      }
      assertProvenanceIdentity(
        intent.witnessIdentity,
        `${label} witness intent`,
        root,
        { kind: "directory" },
      );
      addOwnedEvidenceLeaf(spec, root, intentPath, intentIdentity, label);
      addOwnedEvidenceLeaf(spec, root, intentProofPath, intentIdentity, label);
    }
    const reservationIntentPath =
      transferSourceWitnessReservationIntentPath(root);
    const reservationIntentIdentity =
      await optionalPhysicalPathIdentity(reservationIntentPath);
    if (reservationIntentIdentity) {
      const reservationIntentProofPath =
        transferSourceWitnessReservationIntentProofPath(root);
      await requirePhysicalIdentity(
        reservationIntentProofPath,
        reservationIntentIdentity,
        `${label} witness reservation intent proof`,
      );
      if (!(await samePhysicalFile(reservationIntentPath, reservationIntentProofPath))) {
        throw fail(
          `${label} witness reservation intent is unowned: ${reservationIntentPath}`,
          "CONCURRENT_CHANGE",
        );
      }
      const reservationIntent = await readJson(reservationIntentPath);
      if (
        !hasExactKeys(reservationIntent, ["version", "sourceRoot", "witnessRoot"])
        || reservationIntent.version !== 1
        || reservationIntent.sourceRoot !== resolve(sourceRoot)
        || reservationIntent.witnessRoot
          !== resolve(transferSourceWitnessRoot(sourceRoot, root))
      ) {
        throw fail(
          `${label} witness reservation intent is invalid: ${reservationIntentPath}`,
          "CONCURRENT_CHANGE",
        );
      }
      addOwnedEvidenceLeaf(
        spec,
        root,
        reservationIntentPath,
        reservationIntentIdentity,
        label,
      );
      addOwnedEvidenceLeaf(
        spec,
        root,
        reservationIntentProofPath,
        reservationIntentIdentity,
        label,
      );
    }
  }
  return captureOwnedEvidenceDirectory(root, spec, label);
}

async function captureOwnedTransferEvidence(state) {
  const transferRoot = join(state.stageRoot, "transfer-evidence");
  const transferIdentity = await optionalPhysicalPathIdentity(transferRoot);
  if (!transferIdentity) return null;
  if (transferIdentity.kind !== "directory") {
    throw fail(`Migration transfer evidence is not a directory: ${transferRoot}`, "CONCURRENT_CHANGE");
  }
  const spec = createOwnedEvidenceSpec();
  for (const [kind, count] of [
    ["publication", state.publications.length],
    ["backup", state.publications.length],
    ["restore", state.publications.length],
    ["retirement", state.retirements.length],
  ]) {
    for (let index = 0; index < count; index += 1) {
      const root = transferEvidenceRoot(state, kind, index);
      let sourceRoot = kind === "backup"
        && state.publications[index]?.previous?.kind === "directory"
        ? state.publications[index].target
        : kind === "retirement"
          && state.retirements[index]?.expected?.kind === "directory"
          ? state.retirements[index].path
          : null;
      if (
        kind === "backup"
        && state.publications[index]?.previous?.kind === "file"
        && await hasTransferSourceWitnessState(root)
      ) {
        sourceRoot = dirname(state.publications[index].target);
      }
      if (
        kind === "retirement"
        && state.retirements[index]?.expected?.kind === "file"
        && await hasTransferSourceWitnessState(root)
      ) {
        sourceRoot = dirname(state.retirements[index].path);
      }
      const captured = await captureOwnedTransferEvidenceRoot(
        root,
        `Migration ${kind} transfer evidence`,
        sourceRoot,
      );
      if (!captured) continue;
      const kindSpec = spec.children.get(kind) ?? createOwnedEvidenceSpec();
      spec.children.set(kind, kindSpec);
      kindSpec.children.set(String(index), {
        children: captured.children,
        identity: captured.identity,
      });
    }
  }
  return captureOwnedEvidenceDirectory(
    transferRoot,
    spec,
    "Migration transfer evidence",
  );
}


async function captureOwnedStageDirectory(path, entries, label) {
  const identity = await physicalPathIdentity(path);
  if (identity.kind !== "directory") {
    throw fail(`${label} is not a real directory: ${path}`, "CONCURRENT_CHANGE");
  }
  const currentNames = (await readdir(path)).sort((left, right) => left.localeCompare(right));
  const ownedNames = [...entries.keys()].sort((left, right) => left.localeCompare(right));
  if (!isDeepStrictEqual(currentNames, ownedNames)) {
    throw fail(`${label} contains entries without transaction ownership: ${path}`, "CONCURRENT_CHANGE");
  }
  return {
    identity,
    children: new Map([...entries].sort(([left], [right]) => left.localeCompare(right))),
  };
}

async function captureOwnedStageTree(state) {
  await requireStageIntentObservation(state);
  await requireTransactionProvenanceObservation(state);
  const children = new Map();
  const addLeaf = async (name, path, identity, label) => {
    await requirePhysicalIdentity(path, identity, label);
    children.set(name, { identity, children: null });
  };

  await requireCapturedTree(
    join(state.stageRoot, "payload"),
    state.provenance.stagePayloadTree,
    "Authenticated migration payload",
  );
  children.set("payload", state.provenance.stagePayloadTree);
  await addLeaf(
    STAGE_INTENT_NAME,
    stageIntentPath(state.stageRoot),
    state.stageIntentIdentity,
    "Migration stage intent",
  );
  await addLeaf(
    STAGE_INTENT_PROOF_NAME,
    stageIntentProofPath(state.stageRoot),
    state.stageIntentProofIdentity,
    "Migration stage intent proof",
  );
  await addLeaf(
    PROVENANCE_NAME,
    transactionProvenancePath(state.stageRoot),
    state.provenanceIdentity,
    "Transaction provenance",
  );
  await addLeaf(
    PROVENANCE_PROOF_NAME,
    transactionProvenanceProofPath(state.stageRoot),
    state.provenanceProofIdentity,
    "Transaction provenance proof",
  );

  for (let generation = 1; generation <= state.journalGeneration; generation += 1) {
    const generationName = `transaction.${String(generation).padStart(12, "0")}.json`;
    const proofName = `transaction.${String(generation).padStart(12, "0")}.proof`;
    const generationPath = join(state.stageRoot, generationName);
    const proofPath = join(state.stageRoot, proofName);
    const generationIdentity = await physicalPathIdentity(generationPath);
    const proofIdentity = await physicalPathIdentity(proofPath);
    if (
      !samePhysicalIdentity(generationIdentity, proofIdentity)
      || !(await samePhysicalFile(generationPath, proofPath))
    ) {
      throw fail(`Migration journal generation lacks ownership proof: ${generationPath}`, "CONCURRENT_CHANGE");
    }
    children.set(generationName, { identity: generationIdentity, children: null });
    children.set(proofName, { identity: proofIdentity, children: null });
  }
  await addLeaf(
    JOURNAL_NAME,
    state.journalPath,
    state.journalIdentity,
    "Migration journal",
  );

  const backupEntries = new Map();
  for (const [index, record] of state.publications.entries()) {
    if (!record.backup || !(await optionalPhysicalPathIdentity(record.backup))) continue;
    await expect(record.backup, record.previous, "Migration backup");
    if (record.previous.kind === "file") {
      const transferIdentity = await readProvenanceIdentityEvidence(
        state,
        "publication-backup-transfer",
        index,
        publicationBackupTransferPath(record),
      );
      await requireProvenancePathIdentity(
        state,
        record.backup,
        transferIdentity ?? state.provenance.publications[index].previousIdentity,
        `publications[${index}] backup`,
      );
    }
    else {
      const identity = await readProvenanceIdentityEvidence(
        state,
        "publication-backup",
        index,
        record.backup,
      );
      await requireTransferProvenanceDirectory(
        record.backup,
        identity,
        transferEvidenceRoot(state, "backup", index),
        "destination",
        `publications[${index}] backup`,
      );
    }
    backupEntries.set(String(index), await capturePhysicalTree(record.backup));
  }
  if (backupEntries.size > 0) {
    children.set(
      "backups",
      await captureOwnedStageDirectory(
        join(state.stageRoot, "backups"),
        backupEntries,
        "Migration backups",
      ),
    );
  }

  const retiredEntries = new Map();
  for (const [index, record] of state.retirements.entries()) {
    if (!record.retired || !(await optionalPhysicalPathIdentity(record.retired))) continue;
    await expect(record.retired, record.expected, "Retired migration source");
    const category = record.expected.kind === "file"
      ? "retirement-payload"
      : "retirement-reservation";
    const identity = await readProvenanceIdentityEvidence(
      state,
      category,
      index,
      record.expected.kind === "file" ? retirementTransferPath(record) : record.retired,
    );
    if (record.expected.kind === "file") {
      await requireProvenancePathIdentity(
        state,
        record.retired,
        identity,
        `retirements[${index}] retired payload`,
      );
    } else {
      await requireTransferProvenanceDirectory(
        record.retired,
        identity,
        transferEvidenceRoot(state, "retirement", index),
        "destination",
        `retirements[${index}] retired payload`,
      );
    }
    retiredEntries.set(String(index), await capturePhysicalTree(record.retired));
  }
  if (retiredEntries.size > 0) {
    children.set(
      "retired",
      await captureOwnedStageDirectory(
        join(state.stageRoot, "retired"),
        retiredEntries,
        "Retired migration sources",
      ),
    );
  }

  const provenanceEvidence = await captureOwnedProvenanceEvidence(state);
  if (provenanceEvidence) {
    children.set(PROVENANCE_EVIDENCE_DIRECTORY, provenanceEvidence);
  }
  const transferEvidence = await captureOwnedTransferEvidence(state);
  if (transferEvidence) {
    children.set("transfer-evidence", transferEvidence);
  }

  const actualNames = (await readdir(state.stageRoot)).sort((left, right) => left.localeCompare(right));
  const ownedNames = [...children.keys()].sort((left, right) => left.localeCompare(right));
  if (!isDeepStrictEqual(actualNames, ownedNames)) {
    throw fail(
      `Migration stage contains entries without transaction ownership: ${state.stageRoot}`,
      "CONCURRENT_CHANGE",
    );
  }
  return {
    identity: state.stageIdentity,
    children: new Map([...children].sort(([left], [right]) => left.localeCompare(right))),
  };
}

async function cleanupTransferSourceWitnesses(state) {
  for (const [index, record] of state.publications.entries()) {
    const evidenceRoot = transferEvidenceRoot(state, "backup", index);
    if (!(await hasTransferSourceWitnessState(evidenceRoot))) continue;
    await cleanupTransferSourceWitness(
      evidenceRoot,
      record.previous?.kind === "file" ? dirname(record.target) : record.target,
      `Migration backup source ${index}`,
    );
  }
  for (const [index, record] of state.retirements.entries()) {
    const evidenceRoot = transferEvidenceRoot(state, "retirement", index);
    if (!(await hasTransferSourceWitnessState(evidenceRoot))) continue;
    await cleanupTransferSourceWitness(
      evidenceRoot,
      record.expected.kind === "file" ? dirname(record.path) : record.path,
      `Migration retirement source ${index}`,
    );
  }
}

async function preflightOwnedStageCleanup(state, hooks = {}) {
  await requireTransactionProvenanceObservation(state);
  await requireJournalContained(state.workspaceRoot, state.stageRoot, "stageRoot", state.stageRoot);
  if (
    !sameDirectoryIdentity(
      await directoryIdentity(state.stageRoot).catch(() => null),
      state.stageIdentity,
    )
  ) {
    throw fail(`Migration stage changed physical identity: ${state.stageRoot}`, "CONCURRENT_CHANGE");
  }
  await requirePhysicalIdentity(state.journalPath, state.journalIdentity, "Migration journal");
  await cleanupTransferSourceWitnesses(state);
  await hooks.beforeStageCleanup?.({ state });
  const captured = await captureOwnedStageTree(state);
  const evidence = {
    captured,
    journalGeneration: state.journalGeneration,
    journalIdentity: state.journalIdentity,
  };
  await hooks.afterStageCleanupSnapshot?.({ state });
  await requireTransactionProvenanceObservation(state);
  await requireCapturedTree(state.stageRoot, captured, "Migration stage");
  await requirePhysicalIdentity(state.journalPath, state.journalIdentity, "Migration journal");
  state.stageCleanupEvidence = evidence;
  return evidence;
}

async function requirePreparedStage(state, evidence) {
  if (!evidence) return null;
  if (!sameDirectoryIdentity(evidence.captured.identity, state.stageIdentity)) {
    throw fail(`Migration stage ownership changed: ${state.stageRoot}`, "CONCURRENT_CHANGE");
  }
  if (evidence.journalGeneration === state.journalGeneration) {
    await requireCapturedTree(state.stageRoot, evidence.captured, "Migration stage");
    await requirePhysicalIdentity(state.journalPath, evidence.journalIdentity, "Migration journal");
    return evidence.captured;
  }
  if (
    state.phase !== "committed"
    || state.journalGeneration !== evidence.journalGeneration + 1
  ) {
    throw fail(`Migration stage journal advanced unexpectedly: ${state.stageRoot}`, "CONCURRENT_CHANGE");
  }
  const generationName = `transaction.${String(state.journalGeneration).padStart(12, "0")}.json`;
  const proofName = `transaction.${String(state.journalGeneration).padStart(12, "0")}.proof`;
  if (
    evidence.captured.children.has(generationName)
    || evidence.captured.children.has(proofName)
  ) {
    throw fail(`Migration journal generation was pre-existing: ${generationName}`, "CONCURRENT_CHANGE");
  }
  const generationPath = join(state.stageRoot, generationName);
  const generation = await capturePhysicalTree(generationPath);
  const proofPath = join(state.stageRoot, proofName);
  const proof = await capturePhysicalTree(proofPath);
  if (
    generation.identity.kind !== "file"
    || proof.identity.kind !== "file"
    || !samePhysicalIdentity(generation.identity, state.journalIdentity)
    || !samePhysicalIdentity(proof.identity, state.journalIdentity)
    || !(await samePhysicalFile(generationPath, state.journalPath))
    || !(await samePhysicalFile(generationPath, proofPath))
  ) {
    throw fail(`Migration committed journal lacks physical ownership: ${generationPath}`, "CONCURRENT_CHANGE");
  }
  const children = new Map(evidence.captured.children);

  children.set(JOURNAL_NAME, generation);
  children.set(generationName, generation);
  children.set(proofName, proof);
  const committed = {
    identity: evidence.captured.identity,
    children: new Map([...children].sort(([left], [right]) => left.localeCompare(right))),
  };
  await requireCapturedTree(state.stageRoot, committed, "Migration stage");
  return committed;
}

async function removeOwnedStage(state, evidence = null) {
  await requireJournalContained(state.workspaceRoot, state.stageRoot, "stageRoot", state.stageRoot);
  if (
    !sameDirectoryIdentity(
      await directoryIdentity(state.stageRoot).catch(() => null),
      state.stageIdentity,
    )
  ) {
    throw fail(`Migration stage changed physical identity: ${state.stageRoot}`, "CONCURRENT_CHANGE");
  }
  await requirePhysicalIdentity(state.journalPath, state.journalIdentity, "Migration journal");
  if (!evidence) {
    throw fail(`Migration stage cleanup lacks an ownership allowlist: ${state.stageRoot}`, "MUTATION_RECOVERY_FAILED");
  }
  const captured = await requirePreparedStage(state, evidence);
  if (state.phase === "committed") {
    await verifyDestination(state);
    await verifyRetiredSources(state);
  }
  await removeCapturedTree(state.stageRoot, captured, "Migration stage");
}

async function cleanupTransactionProvenanceAuthority(state) {
  if (!state.provenanceAuthorityIdentity || !state.provenanceSource) return;
  const authorityPath = transactionProvenanceAuthorityPath(state.workspaceRoot, state.stageRoot);
  const authorityProofPath = transactionProvenanceAuthorityProofPath(
    state.workspaceRoot,
    state.stageRoot,
  );
  const provenanceHash = createHash("sha256").update(state.provenanceSource).digest("hex");
  const expectedSource = transactionProvenanceAuthoritySource(
    state.stageRoot,
    state.provenance.stageIdentity,
    provenanceHash,
  );
  await Promise.all([
    requireJournalContained(
      state.workspaceRoot,
      authorityPath,
      "transaction provenance authority",
      state.stageRoot,
    ),
    requireJournalContained(
      state.workspaceRoot,
      authorityProofPath,
      "transaction provenance authority proof",
      state.stageRoot,
    ),
    requirePhysicalIdentity(
      authorityPath,
      state.provenanceAuthorityIdentity,
      "Transaction provenance authority",
    ),
    requirePhysicalIdentity(
      authorityProofPath,
      state.provenanceAuthorityIdentity,
      "Transaction provenance authority proof",
    ),
  ]);
  if (
    await readFile(authorityPath, "utf8") !== expectedSource
    || await readFile(authorityProofPath, "utf8") !== expectedSource
    || !(await samePhysicalFile(authorityPath, authorityProofPath))
  ) {
    throw fail("Transaction provenance authority changed before cleanup.", "CONCURRENT_CHANGE");
  }
  await removeOwnedLeaf(
    authorityProofPath,
    state.provenanceAuthorityIdentity,
    "Transaction provenance authority proof",
  );
  await removeOwnedLeaf(
    authorityPath,
    state.provenanceAuthorityIdentity,
    "Transaction provenance authority",
  );
}
async function cleanupOwnedStage(state, hooks = {}) {
  const evidence = await preflightOwnedStageCleanup(state, hooks);
  await removeOwnedStage(state, evidence);
  await cleanupTransactionProvenanceAuthority(state);
  await cleanupStageIntentAuthority(state);
}

async function retractCommittedReceipt(state, receiptPath, cause) {
  const failures = [];
  const receiptIdentity = state.receiptIdentity;
  const stageOwned = sameDirectoryIdentity(
    await directoryIdentity(state.stageRoot).catch(() => null),
    state.stageIdentity,
  );
  const journalOwned = samePhysicalIdentity(
    await optionalPhysicalPathIdentity(state.journalPath),
    state.journalIdentity,
  );
  if (stageOwned && journalOwned) {
    state.receipt = null;
    state.receiptIdentity = null;
    state.phase = "retiring-source";
    await persist(state).catch((error) => failures.push(`journal reset: ${error.message}`));
  }
  const currentReceipt = await optionalPhysicalPathIdentity(receiptPath);
  if (currentReceipt) {
    if (!receiptIdentity || !samePhysicalIdentity(currentReceipt, receiptIdentity)) {
      failures.push(`receipt replacement preserved: ${receiptPath}`);
    } else {
      await removeOwnedLeaf(
        receiptPath,
        currentReceipt,
        "Incomplete migration receipt",
      ).catch((error) => failures.push(`receipt retraction: ${error.message}`));
    }
  }
  if (failures.length > 0) {
    throw fail(
      "Migration commit cleanup failed and could not be fully retracted.",
      "MUTATION_RECOVERY_FAILED",
      [cause.message, ...failures],
    );
  }
}

async function finish(state, hooks = {}) {
  await verifyDestination(state);
  await retire(state, hooks);
  await hooks.beforeReceiptCommit?.({ state });
  await verifyDestination(state);
  await verifyRetiredSources(state);
  await hooks.beforeStageDeletion?.({ state });
  await verifyDestination(state);
  await verifyRetiredSources(state);
  const stageCleanupEvidence = await preflightOwnedStageCleanup(state, hooks);
  await verifyDestination(state);
  await verifyRetiredSources(state);
  const receiptPath = resolve(state.workspaceRoot, RECEIPT_RELATIVE_PATH);
  await requireJournalContained(state.workspaceRoot, receiptPath, "receipt.path", state.stageRoot);
  let receipt = state.receipt?.value ?? null;
  if (!receipt) {
    const existingIdentity = await optionalPhysicalPathIdentity(receiptPath);
    if (existingIdentity) {
      if (existingIdentity.kind !== "file") {
        throw fail(`Migration receipt is not a regular file: ${receiptPath}`, "CONCURRENT_CHANGE");
      }
      const existingReceipt = await readJson(receiptPath);
      assertReceiptValue(existingReceipt, state.workspaceRoot, state.legacyUserRoot, state.stageRoot);
      receipt = existingReceipt;
      state.receiptIdentity = existingIdentity;
    }
  }
  if (!receipt) {
    receipt = {
      version: 1,
      workspaceRoot: state.workspaceRoot,
      legacyUserRoot: state.legacyUserRoot,
      completedAt: new Date().toISOString(),
    };
    state.receiptIdentity = await publishReceiptExclusive(state, receiptPath, receipt, hooks);
  }
  if (!state.receiptIdentity) {
    state.receiptIdentity = await physicalPathIdentity(receiptPath);
    if (state.receiptIdentity.kind !== "file") {
      throw fail(`Migration receipt is not a regular file: ${receiptPath}`, "CONCURRENT_CHANGE");
    }
    const published = await readJson(receiptPath);
    if (!isDeepStrictEqual(published, receipt)) {
      throw fail(`Migration receipt changed before commit: ${receiptPath}`, "CONCURRENT_CHANGE");
    }
  }
  await cleanupOwnedReceiptTemporaries(receiptPath, state.receiptIdentity);
  state.receipt = { path: receiptPath, value: receipt };
  await requirePreparedStage(state, stageCleanupEvidence);
  state.phase = "committed";
  try {
    await persist(state);
    await removeOwnedStage(state, stageCleanupEvidence);
  } catch (error) {
    await retractCommittedReceipt(state, receiptPath, error);
    throw error;
  }
  await cleanupTransactionProvenanceAuthority(state);
  await cleanupStageIntentAuthority(state);
  return receipt;
}

function assertManagedDestinationProvenance(destination, provenance, stageRoot, label) {
  const records = destination.type === "publication"
    ? provenance.publications
    : provenance.destinationGuards;
  const source = records[destination.index];
  const desired = destination.record.desired;
  if (
    !source
    || source.kind !== destination.record.kind
    || source.staged !== destination.record.staged
    || !isDeepStrictEqual(source.desired, desired)
    || !source.stagedIdentity
    || source.stagedIdentity.kind !== desired?.kind
    || (desired?.kind === "directory" && source.stagedTree === null)
  ) {
    throw invalidJournal(
      stageRoot,
      `${label} lacks authenticated transaction-created source provenance.`,
    );
  }
}

async function assertJournal(journal, stageRoot, workspaceRoot, legacyUserRoot) {
  if (
    !hasExactKeys(journal, [
      "version",
      "phase",
      "workspaceRoot",
      "legacyUserRoot",
      "workspaceSkillsRoot",
      "legacySkillsRoot",
      "stageRoot",
      "publications",
      "destinationGuards",
      "retirements",
      "receipt",
    ])
    || journal.version !== JOURNAL_VERSION
    || !JOURNAL_PHASES.has(journal.phase)
    || journal.stageRoot !== stageRoot
    || journal.workspaceRoot !== workspaceRoot
    || journal.legacyUserRoot !== legacyUserRoot
    || typeof journal.workspaceSkillsRoot !== "string"
    || typeof journal.legacySkillsRoot !== "string"
    || !Array.isArray(journal.publications)
    || !Array.isArray(journal.destinationGuards)
    || !Array.isArray(journal.retirements)
  ) {
    throw invalidJournal(stageRoot, "The top-level transaction shape is invalid.");
  }
  const journalDirectoryHashVersions = collectJournalDirectoryHashVersions(journal);
  if (
    journalDirectoryHashVersions.has(null)
    || journalDirectoryHashVersions.size > 1
  ) {
    throw invalidJournal(stageRoot, "Transaction mixes or does not recognize directory hash versions.");
  }
  await requireJournalContained(workspaceRoot, stageRoot, "stageRoot", stageRoot);
  const stageIntentState = await readStageIntent(
    stageRoot,
    workspaceRoot,
    legacyUserRoot,
  );
  const provenanceState = await readTransactionProvenance(
    journal,
    stageRoot,
    workspaceRoot,
    legacyUserRoot,
  );
  if (!samePhysicalIdentity(provenanceState.provenance.stageIdentity, stageIntentState.stageIdentity)) {
    throw invalidJournal(stageRoot, "Transaction provenance disagrees with the stage reservation.");
  }

  const publicationTargets = new Set();
  const publicationPayloads = new Set();
  const skillPublications = [];
  const recoveryDestinations = new Map();
  const plannedBriefDestinations = new Map();
  const skillDestinations = new Map();
  const changeGuards = new Map();
  let changesPublication = null;
  let changesRootGuard = null;
  let workflowDestination = null;
  let installationLockDestination = null;
  let workspaceConfigPublication = null;
  for (const [index, record] of journal.publications.entries()) {
    if (
      !hasExactKeys(record, [
        "kind",
        "target",
        "previous",
        "staged",
        "desired",
        "backup",
        "backupReservation",
        "reservation",
        "state",
        "rollbackState",
        "rollbackRemovalIdentity",
        "rollbackRestoreIdentity",
      ])
      || typeof record.kind !== "string"
      || !record.kind
      || !PUBLICATION_STATES.has(record.state)
      || !PUBLICATION_ROLLBACK_STATES.has(record.rollbackState)
      || typeof record.target !== "string"
    ) {
      throw invalidJournal(stageRoot, `publications[${index}] is invalid.`);
    }
    assertJournalSnapshot(record.previous, `publications[${index}].previous`, stageRoot);
    assertJournalSnapshot(record.desired, `publications[${index}].desired`, stageRoot);
    assertJournalDirectoryIdentity(
      record.backupReservation,
      `publications[${index}].backupReservation`,
      stageRoot,
    );
    assertJournalDirectoryIdentity(
      record.reservation,
      `publications[${index}].reservation`,
      stageRoot,
    );
    assertProvenanceIdentity(
      record.rollbackRemovalIdentity,
      `publications[${index}].rollbackRemovalIdentity`,
      stageRoot,
      { nullable: true },
    );
    assertProvenanceIdentity(
      record.rollbackRestoreIdentity,
      `publications[${index}].rollbackRestoreIdentity`,
      stageRoot,
      { nullable: true },
    );
    if (
      (record.rollbackState === "pending"
        && (record.rollbackRemovalIdentity !== null || record.rollbackRestoreIdentity !== null))
      || (record.rollbackState === "remove-intent" && record.rollbackRestoreIdentity !== null)
      || (
        record.rollbackState === "restore-intent"
        && (record.previous === null || record.rollbackRestoreIdentity?.kind === "file")
      )
      || (
        record.rollbackState === "restored"
        && (
          (record.previous === null) !== (record.rollbackRestoreIdentity === null)
          || (record.previous && record.rollbackRestoreIdentity?.kind !== record.previous.kind)
        )
      )
      || (
        record.rollbackRemovalIdentity
        && record.rollbackRemovalIdentity.kind !== record.desired?.kind
      )
    ) {
      throw invalidJournal(stageRoot, `publications[${index}] has an impossible rollback state.`);
    }
    if (record.kind !== "planned-brief") {
      await requireJournalContained(workspaceRoot, record.target, `publications[${index}].target`, stageRoot);
    }
    const target = resolve(record.target);
    if (publicationTargets.has(target)) {
      throw invalidJournal(stageRoot, `publications[${index}].target is duplicated.`);
    }
    publicationTargets.add(target);

    if (record.kind === "workspace-config") {
      if (workspaceConfigPublication) {
        throw invalidJournal(stageRoot, "The workspace config publication is duplicated.");
      }
      workspaceConfigPublication = record;
      requireExactJournalPath(record.target, getWorkspaceConfigPath(workspaceRoot), `publications[${index}].target`, stageRoot);
      assertJournalSnapshot(record.previous, `publications[${index}].previous`, stageRoot, { kinds: ["file"] });
      assertJournalSnapshot(record.desired, `publications[${index}].desired`, stageRoot, {
        nullable: false,
        kinds: ["file"],
      });
    } else if (record.kind === "changes") {
      changesPublication = { index, record, type: "publication" };
      requireExactJournalPath(
        record.target,
        join(workspaceRoot, CONFIG_DIRECTORY_NAME, CHANGES_DIRECTORY_NAME),
        `publications[${index}].target`,
        stageRoot,
      );
      assertJournalSnapshot(record.previous, `publications[${index}].previous`, stageRoot, { kinds: ["directory"] });
      assertJournalSnapshot(record.desired, `publications[${index}].desired`, stageRoot, {
        nullable: false,
        kinds: ["directory"],
      });
    } else if (record.kind === "workflow") {
      workflowDestination = { index, record, type: "publication" };
      requireExactJournalPath(record.target, resolve(workspaceRoot, WORKFLOW_RELATIVE_PATH), `publications[${index}].target`, stageRoot);
      assertJournalSnapshot(record.previous, `publications[${index}].previous`, stageRoot, { kinds: ["file"] });
      assertJournalSnapshot(record.desired, `publications[${index}].desired`, stageRoot, {
        nullable: false,
        kinds: ["file"],
      });
    } else if (record.kind === "installation-lock") {
      installationLockDestination = { index, record, type: "publication" };
      requireExactJournalPath(record.target, getWorkspaceInstallLockPath(workspaceRoot), `publications[${index}].target`, stageRoot);
      assertJournalSnapshot(record.previous, `publications[${index}].previous`, stageRoot, { kinds: ["file"] });
      assertJournalSnapshot(record.desired, `publications[${index}].desired`, stageRoot, {
        nullable: false,
        kinds: ["file"],
      });
    } else if (record.kind === "recovery") {
      const recoveryName = basename(record.target);
      assertJournalRecoveryName(recoveryName, `publications[${index}].target`, stageRoot);
      requireExactJournalPath(
        record.target,
        join(getWorkspaceConfigDirectory(workspaceRoot), recoveryName),
        `publications[${index}].target`,
        stageRoot,
      );
      if (record.previous !== null) {
        throw invalidJournal(stageRoot, `publications[${index}].target is not a recovery destination.`);
      }
      assertJournalSnapshot(record.desired, `publications[${index}].desired`, stageRoot, { nullable: false });
      recoveryDestinations.set(recoveryName, { index, record });
    } else if (record.kind === "planned-brief") {
      if (record.previous !== null) {
        throw invalidJournal(stageRoot, `publications[${index}] would replace an existing Change Brief.`);
      }
      assertJournalSnapshot(record.desired, `publications[${index}].desired`, stageRoot, {
        nullable: false,
        kinds: ["file"],
      });
      plannedBriefDestinations.set(target, { index, record });
    } else if (record.kind.startsWith("skill:")) {
      const skillName = record.kind.slice("skill:".length);
      if (!/^sdd-[a-z0-9-]+$/.test(skillName)) {
        throw invalidJournal(stageRoot, `publications[${index}] has an invalid skill destination.`);
      }
      assertJournalSnapshot(record.previous, `publications[${index}].previous`, stageRoot, { kinds: ["directory"] });
      assertJournalSnapshot(record.desired, `publications[${index}].desired`, stageRoot, { kinds: ["directory"] });
      if (record.previous === null && record.desired === null) {
        throw invalidJournal(stageRoot, `publications[${index}] has no observable skill transition.`);
      }
      skillPublications.push({ index, record, skillName });
      skillDestinations.set(skillName, { index, record, type: "publication" });
    } else {
      throw invalidJournal(stageRoot, `publications[${index}].kind is unknown.`);
    }

    if (record.desired === null) {
      if (record.staged !== null) {
        throw invalidJournal(stageRoot, `publications[${index}].staged must be null for removal.`);
      }
    } else {
      const expectedStaged = expectedStagedPath(record, stageRoot);
      requireExactJournalPath(record.staged, expectedStaged, `publications[${index}].staged`, stageRoot);
      await requireJournalContained(stageRoot, record.staged, `publications[${index}].staged`, stageRoot);
      const staged = resolve(record.staged);
      if (publicationPayloads.has(staged)) {
        throw invalidJournal(stageRoot, `publications[${index}].staged is duplicated.`);
      }
      publicationPayloads.add(staged);
    }
    if (
      record.reservation !== null
      && (record.state !== "publish-intent" || record.desired?.kind !== "directory")
    ) {
      throw invalidJournal(stageRoot, `publications[${index}] has an impossible reservation state.`);
    }
    if (
      record.backupReservation !== null
      && record.state !== "backup-intent"
    ) {
      throw invalidJournal(stageRoot, `publications[${index}] has an impossible backup reservation state.`);
    }



    if (record.previous === null) {
      if (record.backup !== null || ["backup-intent", "backed-up"].includes(record.state)) {
        throw invalidJournal(stageRoot, `publications[${index}] has an impossible backup state.`);
      }
    } else if (record.state === "pending") {
      if (record.backup !== null) {
        throw invalidJournal(stageRoot, `publications[${index}].backup must be null while pending.`);
      }
    } else {
      const expectedBackup = join(stageRoot, "backups", String(index));
      requireExactJournalPath(record.backup, expectedBackup, `publications[${index}].backup`, stageRoot);
      await requireJournalContained(stageRoot, record.backup, `publications[${index}].backup`, stageRoot);
    }
  }

  const guardedTargets = new Set();
  const guardedPayloads = new Set();
  const changesRoot = join(workspaceRoot, CONFIG_DIRECTORY_NAME, CHANGES_DIRECTORY_NAME);
  for (const [index, record] of journal.destinationGuards.entries()) {
    const label = `destinationGuards[${index}]`;
    if (
      !hasExactKeys(record, ["kind", "target", "staged", "desired"])
      || typeof record.kind !== "string"
      || !record.kind
      || typeof record.target !== "string"
      || typeof record.staged !== "string"
    ) {
      throw invalidJournal(stageRoot, `${label} is invalid.`);
    }
    assertJournalSnapshot(record.desired, `${label}.desired`, stageRoot, { nullable: false });
    await requireJournalContained(workspaceRoot, record.target, `${label}.target`, stageRoot);
    requireExactJournalPath(
      record.staged,
      join(stageRoot, "payload", "guards", String(index)),
      `${label}.staged`,
      stageRoot,
    );
    await requireJournalContained(stageRoot, record.staged, `${label}.staged`, stageRoot);

    const target = resolve(record.target);
    if (publicationTargets.has(target) || guardedTargets.has(target)) {
      throw invalidJournal(stageRoot, `${label}.target is duplicated.`);
    }
    guardedTargets.add(target);
    const staged = resolve(record.staged);
    if (publicationPayloads.has(staged) || guardedPayloads.has(staged)) {
      throw invalidJournal(stageRoot, `${label}.staged is duplicated.`);
    }
    guardedPayloads.add(staged);
    let stagedState;
    try {
      stagedState = await snapshot(record.staged);
    } catch {
      throw invalidJournal(stageRoot, `${label}.staged is not a regular migration payload.`);
    }
    if (!sameSnapshot(stagedState, record.desired)) {
      throw invalidJournal(stageRoot, `${label}.staged does not match its authenticated snapshot.`);
    }

    if (record.kind === "changes-root") {
      if (changesRootGuard) {
        throw invalidJournal(stageRoot, "The workspace Change-root guard is duplicated.");
      }
      requireExactJournalPath(
        record.target,
        join(workspaceRoot, CONFIG_DIRECTORY_NAME, CHANGES_DIRECTORY_NAME),
        `${label}.target`,
        stageRoot,
      );
      assertJournalSnapshot(record.desired, `${label}.desired`, stageRoot, {
        nullable: false,
        kinds: ["directory"],
      });
      changesRootGuard = { index, record, type: "guard" };
    } else if (record.kind === "change") {
      const pathParts = relative(changesRoot, target).split(sep);
      const closed = pathParts.length === 2 && pathParts[0] === CLOSED_CHANGES_DIRECTORY_NAME;
      if (!(pathParts.length === 1 || closed)) {
        throw invalidJournal(stageRoot, `${label}.target is not a canonical Change destination.`);
      }
      const changeId = pathParts.at(-1);
      try {
        assertValidChangeId(changeId);
      } catch {
        throw invalidJournal(stageRoot, `${label}.target contains an invalid Change ID.`);
      }
      requireExactJournalPath(
        record.target,
        join(changesRoot, ...(closed ? [CLOSED_CHANGES_DIRECTORY_NAME, changeId] : [changeId])),
        `${label}.target`,
        stageRoot,
      );
      assertJournalSnapshot(record.desired, `${label}.desired`, stageRoot, {
        nullable: false,
        kinds: ["directory"],
      });
      const key = normalizePath(relative(changesRoot, target));
      changeGuards.set(key, { index, record, type: "guard" });
    } else if (record.kind === "recovery") {
      const recoveryName = basename(record.target);
      assertJournalRecoveryName(recoveryName, `${label}.target`, stageRoot);
      requireExactJournalPath(
        record.target,
        join(getWorkspaceConfigDirectory(workspaceRoot), recoveryName),
        `${label}.target`,
        stageRoot,
      );
      if (recoveryDestinations.has(recoveryName)) {
        throw invalidJournal(stageRoot, `${label}.target is duplicated.`);
      }
      recoveryDestinations.set(recoveryName, { index, record });
    } else if (record.kind === "workflow") {
      requireExactJournalPath(
        record.target,
        resolve(workspaceRoot, WORKFLOW_RELATIVE_PATH),
        `${label}.target`,
        stageRoot,
      );
      assertJournalSnapshot(record.desired, `${label}.desired`, stageRoot, {
        nullable: false,
        kinds: ["file"],
      });
      workflowDestination = { index, record, type: "guard" };
    } else if (record.kind === "installation-lock") {
      requireExactJournalPath(
        record.target,
        getWorkspaceInstallLockPath(workspaceRoot),
        `${label}.target`,
        stageRoot,
      );
      assertJournalSnapshot(record.desired, `${label}.desired`, stageRoot, {
        nullable: false,
        kinds: ["file"],
      });
      installationLockDestination = { index, record, type: "guard" };
    } else if (record.kind.startsWith("skill:")) {
      const skillName = record.kind.slice("skill:".length);
      if (!/^sdd-[a-z0-9-]+$/.test(skillName)) {
        throw invalidJournal(stageRoot, `${label} has an invalid skill destination.`);
      }
      requireExactJournalPath(
        record.target,
        join(workspaceRoot, WORKSPACE_SKILLS_RELATIVE_PATH, skillName),
        `${label}.target`,
        stageRoot,
      );
      assertJournalSnapshot(record.desired, `${label}.desired`, stageRoot, {
        nullable: false,
        kinds: ["directory"],
      });
      skillDestinations.set(skillName, { index, record, type: "guard" });
    } else {
      throw invalidJournal(stageRoot, `${label}.kind is unknown.`);
    }
  }

  const retirementPaths = new Set();
  const skillRetirements = [];
  const plannedRetirements = new Map();
  let legacyConfigRetirement = null;
  let changesRetirement = null;
  let workflowRetirement = null;
  const matchedRecoveryDestinations = new Set();
  for (const [index, record] of journal.retirements.entries()) {
    if (
      !hasExactKeys(record, ["kind", "path", "expected", "state", "retired", "reservation"])
      || typeof record.kind !== "string"
      || !record.kind
      || typeof record.path !== "string"
      || !RETIREMENT_STATES.has(record.state)
    ) {
      throw invalidJournal(stageRoot, `retirements[${index}] is invalid.`);
    }
    assertJournalSnapshot(record.expected, `retirements[${index}].expected`, stageRoot, { nullable: false });
    assertJournalDirectoryIdentity(
      record.reservation,
      `retirements[${index}].reservation`,
      stageRoot,
    );
    if (
      !/^planned:[a-f0-9]{64}$/.test(record.kind)
      && !record.kind.startsWith("skill:")
    ) {
      await requireJournalContained(
        legacyUserRoot,
        record.path,
        `retirements[${index}].path`,
        stageRoot,
      );
    }
    const source = resolve(record.path);
    if (retirementPaths.has(source)) {
      throw invalidJournal(stageRoot, `retirements[${index}].path is duplicated.`);
    }
    retirementPaths.add(source);
    if (record.kind === "changes") {
      requireExactJournalPath(
        record.path,
        join(legacyUserRoot, CONFIG_DIRECTORY_NAME, CHANGES_DIRECTORY_NAME),
        `retirements[${index}].path`,
        stageRoot,
      );
      assertJournalSnapshot(record.expected, `retirements[${index}].expected`, stageRoot, {
        nullable: false,
        kinds: ["directory"],
      });
      changesRetirement = record;
    } else if (/^planned:[a-f0-9]{64}$/.test(record.kind)) {
      if (plannedRetirements.has(record.kind)) {
        throw invalidJournal(stageRoot, `retirements[${index}] duplicates a planned root owner.`);
      }
      assertJournalSnapshot(record.expected, `retirements[${index}].expected`, stageRoot, {
        nullable: false,
        kinds: ["directory"],
      });
      plannedRetirements.set(record.kind, { index, record });
    } else if (record.kind === "config") {
      if (legacyConfigRetirement) {
        throw invalidJournal(stageRoot, "The legacy config retirement is duplicated.");
      }
      legacyConfigRetirement = record;
      requireExactJournalPath(record.path, getLegacyUserConfigPath(legacyUserRoot), `retirements[${index}].path`, stageRoot);
      assertJournalSnapshot(record.expected, `retirements[${index}].expected`, stageRoot, {
        nullable: false,
        kinds: ["file"],
      });
    } else if (record.kind === "install-lock") {
      requireExactJournalPath(
        record.path,
        join(legacyUserRoot, CONFIG_DIRECTORY_NAME, INSTALL_LOCK_FILE_NAME),
        `retirements[${index}].path`,
        stageRoot,
      );
      assertJournalSnapshot(record.expected, `retirements[${index}].expected`, stageRoot, {
        nullable: false,
        kinds: ["file"],
      });
    } else if (record.kind === "workflow") {
      requireExactJournalPath(
        record.path,
        resolve(legacyUserRoot, WORKFLOW_RELATIVE_PATH),
        `retirements[${index}].path`,
        stageRoot,
      );
      assertJournalSnapshot(record.expected, `retirements[${index}].expected`, stageRoot, {
        nullable: false,
        kinds: ["file"],
      });
      workflowRetirement = record;
    } else if (record.kind.startsWith("recovery:")) {
      const name = record.kind.slice("recovery:".length);
      assertJournalRecoveryName(name, `retirements[${index}].kind`, stageRoot);
      requireExactJournalPath(
        record.path,
        join(legacyUserRoot, CONFIG_DIRECTORY_NAME, name),
        `retirements[${index}].path`,
        stageRoot,
      );
      const destination = recoveryDestinations.get(name);
      if (
        !destination
        || matchedRecoveryDestinations.has(name)
        || !isDeepStrictEqual(destination.record.desired, record.expected)
      ) {
        throw invalidJournal(stageRoot, `retirements[${index}] does not uniquely match its recovery destination.`);
      }
      matchedRecoveryDestinations.add(name);
    } else if (record.kind.startsWith("skill:")) {
      const skillName = record.kind.slice("skill:".length);
      if (!/^sdd-[a-z0-9-]+$/.test(skillName)) {
        throw invalidJournal(stageRoot, `retirements[${index}].path is not an owned skill.`);
      }
      assertJournalSnapshot(record.expected, `retirements[${index}].expected`, stageRoot, {
        nullable: false,
        kinds: ["directory"],
      });
      skillRetirements.push({ index, record, skillName });
    } else {
      throw invalidJournal(stageRoot, `retirements[${index}].kind is unknown.`);
    }

    if (record.state === "pending") {
      if (record.retired !== null) {
        throw invalidJournal(stageRoot, `retirements[${index}].retired must be null while pending.`);
      }
    } else {
      const expectedRetired = join(stageRoot, "retired", String(index));
      requireExactJournalPath(record.retired, expectedRetired, `retirements[${index}].retired`, stageRoot);
      await requireJournalContained(stageRoot, record.retired, `retirements[${index}].retired`, stageRoot);
    }
    if (
      record.reservation !== null
      && record.state !== "retire-intent"
    ) {
      throw invalidJournal(stageRoot, `retirements[${index}] has an impossible reservation state.`);
    }
  }

  if (matchedRecoveryDestinations.size !== recoveryDestinations.size) {
    throw invalidJournal(stageRoot, "A recovery destination is missing its matching retirement.");
  }

  if (!workspaceConfigPublication || !legacyConfigRetirement) {
    throw invalidJournal(stageRoot, "The transaction is missing an authenticated config record.");
  }
  const workspaceSkillsRoot = resolve(workspaceRoot, WORKSPACE_SKILLS_RELATIVE_PATH);
  requireExactJournalPath(journal.workspaceSkillsRoot, workspaceSkillsRoot, "workspaceSkillsRoot", stageRoot);
  await requireJournalContained(workspaceRoot, journal.workspaceSkillsRoot, "workspaceSkillsRoot", stageRoot);
  const workspaceConfig = await assertWorkspaceConfigSkillsRoot(
    workspaceConfigPublication,
    workspaceRoot,
    workspaceSkillsRoot,
    stageRoot,
  );
  for (const { index, record, skillName } of skillPublications) {
    requireExactJournalPath(
      record.target,
      join(workspaceSkillsRoot, skillName),
      `publications[${index}].target`,
      stageRoot,
    );
    await requireJournalContained(workspaceSkillsRoot, record.target, `publications[${index}].target`, stageRoot);
  }

  const {
    root: legacySkillsRoot,
    config: legacyConfig,
  } = await configuredLegacySkillsRoot(
    legacyConfigRetirement,
    legacyUserRoot,
    stageRoot,
  );
  requireExactJournalPath(journal.legacySkillsRoot, legacySkillsRoot, "legacySkillsRoot", stageRoot);
  const expectedWorkspaceConfig = createWorkspaceConfigFromLegacyHome(
    legacyConfig,
    legacyUserRoot,
    workspaceRoot,
    { skillsDirectory: WORKSPACE_SKILLS_RELATIVE_PATH },
  );
  if (!isDeepStrictEqual(workspaceConfig, expectedWorkspaceConfig)) {
    throw invalidJournal(
      stageRoot,
      "The workspace config publication is not derived from the authenticated legacy config.",
    );
  }
  for (const { index, record, skillName } of skillRetirements) {
    requireExactJournalPath(
      record.path,
      join(legacySkillsRoot, skillName),
      `retirements[${index}].path`,
      stageRoot,
    );
    await requireJournalContained(legacySkillsRoot, record.path, `retirements[${index}].path`, stageRoot);
  }

  let plannedTopologies;
  try {
    plannedTopologies = await configuredPlannedTopologies(
      legacyConfig,
      workspaceConfig,
      legacyUserRoot,
      workspaceRoot,
    );
  } catch (error) {
    throw invalidJournal(
      stageRoot,
      `Planned Change topology cannot be derived from authenticated configs: ${String(error?.message ?? error)}`,
    );
  }
  const plannedTopologiesByKind = new Map(
    plannedTopologies.map((topology) => [topology.kind, topology]),
  );
  for (const topology of plannedTopologies) {
    if (
      !plannedRetirements.has(topology.kind)
      && await pathExists(topology.sourceRoot)
    ) {
      throw invalidJournal(
        stageRoot,
        `Configured legacy planned root is omitted from the transaction: ${topology.sourceRoot}`,
      );
    }
  }
  const plannedCandidates = [];
  const authenticatedBriefs = new Map();
  const plannedSourceOwners = new Map();
  for (const [kind, { index, record }] of plannedRetirements) {
    const topology = plannedTopologiesByKind.get(kind);
    if (!topology) {
      throw invalidJournal(stageRoot, `retirements[${index}] has no authenticated planned-root owner.`);
    }
    plannedSourceOwners.set(kind, topology.sourceOwner);
    requireExactJournalPath(
      record.path,
      topology.sourceRoot,
      `retirements[${index}].path`,
      stageRoot,
    );
    await requireJournalContained(
      topology.sourceOwner,
      record.path,
      `retirements[${index}].path`,
      stageRoot,
    );
    const authenticatedRoot = await authenticatedSnapshotPath(
      [record.path, record.retired],
      record.expected,
      `legacy planned retirement ${topology.spaceId}`,
      stageRoot,
    );
    let manifest;
    try {
      manifest = await readAuthenticatedPlannedRoot(authenticatedRoot, topology);
    } catch (error) {
      throw invalidJournal(
        stageRoot,
        `Legacy planned retirement cannot be authenticated: ${String(error?.message ?? error)}`,
      );
    }
    plannedCandidates.push(...manifest.candidates);
    for (const brief of manifest.briefs) {
      const target = resolve(brief.target);
      if (authenticatedBriefs.has(target)) {
        throw invalidJournal(stageRoot, `Legacy planned Change Brief destination is duplicated: ${target}`);
      }
      authenticatedBriefs.set(target, brief);
    }
  }
  if (
    authenticatedBriefs.size !== plannedBriefDestinations.size
    || [...authenticatedBriefs].some(([target, brief]) => {
      const publicationRecord = plannedBriefDestinations.get(target)?.record;
      return !publicationRecord || !sameSnapshot(publicationRecord.desired, brief.state);
    })
  ) {
    throw invalidJournal(
      stageRoot,
      "Change Brief publications do not biject to authenticated legacy planned sources.",
    );
  }
  const plannedBriefOwners = new Map();
  for (const [target, brief] of authenticatedBriefs) {
    const publication = plannedBriefDestinations.get(target);
    await requireJournalContained(
      brief.owner,
      publication.record.target,
      `publications[${publication.index}].target`,
      stageRoot,
    );
    plannedBriefOwners.set(target, brief.owner);
  }
  let canonicalPlannedChanges;
  try {
    canonicalPlannedChanges = await canonicalizePlannedCandidates(plannedCandidates);
  } catch (error) {
    throw invalidJournal(
      stageRoot,
      `Legacy planned Changes cannot be canonicalized: ${String(error?.message ?? error)}`,
    );
  }

  const sourceChangesPath = changesRetirement
    ? await authenticatedSnapshotPath(
      [changesRetirement.path, changesRetirement.retired],
      changesRetirement.expected,
      "legacy Change retirement",
      stageRoot,
    )
    : null;
  const sourceChanges = sourceChangesPath
    ? await readChangeManifest(sourceChangesPath, "legacy Change retirement", stageRoot)
    : new Map();
  for (const change of canonicalPlannedChanges) {
    const key = change.changeId;
    const existing = sourceChanges.get(key);
    if (existing && (existing.closed || !sameSnapshot(existing.state, change.desired))) {
      throw invalidJournal(
        stageRoot,
        `Authenticated legacy sources disagree about planned Change ${change.changeId}.`,
      );
    }
    sourceChanges.set(key, {
      changeId: change.changeId,
      closed: false,
      path: change.source,
      state: change.desired,
    });
  }
  let previousChanges = new Map();
  let desiredChanges = null;
  let desiredChangesPath = null;
  let previousChangesPath = null;
  if (changesPublication) {
    desiredChangesPath = await authenticatedSnapshotPath(
      [changesPublication.record.staged, changesPublication.record.target],
      changesPublication.record.desired,
      "workspace Change publication",
      stageRoot,
    );
    desiredChanges = await readChangeManifest(
      desiredChangesPath,
      "workspace Change publication",
      stageRoot,
    );
    if (changesPublication.record.previous) {
      previousChangesPath = await authenticatedSnapshotPath(
        [changesPublication.record.target, changesPublication.record.backup],
        changesPublication.record.previous,
        "previous workspace Change destination",
        stageRoot,
      );
      previousChanges = await readChangeManifest(
        previousChangesPath,
        "previous workspace Change destination",
        stageRoot,
      );
    }
    const expectedChanges = new Map(previousChanges);
    for (const [key, sourceChange] of sourceChanges) {
      const previousChange = previousChanges.get(key);
      if (previousChange && !sameSnapshot(previousChange.state, sourceChange.state)) {
        throw invalidJournal(
          stageRoot,
          `Workspace Change publication would overwrite existing Change ${sourceChange.changeId}.`,
        );
      }
      expectedChanges.set(key, sourceChange);
    }
    if (
      desiredChanges.size !== expectedChanges.size
      || [...expectedChanges].some(([key, expectedChange]) => (
        !sameSnapshot(desiredChanges.get(key)?.state, expectedChange.state)
      ))
    ) {
      throw invalidJournal(
        stageRoot,
        "Workspace Change publication does not equal the authenticated source and destination manifests.",
      );
    }
    if (sourceChangesPath) {
      await requireAuthenticatedDirectoryContains(
        desiredChangesPath,
        sourceChangesPath,
        "Workspace Change publication legacy-source coverage",
        stageRoot,
      );
    }
    if (previousChangesPath) {
      await requireAuthenticatedDirectoryContains(
        desiredChangesPath,
        previousChangesPath,
        "Workspace Change publication prior-destination coverage",
        stageRoot,
      );
    }
  } else if (sourceChanges.size > 0) {
    if (!changesRootGuard) {
      throw invalidJournal(
        stageRoot,
        "An unchanged workspace Change root is missing its authenticated full-tree guard.",
      );
    }
    const guardedChangesPath = await authenticatedSnapshotPath(
      [changesRootGuard.record.staged, changesRootGuard.record.target],
      changesRootGuard.record.desired,
      "preserved workspace Change root",
      stageRoot,
    );
    if (sourceChangesPath) {
      await requireAuthenticatedDirectoryContains(
        guardedChangesPath,
        sourceChangesPath,
        "Preserved workspace Change-root legacy-source coverage",
        stageRoot,
      );
    }
  } else if (changesRootGuard && sourceChanges.size === 0) {
    throw invalidJournal(stageRoot, "A workspace Change-root guard has no authenticated legacy source.");
  }
  const expectedGuardKeys = new Set();
  for (const [key, sourceChange] of sourceChanges) {
    const desiredChange = desiredChanges?.get(key) ?? null;
    if (desiredChanges && !sameSnapshot(desiredChange?.state, sourceChange.state)) {
      throw invalidJournal(stageRoot, `Workspace Change destination omits legacy Change ${sourceChange.changeId}.`);
    }
    const previousChange = previousChanges.get(key);
    if (!changesPublication || sameSnapshot(previousChange?.state, sourceChange.state)) {
      expectedGuardKeys.add(key);
    }
    const guard = changeGuards.get(key);
    if (guard && !sameSnapshot(guard.record.desired, sourceChange.state)) {
      throw invalidJournal(stageRoot, `Preserved Change destination disagrees with legacy Change ${sourceChange.changeId}.`);
    }
  }
  if (
    changeGuards.size !== expectedGuardKeys.size
    || [...expectedGuardKeys].some((key) => !changeGuards.has(key))
  ) {
    throw invalidJournal(stageRoot, "Preserved Change destinations do not match the authenticated source manifest.");
  }

  if (!workflowDestination) {
    throw invalidJournal(stageRoot, "The transaction is missing its workflow destination.");
  }
  assertManagedDestinationProvenance(
    workflowDestination,
    provenanceState.provenance,
    stageRoot,
    "The workflow destination",
  );
  if (
    workflowRetirement
    && workflowDestination.type === "guard"
    && !sameSnapshot(workflowDestination.record.desired, workflowRetirement.expected)
  ) {
    throw invalidJournal(stageRoot, "The preserved workflow destination disagrees with its owned legacy source.");
  }

  const skillRetirementsByName = new Map(
    skillRetirements.map(({ record, skillName }) => [skillName, record]),
  );
  for (const [skillName, retirement] of skillRetirementsByName) {
    const destination = skillDestinations.get(skillName);
    if (!destination) {
      throw invalidJournal(stageRoot, `Owned legacy skill ${skillName} has no workspace destination record.`);
    }
    if (
      destination.type === "guard"
      && !sameSnapshot(destination.record.desired, retirement.expected)
    ) {
      throw invalidJournal(stageRoot, `Preserved skill destination disagrees with owned legacy skill ${skillName}.`);
    }
  }
  for (const [skillName, destination] of skillDestinations) {
    if (destination.record.desired === null) continue;
    assertManagedDestinationProvenance(
      destination,
      provenanceState.provenance,
      stageRoot,
      `Managed skill destination ${skillName}`,
    );
  }

  if (!installationLockDestination) {
    throw invalidJournal(stageRoot, "The transaction is missing its installation-lock destination.");
  }
  const migratedLock = await readAuthenticatedDestinationJson(
    installationLockDestination,
    "migrated installation lock",
    stageRoot,
  );
  if (
    !hasExactKeys(migratedLock, [
      "version",
      "packageVersion",
      "schemaVersion",
      "skillsDirectory",
      "managedSkills",
      "managedWorkflow",
    ])
    || migratedLock.version !== workspaceConfig.version
    || migratedLock.schemaVersion !== workspaceConfig.schema
    || migratedLock.skillsDirectory !== workspaceConfig.skills.directory
    || typeof migratedLock.packageVersion !== "string"
    || !migratedLock.packageVersion
    || !isRecord(migratedLock.managedSkills)
    || !hasExactKeys(migratedLock.managedWorkflow, ["path", "hash"])
    || migratedLock.managedWorkflow.path !== WORKFLOW_RELATIVE_PATH
    || migratedLock.managedWorkflow.hash !== workflowDestination.record.desired.hash
  ) {
    throw invalidJournal(stageRoot, "The migrated installation lock is not bound to its workspace destinations.");
  }
  for (const [skillName, destination] of skillDestinations) {
    if (destination.record.desired === null) {
      if (Object.hasOwn(migratedLock.managedSkills, skillName)) {
        throw invalidJournal(stageRoot, `Removed skill remains in the migrated installation lock: ${skillName}.`);
      }
      continue;
    }
    if (migratedLock.managedSkills[skillName] !== destination.record.desired.hash) {
      throw invalidJournal(stageRoot, `Managed skill is missing from the migrated installation lock: ${skillName}.`);
    }
  }
  for (const [skillName, expectedHash] of Object.entries(migratedLock.managedSkills)) {
    const destination = skillDestinations.get(skillName);
    if (
      !/^sdd-[a-z0-9-]+$/.test(skillName)
      || directoryHashVersion(expectedHash) === null
      || destination?.record.desired?.hash !== expectedHash
    ) {
      throw invalidJournal(stageRoot, `The migrated installation lock contains an unauthenticated skill: ${skillName}.`);
    }
  }

  if (journal.receipt !== null) {
    if (!hasExactKeys(journal.receipt, ["path", "value"])) {
      throw invalidJournal(stageRoot, "receipt is invalid.");
    }
    requireExactJournalPath(
      journal.receipt.path,
      resolve(workspaceRoot, RECEIPT_RELATIVE_PATH),
      "receipt.path",
      stageRoot,
    );
    assertReceiptValue(journal.receipt.value, workspaceRoot, legacyUserRoot, stageRoot);
  }

  const publicationsComplete = journal.publications.every(({ state }) => state === "published");
  const rollbacksPending = journal.publications.every(
    ({ rollbackState }) => rollbackState === "pending",
  );
  const retirementsPending = journal.retirements.every(({ state }) => state === "pending");
  const retirementsComplete = journal.retirements.every(({ state }) => state === "retired");
  if (
    (journal.phase === "staged"
      && (
        !journal.publications.every(({ state }) => state === "pending")
        || !rollbacksPending
        || !retirementsPending
        || journal.receipt
      ))
    || (journal.phase === "publishing" && (!retirementsPending || journal.receipt))
    || (
      journal.phase === "destination-verified"
      && (!publicationsComplete || !rollbacksPending || !retirementsPending || journal.receipt)
    )
    || (
      journal.phase === "retiring-source"
      && (!publicationsComplete || !rollbacksPending || journal.receipt)
    )
    || (
      journal.phase === "committed"
      && (!publicationsComplete || !rollbacksPending || !retirementsComplete || !journal.receipt)
    )
  ) {
    throw invalidJournal(stageRoot, "Transaction phase contradicts its record states.");
  }
  return {
    ...provenanceState,
    ...stageIntentState,
    plannedBriefOwners,
    plannedSourceOwners,
  };
}

async function readRecoveryJournal(stageRoot, journalPath) {
  const generations = (await readdir(stageRoot))
    .map((name) => {
      const match = JOURNAL_GENERATION_PATTERN.exec(name);
      return match ? {
        name,
        generation: Number(match[1]),
        path: join(stageRoot, name),
      } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.generation - right.generation);
  if (generations.length === 0) {
    throw invalidJournal(stageRoot, "The transaction has no durable journal generation.");
  }
  for (const entry of generations) {
    entry.identity = await physicalPathIdentity(entry.path);
    entry.proofPath = journalGenerationProofPath(stageRoot, entry.generation);
    if (
      entry.identity.kind !== "file"
      || !(await samePhysicalFile(entry.path, entry.proofPath))
    ) {
      throw invalidJournal(stageRoot, `Journal generation lacks ownership proof: ${entry.name}`);
    }
  }
  const journalIdentity = await optionalPhysicalPathIdentity(journalPath);
  let selected = generations.at(-1);
  if (journalIdentity) {
    if (journalIdentity.kind !== "file") {
      throw invalidJournal(stageRoot, "The transaction journal was replaced by an unowned path.");
    }
    selected = generations
      .filter(({ identity }) => samePhysicalIdentity(identity, journalIdentity))
      .at(-1);
    if (!selected) {
      throw invalidJournal(stageRoot, "The transaction journal was replaced by an unowned path.");
    }
  }
  let observation;
  try {
    observation = await readBoundAuthorityFile(selected.path, {
      label: "Migration recovery journal",
      invalidCode: "INVALID_MIGRATION_JOURNAL",
    });
  } catch (error) {
    throw invalidJournal(
      stageRoot,
      `The authenticated journal generation cannot be read: ${String(error?.message ?? error)}`,
    );
  }
  let journal;
  try {
    journal = JSON.parse(observation.source);
  } catch (error) {
    throw invalidJournal(stageRoot, `The journal is not valid JSON: ${error.message}`);
  }
  await requirePhysicalIdentity(selected.path, selected.identity, "Migration journal generation");
  await requirePhysicalIdentity(
    selected.proofPath,
    selected.identity,
    "Migration journal generation proof",
  );
  if (journalIdentity) {
    await requirePhysicalIdentity(journalPath, journalIdentity, "Migration journal");
  }
  return {
    journal,
    journalGeneration: generations.at(-1).generation,
    journalIdentity,
    journalSourcePath: selected.path,
    journalSourceIdentity: selected.identity,
    journalState: observation.state,
  };
}

export async function recoverLegacyUserMigration(
  workspaceRootInput,
  legacyUserRootInput,
  { dryRun = false, hooks = {} } = {},
) {
  const workspaceRoot = resolve(workspaceRootInput);
  const legacyUserRoot = resolve(legacyUserRootInput);
  await assertLegacyMigrationDestinationConfinement(workspaceRoot);
  const actions = [];
  for (const name of (await names(workspaceRoot)).filter((entry) => entry.startsWith(STAGING_PREFIX))) {
    const stageRoot = join(workspaceRoot, name);
    const stageState = await lstat(stageRoot);
    if (!stageState.isDirectory() || stageState.isSymbolicLink()) {
      throw invalidJournal(stageRoot, "The transaction root is not a real directory.");
    }
    const stageIntentState = await readStageIntent(
      stageRoot,
      workspaceRoot,
      legacyUserRoot,
    );
    const stageIdentity = stageIntentState.stageIdentity;
    const journalPath = join(stageRoot, JOURNAL_NAME);
    const hasJournal = await optionalPhysicalPathIdentity(journalPath);
    const hasGeneration = (await names(stageRoot)).some(
      (entry) => JOURNAL_GENERATION_PATTERN.test(entry),
    );
    if (!hasJournal && !hasGeneration) {
      actions.push({ stageRoot, action: "rollback" });
      if (!dryRun) await quarantineIncompleteStage(stageIntentState);
      continue;
    }
    const recovered = await readRecoveryJournal(stageRoot, journalPath);
    const provenanceState = await assertJournal(
      recovered.journal,
      stageRoot,
      workspaceRoot,
      legacyUserRoot,
    );
    const state = {
      ...recovered.journal,
      ...provenanceState,
      stageIdentity,
      journalGeneration: recovered.journalGeneration,
      journalIdentity: recovered.journalIdentity,
      journalSourcePath: recovered.journalSourcePath,
      journalSourceIdentity: recovered.journalSourceIdentity,
      journalState: recovered.journalState,
      journalPath,
      hooks,
      plan: null,
    };
    await requireJournalObservation(state);
    await assertRecoveryProvenance(state);
    await requireJournalObservation(state);
    const complete = ["destination-verified", "retiring-source", "committed"].includes(state.phase);
    actions.push({ stageRoot, action: complete ? "complete" : "rollback" });
    if (dryRun) continue;
    if (complete) {
      if (state.phase === "committed") {
        await verifyDestination(state);
        await verifyRetiredSources(state);
        await requireJournalContained(
          state.workspaceRoot,
          state.receipt.path,
          "receipt.path",
          state.stageRoot,
        );
        const receiptIdentity = await physicalPathIdentity(state.receipt.path);
        if (receiptIdentity.kind !== "file") {
          throw fail("Committed migration receipt is not a regular file.", "MUTATION_RECOVERY_FAILED");
        }
        const receipt = await readJson(state.receipt.path);
        if (!isDeepStrictEqual(receipt, state.receipt.value)) {
          throw fail("Committed migration receipt changed.", "MUTATION_RECOVERY_FAILED");
        }
        state.receiptIdentity = receiptIdentity;
        try {
          await hooks.beforeStageDeletion?.({ state });
          await verifyDestination(state);
          await verifyRetiredSources(state);
          const stageCleanupEvidence = await preflightOwnedStageCleanup(state, hooks);
          await verifyDestination(state);
          await verifyRetiredSources(state);
          await removeOwnedStage(state, stageCleanupEvidence);
        } catch (error) {
          await retractCommittedReceipt(state, state.receipt.path, error);
          throw error;
        }
        await cleanupTransactionProvenanceAuthority(state);
        await cleanupStageIntentAuthority(state);
      } else {
        await finish(state, hooks);
      }
    } else {
      await rollback(state, hooks);
      await cleanupOwnedStage(state, hooks);
    }
  }
  return { recovered: actions.length, actions };
}

export async function applyLegacyUserMigration(plan, hooks = {}) {
  await assertLegacyMigrationDestinationConfinement(plan.workspaceRoot);
  if (plan.completed) {
    return {
      config: plan.config,
      migration: plan.result,
      workflow: null,
      skills: null,
      receipt: plan.receipt.value,
      retiredDirectories: [],
    };
  }
  const state = await stage(plan, hooks);
  try {
    state.phase = "publishing";
    await persist(state);
    for (const [index, record] of state.publications.entries()) await publish(state, record, index, hooks);
    await verifyDestination(state);
    state.phase = "destination-verified";
    await persist(state);
    await hooks.afterDestinationVerified?.({ state });
  } catch (error) {
    await rollback(state, hooks);
    await cleanupOwnedStage(state, hooks);
    throw error;
  }
  const receipt = await finish(state, hooks);
  return {
    config: plan.config,
    migration: plan.result,
    workflow: { path: WORKFLOW_RELATIVE_PATH, action: plan.workflowPlan.action, hash: plan.workflowPlan.sourceHash },
    skills: {
      skillsDirectory: plan.skillPlan.skillsDirectory,
      actions: plan.skillPlan.actions.map(({ skillName, action, sourceHash }) => ({ skillName, action, hash: sourceHash })),
    },
    receipt,
    retiredDirectories: state.retiredDirectories,
  };
}

async function requireRetiredDirectoryCleanupAuthority(
  legacyUserRoot,
  ownerIdentity,
  path,
  candidates,
) {
  await requirePhysicalIdentity(
    legacyUserRoot,
    ownerIdentity,
    "Legacy retired-directory transaction owner",
  );
  let parent = dirname(path);
  while (parent !== legacyUserRoot) {
    const expectedIdentity = candidates.get(parent);
    if (!expectedIdentity) {
      throw fail(
        `Legacy retired directory lacks captured ancestor authority: ${parent}`,
        "MUTATION_RECOVERY_FAILED",
      );
    }
    await requirePhysicalIdentity(parent, expectedIdentity, "Legacy retired-directory ancestor");
    parent = dirname(parent);
  }
  if (!(await isPathPhysicallyInside(legacyUserRoot, path))) {
    throw fail(
      `Legacy retired directory resolves outside its transaction owner: ${path}`,
      "CONCURRENT_CHANGE",
    );
  }
}

export async function cleanupRetiredLegacyDirectories(legacyUserRootInput, retiredDirectories) {
  const legacyUserRoot = resolve(legacyUserRootInput);
  if (!Array.isArray(retiredDirectories)) {
    throw fail("Legacy retired-directory cleanup evidence is invalid.", "MUTATION_RECOVERY_FAILED");
  }
  const candidates = new Map();
  let ownerIdentity = null;
  for (const candidate of retiredDirectories) {
    if (
      !candidate
      || typeof candidate.path !== "string"
      || !candidate.identity
      || candidate.identity.kind !== "directory"
      || typeof candidate.identity.device !== "string"
      || typeof candidate.identity.inode !== "string"
      || !candidate.ownerIdentity
      || candidate.ownerIdentity.kind !== "directory"
      || typeof candidate.ownerIdentity.device !== "string"
      || typeof candidate.ownerIdentity.inode !== "string"
    ) {
      throw fail("Legacy retired-directory cleanup evidence is invalid.", "MUTATION_RECOVERY_FAILED");
    }
    if (ownerIdentity && !samePhysicalIdentity(ownerIdentity, candidate.ownerIdentity)) {
      throw fail(
        "Legacy retired-directory transaction owner evidence conflicts.",
        "MUTATION_RECOVERY_FAILED",
      );
    }
    ownerIdentity = candidate.ownerIdentity;
    const path = resolve(candidate.path);
    if (path === legacyUserRoot || !isPathInside(legacyUserRoot, path)) {
      throw fail(
        `Legacy retired-directory cleanup path is outside its transaction owner: ${path}`,
        "MUTATION_RECOVERY_FAILED",
      );
    }
    const existing = candidates.get(path);
    if (existing && !samePhysicalIdentity(existing, candidate.identity)) {
      throw fail(
        `Legacy retired-directory cleanup evidence conflicts: ${path}`,
        "MUTATION_RECOVERY_FAILED",
      );
    }
    candidates.set(path, candidate.identity);
  }
  for (const [path, expectedIdentity] of [...candidates].sort(
    ([left], [right]) => right.length - left.length || left.localeCompare(right),
  )) {
    const identity = await optionalPhysicalPathIdentity(path);
    if (!identity) continue;
    await requireRetiredDirectoryCleanupAuthority(
      legacyUserRoot,
      ownerIdentity,
      path,
      candidates,
    );
    if (!samePhysicalIdentity(identity, expectedIdentity)) {
      throw fail(
        `Legacy retired directory changed physical identity: ${path}`,
        "CONCURRENT_CHANGE",
      );
    }
    let entries;
    try {
      entries = await readdir(path);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (entries.length !== 0) continue;
    const recheckedIdentity = await optionalPhysicalPathIdentity(path);
    if (!recheckedIdentity) continue;
    if (!samePhysicalIdentity(recheckedIdentity, expectedIdentity)) {
      throw fail(
        `Legacy retired directory changed physical identity: ${path}`,
        "CONCURRENT_CHANGE",
      );
    }
    await requireRetiredDirectoryCleanupAuthority(
      legacyUserRoot,
      ownerIdentity,
      path,
      candidates,
    );
    await rmdir(path).catch((error) => {
      if (!["ENOENT", "ENOTEMPTY"].includes(error?.code)) throw error;
    });
  }
}
