import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, cp, mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { parse } from "yaml";

import { getWorkspaceContext } from "../src/commands/context.js";
import {
  configureWorkspace,
  inspectWorkspaceConfiguration,
} from "../src/commands/configure.js";
import { closeChange } from "../src/commands/change-close.js";
import { createPlannedChange } from "../src/commands/change-create.js";
import { promotePlannedChange } from "../src/commands/change-promote.js";
import { transitionChange } from "../src/commands/change-transition.js";
import { createEpic } from "../src/commands/epic-create.js";
import { diagnoseWorkspace } from "../src/commands/doctor.js";
import { initRepository } from "../src/commands/init-installation.js";
import { initWorkspace } from "../src/commands/init.js";
import { getStatus } from "../src/commands/status.js";
import { validateArtifacts } from "../src/commands/validate.js";
import { statusSummaryRows } from "../src/cli.js";
import { updateWorkspace } from "../src/commands/update.js";
import {
  getConfigPath,
  getInstallLockPath,
  createUserConfig,
  readConfig,
  validateConfig,
  validateRepositoryConfig,
  writeConfig,
} from "../src/config.js";
import { PACKAGE_ROOT, WORKFLOW_SOURCE_PATH } from "../src/constants.js";
import { SddError } from "../src/errors.js";
import { hashDirectory, pathExists } from "../src/fs.js";
import { collectConfigureOptions, collectInitOptions } from "../src/prompts.js";

const execFileAsync = promisify(execFile);

async function createWorkspace(prefix = "sdd-cli-") {
  return mkdtemp(join(tmpdir(), prefix));
}

async function createMappedWorkspace() {
  const root = await createWorkspace();
  await mkdir(join(root, "ideas", "sample"), { recursive: true });
  await mkdir(join(root, "code", "sample-web"), { recursive: true });
  await mkdir(join(root, "code", "sample-mobile"), { recursive: true });
  await writeFile(
    join(root, "ideas", "sample", "sample.md"),
    [
      "---",
      "repositories:",
      "  - path: code/sample-web",
      "    role: web",
      "  - path: code/sample-mobile",
      "    role: mobile",
      "---",
      "# Sample",
      "",
    ].join("\n"),
    "utf8",
  );
  return root;
}

async function moveWorkspaceRoots(root) {
  await mkdir(join(root, "spaces"), { recursive: true });
  await rename(join(root, "ideas"), join(root, "spaces", "ideas"));
  await rename(join(root, "code"), join(root, "spaces", "code"));
}

async function writeChange(root, repository, changeId, status, { closed = false } = {}) {
  const changePath = join(
    root,
    "code",
    repository,
    "docs",
    "changes",
    ...(closed ? ["closed"] : []),
    changeId,
  );
  await mkdir(changePath, { recursive: true });
  await writeFile(
    join(changePath, "tasks.md"),
    `---\nstatus: ${status}\n---\n# Tasks: ${changeId}\n`,
    "utf8",
  );
}

async function writeCanonicalChange(
  root,
  repository,
  changeId,
  status,
  { closed = false } = {},
) {
  await writeChange(root, repository, changeId, status, { closed });
  const changePath = join(
    root,
    "code",
    repository,
    "docs",
    "changes",
    ...(closed ? ["closed"] : []),
    changeId,
  );
  await writeFile(
    join(changePath, "proposal.md"),
    [
      `# Proposal: ${changeId}`,
      "",
      "## Why",
      "",
      "A concrete reason.",
      "",
      "## What Changes",
      "",
      "A concrete behavior change.",
      "",
      "## Impact",
      "",
      "Focused impact.",
      "",
      "## Open Questions",
      "",
      "None.",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(changePath, "design.md"),
    [
      `# Design: ${changeId}`,
      "",
      "## Context",
      "",
      "Current context.",
      "",
      "## Goals / Non-Goals",
      "",
      "A bounded goal.",
      "",
      "## Selected Approach",
      "",
      "A selected approach.",
      "",
      "## Verification Strategy",
      "",
      "Focused verification.",
      "",
      "## Risks / Trade-Offs",
      "",
      "Known trade-offs.",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(changePath, "tasks.md"),
    [
      "---",
      `status: ${status}`,
      "---",
      `# Tasks: ${changeId}`,
      "",
      "## Resume Here",
      "",
      "Ready for the next action.",
      "",
      "## Task Checklist",
      "",
      "- [ ] Complete the work.",
      "",
      "## Implementation Ledger",
      "",
      "No implementation yet.",
      "",
      "## Verification Ledger",
      "",
      "No verification yet.",
      "",
      "## Blockers / Open Questions",
      "",
      "None.",
      "",
      "## Closeout",
      "",
      "Not ready to close.",
      "",
    ].join("\n"),
    "utf8",
  );
}

async function setPlannedChangeStatus(root, created, status = "planned") {
  const tasksPath = join(root, created.path, "tasks.md");
  const source = await readFile(tasksPath, "utf8");
  await writeFile(
    tasksPath,
    source.replace(/^status: \S+$/m, `status: ${status}`),
    "utf8",
  );
}

async function writeCanonicalEpic(root, repository, epicId = "SAMPLE-E001") {
  await mkdir(join(root, "code", repository, "src"), { recursive: true });
  await mkdir(join(root, "code", repository, "test"), { recursive: true });
  await writeFile(
    join(root, "code", repository, "src", "core.js"),
    "export function runCoreJourney() { return true; }\n",
    "utf8",
  );
  await writeFile(
    join(root, "code", repository, "test", "core.test.js"),
    "test(\"core journey completes successfully\", () => {});\n",
    "utf8",
  );
  const epicPath = join(root, "code", repository, "docs", "epics", "sample-e001-core");
  await mkdir(epicPath, { recursive: true });
  await writeFile(
    join(epicPath, "epic.md"),
    [
      "---",
      "schema: sdd-epic-v2",
      `id: ${epicId}`,
      "status: active",
      "created: 2026-07-14",
      "modified: 2026-07-14",
      "last_verified: 2026-07-14",
      "stories:",
      "  - S1",
      "---",
      "",
      `# ${epicId} Core Experience`,
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
      "| S1 | implemented | verified | Core behavior. | 2026-07-14 | |",
      "",
      "## Stories",
      "",
      "### Story S1: Core Journey",
      "",
      "Implementation: implemented",
      "Verification: verified",
      "Created: 2026-07-14",
      "Modified: 2026-07-14",
      "Last verified: 2026-07-14",
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
      "| S1/R1-S1 | Automated test `test/core.test.js#core journey completes successfully` | Successful completion. | Passing 2026-07-14 |",
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
    ].join("\n"),
    "utf8",
  );
  return join(epicPath, "epic.md");
}

async function writeEpicVerificationReport(
  root,
  repository,
  {
    epicId = "SAMPLE-E001",
    fileName = "2026-07-22-1200-epic-verify.md",
    initialResult = "aligned",
    result = "aligned",
    gateResult = "pass",
    supersedes = null,
    omitGate = null,
    includeChangedFrom = true,
    auditedRef = "a".repeat(40),
    verifiedRef = "b".repeat(40),
    verdictInitialResult = initialResult,
    verdictAuditedRef = auditedRef,
    verdictVerifiedRef = verifiedRef,
    evidenceEpicId = epicId,
    evidenceRepository = `code/${repository}`,
    evidenceAuditRoot = evidenceRepository,
  } = {},
) {
  const template = await readFile(
    join(PACKAGE_ROOT, "docs", "templates", "epic-verify-report.md"),
    "utf8",
  );
  const scorecard = template.match(
    /## Current Gate Scorecard[\s\S]*?\|---\|---\|---\|\n(?<rows>[\s\S]*?)\n\n## /,
  );
  assert.ok(scorecard?.groups?.rows, "package report template must contain a gate scorecard");
  const gateNames = scorecard.groups.rows
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) => line.split("|")[1].trim());
  const reviewsPath = join(
    root,
    "code",
    repository,
    "docs",
    "epics",
    "sample-e001-core",
    "reviews",
  );
  await mkdir(reviewsPath, { recursive: true });
  const reportPath = join(reviewsPath, fileName);
  await writeFile(
    reportPath,
    [
      "---",
      "schema: sdd-epic-verify-report-v1",
      "kind: sdd-epic-verify-report",
      `epic: ${epicId}`,
      "epic_path: docs/epics/sample-e001-core/epic.md",
      "created: 2026-07-22",
      `initial_result: ${initialResult}`,
      `result: ${result}`,
      "mode: default",
      `audited_ref: ${auditedRef}`,
      `verified_ref: ${verifiedRef}`,
      `supersedes: ${supersedes ?? "null"}`,
      "---",
      "",
      `# Epic Verify: ${epicId} Core Experience`,
      "",
      "## Verdict",
      "",
      `- Initial result: \`${verdictInitialResult}\``,
      `- Current result: \`${result}\``,
      "- App root: repository",
      "- Epic: `docs/epics/sample-e001-core/epic.md`",
      `- Audited ref: \`${verdictAuditedRef}\``,
      `- Verified ref: \`${verdictVerifiedRef}\``,
      "- Delegation: none",
      "- Report mode: default",
      "",
      "## Current Gate Scorecard",
      "",
      "| Gate | Result | Notes |",
      "|---|---|---|",
      ...gateNames
        .filter((gate) => gate !== omitGate)
        .map((gate) => `| ${gate} | ${gateResult} | Current result. |`),
      "",
      "## Current Findings",
      "",
      "### BLOCKING",
      "",
      "- None.",
      "",
      "### REQUIRED",
      "",
      result === "aligned" ? "- None." : "- Current report finding.",
      "",
      "### SUGGESTION",
      "",
      "- None.",
      "",
      "## Initial Findings (Historical)",
      "",
      initialResult === result ? "- Same as the current result." : "- Initial artifact drift was remediated.",
      "",
      "## Remediation And Recheck",
      "",
      initialResult === result ? "- No remediation was required." : "- Reconciled the artifact and reran validation.",
      "",
      "## Current Tests And Checks",
      "",
      "| Command / Scenario | Result | Proves | Notes |",
      "|---|---|---|---|",
      `| \`sdd validate sample --epic ${evidenceEpicId} --repo ${evidenceRepository}${includeChangedFrom ? ` --changed-from ${auditedRef}` : ""}\` | pass | Current artifact shape. | Required baseline. |`,
      `| \`python3 sdd_orphan_audit.py ${evidenceAuditRoot} --epic ${evidenceEpicId} --format json\` | pass | Current reverse inventory. | Required baseline. |`,
      "",
      "## Next Action",
      "",
      "- None.",
      "",
    ].join("\n"),
    "utf8",
  );
  return reportPath;
}

test("init creates a local workspace contract and imports one-to-many mappings", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await initWorkspace(root);
  assert.equal(result.created, true);
  assert.equal(result.ideasImported, 1);
  assert.equal(result.skills.actions.length, 14);
  assert.ok(result.skills.actions.every((entry) => entry.action === "install"));
  assert.equal(result.workflow.action, "install");

  const config = parse(await readFile(getConfigPath(root), "utf8"));
  assert.equal(config.planning.root, "ideas");
  assert.deepEqual(config.repositories.roots, { code: "code" });
  assert.equal(config.ideas.sample.planning, undefined);
  assert.equal(config.ideas.sample.status, "active");
  assert.deepEqual(config.ideas.sample.repositories, [
    { root: "code", path: "sample-web", role: "web", status: "active" },
    { root: "code", path: "sample-mobile", role: "mobile", status: "active" },
  ]);
  assert.equal(await pathExists(join(root, ".agents", "skills", "sdd-change", "SKILL.md")), true);
  assert.equal(await pathExists(join(root, ".agents", "skills", "sdd-code-audit", "SKILL.md")), true);
  assert.equal(await pathExists(join(root, ".agents", "skills", "sdd-design", "SKILL.md")), true);
  assert.match(
    await readFile(join(root, ".agents", "skills", "sdd-design", "SKILL.md"), "utf8"),
    /\/sdd-design --revise/,
  );
  assert.equal(
    await pathExists(join(root, ".agents", "skills", "sdd-change", "assets", "brief-template.md")),
    true,
  );
  assert.equal(await pathExists(join(root, ".sdd", "install-lock.json")), true);
  assert.equal(
    await readFile(join(root, ".sdd", "story-driven-development.md"), "utf8"),
    await readFile(WORKFLOW_SOURCE_PATH, "utf8"),
  );
  assert.match(
    await readFile(join(root, ".sdd", "story-driven-development.md"), "utf8"),
    /sdd change transition/,
  );
  assert.match(
    await readFile(
      join(root, ".agents", "skills", "sdd-change", "assets", "tasks-template.md"),
      "utf8",
    ),
    /## Design Updates/,
  );
});

test("init rejects a managed skills path through an external symlink ancestor", async (t) => {
  const root = await createMappedWorkspace();
  const external = await createWorkspace("sdd-cli-external-");
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(external, { recursive: true, force: true }));
  await symlink(external, join(root, ".agents"));

  await assert.rejects(
    () => initWorkspace(root),
    (error) => error instanceof SddError && error.code === "UNSAFE_SKILL_DIRECTORY",
  );
  assert.equal(await pathExists(join(external, "skills")), false);
});

test("update refuses to overlap another managed mutation", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const installLockPath = getInstallLockPath(root);
  const before = await readFile(installLockPath, "utf8");
  await writeFile(join(root, ".sdd", "mutation.lock"), "held\n", "utf8");

  await assert.rejects(
    () => updateWorkspace(root),
    (error) => error instanceof SddError && error.code === "OPERATION_IN_PROGRESS",
  );
  assert.equal(await readFile(installLockPath, "utf8"), before);
});

test("init dry-run reports work without writing workspace files", async (t) => {
  const root = await createWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await initWorkspace(root, { dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(await pathExists(join(root, ".sdd")), false);
  assert.equal(await pathExists(join(root, ".agents")), false);
});

test("CLI setup installs user-level skills without initializing a repository", async (t) => {
  const root = await createWorkspace("sdd-user-init-");
  const userRoot = join(root, "home");
  const repositoryRoot = join(root, "repos", "sample-app");
  await mkdir(repositoryRoot, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));

  const env = { ...process.env, SDD_USER_HOME: userRoot };
  const first = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "setup",
    "--planning-root",
    "product/ideas",
    "--yes",
    "--json",
  ], { env });
  const result = JSON.parse(first.stdout);

  assert.equal(result.mode, "user");
  assert.equal(result.createdUserConfig, true);
  assert.equal(
    await pathExists(join(userRoot, ".agents", "skills", "sdd-apply", "SKILL.md")),
    true,
  );
  assert.equal(await pathExists(join(userRoot, ".sdd", "install-lock.json")), true);
  assert.equal(await pathExists(join(userRoot, ".sdd", "story-driven-development.md")), false);
  assert.equal(await pathExists(join(repositoryRoot, ".sdd")), false);

  const userConfig = parse(await readFile(join(userRoot, ".sdd", "config.yaml"), "utf8"));
  assert.equal(userConfig.kind, "user");
  assert.equal(userConfig.skills.directory, ".agents/skills");
  assert.equal(userConfig.planning.root, "product/ideas");
  assert.deepEqual(userConfig.repositories.roots, {});

  const second = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "setup",
    "--yes",
    "--json",
  ], { env });
  const repeated = JSON.parse(second.stdout);
  assert.equal(repeated.createdUserConfig, false);
  assert.ok(repeated.skills.actions.every((entry) => entry.action === "unchanged"));
});

test("CLI setup adopts matching preinstalled global skills", async (t) => {
  const root = await createWorkspace("sdd-user-adopt-");
  const userRoot = join(root, "home");
  const targetSkill = join(userRoot, ".agents", "skills", "sdd-apply");
  await mkdir(join(userRoot, ".agents", "skills"), { recursive: true });
  await cp(join(PACKAGE_ROOT, "skills", "sdd-apply"), targetSkill, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));

  const output = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "setup",
    "--yes",
    "--json",
  ], { env: { ...process.env, SDD_USER_HOME: userRoot } });
  const result = JSON.parse(output.stdout);
  const adopted = result.skills.actions.find((entry) => entry.skillName === "sdd-apply");

  assert.equal(adopted.action, "adopt");
  const lock = JSON.parse(await readFile(join(userRoot, ".sdd", "install-lock.json"), "utf8"));
  assert.equal(lock.managedSkills["sdd-apply"], adopted.hash);
});

test("CLI setup migrates a legacy workspace without modifying its source configuration", async (t) => {
  const legacyRoot = await createMappedWorkspace();
  const userRoot = join(await createWorkspace("sdd-user-migrate-"), "home");
  t.after(() => rm(legacyRoot, { recursive: true, force: true }));
  t.after(() => rm(join(userRoot, ".."), { recursive: true, force: true }));
  await initWorkspace(legacyRoot);
  const legacyConfigPath = join(legacyRoot, ".sdd", "config.yaml");
  const legacySource = await readFile(legacyConfigPath, "utf8");
  const env = { ...process.env, SDD_USER_HOME: userRoot };

  const dryRunOutput = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "setup",
    "--from-workspace",
    legacyRoot,
    "--dry-run",
    "--json",
  ], { env });
  const dryRun = JSON.parse(dryRunOutput.stdout);
  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.migratedFromWorkspace, legacyRoot);
  assert.equal(dryRun.config.planning.root, join(legacyRoot, "ideas"));
  assert.equal(dryRun.config.repositories.roots.code, join(legacyRoot, "code"));
  assert.equal(dryRun.config.ideas.sample.repositories[0].root, "code");
  assert.equal(dryRun.config.ideas.sample.repositories[0].path, "sample-web");
  assert.equal(await pathExists(join(userRoot, ".sdd")), false);

  await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "setup",
    "--from-workspace",
    legacyRoot,
    "--json",
  ], { env });
  const migrated = parse(await readFile(join(userRoot, ".sdd", "config.yaml"), "utf8"));
  assert.equal(migrated.kind, "user");
  assert.equal(migrated.skills.directory, ".agents/skills");
  assert.equal(await readFile(legacyConfigPath, "utf8"), legacySource);
});

test("CLI init requires setup and creates only a portable repository contract", async (t) => {
  const root = await createWorkspace("sdd-repository-init-");
  const userRoot = join(root, "home");
  const repositoryRoot = join(root, "repos", "sample-app");
  await mkdir(repositoryRoot, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));

  const env = { ...process.env, SDD_USER_HOME: userRoot };
  await assert.rejects(
    execFileAsync(process.execPath, [
      join(PACKAGE_ROOT, "bin", "sdd.js"),
      "init",
      repositoryRoot,
      "--json",
    ], { env }),
    (error) => {
      assert.match(error.stderr, /Run `sdd setup` first/);
      return true;
    },
  );

  await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "setup",
    "--planning-root",
    "product/ideas",
    "--repository-root",
    "repos",
    "--yes",
    "--json",
  ], { env });

  const first = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "init",
    repositoryRoot,
    "--json",
  ], { env });
  const result = JSON.parse(first.stdout);
  assert.equal(result.mode, "repository");
  assert.equal(result.createdRepositoryConfig, true);

  const repositoryConfig = parse(
    await readFile(join(repositoryRoot, ".sdd", "config.yaml"), "utf8"),
  );
  assert.equal(repositoryConfig.kind, "repository");
  assert.equal(repositoryConfig.id, "sample-app");
  assert.equal(repositoryConfig.artifacts.epics, "docs/epics");
  repositoryConfig.artifacts.epics = "specs/epics";
  await writeFile(
    join(repositoryRoot, ".sdd", "config.yaml"),
    `${JSON.stringify(repositoryConfig, null, 2)}\n`,
    "utf8",
  );

  const contextOutput = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "context",
    repositoryRoot,
    "--json",
  ], { env });
  const context = JSON.parse(contextOutput.stdout);
  assert.equal(context.kind, "repository");
  assert.equal(context.idea, null);
  assert.equal(context.spaceId, "sample-app");
  assert.equal(context.planningPath, null);
  assert.equal(context.repository.id, "sample-app");
  assert.equal(context.repository.artifacts.epics, "specs/epics");
  assert.equal(context.workflowPath, WORKFLOW_SOURCE_PATH);

  await assert.rejects(
    execFileAsync(process.execPath, [
      join(PACKAGE_ROOT, "bin", "sdd.js"),
      "change",
      "create",
      "sample-app",
      "unmapped-planning",
      "--workspace",
      repositoryRoot,
      "--dry-run",
      "--json",
    ], { env }),
    (error) => {
      const failure = JSON.parse(error.stderr);
      assert.equal(failure.error.code, "PLANNING_MAPPING_REQUIRED");
      return true;
    },
  );

  await assert.rejects(
    execFileAsync(process.execPath, [
      join(PACKAGE_ROOT, "bin", "sdd.js"),
      "change",
      "promote",
      "sample-app",
      "2026-07-14-unmapped-planning",
      "--workspace",
      repositoryRoot,
      "--dry-run",
      "--json",
    ], { env }),
    (error) => {
      const failure = JSON.parse(error.stderr);
      assert.equal(failure.error.code, "PLANNING_MAPPING_REQUIRED");
      return true;
    },
  );

  const epicOutput = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "epic",
    "create",
    "sample-app",
    "APP-001",
    "first-capability",
    "--workspace",
    repositoryRoot,
    "--json",
  ], { env });
  assert.equal(JSON.parse(epicOutput.stdout).epicId, "APP-001");
  assert.equal(
    await pathExists(join(repositoryRoot, "specs", "epics", "app-001-first-capability", "epic.md")),
    true,
  );

  const doctorOutput = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "doctor",
    repositoryRoot,
    "--json",
  ], { env });
  const doctor = JSON.parse(doctorOutput.stdout);
  assert.equal(
    doctor.findings.some((finding) => finding.message.includes("Planning directory for sample-app")),
    false,
  );

  const second = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "init",
    repositoryRoot,
    "--json",
  ], { env });
  const repeated = JSON.parse(second.stdout);
  assert.equal(repeated.createdRepositoryConfig, false);

  const updateOutput = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "update",
    repositoryRoot,
    "--json",
  ], { env });
  const updated = JSON.parse(updateOutput.stdout);
  assert.equal(updated.workflow.action, "bundled");
  assert.equal(await pathExists(join(userRoot, ".sdd", "story-driven-development.md")), false);
});

test("repository init rejects concurrent first initialization without losing the winner", async (t) => {
  const root = await createWorkspace("sdd-concurrent-repository-init-");
  const userRoot = join(root, "home");
  const repositoryRoot = join(root, "repos", "sample-app");
  const originalUserRoot = process.env.SDD_USER_HOME;
  process.env.SDD_USER_HOME = userRoot;
  t.after(() => {
    if (originalUserRoot === undefined) delete process.env.SDD_USER_HOME;
    else process.env.SDD_USER_HOME = originalUserRoot;
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(repositoryRoot, { recursive: true });
  await writeConfig(userRoot, await createUserConfig(userRoot));

  const results = await Promise.allSettled([
    initRepository(repositoryRoot, { repositoryId: "winner-one" }),
    initRepository(repositoryRoot, { repositoryId: "winner-two" }),
  ]);
  const successes = results.filter((result) => result.status === "fulfilled");
  const failures = results.filter((result) => result.status === "rejected");

  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason.code, "OPERATION_IN_PROGRESS");
  const repositoryConfig = parse(await readFile(join(repositoryRoot, ".sdd", "config.yaml"), "utf8"));
  assert.equal(repositoryConfig.id, successes[0].value.repositoryConfig.id);
  assert.equal(await pathExists(join(repositoryRoot, ".sdd", "mutation.lock")), false);
});

test("interactive init asks for planning and repository roots", async (t) => {
  const root = await createWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  const questions = [];
  const responses = ["product/ideas", "apps, services"];

  const options = await collectInitOptions(
    root,
    { dryRun: false, force: false },
    {
      interactive: true,
      ask: async (question) => {
        questions.push(question);
        return responses.shift();
      },
    },
  );

  assert.equal(questions.length, 2);
  assert.equal(options.planningRoot, "product/ideas");
  assert.deepEqual(options.repositoryRoots, ["apps", "services"]);
});

test("interactive init accepts detected roots and skips explicitly configured questions", async (t) => {
  const root = await createWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "ideas"), { recursive: true });
  await mkdir(join(root, "code"), { recursive: true });
  const questions = [];

  const detected = await collectInitOptions(
    root,
    {},
    {
      interactive: true,
      ask: async (question) => {
        questions.push(question);
        return "";
      },
    },
  );
  assert.equal(detected.planningRoot, "ideas");
  assert.deepEqual(detected.repositoryRoots, ["code"]);

  questions.length = 0;
  const explicit = await collectInitOptions(
    root,
    { planningRoot: "plans", repositoryRoots: ["repos"] },
    { interactive: true, ask: async (question) => questions.push(question) },
  );
  assert.equal(questions.length, 0);
  assert.equal(explicit.planningRoot, "plans");
  assert.deepEqual(explicit.repositoryRoots, ["repos"]);
});

test("configure detects renamed workspace roots and preserves mappings", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const original = await readConfig(root);
  await moveWorkspaceRoots(root);

  const diagnosis = await diagnoseWorkspace(root);
  assert.deepEqual(
    diagnosis.findings.map((finding) => finding.message),
    ["Planning root does not exist: ideas.", "Repository root code does not exist: code."],
  );
  assert.deepEqual(diagnosis.remediations, [
    {
      command: "sdd configure",
      message: "Repair missing planning or repository roots using detected workspace paths.",
    },
  ]);

  const inspection = await inspectWorkspaceConfiguration(root);
  assert.equal(inspection.planning.suggestion, "spaces/ideas");
  assert.equal(inspection.repositoryRoots[0].suggestion, "spaces/code");

  const dryRun = await configureWorkspace(root, { acceptSuggestions: true, dryRun: true });
  assert.deepEqual(
    dryRun.changes.map((change) => [change.kind, change.from, change.to]),
    [
      ["planning", "ideas", "spaces/ideas"],
      ["repository", "code", "spaces/code"],
    ],
  );
  assert.equal((await readConfig(root)).planning.root, "ideas");

  const result = await configureWorkspace(root, { acceptSuggestions: true });
  const configured = await readConfig(root);
  assert.equal(result.changed, true);
  assert.equal(configured.planning.root, "spaces/ideas");
  assert.deepEqual(configured.repositories.roots, { code: "spaces/code" });
  assert.deepEqual(configured.ideas, original.ideas);
  assert.deepEqual(configured.repositoryArtifacts, original.repositoryArtifacts);
  assert.equal((await diagnoseWorkspace(root)).findings.length, 0);
});

test("runtime config validation rejects unknown keys and ambiguous artifact roots", async () => {
  const workspaceConfig = {
    version: 2,
    schema: "sdd-v2",
    skills: { directory: ".agents/skills", unexpected: true },
    planning: { root: "planning", plannedChangesDirectory: "planned-changes" },
    repositories: { roots: { apps: "code" } },
    repositoryArtifacts: {
      activeChanges: "docs/changes",
      closedChanges: "docs/changes/closed",
      epics: "docs/changes/epics",
      adrs: "docs/adrs",
      audits: "docs/audits",
    },
    ideas: { sample: { repositories: [] } },
  };
  const findings = validateConfig(workspaceConfig);
  assert.ok(findings.some((finding) => finding.message.includes("skills contains unknown key")));
  assert.ok(findings.some((finding) => finding.message.includes("repositoryArtifacts.activeChanges")
    && finding.message.includes("repositoryArtifacts.epics")));

  const repositoryFindings = validateRepositoryConfig({
    kind: "repository",
    version: 1,
    schema: "sdd-repository-v1",
    id: "sample",
    unexpected: true,
    artifacts: {
      activeChanges: "docs/changes",
      closedChanges: "docs/changes/closed",
      epics: "docs/epics",
      adrs: "docs/adrs",
      audits: "docs/audits",
    },
  });
  assert.ok(repositoryFindings.some((finding) =>
    finding.message.includes("Repository configuration contains unknown key")));
});

test("context rejects physical aliases claimed as different repositories", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await symlink(join(root, "code", "sample-web"), join(root, "code", "sample-web-alias"));
  const config = await readConfig(root);
  config.ideas.other = {
    status: "active",
    repositories: [{ path: "code/sample-web-alias", status: "active" }],
  };
  await writeConfig(root, config);

  await assert.rejects(
    () => getWorkspaceContext(join(root, "code", "sample-web")),
    (error) => error instanceof SddError
      && error.code === "INVALID_CONFIG"
      && error.details.some((detail) => detail.includes("already claimed")),
  );
});

test("interactive configure asks only for missing roots and accepts detected defaults", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await moveWorkspaceRoots(root);
  const questions = [];

  const options = await collectConfigureOptions(
    root,
    {},
    {
      interactive: true,
      ask: async (question) => {
        questions.push(question);
        return "";
      },
    },
  );

  assert.equal(questions.length, 2);
  assert.match(questions[0], /spaces\/ideas/);
  assert.match(questions[1], /spaces\/code/);
  assert.equal(options.planningRoot, "spaces/ideas");
  assert.deepEqual(options.repositoryRoots, { code: "spaces/code" });
});

test("configure requires input when prompting and suggestion acceptance are disabled", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await moveWorkspaceRoots(root);

  await assert.rejects(
    () => configureWorkspace(root),
    (error) =>
      error instanceof SddError &&
      error.code === "CONFIG_INPUT_REQUIRED" &&
      error.details.some((detail) => detail.includes("spaces/ideas")),
  );
});

test("CLI configure accepts detected path replacements with JSON output", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await moveWorkspaceRoots(root);

  const { stdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "configure",
    root,
    "--yes",
    "--json",
  ]);
  const result = JSON.parse(stdout);

  assert.equal(result.command, "configure");
  assert.equal(result.changed, true);
  assert.equal(result.planningRoot, "spaces/ideas");
  assert.deepEqual(result.repositoryRoots, { code: "spaces/code" });
  assert.equal((await diagnoseWorkspace(root)).findings.length, 0);
});

test("repeated init is idempotent and preserves unrelated skills", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".agents", "skills", "custom-skill"), { recursive: true });
  await writeFile(join(root, ".agents", "skills", "custom-skill", "SKILL.md"), "custom\n", "utf8");

  await initWorkspace(root);
  const second = await initWorkspace(root);

  assert.equal(second.created, false);
  assert.ok(second.skills.actions.every((entry) => entry.action === "unchanged"));
  assert.equal(
    await readFile(join(root, ".agents", "skills", "custom-skill", "SKILL.md"), "utf8"),
    "custom\n",
  );
});

test("update refuses to overwrite locally modified managed skills", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);

  const managedSkill = join(root, ".agents", "skills", "sdd-change", "SKILL.md");
  await writeFile(managedSkill, `${await readFile(managedSkill, "utf8")}\nlocal edit\n`, "utf8");

  await assert.rejects(
    () => updateWorkspace(root),
    (error) => error instanceof SddError && error.code === "SKILL_CONFLICT",
  );

  const diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, false);
  assert.ok(diagnosis.findings.some((finding) => finding.message.includes("sdd-change")));
});

test("forced update restores a conflicting managed skill", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);

  const managedSkill = join(root, ".agents", "skills", "sdd-change", "SKILL.md");
  await writeFile(managedSkill, "local replacement\n", "utf8");

  const result = await updateWorkspace(root, { force: true });
  assert.equal(
    result.skills.actions.find((entry) => entry.skillName === "sdd-change").action,
    "update-forced",
  );
  assert.notEqual(await readFile(managedSkill, "utf8"), "local replacement\n");
  assert.equal((await diagnoseWorkspace(root)).healthy, true);
});

test("managed workflow changes conflict by default and recover only with force", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const workflowPath = join(root, ".sdd", "story-driven-development.md");
  await writeFile(workflowPath, `${await readFile(workflowPath, "utf8")}\nlocal edit\n`, "utf8");

  await assert.rejects(
    () => updateWorkspace(root),
    (error) => error instanceof SddError && error.code === "WORKFLOW_CONFLICT",
  );
  assert.equal((await diagnoseWorkspace(root)).healthy, false);

  const result = await updateWorkspace(root, { force: true });
  assert.equal(result.workflow.action, "update-forced");
  assert.equal(await readFile(workflowPath, "utf8"), await readFile(WORKFLOW_SOURCE_PATH, "utf8"));
  assert.equal((await diagnoseWorkspace(root)).healthy, true);
});

test("update removes a retired skill only when it matches its managed hash", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const retiredPath = join(root, ".agents", "skills", "sdd-doctrine");
  await mkdir(retiredPath, { recursive: true });
  await writeFile(join(retiredPath, "SKILL.md"), "retired\n", "utf8");
  const lockPath = getInstallLockPath(root);
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  lock.managedSkills["sdd-doctrine"] = await hashDirectory(retiredPath);
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

  await writeFile(join(retiredPath, "SKILL.md"), "retired with local changes\n", "utf8");
  await assert.rejects(
    () => updateWorkspace(root),
    (error) => error instanceof SddError && error.code === "SKILL_CONFLICT",
  );
  await writeFile(join(retiredPath, "SKILL.md"), "retired\n", "utf8");

  const result = await updateWorkspace(root);
  assert.equal(
    result.skills.actions.find((entry) => entry.skillName === "sdd-doctrine").action,
    "remove",
  );
  assert.equal(await pathExists(retiredPath), false);
  const updatedLock = JSON.parse(await readFile(lockPath, "utf8"));
  assert.equal(Object.hasOwn(updatedLock.managedSkills, "sdd-doctrine"), false);
});

test("doctor reports duplicate repository ownership", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const config = await readConfig(root);
  config.ideas.another = {
    planning: "another",
    repositories: [{ root: "code", path: "sample-web" }],
  };
  await writeConfig(root, config);

  const diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, false);
  assert.ok(
    diagnosis.findings.some((finding) =>
      finding.message.includes("claimed by both sample and another"),
    ),
  );
});

test("doctor reports obsolete workflow references in project guidance", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const guidancePath = join(root, "code", "sample-web", "AGENTS.md");
  await writeFile(
    guidancePath,
    "Run `sdd context . --json` and read `<workspaceRoot>/.sdd/story-driven-development.md`.\n",
    "utf8",
  );

  const diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, false);
  assert.ok(
    diagnosis.findings.some(
      (finding) =>
        finding.level === "error" &&
        finding.message.includes("obsolete SDD workflow location") &&
        finding.message.includes("sample-web/AGENTS.md"),
    ),
  );
});

test("doctor reports retired SDD commands in project guidance", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const guidancePath = join(root, "code", "sample-web", "CLAUDE.md");
  await writeFile(guidancePath, "Use `/sdd-propose` before implementation.\n", "utf8");

  const diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, false);
  assert.ok(
    diagnosis.findings.some(
      (finding) =>
        finding.level === "error" &&
        finding.message.includes("retired /sdd-propose command") &&
        finding.message.includes("sample-web/CLAUDE.md"),
    ),
  );
});

test("doctor accepts guidance that resolves the workflow through sdd context", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const guidancePath = join(root, "code", "sample-web", "AGENTS.md");
  await writeFile(
    guidancePath,
    "Run `sdd context . --json` and read the returned `workflowPath`.\n",
    "utf8",
  );

  const diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, true);
});

test("doctor ignores obsolete guidance in archived repository mappings", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const config = await readConfig(root);
  config.ideas.sample.repositories[0].status = "archived";
  await writeConfig(root, config);
  await writeFile(
    join(root, "code", "sample-web", "AGENTS.md"),
    "Read `<workspaceRoot>/.sdd/story-driven-development.md`.\n",
    "utf8",
  );

  const diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, true);
});

test("doctor validates active Change status frontmatter", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changePath = join(root, "code", "sample-web", "docs", "changes", "2026-07-14-example");
  await mkdir(changePath, { recursive: true });
  await writeFile(join(changePath, "tasks.md"), "# Tasks\n", "utf8");

  let diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, false);
  assert.ok(diagnosis.findings.some((finding) => finding.message.includes("missing tasks.md status")));

  await writeFile(
    join(changePath, "tasks.md"),
    "---\nstatus: in_progress\n---\n# Tasks\n",
    "utf8",
  );
  diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, true);

  await writeFile(join(changePath, "tasks.md"), "---\nstatus: review\n---\n# Tasks\n", "utf8");
  diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, false);
  assert.ok(diagnosis.findings.some((finding) => finding.message.includes('"review"')));

  await writeFile(join(changePath, "tasks.md"), "---\nstatus: active\n---\n# Tasks\n", "utf8");
  diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, false);
  assert.ok(diagnosis.findings.some((finding) => finding.message.includes('"active"')));
});

test("doctor validates Changes in unmapped repositories under configured roots", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changePath = join(root, "code", "shared-tool", "docs", "changes", "2026-07-14-example");
  await mkdir(changePath, { recursive: true });
  await writeFile(join(changePath, "tasks.md"), "# Tasks\n", "utf8");

  const diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, false);
  assert.ok(diagnosis.findings.some((finding) => finding.message.includes("code/shared-tool")));
});

test("closed Change state comes from folder location and accepts historical statuses", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changePath = join(root, "code", "sample-web", "docs", "changes", "closed", "2026-07-14-example");
  await mkdir(changePath, { recursive: true });
  await writeFile(join(changePath, "tasks.md"), "# Tasks\n", "utf8");

  let diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, false);
  assert.ok(diagnosis.findings.some((finding) => finding.message.includes("missing tasks.md status")));

  await writeFile(join(changePath, "tasks.md"), "---\nstatus: closed\n---\n# Tasks\n", "utf8");

  diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, false);
  assert.ok(diagnosis.findings.some((finding) => finding.message.includes('"closed"')));

  await writeFile(
    join(changePath, "tasks.md"),
    "---\nstatus: ready_to_close\n---\n# Tasks\n",
    "utf8",
  );
  diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, true);
});

test("doctor reports malformed configuration without inspecting managed skills", async (t) => {
  const root = await createWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".sdd"), { recursive: true });
  await writeFile(join(root, ".sdd", "config.yaml"), "version: 1\nschema: sdd-v1\n", "utf8");

  const diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, false);
  assert.ok(diagnosis.counts.errors >= 1);
  assert.ok(diagnosis.findings.some((finding) => finding.message.includes("skills.directory")));
});

test("init rejects layout overrides after configuration exists", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);

  await assert.rejects(
    () => initWorkspace(root, { planningRoot: "other-ideas" }),
    (error) => error instanceof SddError && error.code === "CONFIG_ALREADY_EXISTS",
  );
});

test("init migrates v1 workspace paths to derived v2 references", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".sdd"), { recursive: true });
  await writeConfig(root, {
    version: 1,
    schema: "sdd-v1",
    skills: { directory: ".agents/skills" },
    planning: { root: "ideas", plannedChangesDirectory: "planned-changes" },
    repositories: { roots: ["code"] },
    repositoryArtifacts: {
      activeChanges: "docs/changes",
      closedChanges: "docs/changes/closed",
      epics: "docs/epics",
      adrs: "docs/adrs",
      audits: "docs/audits",
    },
    ideas: {
      sample: {
        planning: "ideas/sample",
        repositories: [
          { path: "code/sample-web", role: "web" },
          { path: "code/sample-mobile", role: "mobile" },
        ],
      },
    },
  });

  const result = await initWorkspace(root);
  const config = await readConfig(root);
  assert.equal(result.migratedFrom, 1);
  assert.equal(config.version, 2);
  assert.equal(config.schema, "sdd-v2");
  assert.deepEqual(config.repositories.roots, { code: "code" });
  assert.equal(config.ideas.sample.planning, undefined);
  assert.equal(config.ideas.sample.status, "active");
  assert.deepEqual(config.ideas.sample.repositories[0], {
    root: "code",
    path: "sample-web",
    role: "web",
    status: "active",
  });
  assert.equal((await diagnoseWorkspace(root)).healthy, true);
});

test("idea planning and repository paths support explicit project overrides", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await mkdir(join(root, "ideas", "custom-planning"), { recursive: true });
  await mkdir(join(root, "private", "external-planning"), { recursive: true });
  await mkdir(join(root, "integrations", "special-client"), { recursive: true });
  const config = await readConfig(root);
  config.ideas.sample.planning = "custom-planning";
  config.ideas.sample.repositories.push({
    path: "integrations/special-client",
    role: "integration-client",
  });
  config.ideas.external = {
    planningPath: "private/external-planning",
    repositories: [],
  };
  await writeConfig(root, config);

  const planning = await getWorkspaceContext(join(root, "ideas", "custom-planning"));
  const externalPlanning = await getWorkspaceContext(join(root, "private", "external-planning"));
  const repository = await getWorkspaceContext(join(root, "integrations", "special-client"));
  assert.equal(planning.idea, "sample");
  assert.equal(externalPlanning.idea, "external");
  assert.equal(repository.idea, "sample");
  assert.equal(repository.repository.root, undefined);
  assert.equal(repository.repository.role, "integration-client");
  assert.equal(repository.ideaStatus, "active");
  assert.equal(repository.repository.status, "active");
  assert.equal((await diagnoseWorkspace(root)).healthy, true);
});

test("context resolves planning and repository ownership", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);

  const planning = await getWorkspaceContext(join(root, "ideas", "sample"));
  assert.equal(planning.kind, "planning");
  assert.equal(planning.idea, "sample");
  assert.equal(planning.spaceId, "sample");
  assert.equal(planning.planningPath, "ideas/sample");
  assert.equal(planning.ideaStatus, "active");
  assert.equal(planning.relatedRepositories.length, 2);

  const repository = await getWorkspaceContext(join(root, "code", "sample-mobile"));
  assert.equal(repository.kind, "repository");
  assert.equal(repository.idea, "sample");
  assert.equal(repository.spaceId, "sample");
  assert.equal(repository.repository.role, "mobile");
  assert.equal(repository.repository.status, "active");
  assert.equal(repository.repository.resolvedPath, "code/sample-mobile");
});

test("status summarizes every Space and prefers its newest active Change", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeChange(root, "sample-web", "2026-07-10-older-active", "in_progress");
  await writeChange(root, "sample-mobile", "2026-07-12-newer-active", "in_review");
  await writeChange(root, "sample-web", "2026-07-14-newest-closed", "ready_to_close", {
    closed: true,
  });

  const result = await getStatus(root);
  assert.equal(result.mode, "summary");
  assert.equal(result.spaces.length, 1);
  assert.equal(result.spaces[0].spaceId, "sample");
  assert.equal(result.spaces[0].status, "active");
  assert.equal(result.spaces[0].activeChangeCount, 2);
  assert.equal(result.spaces[0].change.changeId, "2026-07-12-newer-active");
  assert.equal(result.spaces[0].change.status, "in_review");
  assert.deepEqual(
    result.spaces[0].repositoryActivity.map((repository) => ({
      repository: repository.resolvedPath,
      status: repository.status,
      role: repository.role,
      activeChangeCount: repository.activeChangeCount,
      activeChanges: repository.activeChanges.map((change) => change.changeId),
    })),
    [
      {
        repository: "code/sample-web",
        status: "active",
        role: "web",
        activeChangeCount: 1,
        activeChanges: ["2026-07-10-older-active"],
      },
      {
        repository: "code/sample-mobile",
        status: "active",
        role: "mobile",
        activeChangeCount: 1,
        activeChanges: ["2026-07-12-newer-active"],
      },
    ],
  );
  assert.deepEqual(statusSummaryRows(result), [
    ["sample", "active", "active", "web", "in_progress", "2026-07-10-older-active", "code/sample-web", 1],
    ["sample", "active", "active", "mobile", "in_review", "2026-07-12-newer-active", "code/sample-mobile", 1],
  ]);
});

test("status reports branch and uncommitted Git state for each mapped repository", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);

  const webRoot = join(root, "code", "sample-web");
  const mobileRoot = join(root, "code", "sample-mobile");
  await execFileAsync("git", ["init", "-b", "develop", webRoot]);
  await writeFile(join(webRoot, "tracked.md"), "staged\n", "utf8");
  await execFileAsync("git", ["-C", webRoot, "add", "tracked.md"]);
  await writeFile(join(webRoot, "tracked.md"), "unstaged\n", "utf8");
  await writeFile(join(webRoot, "untracked.md"), "untracked\n", "utf8");
  await execFileAsync("git", ["init", "-b", "main", mobileRoot]);

  const result = await getStatus(root);
  const [web, mobile] = result.spaces[0].repositoryActivity;
  assert.deepEqual(web.git, {
    available: true,
    branch: "develop",
    head: null,
    detached: false,
    dirty: true,
    staged: 1,
    unstaged: 1,
    untracked: 1,
    conflicted: 0,
  });
  assert.deepEqual(mobile.git, {
    available: true,
    branch: "main",
    head: null,
    detached: false,
    dirty: false,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
  });
});

test("status degrades one stalled Git repository without blocking its siblings", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const fakeGit = join(root, "fake-git");
  await writeFile(
    fakeGit,
    [
      "#!/bin/sh",
      "case \"$2\" in",
      "  *sample-web) sleep 5 ;;",
      "  *) printf '# branch.oid abc123\\n# branch.head develop\\n' ;;",
      "esac",
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(fakeGit, 0o755);

  const result = await getStatus(root, "sample", {
    gitCommand: fakeGit,
    gitTimeoutMs: 1_000,
  });
  const byPath = new Map(
    result.repositories.map((repository) => [repository.resolvedPath, repository]),
  );
  assert.equal(byPath.get("code/sample-web").git.error, "Git status timed out");
  assert.equal(
    byPath.get("code/sample-mobile").git.available,
    true,
    JSON.stringify([...byPath.entries()]),
  );
  assert.equal(byPath.get("code/sample-mobile").git.branch, "develop");
});

test("CLI status ends human output with a blank line", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);

  const { stdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "status",
    "--workspace",
    root,
  ]);

  assert.equal(stdout.endsWith("\n\n"), true);
});

test("status filters inactive lifecycle entries unless all are requested", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeChange(root, "sample-web", "2026-07-10-web-active", "in_progress");
  await writeChange(root, "sample-mobile", "2026-07-11-mobile-active", "in_review");

  const config = await readConfig(root);
  config.ideas.sample.status = "inactive";
  config.ideas.sample.repositories[0].status = "archived";
  await writeConfig(root, config);

  const filteredIdea = await getStatus(root);
  assert.equal(filteredIdea.filter, "active");
  assert.deepEqual(filteredIdea.spaces, []);

  const all = await getStatus(root, null, { includeAll: true });
  assert.equal(all.filter, "all");
  assert.equal(all.spaces[0].status, "inactive");
  assert.deepEqual(all.spaces[0].repositories.map((repository) => repository.status), [
    "archived",
    "active",
  ]);
  assert.deepEqual(statusSummaryRows(all).map((row) => [row[0], row[2], row[6], row[7]]), [
    ["sample", "archived", "code/sample-web", 1],
    ["sample", "active", "code/sample-mobile", 1],
  ]);

  config.ideas.sample.status = "active";
  await writeConfig(root, config);
  const filteredRepository = await getStatus(root);
  assert.equal(filteredRepository.spaces.length, 1);
  assert.deepEqual(
    filteredRepository.spaces[0].repositories.map((repository) => repository.resolvedPath),
    ["code/sample-mobile"],
  );
  assert.equal(filteredRepository.spaces[0].activeChangeCount, 1);

  const detail = await getStatus(root, "sample");
  assert.equal(detail.status, "active");
  assert.deepEqual(detail.repositories.map((repository) => repository.status), [
    "archived",
    "active",
  ]);
});

test("status summary retains active ideas and repositories without active Changes", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeChange(root, "sample-web", "2026-07-14-latest-closed", "ready_to_close", {
    closed: true,
  });

  const result = await getStatus(root);
  assert.deepEqual(statusSummaryRows(result), [
    ["sample", "active", "active", "web", "closed", "2026-07-14-latest-closed", "code/sample-web", 0],
    ["sample", "active", "active", "mobile", "-", "-", "code/sample-mobile", 0],
  ]);
});

test("status details one Space with active Changes and five recent closed Changes", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = join(root, "code", "sample-web", "docs", "epics", "sample-e001-core", "epic.md");
  await mkdir(join(epicPath, ".."), { recursive: true });
  await writeFile(
    epicPath,
    "---\nid: SAMPLE-E001\nstatus: active\n---\n# SAMPLE-E001 Core Experience\n",
    "utf8",
  );
  for (let day = 1; day <= 6; day += 1) {
    await writeChange(
      root,
      day % 2 === 0 ? "sample-web" : "sample-mobile",
      `2026-07-0${day}-change-${day}`,
      "in_review",
      { closed: day !== 6 },
    );
  }

  const result = await getStatus(root, "sample");
  assert.equal(result.mode, "space");
  assert.equal(result.spaceId, "sample");
  assert.equal(result.repositories.length, 2);
  assert.equal(result.activeChangeCount, 1);
  assert.deepEqual(
    result.repositoryActivity.map((repository) => ({
      status: repository.status,
      role: repository.role,
      activeChangeCount: repository.activeChangeCount,
    })),
    [
      { status: "active", role: "web", activeChangeCount: 1 },
      { status: "active", role: "mobile", activeChangeCount: 0 },
    ],
  );
  assert.equal(result.epics.length, 1);
  assert.equal(result.repositoryDetails.length, 2);
  assert.deepEqual(
    result.repositoryDetails.map((repository) => ({
      status: repository.status,
      role: repository.role,
      activeChangeCount: repository.activeChangeCount,
      epicIds: repository.epics.map((epic) => epic.id),
      activeChangeIds: repository.activeChanges.map((change) => change.changeId),
      recentChangeIds: repository.recentChanges.map((change) => change.changeId),
    })),
    [
      {
        status: "active",
        role: "web",
        activeChangeCount: 1,
        epicIds: ["SAMPLE-E001"],
        activeChangeIds: ["2026-07-06-change-6"],
        recentChangeIds: ["2026-07-04-change-4", "2026-07-02-change-2"],
      },
      {
        status: "active",
        role: "mobile",
        activeChangeCount: 0,
        epicIds: [],
        activeChangeIds: [],
        recentChangeIds: ["2026-07-05-change-5", "2026-07-03-change-3", "2026-07-01-change-1"],
      },
    ],
  );
  assert.deepEqual(
    { id: result.epics[0].id, title: result.epics[0].title, status: result.epics[0].status },
    { id: "SAMPLE-E001", title: "Core Experience", status: "active" },
  );
  assert.equal(result.activeChanges.length, 1);
  assert.equal(result.activeChanges[0].changeId, "2026-07-06-change-6");
  assert.equal(result.activeChanges[0].status, "in_review");
  assert.equal(result.recentChanges.length, 5);
  assert.equal(result.recentChanges[0].status, "closed");
});

test("CLI status counts and prints only closed Changes as recent", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeChange(root, "sample-web", "2026-07-14-active", "planned");
  await writeChange(root, "sample-web", "2026-07-13-closed", "in_review", { closed: true });

  const { stdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "status",
    "sample",
    "--workspace",
    root,
  ]);

  assert.match(stdout, /Active Changes \(1\):\n  2026-07-14-active \[planned\]/);
  assert.match(stdout, /Recent Changes \(1\):\n  2026-07-13-closed \[closed\]/);
  assert.doesNotMatch(stdout, /Recent Changes \(2\)/);
});

test("status rejects an unknown Space ID", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);

  await assert.rejects(
    () => getStatus(root, "missing"),
    (error) => error instanceof SddError && error.code === "SPACE_NOT_FOUND",
  );
});

test("epic create scaffolds and validates a canonical Epic in one repository", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);

  const result = await createEpic(root, "sample", "SAMPLE-E002", "saved-searches", {
    date: "2026-07-14",
    repositories: ["code/sample-web"],
  });

  assert.equal(result.command, "epic-create");
  assert.equal(result.epicId, "SAMPLE-E002");
  assert.equal(result.path, "code/sample-web/docs/epics/sample-e002-saved-searches/epic.md");
  assert.equal(result.repository.resolvedPath, "code/sample-web");
  assert.equal(result.validation.valid, true);
  assert.equal(result.validation.summary.epics, 1);

  const source = await readFile(join(root, result.path), "utf8");
  assert.match(source, /^schema: sdd-epic-v2$/m);
  assert.match(source, /^id: SAMPLE-E002$/m);
  assert.match(source, /^# SAMPLE-E002 Saved Searches$/m);
  assert.match(source, /^## Notes$/m);
  assert.match(source, /^#### Story Notes$/m);
  assert.match(source, /^Implementation: not implemented$/m);
  assert.match(source, /^Verification: unverified$/m);
  assert.match(source, /^#### Implementation Gaps$/m);
  assert.match(source, /^\| Requirement \/ Scenario \| Location \/ Anchor \| Kind \| Responsibility \|$/m);
  assert.match(source, /^\| Story \| Implementation \| Verification \| Capability \| Last Verified \| Notes \|$/m);
  assert.match(source, /^\| Requirement \/ Scenario \| Evidence \| Proves \| Status \|$/m);
  assert.doesNotMatch(source, /EPIC-ID|Epic Name|yyyy-mm-dd/);
});

test("packaged Epic templates stay synchronized", async () => {
  const canonical = await readFile(join(PACKAGE_ROOT, "docs", "templates", "epic.md"), "utf8");
  for (const skill of ["sdd-change", "sdd-apply", "sdd-epic-verify"]) {
    assert.equal(
      await readFile(join(PACKAGE_ROOT, "skills", skill, "assets", "epic-template.md"), "utf8"),
      canonical,
      `${skill} Epic template must match the canonical package template`,
    );
  }
});

test("packaged workflow templates preserve boundary, transition, and evidence-integrity contracts", async () => {
  const tasksTemplate = await readFile(
    join(PACKAGE_ROOT, "docs", "templates", "tasks.md"),
    "utf8",
  );
  assert.equal(
    await readFile(
      join(PACKAGE_ROOT, "skills", "sdd-change", "assets", "tasks-template.md"),
      "utf8",
    ),
    tasksTemplate,
    "sdd-change tasks template must match the canonical package template",
  );
  assert.match(tasksTemplate, /^## Pattern Parity Matrix$/m);
  assert.match(tasksTemplate, /^## Boundary Contract Matrix$/m);
  assert.match(tasksTemplate, /^## Stateful Transition Matrix$/m);
  assert.match(tasksTemplate, /concurrent start \/ cancel then late completion \/ replacement \/ retry \/ remount \/ restart/);
  assert.match(tasksTemplate, /^## Verification Scope Decision$/m);
  assert.match(tasksTemplate, /exact test title or stable named test anchor/);

  const reviewTemplate = await readFile(
    join(PACKAGE_ROOT, "docs", "templates", "review.md"),
    "utf8",
  );
  assert.equal(
    await readFile(
      join(PACKAGE_ROOT, "skills", "sdd-review", "assets", "review-template.md"),
      "utf8",
    ),
    reviewTemplate,
    "sdd-review report template must match the canonical package template",
  );
  assert.match(reviewTemplate, /^\| Evidence falsification \|/m);
  assert.match(reviewTemplate, /^\| Pattern conformance \|/m);
  assert.match(reviewTemplate, /^\| Boundary contracts \|/m);
  assert.match(reviewTemplate, /^\| Stateful transitions \|/m);
  assert.match(reviewTemplate, /^## Boundary And Conservation Review$/m);
  assert.match(reviewTemplate, /^## Verification Scope And Candidate Gates$/m);

  const epicVerifyTemplate = await readFile(
    join(PACKAGE_ROOT, "docs", "templates", "epic-verify-report.md"),
    "utf8",
  );
  assert.equal(
    await readFile(
      join(PACKAGE_ROOT, "skills", "sdd-epic-verify", "assets", "epic-verify-report-template.md"),
      "utf8",
    ),
    epicVerifyTemplate,
    "sdd-epic-verify report template must match the canonical package template",
  );
  assert.match(epicVerifyTemplate, /^schema: sdd-epic-verify-report-v1$/m);
  assert.match(epicVerifyTemplate, /^result: blocked$/m);
  assert.match(epicVerifyTemplate, /^## Current Findings$/m);
  assert.match(epicVerifyTemplate, /^\| Aggregate\/runtime verification scope \|/m);

  const releaseTemplate = await readFile(
    join(PACKAGE_ROOT, "docs", "templates", "release-pr.md"),
    "utf8",
  );
  assert.equal(
    await readFile(
      join(PACKAGE_ROOT, "skills", "sdd-release", "assets", "release-pr-template.md"),
      "utf8",
    ),
    releaseTemplate,
    "sdd-release PR template must match the canonical package template",
  );
  assert.match(releaseTemplate, /^## File Scope Reconciliation$/m);
  assert.match(releaseTemplate, /^## Remote Review Watermarks$/m);
  assert.match(releaseTemplate, /Cumulative release-candidate review required/);
  assert.match(releaseTemplate, /^## Documentation And SDD Integrity$/m);

  const applySkill = await readFile(
    join(PACKAGE_ROOT, "skills", "sdd-apply", "SKILL.md"),
    "utf8",
  );
  const reviewSkill = await readFile(
    join(PACKAGE_ROOT, "skills", "sdd-review", "SKILL.md"),
    "utf8",
  );
  assert.match(applySkill, /Pattern Parity Matrix/);
  assert.match(applySkill, /Boundary Contract Matrix/);
  assert.match(applySkill, /Stateful Transition Matrix/);
  assert.match(applySkill, /filesystem mutation-order/);
  assert.match(applySkill, /Evidence Claim Integrity/);
  assert.match(applySkill, /Keep three proof layers distinct/);
  assert.match(reviewSkill, /\*\*Evidence falsification\*\*/);
  assert.match(reviewSkill, /\*\*Pattern conformance\*\*/);
  assert.match(reviewSkill, /\*\*Boundary contracts\*\*/);
  assert.match(reviewSkill, /\*\*Risk-shaped evidence and stateful transitions\*\*/);
  assert.match(reviewSkill, /durable work whose identifier never reached the client/);
  assert.match(reviewSkill, /Require integration-candidate proof/);
});

test("packaged audit and handoff skills preserve current-state and file-scope gates", async () => {
  const epicVerifySkill = await readFile(
    join(PACKAGE_ROOT, "skills", "sdd-epic-verify", "SKILL.md"),
    "utf8",
  );
  assert.match(epicVerifySkill, /immutable audit snapshot/);
  assert.match(epicVerifySkill, /Current Tests And Checks/);
  assert.match(epicVerifySkill, /supersedes/);
  assert.match(epicVerifySkill, /final batch-coherence pass/);

  const prSkill = await readFile(
    join(PACKAGE_ROOT, "skills", "sdd-pr", "SKILL.md"),
    "utf8",
  );
  assert.doesNotMatch(prSkill, /^\s*- `--fix`:/m);
  assert.match(prSkill, /exact source-to-target changed-file inventory/);
  assert.match(prSkill, /Remote Review Watermark/);
  assert.match(prSkill, /resolved old-head comments alone do not satisfy this gate/);

  const releaseSkill = await readFile(
    join(PACKAGE_ROOT, "skills", "sdd-release", "SKILL.md"),
    "utf8",
  );
  assert.match(releaseSkill, /exact source-to-target changed-file inventory/);
  assert.match(releaseSkill, /compare it path-for-path with the recorded release allowlist/);
  assert.match(releaseSkill, /Per-Change focused evidence/);
  assert.match(releaseSkill, /fresh-context cumulative release-candidate code\/security\/state review/);
  assert.match(releaseSkill, /initial production release, multiple integrated Changes/);
});

test("epic create refuses ambiguous repositories, collisions, and dry-run writes", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);

  await assert.rejects(
    () => createEpic(root, "sample", "SAMPLE-E002", "saved-searches", {
      date: "2026-07-14",
    }),
    (error) => error instanceof SddError && error.code === "REPOSITORY_REQUIRED",
  );

  const dryRun = await createEpic(root, "sample", "SAMPLE-E002", "saved-searches", {
    date: "2026-07-14",
    repositories: ["sample-web"],
    dryRun: true,
  });
  assert.equal(dryRun.dryRun, true);
  assert.equal(await pathExists(join(root, dryRun.path)), false);

  await createEpic(root, "sample", "SAMPLE-E002", "saved-searches", {
    date: "2026-07-14",
    repositories: ["sample-web"],
  });
  await assert.rejects(
    () => createEpic(root, "sample", "SAMPLE-E002", "saved-searches", {
      date: "2026-07-14",
      repositories: ["sample-web"],
    }),
    (error) => error instanceof SddError && error.code === "EPIC_EXISTS",
  );
});

test("CLI exposes epic create with JSON output", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);

  const { stdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "epic",
    "create",
    "sample",
    "SAMPLE-E002",
    "saved-searches",
    "--workspace",
    root,
    "--repo",
    "sample-web",
    "--date",
    "2026-07-14",
    "--json",
  ]);
  const result = JSON.parse(stdout);

  assert.equal(result.command, "epic-create");
  assert.equal(result.epicId, "SAMPLE-E002");
  assert.equal(result.validation.valid, true);
});

test("change create scaffolds a planned Change for a selected repository", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);

  const result = await createPlannedChange(root, "sample", "mobile-notes-access", {
    date: "2026-07-14",
    repositories: ["code/sample-mobile"],
  });

  assert.equal(result.command, "change-create");
  assert.equal(result.changeId, "2026-07-14-mobile-notes-access");
  assert.equal(result.path, "ideas/sample/planned-changes/2026-07-14-mobile-notes-access");
  assert.deepEqual(result.repositories, [
    {
      root: "code",
      path: "sample-mobile",
      role: "mobile",
      status: "active",
      resolvedPath: "code/sample-mobile",
    },
  ]);
  assert.deepEqual(result.files, ["proposal.md", "design.md", "tasks.md"]);

  const changeRoot = join(root, result.path);
  const proposal = await readFile(join(changeRoot, "proposal.md"), "utf8");
  const design = await readFile(join(changeRoot, "design.md"), "utf8");
  const tasks = await readFile(join(changeRoot, "tasks.md"), "utf8");
  assert.match(proposal, /^# Proposal: Mobile Notes Access/m);
  assert.match(proposal, /Planned location: `ideas\/sample\/planned-changes\/2026-07-14-mobile-notes-access`/);
  assert.match(proposal, /`code\/sample-mobile` \(mobile\)/);
  assert.match(design, /^# Design: Mobile Notes Access/m);
  assert.match(tasks, /^---\nstatus: proposed\n---/);
  assert.match(tasks, /run scoped `sdd validate`/i);
  assert.match(tasks, /run `sdd change close`/);
  assert.match(tasks, /^# Tasks: Mobile Notes Access/m);
  assert.doesNotMatch(`${proposal}\n${design}\n${tasks}`, /CHANGE TITLE|yyyy-mm-dd-change-name/);
});

test("change create skips archived repositories and rejects inactive Spaces", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);

  const config = await readConfig(root);
  for (const repository of config.ideas.sample.repositories) repository.status = "archived";
  await writeConfig(root, config);

  const planningOnly = await createPlannedChange(root, "sample", "replacement-planning", {
    date: "2026-07-14",
  });
  assert.deepEqual(planningOnly.repositories, []);

  config.ideas.sample.status = "inactive";
  await writeConfig(root, config);
  await assert.rejects(
    () => createPlannedChange(root, "sample", "inactive-work", { date: "2026-07-15" }),
    (error) => error instanceof SddError && error.code === "SPACE_NOT_ACTIVE",
  );
});

test("change create dry-run reports the planned Change without writing files", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);

  const result = await createPlannedChange(root, "sample", "dry-run-example", {
    date: "2026-07-14",
    repositories: ["sample-web"],
    dryRun: true,
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.path, "ideas/sample/planned-changes/2026-07-14-dry-run-example");
  assert.equal(result.repositories[0].resolvedPath, "code/sample-web");
  assert.equal(await pathExists(join(root, result.path)), false);
});

test("CLI exposes change create with JSON output", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);

  const { stdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "change",
    "create",
    "sample",
    "cli-example",
    "--workspace",
    root,
    "--repo",
    "code/sample-web",
    "--date",
    "2026-07-14",
    "--json",
  ]);
  const result = JSON.parse(stdout);

  assert.equal(result.command, "change-create");
  assert.equal(result.path, "ideas/sample/planned-changes/2026-07-14-cli-example");
  assert.equal(result.repositories[0].resolvedPath, "code/sample-web");
});

test("change create refuses to guess among multiple mapped repositories", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);

  await assert.rejects(
    () => createPlannedChange(root, "sample", "ambiguous-target", { date: "2026-07-14" }),
    (error) =>
      error instanceof SddError &&
      error.code === "REPOSITORY_REQUIRED" &&
      error.details.includes("Available repository: code/sample-web") &&
      error.details.includes("Available repository: code/sample-mobile"),
  );
});

test("change create infers a sole repository and refuses an existing Change", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const config = await readConfig(root);
  config.ideas.sample.repositories = [config.ideas.sample.repositories[0]];
  await writeConfig(root, config);

  const first = await createPlannedChange(root, "sample", "single-target", {
    date: "2026-07-14",
  });
  assert.equal(first.repositories[0].resolvedPath, "code/sample-web");

  await assert.rejects(
    () => createPlannedChange(root, "sample", "single-target", { date: "2026-07-14" }),
    (error) => error instanceof SddError && error.code === "CHANGE_EXISTS",
  );
});

test("change create refuses IDs already active or closed in a selected repository", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeCanonicalChange(root, "sample-web", "2026-07-14-active-collision", "in_progress");
  await writeCanonicalChange(
    root,
    "sample-web",
    "2026-07-14-closed-collision",
    "in_review",
    { closed: true },
  );

  for (const slug of ["active-collision", "closed-collision"]) {
    await assert.rejects(
      () => createPlannedChange(root, "sample", slug, {
        date: "2026-07-14",
        repositories: ["sample-web"],
        dryRun: true,
      }),
      (error) => error instanceof SddError && error.code === "CHANGE_EXISTS",
    );
  }
});

test("change create rejects a planned directory through an external symlink", async (t) => {
  const root = await createMappedWorkspace();
  const external = await createWorkspace("sdd-cli-planning-external-");
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(external, { recursive: true, force: true }));
  await initWorkspace(root);
  await symlink(external, join(root, "ideas", "sample", "planned-changes"));

  await assert.rejects(
    () => createPlannedChange(root, "sample", "external-plan", {
      date: "2026-07-14",
      repositories: ["sample-web"],
    }),
    (error) => error instanceof SddError && error.code === "UNSAFE_ARTIFACT_PATH",
  );
  assert.deepEqual(await readdir(external), []);
});

test("change create rejects unsafe slugs and impossible dates before writing", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);

  await assert.rejects(
    () =>
      createPlannedChange(root, "sample", "../outside", {
        date: "2026-07-14",
        repositories: ["sample-web"],
      }),
    (error) => error instanceof SddError && error.code === "INVALID_CHANGE_SLUG",
  );
  await assert.rejects(
    () =>
      createPlannedChange(root, "sample", "invalid-date", {
        date: "2026-02-30",
        repositories: ["sample-web"],
      }),
    (error) => error instanceof SddError && error.code === "INVALID_CHANGE_DATE",
  );
  assert.equal(await pathExists(join(root, "ideas", "sample", "planned-changes")), false);
});

test("change promote moves a planned draft into a selected repository", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const created = await createPlannedChange(root, "sample", "mobile-notes-access", {
    date: "2026-07-14",
    repositories: ["code/sample-mobile"],
  });
  await setPlannedChangeStatus(root, created);
  await writeFile(
    join(root, created.path, "design.md"),
    `# Design\n\nDraft: \`${created.path}\`\n`,
    "utf8",
  );

  const result = await promotePlannedChange(root, "sample", created.changeId, {
    repositories: ["code/sample-mobile"],
  });

  assert.equal(result.command, "change-promote");
  assert.equal(result.sourcePath, created.path);
  assert.equal(result.sourceRemoved, true);
  assert.equal(result.repositories.length, 1);
  assert.equal(
    result.repositories[0].path,
    "code/sample-mobile/docs/changes/2026-07-14-mobile-notes-access",
  );
  assert.equal(await pathExists(join(root, created.path)), false);

  const promotedRoot = join(root, result.repositories[0].path);
  const proposal = await readFile(join(promotedRoot, "proposal.md"), "utf8");
  const design = await readFile(join(promotedRoot, "design.md"), "utf8");
  const tasks = await readFile(join(promotedRoot, "tasks.md"), "utf8");
  assert.match(proposal, /- This repository \(role: mobile\)\./);
  assert.match(proposal, /Planned location: promoted; private draft removed/);
  assert.match(proposal, /Active location: `docs\/changes\/2026-07-14-mobile-notes-access\/`/);
  assert.doesNotMatch(proposal, /code\/sample-mobile/);
  assert.match(design, /Draft: `docs\/changes\/2026-07-14-mobile-notes-access`/);
  assert.match(tasks, /^---\nstatus: planned\n---/);
  assert.match(tasks, /Expected dirty files: `docs\/changes\/2026-07-14-mobile-notes-access\/`/);
});

test("change promote supports coordinated multi-repository promotion", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const created = await createPlannedChange(root, "sample", "shared-contract", {
    date: "2026-07-14",
    repositories: ["sample-web", "sample-mobile"],
  });
  await setPlannedChangeStatus(root, created);

  const result = await promotePlannedChange(root, "sample", created.changeId, {
    repositories: ["sample-web", "sample-mobile"],
  });

  assert.equal(result.repositories.length, 2);
  assert.equal(await pathExists(join(root, created.path)), false);
  for (const repository of result.repositories) {
    const proposal = await readFile(join(root, repository.path, "proposal.md"), "utf8");
    assert.match(proposal, /Coordinated promotion: 2 repository Changes total\./);
    assert.match(proposal, new RegExp(`role: ${repository.role}`));
  }
});

test("change promote dry-run reports destinations without moving the draft", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const config = await readConfig(root);
  config.ideas.sample.repositories = [config.ideas.sample.repositories[0]];
  await writeConfig(root, config);
  const created = await createPlannedChange(root, "sample", "dry-run-promotion", {
    date: "2026-07-14",
  });
  await setPlannedChangeStatus(root, created);

  const result = await promotePlannedChange(root, "sample", created.changeId, { dryRun: true });

  assert.equal(result.dryRun, true);
  assert.equal(result.sourceRemoved, false);
  assert.equal(await pathExists(join(root, created.path)), true);
  assert.equal(await pathExists(join(root, result.repositories[0].path)), false);
});

test("change promote preflights every destination before modifying the draft", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const created = await createPlannedChange(root, "sample", "collision-check", {
    date: "2026-07-14",
    repositories: ["sample-web", "sample-mobile"],
  });
  await setPlannedChangeStatus(root, created);
  const collision = join(root, "code", "sample-mobile", "docs", "changes", created.changeId);
  await mkdir(collision, { recursive: true });

  await assert.rejects(
    () => promotePlannedChange(root, "sample", created.changeId, {
      repositories: ["sample-web", "sample-mobile"],
    }),
    (error) => error instanceof SddError && error.code === "CHANGE_EXISTS",
  );
  assert.equal(await pathExists(join(root, created.path)), true);
  assert.equal(
    await pathExists(join(root, "code", "sample-web", "docs", "changes", created.changeId)),
    false,
  );
});

test("change promote preserves a concurrent replacement of the planned draft", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const created = await createPlannedChange(root, "sample", "concurrent-promotion", {
    date: "2026-07-14",
    repositories: ["sample-web"],
  });
  await setPlannedChangeStatus(root, created, "planned");
  const latestTasks = "---\nstatus: planned\n---\n# Tasks: concurrent latest draft\n";

  await assert.rejects(
    () => promotePlannedChange(root, "sample", created.changeId, {
      repositories: ["sample-web"],
      beforeCommit: async ({ sourcePath }) => {
        await mkdir(sourcePath, { recursive: true });
        await writeFile(join(sourcePath, "tasks.md"), latestTasks, "utf8");
      },
    }),
    (error) => error instanceof SddError
      && error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes("original retained")),
  );
  assert.equal(await readFile(join(root, created.path, "tasks.md"), "utf8"), latestTasks);
  const plannedParent = dirname(join(root, created.path));
  assert.ok((await readdir(plannedParent)).some((entry) =>
    entry.startsWith(`.${created.changeId}.sdd-promoted-`)));
  assert.equal(
    await pathExists(join(root, "code", "sample-web", "docs", "changes", created.changeId)),
    false,
  );
});

test("change promote rejects symbolic links anywhere in the planned draft", async (t) => {
  const root = await createMappedWorkspace();
  const external = await createWorkspace("sdd-private-draft-content-");
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(external, { recursive: true, force: true }));
  await initWorkspace(root);
  const created = await createPlannedChange(root, "sample", "symlinked-draft", {
    date: "2026-07-14",
    repositories: ["sample-web"],
  });
  await setPlannedChangeStatus(root, created, "planned");
  const privateFile = join(external, "private.md");
  const designPath = join(root, created.path, "design.md");
  await writeFile(privateFile, "private external content\n");
  await rm(designPath);
  await symlink(privateFile, designPath);

  await assert.rejects(
    () => promotePlannedChange(root, "sample", created.changeId, {
      repositories: ["sample-web"],
    }),
    (error) => error instanceof SddError && error.code === "UNSAFE_ARTIFACT_PATH",
  );
  assert.equal(await readFile(privateFile, "utf8"), "private external content\n");
  assert.equal(
    await pathExists(join(root, "code", "sample-web", "docs", "changes", created.changeId)),
    false,
  );
});

test("change promote preserves a destination edited after commit when a later destination fails", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const created = await createPlannedChange(root, "sample", "post-commit-promotion-edit", {
    date: "2026-07-14",
    repositories: ["sample-web", "sample-mobile"],
  });
  await setPlannedChangeStatus(root, created, "planned");
  const firstDestination = join(root, "code", "sample-web", "docs", "changes", created.changeId);
  const secondDestination = join(root, "code", "sample-mobile", "docs", "changes", created.changeId);
  const latestTasks = "---\nstatus: planned\n---\n# Tasks: destination edited after promotion\n";

  await assert.rejects(
    () => promotePlannedChange(root, "sample", created.changeId, {
      repositories: ["sample-web", "sample-mobile"],
      beforeDestinationCommit: async ({ index }) => {
        if (index !== 1) return;
        await writeFile(join(firstDestination, "tasks.md"), latestTasks, "utf8");
        await mkdir(secondDestination, { recursive: true });
      },
    }),
    (error) => error instanceof SddError
      && error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes("newer content preserved")),
  );

  assert.equal(await readFile(join(firstDestination, "tasks.md"), "utf8"), latestTasks);
  assert.equal(await pathExists(join(root, created.path)), true);
});

test("change promote rejects a proposed draft until planning is complete", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const created = await createPlannedChange(root, "sample", "invalid-draft", {
    date: "2026-07-14",
    repositories: ["sample-web"],
  });
  await assert.rejects(
    () => promotePlannedChange(root, "sample", created.changeId, {
      repositories: ["sample-web"],
    }),
    (error) => error instanceof SddError && error.code === "CHANGE_NOT_PLANNED",
  );
  assert.equal(await pathExists(join(root, created.path)), true);
});

test("CLI exposes change promote with JSON output", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const created = await createPlannedChange(root, "sample", "cli-promotion", {
    date: "2026-07-14",
    repositories: ["sample-web"],
  });
  await setPlannedChangeStatus(root, created);

  const { stdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "change",
    "promote",
    "sample",
    created.changeId,
    "--workspace",
    root,
    "--repo",
    "sample-web",
    "--json",
  ]);
  const result = JSON.parse(stdout);

  assert.equal(result.command, "change-promote");
  assert.equal(result.sourceRemoved, true);
  assert.equal(result.repositories[0].resolvedPath, "code/sample-web");
});

test("change close moves an in-review Change without writing a closed status", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-14-ready-change";
  await writeChange(root, "sample-web", changeId, "in_review");

  const result = await closeChange(root, "sample", changeId, {
    repositories: ["sample-web"],
  });

  assert.equal(result.command, "change-close");
  assert.equal(result.dryRun, false);
  assert.equal(result.repositories.length, 1);
  assert.equal(
    result.repositories[0].sourcePath,
    `code/sample-web/docs/changes/${changeId}`,
  );
  assert.equal(
    result.repositories[0].path,
    `code/sample-web/docs/changes/closed/${changeId}`,
  );
  assert.equal(await pathExists(join(root, result.repositories[0].sourcePath)), false);
  assert.equal(await pathExists(join(root, result.repositories[0].path)), true);
  assert.match(
    await readFile(join(root, result.repositories[0].path, "tasks.md"), "utf8"),
    /^---\nstatus: in_review\n---/,
  );
});

test("change close dry-run validates without moving the Change", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-14-dry-close";
  await writeChange(root, "sample-web", changeId, "in_review");

  const result = await closeChange(root, "sample", changeId, {
    repositories: ["sample-web"],
    dryRun: true,
  });

  assert.equal(result.dryRun, true);
  assert.equal(
    await pathExists(join(root, "code", "sample-web", "docs", "changes", changeId)),
    true,
  );
  assert.equal(
    await pathExists(join(root, "code", "sample-web", "docs", "changes", "closed", changeId)),
    false,
  );
});

test("change close requires in_review status", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-14-still-reviewing";
  await writeChange(root, "sample-web", changeId, "in_progress");

  await assert.rejects(
    () => closeChange(root, "sample", changeId, { repositories: ["sample-web"] }),
    (error) =>
      error instanceof SddError &&
      error.code === "CHANGE_NOT_IN_REVIEW" &&
      error.details.includes("Current status: in_progress"),
  );
  assert.equal(
    await pathExists(join(root, "code", "sample-web", "docs", "changes", changeId)),
    true,
  );
});

test("change close preflights every destination before moving any Change", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-14-coordinated-close";
  await writeChange(root, "sample-web", changeId, "in_review");
  await writeChange(root, "sample-mobile", changeId, "in_review");
  await writeChange(root, "sample-mobile", changeId, "in_review", { closed: true });

  await assert.rejects(
    () =>
      closeChange(root, "sample", changeId, {
        repositories: ["sample-web", "sample-mobile"],
      }),
    (error) => error instanceof SddError && error.code === "CHANGE_ALREADY_CLOSED",
  );
  assert.equal(
    await pathExists(join(root, "code", "sample-web", "docs", "changes", changeId)),
    true,
  );
  assert.equal(
    await pathExists(join(root, "code", "sample-web", "docs", "changes", "closed", changeId)),
    false,
  );
});

test("change close rechecks status at commit time", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-14-close-status-race";
  await writeChange(root, "sample-web", changeId, "in_review");
  const tasksPath = join(root, "code", "sample-web", "docs", "changes", changeId, "tasks.md");
  const latestTasks = "---\nstatus: in_progress\n---\n# Tasks: reopened during close\n";

  await assert.rejects(
    () => closeChange(root, "sample", changeId, {
      repositories: ["sample-web"],
      beforeRepositoryCommit: () => writeFile(tasksPath, latestTasks, "utf8"),
    }),
    (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
  );
  assert.equal(await readFile(tasksPath, "utf8"), latestTasks);
});

test("change transition updates an active Change with compare-and-set semantics", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-15-design-revision";
  await writeChange(root, "sample-web", changeId, "in_review");

  const result = await transitionChange(root, "sample", changeId, {
    repositories: ["sample-web"],
    from: "in_review",
    to: "in_progress",
  });

  assert.equal(result.command, "change-transition");
  assert.equal(result.repositories[0].tasksPath, `code/sample-web/docs/changes/${changeId}/tasks.md`);
  assert.match(
    await readFile(join(root, result.repositories[0].tasksPath), "utf8"),
    /^status: in_progress$/m,
  );
});

test("change transition rejects an active Change through an external symlink ancestor", async (t) => {
  const root = await createMappedWorkspace();
  const external = await createWorkspace("sdd-cli-change-external-");
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(external, { recursive: true, force: true }));
  await initWorkspace(root);
  const repositoryDocs = join(root, "code", "sample-web", "docs");
  await mkdir(repositoryDocs, { recursive: true });
  await symlink(external, join(repositoryDocs, "changes"));
  const changeId = "2026-07-15-external-transition";
  await writeCanonicalChange(root, "sample-web", changeId, "in_progress");
  const tasksPath = join(external, changeId, "tasks.md");
  const before = await readFile(tasksPath, "utf8");

  await assert.rejects(
    () => transitionChange(root, "sample", changeId, {
      repositories: ["sample-web"],
      from: "in_progress",
      to: "in_review",
    }),
    (error) => error instanceof SddError && error.code === "UNSAFE_ARTIFACT_PATH",
  );
  assert.equal(await readFile(tasksPath, "utf8"), before);
});

test("change transition preserves a concurrent tasks edit", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-15-concurrent-transition";
  await writeCanonicalChange(root, "sample-web", changeId, "in_progress");
  const tasksPath = join(
    root,
    "code",
    "sample-web",
    "docs",
    "changes",
    changeId,
    "tasks.md",
  );
  const latestTasks = "---\nstatus: in_progress\n---\n# Tasks: concurrent latest edit\n";

  await assert.rejects(
    () => transitionChange(root, "sample", changeId, {
      repositories: ["sample-web"],
      from: "in_progress",
      to: "in_review",
      beforeCommit: () => writeFile(tasksPath, latestTasks, "utf8"),
    }),
    (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
  );
  assert.equal(await readFile(tasksPath, "utf8"), latestTasks);
});

test("change transition reports incomplete rollback with the affected path", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-15-recovery-report";
  await writeCanonicalChange(root, "sample-web", changeId, "in_progress");
  await writeCanonicalChange(root, "sample-mobile", changeId, "in_progress");

  await assert.rejects(
    () => transitionChange(root, "sample", changeId, {
      repositories: ["sample-web", "sample-mobile"],
      from: "in_progress",
      to: "in_review",
      beforeRepositoryCommit: async ({ index, transition, transitions }) => {
        if (index !== 1) return;
        await rm(transitions[0].backupPath, { force: true });
        await rm(transition.tasksAbsolutePath, { force: true });
      },
    }),
    (error) => error instanceof SddError
      && error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes("sample-web")),
  );
});

test("change transition preserves an edit made after an earlier repository commit", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-15-post-commit-transition-edit";
  await writeCanonicalChange(root, "sample-web", changeId, "in_progress");
  await writeCanonicalChange(root, "sample-mobile", changeId, "in_progress");
  const firstTasks = join(root, "code", "sample-web", "docs", "changes", changeId, "tasks.md");
  const latestTasks = "---\nstatus: in_progress\n---\n# Tasks: edited after first commit\n";

  await assert.rejects(
    () => transitionChange(root, "sample", changeId, {
      repositories: ["sample-web", "sample-mobile"],
      from: "in_progress",
      to: "in_review",
      beforeRepositoryCommit: async ({ index, transition }) => {
        if (index !== 1) return;
        await writeFile(firstTasks, latestTasks, "utf8");
        await rm(transition.tasksAbsolutePath, { force: true });
      },
    }),
    (error) => error instanceof SddError
      && error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes("newer content preserved")),
  );
  assert.equal(await readFile(firstTasks, "utf8"), latestTasks);
});

test("change transition dry-run reports without updating tasks", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-15-transition-preview";
  await writeChange(root, "sample-web", changeId, "in_review");

  const result = await transitionChange(root, "sample", changeId, {
    repositories: ["sample-web"],
    from: "in_review",
    to: "in_progress",
    dryRun: true,
  });

  assert.equal(result.dryRun, true);
  assert.match(
    await readFile(join(root, "code", "sample-web", "docs", "changes", changeId, "tasks.md"), "utf8"),
    /^status: in_review$/m,
  );
});

test("change transition rejects stale or invalid lifecycle requests", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-15-transition-guard";
  await writeChange(root, "sample-web", changeId, "in_progress");

  await assert.rejects(
    () => transitionChange(root, "sample", changeId, {
      repositories: ["sample-web"],
      from: "in_review",
      to: "in_progress",
    }),
    (error) => error instanceof SddError && error.code === "CHANGE_STATUS_MISMATCH",
  );
  await assert.rejects(
    () => transitionChange(root, "sample", changeId, {
      repositories: ["sample-web"],
      from: "in_progress",
      to: "planned",
    }),
    (error) => error instanceof SddError && error.code === "INVALID_CHANGE_TRANSITION",
  );
});

test("change transition preflights every selected repository before writing", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-15-coordinated-transition";
  await writeChange(root, "sample-web", changeId, "in_review");
  await writeChange(root, "sample-mobile", changeId, "in_progress");

  await assert.rejects(
    () => transitionChange(root, "sample", changeId, {
      repositories: ["sample-web", "sample-mobile"],
      from: "in_review",
      to: "in_progress",
    }),
    (error) => error instanceof SddError && error.code === "CHANGE_STATUS_MISMATCH",
  );
  assert.match(
    await readFile(join(root, "code", "sample-web", "docs", "changes", changeId, "tasks.md"), "utf8"),
    /^status: in_review$/m,
  );
});

test("CLI exposes change transition with JSON output", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-15-cli-transition";
  await writeChange(root, "sample-web", changeId, "in_review");

  const { stdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "change",
    "transition",
    "sample",
    changeId,
    "--workspace",
    root,
    "--repo",
    "sample-web",
    "--from",
    "in_review",
    "--to",
    "in_progress",
    "--json",
  ]);
  const result = JSON.parse(stdout);

  assert.equal(result.command, "change-transition");
  assert.equal(result.from, "in_review");
  assert.equal(result.to, "in_progress");
  assert.equal(result.repositories[0].resolvedPath, "code/sample-web");
});

test("CLI exposes change close with JSON output", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-14-cli-close";
  await writeChange(root, "sample-web", changeId, "in_review");

  const { stdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "change",
    "close",
    "sample",
    changeId,
    "--workspace",
    root,
    "--repo",
    "sample-web",
    "--json",
  ]);
  const result = JSON.parse(stdout);

  assert.equal(result.command, "change-close");
  assert.equal(result.repositories[0].resolvedPath, "code/sample-web");
  assert.equal(result.repositories[0].path, `code/sample-web/docs/changes/closed/${changeId}`);
});

test("CLI exposes change command-group help", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "change",
    "--help",
  ]);

  assert.match(stdout, /sdd change create/);
  assert.match(stdout, /sdd change promote/);
  assert.match(stdout, /sdd change transition/);
  assert.match(stdout, /sdd change close/);
});

test("CLI exposes epic command-group help", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "epic",
    "--help",
  ]);

  assert.match(stdout, /sdd epic create/);
  assert.match(stdout, /structurally validate a canonical Epic/i);
});

test("CLI exposes changed-from validation help", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "--help",
  ]);

  assert.match(stdout, /--changed-from <commit-ish>/);
});

test("validate accepts a canonical active Change", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-14-canonical-change";
  await writeCanonicalChange(root, "sample-web", changeId, "in_progress");

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    changeId,
  });

  assert.equal(result.command, "validate");
  assert.equal(result.valid, true);
  assert.equal(result.summary.changes, 1);
  assert.equal(result.summary.errors, 0);
  assert.deepEqual(result.findings, []);
});

test("change-scoped validation includes Epic paths declared by the Change", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-14-affected-epic";
  await writeCanonicalChange(root, "sample-web", changeId, "in_review");
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  const changePath = join(root, "code", "sample-web", "docs", "changes", changeId);
  const proposalPath = join(changePath, "proposal.md");
  await writeFile(
    proposalPath,
    `${await readFile(proposalPath, "utf8")}\n## Epic Actions\n\n### Existing Epic Directory Updates\n\n- Revise \`docs/epics/sample-e001-core/epic.md\`.\n`,
    "utf8",
  );
  await writeFile(
    epicPath,
    (await readFile(epicPath, "utf8")).replace("## Notes", "## Missing Notes"),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    changeId,
  });

  assert.equal(result.summary.changes, 1);
  assert.equal(result.summary.epics, 1);
  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "MISSING_EPIC_SECTION" && finding.artifactId === "SAMPLE-E001"));
});

test("change-scoped validation reports a declared Epic path that does not exist", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-14-missing-affected-epic";
  await writeCanonicalChange(root, "sample-web", changeId, "in_review");
  const proposalPath = join(
    root,
    "code",
    "sample-web",
    "docs",
    "changes",
    changeId,
    "proposal.md",
  );
  await writeFile(
    proposalPath,
    `${await readFile(proposalPath, "utf8")}\n## Epic Actions\n\n### New Epic Directories\n\n- Create \`docs/epics/sample-e002-missing/epic.md\`.\n`,
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    changeId,
  });

  assert.equal(result.summary.epics, 0);
  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "AFFECTED_EPIC_NOT_FOUND"
    && finding.path.endsWith("docs/epics/sample-e002-missing/epic.md")));
});

test("validate accepts the documented lightweight interactive Change shape", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-14-interactive-shape";
  const changePath = join(root, "code", "sample-web", "docs", "changes", changeId);
  await mkdir(changePath, { recursive: true });
  await writeFile(
    join(changePath, "proposal.md"),
    [
      "# Proposal: Interactive Shape",
      "## Why",
      "## Interactive Scope Boundary",
      "## Epic / Story Impact",
      "## Release Communication Impact",
      "## Open Questions",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(changePath, "design.md"),
    [
      "# Design: Interactive Shape",
      "## Current Understanding",
      "## Technical Approach",
      "## Affected Epic Truth",
      "## Alternatives / Deferred",
      "## Open Questions",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(changePath, "tasks.md"),
    [
      "---",
      "status: in_progress",
      "---",
      "# Tasks: Interactive Shape",
      "## Resume Here",
      "## Interactive Log",
      "## Checklist",
      "## Implementation Ledger",
      "## Verification Ledger",
      "## Manual UI Confirmation",
      "## Artifact Updates",
      "## Open Questions",
      "## Closeout",
    ].join("\n"),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    changeId,
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.findings, []);
});

test("validate warns instead of failing on historical closed-Change section drift", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-14-historical-shape";
  await writeCanonicalChange(root, "sample-web", changeId, "ready_to_close", { closed: true });
  const proposalPath = join(
    root,
    "code",
    "sample-web",
    "docs",
    "changes",
    "closed",
    changeId,
    "proposal.md",
  );
  await writeFile(
    proposalPath,
    (await readFile(proposalPath, "utf8")).replace("## Open Questions", "## Historical Questions"),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    changeId,
  });

  assert.equal(result.valid, true);
  assert.ok(result.findings.some((finding) =>
    finding.level === "warning" && finding.code === "MISSING_ARTIFACT_SECTION"));
});

test("validate reports malformed Change directory IDs", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeCanonicalChange(root, "sample-web", "invalid-change-id", "in_progress");

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    changeId: "invalid-change-id",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) => finding.code === "INVALID_CHANGE_ID"));
});

test("validate discovers a private planned Change", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const created = await createPlannedChange(root, "sample", "planned-validation", {
    date: "2026-07-14",
    repositories: ["sample-web"],
  });

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    changeId: created.changeId,
  });

  assert.equal(result.valid, true);
  assert.equal(result.summary.plannedChanges, 1);
  assert.equal(result.summary.changes, 0);
  assert.ok(!result.findings.some((finding) => finding.code === "ARTIFACT_NOT_FOUND"));
});

test("validate ignores undated Change Brief files", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const plannedRoot = join(root, "ideas", "sample", "planned-changes");
  await mkdir(plannedRoot, { recursive: true });
  await writeFile(
    join(plannedRoot, "future-outcome.md"),
    "---\ntype: change-brief\ncreated: 2026-07-14\nmodified: 2026-07-14\n---\n# Change Brief: Future Outcome\n",
    "utf8",
  );

  const result = await validateArtifacts(root, { spaceId: "sample" });

  assert.equal(result.valid, true);
  assert.equal(result.summary.plannedChanges, 0);
});

test("validate reports an active and closed Change collision", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-14-location-collision";
  await writeCanonicalChange(root, "sample-web", changeId, "in_review");
  await writeCanonicalChange(root, "sample-web", changeId, "in_review", { closed: true });

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    changeId,
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "CHANGE_LOCATION_COLLISION" && finding.artifactId === changeId));
});

test("validate accepts a canonical Epic by ID", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeCanonicalEpic(root, "sample-web");

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, true);
  assert.equal(result.summary.epics, 1);
  assert.deepEqual(result.findings, []);
});

test("validate accepts a coherent current Epic verification report", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeCanonicalEpic(root, "sample-web");
  await writeEpicVerificationReport(root, "sample-web", {
    initialResult: "needs artifact fix",
    result: "aligned",
    gateResult: "pass",
  });

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, true);
  assert.equal(result.summary.epicVerificationReports, 1);
  assert.deepEqual(result.findings, []);
});

test("validate rejects an aligned Epic verification report with current findings", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeCanonicalEpic(root, "sample-web");
  await writeEpicVerificationReport(root, "sample-web", {
    initialResult: "needs artifact fix",
    result: "aligned",
    gateResult: "findings",
  });

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "EPIC_VERIFY_RESULT_CONTRADICTION"
    && finding.message.includes("Current Gate Scorecard")));
});

test("validate rejects an aligned Epic verification report with incomplete gate coverage", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeCanonicalEpic(root, "sample-web");
  await writeEpicVerificationReport(root, "sample-web", {
    omitGate: "Security and data safety",
  });

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "EPIC_VERIFY_RESULT_CONTRADICTION"));
});

test("validate rejects Epic verification Verdict metadata drift", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeCanonicalEpic(root, "sample-web");
  await writeEpicVerificationReport(root, "sample-web", {
    initialResult: "needs artifact fix",
    result: "aligned",
    verdictInitialResult: "blocked",
    verdictAuditedRef: "c".repeat(40),
    verdictVerifiedRef: "d".repeat(40),
  });

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "EPIC_VERIFY_VERDICT_MISMATCH"));
});

test("validate rejects mutable Epic verification refs", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeCanonicalEpic(root, "sample-web");
  await writeEpicVerificationReport(root, "sample-web", {
    auditedRef: "HEAD",
    verifiedRef: "develop",
  });

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "INVALID_EPIC_VERIFY_REPORT_METADATA"));
});

test("validate rejects an aligned Epic verification report without its audited baseline check", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeCanonicalEpic(root, "sample-web");
  await writeEpicVerificationReport(root, "sample-web", {
    includeChangedFrom: false,
  });

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "EPIC_VERIFY_RESULT_CONTRADICTION"));
});

test("validate rejects aligned proof scoped to another Epic", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeCanonicalEpic(root, "sample-web");
  await writeEpicVerificationReport(root, "sample-web", {
    evidenceEpicId: "SAMPLE-E002",
  });

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "EPIC_VERIFY_RESULT_CONTRADICTION"));
});

test("validate rejects aligned proof scoped to another repository", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeCanonicalEpic(root, "sample-web");
  await writeEpicVerificationReport(root, "sample-web", {
    evidenceRepository: "code/sample-web-copy",
  });

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "EPIC_VERIFY_RESULT_CONTRADICTION"));
});

test("validate rejects orphan-audit proof scoped to another repository", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeCanonicalEpic(root, "sample-web");
  await writeEpicVerificationReport(root, "sample-web", {
    evidenceAuditRoot: "code/sample-web-copy",
  });

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "EPIC_VERIFY_RESULT_CONTRADICTION"));
});

test("validate accepts quoted repository paths in aligned proof", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeCanonicalEpic(root, "sample-web");
  await writeEpicVerificationReport(root, "sample-web", {
    evidenceRepository: '"code/sample-web"',
  });

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, true);
});

test("validate rejects duplicate governing options in aligned report proof", async (t) => {
  const cases = [
    ["--epic SAMPLE-E001", "--epic SAMPLE-E001 --epic SAMPLE-E002"],
    ["--repo code/sample-web", "--repo code/sample-web --repo code/sample-web-copy"],
    ["--changed-from aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "--changed-from aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --changed-from cccccccccccccccccccccccccccccccccccccccc"],
    ["python3 sdd_orphan_audit.py code/sample-web --epic SAMPLE-E001 --format json", "python3 sdd_orphan_audit.py code/sample-web --epic SAMPLE-E001 --epic SAMPLE-E002 --format json"],
  ];

  for (const [expectedOption, duplicateOption] of cases) {
    const root = await createMappedWorkspace();
    t.after(() => rm(root, { recursive: true, force: true }));
    await initWorkspace(root);
    await writeCanonicalEpic(root, "sample-web");
    const report = await writeEpicVerificationReport(root, "sample-web");
    await writeFile(
      report,
      (await readFile(report, "utf8")).replace(expectedOption, duplicateOption),
      "utf8",
    );

    const result = await validateArtifacts(root, {
      spaceId: "sample",
      repositories: ["sample-web"],
      epicId: "SAMPLE-E001",
    });

    assert.equal(result.valid, false, `duplicate ${expectedOption} must not certify aligned proof`);
    assert.ok(result.findings.some((finding) =>
      finding.code === "EPIC_VERIFY_RESULT_CONTRADICTION"));
  }
});

test("validate rejects malformed versioned Epic verification report frontmatter", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeCanonicalEpic(root, "sample-web");
  const reportPath = await writeEpicVerificationReport(root, "sample-web");
  await writeFile(
    reportPath,
    (await readFile(reportPath, "utf8")).replace(
      "kind: sdd-epic-verify-report",
      "kind: [invalid",
    ),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "INVALID_EPIC_VERIFY_REPORT_FRONTMATTER"));
});

test("validate rejects a recognized Epic verification report without a schema", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeCanonicalEpic(root, "sample-web");
  const reportPath = await writeEpicVerificationReport(root, "sample-web");
  await writeFile(
    reportPath,
    (await readFile(reportPath, "utf8")).replace(
      "schema: sdd-epic-verify-report-v1\n",
      "",
    ),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.equal(result.summary.epicVerificationReports, 1);
  assert.ok(result.findings.some((finding) =>
    finding.code === "MISSING_EPIC_VERIFY_REPORT_SCHEMA"));
});

test("validate rejects spoofed report check commands", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeCanonicalEpic(root, "sample-web");
  const report = await writeEpicVerificationReport(root, "sample-web");
  await writeFile(report, (await readFile(report, "utf8"))
    .replace("`sdd validate sample", "`echo sdd validate sample"), "utf8");
  const result = await validateArtifacts(root, { spaceId: "sample", repositories: ["sample-web"], epicId: "SAMPLE-E001" });
  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) => finding.code === "EPIC_VERIFY_RESULT_CONTRADICTION"));
});

test("validate rejects incoherent non-aligned Epic verification reports", async (t) => {
  const cases = [
    {
      result: "changes-requested",
      gateResult: "findings",
      mutate(source) {
        return source
          .replace("### BLOCKING", "### UNSCOPED")
          .replace("### REQUIRED", "### OTHER")
          .replace("| pass | Current artifact shape.", "| invented | Current artifact shape.");
      },
    },
    {
      result: "blocked",
      gateResult: "blocked",
      mutate(source) {
        return source.replace("### BLOCKING\n\n- None.", "### BLOCKING\n\n- None.\n\n### REQUIRED\n\n- Current report finding.");
      },
    },
  ];

  for (const { result: reportResult, gateResult, mutate } of cases) {
    const root = await createMappedWorkspace();
    t.after(() => rm(root, { recursive: true, force: true }));
    await initWorkspace(root);
    await writeCanonicalEpic(root, "sample-web");
    const report = await writeEpicVerificationReport(root, "sample-web", {
      result: reportResult,
      gateResult,
    });
    await writeFile(report, mutate(await readFile(report, "utf8")), "utf8");
    const result = await validateArtifacts(root, { spaceId: "sample", repositories: ["sample-web"], epicId: "SAMPLE-E001" });
    assert.equal(result.valid, false, `${reportResult} requires coherent current findings and checks`);
    assert.ok(result.findings.some((finding) => finding.code === "EPIC_VERIFY_RESULT_CONTRADICTION"));
  }
});

test("validate fails closed on malformed raw report identity", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeCanonicalEpic(root, "sample-web");
  const report = await writeEpicVerificationReport(root, "sample-web");
  await writeFile(report, (await readFile(report, "utf8"))
    .replace("schema: sdd-epic-verify-report-v1\n", "")
    .replace("kind: sdd-epic-verify-report", "kind: [sdd-epic-verify-report"), "utf8");
  const result = await validateArtifacts(root, { spaceId: "sample", repositories: ["sample-web"], epicId: "SAMPLE-E001" });
  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) => finding.code === "INVALID_EPIC_VERIFY_REPORT_FRONTMATTER"));
});

test("validate rejects an external Epic verification reviews directory", async (t) => {
  const root = await createMappedWorkspace();
  const external = await mkdtemp(join(tmpdir(), "sdd-report-reviews-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(external, { recursive: true, force: true }));
  await initWorkspace(root);
  const epic = await writeCanonicalEpic(root, "sample-web");
  await symlink(external, join(dirname(epic), "reviews"));
  const result = await validateArtifacts(root, { spaceId: "sample", repositories: ["sample-web"], epicId: "SAMPLE-E001" });
  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) => finding.code === "UNSAFE_EPIC_VERIFY_REPORT_PATH"));
});

test("validate rejects a symlinked Epic verification report file", async (t) => {
  const root = await createMappedWorkspace();
  const external = await mkdtemp(join(tmpdir(), "sdd-report-file-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(external, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeCanonicalEpic(root, "sample-web");
  const report = await writeEpicVerificationReport(root, "sample-web");
  const externalReport = join(external, "external-epic-verify.md");
  await writeFile(externalReport, await readFile(report, "utf8"), "utf8");
  await rm(report);
  await symlink(externalReport, report);

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.equal(result.summary.epicVerificationReports, 1);
  assert.ok(result.findings.some((finding) => finding.code === "UNSAFE_EPIC_VERIFY_REPORT_PATH"));
});

test("validate reports typed Epic verification paths without crashing", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeCanonicalEpic(root, "sample-web");
  const report = await writeEpicVerificationReport(root, "sample-web");
  await writeFile(report, (await readFile(report, "utf8"))
    .replace("epic_path: docs/epics/sample-e001-core/epic.md", "epic_path: [typed]"), "utf8");
  const result = await validateArtifacts(root, { spaceId: "sample", repositories: ["sample-web"], epicId: "SAMPLE-E001" });
  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) => finding.code === "INVALID_EPIC_VERIFY_REPORT_IDENTITY"));
});

test("validate rejects a missing superseded Epic verification report", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeCanonicalEpic(root, "sample-web");
  await writeEpicVerificationReport(root, "sample-web", {
    supersedes: "docs/epics/sample-e001-core/reviews/missing-epic-verify.md",
  });

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "BROKEN_EPIC_VERIFY_SUPERSEDES"));
});

test("validate accepts one explicit Epic verification report successor", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeCanonicalEpic(root, "sample-web");
  await writeEpicVerificationReport(root, "sample-web", {
    fileName: "2026-07-22-1200-epic-verify.md",
    initialResult: "needs artifact fix",
    result: "needs artifact fix",
    gateResult: "findings",
  });
  await writeEpicVerificationReport(root, "sample-web", {
    fileName: "2026-07-22-1300-epic-verify.md",
    initialResult: "needs artifact fix",
    result: "aligned",
    supersedes: "docs/epics/sample-e001-core/reviews/2026-07-22-1200-epic-verify.md",
  });

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, true);
  assert.equal(result.summary.epicVerificationReports, 2);
});

test("validate rejects successor result discontinuity", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeCanonicalEpic(root, "sample-web");
  await writeEpicVerificationReport(root, "sample-web", {
    fileName: "2026-07-22-1200-epic-verify.md",
    initialResult: "needs artifact fix",
    result: "needs artifact fix",
    gateResult: "findings",
  });
  await writeEpicVerificationReport(root, "sample-web", {
    fileName: "2026-07-22-1300-epic-verify.md",
    initialResult: "blocked",
    result: "aligned",
    supersedes: "docs/epics/sample-e001-core/reviews/2026-07-22-1200-epic-verify.md",
  });
  const result = await validateArtifacts(root, { spaceId: "sample", repositories: ["sample-web"], epicId: "SAMPLE-E001" });
  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) => finding.code === "EPIC_VERIFY_LINEAGE_RESULT_MISMATCH"));
});

test("validate rejects an absolute Epic verification report predecessor", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeCanonicalEpic(root, "sample-web");
  const predecessor = await writeEpicVerificationReport(root, "sample-web", {
    fileName: "2026-07-22-1200-epic-verify.md",
  });
  await writeEpicVerificationReport(root, "sample-web", {
    fileName: "2026-07-22-1300-epic-verify.md",
    supersedes: predecessor,
  });

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "BROKEN_EPIC_VERIFY_SUPERSEDES"));
});

test("validate rejects a self-referential Epic verification report predecessor", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeCanonicalEpic(root, "sample-web");
  const fileName = "2026-07-22-1200-epic-verify.md";
  await writeEpicVerificationReport(root, "sample-web", {
    fileName,
    supersedes: `docs/epics/sample-e001-core/reviews/${fileName}`,
  });

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "BROKEN_EPIC_VERIFY_SUPERSEDES"));
});

test("validate rejects a non-versioned Epic verification report predecessor", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeCanonicalEpic(root, "sample-web");
  const reviewsPath = join(
    root,
    "code",
    "sample-web",
    "docs",
    "epics",
    "sample-e001-core",
    "reviews",
  );
  await mkdir(reviewsPath, { recursive: true });
  await writeFile(join(reviewsPath, "notes.md"), "# Review notes\n", "utf8");
  await writeEpicVerificationReport(root, "sample-web", {
    fileName: "2026-07-22-1300-epic-verify.md",
    supersedes: "docs/epics/sample-e001-core/reviews/notes.md",
  });

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "BROKEN_EPIC_VERIFY_SUPERSEDES"));
});

test("validate rejects ambiguous Epic verification report tips", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeCanonicalEpic(root, "sample-web");
  await writeEpicVerificationReport(root, "sample-web", {
    fileName: "2026-07-22-1200-epic-verify.md",
  });
  await writeEpicVerificationReport(root, "sample-web", {
    fileName: "2026-07-22-1300-epic-verify.md",
  });

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "AMBIGUOUS_EPIC_VERIFY_TIP"));
});

test("validate changed-from rejects substantive Epic edits with stale modified metadata", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const repositoryRoot = join(root, "code", "sample-web");
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  await execFileAsync("git", ["init", "-b", "develop", repositoryRoot]);
  await execFileAsync("git", ["-C", repositoryRoot, "add", "."]);
  await execFileAsync("git", [
    "-C",
    repositoryRoot,
    "-c",
    "user.name=SDD Test",
    "-c",
    "user.email=sdd@example.invalid",
    "commit",
    "-m",
    "baseline",
  ]);
  await writeFile(
    epicPath,
    (await readFile(epicPath, "utf8")).replace("- Core behavior.", "- Core behavior with recovery."),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
    changedFrom: "HEAD",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "STALE_EPIC_MODIFIED_DATE"));
});

test("validate changed-from accepts verification-only metadata changes", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const repositoryRoot = join(root, "code", "sample-web");
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  await execFileAsync("git", ["init", "-b", "develop", repositoryRoot]);
  await execFileAsync("git", ["-C", repositoryRoot, "add", "."]);
  await execFileAsync("git", [
    "-C",
    repositoryRoot,
    "-c",
    "user.name=SDD Test",
    "-c",
    "user.email=sdd@example.invalid",
    "commit",
    "-m",
    "baseline",
  ]);
  await writeFile(
    epicPath,
    (await readFile(epicPath, "utf8")).replace(
      "last_verified: 2026-07-14",
      "last_verified: 2026-07-22",
    ),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
    changedFrom: "HEAD",
  });

  assert.equal(result.valid, true);
  assert.ok(!result.findings.some((finding) =>
    finding.code === "STALE_EPIC_MODIFIED_DATE"));
});

test("validate changed-from accepts a second substantive Epic edit on the same day", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const repositoryRoot = join(root, "code", "sample-web");
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  const now = new Date();
  const today = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
  await writeFile(
    epicPath,
    (await readFile(epicPath, "utf8")).replace(
      "modified: 2026-07-14",
      `modified: ${today}`,
    ),
    "utf8",
  );
  await execFileAsync("git", ["init", "-b", "develop", repositoryRoot]);
  await execFileAsync("git", ["-C", repositoryRoot, "add", "."]);
  await execFileAsync("git", [
    "-C",
    repositoryRoot,
    "-c",
    "user.name=SDD Test",
    "-c",
    "user.email=sdd@example.invalid",
    "commit",
    "-m",
    "baseline",
  ]);
  await writeFile(
    epicPath,
    (await readFile(epicPath, "utf8")).replace("- Core behavior.", "- Core behavior with same-day recovery."),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
    changedFrom: "HEAD",
  });

  assert.equal(result.valid, true);
  assert.ok(!result.findings.some((finding) =>
    finding.code === "STALE_EPIC_MODIFIED_DATE"));
});

test("validate changed-from reports an invalid Git baseline as a finding", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const repositoryRoot = join(root, "code", "sample-web");
  await writeCanonicalEpic(root, "sample-web");
  await execFileAsync("git", ["init", "-b", "develop", repositoryRoot]);

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
    changedFrom: "missing-baseline",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "CHANGED_FROM_REF_NOT_FOUND"));
});

test("validate rejects an empty v2 Story declaration when a promoted Story exists", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  const source = await readFile(epicPath, "utf8");
  await writeFile(epicPath, source.replace("stories:\n  - S1", "stories: []"), "utf8");

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) => finding.code === "EPIC_STORY_INDEX_DRIFT"));
});

test("validate rejects a v2 Story without Requirements", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  const source = await readFile(epicPath, "utf8");
  await writeFile(
    epicPath,
    source.replace("##### Requirement R1: Complete The Journey", "##### Background: Complete The Journey"),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.ok(result.findings.some((finding) => finding.code === "MISSING_STORY_REQUIREMENTS"));
});

test("validate rejects a v2 Requirement without Scenarios", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  const source = await readFile(epicPath, "utf8");
  await writeFile(
    epicPath,
    source.replace("###### Scenario R1-S1: Successful Completion", "###### Example: Successful Completion"),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.ok(result.findings.some((finding) => finding.code === "MISSING_REQUIREMENT_SCENARIOS"));
});

test("validate rejects fabricated implementation anchors", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  const source = await readFile(epicPath, "utf8");
  await writeFile(epicPath, source.replace("#runCoreJourney", "#fabricatedSymbol"), "utf8");

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.ok(result.findings.some((finding) =>
    finding.code === "MISSING_IMPLEMENTATION_ANCHOR"
    && finding.message.includes("fabricatedSymbol")));
});

test("validate rejects implementation and test evidence that resolve outside the repository", async (t) => {
  const root = await createMappedWorkspace();
  const external = await createWorkspace("sdd-cli-evidence-external-");
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(external, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  const implementationPath = join(root, "code", "sample-web", "src", "core.js");
  const testPath = join(root, "code", "sample-web", "test", "core.test.js");
  await rm(implementationPath);
  await rm(testPath);
  await writeFile(join(external, "core.js"), "export function runCoreJourney() {}\n", "utf8");
  await writeFile(
    join(external, "core.test.js"),
    "test(\"core journey completes successfully\", () => {});\n",
    "utf8",
  );
  await symlink(join(external, "core.js"), implementationPath);
  await symlink(join(external, "core.test.js"), testPath);

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.ok(result.findings.some((finding) =>
    finding.code === "IMPLEMENTATION_PATH_OUTSIDE_REPOSITORY"));
  assert.ok(result.findings.some((finding) =>
    finding.code === "EVIDENCE_PATH_OUTSIDE_REPOSITORY"));
});

test("focused Epic validation does not open unrelated Epic artifacts", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeCanonicalEpic(root, "sample-web");
  await mkdir(
    join(root, "code", "sample-web", "docs", "epics", "unrelated-e001-broken", "epic.md"),
    { recursive: true },
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, true);
  assert.equal(result.summary.epics, 1);
});

test("validate reports duplicate Epic IDs within a repository", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const firstPath = await writeCanonicalEpic(root, "sample-web");
  const secondRoot = join(root, "code", "sample-web", "docs", "epics", "sample-e002-other");
  await mkdir(secondRoot, { recursive: true });
  await writeFile(join(secondRoot, "epic.md"), await readFile(firstPath, "utf8"), "utf8");

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) => finding.code === "DUPLICATE_EPIC_ID"));
});

test("validate reports Story Index drift within an Epic", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  const source = await readFile(epicPath, "utf8");
  await writeFile(epicPath, source.replace("| S1 | implemented |", "| S9 | implemented |"), "utf8");

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "EPIC_STORY_INDEX_DRIFT"
    && finding.message.includes("Story Index")));
});

test("validate rejects duplicate Story declarations that mask a missing Story", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  const source = await readFile(epicPath, "utf8");
  const storyBlock = source.match(/### Story S1:[\s\S]*?(?=\n## Cross-Story Concerns)/)[0];
  const secondStory = storyBlock.replaceAll("S1", "S2");
  await writeFile(
    epicPath,
    source
      .replace("stories:\n  - S1", "stories:\n  - S1\n  - S1")
      .replace(
        "| S1 | implemented | verified | Core behavior. | 2026-07-14 | |",
        "| S1 | implemented | verified | Core behavior. | 2026-07-14 | |\n| S2 | implemented | verified | Core behavior. | 2026-07-14 | |",
      )
      .replace("\n## Cross-Story Concerns", `\n${secondStory}\n## Cross-Story Concerns`),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.ok(result.findings.some((finding) =>
    finding.code === "EPIC_STORY_INDEX_DRIFT"
    && finding.message.includes("Frontmatter")));
});

test("validate rejects duplicate Story Index rows that mask a missing Story", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  const source = await readFile(epicPath, "utf8");
  const storyBlock = source.match(/### Story S1:[\s\S]*?(?=\n## Cross-Story Concerns)/)[0];
  const secondStory = storyBlock.replaceAll("S1", "S2");
  await writeFile(
    epicPath,
    source
      .replace("stories:\n  - S1", "stories:\n  - S1\n  - S2")
      .replace(
        "| S1 | implemented | verified | Core behavior. | 2026-07-14 | |",
        "| S1 | implemented | verified | Core behavior. | 2026-07-14 | |\n| S1 | implemented | verified | Core behavior. | 2026-07-14 | |",
      )
      .replace("\n## Cross-Story Concerns", `\n${secondStory}\n## Cross-Story Concerns`),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.ok(result.findings.some((finding) =>
    finding.code === "EPIC_STORY_INDEX_DRIFT"
    && finding.message.includes("Story Index rows")));
});

test("validate reports Story Index implementation and verification drift", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  const source = await readFile(epicPath, "utf8");
  await writeFile(
    epicPath,
    source.replace("| S1 | implemented | verified |", "| S1 | partial | verified |"),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "EPIC_STORY_INDEX_DRIFT"
    && finding.message.includes("does not match its Story body")));
});

test("validate requires concrete Implemented By paths for v2 Epics", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  const source = await readFile(epicPath, "utf8");
  await writeFile(
    epicPath,
    source.replace("src/core.js#runCoreJourney", "src/missing.js#runCoreJourney"),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "MISSING_IMPLEMENTATION_PATH"
    && finding.message.includes("src/missing.js")));
});

test("validate requires implementation ownership or an explicit gap", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  const source = await readFile(epicPath, "utf8");
  await writeFile(
    epicPath,
    source.replace(
      "| S1/R1 | `src/core.js#runCoreJourney` | primary | Owns the core journey behavior. |",
      "",
    ),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "MISSING_IMPLEMENTATION_COVERAGE"
    && finding.message.includes("S1/R1")));
});

test("validate requires a primary implementation owner for implemented Requirements", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  const source = await readFile(epicPath, "utf8");
  await writeFile(
    epicPath,
    source.replace("| primary | Owns the core journey behavior. |", "| support | Supports the core journey behavior. |"),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "MISSING_PRIMARY_IMPLEMENTATION"
    && finding.message.includes("S1/R1")));
});

test("validate rejects implemented Story state when implementation gaps remain", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  const source = await readFile(epicPath, "utf8");
  await writeFile(
    epicPath,
    source.replace("#### Implementation Gaps\n\n- None.", "#### Implementation Gaps\n\n- `S1/R1`: Not implemented yet."),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "STORY_IMPLEMENTATION_STATE_CONTRADICTION"
    && finding.message.includes("imply partial")));
});

test("validate requires verification evidence or a gap for every v2 Scenario", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  const source = await readFile(epicPath, "utf8");
  await writeFile(
    epicPath,
    source.replace(
      "| S1/R1-S1 | Automated test `test/core.test.js#core journey completes successfully` | Successful completion. | Passing 2026-07-14 |",
      "",
    ),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "MISSING_VERIFICATION_COVERAGE"
    && finding.message.includes("S1/R1-S1")));
});

test("validate does not count incomplete Verified By rows as coverage", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  const source = await readFile(epicPath, "utf8");
  await writeFile(
    epicPath,
    source.replace(
      "| S1/R1-S1 | Automated test `test/core.test.js#core journey completes successfully` | Successful completion. | Passing 2026-07-14 |",
      "| S1/R1-S1 |  |  |  |",
    ),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.ok(result.findings.some((finding) => finding.code === "INCOMPLETE_VERIFIED_BY_ROW"));
  assert.ok(result.findings.some((finding) => finding.code === "MISSING_VERIFICATION_COVERAGE"));
});

test("validate preserves legacy Epic compatibility as a warning", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  const source = await readFile(epicPath, "utf8");
  await writeFile(
    epicPath,
    source
      .replace("schema: sdd-epic-v2\n", "")
      .replace(
        "| Story | Implementation | Verification | Capability | Last Verified | Notes |\n|---|---|---|---|---|---|\n| S1 | implemented | verified | Core behavior. | 2026-07-14 | |",
        "| Story | Status | Capability | Last Verified | Notes |\n|---|---|---|---|---|\n| S1 | active | Core behavior. | 2026-07-14 | |",
      )
      .replace("Implementation: implemented\nVerification: verified", "Status: active")
      .replace(
        "| Requirement / Scenario | Location / Anchor | Kind | Responsibility |\n|---|---|---|---|\n| S1/R1 | `src/core.js#runCoreJourney` | primary | Owns the core journey behavior. |",
        "| Path | Role | Recheck Trigger |\n|---|---|---|\n| `src/core.js` | Primary | Recheck when the journey changes. |",
      ),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, true);
  assert.ok(result.findings.some((finding) =>
    finding.level === "warning" && finding.code === "LEGACY_EPIC_SCHEMA"));
});

test("validate reports malformed Requirement IDs in an Epic", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  const source = await readFile(epicPath, "utf8");
  await writeFile(
    epicPath,
    source.replace("##### Requirement R1:", "##### Requirement requirement-one:"),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) => finding.code === "INVALID_REQUIREMENT_ID"));
});

test("validate reports a broken Verified By reference", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  const source = await readFile(epicPath, "utf8");
  await writeFile(epicPath, source.replace("S1/R1-S1 |", "S1/R9-S1 |"), "utf8");

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "BROKEN_EVIDENCE_REFERENCE"
    && finding.message.includes("S1/R9-S1")));
});

test("validate does not credit a mixed valid and broken Verified By reference", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  const source = await readFile(epicPath, "utf8");
  await writeFile(
    epicPath,
    source.replace("| S1/R1-S1 | Automated test", "| S1/R1-S1, S1/R9-S1 | Automated test"),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.ok(result.findings.some((finding) => finding.code === "BROKEN_EVIDENCE_REFERENCE"));
  assert.ok(result.findings.some((finding) => finding.code === "MISSING_VERIFICATION_COVERAGE"));
});

test("validate rejects v2 automated Verified By evidence without a concrete test path", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  await mkdir(join(root, "code", "sample-web", "test"), { recursive: true });
  await writeFile(join(root, "code", "sample-web", "test", "core.test.js"), "", "utf8");
  const preciseResult = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });
  assert.equal(
    preciseResult.findings.some((finding) => finding.code === "GENERIC_AUTOMATED_EVIDENCE"),
    false,
  );
  const source = await readFile(epicPath, "utf8");
  await writeFile(
    epicPath,
    source.replace("Automated test `test/core.test.js#core journey completes successfully`", "Backend unit tests"),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.level === "error"
    && finding.code === "GENERIC_AUTOMATED_EVIDENCE"
    && finding.message.includes("repository-relative test path")));
});

test("validate rejects a missing v2 Verified By automated test path", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  const source = await readFile(epicPath, "utf8");
  await writeFile(
    epicPath,
    source.replace("`test/core.test.js#core journey completes successfully`", "`test/missing.test.js#missing test`"),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.level === "error"
    && finding.code === "MISSING_AUTOMATED_EVIDENCE_PATH"
    && finding.message.includes("test/missing.test.js")));
});

test("validate rejects a missing v2 Verified By automated test anchor", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  const source = await readFile(epicPath, "utf8");
  await writeFile(
    epicPath,
    source.replace("#core journey completes successfully", "#fabricated test title"),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.ok(result.findings.some((finding) =>
    finding.code === "MISSING_AUTOMATED_EVIDENCE_ANCHOR"
    && finding.message.includes("fabricated test title")));
});

test("validate rejects generic framework syntax as a v2 automated evidence anchor", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  const source = await readFile(epicPath, "utf8");
  await writeFile(
    epicPath,
    source.replace("#core journey completes successfully", "#test("),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.level === "error"
    && finding.code === "GENERIC_AUTOMATED_EVIDENCE_ANCHOR"
    && finding.message.includes("exact test title or stable named test anchor")));
});

test("validate rejects competing Story traceability maps in v2 Epics", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  const source = await readFile(epicPath, "utf8");
  await writeFile(
    epicPath,
    source.replace(
      "#### Implemented By",
      "#### Prior Detailed Implementation Map (legacy)\n\nHistorical duplicate.\n\n#### Implemented By",
    ),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.level === "error"
    && finding.code === "COMPETING_TRACEABILITY_SECTION"
    && finding.message.includes("Prior Detailed Implementation Map")));
});

test("validate rejects mixed automated evidence with an unsafe extra citation", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  const source = await readFile(epicPath, "utf8");
  await writeFile(
    epicPath,
    source.replace(
      "Automated test `test/core.test.js#core journey completes successfully`",
      "Automated test `test/core.test.js#core journey completes successfully` plus `/tmp/fabricated.test.js#fabricated`",
    ),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.ok(result.findings.some((finding) =>
    finding.code === "INVALID_AUTOMATED_EVIDENCE_PATH"
    && finding.message.includes("/tmp/fabricated.test.js")));
  assert.ok(result.findings.some((finding) => finding.code === "MISSING_VERIFICATION_COVERAGE"));
});

test("validate reports directory evidence and implementation paths without throwing", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  const source = await readFile(epicPath, "utf8");
  await rm(join(root, "code", "sample-web", "test", "core.test.js"));
  await mkdir(join(root, "code", "sample-web", "test", "core.test.js"));
  await writeFile(
    epicPath,
    source.replace("src/core.js#runCoreJourney", "src#runCoreJourney"),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.ok(result.findings.some((finding) => finding.code === "INVALID_IMPLEMENTATION_PATH"));
  assert.ok(result.findings.some((finding) => finding.code === "INVALID_AUTOMATED_EVIDENCE_PATH"));
});

test("validate does not require a test path for manual Verified By evidence", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  const source = await readFile(epicPath, "utf8");
  await writeFile(
    epicPath,
    source.replace("Automated test `test/core.test.js#core journey completes successfully`", "Manual browser test at `/day`"),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(
    result.findings.some((finding) =>
      finding.code === "GENERIC_AUTOMATED_EVIDENCE"
      || finding.code === "MISSING_AUTOMATED_EVIDENCE_PATH"),
    false,
  );
});

test("validate reports unresolved scaffolding in an active Change", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-14-unresolved-placeholder";
  await writeCanonicalChange(root, "sample-web", changeId, "in_progress");
  const proposalPath = join(root, "code", "sample-web", "docs", "changes", changeId, "proposal.md");
  await writeFile(
    proposalPath,
    `${await readFile(proposalPath, "utf8")}\n## Deferred Detail\n\nCHANGE TITLE\n`,
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    changeId,
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "UNRESOLVED_TEMPLATE_PLACEHOLDER"
    && finding.path.endsWith("proposal.md")));
});

test("validate reports a Change left in planning after promotion", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const created = await createPlannedChange(root, "sample", "stale-planned-copy", {
    date: "2026-07-14",
    repositories: ["sample-web"],
  });
  await writeCanonicalChange(root, "sample-web", created.changeId, "proposed");

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    changeId: created.changeId,
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "CHANGE_LOCATION_COLLISION"
    && finding.message.includes("planning and repository")));
});

test("validate accepts pre-implementation planned statuses and rejects later states", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const created = await createPlannedChange(root, "sample", "invalid-planned-status", {
    date: "2026-07-14",
    repositories: ["sample-web"],
  });
  const tasksPath = join(root, created.path, "tasks.md");
  await setPlannedChangeStatus(root, created);

  let result = await validateArtifacts(root, {
    spaceId: "sample",
    changeId: created.changeId,
  });
  assert.equal(result.valid, true);

  await writeFile(
    tasksPath,
    (await readFile(tasksPath, "utf8")).replace("status: planned", "status: in_review"),
    "utf8",
  );

  result = await validateArtifacts(root, {
    spaceId: "sample",
    changeId: created.changeId,
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "CHANGE_STATUS_LOCATION_MISMATCH"));
});

test("validate reports broken Markdown links to SDD artifacts", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  await writeFile(
    epicPath,
    `${await readFile(epicPath, "utf8")}\n[Missing Change](../../changes/2026-07-14-missing/proposal.md)\n`,
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    epicId: "SAMPLE-E001",
  });

  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) =>
    finding.code === "BROKEN_ARTIFACT_LINK"
    && finding.message.includes("docs/changes/2026-07-14-missing/proposal.md")));
});

test("CLI exposes scoped validation with JSON output", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-14-cli-validation";
  await writeCanonicalChange(root, "sample-web", changeId, "in_review");

  const { stdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "validate",
    "sample",
    "--workspace",
    root,
    "--repo",
    "sample-web",
    "--change",
    changeId,
    "--json",
  ]);
  const result = JSON.parse(stdout);

  assert.equal(result.command, "validate");
  assert.equal(result.valid, true);
  assert.equal(result.scope.changeId, changeId);
  assert.deepEqual(result.scope.repositories, ["code/sample-web"]);
});

test("CLI validation returns exit code one with structured findings", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-14-invalid-cli-validation";
  await writeChange(root, "sample-web", changeId, "in_review");

  await assert.rejects(
    () => execFileAsync(process.execPath, [
      join(PACKAGE_ROOT, "bin", "sdd.js"),
      "validate",
      "sample",
      "--workspace",
      root,
      "--repo",
      "sample-web",
      "--change",
      changeId,
      "--json",
    ]),
    (error) => {
      const result = JSON.parse(error.stdout);
      return error.code === 1
        && result.valid === false
        && result.findings.some((finding) => finding.code === "MISSING_CHANGE_FILE");
    },
  );
});

test("workspace-local skill installation cannot escape the initialized root", async (t) => {
  const root = await createWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(
    () => initWorkspace(root, { skillsDirectory: "../shared-skills" }),
    (error) => error instanceof SddError && error.code === "INVALID_CONFIG",
  );
});

test("configured workspace paths cannot traverse outside the workspace", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const config = await readConfig(root);
  config.ideas.sample.repositories[0].path = "../outside";
  await writeConfig(root, config);

  const diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, false);
  assert.ok(diagnosis.findings.some((finding) => finding.message.includes("cannot traverse")));
  await assert.rejects(
    () => getWorkspaceContext(root),
    (error) => error instanceof SddError && error.code === "INVALID_CONFIG",
  );
});

test("workspace lifecycle statuses use the canonical vocabulary", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const config = await readConfig(root);
  config.ideas.sample.status = "building";
  config.ideas.sample.repositories[0].status = "retired";
  await writeConfig(root, config);

  const diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, false);
  assert.ok(diagnosis.findings.some((finding) => finding.message.includes("active, inactive, archived")));
  await assert.rejects(
    () => getStatus(root),
    (error) => error instanceof SddError && error.code === "INVALID_CONFIG",
  );
});
