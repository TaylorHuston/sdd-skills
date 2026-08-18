import assert from "node:assert/strict";
import test from "node:test";

import { parseV2ChangeTasks } from "../src/change-tasks-v2.js";

export function v2Tasks({ status = "in progress" } = {}) {
  return [
    "# Tasks: Sample V2 Change",
    "",
    "## Resume Here",
    "",
    "- Change: `2026-08-17-sample`",
    "- Current outcome: S1",
    "- Phase: implementation",
    "- Next action: Run focused verification.",
    "- Blocker: none",
    "",
    "## Delivery Outcomes",
    "",
    "### S1: Validate the v2 contract",
    "",
    `- Status: ${status}`,
    "- Repository: `sample-web`",
    "- Requirements:",
    "  - New: `SAMPLE-E001/S1 R1` — V2 Changes use the compact contract.",
    "- Story changes:",
    "  - Update: `SAMPLE-E001/S1` — Add the v2 contract.",
    "- Outcome: V2 Changes validate without legacy closure artifacts.",
    "- Scenarios: `SAMPLE-E001/S1 R1-S1`",
    "- Dependencies: none",
    "- Binding constraints: Preserve schema-less historical readers.",
    "- Expected triggers:",
    "  - `contract-compatibility` — Prove v2 and schema-less records select separate validators.",
    "- Verification intent: Exercise transition and validation through their public APIs.",
    "- Manual acceptance: not required",
    "",
    "## Closeout",
    "",
    "- Remaining outcomes: S1",
    "- Review: pending",
    "- Manual acceptance: not required",
    "- Accepted gaps: none",
    "",
  ].join("\n");
}

function codes(result) {
  return result.issues.map((entry) => entry.code);
}

test("v2 tasks parse a compact delivery queue without legacy ledgers", () => {
  const result = parseV2ChangeTasks(v2Tasks(), {
    changeId: "2026-08-17-sample",
    repositoryIds: ["sample-web"],
  });

  assert.deepEqual(result.issues, []);
  assert.equal(result.outcomes.length, 1);
  assert.equal(result.outcomes[0].id, "S1");
  assert.deepEqual(result.outcomes[0].triggers, [{
    id: "contract-compatibility",
    reason: "Prove v2 and schema-less records select separate validators.",
  }]);
  assert.equal(result.resume.currentOutcome, "S1");
});

test("v2 tasks reject legacy ledgers and closure markers", () => {
  const source = `${v2Tasks()}\n## Implementation Ledger\n\n- Closure receipt: required\n`;
  const result = parseV2ChangeTasks(source, {
    changeId: "2026-08-17-sample",
    repositoryIds: ["sample-web"],
  });
  assert.ok(codes(result).includes("LEGACY_V2_ARTIFACT"));
});

test("v2 tasks reject unknown dependencies and missing planned triggers", () => {
  const unknownDependency = parseV2ChangeTasks(v2Tasks().replace("- Dependencies: none", "- Dependencies: S9"), {
    changeId: "2026-08-17-sample",
    repositoryIds: ["sample-web"],
  });
  assert.ok(codes(unknownDependency).includes("INVALID_V2_DEPENDENCY"));

  const missingTriggers = parseV2ChangeTasks(v2Tasks().replace(
    "- Expected triggers:\n  - `contract-compatibility` — Prove v2 and schema-less records select separate validators.\n",
    "",
  ), {
    changeId: "2026-08-17-sample",
    repositoryIds: ["sample-web"],
  });
  assert.ok(codes(missingTriggers).includes("INVALID_V2_OUTCOME"));
});
