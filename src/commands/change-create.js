import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  assertChangeStoreConfinement,
  changeStoreEntryExists,
  getActiveChangePath,
  getChangesRoot,
  getClosedChangePath,
  relativeChangeStorePath,
} from "../change-store.js";
import {
  assertSelectedRepositorySnapshotsCurrent,
  selectRepositoryTargetsForCreate,
} from "../change-repositories.js";
import { setChangeMetadata } from "../change-status.js";
import { assertValidConfig, resolveWorkspaceStatus } from "../config.js";
import { PACKAGE_ROOT } from "../constants.js";
import { SddError } from "../errors.js";
import {
  assertOperationConfigurationCurrent,
  resolveOperationConfiguration,
} from "../workspace.js";

const CHANGE_TEMPLATE = join(
  PACKAGE_ROOT,
  "skills",
  "sdd-change",
  "assets",
  "change-template.md",
);
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

function localDate() {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
}

function concurrentCreate(changeId, path, detail) {
  return new SddError(`Change creation conflicted with current state: ${changeId}`, {
    code: "CONCURRENT_CHANGE",
    details: [
      detail,
      `Preserved Change path: ${path}`,
      "Inspect the preserved state and retry with a different ID or after resolving the collision.",
    ],
  });
}

function createRecoveryFailure(changeId, path, error) {
  const failure = new SddError(`Change creation requires manual recovery: ${changeId}`, {
    code: "MUTATION_RECOVERY_FAILED",
    details: [
      `Original error: ${error?.code ? `${error.code}: ` : ""}${error?.message ?? String(error)}`,
      `Retained Change path requiring inspection: ${path}`,
      "Preserve the intended complete Change or remove only the confirmed incomplete residue, then retry.",
    ],
  });
  failure.cause = error;
  failure.errors = [error];
  failure.retainedPaths = [path];
  return failure;
}

function renderChange(source, { title, spaceId, repositories }) {
  const withTitle = source.replaceAll("CHANGE TITLE", title);
  const withMetadata = setChangeMetadata(withTitle, {
    space: spaceId,
    repositories: repositories.map((repository) => repository.id),
  });
  if (withMetadata === null) {
    throw new SddError("Bundled change template has invalid metadata.", {
      code: "INVALID_CHANGE_TEMPLATE",
    });
  }
  const repositoryLines = repositories.length === 0
    ? "- None selected yet."
    : repositories.map((repository) =>
      `- \`${repository.id}\` — \`${repository.resolvedPath}\`${repository.role ? ` (${repository.role})` : ""}`,
    ).join("\n");
  return withMetadata.replace(
    /## Target Repositories\n\n- None selected yet\./,
    `## Target Repositories\n\n${repositoryLines}`,
  );
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
    beforePublish = null,
    afterDirectoryCreate = null,
  } = {},
) {
  const operation = await resolveOperationConfiguration(
    startPath,
    requestedWorkspaceRoot ? { workspaceRoot: requestedWorkspaceRoot } : {},
  );
  const { workspaceRoot, config } = operation;

  assertValidConfig(config, "create a Change");
  const space = config.ideas[spaceId];
  if (!space) {
    throw new SddError(`Unknown Space ID: ${spaceId}`, {
      code: "SPACE_NOT_FOUND",
      details: Object.keys(config.ideas).sort().map((id) => `Available Space ID: ${id}`),
    });
  }
  if (resolveWorkspaceStatus(space.status) !== "active") {
    throw new SddError(`Space ${spaceId} is not active.`, { code: "SPACE_NOT_ACTIVE" });
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new SddError(
      "Change slug must contain lowercase letters, numbers, and single hyphens.",
      { code: "INVALID_CHANGE_SLUG" },
    );
  }

  const selectedDate = date ?? localDate();
  if (!isValidDate(selectedDate)) {
    throw new SddError("Change date must use YYYY-MM-DD.", {
      code: "INVALID_CHANGE_DATE",
    });
  }

  // Repository ownership is optional while a Change is proposed. Resolve only
  // explicit selections; planning must settle ownership before `planned`.
  const selectedRepositories = repositories.length === 0
    ? []
    : await selectRepositoryTargetsForCreate(
        workspaceRoot,
        config,
        space,
        repositories,
        { requireIdentity: true },
      );
  const changeId = `${selectedDate}-${slug}`;
  const absolutePath = getActiveChangePath(changeId, workspaceRoot);
  const closedPath = getClosedChangePath(changeId, workspaceRoot);
  const displayPath = relativeChangeStorePath(absolutePath, workspaceRoot);
  const title = changeTitle(slug);
  const files = ["change.md"];

  if (await changeStoreEntryExists(absolutePath) || await changeStoreEntryExists(closedPath)) {
    throw new SddError(
      `Change ID already exists in central active or closed history: ${changeId}`,
      { code: "CHANGE_EXISTS" },
    );
  }
  if (dryRun) {
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

  const source = renderChange(await readFile(CHANGE_TEMPLATE, "utf8"), {
    title,
    spaceId,
    repositories: selectedRepositories,
  });
  await beforePublish?.({ targetPath: absolutePath, closedPath });
  await assertOperationConfigurationCurrent(operation);
  await assertSelectedRepositorySnapshotsCurrent(
    workspaceRoot,
    config,
    space,
    selectedRepositories,
  );
  const changesRoot = getChangesRoot(workspaceRoot);
  await assertChangeStoreConfinement(changesRoot, workspaceRoot);
  await mkdir(changesRoot, { recursive: true });
  await assertChangeStoreConfinement(changesRoot, workspaceRoot);
  try {
    await mkdir(absolutePath);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new SddError(`Change ID already exists: ${changeId}`, {
        code: "CHANGE_EXISTS",
      });
    }
    throw error;
  }

  const createdState = await lstat(absolutePath, { bigint: true });
  try {
    await afterDirectoryCreate?.({ targetPath: absolutePath, closedPath });
    await assertChangeStoreConfinement(absolutePath, workspaceRoot);
    const visibleState = await lstat(absolutePath, { bigint: true });
    if (
      !visibleState.isDirectory()
      || visibleState.isSymbolicLink()
      || visibleState.dev !== createdState.dev
      || visibleState.ino !== createdState.ino
    ) {
      throw concurrentCreate(
        changeId,
        absolutePath,
        "The exclusively created Change directory was replaced before change.md publication.",
      );
    }
    await writeFile(join(absolutePath, "change.md"), source, { flag: "wx" });
    await assertOperationConfigurationCurrent(operation);
    await assertSelectedRepositorySnapshotsCurrent(
      workspaceRoot,
      config,
      space,
      selectedRepositories,
    );
    if (await changeStoreEntryExists(closedPath)) {
      throw concurrentCreate(
        changeId,
        absolutePath,
        `Closed history appeared during creation: ${closedPath}`,
      );
    }
  } catch (error) {
    if (["CONCURRENT_CHANGE", "UNSAFE_ARTIFACT_PATH"].includes(error?.code)) throw error;
    throw createRecoveryFailure(changeId, absolutePath, error);
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
