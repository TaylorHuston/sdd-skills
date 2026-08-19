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

function concurrentChange(path, details = []) {
  return new SddError(`SDD configuration changed before publication: ${path}`, {
    code: "CONCURRENT_CHANGE",
    details: [
      `Preserved configuration path: ${path}`,
      ...details,
      "Read the current configuration and retry the command if the preserved state is still intended.",
    ],
  });
}

function recoveryFailure(path, error, retainedPaths, published = false) {
  const retained = [...new Set(retainedPaths.filter(Boolean))];
  const failure = new SddError("SDD configuration publication requires manual recovery.", {
    code: "MUTATION_RECOVERY_FAILED",
    details: [
      ...(published ? [`Published configuration path: ${path}`] : []),
      `Original error: ${error?.code ? `${error.code}: ` : ""}${error?.message ?? String(error)}`,
      ...(error?.details ?? []).map((detail) => `Original detail: ${detail}`),
      ...retained.map((retainedPath) => `Retained path requiring inspection: ${retainedPath}`),
      "Inspect the retained paths, preserve the intended complete configuration, then retry the command.",
    ],
  });
  failure.errors = [error];
  failure.cause = error;
  failure.retainedPaths = retained;
  return failure;
}

async function readConfigFile(
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

async function ensureConfigDirectory(ownerRoot, path) {
  const parent = dirname(path);
  let state;
  try {
    state = await lstat(parent, { bigint: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    try {
      await mkdir(parent, { mode: 0o755 });
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
    throw new SddError(`SDD configuration directory is not owner-confined: ${parent}`, {
      code: "UNSAFE_CONFIG_PATH",
      details: [parent],
    });
  }
  return parent;
}

async function assertExpectedCurrent(ownerRoot, path, expected, ownerBinding) {
  const current = await readConfigFile(
    ownerRoot,
    path,
    "SDD configuration publication target",
    { expectedOwnerBinding: ownerBinding },
  );
  if (expected === null || expected?.missing === true) {
    if (current !== null) throw concurrentChange(path);
    return null;
  }
  if (!matchesExpected(current, expected)) throw concurrentChange(path);
  return current;
}

async function verifyPublished(ownerRoot, path, staged, ownerBinding) {
  const published = await readConfigFile(
    ownerRoot,
    path,
    "Published SDD configuration",
    { expectedOwnerBinding: ownerBinding },
  );
  if (!matchesExpected(published, staged)) {
    throw concurrentChange(path, ["The published path no longer matches the complete staged file."]);
  }
  return published;
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

async function removeIfOwned(path, expected) {
  let state;
  try {
    state = await lstat(path, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
  if (!state.isFile() || state.isSymbolicLink() || !sameIdentity(identity(state), expected.identity)) {
    return false;
  }
  await rm(path);
  return true;
}

async function restoreDisplaced(
  ownerRoot,
  path,
  recoveryPath,
  displaced,
  ownerBinding,
) {
  const current = await readConfigFile(
    ownerRoot,
    path,
    "SDD configuration recovery target",
    { expectedOwnerBinding: ownerBinding },
  );
  if (current !== null) return false;
  try {
    await link(recoveryPath, path);
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
  const restored = await readConfigFile(
    ownerRoot,
    path,
    "Restored SDD configuration",
    { expectedOwnerBinding: ownerBinding },
  );
  return matchesExpected(restored, displaced);
}

export async function publishConfigFile(
  ownerRoot,
  path,
  source,
  {
    expected,
    beforePublish = null,
    afterDisplace = null,
    afterPublish = null,
  } = {},
) {
  ownerRoot = resolve(ownerRoot);
  path = resolve(path);
  const parent = await ensureConfigDirectory(ownerRoot, path);
  if (!(await isPathPhysicallyInside(ownerRoot, path))) {
    throw new SddError(`SDD configuration path resolves outside its owner root: ${path}`, {
      code: "UNSAFE_CONFIG_PATH",
    });
  }

  const observation = await readConfigFile(
    ownerRoot,
    path,
    "SDD configuration publication target",
    { returnMissingBinding: true },
  );
  const current = observation?.missing === true ? null : observation;
  const effectiveExpected = expected === undefined
    ? current ?? { missing: true }
    : expected === null
      ? { missing: true }
      : expected;
  const ownerBinding = effectiveExpected?.missing === true
    ? observation?.ownerBinding
    : effectiveExpected?.ownerBinding ?? current?.ownerBinding;
  await assertExpectedCurrent(ownerRoot, path, effectiveExpected, ownerBinding);

  const nonce = `${process.pid}-${randomUUID()}`;
  const temporary = join(parent, `.${basename(path)}.sdd-config-${nonce}`);
  const recoveryPath = join(parent, `.${basename(path)}.sdd-config-recovery-${nonce}`);
  const mode = effectiveExpected?.missing === true || effectiveExpected === null
    ? 0o600
    : effectiveExpected?.mode ?? current?.mode ?? 0o600;

  let handle = null;
  let staged = null;
  let displaced = null;
  let published = false;
  let primaryError = null;
  const retainedPaths = [];
  try {
    handle = await open(temporary, "wx", mode);
    const temporaryState = await handle.stat({ bigint: true });
    staged = {
      source,
      bytes: Buffer.from(source, "utf8"),
      identity: identity(temporaryState),
      mode,
    };
    await handle.writeFile(source, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;

    await beforePublish?.({ temporary, target: path, recoveryPath });
    await assertExpectedCurrent(ownerRoot, path, effectiveExpected, ownerBinding);

    if (effectiveExpected?.missing === true || effectiveExpected === null) {
      try {
        await link(temporary, path);
      } catch (error) {
        if (["EEXIST", "ENOENT", "ENOTDIR", "EISDIR", "ELOOP"].includes(error?.code)) {
          throw concurrentChange(path, [error.message]);
        }
        throw error;
      }
    } else {
      try {
        await rename(path, recoveryPath);
      } catch (error) {
        if (["ENOENT", "ENOTDIR", "EISDIR", "ELOOP"].includes(error?.code)) {
          throw concurrentChange(path, [error.message]);
        }
        throw error;
      }
      displaced = await readConfigFile(
        ownerRoot,
        recoveryPath,
        "Displaced SDD configuration",
        { expectedOwnerBinding: ownerBinding },
      );
      if (!matchesExpected(displaced, effectiveExpected)) {
        const restored = await restoreDisplaced(
          ownerRoot,
          path,
          recoveryPath,
          displaced,
          ownerBinding,
        );
        if (restored) {
          await removeIfOwned(recoveryPath, displaced);
        } else {
          retainedPaths.push(recoveryPath);
        }
        throw concurrentChange(path, [
          ...(restored ? [] : [`Retained displaced configuration: ${recoveryPath}`]),
        ]);
      }
      await afterDisplace?.({ temporary, target: path, recoveryPath });
      try {
        await link(temporary, path);
      } catch (error) {
        const restored = await restoreDisplaced(
          ownerRoot,
          path,
          recoveryPath,
          displaced,
          ownerBinding,
        );
        if (restored) {
          await removeIfOwned(recoveryPath, displaced);
        } else {
          retainedPaths.push(recoveryPath);
        }
        if (["EEXIST", "ENOENT", "ENOTDIR", "EISDIR", "ELOOP"].includes(error?.code)) {
          throw concurrentChange(path, [
            error.message,
            ...(restored ? [] : [`Retained original configuration: ${recoveryPath}`]),
          ]);
        }
        throw error;
      }
    }

    await afterPublish?.({ temporary, target: path, recoveryPath });
    await verifyPublished(ownerRoot, path, staged, ownerBinding);
    published = true;
    await syncDirectoryBestEffort(parent);
    if (displaced !== null) {
      const removed = await removeIfOwned(recoveryPath, displaced);
      if (!removed) {
        retainedPaths.push(recoveryPath);
        throw recoveryFailure(
          path,
          new Error("The displaced configuration changed before cleanup."),
          retainedPaths,
          true,
        );
      }
    }
  } catch (error) {
    primaryError = error;
  }

  if (primaryError && displaced !== null) {
    try {
      await lstat(recoveryPath);
      retainedPaths.push(recoveryPath);
    } catch (error) {
      if (error?.code !== "ENOENT") retainedPaths.push(recoveryPath);
    }
  }

  if (handle) {
    try {
      await handle.close();
    } catch (error) {
      primaryError = primaryError ?? error;
      retainedPaths.push(temporary);
    }
  }
  if (staged !== null) {
    try {
      const removed = await removeIfOwned(temporary, staged);
      if (!removed) retainedPaths.push(temporary);
    } catch {
      retainedPaths.push(temporary);
    }
  }

  if (retainedPaths.length > 0 && primaryError?.code !== "MUTATION_RECOVERY_FAILED") {
    throw recoveryFailure(path, primaryError ?? new Error("Configuration cleanup failed."), retainedPaths, published);
  }
  if (primaryError) throw primaryError;
  return verifyPublished(ownerRoot, path, staged, ownerBinding);
}
