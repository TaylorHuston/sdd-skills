import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  stat,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { SddError } from "./errors.js";

export const DIRECTORY_HASH_SCHEME = "sha256-directory-v2";

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

function identity(state) {
  return { dev: String(state.dev), ino: String(state.ino) };
}

function mode(state) {
  return Number(state.mode & 0o777n);
}

function sameIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino;
}

function sameObservation(left, right) {
  return sameIdentity(identity(left), identity(right))
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function unsafe(path, label, code, reason, error = null) {
  return new SddError(`${label} ${reason}: ${path}`, {
    code,
    details: error ? [error.message] : [],
  });
}

function changed(path, label, error = null) {
  return unsafe(path, label, "CONCURRENT_CHANGE", "changed while it was being read", error);
}

async function observeDirectory(path, label, target, { allowSymlink = false } = {}) {
  let lexical;
  let followed;
  let after;
  try {
    lexical = await lstat(path, { bigint: true });
    followed = await stat(path, { bigint: true });
    after = await lstat(path, { bigint: true });
  } catch (error) {
    throw unsafe(target, label, "CONCURRENT_CHANGE", `has an unsafe ancestor ${path}`, error);
  }
  if (
    !followed.isDirectory()
    || (!lexical.isDirectory() && !(allowSymlink && lexical.isSymbolicLink()))
    || lexical.isSymbolicLink() !== after.isSymbolicLink()
    || !sameIdentity(identity(lexical), identity(after))
  ) {
    throw unsafe(target, label, "CONCURRENT_CHANGE", `has an unsafe ancestor ${path}`);
  }
  return {
    path,
    lexicalType: lexical.isSymbolicLink() ? "symlink" : "directory",
    lexicalIdentity: identity(after),
    followedIdentity: identity(followed),
  };
}

function sameDirectoryObservation(left, right) {
  return left?.path === right?.path
    && left?.lexicalType === right?.lexicalType
    && sameIdentity(left?.lexicalIdentity, right?.lexicalIdentity)
    && sameIdentity(left?.followedIdentity, right?.followedIdentity);
}

async function captureOwnerBinding(ownerRoot, path, label, code) {
  if (ownerRoot === null) return null;
  const owner = resolve(ownerRoot);
  const target = resolve(path);
  if (!isPathInside(owner, target)) {
    throw unsafe(target, label, code, `is outside owner root ${owner}`);
  }
  let ownerObservation;
  try {
    ownerObservation = await observeDirectory(owner, label, target, { allowSymlink: true });
  } catch (error) {
    throw unsafe(target, label, code, "has an unsafe owner root", error);
  }
  const ancestors = [];
  let candidate = dirname(target);
  const reversed = [];
  while (candidate !== owner && isPathInside(owner, candidate)) {
    reversed.push(candidate);
    candidate = dirname(candidate);
  }
  for (const ancestor of reversed.reverse()) {
    try {
      const state = await lstat(ancestor);
      if (state.isSymbolicLink() || !state.isDirectory()) {
        throw unsafe(target, label, code, `has an unsafe owner-local ancestor ${ancestor}`);
      }
      ancestors.push(await observeDirectory(ancestor, label, target));
    } catch (error) {
      if (error?.code === "ENOENT") break;
      throw error;
    }
  }
  return { path: owner, binding: ownerObservation, ancestors };
}

async function assertOwnerBindingCurrent(binding, path, label) {
  if (binding === null) return;
  const current = await captureOwnerBinding(binding.path, path, label, "CONCURRENT_CHANGE");
  if (!sameBoundFileOwner(binding, current)) throw changed(path, label);
  if (!(await isPathPhysicallyInside(binding.path, path))) throw changed(path, label);
}

export function sameBoundFileOwner(left, right) {
  if (left === null || right === null) return left === right;
  const leftBinding = left.binding ?? left;
  const rightBinding = right.binding ?? right;
  return sameDirectoryObservation(leftBinding, rightBinding)
    && Array.isArray(left.ancestors)
    && Array.isArray(right.ancestors)
    && left.ancestors.length === right.ancestors.length
    && left.ancestors.every((entry, index) =>
      sameDirectoryObservation(entry, right.ancestors[index]));
}

async function assertMissing(path, label) {
  try {
    await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw changed(path, label, error);
  }
  throw changed(path, label);
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
  path = resolve(path);
  ownerRoot = ownerRoot === null ? null : resolve(ownerRoot);
  const ownerBinding = await captureOwnerBinding(ownerRoot, path, label, unsafeCode);
  if (expectedOwnerBinding !== undefined
    && !sameBoundFileOwner(ownerBinding, expectedOwnerBinding)) {
    throw changed(path, label);
  }

  let before;
  try {
    before = await lstat(path, { bigint: true });
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") {
      await assertOwnerBindingCurrent(ownerBinding, path, label);
      await assertMissing(path, label);
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
      throw unsafe(path, label, unsafeCode, "has an unsafe owner-local path", error);
    }
    throw error;
  }
  if (before.isSymbolicLink() || !before.isFile()) {
    throw unsafe(path, label, unsafeCode, "is not a confined regular file");
  }
  await assertOwnerBindingCurrent(ownerBinding, path, label);
  let physicalPath;
  let physicalOwner = null;
  try {
    [physicalPath, physicalOwner] = await Promise.all([
      realpath(path),
      ownerRoot === null ? null : realpath(ownerRoot),
    ]);
  } catch (error) {
    throw changed(path, label, error);
  }
  if (physicalOwner !== null && !isPathInside(physicalOwner, physicalPath)) {
    throw unsafe(path, label, unsafeCode, "resolves outside its owner root");
  }

  let handle;
  try {
    handle = await open(
      physicalPath,
      fsConstants.O_RDONLY
        | (fsConstants.O_NOFOLLOW ?? 0)
        | (fsConstants.O_NONBLOCK ?? 0),
    );
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameObservation(before, opened)) throw changed(path, label);
    const bytes = await handle.readFile();
    const afterReadState = await handle.stat({ bigint: true });
    if (!sameObservation(opened, afterReadState)) throw changed(path, label);
    const result = {
      bytes,
      source: bytes.toString("utf8"),
      identity: identity(afterReadState),
      mode: mode(afterReadState),
      ownerBinding,
    };
    await afterRead?.({ path, physicalPath, ...result });
    await assertOwnerBindingCurrent(ownerBinding, path, label);
    const current = await lstat(path, { bigint: true });
    if (current.isSymbolicLink() || !current.isFile() || !sameObservation(afterReadState, current)) {
      throw changed(path, label);
    }
    return result;
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "ELOOP"].includes(error?.code)) throw changed(path, label, error);
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

function updateHash(hash, length, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(length);
  hash.update(bytes);
}

function directoryManifestHash(manifest) {
  const hash = createHash("sha256");
  const length = Buffer.allocUnsafe(8);
  const add = (type, relativePath, entryMode, payload = Buffer.alloc(0)) => {
    updateHash(hash, length, type);
    updateHash(hash, length, relativePath);
    updateHash(hash, length, entryMode.toString(8).padStart(4, "0"));
    updateHash(hash, length, payload);
  };
  updateHash(hash, length, DIRECTORY_HASH_SCHEME);
  add("directory", "", manifest.root.mode);
  for (const entry of manifest.entries) {
    add(
      entry.type,
      entry.relativePath,
      entry.mode,
      entry.type === "file"
        ? entry.bytes
        : entry.type === "symlink"
          ? entry.linkTarget
          : Buffer.alloc(0),
    );
  }
  return `${DIRECTORY_HASH_SCHEME}:${hash.digest("hex")}`;
}

async function captureFile(path, label) {
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()) throw changed(path, label);
  let handle;
  try {
    handle = await open(
      path,
      fsConstants.O_RDONLY
        | (fsConstants.O_NOFOLLOW ?? 0)
        | (fsConstants.O_NONBLOCK ?? 0),
    );
    const opened = await handle.stat({ bigint: true });
    if (!sameObservation(before, opened)) throw changed(path, label);
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (!sameObservation(opened, after)) throw changed(path, label);
    return { type: "file", identity: identity(after), mode: mode(after), bytes };
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function captureDirectory(path, label) {
  const rootState = await lstat(path, { bigint: true });
  if (!rootState.isDirectory() || rootState.isSymbolicLink()) throw changed(path, label);
  const entries = [];
  async function collect(directory, prefix, expectedIdentity, expectedMode) {
    const beforeNames = (await readdir(directory)).sort();
    for (const name of beforeNames) {
      const absolute = join(directory, name);
      const relativePath = prefix ? `${prefix}/${name}` : name;
      const entryState = await lstat(absolute, { bigint: true });
      if (entryState.isDirectory() && !entryState.isSymbolicLink()) {
        const entry = {
          type: "directory",
          relativePath,
          identity: identity(entryState),
          mode: mode(entryState),
        };
        entries.push(entry);
        await collect(absolute, relativePath, entry.identity, entry.mode);
      } else if (entryState.isFile() && !entryState.isSymbolicLink()) {
        const file = await captureFile(absolute, label);
        if (!sameIdentity(identity(entryState), file.identity)) throw changed(absolute, label);
        entries.push({ ...file, relativePath });
      } else if (entryState.isSymbolicLink()) {
        const linkTarget = await readlink(absolute, { encoding: "buffer" });
        const after = await lstat(absolute, { bigint: true });
        if (!after.isSymbolicLink() || !sameIdentity(identity(entryState), identity(after))) {
          throw changed(absolute, label);
        }
        entries.push({
          type: "symlink",
          relativePath,
          identity: identity(after),
          mode: mode(after),
          linkTarget,
        });
      } else {
        throw unsafe(absolute, label, "UNSAFE_SKILL_DIRECTORY", "has unsupported content");
      }
    }
    const [afterNames, afterState] = await Promise.all([
      readdir(directory),
      lstat(directory, { bigint: true }),
    ]);
    afterNames.sort();
    if (
      !afterState.isDirectory()
      || afterState.isSymbolicLink()
      || !sameIdentity(identity(afterState), expectedIdentity)
      || mode(afterState) !== expectedMode
      || beforeNames.length !== afterNames.length
      || beforeNames.some((name, index) => name !== afterNames[index])
    ) {
      throw changed(directory, label);
    }
  }
  const rootIdentity = identity(rootState);
  const rootMode = mode(rootState);
  await collect(path, "", rootIdentity, rootMode);
  const manifest = {
    root: { type: "directory", identity: rootIdentity, mode: rootMode },
    entries,
  };
  manifest.hash = directoryManifestHash(manifest);
  return manifest;
}

export async function readBoundDirectory(
  path,
  {
    ownerRoot,
    allowMissing = false,
    returnMissingBinding = false,
    label = "Directory",
    unsafeCode = "UNSAFE_DIRECTORY_PATH",
    expectedBinding = undefined,
  } = {},
) {
  path = resolve(path);
  const binding = await captureOwnerBinding(resolve(ownerRoot), path, label, unsafeCode);
  if (expectedBinding !== undefined && !sameBoundFileOwner(binding, expectedBinding)) {
    throw changed(path, label);
  }
  let manifest;
  try {
    manifest = await captureDirectory(path, label);
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") {
      await assertOwnerBindingCurrent(binding, path, label);
      await assertMissing(path, label);
      return returnMissingBinding ? { missing: true, binding } : null;
    }
    if (error?.code === "CONCURRENT_CHANGE") throw error;
    if (["ENOTDIR", "ELOOP"].includes(error?.code)) {
      throw unsafe(path, label, unsafeCode, "has an unsafe owner-local path", error);
    }
    throw error;
  }
  await assertOwnerBindingCurrent(binding, path, label);
  if (!(await isPathPhysicallyInside(ownerRoot, path))) {
    throw unsafe(path, label, unsafeCode, "resolves outside its owner root");
  }
  return { ...manifest, binding };
}

export async function hashDirectory(path) {
  const manifest = await captureDirectory(resolve(path), "Directory hash");
  return manifest.hash;
}

export async function matchesDirectoryHash(path, expectedHash) {
  return (await hashDirectory(path)) === expectedHash;
}

export async function hashFile(path) {
  const hash = createHash("sha256");
  hash.update(await readFile(path));
  return `sha256:${hash.digest("hex")}`;
}

export function isPathInside(parent, child) {
  const relation = relative(resolve(parent), resolve(child));
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== "..");
}

export async function resolvePhysicalPath(path) {
  const absolutePath = resolve(path);
  const missing = [];
  let candidate = absolutePath;
  while (true) {
    try {
      await lstat(candidate);
      return resolve(await realpath(candidate), ...missing.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw error;
      missing.push(basename(candidate));
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
    const state = await lstat(path);
    return state.isDirectory() && !state.isSymbolicLink();
  } catch {
    return false;
  }
}
