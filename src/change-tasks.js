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
const OPTIONAL_LIST_FIELDS = Object.freeze(["Visual requirements"]);
const OPTIONAL_SCALAR_FIELDS = Object.freeze([
  "Consumes",
  "Produces",
  "Coupling justification",
  "Completion certificate",
  "Closure receipt",
]);
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
const LEGACY_LEDGER_HEADER = Object.freeze([
  "Slice",
  "Repository",
  "Status",
  "Implementation Summary / Changed Surface",
  "Updated",
]);
const LEDGER_HEADER = Object.freeze([
  "Slice",
  "Repository",
  "Status",
  "Implementation Summary / Changed Surface",
  "Commit",
  "Updated",
]);
const SLICE_GATE_HEADER = Object.freeze([
  "Slice",
  "Verification Candidate",
  "Implementation Review",
  "Epic Update",
  "Semantic Closure",
  "Evidence Closure",
  "Post-Epic Review",
  "Required Gaps",
  "Accepted Gaps",
  "Final Commit",
  "Updated",
]);
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const CANDIDATE_WATERMARK_SOURCE = "(?:[0-9a-f]{40}|commit:[0-9a-f]{40}|working-tree:[0-9a-f]{40}:sha256:[0-9a-f]{64})";
const CANDIDATE_WATERMARK_PATTERN = new RegExp(`^${CANDIDATE_WATERMARK_SOURCE}$`);
const REVIEW_RESULT_PATTERN = new RegExp(`^(pending|(?:ready|changes-requested|blocked) @ ${CANDIDATE_WATERMARK_SOURCE})$`);
const EPIC_UPDATE_RESULT_PATTERN = new RegExp(`^(pending|(?:complete|no-op|needs-user|blocked|routed) @ ${CANDIDATE_WATERMARK_SOURCE})$`);
const POST_EPIC_REVIEW_PATTERN = new RegExp(`^(pending|not required|(?:ready|changes-requested|blocked) @ ${CANDIDATE_WATERMARK_SOURCE})$`);
const CLOSURE_RESULT_PATTERN = /^(?:pending|pass|fail)$/;

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
      currentList = [...REQUIRED_LIST_FIELDS, ...OPTIONAL_LIST_FIELDS].includes(name) ? name : null;
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

function parseCandidateResult(value) {
  if (value === "pending" || value === "not required") {
    return { status: value, watermark: null };
  }
  const match = /^([^ ]+) @ (.+)$/.exec(value);
  return match ? { status: match[1], watermark: match[2] } : null;
}

function validCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function gapReferencesAreValid(value, scenarios, { accepted = false } = {}) {
  if (value === "none") return true;
  const references = extractBacktickReferences(value);
  if (
    references.length === 0
    || new Set(references).size !== references.length
    || references.some((reference) => !scenarios.includes(reference))
  ) {
    return false;
  }
  if (!accepted) return true;
  const date = /— user accepted (\d{4}-\d{2}-\d{2})\.$/.exec(value)?.[1];
  return typeof date === "string" && validCalendarDate(date);
}

function parseLabeledReference(entry, allowedLabels, pattern) {
  const match = new RegExp(`^(${allowedLabels.join("|")}): \\x60([^\\x60]+)\\x60 — (.+)$`).exec(entry);
  if (!match || !pattern.test(match[2]) || match[3].trim().length === 0) return null;
  return { kind: match[1], reference: match[2], summary: match[3].trim() };
}

function parseVisualRequirements(entries, scenarios) {
  if (entries.length === 0) {
    return { applicability: "undeclared", reason: null, requirements: [], valid: true };
  }
  if (entries.length === 1) {
    const notApplicable = /^Not applicable — (.+)$/.exec(entries[0]);
    if (notApplicable) {
      return {
        applicability: "not-applicable",
        reason: notApplicable[1].trim(),
        requirements: [],
        valid: notApplicable[1].trim().length > 0,
      };
    }
  }
  const requirements = [];
  const seen = new Set();
  let valid = true;
  for (const entry of entries) {
    const match = /^`(V[1-9]\d*)` — Scenarios: (.+?) — (.+)$/.exec(entry);
    if (!match) {
      valid = false;
      continue;
    }
    const references = extractBacktickReferences(match[2]);
    if (
      seen.has(match[1])
      || references.length === 0
      || new Set(references).size !== references.length
      || references.some((reference) => !scenarios.includes(reference))
      || match[3].trim().length === 0
    ) {
      valid = false;
    }
    seen.add(match[1]);
    requirements.push({ id: match[1], scenarios: references, description: match[3].trim() });
  }
  return { applicability: "required", reason: null, requirements, valid };
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
    return { structured: false, ledgerFormat: null, slices: [], ledger: [], gates: [], resume: null, issues: [] };
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
    for (const field of [...OPTIONAL_SCALAR_FIELDS, ...OPTIONAL_LIST_FIELDS]) {
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
    const couplingJustification = slice.scalar.get("Coupling justification") ?? null;
    const currentCouplingPolicyApplies = status !== "done" || slice.scalar.get("Closure receipt") === "required";
    if (requirements.length > 1 && currentCouplingPolicyApplies && (couplingJustification === null || couplingJustification.trim().length === 0)) {
      issues.push(issue(
        "INVALID_SLICE_COUPLING",
        `${slice.id} declares multiple Requirements and must include a non-empty Coupling justification explaining why they cannot complete atomically in separate fresh sessions.`,
        { sliceId: slice.id },
      ));
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
    if (new Set(scenarios).size !== scenarios.length) {
      issues.push(issue("INVALID_SLICE_REFERENCE", `${slice.id} must not cite duplicate Scenario references.`, { sliceId: slice.id }));
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
    const completionCertificate = slice.scalar.get("Completion certificate") ?? null;
    const closureReceipt = slice.scalar.get("Closure receipt") ?? null;
    if (completionCertificate !== null && completionCertificate !== "required") {
      issues.push(issue("INVALID_REQUIREMENT_SLICE", `${slice.id} Completion certificate must be \`required\` when declared.`, { sliceId: slice.id }));
    }
    if (closureReceipt !== null && closureReceipt !== "required") {
      issues.push(issue("INVALID_REQUIREMENT_SLICE", `${slice.id} Closure receipt must be \`required\` when declared.`, { sliceId: slice.id }));
    }
    if (completionCertificate !== null && closureReceipt !== null) {
      issues.push(issue("INVALID_SLICE_CLOSURE_POLICY", `${slice.id} must declare either legacy Completion certificate or current Closure receipt policy, not both.`, { sliceId: slice.id }));
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

    const visual = parseVisualRequirements(slice.list.get("Visual requirements") ?? [], scenarios);
    if (!visual.valid) {
      issues.push(issue(
        "INVALID_SLICE_VISUAL_REQUIREMENTS",
        `${slice.id} Visual requirements must be one \`Not applicable — <reason>\` entry or unique \`V#\` entries that cite declared Scenarios and describe one viewport/state/interaction obligation.`,
        { sliceId: slice.id },
      ));
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
      visual,
      couplingJustification,
      closureRequired: completionCertificate === "required" || closureReceipt === "required",
      closureSchema: closureReceipt === "required" ? "sdd-slice-closure-v2" : completionCertificate === "required" ? "sdd-slice-closure-v1" : null,
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
  const ledgerHeader = ledgerTable?.header ?? [];
  const legacyLedger = arraysEqual(ledgerHeader, LEGACY_LEDGER_HEADER);
  const currentLedger = arraysEqual(ledgerHeader, LEDGER_HEADER);
  if (!ledgerTable || ledgerTable.malformed || (!legacyLedger && !currentLedger)) {
    issues.push(issue("INVALID_IMPLEMENTATION_LEDGER", `Implementation Ledger must use the canonical header: | ${LEDGER_HEADER.join(" | ")} |`));
  } else {
    const seenLedger = new Set();
    for (const cells of ledgerTable.rows) {
      const expectedLength = currentLedger ? LEDGER_HEADER.length : LEGACY_LEDGER_HEADER.length;
      if (cells.length !== expectedLength) {
        issues.push(issue("INVALID_IMPLEMENTATION_LEDGER", `Implementation Ledger rows must contain ${expectedLength} cells.`));
        continue;
      }
      const [sliceId, repositoryCell, status, summary] = cells;
      const commit = currentLedger ? parseInlineCode(cells[4]) : null;
      const updated = cells[currentLedger ? 5 : 4];
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
      if (currentLedger) {
        if (commit.length === 0 || (commit !== "pending" && !COMMIT_SHA_PATTERN.test(commit))) {
          issues.push(issue("INVALID_IMPLEMENTATION_LEDGER", `Implementation Ledger commit for ${sliceId} must be \`pending\` or a full 40-character commit SHA.`, { sliceId }));
        }
        if (status === "done" && !COMMIT_SHA_PATTERN.test(commit)) {
          issues.push(issue("INVALID_IMPLEMENTATION_LEDGER", `Done Implementation Ledger row for ${sliceId} must record its full commit SHA.`, { sliceId }));
        }
      }
      ledger.push({ sliceId, repository, status, summary, commit, updated });
    }
    for (const slice of slices) {
      if (!seenLedger.has(slice.id)) {
        issues.push(issue("INVALID_IMPLEMENTATION_LEDGER", `Implementation Ledger is missing slice ${slice.id}.`, { sliceId: slice.id }));
      }
      if (currentLedger && slice.status === "done" && slice.closureRequired && slice.visual.applicability === "undeclared") {
        issues.push(issue(
          "INVALID_SLICE_VISUAL_REQUIREMENTS",
          `Done slice ${slice.id} must declare Visual requirements before completion.`,
          { sliceId: slice.id },
        ));
      }
    }
  }

  if (currentLedger) {
    for (const slice of slices) {
      if (slice.status !== "done" && !slice.closureRequired) {
        issues.push(issue(
          "INVALID_SLICE_CLOSURE_POLICY",
          `${slice.id} must declare Closure receipt: required (or the legacy Completion certificate marker) while it remains current-workflow delivery state.`,
          { sliceId: slice.id },
        ));
      }
    }
  } else if (slices.some((slice) => slice.closureRequired)) {
    issues.push(issue(
      "INVALID_SLICE_CLOSURE_POLICY",
      "Closure receipt and legacy completion-certificate policy are supported only with the current six-column Implementation Ledger.",
    ));
  }

  const gateRanges = headingRanges(lines, "Slice Gate Ledger");
  const gates = [];
  if (gateRanges.length > 1) {
    issues.push(issue("INVALID_SLICE_GATE_LEDGER", "Structured tasks may contain at most one ## Slice Gate Ledger section."));
  }
  const gateSection = gateRanges[0] ?? null;
  if (!gateSection && currentLedger && slices.some((slice) => slice.status === "done" && slice.closureRequired)) {
    issues.push(issue("INVALID_SLICE_GATE_LEDGER", "Done slices using the current six-column Implementation Ledger require a ## Slice Gate Ledger section."));
  }
  if (gateSection) {
    const gateTable = parseFirstTable(gateSection.lines);
    if (!gateTable || gateTable.malformed || !arraysEqual(gateTable.header ?? [], SLICE_GATE_HEADER)) {
      issues.push(issue("INVALID_SLICE_GATE_LEDGER", `Slice Gate Ledger must use the canonical header: | ${SLICE_GATE_HEADER.join(" | ")} |`));
    } else {
      const seenGates = new Set();
      for (const cells of gateTable.rows) {
        if (cells.length !== SLICE_GATE_HEADER.length) {
          issues.push(issue("INVALID_SLICE_GATE_LEDGER", `Slice Gate Ledger rows must contain ${SLICE_GATE_HEADER.length} cells.`));
          continue;
        }
        const [
          sliceId,
          verificationCandidate,
          implementationReview,
          epicUpdate,
          semanticClosure,
          evidenceClosure,
          postEpicReview,
          requiredGaps,
          acceptedGaps,
          finalCommitCell,
          updated,
        ] = cells;
        const finalCommit = parseInlineCode(finalCommitCell);
        const implementationResult = parseCandidateResult(implementationReview);
        const epicUpdateResult = parseCandidateResult(epicUpdate);
        const postEpicResult = parseCandidateResult(postEpicReview);
        if (seenGates.has(sliceId)) {
          issues.push(issue("INVALID_SLICE_GATE_LEDGER", `Duplicate Slice Gate Ledger row for ${sliceId}.`, { sliceId }));
        }
        seenGates.add(sliceId);
        const slice = slices.find((entry) => entry.id === sliceId);
        if (!slice) {
          issues.push(issue("INVALID_SLICE_GATE_LEDGER", `Slice Gate Ledger contains unknown slice ${sliceId}.`, { sliceId }));
        }
        const verificationIsValid = verificationCandidate === "pending"
          || CANDIDATE_WATERMARK_PATTERN.test(verificationCandidate);
        const requiredGapsAreValid = slice
          ? gapReferencesAreValid(requiredGaps, slice.scenarios)
          : requiredGaps === "none";
        const acceptedGapsAreValid = slice
          ? gapReferencesAreValid(acceptedGaps, slice.scenarios, { accepted: true })
          : acceptedGaps === "none";
        const relationshipsAreValid = (
          implementationReview === "pending"
          || (
            verificationCandidate !== "pending"
            && implementationResult?.watermark === verificationCandidate
          )
        ) && (
          epicUpdate === "pending"
          || (
            implementationResult?.status === "ready"
            && epicUpdateResult?.watermark !== null
            && (
              epicUpdateResult.status !== "no-op"
              || epicUpdateResult.watermark === verificationCandidate
            )
          )
        ) && (
          postEpicReview === "pending"
          || (
            postEpicReview === "not required"
              ? epicUpdateResult?.status === "no-op"
              : epicUpdateResult?.status === "complete"
                && postEpicResult?.watermark === epicUpdateResult.watermark
          )
        );
        if (
          !verificationIsValid
          || !REVIEW_RESULT_PATTERN.test(implementationReview)
          || !EPIC_UPDATE_RESULT_PATTERN.test(epicUpdate)
          || !CLOSURE_RESULT_PATTERN.test(semanticClosure)
          || !CLOSURE_RESULT_PATTERN.test(evidenceClosure)
          || !POST_EPIC_REVIEW_PATTERN.test(postEpicReview)
          || !requiredGapsAreValid
          || !acceptedGapsAreValid
          || !relationshipsAreValid
          || (finalCommit !== "pending" && !COMMIT_SHA_PATTERN.test(finalCommit))
          || !/^\d{4}-\d{2}-\d{2}$/.test(updated)
        ) {
          issues.push(issue("INVALID_SLICE_GATE_LEDGER", `Slice Gate Ledger row for ${sliceId} has an invalid candidate/result relationship, gap classification, commit, or YYYY-MM-DD update value.`, { sliceId }));
        }
        if (slice?.status === "done") {
          const ledgerCommit = ledger.find((entry) => entry.sliceId === sliceId)?.commit;
          if (
            verificationCandidate === "pending"
            || !implementationReview.startsWith("ready @ ")
            || !(epicUpdate.startsWith("complete @ ") || epicUpdate.startsWith("no-op @ "))
            || semanticClosure !== "pass"
            || evidenceClosure !== "pass"
            || !(postEpicReview === "not required" || postEpicReview.startsWith("ready @ "))
            || requiredGaps !== "none"
            || !COMMIT_SHA_PATTERN.test(finalCommit)
            || ledgerCommit !== finalCommit
          ) {
            issues.push(issue("INVALID_SLICE_GATE_LEDGER", `Done slice ${sliceId} requires current ready Review results, complete or no-op Epic Update, semantic/evidence closure pass, no required gaps, and the same full final commit as the Implementation Ledger.`, { sliceId }));
          }
        }
        gates.push({
          sliceId,
          verificationCandidate,
          implementationReview,
          epicUpdate,
          semanticClosure,
          evidenceClosure,
          postEpicReview,
          requiredGaps,
          acceptedGaps,
          finalCommit,
          updated,
        });
      }
      for (const slice of slices) {
        if (!seenGates.has(slice.id)) {
          issues.push(issue("INVALID_SLICE_GATE_LEDGER", `Slice Gate Ledger is missing slice ${slice.id}.`, { sliceId: slice.id }));
        }
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
    ledgerFormat: currentLedger ? "current-six-column" : legacyLedger ? "legacy-five-column" : "invalid",
    slices,
    ledger,
    gates,
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
