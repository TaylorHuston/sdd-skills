const SLICE_ID_PATTERN = /^S[1-9]\d*$/;
const REPOSITORY_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const EPIC_SCOPED_STORY_REFERENCE = "[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*\\/S[1-9]\\d*";
const LEGACY_STORY_REFERENCE = "[A-Z][A-Z0-9]*-\\d+";
const STORY_REFERENCE_SOURCE = `(?:${EPIC_SCOPED_STORY_REFERENCE}|${LEGACY_STORY_REFERENCE})`;
const REQUIREMENT_REFERENCE_PATTERN = new RegExp(`^(${STORY_REFERENCE_SOURCE} R[1-9]\\d*)$`);
const STORY_REFERENCE_PATTERN = new RegExp(`^(${STORY_REFERENCE_SOURCE})$`);
const SCENARIO_REFERENCE_PATTERN = new RegExp(`^(${STORY_REFERENCE_SOURCE} R[1-9]\\d*-S[1-9]\\d*)$`);

export const REQUIREMENT_SLICE_STATUSES = Object.freeze([
  "ready",
  "in progress",
  "done",
  "blocked",
  "deferred",
]);

export const IMPLEMENTATION_LEDGER_STATUSES = Object.freeze([
  "not started",
  "in progress",
  "done",
  "blocked",
  "deferred",
]);

const REQUIRED_SCALAR_FIELDS = Object.freeze([
  "Status",
  "Repository",
  "Outcome",
  "Scenarios",
  "Dependencies",
  "Binding constraints",
  "Verification intent",
  "Manual acceptance",
]);

const REQUIRED_LIST_FIELDS = Object.freeze(["Requirements", "Story changes"]);
const OPTIONAL_SCALAR_FIELDS = Object.freeze(["Consumes", "Produces"]);
const RESUME_REQUIRED_FIELDS = Object.freeze([
  "Change",
  "Current slice",
  "Phase",
  "Verification candidate",
  "Review candidate",
  "Epic-update candidate",
  "Changelog candidate",
  "Acceptance candidate",
  "Open finding / blocker",
]);
const RESUME_ENVELOPE_HEADER = Object.freeze([
  "Repository",
  "Root",
  "Baseline",
  "Candidate kind",
  "Candidate watermark",
]);
const LEDGER_HEADER = Object.freeze([
  "Slice",
  "Repository",
  "Status",
  "Implementation Summary / Changed Surface",
  "Updated",
]);

function normalizeLines(source) {
  return source.replace(/\r\n?/g, "\n").split("\n");
}

function visibleMarkdownLines(source) {
  const lines = normalizeLines(source);
  let fenced = false;
  return lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return "";
    }
    return fenced ? "" : line;
  });
}

function headingRanges(lines, heading, level = 2) {
  const marker = `${"#".repeat(level)} ${heading}`;
  const starts = lines.flatMap((line, index) => line.trim() === marker ? [index] : []);
  return starts.map((start) => {
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      const match = /^(#{1,6})\s+/.exec(lines[index]);
      if (match && match[1].length <= level) {
        end = index;
        break;
      }
    }
    return { start, end, lines: lines.slice(start + 1, end) };
  });
}

function headingRange(lines, heading, level = 2) {
  const [range] = headingRanges(lines, heading, level);
  const start = range?.start ?? -1;
  if (start < 0) return null;
  return range;
}

function parseInlineCode(value) {
  const trimmed = value.trim();
  const match = /^`([^`]+)`$/.exec(trimmed);
  return match ? match[1] : trimmed;
}

function splitTableRow(line) {
  if (!line.trim().startsWith("|") || !line.trim().endsWith("|")) return null;
  return line.trim().slice(1, -1).split("|").map((cell) => cell.trim());
}

function isTableSeparator(cells) {
  return cells !== null && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseFirstTable(lines) {
  const start = lines.findIndex((line) => splitTableRow(line) !== null);
  if (start < 0) return null;
  const header = splitTableRow(lines[start]);
  const separator = splitTableRow(lines[start + 1] ?? "");
  if (!isTableSeparator(separator)) return { header, rows: [], malformed: true };
  const rows = [];
  for (let index = start + 2; index < lines.length; index += 1) {
    const cells = splitTableRow(lines[index]);
    if (cells === null) {
      if (lines[index].trim().length === 0) continue;
      break;
    }
    rows.push(cells);
  }
  return { header, rows, malformed: false };
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function issue(code, message, context = {}) {
  return { code, message, ...context };
}

function parseSliceBlock(block) {
  const scalar = new Map();
  const list = new Map();
  const counts = new Map();
  let currentList = null;
  for (const line of block.lines) {
    const field = /^- ([A-Za-z][A-Za-z /-]*):(?:\s*(.*))?$/.exec(line);
    if (field) {
      const name = field[1].trim();
      counts.set(name, (counts.get(name) ?? 0) + 1);
      currentList = REQUIRED_LIST_FIELDS.includes(name) ? name : null;
      if (currentList) list.set(name, []);
      else scalar.set(name, (field[2] ?? "").trim());
      continue;
    }
    const entry = /^  - (.+)$/.exec(line);
    if (entry && currentList) {
      list.get(currentList).push(entry[1].trim());
      continue;
    }
    if (line.trim().length > 0) currentList = null;
  }
  return { ...block, scalar, list, counts };
}

function extractBacktickReferences(value) {
  return [...value.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function parseLabeledReference(entry, allowedLabels, pattern) {
  const match = new RegExp(`^(${allowedLabels.join("|")}): \\x60([^\\x60]+)\\x60 — (.+)$`).exec(entry);
  if (!match || !pattern.test(match[2]) || match[3].trim().length === 0) return null;
  return { kind: match[1], reference: match[2], summary: match[3].trim() };
}

function expectedLedgerStatus(sliceStatus) {
  return sliceStatus === "ready" ? "not started" : sliceStatus;
}

function dependencyCycles(slices) {
  const graph = new Map(slices.map((slice) => [slice.id, slice.dependencies ?? []]));
  const visiting = new Set();
  const visited = new Set();
  const cycles = [];
  function visit(id, path) {
    if (visiting.has(id)) {
      const start = path.indexOf(id);
      cycles.push([...path.slice(start), id]);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of graph.get(id) ?? []) {
      if (graph.has(dependency)) visit(dependency, [...path, id]);
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of graph.keys()) visit(id, []);
  return cycles;
}

export function parseStructuredChangeTasks(source, {
  changeId = null,
  repositoryIds = [],
} = {}) {
  const lines = visibleMarkdownLines(source);
  const structuredHeadings = ["Resume Here", "Requirement Slices", "Implementation Ledger"];
  const headingCounts = new Map(
    structuredHeadings.map((heading) => [heading, headingRanges(lines, heading).length]),
  );
  const slicesSection = headingRange(lines, "Requirement Slices");
  if (slicesSection === null) {
    return { structured: false, slices: [], ledger: [], resume: null, issues: [] };
  }

  const issues = [];
  for (const [heading, count] of headingCounts) {
    if (count !== 1) {
      issues.push(issue("INVALID_REQUIREMENT_SLICE", `Structured tasks must contain exactly one ## ${heading} section.`));
    }
  }
  const blocks = [];
  for (let index = slicesSection.start + 1; index < slicesSection.end; index += 1) {
    const match = /^###\s+([^:]+):\s*(.*)$/.exec(lines[index]);
    if (!match) continue;
    const blockEnd = (() => {
      for (let next = index + 1; next < slicesSection.end; next += 1) {
        if (/^###\s+/.test(lines[next])) return next;
      }
      return slicesSection.end;
    })();
    blocks.push({
      id: match[1].trim(),
      title: match[2].trim(),
      line: index + 1,
      lines: lines.slice(index + 1, blockEnd),
    });
    index = blockEnd - 1;
  }
  if (blocks.length === 0) {
    issues.push(issue("INVALID_REQUIREMENT_SLICE", "Requirement Slices must contain at least one `### S#: <title>` block."));
  }

  const seenSliceIds = new Set();
  const slices = [];
  for (const raw of blocks) {
    const slice = parseSliceBlock(raw);
    if (!SLICE_ID_PATTERN.test(slice.id) || slice.title.length === 0) {
      issues.push(issue("INVALID_REQUIREMENT_SLICE", `Invalid Requirement slice heading at line ${slice.line}; expected \`### S#: <title>\`.`));
    }
    if (seenSliceIds.has(slice.id)) {
      issues.push(issue("INVALID_REQUIREMENT_SLICE", `Duplicate Requirement slice ID ${slice.id}.`, { sliceId: slice.id }));
    }
    seenSliceIds.add(slice.id);

    for (const field of [...REQUIRED_SCALAR_FIELDS, ...REQUIRED_LIST_FIELDS]) {
      const count = slice.counts.get(field) ?? 0;
      if (count !== 1) {
        issues.push(issue("INVALID_REQUIREMENT_SLICE", `${slice.id} must contain exactly one ${field} field.`, { sliceId: slice.id }));
      }
    }
    for (const field of OPTIONAL_SCALAR_FIELDS) {
      if ((slice.counts.get(field) ?? 0) > 1) {
        issues.push(issue("INVALID_REQUIREMENT_SLICE", `${slice.id} may contain at most one ${field} field.`, { sliceId: slice.id }));
      }
    }

    const status = slice.scalar.get("Status") ?? "";
    const repository = parseInlineCode(slice.scalar.get("Repository") ?? "");
    if (!REQUIREMENT_SLICE_STATUSES.includes(status)) {
      issues.push(issue("INVALID_REQUIREMENT_SLICE", `${slice.id} has invalid status ${JSON.stringify(status)}.`, { sliceId: slice.id }));
    }
    if (!REPOSITORY_ID_PATTERN.test(repository) || !repositoryIds.includes(repository)) {
      issues.push(issue("INVALID_SLICE_REFERENCE", `${slice.id} repository ${JSON.stringify(repository)} is not selected by change.md.`, { sliceId: slice.id }));
    }

    const requirements = [];
    for (const entry of slice.list.get("Requirements") ?? []) {
      const parsed = parseLabeledReference(entry, ["New", "Revised"], REQUIREMENT_REFERENCE_PATTERN);
      if (!parsed) {
        issues.push(issue("INVALID_SLICE_REFERENCE", `${slice.id} has an invalid Requirement entry: ${entry}`, { sliceId: slice.id }));
      } else requirements.push(parsed);
    }
    if (requirements.length === 0) {
      issues.push(issue("INVALID_SLICE_REFERENCE", `${slice.id} must declare at least one new or revised Requirement.`, { sliceId: slice.id }));
    }

    const stories = [];
    for (const entry of slice.list.get("Story changes") ?? []) {
      const parsed = parseLabeledReference(entry, ["Create", "Update"], STORY_REFERENCE_PATTERN);
      if (!parsed) {
        issues.push(issue("INVALID_SLICE_REFERENCE", `${slice.id} has an invalid Story change entry: ${entry}`, { sliceId: slice.id }));
      } else stories.push(parsed);
    }
    if (stories.length === 0) {
      issues.push(issue("INVALID_SLICE_REFERENCE", `${slice.id} must declare at least one Story create or update action.`, { sliceId: slice.id }));
    }

    const scenarios = extractBacktickReferences(slice.scalar.get("Scenarios") ?? "");
    if (scenarios.length === 0 || scenarios.some((reference) => !SCENARIO_REFERENCE_PATTERN.test(reference))) {
      issues.push(issue("INVALID_SLICE_REFERENCE", `${slice.id} must cite one or more full Scenario references.`, { sliceId: slice.id }));
    }
    const requirementSet = new Set(requirements.map((entry) => entry.reference));
    const storySet = new Set(stories.map((entry) => entry.reference));
    for (const scenario of scenarios) {
      const requirement = scenario.replace(/-S[1-9]\d*$/, "");
      const story = scenario.replace(/ R[1-9]\d*-S[1-9]\d*$/, "");
      if (!requirementSet.has(requirement)) {
        issues.push(issue("INVALID_SLICE_REFERENCE", `${slice.id} Scenario ${scenario} does not belong to a Requirement declared by the slice.`, { sliceId: slice.id }));
      }
      if (!storySet.has(story)) {
        issues.push(issue("INVALID_SLICE_REFERENCE", `${slice.id} Scenario ${scenario} does not belong to a Story action declared by the slice.`, { sliceId: slice.id }));
      }
    }

    for (const field of ["Outcome", "Binding constraints", "Verification intent", "Manual acceptance"]) {
      if ((slice.scalar.get(field) ?? "").trim().length === 0) {
        issues.push(issue("INVALID_REQUIREMENT_SLICE", `${slice.id} ${field} must be non-empty.`, { sliceId: slice.id }));
      }
    }
    for (const field of OPTIONAL_SCALAR_FIELDS) {
      if (slice.counts.has(field) && (slice.scalar.get(field) ?? "").trim().length === 0) {
        issues.push(issue("INVALID_REQUIREMENT_SLICE", `${slice.id} ${field} must be non-empty when present.`, { sliceId: slice.id }));
      }
    }

    const dependencySource = slice.scalar.get("Dependencies") ?? "";
    let dependencies = [];
    if (dependencySource !== "none") {
      dependencies = dependencySource.split(",").map((value) => parseInlineCode(value.trim())).filter(Boolean);
      if (dependencies.length === 0 || dependencies.some((dependency) => !SLICE_ID_PATTERN.test(dependency))) {
        issues.push(issue("INVALID_SLICE_DEPENDENCY", `${slice.id} dependencies must be \`none\` or comma-separated slice IDs.`, { sliceId: slice.id }));
      }
      if (new Set(dependencies).size !== dependencies.length) {
        issues.push(issue("INVALID_SLICE_DEPENDENCY", `${slice.id} contains duplicate dependencies.`, { sliceId: slice.id }));
      }
      if (dependencies.includes(slice.id)) {
        issues.push(issue("INVALID_SLICE_DEPENDENCY", `${slice.id} cannot depend on itself.`, { sliceId: slice.id }));
      }
    }

    slices.push({
      id: slice.id,
      title: slice.title,
      status,
      repository,
      requirements,
      stories,
      scenarios,
      dependencies,
    });
  }

  for (const slice of slices) {
    for (const dependency of slice.dependencies) {
      if (!seenSliceIds.has(dependency)) {
        issues.push(issue("INVALID_SLICE_DEPENDENCY", `${slice.id} depends on unknown slice ${dependency}.`, { sliceId: slice.id }));
      }
    }
  }
  for (const cycle of dependencyCycles(slices)) {
    issues.push(issue("CYCLIC_SLICE_DEPENDENCY", `Requirement slice dependency cycle: ${cycle.join(" -> ")}.`));
  }

  const ledgerSection = headingRange(lines, "Implementation Ledger");
  const ledgerTable = ledgerSection ? parseFirstTable(ledgerSection.lines) : null;
  const ledger = [];
  if (!ledgerTable || ledgerTable.malformed || !arraysEqual(ledgerTable.header ?? [], LEDGER_HEADER)) {
    issues.push(issue("INVALID_IMPLEMENTATION_LEDGER", `Implementation Ledger must use the canonical header: | ${LEDGER_HEADER.join(" | ")} |`));
  } else {
    const seenLedger = new Set();
    for (const cells of ledgerTable.rows) {
      if (cells.length !== LEDGER_HEADER.length) {
        issues.push(issue("INVALID_IMPLEMENTATION_LEDGER", "Implementation Ledger rows must contain five cells."));
        continue;
      }
      const [sliceId, repositoryCell, status, summary, updated] = cells;
      const repository = parseInlineCode(repositoryCell);
      if (seenLedger.has(sliceId)) {
        issues.push(issue("INVALID_IMPLEMENTATION_LEDGER", `Duplicate Implementation Ledger row for ${sliceId}.`, { sliceId }));
      }
      seenLedger.add(sliceId);
      const slice = slices.find((entry) => entry.id === sliceId);
      if (!slice) {
        issues.push(issue("INVALID_IMPLEMENTATION_LEDGER", `Implementation Ledger contains unknown slice ${sliceId}.`, { sliceId }));
      } else {
        if (repository !== slice.repository) {
          issues.push(issue("INVALID_IMPLEMENTATION_LEDGER", `Implementation Ledger repository for ${sliceId} must match ${slice.repository}.`, { sliceId }));
        }
        if (status !== expectedLedgerStatus(slice.status)) {
          issues.push(issue("INVALID_IMPLEMENTATION_LEDGER", `Implementation Ledger status for ${sliceId} must be ${expectedLedgerStatus(slice.status)}.`, { sliceId }));
        }
      }
      if (!IMPLEMENTATION_LEDGER_STATUSES.includes(status) || summary.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(updated)) {
        issues.push(issue("INVALID_IMPLEMENTATION_LEDGER", `Implementation Ledger row for ${sliceId} has an invalid status, summary, or YYYY-MM-DD update value.`, { sliceId }));
      }
      ledger.push({ sliceId, repository, status, summary, updated });
    }
    for (const slice of slices) {
      if (!seenLedger.has(slice.id)) {
        issues.push(issue("INVALID_IMPLEMENTATION_LEDGER", `Implementation Ledger is missing slice ${slice.id}.`, { sliceId: slice.id }));
      }
    }
  }

  const resumeSection = headingRange(lines, "Resume Here");
  const resumeFields = new Map();
  if (resumeSection) {
    for (const line of resumeSection.lines) {
      const match = /^- ([A-Za-z][A-Za-z /-]*):\s*(.*)$/.exec(line);
      if (!match) continue;
      const name = match[1].trim();
      if (!RESUME_REQUIRED_FIELDS.includes(name)) continue;
      if (resumeFields.has(name)) {
        issues.push(issue("INVALID_RESUME_CHECKPOINT", `Resume Here contains duplicate ${name}.`));
      }
      resumeFields.set(name, match[2].trim());
    }
  }
  for (const field of RESUME_REQUIRED_FIELDS) {
    if (!resumeFields.has(field) || resumeFields.get(field).length === 0) {
      issues.push(issue("INVALID_RESUME_CHECKPOINT", `Resume Here must contain one non-empty ${field} field.`));
    }
  }
  if (changeId && parseInlineCode(resumeFields.get("Change") ?? "") !== changeId) {
    issues.push(issue("INVALID_RESUME_CHECKPOINT", `Resume Here Change must match ${changeId}.`));
  }
  const currentSlice = parseInlineCode(resumeFields.get("Current slice") ?? "");
  if (currentSlice !== "none" && !seenSliceIds.has(currentSlice)) {
    issues.push(issue("INVALID_RESUME_CHECKPOINT", `Resume Here Current slice ${JSON.stringify(currentSlice)} is not a known slice.`));
  }

  const resumeTable = resumeSection ? parseFirstTable(resumeSection.lines) : null;
  const envelopes = [];
  if (!resumeTable || resumeTable.malformed || !arraysEqual(resumeTable.header ?? [], RESUME_ENVELOPE_HEADER)) {
    issues.push(issue("INVALID_RESUME_CHECKPOINT", `Resume Here must use the canonical repository-envelope header: | ${RESUME_ENVELOPE_HEADER.join(" | ")} |`));
  } else {
    const seenRepositories = new Set();
    for (const cells of resumeTable.rows) {
      if (cells.length !== RESUME_ENVELOPE_HEADER.length) {
        issues.push(issue("INVALID_RESUME_CHECKPOINT", "Resume repository-envelope rows must contain five cells."));
        continue;
      }
      const repository = parseInlineCode(cells[0]);
      if (seenRepositories.has(repository)) {
        issues.push(issue("INVALID_RESUME_CHECKPOINT", `Duplicate Resume repository envelope for ${repository}.`));
      }
      seenRepositories.add(repository);
      if (!repositoryIds.includes(repository)) {
        issues.push(issue("INVALID_RESUME_CHECKPOINT", `Resume repository envelope ${repository} is not selected by change.md.`));
      }
      if (cells.slice(1).some((cell) => cell.length === 0)) {
        issues.push(issue("INVALID_RESUME_CHECKPOINT", `Resume repository envelope ${repository} contains an empty value.`));
      }
      envelopes.push({
        repository,
        root: parseInlineCode(cells[1]),
        baseline: parseInlineCode(cells[2]),
        candidateKind: parseInlineCode(cells[3]),
        candidateWatermark: parseInlineCode(cells[4]),
      });
    }
    for (const repository of new Set(slices.map((slice) => slice.repository).filter(Boolean))) {
      if (!seenRepositories.has(repository)) {
        issues.push(issue("INVALID_RESUME_CHECKPOINT", `Resume Here is missing a repository envelope for ${repository}.`));
      }
    }
  }

  return {
    structured: true,
    slices,
    ledger,
    resume: {
      fields: Object.fromEntries(resumeFields),
      envelopes,
    },
    issues,
  };
}

export function formatStructuredTaskIssues(issues) {
  return issues.map((entry) => `${entry.code}: ${entry.message}`);
}
