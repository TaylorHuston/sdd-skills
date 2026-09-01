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

function withSecondOutcome(source, { status = "ready", dependencies = "S1" } = {}) {
  return source.replace("\n## Closeout\n", [
    "",
    "### S2: Continue the v2 contract",
    "",
    `- Status: ${status}`,
    "- Repository: `sample-web`",
    "- Requirements:",
    "  - New: `SAMPLE-E001/S2 R1` — Resume points to actionable work.",
    "- Story changes:",
    "  - Update: `SAMPLE-E001/S2` — Continue the v2 contract.",
    "- Outcome: The next actionable outcome is explicit.",
    "- Scenarios: `SAMPLE-E001/S2 R1-S1`",
    `- Dependencies: ${dependencies === "none" ? "none" : `\`${dependencies}\``}`,
    "- Binding constraints: Preserve completed outcome history.",
    "- Expected triggers: none",
    "- Verification intent: Validate the Resume checkpoint.",
    "- Manual acceptance: not required",
    "",
    "## Closeout",
    "",
  ].join("\n"));
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

test("v2 tasks reject stale or unactionable Resume outcomes", () => {
  const staleDone = parseV2ChangeTasks(withSecondOutcome(v2Tasks({ status: "done" })), {
    changeId: "2026-08-17-sample",
    repositoryIds: ["sample-web"],
  });
  assert.ok(codes(staleDone).includes("INVALID_V2_RESUME"));
  assert.match(staleDone.issues.find((entry) => entry.code === "INVALID_V2_RESUME").message, /terminal status "done"/);

  const deferred = parseV2ChangeTasks(v2Tasks({ status: "deferred" }), {
    changeId: "2026-08-17-sample",
    repositoryIds: ["sample-web"],
  });
  assert.ok(codes(deferred).includes("INVALID_V2_RESUME"));
  assert.match(deferred.issues.find((entry) => entry.code === "INVALID_V2_RESUME").message, /terminal status "deferred"/);

  const noCurrentWithUnfinishedWork = parseV2ChangeTasks(
    v2Tasks({ status: "ready" }).replace("- Current outcome: S1", "- Current outcome: none"),
    {
      changeId: "2026-08-17-sample",
      repositoryIds: ["sample-web"],
    },
  );
  assert.ok(codes(noCurrentWithUnfinishedWork).includes("INVALID_V2_RESUME"));
  assert.match(
    noCurrentWithUnfinishedWork.issues.find((entry) => entry.code === "INVALID_V2_RESUME").message,
    /must name unfinished work/,
  );

  const nextReady = parseV2ChangeTasks(
    withSecondOutcome(v2Tasks({ status: "done" })).replace("- Current outcome: S1", "- Current outcome: S2"),
    {
      changeId: "2026-08-17-sample",
      repositoryIds: ["sample-web"],
    },
  );
  assert.deepEqual(nextReady.issues, []);

  const selectedReadyWhileAnotherIsInProgress = parseV2ChangeTasks(
    withSecondOutcome(v2Tasks({ status: "in progress" }), { dependencies: "none" })
      .replace("- Current outcome: S1", "- Current outcome: S2"),
    {
      changeId: "2026-08-17-sample",
      repositoryIds: ["sample-web"],
    },
  );
  assert.ok(codes(selectedReadyWhileAnotherIsInProgress).includes("INVALID_V2_RESUME"));
  assert.match(
    selectedReadyWhileAnotherIsInProgress.issues.find((entry) => entry.code === "INVALID_V2_RESUME").message,
    /must identify an in-progress outcome/,
  );

  const selectedBlocked = parseV2ChangeTasks(v2Tasks({ status: "blocked" }), {
    changeId: "2026-08-17-sample",
    repositoryIds: ["sample-web"],
  });
  assert.deepEqual(selectedBlocked.issues, []);

  const unsatisfiedDependency = parseV2ChangeTasks(
    withSecondOutcome(v2Tasks({ status: "ready" })).replace("- Current outcome: S1", "- Current outcome: S2"),
    {
      changeId: "2026-08-17-sample",
      repositoryIds: ["sample-web"],
    },
  );
  assert.ok(codes(unsatisfiedDependency).includes("INVALID_V2_RESUME"));
  assert.match(
    unsatisfiedDependency.issues.find((entry) => entry.code === "INVALID_V2_RESUME").message,
    /not dependency-ready/,
  );

  const noCurrentWork = parseV2ChangeTasks(
    withSecondOutcome(v2Tasks({ status: "done" }), { status: "deferred" })
      .replace("- Current outcome: S1", "- Current outcome: none"),
    {
      changeId: "2026-08-17-sample",
      repositoryIds: ["sample-web"],
    },
  );
  assert.deepEqual(noCurrentWork.issues, []);
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
