import { lstat, readFile } from "node:fs/promises";
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
import {
  assertPublishedFlatDirectory,
  publishFlatDirectoryWithoutReplace,
  recoverFlatDirectoryPublication,
  stageFlatDirectory,
} from "../directory-publication.js";
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

function cleanupFailure(primaryError, cleanupError, epicDirectory) {
  const failure = new SddError("Epic creation failed and owned-directory cleanup was incomplete.", {
    code: "MUTATION_RECOVERY_FAILED",
    details: [
      `Original error: ${primaryError?.code ? `${primaryError.code}: ` : ""}${primaryError.message}`,
      `Cleanup error: ${cleanupError.message}`,
      `Retained path requiring inspection: ${epicDirectory}`,
    ],
  });
  failure.errors = [primaryError, cleanupError];
  failure.cause = new AggregateError(failure.errors, failure.message);
  return failure;
}

function preservedPublicationError(primaryError, cleanup) {
  const failure = new SddError("Epic creation detected a concurrent destination replacement and preserved it.", {
    code: "CONCURRENT_CHANGE",
    details: [
      `Original error: ${primaryError?.code ? `${primaryError.code}: ` : ""}${primaryError.message}`,
      ...cleanup.details,
    ],
  });
  failure.cause = primaryError;
  return failure;
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
    beforePublish = null,
    beforeHandoff = null,
    afterStageRootMkdir = null,
    afterPublicationJournalMkdir = null,
    afterPublicationLiveOwner = null,
    afterStageRootReservation = null,
    afterStagedPayload = null,
    afterStagedProgress = null,
    afterStagedEntry = null,
    afterStagingComplete = null,
    afterPublicationPrepared = null,
    afterReservationMkdir = null,
    afterReservationReceiptWrite = null,
    afterReservationReceipt = null,
    afterReservation = null,
    afterEntryPublication = null,
    afterTemporaryVerification = null,
    afterSourceCleanup = null,
    afterHandoffCleanup = null,
    afterJournalCleanup = null,
    afterOwnerMarkerCleanup = null,
    beforeValidationRollback = null,
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
  const epicDirectory = join(
    repositoryRoot,
    artifacts.epics,
    directory,
  );
  await assertEpicPathAnchor(repositoryAnchor, epicDirectory);
  const epicPath = join(epicDirectory, "epic.md");
  const parent = dirname(epicDirectory);
  const assertPublicationPath = (path) => assertEpicPathAnchor(repositoryAnchor, path);
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
  let renderedEntries = null;
  if (!dryRun) {
    const template = await readFile(EPIC_TEMPLATE_PATH, "utf8");
    renderedEntries = [[
      "epic.md",
      renderEpicTemplate(template, {
        epicId,
        title: result.title,
        date: selectedDate,
      }),
    ]];
    await assertOperationConfigurationCurrent(operation);
    await assertSelectedRepositorySnapshotsCurrent(
      workspaceRoot,
      config,
      space,
      selected,
    );
    const recovery = await recoverFlatDirectoryPublication(epicDirectory, renderedEntries, {
      label: `Epic ${epicId}`,
      assertPath: assertPublicationPath,
      ownerRoot: repositoryRoot,
    });
    if (recovery.committed) {
      let primaryError = null;
      let finalized = null;
      const assertRecoveryAuthority = async (publication = null) => {
        if (publication) await assertPublishedFlatDirectory(publication);
        else await recovery.assertCurrent();
        await assertOperationConfigurationCurrent(operation);
        await assertSelectedRepositorySnapshotsCurrent(
          workspaceRoot,
          config,
          space,
          selected,
        );
        if (publication) await assertPublishedFlatDirectory(publication);
        else await recovery.assertCurrent();
      };
      try {
        await assertRecoveryAuthority();
        finalized = await recovery.finalize({
          beforeCommit: async ({ publication }) => {
            await assertRecoveryAuthority(publication);
            result.validation = await validate(startPath, {
              spaceId,
              repositories: [repository.id ?? repository.resolvedPath],
              epicId,
              epicDirectory: directory,
              repositoryProjection: repository,
              workspaceRoot,
            });
            if (!result.validation.valid) {
              throw new SddError("The recovered Epic failed structural validation; no Epic was kept.", {
                code: "INVALID_EPIC_TEMPLATE",
                details: result.validation.findings.map((finding) => `${finding.code}: ${finding.message}`),
              });
            }
            await assertRecoveryAuthority(publication);
          },
        });
      } catch (error) {
        primaryError = error;
      }
      if (primaryError) {
        let rollbackHookError = null;
        if (beforeValidationRollback) {
          try {
            await beforeValidationRollback({ path: epicDirectory });
          } catch (error) {
            rollbackHookError = error;
          }
        }
        let cleanup;
        try {
          cleanup = await recovery.rollback();
        } catch (cleanupError) {
          throw cleanupFailure(primaryError, cleanupError, epicDirectory);
        }
        if (!cleanup.removed || cleanup.concurrent) {
          throw preservedPublicationError(primaryError, cleanup);
        }
        if (rollbackHookError) {
          throw cleanupFailure(primaryError, rollbackHookError, epicDirectory);
        }
        throw primaryError;
      }
      await assertPublishedFlatDirectory(finalized.publication);
      return result;
    }
  }
  if (await epicEntryPresent(repositoryAnchor, epicDirectory)) {
    throw new SddError(`Epic already exists: ${relativeWorkspacePath(workspaceRoot, epicDirectory)}`, {
      code: "EPIC_EXISTS",
    });
  }
  if (dryRun) return result;

  const staged = await stageFlatDirectory(parent, directory, renderedEntries, {
    label: `Epic ${epicId} staging directory`,
    assertPath: assertPublicationPath,
    ownerRoot: repositoryRoot,
    afterStageRootMkdir,
    afterStageRootReservation,
    afterStagedPayload,
    afterStagedProgress,
    afterStagedEntry,
    afterStagingComplete,
  });
  const prepared = await publishFlatDirectoryWithoutReplace(staged, epicDirectory, {
    label: `Epic ${epicId}`,
    beforePublish: async (context) => {
      if (beforePublish) await beforePublish(context);
      await assertOperationConfigurationCurrent(operation);
      await assertSelectedRepositorySnapshotsCurrent(
        workspaceRoot,
        config,
        space,
        selected,
      );
    },
    beforeHandoff,
    afterPublicationJournalMkdir,
    afterPublicationLiveOwner,
    afterReservationMkdir,
    afterReservationReceiptWrite,
    afterReservationReceipt,
    afterReservation,
    afterEntryPublication,
    afterTemporaryVerification,
    afterSourceCleanup,
    afterHandoffCleanup,
    afterJournalCleanup,
    afterOwnerMarkerCleanup,
    assertPath: assertPublicationPath,
  });

  let primaryError = null;
  let finalized = null;
  const assertFinalAuthority = async (publication = null) => {
    if (publication) await assertPublishedFlatDirectory(publication);
    else await prepared.assertCurrent();
    await assertOperationConfigurationCurrent(operation);
    await assertSelectedRepositorySnapshotsCurrent(
      workspaceRoot,
      config,
      space,
      selected,
    );
    if (publication) await assertPublishedFlatDirectory(publication);
    else await prepared.assertCurrent();
  };
  try {
    if (afterPublicationPrepared) {
      await afterPublicationPrepared({ path: epicDirectory, journalPath: prepared.journalPath });
    }
    await assertFinalAuthority();
    finalized = await prepared.finalize({
      beforeCommit: async ({ publication }) => {
        await assertFinalAuthority(publication);
        result.validation = await validate(startPath, {
          spaceId,
          repositories: [repository.id ?? repository.resolvedPath],
          epicId,
          epicDirectory: directory,
          repositoryProjection: repository,
          workspaceRoot,
        });
        if (!result.validation.valid) {
          throw new SddError("The packaged Epic template failed structural validation; no Epic was kept.", {
            code: "INVALID_EPIC_TEMPLATE",
            details: result.validation.findings.map((finding) => `${finding.code}: ${finding.message}`),
          });
        }
        await assertFinalAuthority(publication);
      },
    });
  } catch (error) {
    primaryError = error;
  }
  if (!primaryError) {
    await assertPublishedFlatDirectory(finalized.publication);
    return result;
  }

  let rollbackHookError = null;
  if (beforeValidationRollback) {
    try {
      await beforeValidationRollback({ path: epicDirectory });
    } catch (error) {
      rollbackHookError = error;
    }
  }
  let cleanup;
  try {
    cleanup = await prepared.rollback();
  } catch (cleanupError) {
    throw cleanupFailure(primaryError, cleanupError, epicDirectory);
  }
  if (!cleanup.removed || cleanup.concurrent) {
    throw preservedPublicationError(primaryError, cleanup);
  }
  if (rollbackHookError) {
    throw cleanupFailure(primaryError, rollbackHookError, epicDirectory);
  }
  throw primaryError;
}
