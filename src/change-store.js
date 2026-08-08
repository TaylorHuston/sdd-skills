import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

import { assertValidChangeId } from "./change-id.js";
import { getUserRoot } from "./config.js";
import {
  CHANGES_DIRECTORY_NAME,
  CLOSED_CHANGES_DIRECTORY_NAME,
  CONFIG_DIRECTORY_NAME,
} from "./constants.js";
import { SddError } from "./errors.js";
import { isDirectory, isPathPhysicallyInside } from "./fs.js";

function normalizePath(value) {
  return value.split("\\").join("/") || ".";
}

export function getChangesRoot(userRoot = getUserRoot()) {
  return join(userRoot, CONFIG_DIRECTORY_NAME, CHANGES_DIRECTORY_NAME);
}

export function getClosedChangesRoot(userRoot = getUserRoot()) {
  return join(getChangesRoot(userRoot), CLOSED_CHANGES_DIRECTORY_NAME);
}

export function getActiveChangePath(changeId, userRoot = getUserRoot()) {
  assertValidChangeId(changeId);
  return join(getChangesRoot(userRoot), changeId);
}

export function getClosedChangePath(changeId, userRoot = getUserRoot()) {
  assertValidChangeId(changeId);
  return join(getClosedChangesRoot(userRoot), changeId);
}

export function relativeChangeStorePath(path, userRoot = getUserRoot()) {
  return normalizePath(relative(userRoot, path));
}

export async function assertChangeStoreConfinement(path, userRoot = getUserRoot()) {
  const changesRoot = getChangesRoot(userRoot);
  const configRoot = join(userRoot, CONFIG_DIRECTORY_NAME);
  if (!(await isPathPhysicallyInside(userRoot, configRoot))
    || !(await isPathPhysicallyInside(configRoot, changesRoot))
    || !(await isPathPhysicallyInside(changesRoot, path))) {
    throw new SddError(`Change store path resolves outside the user store: ${path}`, {
      code: "UNSAFE_ARTIFACT_PATH",
    });
  }
  return path;
}

async function listDirectories(root) {
  if (!(await isDirectory(root))) return [];
  return (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export async function listStoredChanges(userRoot = getUserRoot()) {
  const changesRoot = getChangesRoot(userRoot);
  const closedRoot = getClosedChangesRoot(userRoot);
  await assertChangeStoreConfinement(changesRoot, userRoot);
  await assertChangeStoreConfinement(closedRoot, userRoot);

  const activeIds = (await listDirectories(changesRoot))
    .filter((changeId) => changeId !== CLOSED_CHANGES_DIRECTORY_NAME);
  const closedIds = await listDirectories(closedRoot);
  return [
    ...activeIds.map((changeId) => ({
      changeId,
      path: join(changesRoot, changeId),
      closed: false,
    })),
    ...closedIds.map((changeId) => ({
      changeId,
      path: join(closedRoot, changeId),
      closed: true,
    })),
  ].sort((left, right) => left.changeId.localeCompare(right.changeId)
    || Number(left.closed) - Number(right.closed));
}
