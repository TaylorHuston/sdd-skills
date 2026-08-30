import { randomUUID } from "node:crypto";
import { lstat, link, mkdir, open, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { SddError } from "./errors.js";
import { isPathPhysicallyInside, readBoundRegularFile } from "./fs.js";

function identity(state) {
  return { dev: String(state.dev), ino: String(state.ino) };
}

function sameIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino;
}

function expectedBytes(expected) {
  if (Buffer.isBuffer(expected?.bytes)) return expected.bytes;
  if (typeof expected?.source === "string") return Buffer.from(expected.source, "utf8");
  return null;
}

function matchesExpected(observed, expected) {
  const bytes = expectedBytes(expected);
  return observed !== null
    && bytes !== null
    && sameIdentity(observed.identity, expected?.identity)
    && (expected?.mode === undefined || observed.mode === expected.mode)
    && observed.bytes.equals(bytes);
}

function concurrentChange(path, label, details = []) {
  return new SddError(`${label} changed before publication: ${path}`, {
    code: "CONCURRENT_CHANGE",
    details: [
      `Preserved path: ${path}`,
      ...details,
      "Inspect the preserved complete file, then retry setup or update if that state is still intended.",
    ],
  });
}

function recoveryFailure(
  path,
  label,
  error,
  retainedPaths,
  published = null,
  recordedRecoveryPaths = [],
  recordedResiduePaths = [],
) {
  const retained = [...new Set(retainedPaths.filter(Boolean))];
  const recorded = [...new Set(recordedRecoveryPaths.filter(Boolean))];
  const residue = [...new Set(recordedResiduePaths.filter(Boolean))];
  const failure = new SddError(`${label} publication requires manual recovery.`, {
    code: "MUTATION_RECOVERY_FAILED",
    details: [
      ...(published ? [`Published complete file: ${path}`] : []),
      `Original error: ${error?.code ? `${error.code}: ` : ""}${error?.message ?? String(error)}`,
      ...(error?.details ?? []).map((detail) => `Original detail: ${detail}`),
      ...retained.map((retainedPath) => `Retained path requiring inspection: ${retainedPath}`),
      ...recorded.map((recordedPath) => `Recovery path recorded before inspection failure: ${recordedPath}`),
      ...residue.map((residuePath) => `Staging path recorded before cleanup could be verified: ${residuePath}`),
      ...(recorded.length > 0 || residue.length > 0
        ? ["If a same-user actor moved a staging file or owner ancestor concurrently, inspect the owner location for the recorded recovery and staging names."]
        : []),
      "Inspect the retained complete files or recorded names, remove owned staging residue, keep the intended state, then retry setup or update.",
    ],
  });
  failure.errors = [error];
  failure.cause = error;
  failure.retainedPaths = [...new Set([...retained, ...recorded, ...residue])];
  failure.recordedRecoveryPaths = recorded;
  failure.recordedResiduePaths = residue;
  if (published) failure.published = published;
  return failure;
}

async function ensureParent(ownerRoot, path, label, assertOwnerCurrent = null) {
  const parent = dirname(path);
  let state;
  try {
    state = await lstat(parent, { bigint: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    try {
      await assertOwnerCurrent?.();
      await mkdir(parent, { recursive: true, mode: 0o755 });
      await assertOwnerCurrent?.();
    } catch (creationError) {
      if (creationError?.code !== "EEXIST") throw creationError;
    }
    state = await lstat(parent, { bigint: true });
  }
  if (
    state.isSymbolicLink()
    || !state.isDirectory()
    || !(await isPathPhysicallyInside(ownerRoot, parent))
  ) {
    throw new SddError(`${label} parent is not owner-confined: ${parent}`, {
      code: "UNSAFE_CONFIG_PATH",
      details: [parent],
    });
  }
  return parent;
}

async function readManagedFile(
  ownerRoot,
  path,
  label,
  { expectedOwnerBinding = undefined, returnMissingBinding = false } = {},
) {
  return readBoundRegularFile(path, {
    ownerRoot,
    allowMissing: true,
    returnMissingBinding,
    label,
    unsafeCode: "UNSAFE_CONFIG_PATH",
    expectedOwnerBinding,
  });
}

async function assertExpectedCurrent(ownerRoot, path, label, expected, ownerBinding) {
  const current = await readManagedFile(ownerRoot, path, label, {
    expectedOwnerBinding: ownerBinding,
  });
  if (expected === null || expected?.missing === true) {
    if (current !== null) throw concurrentChange(path, label);
    return null;
  }
  if (!matchesExpected(current, expected)) throw concurrentChange(path, label);
  return current;
}

async function verifyPublished(ownerRoot, path, label, staged, ownerBinding) {
  const published = await readManagedFile(ownerRoot, path, label, {
    expectedOwnerBinding: ownerBinding,
  });
  if (!matchesExpected(published, staged)) {
    throw concurrentChange(path, label, [
      "The published path no longer matches the complete staged file.",
    ]);
  }
  return published;
}

async function cleanupOwnedFile(path, expected) {
  let state;
  try {
    state = await lstat(path, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return "unverified";
    throw error;
  }
  if (!state.isFile() || state.isSymbolicLink() || !sameIdentity(identity(state), expected.identity)) {
    return "retained";
  }
  await rm(path);
  return "removed";
}

async function restoreDisplaced(ownerRoot, path, recoveryPath, label, displaced, ownerBinding) {
  const current = await readManagedFile(ownerRoot, path, label, {
    expectedOwnerBinding: ownerBinding,
  });
  if (current !== null) return false;
  try {
    await link(recoveryPath, path);
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
  const restored = await readManagedFile(ownerRoot, path, label, {
    expectedOwnerBinding: ownerBinding,
  });
  return matchesExpected(restored, displaced);
}

async function syncDirectoryBestEffort(path) {
  let handle;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch {
    // Directory fsync is not portable across every supported Node platform.
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function publishManagedFile(
  ownerRoot,
  path,
  source,
  {
    expected,
    label = "Managed installation file",
    beforeStage = null,
    beforePublish = null,
    afterDisplace = null,
    afterPublish = null,
    onPublished = null,
    assertOwnerCurrent = null,
  } = {},
) {
  ownerRoot = resolve(ownerRoot);
  path = resolve(path);
  await assertOwnerCurrent?.();
  const parent = await ensureParent(ownerRoot, path, label, assertOwnerCurrent);
  await assertOwnerCurrent?.();
  if (!(await isPathPhysicallyInside(ownerRoot, path))) {
    throw new SddError(`${label} resolves outside its owner root: ${path}`, {
      code: "UNSAFE_CONFIG_PATH",
    });
  }

  const observation = await readManagedFile(ownerRoot, path, label, {
    returnMissingBinding: true,
  });
  const current = observation?.missing === true ? null : observation;
  const effectiveExpected = expected === undefined
    ? current ?? { missing: true }
    : expected === null
      ? { missing: true, ownerBinding: observation?.ownerBinding }
      : expected;
  const ownerBinding = effectiveExpected?.missing === true
    ? effectiveExpected.ownerBinding ?? observation?.ownerBinding
    : effectiveExpected?.ownerBinding ?? current?.ownerBinding;
  await assertExpectedCurrent(ownerRoot, path, label, effectiveExpected, ownerBinding);
  await assertOwnerCurrent?.();

  const nonce = `${process.pid}-${randomUUID()}`;
  const temporary = join(parent, `.${basename(path)}.sdd-managed-${nonce}`);
  const recoveryPath = join(parent, `.${basename(path)}.sdd-managed-recovery-${nonce}`);
  const mode = effectiveExpected?.missing === true
    ? 0o600
    : effectiveExpected?.mode ?? current?.mode ?? 0o600;

  let handle = null;
  let stagingPathCreated = false;
  let staged = null;
  let displaced = null;
  let displacementRecorded = false;
  let published = null;
  let primaryError = null;
  const retainedPaths = [];
  const recordedRecoveryPaths = [];
  const recordedResiduePaths = [];
  try {
    await beforeStage?.({ temporary, target: path, recoveryPath });
    await assertOwnerCurrent?.();
    handle = await open(temporary, "wx", mode);
    stagingPathCreated = true;
    await handle.chmod(mode);
    const temporaryState = await handle.stat({ bigint: true });
    staged = {
      source,
      bytes: Buffer.from(source, "utf8"),
      identity: identity(temporaryState),
      mode: Number(temporaryState.mode & 0o777n),
    };
    await handle.writeFile(source, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;

    await beforePublish?.({ temporary, target: path, recoveryPath });
    await assertOwnerCurrent?.();
    await assertExpectedCurrent(ownerRoot, path, label, effectiveExpected, ownerBinding);
    await assertOwnerCurrent?.();

    if (effectiveExpected?.missing === true) {
      try {
        await link(temporary, path);
      } catch (error) {
        if (["EEXIST", "ENOENT", "ENOTDIR", "EISDIR", "ELOOP"].includes(error?.code)) {
          throw concurrentChange(path, label, [error.message]);
        }
        throw error;
      }
    } else {
      try {
        await rename(path, recoveryPath);
      } catch (error) {
        if (["ENOENT", "ENOTDIR", "EISDIR", "ELOOP"].includes(error?.code)) {
          throw concurrentChange(path, label, [error.message]);
        }
        throw error;
      }
      displacementRecorded = true;
      await afterDisplace?.({ temporary, target: path, recoveryPath });
      displaced = await readManagedFile(ownerRoot, recoveryPath, label, {
        expectedOwnerBinding: ownerBinding,
      });
      if (!matchesExpected(displaced, effectiveExpected)) {
        const restored = await restoreDisplaced(
          ownerRoot,
          path,
          recoveryPath,
          label,
          displaced,
          ownerBinding,
        );
        if (restored) {
          const cleanup = await cleanupOwnedFile(recoveryPath, displaced);
          if (cleanup === "removed") displacementRecorded = false;
          if (cleanup === "retained") retainedPaths.push(recoveryPath);
        } else {
          retainedPaths.push(recoveryPath);
        }
        throw concurrentChange(path, label, restored ? [] : [
          `Retained displaced file: ${recoveryPath}`,
        ]);
      }
      try {
        await link(temporary, path);
      } catch (error) {
        const restored = await restoreDisplaced(
          ownerRoot,
          path,
          recoveryPath,
          label,
          displaced,
          ownerBinding,
        );
        if (restored) {
          const cleanup = await cleanupOwnedFile(recoveryPath, displaced);
          if (cleanup === "removed") displacementRecorded = false;
          if (cleanup === "retained") retainedPaths.push(recoveryPath);
        } else {
          retainedPaths.push(recoveryPath);
        }
        if (["EEXIST", "ENOENT", "ENOTDIR", "EISDIR", "ELOOP"].includes(error?.code)) {
          throw concurrentChange(path, label, [
            error.message,
            ...(restored ? [] : [`Retained displaced file: ${recoveryPath}`]),
          ]);
        }
        throw error;
      }
    }

    await assertOwnerCurrent?.();
    published = await verifyPublished(ownerRoot, path, label, staged, ownerBinding);
    await onPublished?.(published);
    await assertOwnerCurrent?.();
    await afterPublish?.({ temporary, target: path, recoveryPath, published });
    await assertOwnerCurrent?.();
    published = await verifyPublished(ownerRoot, path, label, staged, ownerBinding);
    await syncDirectoryBestEffort(parent);
    if (displaced !== null) {
      const cleanup = await cleanupOwnedFile(recoveryPath, displaced);
      if (cleanup === "removed") displacementRecorded = false;
      if (cleanup === "retained") retainedPaths.push(recoveryPath);
    }
  } catch (error) {
    primaryError = error;
  }

  if (displacementRecorded && !retainedPaths.includes(recoveryPath)) {
    recordedRecoveryPaths.push(recoveryPath);
  }
  if (handle) {
    try {
      await handle.close();
    } catch (error) {
      primaryError = primaryError ?? error;
    }
  }
  if (staged !== null) {
    try {
      const cleanup = await cleanupOwnedFile(temporary, staged);
      if (cleanup === "retained") retainedPaths.push(temporary);
      if (cleanup === "unverified") recordedResiduePaths.push(temporary);
    } catch {
      recordedResiduePaths.push(temporary);
    }
  } else if (stagingPathCreated) {
    recordedResiduePaths.push(temporary);
  }

  if (
    retainedPaths.length > 0
    || recordedRecoveryPaths.length > 0
    || recordedResiduePaths.length > 0
    || (published && primaryError)
  ) {
    throw recoveryFailure(
      path,
      label,
      primaryError ?? new Error("Managed file cleanup failed."),
      retainedPaths,
      published,
      recordedRecoveryPaths,
      recordedResiduePaths,
    );
  }
  if (primaryError) throw primaryError;
  return published;
}
