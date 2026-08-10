import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, mkdir as mkdirCallback } from "node:fs";
import {
  access,
  lstat,
  link,
  mkdir,
  open,
  readFile,
  realpath,
  readdir,
  readlink,
  rename,
  rm,
  rmdir,
  stat,
  symlink,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { SddError } from "./errors.js";

export async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function writeJson(path, value) {
  await writeFileAtomically(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sameBoundFileObservation(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function boundFileError(path, label, code, reason) {
  return new SddError(`${label} ${reason}: ${path}`, { code });
}

function boundFileChanged(path, label) {
  return boundFileError(path, label, "CONCURRENT_CHANGE", "changed while its bytes were being read");
}

function boundFileIdentity(state) {
  return { dev: String(state.dev), ino: String(state.ino) };
}

async function captureBoundFileOwner(ownerRoot, path, label, unsafeCode) {
  if (ownerRoot === null) return null;
  try {
    return {
      path: ownerRoot,
      binding: await observeReplacementAncestor(ownerRoot, label, path),
      ancestors: null,
    };
  } catch (error) {
    const failure = boundFileError(path, label, unsafeCode, "has an unsafe owner root");
    failure.details = [error.message, ...(error.details ?? [])];
    failure.cause = error;
    throw failure;
  }
}

async function completeBoundFileOwner(ownerBinding, path, label) {
  if (ownerBinding === null || ownerBinding.ancestors !== null) return;
  const ownerAuthority = { path: ownerBinding.path, binding: ownerBinding.binding };
  ownerBinding.ancestors = await captureReplacementAncestors(
    dirname(path),
    label,
    path,
    ownerAuthority,
  );
}

export function sameBoundFileOwner(left, right) {
  if (left === null || right === null) return left === right;
  const leftBinding = left.binding ?? left;
  const rightBinding = right.binding ?? right;
  if (!sameReplacementAncestor(leftBinding, rightBinding)) return false;
  if (!Array.isArray(right.ancestors)) return true;
  return Array.isArray(left.ancestors)
    && left.ancestors.length === right.ancestors.length
    && left.ancestors.every((ancestor, index) =>
      sameReplacementAncestor(ancestor, right.ancestors[index]));
}

async function assertBoundFileOwnerCurrent(ownerBinding, path, label) {
  if (ownerBinding === null) return;
  try {
    const ownerAuthority = { path: ownerBinding.path, binding: ownerBinding.binding };
    await assertReplacementOwnerCurrent(ownerAuthority, path, label);
    if (Array.isArray(ownerBinding.ancestors)) {
      await assertReplacementAncestors(ownerBinding.ancestors, label, path);
    }
    await assertReplacementOwnerCurrent(ownerAuthority, path, label);
  } catch {
    throw boundFileChanged(path, label);
  }
}

async function assertMissingBoundPathAncestors(path, ownerRoot, label, unsafeCode) {
  if (ownerRoot === null) return;
  let candidate = dirname(path);
  while (candidate !== ownerRoot && isPathInside(ownerRoot, candidate)) {
    let state;
    try {
      state = await lstat(candidate);
    } catch (error) {
      if (error?.code === "ENOENT") {
        candidate = dirname(candidate);
        continue;
      }
      if (["ENOTDIR", "ELOOP"].includes(error?.code)) {
        throw boundFileError(path, label, unsafeCode, "has an unsafe owner-local path");
      }
      throw error;
    }
    if (state.isSymbolicLink() || !state.isDirectory()) {
      throw boundFileError(path, label, unsafeCode, "has an unsafe owner-local path");
    }
    return;
  }
}

async function completeMissingBoundFileOwner(ownerBinding, path, label) {
  if (ownerBinding === null) return;
  const ownerAuthority = {
    path: ownerBinding.path,
    binding: ownerBinding.binding,
  };
  ownerBinding.ancestors = await captureExistingReplacementAncestors(
    dirname(path),
    label,
    path,
    ownerAuthority,
  );
}

export async function readBoundRegularFile(
  path,
  {
    ownerRoot = null,
    allowMissing = false,
    returnMissingBinding = false,
    label = "File",
    unsafeCode = "UNSAFE_FILE_PATH",
    afterRead = null,
    expectedOwnerBinding = undefined,
  } = {},
) {
  const absolutePath = resolve(path);
  const absoluteOwner = ownerRoot === null ? null : resolve(ownerRoot);
  if (absoluteOwner !== null && !isPathInside(absoluteOwner, absolutePath)) {
    throw boundFileError(absolutePath, label, unsafeCode, "is outside its owner root");
  }
  const ownerBinding = await captureBoundFileOwner(
    absoluteOwner,
    absolutePath,
    label,
    unsafeCode,
  );

  let pathState;
  try {
    pathState = await lstat(absolutePath, { bigint: true });
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") {
      await assertBoundFileOwnerCurrent(ownerBinding, absolutePath, label);
      await assertMissingBoundPathAncestors(absolutePath, absoluteOwner, label, unsafeCode);
      try {
        await completeMissingBoundFileOwner(ownerBinding, absolutePath, label);
      } catch {
        throw boundFileChanged(absolutePath, label);
      }
      await assertBoundFileOwnerCurrent(ownerBinding, absolutePath, label);
      await assertReplacementPathMissing(absolutePath, label, absolutePath);
      if (
        expectedOwnerBinding !== undefined
        && !sameBoundFileOwner(ownerBinding, expectedOwnerBinding)
      ) {
        throw boundFileChanged(absolutePath, label);
      }
      await assertBoundFileOwnerCurrent(ownerBinding, absolutePath, label);
      await assertReplacementPathMissing(absolutePath, label, absolutePath);
      return returnMissingBinding
        ? {
          missing: true,
          bytes: null,
          source: null,
          identity: null,
          mode: null,
          ownerBinding,
        }
        : null;
    }
    if (["ENOTDIR", "ELOOP"].includes(error?.code)) {
      throw boundFileError(absolutePath, label, unsafeCode, "has an unsafe owner-local path");
    }
    throw error;
  }
  try {
    await completeBoundFileOwner(ownerBinding, absolutePath, label);
  } catch (error) {
    if (expectedOwnerBinding !== undefined) throw boundFileChanged(absolutePath, label);
    throw boundFileError(
      absolutePath,
      label,
      unsafeCode,
      "has an unsafe owner-local path",
    );
  }
  if (
    expectedOwnerBinding !== undefined
    && !sameBoundFileOwner(ownerBinding, expectedOwnerBinding)
  ) {
    throw boundFileChanged(absolutePath, label);
  }
  await assertBoundFileOwnerCurrent(ownerBinding, absolutePath, label);
  if (pathState.isSymbolicLink()) {
    throw boundFileError(absolutePath, label, unsafeCode, "cannot be a symbolic link");
  }
  if (!pathState.isFile()) {
    throw boundFileError(absolutePath, label, unsafeCode, "is not a regular file");
  }

  let physicalOwner = null;
  let physicalPath;
  try {
    [physicalOwner, physicalPath] = await Promise.all([
      absoluteOwner === null ? null : realpath(absoluteOwner),
      realpath(absolutePath),
    ]);
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "ELOOP"].includes(error?.code)) {
      throw boundFileChanged(absolutePath, label);
    }
    throw error;
  }
  await assertBoundFileOwnerCurrent(ownerBinding, absolutePath, label);
  if (physicalOwner !== null && !isPathInside(physicalOwner, physicalPath)) {
    throw boundFileError(absolutePath, label, unsafeCode, "resolves outside its owner root");
  }

  let handle;
  try {
    handle = await open(
      physicalPath,
      fsConstants.O_RDONLY
        | (fsConstants.O_NOFOLLOW ?? 0)
        | (fsConstants.O_NONBLOCK ?? 0),
    );
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "ELOOP"].includes(error?.code)) {
      throw boundFileChanged(absolutePath, label);
    }
    throw error;
  }

  try {
    const openedState = await handle.stat({ bigint: true });
    if (!openedState.isFile() || !sameBoundFileObservation(pathState, openedState)) {
      throw boundFileChanged(absolutePath, label);
    }
    const bytes = await handle.readFile();
    const readState = await handle.stat({ bigint: true });
    if (!sameBoundFileObservation(openedState, readState)) {
      throw boundFileChanged(absolutePath, label);
    }

    const source = bytes.toString("utf8");
    const identity = boundFileIdentity(readState);
    const mode = Number(readState.mode & 0o777n);
    await afterRead?.({
      path: absolutePath,
      physicalPath,
      bytes,
      source,
      identity,
      mode,
    });
    await assertBoundFileOwnerCurrent(ownerBinding, absolutePath, label);

    let currentState;
    let currentPhysicalPath;
    let currentPhysicalOwner = physicalOwner;
    try {
      [currentState, currentPhysicalPath, currentPhysicalOwner] = await Promise.all([
        lstat(absolutePath, { bigint: true }),
        realpath(absolutePath),
        absoluteOwner === null ? physicalOwner : realpath(absoluteOwner),
      ]);
    } catch (error) {
      if (["ENOENT", "ENOTDIR", "ELOOP"].includes(error?.code)) {
        throw boundFileChanged(absolutePath, label);
      }
      throw error;
    }
    if (
      currentState.isSymbolicLink()
      || !currentState.isFile()
      || !sameBoundFileObservation(readState, currentState)
      || currentPhysicalPath !== physicalPath
      || currentPhysicalOwner !== physicalOwner
      || (
        currentPhysicalOwner !== null
        && !isPathInside(currentPhysicalOwner, currentPhysicalPath)
      )
    ) {
      throw boundFileChanged(absolutePath, label);
    }
    await assertBoundFileOwnerCurrent(ownerBinding, absolutePath, label);

    return { bytes, source, identity, mode, ownerBinding };
  } finally {
    await handle.close();
  }
}

function expectedFileMatches(observed, expected) {
  const expectedBytes = Buffer.isBuffer(expected?.bytes)
    ? expected.bytes
    : typeof expected?.source === "string"
      ? Buffer.from(expected.source, "utf8")
      : null;
  if (
    observed === null
    || expected === null
    || expectedBytes === null
    || typeof expected?.identity?.dev !== "string"
    || typeof expected?.identity?.ino !== "string"
  ) {
    return false;
  }
  return observed.identity.dev === expected.identity.dev
    && observed.identity.ino === expected.identity.ino
    && (expected.mode === undefined || observed.mode === expected.mode)
    && observed.bytes.equals(expectedBytes);
}

function atomicWriteChanged(path, reason, error = null) {
  return new SddError(`File ${reason} during atomic write: ${path}`, {
    code: "CONCURRENT_CHANGE",
    ...(error ? { details: [error.message] } : {}),
  });
}

async function readExpectedFile(path, expected, ownerRoot) {
  let observed;
  try {
    observed = await readBoundRegularFile(path, {
      ownerRoot,
      allowMissing: true,
      label: "Atomic write target",
      unsafeCode: "CONCURRENT_CHANGE",
      expectedOwnerBinding: expected?.ownerBinding,
    });
  } catch (error) {
    if (error?.code === "CONCURRENT_CHANGE") {
      throw atomicWriteChanged(path, "changed", error);
    }
    throw error;
  }
  if (!expectedFileMatches(observed, expected)) {
    throw atomicWriteChanged(path, observed === null ? "disappeared" : "changed");
  }
  return observed;
}

function sameBoundFileIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino;
}

function retainedAtomicBackup(
  path,
  backup,
  reason,
  error = null,
  snapshot = null,
  ownerRoot = null,
) {
  const failure = new SddError(`File ${reason} during atomic write: ${path}`, {
    code: "CONCURRENT_CHANGE",
    details: [
      ...(error ? [error.message] : []),
      `Retained original: ${backup}`,
    ],
  });
  if (snapshot !== null && ownerRoot !== null) {
    failure.retainedBackup = { path: backup, snapshot, ownerRoot };
  }
  return failure;
}

function atomicWriteRecoveryFailure(path, message, errors, retainedPaths = []) {
  const failure = new SddError(message, {
    code: "MUTATION_RECOVERY_FAILED",
    details: [
      ...errors.map(({ label, error }) => `${label}: ${error.message}`),
      ...errors.flatMap(({ label, error }) =>
        (error?.details ?? []).map((detail) => `${label} detail: ${detail}`)),
      ...[...new Set(retainedPaths)].map((retainedPath) => `Retained path: ${retainedPath}`),
    ],
  });
  failure.errors = errors.map(({ error }) => error);
  failure.cause = new AggregateError(failure.errors, failure.message);
  return failure;
}

async function performGuardedFileMutation(
  mutation,
  operation,
  beforeMutation,
  afterMutation,
) {
  await beforeMutation?.(mutation);
  let result;
  try {
    result = await operation();
  } catch (operationError) {
    let stateError = null;
    try {
      await afterMutation?.(mutation);
    } catch (error) {
      stateError = error;
    }
    if (stateError) {
      const error = atomicWriteChanged(
        mutation.path,
        "changed while a filesystem operation was failing",
        new AggregateError([operationError, stateError]),
      );
      error.errors = [operationError, stateError];
      throw error;
    }
    throw operationError;
  }
  await afterMutation?.(mutation);
  return result;
}

function exactBoundEntryTypeMatches(state, expected) {
  return expected?.type === "symlink" ? state.isSymbolicLink() : state.isFile();
}

async function assertExactFileBeforeRemoval(path, expected, label) {
  if (expected?.type === "symlink") {
    const before = await lstat(path, { bigint: true }).catch((error) => {
      throw atomicWriteChanged(path, "could not authenticate symlink before removal", error);
    });
    const linkTarget = await readlink(path, { encoding: "buffer" }).catch((error) => {
      throw atomicWriteChanged(path, "could not read symlink before removal", error);
    });
    const after = await lstat(path, { bigint: true }).catch((error) => {
      throw atomicWriteChanged(path, "could not reauthenticate symlink before removal", error);
    });
    if (
      !before.isSymbolicLink()
      || !after.isSymbolicLink()
      || !sameBoundFileIdentity(boundFileIdentity(before), expected.identity)
      || !sameBoundFileIdentity(boundFileIdentity(after), expected.identity)
      || (expected.mode !== undefined && Number(after.mode & 0o777n) !== expected.mode)
      || !Buffer.isBuffer(expected.linkTarget)
      || !expected.linkTarget.equals(linkTarget)
    ) {
      throw atomicWriteChanged(path, "changed immediately before symlink removal");
    }
    return;
  }
  if (expected?.bytes !== undefined) {
    const observed = await readBoundRegularFile(path, {
      ownerRoot: dirname(path),
      label,
      unsafeCode: "CONCURRENT_CHANGE",
    });
    if (!expectedFileMatches(observed, expected)) {
      throw atomicWriteChanged(path, "changed immediately before removal");
    }
    return;
  }
  let state;
  try {
    state = await lstat(path, { bigint: true });
  } catch (error) {
    throw atomicWriteChanged(path, "could not be authenticated immediately before removal", error);
  }
  const expectedIdentity = expected?.identity ?? expected;
  if (
    !exactBoundEntryTypeMatches(state, expected)
    || !sameBoundFileIdentity(boundFileIdentity(state), expectedIdentity)
  ) {
    throw atomicWriteChanged(path, "changed immediately before removal");
  }
}

async function unlinkIdentityBoundQuarantine(
  path,
  expected,
  label,
  {
    beforeMutation = null,
    afterMutation = null,
    linkPath = link,
    removePath = rm,
    quarantineDirectory = dirname(path),
  } = {},
) {
  const expectedIdentity = expected?.identity ?? expected;
  const unlinkPath = join(
    quarantineDirectory,
    `.owned-${process.pid}-${randomUUID()}`,
  );
  try {
    await performGuardedFileMutation(
      { action: "link-slot", path, target: unlinkPath },
      () => linkPath(path, unlinkPath),
      beforeMutation,
      afterMutation,
    );
  } catch (error) {
    let linked = false;
    try {
      const state = await lstat(unlinkPath, { bigint: true });
      linked = exactBoundEntryTypeMatches(state, expected)
        && sameBoundFileIdentity(boundFileIdentity(state), expectedIdentity);
    } catch {
      // The source path remains the only authenticated recovery candidate.
    }
    return {
      error: new Error(`${label} could not enter its private unlink slot: ${error.message}`),
      retainedPath: linked ? dirname(path) : path,
      quarantinePath: unlinkPath,
    };
  }

  let state;
  try {
    state = await lstat(unlinkPath, { bigint: true });
  } catch (error) {
    return {
      error: new Error(`${label} unlink identity could not be verified: ${error.message}`),
      retainedPath: dirname(path),
      quarantinePath: unlinkPath,
    };
  }
  if (!exactBoundEntryTypeMatches(state, expected)
    || !sameBoundFileIdentity(boundFileIdentity(state), expectedIdentity)) {
    return {
      error: new Error(`${label} changed before unlink and was preserved.`),
      retainedPath: dirname(path),
      quarantinePath: unlinkPath,
    };
  }
  if (expected?.bytes !== undefined) {
    try {
      const observed = await readBoundRegularFile(unlinkPath, {
        ownerRoot: dirname(unlinkPath),
        label,
        unsafeCode: "CONCURRENT_CHANGE",
      });
      if (!expectedFileMatches(observed, expected)) {
        return {
          error: new Error(`${label} contents changed before unlink and were preserved.`),
          retainedPath: dirname(path),
          quarantinePath: unlinkPath,
        };
      }
    } catch (error) {
      return {
        error: new Error(`${label} could not be authenticated before unlink: ${error.message}`),
        retainedPath: dirname(path),
        quarantinePath: unlinkPath,
      };
    }
  }
  try {
    if (expected?.bytes !== undefined) {
      const source = await readBoundRegularFile(path, {
        ownerRoot: dirname(path),
        label,
        unsafeCode: "CONCURRENT_CHANGE",
      });
      if (!expectedFileMatches(source, expected)) {
        throw new Error(`${label} source changed before unlink.`);
      }
    }
    await performGuardedFileMutation(
      { action: "remove-source", path, target: unlinkPath },
      async () => {
        await assertExactFileBeforeRemoval(path, expected, label);
        return removePath(path);
      },
      beforeMutation,
      afterMutation,
    );
  } catch (error) {
    return {
      error: new Error(`${label} source unlink failed: ${error.message}`),
      retainedPath: dirname(path),
      quarantinePath: unlinkPath,
    };
  }
  try {
    await performGuardedFileMutation(
      { action: "remove", path: unlinkPath },
      async () => {
        await assertExactFileBeforeRemoval(unlinkPath, expected, label);
        return removePath(unlinkPath);
      },
      beforeMutation,
      afterMutation,
    );
    return { error: null, retainedPath: null, quarantinePath: unlinkPath };
  } catch (error) {
    return {
      error: new Error(`${label} unlink failed: ${error.message}`),
      retainedPath: unlinkPath,
      quarantinePath: unlinkPath,
    };
  }
}

async function removeOwnedPathWithQuarantine(
  path,
  expected,
  {
    allowMissing,
    label,
    renamePath = rename,
    makeDirectory = mkdir,
    removeDirectory = rmdir,
    removePath = rm,
    linkPath = link,
    exclusiveTransfer = renamePath === rename,
    beforeMutation = null,
    afterMutation = null,
  },
) {
  const expectedIdentity = expected?.identity ?? expected;
  const parent = dirname(path);
  const quarantineRoot = join(
    parent,
    `.${basename(path)}.sdd-cleanup-${process.pid}-${randomUUID()}`,
  );
  const quarantined = join(quarantineRoot, "entry");
  const failures = [];
  const retainedPaths = [];
  let quarantineCreated = false;
  let quarantinedEntry = false;
  let quarantineIdentity = null;

  const assertQuarantineMissing = async () => {
    try {
      await lstat(quarantineRoot, { bigint: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    throw replacementChanged(label, path, `had quarantine ${quarantineRoot} appear`);
  };
  const assertQuarantine = async (expectedNames) => {
    const before = await lstat(quarantineRoot, { bigint: true }).catch((error) => {
      throw replacementChanged(label, path, `lost quarantine ${quarantineRoot}`, error);
    });
    const names = await readdir(quarantineRoot);
    names.sort(compareReplacementNames);
    const after = await lstat(quarantineRoot, { bigint: true }).catch((error) => {
      throw replacementChanged(label, path, `lost quarantine ${quarantineRoot}`, error);
    });
    if (
      !before.isDirectory()
      || !after.isDirectory()
      || !sameReplacementIdentity(quarantineIdentity, replacementIdentity(before))
      || !sameReplacementIdentity(quarantineIdentity, replacementIdentity(after))
      || names.length !== expectedNames.length
      || names.some((name, index) => name !== expectedNames[index])
    ) {
      throw replacementChanged(label, path, `had quarantine ${quarantineRoot} replaced`);
    }
  };
  const quarantineNamesForMutation = (mutation, after) => {
    const ordered = (...names) => names.sort(compareReplacementNames);
    if (mutation.action === "mkdir") return after ? [] : null;
    if (mutation.action === "rmdir") return after ? null : [];
    if (mutation.action === "rename") {
      if (after) return [basename(mutation.target)];
      return resolve(mutation.path) === resolve(path) ? [] : [basename(mutation.path)];
    }
    if (mutation.action === "link-canonical") {
      return after ? [basename(mutation.target)] : [];
    }
    if (mutation.action === "remove-canonical") {
      return [basename(mutation.target)];
    }
    if (mutation.action === "link-slot") {
      return after
        ? ordered(basename(mutation.path), basename(mutation.target))
        : [basename(mutation.path)];
    }
    if (mutation.action === "remove-source") {
      return after
        ? [basename(mutation.target)]
        : ordered(basename(mutation.path), basename(mutation.target));
    }
    if (mutation.action === "remove") return after ? [] : [basename(mutation.path)];
    if (mutation.action === "link") return [basename(mutation.path)];
    throw replacementChanged(label, path, `used an unknown quarantine mutation`);
  };
  const assertQuarantineMutation = async (mutation, after) => {
    const expectedNames = quarantineNamesForMutation(mutation, after);
    if (expectedNames === null) {
      await assertQuarantineMissing();
      return;
    }
    if (mutation.action === "mkdir" && quarantineIdentity === null) {
      const state = await lstat(quarantineRoot, { bigint: true }).catch((error) => {
        throw replacementChanged(label, path, `lost quarantine ${quarantineRoot}`, error);
      });
      if (!state.isDirectory()) {
        throw replacementChanged(label, path, `created a non-directory quarantine`);
      }
      quarantineIdentity = replacementIdentity(state);
    }
    await assertQuarantine(expectedNames);
  };
  const guardedBeforeMutation = async (mutation) => {
    await assertQuarantineMutation(mutation, false);
    await beforeMutation?.(mutation);
    await assertQuarantineMutation(mutation, false);
  };
  const guardedAfterMutation = async (mutation) => {
    await assertQuarantineMutation(mutation, true);
    await afterMutation?.(mutation);
    await assertQuarantineMutation(mutation, true);
  };

  try {
    const quarantineMutation = { action: "mkdir", path: quarantineRoot };
    const quarantineTemplate = {
      root: { type: "directory", identity: null, mode: 0o700 },
      entries: [],
    };
    quarantineTemplate.hash = directoryManifestHash(quarantineTemplate);
    const quarantineOwnership = { identity: null, manifest: null };
    await reserveReplacementDirectory(quarantineRoot, quarantineTemplate, {
      before: async () => {
        await assertQuarantineMissing();
        await beforeMutation?.(quarantineMutation);
        await assertQuarantineMissing();
      },
      after: async (reserved) => {
        quarantineIdentity = reserved.root.identity;
        await assertQuarantine([]);
        await afterMutation?.(quarantineMutation);
        await assertQuarantine([]);
      },
      label,
      target: path,
      ownership: quarantineOwnership,
      makeDirectory,
      finalizeMode: true,
    });
    quarantineCreated = true;
  } catch (error) {
    failures.push({ label: `${label} quarantine creation`, error });
    retainedPaths.push(path);
    if (!(await replacementPathIsMissing(quarantineRoot))) retainedPaths.push(quarantineRoot);
    return { failures, retainedPaths };
  }

  try {
    if (exclusiveTransfer) {
      await performGuardedFileMutation(
        { action: "link-canonical", path, target: quarantined },
        () => linkPath(path, quarantined),
        guardedBeforeMutation,
        guardedAfterMutation,
      );
      await performGuardedFileMutation(
        { action: "remove-canonical", path, target: quarantined },
        async () => {
          await assertExactFileBeforeRemoval(path, expected, label);
          return removePath(path);
        },
        guardedBeforeMutation,
        guardedAfterMutation,
      );
    } else {
      await performGuardedFileMutation(
        { action: "rename", path, target: quarantined },
        () => renamePath(path, quarantined),
        guardedBeforeMutation,
        guardedAfterMutation,
      );
    }
    quarantinedEntry = true;
  } catch (error) {
    try {
      await assertQuarantine([basename(quarantined)]);
      quarantinedEntry = true;
    } catch {
      // The authenticated quarantine root and any opaque entries are retained below.
    }
    if (quarantinedEntry) {
      failures.push({ label: `${label} quarantine`, error });
      retainedPaths.push(quarantineRoot);
      return { failures, retainedPaths };
    }
    if (error?.code !== "ENOENT" || !allowMissing) {
      failures.push({ label: `${label} quarantine`, error });
      retainedPaths.push(path);
    }
  }

  if (!quarantinedEntry) {
    try {
      await performGuardedFileMutation(
        { action: "rmdir", path: quarantineRoot },
        () => removeDirectory(quarantineRoot),
        guardedBeforeMutation,
        guardedAfterMutation,
      );
      quarantineCreated = false;
    } catch (error) {
      failures.push({ label: `${label} quarantine cleanup`, error });
      retainedPaths.push(quarantineRoot);
    }
    return { failures, retainedPaths };
  }

  let quarantinedState;
  try {
    quarantinedState = await lstat(quarantined, { bigint: true });
  } catch (error) {
    failures.push({ label: `${label} identity verification`, error });
    retainedPaths.push(quarantined);
    return { failures, retainedPaths };
  }

  const quarantinedIdentity = boundFileIdentity(quarantinedState);
  if (quarantinedState.isFile() && sameBoundFileIdentity(quarantinedIdentity, expectedIdentity)) {
    const unlink = await unlinkIdentityBoundQuarantine(
      quarantined,
      expected,
      label,
      {
        beforeMutation: guardedBeforeMutation,
        afterMutation: guardedAfterMutation,
        linkPath,
        removePath,
      },
    );
    if (unlink.error) {
      failures.push({ label: `${label} unlink`, error: unlink.error });
      retainedPaths.push(unlink.retainedPath);
    } else {
      quarantinedEntry = false;
    }
  } else {
    let restored = false;
    if (!quarantinedState.isDirectory()) {
      try {
        await performGuardedFileMutation(
          { action: "link", path: quarantined, target: path },
          () => linkPath(quarantined, path),
          guardedBeforeMutation,
          guardedAfterMutation,
        );
        restored = true;
      } catch (error) {
        if (error?.code !== "EEXIST") {
          failures.push({ label: `${label} opaque replacement restoration`, error });
        }
      }
    }
    if (restored) {
      const unlink = await unlinkIdentityBoundQuarantine(
        quarantined,
        quarantinedIdentity,
        `${label} opaque quarantine`,
        {
          beforeMutation: guardedBeforeMutation,
          afterMutation: guardedAfterMutation,
          linkPath,
          removePath,
        },
      );
      if (unlink.error) {
        failures.push({ label: `${label} opaque quarantine unlink`, error: unlink.error });
        retainedPaths.push(unlink.retainedPath);
      } else {
        quarantinedEntry = false;
      }
      retainedPaths.push(path);
    } else {
      retainedPaths.push(quarantined);
    }
    failures.push({
      label: `${label} cleanup`,
      error: new Error("Opaque replacement preserved instead of being unlinked."),
    });
  }

  if (quarantineCreated && !quarantinedEntry) {
    try {
      await performGuardedFileMutation(
        { action: "rmdir", path: quarantineRoot },
        () => removeDirectory(quarantineRoot),
        guardedBeforeMutation,
        guardedAfterMutation,
      );
    } catch (error) {
      failures.push({ label: `${label} quarantine cleanup`, error });
      retainedPaths.push(quarantineRoot);
    }
  }
  return { failures, retainedPaths };
}

async function cleanupAuthenticatedBackup(path, backup, snapshot, cleanupHooks) {
  const cleanup = await removeOwnedPathWithQuarantine(backup, snapshot, {
    allowMissing: false,
    label: "Atomic write backup",
    ...cleanupHooks,
  });
  if (cleanup.failures.length > 0) {
    throw atomicWriteRecoveryFailure(
      path,
      "Atomic file write could not clean up its authenticated backup.",
      cleanup.failures,
      cleanup.retainedPaths,
    );
  }
}

export async function removeBoundRegularFile(
  path,
  expected,
  {
    ownerRoot = null,
    label = "File",
    beforeCleanup = null,
    beforeQuarantine = null,
    afterQuarantine = null,
    beforeRemovalMutation = null,
  } = {},
) {
  const absolutePath = resolve(path);
  const ownerAuthority = await resolveReplacementOwner(ownerRoot, absolutePath, label);
  const ancestors = bindReplacementOwner(
    await captureReplacementAncestors(
      dirname(absolutePath),
      label,
      absolutePath,
      ownerAuthority,
    ),
    ownerAuthority,
  );
  const assertAuthority = () => assertReplacementAuthority(
    ancestors,
    label,
    absolutePath,
  );
  await assertAuthority();
  const observed = await readExpectedFile(absolutePath, expected, ownerAuthority.path);
  await assertAuthority();
  await invokeReplacementHook(
    beforeCleanup,
    { path: absolutePath, target: absolutePath, ownerRoot: ownerAuthority.path },
    async () => {
      await assertAuthority();
      await readExpectedFile(absolutePath, observed, ownerAuthority.path);
      await assertAuthority();
    },
    `${label} before-cleanup hook`,
    absolutePath,
  );
  let quarantined = false;
  const firstQuarantineRename = (mutation) => (
    mutation.action === "rename" || mutation.action === "remove-canonical"
  )
    && resolve(mutation.path) === absolutePath
    && !quarantined;
  const assertOriginalMissing = async () => {
    await assertAuthority();
    await assertReplacementPathMissing(absolutePath, label, absolutePath);
    await assertAuthority();
  };
  const beforeMutation = async (mutation) => {
    await assertAuthority();
    if (mutation.action === "mkdir" && beforeQuarantine) {
      await invokeReplacementHook(
        beforeQuarantine,
        {
          path: absolutePath,
          quarantine: mutation.path,
          ownerRoot: ownerAuthority.path,
        },
        assertAuthority,
        `${label} before-quarantine hook`,
        absolutePath,
      );
    }
    if (firstQuarantineRename(mutation)) {
      await readExpectedFile(absolutePath, observed, ownerAuthority.path);
    } else if (quarantined) {
      await assertOriginalMissing();
    }
    if (
      beforeRemovalMutation
      && ["remove-canonical", "remove-source", "remove"].includes(mutation.action)
    ) {
      await beforeRemovalMutation({
        ...mutation,
        ownerRoot: ownerAuthority.path,
      });
    }
  };
  const afterMutation = async (mutation) => {
    const firstRename = firstQuarantineRename(mutation);
    if (firstRename) quarantined = true;
    if (quarantined) await assertOriginalMissing();
    else await assertAuthority();
    if (firstRename) {
      const assertQuarantineCurrent = async () => {
        await assertOriginalMissing();
        await readExpectedFile(mutation.target, observed, ownerAuthority.path);
        await assertOriginalMissing();
      };
      await invokeReplacementHook(
        afterQuarantine,
        {
          path: absolutePath,
          quarantine: mutation.target,
          ownerRoot: ownerAuthority.path,
        },
        assertQuarantineCurrent,
        `${label} after-quarantine hook`,
        absolutePath,
      );
    }
  };
  const cleanup = await removeOwnedPathWithQuarantine(absolutePath, observed, {
    allowMissing: false,
    label,
    beforeMutation,
    afterMutation,
  });
  if (cleanup.failures.length > 0) {
    throw atomicWriteRecoveryFailure(
      absolutePath,
      `${label} could not be removed safely.`,
      cleanup.failures,
      cleanup.retainedPaths,
    );
  }
  try {
    await assertOriginalMissing();
    await syncDirectory(dirname(absolutePath));
    await assertOriginalMissing();
  } catch (error) {
    throw atomicWriteRecoveryFailure(
      absolutePath,
      `${label} was removed but a concurrent replacement was preserved.`,
      [{ label: `${label} replacement`, error }],
      [absolutePath],
    );
  }
  return observed;
}

async function assertPublishedFile(path, expected, ownerRoot) {
  let current;
  try {
    current = await readBoundRegularFile(path, {
      ownerRoot,
      allowMissing: true,
      label: "Atomic write publication",
      unsafeCode: "CONCURRENT_CHANGE",
    });
  } catch (error) {
    throw atomicWriteChanged(path, "had its publication changed", error);
  }
  if (!expectedFileMatches(current, expected)) {
    throw atomicWriteChanged(path, current === null
      ? "had its publication removed"
      : "had its publication changed");
  }
  return current;
}

async function assertRetainedAtomicBackup(path, backup, snapshot, ownerRoot, primaryError) {
  try {
    await readExpectedFile(backup, snapshot, ownerRoot);
  } catch (error) {
    throw atomicWriteRecoveryFailure(
      path,
      "Atomic file write failed and its retained backup could not be authenticated.",
      [
        { label: "Original error", error: primaryError },
        { label: "Backup authentication", error },
      ],
      [backup],
    );
  }
}

async function invokeAtomicWriteHook(hook, value, assertAuthority) {
  if (hook === null || hook === undefined) return;
  await assertAuthority();
  await hook(value);
  await assertAuthority();
}

async function restoreAtomicBackup(
  path,
  backup,
  snapshot,
  ownerRoot,
  primaryError,
  cleanupHooks,
  assertAuthority,
) {
  try {
    await assertAuthority();
    await readExpectedFile(backup, snapshot, ownerRoot);
    await assertAuthority();
  } catch (error) {
    throw retainedAtomicBackup(
      path,
      backup,
      "changed before restoration",
      error,
      snapshot,
      ownerRoot,
    );
  }
  try {
    await performGuardedFileMutation(
      { action: "link", path: backup, target: path },
      () => link(backup, path),
      cleanupHooks.beforeMutation,
      cleanupHooks.afterMutation,
    );
  } catch (error) {
    if (error?.code === "EEXIST") {
      await assertRetainedAtomicBackup(path, backup, snapshot, ownerRoot, primaryError);
      throw retainedAtomicBackup(
        path,
        backup,
        "changed before restoration",
        primaryError,
        snapshot,
        ownerRoot,
      );
    }
    throw atomicWriteRecoveryFailure(
      path,
      "Atomic file write failed and its previous file could not be restored.",
      [
        { label: "Original error", error: primaryError },
        { label: "Restore error", error },
      ],
      [backup],
    );
  }

  try {
    await assertAuthority();
    await assertPublishedFile(path, snapshot, ownerRoot);
    await assertAuthority();
  } catch (error) {
    await assertRetainedAtomicBackup(path, backup, snapshot, ownerRoot, error);
    throw retainedAtomicBackup(
      path,
      backup,
      "changed during restoration",
      error,
      snapshot,
      ownerRoot,
    );
  }
  try {
    await cleanupAuthenticatedBackup(path, backup, snapshot, cleanupHooks);
  } catch (error) {
    throw atomicWriteRecoveryFailure(
      path,
      "Atomic file write failed and restoration cleanup was incomplete.",
      [
        { label: "Original error", error: primaryError },
        { label: "Backup cleanup", error },
      ],
    );
  }
}

async function publishExpectedFile(
  path,
  temporary,
  backup,
  expected,
  ownerRoot,
  staged,
  onPublished,
  afterBackup,
  afterPublish,
  cleanupHooks,
  publicationState,
  assertAuthority,
) {
  await assertAuthority();
  await readExpectedFile(path, expected, ownerRoot);
  await assertAuthority();
  try {
    await performGuardedFileMutation(
      { action: "link", path, target: backup },
      () => link(path, backup),
      cleanupHooks.beforeMutation,
      cleanupHooks.afterMutation,
    );
  } catch (error) {
    if (["EEXIST", "ENOENT", "ENOTDIR", "EISDIR", "ELOOP"].includes(error?.code)) {
      const collision = atomicWriteChanged(path, "could not reserve its backup path", error);
      collision.details.push(`Retained path: ${backup}`);
      throw collision;
    }
    throw error;
  }

  let moved;
  try {
    await assertAuthority();
    moved = await readBoundRegularFile(backup, {
      ownerRoot,
      label: "Atomic write backup",
      unsafeCode: "CONCURRENT_CHANGE",
    });
    await assertAuthority();
  } catch (error) {
    throw atomicWriteRecoveryFailure(
      path,
      "Atomic file write could not authenticate its exclusively reserved backup.",
      [{ label: "Backup authentication", error }],
      [backup],
    );
  }
  if (!expectedFileMatches(moved, expected)) {
    throw retainedAtomicBackup(path, backup, "changed before replacement");
  }

  const removal = await removeOwnedPathWithQuarantine(path, expected, {
    allowMissing: false,
    label: "Atomic write replacement target",
    ...cleanupHooks,
  });
  if (removal.failures.length > 0) {
    throw atomicWriteRecoveryFailure(
      path,
      "Atomic file write could not remove its authenticated replacement target.",
      removal.failures,
      [backup, ...removal.retainedPaths],
    );
  }

  try {
    await invokeAtomicWriteHook(
      afterBackup,
      { temporary, target: path, backup },
      assertAuthority,
    );
  } catch (error) {
    await restoreAtomicBackup(
      path,
      backup,
      moved,
      ownerRoot,
      error,
      cleanupHooks,
      assertAuthority,
    );
    throw error;
  }

  try {
    await performGuardedFileMutation(
      { action: "link", path: temporary, target: path },
      () => link(temporary, path),
      cleanupHooks.beforeMutation,
      cleanupHooks.afterMutation,
    );
    publicationState.linked = true;
  } catch (error) {
    const publicationError = [
      "EEXIST",
      "ENOENT",
      "ENOTDIR",
      "EISDIR",
      "ELOOP",
    ].includes(error?.code)
      ? atomicWriteChanged(path, "changed before publication", error)
      : error;
    await restoreAtomicBackup(
      path,
      backup,
      moved,
      ownerRoot,
      publicationError,
      cleanupHooks,
      assertAuthority,
    );
    throw publicationError;
  }

  let published;
  try {
    await assertAuthority();
    published = await assertPublishedFile(path, staged, ownerRoot);
    await invokeAtomicWriteHook(onPublished, published, assertAuthority);
    await invokeAtomicWriteHook(
      afterPublish,
      { temporary, target: path, backup },
      assertAuthority,
    );
    published = await assertPublishedFile(path, staged, ownerRoot);
    await assertAuthority();
  } catch (error) {
    try {
      await assertAuthority();
      await readExpectedFile(backup, expected, ownerRoot);
      await assertAuthority();
    } catch (backupError) {
      const failure = atomicWriteRecoveryFailure(
        path,
        "Atomic file publication and its authenticated backup both changed.",
        [
          { label: "Publication error", error },
          { label: "Backup authentication", error: backupError },
        ],
        [backup],
      );
      if (published !== undefined) failure.published = published;
      throw failure;
    }
    const failure = retainedAtomicBackup(
      path,
      backup,
      "changed after publication",
      error,
      moved,
      ownerRoot,
    );
    if (published !== undefined) failure.published = published;
    throw failure;
  }

  try {
    await cleanupAuthenticatedBackup(path, backup, moved, cleanupHooks);
    await assertAuthority();
  } catch (error) {
    if (error !== null && typeof error === "object") error.published = published;
    throw error;
  }
  return published;
}

async function syncDirectory(path) {
  let handle;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch {
    // Directory fsync is not supported consistently across all Node platforms.
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function syncDirectoryStrict(path) {
  let handle = null;
  let primaryError = null;
  try {
    handle = await open(
      path,
      fsConstants.O_RDONLY
        | (fsConstants.O_DIRECTORY ?? 0)
        | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const state = await handle.stat({ bigint: true });
    if (!state.isDirectory()) throw new Error(`Not a directory: ${path}`);
    await handle.sync();
  } catch (error) {
    primaryError = error;
  }
  if (handle) {
    await closeReplacementHandle(handle, primaryError, "Directory metadata sync", path);
  } else if (primaryError) {
    throw primaryError;
  }
}

async function assertAtomicWritePathsCurrent(
  path,
  temporary,
  source,
  temporaryIdentity,
  ownerRoot,
) {
  let staged;
  try {
    staged = await readBoundRegularFile(temporary, {
      ownerRoot,
      label: "Atomic write temporary file",
      unsafeCode: "CONCURRENT_CHANGE",
    });
    if (ownerRoot !== null && !(await isPathPhysicallyInside(ownerRoot, path))) {
      throw atomicWriteChanged(path, "escaped its owner root");
    }
  } catch (error) {
    if (error?.code === "CONCURRENT_CHANGE") throw error;
    if (["ENOENT", "ENOTDIR", "ELOOP"].includes(error?.code)) {
      throw atomicWriteChanged(path, "changed", error);
    }
    throw error;
  }
  const expectedBytes = Buffer.isBuffer(source) ? source : Buffer.from(source, "utf8");
  if (
    !sameBoundFileIdentity(staged.identity, temporaryIdentity)
    || !staged.bytes.equals(expectedBytes)
  ) {
    throw atomicWriteChanged(path, "had its staged file changed");
  }
  return staged;
}

function atomicWriterRecoveryFailure(
  path,
  primaryError,
  failures,
  retainedPaths,
  published,
) {
  const errors = [
    ...(primaryError ? [{ label: "Original error", error: primaryError }] : []),
    ...failures,
  ];
  const failure = new SddError(
    primaryError
      ? "Atomic file write failed and cleanup was incomplete."
      : "Atomic file write completed but cleanup was incomplete.",
    {
      code: "MUTATION_RECOVERY_FAILED",
      details: [
        ...(published ? [`Published path: ${path}`] : []),
        ...errors.map(({ label, error }) => `${label}: ${error.message}`),
        ...(primaryError?.details ?? []).map((detail) => `Original detail: ${detail}`),
        ...[...new Set(retainedPaths)].map(
          (retainedPath) => `Retained path: ${retainedPath}`,
        ),
      ],
    },
  );
  failure.errors = errors.map(({ error }) => error);
  failure.cause = new AggregateError(failure.errors, failure.message);
  if (primaryError?.retainedBackup) failure.retainedBackup = primaryError.retainedBackup;
  return failure;
}

async function inferAtomicWriteOwnerRoot(path) {
  let candidate = dirname(path);
  while (true) {
    try {
      const state = await stat(candidate);
      if (!state.isDirectory()) {
        throw atomicWriteChanged(path, `has non-directory parent ${candidate}`);
      }
      return candidate;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw error;
      candidate = parent;
    }
  }
}

export async function writeFileAtomically(
  path,
  source,
  {
    expected,
    beforePublish = null,
    afterBackup = null,
    afterPublish = null,
    onPublished = null,
    ownerRoot = null,
    openFile = open,
    cleanupRename = rename,
    cleanupMkdir = mkdir,
    cleanupRmdir = rmdir,
  } = {},
) {
  path = resolve(path);
  const parent = dirname(path);
  const effectiveOwnerRoot = ownerRoot ?? await inferAtomicWriteOwnerRoot(path);
  const ownerAuthority = await resolveReplacementOwner(
    effectiveOwnerRoot,
    path,
    "Atomic file write",
  );
  ownerRoot = ownerAuthority.path;
  const expectsAbsence = expected === null || expected?.missing === true;
  let prevalidatedBindings = null;
  if (expected?.ownerBinding && typeof expected.ownerBinding === "object") {
    prevalidatedBindings = await captureExistingReplacementAncestors(
      parent,
      "Atomic file write",
      path,
      ownerAuthority,
    );
    const currentOwnerBinding = {
      path: ownerAuthority.path,
      binding: ownerAuthority.binding,
      ancestors: prevalidatedBindings,
    };
    if (!sameBoundFileOwner(currentOwnerBinding, expected.ownerBinding)) {
      throw atomicWriteChanged(path, "changed owner authority before staging");
    }
    if (expectsAbsence) {
      await assertReplacementPathMissing(path, "Atomic file write", path);
    } else {
      const current = await readExpectedFile(path, expected, ownerRoot);
      if (!expectedFileMatches(current, expected)) {
        throw atomicWriteChanged(path, "changed before staging");
      }
    }
  }
  const authorityBindings = bindReplacementOwner(
    prevalidatedBindings !== null && !expectsAbsence
      ? prevalidatedBindings
      : await ensureReplacementParent(
        parent,
        "Atomic file write",
        path,
        ownerAuthority,
        prevalidatedBindings ?? [],
        prevalidatedBindings !== null && expectsAbsence,
      ),
    ownerAuthority,
  );
  const assertAuthority = () =>
    assertReplacementAuthority(authorityBindings, "Atomic file write", path);
  const nonce = `${process.pid}-${randomUUID()}`;
  const temporary = join(parent, `.${basename(path)}.sdd-write-${nonce}`);
  const backup = join(parent, `.${basename(path)}.sdd-write-backup-${nonce}`);
  const cleanupHooks = {
    renamePath: cleanupRename,
    makeDirectory: cleanupMkdir,
    removeDirectory: cleanupRmdir,
    beforeMutation: assertAuthority,
    afterMutation: assertAuthority,
  };

  await assertAuthority();
  const existingMode = await stat(path).then((value) => value.mode & 0o777).catch((error) => {
    if (error?.code === "ENOENT") return 0o600;
    throw error;
  });
  await assertAuthority();

  let handle = null;
  let temporaryIdentity = null;
  let initialCloseError = null;
  let primaryError = null;
  const publicationState = { linked: false };
  let staged = null;
  let published = null;
  try {
    await assertAuthority();
    handle = await openFile(temporary, "wx", existingMode);
    await assertAuthority();
    const createdState = await handle.stat({ bigint: true });
    if (!createdState.isFile()) {
      throw atomicWriteChanged(path, "created a non-file temporary");
    }
    temporaryIdentity = boundFileIdentity(createdState);
    await assertAuthority();
    await handle.writeFile(source, "utf8");
    await handle.sync();
    await assertAuthority();
    try {
      await handle.close();
      handle = null;
      await assertAuthority();
    } catch (error) {
      initialCloseError = error;
      throw error;
    }

    await invokeAtomicWriteHook(
      beforePublish,
      { temporary, temporaryIdentity, target: path, backup },
      assertAuthority,
    );
    staged = await assertAtomicWritePathsCurrent(
      path,
      temporary,
      source,
      temporaryIdentity,
      ownerRoot,
    );
    await assertAuthority();
    if (expected === undefined) {
      await performGuardedFileMutation(
        { action: "rename", path: temporary, target: path },
        () => rename(temporary, path),
        assertAuthority,
        assertAuthority,
      );
      publicationState.linked = true;
      published = await assertPublishedFile(path, staged, ownerRoot);
      await invokeAtomicWriteHook(onPublished, published, assertAuthority);
      await invokeAtomicWriteHook(
        afterPublish,
        { temporary, target: path, backup },
        assertAuthority,
      );
      published = await assertPublishedFile(path, staged, ownerRoot);
      await assertAuthority();
    } else if (expectsAbsence) {
      try {
        await performGuardedFileMutation(
          { action: "link", path: temporary, target: path },
          () => link(temporary, path),
          assertAuthority,
          assertAuthority,
        );
        publicationState.linked = true;
      } catch (error) {
        if (["EEXIST", "ENOENT", "ENOTDIR", "EISDIR", "ELOOP"].includes(error?.code)) {
          throw atomicWriteChanged(path, "collided with another file", error);
        }
        throw error;
      }
      published = await assertPublishedFile(path, staged, ownerRoot);
      await invokeAtomicWriteHook(onPublished, published, assertAuthority);
      await invokeAtomicWriteHook(
        afterPublish,
        { temporary, target: path, backup },
        assertAuthority,
      );
      published = await assertPublishedFile(path, staged, ownerRoot);
      await assertAuthority();
    } else {
      published = await publishExpectedFile(
        path,
        temporary,
        backup,
        expected,
        ownerRoot,
        staged,
        onPublished,
        afterBackup,
        afterPublish,
        cleanupHooks,
        publicationState,
        assertAuthority,
      );
    }
  } catch (error) {
    primaryError = error;
  }

  const closeFailures = [];
  if (handle) {
    try {
      await handle.close();
    } catch (error) {
      closeFailures.push({ label: "Temporary file close retry", error });
    }
    handle = null;
  }

  let cleanup = { failures: [], retainedPaths: [] };
  if (temporaryIdentity !== null) {
    try {
      cleanup = await removeOwnedPathWithQuarantine(temporary, staged ?? temporaryIdentity, {
        allowMissing: true,
        label: "Atomic write temporary file",
        ...cleanupHooks,
      });
    } catch (error) {
      cleanup = {
        failures: [{ label: "Temporary file cleanup", error }],
        retainedPaths: [temporary],
      };
    }
  } else {
    try {
      await assertAuthority();
      await lstat(temporary);
      await assertAuthority();
      cleanup = {
        failures: [{
          label: "Temporary file cleanup",
          error: new Error("Temporary file identity was not captured; path was preserved."),
        }],
        retainedPaths: [temporary],
      };
    } catch (error) {
      if (error?.code !== "ENOENT") {
        cleanup = {
          failures: [{ label: "Temporary file inspection", error }],
          retainedPaths: [temporary],
        };
      }
    }
  }

  const authorityFailures = [];
  try {
    await assertAuthority();
    if (publicationState.linked) await syncDirectory(parent);
    await assertAuthority();
  } catch (error) {
    authorityFailures.push({ label: "Atomic write authority verification", error });
  }
  const recoveryFailures = [...closeFailures, ...cleanup.failures, ...authorityFailures];
  if (initialCloseError || recoveryFailures.length > 0) {
    const failure = atomicWriterRecoveryFailure(
      path,
      primaryError,
      recoveryFailures,
      cleanup.retainedPaths,
      publicationState.linked,
    );
    if (published !== null) failure.published = published;
    throw failure;
  }
  if (primaryError) {
    if (published !== null) primaryError.published = published;
    throw primaryError;
  }
  return published;
}

function replacementIdentity(state) {
  return { dev: String(state.dev), ino: String(state.ino) };
}

function replacementMode(state) {
  return Number(state.mode & 0o777n);
}

function replacementType(state) {
  if (state.isDirectory()) return "directory";
  if (state.isFile()) return "file";
  if (state.isSymbolicLink()) return "symlink";
  return "other";
}

function sameReplacementIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino;
}

function replacementChanged(label, path, reason, error = null) {
  const failure = new SddError(`${label} ${reason}: ${path}`, {
    code: "CONCURRENT_CHANGE",
    details: error ? [error.message] : [],
  });
  if (error) {
    failure.errors = [error];
    failure.cause = error;
  }
  return failure;
}

function replacementCombinedFailure(label, path, failures) {
  const error = new SddError(`${label} changed during a filesystem operation: ${path}`, {
    code: "CONCURRENT_CHANGE",
    details: failures.map(({ label: failureLabel, error: failure }) =>
      `${failureLabel}: ${failure.message}`),
  });
  error.errors = failures.map(({ error: failure }) => failure);
  error.cause = new AggregateError(error.errors, error.message);
  return error;
}

function replacementRecoveryFailure(
  kind,
  target,
  primaryError,
  failures,
  retainedPaths,
  backup = null,
  published = false,
  authenticatedBackups = [],
) {
  const errors = [
    ...(primaryError ? [{ label: "Original error", error: primaryError }] : []),
    ...failures,
  ];
  const authenticated = [...new Set(authenticatedBackups.filter(Boolean))];
  const authenticatedSet = new Set(authenticated);
  const retained = [...new Set([
    ...retainedPaths.filter(Boolean),
    ...authenticated,
  ])];
  const error = new SddError(
    primaryError
      ? `${kind} replacement failed and recovery was incomplete.`
      : `${kind} replacement completed but cleanup was incomplete.`,
    {
      code: "MUTATION_RECOVERY_FAILED",
      details: [
        ...(published ? [`Published path: ${target}`] : []),
        ...errors.map(({ label, error: failure }) => `${label}: ${failure.message}`),
        ...errors.flatMap(({ label, error: failure }) =>
          (failure?.details ?? []).map((detail) => `${label} detail: ${detail}`)),
        ...authenticated.map((path) => `Retained backup: ${path}`),
        ...(
          backup !== null
          && retained.includes(backup)
          && !authenticatedSet.has(backup)
            ? [`Concurrent/opaque retained path: ${backup}`]
            : []
        ),
        ...retained.map((path) => `Retained path: ${path}`),
      ],
    },
  );
  error.errors = errors.map(({ error: failure }) => failure);
  error.cause = new AggregateError(error.errors, error.message);
  return error;
}

async function findAuthenticatedRetainedBackup(
  kind,
  backup,
  manifest,
  retainedPaths,
  label,
  target,
) {
  if (backup === null || manifest === null) return [];
  const backupPath = resolve(backup);
  const parent = dirname(backupPath);
  const candidates = new Set(
    retainedPaths
      .filter(Boolean)
      .map((path) => resolve(path)),
  );
  try {
    const names = await readdir(parent);
    names.sort(compareReplacementNames);
    for (const name of names) {
      candidates.add(join(parent, name));
    }
  } catch {
    // Existing retained paths can still be authenticated independently.
  }

  const authenticated = [];
  for (const candidate of candidates) {
    try {
      const observed = kind === "File"
        ? await captureReplacementFile(candidate, label, target, { allowMissing: true })
        : await captureReplacementDirectory(candidate, label, target, { allowMissing: true });
      const matches = kind === "File"
        ? sameReplacementFile(observed, manifest)
        : sameReplacementDirectory(observed, manifest);
      if (matches) authenticated.push(candidate);
    } catch {
      // Opaque, missing, or concurrently changing paths are not labeled as backups.
    }
  }
  return authenticated;
}

function replacementDurabilityFailure(label, target, path, phase, error) {
  const failure = new SddError(
    `${label} could not durably record ${phase} metadata: ${path}`,
    {
      code: "MUTATION_RECOVERY_FAILED",
      details: [error.message],
    },
  );
  failure.errors = [error];
  failure.cause = error;
  return failure;
}

async function syncReplacementMetadata(
  path,
  {
    phase,
    relativePath = null,
    guard,
    syncDirectoryPath,
    publication,
    label,
    target,
  },
) {
  await guard();
  let syncError = null;
  try {
    await syncDirectoryPath(path, {
      ...publication,
      phase,
      relativePath,
      path,
    });
  } catch (error) {
    syncError = error;
  }
  let stateError = null;
  try {
    await guard();
  } catch (error) {
    stateError = error;
  }
  if (syncError && stateError) {
    throw replacementCombinedFailure(label, target, [
      { label: `${phase} fsync`, error: syncError },
      { label: `${phase} post-fsync state`, error: stateError },
    ]);
  }
  if (stateError) throw stateError;
  if (syncError) {
    throw replacementDurabilityFailure(label, target, path, phase, syncError);
  }
}

async function syncReplacementTree(
  root,
  manifest,
  {
    phase,
    guard,
    syncDirectoryPath,
    publication,
    label,
    target,
  },
) {
  const directories = manifest.entries
    .filter((entry) => entry.type === "directory")
    .reverse()
    .map((entry) => ({
      path: join(root, ...entry.relativePath.split("/")),
      relativePath: entry.relativePath,
    }));
  directories.push({ path: root, relativePath: null });
  for (const directory of directories) {
    await syncReplacementMetadata(directory.path, {
      phase,
      relativePath: directory.relativePath,
      guard,
      syncDirectoryPath,
      publication,
      label,
      target,
    });
  }
}

function randomizedReplacementNonce() {
  const random = BigInt(`0x${randomUUID().replaceAll("-", "")}`).toString(10);
  return `${process.pid}-${random}`;
}

const replacementOwnerRoots = new WeakMap();

function unsafeReplacementOwner(label, target, reason, error = null) {
  return new SddError(`${label} ${reason}: ${target}`, {
    code: "UNSAFE_REPLACEMENT_PATH",
    details: error ? [error.message] : [],
  });
}

async function assertReplacementOwnerCurrent(ownerAuthority, target, label) {
  const current = await observeReplacementAncestor(ownerAuthority.path, label, target);
  if (!sameReplacementAncestor(current, ownerAuthority.binding)) {
    throw replacementChanged(
      label,
      target,
      `had owner root ${ownerAuthority.path} replaced`,
    );
  }
  if (!(await isPathPhysicallyInside(ownerAuthority.path, target))) {
    throw replacementChanged(label, target, `escaped its owner root ${ownerAuthority.path}`);
  }
  const after = await observeReplacementAncestor(ownerAuthority.path, label, target);
  if (!sameReplacementAncestor(after, ownerAuthority.binding)) {
    throw replacementChanged(
      label,
      target,
      `had owner root ${ownerAuthority.path} replaced`,
    );
  }
}

async function resolveReplacementOwner(ownerRoot, target, label) {
  if (typeof ownerRoot !== "string" || ownerRoot.trim() === "") {
    throw unsafeReplacementOwner(label, target, "requires ownerRoot");
  }
  const absoluteOwner = resolve(ownerRoot);
  const absoluteTarget = resolve(target);
  if (absoluteOwner === absoluteTarget || !isPathInside(absoluteOwner, absoluteTarget)) {
    throw unsafeReplacementOwner(label, target, `is outside owner root ${absoluteOwner}`);
  }
  try {
    const binding = await observeReplacementAncestor(absoluteOwner, label, absoluteTarget);
    if (!(await isPathPhysicallyInside(absoluteOwner, absoluteTarget))) {
      throw replacementChanged(label, target, `escaped its owner root ${absoluteOwner}`);
    }
    const authority = { path: absoluteOwner, binding };
    await assertReplacementOwnerCurrent(authority, absoluteTarget, label);
    return authority;
  } catch (error) {
    throw unsafeReplacementOwner(label, target, `has an unsafe owner root ${absoluteOwner}`, error);
  }
}

function replacementPathPrefixes(path) {
  const prefixes = [];
  let candidate = resolve(path);
  while (true) {
    prefixes.push(candidate);
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  return prefixes.reverse();
}

async function observeReplacementAncestor(path, label, target) {
  let first;
  let followed;
  let second;
  try {
    first = await lstat(path, { bigint: true });
    followed = await stat(path, { bigint: true });
    second = await lstat(path, { bigint: true });
  } catch (error) {
    throw replacementChanged(label, target, `has an unsafe ancestor ${path}`, error);
  }
  const lexicalType = replacementType(first);
  if (
    !["directory", "symlink"].includes(lexicalType)
    || !followed.isDirectory()
    || replacementType(second) !== lexicalType
    || !sameReplacementIdentity(replacementIdentity(first), replacementIdentity(second))
  ) {
    const failure = replacementChanged(label, target, `has an unsafe ancestor ${path}`);
    failure.details = [
      `First: ${lexicalType} ${first.dev}:${first.ino}`,
      `Followed: ${replacementType(followed)} ${followed.dev}:${followed.ino}`,
      `Second: ${replacementType(second)} ${second.dev}:${second.ino}`,
    ];
    throw failure;
  }
  return {
    path,
    lexicalType,
    lexicalIdentity: replacementIdentity(second),
    followedIdentity: replacementIdentity(followed),
  };
}

function sameReplacementAncestor(left, right) {
  return left.path === right.path
    && left.lexicalType === right.lexicalType
    && sameReplacementIdentity(left.lexicalIdentity, right.lexicalIdentity)
    && sameReplacementIdentity(left.followedIdentity, right.followedIdentity);
}

async function assertReplacementAncestors(bindings, label, target) {
  for (const binding of bindings) {
    const current = await observeReplacementAncestor(binding.path, label, target);
    if (!sameReplacementAncestor(current, binding)) {
      throw replacementChanged(label, target, `had ancestor ${binding.path} replaced`);
    }
  }
}

async function assertReplacementAuthority(bindings, label, target) {
  const ownerAuthority = replacementOwnerRoots.get(bindings) ?? null;
  if (ownerAuthority !== null) {
    await assertReplacementOwnerCurrent(ownerAuthority, target, label);
  }
  await assertReplacementAncestors(bindings, label, target);
  if (ownerAuthority !== null) {
    await assertReplacementOwnerCurrent(ownerAuthority, target, label);
  }
}

function bindReplacementOwner(bindings, ownerAuthority) {
  replacementOwnerRoots.set(bindings, ownerAuthority);
  return bindings;
}

async function captureReplacementAncestors(
  parent,
  label,
  target,
  ownerAuthority = null,
) {
  const bindings = [];
  const assertCurrent = async () => {
    if (ownerAuthority !== null) {
      await assertReplacementOwnerCurrent(ownerAuthority, target, label);
    }
    await assertReplacementAncestors(bindings, label, target);
    if (ownerAuthority !== null) {
      await assertReplacementOwnerCurrent(ownerAuthority, target, label);
    }
  };
  for (const prefix of replacementPathPrefixes(parent)) {
    await assertCurrent();
    bindings.push(await observeReplacementAncestor(prefix, label, target));
    await assertCurrent();
  }
  return bindings;
}

async function captureExistingReplacementAncestors(
  parent,
  label,
  target,
  ownerAuthority = null,
) {
  const bindings = [];
  const assertCurrent = async () => {
    if (ownerAuthority !== null) {
      await assertReplacementOwnerCurrent(ownerAuthority, target, label);
    }
    await assertReplacementAncestors(bindings, label, target);
    if (ownerAuthority !== null) {
      await assertReplacementOwnerCurrent(ownerAuthority, target, label);
    }
  };
  for (const prefix of replacementPathPrefixes(parent)) {
    await assertCurrent();
    try {
      bindings.push(await observeReplacementAncestor(prefix, label, target));
    } catch (error) {
      let stateError = null;
      try {
        await lstat(prefix);
      } catch (stateFailure) {
        stateError = stateFailure;
      }
      if (stateError?.code !== "ENOENT") throw error;
      await assertCurrent();
      return bindings;
    }
    await assertCurrent();
  }
  return bindings;
}

async function ensureReplacementParent(
  parent,
  label,
  target,
  ownerAuthority = null,
  initialBindings = [],
  requireMissingSuffix = false,
) {
  const bindings = [...initialBindings];
  const assertCurrent = async () => {
    if (ownerAuthority !== null) {
      await assertReplacementOwnerCurrent(ownerAuthority, target, label);
    }
    await assertReplacementAncestors(bindings, label, target);
    if (ownerAuthority !== null) {
      await assertReplacementOwnerCurrent(ownerAuthority, target, label);
    }
  };
  const prefixes = replacementPathPrefixes(parent);
  if (
    bindings.length > prefixes.length
    || bindings.some((binding, index) => binding.path !== prefixes[index])
  ) {
    throw replacementChanged(label, target, "had an invalid expected ancestor binding");
  }
  for (const prefix of prefixes.slice(bindings.length)) {
    await assertCurrent();
    let observed;
    if (requireMissingSuffix) {
      await assertReplacementPathMissing(prefix, label, target);
      await assertCurrent();
      try {
        await mkdir(prefix);
      } catch (mkdirError) {
        throw replacementChanged(label, target, `could not exclusively create ancestor ${prefix}`, mkdirError);
      }
      await assertCurrent();
      observed = await observeReplacementAncestor(prefix, label, target);
    } else {
      try {
        observed = await observeReplacementAncestor(prefix, label, target);
      } catch (error) {
        let stateError = null;
        try {
          await lstat(prefix);
        } catch (stateFailure) {
          stateError = stateFailure;
        }
        if (stateError?.code !== "ENOENT") throw error;
        await assertCurrent();
        try {
          await mkdir(prefix);
        } catch (mkdirError) {
          throw replacementChanged(label, target, `could not exclusively create ancestor ${prefix}`, mkdirError);
        }
        await assertCurrent();
        observed = await observeReplacementAncestor(prefix, label, target);
      }
    }
    bindings.push(observed);
    await assertCurrent();
  }
  return bindings;
}

async function assertReplacementPathMissing(path, label, target) {
  try {
    await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw replacementChanged(label, target, `could not verify missing path ${path}`, error);
  }
  throw replacementChanged(label, target, `collided with path ${path}`);
}

async function replacementPathIsMissing(path) {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    return false;
  }
}

function fileManifestHash(manifest) {
  return `sha256:${createHash("sha256").update(manifest.bytes).digest("hex")}`;
}

async function captureReplacementFile(path, label, target, { allowMissing = false } = {}) {
  let pathState;
  try {
    pathState = await lstat(path, { bigint: true });
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") return null;
    throw replacementChanged(label, target, `could not inspect ${path}`, error);
  }
  if (!pathState.isFile() || pathState.isSymbolicLink()) {
    throw replacementChanged(label, target, `expected a regular file at ${path}`);
  }

  let observed;
  try {
    observed = await readBoundRegularFile(path, {
      label,
      unsafeCode: "CONCURRENT_CHANGE",
    });
  } catch (error) {
    if (error?.code === "CONCURRENT_CHANGE") throw error;
    throw replacementChanged(label, target, `could not capture ${path}`, error);
  }
  const currentState = await lstat(path, { bigint: true }).catch((error) => {
    throw replacementChanged(label, target, `changed while capturing ${path}`, error);
  });
  if (
    !currentState.isFile()
    || !sameReplacementIdentity(replacementIdentity(pathState), observed.identity)
    || !sameReplacementIdentity(observed.identity, replacementIdentity(currentState))
    || replacementMode(pathState) !== replacementMode(currentState)
  ) {
    throw replacementChanged(label, target, `changed while capturing ${path}`);
  }
  const manifest = {
    type: "file",
    identity: observed.identity,
    mode: replacementMode(currentState),
    bytes: observed.bytes,
    source: observed.source,
  };
  manifest.hash = fileManifestHash(manifest);
  return manifest;
}

function sameReplacementFile(left, right) {
  return left !== null
    && right !== null
    && sameReplacementIdentity(left.identity, right.identity)
    && left.mode === right.mode
    && left.bytes.equals(right.bytes);
}

async function assertReplacementFile(path, expected, label, target) {
  const current = await captureReplacementFile(path, label, target, { allowMissing: true });
  if (!sameReplacementFile(current, expected)) {
    throw replacementChanged(label, target, `had ${path} replaced or modified`);
  }
  return current;
}


function compareReplacementNames(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}


const emptyReplacementHashPayload = Buffer.alloc(0);
const legacyDirectoryHashPattern = /^sha256:[a-f0-9]{64}$/;
export const DIRECTORY_HASH_SCHEME = "sha256-directory-v2";
const strongDirectoryHashPrefix = DIRECTORY_HASH_SCHEME;
const strongDirectoryHashPattern = new RegExp(`^${DIRECTORY_HASH_SCHEME}:[a-f0-9]{64}$`);

function updateReplacementHash(hash, length, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(length);
  hash.update(bytes);
}

function replacementHashMode(mode) {
  return mode.toString(8).padStart(4, "0");
}

function updateStrongDirectoryEntry(hash, length, type, relativePath, mode, payload) {
  updateReplacementHash(hash, length, type);
  updateReplacementHash(hash, length, relativePath);
  updateReplacementHash(hash, length, replacementHashMode(mode));
  updateReplacementHash(hash, length, payload);
}

function directoryManifestHash(manifest) {
  const hash = createHash("sha256");
  const length = Buffer.allocUnsafe(8);
  updateReplacementHash(hash, length, strongDirectoryHashPrefix);
  updateStrongDirectoryEntry(
    hash,
    length,
    manifest.root.type,
    "",
    manifest.root.mode,
    emptyReplacementHashPayload,
  );
  for (const entry of manifest.entries) {
    const payload = entry.type === "file"
      ? entry.bytes
      : entry.type === "symlink"
        ? entry.linkTarget
        : emptyReplacementHashPayload;
    updateStrongDirectoryEntry(hash, length, entry.type, entry.relativePath, entry.mode, payload);
  }
  return `${strongDirectoryHashPrefix}:${hash.digest("hex")}`;
}

const legacyDirectoryEntryOrder = Symbol("legacyDirectoryEntryOrder");

function setLegacyDirectoryEntryOrder(entry, order) {
  Object.defineProperty(entry, legacyDirectoryEntryOrder, { value: order });
  return entry;
}

function compareLegacyDirectoryEntries(left, right) {
  const leftOrder = left[legacyDirectoryEntryOrder];
  const rightOrder = right[legacyDirectoryEntryOrder];
  if (leftOrder && rightOrder) {
    const length = Math.min(leftOrder.length, rightOrder.length);
    for (let index = 0; index < length; index += 1) {
      if (leftOrder[index] !== rightOrder[index]) {
        return leftOrder[index] - rightOrder[index];
      }
    }
    return leftOrder.length - rightOrder.length;
  }
  return left.relativePath.localeCompare(right.relativePath);
}

// Released locks used this unversioned develop framing. A plain `sha256:` value
// always selects this algorithm; it must never be reinterpreted as the strong format.
function legacyDirectoryManifestHash(manifest) {
  const hash = createHash("sha256");
  for (const entry of [...manifest.entries].sort(compareLegacyDirectoryEntries)) {
    hash.update(`${entry.type}\0${entry.relativePath}\0`);
    if (entry.type === "file") hash.update(entry.bytes);
    else if (entry.type === "symlink") hash.update(entry.linkTarget.toString("utf8"));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

export function directoryHashVersion(value) {
  if (typeof value !== "string") return null;
  if (legacyDirectoryHashPattern.test(value)) return "legacy";
  if (strongDirectoryHashPattern.test(value)) return "strong";
  return null;
}

export function directoryHashMatches(hashes, expectedHash) {
  const version = directoryHashVersion(expectedHash);
  if (version === null) {
    throw new SddError(`Unsupported directory hash representation: ${String(expectedHash)}`, {
      code: "INVALID_DIRECTORY_HASH",
    });
  }
  return hashes[version] === expectedHash;
}

async function captureReplacementDirectory(
  root,
  label,
  target,
  { allowMissing = false } = {},
) {
  let rootState;
  try {
    rootState = await lstat(root, { bigint: true });
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") return null;
    throw replacementChanged(label, target, `could not inspect ${root}`, error);
  }
  if (!rootState.isDirectory() || rootState.isSymbolicLink()) {
    throw replacementChanged(label, target, `expected a directory at ${root}`);
  }

  const entries = [];
  async function collect(directory, relativeDirectory, expectedIdentity, legacyPrefix = []) {
    const before = await lstat(directory, { bigint: true }).catch((error) => {
      throw replacementChanged(label, target, `could not inspect ${directory}`, error);
    });
    if (
      !before.isDirectory()
      || !sameReplacementIdentity(replacementIdentity(before), expectedIdentity)
    ) {
      throw replacementChanged(label, target, `had directory ${directory} replaced`);
    }
    const names = await readdir(directory);
    const legacyNames = [...names].sort((left, right) => left.localeCompare(right));
    const legacyIndexes = new Map(legacyNames.map((name, index) => [name, index]));
    names.sort(compareReplacementNames);
    for (const name of names) {
      const absolutePath = join(directory, name);
      const relativePath = relativeDirectory === "" ? name : `${relativeDirectory}/${name}`;
      const state = await lstat(absolutePath, { bigint: true }).catch((error) => {
        throw replacementChanged(label, target, `changed entry ${absolutePath}`, error);
      });
      const type = replacementType(state);
      const legacyOrder = [...legacyPrefix, legacyIndexes.get(name)];
      if (type === "directory") {
        const entry = setLegacyDirectoryEntryOrder({
          type,
          relativePath,
          identity: replacementIdentity(state),
          mode: replacementMode(state),
        }, legacyOrder);
        entries.push(entry);
        await collect(absolutePath, relativePath, entry.identity, legacyOrder);
        const current = await lstat(absolutePath, { bigint: true }).catch((error) => {
          throw replacementChanged(label, target, `changed directory ${absolutePath}`, error);
        });
        if (
          !current.isDirectory()
          || !sameReplacementIdentity(entry.identity, replacementIdentity(current))
          || entry.mode !== replacementMode(current)
        ) {
          throw replacementChanged(label, target, `changed directory ${absolutePath}`);
        }
      } else if (type === "file") {
        const file = await captureReplacementFile(absolutePath, label, target);
        if (!sameReplacementIdentity(replacementIdentity(state), file.identity)) {
          throw replacementChanged(label, target, `changed file ${absolutePath}`);
        }
        entries.push(setLegacyDirectoryEntryOrder({ ...file, relativePath }, legacyOrder));
      } else if (type === "symlink") {
        const linkTarget = await readlink(absolutePath, { encoding: "buffer" }).catch((error) => {
          throw replacementChanged(label, target, `changed symlink ${absolutePath}`, error);
        });
        const current = await lstat(absolutePath, { bigint: true }).catch((error) => {
          throw replacementChanged(label, target, `changed symlink ${absolutePath}`, error);
        });
        if (
          !current.isSymbolicLink()
          || !sameReplacementIdentity(replacementIdentity(state), replacementIdentity(current))
        ) {
          throw replacementChanged(label, target, `changed symlink ${absolutePath}`);
        }
        entries.push(setLegacyDirectoryEntryOrder({
          type,
          relativePath,
          identity: replacementIdentity(current),
          mode: replacementMode(current),
          linkTarget,
        }, legacyOrder));
      } else {
        throw replacementChanged(label, target, `contains unsupported entry ${absolutePath}`);
      }
    }
    const currentNames = await readdir(directory);
    currentNames.sort(compareReplacementNames);
    const after = await lstat(directory, { bigint: true }).catch((error) => {
      throw replacementChanged(label, target, `changed directory ${directory}`, error);
    });
    if (
      names.length !== currentNames.length
      || names.some((name, index) => name !== currentNames[index])
      || !after.isDirectory()
      || !sameReplacementIdentity(expectedIdentity, replacementIdentity(after))
      || replacementMode(before) !== replacementMode(after)
    ) {
      throw replacementChanged(label, target, `changed directory ${directory}`);
    }
  }

  const rootIdentity = replacementIdentity(rootState);
  await collect(root, "", rootIdentity);
  const currentRoot = await lstat(root, { bigint: true }).catch((error) => {
    throw replacementChanged(label, target, `changed directory ${root}`, error);
  });
  if (
    !currentRoot.isDirectory()
    || !sameReplacementIdentity(rootIdentity, replacementIdentity(currentRoot))
    || replacementMode(rootState) !== replacementMode(currentRoot)
  ) {
    throw replacementChanged(label, target, `changed directory ${root}`);
  }
  const manifest = {
    root: {
      type: "directory",
      identity: rootIdentity,
      mode: replacementMode(currentRoot),
    },
    entries,
  };
  manifest.hash = directoryManifestHash(manifest);
  return manifest;
}

function sameReplacementDirectoryEntry(left, right, { identities = true } = {}) {
  if (
    left?.type !== right?.type
    || left?.relativePath !== right?.relativePath
    || (identities && !sameReplacementIdentity(left.identity, right.identity))
  ) {
    return false;
  }
  if (left.type === "directory") return left.mode === right.mode;
  if (left.type === "file") return left.mode === right.mode && left.bytes.equals(right.bytes);
  return left.mode === right.mode
    && Buffer.isBuffer(left.linkTarget)
    && Buffer.isBuffer(right.linkTarget)
    && left.linkTarget.equals(right.linkTarget);
}

function sameReplacementDirectory(left, right, { identities = true } = {}) {
  return left !== null
    && right !== null
    && (!identities || sameReplacementIdentity(left.root.identity, right.root.identity))
    && left.root.mode === right.root.mode
    && left.entries.length === right.entries.length
    && left.entries.every((entry, index) =>
      sameReplacementDirectoryEntry(entry, right.entries[index], { identities }));
}

async function assertReplacementDirectory(path, expected, label, target) {
  const current = await captureReplacementDirectory(path, label, target, { allowMissing: true });
  if (!sameReplacementDirectory(current, expected)) {
    throw replacementChanged(label, target, `had directory ${path} replaced or modified`);
  }
  return current;
}

async function assertReplacementGuard({
  ancestors,
  label,
  target,
  files = [],
  directories = [],
  missing = [],
}) {
  await assertReplacementAuthority(ancestors, label, target);
  for (const { path, manifest } of files) {
    await assertReplacementFile(path, manifest, label, target);
  }
  for (const { path, manifest } of directories) {
    await assertReplacementDirectory(path, manifest, label, target);
  }
  for (const path of missing) {
    await assertReplacementPathMissing(path, label, target);
  }
  await assertReplacementAuthority(ancestors, label, target);
}

async function invokeReplacementHook(hook, args, check, label, target) {
  if (!hook) return;
  await check();
  let hookError = null;
  try {
    await hook(args);
  } catch (error) {
    hookError = error;
  }
  let stateError = null;
  try {
    await check();
  } catch (error) {
    stateError = error;
  }
  if (hookError && stateError) {
    throw replacementCombinedFailure(label, target, [
      { label: "Hook error", error: hookError },
      { label: "Post-hook state", error: stateError },
    ]);
  }
  if (stateError) throw stateError;
  if (hookError) throw hookError;
}

async function performReplacementMutation(
  operation,
  { before, after, label, target },
) {
  await before();
  let value;
  try {
    value = await operation();
  } catch (operationError) {
    let stateError = null;
    try {
      await before();
    } catch (error) {
      stateError = error;
    }
    if (stateError) {
      throw replacementCombinedFailure(label, target, [
        { label: "Operation error", error: operationError },
        { label: "Post-error state", error: stateError },
      ]);
    }
    throw operationError;
  }
  await after(value);
  return value;
}

async function closeReplacementHandle(handle, primaryError, label, target) {
  try {
    await handle.close();
  } catch (closeError) {
    if (!primaryError) throw closeError;
    throw replacementCombinedFailure(label, target, [
      { label: "Operation error", error: primaryError },
      { label: "Close error", error: closeError },
    ]);
  }
  if (primaryError) throw primaryError;
}

async function writeReplacementFile(path, template, label, target, ownership) {
  let handle;
  let primaryError = null;
  try {
    handle = await open(path, "wx", template.mode);
    const created = await handle.stat({ bigint: true });
    if (!created.isFile()) {
      throw replacementChanged(label, target, `created a non-file at ${path}`);
    }
    ownership.identity = replacementIdentity(created);
    await handle.writeFile(template.bytes);
    await handle.chmod(template.mode);
    await handle.sync();
  } catch (error) {
    primaryError = error;
  }
  if (handle) await closeReplacementHandle(handle, primaryError, label, target);
  else if (primaryError) throw primaryError;

  const manifest = await captureReplacementFile(path, label, target);
  if (
    !sameReplacementIdentity(ownership.identity, manifest.identity)
    || manifest.mode !== template.mode
    || !manifest.bytes.equals(template.bytes)
  ) {
    throw replacementChanged(label, target, `created an unexpected file at ${path}`);
  }
  ownership.manifest = manifest;
  return manifest;
}

async function chmodReplacementDirectory(path, identity, mode, label, target) {
  let handle;
  let primaryError = null;
  try {
    handle = await open(
      path,
      fsConstants.O_RDONLY
        | (fsConstants.O_DIRECTORY ?? 0)
        | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const opened = await handle.stat({ bigint: true });
    if (!opened.isDirectory() || !sameReplacementIdentity(identity, replacementIdentity(opened))) {
      throw replacementChanged(label, target, `had directory ${path} replaced before chmod`);
    }
    await handle.chmod(mode);
  } catch (error) {
    primaryError = error;
  }
  if (handle) await closeReplacementHandle(handle, primaryError, label, target);
  else if (primaryError) throw primaryError;
}

const replacementDirectoryOpenFlags = fsConstants.O_RDONLY
  | (fsConstants.O_DIRECTORY ?? 0)
  | (fsConstants.O_NOFOLLOW ?? 0);

async function createAndOpenReplacementDirectory(path, mode, makeDirectory) {
  if (makeDirectory !== mkdir) {
    await makeDirectory(path, { mode });
    return open(path, replacementDirectoryOpenFlags);
  }
  return new Promise((resolvePromise, rejectPromise) => {
    mkdirCallback(path, { mode }, (mkdirError) => {
      if (mkdirError) {
        rejectPromise(mkdirError);
        return;
      }
      open(path, replacementDirectoryOpenFlags).then(resolvePromise, (openError) => {
        openError.createdReplacementDirectory = true;
        rejectPromise(openError);
      });
    });
  });
}

async function reserveReplacementDirectory(
  path,
  template,
  {
    before,
    after,
    label,
    target,
    ownership,
    makeDirectory = mkdir,
    finalizeMode = false,
  },
) {
  return performReplacementMutation(async () => {
    const claimName = `.sdd-reservation-${randomUUID()}`;
    const claimPath = join(path, claimName);
    const claimBytes = Buffer.from(randomUUID(), "utf8");
    let directoryHandle = null;
    let claimHandle = null;
    let primaryError = null;
    let manifest = null;
    const workingMode = template.root.mode | 0o700;
    const reservedMode = finalizeMode ? template.root.mode : workingMode;
    try {
      directoryHandle = await createAndOpenReplacementDirectory(
        path,
        workingMode,
        makeDirectory,
      );
      const created = await directoryHandle.stat({ bigint: true });
      if (!created.isDirectory()) {
        throw replacementChanged(label, target, `created a non-directory at ${path}`);
      }
      ownership.identity = replacementIdentity(created);

      const assertReservation = async (expectedNames) => {
        const [opened, current, names] = await Promise.all([
          directoryHandle.stat({ bigint: true }),
          lstat(path, { bigint: true }),
          readdir(path),
        ]);
        names.sort(compareReplacementNames);
        if (
          !opened.isDirectory()
          || !current.isDirectory()
          || !sameReplacementIdentity(ownership.identity, replacementIdentity(opened))
          || !sameReplacementIdentity(ownership.identity, replacementIdentity(current))
          || names.length !== expectedNames.length
          || names.some((name, index) => name !== expectedNames[index])
        ) {
          throw replacementChanged(label, target, `had reservation ${path} replaced`);
        }
      };

      await assertReservation([]);
      claimHandle = await open(claimPath, "wx", 0o600);
      const claimState = await claimHandle.stat({ bigint: true });
      if (!claimState.isFile()) {
        throw replacementChanged(label, target, `created an invalid reservation claim at ${path}`);
      }
      const claimIdentity = replacementIdentity(claimState);
      await claimHandle.writeFile(claimBytes);
      await claimHandle.sync();
      await claimHandle.close();
      claimHandle = null;
      await assertReservation([claimName]);
      const claim = await captureReplacementFile(claimPath, label, target);
      if (
        !sameReplacementIdentity(claim.identity, claimIdentity)
        || !claim.bytes.equals(claimBytes)
      ) {
        throw replacementChanged(label, target, `lost reservation claim at ${path}`);
      }
      await assertReservation([claimName]);
      await unlink(claimPath);
      await assertReservation([]);
      if (finalizeMode) {
        await directoryHandle.chmod(template.root.mode);
        await assertReservation([]);
      }
      manifest = await captureReplacementDirectory(path, label, target);
      if (
        manifest.entries.length !== 0
        || manifest.root.mode !== reservedMode
        || !sameReplacementIdentity(manifest.root.identity, ownership.identity)
      ) {
        throw replacementChanged(label, target, `created an unexpected reservation at ${path}`);
      }
      await directoryHandle.close();
      directoryHandle = null;
    } catch (error) {
      if (error?.createdReplacementDirectory && ownership.identity === null) {
        try {
          const created = await lstat(path, { bigint: true });
          if (created.isDirectory()) ownership.identity = replacementIdentity(created);
        } catch {
          // The outer recovery path reports any surviving unauthenticated reservation.
        }
      }
      primaryError = error;
    }

    const closeFailures = [];
    if (claimHandle) {
      try {
        await claimHandle.close();
      } catch (error) {
        closeFailures.push({ label: "Reservation claim close", error });
      }
    }
    if (directoryHandle) {
      try {
        await directoryHandle.close();
      } catch (error) {
        closeFailures.push({ label: "Reservation directory close", error });
      }
    }
    if (closeFailures.length > 0) {
      throw replacementCombinedFailure(label, target, [
        ...(primaryError ? [{ label: "Reservation error", error: primaryError }] : []),
        ...closeFailures,
      ]);
    }
    if (primaryError) throw primaryError;
    ownership.manifest = manifest;
    return manifest;
  }, {
    before,
    after: async (manifest) => {
      ownership.manifest = manifest;
      await after(manifest);
    },
    label,
    target,
  });
}

function assertReplacementTreeStep(
  previous,
  current,
  template,
  count,
  createdIdentity,
  label,
  target,
  root,
) {
  if (
    !sameReplacementIdentity(previous.root.identity, current.root.identity)
    || current.entries.length !== count
    || current.root.mode !== previous.root.mode
  ) {
    throw replacementChanged(label, target, `had reservation ${root} changed`);
  }
  for (let index = 0; index < count - 1; index += 1) {
    if (!sameReplacementDirectoryEntry(previous.entries[index], current.entries[index])) {
      throw replacementChanged(label, target, `had published entry changed in ${root}`);
    }
  }
  const created = current.entries[count - 1];
  const expected = template.entries[count - 1];
  const expectedEntry = expected.type === "directory"
    ? { ...expected, mode: expected.mode | 0o700 }
    : expected;
  if (
    !sameReplacementIdentity(created?.identity, createdIdentity)
    || !sameReplacementDirectoryEntry(created, expectedEntry, { identities: false })
  ) {
    throw replacementChanged(label, target, `created an unexpected entry in ${root}`);
  }
}

function assertReplacementModeStep(
  previous,
  current,
  relativePath,
  expectedMode,
  label,
  target,
  root,
) {
  if (
    !sameReplacementIdentity(previous.root.identity, current.root.identity)
    || previous.entries.length !== current.entries.length
  ) {
    throw replacementChanged(label, target, `had tree ${root} changed while finalizing modes`);
  }
  if (relativePath === null) {
    if (current.root.mode !== expectedMode) {
      throw replacementChanged(label, target, `could not finalize mode for ${root}`);
    }
  } else if (current.root.mode !== previous.root.mode) {
    throw replacementChanged(label, target, `had root mode for ${root} changed`);
  }
  for (let index = 0; index < current.entries.length; index += 1) {
    const before = previous.entries[index];
    const after = current.entries[index];
    if (after.relativePath === relativePath) {
      if (
        after.type !== "directory"
        || after.mode !== expectedMode
        || !sameReplacementIdentity(before.identity, after.identity)
      ) {
        throw replacementChanged(label, target, `could not finalize mode for ${relativePath}`);
      }
    } else if (!sameReplacementDirectoryEntry(before, after)) {
      throw replacementChanged(label, target, `had tree ${root} changed while finalizing modes`);
    }
  }
}

async function buildReplacementTree(
  root,
  template,
  {
    initial,
    sourceRoot = null,
    externalGuard,
    beforeEntry = null,
    afterEntry = null,
    publication,
    label,
    target,
    makeDirectory = mkdir,
  },
) {
  let current = initial;
  for (let index = 0; index < template.entries.length; index += 1) {
    const entry = template.entries[index];
    const destination = join(root, ...entry.relativePath.split("/"));
    const entryArgs = {
      ...publication,
      relativePath: entry.relativePath,
      type: entry.type,
      sourcePath: sourceRoot === null
        ? null
        : join(sourceRoot, ...entry.relativePath.split("/")),
      targetPath: destination,
    };
    const currentGuard = () => externalGuard(current);
    await invokeReplacementHook(
      beforeEntry,
      entryArgs,
      currentGuard,
      `${label} before-entry hook`,
      target,
    );

    if (entry.type === "directory") {
      const entryTemplate = {
        root: { type: "directory", identity: null, mode: entry.mode },
        entries: [],
      };
      entryTemplate.hash = directoryManifestHash(entryTemplate);
      const entryOwnership = { identity: null, manifest: null };
      await reserveReplacementDirectory(destination, entryTemplate, {
        before: currentGuard,
        after: async (reserved) => {
          const next = await captureReplacementDirectory(root, label, target);
          assertReplacementTreeStep(
            current,
            next,
            template,
            index + 1,
            reserved.root.identity,
            label,
            target,
            root,
          );
          current = next;
          await externalGuard(current);
        },
        label,
        target,
        ownership: entryOwnership,
        makeDirectory,
      });
    } else {
      await performReplacementMutation(async () => {
        if (entry.type === "file" && sourceRoot !== null) {
          await link(entryArgs.sourcePath, destination);
          return entry.identity;
        }
        if (entry.type === "file") {
          const entryOwnership = { identity: null, manifest: null };
          await writeReplacementFile(destination, entry, label, target, entryOwnership);
          return entryOwnership.identity;
        }
        await symlink(entry.linkTarget, destination);
        const state = await lstat(destination, { bigint: true });
        if (!state.isSymbolicLink()) {
          throw replacementChanged(label, target, `created a non-symlink at ${destination}`);
        }
        return replacementIdentity(state);
      }, {
        before: currentGuard,
        after: async (createdIdentity) => {
          const next = await captureReplacementDirectory(root, label, target);
          assertReplacementTreeStep(
            current,
            next,
            template,
            index + 1,
            createdIdentity,
            label,
            target,
            root,
          );
          current = next;
          await externalGuard(current);
        },
        label,
        target,
      });
    }
    await invokeReplacementHook(
      afterEntry,
      entryArgs,
      () => externalGuard(current),
      `${label} after-entry hook`,
      target,
    );
  }

  const directories = template.entries
    .filter((entry) => entry.type === "directory")
    .reverse();
  for (const entry of directories) {
    const destination = join(root, ...entry.relativePath.split("/"));
    const observed = current.entries.find(
      (candidate) => candidate.relativePath === entry.relativePath,
    );
    if (!observed || observed.type !== "directory") {
      throw replacementChanged(label, target, `lost directory ${entry.relativePath}`);
    }
    await performReplacementMutation(
      () => chmodReplacementDirectory(
        destination,
        observed.identity,
        entry.mode,
        label,
        target,
      ),
      {
        before: () => externalGuard(current),
        after: async () => {
          const next = await captureReplacementDirectory(root, label, target);
          assertReplacementModeStep(
            current,
            next,
            entry.relativePath,
            entry.mode,
            label,
            target,
            root,
          );
          current = next;
          await externalGuard(current);
        },
        label,
        target,
      },
    );
  }
  if (current.root.mode !== template.root.mode) {
    await performReplacementMutation(
      () => chmodReplacementDirectory(
        root,
        current.root.identity,
        template.root.mode,
        label,
        target,
      ),
      {
        before: () => externalGuard(current),
        after: async () => {
          const next = await captureReplacementDirectory(root, label, target);
          assertReplacementModeStep(
            current,
            next,
            null,
            template.root.mode,
            label,
            target,
            root,
          );
          current = next;
          await externalGuard(current);
        },
        label,
        target,
      },
    );
  }
  if (!sameReplacementDirectory(current, template, { identities: false })) {
    throw replacementChanged(label, target, `did not reproduce the captured tree at ${root}`);
  }
  return current;
}

async function cleanupReplacementFile(
  path,
  manifest,
  {
    beforeGuard,
    afterGuard,
    invariantGuard,
    beforeCleanup,
    publication,
    kind,
    label,
    target,
    cleanupRename,
    cleanupMkdir,
    cleanupRmdir,
  },
) {
  try {
    await invokeReplacementHook(
      beforeCleanup,
      { ...publication, kind, path },
      beforeGuard,
      `${label} cleanup hook`,
      target,
    );
    let quarantined = false;
    const stableGuard = () => (quarantined ? afterGuard() : beforeGuard());
    const checked = (operationLabel, operation) => performReplacementMutation(operation, {
      before: stableGuard,
      after: stableGuard,
      label: `${label} ${operationLabel}`,
      target,
    });
    await beforeGuard();
    const cleanup = await removeOwnedPathWithQuarantine(path, manifest, {
      allowMissing: false,
      label,
      renamePath: (...args) => {
        if (quarantined || args[0] !== path) {
          return checked("quarantine rename", () => cleanupRename(...args));
        }
        return performReplacementMutation(async () => {
          const value = await cleanupRename(...args);
          quarantined = true;
          return value;
        }, {
          before: beforeGuard,
          after: afterGuard,
          label: `${label} quarantine rename`,
          target,
        });
      },
      exclusiveTransfer: cleanupRename === rename,
      makeDirectory: cleanupMkdir,
      removeDirectory: (...args) => checked("quarantine removal", () => cleanupRmdir(...args)),
      beforeMutation: stableGuard,
      afterMutation: async (mutation) => {
        if (mutation.action === "remove-canonical") quarantined = true;
        await stableGuard();
      },
    });
    if (cleanup.failures.length > 0) return cleanup;
    await stableGuard();
    return cleanup;
  } catch (error) {
    return {
      failures: [{ label, error }],
      retainedPaths: (await replacementPathIsMissing(path)) ? [] : [path],
    };
  }
}

function manifestWithoutDirectoryEntry(manifest, relativePath) {
  const entries = manifest.entries.filter((entry) => entry.relativePath !== relativePath);
  const next = { root: manifest.root, entries };
  next.hash = directoryManifestHash(next);
  return next;
}
function manifestWithDirectoryEntry(manifest, entry) {
  const entries = [...manifest.entries, entry]
    .sort((left, right) => compareReplacementNames(left.relativePath, right.relativePath));
  const next = { root: manifest.root, entries };
  next.hash = directoryManifestHash(next);
  return next;
}


function manifestWithDirectoryMode(manifest, relativePath, mode) {
  const next = relativePath === null
    ? { root: { ...manifest.root, mode }, entries: manifest.entries }
    : {
        root: manifest.root,
        entries: manifest.entries.map((entry) => (
          entry.relativePath === relativePath ? { ...entry, mode } : entry
        )),
      };
  next.hash = directoryManifestHash(next);
  return next;
}
function sameReplacementCleanupProvenance(original, current) {
  const controlledMode = (mode) => [mode, mode | 0o700];
  return sameReplacementIdentity(original.root.identity, current.root.identity)
    && controlledMode(original.root.mode).includes(current.root.mode)
    && original.entries.length === current.entries.length
    && original.entries.every((entry, index) => {
      const observed = current.entries[index];
      if (
        entry.type !== observed?.type
        || entry.relativePath !== observed.relativePath
        || !sameReplacementIdentity(entry.identity, observed.identity)
      ) {
        return false;
      }
      if (entry.type === "directory") {
        return controlledMode(entry.mode).includes(observed.mode);
      }
      return sameReplacementDirectoryEntry(entry, observed);
    });
}


function directReplacementChildren(manifest, relativePath) {
  const prefix = relativePath === null ? "" : `${relativePath}/`;
  return manifest.entries
    .filter((entry) => {
      if (!entry.relativePath.startsWith(prefix)) return false;
      return !entry.relativePath.slice(prefix.length).includes("/");
    })
    .map((entry) => basename(entry.relativePath))
    .sort(compareReplacementNames);
}

function directReplacementEntryPath(root, relativePath) {
  return relativePath === null ? root : join(root, ...relativePath.split("/"));
}

async function assertDirectReplacementParents(root, manifest, relativePath, label, target) {
  if (relativePath === null) return;
  const segments = relativePath.split("/");
  for (let count = 0; count < segments.length; count += 1) {
    const parentRelativePath = count === 0 ? null : segments.slice(0, count).join("/");
    const expected = parentRelativePath === null
      ? manifest.root
      : manifest.entries.find((entry) => entry.relativePath === parentRelativePath);
    const parentPath = directReplacementEntryPath(root, parentRelativePath);
    const state = await lstat(parentPath, { bigint: true }).catch((error) => {
      throw replacementChanged(label, target, `could not inspect direct parent ${parentPath}`, error);
    });
    if (
      expected?.type !== "directory"
      || !state.isDirectory()
      || state.isSymbolicLink()
      || !sameReplacementIdentity(expected.identity, replacementIdentity(state))
      || expected.mode !== replacementMode(state)
    ) {
      throw replacementChanged(label, target, `had direct parent ${parentPath} replaced`);
    }
  }
}

async function assertDirectReplacementDirectory(
  path,
  expected,
  expectedNames,
  label,
  target,
) {
  const before = await lstat(path, { bigint: true }).catch((error) => {
    throw replacementChanged(label, target, `could not inspect directory ${path}`, error);
  });
  if (
    !before.isDirectory()
    || before.isSymbolicLink()
    || !sameReplacementIdentity(expected.identity, replacementIdentity(before))
    || expected.mode !== replacementMode(before)
  ) {
    throw replacementChanged(label, target, `had directory ${path} replaced`);
  }
  const names = await readdir(path);
  names.sort(compareReplacementNames);
  const after = await lstat(path, { bigint: true }).catch((error) => {
    throw replacementChanged(label, target, `changed directory ${path}`, error);
  });
  if (
    names.length !== expectedNames.length
    || names.some((name, index) => name !== expectedNames[index])
    || !after.isDirectory()
    || after.isSymbolicLink()
    || !sameReplacementIdentity(expected.identity, replacementIdentity(after))
    || expected.mode !== replacementMode(after)
  ) {
    throw replacementChanged(label, target, `changed directory ${path}`);
  }
}
async function assertExactEmptyReplacementDirectory(path, expected, label, target) {
  await assertDirectReplacementDirectory(path, expected, [], label, target);
}


async function assertDirectReplacementSymlink(path, expected, label, target) {
  const before = await lstat(path, { bigint: true }).catch((error) => {
    throw replacementChanged(label, target, `could not inspect symlink ${path}`, error);
  });
  if (
    !before.isSymbolicLink()
    || !sameReplacementIdentity(expected.identity, replacementIdentity(before))
    || expected.mode !== replacementMode(before)
  ) {
    throw replacementChanged(label, target, `had symlink ${path} replaced`);
  }
  const linkTarget = await readlink(path, { encoding: "buffer" }).catch((error) => {
    throw replacementChanged(label, target, `changed symlink ${path}`, error);
  });
  const after = await lstat(path, { bigint: true }).catch((error) => {
    throw replacementChanged(label, target, `changed symlink ${path}`, error);
  });
  if (
    !after.isSymbolicLink()
    || !sameReplacementIdentity(expected.identity, replacementIdentity(after))
    || expected.mode !== replacementMode(after)
    || !Buffer.isBuffer(expected.linkTarget)
    || !expected.linkTarget.equals(linkTarget)
  ) {
    throw replacementChanged(label, target, `changed symlink ${path}`);
  }
}

async function assertDirectReplacementEntry(root, manifest, entry, label, target) {
  await assertDirectReplacementParents(root, manifest, entry.relativePath, label, target);
  const entryPath = directReplacementEntryPath(root, entry.relativePath);
  if (entry.type === "directory") {
    await assertDirectReplacementDirectory(
      entryPath,
      entry,
      directReplacementChildren(manifest, entry.relativePath),
      label,
      target,
    );
  } else if (entry.type === "file") {
    const current = await captureReplacementFile(entryPath, label, target);
    if (!sameReplacementFile(current, entry)) {
      throw replacementChanged(label, target, `had file ${entryPath} replaced or modified`);
    }
  } else if (entry.type === "symlink") {
    await assertDirectReplacementSymlink(entryPath, entry, label, target);
  } else {
    throw replacementChanged(label, target, `has unsupported manifest entry ${entryPath}`);
  }
  await assertDirectReplacementParents(root, manifest, entry.relativePath, label, target);
}

async function assertDirectReplacementManifest(
  root,
  manifest,
  label,
  target,
  focusRelativePath = null,
) {
  const rootExpected = {
    type: "directory",
    relativePath: null,
    identity: manifest.root.identity,
    mode: manifest.root.mode,
  };
  const entries = [
    rootExpected,
    ...manifest.entries.filter((entry) => entry.relativePath !== focusRelativePath),
    ...manifest.entries.filter((entry) => entry.relativePath === focusRelativePath),
  ];
  if (focusRelativePath === null) {
    entries.splice(0, 1);
    entries.push(rootExpected);
  }
  for (const entry of entries) {
    if (entry.relativePath === null) {
      await assertDirectReplacementDirectory(
        root,
        manifest.root,
        directReplacementChildren(manifest, null),
        label,
        target,
      );
    } else {
      await assertDirectReplacementEntry(root, manifest, entry, label, target);
    }
  }
}

async function invokeDirectReplacementCleanupHook(hook, args, guard, label, target) {
  await guard();
  if (!hook) return;
  let hookError = null;
  let stateError = null;
  try {
    await hook(args);
  } catch (error) {
    hookError = error;
  }
  try {
    await guard();
  } catch (error) {
    stateError = error;
  }
  if (hookError && stateError) {
    throw replacementCombinedFailure(label, target, [
      { label: "Hook error", error: hookError },
      { label: "Post-hook state", error: stateError },
    ]);
  }
  if (hookError) throw hookError;
  if (stateError) throw stateError;
}

async function cleanupReplacementDirectory(
  path,
  manifest,
  {
    beforeGuard,
    afterMoveGuard,
    invariantGuard,
    beforeCleanup,
    beforeEntryCleanup,
    publication,
    kind,
    label,
    target,
    cleanupMkdir,
    cleanupRmdir,
    cleanupUnlink,
    syncDirectoryPath = null,
  },
) {
  const parent = dirname(path);
  const quarantineRoot = join(
    parent,
    `.${basename(path)}.sdd-cleanup-${process.pid}-${randomUUID()}`,
  );
  const result = {
    failures: [],
    retainedPaths: [],
    retainedManifest: null,
    moved: false,
  };
  let quarantineManifest = null;
  let current = manifest;
  const syncCleanupDirectory = (
    directory,
    phase,
    guard,
    relativePath = null,
  ) => (
    syncDirectoryPath === null
      ? Promise.resolve()
      : syncReplacementMetadata(directory, {
          phase,
          relativePath,
          guard,
          syncDirectoryPath,
          publication,
          label,
          target,
        })
  );
  const assertInvariant = invariantGuard ?? (() => Promise.resolve());
  const assertClaimMissing = async () => {
    await assertInvariant();
    await assertReplacementPathMissing(quarantineRoot, label, target);
    await assertInvariant();
  };
  const assertClaim = async () => {
    await assertInvariant();
    await assertDirectReplacementManifest(
      quarantineRoot,
      quarantineManifest,
      label,
      target,
    );
    await assertInvariant();
  };
  const assertCurrent = async (focusRelativePath = null) => {
    await assertInvariant();
    if (quarantineManifest === null) {
      await assertReplacementPathMissing(quarantineRoot, label, target);
    } else {
      await assertDirectReplacementManifest(
        quarantineRoot,
        quarantineManifest,
        label,
        target,
      );
    }
    await assertDirectReplacementManifest(
      path,
      current,
      label,
      target,
      focusRelativePath,
    );
    await assertInvariant();
  };
  const assertRemoved = async () => {
    await assertClaim();
    await assertReplacementPathMissing(path, label, target);
    await afterMoveGuard();
    await assertClaim();
  };

  let primaryError = null;
  try {
    await beforeGuard();
    await invokeDirectReplacementCleanupHook(
      beforeCleanup,
      { ...publication, kind, path, quarantine: quarantineRoot },
      () => assertCurrent(),
      `${label} cleanup hook`,
      target,
    );

    const quarantineTemplate = {
      root: { type: "directory", identity: null, mode: 0o700 },
      entries: [],
    };
    quarantineTemplate.hash = directoryManifestHash(quarantineTemplate);
    const quarantineOwnership = { identity: null, manifest: null };
    await reserveReplacementDirectory(quarantineRoot, quarantineTemplate, {
      before: () => assertCurrent(),
      after: async (reserved) => {
        quarantineManifest = reserved;
        await assertCurrent();
      },
      label,
      target,
      ownership: quarantineOwnership,
      makeDirectory: cleanupMkdir,
    });
    await syncCleanupDirectory(
      parent,
      `${kind}-cleanup-reservation`,
      () => assertCurrent(),
    );

    const writableDirectories = [
      { relativePath: null, identity: current.root.identity, mode: current.root.mode | 0o700 },
      ...current.entries
        .filter((entry) => entry.type === "directory")
        .map((entry) => ({
          relativePath: entry.relativePath,
          identity: entry.identity,
          mode: entry.mode | 0o700,
        })),
    ];
    for (const directory of writableDirectories) {
      const observed = directory.relativePath === null
        ? current.root
        : current.entries.find((entry) => entry.relativePath === directory.relativePath);
      if (observed.mode === directory.mode) continue;
      const directoryPath = directReplacementEntryPath(path, directory.relativePath);
      const next = manifestWithDirectoryMode(current, directory.relativePath, directory.mode);
      await performReplacementMutation(
        () => chmodReplacementDirectory(
          directoryPath,
          directory.identity,
          directory.mode,
          label,
          target,
        ),
        {
          before: () => assertCurrent(directory.relativePath),
          after: async () => {
            current = next;
            await assertCurrent(directory.relativePath);
          },
          label,
          target,
        },
      );
      await syncCleanupDirectory(
        directoryPath,
        `${kind}-cleanup-mode`,
        () => assertCurrent(directory.relativePath),
        directory.relativePath,
      );
    }

    for (const entry of [...manifest.entries].reverse()) {
      const entryPath = directReplacementEntryPath(path, entry.relativePath);
      const next = manifestWithoutDirectoryEntry(current, entry.relativePath);
      const hookArgs = {
        ...publication,
        kind,
        path,
        quarantine: quarantineRoot,
        relativePath: entry.relativePath,
        targetPath: entryPath,
        entryType: entry.type,
      };
      if (entry.type === "directory") {
        await invokeDirectReplacementCleanupHook(
          beforeEntryCleanup,
          hookArgs,
          () => assertCurrent(entry.relativePath),
          `${label} entry-cleanup hook`,
          target,
        );
        const expectedDirectory = current.entries.find(
          (candidate) => candidate.relativePath === entry.relativePath,
        );
        await performReplacementMutation(
          async () => {
            await assertExactEmptyReplacementDirectory(
              entryPath,
              expectedDirectory,
              label,
              target,
            );
            return cleanupRmdir(entryPath);
          },
          {
            before: () => assertCurrent(entry.relativePath),
            after: async () => {
              current = next;
              await assertCurrent();
            },
            label,
            target,
          },
        );
      } else {
        let claimRelativePath = null;
        const removal = await unlinkIdentityBoundQuarantine(
          entryPath,
          entry,
          `${label} entry ${entry.relativePath}`,
          {
            quarantineDirectory: quarantineRoot,
            linkPath: link,
            removePath: cleanupUnlink,
            beforeMutation: async (mutation) => {
              if (mutation.action === "remove-source") {
                await invokeDirectReplacementCleanupHook(
                  beforeEntryCleanup,
                  hookArgs,
                  () => assertCurrent(entry.relativePath),
                  `${label} entry-cleanup hook`,
                  target,
                );
              } else if (mutation.action === "remove") {
                await assertCurrent();
              } else {
                await assertCurrent(entry.relativePath);
              }
            },
            afterMutation: async (mutation) => {
              if (mutation.action === "link-slot") {
                if (!(await replacementPathIsMissing(mutation.target))) {
                  claimRelativePath = basename(mutation.target);
                  quarantineManifest = manifestWithDirectoryEntry(
                    quarantineManifest,
                    { ...entry, relativePath: claimRelativePath },
                  );
                }
                await assertCurrent(entry.relativePath);
              } else if (mutation.action === "remove-source") {
                if (await replacementPathIsMissing(entryPath)) current = next;
                await assertCurrent(
                  (await replacementPathIsMissing(entryPath)) ? null : entry.relativePath,
                );
              } else {
                if (
                  claimRelativePath !== null
                  && await replacementPathIsMissing(mutation.path)
                ) {
                  quarantineManifest = manifestWithoutDirectoryEntry(
                    quarantineManifest,
                    claimRelativePath,
                  );
                }
                await assertCurrent();
              }
            },
          },
        );
        if (removal.error) throw removal.error;
      }
      await syncCleanupDirectory(
        dirname(entryPath),
        `${kind}-cleanup-entry`,
        () => assertCurrent(),
        entry.relativePath,
      );
    }

    await invokeDirectReplacementCleanupHook(
      beforeEntryCleanup,
      {
        ...publication,
        kind,
        path,
        quarantine: quarantineRoot,
        relativePath: "",
        targetPath: path,
        entryType: "directory",
      },
      () => assertCurrent(),
      `${label} root-cleanup hook`,
      target,
    );
    await performReplacementMutation(
      async () => {
        await assertExactEmptyReplacementDirectory(path, current.root, label, target);
        return cleanupRmdir(path);
      },
      {
        before: () => assertCurrent(),
        after: async () => {
          result.moved = true;
          await assertRemoved();
        },
        label,
        target,
      },
    );
    await syncCleanupDirectory(parent, `${kind}-cleanup-parent`, assertRemoved);
  } catch (error) {
    primaryError = error;
    result.failures.push({ label, error });
    if (await replacementPathIsMissing(path)) result.moved = true;
  }

  if (quarantineManifest !== null) {
    try {
      const claimGuard = result.moved
        ? assertRemoved
        : assertClaim;
      await performReplacementMutation(
        () => cleanupRmdir(quarantineRoot),
        {
          before: claimGuard,
          after: async () => {
            await assertInvariant();
            await assertReplacementPathMissing(quarantineRoot, label, target);
            if (result.moved) await afterMoveGuard();
            await assertInvariant();
          },
          label,
          target,
        },
      );
      await syncCleanupDirectory(
        parent,
        `${kind}-cleanup-claim`,
        async () => {
          await assertInvariant();
          await assertReplacementPathMissing(quarantineRoot, label, target);
          if (result.moved) await afterMoveGuard();
          await assertInvariant();
        },
      );
    } catch (error) {
      result.failures.push({ label: `${label} cleanup claim`, error });
    }
  }

  if (!(await replacementPathIsMissing(path))) {
    result.retainedPaths.push(path);
    try {
      await assertDirectReplacementManifest(path, current, label, target);
      if (sameReplacementCleanupProvenance(manifest, current)) {
        result.retainedManifest = current;
      }
    } catch {
      // Concurrent or partially cleaned paths remain opaque and are only reported by path.
    }
  }
  if (!(await replacementPathIsMissing(quarantineRoot))) {
    result.retainedPaths.push(quarantineRoot);
  }
  if (primaryError === null && result.failures.length > 0 && !result.moved) {
    result.failures.unshift({
      label,
      error: replacementChanged(label, target, `could not remove ${path}`),
    });
  }
  return result;
}

function validateExpectedReplacementHash(kind, target, manifest, expectedHash) {
  if (expectedHash === undefined) return;
  if (expectedHash === null) {
    if (manifest !== null) {
      throw replacementChanged(kind, target, "appeared before replacement");
    }
    return;
  }
  if (manifest === null) {
    throw replacementChanged(kind, target, "disappeared before replacement");
  }
  const matches = Array.isArray(manifest.entries)
    ? directoryHashMatches({
      legacy: legacyDirectoryManifestHash(manifest),
      strong: manifest.hash,
    }, expectedHash)
    : manifest.hash === expectedHash;
  if (!matches) {
    throw replacementChanged(kind, target, "changed before replacement");
  }
}

function validateExpectedReplacementSnapshot(
  kind,
  target,
  manifest,
  ownerBinding,
  expectedSnapshot,
) {
  if (expectedSnapshot === undefined) return;
  if (expectedSnapshot === null || expectedSnapshot?.missing === true) {
    if (manifest !== null) {
      throw replacementChanged(kind, target, "appeared before replacement");
    }
    return;
  }
  if (
    typeof expectedSnapshot.ownerBinding !== "object"
    || typeof expectedSnapshot.mode !== "number"
    || !expectedFileMatches(manifest, expectedSnapshot)
    || !sameBoundFileOwner(ownerBinding, expectedSnapshot.ownerBinding)
  ) {
    throw replacementChanged(kind, target, "changed from its expected snapshot");
  }
}

function validateExpectedDirectorySnapshot(kind, target, manifest, expectedSnapshot) {
  if (expectedSnapshot === undefined) return;
  if (expectedSnapshot === null || expectedSnapshot?.missing === true) {
    if (manifest !== null) {
      throw replacementChanged(kind, target, "appeared before replacement");
    }
    return;
  }
  if (!sameReplacementDirectory(manifest, expectedSnapshot)) {
    throw replacementChanged(kind, target, "changed from its expected snapshot");
  }
}

function addCleanupResult(failures, retainedPaths, cleanup) {
  failures.push(...cleanup.failures);
  retainedPaths.push(...cleanup.retainedPaths);
}

export function directoryManifestHashVersions(manifest) {
  return Object.freeze({
    legacy: legacyDirectoryManifestHash(manifest),
    strong: manifest.hash,
  });
}

export async function hashDirectoryVersions(root) {
  const manifest = await captureReplacementDirectory(root, "Directory hash", root);
  return directoryManifestHashVersions(manifest);
}

export async function hashDirectory(root) {
  const manifest = await captureReplacementDirectory(root, "Directory hash", root);
  return manifest.hash;
}

export async function hashLegacyDirectory(root) {
  const manifest = await captureReplacementDirectory(root, "Directory hash", root);
  return legacyDirectoryManifestHash(manifest);
}

export async function matchesDirectoryHash(root, expectedHash) {
  return directoryHashMatches(await hashDirectoryVersions(root), expectedHash);
}

export async function hashDirectoryWithFileOverride(root, relativePath, source) {
  const manifest = await captureReplacementDirectory(root, "Directory hash", root);
  const index = manifest.entries.findIndex((entry) => entry.relativePath === relativePath);
  if (index < 0 || manifest.entries[index].type !== "file") {
    throw new SddError(`Directory hash override is not a regular file: ${relativePath}`, {
      code: "INVALID_DIRECTORY_HASH",
    });
  }
  const entries = [...manifest.entries];
  entries[index] = {
    ...entries[index],
    bytes: Buffer.isBuffer(source) ? source : Buffer.from(source, "utf8"),
  };
  return directoryManifestHash({ ...manifest, entries });
}

export async function hashFile(path) {
  const manifest = await captureReplacementFile(path, "File hash", path);
  return manifest.hash;
}

function boundDirectoryError(path, label, unsafeCode, reason, error = null) {
  const failure = new SddError(`${label} ${reason}: ${path}`, {
    code: unsafeCode,
    details: error ? [error.message] : [],
  });
  if (error) failure.cause = error;
  return failure;
}

async function resolveBoundDirectoryOwner(path, ownerRoot, label, unsafeCode) {
  if (ownerRoot === null) return null;
  try {
    return await resolveReplacementOwner(ownerRoot, path, label);
  } catch (error) {
    throw boundDirectoryError(path, label, unsafeCode, "has an unsafe owner root", error);
  }
}

function sameBoundDirectoryAuthority(left, right) {
  return left === null && right === null
    ? true
    : left !== null
      && right !== null
      && left.path === right.path
      && sameReplacementAncestor(left.binding, right.binding);
}

export function sameBoundDirectoryBinding(left, right) {
  return left?.path === right?.path
    && left?.ownerRoot === right?.ownerRoot
    && sameBoundDirectoryAuthority(left?.ownerAuthority ?? null, right?.ownerAuthority ?? null)
    && Array.isArray(left?.ancestors)
    && Array.isArray(right?.ancestors)
    && left.ancestors.length === right.ancestors.length
    && left.ancestors.every((ancestor, index) =>
      sameReplacementAncestor(ancestor, right.ancestors[index]));
}

export async function readBoundDirectory(
  path,
  {
    ownerRoot = null,
    allowMissing = false,
    returnMissingBinding = false,
    label = "Directory",
    unsafeCode = "UNSAFE_DIRECTORY_PATH",
    expectedBinding = undefined,
  } = {},
) {
  const absolutePath = resolve(path);
  const ownerAuthority = await resolveBoundDirectoryOwner(
    absolutePath,
    ownerRoot,
    label,
    unsafeCode,
  );
  const ancestors = await (allowMissing
    ? captureExistingReplacementAncestors
    : captureReplacementAncestors)(
    dirname(absolutePath),
    label,
    absolutePath,
    ownerAuthority,
  );
  if (ownerAuthority !== null) bindReplacementOwner(ancestors, ownerAuthority);
  const binding = {
    path: absolutePath,
    ownerRoot: ownerAuthority?.path ?? null,
    ownerAuthority,
    ancestors,
  };
  if (
    expectedBinding !== undefined
    && !sameBoundDirectoryBinding(binding, expectedBinding)
  ) {
    throw replacementChanged(label, absolutePath, "changed from its expected owner authority");
  }
  const manifest = await captureReplacementDirectory(
    absolutePath,
    label,
    absolutePath,
    { allowMissing },
  );
  await assertReplacementAuthority(ancestors, label, absolutePath);
  if (manifest === null) {
    await assertReplacementPathMissing(absolutePath, label, absolutePath);
    await assertReplacementAuthority(ancestors, label, absolutePath);
    return returnMissingBinding
      ? { missing: true, hash: null, root: null, entries: [], binding }
      : null;
  }
  return { ...manifest, binding };
}

export async function createBoundDirectory(
  path,
  {
    ownerRoot,
    label = "Directory",
    unsafeCode = "UNSAFE_DIRECTORY_PATH",
    mode = 0o700,
  } = {},
) {
  const absolutePath = resolve(path);
  const ownerAuthority = await resolveBoundDirectoryOwner(
    absolutePath,
    ownerRoot,
    label,
    unsafeCode,
  );
  if (ownerAuthority === null) {
    throw boundDirectoryError(absolutePath, label, unsafeCode, "requires ownerRoot");
  }
  const ancestors = bindReplacementOwner(
    await ensureReplacementParent(dirname(absolutePath), label, absolutePath, ownerAuthority),
    ownerAuthority,
  );
  const template = {
    root: { type: "directory", identity: null, mode },
    entries: [],
  };
  template.hash = directoryManifestHash(template);
  const ownership = { identity: null, manifest: null };
  const guardMissing = () => assertReplacementGuard({
    ancestors,
    label,
    target: absolutePath,
    missing: [absolutePath],
  });
  const manifest = await reserveReplacementDirectory(absolutePath, template, {
    before: guardMissing,
    after: (current) => assertReplacementGuard({
      ancestors,
      label,
      target: absolutePath,
      directories: [{ path: absolutePath, manifest: current }],
    }),
    label,
    target: absolutePath,
    ownership,
    finalizeMode: true,
  });
  const guardCreated = () => assertReplacementGuard({
    ancestors,
    label,
    target: absolutePath,
    directories: [{ path: absolutePath, manifest }],
  });
  await guardCreated();
  await syncDirectory(dirname(absolutePath));
  await guardCreated();
  return {
    ...manifest,
    binding: {
      path: absolutePath,
      ownerRoot: ownerAuthority.path,
      ownerAuthority,
      ancestors,
    },
  };
}

export async function removeBoundDirectory(
  path,
  expected,
  {
    ownerRoot = expected?.binding?.ownerRoot ?? null,
    label = "Directory",
    unsafeCode = "UNSAFE_DIRECTORY_PATH",
    beforeCleanup = null,
    beforeEntryCleanup = null,
    cleanupMkdir = mkdir,
    cleanupRmdir = rmdir,
    cleanupUnlink = unlink,
  } = {},
) {
  const absolutePath = resolve(path);
  const absoluteOwner = ownerRoot === null ? null : resolve(ownerRoot);
  const ownerAuthority = expected?.binding?.ownerAuthority ?? null;
  if (
    expected?.binding?.path !== absolutePath
    || expected.binding.ownerRoot !== absoluteOwner
    || !Array.isArray(expected.binding.ancestors)
    || (absoluteOwner !== null && (
      ownerAuthority === null
      || ownerAuthority.path !== absoluteOwner
      || typeof ownerAuthority.binding !== "object"
    ))
  ) {
    throw replacementChanged(label, absolutePath, "does not match its captured authority");
  }
  const ancestors = expected.binding.ancestors;
  const assertOwner = () => (
    ownerAuthority === null
      ? Promise.resolve()
      : assertReplacementOwnerCurrent(ownerAuthority, absolutePath, label)
  );
  const beforeGuard = async () => {
    await assertOwner();
    await assertReplacementGuard({
      ancestors,
      label,
      target: absolutePath,
      directories: [{ path: absolutePath, manifest: expected }],
    });
    await assertOwner();
  };
  const invariantGuard = async () => {
    await assertOwner();
    await assertReplacementAuthority(ancestors, label, absolutePath);
    await assertOwner();
  };
  const afterMoveGuard = async () => {
    await assertReplacementAuthority(ancestors, label, absolutePath);
    await assertReplacementPathMissing(absolutePath, label, absolutePath);
    await assertOwner();
    await assertReplacementAuthority(ancestors, label, absolutePath);
  };
  const cleanup = await cleanupReplacementDirectory(absolutePath, expected, {
    beforeGuard,
    afterMoveGuard,
    invariantGuard,
    beforeCleanup,
    beforeEntryCleanup,
    publication: { temporary: null, target: absolutePath, backup: null },
    kind: "directory",
    label,
    target: absolutePath,
    cleanupMkdir,
    cleanupRmdir,
    cleanupUnlink,
  });
  if (cleanup.failures.length === 0) {
    try {
      await afterMoveGuard();
      await syncDirectory(dirname(absolutePath));
      await afterMoveGuard();
    } catch (error) {
      cleanup.failures.push({ label: `${label} finalization`, error });
      if (!(await replacementPathIsMissing(absolutePath))) {
        cleanup.retainedPaths.push(absolutePath);
      }
    }
  }
  return {
    removed: cleanup.failures.length === 0 && cleanup.moved,
    failures: cleanup.failures,
    retainedPaths: cleanup.retainedPaths,
  };
}

export async function replaceFileAtomically(
  source,
  target,
  {
    expectedHash,
    expectedSnapshot,
    expectedSourceSnapshot = undefined,
    ownerRoot,
    beforeReplace = null,
    afterBackup = null,
    beforePublish = null,
    afterPublish = null,
    beforeRestore = null,
    beforeCleanup = null,
    cleanupRename = rename,
    cleanupMkdir = mkdir,
    cleanupRmdir = rmdir,
    syncDirectoryPath = syncDirectoryStrict,
  } = {},
) {
  source = resolve(source);
  target = resolve(target);
  if (typeof ownerRoot === "string") ownerRoot = resolve(ownerRoot);
  const label = "File replacement";
  const ownerAuthority = await resolveReplacementOwner(ownerRoot, target, label);
  const parent = dirname(target);
  const name = basename(target);
  if (!name) throw replacementChanged(label, target, "requires a named target");
  const expectedBinding = expectedSnapshot?.ownerBinding;
  const expectsAbsence = expectedSnapshot === null || expectedSnapshot?.missing === true;
  let prevalidatedAncestors = null;
  if (expectedBinding && typeof expectedBinding === "object") {
    prevalidatedAncestors = await captureExistingReplacementAncestors(
      parent,
      label,
      target,
      ownerAuthority,
    );
    const currentOwnerBinding = {
      path: ownerAuthority.path,
      binding: ownerAuthority.binding,
      ancestors: prevalidatedAncestors,
    };
    if (!sameBoundFileOwner(currentOwnerBinding, expectedBinding)) {
      throw replacementChanged(label, target, "changed from its expected owner authority");
    }
    if (expectsAbsence) await assertReplacementPathMissing(target, label, target);
  }
  const nonce = randomizedReplacementNonce();
  const temporary = join(parent, `.${name}.sdd-new-${nonce}`);
  const backup = join(parent, `.${name}.sdd-old-${nonce}`);
  const publication = { temporary, target, backup, ownerRoot: ownerAuthority.path };
  const ancestors = bindReplacementOwner(
    prevalidatedAncestors !== null && !expectsAbsence
      ? prevalidatedAncestors
      : await ensureReplacementParent(
        parent,
        label,
        target,
        ownerAuthority,
        prevalidatedAncestors ?? [],
        prevalidatedAncestors !== null && expectsAbsence,
      ),
    ownerAuthority,
  );
  const targetOwnerBinding = {
    path: ownerAuthority.path,
    binding: ownerAuthority.binding,
    ancestors,
  };
  await assertReplacementAuthority(ancestors, label, target);
  const sourceManifest = expectedSourceSnapshot?.ownerBinding
    ? await readBoundRegularFile(source, {
      ownerRoot: expectedSourceSnapshot.ownerBinding.path,
      label: `${label} source`,
      unsafeCode: "CONCURRENT_CHANGE",
      expectedOwnerBinding: expectedSourceSnapshot.ownerBinding,
    })
    : await captureReplacementFile(source, label, target);
  if (
    expectedSourceSnapshot !== undefined
    && !expectedFileMatches(sourceManifest, expectedSourceSnapshot)
  ) {
    throw replacementChanged(label, source, "changed from its expected snapshot");
  }
  const original = await captureReplacementFile(target, label, target, { allowMissing: true });
  validateExpectedReplacementHash(label, target, original, expectedHash);
  validateExpectedReplacementSnapshot(
    label,
    target,
    original,
    targetOwnerBinding,
    expectedSnapshot,
  );

  const temporaryOwnership = { identity: null, manifest: null };
  let staged = null;
  let backupManifest = null;
  let backupCreated = false;
  let publishedManifest = null;
  let published = false;
  let committed = false;
  let primaryError = null;

  const assertExpectedSourceAuthority = async () => {
    if (!expectedSourceSnapshot?.ownerBinding) return;
    const current = await readBoundRegularFile(source, {
      ownerRoot: expectedSourceSnapshot.ownerBinding.path,
      label: `${label} source`,
      unsafeCode: "CONCURRENT_CHANGE",
      expectedOwnerBinding: expectedSourceSnapshot.ownerBinding,
    });
    if (!expectedFileMatches(current, expectedSourceSnapshot)) {
      throw replacementChanged(label, source, "changed from its expected snapshot");
    }
  };

  const baseGuard = async ({
    targetManifest = original,
    temporaryManifest,
    backupState,
  } = {}) => {
    await assertExpectedSourceAuthority();
    const files = [{ path: source, manifest: sourceManifest }];
    const missing = [];
    if (targetManifest === null) missing.push(target);
    else if (targetManifest !== undefined) files.push({ path: target, manifest: targetManifest });
    if (temporaryManifest === null) missing.push(temporary);
    else if (temporaryManifest !== undefined) {
      files.push({ path: temporary, manifest: temporaryManifest });
    }
    if (backupState === null) missing.push(backup);
    else if (backupState !== undefined) files.push({ path: backup, manifest: backupState });
    const result = await assertReplacementGuard({ ancestors, label, target, files, missing });
    await assertExpectedSourceAuthority();
    return result;
  };
  const syncParentMetadata = (phase, guard) => syncReplacementMetadata(parent, {
    phase,
    guard,
    syncDirectoryPath,
    publication,
    label,
    target,
  });

  try {
    await performReplacementMutation(
      () => writeReplacementFile(temporary, sourceManifest, label, target, temporaryOwnership),
      {
        before: () => baseGuard({ temporaryManifest: null, backupState: null }),
        after: async (manifest) => {
          staged = manifest;
          await baseGuard({ temporaryManifest: staged, backupState: null });
        },
        label,
        target,
      },
    );
    await invokeReplacementHook(
      beforeReplace,
      publication,
      () => baseGuard({ temporaryManifest: staged, backupState: null }),
      `${label} before-replace hook`,
      target,
    );

    if (original !== null) {
      await performReplacementMutation(
        async () => {
          await link(target, backup);
          backupCreated = true;
          return captureReplacementFile(backup, label, target);
        },
        {
          before: () => baseGuard({ temporaryManifest: staged, backupState: null }),
          after: async (manifest) => {
            if (!sameReplacementFile(manifest, original)) {
              throw replacementChanged(label, target, `created an unexpected backup at ${backup}`);
            }
            backupManifest = manifest;
            await baseGuard({ temporaryManifest: staged, backupState: backupManifest });
          },
          label,
          target,
        },
      );
      await syncParentMetadata(
        "backup-reservation",
        () => baseGuard({
          temporaryManifest: staged,
          backupState: backupManifest,
        }),
      );

      const removal = await cleanupReplacementFile(target, original, {
        beforeGuard: () => baseGuard({
          temporaryManifest: staged,
          backupState: backupManifest,
        }),
        afterGuard: () => baseGuard({
          targetManifest: null,
          temporaryManifest: staged,
          backupState: backupManifest,
        }),
        invariantGuard: () => assertReplacementGuard({
          ancestors,
          label,
          target,
          files: [
            { path: temporary, manifest: staged },
            { path: backup, manifest: backupManifest },
          ],
        }),
        beforeCleanup,
        publication,
        kind: "target",
        label: `${label} target`,
        target,
        cleanupRename,
        cleanupMkdir,
        cleanupRmdir,
      });
      if (removal.failures.length > 0) {
        throw replacementRecoveryFailure(
          "File",
          target,
          null,
          removal.failures,
          removal.retainedPaths,
          null,
        );
      }
      await syncParentMetadata(
        "backup-removal",
        () => baseGuard({
          targetManifest: null,
          temporaryManifest: staged,
          backupState: backupManifest,
        }),
      );
      await invokeReplacementHook(
        afterBackup,
        publication,
        () => baseGuard({
          targetManifest: null,
          temporaryManifest: staged,
          backupState: backupManifest,
        }),
        `${label} after-backup hook`,
        target,
      );
    }

    const prepublicationGuard = () => baseGuard({
      targetManifest: null,
      temporaryManifest: staged,
      backupState: original === null ? null : backupManifest,
    });
    await invokeReplacementHook(
      beforePublish,
      publication,
      prepublicationGuard,
      `${label} before-publish hook`,
      target,
    );
    await performReplacementMutation(
      () => link(temporary, target),
      {
        before: prepublicationGuard,
        after: async () => {
          published = true;
          publishedManifest = await captureReplacementFile(target, label, target);
          if (!sameReplacementFile(publishedManifest, staged)) {
            throw replacementChanged(label, target, "published an unexpected file");
          }
          await baseGuard({
            targetManifest: publishedManifest,
            temporaryManifest: staged,
            backupState: original === null ? null : backupManifest,
          });
        },
        label,
        target,
      },
    );
    await invokeReplacementHook(
      afterPublish,
      publication,
      () => baseGuard({
        targetManifest: publishedManifest,
        temporaryManifest: staged,
        backupState: original === null ? null : backupManifest,
      }),
      `${label} after-publish hook`,
      target,
    );
    await syncParentMetadata(
      "publication",
      () => baseGuard({
        targetManifest: publishedManifest,
        temporaryManifest: staged,
        backupState: original === null ? null : backupManifest,
      }),
    );
    committed = true;
  } catch (error) {
    primaryError = error;
  }

  const recoveryFailures = [];
  const retainedPaths = [];
  const recordCleanupSyncFailure = (phase, error) => {
    recoveryFailures.push({ label: `${phase} durability`, error });
    if (!retainedPaths.includes(parent)) retainedPaths.push(parent);
  };
  let restored = original === null;

  if (primaryError && original !== null && backupManifest !== null && !published) {
    if (await replacementPathIsMissing(target)) {
      try {
        const restoreGuard = () => assertReplacementGuard({
          ancestors,
          label,
          target,
          files: [
            { path: backup, manifest: backupManifest },
            ...(staged ? [{ path: temporary, manifest: staged }] : []),
          ],
          missing: [target],
        });
        await invokeReplacementHook(
          beforeRestore,
          publication,
          restoreGuard,
          `${label} before-restore hook`,
          target,
        );
        await performReplacementMutation(
          () => link(backup, target),
          {
            before: restoreGuard,
            after: async () => {
              await assertReplacementFile(target, original, label, target);
              await assertReplacementFile(backup, backupManifest, label, target);
              await assertReplacementAuthority(ancestors, label, target);
            },
            label,
            target,
          },
        );
        await syncParentMetadata(
          "restore",
          () => assertReplacementGuard({
            ancestors,
            label,
            target,
            files: [
              { path: target, manifest: original },
              { path: backup, manifest: backupManifest },
              ...(staged ? [{ path: temporary, manifest: staged }] : []),
            ],
          }),
        );
        restored = true;
      } catch (error) {
        recoveryFailures.push({ label: "Restore", error });
        retainedPaths.push(backup);
        if (!(await replacementPathIsMissing(target))) retainedPaths.push(target);
      }
    } else {
      try {
        await assertReplacementFile(target, original, label, target);
        restored = true;
      } catch (error) {
        recoveryFailures.push({
          label: "Restore collision",
          error: replacementChanged(label, target, "preserved a newer target", error),
        });
        retainedPaths.push(backup);
      }
    }
  } else if (primaryError && original !== null && (backupCreated || backupManifest !== null)) {
    recoveryFailures.push({
      label: "Retained original",
      error: new Error(`Original retained at ${backup}.`),
    });
    retainedPaths.push(backup);
  }
  if (primaryError && published) {
    const publishedTargetMissing = await replacementPathIsMissing(target);
    recoveryFailures.push({
      label: "Published replacement",
      error: new Error(
        publishedTargetMissing
          ? `Published replacement no longer exists at ${target}.`
          : `Published replacement retained at ${target}.`,
      ),
    });
    if (!publishedTargetMissing && !retainedPaths.includes(target)) retainedPaths.push(target);
  }
  const temporaryTargetFiles = publishedManifest !== null
    ? [{ path: target, manifest: publishedManifest }]
    : (restored && original !== null ? [{ path: target, manifest: original }] : []);
  const temporaryTargetMissing = (
    publishedManifest === null
    && restored
    && original === null
  ) ? [target] : [];


  if (staged !== null) {
    const cleanup = await cleanupReplacementFile(temporary, staged, {
      beforeGuard: () => assertReplacementGuard({
        ancestors,
        label,
        target,
        files: [
          { path: temporary, manifest: staged },
          ...temporaryTargetFiles,
        ],
        missing: temporaryTargetMissing,
      }),
      afterGuard: () => assertReplacementGuard({
        ancestors,
        label,
        target,
        files: temporaryTargetFiles,
        missing: [temporary, ...temporaryTargetMissing],
      }),
      invariantGuard: () => assertReplacementGuard({
        ancestors,
        label,
        target,
        files: temporaryTargetFiles,
        missing: temporaryTargetMissing,
      }),
      beforeCleanup,
      publication,
      kind: "temporary",
      label: `${label} temporary`,
      target,
      cleanupRename,
      cleanupMkdir,
      cleanupRmdir,
    });
    addCleanupResult(recoveryFailures, retainedPaths, cleanup);
    try {
      await syncParentMetadata(
        "temporary-cleanup",
        () => assertReplacementGuard({
          ancestors,
          label,
          target,
          files: temporaryTargetFiles,
          missing: cleanup.failures.length === 0
            ? [temporary, ...temporaryTargetMissing]
            : temporaryTargetMissing,
        }),
      );
    } catch (error) {
      if (!(await replacementPathIsMissing(temporary))) retainedPaths.push(temporary);
      recordCleanupSyncFailure("Temporary cleanup", error);
    }
  } else if (temporaryOwnership.identity !== null && !(await replacementPathIsMissing(temporary))) {
    recoveryFailures.push({
      label: "Temporary cleanup",
      error: new Error("Temporary file never reached an authenticated complete state."),
    });
    retainedPaths.push(temporary);
  }

  if (
    backupManifest !== null
    && (committed || (primaryError && restored && !published))
  ) {
    const targetForCleanup = committed ? publishedManifest : original;
    const cleanup = await cleanupReplacementFile(backup, backupManifest, {
      beforeGuard: () => assertReplacementGuard({
        ancestors,
        label,
        target,
        files: [
          { path: target, manifest: targetForCleanup },
          { path: backup, manifest: backupManifest },
        ],
      }),
      afterGuard: () => assertReplacementGuard({
        ancestors,
        label,
        target,
        files: [{ path: target, manifest: targetForCleanup }],
        missing: [backup],
      }),
      invariantGuard: () => assertReplacementGuard({
        ancestors,
        label,
        target,
        files: [{ path: target, manifest: targetForCleanup }],
      }),
      beforeCleanup,
      publication,
      kind: "backup",
      label: `${label} backup`,
      target,
      cleanupRename,
      cleanupMkdir,
      cleanupRmdir,
    });
    addCleanupResult(recoveryFailures, retainedPaths, cleanup);
    try {
      await syncParentMetadata(
        "backup-cleanup",
        () => assertReplacementGuard({
          ancestors,
          label,
          target,
          files: [{ path: target, manifest: targetForCleanup }],
          missing: cleanup.failures.length === 0 ? [backup] : [],
        }),
      );
    } catch (error) {
      if (!(await replacementPathIsMissing(backup))) retainedPaths.push(backup);
      recordCleanupSyncFailure("Backup cleanup", error);
    }
  } else if (backupCreated && backupManifest === null) {
    recoveryFailures.push({
      label: "Backup cleanup",
      error: new Error("Backup path could not be authenticated and was preserved."),
    });
    retainedPaths.push(backup);
  }
  const authenticatedBackups = (
    recoveryFailures.length > 0 || retainedPaths.length > 0
  )
    ? await findAuthenticatedRetainedBackup(
      "File",
      backup,
      backupManifest,
      retainedPaths,
      label,
      target,
    )
    : [];

  if (primaryError) {
    if (recoveryFailures.length > 0 || retainedPaths.length > 0) {
      throw replacementRecoveryFailure(
        "File",
        target,
        primaryError,
        recoveryFailures,
        retainedPaths,
        backup,
        published,
        authenticatedBackups,
      );
    }
    throw primaryError;
  }
  if (recoveryFailures.length > 0) {
    throw replacementRecoveryFailure(
      "File",
      target,
      null,
      recoveryFailures,
      retainedPaths,
      backup,
      true,
      authenticatedBackups,
    );
  }
}

export async function replaceDirectoryAtomically(
  source,
  target,
  {
    expectedSnapshot = undefined,
    expectedSourceSnapshot = undefined,
    expectedHash,
    ownerRoot,
    beforePublish = null,
    afterBackup = null,
    afterPublish = null,
    beforeEntryPublish = null,
    afterEntryPublish = null,
    beforeRestore = null,
    beforeCleanup = null,
    beforeEntryCleanup = null,
    cleanupMkdir = mkdir,
    cleanupRmdir = rmdir,
    cleanupUnlink = unlink,
    syncDirectoryPath = syncDirectoryStrict,
  } = {},
) {
  source = resolve(source);
  target = resolve(target);
  if (typeof ownerRoot === "string") ownerRoot = resolve(ownerRoot);
  const label = "Directory replacement";
  const ownerAuthority = await resolveReplacementOwner(ownerRoot, target, label);
  const parent = dirname(target);
  const name = basename(target);
  if (!name) throw replacementChanged(label, target, "requires a named target");
  const expectedBinding = expectedSnapshot?.binding;
  const expectsAbsence = expectedSnapshot === null || expectedSnapshot?.missing === true;
  let prevalidatedAncestors = null;
  if (expectedBinding && typeof expectedBinding === "object") {
    prevalidatedAncestors = await captureExistingReplacementAncestors(
      parent,
      label,
      target,
      ownerAuthority,
    );
    const currentBinding = {
      path: target,
      ownerRoot: ownerAuthority.path,
      ownerAuthority,
      ancestors: prevalidatedAncestors,
    };
    if (!sameBoundDirectoryBinding(currentBinding, expectedBinding)) {
      throw replacementChanged(label, target, "changed from its expected owner authority");
    }
    if (expectsAbsence) await assertReplacementPathMissing(target, label, target);
  }
  const nonce = randomizedReplacementNonce();
  const temporary = join(parent, `.${name}.sdd-new-${nonce}`);
  const backup = join(parent, `.${name}.sdd-old-${nonce}`);
  const publication = { temporary, target, backup, ownerRoot: ownerAuthority.path };
  const ancestors = bindReplacementOwner(
    prevalidatedAncestors !== null && !expectsAbsence
      ? prevalidatedAncestors
      : await ensureReplacementParent(
        parent,
        label,
        target,
        ownerAuthority,
        prevalidatedAncestors ?? [],
        prevalidatedAncestors !== null && expectsAbsence,
      ),
    ownerAuthority,
  );
  await assertReplacementAuthority(ancestors, label, target);
  const sourceManifest = expectedSourceSnapshot?.binding
    ? await readBoundDirectory(source, {
      ownerRoot: expectedSourceSnapshot.binding.ownerRoot,
      label: `${label} source`,
      unsafeCode: "CONCURRENT_CHANGE",
      expectedBinding: expectedSourceSnapshot.binding,
    })
    : await captureReplacementDirectory(source, label, target);
  validateExpectedDirectorySnapshot(label, source, sourceManifest, expectedSourceSnapshot);
  const original = await captureReplacementDirectory(target, label, target, {
    allowMissing: true,
  });
  validateExpectedReplacementHash(label, target, original, expectedHash);
  validateExpectedDirectorySnapshot(label, target, original, expectedSnapshot);

  const temporaryOwnership = { identity: null, manifest: null };
  const backupOwnership = { identity: null, manifest: null };
  const targetOwnership = { identity: null, manifest: null };
  let staged = null;
  let backupManifest = null;
  let publishedManifest = null;
  let publicationStarted = false;
  let committed = false;
  let primaryError = null;

  const assertExpectedSourceAuthority = async () => {
    if (!expectedSourceSnapshot?.binding) return;
    const current = await readBoundDirectory(source, {
      ownerRoot: expectedSourceSnapshot.binding.ownerRoot,
      label: `${label} source`,
      unsafeCode: "CONCURRENT_CHANGE",
      expectedBinding: expectedSourceSnapshot.binding,
    });
    validateExpectedDirectorySnapshot(label, source, current, expectedSourceSnapshot);
  };

  const guard = async ({
    sourceState = sourceManifest,
    targetState = original,
    temporaryState,
    backupState,
  } = {}) => {
    await assertExpectedSourceAuthority();
    const directories = [];
    const missing = [];
    if (sourceState !== undefined) directories.push({ path: source, manifest: sourceState });
    if (targetState === null) missing.push(target);
    else if (targetState !== undefined) directories.push({ path: target, manifest: targetState });
    if (temporaryState === null) missing.push(temporary);
    else if (temporaryState !== undefined) {
      directories.push({ path: temporary, manifest: temporaryState });
    }
    if (backupState === null) missing.push(backup);
    else if (backupState !== undefined) {
      directories.push({ path: backup, manifest: backupState });
    }
    const result = await assertReplacementGuard({
      ancestors,
      label,
      target,
      directories,
      missing,
    });
    await assertExpectedSourceAuthority();
    return result;
  };
  const syncParentMetadata = (phase, stateGuard) => syncReplacementMetadata(parent, {
    phase,
    guard: stateGuard,
    syncDirectoryPath,
    publication,
    label,
    target,
  });
  const syncTreeMetadata = (root, manifest, phase, stateGuard) =>
    syncReplacementTree(root, manifest, {
      phase,
      guard: stateGuard,
      syncDirectoryPath,
      publication,
      label,
      target,
    });

  try {
    let temporaryReservation = await reserveReplacementDirectory(temporary, sourceManifest, {
      before: () => guard({ temporaryState: null, backupState: null }),
      after: (manifest) => guard({ temporaryState: manifest, backupState: null }),
      label,
      target,
      ownership: temporaryOwnership,
    });
    staged = await buildReplacementTree(temporary, sourceManifest, {
      initial: temporaryReservation,
      externalGuard: (current) => guard({ temporaryState: current, backupState: null }),
      publication,
      label,
      target,
    });
    temporaryOwnership.manifest = staged;
    const stagedGuard = () => guard({ temporaryState: staged, backupState: null });
    await syncTreeMetadata(temporary, staged, "temporary-tree", stagedGuard);
    await syncParentMetadata("temporary-reservation", stagedGuard);

    if (original !== null) {
      const backupReservation = await reserveReplacementDirectory(backup, original, {
        before: () => guard({ temporaryState: staged, backupState: null }),
        after: (manifest) => guard({ temporaryState: staged, backupState: manifest }),
        label,
        target,
        ownership: backupOwnership,
      });
      backupManifest = await buildReplacementTree(backup, original, {
        initial: backupReservation,
        externalGuard: (current) => guard({
          temporaryState: staged,
          backupState: current,
        }),
        publication,
        label,
        target,
      });
      backupOwnership.manifest = backupManifest;
      const backupGuard = () => guard({
        temporaryState: staged,
        backupState: backupManifest,
      });
      await syncTreeMetadata(backup, backupManifest, "backup-tree", backupGuard);
      await syncParentMetadata("backup-reservation", backupGuard);

      const targetCleanupInvariant = async () => {
        await assertExpectedSourceAuthority();
        await assertReplacementGuard({
          ancestors,
          label,
          target,
          directories: [
            { path: source, manifest: sourceManifest },
            { path: temporary, manifest: staged },
            { path: backup, manifest: backupManifest },
          ],
        });
        await assertExpectedSourceAuthority();
      };
      const removal = await cleanupReplacementDirectory(target, original, {
        beforeGuard: () => guard({
          temporaryState: staged,
          backupState: backupManifest,
        }),
        afterMoveGuard: () => guard({
          targetState: null,
          temporaryState: staged,
          backupState: backupManifest,
        }),
        invariantGuard: targetCleanupInvariant,
        beforeCleanup,
        beforeEntryCleanup,
        publication,
        kind: "target",
        label: `${label} target`,
        target,
        cleanupMkdir,
        cleanupRmdir,
        cleanupUnlink,
        syncDirectoryPath,
      });
      if (removal.failures.length > 0) {
        throw replacementRecoveryFailure(
          "Directory",
          target,
          null,
          removal.failures,
          removal.retainedPaths,
          null,
        );
      }
      await syncParentMetadata(
        "backup-removal",
        () => guard({
          targetState: null,
          temporaryState: staged,
          backupState: backupManifest,
        }),
      );
      await invokeReplacementHook(
        afterBackup,
        publication,
        () => guard({
          targetState: null,
          temporaryState: staged,
          backupState: backupManifest,
        }),
        `${label} after-backup hook`,
        target,
      );
    }

    const prepublicationGuard = () => guard({
      targetState: null,
      temporaryState: staged,
      backupState: original === null ? null : backupManifest,
    });
    await invokeReplacementHook(
      beforePublish,
      publication,
      prepublicationGuard,
      `${label} before-publish hook`,
      target,
    );

    const targetReservation = await reserveReplacementDirectory(target, staged, {
      before: prepublicationGuard,
      after: async (manifest) => {
        publicationStarted = true;
        await guard({
          targetState: manifest,
          temporaryState: staged,
          backupState: original === null ? null : backupManifest,
        });
      },
      label,
      target,
      ownership: targetOwnership,
    });
    publicationStarted = true;
    publishedManifest = await buildReplacementTree(target, staged, {
      initial: targetReservation,
      sourceRoot: temporary,
      externalGuard: (current) => guard({
        targetState: current,
        temporaryState: staged,
        backupState: original === null ? null : backupManifest,
      }),
      beforeEntry: beforeEntryPublish,
      afterEntry: afterEntryPublish,
      publication,
      label,
      target,
    });
    targetOwnership.manifest = publishedManifest;
    await invokeReplacementHook(
      afterPublish,
      publication,
      () => guard({
        targetState: publishedManifest,
        temporaryState: staged,
        backupState: original === null ? null : backupManifest,
      }),
      `${label} after-publish hook`,
      target,
    );
    const publishedGuard = () => guard({
      targetState: publishedManifest,
      temporaryState: staged,
      backupState: original === null ? null : backupManifest,
    });
    await syncTreeMetadata(target, publishedManifest, "publication-tree", publishedGuard);
    await syncParentMetadata("publication", publishedGuard);
    committed = true;
  } catch (error) {
    primaryError = error;
  }
  if (targetOwnership.identity !== null) publicationStarted = true;

  const recoveryFailures = [];
  const retainedPaths = [];
  let restored = original === null;

  if (primaryError && original !== null && backupManifest !== null && !publicationStarted) {
    if (await replacementPathIsMissing(target)) {
      try {
        const restoreGuard = () => assertReplacementGuard({
          ancestors,
          label,
          target,
          directories: [
            { path: backup, manifest: backupManifest },
            ...(staged ? [{ path: temporary, manifest: staged }] : []),
          ],
          missing: [target],
        });
        await invokeReplacementHook(
          beforeRestore,
          publication,
          restoreGuard,
          `${label} before-restore hook`,
          target,
        );
        const restoreOwnership = { identity: null, manifest: null };
        const restoreReservation = await reserveReplacementDirectory(target, backupManifest, {
          before: restoreGuard,
          after: (manifest) => assertReplacementGuard({
            ancestors,
            label,
            target,
            directories: [
              { path: target, manifest },
              { path: backup, manifest: backupManifest },
            ],
          }),
          label,
          target,
          ownership: restoreOwnership,
        });
        const restoredManifest = await buildReplacementTree(target, backupManifest, {
          initial: restoreReservation,
          sourceRoot: backup,
          externalGuard: (current) => assertReplacementGuard({
            ancestors,
            label,
            target,
            directories: [
              { path: target, manifest: current },
              { path: backup, manifest: backupManifest },
            ],
          }),
          publication,
          label,
          target,
        });
        if (!sameReplacementDirectory(restoredManifest, original, { identities: false })) {
          throw replacementChanged(label, target, "restored an unexpected directory tree");
        }
        const restoredGuard = () => assertReplacementGuard({
          ancestors,
          label,
          target,
          directories: [
            { path: target, manifest: restoredManifest },
            { path: backup, manifest: backupManifest },
            ...(staged ? [{ path: temporary, manifest: staged }] : []),
          ],
        });
        await syncTreeMetadata(target, restoredManifest, "restore-tree", restoredGuard);
        await syncParentMetadata("restore", restoredGuard);
        restored = true;
      } catch (error) {
        recoveryFailures.push({ label: "Restore", error });
        retainedPaths.push(backup);
        if (!(await replacementPathIsMissing(target))) retainedPaths.push(target);
      }
    } else {
      try {
        await assertReplacementDirectory(target, original, label, target);
        restored = true;
      } catch (error) {
        recoveryFailures.push({
          label: "Restore collision",
          error: replacementChanged(label, target, "preserved a newer target", error),
        });
        retainedPaths.push(backup);
      }
    }
  } else if (
    primaryError
    && original !== null
    && (backupOwnership.identity !== null || backupManifest !== null)
  ) {
    recoveryFailures.push({
      label: "Retained original",
      error: new Error(`Original retained at ${backup}.`),
    });
    retainedPaths.push(backup);
  }
  let publishedPathRetained = false;
  if (publicationStarted) {
    const publishedTargetMissing = await replacementPathIsMissing(target);
    publishedPathRetained = !publishedTargetMissing;
    if (primaryError && publishedTargetMissing) {
      recoveryFailures.push({
        label: "Published replacement",
        error: new Error(`Published replacement no longer exists at ${target}.`),
      });
    } else if (primaryError && !retainedPaths.includes(target)) {
      retainedPaths.push(target);
    }
  }
  const temporaryTargetDirectories = publishedManifest !== null
    ? [{ path: target, manifest: publishedManifest }]
    : (restored && original !== null ? [{ path: target, manifest: original }] : []);
  const temporaryTargetMissing = (
    publishedManifest === null
    && restored
    && original === null
  ) ? [target] : [];


  if (staged !== null) {
    const cleanup = await cleanupReplacementDirectory(temporary, staged, {
      beforeGuard: () => assertReplacementGuard({
        ancestors,
        label,
        target,
        directories: [
          { path: temporary, manifest: staged },
          ...temporaryTargetDirectories,
        ],
        missing: temporaryTargetMissing,
      }),
      afterMoveGuard: () => assertReplacementGuard({
        ancestors,
        label,
        target,
        directories: temporaryTargetDirectories,
        missing: [temporary, ...temporaryTargetMissing],
      }),
      invariantGuard: () => assertReplacementGuard({
        ancestors,
        label,
        target,
        directories: temporaryTargetDirectories,
        missing: temporaryTargetMissing,
      }),
      beforeCleanup,
      beforeEntryCleanup,
      publication,
      kind: "temporary",
      label: `${label} temporary`,
      target,
      cleanupMkdir,
      cleanupRmdir,
      cleanupUnlink,
      syncDirectoryPath,
    });
    addCleanupResult(recoveryFailures, retainedPaths, cleanup);
  } else if (
    temporaryOwnership.identity !== null
    && !(await replacementPathIsMissing(temporary))
  ) {
    recoveryFailures.push({
      label: "Temporary cleanup",
      error: new Error("Temporary directory never reached an authenticated complete state."),
    });
    retainedPaths.push(temporary);
  }

  let retainedBackupManifest = null;
  if (
    backupManifest !== null
    && (committed || (primaryError && restored && !publicationStarted))
  ) {
    const targetForCleanup = committed ? publishedManifest : original;
    const cleanup = await cleanupReplacementDirectory(backup, backupManifest, {
      beforeGuard: () => assertReplacementGuard({
        ancestors,
        label,
        target,
        directories: [
          { path: target, manifest: targetForCleanup },
          { path: backup, manifest: backupManifest },
        ],
      }),
      afterMoveGuard: () => assertReplacementGuard({
        ancestors,
        label,
        target,
        directories: [{ path: target, manifest: targetForCleanup }],
        missing: [backup],
      }),
      invariantGuard: () => assertReplacementGuard({
        ancestors,
        label,
        target,
        directories: [{ path: target, manifest: targetForCleanup }],
      }),
      beforeCleanup,
      beforeEntryCleanup,
      publication,
      kind: "backup",
      label: `${label} backup`,
      target,
      cleanupMkdir,
      cleanupRmdir,
      cleanupUnlink,
      syncDirectoryPath,
    });
    retainedBackupManifest = cleanup.retainedManifest;
    addCleanupResult(recoveryFailures, retainedPaths, cleanup);
  } else if (backupOwnership.identity !== null && backupManifest === null) {
    recoveryFailures.push({
      label: "Backup cleanup",
      error: new Error("Backup directory could not be authenticated and was preserved."),
    });
    retainedPaths.push(backup);
  }
  const authenticatedBackups = (
    recoveryFailures.length > 0 || retainedPaths.length > 0
  )
    ? await findAuthenticatedRetainedBackup(
      "Directory",
      backup,
      backupManifest,
      retainedPaths,
      label,
      target,
    )
    : [];
  if (retainedBackupManifest !== null) {
    try {
      await assertDirectReplacementManifest(
        backup,
        retainedBackupManifest,
        label,
        target,
      );
      if (sameReplacementCleanupProvenance(backupManifest, retainedBackupManifest)) {
        authenticatedBackups.push(resolve(backup));
      }
    } catch {
      // A path changed after cleanup reporting is never labeled as an authenticated backup.
    }
  }

  if (primaryError) {
    if (recoveryFailures.length > 0 || retainedPaths.length > 0) {
      throw replacementRecoveryFailure(
        "Directory",
        target,
        primaryError,
        recoveryFailures,
        retainedPaths,
        backup,
        publishedPathRetained,
        authenticatedBackups,
      );
    }
    throw primaryError;
  }
  if (recoveryFailures.length > 0) {
    throw replacementRecoveryFailure(
      "Directory",
      target,
      null,
      recoveryFailures,
      retainedPaths,
      backup,
      publishedPathRetained,
      authenticatedBackups,
    );
  }
}

export function isPathInside(parent, child) {
  const relation = relative(resolve(parent), resolve(child));
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== "..");
}

export async function resolvePhysicalPath(path) {
  const absolutePath = resolve(path);
  const missingSegments = [];
  let candidate = absolutePath;

  while (true) {
    try {
      await lstat(candidate);
      return resolve(await realpath(candidate), ...missingSegments.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw error;
      missingSegments.push(basename(candidate));
      candidate = parent;
    }
  }
}

export async function isPathPhysicallyInside(parent, child) {
  try {
    const [physicalParent, physicalChild] = await Promise.all([
      resolvePhysicalPath(parent),
      resolvePhysicalPath(child),
    ]);
    return isPathInside(physicalParent, physicalChild);
  } catch (error) {
    if (error?.code === "ENOTDIR") return false;
    throw error;
  }
}

export async function isDirectory(path) {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}
