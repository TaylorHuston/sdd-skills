import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { promisify } from "node:util";
import { parseDocument } from "yaml";

const execFileAsync = promisify(execFile);

function normalizePath(value) {
  return value.split("\\").join("/");
}

function parseEpic(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;
  const document = parseDocument(match[1]);
  if (document.errors.length > 0) return null;
  const frontmatter = document.toJS();
  if (!frontmatter || typeof frontmatter !== "object") return null;
  return {
    frontmatter,
    body: source.slice(match[0].length),
  };
}

function substantiveEpic(source) {
  const parsed = parseEpic(source);
  if (!parsed) return source;
  const frontmatter = { ...parsed.frontmatter };
  delete frontmatter.modified;
  delete frontmatter.last_verified;
  return `${JSON.stringify(frontmatter)}\n${parsed.body}`;
}

function localDate() {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
}

export async function resolveChangedFrom(repositoryRoot, ref) {
  try {
    const { stdout: insideWorkTree } = await execFileAsync(
      "git",
      ["-C", repositoryRoot, "rev-parse", "--is-inside-work-tree"],
      { timeout: 10_000 },
    );
    if (insideWorkTree.trim() !== "true") {
      return { commit: null, error: "CHANGED_FROM_GIT_UNAVAILABLE" };
    }
  } catch {
    return { commit: null, error: "CHANGED_FROM_GIT_UNAVAILABLE" };
  }
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", repositoryRoot, "rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
      { timeout: 10_000 },
    );
    return { commit: stdout.trim(), error: null };
  } catch {
    return { commit: null, error: "CHANGED_FROM_REF_NOT_FOUND" };
  }
}

async function readBaselineEpic(repositoryRoot, commit, epicPath) {
  const repositoryRelativePath = normalizePath(relative(repositoryRoot, epicPath));
  try {
    const { stdout: matches } = await execFileAsync(
      "git",
      ["-C", repositoryRoot, "ls-tree", "-r", "--name-only", commit, "--", repositoryRelativePath],
      { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 },
    );
    if (!matches.split(/\r?\n/).includes(repositoryRelativePath)) {
      return { source: null, error: null };
    }
    const { stdout } = await execFileAsync(
      "git",
      ["-C", repositoryRoot, "show", `${commit}:${repositoryRelativePath}`],
      { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 },
    );
    return { source: stdout, error: null };
  } catch {
    return { source: null, error: "CHANGED_FROM_EPIC_READ_FAILED" };
  }
}

export async function validateEpicHistory({
  repository,
  repositoryRoot,
  epicPath,
  displayPath,
  epicId,
  changedFromCommit,
}) {
  if (!changedFromCommit) return [];
  const context = {
    spaceId: repository.spaceId,
    repository: repository.resolvedPath,
    artifactType: "epic",
    artifactId: epicId,
  };
  const baselineResult = await readBaselineEpic(repositoryRoot, changedFromCommit, epicPath);
  if (baselineResult.error) {
    return [{
      level: "error",
      code: baselineResult.error,
      path: normalizePath(displayPath),
      message: "Cannot read the Epic from the selected Git baseline.",
      ...context,
    }];
  }
  if (baselineResult.source === null) return [];
  const baseline = baselineResult.source;
  const current = await readFile(epicPath, "utf8");
  if (substantiveEpic(baseline) === substantiveEpic(current)) return [];

  const baselineFrontmatter = parseEpic(baseline)?.frontmatter;
  const currentFrontmatter = parseEpic(current)?.frontmatter;
  if (!baselineFrontmatter || !currentFrontmatter) return [];
  if (currentFrontmatter.modified === baselineFrontmatter.modified
    && String(currentFrontmatter.modified) !== localDate()) {
    return [{
      level: "error",
      code: "STALE_EPIC_MODIFIED_DATE",
      path: normalizePath(displayPath),
      message: `Epic content changed from ${changedFromCommit.slice(0, 12)}, but frontmatter \`modified\` did not.`,
      ...context,
    }];
  }
  if (String(currentFrontmatter.modified) < String(baselineFrontmatter.modified)) {
    return [{
      level: "error",
      code: "EPIC_MODIFIED_DATE_REGRESSION",
      path: normalizePath(displayPath),
      message: "Epic frontmatter `modified` predates the selected Git baseline.",
      ...context,
    }];
  }
  return [];
}
