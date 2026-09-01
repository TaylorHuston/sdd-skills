import { parseDocument } from "yaml";

export const V2_CHANGE_REVIEW_SCHEMA = "sdd-review-v2";
export const V2_UNIVERSAL_GATE_IDS = Object.freeze([
  "scope-candidate",
  "behavior",
  "fresh-verification",
  "independent-review",
  "integrity-authority",
]);

const CANDIDATE_PATTERN = /^(?:[0-9a-f]{40}|commit:[0-9a-f]{40}|working-tree:[0-9a-f]{40}:sha256:[0-9a-f]{64})$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const VERDICTS = new Set(["pending", "ready", "changes-requested", "blocked"]);
const REVIEW_RESULTS = new Set(["pending", "pass", "findings", "cannot-verify"]);
const GATE_RESULTS = new Set(["pending", "pass", "accepted-gap", "findings", "blocked"]);
const MANUAL_ACCEPTANCE = new Set(["not required", "pending user", "user confirmed", "accepted gap"]);
const SUMMARY_FIELDS = Object.freeze([
  "Repository",
  "Candidate",
  "Verdict",
  "Spec Adherence",
  "Implementation Quality",
  "Manual acceptance",
  "Reviewed tree",
  "Final commit",
  "Final commit tree",
]);

function issue(code, message, context = {}) {
  return { code, message, ...context };
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function visibleMarkdownLines(source) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let fenced = false;
  return lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return "";
    }
    return fenced ? "" : line;
  });
}

function sectionRanges(lines, pattern, level) {
  const ranges = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = pattern.exec(lines[index]);
    if (!match) continue;
    let end = lines.length;
    for (let next = index + 1; next < lines.length; next += 1) {
      const heading = /^(#{1,6})\s+/.exec(lines[next]);
      if (heading && heading[1].length <= level) {
        end = next;
        break;
      }
    }
    ranges.push({ match, start: index, end, lines: lines.slice(index + 1, end) });
  }
  return ranges;
}

function childSection(block, heading) {
  const marker = `### ${heading}`;
  const start = block.lines.findIndex((line) => line.trim() === marker);
  if (start < 0) return null;
  let end = block.lines.length;
  for (let index = start + 1; index < block.lines.length; index += 1) {
    if (/^#{1,3}\s+/.test(block.lines[index])) {
      end = index;
      break;
    }
  }
  return block.lines.slice(start + 1, end);
}

function findingSections(lines, heading) {
  const marker = `#### ${heading}`;
  const starts = (lines ?? []).flatMap((line, index) => line.trim() === marker ? [index] : []);
  return starts.map((start) => {
    const offset = lines.slice(start + 1).findIndex((line) => /^#{1,4}\s+/.test(line));
    return lines.slice(start + 1, offset < 0 ? lines.length : start + 1 + offset);
  });
}

function hasFinding(sections) {
  return sections.length !== 1 || sections[0].some((line) => {
    const value = line.trim();
    return value.length > 0 && !/^-\s+None\.(?:\s|$)/i.test(value);
  });
}

function parseInlineCode(value) {
  const trimmed = value.trim();
  return /^`([^`]+)`$/.exec(trimmed)?.[1] ?? trimmed;
}

function parseSummary(lines) {
  const values = new Map();
  const counts = new Map();
  for (const line of lines ?? []) {
    const match = /^- ([A-Za-z][A-Za-z ]*):\s*(.*)$/.exec(line);
    if (!match) continue;
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
    values.set(match[1], parseInlineCode(match[2]));
  }
  return { values, counts };
}

function splitTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  const content = trimmed.slice(1, -1);
  const cells = [];
  let start = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== "|") continue;
    let escapes = 0;
    for (let cursor = index - 1; cursor >= 0 && content[cursor] === "\\"; cursor -= 1) escapes += 1;
    if (escapes % 2 === 1) continue;
    cells.push(content.slice(start, index).trim());
    start = index + 1;
  }
  cells.push(content.slice(start).trim());
  return cells;
}

function parseTable(lines, expectedHeader) {
  if (!lines) return null;
  const start = lines.findIndex((line) => splitTableRow(line) !== null);
  if (start < 0) return null;
  const header = splitTableRow(lines[start]);
  const separator = splitTableRow(lines[start + 1] ?? "");
  if (
    header.length !== expectedHeader.length
    || header.some((cell, index) => cell !== expectedHeader[index])
    || !separator
    || separator.length !== expectedHeader.length
    || !separator.every((cell) => /^:?-{3,}:?$/.test(cell))
  ) return null;
  const rows = [];
  for (let index = start + 2; index < lines.length; index += 1) {
    const cells = splitTableRow(lines[index]);
    if (!cells) {
      if (lines[index].trim().length === 0) continue;
      break;
    }
    if (cells.length !== expectedHeader.length) return null;
    rows.push(Object.fromEntries(expectedHeader.map((field, fieldIndex) => [field, cells[fieldIndex]])));
  }
  return rows;
}

function exactSet(actual, expected) {
  return actual.length === expected.length
    && new Set(actual).size === actual.length
    && actual.every((value) => expected.includes(value));
}

function validGap(value) {
  if (["none", "required", "manual-acceptance"].includes(value)) return true;
  if (value.startsWith("optional-confidence:")) return value.slice("optional-confidence:".length).trim().length > 0;
  if (value.startsWith("user-accepted:")) return validDate(value.slice("user-accepted:".length));
  return false;
}

function resultGapCoherent(result, gap) {
  if (result === "accepted-gap") return gap.startsWith("user-accepted:");
  if (result === "pass") return gap === "none" || gap === "manual-acceptance" || gap.startsWith("optional-confidence:");
  return true;
}

function hasUnresolvedEvidence(result, evidence) {
  return ["pass", "accepted-gap"].includes(result) && parseInlineCode(evidence).trim().toLowerCase() === "pending";
}

function parseFrontmatter(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { record: null, error: "Review requires YAML frontmatter." };
  const document = parseDocument(match[1]);
  if (document.errors.length > 0) return { record: null, error: `Cannot parse Review frontmatter: ${document.errors[0].message}` };
  const record = document.toJS();
  if (!record || typeof record !== "object" || Array.isArray(record)) return { record: null, error: "Review frontmatter must be a mapping." };
  return { record, error: null };
}

export function validateV2ChangeReviewSource(source, { changeId, outcomes = [] } = {}) {
  const issues = [];
  const frontmatter = parseFrontmatter(source);
  const record = frontmatter.record;
  if (frontmatter.error) issues.push(issue("INVALID_V2_REVIEW", frontmatter.error));
  const keys = record ? Object.keys(record) : [];
  if (
    !record
    || keys.length !== 3
    || !["schema", "change", "updated"].every((key) => keys.includes(key))
    || record.schema !== V2_CHANGE_REVIEW_SCHEMA
    || record.change !== changeId
    || !validDate(record.updated)
  ) {
    issues.push(issue("INVALID_V2_REVIEW", "V2 Review frontmatter must contain only matching schema, change, and updated fields."));
  }

  const lines = visibleMarkdownLines(source);
  const blocks = sectionRanges(lines, /^## Outcome (S[1-9]\d*):\s*(.+)$/, 2);
  const expectedById = new Map(outcomes.map((outcome) => [outcome.id, outcome]));
  const seen = new Set();
  const parsedOutcomes = [];

  for (const block of blocks) {
    const outcomeId = block.match[1];
    const expected = expectedById.get(outcomeId);
    if (seen.has(outcomeId)) issues.push(issue("INVALID_V2_REVIEW", `Duplicate Review outcome ${outcomeId}.`, { outcomeId }));
    seen.add(outcomeId);
    if (!expected) {
      issues.push(issue("INVALID_V2_REVIEW", `Review outcome ${outcomeId} is not declared by tasks.md.`, { outcomeId }));
      continue;
    }

    const summary = parseSummary(childSection(block, "Summary"));
    for (const field of SUMMARY_FIELDS) {
      if ((summary.counts.get(field) ?? 0) !== 1 || (summary.values.get(field) ?? "").length === 0) {
        issues.push(issue("INVALID_V2_REVIEW", `${outcomeId} Summary must contain one non-empty ${field} field.`, { outcomeId }));
      }
    }
    const repository = summary.values.get("Repository") ?? "";
    const candidate = summary.values.get("Candidate") ?? "";
    const verdict = summary.values.get("Verdict") ?? "";
    const specAdherence = summary.values.get("Spec Adherence") ?? "";
    const implementationQuality = summary.values.get("Implementation Quality") ?? "";
    const manualAcceptance = summary.values.get("Manual acceptance") ?? "";
    const reviewedTree = summary.values.get("Reviewed tree") ?? "";
    const finalCommit = summary.values.get("Final commit") ?? "";
    const finalCommitTree = summary.values.get("Final commit tree") ?? "";
    if (repository !== expected.repository) issues.push(issue("INVALID_V2_REVIEW", `${outcomeId} repository must match ${expected.repository}.`, { outcomeId }));
    if (candidate !== "pending" && !CANDIDATE_PATTERN.test(candidate)) issues.push(issue("INVALID_V2_REVIEW", `${outcomeId} has an invalid candidate.`, { outcomeId }));
    if (!VERDICTS.has(verdict) || !REVIEW_RESULTS.has(specAdherence) || !REVIEW_RESULTS.has(implementationQuality)) {
      issues.push(issue("INVALID_V2_REVIEW", `${outcomeId} has an invalid verdict or independent Review result.`, { outcomeId }));
    }
    if (!MANUAL_ACCEPTANCE.has(manualAcceptance)) issues.push(issue("INVALID_V2_REVIEW", `${outcomeId} has an invalid manual acceptance state.`, { outcomeId }));
    const manualAcceptanceRequired = expected.manualAcceptance !== "not required";
    if (
      (!manualAcceptanceRequired && manualAcceptance !== "not required")
      || (manualAcceptanceRequired && !["pending user", "user confirmed", "accepted gap"].includes(manualAcceptance))
    ) {
      issues.push(issue(
        "V2_REVIEW_MANUAL_ACCEPTANCE_MISMATCH",
        `${outcomeId} Review manual acceptance must preserve the requirement declared by tasks.md.`,
        { outcomeId },
      ));
    }
    if (reviewedTree !== "pending" && !SHA_PATTERN.test(reviewedTree)) issues.push(issue("INVALID_V2_REVIEW", `${outcomeId} has an invalid reviewed tree.`, { outcomeId }));
    if (finalCommit !== "pending" && !SHA_PATTERN.test(finalCommit)) issues.push(issue("INVALID_V2_REVIEW", `${outcomeId} has an invalid final commit.`, { outcomeId }));
    if (finalCommitTree !== "pending" && !SHA_PATTERN.test(finalCommitTree)) issues.push(issue("INVALID_V2_REVIEW", `${outcomeId} has an invalid final commit tree.`, { outcomeId }));
    if ((finalCommit === "pending") !== (finalCommitTree === "pending")) issues.push(issue("INVALID_V2_REVIEW", `${outcomeId} final commit and final commit tree must become current together.`, { outcomeId }));
    if (finalCommit !== "pending" && reviewedTree !== finalCommitTree) issues.push(issue("V2_REVIEW_TREE_MISMATCH", `${outcomeId} reviewed tree must equal its final commit tree.`, { outcomeId }));

    const universalHeader = ["Gate", "Check", "Result", "Evidence"];
    const universalRows = parseTable(childSection(block, "Universal Gates"), universalHeader);
    if (!universalRows) {
      issues.push(issue("INVALID_V2_REVIEW_GATES", `${outcomeId} must contain the canonical Universal Gates table.`, { outcomeId }));
    }
    const universalGates = universalRows ?? [];
    if (!exactSet(universalGates.map((row) => row.Gate), V2_UNIVERSAL_GATE_IDS)) {
      issues.push(issue("V2_REVIEW_GATE_SET_MISMATCH", `${outcomeId} must contain each universal gate exactly once.`, { outcomeId }));
    }
    for (const row of universalGates) {
      if (
        !GATE_RESULTS.has(row.Result)
        || row.Check.length === 0
        || row.Evidence.length === 0
        || hasUnresolvedEvidence(row.Result, row.Evidence)
      ) {
        issues.push(issue("INVALID_V2_REVIEW_GATES", `${outcomeId} has an invalid universal gate row for ${row.Gate || "(unknown)"}.`, { outcomeId }));
      }
    }

    const triggerHeader = ["Trigger", "Source", "Reason", "Check", "Result", "Gap", "Evidence"];
    const triggerRows = parseTable(childSection(block, "Triggered Checks"), triggerHeader);
    if (!triggerRows) issues.push(issue("INVALID_V2_REVIEW_TRIGGERS", `${outcomeId} must contain the canonical Triggered Checks table.`, { outcomeId }));
    const triggers = triggerRows ?? [];
    const triggerIds = triggers.map((row) => row.Trigger);
    if (new Set(triggerIds).size !== triggerIds.length) issues.push(issue("INVALID_V2_REVIEW_TRIGGERS", `${outcomeId} trigger IDs must be unique.`, { outcomeId }));
    for (const planned of expected.triggers) {
      const rows = triggers.filter((row) => row.Trigger === planned.id && row.Source === "planned");
      if (rows.length !== 1 || rows[0].Reason !== planned.reason) {
        issues.push(issue("V2_REVIEW_TRIGGER_SET_MISMATCH", `${outcomeId} must execute planned trigger ${planned.id} with its declared reason.`, { outcomeId }));
      }
    }
    for (const row of triggers) {
      if (
        !["planned", "discovered"].includes(row.Source)
        || row.Reason.length === 0
        || row.Check.length === 0
        || row.Evidence.length === 0
        || !GATE_RESULTS.has(row.Result)
        || !validGap(row.Gap)
        || !resultGapCoherent(row.Result, row.Gap)
        || hasUnresolvedEvidence(row.Result, row.Evidence)
      ) {
        issues.push(issue("INVALID_V2_REVIEW_TRIGGERS", `${outcomeId} has an invalid trigger row for ${row.Trigger || "(unknown)"}.`, { outcomeId }));
      }
    }

    const scenarioHeader = ["Scenario", "Claimed boundary", "Evidence", "Proven boundary", "Result", "Gap"];
    const scenarioRows = parseTable(childSection(block, "Scenario Coverage"), scenarioHeader);
    if (!scenarioRows) issues.push(issue("INVALID_V2_REVIEW_SCENARIOS", `${outcomeId} must contain the canonical Scenario Coverage table.`, { outcomeId }));
    const scenarios = scenarioRows ?? [];
    if (!exactSet(scenarios.map((row) => row.Scenario), expected.scenarios)) {
      issues.push(issue("V2_REVIEW_SCENARIO_SET_MISMATCH", `${outcomeId} Scenario rows must exactly equal its tasks.md Scenario set.`, { outcomeId }));
    }
    for (const row of scenarios) {
      if (
        row["Claimed boundary"].length === 0
        || row.Evidence.length === 0
        || row["Proven boundary"].length === 0
        || !GATE_RESULTS.has(row.Result)
        || !validGap(row.Gap)
        || !resultGapCoherent(row.Result, row.Gap)
        || (row.Result === "pass" && row["Claimed boundary"] !== row["Proven boundary"])
        || hasUnresolvedEvidence(row.Result, row.Evidence)
      ) {
        issues.push(issue("INVALID_V2_REVIEW_SCENARIOS", `${outcomeId} has an invalid Scenario row for ${row.Scenario || "(unknown)"}.`, { outcomeId }));
      }
    }

    for (const heading of ["Findings", "Remediation"]) {
      if (!childSection(block, heading)) issues.push(issue("INVALID_V2_REVIEW", `${outcomeId} must contain a ### ${heading} section.`, { outcomeId }));
    }
    const findings = childSection(block, "Findings");
    const hasUnresolvedFindings = hasFinding(findingSections(findings, "BLOCKING"))
      || hasFinding(findingSections(findings, "REQUIRED"));
    if (verdict === "ready" && hasUnresolvedFindings) {
      issues.push(issue("INVALID_V2_REVIEW_FINDINGS", `Ready outcome ${outcomeId} cannot retain BLOCKING or REQUIRED findings.`, { outcomeId }));
    }

    if (verdict === "ready") {
      if (
        candidate === "pending"
        || reviewedTree === "pending"
        || specAdherence !== "pass"
        || implementationQuality !== "pass"
        || universalGates.some((row) => row.Result !== "pass" || hasUnresolvedEvidence(row.Result, row.Evidence))
        || triggers.some((row) => !["pass", "accepted-gap"].includes(row.Result) || row.Gap === "required" || !resultGapCoherent(row.Result, row.Gap) || hasUnresolvedEvidence(row.Result, row.Evidence))
        || scenarios.some((row) => !["pass", "accepted-gap"].includes(row.Result) || row.Gap === "required" || !resultGapCoherent(row.Result, row.Gap) || hasUnresolvedEvidence(row.Result, row.Evidence))
        || hasUnresolvedFindings
      ) {
        issues.push(issue("INVALID_V2_REVIEW_VERDICT", `Ready outcome ${outcomeId} requires an exact candidate, reviewed tree, passing independent results and universal gates, and no unresolved trigger or Scenario finding.`, { outcomeId }));
      }
    }
    if (expected.status === "done") {
      const committedCandidate = /^(?:commit:)?([0-9a-f]{40})$/.exec(candidate);
      if (
        verdict !== "ready"
        || finalCommit === "pending"
        || reviewedTree !== finalCommitTree
        || committedCandidate?.[1] !== finalCommit
      ) {
        issues.push(issue("INVALID_V2_REVIEW_COMPLETION", `Done outcome ${outcomeId} requires a ready Review whose committed candidate equals its final commit and whose reviewed/final trees match.`, { outcomeId }));
      }
    }

    parsedOutcomes.push({
      id: outcomeId,
      repository,
      candidate,
      verdict,
      specAdherence,
      implementationQuality,
      manualAcceptance,
      reviewedTree,
      finalCommit,
      finalCommitTree,
      universalGates,
      triggers,
      scenarios,
    });
  }

  for (const expected of outcomes.filter((outcome) => outcome.status === "done")) {
    if (!seen.has(expected.id)) {
      issues.push(issue("MISSING_V2_REVIEW_OUTCOME", `Done outcome ${expected.id} requires a Review section.`, { outcomeId: expected.id }));
    }
  }

  return { record, outcomes: parsedOutcomes, issues };
}
