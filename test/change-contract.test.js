import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { parse } from "yaml";

import { V2_UNIVERSAL_GATE_IDS } from "../src/change-review.js";
import { getActiveChangePath, getClosedChangePath } from "../src/change-store.js";
import { setChangeMetadata } from "../src/change-status.js";
import { resolveCandidateEnvelope } from "../src/commands/candidate-resolve.js";
import { closeChange } from "../src/commands/change-close.js";
import { createChange } from "../src/commands/change-create.js";
import { setupInstallation } from "../src/commands/init-installation.js";
import { getStatus } from "../src/commands/status.js";
import { transitionChange } from "../src/commands/change-transition.js";
import { validateArtifacts } from "../src/commands/validate.js";
import { createRepositoryConfig, writeRepositoryConfig } from "../src/config.js";
import { SddError } from "../src/errors.js";
import { pathExists } from "../src/fs.js";

const execFileAsync = promisify(execFileCallback);

async function createWorkspace(t) {
  const root = await mkdtemp(join(tmpdir(), "sdd-change-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "ideas", "sample"), { recursive: true });
  await mkdir(join(root, "code", "sample-web"), { recursive: true });
  await writeRepositoryConfig(
    join(root, "code", "sample-web"),
    createRepositoryConfig("sample-web"),
  );
  await writeFile(
    join(root, "ideas", "sample", "sample.md"),
    [
      "---",
      "repositories:",
      "  - path: code/sample-web",
      "---",
      "# Sample",
      "",
    ].join("\n"),
  );
  await setupInstallation(root, { skillsDirectory: ".agents/skills" });
  return root;
}

function frontmatter(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "expected YAML frontmatter");
  return parse(match[1]);
}

async function completePlanning(changePath) {
  const changePathname = join(changePath, "change.md");
  const source = await readFile(changePathname, "utf8");
  const withRepository = setChangeMetadata(source, {
    space: "sample",
    repositories: ["sample-web"],
  });
  assert.notEqual(withRepository, null);
  await writeFile(
    changePathname,
    [
      withRepository.trimEnd(),
      "",
      "## Current Context",
      "",
      "The current system has been inspected.",
      "",
      "## Behavioral Changes",
      "",
      "The public behavior changes observably.",
      "",
      "## Technical Decision Handoffs",
      "",
      "Only one path is viable because the public boundary already exists.",
      "",
      "## Selected Approach",
      "",
      "Use the existing public boundary.",
      "",
      "## Alternatives Considered",
      "",
      "None beyond the constrained path.",
      "",
      "## Implementation Constraints",
      "",
      "Preserve the public boundary.",
      "",
      "## Verification Strategy",
      "",
      "Exercise the public behavior.",
      "",
      "## Risks / Trade-Offs",
      "",
      "The change is intentionally small.",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(changePath, "tasks.md"),
    [
      "# Tasks: Capture Intent",
      "",
      "## Resume Here",
      "",
      "- Change: `2026-08-10-capture-intent`",
      "- Current slice: S1",
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
      "### S1: Expose the public behavior",
      "",
      "- Status: ready",
      "- Repository: `sample-web`",
      "- Requirements:",
      "  - New: `SAMPLE-E001/S1 R1` — The behavior is available through the public boundary.",
      "- Story changes:",
      "  - Update: `SAMPLE-E001/S1` — Add the new behavior.",
      "- Outcome: Callers can observe the behavior through the public boundary.",
      "- Scenarios: `SAMPLE-E001/S1 R1-S1`",
      "- Dependencies: none",
      "- Binding constraints: Preserve the public boundary.",
      "- Verification intent: Exercise the public behavior.",
      "- Manual acceptance: not required",
      "- Completion certificate: required",
      "- Visual requirements:",
      "  - Not applicable — the fixture exposes no rendered UI surface.",
      "",
      "## Implementation Ledger",
      "",
      "| Slice | Repository | Status | Implementation Summary / Changed Surface | Commit | Updated |",
      "|---|---|---|---|---|---|",
      "| S1 | `sample-web` | not started | None yet. | pending | 2026-08-10 |",
      "",
      "## Slice Gate Ledger",
      "",
      "| Slice | Verification Candidate | Implementation Review | Epic Update | Semantic Closure | Evidence Closure | Post-Epic Review | Required Gaps | Accepted Gaps | Final Commit | Updated |",
      "|---|---|---|---|---|---|---|---|---|---|---|",
      "| S1 | pending | pending | pending | pending | pending | pending | none | none | pending | 2026-08-10 |",
      "",
      "## Blockers / Open Questions",
      "",
      "None.",
      "",
      "## Closeout",
      "",
      "Pending.",
      "",
    ].join("\n"),
  );
}

test("change create captures proposed intent in one central change.md", async (t) => {
  const root = await createWorkspace(t);
  const result = await createChange(root, "sample", "capture-intent", {
    date: "2026-08-10",
  });

  assert.deepEqual(result.files, ["change.md"]);
  assert.deepEqual(result.repositories, []);

  const changePath = getActiveChangePath(result.changeId, root);
  const source = await readFile(join(changePath, "change.md"), "utf8");
  assert.deepEqual(frontmatter(source), {
    status: "proposed",
    space: "sample",
    repositories: [],
  });
  assert.match(source, /^# Change: Capture Intent$/m);
  assert.match(source, /^## Desired Outcome$/m);
  assert.equal(await pathExists(join(changePath, "design.md")), false);
  assert.equal(await pathExists(join(changePath, "tasks.md")), false);

  const status = await getStatus(root, "sample");
  assert.equal(status.activeChanges[0].status, "proposed");
  assert.deepEqual(status.activeChanges[0].repositories, []);

  const validation = await validateArtifacts(root, { changeId: result.changeId });
  assert.equal(
    validation.findings.some((finding) => finding.code === "MISSING_CHANGE_FILE"),
    false,
  );
});

async function completeV2Planning(changePath) {
  const changeFilePath = join(changePath, "change.md");
  const source = await readFile(changeFilePath, "utf8");
  const withRepository = setChangeMetadata(source, {
    space: "sample",
    repositories: ["sample-web"],
  });
  assert.notEqual(withRepository, null);
  await writeFile(
    changeFilePath,
    [
      withRepository.replace("status: proposed", "status: proposed\nschema: sdd-change-v2").trimEnd(),
      "",
      "## Current Context",
      "",
      "The current system has been inspected.",
      "",
      "## Behavioral Changes",
      "",
      "The public behavior changes observably.",
      "",
      "## Technical Decision Handoffs",
      "",
      "The accepted ADR selects the v2 contract.",
      "",
      "## Selected Approach",
      "",
      "Use the explicit v2 boundary.",
      "",
      "## Alternatives Considered",
      "",
      "Schema inference was rejected.",
      "",
      "## Implementation Constraints",
      "",
      "Preserve schema-less readers.",
      "",
      "## Verification Strategy",
      "",
      "Exercise the public lifecycle.",
      "",
      "## Risks / Trade-Offs",
      "",
      "Dual readers have bounded maintenance cost.",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(changePath, "tasks.md"),
    [
      "# Tasks: Capture V2 Intent",
      "",
      "## Resume Here",
      "",
      "- Change: `2026-08-10-capture-intent`",
      "- Current outcome: S1",
      "- Phase: planned",
      "- Next action: Apply S1.",
      "- Blocker: none",
      "",
      "## Delivery Outcomes",
      "",
      "### S1: Expose the v2 behavior",
      "",
      "- Status: ready",
      "- Repository: `sample-web`",
      "- Requirements:",
      "  - New: `SAMPLE-E001/S1 R1` — The v2 behavior is available.",
      "- Story changes:",
      "  - Update: `SAMPLE-E001/S1` — Add the v2 behavior.",
      "- Outcome: Callers can use the v2 behavior.",
      "- Scenarios: `SAMPLE-E001/S1 R1-S1`",
      "- Dependencies: none",
      "- Binding constraints: Preserve schema-less readers.",
      "- Expected triggers:",
      "  - `contract-compatibility` — Exercise both schema paths.",
      "- Verification intent: Exercise the public lifecycle.",
      "- Manual acceptance: not required",
      "",
      "## Closeout",
      "",
      "- Remaining outcomes: S1",
      "- Review: pending",
      "- Manual acceptance: not required",
      "- Accepted gaps: none",
      "",
    ].join("\n"),
  );
}

async function writeCanonicalEpic(root) {
  const repository = join(root, "code", "sample-web");
  await mkdir(join(repository, "src"), { recursive: true });
  await mkdir(join(repository, "test"), { recursive: true });
  await mkdir(join(repository, "docs", "epics", "sample-e001-core"), { recursive: true });
  await writeFile(join(repository, "src", "core.js"), "export function runCoreJourney() { return true; }\n");
  await writeFile(join(repository, "test", "core.test.js"), "test(\"core journey completes successfully\", () => {});\n");
  await writeFile(join(repository, "docs", "epics", "sample-e001-core", "epic.md"), [
    "---",
    "schema: sdd-epic-v2",
    "id: SAMPLE-E001",
    "status: active",
    "created: 2026-08-17",
    "modified: 2026-08-17",
    "last_verified: 2026-08-17",
    "stories:",
    "  - S1",
    "---",
    "",
    "# SAMPLE-E001 Core Experience",
    "",
    "## Product Context",
    "",
    "Current product context.",
    "",
    "## Outcome",
    "",
    "Users can complete the core experience.",
    "",
    "## Current Scope",
    "",
    "- Core behavior.",
    "",
    "## Deferred Scope",
    "",
    "- None.",
    "",
    "## Candidate Stories",
    "",
    "- None.",
    "",
    "## Story Index",
    "",
    "| Story | Implementation | Verification | Capability | Last Verified | Notes |",
    "|---|---|---|---|---|---|",
    "| S1 | implemented | verified | Core behavior. | 2026-08-17 | |",
    "",
    "## Stories",
    "",
    "### Story S1: Core Journey",
    "",
    "Implementation: implemented",
    "Verification: verified",
    "Created: 2026-08-17",
    "Modified: 2026-08-17",
    "Last verified: 2026-08-17",
    "",
    "As a user, I want the core journey, so that I can reach the expected outcome.",
    "",
    "#### Requirements And Scenarios",
    "",
    "##### Requirement R1: Complete The Journey",
    "",
    "The system SHALL complete the journey.",
    "",
    "###### Scenario R1-S1: Successful Completion",
    "",
    "- WHEN the user starts the journey",
    "- THEN the expected result is returned",
    "",
    "#### Implemented By",
    "",
    "| Requirement / Scenario | Location / Anchor | Kind | Responsibility |",
    "|---|---|---|---|",
    "| S1/R1 | `src/core.js#runCoreJourney` | primary | Owns the core journey behavior. |",
    "",
    "#### Implementation Gaps",
    "",
    "- None.",
    "",
    "#### Verified By",
    "",
    "| Requirement / Scenario | Evidence | Proves | Status |",
    "|---|---|---|---|",
    "| S1/R1-S1 | Automated test `test/core.test.js#core journey completes successfully` | Successful completion. | Passing 2026-08-17 |",
    "",
    "#### Verification Gaps",
    "",
    "- None.",
    "",
    "#### Story Notes",
    "",
    "- Durable context.",
    "",
    "## Cross-Story Concerns",
    "",
    "- None.",
    "",
    "## Open Decisions",
    "",
    "- None.",
    "",
    "## Completion Criteria",
    "",
    "- The current scope remains represented.",
    "",
    "## Notes",
    "",
    "- None.",
    "",
  ].join("\n"));
}

function v2Review({
  candidate,
  reviewedTree,
  finalCommit = "pending",
  finalCommitTree = "pending",
  scenario = "SAMPLE-E001/S1 R1-S1",
  evidence = "`test/core.test.js#core journey completes successfully`",
}) {
  return [
    "---",
    "schema: sdd-review-v2",
    "change: 2026-08-10-capture-intent",
    "updated: 2026-08-17",
    "---",
    "# Review: Capture V2 Intent",
    "",
    "## Outcome S1: Expose the v2 behavior",
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
    `- Final commit: ${finalCommit}`,
    `- Final commit tree: ${finalCommitTree}`,
    "",
    "### Universal Gates",
    "",
    "| Gate | Check | Result | Evidence |",
    "|---|---|---|---|",
    ...V2_UNIVERSAL_GATE_IDS.map((gate) => `| ${gate} | Check ${gate}. | pass | ${evidence} |`),
    "",
    "### Triggered Checks",
    "",
    "| Trigger | Source | Reason | Check | Result | Gap | Evidence |",
    "|---|---|---|---|---|---|---|",
    `| contract-compatibility | planned | Exercise both schema paths. | Validate both fixture families. | pass | none | ${evidence} |`,
    "",
    "### Scenario Coverage",
    "",
    "| Scenario | Claimed boundary | Evidence | Proven boundary | Result | Gap |",
    "|---|---|---|---|---|---|",
    `| ${scenario} | backend/data | ${evidence} | backend/data | pass | none |`,
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

test("v2 planning transitions with compact tasks while creation remains schema-less", async (t) => {
  const root = await createWorkspace(t);
  const result = await createChange(root, "sample", "capture-intent", {
    date: "2026-08-10",
  });
  const changePath = getActiveChangePath(result.changeId, root);

  assert.equal(frontmatter(await readFile(join(changePath, "change.md"), "utf8")).schema, undefined);
  await completeV2Planning(changePath);
  const tasksPath = join(changePath, "tasks.md");
  const validTasks = await readFile(tasksPath, "utf8");
  await writeFile(tasksPath, validTasks.replace("- Expected triggers:\n  - `contract-compatibility` — Exercise both schema paths.\n", ""));
  await assert.rejects(
    () => transitionChange(root, "sample", result.changeId, {
      from: "proposed",
      to: "planned",
    }),
    (error) => error instanceof SddError
      && error.code === "INCOMPLETE_CHANGE"
      && error.details.some((detail) => detail.includes("INVALID_V2_OUTCOME")),
  );
  await writeFile(tasksPath, validTasks);
  await transitionChange(root, "sample", result.changeId, {
    from: "proposed",
    to: "planned",
  });

  const metadata = frontmatter(await readFile(join(changePath, "change.md"), "utf8"));
  assert.equal(metadata.schema, "sdd-change-v2");
  assert.equal(metadata.status, "planned");
  const validation = await validateArtifacts(root, { changeId: result.changeId });
  assert.deepEqual(
    validation.findings.filter((finding) => finding.artifactType === "change"),
    [],
  );
});

test("done v2 outcomes require a reachable content-identical review seal", async (t) => {
  const root = await createWorkspace(t);
  await writeCanonicalEpic(root);
  const repository = join(root, "code", "sample-web");
  await execFileAsync("git", ["init", "-b", "update-skills", repository]);
  await execFileAsync("git", ["-C", repository, "config", "user.name", "SDD Test"]);
  await execFileAsync("git", ["-C", repository, "config", "user.email", "sdd@example.test"]);
  await execFileAsync("git", ["-C", repository, "add", "."]);
  await execFileAsync("git", ["-C", repository, "commit", "-m", "base"]);
  const { stdout: baseOutput } = await execFileAsync("git", ["-C", repository, "rev-parse", "HEAD"]);
  const base = baseOutput.trim();

  const result = await createChange(root, "sample", "capture-intent", { date: "2026-08-10" });
  const changePath = getActiveChangePath(result.changeId, root);
  await completeV2Planning(changePath);
  const changeFilePath = join(changePath, "change.md");
  await writeFile(
    changeFilePath,
    (await readFile(changeFilePath, "utf8")).replace(
      "## Epic Impact\n\n- None identified yet.",
      "## Epic Impact\n\n- Affected Epic: `SAMPLE-E001`.",
    ),
  );
  await transitionChange(root, "sample", result.changeId, { from: "proposed", to: "planned" });
  await transitionChange(root, "sample", result.changeId, { from: "planned", to: "in_progress" });

  await writeFile(join(repository, "v2.txt"), "v2 behavior\n");
  await execFileAsync("git", ["-C", repository, "add", "v2.txt"]);
  const envelope = await resolveCandidateEnvelope(repository, {
    workspaceRoot: root,
    baseline: base,
    candidate: "working-tree",
  });
  const { stdout: stagedTreeOutput } = await execFileAsync("git", ["-C", repository, "write-tree"]);
  const stagedTree = stagedTreeOutput.trim();
  await writeFile(join(changePath, "review.md"), v2Review({
    candidate: envelope.candidate.watermark,
    reviewedTree: stagedTree,
  }));
  const precommit = await validateArtifacts(root, { changeId: result.changeId });
  assert.deepEqual(precommit.findings.filter((finding) => finding.artifactType === "change"), []);

  const tasksPath = join(changePath, "tasks.md");
  const validTasks = await readFile(tasksPath, "utf8");
  await writeFile(tasksPath, validTasks.replaceAll("SAMPLE-E001/S1 R1-S1", "SAMPLE-E001/S1 R1-S9"));
  await writeFile(join(changePath, "review.md"), v2Review({
    candidate: envelope.candidate.watermark,
    reviewedTree: stagedTree,
    scenario: "SAMPLE-E001/S1 R1-S9",
  }));
  const nonexistentScenario = await validateArtifacts(root, { changeId: result.changeId });
  assert.ok(nonexistentScenario.findings.some((finding) => finding.code === "V2_REVIEW_SCENARIO_NOT_FOUND"));
  await writeFile(tasksPath, validTasks);

  await writeFile(join(changePath, "review.md"), v2Review({
    candidate: envelope.candidate.watermark,
    reviewedTree: stagedTree,
    evidence: "`test/core.test.js#fabricated proof`",
  }));
  const fabricatedEvidence = await validateArtifacts(root, { changeId: result.changeId });
  assert.ok(fabricatedEvidence.findings.some((finding) => finding.code === "V2_REVIEW_EVIDENCE_MISMATCH"));

  await writeFile(join(changePath, "review.md"), v2Review({
    candidate: `working-tree:${base}:sha256:${"b".repeat(64)}`,
    reviewedTree: stagedTree,
  }));
  const tamperedCandidate = await validateArtifacts(root, { changeId: result.changeId });
  assert.ok(tamperedCandidate.findings.some((finding) => finding.code === "V2_REVIEW_CANDIDATE_MISMATCH"));

  await execFileAsync("git", ["-C", repository, "commit", "-m", "add v2 behavior"]);
  const { stdout: commitOutput } = await execFileAsync("git", ["-C", repository, "rev-parse", "HEAD"]);
  const { stdout: treeOutput } = await execFileAsync("git", ["-C", repository, "rev-parse", "HEAD^{tree}"]);
  const commit = commitOutput.trim();
  const tree = treeOutput.trim();
  await writeFile(tasksPath, (await readFile(tasksPath, "utf8")).replace("- Status: ready", "- Status: done"));
  await writeFile(join(changePath, "review.md"), v2Review({
    candidate: commit,
    reviewedTree: tree,
    finalCommit: commit,
    finalCommitTree: tree,
  }));

  const valid = await validateArtifacts(root, { changeId: result.changeId });
  assert.deepEqual(valid.findings.filter((finding) => finding.artifactType === "change"), []);

  await writeFile(join(changePath, "review.md"), v2Review({
    candidate: commit,
    reviewedTree: "f".repeat(40),
    finalCommit: commit,
    finalCommitTree: "f".repeat(40),
  }));
  const invalid = await validateArtifacts(root, { changeId: result.changeId });
  assert.ok(invalid.findings.some((finding) => finding.code === "INVALID_V2_REVIEW_SEAL"));
});

test("planning completes the same Change before lifecycle work continues", async (t) => {
  const root = await createWorkspace(t);
  const result = await createChange(root, "sample", "capture-intent", {
    date: "2026-08-10",
  });
  const changePath = getActiveChangePath(result.changeId, root);

  await assert.rejects(
    () => transitionChange(root, "sample", result.changeId, {
      from: "proposed",
      to: "planned",
    }),
    (error) => error instanceof SddError && error.code === "INCOMPLETE_CHANGE",
  );

  const changeFilePath = join(changePath, "change.md");
  const proposedSource = await readFile(changeFilePath, "utf8");
  await writeFile(changeFilePath, proposedSource.replace("status: proposed", "status: planned"));
  const invalidPlan = await validateArtifacts(root, { changeId: result.changeId });
  assert.deepEqual(
    invalidPlan.findings
      .filter((finding) => finding.code === "MISSING_CHANGE_FILE")
      .map((finding) => finding.path),
    [`.sdd/changes/${result.changeId}/tasks.md`],
  );
  const plannedWithoutDesignOrSections = await validateArtifacts(root, {
    changeId: result.changeId,
  });
  assert.match(
    plannedWithoutDesignOrSections.findings.find((finding) =>
      finding.code === "MISSING_ARTIFACT_SECTION" && finding.path.endsWith("change.md"))?.message ?? "",
    /technical planning sections/,
  );
  await writeFile(changeFilePath, proposedSource);

  await completePlanning(changePath);
  const malformedTasks = await readFile(join(changePath, "tasks.md"), "utf8");
  await writeFile(
    join(changePath, "tasks.md"),
    malformedTasks.replace("- Verification intent: Exercise the public behavior.\n", ""),
  );
  await assert.rejects(
    () => transitionChange(root, "sample", result.changeId, {
      from: "proposed",
      to: "planned",
    }),
    (error) => error instanceof SddError
      && error.code === "INCOMPLETE_CHANGE"
      && error.details.some((detail) => detail.includes("INVALID_REQUIREMENT_SLICE")),
  );
  await writeFile(join(changePath, "tasks.md"), malformedTasks);
  assert.equal(await pathExists(join(changePath, "design.md")), false);
  await writeFile(join(changePath, "design.md"), "# Design: Incomplete\n");
  await assert.rejects(
    () => transitionChange(root, "sample", result.changeId, {
      from: "proposed",
      to: "planned",
    }),
    (error) => error instanceof SddError
      && error.code === "INCOMPLETE_CHANGE"
      && error.details.some((detail) => detail.startsWith("design.md:")),
  );
  await rm(join(changePath, "design.md"));
  await assert.rejects(
    () => transitionChange(root, "sample", result.changeId, {
      from: "proposed",
      to: "planned",
      beforeCommit: async () => {
        await writeFile(join(changePath, "design.md"), "# Design: Concurrent invalid design\n");
      },
    }),
    (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
  );
  await rm(join(changePath, "design.md"));
  await transitionChange(root, "sample", result.changeId, {
    from: "proposed",
    to: "planned",
  });
  await assert.rejects(
    () => transitionChange(root, "sample", result.changeId, {
      from: "planned",
      to: "in_progress",
      beforeCommit: async ({ changeFilePath: currentPath }) => {
        await writeFile(currentPath, `${await readFile(currentPath, "utf8")}\nConcurrent note.\n`);
      },
    }),
    (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
  );
  assert.equal(frontmatter(await readFile(changeFilePath, "utf8")).status, "planned");

  await transitionChange(root, "sample", result.changeId, {
    from: "planned",
    to: "in_progress",
  });
  await transitionChange(root, "sample", result.changeId, {
    from: "in_progress",
    to: "in_review",
  });

  const changeSource = await readFile(join(changePath, "change.md"), "utf8");
  assert.equal(frontmatter(changeSource).status, "in_review");
  assert.doesNotMatch(await readFile(join(changePath, "tasks.md"), "utf8"), /^---$/m);

  await closeChange(root, "sample", result.changeId);
  assert.equal(await pathExists(changePath), false);
  assert.equal(await pathExists(getClosedChangePath(result.changeId, root)), true);
  await assert.rejects(
    () => createChange(root, "sample", "capture-intent", { date: "2026-08-10" }),
    (error) => error instanceof SddError && error.code === "CHANGE_EXISTS",
  );
});
