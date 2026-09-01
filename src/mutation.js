import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { SddError } from "./errors.js";
import { isPathPhysicallyInside } from "./fs.js";

function identity(state) {
  return state ? { dev: String(state.dev), ino: String(state.ino) } : null;
}

function sameIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino;
}

async function lstatIfPresent(path) {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function operationInProgress(lockPath, owner = null) {
  return new SddError(`Another SDD mutation is already in progress: ${lockPath}`, {
    code: "OPERATION_IN_PROGRESS",
    details: [
      `Lock: ${lockPath}`,
      Number.isInteger(owner?.pid) ? `Owner PID: ${owner.pid}` : "Owner PID: unknown",
      owner?.createdAt ? `Created: ${owner.createdAt}` : "Created: unknown",
      "Confirm that no setup or update process is active, then remove the retained lock manually before retrying.",
    ],
  });
}

function mutationRecoveryFailure(
  lockPath,
  message,
  errors = [],
  retainedPaths = [lockPath],
) {
  const retained = [...new Set(retainedPaths.filter(Boolean))];
  const failure = new SddError(message, {
    code: "MUTATION_RECOVERY_FAILED",
    details: [
      ...retained.map((path) => `Retained lock path requiring inspection: ${path}`),
      ...errors.flatMap(({ label, error }) => [
        `${label}: ${error?.code ? `${error.code}: ` : ""}${error?.message ?? String(error)}`,
        ...(error?.details ?? []).map((detail) => `${label} detail: ${detail}`),
      ]),
      "Confirm that no setup or update process is active, inspect the retained lock, and remove it manually before retrying.",
    ],
  });
  failure.retainedPaths = retained;
  failure.errors = errors.map(({ error }) => error);
  if (failure.errors.length > 0) {
    failure.cause = new AggregateError(failure.errors, failure.message);
  }
  return failure;
}

async function inspectExistingLock(lockPath) {
  let handle;
  try {
    handle = await open(lockPath, "r");
    const state = await handle.stat({ bigint: true });
    if (!state.isFile()) return null;
    const source = await handle.readFile("utf8");
    try {
      return JSON.parse(source);
    } catch {
      return null;
    }
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function assertWorkspaceCurrent(workspaceRoot, workspaceIdentity) {
  const workspaceState = await stat(workspaceRoot, { bigint: true });
  if (
    !workspaceState.isDirectory()
    || !sameIdentity(identity(workspaceState), workspaceIdentity)
  ) {
    throw new SddError(`Selected workspace authority changed: ${workspaceRoot}`, {
      code: "UNSAFE_CONFIG_PATH",
    });
  }
}

async function assertLockCurrent(workspaceRoot, workspaceIdentity, lockPath, lockIdentity, source) {
  const lockState = await lstatIfPresent(lockPath);
  await assertWorkspaceCurrent(workspaceRoot, workspaceIdentity);
  if (
    !lockState?.isFile()
    || lockState.isSymbolicLink()
    || !sameIdentity(identity(lockState), lockIdentity)
    || !(await isPathPhysicallyInside(workspaceRoot, lockPath))
  ) {
    throw mutationRecoveryFailure(
      lockPath,
      `Workspace mutation authority changed while setup or update was active: ${workspaceRoot}`,
    );
  }
  let handle;
  try {
    handle = await open(lockPath, "r");
    const state = await handle.stat({ bigint: true });
    const currentSource = await handle.readFile("utf8");
    if (!sameIdentity(identity(state), lockIdentity) || currentSource !== source) {
      throw mutationRecoveryFailure(
        lockPath,
        `Workspace mutation lock changed while setup or update was active: ${lockPath}`,
      );
    }
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function releaseOwnedLock(
  workspaceRoot,
  workspaceIdentity,
  lockPath,
  lockIdentity,
  source,
  beforeLockRelease,
) {
  await assertLockCurrent(workspaceRoot, workspaceIdentity, lockPath, lockIdentity, source);
  await beforeLockRelease?.({ lockPath });
  const releasePath = `${lockPath}.release-${process.pid}-${randomUUID()}`;
  try {
    await rename(lockPath, releasePath);
  } catch (error) {
    throw mutationRecoveryFailure(
      lockPath,
      `Mutation lock could not be moved to its release guard: ${lockPath}`,
      [{ label: "Release guard", error }],
      [lockPath, ...(await lstatIfPresent(releasePath) ? [releasePath] : [])],
    );
  }

  let released;
  try {
    let handle;
    try {
      handle = await open(releasePath, "r");
      const state = await handle.stat({ bigint: true });
      released = {
        identity: identity(state),
        regular: state.isFile(),
        source: await handle.readFile("utf8"),
      };
    } finally {
      await handle?.close().catch(() => {});
    }
  } catch (error) {
    throw mutationRecoveryFailure(
      lockPath,
      `Mutation lock release guard requires inspection: ${releasePath}`,
      [{ label: "Release guard inspection", error }],
      [releasePath, ...(await lstatIfPresent(lockPath) ? [lockPath] : [])],
    );
  }

  if (
    !released.regular
    || !sameIdentity(released.identity, lockIdentity)
    || released.source !== source
  ) {
    let restored = false;
    try {
      await link(releasePath, lockPath);
      restored = true;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw mutationRecoveryFailure(
          lockPath,
          `A replacement mutation lock was preserved during release: ${releasePath}`,
          [{ label: "Replacement lock restoration", error }],
          [releasePath, ...(await lstatIfPresent(lockPath) ? [lockPath] : [])],
        );
      }
    }
    if (restored) {
      const currentRelease = await lstatIfPresent(releasePath);
      if (currentRelease && sameIdentity(identity(currentRelease), released.identity)) {
        await rm(releasePath).catch(() => {});
      }
    }
    throw mutationRecoveryFailure(
      lockPath,
      "A replacement mutation lock appeared during release and was preserved.",
      [],
      [lockPath, ...(await lstatIfPresent(releasePath) ? [releasePath] : [])],
    );
  }

  const currentRelease = await lstatIfPresent(releasePath);
  if (!currentRelease || !sameIdentity(identity(currentRelease), lockIdentity)) {
    throw mutationRecoveryFailure(
      lockPath,
      `Mutation lock release guard changed before cleanup: ${releasePath}`,
      [],
      [...(currentRelease ? [releasePath] : []), ...(await lstatIfPresent(lockPath) ? [lockPath] : [])],
    );
  }
  try {
    await rm(releasePath);
  } catch (error) {
    throw mutationRecoveryFailure(
      lockPath,
      `Mutation lock release guard could not be removed: ${releasePath}`,
      [{ label: "Release guard cleanup", error }],
      [releasePath, ...(await lstatIfPresent(lockPath) ? [lockPath] : [])],
    );
  }
}

export async function withWorkspaceMutationLock(
  workspaceRoot,
  callback,
  {
    openFile = open,
    beforeLockDirectoryCreate = null,
    beforeLockRelease = null,
  } = {},
) {
  const workspaceState = await stat(workspaceRoot, { bigint: true });
  if (!workspaceState.isDirectory()) {
    throw new SddError(`Workspace mutation owner is not a directory: ${workspaceRoot}`, {
      code: "UNSAFE_CONFIG_PATH",
    });
  }
  const workspaceIdentity = identity(workspaceState);
  const lockDirectory = join(workspaceRoot, ".sdd");
  if (!(await isPathPhysicallyInside(workspaceRoot, lockDirectory))) {
    throw new SddError(`Mutation lock directory resolves outside its owner root: ${lockDirectory}`, {
      code: "UNSAFE_CONFIG_PATH",
    });
  }
  try {
    await beforeLockDirectoryCreate?.({ lockDirectory, workspaceRoot });
    await assertWorkspaceCurrent(workspaceRoot, workspaceIdentity);
    await mkdir(lockDirectory, { mode: 0o755 });
    await assertWorkspaceCurrent(workspaceRoot, workspaceIdentity);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const lockDirectoryState = await lstat(lockDirectory, { bigint: true });
  if (
    lockDirectoryState.isSymbolicLink()
    || !lockDirectoryState.isDirectory()
    || !(await isPathPhysicallyInside(workspaceRoot, lockDirectory))
  ) {
    throw new SddError(`Mutation lock directory is not owner-confined: ${lockDirectory}`, {
      code: "UNSAFE_CONFIG_PATH",
    });
  }
  const lockPath = join(lockDirectory, "mutation.lock");
  if (!(await isPathPhysicallyInside(workspaceRoot, lockPath))) {
    throw new SddError(`Mutation lock path resolves outside its owner root: ${lockPath}`, {
      code: "UNSAFE_CONFIG_PATH",
    });
  }

  const token = randomUUID();
  const source = `${JSON.stringify({
    pid: process.pid,
    token,
    createdAt: new Date().toISOString(),
    workspaceIdentity,
  })}\n`;
  let handle;
  let lockIdentity;
  try {
    handle = await openFile(lockPath, "wx", 0o600);
    await handle.writeFile(source, "utf8");
    await handle.sync();
    const state = await handle.stat({ bigint: true });
    lockIdentity = identity(state);
    await handle.close();
    handle = null;
    await assertLockCurrent(workspaceRoot, workspaceIdentity, lockPath, lockIdentity, source);
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error?.code === "EEXIST") {
      throw operationInProgress(lockPath, await inspectExistingLock(lockPath));
    }
    const current = await lstatIfPresent(lockPath);
    if (current && lockIdentity && sameIdentity(identity(current), lockIdentity)) {
      await rm(lockPath).catch(() => {});
    }
    throw error;
  }

  let result;
  let callbackError = null;
  try {
    result = await callback({
      path: lockPath,
      source,
      identity: lockIdentity,
      assertCurrent: () => assertLockCurrent(
        workspaceRoot,
        workspaceIdentity,
        lockPath,
        lockIdentity,
        source,
      ),
    });
  } catch (error) {
    callbackError = error;
  }

  let releaseError = null;
  try {
    await releaseOwnedLock(
      workspaceRoot,
      workspaceIdentity,
      lockPath,
      lockIdentity,
      source,
      beforeLockRelease,
    );
  } catch (error) {
    releaseError = error?.code === "MUTATION_RECOVERY_FAILED"
      ? error
      : mutationRecoveryFailure(lockPath, `Mutation lock could not be released safely: ${lockPath}`, [
          { label: "Release", error },
        ]);
  }

  if (callbackError && releaseError) {
    throw mutationRecoveryFailure(
      lockPath,
      `SDD mutation failed and its lock could not be released safely: ${lockPath}`,
      [
        { label: "Original error", error: callbackError },
        { label: "Lock release", error: releaseError },
      ],
    );
  }
  if (callbackError) throw callbackError;
  if (releaseError) throw releaseError;
  return result;
}
