const OUTCOME_ID_PATTERN = /^S[1-9]\d*$/;
const REPOSITORY_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const TRIGGER_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const EPIC_SCOPED_STORY_REFERENCE = "[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*\\/S[1-9]\\d*";
const LEGACY_STORY_REFERENCE = "[A-Z][A-Z0-9]*-\\d+";
const STORY_REFERENCE_SOURCE = `(?:${EPIC_SCOPED_STORY_REFERENCE}|${LEGACY_STORY_REFERENCE})`;
const REQUIREMENT_REFERENCE_PATTERN = new RegExp(`^(${STORY_REFERENCE_SOURCE} R[1-9]\\d*)$`);
const STORY_REFERENCE_PATTERN = new RegExp(`^(${STORY_REFERENCE_SOURCE})$`);
const SCENARIO_REFERENCE_PATTERN = new RegExp(`^(${STORY_REFERENCE_SOURCE} R[1-9]\\d*-S[1-9]\\d*)$`);

export const V2_OUTCOME_STATUSES = Object.freeze([
  "ready",
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
const OPTIONAL_SCALAR_FIELDS = Object.freeze([
  "Coupling justification",
  "Consumes",
  "Produces",
]);
const RESUME_FIELDS = Object.freeze([
  "Change",
  "Current outcome",
  "Phase",
  "Next action",
  "Blocker",
]);
const FORBIDDEN_LEGACY_HEADINGS = Object.freeze([
  "Implementation Ledger",
  "Slice Gate Ledger",
  "Requirement Slices",
]);

function issue(code, message, context = {}) {
  return { code, message, ...context };
}

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

function parseInlineCode(value) {
  const trimmed = value.trim();
  return /^`([^`]+)`$/.exec(trimmed)?.[1] ?? trimmed;
}

function extractBacktickReferences(value) {
  return [...value.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function parseLabeledReference(entry, allowedLabels, pattern) {
  const match = new RegExp(`^(${allowedLabels.join("|")}): \\x60([^\\x60]+)\\x60 — (.+)$`).exec(entry);
  if (!match || !pattern.test(match[2]) || match[3].trim().length === 0) return null;
  return { kind: match[1], reference: match[2], summary: match[3].trim() };
}

function parseOutcomeBlock(block) {
  const scalar = new Map();
  const list = new Map();
  const counts = new Map();
  let currentList = null;
  for (const line of block.lines) {
    const field = /^- ([A-Za-z][A-Za-z /-]*):(?:\s*(.*))?$/.exec(line);
    if (field) {
      const name = field[1].trim();
      counts.set(name, (counts.get(name) ?? 0) + 1);
      currentList = [...REQUIRED_LIST_FIELDS, "Expected triggers"].includes(name) && (field[2] ?? "").trim().length === 0
        ? name
        : null;
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

function dependencyCycles(outcomes) {
  const graph = new Map(outcomes.map((outcome) => [outcome.id, outcome.dependencies]));
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

export function parseV2ChangeTasks(source, { changeId = null, repositoryIds = [] } = {}) {
  const lines = visibleMarkdownLines(source);
  const issues = [];
  const headingNames = ["Resume Here", "Delivery Outcomes", "Closeout"];
  const ranges = new Map(headingNames.map((heading) => [heading, headingRanges(lines, heading)]));
  for (const heading of headingNames) {
    if (ranges.get(heading).length !== 1) {
      issues.push(issue("INVALID_V2_TASKS", `V2 tasks must contain exactly one ## ${heading} section.`));
    }
  }
  for (const heading of FORBIDDEN_LEGACY_HEADINGS) {
    if (headingRanges(lines, heading).length > 0) {
      issues.push(issue("LEGACY_V2_ARTIFACT", `V2 tasks must not contain ## ${heading}.`));
    }
  }
  if (/^- (?:Closure receipt|Completion certificate):/m.test(lines.join("\n"))) {
    issues.push(issue("LEGACY_V2_ARTIFACT", "V2 tasks must not declare closure receipts or completion certificates."));
  }

  const outcomesRange = ranges.get("Delivery Outcomes")[0] ?? null;
  const blocks = [];
  if (outcomesRange) {
    for (let index = outcomesRange.start + 1; index < outcomesRange.end; index += 1) {
      const match = /^###\s+([^:]+):\s*(.*)$/.exec(lines[index]);
      if (!match) continue;
      let end = outcomesRange.end;
      for (let next = index + 1; next < outcomesRange.end; next += 1) {
        if (/^###\s+/.test(lines[next])) {
          end = next;
          break;
        }
      }
      blocks.push({
        id: match[1].trim(),
        title: match[2].trim(),
        line: index + 1,
        lines: lines.slice(index + 1, end),
      });
      index = end - 1;
    }
  }
  if (blocks.length === 0) {
    issues.push(issue("INVALID_V2_OUTCOME", "Delivery Outcomes must contain at least one `### S#: <title>` block."));
  }

  const outcomes = [];
  const seenOutcomeIds = new Set();
  for (const raw of blocks) {
    const outcome = parseOutcomeBlock(raw);
    if (!OUTCOME_ID_PATTERN.test(outcome.id) || outcome.title.length === 0) {
      issues.push(issue("INVALID_V2_OUTCOME", `Invalid outcome heading at line ${outcome.line}; expected \`### S#: <title>\`.`));
    }
    if (seenOutcomeIds.has(outcome.id)) {
      issues.push(issue("INVALID_V2_OUTCOME", `Duplicate outcome ID ${outcome.id}.`, { outcomeId: outcome.id }));
    }
    seenOutcomeIds.add(outcome.id);

    for (const field of [...REQUIRED_SCALAR_FIELDS, ...REQUIRED_LIST_FIELDS, "Expected triggers"]) {
      if ((outcome.counts.get(field) ?? 0) !== 1) {
        issues.push(issue("INVALID_V2_OUTCOME", `${outcome.id} must contain exactly one ${field} field.`, { outcomeId: outcome.id }));
      }
    }
    for (const field of OPTIONAL_SCALAR_FIELDS) {
      if ((outcome.counts.get(field) ?? 0) > 1) {
        issues.push(issue("INVALID_V2_OUTCOME", `${outcome.id} may contain at most one ${field} field.`, { outcomeId: outcome.id }));
      }
    }

    const status = outcome.scalar.get("Status") ?? "";
    const repository = parseInlineCode(outcome.scalar.get("Repository") ?? "");
    if (!V2_OUTCOME_STATUSES.includes(status)) {
      issues.push(issue("INVALID_V2_OUTCOME", `${outcome.id} has invalid status ${JSON.stringify(status)}.`, { outcomeId: outcome.id }));
    }
    if (!REPOSITORY_ID_PATTERN.test(repository) || !repositoryIds.includes(repository)) {
      issues.push(issue("INVALID_V2_REFERENCE", `${outcome.id} repository ${JSON.stringify(repository)} is not selected by change.md.`, { outcomeId: outcome.id }));
    }

    const requirements = [];
    for (const entry of outcome.list.get("Requirements") ?? []) {
      const parsed = parseLabeledReference(entry, ["New", "Revised"], REQUIREMENT_REFERENCE_PATTERN);
      if (!parsed) issues.push(issue("INVALID_V2_REFERENCE", `${outcome.id} has an invalid Requirement entry: ${entry}`, { outcomeId: outcome.id }));
      else requirements.push(parsed);
    }
    if (requirements.length === 0) {
      issues.push(issue("INVALID_V2_REFERENCE", `${outcome.id} must declare at least one new or revised Requirement.`, { outcomeId: outcome.id }));
    }

    const stories = [];
    for (const entry of outcome.list.get("Story changes") ?? []) {
      const parsed = parseLabeledReference(entry, ["Create", "Update"], STORY_REFERENCE_PATTERN);
      if (!parsed) issues.push(issue("INVALID_V2_REFERENCE", `${outcome.id} has an invalid Story change entry: ${entry}`, { outcomeId: outcome.id }));
      else stories.push(parsed);
    }
    if (stories.length === 0) {
      issues.push(issue("INVALID_V2_REFERENCE", `${outcome.id} must declare at least one Story create or update action.`, { outcomeId: outcome.id }));
    }

    const scenarios = extractBacktickReferences(outcome.scalar.get("Scenarios") ?? "");
    if (scenarios.length === 0 || scenarios.some((reference) => !SCENARIO_REFERENCE_PATTERN.test(reference))) {
      issues.push(issue("INVALID_V2_REFERENCE", `${outcome.id} must cite one or more full Scenario references.`, { outcomeId: outcome.id }));
    }
    if (new Set(scenarios).size !== scenarios.length) {
      issues.push(issue("INVALID_V2_REFERENCE", `${outcome.id} must not cite duplicate Scenario references.`, { outcomeId: outcome.id }));
    }
    const requirementSet = new Set(requirements.map((entry) => entry.reference));
    const storySet = new Set(stories.map((entry) => entry.reference));
    for (const scenario of scenarios) {
      const requirement = scenario.replace(/-S[1-9]\d*$/, "");
      const story = scenario.replace(/ R[1-9]\d*-S[1-9]\d*$/, "");
      if (!requirementSet.has(requirement) || !storySet.has(story)) {
        issues.push(issue("INVALID_V2_REFERENCE", `${outcome.id} Scenario ${scenario} must belong to its declared Requirement and Story.`, { outcomeId: outcome.id }));
      }
    }

    const couplingJustification = outcome.scalar.get("Coupling justification") ?? null;
    if (requirements.length > 1 && (couplingJustification === null || couplingJustification.length === 0)) {
      issues.push(issue("INVALID_V2_COUPLING", `${outcome.id} declares multiple Requirements and must explain why separate completion would be incoherent.`, { outcomeId: outcome.id }));
    }

    const dependencySource = outcome.scalar.get("Dependencies") ?? "";
    let dependencies = [];
    if (dependencySource !== "none") {
      dependencies = dependencySource.split(",").map((entry) => parseInlineCode(entry.trim())).filter(Boolean);
      if (dependencies.length === 0 || dependencies.some((entry) => !OUTCOME_ID_PATTERN.test(entry)) || new Set(dependencies).size !== dependencies.length || dependencies.includes(outcome.id)) {
        issues.push(issue("INVALID_V2_DEPENDENCY", `${outcome.id} dependencies must be \`none\` or unique comma-separated outcome IDs.`, { outcomeId: outcome.id }));
      }
    }

    const triggerEntries = outcome.list.get("Expected triggers") ?? [];
    const triggerScalar = outcome.scalar.get("Expected triggers") ?? null;
    const triggers = [];
    if (triggerScalar === "none") {
      // No behavior-derived trigger is expected beyond the five universal gates.
    } else {
      for (const entry of triggerEntries) {
        const match = /^`([^`]+)` — (.+)$/.exec(entry);
        if (!match || !TRIGGER_ID_PATTERN.test(match[1]) || match[2].trim().length === 0 || triggers.some((trigger) => trigger.id === match[1])) {
          issues.push(issue("INVALID_V2_TRIGGER", `${outcome.id} has an invalid or duplicate trigger entry: ${entry}`, { outcomeId: outcome.id }));
        } else triggers.push({ id: match[1], reason: match[2].trim() });
      }
      if (triggerEntries.length === 0) {
        issues.push(issue("INVALID_V2_TRIGGER", `${outcome.id} Expected triggers must be \`none\` or contain at least one trigger.`, { outcomeId: outcome.id }));
      }
    }

    for (const field of ["Outcome", "Binding constraints", "Verification intent", "Manual acceptance"]) {
      if ((outcome.scalar.get(field) ?? "").trim().length === 0) {
        issues.push(issue("INVALID_V2_OUTCOME", `${outcome.id} ${field} must be non-empty.`, { outcomeId: outcome.id }));
      }
    }

    outcomes.push({
      id: outcome.id,
      title: outcome.title,
      status,
      repository,
      requirements,
      stories,
      scenarios,
      dependencies,
      triggers,
      couplingJustification,
      manualAcceptance: outcome.scalar.get("Manual acceptance") ?? "",
    });
  }

  for (const outcome of outcomes) {
    for (const dependency of outcome.dependencies) {
      if (!seenOutcomeIds.has(dependency)) {
        issues.push(issue("INVALID_V2_DEPENDENCY", `${outcome.id} depends on unknown outcome ${dependency}.`, { outcomeId: outcome.id }));
      }
    }
  }
  for (const cycle of dependencyCycles(outcomes)) {
    issues.push(issue("CYCLIC_V2_DEPENDENCY", `Delivery outcome dependency cycle: ${cycle.join(" -> ")}.`));
  }

  const resumeRange = ranges.get("Resume Here")[0] ?? null;
  const resumeValues = new Map();
  if (resumeRange) {
    for (const line of resumeRange.lines) {
      const match = /^- ([A-Za-z][A-Za-z ]*):\s*(.*)$/.exec(line);
      if (!match || !RESUME_FIELDS.includes(match[1])) continue;
      if (resumeValues.has(match[1])) issues.push(issue("INVALID_V2_RESUME", `Resume Here contains duplicate ${match[1]}.`));
      resumeValues.set(match[1], match[2].trim());
    }
  }
  for (const field of RESUME_FIELDS) {
    if (!resumeValues.has(field) || resumeValues.get(field).length === 0) {
      issues.push(issue("INVALID_V2_RESUME", `Resume Here must contain one non-empty ${field} field.`));
    }
  }
  if (changeId && parseInlineCode(resumeValues.get("Change") ?? "") !== changeId) {
    issues.push(issue("INVALID_V2_RESUME", `Resume Here Change must match ${changeId}.`));
  }
  const currentOutcome = parseInlineCode(resumeValues.get("Current outcome") ?? "");
  if (currentOutcome !== "none" && !seenOutcomeIds.has(currentOutcome)) {
    issues.push(issue("INVALID_V2_RESUME", `Resume Here Current outcome ${JSON.stringify(currentOutcome)} is not known.`));
  }

  return {
    structured: true,
    format: "sdd-change-v2",
    ledgerFormat: null,
    outcomes,
    slices: outcomes,
    gates: [],
    resume: {
      change: parseInlineCode(resumeValues.get("Change") ?? ""),
      currentOutcome,
      phase: resumeValues.get("Phase") ?? "",
      nextAction: resumeValues.get("Next action") ?? "",
      blocker: resumeValues.get("Blocker") ?? "",
    },
    issues,
  };
}

export function formatV2TaskIssues(issues) {
  return issues.map((entry) => `${entry.code}: ${entry.message}`);
}
