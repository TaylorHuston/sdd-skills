import { createHash, randomUUID } from "node:crypto";
import {
  access,
  chmod,
  cp,
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
  stat,
  writeFile,
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

export async function writeFileAtomically(path, source) {
  const parent = dirname(path);
  const temporary = join(parent, `.${basename(path)}.sdd-write-${process.pid}-${randomUUID()}`);
  await mkdir(parent, { recursive: true });
  const existingMode = await stat(path).then((value) => value.mode & 0o777).catch((error) => {
    if (error?.code === "ENOENT") return 0o600;
    throw error;
  });
  let handle;
  try {
    handle = await open(temporary, "wx", existingMode);
    await handle.writeFile(source, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, path);
    let directoryHandle;
    try {
      directoryHandle = await open(parent, "r");
      await directoryHandle.sync();
    } catch {
      // Directory fsync is not supported consistently across all Node platforms.
    } finally {
      await directoryHandle?.close().catch(() => {});
    }
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function collectDirectoryEntries(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  const collected = [];
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    const relativePath = relative(root, absolutePath).split(sep).join("/");
    if (entry.isDirectory()) {
      collected.push({ type: "directory", relativePath, absolutePath });
      collected.push(...(await collectDirectoryEntries(root, absolutePath)));
    } else if (entry.isFile()) {
      collected.push({ type: "file", relativePath, absolutePath });
    } else if (entry.isSymbolicLink()) {
      collected.push({ type: "symlink", relativePath, absolutePath });
    }
  }
  return collected;
}

export async function hashDirectory(root) {
  const hash = createHash("sha256");
  for (const entry of await collectDirectoryEntries(root)) {
    hash.update(`${entry.type}\0${entry.relativePath}\0`);
    if (entry.type === "file") {
      hash.update(await readFile(entry.absolutePath));
    } else if (entry.type === "symlink") {
      hash.update(await readlink(entry.absolutePath));
    }
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

export async function hashFile(path) {
  return `sha256:${createHash("sha256").update(await readFile(path)).digest("hex")}`;
}

export async function replaceFileAtomically(
  source,
  target,
  { expectedHash, beforePublish = null } = {},
) {
  const parent = dirname(target);
  const name = basename(target);
  const nonce = `${process.pid}-${Date.now()}`;
  const temporary = join(parent, `.${name}.sdd-new-${nonce}`);
  const backup = join(parent, `.${name}.sdd-old-${nonce}`);
  const targetExists = await pathExists(target);

  await mkdir(parent, { recursive: true });
  try {
    await cp(source, temporary);
    if (targetExists) {
      await rename(target, backup);
      if (expectedHash !== undefined && await hashFile(backup) !== expectedHash) {
        throw new SddError(`File changed immediately before replacement: ${target}`, {
          code: "CONCURRENT_CHANGE",
        });
      }
    } else if (expectedHash !== undefined && expectedHash !== null) {
      throw new SddError(`File disappeared immediately before replacement: ${target}`, {
        code: "CONCURRENT_CHANGE",
      });
    }
    if (beforePublish) await beforePublish({ temporary, target, backup });
    await link(temporary, target);
    await rm(temporary, { force: true });
  } catch (error) {
    const recoveryFailures = [];
    if (targetExists && (await pathExists(backup)) && !(await pathExists(target))) {
      try {
        await rename(backup, target);
      } catch (recoveryError) {
        recoveryFailures.push(`Restore ${target}: ${recoveryError.message}`);
      }
    } else if (targetExists && (await pathExists(backup)) && await pathExists(target)) {
      recoveryFailures.push(`Newer target preserved; original retained at ${backup}.`);
    }
    try {
      await rm(temporary, { force: true });
    } catch (recoveryError) {
      recoveryFailures.push(`Remove ${temporary}: ${recoveryError.message}`);
    }
    if (recoveryFailures.length > 0) {
      throw new SddError("File replacement failed and recovery was incomplete.", {
        code: "MUTATION_RECOVERY_FAILED",
        details: [`Original error: ${error.message}`, ...recoveryFailures],
      });
    }
    throw error;
  }

  if (targetExists) {
    try {
      await rm(backup, { force: true });
    } catch (error) {
      throw new SddError("File replacement succeeded but backup cleanup failed.", {
        code: "MUTATION_RECOVERY_FAILED",
        details: [`Retained backup: ${backup}`, error.message],
      });
    }
  }
}

export async function replaceDirectoryAtomically(
  source,
  target,
  { expectedHash, beforePublish = null } = {},
) {
  const parent = dirname(target);
  const name = basename(target);
  const nonce = `${process.pid}-${Date.now()}`;
  const temporary = join(parent, `.${name}.sdd-new-${nonce}`);
  const backup = join(parent, `.${name}.sdd-old-${nonce}`);
  const targetExists = await pathExists(target);
  let reservedTarget = false;

  await mkdir(parent, { recursive: true });
  try {
    await cp(source, temporary, { recursive: true, verbatimSymlinks: true });
    if (targetExists) {
      await rename(target, backup);
      if (expectedHash !== undefined && await hashDirectory(backup) !== expectedHash) {
        throw new SddError(`Directory changed immediately before replacement: ${target}`, {
          code: "CONCURRENT_CHANGE",
        });
      }
    } else if (expectedHash !== undefined && expectedHash !== null) {
      throw new SddError(`Directory disappeared immediately before replacement: ${target}`, {
        code: "CONCURRENT_CHANGE",
      });
    }
    if (beforePublish) await beforePublish({ temporary, target, backup });
    await mkdir(target);
    reservedTarget = true;
    await chmod(target, (await stat(temporary)).mode & 0o777);
    for (const entry of await readdir(temporary)) {
      await rename(join(temporary, entry), join(target, entry));
    }
    await rm(temporary, { recursive: true, force: true });
    reservedTarget = false;
  } catch (error) {
    const recoveryFailures = [];
    if (targetExists && (await pathExists(backup)) && !(await pathExists(target))) {
      try {
        await rename(backup, target);
      } catch (recoveryError) {
        recoveryFailures.push(`Restore ${target}: ${recoveryError.message}`);
      }
    } else if (targetExists && (await pathExists(backup)) && await pathExists(target)) {
      recoveryFailures.push(`Newer target preserved; original retained at ${backup}.`);
    }
    try {
      await rm(temporary, { recursive: true, force: true });
    } catch (recoveryError) {
      recoveryFailures.push(`Remove ${temporary}: ${recoveryError.message}`);
    }
    if (reservedTarget) {
      recoveryFailures.push(`Partially published target preserved for inspection: ${target}.`);
    }
    if (recoveryFailures.length > 0) {
      throw new SddError("Directory replacement failed and recovery was incomplete.", {
        code: "MUTATION_RECOVERY_FAILED",
        details: [`Original error: ${error.message}`, ...recoveryFailures],
      });
    }
    throw error;
  }

  if (targetExists) {
    try {
      await rm(backup, { recursive: true, force: true });
    } catch (error) {
      throw new SddError("Directory replacement succeeded but backup cleanup failed.", {
        code: "MUTATION_RECOVERY_FAILED",
        details: [`Retained backup: ${backup}`, error.message],
      });
    }
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
