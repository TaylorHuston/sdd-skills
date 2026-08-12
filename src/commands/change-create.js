import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  assertChangeStoreConfinement,
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
import { pathExists } from "../fs.js";
import { withWorkspaceMutationLock } from "../mutation.js";
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

function localDate() {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
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
    lockToken = null,
  } = {},
) {
  const operation = await resolveOperationConfiguration(
    startPath,
    requestedWorkspaceRoot ? { workspaceRoot: requestedWorkspaceRoot } : {},
  );
  const { workspaceRoot, config } = operation;
  if (!dryRun && lockToken !== CENTRAL_CHANGE_LOCK) {
    return withWorkspaceMutationLock(workspaceRoot, () => createChange(
      startPath,
      spaceId,
      slug,
      {
        date,
        repositories,
        dryRun,
        workspaceRoot,
        lockToken: CENTRAL_CHANGE_LOCK,
      },
    ));
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

  if (await pathExists(absolutePath) || await pathExists(closedPath)) {
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
  await assertOperationConfigurationCurrent(operation);
  await assertSelectedRepositorySnapshotsCurrent(
    workspaceRoot,
    config,
    space,
    selectedRepositories,
  );
  await mkdir(getChangesRoot(workspaceRoot), { recursive: true });
  await assertChangeStoreConfinement(getChangesRoot(workspaceRoot), workspaceRoot);
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

  try {
    await writeFile(join(absolutePath, "change.md"), source, { flag: "wx" });
    await assertOperationConfigurationCurrent(operation);
    await assertSelectedRepositorySnapshotsCurrent(
      workspaceRoot,
      config,
      space,
      selectedRepositories,
    );
    if (await pathExists(closedPath)) {
      throw new SddError(`Change ID appeared in closed history: ${changeId}`, {
        code: "CONCURRENT_CHANGE",
      });
    }
  } catch (error) {
    await rm(absolutePath, { recursive: true, force: true });
    throw error;
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
