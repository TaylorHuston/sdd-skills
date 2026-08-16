import assert from "node:assert/strict";
import test from "node:test";

import { validateSliceClosureSource } from "../src/slice-closure.js";

const candidate = "commit:0123456789abcdef0123456789abcdef01234567";
const finalCommit = "0123456789abcdef0123456789abcdef01234567";
const finalTree = "abcdef0123456789abcdef0123456789abcdef01";
const proof = "`tests/sample.test.js#exposes the behavior`";

const slice = {
  id: "S1",
  repository: "sample-web",
  scenarios: ["SAMPLE-E001/S1 R1-S1"],
  visual: {
    applicability: "not-applicable",
    reason: "No rendered UI surface.",
    requirements: [],
  },
};

const gate = {
  implementationReview: `ready @ ${candidate}`,
  epicUpdate: `no-op @ ${candidate}`,
  postEpicReview: "not required",
  requiredGaps: "none",
  acceptedGaps: "none",
  finalCommit,
};

function closure({
  scenarios = slice.scenarios,
  visual = { applicability: "not-applicable", requirements: [] },
  scenarioResult = "pass",
  scenarioGap = "none",
  citedProof = proof,
  reviewProof = "`change:review.md#Final slice review`",
} = {}) {
  return [
    "schema: sdd-slice-closure-v1",
    "change: 2026-08-14-sample",
    "slice: S1",
    "repository: sample-web",
    "updated: 2026-08-14",
    `finalReviewCandidate: ${candidate}`,
    "finalReviewVerdict: ready",
    `finalReviewProof: ${JSON.stringify(reviewProof)}`,
    `finalCommit: ${finalCommit}`,
    `finalCommitTree: ${finalTree}`,
    "scenarios:",
    ...scenarios.map((scenario) => [
      `  - scenario: ${scenario}`,
      "    claimedBoundary: public behavior",
      "    provenBoundary: public behavior",
      "    evidenceType: automated",
      `    proof: ${JSON.stringify(citedProof)}`,
      `    result: ${scenarioResult}`,
      `    gap: ${scenarioGap}`,
    ].join("\n")),
    "visual:",
    `  applicability: ${visual.applicability}`,
    `  reason: ${visual.applicability === "not-applicable" ? JSON.stringify(slice.visual.reason) : "null"}`,
    "  requirements:",
    ...(visual.requirements.length === 0
      ? ["    []"]
      : visual.requirements.map((item) => [
        `    - requirement: ${item.requirement}`,
        `      scenarios: [${item.scenarios.join(", ")}]`,
        `      obligation: ${JSON.stringify("390x844 long-content recovery state.")}`,
        "      observed: Long content remained contained and recovery restored the ready state.",
        `      proof: ${JSON.stringify(citedProof)}`,
        `      result: ${item.result ?? "pass"}`,
        `      gap: ${item.gap ?? "none"}`,
      ].join("\n"))),
    "seal:",
    `  reviewedTree: ${finalTree}`,
    `  finalCommitTree: ${finalTree}`,
    "",
  ].join("\n");
}

function v2Closure({
  scenarios = slice.scenarios,
  reviewSha256 = "b".repeat(64),
  reviewAnchor = "scenario-sample-e001-s1-r1-s1",
} = {}) {
  return [
    "schema: sdd-slice-closure-v2",
    "change: 2026-08-14-sample",
    "slice: S1",
    "repository: sample-web",
    "updated: 2026-08-14",
    "review:",
    "  path: slice-reviews/S1.md",
    `  candidate: ${candidate}`,
    "  verdict: ready",
    `  sha256: ${reviewSha256}`,
    "scenarios:",
    ...scenarios.map((scenario) => [
      `  - scenario: ${scenario}`,
      "    result: pass",
      "    gap: none",
      `    reviewAnchor: ${reviewAnchor}`,
    ].join("\n")),
    "visual:",
    "  applicability: not-applicable",
    `  reason: ${JSON.stringify(slice.visual.reason)}`,
    "  requirements: []",
    "seal:",
    `  finalCommit: ${finalCommit}`,
    `  reviewedTree: ${finalTree}`,
    `  finalCommitTree: ${finalTree}`,
    "",
  ].join("\n");
}

function codes(result) {
  return result.issues.map((entry) => entry.code);
}

function validate(source, options = {}) {
  return validateSliceClosureSource(source, {
    changeId: "2026-08-14-sample",
    slice,
    gate,
    ...options,
  });
}

test("validates a minimal v2 closure receipt while retaining legacy v1", () => {
  const current = validate(v2Closure());
  assert.deepEqual(current.issues, []);
  assert.equal(current.record.schema, "sdd-slice-closure-v2");

  const legacy = validate(closure());
  assert.deepEqual(legacy.issues, []);
  assert.equal(legacy.record.schema, "sdd-slice-closure-v1");
});

test("v2 receipt requires canonical Review binding, exact sets, and unique anchors", () => {
  const wrongPath = validate(v2Closure().replace("slice-reviews/S1.md", "tasks.md"));
  assert.ok(codes(wrongPath).includes("INVALID_SLICE_CLOSURE_REVIEW"));

  const wrongDigest = validate(v2Closure({ reviewSha256: "short" }));
  assert.ok(codes(wrongDigest).includes("INVALID_SLICE_CLOSURE_REVIEW"));

  const wrongSet = validate(v2Closure({ scenarios: ["SAMPLE-E001/S1 R9-S9"] }));
  assert.ok(codes(wrongSet).includes("SLICE_CLOSURE_SCENARIO_SET_MISMATCH"));
});

test("validates a compact non-UI slice closure", () => {
  const result = validate(closure());
  assert.deepEqual(result.issues, []);
  assert.equal(result.record.slice, "S1");

  const wrongReason = validate(closure().replace(
    "  reason: \"No rendered UI surface.\"",
    "  reason: \"Different reason.\"",
  ));
  assert.ok(codes(wrongReason).includes("SLICE_CLOSURE_VISUAL_SET_MISMATCH"));
});

test("requires the exact Scenario set", () => {
  const result = validate(closure({ scenarios: ["SAMPLE-E001/S1 R9-S9"] }));
  assert.ok(codes(result).includes("SLICE_CLOSURE_SCENARIO_SET_MISMATCH"));
});

test("rejects stale candidates and non-durable proof", () => {
  const stale = validate(closure().replaceAll(candidate, `commit:${"a".repeat(40)}`));
  assert.ok(codes(stale).includes("SLICE_CLOSURE_CANDIDATE_MISMATCH"));

  for (const citedProof of [
    "/tmp/review.png from local observation",
    "<durable exact proof reference>",
    "review completed successfully",
  ]) {
    const result = validate(closure({ citedProof }));
    assert.ok(codes(result).includes("NON_DURABLE_SLICE_EVIDENCE"));
  }
});

test("reconciles dated accepted gaps with the Gate Ledger", () => {
  const acceptedGate = {
    ...gate,
    acceptedGaps: "`SAMPLE-E001/S1 R1-S1` — user accepted 2026-08-14.",
  };
  const valid = validateSliceClosureSource(closure({
    scenarioResult: "accepted-gap",
    scenarioGap: "user-accepted:2026-08-14",
  }), {
    changeId: "2026-08-14-sample",
    slice,
    gate: acceptedGate,
  });
  assert.deepEqual(valid.issues, []);

  const mismatch = validateSliceClosureSource(closure({
    scenarioResult: "accepted-gap",
    scenarioGap: "user-accepted:2026-08-15",
  }), {
    changeId: "2026-08-14-sample",
    slice,
    gate: acceptedGate,
  });
  assert.ok(codes(mismatch).includes("SLICE_CLOSURE_GAP_MISMATCH"));
});

test("binds the reviewed tree and committed candidate to the final commit", () => {
  const differentCommit = "a".repeat(40);
  const candidateMismatch = validateSliceClosureSource(
    closure().replace(`finalCommit: ${finalCommit}`, `finalCommit: ${differentCommit}`),
    { changeId: "2026-08-14-sample", slice, gate: { ...gate, finalCommit: differentCommit } },
  );
  assert.ok(codes(candidateMismatch).includes("INVALID_SLICE_CLOSURE_SEAL"));

  const treeMismatch = validate(
    closure().replace(`  reviewedTree: ${finalTree}`, `  reviewedTree: ${"b".repeat(40)}`),
  );
  assert.ok(codes(treeMismatch).includes("INVALID_SLICE_CLOSURE_SEAL"));
});

test("requires exact visual obligation coverage for UI slices", () => {
  const uiSlice = {
    ...slice,
    visual: {
      applicability: "required",
      reason: null,
      requirements: [{ id: "V1", scenarios: slice.scenarios, description: "390x844 long-content recovery state." }],
    },
  };
  const missing = validate(closure(), { slice: uiSlice });
  assert.ok(codes(missing).includes("SLICE_CLOSURE_VISUAL_SET_MISMATCH"));

  const validSource = closure({
    visual: { applicability: "required", requirements: [{ requirement: "V1", scenarios: slice.scenarios }] },
  });
  const valid = validate(validSource, { slice: uiSlice });
  assert.deepEqual(valid.issues, []);

  const wrongObligation = validate(validSource.replace(
    "      obligation: \"390x844 long-content recovery state.\"",
    "      obligation: \"desktop happy path.\"",
  ), { slice: uiSlice });
  assert.ok(codes(wrongObligation).includes("INVALID_SLICE_CLOSURE"));
});
