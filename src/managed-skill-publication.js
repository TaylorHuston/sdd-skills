import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  rename,
  rm,
  symlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { SddError } from "./errors.js";
import {
  isPathInside,
  isPathPhysicallyInside,
  readBoundDirectory,
} from "./fs.js";

function identity(state) {
  return { dev: String(state.dev), ino: String(state.ino) };
}

function sameIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino;
}

function retainedFailure(message, error, retainedPaths, { completed = false } = {}) {
  const failure = new SddError(message, {
    code: "MUTATION_RECOVERY_FAILED",
    details: [
      `Original error: ${error.message}`,
      ...(error?.details ?? []).map((detail) => `Original detail: ${detail}`),
      ...[...new Set(retainedPaths)].map((path) => `Retained path requiring inspection: ${path}`),
    ],
  });
  failure.cause = error;
  failure.retainedPaths = [...new Set(retainedPaths)];
  failure.completed = completed;
  return failure;
}

async function readDirectoryIdentity(path, label) {
  let state;
  try {
    state = await lstat(path, { bigint: true });
  } catch (error) {
    throw new SddError(`${label} is unavailable: ${path}`, {
      code: "UNSAFE_SKILL_DIRECTORY",
      details: [error.message],
    });
  }
  if (!state.isDirectory() || state.isSymbolicLink()) {
    throw new SddError(`${label} must be a real directory: ${path}`, {
      code: "UNSAFE_SKILL_DIRECTORY",
    });
  }
  return identity(state);
}

export async function ensureManagedSkillRegistry(
  workspaceRoot,
  skillsDirectory,
  {
    assertOwnerCurrent = null,
    beforeMutation = null,
  } = {},
) {
  if (!isPathInside(workspaceRoot, skillsDirectory)) {
    throw new SddError(`Managed skills directory is outside its workspace: ${skillsDirectory}`, {
      code: "UNSAFE_SKILL_DIRECTORY",
    });
  }
  await assertOwnerCurrent?.();
  await beforeMutation?.({ phase: "registry", path: skillsDirectory });
  await assertOwnerCurrent?.();
  if (!(await isPathPhysicallyInside(workspaceRoot, skillsDirectory))) {
    throw new SddError(`Managed skills directory resolves outside its workspace: ${skillsDirectory}`, {
      code: "UNSAFE_SKILL_DIRECTORY",
    });
  }
  await mkdir(skillsDirectory, { recursive: true, mode: 0o755 });
  await assertOwnerCurrent?.();
  if (!(await isPathPhysicallyInside(workspaceRoot, skillsDirectory))) {
    throw new SddError(`Managed skills directory resolves outside its workspace: ${skillsDirectory}`, {
      code: "UNSAFE_SKILL_DIRECTORY",
    });
  }
  const registryIdentity = await readDirectoryIdentity(
    skillsDirectory,
    "Managed skills directory",
  );
  return async () => {
    await assertOwnerCurrent?.();
    if (!(await isPathPhysicallyInside(workspaceRoot, skillsDirectory))) {
      throw new SddError(
        `Managed skills directory resolves outside its workspace: ${skillsDirectory}`,
        { code: "UNSAFE_SKILL_DIRECTORY" },
      );
    }
    const current = await readDirectoryIdentity(skillsDirectory, "Managed skills directory");
    if (!sameIdentity(current, registryIdentity)) {
      throw new SddError(`Managed skills directory changed during refresh: ${skillsDirectory}`, {
        code: "CONCURRENT_CHANGE",
      });
    }
    await assertOwnerCurrent?.();
  };
}

async function mutate(context, operation, assertRegistry, beforeMutation) {
  await assertRegistry();
  await beforeMutation?.(context);
  await assertRegistry();
  const result = await operation();
  await assertRegistry();
  return result;
}

async function copySkillTree(
  source,
  target,
  sourceManifest,
  {
    assertRegistry,
    beforeMutation,
  },
) {
  await mutate(
    { phase: "publish-root", path: target },
    () => mkdir(target, { mode: sourceManifest.root.mode | 0o700 }),
    assertRegistry,
    beforeMutation,
  );
  const directoryModes = [{ path: target, mode: sourceManifest.root.mode }];
  const targetIdentity = await readDirectoryIdentity(target, "Managed skill target");
  const assertTarget = async () => {
    await assertRegistry();
    const current = await readDirectoryIdentity(target, "Managed skill target");
    if (!sameIdentity(current, targetIdentity)) {
      throw new SddError(`Managed skill target changed during publication: ${target}`, {
        code: "CONCURRENT_CHANGE",
      });
    }
  };

  for (const entry of sourceManifest.entries) {
    const sourcePath = join(source, ...entry.relativePath.split("/"));
    const targetPath = join(target, ...entry.relativePath.split("/"));
    await assertTarget();
    if (entry.type === "directory") {
      await mutate(
        { phase: "publish-directory", path: targetPath, relativePath: entry.relativePath },
        () => mkdir(targetPath, { mode: entry.mode | 0o700 }),
        assertTarget,
        beforeMutation,
      );
      directoryModes.push({ path: targetPath, mode: entry.mode });
    } else if (entry.type === "file") {
      await mutate(
        { phase: "publish-file", path: targetPath, relativePath: entry.relativePath },
        () => copyFile(sourcePath, targetPath, fsConstants.COPYFILE_EXCL),
        assertTarget,
        beforeMutation,
      );
      await chmod(targetPath, entry.mode);
    } else if (entry.type === "symlink") {
      await mutate(
        { phase: "publish-symlink", path: targetPath, relativePath: entry.relativePath },
        () => symlink(entry.linkTarget.toString("utf8"), targetPath),
        assertTarget,
        beforeMutation,
      );
    } else {
      throw new SddError(`Managed skill source has unsupported content: ${sourcePath}`, {
        code: "UNSAFE_SKILL_DIRECTORY",
      });
    }
  }
  for (const directory of directoryModes.reverse()) {
    await assertTarget();
    await chmod(directory.path, directory.mode);
  }
  await assertTarget();
}

export async function publishManagedSkill(
  workspaceRoot,
  entry,
  {
    assertRegistry,
    assertOwnerCurrent = null,
    beforeMutation = null,
  },
) {
  await assertOwnerCurrent?.();
  const current = await readBoundDirectory(entry.target, {
    ownerRoot: workspaceRoot,
    allowMissing: true,
    returnMissingBinding: true,
    label: `Managed skill ${entry.skillName}`,
    unsafeCode: "UNSAFE_SKILL_DIRECTORY",
  });
  const currentHash = current.missing === true ? null : current.hash;
  if (currentHash !== entry.targetHash) {
    throw new SddError(`Managed skill changed after update planning: ${entry.skillName}`, {
      code: "SKILL_CONFLICT",
    });
  }

  const nonce = `${process.pid}-${randomUUID()}`;
  const preserved = join(dirname(entry.target), `.${entry.skillName}.sdd-preserved-${nonce}`);
  const retainedPaths = [];
  let displaced = false;
  let published = false;

  try {
    if (current.missing !== true) {
      await mutate(
        { phase: "preserve-target", path: entry.target, target: preserved, skillName: entry.skillName },
        () => rename(entry.target, preserved),
        assertRegistry,
        beforeMutation,
      );
      displaced = true;
      retainedPaths.push(preserved);
      const preservedSnapshot = await readBoundDirectory(preserved, {
        ownerRoot: workspaceRoot,
        label: `Preserved managed skill ${entry.skillName}`,
        unsafeCode: "UNSAFE_SKILL_DIRECTORY",
      });
      if (preservedSnapshot.hash !== entry.targetHash) {
        throw new SddError(`Managed skill changed while it was being preserved: ${entry.skillName}`, {
          code: "CONCURRENT_CHANGE",
        });
      }
    }

    if (entry.source !== null) {
      const sourceManifest = await readBoundDirectory(entry.source, {
        ownerRoot: dirname(entry.source),
        label: `Packaged skill ${entry.skillName}`,
        unsafeCode: "UNSAFE_SKILL_DIRECTORY",
      });
      if (sourceManifest.hash !== entry.sourceHash) {
        throw new SddError(`Packaged skill changed during refresh: ${entry.skillName}`, {
          code: "CONCURRENT_CHANGE",
        });
      }
      await copySkillTree(entry.source, entry.target, sourceManifest, {
        assertRegistry,
        beforeMutation,
      });
      const publishedSnapshot = await readBoundDirectory(entry.target, {
        ownerRoot: workspaceRoot,
        label: `Published managed skill ${entry.skillName}`,
        unsafeCode: "UNSAFE_SKILL_DIRECTORY",
      });
      if (publishedSnapshot.hash !== entry.sourceHash) {
        throw new SddError(`Managed skill publication is incomplete: ${entry.skillName}`, {
          code: "CONCURRENT_CHANGE",
        });
      }
      published = true;
    } else {
      published = true;
    }

    if (displaced) {
      await mutate(
        { phase: "cleanup-preserved", path: preserved, skillName: entry.skillName },
        () => rm(preserved, { recursive: true }),
        assertRegistry,
        beforeMutation,
      );
      retainedPaths.length = 0;
    }
    return {
      skillName: entry.skillName,
      action: entry.action,
      hash: entry.sourceHash,
      retainedPaths: [],
    };
  } catch (error) {
    if (published) retainedPaths.push(entry.target);
    else if (entry.source !== null) {
      try {
        await lstat(entry.target);
        retainedPaths.push(entry.target);
      } catch {
        // No partial target was created.
      }
    }
    throw retainedFailure(
      `Managed skill ${entry.skillName} could not complete; preserved state requires inspection.`,
      error,
      retainedPaths,
      { completed: published },
    );
  }
}
