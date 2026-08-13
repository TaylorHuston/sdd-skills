import assert from "node:assert/strict";
import test from "node:test";

import { parseStructuredChangeTasks } from "../src/change-tasks.js";

function tasks({
  secondSlice = false,
  dependency = "none",
  sliceStatus = "ready",
  ledgerStatus = "not started",
  resumeSlice = "S1",
} = {}) {
  return [
    "# Tasks: Sample",
    "",
    "## Resume Here",
    "",
    "- Change: `2026-08-14-sample`",
    `- Current slice: ${resumeSlice}`,
    "- Phase: planned",
    "- Verification candidate: pending",
    "- Review candidate: pending",
    "- Epic-update candidate: pending",
    "- Changelog candidate: pending",
    "- Acceptance candidate: not required",
    "- Open finding / blocker: none",
    "",
    "| Repository | Root | Baseline | Candidate kind | Candidate watermark |",
    "|---|---|---|---|---|",
    "| `sample-web` | `code/sample-web` | not captured | not started | not captured |",
    "",
    "## Requirement Slices",
    "",
    "### S1: Expose the behavior",
    "",
    `- Status: ${sliceStatus}`,
    "- Repository: `sample-web`",
    "- Requirements:",
    "  - New: `SAMPLE-E001/S1 R1` — The behavior is available.",
    "- Story changes:",
    "  - Update: `SAMPLE-E001/S1` — Add the behavior.",
    "- Outcome: Callers observe the behavior.",
    "- Scenarios: `SAMPLE-E001/S1 R1-S1`",
    `- Dependencies: ${dependency}`,
    "- Binding constraints: Preserve the public boundary.",
    "- Verification intent: Exercise the public behavior.",
    "- Manual acceptance: not required",
    ...(secondSlice ? [
      "",
      "### S2: Consume the behavior",
      "",
      "- Status: blocked",
      "- Repository: `sample-web`",
      "- Requirements:",
      "  - Revised: `SAMPLE-E001/S2 R1` — The consumer uses the behavior.",
      "- Story changes:",
      "  - Update: `SAMPLE-E001/S2` — Use the behavior.",
      "- Outcome: Consumers observe the result.",
      "- Scenarios: `SAMPLE-E001/S2 R1-S1`",
      "- Dependencies: S1",
      "- Binding constraints: Preserve compatibility.",
      "- Consumes: The S1 public boundary.",
      "- Verification intent: Exercise the consumer.",
      "- Manual acceptance: not required",
    ] : []),
    "",
    "## Implementation Ledger",
    "",
    "| Slice | Repository | Status | Implementation Summary / Changed Surface | Updated |",
    "|---|---|---|---|---|",
    `| S1 | \`sample-web\` | ${ledgerStatus} | None yet. | 2026-08-14 |`,
    ...(secondSlice ? ["| S2 | `sample-web` | blocked | Waiting on S1. | 2026-08-14 |"] : []),
    "",
    "## Blockers / Open Questions",
    "",
    "- None.",
    "",
    "## Closeout",
    "",
    "- Remaining slices: S1",
    "",
  ].join("\n");
}

function codes(result) {
  return result.issues.map((entry) => entry.code);
}

test("structured Change tasks parse valid slices, checkpoint, and ledger", () => {
  const result = parseStructuredChangeTasks(tasks({ secondSlice: true }), {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.equal(result.structured, true);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.slices.map((slice) => slice.id), ["S1", "S2"]);
  assert.equal(result.resume.envelopes[0].repository, "sample-web");
});

test("legacy checklist tasks remain compatible without strict parsing", () => {
  const result = parseStructuredChangeTasks([
    "# Tasks: Legacy",
    "",
    "## Task Checklist",
    "",
    "- [ ] Continue legacy work.",
    "",
    "```markdown",
    "## Requirement Slices",
    "### S1: Example only",
    "```",
  ].join("\n"));
  assert.equal(result.structured, false);
  assert.deepEqual(result.issues, []);
});

test("structured tasks reject malformed references and missing fields", () => {
  const source = tasks()
    .replace("`SAMPLE-E001/S1 R1-S1`", "`SAMPLE-E001/S9 R1-S1`")
    .replace("- Verification intent: Exercise the public behavior.\n", "");
  const result = parseStructuredChangeTasks(source, {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.ok(codes(result).includes("INVALID_REQUIREMENT_SLICE"));
  assert.ok(codes(result).includes("INVALID_SLICE_REFERENCE"));
});

test("structured tasks reject unknown and cyclic dependencies", () => {
  const unknown = parseStructuredChangeTasks(tasks({ dependency: "S9" }), {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.ok(codes(unknown).includes("INVALID_SLICE_DEPENDENCY"));

  const cyclicSource = tasks({ secondSlice: true, dependency: "S2" });
  const cyclic = parseStructuredChangeTasks(cyclicSource, {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.ok(codes(cyclic).includes("CYCLIC_SLICE_DEPENDENCY"));
});

test("structured tasks reject ledger drift", () => {
  const result = parseStructuredChangeTasks(tasks({ sliceStatus: "done" }), {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.ok(codes(result).includes("INVALID_IMPLEMENTATION_LEDGER"));
});

test("structured tasks accept retained legacy app-wide Story references", () => {
  const source = tasks()
    .replaceAll("SAMPLE-E001/S1 R1", "DASH-008 R1")
    .replaceAll("SAMPLE-E001/S1", "DASH-008");
  const result = parseStructuredChangeTasks(source, {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.deepEqual(result.issues, []);
});

test("structured tasks reject duplicate current-state sections and invalid update dates", () => {
  const duplicate = parseStructuredChangeTasks(`${tasks()}\n\n## Requirement Slices\n`, {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.ok(codes(duplicate).includes("INVALID_REQUIREMENT_SLICE"));

  const invalidDate = parseStructuredChangeTasks(tasks().replace("2026-08-14 |", "banana |"), {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.ok(codes(invalidDate).includes("INVALID_IMPLEMENTATION_LEDGER"));
});

test("structured tasks reject checkpoint drift", () => {
  const source = tasks({ resumeSlice: "S9" }).replace(
    "| `sample-web` | `code/sample-web` | not captured | not started | not captured |",
    "| `other-web` | `code/other-web` | not captured | not started | not captured |",
  );
  const result = parseStructuredChangeTasks(source, {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.ok(codes(result).includes("INVALID_RESUME_CHECKPOINT"));
});
