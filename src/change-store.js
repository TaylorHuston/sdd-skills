import { lstat, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import { assertValidChangeId } from "./change-id.js";
import {
  CHANGES_DIRECTORY_NAME,
  CLOSED_CHANGES_DIRECTORY_NAME,
  CONFIG_DIRECTORY_NAME,
} from "./constants.js";
import { SddError } from "./errors.js";
import { isPathInside, readBoundRegularFile, resolvePhysicalPath } from "./fs.js";

function normalizePath(value) {
  return value.split("\\").join("/") || ".";
}

export const CHANGE_METADATA_FILE = "change.md";
export const REQUIRED_CHANGE_FILES = Object.freeze([CHANGE_METADATA_FILE]);
export const PLANNED_CHANGE_FILES = Object.freeze(["tasks.md"]);
export const OPTIONAL_CHANGE_FILES = Object.freeze(["design.md"]);
export const CHANGE_FILE_NAMES = Object.freeze([
  ...REQUIRED_CHANGE_FILES,
  ...PLANNED_CHANGE_FILES,
  ...OPTIONAL_CHANGE_FILES,
]);

export const PLANNED_CHANGE_SECTION_GROUPS = Object.freeze([
  Object.freeze(["Current Context"]),
  Object.freeze(["Behavioral Changes"]),
  Object.freeze(["Technical Decision Handoffs"]),
  Object.freeze(["Selected Approach"]),
  Object.freeze(["Alternatives Considered"]),
  Object.freeze(["Implementation Constraints"]),
  Object.freeze(["Verification Strategy"]),
  Object.freeze(["Risks / Trade-Offs"]),
]);

export const COMPATIBLE_DESIGN_SECTION_GROUPS = Object.freeze([
  Object.freeze(["Context", "Current Understanding"]),
  Object.freeze(["Selected Approach", "Technical Approach"]),
  Object.freeze(["Risks / Trade-Offs", "Alternatives / Deferred"]),
]);

function missingSectionGroups(source, groups) {
  const headings = new Set(
    source
      .split(/\r?\n/)
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice(3).trim()),
  );
  return groups
    .filter((alternatives) => !alternatives.some((heading) => headings.has(heading)))
    .map((alternatives) => alternatives.join(" or "));
}

export function missingPlannedChangeSections(source) {
  return missingSectionGroups(source, PLANNED_CHANGE_SECTION_GROUPS);
}

export function missingCompatibleDesignSections(source) {
  return missingSectionGroups(source, COMPATIBLE_DESIGN_SECTION_GROUPS);
}

function requireWorkspaceRoot(workspaceRoot) {
  if (typeof workspaceRoot !== "string" || workspaceRoot.trim().length === 0) {
    throw new SddError("A workspace root is required to access the Change store.", {
      code: "WORKSPACE_REQUIRED",
    });
  }
  return workspaceRoot;
}

async function lstatIfPresent(path) {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function sameFileIdentity(left, right) {
  return left !== null
    && right !== null
    && left.dev === right.dev
    && left.ino === right.ino;
}

function unsafeChangeStorePath(path, workspaceRoot, reason) {
  return new SddError(`${reason}: ${path}`, {
    code: "UNSAFE_ARTIFACT_PATH",
    details: [relativeChangeStorePath(path, workspaceRoot)],
  });
}

async function assertFixedPhysicalPath(path, logicalWorkspaceRoot, physicalWorkspaceRoot) {
  const absolutePath = resolve(path);
  const relation = relative(logicalWorkspaceRoot, absolutePath);
  if (!isPathInside(logicalWorkspaceRoot, absolutePath)) {
    throw unsafeChangeStorePath(
      absolutePath,
      logicalWorkspaceRoot,
      "Change store path is outside its workspace",
    );
  }

  let current = logicalWorkspaceRoot;
  let state = null;
  for (const segment of relation.split(sep).filter(Boolean)) {
    current = join(current, segment);
    state = await lstatIfPresent(current);
    if (state === null) break;
    if (state.isSymbolicLink()) {
      throw unsafeChangeStorePath(
        current,
        logicalWorkspaceRoot,
        "Change store path contains a symbolic-link alias",
      );
    }
    if (current !== absolutePath && !state.isDirectory()) {
      throw unsafeChangeStorePath(
        current,
        logicalWorkspaceRoot,
        "Change store path contains a non-directory ancestor",
      );
    }
  }

  const physicalPath = await resolvePhysicalPath(absolutePath);
  const expectedPhysicalPath = resolve(physicalWorkspaceRoot, relation);
  if (physicalPath !== expectedPhysicalPath) {
    throw unsafeChangeStorePath(
      absolutePath,
      logicalWorkspaceRoot,
      "Change store path does not resolve to its fixed workspace location",
    );
  }
  return state;
}


export function getChangesRoot(workspaceRoot) {
  return join(requireWorkspaceRoot(workspaceRoot), CONFIG_DIRECTORY_NAME, CHANGES_DIRECTORY_NAME);
}

export function getClosedChangesRoot(workspaceRoot) {
  return join(getChangesRoot(workspaceRoot), CLOSED_CHANGES_DIRECTORY_NAME);
}

export function getActiveChangePath(changeId, workspaceRoot) {
  assertValidChangeId(changeId);
  return join(getChangesRoot(workspaceRoot), changeId);
}

export function getClosedChangePath(changeId, workspaceRoot) {
  assertValidChangeId(changeId);
  return join(getClosedChangesRoot(workspaceRoot), changeId);
}

export function relativeChangeStorePath(path, workspaceRoot) {
  return normalizePath(relative(requireWorkspaceRoot(workspaceRoot), path));
}

export async function assertChangeStoreConfinement(path, workspaceRoot) {
  const logicalWorkspaceRoot = resolve(requireWorkspaceRoot(workspaceRoot));
  const changesRoot = resolve(getChangesRoot(logicalWorkspaceRoot));
  const closedRoot = resolve(getClosedChangesRoot(logicalWorkspaceRoot));
  const absolutePath = resolve(path);
  if (!isPathInside(changesRoot, absolutePath)) {
    throw unsafeChangeStorePath(
      absolutePath,
      logicalWorkspaceRoot,
      "Change store path is outside the fixed Change-store root",
    );
  }

  const physicalWorkspaceRoot = await resolvePhysicalPath(logicalWorkspaceRoot);
  const state = await assertFixedPhysicalPath(
    absolutePath,
    logicalWorkspaceRoot,
    physicalWorkspaceRoot,
  );
  if (
    state !== null
    && (absolutePath === changesRoot || absolutePath === closedRoot)
    && !state.isDirectory()
  ) {
    throw unsafeChangeStorePath(
      absolutePath,
      logicalWorkspaceRoot,
      "Change-store root is not a real directory",
    );
  }
  return path;
}

function requireRequiredChangeFile(fileName) {
  if (!CHANGE_FILE_NAMES.includes(fileName)) {
    throw new TypeError(`Unknown required Change file: ${fileName}`);
  }
  return fileName;
}

function changeFileSnapshotChanged(path, workspaceRoot, fileName, error = null) {
  return new SddError(
    `Change ${fileName} changed after it was read: ${relativeChangeStorePath(path, workspaceRoot)}`,
    {
      code: "CONCURRENT_CHANGE",
      details: error
        ? [error.message, ...(Array.isArray(error.details) ? error.details : [])]
        : [],
    },
  );
}

export async function readRequiredChangeFileSnapshot(
  changePath,
  fileName,
  workspaceRoot,
  {
    allowMissing = true,
    afterRead = null,
  } = {},
) {
  requireRequiredChangeFile(fileName);
  const path = join(changePath, fileName);
  const assertFixedPath = () => assertChangeStoreConfinement(path, workspaceRoot);
  await assertFixedPath();

  let snapshot;
  try {
    snapshot = await readBoundRegularFile(path, {
      ownerRoot: getChangesRoot(workspaceRoot),
      allowMissing,
      label: `Change required file ${fileName}`,
      unsafeCode: "UNSAFE_ARTIFACT_PATH",
      afterRead: async (observation) => {
        await assertFixedPath();
        await afterRead?.(observation);
      },
    });
  } catch (error) {
    if (
      error instanceof SddError
      && error.code === "UNSAFE_ARTIFACT_PATH"
      && error.details.length === 0
    ) {
      error.details = [relativeChangeStorePath(path, workspaceRoot)];
    }
    throw error;
  }
  if (snapshot !== null) await assertFixedPath();
  return snapshot;
}

export async function assertRequiredChangeFileSnapshotCurrent(
  changePath,
  fileName,
  workspaceRoot,
  expected,
  options = {},
) {
  const path = join(changePath, requireRequiredChangeFile(fileName));
  let current;
  try {
    current = await readRequiredChangeFileSnapshot(changePath, fileName, workspaceRoot, {
      allowMissing: true,
      afterRead: options.afterRead ?? null,
    });
  } catch (error) {
    if (["CONCURRENT_CHANGE", "UNSAFE_ARTIFACT_PATH"].includes(error?.code)) {
      throw changeFileSnapshotChanged(path, workspaceRoot, fileName, error);
    }
    throw error;
  }
  if (
    current === null
    || !Buffer.isBuffer(expected?.bytes)
    || current.identity.dev !== expected?.identity?.dev
    || current.identity.ino !== expected?.identity?.ino
    || !current.bytes.equals(expected.bytes)
  ) {
    throw changeFileSnapshotChanged(path, workspaceRoot, fileName);
  }
  return current;
}

const MAX_CHANGE_STORE_SNAPSHOT_ATTEMPTS = 8;
const STORED_CHANGE_GENERATION = Symbol("stored-change-generation");
const STORED_CHANGES_SNAPSHOT = Symbol("stored-changes-snapshot");

async function observeInventoryPath(path, workspaceRoot, reason) {
  try {
    return await lstatIfPresent(path);
  } catch (error) {
    if (!["ELOOP", "ENOTDIR"].includes(error?.code)) throw error;
    throw unsafeChangeStorePath(path, workspaceRoot, reason);
  }
}

async function inventoryDirectoryEntries(root, workspaceRoot) {
  const before = await observeInventoryPath(
    root,
    workspaceRoot,
    "Change-store root became unsafe before inventory",
  );
  if (before === null) {
    const confirmation = await observeInventoryPath(
      root,
      workspaceRoot,
      "Change-store root became unsafe during inventory",
    );
    if (confirmation === null) {
      return {
        changed: false,
        directories: [],
        invalidPaths: [],
        rootGeneration: null,
      };
    }
    if (!isRealDirectory(confirmation)) {
      throw unsafeChangeStorePath(
        root,
        workspaceRoot,
        "Change-store root is not a real directory",
      );
    }
    return changedInventory();
  }
  if (!isRealDirectory(before)) {
    throw unsafeChangeStorePath(
      root,
      workspaceRoot,
      "Change-store root is not a real directory",
    );
  }

  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return changedInventory();
    if (!["ELOOP", "ENOTDIR"].includes(error?.code)) throw error;
    throw unsafeChangeStorePath(
      root,
      workspaceRoot,
      "Change-store root became unsafe during inventory",
    );
  }

  const directories = [];
  const invalidPaths = [];
  entries = entries
    .filter((entry) => !entry.name.startsWith("."))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      invalidPaths.push(path);
      continue;
    }
    const state = await observeInventoryPath(
      path,
      workspaceRoot,
      "Change-store entry became unsafe during inventory",
    );
    if (state === null) return changedInventory();
    if (!isRealDirectory(state)) {
      invalidPaths.push(path);
      continue;
    }
    directories.push({
      name: entry.name,
      path,
      identity: { dev: state.dev, ino: state.ino },
      generation: directoryGeneration(state),
    });
  }

  const after = await observeInventoryPath(
    root,
    workspaceRoot,
    "Change-store root became unsafe during inventory",
  );
  if (after === null) return changedInventory();
  if (!isRealDirectory(after)) {
    throw unsafeChangeStorePath(
      root,
      workspaceRoot,
      "Change-store root became unsafe during inventory",
    );
  }
  const rootGeneration = directoryGeneration(before);
  if (!sameDirectoryGeneration(rootGeneration, after)) return changedInventory();
  return {
    changed: false,
    directories,
    invalidPaths,
    rootGeneration,
  };
}

function isRealDirectory(state) {
  return state !== null && !state.isSymbolicLink() && state.isDirectory();
}

function changedInventory() {
  return {
    changed: true,
    directories: [],
    invalidPaths: [],
    rootGeneration: null,
  };
}

function directoryGeneration(state) {
  return {
    dev: state.dev,
    ino: state.ino,
    ctimeNs: state.ctimeNs,
    mtimeNs: state.mtimeNs,
  };
}

function sameDirectoryGeneration(expected, current) {
  return expected !== null
    && current !== null
    && expected.dev === current.dev
    && expected.ino === current.ino
    && expected.ctimeNs === current.ctimeNs
    && expected.mtimeNs === current.mtimeNs;
}

function sameInventory(left, right) {
  if (left.changed || right.changed) return false;
  if (left.rootGeneration === null || right.rootGeneration === null) {
    if (left.rootGeneration !== right.rootGeneration) return false;
  } else if (!sameDirectoryGeneration(left.rootGeneration, right.rootGeneration)) {
    return false;
  }
  return left.directories.length === right.directories.length
    && left.directories.every((entry, index) => {
      const other = right.directories[index];
      return entry.name === other.name
        && sameDirectoryGeneration(entry.generation, other.generation);
    });
}

function throwUnsafeInventoryEntries(workspaceRoot, ...inventories) {
  const invalidPaths = [...new Set(
    inventories
      .flatMap((inventory) => inventory.invalidPaths)
      .map((path) => relativeChangeStorePath(path, workspaceRoot)),
  )].sort((left, right) => left.localeCompare(right));
  if (invalidPaths.length === 0) return;
  throw new SddError(
    `Change store entries must be real directories: ${invalidPaths.join(", ")}`,
    { code: "UNSAFE_ARTIFACT_PATH", details: invalidPaths },
  );
}

async function assertInventoryRootCurrent(root, expectedGeneration, workspaceRoot) {
  const before = await observeInventoryPath(
    root,
    workspaceRoot,
    "Change-store root became unsafe after inventory",
  );
  if (expectedGeneration === null) {
    if (before === null) return true;
    if (!isRealDirectory(before)) {
      throw unsafeChangeStorePath(
        root,
        workspaceRoot,
        "Change-store root became unsafe after inventory",
      );
    }
    return false;
  }
  if (before === null) return false;
  if (!isRealDirectory(before)) {
    throw unsafeChangeStorePath(
      root,
      workspaceRoot,
      "Change-store root became unsafe after inventory",
    );
  }
  if (!sameDirectoryGeneration(expectedGeneration, before)) return false;
  await assertChangeStoreConfinement(root, workspaceRoot);
  const after = await observeInventoryPath(
    root,
    workspaceRoot,
    "Change-store root became unsafe after inventory",
  );
  if (after === null) return false;
  if (!isRealDirectory(after)) {
    throw unsafeChangeStorePath(
      root,
      workspaceRoot,
      "Change-store root became unsafe after inventory",
    );
  }
  return sameDirectoryGeneration(expectedGeneration, after);
}

async function storedChangeRecord(entry, closed, workspaceRoot) {
  const before = await observeInventoryPath(
    entry.path,
    workspaceRoot,
    "Change-store entry became unsafe after inventory",
  );
  if (before === null) return null;
  if (!isRealDirectory(before)) {
    throw unsafeChangeStorePath(
      entry.path,
      workspaceRoot,
      "Change-store entry became unsafe after inventory",
    );
  }
  if (!sameDirectoryGeneration(entry.generation, before)) return null;
  await assertChangeStoreConfinement(entry.path, workspaceRoot);
  const after = await observeInventoryPath(
    entry.path,
    workspaceRoot,
    "Change-store entry became unsafe after inventory",
  );
  if (after === null) return null;
  if (!isRealDirectory(after)) {
    throw unsafeChangeStorePath(
      entry.path,
      workspaceRoot,
      "Change-store entry became unsafe after inventory",
    );
  }
  if (!sameDirectoryGeneration(entry.generation, after)) return null;
  const record = {
    changeId: entry.name,
    path: entry.path,
    closed,
  };
  Object.defineProperty(record, STORED_CHANGE_GENERATION, {
    value: entry.generation,
  });
  return record;
}

export async function listStoredChanges(
  workspaceRoot,
  {
    afterClosedInventory = null,
    afterInventory = null,
  } = {},
) {
  const changesRoot = getChangesRoot(workspaceRoot);
  const closedRoot = getClosedChangesRoot(workspaceRoot);

  for (let attempt = 1; attempt <= MAX_CHANGE_STORE_SNAPSHOT_ATTEMPTS; attempt += 1) {
    await assertChangeStoreConfinement(changesRoot, workspaceRoot);
    await assertChangeStoreConfinement(closedRoot, workspaceRoot);

    const closedStart = await inventoryDirectoryEntries(closedRoot, workspaceRoot);
    if (closedStart.changed) continue;
    await afterClosedInventory?.({ attempt, changesRoot, closedRoot });

    const activeStart = await inventoryDirectoryEntries(changesRoot, workspaceRoot);
    if (activeStart.changed) continue;
    throwUnsafeInventoryEntries(workspaceRoot, closedStart, activeStart);
    await afterInventory?.({ attempt, changesRoot, closedRoot });

    const closedEnd = await inventoryDirectoryEntries(closedRoot, workspaceRoot);
    const activeEnd = await inventoryDirectoryEntries(changesRoot, workspaceRoot);
    if (closedEnd.changed || activeEnd.changed) continue;
    throwUnsafeInventoryEntries(workspaceRoot, closedEnd, activeEnd);
    if (!sameInventory(closedStart, closedEnd)
      || !sameInventory(activeStart, activeEnd)) {
      continue;
    }
    if (!(await assertInventoryRootCurrent(
      changesRoot,
      activeEnd.rootGeneration,
      workspaceRoot,
    )) || !(await assertInventoryRootCurrent(
      closedRoot,
      closedEnd.rootGeneration,
      workspaceRoot,
    ))) {
      continue;
    }

    const activeEntries = activeEnd.directories
      .filter((entry) => entry.name !== CLOSED_CHANGES_DIRECTORY_NAME);
    const records = [];
    let recordsStable = true;
    for (const entry of activeEntries) {
      const record = await storedChangeRecord(entry, false, workspaceRoot);
      if (record === null) {
        recordsStable = false;
        break;
      }
      records.push(record);
    }
    if (!recordsStable) continue;
    for (const entry of closedEnd.directories) {
      const record = await storedChangeRecord(entry, true, workspaceRoot);
      if (record === null) {
        recordsStable = false;
        break;
      }
      records.push(record);
    }
    if (!recordsStable) continue;

    const closedFinal = await inventoryDirectoryEntries(closedRoot, workspaceRoot);
    const activeFinal = await inventoryDirectoryEntries(changesRoot, workspaceRoot);
    if (closedFinal.changed || activeFinal.changed) continue;
    throwUnsafeInventoryEntries(workspaceRoot, closedFinal, activeFinal);
    if (!sameInventory(closedEnd, closedFinal)
      || !sameInventory(activeEnd, activeFinal)) {
      continue;
    }
    const sortedRecords = records.sort(
      (left, right) => left.changeId.localeCompare(right.changeId)
        || Number(left.closed) - Number(right.closed),
    );
    Object.defineProperty(sortedRecords, STORED_CHANGES_SNAPSHOT, {
      value: {
        activeRootGeneration: activeFinal.rootGeneration,
        closedRootGeneration: closedFinal.rootGeneration,
      },
    });
    return sortedRecords;
  }

  throw new SddError(
    "Change store changed repeatedly while a consistent inventory was being read.",
    { code: "CONCURRENT_CHANGE", details: [".sdd/changes"] },
  );
}

function sameOptionalDirectoryGeneration(left, right) {
  if (left === null || right === null) return left === right;
  return sameDirectoryGeneration(left, right);
}

function sameStoredChangesSnapshot(left, right) {
  const leftSnapshot = left[STORED_CHANGES_SNAPSHOT];
  const rightSnapshot = right[STORED_CHANGES_SNAPSHOT];
  if (!leftSnapshot || !rightSnapshot
    || !sameOptionalDirectoryGeneration(
      leftSnapshot.activeRootGeneration,
      rightSnapshot.activeRootGeneration,
    )
    || !sameOptionalDirectoryGeneration(
      leftSnapshot.closedRootGeneration,
      rightSnapshot.closedRootGeneration,
    )
    || left.length !== right.length) {
    return false;
  }
  return left.every((record, index) => {
    const other = right[index];
    return record.changeId === other.changeId
      && record.closed === other.closed
      && record.path === other.path
      && sameDirectoryGeneration(
        record[STORED_CHANGE_GENERATION],
        other[STORED_CHANGE_GENERATION],
      );
  });
}

export async function readStoredChangesSnapshot(
  workspaceRoot,
  reader,
  {
    afterInventory = null,
    listOptions = {},
  } = {},
) {
  if (typeof reader !== "function") {
    throw new TypeError("A Change-store snapshot reader is required.");
  }
  for (let attempt = 1; attempt <= MAX_CHANGE_STORE_SNAPSHOT_ATTEMPTS; attempt += 1) {
    const records = await listStoredChanges(workspaceRoot, listOptions);
    await afterInventory?.({ attempt, records });
    let result;
    let readError = null;
    try {
      result = await reader(records, { attempt });
    } catch (error) {
      readError = error;
    }
    const currentRecords = await listStoredChanges(workspaceRoot);
    if (!sameStoredChangesSnapshot(records, currentRecords)) continue;
    if (readError) throw readError;
    return result;
  }
  throw new SddError(
    "Change store changed repeatedly while its records were being read.",
    { code: "CONCURRENT_CHANGE", details: [".sdd/changes"] },
  );
}
