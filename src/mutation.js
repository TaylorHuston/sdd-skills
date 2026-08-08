import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { getConfigDirectory } from "./config.js";
import { SddError } from "./errors.js";
import { isPathPhysicallyInside } from "./fs.js";

function sameFileIdentity(left, right) {
  return left && right && left.dev === right.dev && left.ino === right.ino;
}

async function observeLock(path) {
  let handle;
  try {
    handle = await open(path, "r");
    const state = await handle.stat();
    const source = await handle.readFile("utf8");
    return { source, state };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

function parseLockOwner(source) {
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}

function isLockOwnerAlive(owner) {
  if (!Number.isInteger(owner?.pid) || owner.pid <= 0) return true;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function operationInProgressError(lockPath, owner, details = []) {
  return new SddError(`Another SDD mutation is already in progress: ${lockPath}`, {
    code: "OPERATION_IN_PROGRESS",
    details: [
      `Lock: ${lockPath}`,
      Number.isInteger(owner?.pid) ? `Owner PID: ${owner.pid}` : "Owner PID: unknown",
      owner?.createdAt ? `Created: ${owner.createdAt}` : "Created: unknown",
      ...details,
      "Inspect mutation.lock.reclaim and any adjacent .sdd-reclaim-* file. Remove them manually only after confirming no SDD mutation is active.",
    ],
  });
}

async function restoreQuarantinedLock(quarantinePath, lockPath) {
  try {
    await link(quarantinePath, lockPath);
    await rm(quarantinePath, { force: true });
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
}

async function removeObservedLock(lockPath, expected, label) {
  const quarantinePath = join(
    dirname(lockPath),
    `.sdd-${label}-${process.pid}-${randomUUID()}`,
  );
  try {
    await rename(lockPath, quarantinePath);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  const quarantined = await observeLock(quarantinePath);
  const owned = sameFileIdentity(quarantined?.state, expected.state)
    && (expected.source === undefined || quarantined?.source === expected.source);
  if (owned) {
    await rm(quarantinePath, { force: true });
    return true;
  }
  await restoreQuarantinedLock(quarantinePath, lockPath);
  return false;
}

async function reclaimStaleLock(
  lockPath,
  reclaimPath,
  observed,
  owner,
  afterStaleLockQuarantined,
) {
  try {
    await link(lockPath, reclaimPath);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    if (error?.code === "EEXIST") {
      throw operationInProgressError(lockPath, owner, [
        `Stale-lock reclamation is already in progress: ${reclaimPath}`,
      ]);
    }
    throw error;
  }

  const claim = await observeLock(reclaimPath);
  if (!sameFileIdentity(claim?.state, observed.state) || claim?.source !== observed.source) {
    await rm(reclaimPath, { force: true }).catch(() => {});
    throw operationInProgressError(lockPath, owner, [
      "The lock changed before stale-lock reclamation could claim it.",
    ]);
  }

  const quarantinePath = join(
    dirname(lockPath),
    `.sdd-reclaim-${process.pid}-${randomUUID()}`,
  );
  try {
    await rename(lockPath, quarantinePath);
  } catch (error) {
    await rm(reclaimPath, { force: true }).catch(() => {});
    if (error?.code === "ENOENT") return false;
    throw error;
  }

  const quarantined = await observeLock(quarantinePath);
  if (!sameFileIdentity(quarantined?.state, observed.state)
    || quarantined?.source !== observed.source
    || isLockOwnerAlive(parseLockOwner(quarantined?.source))) {
    const restored = await restoreQuarantinedLock(quarantinePath, lockPath).catch(() => false);
    await rm(reclaimPath, { force: true }).catch(() => {});
    throw operationInProgressError(lockPath, owner, [
      "The quarantined lock did not match the observed dead-owner lock.",
      ...(restored ? [] : [`Quarantine retained for inspection: ${quarantinePath}`]),
    ]);
  }

  try {
    if (afterStaleLockQuarantined) {
      await afterStaleLockQuarantined({ lockPath, quarantinePath, reclaimPath });
    }
  } catch (error) {
    await restoreQuarantinedLock(quarantinePath, lockPath).catch(() => {});
    await rm(reclaimPath, { force: true }).catch(() => {});
    throw error;
  }
  await rm(quarantinePath, { force: true });
  await rm(reclaimPath, { force: true });
  return true;
}

export async function withWorkspaceMutationLock(
  workspaceRoot,
  callback,
  {
    openFile = open,
    afterStaleLockObserved = null,
    afterStaleLockQuarantined = null,
  } = {},
) {
  const configDirectory = getConfigDirectory(workspaceRoot);
  const lockPath = join(configDirectory, "mutation.lock");
  const reclaimPath = join(configDirectory, "mutation.lock.reclaim");
  if (!(await isPathPhysicallyInside(workspaceRoot, lockPath))
    || !(await isPathPhysicallyInside(workspaceRoot, reclaimPath))) {
    throw new SddError(`Mutation lock path resolves outside its owner root: ${lockPath}`, {
      code: "UNSAFE_CONFIG_PATH",
    });
  }
  await mkdir(configDirectory, { recursive: true });
  let handle;
  let openedState;
  const token = randomUUID();
  const lockSource = `${JSON.stringify({
    pid: process.pid,
    token,
    createdAt: new Date().toISOString(),
  })}\n`;

  for (let attempt = 0; attempt < 4 && !handle; attempt += 1) {
    if (await lstat(reclaimPath).then(() => true, (error) => {
      if (error?.code === "ENOENT") return false;
      throw error;
    })) {
      throw operationInProgressError(lockPath, null, [
        `Stale-lock reclamation requires inspection: ${reclaimPath}`,
      ]);
    }
    try {
      handle = await openFile(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(lockSource);
        await handle.sync();
        openedState = await handle.stat();
      } catch (error) {
        const opened = await handle.stat().catch(() => null);
        await handle.close().catch(() => {});
        handle = null;
        if (opened) await removeObservedLock(lockPath, { state: opened }, "lock-write-failed").catch(() => {});
        throw error;
      }
      if (await lstat(reclaimPath).then(() => true, (error) => {
        if (error?.code === "ENOENT") return false;
        throw error;
      })) {
        await handle.close().catch(() => {});
        handle = null;
        await removeObservedLock(lockPath, { state: openedState, source: lockSource }, "lock-reclaim-race");
        throw operationInProgressError(lockPath, null, [
          `Stale-lock reclamation won the acquisition race: ${reclaimPath}`,
        ]);
      }
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const observed = await observeLock(lockPath);
      if (!observed) continue;
      const owner = parseLockOwner(observed.source);
      if (isLockOwnerAlive(owner)) throw operationInProgressError(lockPath, owner);
      if (afterStaleLockObserved) await afterStaleLockObserved({ lockPath, owner });
      if (await reclaimStaleLock(
        lockPath,
        reclaimPath,
        observed,
        owner,
        afterStaleLockQuarantined,
      )) {
        continue;
      }
    }
  }

  if (!handle) {
    throw operationInProgressError(lockPath, null, [
      "The lock changed repeatedly while stale-lock recovery was attempted.",
    ]);
  }

  try {
    return await callback();
  } finally {
    await handle.close().catch(() => {});
    await removeObservedLock(
      lockPath,
      { state: openedState, source: lockSource },
      "lock-release",
    ).catch(() => {});
  }
}
