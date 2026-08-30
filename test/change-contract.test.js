import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
    schema: "sdd-change-v2",
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

test("schema-less Changes are unsupported history", async (t) => {
  const root = await createWorkspace(t);
  const result = await createChange(root, "sample", "unsupported-history", {
    date: "2026-08-10",
  });
  const changePath = getActiveChangePath(result.changeId, root);
  const changeFilePath = join(changePath, "change.md");
  await writeFile(
    changeFilePath,
    (await readFile(changeFilePath, "utf8")).replace("schema: sdd-change-v2\n", ""),
  );

  const validation = await validateArtifacts(root, { changeId: result.changeId });
  assert.ok(validation.findings.some((finding) => finding.code === "UNSUPPORTED_CHANGE_SCHEMA"));
  await assert.rejects(
    () => transitionChange(root, "sample", result.changeId, {
      from: "proposed",
      to: "planned",
    }),
    (error) => error instanceof SddError && error.code === "UNSUPPORTED_CHANGE_SCHEMA",
  );

  await writeFile(
    changeFilePath,
    (await readFile(changeFilePath, "utf8")).replace("status: proposed", "status: planned"),
  );
  await writeFile(
    join(changePath, "tasks.md"),
    "# Retired task record\n\n## Requirement Slices\n\n## Implementation Ledger\n",
  );
  const plannedValidation = await validateArtifacts(root, { changeId: result.changeId });
  assert.ok(plannedValidation.findings.some((finding) => finding.code === "UNSUPPORTED_CHANGE_SCHEMA"));
  assert.equal(
    plannedValidation.findings.some((finding) => finding.path.endsWith("/tasks.md")),
    false,
    "unsupported schema-less records must not invoke their legacy task contract",
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
      "Keep one current v2 contract.",
      "",
      "## Verification Strategy",
      "",
      "Exercise the public lifecycle.",
      "",
      "## Risks / Trade-Offs",
      "",
      "Historical formats are unsupported.",
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
      "- Binding constraints: Keep one current v2 contract.",
      "- Expected triggers:",
      "  - `current-contract` — Exercise the v2 lifecycle.",
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
    `| current-contract | planned | Exercise the v2 lifecycle. | Validate the current lifecycle. | pass | none | ${evidence} |`,
    "",
    "### Scenario Coverage",
    "",
    "| Scenario | Claimed boundary | Evidence | Proven boundary | Result | Gap |",
    "|---|---|---|---|---|---|",
    `| ${scenario} | backend/data | ${evidence} | backend/data | pass | none |`,
    "",
    "### Findings",
    "",
    "#### BLOCKING",
    "",
    "- None.",
    "",
    "#### REQUIRED",
    "",
    "- None.",
    "",
    "### Remediation",
    "",
    "- None.",
    "",
  ].join("\n");
}

test("v2 creation and planning use compact current records", async (t) => {
  const root = await createWorkspace(t);
  const result = await createChange(root, "sample", "capture-intent", {
    date: "2026-08-10",
  });
  const changePath = getActiveChangePath(result.changeId, root);

  assert.equal(frontmatter(await readFile(join(changePath, "change.md"), "utf8")).schema, "sdd-change-v2");
  await completeV2Planning(changePath);
  const tasksPath = join(changePath, "tasks.md");
  const validTasks = await readFile(tasksPath, "utf8");
  await writeFile(tasksPath, validTasks.replace("- Expected triggers:\n  - `current-contract` — Exercise the v2 lifecycle.\n", ""));
  await assert.rejects(
    () => transitionChange(root, "sample", result.changeId, {
      from: "proposed",
      to: "planned",
    }),
    (error) => error instanceof SddError
      && error.code === "INCOMPLETE_CHANGE"
      && error.details.some((detail) => detail.includes("INVALID_V2_OUTCOME")),
  );
  await writeFile(tasksPath, validTasks.replace("- Status: ready", "- Status: done"));
  const staleResumeValidation = await validateArtifacts(root, { changeId: result.changeId });
  assert.ok(staleResumeValidation.findings.some((finding) => finding.code === "INVALID_V2_RESUME"));
  await assert.rejects(
    () => transitionChange(root, "sample", result.changeId, {
      from: "proposed",
      to: "planned",
    }),
    (error) => error instanceof SddError
      && error.code === "INCOMPLETE_CHANGE"
      && error.details.some((detail) => detail.includes("INVALID_V2_RESUME")),
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
  const reviewPath = join(changePath, "review.md");
  const validateReview = async (review, options = {}) => {
    await writeFile(reviewPath, v2Review(review));
    return validateArtifacts(root, { changeId: result.changeId, ...options });
  };
  const expectReviewFinding = async (review, code, options = {}) => {
    const validation = await validateReview(review, options);
    assert.ok(!validation.valid && validation.findings.some((finding) => finding.code === code));
  };

  await writeFile(join(repository, "v2.txt"), "v2 behavior\n");
  await execFileAsync("git", ["-C", repository, "add", "v2.txt"]);
  const envelope = await resolveCandidateEnvelope(repository, {
    workspaceRoot: root,
    baseline: base,
    candidate: "working-tree",
  });
  const { stdout: stagedTreeOutput } = await execFileAsync("git", ["-C", repository, "write-tree"]);
  const stagedTree = stagedTreeOutput.trim();
  const precommit = await validateReview({ candidate: envelope.candidate.watermark, reviewedTree: stagedTree });
  assert.deepEqual(precommit.findings.filter((finding) => finding.artifactType === "change"), []);

  const tasksPath = join(changePath, "tasks.md");
  const validTasks = await readFile(tasksPath, "utf8");
  await writeFile(tasksPath, validTasks.replaceAll("SAMPLE-E001/S1 R1-S1", "SAMPLE-E001/S1 R1-S9"));
  await expectReviewFinding({
    candidate: envelope.candidate.watermark,
    reviewedTree: stagedTree,
    scenario: "SAMPLE-E001/S1 R1-S9",
  }, "V2_REVIEW_SCENARIO_NOT_FOUND");
  await writeFile(tasksPath, validTasks);
  await expectReviewFinding({
    candidate: envelope.candidate.watermark,
    reviewedTree: stagedTree,
    evidence: "`test/core.test.js#fabricated proof`",
  }, "V2_REVIEW_EVIDENCE_MISMATCH");
  await expectReviewFinding({
    candidate: `working-tree:${base}:sha256:${"b".repeat(64)}`,
    reviewedTree: stagedTree,
  }, "V2_REVIEW_CANDIDATE_MISMATCH");

  await execFileAsync("git", ["-C", repository, "commit", "-m", "add v2 behavior"]);
  const { stdout: commitOutput } = await execFileAsync("git", ["-C", repository, "rev-parse", "HEAD"]);
  const { stdout: treeOutput } = await execFileAsync("git", ["-C", repository, "rev-parse", "HEAD^{tree}"]);
  const commit = commitOutput.trim();
  const tree = treeOutput.trim();
  const committedReview = { candidate: commit, reviewedTree: tree, finalCommit: commit, finalCommitTree: tree };
  await writeFile(
    tasksPath,
    (await readFile(tasksPath, "utf8"))
      .replace("- Status: ready", "- Status: done")
      .replace("- Current outcome: S1", "- Current outcome: none"),
  );
  const valid = await validateReview(committedReview);
  assert.deepEqual(valid.findings.filter((finding) => finding.artifactType === "change"), []);

  const [fakeGit, pidPath] = ["fake-git", "git-pids"].map((name) => join(root, name));
  await writeFile(fakeGit, `#!/bin/sh\nprintf '%s\\n' "$$" >> ${JSON.stringify(pidPath)}\nexec sleep 5\n`);
  await chmod(fakeGit, 0o755);
  const started = Date.now();
  await expectReviewFinding(committedReview, "INVALID_V2_REVIEW_SEAL", { gitCommand: fakeGit, gitTimeoutMs: 100 });
  assert.ok(Date.now() - started < 2_000);
  for (const pid of (await readFile(pidPath, "utf8")).trim().split("\n").map(Number)) {
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  }

  await expectReviewFinding({
    candidate: commit,
    reviewedTree: "f".repeat(40),
    finalCommit: commit,
    finalCommitTree: "f".repeat(40),
  }, "INVALID_V2_REVIEW_SEAL");
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

  await completeV2Planning(changePath);
  const malformedTasks = await readFile(join(changePath, "tasks.md"), "utf8");
  await writeFile(
    join(changePath, "tasks.md"),
    malformedTasks.replace("- Verification intent: Exercise the public lifecycle.\n", ""),
  );
  await assert.rejects(
    () => transitionChange(root, "sample", result.changeId, {
      from: "proposed",
      to: "planned",
    }),
    (error) => error instanceof SddError
      && error.code === "INCOMPLETE_CHANGE"
      && error.details.some((detail) => detail.includes("INVALID_V2_OUTCOME")),
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
