import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  assertValidConfig,
  relativeWorkspacePath,
  resolveWorkspacePath,
  resolveWorkspaceStatus,
} from "../config.js";
import {
  assertOperationConfigurationCurrent,
  resolveOperationConfiguration,
} from "../workspace.js";
import {
  assertSelectedRepositorySnapshotsCurrent,
  selectRepositoryTargetsForCreate,
} from "../change-repositories.js";
import { PACKAGE_ROOT } from "../constants.js";
import { SddError } from "../errors.js";
import { isPathInside, pathExists, resolvePhysicalPath } from "../fs.js";
import { validateArtifacts } from "./validate.js";

const EPIC_TEMPLATE_PATH = join(PACKAGE_ROOT, "docs", "templates", "epic.md");

function titleFromSlug(slug) {
  return slug
    .split("-")
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function localDate() {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
}

function isValidDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3]);
}

function renderEpicTemplate(source, { epicId, title, date }) {
  return source
    .replaceAll("EPIC-ID", epicId)
    .replaceAll("Epic Name", title)
    .replaceAll("yyyy-mm-dd", date);
}

function physicalIdentity(state) {
  return { dev: String(state.dev), ino: String(state.ino) };
}

function samePhysicalIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino;
}

async function captureRepositoryAnchor(repositoryRoot) {
  const logicalPath = resolve(repositoryRoot);
  const logicalState = await lstat(logicalPath, { bigint: true });
  const physicalPath = await resolvePhysicalPath(logicalPath);
  const physicalState = await lstat(physicalPath, { bigint: true });
  if (!physicalState.isDirectory() || physicalState.isSymbolicLink()) {
    throw new SddError(`Configured repository is not a real physical directory: ${repositoryRoot}`, {
      code: "UNSAFE_ARTIFACT_PATH",
    });
  }
  return {
    logicalPath,
    logicalIdentity: physicalIdentity(logicalState),
    logicalIsSymlink: logicalState.isSymbolicLink(),
    physicalPath,
    physicalIdentity: physicalIdentity(physicalState),
  };
}

async function assertEpicPathAnchor(anchor, path) {
  const absolutePath = resolve(path);
  const logicalState = await lstat(anchor.logicalPath, { bigint: true });
  const physicalPath = await resolvePhysicalPath(anchor.logicalPath);
  const physicalState = await lstat(physicalPath, { bigint: true });
  if (!samePhysicalIdentity(physicalIdentity(logicalState), anchor.logicalIdentity)
    || logicalState.isSymbolicLink() !== anchor.logicalIsSymlink
    || physicalPath !== anchor.physicalPath
    || !physicalState.isDirectory()
    || physicalState.isSymbolicLink()
    || !samePhysicalIdentity(physicalIdentity(physicalState), anchor.physicalIdentity)) {
    throw new SddError(`Repository root changed during Epic creation: ${anchor.logicalPath}`, {
      code: "CONCURRENT_CHANGE",
    });
  }
  const physicalArtifactPath = await resolvePhysicalPath(absolutePath);
  if (!isPathInside(anchor.logicalPath, absolutePath)
    || !isPathInside(anchor.physicalPath, physicalArtifactPath)
    || physicalArtifactPath === anchor.physicalPath) {
    throw new SddError(`Epic path escapes its physical repository root: ${absolutePath}`, {
      code: "UNSAFE_ARTIFACT_PATH",
    });
  }
}

async function epicEntryPresent(anchor, path) {
  const parent = dirname(path);
  await assertEpicPathAnchor(anchor, parent);
  try {
    await lstat(path);
    await assertEpicPathAnchor(anchor, parent);
    return true;
  } catch (error) {
    if (!["ENOENT", "ENOTDIR"].includes(error?.code)) throw error;
    await assertEpicPathAnchor(anchor, parent);
    return false;
  }
}

function concurrentEpicTarget(epicDirectory, error = null) {
  return new SddError(`Epic destination changed before exclusive creation: ${epicDirectory}`, {
    code: "CONCURRENT_CHANGE",
    details: [
      "The existing destination was preserved.",
      "Inspect the destination; preserve newer work or remove the collision manually, then retry.",
      ...(error?.message ? [`Filesystem error: ${error.message}`] : []),
    ],
  });
}

function retainedEpicStateFailure(primaryError, retainedPath, extraErrors = []) {
  const details = [
    `Original error: ${primaryError?.code ? `${primaryError.code}: ` : ""}${primaryError.message}`,
    `Retained path requiring inspection: ${retainedPath}`,
    "Inspect the retained Epic state; preserve newer work or remove the residue manually, then retry.",
  ];
  const failure = new SddError("Epic creation stopped with preserved state.", {
    code: "MUTATION_RECOVERY_FAILED",
    details,
  });
  failure.retainedPaths = [retainedPath];
  failure.errors = [primaryError, ...extraErrors];
  failure.cause = failure.errors.length === 1
    ? primaryError
    : new AggregateError(failure.errors, failure.message);
  return failure;
}

async function syncDirectoryBestEffort(path) {
  let handle;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EBADF", "EISDIR"].includes(error?.code)) throw error;
  } finally {
    await handle?.close();
  }
}

async function assertEpicScaffoldCurrent(anchor, proof) {
  await assertEpicPathAnchor(anchor, proof.directory);
  const directoryState = await lstat(proof.directory, { bigint: true });
  if (!directoryState.isDirectory()
    || directoryState.isSymbolicLink()
    || !samePhysicalIdentity(physicalIdentity(directoryState), proof.directoryIdentity)) {
    throw concurrentEpicTarget(proof.directory);
  }
  const entries = await readdir(proof.directory);
  if (entries.length !== 1 || entries[0] !== "epic.md") {
    throw concurrentEpicTarget(proof.directory);
  }
  const fileState = await lstat(proof.path, { bigint: true });
  if (!fileState.isFile()
    || fileState.isSymbolicLink()
    || !samePhysicalIdentity(physicalIdentity(fileState), proof.fileIdentity)
    || await readFile(proof.path, "utf8") !== proof.source) {
    throw concurrentEpicTarget(proof.directory);
  }
  const finalDirectoryState = await lstat(proof.directory, { bigint: true });
  const finalFileState = await lstat(proof.path, { bigint: true });
  if (!samePhysicalIdentity(physicalIdentity(finalDirectoryState), proof.directoryIdentity)
    || !samePhysicalIdentity(physicalIdentity(finalFileState), proof.fileIdentity)) {
    throw concurrentEpicTarget(proof.directory);
  }
  await assertEpicPathAnchor(anchor, proof.directory);
}

async function publishEpicScaffold(
  anchor,
  epicDirectory,
  source,
  {
    beforeParentCreate = null,
    beforePublish = null,
    afterDirectoryCreate = null,
  } = {},
) {
  const parent = dirname(epicDirectory);
  await beforeParentCreate?.({ parentPath: parent, targetPath: epicDirectory });
  await assertEpicPathAnchor(anchor, parent);
  const parentExisted = await pathExists(parent);
  try {
    await mkdir(parent, { recursive: true });
    await assertEpicPathAnchor(anchor, parent);
    await beforePublish?.({ targetPath: epicDirectory });
    await assertEpicPathAnchor(anchor, parent);
  } catch (error) {
    if (!parentExisted) {
      throw retainedEpicStateFailure(error, parent);
    }
    throw error;
  }

  try {
    await mkdir(epicDirectory);
  } catch (error) {
    if (["EEXIST", "EISDIR", "ENOTDIR", "ELOOP"].includes(error?.code)) {
      throw concurrentEpicTarget(epicDirectory, error);
    }
    throw error;
  }

  const path = join(epicDirectory, "epic.md");
  let handle = null;
  try {
    const directoryState = await lstat(epicDirectory, { bigint: true });
    if (!directoryState.isDirectory() || directoryState.isSymbolicLink()) {
      throw concurrentEpicTarget(epicDirectory);
    }
    const directoryIdentity = physicalIdentity(directoryState);
    await afterDirectoryCreate?.({ targetPath: epicDirectory, directoryIdentity });
    await assertEpicPathAnchor(anchor, epicDirectory);
    const preparedDirectoryState = await lstat(epicDirectory, { bigint: true });
    if (!preparedDirectoryState.isDirectory()
      || preparedDirectoryState.isSymbolicLink()
      || !samePhysicalIdentity(physicalIdentity(preparedDirectoryState), directoryIdentity)
      || (await readdir(epicDirectory)).length !== 0) {
      throw concurrentEpicTarget(epicDirectory);
    }
    handle = await open(path, "wx");
    await handle.writeFile(source, "utf8");
    await handle.sync();
    const fileState = await handle.stat({ bigint: true });
    await handle.close();
    handle = null;
    await syncDirectoryBestEffort(epicDirectory);
    await syncDirectoryBestEffort(parent);
    const proof = {
      directory: epicDirectory,
      directoryIdentity,
      path,
      fileIdentity: physicalIdentity(fileState),
      source,
    };
    await assertEpicScaffoldCurrent(anchor, proof);
    return proof;
  } catch (error) {
    const closeErrors = [];
    if (handle) {
      try {
        await handle.close();
      } catch (closeError) {
        closeErrors.push(closeError);
      }
    }
    throw retainedEpicStateFailure(error, epicDirectory, closeErrors);
  }
}

export async function createEpic(
  startPath,
  spaceId,
  epicId,
  slug,
  {
    date = null,
    repositories = [],
    dryRun = false,
    workspaceRoot: requestedWorkspaceRoot = null,
    beforeParentCreate = null,
    beforePublish = null,
    afterDirectoryCreate = null,
    afterValidationFailure = null,
    validate = validateArtifacts,
  } = {},
) {
  const operation = await resolveOperationConfiguration(
    startPath,
    requestedWorkspaceRoot ? { workspaceRoot: requestedWorkspaceRoot } : {},
  );
  const { workspaceRoot, config } = operation;
  assertValidConfig(config, "create an Epic");
  const space = config.ideas[spaceId];
  if (!space) {
    throw new SddError(`Unknown Space ID: ${spaceId}`, {
      code: "SPACE_NOT_FOUND",
      details: Object.keys(config.ideas).sort().map((id) => `Available Space ID: ${id}`),
    });
  }
  if (resolveWorkspaceStatus(space.status) !== "active") {
    throw new SddError(`Space ${spaceId} is not active. Update its .sdd status before creating an Epic.`, {
      code: "SPACE_NOT_ACTIVE",
    });
  }
  if (!/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/.test(epicId)) {
    throw new SddError("Epic ID must use uppercase letters, numbers, and single hyphens.", {
      code: "INVALID_EPIC_ID",
    });
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new SddError("Epic slug must contain lowercase letters, numbers, and single hyphens.", {
      code: "INVALID_EPIC_SLUG",
    });
  }

  const selectedDate = date ?? localDate();
  if (!isValidDate(selectedDate)) {
    throw new SddError("Epic date must use YYYY-MM-DD.", { code: "INVALID_EPIC_DATE" });
  }

  const selected = await selectRepositoryTargetsForCreate(
    workspaceRoot,
    config,
    space,
    repositories,
    { allowNone: false, requireIdentity: false },
  );
  if (selected.length !== 1) {
    throw new SddError("Epic creation targets exactly one repository; select one with --repo.", {
      code: "REPOSITORY_REQUIRED",
      details: selected.map((repository) => `Selected repository: ${repository.resolvedPath}`),
    });
  }
  const repository = selected[0];
  const artifacts = repository.artifacts;
  const repositoryRoot = resolveWorkspacePath(workspaceRoot, repository.resolvedPath);
  if (!(await pathExists(repositoryRoot))) {
    throw new SddError(`Configured repository does not exist: ${repository.resolvedPath}`, {
      code: "REPOSITORY_NOT_FOUND",
    });
  }
  const repositoryAnchor = await captureRepositoryAnchor(repositoryRoot);

  const directory = `${epicId.toLowerCase()}-${slug}`;
  const epicDirectory = join(repositoryRoot, artifacts.epics, directory);
  await assertEpicPathAnchor(repositoryAnchor, epicDirectory);
  const epicPath = join(epicDirectory, "epic.md");
  const result = {
    command: "epic-create",
    workspaceRoot,
    dryRun,
    spaceId,
    epicId,
    title: titleFromSlug(slug),
    repository,
    path: relativeWorkspacePath(workspaceRoot, epicPath),
    validation: null,
  };

  if (await epicEntryPresent(repositoryAnchor, epicDirectory)) {
    throw new SddError(`Epic already exists: ${relativeWorkspacePath(workspaceRoot, epicDirectory)}`, {
      code: "EPIC_EXISTS",
    });
  }
  if (dryRun) return result;

  const template = await readFile(EPIC_TEMPLATE_PATH, "utf8");
  const source = renderEpicTemplate(template, {
    epicId,
    title: result.title,
    date: selectedDate,
  });
  const assertCurrentAuthority = async () => {
    await assertOperationConfigurationCurrent(operation);
    await assertSelectedRepositorySnapshotsCurrent(workspaceRoot, config, space, selected);
  };
  await assertCurrentAuthority();
  const proof = await publishEpicScaffold(repositoryAnchor, epicDirectory, source, {
    beforeParentCreate: async (context) => {
      await beforeParentCreate?.(context);
      await assertCurrentAuthority();
    },
    beforePublish: async (context) => {
      await beforePublish?.(context);
      await assertCurrentAuthority();
    },
    afterDirectoryCreate,
  });

  let primaryError = null;
  const additionalErrors = [];
  try {
    await assertEpicScaffoldCurrent(repositoryAnchor, proof);
    await assertCurrentAuthority();
    await assertEpicScaffoldCurrent(repositoryAnchor, proof);
    result.validation = await validate(startPath, {
      spaceId,
      repositories: [repository.id ?? repository.resolvedPath],
      epicId,
      epicDirectory: directory,
      repositoryProjection: repository,
      workspaceRoot,
    });
    if (!result.validation.valid) {
      throw new SddError("The packaged Epic template failed structural validation.", {
        code: "INVALID_EPIC_TEMPLATE",
        details: result.validation.findings.map((finding) => `${finding.code}: ${finding.message}`),
      });
    }
    await assertCurrentAuthority();
    await assertEpicScaffoldCurrent(repositoryAnchor, proof);
  } catch (error) {
    primaryError = error;
  }

  if (primaryError) {
    if (afterValidationFailure) {
      try {
        await afterValidationFailure({ path: epicDirectory });
      } catch (error) {
        additionalErrors.push(error);
      }
    }
    throw retainedEpicStateFailure(primaryError, epicDirectory, additionalErrors);
  }
  return result;
}
