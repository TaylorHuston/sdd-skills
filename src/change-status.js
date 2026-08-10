import { join } from "node:path";
import { parseDocument } from "yaml";

import {
  readStoredChangesSnapshot,
  readRequiredChangeFileSnapshot,
  relativeChangeStorePath,
} from "./change-store.js";

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

export function isRepositoryOnlyChangeMetadata(metadata) {
  return metadata?.error === null
    && typeof metadata.space === "string"
    && Array.isArray(metadata.repositories)
    && metadata.repositories.length === 1
    && metadata.repositories[0] === metadata.space;
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

export async function inspectChangeStatuses(
  workspaceRoot,
  config,
  repositoryIdsBySpace = null,
  {
    afterChangeFileRead = null,
    afterClosedChangeInventory = null,
    afterStoredChangesInventory = null,
  } = {},
) {
  return readStoredChangesSnapshot(
    workspaceRoot,
    async (records) => {
      const findings = [];
      const configuredSpaceIds = new Set(Object.keys(config.ideas ?? {}));
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
        const displayPath = relativeChangeStorePath(tasksPath, workspaceRoot);
        const tasksSnapshot = await readRequiredChangeFileSnapshot(
          record.path,
          "tasks.md",
          workspaceRoot,
          {
            afterRead: afterChangeFileRead
              ? (observation) => afterChangeFileRead({
                  changeId: record.changeId,
                  closed: record.closed,
                  fileName: "tasks.md",
                  ...observation,
                })
              : null,
          },
        );
        if (tasksSnapshot === null) {
          findings.push({ level: "error", message: `Change is missing tasks.md: ${displayPath}.` });
          continue;
        }
        const metadata = parseChangeMetadata(tasksSnapshot.source);
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
        const configuredSpace = configuredSpaceIds.has(metadata.space);
        const repositoryOnlyContext = configuredSpace
          && config.ideas[metadata.space]?._repositoryOnly === true;
        const repositoryOnlyMetadata = isRepositoryOnlyChangeMetadata(metadata);
        if ((!configuredSpace || repositoryOnlyContext) && !repositoryOnlyMetadata) {
          findings.push({
            level: "error",
            code: "SPACE_NOT_FOUND",
            message: `Change references unknown Space ${metadata.space}: ${displayPath}.`,
          });
          continue;
        }
        if (!configuredSpace && repositoryOnlyMetadata) {
          findings.push({
            level: "warning",
            code: "REPOSITORY_LOCATOR_UNAVAILABLE",
            spaceId: metadata.space,
            repositoryId: metadata.space,
            message: `Repository-only Space ${metadata.space} has no configured repository locator; central Change metadata is available, but its implementation projection cannot be inspected: ${displayPath}. Run repository-scoped commands from that checkout with --workspace, or configure an explicit mapping before inspecting implementation artifacts.`,
          });
          continue;
        }
        if (repositoryIdsBySpace === null) continue;
        const ownedRepositoryIds = repositoryIdsBySpace.get(metadata.space) ?? new Set();
        for (const repositoryId of [...metadata.repositories].sort(
          (left, right) => left.localeCompare(right),
        )) {
          if (ownedRepositoryIds.has(repositoryId)) continue;
          findings.push({
            level: "error",
            code: "REPOSITORY_NOT_FOUND",
            message: `Change references repository ID ${repositoryId}, which is not owned by Space ${metadata.space}: ${displayPath}.`,
          });
        }
      }
      return findings;
    },
    {
      afterInventory: afterStoredChangesInventory,
      listOptions: {
        afterClosedInventory: afterClosedChangeInventory,
      },
    },
  );
}
