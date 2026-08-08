import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  getActiveChangePath,
  getChangesRoot,
  getClosedChangePath,
  relativeChangeStorePath,
  assertChangeStoreConfinement,
} from "../change-store.js";
import { setChangeMetadata } from "../change-status.js";
import { resolveRepositoryTargets, selectRepositories } from "../change-repositories.js";
import { assertValidConfig, getUserRoot, resolveWorkspaceStatus } from "../config.js";
import { resolveOperationConfiguration } from "../workspace.js";
import { PACKAGE_ROOT } from "../constants.js";
import { SddError } from "../errors.js";
import { pathExists } from "../fs.js";
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
      /- Expected dirty files: `[^`]+`/,
      `- Expected dirty files: repositories targeted by \`${changePath}\``,
    );
    const withMetadata = setChangeMetadata(rendered, {
      space: spaceId,
      repositories: repositories.map((repository) => repository.id),
    });
    if (withMetadata !== null) rendered = withMetadata;
  }
  return rendered;
}

export async function createChange(
  startPath,
  spaceId,
  slug,
  {
    date = null,
    repositories = [],
    dryRun = false,
    userRoot = null,
    lockToken = null,
  } = {},
) {
  userRoot ??= getUserRoot();
  if (!dryRun && lockToken !== CENTRAL_CHANGE_LOCK) {
    return withWorkspaceMutationLock(userRoot, () => createChange(startPath, spaceId, slug, {
      date,
      repositories,
      dryRun,
      userRoot,
      lockToken: CENTRAL_CHANGE_LOCK,
    }));
  }
  const { workspaceRoot, config } = await resolveOperationConfiguration(startPath, { userRoot });
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
  const availableRepositories = await resolveRepositoryTargets(workspaceRoot, config, space, {
    activeOnly: true,
  });
  const selectedRepositories = selectRepositories(availableRepositories, repositories);
  const absolutePath = getActiveChangePath(changeId, userRoot);
  const closedPath = getClosedChangePath(changeId, userRoot);
  await assertChangeStoreConfinement(absolutePath, userRoot);
  await assertChangeStoreConfinement(closedPath, userRoot);
  if (await pathExists(absolutePath) || await pathExists(closedPath)) {
    throw new SddError(`Change ID already exists in central active or closed history: ${changeId}`, {
      code: "CHANGE_EXISTS",
    });
  }

  const title = changeTitle(slug);
  const files = TEMPLATE_FILES.map(([name]) => name);
  const displayPath = relativeChangeStorePath(absolutePath, userRoot);
  if (!dryRun) {
    const changesRoot = getChangesRoot(userRoot);
    const temporaryPath = join(changesRoot, `.${changeId}.sdd-new-${process.pid}-${Date.now()}`);
    await mkdir(changesRoot, { recursive: true });
    await assertChangeStoreConfinement(temporaryPath, userRoot);
    await mkdir(temporaryPath);
    try {
      for (const [name, templatePath] of TEMPLATE_FILES) {
        const source = await readFile(templatePath, "utf8");
        await writeFile(join(temporaryPath, name), renderTemplate(source, {
          title,
          changeId,
          changePath: displayPath,
          spaceId,
          repositories: selectedRepositories,
        }), "utf8");
      }
      await assertChangeStoreConfinement(absolutePath, userRoot);
      if (await pathExists(absolutePath) || await pathExists(closedPath)) {
        throw new SddError(`Change ID appeared during creation: ${changeId}`, {
          code: "CONCURRENT_CHANGE",
        });
      }
      await rename(temporaryPath, absolutePath);
    } catch (error) {
      await rm(temporaryPath, { recursive: true, force: true });
      throw error;
    }
  }

  return {
    command: "change-create",
    workspaceRoot,
    userRoot,
    dryRun,
    spaceId,
    changeId,
    title,
    path: displayPath,
    repositories: selectedRepositories,
    files,
  };
}
