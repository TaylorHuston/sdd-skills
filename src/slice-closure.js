import { parseDocument } from "yaml";

export const LEGACY_SLICE_CLOSURE_SCHEMA = "sdd-slice-closure-v1";
export const SLICE_CLOSURE_SCHEMA = "sdd-slice-closure-v2";

const CANDIDATE_SOURCE = "(?:[0-9a-f]{40}|commit:[0-9a-f]{40}|working-tree:[0-9a-f]{40}:sha256:[0-9a-f]{64})";
const CANDIDATE_PATTERN = new RegExp(`^${CANDIDATE_SOURCE}$`);
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SCENARIO_RESULTS = new Set(["pass", "accepted-gap"]);
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
const ROOT_KEYS = new Set([
  "schema",
  "change",
  "slice",
  "repository",
  "updated",
  "finalReviewCandidate",
  "finalReviewVerdict",
  "finalReviewProof",
  "finalCommit",
  "finalCommitTree",
  "scenarios",
  "visual",
  "seal",
]);
const SCENARIO_KEYS = new Set([
  "scenario",
  "claimedBoundary",
  "provenBoundary",
  "evidenceType",
  "proof",
  "result",
  "gap",
]);
const VISUAL_KEYS = new Set(["applicability", "reason", "requirements"]);
const VISUAL_REQUIREMENT_KEYS = new Set([
  "requirement",
  "scenarios",
  "obligation",
  "observed",
  "proof",
  "result",
  "gap",
]);
const SEAL_KEYS = new Set(["reviewedTree", "finalCommitTree"]);
const EPHEMERAL_EVIDENCE_PATTERN = /(?:^|[\s`(])\/tmp\/|ephemeral(?: browser| profile)?|chat transcript|bare local observation|temporary-only|temporary capture|local observation/i;

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

function candidateFromResult(value) {
  if (typeof value !== "string") return null;
  return / @ (.+)$/.exec(value)?.[1] ?? null;
}

function finalReviewCandidate(gate) {
  if (typeof gate?.epicUpdate === "string" && gate.epicUpdate.startsWith("complete @ ")) {
    return candidateFromResult(gate.postEpicReview);
  }
  return candidateFromResult(gate?.implementationReview);
}

function inlineReferences(value) {
  if (typeof value !== "string") return [];
  return [...value.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function isDurableProofReference(value) {
  const reference = value.startsWith("change:") ? value.slice("change:".length) : value;
  const anchorIndex = reference.indexOf("#");
  const path = (anchorIndex >= 0 ? reference.slice(0, anchorIndex) : reference).replace(/^\.\//, "");
  const anchor = anchorIndex >= 0 ? reference.slice(anchorIndex + 1) : "";
  return path.length > 0
    && anchor.length > 0
    && !path.startsWith("/")
    && !path.startsWith("-")
    && !path.startsWith(":")
    && !path.startsWith("../")
    && !path.includes("/../")
    && !path.includes("\\")
    && !path.startsWith("slice-closures/")
    && !/\s/.test(path);
}

export function durableProofReferences(value) {
  return inlineReferences(value).filter(isDurableProofReference);
}

export function durableEvidence(value) {
  return typeof value === "string"
    && value.trim().length > 0
    && !/[<>]/.test(value)
    && !EPHEMERAL_EVIDENCE_PATTERN.test(value)
    && durableProofReferences(value).length > 0;
}

const durable = durableEvidence;

function exactSet(actual, expected) {
  return actual.length === expected.length
    && new Set(actual).size === actual.length
    && actual.every((value) => expected.includes(value));
}

function parseGap(value) {
  if (value === "none" || value === "manual-acceptance") {
    return { classification: value, date: null, policy: null, valid: true };
  }
  if (typeof value !== "string") return { classification: null, valid: false };
  if (value.startsWith("optional-confidence:")) {
    const policy = value.slice("optional-confidence:".length).trim();
    return { classification: "optional-confidence", date: null, policy, valid: durable(policy) };
  }
  if (value.startsWith("user-accepted:")) {
    const date = value.slice("user-accepted:".length).trim();
    return { classification: "user-accepted", date, policy: null, valid: validDate(date) };
  }
  return { classification: null, valid: false };
}

function acceptedGapDates(value) {
  const result = new Map();
  if (value === "none") return result;
  const date = /— user accepted (\d{4}-\d{2}-\d{2})\.$/.exec(value)?.[1] ?? null;
  for (const scenario of inlineReferences(value)) result.set(scenario, date);
  return result;
}

function validateLegacySliceClosureSource(source, { changeId, slice, gate } = {}) {
  const issues = [];
  let record;
  try {
    const document = parseDocument(source);
    if (document.errors.length > 0) {
      return {
        record: null,
        issues: [issue("INVALID_SLICE_CLOSURE", `Cannot parse slice closure YAML: ${document.errors[0].message}`, { sliceId: slice?.id })],
      };
    }
    record = document.toJS();
  } catch (error) {
    return {
      record: null,
      issues: [issue("INVALID_SLICE_CLOSURE", `Cannot parse slice closure YAML: ${error.message}`, { sliceId: slice?.id })],
    };
  }
  if (!isPlainObject(record)) {
    return { record: null, issues: [issue("INVALID_SLICE_CLOSURE", "Slice closure must be a YAML mapping.", { sliceId: slice?.id })] };
  }

  if (
    !exactKeys(record, ROOT_KEYS)
    || record.schema !== LEGACY_SLICE_CLOSURE_SCHEMA
    || record.change !== changeId
    || record.slice !== slice?.id
    || record.repository !== slice?.repository
    || !validDate(record.updated)
    || !CANDIDATE_PATTERN.test(record.finalReviewCandidate ?? "")
    || record.finalReviewVerdict !== "ready"
    || !durable(record.finalReviewProof)
    || !SHA_PATTERN.test(record.finalCommit ?? "")
    || !SHA_PATTERN.test(record.finalCommitTree ?? "")
  ) {
    issues.push(issue("INVALID_SLICE_CLOSURE", `Slice closure ${slice?.id ?? "(unknown)"} has invalid or unknown top-level fields.`, { sliceId: slice?.id }));
  }
  if (!durable(record.finalReviewProof)) {
    issues.push(issue("NON_DURABLE_SLICE_EVIDENCE", `Slice closure ${slice?.id} lacks an anchored durable final Review proof.`, { sliceId: slice?.id }));
  }

  const expectedCandidate = finalReviewCandidate(gate);
  if (expectedCandidate === null || record.finalReviewCandidate !== expectedCandidate || record.finalCommit !== gate?.finalCommit) {
    issues.push(issue("SLICE_CLOSURE_CANDIDATE_MISMATCH", `Slice closure ${slice?.id} must match the Gate Ledger final Review candidate and final commit.`, { sliceId: slice?.id }));
  }

  const scenarioRows = Array.isArray(record.scenarios) ? record.scenarios : [];
  const scenarioIds = scenarioRows.map((entry) => entry?.scenario);
  if (!exactSet(scenarioIds, slice?.scenarios ?? [])) {
    issues.push(issue("SLICE_CLOSURE_SCENARIO_SET_MISMATCH", `Slice closure ${slice?.id} Scenario rows must exactly equal the slice Scenario set.`, { sliceId: slice?.id }));
  }
  const acceptedInClosure = new Map();
  for (const entry of scenarioRows) {
    const gap = parseGap(entry?.gap);
    const rowValid = exactKeys(entry, SCENARIO_KEYS)
      && SCENARIO_RESULTS.has(entry.result)
      && EVIDENCE_TYPES.has(entry.evidenceType)
      && typeof entry.claimedBoundary === "string"
      && entry.claimedBoundary.trim().length > 0
      && typeof entry.provenBoundary === "string"
      && entry.provenBoundary.trim().length > 0
      && durable(entry.proof)
      && gap.valid
      && (
        (entry.result === "pass" && ["none", "optional-confidence", "manual-acceptance"].includes(gap.classification))
        || (entry.result === "accepted-gap" && gap.classification === "user-accepted")
      )
      && (gap.classification !== "manual-acceptance" || entry.evidenceType === "manual-acceptance");
    if (!rowValid) {
      issues.push(issue("INVALID_SLICE_CLOSURE", `Slice closure ${slice?.id} has an invalid Scenario row for ${entry?.scenario ?? "(unknown)"}.`, { sliceId: slice?.id }));
    }
    if (!durable(entry?.proof)) {
      issues.push(issue("NON_DURABLE_SLICE_EVIDENCE", `Slice closure ${slice?.id} Scenario ${entry?.scenario ?? "(unknown)"} lacks anchored durable proof.`, { sliceId: slice?.id }));
    }
    if (entry?.result === "pass" && entry.claimedBoundary !== entry.provenBoundary) {
      issues.push(issue("INVALID_SLICE_CLOSURE", `Slice closure ${slice?.id} Scenario ${entry.scenario} claims a boundary its proof does not exercise.`, { sliceId: slice?.id }));
    }
    if (entry?.result === "accepted-gap" && gap.classification === "user-accepted") {
      acceptedInClosure.set(entry.scenario, gap.date);
    }
  }

  const acceptedInLedger = acceptedGapDates(gate?.acceptedGaps);
  if (
    acceptedInClosure.size !== acceptedInLedger.size
    || [...acceptedInClosure].some(([scenario, date]) => acceptedInLedger.get(scenario) !== date)
  ) {
    issues.push(issue("SLICE_CLOSURE_GAP_MISMATCH", `Slice closure ${slice?.id} accepted gaps must exactly match the Slice Gate Ledger.`, { sliceId: slice?.id }));
  }

  const visual = exactKeys(record.visual, VISUAL_KEYS) ? record.visual : null;
  const visualRequirements = Array.isArray(visual?.requirements) ? visual.requirements : [];
  const expectedVisualIds = slice?.visual?.requirements?.map((entry) => entry.id) ?? [];
  const visualIds = visualRequirements.map((entry) => entry?.requirement);
  if (
    visual?.applicability !== slice?.visual?.applicability
    || visual?.reason !== slice?.visual?.reason
    || !exactSet(visualIds, expectedVisualIds)
  ) {
    issues.push(issue("SLICE_CLOSURE_VISUAL_SET_MISMATCH", `Slice closure ${slice?.id} visual rows must exactly equal the slice Visual requirements.`, { sliceId: slice?.id }));
  }
  if (slice?.visual?.applicability === "not-applicable") {
    if (visualRequirements.length !== 0) {
      issues.push(issue("SLICE_CLOSURE_VISUAL_SET_MISMATCH", `Non-UI slice ${slice?.id} must have no visual rows.`, { sliceId: slice?.id }));
    }
  } else if (slice?.visual?.applicability === "required") {
    for (const entry of visualRequirements) {
      const planned = slice.visual.requirements.find((item) => item.id === entry?.requirement);
      const gap = parseGap(entry?.gap);
      if (
        !exactKeys(entry, VISUAL_REQUIREMENT_KEYS)
        || !planned
        || !exactSet(Array.isArray(entry.scenarios) ? entry.scenarios : [], planned.scenarios)
        || entry.obligation !== planned?.description
        || typeof entry.observed !== "string"
        || entry.observed.trim().length === 0
        || !SCENARIO_RESULTS.has(entry.result)
        || !durable(entry.proof)
        || !gap.valid
        || (entry.result === "pass" && gap.classification !== "none")
        || (entry.result === "accepted-gap" && gap.classification !== "user-accepted")
        || (entry.result === "accepted-gap" && entry.scenarios.some((scenario) => acceptedInClosure.get(scenario) !== gap.date))
      ) {
        issues.push(issue("INVALID_SLICE_CLOSURE", `Slice closure ${slice?.id} has an invalid visual row for ${entry?.requirement ?? "(unknown)"}.`, { sliceId: slice?.id }));
      }
      if (!durable(entry?.proof)) {
        issues.push(issue("NON_DURABLE_SLICE_EVIDENCE", `Slice closure ${slice?.id} visual requirement ${entry?.requirement ?? "(unknown)"} lacks anchored durable proof.`, { sliceId: slice?.id }));
      }
    }
  }

  const seal = exactKeys(record.seal, SEAL_KEYS) ? record.seal : null;
  const committedCandidate = /^(?:commit:)?([0-9a-f]{40})$/.exec(record.finalReviewCandidate ?? "");
  if (
    seal?.reviewedTree !== record.finalCommitTree
    || seal?.finalCommitTree !== record.finalCommitTree
    || (committedCandidate !== null && committedCandidate[1] !== record.finalCommit)
  ) {
    issues.push(issue("INVALID_SLICE_CLOSURE_SEAL", `Slice closure ${slice?.id} reviewed tree must equal its final commit tree and candidate.`, { sliceId: slice?.id }));
  }

  return { record, issues };
}

const V2_ROOT_KEYS = new Set([
  "schema",
  "change",
  "slice",
  "repository",
  "updated",
  "review",
  "scenarios",
  "visual",
  "seal",
]);
const V2_REVIEW_KEYS = new Set(["path", "candidate", "verdict", "sha256"]);
const V2_SCENARIO_KEYS = new Set(["scenario", "result", "gap", "reviewAnchor"]);
const V2_VISUAL_KEYS = new Set(["applicability", "reason", "requirements"]);
const V2_VISUAL_REQUIREMENT_KEYS = new Set(["requirement", "result", "gap", "reviewAnchor"]);
const V2_SEAL_KEYS = new Set(["finalCommit", "reviewedTree", "finalCommitTree"]);
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const REVIEW_ANCHOR_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function parseClosureRecord(source, sliceId) {
  try {
    const document = parseDocument(source);
    if (document.errors.length > 0) {
      return {
        record: null,
        issues: [issue("INVALID_SLICE_CLOSURE", `Cannot parse slice closure YAML: ${document.errors[0].message}`, { sliceId })],
      };
    }
    const record = document.toJS();
    if (!isPlainObject(record)) {
      return { record: null, issues: [issue("INVALID_SLICE_CLOSURE", "Slice closure must be a YAML mapping.", { sliceId })] };
    }
    return { record, issues: [] };
  } catch (error) {
    return {
      record: null,
      issues: [issue("INVALID_SLICE_CLOSURE", `Cannot parse slice closure YAML: ${error.message}`, { sliceId })],
    };
  }
}

function validV2GapResult(entry) {
  const gap = parseGap(entry?.gap);
  return gap.valid && (
    (entry?.result === "pass" && ["none", "optional-confidence", "manual-acceptance"].includes(gap.classification))
    || (entry?.result === "accepted-gap" && gap.classification === "user-accepted")
  );
}

function validateV2SliceClosureSource(source, { changeId, slice, gate } = {}) {
  const parsed = parseClosureRecord(source, slice?.id);
  if (parsed.record === null) return parsed;
  const { record } = parsed;
  const issues = [];
  const expectedReviewPath = `slice-reviews/${slice?.id}.md`;

  if (
    !exactKeys(record, V2_ROOT_KEYS)
    || record.schema !== SLICE_CLOSURE_SCHEMA
    || record.change !== changeId
    || record.slice !== slice?.id
    || record.repository !== slice?.repository
    || !validDate(record.updated)
  ) {
    issues.push(issue("INVALID_SLICE_CLOSURE", `Slice closure ${slice?.id ?? "(unknown)"} has invalid or unknown top-level fields.`, { sliceId: slice?.id }));
  }

  const review = exactKeys(record.review, V2_REVIEW_KEYS) ? record.review : null;
  if (
    review?.path !== expectedReviewPath
    || !CANDIDATE_PATTERN.test(review?.candidate ?? "")
    || review?.verdict !== "ready"
    || !DIGEST_PATTERN.test(review?.sha256 ?? "")
  ) {
    issues.push(issue("INVALID_SLICE_CLOSURE_REVIEW", `Slice closure ${slice?.id} must bind the canonical durable ready slice review and its SHA-256 digest.`, { sliceId: slice?.id }));
  }
  const expectedCandidate = finalReviewCandidate(gate);
  if (expectedCandidate === null || review?.candidate !== expectedCandidate) {
    issues.push(issue("SLICE_CLOSURE_CANDIDATE_MISMATCH", `Slice closure ${slice?.id} review candidate must match the Gate Ledger final Review candidate.`, { sliceId: slice?.id }));
  }

  const scenarioRows = Array.isArray(record.scenarios) ? record.scenarios : [];
  if (!exactSet(scenarioRows.map((entry) => entry?.scenario), slice?.scenarios ?? [])) {
    issues.push(issue("SLICE_CLOSURE_SCENARIO_SET_MISMATCH", `Slice closure ${slice?.id} Scenario rows must exactly equal the slice Scenario set.`, { sliceId: slice?.id }));
  }
  const acceptedInClosure = new Map();
  for (const entry of scenarioRows) {
    if (
      !exactKeys(entry, V2_SCENARIO_KEYS)
      || !SCENARIO_RESULTS.has(entry.result)
      || !validV2GapResult(entry)
      || !REVIEW_ANCHOR_PATTERN.test(entry.reviewAnchor ?? "")
    ) {
      issues.push(issue("INVALID_SLICE_CLOSURE", `Slice closure ${slice?.id} has an invalid Scenario row for ${entry?.scenario ?? "(unknown)"}.`, { sliceId: slice?.id }));
    }
    const gap = parseGap(entry?.gap);
    if (entry?.result === "accepted-gap" && gap.classification === "user-accepted") {
      acceptedInClosure.set(entry.scenario, gap.date);
    }
  }

  const acceptedInLedger = acceptedGapDates(gate?.acceptedGaps);
  if (
    acceptedInClosure.size !== acceptedInLedger.size
    || [...acceptedInClosure].some(([scenario, date]) => acceptedInLedger.get(scenario) !== date)
  ) {
    issues.push(issue("SLICE_CLOSURE_GAP_MISMATCH", `Slice closure ${slice?.id} accepted gaps must exactly match the Slice Gate Ledger.`, { sliceId: slice?.id }));
  }

  const visual = exactKeys(record.visual, V2_VISUAL_KEYS) ? record.visual : null;
  const visualRows = Array.isArray(visual?.requirements) ? visual.requirements : [];
  const expectedVisualIds = slice?.visual?.requirements?.map((entry) => entry.id) ?? [];
  if (
    visual?.applicability !== slice?.visual?.applicability
    || visual?.reason !== slice?.visual?.reason
    || !exactSet(visualRows.map((entry) => entry?.requirement), expectedVisualIds)
  ) {
    issues.push(issue("SLICE_CLOSURE_VISUAL_SET_MISMATCH", `Slice closure ${slice?.id} visual rows must exactly equal the slice Visual requirements.`, { sliceId: slice?.id }));
  }
  for (const entry of visualRows) {
    if (
      !exactKeys(entry, V2_VISUAL_REQUIREMENT_KEYS)
      || !SCENARIO_RESULTS.has(entry.result)
      || !validV2GapResult(entry)
      || !REVIEW_ANCHOR_PATTERN.test(entry.reviewAnchor ?? "")
    ) {
      issues.push(issue("INVALID_SLICE_CLOSURE", `Slice closure ${slice?.id} has an invalid visual row for ${entry?.requirement ?? "(unknown)"}.`, { sliceId: slice?.id }));
    }
  }

  const reviewAnchors = [
    ...scenarioRows.map((entry) => entry?.reviewAnchor),
    ...visualRows.map((entry) => entry?.reviewAnchor),
  ];
  if (reviewAnchors.some((anchor) => !REVIEW_ANCHOR_PATTERN.test(anchor ?? "")) || new Set(reviewAnchors).size !== reviewAnchors.length) {
    issues.push(issue("DUPLICATE_SLICE_REVIEW_ANCHOR", `Slice closure ${slice?.id} review anchors must be unique and well formed.`, { sliceId: slice?.id }));
  }

  const seal = exactKeys(record.seal, V2_SEAL_KEYS) ? record.seal : null;
  const committedCandidate = /^(?:commit:)?([0-9a-f]{40})$/.exec(review?.candidate ?? "");
  if (
    !SHA_PATTERN.test(seal?.finalCommit ?? "")
    || !SHA_PATTERN.test(seal?.reviewedTree ?? "")
    || !SHA_PATTERN.test(seal?.finalCommitTree ?? "")
    || seal?.finalCommit !== gate?.finalCommit
    || seal?.reviewedTree !== seal?.finalCommitTree
    || (committedCandidate !== null && committedCandidate[1] !== seal?.finalCommit)
  ) {
    issues.push(issue("INVALID_SLICE_CLOSURE_SEAL", `Slice closure ${slice?.id} must seal the Gate Ledger commit with identical reviewed and final trees.`, { sliceId: slice?.id }));
  }

  return { record, issues };
}

export function validateSliceClosureSource(source, options = {}) {
  const parsed = parseClosureRecord(source, options.slice?.id);
  if (parsed.record === null) return parsed;
  if (parsed.record.schema === LEGACY_SLICE_CLOSURE_SCHEMA) {
    return validateLegacySliceClosureSource(source, options);
  }
  if (parsed.record.schema === SLICE_CLOSURE_SCHEMA) {
    return validateV2SliceClosureSource(source, options);
  }
  return {
    record: parsed.record,
    issues: [issue("INVALID_SLICE_CLOSURE", `Unsupported slice closure schema: ${parsed.record.schema ?? "(missing)"}.`, { sliceId: options.slice?.id })],
  };
}
