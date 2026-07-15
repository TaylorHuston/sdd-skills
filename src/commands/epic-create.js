import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  assertValidConfig,
  findWorkspaceRoot,
  readConfig,
  relativeWorkspacePath,
  resolveWorkspacePath,
  resolveWorkspaceStatus,
} from "../config.js";
import { resolvedActiveRepositories, selectRepositories } from "../change-repositories.js";
import { PACKAGE_ROOT } from "../constants.js";
import { SddError } from "../errors.js";
import { isDirectory, pathExists } from "../fs.js";
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

export async function createEpic(
  startPath,
  spaceId,
  epicId,
  slug,
  { date = null, repositories = [], dryRun = false } = {},
) {
  const workspaceRoot = await findWorkspaceRoot(startPath);
  const config = await readConfig(workspaceRoot);
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

  const selected = selectRepositories(
    resolvedActiveRepositories(config, space),
    repositories,
    { allowNone: false },
  );
  if (selected.length !== 1) {
    throw new SddError("Epic creation targets exactly one repository; select one with --repo.", {
      code: "REPOSITORY_REQUIRED",
      details: selected.map((repository) => `Selected repository: ${repository.resolvedPath}`),
    });
  }
  const repository = selected[0];
  const repositoryRoot = resolveWorkspacePath(workspaceRoot, repository.resolvedPath);
  if (!(await isDirectory(repositoryRoot))) {
    throw new SddError(`Configured repository does not exist: ${repository.resolvedPath}`, {
      code: "REPOSITORY_NOT_FOUND",
    });
  }

  const directory = `${epicId.toLowerCase()}-${slug}`;
  const epicDirectory = join(
    repositoryRoot,
    config.repositoryArtifacts.epics,
    directory,
  );
  const epicPath = join(epicDirectory, "epic.md");
  if (await pathExists(epicDirectory)) {
    throw new SddError(`Epic already exists: ${relativeWorkspacePath(workspaceRoot, epicDirectory)}`, {
      code: "EPIC_EXISTS",
    });
  }

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
  if (dryRun) return result;

  const parent = dirname(epicDirectory);
  const temporaryDirectory = join(
    parent,
    `.${directory}.sdd-new-${process.pid}-${Date.now()}`,
  );
  await mkdir(parent, { recursive: true });
  await mkdir(temporaryDirectory);
  let renamed = false;
  try {
    const template = await readFile(EPIC_TEMPLATE_PATH, "utf8");
    await writeFile(
      join(temporaryDirectory, "epic.md"),
      renderEpicTemplate(template, {
        epicId,
        title: result.title,
        date: selectedDate,
      }),
      "utf8",
    );
    await rename(temporaryDirectory, epicDirectory);
    renamed = true;
    result.validation = await validateArtifacts(workspaceRoot, {
      spaceId,
      repositories: [repository.resolvedPath],
      epicId,
    });
    if (!result.validation.valid) {
      await rm(epicDirectory, { recursive: true, force: true });
      throw new SddError("The packaged Epic template failed structural validation; no Epic was kept.", {
        code: "INVALID_EPIC_TEMPLATE",
        details: result.validation.findings.map((finding) => `${finding.code}: ${finding.message}`),
      });
    }
    return result;
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    if (renamed) await rm(epicDirectory, { recursive: true, force: true });
    throw error;
  }
}
