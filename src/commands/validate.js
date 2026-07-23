import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseDocument } from "yaml";

import {
  CHANGE_STATUSES,
  LEGACY_CHANGE_STATUSES,
  parseChangeStatus,
} from "../change-status.js";
import { isValidChangeId } from "../change-id.js";
import {
  assertValidConfig,
  resolveIdeaPlanningPath,
  resolveRepositoryArtifacts,
  resolveRepositoryPath,
  resolveWorkspacePath,
} from "../config.js";
import { resolveOperationConfiguration } from "../workspace.js";
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
  "proposal.md": [
    ["Why"],
    ["What Changes", "Interactive Scope Boundary"],
    ["Impact", "Epic / Story Impact"],
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

function declaredEpicDirectories(source, epicsDirectory) {
  const prefix = `${normalizePath(epicsDirectory).replace(/\/$/, "")}/`;
  const directories = new Set();
  const epicActions = headingSection(source.split(/\r?\n/), 2, "Epic Actions").join("\n");
  for (const match of epicActions.matchAll(/`([^`]+)`/g)) {
    const path = normalizePath(match[1]).replace(/^\.\//, "");
    if (!path.startsWith(prefix) || !path.endsWith("/epic.md")) continue;
    const relativePath = path.slice(prefix.length, -"/epic.md".length);
    if (relativePath && !relativePath.includes("/")) directories.add(relativePath);
  }
  return directories;
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
  return { epicId, storyLabels: actualStories, displayPath, findings };
}

async function listDirectories(path, { exclude = [] } = {}) {
  if (!(await isDirectory(path))) return [];
  const excluded = new Set(exclude);
  return (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !excluded.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function configuredRepositories(config, selectedSpaces, requested) {
  const available = selectedSpaces.flatMap(([spaceId, space]) =>
    (space.repositories ?? []).map((repository) => ({
      ...repository,
      spaceId,
      resolvedPath: normalizePath(resolveRepositoryPath(config, repository)),
    })),
  );

  if (requested.length === 0) {
    return [...new Map(available.map((repository) => [repository.resolvedPath, repository])).values()];
  }

  const selected = new Map();
  for (const value of requested) {
    const matches = available.filter(
      (repository) => repository.path === value || repository.resolvedPath === value,
    );
    if (matches.length !== 1) {
      throw new SddError(`Unknown repository for validation: ${value}`, {
        code: "REPOSITORY_NOT_FOUND",
        details: available.map((repository) => `Available repository: ${repository.resolvedPath}`),
      });
    }
    selected.set(matches[0].resolvedPath, matches[0]);
  }
  return [...selected.values()];
}

async function validateChange({
  spaceId,
  repository = null,
  changeId,
  displayRoot,
  changePath,
  planned = false,
  historical = false,
  repositoryRoot = null,
  artifactRoots = [],
}) {
  const findings = [];
  const context = {
    spaceId,
    ...(repository ? { repository } : {}),
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
  for (const [fileName, requiredHeadingGroups] of Object.entries(CHANGE_FILES)) {
    const absolutePath = join(changePath, fileName);
    const displayPath = normalizePath(join(displayRoot, fileName));
    if (!(await pathExists(absolutePath))) {
      findings.push(finding("error", "MISSING_CHANGE_FILE", displayPath, `Change is missing ${fileName}.`, context));
      continue;
    }

    const source = await readFile(absolutePath, "utf8");
    const unresolved = TEMPLATE_PLACEHOLDERS.filter((placeholder) => source.includes(placeholder));
    if (unresolved.length > 0) {
      findings.push(finding(
        planned || historical ? "warning" : "error",
        "UNRESOLVED_TEMPLATE_PLACEHOLDER",
        displayPath,
        `Unresolved template placeholders: ${unresolved.join(", ")}.`,
        context,
      ));
    }
    const h1 = headingsAtLevel(source, 1);
    const expectedPrefix = fileName === "proposal.md"
      ? "Proposal:"
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

    if (fileName === "tasks.md") {
      const { status, error } = parseChangeStatus(source);
      if (error) {
        findings.push(finding("error", "INVALID_CHANGE_STATUS", displayPath, `Cannot parse Change status: ${error}`, context));
      } else if (historical && LEGACY_CHANGE_STATUSES.includes(status)) {
        // Closed history keeps the status vocabulary that was valid when it closed.
      } else if (!CHANGE_STATUSES.includes(status)) {
        findings.push(finding("error", "INVALID_CHANGE_STATUS", displayPath, `Expected one of: ${CHANGE_STATUSES.join(", ")}.`, context));
      } else if (planned && !["proposed", "planned"].includes(status)) {
        findings.push(finding(
          "error",
          "CHANGE_STATUS_LOCATION_MISMATCH",
          displayPath,
          `Private planned Changes must use status proposed or planned, found ${status}.`,
          context,
        ));
      }
    }
    if (repositoryRoot) {
      findings.push(...await validateArtifactLinks(
        source,
        absolutePath,
        displayPath,
        repositoryRoot,
        artifactRoots,
        context,
      ));
    }
  }
  return findings;
}

async function validateRepository(
  workspaceRoot,
  config,
  repository,
  { changeId, epicId, changedFrom } = {},
) {
  const findings = [];
  const repositoryPath = resolveWorkspacePath(workspaceRoot, repository.resolvedPath);
  if (!(await isDirectory(repositoryPath))) {
    return {
      findings: [finding("error", "REPOSITORY_NOT_FOUND", repository.resolvedPath, "Configured repository does not exist.", {
        spaceId: repository.spaceId,
        repository: repository.resolvedPath,
      })],
      changes: 0,
      epics: 0,
      epicVerificationReports: 0,
      changeLocations: [],
    };
  }

  const artifacts = resolveRepositoryArtifacts(config, repository);
  const activeRoot = join(repositoryPath, artifacts.activeChanges);
  const closedRoot = join(repositoryPath, artifacts.closedChanges);
  const artifactRoots = [
    artifacts.activeChanges,
    artifacts.closedChanges,
    artifacts.epics,
  ].map(normalizePath);
  const closedIsNested = dirname(closedRoot) === activeRoot;
  const activeIds = epicId
    ? []
    : await listDirectories(activeRoot, { exclude: closedIsNested ? [basename(closedRoot)] : [] });
  const closedIds = epicId ? [] : await listDirectories(closedRoot);
  const collisions = activeIds.filter((id) => closedIds.includes(id));
  for (const id of collisions) {
    if (!changeId || id === changeId) {
      findings.push(finding(
        "error",
        "CHANGE_LOCATION_COLLISION",
        normalizePath(join(repository.resolvedPath, artifacts.activeChanges, id)),
        "Change exists in both active and closed locations.",
        {
          spaceId: repository.spaceId,
          repository: repository.resolvedPath,
          artifactType: "change",
          artifactId: id,
        },
      ));
    }
  }
  const candidates = [
    ...activeIds.map((id) => ({ id, location: artifacts.activeChanges, path: join(activeRoot, id) })),
    ...closedIds.map((id) => ({ id, location: artifacts.closedChanges, path: join(closedRoot, id) })),
  ].filter((candidate) => !changeId || candidate.id === changeId);

  for (const candidate of candidates) {
    findings.push(...await validateChange({
      spaceId: repository.spaceId,
      repository: repository.resolvedPath,
      changeId: candidate.id,
      displayRoot: normalizePath(join(repository.resolvedPath, candidate.location, candidate.id)),
      changePath: candidate.path,
      historical: candidate.location === artifacts.closedChanges,
      repositoryRoot: repositoryPath,
      artifactRoots,
    }));
  }

  const affectedEpicDirectories = new Set();
  if (changeId) {
    for (const candidate of candidates) {
      const proposalPath = join(candidate.path, "proposal.md");
      if (!(await pathExists(proposalPath))) continue;
      const proposal = await readFile(proposalPath, "utf8");
      for (const directory of declaredEpicDirectories(
        proposal,
        artifacts.epics,
      )) {
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
    const epicDirectories = changeId
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
      if (epicId && result.epicId !== epicId && directory !== epicId) {
        continue;
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
    changes: candidates.length,
    epics,
    epicVerificationReports,
    changeLocations: candidates.map((candidate) => ({
      spaceId: repository.spaceId,
      repository: repository.resolvedPath,
      changeId: candidate.id,
      path: normalizePath(join(repository.resolvedPath, candidate.location, candidate.id)),
    })),
  };
}

async function validatePlannedChanges(workspaceRoot, config, selectedSpaces, { changeId } = {}) {
  const findings = [];
  const changeLocations = [];
  let plannedChanges = 0;
  for (const [spaceId, space] of selectedSpaces) {
    const planningPath = normalizePath(resolveIdeaPlanningPath(config, spaceId, space));
    const plannedRoot = normalizePath(join(planningPath, config.planning.plannedChangesDirectory));
    const plannedAbsoluteRoot = resolveWorkspacePath(workspaceRoot, plannedRoot);
    const ids = (await listDirectories(plannedAbsoluteRoot)).filter((id) => !changeId || id === changeId);
    for (const id of ids) {
      changeLocations.push({ spaceId, changeId: id, path: normalizePath(join(plannedRoot, id)) });
      findings.push(...await validateChange({
        spaceId,
        changeId: id,
        displayRoot: normalizePath(join(plannedRoot, id)),
        changePath: join(plannedAbsoluteRoot, id),
        planned: true,
      }));
    }
    plannedChanges += ids.length;
  }
  return { findings, plannedChanges, changeLocations };
}

export async function validateArtifacts(
  startPath,
  {
    spaceId = null,
    repositories = [],
    changeId = null,
    epicId = null,
    changedFrom = null,
  } = {},
) {
  const { workspaceRoot, config } = await resolveOperationConfiguration(startPath);
  assertValidConfig(config, "validate SDD artifacts");
  if (changeId && epicId) {
    throw new SddError("Use either --change or --epic, not both.", { code: "USAGE" });
  }

  let selectedSpaces = Object.entries(config.ideas ?? {});
  if (spaceId) {
    const space = config.ideas[spaceId];
    if (!space) {
      throw new SddError(`Unknown Space ID: ${spaceId}`, {
        code: "SPACE_NOT_FOUND",
        details: Object.keys(config.ideas).sort().map((id) => `Available Space ID: ${id}`),
      });
    }
    selectedSpaces = [[spaceId, space]];
  }

  const selectedRepositories = configuredRepositories(config, selectedSpaces, repositories);
  const findings = [];
  const planned = epicId
    ? { findings: [], plannedChanges: 0, changeLocations: [] }
    : await validatePlannedChanges(workspaceRoot, config, selectedSpaces, { changeId });
  findings.push(...planned.findings);
  let changes = 0;
  let epics = 0;
  let epicVerificationReports = 0;
  const repositoryChangeLocations = [];
  for (const repository of selectedRepositories) {
    const result = await validateRepository(workspaceRoot, config, repository, {
      changeId,
      epicId,
      changedFrom,
    });
    findings.push(...result.findings);
    changes += result.changes;
    epics += result.epics;
    epicVerificationReports += result.epicVerificationReports;
    repositoryChangeLocations.push(...result.changeLocations);
  }

  for (const plannedLocation of planned.changeLocations) {
    const promoted = repositoryChangeLocations.filter((location) =>
      location.spaceId === plannedLocation.spaceId && location.changeId === plannedLocation.changeId);
    if (promoted.length > 0) {
      findings.push(finding(
        "error",
        "CHANGE_LOCATION_COLLISION",
        plannedLocation.path,
        `Change exists in planning and repository locations: ${promoted.map((entry) => entry.path).join(", ")}.`,
        {
          spaceId: plannedLocation.spaceId,
          artifactType: "change",
          artifactId: plannedLocation.changeId,
        },
      ));
    }
  }

  if (changeId && changes === 0 && planned.plannedChanges === 0) {
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
      plannedChanges: planned.plannedChanges,
      changes,
      epics,
      epicVerificationReports,
      errors,
      warnings,
    },
    findings,
  };
}
