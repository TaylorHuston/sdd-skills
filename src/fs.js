import { createHash } from "node:crypto";
import {
  access,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

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
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

export async function replaceDirectoryAtomically(source, target) {
  const parent = dirname(target);
  const name = basename(target);
  const nonce = `${process.pid}-${Date.now()}`;
  const temporary = join(parent, `.${name}.sdd-new-${nonce}`);
  const backup = join(parent, `.${name}.sdd-old-${nonce}`);
  const targetExists = await pathExists(target);

  await mkdir(parent, { recursive: true });
  try {
    await cp(source, temporary, { recursive: true, verbatimSymlinks: true });
    if (targetExists) {
      await rename(target, backup);
    }
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    if (targetExists && (await pathExists(backup)) && !(await pathExists(target))) {
      await rename(backup, target);
    }
    throw error;
  }

  if (targetExists) {
    // The replacement has succeeded; stale backup cleanup must not turn it into a false failure.
    await rm(backup, { recursive: true, force: true }).catch(() => {});
  }
}

export function isPathInside(parent, child) {
  const relation = relative(resolve(parent), resolve(child));
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== "..");
}

export async function isDirectory(path) {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}
