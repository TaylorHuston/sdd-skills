import assert from "node:assert/strict";
import test from "node:test";

import { parseStructuredChangeTasks } from "../src/change-tasks.js";

function tasks({
  secondSlice = false,
  dependency = "none",
  sliceStatus = "ready",
  ledgerStatus = "not started",
  ledgerCommit = "pending",
  resumeSlice = "S1",
  gateLedger = true,
  gateComplete = false,
  requiredGaps = "none",
  acceptedGaps = "none",
  visualRequirements = true,
  completionCertificate = true,
  closureReceipt = false,
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
    ...(completionCertificate ? ["- Completion certificate: required"] : []),
    ...(closureReceipt ? ["- Closure receipt: required"] : []),
    ...(visualRequirements ? [
      "- Visual requirements:",
      "  - Not applicable — This slice has no rendered UI surface.",
    ] : []),
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
      "- Completion certificate: required",
    ] : []),
    "",
    "## Implementation Ledger",
    "",
    "| Slice | Repository | Status | Implementation Summary / Changed Surface | Commit | Updated |",
    "|---|---|---|---|---|---|",
    `| S1 | \`sample-web\` | ${ledgerStatus} | None yet. | ${ledgerCommit} | 2026-08-14 |`,
    ...(secondSlice ? ["| S2 | `sample-web` | blocked | Waiting on S1. | pending | 2026-08-14 |"] : []),
    ...(gateLedger ? [
      "",
      "## Slice Gate Ledger",
      "",
      "| Slice | Verification Candidate | Implementation Review | Epic Update | Semantic Closure | Evidence Closure | Post-Epic Review | Required Gaps | Accepted Gaps | Final Commit | Updated |",
      "|---|---|---|---|---|---|---|---|---|---|---|",
      gateComplete
        ? `| S1 | commit:0123456789abcdef0123456789abcdef01234567 | ready @ commit:0123456789abcdef0123456789abcdef01234567 | complete @ commit:0123456789abcdef0123456789abcdef01234567 | pass | pass | ready @ commit:0123456789abcdef0123456789abcdef01234567 | ${requiredGaps} | ${acceptedGaps} | 0123456789abcdef0123456789abcdef01234567 | 2026-08-14 |`
        : `| S1 | pending | pending | pending | pending | pending | pending | ${requiredGaps} | ${acceptedGaps} | pending | 2026-08-14 |`,
      ...(secondSlice ? ["| S2 | pending | pending | pending | pending | pending | pending | none | none | pending | 2026-08-14 |"] : []),
    ] : []),
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
  assert.equal(result.slices[0].visual.applicability, "not-applicable");
});

test("current slices accept the minimal closure receipt marker", () => {
  const result = parseStructuredChangeTasks(tasks({
    completionCertificate: false,
    closureReceipt: true,
  }), {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.deepEqual(result.issues, []);
  assert.equal(result.slices[0].closureSchema, "sdd-slice-closure-v2");
});

test("multiple Requirements require an atomic coupling justification", () => {
  const source = tasks().replace(
    "  - New: `SAMPLE-E001/S1 R1` — The behavior is available.",
    "  - New: `SAMPLE-E001/S1 R1` — The behavior is available.\n  - Revised: `SAMPLE-E001/S1 R2` — The related behavior changes.",
  );
  const missing = parseStructuredChangeTasks(source, {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.ok(codes(missing).includes("INVALID_SLICE_COUPLING"));

  const coupled = parseStructuredChangeTasks(source.replace(
    "- Scenarios: `SAMPLE-E001/S1 R1-S1`",
    "- Coupling justification: Either Requirement alone would leave the same atomic public operation incoherent.\n- Scenarios: `SAMPLE-E001/S1 R1-S1`",
  ), {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.equal(codes(coupled).includes("INVALID_SLICE_COUPLING"), false);
});

test("completed legacy multi-Requirement slices remain grandfathered while current receipts keep coupling", () => {
  const secondRequirement = "  - New: `SAMPLE-E001/S1 R1` — The behavior is available.\n  - Revised: `SAMPLE-E001/S1 R2` — The related behavior changes.";
  const completedLegacy = tasks({
    sliceStatus: "done",
    ledgerStatus: "done",
    ledgerCommit: "0123456789abcdef0123456789abcdef01234567",
    completionCertificate: false,
    gateLedger: false,
  }).replace("  - New: `SAMPLE-E001/S1 R1` — The behavior is available.", secondRequirement);
  const legacyResult = parseStructuredChangeTasks(completedLegacy, {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.equal(codes(legacyResult).includes("INVALID_SLICE_COUPLING"), false);

  const currentReceipt = tasks({
    sliceStatus: "done",
    ledgerStatus: "done",
    ledgerCommit: "0123456789abcdef0123456789abcdef01234567",
    completionCertificate: false,
    closureReceipt: true,
    gateComplete: true,
  }).replace("  - New: `SAMPLE-E001/S1 R1` — The behavior is available.", secondRequirement);
  const currentResult = parseStructuredChangeTasks(currentReceipt, {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.ok(codes(currentResult).includes("INVALID_SLICE_COUPLING"));
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

test("done structured slices require a full recorded commit SHA", () => {
  const missing = parseStructuredChangeTasks(tasks({
    sliceStatus: "done",
    ledgerStatus: "done",
  }), {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.ok(codes(missing).includes("INVALID_IMPLEMENTATION_LEDGER"));

  const complete = parseStructuredChangeTasks(tasks({
    sliceStatus: "done",
    ledgerStatus: "done",
    ledgerCommit: "0123456789abcdef0123456789abcdef01234567",
    gateComplete: true,
  }), {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.deepEqual(complete.issues, []);
  assert.equal(complete.ledger[0].commit, "0123456789abcdef0123456789abcdef01234567");
});

test("done slices require complete gate closure when a Slice Gate Ledger is present", () => {
  const incomplete = parseStructuredChangeTasks(tasks({
    sliceStatus: "done",
    ledgerStatus: "done",
    ledgerCommit: "0123456789abcdef0123456789abcdef01234567",
  }), {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.ok(codes(incomplete).includes("INVALID_SLICE_GATE_LEDGER"));

  const requiredGap = parseStructuredChangeTasks(tasks({
    sliceStatus: "done",
    ledgerStatus: "done",
    ledgerCommit: "0123456789abcdef0123456789abcdef01234567",
    gateComplete: true,
    requiredGaps: "`SAMPLE-E001/S1 R1-S1` — required rendered verification pending",
  }), {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.ok(codes(requiredGap).includes("INVALID_SLICE_GATE_LEDGER"));
});

test("accepted gaps require explicit dated user acceptance", () => {
  const invalid = parseStructuredChangeTasks(tasks({ acceptedGaps: "`SAMPLE-E001/S1 R1-S1`" }), {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.ok(codes(invalid).includes("INVALID_SLICE_GATE_LEDGER"));

  const accepted = parseStructuredChangeTasks(tasks({
    acceptedGaps: "`SAMPLE-E001/S1 R1-S1` — user accepted 2026-08-14.",
  }), {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.deepEqual(accepted.issues, []);

  for (const acceptedGaps of [
    "`SAMPLE-E001/S1 R1-S1` — user accepted 2026-02-31.",
    "`SAMPLE-E001/S1 R1-S1`, `SAMPLE-E001/S1 R1-S1` — user accepted 2026-08-14.",
  ]) {
    const rejected = parseStructuredChangeTasks(tasks({ acceptedGaps }), {
      changeId: "2026-08-14-sample",
      repositoryIds: ["sample-web"],
    });
    assert.ok(codes(rejected).includes("INVALID_SLICE_GATE_LEDGER"));
  }
});

test("structured slices parse Scenario-bound visual obligations", () => {
  const source = tasks().replace(
    "  - Not applicable — This slice has no rendered UI surface.",
    "  - `V1` — Scenarios: `SAMPLE-E001/S1 R1-S1` — 390x844 error then recovery with focus retained.",
  );
  const result = parseStructuredChangeTasks(source, {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.slices[0].visual.requirements, [{
    id: "V1",
    scenarios: ["SAMPLE-E001/S1 R1-S1"],
    description: "390x844 error then recovery with focus retained.",
  }]);
});

test("current done slices require an explicit visual verification declaration", () => {
  const result = parseStructuredChangeTasks(tasks({
    sliceStatus: "done",
    ledgerStatus: "done",
    ledgerCommit: "0123456789abcdef0123456789abcdef01234567",
    gateComplete: true,
    visualRequirements: false,
  }), {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.ok(codes(result).includes("INVALID_SLICE_VISUAL_REQUIREMENTS"));
});

test("existing in-progress structured tasks without a Slice Gate Ledger remain compatible", () => {
  const result = parseStructuredChangeTasks(tasks({ gateLedger: false }), {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.gates, []);
});

test("all current non-done slices require the certificate marker", () => {
  for (const [sliceStatus, ledgerStatus] of [
    ["ready", "not started"],
    ["in progress", "in progress"],
    ["blocked", "blocked"],
    ["deferred", "deferred"],
  ]) {
    const result = parseStructuredChangeTasks(tasks({
      sliceStatus,
      ledgerStatus,
      completionCertificate: false,
    }), {
      changeId: "2026-08-14-sample",
      repositoryIds: ["sample-web"],
    });
    assert.ok(codes(result).includes("INVALID_SLICE_CLOSURE_POLICY"));
  }
});

test("existing completed slices without the certificate marker remain grandfathered", () => {
  const result = parseStructuredChangeTasks(tasks({
    sliceStatus: "done",
    ledgerStatus: "done",
    ledgerCommit: "0123456789abcdef0123456789abcdef01234567",
    gateLedger: false,
    visualRequirements: false,
    completionCertificate: false,
  }), {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.deepEqual(result.issues, []);
  assert.equal(result.slices[0].closureRequired, false);
});

test("marked current six-column done slices require a Slice Gate Ledger", () => {
  const result = parseStructuredChangeTasks(tasks({
    sliceStatus: "done",
    ledgerStatus: "done",
    ledgerCommit: "0123456789abcdef0123456789abcdef01234567",
    gateLedger: false,
  }), {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.ok(codes(result).includes("INVALID_SLICE_GATE_LEDGER"));
});

test("Slice Gate Ledger candidates must be valid and candidate-consistent", () => {
  const malformed = tasks().replace(
    "| S1 | pending | pending | pending | pending | pending | pending | none | none | pending | 2026-08-14 |",
    "| S1 | arbitrary | ready @ unrelated | no-op @ another | pass | pass | not required | none | none | pending | 2026-08-14 |",
  );
  const result = parseStructuredChangeTasks(malformed, {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.ok(codes(result).includes("INVALID_SLICE_GATE_LEDGER"));
});

test("Slice Gate Ledger accepts resolver watermarks and rejects valid-but-mismatched candidates", () => {
  const head = "a".repeat(40);
  const digest = "b".repeat(64);
  const watermark = `working-tree:${head}:sha256:${digest}`;
  const pendingRow = "| S1 | pending | pending | pending | pending | pending | pending | none | none | pending | 2026-08-14 |";
  const valid = parseStructuredChangeTasks(tasks().replace(
    pendingRow,
    `| S1 | ${watermark} | ready @ ${watermark} | no-op @ ${watermark} | pass | pass | not required | none | none | pending | 2026-08-14 |`,
  ), {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.deepEqual(valid.issues, []);

  const other = `commit:${"c".repeat(40)}`;
  const mismatched = parseStructuredChangeTasks(tasks().replace(
    pendingRow,
    `| S1 | ${watermark} | ready @ ${watermark} | complete @ ${watermark} | pass | pass | ready @ ${other} | none | none | pending | 2026-08-14 |`,
  ), {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.ok(codes(mismatched).includes("INVALID_SLICE_GATE_LEDGER"));
});

test("structured slices reject duplicate Scenario references", () => {
  const duplicate = tasks().replace(
    "- Scenarios: `SAMPLE-E001/S1 R1-S1`",
    "- Scenarios: `SAMPLE-E001/S1 R1-S1`, `SAMPLE-E001/S1 R1-S1`",
  );
  const result = parseStructuredChangeTasks(duplicate, {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.ok(codes(result).includes("INVALID_SLICE_REFERENCE"));
});

test("marked slices cannot downgrade to a five-column Implementation Ledger", () => {
  const legacy = tasks({ gateLedger: false })
    .replace("| Slice | Repository | Status | Implementation Summary / Changed Surface | Commit | Updated |", "| Slice | Repository | Status | Implementation Summary / Changed Surface | Updated |")
    .replace("|---|---|---|---|---|---|", "|---|---|---|---|---|")
    .replace("| S1 | `sample-web` | not started | None yet. | pending | 2026-08-14 |", "| S1 | `sample-web` | not started | None yet. | 2026-08-14 |");
  const result = parseStructuredChangeTasks(legacy, {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.ok(codes(result).includes("INVALID_SLICE_CLOSURE_POLICY"));
});

test("existing unmarked five-column Implementation Ledgers remain compatible", () => {
  const legacy = tasks({ gateLedger: false, completionCertificate: false })
    .replace("| Slice | Repository | Status | Implementation Summary / Changed Surface | Commit | Updated |", "| Slice | Repository | Status | Implementation Summary / Changed Surface | Updated |")
    .replace("|---|---|---|---|---|---|", "|---|---|---|---|---|")
    .replace("| S1 | `sample-web` | not started | None yet. | pending | 2026-08-14 |", "| S1 | `sample-web` | not started | None yet. | 2026-08-14 |");
  const result = parseStructuredChangeTasks(legacy, {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.deepEqual(result.issues, []);
  assert.equal(result.ledger[0].commit, null);
});

test("legacy five-column done slices remain compatible without a Slice Gate Ledger", () => {
  const source = tasks({
    sliceStatus: "done",
    ledgerStatus: "done",
    ledgerCommit: "0123456789abcdef0123456789abcdef01234567",
    gateLedger: false,
    completionCertificate: false,
  })
    .replace("| Slice | Repository | Status | Implementation Summary / Changed Surface | Commit | Updated |", "| Slice | Repository | Status | Implementation Summary / Changed Surface | Updated |")
    .replace("|---|---|---|---|---|---|", "|---|---|---|---|---|")
    .replace("| S1 | `sample-web` | done | None yet. | 0123456789abcdef0123456789abcdef01234567 | 2026-08-14 |", "| S1 | `sample-web` | done | Completed legacy slice. | 2026-08-14 |");
  const result = parseStructuredChangeTasks(source, {
    changeId: "2026-08-14-sample",
    repositoryIds: ["sample-web"],
  });
  assert.deepEqual(result.issues, []);
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
