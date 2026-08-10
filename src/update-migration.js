import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmdirSync,
  unlinkSync,
} from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  rename,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseDocument, stringify } from "yaml";

import { isValidChangeId } from "./change-id.js";
import {
  assertValidConfig,
  assertValidRepositoryConfig,
  assertRepositoryConfigSnapshotCurrent,
  assertWorkspaceConfigSnapshotCurrent,
  assertWorkspaceRootIsNotLegacyHome,
  getWorkspaceConfigPath as getConfigPath,
  getRepositoryConfigPath,
  isSupportedLegacyWorkspaceConfig as isSupportedLegacyConfig,
  isSupportedLegacyRepositoryConfig,
  migrateWorkspaceConfig as migrateConfig,
  readRepositoryConfigSnapshot,
  readWorkspaceConfigSnapshot,
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
  DIRECTORY_HASH_SCHEME,
  readBoundRegularFile,
  hashDirectory,
  hashDirectoryWithFileOverride,
  hashFile,
  isPathInside,
  isPathPhysicallyInside,
  pathExists,
  replaceFileAtomically,
  resolvePhysicalPath,
  writeFileAtomically,
} from "./fs.js";
import { assertDistinctRepositoryOwnership } from "./workspace.js";

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
    || /^[A-Za-z]:/.test(value)
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

function pathStateSync(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function assertDirectoryIdentitySync(path, identity, label, expectedMode = null) {
  const state = pathStateSync(path);
  if (!state?.isDirectory()
    || state.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(state), identity)
    || (expectedMode !== null && (state.mode & 0o777) !== expectedMode)) {
    throw migrationError(`${label} changed immediately before removal: ${path}`, "CONCURRENT_CHANGE");
  }
}

function assertRegularFileSync(
  path,
  identity,
  hash,
  label,
  context,
  expectedMode = null,
  expectedSource = null,
) {
  const state = pathStateSync(path);
  const source = state?.isFile() && !state.isSymbolicLink()
    ? readFileSync(path)
    : null;
  if (!state?.isFile()
    || state.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(state), identity)
    || (expectedMode !== null && (state.mode & 0o777) !== expectedMode)
    || (expectedSource !== null
      && !source.equals(Buffer.from(expectedSource, "utf8")))
    || sourceHash(source) !== hash) {
    throw migrationError(`${label} changed ${context}: ${path}`, "CONCURRENT_CHANGE");
  }
}

function inspectRemovalEntrySync(path, relativePath, label) {
  const state = pathStateSync(path);
  const type = state && removalEntryType(state);
  if (!state || type === null) {
    throw migrationError(`${label} contains unsupported state: ${path}`, "CONCURRENT_CHANGE");
  }
  return {
    relativePath,
    type,
    identity: fileIdentity(state),
    mode: state.mode & 0o777,
    hash: type === "file" ? sourceHash(readFileSync(path)) : null,
    target: type === "symlink" ? readlinkSync(path) : null,
    quarantineRelativePath: null,
  };
}

function assertRemovalEntrySync(path, expected, label) {
  const current = inspectRemovalEntrySync(path, expected.relativePath, label);
  if (!sameRemovalEntry(current, expected)) {
    throw migrationError(`${label} entry changed immediately before removal: ${path}`, "CONCURRENT_CHANGE");
  }
}

async function removeProvenFile(
  path,
  {
    expectedIdentity = null,
    expectedHash = null,
    expectedMode = null,
    expectedSource = null,
    quarantineParent = dirname(path),
    quarantinePath: requestedQuarantinePath = null,
    label = "File",
    afterVerification = null,
    beforeQuarantine = null,
    afterQuarantine = null,
    beforeRemovalMutation = null,
    assertBoundary = null,
  } = {},
) {
  let observedState = await pathState(path);
  const quarantinePath = requestedQuarantinePath ?? join(
    quarantineParent,
    `.sdd-remove-${process.pid}-${randomUUID()}`,
  );
  if (resolve(dirname(quarantinePath)) !== resolve(quarantineParent)
    || resolve(quarantinePath) === resolve(path)) {
    throw migrationError(`${label} cleanup quarantine escapes its parent: ${quarantinePath}`, "CONCURRENT_CHANGE");
  }
  let quarantineState = await pathState(quarantinePath);
  if (!observedState && !quarantineState) return false;
  if (!observedState && (expectedIdentity === null || expectedHash === null)) {
    throw migrationError(`${label} cleanup cannot adopt an unauthenticated quarantine: ${quarantinePath}`, "CONCURRENT_CHANGE");
  }
  if (observedState && (!observedState.isFile() || observedState.isSymbolicLink())) {
    throw migrationError(`${label} is not a real file: ${path}`, "CONCURRENT_CHANGE");
  }
  const identity = expectedIdentity ?? fileIdentity(observedState);
  const hash = expectedHash ?? await hashFile(path);
  const assertExpectedFile = async (candidate, context) => {
    const state = await pathState(candidate);
    if (!state?.isFile()
      || state.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(state), identity)
      || (expectedMode !== null && (state.mode & 0o777) !== expectedMode)
      || (expectedSource !== null
        && await readFile(candidate, "utf8").catch(() => null) !== expectedSource)
      || await hashFile(candidate).catch(() => null) !== hash) {
      throw migrationError(`${label} changed ${context}: ${candidate}`, "CONCURRENT_CHANGE");
    }
  };
  if (observedState) {
    await assertExpectedFile(path, "before cleanup");
    if (afterVerification) await afterVerification({ path });
    if (assertBoundary && await assertBoundary(path) === false) {
      throw migrationError(`${label} escaped its cleanup boundary: ${path}`, "CONCURRENT_CHANGE");
    }
    await assertExpectedFile(path, "after cleanup verification");
  }

  const parentState = await pathState(quarantineParent);
  if (!parentState?.isDirectory() || parentState.isSymbolicLink()) {
    throw migrationError(`${label} cleanup quarantine parent is unavailable: ${quarantineParent}`, "CONCURRENT_CHANGE");
  }
  const parentIdentity = fileIdentity(parentState);
  const assertParent = async () => {
    const current = await pathState(quarantineParent);
    if (!current?.isDirectory()
      || current.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(current), parentIdentity)) {
      throw migrationError(`${label} cleanup quarantine parent changed: ${quarantineParent}`, "CONCURRENT_CHANGE");
    }
  };
  if (quarantineState) await assertExpectedFile(quarantinePath, "in its cleanup quarantine");
  if (observedState && !quarantineState) {
    if (beforeQuarantine) await beforeQuarantine({ label, path, quarantinePath });
    await assertParent();
    await assertExpectedFile(path, "before exclusive quarantine");
    try {
      await link(path, quarantinePath);
    } catch (error) {
      throw migrationError(`${label} could not reserve an exclusive cleanup quarantine: ${path}`, "CONCURRENT_CHANGE", [
        error.message,
      ]);
    }
    await assertExpectedFile(quarantinePath, "during cleanup quarantine");
    if (afterQuarantine) await afterQuarantine({ label, path, quarantinePath });
    await assertExpectedFile(quarantinePath, "after cleanup quarantine");
    quarantineState = await pathState(quarantinePath);
  }

  observedState = await pathState(path);
  if (observedState) {
    if (beforeRemovalMutation) {
      await beforeRemovalMutation({
        label,
        path,
        quarantinePath,
        phase: "original",
      });
    }
    assertDirectoryIdentitySync(quarantineParent, parentIdentity, label);
    assertRegularFileSync(
      path,
      identity,
      hash,
      label,
      "immediately before original unlink",
      expectedMode,
      expectedSource,
    );
    assertRegularFileSync(
      quarantinePath,
      identity,
      hash,
      label,
      "before original unlink",
      expectedMode,
      expectedSource,
    );
    unlinkSync(path);
    if (pathStateSync(path)) {
      throw migrationError(`${label} was replaced during original unlink: ${path}`, "CONCURRENT_CHANGE");
    }
  }
  if (beforeRemovalMutation) {
    await beforeRemovalMutation({
      label,
      path: quarantinePath,
      originalPath: path,
      quarantinePath,
      phase: "quarantine",
    });
  }
  assertDirectoryIdentitySync(quarantineParent, parentIdentity, label);
  if (pathStateSync(path)) {
    throw migrationError(`${label} was replaced during quarantined cleanup: ${path}`, "CONCURRENT_CHANGE");
  }
  assertRegularFileSync(
    quarantinePath,
    identity,
    hash,
    label,
    "immediately before quarantine unlink",
    expectedMode,
    expectedSource,
  );
  unlinkSync(quarantinePath);
  if (pathStateSync(quarantinePath)) {
    throw migrationError(`${label} cleanup quarantine was replaced during unlink: ${quarantinePath}`, "CONCURRENT_CHANGE");
  }
  return true;
}

function removalEntryType(state) {
  if (state.isDirectory() && !state.isSymbolicLink()) return "directory";
  if (state.isFile() && !state.isSymbolicLink()) return "file";
  if (state.isSymbolicLink()) return "symlink";
  return null;
}

async function inspectRemovalEntry(path, relativePath, label) {
  const before = await pathState(path);
  const type = before ? removalEntryType(before) : null;
  if (!before || type === null) {
    throw migrationError(`${label} contains an unsupported or missing entry: ${path}`, "CONCURRENT_CHANGE");
  }
  const entry = {
    relativePath,
    type,
    identity: fileIdentity(before),
    mode: before.mode & 0o777,
    hash: null,
    target: null,
    quarantineRelativePath: null,
  };
  try {
    if (type === "file") entry.hash = await hashFile(path);
    if (type === "symlink") entry.target = await readlink(path);
  } catch (error) {
    throw migrationError(`${label} changed while its removal proof was captured: ${path}`, "CONCURRENT_CHANGE", [
      error.message,
    ]);
  }
  const after = await pathState(path);
  if (!after
    || removalEntryType(after) !== type
    || !sameFileIdentity(fileIdentity(after), entry.identity)
    || (after.mode & 0o777) !== entry.mode) {
    throw migrationError(`${label} changed while its removal proof was captured: ${path}`, "CONCURRENT_CHANGE");
  }
  return entry;
}

function removalEntryEvidence(entry, relativePath = entry.relativePath) {
  return {
    relativePath,
    type: entry.type,
    identity: entry.identity,
    mode: entry.mode,
    hash: entry.hash ?? null,
    target: entry.target ?? null,
  };
}

function sameRemovalEntry(actual, expected, relativePath = expected.relativePath) {
  return JSON.stringify(removalEntryEvidence(actual))
    === JSON.stringify(removalEntryEvidence(expected, relativePath));
}

function sameRemovalEntryContents(actual, expected) {
  return actual.relativePath === expected.relativePath
    && actual.type === expected.type
    && actual.mode === expected.mode
    && actual.hash === expected.hash
    && actual.target === expected.target;
}

async function collectDirectoryRemovalManifest(root, label, current = root) {
  const relativePath = normalizePath(relative(root, current));
  const entry = await inspectRemovalEntry(current, relativePath, label);
  if (entry.type !== "directory") {
    if (resolve(current) === resolve(root)) {
      throw migrationError(`${label} is not a real directory: ${root}`, "CONCURRENT_CHANGE");
    }
    return [entry];
  }

  const names = (await readdir(current)).sort((left, right) => left.localeCompare(right));
  const manifest = [entry];
  for (const name of names) {
    manifest.push(...await collectDirectoryRemovalManifest(root, label, join(current, name)));
  }
  const [after, afterNames] = await Promise.all([
    inspectRemovalEntry(current, relativePath, label),
    readdir(current).then((entries) => entries.sort((left, right) => left.localeCompare(right))),
  ]);
  if (!sameRemovalEntry(after, entry)
    || JSON.stringify(afterNames) !== JSON.stringify(names)) {
    throw migrationError(`${label} changed while its removal proof was captured: ${current}`, "CONCURRENT_CHANGE");
  }
  return manifest;
}

async function assertDirectoryRemovalManifest(root, manifest, label) {
  const current = await collectDirectoryRemovalManifest(root, label);
  if (current.length !== manifest.length
    || current.some((entry, index) => !sameRemovalEntry(entry, manifest[index]))) {
    throw migrationError(`${label} changed after removal verification: ${root}`, "CONCURRENT_CHANGE");
  }
}

async function captureDirectoryRemovalManifest(
  root,
  {
    expectedIdentity = null,
    expectedHash = null,
    label = "Directory",
  } = {},
) {
  const manifest = await collectDirectoryRemovalManifest(root, label);
  const rootEntry = manifest[0];
  if (rootEntry.type !== "directory"
    || (expectedIdentity && !sameFileIdentity(rootEntry.identity, expectedIdentity))
    || (expectedHash !== null
      && await hashDirectory(root).catch(() => null) !== expectedHash)) {
    throw migrationError(`${label} no longer matches its removal proof: ${root}`, "CONCURRENT_CHANGE");
  }
  await assertDirectoryRemovalManifest(root, manifest, label);
  for (const entry of manifest.slice(1)) {
    if (entry.type === "directory") continue;
    const entryPath = removalManifestPath(root, entry.relativePath);
    entry.quarantineRelativePath = normalizePath(relative(
      root,
      join(dirname(entryPath), `.sdd-remove-${process.pid}-${randomUUID()}`),
    ));
  }
  return manifest;
}

function removalManifestPath(root, relativePath) {
  return relativePath === "." ? root : join(root, ...relativePath.split("/"));
}

async function assertRemovalEntry(path, expected, label) {
  const current = await inspectRemovalEntry(path, expected.relativePath, label);
  if (!sameRemovalEntry(current, expected)) {
    throw migrationError(`${label} entry changed before removal: ${path}`, "CONCURRENT_CHANGE");
  }
}


async function collectDirectoryRemovalSubset(root, manifest, label) {
  const rootState = await pathState(root);
  const current = rootState
    ? await collectDirectoryRemovalManifest(root, label)
    : [];
  const expectedByPath = new Map(manifest.map((entry) => [entry.relativePath, entry]));
  const quarantineByPath = new Map(manifest
    .filter((entry) => entry.quarantineRelativePath !== null)
    .map((entry) => [entry.quarantineRelativePath, entry]));
  for (const entry of current) {
    const expected = expectedByPath.get(entry.relativePath);
    if (expected) {
      if (!sameRemovalEntry(entry, expected)) {
        throw migrationError(`${label} contains a replaced removal entry: ${entry.relativePath}`, "CONCURRENT_CHANGE");
      }
      continue;
    }
    const quarantined = quarantineByPath.get(entry.relativePath);
    if (!quarantined || !sameRemovalEntry(entry, quarantined, entry.relativePath)) {
      throw migrationError(`${label} contains opaque state during resumable cleanup: ${entry.relativePath}`, "CONCURRENT_CHANGE");
    }
  }
  return {
    currentByPath: new Map(current.map((entry) => [entry.relativePath, entry])),
    expectedByPath,
    quarantineByPath,
  };
}

async function assertDirectoryRemovalSubset(
  root,
  manifest,
  progress,
  label,
) {
  const subset = await collectDirectoryRemovalSubset(root, manifest, label);
  for (const relativePath of progress) {
    const entry = subset.expectedByPath.get(relativePath);
    if (!entry
      || subset.currentByPath.has(relativePath)
      || (entry.quarantineRelativePath !== null
        && subset.currentByPath.has(entry.quarantineRelativePath))) {
      throw migrationError(`${label} cleanup progress contradicts surviving state: ${relativePath}`, "CONCURRENT_CHANGE");
    }
  }
  return subset;
}


async function removeManifestEntry(
  root,
  entry,
  entriesByPath,
  label,
  {
    beforeQuarantine = null,
    afterQuarantine = null,
    beforeRemovalMutation = null,
  } = {},
) {
  const entryPath = removalManifestPath(root, entry.relativePath);
  const parentRelativePath = normalizePath(dirname(entry.relativePath));
  const parentEntry = entriesByPath.get(parentRelativePath);
  const parentPath = dirname(entryPath);
  if (!parentEntry) {
    throw migrationError(`${label} removal proof lost an entry parent: ${entryPath}`, "CONCURRENT_CHANGE");
  }
  const assertParent = () => assertRemovalEntry(parentPath, parentEntry, label);
  const assertOriginal = () => assertRemovalEntry(entryPath, entry, label);

  if (entry.type === "directory") {
    if (entry.quarantineRelativePath !== null) {
      throw migrationError(`${label} directory removal proof has an unsafe quarantine: ${entryPath}`, "CONCURRENT_CHANGE");
    }
    const originalState = await pathState(entryPath);
    if (!originalState) return;
    await assertParent();
    await assertOriginal();
    if ((await readdir(entryPath)).length !== 0) {
      throw migrationError(`${label} directory gained unproven content: ${entryPath}`, "CONCURRENT_CHANGE");
    }
    if (beforeRemovalMutation) {
      await beforeRemovalMutation({
        label,
        root,
        path: entryPath,
        quarantinePath: null,
        entry,
        phase: "directory",
      });
    }
    assertRemovalEntrySync(parentPath, parentEntry, label);
    assertRemovalEntrySync(entryPath, entry, label);
    if (readdirSync(entryPath).length !== 0) {
      throw migrationError(`${label} directory gained unproven content: ${entryPath}`, "CONCURRENT_CHANGE");
    }
    rmdirSync(entryPath);
    if (pathStateSync(entryPath)) {
      throw migrationError(`${label} directory was replaced during removal: ${entryPath}`, "CONCURRENT_CHANGE");
    }
    return;
  }
  if (entry.quarantineRelativePath === null) {
    throw migrationError(`${label} removal proof lacks an entry quarantine: ${entryPath}`, "CONCURRENT_CHANGE");
  }
  const quarantinePath = removalManifestPath(root, entry.quarantineRelativePath);
  const assertQuarantine = async () => {
    const quarantined = await inspectRemovalEntry(
      quarantinePath,
      entry.quarantineRelativePath,
      label,
    ).catch(() => null);
    if (!quarantined
      || !sameRemovalEntry(quarantined, entry, entry.quarantineRelativePath)) {
      throw migrationError(`${label} entry quarantine changed: ${quarantinePath}`, "CONCURRENT_CHANGE");
    }
  };
  let originalState = await pathState(entryPath);
  let quarantineState = await pathState(quarantinePath);
  if (!originalState && !quarantineState) return;
  await assertParent();
  if (originalState) await assertOriginal();
  if (quarantineState) await assertQuarantine();

  if (!quarantineState) {
    if (beforeQuarantine) {
      await beforeQuarantine({
        label,
        root,
        path: entryPath,
        quarantinePath,
        entry,
      });
    }
    await assertParent();
    await assertOriginal();
    try {
      await link(entryPath, quarantinePath);
    } catch (error) {
      throw migrationError(`${label} could not reserve an exclusive entry quarantine: ${entryPath}`, "CONCURRENT_CHANGE", [
        error.message,
      ]);
    }
    await assertQuarantine();
    if (afterQuarantine) {
      await afterQuarantine({
        label,
        root,
        path: entryPath,
        quarantinePath,
        entry,
      });
    }
    quarantineState = await pathState(quarantinePath);
  }

  originalState = await pathState(entryPath);
  if (originalState) {
    await assertParent();
    await assertOriginal();
    await assertQuarantine();
    if (beforeRemovalMutation) {
      await beforeRemovalMutation({
        label,
        root,
        path: entryPath,
        quarantinePath,
        entry,
        phase: "original",
      });
    }
    assertRemovalEntrySync(parentPath, parentEntry, label);
    assertRemovalEntrySync(entryPath, entry, label);
    assertRemovalEntrySync(quarantinePath, entry, label);
    unlinkSync(entryPath);
    if (pathStateSync(entryPath)) {
      throw migrationError(`${label} entry was replaced during original unlink: ${entryPath}`, "CONCURRENT_CHANGE");
    }
  }

  await assertParent();
  if (await pathState(entryPath)) {
    throw migrationError(`${label} entry was replaced during quarantined cleanup: ${entryPath}`, "CONCURRENT_CHANGE");
  }
  await assertQuarantine();
  if (beforeRemovalMutation) {
    await beforeRemovalMutation({
      label,
      root,
      path: quarantinePath,
      originalPath: entryPath,
      quarantinePath,
      entry,
      phase: "quarantine",
    });
  }
  assertRemovalEntrySync(parentPath, parentEntry, label);
  if (pathStateSync(entryPath)) {
    throw migrationError(`${label} entry was replaced during quarantined cleanup: ${entryPath}`, "CONCURRENT_CHANGE");
  }
  assertRemovalEntrySync(quarantinePath, entry, label);
  unlinkSync(quarantinePath);
  if (pathStateSync(quarantinePath)) {
    throw migrationError(`${label} entry quarantine was replaced during removal: ${quarantinePath}`, "CONCURRENT_CHANGE");
  }
}

async function removeProvenDirectoryTree(
  root,
  {
    expectedIdentity = null,
    expectedHash = null,
    label = "Directory",
    verifyRemoval = null,
    afterVerification = null,
    beforeQuarantine = null,
    afterQuarantine = null,
    beforeRemovalMutation = null,
    assertBoundary = null,
    removalManifest = null,
    removalProgress = [],
    persistRemovalManifest = null,
    persistRemovalProgress = null,
  } = {},
) {
  if (assertBoundary) await assertBoundary();
  let manifest = removalManifest;
  if (manifest === null) {
    manifest = await captureDirectoryRemovalManifest(root, {
      expectedIdentity,
      expectedHash,
      label,
    });
    if (persistRemovalManifest) await persistRemovalManifest(manifest);
  } else {
    const rootEntry = manifest[0];
    if (!rootEntry
      || rootEntry.type !== "directory"
      || (expectedIdentity && !sameFileIdentity(rootEntry.identity, expectedIdentity))) {
      throw migrationError(`${label} durable removal proof does not match its root: ${root}`, "CONCURRENT_CHANGE");
    }
  }
  if (verifyRemoval) await verifyRemoval(root);
  if (afterVerification) await afterVerification({ path: root });
  if (verifyRemoval) await verifyRemoval(root);
  if (assertBoundary) await assertBoundary();

  const progress = new Set(removalProgress);
  let subset = await assertDirectoryRemovalSubset(root, manifest, progress, label);
  let reconciled = false;
  for (const entry of manifest) {
    if (progress.has(entry.relativePath)) continue;
    if (!subset.currentByPath.has(entry.relativePath)
      && (entry.quarantineRelativePath === null
        || !subset.currentByPath.has(entry.quarantineRelativePath))) {
      progress.add(entry.relativePath);
      reconciled = true;
    }
  }
  if (reconciled && persistRemovalProgress) {
    await persistRemovalProgress([...progress].sort((left, right) => left.localeCompare(right)));
  }

  const entriesByPath = new Map(manifest.map((entry) => [entry.relativePath, entry]));
  const descendants = manifest.slice(1).sort((left, right) => {
    const depth = (entry) => entry.relativePath.split("/").length;
    return depth(right) - depth(left)
      || right.relativePath.localeCompare(left.relativePath);
  });
  for (const entry of descendants) {
    if (progress.has(entry.relativePath)) continue;
    if (assertBoundary) await assertBoundary();
    await removeManifestEntry(root, entry, entriesByPath, label, {
      beforeQuarantine,
      afterQuarantine,
      beforeRemovalMutation,
    });
    progress.add(entry.relativePath);
    if (persistRemovalProgress) {
      await persistRemovalProgress([...progress].sort((left, right) => left.localeCompare(right)));
    }
  }
  const rootEntry = manifest[0];
  if (!progress.has(rootEntry.relativePath)) {
    if (assertBoundary) await assertBoundary();
    const rootState = await pathState(root);
    if (rootState) {
      await assertRemovalEntry(root, rootEntry, label);
      if ((await readdir(root)).length !== 0) {
        throw migrationError(`${label} gained unproven content before root removal: ${root}`, "CONCURRENT_CHANGE");
      }
      if (assertBoundary) await assertBoundary();
      if (beforeRemovalMutation) {
        await beforeRemovalMutation({
          label,
          root,
          path: root,
          entry: rootEntry,
          phase: "root",
        });
      }
      assertRemovalEntrySync(root, rootEntry, label);
      if (readdirSync(root).length !== 0) {
        throw migrationError(`${label} gained unproven content before root removal: ${root}`, "CONCURRENT_CHANGE");
      }
      rmdirSync(root);
      if (pathStateSync(root)) {
        throw migrationError(`${label} root was replaced during removal: ${root}`, "CONCURRENT_CHANGE");
      }
    }
    progress.add(rootEntry.relativePath);
    if (persistRemovalProgress) {
      await persistRemovalProgress([...progress].sort((left, right) => left.localeCompare(right)));
    }
  }
  subset = await collectDirectoryRemovalSubset(root, manifest, label);
  if (subset.currentByPath.size !== 0) {
    throw migrationError(`${label} retained state after resumable cleanup: ${root}`, "CONCURRENT_CHANGE");
  }
  return { manifest, progress: [...progress] };
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
  if (verifyHash) {
    const currentHash = await hashDirectory(source.physicalPath);
    if (currentHash !== root.hash) {
      throw migrationError(
        `Legacy source changed after migration preflight: ${root.path}`,
        "CONCURRENT_CHANGE",
        [`Expected: ${root.hash}`, `Actual: ${currentHash}`],
      );
    }
  }
  return source;
}

async function collectTreeEntries(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => {
    if (left.name < right.name) return -1;
    if (left.name > right.name) return 1;
    return 0;
  });
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
  return hashDirectoryWithFileOverride(root, "tasks.md", tasksSource);
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

function legacyPlannedEntryKind(entry) {
  if (entry.isDirectory() && isValidChangeId(entry.name)) return "change";
  if (entry.isFile() && entry.name.endsWith(".md")) return "brief";
  return null;
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
    const entryKind = legacyPlannedEntryKind(entry);
    if (entryKind === "change") {
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
    if (entryKind === "brief") {
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

function createConfigWrite(ownerRoot, snapshot, nextConfig, kind) {
  const path = kind === "repository-config"
    ? getRepositoryConfigPath(ownerRoot)
    : getConfigPath(ownerRoot);
  const nextSource = serializeConfig(nextConfig);
  return {
    kind,
    ownerRoot,
    path,
    originalSource: snapshot.source,
    originalHash: sourceHash(snapshot.source),
    originalIdentity: snapshot.identity,
    originalMode: snapshot.mode,
    originalOwnerBinding: snapshot.ownerBinding,
    nextSource,
    nextHash: sourceHash(nextSource),
    fromVersion: snapshot.config.version,
    fromSchema: snapshot.config.schema,
    toVersion: nextConfig.version,
    toSchema: nextConfig.schema,
  };
}

async function loadRepositoryConfiguration(repositoryRoot) {
  const path = getRepositoryConfigPath(repositoryRoot);
  const snapshot = await readRepositoryConfigSnapshot(repositoryRoot);
  if (snapshot === null) return null;
  const config = snapshot.config;
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
    snapshot,
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
    destinationWorkspaceRoot = workspaceRoot,
    legacyWorkspaceRoot: requestedLegacyWorkspaceRoot = null,
    workspaceConfigSnapshot: requestedWorkspaceConfigSnapshot = null,
    afterRepositoryConfigLoaded = null,
  } = {},
) {
  const workspaceConfigSnapshot = requestedWorkspaceConfigSnapshot
    ?? await readWorkspaceConfigSnapshot(workspaceRoot);
  if (JSON.stringify(workspaceConfigSnapshot.config) !== JSON.stringify(rawConfig)) {
    throw migrationError(
      `Workspace configuration changed before migration planning: ${getConfigPath(workspaceRoot)}`,
      "CONCURRENT_CHANGE",
    );
  }
  const migrated = migrateConfig(rawConfig, workspaceRoot);
  let config = migrated.config;
  assertValidConfig(config, "update the SDD installation");
  await assertDistinctRepositoryOwnership(workspaceRoot, config);

  const candidates = [];
  const briefs = [];
  const sourceRoots = new Map();
  const configWrites = [];
  const readGuards = [];
  const warnings = [];
  if (migrated.migratedFrom === null) {
    readGuards.push({
      kind: "workspace-config",
      ownerRoot: resolve(workspaceRoot),
      path: getConfigPath(workspaceRoot),
      hash: sourceHash(workspaceConfigSnapshot.source),
      source: workspaceConfigSnapshot.source,
      identity: workspaceConfigSnapshot.identity,
      mode: workspaceConfigSnapshot.mode,
      ownerBinding: workspaceConfigSnapshot.ownerBinding,
    });
  }
  if (migrated.migratedFrom !== null) {
    configWrites.push(createConfigWrite(workspaceRoot, workspaceConfigSnapshot, config, "configuration"));
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
    const legacyConfigSnapshot = await readWorkspaceConfigSnapshot(legacyWorkspaceRoot);
    legacyConfig = legacyConfigSnapshot.config;
    await assertWorkspaceConfigSnapshotCurrent(
      legacyWorkspaceRoot,
      legacyConfigSnapshot,
    );
    if (!isSupportedLegacyConfig(legacyConfig)) {
      throw migrationError(
        `Configured legacy migration source is not supported: ${legacyConfigPath}`,
        "MIGRATION_SOURCE_UNAVAILABLE",
      );
    }
    const migratedLegacyConfig = migrateConfig(legacyConfig, legacyWorkspaceRoot).config;
    assertValidConfig(migratedLegacyConfig, "read the legacy migration source");
    await assertDistinctRepositoryOwnership(legacyWorkspaceRoot, migratedLegacyConfig);
    readGuards.push({
      kind: "legacy-workspace-config",
      ownerRoot: resolve(legacyWorkspaceRoot),
      path: legacyConfigPath,
      hash: sourceHash(legacyConfigSnapshot.source),
      source: legacyConfigSnapshot.source,
      identity: legacyConfigSnapshot.identity,
      mode: legacyConfigSnapshot.mode,
      ownerBinding: legacyConfigSnapshot.ownerBinding,
    });
    if (config.migration !== undefined) {
      const nextConfig = structuredClone(config);
      delete nextConfig.migration;
      configWrites.push(createConfigWrite(
        workspaceRoot,
        workspaceConfigSnapshot,
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
    if (context.configuration) {
      await afterRepositoryConfigLoaded?.({
        repositoryRoot: context.repositoryRoot,
        snapshot: context.configuration.snapshot,
      });
    }
    const rawRepositoryConfig = context.configuration?.config ?? null;
    context.legacyArtifacts = legacyRepositoryArtifacts(rawRepositoryConfig, legacyConfig);
    if (context.configuration?.migratedFrom === null && context.configuration) {
      readGuards.push({
        kind: "repository-config",
        ownerRoot: resolve(context.repositoryRoot),
        path: context.configuration.path,
        hash: sourceHash(context.configuration.snapshot.source),
        source: context.configuration.snapshot.source,
        identity: context.configuration.snapshot.identity,
        mode: context.configuration.snapshot.mode,
        ownerBinding: context.configuration.snapshot.ownerBinding,
      });
    }
    if (context.configuration?.migratedFrom !== null && context.configuration) {
      configWrites.push(createConfigWrite(
        context.repositoryRoot,
        context.configuration.snapshot,
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
        context.owners.some((owner) => owner.spaceId === spaceId),
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
  for (const record of await listStoredChanges(destinationWorkspaceRoot)) {
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
      ? getClosedChangePath(changeId, destinationWorkspaceRoot)
      : getActiveChangePath(changeId, destinationWorkspaceRoot);
    await assertChangeStoreConfinement(destination, destinationWorkspaceRoot);
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
    destinationWorkspaceRoot,
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

async function assertConfigWriteCurrent(write) {
  if (
    sourceHash(write.originalSource) !== write.originalHash
    || typeof write.originalIdentity?.dev !== "string"
    || typeof write.originalIdentity?.ino !== "string"
    || !Number.isInteger(write.originalMode)
    || write.originalOwnerBinding == null
  ) {
    throw migrationError(`Configuration guard is invalid: ${write.path}`, "CONCURRENT_CHANGE");
  }
  const expected = {
    source: write.originalSource,
    identity: write.originalIdentity,
    mode: write.originalMode,
    ownerBinding: write.originalOwnerBinding,
  };
  if (write.ownerAnchor) {
    await assertStoredDirectoryAnchor(write.ownerRoot, write.ownerAnchor, "Configuration owner");
  }
  if (write.kind === "repository-config") {
    await assertRepositoryConfigSnapshotCurrent(write.ownerRoot, expected);
  } else {
    await assertWorkspaceConfigSnapshotCurrent(write.ownerRoot, expected);
  }
}

async function verifyMigrationPlan(plan) {
  await assertReadGuardsCurrent(plan.readGuards ?? []);
  for (const write of plan.configWrites) {
    await assertConfigWriteCurrent(write);
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

async function verifyMigrationDestinations(plan, transactionState) {
  await assertReadGuardsCurrent(plan.readGuards ?? []);
  for (const guard of transactionState.destinationGuards) {
    await assertDestinationGuard(guard, transactionState.destinationWorkspaceRoot);
  }
  for (const change of plan.changes) {
    await assertChangeStoreConfinement(change.destination, plan.destinationWorkspaceRoot);
    const destinationState = await pathState(change.destination);
    if (!destinationState?.isDirectory() || destinationState.isSymbolicLink()
      || await hashDirectory(change.destination) !== change.canonicalHash) {
      throw migrationError(
        `Central Change destination changed before legacy source removal: ${change.destination}`,
        "CONCURRENT_CHANGE",
      );
    }
  }
  for (const write of transactionState.writtenConfigs) {
    await assertPublishedConfigProof(write);
  }
  for (const change of transactionState.publishedChanges) {
    if (!(await authenticatePublishedCopyLedger(transactionState, change))) {
      throw migrationError(
        `Central Change destination lost its publication provenance: ${change.destination}`,
        "CONCURRENT_CHANGE",
      );
    }
  }
  for (const brief of transactionState.publishedBriefs) {
    try {
      await assertPublishedBriefProof(brief);
    } catch (error) {
      throw migrationError(
        `Change Brief destination changed before legacy source removal: ${brief.destination}`,
        "CONCURRENT_CHANGE",
        [error.message],
      );
    }
  }
  for (const write of transactionState.writtenConfigs) {
    await assertPublishedConfigProof(write);
  }
  await assertReadGuardsCurrent(plan.readGuards ?? []);
}

const CANONICAL_CHANGE_HASH_SCHEME = DIRECTORY_HASH_SCHEME;
const MIGRATION_JOURNAL_VERSION = 8;
const MIGRATION_JOURNAL_WRITE_AUTHORITY_VERSION = 1;
const MIGRATION_DESTINATION_MANIFEST_VERSION = 2;
const MIGRATION_SOURCE_DERIVED_MANIFEST_VERSION = 2;
const SOURCE_BACKUP_PROVENANCE_VERSION = 1;
const SOURCE_BACKUP_PROVENANCE_SCHEME = "sha256-source-backup-entry-v1";
const MIGRATION_JOURNAL_NAME = "transaction.json";
const MIGRATION_JOURNAL_WRITE_PROOF_NAME = ".transaction.json.sdd-write-proof";
const MIGRATION_JOURNAL_WRITE_AUTHORITY_NAME = ".transaction.json.sdd-write-authority";
const MIGRATION_JOURNAL_WRITE_CLEANUP_DIRECTORY_NAME =
  ".transaction.json.sdd-write-cleanup";
const MIGRATION_JOURNAL_WRITE_TEMPORARY_CLEANUP_NAME =
  ".transaction.json.sdd-write-temporary-cleanup";
const MIGRATION_JOURNAL_WRITE_PROOF_CLEANUP_NAME =
  ".transaction.json.sdd-write-proof-cleanup";
const MIGRATION_JOURNAL_WRITE_AUTHORITY_CLEANUP_NAME =
  ".transaction.json.sdd-write-authority-cleanup";
const MIGRATION_DESTINATION_MANIFEST_NAME = "destinations.json";
const MIGRATION_SOURCE_DERIVED_MANIFEST_NAME = "source-derived-destinations.json";
const MIGRATION_STAGING_PREFIX = ".sdd-update-";
const MIGRATION_INITIALIZATION_RESERVATION_SUFFIX = "-initialization.guard";
const MIGRATION_INITIALIZATION_BINDING_SUFFIX = "-initialization.binding.json";
const MIGRATION_TERMINAL_CLEANUP_VERSION = 1;
const MIGRATION_TERMINAL_CLEANUP_RECEIPT_SUFFIX = ".terminal-cleanup.json";
const MIGRATION_TERMINAL_CLEANUP_QUARANTINE_SUFFIX = ".sdd-terminal-cleanup";

function readGuardProofPath(stagingRoot, index) {
  return join(stagingRoot, `.read-guard-${index}`);
}

async function assertReadGuardCurrent(guard, { requireProof = true } = {}) {
  const repositoryGuard = guard.kind === "repository-config";
  const workspaceGuard = ["workspace-config", "legacy-workspace-config"].includes(guard.kind);
  const expectedPath = repositoryGuard
    ? getRepositoryConfigPath(guard.ownerRoot)
    : getConfigPath(guard.ownerRoot);
  if (
    (!repositoryGuard && !workspaceGuard)
    || resolve(guard.path) !== resolve(expectedPath)
    || sourceHash(guard.source) !== guard.hash
  ) {
    throw migrationError(`Migration authority guard is invalid: ${guard.path}`, "CONCURRENT_CHANGE");
  }
  const assertOwnerAnchor = async () => {
    if (!guard.ownerAnchor) return;
    await assertStoredDirectoryAnchor(
      guard.ownerRoot,
      guard.ownerAnchor,
      "Migration authority owner",
    );
  };
  await assertOwnerAnchor();
  if (repositoryGuard) {
    await assertRepositoryConfigSnapshotCurrent(guard.ownerRoot, guard);
  } else {
    await assertWorkspaceConfigSnapshotCurrent(guard.ownerRoot, guard);
  }
  if (!requireProof || !guard.proofPath) return;

  let proof;
  try {
    proof = await readBoundRegularFile(guard.proofPath, {
      ownerRoot: dirname(guard.proofPath),
      allowMissing: true,
      label: "Migration authority proof",
      unsafeCode: "CONCURRENT_CHANGE",
    });
  } catch (error) {
    throw migrationError(
      `Migration authority proof changed before recovery: ${guard.proofPath}`,
      "CONCURRENT_CHANGE",
      [error.message, ...(error.details ?? [])],
    );
  }
  if (
    proof === null
    || !sameFileIdentity(proof.identity, guard.proofIdentity)
    || sourceHash(proof.source) !== guard.hash
    || proof.source !== guard.source
    || proof.mode !== guard.mode
  ) {
    throw migrationError(
      `Migration authority proof changed before recovery: ${guard.proofPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  await assertOwnerAnchor();
  if (repositoryGuard) {
    await assertRepositoryConfigSnapshotCurrent(guard.ownerRoot, guard);
  } else {
    await assertWorkspaceConfigSnapshotCurrent(guard.ownerRoot, guard);
  }
}

async function assertReadGuardsCurrent(guards, options = {}) {
  for (const guard of guards) await assertReadGuardCurrent(guard, options);
}
function transactionStorePaths(destinationWorkspaceRoot) {
  const changesRoot = getChangesRoot(destinationWorkspaceRoot);
  return {
    workspaceRoot: resolve(destinationWorkspaceRoot),
    configRoot: dirname(changesRoot),
    changesRoot,
  };
}

async function captureTransactionStoreAnchors(destinationWorkspaceRoot, { initialize = false } = {}) {
  const paths = transactionStorePaths(destinationWorkspaceRoot);
  const workspace = await captureDirectoryAnchor(
    paths.workspaceRoot,
    "Destination migration workspace",
    "CONCURRENT_CHANGE",
  );
  const config = await captureDirectoryAnchor(
    paths.configRoot,
    "Destination configuration store",
    "CONCURRENT_CHANGE",
  );
  if (!isStrictlyInside(workspace.physicalPath, config.physicalPath)) {
    throw migrationError(
      `Destination configuration store escapes its workspace: ${paths.configRoot}`,
      "UNSAFE_ARTIFACT_PATH",
    );
  }
  let changesState = await pathState(paths.changesRoot);
  if (!changesState && initialize) {
    await assertStoredDirectoryAnchor(paths.workspaceRoot, workspace, "Destination migration workspace");
    await assertStoredDirectoryAnchor(paths.configRoot, config, "Destination configuration store");
    try {
      await mkdir(paths.changesRoot);
    } catch (error) {
      throw migrationError(
        `Cannot exclusively initialize the Change store: ${paths.changesRoot}`,
        error?.code === "EEXIST" ? "CONCURRENT_CHANGE" : "UNSAFE_ARTIFACT_PATH",
        [error.message],
      );
    }
    changesState = await pathState(paths.changesRoot);
  }
  if (!changesState) {
    throw migrationError(`Change store is unavailable: ${paths.changesRoot}`, "CONCURRENT_CHANGE");
  }
  const changes = await captureDirectoryAnchor(
    paths.changesRoot,
    "Destination Change store",
    "CONCURRENT_CHANGE",
  );
  if (!isStrictlyInside(config.physicalPath, changes.physicalPath)) {
    throw migrationError(
      `Destination Change store escapes its configuration store: ${paths.changesRoot}`,
      "UNSAFE_ARTIFACT_PATH",
    );
  }
  await assertStoredDirectoryAnchor(paths.workspaceRoot, workspace, "Destination migration workspace");
  await assertStoredDirectoryAnchor(paths.configRoot, config, "Destination configuration store");
  await assertStoredDirectoryAnchor(paths.changesRoot, changes, "Destination Change store");
  return { ...paths, workspace, config, changes, staging: null };
}

async function assertTransactionStoreAnchors(state, { staging = true, path = state.stagingRoot } = {}) {
  const anchors = state.storeAnchors;
  if (!anchors) {
    throw migrationError("Migration transaction store identity is unavailable.", "CONCURRENT_CHANGE");
  }
  const [workspace, config, changes] = await Promise.all([
    assertStoredDirectoryAnchor(anchors.workspaceRoot, anchors.workspace, "Destination migration workspace"),
    assertStoredDirectoryAnchor(anchors.configRoot, anchors.config, "Destination configuration store"),
    assertStoredDirectoryAnchor(anchors.changesRoot, anchors.changes, "Destination Change store"),
  ]);
  if (!isStrictlyInside(workspace.physicalPath, config.physicalPath)
    || !isStrictlyInside(config.physicalPath, changes.physicalPath)) {
    throw migrationError("Migration Change store escaped its captured workspace owner.", "CONCURRENT_CHANGE");
  }
  if (staging) {
    if (!anchors.staging) {
      throw migrationError("Migration staging identity is unavailable.", "CONCURRENT_CHANGE");
    }
    const currentStaging = await assertStoredDirectoryAnchor(
      state.stagingRoot,
      anchors.staging,
      "Migration staging root",
    );
    if (!isStrictlyInside(changes.physicalPath, currentStaging.physicalPath)) {
      throw migrationError("Migration staging root escaped its captured Change store.", "CONCURRENT_CHANGE");
    }
  }
  await assertChangeStoreConfinement(path, state.destinationWorkspaceRoot);
}

function initializationReservationPath(destinationWorkspaceRoot, stagingRoot) {
  const { configRoot } = transactionStorePaths(destinationWorkspaceRoot);
  return join(
    configRoot,
    `${basename(stagingRoot)}${MIGRATION_INITIALIZATION_RESERVATION_SUFFIX}`,
  );
}

function initializationBindingPath(destinationWorkspaceRoot, stagingRoot) {
  const { configRoot } = transactionStorePaths(destinationWorkspaceRoot);
  return join(
    configRoot,
    `${basename(stagingRoot)}${MIGRATION_INITIALIZATION_BINDING_SUFFIX}`,
  );
}

function initializationAuthorityRecord(state) {
  const authorityPath = resolve(getConfigPath(state.destinationWorkspaceRoot));
  const readGuard = state.readGuards.find(
    (record) => resolve(record.path) === authorityPath,
  );
  if (readGuard) {
    return {
      path: authorityPath,
      identity: readGuard.identity,
      hash: readGuard.hash,
      source: readGuard.source,
      ownerRoot: readGuard.ownerRoot,
      ownerAnchor: readGuard.ownerAnchor,
      mode: readGuard.mode,
    };
  }
  const configWrite = state.writtenConfigs.find(
    (record) => resolve(record.path) === authorityPath,
  );
  if (configWrite) {
    return {
      path: authorityPath,
      identity: configWrite.originalIdentity,
      hash: configWrite.originalHash,
      source: configWrite.originalSource,
      ownerRoot: configWrite.ownerRoot,
      ownerAnchor: configWrite.ownerAnchor,
      mode: configWrite.originalMode,
    };
  }
  throw migrationError(
    `Migration initialization has no workspace configuration authority: ${authorityPath}`,
    "CONCURRENT_CHANGE",
  );
}

async function assertInitializationAuthority(state, expectedIdentity = null) {
  const authority = initializationAuthorityRecord(state);
  if (!Number.isInteger(authority.mode)
    || authority.mode < 0
    || authority.mode > 0o777
    || resolve(authority.ownerAnchor?.logicalPath ?? "") !== resolve(authority.ownerRoot)) {
    throw migrationError(
      `Migration initialization authority metadata is invalid: ${authority.path}`,
      "CONCURRENT_CHANGE",
    );
  }
  const owner = await assertStoredDirectoryAnchor(
    authority.ownerRoot,
    authority.ownerAnchor,
    "Migration initialization authority owner",
  );
  if (!(await isPathPhysicallyInside(owner.physicalPath, authority.path))) {
    throw migrationError(
      `Migration initialization authority escapes its owner: ${authority.path}`,
      "CONCURRENT_CHANGE",
    );
  }
  const [authorityState, authoritySource] = await Promise.all([
    pathState(authority.path),
    readFile(authority.path, "utf8").catch(() => null),
  ]);
  if (!authorityState?.isFile()
    || authorityState.isSymbolicLink()
    || (authorityState.mode & 0o777) !== authority.mode
    || !sameFileIdentity(fileIdentity(authorityState), authority.identity)
    || (expectedIdentity !== null
      && !sameFileIdentity(fileIdentity(authorityState), expectedIdentity))
    || authoritySource !== authority.source
    || sourceHash(authoritySource) !== authority.hash) {
    throw migrationError(
      `Migration initialization authority changed: ${authority.path}`,
      "CONCURRENT_CHANGE",
    );
  }
  await assertStoredDirectoryAnchor(
    authority.ownerRoot,
    authority.ownerAnchor,
    "Migration initialization authority owner",
  );
  return { ...authority, state: authorityState };
}

async function initializeTransactionStaging(
  state,
  afterTransactionStagingReservation = null,
  afterTransactionInitializationReservation = null,
  afterTransactionInitializationBinding = null,
  afterTransactionStagingRootCreate = null,
) {
  await assertTransactionStoreAnchors(state, { staging: false });
  const reservationPath = initializationReservationPath(
    state.destinationWorkspaceRoot,
    state.stagingRoot,
  );
  const bindingPath = initializationBindingPath(
    state.destinationWorkspaceRoot,
    state.stagingRoot,
  );
  for (const path of [reservationPath, bindingPath]) {
    if (resolve(dirname(path)) !== resolve(state.storeAnchors.config.logicalPath)
      || !(await isPathPhysicallyInside(state.storeAnchors.config.physicalPath, path))) {
      throw migrationError(
        `Migration initialization evidence escapes its configuration store: ${path}`,
        "UNSAFE_ARTIFACT_PATH",
      );
    }
  }
  if (await pathState(reservationPath) || await pathState(bindingPath)) {
    throw migrationError(
      `Migration initialization evidence already exists: ${reservationPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  const authority = await assertInitializationAuthority(state);
  try {
    await link(authority.path, reservationPath);
  } catch (error) {
    throw migrationError(
      `Cannot exclusively reserve migration initialization: ${reservationPath}`,
      error?.code === "EEXIST" ? "CONCURRENT_CHANGE" : "MIGRATION_STAGING_FAILED",
      [error.message],
    );
  }
  await syncDirectory(state.storeAnchors.config.logicalPath);
  const reservationState = await pathState(reservationPath);
  const reservationSource = await readFile(reservationPath, "utf8").catch(() => null);
  if (!reservationState?.isFile()
    || reservationState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(reservationState), authority.identity)
    || reservationSource !== authority.source
    || sourceHash(reservationSource) !== authority.hash) {
    throw migrationError(
      `Migration initialization reservation is not authority-bound: ${reservationPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  state.initializationReservationPath = reservationPath;
  state.initializationReservationIdentity = fileIdentity(reservationState);
  state.initializationBindingPath = bindingPath;
  state.initializationPhase = "reserved";

  if (afterTransactionInitializationReservation) {
    await afterTransactionInitializationReservation({
      state,
      reservationPath,
      stagingRoot: state.stagingRoot,
    });
  }
  const binding = await writeDurableEvidenceExclusive(bindingPath, (ownerIdentity) => ({
    version: 1,
    stagingRoot: resolve(state.stagingRoot),
    destinationWorkspaceRoot: resolve(state.destinationWorkspaceRoot),
    ownerIdentity,
    reservationIdentity: state.initializationReservationIdentity,
    stagingPhase: "pending",
    stagingIdentity: null,
    authorityPath: authority.path,
    authorityIdentity: authority.identity,
    authorityHash: authority.hash,
    authorityMode: authority.mode,
    authorityOwnerAnchor: authority.ownerAnchor,
    changesIdentity: {
      dev: state.storeAnchors.changes.dev,
      ino: state.storeAnchors.changes.ino,
    },
  }));
  state.initializationBindingIdentity = binding.ownerIdentity;
  if (afterTransactionInitializationBinding) {
    await afterTransactionInitializationBinding({
      state,
      reservationPath,
      bindingPath,
      stagingRoot: state.stagingRoot,
    });
  }
  if (await pathState(state.stagingRoot)) {
    throw migrationError(
      `Migration staging root already exists: ${state.stagingRoot}`,
      "CONCURRENT_CHANGE",
    );
  }
  try {
    await mkdir(state.stagingRoot);
  } catch (error) {
    throw migrationError(
      `Cannot exclusively initialize migration staging: ${state.stagingRoot}`,
      error?.code === "EEXIST" ? "CONCURRENT_CHANGE" : "MIGRATION_STAGING_FAILED",
      [error.message],
    );
  }
  const staging = await captureDirectoryAnchor(
    state.stagingRoot,
    "Migration staging root",
    "CONCURRENT_CHANGE",
  );
  if (!isStrictlyInside(state.storeAnchors.changes.physicalPath, staging.physicalPath)) {
    throw migrationError(
      `Migration staging root escapes the captured Change store: ${state.stagingRoot}`,
      "UNSAFE_ARTIFACT_PATH",
    );
  }
  state.storeAnchors.staging = staging;
  state.stagingIdentity = { dev: staging.dev, ino: staging.ino };
  if (afterTransactionStagingRootCreate) {
    await afterTransactionStagingRootCreate({
      state,
      reservationPath,
      bindingPath,
      stagingRoot: state.stagingRoot,
    });
  }

  await assertTransactionStoreAnchors(state);
  await mkdir(state.journalWriteCleanupPath, { mode: 0o700 });
  const cleanupRootState = await pathState(state.journalWriteCleanupPath);
  if (!cleanupRootState?.isDirectory()
    || cleanupRootState.isSymbolicLink()
    || (cleanupRootState.mode & 0o077) !== 0
    || !(await isPathPhysicallyInside(state.stagingRoot, state.journalWriteCleanupPath))) {
    throw migrationError(
      `Transaction journal cleanup reservation is invalid: ${state.journalWriteCleanupPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  state.journalWriteCleanupIdentity = fileIdentity(cleanupRootState);
  await syncDirectory(state.stagingRoot);
  if (afterTransactionStagingReservation) {
    await afterTransactionStagingReservation({
      state,
      reservationPath,
      bindingPath,
      stagingRoot: state.stagingRoot,
    });
  }
}
function initializationEvidenceCleanupPath(path) {
  return `${path}.cleanup`;
}

async function readInitializationEvidenceFile(
  path,
  expectedIdentity,
  label,
  { allowMissing = false } = {},
) {
  const cleanupPath = initializationEvidenceCleanupPath(path);
  const records = [];
  for (const candidate of [path, cleanupPath]) {
    const state = await pathState(candidate);
    if (!state) continue;
    if (!state.isFile()
      || state.isSymbolicLink()
      || expectedIdentity === null
      || !sameFileIdentity(fileIdentity(state), expectedIdentity)) {
      throw migrationError(`${label} changed physical identity: ${candidate}`, "CONCURRENT_CHANGE");
    }
    const source = await readFile(candidate, "utf8").catch(() => null);
    if (source === null) {
      throw migrationError(`${label} bytes are unavailable: ${candidate}`, "CONCURRENT_CHANGE");
    }
    records.push({ path: candidate, state, source });
  }
  if (records.length === 0 && !allowMissing) {
    throw migrationError(`${label} is missing: ${path}`, "CONCURRENT_CHANGE");
  }
  if (records.length === 2 && records[0].source !== records[1].source) {
    throw migrationError(`${label} cleanup copies do not match.`, "CONCURRENT_CHANGE");
  }
  return records[0] ?? null;
}

async function assertInitializationEvidence(state, { allowMissing = false } = {}) {
  const authority = await assertInitializationAuthority(
    state,
    state.initializationReservationIdentity,
  );
  const reservation = await readInitializationEvidenceFile(
    state.initializationReservationPath,
    state.initializationReservationIdentity,
    "Migration initialization reservation",
    { allowMissing },
  );
  if (reservation
    && (reservation.source !== authority.source
      || sourceHash(reservation.source) !== authority.hash)) {
    throw migrationError(
      "Migration initialization reservation is not bound to workspace configuration authority.",
      "CONCURRENT_CHANGE",
    );
  }
  const binding = await readInitializationEvidenceFile(
    state.initializationBindingPath,
    state.initializationBindingIdentity,
    "Migration initialization binding",
    { allowMissing },
  );
  if (binding) {
    let value;
    try {
      value = JSON.parse(binding.source);
    } catch (error) {
      throw migrationError(
        `Cannot read migration initialization binding: ${state.initializationBindingPath}`,
        "CONCURRENT_CHANGE",
        [error.message],
      );
    }
    requireExactJournalKeys(
      value,
      [
        "version",
        "stagingRoot",
        "destinationWorkspaceRoot",
        "ownerIdentity",
        "reservationIdentity",
        "stagingPhase",
        "stagingIdentity",
        "changesIdentity",
        "authorityPath",
        "authorityIdentity",
        "authorityHash",
        "authorityMode",
        "authorityOwnerAnchor",
      ],
      "migration initialization binding",
      state.journalPath,
    );
    requireJournalIdentity(
      value.ownerIdentity,
      "migration initialization binding ownerIdentity",
      state.journalPath,
    );
    requireJournalIdentity(
      value.reservationIdentity,
      "migration initialization binding reservationIdentity",
      state.journalPath,
    );
    requireJournalIdentity(
      value.stagingIdentity,
      "migration initialization binding stagingIdentity",
      state.journalPath,
      { nullable: true },
    );
    requireJournalIdentity(
      value.changesIdentity,
      "migration initialization binding changesIdentity",
      state.journalPath,
    );
    requireJournalIdentity(
      value.authorityIdentity,
      "migration initialization binding authorityIdentity",
      state.journalPath,
    );
    requireJournalAnchor(
      value.authorityOwnerAnchor,
      "migration initialization binding authorityOwnerAnchor",
      state.journalPath,
    );
    const stagingState = await pathState(state.stagingRoot);
    if (value.version !== 1
      || resolve(value.stagingRoot) !== resolve(state.stagingRoot)
      || resolve(value.destinationWorkspaceRoot) !== resolve(state.destinationWorkspaceRoot)
      || !sameFileIdentity(value.ownerIdentity, state.initializationBindingIdentity)
      || !sameFileIdentity(value.ownerIdentity, fileIdentity(binding.state))
      || !sameFileIdentity(
        value.reservationIdentity,
        state.initializationReservationIdentity,
      )
      || resolve(value.authorityPath) !== resolve(authority.path)
      || !sameFileIdentity(value.authorityIdentity, authority.identity)
      || value.authorityHash !== authority.hash
      || value.authorityMode !== authority.mode
      || value.authorityOwnerAnchor?.logicalPath !== authority.ownerAnchor.logicalPath
      || value.authorityOwnerAnchor?.physicalPath !== authority.ownerAnchor.physicalPath
      || !sameFileIdentity(value.authorityOwnerAnchor, authority.ownerAnchor)
      || value.stagingPhase !== "pending"
      || value.stagingIdentity !== null
      || !sameFileIdentity(value.changesIdentity, {
        dev: state.storeAnchors.changes.dev,
        ino: state.storeAnchors.changes.ino,
      })
      || !stagingState?.isDirectory()
      || stagingState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(stagingState), state.stagingIdentity)) {
      throw migrationError(
        "Migration initialization binding does not match its staging owner.",
        "CONCURRENT_CHANGE",
      );
    }
  }
  return { authority, reservation, binding };
}

async function releaseInitializationEvidence(
  state,
  afterTransactionInitializationEvidenceRelease = null,
) {
  if (state.initializationPhase === "released") return;
  if (state.destinationManifestPhase !== "present"
    || state.destinationManifestDigestPhase !== "present"
    || state.destinationManifestWitnessPhase !== "present") {
    throw migrationError(
      "Migration initialization evidence cannot be released before destination authentication.",
      "CONCURRENT_CHANGE",
    );
  }
  if (state.initializationPhase === "journaled") {
    await assertInitializationEvidence(state);
    state.initializationPhase = "releasing";
    await persistTransaction(state);
  }
  if (state.initializationPhase !== "releasing") {
    throw migrationError("Migration initialization phase is unsupported.", "CONCURRENT_CHANGE");
  }
  const evidence = await assertInitializationEvidence(state, { allowMissing: true });
  const configRoot = state.storeAnchors.config.logicalPath;
  if (evidence.binding) {
    await removeProvenFile(state.initializationBindingPath, {
      expectedIdentity: state.initializationBindingIdentity,
      expectedHash: sourceHash(evidence.binding.source),
      quarantineParent: configRoot,
      quarantinePath: initializationEvidenceCleanupPath(state.initializationBindingPath),
      label: "Migration initialization binding",
      assertBoundary: () => assertTransactionStoreAnchors(state),
    });
  }
  if (evidence.reservation) {
    await removeProvenFile(state.initializationReservationPath, {
      expectedIdentity: state.initializationReservationIdentity,
      expectedHash: evidence.authority.hash,
      quarantineParent: configRoot,
      quarantinePath: initializationEvidenceCleanupPath(state.initializationReservationPath),
      label: "Migration initialization reservation",
      assertBoundary: () => assertTransactionStoreAnchors(state),
    });
  }
  for (const path of [
    state.initializationBindingPath,
    initializationEvidenceCleanupPath(state.initializationBindingPath),
    state.initializationReservationPath,
    initializationEvidenceCleanupPath(state.initializationReservationPath),
  ]) {
    if (await pathState(path)) {
      throw migrationError(`Migration initialization evidence survived cleanup: ${path}`, "CONCURRENT_CHANGE");
    }
  }
  if (afterTransactionInitializationEvidenceRelease) {
    await afterTransactionInitializationEvidenceRelease({
      state,
      reservationPath: state.initializationReservationPath,
      bindingPath: state.initializationBindingPath,
    });
  }
  state.initializationBindingIdentity = null;
  state.initializationReservationIdentity = null;
  state.initializationPhase = "released";
  await persistTransaction(state);
}


function destinationGuardProofPath(stagingRoot, index) {
  return join(stagingRoot, `.destination-${index}-guard`);
}

function configProofPath(stagingRoot, path, index, kind) {
  return join(
    dirname(path),
    `.${basename(path)}${basename(stagingRoot)}-config-${index}-${kind}`,
  );
}


async function readFileHandleSnapshot(handle, expectedIdentity, label) {
  const before = await handle.stat();
  if (!before.isFile()
    || !sameFileIdentity(fileIdentity(before), expectedIdentity)
    || !Number.isSafeInteger(before.size)
    || before.size < 0) {
    throw migrationError(`${label} changed physical identity.`, "CONCURRENT_CHANGE");
  }
  const source = Buffer.allocUnsafe(before.size);
  let offset = 0;
  while (offset < source.length) {
    const { bytesRead } = await handle.read(source, offset, source.length - offset, offset);
    if (bytesRead === 0) {
      throw migrationError(`${label} changed while its bytes were read.`, "CONCURRENT_CHANGE");
    }
    offset += bytesRead;
  }
  const after = await handle.stat();
  if (!after.isFile()
    || !sameFileIdentity(fileIdentity(after), expectedIdentity)
    || after.size !== before.size) {
    throw migrationError(`${label} changed while its bytes were read.`, "CONCURRENT_CHANGE");
  }
  return source;
}

async function assertRegularFileIdentity(path, expectedIdentity, label, expectedMode = null) {
  const state = await pathState(path);
  if (!state?.isFile()
    || state.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(state), expectedIdentity)
    || (expectedMode !== null && (state.mode & 0o777) !== expectedMode)) {
    throw migrationError(`${label} changed physical identity or mode: ${path}`, "CONCURRENT_CHANGE");
  }
  return state;
}

async function quarantineOwnedTransferOutput(
  source,
  target,
  expectedIdentity,
  label,
  expectedMode,
  beforeMutation,
) {
  const state = await pathState(target);
  if (!state?.isFile()
    || state.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(state), expectedIdentity)) return false;
  if (beforeMutation) await beforeMutation({ source, target, phase: "cleanup" });
  const expectedHash = await hashFile(target).catch(() => null);
  if (expectedHash === null) return false;
  return removeProvenFile(target, {
    expectedIdentity,
    expectedHash,
    expectedMode,
    quarantineParent: dirname(target),
    label: `${label} failed output`,
    assertBoundary: beforeMutation
      ? async () => {
        await beforeMutation({ source, target, phase: "cleanup" });
        return true;
      }
      : null,
  });
}

async function transferRegularFileWithoutReplace(
  source,
  target,
  {
    expectedHash = null,
    expectedSourceIdentity = null,
    expectedMode = null,
    label = "Migration file transfer",
    beforeMutation = null,
    linkFile = link,
    ownedTargetIdentity: expectedTargetIdentity = null,
    afterTargetCreate = null,
    afterTargetExposure = null,
    afterTargetWrite = null,
  } = {},
) {
  let sourceHandle = null;
  let targetHandle = null;
  let ownedTargetIdentity = null;
  let result = null;
  let targetOwnershipPersisted = false;
  let sourceMode = null;
  let failure = null;
  try {
    const sourcePathState = await pathState(source);
    if (!sourcePathState?.isFile() || sourcePathState.isSymbolicLink()) {
      throw migrationError(`${label} source is not a real file: ${source}`, "CONCURRENT_CHANGE");
    }
    const sourceIdentity = fileIdentity(sourcePathState);
    sourceMode = expectedMode ?? (sourcePathState.mode & 0o777);
    if ((sourcePathState.mode & 0o777) !== sourceMode
      || (expectedSourceIdentity
        && !sameFileIdentity(sourceIdentity, expectedSourceIdentity))) {
      throw migrationError(`${label} source changed physical identity or mode: ${source}`, "CONCURRENT_CHANGE");
    }
    sourceHandle = await open(source, "r");
    const sourceHandleState = await sourceHandle.stat();
    if (!sourceHandleState.isFile()
      || !sameFileIdentity(fileIdentity(sourceHandleState), sourceIdentity)
      || (sourceHandleState.mode & 0o777) !== sourceMode) {
      throw migrationError(`${label} source changed while it was opened: ${source}`, "CONCURRENT_CHANGE");
    }
    const sourceBytes = await readFileHandleSnapshot(sourceHandle, sourceIdentity, `${label} source`);
    const authenticatedHash = sourceHash(sourceBytes);
    await assertRegularFileIdentity(source, sourceIdentity, `${label} source`, sourceMode);
    if (expectedHash !== null && authenticatedHash !== expectedHash) {
      throw migrationError(`${label} source bytes changed: ${source}`, "CONCURRENT_CHANGE");
    }

    if (beforeMutation) await beforeMutation({ source, target, phase: "publish" });
    const sourceBeforePublication = await readFileHandleSnapshot(
      sourceHandle,
      sourceIdentity,
      `${label} source`,
    );
    if (!sourceBeforePublication.equals(sourceBytes)) {
      throw migrationError(`${label} source bytes changed before publication: ${source}`, "CONCURRENT_CHANGE");
    }
    await assertRegularFileIdentity(source, sourceIdentity, `${label} source`, sourceMode);

    let method = "link";
    if (expectedTargetIdentity !== null) {
      method = "resume-copy";
      await assertRegularFileIdentity(target, expectedTargetIdentity, `${label} destination`, sourceMode);
      ownedTargetIdentity = expectedTargetIdentity;
      targetHandle = await open(target, "r+");
      targetOwnershipPersisted = true;
      const existingHandleState = await targetHandle.stat();
      if (!existingHandleState.isFile()
        || !sameFileIdentity(fileIdentity(existingHandleState), ownedTargetIdentity)
        || (existingHandleState.mode & 0o777) !== sourceMode) {
        throw migrationError(`${label} destination changed while it was reopened: ${target}`, "CONCURRENT_CHANGE");
      }
      await targetHandle.truncate(0);
    } else {
      try {
        await linkFile(source, target);
      } catch (error) {
        if (error?.code !== "EXDEV") throw error;
        method = "copy";
        const sourceBeforeCopy = await readFileHandleSnapshot(
          sourceHandle,
          sourceIdentity,
          `${label} source`,
        );
        if (!sourceBeforeCopy.equals(sourceBytes)) {
          throw migrationError(
            `${label} source bytes changed before cross-filesystem copy: ${source}`,
            "CONCURRENT_CHANGE",
          );
        }
        await assertRegularFileIdentity(source, sourceIdentity, `${label} source`, sourceMode);
        if (beforeMutation) {
          await beforeMutation({ source, target, phase: "copy" });
        }
        targetHandle = await open(target, "wx+", sourceMode);
        await targetHandle.chmod(sourceMode);
        const createdState = await targetHandle.stat();
        if (!createdState.isFile() || (createdState.mode & 0o777) !== sourceMode) {
          throw migrationError(`${label} destination is not a real file with the expected mode: ${target}`, "CONCURRENT_CHANGE");
        }
        ownedTargetIdentity = fileIdentity(createdState);
        await assertRegularFileIdentity(target, ownedTargetIdentity, `${label} destination`, sourceMode);
        await syncDirectory(dirname(target));
        if (afterTargetExposure) {
          targetOwnershipPersisted = true;
          await afterTargetExposure({
            source,
            target,
            identity: ownedTargetIdentity,
            hash: sourceHash(Buffer.alloc(0)),
            method,
          });
        }
        if (afterTargetCreate) {
          targetOwnershipPersisted = true;
          await afterTargetCreate({
            source,
            target,
            identity: ownedTargetIdentity,
            hash: sourceHash(Buffer.alloc(0)),
            method,
          });
        }
      }
    }
    if (method === "copy" || method === "resume-copy") {
      await targetHandle.writeFile(sourceBytes);
      await targetHandle.sync();
    }

    if (method === "link") {
      const linkedState = await pathState(target);
      if (!linkedState?.isFile()
        || linkedState.isSymbolicLink()
        || !sameFileIdentity(fileIdentity(linkedState), sourceIdentity)
        || (linkedState.mode & 0o777) !== sourceMode) {
        throw migrationError(`${label} destination changed during hardlink publication: ${target}`, "CONCURRENT_CHANGE");
      }
      ownedTargetIdentity = fileIdentity(linkedState);
      targetHandle = await open(target, "r");
      const linkedHandleState = await targetHandle.stat();
      if (!linkedHandleState.isFile()
        || !sameFileIdentity(fileIdentity(linkedHandleState), ownedTargetIdentity)
        || (linkedHandleState.mode & 0o777) !== sourceMode) {
        throw migrationError(`${label} destination changed while it was opened: ${target}`, "CONCURRENT_CHANGE");
      }
      await syncDirectory(dirname(target));
      if (afterTargetExposure) {
        targetOwnershipPersisted = true;
        await afterTargetExposure({
          source,
          target,
          identity: ownedTargetIdentity,
          hash: authenticatedHash,
          method,
        });
      }
    }

    if (beforeMutation) await beforeMutation({ source, target, phase: "verify" });
    await syncDirectory(dirname(target));
    if (beforeMutation) await beforeMutation({ source, target, phase: "durable" });
    const targetBytes = await readFileHandleSnapshot(
      targetHandle,
      ownedTargetIdentity,
      `${label} destination`,
    );
    if (!targetBytes.equals(sourceBytes)) {
      throw migrationError(`${label} destination bytes do not match its source: ${target}`, "CONCURRENT_CHANGE");
    }
    await assertRegularFileIdentity(target, ownedTargetIdentity, `${label} destination`, sourceMode);
    if (afterTargetWrite) {
      targetOwnershipPersisted = true;
      await afterTargetWrite({
        source,
        target,
        identity: ownedTargetIdentity,
        hash: authenticatedHash,
        method,
      });
    }
    const sourceAfterPublication = await readFileHandleSnapshot(
      sourceHandle,
      sourceIdentity,
      `${label} source`,
    );
    if (!sourceAfterPublication.equals(sourceBytes)) {
      throw migrationError(`${label} source bytes changed after publication: ${source}`, "CONCURRENT_CHANGE");
    }
    await assertRegularFileIdentity(source, sourceIdentity, `${label} source`, sourceMode);
    result = {
      identity: ownedTargetIdentity,
      sourceIdentity,
      hash: authenticatedHash,
      mode: sourceMode,
      method,
    };
  } catch (error) {
    failure = error;
  }

  for (const handle of [targetHandle, sourceHandle]) {
    if (!handle) continue;
    try {
      await handle.close();
    } catch (error) {
      failure ??= error;
    }
  }

  if (failure) {
    if (ownedTargetIdentity && !targetOwnershipPersisted) {
      try {
        await quarantineOwnedTransferOutput(
          source,
          target,
          ownedTargetIdentity,
          label,
          sourceMode,
          beforeMutation,
        );
      } catch (cleanupError) {
        if (cleanupError instanceof SddError) {
          cleanupError.details = [
            `Original transfer failure: ${failure.message}`,
            ...(cleanupError.details ?? []),
          ];
          throw cleanupError;
        }
        throw migrationError(
          `${label} failed and its owned output could not be quarantined: ${target}`,
          "CONCURRENT_CHANGE",
          [failure.message, cleanupError.message],
        );
      }
    }
    if (failure instanceof SddError) throw failure;
    throw migrationError(
      `${label} could not be published without replacement: ${target}`,
      "CONCURRENT_CHANGE",
      [failure.message],
    );
  }
  return result;
}


async function createFileIdentityProof(
  source,
  proof,
  expectedHash,
  label,
  beforeLink = null,
  linkFile = link,
  afterExposure = null,
) {
  const sourceState = await pathState(source);
  if (!sourceState?.isFile() || sourceState.isSymbolicLink()
    || await hashFile(source).catch(() => null) !== expectedHash) {
    throw migrationError(`${label} source changed before proof creation: ${source}`, "CONCURRENT_CHANGE");
  }
  const result = await transferRegularFileWithoutReplace(source, proof, {
    expectedHash,
    expectedSourceIdentity: fileIdentity(sourceState),
    label: `${label} identity proof`,
    beforeMutation: beforeLink ? () => beforeLink() : null,
    linkFile,
    afterTargetExposure: afterExposure,
  });
  return result.identity;
}

async function destinationGuardTasksIdentity(guard, destinationWorkspaceRoot) {
  await assertChangeStoreConfinement(guard.destination, destinationWorkspaceRoot);
  const tasksPath = join(guard.destination, "tasks.md");
  const [destinationState, tasksState] = await Promise.all([
    pathState(guard.destination),
    pathState(tasksPath),
  ]);
  if (!destinationState?.isDirectory() || destinationState.isSymbolicLink()
    || !tasksState?.isFile() || tasksState.isSymbolicLink()
    || await hashDirectory(guard.destination).catch(() => null) !== guard.canonicalHash) {
    throw migrationError(
      `Central Change changed before transaction ownership was recorded: ${guard.destination}`,
      "CONCURRENT_CHANGE",
    );
  }
  const [reboundDestinationState, reboundTasksState] = await Promise.all([
    pathState(guard.destination),
    pathState(tasksPath),
  ]);
  if (!reboundDestinationState?.isDirectory() || reboundDestinationState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(reboundDestinationState), fileIdentity(destinationState))
    || !reboundTasksState?.isFile() || reboundTasksState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(reboundTasksState), fileIdentity(tasksState))) {
    throw migrationError(
      `Central Change changed while transaction ownership was recorded: ${guard.destination}`,
      "CONCURRENT_CHANGE",
    );
  }
  return fileIdentity(reboundTasksState);
}

async function assertDestinationGuard(guard, destinationWorkspaceRoot) {
  const tasksIdentity = await destinationGuardTasksIdentity(guard, destinationWorkspaceRoot);
  const proofState = await pathState(guard.proofPath);
  if (!proofState?.isFile() || proofState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(proofState), tasksIdentity)
    || (guard.proofIdentity != null
      && !sameFileIdentity(fileIdentity(proofState), guard.proofIdentity))) {
    throw migrationError(
      `Central Change destination changed after transaction ownership was recorded: ${guard.destination}`,
      "CONCURRENT_CHANGE",
    );
  }
}

async function createDestinationGuardProof(
  guard,
  destinationWorkspaceRoot,
  beforeLink = null,
  afterLink = null,
) {
  if (guard.proofPhase !== "creating" || guard.proofIdentity === null) {
    throw migrationError(
      `Central Change ownership proof has no durable creation intent: ${guard.destination}`,
      "CONCURRENT_CHANGE",
    );
  }
  const tasksPath = join(guard.destination, "tasks.md");
  const tasksIdentity = await destinationGuardTasksIdentity(guard, destinationWorkspaceRoot);
  if (!sameFileIdentity(tasksIdentity, guard.proofIdentity)) {
    throw migrationError(
      `Central Change changed after proof creation was authorized: ${guard.destination}`,
      "CONCURRENT_CHANGE",
    );
  }
  if (beforeLink) await beforeLink();
  const reboundTasksIdentity = await destinationGuardTasksIdentity(
    guard,
    destinationWorkspaceRoot,
  );
  if (!sameFileIdentity(reboundTasksIdentity, guard.proofIdentity)) {
    throw migrationError(
      `Central Change changed immediately before proof creation: ${guard.destination}`,
      "CONCURRENT_CHANGE",
    );
  }
  try {
    await link(tasksPath, guard.proofPath);
  } catch (error) {
    throw migrationError(
      `Central Change ownership proof could not be created exclusively: ${guard.proofPath}`,
      "CONCURRENT_CHANGE",
      [error.message],
    );
  }
  if (afterLink) await afterLink({ guard });
  if (beforeLink) await beforeLink();
  await syncDirectory(dirname(guard.proofPath));
  await assertDestinationGuard(guard, destinationWorkspaceRoot);
}

function changeReservationEvidencePaths(stagingRoot, ownerToken) {
  const prefix = `.change-reservation-${ownerToken}`;
  return {
    intent: join(stagingRoot, `${prefix}.intent.json`),
    binding: join(stagingRoot, `${prefix}.binding.json`),
    lockProof: join(stagingRoot, `${prefix}.mutation-lock`),
  };
}

function stagedChangeIdentityEvidencePrefix(ownerToken) {
  return `.change-staged-identity-${ownerToken}-`;
}

function stagedChangeIdentityEvidencePath(stagingRoot, ownerToken, identity) {
  return join(
    stagingRoot,
    `${stagedChangeIdentityEvidencePrefix(ownerToken)}${identity.dev}-${identity.ino}`,
  );
}

function changeCopyProvenancePrefix(ownerToken) {
  return `.change-copy-provenance-${ownerToken}-`;
}

function changeCopyProvenancePaths(stagingRoot, ownerToken, provenance) {
  const stem = `${changeCopyProvenancePrefix(ownerToken)}${[
    provenance.token,
    provenance.index,
    provenance.type,
    provenance.targetIdentity.dev,
    provenance.targetIdentity.ino,
  ].join("-")}`;
  return {
    owner: join(stagingRoot, `${stem}.owner`),
    target: provenance.type === "file"
      ? join(stagingRoot, `${stem}.target`)
      : null,
  };
}

function changeCopyProvenanceContext(state) {
  return {
    stagingRoot: state.stagingRoot,
    anchorPath: state.destinationManifestPath,
    anchorIdentity: state.destinationManifestWitnessIdentity,
    afterTargetProvenance: state.afterChangeCopyTargetProvenance ?? null,
  };
}

function changeTasksCanonicalizationQuarantinePath(record) {
  return join(
    dirname(record.stagingPath),
    `.change-tasks-canonicalization-${record.ownerToken}`,
  );
}

function changeTasksCanonicalizationProofPath(record) {
  return join(
    dirname(record.stagingPath),
    `.change-tasks-canonical-proof-${record.ownerToken}`,
  );
}

function changeTasksCanonicalizationOwnerProofPath(record) {
  return join(
    dirname(record.stagingPath),
    `.change-tasks-canonical-owner-${record.ownerToken}`,
  );
}

async function createChangeCopyTargetProvenance(
  record,
  sourceEntry,
  index,
  targetPath,
  targetEntry,
  context,
) {
  if (record.copyProvenanceToken === null
    || record.copyTargetProvenance.some((entry) => (
      entry.token === record.copyProvenanceToken && entry.index === index
    ))) {
    throw migrationError(
      `Change copy target provenance is not exclusively reserved: ${targetPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  const provenance = {
    token: record.copyProvenanceToken,
    index,
    relativePath: sourceEntry.relativePath,
    type: sourceEntry.type,
    mode: sourceEntry.mode,
    targetIdentity: targetEntry.identity,
  };
  const paths = changeCopyProvenancePaths(
    context.stagingRoot,
    record.ownerToken,
    provenance,
  );
  const [anchorState, targetState] = await Promise.all([
    pathState(context.anchorPath),
    pathState(targetPath),
  ]);
  if (!anchorState?.isFile()
    || anchorState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(anchorState), context.anchorIdentity)
    || !targetState
    || targetState.isSymbolicLink() !== (targetEntry.type === "symlink")
    || removalEntryType(targetState) !== targetEntry.type
    || (targetState.mode & 0o777) !== sourceEntry.mode
    || targetEntry.mode !== sourceEntry.mode
    || !sameFileIdentity(fileIdentity(targetState), targetEntry.identity)) {
    throw migrationError(
      `Change copy target changed before provenance creation: ${targetPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  try {
    await link(context.anchorPath, paths.owner);
    if (paths.target !== null) await link(targetPath, paths.target);
  } catch (error) {
    throw migrationError(
      `Change copy target provenance could not be created: ${targetPath}`,
      "CONCURRENT_CHANGE",
      [error.message],
    );
  }
  await syncDirectory(context.stagingRoot);
  const [currentAnchor, ownerProof, currentTarget, targetProof] = await Promise.all([
    pathState(context.anchorPath),
    pathState(paths.owner),
    pathState(targetPath),
    paths.target === null ? null : pathState(paths.target),
  ]);
  if (!currentAnchor?.isFile()
    || currentAnchor.isSymbolicLink()
    || !ownerProof?.isFile()
    || ownerProof.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(currentAnchor), context.anchorIdentity)
    || !sameFileIdentity(fileIdentity(ownerProof), context.anchorIdentity)
    || !currentTarget
    || removalEntryType(currentTarget) !== targetEntry.type
    || (currentTarget.mode & 0o777) !== provenance.mode
    || !sameFileIdentity(fileIdentity(currentTarget), targetEntry.identity)
    || (paths.target !== null && (
      !targetProof?.isFile()
      || targetProof.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(targetProof), targetEntry.identity)
    ))) {
    throw migrationError(
      `Change copy target provenance changed during creation: ${targetPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  record.copyTargetProvenance.push(provenance);
  if (context.afterTargetProvenance) {
    await context.afterTargetProvenance({
      record,
      sourceEntry,
      target: targetPath,
      provenance,
    });
  }
  return provenance;
}

async function createStagedChangeIdentityEvidence(state, record) {
  const evidencePath = stagedChangeIdentityEvidencePath(
    state.stagingRoot,
    record.ownerToken,
    record.stagedIdentity,
  );
  try {
    await link(record.proofPath, evidencePath);
  } catch (error) {
    throw migrationError(
      `Staged Change identity evidence could not be reserved: ${evidencePath}`,
      "CONCURRENT_CHANGE",
      [error.message],
    );
  }
  await syncDirectory(state.stagingRoot);
  const [proofState, evidenceState, stagedState] = await Promise.all([
    pathState(record.proofPath),
    pathState(evidencePath),
    pathState(record.stagedPath),
  ]);
  if (!proofState?.isFile()
    || proofState.isSymbolicLink()
    || !evidenceState?.isFile()
    || evidenceState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(proofState), fileIdentity(evidenceState))
    || !stagedState?.isDirectory()
    || stagedState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(stagedState), record.stagedIdentity)) {
    throw migrationError(
      `Staged Change identity evidence is not bound to its directory: ${evidencePath}`,
      "CONCURRENT_CHANGE",
    );
  }
  record.stagedIdentityEvidencePath = evidencePath;
  record.stagedIdentityEvidenceIdentity = fileIdentity(evidenceState);
}

async function hydrateStagedChangeIdentityEvidence(
  record,
  index,
  stagingRoot,
  journalPath,
) {
  const prefix = stagedChangeIdentityEvidencePrefix(record.ownerToken);
  const evidenceNames = (await readdir(stagingRoot))
    .filter((name) => name.startsWith(prefix));
  const canonicalCopyInProgress = record.phase === "publishing"
    && record.copyRoot !== null
    && resolve(record.copyRoot) === resolve(record.stagedPath)
    && resolve(record.copySourceRoot) === resolve(join(record.stagingPath, "payload"));
  const canonicalCopyCompleted = canonicalCopyInProgress && evidenceNames.length === 1;
  const requiresEvidence = canonicalCopyCompleted || (!canonicalCopyInProgress && [
    "publishing",
    "staged",
    "reserved",
    "published",
    "verified",
    "removed",
  ].includes(record.phase));
  if (!requiresEvidence) {
    if (evidenceNames.length !== 0) {
      throw journalFailure(
        journalPath,
        `changes[${index}] has identity evidence before staged ownership was committed.`,
      );
    }
    record.stagedIdentityEvidencePath = null;
    record.stagedIdentityEvidenceIdentity = null;
    return;
  }
  if (evidenceNames.length !== 1) {
    throw journalFailure(
      journalPath,
      `changes[${index}] does not have exactly one external staged-directory identity proof.`,
    );
  }
  const encodedIdentity = evidenceNames[0].slice(prefix.length);
  const match = /^([0-9]+)-([0-9]+)$/.exec(encodedIdentity);
  if (!match) {
    throw journalFailure(
      journalPath,
      `changes[${index}] staged-directory identity proof has an invalid name.`,
    );
  }
  const authenticatedStagedIdentity = { dev: match[1], ino: match[2] };
  if (!sameFileIdentity(authenticatedStagedIdentity, record.stagedIdentity)) {
    throw journalFailure(
      journalPath,
      `changes[${index}].stagedIdentity does not match its external identity proof.`,
    );
  }
  const evidencePath = join(stagingRoot, evidenceNames[0]);
  const [proofState, evidenceState, stagedState, stagedTasksState] = await Promise.all([
    pathState(record.proofPath),
    pathState(evidencePath),
    pathState(record.stagedPath),
    pathState(join(record.stagedPath, "tasks.md")),
  ]);
  if (!proofState?.isFile()
    || proofState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(proofState), record.proofIdentity)
    || !evidenceState?.isFile()
    || evidenceState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(proofState), fileIdentity(evidenceState))
    || !stagedState?.isDirectory()
    || stagedState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(stagedState), authenticatedStagedIdentity)
    || !stagedTasksState?.isFile()
    || stagedTasksState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(stagedTasksState), fileIdentity(proofState))
    || await hashDirectory(record.stagedPath).catch(() => null) !== record.canonicalHash) {
    throw journalFailure(
      journalPath,
      `changes[${index}] staged-directory identity proof is not bound to its canonical tasks proof.`,
    );
  }
  if (canonicalCopyCompleted) {
    record.copyRoot = null;
    record.copySourceRoot = null;
    record.copySourceManifest = null;
    record.copyTargetManifest = null;
    record.copyProvenanceToken = null;
    record.copyIntent = null;
  }
  record.stagedIdentityEvidencePath = evidencePath;
  record.stagedIdentityEvidenceIdentity = fileIdentity(evidenceState);
}

async function hydrateChangeTasksCanonicalization(
  record,
  index,
  journalPath,
  anchorPath,
  anchorIdentity,
) {
  const phase = record.tasksCanonicalizationPhase;
  const tasksPath = join(record.stagingPath, "payload", "tasks.md");
  const quarantinePath = changeTasksCanonicalizationQuarantinePath(record);
  const canonicalProofPath = changeTasksCanonicalizationProofPath(record);
  const ownerProofPath = changeTasksCanonicalizationOwnerProofPath(record);
  const [
    payloadState,
    tasksState,
    quarantineState,
    proofState,
    canonicalProofState,
    ownerProofState,
    anchorState,
  ] = await Promise.all([
    pathState(dirname(tasksPath)),
    pathState(tasksPath),
    pathState(quarantinePath),
    pathState(record.proofPath),
    pathState(canonicalProofPath),
    pathState(ownerProofPath),
    pathState(anchorPath),
  ]);
  const canonicalHash = sourceHash(record.canonicalTasksSource);
  const ownerProofAuthenticated = ownerProofState?.isFile()
    && !ownerProofState.isSymbolicLink()
    && anchorState?.isFile()
    && !anchorState.isSymbolicLink()
    && sameFileIdentity(fileIdentity(anchorState), anchorIdentity)
    && sameFileIdentity(fileIdentity(ownerProofState), anchorIdentity);
  const canonicalSourceAuthenticated = proofState?.isFile()
    && !proofState.isSymbolicLink()
    && await hashFile(record.proofPath).catch(() => null) === canonicalHash;
  let authenticatedCanonicalProofState = canonicalProofState;
  if (phase === "quarantined"
    && ownerProofAuthenticated
    && canonicalSourceAuthenticated
    && !authenticatedCanonicalProofState) {
    try {
      await link(record.proofPath, canonicalProofPath);
      await syncDirectory(dirname(canonicalProofPath));
    } catch (error) {
      throw journalFailure(
        journalPath,
        `changes[${index}] could not complete its canonical tasks identity proof: ${error.message}`,
      );
    }
    authenticatedCanonicalProofState = await pathState(canonicalProofPath);
  }
  const sourceProofAuthenticated = canonicalSourceAuthenticated
    && authenticatedCanonicalProofState?.isFile()
    && !authenticatedCanonicalProofState.isSymbolicLink()
    && sameFileIdentity(
      fileIdentity(proofState),
      fileIdentity(authenticatedCanonicalProofState),
    )
    && ownerProofAuthenticated;

  if (phase === "pending") {
    if (quarantineState || proofState || canonicalProofState || ownerProofState) {
      throw journalFailure(
        journalPath,
        `changes[${index}] has tasks canonicalization evidence before its intent.`,
      );
    }
    return;
  }
  if (phase === "cleaned" && !payloadState) {
    if (quarantineState
      || !sourceProofAuthenticated
      || !sameFileIdentity(fileIdentity(proofState), record.proofIdentity)
      || !sameFileIdentity(fileIdentity(proofState), record.tasksCanonicalizationIdentity)) {
      throw journalFailure(journalPath, `changes[${index}] retired tasks evidence is inconsistent.`);
    }
    return;
  }

  const originalIdentity = record.tasksCanonicalizationOriginalIdentity;
  const originalHash = record.tasksCanonicalizationOriginalHash;
  const quarantineAuthenticated = quarantineState?.isFile()
    && !quarantineState.isSymbolicLink()
    && sameFileIdentity(fileIdentity(quarantineState), originalIdentity)
    && await hashFile(quarantinePath).catch(() => null) === originalHash;
  const tasksAreOriginal = tasksState?.isFile()
    && !tasksState.isSymbolicLink()
    && sameFileIdentity(fileIdentity(tasksState), originalIdentity)
    && await hashFile(tasksPath).catch(() => null) === originalHash;
  const tasksAreCanonical = tasksState?.isFile()
    && !tasksState.isSymbolicLink()
    && sourceProofAuthenticated
    && sameFileIdentity(fileIdentity(tasksState), fileIdentity(proofState));

  if (phase === "prepared") {
    if (!tasksAreOriginal
      || proofState
      || canonicalProofState
      || ownerProofState) {
      throw journalFailure(journalPath, `changes[${index}] lost prepared copied tasks.`);
    }
    if (quarantineState) {
      if (!quarantineAuthenticated) {
        throw journalFailure(journalPath, `changes[${index}] tasks quarantine changed identity.`);
      }
      record.tasksCanonicalizationPhase = "quarantined";
    }
    return;
  }
  if (phase === "quarantined") {
    if (!tasksAreOriginal || !quarantineAuthenticated) {
      throw journalFailure(journalPath, `changes[${index}] quarantined tasks state is incomplete.`);
    }
    if (!ownerProofState && !proofState && !canonicalProofState) return;
    if (!ownerProofAuthenticated) {
      throw journalFailure(journalPath, `changes[${index}] canonical tasks owner proof is incomplete.`);
    }
    if (!proofState && !canonicalProofState) return;
    if (!sourceProofAuthenticated) {
      throw journalFailure(journalPath, `changes[${index}] canonical tasks proof is incomplete.`);
    }
    record.proofIdentity = fileIdentity(proofState);
    record.tasksCanonicalizationIdentity = fileIdentity(proofState);
    record.tasksCanonicalizationPhase = "ready";
    return;
  }
  if (!sourceProofAuthenticated
    || !sameFileIdentity(fileIdentity(proofState), record.proofIdentity)
    || !sameFileIdentity(fileIdentity(proofState), record.tasksCanonicalizationIdentity)) {
    throw journalFailure(journalPath, `changes[${index}] canonical tasks source proof is inconsistent.`);
  }
  if (phase === "ready") {
    if (!tasksAreOriginal || !quarantineAuthenticated) {
      throw journalFailure(journalPath, `changes[${index}] ready tasks state is inconsistent.`);
    }
    return;
  }
  if (phase === "published" && !quarantineState) {
    if (!tasksAreCanonical) {
      throw journalFailure(journalPath, `changes[${index}] cleaned tasks lost their canonical proof.`);
    }
    record.tasksCanonicalizationPhase = "cleaned";
    return;
  }
  if (!quarantineAuthenticated && phase !== "cleaned") {
    throw journalFailure(journalPath, `changes[${index}] lost its authenticated tasks quarantine.`);
  }
  if (phase === "replacing") {
    if (!tasksState || tasksAreOriginal) return;
    if (!tasksAreCanonical) {
      throw journalFailure(
        journalPath,
        `changes[${index}] replacement tasks lack an external identity proof.`,
      );
    }
    record.tasksCanonicalizationPhase = "published";
    return;
  }
  if (!tasksAreCanonical
    || (phase === "published" && !quarantineAuthenticated)
    || (phase === "cleaned" && quarantineState)) {
    throw journalFailure(journalPath, `changes[${index}] canonical tasks evidence is inconsistent.`);
  }
}

async function hydrateChangeProofIdentity(record, index, journalPath) {
  const proofState = await pathState(record.proofPath);
  if (!proofState) {
    if (record.proofIdentity !== null) {
      throw journalFailure(journalPath, `changes[${index}] lost its tasks ownership proof.`);
    }
    return;
  }
  if (!proofState.isFile()
    || proofState.isSymbolicLink()
    || (record.proofIdentity !== null
      && !sameFileIdentity(fileIdentity(proofState), record.proofIdentity))) {
    throw journalFailure(journalPath, `changes[${index}] tasks ownership proof changed identity.`);
  }
  const payloadPath = join(record.stagingPath, "payload");
  const payloadTasksPath = join(payloadPath, "tasks.md");
  const stagedTasksPath = join(record.stagedPath, "tasks.md");
  const canonicalProofPath = changeTasksCanonicalizationProofPath(record);
  const [
    payloadState,
    payloadTasksState,
    stagedState,
    stagedTasksState,
    canonicalProofState,
  ] = await Promise.all([
    pathState(payloadPath),
    pathState(payloadTasksPath),
    pathState(record.stagedPath),
    pathState(stagedTasksPath),
    pathState(canonicalProofPath),
  ]);
  const proofIdentity = fileIdentity(proofState);
  const canonicalizingPayload = record.tasksCanonicalizationPhase === "published"
    && payloadTasksState?.isFile()
    && !payloadTasksState.isSymbolicLink()
    && sameFileIdentity(
      fileIdentity(payloadTasksState),
      record.tasksCanonicalizationIdentity,
    )
    && sameFileIdentity(fileIdentity(payloadTasksState), proofIdentity);
  const payloadOwnsProof = payloadState?.isDirectory()
    && !payloadState.isSymbolicLink()
    && payloadTasksState?.isFile()
    && !payloadTasksState.isSymbolicLink()
    && sameFileIdentity(fileIdentity(payloadTasksState), proofIdentity)
    && (canonicalizingPayload
      || await hashDirectory(payloadPath).catch(() => null) === record.canonicalHash);
  const stagedOwnsProof = stagedState?.isDirectory()
    && !stagedState.isSymbolicLink()
    && stagedTasksState?.isFile()
    && !stagedTasksState.isSymbolicLink()
    && sameFileIdentity(fileIdentity(stagedTasksState), proofIdentity)
    && await hashDirectory(record.stagedPath).catch(() => null) === record.canonicalHash;
  const canonicalSourceOwnsProof = ["ready", "replacing"].includes(
    record.tasksCanonicalizationPhase,
  )
    && canonicalProofState?.isFile()
    && !canonicalProofState.isSymbolicLink()
    && sameFileIdentity(fileIdentity(canonicalProofState), proofIdentity)
    && await hashFile(record.proofPath).catch(() => null)
      === sourceHash(record.canonicalTasksSource);
  if (!payloadOwnsProof && !stagedOwnsProof && !canonicalSourceOwnsProof) {
    throw journalFailure(
      journalPath,
      `changes[${index}] tasks ownership proof is not bound to a canonical staged tree.`,
    );
  }
  record.proofIdentity = proofIdentity;
}

async function hydrateChangeReservationEvidenceIdentities(
  record,
  index,
  stagingRoot,
  journalPath,
) {
  const paths = changeReservationEvidencePaths(stagingRoot, record.ownerToken);
  const [intentState, bindingState, lockProofState] = await Promise.all([
    pathState(paths.intent),
    pathState(paths.binding),
    pathState(paths.lockProof),
  ]);
  if (!intentState) {
    if (record.reservationIntentIdentity !== null
      || bindingState
      || lockProofState
      || record.reservationBindingIdentity !== null
      || record.reservationLockProofIdentity !== null) {
      throw journalFailure(
        journalPath,
        `changes[${index}] has reservation evidence without an authenticated intent.`,
      );
    }
    return;
  }
  const { evidence: intent, state: authenticatedIntentState } = await readChangeReservationEvidence(
    { journalPath },
    paths.intent,
    `changes[${index}] reservation intent`,
  );
  requireExactJournalKeys(
    intent,
    [
      "version",
      "target",
      "ownerToken",
      "ownerIdentity",
      "parentIdentity",
      "proofIdentity",
      "expectedCreation",
      "mutationLock",
    ],
    `changes[${index}] reservation intent`,
    journalPath,
  );
  requireJournalIdentity(intent.parentIdentity, `changes[${index}] reservation parent`, journalPath);
  requireJournalIdentity(intent.proofIdentity, `changes[${index}] reservation proof`, journalPath);
  const [parentState, proofState] = await Promise.all([
    pathState(dirname(record.destination)),
    pathState(record.proofPath),
  ]);
  if (intent.version !== 1
    || intent.target !== resolve(record.destination)
    || intent.ownerToken !== record.ownerToken
    || !parentState?.isDirectory()
    || parentState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(parentState), intent.parentIdentity)
    || !proofState?.isFile()
    || proofState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(proofState), intent.proofIdentity)
    || (record.reservationIntentIdentity !== null
      && !sameFileIdentity(record.reservationIntentIdentity, fileIdentity(authenticatedIntentState)))) {
    throw journalFailure(journalPath, `changes[${index}] reservation intent is not bound to its pre-state.`);
  }
  record.reservationIntentIdentity = fileIdentity(authenticatedIntentState);

  if (intent.mutationLock === null) {
    if (lockProofState || record.reservationLockProofIdentity !== null) {
      throw journalFailure(journalPath, `changes[${index}] has an unbound mutation-lock proof.`);
    }
  } else {
    requireExactJournalKeys(
      intent.mutationLock,
      ["path", "identity", "source", "proofPath", "proofIdentity"],
      `changes[${index}] reservation mutation lock`,
      journalPath,
    );
    requireJournalIdentity(
      intent.mutationLock.identity,
      `changes[${index}] reservation mutation lock identity`,
      journalPath,
    );
    requireJournalIdentity(
      intent.mutationLock.proofIdentity,
      `changes[${index}] reservation mutation lock proof identity`,
      journalPath,
    );
    const lockProofSource = await readFile(paths.lockProof, "utf8").catch(() => null);
    if (!lockProofState?.isFile()
      || lockProofState.isSymbolicLink()
      || resolve(intent.mutationLock.proofPath) !== resolve(paths.lockProof)
      || typeof intent.mutationLock.source !== "string"
      || lockProofSource !== intent.mutationLock.source
      || !sameFileIdentity(fileIdentity(lockProofState), intent.mutationLock.identity)
      || !sameFileIdentity(fileIdentity(lockProofState), intent.mutationLock.proofIdentity)
      || (record.reservationLockProofIdentity !== null
        && !sameFileIdentity(record.reservationLockProofIdentity, fileIdentity(lockProofState)))) {
      throw journalFailure(journalPath, `changes[${index}] mutation-lock proof is not identity-bound.`);
    }
    record.reservationLockProofIdentity = fileIdentity(lockProofState);
  }

  if (!bindingState) {
    if (record.reservationBindingIdentity !== null) {
      throw journalFailure(journalPath, `changes[${index}] lost its reservation binding.`);
    }
    return;
  }
  const { evidence: binding, state: authenticatedBindingState } = await readChangeReservationEvidence(
    { journalPath },
    paths.binding,
    `changes[${index}] reservation binding`,
  );
  requireExactJournalKeys(
    binding,
    [
      "version",
      "target",
      "ownerToken",
      "ownerIdentity",
      "intentIdentity",
      "targetIdentity",
      "targetCreation",
    ],
    `changes[${index}] reservation binding`,
    journalPath,
  );
  requireJournalIdentity(binding.intentIdentity, `changes[${index}] binding intent`, journalPath);
  requireJournalIdentity(binding.targetIdentity, `changes[${index}] binding target`, journalPath);
  const destinationState = await pathState(record.destination);
  const resumableRemoval = record.removalManifest !== null
    && record.removalMode === "staging"
    && resolve(record.removalRoot) === resolve(record.destination)
    && sameFileIdentity(record.removalManifest[0]?.identity, binding.targetIdentity);
  if (binding.version !== 1
    || binding.target !== resolve(record.destination)
    || binding.ownerToken !== record.ownerToken
    || !sameFileIdentity(binding.intentIdentity, record.reservationIntentIdentity)
    || (record.reservationIdentity !== null
      && !sameFileIdentity(binding.targetIdentity, record.reservationIdentity))
    || (destinationState && (
      !destinationState.isDirectory()
      || destinationState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(destinationState), binding.targetIdentity)
      || (!resumableRemoval
        && JSON.stringify(binding.targetCreation)
          !== JSON.stringify(reservationCreationState(destinationState)))
    ))
    || (record.reservationBindingIdentity !== null
      && !sameFileIdentity(
        record.reservationBindingIdentity,
        fileIdentity(authenticatedBindingState),
      ))) {
    throw journalFailure(journalPath, `changes[${index}] reservation binding is not target-bound.`);
  }
  record.reservationBindingIdentity = fileIdentity(authenticatedBindingState);
}

function reservationCreationState(state) {
  return {
    mode: String(state.mode & 0o777),
    uid: String(state.uid),
    gid: String(state.gid),
    nlink: String(state.nlink),
    birthtimeMs: String(state.birthtimeMs),
  };
}

async function syncDirectory(path) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeDurableEvidenceExclusive(path, createValue) {
  let handle;
  try {
    handle = await open(path, "wx", 0o400);
  } catch (error) {
    throw migrationError(
      `Migration reservation evidence already exists: ${path}`,
      "CONCURRENT_CHANGE",
      [error.message],
    );
  }
  let value;
  try {
    const state = await handle.stat();
    value = createValue(fileIdentity(state));
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(dirname(path));
  return value;
}

async function observeMutationLock(lock) {
  if (!lock?.path || !lock?.source || !lock?.identity) return null;
  const before = await pathState(lock.path);
  if (!before?.isFile() || before.isSymbolicLink()) return null;
  const source = await readFile(lock.path, "utf8").catch(() => null);
  const after = await pathState(lock.path);
  if (source !== lock.source
    || !after?.isFile()
    || after.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(before), lock.identity)
    || !sameFileIdentity(fileIdentity(after), lock.identity)) {
    return null;
  }
  return { state: after, source };
}

async function createChangeReservationIntent(state, record, requestedMode) {
  const paths = changeReservationEvidencePaths(state.stagingRoot, record.ownerToken);
  const parent = dirname(record.destination);
  const [parentState, proofState] = await Promise.all([
    pathState(parent),
    pathState(record.proofPath),
  ]);
  if (!parentState?.isDirectory() || parentState.isSymbolicLink()
    || !proofState?.isFile() || proofState.isSymbolicLink()
    || await pathState(record.destination)) {
    throw migrationError(
      `Central Change reservation pre-state changed: ${record.destination}`,
      "CONCURRENT_CHANGE",
    );
  }

  let mutationLock = null;
  if (state.mutationLock !== null) {
    const observedLock = await observeMutationLock(state.mutationLock);
    if (!observedLock) {
      throw migrationError(
        `Update mutation lock changed before Change reservation: ${state.mutationLock.path}`,
        "CONCURRENT_CHANGE",
      );
    }
    try {
      await link(state.mutationLock.path, paths.lockProof);
    } catch (error) {
      throw migrationError(
        `Update mutation lock proof could not be created: ${paths.lockProof}`,
        "CONCURRENT_CHANGE",
        [error.message],
      );
    }
    const lockProofState = await pathState(paths.lockProof);
    const lockProofSource = await readFile(paths.lockProof, "utf8").catch(() => null);
    if (!lockProofState?.isFile() || lockProofState.isSymbolicLink()
      || lockProofSource !== state.mutationLock.source
      || !sameFileIdentity(fileIdentity(lockProofState), state.mutationLock.identity)) {
      throw migrationError(
        `Update mutation lock proof changed during Change reservation: ${paths.lockProof}`,
        "CONCURRENT_CHANGE",
      );
    }
    mutationLock = {
      path: resolve(state.mutationLock.path),
      identity: state.mutationLock.identity,
      source: state.mutationLock.source,
      proofPath: paths.lockProof,
      proofIdentity: fileIdentity(lockProofState),
    };
    record.reservationLockProofIdentity = mutationLock.proofIdentity;
  }

  const expectedMode = requestedMode & ~process.umask() & 0o777;
  const intent = await writeDurableEvidenceExclusive(paths.intent, (ownerIdentity) => ({
    version: 1,
    target: resolve(record.destination),
    ownerToken: record.ownerToken,
    ownerIdentity,
    parentIdentity: fileIdentity(parentState),
    proofIdentity: fileIdentity(proofState),
    expectedCreation: {
      mode: String(expectedMode),
      uid: String(typeof process.getuid === "function" ? process.getuid() : parentState.uid),
      gid: String(typeof process.getgid === "function" ? process.getgid() : parentState.gid),
      nlink: "2",
    },
    mutationLock,
  }));
  record.reservationIntentIdentity = intent.ownerIdentity;
  return paths;
}

async function bindChangeReservation(state, record, reservationState) {
  const paths = changeReservationEvidencePaths(state.stagingRoot, record.ownerToken);
  const binding = await writeDurableEvidenceExclusive(paths.binding, (ownerIdentity) => ({
    version: 1,
    target: resolve(record.destination),
    ownerToken: record.ownerToken,
    ownerIdentity,
    intentIdentity: record.reservationIntentIdentity,
    targetIdentity: fileIdentity(reservationState),
    targetCreation: reservationCreationState(reservationState),
  }));
  record.reservationBindingIdentity = binding.ownerIdentity;
  record.reservationIdentity = binding.targetIdentity;
  record.reserved = true;
}

async function assertChangeStagingReservation(state, record) {
  await assertTransactionStoreAnchors(state);
  const reservationState = await pathState(record.stagingPath);
  if (!reservationState?.isDirectory()
    || reservationState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(reservationState), record.stagingIdentity)
    || !(await isPathPhysicallyInside(state.stagingRoot, record.stagingPath))) {
    throw migrationError(
      `Staged Change copy reservation changed: ${record.stagingPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  return reservationState;
}

async function stageChangeDirectory(
  state,
  record,
  {
    afterReservationMkdir = null,
    afterCopy = null,
    beforeTasksQuarantine = null,
    beforeCopyEntry = null,
    afterCopyEntry = null,
    afterTasksCanonicalProof = null,
    beforePayloadRemovalMutation = null,
    afterPayloadRemoval = null,
    afterStagingReservationRemoval = null,
    afterStagedIdentityEvidence = null,
    linkFile = link,
  } = {},
) {
  await assertTransactionStoreAnchors(state);
  if (await pathState(record.stagingPath) || await pathState(record.stagedPath)) {
    throw migrationError(`Staged Change path already exists: ${record.changeId}`, "CONCURRENT_CHANGE");
  }
  try {
    await mkdir(record.stagingPath, { mode: 0o700 });
  } catch (error) {
    throw migrationError(
      `Staged Change copy reservation already exists: ${record.stagingPath}`,
      "CONCURRENT_CHANGE",
      [error.message],
    );
  }
  const reservationState = await pathState(record.stagingPath);
  if (!reservationState?.isDirectory() || reservationState.isSymbolicLink()) {
    throw migrationError(`Staged Change copy reservation changed: ${record.stagingPath}`, "CONCURRENT_CHANGE");
  }
  record.stagingIdentity = fileIdentity(reservationState);
  record.phase = "copying";
  try {
  await persistTransaction(state);
  await assertChangeStagingReservation(state, record);
  if (afterReservationMkdir) {
    await afterReservationMkdir({ record, stagingPath: record.stagingPath });
  }

  const payloadPath = join(record.stagingPath, "payload");
  await copyDirectoryContentsWithLedger(record.representative.path, payloadPath, {
    record,
    persist: () => persistTransaction(state),
    beforeMutation: () => assertChangeStagingReservation(state, record),
    beforeEntry: beforeCopyEntry,
    afterEntry: afterCopyEntry,
    linkFile,
    provenanceContext: changeCopyProvenanceContext(state),
    label: "Staged Change copy",
  });
  await assertChangeStagingReservation(state, record);
  const payloadState = await pathState(payloadPath);
  if (!payloadState?.isDirectory() || payloadState.isSymbolicLink()
    || !(await isPathPhysicallyInside(record.stagingPath, payloadPath))) {
    throw migrationError(`Staged Change copy changed physical identity: ${payloadPath}`, "CONCURRENT_CHANGE");
  }
  const payloadIdentity = fileIdentity(payloadState);
  const tasksPath = join(payloadPath, "tasks.md");
  const copiedTasksState = await pathState(tasksPath);
  if (!copiedTasksState?.isFile() || copiedTasksState.isSymbolicLink()) {
    throw migrationError(`Staged Change tasks are not a real file: ${tasksPath}`, "CONCURRENT_CHANGE");
  }
  const copiedTasksIdentity = fileIdentity(copiedTasksState);
  const copiedTasksHash = await hashFile(tasksPath);
  if (afterCopy) await afterCopy({ record, stagingPath: payloadPath, tasksPath });
  await assertChangeStagingReservation(state, record);
  const [currentPayloadState, currentTasksState] = await Promise.all([
    pathState(payloadPath),
    pathState(tasksPath),
  ]);
  if (!currentPayloadState?.isDirectory()
    || currentPayloadState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(currentPayloadState), payloadIdentity)
    || !currentTasksState?.isFile()
    || currentTasksState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(currentTasksState), copiedTasksIdentity)
    || !(await isPathPhysicallyInside(payloadPath, tasksPath))) {
    throw migrationError(`Staged Change copy changed before tasks publication: ${payloadPath}`, "CONCURRENT_CHANGE");
  }

  const copiedTasksQuarantine = changeTasksCanonicalizationQuarantinePath(record);
  record.tasksCanonicalizationOriginalIdentity = copiedTasksIdentity;
  record.tasksCanonicalizationOriginalHash = copiedTasksHash;
  record.tasksCanonicalizationIdentity = null;
  record.tasksCanonicalizationPhase = "prepared";
  await persistTransaction(state);
  if (beforeTasksQuarantine) {
    await beforeTasksQuarantine({
      record,
      tasksPath,
      quarantinePath: copiedTasksQuarantine,
    });
  }
  await assertChangeStagingReservation(state, record);
  const currentPayloadBeforeQuarantine = await pathState(payloadPath);
  if (!currentPayloadBeforeQuarantine?.isDirectory()
    || currentPayloadBeforeQuarantine.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(currentPayloadBeforeQuarantine), payloadIdentity)) {
    throw migrationError(`Staged Change payload changed before tasks quarantine: ${payloadPath}`, "CONCURRENT_CHANGE");
  }
  try {
    await link(tasksPath, copiedTasksQuarantine);
  } catch (error) {
    throw migrationError(
      `Staged Change tasks quarantine could not be reserved exclusively: ${copiedTasksQuarantine}`,
      "CONCURRENT_CHANGE",
      [error.message],
    );
  }
  await syncDirectory(dirname(copiedTasksQuarantine));
  const assertCopiedTasksQuarantine = async () => {
    await assertChangeStagingReservation(state, record);
    const [currentPayload, currentQuarantine] = await Promise.all([
      pathState(payloadPath),
      pathState(copiedTasksQuarantine),
    ]);
    if (!currentPayload?.isDirectory()
      || currentPayload.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(currentPayload), payloadIdentity)
      || !currentQuarantine?.isFile()
      || currentQuarantine.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(currentQuarantine), copiedTasksIdentity)
      || await hashFile(copiedTasksQuarantine).catch(() => null) !== copiedTasksHash) {
      throw migrationError(`Staged Change tasks quarantine changed: ${copiedTasksQuarantine}`, "CONCURRENT_CHANGE");
    }
  };
  await assertCopiedTasksQuarantine();
  record.tasksCanonicalizationPhase = "quarantined";
  await persistTransaction(state);
  const ownerProofPath = changeTasksCanonicalizationOwnerProofPath(record);
  const anchorState = await pathState(state.destinationManifestPath);
  if (!anchorState?.isFile()
    || anchorState.isSymbolicLink()
    || !sameFileIdentity(
      fileIdentity(anchorState),
      state.destinationManifestWitnessIdentity,
    )) {
    throw migrationError(
      `Canonical staged Change transaction anchor changed: ${state.destinationManifestPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  try {
    await link(state.destinationManifestPath, ownerProofPath);
  } catch (error) {
    throw migrationError(
      `Canonical staged Change owner proof could not be created: ${ownerProofPath}`,
      "CONCURRENT_CHANGE",
      [error.message],
    );
  }
  await syncDirectory(dirname(ownerProofPath));
  if (afterTasksCanonicalProof) {
    await afterTasksCanonicalProof({
      record,
      tasksPath,
      proofPath: record.proofPath,
      stage: "owner",
    });
  }
  let canonicalHandle;
  try {
    canonicalHandle = await open(
      record.proofPath,
      "wx",
      copiedTasksState.mode & 0o777,
    );
    await canonicalHandle.writeFile(record.canonicalTasksSource, "utf8");
    await canonicalHandle.sync();
    await canonicalHandle.close();
    canonicalHandle = null;
  } catch (error) {
    await canonicalHandle?.close().catch(() => {});
    throw migrationError(
      `Canonical staged Change tasks proof could not be created exclusively: ${record.proofPath}`,
      "CONCURRENT_CHANGE",
      [error.message],
    );
  }
  await syncDirectory(dirname(record.proofPath));
  if (afterTasksCanonicalProof) {
    await afterTasksCanonicalProof({
      record,
      tasksPath,
      proofPath: record.proofPath,
      stage: "source",
    });
  }
  const canonicalProofPath = changeTasksCanonicalizationProofPath(record);
  try {
    await link(record.proofPath, canonicalProofPath);
  } catch (error) {
    throw migrationError(
      `Canonical staged Change tasks identity proof could not be created: ${canonicalProofPath}`,
      "CONCURRENT_CHANGE",
      [error.message],
    );
  }
  await syncDirectory(dirname(canonicalProofPath));
  const [
    canonicalSourceState,
    canonicalProofState,
    ownerProofState,
    currentAnchorState,
  ] = await Promise.all([
    pathState(record.proofPath),
    pathState(canonicalProofPath),
    pathState(ownerProofPath),
    pathState(state.destinationManifestPath),
  ]);
  if (!canonicalSourceState?.isFile()
    || canonicalSourceState.isSymbolicLink()
    || !canonicalProofState?.isFile()
    || canonicalProofState.isSymbolicLink()
    || !sameFileIdentity(
      fileIdentity(canonicalSourceState),
      fileIdentity(canonicalProofState),
    )
    || !ownerProofState?.isFile()
    || ownerProofState.isSymbolicLink()
    || !currentAnchorState?.isFile()
    || currentAnchorState.isSymbolicLink()
    || !sameFileIdentity(
      fileIdentity(currentAnchorState),
      state.destinationManifestWitnessIdentity,
    )
    || !sameFileIdentity(
      fileIdentity(ownerProofState),
      state.destinationManifestWitnessIdentity,
    )
    || await hashFile(record.proofPath).catch(() => null)
      !== sourceHash(record.canonicalTasksSource)) {
    throw migrationError(
      `Canonical staged Change tasks proof changed during creation: ${record.proofPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  if (afterTasksCanonicalProof) {
    await afterTasksCanonicalProof({
      record,
      tasksPath,
      proofPath: record.proofPath,
      identity: fileIdentity(canonicalSourceState),
      stage: "complete",
    });
  }
  record.proofIdentity = fileIdentity(canonicalSourceState);
  record.tasksCanonicalizationIdentity = fileIdentity(canonicalSourceState);
  record.tasksCanonicalizationPhase = "ready";
  await persistTransaction(state);
  record.tasksCanonicalizationPhase = "replacing";
  await persistTransaction(state);
  await assertCopiedTasksQuarantine();
  assertRegularFileSync(
    tasksPath,
    copiedTasksIdentity,
    copiedTasksHash,
    "Copied staged Change tasks source",
    "immediately before exact unlink",
  );
  unlinkSync(tasksPath);
  await syncDirectory(payloadPath);
  if (pathStateSync(tasksPath)) {
    throw migrationError(`Copied staged Change tasks survived exact unlink: ${tasksPath}`, "CONCURRENT_CHANGE");
  }
  record.copyTargetManifest = record.copyTargetManifest
    .filter((entry) => entry.relativePath !== "tasks.md");
  await persistTransaction(state);
  await assertCopiedTasksQuarantine();
  try {
    await link(record.proofPath, tasksPath);
  } catch (error) {
    throw migrationError(
      `Staged Change tasks could not be published exclusively: ${tasksPath}`,
      "CONCURRENT_CHANGE",
      [error.message],
    );
  }
  await syncDirectory(payloadPath);
  const canonicalTasksEntry = await inspectRemovalEntry(
    tasksPath,
    "tasks.md",
    "Canonical staged Change tasks",
  );
  if (!sameFileIdentity(canonicalTasksEntry.identity, record.proofIdentity)
    || canonicalTasksEntry.hash !== sourceHash(record.canonicalTasksSource)) {
    throw migrationError(`Staged Change tasks hash mismatch: ${tasksPath}`, "MIGRATION_STAGING_FAILED");
  }
  record.tasksCanonicalizationPhase = "published";
  const canonicalTasksEvidence = removalEntryEvidence(canonicalTasksEntry);
  canonicalTasksEvidence.quarantineRelativePath = normalizePath(relative(
    payloadPath,
    join(dirname(tasksPath), `.sdd-remove-${process.pid}-${randomUUID()}`),
  ));
  record.copyTargetManifest.push(canonicalTasksEvidence);
  record.copyTargetManifest.sort((left, right) => (
    record.copySourceManifest.findIndex((entry) => entry.relativePath === left.relativePath)
      - record.copySourceManifest.findIndex((entry) => entry.relativePath === right.relativePath)
  ));
  await persistTransaction(state);
  await assertCopiedTasksQuarantine();
  assertRegularFileSync(
    copiedTasksQuarantine,
    copiedTasksIdentity,
    copiedTasksHash,
    "Copied staged Change tasks quarantine",
    "immediately before exact unlink",
  );
  unlinkSync(copiedTasksQuarantine);
  await syncDirectory(dirname(copiedTasksQuarantine));
  if (pathStateSync(copiedTasksQuarantine)) {
    throw migrationError(
      `Copied staged Change tasks quarantine survived exact unlink: ${copiedTasksQuarantine}`,
      "CONCURRENT_CHANGE",
    );
  }
  record.tasksCanonicalizationPhase = "cleaned";
  await persistTransaction(state);
  await assertChangeStagingReservation(state, record);
  const verifiedPayloadState = await pathState(payloadPath);
  if (!verifiedPayloadState?.isDirectory()
    || verifiedPayloadState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(verifiedPayloadState), payloadIdentity)
    || await hashDirectory(payloadPath).catch(() => null) !== record.canonicalHash) {
    throw migrationError(`Staged central Change hash mismatch: ${record.changeId}`, "MIGRATION_STAGING_FAILED");
  }
  record.copyRoot = null;
  record.copySourceRoot = null;
  record.copySourceManifest = null;
  record.copyTargetManifest = null;
  record.copyProvenanceToken = null;
  record.copyIntent = null;
  await persistTransaction(state);

  record.phase = "publishing";
  record.stagedIdentity = null;
  record.copyRoot = record.stagedPath;
  record.copySourceRoot = payloadPath;
  record.copySourceManifest = await captureDirectoryRemovalManifest(
    payloadPath,
    { label: "Canonical staged Change source" },
  );
  record.copyTargetManifest = [];
  record.copyProvenanceToken = randomUUID();
  record.copyIntent = null;
  await persistTransaction(state);
  try {
    await mkdir(record.stagedPath, { mode: verifiedPayloadState.mode & 0o777 });
  } catch (error) {
    throw migrationError(
      `Staged central Change destination already exists: ${record.stagedPath}`,
      "CONCURRENT_CHANGE",
      [error.message],
    );
  }
  let stagedState = await pathState(record.stagedPath);
  if (!stagedState?.isDirectory()
    || stagedState.isSymbolicLink()
    || !(await isPathPhysicallyInside(state.stagingRoot, record.stagedPath))) {
    throw migrationError(`Staged central Change reservation changed: ${record.stagedPath}`, "CONCURRENT_CHANGE");
  }
  const stagedRootEntry = await inspectRemovalEntry(
    record.stagedPath,
    ".",
    "Canonical staged Change destination",
  );
  record.stagedIdentity = stagedRootEntry.identity;
  await createChangeCopyTargetProvenance(
    record,
    record.copySourceManifest[0],
    0,
    record.stagedPath,
    stagedRootEntry,
    changeCopyProvenanceContext(state),
  );
  record.copyTargetManifest = [removalEntryEvidence(stagedRootEntry)];
  await persistTransaction(state);
  const assertStagedReservation = async () => {
    await assertChangeStagingReservation(state, record);
    const currentStagedState = await pathState(record.stagedPath);
    if (!currentStagedState?.isDirectory()
      || currentStagedState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(currentStagedState), record.stagedIdentity)) {
      throw migrationError(`Staged central Change reservation changed: ${record.stagedPath}`, "CONCURRENT_CHANGE");
    }
  };
  await copyDirectoryContentsWithLedger(payloadPath, record.stagedPath, {
    record,
    persist: () => persistTransaction(state),
    beforeMutation: assertStagedReservation,
    linkFile,
    provenanceContext: changeCopyProvenanceContext(state),
    label: "Canonical staged Change copy",
  });
  stagedState = await pathState(record.stagedPath);
  const [proofState, stagedTasksState] = await Promise.all([
    pathState(record.proofPath),
    pathState(join(record.stagedPath, "tasks.md")),
  ]);
  if (!stagedState?.isDirectory()
    || stagedState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(stagedState), record.stagedIdentity)
    || !proofState?.isFile()
    || proofState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(proofState), record.proofIdentity)
    || !stagedTasksState?.isFile()
    || stagedTasksState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(proofState), fileIdentity(stagedTasksState))
    || await hashDirectory(record.stagedPath).catch(() => null) !== record.canonicalHash) {
    throw migrationError(`Staged central Change changed during publication: ${record.stagedPath}`, "CONCURRENT_CHANGE");
  }
  await createStagedChangeIdentityEvidence(state, record);
  record.copyRoot = null;
  record.copySourceRoot = null;
  record.copySourceManifest = null;
  record.copyTargetManifest = null;
  record.copyProvenanceToken = null;
  record.copyIntent = null;
  await persistTransaction(state);
  if (afterStagedIdentityEvidence) {
    await afterStagedIdentityEvidence({
      record,
      evidencePath: record.stagedIdentityEvidencePath,
    });
  }
  await removeProvenDirectoryTree(payloadPath, {
    expectedIdentity: payloadIdentity,
    expectedHash: record.canonicalHash,
    label: "Staged Change copy payload",
    assertBoundary: () => assertChangeStagingReservation(state, record),
    beforeRemovalMutation: beforePayloadRemovalMutation,
    removalManifest: state.stagingRemovalRoot === payloadPath
      ? state.stagingRemovalManifest
      : null,
    removalProgress: state.stagingRemovalRoot === payloadPath
      ? state.stagingRemovalProgress
      : [],
    persistRemovalManifest: async (manifest) => {
      state.stagingRemovalRoot = payloadPath;
      state.stagingRemovalManifest = manifest;
      state.stagingRemovalProgress = [];
      await persistTransaction(state);
    },
    persistRemovalProgress: async (progress) => {
      state.stagingRemovalProgress = progress;
      await persistTransaction(state);
    },
  });
  if (afterPayloadRemoval) await afterPayloadRemoval({ record, payloadPath });
  state.stagingRemovalRoot = null;
  state.stagingRemovalManifest = null;
  state.stagingRemovalProgress = [];
  await persistTransaction(state);
  assertDirectoryIdentitySync(
    record.stagingPath,
    record.stagingIdentity,
    "Staged Change copy reservation",
  );
  if (readdirSync(record.stagingPath).length !== 0) {
    throw migrationError(`Staged Change copy reservation changed before removal: ${record.stagingPath}`, "CONCURRENT_CHANGE");
  }
  rmdirSync(record.stagingPath);
  if (pathStateSync(record.stagingPath)) {
    throw migrationError(`Staged Change copy reservation was replaced during removal: ${record.stagingPath}`, "CONCURRENT_CHANGE");
  }
  if (afterStagingReservationRemoval) {
    await afterStagingReservationRemoval({ record, stagingPath: record.stagingPath });
  }
  record.stagingIdentity = null;
  record.phase = "staged";
  await persistTransaction(state);
  } catch (error) {
    throw error;
  }
}

async function publishDirectoryWithoutReplace(
  state,
  source,
  target,
  record,
  beforeEntryPublish = null,
  afterReservationMkdir = null,
  persistReservation = null,
  afterReservation = null,
  assertConfinement = null,
  afterStagedVerification = null,
  beforeTransferMutation = null,
) {
  if (assertConfinement) await assertConfinement(target);
  await mkdir(dirname(target), { recursive: true });
  if (assertConfinement) await assertConfinement(target);
  const stagedState = await pathState(source);
  if (!stagedState?.isDirectory() || stagedState.isSymbolicLink()) {
    throw migrationError(`Staged central Change is not a real directory: ${source}`, "CONCURRENT_CHANGE");
  }
  record.phase = "reserved";
  record.copyRoot = target;
  record.copySourceRoot = source;
  record.copySourceManifest = await captureDirectoryRemovalManifest(
    source,
    { label: "Staged central Change publication source" },
  );
  record.copyTargetManifest = [];
  record.copyProvenanceToken = randomUUID();
  record.copyIntent = null;
  if (persistReservation) await persistReservation(record);
  // The copy token and reservation intent are durable before target exposure.
  // A target entry is recoverable only after its external provenance hardlinks
  // have been created and authenticated against this source manifest.
  await createChangeReservationIntent(state, record, stagedState.mode & 0o777);
  if (assertConfinement) await assertConfinement(target);
  try {
    await mkdir(target, { mode: stagedState.mode & 0o777 });
  } catch (error) {
    throw migrationError(
      `Central Change destination already exists: ${target}`,
      "CONCURRENT_CHANGE",
      [error.message],
    );
  }
  const reservationState = await pathState(target);
  if (!reservationState?.isDirectory() || reservationState.isSymbolicLink()) {
    throw migrationError(`Central Change reservation is not a real directory: ${target}`, "CONCURRENT_CHANGE");
  }
  const targetRoot = await inspectRemovalEntry(
    target,
    ".",
    "Published central Change destination",
  );
  await createChangeCopyTargetProvenance(
    record,
    record.copySourceManifest[0],
    0,
    target,
    targetRoot,
    changeCopyProvenanceContext(state),
  );
  record.copyTargetManifest = [removalEntryEvidence(targetRoot)];
  await bindChangeReservation(state, record, reservationState);
  if (persistReservation) await persistReservation(record);
  if (afterReservationMkdir) await afterReservationMkdir({ record, target });
  if (assertConfinement) await assertConfinement(target);
  const assertTargetReservation = async () => {
    if (assertConfinement) await assertConfinement(target);
    const currentReservationState = await pathState(target);
    if (!currentReservationState?.isDirectory()
      || currentReservationState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(currentReservationState), record.reservationIdentity)) {
      throw migrationError(`Central Change reservation changed physical identity: ${target}`, "CONCURRENT_CHANGE");
    }
  };
  if (afterReservation) await afterReservation({ record, target });
  await assertTargetReservation();
  let publishedEntryIndex = 0;
  await copyDirectoryContentsWithLedger(source, target, {
    record,
    persist: async () => {
      if (persistReservation) await persistReservation(record);
    },
    beforeMutation: async (mutation) => {
      if (beforeTransferMutation) await beforeTransferMutation({ record, ...mutation });
      await assertTargetReservation();
    },
    beforeEntry: beforeEntryPublish
      ? async ({ relativePath }) => {
        if (relativePath === "." || relativePath.includes("/")) return;
        await beforeEntryPublish({
          source,
          target,
          entry: relativePath,
          index: publishedEntryIndex,
          record,
        });
        publishedEntryIndex += 1;
      }
      : null,
    provenanceContext: changeCopyProvenanceContext(state),
    label: "Published central Change",
  });
  await assertTargetReservation();
  if (afterStagedVerification) {
    await afterStagedVerification({ record, stagedPath: source });
  }
  await assertDirectoryRemovalManifest(
    source,
    record.copySourceManifest,
    "Staged central Change publication source",
  );
  if (await hashDirectory(target) !== record.canonicalHash) {
    throw migrationError(`Published central Change hash mismatch: ${target}`, "CONCURRENT_CHANGE");
  }
  await assertTargetReservation();
  record.published = true;
}

function briefOwnershipIntentPath(record) {
  return join(dirname(record.stagedPath), `${basename(record.stagedPath)}-ownership-intent`);
}

function assertBriefOwnershipIntent(record) {
  if (!record.briefIntentAuthenticated
    || record.briefIntentIdentity === null
    || record.briefIntentPath !== briefOwnershipIntentPath(record)) {
    throw migrationError(
      `Change Brief lacks an authenticated pre-publication owner intent: ${record.destination}`,
      "CONCURRENT_CHANGE",
    );
  }
}

async function createBriefOwnershipIntent(state, record) {
  if (record.briefIntentIdentity !== null || await pathState(briefOwnershipIntentPath(record))) {
    throw migrationError(
      `Change Brief owner intent already exists: ${record.destination}`,
      "CONCURRENT_CHANGE",
    );
  }
  await assertTransactionStoreAnchors(state);
  await assertStoredDirectoryAnchor(record.ownerRoot, record.ownerAnchor, "Change Brief owner");
  const stagingParentState = await pathState(dirname(record.stagedPath));
  const anchorState = await pathState(state.destinationManifestWitnessPath);
  if (!stagingParentState?.isDirectory()
    || stagingParentState.isSymbolicLink()
    || !anchorState?.isFile()
    || anchorState.isSymbolicLink()
    || !sameFileIdentity(
      fileIdentity(anchorState),
      state.destinationManifestWitnessIdentity,
    )) {
    throw migrationError(
      `Change Brief owner intent anchor is unavailable: ${record.destination}`,
      "CONCURRENT_CHANGE",
    );
  }
  const intentPath = briefOwnershipIntentPath(record);
  const intent = await writeDurableEvidenceExclusive(intentPath, (ownerIdentity) => ({
    version: 1,
    stagedPath: resolve(record.stagedPath),
    destination: resolve(record.destination),
    ownerRoot: resolve(record.ownerRoot),
    hash: record.hash,
    ownerIdentity,
    stagingParentIdentity: fileIdentity(stagingParentState),
    anchorPath: resolve(state.destinationManifestWitnessPath),
    anchorIdentity: fileIdentity(anchorState),
  }));
  record.briefIntentPath = intentPath;
  record.briefIntentIdentity = intent.ownerIdentity;
  record.briefIntentSource = `${JSON.stringify(intent, null, 2)}\n`;
  record.briefIntentAuthenticated = true;
  await persistTransaction(state);
}

async function hydrateBriefOwnershipIntent(
  record,
  index,
  journalPath,
  destinationManifest,
) {
  const intentPath = briefOwnershipIntentPath(record);
  const intentState = await pathState(intentPath);
  record.briefIntentPath = intentPath;
  record.briefIntentSource = null;
  record.briefIntentAuthenticated = false;
  if (record.briefIntentIdentity === null) {
    if (intentState) {
      throw journalFailure(
        journalPath,
        `briefs[${index}] has an unauthenticated owner intent.`,
      );
    }
    return;
  }
  try {
    const { evidence: intent, state: authenticatedIntentState } =
      await readChangeReservationEvidence(
        { journalPath },
        intentPath,
        `briefs[${index}] owner intent`,
      );
    requireExactJournalKeys(
      intent,
      [
        "version",
        "stagedPath",
        "destination",
        "ownerRoot",
        "hash",
        "ownerIdentity",
        "stagingParentIdentity",
        "anchorPath",
        "anchorIdentity",
      ],
      `briefs[${index}] owner intent`,
      journalPath,
    );
    requireJournalIdentity(
      intent.stagingParentIdentity,
      `briefs[${index}] owner intent staging parent`,
      journalPath,
    );
    requireJournalIdentity(
      intent.anchorIdentity,
      `briefs[${index}] owner intent anchor`,
      journalPath,
    );
    const [stagingParentState, anchorState] = await Promise.all([
      pathState(dirname(record.stagedPath)),
      pathState(destinationManifest.witnessPath),
    ]);
    if (intent.version !== 1
      || intent.stagedPath !== resolve(record.stagedPath)
      || intent.destination !== resolve(record.destination)
      || intent.ownerRoot !== resolve(record.ownerRoot)
      || intent.hash !== record.hash
      || !sameFileIdentity(intent.ownerIdentity, record.briefIntentIdentity)
      || !sameFileIdentity(fileIdentity(authenticatedIntentState), record.briefIntentIdentity)
      || !stagingParentState?.isDirectory()
      || stagingParentState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(stagingParentState), intent.stagingParentIdentity)
      || intent.anchorPath !== resolve(destinationManifest.witnessPath)
      || !anchorState?.isFile()
      || anchorState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(anchorState), destinationManifest.witnessIdentity)
      || !sameFileIdentity(intent.anchorIdentity, destinationManifest.witnessIdentity)) {
      throw migrationError(
        `Change Brief owner intent is not bound to its transaction: ${record.destination}`,
        "CONCURRENT_CHANGE",
      );
    }
    record.briefIntentSource = `${JSON.stringify(intent, null, 2)}\n`;
    record.briefIntentAuthenticated = true;
  } catch (error) {
    throw journalFailure(journalPath, `briefs[${index}] owner intent is invalid: ${error.message}`);
  }
}

function briefStagingBindingPath(record) {
  return join(dirname(record.stagedPath), `${basename(record.stagedPath)}-staging-binding`);
}

function briefFileCreationState(state) {
  return {
    mode: String(state.mode & 0o777),
    uid: String(state.uid),
    gid: String(state.gid),
    birthtimeMs: String(state.birthtimeMs),
  };
}

async function createBriefStagingBinding(record, stagedIdentity) {
  assertBriefOwnershipIntent(record);
  const stagedState = await pathState(record.stagedPath);
  if (!stagedState?.isFile()
    || stagedState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(stagedState), stagedIdentity)
    || await hashFile(record.stagedPath).catch(() => null) !== record.hash) {
    throw migrationError(`Staged Change Brief changed before binding: ${record.stagedPath}`, "CONCURRENT_CHANGE");
  }
  const bindingPath = briefStagingBindingPath(record);
  const binding = await writeDurableEvidenceExclusive(bindingPath, (ownerIdentity) => ({
    version: 1,
    target: resolve(record.stagedPath),
    hash: record.hash,
    ownerIdentity,
    intentIdentity: record.briefIntentIdentity,
    targetIdentity: stagedIdentity,
    targetCreation: briefFileCreationState(stagedState),
  }));
  record.stagingBindingPath = bindingPath;
  record.stagingBindingIdentity = binding.ownerIdentity;
  record.stagingBindingTargetIdentity = binding.targetIdentity;
  record.stagingBindingSource = `${JSON.stringify(binding, null, 2)}\n`;
  record.stagingBindingAuthenticated = true;
  return binding;
}

async function hydrateBriefStagingBinding(record, index, journalPath) {
  const bindingPath = briefStagingBindingPath(record);
  const bindingState = await pathState(bindingPath);
  record.stagingBindingPath = bindingPath;
  record.stagingBindingSource = null;
  record.stagingBindingTargetIdentity = null;
  record.stagingBindingAuthenticated = false;
  if (!bindingState) {
    if (record.stagingBindingIdentity !== null) {
      throw journalFailure(journalPath, `briefs[${index}] lost its staged-file binding.`);
    }
    return;
  }
  assertBriefOwnershipIntent(record);
  try {
    const { evidence: binding, state: authenticatedBindingState } =
      await readChangeReservationEvidence(
        { journalPath },
        bindingPath,
        `briefs[${index}] staged-file binding`,
      );
    requireExactJournalKeys(
      binding,
      [
        "version",
        "target",
        "hash",
        "ownerIdentity",
        "intentIdentity",
        "targetIdentity",
        "targetCreation",
      ],
      `briefs[${index}] staged-file binding`,
      journalPath,
    );
    requireJournalIdentity(binding.intentIdentity, `briefs[${index}] binding intent`, journalPath);
    requireJournalIdentity(binding.targetIdentity, `briefs[${index}] binding target`, journalPath);
    const stagedState = await pathState(record.stagedPath);
    if (binding.version !== 1
      || binding.target !== resolve(record.stagedPath)
      || binding.hash !== record.hash
      || !sameFileIdentity(binding.intentIdentity, record.briefIntentIdentity)
      || (record.stagingBindingIdentity !== null
        && !sameFileIdentity(
          record.stagingBindingIdentity,
          fileIdentity(authenticatedBindingState),
        ))
      || !stagedState?.isFile()
      || stagedState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(stagedState), binding.targetIdentity)
      || JSON.stringify(briefFileCreationState(stagedState))
        !== JSON.stringify(binding.targetCreation)
      || await hashFile(record.stagedPath).catch(() => null) !== record.hash) {
      throw migrationError(
        `Staged Change Brief binding is not owner-bound: ${record.stagedPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    record.stagingBindingIdentity = fileIdentity(authenticatedBindingState);
    record.stagingBindingTargetIdentity = binding.targetIdentity;
    record.stagingBindingSource = `${JSON.stringify(binding, null, 2)}\n`;
    record.stagingBindingAuthenticated = true;
  } catch (error) {
    throw journalFailure(journalPath, `briefs[${index}] staged-file binding is invalid: ${error.message}`);
  }
}

function briefPublicationBindingPath(record) {
  return join(dirname(record.stagedPath), `${basename(record.stagedPath)}-publication-binding`);
}

async function createBriefPublicationBinding(record, publication) {
  assertBriefOwnershipIntent(record);
  const destinationState = await pathState(record.destination);
  if (publication.hash !== record.hash
    || !destinationState?.isFile()
    || destinationState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(destinationState), publication.identity)
    || await hashFile(record.destination).catch(() => null) !== record.hash) {
    throw migrationError(
      `Published Change Brief changed before owner binding: ${record.destination}`,
      "CONCURRENT_CHANGE",
    );
  }
  const bindingPath = briefPublicationBindingPath(record);
  const binding = await writeDurableEvidenceExclusive(bindingPath, (ownerIdentity) => ({
    version: 1,
    target: resolve(record.destination),
    hash: record.hash,
    ownerIdentity,
    intentIdentity: record.briefIntentIdentity,
    targetIdentity: publication.identity,
    targetCreation: briefFileCreationState(destinationState),
  }));
  record.publicationBindingPath = bindingPath;
  record.publicationBindingIdentity = binding.ownerIdentity;
  record.publicationBindingTargetIdentity = binding.targetIdentity;
  record.publicationBindingSource = `${JSON.stringify(binding, null, 2)}\n`;
  record.publicationBindingAuthenticated = true;
  return binding;
}

async function hydrateBriefPublicationBinding(record, index, journalPath) {
  const bindingPath = briefPublicationBindingPath(record);
  const bindingState = await pathState(bindingPath);
  record.publicationBindingPath = bindingPath;
  record.publicationBindingSource = null;
  record.publicationBindingTargetIdentity = null;
  record.publicationBindingAuthenticated = false;
  if (!bindingState) {
    if (record.publicationBindingIdentity !== null) {
      throw journalFailure(journalPath, `briefs[${index}] lost its publication binding.`);
    }
    return;
  }
  assertBriefOwnershipIntent(record);
  try {
    const { evidence: binding, state: authenticatedBindingState } =
      await readChangeReservationEvidence(
        { journalPath },
        bindingPath,
        `briefs[${index}] publication binding`,
      );
    requireExactJournalKeys(
      binding,
      [
        "version",
        "target",
        "hash",
        "ownerIdentity",
        "intentIdentity",
        "targetIdentity",
        "targetCreation",
      ],
      `briefs[${index}] publication binding`,
      journalPath,
    );
    requireJournalIdentity(binding.intentIdentity, `briefs[${index}] publication binding intent`, journalPath);
    requireJournalIdentity(binding.targetIdentity, `briefs[${index}] publication binding target`, journalPath);
    const destinationState = await pathState(record.destination);
    const destinationMayBeAbsent = ["removing", "removed"].includes(record.phase);
    if (binding.version !== 1
      || binding.target !== resolve(record.destination)
      || binding.hash !== record.hash
      || !sameFileIdentity(binding.intentIdentity, record.briefIntentIdentity)
      || (record.publicationBindingIdentity !== null
        && !sameFileIdentity(
          record.publicationBindingIdentity,
          fileIdentity(authenticatedBindingState),
        ))
      || (!destinationState && !destinationMayBeAbsent)
      || (destinationState && (
        !destinationState.isFile()
        || destinationState.isSymbolicLink()
        || !sameFileIdentity(fileIdentity(destinationState), binding.targetIdentity)
        || JSON.stringify(briefFileCreationState(destinationState))
          !== JSON.stringify(binding.targetCreation)
        || await hashFile(record.destination).catch(() => null) !== record.hash
      ))) {
      throw migrationError(
        `Published Change Brief binding is not owner-bound: ${record.destination}`,
        "CONCURRENT_CHANGE",
      );
    }
    record.publicationBindingIdentity = fileIdentity(authenticatedBindingState);
    record.publicationBindingTargetIdentity = binding.targetIdentity;
    record.publicationBindingSource = `${JSON.stringify(binding, null, 2)}\n`;
    record.publicationBindingAuthenticated = true;
  } catch (error) {
    throw journalFailure(journalPath, `briefs[${index}] publication binding is invalid: ${error.message}`);
  }
}

function briefStagingProofPrefix(record) {
  const stagedName = basename(record.stagedPath);
  if (!/^\.brief-[0-9]+$/.test(stagedName)) {
    throw migrationError(
      `Change Brief staged path cannot derive staging evidence: ${record.stagedPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  return `${stagedName}-identity-`;
}

function briefStagingProofPath(record, identity) {
  if (!/^[0-9]+$/.test(identity?.dev ?? "") || !/^[0-9]+$/.test(identity?.ino ?? "")) {
    throw migrationError(
      `Staged Change Brief identity is invalid: ${record.stagedPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  return join(
    dirname(record.stagedPath),
    `${briefStagingProofPrefix(record)}${identity.dev}-${identity.ino}.proof`,
  );
}

async function assertBriefStagingBoundary(record, candidate = record.stagedPath) {
  const parent = dirname(record.stagedPath);
  if (resolve(dirname(candidate)) !== resolve(parent)) {
    throw migrationError(
      `Change Brief staging evidence escapes its transaction: ${candidate}`,
      "UNSAFE_ARTIFACT_PATH",
    );
  }
  const parentState = await pathState(parent);
  if (!parentState?.isDirectory() || parentState.isSymbolicLink()) {
    throw migrationError(
      `Change Brief staging evidence parent is unsafe: ${parent}`,
      "UNSAFE_ARTIFACT_PATH",
    );
  }
  return fileIdentity(parentState);
}

async function readAuthenticatedBriefStagingFile(
  record,
  path,
  expectedIdentity,
  expectedHash,
  label,
) {
  await assertBriefStagingBoundary(record, path);
  const observedState = await pathState(path);
  if (!observedState?.isFile()
    || observedState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(observedState), expectedIdentity)) {
    throw migrationError(`${label} changed physical identity: ${path}`, "CONCURRENT_CHANGE");
  }
  const identity = fileIdentity(observedState);
  const handle = await open(path, "r");
  let source;
  try {
    source = await readFileHandleSnapshot(handle, identity, label);
  } finally {
    await handle.close();
  }
  await assertRegularFileIdentity(path, identity, label);
  if (sourceHash(source) !== expectedHash) {
    throw migrationError(`${label} changed source-derived content: ${path}`, "CONCURRENT_CHANGE");
  }
  return { identity, source };
}

async function inspectBriefStagingProof(record) {
  const parent = dirname(record.stagedPath);
  await assertBriefStagingBoundary(record);
  const prefix = briefStagingProofPrefix(record);
  const discovered = [];
  for (const name of await readdir(parent)) {
    if (!name.startsWith(prefix)) continue;
    const match = /^([0-9]+)-([0-9]+)\.proof$/.exec(name.slice(prefix.length));
    if (!match) {
      throw migrationError(
        `Change Brief staging evidence is ambiguous: ${join(parent, name)}`,
        "CONCURRENT_CHANGE",
      );
    }
    discovered.push({
      path: join(parent, name),
      identity: { dev: match[1], ino: match[2] },
    });
  }
  if (discovered.length > 1) {
    throw migrationError(
      `Staged Change Brief has duplicate identity evidence: ${record.stagedPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  if (discovered.length === 0) return null;
  const proof = discovered[0];
  return {
    ...proof,
    ...(await readAuthenticatedBriefStagingFile(
      record,
      proof.path,
      proof.identity,
      record.hash,
      "Staged Change Brief identity proof",
    )),
  };
}

async function assertBriefStagedFileMatchesProof(record, proof) {
  const staged = await readAuthenticatedBriefStagingFile(
    record,
    record.stagedPath,
    proof.identity,
    record.hash,
    "Staged Change Brief",
  );
  if (!sameFileIdentity(staged.identity, proof.identity)) {
    throw migrationError(
      `Staged Change Brief is detached from its identity proof: ${record.stagedPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  return staged;
}

async function createBriefStagingProof(record, stagedIdentity) {
  assertBriefOwnershipIntent(record);
  if (!record.stagingBindingAuthenticated
    || !sameFileIdentity(record.stagingBindingTargetIdentity, stagedIdentity)) {
    throw migrationError(
      `Staged Change Brief lacks an owner-bound creation receipt: ${record.stagedPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  if (await inspectBriefStagingProof(record)) {
    throw migrationError(
      `Staged Change Brief identity proof already exists: ${record.stagedPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  await readAuthenticatedBriefStagingFile(
    record,
    record.stagedPath,
    stagedIdentity,
    record.hash,
    "Staged Change Brief",
  );
  const proofPath = briefStagingProofPath(record, stagedIdentity);
  try {
    await link(record.stagedPath, proofPath);
  } catch (error) {
    throw migrationError(
      `Staged Change Brief identity proof could not be created: ${proofPath}`,
      "CONCURRENT_CHANGE",
      [error.message],
    );
  }
  await syncDirectory(dirname(proofPath));
  const proof = await inspectBriefStagingProof(record);
  if (!proof || !sameFileIdentity(proof.identity, stagedIdentity)) {
    throw migrationError(
      `Staged Change Brief identity proof changed after creation: ${record.stagedPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  await assertBriefStagedFileMatchesProof(record, proof);
  return proof;
}

async function hydrateBriefStagingProof(record, index, journalPath) {
  try {
    let proof = await inspectBriefStagingProof(record);
    const stagedState = await pathState(record.stagedPath);
    if (!proof && stagedState && record.stagingBindingAuthenticated) {
      proof = await createBriefStagingProof(
        record,
        record.stagingBindingTargetIdentity,
      );
    }
    if (!proof || !stagedState) {
      if (!proof && !stagedState && record.phase === "pending"
        && record.stagedIdentity === null
        && record.stagingProofIdentity === null) {
        record.stagingProofPath = null;
        return;
      }
      throw migrationError(
        `Staged Change Brief lacks complete external identity evidence: ${record.stagedPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    assertBriefOwnershipIntent(record);
    await assertBriefStagedFileMatchesProof(record, proof);
    if ((record.stagedIdentity !== null
      && !sameFileIdentity(record.stagedIdentity, proof.identity))
      || (record.stagingProofIdentity !== null
        && !sameFileIdentity(record.stagingProofIdentity, proof.identity))) {
      throw migrationError(
        `Staged Change Brief identity evidence contradicts its journal record: ${record.stagedPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    if (record.phase === "pending") {
      record.stagedIdentity = proof.identity;
      record.stagingProofIdentity = proof.identity;
      record.phase = "prepared";
    } else if (record.stagedIdentity === null || record.stagingProofIdentity === null) {
      throw migrationError(
        `Staged Change Brief identity evidence is incomplete: ${record.stagedPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    record.stagingProofPath = proof.path;
  } catch (error) {
    throw journalFailure(journalPath, `briefs[${index}] staging proof is invalid: ${error.message}`);
  }
}

function briefPublicationProofPrefix(record) {
  const stagedName = basename(record.stagedPath);
  const stagedMatch = /^\.brief-([0-9]+)$/.exec(stagedName);
  if (!stagedMatch) {
    throw migrationError(
      `Change Brief staged path cannot derive publication evidence: ${record.stagedPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  return `${basename(dirname(record.stagedPath))}-brief-${stagedMatch[1]}-identity-`;
}

function briefPublicationProofPath(record, identity) {
  if (!/^[0-9]+$/.test(identity?.dev ?? "") || !/^[0-9]+$/.test(identity?.ino ?? "")) {
    throw migrationError(
      `Change Brief publication identity is invalid: ${record.destination}`,
      "CONCURRENT_CHANGE",
    );
  }
  return join(
    dirname(record.destination),
    `${briefPublicationProofPrefix(record)}${identity.dev}-${identity.ino}.proof`,
  );
}

function briefPublicationProofCleanupPath(record, identity) {
  return `${briefPublicationProofPath(record, identity)}.cleanup`;
}

async function assertBriefPublicationBoundary(record, candidate = record.destination) {
  await assertStoredDirectoryAnchor(record.ownerRoot, record.ownerAnchor, "Change Brief owner");
  const parent = dirname(record.destination);
  if (resolve(dirname(candidate)) !== resolve(parent)
    || !(await isPathPhysicallyInside(record.ownerAnchor.physicalPath, candidate))) {
    throw migrationError(
      `Change Brief publication evidence escapes its owner: ${candidate}`,
      "UNSAFE_ARTIFACT_PATH",
    );
  }
  const parentState = await pathState(parent);
  if (!parentState?.isDirectory()
    || parentState.isSymbolicLink()
    || !(await isPathPhysicallyInside(record.ownerAnchor.physicalPath, parent))) {
    throw migrationError(
      `Change Brief publication evidence parent is unsafe: ${parent}`,
      "UNSAFE_ARTIFACT_PATH",
    );
  }
  return fileIdentity(parentState);
}

async function readAuthenticatedBriefFile(
  record,
  path,
  expectedIdentity,
  expectedHash,
  label,
) {
  await assertBriefPublicationBoundary(record, path);
  const observedState = await pathState(path);
  if (!observedState?.isFile()
    || observedState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(observedState), expectedIdentity)) {
    throw migrationError(`${label} changed physical identity: ${path}`, "CONCURRENT_CHANGE");
  }
  const identity = fileIdentity(observedState);
  const handle = await open(path, "r");
  let source;
  try {
    source = await readFileHandleSnapshot(handle, identity, label);
  } finally {
    await handle.close();
  }
  await assertRegularFileIdentity(path, identity, label);
  if (sourceHash(source) !== expectedHash) {
    throw migrationError(`${label} changed source-derived content: ${path}`, "CONCURRENT_CHANGE");
  }
  return { identity, source };
}

async function discoverBriefPublicationProofs(record) {
  const parent = dirname(record.destination);
  const parentState = await pathState(parent);
  if (!parentState) return { primary: [], cleanup: [] };
  await assertBriefPublicationBoundary(record);
  const prefix = briefPublicationProofPrefix(record);
  const primary = [];
  const cleanup = [];
  for (const name of await readdir(parent)) {
    if (!name.startsWith(prefix)) continue;
    const suffix = name.slice(prefix.length);
    const primaryMatch = /^([0-9]+)-([0-9]+)\.proof$/.exec(suffix);
    const cleanupMatch = /^([0-9]+)-([0-9]+)\.proof\.cleanup$/.exec(suffix);
    const match = primaryMatch ?? cleanupMatch;
    if (!match) {
      throw migrationError(
        `Change Brief publication evidence is ambiguous: ${join(parent, name)}`,
        "CONCURRENT_CHANGE",
      );
    }
    const entry = {
      path: join(parent, name),
      identity: { dev: match[1], ino: match[2] },
    };
    (cleanupMatch ? cleanup : primary).push(entry);
  }
  if (primary.length > 1 || cleanup.length > 1) {
    throw migrationError(
      `Change Brief publication has duplicate identity evidence: ${record.destination}`,
      "CONCURRENT_CHANGE",
    );
  }
  return { primary, cleanup };
}

async function inspectBriefPublicationProofs(record, expectedHash = record.hash) {
  const discovered = await discoverBriefPublicationProofs(record);
  const primary = discovered.primary[0] ?? null;
  const cleanup = discovered.cleanup[0] ?? null;
  const inspectedPrimary = primary
    ? {
      ...primary,
      ...(await readAuthenticatedBriefFile(
        record,
        primary.path,
        primary.identity,
        expectedHash,
        "Change Brief publication proof",
      )),
    }
    : null;
  const inspectedCleanup = cleanup
    ? {
      ...cleanup,
      ...(await readAuthenticatedBriefFile(
        record,
        cleanup.path,
        cleanup.identity,
        expectedHash,
        "Change Brief publication cleanup proof",
      )),
    }
    : null;
  if (inspectedPrimary && inspectedCleanup
    && !sameFileIdentity(inspectedPrimary.identity, inspectedCleanup.identity)) {
    throw migrationError(
      `Change Brief publication evidence identities diverge: ${record.destination}`,
      "CONCURRENT_CHANGE",
    );
  }
  return {
    primary: inspectedPrimary,
    cleanup: inspectedCleanup,
    identity: inspectedPrimary?.identity ?? inspectedCleanup?.identity ?? null,
  };
}

async function assertBriefProofMatchesRecord(
  record,
  evidence,
  { allowCleanup = false, requireBinding = true } = {},
) {
  if (requireBinding) {
    assertBriefOwnershipIntent(record);
    if (!record.publicationBindingAuthenticated
      || !sameFileIdentity(record.publicationBindingTargetIdentity, evidence.identity)) {
      throw migrationError(
        `Change Brief publication proof lacks its owner-bound receipt: ${record.destination}`,
        "CONCURRENT_CHANGE",
      );
    }
  }
  if (evidence.identity === null
    || (!evidence.primary && !allowCleanup)
    || (evidence.cleanup && !allowCleanup)
    || (record.publicationProofIdentity !== null
      && !sameFileIdentity(record.publicationProofIdentity, evidence.identity))
    || (record.publishedIdentity !== null
      && !sameFileIdentity(record.publishedIdentity, evidence.identity))) {
    throw migrationError(
      `Change Brief publication proof does not authenticate its record: ${record.destination}`,
      "CONCURRENT_CHANGE",
    );
  }
  const expectedPrimaryPath = briefPublicationProofPath(record, evidence.identity);
  const expectedCleanupPath = briefPublicationProofCleanupPath(record, evidence.identity);
  if (evidence.primary && resolve(evidence.primary.path) !== resolve(expectedPrimaryPath)) {
    throw migrationError(
      `Change Brief publication proof path is not transaction-derived: ${evidence.primary.path}`,
      "CONCURRENT_CHANGE",
    );
  }
  if (evidence.cleanup && resolve(evidence.cleanup.path) !== resolve(expectedCleanupPath)) {
    throw migrationError(
      `Change Brief publication cleanup proof path is not transaction-derived: ${evidence.cleanup.path}`,
      "CONCURRENT_CHANGE",
    );
  }
  if (record.publicationProofCleanupPath !== null
    && (!evidence.cleanup
      || resolve(record.publicationProofCleanupPath) !== resolve(expectedCleanupPath)
      || !sameFileIdentity(record.publicationProofCleanupIdentity, evidence.identity))) {
    throw migrationError(
      `Change Brief publication cleanup proof does not authenticate its record: ${record.destination}`,
      "CONCURRENT_CHANGE",
    );
  }
  if (record.publicationProofPath !== null
    && resolve(record.publicationProofPath) !== resolve(expectedPrimaryPath)) {
    throw migrationError(
      `Change Brief publication proof path changed: ${record.publicationProofPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  return evidence.identity;
}

async function assertBriefDestinationMatchesProof(record, identity) {
  assertBriefOwnershipIntent(record);
  if (!record.publicationBindingAuthenticated
    || !sameFileIdentity(record.publicationBindingTargetIdentity, identity)) {
    throw migrationError(
      `Published Change Brief lacks its owner-bound receipt: ${record.destination}`,
      "CONCURRENT_CHANGE",
    );
  }
  return readAuthenticatedBriefFile(
    record,
    record.destination,
    identity,
    record.hash,
    "Published Change Brief",
  );
}

async function reserveBriefPublicationProof(record, publication) {
  const existingEvidence = await inspectBriefPublicationProofs(record, publication.hash);
  if (existingEvidence.primary || existingEvidence.cleanup) {
    throw migrationError(
      `Change Brief publication evidence already exists: ${record.destination}`,
      "CONCURRENT_CHANGE",
    );
  }
  await readAuthenticatedBriefFile(
    record,
    record.destination,
    publication.identity,
    publication.hash,
    "Change Brief publication destination",
  );
  const proofPath = briefPublicationProofPath(record, publication.identity);
  await assertBriefPublicationBoundary(record, proofPath);
  try {
    await link(record.destination, proofPath);
  } catch (error) {
    throw migrationError(
      `Change Brief publication proof could not be created: ${proofPath}`,
      "CONCURRENT_CHANGE",
      [error.message],
    );
  }
  await syncDirectory(dirname(proofPath));
  const evidence = await inspectBriefPublicationProofs(record, publication.hash);
  const identity = await assertBriefProofMatchesRecord(
    { ...record, publicationProofIdentity: publication.identity },
    evidence,
    { requireBinding: false },
  );
  if (!evidence.primary
    || evidence.cleanup
    || !sameFileIdentity(identity, publication.identity)) {
    throw migrationError(
      `Change Brief publication proof changed during reservation: ${proofPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  record.publicationProofPath = proofPath;
}

async function createBriefPublicationProof(record, publication) {
  if (publication.hash !== record.hash) {
    throw migrationError(
      `Change Brief publication source hash changed: ${record.destination}`,
      "CONCURRENT_CHANGE",
    );
  }
  await assertBriefDestinationMatchesProof(record, publication.identity);
  let evidence = await inspectBriefPublicationProofs(record);
  if (!evidence.primary && !evidence.cleanup) {
    await reserveBriefPublicationProof(record, publication);
    evidence = await inspectBriefPublicationProofs(record);
  }
  const proofPath = briefPublicationProofPath(record, publication.identity);
  const identity = await assertBriefProofMatchesRecord(
    { ...record, publicationProofIdentity: publication.identity },
    evidence,
  );
  if (!evidence.primary
    || evidence.cleanup
    || !sameFileIdentity(identity, publication.identity)) {
    throw migrationError(
      `Change Brief publication proof changed during creation: ${proofPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  await assertBriefDestinationMatchesProof(record, identity);
  record.publicationProofPath = proofPath;
  record.publicationProofIdentity = identity;
  record.publicationProofPhase = "present";
}

async function adoptPreparedBriefPublication(record) {
  const evidence = await inspectBriefPublicationProofs(record);
  const destinationState = await pathState(record.destination);
  if (!evidence.primary && !evidence.cleanup) {
    if (destinationState) {
      throw migrationError(
        `Change Brief destination has no transaction publication proof: ${record.destination}`,
        "CONCURRENT_CHANGE",
      );
    }
    return false;
  }
  if (!evidence.primary || evidence.cleanup) {
    throw migrationError(
      `Prepared Change Brief has ambiguous publication evidence: ${record.destination}`,
      "CONCURRENT_CHANGE",
    );
  }
  const identity = await assertBriefProofMatchesRecord(record, evidence);
  await assertBriefDestinationMatchesProof(record, identity);
  record.publishedIdentity = identity;
  record.publicationProofIdentity = identity;
  record.publicationProofPath = evidence.primary.path;
  record.publicationProofPhase = "present";
  record.published = true;
  record.phase = "published";
  return true;
}

async function assertPublishedBriefProof(record) {
  if (record.publicationProofPhase !== "present") {
    throw migrationError(
      `Change Brief publication proof is unavailable: ${record.destination}`,
      "CONCURRENT_CHANGE",
    );
  }
  const evidence = await inspectBriefPublicationProofs(record);
  const identity = await assertBriefProofMatchesRecord(record, evidence);
  if (!evidence.primary || evidence.cleanup) {
    throw migrationError(
      `Change Brief publication proof is incomplete: ${record.destination}`,
      "CONCURRENT_CHANGE",
    );
  }
  await assertBriefDestinationMatchesProof(record, identity);
  return { evidence, identity };
}

async function unlinkBriefPublicationEvidence(
  record,
  path,
  identity,
  label,
  { peerPath = null, requirePrimaryAbsent = false, beforeRemovalMutation = null } = {},
) {
  const parentIdentity = await assertBriefPublicationBoundary(record, path);
  if (peerPath !== null) await assertBriefPublicationBoundary(record, peerPath);
  const primaryPath = briefPublicationProofPath(record, identity);
  if (beforeRemovalMutation) await beforeRemovalMutation({ label, path });
  assertDirectoryIdentitySync(dirname(path), parentIdentity, label);
  assertRegularFileSync(path, identity, record.hash, label, "immediately before unlink");
  if (peerPath !== null) {
    assertRegularFileSync(
      peerPath,
      identity,
      record.hash,
      label,
      "immediately before unlink",
    );
  }
  if (requirePrimaryAbsent && pathStateSync(primaryPath)) {
    throw migrationError(
      `${label} cannot be removed while its primary proof remains: ${primaryPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  unlinkSync(path);
  if (pathStateSync(path)) {
    throw migrationError(`${label} was replaced during unlink: ${path}`, "CONCURRENT_CHANGE");
  }
  await syncDirectory(dirname(path));
}

async function removeBriefPublicationProof(
  record,
  persist = null,
  beforeRemovalMutation = null,
  afterPersistence = null,
) {
  if (record.publicationProofPhase === "removed") return;
  if (record.publicationProofPhase === "present") {
    record.publicationProofPhase = "cleaning";
    if (persist) await persist();
  } else if (record.publicationProofPhase !== "cleaning") {
    throw migrationError(
      `Change Brief publication proof is not removable: ${record.destination}`,
      "CONCURRENT_CHANGE",
    );
  }
  if (beforeRemovalMutation) {
    await beforeRemovalMutation({
      label: "Change Brief publication proof",
      path: null,
      phase: "authority",
    });
  }

  let evidence = await inspectBriefPublicationProofs(record);
  if (!evidence.primary && !evidence.cleanup) {
    record.publicationProofIdentity = null;
    record.publicationProofCleanupPath = null;
    record.publicationProofCleanupIdentity = null;
    record.publicationProofPath = null;
    record.publicationProofPhase = "removed";
    if (persist) await persist();
    if (afterPersistence) await afterPersistence();
    return;
  }
  const identity = await assertBriefProofMatchesRecord(record, evidence, { allowCleanup: true });
  const cleanupPath = briefPublicationProofCleanupPath(record, identity);
  if (!evidence.cleanup) {
    if (!evidence.primary) {
      throw migrationError(
        `Change Brief publication cleanup lost its primary proof: ${record.destination}`,
        "CONCURRENT_CHANGE",
      );
    }
    await assertBriefPublicationBoundary(record, cleanupPath);
    try {
      await link(evidence.primary.path, cleanupPath);
    } catch (error) {
      throw migrationError(
        `Change Brief publication cleanup proof could not be created: ${cleanupPath}`,
        "CONCURRENT_CHANGE",
        [error.message],
      );
    }
    await syncDirectory(dirname(cleanupPath));
    evidence = await inspectBriefPublicationProofs(record);
    await assertBriefProofMatchesRecord(record, evidence, { allowCleanup: true });
    if (!evidence.primary || !evidence.cleanup) {
      throw migrationError(
        `Change Brief publication cleanup proof is incomplete: ${cleanupPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    record.publicationProofCleanupPath = cleanupPath;
    record.publicationProofCleanupIdentity = identity;
    if (persist) await persist();
  } else if (record.publicationProofCleanupPath === null) {
    record.publicationProofCleanupPath = cleanupPath;
    record.publicationProofCleanupIdentity = identity;
    if (persist) await persist();
  }

  evidence = await inspectBriefPublicationProofs(record);
  await assertBriefProofMatchesRecord(record, evidence, { allowCleanup: true });
  if (evidence.primary) {
    if (!evidence.cleanup) {
      throw migrationError(
        `Change Brief publication cleanup proof disappeared: ${cleanupPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    await unlinkBriefPublicationEvidence(
      record,
      evidence.primary.path,
      identity,
      "Change Brief publication proof",
      { peerPath: evidence.cleanup.path, beforeRemovalMutation },
    );
  }

  evidence = await inspectBriefPublicationProofs(record);
  await assertBriefProofMatchesRecord(record, evidence, { allowCleanup: true });
  if (evidence.primary) {
    throw migrationError(
      `Change Brief publication primary proof survived cleanup: ${evidence.primary.path}`,
      "CONCURRENT_CHANGE",
    );
  }
  if (evidence.cleanup) {
    await unlinkBriefPublicationEvidence(
      record,
      evidence.cleanup.path,
      identity,
      "Change Brief publication cleanup proof",
      { requirePrimaryAbsent: true, beforeRemovalMutation },
    );
  }
  if (beforeRemovalMutation) {
    await beforeRemovalMutation({
      label: "Change Brief publication proof",
      path: null,
      phase: "retired",
    });
  }
  record.publicationProofIdentity = null;
  record.publicationProofCleanupPath = null;
  record.publicationProofCleanupIdentity = null;
  record.publicationProofPath = null;
  record.publicationProofPhase = "removed";
  if (persist) await persist();
  if (afterPersistence) await afterPersistence();
}

async function publishFileWithoutReplace(
  path,
  source,
  stagedPath,
  record,
  beforeLink = null,
  assertStaging = null,
  persistStaging = null,
  linkFile = link,
  afterStagingWriteReceipt = null,
  afterStagingProof = null,
  afterPublicationProof = null,
) {
  const assertPublicationBoundary = async () => {
    if (assertStaging) await assertStaging();
    await assertStoredDirectoryAnchor(record.ownerRoot, record.ownerAnchor, "Change Brief owner");
    if (!(await isPathPhysicallyInside(record.ownerAnchor.physicalPath, path))) {
      throw migrationError(`Change Brief destination escapes its owner: ${path}`, "UNSAFE_ARTIFACT_PATH");
    }
  };
  await assertPublicationBoundary();
  if (await inspectBriefStagingProof(record)) {
    throw migrationError(
      `Staged Change Brief identity proof already exists: ${record.stagedPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  await mkdir(dirname(path), { recursive: true });
  await assertPublicationBoundary();
  const handle = await open(stagedPath, "wx", 0o600);
  let stagedIdentity = null;
  try {
    const createdState = await handle.stat();
    if (!createdState.isFile()) {
      throw migrationError(`Staged Change Brief is not a regular file: ${stagedPath}`, "CONCURRENT_CHANGE");
    }
    stagedIdentity = fileIdentity(createdState);
    await handle.writeFile(source);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await assertPublicationBoundary();
  const stagingBinding = await createBriefStagingBinding(record, stagedIdentity);
  if (afterStagingWriteReceipt) {
    await afterStagingWriteReceipt({
      record,
      path: stagedPath,
      bindingPath: record.stagingBindingPath,
      identity: stagingBinding.targetIdentity,
    });
  }
  await assertPublicationBoundary();
  const stagingProof = await createBriefStagingProof(record, stagedIdentity);
  record.stagedIdentity = stagingProof.identity;
  record.stagingProofIdentity = stagingProof.identity;
  record.stagingProofPath = stagingProof.path;
  record.phase = "prepared";
  if (afterStagingProof) {
    await afterStagingProof({
      record,
      path: stagedPath,
      proofPath: stagingProof.path,
      identity: stagingProof.identity,
    });
  }
  await assertPublicationBoundary();
  const authenticatedStagingProof = await inspectBriefStagingProof(record);
  if (!authenticatedStagingProof
    || !sameFileIdentity(authenticatedStagingProof.identity, stagedIdentity)) {
    throw migrationError(
      `Staged Change Brief identity proof changed before persistence: ${stagedPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  await assertBriefStagedFileMatchesProof(record, authenticatedStagingProof);
  if (persistStaging) await persistStaging();
  if (beforeLink) await beforeLink({ path, stagedPath });
  await assertPublicationBoundary();
  const publicationLink = async (sourcePath, targetPath) => {
    await linkFile(sourcePath, targetPath);
    const targetState = await pathState(targetPath);
    if (!targetState?.isFile() || targetState.isSymbolicLink()) {
      throw migrationError(
        `Change Brief hardlink publication is not a regular file: ${targetPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    await reserveBriefPublicationProof(record, {
      identity: fileIdentity(targetState),
      hash: record.hash,
      method: "link",
    });
  };
  const published = await transferRegularFileWithoutReplace(stagedPath, path, {
    expectedHash: record.hash,
    expectedSourceIdentity: record.stagedIdentity,
    label: "Change Brief publication",
    beforeMutation: assertPublicationBoundary,
    linkFile: publicationLink,
    afterTargetCreate: (publication) => reserveBriefPublicationProof(record, publication),
    afterTargetWrite: async (publication) => {
      await createBriefPublicationBinding(record, publication);
      await createBriefPublicationProof(record, publication);
      record.publishedIdentity = publication.identity;
      record.published = true;
      record.phase = "published";
      if (afterPublicationProof) {
        await afterPublicationProof({
          record,
          path,
          proofPath: record.publicationProofPath,
          ...publication,
        });
      }
    },
  });
  if (!sameFileIdentity(published.identity, record.publicationProofIdentity)
    || !record.publicationBindingAuthenticated
    || !sameFileIdentity(published.identity, record.publicationBindingTargetIdentity)
    || record.publicationProofPhase !== "present") {
    throw migrationError(
      `Change Brief publication proof changed before persistence: ${path}`,
      "CONCURRENT_CHANGE",
    );
  }
  if (persistStaging) await persistStaging();
}

function serializeDestinationGuards(guards) {
  return guards.map((guard) => ({
    destination: guard.destination,
    canonicalHash: guard.canonicalHash,
    existing: guard.existing,
  }));
}

function serializeJournalDestinationGuards(state) {
  const changesByDestination = new Map(
    state.publishedChanges.map((record) => [resolve(record.destination), record]),
  );
  return state.destinationGuards.map((guard) => {
    const change = changesByDestination.get(resolve(guard.destination));
    const proofIdentity = guard.existing
      ? guard.proofIdentity
      : change?.proofIdentity ?? null;
    const proofPhase = guard.existing
      ? guard.proofPhase
      : proofIdentity === null ? "pending" : "present";
    return {
      destination: guard.destination,
      canonicalHash: guard.canonicalHash,
      existing: guard.existing,
      proofIdentity,
      proofPhase,
    };
  });
}
function destinationManifestSource(guards) {
  return `${JSON.stringify({
    version: MIGRATION_DESTINATION_MANIFEST_VERSION,
    canonicalChangeHashScheme: CANONICAL_CHANGE_HASH_SCHEME,
    destinationGuards: serializeDestinationGuards(guards),
  }, null, 2)}\n`;
}

function destinationManifestWitnessPath(destinationWorkspaceRoot, stagingRoot) {
  const { configRoot } = transactionStorePaths(destinationWorkspaceRoot);
  return join(configRoot, `${basename(stagingRoot)}-destinations`);
}

function destinationManifestDigestPath(destinationWorkspaceRoot, stagingRoot) {
  const { configRoot } = transactionStorePaths(destinationWorkspaceRoot);
  return join(configRoot, `${basename(stagingRoot)}-destinations.digest`);
}

function destinationManifestDigestSource(guards) {
  return `${sourceHash(destinationManifestSource(guards))}\n`;
}

function sourceDerivedManifestWitnessPath(destinationWorkspaceRoot, stagingRoot) {
  const { configRoot } = transactionStorePaths(destinationWorkspaceRoot);
  return join(configRoot, `${basename(stagingRoot)}-source-derived-destinations`);
}

function sourceDerivedManifestDigestPath(destinationWorkspaceRoot, stagingRoot) {
  const { configRoot } = transactionStorePaths(destinationWorkspaceRoot);
  return join(configRoot, `${basename(stagingRoot)}-source-derived-destinations.digest`);
}

function sourceDerivedManifestSource(snapshot) {
  const { changes, briefs } = JSON.parse(snapshot);
  return `${JSON.stringify({
    version: MIGRATION_SOURCE_DERIVED_MANIFEST_VERSION,
    canonicalChangeHashScheme: CANONICAL_CHANGE_HASH_SCHEME,
    changes,
    briefs,
  }, null, 2)}\n`;
}

function sourceDerivedManifestDigestSource(snapshot) {
  return `${sourceHash(sourceDerivedManifestSource(snapshot))}\n`;
}




async function writeDestinationManifest(
  state,
  {
    afterDestinationManifestCreate = null,
    afterDestinationManifestDigestCreate = null,
    afterDestinationManifestWitnessCreate = null,
  } = {},
) {
  const manifestSource = destinationManifestSource(state.destinationGuards);
  const digestSource = destinationManifestDigestSource(state.destinationGuards);
  const manifestPath = state.destinationManifestPath;
  const digestPath = state.destinationManifestDigestPath;
  const witnessPath = state.destinationManifestWitnessPath;
  for (const [path, label] of [
    [digestPath, "Destination manifest digest"],
    [witnessPath, "Destination manifest witness"],
  ]) {
    if (resolve(dirname(path)) !== resolve(state.storeAnchors.config.logicalPath)
      || !(await isPathPhysicallyInside(state.storeAnchors.config.physicalPath, path))) {
      throw migrationError(
        `${label} escapes its configuration store: ${path}`,
        "UNSAFE_ARTIFACT_PATH",
      );
    }
  }

  await assertTransactionStoreAnchors(state);
  if (state.destinationManifestPhase === "pending") {
    if (await pathState(manifestPath)) {
      throw migrationError(
        `Unannounced destination manifest must be preserved: ${manifestPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    state.destinationManifestPhase = "creating";
    await persistTransaction(state);
  }
  if (state.destinationManifestPhase === "creating") {
    let manifestState = await pathState(manifestPath);
    if (!manifestState) {
      const handle = await open(manifestPath, "wx", 0o400);
      try {
        const created = await handle.stat();
        if (!created.isFile()) {
          throw migrationError(
            `Destination manifest reservation is not a regular file: ${manifestPath}`,
            "CONCURRENT_CHANGE",
          );
        }
        await handle.writeFile(manifestSource);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await syncDirectory(state.stagingRoot);
      manifestState = await pathState(manifestPath);
      if (afterDestinationManifestCreate) {
        await afterDestinationManifestCreate({ state, path: manifestPath });
      }
    }
    if (!manifestState?.isFile()
      || manifestState.isSymbolicLink()
      || (manifestState.mode & 0o222) !== 0
      || await readFile(manifestPath, "utf8").catch(() => null) !== manifestSource) {
      throw migrationError(
        `Destination manifest creation state is not transaction-owned: ${manifestPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    state.destinationManifestIdentity = fileIdentity(manifestState);
    state.destinationManifestPhase = "present";
    await persistTransaction(state);
  }
  const manifestState = await pathState(manifestPath);
  if (state.destinationManifestPhase !== "present"
    || !manifestState?.isFile()
    || manifestState.isSymbolicLink()
    || (manifestState.mode & 0o222) !== 0
    || !sameFileIdentity(fileIdentity(manifestState), state.destinationManifestIdentity)
    || await readFile(manifestPath, "utf8").catch(() => null) !== manifestSource) {
    throw migrationError(
      `Destination manifest changed after publication: ${manifestPath}`,
      "CONCURRENT_CHANGE",
    );
  }

  await assertTransactionStoreAnchors(state);
  if (state.destinationManifestDigestPhase === "pending") {
    if (await pathState(digestPath)) {
      throw migrationError(
        `Unannounced destination manifest digest must be preserved: ${digestPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    state.destinationManifestDigestPhase = "creating";
    await persistTransaction(state);
  }
  if (state.destinationManifestDigestPhase === "creating") {
    let digestState = await pathState(digestPath);
    if (!digestState) {
      const handle = await open(digestPath, "wx", 0o400);
      try {
        const created = await handle.stat();
        if (!created.isFile()) {
          throw migrationError(
            `Destination manifest digest reservation is not a regular file: ${digestPath}`,
            "CONCURRENT_CHANGE",
          );
        }
        await handle.writeFile(digestSource);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await syncDirectory(dirname(digestPath));
      digestState = await pathState(digestPath);
      if (afterDestinationManifestDigestCreate) {
        await afterDestinationManifestDigestCreate({ state, path: digestPath });
      }
    }
    if (!digestState?.isFile()
      || digestState.isSymbolicLink()
      || (digestState.mode & 0o222) !== 0
      || await readFile(digestPath, "utf8").catch(() => null) !== digestSource) {
      throw migrationError(
        `Destination manifest digest creation state is not transaction-owned: ${digestPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    state.destinationManifestDigestIdentity = fileIdentity(digestState);
    state.destinationManifestDigestPhase = "present";
    await persistTransaction(state);
  }
  const digestState = await pathState(digestPath);
  if (state.destinationManifestDigestPhase !== "present"
    || !digestState?.isFile()
    || digestState.isSymbolicLink()
    || (digestState.mode & 0o222) !== 0
    || !sameFileIdentity(fileIdentity(digestState), state.destinationManifestDigestIdentity)
    || await readFile(digestPath, "utf8").catch(() => null) !== digestSource) {
    throw migrationError(
      `Destination manifest digest changed after publication: ${digestPath}`,
      "CONCURRENT_CHANGE",
    );
  }

  await assertTransactionStoreAnchors(state);
  if (state.destinationManifestWitnessPhase === "pending") {
    if (await pathState(witnessPath)) {
      throw migrationError(
        `Unannounced destination manifest witness must be preserved: ${witnessPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    state.destinationManifestWitnessPhase = "creating";
    await persistTransaction(state);
  }
  if (state.destinationManifestWitnessPhase === "creating") {
    let witnessState = await pathState(witnessPath);
    if (!witnessState) {
      await link(manifestPath, witnessPath);
      await syncDirectory(dirname(witnessPath));
      witnessState = await pathState(witnessPath);
      if (afterDestinationManifestWitnessCreate) {
        await afterDestinationManifestWitnessCreate({ state, path: witnessPath });
      }
    }
    if (!witnessState?.isFile()
      || witnessState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(witnessState), state.destinationManifestIdentity)) {
      throw migrationError(
        `Destination manifest witness creation state is not transaction-owned: ${witnessPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    state.destinationManifestWitnessIdentity = fileIdentity(witnessState);
    state.destinationManifestWitnessPhase = "present";
    await persistTransaction(state);
  }
  const witnessState = await pathState(witnessPath);
  if (state.destinationManifestWitnessPhase !== "present"
    || !witnessState?.isFile()
    || witnessState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(witnessState), state.destinationManifestWitnessIdentity)
    || !sameFileIdentity(fileIdentity(witnessState), state.destinationManifestIdentity)) {
    throw migrationError(
      "Destination manifest could not be bound to its external transaction witness.",
      "CONCURRENT_CHANGE",
    );
  }
}

async function writeSourceDerivedManifest(state, snapshot) {
  await assertTransactionStoreAnchors(state);
  const manifestSource = sourceDerivedManifestSource(snapshot);
  const handle = await open(state.sourceDerivedManifestPath, "wx", 0o400);
  const createdManifestState = await handle.stat();
  if (!createdManifestState.isFile()) {
    await handle.close();
    throw migrationError(
      "Source-derived manifest reservation is not a regular file.",
      "CONCURRENT_CHANGE",
    );
  }
  const manifestIdentity = fileIdentity(createdManifestState);
  try {
    await handle.writeFile(manifestSource);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(state.stagingRoot);

  const digestPath = sourceDerivedManifestDigestPath(
    state.destinationWorkspaceRoot,
    state.stagingRoot,
  );
  const witnessPath = sourceDerivedManifestWitnessPath(
    state.destinationWorkspaceRoot,
    state.stagingRoot,
  );
  for (const [path, label] of [
    [digestPath, "Source-derived manifest digest"],
    [witnessPath, "Source-derived manifest witness"],
  ]) {
    if (resolve(dirname(path)) !== resolve(state.storeAnchors.config.logicalPath)
      || !(await isPathPhysicallyInside(state.storeAnchors.config.physicalPath, path))) {
      throw migrationError(
        `${label} escapes its configuration store: ${path}`,
        "UNSAFE_ARTIFACT_PATH",
      );
    }
  }

  await assertTransactionStoreAnchors(state);
  const digestSource = sourceDerivedManifestDigestSource(snapshot);
  const digestHandle = await open(digestPath, "wx", 0o400);
  const createdDigestState = await digestHandle.stat();
  if (!createdDigestState.isFile()) {
    await digestHandle.close();
    throw migrationError(
      "Source-derived manifest digest reservation is not a regular file.",
      "CONCURRENT_CHANGE",
    );
  }
  const digestIdentity = fileIdentity(createdDigestState);
  try {
    await digestHandle.writeFile(digestSource);
    await digestHandle.sync();
  } finally {
    await digestHandle.close();
  }
  await syncDirectory(dirname(digestPath));
  await assertTransactionStoreAnchors(state);
  await link(state.sourceDerivedManifestPath, witnessPath);
  await syncDirectory(dirname(witnessPath));

  const [manifestState, witnessState, digestState] = await Promise.all([
    pathState(state.sourceDerivedManifestPath),
    pathState(witnessPath),
    pathState(digestPath),
  ]);
  if (!manifestState?.isFile() || manifestState.isSymbolicLink()
    || (manifestState.mode & 0o222) !== 0
    || !sameFileIdentity(fileIdentity(manifestState), manifestIdentity)
    || !witnessState?.isFile() || witnessState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(manifestState), fileIdentity(witnessState))
    || !sameFileIdentity(fileIdentity(witnessState), manifestIdentity)
    || !digestState?.isFile() || digestState.isSymbolicLink()
    || (digestState.mode & 0o222) !== 0
    || !sameFileIdentity(fileIdentity(digestState), digestIdentity)
    || await readFile(state.sourceDerivedManifestPath, "utf8").catch(() => null)
      !== manifestSource
    || await readFile(digestPath, "utf8").catch(() => null) !== digestSource) {
    throw migrationError(
      "Source-derived manifest could not be bound to its external transaction witness.",
      "CONCURRENT_CHANGE",
    );
  }
  state.sourceDerivedDestinationGuards = snapshot;
  state.sourceDerivedManifestWitnessPath = witnessPath;
  state.sourceDerivedManifestWitnessIdentity = manifestIdentity;
  state.sourceDerivedManifestDigestPath = digestPath;
  state.sourceDerivedManifestDigestIdentity = digestIdentity;
}

function serializeTransaction(
  state,
  {
    journalWriteIdentity,
    journalWriteCleanupIdentity,
    journalCanonicalIdentity,
    journalPreviousIdentity,
    journalPreviousHash,
    journalWriteAuthorityIdentity,
  },
) {
  return {
    version: MIGRATION_JOURNAL_VERSION,
    canonicalChangeHashScheme: CANONICAL_CHANGE_HASH_SCHEME,
    journalWriteIdentity,
    journalWriteCleanupIdentity,
    journalCanonicalIdentity,
    journalPreviousIdentity,
    journalPreviousHash,
    journalWriteAuthorityIdentity,
    status: state.status,
    workspaceAnchor: state.workspaceAnchor,
    destinationWorkspaceRoot: resolve(state.destinationWorkspaceRoot),
    stagingRoot: state.stagingRoot,
    initializationPhase: state.initializationPhase,
    initializationReservationIdentity: state.initializationReservationIdentity,
    initializationBindingIdentity: state.initializationBindingIdentity,
    stagingIdentity: state.stagingIdentity,
    destinationManifestPhase: state.destinationManifestPhase,
    destinationManifestIdentity: state.destinationManifestIdentity,
    destinationManifestWitnessPhase: state.destinationManifestWitnessPhase,
    destinationManifestDigestPhase: state.destinationManifestDigestPhase,
    destinationManifestWitnessIdentity: state.destinationManifestWitnessIdentity,
    destinationManifestDigestIdentity: state.destinationManifestDigestIdentity,
    sourceDerivedManifestWitnessIdentity: state.sourceDerivedManifestWitnessIdentity,
    sourceDerivedManifestDigestIdentity: state.sourceDerivedManifestDigestIdentity,
    sourceDerivedDestinationGuards: state.sourceDerivedDestinationGuards,
    stagingRemovalRoot: state.stagingRemovalRoot,
    stagingRemovalManifest: state.stagingRemovalManifest,
    stagingRemovalProgress: state.stagingRemovalProgress,
    terminalCleanupPlan: state.terminalCleanupPlan,
    readGuards: state.readGuards.map((guard) => ({
      kind: guard.kind,
      ownerRoot: guard.ownerRoot,
      ownerAnchor: guard.ownerAnchor,
      ownerBinding: guard.ownerBinding,
      path: guard.path,
      hash: guard.hash,
      source: guard.source,
      identity: guard.identity,
      mode: guard.mode,
      proofIdentity: guard.proofIdentity,
      proofPhase: guard.proofPhase,
    })),
    destinationGuards: serializeJournalDestinationGuards(state),
    changes: state.publishedChanges.map((record) => ({
      changeId: record.changeId,
      spaceId: record.spaceId,
      repositories: record.repositories,
      closed: record.closed,
      sources: record.sources,
      existing: Boolean(record.existing),
      destination: record.destination,
      canonicalHash: record.canonicalHash,
      canonicalTasksSource: record.canonicalTasksSource,
      proofPath: record.proofPath,
      stagedPath: record.stagedPath,
      stagingPath: record.stagingPath,
      stagingIdentity: record.stagingIdentity,
      stagedIdentity: record.stagedIdentity,
      proofIdentity: record.proofIdentity,
      tasksCanonicalizationPhase: record.tasksCanonicalizationPhase,
      tasksCanonicalizationOriginalIdentity: record.tasksCanonicalizationOriginalIdentity,
      tasksCanonicalizationOriginalHash: record.tasksCanonicalizationOriginalHash,
      tasksCanonicalizationIdentity: record.tasksCanonicalizationIdentity,
      ownerToken: record.ownerToken,
      reservationIdentity: record.reservationIdentity,
      reservationIntentIdentity: record.reservationIntentIdentity,
      reservationBindingIdentity: record.reservationBindingIdentity,
      reservationLockProofIdentity: record.reservationLockProofIdentity,
      reserved: record.reserved,
      published: record.published,
      copyRoot: record.copyRoot,
      copySourceRoot: record.copySourceRoot,
      copySourceManifest: record.copySourceManifest,
      copyTargetManifest: record.copyTargetManifest,
      copyProvenanceToken: record.copyProvenanceToken,
      copyTargetProvenance: record.copyTargetProvenance,
      copyIntent: record.copyIntent,
      removalMode: record.removalMode,
      removalRoot: record.removalRoot,
      removalManifest: record.removalManifest,
      removalProgress: record.removalProgress,
      phase: record.phase,
    })),
    briefs: state.publishedBriefs.map((record) => ({
      kind: record.kind,
      spaceId: record.spaceId,
      sourcePath: record.sourcePath,
      source: Buffer.from(record.source).toString("base64"),
      destination: record.destination,
      ownerRoot: record.ownerRoot,
      ownerAnchor: record.ownerAnchor,
      stagedPath: record.stagedPath,
      stagedIdentity: record.stagedIdentity,
      stagingProofIdentity: record.stagingProofIdentity,
      briefIntentIdentity: record.briefIntentIdentity,
      stagingBindingIdentity: record.stagingBindingIdentity,
      publicationBindingIdentity: record.publicationBindingIdentity,
      publishedIdentity: record.publishedIdentity,
      publicationProofIdentity: record.publicationProofIdentity,
      publicationProofCleanupPath: record.publicationProofCleanupPath,
      publicationProofCleanupIdentity: record.publicationProofCleanupIdentity,
      publicationProofPhase: record.publicationProofPhase,
      hash: record.hash,
      published: record.published,
      phase: record.phase,
    })),
    configs: state.writtenConfigs.map((record) => ({
      kind: record.kind,
      path: record.path,
      ownerRoot: record.ownerRoot,
      ownerAnchor: record.ownerAnchor,
      originalSource: record.originalSource,
      originalIdentity: record.originalIdentity,
      originalMode: record.originalMode,
      originalOwnerBinding: record.originalOwnerBinding,
      originalHash: record.originalHash,
      nextSource: record.nextSource,
      nextHash: record.nextHash,
      fromVersion: record.fromVersion,
      fromSchema: record.fromSchema,
      toVersion: record.toVersion,
      toSchema: record.toSchema,
      authenticatedOriginalSource: record.authenticatedOriginalSource,
      authenticatedOriginalHash: record.authenticatedOriginalHash,
      authenticatedNextHash: record.authenticatedNextHash,
      originalPath: record.originalPath,
      nextPath: record.nextPath,
      originalStagedIdentity: record.originalStagedIdentity,
      nextStagedIdentity: record.nextStagedIdentity,
      originalWriteTemporary: record.originalWriteTemporary,
      originalWriteTemporaryIdentity: record.originalWriteTemporaryIdentity,
      nextWriteTemporary: record.nextWriteTemporary,
      nextWriteTemporaryIdentity: record.nextWriteTemporaryIdentity,
      replacementTemporary: record.replacementTemporary,
      replacementBackup: record.replacementBackup,
      originalProofCleanupPath: record.originalProofCleanupPath,
      originalProofCleanupIdentity: record.originalProofCleanupIdentity,
      nextProofCleanupPath: record.nextProofCleanupPath,
      nextProofCleanupIdentity: record.nextProofCleanupIdentity,
      nextProofIntentIdentity: record.nextProofIntentIdentity,
      restoredIdentity: record.restoredIdentity,
      proofPhase: record.proofPhase,
      phase: record.phase,
    })),
    sources: state.removedSources.map((record) => ({
      path: record.path,
      hash: record.hash,
      ownerRoot: record.ownerRoot,
      backupProofToken: record.backupProofToken,
      backupProofRoot: record.backupProofRoot,
      backupProofRootIdentity: record.backupProofRootIdentity,
      backupProofOwnerPath: record.backupProofOwnerPath,
      backupProofOwnerIdentity: record.backupProofOwnerIdentity,
      backupProofReceiptPath: record.backupProofReceiptPath,
      backupProofReceiptIdentity: record.backupProofReceiptIdentity,
      backupProofOwnerCleanupPath: record.backupProofOwnerCleanupPath,
      backupProofOwnerCleanupIdentity: record.backupProofOwnerCleanupIdentity,
      backupProofReceiptCleanupPath: record.backupProofReceiptCleanupPath,
      backupProofReceiptCleanupIdentity: record.backupProofReceiptCleanupIdentity,
      backupEntryProvenance: record.backupEntryProvenance,
      backupProofPhase: record.backupProofPhase,
      backupProofRemovalManifest: record.backupProofRemovalManifest,
      backupProofRemovalProgress: record.backupProofRemovalProgress,
      physicalPath: record.physicalPath,
      identity: record.identity,
      ownerPhysicalPath: record.ownerPhysicalPath,
      ownerIdentity: record.ownerIdentity,
      backup: record.backup,
      backupIdentity: record.backupIdentity,
      backupMode: record.backupMode,
      backupPayloadIdentity: record.backupPayloadIdentity,
      restoreIdentity: record.restoreIdentity,
      restoreReservationToken: record.restoreReservationToken,
      restoreIntentIdentity: record.restoreIntentIdentity,
      restoreCopyRoot: record.restoreCopyRoot,
      restoreCopySourceRoot: record.restoreCopySourceRoot,
      restoreCopySourceManifest: record.restoreCopySourceManifest,
      restoreCopyTargetManifest: record.restoreCopyTargetManifest,
      restoreCopyProvenanceToken: record.restoreCopyProvenanceToken,
      restoreCopyTargetProvenance: record.restoreCopyTargetProvenance,
      restoreCopyIntent: record.restoreCopyIntent,
      cleanupPath: record.cleanupPath,
      cleanupIdentity: record.cleanupIdentity,
      cleanupMode: record.cleanupMode,
      removalMode: record.removalMode,
      removalRoot: record.removalRoot,
      removalManifest: record.removalManifest,
      removalProgress: record.removalProgress,
      copyRoot: record.copyRoot,
      copySourceRoot: record.copySourceRoot,
      copySourceManifest: record.copySourceManifest,
      copyTargetManifest: record.copyTargetManifest,
      copyIntent: record.copyIntent,
      phase: record.phase,
    })),
  };
}

function journalAuthoritySnapshot(journal) {
  return {
    version: journal.version,
    canonicalChangeHashScheme: journal.canonicalChangeHashScheme,
    workspaceAnchor: journal.workspaceAnchor,
    destinationWorkspaceRoot: journal.destinationWorkspaceRoot,
    stagingRoot: journal.stagingRoot,
    stagingIdentity: journal.stagingIdentity,
    sourceDerivedDestinationGuards: journal.sourceDerivedDestinationGuards,
    readGuards: journal.readGuards?.map((record) => ({
      kind: record.kind,
      ownerRoot: record.ownerRoot,
      ownerAnchor: record.ownerAnchor,
      ownerBinding: record.ownerBinding,
      path: record.path,
      hash: record.hash,
      source: record.source,
      identity: record.identity,
      mode: record.mode,
    })),
    destinationGuards: journal.destinationGuards?.map((record) => ({
      destination: record.destination,
      canonicalHash: record.canonicalHash,
      existing: record.existing,
      proofPath: record.proofPath,
    })),
    changes: journal.changes?.map((record) => ({
      changeId: record.changeId,
      spaceId: record.spaceId,
      repositories: record.repositories,
      closed: record.closed,
      sources: record.sources,
      destination: record.destination,
      canonicalHash: record.canonicalHash,
      canonicalTasksSource: record.canonicalTasksSource,
      existing: record.existing,
      stagedPath: record.stagedPath,
      stagingPath: record.stagingPath,
      proofPath: record.proofPath,
      ownerToken: record.ownerToken,
    })),
    briefs: journal.briefs?.map((record) => ({
      kind: record.kind,
      spaceId: record.spaceId,
      sourcePath: record.sourcePath,
      source: record.source,
      destination: record.destination,
      ownerRoot: record.ownerRoot,
      ownerAnchor: record.ownerAnchor,
      stagedPath: record.stagedPath,
      hash: record.hash,
    })),
    configs: journal.configs?.map((record) => ({
      kind: record.kind,
      path: record.path,
      ownerRoot: record.ownerRoot,
      ownerAnchor: record.ownerAnchor,
      originalSource: record.originalSource,
      originalIdentity: record.originalIdentity,
      originalMode: record.originalMode,
      originalOwnerBinding: record.originalOwnerBinding,
      originalHash: record.originalHash,
      nextSource: record.nextSource,
      nextHash: record.nextHash,
      fromVersion: record.fromVersion,
      fromSchema: record.fromSchema,
      toVersion: record.toVersion,
      toSchema: record.toSchema,
      originalPath: record.originalPath,
      nextPath: record.nextPath,
    })),
    sources: journal.sources?.map((record) => ({
      path: record.path,
      hash: record.hash,
      ownerRoot: record.ownerRoot,
      physicalPath: record.physicalPath,
      identity: record.identity,
      ownerPhysicalPath: record.ownerPhysicalPath,
      ownerIdentity: record.ownerIdentity,
      backup: record.backup,
      backupProofToken: record.backupProofToken,
      backupProofRoot: record.backupProofRoot,
      backupProofOwnerPath: record.backupProofOwnerPath,
      backupProofReceiptPath: record.backupProofReceiptPath,
      backupProofOwnerCleanupPath: record.backupProofOwnerCleanupPath,
      backupProofReceiptCleanupPath: record.backupProofReceiptCleanupPath,
    })),
  };
}

function journalRecordShapes(journal) {
  return Object.fromEntries(
    ["changes", "briefs", "configs", "sources"].map((property) => [
      property,
      journal[property]?.map((record) => Object.keys(record).sort()),
    ]),
  );
}
function matchingNullableIdentity(left, right) {
  return left === null ? right === null : right !== null && sameFileIdentity(left, right);
}

function journalWriteAuthoritySource(record) {
  return `${JSON.stringify(record, null, 2)}\n`;
}

function requireJournalWriteAuthorityRecord(record, journalPath) {
  requireExactJournalKeys(
    record,
    [
      "version",
      "authorityIdentity",
      "stagingRoot",
      "journalPath",
      "candidatePath",
      "candidateIdentity",
      "candidateHash",
      "candidateSource",
      "canonicalIdentity",
      "previousIdentity",
      "previousHash",
      "previousSource",
      "cleanupIdentity",
      "initializationReservationIdentity",
      "initializationBindingIdentity",
      "stagingIdentity",
      "destinationManifestWitnessIdentity",
      "destinationManifestDigestIdentity",
    ],
    "journal write authority",
    journalPath,
  );
  if (record.version !== MIGRATION_JOURNAL_WRITE_AUTHORITY_VERSION) {
    throw journalFailure(journalPath, "Transaction journal write authority version is unsupported.");
  }
  for (const [value, label] of [
    [record.stagingRoot, "journal write authority stagingRoot"],
    [record.journalPath, "journal write authority journalPath"],
    [record.candidatePath, "journal write authority candidatePath"],
  ]) {
    requireJournalString(value, label, journalPath);
  }
  for (const [value, label, nullable] of [
    [record.authorityIdentity, "journal write authority authorityIdentity", false],
    [record.candidateIdentity, "journal write authority candidateIdentity", false],
    [record.canonicalIdentity, "journal write authority canonicalIdentity", false],
    [record.previousIdentity, "journal write authority previousIdentity", true],
    [record.cleanupIdentity, "journal write authority cleanupIdentity", false],
    [
      record.initializationReservationIdentity,
      "journal write authority initializationReservationIdentity",
      true,
    ],
    [
      record.initializationBindingIdentity,
      "journal write authority initializationBindingIdentity",
      true,
    ],
    [record.stagingIdentity, "journal write authority stagingIdentity", false],
    [
      record.destinationManifestWitnessIdentity,
      "journal write authority destinationManifestWitnessIdentity",
      true,
    ],
    [
      record.destinationManifestDigestIdentity,
      "journal write authority destinationManifestDigestIdentity",
      true,
    ],
  ]) {
    requireJournalIdentity(value, label, journalPath, { nullable });
  }
  if (typeof record.candidateSource !== "string"
    || typeof record.candidateHash !== "string"
    || sourceHash(record.candidateSource) !== record.candidateHash) {
    throw journalFailure(
      journalPath,
      "Transaction journal write authority does not bind its exact candidate source.",
    );
  }
  if (record.previousIdentity === null) {
    if (record.previousHash !== null
      || record.previousSource !== null
      || record.initializationReservationIdentity === null
      || record.initializationBindingIdentity === null
      || !sameFileIdentity(record.canonicalIdentity, record.candidateIdentity)) {
      throw journalFailure(
        journalPath,
        "First transaction journal publication has incoherent prior authority.",
      );
    }
  } else if (typeof record.previousHash !== "string"
    || typeof record.previousSource !== "string"
    || sourceHash(record.previousSource) !== record.previousHash
    || !sameFileIdentity(record.canonicalIdentity, record.previousIdentity)) {
    throw journalFailure(
      journalPath,
      "Transaction journal replacement has incoherent prior authority.",
    );
  }
}

function journalsShareImmutableAuthority(previousJournal, candidateJournal) {
  if (JSON.stringify(Object.keys(candidateJournal).sort())
    !== JSON.stringify(Object.keys(previousJournal).sort())
    || JSON.stringify(journalRecordShapes(candidateJournal))
      !== JSON.stringify(journalRecordShapes(previousJournal))) {
    return false;
  }
  const previousAuthority = journalAuthoritySnapshot(previousJournal);
  const candidateAuthority = journalAuthoritySnapshot(candidateJournal);
  if (JSON.stringify(candidateAuthority) === JSON.stringify(previousAuthority)) return true;
  return previousAuthority.sourceDerivedDestinationGuards === null
    && typeof candidateAuthority.sourceDerivedDestinationGuards === "string"
    && JSON.stringify({
      ...candidateAuthority,
      sourceDerivedDestinationGuards: null,
    }) === JSON.stringify(previousAuthority);
}

async function inspectInterruptedJournalWrite(state) {
  const prefix = `.${basename(state.journalPath)}.sdd-write-`;
  const proofPath = join(state.stagingRoot, MIGRATION_JOURNAL_WRITE_PROOF_NAME);
  const authorityPath = join(state.stagingRoot, MIGRATION_JOURNAL_WRITE_AUTHORITY_NAME);
  const cleanupRoot = state.journalWriteCleanupPath ?? join(
    state.stagingRoot,
    MIGRATION_JOURNAL_WRITE_CLEANUP_DIRECTORY_NAME,
  );
  const temporaryCleanupPath = join(
    cleanupRoot,
    MIGRATION_JOURNAL_WRITE_TEMPORARY_CLEANUP_NAME,
  );
  const proofCleanupPath = join(
    cleanupRoot,
    MIGRATION_JOURNAL_WRITE_PROOF_CLEANUP_NAME,
  );
  const authorityCleanupPath = join(
    cleanupRoot,
    MIGRATION_JOURNAL_WRITE_AUTHORITY_CLEANUP_NAME,
  );
  const reservedNames = new Set([
    MIGRATION_JOURNAL_WRITE_PROOF_NAME,
    MIGRATION_JOURNAL_WRITE_AUTHORITY_NAME,
    MIGRATION_JOURNAL_WRITE_CLEANUP_DIRECTORY_NAME,
  ]);
  const entryNames = await readdir(state.stagingRoot);
  const temporaryNames = entryNames.filter(
    (name) => name.startsWith(prefix) && !reservedNames.has(name),
  );
  if (temporaryNames.length > 1) {
    throw journalFailure(
      state.journalPath,
      "Unowned transaction journal atomic-write state must be preserved.",
    );
  }
  const temporaryPath = temporaryNames.length === 1
    ? join(state.stagingRoot, temporaryNames[0])
    : null;
  if (temporaryPath) {
    const nonce = basename(temporaryPath).slice(prefix.length);
    if (!/^\d+-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(nonce)) {
      throw journalFailure(
        state.journalPath,
        "Transaction journal atomic temporary has an invalid reservation name.",
      );
    }
  }

  const cleanupRootState = await pathState(cleanupRoot);
  if (cleanupRootState
    && (!cleanupRootState.isDirectory()
      || cleanupRootState.isSymbolicLink()
      || (cleanupRootState.mode & 0o077) !== 0)) {
    throw journalFailure(
      state.journalPath,
      "Transaction journal cleanup reservation is not a real directory.",
    );
  }
  let cleanupEntries = [];
  if (cleanupRootState) {
    cleanupEntries = await readdir(cleanupRoot);
    const allowedEntries = new Set([
      MIGRATION_JOURNAL_WRITE_TEMPORARY_CLEANUP_NAME,
      MIGRATION_JOURNAL_WRITE_PROOF_CLEANUP_NAME,
      MIGRATION_JOURNAL_WRITE_AUTHORITY_CLEANUP_NAME,
    ]);
    const quarantineName = /^\.sdd-remove-\d+-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (cleanupEntries.some((name) => !allowedEntries.has(name) && !quarantineName.test(name))) {
      throw journalFailure(
        state.journalPath,
        "Transaction journal cleanup reservation contains unknown state.",
      );
    }
  }

  const artifactSpecs = [
    [temporaryPath, "candidate", "transaction journal atomic temporary"],
    [proofPath, "candidate", "transaction journal write proof"],
    [temporaryCleanupPath, "candidate", "transaction journal temporary cleanup"],
    [proofCleanupPath, "candidate", "transaction journal proof cleanup"],
    [authorityPath, "authority", "transaction journal prior-authority intent"],
    [authorityCleanupPath, "authority", "transaction journal prior-authority cleanup"],
    ...cleanupEntries
      .filter((name) => name.startsWith(".sdd-remove-"))
      .map((name) => [
        join(cleanupRoot, name),
        null,
        "transaction journal identity-bound removal quarantine",
      ]),
  ];
  const artifacts = [];
  for (const [path, role, label] of artifactSpecs) {
    if (!path) continue;
    const artifactState = await pathState(path);
    if (!artifactState) continue;
    if (!artifactState.isFile() || artifactState.isSymbolicLink()) {
      throw journalFailure(
        state.journalPath,
        "Unowned transaction journal atomic-write state must be preserved.",
      );
    }
    const source = await readFile(path, "utf8").catch(() => null);
    if (source === null) {
      throw journalFailure(state.journalPath, "Transaction journal recovery evidence is unreadable.");
    }
    artifacts.push({
      path,
      role,
      label,
      state: artifactState,
      identity: fileIdentity(artifactState),
      hash: sourceHash(source),
      source,
    });
  }
  if (artifacts.length > 0 && !cleanupRootState) {
    throw journalFailure(
      state.journalPath,
      "Unowned transaction journal atomic-write state must be preserved: cleanup reservation is missing.",
    );
  }
  if (artifacts.length === 0 && !cleanupRootState) return null;

  const journalState = await pathState(state.journalPath);
  if (journalState && (!journalState.isFile() || journalState.isSymbolicLink())) {
    throw journalFailure(state.journalPath, "Live transaction journal is not a regular file.");
  }
  if (artifacts.length === 0) {
    if (!journalState && state.journalWriteCleanupIdentity === undefined) return null;
    if (state.journalWriteCleanupIdentity !== null
      && state.journalWriteCleanupIdentity !== undefined
      && sameFileIdentity(
        state.journalWriteCleanupIdentity,
        fileIdentity(cleanupRootState),
      )) {
      return null;
    }
    let currentJournal;
    try {
      currentJournal = JSON.parse(await readFile(state.journalPath, "utf8"));
      requireJournalIdentity(
        currentJournal.journalWriteCleanupIdentity,
        "journal.journalWriteCleanupIdentity",
        state.journalPath,
      );
    } catch (error) {
      if (error?.code === "MUTATION_RECOVERY_FAILED") throw error;
      throw journalFailure(
        state.journalPath,
        `Transaction journal cleanup reservation lacks a live generation: ${error.message}`,
      );
    }
    if (!sameFileIdentity(
      currentJournal.journalWriteCleanupIdentity,
      fileIdentity(cleanupRootState),
    )) {
      throw journalFailure(
        state.journalPath,
        "Transaction journal cleanup reservation does not match the live generation.",
      );
    }
    return null;
  }

  if (state.journalWriteCleanupIdentity !== null
    && state.journalWriteCleanupIdentity !== undefined
    && !sameFileIdentity(
      state.journalWriteCleanupIdentity,
      fileIdentity(cleanupRootState),
    )) {
    throw journalFailure(
      state.journalPath,
      "Transaction journal recovery evidence changed its cleanup reservation.",
    );
  }

  let authorityArtifact = artifacts.find((artifact) => artifact.role === "authority") ?? null;
  if (!authorityArtifact) {
    authorityArtifact = artifacts.find((artifact) => {
      try {
        const value = JSON.parse(artifact.source);
        return value?.version === MIGRATION_JOURNAL_WRITE_AUTHORITY_VERSION
          && typeof value.candidateSource === "string";
      } catch {
        return false;
      }
    }) ?? null;
  }
  if (!authorityArtifact) {
    throw journalFailure(
      state.journalPath,
      "Transaction journal candidate lacks durable prior-authority intent.",
    );
  }
  let authority;
  try {
    authority = JSON.parse(authorityArtifact.source);
    requireJournalWriteAuthorityRecord(authority, state.journalPath);
  } catch (error) {
    if (error?.code === "MUTATION_RECOVERY_FAILED") throw error;
    throw journalFailure(
      state.journalPath,
      `Transaction journal prior-authority intent is invalid: ${error.message}`,
    );
  }
  const authorityIdentity = authorityArtifact.identity;
  const authorityHash = authorityArtifact.hash;
  const candidateNonce = basename(authority.candidatePath).slice(prefix.length);
  if (!sameFileIdentity(authority.authorityIdentity, authorityIdentity)
    || resolve(authority.stagingRoot) !== resolve(state.stagingRoot)
    || resolve(authority.journalPath) !== resolve(state.journalPath)
    || resolve(dirname(authority.candidatePath)) !== resolve(state.stagingRoot)
    || !/^\d+-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(candidateNonce)
    || (temporaryPath !== null
      && resolve(authority.candidatePath) !== resolve(temporaryPath))
    || !sameFileIdentity(authority.cleanupIdentity, fileIdentity(cleanupRootState))) {
    throw journalFailure(
      state.journalPath,
      "Transaction journal prior-authority intent escaped or changed its owner.",
    );
  }

  let candidateJournal;
  try {
    candidateJournal = JSON.parse(authority.candidateSource);
    requireJournalIdentity(
      candidateJournal.journalWriteIdentity,
      "journal.journalWriteIdentity",
      state.journalPath,
    );
    requireJournalIdentity(
      candidateJournal.journalWriteCleanupIdentity,
      "journal.journalWriteCleanupIdentity",
      state.journalPath,
    );
    requireJournalIdentity(
      candidateJournal.journalCanonicalIdentity,
      "journal.journalCanonicalIdentity",
      state.journalPath,
    );
    requireJournalIdentity(
      candidateJournal.journalPreviousIdentity,
      "journal.journalPreviousIdentity",
      state.journalPath,
      { nullable: true },
    );
    requireJournalIdentity(
      candidateJournal.journalWriteAuthorityIdentity,
      "journal.journalWriteAuthorityIdentity",
      state.journalPath,
    );
  } catch (error) {
    if (error?.code === "MUTATION_RECOVERY_FAILED") throw error;
    throw journalFailure(
      state.journalPath,
      `Transaction journal intended candidate is incomplete: ${error.message}`,
    );
  }
  if (!sameFileIdentity(candidateJournal.journalWriteIdentity, authority.candidateIdentity)
    || !sameFileIdentity(
      candidateJournal.journalWriteCleanupIdentity,
      authority.cleanupIdentity,
    )
    || !sameFileIdentity(
      candidateJournal.journalCanonicalIdentity,
      authority.canonicalIdentity,
    )
    || !matchingNullableIdentity(
      candidateJournal.journalPreviousIdentity,
      authority.previousIdentity,
    )
    || candidateJournal.journalPreviousHash !== authority.previousHash
    || !sameFileIdentity(
      candidateJournal.journalWriteAuthorityIdentity,
      authority.authorityIdentity,
    )
    || !matchingNullableIdentity(
      candidateJournal.initializationReservationIdentity,
      authority.initializationReservationIdentity,
    )
    || !matchingNullableIdentity(
      candidateJournal.initializationBindingIdentity,
      authority.initializationBindingIdentity,
    )
    || !sameFileIdentity(candidateJournal.stagingIdentity, authority.stagingIdentity)
    || !matchingNullableIdentity(
      candidateJournal.destinationManifestWitnessIdentity,
      authority.destinationManifestWitnessIdentity,
    )
    || !matchingNullableIdentity(
      candidateJournal.destinationManifestDigestIdentity,
      authority.destinationManifestDigestIdentity,
    )) {
    throw journalFailure(
      state.journalPath,
      "Transaction journal candidate does not match its prior-authority intent.",
    );
  }
  if (authority.previousIdentity !== null) {
    let previousJournal;
    try {
      previousJournal = JSON.parse(authority.previousSource);
      requireJournalIdentity(
        previousJournal.journalCanonicalIdentity,
        "prior journal.journalCanonicalIdentity",
        state.journalPath,
      );
    } catch (error) {
      if (error?.code === "MUTATION_RECOVERY_FAILED") throw error;
      throw journalFailure(
        state.journalPath,
        `Transaction journal prior generation is unreadable: ${error.message}`,
      );
    }
    if (!sameFileIdentity(previousJournal.journalCanonicalIdentity, authority.previousIdentity)
      || !journalsShareImmutableAuthority(previousJournal, candidateJournal)) {
      throw journalFailure(
        state.journalPath,
        "Transaction journal candidate does not share immutable prior authority.",
      );
    }
  }

  if (state.stagingIdentity !== undefined
    && !sameFileIdentity(state.stagingIdentity, authority.stagingIdentity)) {
    throw journalFailure(
      state.journalPath,
      "Transaction journal prior-authority intent changed its staging owner.",
    );
  }

  const candidateIdentity = authority.candidateIdentity;
  const candidateHash = authority.candidateHash;
  const candidateArtifacts = [];
  const authorityArtifacts = [];
  for (const artifact of artifacts) {
    const isCandidate = sameFileIdentity(artifact.identity, candidateIdentity)
      && artifact.hash === candidateHash
      && artifact.source === authority.candidateSource;
    const isAuthority = sameFileIdentity(artifact.identity, authorityIdentity)
      && artifact.hash === authorityHash
      && artifact.source === authorityArtifact.source;
    if ((artifact.role === "candidate" && !isCandidate)
      || (artifact.role === "authority" && !isAuthority)
      || (artifact.role === null && !isCandidate && !isAuthority)) {
      throw journalFailure(
        state.journalPath,
        "Transaction journal recovery evidence contains a forged or mismatched artifact.",
      );
    }
    if (isCandidate) candidateArtifacts.push(artifact);
    if (isAuthority) authorityArtifacts.push(artifact);
  }
  if (authorityArtifacts.length === 0) {
    throw journalFailure(
      state.journalPath,
      "Transaction journal prior-authority intent disappeared before recovery.",
    );
  }

  const liveIdentity = journalState ? fileIdentity(journalState) : null;
  const liveHash = journalState
    ? await hashFile(state.journalPath).catch(() => null)
    : null;
  const liveIsPublished = journalState !== null
    && sameFileIdentity(liveIdentity, authority.canonicalIdentity)
    && liveHash === candidateHash;
  if (authority.previousIdentity === null) {
    if (journalState && !liveIsPublished) {
      throw journalFailure(
        state.journalPath,
        "First transaction journal publication was replaced by another inode.",
      );
    }
  } else if (!journalState
    || !sameFileIdentity(liveIdentity, authority.previousIdentity)) {
    throw journalFailure(
      state.journalPath,
      "Live transaction journal does not match its durably bound prior identity.",
    );
  }
  const hasProofEvidence = candidateArtifacts.some(
    (artifact) => artifact.path === proofPath || artifact.path === proofCleanupPath,
  );
  if (!liveIsPublished && (!hasProofEvidence || candidateArtifacts.length === 0)) {
    throw journalFailure(
      state.journalPath,
      "Transaction journal candidate lacks its exact identity-bound write proof.",
    );
  }

  const candidatePath = candidateArtifacts[0]?.path ?? null;
  const candidateQuarantinePaths = candidateArtifacts
    .filter((artifact) => basename(artifact.path).startsWith(".sdd-remove-"))
    .map((artifact) => artifact.path);
  const authorityQuarantinePaths = authorityArtifacts
    .filter((artifact) => basename(artifact.path).startsWith(".sdd-remove-"))
    .map((artifact) => artifact.path);
  const inventory = artifacts.map((artifact) => ({
    path: artifact.path,
    label: artifact.label,
    kind: "file",
    expectedIdentity: artifact.identity,
    expectedHash: artifact.hash,
  }));
  inventory.push({
    path: cleanupRoot,
    label: "transaction journal cleanup reservation",
    kind: "directory",
    expectedIdentity: fileIdentity(cleanupRootState),
    expectedHash: null,
  });
  return {
    candidatePath,
    candidateSource: authority.candidateSource,
    candidateJournal,
    proofPath: candidateArtifacts.some((artifact) => artifact.path === proofPath)
      ? proofPath
      : null,
    temporaryPath,
    cleanupRoot,
    cleanupRootIdentity: fileIdentity(cleanupRootState),
    temporaryCleanupPath,
    proofCleanupPath,
    candidateQuarantinePaths,
    authorityPath,
    authorityCleanupPath,
    authorityQuarantinePaths,
    authorityIdentity,
    authorityHash,
    authority,
    inventory,
    expectedIdentity: candidateIdentity,
    expectedHash: candidateHash,
  };
}

async function secureInterruptedJournalWrite(state, interrupted) {
  if (!interrupted) return;
  const { authority } = interrupted;
  if (interrupted.candidatePath !== null) {
    const candidateState = await pathState(interrupted.candidatePath);
    const candidateSource = await readFile(interrupted.candidatePath, "utf8").catch(() => null);
    if (!candidateState?.isFile()
      || candidateState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(candidateState), interrupted.expectedIdentity)
      || candidateSource !== interrupted.candidateSource
      || sourceHash(candidateSource) !== interrupted.expectedHash) {
      throw journalFailure(state.journalPath, "Interrupted journal candidate changed before recovery.");
    }
  }

  let currentState = await pathState(state.journalPath);
  const currentHash = currentState?.isFile() && !currentState.isSymbolicLink()
    ? await hashFile(state.journalPath).catch(() => null)
    : null;
  if (currentState?.isFile()
    && !currentState.isSymbolicLink()
    && sameFileIdentity(fileIdentity(currentState), authority.canonicalIdentity)
    && currentHash === interrupted.expectedHash) {
    state.journalIdentity = authority.canonicalIdentity;
    state.journalHash = interrupted.expectedHash;
    return;
  }

  if (interrupted.candidatePath === null) {
    throw journalFailure(
      state.journalPath,
      "Interrupted journal candidate disappeared before its publication was secured.",
    );
  }
  if (authority.previousIdentity === null) {
    if (currentState) {
      throw journalFailure(
        state.journalPath,
        "First transaction journal publication was replaced before recovery.",
      );
    }
    try {
      await link(interrupted.candidatePath, state.journalPath);
    } catch (error) {
      throw journalFailure(
        state.journalPath,
        `First transaction journal could not be published exclusively: ${error.message}`,
      );
    }
  } else {
    if (!currentState?.isFile()
      || currentState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(currentState), authority.previousIdentity)) {
      throw journalFailure(
        state.journalPath,
        "Live journal changed before identity-bound candidate recovery.",
      );
    }
    const handle = await open(state.journalPath, "r+");
    try {
      const openedState = await handle.stat();
      if (!openedState.isFile()
        || !sameFileIdentity(fileIdentity(openedState), authority.previousIdentity)) {
        throw journalFailure(
          state.journalPath,
          "Live journal changed during identity-bound candidate recovery.",
        );
      }
      await handle.truncate(0);
      await handle.writeFile(interrupted.candidateSource, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  await syncDirectory(state.stagingRoot);
  currentState = await pathState(state.journalPath);
  if (!currentState?.isFile()
    || currentState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(currentState), authority.canonicalIdentity)
    || await hashFile(state.journalPath).catch(() => null) !== interrupted.expectedHash) {
    throw journalFailure(state.journalPath, "Interrupted journal candidate was not durably secured.");
  }
  state.journalIdentity = authority.canonicalIdentity;
  state.journalHash = interrupted.expectedHash;
}

async function assertJournalWriteCleanupRoot(state, cleanupRoot, expectedIdentity) {
  const cleanupRootState = await pathState(cleanupRoot);
  if (!cleanupRootState?.isDirectory()
    || cleanupRootState.isSymbolicLink()
    || (cleanupRootState.mode & 0o077) !== 0
    || !sameFileIdentity(fileIdentity(cleanupRootState), expectedIdentity)
    || resolve(dirname(cleanupRoot)) !== resolve(state.stagingRoot)
    || !(await isPathPhysicallyInside(state.stagingRoot, cleanupRoot))) {
    throw journalFailure(
      state.journalPath,
      "Transaction journal cleanup reservation changed physical identity.",
    );
  }
}

async function cleanupJournalWriteArtifact(
  state,
  originalPath,
  cleanupPath,
  cleanupRoot,
  cleanupRootIdentity,
  expectedIdentity,
  expectedHash,
  label,
  { notify = true } = {},
) {
  const assertCleanupBoundary = async () => {
    await assertTransactionStoreAnchors(state);
    await assertJournalWriteCleanupRoot(state, cleanupRoot, cleanupRootIdentity);
    return true;
  };
  const afterOriginalQuarantine = notify && state.afterJournalCleanupHandoff
    ? ({ quarantinePath }) => state.afterJournalCleanupHandoff({
      state,
      path: originalPath,
      cleanupPath,
      quarantinePath,
      label,
    })
    : null;
  let originalState = originalPath ? await pathState(originalPath) : null;
  let cleanupState = await pathState(cleanupPath);
  if (originalState && cleanupState) {
    if (!originalState.isFile()
      || originalState.isSymbolicLink()
      || !cleanupState.isFile()
      || cleanupState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(originalState), expectedIdentity)
      || !sameFileIdentity(fileIdentity(cleanupState), expectedIdentity)
      || await hashFile(originalPath).catch(() => null) !== expectedHash
      || await hashFile(cleanupPath).catch(() => null) !== expectedHash) {
      throw journalFailure(state.journalPath, `${label} has duplicate cleanup state.`);
    }
    const retired = await removeProvenFile(originalPath, {
      expectedIdentity,
      expectedHash,
      quarantineParent: cleanupRoot,
      label,
      assertBoundary: assertCleanupBoundary,
      afterQuarantine: afterOriginalQuarantine,
    });
    if (!retired) {
      throw journalFailure(state.journalPath, `${label} disappeared before duplicate cleanup.`);
    }
    await syncDirectory(state.stagingRoot);
    await syncDirectory(cleanupRoot);
    originalState = null;
  }
  if (originalState) {
    if (!originalState.isFile() || originalState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(originalState), expectedIdentity)
      || await hashFile(originalPath).catch(() => null) !== expectedHash) {
      throw journalFailure(state.journalPath, `${label} changed before cleanup.`);
    }
    await assertTransactionStoreAnchors(state);
    await assertJournalWriteCleanupRoot(state, cleanupRoot, cleanupRootIdentity);
    try {
      await link(originalPath, cleanupPath);
    } catch (error) {
      throw journalFailure(
        state.journalPath,
        `${label} cleanup destination cannot be exclusively reserved: ${error.message}`,
      );
    }
    cleanupState = await pathState(cleanupPath);
    if (!cleanupState?.isFile()
      || cleanupState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(cleanupState), expectedIdentity)
      || await hashFile(cleanupPath).catch(() => null) !== expectedHash) {
      throw journalFailure(state.journalPath, `${label} cleanup handoff is not identity-bound.`);
    }
    const retired = await removeProvenFile(originalPath, {
      expectedIdentity,
      expectedHash,
      quarantineParent: cleanupRoot,
      label,
      assertBoundary: assertCleanupBoundary,
      afterQuarantine: afterOriginalQuarantine,
    });
    if (!retired) {
      throw journalFailure(state.journalPath, `${label} disappeared before cleanup handoff.`);
    }
    await syncDirectory(state.stagingRoot);
    await syncDirectory(cleanupRoot);
  }
  if (!cleanupState) return;
  if (!cleanupState.isFile() || cleanupState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(cleanupState), expectedIdentity)
    || await hashFile(cleanupPath).catch(() => null) !== expectedHash) {
    throw journalFailure(state.journalPath, `${label} changed during cleanup handoff.`);
  }
  const removed = await removeProvenFile(cleanupPath, {
    expectedIdentity,
    expectedHash,
    quarantineParent: cleanupRoot,
    label: `${label} cleanup handoff`,
    assertBoundary: assertCleanupBoundary,
  });
  if (!removed) {
    throw journalFailure(state.journalPath, `${label} cleanup handoff disappeared before removal.`);
  }
  await syncDirectory(cleanupRoot);
}

async function cleanupInterruptedJournalWrite(state) {
  const interrupted = await inspectInterruptedJournalWrite(state);
  if (!interrupted) return;
  const cleanupQuarantines = async (paths, expectedIdentity, expectedHash, label) => {
    for (const quarantinePath of paths) {
      const removed = await removeProvenFile(quarantinePath, {
        expectedIdentity,
        expectedHash,
        quarantineParent: interrupted.cleanupRoot,
        label,
        assertBoundary: async () => {
          await assertTransactionStoreAnchors(state);
          await assertJournalWriteCleanupRoot(
            state,
            interrupted.cleanupRoot,
            interrupted.cleanupRootIdentity,
          );
          return true;
        },
      });
      if (removed) await syncDirectory(interrupted.cleanupRoot);
    }
  };

  await cleanupJournalWriteArtifact(
    state,
    interrupted.temporaryPath,
    interrupted.temporaryCleanupPath,
    interrupted.cleanupRoot,
    interrupted.cleanupRootIdentity,
    interrupted.expectedIdentity,
    interrupted.expectedHash,
    "Transaction journal atomic temporary",
  );
  await cleanupJournalWriteArtifact(
    state,
    interrupted.proofPath,
    interrupted.proofCleanupPath,
    interrupted.cleanupRoot,
    interrupted.cleanupRootIdentity,
    interrupted.expectedIdentity,
    interrupted.expectedHash,
    "Transaction journal write proof",
  );
  await cleanupQuarantines(
    interrupted.candidateQuarantinePaths,
    interrupted.expectedIdentity,
    interrupted.expectedHash,
    "Transaction journal candidate removal quarantine",
  );
  await cleanupJournalWriteArtifact(
    state,
    interrupted.authorityPath,
    interrupted.authorityCleanupPath,
    interrupted.cleanupRoot,
    interrupted.cleanupRootIdentity,
    interrupted.authorityIdentity,
    interrupted.authorityHash,
    "Transaction journal prior-authority intent",
  );
  await cleanupQuarantines(
    interrupted.authorityQuarantinePaths,
    interrupted.authorityIdentity,
    interrupted.authorityHash,
    "Transaction journal authority removal quarantine",
  );
  await assertTransactionStoreAnchors(state);
  await assertJournalWriteCleanupRoot(
    state,
    interrupted.cleanupRoot,
    interrupted.cleanupRootIdentity,
  );
  if ((await readdir(interrupted.cleanupRoot)).length !== 0) {
    throw journalFailure(
      state.journalPath,
      "Transaction journal cleanup reservation gained unknown state.",
    );
  }
  await syncDirectory(state.stagingRoot);
}

async function persistTransaction(state) {
  if (!state.durable || state.finished) return;
  await assertTransactionStoreAnchors(state);
  const interrupted = await inspectInterruptedJournalWrite(state);
  if (interrupted) {
    await secureInterruptedJournalWrite(state, interrupted);
    await cleanupInterruptedJournalWrite(state);
  }

  const previousState = await pathState(state.journalPath);
  let previousSource = null;
  if (state.journalIdentity === null) {
    if (previousState) {
      throw migrationError(
        `Transaction journal appeared before exclusive publication: ${state.journalPath}`,
        "CONCURRENT_CHANGE",
      );
    }
  } else {
    previousSource = await readFile(state.journalPath, "utf8").catch(() => null);
    if (!previousState?.isFile()
      || previousState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(previousState), state.journalIdentity)
      || previousSource === null
      || sourceHash(previousSource) !== state.journalHash) {
      throw migrationError(
        `Transaction journal changed before publication: ${state.journalPath}`,
        "CONCURRENT_CHANGE",
      );
    }
  }

  const temporaryPath = join(
    state.stagingRoot,
    `.${basename(state.journalPath)}.sdd-write-${process.pid}-${randomUUID()}`,
  );
  const proofPath = join(state.stagingRoot, MIGRATION_JOURNAL_WRITE_PROOF_NAME);
  const authorityPath = join(state.stagingRoot, MIGRATION_JOURNAL_WRITE_AUTHORITY_NAME);
  const cleanupRoot = state.journalWriteCleanupPath;
  const cleanupRootIdentity = state.journalWriteCleanupIdentity;
  let temporaryHandle;
  let authorityHandle;
  let journalHandle;
  try {
    await assertJournalWriteCleanupRoot(state, cleanupRoot, cleanupRootIdentity);
    temporaryHandle = await open(temporaryPath, "wx", 0o600);
    const openedTemporaryState = await temporaryHandle.stat();
    if (!openedTemporaryState.isFile()) {
      throw migrationError(
        `Transaction journal temporary is not a regular file: ${temporaryPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    const temporaryIdentity = fileIdentity(openedTemporaryState);

    authorityHandle = await open(authorityPath, "wx", 0o400);
    const openedAuthorityState = await authorityHandle.stat();
    if (!openedAuthorityState.isFile()) {
      throw migrationError(
        `Transaction journal prior-authority intent is not a regular file: ${authorityPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    const authorityIdentity = fileIdentity(openedAuthorityState);
    const canonicalIdentity = state.journalIdentity ?? temporaryIdentity;
    const source = `${JSON.stringify(
      serializeTransaction(state, {
        journalWriteIdentity: temporaryIdentity,
        journalWriteCleanupIdentity: cleanupRootIdentity,
        journalCanonicalIdentity: canonicalIdentity,
        journalPreviousIdentity: state.journalIdentity,
        journalPreviousHash: state.journalHash,
        journalWriteAuthorityIdentity: authorityIdentity,
      }),
      null,
      2,
    )}\n`;
    const expectedHash = sourceHash(source);
    const authoritySource = journalWriteAuthoritySource({
      version: MIGRATION_JOURNAL_WRITE_AUTHORITY_VERSION,
      authorityIdentity,
      stagingRoot: resolve(state.stagingRoot),
      journalPath: resolve(state.journalPath),
      candidatePath: resolve(temporaryPath),
      candidateIdentity: temporaryIdentity,
      candidateHash: expectedHash,
      candidateSource: source,
      canonicalIdentity,
      previousIdentity: state.journalIdentity,
      previousHash: state.journalHash,
      previousSource,
      cleanupIdentity: cleanupRootIdentity,
      initializationReservationIdentity: state.initializationReservationIdentity,
      initializationBindingIdentity: state.initializationBindingIdentity,
      stagingIdentity: state.stagingIdentity,
      destinationManifestWitnessIdentity: state.destinationManifestWitnessIdentity,
      destinationManifestDigestIdentity: state.destinationManifestDigestIdentity,
    });
    await authorityHandle.writeFile(authoritySource, "utf8");
    await authorityHandle.sync();
    await authorityHandle.close();
    authorityHandle = null;
    await syncDirectory(state.stagingRoot);
    const authorityState = await pathState(authorityPath);
    if (!authorityState?.isFile()
      || authorityState.isSymbolicLink()
      || (authorityState.mode & 0o222) !== 0
      || !sameFileIdentity(fileIdentity(authorityState), authorityIdentity)
      || await readFile(authorityPath, "utf8").catch(() => null) !== authoritySource) {
      throw migrationError(
        `Transaction journal prior authority was not durably bound: ${authorityPath}`,
        "CONCURRENT_CHANGE",
      );
    }

    await temporaryHandle.writeFile(source, "utf8");
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = null;
    const temporaryState = await pathState(temporaryPath);
    if (!temporaryState?.isFile()
      || temporaryState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(temporaryState), temporaryIdentity)
      || await hashFile(temporaryPath).catch(() => null) !== expectedHash) {
      throw migrationError(
        `Transaction journal temporary changed before publication: ${temporaryPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    await link(temporaryPath, proofPath);
    const proofState = await pathState(proofPath);
    if (!proofState?.isFile()
      || proofState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(proofState), temporaryIdentity)
      || await hashFile(proofPath).catch(() => null) !== expectedHash) {
      throw migrationError(
        `Transaction journal temporary could not be identity-bound: ${temporaryPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    await syncDirectory(state.stagingRoot);
    if (state.beforeJournalReplace) {
      await state.beforeJournalReplace({
        state,
        temporaryPath,
        proofPath,
        authorityPath,
      });
    }

    if (state.journalIdentity === null) {
      if (await pathState(state.journalPath)) {
        throw migrationError(
          `Transaction journal appeared during exclusive publication: ${state.journalPath}`,
          "CONCURRENT_CHANGE",
        );
      }
      try {
        await link(temporaryPath, state.journalPath);
      } catch (error) {
        throw migrationError(
          `Transaction journal could not be published exclusively: ${state.journalPath}`,
          "CONCURRENT_CHANGE",
          [error.message],
        );
      }
      state.journalIdentity = temporaryIdentity;
    } else {
      const currentState = await pathState(state.journalPath);
      if (!currentState?.isFile()
        || currentState.isSymbolicLink()
        || !sameFileIdentity(fileIdentity(currentState), state.journalIdentity)
        || await hashFile(state.journalPath).catch(() => null) !== state.journalHash) {
        throw migrationError(
          `Transaction journal changed during publication: ${state.journalPath}`,
          "CONCURRENT_CHANGE",
        );
      }
      journalHandle = await open(state.journalPath, "r+");
      const openedState = await journalHandle.stat();
      if (!openedState.isFile()
        || !sameFileIdentity(fileIdentity(openedState), state.journalIdentity)) {
        throw migrationError(
          `Transaction journal changed during identity-bound open: ${state.journalPath}`,
          "CONCURRENT_CHANGE",
        );
      }
      await journalHandle.truncate(0);
      await journalHandle.writeFile(source, "utf8");
      await journalHandle.sync();
      await journalHandle.close();
      journalHandle = null;
    }

    const journalState = await pathState(state.journalPath);
    if (!journalState?.isFile()
      || journalState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(journalState), canonicalIdentity)
      || await hashFile(state.journalPath).catch(() => null) !== expectedHash) {
      throw migrationError(
        `Transaction journal changed during identity-bound publication: ${state.journalPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    state.journalIdentity = canonicalIdentity;
    state.journalHash = expectedHash;
    await cleanupInterruptedJournalWrite(state);
  } catch (error) {
    await temporaryHandle?.close().catch(() => {});
    await authorityHandle?.close().catch(() => {});
    await journalHandle?.close().catch(() => {});
    throw error;
  }
}

async function createTransactionState(plan, stagingRoot, mutationLock = null) {
  const workspaceAnchor = await captureDirectoryAnchor(
    plan.workspaceRoot,
    "Migration workspace",
    "CONCURRENT_CHANGE",
  );
  const readGuardOwnerAnchors = new Map();
  const readGuards = await Promise.all((plan.readGuards ?? []).map(async (guard, index) => {
    const ownerKey = resolve(guard.ownerRoot);
    let ownerAnchor = readGuardOwnerAnchors.get(ownerKey);
    if (!ownerAnchor) {
      ownerAnchor = captureDirectoryAnchor(
        ownerKey,
        "Migration authority owner",
        "CONCURRENT_CHANGE",
      );
      readGuardOwnerAnchors.set(ownerKey, ownerAnchor);
    }
    return {
      ...guard,
      ownerAnchor: await ownerAnchor,
      proofPath: readGuardProofPath(stagingRoot, index),
      proofIdentity: null,
      proofPhase: "pending",
    };
  }));
  const destinationGuards = plan.changes.map((change, index) => ({
    destination: change.destination,
    canonicalHash: change.canonicalHash,
    existing: Boolean(change.existing),
    proofPath: destinationGuardProofPath(stagingRoot, index),
    proofIdentity: null,
    proofPhase: "pending",
  }));
  const destinationGuardByPath = new Map(
    destinationGuards.map((guard) => [resolve(guard.destination), guard]),
  );
  const publishedChanges = plan.changes
    .filter((change) => !change.existing)
    .map((change) => {
      const ownerToken = randomUUID();
      return {
        ...change,
        stagedPath: join(stagingRoot, change.changeId),
        stagingPath: join(
          stagingRoot,
          `.change-stage-${ownerToken}-${randomUUID()}`,
        ),
        stagingIdentity: null,
        stagedIdentity: null,
        stagedIdentityEvidencePath: null,
        stagedIdentityEvidenceIdentity: null,
        proofPath: destinationGuardByPath.get(resolve(change.destination)).proofPath,
        proofIdentity: null,
        tasksCanonicalizationPhase: "pending",
        tasksCanonicalizationOriginalIdentity: null,
        tasksCanonicalizationOriginalHash: null,
        tasksCanonicalizationIdentity: null,
        ownerToken,
        reservationIdentity: null,
        reservationIntentIdentity: null,
        reservationBindingIdentity: null,
        reservationLockProofIdentity: null,
        reserved: false,
        published: false,
        copyRoot: null,
        copySourceRoot: null,
        copySourceManifest: null,
        copyTargetManifest: null,
        copyProvenanceToken: null,
        copyTargetProvenance: [],
        copyIntent: null,
        removalMode: null,
        removalRoot: null,
        removalManifest: null,
        removalProgress: [],
        phase: "pending",
      };
    });
  const publishedBriefs = [];
  for (const [index, brief] of plan.briefs.entries()) {
    const ownerAnchor = await captureDirectoryAnchor(
      brief.ownerRoot,
      "Change Brief owner",
      "UNSAFE_ARTIFACT_PATH",
    );
    if (!(await isPathPhysicallyInside(ownerAnchor.physicalPath, brief.destination))) {
      throw migrationError(`Change Brief destination escapes its owner: ${brief.destination}`, "UNSAFE_ARTIFACT_PATH");
    }
    publishedBriefs.push({
      ...brief,
      ownerAnchor,
      stagedPath: join(stagingRoot, `.brief-${index}`),
      stagedIdentity: null,
      stagingProofPath: null,
      stagingProofIdentity: null,
      briefIntentPath: briefOwnershipIntentPath({ stagedPath: join(stagingRoot, `.brief-${index}`) }),
      briefIntentIdentity: null,
      briefIntentSource: null,
      briefIntentAuthenticated: false,
      stagingBindingPath: briefStagingBindingPath({ stagedPath: join(stagingRoot, `.brief-${index}`) }),
      stagingBindingIdentity: null,
      stagingBindingTargetIdentity: null,
      stagingBindingSource: null,
      stagingBindingAuthenticated: false,
      publicationBindingPath: briefPublicationBindingPath({ stagedPath: join(stagingRoot, `.brief-${index}`) }),
      publicationBindingIdentity: null,
      publicationBindingTargetIdentity: null,
      publicationBindingSource: null,
      publicationBindingAuthenticated: false,
      publishedIdentity: null,
      publicationProofPath: null,
      publicationProofIdentity: null,
      publicationProofCleanupPath: null,
      publicationProofCleanupIdentity: null,
      publicationProofPhase: "pending",
      published: false,
      phase: "pending",
    });
  }
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
      originalProofCleanupPath: null,
      originalProofCleanupIdentity: null,
      nextProofCleanupPath: null,
      nextProofCleanupIdentity: null,
      nextProofIntentIdentity: null,
      restoredIdentity: null,
      originalPath: join(stagingRoot, `.config-${index}-original`),
      nextPath: join(stagingRoot, `.config-${index}-next`),
      originalStagedIdentity: null,
      nextStagedIdentity: null,
      originalWriteTemporary: null,
      originalWriteTemporaryIdentity: null,
      nextWriteTemporary: null,
      nextWriteTemporaryIdentity: null,
      originalProofPath: configProofPath(stagingRoot, write.path, index, "original"),
      nextProofPath: configProofPath(stagingRoot, write.path, index, "next"),
      proofPhase: "pending",
      originalProofAuthenticated: false,
      nextProofAuthenticated: false,
      authenticatedOriginalSource: null,
      authenticatedOriginalHash: null,
      authenticatedNextHash: null,
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
    const backupProofToken = randomUUID();
    const proofPaths = sourceBackupProofPaths(backup, backupProofToken);
    return {
      ...root,
      backup,
      backupIdentity: null,
      backupMode: null,
      backupPayloadIdentity: null,
      backupProofToken,
      backupProofRoot: proofPaths.root,
      backupProofRootIdentity: null,
      backupProofOwnerPath: proofPaths.owner,
      backupProofOwnerIdentity: null,
      backupProofReceiptPath: proofPaths.receipt,
      backupProofReceiptIdentity: null,
      backupProofOwnerCleanupPath: proofPaths.ownerCleanup,
      backupProofOwnerCleanupIdentity: null,
      backupProofReceiptCleanupPath: proofPaths.receiptCleanup,
      backupProofReceiptCleanupIdentity: null,
      backupEntryProvenance: [],
      backupProofPhase: "pending",
      backupProofRemovalManifest: null,
      backupProofRemovalProgress: [],
      restoreIdentity: null,
      restoreReservationToken: null,
      restoreIntentIdentity: null,
      restoreCopyRoot: null,
      restoreCopySourceRoot: null,
      restoreCopySourceManifest: null,
      restoreCopyTargetManifest: null,
      restoreCopyProvenanceToken: null,
      restoreCopyTargetProvenance: [],
      restoreCopyIntent: null,
      cleanupPath: null,
      cleanupIdentity: null,
      cleanupMode: null,
      removalMode: null,
      removalRoot: null,
      removalManifest: null,
      removalProgress: [],
      copyRoot: null,
      copySourceRoot: null,
      copySourceManifest: null,
      copyTargetManifest: null,
      copyIntent: null,
      phase: "pending",
    };
  });
  const durable = plan.result.required;
  return {
    plan,
    destinationWorkspaceRoot: plan.destinationWorkspaceRoot,
    workspaceAnchor,
    readGuards,
    stagingRoot,
    initializationPhase: "pending",
    initializationReservationPath: initializationReservationPath(
      plan.destinationWorkspaceRoot,
      stagingRoot,
    ),
    initializationReservationIdentity: null,
    initializationBindingPath: initializationBindingPath(
      plan.destinationWorkspaceRoot,
      stagingRoot,
    ),
    initializationBindingIdentity: null,
    stagingIdentity: null,
    journalPath: join(stagingRoot, MIGRATION_JOURNAL_NAME),
    journalIdentity: null,
    journalHash: null,
    journalWriteCleanupPath: join(
      stagingRoot,
      MIGRATION_JOURNAL_WRITE_CLEANUP_DIRECTORY_NAME,
    ),
    journalWriteCleanupIdentity: null,
    destinationManifestPhase: "pending",
    destinationManifestIdentity: null,
    destinationManifestPath: join(stagingRoot, MIGRATION_DESTINATION_MANIFEST_NAME),
    destinationManifestWitnessPath: destinationManifestWitnessPath(
      plan.destinationWorkspaceRoot,
      stagingRoot,
    ),
    destinationManifestWitnessIdentity: null,
    destinationManifestWitnessPhase: "pending",
    destinationManifestDigestPath: destinationManifestDigestPath(
      plan.destinationWorkspaceRoot,
      stagingRoot,
    ),
    destinationManifestDigestIdentity: null,
    destinationManifestDigestPhase: "pending",
    sourceDerivedDestinationGuards: null,
    stagingRemovalRoot: null,
    stagingRemovalManifest: null,
    stagingRemovalProgress: [],
    terminalCleanupPlan: null,
    terminalCleanupReceipt: null,
    sourceDerivedManifestPath: join(stagingRoot, MIGRATION_SOURCE_DERIVED_MANIFEST_NAME),
    sourceDerivedManifestWitnessPath: sourceDerivedManifestWitnessPath(
      plan.destinationWorkspaceRoot,
      stagingRoot,
    ),
    sourceDerivedManifestWitnessIdentity: null,
    sourceDerivedManifestDigestPath: sourceDerivedManifestDigestPath(
      plan.destinationWorkspaceRoot,
      stagingRoot,
    ),
    sourceDerivedManifestDigestIdentity: null,
    destinationGuards,
    publishedChanges,
    publishedBriefs,
    writtenConfigs,
    removedSources,
    status: "applying",
    durable,
    finished: !durable,
    mutationLock,
    beforeJournalReplace: null,
    afterTransactionCleanupReceiptStage: null,
    afterTransactionCleanupReceiptProof: null,
    afterTransactionCleanupReceipt: null,
    afterTransactionJournalUnlink: null,
    afterTransactionStagingRootRemoval: null,
    afterTransactionWitnessUnlink: null,
    afterConfigProofCleanupLink: null,
    storeAnchors: null,
  };
}
async function openConfigStagingTemporary(
  state,
  write,
  kind,
  temporaryPath,
  flags,
  mode,
  afterCreate = null,
) {
  const pathProperty = `${kind}WriteTemporary`;
  const identityProperty = `${kind}WriteTemporaryIdentity`;
  const target = kind === "original" ? write.originalPath : write.nextPath;
  const prefix = `.${basename(target)}.sdd-write-`;
  if (resolve(dirname(temporaryPath)) !== resolve(state.stagingRoot)
    || !basename(temporaryPath).startsWith(prefix)
    || await pathState(temporaryPath)) {
    throw migrationError(
      `Configuration staging temporary intent is unsafe: ${temporaryPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  write[pathProperty] = temporaryPath;
  write[identityProperty] = null;
  await persistTransaction(state);
  const handle = await open(temporaryPath, flags, mode);
  try {
    const createdState = await handle.stat({ bigint: true });
    if (!createdState.isFile()) {
      throw migrationError(
        `Configuration staging temporary is not a file: ${temporaryPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    write[identityProperty] = fileIdentity(createdState);
    await persistTransaction(state);
    if (afterCreate) await afterCreate({ write, kind, temporaryPath });
    return handle;
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

async function initializeTransaction(
  state,
  linkFile = link,
  afterReadGuardProofCreate = null,
  beforeDestinationGuardProofCreate = null,
  afterDestinationGuardProofCreate = null,
  afterConfigProofCreate = null,
  afterConfigOriginalStage = null,
  afterConfigNextStage = null,
  afterConfigStagingTemporaryCreate = null,
  afterTransactionStagingReservation = null,
  afterTransactionInitialJournal = null,
  afterDestinationManifestCreate = null,
  afterDestinationManifestDigestCreate = null,
  afterDestinationManifestWitnessCreate = null,
  afterTransactionInitializationEvidenceRelease = null,
  afterTransactionInitializationReservation = null,
  afterTransactionInitializationBinding = null,
  afterTransactionStagingRootCreate = null,
) {
  if (!state.durable) return;
  await initializeTransactionStaging(
    state,
    afterTransactionStagingReservation,
    afterTransactionInitializationReservation,
    afterTransactionInitializationBinding,
    afterTransactionStagingRootCreate,
  );
  await assertTransactionStoreAnchors(state);
  await assertInitializationEvidence(state);
  state.initializationPhase = "journaled";
  await persistTransaction(state);
  if (afterTransactionInitialJournal) {
    await afterTransactionInitialJournal({ state, journalPath: state.journalPath });
  }
  await writeDestinationManifest(state, {
    afterDestinationManifestCreate,
    afterDestinationManifestDigestCreate,
    afterDestinationManifestWitnessCreate,
  });
  await assertTransactionStoreAnchors(state);
  await releaseInitializationEvidence(
    state,
    afterTransactionInitializationEvidenceRelease,
  );
  for (const guard of state.readGuards) {
    await assertReadGuardCurrent(guard, { requireProof: false });
    guard.proofPhase = "creating";
    await persistTransaction(state);
    guard.proofIdentity = await createFileIdentityProof(
      guard.path,
      guard.proofPath,
      guard.hash,
      "Migration authority",
      () => assertTransactionStoreAnchors(state),
      linkFile,
      async ({ identity }) => {
        guard.proofIdentity = identity;
        await persistTransaction(state);
      },
    );
    if (afterReadGuardProofCreate) await afterReadGuardProofCreate({ guard });
    guard.proofPhase = "present";
    await persistTransaction(state);
    await assertReadGuardCurrent(guard);
  }
  await persistTransaction(state);
  for (const guard of state.destinationGuards.filter((record) => record.existing)) {
    await assertTransactionStoreAnchors(state);
    guard.proofIdentity = await destinationGuardTasksIdentity(
      guard,
      state.destinationWorkspaceRoot,
    );
    guard.proofPhase = "creating";
    await persistTransaction(state);
    if (beforeDestinationGuardProofCreate) {
      await beforeDestinationGuardProofCreate({ guard });
    }
    await createDestinationGuardProof(
      guard,
      state.destinationWorkspaceRoot,
      () => assertTransactionStoreAnchors(state),
      afterDestinationGuardProofCreate,
    );
    guard.proofPhase = "present";
    await persistTransaction(state);
    await assertDestinationGuard(guard, state.destinationWorkspaceRoot);
  }
  for (const write of state.writtenConfigs) {
    await assertConfigWriteCurrent(write);
    await assertTransactionStoreAnchors(state);
    if (!(await isPathPhysicallyInside(write.ownerAnchor.physicalPath, write.originalProofPath))
      || !(await isPathPhysicallyInside(write.ownerAnchor.physicalPath, write.nextProofPath))) {
      throw migrationError(`Configuration proof path escapes its owner: ${write.path}`, "UNSAFE_CONFIG_PATH");
    }
    write.proofPhase = "creating";
    await persistTransaction(state);
    const createdOriginalProofIdentity = await createFileIdentityProof(
      write.path,
      write.originalProofPath,
      write.originalHash,
      "Configuration",
      async () => {
        await assertTransactionStoreAnchors(state);
        await assertStoredDirectoryAnchor(write.ownerRoot, write.ownerAnchor, "Configuration owner");
      },
    );
    if (afterConfigProofCreate) await afterConfigProofCreate({ write });
    const originalProofState = await pathState(write.originalProofPath);
    if (
      !originalProofState?.isFile()
      || originalProofState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(originalProofState), write.originalIdentity)
      || !sameFileIdentity(fileIdentity(originalProofState), createdOriginalProofIdentity)
    ) {
      throw migrationError(
        `Configuration changed while its ownership proof was created: ${write.path}`,
        "CONCURRENT_CHANGE",
      );
    }
    write.originalProofAuthenticated = true;
    write.authenticatedOriginalSource = write.originalSource;
    write.authenticatedOriginalHash = write.originalHash;
    write.nextProofAuthenticated = false;
    write.authenticatedNextHash = null;
    write.proofPhase = "present";
    await persistTransaction(state);

    write.phase = "preparing-original";
    await persistTransaction(state);
    await assertTransactionStoreAnchors(state);
    const publishedOriginal = await writeFileAtomically(write.originalPath, write.originalSource, {
      expected: null,
      ownerRoot: state.stagingRoot,
      openFile: (path, flags, mode) => openConfigStagingTemporary(
        state,
        write,
        "original",
        path,
        flags,
        mode,
        afterConfigStagingTemporaryCreate,
      ),
    });
    await chmod(write.originalPath, write.originalMode);
    write.originalWriteTemporary = null;
    write.originalWriteTemporaryIdentity = null;
    if (afterConfigOriginalStage) await afterConfigOriginalStage({ write });
    await assertTransactionStoreAnchors(state);
    const originalStagedState = await pathState(write.originalPath);
    if (!originalStagedState?.isFile()
      || originalStagedState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(originalStagedState), publishedOriginal.identity)
      || (originalStagedState.mode & 0o777) !== write.originalMode
      || await hashFile(write.originalPath) !== write.originalHash) {
      throw migrationError(`Staged original configuration is invalid: ${write.path}`, "MIGRATION_STAGING_FAILED");
    }
    write.originalStagedIdentity = publishedOriginal.identity;
    write.phase = "original-prepared";
    await persistTransaction(state);

    write.phase = "preparing-next";
    await persistTransaction(state);
    await assertTransactionStoreAnchors(state);
    const publishedNext = await writeFileAtomically(write.nextPath, write.nextSource, {
      expected: null,
      ownerRoot: state.stagingRoot,
      openFile: (path, flags, mode) => openConfigStagingTemporary(
        state,
        write,
        "next",
        path,
        flags,
        mode,
        afterConfigStagingTemporaryCreate,
      ),
    });
    await chmod(write.nextPath, write.originalMode);
    write.nextWriteTemporary = null;
    write.nextWriteTemporaryIdentity = null;
    if (afterConfigNextStage) await afterConfigNextStage({ write });
    const nextStagedState = await pathState(write.nextPath);
    if (!nextStagedState?.isFile()
      || nextStagedState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(nextStagedState), publishedNext.identity)
      || (nextStagedState.mode & 0o777) !== write.originalMode
      || await hashFile(write.originalProofPath) !== write.originalHash
      || await hashFile(write.nextPath) !== write.nextHash) {
      throw migrationError(`Staged configuration hash mismatch: ${write.path}`, "MIGRATION_STAGING_FAILED");
    }
    write.nextStagedIdentity = publishedNext.identity;
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

async function hydrateExistingDestinationGuardProof(
  guard,
  index,
  stagingRoot,
  journalPath,
  destinationWorkspaceRoot,
) {
  try {
    const tasksIdentity = await destinationGuardTasksIdentity(
      guard,
      destinationWorkspaceRoot,
    );
    const proof = await readBoundRegularFile(guard.proofPath, {
      ownerRoot: stagingRoot,
      allowMissing: true,
      label: `destinationGuards[${index}] ownership proof`,
      unsafeCode: "CONCURRENT_CHANGE",
    });
    if (guard.proofPhase === "pending") {
      if (proof !== null) {
        throw journalFailure(
          journalPath,
          `destinationGuards[${index}] has an unannounced ownership proof.`,
        );
      }
      return false;
    }
    if (!sameFileIdentity(tasksIdentity, guard.proofIdentity)) {
      throw journalFailure(
        journalPath,
        `destinationGuards[${index}] proof intent is not bound to its destination tasks.`,
      );
    }
    if (guard.proofPhase === "creating") {
      if (proof === null) {
        guard.proofIdentity = null;
        guard.proofPhase = "pending";
        return true;
      }
      if (!sameFileIdentity(proof.identity, guard.proofIdentity)) {
        throw journalFailure(
          journalPath,
          `destinationGuards[${index}] creating proof changed physical identity.`,
        );
      }
      await assertDestinationGuard(guard, destinationWorkspaceRoot);
      guard.proofPhase = "present";
      return true;
    }
    if (proof === null || !sameFileIdentity(proof.identity, guard.proofIdentity)) {
      throw journalFailure(
        journalPath,
        `destinationGuards[${index}] ownership proof changed physical identity.`,
      );
    }
    await assertDestinationGuard(guard, destinationWorkspaceRoot);
    return false;
  } catch (error) {
    if (error?.code === "MUTATION_RECOVERY_FAILED") throw error;
    throw journalFailure(
      journalPath,
      `destinationGuards[${index}] ownership proof is not authentic: ${error.message}`,
    );
  }
}
function requireExactJournalKeys(value, keys, label, journalPath) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw journalFailure(journalPath, `${label} must be an object with an exact schema.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    throw journalFailure(journalPath, `${label} contains unknown or missing properties.`);
  }
}


function requireJournalString(value, label, journalPath) {
  if (typeof value !== "string" || value.length === 0 || !isAbsolute(value)) {
    throw journalFailure(journalPath, `${label} must be an absolute path.`);
  }
}

function requireJournalAnchor(anchor, label, journalPath) {
  requireExactJournalKeys(
    anchor,
    ["logicalPath", "physicalPath", "dev", "ino"],
    label,
    journalPath,
  );
  if (!anchor || typeof anchor !== "object") {
    throw journalFailure(journalPath, `${label} is missing.`);
  }
  requireJournalString(anchor.logicalPath, `${label}.logicalPath`, journalPath);
  requireJournalString(anchor.physicalPath, `${label}.physicalPath`, journalPath);
  if (typeof anchor.dev !== "string" || typeof anchor.ino !== "string") {
    throw journalFailure(journalPath, `${label} has an invalid filesystem identity.`);
  }
}
function requireJournalOwnerBinding(ownerBinding, ownerRoot, label, journalPath) {
  requireExactJournalKeys(
    ownerBinding,
    ["path", "binding", "ancestors"],
    label,
    journalPath,
  );
  requireExactJournalPath(ownerBinding.path, ownerRoot, `${label}.path`, journalPath);
  if (!Array.isArray(ownerBinding.ancestors)) {
    throw journalFailure(journalPath, `${label}.ancestors must be an array.`);
  }
  const requireAncestor = (ancestor, ancestorLabel) => {
    requireExactJournalKeys(
      ancestor,
      ["path", "lexicalType", "lexicalIdentity", "followedIdentity"],
      ancestorLabel,
      journalPath,
    );
    requireJournalString(ancestor.path, `${ancestorLabel}.path`, journalPath);
    if (!["directory", "symlink"].includes(ancestor.lexicalType)) {
      throw journalFailure(journalPath, `${ancestorLabel}.lexicalType is invalid.`);
    }
    requireJournalIdentity(
      ancestor.lexicalIdentity,
      `${ancestorLabel}.lexicalIdentity`,
      journalPath,
    );
    requireJournalIdentity(
      ancestor.followedIdentity,
      `${ancestorLabel}.followedIdentity`,
      journalPath,
    );
  };
  requireAncestor(ownerBinding.binding, `${label}.binding`);
  if (resolve(ownerBinding.binding.path) !== resolve(ownerRoot)) {
    throw journalFailure(journalPath, `${label}.binding does not name its owner root.`);
  }
  ownerBinding.ancestors.forEach((ancestor, index) => {
    requireAncestor(ancestor, `${label}.ancestors[${index}]`);
  });
}


function requireJournalRecords(
  records,
  label,
  keys,
  requiredStrings,
  requiredPaths,
  journalPath,
) {
  if (!Array.isArray(records)) throw journalFailure(journalPath, `${label} must be an array.`);
  for (const [index, record] of records.entries()) {
    if (!record || typeof record !== "object") {
      throw journalFailure(journalPath, `${label}[${index}] must be an object.`);
    }
    requireExactJournalKeys(record, keys, `${label}[${index}]`, journalPath);
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
function requireJournalIdentity(value, label, journalPath, { nullable = false } = {}) {
  if (value === null && nullable) return;
  requireExactJournalKeys(value, ["dev", "ino"], label, journalPath);
  if (typeof value.dev !== "string" || typeof value.ino !== "string") {
    throw journalFailure(journalPath, `${label} has an invalid filesystem identity.`);
  }
}

function requireJournalMode(value, label, journalPath, { nullable = false } = {}) {
  if (value === null && nullable) return;
  if (!Number.isInteger(value) || value < 0 || value > 0o777) {
    throw journalFailure(journalPath, `${label} is not an exact permission mode.`);
  }
}

function isCanonicalRemovalRelativePath(root, value, { allowRoot = false } = {}) {
  if (typeof value !== "string" || value.length === 0 || isAbsolute(value)
    || value.includes("\\")) return false;
  if (value === ".") return allowRoot;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
    && value === normalizePath(relative(root, removalManifestPath(root, value)));
}

function requireJournalRemovalState(
  {
    mode,
    root,
    manifest,
    progress,
  },
  label,
  journalPath,
) {
  const empty = mode === null && root === null && manifest === null;
  if (empty) {
    if (!Array.isArray(progress) || progress.length !== 0) {
      throw journalFailure(journalPath, `${label} empty removal state has progress.`);
    }
    return;
  }
  if (!["source", "backup", "staging"].includes(mode)) {
    throw journalFailure(journalPath, `${label}.mode is invalid.`);
  }
  requireJournalString(root, `${label}.root`, journalPath);
  if (!Array.isArray(manifest) || manifest.length === 0
    || !Array.isArray(progress)) {
    throw journalFailure(journalPath, `${label} has an invalid manifest or progress list.`);
  }
  const entriesByPath = new Map();
  const quarantinePaths = new Set();
  for (const [index, entry] of manifest.entries()) {
    const entryLabel = `${label}.manifest[${index}]`;
    requireExactJournalKeys(
      entry,
      [
        "relativePath",
        "type",
        "identity",
        "mode",
        "hash",
        "target",
        "quarantineRelativePath",
      ],
      entryLabel,
      journalPath,
    );
    if (!isCanonicalRemovalRelativePath(root, entry.relativePath, { allowRoot: index === 0 })
      || entriesByPath.has(entry.relativePath)
      || !["directory", "file", "symlink"].includes(entry.type)) {
      throw journalFailure(journalPath, `${entryLabel} is invalid or escapes its removal root.`);
    }
    requireJournalIdentity(entry.identity, `${entryLabel}.identity`, journalPath);
    if (!Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777) {
      throw journalFailure(journalPath, `${entryLabel}.mode is invalid.`);
    }
    if (entry.type === "file") {
      if (typeof entry.hash !== "string" || entry.hash.length === 0) {
        throw journalFailure(journalPath, `${entryLabel}.hash is invalid.`);
      }
      if (entry.target !== null) {
        throw journalFailure(journalPath, `${entryLabel} file has a symlink target.`);
      }
    } else if (entry.type === "symlink") {
      if (typeof entry.target !== "string" || entry.hash !== null) {
        throw journalFailure(journalPath, `${entryLabel} symlink evidence is invalid.`);
      }
    } else if (entry.hash !== null
      || entry.target !== null
      || entry.quarantineRelativePath !== null) {
      throw journalFailure(journalPath, `${entryLabel} directory evidence is invalid.`);
    }
    if (entry.quarantineRelativePath !== null) {
      if (!isCanonicalRemovalRelativePath(root, entry.quarantineRelativePath)) {
        throw journalFailure(journalPath, `${entryLabel}.quarantineRelativePath is invalid.`);
      }
      const quarantineName = basename(entry.quarantineRelativePath);
      if (!isStrictlyInside(root, removalManifestPath(root, entry.quarantineRelativePath))
        || normalizePath(dirname(entry.quarantineRelativePath))
          !== normalizePath(dirname(entry.relativePath))
        || !/^\.sdd-remove-\d+-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(quarantineName)
        || quarantinePaths.has(entry.quarantineRelativePath)) {
        throw journalFailure(journalPath, `${entryLabel} quarantine path is invalid.`);
      }
      quarantinePaths.add(entry.quarantineRelativePath);
    } else if (entry.type !== "directory") {
      throw journalFailure(journalPath, `${entryLabel} lacks a quarantine path.`);
    }
    entriesByPath.set(entry.relativePath, entry);
  }
  if (manifest[0].relativePath !== "." || manifest[0].type !== "directory") {
    throw journalFailure(journalPath, `${label} manifest has no directory root.`);
  }
  for (const entry of manifest.slice(1)) {
    if (!entriesByPath.has(normalizePath(dirname(entry.relativePath)))) {
      throw journalFailure(journalPath, `${label} manifest entry has no parent.`);
    }
  }
  const progressPaths = new Set();
  for (const relativePath of progress) {
    if (typeof relativePath !== "string"
      || !entriesByPath.has(relativePath)
      || progressPaths.has(relativePath)) {
      throw journalFailure(journalPath, `${label} progress is invalid.`);
    }
    progressPaths.add(relativePath);
  }
}

function requireJournalCopyState(record, label, journalPath) {
  const empty = record.copyRoot === null
    && record.copySourceRoot === null
    && record.copySourceManifest === null
    && record.copyTargetManifest === null
    && record.copyIntent === null;
  if (empty) return;
  requireJournalString(record.copyRoot, `${label}.copyRoot`, journalPath);
  requireJournalString(record.copySourceRoot, `${label}.copySourceRoot`, journalPath);
  requireJournalRemovalState(
    {
      mode: "staging",
      root: record.copyRoot,
      manifest: record.copySourceManifest,
      progress: [],
    },
    `${label} copy source`,
    journalPath,
  );
  if (!Array.isArray(record.copyTargetManifest)) {
    throw journalFailure(journalPath, `${label}.copyTargetManifest must be an array.`);
  }
  if (record.copyTargetManifest.length > 0) {
    requireJournalRemovalState(
      {
        mode: "staging",
        root: record.copyRoot,
        manifest: record.copyTargetManifest,
        progress: [],
      },
      `${label} copy target`,
      journalPath,
    );
  }
  const sourceByPath = new Map(
    record.copySourceManifest.map((entry) => [entry.relativePath, entry]),
  );
  for (const targetEntry of record.copyTargetManifest) {
    const sourceEntry = sourceByPath.get(targetEntry.relativePath);
    const incompleteFile = targetEntry.type === "file"
      && record.copyIntent?.relativePath === targetEntry.relativePath
      && (targetEntry.hash === sourceHash(Buffer.alloc(0))
        || Array.isArray(record.copyTargetProvenance));
    if (!sourceEntry
      || sourceEntry.type !== targetEntry.type
      || sourceEntry.mode !== targetEntry.mode
      || (targetEntry.type === "file"
        && targetEntry.hash !== sourceEntry.hash
        && !incompleteFile)
      || (targetEntry.type === "symlink"
        && (targetEntry.target !== sourceEntry.target
          || !sameFileIdentity(targetEntry.identity, sourceEntry.identity)))) {
      throw journalFailure(journalPath, `${label} copy target is not source-equivalent.`);
    }
  }
  if (record.copyIntent !== null) {
    requireExactJournalKeys(
      record.copyIntent,
      ["index", "relativePath", "type", "sourceIdentity", "mode", "hash", "target"],
      `${label}.copyIntent`,
      journalPath,
    );
    const intent = record.copyIntent;
    const sourceEntry = record.copySourceManifest[intent.index];
    if (!Number.isSafeInteger(intent.index)
      || intent.index < 0
      || !sourceEntry
      || intent.relativePath !== sourceEntry.relativePath
      || intent.type !== sourceEntry.type
      || !sameFileIdentity(intent.sourceIdentity, sourceEntry.identity)
      || intent.mode !== sourceEntry.mode
      || intent.hash !== sourceEntry.hash
      || intent.target !== sourceEntry.target
      || record.copyTargetManifest.some((entry) => (
        entry.relativePath === intent.relativePath
        && entry.type !== intent.type
      ))) {
      throw journalFailure(journalPath, `${label}.copyIntent does not match its source entry.`);
    }
  }
}

function requireJournalChangeCopyProvenance(record, label, journalPath) {
  if (!Array.isArray(record.copyTargetProvenance)) {
    throw journalFailure(journalPath, `${label}.copyTargetProvenance must be an array.`);
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if ((record.copyRoot === null) !== (record.copyProvenanceToken === null)
    || (record.copyProvenanceToken !== null
      && (typeof record.copyProvenanceToken !== "string"
        || !uuid.test(record.copyProvenanceToken)))) {
    throw journalFailure(journalPath, `${label}.copyProvenanceToken contradicts its copy ledger.`);
  }
  const seen = new Set();
  for (const [index, provenance] of record.copyTargetProvenance.entries()) {
    const entryLabel = `${label}.copyTargetProvenance[${index}]`;
    requireExactJournalKeys(
      provenance,
      ["token", "index", "relativePath", "type", "mode", "targetIdentity"],
      entryLabel,
      journalPath,
    );
    requireJournalIdentity(provenance.targetIdentity, `${entryLabel}.targetIdentity`, journalPath);
    if (!Number.isInteger(provenance.mode)
      || provenance.mode < 0
      || provenance.mode > 0o777) {
      throw journalFailure(journalPath, `${entryLabel}.mode is invalid.`);
    }
    const relativePath = provenance.relativePath;
    const canonicalRelativePath = relativePath === "."
      || (typeof relativePath === "string"
        && relativePath.length > 0
        && !isAbsolute(relativePath)
        && !relativePath.includes("\\")
        && relativePath.split("/").every(
          (segment) => segment.length > 0 && segment !== "." && segment !== "..",
        ));
    const key = `${provenance.token}:${provenance.index}`;
    if (typeof provenance.token !== "string"
      || !uuid.test(provenance.token)
      || !Number.isSafeInteger(provenance.index)
      || provenance.index < 0
      || !canonicalRelativePath
      || !["directory", "file", "symlink"].includes(provenance.type)
      || seen.has(key)) {
      throw journalFailure(journalPath, `${entryLabel} is invalid or duplicated.`);
    }
    seen.add(key);
    if (provenance.token === record.copyProvenanceToken) {
      const sourceEntry = record.copySourceManifest?.[provenance.index];
      if (!sourceEntry
        || provenance.relativePath !== sourceEntry.relativePath
        || provenance.type !== sourceEntry.type
        || provenance.mode !== sourceEntry.mode) {
        throw journalFailure(journalPath, `${entryLabel} does not match its active copy source.`);
      }
    }
  }
}

function parseChangeCopyProvenanceName(name, prefix) {
  if (!name.startsWith(prefix)) return null;
  const match = /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-(\d+)-(directory|file|symlink)-(\d+)-(\d+)\.(owner|target)$/i
    .exec(name.slice(prefix.length));
  if (!match) return false;
  const index = Number(match[2]);
  if (!Number.isSafeInteger(index)) return false;
  return {
    token: match[1],
    index,
    type: match[3],
    targetIdentity: { dev: match[4], ino: match[5] },
    kind: match[6],
  };
}

async function authenticateChangeCopyTargetProvenance(
  record,
  context,
  label,
  {
    journalPath = null,
    allowMissingTarget = false,
    allowMissingEntries = false,
  } = {},
) {
  const fail = (detail) => {
    if (journalPath !== null) throw journalFailure(journalPath, `${label} ${detail}`);
    throw migrationError(`${label} ${detail}`, "CONCURRENT_CHANGE");
  };
  const anchorState = await pathState(context.anchorPath);
  if (!anchorState?.isFile()
    || anchorState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(anchorState), context.anchorIdentity)) {
    fail("lost its external transaction anchor.");
  }
  const prefix = changeCopyProvenancePrefix(record.ownerToken);
  const journalByKey = new Map(record.copyTargetProvenance.map(
    (entry) => [`${entry.token}:${entry.index}`, entry],
  ));
  const evidenceGroups = new Map();
  for (const name of await readdir(context.stagingRoot)) {
    const parsed = parseChangeCopyProvenanceName(name, prefix);
    if (parsed === null) continue;
    if (parsed === false) fail(`has malformed external provenance: ${name}.`);
    const key = `${parsed.token}:${parsed.index}`;
    const existing = evidenceGroups.get(key);
    if (existing && (
      existing.type !== parsed.type
      || !sameFileIdentity(existing.targetIdentity, parsed.targetIdentity)
      || existing[parsed.kind] !== undefined
    )) {
      fail(`has duplicate or mismatched external provenance for entry ${parsed.index}.`);
    }
    const group = existing ?? {
      token: parsed.token,
      index: parsed.index,
      type: parsed.type,
      targetIdentity: parsed.targetIdentity,
    };
    group[parsed.kind] = join(context.stagingRoot, name);
    evidenceGroups.set(key, group);
  }

  const evidenceByKey = new Map();
  for (const [key, group] of evidenceGroups) {
    if (group.owner === undefined
      || (group.type === "file") !== (group.target !== undefined)) {
      fail(`has incomplete external provenance for entry ${group.index}.`);
    }
    const recorded = journalByKey.get(key);
    const active = group.token === record.copyProvenanceToken;
    const sourceEntry = active ? record.copySourceManifest?.[group.index] : null;
    if ((!active && !recorded)
      || (active && (
        !sourceEntry
        || sourceEntry.type !== group.type
      ))) {
      fail(`has provenance that is not bound to a source entry: ${group.index}.`);
    }
    const provenance = {
      token: group.token,
      index: group.index,
      relativePath: sourceEntry?.relativePath ?? recorded.relativePath,
      type: group.type,
      mode: sourceEntry?.mode ?? recorded.mode,
      targetIdentity: group.targetIdentity,
    };
    if (recorded && (
      recorded.relativePath !== provenance.relativePath
      || recorded.type !== provenance.type
      || recorded.mode !== provenance.mode
      || !sameFileIdentity(recorded.targetIdentity, provenance.targetIdentity)
    )) {
      fail(`journal provenance does not match external entry ${group.index}.`);
    }
    const [ownerState, targetProofState] = await Promise.all([
      pathState(group.owner),
      group.target === undefined ? null : pathState(group.target),
    ]);
    if (!ownerState?.isFile()
      || ownerState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(ownerState), context.anchorIdentity)
      || (group.target !== undefined && (
        !targetProofState?.isFile()
        || targetProofState.isSymbolicLink()
        || (targetProofState.mode & 0o777) !== provenance.mode
        || !sameFileIdentity(fileIdentity(targetProofState), group.targetIdentity)
      ))) {
      fail(`external provenance changed physical identity for entry ${group.index}.`);
    }
    evidenceByKey.set(key, provenance);
  }
  for (const entry of record.copyTargetProvenance) {
    if (entry.token === record.copyProvenanceToken
      && !evidenceByKey.has(`${entry.token}:${entry.index}`)) {
      fail(`lost external provenance for active entry ${entry.index}.`);
    }
  }
  for (const evidence of evidenceByKey.values()) {
    const key = `${evidence.token}:${evidence.index}`;
    if (!journalByKey.has(key)) record.copyTargetProvenance.push(evidence);
  }

  if (record.copyProvenanceToken === null) return;
  await assertDirectoryRemovalManifest(
    record.copySourceRoot,
    record.copySourceManifest,
    `${label} source`,
  );
  const targetState = await pathState(record.copyRoot);
  const activeEvidence = new Map(
    [...evidenceByKey.values()]
      .filter((entry) => entry.token === record.copyProvenanceToken)
      .map((entry) => [entry.relativePath, entry]),
  );
  if (!targetState) {
    if (record.copyTargetManifest.length === 0 && activeEvidence.size === 0) return;
    if (!allowMissingTarget && record.removalManifest === null) {
      fail("lost its externally proven destination root.");
    }
    for (const entry of record.copyTargetManifest) {
      const evidence = activeEvidence.get(entry.relativePath);
      if (!evidence
        || evidence.type !== entry.type
        || evidence.mode !== entry.mode
        || !sameFileIdentity(evidence.targetIdentity, entry.identity)) {
        fail(`cannot authenticate missing destination entry ${entry.relativePath}.`);
      }
    }
    return;
  }
  if (!targetState.isDirectory() || targetState.isSymbolicLink()) {
    fail("destination root is not a real directory.");
  }
  const current = await collectDirectoryRemovalManifest(record.copyRoot, `${label} destination`);
  const sourceByPath = new Map(
    record.copySourceManifest.map((entry, index) => [entry.relativePath, { ...entry, index }]),
  );
  const recordedByPath = new Map(
    record.copyTargetManifest.map((entry) => [entry.relativePath, entry]),
  );
  const authenticated = [];
  for (const entry of current) {
    const sourceEntry = sourceByPath.get(entry.relativePath);
    const provenance = activeEvidence.get(entry.relativePath);
    const recorded = recordedByPath.get(entry.relativePath);
    const intentOwnsPartialFile = entry.type === "file"
      && record.copyIntent?.relativePath === entry.relativePath;
    const canonicalTasksEntry = entry.relativePath === "tasks.md"
      && ["published", "cleaned"].includes(record.tasksCanonicalizationPhase)
      && entry.type === "file"
      && sameFileIdentity(entry.identity, record.tasksCanonicalizationIdentity)
      && entry.hash === sourceHash(record.canonicalTasksSource);
    const completedWrite = recorded?.type === "file"
      && sameFileIdentity(entry.identity, recorded.identity)
      && recorded.hash === sourceHash(Buffer.alloc(0))
      && entry.hash === sourceEntry?.hash;
    if (!sourceEntry
      || sourceEntry.type !== entry.type
      || entry.mode !== sourceEntry.mode
      || !provenance
      || provenance.index !== sourceEntry.index
      || provenance.type !== entry.type
      || provenance.mode !== sourceEntry.mode
      || (!canonicalTasksEntry
        && !sameFileIdentity(provenance.targetIdentity, entry.identity))
      || (entry.type === "file"
        && entry.hash !== sourceEntry.hash
        && !intentOwnsPartialFile
        && !canonicalTasksEntry)
      || (entry.type === "symlink"
        && (entry.target !== sourceEntry.target
          || !sameFileIdentity(entry.identity, sourceEntry.identity)))
      || (recorded
        && !sameRemovalEntry(entry, recorded)
        && !completedWrite
        && !intentOwnsPartialFile
        && !canonicalTasksEntry)) {
      fail(`destination entry is not externally proven: ${entry.relativePath}.`);
    }
    const targetEvidence = removalEntryEvidence(entry);
    targetEvidence.quarantineRelativePath = entry.type === "directory"
      ? null
      : (recorded?.quarantineRelativePath ?? normalizePath(relative(
        record.copyRoot,
        join(
          dirname(removalManifestPath(record.copyRoot, entry.relativePath)),
          `.sdd-remove-${process.pid}-${randomUUID()}`,
        ),
      )));
    authenticated.push(targetEvidence);
  }
  if (record.removalManifest === null && !allowMissingEntries) {
    for (const provenance of activeEvidence.values()) {
      const canonicalizationOwnsAbsence = provenance.relativePath === "tasks.md"
        && record.tasksCanonicalizationPhase === "replacing";
      if (!current.some((entry) => entry.relativePath === provenance.relativePath)
        && !canonicalizationOwnsAbsence) {
        fail(`lost externally proven destination entry ${provenance.relativePath}.`);
      }
    }
  }
  record.copyTargetManifest = authenticated;
  if (resolve(record.copyRoot) === resolve(record.stagedPath)
    && record.stagedIdentity === null) {
    record.stagedIdentity = authenticated[0]?.identity ?? null;
  }
}


function requireExactJournalPath(actual, expected, label, journalPath) {
  if (resolve(actual) !== resolve(expected)) {
    throw journalFailure(journalPath, `${label} does not match its deterministic transaction path.`);
  }
}
function expectedTransactionStagingEntries(state) {
  const expected = new Map();
  const add = (
    path,
    kind,
    label,
    expectedHash = null,
    expectedIdentity = null,
    identityRequired = false,
  ) => {
    const resolvedPath = resolve(path);
    if (resolve(dirname(resolvedPath)) !== resolve(state.stagingRoot)) {
      throw journalFailure(state.journalPath, `${label} is not a direct staging entry.`);
    }
    const name = basename(resolvedPath);
    if (expected.has(name)) {
      throw journalFailure(state.journalPath, `${label} duplicates another staging entry.`);
    }
    expected.set(name, {
      path: resolvedPath,
      kind,
      label,
      expectedHash,
      expectedIdentity,
      identityRequired,
    });
  };
  add(
    state.journalPath,
    "file",
    "transaction journal",
    state.journalHash,
    state.journalIdentity,
    true,
  );
  add(
    state.journalWriteCleanupPath,
    "directory",
    "transaction journal cleanup reservation",
    null,
    state.journalWriteCleanupIdentity,
    true,
  );
  add(
    state.destinationManifestPath
      ?? join(state.stagingRoot, MIGRATION_DESTINATION_MANIFEST_NAME),
    "file",
    "destination manifest",
    sourceHash(destinationManifestSource(state.destinationGuards ?? [])),
    state.destinationManifestIdentity,
    true,
  );
  if (state.sourceDerivedDestinationGuards != null) {
    add(
      state.sourceDerivedManifestPath
        ?? join(state.stagingRoot, MIGRATION_SOURCE_DERIVED_MANIFEST_NAME),
      "file",
      "source-derived destination manifest",
      sourceHash(sourceDerivedManifestSource(state.sourceDerivedDestinationGuards)),
      state.sourceDerivedManifestWitnessIdentity,
      true,
    );
  }
  for (const [index, guard] of (state.destinationGuards ?? []).entries()) {
    const change = state.publishedChanges.find(
      (record) => resolve(record.destination) === resolve(guard.destination),
    );
    add(
      join(state.stagingRoot, `.destination-${index}-guard`),
      "file",
      `destinationGuards[${index}] ownership proof`,
      null,
      guard.proofIdentity ?? change?.proofIdentity ?? null,
      true,
    );
  }
  for (const [index, guard] of (state.readGuards ?? []).entries()) {
    add(
      guard.proofPath ?? join(state.stagingRoot, `.read-guard-${index}`),
      "file",
      `readGuards[${index}] ownership proof`,
      guard.hash,
      guard.proofIdentity,
      true,
    );
  }
  for (const [index, record] of state.publishedChanges.entries()) {
    let stagingEntry = null;
    if (record.stagingIdentity !== null) {
      add(
        record.stagingPath,
        "directory",
        `changes[${index}].stagingPath`,
        null,
        record.stagingIdentity,
        true,
      );
      stagingEntry = expected.get(basename(record.stagingPath));
      stagingEntry.recoveryPayloadHash = record.canonicalHash;
      stagingEntry.changePhase = record.phase;
      stagingEntry.ownershipProofPath = record.proofPath;
      stagingEntry.ownershipTasksPath = join(record.stagingPath, "payload", "tasks.md");
      stagingEntry.copyRoot = record.copyRoot;
      stagingEntry.copyTargetManifest = record.copyTargetManifest;
    }
    if (
      record.tasksCanonicalizationOriginalIdentity !== null
      && record.tasksCanonicalizationPhase !== "cleaned"
    ) {
      add(
        changeTasksCanonicalizationQuarantinePath(record),
        "file",
        `changes[${index}] tasks canonicalization quarantine`,
        record.tasksCanonicalizationOriginalHash,
        record.tasksCanonicalizationOriginalIdentity,
        true,
      );
    }
    if (record.tasksCanonicalizationOriginalIdentity !== null) {
      add(
        changeTasksCanonicalizationOwnerProofPath(record),
        "file",
        `changes[${index}] canonical tasks owner proof`,
        sourceHash(destinationManifestSource(state.destinationGuards ?? [])),
        state.destinationManifestWitnessIdentity,
        true,
      );
    }
    if (record.tasksCanonicalizationIdentity !== null) {
      add(
        changeTasksCanonicalizationProofPath(record),
        "file",
        `changes[${index}] canonical tasks identity proof`,
        sourceHash(record.canonicalTasksSource),
        record.tasksCanonicalizationIdentity,
        true,
      );
    }
    if (stagingEntry !== null) {
      stagingEntry.copySourceManifest = record.copySourceManifest;
      stagingEntry.copyIntent = record.copyIntent;
      if (record.copyRoot !== null
        && isStrictlyInside(record.stagingPath, record.copyRoot)) {
        stagingEntry.copyRecord = record;
      }
    }
    add(
      record.stagedPath,
      "directory",
      `changes[${index}].stagedPath`,
      record.canonicalHash,
      record.stagedIdentity,
      true,
    );
    const stagedEntry = expected.get(basename(record.stagedPath));
    stagedEntry.ownershipProofPath = record.proofPath;
    stagedEntry.ownershipTasksPath = join(record.stagedPath, "tasks.md");
    const canonicalStagingCopy = stagingEntry !== null
      && record.copyRoot !== null
      && resolve(record.copyRoot) === resolve(record.stagedPath)
      && resolve(record.copySourceRoot) === resolve(join(record.stagingPath, "payload"));
    const publicationCopy = record.copyRoot !== null
      && resolve(record.copyRoot) === resolve(record.destination)
      && resolve(record.copySourceRoot) === resolve(record.stagedPath);
    if (canonicalStagingCopy || publicationCopy) {
      if (stagingEntry !== null) {
        stagingEntry.copyRoot = null;
        stagingEntry.copyTargetManifest = null;
        stagingEntry.copySourceManifest = null;
        stagingEntry.copyIntent = null;
      }
      if (record.removalManifest === null) {
        stagedEntry.copyRoot = record.copyRoot;
        stagedEntry.copyTargetManifest = record.copyTargetManifest;
        stagedEntry.copySourceManifest = record.copySourceManifest;
        stagedEntry.copyIntent = record.copyIntent;
        stagedEntry.copyExternalTarget = publicationCopy;
        stagedEntry.copyRootIsTracked = canonicalStagingCopy;
        if (canonicalStagingCopy) stagedEntry.copyRecord = record;
      }
    }
    const requiresStagedIdentityEvidence = !canonicalStagingCopy && [
      "publishing",
      "staged",
      "reserved",
      "published",
      "verified",
      "removed",
    ].includes(record.phase);
    if (requiresStagedIdentityEvidence && record.stagedIdentityEvidencePath === null) {
      throw journalFailure(
        state.journalPath,
        `changes[${index}] has no external staged-directory identity proof.`,
      );
    }
    if (record.stagedIdentityEvidencePath !== null) {
      add(
        record.stagedIdentityEvidencePath,
        "file",
        `changes[${index}] staged-directory identity proof`,
        null,
        record.stagedIdentityEvidenceIdentity,
        true,
      );
      const identityEvidenceEntry = expected.get(
        basename(record.stagedIdentityEvidencePath),
      );
      identityEvidenceEntry.ownershipProofPath = record.proofPath;
      identityEvidenceEntry.ownershipTasksPath = record.stagedIdentityEvidencePath;
    }
    for (const provenance of record.copyTargetProvenance) {
      const paths = changeCopyProvenancePaths(
        state.stagingRoot,
        record.ownerToken,
        provenance,
      );
      add(
        paths.owner,
        "file",
        `changes[${index}] copy entry ${provenance.index} ownership proof`,
        null,
        state.destinationManifestWitnessIdentity,
        true,
      );
      if (paths.target !== null) {
        add(
          paths.target,
          "file",
          `changes[${index}] copy entry ${provenance.index} identity proof`,
          null,
          provenance.targetIdentity,
          true,
        );
      }
    }
    const reservationEvidence = changeReservationEvidencePaths(
      state.stagingRoot,
      record.ownerToken,
    );
    add(
      reservationEvidence.intent,
      "file",
      `changes[${index}] reservation intent`,
      null,
      record.reservationIntentIdentity,
      true,
    );
    add(
      reservationEvidence.binding,
      "file",
      `changes[${index}] reservation binding`,
      null,
      record.reservationBindingIdentity,
      true,
    );
    if (record.reservationLockProofIdentity !== null) {
      add(
        reservationEvidence.lockProof,
        "file",
        `changes[${index}] mutation-lock proof`,
        null,
        record.reservationLockProofIdentity,
        true,
      );
    }
  }
  for (const [index, record] of state.publishedBriefs.entries()) {
    if (record.briefIntentIdentity !== null) {
      if (typeof record.briefIntentSource !== "string") {
        throw journalFailure(state.journalPath, `briefs[${index}] owner intent is unauthenticated.`);
      }
      add(
        record.briefIntentPath ?? briefOwnershipIntentPath(record),
        "file",
        `briefs[${index}] owner intent`,
        sourceHash(record.briefIntentSource),
        record.briefIntentIdentity,
        true,
      );
    }
    if (record.stagingBindingIdentity !== null) {
      if (typeof record.stagingBindingSource !== "string") {
        throw journalFailure(state.journalPath, `briefs[${index}] staged-file binding is unauthenticated.`);
      }
      add(
        record.stagingBindingPath ?? briefStagingBindingPath(record),
        "file",
        `briefs[${index}] staged-file binding`,
        sourceHash(record.stagingBindingSource),
        record.stagingBindingIdentity,
        true,
      );
    }
    if (record.publicationBindingIdentity !== null) {
      if (typeof record.publicationBindingSource !== "string") {
        throw journalFailure(state.journalPath, `briefs[${index}] publication binding is unauthenticated.`);
      }
      add(
        record.publicationBindingPath ?? briefPublicationBindingPath(record),
        "file",
        `briefs[${index}] publication binding`,
        sourceHash(record.publicationBindingSource),
        record.publicationBindingIdentity,
        true,
      );
    }
    add(
      record.stagedPath,
      "file",
      `briefs[${index}].stagedPath`,
      record.hash,
      record.stagedIdentity,
      true,
    );
    if (record.stagingProofIdentity !== null) {
      const stagingProofPath = record.stagingProofPath
        ?? briefStagingProofPath(record, record.stagingProofIdentity);
      add(
        stagingProofPath,
        "file",
        `briefs[${index}] staging identity proof`,
        record.hash,
        record.stagingProofIdentity,
        true,
      );
    }
  }
  for (const [index, record] of state.writtenConfigs.entries()) {
    add(
      record.originalPath,
      "file",
      `configs[${index}].originalPath`,
      record.originalHash,
      record.originalStagedIdentity,
      true,
    );
    add(
      record.nextPath,
      "file",
      `configs[${index}].nextPath`,
      record.nextHash,
      record.nextStagedIdentity,
      true,
    );
  }
  return expected;
}

async function assertTransactionStagingInventory(state) {
  await assertTransactionStoreAnchors(state);
  const expected = expectedTransactionStagingEntries(state);
  const interruptedJournalWrite = await inspectInterruptedJournalWrite(state);
  if (interruptedJournalWrite) {
    for (const record of interruptedJournalWrite.inventory) {
      if (resolve(dirname(record.path)) !== resolve(state.stagingRoot)) continue;
      expected.set(basename(record.path), {
        path: record.path,
        kind: record.kind,
        label: record.label,
        expectedHash: record.expectedHash,
        expectedIdentity: record.expectedIdentity,
        identityRequired: true,
      });
    }
  }
  const entries = await readdir(state.stagingRoot, { withFileTypes: true });
  const seen = new Set();
  for (const entry of entries) {
    const tracked = expected.get(entry.name);
    if (!tracked) {
      throw journalFailure(
        state.journalPath,
        `Untracked migration staging entry must be preserved: ${join(state.stagingRoot, entry.name)}`,
      );
    }
    seen.add(entry.name);
    const validType = tracked.kind === "directory" ? entry.isDirectory() : entry.isFile();
    if (!validType || entry.isSymbolicLink()) {
      throw journalFailure(state.journalPath, `${tracked.label} is not a real ${tracked.kind}.`);
    }
    if (tracked.identityRequired && tracked.expectedIdentity === null) {
      throw journalFailure(state.journalPath, `${tracked.label} has no authenticated ownership identity.`);
    }
    const trackedState = await pathState(tracked.path);
    if (tracked.expectedIdentity !== null
      && (!trackedState
        || !sameFileIdentity(fileIdentity(trackedState), tracked.expectedIdentity))) {
      throw journalFailure(state.journalPath, `${tracked.label} changed physical identity.`);
    }
    const activeRemoval = state.stagingRemovalManifest !== null
      && (resolve(state.stagingRemovalRoot) === resolve(tracked.path)
        || isStrictlyInside(tracked.path, state.stagingRemovalRoot));
    if (activeRemoval) {
      await assertDirectoryRemovalSubset(
        state.stagingRemovalRoot,
        state.stagingRemovalManifest,
        state.stagingRemovalProgress,
        tracked.label,
      );
      if (resolve(state.stagingRemovalRoot) !== resolve(tracked.path)) {
        const trackedNames = await readdir(tracked.path);
        const removalExists = await pathState(state.stagingRemovalRoot);
        const expectedNames = removalExists ? [basename(state.stagingRemovalRoot)] : [];
        if (JSON.stringify(trackedNames.sort()) !== JSON.stringify(expectedNames.sort())) {
          throw journalFailure(state.journalPath, `${tracked.label} contains opaque cleanup state.`);
        }
      }
    }
    const activeCopy = tracked.copyRoot != null && !activeRemoval;
    if (activeCopy) {
      const copyRootState = await pathState(tracked.copyRoot);
      const externalCopyMissing = tracked.copyExternalTarget && !copyRootState;
      if (!externalCopyMissing) {
        if (!tracked.copyExternalTarget && !tracked.copyRootIsTracked) {
          const payloadNames = await readdir(tracked.path);
          const expectedNames = copyRootState ? [basename(tracked.copyRoot)] : [];
          if (JSON.stringify(payloadNames.sort()) !== JSON.stringify(expectedNames.sort())) {
            throw journalFailure(state.journalPath, `${tracked.label} contains opaque copy state.`);
          }
        }
        await assertCopyTargetSubset(
          tracked.copyRoot,
          tracked.copyTargetManifest,
          tracked.copySourceManifest,
          tracked.copyIntent,
          `${tracked.label} partial copy`,
        );
      }
    }
    if (!activeRemoval && !activeCopy && state.plan == null && tracked.ownershipProofPath) {
      const [proofState, tasksState] = await Promise.all([
        pathState(tracked.ownershipProofPath),
        pathState(tracked.ownershipTasksPath),
      ]);
      if (!proofState?.isFile()
        || proofState.isSymbolicLink()
        || !tasksState?.isFile()
        || tasksState.isSymbolicLink()
        || !sameFileIdentity(fileIdentity(proofState), fileIdentity(tasksState))) {
        throw journalFailure(
          state.journalPath,
          `${tracked.label} lacks a transaction-created hardlink ownership proof.`,
        );
      }
    }
    if (tracked.recoveryPayloadHash && state.plan == null && !activeRemoval && !activeCopy) {
      const payloadNames = await readdir(tracked.path);
      const emptyPublishingReservation = tracked.changePhase === "publishing"
        && payloadNames.length === 0;
      if (!emptyPublishingReservation) {
        const payloadPath = join(tracked.path, "payload");
        const payloadState = await pathState(payloadPath);
        if (payloadNames.length !== 1
          || payloadNames[0] !== "payload"
          || !payloadState?.isDirectory()
          || payloadState.isSymbolicLink()
          || await hashDirectory(payloadPath).catch(() => null) !== tracked.recoveryPayloadHash) {
          throw journalFailure(
            state.journalPath,
            `${tracked.label} contains unauthenticated partial staging state.`,
          );
        }
      }
    }
    if (!activeRemoval && !activeCopy && tracked.kind === "directory"
      && tracked.expectedHash !== null
      && await hashDirectory(tracked.path).catch(() => null) !== tracked.expectedHash) {
      throw journalFailure(state.journalPath, `${tracked.label} contains unknown staging state.`);
    }
    if (!activeRemoval && !activeCopy && tracked.kind === "file"
      && tracked.expectedHash !== null
      && await hashFile(tracked.path).catch(() => null) !== tracked.expectedHash) {
      throw journalFailure(state.journalPath, `${tracked.label} contains unknown staging state.`);
    }
    const physicalPath = await resolvePhysicalPath(tracked.path);
    if (!isStrictlyInside(state.storeAnchors.staging.physicalPath, physicalPath)) {
      throw journalFailure(state.journalPath, `${tracked.label} escapes its staging root.`);
    }
    const reboundState = await pathState(tracked.path);
    if (!reboundState
      || !sameFileIdentity(fileIdentity(reboundState), fileIdentity(trackedState))) {
      throw journalFailure(state.journalPath, `${tracked.label} changed while its staging identity was authenticated.`);
    }
    tracked.authenticatedIdentity = fileIdentity(reboundState);
  }
  for (const [name, tracked] of expected) {
    if (!seen.has(name)) {
      throw journalFailure(state.journalPath, `${tracked.label} is missing from migration staging.`);
    }
  }
  const journalState = await pathState(state.journalPath);
  if (!journalState?.isFile() || journalState.isSymbolicLink()) {
    throw journalFailure(state.journalPath, "The transaction journal is not a confined regular file.");
  }
  return expected;
}


async function removeTransactionStaging(
  state,
  {
    afterDirectoryVerification = null,
    assertRetentionAuthority = null,
    beforeQuarantine = null,
    afterQuarantine = null,
    beforeRemovalMutation = null,
  } = {},
) {
  const assertCleanupBoundary = async () => {
    await assertTransactionStoreAnchors(state, {
      staging: state.storeAnchors?.staging !== null,
    });
    if (assertRetentionAuthority) await assertRetentionAuthority();
  };
  const cleanupHooks = {
    beforeQuarantine,
    afterQuarantine,
    beforeRemovalMutation: async (details) => {
      if (beforeRemovalMutation) await beforeRemovalMutation(details);
      await assertCleanupBoundary();
    },
  };
  const expected = await assertTransactionStagingInventory(state);
  const persistStagingRemovalManifest = async (root, manifest) => {
    state.stagingRemovalRoot = root;
    state.stagingRemovalManifest = manifest;
    state.stagingRemovalProgress = [];
    await persistTransaction(state);
  };
  const persistStagingRemovalProgress = async (progress) => {
    state.stagingRemovalProgress = progress;
    await persistTransaction(state);
  };
  const clearStagingRemoval = async () => {
    state.stagingRemovalRoot = null;
    state.stagingRemovalManifest = null;
    state.stagingRemovalProgress = [];
    await persistTransaction(state);
  };
  const retireTrackedCopy = async (entry) => {
    if (!entry.copyRecord) return;
    entry.copyRecord.copyRoot = null;
    entry.copyRecord.copySourceRoot = null;
    entry.copyRecord.copySourceManifest = null;
    entry.copyRecord.copyTargetManifest = null;
    entry.copyRecord.copyProvenanceToken = null;
    entry.copyRecord.copyIntent = null;
    await persistTransaction(state);
  };
  if (state.stagingRemovalManifest !== null) {
    const activeRoot = state.stagingRemovalRoot;
    const activeEntryName = relative(state.stagingRoot, activeRoot).split(sep)[0];
    const activeEntry = expected.get(activeEntryName);
    if (!activeEntry || activeEntry.kind !== "directory") {
      throw journalFailure(state.journalPath, "Durable staging removal has no tracked directory owner.");
    }
    await removeProvenDirectoryTree(activeRoot, {
      expectedIdentity: state.stagingRemovalManifest[0].identity,
      label: activeEntry.label,
      assertBoundary: assertCleanupBoundary,
      removalManifest: state.stagingRemovalManifest,
      removalProgress: state.stagingRemovalProgress,
      persistRemovalProgress: persistStagingRemovalProgress,
      ...cleanupHooks,
    });
    await retireTrackedCopy(activeEntry);
    await clearStagingRemoval();
  }
  const journalName = basename(state.journalPath);
  const journalCleanupName = basename(state.journalWriteCleanupPath);
  const manifestName = basename(state.destinationManifestPath);
  const sourceManifestName = state.sourceDerivedDestinationGuards == null
    ? null
    : basename(state.sourceDerivedManifestPath);
  const cleanupEntries = [...expected].sort(([, left], [, right]) => (
    Number(Boolean(right.copyRootIsTracked)) - Number(Boolean(left.copyRootIsTracked))
  ));
  for (const [name, entry] of cleanupEntries) {
    if ([journalName, journalCleanupName, manifestName, sourceManifestName].includes(name)
      || !(await pathState(entry.path))) continue;
    await assertCleanupBoundary();
    if (entry.kind === "directory") {
      const directoryState = await pathState(entry.path);
      if (!directoryState?.isDirectory() || directoryState.isSymbolicLink()) {
        throw journalFailure(state.journalPath, `${entry.label} changed before cleanup.`);
      }
      let copyRemovalManifest = null;
      if (entry.copyRoot != null) {
        if (entry.copyExternalTarget) {
          throw journalFailure(
            state.journalPath,
            `${entry.label} external copy authority cannot be used for staging cleanup.`,
          );
        }
        const reconciledCopyManifest = await reconcileCopyTargetManifest(
          entry.copyRoot,
          entry.copyTargetManifest,
          entry.copySourceManifest,
          entry.copyIntent,
          `${entry.label} partial copy`,
        );
        copyRemovalManifest = entry.copyRootIsTracked
          ? reconciledCopyManifest
          : copyTargetRemovalManifest(
            entry.path,
            entry.copyRoot,
            reconciledCopyManifest,
            entry.expectedIdentity,
            directoryState.mode & 0o777,
          );
        await persistStagingRemovalManifest(entry.path, copyRemovalManifest);
      }
      await removeProvenDirectoryTree(entry.path, {
        expectedIdentity: entry.expectedIdentity ?? fileIdentity(directoryState),
        expectedHash: entry.expectedHash,
        label: entry.label,
        assertBoundary: assertCleanupBoundary,
        afterVerification: afterDirectoryVerification
          ? ({ path }) => afterDirectoryVerification({ entry, path })
          : null,
        ...cleanupHooks,
        removalManifest: copyRemovalManifest,
        persistRemovalManifest: (manifest) => persistStagingRemovalManifest(
          entry.path,
          manifest,
        ),
        persistRemovalProgress: persistStagingRemovalProgress,
      });
      await retireTrackedCopy(entry);
      await clearStagingRemoval();
    } else {
      const fileState = await pathState(entry.path);
      if (!fileState?.isFile() || fileState.isSymbolicLink()) {
        throw journalFailure(state.journalPath, `${entry.label} changed before cleanup.`);
      }
      await removeProvenFile(entry.path, {
        expectedIdentity: entry.expectedIdentity ?? fileIdentity(fileState),
        expectedHash: entry.expectedHash,
        quarantineParent: state.stagingRoot,
        label: entry.label,
        assertBoundary: assertCleanupBoundary,
        ...cleanupHooks,
      });
    }
  }
  await assertCleanupBoundary();
  const [manifestState, witnessState, digestState] = await Promise.all([
    pathState(state.destinationManifestPath),
    pathState(state.destinationManifestWitnessPath),
    pathState(state.destinationManifestDigestPath),
  ]);
  const expectedManifestHash = sourceHash(destinationManifestSource(state.destinationGuards));
  const expectedDigestSource = destinationManifestDigestSource(state.destinationGuards);
  const expectedDigestHash = sourceHash(expectedDigestSource);
  if (!manifestState?.isFile() || manifestState.isSymbolicLink()
    || !witnessState?.isFile() || witnessState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(manifestState), fileIdentity(witnessState))
    || !sameFileIdentity(
      fileIdentity(witnessState),
      state.destinationManifestWitnessIdentity,
    )
    || !digestState?.isFile() || digestState.isSymbolicLink()
    || (digestState.mode & 0o222) !== 0
    || !sameFileIdentity(fileIdentity(digestState), state.destinationManifestDigestIdentity)
    || await hashFile(state.destinationManifestPath).catch(() => null) !== expectedManifestHash
    || await readFile(state.destinationManifestDigestPath, "utf8").catch(() => null)
      !== expectedDigestSource) {
    throw journalFailure(state.journalPath, "Destination manifest authority changed before cleanup.");
  }
  let sourceManifestState = null;
  let sourceWitnessState = null;
  let sourceDigestState = null;
  let expectedSourceManifestHash = null;
  let expectedSourceDigestHash = null;
  if (state.sourceDerivedDestinationGuards != null) {
    [sourceManifestState, sourceWitnessState, sourceDigestState] = await Promise.all([
      pathState(state.sourceDerivedManifestPath),
      pathState(state.sourceDerivedManifestWitnessPath),
      pathState(state.sourceDerivedManifestDigestPath),
    ]);
    expectedSourceManifestHash = sourceHash(
      sourceDerivedManifestSource(state.sourceDerivedDestinationGuards),
    );
    const expectedSourceDigest = sourceDerivedManifestDigestSource(
      state.sourceDerivedDestinationGuards,
    );
    expectedSourceDigestHash = sourceHash(expectedSourceDigest);
    if (!sourceManifestState?.isFile() || sourceManifestState.isSymbolicLink()
      || (sourceManifestState.mode & 0o222) !== 0
      || !sourceWitnessState?.isFile() || sourceWitnessState.isSymbolicLink()
      || !sameFileIdentity(
        fileIdentity(sourceManifestState),
        fileIdentity(sourceWitnessState),
      )
      || !sameFileIdentity(
        fileIdentity(sourceWitnessState),
        state.sourceDerivedManifestWitnessIdentity,
      )
      || !sourceDigestState?.isFile() || sourceDigestState.isSymbolicLink()
      || (sourceDigestState.mode & 0o222) !== 0
      || !sameFileIdentity(
        fileIdentity(sourceDigestState),
        state.sourceDerivedManifestDigestIdentity,
      )
      || await hashFile(state.sourceDerivedManifestPath).catch(() => null)
        !== expectedSourceManifestHash
      || await readFile(state.sourceDerivedManifestDigestPath, "utf8").catch(() => null)
        !== expectedSourceDigest) {
      throw journalFailure(
        state.journalPath,
        "Source-derived manifest authority changed before cleanup.",
      );
    }
  }
  await assertCleanupBoundary();
  const journalState = await pathState(state.journalPath);
  if (!journalState?.isFile()
    || journalState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(journalState), state.journalIdentity)
    || await hashFile(state.journalPath).catch(() => null) !== state.journalHash) {
    throw journalFailure(state.journalPath, "Transaction journal changed before terminal cleanup.");
  }
  if (state.terminalCleanupPlan === null) {
    state.terminalCleanupPlan = await createTerminalCleanupPlan(state, {
      manifestState,
      witnessState,
      digestState,
      expectedManifestHash,
      expectedDigestHash,
      sourceManifestState,
      sourceWitnessState,
      sourceDigestState,
      expectedSourceManifestHash,
      expectedSourceDigestHash,
    });
    await persistTransaction(state);
  } else {
    await validateTerminalCleanupPlan(
      state.terminalCleanupPlan,
      state.destinationWorkspaceRoot,
      state.journalPath,
    );
  }
  await releaseJournalCleanupReservationForTerminalCleanup(state);
  state.terminalCleanupReceipt = await ensureTerminalCleanupReceipt(state);
  if (state.afterTransactionCleanupReceipt) {
    await state.afterTransactionCleanupReceipt({
      receiptPath: state.terminalCleanupPlan.receipt.path,
      journalPath: state.journalPath,
      stagingRoot: state.stagingRoot,
    });
  }
  await resumeTerminalCleanup(state, {
    assertRetentionAuthority,
    cleanupHooks,
  });
}
function terminalCleanupReceiptPath(destinationWorkspaceRoot, stagingRoot) {
  return join(
    getChangesRoot(destinationWorkspaceRoot),
    `${basename(stagingRoot)}${MIGRATION_TERMINAL_CLEANUP_RECEIPT_SUFFIX}`,
  );
}

function createTerminalCleanupPathRecord(kind, path) {
  path = resolve(path);
  return {
    kind,
    path,
    quarantinePath: `${path}${MIGRATION_TERMINAL_CLEANUP_QUARANTINE_SUFFIX}-${randomUUID()}`,
  };
}

function createTerminalCleanupFileRecord(kind, path, identity, hash) {
  return {
    ...createTerminalCleanupPathRecord(kind, path),
    identity,
    hash,
  };
}
function createTerminalCleanupReceiptRecord(destinationWorkspaceRoot, stagingRoot) {
  const path = resolve(terminalCleanupReceiptPath(destinationWorkspaceRoot, stagingRoot));
  const record = createTerminalCleanupPathRecord("receipt", path);
  const staging = createTerminalCleanupPathRecord(
    "receipt-staging",
    `${path}.stage-${randomUUID()}`,
  );
  const proof = createTerminalCleanupPathRecord(
    "receipt-proof",
    `${path}.proof-${randomUUID()}`,
  );
  return {
    ...record,
    stagingPath: staging.path,
    stagingQuarantinePath: staging.quarantinePath,
    proofPath: proof.path,
    proofQuarantinePath: proof.quarantinePath,
  };
}
function terminalCleanupReceiptArtifactRecords(record, identity, hash) {
  return [
    {
      kind: "receipt-staging",
      path: record.stagingPath,
      quarantinePath: record.stagingQuarantinePath,
      identity,
      hash,
    },
    {
      kind: "receipt-proof",
      path: record.proofPath,
      quarantinePath: record.proofQuarantinePath,
      identity,
      hash,
    },
    {
      kind: "receipt",
      path: record.path,
      quarantinePath: record.quarantinePath,
      identity,
      hash,
    },
  ];
}



function terminalCleanupPlanHash(plan) {
  return sourceHash(`${JSON.stringify(plan, null, 2)}\n`);
}

function terminalCleanupStagingInventoryHash(plan) {
  return sourceHash(`${JSON.stringify({
    identity: plan.stagingRoot.identity,
    journal: plan.journal,
    internalManifests: plan.internalManifests,
    receipt: plan.receipt,
    removedConfigProofs: plan.removedConfigProofs,
  }, null, 2)}\n`);
}

function terminalCleanupReceiptSource(receipt) {
  return `${JSON.stringify(receipt, null, 2)}\n`;
}

function requireTerminalCleanupHash(value, label, journalPath) {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw journalFailure(journalPath, `${label} is not a canonical sha256 hash.`);
  }
}

function requireTerminalCleanupDirectoryHash(value, label, journalPath) {
  if (typeof value !== "string"
    || !new RegExp(`^${DIRECTORY_HASH_SCHEME}:[0-9a-f]{64}$`).test(value)) {
    throw journalFailure(journalPath, `${label} is not a canonical directory hash.`);
  }
}

function requireTerminalCleanupPathRecord(record, label, journalPath) {
  requireExactJournalKeys(record, ["kind", "path", "quarantinePath"], label, journalPath);
  if (typeof record.kind !== "string" || record.kind.length === 0) {
    throw journalFailure(journalPath, `${label}.kind is invalid.`);
  }
  requireJournalString(record.path, `${label}.path`, journalPath);
  requireJournalString(record.quarantinePath, `${label}.quarantinePath`, journalPath);
  const quarantinePrefix =
    `${basename(record.path)}${MIGRATION_TERMINAL_CLEANUP_QUARANTINE_SUFFIX}-`;
  const quarantineName = basename(record.quarantinePath);
  const quarantineToken = quarantineName.startsWith(quarantinePrefix)
    ? quarantineName.slice(quarantinePrefix.length)
    : "";
  if (resolve(dirname(record.quarantinePath)) !== resolve(dirname(record.path))
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(quarantineToken)) {
    throw journalFailure(journalPath, `${label}.quarantinePath is not owner-confined.`);
  }
}

function requireTerminalCleanupFileRecord(record, label, journalPath) {
  requireExactJournalKeys(
    record,
    ["kind", "path", "quarantinePath", "identity", "hash"],
    label,
    journalPath,
  );
  requireTerminalCleanupPathRecord(
    {
      kind: record.kind,
      path: record.path,
      quarantinePath: record.quarantinePath,
    },
    label,
    journalPath,
  );
  requireJournalIdentity(record.identity, `${label}.identity`, journalPath);
  requireTerminalCleanupHash(record.hash, `${label}.hash`, journalPath);
}
function requireTerminalCleanupReceiptRecord(record, label, journalPath) {
  requireExactJournalKeys(
    record,
    [
      "kind",
      "path",
      "quarantinePath",
      "stagingPath",
      "stagingQuarantinePath",
      "proofPath",
      "proofQuarantinePath",
    ],
    label,
    journalPath,
  );
  requireTerminalCleanupPathRecord(
    {
      kind: record.kind,
      path: record.path,
      quarantinePath: record.quarantinePath,
    },
    label,
    journalPath,
  );
  for (const [kind, path, quarantinePath] of [
    ["receipt-staging", record.stagingPath, record.stagingQuarantinePath],
    ["receipt-proof", record.proofPath, record.proofQuarantinePath],
  ]) {
    requireTerminalCleanupPathRecord(
      { kind, path, quarantinePath },
      `${label}.${kind}`,
      journalPath,
    );
  }
  const stagePrefix = `${record.path}.stage-`;
  const proofPrefix = `${record.path}.proof-`;
  const stageToken = record.stagingPath.startsWith(stagePrefix)
    ? record.stagingPath.slice(stagePrefix.length)
    : "";
  const proofToken = record.proofPath.startsWith(proofPrefix)
    ? record.proofPath.slice(proofPrefix.length)
    : "";
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const paths = [
    record.path,
    record.quarantinePath,
    record.stagingPath,
    record.stagingQuarantinePath,
    record.proofPath,
    record.proofQuarantinePath,
  ].map((path) => resolve(path));
  if (!uuidPattern.test(stageToken)
    || !uuidPattern.test(proofToken)
    || new Set(paths).size !== paths.length
    || paths.some((path) => resolve(dirname(path)) !== resolve(dirname(record.path)))) {
    throw journalFailure(journalPath, `${label} stage/proof paths are not distinct randomized siblings.`);
  }
}


function requireRemovedConfigProofs(records, label, journalPath) {
  if (records === null) return;
  if (!Array.isArray(records)) {
    throw journalFailure(journalPath, `${label} must be an array or null.`);
  }
  for (const [index, record] of records.entries()) {
    const recordLabel = `${label}[${index}]`;
    requireExactJournalKeys(
      record,
      ["configPath", "phase", "original", "published"],
      recordLabel,
      journalPath,
    );
    requireJournalString(record.configPath, `${recordLabel}.configPath`, journalPath);
    if (record.phase !== "verified") {
      throw journalFailure(journalPath, `${recordLabel}.phase is not committed.`);
    }
    for (const [proofName, proof] of [
      ["original", record.original],
      ["published", record.published],
    ]) {
      const proofLabel = `${recordLabel}.${proofName}`;
      requireExactJournalKeys(proof, ["path", "identity", "hash"], proofLabel, journalPath);
      requireJournalString(proof.path, `${proofLabel}.path`, journalPath);
      requireJournalIdentity(proof.identity, `${proofLabel}.identity`, journalPath);
      requireTerminalCleanupHash(proof.hash, `${proofLabel}.hash`, journalPath);
    }
  }
}
async function validateTerminalCleanupPlan(
  plan,
  destinationWorkspaceRoot,
  journalPath,
  { journal = null } = {},
) {
  requireExactJournalKeys(
    plan,
    [
      "version",
      "transactionStatus",
      "destinationWorkspaceRoot",
      "workspaceAnchor",
      "stagingRoot",
      "journal",
      "receipt",
      "internalManifests",
      "externalWitnesses",
      "removedConfigProofs",
    ],
    "terminalCleanupPlan",
    journalPath,
  );
  if (plan.version !== MIGRATION_TERMINAL_CLEANUP_VERSION
    || !["rolling-back", "committed"].includes(plan.transactionStatus)) {
    throw journalFailure(journalPath, "Terminal cleanup plan version or status is unsupported.");
  }
  requireJournalString(
    plan.destinationWorkspaceRoot,
    "terminalCleanupPlan.destinationWorkspaceRoot",
    journalPath,
  );
  requireJournalAnchor(plan.workspaceAnchor, "terminalCleanupPlan.workspaceAnchor", journalPath);
  requireExactJournalKeys(
    plan.stagingRoot,
    ["path", "identity", "inventoryHash"],
    "terminalCleanupPlan.stagingRoot",
    journalPath,
  );
  requireJournalString(
    plan.stagingRoot.path,
    "terminalCleanupPlan.stagingRoot.path",
    journalPath,
  );
  requireJournalIdentity(
    plan.stagingRoot.identity,
    "terminalCleanupPlan.stagingRoot.identity",
    journalPath,
  );
  requireTerminalCleanupHash(
    plan.stagingRoot.inventoryHash,
    "terminalCleanupPlan.stagingRoot.inventoryHash",
    journalPath,
  );
  requireTerminalCleanupPathRecord(plan.journal, "terminalCleanupPlan.journal", journalPath);
  requireTerminalCleanupReceiptRecord(plan.receipt, "terminalCleanupPlan.receipt", journalPath);
  if (plan.journal.kind !== "journal" || plan.receipt.kind !== "receipt") {
    throw journalFailure(journalPath, "Terminal cleanup journal or receipt kind is invalid.");
  }
  if (!Array.isArray(plan.internalManifests) || !Array.isArray(plan.externalWitnesses)) {
    throw journalFailure(journalPath, "Terminal cleanup artifact records must be arrays.");
  }
  for (const [index, record] of plan.internalManifests.entries()) {
    requireTerminalCleanupFileRecord(
      record,
      `terminalCleanupPlan.internalManifests[${index}]`,
      journalPath,
    );
  }
  for (const [index, record] of plan.externalWitnesses.entries()) {
    requireTerminalCleanupFileRecord(
      record,
      `terminalCleanupPlan.externalWitnesses[${index}]`,
      journalPath,
    );
  }
  requireRemovedConfigProofs(
    plan.removedConfigProofs,
    "terminalCleanupPlan.removedConfigProofs",
    journalPath,
  );
  if ((plan.transactionStatus === "committed") !== (plan.removedConfigProofs !== null)) {
    throw journalFailure(
      journalPath,
      "Terminal cleanup configuration proof authority contradicts transaction status.",
    );
  }

  const { changesRoot, configRoot } = transactionStorePaths(destinationWorkspaceRoot);
  const stagingRoot = resolve(plan.stagingRoot.path);
  if (resolve(plan.destinationWorkspaceRoot) !== resolve(destinationWorkspaceRoot)
    || resolve(plan.journal.path) !== resolve(join(stagingRoot, MIGRATION_JOURNAL_NAME))
    || resolve(plan.receipt.path) !== resolve(
      terminalCleanupReceiptPath(destinationWorkspaceRoot, stagingRoot),
    )
    || resolve(dirname(stagingRoot)) !== resolve(changesRoot)) {
    throw journalFailure(journalPath, "Terminal cleanup owner paths are not deterministic.");
  }
  await assertChangeStoreConfinement(stagingRoot, destinationWorkspaceRoot);
  for (const path of [
    plan.receipt.path,
    plan.receipt.quarantinePath,
    plan.receipt.stagingPath,
    plan.receipt.stagingQuarantinePath,
    plan.receipt.proofPath,
    plan.receipt.proofQuarantinePath,
  ]) {
    await assertChangeStoreConfinement(path, destinationWorkspaceRoot);
    if (resolve(dirname(path)) !== resolve(changesRoot)
      || !(await isPathPhysicallyInside(changesRoot, path))) {
      throw journalFailure(journalPath, "Terminal cleanup receipt escapes the Change store.");
    }
  }

  const hasSourceManifest = plan.internalManifests.length === 2;
  const expectedInternal = [
    ["destination-manifest", join(stagingRoot, MIGRATION_DESTINATION_MANIFEST_NAME)],
    ...(hasSourceManifest
      ? [[
        "source-derived-manifest",
        join(stagingRoot, MIGRATION_SOURCE_DERIVED_MANIFEST_NAME),
      ]]
      : []),
  ];
  const expectedExternal = [
    [
      "destination-manifest-witness",
      destinationManifestWitnessPath(destinationWorkspaceRoot, stagingRoot),
    ],
    [
      "destination-manifest-digest",
      destinationManifestDigestPath(destinationWorkspaceRoot, stagingRoot),
    ],
    ...(hasSourceManifest
      ? [
        [
          "source-derived-manifest-witness",
          sourceDerivedManifestWitnessPath(destinationWorkspaceRoot, stagingRoot),
        ],
        [
          "source-derived-manifest-digest",
          sourceDerivedManifestDigestPath(destinationWorkspaceRoot, stagingRoot),
        ],
      ]
      : []),
  ];
  if (plan.internalManifests.length !== expectedInternal.length
    || plan.externalWitnesses.length !== expectedExternal.length) {
    throw journalFailure(journalPath, "Terminal cleanup artifact set is incomplete.");
  }
  for (const [index, [kind, path]] of expectedInternal.entries()) {
    const record = plan.internalManifests[index];
    if (record.kind !== kind
      || resolve(record.path) !== resolve(path)
      || resolve(dirname(record.path)) !== stagingRoot) {
      throw journalFailure(journalPath, `Terminal cleanup internal manifest ${index} is invalid.`);
    }
  }
  for (const [index, [kind, path]] of expectedExternal.entries()) {
    const record = plan.externalWitnesses[index];
    if (record.kind !== kind
      || resolve(record.path) !== resolve(path)
      || resolve(dirname(record.path)) !== resolve(configRoot)
      || !(await isPathPhysicallyInside(configRoot, record.path))
      || !(await isPathPhysicallyInside(configRoot, record.quarantinePath))) {
      throw journalFailure(journalPath, `Terminal cleanup external witness ${index} is invalid.`);
    }
  }
  if (terminalCleanupStagingInventoryHash(plan) !== plan.stagingRoot.inventoryHash) {
    throw journalFailure(journalPath, "Terminal cleanup staging inventory hash is invalid.");
  }

  if (plan.removedConfigProofs !== null) {
    for (const [index, proof] of plan.removedConfigProofs.entries()) {
      const expectedOriginal = configProofPath(stagingRoot, proof.configPath, index, "original");
      const expectedPublished = configProofPath(stagingRoot, proof.configPath, index, "next");
      const proofOwner = dirname(proof.configPath);
      if (resolve(proof.original.path) !== resolve(expectedOriginal)
        || resolve(proof.published.path) !== resolve(expectedPublished)
        || resolve(dirname(proof.original.path)) !== resolve(proofOwner)
        || resolve(dirname(proof.published.path)) !== resolve(proofOwner)
        || await pathState(proof.original.path)
        || await pathState(proof.published.path)) {
        throw journalFailure(
          journalPath,
          `Terminal cleanup removed configuration proof ${index} is not durably absent.`,
        );
      }
    }
  }

  if (journal !== null) {
    if (journal.status !== plan.transactionStatus
      || resolve(journal.destinationWorkspaceRoot) !== resolve(plan.destinationWorkspaceRoot)
      || resolve(journal.stagingRoot) !== stagingRoot
      || JSON.stringify(journal.workspaceAnchor) !== JSON.stringify(plan.workspaceAnchor)) {
      throw journalFailure(journalPath, "Terminal cleanup plan does not bind its journal roots.");
    }
    if (plan.removedConfigProofs === null) {
      if (journal.status === "committed") {
        throw journalFailure(journalPath, "Committed terminal cleanup lacks config proof authority.");
      }
    } else {
      if (!Array.isArray(journal.configs)
        || journal.configs.length !== plan.removedConfigProofs.length) {
        throw journalFailure(journalPath, "Terminal cleanup configuration proof count changed.");
      }
      for (const [index, proof] of plan.removedConfigProofs.entries()) {
        const config = journal.configs[index];
        if (resolve(config.path) !== resolve(proof.configPath)
          || config.phase !== "verified"
          || config.proofPhase !== "removed"
          || config.originalProofCleanupPath !== null
          || config.originalProofCleanupIdentity !== null
          || config.nextProofCleanupPath !== null
          || config.nextProofCleanupIdentity !== null
          || resolve(config.originalProofPath) !== resolve(proof.original.path)
          || resolve(config.nextProofPath) !== resolve(proof.published.path)
          || !sameFileIdentity(config.originalStagedIdentity, proof.original.identity)
          || !sameFileIdentity(config.nextStagedIdentity, proof.published.identity)
          || config.originalHash !== proof.original.hash
          || config.nextHash !== proof.published.hash) {
          throw journalFailure(
            journalPath,
            `Terminal cleanup configuration proof ${index} changed.`,
          );
        }
        config.authenticatedNextHash = config.nextHash;
        config.nextProofAuthenticated = false;
      }
    }
  }
  return plan;
}
async function inspectTerminalCleanupFileRecord(record, label, journalPath) {
  const inspect = async (path, phase) => {
    const before = await pathState(path);
    if (!before) return null;
    if (!before.isFile() || before.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(before), record.identity)) {
      throw journalFailure(journalPath, `${label} ${phase} changed identity.`);
    }
    const hash = await hashFile(path).catch(() => null);
    const after = await pathState(path);
    if (!after
      || !sameFileIdentity(fileIdentity(after), fileIdentity(before))
      || hash !== record.hash) {
      throw journalFailure(journalPath, `${label} ${phase} changed content.`);
    }
    return after;
  };
  const [originalState, quarantineState] = await Promise.all([
    inspect(record.path, "original"),
    inspect(record.quarantinePath, "quarantine"),
  ]);
  return { originalState, quarantineState };
}

function terminalCleanupReceiptNameInfo(name) {
  let canonicalName = name;
  let quarantined = false;
  const quarantineMarker = MIGRATION_TERMINAL_CLEANUP_QUARANTINE_SUFFIX;
  const markerIndex = canonicalName.lastIndexOf(quarantineMarker);
  if (markerIndex >= 0) {
    const token = canonicalName.slice(markerIndex + quarantineMarker.length + 1);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(token)) return null;
    canonicalName = canonicalName.slice(0, markerIndex);
    quarantined = true;
  }
  const receiptIndex = canonicalName.indexOf(
    MIGRATION_TERMINAL_CLEANUP_RECEIPT_SUFFIX,
  );
  if (receiptIndex < 0) return null;
  const receiptName = canonicalName.slice(
    0,
    receiptIndex + MIGRATION_TERMINAL_CLEANUP_RECEIPT_SUFFIX.length,
  );
  const remainder = canonicalName.slice(receiptName.length);
  let role = "receipt";
  if (remainder !== "") {
    const match = /^\.(stage|proof)-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i
      .exec(remainder);
    if (!match) return null;
    role = match[1];
  }
  const stagingName = receiptName.slice(
    0,
    -MIGRATION_TERMINAL_CLEANUP_RECEIPT_SUFFIX.length,
  );
  if (!stagingName.startsWith(MIGRATION_STAGING_PREFIX)
    || stagingName.length === MIGRATION_STAGING_PREFIX.length) return null;
  return { stagingName, quarantined, role };
}

async function assertTerminalCleanupReceiptProgress(state) {
  const receiptState = state.terminalCleanupReceipt;
  const receipt = receiptState.value;
  const plan = receipt.plan;
  await validateTerminalCleanupPlan(
    plan,
    state.destinationWorkspaceRoot,
    receiptState.path,
  );
  const receiptRecords = terminalCleanupReceiptArtifactRecords(
    plan.receipt,
    receipt.receiptIdentity,
    receiptState.hash,
  );
  let receiptPresent = false;
  for (const record of receiptRecords) {
    const progress = await inspectTerminalCleanupFileRecord(
      record,
      `Terminal cleanup ${record.kind}`,
      receiptState.path,
    );
    if (progress.originalState || progress.quarantineState) receiptPresent = true;
  }
  if (!receiptPresent) {
    throw journalFailure(receiptState.path, "Terminal cleanup receipt authority disappeared.");
  }
  const journalRecord = {
    ...plan.journal,
    identity: receipt.journalIdentity,
    hash: receipt.journalHash,
  };
  const journalProgress = await inspectTerminalCleanupFileRecord(
    journalRecord,
    "Terminal cleanup journal",
    receiptState.path,
  );
  const internalProgress = [];
  for (const record of plan.internalManifests) {
    internalProgress.push(await inspectTerminalCleanupFileRecord(
      record,
      `Terminal cleanup ${record.kind}`,
      receiptState.path,
    ));
  }
  for (const record of plan.externalWitnesses) {
    await inspectTerminalCleanupFileRecord(
      record,
      `Terminal cleanup ${record.kind}`,
      receiptState.path,
    );
  }

  const currentJournalPath = journalProgress.originalState
    ? journalRecord.path
    : journalProgress.quarantineState
      ? journalRecord.quarantinePath
      : null;
  if (currentJournalPath !== null) {
    let currentJournal;
    try {
      currentJournal = JSON.parse(await readFile(currentJournalPath, "utf8"));
    } catch (error) {
      throw journalFailure(receiptState.path, `Cannot read terminal cleanup journal: ${error.message}`);
    }
    if (JSON.stringify(currentJournal.terminalCleanupPlan) !== JSON.stringify(plan)) {
      throw journalFailure(receiptState.path, "Terminal cleanup receipt does not match its journal.");
    }
  }

  const stagingState = await pathState(plan.stagingRoot.path);
  if (!stagingState) {
    state.storeAnchors.staging = null;
    return;
  }
  if (!stagingState.isDirectory()
    || stagingState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(stagingState), plan.stagingRoot.identity)) {
    throw journalFailure(receiptState.path, "Terminal cleanup staging root changed identity.");
  }
  const allowedNames = new Set([
    basename(plan.journal.path),
    basename(plan.journal.quarantinePath),
    ...plan.internalManifests.flatMap((record) => [
      basename(record.path),
      basename(record.quarantinePath),
    ]),
  ]);
  const entries = await readdir(plan.stagingRoot.path);
  const unexpected = entries.filter((name) => !allowedNames.has(name));
  if (unexpected.length > 0) {
    throw journalFailure(
      receiptState.path,
      `Terminal cleanup staging root contains opaque state: ${unexpected.join(", ")}`,
    );
  }
  const pristine = Boolean(journalProgress.originalState)
    && !journalProgress.quarantineState
    && internalProgress.every((progress) => (
      Boolean(progress.originalState) && !progress.quarantineState
    ));
  if (pristine
    && await hashDirectory(plan.stagingRoot.path).catch(() => null)
      !== receipt.stagingRootHash) {
    throw journalFailure(receiptState.path, "Terminal cleanup staging root hash changed.");
  }
}
async function hydrateTerminalCleanupReceipt(
  candidatePath,
  destinationWorkspaceRoot,
  { allowUnpublishedStage = false } = {},
) {
  const candidateState = await pathState(candidatePath);
  if (!candidateState?.isFile() || candidateState.isSymbolicLink()) {
    throw journalFailure(candidatePath, "Terminal cleanup receipt is not a regular file.");
  }
  const candidateIdentity = fileIdentity(candidateState);
  const source = await readFile(candidatePath, "utf8").catch(() => null);
  const reboundState = await pathState(candidatePath);
  if (source === null
    || !reboundState
    || !sameFileIdentity(fileIdentity(reboundState), candidateIdentity)) {
    throw journalFailure(candidatePath, "Terminal cleanup receipt changed during authentication.");
  }
  let receipt;
  try {
    receipt = JSON.parse(source);
  } catch (error) {
    throw journalFailure(candidatePath, `Cannot read terminal cleanup receipt: ${error.message}`);
  }
  requireExactJournalKeys(
    receipt,
    [
      "version",
      "receiptIdentity",
      "journalIdentity",
      "journalHash",
      "stagingRootHash",
      "planHash",
      "removedConfigProofs",
      "plan",
    ],
    "TerminalCleanupReceipt",
    candidatePath,
  );
  if (receipt.version !== MIGRATION_TERMINAL_CLEANUP_VERSION) {
    throw journalFailure(candidatePath, "Terminal cleanup receipt version is unsupported.");
  }
  requireJournalIdentity(receipt.receiptIdentity, "TerminalCleanupReceipt.receiptIdentity", candidatePath);
  requireJournalIdentity(receipt.journalIdentity, "TerminalCleanupReceipt.journalIdentity", candidatePath);
  requireTerminalCleanupHash(receipt.journalHash, "TerminalCleanupReceipt.journalHash", candidatePath);
  requireTerminalCleanupDirectoryHash(
    receipt.stagingRootHash,
    "TerminalCleanupReceipt.stagingRootHash",
    candidatePath,
  );
  requireTerminalCleanupHash(receipt.planHash, "TerminalCleanupReceipt.planHash", candidatePath);
  requireRemovedConfigProofs(
    receipt.removedConfigProofs,
    "TerminalCleanupReceipt.removedConfigProofs",
    candidatePath,
  );
  await validateTerminalCleanupPlan(
    receipt.plan,
    destinationWorkspaceRoot,
    candidatePath,
  );
  const receiptHash = sourceHash(source);
  const receiptArtifacts = terminalCleanupReceiptArtifactRecords(
    receipt.plan.receipt,
    receipt.receiptIdentity,
    receiptHash,
  );
  const receiptPaths = receiptArtifacts.flatMap((record) => [
    resolve(record.path),
    resolve(record.quarantinePath),
  ]);
  if (!sameFileIdentity(candidateIdentity, receipt.receiptIdentity)
    || terminalCleanupPlanHash(receipt.plan) !== receipt.planHash
    || JSON.stringify(receipt.removedConfigProofs)
      !== JSON.stringify(receipt.plan.removedConfigProofs)
    || terminalCleanupReceiptSource(receipt) !== source
    || !receiptPaths.includes(resolve(candidatePath))) {
    throw journalFailure(candidatePath, "Terminal cleanup receipt provenance is invalid.");
  }
  let externallyPublished = false;
  for (const record of receiptArtifacts) {
    const progress = await inspectTerminalCleanupFileRecord(record, candidatePath);
    if (record.kind !== "receipt-staging"
      && (progress.originalState || progress.quarantineState)) {
      externallyPublished = true;
    }
  }
  if (!externallyPublished && !allowUnpublishedStage) {
    throw journalFailure(
      candidatePath,
      "Terminal cleanup receipt staging lacks a durable external identity proof.",
    );
  }

  const storeAnchors = await captureTransactionStoreAnchors(destinationWorkspaceRoot);
  const stagingState = await pathState(receipt.plan.stagingRoot.path);
  if (stagingState) {
    storeAnchors.staging = await captureDirectoryAnchor(
      receipt.plan.stagingRoot.path,
      "Migration staging root",
      "CONCURRENT_CHANGE",
    );
    if (!sameFileIdentity(storeAnchors.staging, receipt.plan.stagingRoot.identity)) {
      throw journalFailure(candidatePath, "Terminal cleanup staging identity does not match its receipt.");
    }
  }
  try {
    await assertStoredDirectoryAnchor(
      receipt.plan.workspaceAnchor.logicalPath,
      receipt.plan.workspaceAnchor,
      "Migration workspace",
    );
  } catch (error) {
    throw journalFailure(candidatePath, `Terminal cleanup workspace changed: ${error.message}`);
  }
  const terminalState = {
    plan: null,
    destinationWorkspaceRoot: resolve(destinationWorkspaceRoot),
    workspaceAnchor: receipt.plan.workspaceAnchor,
    authority: {
      planningOwners: new Set([
        receipt.plan.workspaceAnchor.logicalPath,
        receipt.plan.workspaceAnchor.physicalPath,
        resolve(destinationWorkspaceRoot),
      ]),
      repositoryOwners: new Set(),
    },
    readGuards: [],
    stagingRoot: receipt.plan.stagingRoot.path,
    journalPath: receipt.plan.journal.path,
    journalIdentity: receipt.journalIdentity,
    journalHash: receipt.journalHash,
    terminalCleanupPlan: receipt.plan,
    terminalCleanupReceipt: {
      path: receipt.plan.receipt.path,
      quarantinePath: receipt.plan.receipt.quarantinePath,
      identity: receipt.receiptIdentity,
      hash: sourceHash(source),
      source,
      value: receipt,
      artifacts: receiptArtifacts,
    },
    writtenConfigs: (receipt.removedConfigProofs ?? []).map((proof) => ({
      path: proof.configPath,
      phase: "verified",
      proofPhase: "removed",
      nextHash: proof.published.hash,
      authenticatedNextHash: proof.published.hash,
      nextProofAuthenticated: false,
    })),
    status: "terminal-cleanup",
    durable: true,
    storeAnchors,
    mutationLock: null,
    beforeJournalReplace: null,
    finished: false,
  };
  await assertTerminalCleanupReceiptProgress(terminalState);
  return terminalState;
}
async function createRemovedConfigProofs(state) {
  if (state.status !== "committed") return null;
  const records = [];
  for (const [index, config] of state.writtenConfigs.entries()) {
    if (config.phase !== "verified"
      || config.proofPhase !== "removed"
      || config.originalProofCleanupPath !== null
      || config.originalProofCleanupIdentity !== null
      || config.nextProofCleanupPath !== null
      || config.nextProofCleanupIdentity !== null
      || config.originalStagedIdentity === null
      || config.nextStagedIdentity === null
      || await pathState(config.originalProofPath)
      || await pathState(config.nextProofPath)) {
      throw journalFailure(
        state.journalPath,
        `Configuration proof ${index} is not terminal-cleanup complete.`,
      );
    }
    records.push({
      configPath: resolve(config.path),
      phase: "verified",
      original: {
        path: resolve(config.originalProofPath),
        identity: config.originalStagedIdentity,
        hash: config.originalHash,
      },
      published: {
        path: resolve(config.nextProofPath),
        identity: config.nextStagedIdentity,
        hash: config.nextHash,
      },
    });
  }
  return records;
}

async function createTerminalCleanupPlan(state, authority) {
  const stagingState = await pathState(state.stagingRoot);
  if (!stagingState?.isDirectory()
    || stagingState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(stagingState), state.storeAnchors.staging)) {
    throw journalFailure(state.journalPath, "Terminal cleanup staging root changed identity.");
  }
  const internalManifests = [
    createTerminalCleanupFileRecord(
      "destination-manifest",
      state.destinationManifestPath,
      fileIdentity(authority.manifestState),
      authority.expectedManifestHash,
    ),
    ...(authority.sourceManifestState
      ? [createTerminalCleanupFileRecord(
        "source-derived-manifest",
        state.sourceDerivedManifestPath,
        fileIdentity(authority.sourceManifestState),
        authority.expectedSourceManifestHash,
      )]
      : []),
  ];
  const externalWitnesses = [
    createTerminalCleanupFileRecord(
      "destination-manifest-witness",
      state.destinationManifestWitnessPath,
      fileIdentity(authority.witnessState),
      authority.expectedManifestHash,
    ),
    createTerminalCleanupFileRecord(
      "destination-manifest-digest",
      state.destinationManifestDigestPath,
      fileIdentity(authority.digestState),
      authority.expectedDigestHash,
    ),
    ...(authority.sourceWitnessState
      ? [
        createTerminalCleanupFileRecord(
          "source-derived-manifest-witness",
          state.sourceDerivedManifestWitnessPath,
          fileIdentity(authority.sourceWitnessState),
          authority.expectedSourceManifestHash,
        ),
        createTerminalCleanupFileRecord(
          "source-derived-manifest-digest",
          state.sourceDerivedManifestDigestPath,
          fileIdentity(authority.sourceDigestState),
          authority.expectedSourceDigestHash,
        ),
      ]
      : []),
  ];
  const plan = {
    version: MIGRATION_TERMINAL_CLEANUP_VERSION,
    transactionStatus: state.status,
    destinationWorkspaceRoot: resolve(state.destinationWorkspaceRoot),
    workspaceAnchor: state.workspaceAnchor,
    stagingRoot: {
      path: resolve(state.stagingRoot),
      identity: fileIdentity(stagingState),
      inventoryHash: "",
    },
    journal: createTerminalCleanupPathRecord("journal", state.journalPath),
    receipt: createTerminalCleanupReceiptRecord(
      state.destinationWorkspaceRoot,
      state.stagingRoot,
    ),
    internalManifests,
    externalWitnesses,
    removedConfigProofs: await createRemovedConfigProofs(state),
  };
  plan.stagingRoot.inventoryHash = terminalCleanupStagingInventoryHash(plan);
  await validateTerminalCleanupPlan(
    plan,
    state.destinationWorkspaceRoot,
    state.journalPath,
  );
  return plan;
}

async function releaseJournalCleanupReservationForTerminalCleanup(state) {
  const cleanupState = await pathState(state.journalWriteCleanupPath);
  if (!cleanupState) return;
  if (!cleanupState.isDirectory()
    || cleanupState.isSymbolicLink()
    || !sameFileIdentity(
      fileIdentity(cleanupState),
      state.journalWriteCleanupIdentity,
    )
    || (await readdir(state.journalWriteCleanupPath)).length !== 0) {
    throw journalFailure(
      state.journalPath,
      "Transaction journal cleanup reservation changed before terminal cleanup.",
    );
  }
  rmdirSync(state.journalWriteCleanupPath);
  if (pathStateSync(state.journalWriteCleanupPath)) {
    throw journalFailure(
      state.journalPath,
      "Transaction journal cleanup reservation survived terminal cleanup handoff.",
    );
  }
  await syncDirectory(state.stagingRoot);
}

async function ensureTerminalCleanupReceipt(state) {
  const plan = state.terminalCleanupPlan;
  await validateTerminalCleanupPlan(
    plan,
    state.destinationWorkspaceRoot,
    state.journalPath,
  );
  const assertPublicationBoundary = async () => {
    await assertTransactionStoreAnchors(state, { staging: false });
    const journalState = await pathState(state.journalPath);
    if (!journalState?.isFile()
      || journalState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(journalState), state.journalIdentity)
      || await hashFile(state.journalPath).catch(() => null) !== state.journalHash) {
      throw journalFailure(state.journalPath, "Terminal cleanup journal changed during receipt publication.");
    }
  };
  const candidatePaths = [
    plan.receipt.path,
    plan.receipt.quarantinePath,
    plan.receipt.proofPath,
    plan.receipt.proofQuarantinePath,
    plan.receipt.stagingPath,
    plan.receipt.stagingQuarantinePath,
  ];
  const candidateStates = await Promise.all(candidatePaths.map((path) => pathState(path)));
  const candidateIndex = candidateStates.findIndex(Boolean);
  if (candidateIndex >= 0) {
    const externallyPublished = candidateStates.slice(0, 4).some(Boolean);
    const terminalState = await hydrateTerminalCleanupReceipt(
      candidatePaths[candidateIndex],
      state.destinationWorkspaceRoot,
      { allowUnpublishedStage: true },
    );
    const receipt = terminalState.terminalCleanupReceipt.value;
    if (!sameFileIdentity(receipt.journalIdentity, state.journalIdentity)
      || receipt.journalHash !== state.journalHash
      || JSON.stringify(receipt.plan) !== JSON.stringify(plan)) {
      throw journalFailure(state.journalPath, "Terminal cleanup receipt does not bind the live journal.");
    }
    if (externallyPublished) return terminalState.terminalCleanupReceipt;

    await assertPublicationBoundary();
    await link(plan.receipt.stagingPath, plan.receipt.proofPath);
    await syncDirectory(dirname(plan.receipt.proofPath));
    const receiptArtifacts = terminalCleanupReceiptArtifactRecords(
      plan.receipt,
      receipt.receiptIdentity,
      terminalState.terminalCleanupReceipt.hash,
    );
    const assertResumedReceiptProof = async () => {
      for (const record of receiptArtifacts.slice(0, 2)) {
        const progress = await inspectTerminalCleanupFileRecord(
          record,
          terminalState.terminalCleanupReceipt.path,
        );
        if (!progress.originalState || progress.quarantineState) {
          throw journalFailure(
            state.journalPath,
            "Terminal cleanup receipt proof handoff is incomplete.",
          );
        }
      }
    };
    await assertResumedReceiptProof();
    if (state.afterTransactionCleanupReceiptProof) {
      await state.afterTransactionCleanupReceiptProof({
        receiptStagingPath: plan.receipt.stagingPath,
        receiptProofPath: plan.receipt.proofPath,
        receiptPath: plan.receipt.path,
      });
    }
    await assertPublicationBoundary();
    await assertResumedReceiptProof();
    await link(plan.receipt.proofPath, plan.receipt.path);
    await syncDirectory(dirname(plan.receipt.path));
    const publishedState = await hydrateTerminalCleanupReceipt(
      plan.receipt.path,
      state.destinationWorkspaceRoot,
    );
    return publishedState.terminalCleanupReceipt;
  }

  await assertPublicationBoundary();
  const stagingRootHash = await hashDirectory(state.stagingRoot);
  const handle = await open(plan.receipt.stagingPath, "wx", 0o400);
  const createdState = await handle.stat();
  if (!createdState.isFile()) {
    await handle.close();
    throw journalFailure(state.journalPath, "Terminal cleanup receipt staging reservation is not a file.");
  }
  const receipt = {
    version: MIGRATION_TERMINAL_CLEANUP_VERSION,
    receiptIdentity: fileIdentity(createdState),
    journalIdentity: state.journalIdentity,
    journalHash: state.journalHash,
    stagingRootHash,
    planHash: terminalCleanupPlanHash(plan),
    removedConfigProofs: plan.removedConfigProofs,
    plan,
  };
  const receiptSource = terminalCleanupReceiptSource(receipt);
  try {
    await handle.writeFile(receiptSource, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(dirname(plan.receipt.stagingPath));
  if (state.afterTransactionCleanupReceiptStage) {
    await state.afterTransactionCleanupReceiptStage({
      receiptStagingPath: plan.receipt.stagingPath,
      receiptProofPath: plan.receipt.proofPath,
      receiptPath: plan.receipt.path,
    });
  }

  await assertPublicationBoundary();
  const stagedState = await pathState(plan.receipt.stagingPath);
  if (!stagedState?.isFile()
    || stagedState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(stagedState), receipt.receiptIdentity)
    || await hashFile(plan.receipt.stagingPath).catch(() => null) !== sourceHash(receiptSource)) {
    throw journalFailure(state.journalPath, "Terminal cleanup receipt staging changed before proof publication.");
  }
  await link(plan.receipt.stagingPath, plan.receipt.proofPath);
  await syncDirectory(dirname(plan.receipt.proofPath));
  if (state.afterTransactionCleanupReceiptProof) {
    await state.afterTransactionCleanupReceiptProof({
      receiptStagingPath: plan.receipt.stagingPath,
      receiptProofPath: plan.receipt.proofPath,
      receiptPath: plan.receipt.path,
    });
  }

  await assertPublicationBoundary();
  const proofState = await pathState(plan.receipt.proofPath);
  if (!proofState?.isFile()
    || proofState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(proofState), receipt.receiptIdentity)
    || await hashFile(plan.receipt.proofPath).catch(() => null) !== sourceHash(receiptSource)) {
    throw journalFailure(state.journalPath, "Terminal cleanup receipt identity proof changed before publication.");
  }
  await link(plan.receipt.proofPath, plan.receipt.path);
  await syncDirectory(dirname(plan.receipt.path));
  const terminalState = await hydrateTerminalCleanupReceipt(
    plan.receipt.path,
    state.destinationWorkspaceRoot,
  );
  return terminalState.terminalCleanupReceipt;
}
function terminalCleanupRecordLabel(record) {
  return {
    journal: "Transaction journal",
    "destination-manifest": "Destination manifest",
    "source-derived-manifest": "Source-derived destination manifest",
    "destination-manifest-witness": "Destination manifest witness",
    "destination-manifest-digest": "Destination manifest digest",
    "source-derived-manifest-witness": "Source-derived manifest witness",
    "source-derived-manifest-digest": "Source-derived manifest digest",
    "receipt-staging": "Terminal cleanup receipt staging file",
    "receipt-proof": "Terminal cleanup receipt identity proof",
    receipt: "Terminal cleanup receipt",
  }[record.kind] ?? `Terminal cleanup ${record.kind}`;
}

async function removeTerminalCleanupFile(
  state,
  record,
  {
    assertBoundary,
    cleanupHooks = {},
    afterOriginalUnlink = null,
  },
) {
  const parent = dirname(record.path);
  const afterQuarantine = cleanupHooks.afterQuarantine
    ? async (details) => {
      await syncDirectory(parent);
      await cleanupHooks.afterQuarantine(details);
    }
    : null;
  const beforeRemovalMutation = async (details) => {
    if (cleanupHooks.beforeRemovalMutation) {
      await cleanupHooks.beforeRemovalMutation(details);
    }
    if (details.phase === "quarantine" && afterOriginalUnlink) {
      await syncDirectory(parent);
      await afterOriginalUnlink(details);
    }
  };
  await removeProvenFile(record.path, {
    expectedIdentity: record.identity,
    expectedHash: record.hash,
    quarantineParent: parent,
    quarantinePath: record.quarantinePath,
    label: terminalCleanupRecordLabel(record),
    assertBoundary,
    beforeQuarantine: cleanupHooks.beforeQuarantine,
    afterQuarantine,
    beforeRemovalMutation,
  });
  await syncDirectory(parent);
}

async function resumeTerminalCleanup(
  state,
  {
    assertRetentionAuthority = null,
    cleanupHooks = {},
  } = {},
) {
  const receiptState = state.terminalCleanupReceipt;
  if (!receiptState) {
    throw journalFailure(state.journalPath, "Terminal cleanup receipt is unavailable.");
  }
  const plan = receiptState.value.plan;
  const assertBoundary = async () => {
    await assertTransactionStoreAnchors(state, {
      staging: state.storeAnchors?.staging !== null,
    });
    if (assertRetentionAuthority) await assertRetentionAuthority();
  };
  await assertBoundary();
  await assertTerminalCleanupReceiptProgress(state);

  await removeTerminalCleanupFile(
    state,
    {
      ...plan.journal,
      identity: receiptState.value.journalIdentity,
      hash: receiptState.value.journalHash,
    },
    {
      assertBoundary,
      cleanupHooks,
      afterOriginalUnlink: state.afterTransactionJournalUnlink
        ? (details) => state.afterTransactionJournalUnlink({
          ...details,
          receiptPath: plan.receipt.path,
          stagingRoot: plan.stagingRoot.path,
        })
        : null,
    },
  );
  for (const record of plan.internalManifests) {
    await assertBoundary();
    await removeTerminalCleanupFile(state, record, {
      assertBoundary,
      cleanupHooks,
    });
  }

  const rootState = await pathState(plan.stagingRoot.path);
  if (rootState) {
    await assertBoundary();
    if (!rootState.isDirectory()
      || rootState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(rootState), plan.stagingRoot.identity)
      || (await readdir(plan.stagingRoot.path)).length !== 0) {
      throw journalFailure(receiptState.path, "Terminal cleanup staging root is not empty and identity-bound.");
    }
    assertDirectoryIdentitySync(
      plan.stagingRoot.path,
      plan.stagingRoot.identity,
      "Migration staging root",
    );
    if (readdirSync(plan.stagingRoot.path).length !== 0) {
      throw journalFailure(receiptState.path, "Terminal cleanup staging root gained opaque state.");
    }
    rmdirSync(plan.stagingRoot.path);
    if (pathStateSync(plan.stagingRoot.path)) {
      throw journalFailure(receiptState.path, "Terminal cleanup staging root was replaced during removal.");
    }
    await syncDirectory(dirname(plan.stagingRoot.path));
    state.storeAnchors.staging = null;
    if (state.afterTransactionStagingRootRemoval) {
      await state.afterTransactionStagingRootRemoval({
        stagingRoot: plan.stagingRoot.path,
        receiptPath: plan.receipt.path,
      });
    }
  } else {
    state.storeAnchors.staging = null;
  }

  for (const record of plan.externalWitnesses) {
    await assertBoundary();
    await removeTerminalCleanupFile(state, record, {
      assertBoundary,
      cleanupHooks,
      afterOriginalUnlink: state.afterTransactionWitnessUnlink
        ? (details) => state.afterTransactionWitnessUnlink({
          ...details,
          kind: record.kind,
          receiptPath: plan.receipt.path,
        })
        : null,
    });
  }

  const receiptRecords = terminalCleanupReceiptArtifactRecords(
    plan.receipt,
    receiptState.value.receiptIdentity,
    receiptState.hash,
  );
  for (const record of receiptRecords) {
    await assertBoundary();
    await assertTerminalCleanupReceiptProgress(state);
    await removeTerminalCleanupFile(
      state,
      record,
      { assertBoundary, cleanupHooks },
    );
  }
  state.terminalCleanupReceipt = null;
}


async function inspectConfigProof(
  record,
  path,
  expectedHash,
  label,
  journalPath,
  alternate = null,
) {
  if (path === null) return null;
  const quarantinePath = configRemovalQuarantinePath(path);
  if (!(await isPathPhysicallyInside(record.ownerAnchor.physicalPath, path))
    || !(await isPathPhysicallyInside(record.ownerAnchor.physicalPath, quarantinePath))) {
    throw journalFailure(journalPath, `${label} escapes its configuration owner.`);
  }
  const candidates = await Promise.all([path, quarantinePath].map(async (candidate) => {
    const state = await pathState(candidate);
    if (!state) return null;
    if (!state.isFile() || state.isSymbolicLink()) {
      throw journalFailure(journalPath, `${label} is not a regular transaction proof.`);
    }
    const source = await readFile(candidate, "utf8").catch(() => null);
    const hash = source === null ? null : sourceHash(source);
    const reboundState = await pathState(candidate);
    if (!reboundState
      || !sameFileIdentity(fileIdentity(reboundState), fileIdentity(state))) {
      throw journalFailure(journalPath, `${label} changed while its identity was authenticated.`);
    }
    if ((reboundState.mode & 0o777) !== record.originalMode) {
      throw journalFailure(journalPath, `${label} mode does not match its journal authority.`);
    }
    if (hash !== expectedHash
      && (!alternate
        || hash !== alternate.hash
        || !sameFileIdentity(fileIdentity(state), alternate.identity))) {
      throw journalFailure(journalPath, `${label} does not authenticate its journal hash.`);
    }
    return { state: reboundState, hash, source };
  }));
  const [primary, quarantined] = candidates;
  if (primary && quarantined
    && !sameFileIdentity(fileIdentity(primary.state), fileIdentity(quarantined.state))) {
    throw journalFailure(journalPath, `${label} cleanup quarantine has conflicting ownership.`);
  }
  return primary ?? quarantined;
}

function configProofCleanupBarrier(journal, record) {
  const committed = journal.status === "committed"
    && record.phase === "verified"
    && journal.sourceDerivedDestinationGuards !== null
    && journal.sources.every((source) => source.phase === "cleaned");
  const rolledBack = journal.status === "rolling-back"
    && (
      ["restoring", "restored"].includes(record.phase)
      || (record.phase === "verified" && record.originalHash === record.nextHash)
    );
  return { committed, rolledBack, satisfied: committed || rolledBack };
}

async function authenticateLiveConfig(
  record,
  expectedHash,
  expectedSource,
  label,
  journalPath,
) {
  const before = await pathState(record.path);
  const source = before?.isFile() && !before.isSymbolicLink()
    ? await readFile(record.path, "utf8").catch(() => null)
    : null;
  const after = await pathState(record.path);
  if (!(await isPathPhysicallyInside(record.ownerAnchor.physicalPath, record.path))
    || !before?.isFile()
    || before.isSymbolicLink()
    || !after?.isFile()
    || after.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(before), fileIdentity(after))
    || (after.mode & 0o777) !== record.originalMode
    || source === null
    || sourceHash(source) !== expectedHash
    || (expectedSource !== null && source !== expectedSource)) {
    throw journalFailure(journalPath, `${label} does not authenticate completed proof cleanup.`);
  }
  return { state: after, source };
}


async function recoverConfigStagingTemporary(record, index, kind, stagingRoot, journalPath) {
  const pathProperty = `${kind}WriteTemporary`;
  const identityProperty = `${kind}WriteTemporaryIdentity`;
  const temporaryPath = record[pathProperty];
  const expectedIdentity = record[identityProperty];
  if (temporaryPath === null) return false;
  const quarantinePath = configRemovalQuarantinePath(temporaryPath);
  const [primaryState, quarantineState] = await Promise.all([
    pathState(temporaryPath),
    pathState(quarantinePath),
  ]);
  if (primaryState && quarantineState
    && !sameFileIdentity(fileIdentity(primaryState), fileIdentity(quarantineState))) {
    throw journalFailure(journalPath, `configs[${index}] ${kind} staging quarantine conflicts.`);
  }
  const observedState = primaryState ?? quarantineState;
  if (!observedState) {
    const targetPath = kind === "original" ? record.originalPath : record.nextPath;
    const targetState = await pathState(targetPath);
    if (targetState
      && (
        expectedIdentity === null
        || !targetState.isFile()
        || targetState.isSymbolicLink()
        || !sameFileIdentity(fileIdentity(targetState), expectedIdentity)
      )) {
      throw journalFailure(
        journalPath,
        `configs[${index}] ${kind} staged output is not bound to its temporary intent.`,
      );
    }
    if (targetState) record[`${kind}StagedIdentity`] = expectedIdentity;
    record[pathProperty] = null;
    record[identityProperty] = null;
    return true;
  }
  if (expectedIdentity === null
    || !observedState.isFile()
    || observedState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(observedState), expectedIdentity)) {
    throw journalFailure(journalPath, `configs[${index}] ${kind} staging temporary is not intent-bound.`);
  }
  const observedPath = primaryState ? temporaryPath : quarantinePath;
  const expectedHash = await hashFile(observedPath).catch(() => null);
  const expectedSource = await readFile(observedPath, "utf8").catch(() => null);
  if (expectedHash === null || expectedSource === null
    || sourceHash(expectedSource) !== expectedHash) {
    throw journalFailure(journalPath, `configs[${index}] ${kind} staging temporary is unreadable.`);
  }
  const removed = await removeProvenFile(temporaryPath, {
    expectedIdentity: fileIdentity(observedState),
    expectedHash,
    expectedMode: observedState.mode & 0o777,
    expectedSource,
    quarantineParent: stagingRoot,
    quarantinePath,
    label: `configs[${index}] ${kind} staging temporary`,
    assertBoundary: () => isPathPhysicallyInside(stagingRoot, temporaryPath),
  });
  if (!removed) {
    throw journalFailure(journalPath, `configs[${index}] ${kind} staging temporary disappeared.`);
  }
  record[pathProperty] = null;
  record[identityProperty] = null;
  return true;
}

async function hydrateConfigProofs(record, index, stagingRoot, journalPath, journal) {
  try {
    await assertStoredDirectoryAnchor(record.ownerRoot, record.ownerAnchor, "Configuration owner");
  } catch (error) {
    throw journalFailure(journalPath, `configs[${index}].ownerAnchor is not current: ${error.message}`);
  }
  const recoveredOriginalTemporary = await recoverConfigStagingTemporary(
    record,
    index,
    "original",
    stagingRoot,
    journalPath,
  );
  const recoveredNextTemporary = await recoverConfigStagingTemporary(
    record,
    index,
    "next",
    stagingRoot,
    journalPath,
  );
  let hydrationChanged = recoveredOriginalTemporary || recoveredNextTemporary;
  record.index = index;
  record.originalProofPath = configProofPath(stagingRoot, record.path, index, "original");
  record.nextProofPath = configProofPath(stagingRoot, record.path, index, "next");
  const [stagedOriginal, stagedNext] = await Promise.all([
    readBoundRegularFile(record.originalPath, {
      ownerRoot: stagingRoot,
      expectedHash: record.originalHash,
      allowMissing: true,
      label: `configs[${index}] staged original`,
      unsafeCode: "CONCURRENT_CHANGE",
    }),
    readBoundRegularFile(record.nextPath, {
      ownerRoot: stagingRoot,
      expectedHash: record.nextHash,
      allowMissing: true,
      label: `configs[${index}] staged next`,
      unsafeCode: "CONCURRENT_CHANGE",
    }),
  ]);
  if (stagedOriginal
    && (
      stagedOriginal.source !== record.originalSource
      || stagedOriginal.mode !== record.originalMode
    )) {
    throw journalFailure(journalPath, `configs[${index}] staged original bytes or mode are not journal-bound.`);
  }
  if (stagedNext
    && (
      stagedNext.source !== record.nextSource
      || stagedNext.mode !== record.originalMode
    )) {
    throw journalFailure(journalPath, `configs[${index}] staged next bytes or mode are not journal-bound.`);
  }
  if (record.originalStagedIdentity !== null
    && (!stagedOriginal
      || !sameFileIdentity(stagedOriginal.identity, record.originalStagedIdentity))) {
    throw journalFailure(journalPath, `configs[${index}] staged original identity changed.`);
  }
  if (record.nextStagedIdentity !== null
    && (!stagedNext || !sameFileIdentity(stagedNext.identity, record.nextStagedIdentity))) {
    throw journalFailure(journalPath, `configs[${index}] staged next identity changed.`);
  }
  if (record.phase === "pending" && (stagedOriginal || stagedNext)) {
    throw journalFailure(journalPath, `configs[${index}] has unannounced staged configuration state.`);
  }
  if (record.phase === "preparing-original") {
    if (stagedNext) {
      throw journalFailure(journalPath, `configs[${index}] exposed its next configuration before intent.`);
    }
    if (stagedOriginal) {
      record.originalStagedIdentity = stagedOriginal.identity;
      record.phase = "original-prepared";
    } else {
      record.phase = "pending";
    }
  }
  if (record.phase === "original-prepared" && (!stagedOriginal || stagedNext)) {
    throw journalFailure(journalPath, `configs[${index}] original staging evidence is incomplete.`);
  }
  if (record.phase === "preparing-next") {
    if (!stagedOriginal) {
      throw journalFailure(journalPath, `configs[${index}] lost its staged original configuration.`);
    }
    if (stagedNext) {
      record.nextStagedIdentity = stagedNext.identity;
      record.phase = "prepared";
    } else {
      record.phase = "original-prepared";
    }
  }
  if ([
    "prepared",
    "replacing",
    "published",
    "verified",
    "unchanged",
    "restoring",
    "restored",
  ].includes(record.phase) && (!stagedOriginal || !stagedNext)) {
    throw journalFailure(journalPath, `configs[${index}] staged configuration evidence is incomplete.`);
  }
  let unchangedOriginal = null;
  if (record.phase === "unchanged") {
    const currentState = await pathState(record.path);
    const currentSource = currentState?.isFile() && !currentState.isSymbolicLink()
      ? await readFile(record.path, "utf8").catch(() => null)
      : null;
    const reboundState = await pathState(record.path);
    if (currentSource !== null
      && reboundState?.isFile()
      && !reboundState.isSymbolicLink()
      && sameFileIdentity(fileIdentity(currentState), fileIdentity(reboundState))
      && (reboundState.mode & 0o777) === record.originalMode
      && await isPathPhysicallyInside(record.ownerAnchor.physicalPath, record.path)) {
      unchangedOriginal = {
        hash: sourceHash(currentSource),
        identity: fileIdentity(reboundState),
        source: currentSource,
      };
    }
  }
  const expectedOriginalHash = record.authenticatedOriginalHash ?? record.originalHash;
  const expectedOriginalSource = record.authenticatedOriginalSource ?? record.originalSource;
  const originalPrimary = await inspectConfigProof(
    record,
    record.originalProofPath,
    expectedOriginalHash,
    `configs[${index}] original proof`,
    journalPath,
    unchangedOriginal,
  );
  const originalCleanup = await inspectConfigProof(
    record,
    record.originalProofCleanupPath,
    expectedOriginalHash,
    `configs[${index}] original cleanup proof`,
    journalPath,
    unchangedOriginal,
  );
  const nextPrimary = await inspectConfigProof(
    record,
    record.nextProofPath,
    record.nextHash,
    `configs[${index}] published proof`,
    journalPath,
  );
  const nextCleanup = await inspectConfigProof(
    record,
    record.nextProofCleanupPath,
    record.nextHash,
    `configs[${index}] published cleanup proof`,
    journalPath,
  );
  for (const [proof, label] of [
    [originalPrimary, "original proof"],
    [originalCleanup, "original cleanup proof"],
  ]) {
    const proofExpectedSource = proof?.hash === expectedOriginalHash
      ? expectedOriginalSource
      : unchangedOriginal?.source;
    if (proof
      && (!sameFileIdentity(fileIdentity(proof.state), record.originalIdentity)
        || proof.source !== proofExpectedSource)) {
      throw journalFailure(
        journalPath,
        `configs[${index}] ${label} does not match its bound original configuration.`,
      );
    }
  }
  for (const [proof, label] of [
    [nextPrimary, "published proof"],
    [nextCleanup, "published cleanup proof"],
  ]) {
    if (proof
      && (
        proof.source !== record.nextSource
        || record.nextProofIntentIdentity === null
        || !sameFileIdentity(
          fileIdentity(proof.state),
          record.nextProofIntentIdentity,
        )
      )) {
      throw journalFailure(
        journalPath,
        `configs[${index}] ${label} does not match its bound next configuration.`,
      );
    }
  }
  if (nextPrimary && ["published", "verified"].includes(record.phase)) {
    const livePublished = await authenticateLiveConfig(
      record,
      record.nextHash,
      record.nextSource,
      `configs[${index}] published configuration`,
      journalPath,
    );
    if (!sameFileIdentity(
      fileIdentity(livePublished.state),
      fileIdentity(nextPrimary.state),
    )) {
      throw journalFailure(
        journalPath,
        `configs[${index}] published proof does not own its live configuration.`,
      );
    }
  }
  if (record.proofPhase === "creating") {
    hydrationChanged = true;
    if (record.phase !== "pending" || originalCleanup || nextPrimary || nextCleanup) {
      throw journalFailure(journalPath, `configs[${index}] has incoherent creating proof state.`);
    }
    if (originalPrimary) {
      record.proofPhase = "present";
      record.authenticatedOriginalSource = originalPrimary.source;
      record.authenticatedOriginalHash = originalPrimary.hash;
    } else {
      record.proofPhase = "pending";
      record.authenticatedOriginalSource = null;
      record.authenticatedOriginalHash = null;
    }
  }
  if (record.proofPhase === "pending") {
    if (originalPrimary || originalCleanup || nextPrimary || nextCleanup) {
      throw journalFailure(journalPath, `configs[${index}] has an unannounced ownership proof.`);
    }
    await authenticateLiveConfig(
      record,
      record.originalHash,
      record.originalSource,
      `configs[${index}] pending original configuration`,
      journalPath,
    );
  }
  for (const [kind, primary, cleanup, identityProperty] of [
    ["original", originalPrimary, originalCleanup, "originalProofCleanupIdentity"],
    ["published", nextPrimary, nextCleanup, "nextProofCleanupIdentity"],
  ]) {
    if (!cleanup) continue;
    if (record[identityProperty] === null) {
      if (!primary
        || !sameFileIdentity(fileIdentity(primary.state), fileIdentity(cleanup.state))) {
        throw journalFailure(journalPath, `configs[${index}] ${kind} cleanup proof lacks intent ownership.`);
      }
      record[identityProperty] = fileIdentity(cleanup.state);
      hydrationChanged = true;
    } else if (!sameFileIdentity(fileIdentity(cleanup.state), record[identityProperty])) {
      throw journalFailure(journalPath, `configs[${index}] ${kind} cleanup proof identity changed.`);
    }
  }
  if (originalPrimary && originalCleanup
    && !sameFileIdentity(fileIdentity(originalPrimary.state), fileIdentity(originalCleanup.state))) {
    throw journalFailure(journalPath, `configs[${index}] original ownership proofs diverged.`);
  }
  if (nextPrimary && nextCleanup
    && !sameFileIdentity(fileIdentity(nextPrimary.state), fileIdentity(nextCleanup.state))) {
    throw journalFailure(journalPath, `configs[${index}] published ownership proofs diverged.`);
  }
  let cleanupAuthority = null;
  if (["cleaning", "removed"].includes(record.proofPhase)) {
    const barrier = configProofCleanupBarrier(journal, record);
    if (!barrier.satisfied) {
      throw journalFailure(
        journalPath,
        `configs[${index}] proof cleanup lacks a durable phase barrier.`,
      );
    }
    const expectedHash = barrier.committed
      ? record.nextHash
      : (record.authenticatedOriginalHash ?? record.originalHash);
    const expectedSource = barrier.committed
      ? record.nextSource
      : (record.authenticatedOriginalSource ?? record.originalSource);
    const live = await authenticateLiveConfig(
      record,
      expectedHash,
      expectedSource,
      `configs[${index}] live configuration`,
      journalPath,
    );
    const publishedProof = nextPrimary ?? nextCleanup;
    if (barrier.committed
      && publishedProof
      && !sameFileIdentity(fileIdentity(live.state), fileIdentity(publishedProof.state))) {
      throw journalFailure(
        journalPath,
        `configs[${index}] published proof does not own the live configuration.`,
      );
    }
    cleanupAuthority = barrier.committed ? "next" : "original";
  }
  for (const [kind, primary, cleanup, pathProperty, identityProperty] of [
    [
      "original",
      originalPrimary,
      originalCleanup,
      "originalProofCleanupPath",
      "originalProofCleanupIdentity",
    ],
    [
      "published",
      nextPrimary,
      nextCleanup,
      "nextProofCleanupPath",
      "nextProofCleanupIdentity",
    ],
  ]) {
    if (record.proofPhase !== "cleaning"
      || record[pathProperty] === null
      || cleanup) continue;
    if (record[identityProperty] === null) {
      if (!primary) {
        throw journalFailure(journalPath, `configs[${index}] lost its ${kind} cleanup intent source.`);
      }
      continue;
    }
    if (primary) {
      throw journalFailure(journalPath, `configs[${index}] lost its ${kind} cleanup ownership proof.`);
    }
    record[pathProperty] = null;
    record[identityProperty] = null;
    hydrationChanged = true;
  }
  if (record.proofPhase !== "cleaning" && (originalCleanup || nextCleanup)) {
    throw journalFailure(journalPath, `configs[${index}] has an unexpected cleanup proof.`);
  }
  const original = originalPrimary ?? originalCleanup;
  const next = nextPrimary ?? nextCleanup;
  if (record.proofPhase === "present" && !original) {
    throw journalFailure(journalPath, `configs[${index}] is missing its original ownership proof.`);
  }
  if (record.proofPhase === "present"
    && ["published", "verified"].includes(record.phase)
    && !next) {
    throw journalFailure(journalPath, `configs[${index}] is missing its published ownership proof.`);
  }
  if (record.proofPhase === "removed" && (original || next)) {
    throw journalFailure(journalPath, `configs[${index}] retained a removed ownership proof.`);
  }
  record.originalProofAuthenticated = original !== null;
  record.nextProofAuthenticated = next !== null;
  record.originalProofLocation = originalCleanup
    ? record.originalProofCleanupPath
    : originalPrimary
      ? record.originalProofPath
      : null;
  record.nextProofLocation = nextCleanup
    ? record.nextProofCleanupPath
    : nextPrimary
      ? record.nextProofPath
      : null;
  record.authenticatedOriginalHash = original?.hash
    ?? (
      cleanupAuthority === "original"
      || (record.proofPhase === "pending" && record.phase === "pending")
        ? (record.authenticatedOriginalHash ?? record.originalHash)
        : null
    );
  record.authenticatedOriginalSource = original?.source
    ?? (
      cleanupAuthority === "original"
      || (record.proofPhase === "pending" && record.phase === "pending")
        ? (record.authenticatedOriginalSource ?? record.originalSource)
        : null
    );
  record.authenticatedNextHash = next?.hash
    ?? (cleanupAuthority === "next" ? record.nextHash : null);
  return hydrationChanged;
}

async function resolveRecoveryAuthority(journal, _stagingRoot, journalPath, destinationWorkspaceRoot) {
  const workspaceConfigPath = getConfigPath(destinationWorkspaceRoot);
  const workspaceConfigRecord = journal.configs.find(
    (record) => resolve(record.path) === resolve(workspaceConfigPath),
  );
  const workspaceReadGuard = journal.readGuards.find(
    (guard) => resolve(guard.path) === resolve(workspaceConfigPath),
  );
  let config;
  try {
    const rawConfig = await readAuthenticatedRecoveryConfig(
      {
        status: journal.status,
        destinationWorkspaceRoot,
      },
      workspaceConfigPath,
      workspaceConfigRecord,
      "Workspace configuration",
      workspaceReadGuard,
    );
    config = isSupportedLegacyConfig(rawConfig)
      ? migrateConfig(rawConfig, destinationWorkspaceRoot).config
      : rawConfig;
    assertValidConfig(config, "recover an interrupted migration");
  } catch (error) {
    throw journalFailure(
      journalPath,
      `Cannot establish workspace topology authority for recovery: ${error.message}`,
    );
  }
  const planningOwners = new Set();
  const repositoryOwners = new Set();
  for (const [spaceId, space] of Object.entries(config.ideas)) {
    const planningOwner = resolveWorkspacePath(
      destinationWorkspaceRoot,
      resolveIdeaPlanningPath(config, spaceId, space),
    );
    planningOwners.add(resolve(planningOwner));
    planningOwners.add(resolve(await resolvePhysicalPath(planningOwner)));
    for (const repository of space.repositories) {
      const repositoryOwner = resolveWorkspacePath(
        destinationWorkspaceRoot,
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
    throw journalFailure(journalPath, `${label} is not owned by the configured workspace topology.`);
  }
}

async function readDestinationManifest(
  journal,
  stagingRoot,
  journalPath,
  destinationWorkspaceRoot,
) {
  const path = join(stagingRoot, MIGRATION_DESTINATION_MANIFEST_NAME);
  const witnessPath = destinationManifestWitnessPath(destinationWorkspaceRoot, stagingRoot);
  const digestPath = destinationManifestDigestPath(destinationWorkspaceRoot, stagingRoot);
  const { configRoot } = transactionStorePaths(destinationWorkspaceRoot);
  if (resolve(dirname(witnessPath)) !== resolve(configRoot)
    || !(await isPathPhysicallyInside(destinationWorkspaceRoot, witnessPath))
    || resolve(dirname(digestPath)) !== resolve(configRoot)
    || !(await isPathPhysicallyInside(destinationWorkspaceRoot, digestPath))
    || !(await isPathPhysicallyInside(stagingRoot, path))) {
    throw journalFailure(journalPath, "Destination manifest evidence escapes its transaction owner.");
  }
  const [state, witnessState, digestState] = await Promise.all([
    pathState(path),
    pathState(witnessPath),
    pathState(digestPath),
  ]);
  const expectedManifestSource = destinationManifestSource(journal.destinationGuards);
  const expectedDigestSource = destinationManifestDigestSource(journal.destinationGuards);
  let hydrated = false;

  if (journal.destinationManifestPhase === "pending") {
    if (state) {
      throw journalFailure(journalPath, "Pending destination manifest has unannounced state.");
    }
  } else if (journal.destinationManifestPhase === "creating") {
    if (state) {
      if (!state.isFile()
        || state.isSymbolicLink()
        || (state.mode & 0o222) !== 0
        || await readFile(path, "utf8").catch(() => null) !== expectedManifestSource) {
        throw journalFailure(journalPath, "Creating destination manifest is not transaction-owned.");
      }
      journal.destinationManifestIdentity = fileIdentity(state);
      journal.destinationManifestPhase = "present";
      hydrated = true;
    }
  } else if (!state?.isFile()
    || state.isSymbolicLink()
    || (state.mode & 0o222) !== 0
    || !sameFileIdentity(fileIdentity(state), journal.destinationManifestIdentity)
    || await readFile(path, "utf8").catch(() => null) !== expectedManifestSource) {
    throw journalFailure(journalPath, "Destination manifest changed after durable publication.");
  }

  if (journal.destinationManifestPhase !== "present"
    && journal.destinationManifestDigestPhase !== "pending") {
    throw journalFailure(journalPath, "Destination manifest digest precedes its manifest.");
  }
  if (journal.destinationManifestDigestPhase === "pending") {
    if (digestState) {
      throw journalFailure(journalPath, "Pending destination manifest digest has unannounced state.");
    }
  } else if (journal.destinationManifestDigestPhase === "creating") {
    if (digestState) {
      if (!digestState.isFile()
        || digestState.isSymbolicLink()
        || (digestState.mode & 0o222) !== 0
        || await readFile(digestPath, "utf8").catch(() => null) !== expectedDigestSource) {
        throw journalFailure(journalPath, "Creating destination manifest digest is not transaction-owned.");
      }
      journal.destinationManifestDigestIdentity = fileIdentity(digestState);
      journal.destinationManifestDigestPhase = "present";
      hydrated = true;
    }
  } else if (!digestState?.isFile()
    || digestState.isSymbolicLink()
    || (digestState.mode & 0o222) !== 0
    || !sameFileIdentity(fileIdentity(digestState), journal.destinationManifestDigestIdentity)
    || await readFile(digestPath, "utf8").catch(() => null) !== expectedDigestSource) {
    throw journalFailure(journalPath, "Destination manifest digest changed after durable publication.");
  }

  if (journal.destinationManifestDigestPhase !== "present"
    && journal.destinationManifestWitnessPhase !== "pending") {
    throw journalFailure(journalPath, "Destination manifest witness precedes its digest.");
  }
  if (journal.destinationManifestWitnessPhase === "pending") {
    if (witnessState) {
      throw journalFailure(journalPath, "Pending destination manifest witness has unannounced state.");
    }
  } else if (journal.destinationManifestWitnessPhase === "creating") {
    if (witnessState) {
      if (!state?.isFile()
        || !witnessState.isFile()
        || witnessState.isSymbolicLink()
        || !sameFileIdentity(fileIdentity(state), fileIdentity(witnessState))) {
        throw journalFailure(journalPath, "Creating destination manifest witness is not transaction-owned.");
      }
      journal.destinationManifestWitnessIdentity = fileIdentity(witnessState);
      journal.destinationManifestWitnessPhase = "present";
      hydrated = true;
    }
  } else if (!state?.isFile()
    || !witnessState?.isFile()
    || witnessState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(state), fileIdentity(witnessState))
    || !sameFileIdentity(
      fileIdentity(witnessState),
      journal.destinationManifestWitnessIdentity,
    )) {
    throw journalFailure(
      journalPath,
      "Destination manifest does not match its external transaction witness.",
    );
  }

  if (state) {
    let manifest;
    try {
      manifest = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      throw journalFailure(journalPath, `Cannot read destination manifest: ${error.message}`);
    }
    requireExactJournalKeys(
      manifest,
      ["version", "canonicalChangeHashScheme", "destinationGuards"],
      "destination manifest",
      journalPath,
    );
    if (manifest.version !== MIGRATION_DESTINATION_MANIFEST_VERSION
      || manifest.canonicalChangeHashScheme !== CANONICAL_CHANGE_HASH_SCHEME
      || JSON.stringify(manifest.destinationGuards)
        !== JSON.stringify(serializeDestinationGuards(journal.destinationGuards))) {
      throw journalFailure(journalPath, "Destination manifest authority does not match its journal.");
    }
  }
  return {
    path,
    witnessPath,
    witnessIdentity: journal.destinationManifestWitnessIdentity,
    digestPath,
    digestIdentity: journal.destinationManifestDigestIdentity,
    destinationGuards: serializeDestinationGuards(journal.destinationGuards),
    hydrated,
    complete: journal.destinationManifestPhase === "present"
      && journal.destinationManifestDigestPhase === "present"
      && journal.destinationManifestWitnessPhase === "present",
  };
}

async function readSourceDerivedManifest(
  stagingRoot,
  journalPath,
  destinationWorkspaceRoot,
  snapshot,
) {
  const path = join(stagingRoot, MIGRATION_SOURCE_DERIVED_MANIFEST_NAME);
  const witnessPath = sourceDerivedManifestWitnessPath(destinationWorkspaceRoot, stagingRoot);
  const digestPath = sourceDerivedManifestDigestPath(destinationWorkspaceRoot, stagingRoot);
  const [state, witnessState, digestState] = await Promise.all([
    pathState(path),
    pathState(witnessPath),
    pathState(digestPath),
  ]);
  if (snapshot === null && !state && !witnessState && !digestState) {
    return {
      path,
      witnessPath,
      witnessIdentity: null,
      digestPath,
      digestIdentity: null,
      snapshot: null,
    };
  }
  if (snapshot !== null && (typeof snapshot !== "string" || snapshot.length === 0)) {
    throw journalFailure(journalPath, "Source-derived destination guard receipt is invalid.");
  }
  const { configRoot } = transactionStorePaths(destinationWorkspaceRoot);
  if (!state?.isFile() || state.isSymbolicLink()
    || (state.mode & 0o222) !== 0
    || !(await isPathPhysicallyInside(stagingRoot, path))
    || resolve(dirname(witnessPath)) !== resolve(configRoot)
    || !(await isPathPhysicallyInside(configRoot, witnessPath))
    || !witnessState?.isFile() || witnessState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(state), fileIdentity(witnessState))
    || resolve(dirname(digestPath)) !== resolve(configRoot)
    || !(await isPathPhysicallyInside(configRoot, digestPath))
    || !digestState?.isFile() || digestState.isSymbolicLink()
    || (digestState.mode & 0o222) !== 0) {
    throw journalFailure(
      journalPath,
      "Source-derived manifest does not match its external transaction witness.",
    );
  }
  let manifest;
  let manifestSource;
  try {
    manifestSource = await readFile(path, "utf8");
    manifest = JSON.parse(manifestSource);
  } catch (error) {
    throw journalFailure(journalPath, `Cannot read source-derived manifest: ${error.message}`);
  }
  if (await readFile(digestPath, "utf8").catch(() => null)
    !== `${sourceHash(manifestSource)}\n`) {
    throw journalFailure(
      journalPath,
      "Source-derived manifest bytes do not match its digest witness.",
    );
  }
  requireExactJournalKeys(
    manifest,
    ["version", "canonicalChangeHashScheme", "changes", "briefs"],
    "source-derived manifest",
    journalPath,
  );
  if (manifest.version !== MIGRATION_SOURCE_DERIVED_MANIFEST_VERSION) {
    throw journalFailure(journalPath, "Source-derived manifest version is unsupported.");
  }
  if (manifest.canonicalChangeHashScheme !== CANONICAL_CHANGE_HASH_SCHEME) {
    throw journalFailure(
      journalPath,
      "Source-derived manifest canonical Change hash scheme is unsupported.",
    );
  }
  requireJournalRecords(
    manifest.changes,
    "source-derived Change guards",
    ["destination", "canonicalHash", "existing"],
    ["canonicalHash"],
    ["destination"],
    journalPath,
  );
  for (const [index, record] of manifest.changes.entries()) {
    requireJournalBoolean(
      record.existing,
      `source-derived Change guards[${index}].existing`,
      journalPath,
    );
  }
  requireJournalRecords(
    manifest.briefs,
    "source-derived Change Brief guards",
    ["destination", "ownerRoot", "hash"],
    ["hash"],
    ["destination", "ownerRoot"],
    journalPath,
  );
  const observedSnapshot = JSON.stringify({
    changes: manifest.changes,
    briefs: manifest.briefs,
  });
  if ((snapshot !== null && observedSnapshot !== snapshot)
    || manifestSource !== sourceDerivedManifestSource(observedSnapshot)) {
    throw journalFailure(
      journalPath,
      "Source-derived manifest does not match the durable journal receipt.",
    );
  }
  return {
    path,
    witnessPath,
    witnessIdentity: fileIdentity(witnessState),
    digestPath,
    digestIdentity: fileIdentity(digestState),
    snapshot: observedSnapshot,
  };
}

function briefPublicationCleanupBarrier(journal, record) {
  const committed = journal.status === "committed"
    && record.phase === "verified"
    && journal.sources.every((source) => source.phase === "cleaned");
  const rolledBack = journal.status === "rolling-back" && record.phase === "removed";
  return { committed, rolledBack, satisfied: committed || rolledBack };
}

async function assertPublishedBriefHash(record) {
  await assertBriefPublicationBoundary(record);
  const before = await pathState(record.destination);
  if (!before?.isFile() || before.isSymbolicLink()) {
    throw migrationError(
      `Published Change Brief is unavailable: ${record.destination}`,
      "CONCURRENT_CHANGE",
    );
  }
  const identity = fileIdentity(before);
  const hash = await hashFile(record.destination).catch(() => null);
  const after = await pathState(record.destination);
  if (!after?.isFile()
    || after.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(after), identity)
    || record.publicationBindingTargetIdentity === null
    || record.publishedIdentity === null
    || !sameFileIdentity(identity, record.publicationBindingTargetIdentity)
    || !sameFileIdentity(identity, record.publishedIdentity)
    || hash !== record.hash) {
    throw migrationError(
      `Published Change Brief changed source-derived content: ${record.destination}`,
      "CONCURRENT_CHANGE",
    );
  }
  return after;
}

async function hydrateBriefPublicationProof(record, index, journal, journalPath) {
  try {
    const barrier = briefPublicationCleanupBarrier(journal, record);
    if (record.phase === "pending") {
      const evidence = await inspectBriefPublicationProofs(record);
      if (evidence.primary || evidence.cleanup || await pathState(record.destination)) {
        throw migrationError(
          `Pending Change Brief has unexpected publication state: ${record.destination}`,
          "CONCURRENT_CHANGE",
        );
      }
      return;
    }
    if (record.phase === "prepared") {
      await adoptPreparedBriefPublication(record);
      return;
    }

    if (record.publicationProofPhase === "present") {
      const evidence = await inspectBriefPublicationProofs(record);
      const identity = await assertBriefProofMatchesRecord(record, evidence);
      if (!evidence.primary || evidence.cleanup) {
        throw migrationError(
          `Change Brief publication proof is incomplete: ${record.destination}`,
          "CONCURRENT_CHANGE",
        );
      }
      if (record.phase === "removed") {
        if (!barrier.rolledBack) {
          throw migrationError(
            `Removed Change Brief lacks a rollback cleanup barrier: ${record.destination}`,
            "CONCURRENT_CHANGE",
          );
        }
        const destinationState = await pathState(record.destination);
        if (destinationState?.isFile()
          && !destinationState.isSymbolicLink()
          && sameFileIdentity(fileIdentity(destinationState), identity)) {
          throw migrationError(
            `Removed Change Brief still matches its publication proof: ${record.destination}`,
            "CONCURRENT_CHANGE",
          );
        }
        return;
      }
      if (record.phase === "removing") {
        if (journal.status !== "rolling-back") {
          throw migrationError(
            `Change Brief removal lacks a rollback barrier: ${record.destination}`,
            "CONCURRENT_CHANGE",
          );
        }
        const destinationState = await pathState(record.destination);
        if (!destinationState) {
          record.phase = "removed";
          return;
        }
      }
      await assertBriefDestinationMatchesProof(record, identity);
      return;
    }

    if (record.publicationProofPhase === "cleaning") {
      if (!barrier.satisfied) {
        throw migrationError(
          `Change Brief proof cleanup lacks a durable barrier: ${record.destination}`,
          "CONCURRENT_CHANGE",
        );
      }
      const evidence = await inspectBriefPublicationProofs(record);
      if (evidence.identity === null) {
        if (barrier.committed) {
          await assertBriefDestinationMatchesProof(
            record,
            record.publicationBindingTargetIdentity,
          );
        } else {
          const destinationState = await pathState(record.destination);
          if (destinationState?.isFile()
            && !destinationState.isSymbolicLink()
            && sameFileIdentity(
              fileIdentity(destinationState),
              record.publicationBindingTargetIdentity,
            )) {
            throw migrationError(
              `Rolled-back Change Brief regained its published identity: ${record.destination}`,
              "CONCURRENT_CHANGE",
            );
          }
        }
        record.publicationProofIdentity = null;
        record.publicationProofCleanupPath = null;
        record.publicationProofCleanupIdentity = null;
        record.publicationProofPath = null;
        record.publicationProofPhase = "removed";
        return;
      }
      const identity = await assertBriefProofMatchesRecord(
        record,
        evidence,
        { allowCleanup: true },
      );
      if (evidence.cleanup && record.publicationProofCleanupPath === null) {
        record.publicationProofCleanupPath = evidence.cleanup.path;
        record.publicationProofCleanupIdentity = identity;
      } else if (!evidence.cleanup && record.publicationProofCleanupPath !== null) {
        throw migrationError(
          `Change Brief publication cleanup proof disappeared: ${record.destination}`,
          "CONCURRENT_CHANGE",
        );
      }
      if (barrier.committed) {
        await assertBriefDestinationMatchesProof(record, identity);
      } else {
        const destinationState = await pathState(record.destination);
        if (destinationState?.isFile()
          && !destinationState.isSymbolicLink()
          && sameFileIdentity(fileIdentity(destinationState), identity)) {
          throw migrationError(
            `Rolled-back Change Brief still matches its publication proof: ${record.destination}`,
            "CONCURRENT_CHANGE",
          );
        }
      }
      return;
    }

    if (record.publicationProofPhase === "removed") {
      if (!barrier.satisfied) {
        throw migrationError(
          `Change Brief publication proof was removed before its durable barrier: ${record.destination}`,
          "CONCURRENT_CHANGE",
        );
      }
      const evidence = await inspectBriefPublicationProofs(record);
      if (evidence.primary || evidence.cleanup) {
        throw migrationError(
          `Removed Change Brief publication proof still exists: ${record.destination}`,
          "CONCURRENT_CHANGE",
        );
      }
      if (barrier.committed) {
        await assertPublishedBriefHash(record);
      } else {
        const destinationState = await pathState(record.destination);
        if (destinationState?.isFile()
          && !destinationState.isSymbolicLink()
          && sameFileIdentity(
            fileIdentity(destinationState),
            record.publicationBindingTargetIdentity,
          )) {
          throw migrationError(
            `Rolled-back Change Brief regained its removed publication identity: ${record.destination}`,
            "CONCURRENT_CHANGE",
          );
        }
      }
      return;
    }

    throw migrationError(
      `Change Brief publication proof phase is unsupported: ${record.destination}`,
      "CONCURRENT_CHANGE",
    );
  } catch (error) {
    throw journalFailure(
      journalPath,
      `briefs[${index}] publication proof is not authentic: ${error.message}`,
    );
  }
}

async function hydrateTransaction(
  journal,
  stagingRoot,
  journalPath,
  destinationWorkspaceRoot,
  interruptedJournalWrite = null,
) {
  requireExactJournalKeys(
    journal,
    [
      "version",
      "canonicalChangeHashScheme",
      "status",
      "workspaceAnchor",
      "destinationWorkspaceRoot",
      "stagingRoot",
      "initializationPhase",
      "initializationReservationIdentity",
      "initializationBindingIdentity",
      "stagingIdentity",
      "destinationManifestPhase",
      "destinationManifestIdentity",
      "destinationManifestWitnessPhase",
      "destinationManifestDigestPhase",
      "sourceDerivedDestinationGuards",
      "destinationManifestWitnessIdentity",
      "destinationManifestDigestIdentity",
      "sourceDerivedManifestWitnessIdentity",
      "sourceDerivedManifestDigestIdentity",
      "stagingRemovalRoot",
      "stagingRemovalManifest",
      "stagingRemovalProgress",
      "terminalCleanupPlan",
      "readGuards",
      "journalWriteIdentity",
      "journalWriteCleanupIdentity",
      "journalCanonicalIdentity",
      "journalPreviousIdentity",
      "journalPreviousHash",
      "journalWriteAuthorityIdentity",
      "destinationGuards",
      "changes",
      "briefs",
      "configs",
      "sources",
    ],
    "journal",
    journalPath,
  );
  if (!journal || journal.version !== MIGRATION_JOURNAL_VERSION
    || !["applying", "rolling-back", "committed"].includes(journal.status)) {
    throw journalFailure(journalPath, "Unsupported journal version or status.");
  }
  if (journal.canonicalChangeHashScheme !== CANONICAL_CHANGE_HASH_SCHEME) {
    throw journalFailure(journalPath, "Journal canonical Change hash scheme is unsupported.");
  }
  requireJournalIdentity(
    journal.journalWriteIdentity,
    "journal.journalWriteIdentity",
    journalPath,
  );
  requireJournalIdentity(
    journal.journalWriteCleanupIdentity,
    "journal.journalWriteCleanupIdentity",
    journalPath,
  );
  requireJournalIdentity(
    journal.journalCanonicalIdentity,
    "journal.journalCanonicalIdentity",
    journalPath,
  );
  requireJournalIdentity(
    journal.journalPreviousIdentity,
    "journal.journalPreviousIdentity",
    journalPath,
    { nullable: true },
  );
  requireJournalIdentity(
    journal.journalWriteAuthorityIdentity,
    "journal.journalWriteAuthorityIdentity",
    journalPath,
  );
  if (journal.journalPreviousIdentity === null) {
    if (journal.journalPreviousHash !== null
      || !sameFileIdentity(journal.journalCanonicalIdentity, journal.journalWriteIdentity)) {
      throw journalFailure(journalPath, "First journal generation has incoherent identity authority.");
    }
  } else if (typeof journal.journalPreviousHash !== "string"
    || journal.journalPreviousHash.length === 0
    || !sameFileIdentity(journal.journalCanonicalIdentity, journal.journalPreviousIdentity)) {
    throw journalFailure(journalPath, "Journal replacement generation has incoherent identity authority.");
  }
  requireJournalAnchor(journal.workspaceAnchor, "workspaceAnchor", journalPath);
  requireJournalString(journal.destinationWorkspaceRoot, "destinationWorkspaceRoot", journalPath);
  requireJournalString(journal.stagingRoot, "stagingRoot", journalPath);
  if (resolve(journal.destinationWorkspaceRoot) !== resolve(destinationWorkspaceRoot)
    || resolve(journal.stagingRoot) !== resolve(stagingRoot)) {
    throw journalFailure(journalPath, "Journal roots do not match their containing workspace store.");
  }
  const hydratedJournalState = await pathState(journalPath);
  let hydratedJournalIdentity = null;
  let hydratedJournalHash = null;
  if (interruptedJournalWrite !== null) {
    const intendedSource = `${JSON.stringify(journal, null, 2)}\n`;
    if (intendedSource !== interruptedJournalWrite.candidateSource
      || !sameFileIdentity(
        journal.journalCanonicalIdentity,
        interruptedJournalWrite.authority.canonicalIdentity,
      )) {
      throw journalFailure(
        journalPath,
        "Hydrated journal candidate does not match its authenticated write intent.",
      );
    }
    if (hydratedJournalState) {
      if (!hydratedJournalState.isFile()
        || hydratedJournalState.isSymbolicLink()
        || !sameFileIdentity(
          fileIdentity(hydratedJournalState),
          journal.journalCanonicalIdentity,
        )) {
        throw journalFailure(journalPath, "Transaction journal changed during candidate hydration.");
      }
      hydratedJournalIdentity = journal.journalCanonicalIdentity;
      hydratedJournalHash = await hashFile(journalPath).catch(() => null);
      if (hydratedJournalHash === null) {
        throw journalFailure(journalPath, "Transaction journal bytes could not be authenticated.");
      }
    } else if (journal.journalPreviousIdentity !== null) {
      throw journalFailure(journalPath, "Previously published transaction journal disappeared.");
    }
  } else {
    const hydratedJournalSource = hydratedJournalState?.isFile()
      && !hydratedJournalState.isSymbolicLink()
      ? await readFile(journalPath, "utf8").catch(() => null)
      : null;
    if (!hydratedJournalState?.isFile()
      || hydratedJournalState.isSymbolicLink()
      || !sameFileIdentity(
        fileIdentity(hydratedJournalState),
        journal.journalCanonicalIdentity,
      )
      || hydratedJournalSource === null) {
      throw journalFailure(
        journalPath,
        "Live transaction journal does not match its declared canonical identity.",
      );
    }
    let reboundJournal;
    try {
      reboundJournal = JSON.parse(hydratedJournalSource);
    } catch (error) {
      throw journalFailure(journalPath, `Transaction journal changed during hydration: ${error.message}`);
    }
    if (JSON.stringify(reboundJournal) !== JSON.stringify(journal)) {
      throw journalFailure(journalPath, "Transaction journal changed while it was being hydrated.");
    }
    hydratedJournalIdentity = journal.journalCanonicalIdentity;
    hydratedJournalHash = sourceHash(hydratedJournalSource);
  }
  requireJournalIdentity(journal.stagingIdentity, "stagingIdentity", journalPath);
  requireJournalIdentity(
    journal.initializationReservationIdentity,
    "initializationReservationIdentity",
    journalPath,
    { nullable: true },
  );
  requireJournalIdentity(
    journal.initializationBindingIdentity,
    "initializationBindingIdentity",
    journalPath,
    { nullable: true },
  );
  requireJournalIdentity(
    journal.destinationManifestIdentity,
    "destinationManifestIdentity",
    journalPath,
    { nullable: true },
  );
  requireJournalIdentity(
    journal.destinationManifestWitnessIdentity,
    "destinationManifestWitnessIdentity",
    journalPath,
    { nullable: true },
  );
  requireJournalIdentity(
    journal.destinationManifestDigestIdentity,
    "destinationManifestDigestIdentity",
    journalPath,
    { nullable: true },
  );
  if (!["journaled", "releasing", "released"].includes(journal.initializationPhase)
    || (journal.initializationPhase === "released")
      !== (journal.initializationReservationIdentity === null
        && journal.initializationBindingIdentity === null)
    || (journal.initializationPhase !== "released"
      && (journal.initializationReservationIdentity === null
        || journal.initializationBindingIdentity === null))) {
    throw journalFailure(journalPath, "Journal initialization evidence state is incoherent.");
  }
  for (const [phase, identity, label] of [
    [journal.destinationManifestPhase, journal.destinationManifestIdentity, "manifest"],
    [
      journal.destinationManifestDigestPhase,
      journal.destinationManifestDigestIdentity,
      "manifest digest",
    ],
    [
      journal.destinationManifestWitnessPhase,
      journal.destinationManifestWitnessIdentity,
      "manifest witness",
    ],
  ]) {
    if (!["pending", "creating", "present"].includes(phase)
      || (phase === "present") !== (identity !== null)) {
      throw journalFailure(journalPath, `Destination ${label} state is incoherent.`);
    }
  }
  requireJournalRemovalState(
    {
      mode: journal.stagingRemovalManifest === null ? null : "staging",
      root: journal.stagingRemovalRoot,
      manifest: journal.stagingRemovalManifest,
      progress: journal.stagingRemovalProgress,
    },
    "journal staging removal",
    journalPath,
  );
  if (journal.stagingRemovalRoot !== null
    && (!isStrictlyInside(stagingRoot, journal.stagingRemovalRoot)
      || resolve(journal.stagingRemovalRoot) === resolve(journalPath))) {
    throw journalFailure(journalPath, "Journal staging removal root is outside removable staging state.");
  }
  if (journal.sourceDerivedDestinationGuards !== null
    && (typeof journal.sourceDerivedDestinationGuards !== "string"
      || journal.sourceDerivedDestinationGuards.length === 0)) {
    throw journalFailure(journalPath, "Source-derived destination guard receipt is invalid.");
  }
  let hydratedInitializationEvidence = false;
  requireJournalRecords(
    journal.readGuards,
    "readGuards",
    ["kind", "ownerRoot", "ownerAnchor", "ownerBinding", "path", "hash", "source", "identity", "mode", "proofIdentity", "proofPhase"],
    ["kind", "hash", "source"],
    ["ownerRoot", "path"],
    journalPath,
  );
  journal.readGuards = await Promise.all(journal.readGuards.map(async (guard, index) => {
    requireJournalIdentity(guard.identity, `readGuards[${index}].identity`, journalPath);
    requireJournalAnchor(
      guard.ownerAnchor,
      `readGuards[${index}].ownerAnchor`,
      journalPath,
    );
    requireExactJournalPath(
      guard.ownerAnchor.logicalPath,
      guard.ownerRoot,
      `readGuards[${index}].ownerAnchor.logicalPath`,
      journalPath,
    );
    requireJournalOwnerBinding(
      guard.ownerBinding,
      guard.ownerRoot,
      `readGuards[${index}].ownerBinding`,
      journalPath,
    );
    if (!Number.isInteger(guard.mode) || guard.mode < 0 || guard.mode > 0o777) {
      throw journalFailure(journalPath, `readGuards[${index}].mode is invalid.`);
    }
    requireJournalIdentity(
      guard.proofIdentity,
      `readGuards[${index}].proofIdentity`,
      journalPath,
      { nullable: true },
    );
    if (!["pending", "creating", "present"].includes(guard.proofPhase)
      || (guard.proofPhase === "pending" && guard.proofIdentity !== null)
      || (guard.proofPhase === "present" && guard.proofIdentity === null)) {
      throw journalFailure(journalPath, `readGuards[${index}] has incoherent proof state.`);
    }
    if (guard.proofPhase !== "present" && journal.status !== "applying") {
      throw journalFailure(journalPath, `readGuards[${index}] has incomplete proof state after application.`);
    }
    const hydrated = {
      ...guard,
      proofPath: readGuardProofPath(stagingRoot, index),
    };
    await assertReadGuardCurrent(hydrated, { requireProof: false });
    const proof = await readBoundRegularFile(hydrated.proofPath, {
      ownerRoot: stagingRoot,
      allowMissing: true,
      label: `readGuards[${index}] ownership proof`,
      unsafeCode: "CONCURRENT_CHANGE",
    });
    if (hydrated.proofPhase === "pending" && proof !== null) {
      throw journalFailure(journalPath, `readGuards[${index}] has an unannounced ownership proof.`);
    }
    if (hydrated.proofPhase === "creating") {
      hydratedInitializationEvidence = true;
      if (proof === null) {
        if (hydrated.proofIdentity !== null) {
          throw journalFailure(
            journalPath,
            `readGuards[${index}] durably owned creating proof disappeared.`,
          );
        }
        hydrated.proofPhase = "pending";
      } else if (hydrated.proofIdentity === null) {
        throw journalFailure(
          journalPath,
          `readGuards[${index}] creating proof lacks durable inode ownership.`,
        );
      } else if (!sameFileIdentity(proof.identity, hydrated.proofIdentity)) {
        throw journalFailure(
          journalPath,
          `readGuards[${index}] creating proof changed physical identity.`,
        );
      } else if (sourceHash(proof.source) !== hydrated.hash
        || proof.source !== hydrated.source
        || proof.mode !== hydrated.mode) {
        throw journalFailure(
          journalPath,
          `readGuards[${index}] creating proof content is not transaction-authenticated.`,
        );
      } else {
        hydrated.proofPhase = "present";
      }
    }
    if (hydrated.proofPhase === "present") await assertReadGuardCurrent(hydrated);
    return hydrated;
  }));
  requireJournalRecords(
    journal.destinationGuards,
    "destinationGuards",
    ["destination", "canonicalHash", "existing", "proofIdentity", "proofPhase"],
    ["canonicalHash"],
    ["destination"],
    journalPath,
  );
  const destinationManifest = await readDestinationManifest(
    journal,
    stagingRoot,
    journalPath,
    destinationWorkspaceRoot,
  );
  hydratedInitializationEvidence ||= destinationManifest.hydrated;
  if (JSON.stringify(destinationManifest.destinationGuards)
    !== JSON.stringify(serializeDestinationGuards(journal.destinationGuards))) {
    throw journalFailure(journalPath, "Journal destination guards do not match the durable manifest.");
  }
  const sourceDerivedManifest = await readSourceDerivedManifest(
    stagingRoot,
    journalPath,
    destinationWorkspaceRoot,
    journal.sourceDerivedDestinationGuards,
  );
  requireJournalIdentity(
    journal.sourceDerivedManifestWitnessIdentity,
    "sourceDerivedManifestWitnessIdentity",
    journalPath,
    { nullable: true },
  );
  requireJournalIdentity(
    journal.sourceDerivedManifestDigestIdentity,
    "sourceDerivedManifestDigestIdentity",
    journalPath,
    { nullable: true },
  );
  const hasSourceDerivedManifest = journal.sourceDerivedDestinationGuards !== null;
  if (hasSourceDerivedManifest !== (journal.sourceDerivedManifestWitnessIdentity !== null)
    || hasSourceDerivedManifest !== (journal.sourceDerivedManifestDigestIdentity !== null)
    || (hasSourceDerivedManifest && (
      !sameFileIdentity(
        sourceDerivedManifest.witnessIdentity,
        journal.sourceDerivedManifestWitnessIdentity,
      )
      || !sameFileIdentity(
        sourceDerivedManifest.digestIdentity,
        journal.sourceDerivedManifestDigestIdentity,
      )
    ))) {
    throw journalFailure(
      journalPath,
      "Source-derived manifest external identity witnesses changed.",
    );
  }
  const destinationGuardByPath = new Map();
  const destinationGuards = journal.destinationGuards.map((record, index) => {
    const changeId = basename(record.destination);
    if (!isValidChangeId(changeId)) {
      throw journalFailure(
        journalPath,
        `destinationGuards[${index}].destination has an invalid Change ID.`,
      );
    }
    const canonicalDestinations = [
      getActiveChangePath(changeId, destinationWorkspaceRoot),
      getClosedChangePath(changeId, destinationWorkspaceRoot),
    ].map((path) => resolve(path));
    const destination = resolve(record.destination);
    if (!canonicalDestinations.includes(destination)) {
      throw journalFailure(
        journalPath,
        `destinationGuards[${index}].destination is outside canonical Change locations.`,
      );
    }
    requireJournalBoolean(record.existing, `destinationGuards[${index}].existing`, journalPath);
    requireJournalIdentity(
      record.proofIdentity,
      `destinationGuards[${index}].proofIdentity`,
      journalPath,
      { nullable: true },
    );
    if (!["pending", "creating", "present"].includes(record.proofPhase)
      || (record.proofPhase === "pending") !== (record.proofIdentity === null)
      || (!record.existing && record.proofPhase === "creating")
      || (journal.status === "committed" && record.proofPhase !== "present")) {
      throw journalFailure(
        journalPath,
        `destinationGuards[${index}] has incoherent proof state.`,
      );
    }
    if (destinationGuardByPath.has(destination)) {
      throw journalFailure(journalPath, `destinationGuards[${index}].destination is duplicated.`);
    }
    const hydrated = {
      ...record,
      proofPath: destinationGuardProofPath(stagingRoot, index),
    };
    destinationGuardByPath.set(destination, hydrated);
    return hydrated;
  });
  for (const [index, guard] of destinationGuards.entries()) {
    if (!guard.existing) continue;
    const guardHydrated = await hydrateExistingDestinationGuardProof(
      guard,
      index,
      stagingRoot,
      journalPath,
      destinationWorkspaceRoot,
    );
    hydratedInitializationEvidence ||= guardHydrated;
  }
  requireJournalRecords(
    journal.changes,
    "changes",
    [
      "changeId",
      "spaceId",
      "repositories",
      "closed",
      "sources",
      "existing",
      "destination",
      "canonicalHash",
      "canonicalTasksSource",
      "proofPath",
      "stagedPath",
      "stagingPath",
      "stagingIdentity",
      "stagedIdentity",
      "proofIdentity",
      "tasksCanonicalizationPhase",
      "tasksCanonicalizationOriginalIdentity",
      "tasksCanonicalizationOriginalHash",
      "tasksCanonicalizationIdentity",
      "ownerToken",
      "reservationIdentity",
      "reservationIntentIdentity",
      "reservationBindingIdentity",
      "reservationLockProofIdentity",
      "reserved",
      "published",
      "copyRoot",
      "copySourceRoot",
      "copySourceManifest",
      "copyTargetManifest",
      "copyProvenanceToken",
      "copyTargetProvenance",
      "copyIntent",
      "removalMode",
      "removalRoot",
      "removalManifest",
      "removalProgress",
      "phase",
    ],
    ["changeId", "spaceId", "canonicalHash", "canonicalTasksSource", "ownerToken"],
    ["destination", "proofPath", "stagedPath", "stagingPath"],
    journalPath,
  );
  requireJournalRecords(
    journal.briefs,
    "briefs",
    [
      "kind",
      "spaceId",
      "sourcePath",
      "source",
      "destination",
      "ownerRoot",
      "ownerAnchor",
      "stagedPath",
      "stagedIdentity",
      "stagingProofIdentity",
      "briefIntentIdentity",
      "stagingBindingIdentity",
      "publicationBindingIdentity",
      "publishedIdentity",
      "publicationProofIdentity",
      "publicationProofCleanupPath",
      "publicationProofCleanupIdentity",
      "publicationProofPhase",
      "hash",
      "published",
      "phase",
    ],
    ["kind", "spaceId", "source", "hash"],
    ["sourcePath", "destination", "ownerRoot", "stagedPath"],
    journalPath,
  );
  requireJournalRecords(
    journal.configs,
    "configs",
    [
      "kind",
      "path",
      "ownerRoot",
      "ownerAnchor",
      "originalSource",
      "originalIdentity",
      "originalMode",
      "originalOwnerBinding",
      "originalHash",
      "nextSource",
      "nextHash",
      "fromVersion",
      "fromSchema",
      "toVersion",
      "toSchema",
      "authenticatedOriginalSource",
      "authenticatedOriginalHash",
      "authenticatedNextHash",
      "originalPath",
      "nextPath",
      "originalStagedIdentity",
      "nextStagedIdentity",
      "originalWriteTemporary",
      "originalWriteTemporaryIdentity",
      "nextWriteTemporary",
      "nextWriteTemporaryIdentity",
      "replacementTemporary",
      "replacementBackup",
      "originalProofCleanupPath",
      "originalProofCleanupIdentity",
      "nextProofCleanupPath",
      "nextProofCleanupIdentity",
      "nextProofIntentIdentity",
      "restoredIdentity",
      "proofPhase",
      "phase",
    ],
    ["kind", "originalSource", "originalHash", "nextSource", "nextHash", "fromSchema", "toSchema"],
    ["path", "ownerRoot", "originalPath", "nextPath"],
    journalPath,
  );
  requireJournalRecords(
    journal.sources,
    "sources",
    [
      "path",
      "hash",
      "ownerRoot",
      "physicalPath",
      "identity",
      "ownerPhysicalPath",
      "ownerIdentity",
      "backup",
      "backupIdentity",
      "backupMode",
      "backupPayloadIdentity",
      "backupProofToken",
      "backupProofRoot",
      "backupProofRootIdentity",
      "backupProofOwnerPath",
      "backupProofOwnerIdentity",
      "backupProofReceiptPath",
      "backupProofReceiptIdentity",
      "backupProofOwnerCleanupPath",
      "backupProofOwnerCleanupIdentity",
      "backupProofReceiptCleanupPath",
      "backupProofReceiptCleanupIdentity",
      "backupEntryProvenance",
      "backupProofPhase",
      "backupProofRemovalManifest",
      "backupProofRemovalProgress",
      "restoreIdentity",
      "restoreReservationToken",
      "restoreIntentIdentity",
      "restoreCopyRoot",
      "restoreCopySourceRoot",
      "restoreCopySourceManifest",
      "restoreCopyTargetManifest",
      "restoreCopyProvenanceToken",
      "restoreCopyTargetProvenance",
      "restoreCopyIntent",
      "cleanupPath",
      "cleanupIdentity",
      "cleanupMode",
      "removalMode",
      "removalRoot",
      "removalManifest",
      "removalProgress",
      "copyRoot",
      "copySourceRoot",
      "copySourceManifest",
      "copyTargetManifest",
      "copyIntent",
      "phase",
    ],
    ["hash"],
    [
      "path",
      "ownerRoot",
      "physicalPath",
      "ownerPhysicalPath",
      "backup",
      "backupProofToken",
      "backupProofRoot",
      "backupProofOwnerPath",
      "backupProofReceiptPath",
      "backupProofOwnerCleanupPath",
      "backupProofReceiptCleanupPath",
    ],
    journalPath,
  );
  for (const [index, record] of journal.changes.entries()) {
    const changeId = basename(record.destination);
    const repositories = Array.isArray(record.repositories)
      ? [...new Set(record.repositories)]
        .filter((value) => typeof value === "string" && value.length > 0)
        .sort((left, right) => left.localeCompare(right))
      : [];
    const sources = Array.isArray(record.sources)
      ? [...new Set(record.sources)]
        .filter((value) => typeof value === "string" && isAbsolute(value))
        .sort((left, right) => left.localeCompare(right))
      : [];
    if (!isValidChangeId(changeId)
      || record.changeId !== changeId
      || repositories.length === 0
      || JSON.stringify(repositories) !== JSON.stringify(record.repositories)
      || sources.length === 0
      || JSON.stringify(sources) !== JSON.stringify(record.sources)
      || typeof record.closed !== "boolean"
      || record.existing !== false) {
      throw journalFailure(journalPath, `changes[${index}] has invalid immutable plan authority.`);
    }
    const activePath = getActiveChangePath(changeId, destinationWorkspaceRoot);
    const closedPath = getClosedChangePath(changeId, destinationWorkspaceRoot);
    if (![resolve(activePath), resolve(closedPath)].includes(resolve(record.destination))
      || record.closed !== (resolve(record.destination) === resolve(closedPath))) {
      throw journalFailure(journalPath, `changes[${index}].destination is outside canonical Change locations.`);
    }
    requireExactJournalPath(
      record.stagedPath,
      join(stagingRoot, changeId),
      `changes[${index}].stagedPath`,
      journalPath,
    );
    const stagingPrefix = `.change-stage-${record.ownerToken}-`;
    const stagingName = basename(record.stagingPath);
    if (resolve(dirname(record.stagingPath)) !== resolve(stagingRoot)
      || !stagingName.startsWith(stagingPrefix)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(stagingName.slice(stagingPrefix.length))) {
      throw journalFailure(journalPath, `changes[${index}].stagingPath is not migration-generated.`);
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(record.ownerToken)) {
      throw journalFailure(journalPath, `changes[${index}].ownerToken is not a migration-generated token.`);
    }
    requireJournalBoolean(record.reserved, `changes[${index}].reserved`, journalPath);
    requireJournalBoolean(record.published, `changes[${index}].published`, journalPath);
    requireJournalIdentity(
      record.reservationIdentity,
      `changes[${index}].reservationIdentity`,
      journalPath,
      { nullable: true },
    );
    requireJournalIdentity(
      record.reservationIntentIdentity,
      `changes[${index}].reservationIntentIdentity`,
      journalPath,
      { nullable: true },
    );
    requireJournalIdentity(
      record.reservationBindingIdentity,
      `changes[${index}].reservationBindingIdentity`,
      journalPath,
      { nullable: true },
    );
    requireJournalIdentity(
      record.reservationLockProofIdentity,
      `changes[${index}].reservationLockProofIdentity`,
      journalPath,
      { nullable: true },
    );
    requireJournalIdentity(
      record.stagingIdentity,
      `changes[${index}].stagingIdentity`,
      journalPath,
      { nullable: true },
    );
    requireJournalIdentity(
      record.stagedIdentity,
      `changes[${index}].stagedIdentity`,
      journalPath,
      { nullable: true },
    );
    requireJournalIdentity(
      record.proofIdentity,
      `changes[${index}].proofIdentity`,
      journalPath,
      { nullable: true },
    );
    requireJournalIdentity(
      record.tasksCanonicalizationOriginalIdentity,
      `changes[${index}].tasksCanonicalizationOriginalIdentity`,
      journalPath,
      { nullable: true },
    );
    requireJournalIdentity(
      record.tasksCanonicalizationIdentity,
      `changes[${index}].tasksCanonicalizationIdentity`,
      journalPath,
      { nullable: true },
    );
    if (!["pending", "prepared", "quarantined", "ready", "replacing", "published", "cleaned"]
      .includes(record.tasksCanonicalizationPhase)) {
      throw journalFailure(journalPath, `changes[${index}] tasks canonicalization phase is invalid.`);
    }
    const canonicalizationPending = record.tasksCanonicalizationPhase === "pending";
    if (canonicalizationPending !== (
      record.tasksCanonicalizationOriginalIdentity === null
      && record.tasksCanonicalizationOriginalHash === null
    )
      || (!canonicalizationPending
        && (typeof record.tasksCanonicalizationOriginalHash !== "string"
          || record.tasksCanonicalizationOriginalHash.length === 0))
      || (!canonicalizationPending
        && record.tasksCanonicalizationOriginalIdentity === null)
      || (["prepared", "quarantined"].includes(record.tasksCanonicalizationPhase)
        && record.tasksCanonicalizationIdentity !== null)
      || (["ready", "replacing", "published", "cleaned"].includes(
        record.tasksCanonicalizationPhase,
      )
        && (record.tasksCanonicalizationIdentity === null || record.proofIdentity === null))) {
      throw journalFailure(journalPath, `changes[${index}] tasks canonicalization evidence is inconsistent.`);
    }
    requireJournalCopyState(record, `changes[${index}]`, journalPath);
    requireJournalChangeCopyProvenance(record, `changes[${index}]`, journalPath);
    if (record.copyRoot !== null) {
      const stagingCopy = record.phase === "copying"
        && resolve(record.copyRoot) === resolve(join(record.stagingPath, "payload"));
      const canonicalStagingCopy = record.phase === "publishing"
        && resolve(record.copyRoot) === resolve(record.stagedPath)
        && resolve(record.copySourceRoot) === resolve(join(record.stagingPath, "payload"));
      const publicationCopy = ["reserved", "published", "verified", "removed"].includes(record.phase)
        && resolve(record.copyRoot) === resolve(record.destination)
        && resolve(record.copySourceRoot) === resolve(record.stagedPath);
      if (!stagingCopy && !canonicalStagingCopy && !publicationCopy) {
        throw journalFailure(journalPath, `changes[${index}] copy roots are invalid.`);
      }
      if (stagingCopy) {
        const authorizedSource = journal.sources.some((source) => (
          isPathInside(source.path, record.copySourceRoot)
          || isPathInside(source.physicalPath, record.copySourceRoot)
        ));
        if (!authorizedSource) {
          throw journalFailure(journalPath, `changes[${index}] copy source is outside legacy sources.`);
        }
      }
      await assertDirectoryRemovalManifest(
        record.copySourceRoot,
        record.copySourceManifest,
        `changes[${index}] copy source`,
      );
    }
    requireJournalRemovalState(
      {
        mode: record.removalMode,
        root: record.removalRoot,
        manifest: record.removalManifest,
        progress: record.removalProgress,
      },
      `changes[${index}] removal`,
      journalPath,
    );
    const activePublicationCopyOwnsRemoval = record.copyRoot !== null
      && resolve(record.copyRoot) === resolve(record.destination);
    const externalPublicationEvidenceCanRebuildRemoval = record.copyRoot === null
      && record.removalManifest !== null
      && ["published", "verified", "removed"].includes(record.phase)
      && record.reservationIdentity !== null
      && record.stagedIdentity !== null
      && sameFileIdentity(
        record.removalManifest[0]?.identity,
        record.reservationIdentity,
      );
    if (record.removalMode !== null
      && (record.removalMode !== "staging"
        || resolve(record.removalRoot) !== resolve(record.destination)
        || (!activePublicationCopyOwnsRemoval
          && !externalPublicationEvidenceCanRebuildRemoval))) {
      throw journalFailure(journalPath, `changes[${index}] removal authority is invalid.`);
    }
    if (record.removalManifest !== null) {
      await assertDirectoryRemovalSubset(
        record.removalRoot,
        record.removalManifest,
        record.removalProgress,
        `changes[${index}] published destination`,
      );
    }
    requireJournalPhase(
      record,
      ["pending", "copying", "publishing", "staged", "reserved", "published", "verified", "removed"],
      `changes[${index}]`,
      journalPath,
    );
    if (record.phase === "pending"
      && (record.stagingIdentity !== null || record.stagedIdentity !== null)) {
      throw journalFailure(journalPath, `changes[${index}] pending phase has staging ownership.`);
    }
    if (record.phase === "copying"
      && (record.stagingIdentity === null || record.stagedIdentity !== null)) {
      throw journalFailure(journalPath, `changes[${index}] copying phase has invalid staging ownership.`);
    }
    const canonicalPublishingIntent = record.phase === "publishing"
      && record.copyRoot !== null
      && resolve(record.copyRoot) === resolve(record.stagedPath)
      && resolve(record.copySourceRoot) === resolve(join(record.stagingPath, "payload"))
      && record.copyTargetManifest.length === 0;
    if (record.phase === "publishing"
      && (record.stagingIdentity === null
        || (record.stagedIdentity === null && !canonicalPublishingIntent))) {
      throw journalFailure(journalPath, `changes[${index}] publishing phase has invalid staging ownership.`);
    }
    if (["staged", "reserved", "published", "verified", "removed"].includes(record.phase)
      && (record.stagingIdentity !== null || record.stagedIdentity === null)) {
      throw journalFailure(journalPath, `changes[${index}] phase contradicts staging ownership.`);
    }
  }
  const guardedPublishedDestinations = new Set();
  for (const [index, record] of journal.changes.entries()) {
    const destination = resolve(record.destination);
    const guard = destinationGuardByPath.get(destination);
    if (!guard
      || guard.existing
      || guard.canonicalHash !== record.canonicalHash
      || resolve(guard.proofPath) !== resolve(record.proofPath)) {
      throw journalFailure(
        journalPath,
        `changes[${index}] does not match one new destination guard.`,
      );
    }
    if (guardedPublishedDestinations.has(destination)) {
      throw journalFailure(journalPath, `changes[${index}].destination is duplicated.`);
    }
    guardedPublishedDestinations.add(destination);
    record.proofPath = guard.proofPath;
  }
  if (destinationGuards.some(
    (guard) => !guard.existing && !guardedPublishedDestinations.has(resolve(guard.destination)),
  )) {
    throw journalFailure(journalPath, "A new destination guard is missing its Change record.");
  }
  for (const [index, record] of journal.briefs.entries()) {
    const briefSource = Buffer.from(record.source, "base64");
    if (record.kind !== "brief"
      || briefSource.toString("base64") !== record.source
      || sourceHash(briefSource) !== record.hash
      || !isPathInside(record.ownerRoot, record.sourcePath)
      || !basename(record.sourcePath).endsWith(".md")) {
      throw journalFailure(journalPath, `briefs[${index}] has invalid immutable source authority.`);
    }
    record.source = briefSource;
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
    requireJournalAnchor(record.ownerAnchor, `briefs[${index}].ownerAnchor`, journalPath);
    requireExactJournalPath(
      record.ownerAnchor.logicalPath,
      record.ownerRoot,
      `briefs[${index}].ownerAnchor.logicalPath`,
      journalPath,
    );
    requireJournalIdentity(
      record.stagedIdentity,
      `briefs[${index}].stagedIdentity`,
      journalPath,
      { nullable: true },
    );
    requireJournalIdentity(
      record.stagingProofIdentity,
      `briefs[${index}].stagingProofIdentity`,
      journalPath,
      { nullable: true },
    );
    requireJournalIdentity(
      record.briefIntentIdentity,
      `briefs[${index}].briefIntentIdentity`,
      journalPath,
      { nullable: true },
    );
    requireJournalIdentity(
      record.stagingBindingIdentity,
      `briefs[${index}].stagingBindingIdentity`,
      journalPath,
      { nullable: true },
    );
    requireJournalIdentity(
      record.publicationBindingIdentity,
      `briefs[${index}].publicationBindingIdentity`,
      journalPath,
      { nullable: true },
    );
    requireJournalIdentity(
      record.publishedIdentity,
      `briefs[${index}].publishedIdentity`,
      journalPath,
      { nullable: true },
    );
    requireJournalIdentity(
      record.publicationProofIdentity,
      `briefs[${index}].publicationProofIdentity`,
      journalPath,
      { nullable: true },
    );
    requireJournalIdentity(
      record.publicationProofCleanupIdentity,
      `briefs[${index}].publicationProofCleanupIdentity`,
      journalPath,
      { nullable: true },
    );
    if (record.publicationProofCleanupPath !== null) {
      requireJournalString(
        record.publicationProofCleanupPath,
        `briefs[${index}].publicationProofCleanupPath`,
        journalPath,
      );
    }
    if ((record.publicationProofCleanupPath === null)
      !== (record.publicationProofCleanupIdentity === null)) {
      throw journalFailure(
        journalPath,
        `briefs[${index}] publication cleanup proof path and identity disagree.`,
      );
    }
    if (!["pending", "present", "cleaning", "removed"].includes(
      record.publicationProofPhase,
    )) {
      throw journalFailure(
        journalPath,
        `briefs[${index}].publicationProofPhase is invalid.`,
      );
    }
    record.publicationProofPath = null;
    record.stagingProofPath = null;
    record.briefIntentPath = briefOwnershipIntentPath(record);
    record.briefIntentSource = null;
    record.briefIntentAuthenticated = false;
    record.stagingBindingPath = briefStagingBindingPath(record);
    record.stagingBindingTargetIdentity = null;
    record.stagingBindingSource = null;
    record.stagingBindingAuthenticated = false;
    record.publicationBindingPath = briefPublicationBindingPath(record);
    record.publicationBindingTargetIdentity = null;
    record.publicationBindingSource = null;
    record.publicationBindingAuthenticated = false;
    requireJournalBoolean(record.published, `briefs[${index}].published`, journalPath);
    requireJournalPhase(
      record,
      ["pending", "prepared", "published", "verified", "removing", "removed"],
      `briefs[${index}]`,
      journalPath,
    );
    if ((record.phase === "pending") !== (record.stagedIdentity === null)
      || (record.stagedIdentity === null) !== (record.stagingProofIdentity === null)) {
      throw journalFailure(journalPath, `briefs[${index}] phase contradicts staged identity proof.`);
    }
    if ((record.phase !== "pending" && record.briefIntentIdentity === null)
      || (record.phase !== "pending" && record.stagingBindingIdentity === null)
      || (record.stagingBindingIdentity !== null && record.briefIntentIdentity === null)) {
      throw journalFailure(journalPath, `briefs[${index}] lacks durable staged-file ownership evidence.`);
    }
    const expectsPublishedBriefIdentity = [
      "published",
      "verified",
      "removing",
      "removed",
    ].includes(record.phase);
    if (expectsPublishedBriefIdentity !== (record.publishedIdentity !== null)
      || record.published !== expectsPublishedBriefIdentity) {
      throw journalFailure(journalPath, `briefs[${index}] phase contradicts published identity.`);
    }
    if (expectsPublishedBriefIdentity !== (record.publicationBindingIdentity !== null)) {
      throw journalFailure(journalPath, `briefs[${index}] phase contradicts publication binding.`);
    }
    if (record.publicationProofPhase === "pending"
      && (record.publicationProofIdentity !== null
        || record.publicationProofCleanupPath !== null
        || !["pending", "prepared"].includes(record.phase))) {
      throw journalFailure(journalPath, `briefs[${index}] has invalid pending publication proof state.`);
    }
    if (record.publicationProofPhase === "present"
      && (record.publicationProofIdentity === null
        || record.publicationProofCleanupPath !== null
        || !["published", "verified", "removing", "removed"].includes(record.phase))) {
      throw journalFailure(journalPath, `briefs[${index}] has invalid present publication proof state.`);
    }
    if (record.publicationProofPhase === "cleaning"
      && (record.publicationProofIdentity === null
        || !["verified", "removed"].includes(record.phase))) {
      throw journalFailure(journalPath, `briefs[${index}] has invalid cleaning publication proof state.`);
    }
    if (record.publicationProofPhase === "removed"
      && (record.publicationProofIdentity !== null
        || record.publicationProofCleanupPath !== null
        || !["verified", "removed"].includes(record.phase))) {
      throw journalFailure(journalPath, `briefs[${index}] has invalid removed publication proof state.`);
    }
  }
  const journalDerivedSourceGuards = serializedSourceDerivedDestinationGuards({
    destinationGuards,
    publishedBriefs: journal.briefs,
  });
  if (sourceDerivedManifest.snapshot !== null
    && sourceDerivedManifest.snapshot !== journalDerivedSourceGuards) {
    throw journalFailure(
      journalPath,
      "Source-derived manifest does not match the journal destination records.",
    );
  }
  for (const [index, record] of journal.configs.entries()) {
    if (!["configuration", "repository-config"].includes(record.kind)
      || !Number.isInteger(record.fromVersion)
      || !Number.isInteger(record.toVersion)
      || record.fromVersion < 1
      || record.toVersion < 1) {
      throw journalFailure(journalPath, `configs[${index}] has invalid immutable schema authority.`);
    }
    requireJournalAnchor(record.ownerAnchor, `configs[${index}].ownerAnchor`, journalPath);
    requireJournalOwnerBinding(
      record.originalOwnerBinding,
      record.ownerRoot,
      `configs[${index}].originalOwnerBinding`,
      journalPath,
    );
    requireJournalIdentity(
      record.originalIdentity,
      `configs[${index}].originalIdentity`,
      journalPath,
    );
    if (!Number.isInteger(record.originalMode)
      || record.originalMode < 0
      || record.originalMode > 0o777) {
      throw journalFailure(journalPath, `configs[${index}].originalMode is invalid.`);
    }
    requireJournalIdentity(
      record.originalStagedIdentity,
      `configs[${index}].originalStagedIdentity`,
      journalPath,
      { nullable: true },
    );
    requireJournalIdentity(
      record.nextStagedIdentity,
      `configs[${index}].nextStagedIdentity`,
      journalPath,
      { nullable: true },
    );
    requireJournalIdentity(
      record.nextProofIntentIdentity,
      `configs[${index}].nextProofIntentIdentity`,
      journalPath,
      { nullable: true },
    );
    requireJournalIdentity(
      record.restoredIdentity,
      `configs[${index}].restoredIdentity`,
      journalPath,
      { nullable: true },
    );
    for (const [kind, targetPath, allowedPhase] of [
      ["original", record.originalPath, "preparing-original"],
      ["next", record.nextPath, "preparing-next"],
    ]) {
      const temporary = record[`${kind}WriteTemporary`];
      const temporaryIdentity = record[`${kind}WriteTemporaryIdentity`];
      requireJournalIdentity(
        temporaryIdentity,
        `configs[${index}].${kind}WriteTemporaryIdentity`,
        journalPath,
        { nullable: true },
      );
      if (temporary === null) {
        if (temporaryIdentity !== null) {
          throw journalFailure(journalPath, `configs[${index}] ${kind} staging identity lacks intent.`);
        }
        continue;
      }
      requireJournalString(
        temporary,
        `configs[${index}].${kind}WriteTemporary`,
        journalPath,
      );
      const prefix = `.${basename(targetPath)}.sdd-write-`;
      const suffix = basename(temporary).slice(prefix.length);
      if (resolve(dirname(temporary)) !== resolve(stagingRoot)
        || !basename(temporary).startsWith(prefix)
        || !/^\d+-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suffix)
        || record.phase !== allowedPhase) {
        throw journalFailure(journalPath, `configs[${index}] ${kind} staging intent is invalid.`);
      }
    }
    if (sourceHash(record.originalSource) !== record.originalHash) {
      throw journalFailure(journalPath, `configs[${index}].originalSource does not match its hash.`);
    }
    if (typeof record.nextSource !== "string"
      || sourceHash(record.nextSource) !== record.nextHash) {
      throw journalFailure(journalPath, `configs[${index}].nextSource does not match its hash.`);
    }
    const authenticatedOriginalAbsent = record.authenticatedOriginalSource === null
      && record.authenticatedOriginalHash === null;
    if (authenticatedOriginalAbsent !== (
      record.authenticatedOriginalSource === null
      || record.authenticatedOriginalHash === null
    )
      || (!authenticatedOriginalAbsent
        && (
          typeof record.authenticatedOriginalSource !== "string"
          || sourceHash(record.authenticatedOriginalSource) !== record.authenticatedOriginalHash
        ))
      || (record.authenticatedNextHash !== null
        && record.authenticatedNextHash !== record.nextHash)) {
      throw journalFailure(journalPath, `configs[${index}] authenticated configuration evidence is invalid.`);
    }
    if (!authenticatedOriginalAbsent
      && record.authenticatedOriginalHash !== record.originalHash
      && !(
        journal.status === "rolling-back"
        && ["restoring", "restored"].includes(record.phase)
      )) {
      throw journalFailure(journalPath, `configs[${index}] adopted original configuration lacks a rollback barrier.`);
    }
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
      [
        "pending",
        "preparing-original",
        "original-prepared",
        "preparing-next",
        "prepared",
        "replacing",
        "published",
        "verified",
        "unchanged",
        "restoring",
        "restored",
      ],
      `configs[${index}]`,
      journalPath,
    );
    const originalStaged = record.originalStagedIdentity !== null;
    const nextStaged = record.nextStagedIdentity !== null;
    const stagedIdentityStateIsCoherent = (
      ["pending", "preparing-original"].includes(record.phase)
        && !originalStaged
        && !nextStaged
    ) || (
      ["original-prepared", "preparing-next"].includes(record.phase)
        && originalStaged
        && !nextStaged
    ) || (
      [
        "prepared",
        "replacing",
        "published",
        "verified",
        "unchanged",
        "restoring",
        "restored",
      ].includes(record.phase)
        && originalStaged
        && nextStaged
    );
    if (!stagedIdentityStateIsCoherent) {
      throw journalFailure(journalPath, `configs[${index}] phase contradicts staged identities.`);
    }
    if (!["pending", "creating", "present", "cleaning", "removed"].includes(record.proofPhase)) {
      throw journalFailure(journalPath, `configs[${index}].proofPhase is invalid.`);
    }
    if ((!["restoring", "restored"].includes(record.phase)
        && record.restoredIdentity !== null)
      || (record.phase === "restored" && record.restoredIdentity === null)
      || (record.phase === "restoring"
        && ["cleaning", "removed"].includes(record.proofPhase)
        && record.restoredIdentity === null)) {
      throw journalFailure(
        journalPath,
        `configs[${index}] restored identity contradicts its rollback phase.`,
      );
    }
    const initializationPhase = [
      "preparing-original",
      "original-prepared",
      "preparing-next",
    ].includes(record.phase);
    if ((record.proofPhase === "creating"
      && (record.phase !== "pending" || journal.status !== "applying"))
      || (initializationPhase
        && (journal.status !== "applying" || record.proofPhase !== "present"))) {
      throw journalFailure(journalPath, `configs[${index}] has incoherent initialization state.`);
    }
    for (const [kind, cleanupPath, cleanupIdentity] of [
      ["original", record.originalProofCleanupPath, record.originalProofCleanupIdentity],
      ["next", record.nextProofCleanupPath, record.nextProofCleanupIdentity],
    ]) {
      if (cleanupPath === null && cleanupIdentity !== null) {
        throw journalFailure(
          journalPath,
          `configs[${index}] ${kind} cleanup proof has incomplete ownership state.`,
        );
      }
      if (cleanupPath === null) continue;
      requireJournalString(
        cleanupPath,
        `configs[${index}].${kind}ProofCleanupPath`,
        journalPath,
      );
      requireJournalIdentity(
        cleanupIdentity,
        `configs[${index}].${kind}ProofCleanupIdentity`,
        journalPath,
        { nullable: true },
      );
      const proofPath = configProofPath(stagingRoot, record.path, index, kind);
      const cleanupPrefix = `${basename(proofPath)}-cleanup-`;
      const cleanupName = basename(cleanupPath);
      if (resolve(dirname(cleanupPath)) !== resolve(dirname(record.path))
        || !cleanupName.startsWith(cleanupPrefix)
        || !/^\d+-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(cleanupName.slice(cleanupPrefix.length))) {
        throw journalFailure(journalPath, `configs[${index}] ${kind} cleanup proof path is invalid.`);
      }
    }
    if (record.proofPhase !== "cleaning"
      && (record.originalProofCleanupPath !== null || record.nextProofCleanupPath !== null)) {
      throw journalFailure(journalPath, `configs[${index}] has cleanup proof state outside cleanup.`);
    }
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
    requireJournalIdentity(record.identity, `sources[${index}].identity`, journalPath);
    requireJournalIdentity(record.ownerIdentity, `sources[${index}].ownerIdentity`, journalPath);
    requireJournalIdentity(
      record.backupIdentity,
      `sources[${index}].backupIdentity`,
      journalPath,
      { nullable: true },
    );
    requireJournalMode(record.backupMode, `sources[${index}].backupMode`, journalPath, {
      nullable: true,
    });
    if ((record.backupIdentity === null) !== (record.backupMode === null)) {
      throw journalFailure(journalPath, `sources[${index}] backup identity and mode contradict.`);
    }
    requireJournalIdentity(
      record.backupPayloadIdentity,
      `sources[${index}].backupPayloadIdentity`,
      journalPath,
      { nullable: true },
    );
    for (const [property, value] of [
      ["backupProofRootIdentity", record.backupProofRootIdentity],
      ["backupProofOwnerIdentity", record.backupProofOwnerIdentity],
      ["backupProofReceiptIdentity", record.backupProofReceiptIdentity],
      ["backupProofOwnerCleanupIdentity", record.backupProofOwnerCleanupIdentity],
      ["backupProofReceiptCleanupIdentity", record.backupProofReceiptCleanupIdentity],
    ]) {
      requireJournalIdentity(value, `sources[${index}].${property}`, journalPath, {
        nullable: true,
      });
    }
    const proofPaths = sourceBackupProofPaths(record.backup, record.backupProofToken);
    for (const [property, expected] of [
      ["backupProofRoot", proofPaths.root],
      ["backupProofOwnerPath", proofPaths.owner],
      ["backupProofReceiptPath", proofPaths.receipt],
      ["backupProofOwnerCleanupPath", proofPaths.ownerCleanup],
      ["backupProofReceiptCleanupPath", proofPaths.receiptCleanup],
    ]) {
      requireExactJournalPath(
        record[property],
        expected,
        `sources[${index}].${property}`,
        journalPath,
      );
    }
    if (!["pending", "copying", "present", "cleaning", "removed"]
      .includes(record.backupProofPhase)) {
      throw journalFailure(journalPath, `sources[${index}].backupProofPhase is invalid.`);
    }
    if (!Array.isArray(record.backupEntryProvenance)) {
      throw journalFailure(journalPath, `sources[${index}].backupEntryProvenance must be an array.`);
    }
    for (const [entryIndex, entry] of record.backupEntryProvenance.entries()) {
      const entryLabel = `sources[${index}].backupEntryProvenance[${entryIndex}]`;
      requireExactJournalKeys(
        entry,
        [
          "token",
          "index",
          "relativePath",
          "type",
          "sourceIdentity",
          "sourceMode",
          "sourceHash",
          "sourceTarget",
          "targetIdentity",
          "targetMode",
          "targetHash",
          "targetTarget",
          "digest",
          "ownerWitnessPath",
          "targetWitnessPath",
        ],
        entryLabel,
        journalPath,
      );
      requireJournalIdentity(entry.sourceIdentity, `${entryLabel}.sourceIdentity`, journalPath);
      requireJournalIdentity(entry.targetIdentity, `${entryLabel}.targetIdentity`, journalPath);
      requireJournalMode(entry.sourceMode, `${entryLabel}.sourceMode`, journalPath);
      requireJournalMode(entry.targetMode, `${entryLabel}.targetMode`, journalPath);
      const sourceEntry = {
        relativePath: entry.relativePath,
        type: entry.type,
        identity: entry.sourceIdentity,
        mode: entry.sourceMode,
        hash: entry.sourceHash,
        target: entry.sourceTarget,
      };
      const expected = sourceBackupEntryProvenance(
        record,
        sourceEntry,
        entryIndex,
        entry.targetIdentity,
      );
      if (entry.index !== entryIndex
        || !isCanonicalRemovalRelativePath(record.backupProofRoot, entry.relativePath, {
          allowRoot: true,
        })
        || !["directory", "file", "symlink"].includes(entry.type)
        || !sameSourceBackupEntryProvenance(entry, expected)) {
        throw journalFailure(journalPath, `${entryLabel} is not canonical source-backup evidence.`);
      }
    }
    requireJournalRemovalState(
      {
        mode: record.backupProofRemovalManifest === null ? null : "staging",
        root: record.backupProofRemovalManifest === null ? null : record.backupProofRoot,
        manifest: record.backupProofRemovalManifest,
        progress: record.backupProofRemovalProgress,
      },
      `sources[${index}] backup proof removal`,
      journalPath,
    );
    if ((record.backupProofRemovalManifest !== null
        && record.backupProofPhase !== "cleaning")
      || (record.backupProofPhase === "pending"
        && (record.backupProofRootIdentity !== null
          || record.backupProofOwnerIdentity !== null
          || record.backupProofReceiptIdentity !== null
          || record.backupEntryProvenance.length !== 0))
      || (record.backupProofPhase === "present"
        && (record.backupProofRootIdentity === null
          || record.backupProofOwnerIdentity === null
          || record.backupProofReceiptIdentity === null
          || record.backupPayloadIdentity === null
          || record.backupEntryProvenance.length === 0))
      || (record.backupProofPhase === "removed"
        && (record.backupProofRootIdentity !== null
          || record.backupProofOwnerIdentity !== null
          || record.backupProofReceiptIdentity !== null
          || record.backupProofOwnerCleanupIdentity !== null
          || record.backupProofReceiptCleanupIdentity !== null
          || record.backupProofRemovalManifest !== null))) {
      throw journalFailure(journalPath, `sources[${index}] backup proof phase contradicts its evidence.`);
    }
    requireJournalIdentity(
      record.restoreIdentity,
      `sources[${index}].restoreIdentity`,
      journalPath,
      { nullable: true },
    );
    requireJournalIdentity(
      record.restoreIntentIdentity,
      `sources[${index}].restoreIntentIdentity`,
      journalPath,
      { nullable: true },
    );
    const restoreCopyState = {
      copyRoot: record.restoreCopyRoot,
      copySourceRoot: record.restoreCopySourceRoot,
      copySourceManifest: record.restoreCopySourceManifest,
      copyTargetManifest: record.restoreCopyTargetManifest,
      copyProvenanceToken: record.restoreCopyProvenanceToken,
      copyTargetProvenance: record.restoreCopyTargetProvenance,
      copyIntent: record.restoreCopyIntent,
    };
    requireJournalCopyState(restoreCopyState, `sources[${index}] restore`, journalPath);
    requireJournalChangeCopyProvenance(
      restoreCopyState,
      `sources[${index}] restore`,
      journalPath,
    );
    const restoreTokenValid = typeof record.restoreReservationToken === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(record.restoreReservationToken);
    if (record.restoreReservationToken === null) {
      if (record.restoreIntentIdentity !== null
        || record.restoreCopyRoot !== null
        || record.restoreCopyTargetProvenance.length !== 0) {
        throw journalFailure(journalPath, `sources[${index}] has restore evidence without an intent.`);
      }
    } else if (!restoreTokenValid
      || journal.status !== "rolling-back"
      || !["present", "cleaning"].includes(record.backupProofPhase)) {
      throw journalFailure(journalPath, `sources[${index}] restore intent is invalid.`);
    }
    if (record.restoreCopyRoot !== null
      && (record.restoreReservationToken === null
        || record.restoreIdentity === null
        || resolve(record.restoreCopyRoot) !== resolve(record.physicalPath)
        || resolve(dirname(record.restoreCopySourceRoot)) !== resolve(record.backup)
        || (record.backupPayloadIdentity !== null
          && !sameFileIdentity(
            record.restoreCopySourceManifest[0]?.identity,
            record.backupPayloadIdentity,
          )))) {
      throw journalFailure(journalPath, `sources[${index}] restore copy roots are invalid.`);
    }
    requireJournalIdentity(
      record.cleanupIdentity,
      `sources[${index}].cleanupIdentity`,
      journalPath,
      { nullable: true },
    );
    requireJournalMode(record.cleanupMode, `sources[${index}].cleanupMode`, journalPath, {
      nullable: true,
    });
    if ((record.cleanupIdentity === null) !== (record.cleanupMode === null)) {
      throw journalFailure(journalPath, `sources[${index}] cleanup identity and mode contradict.`);
    }
    requireJournalCopyState(record, `sources[${index}]`, journalPath);
    if (record.copyRoot !== null) {
      const copyName = basename(record.copyRoot);
      if (record.phase !== "removing"
        || resolve(dirname(record.copyRoot)) !== resolve(record.backup)
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(copyName)) {
        throw journalFailure(journalPath, `sources[${index}] copy root is invalid.`);
      }
    }
    if (record.copyRoot !== null) {
      if (resolve(record.copySourceRoot) !== resolve(record.physicalPath)
        || !sameFileIdentity(record.copySourceManifest[0].identity, record.identity)) {
        throw journalFailure(journalPath, `sources[${index}] copy source is invalid.`);
      }
      await assertDirectoryRemovalManifest(
        record.copySourceRoot,
        record.copySourceManifest,
        `sources[${index}] copy source`,
      );
    }
    if (record.cleanupIdentity !== null && record.cleanupPath === null) {
      throw journalFailure(journalPath, `sources[${index}].cleanupIdentity has no cleanup path.`);
    }
    if (record.cleanupPath !== null) {
      requireJournalString(record.cleanupPath, `sources[${index}].cleanupPath`, journalPath);
      const cleanupPrefix = ".sdd-cleanup-";
      const cleanupName = basename(record.cleanupPath);
      if (resolve(dirname(record.cleanupPath)) !== resolve(record.backup)
        || !cleanupName.startsWith(cleanupPrefix)
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(cleanupName.slice(cleanupPrefix.length))) {
        throw journalFailure(
          journalPath,
          `sources[${index}].cleanupPath is not a migration-generated backup child.`,
        );
      }
    }
    requireJournalRemovalState(
      {
        mode: record.removalMode,
        root: record.removalRoot,
        manifest: record.removalManifest,
        progress: record.removalProgress,
      },
      `sources[${index}] removal`,
      journalPath,
    );
    if (record.removalMode === "source"
      && resolve(record.removalRoot) !== resolve(record.physicalPath)) {
      throw journalFailure(journalPath, `sources[${index}] source removal root is invalid.`);
    }
    if (record.removalMode === "backup"
      && (resolve(dirname(record.removalRoot)) !== resolve(record.backup)
        || resolve(record.removalRoot) === resolve(record.cleanupPath ?? record.backup))) {
      throw journalFailure(journalPath, `sources[${index}] backup removal root is invalid.`);
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
  if (journal.sourceDerivedDestinationGuards === null
    && (journal.status === "committed"
      || journal.sources.some((record) => record.phase !== "pending"))) {
    throw journalFailure(
      journalPath,
      "Source retirement is not backed by a durable source-derived manifest.",
    );
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
  const hasProofCleanup = journal.configs.some(
    (record) => ["cleaning", "removed"].includes(record.proofPhase),
  );
  if (journal.status === "applying" && hasProofCleanup) {
    throw journalFailure(journalPath, "Applying journal status contradicts configuration proof cleanup.");
  }
  if (journal.status === "rolling-back" && journal.configs.some(
    (record) => ["cleaning", "removed"].includes(record.proofPhase)
      && !(
        ["restoring", "restored"].includes(record.phase)
        || (record.phase === "verified" && record.originalHash === record.nextHash)
      ),
  )) {
    throw journalFailure(journalPath, "Rollback configuration proof cleanup contradicts its record phase.");
  }
  if (journal.status === "committed"
    && (
      journal.configs.some((record) => record.proofPhase === "pending")
      || hasProofCleanup && journal.sources.some((record) => record.phase !== "cleaned")
    )) {
    throw journalFailure(
      journalPath,
      "Committed configuration proof cleanup is not backed by completed source cleanup.",
    );
  }
  const hasBriefProofCleanup = journal.briefs.some(
    (record) => ["cleaning", "removed"].includes(record.publicationProofPhase),
  );
  if (journal.status === "applying"
    && (hasBriefProofCleanup
      || journal.briefs.some((record) => record.phase === "removing"))) {
    throw journalFailure(
      journalPath,
      "Applying journal status contradicts Change Brief proof cleanup.",
    );
  }
  if (journal.status !== "rolling-back"
    && journal.briefs.some((record) => record.phase === "removing")) {
    throw journalFailure(
      journalPath,
      "Change Brief removal lacks a rolling-back journal barrier.",
    );
  }
  if (journal.status === "rolling-back" && journal.briefs.some(
    (record) => ["cleaning", "removed"].includes(record.publicationProofPhase)
      && record.phase !== "removed",
  )) {
    throw journalFailure(
      journalPath,
      "Rollback Change Brief proof cleanup contradicts its record phase.",
    );
  }
  if (journal.status === "committed"
    && (
      journal.briefs.some((record) => record.publicationProofPhase === "pending")
      || hasBriefProofCleanup && journal.sources.some((record) => record.phase !== "cleaned")
    )) {
    throw journalFailure(
      journalPath,
      "Committed Change Brief proof cleanup is not backed by completed source cleanup.",
    );
  }
  const recoveryPaths = [
    ...journal.changes.flatMap((record) => [record.stagedPath, record.stagingPath]),
    ...journal.briefs.map((record) => record.stagedPath),
    ...journal.configs.flatMap((record) => [record.originalPath, record.nextPath]),
  ];
  const storeAnchors = await captureTransactionStoreAnchors(destinationWorkspaceRoot);
  storeAnchors.staging = await captureDirectoryAnchor(
    stagingRoot,
    "Migration staging root",
    "CONCURRENT_CHANGE",
  );
  if (!sameFileIdentity(
    {
      dev: storeAnchors.staging.dev,
      ino: storeAnchors.staging.ino,
    },
    journal.stagingIdentity,
  )) {
    throw journalFailure(journalPath, "Migration staging root changed physical identity.");
  }
  if (journal.initializationPhase !== "journaled" && !destinationManifest.complete) {
    throw journalFailure(
      journalPath,
      "Migration initialization evidence was released before destination authentication.",
    );
  }
  const initializationState = {
    destinationWorkspaceRoot: resolve(destinationWorkspaceRoot),
    workspaceAnchor: journal.workspaceAnchor,
    readGuards: journal.readGuards,
    writtenConfigs: journal.configs,
    stagingRoot: resolve(stagingRoot),
    stagingIdentity: journal.stagingIdentity,
    journalPath,
    initializationPhase: journal.initializationPhase,
    initializationReservationPath: initializationReservationPath(
      destinationWorkspaceRoot,
      stagingRoot,
    ),
    initializationReservationIdentity: journal.initializationReservationIdentity,
    initializationBindingPath: initializationBindingPath(
      destinationWorkspaceRoot,
      stagingRoot,
    ),
    initializationBindingIdentity: journal.initializationBindingIdentity,
    storeAnchors,
  };
  if (journal.initializationPhase === "released") {
    for (const path of [
      initializationState.initializationReservationPath,
      initializationEvidenceCleanupPath(initializationState.initializationReservationPath),
      initializationState.initializationBindingPath,
      initializationEvidenceCleanupPath(initializationState.initializationBindingPath),
    ]) {
      if (await pathState(path)) {
        throw journalFailure(journalPath, `Released initialization evidence still exists: ${path}`);
      }
    }
  } else {
    try {
      await assertInitializationEvidence(initializationState, {
        allowMissing: journal.initializationPhase === "releasing",
      });
    } catch (error) {
      throw journalFailure(journalPath, error.message);
    }
  }
  for (const [index, record] of journal.changes.entries()) {
    const journalProofIdentity = record.proofIdentity;
    const canonicalStagingCopy = record.copyRoot !== null
      && resolve(record.copyRoot) === resolve(record.stagedPath)
      && resolve(record.copySourceRoot) === resolve(join(record.stagingPath, "payload"));
    const stagingRemovalOwnsCopy = record.copyRoot !== null
      && journal.stagingRemovalManifest !== null
      && (resolve(journal.stagingRemovalRoot) === resolve(record.copyRoot)
        || isStrictlyInside(journal.stagingRemovalRoot, record.copyRoot));
    await hydrateChangeTasksCanonicalization(
      record,
      index,
      journalPath,
      destinationManifest.path,
      destinationManifest.witnessIdentity,
    );
    await authenticateChangeCopyTargetProvenance(
      record,
      {
        stagingRoot,
        anchorPath: destinationManifest.path,
        anchorIdentity: destinationManifest.witnessIdentity,
      },
      `changes[${index}] copy`,
      {
        journalPath,
        allowMissingTarget: canonicalStagingCopy || stagingRemovalOwnsCopy,
        allowMissingEntries: stagingRemovalOwnsCopy,
      },
    );
    await hydrateChangeProofIdentity(record, index, journalPath);
    const destinationGuard = destinationGuardByPath.get(resolve(record.destination));
    const proofPhase = record.proofIdentity === null ? "pending" : "present";
    const guardMatchesProof = destinationGuard.proofPhase === proofPhase
      && (record.proofIdentity === null
        ? destinationGuard.proofIdentity === null
        : sameFileIdentity(destinationGuard.proofIdentity, record.proofIdentity));
    if (!guardMatchesProof
      && destinationGuard.proofPhase === "pending"
      && destinationGuard.proofIdentity === null
      && journalProofIdentity === null
      && record.proofIdentity !== null) {
      destinationGuard.proofIdentity = record.proofIdentity;
      destinationGuard.proofPhase = "present";
      hydratedInitializationEvidence = true;
    } else if (!guardMatchesProof) {
      throw journalFailure(
        journalPath,
        `changes[${index}] ownership proof contradicts its destination guard.`,
      );
    }
    await hydrateChangeReservationEvidenceIdentities(record, index, stagingRoot, journalPath);
    await hydrateStagedChangeIdentityEvidence(record, index, stagingRoot, journalPath);
  }
  for (const [index, record] of journal.briefs.entries()) {
    await hydrateBriefOwnershipIntent(record, index, journalPath, destinationManifest);
    await hydrateBriefStagingBinding(record, index, journalPath);
    await hydrateBriefStagingProof(record, index, journalPath);
    await hydrateBriefPublicationBinding(record, index, journalPath);
  }
  const stagedState = {
    plan: null,
    workspaceAnchor: journal.workspaceAnchor,
    terminalCleanupPlan: journal.terminalCleanupPlan,
    terminalCleanupReceipt: null,
    journalWriteCleanupPath: join(
      stagingRoot,
      MIGRATION_JOURNAL_WRITE_CLEANUP_DIRECTORY_NAME,
    ),
    journalWriteCleanupIdentity: journal.journalWriteCleanupIdentity,
    destinationWorkspaceRoot: resolve(destinationWorkspaceRoot),
    stagingRoot: resolve(stagingRoot),
    initializationPhase: journal.initializationPhase,
    initializationReservationPath: initializationReservationPath(
      destinationWorkspaceRoot,
      stagingRoot,
    ),
    initializationReservationIdentity: journal.initializationReservationIdentity,
    initializationBindingPath: initializationBindingPath(
      destinationWorkspaceRoot,
      stagingRoot,
    ),
    initializationBindingIdentity: journal.initializationBindingIdentity,
    stagingIdentity: journal.stagingIdentity,
    stagingRemovalRoot: journal.stagingRemovalRoot,
    stagingRemovalManifest: journal.stagingRemovalManifest,
    stagingRemovalProgress: journal.stagingRemovalProgress,
    journalPath,
    journalIdentity: hydratedJournalIdentity,
    journalHash: hydratedJournalHash,
    destinationManifestPhase: journal.destinationManifestPhase,
    destinationManifestIdentity: journal.destinationManifestIdentity,
    destinationManifestWitnessPhase: journal.destinationManifestWitnessPhase,
    destinationManifestDigestPhase: journal.destinationManifestDigestPhase,
    destinationManifestPath: destinationManifest.path,
    destinationManifestWitnessPath: destinationManifest.witnessPath,
    destinationManifestWitnessIdentity: destinationManifest.witnessIdentity,
    destinationManifestDigestPath: destinationManifest.digestPath,
    destinationManifestDigestIdentity: destinationManifest.digestIdentity,
    sourceDerivedDestinationGuards: sourceDerivedManifest.snapshot,
    sourceDerivedManifestPath: sourceDerivedManifest.path,
    sourceDerivedManifestWitnessPath: sourceDerivedManifest.witnessPath,
    sourceDerivedManifestWitnessIdentity: sourceDerivedManifest.witnessIdentity,
    sourceDerivedManifestDigestPath: sourceDerivedManifest.digestPath,
    sourceDerivedManifestDigestIdentity: sourceDerivedManifest.digestIdentity,
    publishedChanges: journal.changes,
    readGuards: journal.readGuards,
    destinationGuards,
    publishedBriefs: journal.briefs,
    writtenConfigs: journal.configs,
    removedSources: journal.sources,
    status: journal.status,
    durable: true,
    finished: false,
    mutationLock: null,
    beforeJournalReplace: null,
    storeAnchors,
  };
  for (const [index, record] of journal.configs.entries()) {
    const beforeHydration = JSON.stringify([
      record.phase,
      record.proofPhase,
      record.originalStagedIdentity,
      record.nextStagedIdentity,
      record.originalProofCleanupPath,
      record.originalProofCleanupIdentity,
      record.nextProofCleanupPath,
      record.nextProofCleanupIdentity,
      record.authenticatedOriginalSource,
      record.authenticatedOriginalHash,
      record.authenticatedNextHash,
      record.restoredIdentity,
    ]);
    const configHydrated = await hydrateConfigProofs(
      record,
      index,
      stagingRoot,
      journalPath,
      journal,
    );
    if (record.restoredIdentity !== null) {
      const restored = await assertRestoredConfigHash(record);
      if (!sameFileIdentity(restored.identity, record.restoredIdentity)) {
        throw journalFailure(
          journalPath,
          `configs[${index}] restored configuration changed physical identity.`,
        );
      }
    }
    hydratedInitializationEvidence ||= configHydrated || beforeHydration !== JSON.stringify([
      record.phase,
      record.proofPhase,
      record.originalStagedIdentity,
      record.nextStagedIdentity,
      record.originalProofCleanupPath,
      record.originalProofCleanupIdentity,
      record.nextProofCleanupPath,
      record.nextProofCleanupIdentity,
      record.authenticatedOriginalSource,
      record.authenticatedOriginalHash,
      record.authenticatedNextHash,
      record.restoredIdentity,
    ]);
  }
  if (hydratedInitializationEvidence) await persistTransaction(stagedState);
  await assertTransactionStagingInventory(stagedState);
  const publishedChanges = journal.changes;
  if (journal.terminalCleanupPlan !== null) {
    await validateTerminalCleanupPlan(
      journal.terminalCleanupPlan,
      destinationWorkspaceRoot,
      journalPath,
      { journal },
    );
  }
  const authority = await resolveRecoveryAuthority(
    journal,
    stagingRoot,
    journalPath,
    destinationWorkspaceRoot,
  );
  for (const guard of destinationGuards) {
    if (guard.proofPhase !== "present"
      || (!guard.existing && journal.status !== "committed")) continue;
    try {
      await assertDestinationGuard(guard, destinationWorkspaceRoot);
    } catch (error) {
      throw journalFailure(journalPath, error.message);
    }
  }
  for (const [index, record] of journal.briefs.entries()) {
    await requireAuthorizedOwner(
      record.ownerRoot,
      authority.planningOwners,
      `briefs[${index}].ownerRoot`,
      journalPath,
    );
    try {
      await assertStoredDirectoryAnchor(record.ownerRoot, record.ownerAnchor, "Change Brief owner");
      if (!(await isPathPhysicallyInside(record.ownerAnchor.physicalPath, record.destination))) {
        throw migrationError(
          `Change Brief destination escapes its captured owner: ${record.destination}`,
          "UNSAFE_ARTIFACT_PATH",
        );
      }
    } catch (error) {
      throw journalFailure(journalPath, error.message);
    }
    await hydrateBriefPublicationProof(record, index, journal, journalPath);
  }
  const physicalWorkspaceRoot = resolve(await resolvePhysicalPath(destinationWorkspaceRoot));
  for (const [index, record] of journal.configs.entries()) {
    const owner = resolve(record.ownerRoot);
    const physicalOwner = resolve(await resolvePhysicalPath(record.ownerRoot));
    if (owner !== resolve(destinationWorkspaceRoot)
      && physicalOwner !== physicalWorkspaceRoot
      && !authority.repositoryOwners.has(owner)
      && !authority.repositoryOwners.has(physicalOwner)) {
      throw journalFailure(
        journalPath,
        `configs[${index}].ownerRoot is not owned by the configured workspace topology.`,
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
  const hydratedState = {
    plan: null,
    destinationWorkspaceRoot: resolve(destinationWorkspaceRoot),
    workspaceAnchor: journal.workspaceAnchor,
    authority,
    journalWriteCleanupPath: join(
      stagingRoot,
      MIGRATION_JOURNAL_WRITE_CLEANUP_DIRECTORY_NAME,
    ),
    journalWriteCleanupIdentity: journal.journalWriteCleanupIdentity,
    readGuards: journal.readGuards,
    stagingRoot: resolve(stagingRoot),
    initializationPhase: journal.initializationPhase,
    initializationReservationPath: initializationReservationPath(
      destinationWorkspaceRoot,
      stagingRoot,
    ),
    initializationReservationIdentity: journal.initializationReservationIdentity,
    initializationBindingPath: initializationBindingPath(
      destinationWorkspaceRoot,
      stagingRoot,
    ),
    initializationBindingIdentity: journal.initializationBindingIdentity,
    stagingIdentity: journal.stagingIdentity,
    stagingRemovalRoot: journal.stagingRemovalRoot,
    stagingRemovalManifest: journal.stagingRemovalManifest,
    stagingRemovalProgress: journal.stagingRemovalProgress,
    terminalCleanupPlan: journal.terminalCleanupPlan,
    terminalCleanupReceipt: null,
    journalPath,
    journalIdentity: hydratedJournalIdentity,
    journalHash: hydratedJournalHash,
    destinationManifestPhase: journal.destinationManifestPhase,
    destinationManifestIdentity: journal.destinationManifestIdentity,
    destinationManifestWitnessPhase: journal.destinationManifestWitnessPhase,
    destinationManifestDigestPhase: journal.destinationManifestDigestPhase,
    destinationManifestPath: destinationManifest.path,
    destinationManifestWitnessPath: destinationManifest.witnessPath,
    destinationManifestWitnessIdentity: destinationManifest.witnessIdentity,
    destinationManifestDigestPath: destinationManifest.digestPath,
    destinationManifestDigestIdentity: destinationManifest.digestIdentity,
    destinationGuards,
    publishedChanges,
    publishedBriefs: journal.briefs,
    writtenConfigs: journal.configs,
    removedSources: journal.sources,
    status: journal.status,
    durable: true,
    storeAnchors,
    mutationLock: null,
    beforeJournalReplace: null,
    afterTransactionCleanupReceiptStage: null,
    afterTransactionCleanupReceiptProof: null,
    afterTransactionCleanupReceipt: null,
    afterTransactionJournalUnlink: null,
    afterTransactionStagingRootRemoval: null,
    afterTransactionWitnessUnlink: null,
    afterConfigProofCleanupLink: null,
    finished: false,
    sourceDerivedDestinationGuards: sourceDerivedManifest.snapshot,
    sourceDerivedManifestPath: sourceDerivedManifest.path,
    sourceDerivedManifestWitnessPath: sourceDerivedManifest.witnessPath,
    sourceDerivedManifestWitnessIdentity: sourceDerivedManifest.witnessIdentity,
    sourceDerivedManifestDigestPath: sourceDerivedManifest.digestPath,
    sourceDerivedManifestDigestIdentity: sourceDerivedManifest.digestIdentity,
  };
  for (const [index, record] of journal.sources.entries()) {
    await hydrateSourceBackupProvenance(hydratedState, record, index, journalPath);
  }
  return hydratedState;
}
function initializationEvidenceNameInfo(name) {
  for (const [role, suffix] of [
    ["reservation", MIGRATION_INITIALIZATION_RESERVATION_SUFFIX],
    ["binding", MIGRATION_INITIALIZATION_BINDING_SUFFIX],
  ]) {
    for (const cleanup of [false, true]) {
      const candidateSuffix = cleanup ? `${suffix}.cleanup` : suffix;
      if (!name.startsWith(MIGRATION_STAGING_PREFIX) || !name.endsWith(candidateSuffix)) {
        continue;
      }
      const stagingName = name.slice(0, -candidateSuffix.length);
      if (stagingName.length === MIGRATION_STAGING_PREFIX.length) return null;
      return { stagingName, role, cleanup };
    }
  }
  return null;
}

async function listPreJournalInitializationStates(destinationWorkspaceRoot, storeAnchors) {
  const { configRoot, changesRoot } = storeAnchors;
  const records = new Map();
  for (const entry of await readdir(configRoot, { withFileTypes: true })) {
    const info = initializationEvidenceNameInfo(entry.name);
    if (!info) continue;
    const record = records.get(info.stagingName) ?? {
      reservation: [],
      binding: [],
    };
    record[info.role].push({
      path: join(configRoot, entry.name),
      cleanup: info.cleanup,
      entry,
    });
    records.set(info.stagingName, record);
  }
  if (records.size === 0) return new Map();

  const authorityPath = getConfigPath(destinationWorkspaceRoot);
  const [authorityState, authoritySource] = await Promise.all([
    pathState(authorityPath),
    readFile(authorityPath, "utf8").catch(() => null),
  ]);
  if (!authorityState?.isFile()
    || authorityState.isSymbolicLink()
    || authoritySource === null
    || resolve(dirname(authorityPath)) !== resolve(configRoot)
    || !(await isPathPhysicallyInside(storeAnchors.workspace.physicalPath, authorityPath))) {
    throw journalFailure(
      authorityPath,
      "Pre-journal migration initialization lacks canonical workspace configuration authority.",
    );
  }
  const authorityIdentity = fileIdentity(authorityState);
  const authorityHash = sourceHash(authoritySource);
  const workspaceAnchor = await captureDirectoryAnchor(
    destinationWorkspaceRoot,
    "Migration workspace",
    "MIGRATION_RECOVERY_FAILED",
  );
  const states = new Map();
  for (const [stagingName, evidence] of records) {
    const stagingRoot = join(changesRoot, stagingName);
    const journalPath = join(stagingRoot, MIGRATION_JOURNAL_NAME);
    if (evidence.reservation.length === 0) {
      throw journalFailure(
        journalPath,
        "Migration initialization binding exists without its owner-bound reservation.",
      );
    }
    if (evidence.reservation.length > 2
      || evidence.binding.length > 2
      || new Set(evidence.reservation.map((record) => record.cleanup)).size
        !== evidence.reservation.length
      || new Set(evidence.binding.map((record) => record.cleanup)).size
        !== evidence.binding.length) {
      throw journalFailure(journalPath, "Migration initialization evidence is duplicated.");
    }
    for (const record of evidence.reservation) {
      const state = await pathState(record.path);
      const source = await readFile(record.path, "utf8").catch(() => null);
      if (!record.entry.isFile()
        || record.entry.isSymbolicLink()
        || !state?.isFile()
        || state.isSymbolicLink()
        || !sameFileIdentity(fileIdentity(state), authorityIdentity)
        || source !== authoritySource
        || sourceHash(source) !== authorityHash) {
        throw journalFailure(journalPath, "Migration initialization reservation is forged.");
      }
    }

    let bindingIdentity = null;
    let bindingSource = null;
    let bindingValue = null;
    for (const record of evidence.binding) {
      const state = await pathState(record.path);
      const source = await readFile(record.path, "utf8").catch(() => null);
      let value;
      try {
        value = JSON.parse(source);
      } catch (error) {
        throw journalFailure(
          journalPath,
          `Cannot read migration initialization binding: ${error.message}`,
        );
      }
      requireExactJournalKeys(
        value,
        [
          "version",
          "stagingRoot",
          "destinationWorkspaceRoot",
          "ownerIdentity",
          "reservationIdentity",
          "stagingPhase",
          "stagingIdentity",
          "changesIdentity",
          "authorityPath",
          "authorityIdentity",
          "authorityHash",
          "authorityMode",
          "authorityOwnerAnchor",
        ],
        "migration initialization binding",
        journalPath,
      );
      requireJournalIdentity(
        value.ownerIdentity,
        "migration initialization binding ownerIdentity",
        journalPath,
      );
      requireJournalIdentity(
        value.reservationIdentity,
        "migration initialization binding reservationIdentity",
        journalPath,
      );
      requireJournalIdentity(
        value.stagingIdentity,
        "migration initialization binding stagingIdentity",
        journalPath,
        { nullable: true },
      );
      requireJournalIdentity(
        value.changesIdentity,
        "migration initialization binding changesIdentity",
        journalPath,
      );
      requireJournalIdentity(
        value.authorityIdentity,
        "migration initialization binding authorityIdentity",
        journalPath,
      );
      requireJournalAnchor(
        value.authorityOwnerAnchor,
        "migration initialization binding authorityOwnerAnchor",
        journalPath,
      );
      if (!record.entry.isFile()
        || record.entry.isSymbolicLink()
        || !state?.isFile()
        || state.isSymbolicLink()
        || value.version !== 1
        || resolve(value.stagingRoot) !== resolve(stagingRoot)
        || resolve(value.destinationWorkspaceRoot) !== resolve(destinationWorkspaceRoot)
        || !sameFileIdentity(value.ownerIdentity, fileIdentity(state))
        || !sameFileIdentity(value.reservationIdentity, authorityIdentity)
        || value.stagingPhase !== "pending"
        || value.stagingIdentity !== null
        || resolve(value.authorityPath) !== resolve(authorityPath)
        || !sameFileIdentity(value.authorityIdentity, authorityIdentity)
        || value.authorityHash !== authorityHash
        || !Number.isInteger(value.authorityMode)
        || value.authorityMode < 0
        || value.authorityMode > 0o777
        || value.authorityMode !== (authorityState.mode & 0o777)
        || value.authorityOwnerAnchor?.logicalPath !== workspaceAnchor.logicalPath
        || value.authorityOwnerAnchor?.physicalPath !== workspaceAnchor.physicalPath
        || !sameFileIdentity(value.authorityOwnerAnchor, workspaceAnchor)
        || !sameFileIdentity(value.changesIdentity, {
          dev: storeAnchors.changes.dev,
          ino: storeAnchors.changes.ino,
        })
        || (bindingIdentity !== null
          && !sameFileIdentity(bindingIdentity, fileIdentity(state)))
        || (bindingSource !== null && bindingSource !== source)) {
        throw journalFailure(journalPath, "Migration initialization binding is forged.");
      }
      bindingIdentity = fileIdentity(state);
      bindingSource = source;
      bindingValue = value;
    }

    const stagingState = await pathState(stagingRoot);
    if (bindingValue !== null && stagingState
      && (!stagingState.isDirectory() || stagingState.isSymbolicLink())) {
      throw journalFailure(journalPath, "Migration staging root was replaced after initialization.");
    }
    states.set(stagingName, {
      plan: null,
      destinationWorkspaceRoot: resolve(destinationWorkspaceRoot),
      workspaceAnchor,
      authority: { planningOwners: new Set(), repositoryOwners: new Set() },
      stagingRoot,
      stagingIdentity: stagingState && bindingValue
        ? fileIdentity(stagingState)
        : null,
      journalPath,
      journalIdentity: null,
      journalHash: null,
      journalWriteCleanupPath: join(
        stagingRoot,
        MIGRATION_JOURNAL_WRITE_CLEANUP_DIRECTORY_NAME,
      ),
      initializationPhase: "reserved",
      initializationReservationPath: initializationReservationPath(
        destinationWorkspaceRoot,
        stagingRoot,
      ),
      initializationReservationIdentity: authorityIdentity,
      initializationReservationSource: authoritySource,
      initializationReservationHash: authorityHash,
      initializationBindingPath: initializationBindingPath(
        destinationWorkspaceRoot,
        stagingRoot,
      ),
      initializationBindingIdentity: bindingIdentity,
      initializationBindingSource: bindingSource,
      initializationAuthorityPath: bindingValue?.authorityPath ?? authorityPath,
      initializationAuthorityIdentity: bindingValue?.authorityIdentity ?? authorityIdentity,
      initializationAuthorityMode: bindingValue?.authorityMode ?? (authorityState.mode & 0o777),
      initializationAuthorityOwnerAnchor: bindingValue?.authorityOwnerAnchor ?? workspaceAnchor,
      storeAnchors: {
        ...storeAnchors,
        staging: stagingState && bindingValue
          ? await captureDirectoryAnchor(stagingRoot, "Migration staging root", "CONCURRENT_CHANGE")
          : null,
      },
      status: "initializing",
      durable: true,
      finished: false,
      mutationLock: null,
    });
  }
  return states;
}
async function recoverPreJournalInitialization(state) {
  const [workspace, config, changes] = await Promise.all([
    assertStoredDirectoryAnchor(
      state.storeAnchors.workspaceRoot,
      state.storeAnchors.workspace,
      "Destination migration workspace",
    ),
    assertStoredDirectoryAnchor(
      state.storeAnchors.configRoot,
      state.storeAnchors.config,
      "Destination configuration store",
    ),
    assertStoredDirectoryAnchor(
      state.storeAnchors.changesRoot,
      state.storeAnchors.changes,
      "Destination Change store",
    ),
  ]);
  await assertStoredDirectoryAnchor(
    state.initializationAuthorityOwnerAnchor.logicalPath,
    state.initializationAuthorityOwnerAnchor,
    "Migration initialization authority owner",
  );
  const [authorityState, authoritySource] = await Promise.all([
    pathState(state.initializationAuthorityPath),
    readFile(state.initializationAuthorityPath, "utf8").catch(() => null),
  ]);
  if (!isStrictlyInside(workspace.physicalPath, config.physicalPath)
    || !isStrictlyInside(config.physicalPath, changes.physicalPath)
    || !authorityState?.isFile()
    || authorityState.isSymbolicLink()
    || (authorityState.mode & 0o777) !== state.initializationAuthorityMode
    || !sameFileIdentity(fileIdentity(authorityState), state.initializationAuthorityIdentity)
    || authoritySource !== state.initializationReservationSource
    || sourceHash(authoritySource) !== state.initializationReservationHash) {
    throw journalFailure(
      state.journalPath,
      "Pre-journal migration initialization authority changed before cleanup.",
    );
  }

  const stagingState = await pathState(state.stagingRoot);
  if (stagingState) {
    if (state.stagingIdentity === null
      || state.initializationBindingIdentity === null
      || !stagingState.isDirectory()
      || stagingState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(stagingState), state.stagingIdentity)) {
      throw journalFailure(
        state.journalPath,
        "Unbound or replaced pre-journal migration staging must be preserved.",
      );
    }
    const entries = await readdir(state.stagingRoot, { withFileTypes: true });
    const cleanupName = basename(state.journalWriteCleanupPath);
    if (entries.some((entry) => entry.name !== cleanupName)
      || entries.length > 1) {
      throw journalFailure(
        state.journalPath,
        "Pre-journal migration staging contains opaque state and must be preserved.",
      );
    }
    if (entries.length === 1) {
      const cleanupState = await pathState(state.journalWriteCleanupPath);
      if (!entries[0].isDirectory()
        || entries[0].isSymbolicLink()
        || !cleanupState?.isDirectory()
        || cleanupState.isSymbolicLink()
        || (cleanupState.mode & 0o077) !== 0
        || (await readdir(state.journalWriteCleanupPath)).length !== 0) {
        throw journalFailure(
          state.journalPath,
          "Pre-journal cleanup reservation contains opaque state and must be preserved.",
        );
      }
      const cleanupIdentity = fileIdentity(cleanupState);
      assertDirectoryIdentitySync(
        state.journalWriteCleanupPath,
        cleanupIdentity,
        "Pre-journal cleanup reservation",
      );
      if (readdirSync(state.journalWriteCleanupPath).length !== 0) {
        throw journalFailure(
          state.journalPath,
          "Pre-journal cleanup reservation changed before removal.",
        );
      }
      rmdirSync(state.journalWriteCleanupPath);
    }
    assertDirectoryIdentitySync(
      state.stagingRoot,
      state.stagingIdentity,
      "Pre-journal migration staging",
    );
    if (readdirSync(state.stagingRoot).length !== 0) {
      throw journalFailure(
        state.journalPath,
        "Pre-journal migration staging changed before removal.",
      );
    }
    rmdirSync(state.stagingRoot);
    await syncDirectory(state.storeAnchors.changesRoot);
  }

  if (state.initializationBindingIdentity !== null) {
    await removeProvenFile(state.initializationBindingPath, {
      expectedIdentity: state.initializationBindingIdentity,
      expectedHash: sourceHash(state.initializationBindingSource),
      quarantineParent: state.storeAnchors.configRoot,
      quarantinePath: initializationEvidenceCleanupPath(state.initializationBindingPath),
      label: "Pre-journal migration initialization binding",
      assertBoundary: async () => {
        await assertStoredDirectoryAnchor(
          state.storeAnchors.configRoot,
          state.storeAnchors.config,
          "Destination configuration store",
        );
        return true;
      },
    });
  }
  await removeProvenFile(state.initializationReservationPath, {
    expectedIdentity: state.initializationReservationIdentity,
    expectedHash: state.initializationReservationHash,
    quarantineParent: state.storeAnchors.configRoot,
    quarantinePath: initializationEvidenceCleanupPath(state.initializationReservationPath),
    label: "Pre-journal migration initialization reservation",
    assertBoundary: async () => {
      await assertStoredDirectoryAnchor(
        state.storeAnchors.configRoot,
        state.storeAnchors.config,
        "Destination configuration store",
      );
      return true;
    },
  });
  for (const path of [
    state.initializationBindingPath,
    initializationEvidenceCleanupPath(state.initializationBindingPath),
    state.initializationReservationPath,
    initializationEvidenceCleanupPath(state.initializationReservationPath),
  ]) {
    if (await pathState(path)) {
      throw journalFailure(state.journalPath, `Pre-journal evidence survived cleanup: ${path}`);
    }
  }
  state.finished = true;
}

async function listTransactionStates(destinationWorkspaceRoot) {
  const changesRoot = getChangesRoot(destinationWorkspaceRoot);
  await assertChangeStoreConfinement(changesRoot, destinationWorkspaceRoot);
  const rootState = await pathState(changesRoot);
  if (!rootState) return [];
  if (!rootState.isDirectory() || rootState.isSymbolicLink()) {
    throw migrationError(`Change store is not a real directory: ${changesRoot}`, "UNSAFE_ARTIFACT_PATH");
  }
  const storeAnchors = await captureTransactionStoreAnchors(destinationWorkspaceRoot);
  const initializationStates = await listPreJournalInitializationStates(
    destinationWorkspaceRoot,
    storeAnchors,
  );
  const states = [];
  const statesByStagingName = new Map();
  const receiptCandidates = new Map();
  const entries = await readdir(changesRoot, { withFileTypes: true });
  for (const entry of entries) {
    const receiptInfo = terminalCleanupReceiptNameInfo(entry.name);
    if (!receiptInfo) continue;
    const receiptPath = join(changesRoot, entry.name);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw journalFailure(receiptPath, "Terminal cleanup receipt entry is not a regular file.");
    }
    const candidates = receiptCandidates.get(receiptInfo.stagingName) ?? [];
    candidates.push({
      path: receiptPath,
      role: receiptInfo.role,
      quarantined: receiptInfo.quarantined,
    });
    receiptCandidates.set(receiptInfo.stagingName, candidates);
  }
  for (const entry of entries) {
    if (terminalCleanupReceiptNameInfo(entry.name)) continue;
    if (!entry.name.startsWith(MIGRATION_STAGING_PREFIX)) continue;
    const stagingRoot = join(changesRoot, entry.name);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw journalFailure(stagingRoot, "Migration staging entry is not a real directory.");
    }
    await assertChangeStoreConfinement(stagingRoot, destinationWorkspaceRoot);
    const journalPath = join(stagingRoot, MIGRATION_JOURNAL_NAME);
    const journalState = await pathState(journalPath);
    if (journalState && (!journalState.isFile() || journalState.isSymbolicLink())) {
      throw journalFailure(journalPath, "Migration journal is not a confined regular file.");
    }
    if (!(await isPathPhysicallyInside(stagingRoot, journalPath))) {
      throw journalFailure(journalPath, "Migration journal escapes its transaction staging root.");
    }
    const interrupted = await inspectInterruptedJournalWrite({ stagingRoot, journalPath });
    let journal = null;
    let journalReadError = null;
    if (interrupted !== null) {
      try {
        journal = JSON.parse(interrupted.candidateSource);
      } catch (error) {
        throw journalFailure(journalPath, `Cannot read the interrupted journal candidate: ${error.message}`);
      }
    } else if (journalState) {
      try {
        journal = JSON.parse(await readFile(journalPath, "utf8"));
      } catch (error) {
        journalReadError = error;
      }
    }
    if (!journal && receiptCandidates.has(entry.name)) continue;
    if (!journal) {
      const initializationState = initializationStates.get(entry.name);
      if (initializationState && !journalReadError) {
        states.push(initializationState);
        statesByStagingName.set(entry.name, initializationState);
        initializationStates.delete(entry.name);
        continue;
      }
      throw journalFailure(
        journalPath,
        journalReadError
          ? `Cannot read the journal: ${journalReadError.message}`
          : "Migration journal is missing without an identity-bound replacement.",
      );
    }
    const state = await hydrateTransaction(
      journal,
      stagingRoot,
      journalPath,
      destinationWorkspaceRoot,
      interrupted,
    );
    states.push(state);
    statesByStagingName.set(entry.name, state);
    initializationStates.delete(entry.name);
  }
  for (const [stagingName, state] of initializationStates) {
    const stagingState = await pathState(state.stagingRoot);
    if (stagingState) {
      throw journalFailure(
        state.journalPath,
        `Pre-journal migration staging state was not enumerated safely: ${stagingName}`,
      );
    }
    states.push(state);
    statesByStagingName.set(stagingName, state);
  }

  const rolePriority = { receipt: 0, proof: 1, stage: 2 };
  for (const [stagingName, candidates] of receiptCandidates) {
    candidates.sort((left, right) => (
      rolePriority[left.role] - rolePriority[right.role]
      || Number(left.quarantined) - Number(right.quarantined)
      || left.path.localeCompare(right.path)
    ));
    const journalState = statesByStagingName.get(stagingName);
    const terminalState = await hydrateTerminalCleanupReceipt(
      candidates[0].path,
      destinationWorkspaceRoot,
      { allowUnpublishedStage: journalState != null },
    );
    if (!journalState) {
      states.push(terminalState);
      continue;
    }
    const receipt = terminalState.terminalCleanupReceipt.value;
    if (journalState.terminalCleanupPlan === null
      || !sameFileIdentity(receipt.journalIdentity, journalState.journalIdentity)
      || receipt.journalHash !== journalState.journalHash
      || JSON.stringify(receipt.plan) !== JSON.stringify(journalState.terminalCleanupPlan)) {
      throw journalFailure(
        journalState.journalPath,
        "Duplicate terminal cleanup receipt does not bind its live journal.",
      );
    }
    journalState.terminalCleanupReceipt = terminalState.terminalCleanupReceipt;
  }
  return states.sort((left, right) => left.stagingRoot.localeCompare(right.stagingRoot));
}

function matchingWorkspaceAnchor(left, right) {
  return left.physicalPath === right.physicalPath && sameFileIdentity(left, right);
}

async function assertExistingTransferTreeCurrent(
  source,
  target,
  beforeMutation = null,
  { allowEmptyRoot = false } = {},
) {
  if (beforeMutation) await beforeMutation({ source, target, phase: "preflight" });
  const [sourceState, targetState] = await Promise.all([
    pathState(source),
    pathState(target),
  ]);
  if (!sourceState || !targetState) {
    throw migrationError(
      `Migration transfer destination contains an entry absent from its source: ${target}`,
      "CONCURRENT_CHANGE",
    );
  }

  if (sourceState.isDirectory() && !sourceState.isSymbolicLink()) {
    if (!targetState.isDirectory() || targetState.isSymbolicLink()) {
      throw migrationError(
        `Migration transfer destination entry has a different type from its source: ${target}`,
        "CONCURRENT_CHANGE",
      );
    }
    const sourceIdentity = fileIdentity(sourceState);
    const targetIdentity = fileIdentity(targetState);
    const assertDirectories = async (mutation = { source, target, phase: "preflight" }) => {
      if (beforeMutation) await beforeMutation(mutation);
      const [currentSource, currentTarget] = await Promise.all([
        pathState(source),
        pathState(target),
      ]);
      if (!currentSource?.isDirectory()
        || currentSource.isSymbolicLink()
        || !sameFileIdentity(fileIdentity(currentSource), sourceIdentity)
        || !currentTarget?.isDirectory()
        || currentTarget.isSymbolicLink()
        || !sameFileIdentity(fileIdentity(currentTarget), targetIdentity)) {
        throw migrationError(
          `Migration transfer pre-existing directory changed: ${target}`,
          "CONCURRENT_CHANGE",
        );
      }
    };
    await assertDirectories();
    const entries = (await readdir(target)).sort((left, right) => left.localeCompare(right));
    if (entries.length === 0 && !allowEmptyRoot) {
      throw migrationError(
        `Migration transfer pre-existing directory has no authenticated source-owned entries: ${target}`,
        "CONCURRENT_CHANGE",
      );
    }
    for (const entry of entries) {
      await assertDirectories();
      await assertExistingTransferTreeCurrent(
        join(source, entry),
        join(target, entry),
        assertDirectories,
      );
      await assertDirectories();
    }
    const currentEntries = (await readdir(target))
      .sort((left, right) => left.localeCompare(right));
    if (JSON.stringify(currentEntries) !== JSON.stringify(entries)) {
      throw migrationError(
        `Migration transfer destination gained opaque state during preflight: ${target}`,
        "CONCURRENT_CHANGE",
      );
    }
    await assertDirectories();
    return;
  }

  if (sourceState.isFile() && !sourceState.isSymbolicLink()) {
    if (!targetState.isFile()
      || targetState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(sourceState), fileIdentity(targetState))) {
      throw migrationError(
        `Migration transfer pre-existing file is not source-owned: ${target}`,
        "CONCURRENT_CHANGE",
      );
    }
    const identity = fileIdentity(sourceState);
    const assertFiles = async () => {
      if (beforeMutation) await beforeMutation({ source, target, phase: "preflight" });
      const [currentSource, currentTarget] = await Promise.all([
        pathState(source),
        pathState(target),
      ]);
      if (!currentSource?.isFile()
        || currentSource.isSymbolicLink()
        || !sameFileIdentity(fileIdentity(currentSource), identity)
        || !currentTarget?.isFile()
        || currentTarget.isSymbolicLink()
        || !sameFileIdentity(fileIdentity(currentTarget), identity)) {
        throw migrationError(
          `Migration transfer pre-existing file changed: ${target}`,
          "CONCURRENT_CHANGE",
        );
      }
    };
    await assertFiles();
    const [sourceHashBefore, targetHashBefore] = await Promise.all([
      hashFile(source).catch(() => null),
      hashFile(target).catch(() => null),
    ]);
    if (sourceHashBefore === null || sourceHashBefore !== targetHashBefore) {
      throw migrationError(
        `Migration transfer pre-existing file bytes do not match its source: ${target}`,
        "CONCURRENT_CHANGE",
      );
    }
    await assertFiles();
    const [sourceHashAfter, targetHashAfter] = await Promise.all([
      hashFile(source).catch(() => null),
      hashFile(target).catch(() => null),
    ]);
    if (sourceHashAfter !== sourceHashBefore || targetHashAfter !== sourceHashBefore) {
      throw migrationError(
        `Migration transfer pre-existing file bytes changed during preflight: ${target}`,
        "CONCURRENT_CHANGE",
      );
    }
    await assertFiles();
    return;
  }

  if (sourceState.isSymbolicLink()) {
    if (!targetState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(sourceState), fileIdentity(targetState))) {
      throw migrationError(
        `Migration transfer pre-existing symbolic link is not source-owned: ${target}`,
        "CONCURRENT_CHANGE",
      );
    }
    const identity = fileIdentity(sourceState);
    const [sourceLink, targetLink] = await Promise.all([
      readlink(source).catch(() => null),
      readlink(target).catch(() => null),
    ]);
    if (sourceLink === null || sourceLink !== targetLink) {
      throw migrationError(
        `Migration transfer pre-existing symbolic link target changed: ${target}`,
        "CONCURRENT_CHANGE",
      );
    }
    if (beforeMutation) await beforeMutation({ source, target, phase: "preflight" });
    const [currentSource, currentTarget, currentSourceLink, currentTargetLink] = await Promise.all([
      pathState(source),
      pathState(target),
      readlink(source).catch(() => null),
      readlink(target).catch(() => null),
    ]);
    if (!currentSource?.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(currentSource), identity)
      || !currentTarget?.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(currentTarget), identity)
      || currentSourceLink !== sourceLink
      || currentTargetLink !== sourceLink) {
      throw migrationError(
        `Migration transfer pre-existing symbolic link changed during preflight: ${target}`,
        "CONCURRENT_CHANGE",
      );
    }
    return;
  }

  throw migrationError(
    `Migration transfer source has an unsupported type: ${source}`,
    "CONCURRENT_CHANGE",
  );
}

async function copyPathWithoutReplace(
  source,
  target,
  { allowExisting = false, beforeMutation = null, linkFile = link } = {},
) {
  const sourceState = await pathState(source);
  if (!sourceState) {
    throw migrationError(`Migration transfer source disappeared: ${source}`, "CONCURRENT_CHANGE");
  }
  let targetState = await pathState(target);
  const targetWasExisting = targetState !== null;
  if (sourceState.isDirectory() && !sourceState.isSymbolicLink()) {
    if (targetState) {
      if (!allowExisting || !targetState.isDirectory() || targetState.isSymbolicLink()) {
        throw migrationError(`Migration transfer destination already exists: ${target}`, "CONCURRENT_CHANGE");
      }
    } else {
      if (beforeMutation) await beforeMutation({ source, target });
      try {
        await mkdir(target, { mode: sourceState.mode & 0o777 });
      } catch (error) {
        throw migrationError(
          `Migration transfer destination changed before directory creation: ${target}`,
          "CONCURRENT_CHANGE",
          [error.message],
        );
      }
      targetState = await pathState(target);
    }
    if (!targetState?.isDirectory() || targetState.isSymbolicLink()) {
      throw migrationError(`Migration transfer destination is not a real directory: ${target}`, "CONCURRENT_CHANGE");
    }
    const targetIdentity = fileIdentity(targetState);
    const assertTargetDirectory = async (mutation = { source, target }) => {
      if (beforeMutation) await beforeMutation(mutation);
      const currentTargetState = await pathState(target);
      if (!currentTargetState?.isDirectory()
        || currentTargetState.isSymbolicLink()
        || !sameFileIdentity(fileIdentity(currentTargetState), targetIdentity)) {
        throw migrationError(
          `Migration transfer destination directory changed: ${target}`,
          "CONCURRENT_CHANGE",
        );
      }
    };
    await assertTargetDirectory();
    if (allowExisting && targetWasExisting) {
      await assertExistingTransferTreeCurrent(source, target, assertTargetDirectory);
      await assertTargetDirectory();
    }
    const entries = await readdir(source);
    for (const entry of entries.sort((left, right) => left.localeCompare(right))) {
      await assertTargetDirectory();
      await copyPathWithoutReplace(
        join(source, entry),
        join(target, entry),
        { allowExisting, beforeMutation: assertTargetDirectory, linkFile },
      );
      await assertTargetDirectory();
    }
    return;
  }
  if (!sourceState.isFile() && !sourceState.isSymbolicLink()) {
    throw migrationError(`Migration transfer source has an unsupported type: ${source}`, "CONCURRENT_CHANGE");
  }
  if (targetState) {
    if (allowExisting) {
      await assertExistingTransferTreeCurrent(source, target, beforeMutation);
      return;
    }
    throw migrationError(`Migration transfer destination already exists: ${target}`, "CONCURRENT_CHANGE");
  }
  if (sourceState.isSymbolicLink()) {
    const targetParentState = await pathState(dirname(target));
    if (!targetParentState?.isDirectory()
      || targetParentState.isSymbolicLink()
      || String(targetParentState.dev) !== String(sourceState.dev)) {
      throw migrationError(
        `Migration symbolic-link transfer cannot cross filesystems safely: ${target}`,
        "CONCURRENT_CHANGE",
      );
    }
    if (beforeMutation) await beforeMutation({ source, target });
    try {
      await linkFile(source, target);
    } catch (error) {
      throw migrationError(
        `Migration symbolic-link transfer cannot cross filesystems safely: ${target}`,
        "CONCURRENT_CHANGE",
        [error.message],
      );
    }
    if (beforeMutation) await beforeMutation({ source, target });
    const publishedState = await pathState(target);

    if (!publishedState
      || !sameFileIdentity(fileIdentity(publishedState), fileIdentity(sourceState))) {
      throw migrationError(`Migration transfer destination changed after publication: ${target}`, "CONCURRENT_CHANGE");
    }
    return;
  }
  await transferRegularFileWithoutReplace(source, target, {
    expectedSourceIdentity: fileIdentity(sourceState),
    label: "Migration transfer",
    beforeMutation,
    linkFile,
  });
}

async function copyDirectoryContentsWithoutReplace(
  source,
  target,
  {
    allowExisting = false,
    beforeMutation = null,
    afterEntry = null,
    linkFile = link,
  } = {},
) {
  const [sourceState, targetState] = await Promise.all([
    pathState(source),
    pathState(target),
  ]);
  if (!sourceState?.isDirectory()
    || sourceState.isSymbolicLink()
    || !targetState?.isDirectory()
    || targetState.isSymbolicLink()) {
    throw migrationError(`Migration transfer roots changed: ${source} -> ${target}`, "CONCURRENT_CHANGE");
  }
  const sourceIdentity = fileIdentity(sourceState);
  const targetIdentity = fileIdentity(targetState);
  const assertRoots = async (mutation = { source, target }) => {
    if (beforeMutation) await beforeMutation(mutation);
    const [currentSource, currentTarget] = await Promise.all([
      pathState(source),
      pathState(target),
    ]);
    if (!currentSource?.isDirectory()
      || currentSource.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(currentSource), sourceIdentity)
      || !currentTarget?.isDirectory()
      || currentTarget.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(currentTarget), targetIdentity)) {
      throw migrationError(`Migration transfer roots changed: ${source} -> ${target}`, "CONCURRENT_CHANGE");
    }
  };
  await assertRoots();
  if (allowExisting) {
    await assertExistingTransferTreeCurrent(
      source,
      target,
      assertRoots,
      { allowEmptyRoot: true },
    );
    await assertRoots();
  }
  const entries = await readdir(source);
  for (const entry of entries.sort((left, right) => left.localeCompare(right))) {
    await assertRoots();
    await copyPathWithoutReplace(
      join(source, entry),
      join(target, entry),
      { allowExisting, beforeMutation: assertRoots, linkFile },
    );
    await assertRoots();
    if (afterEntry) {
      await afterEntry({
        source: join(source, entry),
        target: join(target, entry),
        entry,
      });
    }
  }
}
async function reconcileCopyTargetManifest(
  root,
  manifest,
  sourceManifest,
  intent,
  label,
) {
  const rootState = await pathState(root);
  if (!rootState) {
    if (manifest.length !== 0) {
      throw migrationError(`${label} lost proven destination state: ${root}`, "CONCURRENT_CHANGE");
    }
    return [];
  }
  const current = await collectDirectoryRemovalManifest(root, label);
  const expected = new Map(manifest.map((entry) => [entry.relativePath, entry]));
  const sourceByPath = new Map(sourceManifest.map((entry) => [entry.relativePath, entry]));
  const reconciled = [];
  for (const entry of current) {
    const proven = expected.get(entry.relativePath);
    const sourceEntry = sourceByPath.get(entry.relativePath);
    const completedWrite = proven?.type === "file"
      && sameFileIdentity(entry.identity, proven.identity)
      && entry.mode === proven.mode
      && entry.mode === sourceEntry?.mode
      && proven.hash === sourceHash(Buffer.alloc(0))
      && entry.hash === sourceEntry?.hash;
    if (!proven) {
      throw migrationError(`${label} contains unproven state: ${entry.relativePath}`, "CONCURRENT_CHANGE");
    }
    if (proven && !sameRemovalEntry(entry, proven) && !completedWrite) {
      throw migrationError(`${label} contains replaced state: ${entry.relativePath}`, "CONCURRENT_CHANGE");
    }
    const evidence = removalEntryEvidence(entry);
    evidence.quarantineRelativePath = proven?.quarantineRelativePath
      ?? (entry.type === "directory"
        ? null
        : normalizePath(relative(
          root,
          join(dirname(removalManifestPath(root, entry.relativePath)), `.sdd-remove-${process.pid}-${randomUUID()}`),
        )));
    reconciled.push(evidence);
  }
  if (manifest.some(
    (entry) => !current.some((candidate) => candidate.relativePath === entry.relativePath),
  )) {
    throw migrationError(`${label} lost proven destination state: ${root}`, "CONCURRENT_CHANGE");
  }
  return reconciled;
}

async function assertCopyTargetSubset(root, manifest, sourceManifest, intent, label) {
  await reconcileCopyTargetManifest(root, manifest, sourceManifest, intent, label);
}

function copyTargetRemovalManifest(
  containerRoot,
  copyRoot,
  copyManifest,
  rootIdentity,
  rootMode,
) {
  const prefix = normalizePath(relative(containerRoot, copyRoot));
  const root = {
    relativePath: ".",
    type: "directory",
    identity: rootIdentity,
    mode: rootMode,
    hash: null,
    target: null,
    quarantineRelativePath: null,
  };
  return [
    root,
    ...copyManifest.map((entry) => ({
      ...entry,
      relativePath: entry.relativePath === "."
        ? prefix
        : `${prefix}/${entry.relativePath}`,
      quarantineRelativePath: entry.quarantineRelativePath === null
        ? null
        : `${prefix}/${entry.quarantineRelativePath}`,
    })),
  ];
}

function sourceBackupProofPaths(backup, token) {
  const root = `${backup}.sdd-source-proof-${token}`;
  const owner = `${root}.owner`;
  const receipt = `${root}.receipt`;
  return {
    root,
    owner,
    receipt,
    ownerCleanup: `${owner}.cleanup`,
    receiptCleanup: `${receipt}.cleanup`,
  };
}

function sourceBackupCanonicalValue(value) {
  if (value === null) return "n";
  if (typeof value === "boolean") return value ? "b1" : "b0";
  if (typeof value === "number") return `d${String(value).length}:${String(value)}`;
  if (typeof value === "string") return `s${Buffer.byteLength(value)}:${value}`;
  if (Array.isArray(value)) {
    return `a${value.length}:${value.map((entry) => sourceBackupCanonicalValue(entry)).join("")}`;
  }
  const keys = Object.keys(value).sort((left, right) => left.localeCompare(right));
  return `o${keys.length}:${keys.map((key) => (
    `${sourceBackupCanonicalValue(key)}${sourceBackupCanonicalValue(value[key])}`
  )).join("")}`;
}

function sourceBackupCanonicalHash(value) {
  return `sha256:${createHash("sha256")
    .update(sourceBackupCanonicalValue(value))
    .digest("hex")}`;
}

function sameSourceBackupValue(left, right) {
  return sourceBackupCanonicalValue(left) === sourceBackupCanonicalValue(right);
}

function sourceBackupAuthorityPayload(state, record) {
  return {
    transaction: {
      stagingRoot: resolve(state.stagingRoot),
      destinationWorkspaceRoot: resolve(state.destinationWorkspaceRoot),
      workspaceAnchor: state.workspaceAnchor,
    },
    source: {
      path: record.path,
      hash: record.hash,
      ownerRoot: record.ownerRoot,
      physicalPath: record.physicalPath,
      identity: record.identity,
      ownerPhysicalPath: record.ownerPhysicalPath,
      ownerIdentity: record.ownerIdentity,
    },
    backup: {
      path: record.backup,
      identity: record.backupIdentity,
      mode: record.backupMode,
      proofToken: record.backupProofToken,
      proofRoot: record.backupProofRoot,
    },
  };
}

function sourceBackupReceiptSource(kind, payload) {
  const canonical = {
    version: SOURCE_BACKUP_PROVENANCE_VERSION,
    scheme: SOURCE_BACKUP_PROVENANCE_SCHEME,
    kind,
    payload,
  };
  return `${JSON.stringify({
    ...canonical,
    canonicalHash: sourceBackupCanonicalHash(canonical),
  }, null, 2)}\n`;
}

async function readSourceBackupReceipt(path, kind, label) {
  const state = await pathState(path);
  if (!state?.isFile() || state.isSymbolicLink() || (state.mode & 0o777) !== 0o400) {
    throw migrationError(`${label} is not an immutable mode-bound regular file: ${path}`, "CONCURRENT_CHANGE");
  }
  const identity = fileIdentity(state);
  const source = await readFile(path, "utf8").catch(() => null);
  const rebound = await pathState(path);
  if (source === null
    || !rebound?.isFile()
    || rebound.isSymbolicLink()
    || (rebound.mode & 0o777) !== 0o400
    || !sameFileIdentity(fileIdentity(rebound), identity)) {
    throw migrationError(`${label} changed while it was read: ${path}`, "CONCURRENT_CHANGE");
  }
  let receipt;
  try {
    receipt = JSON.parse(source);
  } catch (error) {
    throw migrationError(`${label} is not valid JSON: ${path}`, "CONCURRENT_CHANGE", [
      error.message,
    ]);
  }
  const keys = Object.keys(receipt).sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(keys) !== JSON.stringify([
    "canonicalHash",
    "kind",
    "payload",
    "scheme",
    "version",
  ])
    || receipt.version !== SOURCE_BACKUP_PROVENANCE_VERSION
    || receipt.scheme !== SOURCE_BACKUP_PROVENANCE_SCHEME
    || receipt.kind !== kind) {
    throw migrationError(`${label} has an unsupported shape: ${path}`, "CONCURRENT_CHANGE");
  }
  const canonical = {
    version: receipt.version,
    scheme: receipt.scheme,
    kind: receipt.kind,
    payload: receipt.payload,
  };
  if (receipt.canonicalHash !== sourceBackupCanonicalHash(canonical)
    || source !== sourceBackupReceiptSource(kind, receipt.payload)) {
    throw migrationError(`${label} changed canonical content: ${path}`, "CONCURRENT_CHANGE");
  }
  return { identity, mode: 0o400, source, hash: sourceHash(source), payload: receipt.payload };
}

async function writeSourceBackupReceipt(path, kind, payload, label) {
  const source = sourceBackupReceiptSource(kind, payload);
  const handle = await open(path, "wx", 0o400);
  let identity;
  try {
    await handle.chmod(0o400);
    const created = await handle.stat();
    if (!created.isFile() || (created.mode & 0o777) !== 0o400) {
      throw migrationError(`${label} reservation is not a mode-bound regular file: ${path}`, "CONCURRENT_CHANGE");
    }
    identity = fileIdentity(created);
    await handle.writeFile(source);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(dirname(path));
  const receipt = await readSourceBackupReceipt(path, kind, label);
  if (!sameFileIdentity(receipt.identity, identity)
    || receipt.source !== source) {
    throw migrationError(`${label} changed during creation: ${path}`, "CONCURRENT_CHANGE");
  }
  return receipt;
}

function sourceBackupSourceEntries(manifest) {
  return manifest.map((entry) => removalEntryEvidence(entry));
}

function sourceBackupOwnerPayload(state, record, sourceManifest) {
  return {
    authority: sourceBackupAuthorityPayload(state, record),
    proofRootIdentity: record.backupProofRootIdentity,
    sourceEntries: sourceBackupSourceEntries(sourceManifest),
  };
}

function sourceBackupEntryCore(record, sourceEntry, index, targetIdentity) {
  return {
    token: record.backupProofToken,
    index,
    relativePath: sourceEntry.relativePath,
    type: sourceEntry.type,
    sourceIdentity: sourceEntry.identity,
    sourceMode: sourceEntry.mode,
    sourceHash: sourceEntry.hash,
    sourceTarget: sourceEntry.target,
    targetIdentity,
    targetMode: sourceEntry.mode,
    targetHash: sourceEntry.type === "file" ? sourceEntry.hash : null,
    targetTarget: sourceEntry.type === "symlink" ? sourceEntry.target : null,
  };
}

function sourceBackupEntryProvenance(record, sourceEntry, index, targetIdentity) {
  const core = sourceBackupEntryCore(record, sourceEntry, index, targetIdentity);
  const digest = sourceBackupCanonicalHash(core).slice("sha256:".length);
  const stem = `.entry-${index}-${sourceEntry.type}-${targetIdentity.dev}-${targetIdentity.ino}-${digest}`;
  return {
    ...core,
    digest,
    ownerWitnessPath: join(record.backupProofRoot, `${stem}.owner`),
    targetWitnessPath: sourceEntry.type === "directory"
      ? null
      : join(record.backupProofRoot, `${stem}.target`),
  };
}

function sameSourceBackupEntryProvenance(left, right) {
  return sameSourceBackupValue(left, right);
}

function sourceBackupEntryEvidence(entry) {
  return {
    relativePath: entry.relativePath,
    type: entry.type,
    identity: entry.targetIdentity,
    mode: entry.targetMode,
    hash: entry.targetHash,
    target: entry.targetTarget,
  };
}

function sourceRestoreIntentPath(record) {
  return record.restoreReservationToken === null
    ? null
    : join(record.backupProofRoot, `.source-restore-${record.restoreReservationToken}.intent`);
}

function sourceRestoreReservationMarkerPath(record) {
  return record.restoreReservationToken === null
    ? null
    : join(record.physicalPath, `.sdd-source-restore-${record.restoreReservationToken}.owner`);
}

function sourceRestoreEntryCore(record, sourceEntry, index, targetIdentity) {
  return {
    token: record.restoreCopyProvenanceToken,
    index,
    relativePath: sourceEntry.relativePath,
    type: sourceEntry.type,
    mode: sourceEntry.mode,
    targetIdentity,
  };
}

function sourceRestoreEntryPaths(record, sourceEntry, provenance) {
  const digest = sourceBackupCanonicalHash({
    ...provenance,
    sourceIdentity: sourceEntry.identity,
    sourceMode: sourceEntry.mode,
    sourceHash: sourceEntry.hash,
    sourceTarget: sourceEntry.target,
  }).slice("sha256:".length);
  const stem = `.source-restore-${record.restoreReservationToken}-${[
    provenance.token,
    provenance.index,
    provenance.type,
    provenance.targetIdentity.dev,
    provenance.targetIdentity.ino,
    digest,
  ].join("-")}`;
  return {
    owner: join(record.backupProofRoot, `${stem}.owner`),
    target: provenance.type === "file"
      ? join(record.backupProofRoot, `${stem}.target`)
      : null,
  };
}

function parseSourceRestoreEntryName(record, name) {
  const match = /^\.source-restore-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-(\d+)-(directory|file|symlink)-(\d+)-(\d+)-([0-9a-f]{64})\.(owner|target)$/i
    .exec(name);
  if (!match || match[1] !== record.restoreReservationToken) return null;
  const index = Number(match[3]);
  if (!Number.isSafeInteger(index)) return null;
  return {
    copyToken: match[2],
    index,
    type: match[4],
    targetIdentity: { dev: match[5], ino: match[6] },
    digest: match[7],
    kind: match[8],
  };
}

function sourceRestoreManifestFromBackup(record, backupEntries) {
  return backupEntries.map((entry, index) => ({
    ...sourceBackupEntryEvidence(entry),
    quarantineRelativePath: entry.type === "directory"
      ? null
      : `.sdd-source-restore-source-${record.restoreReservationToken}-${index}`,
  }));
}

function sourceRestoreCopyLedger(record) {
  return {
    get copyRoot() {
      return record.restoreCopyRoot;
    },
    set copyRoot(value) {
      record.restoreCopyRoot = value;
    },
    get copySourceRoot() {
      return record.restoreCopySourceRoot;
    },
    set copySourceRoot(value) {
      record.restoreCopySourceRoot = value;
    },
    get copySourceManifest() {
      return record.restoreCopySourceManifest;
    },
    set copySourceManifest(value) {
      record.restoreCopySourceManifest = value;
    },
    get copyTargetManifest() {
      return record.restoreCopyTargetManifest;
    },
    set copyTargetManifest(value) {
      record.restoreCopyTargetManifest = value;
    },
    get copyProvenanceToken() {
      return record.restoreCopyProvenanceToken;
    },
    set copyProvenanceToken(value) {
      record.restoreCopyProvenanceToken = value;
    },
    get copyTargetProvenance() {
      return record.restoreCopyTargetProvenance;
    },
    set copyTargetProvenance(value) {
      record.restoreCopyTargetProvenance = value;
    },
    get copyIntent() {
      return record.restoreCopyIntent;
    },
    set copyIntent(value) {
      record.restoreCopyIntent = value;
    },
  };
}

function sourceRestoreExpectedProofEntries(record, receipt) {
  const entries = [];
  if (record.restoreIntentIdentity !== null) {
    entries.push({
      relativePath: basename(sourceRestoreIntentPath(record)),
      type: "file",
      identity: receipt.identity,
      mode: receipt.mode,
      hash: receipt.hash,
      target: null,
    });
  }
  const sourceByPath = new Map(
    (record.restoreCopySourceManifest ?? []).map((entry) => [entry.relativePath, entry]),
  );
  for (const provenance of record.restoreCopyTargetProvenance) {
    const sourceEntry = sourceByPath.get(provenance.relativePath);
    if (!sourceEntry) continue;
    const paths = sourceRestoreEntryPaths(record, sourceEntry, provenance);
    entries.push({
      relativePath: basename(paths.owner),
      type: "file",
      identity: receipt.identity,
      mode: receipt.mode,
      hash: receipt.hash,
      target: null,
    });
    if (paths.target !== null) {
      entries.push({
        relativePath: basename(paths.target),
        type: "file",
        identity: provenance.targetIdentity,
        mode: sourceEntry.mode,
        hash: sourceEntry.hash,
        target: null,
      });
    }
  }
  return entries;
}

async function createSourceRestoreEntryEvidence(
  record,
  sourceEntry,
  index,
  targetPath,
  targetEntry,
) {
  if (record.restoreReservationToken === null
    || record.restoreCopyProvenanceToken === null
    || record.restoreIntentIdentity === null) {
    throw migrationError(
      `Legacy source restore entry has no durable intent: ${targetPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  const intentPath = sourceRestoreIntentPath(record);
  const provenance = sourceRestoreEntryCore(record, sourceEntry, index, targetEntry.identity);
  const paths = sourceRestoreEntryPaths(record, sourceEntry, provenance);
  const existing = record.restoreCopyTargetProvenance.find((entry) => entry.index === index);
  if (existing && !sameSourceBackupValue(existing, provenance)) {
    throw migrationError(
      `Legacy source restore proof conflicts with its journal record: ${targetPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  const [intentState, targetState] = await Promise.all([
    pathState(intentPath),
    pathState(targetPath),
  ]);
  if (!intentState?.isFile()
    || intentState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(intentState), record.restoreIntentIdentity)
    || (intentState.mode & 0o777) !== 0o400
    || !targetState
    || removalEntryType(targetState) !== sourceEntry.type
    || (targetState.mode & 0o777) !== sourceEntry.mode
    || targetEntry.mode !== sourceEntry.mode
    || !sameFileIdentity(fileIdentity(targetState), targetEntry.identity)) {
    throw migrationError(
      `Legacy source restore target changed before proof creation: ${targetPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  let ownerState = await pathState(paths.owner);
  if (!ownerState) {
    await link(intentPath, paths.owner);
    ownerState = await pathState(paths.owner);
  }
  let targetProofState = paths.target === null ? null : await pathState(paths.target);
  if (paths.target !== null && !targetProofState) {
    await link(targetPath, paths.target);
    targetProofState = await pathState(paths.target);
  }
  await syncDirectory(record.backupProofRoot);
  if (!ownerState?.isFile()
    || ownerState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(ownerState), record.restoreIntentIdentity)
    || (paths.target !== null && (
      !targetProofState?.isFile()
      || targetProofState.isSymbolicLink()
      || (targetProofState.mode & 0o777) !== sourceEntry.mode
      || !sameFileIdentity(fileIdentity(targetProofState), targetEntry.identity)
    ))) {
    throw migrationError(
      `Legacy source restore target proof changed during creation: ${targetPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  if (!existing) {
    record.restoreCopyTargetProvenance.push(provenance);
    record.restoreCopyTargetProvenance.sort((left, right) => left.index - right.index);
  }
  return provenance;
}

async function authenticateSourceRestoreEvidence(
  record,
  receipt,
  backupEntries,
  proofNames,
  payloadPath,
) {
  const restorePrefix = ".source-restore-";
  const restoreNames = proofNames.filter((name) => name.startsWith(restorePrefix));
  if (record.restoreReservationToken === null) {
    if (restoreNames.length !== 0
      || record.restoreIntentIdentity !== null
      || record.restoreCopyRoot !== null
      || record.restoreCopyTargetProvenance.length !== 0) {
      throw migrationError(
        `Migration backup proof has unbound restore evidence: ${record.backupProofRoot}`,
        "CONCURRENT_CHANGE",
      );
    }
    return new Set();
  }

  const allowed = new Set();
  const intentPath = sourceRestoreIntentPath(record);
  const intentName = basename(intentPath);
  const intentState = await pathState(intentPath);
  if (!intentState) {
    if (record.restoreIntentIdentity !== null
      || record.restoreCopyRoot !== null
      || restoreNames.length !== 0) {
      throw migrationError(
        `Legacy source restore intent disappeared: ${intentPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    return allowed;
  }
  if (!intentState.isFile()
    || intentState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(intentState), receipt.identity)
    || (record.restoreIntentIdentity !== null
      && !sameFileIdentity(record.restoreIntentIdentity, receipt.identity))) {
    throw migrationError(
      `Legacy source restore intent is not source-bound: ${intentPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  record.restoreIntentIdentity = receipt.identity;
  allowed.add(intentName);

  let sourceState = await pathState(record.physicalPath);
  const markerPath = sourceRestoreReservationMarkerPath(record);
  const markerState = sourceState?.isDirectory() && !sourceState.isSymbolicLink()
    ? await pathState(markerPath)
    : null;
  if (markerState) {
    if (!markerState.isFile()
      || markerState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(markerState), receipt.identity)) {
      throw migrationError(
        `Legacy source restore reservation lost its owner marker: ${record.physicalPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    const identity = fileIdentity(sourceState);
    if (record.restoreIdentity !== null
      && !sameFileIdentity(record.restoreIdentity, identity)) {
      throw migrationError(
        `Legacy source restore reservation changed identity: ${record.physicalPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    record.restoreIdentity = identity;
  } else if (record.restoreIdentity !== null) {
    if (!sourceState?.isDirectory()
      || sourceState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(sourceState), record.restoreIdentity)) {
      throw migrationError(
        `Legacy source restore reservation changed identity: ${record.physicalPath}`,
        "CONCURRENT_CHANGE",
      );
    }
  }

  const copyProofNames = restoreNames.filter((name) => name !== intentName);
  if (record.restoreCopyRoot === null && copyProofNames.length !== 0) {
    const parsed = copyProofNames.map((name) => parseSourceRestoreEntryName(record, name));
    if (parsed.some((entry) => entry === null)
      || payloadPath === null
      || new Set(parsed.map((entry) => entry.copyToken)).size !== 1) {
      throw migrationError(
        `Legacy source restore has unbound copy proof entries: ${record.path}`,
        "CONCURRENT_CHANGE",
      );
    }
    const rootProof = parsed.find((entry) => (
      entry.index === 0 && entry.type === "directory" && entry.kind === "owner"
    ));
    if (!rootProof
      || !sourceState?.isDirectory()
      || sourceState.isSymbolicLink()
      || (sourceState.mode & 0o777) !== backupEntries[0]?.targetMode
      || !sameFileIdentity(fileIdentity(sourceState), rootProof.targetIdentity)) {
      throw migrationError(
        `Legacy source restore copy proof lost its root reservation: ${record.path}`,
        "CONCURRENT_CHANGE",
      );
    }
    record.restoreIdentity = rootProof.targetIdentity;
    record.restoreCopyRoot = record.physicalPath;
    record.restoreCopySourceRoot = payloadPath;
    record.restoreCopySourceManifest = sourceRestoreManifestFromBackup(record, backupEntries);
    record.restoreCopyTargetManifest = [];
    record.restoreCopyProvenanceToken = rootProof.copyToken;
    record.restoreCopyTargetProvenance = [];
    record.restoreCopyIntent = null;
  }
  if (record.restoreCopyRoot === null) {
    if (record.restoreCopyTargetProvenance.length !== 0) {
      throw migrationError(
        `Legacy source restore has provenance without a copy ledger: ${record.path}`,
        "CONCURRENT_CHANGE",
      );
    }
    return allowed;
  }
  if (record.restoreCopyProvenanceToken === null
    || record.restoreCopySourceManifest === null
    || resolve(record.restoreCopyRoot) !== resolve(record.physicalPath)
    || !sourceState?.isDirectory()
    || sourceState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(sourceState), record.restoreIdentity)) {
    throw migrationError(`Legacy source restore copy ledger is invalid: ${record.path}`, "CONCURRENT_CHANGE");
  }

  const immutableSourceEntries = backupEntries.map((entry) => sourceBackupEntryEvidence(entry));
  if (immutableSourceEntries.length !== record.restoreCopySourceManifest.length
    || immutableSourceEntries.some((entry, index) => (
      !sameRemovalEntry(entry, record.restoreCopySourceManifest[index])
    ))) {
    throw migrationError(
      `Legacy source restore copy source is not authenticated by its backup receipt: ${record.path}`,
      "CONCURRENT_CHANGE",
    );
  }
  const sourceByPath = new Map(
    record.restoreCopySourceManifest.map((entry, index) => [
      entry.relativePath,
      { ...entry, index },
    ]),
  );
  const journalByIndex = new Map(
    record.restoreCopyTargetProvenance.map((entry) => [entry.index, entry]),
  );
  const groups = new Map();
  for (const name of restoreNames) {
    if (name === intentName) continue;
    const parsed = parseSourceRestoreEntryName(record, name);
    if (!parsed || parsed.copyToken !== record.restoreCopyProvenanceToken) {
      throw migrationError(
        `Legacy source restore proof has malformed state: ${name}`,
        "CONCURRENT_CHANGE",
      );
    }
    const { index, kind } = parsed;
    const sourceEntry = record.restoreCopySourceManifest[index];
    if (!sourceEntry || sourceEntry.type !== parsed.type) {
      throw migrationError(
        `Legacy source restore proof is not bound to its source entry: ${name}`,
        "CONCURRENT_CHANGE",
      );
    }
    const provenance = sourceRestoreEntryCore(
      record,
      sourceEntry,
      index,
      parsed.targetIdentity,
    );
    const expectedPaths = sourceRestoreEntryPaths(record, sourceEntry, provenance);
    if (basename(expectedPaths[kind]) !== name) {
      throw migrationError(
        `Legacy source restore proof digest is invalid: ${name}`,
        "CONCURRENT_CHANGE",
      );
    }
    const existing = groups.get(index);
    if (existing && (
      !sameSourceBackupValue(existing.provenance, provenance)
      || existing[kind] !== undefined
    )) {
      throw migrationError(
        `Legacy source restore proof is duplicated: ${name}`,
        "CONCURRENT_CHANGE",
      );
    }
    const group = existing ?? { provenance };
    group[kind] = join(record.backupProofRoot, name);
    groups.set(index, group);
    allowed.add(name);
  }

  const current = await collectDirectoryRemovalManifest(
    record.physicalPath,
    "Restored legacy source",
  );
  const markerRelativePath = normalizePath(relative(record.physicalPath, markerPath));
  const currentEntries = current.filter((entry) => entry.relativePath !== markerRelativePath);
  const currentByPath = new Map(currentEntries.map((entry) => [entry.relativePath, entry]));
  const recordedByPath = new Map(
    record.restoreCopyTargetManifest.map((entry) => [entry.relativePath, entry]),
  );
  const authenticatedManifest = [];
  const authenticatedProvenance = [];
  for (const sourceEntry of record.restoreCopySourceManifest) {
    const entry = currentByPath.get(sourceEntry.relativePath);
    if (!entry) continue;
    const indexedSource = sourceByPath.get(sourceEntry.relativePath);
    const group = groups.get(indexedSource.index);
    const expectedProvenance = sourceRestoreEntryCore(
      record,
      sourceEntry,
      indexedSource.index,
      entry.identity,
    );
    const recorded = recordedByPath.get(entry.relativePath);
    const activeIntent = record.restoreCopyIntent?.relativePath === entry.relativePath;
    const completedWrite = recorded?.type === "file"
      && sameFileIdentity(recorded.identity, entry.identity)
      && recorded.hash === sourceHash(Buffer.alloc(0))
      && entry.hash === sourceEntry.hash;
    if (!group
      || !group.owner
      || (entry.type === "file" && !group.target)
      || (entry.type !== "file" && group.target)
      || !sameSourceBackupValue(group.provenance, expectedProvenance)
      || entry.type !== sourceEntry.type
      || entry.mode !== sourceEntry.mode
      || (entry.type === "file"
        && entry.hash !== sourceEntry.hash
        && !activeIntent)
      || (entry.type === "symlink"
        && (entry.target !== sourceEntry.target
          || !sameFileIdentity(entry.identity, sourceEntry.identity)))
      || (recorded
        && !sameRemovalEntry(entry, recorded)
        && !activeIntent
        && !completedWrite)) {
      throw migrationError(
        `Legacy source restore entry is not externally proven: ${entry.relativePath}`,
        "CONCURRENT_CHANGE",
      );
    }
    const [ownerState, targetProofState] = await Promise.all([
      pathState(group.owner),
      group.target ? pathState(group.target) : null,
    ]);
    if (!ownerState?.isFile()
      || ownerState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(ownerState), receipt.identity)
      || (group.target && (
        !targetProofState?.isFile()
        || targetProofState.isSymbolicLink()
        || (targetProofState.mode & 0o777) !== sourceEntry.mode
        || !sameFileIdentity(fileIdentity(targetProofState), entry.identity)
      ))) {
      throw migrationError(
        `Legacy source restore proof changed identity: ${entry.relativePath}`,
        "CONCURRENT_CHANGE",
      );
    }
    const journalProvenance = journalByIndex.get(indexedSource.index);
    if (journalProvenance
      && !sameSourceBackupValue(journalProvenance, expectedProvenance)) {
      throw migrationError(
        `Legacy source restore journal forged entry provenance: ${entry.relativePath}`,
        "CONCURRENT_CHANGE",
      );
    }
    const evidence = removalEntryEvidence(entry);
    evidence.quarantineRelativePath = entry.type === "directory"
      ? null
      : (recorded?.quarantineRelativePath ?? normalizePath(relative(
        record.physicalPath,
        join(
          dirname(removalManifestPath(record.physicalPath, entry.relativePath)),
          `.sdd-source-restore-remove-${record.restoreReservationToken}-${indexedSource.index}`,
        ),
      )));
    authenticatedManifest.push(evidence);
    authenticatedProvenance.push(expectedProvenance);
  }
  for (const [index, group] of groups) {
    const sourceEntry = record.restoreCopySourceManifest[index];
    if (!sourceEntry || !currentByPath.has(sourceEntry.relativePath)) {
      throw migrationError(
        `Legacy source restore lost an externally proven entry: ${sourceEntry?.relativePath ?? index}`,
        "CONCURRENT_CHANGE",
      );
    }
    if (!group.owner || (sourceEntry.type === "file") !== Boolean(group.target)) {
      throw migrationError(
        `Legacy source restore has incomplete external proof: ${sourceEntry.relativePath}`,
        "CONCURRENT_CHANGE",
      );
    }
  }
  for (const recorded of record.restoreCopyTargetProvenance) {
    if (!authenticatedProvenance.some((entry) => (
      entry.index === recorded.index && sameSourceBackupValue(entry, recorded)
    ))) {
      throw migrationError(
        `Legacy source restore lost journal-bound proof: ${recorded.relativePath}`,
        "CONCURRENT_CHANGE",
      );
    }
  }
  record.restoreCopyTargetManifest = authenticatedManifest;
  record.restoreCopyTargetProvenance = authenticatedProvenance;
  return allowed;
}

async function assertSourceBackupProofConfinement(record) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(record.backupProofToken)) {
    throw migrationError(`Migration backup proof token is invalid: ${record.backup}`, "CONCURRENT_CHANGE");
  }
  const expected = sourceBackupProofPaths(record.backup, record.backupProofToken);
  for (const [kind, actual] of [
    ["root", record.backupProofRoot],
    ["owner", record.backupProofOwnerPath],
    ["receipt", record.backupProofReceiptPath],
    ["owner cleanup", record.backupProofOwnerCleanupPath],
    ["receipt cleanup", record.backupProofReceiptCleanupPath],
  ]) {
    if (resolve(actual) !== resolve(expected[kind === "owner cleanup"
      ? "ownerCleanup"
      : kind === "receipt cleanup"
        ? "receiptCleanup"
        : kind])
      || resolve(dirname(actual)) !== resolve(dirname(record.backup))
      || !isStrictlyInside(record.ownerPhysicalPath, actual)) {
      throw migrationError(
        `Migration backup proof ${kind} escapes its source owner: ${actual}`,
        "CONCURRENT_CHANGE",
      );
    }
  }
}

async function assertSourceBackupProofSiblingInventory(record) {
  await assertSourceBackupProofConfinement(record);
  const prefix = `${basename(record.backup)}.sdd-source-proof-`;
  const expected = new Set([
    basename(record.backupProofRoot),
    basename(record.backupProofOwnerPath),
    basename(record.backupProofReceiptPath),
    basename(record.backupProofOwnerCleanupPath),
    basename(record.backupProofReceiptCleanupPath),
  ]);
  const names = (await readdir(dirname(record.backup)))
    .filter((name) => name.startsWith(prefix));
  const unexpected = names.filter((name) => !expected.has(name));
  if (unexpected.length > 0) {
    throw migrationError(
      `Migration backup proof has opaque sibling state: ${unexpected[0]}`,
      "CONCURRENT_CHANGE",
    );
  }
  return new Set(names);
}

async function prepareSourceBackupProof(state, record) {
  await assertSourceRootAnchor(record);
  await assertSourceBackupProofConfinement(record);
  const sourceManifest = record.copySourceManifest;
  if (!Array.isArray(sourceManifest)
    || resolve(record.copySourceRoot) !== resolve(record.physicalPath)
    || !sameFileIdentity(sourceManifest[0]?.identity, record.identity)) {
    throw migrationError(
      `Migration backup proof has no authenticated source manifest: ${record.path}`,
      "CONCURRENT_CHANGE",
    );
  }
  let rootState = await pathState(record.backupProofRoot);
  if (!rootState) {
    await mkdir(record.backupProofRoot, { mode: 0o700 });
    await syncDirectory(dirname(record.backupProofRoot));
    rootState = await pathState(record.backupProofRoot);
  }
  if (!rootState?.isDirectory()
    || rootState.isSymbolicLink()
    || (rootState.mode & 0o777) !== 0o700) {
    throw migrationError(
      `Migration backup proof root is not a real directory: ${record.backupProofRoot}`,
      "CONCURRENT_CHANGE",
    );
  }
  const rootIdentity = fileIdentity(rootState);
  if (record.backupProofRootIdentity !== null
    && !sameFileIdentity(record.backupProofRootIdentity, rootIdentity)) {
    throw migrationError(
      `Migration backup proof root changed identity: ${record.backupProofRoot}`,
      "CONCURRENT_CHANGE",
    );
  }
  if (record.backupProofRootIdentity === null) {
    record.backupProofRootIdentity = rootIdentity;
    await persistTransaction(state);
  }
  const expectedPayload = sourceBackupOwnerPayload(state, record, sourceManifest);
  let ownerState = await pathState(record.backupProofOwnerPath);
  let ownerReceipt;
  if (!ownerState) {
    ownerReceipt = await writeSourceBackupReceipt(
      record.backupProofOwnerPath,
      "owner",
      expectedPayload,
      "Migration backup source-derived owner receipt",
    );
    record.backupProofOwnerIdentity = ownerReceipt.identity;
    await persistTransaction(state);
  } else {
    ownerReceipt = await readSourceBackupReceipt(
      record.backupProofOwnerPath,
      "owner",
      "Migration backup source-derived owner receipt",
    );
    if (!sameSourceBackupValue(ownerReceipt.payload, expectedPayload)
      || (record.backupProofOwnerIdentity !== null
        && !sameFileIdentity(record.backupProofOwnerIdentity, ownerReceipt.identity))) {
      throw migrationError(
        `Migration backup owner receipt does not match its source: ${record.backupProofOwnerPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    if (record.backupProofOwnerIdentity === null) {
      record.backupProofOwnerIdentity = ownerReceipt.identity;
      await persistTransaction(state);
    }
  }
  const ownerWitnessPath = join(record.backupProofRoot, ".owner");
  let ownerWitnessState = await pathState(ownerWitnessPath);
  if (!ownerWitnessState) {
    await link(record.backupProofOwnerPath, ownerWitnessPath);
    await syncDirectory(record.backupProofRoot);
    ownerWitnessState = await pathState(ownerWitnessPath);
  }
  if (!ownerWitnessState?.isFile()
    || ownerWitnessState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(ownerWitnessState), ownerReceipt.identity)) {
    throw migrationError(
      `Migration backup proof root lost its source-derived owner marker: ${record.backupProofRoot}`,
      "CONCURRENT_CHANGE",
    );
  }
  if (record.backupProofPhase === "pending") {
    record.backupProofPhase = "copying";
    await persistTransaction(state);
  } else if (record.backupProofPhase !== "copying") {
    throw migrationError(
      `Migration backup proof is not preparing a copy: ${record.backup}`,
      "CONCURRENT_CHANGE",
    );
  }
  await assertSourceBackupProofSiblingInventory(record);
  return ownerReceipt;
}

async function createSourceBackupEntryProvenance(
  state,
  record,
  sourceEntry,
  index,
  targetPath,
  targetEntry,
) {
  const ownerReceipt = await prepareSourceBackupProof(state, record);
  const sourcePath = removalManifestPath(record.copySourceRoot, sourceEntry.relativePath);
  await assertRemovalEntry(sourcePath, sourceEntry, "Migration backup proof source");
  const targetState = await pathState(targetPath);
  if (!targetState
    || removalEntryType(targetState) !== sourceEntry.type
    || (targetState.mode & 0o777) !== sourceEntry.mode
    || targetEntry.mode !== sourceEntry.mode
    || !sameFileIdentity(fileIdentity(targetState), targetEntry.identity)) {
    throw migrationError(
      `Migration backup entry changed before proof creation: ${targetPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  const provenance = sourceBackupEntryProvenance(
    record,
    sourceEntry,
    index,
    targetEntry.identity,
  );
  const existing = record.backupEntryProvenance.find((entry) => entry.index === index);
  if (existing && !sameSourceBackupEntryProvenance(existing, provenance)) {
    throw migrationError(
      `Migration backup entry proof conflicts with its journal record: ${targetPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  let targetWitnessState = provenance.targetWitnessPath === null
    ? null
    : await pathState(provenance.targetWitnessPath);
  if (provenance.targetWitnessPath !== null && !targetWitnessState) {
    await link(targetPath, provenance.targetWitnessPath);
    targetWitnessState = await pathState(provenance.targetWitnessPath);
  }
  if (targetWitnessState
    && (removalEntryType(targetWitnessState) !== sourceEntry.type
      || (targetWitnessState.mode & 0o777) !== sourceEntry.mode
      || !sameFileIdentity(fileIdentity(targetWitnessState), targetEntry.identity))) {
    throw migrationError(
      `Migration backup target witness changed identity: ${provenance.targetWitnessPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  let ownerWitnessState = await pathState(provenance.ownerWitnessPath);
  if (!ownerWitnessState) {
    await link(record.backupProofOwnerPath, provenance.ownerWitnessPath);
    ownerWitnessState = await pathState(provenance.ownerWitnessPath);
  }
  await syncDirectory(record.backupProofRoot);
  if (!ownerWitnessState?.isFile()
    || ownerWitnessState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(ownerWitnessState), ownerReceipt.identity)) {
    throw migrationError(
      `Migration backup entry lost its owner witness: ${provenance.ownerWitnessPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  if (!existing) {
    record.backupEntryProvenance.push(provenance);
    record.backupEntryProvenance.sort((left, right) => left.index - right.index);
    await persistTransaction(state);
  }
  return provenance;
}

async function authenticateSourceBackupCopyProvenance(
  state,
  record,
  { allowRemovedTargets = false } = {},
) {
  const ownerReceipt = await prepareSourceBackupProof(state, record);
  const names = await readdir(record.backupProofRoot);
  const allowed = new Set([".owner"]);
  const sourceManifest = record.copySourceManifest;
  const authenticated = [];
  for (const [index, sourceEntry] of sourceManifest.entries()) {
    const targetPath = removalManifestPath(record.copyRoot, sourceEntry.relativePath);
    const targetState = await pathState(targetPath);
    const recorded = record.backupEntryProvenance.find((entry) => entry.index === index);
    if (!targetState && !recorded) continue;
    let targetEntry = null;
    let provenance;
    if (targetState) {
      targetEntry = await inspectRemovalEntry(
        targetPath,
        sourceEntry.relativePath,
        "Migration backup proof target",
      );
      provenance = sourceBackupEntryProvenance(
        record,
        sourceEntry,
        index,
        targetEntry.identity,
      );
    } else {
      if (!allowRemovedTargets
        || record.removalMode !== "backup"
        || record.removalRoot !== record.copyRoot
        || record.removalManifest === null) {
        throw migrationError(
          `Migration backup copy lost proven target entry: ${recorded.relativePath}`,
          "CONCURRENT_CHANGE",
        );
      }
      provenance = sourceBackupEntryProvenance(
        record,
        sourceEntry,
        index,
        recorded.targetIdentity,
      );
    }
    if (recorded && !sameSourceBackupEntryProvenance(recorded, provenance)) {
      throw migrationError(
        `Migration backup copy journal forged entry provenance: ${targetPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    const ownerState = await pathState(provenance.ownerWitnessPath);
    const targetWitness = provenance.targetWitnessPath === null
      ? null
      : await inspectRemovalEntry(
        provenance.targetWitnessPath,
        provenance.relativePath,
        "Migration backup target witness",
      ).catch(() => null);
    if (!ownerState?.isFile()
      || ownerState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(ownerState), ownerReceipt.identity)
      || (provenance.targetWitnessPath !== null
        && !sameRemovalEntry(targetWitness, sourceBackupEntryEvidence(provenance)))) {
      throw migrationError(
        `Migration backup copy target lacks external provenance: ${targetPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    if (targetEntry) {
      const incompleteFile = sourceEntry.type === "file"
        && record.copyIntent?.relativePath === sourceEntry.relativePath
        && targetEntry.hash === sourceHash(Buffer.alloc(0));
      if (targetEntry.mode !== sourceEntry.mode) {
        throw migrationError(
          `Migration backup copy target changed proven mode: ${targetPath}`,
          "CONCURRENT_CHANGE",
        );
      }
      if ((sourceEntry.type === "file"
        && targetEntry.hash !== sourceEntry.hash
        && !incompleteFile)
        || (sourceEntry.type === "symlink" && targetEntry.target !== sourceEntry.target)) {
        throw migrationError(
          `Migration backup copy target changed proven content: ${targetPath}`,
          "CONCURRENT_CHANGE",
        );
      }
    }
    allowed.add(basename(provenance.ownerWitnessPath));
    if (provenance.targetWitnessPath !== null) {
      allowed.add(basename(provenance.targetWitnessPath));
    }
    if (!recorded) record.backupEntryProvenance.push(provenance);
    authenticated.push({ provenance, targetEntry });
  }
  const opaque = names.filter((name) => !allowed.has(name));
  if (opaque.length > 0) {
    throw migrationError(
      `Migration backup proof root contains opaque state: ${opaque[0]}`,
      "CONCURRENT_CHANGE",
    );
  }
  for (const recorded of record.backupEntryProvenance) {
    if (!authenticated.some(({ provenance }) => provenance.index === recorded.index)) {
      throw migrationError(
        `Migration backup copy lost proven target entry: ${recorded.relativePath}`,
        "CONCURRENT_CHANGE",
      );
    }
  }
  for (const { provenance, targetEntry } of authenticated) {
    if (record.copyTargetManifest.some((entry) => entry.relativePath === provenance.relativePath)) {
      continue;
    }
    const evidence = removalEntryEvidence(targetEntry);
    evidence.quarantineRelativePath = targetEntry.type === "directory"
      ? null
      : normalizePath(relative(
        record.copyRoot,
        join(
          dirname(removalManifestPath(record.copyRoot, targetEntry.relativePath)),
          `.sdd-remove-${process.pid}-${randomUUID()}`,
        ),
      ));
    record.copyTargetManifest.push(evidence);
  }
  record.backupEntryProvenance.sort((left, right) => left.index - right.index);
  record.copyTargetManifest.sort((left, right) => (
    sourceManifest.findIndex((entry) => entry.relativePath === left.relativePath)
    - sourceManifest.findIndex((entry) => entry.relativePath === right.relativePath)
  ));
}
function sourceBackupFinalReceiptPayload(
  state,
  record,
  ownerReceipt,
  payloadIdentity,
) {
  return {
    authority: sourceBackupAuthorityPayload(state, record),
    proofRootIdentity: record.backupProofRootIdentity,
    ownerReceiptIdentity: ownerReceipt.identity,
    payloadIdentity,
    entries: record.backupEntryProvenance,
  };
}

async function finalizeSourceBackupProof(state, record) {
  await authenticateSourceBackupCopyProvenance(state, record);
  const sourceManifest = record.copySourceManifest;
  if (record.backupEntryProvenance.length !== sourceManifest.length
    || record.copyTargetManifest.length !== sourceManifest.length) {
    throw migrationError(
      `Migration backup proof is incomplete: ${record.backup}`,
      "CONCURRENT_CHANGE",
    );
  }
  for (const [index, sourceEntry] of sourceManifest.entries()) {
    const provenance = record.backupEntryProvenance[index];
    const targetPath = removalManifestPath(record.copyRoot, sourceEntry.relativePath);
    const targetEntry = await inspectRemovalEntry(
      targetPath,
      sourceEntry.relativePath,
      "Migration backup final proof target",
    );
    const expected = sourceBackupEntryProvenance(
      record,
      sourceEntry,
      index,
      targetEntry.identity,
    );
    if (!sameSourceBackupEntryProvenance(provenance, expected)
      || !sameRemovalEntry(targetEntry, sourceBackupEntryEvidence(expected))) {
      throw migrationError(
        `Migration backup target changed before final proof: ${targetPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    if (expected.targetWitnessPath !== null) {
      const witness = await inspectRemovalEntry(
        expected.targetWitnessPath,
        sourceEntry.relativePath,
        "Migration backup final target witness",
      );
      if (!sameRemovalEntry(witness, sourceBackupEntryEvidence(expected))) {
        throw migrationError(
          `Migration backup target witness changed before final proof: ${expected.targetWitnessPath}`,
          "CONCURRENT_CHANGE",
        );
      }
    }
  }
  const payloadEntry = record.backupEntryProvenance[0];
  if (payloadEntry.relativePath !== "." || payloadEntry.type !== "directory") {
    throw migrationError(
      `Migration backup proof has no payload root: ${record.backup}`,
      "CONCURRENT_CHANGE",
    );
  }
  const ownerReceipt = await readSourceBackupReceipt(
    record.backupProofOwnerPath,
    "owner",
    "Migration backup source-derived owner receipt",
  );
  const payload = sourceBackupFinalReceiptPayload(
    state,
    record,
    ownerReceipt,
    payloadEntry.targetIdentity,
  );
  let receiptState = await pathState(record.backupProofReceiptPath);
  let receipt;
  if (!receiptState) {
    receipt = await writeSourceBackupReceipt(
      record.backupProofReceiptPath,
      "complete",
      payload,
      "Migration backup entry receipt",
    );
    record.backupProofReceiptIdentity = receipt.identity;
    await persistTransaction(state);
  } else {
    receipt = await readSourceBackupReceipt(
      record.backupProofReceiptPath,
      "complete",
      "Migration backup entry receipt",
    );
    if (!sameSourceBackupValue(receipt.payload, payload)
      || (record.backupProofReceiptIdentity !== null
        && !sameFileIdentity(record.backupProofReceiptIdentity, receipt.identity))) {
      throw migrationError(
        `Migration backup entry receipt does not match its payload: ${record.backupProofReceiptPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    if (record.backupProofReceiptIdentity === null) {
      record.backupProofReceiptIdentity = receipt.identity;
      await persistTransaction(state);
    }
  }
  const receiptWitnessPath = join(record.backupProofRoot, ".receipt");
  let receiptWitness = await pathState(receiptWitnessPath);
  if (!receiptWitness) {
    await link(record.backupProofReceiptPath, receiptWitnessPath);
    await syncDirectory(record.backupProofRoot);
    receiptWitness = await pathState(receiptWitnessPath);
  }
  if (!receiptWitness?.isFile()
    || receiptWitness.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(receiptWitness), receipt.identity)) {
    throw migrationError(
      `Migration backup entry receipt lost its proof-root witness: ${receiptWitnessPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  record.backupPayloadIdentity = payloadEntry.targetIdentity;
  record.backupProofPhase = "present";
  await persistTransaction(state);
  return receipt;
}

async function authenticateSourceBackupProvenance(
  state,
  record,
  {
    payloadPath = null,
    allowPartialPayload = false,
    allowMissingPayload = false,
  } = {},
) {
  await assertSourceBackupProofConfinement(record);
  const ownerReceipt = await readSourceBackupReceipt(
    record.backupProofOwnerPath,
    "owner",
    "Migration backup source-derived owner receipt",
  );
  const expectedAuthority = sourceBackupAuthorityPayload(state, record);
  const mayAdoptOwner = record.backupProofOwnerIdentity === null
    && record.backupProofPhase === "copying";
  if ((!mayAdoptOwner
      && !sameFileIdentity(ownerReceipt.identity, record.backupProofOwnerIdentity))
    || !sameSourceBackupValue(ownerReceipt.payload?.authority, expectedAuthority)
    || !sameFileIdentity(
      ownerReceipt.payload?.proofRootIdentity,
      record.backupProofRootIdentity,
    )
    || !Array.isArray(ownerReceipt.payload?.sourceEntries)) {
    throw migrationError(
      `Migration backup owner receipt does not authenticate its source: ${record.backupProofOwnerPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  const receipt = await readSourceBackupReceipt(
    record.backupProofReceiptPath,
    "complete",
    "Migration backup entry receipt",
  );
  const mayAdoptReceipt = record.backupProofReceiptIdentity === null
    && record.backupProofPhase === "copying";
  if ((!mayAdoptReceipt
      && !sameFileIdentity(receipt.identity, record.backupProofReceiptIdentity))
    || !sameSourceBackupValue(receipt.payload?.authority, expectedAuthority)
    || !sameFileIdentity(receipt.payload?.proofRootIdentity, record.backupProofRootIdentity)
    || !sameFileIdentity(receipt.payload?.ownerReceiptIdentity, ownerReceipt.identity)
    || (record.backupPayloadIdentity !== null
      && !sameFileIdentity(receipt.payload?.payloadIdentity, record.backupPayloadIdentity))
    || !Array.isArray(receipt.payload?.entries)
    || receipt.payload.entries.length !== ownerReceipt.payload.sourceEntries.length) {
    throw migrationError(
      `Migration backup receipt does not authenticate its source transaction: ${record.backupProofReceiptPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  const entries = [];
  for (const [index, sourceEntry] of ownerReceipt.payload.sourceEntries.entries()) {
    const recorded = receipt.payload.entries[index];
    if (!recorded?.targetIdentity) {
      throw migrationError(
        `Migration backup receipt has incomplete entry provenance: ${sourceEntry.relativePath}`,
        "CONCURRENT_CHANGE",
      );
    }
    const expected = sourceBackupEntryProvenance(
      record,
      sourceEntry,
      index,
      recorded.targetIdentity,
    );
    if (!sameSourceBackupEntryProvenance(recorded, expected)
      || (record.backupEntryProvenance[index]
        && !sameSourceBackupEntryProvenance(record.backupEntryProvenance[index], expected))) {
      throw migrationError(
        `Migration backup receipt has forged entry provenance: ${sourceEntry.relativePath}`,
        "CONCURRENT_CHANGE",
      );
    }
    entries.push(expected);
  }
  if (record.backupEntryProvenance.length !== 0
    && record.backupEntryProvenance.length !== entries.length) {
    throw migrationError(
      `Migration backup journal has incomplete entry provenance: ${record.backup}`,
      "CONCURRENT_CHANGE",
    );
  }
  if (mayAdoptOwner) record.backupProofOwnerIdentity = ownerReceipt.identity;
  if (mayAdoptReceipt) {
    record.backupProofReceiptIdentity = receipt.identity;
    record.backupPayloadIdentity = receipt.payload.payloadIdentity;
    record.backupProofPhase = "present";
  }
  const rootState = await pathState(record.backupProofRoot);
  if (!rootState?.isDirectory()
    || rootState.isSymbolicLink()
    || (rootState.mode & 0o777) !== 0o700
    || !sameFileIdentity(fileIdentity(rootState), record.backupProofRootIdentity)) {
    throw migrationError(
      `Migration backup proof root changed identity: ${record.backupProofRoot}`,
      "CONCURRENT_CHANGE",
    );
  }
  const ownerMarker = await pathState(join(record.backupProofRoot, ".owner"));
  const receiptMarker = await pathState(join(record.backupProofRoot, ".receipt"));
  if (!ownerMarker?.isFile()
    || ownerMarker.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(ownerMarker), ownerReceipt.identity)
    || !receiptMarker?.isFile()
    || receiptMarker.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(receiptMarker), receipt.identity)) {
    throw migrationError(
      `Migration backup proof root lost an authenticated receipt marker: ${record.backupProofRoot}`,
      "CONCURRENT_CHANGE",
    );
  }
  const expectedProofNames = new Set([".owner", ".receipt"]);
  for (const entry of entries) {
    const ownerWitness = await pathState(entry.ownerWitnessPath);
    if (!ownerWitness?.isFile()
      || ownerWitness.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(ownerWitness), ownerReceipt.identity)) {
      throw migrationError(
        `Migration backup entry lost its owner witness: ${entry.ownerWitnessPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    expectedProofNames.add(basename(entry.ownerWitnessPath));
    if (entry.targetWitnessPath !== null) {
      const witness = await inspectRemovalEntry(
        entry.targetWitnessPath,
        entry.relativePath,
        "Migration backup target witness",
      );
      if (!sameRemovalEntry(witness, sourceBackupEntryEvidence(entry))) {
        throw migrationError(
          `Migration backup target witness changed: ${entry.targetWitnessPath}`,
          "CONCURRENT_CHANGE",
        );
      }
      expectedProofNames.add(basename(entry.targetWitnessPath));
    }
  }
  if (record.backupProofPhase !== "cleaning") {
    const proofNames = await readdir(record.backupProofRoot);
    const restoreProofNames = await authenticateSourceRestoreEvidence(
      record,
      receipt,
      entries,
      proofNames,
      payloadPath,
    );
    for (const name of restoreProofNames) expectedProofNames.add(name);
    const opaque = proofNames.filter((name) => !expectedProofNames.has(name));
    const missing = [...expectedProofNames].filter((name) => !proofNames.includes(name));
    if (opaque.length > 0 || missing.length > 0) {
      throw migrationError(
        `Migration backup proof inventory changed: ${opaque[0] ?? missing[0]}`,
        "CONCURRENT_CHANGE",
      );
    }
  }
  if (payloadPath === null) {
    if (!allowMissingPayload) {
      throw migrationError(
        `Migration backup payload is missing from its authenticated receipt: ${record.backup}`,
        "CONCURRENT_CHANGE",
      );
    }
    return { ownerReceipt, receipt, entries };
  }
  if (allowPartialPayload) {
    if (record.removalMode !== "backup"
      || record.removalRoot !== payloadPath
      || record.removalManifest === null) {
      throw migrationError(
        `Migration backup payload has no authenticated cleanup progress: ${payloadPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    const receiptByPath = new Map(entries.map((entry) => [entry.relativePath, entry]));
    for (const removalEntry of record.removalManifest) {
      const proven = receiptByPath.get(removalEntry.relativePath);
      if (!proven
        || !sameRemovalEntry(removalEntry, sourceBackupEntryEvidence(proven))) {
        throw migrationError(
          `Migration backup cleanup journal forged entry authority: ${removalEntry.relativePath}`,
          "CONCURRENT_CHANGE",
        );
      }
    }
    await assertDirectoryRemovalSubset(
      payloadPath,
      record.removalManifest,
      record.removalProgress,
      "Migration backup payload",
    );
  } else {
    const current = await collectDirectoryRemovalManifest(
      payloadPath,
      "Migration backup payload",
    );
    if (current.length !== entries.length
      || current.some((entry, index) => (
        !sameRemovalEntry(entry, sourceBackupEntryEvidence(entries[index]))
      ))) {
      throw migrationError(
        `Migration backup payload does not match its external receipt: ${payloadPath}`,
        "CONCURRENT_CHANGE",
      );
    }
  }
  return { ownerReceipt, receipt, entries };
}
function sourceEntriesFromBackupProvenance(entries) {
  return entries.map((entry) => ({
    relativePath: entry.relativePath,
    type: entry.type,
    identity: entry.sourceIdentity,
    mode: entry.sourceMode,
    hash: entry.sourceHash,
    target: entry.sourceTarget,
  }));
}

async function readSourceBackupReceiptEvidence(record, kind) {
  const primaryPath = kind === "owner"
    ? record.backupProofOwnerPath
    : record.backupProofReceiptPath;
  const cleanupPath = kind === "owner"
    ? record.backupProofOwnerCleanupPath
    : record.backupProofReceiptCleanupPath;
  const expectedIdentity = kind === "owner"
    ? record.backupProofOwnerIdentity
    : record.backupProofReceiptIdentity;
  const cleanupIdentity = kind === "owner"
    ? record.backupProofOwnerCleanupIdentity
    : record.backupProofReceiptCleanupIdentity;
  const primaryState = await pathState(primaryPath);
  const cleanupState = await pathState(cleanupPath);
  const path = primaryState ? primaryPath : cleanupState ? cleanupPath : null;
  if (path === null) return null;
  const receipt = await readSourceBackupReceipt(
    path,
    kind,
    kind === "owner"
      ? "Migration backup source-derived owner receipt"
      : "Migration backup entry receipt",
  );
  if ((expectedIdentity !== null && !sameFileIdentity(receipt.identity, expectedIdentity))
    || (path === cleanupPath
      && cleanupIdentity !== null
      && !sameFileIdentity(receipt.identity, cleanupIdentity))
    || (primaryState && cleanupState
      && !sameFileIdentity(fileIdentity(primaryState), fileIdentity(cleanupState)))) {
    throw migrationError(
      `Migration backup ${kind} receipt cleanup changed identity: ${path}`,
      "CONCURRENT_CHANGE",
    );
  }
  return { ...receipt, path };
}

async function assertSourceBackupExternalReceipts(state, record, { requireComplete = true } = {}) {
  const ownerReceipt = await readSourceBackupReceiptEvidence(record, "owner");
  if (!ownerReceipt) {
    throw migrationError(
      `Migration backup lost its source-derived owner receipt: ${record.backupProofOwnerPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  const sourceEntries = sourceEntriesFromBackupProvenance(record.backupEntryProvenance);
  const expectedOwnerPayload = {
    authority: sourceBackupAuthorityPayload(state, record),
    proofRootIdentity: record.backupProofRootIdentity,
    sourceEntries,
  };
  if (!sameSourceBackupValue(ownerReceipt.payload, expectedOwnerPayload)) {
    throw migrationError(
      `Migration backup owner receipt changed its source authority: ${ownerReceipt.path}`,
      "CONCURRENT_CHANGE",
    );
  }
  const receipt = await readSourceBackupReceiptEvidence(record, "complete");
  if (!receipt) {
    if (!requireComplete) return { ownerReceipt, receipt: null };
    throw migrationError(
      `Migration backup lost its complete entry receipt: ${record.backupProofReceiptPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  const expectedReceiptPayload = sourceBackupFinalReceiptPayload(
    state,
    record,
    ownerReceipt,
    record.backupPayloadIdentity,
  );
  if (!sameSourceBackupValue(receipt.payload, expectedReceiptPayload)) {
    throw migrationError(
      `Migration backup entry receipt changed its payload authority: ${receipt.path}`,
      "CONCURRENT_CHANGE",
    );
  }
  return { ownerReceipt, receipt };
}

function sourceBackupExpectedProofManifest(record, ownerReceipt, receipt) {
  const entries = [
    {
      relativePath: ".",
      type: "directory",
      identity: record.backupProofRootIdentity,
      mode: 0o700,
      hash: null,
      target: null,
    },
    {
      relativePath: ".owner",
      type: "file",
      identity: ownerReceipt.identity,
      mode: ownerReceipt.mode,
      hash: ownerReceipt.hash,
      target: null,
    },
    {
      relativePath: ".receipt",
      type: "file",
      identity: receipt.identity,
      mode: receipt.mode,
      hash: receipt.hash,
      target: null,
    },
  ];
  for (const entry of record.backupEntryProvenance) {
    entries.push({
      relativePath: basename(entry.ownerWitnessPath),
      type: "file",
      identity: ownerReceipt.identity,
      mode: ownerReceipt.mode,
      hash: ownerReceipt.hash,
      target: null,
    });
    if (entry.targetWitnessPath !== null) {
      entries.push({
        relativePath: basename(entry.targetWitnessPath),
        type: entry.type,
        identity: entry.targetIdentity,
        mode: entry.targetMode,
        hash: entry.targetHash,
        target: entry.targetTarget,
      });
    }
  }
  entries.push(...sourceRestoreExpectedProofEntries(record, receipt));
  return [
    entries[0],
    ...entries.slice(1).sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
  ];
}

function assertSourceBackupProofManifest(record, manifest, ownerReceipt, receipt) {
  const expected = sourceBackupExpectedProofManifest(record, ownerReceipt, receipt);
  if (manifest.length !== expected.length
    || manifest.some((entry, index) => !sameRemovalEntry(entry, expected[index]))) {
    throw migrationError(
      `Migration backup proof removal manifest is not externally authenticated: ${record.backupProofRoot}`,
      "CONCURRENT_CHANGE",
    );
  }
}

function sourceBackupPartialExpectedProofManifest(record, ownerReceipt) {
  const entries = [
    {
      relativePath: ".",
      type: "directory",
      identity: record.backupProofRootIdentity,
      mode: 0o700,
      hash: null,
      target: null,
    },
    {
      relativePath: ".owner",
      type: "file",
      identity: ownerReceipt.identity,
      mode: ownerReceipt.mode,
      hash: ownerReceipt.hash,
      target: null,
    },
  ];
  for (const entry of record.backupEntryProvenance) {
    entries.push({
      relativePath: basename(entry.ownerWitnessPath),
      type: "file",
      identity: ownerReceipt.identity,
      mode: ownerReceipt.mode,
      hash: ownerReceipt.hash,
      target: null,
    });
    if (entry.targetWitnessPath !== null) {
      entries.push({
        relativePath: basename(entry.targetWitnessPath),
        type: entry.type,
        identity: entry.targetIdentity,
        mode: entry.targetMode,
        hash: entry.targetHash,
        target: entry.targetTarget,
      });
    }
  }
  return [
    entries[0],
    ...entries.slice(1).sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
  ];
}

async function authenticatePartialSourceBackupOwner(state, record) {
  const ownerReceipt = await readSourceBackupReceiptEvidence(record, "owner");
  const expectedPayload = sourceBackupOwnerPayload(state, record, record.copySourceManifest);
  if (!ownerReceipt
    || !sameFileIdentity(ownerReceipt.identity, record.backupProofOwnerIdentity)
    || !sameSourceBackupValue(ownerReceipt.payload, expectedPayload)) {
    throw migrationError(
      `Partial migration backup owner receipt changed: ${record.backupProofOwnerPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  return ownerReceipt;
}

async function assertPartialSourceBackupProofCleanup(state, record) {
  const rootState = await pathState(record.backupProofRoot);
  const ownerEvidence = await readSourceBackupReceiptEvidence(record, "owner");
  if (!rootState && !ownerEvidence) {
    if (record.backupProofRemovalManifest === null) {
      throw migrationError(
        `Partial migration backup proof disappeared before authenticated cleanup: ${record.backupProofRoot}`,
        "CONCURRENT_CHANGE",
      );
    }
    return null;
  }
  const ownerReceipt = await authenticatePartialSourceBackupOwner(state, record);
  if (!rootState) return ownerReceipt;
  if (!rootState.isDirectory()
    || rootState.isSymbolicLink()
    || (rootState.mode & 0o777) !== 0o700
    || !sameFileIdentity(fileIdentity(rootState), record.backupProofRootIdentity)
    || record.backupProofRemovalManifest === null) {
    throw migrationError(
      `Partial migration backup proof cleanup lost durable authority: ${record.backupProofRoot}`,
      "CONCURRENT_CHANGE",
    );
  }
  const expected = sourceBackupPartialExpectedProofManifest(record, ownerReceipt);
  if (record.backupProofRemovalManifest.length !== expected.length
    || record.backupProofRemovalManifest.some(
      (entry, index) => !sameRemovalEntry(entry, expected[index]),
    )) {
    throw migrationError(
      `Partial migration backup proof removal manifest is not source-authenticated: ${record.backupProofRoot}`,
      "CONCURRENT_CHANGE",
    );
  }
  await assertDirectoryRemovalSubset(
    record.backupProofRoot,
    record.backupProofRemovalManifest,
    record.backupProofRemovalProgress,
    "Partial migration backup proof root",
  );
  return ownerReceipt;
}

async function assertSourceBackupCleanupCorroboration(
  state,
  record,
  assertSourceCurrent,
  details = {},
) {
  if (assertSourceCurrent) {
    await assertSourceCurrent({ record, ...details });
    return;
  }
  if (state.status !== "committed") {
    throw migrationError(
      `Migration backup cleanup lacks restored-source corroboration: ${record.backup}`,
      "CONCURRENT_CHANGE",
    );
  }
  await readSourceDerivedManifest(
    state.stagingRoot,
    state.journalPath,
    state.destinationWorkspaceRoot,
    state.sourceDerivedDestinationGuards,
  );
}

async function removeSourceBackupReceiptEvidence(
  state,
  record,
  kind,
  verifyAuthority,
) {
  const identityProperty = kind === "owner"
    ? "backupProofOwnerIdentity"
    : "backupProofReceiptIdentity";
  const cleanupIdentityProperty = kind === "owner"
    ? "backupProofOwnerCleanupIdentity"
    : "backupProofReceiptCleanupIdentity";
  const path = kind === "owner"
    ? record.backupProofOwnerPath
    : record.backupProofReceiptPath;
  const cleanupPath = kind === "owner"
    ? record.backupProofOwnerCleanupPath
    : record.backupProofReceiptCleanupPath;
  const evidence = await readSourceBackupReceiptEvidence(record, kind);
  if (!evidence) {
    record[identityProperty] = null;
    record[cleanupIdentityProperty] = null;
    await persistTransaction(state);
    return;
  }
  const expectedIdentity = evidence.identity;
  const expectedHash = evidence.hash;
  const cleanupState = await pathState(cleanupPath);
  if (cleanupState) {
    if (!cleanupState.isFile()
      || cleanupState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(cleanupState), expectedIdentity)) {
      throw migrationError(
        `Migration backup ${kind} receipt cleanup changed: ${cleanupPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    if (record[cleanupIdentityProperty] === null) {
      record[cleanupIdentityProperty] = expectedIdentity;
      await persistTransaction(state);
    }
  }
  await removeProvenFile(path, {
    expectedIdentity,
    expectedHash,
    quarantinePath: cleanupPath,
    label: `Migration backup ${kind} receipt`,
    beforeQuarantine: verifyAuthority,
    afterQuarantine: async () => {
      const quarantined = await pathState(cleanupPath);
      if (!quarantined?.isFile()
        || quarantined.isSymbolicLink()
        || !sameFileIdentity(fileIdentity(quarantined), expectedIdentity)) {
        throw migrationError(
          `Migration backup ${kind} receipt quarantine changed: ${cleanupPath}`,
          "CONCURRENT_CHANGE",
        );
      }
      record[cleanupIdentityProperty] = expectedIdentity;
      await persistTransaction(state);
    },
    beforeRemovalMutation: verifyAuthority,
  });
  record[identityProperty] = null;
  record[cleanupIdentityProperty] = null;
  await persistTransaction(state);
}

async function cleanupSourceBackupProof(
  state,
  record,
  { assertSourceCurrent = null } = {},
) {
  if (record.backupProofPhase === "removed") return;
  const corroborate = (details = {}) => assertSourceBackupCleanupCorroboration(
    state,
    record,
    assertSourceCurrent,
    details,
  );
  await corroborate({ phase: "before-proof-cleanup" });
  const initialProofRootState = await pathState(record.backupProofRoot);
  const [initialOwnerReceipt, initialCompleteReceipt] = await Promise.all([
    readSourceBackupReceiptEvidence(record, "owner"),
    readSourceBackupReceiptEvidence(record, "complete"),
  ]);
  if (!initialProofRootState && !initialOwnerReceipt && !initialCompleteReceipt) {
    if (record.backupProofPhase !== "cleaning"
      || record.backupProofRemovalManifest === null) {
      throw migrationError(
        `Migration backup proof disappeared before authenticated cleanup: ${record.backupProofRoot}`,
        "CONCURRENT_CHANGE",
      );
    }
    record.backupProofRootIdentity = null;
    record.backupProofOwnerIdentity = null;
    record.backupProofReceiptIdentity = null;
    record.backupProofOwnerCleanupIdentity = null;
    record.backupProofReceiptCleanupIdentity = null;
    record.backupProofRemovalManifest = null;
    record.backupProofRemovalProgress = [];
    record.restoreReservationToken = null;
    record.restoreIntentIdentity = null;
    record.restoreCopyRoot = null;
    record.restoreCopySourceRoot = null;
    record.restoreCopySourceManifest = null;
    record.restoreCopyTargetManifest = [];
    record.restoreCopyProvenanceToken = null;
    record.restoreCopyTargetProvenance = [];
    record.restoreCopyIntent = null;
    record.backupProofPhase = "removed";
    await persistTransaction(state);
    const siblings = await assertSourceBackupProofSiblingInventory(record);
    if (siblings.size !== 0) {
      throw migrationError(
        `Migration backup proof retained state after cleanup: ${[...siblings][0]}`,
        "CONCURRENT_CHANGE",
      );
    }
    return;
  }
  const receipts = await assertSourceBackupExternalReceipts(state, record, {
    requireComplete: initialProofRootState !== null,
  });
  if (record.backupProofPhase === "present") {
    record.backupProofPhase = "cleaning";
    await persistTransaction(state);
  } else if (record.backupProofPhase !== "cleaning") {
    throw migrationError(
      `Migration backup proof is not removable: ${record.backup}`,
      "CONCURRENT_CHANGE",
    );
  }
  if (initialProofRootState) {
    if (record.backupProofRemovalManifest === null) {
      const manifest = await captureDirectoryRemovalManifest(record.backupProofRoot, {
        expectedIdentity: record.backupProofRootIdentity,
        label: "Migration backup proof root",
      });
      assertSourceBackupProofManifest(record, manifest, receipts.ownerReceipt, receipts.receipt);
      record.backupProofRemovalManifest = manifest;
      record.backupProofRemovalProgress = [];
      await persistTransaction(state);
    } else {
      assertSourceBackupProofManifest(

        record,
        record.backupProofRemovalManifest,
        receipts.ownerReceipt,
        receipts.receipt,
      );
    }
    const verifyProofRemoval = async (details = {}) => {
      await corroborate({ ...details, phase: "before-proof-entry-removal" });
      const currentReceipts = await assertSourceBackupExternalReceipts(state, record);
      assertSourceBackupProofManifest(
        record,
        record.backupProofRemovalManifest,
        currentReceipts.ownerReceipt,
        currentReceipts.receipt,
      );
      await assertDirectoryRemovalSubset(
        record.backupProofRoot,
        record.backupProofRemovalManifest,
        record.backupProofRemovalProgress,
        "Migration backup proof root",
      );
      await corroborate({ ...details, phase: "immediately-before-proof-entry-removal" });
    };
    await removeProvenDirectoryTree(record.backupProofRoot, {
      expectedIdentity: record.backupProofRootIdentity,
      label: "Migration backup proof root",
      removalManifest: record.backupProofRemovalManifest,
      removalProgress: record.backupProofRemovalProgress,
      verifyRemoval: verifyProofRemoval,
      beforeRemovalMutation: verifyProofRemoval,
      persistRemovalProgress: async (progress) => {
        record.backupProofRemovalProgress = progress;
        await persistTransaction(state);
      },
    });
  } else if (record.backupProofRemovalManifest === null) {
    throw migrationError(
      `Migration backup proof root disappeared before authenticated removal: ${record.backupProofRoot}`,
      "CONCURRENT_CHANGE",
    );
  }
  await corroborate({ phase: "before-complete-receipt-removal" });
  await removeSourceBackupReceiptEvidence(
    state,
    record,
    "complete",
    async (details) => {
      await corroborate({ ...details, phase: "complete-receipt-removal" });
      await assertSourceBackupExternalReceipts(state, record);
      await corroborate({ ...details, phase: "immediately-before-complete-receipt-removal" });
    },
  );
  await corroborate({ phase: "before-owner-receipt-removal" });
  await removeSourceBackupReceiptEvidence(
    state,
    record,
    "owner",
    async (details) => {
      await corroborate({ ...details, phase: "owner-receipt-removal" });
      await assertSourceBackupExternalReceipts(state, record, { requireComplete: false });
      await corroborate({ ...details, phase: "immediately-before-owner-receipt-removal" });
    },
  );
  record.backupProofRootIdentity = null;
  record.backupProofRemovalManifest = null;
  record.backupProofRemovalProgress = [];
  record.restoreReservationToken = null;
  record.restoreIntentIdentity = null;
  record.restoreCopyRoot = null;
  record.restoreCopySourceRoot = null;
  record.restoreCopySourceManifest = null;
  record.restoreCopyTargetManifest = [];
  record.restoreCopyProvenanceToken = null;
  record.restoreCopyTargetProvenance = [];
  record.restoreCopyIntent = null;
  record.backupProofPhase = "removed";
  await persistTransaction(state);
  const siblings = await assertSourceBackupProofSiblingInventory(record);
  if (siblings.size !== 0) {
    throw migrationError(
      `Migration backup proof retained state after cleanup: ${[...siblings][0]}`,
      "CONCURRENT_CHANGE",
    );
  }
}

async function cleanupPartialSourceBackupProof(
  state,
  record,
  { assertSourceCurrent = null } = {},
) {
  const corroborate = async (details = {}) => {
    if (assertSourceCurrent) await assertSourceCurrent({ record, ...details });
    await authenticatePartialSourceBackupOwner(state, record);
    if (assertSourceCurrent) {
      await assertSourceCurrent({
        record,
        ...details,
        phase: "immediately-before-partial-proof-removal",
      });
    }
  };
  if (record.backupProofPhase === "copying") {
    await authenticateSourceBackupCopyProvenance(
      state,
      record,
      { allowRemovedTargets: true },
    );
    const ownerReceipt = await authenticatePartialSourceBackupOwner(state, record);
    const manifest = await captureDirectoryRemovalManifest(
      record.backupProofRoot,
      { label: "Partial migration backup proof root" },
    );
    const expected = sourceBackupPartialExpectedProofManifest(record, ownerReceipt);
    if (manifest.length !== expected.length
      || manifest.some((entry, index) => !sameRemovalEntry(entry, expected[index]))) {
      throw migrationError(
        `Partial migration backup proof inventory is not source-authenticated: ${record.backupProofRoot}`,
        "CONCURRENT_CHANGE",
      );
    }
    record.backupProofRemovalManifest = manifest;
    record.backupProofRemovalProgress = [];
    record.backupProofPhase = "cleaning";
    await persistTransaction(state);
  }
  if (record.backupProofPhase !== "cleaning"
    || record.backupProofReceiptIdentity !== null) {
    throw migrationError(
      `Partial migration backup proof cleanup phase is invalid: ${record.backup}`,
      "CONCURRENT_CHANGE",
    );
  }
  await assertPartialSourceBackupProofCleanup(state, record);
  if (await pathState(record.backupProofRoot)) {
    await removeProvenDirectoryTree(record.backupProofRoot, {
      expectedIdentity: record.backupProofRootIdentity,
      label: "Partial migration backup proof root",
      removalManifest: record.backupProofRemovalManifest,
      removalProgress: record.backupProofRemovalProgress,
      assertBoundary: corroborate,
      beforeRemovalMutation: corroborate,
      persistRemovalProgress: async (progress) => {
        record.backupProofRemovalProgress = progress;
        await persistTransaction(state);
      },
    });
  }
  await removeSourceBackupReceiptEvidence(
    state,
    record,
    "owner",
    corroborate,
  );
  record.backupProofRootIdentity = null;
  record.backupProofOwnerIdentity = null;
  record.backupProofOwnerCleanupIdentity = null;
  record.backupEntryProvenance = [];
  record.backupProofRemovalManifest = null;
  record.backupProofRemovalProgress = [];
  record.backupProofPhase = "removed";
  await persistTransaction(state);
  const siblings = await assertSourceBackupProofSiblingInventory(record);
  if (siblings.size !== 0) {
    throw migrationError(
      `Partial migration backup proof retained state after cleanup: ${[...siblings][0]}`,
      "CONCURRENT_CHANGE",
    );
  }
}
async function hydrateSourceBackupProvenance(state, record, index, journalPath) {
  try {
    record.backupProofState = state;
    const siblings = await assertSourceBackupProofSiblingInventory(record);
    if (record.backupProofPhase === "pending") {
      if (siblings.size !== 0) {
        throw migrationError(
          `Pending migration source has unexpected backup proof state: ${record.backup}`,
          "CONCURRENT_CHANGE",
        );
      }
      return;
    }
    if (record.backupProofPhase === "removed") {
      if (siblings.size !== 0) {
        throw migrationError(
          `Removed migration backup proof retained external state: ${[...siblings][0]}`,
          "CONCURRENT_CHANGE",
        );
      }
      return;
    }
    if (record.backupProofPhase === "copying") {
      if (await pathState(record.backupProofReceiptPath)) {
        const payloadPath = record.copyRoot;
        if (payloadPath === null) {
          throw migrationError(
            `Completed migration backup receipt has no copy payload: ${record.backup}`,
            "CONCURRENT_CHANGE",
          );
        }
        if (await pathState(join(record.backupProofRoot, ".receipt"))) {
          await authenticateSourceBackupProvenance(state, record, { payloadPath });
        } else {
          await finalizeSourceBackupProof(state, record);
        }
      } else {
        if (record.copyRoot === null) {
          throw migrationError(
            `Migration backup proof copy lost its active ledger: ${record.backup}`,
            "CONCURRENT_CHANGE",
          );
        }
        await authenticateSourceBackupCopyProvenance(state, record);
      }
      return;
    }
    if (record.backupProofPhase === "present") {
      const backup = await inspectSourceBackup(record, {
        allowEmpty: true,
        allowPartialRemoval: record.removalMode === "backup",
        state,
      });
      if (!backup?.payloadPath && record.cleanupPath === null) {
        throw migrationError(
          `Migration backup proof has no authenticated payload: ${record.backup}`,
          "CONCURRENT_CHANGE",
        );
      }
      return;
    }
    if (record.backupProofPhase !== "cleaning") {
      throw migrationError(
        `Migration backup proof phase is unsupported: ${record.backupProofPhase}`,
        "CONCURRENT_CHANGE",
      );
    }
    if (record.backupProofReceiptIdentity === null) {
      await assertPartialSourceBackupProofCleanup(state, record);
      return;
    }
    const backupState = await pathState(record.backup);
    if (backupState) {
      await inspectSourceBackup(record, {
        allowEmpty: true,
        allowPartialRemoval: record.removalMode === "backup",
        state,
      });
      return;
    }
    const rootState = await pathState(record.backupProofRoot);
    const completeReceipt = await readSourceBackupReceiptEvidence(record, "complete");
    const ownerReceipt = await readSourceBackupReceiptEvidence(record, "owner");
    if (rootState) {
      if (!completeReceipt
        || !ownerReceipt
        || record.backupProofRemovalManifest === null
        || (rootState.mode & 0o777) !== 0o700
        || !sameFileIdentity(fileIdentity(rootState), record.backupProofRootIdentity)) {
        throw migrationError(
          `Migration backup proof cleanup lost durable authority: ${record.backupProofRoot}`,
          "CONCURRENT_CHANGE",
        );
      }
      assertSourceBackupProofManifest(
        record,
        record.backupProofRemovalManifest,
        ownerReceipt,
        completeReceipt,
      );
      await assertDirectoryRemovalSubset(
        record.backupProofRoot,
        record.backupProofRemovalManifest,
        record.backupProofRemovalProgress,
        "Migration backup proof root",
      );
      return;
    }
    if (completeReceipt && !ownerReceipt) {
      throw migrationError(
        `Migration backup proof cleanup lost its final owner receipt: ${record.backupProofOwnerPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    if (!completeReceipt && !ownerReceipt) {
      if (record.backupProofRemovalManifest === null) {
        throw migrationError(
          `Migration backup proof disappeared before authenticated cleanup: ${record.backupProofRoot}`,
          "CONCURRENT_CHANGE",
        );
      }
      return;
    }
  } catch (error) {
    throw journalFailure(
      journalPath,
      `sources[${index}] backup proof authentication failed: ${error.message}`,
    );
  }
}

async function copyDirectoryContentsWithLedger(
  source,
  target,
  {
    record,
    persist,
    beforeMutation = null,
    beforeEntry = null,
    afterEntry = null,
    linkFile = link,
    provenanceContext = null,
    prepareTargetEvidence = null,
    authenticateTargetEvidence = null,
    createTargetEvidence = null,
    label = "Migration copy",
  },
) {
  if (record.copySourceManifest === null) {
    const sourceManifest = await captureDirectoryRemovalManifest(source, { label: `${label} source` });
    record.copyRoot = target;
    record.copySourceRoot = source;
    record.copySourceManifest = sourceManifest;
    record.copyTargetManifest = [];
    if (provenanceContext !== null) {
      if (!Array.isArray(record.copyTargetProvenance)) {
        throw migrationError(`${label} has no Change provenance ledger.`, "CONCURRENT_CHANGE");
      }
      record.copyProvenanceToken = randomUUID();
    }
    record.copyIntent = null;
    await persist();
  }
  if (resolve(record.copyRoot) !== resolve(target)
    || resolve(record.copySourceRoot) !== resolve(source)
    || !Array.isArray(record.copySourceManifest)
    || !Array.isArray(record.copyTargetManifest)) {
    throw migrationError(`${label} ledger does not match its transfer roots.`, "CONCURRENT_CHANGE");
  }
  await assertDirectoryRemovalManifest(source, record.copySourceManifest, `${label} source`);
  if (provenanceContext !== null) {
    if (record.copyProvenanceToken === null) {
      throw migrationError(`${label} has no active provenance token.`, "CONCURRENT_CHANGE");
    }
    await authenticateChangeCopyTargetProvenance(
      record,
      provenanceContext,
      label,
    );
  }
  if (prepareTargetEvidence) {
    await prepareTargetEvidence({
      record,
      source,
      target,
      sourceManifest: record.copySourceManifest,
    });
  }
  if (authenticateTargetEvidence) {
    await authenticateTargetEvidence({
      record,
      source,
      target,
      sourceManifest: record.copySourceManifest,
    });
  }
  const sourceByPath = new Map(
    record.copySourceManifest.map((entry, index) => [entry.relativePath, { ...entry, index }]),
  );
  const targetByPath = new Map(
    record.copyTargetManifest.map((entry) => [entry.relativePath, entry]),
  );
  const persistTargetEntry = async (entry, { complete = true } = {}) => {
    const next = record.copyTargetManifest
      .filter((candidate) => candidate.relativePath !== entry.relativePath);
    const targetEvidence = removalEntryEvidence(entry);
    targetEvidence.quarantineRelativePath = entry.type === "directory"
      ? null
      : normalizePath(relative(
        target,
        join(dirname(removalManifestPath(target, entry.relativePath)), `.sdd-remove-${process.pid}-${randomUUID()}`),
      ));
    next.push(targetEvidence);
    next.sort((left, right) => {
      const leftIndex = sourceByPath.get(left.relativePath)?.index ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = sourceByPath.get(right.relativePath)?.index ?? Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex;
    });
    record.copyTargetManifest = next;
    if (complete) record.copyIntent = null;
    targetByPath.set(entry.relativePath, next.find(
      (candidate) => candidate.relativePath === entry.relativePath,
    ));
    await persist();
  };
  const targetState = await pathState(target);
  if (targetState) {
    const currentTarget = await collectDirectoryRemovalManifest(target, `${label} destination`);
    for (const current of currentTarget) {
      const proven = targetByPath.get(current.relativePath);
      if (proven && sameRemovalEntry(current, proven)) continue;
      throw migrationError(
        `${label} destination contains unproven state: ${current.relativePath}`,
        "CONCURRENT_CHANGE",
      );
    }
    for (const proven of targetByPath.values()) {
      const current = currentTarget.find((entry) => entry.relativePath === proven.relativePath);
      if (!current || !sameRemovalEntry(current, proven)) {
        throw migrationError(
          `${label} destination lost a proven entry: ${proven.relativePath}`,
          "CONCURRENT_CHANGE",
        );
      }
    }
  } else if (record.copyTargetManifest.length !== 0) {
    throw migrationError(`${label} destination root disappeared: ${target}`, "CONCURRENT_CHANGE");
  }

  for (const [index, sourceEntry] of record.copySourceManifest.entries()) {
    if (beforeMutation) await beforeMutation({ source, target, phase: "copy-ledger" });
    await assertDirectoryRemovalManifest(source, record.copySourceManifest, `${label} source`);
    const sourcePath = removalManifestPath(source, sourceEntry.relativePath);
    const targetPath = removalManifestPath(target, sourceEntry.relativePath);
    let proven = targetByPath.get(sourceEntry.relativePath);
    if (proven) {
      await assertRemovalEntry(targetPath, proven, `${label} destination`);
      if (sourceEntry.type !== "file" || proven.hash === sourceEntry.hash) continue;
    } else {
      const existing = await pathState(targetPath);
      if (existing) {
        throw migrationError(`${label} destination entry is unproven: ${targetPath}`, "CONCURRENT_CHANGE");
      }
      record.copyIntent = {
        index,
        relativePath: sourceEntry.relativePath,
        type: sourceEntry.type,
        sourceIdentity: sourceEntry.identity,
        mode: sourceEntry.mode,
        hash: sourceEntry.hash,
        target: sourceEntry.target,
      };
      await persist();
      if (beforeEntry) {
        await beforeEntry({
          record,
          index,
          relativePath: sourceEntry.relativePath,
          type: sourceEntry.type,
          source: sourcePath,
          target: targetPath,
        });
      }
    }
    if (beforeMutation) await beforeMutation({ source: sourcePath, target: targetPath, phase: "copy-entry" });
    if (sourceEntry.type === "directory") {
      await assertRemovalEntry(sourcePath, sourceEntry, `${label} source`);
      let directoryHandle = null;
      let createdIdentity;
      try {
        await mkdir(targetPath, { mode: sourceEntry.mode });
        const createdState = await pathState(targetPath);
        if (!createdState?.isDirectory() || createdState.isSymbolicLink()) {
          throw migrationError(`${label} destination is not a real directory: ${targetPath}`, "CONCURRENT_CHANGE");
        }
        createdIdentity = fileIdentity(createdState);
        directoryHandle = await open(targetPath, "r");
        const handleState = await directoryHandle.stat();
        if (!handleState.isDirectory()
          || !sameFileIdentity(fileIdentity(handleState), createdIdentity)) {
          throw migrationError(`${label} directory changed while it was opened: ${targetPath}`, "CONCURRENT_CHANGE");
        }
        await directoryHandle.chmod(sourceEntry.mode);
      } catch (error) {
        throw migrationError(`${label} directory could not be created with its exact mode: ${targetPath}`, "CONCURRENT_CHANGE", [
          error.message,
        ]);
      } finally {
        if (directoryHandle) await directoryHandle.close().catch(() => {});
      }
      await syncDirectory(dirname(targetPath));
      const created = await inspectRemovalEntry(targetPath, sourceEntry.relativePath, `${label} destination`);
      if (!sameFileIdentity(created.identity, createdIdentity)
        || created.mode !== sourceEntry.mode) {
        throw migrationError(`${label} directory changed during publication: ${targetPath}`, "CONCURRENT_CHANGE");
      }
      if (provenanceContext !== null) {
        await createChangeCopyTargetProvenance(
          record,
          sourceEntry,
          index,
          targetPath,
          created,
          provenanceContext,
        );
      }
      if (createTargetEvidence) {
        await createTargetEvidence({
          record,
          sourceEntry,
          index,
          source: sourcePath,
          target: targetPath,
          targetEntry: created,
        });
      }
      await persistTargetEntry(created);
    } else if (sourceEntry.type === "symlink") {
      await linkFile(sourcePath, targetPath);
      await syncDirectory(dirname(targetPath));
      const created = await inspectRemovalEntry(targetPath, sourceEntry.relativePath, `${label} destination`);
      if (!sameFileIdentity(created.identity, sourceEntry.identity)
        || created.mode !== sourceEntry.mode
        || created.target !== sourceEntry.target) {
        throw migrationError(`${label} symbolic link changed during publication: ${targetPath}`, "CONCURRENT_CHANGE");
      }
      if (provenanceContext !== null) {
        await createChangeCopyTargetProvenance(
          record,
          sourceEntry,
          index,
          targetPath,
          created,
          provenanceContext,
        );
      }
      if (createTargetEvidence) {
        await createTargetEvidence({
          record,
          sourceEntry,
          index,
          source: sourcePath,
          target: targetPath,
          targetEntry: created,
        });
      }
      await persistTargetEntry(created);
    } else {
      await transferRegularFileWithoutReplace(sourcePath, targetPath, {
        expectedHash: sourceEntry.hash,
        expectedSourceIdentity: sourceEntry.identity,
        expectedMode: sourceEntry.mode,
        ownedTargetIdentity: proven?.identity ?? null,
        label,
        beforeMutation,
        linkFile,
        afterTargetExposure: provenanceContext === null && createTargetEvidence === null
          ? null
          : async ({ identity }) => {
            const targetEntry = {
              relativePath: sourceEntry.relativePath,
              type: "file",
              identity,
              mode: sourceEntry.mode,
              hash: null,
              target: null,
            };
            if (provenanceContext !== null) {
              await createChangeCopyTargetProvenance(
                record,
                sourceEntry,
                index,
                targetPath,
                targetEntry,
                provenanceContext,
              );
            }
            if (createTargetEvidence) {
              await createTargetEvidence({
                record,
                sourceEntry,
                index,
                source: sourcePath,
                target: targetPath,
                targetEntry,
              });
            }
          },
        afterTargetCreate: async ({ identity, hash }) => {
          await persistTargetEntry({
            relativePath: sourceEntry.relativePath,
            type: "file",
            identity,
            mode: sourceEntry.mode,
            hash,
            target: null,
          }, { complete: false });
        },
        afterTargetWrite: async ({ identity, hash }) => {
          await persistTargetEntry({
            relativePath: sourceEntry.relativePath,
            type: "file",
            identity,
            mode: sourceEntry.mode,
            hash,
            target: null,
          });
        },
      });
    }
    proven = targetByPath.get(sourceEntry.relativePath);
    if (!proven) {
      throw migrationError(`${label} entry lacks durable ownership proof: ${targetPath}`, "CONCURRENT_CHANGE");
    }
    if (afterEntry) {
      await afterEntry({
        record,
        index,
        relativePath: sourceEntry.relativePath,
        type: sourceEntry.type,
        source: sourcePath,
        target: targetPath,
      });
    }
  }
  await assertDirectoryRemovalManifest(source, record.copySourceManifest, `${label} source`);
  const completed = await collectDirectoryRemovalManifest(target, `${label} destination`);
  if (completed.length !== record.copyTargetManifest.length
    || completed.some((entry, index) => !sameRemovalEntry(entry, record.copyTargetManifest[index]))
    || await hashDirectory(target).catch(() => null) !== await hashDirectory(source).catch(() => null)) {
    throw migrationError(`${label} destination does not exactly match its source.`, "CONCURRENT_CHANGE");
  }
}

async function inspectSourceBackupPayload(
  record,
  backupPhysicalPath,
  payloadPath,
  { allowPartialRemoval = false } = {},
) {
  const payloadState = await pathState(payloadPath);
  if (!payloadState?.isDirectory() || payloadState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(payloadState), record.backupPayloadIdentity)) {
    throw migrationError(`Migration backup payload changed physical identity: ${payloadPath}`, "CONCURRENT_CHANGE");
  }
  const payloadPhysicalPath = await resolvePhysicalPath(payloadPath);
  if (payloadPhysicalPath !== resolve(payloadPath)
    || !isStrictlyInside(backupPhysicalPath, payloadPhysicalPath)) {
    throw migrationError(`Migration backup payload escaped before recovery: ${payloadPath}`, "CONCURRENT_CHANGE");
  }
  if (allowPartialRemoval) {
    if (record.removalMode !== "backup"
      || record.removalRoot !== payloadPath
      || record.removalManifest === null) {
      throw migrationError(`Migration backup payload lacks durable cleanup authority: ${payloadPath}`, "CONCURRENT_CHANGE");
    }
    await assertDirectoryRemovalSubset(
      payloadPath,
      record.removalManifest,
      record.removalProgress,
      "Migration backup payload",
    );
  } else if (await hashDirectory(payloadPhysicalPath) !== record.hash) {
    throw migrationError(`Migration backup payload changed before recovery: ${payloadPath}`, "CONCURRENT_CHANGE");
  }
  return payloadState;
}

async function inspectSourceBackup(
  record,
  {
    allowEmpty = false,
    allowPartialRemoval = false,
    state = record.backupProofState ?? null,
  } = {},
) {
  await assertStoredDirectoryAnchor(
    record.ownerRoot,
    sourceOwnerAnchor(record),
    "Legacy source owner",
  );
  const backupState = await pathState(record.backup);
  if (!backupState) return null;
  if (!record.backupIdentity
    || !backupState.isDirectory()
    || backupState.isSymbolicLink()
    || (backupState.mode & 0o777) !== record.backupMode
    || !sameFileIdentity(fileIdentity(backupState), record.backupIdentity)) {
    throw migrationError(`Migration backup reservation changed physical identity: ${record.backup}`, "CONCURRENT_CHANGE");
  }
  const backupPhysicalPath = await resolvePhysicalPath(record.backup);
  if (backupPhysicalPath !== resolve(record.backup)
    || !isStrictlyInside(record.ownerPhysicalPath, backupPhysicalPath)) {
    throw migrationError(`Migration backup reservation escaped its owner: ${record.backup}`, "CONCURRENT_CHANGE");
  }

  const entries = await readdir(record.backup);
  let cleanupState = null;
  let payloadPath = null;
  if (record.cleanupPath === null) {
    if (record.cleanupIdentity !== null || record.cleanupMode !== null) {
      throw migrationError(`Migration backup cleanup authority has no path: ${record.backup}`, "CONCURRENT_CHANGE");
    }
    if (entries.length === 1) payloadPath = join(record.backup, entries[0]);
    else if (entries.length !== 0 || !allowEmpty) {
      throw migrationError(`Migration backup reservation has an unexpected payload: ${record.backup}`, "CONCURRENT_CHANGE");
    }
  } else {
    if (resolve(dirname(record.cleanupPath)) !== resolve(record.backup)) {
      throw migrationError(`Migration backup cleanup path escapes its reservation: ${record.cleanupPath}`, "CONCURRENT_CHANGE");
    }
    cleanupState = await pathState(record.cleanupPath);
    if (record.cleanupIdentity === null || record.cleanupMode === null) {
      if (cleanupState) {
        throw migrationError(`Migration backup cleanup reservation has unknown ownership: ${record.cleanupPath}`, "CONCURRENT_CHANGE");
      }
    } else if (cleanupState) {
      if (!cleanupState.isDirectory() || cleanupState.isSymbolicLink()
        || !sameFileIdentity(fileIdentity(cleanupState), record.cleanupIdentity)
        || (cleanupState.mode & 0o777) !== record.cleanupMode) {
        throw migrationError(`Migration backup cleanup reservation changed identity: ${record.cleanupPath}`, "CONCURRENT_CHANGE");
      }
      const cleanupPhysicalPath = await resolvePhysicalPath(record.cleanupPath);
      if (cleanupPhysicalPath !== resolve(record.cleanupPath)
        || !isStrictlyInside(backupPhysicalPath, cleanupPhysicalPath)) {
        throw migrationError(`Migration backup cleanup reservation escaped its owner: ${record.cleanupPath}`, "CONCURRENT_CHANGE");
      }
    }

    const cleanupName = basename(record.cleanupPath);
    const rootPayloads = entries.filter((entry) => entry !== cleanupName);
    if (rootPayloads.length > 1
      || (rootPayloads.length === 1 && cleanupState && (await readdir(record.cleanupPath)).length > 0)) {
      throw migrationError(`Migration backup reservation has unexpected cleanup entries: ${record.backup}`, "CONCURRENT_CHANGE");
    }
    if (rootPayloads.length === 1) {
      if (record.cleanupIdentity !== null && !cleanupState) {
        throw migrationError(`Migration backup cleanup reservation disappeared: ${record.cleanupPath}`, "CONCURRENT_CHANGE");
      }
      payloadPath = join(record.backup, rootPayloads[0]);
    } else if (cleanupState) {
      const cleanupEntries = await readdir(record.cleanupPath);
      if (cleanupEntries.length > 1) {
        throw migrationError(`Migration backup cleanup reservation has unexpected entries: ${record.cleanupPath}`, "CONCURRENT_CHANGE");
      }
      if (cleanupEntries.length === 1) {
        payloadPath = join(record.cleanupPath, cleanupEntries[0]);
      }
    } else if (entries.length !== 0 || !allowEmpty) {
      throw migrationError(`Migration backup payload is missing during cleanup: ${record.backup}`, "CONCURRENT_CHANGE");
    }
  }

  if (payloadPath === null) {
    if (!allowEmpty) {
      throw migrationError(`Migration backup payload is missing: ${record.backup}`, "CONCURRENT_CHANGE");
    }
    if (["present", "cleaning"].includes(record.backupProofPhase)) {
      if (state === null) {
        throw migrationError(
          `Migration backup cannot authenticate proof without transaction state: ${record.backup}`,
          "CONCURRENT_CHANGE",
        );
      }
      await authenticateSourceBackupProvenance(state, record, {
        allowMissingPayload: true,
      });
    }
    return {
      reservationState: backupState,
      payloadPath: null,
      payloadState: null,
      cleanupState,
    };
  }
  const payloadState = await inspectSourceBackupPayload(
    record,
    backupPhysicalPath,
    payloadPath,
    { allowPartialRemoval },
  );
  if (["present", "cleaning"].includes(record.backupProofPhase)) {
    if (state === null) {
      throw migrationError(
        `Migration backup cannot authenticate proof without transaction state: ${record.backup}`,
        "CONCURRENT_CHANGE",
      );
    }
    await authenticateSourceBackupProvenance(state, record, {
      payloadPath,
      allowPartialPayload: allowPartialRemoval,
    });
  }
  return { reservationState: backupState, payloadPath, payloadState, cleanupState };
}
async function cleanupSourceBackup(
  state,
  record,
  {
    beforeDelete = null,
    beforeRemoval = null,
    afterVerification = null,
    beforeQuarantine = null,
    afterQuarantine = null,
    beforeRemovalMutation = null,
    assertSourceCurrent = null,
  } = {},
) {
  record.backupProofState = state;
  const assertRemovalSource = (details = {}) => assertSourceBackupCleanupCorroboration(
    state,
    record,
    assertSourceCurrent,
    details,
  );
  let backup = await inspectSourceBackup(record, {
    allowEmpty: true,
    allowPartialRemoval: record.removalMode === "backup",
  });
  if (!backup) {
    if (record.backupProofPhase === "cleaning") {
      await cleanupSourceBackupProof(state, record, { assertSourceCurrent });
    } else if (record.backupProofPhase === "removed") {
      if (assertSourceCurrent) await assertSourceCurrent();
    } else {
      throw migrationError(`Legacy source backup disappeared before cleanup: ${record.backup}`, "CONCURRENT_CHANGE");
    }
    record.backupIdentity = null;
    record.backupMode = null;
    record.backupPayloadIdentity = null;
    record.cleanupPath = null;
    record.cleanupIdentity = null;
    record.cleanupMode = null;
    await persistTransaction(state);
    return;
  }

  if (record.cleanupPath === null) {
    record.cleanupPath = join(record.backup, `.sdd-cleanup-${randomUUID()}`);
    await persistTransaction(state);
    backup = await inspectSourceBackup(record, {
      allowEmpty: true,
      allowPartialRemoval: record.removalMode === "backup",
    });
  }
  if (record.cleanupIdentity === null) {
    if (await pathState(record.cleanupPath)) {
      throw migrationError(`Migration backup cleanup path already exists: ${record.cleanupPath}`, "CONCURRENT_CHANGE");
    }
    await mkdir(record.cleanupPath, { mode: 0o700 });
    const cleanupState = await pathState(record.cleanupPath);
    if (!cleanupState?.isDirectory() || cleanupState.isSymbolicLink()) {
      throw migrationError(`Migration backup cleanup reservation is not a real directory: ${record.cleanupPath}`, "CONCURRENT_CHANGE");
    }
    record.cleanupIdentity = fileIdentity(cleanupState);
    record.cleanupMode = cleanupState.mode & 0o777;
    await persistTransaction(state);
    backup = await inspectSourceBackup(record, {
      allowEmpty: true,
      allowPartialRemoval: record.removalMode === "backup",
    });
  }

  if (backup.payloadPath) {
    await assertRemovalSource({ payloadPath: backup.payloadPath, phase: "before-delete" });
    if (beforeDelete) await beforeDelete({ record, payloadPath: backup.payloadPath });
    const rechecked = await inspectSourceBackup(record, {
      allowEmpty: true,
      allowPartialRemoval: record.removalMode === "backup",
    });
    if (rechecked.payloadPath !== backup.payloadPath) {
      throw migrationError(`Migration backup quarantine changed before deletion: ${record.backup}`, "CONCURRENT_CHANGE");
    }
    await removeProvenDirectoryTree(backup.payloadPath, {
      expectedIdentity: record.backupPayloadIdentity,
      expectedHash: record.hash,
      label: "Migration backup payload",
      verifyRemoval: async (payloadPath) => {
        await assertRemovalSource({ payloadPath, phase: "before-removal" });
        if (beforeRemoval) await beforeRemoval({ record, payloadPath });
        await authenticateSourceBackupProvenance(state, record, {
          payloadPath,
          allowPartialPayload: record.removalMode === "backup",
        });
        await assertRemovalSource({ payloadPath, phase: "immediately-before-removal" });
      },
      afterVerification: afterVerification
        ? ({ path: payloadPath }) => afterVerification({ record, payloadPath })
        : null,
      beforeQuarantine,
      afterQuarantine,
      beforeRemovalMutation: async (entry) => {
        await assertRemovalSource({ entry, phase: "before-removal-mutation" });
        await authenticateSourceBackupProvenance(state, record, {
          payloadPath: backup.payloadPath,
          allowPartialPayload: record.removalMode === "backup",
        });
        if (beforeRemovalMutation) await beforeRemovalMutation(entry);
        await assertRemovalSource({ entry, phase: "after-removal-mutation-hook" });
        await authenticateSourceBackupProvenance(state, record, {
          payloadPath: backup.payloadPath,
          allowPartialPayload: record.removalMode === "backup",
        });
        await assertRemovalSource({ entry, phase: "immediately-before-removal-mutation" });
      },
      removalManifest: record.removalMode === "backup" ? record.removalManifest : null,
      removalProgress: record.removalMode === "backup" ? record.removalProgress : [],
      persistRemovalManifest: async (manifest) => {
        record.removalMode = "backup";
        record.removalRoot = backup.payloadPath;
        record.removalManifest = manifest;
        record.removalProgress = [];
        await persistTransaction(state);
      },
      persistRemovalProgress: async (progress) => {
        record.removalProgress = progress;
        await persistTransaction(state);
      },
    });
  }

  backup = await inspectSourceBackup(record, {
    allowEmpty: true,
    allowPartialRemoval: record.removalMode === "backup",
  });
  if (backup.payloadPath !== null) {
    throw migrationError(`Migration backup payload remains after cleanup: ${record.backup}`, "CONCURRENT_CHANGE");
  }
  record.removalMode = null;
  record.removalRoot = null;
  record.removalManifest = null;
  record.removalProgress = [];
  await persistTransaction(state);
  await authenticateSourceBackupProvenance(state, record, {
    allowMissingPayload: true,
  });
  if (record.backupProofPhase === "present") {
    record.backupProofPhase = "cleaning";
    await persistTransaction(state);
  }
  await assertRemovalSource({ path: record.cleanupPath, phase: "before-cleanup-reservation-removal" });
  await authenticateSourceBackupProvenance(state, record, {
    allowMissingPayload: true,
  });
  await assertRemovalSource({
    path: record.cleanupPath,
    phase: "immediately-before-cleanup-reservation-removal",
  });
  if (backup.cleanupState) {
    assertDirectoryIdentitySync(
      record.cleanupPath,
      record.cleanupIdentity,
      "Migration backup cleanup reservation",
      record.cleanupMode,
    );
    if (readdirSync(record.cleanupPath).length !== 0) {
      throw migrationError(`Migration backup cleanup reservation changed before removal: ${record.cleanupPath}`, "CONCURRENT_CHANGE");
    }
    rmdirSync(record.cleanupPath);
    if (pathStateSync(record.cleanupPath)) {
      throw migrationError(`Migration backup cleanup reservation was replaced during removal: ${record.cleanupPath}`, "CONCURRENT_CHANGE");
    }
  }
  await assertRemovalSource({ path: record.backup, phase: "before-backup-reservation-removal" });
  await authenticateSourceBackupProvenance(state, record, {
    allowMissingPayload: true,
  });
  await assertRemovalSource({
    path: record.backup,
    phase: "immediately-before-backup-reservation-removal",
  });
  assertDirectoryIdentitySync(
    record.backup,
    record.backupIdentity,
    "Migration backup reservation",
    record.backupMode,
  );
  if (readdirSync(record.backup).length !== 0) {
    throw migrationError(`Migration backup reservation changed before removal: ${record.backup}`, "CONCURRENT_CHANGE");
  }
  rmdirSync(record.backup);
  if (pathStateSync(record.backup)) {
    throw migrationError(`Migration backup reservation was replaced during removal: ${record.backup}`, "CONCURRENT_CHANGE");
  }
  await cleanupSourceBackupProof(state, record, { assertSourceCurrent });
  record.backupIdentity = null;
  record.backupMode = null;
  record.backupPayloadIdentity = null;
  record.cleanupPath = null;
  record.cleanupIdentity = null;
  record.cleanupMode = null;
  await persistTransaction(state);
}


async function moveSourceToBackupWithoutReplace(
  state,
  record,
  {
    afterReservationMkdir = null,
    afterReservation = null,
    beforeCopyEntry = null,
    afterCopyEntry = null,
    linkFile = link,
    beforeRemovalMutation = null,
    assertRemovalAuthority = null,
  } = {},
) {
  record.backupProofState = state;
  try {
    await mkdir(record.backup, { mode: 0o700 });
  } catch (error) {
    throw migrationError(
      `Migration backup path already exists: ${record.backup}`,
      "CONCURRENT_CHANGE",
      [error.message],
    );
  }
  const reservationState = await pathState(record.backup);
  if (!reservationState?.isDirectory() || reservationState.isSymbolicLink()) {
    throw migrationError(`Migration backup reservation is not a real directory: ${record.backup}`, "CONCURRENT_CHANGE");
  }
  record.backupIdentity = fileIdentity(reservationState);
  record.backupMode = reservationState.mode & 0o777;
  await persistTransaction(state);
  if (afterReservationMkdir) {
    await afterReservationMkdir({ root: record, reservation: record.backup });
  }
  if (afterReservation) await afterReservation({ root: record, reservation: record.backup });
  const reservation = await inspectSourceBackup(record, { allowEmpty: true });
  if (reservation.payloadPath !== null) {
    throw migrationError(`Migration backup reservation is not empty: ${record.backup}`, "CONCURRENT_CHANGE");
  }
  await assertSourceRootAnchor(record);
  const payloadPath = record.copyRoot ?? join(record.backup, randomUUID());
  const assertTransferRoots = async () => {
    await assertSourceRootAnchor(record, {
      verifyHash: record.removalMode !== "source",
    });
    const backupState = await pathState(record.backup);
    if (!backupState?.isDirectory()
      || backupState.isSymbolicLink()
      || (backupState.mode & 0o777) !== record.backupMode
      || !sameFileIdentity(fileIdentity(backupState), record.backupIdentity)) {
      throw migrationError(`Migration backup transfer root changed: ${record.path}`, "CONCURRENT_CHANGE");
    }
    if (assertRemovalAuthority) await assertRemovalAuthority();
  };
  await copyDirectoryContentsWithLedger(record.physicalPath, payloadPath, {
    record,
    persist: () => persistTransaction(state),
    beforeMutation: assertTransferRoots,
    beforeEntry: beforeCopyEntry,
    afterEntry: afterCopyEntry,
    linkFile,
    prepareTargetEvidence: () => prepareSourceBackupProof(state, record),
    authenticateTargetEvidence: () => authenticateSourceBackupCopyProvenance(state, record),
    createTargetEvidence: ({
      sourceEntry,
      index,
      target,
      targetEntry,
    }) => createSourceBackupEntryProvenance(
      state,
      record,
      sourceEntry,
      index,
      target,
      targetEntry,
    ),
    label: "Migration backup copy",
  });
  await finalizeSourceBackupProof(state, record);
  record.copyRoot = null;
  record.copySourceRoot = null;
  record.copySourceManifest = null;
  record.copyTargetManifest = null;
  record.copyIntent = null;
  await persistTransaction(state);
  const assertBackupReservation = async () => {
    await assertTransferRoots();
    await authenticateSourceBackupProvenance(state, record, { payloadPath });
    const currentPayloadState = await pathState(payloadPath);
    if (!currentPayloadState?.isDirectory()
      || currentPayloadState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(currentPayloadState), record.backupPayloadIdentity)) {
      throw migrationError(`Migration backup transfer payload changed: ${record.path}`, "CONCURRENT_CHANGE");
    }
    if (assertRemovalAuthority) await assertRemovalAuthority();
  };
  await assertTransferRoots();
  if (await hashDirectory(payloadPath).catch(() => null) !== record.hash) {
    throw migrationError(`Migration backup copy changed: ${payloadPath}`, "CONCURRENT_CHANGE");
  }
  await removeProvenDirectoryTree(record.physicalPath, {
    expectedIdentity: record.identity,
    expectedHash: record.hash,
    label: "Legacy source",
    assertBoundary: assertBackupReservation,
    beforeRemovalMutation: async (entry) => {
      if (beforeRemovalMutation) await beforeRemovalMutation(entry);
      await assertBackupReservation();
    },
    removalManifest: record.removalMode === "source" ? record.removalManifest : null,
    removalProgress: record.removalMode === "source" ? record.removalProgress : [],
    persistRemovalManifest: async (manifest) => {
      record.removalMode = "source";
      record.removalRoot = record.physicalPath;
      record.removalManifest = manifest;
      record.removalProgress = [];
      await persistTransaction(state);
    },
    persistRemovalProgress: async (progress) => {
      record.removalProgress = progress;
      await persistTransaction(state);
    },
  });
  return inspectSourceBackup(record);
}

async function restoreSourceRemovalQuarantines(record) {
  if (record.removalMode !== "source"
    || record.removalRoot !== record.physicalPath
    || record.removalManifest === null) return;
  const subset = await assertDirectoryRemovalSubset(
    record.physicalPath,
    record.removalManifest,
    record.removalProgress,
    "Legacy source",
  );
  const entriesByPath = new Map(
    record.removalManifest.map((entry) => [entry.relativePath, entry]),
  );
  for (const entry of record.removalManifest) {
    if (entry.type === "directory"
      || entry.quarantineRelativePath === null
      || !subset.currentByPath.has(entry.quarantineRelativePath)) continue;
    const originalPath = removalManifestPath(record.physicalPath, entry.relativePath);
    const quarantinePath = removalManifestPath(
      record.physicalPath,
      entry.quarantineRelativePath,
    );
    const parentEntry = entriesByPath.get(normalizePath(dirname(entry.relativePath)));
    if (!parentEntry) {
      throw migrationError(`Legacy source removal proof lost a parent: ${originalPath}`, "CONCURRENT_CHANGE");
    }
    await assertRemovalEntry(dirname(originalPath), parentEntry, "Legacy source");
    if (!(await pathState(originalPath))) {
      try {
        await link(quarantinePath, originalPath);
      } catch (error) {
        throw migrationError(
          `Legacy source quarantine could not be restored: ${originalPath}`,
          "CONCURRENT_CHANGE",
          [error.message],
        );
      }
    }
    await assertRemovalEntry(originalPath, entry, "Legacy source");
    const quarantine = await inspectRemovalEntry(
      quarantinePath,
      entry.quarantineRelativePath,
      "Legacy source",
    );
    if (!sameRemovalEntry(quarantine, entry, entry.quarantineRelativePath)) {
      throw migrationError(`Legacy source quarantine changed: ${quarantinePath}`, "CONCURRENT_CHANGE");
    }
    assertRemovalEntrySync(dirname(quarantinePath), parentEntry, "Legacy source");
    assertRemovalEntrySync(originalPath, entry, "Legacy source");
    assertRemovalEntrySync(quarantinePath, entry, "Legacy source");
    unlinkSync(quarantinePath);
    if (pathStateSync(quarantinePath)) {
      throw migrationError(`Legacy source quarantine was replaced: ${quarantinePath}`, "CONCURRENT_CHANGE");
    }
  }
}

async function sourceMatchesRecordedState(record, sourceState) {
  if (!sourceState?.isDirectory() || sourceState.isSymbolicLink()) return false;
  const identity = fileIdentity(sourceState);
  if (!sameFileIdentity(identity, record.identity)
    && !sameFileIdentity(identity, record.restoreIdentity)) {
    return false;
  }
  const physicalPath = await resolvePhysicalPath(record.physicalPath);
  if (physicalPath !== resolve(record.physicalPath)
    || !isStrictlyInside(record.ownerPhysicalPath, physicalPath)
    || await hashDirectory(physicalPath).catch(() => null) !== record.hash) {
    return false;
  }
  let expectedManifest = null;
  if (record.restoreCopyTargetManifest?.length > 0) {
    expectedManifest = record.restoreCopyTargetManifest;
  } else if (record.copySourceRoot === record.physicalPath
    && record.copySourceManifest !== null) {
    expectedManifest = record.copySourceManifest;
  } else if (record.removalMode === "source" && record.removalManifest !== null) {
    expectedManifest = record.removalManifest;
  } else if (record.backupEntryProvenance.length > 0) {
    expectedManifest = sourceEntriesFromBackupProvenance(record.backupEntryProvenance);
  }
  if (expectedManifest === null) return true;
  const current = await collectDirectoryRemovalManifest(
    record.physicalPath,
    "Legacy source",
  ).catch(() => null);
  return current !== null
    && current.length === expectedManifest.length
    && current.every((entry, index) => (
      sameRemovalEntryContents(entry, expectedManifest[index])
    ));
}

async function assertRestoredSourceCurrent(record) {
  if (record.restoreCopyRoot !== null) {
    await inspectSourceBackup(record);
  }
  const sourceState = await pathState(record.physicalPath);
  if (!(await sourceMatchesRecordedState(record, sourceState))) {
    throw migrationError(
      `Restored legacy source changed before rollback cleanup: ${record.path}`,
      "CONCURRENT_CHANGE",
    );
  }
}

async function ensureSourceRestoreIntent(state, record, backup) {
  if (record.restoreReservationToken === null) {
    record.restoreReservationToken = randomUUID();
    await persistTransaction(state);
  }
  const receiptState = await pathState(record.backupProofReceiptPath);
  if (!receiptState?.isFile()
    || receiptState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(receiptState), record.backupProofReceiptIdentity)) {
    throw migrationError(
      `Legacy source restore cannot authenticate its backup receipt: ${record.backupProofReceiptPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  const intentPath = sourceRestoreIntentPath(record);
  let intentState = await pathState(intentPath);
  if (!intentState) {
    try {
      await link(record.backupProofReceiptPath, intentPath);
    } catch (error) {
      throw migrationError(
        `Legacy source restore intent could not be created: ${intentPath}`,
        "CONCURRENT_CHANGE",
        [error.message],
      );
    }
    await syncDirectory(record.backupProofRoot);
    intentState = await pathState(intentPath);
  }
  if (!intentState?.isFile()
    || intentState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(intentState), record.backupProofReceiptIdentity)
    || (record.restoreIntentIdentity !== null
      && !sameFileIdentity(record.restoreIntentIdentity, fileIdentity(intentState)))) {
    throw migrationError(
      `Legacy source restore intent changed identity: ${intentPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  record.restoreIntentIdentity = fileIdentity(intentState);
  await persistTransaction(state);
  return inspectSourceBackup(record);
}

async function initializeSourceRestoreCopy(
  state,
  record,
  backup,
  { afterReservation = null } = {},
) {
  const ledgerWasPresent = record.restoreCopyRoot !== null;
  if (!ledgerWasPresent) {
    record.restoreCopyRoot = record.physicalPath;
    record.restoreCopySourceRoot = backup.payloadPath;
    record.restoreCopySourceManifest = await captureDirectoryRemovalManifest(
      backup.payloadPath,
      { label: "Legacy source restore backup" },
    );
    record.restoreCopyTargetManifest = [];
    record.restoreCopyProvenanceToken = randomUUID();
    record.restoreCopyTargetProvenance = [];
    record.restoreCopyIntent = null;
  }
  if (resolve(record.restoreCopyRoot) !== resolve(record.physicalPath)
    || resolve(record.restoreCopySourceRoot) !== resolve(backup.payloadPath)
    || record.restoreCopySourceManifest === null
    || record.restoreCopyProvenanceToken === null) {
    throw migrationError(`Legacy source restore copy ledger changed: ${record.path}`, "CONCURRENT_CHANGE");
  }
  const sourceByPath = new Map(
    record.restoreCopySourceManifest.map((entry, index) => [
      entry.relativePath,
      { ...entry, index },
    ]),
  );
  const markerPath = sourceRestoreReservationMarkerPath(record);
  const markerRelativePath = normalizePath(relative(record.physicalPath, markerPath));
  const current = (await collectDirectoryRemovalManifest(
    record.physicalPath,
    "Legacy source restore reservation",
  )).filter((entry) => entry.relativePath !== markerRelativePath);
  if (!ledgerWasPresent
    && record.removalMode !== "source"
    && (current.length !== 1
      || current[0].relativePath !== "."
      || !sameFileIdentity(current[0].identity, record.restoreIdentity))) {
    throw migrationError(
      `Legacy source restore reservation gained unauthenticated state: ${record.path}`,
      "CONCURRENT_CHANGE",
    );
  }
  const authenticated = [];
  for (const targetEntry of current) {
    const sourceEntry = sourceByPath.get(targetEntry.relativePath);
    if (!sourceEntry
      || sourceEntry.type !== targetEntry.type
      || (sourceEntry.type === "file" && sourceEntry.hash !== targetEntry.hash)
      || (sourceEntry.type === "symlink"
        && (sourceEntry.target !== targetEntry.target
          || !sameFileIdentity(sourceEntry.identity, targetEntry.identity)))) {
      throw migrationError(
        `Legacy source restore reservation contains unproven state: ${targetEntry.relativePath}`,
        "CONCURRENT_CHANGE",
      );
    }
    await createSourceRestoreEntryEvidence(
      record,
      sourceEntry,
      sourceEntry.index,
      removalManifestPath(record.physicalPath, targetEntry.relativePath),
      targetEntry,
    );
    const evidence = removalEntryEvidence(targetEntry);
    evidence.quarantineRelativePath = targetEntry.type === "directory"
      ? null
      : `.sdd-source-restore-target-${record.restoreReservationToken}-${sourceEntry.index}`;
    authenticated.push(evidence);
  }
  authenticated.sort((left, right) => (
    sourceByPath.get(left.relativePath).index - sourceByPath.get(right.relativePath).index
  ));
  record.restoreCopyTargetManifest = authenticated;
  if (!ledgerWasPresent) await persistTransaction(state);
  if (!ledgerWasPresent && afterReservation) {
    await afterReservation({
      record,
      source: backup.payloadPath,
      target: record.physicalPath,
    });
  }
  await persistTransaction(state);
}

async function removeSourceRestoreReservationMarker(record) {
  const markerPath = sourceRestoreReservationMarkerPath(record);
  const markerState = pathStateSync(markerPath);
  if (!markerState) return;
  assertDirectoryIdentitySync(
    record.physicalPath,
    record.restoreIdentity,
    "Legacy source restore reservation",
    record.restoreCopySourceManifest?.[0]?.mode ?? null,
  );
  if (!markerState.isFile()
    || markerState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(markerState), record.restoreIntentIdentity)) {
    throw migrationError(
      `Legacy source restore reservation marker changed: ${markerPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  unlinkSync(markerPath);
  if (pathStateSync(markerPath)) {
    throw migrationError(
      `Legacy source restore reservation marker was replaced during removal: ${markerPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  await syncDirectory(record.physicalPath);
}

async function restoreSourceBackupWithoutReplace(
  state,
  record,
  backup,
  {
    retainBackup = false,
    afterEntry = null,
    afterReservation = null,
  } = {},
) {
  backup = await ensureSourceRestoreIntent(state, record, backup);
  let sourceState = await pathState(record.physicalPath);
  let adoptedPartialSource = false;
  if (!sourceState) {
    await assertStoredDirectoryAnchor(
      record.ownerRoot,
      sourceOwnerAnchor(record),
      "Legacy source owner",
    );
    try {
      const restoreMode = backup.payloadState.mode & 0o777;
      mkdirSync(record.physicalPath, { mode: restoreMode });
      chmodSync(record.physicalPath, restoreMode);
      linkSync(sourceRestoreIntentPath(record), sourceRestoreReservationMarkerPath(record));
    } catch (error) {
      const createdState = pathStateSync(record.physicalPath);
      const markerState = pathStateSync(sourceRestoreReservationMarkerPath(record));
      if (createdState?.isDirectory()
        && !createdState.isSymbolicLink()
        && markerState?.isFile()
        && !markerState.isSymbolicLink()
        && sameFileIdentity(fileIdentity(markerState), record.restoreIntentIdentity)
        && readdirSync(record.physicalPath).length === 1) {
        unlinkSync(sourceRestoreReservationMarkerPath(record));
        rmdirSync(record.physicalPath);
      }
      throw migrationError(
        `Newer legacy source preserved; backup retained at ${record.backup}.`,
        "CONCURRENT_CHANGE",
        [error.message],
      );
    }
    sourceState = await pathState(record.physicalPath);
    const markerState = await pathState(sourceRestoreReservationMarkerPath(record));
    if (!sourceState?.isDirectory()
      || sourceState.isSymbolicLink()
      || (sourceState.mode & 0o777) !== (backup.payloadState.mode & 0o777)
      || !markerState?.isFile()
      || markerState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(markerState), record.restoreIntentIdentity)) {
      throw migrationError(
        `Legacy source restoration reservation changed: ${record.path}`,
        "CONCURRENT_CHANGE",
      );
    }
    record.restoreIdentity = fileIdentity(sourceState);
  } else {
    if (!record.restoreIdentity) {
      const physicalPath = await resolvePhysicalPath(record.physicalPath);
      if (record.removalMode !== "source"
        || record.removalRoot !== record.physicalPath
        || record.removalManifest === null
        || !sourceState.isDirectory()
        || sourceState.isSymbolicLink()
        || !sameFileIdentity(fileIdentity(sourceState), record.identity)
        || physicalPath !== resolve(record.physicalPath)
        || !isStrictlyInside(record.ownerPhysicalPath, physicalPath)) {
        throw migrationError(
          `Newer legacy source preserved; backup retained at ${record.backup}.`,
          "CONCURRENT_CHANGE",
        );
      }
      await assertDirectoryRemovalSubset(
        record.physicalPath,
        record.removalManifest,
        record.removalProgress,
        "Legacy source",
      );
      adoptedPartialSource = true;
      record.restoreIdentity = fileIdentity(sourceState);
    }
    if (!sourceState.isDirectory()
      || sourceState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(sourceState), record.restoreIdentity)) {
      throw migrationError(
        `Newer legacy source preserved; backup retained at ${record.backup}.`,
        "CONCURRENT_CHANGE",
      );
    }
    if (record.removalMode === "source" && !adoptedPartialSource) {
      await assertDirectoryRemovalSubset(
        record.physicalPath,
        record.removalManifest,
        record.removalProgress,
        "Legacy source",
      );
      adoptedPartialSource = true;
    }
  }
  if (adoptedPartialSource) await restoreSourceRemovalQuarantines(record);
  await initializeSourceRestoreCopy(state, record, backup, { afterReservation });
  await removeSourceRestoreReservationMarker(record);
  if (record.removalMode === "source") {
    record.removalMode = null;
    record.removalRoot = null;
    record.removalManifest = null;
    record.removalProgress = [];
    await persistTransaction(state);
  }
  const assertRestoreRoots = async () => {
    const currentSourceState = await pathState(record.physicalPath);
    if (!currentSourceState?.isDirectory()
      || currentSourceState.isSymbolicLink()
      || (currentSourceState.mode & 0o777)
        !== record.restoreCopySourceManifest?.[0]?.mode
      || !sameFileIdentity(fileIdentity(currentSourceState), record.restoreIdentity)) {
      throw migrationError(
        `Legacy source restoration reservation changed: ${record.path}`,
        "CONCURRENT_CHANGE",
      );
    }
    await inspectSourceBackup(record);
  };
  const ledger = sourceRestoreCopyLedger(record);
  await copyDirectoryContentsWithLedger(
    backup.payloadPath,
    record.physicalPath,
    {
      record: ledger,
      persist: () => persistTransaction(state),
      beforeMutation: assertRestoreRoots,
      afterEntry,
      authenticateTargetEvidence: () => inspectSourceBackup(record),
      createTargetEvidence: ({
        sourceEntry,
        index,
        target,
        targetEntry,
      }) => createSourceRestoreEntryEvidence(
        record,
        sourceEntry,
        index,
        target,
        targetEntry,
      ),
      label: "Legacy source restore",
    },
  );
  sourceState = await pathState(record.physicalPath);
  if (!(await sourceMatchesRecordedState(record, sourceState))) {
    throw migrationError(`Legacy source restoration verification failed: ${record.path}`, "CONCURRENT_CHANGE");
  }
  await inspectSourceBackup(record);
  record.phase = "restored";
}

async function rollbackRemovedSource(
  state,
  record,
  {
    retainBackup = false,
    afterRestoreEntry = null,
    afterRestoreReservation = null,
    assertSourceCurrent = null,
  } = {},
) {
  if (record.phase === "pending"
    && record.backupIdentity === null
    && record.backupMode === null
    && record.backupPayloadIdentity === null
    && record.restoreIdentity === null
    && record.cleanupPath === null
    && !(await pathState(record.backup))
    && record.cleanupIdentity === null
    && record.cleanupMode === null) {
    record.phase = "restored";
    return;
  }
  await assertStoredDirectoryAnchor(
    record.ownerRoot,
    sourceOwnerAnchor(record),
    "Legacy source owner",
  );
  if (assertSourceCurrent && !retainBackup) await assertSourceCurrent();
  const unboundBackupState = record.backupIdentity === null
    ? await pathState(record.backup)
    : null;
  if (unboundBackupState) {
    throw migrationError(
      `Unauthenticated migration backup reservation retained: ${record.backup}`,
      "CONCURRENT_CHANGE",
    );
  }
  const sourceState = await pathState(record.physicalPath);
  const sourceMatches = await sourceMatchesRecordedState(record, sourceState);
  if (record.copyRoot !== null) {
    if (sourceMatches && retainBackup) return;
    if (!sourceMatches) {
      throw migrationError(
        `Legacy source changed while its backup copy was incomplete: ${record.path}`,
        "CONCURRENT_CHANGE",
      );
    }
    let backupState = await pathState(record.backup);
    if (record.backupProofPhase !== "removed"
      && (!backupState?.isDirectory()
        || backupState.isSymbolicLink()
        || (backupState.mode & 0o777) !== record.backupMode
        || !sameFileIdentity(fileIdentity(backupState), record.backupIdentity))) {
      throw migrationError(`Migration backup reservation changed: ${record.backup}`, "CONCURRENT_CHANGE");
    }
    const resumesRemoval = record.removalMode === "backup"
      && record.removalRoot === record.copyRoot
      && record.removalManifest !== null;
    if (record.backupProofPhase === "copying") {
      await authenticateSourceBackupCopyProvenance(
        state,
        record,
        { allowRemovedTargets: resumesRemoval },
      );
      if (!resumesRemoval) {
        record.copyTargetManifest = await reconcileCopyTargetManifest(
          record.copyRoot,
          record.copyTargetManifest,
          record.copySourceManifest,
          record.copyIntent,
          "Partial migration backup",
        );
        if (record.copyTargetManifest.length > 0) {
          record.removalMode = "backup";
          record.removalRoot = record.copyRoot;
          record.removalManifest = record.copyTargetManifest;
          record.removalProgress = [];
          await persistTransaction(state);
        }
      }
      const assertPartialBackupRemovalCurrent = async () => {
        if (assertSourceCurrent) await assertSourceCurrent();
        await authenticateSourceBackupCopyProvenance(
          state,
          record,
          { allowRemovedTargets: true },
        );
        if (assertSourceCurrent) await assertSourceCurrent();
        assertDirectoryIdentitySync(
          record.backup,
          record.backupIdentity,
          "Migration backup reservation",
          record.backupMode,
        );
      };
      if (record.removalManifest !== null) {
        await removeProvenDirectoryTree(record.copyRoot, {
          expectedIdentity: record.removalManifest[0].identity,
          label: "Partial migration backup",
          removalManifest: record.removalManifest,
          removalProgress: record.removalProgress,
          assertBoundary: assertPartialBackupRemovalCurrent,
          beforeRemovalMutation: assertPartialBackupRemovalCurrent,
          persistRemovalProgress: async (progress) => {
            record.removalProgress = progress;
            await persistTransaction(state);
          },
        });
      } else if (await pathState(record.copyRoot)) {
        throw migrationError(
          `Partial migration backup root has no ownership proof: ${record.copyRoot}`,
          "CONCURRENT_CHANGE",
        );
      }
      await cleanupPartialSourceBackupProof(state, record, { assertSourceCurrent });
    } else if (record.backupProofPhase === "cleaning") {
      await cleanupPartialSourceBackupProof(state, record, { assertSourceCurrent });
    } else if (record.backupProofPhase === "pending") {
      if (await pathState(record.copyRoot)) {
        throw migrationError(
          `Unauthenticated partial migration backup retained: ${record.copyRoot}`,
          "CONCURRENT_CHANGE",
        );
      }
    } else if (record.backupProofPhase !== "removed") {
      throw migrationError(
        `Partial migration backup proof phase is invalid: ${record.backupProofPhase}`,
        "CONCURRENT_CHANGE",
      );
    }
    if (assertSourceCurrent) await assertSourceCurrent();
    backupState = await pathState(record.backup);
    if (backupState) {
      if (assertSourceCurrent) await assertSourceCurrent();
      assertDirectoryIdentitySync(
        record.backup,
        record.backupIdentity,
        "Migration backup reservation",
        record.backupMode,
      );
      if (readdirSync(record.backup).length !== 0) {
        throw migrationError(`Migration backup reservation gained opaque state: ${record.backup}`, "CONCURRENT_CHANGE");
      }
      rmdirSync(record.backup);
      if (pathStateSync(record.backup)) {
        throw migrationError(`Migration backup reservation was replaced during removal: ${record.backup}`, "CONCURRENT_CHANGE");
      }
    }
    record.copyRoot = null;
    record.copySourceRoot = null;
    record.copySourceManifest = null;
    record.copyTargetManifest = null;
    record.copyIntent = null;
    record.removalMode = null;
    record.removalRoot = null;
    record.removalManifest = null;
    record.removalProgress = [];
    record.backupIdentity = null;
    record.backupMode = null;
    record.phase = "restored";
    await persistTransaction(state);
    return;
  }
  if (sourceMatches
    && record.backupIdentity === null
    && record.backupMode === null
    && record.backupProofPhase === "pending"
    && record.cleanupPath === null
    && record.cleanupIdentity === null
    && record.cleanupMode === null) {
    record.phase = "restored";
    return;
  }
  const backup = await inspectSourceBackup(record, { allowEmpty: true });
  if (sourceMatches && !backup) {
    await cleanupSourceBackup(state, record, { assertSourceCurrent });
    record.phase = "restored";
    return;
  }
  if (sourceMatches && backup) {
    if (!retainBackup) {
      await cleanupSourceBackup(state, record, { assertSourceCurrent });
    }
    record.phase = "restored";
    return;
  }
  if (sourceState && !(record.restoreIdentity
    && sameFileIdentity(fileIdentity(sourceState), record.restoreIdentity))) {
    throw migrationError(
      `Newer legacy source preserved; backup retained at ${record.backup}.`,
      "CONCURRENT_CHANGE",
    );
  }
  if (!backup?.payloadPath) {
    throw migrationError(`Legacy source and migration backup are both missing: ${record.path}`, "CONCURRENT_CHANGE");
  }
  await restoreSourceBackupWithoutReplace(
    state,
    record,
    backup,
    {
      retainBackup,
      afterEntry: afterRestoreEntry,
      afterReservation: afterRestoreReservation,
    },
  );
}

function configRemovalQuarantinePath(path) {
  return `${path}.sdd-remove`;
}
function configSourceForHash(write, expectedHash) {
  if (expectedHash === write.nextHash) return write.nextSource;
  if (expectedHash === (write.authenticatedOriginalHash ?? write.originalHash)) {
    return write.authenticatedOriginalSource ?? write.originalSource;
  }
  return null;
}


async function inspectConfigReplacementFile(write, path, expectedHash, label) {
  if (path === null) return null;
  const quarantinePath = configRemovalQuarantinePath(path);
  if (resolve(dirname(path)) !== resolve(dirname(write.path))
    || !(await isPathPhysicallyInside(write.ownerAnchor.physicalPath, path))
    || !(await isPathPhysicallyInside(write.ownerAnchor.physicalPath, quarantinePath))) {
    throw migrationError(`${label} escapes its configuration owner: ${path}`, "UNSAFE_CONFIG_PATH");
  }
  const [state, quarantineState] = await Promise.all([
    pathState(path),
    pathState(quarantinePath),
  ]);
  if (!state && !quarantineState) return null;
  const expectedSource = configSourceForHash(write, expectedHash);
  if (expectedSource === null) {
    throw migrationError(`${label} lacks exact journal bytes.`, "CONCURRENT_CHANGE");
  }
  for (const [candidate, candidateState] of [
    [path, state],
    [quarantinePath, quarantineState],
  ]) {
    if (!candidateState) continue;
    const source = candidateState.isFile() && !candidateState.isSymbolicLink()
      ? await readFile(candidate, "utf8").catch(() => null)
      : null;
    const reboundState = await pathState(candidate);
    if (!reboundState
      || !sameFileIdentity(fileIdentity(candidateState), fileIdentity(reboundState))
      || (reboundState.mode & 0o777) !== write.originalMode
      || source !== expectedSource
      || sourceHash(source ?? "") !== expectedHash) {
      throw migrationError(`${label} changed before recovery: ${candidate}`, "CONCURRENT_CHANGE");
    }
  }
  if (state && quarantineState
    && !sameFileIdentity(fileIdentity(state), fileIdentity(quarantineState))) {
    throw migrationError(`${label} cleanup quarantine has conflicting ownership.`, "CONCURRENT_CHANGE");
  }
  return state ?? quarantineState;
}

async function removeConfigReplacementFiles(
  write,
  temporaryState,
  backupState,
  assertSourceCurrent = null,
) {
  const originalHash = write.authenticatedOriginalHash ?? write.originalHash;
  const nextHash = write.authenticatedNextHash ?? write.nextHash;
  const restoring = ["restoring", "restored"].includes(write.phase);
  const assertBoundary = async () => {
    if (assertSourceCurrent) await assertSourceCurrent();
    return assertStoredDirectoryAnchor(
      write.ownerRoot,
      write.ownerAnchor,
      "Configuration owner",
    );
  };
  if (temporaryState) {
    await removeProvenFile(write.replacementTemporary, {
      expectedIdentity: fileIdentity(temporaryState),
      expectedHash: restoring ? originalHash : nextHash,
      expectedMode: write.originalMode,
      expectedSource: configSourceForHash(write, restoring ? originalHash : nextHash),
      quarantineParent: dirname(write.path),
      quarantinePath: configRemovalQuarantinePath(write.replacementTemporary),
      label: "Configuration replacement temporary",
      assertBoundary,
    });
  }
  if (backupState) {
    await removeProvenFile(write.replacementBackup, {
      expectedIdentity: fileIdentity(backupState),
      expectedHash: restoring ? nextHash : originalHash,
      expectedMode: write.originalMode,
      expectedSource: configSourceForHash(write, restoring ? nextHash : originalHash),
      quarantineParent: dirname(write.path),
      quarantinePath: configRemovalQuarantinePath(write.replacementBackup),
      label: "Configuration replacement backup",
      assertBoundary,
    });
  }
}

async function inspectConfigOwnershipProof(write, path, expectedHash, authenticated, label) {
  if (!authenticated) return null;
  return inspectConfigReplacementFile(write, path, expectedHash, label);
}

async function removeObservedConfigProofPath(
  write,
  path,
  expectedIdentity,
  expectedHash,
  label,
  assertConfigCurrent = null,
) {
  const assertBoundary = async () => {
    await assertStoredDirectoryAnchor(write.ownerRoot, write.ownerAnchor, "Configuration owner");
    if (!(await isPathPhysicallyInside(write.ownerAnchor.physicalPath, path))) {
      throw migrationError(`${label} escapes its configuration owner: ${path}`, "UNSAFE_CONFIG_PATH");
    }
    if (write.phase === "verified") {
      await assertPublishedConfigHash(write);
    } else {
      await assertRestoredConfigHash(write);
    }
    if (assertConfigCurrent) await assertConfigCurrent();
    return true;
  };
  await assertBoundary();
  const removed = await removeProvenFile(path, {
    expectedIdentity,
    expectedHash,
    expectedMode: write.originalMode,
    expectedSource: configSourceForHash(write, expectedHash),
    quarantineParent: dirname(path),
    quarantinePath: configRemovalQuarantinePath(path),
    label,
    assertBoundary,
  });
  if (!removed) {
    throw migrationError(`${label} disappeared before cleanup.`, "CONCURRENT_CHANGE");
  }
}

async function quarantineAndRemoveConfigProof(
  write,
  proofPath,
  cleanupPathProperty,
  cleanupIdentityProperty,
  authenticatedProperty,
  expectedHash,
  label,
  persist,
  afterCleanupLink = null,
  assertConfigCurrent = null,
) {
  if (!write[authenticatedProperty]) return;
  if (assertConfigCurrent) await assertConfigCurrent();
  let proofState = await inspectConfigReplacementFile(write, proofPath, expectedHash, label);
  let cleanupPath = write[cleanupPathProperty];
  if (cleanupPath === null) {
    cleanupPath = join(
      dirname(proofPath),
      `${basename(proofPath)}-cleanup-${process.pid}-${randomUUID()}`,
    );
    write[cleanupPathProperty] = cleanupPath;
    write[cleanupIdentityProperty] = null;
    if (persist) await persist();
  }
  let cleanupState = await inspectConfigReplacementFile(
    write,
    cleanupPath,
    expectedHash,
    `${label} cleanup`,
  );
  if (!cleanupState) {
    if (!proofState) {
      throw migrationError(`${label} disappeared before cleanup.`, "CONCURRENT_CHANGE");
    }
    if (assertConfigCurrent) await assertConfigCurrent();
    await link(proofPath, cleanupPath);
    if (afterCleanupLink) {
      await afterCleanupLink({ write, proofPath, cleanupPath, label });
    }
    cleanupState = await inspectConfigReplacementFile(
      write,
      cleanupPath,
      expectedHash,
      `${label} cleanup`,
    );
  }
  const expectedIdentity = proofState
    ? fileIdentity(proofState)
    : write[cleanupIdentityProperty];
  if (!cleanupState
    || expectedIdentity === null
    || !sameFileIdentity(fileIdentity(cleanupState), expectedIdentity)
    || (write[cleanupIdentityProperty] !== null
      && !sameFileIdentity(write[cleanupIdentityProperty], expectedIdentity))) {
    throw migrationError(`${label} could not be bound to cleanup ownership.`, "CONCURRENT_CHANGE");
  }
  if (write[cleanupIdentityProperty] === null) {
    write[cleanupIdentityProperty] = expectedIdentity;
    if (persist) await persist();
  }
  proofState = await inspectConfigReplacementFile(write, proofPath, expectedHash, label);
  if (proofState) {
    await removeObservedConfigProofPath(
      write,
      proofPath,
      expectedIdentity,
      expectedHash,
      label,
      assertConfigCurrent,
    );
  }
  await removeObservedConfigProofPath(
    write,
    cleanupPath,
    expectedIdentity,
    expectedHash,
    `${label} cleanup`,
    assertConfigCurrent,
  );
  write[cleanupPathProperty] = null;
  write[cleanupIdentityProperty] = null;
  write[authenticatedProperty] = false;
  if (assertConfigCurrent) await assertConfigCurrent();
  if (persist) await persist();
  if (assertConfigCurrent) await assertConfigCurrent();
}

async function removeConfigOwnershipProofs(
  write,
  _originalProofState,
  _nextProofState,
  persist = null,
  afterCleanupLink = null,
  assertConfigCurrent = null,
) {
  if (!["verified", "restoring", "restored"].includes(write.phase)) {
    throw migrationError(
      `Configuration proof cleanup has no durable phase barrier: ${write.path}`,
      "CONCURRENT_CHANGE",
    );
  }
  if (write.proofPhase === "removed") return;
  if (assertConfigCurrent) await assertConfigCurrent();
  write.proofPhase = "cleaning";
  if (persist) await persist();
  await quarantineAndRemoveConfigProof(
    write,
    write.originalProofPath,
    "originalProofCleanupPath",
    "originalProofCleanupIdentity",
    "originalProofAuthenticated",
    write.authenticatedOriginalHash ?? write.originalHash,
    "Original configuration proof",
    persist,
    afterCleanupLink,
    assertConfigCurrent,
  );
  await quarantineAndRemoveConfigProof(
    write,
    write.nextProofPath,
    "nextProofCleanupPath",
    "nextProofCleanupIdentity",
    "nextProofAuthenticated",
    write.authenticatedNextHash ?? write.nextHash,
    "Published configuration proof",
    persist,
    afterCleanupLink,
    assertConfigCurrent,
  );
  if (assertConfigCurrent) await assertConfigCurrent();
  write.proofPhase = "removed";
  if (persist) await persist();
  if (assertConfigCurrent) await assertConfigCurrent();
}

async function assertConfigHash(write, expectedHash, expectedSource, label) {
  await assertStoredDirectoryAnchor(write.ownerRoot, write.ownerAnchor, "Configuration owner");
  if (!(await isPathPhysicallyInside(write.ownerAnchor.physicalPath, write.path))) {
    throw migrationError(`Configuration path escapes its owner: ${write.path}`, "UNSAFE_CONFIG_PATH");
  }
  let current;
  try {
    current = await readBoundRegularFile(write.path, {
      ownerRoot: write.ownerRoot,
      expectedHash,
      expectedOwnerBinding: write.originalOwnerBinding,
      label,
      unsafeCode: "CONCURRENT_CHANGE",
    });
  } catch (error) {
    throw migrationError(`${label} changed: ${write.path}`, "CONCURRENT_CHANGE", [error.message]);
  }
  if (current.source !== expectedSource || current.mode !== write.originalMode) {
    throw migrationError(`${label} changed: ${write.path}`, "CONCURRENT_CHANGE");
  }
  return current;
}

async function assertPublishedConfigHash(write) {
  const current = await assertConfigHash(
    write,
    write.nextHash,
    write.nextSource,
    "Published configuration",
  );
  if (write.phase === "verified"
    && ["cleaning", "removed"].includes(write.proofPhase)
    && (write.nextProofIntentIdentity === null
      || !sameFileIdentity(current.identity, write.nextProofIntentIdentity))) {
    throw migrationError(
      `Published configuration changed physical identity: ${write.path}`,
      "CONCURRENT_CHANGE",
    );
  }
  return current;
}

async function assertRestoredConfigHash(write) {
  return assertConfigHash(
    write,
    write.authenticatedOriginalHash ?? write.originalHash,
    write.authenticatedOriginalSource ?? write.originalSource,
    "Restored configuration",
  );
}

function restoredConfigIdentityBarrier(write, expectedIdentity) {
  return async () => {
    const current = await assertRestoredConfigHash(write);
    if (!sameFileIdentity(current.identity, expectedIdentity)) {
      throw migrationError(
        `Restored configuration changed physical identity: ${write.path}`,
        "CONCURRENT_CHANGE",
      );
    }
  };
}

async function bindRestoredConfigIdentity(write, identity, persist) {
  if (write.restoredIdentity === null) {
    write.restoredIdentity = identity;
    if (persist) await persist();
  } else if (!sameFileIdentity(write.restoredIdentity, identity)) {
    throw migrationError(
      `Restored configuration changed physical identity: ${write.path}`,
      "CONCURRENT_CHANGE",
    );
  }
  const barrier = restoredConfigIdentityBarrier(write, write.restoredIdentity);
  await barrier();
  return barrier;
}

function configRollbackBarrier(assertSourceCurrent, assertConfigIdentity) {
  return async () => {
    if (assertSourceCurrent) await assertSourceCurrent();
    await assertConfigIdentity();
  };
}

async function assertPublishedConfigProof(write) {
  await assertPublishedConfigHash(write);
  await assertStoredDirectoryAnchor(write.ownerRoot, write.ownerAnchor, "Configuration owner");
  if (!(await isPathPhysicallyInside(write.ownerAnchor.physicalPath, write.path))) {
    throw migrationError(`Configuration path escapes its owner: ${write.path}`, "UNSAFE_CONFIG_PATH");
  }
  const proofState = await inspectConfigOwnershipProof(
    write,
    write.nextProofPath,
    write.authenticatedNextHash ?? write.nextHash,
    write.nextProofAuthenticated,
    "Published configuration proof",
  );
  const currentState = await pathState(write.path);
  const currentHash = currentState?.isFile() && !currentState.isSymbolicLink()
    ? await hashFile(write.path).catch(() => null)
    : null;
  const expectedHash = write.authenticatedNextHash ?? write.nextHash;
  if (!proofState || !currentState?.isFile() || currentState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(currentState), fileIdentity(proofState))
    || currentHash !== expectedHash) {
    throw migrationError(
      `Published configuration ownership changed: ${write.path}`,
      "CONCURRENT_CHANGE",
      [
        `Proof present: ${Boolean(proofState)}`,
        `Current identity: ${currentState?.isFile() && !currentState.isSymbolicLink() ? JSON.stringify(fileIdentity(currentState)) : "unavailable"}`,
        `Proof identity: ${proofState ? JSON.stringify(fileIdentity(proofState)) : "unavailable"}`,
        `Expected hash: ${expectedHash}`,
        `Current hash: ${currentHash ?? "unavailable"}`,
      ],
    );
  }
  await assertPublishedConfigHash(write);
  return { currentState, proofState };
}

async function captureTransactionWorkspaceConfigSnapshot(state) {
  const workspaceRoot = resolve(state.destinationWorkspaceRoot);
  const configPath = resolve(getConfigPath(workspaceRoot));
  const write = state.writtenConfigs.find(
    (record) => resolve(record.path) === configPath,
  );
  const guard = state.readGuards.find(
    (record) =>
      record.kind === "workspace-config"
      && resolve(record.ownerRoot) === workspaceRoot
      && resolve(record.path) === configPath,
  );
  const snapshot = await readWorkspaceConfigSnapshot(workspaceRoot);

  if (write) {
    const verifySnapshot = async () => {
      const { currentState, proofState } = await assertPublishedConfigProof(write);
      if (
        !sameFileIdentity(snapshot.identity, fileIdentity(currentState))
        || !sameFileIdentity(snapshot.identity, fileIdentity(proofState))
        || snapshot.source !== write.nextSource
        || sourceHash(snapshot.source) !== (write.authenticatedNextHash ?? write.nextHash)
      ) {
        throw migrationError(
          `Published workspace configuration identity changed: ${configPath}`,
          "CONCURRENT_CHANGE",
        );
      }
    };
    await verifySnapshot();
    await assertWorkspaceConfigSnapshotCurrent(workspaceRoot, snapshot);
    await verifySnapshot();
    return snapshot;
  }

  if (!guard) {
    throw migrationError(
      `Workspace configuration has no transaction authority guard: ${configPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  await assertReadGuardCurrent(guard);
  if (
    !sameFileIdentity(snapshot.identity, guard.identity)
    || snapshot.source !== guard.source
    || sourceHash(snapshot.source) !== guard.hash
  ) {
    throw migrationError(
      `Workspace configuration identity changed before transaction handoff: ${configPath}`,
      "CONCURRENT_CHANGE",
    );
  }
  await assertWorkspaceConfigSnapshotCurrent(workspaceRoot, snapshot);
  await assertReadGuardCurrent(guard);
  return snapshot;
}


async function cleanupCommittedConfigProofs(state) {
  if (state.status !== "committed"
    || state.sourceDerivedDestinationGuards === null
    || state.removedSources.some((record) => record.phase !== "cleaned")
    || state.writtenConfigs.some((record) => record.phase !== "verified")) {
    throw migrationError(
      "Configuration proof cleanup is not backed by a committed publication barrier.",
      "CONCURRENT_CHANGE",
    );
  }
  for (const write of state.writtenConfigs) {
    if (write.proofPhase === "removed") {
      await assertPublishedConfigHash(write);
      if (write.authenticatedNextHash !== write.nextHash) {
        throw migrationError(
          `Removed configuration proof has no authenticated completion authority: ${write.path}`,
          "CONCURRENT_CHANGE",
        );
      }
      continue;
    }
    if (write.proofPhase === "present") {
      await assertPublishedConfigProof(write);
    } else if (write.proofPhase !== "cleaning") {
      throw migrationError(`Configuration ownership proof phase is incomplete: ${write.path}`, "CONCURRENT_CHANGE");
    } else {
      await assertPublishedConfigHash(write);
      if (write.authenticatedNextHash !== write.nextHash) {
        throw migrationError(
          `Configuration proof cleanup has no authenticated publication authority: ${write.path}`,
          "CONCURRENT_CHANGE",
        );
      }
    }
    const originalProofState = await inspectConfigOwnershipProof(
      write,
      write.originalProofPath,
      write.authenticatedOriginalHash ?? write.originalHash,
      write.originalProofAuthenticated,
      "Original configuration proof",
    );
    const nextProofState = await inspectConfigOwnershipProof(
      write,
      write.nextProofPath,
      write.authenticatedNextHash ?? write.nextHash,
      write.nextProofAuthenticated,
      "Published configuration proof",
    );
    if (write.proofPhase === "present" && (!originalProofState || !nextProofState)) {
      throw migrationError(`Configuration ownership proof is incomplete: ${write.path}`, "CONCURRENT_CHANGE");
    }
    await removeConfigOwnershipProofs(
      write,
      originalProofState,
      nextProofState,
      () => persistTransaction(state),
      state.afterConfigProofCleanupLink,
      async () => {
        if (write.proofPhase === "present") {
          await assertPublishedConfigProof(write);
        } else {
          await assertPublishedConfigHash(write);
        }
      },
    );
  }
}

async function rollbackConfigWrite(
  write,
  {
    persist = null,
    afterBackup = null,
    afterProofCleanupLink = null,
    assertSourceCurrent = null,
  } = {},
) {
  if (assertSourceCurrent) await assertSourceCurrent();
  await assertStoredDirectoryAnchor(write.ownerRoot, write.ownerAnchor, "Configuration owner");
  if (!(await isPathPhysicallyInside(write.ownerAnchor.physicalPath, write.path))) {
    throw migrationError(`Configuration path escapes its owner: ${write.path}`, "UNSAFE_CONFIG_PATH");
  }
  let originalHash = write.authenticatedOriginalHash ?? write.originalHash;
  const nextHash = write.authenticatedNextHash ?? write.nextHash;
  const currentState = await pathState(write.path);
  const currentHash = currentState?.isFile() && !currentState.isSymbolicLink()
    ? await hashFile(write.path).catch(() => null)
    : null;
  if (write.phase === "unchanged" && currentHash !== null) {
    const proofPath = write.originalProofLocation ?? write.originalProofPath;
    const [proofState, currentSource] = await Promise.all([
      pathState(proofPath),
      readFile(write.path, "utf8").catch(() => null),
    ]);
    const reboundState = await pathState(write.path);
    if (proofState?.isFile() && !proofState.isSymbolicLink()
      && reboundState?.isFile() && !reboundState.isSymbolicLink()
      && sameFileIdentity(fileIdentity(reboundState), fileIdentity(currentState))
      && sameFileIdentity(fileIdentity(proofState), fileIdentity(reboundState))
      && currentSource !== null
      && sourceHash(currentSource) === currentHash
      && await hashFile(proofPath).catch(() => null) === currentHash) {
      originalHash = currentHash;
      write.originalProofAuthenticated = true;
      write.authenticatedOriginalSource = currentSource;
      write.authenticatedOriginalHash = currentHash;
    }
  }
  const originalProofState = await inspectConfigOwnershipProof(
    write,
    write.originalProofLocation ?? write.originalProofPath,
    originalHash,
    write.originalProofAuthenticated,
    "Original configuration proof",
  );
  const nextProofState = await inspectConfigOwnershipProof(
    write,
    write.nextProofLocation ?? write.nextProofPath,
    nextHash,
    write.nextProofAuthenticated,
    "Published configuration proof",
  );
  const restoring = ["restoring", "restored"].includes(write.phase);
  const temporaryState = await inspectConfigReplacementFile(
    write,
    write.replacementTemporary,
    restoring ? originalHash : nextHash,
    "Configuration replacement temporary",
  );
  const backupState = await inspectConfigReplacementFile(
    write,
    write.replacementBackup,
    restoring ? nextHash : originalHash,
    "Configuration replacement backup",
  );
  if (write.phase === "unchanged"
    && currentState?.isFile()
    && !currentState.isSymbolicLink()
    && !nextProofState) {
    write.phase = "restoring";
    if (persist) await persist();
    const restoredConfig = await assertRestoredConfigHash(write);
    const assertConfigCurrent = configRollbackBarrier(
      assertSourceCurrent,
      await bindRestoredConfigIdentity(write, restoredConfig.identity, persist),
    );
    await removeConfigReplacementFiles(write, temporaryState, backupState, assertSourceCurrent);
    await removeConfigOwnershipProofs(
      write,
      originalProofState,
      nextProofState,
      persist,
      afterProofCleanupLink,
      assertConfigCurrent,
    );
    write.phase = "restored";
    return;
  }
  if (currentHash === originalHash) {
    if (write.phase !== "restoring") {
      write.phase = "restoring";
      if (persist) await persist();
    }
    const restoredConfig = await assertRestoredConfigHash(write);
    const assertConfigCurrent = configRollbackBarrier(
      assertSourceCurrent,
      await bindRestoredConfigIdentity(write, restoredConfig.identity, persist),
    );
    await removeConfigReplacementFiles(write, temporaryState, backupState, assertSourceCurrent);
    await removeConfigOwnershipProofs(
      write,
      originalProofState,
      nextProofState,
      persist,
      afterProofCleanupLink,
      assertConfigCurrent,
    );
    write.phase = "restored";
    return;
  }
  if (!currentState) {
    const ownsBackup = backupState && (
      originalProofState
        && sameFileIdentity(fileIdentity(backupState), fileIdentity(originalProofState))
      || nextProofState
        && sameFileIdentity(fileIdentity(backupState), fileIdentity(nextProofState))
    );
    if (!originalProofState || !ownsBackup) {
      throw migrationError(`Configuration recovery source is unavailable: ${write.path}.`, "CONCURRENT_CHANGE");
    }
    await link(write.originalProofPath, write.path);
    const restoredState = await pathState(write.path);
    if (!restoredState?.isFile() || restoredState.isSymbolicLink()
      || !sameFileIdentity(fileIdentity(restoredState), fileIdentity(originalProofState))) {
      throw migrationError(`Configuration rollback verification failed: ${write.path}`, "CONCURRENT_CHANGE");
    }
    write.phase = "restoring";
    if (persist) await persist();
    const restoredConfig = await assertRestoredConfigHash(write);
    const assertConfigCurrent = configRollbackBarrier(
      assertSourceCurrent,
      await bindRestoredConfigIdentity(write, restoredConfig.identity, persist),
    );
    await removeConfigReplacementFiles(write, temporaryState, backupState, assertSourceCurrent);
    await removeConfigOwnershipProofs(
      write,
      originalProofState,
      nextProofState,
      persist,
      afterProofCleanupLink,
      assertConfigCurrent,
    );
    write.phase = "restored";
    return;
  }
  const ownsPublishedConfig = currentState.isFile()
    && !currentState.isSymbolicLink()
    && nextProofState
    && sameFileIdentity(fileIdentity(currentState), fileIdentity(nextProofState))
    && currentHash === nextHash;
  if (!ownsPublishedConfig) {
    if (["pending", "prepared", "unchanged"].includes(write.phase) && !nextProofState) {
      throw migrationError(
        `Newer configuration cannot be detached from retained ownership proofs: ${write.path}.`,
        "CONCURRENT_CHANGE",
      );
    }
    throw migrationError(`Newer configuration preserved: ${write.path}.`, "CONCURRENT_CHANGE");
  }
  if (!originalProofState) {
    throw migrationError(`Configuration recovery source is unavailable: ${write.path}.`, "CONCURRENT_CHANGE");
  }
  await assertPublishedConfigHash(write);
  await removeConfigReplacementFiles(write, temporaryState, backupState, assertSourceCurrent);
  await replaceFileAtomically(write.originalProofPath, write.path, {
    expectedHash: nextHash,
    ownerRoot: write.ownerRoot,
    expectedSnapshot: {
      source: write.nextSource,
      identity: fileIdentity(currentState),
      mode: write.originalMode,
      ownerBinding: write.originalOwnerBinding,
    },
    beforeReplace: async (replacement) => {
      write.phase = "restoring";
      write.replacementTemporary = replacement.temporary;
      write.replacementBackup = replacement.backup;
      if (persist) await persist();
      if (assertSourceCurrent) await assertSourceCurrent();
    },
    afterBackup: async (replacement) => {
      if (afterBackup) await afterBackup(replacement);
      if (assertSourceCurrent) await assertSourceCurrent();
    },
  });
  const restoredConfig = await assertRestoredConfigHash(write);
  const assertConfigCurrent = configRollbackBarrier(
    assertSourceCurrent,
    await bindRestoredConfigIdentity(write, restoredConfig.identity, persist),
  );
  await removeConfigOwnershipProofs(
    write,
    originalProofState,
    nextProofState,
    persist,
    afterProofCleanupLink,
    assertConfigCurrent,
  );
  write.phase = "restored";
}

async function rollbackBrief(
  brief,
  {
    persist = null,
    afterVerification = null,
    assertSourceCurrent = null,
  } = {},
) {
  const assertOwnerBoundary = async () => {
    await assertStoredDirectoryAnchor(brief.ownerRoot, brief.ownerAnchor, "Change Brief owner");
    if (!(await isPathPhysicallyInside(brief.ownerAnchor.physicalPath, brief.destination))) {
      throw migrationError(`Change Brief destination escapes its owner: ${brief.destination}`, "UNSAFE_ARTIFACT_PATH");
    }
    if (assertSourceCurrent) await assertSourceCurrent();
    return true;
  };
  const assertProofRetirementBoundary = async () => {
    if (assertSourceCurrent) await assertSourceCurrent();
    if (await pathState(brief.destination)) {
      throw migrationError(
        `Rolled-back Change Brief destination reappeared: ${brief.destination}`,
        "CONCURRENT_CHANGE",
      );
    }
  };
  await assertOwnerBoundary();

  if (brief.phase === "pending") {
    const evidence = await inspectBriefPublicationProofs(brief);
    if (evidence.primary || evidence.cleanup || await pathState(brief.destination)) {
      throw migrationError(
        `Pending Change Brief has opaque publication state: ${brief.destination}`,
        "CONCURRENT_CHANGE",
      );
    }
    return;
  }
  if (brief.phase === "prepared") {
    const adopted = await adoptPreparedBriefPublication(brief);
    if (!adopted) return;
    if (persist) await persist();
  }
  if (brief.phase === "removed") {
    await assertProofRetirementBoundary();
    await removeBriefPublicationProof(
      brief,
      persist,
      assertProofRetirementBoundary,
      assertProofRetirementBoundary,
    );
    await assertProofRetirementBoundary();
    return;
  }
  if (brief.publicationProofPhase !== "present") {
    throw migrationError(
      `Change Brief publication proof is unavailable for rollback: ${brief.destination}`,
      "CONCURRENT_CHANGE",
    );
  }

  const evidence = await inspectBriefPublicationProofs(brief);
  const identity = await assertBriefProofMatchesRecord(brief, evidence);
  if (!evidence.primary || evidence.cleanup) {
    throw migrationError(
      `Change Brief publication proof is incomplete for rollback: ${brief.destination}`,
      "CONCURRENT_CHANGE",
    );
  }
  const destinationState = await pathState(brief.destination);
  if (brief.phase === "removing" && !destinationState) {
    brief.phase = "removed";
    if (persist) await persist();
    await removeBriefPublicationProof(
      brief,
      persist,
      assertProofRetirementBoundary,
      assertProofRetirementBoundary,
    );
    return;
  }
  await assertBriefDestinationMatchesProof(brief, identity);
  if (brief.phase !== "removing") {
    brief.phase = "removing";
    if (persist) await persist();
  }
  await removeProvenFile(brief.destination, {
    expectedIdentity: identity,
    expectedHash: brief.hash,
    quarantineParent: dirname(brief.destination),
    label: "Published Change Brief",
    afterVerification: afterVerification
      ? () => afterVerification({ brief, destination: brief.destination })
      : null,
    assertBoundary: assertOwnerBoundary,
    beforeRemovalMutation: assertSourceCurrent
      ? () => assertSourceCurrent()
      : null,
  });
  brief.phase = "removed";
  if (persist) await persist();
  await removeBriefPublicationProof(
    brief,
    persist,
    assertProofRetirementBoundary,
    assertProofRetirementBoundary,
  );
}

async function readChangeReservationEvidence(state, path, label) {
  const evidenceState = await pathState(path);
  if (!evidenceState?.isFile() || evidenceState.isSymbolicLink()) {
    throw migrationError(`${label} is missing or changed: ${path}`, "CONCURRENT_CHANGE");
  }
  let evidence;
  try {
    evidence = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw migrationError(`${label} cannot be read: ${path}`, "CONCURRENT_CHANGE", [error.message]);
  }
  requireJournalIdentity(
    evidence?.ownerIdentity,
    `${label}.ownerIdentity`,
    state.journalPath,
  );
  if (!sameFileIdentity(fileIdentity(evidenceState), evidence.ownerIdentity)) {
    throw migrationError(`${label} changed physical identity: ${path}`, "CONCURRENT_CHANGE");
  }
  return { evidence, state: evidenceState };
}

async function recoverUnboundChangeReservation(state, change, destinationState) {
  const isUnbound = change.phase === "staged"
    && !change.reserved
    && !change.published
    && change.reservationIdentity === null;
  const isBound = change.reserved && change.reservationIdentity !== null;
  if (isUnbound) {
    throw migrationError(`Unbound central Change reservation preserved: ${change.destination}.`, "CONCURRENT_CHANGE");
  }
  if ((!isUnbound && !isBound)
    || !destinationState.isDirectory()
    || destinationState.isSymbolicLink()
    || (await readdir(change.destination).catch(() => ["occupied"])).length !== 0) {
    throw migrationError(`Newer central Change preserved: ${change.destination}.`, "CONCURRENT_CHANGE");
  }
  await assertChangeStoreConfinement(change.destination, state.destinationWorkspaceRoot);
  const paths = changeReservationEvidencePaths(state.stagingRoot, change.ownerToken);
  const { evidence: intent, state: intentState } = await readChangeReservationEvidence(
    state,
    paths.intent,
    "Change reservation intent",
  );
  requireExactJournalKeys(
    intent,
    [
      "version",
      "target",
      "ownerToken",
      "ownerIdentity",
      "parentIdentity",
      "proofIdentity",
      "expectedCreation",
      "mutationLock",
    ],
    "Change reservation intent",
    state.journalPath,
  );
  if (intent.version !== 1
    || intent.target !== resolve(change.destination)
    || intent.ownerToken !== change.ownerToken) {
    throw migrationError(`Change reservation intent does not match its target: ${paths.intent}`, "CONCURRENT_CHANGE");
  }
  requireJournalIdentity(
    intent.parentIdentity,
    "Change reservation intent parentIdentity",
    state.journalPath,
  );
  requireJournalIdentity(
    intent.proofIdentity,
    "Change reservation intent proofIdentity",
    state.journalPath,
  );
  requireExactJournalKeys(
    intent.expectedCreation,
    ["mode", "uid", "gid", "nlink"],
    "Change reservation expectedCreation",
    state.journalPath,
  );
  if (Object.values(intent.expectedCreation).some((value) => typeof value !== "string")) {
    throw migrationError(`Change reservation creation evidence is invalid: ${paths.intent}`, "CONCURRENT_CHANGE");
  }
  const [parentState, proofState] = await Promise.all([
    pathState(dirname(change.destination)),
    pathState(change.proofPath),
  ]);
  if (!parentState?.isDirectory() || parentState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(parentState), intent.parentIdentity)
    || !proofState?.isFile() || proofState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(proofState), intent.proofIdentity)) {
    throw migrationError(`Change reservation intent lost its authenticated pre-state: ${paths.intent}`, "CONCURRENT_CHANGE");
  }

  requireExactJournalKeys(
    intent.mutationLock,
    ["path", "identity", "source", "proofPath", "proofIdentity"],
    "Change reservation mutationLock",
    state.journalPath,
  );
  requireJournalIdentity(
    intent.mutationLock.identity,
    "Change reservation mutationLock.identity",
    state.journalPath,
  );
  requireJournalIdentity(
    intent.mutationLock.proofIdentity,
    "Change reservation mutationLock.proofIdentity",
    state.journalPath,
  );
  if (!state.mutationLock
    || resolve(intent.mutationLock.path) !== resolve(state.mutationLock.path)
    || resolve(intent.mutationLock.proofPath) !== resolve(paths.lockProof)
    || typeof intent.mutationLock.source !== "string"
    || !(await observeMutationLock(state.mutationLock))) {
    throw migrationError(`Change reservation recovery lacks the live mutation lock: ${change.destination}`, "CONCURRENT_CHANGE");
  }
  const [lockProofState, lockProofSource] = await Promise.all([
    pathState(paths.lockProof),
    readFile(paths.lockProof, "utf8").catch(() => null),
  ]);
  if (!lockProofState?.isFile() || lockProofState.isSymbolicLink()
    || lockProofSource !== intent.mutationLock.source
    || !sameFileIdentity(fileIdentity(lockProofState), intent.mutationLock.identity)
    || !sameFileIdentity(fileIdentity(lockProofState), intent.mutationLock.proofIdentity)) {
    throw migrationError(`Change reservation mutation-lock proof changed: ${paths.lockProof}`, "CONCURRENT_CHANGE");
  }

  const bindingState = await pathState(paths.binding);
  if (bindingState) {
    const { evidence: binding } = await readChangeReservationEvidence(
      state,
      paths.binding,
      "Change reservation binding",
    );
    requireExactJournalKeys(
      binding,
      [
        "version",
        "target",
        "ownerToken",
        "ownerIdentity",
        "intentIdentity",
        "targetIdentity",
        "targetCreation",
      ],
      "Change reservation binding",
      state.journalPath,
    );
    requireJournalIdentity(
      binding.intentIdentity,
      "Change reservation binding.intentIdentity",
      state.journalPath,
    );
    requireJournalIdentity(
      binding.targetIdentity,
      "Change reservation binding.targetIdentity",
      state.journalPath,
    );
    requireExactJournalKeys(
      binding.targetCreation,
      ["mode", "uid", "gid", "nlink", "birthtimeMs"],
      "Change reservation binding.targetCreation",
      state.journalPath,
    );
    if (binding.version !== 1
      || binding.target !== resolve(change.destination)
      || binding.ownerToken !== change.ownerToken
      || !sameFileIdentity(binding.intentIdentity, intent.ownerIdentity)
      || !sameFileIdentity(binding.targetIdentity, fileIdentity(destinationState))
      || (isBound && !sameFileIdentity(change.reservationIdentity, binding.targetIdentity))
      || JSON.stringify(binding.targetCreation) !== JSON.stringify(reservationCreationState(destinationState))) {
      throw migrationError(`Change reservation binding does not match its target: ${paths.binding}`, "CONCURRENT_CHANGE");
    }
    change.reservationBindingIdentity = binding.ownerIdentity;
  } else {
    if (isBound) {
      throw migrationError(`Bound Change reservation lacks its identity evidence: ${paths.binding}`, "CONCURRENT_CHANGE");
    }
    const creation = reservationCreationState(destinationState);
    if (creation.mode !== intent.expectedCreation.mode
      || creation.uid !== intent.expectedCreation.uid
      || creation.gid !== intent.expectedCreation.gid
      || creation.nlink !== intent.expectedCreation.nlink
      || Number(creation.birthtimeMs) < Number(intentState.birthtimeMs)) {
      throw migrationError(`Unbound Change reservation does not match its creation intent: ${change.destination}`, "CONCURRENT_CHANGE");
    }
    change.reservationIntentIdentity = intent.ownerIdentity;
    await bindChangeReservation(state, change, destinationState);
  }
  const currentState = await pathState(change.destination);
  if (!currentState?.isDirectory()
    || currentState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(currentState), fileIdentity(destinationState))
    || (await readdir(change.destination)).length !== 0) {
    throw migrationError(`Unbound Change reservation changed during recovery: ${change.destination}`, "CONCURRENT_CHANGE");
  }
  if (isUnbound) {
    change.reservationIdentity = fileIdentity(currentState);
    change.reserved = true;
    await persistTransaction(state);
  }
}

async function partialChangeTreeMatchesStaging(
  change,
  destination,
  directory = destination,
) {
  const stagedState = await pathState(change.stagedPath);
  if (!stagedState?.isDirectory()
    || stagedState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(stagedState), change.stagedIdentity)
    || await hashDirectory(change.stagedPath).catch(() => null) !== change.canonicalHash) {
    return false;
  }
  const markerName = `.sdd-migration-owner-${change.ownerToken}`;
  const relativeDirectory = relative(destination, directory);
  const stagedDirectory = relativeDirectory
    ? join(change.stagedPath, relativeDirectory)
    : change.stagedPath;
  const stagedDirectoryState = await pathState(stagedDirectory);
  const destinationDirectoryState = await pathState(directory);
  if (!stagedDirectoryState?.isDirectory()
    || stagedDirectoryState.isSymbolicLink()
    || !destinationDirectoryState?.isDirectory()
    || destinationDirectoryState.isSymbolicLink()) {
    return false;
  }
  for (const name of await readdir(directory)) {
    if (directory === destination && name === markerName) continue;
    const destinationPath = join(directory, name);
    const stagedPath = join(stagedDirectory, name);
    const [destinationEntryState, stagedEntryState] = await Promise.all([
      pathState(destinationPath),
      pathState(stagedPath),
    ]);
    if (!destinationEntryState || !stagedEntryState) return false;
    const destinationType = removalEntryType(destinationEntryState);
    const stagedType = removalEntryType(stagedEntryState);
    if (destinationType !== stagedType) return false;
    if (destinationType === "directory") {
      if (!(await partialChangeTreeMatchesStaging(change, destination, destinationPath))) {
        return false;
      }
    } else if (!sameFileIdentity(
      fileIdentity(destinationEntryState),
      fileIdentity(stagedEntryState),
    )) {
      return false;
    }
  }
  return true;
}

function rollbackChangeEntryMatchesSource(sourceEntry, destinationEntry) {
  return sourceEntry.relativePath === destinationEntry?.relativePath
    && sourceEntry.type === destinationEntry.type
    && sourceEntry.mode === destinationEntry.mode
    && (sourceEntry.type !== "file" || sourceEntry.hash === destinationEntry.hash)
    && (sourceEntry.type !== "symlink" || sourceEntry.target === destinationEntry.target);
}

async function rebuildRollbackChangeCopyLedger(state, change) {
  if (change.copyRoot !== null
    || change.removalMode !== "staging"
    || resolve(change.removalRoot) !== resolve(change.destination)
    || change.removalManifest === null) {
    return;
  }
  const index = state.publishedChanges.indexOf(change);
  if (index < 0) {
    throw migrationError(
      `Published Change is absent from its rollback transaction: ${change.destination}`,
      "CONCURRENT_CHANGE",
    );
  }
  await hydrateChangeReservationEvidenceIdentities(
    change,
    index,
    state.stagingRoot,
    state.journalPath,
  );
  await hydrateStagedChangeIdentityEvidence(
    change,
    index,
    state.stagingRoot,
    state.journalPath,
  );
  await authenticateChangeCopyTargetProvenance(
    change,
    changeCopyProvenanceContext(state),
    "Published Change rollback provenance",
    { allowMissingTarget: true, allowMissingEntries: true },
  );

  const sourceManifest = await captureDirectoryRemovalManifest(
    change.stagedPath,
    {
      expectedIdentity: change.stagedIdentity,
      expectedHash: change.canonicalHash,
      label: "Published Change rollback source",
    },
  );
  const destinationByPath = new Map(
    change.removalManifest.map((entry) => [entry.relativePath, entry]),
  );
  if (sourceManifest.length !== change.removalManifest.length
    || sourceManifest.some((entry) => (
      !rollbackChangeEntryMatchesSource(entry, destinationByPath.get(entry.relativePath))
    ))) {
    throw migrationError(
      `Published Change removal proof does not match its authenticated staged source: ${change.destination}`,
      "CONCURRENT_CHANGE",
    );
  }

  const provenanceByToken = new Map();
  for (const provenance of change.copyTargetProvenance) {
    const entries = provenanceByToken.get(provenance.token) ?? [];
    entries.push(provenance);
    provenanceByToken.set(provenance.token, entries);
  }
  const matchingTokens = [...provenanceByToken.entries()].filter(([, entries]) => (
    entries.length === sourceManifest.length
      && sourceManifest.every((sourceEntry, sourceIndex) => {
        const provenance = entries.find((entry) => entry.index === sourceIndex);
        const destinationEntry = destinationByPath.get(sourceEntry.relativePath);
        return provenance
          && provenance.relativePath === sourceEntry.relativePath
          && provenance.type === sourceEntry.type
          && provenance.mode === sourceEntry.mode
          && destinationEntry
          && provenance.mode === destinationEntry.mode
          && sameFileIdentity(provenance.targetIdentity, destinationEntry.identity);
      })
  ));
  if (matchingTokens.length !== 1) {
    throw migrationError(
      `Published Change removal proof has no unique external publication provenance: ${change.destination}`,
      "CONCURRENT_CHANGE",
    );
  }

  change.copyRoot = change.destination;
  change.copySourceRoot = change.stagedPath;
  change.copySourceManifest = sourceManifest;
  change.copyTargetManifest = sourceManifest.map((entry) => (
    removalEntryEvidence(destinationByPath.get(entry.relativePath))
  ));
  change.copyProvenanceToken = matchingTokens[0][0];
  change.copyIntent = null;
  await persistTransaction(state);
  await authenticateChangeCopyTargetProvenance(
    change,
    changeCopyProvenanceContext(state),
    "Published Change rollback provenance",
    { allowMissingTarget: true, allowMissingEntries: true },
  );
}

async function authenticatePublishedCopyLedger(state, change) {
  if (change.copyRoot === null
    || resolve(change.copyRoot) !== resolve(change.destination)
    || resolve(change.copySourceRoot) !== resolve(change.stagedPath)
    || change.copySourceManifest === null
    || change.copyTargetManifest === null) {
    return false;
  }
  await authenticateChangeCopyTargetProvenance(
    change,
    changeCopyProvenanceContext(state),
    "Published Change rollback provenance",
    {
      allowMissingTarget: change.removalManifest !== null,
      allowMissingEntries: change.removalManifest !== null,
    },
  );
  await assertDirectoryRemovalManifest(
    change.copySourceRoot,
    change.copySourceManifest,
    "Published Change rollback source",
  );
  if (change.removalManifest !== null) {
    await assertDirectoryRemovalSubset(
      change.destination,
      change.removalManifest,
      change.removalProgress,
      "Published Change rollback destination",
    );
    return true;
  }
  change.copyTargetManifest = await reconcileCopyTargetManifest(
    change.destination,
    change.copyTargetManifest,
    change.copySourceManifest,
    change.copyIntent,
    "Published Change rollback destination",
  );
  await persistTransaction(state);
  return true;
}

async function completeRollbackChangeMatchesProvenance(change, destination) {
  let manifest;
  try {
    manifest = await collectDirectoryRemovalManifest(
      destination,
      "Published Change rollback destination",
    );
  } catch {
    return false;
  }
  const provenanceByToken = new Map();
  for (const entry of change.copyTargetProvenance) {
    const entries = provenanceByToken.get(entry.token) ?? [];
    entries.push(entry);
    provenanceByToken.set(entry.token, entries);
  }
  const matchingTokens = [...provenanceByToken.values()].filter((entries) => (
    entries.length === manifest.length
      && manifest.every((entry) => {
        const provenance = entries.find(
          (candidate) => candidate.relativePath === entry.relativePath,
        );
        return provenance
          && provenance.type === entry.type
          && provenance.mode === entry.mode
          && sameFileIdentity(provenance.targetIdentity, entry.identity);
      })
  ));
  return matchingTokens.length === 1;
}

async function assertRollbackChangeOwnership(state, change, destination) {
  const destinationState = await pathState(destination);
  const ownsReservation = destinationState?.isDirectory()
    && !destinationState.isSymbolicLink()
    && change.reservationIdentity
    && sameFileIdentity(fileIdentity(destinationState), change.reservationIdentity);
  if (!ownsReservation) {
    throw migrationError(`Newer central Change preserved: ${change.destination}.`, "CONCURRENT_CHANGE");
  }
  await rebuildRollbackChangeCopyLedger(state, change);
  if (await authenticatePublishedCopyLedger(state, change)) return;
  const marker = join(destination, `.sdd-migration-owner-${change.ownerToken}`);
  const [markerState, proofState] = await Promise.all([
    pathState(marker),
    pathState(change.proofPath),
  ]);
  const ownsPartial = markerState?.isFile()
    && !markerState.isSymbolicLink()
    && proofState?.isFile()
    && !proofState.isSymbolicLink()
    && sameFileIdentity(fileIdentity(markerState), fileIdentity(proofState))
    && await partialChangeTreeMatchesStaging(change, destination);
  const tasksState = await pathState(join(destination, "tasks.md"));
  const ownsComplete = tasksState?.isFile()
    && !tasksState.isSymbolicLink()
    && proofState?.isFile()
    && !proofState.isSymbolicLink()
    && sameFileIdentity(fileIdentity(tasksState), fileIdentity(proofState))
    && await hashDirectory(destination).catch(() => null) === change.canonicalHash
    && await completeRollbackChangeMatchesProvenance(change, destination);
  const stagedTasksState = await pathState(join(change.stagedPath, "tasks.md"));
  const ownsEmptyReservation = proofState?.isFile()
    && !proofState.isSymbolicLink()
    && stagedTasksState?.isFile()
    && !stagedTasksState.isSymbolicLink()
    && sameFileIdentity(fileIdentity(stagedTasksState), fileIdentity(proofState))
    && (await readdir(destination).catch(() => ["occupied"])).length === 0;
  if (!ownsPartial && !ownsComplete && !ownsEmptyReservation) {
    throw migrationError(`Newer central Change preserved: ${change.destination}.`, "CONCURRENT_CHANGE");
  }
}

async function rollbackChange(
  state,
  change,
  {
    afterVerification = null,
    afterRemovalEntry = null,
    assertSourceCurrent = null,
  } = {},
) {
  await assertChangeStoreConfinement(change.destination, state.destinationWorkspaceRoot);
  let destinationState = await pathState(change.destination);
  if (!destinationState) {
    if (change.removalManifest !== null
      && resolve(change.removalRoot) === resolve(change.destination)) {
      change.copyRoot = null;
      change.copySourceRoot = null;
      change.copySourceManifest = null;
      change.copyTargetManifest = null;
      change.copyProvenanceToken = null;
      change.copyIntent = null;
      change.removalMode = null;
      change.removalRoot = null;
      change.removalManifest = null;
      change.removalProgress = [];
    }
    if (change.copyRoot !== null
      && resolve(change.copyRoot) === resolve(change.destination)) {
      change.copyRoot = null;
      change.copySourceRoot = null;
      change.copySourceManifest = null;
      change.copyTargetManifest = null;
      change.copyProvenanceToken = null;
      change.copyIntent = null;
    }
    const canonicalStagingCopy = change.copyRoot !== null
      && resolve(change.copyRoot) === resolve(change.stagedPath)
      && resolve(change.copySourceRoot) === resolve(join(change.stagingPath, "payload"));
    if (canonicalStagingCopy) return;
    change.phase = "removed";
    await persistTransaction(state);
    return;
  }
  const emptyReservation = destinationState.isDirectory()
    && !destinationState.isSymbolicLink()
    && (await readdir(change.destination).catch(() => ["occupied"])).length === 0;
  if (change.reservationIdentity === null || (state.plan === null && emptyReservation)) {
    await recoverUnboundChangeReservation(state, change, destinationState);
    destinationState = await pathState(change.destination);
  }
  await assertRollbackChangeOwnership(state, change, change.destination);

  {
    const ledgerOwned = change.copyRoot !== null
      && resolve(change.copyRoot) === resolve(change.destination);
    if (ledgerOwned) {
      if (change.removalManifest === null) {
        change.removalMode = "staging";
        change.removalRoot = change.destination;
        change.removalManifest = change.copyTargetManifest;
        change.removalProgress = [];
        await persistTransaction(state);
      }
      await removeProvenDirectoryTree(change.destination, {
        expectedIdentity: change.reservationIdentity,
        label: "Published central Change",
        removalManifest: change.removalManifest,
        removalProgress: change.removalProgress,
        afterVerification: afterVerification
          ? ({ path: destination }) => afterVerification({ change, destination })
          : null,
        beforeRemovalMutation: assertSourceCurrent,
        assertBoundary: async () => {
          await assertTransactionStoreAnchors(state);
          const currentDestination = await pathState(change.destination);
          if (currentDestination
            && (!currentDestination.isDirectory()
              || currentDestination.isSymbolicLink()
              || !sameFileIdentity(
                fileIdentity(currentDestination),
                change.reservationIdentity,
              ))) {
            throw migrationError(
              `Published Change rollback destination changed: ${change.destination}`,
              "CONCURRENT_CHANGE",
            );
          }
          if (!(await authenticatePublishedCopyLedger(state, change))) {
            throw migrationError(
              `Published Change rollback lost its external publication proof: ${change.destination}`,
              "CONCURRENT_CHANGE",
            );
          }
        },
        persistRemovalProgress: async (progress) => {
          change.removalProgress = progress;
          await persistTransaction(state);
          if (afterRemovalEntry) await afterRemovalEntry({ change, progress });
        },
      });
      change.copyRoot = null;
      change.copySourceRoot = null;
      change.copySourceManifest = null;
      change.copyTargetManifest = null;
      change.copyProvenanceToken = null;
      change.copyIntent = null;
      change.removalMode = null;
      change.removalRoot = null;
      change.removalManifest = null;
      change.removalProgress = [];
      await persistTransaction(state);
    } else {
      await removeProvenDirectoryTree(change.destination, {
        expectedIdentity: change.reservationIdentity,
        label: "Published central Change",
        verifyRemoval: (destination) => assertRollbackChangeOwnership(state, change, destination),
        afterVerification: afterVerification
          ? ({ path: destination }) => afterVerification({ change, destination })
          : null,
        beforeRemovalMutation: assertSourceCurrent,
        assertBoundary: async () => {
          await assertTransactionStoreAnchors(state);
          if (change.removalManifest === null) return;
          await rebuildRollbackChangeCopyLedger(state, change);
          if (!(await authenticatePublishedCopyLedger(state, change))) {
            throw migrationError(
              `Published Change rollback lost its external publication proof: ${change.destination}`,
              "CONCURRENT_CHANGE",
            );
          }
        },
        removalManifest: change.removalManifest,
        removalProgress: change.removalProgress,
        persistRemovalManifest: async (manifest) => {
          change.removalMode = "staging";
          change.removalRoot = change.destination;
          change.removalManifest = manifest;
          change.removalProgress = [];
          await persistTransaction(state);
          await rebuildRollbackChangeCopyLedger(state, change);
        },
        persistRemovalProgress: async (progress) => {
          change.removalProgress = progress;
          await persistTransaction(state);
          if (afterRemovalEntry) await afterRemovalEntry({ change, progress });
        },
      });
      change.copyRoot = null;
      change.copySourceRoot = null;
      change.copySourceManifest = null;
      change.copyTargetManifest = null;
      change.copyProvenanceToken = null;
      change.copyIntent = null;
      change.removalMode = null;
      change.removalRoot = null;
      change.removalManifest = null;
      change.removalProgress = [];
      await persistTransaction(state);
    }
  }
  change.phase = "removed";
}

async function rollbackTransaction(
  state,
  {
    afterConfigRestoreBackup = null,
    afterSourceRestoreEntry = null,
    afterSourceRestoreReservation = null,
    afterChangeRollbackVerification = null,
    afterChangeRollbackRemovalEntry = null,
    afterBriefRollbackVerification = null,
    afterTransactionDirectoryVerification = null,
  } = {},
) {
  if (!state) return;
  if (state.status === "committed") {
    throw migrationError(
      "Committed update migration cleanup cannot be rolled back.",
      "MUTATION_RECOVERY_FAILED",
      [state.journalPath],
    );
  }
  if (state.finished) return;
  const failures = [];
  const restoredSources = new Set();
  const assertRollbackSourcesCurrent = async () => {
    for (const removed of restoredSources) {
      try {
        await assertRestoredSourceCurrent(removed);
      } catch (error) {
        throw migrationError(
          "Update migration failed and recovery was incomplete.",
          "MUTATION_RECOVERY_FAILED",
          [...failures, `Revalidate restored source ${removed.path}: ${error.message}`],
        );
      }
    }
  };
  try {
    await assertTransactionStagingInventory(state);
  } catch (error) {
    failures.push(`Validate migration recovery state ${state.stagingRoot}: ${error.message}`);
  }
  state.status = "rolling-back";
  await persistTransaction(state).catch((error) => {
    failures.push(`Persist rollback state ${state.journalPath}: ${error.message}`);
  });
  for (const removed of [...state.removedSources].reverse()) {
    try {
      await rollbackRemovedSource(state, removed, {
        retainBackup: true,
        afterRestoreEntry: afterSourceRestoreEntry
          ? (entry) => afterSourceRestoreEntry({ record: removed, ...entry })
          : null,
        afterRestoreReservation: afterSourceRestoreReservation
          ? (details) => afterSourceRestoreReservation({ record: removed, ...details })
          : null,
      });
      await persistTransaction(state);
      restoredSources.add(removed);
    } catch (error) {
      failures.push(`Restore ${removed.path}: ${error.message}`);
    }
  }
  try {
    await assertSourceDerivedDestinationGuards(state);
  } catch (error) {
    failures.push(`Authenticate rollback destinations: ${error.message}`);
  }
  if (failures.length > 0) {
    throw migrationError(
      "Update migration failed and recovery was incomplete.",
      "MUTATION_RECOVERY_FAILED",
      failures,
    );
  }
  for (const write of [...state.writtenConfigs].reverse()) {
    await assertRollbackSourcesCurrent();
    try {
      await rollbackConfigWrite(write, {
        persist: () => persistTransaction(state),
        afterBackup: afterConfigRestoreBackup
          ? (replacement) => afterConfigRestoreBackup({ write, replacement })
          : null,
        afterProofCleanupLink: state.afterConfigProofCleanupLink,
        assertSourceCurrent: assertRollbackSourcesCurrent,
      });
      await persistTransaction(state);
    } catch (error) {
      failures.push(`Restore ${write.path}: ${error.message}`);
    }
  }
  for (const brief of [...state.publishedBriefs].reverse()) {
    await assertRollbackSourcesCurrent();
    try {
      await rollbackBrief(brief, {
        afterVerification: afterBriefRollbackVerification,
        persist: () => persistTransaction(state),
        assertSourceCurrent: assertRollbackSourcesCurrent,
      });
      await persistTransaction(state);
    } catch (error) {
      failures.push(`Remove ${brief.destination}: ${error.message}`);
    }
  }
  for (const change of [...state.publishedChanges].reverse()) {
    await assertRollbackSourcesCurrent();
    try {
      await rollbackChange(state, change, {
        afterVerification: afterChangeRollbackVerification,
        afterRemovalEntry: afterChangeRollbackRemovalEntry
          ? (details) => afterChangeRollbackRemovalEntry({ change, ...details })
          : null,
        assertSourceCurrent: assertRollbackSourcesCurrent,
      });
      await persistTransaction(state);
    } catch (error) {
      failures.push(`Remove ${change.destination}: ${error.message}`);
    }
  }
  for (const removed of [...state.removedSources].reverse()) {
    if (!restoredSources.has(removed)) continue;
    try {
      await rollbackRemovedSource(state, removed, {
        assertSourceCurrent: () => assertRestoredSourceCurrent(removed),
      });
      await persistTransaction(state);
    } catch (error) {
      failures.push(`Remove restored source backup ${removed.backup}: ${error.message}`);
    }
  }
  if (failures.length === 0) {

    await removeTransactionStaging(state, {
      afterDirectoryVerification: afterTransactionDirectoryVerification,
      assertRetentionAuthority: assertRollbackSourcesCurrent,
    }).catch((error) => {
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

async function committedCleanupHasAuthenticatedSourceGuards(state, record) {
  const cleanupStarted = record.phase === "cleaned"
    || record.backupProofPhase === "cleaning"
    || record.backupProofPhase === "removed"
    || (record.removalMode === "backup"
      && typeof record.removalRoot === "string"
      && record.removalRoot.length > 0
      && Array.isArray(record.removalManifest));
  if (state.status !== "committed"
    || !cleanupStarted
    || state.sourceDerivedDestinationGuards === null
    || state.sourceDerivedDestinationGuards !== serializedSourceDerivedDestinationGuards(state)
    || state.sourceDerivedManifestWitnessIdentity === null
    || state.sourceDerivedManifestDigestIdentity === null) {
    return false;
  }
  const manifest = await readSourceDerivedManifest(
    state.stagingRoot,
    state.journalPath,
    state.destinationWorkspaceRoot,
    state.sourceDerivedDestinationGuards,
  );
  if (!sameFileIdentity(manifest.witnessIdentity, state.sourceDerivedManifestWitnessIdentity)
    || !sameFileIdentity(manifest.digestIdentity, state.sourceDerivedManifestDigestIdentity)) {
    throw migrationError(
      "Committed cleanup lost its external source-derived destination guard witness.",
      "CONCURRENT_CHANGE",
    );
  }
  return true;
}
async function assertCommittedSourceGuardAvailability(state) {
  if (state.status !== "committed" || state.plan !== null) return;
  for (const record of state.removedSources) {
    if (await pathState(record.physicalPath)) continue;
    const backupState = await pathState(record.backup);
    const backup = backupState
      ? await inspectSourceBackup(record, {
        allowEmpty: true,
        allowPartialRemoval: record.removalMode === "backup",
      })
      : null;
    if (backup?.payloadPath && record.removalMode !== "backup") continue;
    if (await committedCleanupHasAuthenticatedSourceGuards(state, record)) continue;
    throw migrationError(
      `Committed cleanup cannot reconstruct the complete source-derived destination guard set: ${record.path}`,
      "MIGRATION_SOURCE_UNAVAILABLE",
    );
  }
}

async function readAuthenticatedRecoveryConfig(state, path, write, label, readGuard = null) {
  let sourcePath = path;
  let expectedHash = null;
  let expectedSource = null;
  if (write?.originalProofAuthenticated) {
    sourcePath = write.originalProofLocation ?? write.originalProofPath;
    expectedHash = write.authenticatedOriginalHash ?? write.originalHash;
    expectedSource = write.authenticatedOriginalSource ?? write.originalSource;
  } else if (write
    && state.status === "committed"
    && write.phase === "verified"
    && ["cleaning", "removed"].includes(write.proofPhase)
    && write.authenticatedNextHash === write.nextHash) {
    sourcePath = write.nextProofAuthenticated
      ? (write.nextProofLocation ?? write.nextProofPath)
      : path;
    expectedHash = write.authenticatedNextHash;
    expectedSource = write.nextSource;
  } else if (write
    && write.authenticatedOriginalHash === write.originalHash
    && (
      write.proofPhase === "pending"
      || (state.status === "rolling-back"
        && ["cleaning", "removed"].includes(write.proofPhase))
    )) {
    sourcePath = path;
    expectedHash = write.authenticatedOriginalHash;
    expectedSource = write.authenticatedOriginalSource ?? write.originalSource;
  } else if (write) {
    throw migrationError(
      `${label} has no authenticated configuration source for recovery.`,
      "CONCURRENT_CHANGE",
    );
  } else if (readGuard) {
    await assertReadGuardCurrent(readGuard);
    sourcePath = readGuard.proofPath;
    expectedHash = readGuard.hash;
    expectedSource = readGuard.source;
  }

  const sourceOwner = sourcePath === path
    ? (write?.ownerRoot ?? readGuard?.ownerRoot ?? dirname(dirname(path)))
    : (write?.ownerRoot ?? state.destinationWorkspaceRoot);
  let file;
  try {
    file = await readBoundRegularFile(sourcePath, {
      ownerRoot: sourceOwner,
      expectedOwnerBinding: write?.originalOwnerBinding ?? readGuard?.ownerBinding,
      allowMissing: true,
      label,
      unsafeCode: "CONCURRENT_CHANGE",
    });
  } catch (error) {
    throw migrationError(
      `${label} is unavailable for source guard derivation: ${sourcePath}`,
      "CONCURRENT_CHANGE",
      [error.message],
    );
  }
  if (file === null) {
    throw migrationError(
      `${label} is unavailable for source guard derivation: ${sourcePath}`,
      "CONCURRENT_CHANGE",
    );
  }
  const source = file.source;
  const expectedMode = write?.originalMode ?? readGuard?.mode ?? null;
  if ((expectedHash !== null && sourceHash(source) !== expectedHash)
    || (expectedSource !== null && source !== expectedSource)
    || (expectedMode !== null && file.mode !== expectedMode)) {
    throw migrationError(`${label} changed before source guard derivation: ${sourcePath}`, "CONCURRENT_CHANGE");
  }
  return parseYaml(source, sourcePath);
}

async function sourceGuardResolverFromPlan(state) {
  const sourceRoots = new Map(
    state.plan.sourceRoots.map((record) => [resolve(record.path), record]),
  );
  const changes = new Map();
  for (const change of state.plan.changes) {
    for (const sourcePath of change.sources) {
      const key = resolve(sourcePath);
      if (changes.has(key)) {
        throw migrationError(`Legacy source Change is duplicated in its migration plan: ${sourcePath}`, "CONCURRENT_CHANGE");
      }
      changes.set(key, {
        spaceId: change.spaceId,
        repositoryIds: change.repositories,
        closed: change.closed,
      });
    }
  }
  const briefs = new Map();
  for (const brief of state.plan.briefs) {
    const key = resolve(brief.sourcePath);
    if (briefs.has(key)) {
      throw migrationError(`Legacy source Change Brief is duplicated in its migration plan: ${brief.sourcePath}`, "CONCURRENT_CHANGE");
    }
    briefs.set(key, {
      destination: resolve(brief.destination),
      ownerRoot: resolve(brief.ownerRoot),
    });
  }
  return {
    assertSourceRoot(record) {
      const planned = sourceRoots.get(resolve(record.path));
      if (!planned
        || resolve(planned.ownerRoot) !== resolve(record.ownerRoot)
        || resolve(planned.physicalPath) !== resolve(record.physicalPath)
        || !sameFileIdentity(planned.identity, record.identity)
        || !sameFileIdentity(planned.ownerIdentity, record.ownerIdentity)) {
        throw migrationError(
          `Legacy source root does not match its source-derived plan: ${record.path}`,
          "CONCURRENT_CHANGE",
        );
      }
    },
    async changeDetails(logicalPath) {
      return changes.get(resolve(logicalPath)) ?? null;
    },
    briefDetails(logicalPath) {
      return briefs.get(resolve(logicalPath)) ?? null;
    },
  };
}

async function sourceGuardResolverFromRecovery(state) {
  const workspaceRoot = resolve(state.workspaceAnchor?.logicalPath ?? state.destinationWorkspaceRoot);
  const workspaceConfigPath = getConfigPath(workspaceRoot);
  const workspaceWrite = state.writtenConfigs.find(
    (record) => resolve(record.path) === resolve(workspaceConfigPath),
  );
  const workspaceReadGuard = state.readGuards.find(
    (guard) => resolve(guard.path) === resolve(workspaceConfigPath),
  );
  const rawWorkspaceConfig = await readAuthenticatedRecoveryConfig(
    state,
    workspaceConfigPath,
    workspaceWrite,
    "Original workspace configuration",
    workspaceReadGuard,
  );
  const migratedWorkspace = migrateConfig(rawWorkspaceConfig, workspaceRoot);
  assertValidConfig(migratedWorkspace.config, "derive authenticated migration source guards");
  const workspaceConfig = migratedWorkspace.config;
  let legacyWorkspaceConfig = isSupportedLegacyConfig(rawWorkspaceConfig)
    ? rawWorkspaceConfig
    : null;
  if (!legacyWorkspaceConfig
    && typeof rawWorkspaceConfig.migration?.sourceWorkspace === "string") {
    const legacyWorkspaceRoot = resolve(
      workspaceRoot,
      rawWorkspaceConfig.migration.sourceWorkspace,
    );
    const legacyConfigPath = getConfigPath(legacyWorkspaceRoot);
    const readGuard = state.readGuards.find(
      (guard) => resolve(guard.path) === resolve(legacyConfigPath),
    );
    if (!readGuard) {
      throw migrationError(
        `Legacy workspace configuration is unavailable for source guard derivation: ${legacyConfigPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    legacyWorkspaceConfig = await readAuthenticatedRecoveryConfig(
      state,
      legacyConfigPath,
      null,
      "Legacy workspace configuration",
      readGuard,
    );
    if (!isSupportedLegacyConfig(legacyWorkspaceConfig)) {
      throw migrationError(
        `Legacy workspace configuration cannot derive migration source guards: ${legacyConfigPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    assertValidConfig(
      migrateConfig(legacyWorkspaceConfig, legacyWorkspaceRoot).config,
      "derive authenticated legacy migration source guards",
    );
  }

  const sourceRoots = new Map();
  const changeParents = new Map();
  const briefParents = new Map();
  const repositoryConfigs = new Map();
  const register = (map, path, value, label) => {
    const key = resolve(path);
    if (map.has(key)) {
      throw migrationError(`${label} is ambiguously mapped: ${path}`, "CONCURRENT_CHANGE");
    }
    map.set(key, value);
  };
  const readRepositoryIdentity = async (repositoryRoot) => {
    const key = resolve(repositoryRoot);
    if (repositoryConfigs.has(key)) return repositoryConfigs.get(key);
    const configPath = getRepositoryConfigPath(repositoryRoot);
    const write = state.writtenConfigs.find(
      (record) => resolve(record.path) === resolve(configPath),
    );
    const readGuard = state.readGuards.find(
      (guard) => resolve(guard.path) === resolve(configPath),
    );
    const configState = write || readGuard || await pathState(configPath);
    if (!configState) {
      const missing = { raw: null, id: null };
      repositoryConfigs.set(key, missing);
      return missing;
    }
    const raw = await readAuthenticatedRecoveryConfig(
      state,
      configPath,
      write,
      `Original repository configuration for ${repositoryRoot}`,
      readGuard,
    );
    if (raw?.kind !== "repository") {
      throw migrationError(
        `Mapped repository has invalid source guard configuration: ${configPath}`,
        "CONCURRENT_CHANGE",
      );
    }
    const migrated = migrateRepositoryConfig(raw);
    assertValidRepositoryConfig(migrated.config);
    const result = { raw, id: migrated.config.id };
    repositoryConfigs.set(key, result);
    return result;
  };

  const repositoriesBySpace = new Map();
  for (const [spaceId, space] of Object.entries(workspaceConfig.ideas)
    .sort(([left], [right]) => left.localeCompare(right))) {
    const mappedContexts = [];
    for (const repository of space.repositories) {
      const configuredPath = resolveRepositoryPath(workspaceConfig, repository);
      const repositoryRoot = resolveWorkspacePath(workspaceRoot, configuredPath);
      const configuration = await readRepositoryIdentity(repositoryRoot);
      const context = {
        repositoryRoot,
        resolvedPath: normalizePath(configuredPath),
        repositoryId: configuration.id,
      };
      mappedContexts.push(context);
      const artifacts = legacyRepositoryArtifacts(
        configuration.raw,
        legacyWorkspaceConfig ?? rawWorkspaceConfig,
      );
      if (!artifacts) continue;
      const activeRoot = join(
        repositoryRoot,
        assertLegacyRelativePath(
          artifacts.activeChanges,
          `Legacy active Change root for ${repositoryRoot}`,
        ),
      );
      const closedRoot = join(
        repositoryRoot,
        assertLegacyRelativePath(
          artifacts.closedChanges,
          `Legacy closed Change root for ${repositoryRoot}`,
        ),
      );
      const rootDescriptor = { ownerRoot: repositoryRoot };
      register(sourceRoots, activeRoot, rootDescriptor, "Legacy source root");
      if (dirname(closedRoot) !== activeRoot) {
        register(sourceRoots, closedRoot, rootDescriptor, "Legacy source root");
      }
      register(changeParents, activeRoot, {
        spaceId,
        repositoryIds: configuration.id === null ? [] : [configuration.id],
        requiresRepositoryIdentity: true,
        closed: false,
      }, "Legacy Change source location");
      register(changeParents, closedRoot, {
        spaceId,
        repositoryIds: configuration.id === null ? [] : [configuration.id],
        requiresRepositoryIdentity: true,
        closed: true,
      }, "Legacy Change source location");
    }
    repositoriesBySpace.set(spaceId, mappedContexts);
  }

  if (legacyWorkspaceConfig) {
    const plannedDirectory = assertLegacyRelativePath(
      legacyWorkspaceConfig.planning?.plannedChangesDirectory,
      "planning.plannedChangesDirectory",
    );
    for (const [spaceId, space] of Object.entries(workspaceConfig.ideas)
      .sort(([left], [right]) => left.localeCompare(right))) {
      const ownerRoot = resolveWorkspacePath(
        workspaceRoot,
        resolveIdeaPlanningPath(workspaceConfig, spaceId, space),
      );
      const plannedRoot = join(ownerRoot, plannedDirectory);
      register(sourceRoots, plannedRoot, { ownerRoot }, "Legacy source root");
      const details = {
        spaceId,
        ownerRoot,
        mappedContexts: repositoriesBySpace.get(spaceId) ?? [],
      };
      register(changeParents, plannedRoot, details, "Legacy planned Change source location");
      register(briefParents, plannedRoot, details, "Legacy Change Brief source location");
    }
  }

  return {
    async assertSourceRoot(record) {
      const expected = sourceRoots.get(resolve(record.path));
      const owner = await assertStoredDirectoryAnchor(
        record.ownerRoot,
        sourceOwnerAnchor(record),
        "Legacy source owner",
      );
      const ownerRelativePath = relative(resolve(record.ownerRoot), resolve(record.path));
      const expectedPhysicalPath = resolve(owner.physicalPath, ownerRelativePath);
      const currentSourceState = await pathState(record.path);
      const currentPhysicalPath = currentSourceState
        ? resolve(await resolvePhysicalPath(record.path))
        : null;
      const currentIdentity = currentSourceState ? fileIdentity(currentSourceState) : null;
      if (!expected
        || resolve(expected.ownerRoot) !== resolve(record.ownerRoot)
        || !isPathInside(resolve(record.ownerRoot), resolve(record.path))
        || resolve(record.physicalPath) !== expectedPhysicalPath
        || currentSourceState && (
          !currentSourceState.isDirectory()
          || currentSourceState.isSymbolicLink()
          || currentPhysicalPath !== resolve(record.physicalPath)
          || !sameFileIdentity(currentIdentity, record.identity)
            && !sameFileIdentity(currentIdentity, record.restoreIdentity)
        )) {
        throw migrationError(
          `Legacy source root cannot be derived from authenticated configuration: ${record.path}`,
          "CONCURRENT_CHANGE",
        );
      }
    },
    async changeDetails(logicalPath, sourcePath) {
      const details = changeParents.get(resolve(dirname(logicalPath)));
      if (!details) return null;
      if (!Object.hasOwn(details, "mappedContexts")) return details;
      return {
        spaceId: details.spaceId,
        repositoryIds: await resolveLegacyPlannedRepositoryIds(
          sourcePath,
          details.spaceId,
          details.mappedContexts,
        ),
        closed: false,
      };
    },
    briefDetails(logicalPath) {
      const details = briefParents.get(resolve(dirname(logicalPath)));
      if (!details) return null;
      return {
        destination: resolve(
          join(details.ownerRoot, CHANGE_BRIEFS_DIRECTORY_NAME, basename(logicalPath)),
        ),
        ownerRoot: resolve(details.ownerRoot),
      };
    },
  };
}

function serializedSourceDerivedDestinationGuards(state) {
  const changes = serializeDestinationGuards(state.destinationGuards)
    .map((guard) => ({ ...guard, destination: resolve(guard.destination) }))
    .sort((left, right) => left.destination.localeCompare(right.destination));
  const briefs = state.publishedBriefs
    .map((brief) => ({
      destination: resolve(brief.destination),
      ownerRoot: resolve(brief.ownerRoot),
      hash: brief.hash,
    }))
    .sort((left, right) => left.destination.localeCompare(right.destination));
  return JSON.stringify({ changes, briefs });
}

async function assertSourceDerivedDestinationGuards(state) {
  const guardsById = new Map();
  for (const guard of state.destinationGuards) {
    const changeId = basename(guard.destination);
    if (guardsById.has(changeId)) {
      throw migrationError(`Destination guard is duplicated for Change ${changeId}.`, "CONCURRENT_CHANGE");
    }
    guardsById.set(changeId, guard);
  }
  const briefsByDestination = new Map();
  for (const brief of state.publishedBriefs) {
    const destination = resolve(brief.destination);
    if (briefsByDestination.has(destination)) {
      throw migrationError(`Destination guard is duplicated for Change Brief ${destination}.`, "CONCURRENT_CHANGE");
    }
    briefsByDestination.set(destination, brief);
  }

  const resolver = state.plan
    ? await sourceGuardResolverFromPlan(state)
    : await sourceGuardResolverFromRecovery(state);
  const sourceChanges = [];
  const sourceBriefs = new Set();

  const serializedGuards = serializedSourceDerivedDestinationGuards(state);
  let complete = true;
  for (const record of state.removedSources) {
    await resolver.assertSourceRoot(record);
    const sourceState = await pathState(record.physicalPath);
    let sourceRoot = null;
    let backup = null;
    if (sourceState) {
      if (!(await sourceMatchesRecordedState(record, sourceState))) {
        throw migrationError(`Legacy source changed before guard derivation: ${record.path}`, "CONCURRENT_CHANGE");
      }
      sourceRoot = record.physicalPath;
    } else {
      const backupState = await pathState(record.backup);
      if (backupState) {
        backup = await inspectSourceBackup(record, {
          allowEmpty: true,
          allowPartialRemoval: record.removalMode === "backup",
        });
      }
      const cleanupUsesDurableGuards = await committedCleanupHasAuthenticatedSourceGuards(
        state,
        record,
      );
      if (record.removalMode === "backup") {
        if (!cleanupUsesDurableGuards) {
          throw migrationError(
            `Committed cleanup cannot authenticate its source-derived destination guards: ${record.path}`,
            "MIGRATION_SOURCE_UNAVAILABLE",
          );
        }
        complete = false;
        continue;
      }
      sourceRoot = backup?.payloadPath ?? null;
      if (!sourceRoot && state.status === "committed") {
        if (state.plan !== null || cleanupUsesDurableGuards) {
          complete = false;
          continue;
        }
        throw migrationError(
          `Committed cleanup cannot reconstruct the complete source-derived destination guard set: ${record.path}`,
          "MIGRATION_SOURCE_UNAVAILABLE",
        );
      }
    }

    const scanSourceDirectory = async (
      directory,
      { allowBriefs = false, allowContainer = false } = {},
    ) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const sourcePath = join(directory, entry.name);
        const relativePath = relative(sourceRoot, sourcePath);
        const logicalPath = resolve(record.path, relativePath);
        if (entry.isFile()
          && allowBriefs
          && entry.name.endsWith(".md")) {
          const details = resolver.briefDetails(logicalPath);
          if (!details) {
            throw migrationError(
              `Legacy Change Brief has no source-derived canonical destination: ${logicalPath}`,
              "CONCURRENT_CHANGE",
            );
          }
          const brief = briefsByDestination.get(details.destination);
          const hash = await hashFile(sourcePath);
          if (!brief
            || resolve(brief.ownerRoot) !== details.ownerRoot
            || brief.hash !== hash
            || sourceBriefs.has(details.destination)) {
            throw migrationError(
              `Legacy Change Brief does not match its destination guard: ${logicalPath}`,
              "CONCURRENT_CHANGE",
            );
          }
          sourceBriefs.add(details.destination);
          continue;
        }
        if (entry.isDirectory() && !entry.isSymbolicLink() && isValidChangeId(entry.name)) {
          const details = await resolver.changeDetails(logicalPath, sourcePath);
          if (!details
            || details.requiresRepositoryIdentity && details.repositoryIds.length === 0) {
            throw migrationError(
              `Legacy source Change has no authenticated target identity: ${logicalPath}`,
              "CONCURRENT_CHANGE",
            );
          }
          sourceChanges.push({
            changeId: entry.name,
            sourcePath,
            tasksSource: await readFile(join(sourcePath, "tasks.md"), "utf8"),
            rawHash: await hashDirectory(sourcePath),
            ...details,
          });
          continue;
        }
        if (entry.isDirectory() && !entry.isSymbolicLink() && allowContainer) {
          await scanSourceDirectory(sourcePath);
          continue;
        }
        throw migrationError(
          `Legacy source contains unsupported guard-derivation state: ${sourcePath}`,
          "CONCURRENT_CHANGE",
        );
      }
    };
    await scanSourceDirectory(sourceRoot, { allowBriefs: true, allowContainer: true });
  }


  if (!complete) {
    if (state.sourceDerivedDestinationGuards !== serializedGuards) {
      throw migrationError(
        "Destination guards changed after their source-derived bijection was authenticated.",
        "CONCURRENT_CHANGE",
      );
    }
    return serializedGuards;
  }
  const groups = new Map();
  for (const candidate of sourceChanges) {
    const group = groups.get(candidate.changeId) ?? [];
    group.push(candidate);
    groups.set(candidate.changeId, group);
  }
  for (const [changeId, group] of groups) {
    const spaces = [...new Set(group.map((candidate) => candidate.spaceId))];
    const locations = [...new Set(group.map((candidate) => candidate.closed))];
    const hashes = [...new Set(group.map((candidate) => candidate.rawHash))];
    if (spaces.length !== 1 || locations.length !== 1 || hashes.length !== 1) {
      throw migrationError(
        `Legacy source Change has conflicting source-derived identity: ${changeId}`,
        "CONCURRENT_CHANGE",
      );
    }
    const repositories = [...new Set(group.flatMap((candidate) => candidate.repositoryIds))]
      .sort((left, right) => left.localeCompare(right));
    for (const candidate of group) {
      const metadata = parseChangeMetadata(candidate.tasksSource);
      if (!metadata.error) {
        const recordedRepositories = [...metadata.repositories]
          .sort((left, right) => left.localeCompare(right));
        if (metadata.space !== spaces[0]
          || JSON.stringify(recordedRepositories) !== JSON.stringify(repositories)) {
          throw migrationError(
            `Legacy source Change ownership metadata conflicts with authenticated topology: ${candidate.sourcePath}`,
            "CONCURRENT_CHANGE",
          );
        }
      } else if (metadata.space !== null || metadata.repositories !== null) {
        throw migrationError(
          `Legacy source Change has incomplete ownership metadata: ${candidate.sourcePath}`,
          "CONCURRENT_CHANGE",
        );
      }
    }
    const canonicalTasks = setChangeMetadata(group[0].tasksSource, {
      space: spaces[0],
      repositories,
    });
    const canonicalHash = canonicalTasks === null
      ? null
      : await canonicalDirectoryHash(group[0].sourcePath, canonicalTasks);
    const canonicalDestination = resolve(
      locations[0]
        ? getClosedChangePath(changeId, state.destinationWorkspaceRoot)
        : getActiveChangePath(changeId, state.destinationWorkspaceRoot),
    );
    const guard = guardsById.get(changeId);
    if (!guard
      || resolve(guard.destination) !== canonicalDestination
      || guard.canonicalHash !== canonicalHash) {
      throw migrationError(
        `Legacy source Change does not match its source-derived destination guard: ${changeId}`,
        "CONCURRENT_CHANGE",
      );
    }
  }
  if (groups.size !== guardsById.size
    || [...guardsById.keys()].some((changeId) => !groups.has(changeId))) {
    throw migrationError(
      "Destination guards do not biject to the authenticated legacy source Changes.",
      "CONCURRENT_CHANGE",
    );
  }
  if (sourceBriefs.size !== briefsByDestination.size
    || [...briefsByDestination.keys()].some((destination) => !sourceBriefs.has(destination))) {
    throw migrationError(
      "Change Brief guards do not biject to the authenticated legacy source files.",
      "CONCURRENT_CHANGE",
    );
  }
  if (state.sourceDerivedDestinationGuards != null
    && state.sourceDerivedDestinationGuards !== serializedGuards) {
    throw migrationError(
      "Destination guards changed after their source-derived bijection was authenticated.",
      "CONCURRENT_CHANGE",
    );
  }
  return serializedGuards;
}

async function verifyFinalizedDestinations(state) {
  await assertReadGuardsCurrent(state.readGuards);
  const proofCleanupIsCommitted = state.status === "committed"
    && state.removedSources.every((record) => record.phase === "cleaned");
  for (const guard of state.destinationGuards) {
    await assertDestinationGuard(guard, state.destinationWorkspaceRoot);
  }
  await assertSourceDerivedDestinationGuards(state);
  for (const write of state.writtenConfigs) {
    if (["cleaning", "removed"].includes(write.proofPhase)) {
      if (!proofCleanupIsCommitted) {
        throw migrationError(
          `Configuration proof cleanup is not durably committed: ${write.path}`,
          "CONCURRENT_CHANGE",
        );
      }
      await assertPublishedConfigHash(write);
    } else {
      await assertPublishedConfigProof(write);
    }
  }
  for (const brief of state.publishedBriefs) {
    if (["cleaning", "removed"].includes(brief.publicationProofPhase)) {
      if (!proofCleanupIsCommitted) {
        throw migrationError(
          `Change Brief proof cleanup is not durably committed: ${brief.destination}`,
          "CONCURRENT_CHANGE",
        );
      }
      await assertPublishedBriefHash(brief);
    } else {
      await assertPublishedBriefProof(brief);
    }
  }
}


async function cleanupCommittedBriefProofs(state, beforeRemovalMutation = null) {
  if (state.status !== "committed"
    || state.removedSources.some((record) => record.phase !== "cleaned")) {
    throw migrationError(
      "Change Brief publication proofs cannot be removed before committed source cleanup.",
      "CONCURRENT_CHANGE",
    );
  }
  for (const brief of state.publishedBriefs) {
    if (brief.phase !== "verified") {
      throw migrationError(
        `Change Brief publication is incomplete before proof cleanup: ${brief.destination}`,
        "CONCURRENT_CHANGE",
      );
    }
    const assertCommittedDestinationCurrent = () =>
      assertBriefDestinationMatchesProof(brief, brief.publicationBindingTargetIdentity);
    const beforeProofRemoval = async (details) => {
      await assertCommittedDestinationCurrent();
      if (beforeRemovalMutation) await beforeRemovalMutation(details);
      await assertCommittedDestinationCurrent();
    };
    if (brief.publicationProofPhase === "removed") {
      await assertCommittedDestinationCurrent();
      continue;
    }
    if (brief.publicationProofPhase === "present") {
      await assertPublishedBriefProof(brief);
    } else if (brief.publicationProofPhase === "cleaning") {
      const evidence = await inspectBriefPublicationProofs(brief);
      if (evidence.identity === null) {
        await assertCommittedDestinationCurrent();
      } else {
        const identity = await assertBriefProofMatchesRecord(
          brief,
          evidence,
          { allowCleanup: true },
        );
        await assertBriefDestinationMatchesProof(brief, identity);
      }
    } else {
      throw migrationError(
        `Change Brief publication proof phase is incomplete: ${brief.destination}`,
        "CONCURRENT_CHANGE",
      );
    }
    await removeBriefPublicationProof(
      brief,
      () => persistTransaction(state),
      beforeProofRemoval,
      assertCommittedDestinationCurrent,
    );
  }
}

async function assertTransactionCommitReady(state) {
  if (!state || state.finished) return;
  if (state.status === "committed") {
    await assertCommittedSourceGuardAvailability(state);
    await verifyFinalizedDestinations(state);
    return;
  }
  if (state.status !== "applying") {
    throw migrationError(
      `Update migration cannot commit from transaction state ${state.status}.`,
      "CONCURRENT_CHANGE",
    );
  }
  if (state.initializationPhase !== "released"
    || state.destinationManifestPhase !== "present"
    || state.destinationManifestDigestPhase !== "present"
    || state.destinationManifestWitnessPhase !== "present"
    || state.sourceDerivedDestinationGuards === null
    || state.sourceDerivedManifestWitnessIdentity === null
    || state.sourceDerivedManifestDigestIdentity === null
    || state.publishedChanges.some((record) => record.phase !== "verified")
    || state.publishedBriefs.some((record) => (
      record.phase !== "verified"
      || record.publicationProofPhase !== "present"
      || record.publicationProofPath === null
    ))
    || state.writtenConfigs.some((record) => (
      record.phase !== "verified" || record.proofPhase !== "present"
    ))
    || state.readGuards.some((guard) => guard.proofPhase !== "present")
    || state.destinationGuards.some((guard) => guard.existing && guard.proofPhase !== "present")
    || state.removedSources.some((record) => (
      record.phase !== "removed" || record.backupProofPhase !== "present"
    ))) {
    throw migrationError(
      "Update migration has incomplete publication or ownership-proof phase barriers.",
      "CONCURRENT_CHANGE",
    );
  }
  await assertStoredDirectoryAnchor(
    state.workspaceAnchor.logicalPath,
    state.workspaceAnchor,
    "Migration workspace",
  );
  if (state.mutationLock !== null && !(await observeMutationLock(state.mutationLock))) {
    throw migrationError(
      `Update mutation lock changed before migration commit: ${state.mutationLock.path}`,
      "CONCURRENT_CHANGE",
    );
  }
  await assertTransactionStagingInventory(state);
  for (const write of state.writtenConfigs) {
    if (!write.originalProofAuthenticated
      || !write.nextProofAuthenticated
      || write.authenticatedOriginalSource !== write.originalSource
      || write.authenticatedOriginalHash !== write.originalHash
      || write.authenticatedNextHash !== write.nextHash
      || write.originalProofCleanupPath !== null
      || write.nextProofCleanupPath !== null) {
      throw migrationError(
        `Configuration ownership proofs are incomplete before commit: ${write.path}`,
        "CONCURRENT_CHANGE",
      );
    }
    const originalProof = await inspectConfigOwnershipProof(
      write,
      write.originalProofPath,
      write.authenticatedOriginalHash,
      true,
      "Original configuration proof",
    );
    if (!originalProof
      || !sameFileIdentity(fileIdentity(originalProof), write.originalIdentity)) {
      throw migrationError(
        `Original configuration ownership proof changed before commit: ${write.path}`,
        "CONCURRENT_CHANGE",
      );
    }
    await assertPublishedConfigProof(write);
  }
  const destinationManifest = await readDestinationManifest(
    state,
    state.stagingRoot,
    state.journalPath,
    state.destinationWorkspaceRoot,
  );
  if (!destinationManifest.complete
    || !sameFileIdentity(
      destinationManifest.witnessIdentity,
      state.destinationManifestWitnessIdentity,
    )
    || !sameFileIdentity(
      destinationManifest.digestIdentity,
      state.destinationManifestDigestIdentity,
    )) {
    throw migrationError(
      "Destination manifest evidence is incomplete before migration commit.",
      "CONCURRENT_CHANGE",
    );
  }
  const sourceDerivedManifest = await readSourceDerivedManifest(
    state.stagingRoot,
    state.journalPath,
    state.destinationWorkspaceRoot,
    state.sourceDerivedDestinationGuards,
  );
  if (!sameFileIdentity(
    sourceDerivedManifest.witnessIdentity,
    state.sourceDerivedManifestWitnessIdentity,
  ) || !sameFileIdentity(
    sourceDerivedManifest.digestIdentity,
    state.sourceDerivedManifestDigestIdentity,
  )) {
    throw migrationError(
      "Source-derived destination manifest evidence is incomplete before migration commit.",
      "CONCURRENT_CHANGE",
    );
  }
  await verifyFinalizedDestinations(state);
  for (const removed of state.removedSources) {
    if (await pathState(removed.physicalPath)) {
      throw migrationError(`Legacy source reappeared before commit: ${removed.path}`, "CONCURRENT_CHANGE");
    }
    if (!(await inspectSourceBackup(removed))) {
      throw migrationError(`Legacy source backup is missing: ${removed.backup}`, "CONCURRENT_CHANGE");
    }
  }
}

async function commitTransaction(state) {
  if (!state || state.finished || state.status === "committed") return;
  await assertTransactionCommitReady(state);
  state.status = "committed";
  try {
    await persistTransaction(state);
  } catch (error) {
    // Journal publication is intentionally treated as irreversible once attempted:
    // a failed fsync/handoff can leave the committed generation externally visible.
    error.committed = true;
    throw error;
  }
}

async function finalizeCommittedTransactionCleanup(
  state,
  {
    beforeSourceBackupDelete = null,
    afterSourceBackupVerification = null,
    afterTransactionDirectoryVerification = null,
    beforeCleanupQuarantine = null,
    afterCleanupQuarantine = null,
    beforeCleanupRemovalMutation = null,
    beforeFinalizeCleanup = null,
  } = {},
) {
  const cleanupHooks = {
    beforeQuarantine: beforeCleanupQuarantine,
    afterQuarantine: afterCleanupQuarantine,
    beforeRemovalMutation: beforeCleanupRemovalMutation,
  };
  if (!state || state.finished) return;
  if (state.status !== "committed") {
    throw migrationError(
      "Update migration cleanup requires an irreversible committed transaction.",
      "CONCURRENT_CHANGE",
    );
  }
  let failures = [];
  if (beforeFinalizeCleanup) {
    try {
      await beforeFinalizeCleanup({ state });
    } catch (error) {
      failures.push(`Retain committed migration recovery state: ${error.message}`);
    }
  }
  if (failures.length === 0) {
    try {
      await assertTransactionStagingInventory(state);
      await assertCommittedSourceGuardAvailability(state);
      await verifyFinalizedDestinations(state);
    } catch (error) {
      failures.push(`Retain committed migration recovery state: ${error.message}`);
    }
  }
  if (failures.length === 0) {
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
  if (failures.length === 0) {
    for (const removed of state.removedSources) {
      try {
        const sourceState = await pathState(removed.physicalPath);
        if (sourceState) {
          throw migrationError(
            `Committed legacy source appeared before backup cleanup: ${removed.path}`,
            "CONCURRENT_CHANGE",
          );
        }
        const backupState = await inspectSourceBackup(removed, {
          allowEmpty: true,
          allowPartialRemoval: removed.removalMode === "backup",
        });
        if (removed.phase === "cleaned") {
          if (backupState) {
            throw migrationError(
              `Cleaned legacy source backup still exists: ${removed.backup}`,
              "CONCURRENT_CHANGE",
            );
          }
          continue;
        }
        if (!backupState && removed.cleanupPath === null) {
          throw migrationError(`Legacy source backup is missing: ${removed.backup}`, "CONCURRENT_CHANGE");
        }
        await cleanupSourceBackup(state, removed, {
          beforeDelete: async ({ payloadPath }) => {
            if (beforeSourceBackupDelete) {
              await beforeSourceBackupDelete({ record: removed, payloadPath });
            }
            await assertReadGuardsCurrent(state.readGuards);
          },
          beforeRemoval: () => verifyFinalizedDestinations(state),
          afterVerification: afterSourceBackupVerification
            ? ({ record, payloadPath }) => afterSourceBackupVerification({ record, payloadPath })
            : null,
          ...cleanupHooks,
        });
        removed.phase = "cleaned";
        await persistTransaction(state);
      } catch (error) {
        failures.push(`Remove migration backup ${removed.backup}: ${error.message}`);
        break;
      }
    }
  }
  if (failures.length === 0) {
    await verifyFinalizedDestinations(state).catch((error) => {
      failures.push(`Retain committed migration recovery state: ${error.message}`);
    });
  }
  if (failures.length === 0) {
    await assertReadGuardsCurrent(state.readGuards).catch((error) => {
      failures.push(`Retain configuration ownership proofs: ${error.message}`);
    });
  }
  if (failures.length === 0) {
    await cleanupCommittedConfigProofs(state).catch((error) => {
      failures.push(`Remove configuration ownership proofs: ${error.message}`);
    });
  }
  if (failures.length === 0) {
    await cleanupCommittedBriefProofs(state, beforeCleanupRemovalMutation).catch((error) => {
      failures.push(`Remove Change Brief publication proofs: ${error.message}`);
    });
  }
  if (failures.length === 0) {
    await verifyFinalizedDestinations(state).catch((error) => {
      failures.push(`Retain migration journal: ${error.message}`);
    });
  }
  if (failures.length === 0) {
    await assertTransactionStagingInventory(state).catch((error) => {
      failures.push(`Retain publication recovery state: ${error.message}`);
    });
  }
  if (failures.length === 0) {
    for (const change of state.publishedChanges) {
      if (change.copyRoot === null
        || resolve(change.copyRoot) !== resolve(change.destination)) continue;
      change.copyRoot = null;
      change.copySourceRoot = null;
      change.copySourceManifest = null;
      change.copyTargetManifest = null;
      change.copyProvenanceToken = null;
      change.copyIntent = null;
      change.removalMode = null;
      change.removalRoot = null;
      change.removalManifest = null;
      change.removalProgress = [];
    }
    await persistTransaction(state).catch((error) => {
      failures.push(`Retain publication recovery state: ${error.message}`);
    });
  }
  if (failures.length === 0) {
    await removeTransactionStaging(state, {
      afterDirectoryVerification: async (entry) => {
        if (afterTransactionDirectoryVerification) {
          await afterTransactionDirectoryVerification(entry);
        }
        await assertReadGuardsCurrent(state.readGuards, { requireProof: false });
      },
      assertRetentionAuthority: () => assertReadGuardsCurrent(
        state.readGuards,
        { requireProof: false },
      ),
      ...cleanupHooks,
    }).catch((error) => {
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

async function recoveryAuthorityMapsTarget(authority, targetPath) {
  for (const owner of authority.planningOwners) {
    if (await isPathPhysicallyInside(owner, targetPath)) return true;
  }
  for (const owner of authority.repositoryOwners) {
    if (await isPathPhysicallyInside(owner, targetPath)) return true;
  }
  return false;
}

export async function findPendingUpdateMigrationWorkspace(
  startPath,
  {
    workspaceRoot = null,
    discoveryStartPath = startPath,
    env = process.env,
  } = {},
) {
  if (workspaceRoot !== null && workspaceRoot !== undefined) {
    const explicitRoot = resolve(workspaceRoot);
    await assertWorkspaceRootIsNotLegacyHome(explicitRoot, env);
    return await hasPendingUpdateMigration(explicitRoot) ? explicitRoot : null;
  }

  const targetPath = resolve(startPath);
  let candidateRoot = resolve(discoveryStartPath);
  while (true) {
    if (await pathExists(getChangesRoot(candidateRoot))) {
      try {
        await assertWorkspaceRootIsNotLegacyHome(candidateRoot, env);
      } catch (error) {
        if (error?.code === "LEGACY_USER_MIGRATION_REQUIRED") return null;
        throw error;
      }
      const candidateAnchor = await captureDirectoryAnchor(
        candidateRoot,
        "Migration workspace",
        "MIGRATION_RECOVERY_FAILED",
      );
      const states = (await listTransactionStates(candidateRoot))
        .filter((state) => matchingWorkspaceAnchor(state.workspaceAnchor, candidateAnchor));
      let mapsTarget = candidateRoot === targetPath;
      for (const state of states) {
        if (mapsTarget) break;
        mapsTarget = await recoveryAuthorityMapsTarget(state.authority, targetPath);
      }
      if (states.length > 0 && mapsTarget) return candidateRoot;
    }
    const parent = dirname(candidateRoot);
    if (parent === candidateRoot) return null;
    candidateRoot = parent;
  }
}

export async function hasPendingUpdateMigration(
  workspaceRoot,
  destinationWorkspaceRoot = workspaceRoot,
) {
  const workspaceAnchor = await captureDirectoryAnchor(
    workspaceRoot,
    "Migration workspace",
    "MIGRATION_RECOVERY_FAILED",
  );
  const states = await listTransactionStates(destinationWorkspaceRoot);
  return states.some((state) => matchingWorkspaceAnchor(state.workspaceAnchor, workspaceAnchor));
}

export async function recoverUpdateMigration(
  workspaceRoot,
  {
    destinationWorkspaceRoot = workspaceRoot,
    dryRun = false,
    afterConfigRestoreBackup = null,
    afterSourceRestoreEntry = null,
    afterSourceRestoreReservation = null,
    beforeSourceBackupDelete = null,
    afterSourceBackupVerification = null,
    afterChangeRollbackVerification = null,
    afterChangeRollbackRemovalEntry = null,
    afterBriefRollbackVerification = null,
    afterTransactionDirectoryVerification = null,
    beforeCleanupQuarantine = null,
    afterCleanupQuarantine = null,
    beforeCleanupRemovalMutation = null,
    beforeTransactionJournalReplace = null,
    afterTransactionJournalCleanupHandoff = null,
    afterTransactionCleanupReceiptStage = null,
    afterTransactionCleanupReceiptProof = null,
    afterTransactionCleanupReceipt = null,
    afterTransactionJournalUnlink = null,
    afterTransactionStagingRootRemoval = null,
    afterTransactionWitnessUnlink = null,
    mutationLock = null,
  } = {},
) {
  const workspaceAnchor = await captureDirectoryAnchor(
    workspaceRoot,
    "Migration workspace",
    "MIGRATION_RECOVERY_FAILED",
  );
  const states = (await listTransactionStates(destinationWorkspaceRoot))
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
    state.mutationLock = mutationLock;
    state.beforeJournalReplace = beforeTransactionJournalReplace;
    state.afterJournalCleanupHandoff = afterTransactionJournalCleanupHandoff;
    state.afterTransactionCleanupReceiptStage = afterTransactionCleanupReceiptStage;
    state.afterTransactionCleanupReceiptProof = afterTransactionCleanupReceiptProof;
    state.afterTransactionCleanupReceipt = afterTransactionCleanupReceipt;
    state.afterTransactionJournalUnlink = afterTransactionJournalUnlink;
    state.afterTransactionStagingRootRemoval = afterTransactionStagingRootRemoval;
    state.afterTransactionWitnessUnlink = afterTransactionWitnessUnlink;
    if (state.status === "initializing") {
      await recoverPreJournalInitialization(state);
      continue;
    }
    if (["journaled", "releasing"].includes(state.initializationPhase)) {
      await writeDestinationManifest(state);
      await releaseInitializationEvidence(state);
    }
    if (state.status === "terminal-cleanup") {
      await resumeTerminalCleanup(state, {
        cleanupHooks: {
          beforeQuarantine: beforeCleanupQuarantine,
          afterQuarantine: afterCleanupQuarantine,
          beforeRemovalMutation: beforeCleanupRemovalMutation,
        },
      });
      continue;
    }
    if (state.terminalCleanupPlan !== null) {
      await releaseJournalCleanupReservationForTerminalCleanup(state);
      state.terminalCleanupReceipt = await ensureTerminalCleanupReceipt(state);
      if (state.afterTransactionCleanupReceipt) {
        await state.afterTransactionCleanupReceipt({
          receiptPath: state.terminalCleanupPlan.receipt.path,
          journalPath: state.journalPath,
          stagingRoot: state.stagingRoot,
        });
      }
      await resumeTerminalCleanup(state, {
        assertRetentionAuthority: () => assertReadGuardsCurrent(
          state.readGuards,
          { requireProof: false },
        ),
        cleanupHooks: {
          beforeQuarantine: beforeCleanupQuarantine,
          afterQuarantine: afterCleanupQuarantine,
          beforeRemovalMutation: beforeCleanupRemovalMutation,
        },
      });
      continue;
    }
    if (state.status === "committed") {
      await finalizeCommittedTransactionCleanup(state, {
        beforeSourceBackupDelete,
        afterSourceBackupVerification,
        afterTransactionDirectoryVerification,
        beforeCleanupQuarantine,
        afterCleanupQuarantine,
        beforeCleanupRemovalMutation,
      });
    } else {
      await rollbackTransaction(state, {
        afterConfigRestoreBackup,
        afterSourceRestoreEntry,
        afterSourceRestoreReservation,
        afterChangeRollbackVerification,
        afterChangeRollbackRemovalEntry,
        afterBriefRollbackVerification,
        afterTransactionDirectoryVerification,
      });
    }
  }
  return { recovered: states.length };
}

export async function applyUpdateMigration(
  plan,
  {
    beforeCommit = null,
    beforeTransactionInitialize = null,
    beforeSourceRemoval = null,
    beforeSourceRename = null,
    beforeSourceRemovalMutation = null,
    beforeChangeEntryPublish = null,
    beforeChangeTransferMutation = null,
    afterChangeReservation = null,
    beforeBriefLink = null,
    afterBriefStagingWriteReceipt = null,
    afterBriefStagingProof = null,
    afterBriefPublicationProof = null,
    beforeConfigWrite = null,
    afterSourceBackupReservation = null,
    afterSourceBackupReservationMkdir = null,
    afterSourceRestoreReservation = null,
    beforeSourceBackupDelete = null,
    afterSourceBackupVerification = null,
    afterChangeRollbackVerification = null,
    afterChangeRollbackRemovalEntry = null,
    afterBriefRollbackVerification = null,
    afterTransactionDirectoryVerification = null,
    beforeCleanupQuarantine = null,
    afterCleanupQuarantine = null,
    beforeCleanupRemovalMutation = null,
    beforeCommitReady = null,
    beforeFinalizeCleanup = null,
    beforeTransactionJournalReplace = null,
    afterTransactionJournalCleanupHandoff = null,
    afterTransactionCleanupReceiptStage = null,
    afterTransactionCleanupReceiptProof = null,
    afterTransactionCleanupReceipt = null,
    afterTransactionJournalUnlink = null,
    afterTransactionStagingRootRemoval = null,
    afterTransactionWitnessUnlink = null,
    mutationLock = null,
    afterConfigBackup = null,
    afterChangeReservationMkdir = null,
    afterChangeStagingReservationMkdir = null,
    afterChangeStagingCopy = null,
    beforeChangeStagingCopyEntry = null,
    afterChangeStagingCopyEntry = null,
    afterChangeCopyTargetProvenance = null,
    beforeStagedTasksQuarantine = null,
    afterStagedTasksCanonicalProof = null,
    beforeStagedPayloadRemovalMutation = null,
    afterStagedPayloadRemoval = null,
    afterStagingReservationRemoval = null,
    beforeSourceBackupCopyEntry = null,
    afterSourceBackupCopyEntry = null,
    afterStagedChangeVerification = null,
    afterStagedIdentityEvidence = null,
    afterConfigPublish = null,
    afterConfigNextProofCreate = null,
    afterConfigWrite = null,
    replaceConfig = replaceFileAtomically,
    afterReadGuardProofCreate = null,
    beforeDestinationGuardProofCreate = null,
    afterDestinationGuardProofCreate = null,
    afterConfigProofCreate = null,
    afterConfigOriginalStage = null,
    afterConfigNextStage = null,
    afterConfigStagingTemporaryCreate = null,
    afterTransactionStagingReservation = null,
    afterTransactionInitializationReservation = null,
    afterTransactionInitializationBinding = null,
    afterTransactionStagingRootCreate = null,
    afterTransactionInitialJournal = null,
    afterDestinationManifestCreate = null,
    afterDestinationManifestDigestCreate = null,
    afterDestinationManifestWitnessCreate = null,
    afterTransactionInitializationEvidenceRelease = null,
    afterConfigProofCleanupLink = null,
    linkFile = link,
  } = {},
) {
  if (beforeCommit) await beforeCommit(plan);
  await verifyMigrationPlan(plan);
  if (!plan.result.required) {
    const workspaceConfigSnapshot = await readWorkspaceConfigSnapshot(
      plan.destinationWorkspaceRoot,
    );
    await assertWorkspaceConfigSnapshotCurrent(
      plan.destinationWorkspaceRoot,
      workspaceConfigSnapshot,
    );
    return {
      workspaceConfigSnapshot,
      rollback: async () => {},
      assertCommitReady: async () => {
        await assertWorkspaceConfigSnapshotCurrent(
          plan.destinationWorkspaceRoot,
          workspaceConfigSnapshot,
        );
      },
      commit: async () => {},
      finalizeCleanup: async () => {},
    };
  }
  const stagingRoot = join(
    getChangesRoot(plan.destinationWorkspaceRoot),
    `${MIGRATION_STAGING_PREFIX}${process.pid}-${randomUUID()}`,
  );
  await assertChangeStoreConfinement(stagingRoot, plan.destinationWorkspaceRoot);
  const state = await createTransactionState(plan, stagingRoot, mutationLock);
  state.beforeJournalReplace = beforeTransactionJournalReplace;
  state.afterJournalCleanupHandoff = afterTransactionJournalCleanupHandoff;
  state.afterChangeCopyTargetProvenance = afterChangeCopyTargetProvenance;
  state.afterTransactionCleanupReceiptStage = afterTransactionCleanupReceiptStage;
  state.afterTransactionCleanupReceiptProof = afterTransactionCleanupReceiptProof;
  state.afterTransactionCleanupReceipt = afterTransactionCleanupReceipt;
  state.afterTransactionJournalUnlink = afterTransactionJournalUnlink;
  state.afterTransactionStagingRootRemoval = afterTransactionStagingRootRemoval;
  state.afterTransactionWitnessUnlink = afterTransactionWitnessUnlink;
  state.afterConfigProofCleanupLink = afterConfigProofCleanupLink;
  if (state.durable) {
    state.storeAnchors = await captureTransactionStoreAnchors(
      plan.destinationWorkspaceRoot,
      { initialize: true },
    );
    if (beforeTransactionInitialize) await beforeTransactionInitialize({ state });
  }
  let workspaceConfigSnapshot = null;
  try {
    await initializeTransaction(
      state,
      linkFile,
      afterReadGuardProofCreate,
      beforeDestinationGuardProofCreate,
      afterDestinationGuardProofCreate,
      afterConfigProofCreate,
      afterConfigOriginalStage,
      afterConfigNextStage,
      afterConfigStagingTemporaryCreate,
      afterTransactionStagingReservation,
      afterTransactionInitialJournal,
      afterDestinationManifestCreate,
      afterDestinationManifestDigestCreate,
      afterDestinationManifestWitnessCreate,
      afterTransactionInitializationEvidenceRelease,
      afterTransactionInitializationReservation,
      afterTransactionInitializationBinding,
      afterTransactionStagingRootCreate,
    );
    for (const record of state.publishedChanges) {
      await stageChangeDirectory(state, record, {
        afterReservationMkdir: afterChangeStagingReservationMkdir,
        afterCopy: afterChangeStagingCopy,
        beforeTasksQuarantine: beforeStagedTasksQuarantine,
        beforeCopyEntry: beforeChangeStagingCopyEntry,
        afterCopyEntry: afterChangeStagingCopyEntry,
        afterTasksCanonicalProof: afterStagedTasksCanonicalProof,
        beforePayloadRemovalMutation: beforeStagedPayloadRemovalMutation,
        afterPayloadRemoval: afterStagedPayloadRemoval,
        afterStagingReservationRemoval,
        afterStagedIdentityEvidence,
        linkFile,
      });
      await publishDirectoryWithoutReplace(
        state,
        record.stagedPath,
        record.destination,
        record,
        beforeChangeEntryPublish,
        afterChangeReservationMkdir,
        async () => {
          record.phase = "reserved";
          await persistTransaction(state);
        },
        afterChangeReservation,
        (path) => assertTransactionStoreAnchors(state, { path }),
        afterStagedChangeVerification,
        beforeChangeTransferMutation,
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
      await createBriefOwnershipIntent(state, record);
      await publishFileWithoutReplace(
        record.destination,
        record.source,
        record.stagedPath,
        record,
        beforeBriefLink,
        () => assertTransactionStoreAnchors(state),
        () => persistTransaction(state),
        linkFile,
        afterBriefStagingWriteReceipt,
        afterBriefStagingProof,
        afterBriefPublicationProof,
      );
      await persistTransaction(state);
      await assertPublishedBriefProof(record);
      record.phase = "verified";
      await persistTransaction(state);
    }
    for (const record of state.writtenConfigs) {
      if (beforeConfigWrite) await beforeConfigWrite({ write: record, index: record.index });
      record.phase = "replacing";
      await persistTransaction(state);
      await assertConfigWriteCurrent(record);
      try {
        await replaceConfig(record.nextPath, record.path, {
          expectedHash: record.originalHash,
          ownerRoot: record.ownerRoot,
          expectedSnapshot: {
            source: record.originalSource,
            identity: record.originalIdentity,
            mode: record.originalMode,
            ownerBinding: record.originalOwnerBinding,
          },
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
          beforePublish: async (publication) => {
            const temporaryState = await pathState(publication.temporary);
            if (!temporaryState?.isFile() || temporaryState.isSymbolicLink()
              || (publication.temporaryIdentity
                && !sameFileIdentity(
                  fileIdentity(temporaryState),
                  publication.temporaryIdentity,
                ))) {
              throw migrationError(
                `Published configuration temporary changed: ${publication.temporary}`,
                "CONCURRENT_CHANGE",
              );
            }
            record.nextProofIntentIdentity = publication.temporaryIdentity
              ?? fileIdentity(temporaryState);
            await persistTransaction(state);
            const createdProofIdentity = await createFileIdentityProof(
              publication.temporary,
              record.nextProofPath,
              record.nextHash,
              "Published configuration",
              async () => {
                await assertTransactionStoreAnchors(state);
                await assertStoredDirectoryAnchor(record.ownerRoot, record.ownerAnchor, "Configuration owner");
              },
            );
            if (!sameFileIdentity(createdProofIdentity, record.nextProofIntentIdentity)) {
              throw migrationError(
                `Published configuration proof changed identity: ${record.nextProofPath}`,
                "CONCURRENT_CHANGE",
              );
            }
            if (afterConfigNextProofCreate) {
              await afterConfigNextProofCreate({ write: record, publication });
            }
            record.nextProofAuthenticated = true;
            record.authenticatedNextHash = record.nextHash;
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
      await assertPublishedConfigHash(record);
      await assertPublishedConfigProof(record);
      record.phase = "verified";
      await persistTransaction(state);
    }
    if (state.durable) {
      const sourceDerivedDestinationGuards = await assertSourceDerivedDestinationGuards(state);
      await writeSourceDerivedManifest(state, sourceDerivedDestinationGuards);
      await persistTransaction(state);
    }
    if (beforeSourceRemoval) await beforeSourceRemoval(plan);
    for (const root of plan.sourceRoots) await assertSourceRootAnchor(root);
    assertNonOverlappingSourceRoots(new Map(
      plan.sourceRoots.map((root) => [root.physicalPath, root]),
    ));
    for (const record of state.removedSources) {
      await verifyMigrationDestinations(plan, state);
      if (beforeSourceRename) await beforeSourceRename({ root: record });
      await assertReadGuardsCurrent(state.readGuards);
      await assertSourceRootAnchor(record);
      record.phase = "removing";
      await persistTransaction(state);
      await moveSourceToBackupWithoutReplace(
        state,
        record,
        {
          afterReservationMkdir: afterSourceBackupReservationMkdir,
          afterReservation: afterSourceBackupReservation,
          beforeCopyEntry: beforeSourceBackupCopyEntry,
          afterCopyEntry: afterSourceBackupCopyEntry,
          linkFile,
          beforeRemovalMutation: beforeSourceRemovalMutation,
          assertRemovalAuthority: () => verifyMigrationDestinations(plan, state),
        },
      );
      record.phase = "removed";
      await persistTransaction(state);
    }
    await verifyMigrationDestinations(plan, state);
    workspaceConfigSnapshot = await captureTransactionWorkspaceConfigSnapshot(state);
  } catch (error) {
    if (!state.storeAnchors?.staging) throw error;
    try {
      if (["journaled", "releasing"].includes(state.initializationPhase)) {
        await writeDestinationManifest(state);
        await releaseInitializationEvidence(state);
      }
      await rollbackTransaction(state, {
        afterSourceRestoreReservation,
        afterChangeRollbackVerification,
        afterChangeRollbackRemovalEntry,
        afterBriefRollbackVerification,
        afterTransactionDirectoryVerification,
      });
    } catch (recoveryError) {
      if (recoveryError.code === "MUTATION_RECOVERY_FAILED") {
        recoveryError.details = [
          `Original error: ${error.message}`,
          ...(error.details ?? []).map((detail) => `Original error detail: ${detail}`),
          ...(recoveryError.details ?? []),
        ];
      }
      throw recoveryError;
    }
    throw error;
  }

  return {
    workspaceConfigSnapshot,
    rollback: () => rollbackTransaction(state, {
      afterSourceRestoreReservation,
      afterChangeRollbackVerification,
      afterChangeRollbackRemovalEntry,
      afterBriefRollbackVerification,
      afterTransactionDirectoryVerification,
    }),
    assertCommitReady: async () => {
      if (beforeCommitReady) await beforeCommitReady({ state });
      return assertTransactionCommitReady(state);
    },
    commit: () => commitTransaction(state),
    finalizeCleanup: () => finalizeCommittedTransactionCleanup(state, {
      beforeSourceBackupDelete,
      afterSourceBackupVerification,
      afterTransactionDirectoryVerification,
      beforeCleanupQuarantine,
      afterCleanupQuarantine,
      beforeCleanupRemovalMutation,
      beforeFinalizeCleanup,
    }),
  };
}
