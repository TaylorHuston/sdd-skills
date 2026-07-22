import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { getConfigDirectory } from "./config.js";
import { SddError } from "./errors.js";
import { isPathPhysicallyInside } from "./fs.js";

export async function withWorkspaceMutationLock(
  workspaceRoot,
  callback,
  { openFile = open } = {},
) {
  const configDirectory = getConfigDirectory(workspaceRoot);
  const lockPath = join(configDirectory, "mutation.lock");
  if (!(await isPathPhysicallyInside(workspaceRoot, lockPath))) {
    throw new SddError(`Mutation lock path resolves outside its owner root: ${lockPath}`, {
      code: "UNSAFE_CONFIG_PATH",
    });
  }
  await mkdir(configDirectory, { recursive: true });
  let handle;
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      handle = await openFile(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify({
          pid: process.pid,
          token,
          createdAt: new Date().toISOString(),
        })}\n`);
        await handle.sync();
      } catch (error) {
        const [opened, current] = await Promise.all([
          handle.stat().catch(() => null),
          lstat(lockPath).catch(() => null),
        ]);
        await handle.close().catch(() => {});
        handle = null;
        if (opened && current && opened.dev === current.dev && opened.ino === current.ino) {
          await rm(lockPath, { force: true }).catch(() => {});
        }
        throw error;
      }
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const source = await readFile(lockPath, "utf8").catch(() => "");
      let owner = null;
      try {
        owner = JSON.parse(source);
      } catch {
        // Legacy or manually created locks remain conservative and require manual inspection.
      }
      let ownerAlive = true;
      if (Number.isInteger(owner?.pid) && owner.pid > 0) {
        try {
          process.kill(owner.pid, 0);
        } catch (killError) {
          ownerAlive = killError?.code !== "ESRCH";
        }
      }
      if (!ownerAlive && attempt === 0 && await readFile(lockPath, "utf8").catch(() => null) === source) {
        await rm(lockPath, { force: true });
        continue;
      }
      throw new SddError(`Another SDD mutation is already in progress: ${lockPath}`, {
        code: "OPERATION_IN_PROGRESS",
        details: [
          `Lock: ${lockPath}`,
          Number.isInteger(owner?.pid) ? `Owner PID: ${owner.pid}` : "Owner PID: unknown",
          owner?.createdAt ? `Created: ${owner.createdAt}` : "Created: unknown",
          "If the PID has been reused or ownership is uncertain, inspect and remove the lock manually only after confirming no SDD mutation is active.",
        ],
      });
    }
  }

  try {
    return await callback();
  } finally {
    await handle.close().catch(() => {});
    const current = await readFile(lockPath, "utf8").catch(() => null);
    let currentToken = null;
    try {
      currentToken = JSON.parse(current)?.token ?? null;
    } catch {
      // A replaced lock belongs to another writer and must be preserved.
    }
    if (currentToken === token) await rm(lockPath, { force: true });
  }
}
