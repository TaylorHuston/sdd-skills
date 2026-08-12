import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseDocument } from "yaml";

import {
  CHANGE_STATUSES,
  LEGACY_CHANGE_STATUSES,
  isRepositoryOnlyChangeMetadata,
  parseChangeMetadata,
} from "../change-status.js";
import { isValidChangeId } from "../change-id.js";
import {
  readStoredChangesSnapshot,
  readRequiredChangeFileSnapshot,
  relativeChangeStorePath,
  REQUIRED_CHANGE_FILES,
  PLANNED_CHANGE_FILES,
  OPTIONAL_CHANGE_FILES,
  missingPlannedChangeSections,
} from "../change-store.js";
import {
  inspectRepositoryIdentity,
  repositoryMatchesSelector,
  resolvedRepositories,
  resolveRepositoriesForMetadata,
  resolveRepositoryTargets,
} from "../change-repositories.js";
import {
  assertValidConfig,
  resolveRepositoryArtifacts,
  resolveRepositoryPath,
  resolveWorkspacePath,
} from "../config.js";
import {
  isMetadataOnlyRepositorySpace,
  resolveOperationConfiguration,
  synthesizeRepositoryOnlySpaceFromChangeMetadata,
} from "../workspace.js";
import { SddError } from "../errors.js";
import { isDirectory, isPathPhysicallyInside, pathExists } from "../fs.js";
import {
  behaviorReferences,
  implementationLocationPaths,
  orderedValuesEqual,
  readRegularText,
  validateVerifiedEvidenceRow,
} from "../epic-evidence.js";
import { resolveChangedFrom, validateEpicHistory } from "../epic-history.js";
import { validateEpicVerifyReports } from "../epic-verify-report.js";

const CHANGE_FILES = Object.freeze({
  "change.md": [
    ["Why"],
    ["Desired Outcome"],
    ["Scope"],
    ["Success Signals"],
    ["Open Questions"],
  ],
  "design.md": [
    ["Context", "Current Understanding"],
    ["Selected Approach", "Technical Approach"],
    ["Risks / Trade-Offs", "Alternatives / Deferred"],
  ],
  "tasks.md": [
    ["Resume Here"],
    ["Task Checklist", "Checklist"],
    ["Implementation Ledger"],
    ["Verification Ledger"],
    ["Blockers / Open Questions", "Open Questions"],
    ["Closeout"],
  ],
});

const EPIC_FRONTMATTER = Object.freeze([
  "id",
  "status",
  "created",
  "modified",
  "last_verified",
  "stories",
]);
const EPIC_V2_SCHEMA = "sdd-epic-v2";
const EPIC_SECTIONS = Object.freeze([
  "Product Context",
  "Outcome",
  "Current Scope",
  "Deferred Scope",
  "Candidate Stories",
  "Story Index",
  "Stories",
  "Cross-Story Concerns",
  "Open Decisions",
  "Completion Criteria",
  "Notes",
]);
const LEGACY_STORY_METADATA = Object.freeze(["Status:", "Created:", "Modified:", "Last verified:"]);
const V2_STORY_METADATA = Object.freeze([
  "Implementation:",
  "Verification:",
  "Created:",
  "Modified:",
  "Last verified:",
]);
const LEGACY_STORY_SECTIONS = Object.freeze([
  "Requirements And Scenarios",
  "Implemented By",
  "Verified By",
  "Verification Gaps",
  "Story Notes",
]);
const V2_STORY_SECTIONS = Object.freeze([
  "Requirements And Scenarios",
  "Implemented By",
  "Implementation Gaps",
  "Verified By",
  "Verification Gaps",
  "Story Notes",
]);
const LEGACY_IMPLEMENTED_HEADER = "| Path | Role | Recheck Trigger |";
const V2_IMPLEMENTED_HEADER = "| Requirement / Scenario | Location / Anchor | Kind | Responsibility |";
const VERIFIED_HEADER = "| Requirement / Scenario | Evidence | Proves | Status |";
const LEGACY_STORY_INDEX_HEADER = "| Story | Status | Capability | Last Verified | Notes |";
const V2_STORY_INDEX_HEADER = "| Story | Implementation | Verification | Capability | Last Verified | Notes |";
const IMPLEMENTATION_STATES = Object.freeze(["not implemented", "partial", "implemented"]);
const VERIFICATION_STATES = Object.freeze(["unverified", "partial", "verified"]);
const IMPLEMENTATION_KINDS = Object.freeze([
  "primary",
  "adapter",
  "persistence",
  "presentation",
  "configuration",
  "migration",
  "support",
]);
const TEMPLATE_PLACEHOLDERS = Object.freeze([
  "CHANGE TITLE",
  "EPIC TITLE",
  "STORY TITLE",
  "REQUIREMENT TITLE",
  "SCENARIO TITLE",
  "OPTION NAME",
  "yyyy-mm-dd-change-name",
]);

function normalizePath(value) {
  return value.split("\\").join("/");
}

function repositoryProjectionKey(repository) {
  return JSON.stringify([repository.spaceId, repository.id]);
}

function changeProjectsToRepository(record, repository) {
  return record.metadata?.space === repository.spaceId
    && Array.isArray(record.metadata.repositories)
    && record.metadata.repositories.includes(repository.id);
}

function epicImpactSource(source) {
  const lines = source.split(/\r?\n/);
  return ["Epic Impact", "Epic Actions"]
    .map((heading) => headingSection(lines, 2, heading).join("\n"))
    .find((section) => section.length > 0) ?? "";
}

function declaredEpicPaths(source) {
  const paths = new Set();
  const epicActions = epicImpactSource(source);
  for (const match of epicActions.matchAll(/`([^`]+)`/g)) {
    const path = normalizePath(match[1]).replace(/^\.\//, "");
    if (path.endsWith("/epic.md")) paths.add(path);
  }
  return paths;
}

function declaredEpicIds(source) {
  const ids = new Set();
  const epicActions = epicImpactSource(source);
  for (const match of epicActions.matchAll(/`([^`]+)`/g)) {
    if (/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/.test(match[1])) ids.add(match[1]);
  }
  return ids;
}

function declaredEpicDirectory(path, epicsDirectory) {
  const prefix = `${normalizePath(epicsDirectory).replace(/\/$/, "")}/`;
  if (!path.startsWith(prefix) || !path.endsWith("/epic.md")) return null;
  const relativePath = path.slice(prefix.length, -"/epic.md".length);
  return relativePath && !relativePath.includes("/") ? relativePath : null;
}

function declaredEpicDirectories(source, epicsDirectory) {
  return new Set(
    [...declaredEpicPaths(source)]
      .map((path) => declaredEpicDirectory(path, epicsDirectory))
      .filter(Boolean),
  );
}

function finding(level, code, path, message, context = {}) {
  return { level, code, path: normalizePath(path), message, ...context };
}

function headingsAtLevel(source, level) {
  const prefix = `${"#".repeat(level)} `;
  return new Set(
    source
      .split(/\r?\n/)
      .filter((line) => line.startsWith(prefix))
      .map((line) => line.slice(prefix.length).trim()),
  );
}

function parseFrontmatter(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { data: null, error: null };
  const document = parseDocument(match[1]);
  if (document.errors.length > 0) return { data: null, error: document.errors[0].message };
  const data = document.toJS();
  return { data: data && typeof data === "object" ? data : null, error: null };
}

function splitStoryBlocks(lines) {
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^### Story ([^:]+):\s+(.+)$/);
    if (match) starts.push({ index, label: match[1].trim(), title: match[2].trim() });
  }
  return starts.map((story, index) => ({
    ...story,
    line: story.index + 1,
    lines: lines.slice(story.index, starts[index + 1]?.index ?? lines.length),
  }));
}

function sectionLines(lines, heading) {
  const start = lines.findIndex((line) => line.trim() === `#### ${heading}`);
  if (start < 0) return [];
  const content = lines.slice(start + 1);
  const end = content.findIndex((line) => /^#{3,4}\s+/.test(line));
  return content.slice(0, end < 0 ? content.length : end);
}

function headingSection(lines, level, heading) {
  const marker = `${"#".repeat(level)} ${heading}`;
  const start = lines.findIndex((line) => line.trim() === marker);
  if (start < 0) return [];
  const content = lines.slice(start + 1);
  const end = content.findIndex((line) => new RegExp(`^#{1,${level}}\\s+`).test(line));
  return content.slice(0, end < 0 ? content.length : end);
}

function normalizeTableHeader(header) {
  const cells = header.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
  return `| ${cells.join(" | ")} |`;
}

function firstTableHeader(lines) {
  const header = lines.find((line) => line.trim().startsWith("|") && line.trim().endsWith("|"));
  return header ? normalizeTableHeader(header) : null;
}

function tableRows(lines) {
  const table = lines.filter((line) => line.trim().startsWith("|") && line.trim().endsWith("|"));
  return table.slice(2).map((line) =>
    line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()));
}

function metadataValue(lines, label) {
  const line = lines.slice(1, 16).find((entry) => entry.startsWith(`${label}:`));
  return line ? line.slice(label.length + 1).trim() : null;
}

function gapReferences(lines) {
  return lines.flatMap((line) => behaviorReferences(line));
}

function requirementCovered(requirementId, scenarioIds, references) {
  if (references.has(requirementId)) return true;
  const requirementScenarios = scenarioIds.filter((scenarioId) =>
    scenarioId.startsWith(`${requirementId}-S`));
  return requirementScenarios.length > 0
    && requirementScenarios.every((scenarioId) => references.has(scenarioId));
}

async function validateArtifactLinks(
  source,
  absolutePath,
  displayPath,
  repositoryRoot,
  artifactRoots,
  context,
) {
  const findings = [];
  const links = source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g);
  for (const match of links) {
    let target = match[1].trim().replace(/^<|>$/g, "");
    if (!target || target.startsWith("#") || isAbsolute(target) || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
      continue;
    }
    target = target.split(/\s+["']/)[0].split("#")[0].split("?")[0];
    try {
      target = decodeURIComponent(target);
    } catch {
      // Keep the literal target; path existence will produce the useful finding.
    }
    const targetPath = resolve(dirname(absolutePath), target);
    const repositoryRelative = normalizePath(relative(repositoryRoot, targetPath));
    if (!artifactRoots.some((root) =>
      repositoryRelative === root || repositoryRelative.startsWith(`${root}/`))) {
      continue;
    }
    if (!(await pathExists(targetPath))) {
      findings.push(finding(
        "error",
        "BROKEN_ARTIFACT_LINK",
        displayPath,
        `Markdown link points to a missing SDD artifact: ${repositoryRelative}.`,
        context,
      ));
    }
  }
  return findings;
}

function epicContext(repository, epicId) {
  return {
    spaceId: repository.spaceId,
    repository: repository.resolvedPath,
    artifactType: "epic",
    artifactId: epicId,
  };
}

async function validateEpic(repository, epicPath, repositoryRoot, artifactRoots, displayPath) {
  const source = await readFile(epicPath, "utf8");
  const findings = [];
  const { data: frontmatter, error } = parseFrontmatter(source);
  const epicId = frontmatter?.id ?? basename(dirname(epicPath));
  const context = epicContext(repository, epicId);
  const isV2 = frontmatter?.schema === EPIC_V2_SCHEMA;

  if (error) {
    findings.push(finding("error", "INVALID_EPIC_FRONTMATTER", displayPath, `Cannot parse Epic frontmatter: ${error}`, context));
  } else {
    const missing = EPIC_FRONTMATTER.filter((key) => !Object.hasOwn(frontmatter ?? {}, key));
    if (missing.length > 0) {
      findings.push(finding("error", "MISSING_EPIC_FRONTMATTER", displayPath, `Missing frontmatter keys: ${missing.join(", ")}.`, context));
    }
    if (!frontmatter?.schema) {
      findings.push(finding(
        "warning",
        "LEGACY_EPIC_SCHEMA",
        displayPath,
        `Epic uses the legacy unversioned shape; normalize to ${EPIC_V2_SCHEMA} when materially editing it.`,
        context,
      ));
    } else if (!isV2) {
      findings.push(finding(
        "error",
        "UNKNOWN_EPIC_SCHEMA",
        displayPath,
        `Unsupported Epic schema: ${frontmatter.schema}.`,
        context,
      ));
    }
  }

  const h1 = headingsAtLevel(source, 1);
  if (![...h1].some((heading) => heading.startsWith(`${epicId} `))) {
    findings.push(finding("error", "INVALID_ARTIFACT_TITLE", displayPath, `Epic title must begin with \`# ${epicId}\`.`, context));
  }
  const h2 = headingsAtLevel(source, 2);
  const missingSections = EPIC_SECTIONS.filter((heading) => !h2.has(heading));
  const extraSections = [...h2].filter((heading) => !EPIC_SECTIONS.includes(heading));
  if (missingSections.length > 0) {
    findings.push(finding("error", "MISSING_EPIC_SECTION", displayPath, `Missing top-level sections: ${missingSections.join(", ")}.`, context));
  }
  if (extraSections.length > 0) {
    findings.push(finding("error", "UNEXPECTED_EPIC_SECTION", displayPath, `Unexpected top-level sections: ${extraSections.join(", ")}.`, context));
  }

  const lines = source.split(/\r?\n/);
  const stories = splitStoryBlocks(lines);
  if (stories.length === 0) {
    findings.push(finding("error", "MISSING_EPIC_STORIES", displayPath, "No canonical `### Story ...` sections found.", context));
  }
  const seenStoryLabels = new Set();
  for (const story of stories) {
    const storyPath = `${displayPath}:${story.line}`;
    if (seenStoryLabels.has(story.label)) {
      findings.push(finding("error", "DUPLICATE_STORY_ID", storyPath, `Duplicate Story label: ${story.label}.`, context));
    }
    seenStoryLabels.add(story.label);
    if (!/^S\d+$/.test(story.label)) {
      const legacy = /^[A-Z][A-Z0-9]*-\d+$/.test(story.label);
      findings.push(finding(
        legacy ? "warning" : "error",
        legacy ? "LEGACY_STORY_ID" : "INVALID_STORY_ID",
        storyPath,
        legacy
          ? `Legacy Story label ${story.label}; retain only while existing references require it.`
          : `Malformed Story label: ${story.label}.`,
        context,
      ));
    }

    const metadataWindow = story.lines.slice(1, 16);
    const requiredMetadata = isV2 ? V2_STORY_METADATA : LEGACY_STORY_METADATA;
    const missingMetadata = requiredMetadata.filter((key) =>
      !metadataWindow.some((line) => line.startsWith(key)));
    if (missingMetadata.length > 0) {
      findings.push(finding("error", "MISSING_STORY_METADATA", storyPath, `Missing Story metadata: ${missingMetadata.join(", ")}.`, context));
    }
    const storyHeadings = new Set(
      story.lines.filter((line) => line.startsWith("#### ")).map((line) => line.slice(5).trim()),
    );
    const requiredStorySections = isV2 ? V2_STORY_SECTIONS : LEGACY_STORY_SECTIONS;
    const missingStorySections = requiredStorySections.filter((heading) => !storyHeadings.has(heading));
    if (missingStorySections.length > 0) {
      findings.push(finding("error", "MISSING_STORY_SECTION", storyPath, `Missing Story sections: ${missingStorySections.join(", ")}.`, context));
    }
    if (isV2) {
      const competingTraceabilityHeadings = story.lines
        .flatMap((line) => {
          const match = line.match(/^####\s+(.+)$/);
          return match ? [match[1].trim()] : [];
        })
        .filter((heading) => !V2_STORY_SECTIONS.includes(heading))
        .filter((heading) => (
          /(?:implementation|verification).*(?:map|evidence)/i.test(heading)
          || /(?:map|evidence).*(?:implementation|verification)/i.test(heading)
        ));
      for (const heading of competingTraceabilityHeadings) {
        findings.push(finding(
          "error",
          "COMPETING_TRACEABILITY_SECTION",
          storyPath,
          `Story traceability must have one canonical Implemented By map and one canonical Verified By map; consolidate competing section: ${heading}.`,
          context,
        ));
      }
    }

    const implemented = sectionLines(story.lines, "Implemented By");
    const implementedHeader = isV2 ? V2_IMPLEMENTED_HEADER : LEGACY_IMPLEMENTED_HEADER;
    if (firstTableHeader(implemented) !== implementedHeader) {
      findings.push(finding("error", "INVALID_IMPLEMENTED_BY_TABLE", storyPath, `Implemented By must use ${implementedHeader}.`, context));
    }
    const verified = sectionLines(story.lines, "Verified By");
    if (firstTableHeader(verified) !== VERIFIED_HEADER) {
      findings.push(finding("error", "INVALID_VERIFIED_BY_TABLE", storyPath, `Verified By must use ${VERIFIED_HEADER}.`, context));
    }

    const requirementIds = story.lines.flatMap((line) => {
      const match = line.match(/^##### Requirement (R\d+):\s+.+$/);
      return match ? [match[1]] : [];
    });
    const scenarioIds = story.lines.flatMap((line) => {
      const match = line.match(/^###### Scenario (R\d+-S\d+):\s+.+$/);
      return match ? [match[1]] : [];
    });
    if (isV2 && requirementIds.length === 0) {
      findings.push(finding(
        "error",
        "MISSING_STORY_REQUIREMENTS",
        storyPath,
        `Story ${story.label} must declare at least one Requirement.`,
        context,
      ));
    }
    if (isV2) {
      for (const requirementId of requirementIds) {
        if (!scenarioIds.some((scenarioId) => scenarioId.startsWith(`${requirementId}-S`))) {
          findings.push(finding(
            "error",
            "MISSING_REQUIREMENT_SCENARIOS",
            storyPath,
            `Requirement ${story.label}/${requirementId} must declare at least one Scenario.`,
            context,
          ));
        }
      }
    }
    for (const line of story.lines.filter((entry) => entry.startsWith("##### Requirement "))) {
      if (!/^##### Requirement R\d+:\s+.+$/.test(line)) {
        findings.push(finding("error", "INVALID_REQUIREMENT_ID", storyPath, `Malformed Requirement heading: ${line}.`, context));
      }
    }
    for (const line of story.lines.filter((entry) => entry.startsWith("###### Scenario "))) {
      if (!/^###### Scenario R\d+-S\d+:\s+.+$/.test(line)) {
        findings.push(finding("error", "INVALID_SCENARIO_ID", storyPath, `Malformed Scenario heading: ${line}.`, context));
      }
    }
    for (const [kind, ids] of [["REQUIREMENT", requirementIds], ["SCENARIO", scenarioIds]]) {
      const seen = new Set();
      for (const id of ids) {
        if (seen.has(id)) {
          findings.push(finding("error", `DUPLICATE_${kind}_ID`, storyPath, `Duplicate ${kind.toLowerCase()} ID: ${id}.`, context));
        }
        seen.add(id);
      }
    }
    for (const scenarioId of scenarioIds) {
      const requirementId = scenarioId.split("-")[0];
      if (!requirementIds.includes(requirementId)) {
        findings.push(finding("error", "ORPHAN_SCENARIO_ID", storyPath, `Scenario ${scenarioId} has no Requirement ${requirementId}.`, context));
      }
    }
    const knownEvidenceIds = new Set([...requirementIds, ...scenarioIds]);
    const implementedReferences = new Set();
    const primaryImplementedReferences = new Set();
    const implementationGapReferences = new Set();
    if (isV2) {
      const implementationState = metadataValue(story.lines, "Implementation");
      const verificationState = metadataValue(story.lines, "Verification");
      if (implementationState && !IMPLEMENTATION_STATES.includes(implementationState)) {
        findings.push(finding(
          "error",
          "INVALID_STORY_IMPLEMENTATION_STATE",
          storyPath,
          `Implementation must be one of: ${IMPLEMENTATION_STATES.join(", ")}.`,
          context,
        ));
      }
      if (verificationState && !VERIFICATION_STATES.includes(verificationState)) {
        findings.push(finding(
          "error",
          "INVALID_STORY_VERIFICATION_STATE",
          storyPath,
          `Verification must be one of: ${VERIFICATION_STATES.join(", ")}.`,
          context,
        ));
      }

      for (const row of tableRows(implemented)) {
        const reference = row[0] ?? "";
        const location = row[1] ?? "";
        const kind = (row[2] ?? "").toLowerCase();
        const references = behaviorReferences(reference);
        let rowUsable = true;
        if (references.length === 0) {
          rowUsable = false;
          findings.push(finding(
            "error",
            "INVALID_IMPLEMENTATION_REFERENCE",
            storyPath,
            `Implemented By row has no Requirement or Scenario reference: ${reference || "(empty)"}.`,
            context,
          ));
        }
        for (const item of references) {
          if (item.story !== story.label || !knownEvidenceIds.has(item.behavior)) {
            rowUsable = false;
            findings.push(finding(
              "error",
              "BROKEN_IMPLEMENTATION_REFERENCE",
              storyPath,
              `Implemented By references unknown ${item.story}/${item.behavior}.`,
              context,
            ));
          }
        }
        if (!IMPLEMENTATION_KINDS.includes(kind)) {
          rowUsable = false;
          findings.push(finding(
            "error",
            "INVALID_IMPLEMENTATION_KIND",
            storyPath,
            `Implemented By kind must be one of: ${IMPLEMENTATION_KINDS.join(", ")}.`,
            context,
          ));
        }
        const locations = implementationLocationPaths(location);
        if (locations.length === 0 && !/not implemented yet/i.test(location)) {
          rowUsable = false;
          findings.push(finding(
            "error",
            "MISSING_IMPLEMENTATION_LOCATION",
            storyPath,
            `Implemented By must name a repository-relative location or say Not implemented yet: ${reference || "(unmapped)"}.`,
            context,
          ));
        }
        for (const locationPath of locations) {
          if (isAbsolute(locationPath.path) || locationPath.path.startsWith("../") || /\s/.test(locationPath.path)) {
            rowUsable = false;
            findings.push(finding(
              "error",
              "INVALID_IMPLEMENTATION_PATH",
              storyPath,
              `Implemented By path must be repository-relative: ${locationPath.raw}.`,
              context,
            ));
            continue;
          }
          const absoluteImplementationPath = resolve(repositoryRoot, locationPath.path);
          const relativeImplementationPath = normalizePath(relative(repositoryRoot, absoluteImplementationPath));
          const physicallyContained = !relativeImplementationPath.startsWith("../")
            && await isPathPhysicallyInside(repositoryRoot, absoluteImplementationPath);
          if (!physicallyContained) {
            rowUsable = false;
            findings.push(finding(
              "error",
              "IMPLEMENTATION_PATH_OUTSIDE_REPOSITORY",
              storyPath,
              `Implemented By path resolves outside the repository: ${locationPath.path}.`,
              context,
            ));
          } else if (!(await pathExists(absoluteImplementationPath))) {
            rowUsable = false;
            findings.push(finding(
              "error",
              "MISSING_IMPLEMENTATION_PATH",
              storyPath,
              `Implemented By path does not exist in the repository: ${locationPath.path}.`,
              context,
            ));
          } else if (!locationPath.anchor) {
            rowUsable = false;
            findings.push(finding(
              "error",
              "MISSING_IMPLEMENTATION_ANCHOR",
              storyPath,
              `Implementation for ${reference || "(unmapped)"} must name a stable symbol or searchable anchor after #: ${locationPath.path}.`,
              context,
            ));
          } else {
            const implementationSource = await readRegularText(absoluteImplementationPath);
            if (implementationSource.error) {
              rowUsable = false;
              findings.push(finding(
                "error",
                "INVALID_IMPLEMENTATION_PATH",
                storyPath,
                `Implemented By path is not a readable regular file: ${locationPath.path} (${implementationSource.error}).`,
                context,
              ));
            } else if (!implementationSource.source.includes(locationPath.anchor)) {
              rowUsable = false;
              findings.push(finding(
                "error",
                "MISSING_IMPLEMENTATION_ANCHOR",
                storyPath,
                `Implemented By anchor was not found in ${locationPath.path}: ${locationPath.anchor}.`,
                context,
              ));
            }
          }
        }
        if (locations.length > 0 && rowUsable) {
          for (const item of references) {
            implementedReferences.add(item.behavior);
            if (kind === "primary") primaryImplementedReferences.add(item.behavior);
          }
        }
      }

      const implementationGaps = sectionLines(story.lines, "Implementation Gaps");
      for (const item of gapReferences(implementationGaps)) {
        if (item.story !== story.label || !knownEvidenceIds.has(item.behavior)) {
          findings.push(finding(
            "error",
            "BROKEN_IMPLEMENTATION_GAP_REFERENCE",
            storyPath,
            `Implementation Gaps references unknown ${item.story}/${item.behavior}.`,
            context,
          ));
        } else {
          implementationGapReferences.add(item.behavior);
        }
      }
      for (const requirementId of requirementIds) {
        const mapped = requirementCovered(requirementId, scenarioIds, implementedReferences);
        const primaryMapped = requirementCovered(requirementId, scenarioIds, primaryImplementedReferences);
        const gapped = requirementCovered(requirementId, scenarioIds, implementationGapReferences);
        if (!mapped && !gapped) {
          findings.push(finding(
            "error",
            "MISSING_IMPLEMENTATION_COVERAGE",
            storyPath,
            `Requirement ${story.label}/${requirementId} must have an Implemented By location or an Implementation Gap.`,
            context,
          ));
        } else if (mapped && !primaryMapped) {
          findings.push(finding(
            "error",
            "MISSING_PRIMARY_IMPLEMENTATION",
            storyPath,
            `Requirement ${story.label}/${requirementId} has implementation paths but no primary owner.`,
            context,
          ));
        }
      }
      const hasImplementation = implementedReferences.size > 0;
      const hasImplementationGaps = implementationGapReferences.size > 0;
      const expectedImplementationState = hasImplementation
        ? (hasImplementationGaps ? "partial" : "implemented")
        : "not implemented";
      if (implementationState && implementationState !== expectedImplementationState) {
        findings.push(finding(
          "error",
          "STORY_IMPLEMENTATION_STATE_CONTRADICTION",
          storyPath,
          `Implementation is ${implementationState}, but the implementation map and gaps imply ${expectedImplementationState}.`,
          context,
        ));
      }
      if (requirementIds.length > 6 || scenarioIds.length > 12) {
        findings.push(finding(
          "warning",
          "LARGE_STORY_SCOPE",
          storyPath,
          `Story has ${requirementIds.length} Requirements and ${scenarioIds.length} Scenarios; confirm it still represents one primary user path.`,
          context,
        ));
      }
    }

    const passingEvidenceReferences = new Set();
    const verifiedReferences = new Set();
    for (const row of tableRows(verified)) {
      const result = await validateVerifiedEvidenceRow({
        row,
        isV2,
        storyLabel: story.label,
        knownEvidenceIds,
        storyPath,
        context,
        repositoryRoot,
        createFinding: finding,
      });
      findings.push(...result.findings);
      for (const behavior of result.verifiedBehaviors) verifiedReferences.add(behavior);
      for (const behavior of result.passingBehaviors) passingEvidenceReferences.add(behavior);
    }
    if (isV2) {
      const verificationGapReferences = new Set();
      for (const item of gapReferences(sectionLines(story.lines, "Verification Gaps"))) {
        if (item.story !== story.label || !knownEvidenceIds.has(item.behavior)) {
          findings.push(finding(
            "error",
            "BROKEN_VERIFICATION_GAP_REFERENCE",
            storyPath,
            `Verification Gaps references unknown ${item.story}/${item.behavior}.`,
            context,
          ));
        } else {
          verificationGapReferences.add(item.behavior);
        }
      }
      for (const scenarioId of scenarioIds) {
        if (!verifiedReferences.has(scenarioId) && !verificationGapReferences.has(scenarioId)) {
          findings.push(finding(
            "error",
            "MISSING_VERIFICATION_COVERAGE",
            storyPath,
            `Scenario ${story.label}/${scenarioId} must have Verified By evidence or a Verification Gap.`,
            context,
          ));
        }
      }
      const verificationState = metadataValue(story.lines, "Verification");
      const allScenariosPassing = scenarioIds.length > 0
        && scenarioIds.every((scenarioId) => passingEvidenceReferences.has(scenarioId));
      const expectedVerificationState = allScenariosPassing && verificationGapReferences.size === 0
        ? "verified"
        : passingEvidenceReferences.size > 0
          ? "partial"
          : "unverified";
      if (verificationState && verificationState !== expectedVerificationState) {
        findings.push(finding(
          "error",
          "STORY_VERIFICATION_STATE_CONTRADICTION",
          storyPath,
          `Verification is ${verificationState}, but the evidence map and gaps imply ${expectedVerificationState}.`,
          context,
        ));
      }
    }
  }

  const declaredStories = Array.isArray(frontmatter?.stories) ? frontmatter.stories.map(String) : [];
  const actualStories = stories.map((story) => story.label);
  if (isV2 && !orderedValuesEqual(declaredStories, actualStories)) {
    findings.push(finding("error", "EPIC_STORY_INDEX_DRIFT", displayPath, "Frontmatter stories do not match promoted Story sections.", context));
  }
  const storyIndex = headingSection(lines, 2, "Story Index");
  const storyIndexHeader = isV2 ? V2_STORY_INDEX_HEADER : LEGACY_STORY_INDEX_HEADER;
  if (firstTableHeader(storyIndex) !== storyIndexHeader) {
    findings.push(finding("error", "INVALID_STORY_INDEX_TABLE", displayPath, `Story Index must use ${storyIndexHeader}.`, context));
  } else {
    const storyIndexRows = tableRows(storyIndex);
    const indexedStories = storyIndexRows.map((row) =>
      (row[0] ?? "").replaceAll("`", "").trim());
    if (!orderedValuesEqual(indexedStories, actualStories)) {
        findings.push(finding("error", "EPIC_STORY_INDEX_DRIFT", displayPath, "Story Index rows do not match promoted Story sections.", context));
    }
    if (isV2) {
      for (const story of stories) {
        const indexRow = storyIndexRows.find((row) =>
          (row[0] ?? "").replaceAll("`", "").trim() === story.label);
        if (!indexRow) continue;
        const bodyImplementation = metadataValue(story.lines, "Implementation") ?? "";
        const bodyVerification = metadataValue(story.lines, "Verification") ?? "";
        const bodyLastVerified = metadataValue(story.lines, "Last verified") ?? "";
        const indexImplementation = indexRow[1] ?? "";
        const indexVerification = indexRow[2] ?? "";
        const indexLastVerified = indexRow[4] ?? "";
        if (
          indexImplementation !== bodyImplementation
          || indexVerification !== bodyVerification
          || indexLastVerified !== bodyLastVerified
        ) {
          findings.push(finding(
            "error",
            "EPIC_STORY_INDEX_DRIFT",
            displayPath,
            `Story Index state for ${story.label} does not match its Story body.`,
            context,
          ));
        }
      }
    }
  }
  findings.push(...await validateArtifactLinks(
    source,
    epicPath,
    displayPath,
    repositoryRoot,
    artifactRoots,
    context,
  ));
  return {
    epicId,
    declaredEpicId: frontmatter?.id,
    storyLabels: actualStories,
    displayPath,
    findings,
  };
}

async function listDirectories(path, { exclude = [] } = {}) {
  if (!(await isDirectory(path))) return [];
  const excluded = new Set(exclude);
  return (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !excluded.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function selectConfiguredRepositories(workspaceRoot, available, requested) {
  const unique = [
    ...new Map(available.map((repository) => [repositoryProjectionKey(repository), repository])).values(),
  ];
  if (requested.length === 0) return unique;

  const selected = new Map();
  for (const value of requested) {
    const matchFlags = await Promise.all(
      unique.map((repository) =>
        repositoryMatchesSelector(workspaceRoot, repository, value)),
    );
    const matches = unique.filter((_, index) => matchFlags[index]);
    if (matches.length !== 1) {
      throw new SddError(`Unknown repository for validation: ${value}`, {
        code: "REPOSITORY_NOT_FOUND",
        details: unique.map((repository) =>
          `Available repository: ${repository.id ? `${repository.id} (${repository.resolvedPath})` : repository.resolvedPath}`),
      });
    }
    selected.set(repositoryProjectionKey(matches[0]), matches[0]);
  }
  return [...selected.values()];
}

async function directlyConfiguredRepositories(
  workspaceRoot,
  config,
  selectedSpaces,
  requested,
) {
  if (requested.length === 0) return null;
  const mapped = selectedSpaces.flatMap(([spaceId, space]) =>
    resolvedRepositories(config, space).map((repository) => ({ ...repository, spaceId })));
  const mappingKey = (repository) =>
    JSON.stringify([repository.spaceId, repository.resolvedPath]);
  const directMatches = new Map();
  const mappingsToHydrate = new Map();

  for (const value of requested) {
    const matchFlags = await Promise.all(
      mapped.map((repository) =>
        repositoryMatchesSelector(workspaceRoot, repository, value)),
    );
    const matches = mapped.filter((_, index) => matchFlags[index]);
    if (matches.length > 1) {
      throw new SddError(`Unknown repository for validation: ${value}`, {
        code: "REPOSITORY_NOT_FOUND",
        details: mapped.map((repository) =>
          `Available repository: ${repository.resolvedPath}`),
      });
    }
    if (matches.length === 1) {
      directMatches.set(value, matches[0]);
      mappingsToHydrate.set(mappingKey(matches[0]), matches[0]);
    }
  }

  for (const repository of mapped) {
    mappingsToHydrate.set(mappingKey(repository), repository);
  }
  const directMappingKeys = new Set(
    [...directMatches.values()].map((repository) => mappingKey(repository)),
  );

  const hydrated = new Map();
  const failures = [];
  for (const repository of mappingsToHydrate.values()) {
    const inspection = await inspectRepositoryIdentity(
      workspaceRoot,
      config,
      repository,
    );
    if (inspection.error) {
      if (directMappingKeys.has(mappingKey(repository))) throw inspection.error;
      failures.push({
        claimedId: inspection.claimedId,
        spaceId: repository.spaceId,
        resolvedPath: repository.resolvedPath,
        code: inspection.error instanceof SddError
          ? inspection.error.code
          : (inspection.error?.code ?? "REPOSITORY_CONFIG_UNAVAILABLE"),
      });
      continue;
    }
    hydrated.set(mappingKey(repository), inspection.target);
  }

  const selected = new Map();
  for (const value of requested) {
    const direct = directMatches.get(value);
    const matches = direct
      ? [hydrated.get(mappingKey(direct))].filter(Boolean)
      : [...hydrated.values()].filter((repository) => repository.id === value);
    if (matches.length === 1) {
      const [target] = matches;
      const healthyClaims = [...hydrated.values()].filter((repository) =>
        repository.id === target.id
        && (!direct || repository.spaceId === target.spaceId));
      const failedClaims = failures.filter((failure) =>
        failure.claimedId === target.id
        && (!direct || failure.spaceId === target.spaceId));
      const claims = [
        ...healthyClaims.map((repository) => repository.resolvedPath),
        ...failedClaims.map((failure) => failure.resolvedPath),
      ];
      const sameSpaceClaims = [
        ...healthyClaims.filter((repository) => repository.spaceId === target.spaceId),
        ...failedClaims.filter((failure) => failure.spaceId === target.spaceId),
      ];
      if (sameSpaceClaims.length > 1) {
        throw new SddError(`Repository ID ${target.id} is claimed by multiple mapped repositories.`, {
          code: "REPOSITORY_ID_COLLISION",
          details: claims,
        });
      }
      if (!direct && claims.length > 1) {
        throw new SddError(`Unknown repository for validation: ${value}`, {
          code: "REPOSITORY_NOT_FOUND",
          details: claims.map((path) => `Matched repository: ${path}`),
        });
      }
      selected.set(repositoryProjectionKey(target), target);
      continue;
    }
    if (matches.length > 1) {
      const sameSpace = matches.find((repository, index) =>
        matches.some((candidate, candidateIndex) =>
          candidateIndex !== index && candidate.spaceId === repository.spaceId));
      if (sameSpace) {
        throw new SddError(`Repository ID ${value} is claimed by multiple mapped repositories.`, {
          code: "REPOSITORY_ID_COLLISION",
          details: matches
            .filter((repository) => repository.spaceId === sameSpace.spaceId)
            .map((repository) => repository.resolvedPath),
        });
      }
      throw new SddError(`Unknown repository for validation: ${value}`, {
        code: "REPOSITORY_NOT_FOUND",
        details: matches.map((repository) =>
          `Available repository: ${repository.id} (${repository.resolvedPath})`),
      });
    }
    if (failures.length > 0) {
      throw new SddError(`Repository selector cannot be resolved while mapped identities are unavailable: ${value}`, {
        code: "REPOSITORY_ID_REQUIRED",
        details: failures.map((failure) =>
          `${failure.resolvedPath}: ${failure.code}`),
      });
    }
    throw new SddError(`Unknown repository for validation: ${value}`, {
      code: "REPOSITORY_NOT_FOUND",
      details: [...hydrated.values()].map((repository) =>
        `Available repository: ${repository.id} (${repository.resolvedPath})`),
    });
  }
  return { available: [...selected.values()], selected: [...selected.values()] };
}

async function configuredRepositories(
  workspaceRoot,
  config,
  selectedSpaces,
  requested,
  { isolateDirectSelection = false } = {},
) {
  const direct = isolateDirectSelection
    ? await directlyConfiguredRepositories(
        workspaceRoot,
        config,
        selectedSpaces,
        requested,
      )
    : null;
  if (direct) return direct;

  const available = [];
  for (const [spaceId, space] of selectedSpaces) {
    for (const repository of await resolveRepositoryTargets(workspaceRoot, config, space)) {
      available.push({ ...repository, spaceId });
    }
  }
  return {
    available,
    selected: await selectConfiguredRepositories(workspaceRoot, available, requested),
  };
}

async function validateChange({
  workspaceRoot,
  changeId,
  displayRoot,
  changePath,
  historical = false,
  afterChangeFileRead = null,
}) {
  const findings = [];
  let metadata = null;
  const requiredFiles = {};
  const context = {
    artifactType: "change",
    artifactId: changeId,
  };
  const shapeLevel = historical ? "warning" : "error";
  if (!isValidChangeId(changeId)) {
    findings.push(finding(
      "error",
      "INVALID_CHANGE_ID",
      displayRoot,
      "Change directory must use YYYY-MM-DD followed by a lowercase kebab-case slug.",
      context,
    ));
  }
  const filesToValidate = [...REQUIRED_CHANGE_FILES];
  for (let fileIndex = 0; fileIndex < filesToValidate.length; fileIndex += 1) {
    const fileName = filesToValidate[fileIndex];
    const requiredHeadingGroups = CHANGE_FILES[fileName];
    const displayPath = normalizePath(join(displayRoot, fileName));
    let snapshot;
    try {
      snapshot = await readRequiredChangeFileSnapshot(
        changePath,
        fileName,
        workspaceRoot,
        {
          afterRead: afterChangeFileRead
            ? (observation) => afterChangeFileRead({
                changeId,
                historical,
                fileName,
                ...observation,
              })
            : null,
        },
      );
    } catch (error) {
      if (
        error instanceof SddError
        && ["UNSAFE_ARTIFACT_PATH", "CONCURRENT_CHANGE"].includes(error.code)
      ) {
        requiredFiles[fileName] = {
          snapshot: null,
          source: null,
          error: { code: error.code, message: error.message },
        };
        findings.push(finding(
          "error",
          error.code,
          displayPath,
          error.code === "UNSAFE_ARTIFACT_PATH"
            ? `Change required file ${fileName} must be an owner-confined regular file.`
            : `Change required file ${fileName} changed while validation was reading it.`,
          context,
        ));
        continue;
      }
      throw error;
    }
    requiredFiles[fileName] = snapshot === null
      ? {
          snapshot: null,
          source: null,
          error: {
            code: "MISSING_CHANGE_FILE",
            message: `Change is missing ${fileName}.`,
          },
        }
      : { snapshot, source: snapshot.source, error: null };
    if (snapshot === null) {
      findings.push(finding("error", "MISSING_CHANGE_FILE", displayPath, `Change is missing ${fileName}.`, context));
      continue;
    }

    const source = snapshot.source;
    const unresolved = TEMPLATE_PLACEHOLDERS.filter((placeholder) => source.includes(placeholder));
    if (unresolved.length > 0) {
      findings.push(finding(
        historical ? "warning" : "error",
        "UNRESOLVED_TEMPLATE_PLACEHOLDER",
        displayPath,
        `Unresolved template placeholders: ${unresolved.join(", ")}.`,
        context,
      ));
    }
    const h1 = headingsAtLevel(source, 1);
    const expectedPrefix = fileName === "change.md"
      ? "Change:"
      : fileName === "design.md"
        ? "Design:"
        : "Tasks:";
    if (![...h1].some((heading) => heading.startsWith(expectedPrefix))) {
      findings.push(finding(shapeLevel, "INVALID_ARTIFACT_TITLE", displayPath, `${fileName} must have a \`# ${expectedPrefix}\` title.`, context));
    }

    const h2 = headingsAtLevel(source, 2);
    const missing = requiredHeadingGroups
      .filter((alternatives) => !alternatives.some((heading) => h2.has(heading)))
      .map((alternatives) => alternatives.join(" or "));
    if (missing.length > 0) {
      findings.push(finding(shapeLevel, "MISSING_ARTIFACT_SECTION", displayPath, `Missing required sections: ${missing.join(", ")}.`, context));
    }

    if (fileName === "change.md") {
      metadata = parseChangeMetadata(source);
      if (metadata.error) {
        findings.push(finding(
          "error",
          "INVALID_CHANGE_METADATA",
          displayPath,
          `Cannot parse Change metadata: ${metadata.error}`,
          context,
        ));
      } else if (historical && LEGACY_CHANGE_STATUSES.includes(metadata.status)) {
        // Closed history keeps the status vocabulary that was valid when it closed.
      } else if (!CHANGE_STATUSES.includes(metadata.status)) {
        findings.push(finding(
          "error",
          "INVALID_CHANGE_STATUS",
          displayPath,
          `Expected one of: ${CHANGE_STATUSES.join(", ")}.`,
          { ...context, spaceId: metadata.space },
        ));
      }
      if (!metadata.error) {
        if (metadata.status !== "proposed") {
          const hasCompatibleDesign = await pathExists(join(changePath, "design.md"));
          const missingPlanningSections = hasCompatibleDesign
            ? []
            : missingPlannedChangeSections(source);
          if (missingPlanningSections.length > 0) {
            findings.push(finding(
              shapeLevel,
              "MISSING_ARTIFACT_SECTION",
              displayPath,
              `Planned Change is missing technical planning sections: ${missingPlanningSections.join(", ")}.`,
              context,
            ));
          }
          filesToValidate.push(...PLANNED_CHANGE_FILES);
        } else {
          for (const plannedFile of PLANNED_CHANGE_FILES) {
            if (await pathExists(join(changePath, plannedFile))) {
              filesToValidate.push(plannedFile);
            }
          }
        }
        for (const optionalFile of OPTIONAL_CHANGE_FILES) {
          if (await pathExists(join(changePath, optionalFile))) {
            filesToValidate.push(optionalFile);
          }
        }
      }
    }
  }
  return { findings, metadata, requiredFiles };
}

async function resolveAffectedEpicAssignments(
  workspaceRoot,
  config,
  centralChanges,
  selectedRepositories,
  changeId,
) {
  const assignments = new Map(
    selectedRepositories.map((repository) => [
      repositoryProjectionKey(repository),
      new Set(),
    ]),
  );
  const findings = [];
  if (!changeId || centralChanges.length !== 1) return { assignments, findings };

  const [record] = centralChanges;
  const change = record.requiredFiles?.["change.md"];
  if (change?.error || typeof change?.source !== "string") {
    return { assignments, findings };
  }
  const repositories = selectedRepositories.filter((repository) =>
    changeProjectsToRepository(record, repository));
  const declarations = [
    ...[...declaredEpicPaths(change.source)].map((path) => ({
      artifactId: path.split("/").at(-2),
      path,
      type: "path",
    })),
    ...[...declaredEpicIds(change.source)].map((id) => ({
      artifactId: id,
      path: id,
      type: "id",
    })),
  ];
  for (const declaration of declarations) {
    const candidates = [];
    for (const repository of repositories) {
      const artifacts = resolveRepositoryArtifacts(config, repository);
      const repositoryPath = resolveWorkspacePath(workspaceRoot, repository.resolvedPath);
      const epicRoot = join(repositoryPath, artifacts.epics);
      const directories = declaration.type === "path"
        ? [declaredEpicDirectory(declaration.path, artifacts.epics)].filter(Boolean)
        : (await listDirectories(epicRoot)).filter((directory) => {
            const normalizedDirectory = directory.toLowerCase();
            const normalizedId = declaration.artifactId.toLowerCase();
            return normalizedDirectory === normalizedId
              || normalizedDirectory.startsWith(`${normalizedId}-`);
          });
      for (const directory of directories) {
        if (!(await isDirectory(join(epicRoot, directory)))) continue;
        candidates.push({ repository, directory });
      }
    }
    const { artifactId } = declaration;
    if (candidates.length === 0) {
      findings.push(finding(
        "error",
        "AFFECTED_EPIC_NOT_FOUND",
        declaration.path,
        `Change ${changeId} declares an affected Epic that does not exist in any selected repository: ${artifactId}.`,
        {
          spaceId: record.metadata?.space,
          artifactType: "epic",
          artifactId,
        },
      ));
      continue;
    }
    if (candidates.length > 1) {
      findings.push(finding(
        "error",
        "AFFECTED_EPIC_AMBIGUOUS",
        declaration.path,
        `Change ${changeId} declares an affected Epic that matches multiple selected repositories: ${artifactId}.`,
        {
          spaceId: record.metadata?.space,
          artifactType: "epic",
          artifactId,
          repositories: [...new Set(candidates.map((candidate) =>
            candidate.repository.resolvedPath))]
            .sort((left, right) => left.localeCompare(right)),
        },
      ));
      continue;
    }
    const [{ repository, directory }] = candidates;
    assignments.get(repositoryProjectionKey(repository)).add(directory);
  }
  return { assignments, findings };
}

async function validateRepository(
  workspaceRoot,
  config,
  repository,
  {
    centralChanges = [],
    changeId,
    epicId,
    epicDirectory,
    changedFrom,
    affectedEpicDirectories: resolvedAffectedEpicDirectories = null,
  } = {},
) {
  const findings = [];
  const repositoryPath = resolveWorkspacePath(workspaceRoot, repository.resolvedPath);
  let repositoryIsDirectory;
  try {
    repositoryIsDirectory = (await stat(repositoryPath)).isDirectory();
  } catch (error) {
    if (!["ENOENT", "ENOTDIR"].includes(error?.code)) throw error;
    repositoryIsDirectory = false;
  }
  if (!repositoryIsDirectory) {
    return {
      findings: [finding("error", "REPOSITORY_NOT_FOUND", repository.resolvedPath, "Configured repository does not exist.", {
        spaceId: repository.spaceId,
        repository: repository.resolvedPath,
      })],
      epics: 0,
      epicVerificationReports: 0,
    };
  }
  const artifacts = resolveRepositoryArtifacts(config, repository);
  const artifactRoots = Object.values(artifacts).map(normalizePath);
  const targetedChanges = centralChanges.filter((record) =>
    changeProjectsToRepository(record, repository));
  const affectedEpicDirectories = new Set(resolvedAffectedEpicDirectories ?? []);
  if (changeId && resolvedAffectedEpicDirectories === null) {
    for (const record of targetedChanges) {
      const change = record.requiredFiles?.["change.md"];
      if (change?.error || typeof change?.source !== "string") continue;
      for (const directory of declaredEpicDirectories(change.source, artifacts.epics)) {
        affectedEpicDirectories.add(directory);
      }
    }
  }

  let epics = 0;
  let epicVerificationReports = 0;
  const epicRecords = [];
  let changedFromCommit = null;
  if (changedFrom) {
    const resolved = await resolveChangedFrom(repositoryPath, changedFrom);
    changedFromCommit = resolved.commit;
    if (resolved.error) {
      findings.push(finding(
        "error",
        resolved.error,
        repository.resolvedPath,
        `Cannot resolve --changed-from ${changedFrom} in this repository.`,
        { spaceId: repository.spaceId, repository: repository.resolvedPath },
      ));
    }
  }
  if (!changeId || affectedEpicDirectories.size > 0) {
    const epicRoot = join(repositoryPath, artifacts.epics);
    const availableEpicDirectories = await listDirectories(epicRoot);
    const normalizedEpicId = epicId?.toLowerCase();
    const epicDirectories = epicDirectory
      ? availableEpicDirectories.includes(epicDirectory) ? [epicDirectory] : []
      : changeId
        ? [...affectedEpicDirectories].filter((directory) => availableEpicDirectories.includes(directory))
        : epicId
          ? availableEpicDirectories.filter((directory) => {
            const normalizedDirectory = directory.toLowerCase();
            return normalizedDirectory === normalizedEpicId
              || normalizedDirectory.startsWith(`${normalizedEpicId}-`);
          })
          : availableEpicDirectories;
    if (changeId) {
      for (const directory of affectedEpicDirectories) {
        if (availableEpicDirectories.includes(directory)) continue;
        findings.push(finding(
          "error",
          "AFFECTED_EPIC_NOT_FOUND",
          normalizePath(join(
            repository.resolvedPath,
            artifacts.epics,
            directory,
            "epic.md",
          )),
          `Change ${changeId} declares an affected Epic that does not exist: ${directory}.`,
          {
            spaceId: repository.spaceId,
            repository: repository.resolvedPath,
            artifactType: "epic",
            artifactId: directory,
          },
        ));
      }
    }
    for (const directory of epicDirectories) {
      const epicPath = join(epicRoot, directory, "epic.md");
      if (!(await pathExists(epicPath))) {
        findings.push(finding(
          "error",
          "MISSING_EPIC_FILE",
          normalizePath(join(repository.resolvedPath, artifacts.epics, directory, "epic.md")),
          "Epic directory is missing epic.md.",
          {
            spaceId: repository.spaceId,
            repository: repository.resolvedPath,
            artifactType: "epic",
            artifactId: directory,
          },
        ));
        continue;
      }
      const displayPath = normalizePath(join(
        repository.resolvedPath,
        artifacts.epics,
        directory,
        "epic.md",
      ));
      const result = await validateEpic(
        repository,
        epicPath,
        repositoryPath,
        artifactRoots,
        displayPath,
      );
      if (!epicDirectory && epicId && result.epicId !== epicId && directory !== epicId) {
        continue;
      }
      if (epicDirectory && result.epicId !== epicId) {
        findings.push(finding(
          "error",
          "EPIC_ID_MISMATCH",
          displayPath,
          `Epic frontmatter ID ${result.epicId} does not match requested Epic ID ${epicId}.`,
          epicContext(repository, epicId),
        ));
      }
      findings.push(...result.findings);
      findings.push(...await validateEpicHistory({
        repository,
        repositoryRoot: repositoryPath,
        epicPath,
        displayPath,
        epicId: result.epicId,
        changedFromCommit,
      }));
      const reportResult = await validateEpicVerifyReports({
        repository,
        repositoryRoot: repositoryPath,
        epicPath,
        epicId: result.epicId,
      });
      findings.push(...reportResult.findings);
      epicVerificationReports += reportResult.reports;
      epicRecords.push(result);
      epics += 1;
    }
    if (epicDirectory && epicRecords.length === 1) {
      const exactEpic = epicRecords[0];
      if (typeof exactEpic.declaredEpicId === "string") {
        for (const directory of availableEpicDirectories) {
          if (directory === epicDirectory) continue;
          const candidatePath = join(epicRoot, directory, "epic.md");
          if (!(await pathExists(candidatePath))) continue;
          const candidate = parseFrontmatter(await readFile(candidatePath, "utf8"));
          if (candidate.error || candidate.data?.id !== exactEpic.declaredEpicId) continue;
          findings.push(finding(
            "error",
            "DUPLICATE_EPIC_ID",
            exactEpic.displayPath,
            `Epic ID ${exactEpic.declaredEpicId} is also declared in ${normalizePath(join(
              repository.resolvedPath,
              artifacts.epics,
              directory,
              "epic.md",
            ))}.`,
            epicContext(repository, exactEpic.declaredEpicId),
          ));
        }
      }
    }
  }
  const seenEpicIds = new Map();
  const seenLegacyStoryIds = new Map();
  for (const epic of epicRecords) {
    if (seenEpicIds.has(epic.epicId)) {
      findings.push(finding(
        "error",
        "DUPLICATE_EPIC_ID",
        epic.displayPath,
        `Epic ID ${epic.epicId} is also declared in ${seenEpicIds.get(epic.epicId)}.`,
        epicContext(repository, epic.epicId),
      ));
    } else {
      seenEpicIds.set(epic.epicId, epic.displayPath);
    }
    for (const storyId of epic.storyLabels.filter((label) => /^[A-Z][A-Z0-9]*-\d+$/.test(label))) {
      if (seenLegacyStoryIds.has(storyId)) {
        findings.push(finding(
          "error",
          "DUPLICATE_LEGACY_STORY_ID",
          epic.displayPath,
          `Legacy Story ID ${storyId} is also declared in ${seenLegacyStoryIds.get(storyId)}.`,
          epicContext(repository, epic.epicId),
        ));
      } else {
        seenLegacyStoryIds.set(storyId, epic.displayPath);
      }
    }
  }
  return {
    findings,
    epics,
    epicVerificationReports,
  };
}

async function validateCentralRecords(
  records,
  workspaceRoot,
  selectedSpaceIds,
  {
    changeId,
    availableRepositories = [],
    configuredSpaceIds = new Set(),
    repositoryOnlySpaceIds = new Set(),
    validateRepositoryOwnership = true,
    afterChangeFileRead = null,
  } = {},
) {
  const findings = [];
  const changes = [];
  const locations = new Map();
  for (const record of records) {
    if (changeId && record.changeId !== changeId) continue;
    const previous = locations.get(record.changeId);
    if (previous) {
      findings.push(finding(
        "error",
        "CHANGE_LOCATION_COLLISION",
        relativeChangeStorePath(record.path, workspaceRoot),
        `Change exists in active and closed central locations: ${record.changeId}.`,
        { artifactType: "change", artifactId: record.changeId },
      ));
    } else {
      locations.set(record.changeId, record);
    }
    const result = await validateChange({
      workspaceRoot,
      changeId: record.changeId,
      displayRoot: relativeChangeStorePath(record.path, workspaceRoot),
      changePath: record.path,
      historical: record.closed,
      afterChangeFileRead,
    });
    const metadataSpace = result.metadata?.space;
    const configuredSpace = metadataSpace && configuredSpaceIds.has(metadataSpace);
    const repositoryOnlyContext = metadataSpace
      && repositoryOnlySpaceIds.has(metadataSpace);
    const repositoryOnlyMetadata = isRepositoryOnlyChangeMetadata(result.metadata);
    const metadataOnlyRepositorySpace = Boolean(
      metadataSpace && !configuredSpace && repositoryOnlyMetadata,
    );
    if (
      metadataSpace
      && (!configuredSpace || repositoryOnlyContext)
      && !repositoryOnlyMetadata
    ) {
      findings.push(finding(
        "error",
        "SPACE_NOT_FOUND",
        relativeChangeStorePath(join(record.path, "change.md"), workspaceRoot),
        `Change references unknown Space ID ${metadataSpace}.`,
        {
          artifactType: "change",
          artifactId: record.changeId,
          spaceId: metadataSpace,
        },
      ));
    } else if (metadataOnlyRepositorySpace) {
      findings.push(finding(
        "warning",
        "REPOSITORY_LOCATOR_UNAVAILABLE",
        relativeChangeStorePath(join(record.path, "change.md"), workspaceRoot),
        `Repository-only Space ${result.metadata.space} has no configured repository locator; central Change artifacts were validated, but the implementation projection is unavailable.`,
        {
          artifactType: "change",
          artifactId: record.changeId,
          spaceId: result.metadata.space,
          repositoryId: result.metadata.space,
        },
      ));
    }
    if (
      selectedSpaceIds
      && result.metadata?.space
      && !selectedSpaceIds.has(result.metadata.space)
    ) {
      continue;
    }
    findings.push(...result.findings);
    changes.push({
      ...record,
      metadata: result.metadata,
      requiredFiles: result.requiredFiles,
    });
    if (
      validateRepositoryOwnership
      && !result.metadata?.error
      && Array.isArray(result.metadata.repositories)
      && !metadataOnlyRepositorySpace
    ) {
      const ownedRepositoryIds = new Set(
        availableRepositories
          .filter((repository) => repository.spaceId === result.metadata.space)
          .map((repository) => repository.id),
      );
      for (const repositoryId of [...result.metadata.repositories]
        .sort((left, right) => left.localeCompare(right))) {
        if (ownedRepositoryIds.has(repositoryId)) continue;
        findings.push(finding(
          "error",
          "REPOSITORY_NOT_FOUND",
          relativeChangeStorePath(join(record.path, "change.md"), workspaceRoot),
          `Change references repository ID ${repositoryId}, which is not owned by Space ${result.metadata.space}.`,
          {
            artifactType: "change",
            artifactId: record.changeId,
            spaceId: result.metadata.space,
            repositoryId,
          },
        ));
      }
    }
  }
  return { findings, changes };
}

async function validateCentralChanges(
  workspaceRoot,
  selectedSpaceIds,
  options = {},
) {
  try {
    return await readStoredChangesSnapshot(
      workspaceRoot,
      (records) => validateCentralRecords(
        records,
        workspaceRoot,
        selectedSpaceIds,
        options,
      ),
      {
        afterInventory: options.afterStoredChangesInventory ?? null,
        listOptions: {
          afterClosedInventory: options.afterClosedChangeInventory ?? null,
        },
      },
    );
  } catch (error) {
    if (!(error instanceof SddError) || error.code !== "UNSAFE_ARTIFACT_PATH") {
      throw error;
    }
    const findings = [];
    const unsafePaths = [...new Set(
      error.details.filter((detail) => typeof detail === "string" && detail.length > 0),
    )].sort((left, right) => left.localeCompare(right));
    for (const path of unsafePaths.length > 0 ? unsafePaths : [".sdd/changes"]) {
      findings.push(finding(
        "error",
        "UNSAFE_ARTIFACT_PATH",
        path,
        "Central Change store must use real directories at its fixed workspace paths.",
        { artifactType: "change" },
      ));
    }
    return { findings, changes: [] };
  }
}

function missingChangeRepositoryFinding(workspaceRoot, record, repositoryId) {
  return finding(
    "error",
    "REPOSITORY_NOT_FOUND",
    relativeChangeStorePath(join(record.path, "change.md"), workspaceRoot),
    `Change references repository ID ${repositoryId}, which is not owned by Space ${record.metadata.space}.`,
    {
      artifactType: "change",
      artifactId: record.changeId,
      spaceId: record.metadata.space,
      repositoryId,
    },
  );
}

async function targetedChangeRepositories(
  workspaceRoot,
  config,
  central,
  requestedRepositories,
  expectedSpaceId,
) {
  if (central.changes.length !== 1) return [];
  const [record] = central.changes;
  const { metadata } = record;
  if (expectedSpaceId && metadata?.space !== expectedSpaceId) return [];
  if (
    metadata?.error
    || !Array.isArray(metadata?.repositories)
    || !Object.hasOwn(config.ideas ?? {}, metadata.space)
  ) {
    return [];
  }

  const space = config.ideas[metadata.space];
  if (isMetadataOnlyRepositorySpace(space)) {
    const unknownSelectors = requestedRepositories.filter(
      (selector) => selector !== metadata.space,
    );
    if (unknownSelectors.length > 0) {
      throw new SddError(`Unknown repository for validation: ${unknownSelectors[0]}`, {
        code: "REPOSITORY_NOT_FOUND",
        details: [`Available repository ID without a configured locator: ${metadata.space}`],
      });
    }
    return [];
  }

  const available = [];
  for (const repositoryId of [...metadata.repositories]
    .sort((left, right) => left.localeCompare(right))) {
    try {
      const [repository] = await resolveRepositoriesForMetadata(
        workspaceRoot,
        config,
        config.ideas[metadata.space],
        [repositoryId],
      );
      available.push({ ...repository, spaceId: metadata.space });
    } catch (error) {
      if (!(error instanceof SddError) || error.code !== "REPOSITORY_NOT_FOUND") throw error;
      central.findings.push(missingChangeRepositoryFinding(
        workspaceRoot,
        record,
        repositoryId,
      ));
    }
  }
  return selectConfiguredRepositories(
    workspaceRoot,
    available,
    requestedRepositories,
  );
}

export async function validateArtifacts(
  startPath,
  {
    spaceId = null,
    repositories = [],
    changeId = null,
    epicId = null,
    epicDirectory = null,
    repositoryProjection = null,
    changedFrom = null,
    workspaceRoot: requestedWorkspaceRoot = null,
    afterChangeFileRead = null,
    afterClosedChangeInventory = null,
    afterStoredChangesInventory = null,
  } = {},
) {
  const { workspaceRoot, config } = await resolveOperationConfiguration(
    startPath,
    requestedWorkspaceRoot ? { workspaceRoot: requestedWorkspaceRoot } : {},
  );
  assertValidConfig(config, "validate SDD artifacts");
  if (changeId && epicId) {
    throw new SddError("Use either --change or --epic, not both.", { code: "USAGE" });
  }
  if (epicDirectory && !epicId) {
    throw new SddError("An exact Epic directory requires an Epic ID.", { code: "USAGE" });
  }
  if (epicDirectory
    && (basename(epicDirectory) !== epicDirectory || [".", ".."].includes(epicDirectory))) {
    throw new SddError("An exact Epic directory must be one repository-local directory name.", {
      code: "USAGE",
    });
  }
  if (repositoryProjection && (!epicId || changeId)) {
    throw new SddError("An exact repository projection is only valid for Epic validation.", {
      code: "USAGE",
    });
  }

  const configuredSpaceIds = new Set(Object.keys(config.ideas ?? {}));
  const repositoryOnlySpaceIds = new Set(
    Object.entries(config.ideas ?? {})
      .filter(([, space]) => space?._repositoryOnly === true)
      .map(([id]) => id),
  );
  let selectedSpaces = Object.entries(config.ideas ?? {});
  if (spaceId) {
    const space = Object.hasOwn(config.ideas ?? {}, spaceId)
      ? config.ideas[spaceId]
      : null;
    if (!space && !changeId) {
      throw new SddError(`Unknown Space ID: ${spaceId}`, {
        code: "SPACE_NOT_FOUND",
        details: Object.keys(config.ideas).sort().map((id) => `Available Space ID: ${id}`),
      });
    }
    if (space) selectedSpaces = [[spaceId, space]];
  }

  const selectedSpaceIds = spaceId ? new Set([spaceId]) : null;
  let central;
  let selectedRepositories;
  if (repositoryProjection) {
    if (typeof repositoryProjection.resolvedPath !== "string") {
      throw new SddError("An exact repository projection requires a resolved path.", {
        code: "USAGE",
      });
    }
    central = { findings: [], changes: [] };
    selectedRepositories = [{
      ...repositoryProjection,
      spaceId: repositoryProjection.spaceId ?? spaceId,
    }];
  } else if (changeId) {
    central = await validateCentralChanges(workspaceRoot, null, {
      changeId,
      configuredSpaceIds,
      repositoryOnlySpaceIds,
      validateRepositoryOwnership: false,
      afterChangeFileRead,
      afterClosedChangeInventory,
      afterStoredChangesInventory,
    });
    for (const record of central.changes) {
      synthesizeRepositoryOnlySpaceFromChangeMetadata(config, record.metadata);
    }
    if (spaceId && !Object.hasOwn(config.ideas ?? {}, spaceId)) {
      throw new SddError(`Unknown Space ID: ${spaceId}`, {
        code: "SPACE_NOT_FOUND",
        details: Object.keys(config.ideas).sort().map((id) => `Available Space ID: ${id}`),
      });
    }
    if (spaceId) {
      const matchingChanges = central.changes.filter(
        (record) => record.metadata?.space === spaceId,
      );
      if (matchingChanges.length > 0) {
        central.changes = matchingChanges;
      } else if (central.changes.length === 1 && central.changes[0].metadata?.space) {
        const [record] = central.changes;
        central.findings.push(finding(
          "error",
          "CHANGE_SPACE_MISMATCH",
          relativeChangeStorePath(join(record.path, "change.md"), workspaceRoot),
          `Change belongs to Space ${record.metadata?.space ?? "unknown"}, not ${spaceId}.`,
          {
            artifactType: "change",
            artifactId: record.changeId,
            spaceId,
          },
        ));
      }
    }
    selectedRepositories = await targetedChangeRepositories(
      workspaceRoot,
      config,
      central,
      repositories,
      spaceId,
    );
  } else {
    const repositorySelection = await configuredRepositories(
      workspaceRoot,
      config,
      selectedSpaces,
      repositories,
      { isolateDirectSelection: Boolean(epicId) },
    );
    central = epicId
      ? { findings: [], changes: [] }
      : await validateCentralChanges(workspaceRoot, selectedSpaceIds, {
          availableRepositories: repositorySelection.available,
          configuredSpaceIds,
          repositoryOnlySpaceIds,
          afterChangeFileRead,
          afterClosedChangeInventory,
          afterStoredChangesInventory,
        });
    selectedRepositories = repositorySelection.selected;
  }
  const findings = [...central.findings];
  const affectedEpics = await resolveAffectedEpicAssignments(
    workspaceRoot,
    config,
    central.changes,
    selectedRepositories,
    changeId,
  );
  findings.push(...affectedEpics.findings);
  let epics = 0;
  let epicVerificationReports = 0;
  for (const repository of selectedRepositories) {
    const result = await validateRepository(workspaceRoot, config, repository, {
      centralChanges: central.changes,
      changeId,
      epicId,
      epicDirectory,
      changedFrom,
      affectedEpicDirectories: changeId
        ? affectedEpics.assignments.get(repositoryProjectionKey(repository)) ?? new Set()
        : null,
    });
    findings.push(...result.findings);
    epics += result.epics;
    epicVerificationReports += result.epicVerificationReports;
  }

  if (changeId && central.changes.length === 0) {
    findings.push(finding("error", "ARTIFACT_NOT_FOUND", changeId, `Change was not found: ${changeId}.`, {
      spaceId,
      artifactType: "change",
      artifactId: changeId,
    }));
  }
  if (epicId && epics === 0) {
    findings.push(finding("error", "ARTIFACT_NOT_FOUND", epicId, `Epic was not found: ${epicId}.`, {
      spaceId,
      artifactType: "epic",
      artifactId: epicId,
    }));
  }

  const errors = findings.filter((entry) => entry.level === "error").length;
  const warnings = findings.filter((entry) => entry.level === "warning").length;
  return {
    command: "validate",
    workspaceRoot,
    scope: {
      spaceId,
      changeId,
      epicId,
      changedFrom,
      repositories: selectedRepositories.map((repository) => repository.resolvedPath),
    },
    valid: errors === 0,
    summary: {
      repositories: selectedRepositories.length,
      changes: central.changes.length,
      epics,
      epicVerificationReports,
      errors,
      warnings,
    },
    findings,
  };
}
