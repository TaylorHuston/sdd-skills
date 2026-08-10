import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readdir, rmdir, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { assertValidChangeId } from "../change-id.js";
import {
  assertChangeStoreConfinement,
  assertRequiredChangeFileSnapshotCurrent,
  getActiveChangePath,
  getClosedChangePath,
  getChangesRoot,
  getClosedChangesRoot,
  readRequiredChangeFileSnapshot,
  relativeChangeStorePath,
} from "../change-store.js";
import {
  appendCloseTransactionState,
  cleanupCloseTransactionJournal,
  closeCloseTransactionJournal,
  createCloseTransactionJournal,
  loadCloseTransactionJournal,
  syncCloseTransactionDirectory,
} from "../change-close-transaction.js";
import {
  assertSelectedRepositorySnapshotsCurrent,
  resolveRepositoriesForMetadata,
} from "../change-repositories.js";
import { parseChangeMetadata } from "../change-status.js";
import { assertValidConfig, resolveWorkspaceStatus } from "../config.js";
import {
  assertOperationConfigurationCurrent,
  resolveOperationConfiguration,
} from "../workspace.js";
import { SddError } from "../errors.js";
import { hashDirectory, isDirectory, pathExists } from "../fs.js";
import { withWorkspaceMutationLock } from "../mutation.js";

const CENTRAL_CHANGE_LOCK = Symbol("central-change-lock");

function pathIdentity(state) {
  return { dev: String(state.dev), ino: String(state.ino) };
}

function pathMode(state) {
  return String(state.mode & 0o777n);
}

function samePathIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino;
}

async function inspectPath(path) {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}

function entryType(state) {
  if (state?.isDirectory() && !state.isSymbolicLink()) return "directory";
  if (state?.isFile() && !state.isSymbolicLink()) return "file";
  if (state?.isSymbolicLink()) return "symlink";
  return null;
}

function changeChanged(message, details = []) {
  return new SddError(message, {
    code: "CONCURRENT_CHANGE",
    ...(details.length > 0 ? { details } : {}),
  });
}

async function assertCloseTasksSnapshotCurrent(
  changePath,
  workspaceRoot,
  expected,
  sourcePath,
) {
  try {
    await assertRequiredChangeFileSnapshotCurrent(
      changePath,
      "tasks.md",
      workspaceRoot,
      expected,
    );
  } catch (error) {
    if (error instanceof SddError && error.code === "CONCURRENT_CHANGE") {
      throw changeChanged(`Change changed during close: ${sourcePath}`);
    }
    throw error;
  }
}

async function assertCloseStoreParents(
  sourceAbsolutePath,
  destinationAbsolutePath,
  workspaceRoot,
) {
  await assertChangeStoreConfinement(dirname(sourceAbsolutePath), workspaceRoot);
  await assertChangeStoreConfinement(dirname(destinationAbsolutePath), workspaceRoot);
}

function manifestKey(segments) {
  return segments.join("/");
}

function manifestPath(root, entry) {
  return entry.segments.length === 0 ? root : join(root, ...entry.segments);
}

function manifestEntry(state, segments) {
  return {
    segments,
    type: entryType(state),
    identity: pathIdentity(state),
    mode: pathMode(state),
  };
}

function matchesManifestEntry(state, expected) {
  return entryType(state) === expected.type
    && samePathIdentity(pathIdentity(state), expected.identity)
    && pathMode(state) === expected.mode;
}

function matchesManifestIdentity(state, expected) {
  return entryType(state) === expected.type
    && samePathIdentity(pathIdentity(state), expected.identity);
}

async function requireManifestEntry(root, expected, label) {
  const path = manifestPath(root, expected);
  const state = await inspectPath(path);
  if (!state || !matchesManifestEntry(state, expected)) {
    throw changeChanged(`${label} changed physical identity: ${path}`);
  }
  return state;
}

async function captureTreeManifest(root, label, segments = []) {
  const path = segments.length === 0 ? root : join(root, ...segments);
  const before = await inspectPath(path);
  const type = entryType(before);
  if (!before || type === null) {
    throw changeChanged(`${label} contains an unsupported or missing entry: ${path}`);
  }
  const current = manifestEntry(before, segments);
  if (type !== "directory") {
    await requireManifestEntry(root, current, label);
    return [current];
  }

  const names = (await readdir(path)).sort((left, right) => left.localeCompare(right));
  const manifest = [current];
  for (const name of names) {
    manifest.push(...await captureTreeManifest(root, label, [...segments, name]));
  }
  const afterNames = (await readdir(path)).sort((left, right) => left.localeCompare(right));
  await requireManifestEntry(root, current, label);
  if (names.length !== afterNames.length
    || names.some((name, index) => name !== afterNames[index])) {
    throw changeChanged(`${label} changed while its transfer manifest was captured: ${path}`);
  }
  return manifest;
}

function sameTreeManifest(left, right) {
  if (left.length !== right.length) return false;
  const rightByPath = new Map(right.map((entry) => [manifestKey(entry.segments), entry]));
  return left.every((entry) => {
    const counterpart = rightByPath.get(manifestKey(entry.segments));
    return counterpart
      && entry.type === counterpart.type
      && entry.mode === counterpart.mode
      && samePathIdentity(entry.identity, counterpart.identity);
  });
}

async function captureMatchingTreeManifest(root, expected, label) {
  try {
    const current = await captureTreeManifest(root, label);
    return sameTreeManifest(current, expected) ? current : null;
  } catch {
    return null;
  }
}

function configSnapshotAuthority(snapshot) {
  if (snapshot === null) return null;
  return {
    source: snapshot.source,
    identity: { ...snapshot.identity },
    mode: snapshot.mode,
    ownerBinding: structuredClone(snapshot.ownerBinding),
  };
}

function closeSelectionAuthority(operation, selectedRepositories) {
  return {
    workspaceConfig: configSnapshotAuthority(operation.workspaceConfigSnapshot),
    repositories: selectedRepositories.map((repository) => ({
      id: repository.id,
      resolvedPath: repository.resolvedPath,
      config: configSnapshotAuthority(repository.repositoryConfigSnapshot),
    })),
  };
}

async function assertCloseSelectionAuthorityCurrent(
  operation,
  workspaceRoot,
  config,
  space,
  selectedRepositories,
  expectedAuthority = null,
) {
  await assertOperationConfigurationCurrent(operation);
  await assertSelectedRepositorySnapshotsCurrent(
    workspaceRoot,
    config,
    space,
    selectedRepositories,
  );
  if (expectedAuthority !== null
    && !isDeepStrictEqual(
      closeSelectionAuthority(operation, selectedRepositories),
      expectedAuthority,
    )) {
    throw changeChanged("Change-close repository selection authority changed during recovery.");
  }
}

function expectedDirectoryCreation(mode, parentState) {
  return {
    mode: String(mode & ~process.umask() & 0o777),
    uid: String(typeof process.getuid === "function" ? process.getuid() : parentState.uid),
    gid: String(typeof process.getgid === "function" ? process.getgid() : parentState.gid),
    nlink: "2",
  };
}


function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw changeChanged(`Change-close recovery ${label} is invalid.`);
  }
  return value;
}

function requireExactKeys(value, keys, label) {
  requireObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (!isDeepStrictEqual(actual, expected)) {
    throw changeChanged(`Change-close recovery ${label} has unknown or missing fields.`);
  }
  return value;
}

function requireStoredIdentity(value, label) {
  requireExactKeys(value, ["dev", "ino"], label);
  if (!/^(0|[1-9]\d*)$/.test(value.dev) || !/^(0|[1-9]\d*)$/.test(value.ino)) {
    throw changeChanged(`Change-close recovery ${label} is invalid.`);
  }
  return value;
}

function requireStoredSegments(segments, label) {
  if (!Array.isArray(segments)
    || segments.some((segment) => typeof segment !== "string"
      || segment.length === 0
      || segment === "."
      || segment === ".."
      || segment.includes("/")
      || segment.includes("\\")
      || segment.includes("\0"))) {
    throw changeChanged(`Change-close recovery ${label} has an unsafe path.`);
  }
  return segments;
}

function requireStoredManifest(manifest, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(manifest) || (!allowEmpty && manifest.length === 0)) {
    throw changeChanged(`Change-close recovery ${label} is invalid.`);
  }
  const entries = new Map();
  for (const [index, entry] of manifest.entries()) {
    requireExactKeys(entry, ["segments", "type", "identity", "mode"], `${label} entry`);
    requireStoredSegments(entry.segments, `${label} entry`);
    if (!["directory", "file", "symlink"].includes(entry.type)) {
      throw changeChanged(`Change-close recovery ${label} has an invalid entry type.`);
    }
    requireStoredIdentity(entry.identity, `${label} entry identity`);
    if (!/^(0|[1-9]\d*)$/.test(entry.mode) || Number(entry.mode) > 0o777) {
      throw changeChanged(`Change-close recovery ${label} has an invalid entry mode.`);
    }
    const key = manifestKey(entry.segments);
    if (entries.has(key) || (index === 0) !== (entry.segments.length === 0)) {
      throw changeChanged(`Change-close recovery ${label} has a duplicate or misplaced root.`);
    }
    if (entry.segments.length > 0) {
      const parent = entries.get(manifestKey(entry.segments.slice(0, -1)));
      if (!parent || parent.type !== "directory") {
        throw changeChanged(`Change-close recovery ${label} has an unbound parent.`);
      }
    }
    entries.set(key, entry);
  }
  if (!allowEmpty && manifest[0].type !== "directory") {
    throw changeChanged(`Change-close recovery ${label} root is not a directory.`);
  }
  return manifest;
}


function requireStoredOwnerAncestor(ancestor, label) {
  requireExactKeys(
    ancestor,
    ["path", "lexicalType", "lexicalIdentity", "followedIdentity"],
    label,
  );
  if (
    typeof ancestor.path !== "string"
    || !["directory", "symlink"].includes(ancestor.lexicalType)
  ) {
    throw changeChanged(`Change-close recovery ${label} is invalid.`);
  }
  requireStoredIdentity(ancestor.lexicalIdentity, `${label} lexical identity`);
  requireStoredIdentity(ancestor.followedIdentity, `${label} followed identity`);
}

function requireStoredOwnerBinding(binding, label) {
  requireExactKeys(binding, ["path", "binding", "ancestors"], label);
  if (typeof binding.path !== "string" || !Array.isArray(binding.ancestors)) {
    throw changeChanged(`Change-close recovery ${label} is invalid.`);
  }
  requireStoredOwnerAncestor(binding.binding, `${label} root`);
  binding.ancestors.forEach((ancestor, index) =>
    requireStoredOwnerAncestor(ancestor, `${label} ancestor ${index}`));
}
function requireStoredSnapshotAuthority(snapshot, label) {
  requireExactKeys(snapshot, ["source", "identity", "mode", "ownerBinding"], label);
  if (
    typeof snapshot.source !== "string"
    || !Number.isInteger(snapshot.mode)
    || snapshot.mode < 0
    || snapshot.mode > 0o777
  ) {
    throw changeChanged(`Change-close recovery ${label} source or mode is invalid.`);
  }
  requireStoredIdentity(snapshot.identity, `${label} identity`);
  requireStoredOwnerBinding(snapshot.ownerBinding, `${label} owner binding`);
}

function requireStoredSelectionAuthority(authority) {
  requireExactKeys(authority, ["workspaceConfig", "repositories"], "selection authority");
  requireStoredSnapshotAuthority(authority.workspaceConfig, "workspace configuration authority");
  if (!Array.isArray(authority.repositories)) {
    throw changeChanged("Change-close recovery repository authority is invalid.");
  }
  for (const repository of authority.repositories) {
    requireExactKeys(repository, ["id", "resolvedPath", "config"], "repository authority");
    if (typeof repository.id !== "string" || typeof repository.resolvedPath !== "string") {
      throw changeChanged("Change-close recovery repository authority is invalid.");
    }
    requireStoredSnapshotAuthority(
      repository.config,
      `repository ${repository.id} configuration authority`,
    );
  }
}

function requireStoredTransferIntent(intent, label) {
  if (intent === null) return;
  requireObject(intent, `${label} intent`);
  if (intent.operation === "mode") {
    requireExactKeys(
      intent,
      ["kind", "operation", "segments", "type", "identity", "fromMode", "toMode"],
      `${label} mode intent`,
    );
    if (!["destination", "backup"].includes(intent.kind)
      || intent.type !== "directory") {
      throw changeChanged(`Change-close recovery ${label} mode intent is invalid.`);
    }
    requireStoredSegments(intent.segments, `${label} mode intent`);
    requireStoredIdentity(intent.identity, `${label} mode intent identity`);
    for (const mode of [intent.fromMode, intent.toMode]) {
      if (!/^(0|[1-9]\d*)$/.test(mode) || Number(mode) > 0o777) {
        throw changeChanged(`Change-close recovery ${label} mode intent is invalid.`);
      }
    }
    return;
  }
  requireExactKeys(
    intent,
    ["kind", "operation", "segments", "type", "parentIdentity", "expectedCreation"],
    `${label} intent`,
  );
  if (intent.operation !== "create"
    || !["destination", "backup"].includes(intent.kind)
    || !["directory", "file", "symlink"].includes(intent.type)) {
    throw changeChanged(`Change-close recovery ${label} intent is invalid.`);
  }
  requireStoredSegments(intent.segments, `${label} intent`);
  requireStoredIdentity(intent.parentIdentity, `${label} parent identity`);
  if (intent.type === "directory") {
    requireExactKeys(
      intent.expectedCreation,
      ["mode", "uid", "gid", "nlink"],
      `${label} expected creation`,
    );
    for (const value of Object.values(intent.expectedCreation)) {
      if (!/^\d+$/.test(value)) {
        throw changeChanged(`Change-close recovery ${label} expected creation is invalid.`);
      }
    }
  } else if (intent.expectedCreation !== null) {
    throw changeChanged(`Change-close recovery ${label} file intent is invalid.`);
  }
}

function requireStoredQuarantine(value, changeId, kind) {
  requireExactKeys(
    value,
    ["name", "identity", "moved", "expectedCreation"],
    `${kind} cleanup quarantine`,
  );
  if (typeof value.name !== "string"
    || basename(value.name) !== value.name
    || !value.name.startsWith(`.${changeId}.sdd-close-${kind}-cleanup-`)
    || value.name.includes("/")
    || value.name.includes("\\")
    || value.name.includes("\0")
    || typeof value.moved !== "boolean") {
    throw changeChanged(`Change-close recovery ${kind} cleanup quarantine is invalid.`);
  }
  requireExactKeys(
    value.expectedCreation,
    ["mode", "uid", "gid", "nlink"],
    `${kind} cleanup quarantine expected creation`,
  );
  for (const expected of Object.values(value.expectedCreation)) {
    if (!/^(0|[1-9]\d*)$/.test(expected)) {
      throw changeChanged(`Change-close recovery ${kind} cleanup quarantine is invalid.`);
    }
  }
  if (value.identity === null) {
    if (value.moved) {
      throw changeChanged(`Change-close recovery ${kind} cleanup quarantine is unbound.`);
    }
  } else {
    requireStoredIdentity(value.identity, `${kind} cleanup quarantine identity`);
  }
}

function closeQuarantine(changeId, kind, token, parentState) {
  return {
    name: `.${changeId}.sdd-close-${kind}-cleanup-${token}`,
    identity: null,
    moved: false,
    expectedCreation: expectedDirectoryCreation(0o700, parentState),
  };
}

const CLOSE_TRANSACTION_PHASES = new Set([
  "prepared",
  "destination-claim-intent",
  "destination-copying",
  "destination-ready",
  "backup-claim-intent",
  "backup-copying",
  "backup-ready",
  "rolling-back",
  "retiring-source",
  "source-retired",
  "verified",
  "cleaning-backup",
  "complete",
]);

function requireCloseTransactionState(state, spaceId, changeId) {
  requireExactKeys(state, [
    "phase",
    "spaceId",
    "changeId",
    "result",
    "sourceMode",
    "sourceManifest",
    "destinationManifest",
    "backupManifest",
    "backupName",
    "tasksSource",
    "authority",
    "transferIntent",
    "retirementIntent",
    "backupCleanupIntent",
    "sourceQuarantine",
    "destinationQuarantine",
    "backupQuarantine",
    "receipt",
  ], "journal state");
  if (!CLOSE_TRANSACTION_PHASES.has(state.phase)
    || state.spaceId !== spaceId
    || state.changeId !== changeId
    || !/^\d+$/.test(state.sourceMode)
    || typeof state.tasksSource !== "string"
    || typeof state.backupName !== "string"
    || basename(state.backupName) !== state.backupName
    || !state.backupName.startsWith(`.${changeId}.sdd-close-`)
    || state.backupName.includes("/")
    || state.backupName.includes("\\")
    || state.backupName.includes("\0")) {
    throw changeChanged("Change-close recovery journal does not match the requested Change.");
  }
  if (!["pending", "closed", "rolled-back"].includes(state.result)
    || (state.phase !== "complete" && state.result !== "pending")
    || (state.phase === "complete" && state.result === "pending")) {
    throw changeChanged("Change-close recovery journal has an invalid terminal result.");
  }
  requireStoredManifest(state.sourceManifest, "source manifest");
  requireStoredManifest(state.destinationManifest, "destination manifest", { allowEmpty: true });
  requireStoredManifest(state.backupManifest, "backup manifest", { allowEmpty: true });
  requireStoredSelectionAuthority(state.authority);
  requireStoredTransferIntent(state.transferIntent, "transfer");
  if (state.retirementIntent !== null) {
    requireStoredSegments(state.retirementIntent, "retirement intent");
  }
  if (state.backupCleanupIntent !== null) {
    requireStoredSegments(state.backupCleanupIntent, "backup cleanup intent");
  }
  requireStoredQuarantine(state.sourceQuarantine, changeId, "source");
  requireStoredQuarantine(state.destinationQuarantine, changeId, "destination");
  requireStoredQuarantine(state.backupQuarantine, changeId, "backup");
  requireObject(state.receipt, "receipt");
  return state;
}

function withCloseState(state, phase, patch = {}) {
  return { ...state, ...patch, phase };
}

async function claimDirectory(path, mode, message) {
  try {
    await mkdir(path, { mode });
  } catch (error) {
    throw changeChanged(message, [error.message]);
  }
  await syncCloseTransactionDirectory(dirname(path));
  const state = await inspectPath(path);
  if (!state || entryType(state) !== "directory") {
    throw changeChanged(`Exclusive Change directory claim changed physical identity: ${path}`);
  }
  return manifestEntry(state, []);
}

async function applyBoundDirectoryMode(path, expected, mode, label) {
  let handle;
  try {
    handle = await open(path, "r");
    const before = await handle.stat({ bigint: true });
    if (!before.isDirectory()
      || before.isSymbolicLink()
      || !samePathIdentity(pathIdentity(before), expected.identity)
      || pathMode(before) !== expected.mode) {
      throw changeChanged(`${label} changed before its final mode was applied: ${path}`);
    }
    await handle.chmod(Number(mode));
    await handle.sync();
    const after = await handle.stat({ bigint: true });
    if (!after.isDirectory()
      || after.isSymbolicLink()
      || !samePathIdentity(pathIdentity(after), expected.identity)
      || pathMode(after) !== mode) {
      throw changeChanged(`${label} changed while its final mode was applied: ${path}`);
    }
  } finally {
    await handle?.close();
  }
  await syncCloseTransactionDirectory(dirname(path));
  const visible = await inspectPath(path);
  if (!visible
    || entryType(visible) !== "directory"
    || !samePathIdentity(pathIdentity(visible), expected.identity)
    || pathMode(visible) !== mode) {
    throw changeChanged(`${label} changed after its final mode was applied: ${path}`);
  }
  return visible;
}

async function copyManifestWithoutReplace(
  sourceRoot,
  targetRoot,
  sourceManifest,
  targetRootEntry,
  assertBoundary,
  targetManifest = [targetRootEntry],
  {
    beforeEntry = null,
    afterEntry = null,
    beforeDirectoryMode = null,
    afterDirectoryModeMutation = null,
    afterDirectoryMode = null,
  } = {},
) {
  const targetEntries = new Map([[manifestKey(targetRootEntry.segments), targetRootEntry]]);

  for (const sourceEntry of sourceManifest.slice(1)) {
    await assertBoundary();
    const sourceState = await requireManifestEntry(sourceRoot, sourceEntry, "Change transfer source");
    const parentSegments = sourceEntry.segments.slice(0, -1);
    const targetParent = targetEntries.get(manifestKey(parentSegments));
    if (!targetParent) {
      throw changeChanged(
        `Change transfer lost its claimed destination parent: ${manifestPath(targetRoot, sourceEntry)}`,
      );
    }
    const targetParentState = await requireManifestEntry(
      targetRoot,
      targetParent,
      "Change transfer destination",
    );

    const targetPath = manifestPath(targetRoot, sourceEntry);
    if (await inspectPath(targetPath)) {
      throw changeChanged(`Change transfer destination already exists: ${targetPath}`);
    }
    if (beforeEntry) {
      await beforeEntry({
        sourceEntry,
        sourceState,
        targetParent,
        targetParentState,
        targetPath,
        targetManifest,
      });
    }
    try {
      if (sourceEntry.type === "directory") {
        await mkdir(targetPath, { mode: 0o700 });
      } else {
        await link(manifestPath(sourceRoot, sourceEntry), targetPath);
      }
    } catch (error) {
      throw changeChanged(`Change transfer destination changed before publication: ${targetPath}`, [
        error.message,
      ]);
    }
    await syncCloseTransactionDirectory(dirname(targetPath));

    const targetState = await inspectPath(targetPath);
    const targetEntry = targetState ? manifestEntry(targetState, sourceEntry.segments) : null;
    if (!targetEntry
      || targetEntry.type !== sourceEntry.type
      || (sourceEntry.type !== "directory"
        && !samePathIdentity(targetEntry.identity, sourceEntry.identity))) {
      throw changeChanged(`Change transfer destination changed during publication: ${targetPath}`);
    }
    targetManifest.push(targetEntry);
    targetEntries.set(manifestKey(targetEntry.segments), targetEntry);
    await assertBoundary();
    if (afterEntry) {
      await afterEntry({
        sourceEntry,
        targetEntry,
        targetPath,
        targetManifest,
      });
    }
  }

  const sourceDirectories = sourceManifest
    .filter((entry) => entry.type === "directory")
    .sort((left, right) =>
      right.segments.length - left.segments.length
      || manifestKey(right.segments).localeCompare(manifestKey(left.segments)));
  for (const sourceEntry of sourceDirectories) {
    await assertBoundary();
    const targetEntry = targetEntries.get(manifestKey(sourceEntry.segments));
    if (!targetEntry) {
      throw changeChanged(
        `Change transfer lost a directory before mode finalization: ${manifestPath(targetRoot, sourceEntry)}`,
      );
    }
    await requireManifestEntry(sourceRoot, sourceEntry, "Change transfer source");
    const targetPath = manifestPath(targetRoot, targetEntry);
    if (beforeDirectoryMode) {
      await beforeDirectoryMode({
        sourceEntry,
        targetEntry,
        targetPath,
        targetManifest,
      });
    }
    const visible = await applyBoundDirectoryMode(
      targetPath,
      targetEntry,
      sourceEntry.mode,
      "Change transfer destination",
    );
    if (afterDirectoryModeMutation) {
      await afterDirectoryModeMutation({
        sourceEntry,
        targetEntry,
        targetPath,
        targetManifest,
      });
    }
    targetEntry.mode = pathMode(visible);
    await assertBoundary();
    if (afterDirectoryMode) {
      await afterDirectoryMode({
        sourceEntry,
        targetEntry,
        targetPath,
        targetManifest,
      });
    }
  }

  for (const targetEntry of targetManifest) {
    await requireManifestEntry(targetRoot, targetEntry, "Change transfer destination");
  }
  return targetManifest;
}

function cleanupDirectoryMode(mode) {
  return String(Number(mode) | 0o700);
}

async function prepareOwnedTreeForRemoval(root, manifest, label, assertBoundary) {
  const cleanupManifest = manifest.map((entry) => ({
    ...entry,
    segments: [...entry.segments],
    identity: { ...entry.identity },
  }));
  const directories = cleanupManifest
    .filter((entry) => entry.type === "directory")
    .sort((left, right) =>
      left.segments.length - right.segments.length
      || manifestKey(left.segments).localeCompare(manifestKey(right.segments)));
  for (const entry of directories) {
    if (assertBoundary) await assertBoundary();
    const path = manifestPath(root, entry);
    const current = await inspectPath(path);
    const desiredMode = cleanupDirectoryMode(entry.mode);
    if (!current
      || !matchesManifestIdentity(current, entry)
      || ![entry.mode, desiredMode].includes(pathMode(current))) {
      throw changeChanged(`${label} directory changed before writable cleanup: ${path}`);
    }
    if (pathMode(current) !== desiredMode) {
      await applyBoundDirectoryMode(
        path,
        { ...entry, mode: pathMode(current) },
        desiredMode,
        `${label} directory`,
      );
    }
    entry.mode = desiredMode;
  }
  return cleanupManifest;
}

async function removeOwnedTree(
  root,
  manifest,
  label,
  {
    quarantineRoot = join(
      dirname(root),
      `.${basename(root)}.sdd-close-cleanup-${randomUUID()}`,
    ),
    quarantineBinding = null,
    onQuarantineBound = null,
    beforeQuarantineClaim = null,
    beforeQuarantineMove = null,
    assertBoundary = null,
    beforeEntry = null,
    preserveCurrentRoot = false,
    afterEntry = null,
  } = {},
) {
  const rootEntry = manifest?.[0];
  if (!rootEntry) return { removed: true, ownershipLost: false, failures: [] };
  const payload = join(quarantineRoot, "entry");
  const failures = [];
  let binding = quarantineBinding;
  if (assertBoundary) await assertBoundary();
  let quarantineState = await inspectPath(quarantineRoot);

  if (quarantineState) {
    const canRecoverUnboundClaim = binding
      && binding.identity === null
      && binding.moved === false
      && directoryCreationMatches(quarantineState, binding.expectedCreation)
      && (await readdir(quarantineRoot)).length === 0;
    if (canRecoverUnboundClaim) {
      binding = { ...binding, identity: pathIdentity(quarantineState) };
      if (onQuarantineBound) await onQuarantineBound(binding);
    } else if (entryType(quarantineState) !== "directory"
      || !binding?.identity
      || !samePathIdentity(pathIdentity(quarantineState), binding.identity)) {
      return {
        removed: false,
        ownershipLost: true,
        failures: [`${label} retained an unproven cleanup quarantine: ${quarantineRoot}`],
      };
    }
  } else {
    if (preserveCurrentRoot) {
      return { removed: true, ownershipLost: false, failures: [] };
    }
    const initialRoot = await inspectPath(root);
    if (!initialRoot) return { removed: true, ownershipLost: false, failures: [] };
    if (!matchesManifestEntry(initialRoot, rootEntry)) {
      return { removed: false, ownershipLost: true, failures: [] };
    }
    if (binding?.identity) {
      return {
        removed: false,
        ownershipLost: true,
        failures: [`${label} cleanup quarantine disappeared: ${quarantineRoot}`],
      };
    }
    if (beforeQuarantineClaim) {
      await beforeQuarantineClaim({ root, quarantineRoot, payload });
    }
    try {
      await mkdir(quarantineRoot, { mode: 0o700 });
      if (assertBoundary) await assertBoundary();
      await syncCloseTransactionDirectory(dirname(quarantineRoot));
    } catch (error) {
      return {
        removed: false,
        ownershipLost: true,
        failures: [`${label} cleanup quarantine could not be claimed: ${error.message}`],
      };
    }
    quarantineState = await inspectPath(quarantineRoot);
    if (!quarantineState || entryType(quarantineState) !== "directory") {
      return {
        removed: false,
        ownershipLost: true,
        failures: [`${label} cleanup quarantine changed during its claim: ${quarantineRoot}`],
      };
    }
    binding = {
      name: basename(quarantineRoot),
      identity: pathIdentity(quarantineState),
      moved: false,
    };
    if (onQuarantineBound) await onQuarantineBound(binding);
  }

  const assertQuarantine = async () => {
    if (assertBoundary) await assertBoundary();
    const current = await inspectPath(quarantineRoot);
    if (!current
      || entryType(current) !== "directory"
      || !samePathIdentity(pathIdentity(current), binding.identity)) {
      throw changeChanged(`${label} cleanup quarantine changed: ${quarantineRoot}`);
    }
    if (assertBoundary) await assertBoundary();
    return current;
  };
  await assertQuarantine();

  let cleanupRoot = root;
  const payloadState = await inspectPath(payload);
  if (payloadState) {
    if (binding?.moved !== true || !matchesManifestIdentity(payloadState, rootEntry)) {
      return {
        removed: false,
        ownershipLost: true,
        failures: [`${label} retained an opaque cleanup quarantine: ${quarantineRoot}`],
      };
    }
    cleanupRoot = payload;
  } else if (binding?.moved === true) {
    const currentRoot = await inspectPath(root);
    if (!currentRoot) {
      try {
        await assertQuarantine();
        if (assertBoundary) await assertBoundary();
        await rmdir(quarantineRoot);
        await syncCloseTransactionDirectory(dirname(quarantineRoot));
      } catch (error) {
        failures.push(`${label} empty cleanup quarantine was retained: ${error.message}`);
      }
      return {
        removed: true,
        ownershipLost: false,
        failures,
      };
    }
    return {
      removed: false,
      ownershipLost: true,
      failures: [`${label} cleanup quarantine payload disappeared: ${payload}`],
    };
  } else {
    if (preserveCurrentRoot) {
      try {
        await assertQuarantine();
        if (assertBoundary) await assertBoundary();
        await rmdir(quarantineRoot);
        await syncCloseTransactionDirectory(dirname(quarantineRoot));
      } catch (error) {
        failures.push(`${label} cleanup quarantine was retained: ${error.message}`);
      }
      return {
        removed: failures.length === 0,
        ownershipLost: false,
        failures,
      };
    }
    const currentRoot = await inspectPath(root);
    if (!currentRoot) {
      try {
        await assertQuarantine();
        if (assertBoundary) await assertBoundary();
        await rmdir(quarantineRoot);
        await syncCloseTransactionDirectory(dirname(quarantineRoot));
      } catch (error) {
        failures.push(`${label} empty cleanup quarantine was retained: ${error.message}`);
      }
      return {
        removed: true,
        ownershipLost: false,
        failures,
      };
    }
    if (!matchesManifestEntry(currentRoot, rootEntry)) {
      try {
        await assertQuarantine();
        if (assertBoundary) await assertBoundary();
        await rmdir(quarantineRoot);
        await syncCloseTransactionDirectory(dirname(quarantineRoot));
      } catch (error) {
        failures.push(`${label} cleanup quarantine was retained: ${error.message}`);
      }
      return { removed: false, ownershipLost: true, failures };
    }
    try {
      await assertExistingManifestSubset(root, manifest, label);
      if (beforeQuarantineMove) await beforeQuarantineMove({ root, quarantineRoot, payload });
      await assertQuarantine();
      const guardedRoot = await inspectPath(root);
      if (!guardedRoot || !matchesManifestEntry(guardedRoot, rootEntry)) {
        throw changeChanged(`${label} changed before cleanup handoff: ${root}`);
      }
      if (await inspectPath(payload)) {
        throw changeChanged(`${label} cleanup quarantine payload appeared: ${payload}`);
      }
      if (assertBoundary) await assertBoundary();
    } catch (error) {
      failures.push(`${label} cleanup handoff failed: ${error.message}`);
      return {
        removed: false,
        ownershipLost: true,
        failures,
      };
    }
  }

  let cleanupManifest;
  try {
    cleanupManifest = await prepareOwnedTreeForRemoval(
      cleanupRoot,
      manifest,
      `${label} cleanup quarantine`,
      assertBoundary,
    );
  } catch (error) {
    return {
      removed: false,
      ownershipLost: true,
      failures: [`${label} retained unwritable quarantined content: ${error.message}`],
    };
  }

  try {
    await assertExistingManifestSubset(cleanupRoot, cleanupManifest, `${label} cleanup tree`);
  } catch (error) {
    return {
      removed: false,
      ownershipLost: true,
      failures: [`${label} retained concurrent quarantined content: ${error.message}`],
    };
  }

  const entries = [...cleanupManifest].sort((left, right) =>
    right.segments.length - left.segments.length
    || manifestKey(right.segments).localeCompare(manifestKey(left.segments)));
  const entriesByPath = new Map(
    cleanupManifest.map((entry) => [manifestKey(entry.segments), entry]),
  );
  for (const entry of entries) {
    try {
      await assertQuarantine();
    } catch (error) {
      failures.push(`${label} cleanup quarantine changed: ${error.message}`);
      break;
    }
    if (entry.segments.length > 0) {
      if (assertBoundary) await assertBoundary();
      const parent = entriesByPath.get(manifestKey(entry.segments.slice(0, -1)));
      const parentState = parent ? await inspectPath(manifestPath(cleanupRoot, parent)) : null;
      if (!parent || !parentState || !matchesManifestEntry(parentState, parent)) {
        if (await inspectPath(manifestPath(cleanupRoot, entry))) {
          failures.push(
            `${label} cleanup parent changed before removal: ${dirname(manifestPath(cleanupRoot, entry))}`,
          );
        }
        continue;
      }
    }

    const path = manifestPath(cleanupRoot, entry);
    const current = await inspectPath(path);
    if (!current) {
      if (afterEntry) await afterEntry({ entry, path, alreadyMissing: true });
      continue;
    }
    if (!matchesManifestEntry(current, entry)) {
      failures.push(`${label} retained concurrent quarantined content: ${path}`);
      continue;
    }
    if (entry.type === "directory" && (await readdir(path)).length !== 0) {
      failures.push(`${label} retained a nonempty quarantined directory: ${path}`);
      continue;
    }
    if (beforeEntry) await beforeEntry({ entry, path });
    if (assertBoundary) await assertBoundary();
    const guarded = await inspectPath(path);
    if (!guarded || !matchesManifestEntry(guarded, entry)) {
      failures.push(`${label} retained concurrent content after cleanup intent: ${path}`);
      continue;
    }
    try {
      if (entry.type === "directory") await rmdir(path);
      else await unlink(path);
      await syncCloseTransactionDirectory(dirname(path));
    } catch (error) {
      failures.push(`${label} quarantined cleanup failed for ${path}: ${error.message}`);
    }
    const retained = await inspectPath(path);
    if (!retained) {
      if (afterEntry) await afterEntry({ entry, path, alreadyMissing: false });
    } else if (!matchesManifestEntry(retained, entry)) {
      failures.push(`${label} retained a concurrent quarantined replacement: ${path}`);
    }
  }

  if (assertBoundary) await assertBoundary();
  if (!(await inspectPath(cleanupRoot))) {
    try {
      await assertQuarantine();
      if (assertBoundary) await assertBoundary();
      await rmdir(quarantineRoot);
      await syncCloseTransactionDirectory(dirname(quarantineRoot));
    } catch (error) {
      failures.push(`${label} cleanup quarantine could not be removed: ${error.message}`);
    }
  }
  if (assertBoundary) await assertBoundary();
  const currentRoot = await inspectPath(root);
  const retainedQuarantine = await inspectPath(quarantineRoot);
  return {
    removed: retainedQuarantine === null && (preserveCurrentRoot || currentRoot === null),
    ownershipLost: retainedQuarantine !== null
      || (!preserveCurrentRoot && currentRoot !== null),
    failures,
  };
}

function originalErrorDetail(error) {
  return `Original error: ${error.code ? `${error.code}: ` : ""}${error.message}`;
}

function appendCleanupFailures(errors, cleanup, label) {
  errors.push(...cleanup.failures.map((failure) => `Recovery error: ${failure}`));
  if (!cleanup.removed && cleanup.ownershipLost) {
    errors.push(`Recovery error: ${label} changed physical identity during cleanup.`);
  } else if (!cleanup.removed && cleanup.failures.length === 0) {
    errors.push(`Recovery error: ${label} could not be removed.`);
  }
}

async function retainedChangeDetails({
  sourceAbsolutePath,
  destinationAbsolutePath,
  backupAbsolutePath,
  sourcePath,
  destinationPath,
  backupPath,
}) {

  const retained = [];
  if (await inspectPath(sourceAbsolutePath)) retained.push(`Retained active Change: ${sourcePath}`);
  if (await inspectPath(destinationAbsolutePath)) {
    retained.push(`Retained closed Change: ${destinationPath}`);
  }
  if (backupAbsolutePath && await inspectPath(backupAbsolutePath)) {
    retained.push(`Retained recovery Change: ${backupPath}`);
  }
  return retained;
}
function manifestShapeMatchesSource(targetManifest, sourceManifest) {
  if (targetManifest.length !== sourceManifest.length) return false;
  const targetByPath = new Map(targetManifest.map((entry) => [manifestKey(entry.segments), entry]));
  return sourceManifest.every((sourceEntry) => {
    const target = targetByPath.get(manifestKey(sourceEntry.segments));
    return target?.type === sourceEntry.type && target.mode === sourceEntry.mode;
  });
}

function directoryCreationMatches(state, expected) {
  return entryType(state) === "directory"
    && pathMode(state) === expected.mode
    && String(state.uid) === expected.uid
    && String(state.gid) === expected.gid
    && String(state.nlink) === expected.nlink;
}

async function reconcilePartialTransfer(
  root,
  sourceRoot,
  sourceManifest,
  storedManifest,
  intent,
  kind,
) {
  const manifest = storedManifest.map((entry) => ({
    ...entry,
    segments: [...entry.segments],
    identity: { ...entry.identity },
  }));
  const rootState = await inspectPath(root);
  if (!rootState) {
    // A concurrent actor may move an owned claim after its identity is recorded. With the
    // original source still identity-bound by every caller, an absent publication root is
    // already a safe rollback outcome; any moved copy is now concurrent content and remains.
    return [];
  }
  if (intent !== null) {
    if (intent.kind !== kind) {
      throw changeChanged(`Change-close recovery ${kind} intent is misbound.`);
    }
    const key = manifestKey(intent.segments);
    const existing = manifest.find((entry) => manifestKey(entry.segments) === key);
    const sourceEntry = sourceManifest.find((entry) => manifestKey(entry.segments) === key);
    const targetPath = manifestPath(root, intent);
    const targetState = await inspectPath(targetPath);
    if (intent.operation === "mode") {
      if (!existing
        || !sourceEntry
        || sourceEntry.type !== "directory"
        || !targetState
        || !samePathIdentity(existing.identity, intent.identity)
        || !samePathIdentity(pathIdentity(targetState), intent.identity)
        || existing.mode !== intent.fromMode
        || sourceEntry.mode !== intent.toMode
        || ![intent.fromMode, intent.toMode].includes(pathMode(targetState))) {
        throw changeChanged(
          `Change-close recovery preserved an unproven ${kind} directory mode: ${targetPath}`,
        );
      }
      existing.mode = pathMode(targetState);
    } else if (!existing && targetState) {
      const isRoot = intent.segments.length === 0;
      const parent = isRoot
        ? null
        : manifest.find(
            (entry) => manifestKey(entry.segments)
              === manifestKey(intent.segments.slice(0, -1)),
          );
      const parentState = isRoot
        ? await inspectPath(dirname(root))
        : parent
          ? await inspectPath(manifestPath(root, parent))
          : null;
      const provenTarget = intent.type === "directory"
        ? directoryCreationMatches(targetState, intent.expectedCreation)
        : entryType(targetState) === intent.type
          && samePathIdentity(pathIdentity(targetState), sourceEntry?.identity);
      if (!sourceEntry
        || sourceEntry.type !== intent.type
        || (!isRoot && !parent)
        || !parentState
        || (!isRoot && !matchesManifestEntry(parentState, parent))
        || !samePathIdentity(pathIdentity(parentState), intent.parentIdentity)
        || !provenTarget) {
        throw changeChanged(
          `Change-close recovery preserved an unproven ${kind} entry: ${targetPath}`,
        );
      }
      manifest.push(manifestEntry(targetState, intent.segments));
    }
  }


  if (manifest.length === 0) {
    throw changeChanged(`Change-close recovery preserved an unbound ${kind} claim: ${root}`);
  }
  let current;
  try {
    current = await captureTreeManifest(root, `Change-close recovery ${kind}`);
  } catch {
    throw changeChanged(`Change-close recovery ${kind} claim changed: ${root}`);
  }
  if (!sameTreeManifest(current, manifest)) {
    throw changeChanged(`Change-close recovery preserved concurrent ${kind} content: ${root}`);
  }
  return manifest;
}

async function assertExistingManifestSubset(root, manifest, label) {
  const state = await inspectPath(root);
  if (!state) return true;
  if (!manifest[0] || !matchesManifestEntry(state, manifest[0])) {
    throw changeChanged(`${label} root changed physical identity: ${root}`);
  }
  const expected = new Map(manifest.map((entry) => [manifestKey(entry.segments), entry]));
  const current = await captureTreeManifest(root, label);
  for (const entry of current) {
    const counterpart = expected.get(manifestKey(entry.segments));
    if (!counterpart
      || counterpart.type !== entry.type
      || !samePathIdentity(counterpart.identity, entry.identity)) {
      throw changeChanged(`${label} contains concurrent content: ${manifestPath(root, entry)}`);
    }
  }
  return true;
}

async function cleanupCloseReceipt(session, afterProofCleanup) {
  const failures = await cleanupCloseTransactionJournal(session, {
    afterProofCleanup,
    ...session.receiptCleanupHooks,
  });
  if (failures.length > 0) {
    throw new SddError("Change close recovery receipt cleanup was incomplete.", {
      code: "MUTATION_RECOVERY_FAILED",
      details: failures,
    });
  }
}

async function mutationRecoveryFailure(primaryError, recoveryErrors, paths) {
  return new SddError("Change close failed and recovery was incomplete.", {
    code: "MUTATION_RECOVERY_FAILED",
    details: [
      originalErrorDetail(primaryError),
      ...recoveryErrors,
      ...await retainedChangeDetails(paths),
    ],
  });
}

async function recoverMovedChange({
  primaryError,
  sourceAbsolutePath,
  destinationAbsolutePath,
  backupAbsolutePath,
  destinationPath,
  backupPath,
  backupManifest,
  destinationRootEntry,
  destinationManifest,
  afterRecoveryClaim,
  cleanupOptions = {},
}) {
  const paths = {
    sourceAbsolutePath,
    destinationAbsolutePath,
    backupAbsolutePath,
    sourcePath,
    destinationPath,
    backupPath,
  };
  const recoveryErrors = [];
  const currentSource = await inspectPath(sourceAbsolutePath);
  if (currentSource) {
    const matchingDestination = await captureMatchingTreeManifest(
      destinationAbsolutePath,
      destinationManifest,
      "Closed Change recovery source",
    );
    if (matchingDestination) {
      const backupCleanup = await removeOwnedTree(
        backupAbsolutePath,
        backupManifest,
        "Change close recovery backup",
        cleanupOptions.backup,
      );
      appendCleanupFailures(recoveryErrors, backupCleanup, "Change close recovery backup");
    }
    throw await mutationRecoveryFailure(primaryError, recoveryErrors, paths);
  }

  let sourceRootEntry;
  try {
    const backupRoot = await requireManifestEntry(
      backupAbsolutePath,
      backupManifest[0],
      "Change close recovery backup",
    );
    sourceRootEntry = await claimDirectory(
      sourceAbsolutePath,
      0o700,
      `Active Change appeared during close recovery: ${sourcePath}`,
    );
  } catch {
    const matchingDestination = await captureMatchingTreeManifest(
      destinationAbsolutePath,
      destinationManifest,
      "Closed Change recovery source",
    );
    if (matchingDestination) {
      const backupCleanup = await removeOwnedTree(
        backupAbsolutePath,
        backupManifest,
        "Change close recovery backup",
        cleanupOptions.backup,
      );
      appendCleanupFailures(recoveryErrors, backupCleanup, "Change close recovery backup");
    }
    throw await mutationRecoveryFailure(primaryError, recoveryErrors, paths);
  }

  let restoredManifest = [sourceRootEntry];
  let recoverySourceRoot = null;
  let recoverySourceManifest = null;
  let closedDisposition = "missing";
  try {
    if (afterRecoveryClaim) {
      await afterRecoveryClaim({
        sourcePath: sourceAbsolutePath,
        destinationPath: destinationAbsolutePath,
        recoveryPath: backupAbsolutePath,
      });
    }
    await requireManifestEntry(sourceAbsolutePath, sourceRootEntry, "Active Change recovery claim");

    const currentDestination = await inspectPath(destinationAbsolutePath);
    if (currentDestination) {
      recoverySourceManifest = await captureMatchingTreeManifest(
        destinationAbsolutePath,
        destinationManifest,
        "Closed Change recovery source",
      );
      if (recoverySourceManifest) {
        recoverySourceRoot = destinationAbsolutePath;
        closedDisposition = "owned";
      } else {
        closedDisposition = "concurrent";
      }
    }

    if (!recoverySourceRoot) {
      await requireManifestEntry(
        backupAbsolutePath,
        backupManifest[0],
        "Change close recovery backup",
      );
      recoverySourceRoot = backupAbsolutePath;
      recoverySourceManifest = backupManifest;
    }
    const recoverySourceRootEntry = recoverySourceManifest[0];
    const assertRecoveryBoundaries = async () => {
      await requireManifestEntry(
        sourceAbsolutePath,
        sourceRootEntry,
        "Active Change recovery claim",
      );
      await requireManifestEntry(
        recoverySourceRoot,
        recoverySourceRootEntry,
        "Change close recovery source",
      );
    };
    restoredManifest = await copyManifestWithoutReplace(
      recoverySourceRoot,
      sourceAbsolutePath,
      recoverySourceManifest,
      sourceRootEntry,
      assertRecoveryBoundaries,
      restoredManifest,
    );
    await assertRecoveryBoundaries();
    if (await hashDirectory(sourceAbsolutePath) !== await hashDirectory(recoverySourceRoot)) {
      throw changeChanged(`Restored active Change does not match its recovery source: ${sourcePath}`);
    }
  } catch (error) {
    recoveryErrors.push(`Recovery error: ${error.message}`);
    const sourceCleanup = await removeOwnedTree(
      sourceAbsolutePath,
      restoredManifest,
      "Active Change recovery claim",
      cleanupOptions.source,
    );
    appendCleanupFailures(recoveryErrors, sourceCleanup, "Active Change recovery claim");
    throw await mutationRecoveryFailure(primaryError, recoveryErrors, paths);
  }

  if (closedDisposition === "owned") {
    const destinationCleanup = await removeOwnedTree(
      destinationAbsolutePath,
      recoverySourceManifest,
      "Closed Change rollback",
      cleanupOptions.destination,
    );
    appendCleanupFailures(recoveryErrors, destinationCleanup, "Closed Change rollback");
  } else if (closedDisposition === "concurrent") {
    recoveryErrors.push("Recovery error: Closed Change changed physical identity before rollback.");
  }
  const backupCleanup = await removeOwnedTree(
    backupAbsolutePath,
    backupManifest,
    "Change close recovery backup",
    cleanupOptions.backup,
  );
  appendCleanupFailures(recoveryErrors, backupCleanup, "Change close recovery backup");

  if (recoveryErrors.length > 0) {
    throw await mutationRecoveryFailure(primaryError, recoveryErrors, paths);
  }
}

async function persistClosePhase(
  session,
  phase,
  patch,
  afterTransactionPhase,
  context = {},
) {
  const state = await appendCloseTransactionState(

    session,
    withCloseState(session.state, phase, patch),
  );
  if (afterTransactionPhase) {
    await afterTransactionPhase({ phase, state, ...context });
  }
  return state;
}
async function transactionTreeCleanupOptions({
  session,
  workspaceRoot,
  cleanupRoot,
  field,
  beforeQuarantineClaim = null,
  beforeQuarantineMove = null,
  phase,
  intentField = null,
  afterTransactionPhase,
  afterEntry = null,
  context,
}) {
  const quarantine = session.state[field];
  const quarantineRoot = join(getChangesRoot(workspaceRoot), quarantine.name);
  const assertBoundary = async () => {
    await assertChangeStoreConfinement(cleanupRoot, workspaceRoot);
    await assertChangeStoreConfinement(quarantineRoot, workspaceRoot);
  };
  await assertBoundary();
  const persistQuarantine = (binding) => persistClosePhase(
    session,
    phase,
    { [field]: binding },
    afterTransactionPhase,
    context,
  );
  return {
    quarantineRoot,
    beforeQuarantineClaim: beforeQuarantineClaim
      ? (paths) => beforeQuarantineClaim({ field, ...paths, ...context })
      : null,
    quarantineBinding: quarantine,
    assertBoundary,
    onQuarantineBound: persistQuarantine,
    beforeQuarantineMove: async (paths) => {
      await persistClosePhase(
        session,
        phase,
        {},
        afterTransactionPhase,
        context,
      );
      if (beforeQuarantineMove) {
        await beforeQuarantineMove({ field, ...paths, ...context });
      }
    },
    beforeEntry: intentField === null
      ? null
      : async ({ entry }) => {
          await persistClosePhase(
            session,
            phase,
            { [intentField]: [...entry.segments] },
            afterTransactionPhase,
            context,
          );
        },
    afterEntry: async ({ entry }) => {
      if (intentField !== null) {
        await persistClosePhase(
          session,
          phase,
          { [intentField]: null },
          afterTransactionPhase,
          context,
        );
      }
      if (afterEntry) await afterEntry({ entry });
    },
  };
}

function transferIntent(kind, sourceEntry, sourceState, targetParentState) {
  return {
    kind,
    operation: "create",
    segments: [...sourceEntry.segments],
    type: sourceEntry.type,
    parentIdentity: pathIdentity(targetParentState),
    expectedCreation: sourceEntry.type === "directory"
      ? expectedDirectoryCreation(0o700, targetParentState)
      : null,
  };
}

function directoryModeIntent(kind, sourceEntry, targetEntry) {
  return {
    kind,
    operation: "mode",
    segments: [...sourceEntry.segments],
    type: "directory",
    identity: { ...targetEntry.identity },
    fromMode: targetEntry.mode,
    toMode: sourceEntry.mode,
  };
}

function tasksSnapshotFromTransaction(state) {
  const tasksEntry = state.sourceManifest.find(
    (entry) => entry.segments.length === 1 && entry.segments[0] === "tasks.md",
  );
  if (!tasksEntry || tasksEntry.type !== "file") {
    throw changeChanged("Change-close recovery source manifest is missing tasks.md.");
  }
  return {
    bytes: Buffer.from(state.tasksSource, "utf8"),
    identity: tasksEntry.identity,
  };
}

async function cleanupEmptyTransactionQuarantines(session) {
  const fields = ["sourceQuarantine", "destinationQuarantine", "backupQuarantine"];
  const failures = [];
  for (const field of fields) {
    const quarantine = session.state[field];
    const path = join(session.root, quarantine.name);
    const state = await inspectPath(path);
    if (!state) continue;
    if (!quarantine.identity
      || entryType(state) !== "directory"
      || !samePathIdentity(pathIdentity(state), quarantine.identity)) {
      failures.push(`Unproven Change-close cleanup quarantine retained: ${path}`);
      continue;
    }
    if ((await readdir(path)).length !== 0) {
      failures.push(`Nonempty Change-close cleanup quarantine retained: ${path}`);
      continue;
    }
    try {
      await rmdir(path);
      await syncCloseTransactionDirectory(dirname(path));
    } catch (error) {
      failures.push(`Change-close cleanup quarantine retained: ${path}: ${error.message}`);
    }
  }
  if (failures.length > 0) {
    throw new SddError("Change close cleanup quarantines were retained.", {
      code: "MUTATION_RECOVERY_FAILED",
      details: failures,
    });
  }
}
async function finishCloseTransaction(
  session,
  afterTransactionPhase,
  afterReceiptProofCleanup,
  result,
  context,
) {
  if (session.state.phase !== "complete") {
    await cleanupEmptyTransactionQuarantines(session);
    const resetQuarantine = (quarantine) => ({
      ...quarantine,
      identity: null,
      moved: false,
    });
    await persistClosePhase(
      session,
      session.state.phase,
      {
        sourceQuarantine: resetQuarantine(session.state.sourceQuarantine),
        destinationQuarantine: resetQuarantine(session.state.destinationQuarantine),
        backupQuarantine: resetQuarantine(session.state.backupQuarantine),
      },
      afterTransactionPhase,
      context,
    );
  }
  if (session.state.phase !== "complete") {
    await persistClosePhase(
      session,
      "complete",
      {
        result,
        transferIntent: null,
        retirementIntent: null,
        backupCleanupIntent: null,
      },
      afterTransactionPhase,
      context,
    );
  }
  await cleanupCloseReceipt(session, afterReceiptProofCleanup);
}

async function recoverPendingCloseTransaction({
  operation,
  workspaceRoot,
  config,
  space,
  spaceId,
  changeId,
  sourceAbsolutePath,
  destinationAbsolutePath,
  sourcePath,
  destinationPath,
  afterTransactionPhase,
  afterRetirementEntry,
  afterBackupCleanupEntry,
  afterReceiptProofCleanup,
  beforeTreeQuarantineClaim,
  beforeTreeQuarantineMove,
  beforeReceiptCleanup,
  beforeReceiptQuarantine,
  afterReceiptQuarantine,
  beforeReceiptRemovalMutation,
}) {
  const session = await loadCloseTransactionJournal(workspaceRoot, changeId);
  if (session === null) return null;
  session.receiptCleanupHooks = {
    beforeReceiptCleanup,
    beforeReceiptQuarantine,
    afterReceiptQuarantine,
    beforeReceiptRemovalMutation,
  };
  const context = { recovery: true, sourcePath: sourceAbsolutePath, destinationPath: destinationAbsolutePath };
  try {
    let state = requireCloseTransactionState(session.state, spaceId, changeId);
    const metadata = parseChangeMetadata(state.tasksSource);
    if (metadata.error
      || metadata.space !== spaceId
      || metadata.status !== "in_review") {
      throw changeChanged("Change-close recovery tasks metadata is invalid or misbound.");
    }
    const selectedRepositories = await resolveRepositoriesForMetadata(
      workspaceRoot,
      config,
      space,
      metadata.repositories,
    );
    await assertCloseSelectionAuthorityCurrent(
      operation,
      workspaceRoot,
      config,
      space,
      selectedRepositories,
      state.authority,
    );

    const backupAbsolutePath = join(dirname(sourceAbsolutePath), state.backupName);
    await assertChangeStoreConfinement(backupAbsolutePath, workspaceRoot);
    const backupPath = relativeChangeStorePath(backupAbsolutePath, workspaceRoot);
    const paths = {
      sourceAbsolutePath,
      destinationAbsolutePath,
      backupAbsolutePath,
      sourcePath,
      destinationPath,
      backupPath,
    };
    const treeCleanup = (field, phase, intentField = null, afterEntry = null) =>
      transactionTreeCleanupOptions({
        session,
        workspaceRoot,
        cleanupRoot: field === "sourceQuarantine"
          ? sourceAbsolutePath
          : field === "destinationQuarantine"
            ? destinationAbsolutePath
            : backupAbsolutePath,
        field,
        beforeQuarantineClaim: beforeTreeQuarantineClaim,
        beforeQuarantineMove: beforeTreeQuarantineMove,
        phase,
        intentField,
        afterTransactionPhase,
        afterEntry,
        context,
      });
    const cleanupPreservedSourceQuarantine = async (phase) => removeOwnedTree(
      sourceAbsolutePath,
      state.sourceManifest,
      "Active Change retained cleanup quarantine",
      {
        ...await treeCleanup(
          "sourceQuarantine",
          phase,
          "retirementIntent",
        ),
        preserveCurrentRoot: true,
      },
    );

    if (state.phase === "complete") {
      if (state.result === "closed") {
        if (!manifestShapeMatchesSource(
          state.destinationManifest,
          state.sourceManifest,
        )) {
          throw changeChanged("Completed closed Change manifest is inconsistent.");
        }
        if (await inspectPath(sourceAbsolutePath)) {
          throw changeChanged(
            `Active Change reappeared after Change-close completion: ${sourcePath}`,
          );
        }
        if (!await captureMatchingTreeManifest(
          destinationAbsolutePath,
          state.destinationManifest,
          "Completed closed Change",
        )) {
          throw changeChanged(
            `Completed closed Change changed before receipt cleanup: ${destinationPath}`,
          );
        }
        await assertCloseTasksSnapshotCurrent(
          destinationAbsolutePath,
          workspaceRoot,
          tasksSnapshotFromTransaction(state),
          destinationPath,
        );
      }
      if (await inspectPath(backupAbsolutePath)) {
        throw changeChanged(
          `Change-close recovery backup reappeared after completion: ${backupPath}`,
        );
      }
      await cleanupCloseReceipt(session, afterReceiptProofCleanup);
      return {
        outcome: state.result === "closed" ? "completed" : "rolled-back",
        selectedRepositories,
      };
    }

    const sourceMatches = await captureMatchingTreeManifest(
      sourceAbsolutePath,
      state.sourceManifest,
      "Active Change recovery source",
    );
    const retirementPhases = new Set([
      "retiring-source",
      "source-retired",
      "verified",
      "cleaning-backup",
    ]);

    if (!retirementPhases.has(state.phase)) {
      if (!sourceMatches) {
        throw await mutationRecoveryFailure(
          changeChanged("Interrupted Change close no longer has its original active source."),
          ["Recovery error: Active Change changed before rollback."],
          paths,
        );
      }

      let destinationManifest = state.destinationManifest;
      let backupManifest = state.backupManifest;
      if (state.phase === "rolling-back") {
        await assertExistingManifestSubset(
          destinationAbsolutePath,
          destinationManifest,
          "Closed Change rollback claim",
        );
        await assertExistingManifestSubset(
          backupAbsolutePath,
          backupManifest,
          "Change close rollback backup",
        );
      } else {
        destinationManifest = await reconcilePartialTransfer(
          destinationAbsolutePath,
          sourceAbsolutePath,
          state.sourceManifest,
          destinationManifest,
          state.transferIntent?.kind === "destination" ? state.transferIntent : null,
          "destination",
        );
        backupManifest = await reconcilePartialTransfer(
          backupAbsolutePath,
          sourceAbsolutePath,
          state.sourceManifest,
          backupManifest,
          state.transferIntent?.kind === "backup" ? state.transferIntent : null,
          "backup",
        );
        state = await persistClosePhase(
          session,
          "rolling-back",
          {
            destinationManifest,
            backupManifest,
            transferIntent: null,
          },
          afterTransactionPhase,
          context,
        );
      }
      const recoveryErrors = [];
      const sourceQuarantineCleanup = await cleanupPreservedSourceQuarantine(
        "rolling-back",
      );
      appendCleanupFailures(
        recoveryErrors,
        sourceQuarantineCleanup,
        "Active Change retained cleanup quarantine",
      );

      const backupCleanup = await removeOwnedTree(
        backupAbsolutePath,
        state.backupManifest,
        "Change close interrupted backup",
        await treeCleanup("backupQuarantine", "rolling-back"),
      );
      appendCleanupFailures(recoveryErrors, backupCleanup, "Change close interrupted backup");
      const destinationCleanup = await removeOwnedTree(
        destinationAbsolutePath,
        state.destinationManifest,
        "Change close interrupted destination",
        await treeCleanup("destinationQuarantine", "rolling-back"),
      );
      appendCleanupFailures(
        recoveryErrors,
        destinationCleanup,
        "Change close interrupted destination",
      );
      if (recoveryErrors.length > 0) {
        throw await mutationRecoveryFailure(
          changeChanged("Interrupted Change close could not be rolled back."),
          recoveryErrors,
          paths,
        );
      }
      await finishCloseTransaction(
        session,
        afterTransactionPhase,
        afterReceiptProofCleanup,
        "rolled-back",
        context,
      );
      return { outcome: "rolled-back", selectedRepositories };
    }

    if (!manifestShapeMatchesSource(state.destinationManifest, state.sourceManifest)
      || !manifestShapeMatchesSource(state.backupManifest, state.sourceManifest)
      || state.transferIntent !== null) {
      throw changeChanged("Change-close recovery journal reached retirement without complete claims.");
    }

    if (sourceMatches) {
      const recoveryErrors = [];
      const sourceQuarantineCleanup = await cleanupPreservedSourceQuarantine(
        "rolling-back",
      );
      appendCleanupFailures(
        recoveryErrors,
        sourceQuarantineCleanup,
        "Active Change retained cleanup quarantine",
      );
      const backupSubset = await assertExistingManifestSubset(
        backupAbsolutePath,
        state.backupManifest,
        "Change close rollback backup",
      );
      if (backupSubset) {
        const backupCleanup = await removeOwnedTree(
          backupAbsolutePath,
          state.backupManifest,
          "Change close rollback backup",
          await treeCleanup("backupQuarantine", "rolling-back"),
        );
        appendCleanupFailures(recoveryErrors, backupCleanup, "Change close rollback backup");
      }
      const matchingDestination = await captureMatchingTreeManifest(
        destinationAbsolutePath,
        state.destinationManifest,
        "Closed Change rollback claim",
      );
      if (matchingDestination) {
        const destinationCleanup = await removeOwnedTree(
          destinationAbsolutePath,
          state.destinationManifest,
          "Closed Change rollback claim",
          await treeCleanup("destinationQuarantine", "rolling-back"),
        );
        appendCleanupFailures(recoveryErrors, destinationCleanup, "Closed Change rollback claim");
      }
      if (recoveryErrors.length > 0) {
        throw await mutationRecoveryFailure(
          changeChanged("Interrupted Change close rollback was incomplete."),
          recoveryErrors,
          paths,
        );
      }
      await finishCloseTransaction(
        session,
        afterTransactionPhase,
        afterReceiptProofCleanup,
        "rolled-back",
        context,
      );
      return { outcome: "rolled-back", selectedRepositories };
    }

    await assertExistingManifestSubset(
      sourceAbsolutePath,
      state.sourceManifest,
      "Active Change interrupted retirement",
    );
    await assertExistingManifestSubset(
      backupAbsolutePath,
      state.backupManifest,
      "Change close recovery backup",
    );
    const matchingDestination = await captureMatchingTreeManifest(
      destinationAbsolutePath,
      state.destinationManifest,
      "Closed Change recovery destination",
    );
    if (!matchingDestination) {
      await recoverMovedChange({
        primaryError: changeChanged("Interrupted Change close lost its closed destination."),
        sourceAbsolutePath,
        destinationAbsolutePath,
        backupAbsolutePath,
        sourcePath,
        destinationPath,
        backupPath,
        backupManifest: state.backupManifest,
        destinationRootEntry: state.destinationManifest[0],
        destinationManifest: state.destinationManifest,
        afterRecoveryClaim: null,
        cleanupOptions: {
          source: await treeCleanup(
            "sourceQuarantine",
            "rolling-back",
            "retirementIntent",
          ),
          destination: await treeCleanup(
            "destinationQuarantine",
            "rolling-back",
          ),
          backup: await treeCleanup(
            "backupQuarantine",
            "rolling-back",
          ),
        },
      });
      await finishCloseTransaction(
        session,
        afterTransactionPhase,
        afterReceiptProofCleanup,
        "rolled-back",
        context,
      );
      return { outcome: "rolled-back", selectedRepositories };
    }

    if (state.phase === "retiring-source") {
      const sourceCleanup = await removeOwnedTree(
        sourceAbsolutePath,
        state.sourceManifest,
        "Active Change interrupted retirement",
        await treeCleanup(
          "sourceQuarantine",
          "retiring-source",
          "retirementIntent",
          afterRetirementEntry
            ? async ({ entry }) => {
                await afterRetirementEntry({
                  recovery: true,
                  entry,
                  sourcePath: sourceAbsolutePath,
                });
              }
            : null,
        ),
      );
      const cleanupErrors = [];
      appendCleanupFailures(cleanupErrors, sourceCleanup, "Active Change interrupted retirement");
      if (cleanupErrors.length > 0) {
        throw await mutationRecoveryFailure(
          changeChanged("Interrupted active Change retirement was incomplete."),
          cleanupErrors,
          paths,
        );
      }
      state = await persistClosePhase(
        session,
        "source-retired",
        { retirementIntent: null },
        afterTransactionPhase,
        context,
      );
    }

    await assertCloseSelectionAuthorityCurrent(
      operation,
      workspaceRoot,
      config,
      space,
      selectedRepositories,
      state.authority,
    );
    if (!await captureMatchingTreeManifest(
      destinationAbsolutePath,
      state.destinationManifest,
      "Closed Change recovery destination",
    )) {
      throw changeChanged(`Closed Change changed during recovery: ${destinationPath}`);
    }
    await assertCloseTasksSnapshotCurrent(
      destinationAbsolutePath,
      workspaceRoot,
      tasksSnapshotFromTransaction(state),
      sourcePath,
    );
    if (state.phase === "source-retired") {
      state = await persistClosePhase(
        session,
        "verified",
        {},
        afterTransactionPhase,
        context,
      );
    }

    if (state.phase === "verified") {
      state = await persistClosePhase(
        session,
        "cleaning-backup",
        {},
        afterTransactionPhase,
        context,
      );
    }
    if (state.phase === "cleaning-backup") {
      const backupCleanup = await removeOwnedTree(
        backupAbsolutePath,
        state.backupManifest,
        "Change close recovery backup",
        await treeCleanup(
          "backupQuarantine",
          "cleaning-backup",
          "backupCleanupIntent",
          afterBackupCleanupEntry
            ? async ({ entry }) => {
                await afterBackupCleanupEntry({
                  recovery: true,
                  entry,
                  recoveryPath: backupAbsolutePath,
                });
              }
            : null,
        ),
      );
      const cleanupErrors = [];
      appendCleanupFailures(cleanupErrors, backupCleanup, "Change close recovery backup");
      if (cleanupErrors.length > 0) {
        throw await mutationRecoveryFailure(
          changeChanged("Interrupted Change close backup cleanup was incomplete."),
          cleanupErrors,
          paths,
        );
      }
    }

    await finishCloseTransaction(
      session,
      afterTransactionPhase,
      afterReceiptProofCleanup,
      "closed",
      context,
    );
    return { outcome: "completed", selectedRepositories };
  } catch (error) {
    await closeCloseTransactionJournal(session).catch(() => {});
    throw error;
  }
}

export async function closeChange(
  startPath,
  spaceId,
  changeId,
  {
    dryRun = false,
    beforeCommit = null,
    beforeDestinationClaim = null,
    afterDestinationClaim = null,
    beforeBackupClaim = null,
    afterMove = null,
    afterRecoveryClaim = null,
    afterCloseTransactionPhase = null,
    afterCloseTransferEntry = null,
    afterCloseDirectoryModeMutation = null,
    afterCloseRetirementEntry = null,
    afterCloseBackupCleanupEntry = null,
    afterCloseReceiptProofCleanup = null,
    afterCloseReceiptInitializationStep = null,
    beforeCloseReceiptCleanup = null,
    beforeCloseReceiptQuarantine = null,
    beforeCloseTreeQuarantineClaim = null,
    beforeCloseTreeQuarantineMove = null,
    afterCloseReceiptQuarantine = null,
    beforeCloseReceiptRemovalMutation = null,
    workspaceRoot: requestedWorkspaceRoot = null,
    lockToken = null,
    mutationLock = null,
  } = {},
) {
  assertValidChangeId(changeId);
  const operation = await resolveOperationConfiguration(
    startPath,
    requestedWorkspaceRoot ? { workspaceRoot: requestedWorkspaceRoot } : {},
  );
  const { workspaceRoot, config } = operation;
  if (!dryRun && lockToken !== CENTRAL_CHANGE_LOCK) {
    return withWorkspaceMutationLock(workspaceRoot, (acquiredMutationLock) =>
      closeChange(startPath, spaceId, changeId, {
        dryRun,
        beforeCommit,
        beforeDestinationClaim,
        afterDestinationClaim,
        beforeBackupClaim,
        afterMove,
        afterRecoveryClaim,
        afterCloseTransactionPhase,
        afterCloseTransferEntry,
        afterCloseDirectoryModeMutation,
        afterCloseRetirementEntry,
        afterCloseBackupCleanupEntry,
        afterCloseReceiptProofCleanup,
        afterCloseReceiptInitializationStep,
        beforeCloseTreeQuarantineClaim,
        beforeCloseTreeQuarantineMove,
        beforeCloseReceiptCleanup,
        beforeCloseReceiptQuarantine,
        afterCloseReceiptQuarantine,
        workspaceRoot,
        lockToken: CENTRAL_CHANGE_LOCK,
        mutationLock: acquiredMutationLock,
        beforeCloseReceiptRemovalMutation,
      }));
  }
  assertValidConfig(config, "close a Change");
  const space = config.ideas[spaceId];
  if (!space) {
    throw new SddError(`Unknown Space ID: ${spaceId}`, {
      code: "SPACE_NOT_FOUND",
      details: Object.keys(config.ideas).sort().map((id) => `Available Space ID: ${id}`),
    });
  }
  if (resolveWorkspaceStatus(space.status) !== "active") {
    throw new SddError(`Space ${spaceId} is not active. Update its .sdd status before closing work.`, {
      code: "SPACE_NOT_ACTIVE",
    });
  }

  const sourceAbsolutePath = getActiveChangePath(changeId, workspaceRoot);
  const destinationAbsolutePath = getClosedChangePath(changeId, workspaceRoot);
  await assertChangeStoreConfinement(sourceAbsolutePath, workspaceRoot);
  await assertChangeStoreConfinement(destinationAbsolutePath, workspaceRoot);
  const sourcePath = relativeChangeStorePath(sourceAbsolutePath, workspaceRoot);
  const destinationPath = relativeChangeStorePath(destinationAbsolutePath, workspaceRoot);
  if (!dryRun) {
    const recovered = await recoverPendingCloseTransaction({
      operation,
      workspaceRoot,
      config,
      space,
      spaceId,
      changeId,
      sourceAbsolutePath,
      destinationAbsolutePath,
      sourcePath,
      destinationPath,
      afterTransactionPhase: afterCloseTransactionPhase,
      afterRetirementEntry: afterCloseRetirementEntry,
      afterBackupCleanupEntry: afterCloseBackupCleanupEntry,
      afterReceiptProofCleanup: afterCloseReceiptProofCleanup,
      beforeTreeQuarantineClaim: beforeCloseTreeQuarantineClaim,
      beforeTreeQuarantineMove: beforeCloseTreeQuarantineMove,
      beforeReceiptCleanup: beforeCloseReceiptCleanup,
      beforeReceiptQuarantine: beforeCloseReceiptQuarantine,
      afterReceiptQuarantine: afterCloseReceiptQuarantine,
      beforeReceiptRemovalMutation: beforeCloseReceiptRemovalMutation,
    });
    if (recovered?.outcome === "completed") {
      return {
        command: "change-close",
        workspaceRoot,
        dryRun,
        spaceId,
        changeId,
        sourcePath,
        path: destinationPath,
        repositories: recovered.selectedRepositories,
      };
    }
  }
  if (await pathExists(destinationAbsolutePath)) {
    throw new SddError(`Closed Change already exists: ${destinationPath}`, {
      code: await isDirectory(sourceAbsolutePath) ? "CHANGE_LOCATION_COLLISION" : "CHANGE_ALREADY_CLOSED",
    });
  }
  const sourceRootState = await inspectPath(sourceAbsolutePath);
  if (!sourceRootState || entryType(sourceRootState) !== "directory") {
    throw new SddError(`Active Change does not exist: ${sourcePath}`, { code: "CHANGE_NOT_FOUND" });
  }
  const sourcePreflightRootEntry = manifestEntry(sourceRootState, []);
  const tasksPath = `${sourcePath}/tasks.md`;
  const tasksAbsolutePath = `${sourceAbsolutePath}/tasks.md`;
  const tasksSnapshot = await readRequiredChangeFileSnapshot(
    sourceAbsolutePath,
    "tasks.md",
    workspaceRoot,
  );
  if (tasksSnapshot === null) {
    throw new SddError(`Active Change is missing tasks.md: ${sourcePath}`, {
      code: "INCOMPLETE_CHANGE",
    });
  }
  const tasksSource = tasksSnapshot.source;
  const metadata = parseChangeMetadata(tasksSource);
  if (metadata.error) {
    throw new SddError(`Cannot parse Change metadata in ${tasksPath}: ${metadata.error}`, {
      code: "INVALID_CHANGE_METADATA",
    });
  }
  if (metadata.space !== spaceId) {
    throw new SddError(`Change belongs to Space ${metadata.space}, not ${spaceId}.`, {
      code: "CHANGE_SPACE_MISMATCH",
    });
  }
  if (metadata.status !== "in_review") {
    throw new SddError("Only a Change with status in_review can be closed.", {
      code: "CHANGE_NOT_IN_REVIEW",
      details: [`Current status: ${metadata.status}`],
    });
  }
  const selectedRepositories = await resolveRepositoriesForMetadata(
    workspaceRoot,
    config,
    space,
    metadata.repositories,
  );

  if (!dryRun) {
    const sourceManifest = await captureTreeManifest(sourceAbsolutePath, "Active Change");
    if (!samePathIdentity(sourceManifest[0].identity, sourcePreflightRootEntry.identity)) {
      throw changeChanged(`Active Change changed physical identity: ${sourcePath}`);
    }
    if (beforeCommit) {
      await beforeCommit({ sourcePath: sourceAbsolutePath, destinationPath: destinationAbsolutePath });
    }
    await assertCloseSelectionAuthorityCurrent(
      operation,
      workspaceRoot,
      config,
      space,
      selectedRepositories,
    );
    await assertCloseStoreParents(
      sourceAbsolutePath,
      destinationAbsolutePath,
      workspaceRoot,
    );
    if (!await captureMatchingTreeManifest(
      sourceAbsolutePath,
      sourceManifest,
      "Active Change",
    )) {
      throw changeChanged(`Active Change changed physical identity: ${sourcePath}`);
    }
    await assertCloseTasksSnapshotCurrent(
      sourceAbsolutePath,
      workspaceRoot,
      tasksSnapshot,
      sourcePath,
    );

    await mkdir(getClosedChangesRoot(workspaceRoot), { recursive: true });
    await syncCloseTransactionDirectory(getChangesRoot(workspaceRoot));
    const backupName = `.${basename(sourceAbsolutePath)}.sdd-close-${randomUUID()}`;
    const backupAbsolutePath = join(dirname(sourceAbsolutePath), backupName);
    await assertChangeStoreConfinement(backupAbsolutePath, workspaceRoot);
    const backupPath = relativeChangeStorePath(backupAbsolutePath, workspaceRoot);
    const transactionContext = {
      recovery: false,
      sourcePath: sourceAbsolutePath,
      destinationPath: destinationAbsolutePath,
      recoveryPath: backupAbsolutePath,
    };
    let transactionSession = null;
    let destinationManifest = [];
    let backupManifest = [];
    let sourceRetirementStarted = false;
    let publicationVerified = false;
    const cleanupToken = randomUUID();
    const sourceCleanupParentState = await inspectPath(dirname(sourceAbsolutePath));
    const destinationCleanupParentState = await inspectPath(dirname(destinationAbsolutePath));
    if (!sourceCleanupParentState || !destinationCleanupParentState) {
      throw changeChanged("Change-close cleanup parent disappeared before transaction creation.");
    }
    const sourceQuarantine = closeQuarantine(
      changeId,
      "source",
      cleanupToken,
      sourceCleanupParentState,
    );
    const destinationQuarantine = closeQuarantine(
      changeId,
      "destination",
      cleanupToken,
      destinationCleanupParentState,
    );
    const backupQuarantine = closeQuarantine(
      changeId,
      "backup",
      cleanupToken,
      sourceCleanupParentState,
    );
    const treeCleanup = (field, phase, intentField = null, afterEntry = null) =>
      transactionTreeCleanupOptions({
        session: transactionSession,
        workspaceRoot,
        cleanupRoot: field === "sourceQuarantine"
          ? sourceAbsolutePath
          : field === "destinationQuarantine"
            ? destinationAbsolutePath
            : backupAbsolutePath,
        field,
        beforeQuarantineClaim: beforeCloseTreeQuarantineClaim,
        beforeQuarantineMove: beforeCloseTreeQuarantineMove,
        phase,
        intentField,
        afterTransactionPhase: afterCloseTransactionPhase,
        afterEntry,
        context: transactionContext,
      });

    try {
      transactionSession = await createCloseTransactionJournal(
        workspaceRoot,
        changeId,
        mutationLock,
        {
          phase: "prepared",
          spaceId,
          changeId,
          result: "pending",
          sourceMode: String(sourceRootState.mode & 0o777n),
          sourceManifest,
          destinationManifest,
          backupManifest,
          backupName,
          tasksSource,
          authority: closeSelectionAuthority(operation, selectedRepositories),
          transferIntent: null,
          retirementIntent: null,
          backupCleanupIntent: null,
          sourceQuarantine,
          destinationQuarantine,
          backupQuarantine,
        },
        { afterInitializationStep: afterCloseReceiptInitializationStep },
      );
      transactionSession.receiptCleanupHooks = {
        beforeReceiptCleanup: beforeCloseReceiptCleanup,
        beforeReceiptQuarantine: beforeCloseReceiptQuarantine,
        afterReceiptQuarantine: afterCloseReceiptQuarantine,
        beforeReceiptRemovalMutation: beforeCloseReceiptRemovalMutation,
      };
      if (afterCloseTransactionPhase) {
        await afterCloseTransactionPhase({
          phase: "prepared",
          state: transactionSession.state,
          ...transactionContext,
        });
      }

      if (beforeDestinationClaim) {
        await beforeDestinationClaim({
          sourcePath: sourceAbsolutePath,
          destinationPath: destinationAbsolutePath,
        });
      }
      await assertCloseSelectionAuthorityCurrent(
        operation,
        workspaceRoot,
        config,
        space,
        selectedRepositories,
      );
      await assertCloseStoreParents(
        sourceAbsolutePath,
        destinationAbsolutePath,
        workspaceRoot,
      );
      const destinationParentState = await inspectPath(dirname(destinationAbsolutePath));
      if (!destinationParentState || entryType(destinationParentState) !== "directory") {
        throw changeChanged(`Closed Change parent changed before claim: ${destinationPath}`);
      }
      await persistClosePhase(
        transactionSession,
        "destination-claim-intent",
        {
          transferIntent: transferIntent(
            "destination",
            sourceManifest[0],
            sourceRootState,
            destinationParentState,
          ),
        },
        afterCloseTransactionPhase,
        transactionContext,
      );
      const destinationRootEntry = await claimDirectory(
        destinationAbsolutePath,
        0o700,
        `Closed Change appeared during close: ${destinationPath}`,
      );
      destinationManifest = [destinationRootEntry];
      await persistClosePhase(
        transactionSession,
        "destination-copying",
        { destinationManifest: [...destinationManifest], transferIntent: null },
        afterCloseTransactionPhase,
        transactionContext,
      );

      if (afterDestinationClaim) {
        await afterDestinationClaim({
          sourcePath: sourceAbsolutePath,
          destinationPath: destinationAbsolutePath,
        });
      }
      const assertTransferBoundaries = async () => {
        await assertCloseStoreParents(
          sourceAbsolutePath,
          destinationAbsolutePath,
          workspaceRoot,
        );
        await requireManifestEntry(
          sourceAbsolutePath,
          sourcePreflightRootEntry,
          "Active Change",
        );
        await requireManifestEntry(
          destinationAbsolutePath,
          destinationRootEntry,
          "Closed Change destination claim",
        );
      };
      await copyManifestWithoutReplace(
        sourceAbsolutePath,
        destinationAbsolutePath,
        sourceManifest,
        destinationRootEntry,
        assertTransferBoundaries,
        destinationManifest,
        {
          beforeEntry: async ({
            sourceEntry,
            sourceState,
            targetParentState,
          }) => {
            await persistClosePhase(
              transactionSession,
              "destination-copying",
              {
                destinationManifest: [...destinationManifest],
                transferIntent: transferIntent(
                  "destination",
                  sourceEntry,
                  sourceState,
                  targetParentState,
                ),
              },
              afterCloseTransactionPhase,
              transactionContext,
            );
          },
          afterEntry: async ({ sourceEntry, targetEntry, targetPath }) => {
            await persistClosePhase(
              transactionSession,
              "destination-copying",
              {
                destinationManifest: [...destinationManifest],
                transferIntent: null,
              },
              afterCloseTransactionPhase,
              transactionContext,
            );
            if (afterCloseTransferEntry) {
              await afterCloseTransferEntry({
                kind: "destination",
                sourceEntry,
                targetEntry,
                targetPath,
                ...transactionContext,
              });
            }
          },
          beforeDirectoryMode: async ({ sourceEntry, targetEntry }) => {
            await persistClosePhase(
              transactionSession,
              "destination-copying",
              {
                destinationManifest: [...destinationManifest],
                transferIntent: directoryModeIntent("destination", sourceEntry, targetEntry),
              },
              afterCloseTransactionPhase,
              transactionContext,
            );
          },
          afterDirectoryModeMutation: async ({ sourceEntry, targetEntry, targetPath }) => {
            if (afterCloseDirectoryModeMutation) {
              await afterCloseDirectoryModeMutation({
                kind: "destination",
                sourceEntry,
                targetEntry,
                targetPath,
                ...transactionContext,
              });
            }
          },
          afterDirectoryMode: async ({ sourceEntry, targetEntry, targetPath }) => {
            await persistClosePhase(
              transactionSession,
              "destination-copying",
              {
                destinationManifest: [...destinationManifest],
                transferIntent: null,
              },
              afterCloseTransactionPhase,
              transactionContext,
            );
            if (afterCloseTransferEntry) {
              await afterCloseTransferEntry({
                kind: "destination-mode",
                sourceEntry,
                targetEntry,
                targetPath,
                ...transactionContext,
              });
            }
          },
        },
      );
      await assertTransferBoundaries();
      if (await hashDirectory(destinationAbsolutePath)
        !== await hashDirectory(sourceAbsolutePath)) {
        throw changeChanged(`Change changed during close: ${sourcePath}`);
      }
      await persistClosePhase(
        transactionSession,
        "destination-ready",
        { destinationManifest: [...destinationManifest], transferIntent: null },
        afterCloseTransactionPhase,
        transactionContext,
      );

      if (beforeBackupClaim) {
        await beforeBackupClaim({
          sourcePath: sourceAbsolutePath,
          destinationPath: destinationAbsolutePath,
          recoveryPath: backupAbsolutePath,
        });
      }
      await assertChangeStoreConfinement(dirname(backupAbsolutePath), workspaceRoot);
      const backupParentState = await inspectPath(dirname(backupAbsolutePath));
      if (!backupParentState || entryType(backupParentState) !== "directory") {
        throw changeChanged(`Change close recovery parent changed: ${backupPath}`);
      }
      await persistClosePhase(
        transactionSession,
        "backup-claim-intent",
        {
          transferIntent: transferIntent(
            "backup",
            sourceManifest[0],
            sourceRootState,
            backupParentState,
          ),
        },
        afterCloseTransactionPhase,
        transactionContext,
      );
      const backupRootEntry = await claimDirectory(
        backupAbsolutePath,
        0o700,
        `Change close recovery path appeared during close: ${backupPath}`,
      );
      backupManifest = [backupRootEntry];
      await persistClosePhase(
        transactionSession,
        "backup-copying",
        { backupManifest: [...backupManifest], transferIntent: null },
        afterCloseTransactionPhase,
        transactionContext,
      );
      const assertBackupBoundaries = async () => {
        await assertTransferBoundaries();
        await requireManifestEntry(
          backupAbsolutePath,
          backupRootEntry,
          "Change close recovery backup claim",
        );
      };
      await copyManifestWithoutReplace(
        sourceAbsolutePath,
        backupAbsolutePath,
        sourceManifest,
        backupRootEntry,
        assertBackupBoundaries,
        backupManifest,
        {
          beforeEntry: async ({
            sourceEntry,
            sourceState,
            targetParentState,
          }) => {
            await persistClosePhase(
              transactionSession,
              "backup-copying",
              {
                backupManifest: [...backupManifest],
                transferIntent: transferIntent(
                  "backup",
                  sourceEntry,
                  sourceState,
                  targetParentState,
                ),
              },
              afterCloseTransactionPhase,
              transactionContext,
            );
          },
          afterEntry: async ({ sourceEntry, targetEntry, targetPath }) => {
            await persistClosePhase(
              transactionSession,
              "backup-copying",
              {
                backupManifest: [...backupManifest],
                transferIntent: null,
              },
              afterCloseTransactionPhase,
              transactionContext,
            );
            if (afterCloseTransferEntry) {
              await afterCloseTransferEntry({
                kind: "backup",
                sourceEntry,
                targetEntry,
                targetPath,
                ...transactionContext,
              });
            }
          },
          beforeDirectoryMode: async ({ sourceEntry, targetEntry }) => {
            await persistClosePhase(
              transactionSession,
              "backup-copying",
              {
                backupManifest: [...backupManifest],
                transferIntent: directoryModeIntent("backup", sourceEntry, targetEntry),
              },
              afterCloseTransactionPhase,
              transactionContext,
            );
          },
          afterDirectoryModeMutation: async ({ sourceEntry, targetEntry, targetPath }) => {
            if (afterCloseDirectoryModeMutation) {
              await afterCloseDirectoryModeMutation({
                kind: "backup",
                sourceEntry,
                targetEntry,
                targetPath,
                ...transactionContext,
              });
            }
          },
          afterDirectoryMode: async ({ sourceEntry, targetEntry, targetPath }) => {
            await persistClosePhase(
              transactionSession,
              "backup-copying",
              {
                backupManifest: [...backupManifest],
                transferIntent: null,
              },
              afterCloseTransactionPhase,
              transactionContext,
            );
            if (afterCloseTransferEntry) {
              await afterCloseTransferEntry({
                kind: "backup-mode",
                sourceEntry,
                targetEntry,
                targetPath,
                ...transactionContext,
              });
            }
          },
        },
      );
      await assertBackupBoundaries();
      if (await hashDirectory(backupAbsolutePath)
        !== await hashDirectory(sourceAbsolutePath)) {
        throw changeChanged(`Change changed during recovery backup: ${sourcePath}`);
      }
      await persistClosePhase(
        transactionSession,
        "backup-ready",
        { backupManifest: [...backupManifest], transferIntent: null },
        afterCloseTransactionPhase,
        transactionContext,
      );
      await assertCloseTasksSnapshotCurrent(
        sourceAbsolutePath,
        workspaceRoot,
        tasksSnapshot,
        sourcePath,
      );
      await assertCloseSelectionAuthorityCurrent(
        operation,
        workspaceRoot,
        config,
        space,
        selectedRepositories,
      );

      await persistClosePhase(
        transactionSession,
        "retiring-source",
        { retirementIntent: null },
        afterCloseTransactionPhase,
        transactionContext,
      );
      sourceRetirementStarted = true;
      const sourceCleanup = await removeOwnedTree(
        sourceAbsolutePath,
        sourceManifest,
        "Active Change retirement",
        await treeCleanup(
          "sourceQuarantine",
          "retiring-source",
          "retirementIntent",
          afterCloseRetirementEntry
            ? async ({ entry }) => {
                await afterCloseRetirementEntry({
                  entry,
                  sourcePath: sourceAbsolutePath,
                  ...transactionContext,
                });
              }
            : null,
        ),
      );
      if (!sourceCleanup.removed
        || sourceCleanup.ownershipLost
        || sourceCleanup.failures.length > 0) {
        throw changeChanged(`Active Change changed during close handoff: ${sourcePath}`, [
          ...sourceCleanup.failures,
        ]);
      }
      if (await inspectPath(sourceAbsolutePath)) {
        throw changeChanged(`Active Change reappeared during close: ${sourcePath}`);
      }
      await persistClosePhase(
        transactionSession,
        "source-retired",
        { retirementIntent: null },
        afterCloseTransactionPhase,
        transactionContext,
      );
      await requireManifestEntry(
        destinationAbsolutePath,
        destinationRootEntry,
        "Closed Change",
      );
      if (afterMove) {
        await afterMove({
          sourcePath: sourceAbsolutePath,
          destinationPath: destinationAbsolutePath,
        });
      }
      await assertCloseSelectionAuthorityCurrent(
        operation,
        workspaceRoot,
        config,
        space,
        selectedRepositories,
      );
      if (!await captureMatchingTreeManifest(
        destinationAbsolutePath,
        destinationManifest,
        "Closed Change",
      )) {
        throw changeChanged(`Closed Change changed physical identity: ${destinationPath}`);
      }
      await assertCloseTasksSnapshotCurrent(
        destinationAbsolutePath,
        workspaceRoot,
        tasksSnapshot,
        sourcePath,
      );
      if (await inspectPath(sourceAbsolutePath)) {
        throw changeChanged(`Active Change reappeared during close: ${sourcePath}`);
      }
      await persistClosePhase(
        transactionSession,
        "verified",
        {},
        afterCloseTransactionPhase,
        transactionContext,
      );
      publicationVerified = true;

      await persistClosePhase(
        transactionSession,
        "cleaning-backup",
        {},
        afterCloseTransactionPhase,
        transactionContext,
      );
      const backupCleanup = await removeOwnedTree(
        backupAbsolutePath,
        backupManifest,
        "Change close recovery backup",
        await treeCleanup(
          "backupQuarantine",
          "cleaning-backup",
          "backupCleanupIntent",
          afterCloseBackupCleanupEntry
            ? async ({ entry }) => {
                await afterCloseBackupCleanupEntry({
                  entry,
                  recoveryPath: backupAbsolutePath,
                  ...transactionContext,
                });
              }
            : null,
        ),
      );
      const cleanupErrors = [];
      appendCleanupFailures(cleanupErrors, backupCleanup, "Change close recovery backup");
      if (cleanupErrors.length > 0) {
        throw new SddError("Change close backup cleanup was incomplete.", {
          code: "MUTATION_RECOVERY_FAILED",
          details: cleanupErrors,
        });
      }
      await finishCloseTransaction(
        transactionSession,
        afterCloseTransactionPhase,
        afterCloseReceiptProofCleanup,
        "closed",
        transactionContext,
      );
    } catch (error) {
      if (!transactionSession) throw error;
      if (publicationVerified) {
        await closeCloseTransactionJournal(transactionSession).catch(() => {});
        throw error;
      }
      if (!sourceRetirementStarted) {
        const cleanupErrors = [];
        const sourceIntact = await captureMatchingTreeManifest(
          sourceAbsolutePath,
          sourceManifest,
          "Active Change",
        );
        if (sourceIntact) {
          try {
            const outstandingIntent = transactionSession.state.transferIntent;
            destinationManifest = await reconcilePartialTransfer(
              destinationAbsolutePath,
              sourceAbsolutePath,
              sourceManifest,
              transactionSession.state.destinationManifest,
              outstandingIntent?.kind === "destination" ? outstandingIntent : null,
              "destination",
            );
            backupManifest = await reconcilePartialTransfer(
              backupAbsolutePath,
              sourceAbsolutePath,
              sourceManifest,
              transactionSession.state.backupManifest,
              outstandingIntent?.kind === "backup" ? outstandingIntent : null,
              "backup",
            );
          } catch (reconcileError) {
            cleanupErrors.push(`Recovery transfer reconciliation: ${reconcileError.message}`);
          }
          if (cleanupErrors.length === 0) {
          try {
            await persistClosePhase(
              transactionSession,
              "rolling-back",
              {
                destinationManifest: [...destinationManifest],
                backupManifest: [...backupManifest],
                transferIntent: null,
              },
              afterCloseTransactionPhase,
              transactionContext,
            );
          } catch (journalError) {
            cleanupErrors.push(`Recovery journal update: ${journalError.message}`);
          }
          }
          if (cleanupErrors.length === 0) {
            const destinationCleanup = await removeOwnedTree(
              destinationAbsolutePath,
              destinationManifest,
              "Closed Change destination claim",
              await treeCleanup("destinationQuarantine", "rolling-back"),
            );
            if (!destinationCleanup.ownershipLost) {
              appendCleanupFailures(
                cleanupErrors,
                destinationCleanup,
                "Closed Change destination claim",
              );
            }
            if (backupManifest.length > 0) {
              const backupCleanup = await removeOwnedTree(
                backupAbsolutePath,
                backupManifest,
                "Change close recovery backup claim",
                await treeCleanup("backupQuarantine", "rolling-back"),
              );
              if (!backupCleanup.ownershipLost) {
                appendCleanupFailures(
                  cleanupErrors,
                  backupCleanup,
                  "Change close recovery backup claim",
                );
              }
            }
          }
        } else {
          cleanupErrors.push(
            "Recovery error: Active Change changed before close claims could be cleaned.",
          );
        }
        if (cleanupErrors.length === 0) {
          try {
            await finishCloseTransaction(
              transactionSession,
              afterCloseTransactionPhase,
              afterCloseReceiptProofCleanup,
              "rolled-back",
              transactionContext,
            );
          } catch (receiptError) {
            cleanupErrors.push(`Recovery receipt cleanup: ${receiptError.message}`);
          }
        }
        if (cleanupErrors.length > 0) {
          await closeCloseTransactionJournal(transactionSession).catch(() => {});
          throw await mutationRecoveryFailure(error, cleanupErrors, {
            sourceAbsolutePath,
            destinationAbsolutePath,
            backupAbsolutePath,
            sourcePath,
            destinationPath,
            backupPath,
          });
        }
        throw error;
      }

      try {
        await recoverMovedChange({
          primaryError: error,
          sourceAbsolutePath,
          destinationAbsolutePath,
          backupAbsolutePath,
          sourcePath,
          destinationPath,
          backupPath,
          backupManifest,
          destinationRootEntry: destinationManifest[0],
          destinationManifest,
          afterRecoveryClaim,
          cleanupOptions: {
            source: await treeCleanup(
              "sourceQuarantine",
              "rolling-back",
              "retirementIntent",
            ),
            destination: await treeCleanup(
              "destinationQuarantine",
              "rolling-back",
            ),
            backup: await treeCleanup(
              "backupQuarantine",
              "rolling-back",
            ),
          },
        });
        const sourceQuarantineCleanup = await removeOwnedTree(
          sourceAbsolutePath,
          sourceManifest,
          "Active Change retained cleanup quarantine",
          {
            ...await treeCleanup(
              "sourceQuarantine",
              "rolling-back",
              "retirementIntent",
            ),
            preserveCurrentRoot: true,
          },
        );
        const sourceQuarantineErrors = [];
        appendCleanupFailures(
          sourceQuarantineErrors,
          sourceQuarantineCleanup,
          "Active Change retained cleanup quarantine",
        );
        if (sourceQuarantineErrors.length > 0) {
          throw await mutationRecoveryFailure(error, sourceQuarantineErrors, {
            sourceAbsolutePath,
            destinationAbsolutePath,
            backupAbsolutePath,
            sourcePath,
            destinationPath,
            backupPath,
          });
        }
        await finishCloseTransaction(
          transactionSession,
          afterCloseTransactionPhase,
          afterCloseReceiptProofCleanup,
          "rolled-back",
          transactionContext,
        );
      } catch (recoveryError) {
        await closeCloseTransactionJournal(transactionSession).catch(() => {});
        throw recoveryError;
      }
      throw error;
    }
  }

  return {
    command: "change-close",
    workspaceRoot,
    dryRun,
    spaceId,
    changeId,
    sourcePath,
    path: destinationPath,
    repositories: selectedRepositories,
  };
}
