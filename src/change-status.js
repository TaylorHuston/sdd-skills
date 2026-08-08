import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDocument } from "yaml";

import {
  listStoredChanges,
  relativeChangeStorePath,
} from "./change-store.js";
import { getUserRoot } from "./config.js";
import { pathExists } from "./fs.js";

export const CHANGE_STATUSES = Object.freeze([
  "proposed",
  "planned",
  "in_progress",
  "in_review",
]);

export const LEGACY_CHANGE_STATUSES = Object.freeze([
  "review",
  "replanning",
  "ready_to_close",
]);

export const CHANGE_STATUS_TRANSITIONS = Object.freeze({
  proposed: Object.freeze(["planned"]),
  planned: Object.freeze(["proposed", "in_progress"]),
  in_progress: Object.freeze(["proposed", "in_review"]),
  in_review: Object.freeze(["proposed", "in_progress"]),
});

const REPOSITORY_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function canTransitionChangeStatus(from, to) {
  return CHANGE_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

function frontmatterDocument(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { match: null, document: null, error: "missing YAML frontmatter" };
  const document = parseDocument(match[1]);
  if (document.errors.length > 0) {
    return { match, document, error: document.errors[0].message };
  }
  const value = document.toJS();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { match, document, error: "frontmatter must be a mapping" };
  }
  return { match, document, value, error: null };
}

export function replaceChangeStatus(source, nextStatus) {
  const parsed = frontmatterDocument(source);
  if (parsed.error) return null;
  const statusLines = [...parsed.match[1].matchAll(/^status:\s*.*$/gm)];
  if (statusLines.length !== 1) return null;
  const updatedFrontmatter = parsed.match[1].replace(
    /^status:\s*.*$/m,
    `status: ${nextStatus}`,
  );
  const updatedBlock = parsed.match[0].replace(parsed.match[1], updatedFrontmatter);
  return `${updatedBlock}${source.slice(parsed.match[0].length)}`;
}

export function parseChangeStatus(source) {
  const parsed = frontmatterDocument(source);
  if (parsed.error === "missing YAML frontmatter") return { status: null, error: null };
  if (parsed.error) return { status: null, error: parsed.error };
  return { status: parsed.value.status ?? null, error: null };
}

function validateOwnership(space, repositories) {
  if (typeof space !== "string" || space.trim().length === 0) {
    return "frontmatter space must be a non-empty Space ID";
  }
  if (!Array.isArray(repositories)) {
    return "frontmatter repositories must be a list of repository IDs";
  }
  const seen = new Set();
  for (const repositoryId of repositories) {
    if (typeof repositoryId !== "string" || !REPOSITORY_ID_PATTERN.test(repositoryId)) {
      return "frontmatter repositories must contain portable lowercase repository IDs";
    }
    if (seen.has(repositoryId)) {
      return `frontmatter repositories contains duplicate repository ID ${repositoryId}`;
    }
    seen.add(repositoryId);
  }
  return null;
}

export function parseChangeMetadata(source) {
  const parsed = frontmatterDocument(source);
  if (parsed.error) {
    return { status: null, space: null, repositories: null, error: parsed.error };
  }
  if (typeof parsed.value.status !== "string" || parsed.value.status.length === 0) {
    return {
      status: parsed.value.status ?? null,
      space: parsed.value.space ?? null,
      repositories: parsed.value.repositories ?? null,
      error: "frontmatter must contain exactly one non-empty status",
    };
  }
  const ownershipError = validateOwnership(parsed.value.space, parsed.value.repositories);
  return {
    status: parsed.value.status,
    space: parsed.value.space ?? null,
    repositories: parsed.value.repositories ?? null,
    error: ownershipError,
  };
}

export function setChangeMetadata(source, { space, repositories }) {
  if (validateOwnership(space, repositories)) return null;
  const parsed = frontmatterDocument(source);
  if (parsed.error || typeof parsed.value.status !== "string" || parsed.value.status.length === 0) {
    return null;
  }
  parsed.document.set("space", space);
  parsed.document.set("repositories", [...repositories]);
  const updatedFrontmatter = parsed.document.toString({ lineWidth: 0 }).trimEnd();
  const updatedBlock = parsed.match[0].replace(parsed.match[1], updatedFrontmatter);
  return `${updatedBlock}${source.slice(parsed.match[0].length)}`;
}

export async function inspectChangeStatuses(workspaceRoot, config, userRoot = getUserRoot()) {
  const findings = [];
  const records = await listStoredChanges(userRoot);
  const locations = new Map();
  for (const record of records) {
    const previous = locations.get(record.changeId);
    if (previous) {
      findings.push({
        level: "error",
        message: `Change exists in both active and closed central locations: ${record.changeId}.`,
      });
    } else {
      locations.set(record.changeId, record);
    }

    const tasksPath = join(record.path, "tasks.md");
    const displayPath = relativeChangeStorePath(tasksPath, userRoot);
    if (!(await pathExists(tasksPath))) {
      findings.push({ level: "error", message: `Change is missing tasks.md: ${displayPath}.` });
      continue;
    }
    const metadata = parseChangeMetadata(await readFile(tasksPath, "utf8"));
    if (metadata.error) {
      findings.push({ level: "error", message: `Cannot parse Change metadata in ${displayPath}: ${metadata.error}` });
      continue;
    }
    if (!CHANGE_STATUSES.includes(metadata.status)
      && !(record.closed && LEGACY_CHANGE_STATUSES.includes(metadata.status))) {
      findings.push({
        level: "error",
        message: `Invalid Change status ${JSON.stringify(metadata.status)} in ${displayPath}. Expected one of: ${CHANGE_STATUSES.join(", ")}.`,
      });
    }
    if (!Object.hasOwn(config.ideas ?? {}, metadata.space)) {
      findings.push({ level: "error", message: `Change references unknown Space ${metadata.space}: ${displayPath}.` });
    }
  }
  return findings;
}
