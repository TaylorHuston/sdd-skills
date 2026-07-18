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
import { isDirectory, pathExists } from "../fs.js";

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
const STORY_METADATA = Object.freeze(["Status:", "Created:", "Modified:", "Last verified:"]);
const STORY_SECTIONS = Object.freeze([
  "Requirements And Scenarios",
  "Implemented By",
  "Verified By",
  "Verification Gaps",
  "Story Notes",
]);
const IMPLEMENTED_HEADER = "| Path | Role | Recheck Trigger |";
const VERIFIED_HEADER = "| Requirement / Scenario | Evidence | Proves | Status |";
const STORY_INDEX_HEADER = "| Story | Status | Capability | Last Verified | Notes |";
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

function automatedEvidenceTestPaths(evidence) {
  const explicitlyAutomated = /\b(?:automated|e2e|end-to-end|integration|japa|jest|playwright|pytest|specs?|unit|vitest)\b/i.test(evidence);
  const genericTestEvidence = /\btests?\b/i.test(evidence) && !/\bmanual\b/i.test(evidence);
  if (!explicitlyAutomated && !genericTestEvidence) {
    return null;
  }
  const paths = [...evidence.matchAll(/`([^`]+)`/g)].map((match) =>
    normalizePath(match[1]).replace(/:\d+$/, ""));
  return [...new Set(paths.filter((path) => {
    if (!path || isAbsolute(path) || path.startsWith("../") || /\s/.test(path)) return false;
    const lowered = path.replace(/^\.\//, "").toLowerCase();
    return (
      /(?:^|\/)(?:__tests__|e2e|spec|specs|test|tests)\//.test(lowered)
      || /\.(?:spec|test)\.[a-z0-9]+$/.test(lowered)
      || /(?:^|\/)test_[^/]+\.py$/.test(lowered)
      || /(?:^|\/)[^/]+_test\.py$/.test(lowered)
    );
  }))];
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

  if (error) {
    findings.push(finding("error", "INVALID_EPIC_FRONTMATTER", displayPath, `Cannot parse Epic frontmatter: ${error}`, context));
  } else {
    const missing = EPIC_FRONTMATTER.filter((key) => !Object.hasOwn(frontmatter ?? {}, key));
    if (missing.length > 0) {
      findings.push(finding("error", "MISSING_EPIC_FRONTMATTER", displayPath, `Missing frontmatter keys: ${missing.join(", ")}.`, context));
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

    const metadataWindow = story.lines.slice(1, 14);
    const missingMetadata = STORY_METADATA.filter((key) =>
      !metadataWindow.some((line) => line.startsWith(key)));
    if (missingMetadata.length > 0) {
      findings.push(finding("error", "MISSING_STORY_METADATA", storyPath, `Missing Story metadata: ${missingMetadata.join(", ")}.`, context));
    }
    const storyHeadings = new Set(
      story.lines.filter((line) => line.startsWith("#### ")).map((line) => line.slice(5).trim()),
    );
    const missingStorySections = STORY_SECTIONS.filter((heading) => !storyHeadings.has(heading));
    if (missingStorySections.length > 0) {
      findings.push(finding("error", "MISSING_STORY_SECTION", storyPath, `Missing Story sections: ${missingStorySections.join(", ")}.`, context));
    }

    const implemented = sectionLines(story.lines, "Implemented By");
    if (firstTableHeader(implemented) !== IMPLEMENTED_HEADER) {
      findings.push(finding("error", "INVALID_IMPLEMENTED_BY_TABLE", storyPath, `Implemented By must use ${IMPLEMENTED_HEADER}.`, context));
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
    for (const row of tableRows(verified)) {
      const reference = row[0] ?? "";
      const evidence = row[1] ?? "";
      const ids = [...reference.matchAll(/(?:^|\/)R\d+(?:-S\d+)?/g)]
        .map((match) => match[0].replace(/^\//, ""));
      if (ids.length === 0) {
        findings.push(finding("error", "INVALID_EVIDENCE_REFERENCE", storyPath, `Verified By row has no Requirement or Scenario reference: ${reference || "(empty)"}.`, context));
      } else {
        for (const id of ids) {
          if (!knownEvidenceIds.has(id)) {
            findings.push(finding("error", "BROKEN_EVIDENCE_REFERENCE", storyPath, `Verified By references unknown ${story.label}/${id}.`, context));
          }
        }
      }
      const automatedTestPaths = automatedEvidenceTestPaths(evidence);
      if (automatedTestPaths?.length === 0) {
        findings.push(finding(
          "warning",
          "GENERIC_AUTOMATED_EVIDENCE",
          storyPath,
          `Verified By automated evidence for ${reference || "(unmapped)"} must name a concrete repository-relative test path: ${evidence || "(empty)"}.`,
          context,
        ));
      }
      for (const testPath of automatedTestPaths ?? []) {
        const absoluteTestPath = resolve(repositoryRoot, testPath.replace(/^\.\//, ""));
        const relativeTestPath = normalizePath(relative(repositoryRoot, absoluteTestPath));
        if (relativeTestPath.startsWith("../") || !(await pathExists(absoluteTestPath))) {
          findings.push(finding(
            "warning",
            "MISSING_AUTOMATED_EVIDENCE_PATH",
            storyPath,
            `Verified By automated test path for ${reference || "(unmapped)"} does not exist in the repository: ${testPath}.`,
            context,
          ));
        }
      }
    }
  }

  const declaredStories = Array.isArray(frontmatter?.stories) ? frontmatter.stories.map(String) : [];
  const actualStories = stories.map((story) => story.label);
  if (declaredStories.length > 0 && (
    declaredStories.length !== actualStories.length
    || declaredStories.some((label) => !actualStories.includes(label))
  )) {
    findings.push(finding("error", "EPIC_STORY_INDEX_DRIFT", displayPath, "Frontmatter stories do not match promoted Story sections.", context));
  }
  const storyIndex = headingSection(lines, 2, "Story Index");
  if (firstTableHeader(storyIndex) !== STORY_INDEX_HEADER) {
    findings.push(finding("error", "INVALID_STORY_INDEX_TABLE", displayPath, `Story Index must use ${STORY_INDEX_HEADER}.`, context));
  } else {
    const indexedStories = tableRows(storyIndex).map((row) =>
      (row[0] ?? "").replaceAll("`", "").trim());
    if (
      indexedStories.length !== actualStories.length
      || indexedStories.some((label) => !actualStories.includes(label))
    ) {
      findings.push(finding("error", "EPIC_STORY_INDEX_DRIFT", displayPath, "Story Index rows do not match promoted Story sections.", context));
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

async function validateRepository(workspaceRoot, config, repository, { changeId, epicId } = {}) {
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
  const epicRecords = [];
  if (!changeId || affectedEpicDirectories.size > 0) {
    const epicRoot = join(repositoryPath, artifacts.epics);
    const availableEpicDirectories = await listDirectories(epicRoot);
    const epicDirectories = changeId
      ? [...affectedEpicDirectories].filter((directory) => availableEpicDirectories.includes(directory))
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
  { spaceId = null, repositories = [], changeId = null, epicId = null } = {},
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
  const repositoryChangeLocations = [];
  for (const repository of selectedRepositories) {
    const result = await validateRepository(workspaceRoot, config, repository, { changeId, epicId });
    findings.push(...result.findings);
    changes += result.changes;
    epics += result.epics;
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
      repositories: selectedRepositories.map((repository) => repository.resolvedPath),
    },
    valid: errors === 0,
    summary: {
      repositories: selectedRepositories.length,
      plannedChanges: planned.plannedChanges,
      changes,
      epics,
      errors,
      warnings,
    },
    findings,
  };
}
