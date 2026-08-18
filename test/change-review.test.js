import assert from "node:assert/strict";
import test from "node:test";

import {
  V2_UNIVERSAL_GATE_IDS,
  validateV2ChangeReviewSource,
} from "../src/change-review.js";

const candidate = `working-tree:${"a".repeat(40)}:sha256:${"b".repeat(64)}`;
const reviewedTree = "c".repeat(40);
const outcome = {
  id: "S1",
  repository: "sample-web",
  scenarios: ["SAMPLE-E001/S1 R1-S1"],
  triggers: [{
    id: "contract-compatibility",
    reason: "Prove explicit v2 and schema-less legacy routing.",
  }],
  manualAcceptance: "not required",
  status: "in progress",
};

function reviewSource() {
  return [
    "---",
    "schema: sdd-review-v2",
    "change: 2026-08-17-sample",
    "updated: 2026-08-17",
    "---",
    "# Review: Sample V2 Change",
    "",
    "## Outcome S1: Validate the v2 contract",
    "",
    "### Summary",
    "",
    "- Repository: `sample-web`",
    `- Candidate: ${candidate}`,
    "- Verdict: ready",
    "- Spec Adherence: pass",
    "- Implementation Quality: pass",
    "- Manual acceptance: not required",
    `- Reviewed tree: ${reviewedTree}`,
    "- Final commit: pending",
    "- Final commit tree: pending",
    "",
    "### Universal Gates",
    "",
    "| Gate | Check | Result | Evidence |",
    "|---|---|---|---|",
    ...V2_UNIVERSAL_GATE_IDS.map((gate) => `| ${gate} | Check ${gate}. | pass | \`test/change-review.test.js#valid review\` |`),
    "",
    "### Triggered Checks",
    "",
    "| Trigger | Source | Reason | Check | Result | Gap | Evidence |",
    "|---|---|---|---|---|---|---|",
    "| contract-compatibility | planned | Prove explicit v2 and schema-less legacy routing. | Validate both fixture families. | pass | none | `test/change-review.test.js#valid review` |",
    "",
    "### Scenario Coverage",
    "",
    "| Scenario | Claimed boundary | Evidence | Proven boundary | Result | Gap |",
    "|---|---|---|---|---|---|",
    "| SAMPLE-E001/S1 R1-S1 | backend/data | `test/change-review.test.js#valid review` | backend/data | pass | none |",
    "",
    "### Findings",
    "",
    "- None.",
    "",
    "### Remediation",
    "",
    "- None.",
    "",
  ].join("\n");
}

function codes(result) {
  return result.issues.map((entry) => entry.code);
}

test("v2 review validates one ready exact-candidate outcome without a receipt", () => {
  const result = validateV2ChangeReviewSource(reviewSource(), {
    changeId: "2026-08-17-sample",
    outcomes: [outcome],
  });

  assert.deepEqual(result.issues, []);
  assert.equal(result.outcomes[0].candidate, candidate);
  assert.equal(result.outcomes[0].universalGates.length, 5);
  assert.equal(result.outcomes[0].finalCommit, "pending");
});

test("v2 review requires all universal gates and every planned trigger", () => {
  const missingGate = validateV2ChangeReviewSource(
    reviewSource().replace(/^\| integrity-authority .*\n/m, ""),
    { changeId: "2026-08-17-sample", outcomes: [outcome] },
  );
  assert.ok(codes(missingGate).includes("V2_REVIEW_GATE_SET_MISMATCH"));

  const missingTrigger = validateV2ChangeReviewSource(
    reviewSource().replace(/^\| contract-compatibility .*\n/m, ""),
    { changeId: "2026-08-17-sample", outcomes: [outcome] },
  );
  assert.ok(codes(missingTrigger).includes("V2_REVIEW_TRIGGER_SET_MISMATCH"));
});

test("v2 ready verdict rejects trigger gaps without dated acceptance", () => {
  const undated = validateV2ChangeReviewSource(
    reviewSource().replace(
      "| pass | none | `test/change-review.test.js#valid review` |",
      "| accepted-gap | required | `test/change-review.test.js#valid review` |",
    ),
    { changeId: "2026-08-17-sample", outcomes: [outcome] },
  );
  assert.ok(codes(undated).includes("INVALID_V2_REVIEW_TRIGGERS"));
  assert.ok(codes(undated).includes("INVALID_V2_REVIEW_VERDICT"));
});

test("v2 ready verdict rejects required or invalid accepted gaps", () => {
  const required = validateV2ChangeReviewSource(
    reviewSource().replace("| backend/data | pass | none |", "| backend/data | findings | required |"),
    { changeId: "2026-08-17-sample", outcomes: [outcome] },
  );
  assert.ok(codes(required).includes("INVALID_V2_REVIEW_VERDICT"));

  const invalidAcceptance = validateV2ChangeReviewSource(
    reviewSource().replace("| backend/data | pass | none |", "| backend/data | accepted-gap | user-accepted:2026-02-31 |"),
    { changeId: "2026-08-17-sample", outcomes: [outcome] },
  );
  assert.ok(codes(invalidAcceptance).includes("INVALID_V2_REVIEW_SCENARIOS"));
});

test("v2 review keeps planned manual acceptance separate", () => {
  const missing = validateV2ChangeReviewSource(reviewSource(), {
    changeId: "2026-08-17-sample",
    outcomes: [{ ...outcome, manualAcceptance: "confirm the rendered workflow" }],
  });
  assert.ok(codes(missing).includes("V2_REVIEW_MANUAL_ACCEPTANCE_MISMATCH"));
});

test("done v2 outcomes require final commit and tree equality", () => {
  const result = validateV2ChangeReviewSource(reviewSource(), {
    changeId: "2026-08-17-sample",
    outcomes: [{ ...outcome, status: "done" }],
  });
  assert.ok(codes(result).includes("INVALID_V2_REVIEW_COMPLETION"));
});

export { candidate, outcome, reviewSource, reviewedTree };
