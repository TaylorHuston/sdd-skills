import { lstat, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  getActiveChangePath,
  getChangesRoot,
  getClosedChangePath,
  relativeChangeStorePath,
  assertChangeStoreConfinement,
} from "../change-store.js";
import {
  assertPublishedFlatDirectory,
  publishFlatDirectoryWithoutReplace,
  recoverFlatDirectoryPublication,
  stageFlatDirectory,
} from "../directory-publication.js";
import { setChangeMetadata } from "../change-status.js";
import {
  assertSelectedRepositorySnapshotsCurrent,
  selectRepositoryTargetsForCreate,
} from "../change-repositories.js";
import { assertValidConfig, resolveWorkspaceStatus } from "../config.js";
import {
  assertOperationConfigurationCurrent,
  resolveOperationConfiguration,
} from "../workspace.js";
import { PACKAGE_ROOT } from "../constants.js";
import { SddError } from "../errors.js";
import { withWorkspaceMutationLock } from "../mutation.js";

const TEMPLATE_FILES = Object.freeze([
  ["proposal.md", join(PACKAGE_ROOT, "skills", "sdd-change", "assets", "proposal-template.md")],
  ["design.md", join(PACKAGE_ROOT, "skills", "sdd-change", "assets", "design-template.md")],
  ["tasks.md", join(PACKAGE_ROOT, "skills", "sdd-change", "assets", "tasks-template.md")],
]);

const CENTRAL_CHANGE_LOCK = Symbol("central-change-lock");

function changeTitle(slug) {
  return slug
    .split("-")
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function isValidDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function renderTemplate(source, { title, changeId, changePath, spaceId, repositories }) {
  const repositoryLines = repositories.length > 0
    ? repositories.map((repository) =>
      `- \`${repository.id}\` — \`${repository.resolvedPath}\`${repository.role ? ` (${repository.role})` : ""}`)
    : ["- None selected; this Space has no mapped implementation repository yet."];
  const expectedDirtyFiles = repositories.length > 0
    ? `central Change \`<workspace>/${changePath}/\` plus repository-local implementation, Epic, ADR, test, and supporting-doc files grouped by target repository: ${repositories.map((repository) => `\`${repository.id}\` (\`${repository.resolvedPath}\`)`).join(", ")}`
    : `central Change \`<workspace>/${changePath}/\`; no repository-local dirty files are expected because no implementation repository is targeted`;
  let rendered = source
    .replaceAll("CHANGE TITLE", title)
    .replaceAll("yyyy-mm-dd-change-name", changeId)
    .replaceAll("SPACE_ID", spaceId);

  if (rendered.startsWith("# Proposal:")) {
    rendered = rendered.replace(
      /## Target Repositories\n\n- Stable repository IDs matching `tasks\.md` frontmatter: TBD\./,
      `## Target Repositories\n\n${repositoryLines.join("\n")}`,
    );
  }
  if (/^---\r?\n/.test(rendered)) {
    rendered = rendered.replace(
      /^- Expected dirty files:.*$/m,
      `- Expected dirty files: ${expectedDirtyFiles}`,
    );
    const withMetadata = setChangeMetadata(rendered, {
      space: spaceId,
      repositories: repositories.map((repository) => repository.id),
    });
    if (withMetadata !== null) rendered = withMetadata;
  }
  return rendered;
}

async function changeEntryPresent(path, workspaceRoot) {
  const parent = dirname(path);
  await assertChangeStoreConfinement(parent, workspaceRoot);
  try {
    await lstat(path);
    await assertChangeStoreConfinement(parent, workspaceRoot);
    return true;
  } catch (error) {
    if (!["ENOENT", "ENOTDIR"].includes(error?.code)) throw error;
    await assertChangeStoreConfinement(parent, workspaceRoot);
    return false;
  }
}

export async function createChange(
  startPath,
  spaceId,
  slug,
  {
    date = null,
    repositories = [],
    dryRun = false,
    workspaceRoot: requestedWorkspaceRoot = null,
    lockToken = null,
    beforePublish = null,
    beforeHandoff = null,
    afterPublicationJournalMkdir = null,
    afterPublicationLiveOwner = null,
    afterStageRootMkdir = null,
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
  } = {},
) {
  const operation = await resolveOperationConfiguration(
    startPath,
    requestedWorkspaceRoot ? { workspaceRoot: requestedWorkspaceRoot } : {},
  );
  const { workspaceRoot, config } = operation;
  if (!dryRun && lockToken !== CENTRAL_CHANGE_LOCK) {
    return withWorkspaceMutationLock(workspaceRoot, () => createChange(startPath, spaceId, slug, {
      date,
      repositories,
      dryRun,
      workspaceRoot,
      lockToken: CENTRAL_CHANGE_LOCK,
      beforePublish,
      beforeHandoff,
      afterStageRootMkdir,
      afterPublicationJournalMkdir,
      afterPublicationLiveOwner,
      afterStageRootReservation,
      afterStagedPayload,
      afterStagedProgress,
      afterStagedEntry,
      afterStagingComplete,
      afterPublicationPrepared,
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
    }));
  }
  assertValidConfig(config, "create a Change");
  const space = config.ideas[spaceId];
  if (!space) {
    throw new SddError(`Unknown Space ID: ${spaceId}`, {
      code: "SPACE_NOT_FOUND",
      details: Object.keys(config.ideas).sort().map((id) => `Available Space ID: ${id}`),
    });
  }
  if (resolveWorkspaceStatus(space.status) !== "active") {
    throw new SddError(`Space ${spaceId} is not active. Update its .sdd status before creating work.`, {
      code: "SPACE_NOT_ACTIVE",
    });
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new SddError("Change slug must contain lowercase letters, numbers, and single hyphens.", {
      code: "INVALID_CHANGE_SLUG",
    });
  }

  const now = new Date();
  const localDate = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
  const selectedDate = date ?? localDate;
  if (!isValidDate(selectedDate)) {
    throw new SddError("Change date must use YYYY-MM-DD.", { code: "INVALID_CHANGE_DATE" });
  }

  const changeId = `${selectedDate}-${slug}`;
  const selectedRepositories = await selectRepositoryTargetsForCreate(
    workspaceRoot,
    config,
    space,
    repositories,
    { requireIdentity: true },
  );
  const absolutePath = getActiveChangePath(changeId, workspaceRoot);
  const closedPath = getClosedChangePath(changeId, workspaceRoot);
  const title = changeTitle(slug);
  const files = TEMPLATE_FILES.map(([name]) => name);
  const displayPath = relativeChangeStorePath(absolutePath, workspaceRoot);
  const changesRoot = getChangesRoot(workspaceRoot);
  const assertPublicationPath = (path) =>
    assertChangeStoreConfinement(path, workspaceRoot);
  let renderedFiles = null;
  if (!dryRun) {
    renderedFiles = await Promise.all(TEMPLATE_FILES.map(async ([name, templatePath]) => {
      const source = await readFile(templatePath, "utf8");
      return [name, renderTemplate(source, {
        title,
        changeId,
        changePath: displayPath,
        spaceId,
        repositories: selectedRepositories,
      })];
    }));
    await assertOperationConfigurationCurrent(operation);
    await assertSelectedRepositorySnapshotsCurrent(
      workspaceRoot,
      config,
      space,
      selectedRepositories,
    );
    const recovery = await recoverFlatDirectoryPublication(absolutePath, renderedFiles, {
      label: `Change ${changeId}`,
      assertPath: assertPublicationPath,
      ownerRoot: workspaceRoot,
    });
    if (recovery.committed) {
      let finalError = null;
      let finalized = null;
      const assertRecoveryAuthority = async (publication = null) => {
        if (publication) await assertPublishedFlatDirectory(publication);
        else await recovery.assertCurrent();
        await assertOperationConfigurationCurrent(operation);
        await assertSelectedRepositorySnapshotsCurrent(
          workspaceRoot,
          config,
          space,
          selectedRepositories,
        );
        if (await changeEntryPresent(closedPath, workspaceRoot)) {
          throw new SddError(`Change ID appeared in closed history during recovery: ${changeId}`, {
            code: "CONCURRENT_CHANGE",
          });
        }
        if (publication) await assertPublishedFlatDirectory(publication);
        else await recovery.assertCurrent();
      };
      try {
        await assertRecoveryAuthority();
        finalized = await recovery.finalize({
          beforeCommit: ({ publication }) => assertRecoveryAuthority(publication),
        });
      } catch (error) {
        finalError = error;
      }
      if (finalError) {
        try {
          await recovery.rollback();
        } catch (cleanupError) {
          throw new SddError("Recovered Change failed final authority and exact rollback.", {
            code: "MUTATION_RECOVERY_FAILED",
            details: [
              `Original error: ${finalError.message}`,
              `Active Change requiring inspection: ${absolutePath}`,
              `Cleanup error: ${cleanupError.message}`,
            ],
          });
        }
        throw finalError;
      }
      await assertPublishedFlatDirectory(finalized.publication);
      return {
        command: "change-create",
        workspaceRoot,
        dryRun,
        spaceId,
        changeId,
        title,
        path: displayPath,
        repositories: selectedRepositories,
        files,
      };
    }
  }
  if (await changeEntryPresent(absolutePath, workspaceRoot)
    || await changeEntryPresent(closedPath, workspaceRoot)) {
    throw new SddError(`Change ID already exists in central active or closed history: ${changeId}`, {
      code: "CHANGE_EXISTS",
    });
  }

  if (!dryRun) {
    const staged = await stageFlatDirectory(changesRoot, changeId, renderedFiles, {
      label: `Change ${changeId} staging directory`,
      assertPath: assertPublicationPath,
      ownerRoot: workspaceRoot,
      afterStageRootMkdir,
      afterStageRootReservation,
      afterStagedPayload,
      afterStagedProgress,
      afterStagedEntry,
      afterStagingComplete,
    });
    const prepared = await publishFlatDirectoryWithoutReplace(staged, absolutePath, {
      label: `Change ${changeId}`,
      assertPath: assertPublicationPath,
      beforeHandoff,
      afterReservationMkdir,
      afterPublicationJournalMkdir,
      afterPublicationLiveOwner,
      afterReservationReceiptWrite,
      afterReservationReceipt,
      afterReservation,
      afterEntryPublication,
      afterTemporaryVerification,
      afterSourceCleanup,
      afterHandoffCleanup,
      afterJournalCleanup,
      afterOwnerMarkerCleanup,
      beforePublish: async (context) => {
        if (beforePublish) await beforePublish(context);
        await assertOperationConfigurationCurrent(operation);
        await assertSelectedRepositorySnapshotsCurrent(
          workspaceRoot,
          config,
          space,
          selectedRepositories,
        );
        if (await changeEntryPresent(closedPath, workspaceRoot)) {
          throw new SddError(`Change ID appeared in closed history during creation: ${changeId}`, {
            code: "CONCURRENT_CHANGE",
          });
        }
      },
    });

    let finalError = null;
    let finalized = null;
    const assertFinalAuthority = async (publication = null) => {
      if (publication) await assertPublishedFlatDirectory(publication);
      else await prepared.assertCurrent();
      await assertOperationConfigurationCurrent(operation);
      await assertSelectedRepositorySnapshotsCurrent(
        workspaceRoot,
        config,
        space,
        selectedRepositories,
      );
      if (await changeEntryPresent(closedPath, workspaceRoot)) {
        throw new SddError(`Change ID appeared in closed history during creation: ${changeId}`, {
          code: "CONCURRENT_CHANGE",
        });
      }
      if (publication) await assertPublishedFlatDirectory(publication);
      else await prepared.assertCurrent();
    };
    try {
      if (afterPublicationPrepared) {
        await afterPublicationPrepared({ path: absolutePath, journalPath: prepared.journalPath });
      }
      await assertFinalAuthority();
      finalized = await prepared.finalize({
        beforeCommit: ({ publication }) => assertFinalAuthority(publication),
      });
    } catch (error) {
      finalError = error;
    }
    if (finalError) {
      let cleanup;
      try {
        cleanup = await prepared.rollback();
      } catch (cleanupError) {
        throw new SddError("Change creation final authority check failed and prepared-publication rollback failed.", {
          code: "MUTATION_RECOVERY_FAILED",
          details: [
            `Original error: ${finalError.message}`,
            `Active Change requiring inspection: ${absolutePath}`,
            `Cleanup error: ${cleanupError.message}`,
          ],
        });
      }
      if (!cleanup.removed || cleanup.concurrent) {
        throw new SddError("Change creation final authority check failed and prepared-publication rollback retained data.", {
          code: "MUTATION_RECOVERY_FAILED",
          details: [
            `Original error: ${finalError.message}`,
            `Active Change requiring inspection: ${absolutePath}`,
            ...cleanup.details,
          ],
        });
      }
      if (finalError instanceof SddError) {
        finalError.details = [...(finalError.details ?? []), ...cleanup.details];
      }
      throw finalError;
    }
    await assertPublishedFlatDirectory(finalized.publication);
  }

  return {
    command: "change-create",
    workspaceRoot,
    dryRun,
    spaceId,
    changeId,
    title,
    path: displayPath,
    repositories: selectedRepositories,
    files,
  };
}
