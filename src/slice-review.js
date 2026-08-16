import { parseDocument } from "yaml";

import { durableEvidence } from "./slice-closure.js";

export const SLICE_REVIEW_SCHEMA = "sdd-slice-review-v1";

export const SLICE_REVIEW_GATE_IDS = Object.freeze([
  "artifact-truth",
  "canonical-map-authority",
  "source-vs-target",
  "pattern-conformance",
  "boundary-contracts",
  "reverse-traceability",
  "verification",
  "evidence-falsification",
  "risk-shaped-evidence",
  "security-data-safety",
  "rendered-ui",
  "manual-acceptance",
  "supporting-truth",
  "integration-readiness",
]);

const CANDIDATE_PATTERN = /^(?:[0-9a-f]{40}|commit:[0-9a-f]{40}|working-tree:[0-9a-f]{40}:sha256:[0-9a-f]{64})$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const REVIEW_KEYS = new Set([
  "schema",
  "change",
  "slice",
  "repository",
  "candidate",
  "reviewedTree",
  "verdict",
  "reviewed",
]);
const GATE_RESULTS = new Set(["pass", "findings", "blocked", "not-applicable"]);
const CLOSURE_RESULTS = new Set(["pass", "accepted-gap", "findings", "blocked"]);
const EVIDENCE_TYPES = new Set([
  "automated",
  "source-inspection",
  "artifact",
  "rendered",
  "live-multi-context",
  "provider-production",
  "manual-acceptance",
  "mixed",
]);
const SCENARIO_REFERENCE_PATTERN = /(?:[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*\/S[1-9]\d*|[A-Z][A-Z0-9]*-\d+) R[1-9]\d*-S[1-9]\d*/g;

function issue(code, message, context = {}) {
  return { code, message, ...context };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, allowed) {
  return isPlainObject(value) && Object.keys(value).every((key) => allowed.has(key));
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validGap(value) {
  return value === "none"
    || value === "required"
    || value === "manual-acceptance"
    || (typeof value === "string" && value.startsWith("optional-confidence:") && value.slice("optional-confidence:".length).trim().length > 0)
    || (typeof value === "string" && /^user-accepted:\d{4}-\d{2}-\d{2}$/.test(value) && validDate(value.slice("user-accepted:".length)));
}

function splitTableRow(line) {
  if (!line.trim().startsWith("|") || !line.trim().endsWith("|")) return null;
  return line.trim().slice(1, -1).split("|").map((cell) => cell.trim());
}

function tableAfterHeading(source, heading) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const marker = `## ${heading}`;
  const headingIndex = lines.findIndex((line) => line.trim() === marker);
  if (headingIndex < 0) return null;
  const section = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (/^#{1,2}\s+/.test(lines[index])) break;
    section.push(lines[index]);
  }
  const start = section.findIndex((line) => splitTableRow(line) !== null);
  if (start < 0) return null;
  const header = splitTableRow(section[start]);
  const separator = splitTableRow(section[start + 1] ?? "");
  if (!separator || !separator.every((cell) => /^:?-{3,}:?$/.test(cell))) return null;
  const rows = [];
  for (let index = start + 2; index < section.length; index += 1) {
    const cells = splitTableRow(section[index]);
    if (!cells) {
      if (section[index].trim().length === 0) continue;
      break;
    }
    rows.push(cells);
  }
  return { header, rows };
}

function anchorId(value) {
  return /^<a id="([a-z0-9][a-z0-9-]*)"><\/a>$/.exec(value)?.[1] ?? null;
}

function rowsByHeader(table, expectedHeader) {
  if (!table || table.header.length !== expectedHeader.length || table.header.some((cell, index) => cell !== expectedHeader[index])) {
    return null;
  }
  return table.rows.map((cells) => (
    cells.length === expectedHeader.length
      ? Object.fromEntries(expectedHeader.map((header, index) => [header, cells[index]]))
      : null
  ));
}

function exactSet(actual, expected) {
  return actual.length === expected.length
    && new Set(actual).size === actual.length
    && actual.every((value) => expected.includes(value));
}

function scenarioReferences(value) {
  return typeof value === "string" ? [...value.matchAll(SCENARIO_REFERENCE_PATTERN)].map((match) => match[0]) : [];
}

export function validateSliceReviewSource(source, { changeId, slice } = {}) {
  const issues = [];
  const proofValues = [];
  const frontmatterMatch = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  let record = null;
  if (!frontmatterMatch) {
    issues.push(issue("INVALID_SLICE_REVIEW", "Slice review requires YAML frontmatter.", { sliceId: slice?.id }));
  } else {
    const document = parseDocument(frontmatterMatch[1]);
    if (document.errors.length > 0) {
      issues.push(issue("INVALID_SLICE_REVIEW", `Cannot parse slice review frontmatter: ${document.errors[0].message}`, { sliceId: slice?.id }));
    } else {
      record = document.toJS();
    }
  }

  if (
    !exactKeys(record, REVIEW_KEYS)
    || record?.schema !== SLICE_REVIEW_SCHEMA
    || record?.change !== changeId
    || record?.slice !== slice?.id
    || record?.repository !== slice?.repository
    || !CANDIDATE_PATTERN.test(record?.candidate ?? "")
    || !SHA_PATTERN.test(record?.reviewedTree ?? "")
    || !["ready", "changes-requested", "blocked"].includes(record?.verdict)
    || !validDate(record?.reviewed)
  ) {
    issues.push(issue("INVALID_SLICE_REVIEW", `Slice review ${slice?.id ?? "(unknown)"} has invalid identity or frontmatter fields.`, { sliceId: slice?.id }));
  }

  const gateHeader = ["Anchor", "Gate", "Result", "Method / command", "Candidate", "Durable proof reference"];
  const gateRows = rowsByHeader(tableAfterHeading(source, "Gate Execution Manifest"), gateHeader);
  const gates = [];
  if (!gateRows || gateRows.some((row) => row === null)) {
    issues.push(issue("INVALID_SLICE_REVIEW_GATES", `Slice review ${slice?.id} must contain the canonical Gate Execution Manifest table.`, { sliceId: slice?.id }));
  } else {
    for (const row of gateRows) {
      const anchor = anchorId(row.Anchor);
      if (!anchor || anchor !== `gate-${row.Gate}` || !GATE_RESULTS.has(row.Result) || row["Method / command"].length === 0 || row.Candidate !== record?.candidate || !durableEvidence(row["Durable proof reference"])) {
        issues.push(issue("INVALID_SLICE_REVIEW_GATES", `Slice review ${slice?.id} has an invalid gate row for ${row.Gate || "(unknown)"}.`, { sliceId: slice?.id }));
      }
      gates.push({ anchor, gate: row.Gate, result: row.Result, proof: row["Durable proof reference"] });
      proofValues.push(row["Durable proof reference"]);
    }
    if (!exactSet(gates.map((entry) => entry.gate), SLICE_REVIEW_GATE_IDS)) {
      issues.push(issue("SLICE_REVIEW_GATE_SET_MISMATCH", `Slice review ${slice?.id} must contain each canonical gate exactly once.`, { sliceId: slice?.id }));
    }
  }

  const scenarioHeader = ["Anchor", "Scenario", "Claimed boundary", "Cited proof", "Proven boundary", "Evidence type", "Durability / reproduction reference", "Result", "Gap"];
  const scenarioRows = rowsByHeader(tableAfterHeading(source, "Scenario Evidence Closure"), scenarioHeader);
  const scenarios = [];
  if (!scenarioRows || scenarioRows.some((row) => row === null)) {
    issues.push(issue("INVALID_SLICE_REVIEW_SCENARIOS", `Slice review ${slice?.id} must contain the canonical Scenario Evidence Closure table.`, { sliceId: slice?.id }));
  } else {
    for (const row of scenarioRows) {
      const anchor = anchorId(row.Anchor);
      if (!anchor || !CLOSURE_RESULTS.has(row.Result) || !validGap(row.Gap) || row["Claimed boundary"].length === 0 || !durableEvidence(row["Cited proof"]) || row["Proven boundary"].length === 0 || !EVIDENCE_TYPES.has(row["Evidence type"]) || !durableEvidence(row["Durability / reproduction reference"])) {
        issues.push(issue("INVALID_SLICE_REVIEW_SCENARIOS", `Slice review ${slice?.id} has an invalid Scenario row for ${row.Scenario || "(unknown)"}.`, { sliceId: slice?.id }));
      }
      proofValues.push(row["Cited proof"], row["Durability / reproduction reference"]);
      scenarios.push({
        anchor,
        scenario: row.Scenario,
        citedProof: row["Cited proof"],
        evidenceType: row["Evidence type"],
        durabilityReference: row["Durability / reproduction reference"],
        result: row.Result,
        gap: row.Gap,
      });
    }
    if (!exactSet(scenarios.map((entry) => entry.scenario), slice?.scenarios ?? [])) {
      issues.push(issue("SLICE_REVIEW_SCENARIO_SET_MISMATCH", `Slice review ${slice?.id} Scenario rows must exactly equal the slice Scenario set.`, { sliceId: slice?.id }));
    }
  }

  const visualHeader = ["Anchor", "Requirement", "Scenarios", "Obligation", "Observed", "Proof", "Result", "Gap"];
  const visualRows = rowsByHeader(tableAfterHeading(source, "Visual Verification"), visualHeader);
  const visual = [];
  if (!visualRows || visualRows.some((row) => row === null)) {
    issues.push(issue("INVALID_SLICE_REVIEW_VISUAL", `Slice review ${slice?.id} must contain the canonical Visual Verification table.`, { sliceId: slice?.id }));
  } else {
    for (const row of visualRows) {
      const anchor = anchorId(row.Anchor);
      proofValues.push(row.Proof);
      if (row.Requirement === "not-applicable") {
        const validNotApplicable = slice?.visual?.applicability === "not-applicable"
          && anchor === "visual-not-applicable"
          && row.Scenarios === "none"
          && row.Obligation === slice?.visual?.reason
          && row.Observed === "not-applicable"
          && durableEvidence(row.Proof)
          && row.Result === "pass"
          && row.Gap === "none";
        if (!validNotApplicable) {
          issues.push(issue("INVALID_SLICE_REVIEW_VISUAL", `Slice review ${slice?.id} has an invalid not-applicable visual row.`, { sliceId: slice?.id }));
        }
        continue;
      }
      const planned = slice?.visual?.requirements?.find((entry) => entry.id === row.Requirement);
      const rowScenarios = scenarioReferences(row.Scenarios);
      const validPlannedContract = planned
        && exactSet(rowScenarios, planned.scenarios)
        && row.Obligation === planned.description;
      if (!anchor || !CLOSURE_RESULTS.has(row.Result) || !validGap(row.Gap) || !validPlannedContract || row.Observed.length === 0 || !durableEvidence(row.Proof)) {
        issues.push(issue("INVALID_SLICE_REVIEW_VISUAL", `Slice review ${slice?.id} has an invalid visual row for ${row.Requirement || "(unknown)"}.`, { sliceId: slice?.id }));
      }
      visual.push({
        anchor,
        requirement: row.Requirement,
        scenarios: rowScenarios,
        obligation: row.Obligation,
        proof: row.Proof,
        result: row.Result,
        gap: row.Gap,
      });
    }
    const expectedVisualIds = slice?.visual?.requirements?.map((entry) => entry.id) ?? [];
    const hasNotApplicableRow = visualRows.some((row) => row?.Requirement === "not-applicable");
    if (!exactSet(visual.map((entry) => entry.requirement), expectedVisualIds)
      || (slice?.visual?.applicability === "not-applicable" && (visualRows.length !== 1 || !hasNotApplicableRow))
      || (slice?.visual?.applicability === "required" && hasNotApplicableRow)) {
      issues.push(issue("SLICE_REVIEW_VISUAL_SET_MISMATCH", `Slice review ${slice?.id} visual rows must exactly equal the slice Visual requirements.`, { sliceId: slice?.id }));
    }
  }

  const visualAnchors = (visualRows ?? []).map((row) => anchorId(row?.Anchor ?? "")).filter(Boolean);
  const anchors = [...gates, ...scenarios].map((entry) => entry.anchor).filter(Boolean).concat(visualAnchors);
  if (new Set(anchors).size !== anchors.length) {
    issues.push(issue("DUPLICATE_SLICE_REVIEW_ANCHOR", `Slice review ${slice?.id} contains duplicate explicit anchors.`, { sliceId: slice?.id }));
  }

  if (record?.verdict === "ready") {
    if (gates.some((entry) => ["findings", "blocked"].includes(entry.result))
      || scenarios.some((entry) => ["findings", "blocked"].includes(entry.result) || entry.gap === "required")
      || visual.some((entry) => ["findings", "blocked"].includes(entry.result) || entry.gap === "required")) {
      issues.push(issue("INVALID_SLICE_REVIEW_VERDICT", `Ready slice review ${slice?.id} cannot retain findings, blocked rows, or required gaps.`, { sliceId: slice?.id }));
    }
  }

  return { record, gates, scenarios, visual, proofValues, issues };
}
