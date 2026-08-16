import assert from "node:assert/strict";
import test from "node:test";

import { SLICE_REVIEW_GATE_IDS, validateSliceReviewSource } from "../src/slice-review.js";

const candidate = "working-tree:0123456789abcdef0123456789abcdef01234567:sha256:" + "a".repeat(64);
const tree = "abcdef0123456789abcdef0123456789abcdef01";
const slice = {
  id: "S1",
  repository: "sample-web",
  scenarios: ["SAMPLE-E001/S1 R1-S1"],
  visual: {
    applicability: "required",
    reason: null,
    requirements: [{
      id: "V1",
      scenarios: ["SAMPLE-E001/S1 R1-S1"],
      description: "mobile state",
    }],
  },
};

function source({ verdict = "ready", gates = SLICE_REVIEW_GATE_IDS, scenarios = slice.scenarios, visuals = ["V1"] } = {}) {
  return [
    "---",
    "schema: sdd-slice-review-v1",
    "change: 2026-08-14-sample",
    "slice: S1",
    "repository: sample-web",
    `candidate: ${candidate}`,
    `reviewedTree: ${tree}`,
    `verdict: ${verdict}`,
    "reviewed: 2026-08-14",
    "---",
    "# Slice Review: S1",
    "",
    "## Gate Execution Manifest",
    "",
    "| Anchor | Gate | Result | Method / command | Candidate | Durable proof reference |",
    "|---|---|---|---|---|---|",
    ...gates.map((gate) => `| <a id=\"gate-${gate}\"></a> | ${gate} | pass | focused check | ${candidate} | \`tests/sample.test.js#proves behavior\` |`),
    "",
    "## Scenario Evidence Closure",
    "",
    "| Anchor | Scenario | Claimed boundary | Cited proof | Proven boundary | Evidence type | Durability / reproduction reference | Result | Gap |",
    "|---|---|---|---|---|---|---|---|---|",
    ...scenarios.map((scenario) => `| <a id=\"scenario-sample-e001-s1-r1-s1\"></a> | ${scenario} | backend/data | \`tests/sample.test.js#proves behavior\` | backend/data | automated | \`tests/sample.test.js#proves behavior\` | pass | none |`),
    "",
    "## Visual Verification",
    "",
    "| Anchor | Requirement | Scenarios | Obligation | Observed | Proof | Result | Gap |",
    "|---|---|---|---|---|---|---|---|",
    ...visuals.map((visual) => `| <a id=\"visual-${visual.toLowerCase()}\"></a> | ${visual} | SAMPLE-E001/S1 R1-S1 | mobile state | contained | \`docs/verification/sample.md#V1\` | pass | none |`),
    "",
  ].join("\n");
}

function validate(reviewSource, options = {}) {
  return validateSliceReviewSource(reviewSource, {
    changeId: "2026-08-14-sample",
    slice,
    ...options,
  });
}

function codes(result) {
  return result.issues.map((entry) => entry.code);
}

test("validates a durable final slice Review with exact gate, Scenario, and visual sets", () => {
  const result = validate(source());
  assert.deepEqual(result.issues, []);
  assert.equal(result.gates.length, 14);
  assert.equal(result.scenarios[0].anchor, "scenario-sample-e001-s1-r1-s1");
});

test("requires each canonical gate exactly once", () => {
  const result = validate(source({ gates: SLICE_REVIEW_GATE_IDS.slice(1) }));
  assert.ok(codes(result).includes("SLICE_REVIEW_GATE_SET_MISMATCH"));
});

test("requires exact Scenario and visual sets with unique explicit anchors", () => {
  const missingScenario = validate(source({ scenarios: [] }));
  assert.ok(codes(missingScenario).includes("SLICE_REVIEW_SCENARIO_SET_MISMATCH"));

  const missingVisual = validate(source({ visuals: [] }));
  assert.ok(codes(missingVisual).includes("SLICE_REVIEW_VISUAL_SET_MISMATCH"));

  const duplicateAnchor = validate(source().replace('id="visual-v1"', 'id="scenario-sample-e001-s1-r1-s1"'));
  assert.ok(codes(duplicateAnchor).includes("DUPLICATE_SLICE_REVIEW_ANCHOR"));
});

test("requires durable proof provenance and the exact planned visual contract", () => {
  const placeholderProof = validate(source().replaceAll("`tests/sample.test.js#proves behavior`", "TBD"));
  assert.ok(codes(placeholderProof).includes("INVALID_SLICE_REVIEW_GATES"));
  assert.ok(codes(placeholderProof).includes("INVALID_SLICE_REVIEW_SCENARIOS"));

  const wrongVisualScenario = validate(source().replace("| V1 | SAMPLE-E001/S1 R1-S1 |", "| V1 | SAMPLE-E001/S2 R1-S1 |"));
  assert.ok(codes(wrongVisualScenario).includes("INVALID_SLICE_REVIEW_VISUAL"));

  const wrongObligation = validate(source().replace("| mobile state | contained |", "| desktop state | contained |"));
  assert.ok(codes(wrongObligation).includes("INVALID_SLICE_REVIEW_VISUAL"));
});

test("ready reviews reject findings and required gaps", () => {
  const result = validate(source().replace(
    "| automated | `tests/sample.test.js#proves behavior` | pass | none |",
    "| automated | `tests/sample.test.js#proves behavior` | findings | required |",
  ));
  assert.ok(codes(result).includes("INVALID_SLICE_REVIEW_VERDICT"));
});
