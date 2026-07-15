import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  assertValidConfig,
  findWorkspaceRoot,
  readConfig,
  relativeWorkspacePath,
  resolveIdeaPlanningPath,
  resolveWorkspaceStatus,
  resolveWorkspacePath,
} from "../config.js";
import { resolvedActiveRepositories, selectRepositories } from "../change-repositories.js";
import { PACKAGE_ROOT } from "../constants.js";
import { SddError } from "../errors.js";
import { pathExists } from "../fs.js";

const TEMPLATE_FILES = Object.freeze([
  ["proposal.md", join(PACKAGE_ROOT, "skills", "sdd-change", "assets", "proposal-template.md")],
  ["design.md", join(PACKAGE_ROOT, "skills", "sdd-change", "assets", "design-template.md")],
  ["tasks.md", join(PACKAGE_ROOT, "skills", "sdd-change", "assets", "tasks-template.md")],
]);

function normalizePath(value) {
  return value.split("\\").join("/");
}

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
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function renderTemplate(source, { title, changeId, plannedPath, repositories }) {
  const repositoryLines = repositories.length > 0
    ? repositories.map(
      (repository) => `- \`${repository.resolvedPath}\`${repository.role ? ` (${repository.role})` : ""}`,
    )
    : ["- None selected; this Space has no mapped implementation repository yet."];
  let rendered = source
    .replaceAll("CHANGE TITLE", title)
    .replaceAll("yyyy-mm-dd-change-name", changeId);

  if (rendered.startsWith("# Proposal:")) {
    rendered = rendered.replace(
      "## Target Repositories\n\n- TBD.",
      `## Target Repositories\n\n${repositoryLines.join("\n")}`,
    );
    rendered = rendered.replace(
      "- Planned location: not applicable",
      `- Planned location: \`${plannedPath}\``,
    );
  }
  if (rendered.startsWith("---\nstatus: proposed\n---")) {
    rendered = rendered.replace(
      /- Expected dirty files: `[^`]+`/,
      `- Expected dirty files: \`${plannedPath}/\``,
    );
  }
  return rendered;
}

export async function createPlannedChange(
  startPath,
  spaceId,
  slug,
  { date = null, repositories = [], dryRun = false } = {},
) {
  const workspaceRoot = await findWorkspaceRoot(startPath);
  const config = await readConfig(workspaceRoot);
  assertValidConfig(config, "create a planned Change");
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
  const planningPath = resolveIdeaPlanningPath(config, spaceId, space);
  const plannedPath = normalizePath(
    join(planningPath, config.planning.plannedChangesDirectory, changeId),
  );
  const absolutePath = resolveWorkspacePath(workspaceRoot, plannedPath);
  if (await pathExists(absolutePath)) {
    throw new SddError(`Planned Change already exists: ${plannedPath}`, { code: "CHANGE_EXISTS" });
  }

  const selectedRepositories = selectRepositories(
    resolvedActiveRepositories(config, space),
    repositories,
  );
  const title = changeTitle(slug);
  const files = TEMPLATE_FILES.map(([name]) => name);

  if (!dryRun) {
    const parent = dirname(absolutePath);
    const temporaryPath = join(parent, `.${changeId}.sdd-new-${process.pid}-${Date.now()}`);
    await mkdir(parent, { recursive: true });
    await mkdir(temporaryPath);
    try {
      for (const [name, templatePath] of TEMPLATE_FILES) {
        const source = await readFile(templatePath, "utf8");
        await writeFile(
          join(temporaryPath, name),
          renderTemplate(source, {
            title,
            changeId,
            plannedPath,
            repositories: selectedRepositories,
          }),
          "utf8",
        );
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
    dryRun,
    spaceId,
    changeId,
    title,
    path: relativeWorkspacePath(workspaceRoot, absolutePath),
    repositories: selectedRepositories,
    files,
  };
}
