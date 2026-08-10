import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmod,
  cp,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { promisify } from "node:util";
import { parse } from "yaml";

import { getWorkspaceContext } from "../src/commands/context.js";
import {
  configureWorkspace,
  inspectWorkspaceConfiguration,
} from "../src/commands/configure.js";
import { closeChange } from "../src/commands/change-close.js";
import { getCloseTransactionJournalPath } from "../src/change-close-transaction.js";
import { createChange } from "../src/commands/change-create.js";
import { transitionChange } from "../src/commands/change-transition.js";
import { createEpic } from "../src/commands/epic-create.js";
import { diagnoseWorkspace } from "../src/commands/doctor.js";
import { initRepository, setupInstallation } from "../src/commands/init-installation.js";
import { getStatus } from "../src/commands/status.js";
import { validateArtifacts } from "../src/commands/validate.js";
import { statusSummaryRows } from "../src/cli.js";
import { updateWorkspace } from "../src/commands/update.js";
import {
  getWorkspaceConfigPath,
  getWorkspaceInstallLockPath,
  createInitialConfig,
  getRepositoryConfigPath,
  createRepositoryConfig,
  readWorkspaceConfig,
  readRepositoryConfig,
  writeRepositoryConfig,
  writeWorkspaceConfig,
  validateConfig,
  validateRepositoryConfig,
} from "../src/config.js";
import {
  getActiveChangePath,
  getChangesRoot,
  getClosedChangePath,
  listStoredChanges,
} from "../src/change-store.js";
import { inspectChangeStatuses } from "../src/change-status.js";
import { PACKAGE_ROOT, WORKFLOW_SOURCE_PATH } from "../src/constants.js";
import { SddError } from "../src/errors.js";
import { hashDirectory, hashFile, pathExists } from "../src/fs.js";
import { collectConfigureOptions, collectSetupOptions } from "../src/prompts.js";
import { withWorkspaceMutationLock } from "../src/mutation.js";
const execFileAsync = promisify(execFile);

const inheritedWorkspaceRoot = process.env.SDD_WORKSPACE_ROOT;
const inheritedUserHome = process.env.SDD_USER_HOME;
delete process.env.SDD_WORKSPACE_ROOT;
delete process.env.SDD_USER_HOME;
after(() => {
  if (inheritedWorkspaceRoot === undefined) delete process.env.SDD_WORKSPACE_ROOT;
  else process.env.SDD_WORKSPACE_ROOT = inheritedWorkspaceRoot;
  if (inheritedUserHome === undefined) delete process.env.SDD_USER_HOME;
  else process.env.SDD_USER_HOME = inheritedUserHome;
});

async function releasedLegacyDirectoryHash(root) {
  async function collect(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    const collected = [];
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const relativePath = relative(root, absolutePath).split(sep).join("/");
      if (entry.isDirectory()) {
        collected.push({ type: "directory", relativePath, absolutePath });
        collected.push(...await collect(absolutePath));
      } else if (entry.isFile()) {
        collected.push({ type: "file", relativePath, absolutePath });
      } else if (entry.isSymbolicLink()) {
        collected.push({ type: "symlink", relativePath, absolutePath });
      } else {
        throw new Error(`Unsupported released-lock fixture entry: ${absolutePath}`);
      }
    }
    return collected;
  }

  const hash = createHash("sha256");
  for (const entry of await collect(root)) {
    hash.update(`${entry.type}\0${entry.relativePath}\0`);
    if (entry.type === "file") hash.update(await readFile(entry.absolutePath));
    else if (entry.type === "symlink") hash.update(await readlink(entry.absolutePath));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

async function initWorkspace(root, options = {}) {
  return setupInstallation(root, {
    skillsDirectory: ".agents/skills",
    ...options,
  });
}


async function createWorkspace(prefix = "sdd-cli-") {
  return mkdtemp(join(tmpdir(), prefix));
}

function subprocessEnvForDecoyHome(decoyHome) {
  const env = { ...process.env, HOME: decoyHome, SDD_USER_HOME: decoyHome };
  delete env.SDD_WORKSPACE_ROOT;
  return env;
}

async function populateMappedWorkspace(root, { spaceId = "sample" } = {}) {
  await mkdir(join(root, "ideas", spaceId), { recursive: true });
  await mkdir(join(root, "code", "sample-web"), { recursive: true });
  await mkdir(join(root, "code", "sample-mobile"), { recursive: true });
  await writeRepositoryConfig(
    join(root, "code", "sample-web"),
    createRepositoryConfig("sample-web"),
  );
  await writeRepositoryConfig(
    join(root, "code", "sample-mobile"),
    createRepositoryConfig("sample-mobile"),
  );
  await writeFile(
    join(root, "ideas", spaceId, `${spaceId}.md`),
    [
      "---",
      "repositories:",
      "  - path: code/sample-web",
      "    role: web",
      "  - path: code/sample-mobile",
      "    role: mobile",
      "---",
      `# ${spaceId === "sample" ? "Sample" : "Home Only"}`,
      "",
    ].join("\n"),
    "utf8",
  );
  return root;
}

async function createMappedWorkspace() {
  return populateMappedWorkspace(await createWorkspace());
}

async function assertRepositoryArtifactCommandsReject(
  workspaceRoot,
  repositorySelector,
  repositoryStartPath = null,
) {
  const rejectsUnsafeArtifact = (error) =>
    error instanceof SddError && error.code === "UNSAFE_ARTIFACT_PATH";
  const status = await getStatus(workspaceRoot, "sample", { workspaceRoot });
  assert.ok(status.repositoryDiagnostics.some((diagnostic) =>
    diagnostic.code === "UNSAFE_ARTIFACT_PATH"));
  await assert.rejects(
    () => validateArtifacts(workspaceRoot, {
      spaceId: "sample",
      repositories: [repositorySelector],
      epicId: "OUTSIDE-E001",
      workspaceRoot,
    }),
    rejectsUnsafeArtifact,
  );
  const diagnosis = await diagnoseWorkspace(workspaceRoot, { workspaceRoot });
  assert.equal(diagnosis.healthy, false);
  const doctorFinding = diagnosis.findings.find((finding) =>
    finding.code === "UNSAFE_ARTIFACT_PATH");
  assert.ok(doctorFinding);
  assert.ok(Array.isArray(doctorFinding.details));
  const { stdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "doctor",
    "--workspace",
    workspaceRoot,
    "--json",
  ], { cwd: workspaceRoot });
  const commandDiagnosis = JSON.parse(stdout);
  assert.equal(commandDiagnosis.healthy, false);
  assert.ok(commandDiagnosis.findings.some((finding) =>
    finding.code === "UNSAFE_ARTIFACT_PATH"
      && Array.isArray(finding.details)));
  if (repositoryStartPath !== null) {
    await assert.rejects(
      () => getStatus(repositoryStartPath, "sample", { workspaceRoot }),
      rejectsUnsafeArtifact,
    );
  }
}

async function createExplicitWorkspaceWithDecoyHome(prefix) {
  const root = await createWorkspace(prefix);
  const workspaceRoot = join(root, "workspace");
  const decoyHome = join(root, "home");
  const outside = join(root, "outside");
  await populateMappedWorkspace(workspaceRoot);
  await populateMappedWorkspace(decoyHome, { spaceId: "home-only" });
  await mkdir(outside, { recursive: true });
  await initWorkspace(workspaceRoot);
  await initWorkspace(decoyHome);
  await writeFile(
    join(decoyHome, ".sdd", "home-installation-sentinel.txt"),
    "explicit workspace commands must not touch this installation\n",
    "utf8",
  );
  return {
    root,
    workspaceRoot,
    decoyHome,
    outside,
    env: subprocessEnvForDecoyHome(decoyHome),
  };
}

async function addRetiredManagedSkill(root, skillName) {
  const retiredPath = join(root, ".agents", "skills", skillName);
  await mkdir(retiredPath, { recursive: true });
  await writeFile(join(retiredPath, "SKILL.md"), `# ${skillName}\n`, "utf8");
  const lockPath = getWorkspaceInstallLockPath(root);
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  lock.managedSkills[skillName] = await hashDirectory(retiredPath);
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  return retiredPath;
}

async function moveWorkspaceRoots(root) {
  await mkdir(join(root, "spaces"), { recursive: true });
  await rename(join(root, "ideas"), join(root, "spaces", "ideas"));
  await rename(join(root, "code"), join(root, "spaces", "code"));
}

async function addRepositoryRootMapping(root, rootId, configuredRoot, repositoryPath) {
  const config = await readWorkspaceConfig(root);
  config.repositories.roots[rootId] = configuredRoot;
  config.ideas.sample.repositories.push({
    root: rootId,
    path: repositoryPath,
    status: "active",
  });
  await writeWorkspaceConfig(root, config);
}

async function writeChange(root, repository, changeId, status, { closed = false } = {}) {
  const changePath = join(
    root,
    ".sdd",
    "changes",
    ...(closed ? ["closed"] : []),
    changeId,
  );
  await mkdir(changePath, { recursive: true });
  await writeFile(
    join(changePath, "tasks.md"),
    [
      "---",
      `status: ${status}`,
      "space: sample",
      "repositories:",
      `  - ${repository}`,
      "---",
      `# Tasks: ${changeId}`,
      "",
    ].join("\n"),
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
    ".sdd",
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
      "space: sample",
      "repositories:",
      `  - ${repository}`,
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

test("setup creates a workspace contract and imports one-to-many mappings", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await initWorkspace(root);
  assert.equal(result.command, "setup");
  assert.equal(result.workspaceRoot, root);
  assert.equal(result.createdWorkspaceConfig, true);
  assert.ok(result.skills.actions.length > 0);
  assert.ok(result.skills.actions.every((entry) => entry.action === "install"));
  assert.equal(result.workflowPath, join(root, ".sdd", "story-driven-development.md"));

  const config = parse(await readFile(getWorkspaceConfigPath(root), "utf8"));
  assert.equal(config.version, 3);
  assert.equal(config.schema, "sdd-v3");
  assert.equal(Object.hasOwn(config, "kind"), false);
  assert.equal(config.planning.root, "ideas");
  assert.deepEqual(config.repositories.roots, { code: "code" });
  assert.equal(config.ideas.sample.planning, undefined);
  assert.equal(config.ideas.sample.status, "active");
  assert.deepEqual(config.ideas.sample.repositories, [
    { root: "code", path: "sample-web", role: "web", status: "active" },
    { root: "code", path: "sample-mobile", role: "mobile", status: "active" },
  ]);
  assert.equal(await pathExists(join(root, ".agents", "skills", "sdd-change", "SKILL.md")), true);
  assert.equal(await pathExists(join(root, ".sdd", "install-lock.json")), true);
  assert.equal(
    await readFile(join(root, ".sdd", "story-driven-development.md"), "utf8"),
    await readFile(WORKFLOW_SOURCE_PATH, "utf8"),
  );
});

test("setup rejects a managed skills path through an external symlink ancestor", async (t) => {
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
  const installLockPath = getWorkspaceInstallLockPath(root);
  const before = await readFile(installLockPath, "utf8");
  await writeFile(join(root, ".sdd", "mutation.lock"), "held\n", "utf8");

  await assert.rejects(
    () => updateWorkspace(root),
    (error) => error instanceof SddError && error.code === "OPERATION_IN_PROGRESS",
  );
  assert.equal(await readFile(installLockPath, "utf8"), before);
});

test("setup dry-run reports work without writing workspace files", async (t) => {
  const root = await createWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await initWorkspace(root, { dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(await pathExists(join(root, ".sdd")), false);
  assert.equal(await pathExists(join(root, ".agents")), false);
});

test("CLI setup owns only the explicit workspace and exposes workspace output fields", async (t) => {
  const root = await createWorkspace("sdd-workspace-setup-");
  const workspaceRoot = join(root, "workspace");
  const decoyHome = join(root, "home");
  const repositoryRoot = join(workspaceRoot, "repos", "sample-app");
  await mkdir(repositoryRoot, { recursive: true });
  await mkdir(decoyHome, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));

  const env = subprocessEnvForDecoyHome(decoyHome);
  const first = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "setup",
    workspaceRoot,
    "--planning-root",
    "product/ideas",
    "--repository-root",
    "repos",
    "--yes",
    "--json",
  ], { env });
  const result = JSON.parse(first.stdout);

  assert.equal(result.command, "setup");
  assert.equal(result.mode, "workspace");
  assert.equal(result.workspaceRoot, workspaceRoot);
  assert.equal(result.workspaceConfigPath, getWorkspaceConfigPath(workspaceRoot));
  assert.equal(result.createdWorkspaceConfig, true);
  assert.equal(Object.hasOwn(result, "userRoot"), false);
  assert.equal(Object.hasOwn(result, "userConfigPath"), false);
  assert.equal(
    await pathExists(join(workspaceRoot, ".agents", "skills", "sdd-apply", "SKILL.md")),
    true,
  );
  assert.equal(await pathExists(join(workspaceRoot, ".sdd", "install-lock.json")), true);
  assert.equal(
    await pathExists(join(workspaceRoot, ".sdd", "story-driven-development.md")),
    true,
  );
  assert.equal(await pathExists(join(repositoryRoot, ".sdd")), false);
  assert.equal(await pathExists(join(decoyHome, ".sdd")), false);
  assert.equal(await pathExists(join(decoyHome, ".agents")), false);

  const config = await readWorkspaceConfig(workspaceRoot);
  assert.equal(config.version, 3);
  assert.equal(config.schema, "sdd-v3");
  assert.equal(Object.hasOwn(config, "kind"), false);
  assert.equal(config.skills.directory, ".agents/skills");
  assert.equal(config.planning.root, "product/ideas");
  assert.deepEqual(config.repositories.roots, { repos: "repos" });

  const second = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "setup",
    workspaceRoot,
    "--yes",
    "--json",
  ], { env });
  const repeated = JSON.parse(second.stdout);
  assert.equal(repeated.createdWorkspaceConfig, false);
  assert.ok(repeated.skills.actions.every((entry) => entry.action === "unchanged"));
});

test("workspace configuration stores contained topology paths relative to the workspace", async (t) => {
  const root = await createWorkspace("sdd-workspace-topology-");
  const workspaceRoot = join(root, "workspace");
  const planningRoot = join(workspaceRoot, "my-vault", "sdd", "ideas");
  const repositoryRoot = join(workspaceRoot, "spaces");
  const ideaRoot = join(planningRoot, "sample");
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(ideaRoot, { recursive: true });
  await mkdir(join(repositoryRoot, "sample-app"), { recursive: true });
  await writeFile(
    join(ideaRoot, "sample.md"),
    "---\nrepositories:\n  - path: spaces/sample-app\n    role: primary\n---\n# Sample\n",
    "utf8",
  );

  const config = await createInitialConfig(workspaceRoot, {
    planningRoot,
    repositoryRoots: [repositoryRoot],
  });

  assert.equal(config.planning.root, "my-vault/sdd/ideas");
  assert.deepEqual(config.repositories.roots, { spaces: "spaces" });
  assert.deepEqual(config.ideas.sample.repositories, [{
    root: "spaces",
    path: "sample-app",
    role: "primary",
    status: "active",
  }]);
});

test("repeated setup treats identical absolute contained layout options as idempotent", async (t) => {
  const workspaceRoot = await createMappedWorkspace();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const options = {
    planningRoot: join(workspaceRoot, "ideas"),
    repositoryRoots: [join(workspaceRoot, "code")],
    skillsDirectory: join(workspaceRoot, ".agents", "skills"),
  };

  const first = await setupInstallation(workspaceRoot, options);
  const configPath = getWorkspaceConfigPath(workspaceRoot);
  const sourceAfterFirstSetup = await readFile(configPath, "utf8");
  const second = await setupInstallation(workspaceRoot, options);
  const config = await readWorkspaceConfig(workspaceRoot);

  assert.equal(first.createdWorkspaceConfig, true);
  assert.equal(second.createdWorkspaceConfig, false);
  assert.equal(await readFile(configPath, "utf8"), sourceAfterFirstSetup);
  assert.equal(config.skills.directory, ".agents/skills");
  assert.equal(config.planning.root, "ideas");
  assert.deepEqual(config.repositories.roots, { code: "code" });
  assert.ok(second.skills.actions.every((entry) => entry.action === "unchanged"));
});

test("CLI setup adopts a matching skill already inside the workspace registry", async (t) => {
  const root = await createWorkspace("sdd-workspace-adopt-");
  const workspaceRoot = join(root, "workspace");
  const targetSkill = join(workspaceRoot, ".agents", "skills", "sdd-apply");
  await mkdir(join(workspaceRoot, ".agents", "skills"), { recursive: true });
  await cp(join(PACKAGE_ROOT, "skills", "sdd-apply"), targetSkill, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));

  const output = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "setup",
    workspaceRoot,
    "--yes",
    "--json",
  ]);
  const result = JSON.parse(output.stdout);
  const adopted = result.skills.actions.find((entry) => entry.skillName === "sdd-apply");

  assert.equal(adopted.action, "adopt");
  const lock = JSON.parse(
    await readFile(join(workspaceRoot, ".sdd", "install-lock.json"), "utf8"),
  );
  assert.equal(lock.managedSkills["sdd-apply"], adopted.hash);
});

test("CLI setup migrates a released legacy user v1 source through dry-run and apply", async (t) => {
  const root = await createWorkspace("sdd-from-user-v1-");
  const legacyUserRoot = join(root, "legacy-home");
  const workspaceRoot = join(root, "workspace");
  const sourceConfigPath = join(legacyUserRoot, ".sdd", "config.yaml");
  const sourceLockPath = join(legacyUserRoot, ".sdd", "install-lock.json");
  const sourceSkillPath = join(
    legacyUserRoot,
    ".agents",
    "skills",
    "sdd-change",
  );
  const sourceKeepPath = join(legacyUserRoot, "keep.txt");
  const sourcePlannedRoot = join(
    legacyUserRoot,
    "planning",
    "sample",
    "planned-changes",
  );
  const sourceBriefPath = join(sourcePlannedRoot, "future-capability.md");
  const plannedChangeIds = [
    "2026-08-09-first-planned-change",
    "2026-08-09-second-planned-change",
  ];
  const migratedBriefPath = join(
    legacyUserRoot,
    "planning",
    "sample",
    "change-briefs",
    "future-capability.md",
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(dirname(sourceConfigPath), { recursive: true });
  await mkdir(join(legacyUserRoot, "planning", "sample"), { recursive: true });
  await mkdir(join(legacyUserRoot, "repositories", "sample-app"), { recursive: true });
  await writeRepositoryConfig(
    join(legacyUserRoot, "repositories", "sample-app"),
    createRepositoryConfig("sample-app"),
  );
  await cp(
    join(PACKAGE_ROOT, "skills", "sdd-change"),
    sourceSkillPath,
    { recursive: true, verbatimSymlinks: true },
  );
  const sourceSkillHash = await hashDirectory(sourceSkillPath);
  const releasedSourceSkillHash = await releasedLegacyDirectoryHash(sourceSkillPath);
  const legacyConfig = {
    kind: "user",
    version: 1,
    schema: "sdd-user-v1",
    skills: { directory: "~/.agents/skills" },
    planning: {
      root: "planning",
      plannedChangesDirectory: "planned-changes",
    },
    repositories: { roots: { source: "repositories" } },
    repositoryArtifacts: {
      activeChanges: "docs/changes",
      closedChanges: "docs/changes/closed",
      epics: "docs/epics",
      adrs: "docs/adrs",
      audits: "docs/audits",
    },
    ideas: {
      sample: {
        status: "active",
        repositories: [{
          root: "source",
          path: "sample-app",
          role: "primary",
          status: "active",
        }],
      },
    },
  };
  await writeFile(
    sourceConfigPath,
    `${JSON.stringify(legacyConfig, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    sourceLockPath,
    `${JSON.stringify({
      version: 1,
      packageVersion: "released-v1-fixture",
      schemaVersion: "sdd-user-v1",
      skillsDirectory: "~/.agents/skills",
      managedSkills: { "sdd-change": releasedSourceSkillHash },
    }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(sourceKeepPath, "unrelated legacy state\n", "utf8");
  await mkdir(sourcePlannedRoot, { recursive: true });
  await writeFile(sourceBriefPath, "# Future capability\n", "utf8");
  for (const changeId of plannedChangeIds) {
    const plannedChangePath = join(sourcePlannedRoot, changeId);
    await mkdir(plannedChangePath, { recursive: true });
    await Promise.all([
      writeFile(join(plannedChangePath, "proposal.md"), `# Proposal: ${changeId}\n`, "utf8"),
      writeFile(join(plannedChangePath, "design.md"), `# Design: ${changeId}\n`, "utf8"),
      writeFile(
        join(plannedChangePath, "tasks.md"),
        `---\nstatus: planned\n---\n# Tasks: ${changeId}\n`,
        "utf8",
      ),
    ]);
  }
  const sourceBefore = await hashDirectory(legacyUserRoot);
  const destinationBefore = await hashDirectory(workspaceRoot);

  const { stdout: humanDryRunStdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "setup",
    workspaceRoot,
    "--from-user",
    legacyUserRoot,
    "--dry-run",
    "--yes",
  ], { cwd: root });
  for (const changeId of plannedChangeIds) {
    assert.match(humanDryRunStdout, new RegExp(`Would migrate planned Change ${changeId}`));
    assert.equal(humanDryRunStdout.split(changeId).length - 1, 1);
  }
  assert.ok(
    humanDryRunStdout.includes(
      `Would retire legacy planned Changes root: ${sourcePlannedRoot}`,
    ),
  );

  const { stdout: dryRunStdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "setup",
    workspaceRoot,
    "--from-user",
    legacyUserRoot,
    "--dry-run",
    "--yes",
    "--json",
  ], { cwd: root });
  const dryRun = JSON.parse(dryRunStdout);

  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.migrationSource, legacyUserRoot);
  assert.equal(dryRun.config.version, 3);
  assert.equal(dryRun.config.planning.root, join(legacyUserRoot, "planning"));
  assert.equal(
    dryRun.config.repositories.roots.source,
    join(legacyUserRoot, "repositories"),
  );
  assert.ok(dryRun.migration.actions.some((action) =>
    action.kind === "brief" && action.to === migratedBriefPath));
  assert.equal(await hashDirectory(legacyUserRoot), sourceBefore);
  assert.equal(await hashDirectory(workspaceRoot), destinationBefore);
  assert.equal(await pathExists(getWorkspaceConfigPath(workspaceRoot)), false);

  const { stdout: appliedStdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "setup",
    workspaceRoot,
    "--from-user",
    legacyUserRoot,
    "--yes",
    "--json",
  ], { cwd: root });
  const applied = JSON.parse(appliedStdout);
  const migrated = await readWorkspaceConfig(workspaceRoot);

  assert.equal(applied.dryRun, false);
  assert.equal(applied.migrationSource, legacyUserRoot);
  assert.equal(migrated.version, 3);
  assert.equal(migrated.schema, "sdd-v3");
  assert.equal(Object.hasOwn(migrated, "kind"), false);
  assert.equal(Object.hasOwn(migrated.planning, "plannedChangesDirectory"), false);
  assert.deepEqual(migrated.repositoryArtifacts, {
    epics: "docs/epics",
    adrs: "docs/adrs",
    audits: "docs/audits",
  });
  assert.equal(await pathExists(sourceConfigPath), false);
  assert.equal(await pathExists(sourceLockPath), false);
  assert.equal(await pathExists(sourceSkillPath), false);
  assert.equal(await readFile(sourceKeepPath, "utf8"), "unrelated legacy state\n");
  assert.equal(await pathExists(sourcePlannedRoot), false);
  for (const changeId of plannedChangeIds) {
    assert.equal(await pathExists(join(sourcePlannedRoot, changeId)), false);
    assert.equal(
      await pathExists(join(workspaceRoot, ".sdd", "changes", changeId, "tasks.md")),
      true,
    );
  }
  assert.equal(await readFile(migratedBriefPath, "utf8"), "# Future capability\n");
  assert.equal(
    await hashDirectory(join(workspaceRoot, ".agents", "skills", "sdd-change")),
    sourceSkillHash,
  );
});

test("CLI setup migrates an explicit legacy user v2 source and supports dry-run", async (t) => {
  const root = await createWorkspace("sdd-from-user-");
  const legacyUserRoot = join(root, "legacy-home");
  const workspaceRoot = join(root, "workspace");
  const planningRoot = join(root, "legacy-planning");
  const repositoryRoot = join(root, "legacy-repositories");
  const legacySkillsRoot = join(root, "legacy-skills");
  const repositoryPath = join(repositoryRoot, "sample-app");
  const changeId = "2026-08-07-setup-source-change";
  const sourceChangePath = join(legacyUserRoot, ".sdd", "changes", changeId);
  const sourceConfigPath = join(legacyUserRoot, ".sdd", "config.yaml");
  const sourceWorkflowPath = join(
    legacyUserRoot,
    ".sdd",
    "story-driven-development.md",
  );
  const sourceLockPath = join(legacyUserRoot, ".sdd", "install-lock.json");
  const sourceManagedSkillPath = join(
    legacySkillsRoot,
    "sdd-apply",
  );
  const sourceUnrelatedSkillPath = join(
    legacySkillsRoot,
    "local-legacy-skill",
    "SKILL.md",
  );
  const sourceUnrelatedPath = join(legacyUserRoot, "legacy-unrelated.txt");
  const sourceRecoveryPath = join(
    legacyUserRoot,
    ".sdd",
    "legacy-recovery.txt",
  );
  const destinationRecoveryPath = join(
    workspaceRoot,
    ".sdd",
    "legacy-recovery.txt",
  );
  const sourceDefaultSkillsRoot = join(legacyUserRoot, ".agents", "skills");
  const sourceDefaultSkillsTarget = join(root, "legacy-default-skills");
  const sourceDefaultSkillsLink = join(
    legacyUserRoot,
    ".agents",
    "default-skills-link",
  );
  const sourceDefaultSkillPath = join(
    sourceDefaultSkillsLink,
    "local-default-skill",
    "SKILL.md",
  );
  const sourceDefaultFilePath = join(legacyUserRoot, ".agents", "keep.txt");
  const sourceDefaultTargetSkillPath = join(
    sourceDefaultSkillsTarget,
    "local-default-skill",
    "SKILL.md",
  );
  const destinationWorkflowPath = join(
    workspaceRoot,
    ".sdd",
    "story-driven-development.md",
  );
  const destinationLockPath = getWorkspaceInstallLockPath(workspaceRoot);
  const destinationManagedSkillPath = join(
    workspaceRoot,
    ".agents",
    "skills",
    "sdd-apply",
  );
  const destinationUnrelatedSkillPath = join(
    workspaceRoot,
    ".agents",
    "skills",
    "local-workspace-skill",
    "SKILL.md",
  );
  const destinationUnrelatedPath = join(
    workspaceRoot,
    ".sdd",
    "workspace-unrelated.txt",
  );
  t.after(() => rm(root, { recursive: true, force: true }));

  await mkdir(join(planningRoot, "sample"), { recursive: true });
  await mkdir(repositoryPath, { recursive: true });
  await writeRepositoryConfig(repositoryPath, createRepositoryConfig("sample-app"));
  await mkdir(sourceChangePath, { recursive: true });
  await writeFile(join(sourceChangePath, "proposal.md"), "# Proposal\n", "utf8");
  await writeFile(join(sourceChangePath, "design.md"), "# Design\n", "utf8");
  await writeFile(
    join(sourceChangePath, "tasks.md"),
    [
      "---",
      "status: in_progress",
      "space: sample",
      "repositories:",
      "  - sample-app",
      "---",
      "# Tasks",
      "",
    ].join("\n"),
    "utf8",
  );
  const legacyConfig = {
    kind: "user",
    version: 2,
    schema: "sdd-user-v2",
    skills: { directory: "../legacy-skills" },
    planning: { root: "../legacy-planning" },
    repositories: { roots: { repos: "../legacy-repositories" } },
    repositoryArtifacts: {
      epics: "docs/epics",
      adrs: "docs/adrs",
      audits: "docs/audits",
    },
    ideas: {
      sample: {
        status: "active",
        planningPath: "../legacy-planning/sample",
        repositories: [{
          root: "repos",
          path: "sample-app",
          role: "primary",
          status: "active",
        }],
      },
    },
  };
  await mkdir(join(legacyUserRoot, ".sdd"), { recursive: true });
  await writeFile(
    sourceConfigPath,
    `${JSON.stringify(legacyConfig, null, 2)}\n`,
    "utf8",
  );

  await cp(
    join(PACKAGE_ROOT, "skills", "sdd-apply"),
    sourceManagedSkillPath,
    { recursive: true, verbatimSymlinks: true },
  );
  await cp(WORKFLOW_SOURCE_PATH, sourceWorkflowPath);
  await writeFile(
    sourceLockPath,
    `${JSON.stringify({
      version: 2,
      packageVersion: "legacy-fixture",
      schemaVersion: "sdd-user-v2",
      skillsDirectory: "../legacy-skills",
      managedSkills: {
        "sdd-apply": await releasedLegacyDirectoryHash(sourceManagedSkillPath),
      },
      managedWorkflow: {
        path: ".sdd/story-driven-development.md",
        hash: await hashFile(sourceWorkflowPath),
      },
    }, null, 2)}\n`,
    "utf8",
  );
  await mkdir(dirname(sourceUnrelatedSkillPath), { recursive: true });
  await writeFile(
    sourceUnrelatedSkillPath,
    "unrelated legacy skill\n",
    "utf8",
  );
  await writeFile(sourceUnrelatedPath, "unrelated legacy state\n", "utf8");
  await writeFile(sourceRecoveryPath, "legacy recovery state\n", "utf8");
  await mkdir(dirname(sourceDefaultTargetSkillPath), { recursive: true });
  await writeFile(
    sourceDefaultTargetSkillPath,
    "unrelated default-registry skill\n",
    "utf8",
  );
  await mkdir(sourceDefaultSkillsRoot, { recursive: true });
  await symlink(sourceDefaultSkillsTarget, sourceDefaultSkillsLink, "dir");
  await writeFile(sourceDefaultFilePath, "unrelated default file\n", "utf8");
  await mkdir(dirname(destinationUnrelatedSkillPath), { recursive: true });
  await writeFile(
    destinationUnrelatedSkillPath,
    "unrelated workspace skill\n",
    "utf8",
  );
  await mkdir(dirname(destinationUnrelatedPath), { recursive: true });
  await writeFile(
    destinationUnrelatedPath,
    "unrelated workspace state\n",
    "utf8",
  );

  assert.equal(await pathExists(getWorkspaceConfigPath(workspaceRoot)), false);
  assert.equal(await pathExists(destinationLockPath), false);
  assert.equal(await pathExists(destinationWorkflowPath), false);
  assert.equal(await pathExists(destinationManagedSkillPath), false);
  assert.deepEqual(
    (await readdir(workspaceRoot))
      .filter((entry) => entry.startsWith(".sdd-from-user-")),
    [],
  );
  const sourceBeforeDryRun = await hashDirectory(legacyUserRoot);
  const siblingSourcesBeforeDryRun = await Promise.all([
    planningRoot,
    repositoryRoot,
    legacySkillsRoot,
  ].map((path) => hashDirectory(path)));
  const destinationBeforeDryRun = await hashDirectory(workspaceRoot);
  const overrideErrors = [];
  for (const dryRun of [true, false]) {
    await assert.rejects(
      execFileAsync(process.execPath, [
        join(PACKAGE_ROOT, "bin", "sdd.js"),
        "setup",
        workspaceRoot,
        "--from-user",
        legacyUserRoot,
        "--skills-dir",
        "custom",
        ...(dryRun ? ["--dry-run"] : []),
        "--json",
      ]),
      (error) => {
        overrideErrors.push(JSON.parse(error.stderr).error);
        return true;
      },
    );
  }
  assert.deepEqual(overrideErrors[0], overrideErrors[1]);
  assert.equal(overrideErrors[0].code, "INVALID_MIGRATION_OPTIONS");
  assert.equal(await hashDirectory(legacyUserRoot), sourceBeforeDryRun);
  assert.deepEqual(
    await Promise.all([
      planningRoot,
      repositoryRoot,
      legacySkillsRoot,
    ].map((path) => hashDirectory(path))),
    siblingSourcesBeforeDryRun,
  );
  assert.equal(await hashDirectory(workspaceRoot), destinationBeforeDryRun);

  const dryRunOutput = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "setup",
    workspaceRoot,
    "--from-user",
    legacyUserRoot,
    "--dry-run",
    "--json",
  ]);
  assert.equal(
    await hashDirectory(legacyUserRoot),
    sourceBeforeDryRun,
    "dry-run must not mutate any source entry",
  );
  assert.deepEqual(
    await Promise.all([
      planningRoot,
      repositoryRoot,
      legacySkillsRoot,
    ].map((path) => hashDirectory(path))),
    siblingSourcesBeforeDryRun,
    "dry-run must not mutate owner-relative sibling sources",
  );
  assert.equal(
    await hashDirectory(workspaceRoot),
    destinationBeforeDryRun,
    "dry-run must not mutate any destination entry",
  );
  const dryRun = JSON.parse(dryRunOutput.stdout);
  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.workspaceRoot, workspaceRoot);
  assert.equal(dryRun.migrationSource, legacyUserRoot);
  assert.equal(Object.hasOwn(dryRun, "userRoot"), false);
  assert.equal(await pathExists(getWorkspaceConfigPath(workspaceRoot)), false);
  assert.equal(await pathExists(sourceChangePath), true);
  assert.equal(await pathExists(sourceConfigPath), true);
  assert.equal(await pathExists(sourceLockPath), true);
  assert.equal(await pathExists(sourceWorkflowPath), true);
  assert.equal(await pathExists(sourceManagedSkillPath), true);
  assert.equal(await pathExists(sourceUnrelatedSkillPath), true);
  assert.equal(await pathExists(sourceUnrelatedPath), true);
  assert.equal(await pathExists(sourceRecoveryPath), true);
  assert.equal(await pathExists(destinationRecoveryPath), false);
  assert.equal(await pathExists(destinationLockPath), false);
  assert.equal(await pathExists(destinationWorkflowPath), false);
  assert.equal(await pathExists(destinationManagedSkillPath), false);
  assert.equal(await pathExists(destinationUnrelatedSkillPath), true);
  assert.equal(await pathExists(destinationUnrelatedPath), true);
  assert.deepEqual(
    (await readdir(workspaceRoot))
      .filter((entry) => entry.startsWith(".sdd-from-user-")),
    [],
  );
  const humanDryRunOutput = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "setup",
    workspaceRoot,
    "--from-user",
    legacyUserRoot,
    "--dry-run",
  ]);
  const migrationKinds = new Set(dryRun.migration.actions.map((action) => action.kind));
  assert.ok(migrationKinds.has("change"), "dry-run must expose Change migration");
  assert.ok(migrationKinds.has("recovery"), "dry-run must expose recovery migration");
  assert.ok(
    dryRun.migration.actions.some((action) =>
      ["workspace-config", "workflow", "skill"].includes(action.kind)),
    "dry-run must expose destination publications",
  );
  assert.ok(
    dryRun.migration.actions.some((action) => action.action === "retire"),
    "dry-run must expose legacy retirements",
  );
  const humanActionLines = humanDryRunOutput.stdout.split("\n");
  for (const action of dryRun.migration.actions) {
    const identity = action.changeId ?? action.path ?? action.skillName ?? action.stageRoot;
    assert.ok(
      humanActionLines.some((line) =>
        line.startsWith(`Would ${action.action} `) && line.includes(identity)),
      `human dry-run must expose ${action.kind ?? "recovery"} action ${identity}`,
    );
  }
  assert.equal(await hashDirectory(legacyUserRoot), sourceBeforeDryRun);
  assert.deepEqual(
    await Promise.all([
      planningRoot,
      repositoryRoot,
      legacySkillsRoot,
    ].map((path) => hashDirectory(path))),
    siblingSourcesBeforeDryRun,
  );
  assert.equal(await hashDirectory(workspaceRoot), destinationBeforeDryRun);


  const migratedOutput = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "setup",
    workspaceRoot,
    "--from-user",
    legacyUserRoot,
    "--json",
  ]);
  const migratedResult = JSON.parse(migratedOutput.stdout);
  const migrated = await readWorkspaceConfig(workspaceRoot);
  assert.equal(migratedResult.migrationSource, legacyUserRoot);
  assert.equal(migrated.version, 3);
  assert.equal(migrated.schema, "sdd-v3");
  assert.equal(Object.hasOwn(migrated, "kind"), false);
  assert.equal(migrated.skills.directory, ".agents/skills");
  assert.equal(migrated.planning.root, planningRoot);
  assert.equal(migrated.repositories.roots.repos, repositoryRoot);
  assert.equal(migrated.ideas.sample.planningPath, join(planningRoot, "sample"));
  assert.equal(
    await pathExists(join(workspaceRoot, ".sdd", "changes", changeId, "tasks.md")),
    true,
  );
  assert.equal(await pathExists(sourceConfigPath), false);
  assert.equal(await pathExists(sourceLockPath), false);
  assert.equal(await pathExists(sourceWorkflowPath), false);
  assert.equal(await pathExists(sourceManagedSkillPath), false);
  assert.equal(await pathExists(join(planningRoot, "sample")), true);
  assert.equal(await pathExists(getRepositoryConfigPath(repositoryPath)), true);
  assert.equal(await pathExists(sourceRecoveryPath), false);
  assert.equal(
    await readFile(destinationRecoveryPath, "utf8"),
    "legacy recovery state\n",
  );
  assert.equal(
    await readFile(sourceUnrelatedSkillPath, "utf8"),
    "unrelated legacy skill\n",
  );
  assert.equal((await lstat(sourceDefaultSkillsRoot)).isDirectory(), true);
  assert.equal((await lstat(sourceDefaultSkillsLink)).isSymbolicLink(), true);
  assert.equal(
    await readFile(sourceDefaultSkillPath, "utf8"),
    "unrelated default-registry skill\n",
  );
  assert.equal(
    await readFile(sourceDefaultFilePath, "utf8"),
    "unrelated default file\n",
  );
  assert.equal(
    await readFile(sourceUnrelatedPath, "utf8"),
    "unrelated legacy state\n",
  );
});

test("CLI setup migrates an explicit legacy home-root v3 workspace", async (t) => {
  const root = await createWorkspace("sdd-from-home-workspace-");
  const legacyHomeRoot = join(root, "legacy-home");
  const workspaceRoot = join(root, "workspace");
  const planningRoot = join(workspaceRoot, "ideas");
  const repositoryRoot = join(workspaceRoot, "repos");
  t.after(() => rm(root, { recursive: true, force: true }));

  await mkdir(join(planningRoot, "sample"), { recursive: true });
  await mkdir(join(repositoryRoot, "sample-app"), { recursive: true });
  const workflowPath = join(workspaceRoot, ".sdd", "story-driven-development.md");
  await mkdir(legacyHomeRoot, { recursive: true });
  await writeWorkspaceConfig(legacyHomeRoot, {
    version: 3,
    schema: "sdd-v3",
    skills: { directory: ".agents/skills" },
    planning: { root: planningRoot },
    repositories: { roots: { repos: repositoryRoot } },
    repositoryArtifacts: {
      epics: "docs/epics",
      adrs: "docs/adrs",
      audits: "docs/audits",
    },
    ideas: {
      sample: {
        status: "active",
        repositories: [{
          root: "repos",
          path: "sample-app",
          status: "active",
        }],
      },
    },
  });

  const output = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "setup",
    workspaceRoot,
    "--from-user",
    legacyHomeRoot,
    "--json",
  ]);
  const result = JSON.parse(output.stdout);
  const migrated = await readWorkspaceConfig(workspaceRoot);
  assert.equal(result.migrationSource, legacyHomeRoot);
  assert.equal(migrated.planning.root, "ideas");
  assert.equal(migrated.repositories.roots.repos, "repos");
  assert.equal(await pathExists(getWorkspaceConfigPath(legacyHomeRoot)), false);
  assert.equal(
    await readFile(workflowPath, "utf8"),
    await readFile(WORKFLOW_SOURCE_PATH, "utf8"),
  );
});

test("CLI setup parser exposes only workspace setup and explicit legacy migration", async () => {
  const output = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "--help",
  ]);
  assert.match(output.stdout, /sdd setup \[workspace-path\]/);
  assert.match(output.stdout, /--from-user <path>/);
  assert.match(output.stdout, /Configure options:\n  --workspace <path>/);
  assert.doesNotMatch(output.stdout, /--from-workspace|--legacy-workspace|user-level|~\/\.sdd/);

  for (const args of [
    ["setup", "--from-workspace", "", "--json"],
    ["init", "--legacy-workspace", "", "--json"],
  ]) {
    await assert.rejects(
      execFileAsync(process.execPath, [
        join(PACKAGE_ROOT, "bin", "sdd.js"),
        ...args,
      ]),
      (error) => {
        const cliError = JSON.parse(error.stderr).error;
        assert.equal(cliError.code, "USAGE");
        assert.match(cliError.message, /Unknown option/);
        return true;
      },
    );
  }
});

test("CLI rejects empty positional and option paths before authority discovery", async (t) => {
  const root = await createWorkspace("sdd-empty-cli-path-");
  const outside = join(root, "outside");
  const target = join(root, "target");
  await mkdir(outside, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));

  const cases = [
    ["setup positional", ["setup", ""]],
    ["setup --from-user", ["setup", target, "--from-user", ""]],
    ["setup --planning-root", ["setup", target, "--planning-root", ""]],
    ["setup --repository-root", ["setup", target, "--repository-root", ""]],
    ["setup --skills-dir", ["setup", target, "--skills-dir", ""]],
    ["init positional", ["init", ""]],
    ["init --workspace", ["init", target, "--workspace", ""]],
    ["configure positional", ["configure", ""]],
    ["configure --workspace", ["configure", "--workspace", ""]],
    ["configure --planning-root", ["configure", "--planning-root", ""]],
    ["configure --repository-root", ["configure", "--repository-root", ""]],
    ["update positional", ["update", ""]],
    ["update --workspace", ["update", "--workspace", ""]],
    ["doctor positional", ["doctor", ""]],
    ["doctor --workspace", ["doctor", "--workspace", ""]],
    ["context positional", ["context", ""]],
    ["context --workspace", ["context", "--workspace", ""]],
    ["status --workspace", ["status", "--workspace", ""]],
    ["validate --workspace", ["validate", "--workspace", ""]],
    ["validate --repo", ["validate", "--repo", ""]],
    ["epic create --workspace", ["epic", "create", "sample", "e001", "slug", "--workspace", ""]],
    ["epic create --repo", ["epic", "create", "sample", "e001", "slug", "--repo", ""]],
    ["change create --workspace", ["change", "create", "sample", "slug", "--workspace", ""]],
    ["change create --repo", ["change", "create", "sample", "slug", "--repo", ""]],
    [
      "change transition --workspace",
      ["change", "transition", "sample", "change-id", "--from", "planned", "--to", "in_progress", "--workspace", ""],
    ],
    ["change close --workspace", ["change", "close", "sample", "change-id", "--workspace", ""]],
  ];

  for (const [name, args] of cases) {
    await assert.rejects(
      execFileAsync(process.execPath, [
        join(PACKAGE_ROOT, "bin", "sdd.js"),
        ...args,
        "--json",
      ], { cwd: outside }),
      (error) => {
        const cliError = JSON.parse(error.stderr).error;
        assert.equal(cliError.code, "USAGE");
        assert.match(cliError.message, /non-empty path/);
        return true;
      },
      name,
    );
  }

  assert.equal(await pathExists(getWorkspaceConfigPath(outside)), false);
  assert.equal(await pathExists(target), false);
});

test("explicit workspace repository routing preserves invalid config diagnostics", async (t) => {
  const workspaceRoot = await createMappedWorkspace();
  const outside = await createWorkspace("sdd-invalid-routing-cwd-");
  await initWorkspace(workspaceRoot);
  const config = await readWorkspaceConfig(workspaceRoot);
  config.ideas.sample.repositories = "not-an-array";
  await writeFile(
    getWorkspaceConfigPath(workspaceRoot),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));

  await assert.rejects(
    execFileAsync(process.execPath, [
      join(PACKAGE_ROOT, "bin", "sdd.js"),
      "validate",
      "sample",
      "--repo",
      "sample-web",
      "--workspace",
      workspaceRoot,
      "--json",
    ], { cwd: outside }),
    (error) => {
      const cliError = JSON.parse(error.stderr).error;
      assert.equal(cliError.code, "INVALID_CONFIG");
      assert.notEqual(cliError.code, "UNEXPECTED_ERROR");
      return true;
    },
  );
});

test("commands do not discover a workspace from HOME or SDD_USER_HOME", async (t) => {
  const root = await createWorkspace("sdd-no-home-fallback-");
  const decoyHome = join(root, "home");
  const outside = join(root, "outside");
  await mkdir(decoyHome, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeWorkspaceConfig(decoyHome, await createInitialConfig(decoyHome));
  t.after(() => rm(root, { recursive: true, force: true }));

  const env = subprocessEnvForDecoyHome(decoyHome);
  await assert.rejects(
    execFileAsync(process.execPath, [
      join(PACKAGE_ROOT, "bin", "sdd.js"),
      "status",
      "--json",
    ], { cwd: outside, env }),
    (error) => {
      assert.match(error.stderr, /"code": "WORKSPACE_NOT_FOUND"/);
      return true;
    },
  );
});

test("CLI update with an explicit workspace leaves a populated decoy home unchanged", async (t) => {
  const fixture = await createExplicitWorkspaceWithDecoyHome(
    "sdd-explicit-update-no-home-",
  );
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  const workspaceRetiredSkill = "sdd-retired-explicit-workspace-fixture";
  const decoyRetiredSkill = "sdd-retired-decoy-home-fixture";
  const workspaceRetiredPath = await addRetiredManagedSkill(
    fixture.workspaceRoot,
    workspaceRetiredSkill,
  );
  const decoyRetiredPath = await addRetiredManagedSkill(
    fixture.decoyHome,
    decoyRetiredSkill,
  );
  const decoyBefore = await hashDirectory(fixture.decoyHome);

  const { stdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "update",
    "--workspace",
    fixture.workspaceRoot,
    "--json",
  ], { cwd: fixture.outside, env: fixture.env });
  const result = JSON.parse(stdout);

  assert.equal(result.command, "update");
  assert.equal(result.workspaceRoot, fixture.workspaceRoot);
  assert.ok(result.skills.actions.some(
    (entry) => entry.skillName === workspaceRetiredSkill && entry.action === "remove",
  ));
  assert.equal(await pathExists(workspaceRetiredPath), false);
  assert.equal(await pathExists(decoyRetiredPath), true);
  assert.equal(await hashDirectory(fixture.decoyHome), decoyBefore);
});

test("CLI lifecycle mutation with an explicit workspace leaves a populated decoy home unchanged", async (t) => {
  const fixture = await createExplicitWorkspaceWithDecoyHome(
    "sdd-explicit-lifecycle-no-home-",
  );
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const changeId = "2026-08-08-explicit-workspace-home-authority";
  await writeChange(fixture.workspaceRoot, "sample-web", changeId, "in_review");
  await writeChange(fixture.decoyHome, "sample-web", changeId, "proposed");
  const workspaceTasksPath = join(
    fixture.workspaceRoot,
    ".sdd",
    "changes",
    changeId,
    "tasks.md",
  );
  const workspaceTasksBefore = await readFile(workspaceTasksPath, "utf8");
  const decoyBefore = await hashDirectory(fixture.decoyHome);

  const { stdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "change",
    "transition",
    "sample",
    changeId,
    "--workspace",
    fixture.workspaceRoot,
    "--from",
    "in_review",
    "--to",
    "in_progress",
    "--json",
  ], { cwd: fixture.workspaceRoot, env: fixture.env });
  const result = JSON.parse(stdout);
  const workspaceTasksAfter = await readFile(workspaceTasksPath, "utf8");

  assert.equal(result.command, "change-transition");
  assert.equal(result.workspaceRoot, fixture.workspaceRoot);
  assert.notEqual(workspaceTasksAfter, workspaceTasksBefore);
  assert.match(workspaceTasksAfter, /^status: in_progress$/m);
  assert.equal(await hashDirectory(fixture.decoyHome), decoyBefore);
});

test("targetless CLI routes start from an explicit workspace instead of unrelated cwd", async (t) => {
  const fixture = await createExplicitWorkspaceWithDecoyHome(
    "sdd-explicit-targetless-start-",
  );
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const decoyBefore = await hashDirectory(fixture.decoyHome);
  const runJson = async (...args) => {
    const { stdout } = await execFileAsync(process.execPath, [
      join(PACKAGE_ROOT, "bin", "sdd.js"),
      ...args,
      "--workspace",
      fixture.workspaceRoot,
      "--json",
    ], { cwd: fixture.decoyHome, env: fixture.env });
    return JSON.parse(stdout);
  };

  const doctor = await runJson("doctor");
  const status = await runJson("status");
  const validation = await runJson("validate");
  const epic = await runJson(
    "epic",
    "create",
    "sample",
    "SAMPLE-E999",
    "explicit-workspace",
    "--repo",
    "sample-web",
    "--dry-run",
  );
  const created = await runJson(
    "change",
    "create",
    "sample",
    "explicit-workspace",
    "--repo",
    "sample-web",
    "--date",
    "2026-08-08",
    "--dry-run",
  );
  for (const result of [doctor, status, validation, epic, created]) {
    assert.equal(result.workspaceRoot, fixture.workspaceRoot);
  }
  assert.deepEqual(status.spaces.map((space) => space.spaceId), ["sample"]);

  const changeId = "2026-08-08-explicit-workspace-dry-run";
  await writeCanonicalChange(
    fixture.workspaceRoot,
    "sample-web",
    changeId,
    "in_review",
  );
  const transitioned = await runJson(
    "change",
    "transition",
    "sample",
    changeId,
    "--from",
    "in_review",
    "--to",
    "in_progress",
    "--dry-run",
  );
  const closed = await runJson(
    "change",
    "close",
    "sample",
    changeId,
    "--dry-run",
  );
  assert.equal(transitioned.workspaceRoot, fixture.workspaceRoot);
  assert.equal(closed.workspaceRoot, fixture.workspaceRoot);
  assert.equal(await hashDirectory(fixture.decoyHome), decoyBefore);
});

test("CLI init requires an owning workspace and creates only a portable repository contract", async (t) => {
  const root = await createWorkspace("sdd-repository-init-");
  const workspaceRoot = join(root, "workspace");
  const repositoryRoot = join(workspaceRoot, "repos", "sample-app");
  await mkdir(repositoryRoot, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(
    execFileAsync(process.execPath, [
      join(PACKAGE_ROOT, "bin", "sdd.js"),
      "init",
      repositoryRoot,
      "--workspace",
      workspaceRoot,
      "--json",
    ]),
    (error) => {
      assert.match(error.stderr, /"code": "WORKSPACE_NOT_INITIALIZED"/);
      return true;
    },
  );

  await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "setup",
    workspaceRoot,
    "--planning-root",
    "product/ideas",
    "--repository-root",
    "repos",
    "--yes",
    "--json",
  ]);

  const first = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "init",
    repositoryRoot,
    "--workspace",
    workspaceRoot,
    "--json",
  ]);
  const result = JSON.parse(first.stdout);
  assert.equal(result.mode, "repository");
  assert.equal(result.workspaceRoot, workspaceRoot);
  assert.equal(result.workspaceConfigPath, getWorkspaceConfigPath(workspaceRoot));
  assert.equal(result.createdRepositoryConfig, true);

  const repositoryConfig = await readRepositoryConfig(repositoryRoot);
  assert.equal(repositoryConfig.kind, "repository");
  assert.equal(repositoryConfig.id, "sample-app");
  assert.equal(repositoryConfig.artifacts.epics, "docs/epics");
  repositoryConfig.artifacts.epics = "specs/epics";
  await writeRepositoryConfig(repositoryRoot, repositoryConfig);

  const contextOutput = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "context",
    repositoryRoot,
    "--workspace",
    workspaceRoot,
    "--json",
  ]);
  const context = JSON.parse(contextOutput.stdout);
  assert.equal(context.workspaceRoot, workspaceRoot);
  assert.equal(context.workspaceConfigPath, getWorkspaceConfigPath(workspaceRoot));
  assert.equal(Object.hasOwn(context, "userRoot"), false);
  assert.equal(context.kind, "repository");
  assert.equal(context.repository.id, "sample-app");
  assert.equal(context.repository.artifacts.epics, "specs/epics");
  assert.equal(
    context.workflowPath,
    join(workspaceRoot, ".sdd", "story-driven-development.md"),
  );

  const changeOutput = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "change",
    "create",
    "sample-app",
    "repository-only-work",
    "--repo",
    repositoryRoot,
    "--date",
    "2026-07-14",
    "--workspace",
    workspaceRoot,
    "--dry-run",
    "--json",
  ], { cwd: repositoryRoot });
  const change = JSON.parse(changeOutput.stdout);
  assert.equal(change.workspaceRoot, workspaceRoot);
  assert.equal(change.path, ".sdd/changes/2026-07-14-repository-only-work");
  assert.equal(change.repositories[0].id, "sample-app");

  const second = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "init",
    repositoryRoot,
    "--workspace",
    workspaceRoot,
    "--json",
  ]);
  assert.equal(JSON.parse(second.stdout).createdRepositoryConfig, false);
});

test("CLI context keeps cwd as the target when --workspace supplies external ownership", async (t) => {
  const root = await createWorkspace("sdd-external-context-");
  const workspaceRoot = join(root, "workspace");
  const planningRoot = join(workspaceRoot, "product", "ideas", "sample");
  const externalRepositoriesRoot = join(root, "external-code");
  const repositoryRoot = join(externalRepositoriesRoot, "sample-app");
  await mkdir(planningRoot, { recursive: true });
  await mkdir(repositoryRoot, { recursive: true });
  await writeRepositoryConfig(repositoryRoot, createRepositoryConfig("sample-app"));
  await writeFile(
    join(planningRoot, "sample.md"),
    [
      "---",
      "repositories:",
      "  - path: ../external-code/sample-app",
      "    role: app",
      "---",
      "# Sample",
      "",
    ].join("\n"),
    "utf8",
  );
  await initWorkspace(workspaceRoot, {
    planningRoot: "product/ideas",
    repositoryRoots: [externalRepositoriesRoot],
  });
  const imported = await readWorkspaceConfig(workspaceRoot);
  assert.deepEqual(imported.ideas.sample.repositories, [{
    root: "external-code",
    path: "sample-app",
    role: "app",
    status: "active",
  }]);
  t.after(() => rm(root, { recursive: true, force: true }));

  const { stdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "context",
    "--workspace",
    workspaceRoot,
    "--json",
  ], { cwd: repositoryRoot });
  const context = JSON.parse(stdout);

  assert.equal(context.workspaceRoot, workspaceRoot);
  assert.equal(context.kind, "repository");
  assert.equal(context.repository.id, "sample-app");
});
test("Change-store helpers require an explicit workspace root", () => {
  assert.throws(
    () => getChangesRoot(),
    (error) => error instanceof SddError && error.code === "WORKSPACE_REQUIRED",
  );
});

test("Change-store listing rejects an internal alias at the fixed active root", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changesRoot = getChangesRoot(root);
  await rm(changesRoot, { recursive: true });
  await symlink(join(root, ".sdd"), changesRoot);

  await assert.rejects(
    () => listStoredChanges(root),
    (error) => error instanceof SddError
      && error.code === "UNSAFE_ARTIFACT_PATH"
      && error.details.length === 1
      && error.details[0] === ".sdd/changes",
  );
});

test("Change-store listing rejects an internal alias at the fixed closed-history root", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changesRoot = getChangesRoot(root);
  const closedRoot = join(changesRoot, "closed");
  await rm(closedRoot, { recursive: true });
  await symlink(changesRoot, closedRoot);

  await assert.rejects(
    () => listStoredChanges(root),
    (error) => error instanceof SddError
      && error.code === "UNSAFE_ARTIFACT_PATH"
      && error.details.length === 1
      && error.details[0] === ".sdd/changes/closed",
  );
});

test("Change-store listing rejects file and symlink swaps after directory inventory", async (t) => {
  for (const replacement of ["file", "symlink"]) {
    const root = await createMappedWorkspace();
    t.after(() => rm(root, { recursive: true, force: true }));
    await initWorkspace(root);
    const changesRoot = getChangesRoot(root);
    const changeId = `2026-08-09-${replacement}-swap`;
    const changePath = join(changesRoot, changeId);
    const symlinkTarget = join(changesRoot, ".swap-target");
    await mkdir(changePath);
    if (replacement === "symlink") await mkdir(symlinkTarget);
    let hookCalls = 0;

    await assert.rejects(
      () => listStoredChanges(root, {
        afterInventory: async () => {
          hookCalls += 1;
          await rm(changePath, { recursive: true });
          if (replacement === "file") {
            await writeFile(changePath, "not a Change directory\n", "utf8");
          } else {
            await symlink(symlinkTarget, changePath);
          }
        },
      }),
      (error) => error instanceof SddError
        && error.code === "UNSAFE_ARTIFACT_PATH"
        && error.details.length === 1
        && error.details[0] === `.sdd/changes/${changeId}`,
      `${replacement} replacement`,
    );
    assert.equal(hookCalls, 1);
    const replacementState = await lstat(changePath);
    assert.equal(
      replacement === "file"
        ? replacementState.isFile()
        : replacementState.isSymbolicLink(),
      true,
    );
  }
});

test("status and validate retry when a Change closes between root inventories", async (t) => {
  for (const consumer of ["status", "validate"]) {
    const root = await createMappedWorkspace();
    t.after(() => rm(root, { recursive: true, force: true }));
    await initWorkspace(root);
    const changeId = `2026-08-09-${consumer}-inventory-close`;
    await writeCanonicalChange(root, "sample-web", changeId, "in_review");
    const activePath = getActiveChangePath(changeId, root);
    const closedPath = getClosedChangePath(changeId, root);
    let hookCalls = 0;
    const afterClosedChangeInventory = async ({ attempt }) => {
      hookCalls += 1;
      if (attempt === 1) await rename(activePath, closedPath);
    };

    if (consumer === "status") {
      const result = await getStatus(root, "sample", { afterClosedChangeInventory });
      assert.equal(result.activeChanges.length, 0);
      assert.deepEqual(
        result.recentChanges.map((change) => change.changeId),
        [changeId],
      );
    } else {
      const result = await validateArtifacts(root, {
        spaceId: "sample",
        changeId,
        afterClosedChangeInventory,
      });
      assert.equal(result.summary.changes, 1);
      assert.equal(
        result.findings.some((finding) => finding.code === "ARTIFACT_NOT_FOUND"),
        false,
      );
    }
    assert.equal(hookCalls, 2);
  }
});

test("Change consumers retry when a stable inventory location closes before file reads", async (t) => {
  for (const consumer of ["status", "inspect", "validate", "doctor"]) {
    const root = await createMappedWorkspace();
    t.after(() => rm(root, { recursive: true, force: true }));
    await initWorkspace(root);
    const changeId = `2026-08-09-${consumer}-snapshot-close`;
    await writeCanonicalChange(root, "sample-web", changeId, "in_review");
    const activePath = getActiveChangePath(changeId, root);
    const closedPath = getClosedChangePath(changeId, root);
    let hookCalls = 0;
    const afterStoredChangesInventory = async ({ attempt }) => {
      hookCalls += 1;
      if (attempt === 1) await rename(activePath, closedPath);
    };

    if (consumer === "status") {
      const result = await getStatus(root, "sample", { afterStoredChangesInventory });
      assert.deepEqual(
        result.recentChanges.map((change) => change.changeId),
        [changeId],
      );
    } else if (consumer === "inspect") {
      const config = await readWorkspaceConfig(root);
      const findings = await inspectChangeStatuses(root, config, null, {
        afterStoredChangesInventory,
      });
      assert.equal(
        findings.some((finding) => /missing tasks\.md/i.test(finding.message)),
        false,
      );
    } else if (consumer === "validate") {
      const result = await validateArtifacts(root, {
        spaceId: "sample",
        changeId,
        afterStoredChangesInventory,
      });
      assert.equal(result.summary.changes, 1);
      assert.equal(
        result.findings.some((finding) =>
          ["ARTIFACT_NOT_FOUND", "MISSING_CHANGE_FILE"].includes(finding.code)),
        false,
      );
    } else {
      const result = await diagnoseWorkspace(root, { afterStoredChangesInventory });
      assert.equal(
        result.findings.some((finding) => /missing tasks\.md/i.test(finding.message)),
        false,
      );
    }
    assert.equal(await pathExists(activePath), false);
    assert.equal(await pathExists(closedPath), true);
    assert.equal(hookCalls, 2);
  }
});

test("Change consumers still report a stable missing required file", async (t) => {
  for (const consumer of ["status", "inspect", "validate", "doctor"]) {
    const root = await createMappedWorkspace();
    t.after(() => rm(root, { recursive: true, force: true }));
    await initWorkspace(root);
    const changeId = `2026-08-09-${consumer}-stable-missing`;
    await writeCanonicalChange(root, "sample-web", changeId, "in_progress");
    await rm(join(getActiveChangePath(changeId, root), "tasks.md"));

    if (consumer === "status") {
      await assert.rejects(
        () => getStatus(root, "sample"),
        (error) => error instanceof SddError && error.code === "INCOMPLETE_CHANGE",
      );
    } else if (consumer === "inspect") {
      const config = await readWorkspaceConfig(root);
      const findings = await inspectChangeStatuses(root, config);
      assert.equal(
        findings.some((finding) => /missing tasks\.md/i.test(finding.message)),
        true,
      );
    } else if (consumer === "validate") {
      const result = await validateArtifacts(root, {
        spaceId: "sample",
        changeId,
      });
      assert.equal(
        result.findings.some((finding) => finding.code === "MISSING_CHANGE_FILE"),
        true,
      );
    } else {
      const result = await diagnoseWorkspace(root);
      assert.equal(
        result.findings.some((finding) => /missing tasks\.md/i.test(finding.message)),
        true,
      );
    }
  }
});

test("all lifecycle operations route through one workspace Change store", async (t) => {
  const root = await createMappedWorkspace();
  const decoyHome = join(root, "home");
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);

  const created = await createChange(
    join(root, "code", "sample-web"),
    "sample",
    "central-routing",
    { date: "2026-08-07", repositories: ["sample-web"] },
  );
  const changeId = created.changeId;
  const centralPath = join(root, ".sdd", "changes", changeId);
  assert.equal(created.workspaceRoot, root);
  assert.equal(Object.hasOwn(created, "userRoot"), false);
  assert.equal(await pathExists(centralPath), true);
  assert.equal(await pathExists(join(decoyHome, ".sdd", "changes", changeId)), false);

  const lockPath = join(root, ".sdd", "mutation.lock");
  await writeFile(lockPath, "held\n", "utf8");
  await assert.rejects(
    () => transitionChange(join(root, "code", "sample-web"), "sample", changeId, {
      from: "proposed",
      to: "planned",
    }),
    (error) => error instanceof SddError
      && error.code === "OPERATION_IN_PROGRESS"
      && error.message.includes(lockPath),
  );
  await rm(lockPath);

  let transitioned;
  for (const [from, to] of [
    ["proposed", "planned"],
    ["planned", "in_progress"],
    ["in_progress", "in_review"],
  ]) {
    transitioned = await transitionChange(join(root, "code", "sample-web"), "sample", changeId, { from, to });
  }
  assert.equal(transitioned.workspaceRoot, root);
  assert.equal(Object.hasOwn(transitioned, "userRoot"), false);

  const status = await getStatus(root, "sample");
  assert.equal(status.workspaceRoot, root);
  assert.equal(Object.hasOwn(status, "userRoot"), false);
  assert.equal(status.activeChanges[0].changeId, changeId);
  const validation = await validateArtifacts(root, { spaceId: "sample", changeId });
  assert.equal(validation.workspaceRoot, root);
  assert.equal(Object.hasOwn(validation, "userRoot"), false);
  assert.equal(validation.summary.changes, 1);

  const closed = await closeChange(root, "sample", changeId);
  assert.equal(closed.workspaceRoot, root);
  assert.equal(Object.hasOwn(closed, "userRoot"), false);
  assert.equal(await pathExists(centralPath), false);
  assert.equal(await pathExists(join(root, ".sdd", "changes", "closed", changeId)), true);
});

test("repository init rejects concurrent first initialization without losing the winner", async (t) => {
  const root = await createWorkspace("sdd-concurrent-repository-init-");
  const workspaceRoot = join(root, "workspace");
  const repositoryRoot = join(workspaceRoot, "repos", "sample-app");
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(repositoryRoot, { recursive: true });
  await initWorkspace(workspaceRoot, {
    planningRoot: "ideas",
    repositoryRoots: ["repos"],
  });

  let overlapProven = false;
  await withWorkspaceMutationLock(repositoryRoot, async () => {
    overlapProven = true;
    await assert.rejects(
      () => initRepository(repositoryRoot, {
        repositoryId: "loser",
        workspaceRoot,
      }),
      (error) => error.code === "OPERATION_IN_PROGRESS",
    );
    assert.equal(await pathExists(getRepositoryConfigPath(repositoryRoot)), false);
  });
  assert.equal(overlapProven, true);

  const winner = await initRepository(repositoryRoot, {
    repositoryId: "winner",
    workspaceRoot,
  });
  const repositoryConfigPath = getRepositoryConfigPath(repositoryRoot);
  const expectedRepositoryRoot = join(root, "expected-repository");
  await mkdir(expectedRepositoryRoot, { recursive: true });
  await writeRepositoryConfig(
    expectedRepositoryRoot,
    createRepositoryConfig("winner"),
  );
  const expectedConfigBytes = await readFile(
    getRepositoryConfigPath(expectedRepositoryRoot),
  );

  assert.equal(winner.repositoryConfig.id, "winner");
  assert.equal((await readRepositoryConfig(repositoryRoot)).id, "winner");
  assert.deepEqual(await readFile(repositoryConfigPath), expectedConfigBytes);
  assert.equal(await pathExists(join(repositoryRoot, ".sdd", "mutation.lock")), false);
});

test("interactive setup asks for planning and repository roots", async (t) => {
  const root = await createWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  const questions = [];
  const responses = ["product/ideas", "apps, services"];

  const options = await collectSetupOptions(
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

test("interactive setup rejects a dangling config authority without prompting", async (t) => {
  const root = await createWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".sdd"), { recursive: true });
  await symlink(join(root, "missing-config.yaml"), getWorkspaceConfigPath(root));
  let prompted = false;

  await assert.rejects(
    collectSetupOptions(
      root,
      {},
      {
        interactive: true,
        ask: async () => {
          prompted = true;
          return "";
        },
      },
    ),
    (error) => error?.code === "UNSAFE_CONFIG_PATH",
  );
  assert.equal(prompted, false);
});

test("interactive setup accepts detected roots and skips explicitly configured questions", async (t) => {
  const root = await createWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "ideas"), { recursive: true });
  await mkdir(join(root, "code"), { recursive: true });
  const questions = [];

  const detected = await collectSetupOptions(
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
  const explicit = await collectSetupOptions(
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
  const original = await readWorkspaceConfig(root);
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
  assert.equal((await readWorkspaceConfig(root)).planning.root, "ideas");

  const result = await configureWorkspace(root, { acceptSuggestions: true });
  const configured = await readWorkspaceConfig(root);
  assert.equal(result.changed, true);
  assert.equal(configured.planning.root, "spaces/ideas");
  assert.deepEqual(configured.repositories.roots, { code: "spaces/code" });
  assert.deepEqual(configured.ideas, original.ideas);
  assert.deepEqual(configured.repositoryArtifacts, original.repositoryArtifacts);
  assert.equal((await diagnoseWorkspace(root)).findings.length, 0);
});

test("configure preserves a config that replaces its preflight snapshot before publish", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await moveWorkspaceRoots(root);
  const winner = await readWorkspaceConfig(root);
  winner.skills.directory = ".agents/concurrent-skills";

  let injected = false;
  await assert.rejects(
    configureWorkspace(root, {
      acceptSuggestions: true,
      beforeConfigPublish: async () => {
        injected = true;
        await writeWorkspaceConfig(root, winner);
      },
    }),
    (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
  );

  assert.equal(injected, true);
  assert.deepEqual(await readWorkspaceConfig(root), winner);
});

test("configure persists absolute contained replacements as portable relative paths", async (t) => {
  const workspaceRoot = await createMappedWorkspace();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  await initWorkspace(workspaceRoot);
  await moveWorkspaceRoots(workspaceRoot);

  const result = await configureWorkspace(workspaceRoot, {
    planningRoot: join(workspaceRoot, "spaces", "ideas"),
    repositoryRoots: { code: join(workspaceRoot, "spaces", "code") },
  });
  const configured = await readWorkspaceConfig(workspaceRoot);

  assert.equal(result.changed, true);
  assert.equal(result.planningRoot, "spaces/ideas");
  assert.deepEqual(result.repositoryRoots, { code: "spaces/code" });
  assert.equal(configured.planning.root, "spaces/ideas");
  assert.deepEqual(configured.repositories.roots, { code: "spaces/code" });
});

test("configure publishes distinct physical repository roots that resolve successfully", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await mkdir(join(root, "distinct-code", "sample-web"), { recursive: true });
  await addRepositoryRootMapping(root, "alternate", "old-code", "sample-web");

  const result = await configureWorkspace(root, {
    repositoryRoots: { alternate: "distinct-code" },
  });

  assert.equal(result.changed, true);
  assert.equal((await readWorkspaceConfig(root)).repositories.roots.alternate, "distinct-code");
  const context = await getWorkspaceContext(join(root, "distinct-code", "sample-web"));
  assert.equal(context.repository.resolvedPath, "distinct-code/sample-web");
});

test("configure rejects a symbolic-link alias with duplicate physical repository ownership", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await addRepositoryRootMapping(root, "alternate", "old-code", "sample-web");
  await symlink(join(root, "code"), join(root, "code-alias"), "dir");
  const configPath = getWorkspaceConfigPath(root);
  const before = await readFile(configPath, "utf8");

  await assert.rejects(
    configureWorkspace(root, {
      repositoryRoots: { alternate: "code-alias" },
    }),
    (error) => error instanceof SddError
      && error.code === "INVALID_CONFIG"
      && error.message === "Cannot resolve context with duplicate physical repository ownership."
      && error.details.length === 1,
  );

  assert.equal(await readFile(configPath, "utf8"), before);
});

test("configure rejects remapped artifact roots that resolve outside their repository", async (t) => {
  const root = await createMappedWorkspace();
  const external = await createWorkspace("sdd-configure-external-artifacts-");
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(external, { recursive: true, force: true }));
  await initWorkspace(root);
  const repositoryRoot = join(root, "distinct-code", "sample-web");
  await mkdir(join(repositoryRoot, "docs"), { recursive: true });
  await symlink(external, join(repositoryRoot, "docs", "epics"), "dir");
  await addRepositoryRootMapping(root, "alternate", "old-code", "sample-web");
  const configPath = getWorkspaceConfigPath(root);
  const before = await readFile(configPath, "utf8");

  await assert.rejects(
    configureWorkspace(root, {
      repositoryRoots: { alternate: "distinct-code" },
    }),
    (error) => error instanceof SddError && error.code === "UNSAFE_ARTIFACT_PATH",
  );

  assert.equal(await readFile(configPath, "utf8"), before);
});

test("runtime config validation rejects unknown keys", async () => {
  const workspaceConfig = await createInitialConfig("/workspace", {
    planningRoot: "planning",
    repositoryRoots: ["code"],
  });
  workspaceConfig.skills.unexpected = true;
  const findings = validateConfig(workspaceConfig);
  assert.ok(findings.some((finding) => finding.message.includes("skills contains unknown key")));

  const repositoryConfig = createRepositoryConfig("sample");
  repositoryConfig.unexpected = true;
  repositoryConfig.artifacts.activeChanges = "docs/changes";
  const repositoryFindings = validateRepositoryConfig(repositoryConfig);
  assert.ok(repositoryFindings.some((finding) =>
    finding.message.includes("Repository configuration contains unknown key")));
  assert.ok(repositoryFindings.some((finding) =>
    finding.message.includes("artifacts contains unknown key: activeChanges")));
});

test("runtime config validation rejects NUL path values without filesystem errors", async () => {
  const base = await createInitialConfig("/workspace", {
    planningRoot: "planning",
    repositoryRoots: ["code"],
  });
  base.ideas.sample = {
    status: "active",
    repositories: [{ root: "code", path: "sample-web", status: "active" }],
  };
  const cases = [
    (config) => { config.skills.directory = "skills\0escape"; },
    (config) => { config.planning.root = "ideas\0escape"; },
    (config) => { config.repositories.roots.code = "code\0escape"; },
    (config) => { config.repositoryArtifacts.epics = "docs/epics\0escape"; },
    (config) => { config.ideas.sample.planningPath = "sample\0escape"; },
    (config) => { config.ideas.sample.repositories[0].path = "sample-web\0escape"; },
  ];
  for (const mutate of cases) {
    const config = structuredClone(base);
    mutate(config);
    const findings = validateConfig(config);
    assert.ok(
      findings.some((finding) => finding.message.includes("NUL")),
      JSON.stringify(findings),
    );
  }

  const repositoryConfig = createRepositoryConfig("sample");
  repositoryConfig.artifacts.epics = "docs/epics\0escape";
  assert.ok(validateRepositoryConfig(repositoryConfig)
    .some((finding) => finding.message.includes("NUL")));
});

test("CLI update rejects malformed workspace paths before filesystem access", async (t) => {
  const writeMalformedConfig = async (root, config) => {
    await mkdir(join(root, ".sdd"), { recursive: true });
    await writeFile(
      getWorkspaceConfigPath(root),
      `${JSON.stringify(config, null, 2)}\n`,
      "utf8",
    );
  };
  const runUpdate = async (root) => {
    await assert.rejects(
      () => execFileAsync(process.execPath, [
        join(PACKAGE_ROOT, "bin", "sdd.js"),
        "update",
        root,
        "--json",
      ], { env: { ...process.env, SDD_WORKSPACE_ROOT: root } }),
      (error) => (
        typeof error.stderr === "string"
        && error.stderr.includes('"code": "INVALID_CONFIG"')
        && !error.stderr.includes('"code": "UNEXPECTED_ERROR"')
      ),
    );
  };

  const nulRoot = await createWorkspace("sdd-update-nul-config-");
  t.after(() => rm(nulRoot, { recursive: true, force: true }));
  const nulConfig = await createInitialConfig(nulRoot);
  nulConfig.planning.root = `ideas\0escape`;
  await writeMalformedConfig(nulRoot, nulConfig);
  await runUpdate(nulRoot);

  const typedRoot = await createWorkspace("sdd-update-typed-config-");
  t.after(() => rm(typedRoot, { recursive: true, force: true }));
  const typedConfig = await createInitialConfig(typedRoot);
  typedConfig.repositories.roots.code = 42;
  typedConfig.ideas.sample = {
    status: "active",
    repositories: [{ root: "code", path: "sample-web", status: "active" }],
  };
  await writeMalformedConfig(typedRoot, typedConfig);
  await runUpdate(typedRoot);

  const legacyRoot = await createWorkspace("sdd-update-legacy-typed-config-");
  t.after(() => rm(legacyRoot, { recursive: true, force: true }));
  await writeMalformedConfig(legacyRoot, {
    version: 1,
    schema: "sdd-v1",
    skills: { directory: ".agents/skills" },
    planning: { root: "ideas" },
    repositories: { roots: [42] },
    repositoryArtifacts: nulConfig.repositoryArtifacts,
    ideas: {},
  });
  await runUpdate(legacyRoot);
});


test("context rejects physical aliases claimed as different repositories", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await symlink(join(root, "code", "sample-web"), join(root, "code", "sample-web-alias"));
  const config = await readWorkspaceConfig(root);
  config.ideas.other = {
    status: "active",
    repositories: [{ path: "code/sample-web-alias", status: "active" }],
  };
  await writeWorkspaceConfig(root, config);

  await assert.rejects(
    () => getWorkspaceContext(join(root, "code", "sample-web")),
    (error) => error instanceof SddError
      && error.code === "INVALID_CONFIG"
      && error.details.some((detail) => detail.includes("already claimed")),
  );
});

test("validation rejects a central Change store symlinked outside its owner", async (t) => {
  const root = await createMappedWorkspace();
  const externalRoot = await createWorkspace("sdd-external-changes-");
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(externalRoot, { recursive: true, force: true }));
  await initWorkspace(root);
  await rm(join(root, ".sdd", "changes"), { recursive: true });
  await symlink(externalRoot, join(root, ".sdd", "changes"));

  const result = await validateArtifacts(root, { spaceId: "sample" });

  assert.equal(result.valid, false);
  assert.equal(result.summary.changes, 0);
  assert.ok(result.findings.some((finding) => finding.code === "UNSAFE_ARTIFACT_PATH"
    && finding.path === ".sdd/changes"));
});

test("validation inventories active and closed Change-shaped symbolic-link entries", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changesRoot = getChangesRoot(root);
  const closedRoot = join(changesRoot, "closed");
  const activeChangeId = "2026-08-09-active-symlink";
  const closedChangeId = "2026-08-08-closed-symlink";
  const activeTarget = join(changesRoot, ".active-symlink-target");
  const closedTarget = join(closedRoot, ".closed-symlink-target");
  await mkdir(activeTarget);
  await mkdir(closedTarget);
  await symlink(activeTarget, join(changesRoot, activeChangeId));
  await symlink(closedTarget, join(closedRoot, closedChangeId));

  const result = await validateArtifacts(root, { spaceId: "sample" });

  assert.equal(result.valid, false);
  assert.equal(result.summary.changes, 0);
  assert.deepEqual(
    result.findings
      .filter((finding) => finding.code === "UNSAFE_ARTIFACT_PATH")
      .map((finding) => finding.path),
    [
      `.sdd/changes/${activeChangeId}`,
      `.sdd/changes/closed/${closedChangeId}`,
    ],
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

test("CLI configure accepts --workspace from unrelated cwd and detects path replacements", async (t) => {
  const root = await createMappedWorkspace();
  const outside = await createWorkspace("sdd-configure-outside-");
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await initWorkspace(root);
  await moveWorkspaceRoots(root);

  const { stdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "configure",
    "--workspace",
    root,
    "--yes",
    "--json",
  ], { cwd: outside });
  const result = JSON.parse(stdout);

  assert.equal(result.command, "configure");
  assert.equal(result.workspaceRoot, root);
  assert.equal(result.workspaceConfigPath, getWorkspaceConfigPath(root));
  assert.equal(Object.hasOwn(result, "configPath"), false);

  assert.equal(result.changed, true);
  assert.equal(result.planningRoot, "spaces/ideas");
  assert.deepEqual(result.repositoryRoots, { code: "spaces/code" });
  assert.equal((await diagnoseWorkspace(root)).findings.length, 0);
});
test("configure rejects released legacy user configurations as operational authority", async (t) => {
  const root = await createWorkspace("sdd-configure-legacy-user-");
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [version, schema] of [
    [1, "sdd-user-v1"],
    [2, "sdd-user-v2"],
  ]) {
    const legacyUserRoot = join(root, `legacy-home-v${version}`);
    const versionOne = version === 1;
    await mkdir(join(legacyUserRoot, ".sdd"), { recursive: true });
    await writeFile(
      join(legacyUserRoot, ".sdd", "config.yaml"),
      `${JSON.stringify({
        kind: "user",
        version,
        schema,
        skills: { directory: ".agents/skills" },
        planning: {
          root: "planning",
          ...(versionOne ? { plannedChangesDirectory: "planned-changes" } : {}),
        },
        repositories: { roots: {} },
        repositoryArtifacts: versionOne
          ? {
              activeChanges: "docs/changes",
              closedChanges: "docs/changes/closed",
              epics: "docs/epics",
              adrs: "docs/adrs",
              audits: "docs/audits",
            }
          : {
              epics: "docs/epics",
              adrs: "docs/adrs",
              audits: "docs/audits",
            },
        ideas: {},
      }, null, 2)}\n`,
      "utf8",
    );

    await assert.rejects(
      () => inspectWorkspaceConfiguration(legacyUserRoot, {
        workspaceRoot: legacyUserRoot,
      }),
      (error) => error instanceof SddError
        && error.code === "LEGACY_USER_MIGRATION_REQUIRED",
    );
  }
});

test("repeated setup is idempotent and preserves unrelated skills", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".agents", "skills", "custom-skill"), { recursive: true });
  await writeFile(join(root, ".agents", "skills", "custom-skill", "SKILL.md"), "custom\n", "utf8");

  await initWorkspace(root);
  const second = await initWorkspace(root);

  assert.equal(second.createdWorkspaceConfig, false);
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

test("workspace update refuses to overwrite a locally modified managed workflow", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const workflowPath = join(root, ".sdd", "story-driven-development.md");
  const localSource = `${await readFile(workflowPath, "utf8")}\nlocal edit\n`;
  await writeFile(workflowPath, localSource, "utf8");

  await assert.rejects(
    () => updateWorkspace(root),
    (error) => error instanceof SddError && error.code === "WORKFLOW_CONFLICT",
  );
  assert.equal(await readFile(workflowPath, "utf8"), localSource);
});

test("update removes a retired skill only when it matches its managed hash", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const retiredPath = join(root, ".agents", "skills", "sdd-doctrine");
  await mkdir(retiredPath, { recursive: true });
  await writeFile(join(retiredPath, "SKILL.md"), "retired\n", "utf8");
  const lockPath = getWorkspaceInstallLockPath(root);
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
  const config = await readWorkspaceConfig(root);
  config.ideas.another = {
    planning: "another",
    repositories: [{ root: "code", path: "sample-web" }],
  };
  await writeWorkspaceConfig(root, config);

  const diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, false);
  assert.ok(
    diagnosis.findings.some((finding) =>
      finding.message.includes("claimed by both sample and another"),
    ),
  );
});

test("status preserves Changes when a mapped repository contract is absent", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await rm(getRepositoryConfigPath(join(root, "code", "sample-web")));
  const changeId = "2026-08-09-unavailable-repository";
  await writeChange(root, "sample-web", changeId, "in_progress");

  const diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, false);
  assert.ok(diagnosis.findings.some((finding) =>
    finding.level === "error"
      && finding.code === "REPOSITORY_ID_REQUIRED"
      && finding.message.includes("sample (code/sample-web)")));

  const jsonOutput = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "status",
    "--workspace",
    root,
    "--json",
  ], { cwd: root });
  const json = JSON.parse(jsonOutput.stdout);
  const [space] = json.spaces;
  assert.equal(space.activeChanges[0].changeId, changeId);
  assert.deepEqual(space.activeChanges[0].unresolvedRepositoryIds, ["sample-web"]);
  assert.deepEqual(space.unresolvedRepositoryIds, ["sample-web"]);
  assert.deepEqual(
    space.repositories.map((repository) => repository.id),
    ["sample-mobile"],
  );
  assert.ok(space.repositoryDiagnostics.some((diagnostic) =>
    diagnostic.code === "REPOSITORY_ID_REQUIRED"
      && diagnostic.repository === "code/sample-web"));

  const humanOutput = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "status",
    "--workspace",
    root,
  ], { cwd: root });
  assert.match(
    humanOutput.stdout,
    new RegExp(`Space Change: ${changeId} \\[in_progress\\] \\(sample-web\\)`),
  );
  assert.match(
    humanOutput.stdout,
    /Repository diagnostic \[REPOSITORY_ID_REQUIRED\]: Cannot resolve mapped repository code\/sample-web/,
  );
  assert.match(humanOutput.stdout, /Repository: code\/sample-mobile \[active\] \(mobile\)/);
});

test("doctor reports malformed repository YAML and an empty repository ID", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const repositoryRoot = join(root, "code", "sample-web");
  const repositoryConfigPath = getRepositoryConfigPath(repositoryRoot);
  await writeFile(repositoryConfigPath, "kind: repository\nversion: [\n", "utf8");

  let diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, false);
  assert.ok(diagnosis.findings.some((finding) =>
    finding.level === "error"
      && finding.code === "INVALID_YAML"
      && finding.message.includes("code/sample-web")));
  let status = await getStatus(root);
  assert.deepEqual(status.spaces[0].repositories.map((repository) => repository.id), ["sample-mobile"]);
  assert.ok(status.spaces[0].repositoryDiagnostics.some((diagnostic) =>
    diagnostic.code === "INVALID_YAML" && diagnostic.repository === "code/sample-web"));

  const emptyIdConfig = createRepositoryConfig("sample-web");
  emptyIdConfig.id = "";
  await writeRepositoryConfig(repositoryRoot, emptyIdConfig);
  diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, false);
  assert.ok(diagnosis.findings.some((finding) =>
    finding.level === "error"
      && finding.code === "INVALID_REPOSITORY_CONFIG"
      && finding.message.includes("Repository id must use lowercase letters")));
  status = await getStatus(root);
  assert.deepEqual(status.spaces[0].repositories.map((repository) => repository.id), ["sample-mobile"]);
  assert.ok(status.spaces[0].repositoryDiagnostics.some((diagnostic) =>
    diagnostic.code === "INVALID_REPOSITORY_CONFIG"
      && diagnostic.repository === "code/sample-web"));
});

test("explicit workspace commands reject a contained repository custom artifact escape", async (t) => {
  const root = await createMappedWorkspace();
  const outsideArtifacts = await createWorkspace("sdd-contained-artifact-escape-");
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(outsideArtifacts, { recursive: true, force: true }));
  await initWorkspace(root);

  const repositoryRoot = join(root, "code", "sample-web");
  await mkdir(
    join(outsideArtifacts, "epics", "OUTSIDE-E001", "epic.md"),
    { recursive: true },
  );
  await symlink(outsideArtifacts, join(repositoryRoot, "custom"), "dir");
  const repositoryConfig = createRepositoryConfig("sample-web");
  repositoryConfig.artifacts.epics = "custom/epics";
  await writeRepositoryConfig(repositoryRoot, repositoryConfig);

  await assertRepositoryArtifactCommandsReject(root, "sample-web", repositoryRoot);
  assert.equal(
    await pathExists(join(outsideArtifacts, "epics", "OUTSIDE-E001", "epic.md")),
    true,
  );
});

test("explicit workspace commands reject an external repository custom artifact escape", async (t) => {
  const root = await createMappedWorkspace();
  const externalRepository = await createWorkspace("sdd-external-artifact-repository-");
  const outsideArtifacts = await createWorkspace("sdd-external-artifact-escape-");
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(externalRepository, { recursive: true, force: true }));
  t.after(() => rm(outsideArtifacts, { recursive: true, force: true }));
  await initWorkspace(root);

  await mkdir(
    join(outsideArtifacts, "epics", "OUTSIDE-E001", "epic.md"),
    { recursive: true },
  );
  await symlink(outsideArtifacts, join(externalRepository, "custom"), "dir");
  const repositoryConfig = createRepositoryConfig("external-service");
  repositoryConfig.artifacts.epics = "custom/epics";
  await writeRepositoryConfig(externalRepository, repositoryConfig);
  const workspaceConfig = await readWorkspaceConfig(root);
  workspaceConfig.repositories.roots.external = externalRepository;
  workspaceConfig.ideas.sample.repositories = [{
    root: "external",
    path: ".",
    role: "service",
    status: "active",
  }];
  await writeWorkspaceConfig(root, workspaceConfig);

  await assertRepositoryArtifactCommandsReject(root, externalRepository, externalRepository);
  assert.equal(
    await pathExists(join(outsideArtifacts, "epics", "OUTSIDE-E001", "epic.md")),
    true,
  );
});

test("status validate and doctor reject physically overlapping custom artifact aliases", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);

  const repositoryRoot = join(root, "code", "sample-web");
  const sharedArtifacts = join(repositoryRoot, "shared-artifacts");
  const aliases = join(repositoryRoot, "artifact-aliases");
  await Promise.all([
    mkdir(sharedArtifacts, { recursive: true }),
    mkdir(aliases, { recursive: true }),
  ]);
  await Promise.all([
    symlink(sharedArtifacts, join(aliases, "epics"), "dir"),
    symlink(sharedArtifacts, join(aliases, "adrs"), "dir"),
  ]);
  const repositoryConfig = createRepositoryConfig("sample-web");
  repositoryConfig.artifacts.epics = "artifact-aliases/epics";
  repositoryConfig.artifacts.adrs = "artifact-aliases/adrs";
  await writeRepositoryConfig(repositoryRoot, repositoryConfig);

  await assertRepositoryArtifactCommandsReject(root, "sample-web");
});

test("status degrades duplicate portable repository IDs within a Space", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeRepositoryConfig(
    join(root, "code", "sample-mobile"),
    createRepositoryConfig("sample-web"),
  );

  const diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, false);
  assert.ok(diagnosis.findings.some((finding) =>
    finding.level === "error"
      && finding.code === "REPOSITORY_ID_COLLISION"
      && finding.message.includes("sample (code/sample-mobile), sample (code/sample-web)")));
  const changeId = "2026-08-09-duplicate-repository-id";
  await writeChange(root, "sample-web", changeId, "in_progress");
  const status = await getStatus(root);
  assert.deepEqual(status.spaces[0].repositories, []);
  assert.deepEqual(status.spaces[0].unresolvedRepositoryIds, ["sample-web"]);
  assert.equal(status.spaces[0].activeChanges[0].changeId, changeId);
  assert.ok(status.spaces[0].repositoryDiagnostics.some((diagnostic) =>
    diagnostic.code === "REPOSITORY_ID_COLLISION"
      && diagnostic.repositories.join(",") === "code/sample-mobile,code/sample-web"));
  const { stdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "status",
    "--workspace",
    root,
  ], { cwd: root });
  assert.match(stdout, new RegExp(`Space Change: ${changeId} \\[in_progress\\] \\(sample-web\\)`));
  assert.match(stdout, /Repository diagnostic \[REPOSITORY_ID_COLLISION\]/);
  assert.match(stdout, /Repositories: none/);
});

test("status degrades mapped paths that resolve to one physical repository", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await symlink("sample-web", join(root, "code", "sample-web-alias"), "dir");
  const config = await readWorkspaceConfig(root);
  config.ideas.sample.repositories.push({
    root: "code",
    path: "sample-web-alias",
    role: "alias",
  });
  await writeWorkspaceConfig(root, config);

  const diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, false);
  assert.ok(diagnosis.findings.some((finding) =>
    finding.level === "error"
      && finding.code === "REPOSITORY_OWNERSHIP_COLLISION"
      && finding.message.includes("sample (code/sample-web)")
      && finding.message.includes("sample (code/sample-web-alias)")));
  const doctorOutput = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "doctor",
    "--workspace",
    root,
    "--json",
  ], { cwd: root });
  const commandDiagnosis = JSON.parse(doctorOutput.stdout);
  assert.equal(commandDiagnosis.healthy, false);
  assert.ok(commandDiagnosis.findings.some((finding) =>
    finding.code === "REPOSITORY_OWNERSHIP_COLLISION"));
  const changeId = "2026-08-09-duplicate-repository-owner";
  await writeChange(root, "sample-web", changeId, "in_progress");
  const status = await getStatus(root);
  assert.deepEqual(
    status.spaces[0].repositories.map((repository) => repository.id),
    ["sample-mobile"],
  );
  assert.deepEqual(status.spaces[0].unresolvedRepositoryIds, ["sample-web"]);
  assert.ok(status.spaces[0].repositoryDiagnostics.some((diagnostic) =>
    diagnostic.code === "REPOSITORY_ID_COLLISION"));
  assert.ok(status.spaces[0].repositoryDiagnostics.some((diagnostic) =>
    diagnostic.code === "REPOSITORY_OWNERSHIP_COLLISION"));
  const commandOutput = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "status",
    "--workspace",
    root,
    "--json",
  ], { cwd: root });
  const commandStatus = JSON.parse(commandOutput.stdout);
  assert.equal(commandStatus.spaces[0].activeChanges[0].changeId, changeId);
  assert.deepEqual(commandStatus.spaces[0].unresolvedRepositoryIds, ["sample-web"]);
  assert.ok(commandStatus.spaces[0].repositoryDiagnostics.some((diagnostic) =>
    diagnostic.code === "REPOSITORY_OWNERSHIP_COLLISION"));
});

test("doctor resolves a mapped symlink to an external repository contract", async (t) => {
  const root = await createMappedWorkspace();
  const externalRepository = await createWorkspace("sdd-doctor-external-repository-");
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(externalRepository, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeRepositoryConfig(
    externalRepository,
    createRepositoryConfig("external-service"),
  );
  await symlink(
    externalRepository,
    join(root, "code", "external-service"),
    "dir",
  );
  const config = await readWorkspaceConfig(root);
  config.ideas.sample.repositories.push({
    root: "code",
    path: "external-service",
    role: "service",
  });
  await writeWorkspaceConfig(root, config);
  await writeChange(
    root,
    "external-service",
    "2026-07-14-external-service",
    "in_progress",
  );

  const diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, true);
  assert.equal(diagnosis.findings.some((finding) =>
    finding.code === "REPOSITORY_NOT_FOUND"), false);
});


test("doctor keeps an unavailable archived repository as a warning", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const config = await readWorkspaceConfig(root);
  config.ideas.sample.repositories[0].status = "archived";
  await writeWorkspaceConfig(root, config);
  await rm(join(root, "code", "sample-web"), { recursive: true });

  const diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, true);
  assert.ok(diagnosis.findings.some((finding) =>
    finding.level === "warning"
      && finding.message.includes("Repository for sample does not exist: code/sample-web")));
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
  assert.equal(diagnosis.workspaceRoot, root);
  assert.equal(diagnosis.workspaceConfigPath, getWorkspaceConfigPath(root));
  assert.equal(Object.hasOwn(diagnosis, "userRoot"), false);
  assert.equal(diagnosis.healthy, true);
});

test("doctor ignores obsolete guidance in archived repository mappings", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const config = await readWorkspaceConfig(root);
  config.ideas.sample.repositories[0].status = "archived";
  await writeWorkspaceConfig(root, config);
  await writeFile(
    join(root, "code", "sample-web", "AGENTS.md"),
    "Read `<workspaceRoot>/.sdd/story-driven-development.md`.\n",
    "utf8",
  );

  const diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, true);
});

test("doctor validates central Change metadata and status", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changePath = join(root, ".sdd", "changes", "2026-07-14-example");
  await mkdir(changePath, { recursive: true });
  await writeFile(join(changePath, "tasks.md"), "# Tasks\n", "utf8");

  let diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, false);
  assert.ok(diagnosis.findings.some((finding) => finding.message.includes("Cannot parse Change metadata")));

  await writeFile(
    join(changePath, "tasks.md"),
    "---\nstatus: in_progress\nspace: sample\nrepositories:\n  - sample-web\n---\n# Tasks\n",
    "utf8",
  );
  diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, true);

  await writeFile(
    join(changePath, "tasks.md"),
    "---\nstatus: review\nspace: sample\nrepositories:\n  - sample-web\n---\n# Tasks\n",
    "utf8",
  );
  diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, false);
  assert.ok(diagnosis.findings.some((finding) => finding.message.includes('"review"')));
});

test("doctor rejects a central Change with an unknown repository ID", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeChange(root, "ghost", "2026-07-14-unknown-repository", "in_progress");

  const diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, false);
  assert.ok(diagnosis.findings.some((finding) =>
    finding.level === "error"
      && finding.code === "REPOSITORY_NOT_FOUND"
      && finding.message.includes("repository ID ghost")
      && finding.message.includes("Space sample")));
  await assert.rejects(
    () => transitionChange(
      root,
      "sample",
      "2026-07-14-unknown-repository",
      { from: "in_progress", to: "in_review", dryRun: true },
    ),
    (error) => error instanceof SddError && error.code === "REPOSITORY_NOT_FOUND",
  );
});


test("closed Change state comes from central folder location and accepts historical statuses", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changePath = join(root, ".sdd", "changes", "closed", "2026-07-14-example");
  await mkdir(changePath, { recursive: true });
  await writeFile(
    join(changePath, "tasks.md"),
    "---\nstatus: closed\nspace: sample\nrepositories:\n  - sample-web\n---\n# Tasks\n",
    "utf8",
  );

  let diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, false);
  assert.ok(diagnosis.findings.some((finding) => finding.message.includes('"closed"')));

  await writeFile(
    join(changePath, "tasks.md"),
    "---\nstatus: ready_to_close\nspace: sample\nrepositories:\n  - sample-web\n---\n# Tasks\n",
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
  assert.ok(diagnosis.findings.some((finding) => finding.message.includes("migration is required")));
});

test("setup rejects layout overrides after configuration exists", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);

  await assert.rejects(
    () => initWorkspace(root, { planningRoot: "other-ideas" }),
    (error) => error instanceof SddError && error.code === "CONFIG_ALREADY_EXISTS",
  );
});


test("idea planning and repository paths support explicit project overrides", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await mkdir(join(root, "ideas", "custom-planning"), { recursive: true });
  await mkdir(join(root, "private", "external-planning"), { recursive: true });
  await mkdir(join(root, "integrations", "special-client"), { recursive: true });
  const config = await readWorkspaceConfig(root);
  config.ideas.sample.planning = "custom-planning";
  config.ideas.sample.repositories.push({
    path: "integrations/special-client",
    role: "integration-client",
  });
  config.ideas.external = {
    planningPath: "private/external-planning",
    repositories: [],
  };
  await writeWorkspaceConfig(root, config);

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

test("CLI context discovers regular files from their parent and rejects symbolic-link files", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const sourceRoot = join(root, "code", "sample-web", "src");
  const sourcePath = join(sourceRoot, "entry.js");
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(sourcePath, "export {};\n", "utf8");

  const { stdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "context",
    "code/sample-web/src/entry.js",
    "--json",
  ], { cwd: root });
  const context = JSON.parse(stdout);
  assert.equal(context.command, "context");
  assert.equal(context.workspaceRoot, root);
  assert.equal(context.relativePath, "code/sample-web/src/entry.js");
  assert.equal(context.kind, "repository");
  assert.equal(context.repository.id, "sample-web");

  const sourceAlias = join(sourceRoot, "entry-alias.js");
  const danglingAlias = join(sourceRoot, "dangling-alias.js");
  await symlink(sourcePath, sourceAlias);
  await symlink(join(sourceRoot, "absent.js"), danglingAlias);
  for (const alias of [sourceAlias, danglingAlias]) {
    await assert.rejects(
      execFileAsync(process.execPath, [
        join(PACKAGE_ROOT, "bin", "sdd.js"),
        "context",
        alias,
        "--json",
      ], { cwd: root }),
      (error) => {
        assert.match(error.stderr, /"code": "UNSAFE_CONFIG_PATH"/);
        return true;
      },
    );
  }
});

test("context rejects a repository-only ID that collides with an existing Idea", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const repositoryRoot = join(root, "code", "unmapped-repository");
  await mkdir(repositoryRoot, { recursive: true });
  await writeRepositoryConfig(repositoryRoot, createRepositoryConfig("sample"));
  const before = await readFile(getWorkspaceConfigPath(root), "utf8");

  await assert.rejects(
    () => getWorkspaceContext(repositoryRoot),
    (error) => error instanceof SddError && error.code === "REPOSITORY_ID_COLLISION",
  );
  assert.equal(await readFile(getWorkspaceConfigPath(root), "utf8"), before);
  assert.equal(await pathExists(join(repositoryRoot, "docs", "changes")), false);
});

test("status resolves central Changes for a repository-only checkout", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const repositoryRoot = join(root, "code", "repository-only-status");
  await mkdir(repositoryRoot, { recursive: true });
  await writeRepositoryConfig(repositoryRoot, createRepositoryConfig("repository-only-status"));
  const changeId = "2026-07-24-repository-only-status";
  const changePath = join(root, ".sdd", "changes", changeId);
  await mkdir(changePath, { recursive: true });
  await writeFile(
    join(changePath, "tasks.md"),
    "---\nstatus: in_progress\nspace: repository-only-status\nrepositories:\n  - repository-only-status\n---\n# Tasks\n",
    "utf8",
  );

  const result = await getStatus(repositoryRoot, "repository-only-status");

  assert.equal(result.change.changeId, changeId);
  assert.equal(result.repositoryActivity[0].activeChangeCount, 1);
  assert.equal(result.repositoryActivity[0].resolvedPath, repositoryRoot);
});

test("status and doctor reject a Change-shaped symbolic-link entry", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changesRoot = getChangesRoot(root);
  const changeId = "2026-08-09-status-symlink";
  const target = join(changesRoot, ".status-symlink-target");
  await mkdir(target);
  await symlink(target, join(changesRoot, changeId));

  const rejectsUnsafeEntry = (error) => error instanceof SddError
    && error.code === "UNSAFE_ARTIFACT_PATH"
    && error.details.length === 1
    && error.details[0] === `.sdd/changes/${changeId}`;
  await assert.rejects(() => getStatus(root), rejectsUnsafeEntry);
  await assert.rejects(() => diagnoseWorkspace(root), rejectsUnsafeEntry);
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

test("status retains Space-owned Changes whose repository IDs no longer resolve", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-08-07-stale-repository-target";
  await writeChange(root, "retired-repository", changeId, "in_progress");

  const result = await getStatus(root);
  const [space] = result.spaces;

  assert.equal(space.spaceId, "sample");
  assert.equal(space.activeChangeCount, 1);
  assert.equal(space.change.changeId, changeId);
  assert.deepEqual(space.unresolvedRepositoryIds, ["retired-repository"]);
  assert.deepEqual(
    space.activeChanges.map((change) => ({
      changeId: change.changeId,
      unresolvedRepositoryIds: change.unresolvedRepositoryIds,
    })),
    [{ changeId, unresolvedRepositoryIds: ["retired-repository"] }],
  );
  assert.ok(space.repositoryActivity.every((repository) => repository.activeChangeCount === 0));
  assert.deepEqual(statusSummaryRows(result).at(-1), [
    "sample",
    "active",
    "-",
    "unresolved",
    "in_progress",
    changeId,
    "retired-repository",
    0,
  ]);
});

test("status reports unresolved targets for a Change also projected by a healthy repository", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-08-08-mixed-repository-targets";
  await writeChange(root, "sample-web", changeId, "in_progress");
  const tasksPath = join(root, ".sdd", "changes", changeId, "tasks.md");
  const tasks = await readFile(tasksPath, "utf8");
  await writeFile(
    tasksPath,
    tasks.replace("  - sample-web\n", "  - sample-web\n  - retired-repository\n"),
    "utf8",
  );

  const result = await getStatus(root);
  assert.deepEqual(statusSummaryRows(result).filter((row) => row[5] === changeId), [
    ["sample", "active", "active", "web", "in_progress", changeId, "code/sample-web", 1],
    ["sample", "active", "-", "unresolved", "in_progress", changeId, "retired-repository", 0],
  ]);

  const { stdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "status",
    "--workspace",
    root,
  ], { cwd: root });
  assert.match(
    stdout,
    new RegExp(`Space Change: ${changeId} \\[in_progress\\] \\(retired-repository\\)`),
  );
  assert.match(stdout, new RegExp(`Active Change: ${changeId} \\[in_progress\\]`));
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
    untracked: 2,
    conflicted: 0,
  });
  assert.deepEqual(mobile.git, {
    available: true,
    branch: "main",
    head: null,
    detached: false,
    dirty: true,
    staged: 0,
    unstaged: 0,
    untracked: 1,
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
  ], { cwd: root });

  assert.equal(stdout.endsWith("\n\n"), true);
});

test("status filters inactive lifecycle entries unless all are requested", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeChange(root, "sample-web", "2026-07-10-web-active", "in_progress");
  await writeChange(root, "sample-mobile", "2026-07-11-mobile-active", "in_review");

  const config = await readWorkspaceConfig(root);
  config.ideas.sample.status = "inactive";
  config.ideas.sample.repositories[0].status = "archived";
  await writeWorkspaceConfig(root, config);

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
  await writeWorkspaceConfig(root, config);
  const filteredRepository = await getStatus(root);
  assert.equal(filteredRepository.spaces.length, 1);
  assert.deepEqual(
    filteredRepository.spaces[0].repositories.map((repository) => repository.resolvedPath),
    ["code/sample-mobile"],
  );
  assert.equal(filteredRepository.spaces[0].activeChangeCount, 2);
  assert.deepEqual(statusSummaryRows(filteredRepository), [
    ["sample", "active", "active", "mobile", "in_review", "2026-07-11-mobile-active", "code/sample-mobile", 1],
    ["sample", "active", "-", "space", "in_progress", "2026-07-10-web-active", "sample-web", 0],
  ]);

  const detail = await getStatus(root, "sample");
  assert.equal(detail.status, "active");
  assert.deepEqual(detail.repositories.map((repository) => repository.status), [
    "archived",
    "active",
  ]);
});

test("status retains a planning-only Change without repository targets", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const config = await readWorkspaceConfig(root);
  config.ideas.sample.repositories = [];
  await writeWorkspaceConfig(root, config);
  const changeId = "2026-07-14-planning-only";
  const changePath = join(root, ".sdd", "changes", changeId);
  await mkdir(changePath, { recursive: true });
  await writeFile(
    join(changePath, "tasks.md"),
    `---\nstatus: proposed\nspace: sample\nrepositories: []\n---\n# Tasks: Planning Only\n`,
    "utf8",
  );

  const result = await getStatus(root);
  assert.equal(result.spaces[0].activeChangeCount, 1);
  assert.equal(result.spaces[0].activeChanges[0].changeId, changeId);
  assert.deepEqual(statusSummaryRows(result), [
    ["sample", "active", "-", "space", "proposed", changeId, "-", 0],
  ]);
});

test("CLI status lists an active planning-only Change in human output", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-15-cli-planning-only";
  const changePath = join(root, ".sdd", "changes", changeId);
  await mkdir(changePath, { recursive: true });
  await writeFile(
    join(changePath, "tasks.md"),
    `---\nstatus: proposed\nspace: sample\nrepositories: []\n---\n# Tasks: Planning Only\n`,
    "utf8",
  );

  const { stdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "status",
    "--workspace",
    root,
  ], { cwd: root });

  assert.match(stdout, /Active Changes: 1/);
  assert.match(stdout, new RegExp(`Space Change: ${changeId} \\[proposed\\] \\(-\\)`));
  assert.equal(stdout.split(changeId).length - 1, 1);
});

test("CLI status lists an active Change whose only target is archived", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-16-cli-archived-target";
  await writeChange(root, "sample-web", changeId, "in_progress");
  const config = await readWorkspaceConfig(root);
  config.ideas.sample.repositories[0].status = "archived";
  await writeWorkspaceConfig(root, config);

  const { stdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "status",
    "--workspace",
    root,
  ], { cwd: root });

  assert.match(stdout, /Active Changes: 1/);
  assert.match(stdout, new RegExp(`Space Change: ${changeId} \\[in_progress\\] \\(sample-web\\)`));
  assert.equal(stdout.split(changeId).length - 1, 1);
});

test("CLI status lists a recent closed Change with no visible repository projection", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-17-cli-closed-stale-target";
  await writeChange(root, "retired-repository", changeId, "ready_to_close", {
    closed: true,
  });

  const { stdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "status",
    "--workspace",
    root,
  ], { cwd: root });

  assert.match(stdout, /Active Changes: 0/);
  assert.match(stdout, new RegExp(`Space Change: ${changeId} \\[closed\\] \\(retired-repository\\)`));
  assert.equal(stdout.split(changeId).length - 1, 1);
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
  ], { cwd: root });

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

test("explicit-repository Epic validation ignores unrelated missing repository identity", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await rename(join(root, "code", "sample-web"), join(root, "code", "web-app"));
  const config = await readWorkspaceConfig(root);
  const frontend = config.ideas.sample.repositories.find(
    (repository) => repository.path === "sample-web",
  );
  assert.ok(frontend);
  frontend.path = "web-app";
  await writeWorkspaceConfig(root, config);
  await writeRepositoryConfig(
    join(root, "code", "web-app"),
    createRepositoryConfig("frontend"),
  );
  await rm(getRepositoryConfigPath(join(root, "code", "sample-mobile")));

  const created = await createEpic(root, "sample", "SAMPLE-E002", "saved-searches", {
    date: "2026-07-14",
    repositories: ["code/web-app"],
  });
  assert.equal(created.validation.valid, true);
  assert.deepEqual(created.validation.scope.repositories, ["code/web-app"]);

  const { stdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "validate",
    "sample",
    "--epic",
    "SAMPLE-E002",
    "--repo",
    "frontend",
    "--workspace",
    root,
    "--json",
  ], { cwd: root });
  const targeted = JSON.parse(stdout);
  assert.equal(targeted.valid, true);
  assert.equal(targeted.summary.epics, 1);
  assert.deepEqual(targeted.scope.repositories, ["code/web-app"]);

  await assert.rejects(
    () => validateArtifacts(root, { spaceId: "sample" }),
    (error) => error instanceof SddError && error.code === "REPOSITORY_ID_REQUIRED",
  );
});

test("explicit Epic validation rejects a broken duplicate claim for the selected repository ID", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeCanonicalEpic(root, "sample-web");
  await writeRepositoryConfig(
    join(root, "code", "sample-web"),
    createRepositoryConfig("app"),
  );
  const brokenDuplicate = createRepositoryConfig("app");
  brokenDuplicate.artifacts.epics = "../outside";
  await writeRepositoryConfig(
    join(root, "code", "sample-mobile"),
    brokenDuplicate,
  );

  for (const repository of ["app", "code/sample-web"]) {
    await assert.rejects(
      () => validateArtifacts(root, {
        spaceId: "sample",
        repositories: [repository],
        epicId: "SAMPLE-E001",
      }),
      (error) => error instanceof SddError
        && error.code === "REPOSITORY_ID_COLLISION"
        && error.details.includes("code/sample-web")
        && error.details.includes("code/sample-mobile"),
    );
  }
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
  assert.match(releaseTemplate, /^## Aggregate Release Scope$/m);
  assert.match(releaseTemplate, /^## Repository Handoff: <repository-id>$/m);
  assert.match(releaseTemplate, /^### File Scope Reconciliation$/m);
  assert.match(releaseTemplate, /^### Remote Review Watermarks$/m);
  assert.match(releaseTemplate, /Cumulative release-candidate review required/);
  assert.match(releaseTemplate, /^### Documentation And SDD Integrity$/m);
  assert.match(releaseTemplate, /^## Cross-Repository Coordination$/m);
  assert.match(releaseTemplate, /^## Aggregate Closeout$/m);

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
  ], { cwd: root });
  const result = JSON.parse(stdout);

  assert.equal(result.command, "epic-create");
  assert.equal(result.workspaceRoot, root);
  assert.equal(Object.hasOwn(result, "userRoot"), false);
  assert.equal(result.epicId, "SAMPLE-E002");
  assert.equal(result.validation.valid, true);
});

test("change create scaffolds a planned Change for a selected repository", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);

  const result = await createChange(root, "sample", "mobile-notes-access", {
    date: "2026-07-14",
    repositories: ["code/sample-mobile"],
  });

  assert.equal(result.command, "change-create");
  assert.equal(result.changeId, "2026-07-14-mobile-notes-access");
  assert.equal(result.path, ".sdd/changes/2026-07-14-mobile-notes-access");
  assert.equal(result.repositories.length, 1);
  assert.equal(result.repositories[0].resolvedPath, "code/sample-mobile");
  assert.deepEqual(result.files, ["proposal.md", "design.md", "tasks.md"]);

  const changeRoot = join(root, result.path);
  const proposal = await readFile(join(changeRoot, "proposal.md"), "utf8");
  const design = await readFile(join(changeRoot, "design.md"), "utf8");
  const tasks = await readFile(join(changeRoot, "tasks.md"), "utf8");
  assert.match(proposal, /^# Proposal: Mobile Notes Access/m);
  assert.match(proposal, /Active lifecycle location: `<workspace>\/\.sdd\/changes\/2026-07-14-mobile-notes-access\/`/);
  assert.match(proposal, /`sample-mobile`/);
  assert.match(design, /^# Design: Mobile Notes Access/m);
  assert.match(tasks, /^---\nstatus: proposed\nspace: sample\nrepositories:\n  - sample-mobile\n---/);
  assert.equal(
    tasks.split("\n").find((line) => line.startsWith("- Expected dirty files:")),
    "- Expected dirty files: central Change `<workspace>/.sdd/changes/2026-07-14-mobile-notes-access/` plus repository-local implementation, Epic, ADR, test, and supporting-doc files grouped by target repository: `sample-mobile` (`code/sample-mobile`)",
  );
  assert.match(tasks, /run scoped `sdd validate`/i);
  assert.match(tasks, /run `sdd change close <space-id> <change-id>`/);
  assert.match(tasks, /^# Tasks: Mobile Notes Access/m);
  assert.doesNotMatch(`${proposal}\n${design}\n${tasks}`, /CHANGE TITLE|yyyy-mm-dd-change-name/);
});

test("change create renders one complete repository-keyed Expected dirty files line", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);

  const result = await createChange(root, "sample", "multi-repository-rendering", {
    date: "2026-07-14",
    repositories: ["sample-web", "sample-mobile"],
  });
  const tasks = await readFile(join(root, result.path, "tasks.md"), "utf8");

  assert.deepEqual(
    tasks.split("\n").filter((line) => line.startsWith("- Expected dirty files:")),
    [
      "- Expected dirty files: central Change `<workspace>/.sdd/changes/2026-07-14-multi-repository-rendering/` plus repository-local implementation, Epic, ADR, test, and supporting-doc files grouped by target repository: `sample-web` (`code/sample-web`), `sample-mobile` (`code/sample-mobile`)",
    ],
  );
});

test("change create skips archived repositories and rejects inactive Spaces", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);

  const config = await readWorkspaceConfig(root);
  for (const repository of config.ideas.sample.repositories) repository.status = "archived";
  await writeWorkspaceConfig(root, config);

  const planningOnly = await createChange(root, "sample", "replacement-planning", {
    date: "2026-07-14",
  });
  assert.deepEqual(planningOnly.repositories, []);

  config.ideas.sample.status = "inactive";
  await writeWorkspaceConfig(root, config);
  await assert.rejects(
    () => createChange(root, "sample", "inactive-work", { date: "2026-07-15" }),
    (error) => error instanceof SddError && error.code === "SPACE_NOT_ACTIVE",
  );
});

test("change create dry-run reports the planned Change without writing files", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);

  const result = await createChange(root, "sample", "dry-run-example", {
    date: "2026-07-14",
    repositories: ["sample-web"],
    dryRun: true,
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.path, ".sdd/changes/2026-07-14-dry-run-example");
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
  ], { cwd: root });
  const result = JSON.parse(stdout);

  assert.equal(result.command, "change-create");
  assert.equal(result.path, ".sdd/changes/2026-07-14-cli-example");
  assert.equal(result.repositories[0].resolvedPath, "code/sample-web");
});

test("CLI change create resolves a sole absolute repository selector from an explicit workspace", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const repositoryRoot = join(root, "code", "sample-web");
  const command = (slug, repository) => [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "change",
    "create",
    "sample",
    slug,
    "--workspace",
    root,
    "--repo",
    repository,
    "--date",
    "2026-08-09",
    "--dry-run",
    "--json",
  ];

  const { stdout } = await execFileAsync(
    process.execPath,
    command("absolute-repository", repositoryRoot),
    { cwd: tmpdir() },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.workspaceRoot, root);
  assert.equal(result.dryRun, true);
  assert.deepEqual(
    result.repositories.map((repository) => repository.resolvedPath),
    ["code/sample-web"],
  );
  assert.equal(await pathExists(join(root, result.path)), false);

  let selectionError;
  await assert.rejects(
    execFileAsync(
      process.execPath,
      command("unrelated-absolute-path", join(root, "ideas", "sample")),
      { cwd: tmpdir() },
    ),
    (error) => {
      selectionError = JSON.parse(error.stderr).error;
      return true;
    },
  );
  assert.equal(selectionError.code, "REPOSITORY_NOT_FOUND");
});

test("change create refuses to guess among multiple mapped repositories", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);

  await assert.rejects(
    () => createChange(root, "sample", "ambiguous-target", { date: "2026-07-14" }),
    (error) =>
      error instanceof SddError &&
      error.code === "REPOSITORY_REQUIRED" &&
      error.details.includes("Available repository: sample-web (code/sample-web)") &&
      error.details.includes("Available repository: sample-mobile (code/sample-mobile)"),
  );
});

test("change create infers a sole repository and refuses an existing Change", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const config = await readWorkspaceConfig(root);
  config.ideas.sample.repositories = [config.ideas.sample.repositories[0]];
  await writeWorkspaceConfig(root, config);

  const first = await createChange(root, "sample", "single-target", {
    date: "2026-07-14",
  });
  assert.equal(first.repositories[0].resolvedPath, "code/sample-web");

  await assert.rejects(
    () => createChange(root, "sample", "single-target", { date: "2026-07-14" }),
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
      () => createChange(root, "sample", slug, {
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
  await rm(join(root, ".sdd", "changes"), { recursive: true });
  await symlink(external, join(root, ".sdd", "changes"));

  await assert.rejects(
    () => createChange(root, "sample", "external-plan", {
      date: "2026-07-14",
      repositories: ["sample-web"],
    }),
    (error) => error instanceof SddError && error.code === "UNSAFE_ARTIFACT_PATH",
  );
  assert.deepEqual(await readdir(external), []);
});

test("change create rejects an internal alias at the fixed Change-store root without writing", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changesRoot = getChangesRoot(root);
  await rm(changesRoot, { recursive: true });
  await symlink(join(root, ".sdd"), changesRoot);
  const before = (await readdir(join(root, ".sdd"))).sort();
  const changeId = "2026-08-09-internal-alias";

  await assert.rejects(
    () => createChange(root, "sample", "internal-alias", {
      date: "2026-08-09",
      repositories: ["sample-web"],
    }),
    (error) => error instanceof SddError
      && error.code === "UNSAFE_ARTIFACT_PATH"
      && error.details.length === 1
      && error.details[0] === ".sdd/changes",
  );
  assert.equal(await pathExists(join(root, ".sdd", changeId)), false);
  assert.deepEqual((await readdir(join(root, ".sdd"))).sort(), before);
});

test("change create rejects unsafe slugs and impossible dates before writing", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);

  await assert.rejects(
    () =>
      createChange(root, "sample", "../outside", {
        date: "2026-07-14",
        repositories: ["sample-web"],
      }),
    (error) => error instanceof SddError && error.code === "INVALID_CHANGE_SLUG",
  );
  await assert.rejects(
    () =>
      createChange(root, "sample", "invalid-date", {
        date: "2026-02-30",
        repositories: ["sample-web"],
      }),
    (error) => error instanceof SddError && error.code === "INVALID_CHANGE_DATE",
  );
  assert.deepEqual(await readdir(join(root, ".sdd", "changes")), ["closed"]);
});










async function interruptCloseProcess(
  root,
  changeId,
  {
    hook = "afterCloseTransactionPhase",
    phase = null,
    kind = null,
    step = null,
    occurrence = 1,
  } = {},
) {
  const closeModule = pathToFileURL(
    join(PACKAGE_ROOT, "src", "commands", "change-close.js"),
  ).href;
  const source = `
    import { closeChange } from ${JSON.stringify(closeModule)};
    let occurrences = 0;
    const options = {};
    options[${JSON.stringify(hook)}] = (context = {}) => {
      if (${JSON.stringify(phase)} !== null && context.phase !== ${JSON.stringify(phase)}) return;
      if (${JSON.stringify(kind)} !== null && context.kind !== ${JSON.stringify(kind)}) return;
      if (${JSON.stringify(step)} !== null && context.step !== ${JSON.stringify(step)}) return;
      occurrences += 1;
      if (occurrences === ${occurrence}) process.exit(86);
    };
    await closeChange(
      ${JSON.stringify(root)},
      "sample",
      ${JSON.stringify(changeId)},
      options,
    );
  `;
  await assert.rejects(
    execFileAsync(process.execPath, ["--input-type=module", "--eval", source]),
    (error) => error.code === 86,
  );
}

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
  assert.equal(result.sourcePath, `.sdd/changes/${changeId}`);
  assert.equal(result.path, `.sdd/changes/closed/${changeId}`);
  assert.equal(await pathExists(join(root, result.sourcePath)), false);
  assert.equal(await pathExists(join(root, result.path)), true);
  assert.match(
    await readFile(join(root, result.path, "tasks.md"), "utf8"),
    /^status: in_review$/m,
  );
});

test("change close preserves restrictive directory modes through publication and cleanup", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-14-close-directory-modes";
  await writeChange(root, "sample-web", changeId, "in_review");
  const activePath = getActiveChangePath(changeId, root);
  const nestedPath = join(activePath, "evidence");
  await mkdir(nestedPath);
  await writeFile(join(nestedPath, "review.txt"), "reviewed\n", "utf8");
  await chmod(nestedPath, 0o555);
  await chmod(activePath, 0o555);

  await closeChange(root, "sample", changeId);

  const closedPath = getClosedChangePath(changeId, root);
  assert.equal((await lstat(closedPath)).mode & 0o777, 0o555);
  assert.equal((await lstat(join(closedPath, "evidence"))).mode & 0o777, 0o555);
  assert.equal(await readFile(join(closedPath, "evidence", "review.txt"), "utf8"), "reviewed\n");
  assert.equal(await pathExists(activePath), false);
  assert.deepEqual(await readdir(getChangesRoot(root)), ["closed"]);
});

test("change close recovers after interruption at every durable phase", async (t) => {
  const phases = [
    "prepared",
    "destination-claim-intent",
    "destination-copying",
    "destination-ready",
    "backup-claim-intent",
    "backup-copying",
    "backup-ready",
    "retiring-source",
    "source-retired",
    "verified",
    "cleaning-backup",
    "complete",
  ];

  for (const phase of phases) {
    await t.test(phase, async (t) => {
      const root = await createMappedWorkspace();
      t.after(() => rm(root, { recursive: true, force: true }));
      await initWorkspace(root);
      const changeId = `2026-07-14-close-crash-${phase}`;
      await writeChange(root, "sample-web", changeId, "in_review");
      const activePath = getActiveChangePath(changeId, root);
      const closedPath = getClosedChangePath(changeId, root);
      const tasksSource = await readFile(join(activePath, "tasks.md"), "utf8");

      await interruptCloseProcess(root, changeId, { phase });
      const result = await closeChange(root, "sample", changeId);

      assert.equal(result.path, `.sdd/changes/closed/${changeId}`);
      assert.equal(await pathExists(activePath), false);
      assert.equal(await readFile(join(closedPath, "tasks.md"), "utf8"), tasksSource);
      assert.deepEqual(await readdir(getChangesRoot(root)), ["closed"]);
    });
  }
});

test("change close retains terminal receipts when completed topology changes before retry", async (t) => {
  for (const mutation of ["active-reappears", "tasks-rewritten"]) {
    await t.test(mutation, async (t) => {
      const root = await createMappedWorkspace();
      t.after(() => rm(root, { recursive: true, force: true }));
      await initWorkspace(root);
      const changeId = `2026-07-14-close-complete-${mutation}`;
      await writeChange(root, "sample-web", changeId, "in_review");
      const activePath = getActiveChangePath(changeId, root);
      const closedPath = getClosedChangePath(changeId, root);

      await interruptCloseProcess(root, changeId, { phase: "complete" });
      const journalPath = getCloseTransactionJournalPath(root, changeId);
      const journalBytes = await readFile(journalPath);
      if (mutation === "active-reappears") {
        await mkdir(activePath);
        await writeFile(join(activePath, "tasks.md"), "concurrent active winner\n", "utf8");
      } else {
        await writeFile(join(closedPath, "tasks.md"), "concurrent closed tasks winner\n", "utf8");
      }

      await assert.rejects(
        () => closeChange(root, "sample", changeId),
        (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
      );

      assert.deepEqual(await readFile(journalPath), journalBytes);
      assert.equal(await pathExists(closedPath), true);
      if (mutation === "active-reappears") {
        assert.equal(
          await readFile(join(activePath, "tasks.md"), "utf8"),
          "concurrent active winner\n",
        );
      } else {
        assert.equal(
          await readFile(join(closedPath, "tasks.md"), "utf8"),
          "concurrent closed tasks winner\n",
        );
      }
    });
  }
});

test("change close recovers after interruption at every receipt bootstrap step", async (t) => {
  for (const step of ["intent", "proof", "staged", "visible"]) {
    await t.test(step, async (t) => {
      const root = await createMappedWorkspace();
      t.after(() => rm(root, { recursive: true, force: true }));
      await initWorkspace(root);
      const changeId = `2026-07-14-close-bootstrap-${step}`;
      await writeChange(root, "sample-web", changeId, "in_review");
      const activePath = getActiveChangePath(changeId, root);
      const closedPath = getClosedChangePath(changeId, root);
      const tasksSource = await readFile(join(activePath, "tasks.md"), "utf8");

      await interruptCloseProcess(root, changeId, {
        hook: "afterCloseReceiptInitializationStep",
        step,
      });
      const result = await closeChange(root, "sample", changeId);

      assert.equal(result.path, `.sdd/changes/closed/${changeId}`);
      assert.equal(await pathExists(activePath), false);
      assert.equal(await readFile(join(closedPath, "tasks.md"), "utf8"), tasksSource);
      assert.deepEqual(await readdir(getChangesRoot(root)), ["closed"]);
    });
  }
});

test("change close recovers after interruption inside each destructive tree operation", async (t) => {
  const cases = [
    { name: "destination-transfer", hook: "afterCloseTransferEntry", kind: "destination" },
    { name: "backup-transfer", hook: "afterCloseTransferEntry", kind: "backup" },
    {
      name: "destination-mode",
      hook: "afterCloseDirectoryModeMutation",
      kind: "destination",
    },
    { name: "backup-mode", hook: "afterCloseDirectoryModeMutation", kind: "backup" },
    { name: "source-retirement", hook: "afterCloseRetirementEntry" },
    { name: "backup-cleanup", hook: "afterCloseBackupCleanupEntry" },
    { name: "receipt-proof-cleanup", hook: "afterCloseReceiptProofCleanup" },
    {
      name: "visible-receipt-removal",
      hook: "beforeCloseReceiptRemovalMutation",
      kind: "visible",
    },
  ];

  for (const crashCase of cases) {
    await t.test(crashCase.name, async (t) => {
      const root = await createMappedWorkspace();
      t.after(() => rm(root, { recursive: true, force: true }));
      await initWorkspace(root);
      const changeId = `2026-07-14-close-crash-${crashCase.name}`;
      await writeChange(root, "sample-web", changeId, "in_review");
      const activePath = getActiveChangePath(changeId, root);
      const closedPath = getClosedChangePath(changeId, root);
      const tasksSource = await readFile(join(activePath, "tasks.md"), "utf8");

      await interruptCloseProcess(root, changeId, crashCase);
      await closeChange(root, "sample", changeId);

      assert.equal(await pathExists(activePath), false);
      assert.equal(await readFile(join(closedPath, "tasks.md"), "utf8"), tasksSource);
      assert.deepEqual(await readdir(getChangesRoot(root)), ["closed"]);
    });
  }
});

test("change close claims the closed destination without replacing a concurrent winner", async (t) => {
  const cases = [
    {
      name: "file",
      create: (root, path) => writeFile(path, "concurrent file\n", "utf8"),
      assertWinner: async (root, path) =>
        assert.equal(await readFile(path, "utf8"), "concurrent file\n"),
    },
    {
      name: "symlink",
      create: async (root, path) => {
        const target = join(root, "concurrent-symlink-target");
        await writeFile(target, "symlink target\n", "utf8");
        await symlink(target, path);
      },
      assertWinner: async (root, path) =>
        assert.equal(await readlink(path), join(root, "concurrent-symlink-target")),
    },
    {
      name: "empty-directory",
      create: (root, path) => mkdir(path),
      assertWinner: async (root, path) => assert.deepEqual(await readdir(path), []),
    },
    {
      name: "nonempty-directory",
      create: async (root, path) => {
        await mkdir(path);
        await writeFile(join(path, "winner.txt"), "concurrent directory\n", "utf8");
      },
      assertWinner: async (root, path) =>
        assert.equal(await readFile(join(path, "winner.txt"), "utf8"), "concurrent directory\n"),
    },
  ];

  for (const collision of cases) {
    await t.test(collision.name, async (t) => {
      const root = await createMappedWorkspace();
      t.after(() => rm(root, { recursive: true, force: true }));
      await initWorkspace(root);
      const changeId = `2026-07-14-close-${collision.name}-race`;
      await writeChange(root, "sample-web", changeId, "in_review");
      const activePath = getActiveChangePath(changeId, root);
      const closedPath = getClosedChangePath(changeId, root);
      const activeTasks = await readFile(join(activePath, "tasks.md"), "utf8");

      await assert.rejects(
        () => closeChange(root, "sample", changeId, {
          beforeDestinationClaim: () => collision.create(root, closedPath),
        }),
        (error) => error instanceof SddError
          && ["CONCURRENT_CHANGE", "MUTATION_RECOVERY_FAILED"].includes(error.code),
      );

      assert.equal(await readFile(join(activePath, "tasks.md"), "utf8"), activeTasks);
      await collision.assertWinner(root, closedPath);

      await rm(closedPath, { recursive: true, force: true });

      await closeChange(root, "sample", changeId);
      assert.equal(await pathExists(activePath), false);
      assert.equal(await readFile(join(closedPath, "tasks.md"), "utf8"), activeTasks);
    });
  }
});
test("change close preserves concurrent cleanup quarantine and payload winners", async (t) => {
  for (const collision of ["quarantine", "payload"]) {
    await t.test(collision, async (t) => {
      const root = await createMappedWorkspace();
      t.after(() => rm(root, { recursive: true, force: true }));
      await initWorkspace(root);
      const changeId = `2026-07-14-close-cleanup-${collision}`;
      await writeChange(root, "sample-web", changeId, "in_review");
      const activePath = getActiveChangePath(changeId, root);
      const tasksSource = await readFile(join(activePath, "tasks.md"), "utf8");
      let winnerPath = null;
      let injected = false;

      await assert.rejects(
        () => closeChange(root, "sample", changeId, {
          beforeCloseTreeQuarantineClaim: collision === "quarantine"
            ? async ({ field, quarantineRoot }) => {
                if (injected || field !== "sourceQuarantine") return;
                injected = true;
                winnerPath = quarantineRoot;
                await writeFile(winnerPath, "concurrent quarantine winner\n", "utf8");
              }
            : null,
          beforeCloseTreeQuarantineMove: collision === "payload"
            ? async ({ field, payload }) => {
                if (injected || field !== "sourceQuarantine") return;
                injected = true;
                winnerPath = payload;
                await mkdir(winnerPath);
              }
            : null,
        }),
        (error) => error instanceof SddError
          && ["CONCURRENT_CHANGE", "MUTATION_RECOVERY_FAILED"].includes(error.code),
      );

      if (collision === "quarantine") {
        assert.equal(await readFile(winnerPath, "utf8"), "concurrent quarantine winner\n");
        await rm(winnerPath, { force: true });
      } else {
        assert.deepEqual(await readdir(winnerPath), []);
        await rm(winnerPath, { recursive: true });
      }
      assert.equal(await readFile(join(activePath, "tasks.md"), "utf8"), tasksSource);

      await closeChange(root, "sample", changeId);
      assert.equal(await pathExists(activePath), false);
      assert.equal(
        await readFile(join(getClosedChangePath(changeId, root), "tasks.md"), "utf8"),
        tasksSource,
      );
    });
  }
});

test("change close rejects replacement of its claimed closed directory", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-14-close-claim-replacement";
  await writeChange(root, "sample-web", changeId, "in_review");
  const activePath = getActiveChangePath(changeId, root);
  const closedPath = getClosedChangePath(changeId, root);
  const displacedClaim = `${closedPath}.displaced-claim`;
  const activeTasks = await readFile(join(activePath, "tasks.md"), "utf8");
  const winner = "concurrent closed winner\n";

  await assert.rejects(
    () => closeChange(root, "sample", changeId, {
      afterDestinationClaim: async ({ destinationPath }) => {
        await rename(destinationPath, displacedClaim);
        await writeFile(destinationPath, winner, "utf8");
      },
    }),
    (error) => error instanceof SddError
      && ["CONCURRENT_CHANGE", "MUTATION_RECOVERY_FAILED"].includes(error.code),
  );

  assert.equal(await readFile(join(activePath, "tasks.md"), "utf8"), activeTasks);
  assert.equal(await readFile(closedPath, "utf8"), winner);
  assert.deepEqual(await readdir(displacedClaim), []);

  await rm(closedPath, { force: true });
  await rm(displacedClaim, { recursive: true });
  await closeChange(root, "sample", changeId);
  assert.equal(await readFile(join(closedPath, "tasks.md"), "utf8"), activeTasks);
});

test("change close exclusively claims its recovery backup before retiring the active Change", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-14-close-backup-claim-race";
  await writeChange(root, "sample-web", changeId, "in_review");
  const activePath = getActiveChangePath(changeId, root);
  const closedPath = getClosedChangePath(changeId, root);
  const tasksSource = await readFile(join(activePath, "tasks.md"), "utf8");
  let recoveryPath = null;
  let winnerIdentity = null;

  await assert.rejects(
    () => closeChange(root, "sample", changeId, {
      beforeBackupClaim: async ({ recoveryPath: claimedPath }) => {
        recoveryPath = claimedPath;
        await mkdir(recoveryPath);
        winnerIdentity = await lstat(recoveryPath, { bigint: true });
      },
    }),
    (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
  );

  const retainedWinner = await lstat(recoveryPath, { bigint: true });
  assert.equal(retainedWinner.dev, winnerIdentity.dev);
  assert.equal(retainedWinner.ino, winnerIdentity.ino);
  assert.deepEqual(await readdir(recoveryPath), []);
  assert.equal(await readFile(join(activePath, "tasks.md"), "utf8"), tasksSource);
  assert.equal(await pathExists(closedPath), false);

  await rm(recoveryPath, { recursive: true });
  await closeChange(root, "sample", changeId);
  assert.equal(await pathExists(activePath), false);
  assert.equal(await readFile(join(closedPath, "tasks.md"), "utf8"), tasksSource);
});

test("change close binds the active directory before its commit boundary", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-14-close-active-identity";
  await writeChange(root, "sample-web", changeId, "in_review");
  const activePath = getActiveChangePath(changeId, root);
  const originalPath = `${activePath}.original`;
  const tasksSource = await readFile(join(activePath, "tasks.md"), "utf8");

  await assert.rejects(
    () => closeChange(root, "sample", changeId, {
      beforeCommit: async () => {
        await rename(activePath, originalPath);
        await mkdir(activePath);
        await writeFile(join(activePath, "tasks.md"), tasksSource, "utf8");
      },
    }),
    (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
  );

  assert.equal(await readFile(join(activePath, "tasks.md"), "utf8"), tasksSource);
  assert.equal(await readFile(join(originalPath, "tasks.md"), "utf8"), tasksSource);
  assert.equal(await pathExists(getClosedChangePath(changeId, root)), false);
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
  assert.equal(await pathExists(join(root, ".sdd", "changes", changeId)), true);
  assert.equal(await pathExists(join(root, ".sdd", "changes", "closed", changeId)), false);
});

test("change close ignores an unrelated mapped repository without portable identity", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await rm(join(root, "code", "sample-web", ".sdd"), { recursive: true });

  const healthyChangeId = "2026-07-14-close-healthy-target";
  await writeChange(root, "sample-mobile", healthyChangeId, "in_review");
  const result = await closeChange(root, "sample", healthyChangeId);

  assert.deepEqual(result.repositories.map((repository) => repository.id), ["sample-mobile"]);
  assert.equal(await pathExists(join(root, ".sdd", "changes", "closed", healthyChangeId)), true);

  const unresolvedChangeId = "2026-07-14-close-unresolved-target";
  await writeChange(root, "sample-web", unresolvedChangeId, "in_review");
  await assert.rejects(
    () => closeChange(root, "sample", unresolvedChangeId),
    (error) => error instanceof SddError
      && error.code === "REPOSITORY_ID_REQUIRED"
      && error.details.includes("code/sample-web: REPOSITORY_ID_REQUIRED"),
  );
  assert.equal(await pathExists(join(root, ".sdd", "changes", unresolvedChangeId)), true);
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
  assert.equal(await pathExists(join(root, ".sdd", "changes", changeId)), true);
});


test("change close rechecks status at commit time", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-14-close-status-race";
  await writeChange(root, "sample-web", changeId, "in_review");
  const tasksPath = join(root, ".sdd", "changes", changeId, "tasks.md");
  const latestTasks = "---\nstatus: in_progress\nspace: sample\nrepositories:\n  - sample-web\n---\n# Tasks: reopened during close\n";

  await assert.rejects(
    () => closeChange(root, "sample", changeId, {
      beforeCommit: () => writeFile(tasksPath, latestTasks, "utf8"),
    }),
    (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
  );
  assert.equal(await readFile(tasksPath, "utf8"), latestTasks);
});

test("change close restores the active Change when post-move verification fails", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-14-close-verification-rollback";
  await writeChange(root, "sample-web", changeId, "in_review");
  const activePath = join(root, ".sdd", "changes", changeId);
  const closedPath = join(root, ".sdd", "changes", "closed", changeId);
  const changedTasks = "---\nstatus: in_progress\nspace: sample\nrepositories:\n  - sample-web\n---\n# Tasks: changed after move\n";

  await assert.rejects(
    () => closeChange(root, "sample", changeId, {
      afterMove: ({ destinationPath }) =>
        writeFile(join(destinationPath, "tasks.md"), changedTasks, "utf8"),
    }),
    (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
  );

  assert.equal(await readFile(join(activePath, "tasks.md"), "utf8"), changedTasks);
  assert.equal(await pathExists(closedPath), false);
});

test("change close reports both retained copies when the active Change reappears during recovery", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-14-close-recovery-race";
  await writeChange(root, "sample-web", changeId, "in_review");
  const activePath = join(root, ".sdd", "changes", changeId);
  const closedPath = join(root, ".sdd", "changes", "closed", changeId);
  const activeTasks = "---\nstatus: in_progress\nspace: sample\nrepositories:\n  - sample-web\n---\n# Tasks: concurrently reopened\n";
  const closedTasks = "---\nstatus: in_review\nspace: sample\nrepositories:\n  - sample-web\n---\n# Tasks: changed after close publication\n";

  await assert.rejects(
    () => closeChange(root, "sample", changeId, {
      afterMove: async ({ sourcePath, destinationPath }) => {
        await mkdir(sourcePath);
        await writeFile(join(sourcePath, "tasks.md"), activeTasks, "utf8");
        await writeFile(join(destinationPath, "tasks.md"), closedTasks, "utf8");
      },
    }),
    (error) => {
      assert.equal(error instanceof SddError, true);
      assert.equal(error.code, "MUTATION_RECOVERY_FAILED");
      assert.deepEqual(error.details, [
        `Original error: CONCURRENT_CHANGE: Change changed during close: .sdd/changes/${changeId}`,
        `Retained active Change: .sdd/changes/${changeId}`,
        `Retained closed Change: .sdd/changes/closed/${changeId}`,
      ]);
      return true;
    },
  );

  assert.equal(await readFile(join(activePath, "tasks.md"), "utf8"), activeTasks);
  assert.equal(await readFile(join(closedPath, "tasks.md"), "utf8"), closedTasks);
});

test("change close retries after a successful post-move rollback", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-14-close-rollback-retry";
  await writeChange(root, "sample-web", changeId, "in_review");
  const activePath = getActiveChangePath(changeId, root);
  const closedPath = getClosedChangePath(changeId, root);
  const tasksSource = await readFile(join(activePath, "tasks.md"), "utf8");

  await assert.rejects(
    () => closeChange(root, "sample", changeId, {
      afterMove: () => {
        throw new Error("injected post-move failure");
      },
    }),
    /injected post-move failure/,
  );
  assert.equal(await readFile(join(activePath, "tasks.md"), "utf8"), tasksSource);
  assert.equal(await pathExists(closedPath), false);

  await closeChange(root, "sample", changeId);
  assert.equal(await pathExists(activePath), false);
  assert.equal(await readFile(join(closedPath, "tasks.md"), "utf8"), tasksSource);
});

test("change close recovery never replaces a concurrent active entry", async (t) => {
  const cases = [
    {
      name: "file",
      create: (root, path) => writeFile(path, "concurrent active file\n", "utf8"),
      assertWinner: async (root, path) =>
        assert.equal(await readFile(path, "utf8"), "concurrent active file\n"),
    },
    {
      name: "symlink",
      create: async (root, path) => {
        const target = join(root, "concurrent-active-target");
        await writeFile(target, "active target\n", "utf8");
        await symlink(target, path);
      },
      assertWinner: async (root, path) =>
        assert.equal(await readlink(path), join(root, "concurrent-active-target")),
    },
    {
      name: "empty-directory",
      create: (root, path) => mkdir(path),
      assertWinner: async (root, path) => assert.deepEqual(await readdir(path), []),
    },
  ];

  for (const collision of cases) {
    await t.test(collision.name, async (t) => {
      const root = await createMappedWorkspace();
      t.after(() => rm(root, { recursive: true, force: true }));
      await initWorkspace(root);
      const changeId = `2026-07-14-close-recovery-${collision.name}`;
      await writeChange(root, "sample-web", changeId, "in_review");
      const activePath = getActiveChangePath(changeId, root);
      const closedPath = getClosedChangePath(changeId, root);
      const closedTasks = "---\nstatus: in_progress\nspace: sample\nrepositories:\n  - sample-web\n---\n# Tasks: changed after publication\n";

      await assert.rejects(
        () => closeChange(root, "sample", changeId, {
          afterMove: async ({ sourcePath, destinationPath }) => {
            await collision.create(root, sourcePath);
            await writeFile(join(destinationPath, "tasks.md"), closedTasks, "utf8");
          },
        }),
        (error) => error instanceof SddError && error.code === "MUTATION_RECOVERY_FAILED",
      );

      await collision.assertWinner(root, activePath);
      assert.equal(await readFile(join(closedPath, "tasks.md"), "utf8"), closedTasks);
      assert.deepEqual(
        (await readdir(getChangesRoot(root))).sort(),
        ["closed", changeId].sort(),
      );
    });
  }
});

test("change close recovery preserves a replacement of its active claim", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-14-close-recovery-claim-replacement";
  await writeChange(root, "sample-web", changeId, "in_review");
  const activePath = getActiveChangePath(changeId, root);
  const closedPath = getClosedChangePath(changeId, root);
  const displacedClaim = `${activePath}.displaced-claim`;
  const winner = "concurrent active winner\n";
  const changedTasks = "---\nstatus: in_progress\nspace: sample\nrepositories:\n  - sample-web\n---\n# Tasks: changed after publication\n";

  await assert.rejects(
    () => closeChange(root, "sample", changeId, {
      afterMove: ({ destinationPath }) =>
        writeFile(join(destinationPath, "tasks.md"), changedTasks, "utf8"),
      afterRecoveryClaim: async ({ sourcePath }) => {
        await rename(sourcePath, displacedClaim);
        await writeFile(sourcePath, winner, "utf8");
      },
    }),
    (error) => error instanceof SddError && error.code === "MUTATION_RECOVERY_FAILED",
  );

  assert.equal(await readFile(activePath, "utf8"), winner);
  assert.deepEqual(await readdir(displacedClaim), []);
  assert.equal(await readFile(join(closedPath, "tasks.md"), "utf8"), changedTasks);
  const recoveryEntries = (await readdir(getChangesRoot(root)))
    .filter((entry) => entry.startsWith(`.${changeId}.sdd-close-`));
  assert.equal(recoveryEntries.length, 1);
  assert.equal(
    await readFile(join(getChangesRoot(root), recoveryEntries[0], "tasks.md"), "utf8"),
    changedTasks,
  );
});

test("change close recovery preserves a same-byte closed replacement", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-14-close-closed-identity";
  await writeChange(root, "sample-web", changeId, "in_review");
  const activePath = getActiveChangePath(changeId, root);
  const closedPath = getClosedChangePath(changeId, root);
  const displacedClosedPath = `${closedPath}.owned`;
  const tasksSource = await readFile(join(activePath, "tasks.md"), "utf8");

  await assert.rejects(
    () => closeChange(root, "sample", changeId, {
      afterMove: async ({ destinationPath }) => {
        await rename(destinationPath, displacedClosedPath);
        await mkdir(destinationPath);
        await writeFile(join(destinationPath, "tasks.md"), tasksSource, "utf8");
      },
    }),
    (error) => error instanceof SddError && error.code === "MUTATION_RECOVERY_FAILED",
  );

  assert.equal(await readFile(join(activePath, "tasks.md"), "utf8"), tasksSource);
  assert.equal(await readFile(join(closedPath, "tasks.md"), "utf8"), tasksSource);
  assert.equal(await readFile(join(displacedClosedPath, "tasks.md"), "utf8"), tasksSource);
});

test("change close recovery does not trust a replaced closed child", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-14-close-closed-child-identity";
  await writeChange(root, "sample-web", changeId, "in_review");
  const activePath = getActiveChangePath(changeId, root);
  const closedPath = getClosedChangePath(changeId, root);
  const tasksSource = await readFile(join(activePath, "tasks.md"), "utf8");
  const displacedTasksPath = join(closedPath, "tasks.md.owned");

  await assert.rejects(
    () => closeChange(root, "sample", changeId, {
      afterMove: async ({ destinationPath }) => {
        await rename(join(destinationPath, "tasks.md"), displacedTasksPath);
        await writeFile(join(destinationPath, "tasks.md"), tasksSource, "utf8");
        throw new Error("injected after child replacement");
      },
    }),
    (error) => error instanceof SddError && error.code === "MUTATION_RECOVERY_FAILED",
  );

  assert.equal(await readFile(join(activePath, "tasks.md"), "utf8"), tasksSource);
  assert.equal(await readFile(join(closedPath, "tasks.md"), "utf8"), tasksSource);
  assert.equal(await readFile(displacedTasksPath, "utf8"), tasksSource);
});

test("change close preserves receipt quarantine collisions for every receipt file", async (t) => {
  for (const kind of ["proof", "staged", "intent", "visible"]) {
    await t.test(kind, async (t) => {
      const root = await createMappedWorkspace();
      t.after(() => rm(root, { recursive: true, force: true }));
      await initWorkspace(root);
      const changeId = `2026-07-14-close-receipt-collision-${kind}`;
      await writeChange(root, "sample-web", changeId, "in_review");
      const activePath = getActiveChangePath(changeId, root);
      const closedPath = getClosedChangePath(changeId, root);
      const tasksSource = await readFile(join(activePath, "tasks.md"), "utf8");
      let collisionPath = null;
      let injected = false;

      await assert.rejects(
        () => closeChange(root, "sample", changeId, {
          beforeCloseReceiptQuarantine: async (context) => {
            if (injected || context.kind !== kind) return;
            injected = true;
            collisionPath = context.quarantine;
            await writeFile(collisionPath, `${kind} concurrent quarantine\n`, "utf8");
          },
        }),
        (error) => error instanceof SddError
          && ["CONCURRENT_CHANGE", "MUTATION_RECOVERY_FAILED"].includes(error.code),
      );

      assert.equal(await readFile(collisionPath, "utf8"), `${kind} concurrent quarantine\n`);
      assert.equal(await pathExists(activePath), false);
      assert.equal(await readFile(join(closedPath, "tasks.md"), "utf8"), tasksSource);
      await rm(collisionPath, { force: true });
      const result = await closeChange(root, "sample", changeId);
      assert.equal(result.path, `.sdd/changes/closed/${changeId}`);
    });
  }
});

test("change close preserves receipt replacements after identity-bound quarantine", async (t) => {
  for (const kind of ["proof", "staged", "intent", "visible"]) {
    await t.test(kind, async (t) => {
      const root = await createMappedWorkspace();
      t.after(() => rm(root, { recursive: true, force: true }));
      await initWorkspace(root);
      const changeId = `2026-07-14-close-receipt-swap-${kind}`;
      await writeChange(root, "sample-web", changeId, "in_review");
      const activePath = getActiveChangePath(changeId, root);
      const closedPath = getClosedChangePath(changeId, root);
      const tasksSource = await readFile(join(activePath, "tasks.md"), "utf8");
      let quarantinePath = null;
      let authenticatedPath = null;
      let injected = false;

      await assert.rejects(
        () => closeChange(root, "sample", changeId, {
          afterCloseReceiptQuarantine: async (context) => {
            if (injected || context.kind !== kind) return;
            injected = true;
            quarantinePath = context.quarantine;
            authenticatedPath = `${context.quarantine}.authenticated`;
            await rename(context.quarantine, authenticatedPath);
            await writeFile(context.quarantine, `${kind} concurrent replacement\n`, "utf8");
          },
        }),
        (error) => error instanceof SddError
          && ["CONCURRENT_CHANGE", "MUTATION_RECOVERY_FAILED"].includes(error.code),
      );

      assert.equal(
        await readFile(quarantinePath, "utf8"),
        `${kind} concurrent replacement\n`,
      );
      assert.equal(await pathExists(authenticatedPath), true);
      assert.equal(await pathExists(activePath), false);
      assert.equal(await readFile(join(closedPath, "tasks.md"), "utf8"), tasksSource);
    });
  }
});

test("change close never unlinks a receipt path replaced after quarantine linking", async (t) => {
  for (const kind of ["proof", "staged", "intent", "visible"]) {
    await t.test(kind, async (t) => {
      const root = await createMappedWorkspace();
      t.after(() => rm(root, { recursive: true, force: true }));
      await initWorkspace(root);
      const changeId = `2026-07-14-close-receipt-canonical-swap-${kind}`;
      await writeChange(root, "sample-web", changeId, "in_review");
      const activePath = getActiveChangePath(changeId, root);
      const closedPath = getClosedChangePath(changeId, root);
      const tasksSource = await readFile(join(activePath, "tasks.md"), "utf8");
      let receiptPath = null;
      let authenticatedPath = null;
      let injected = false;

      await assert.rejects(
        () => closeChange(root, "sample", changeId, {
          beforeCloseReceiptRemovalMutation: async (context) => {
            if (injected
              || context.kind !== kind
              || context.action !== "remove-canonical") return;
            injected = true;
            receiptPath = context.path;
            authenticatedPath = `${context.path}.authenticated`;
            await rename(context.path, authenticatedPath);
            await writeFile(context.path, `${kind} concurrent canonical winner\n`, "utf8");
          },
        }),
        (error) => error instanceof SddError
          && ["CONCURRENT_CHANGE", "MUTATION_RECOVERY_FAILED"].includes(error.code),
      );

      assert.equal(
        await readFile(receiptPath, "utf8"),
        `${kind} concurrent canonical winner\n`,
      );
      assert.equal(await pathExists(authenticatedPath), true);
      assert.equal(await pathExists(activePath), false);
      assert.equal(await readFile(join(closedPath, "tasks.md"), "utf8"), tasksSource);
    });
  }
});

test("change close preserves same-inode receipt rewrites instead of adopting their bytes", async (t) => {
  for (const kind of ["proof", "staged", "intent", "visible"]) {
    await t.test(kind, async (t) => {
      const root = await createMappedWorkspace();
      t.after(() => rm(root, { recursive: true, force: true }));
      await initWorkspace(root);
      const changeId = `2026-07-14-close-receipt-rewrite-${kind}`;
      await writeChange(root, "sample-web", changeId, "in_review");
      const activePath = getActiveChangePath(changeId, root);
      const closedPath = getClosedChangePath(changeId, root);
      const tasksSource = await readFile(join(activePath, "tasks.md"), "utf8");
      const winner = `${kind} same-inode winner\n`;
      let receiptPath = null;
      let beforeIdentity = null;
      let afterIdentity = null;
      let injected = false;

      await assert.rejects(
        () => closeChange(root, "sample", changeId, {
          beforeCloseReceiptCleanup: async (context) => {
            if (injected || context.kind !== kind) return;
            injected = true;
            receiptPath = context.path;
            const before = await lstat(receiptPath);
            beforeIdentity = { dev: before.dev, ino: before.ino };
            await writeFile(receiptPath, winner, "utf8");
            const afterRewrite = await lstat(receiptPath);
            afterIdentity = { dev: afterRewrite.dev, ino: afterRewrite.ino };
          },
        }),
        (error) => error instanceof SddError
          && ["CONCURRENT_CHANGE", "MUTATION_RECOVERY_FAILED"].includes(error.code),
      );

      assert.deepEqual(afterIdentity, beforeIdentity);
      assert.equal(await readFile(receiptPath, "utf8"), winner);
      assert.equal(await pathExists(activePath), false);
      assert.equal(await readFile(join(closedPath, "tasks.md"), "utf8"), tasksSource);
    });
  }
});

async function interruptTransitionProcess(root, changeId, phase) {
  const transitionModule = pathToFileURL(
    join(PACKAGE_ROOT, "src", "commands", "change-transition.js"),
  ).href;
  const source = `
    import { transitionChange } from ${JSON.stringify(transitionModule)};
    await transitionChange(
      ${JSON.stringify(root)},
      "sample",
      ${JSON.stringify(changeId)},
      {
        from: "in_progress",
        to: "in_review",
        afterTransitionTransactionPhase: ({ phase: currentPhase }) => {
          if (currentPhase === ${JSON.stringify(phase)}) process.exit(87);
        },
        beforeCommit: () => {
          if (${JSON.stringify(phase)}.startsWith("rollback-")) {
            throw new Error("force rolled-back receipt cleanup");
          }
        },
        beforeTransitionTransactionPublish: () => {
          if (${JSON.stringify(phase)} === "journal-staged") process.exit(87);
        },
        afterTransitionReceiptStageCleanup: () => {
          if (${JSON.stringify(phase)} === "receipt-stage-cleaned") process.exit(87);
        },
        afterTransitionReceiptCleanup: ({ kind }) => {
          if (${JSON.stringify(phase)} === \`rollback-\${kind}-cleaned\`) process.exit(87);
        },
      },
    );
  `;
  await assert.rejects(
    execFileAsync(process.execPath, ["--input-type=module", "--eval", source]),
    (error) => error.code === 87,
  );
}

test("change transition updates an active Change with compare-and-set semantics", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-15-design-revision";
  await writeChange(root, "sample-web", changeId, "in_review");
  const tasksPath = join(root, ".sdd", "changes", changeId, "tasks.md");
  await chmod(tasksPath, 0o640);

  const result = await transitionChange(root, "sample", changeId, {
    repositories: ["sample-web"],
    from: "in_review",
    to: "in_progress",
  });

  assert.equal(result.command, "change-transition");
  assert.equal(result.tasksPath, `.sdd/changes/${changeId}/tasks.md`);
  assert.match(
    await readFile(join(root, result.tasksPath), "utf8"),
    /^status: in_progress$/m,
  );
  assert.equal((await lstat(tasksPath)).mode & 0o777, 0o640);
});

test("change transition rollback restores the original tasks mode", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-15-transition-mode-rollback";
  await writeCanonicalChange(root, "sample-web", changeId, "in_progress");
  const tasksPath = join(root, ".sdd", "changes", changeId, "tasks.md");
  await chmod(tasksPath, 0o604);
  const originalTasks = await readFile(tasksPath, "utf8");

  await assert.rejects(
    () => transitionChange(root, "sample", changeId, {
      repositories: ["sample-web"],
      from: "in_progress",
      to: "in_review",
      afterBackup: () => {
        throw new Error("injected transition mode failure");
      },
    }),
    /injected transition mode failure/,
  );

  assert.equal(await readFile(tasksPath, "utf8"), originalTasks);
  assert.equal((await lstat(tasksPath)).mode & 0o777, 0o604);
});

test("change transition recovers after process death at every durable phase", async (t) => {
  for (const phase of ["prepared", "backed-up", "source-retired", "published", "complete"]) {
    await t.test(phase, async (t) => {
      const root = await createMappedWorkspace();
      t.after(() => rm(root, { recursive: true, force: true }));
      await initWorkspace(root);
      const changeId = `2026-07-15-transition-crash-${phase}`;
      await writeCanonicalChange(root, "sample-web", changeId, "in_progress");
      const tasksPath = join(root, ".sdd", "changes", changeId, "tasks.md");

      await interruptTransitionProcess(root, changeId, phase);
      const diagnosis = await diagnoseWorkspace(root);
      assert.ok(diagnosis.findings.some((finding) =>
        finding.code === "CHANGE_TRANSITION_RECOVERY_REQUIRED"
        && finding.message.includes(changeId)));
      const result = await transitionChange(root, "sample", changeId, {
        repositories: ["sample-web"],
        from: "in_progress",
        to: "in_review",
      });

      assert.equal(result.command, "change-transition");
      assert.match(await readFile(tasksPath, "utf8"), /^status: in_review$/m);
      assert.equal(
        (await readdir(getChangesRoot(root)))
          .some((entry) => entry.includes("sdd-transition")),
        false,
      );
      assert.equal(
        (await readdir(dirname(tasksPath)))
          .some((entry) => entry.includes(".sdd-transition")
            || entry.includes(".sdd-backup")),
        false,
      );
    });
  }
});

test("change transition retries prepublication cleanup after process death between receipt removals", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-15-transition-receipt-cleanup-crash";
  await writeCanonicalChange(root, "sample-web", changeId, "in_progress");
  const tasksPath = join(root, ".sdd", "changes", changeId, "tasks.md");
  const originalTasks = await readFile(tasksPath, "utf8");

  await interruptTransitionProcess(root, changeId, "journal-staged");
  let receiptNames = await readdir(getChangesRoot(root));
  assert.equal(
    receiptNames.some((name) => name.includes(`${changeId}.sdd-transition-journal-stage-`)),
    true,
  );
  assert.equal(
    receiptNames.some((name) => name.includes(`${changeId}.sdd-transition-proof-`)),
    true,
  );

  await interruptTransitionProcess(root, changeId, "receipt-stage-cleaned");
  receiptNames = await readdir(getChangesRoot(root));
  assert.equal(
    receiptNames.some((name) => name.includes(`${changeId}.sdd-transition-journal-stage-`)),
    false,
  );
  assert.equal(
    receiptNames.some((name) => name.includes(`${changeId}.sdd-transition-proof-`)),
    true,
  );
  assert.equal(await readFile(tasksPath, "utf8"), originalTasks);

  const result = await transitionChange(root, "sample", changeId, {
    repositories: ["sample-web"],
    from: "in_progress",
    to: "in_review",
  });

  assert.equal(result.command, "change-transition");
  assert.match(await readFile(tasksPath, "utf8"), /^status: in_review$/m);
  assert.equal(
    (await readdir(getChangesRoot(root)))
      .some((name) => name.includes(`${changeId}.sdd-transition-`)),
    false,
  );
});

test("change transition retries rolled-back receipt cleanup after every removal", async (t) => {
  for (const cleanupKind of ["visible", "staged", "proof"]) {
    await t.test(cleanupKind, async (t) => {
      const root = await createMappedWorkspace();
      t.after(() => rm(root, { recursive: true, force: true }));
      await initWorkspace(root);
      const changeId = `2026-07-15-transition-rollback-cleanup-${cleanupKind}`;
      await writeCanonicalChange(root, "sample-web", changeId, "in_progress");
      const tasksPath = join(root, ".sdd", "changes", changeId, "tasks.md");
      const originalTasks = await readFile(tasksPath, "utf8");

      await interruptTransitionProcess(root, changeId, `rollback-${cleanupKind}-cleaned`);
      const receiptNames = await readdir(getChangesRoot(root));
      assert.equal(
        receiptNames.includes(`.${changeId}.sdd-transition-journal.jsonl`),
        false,
      );
      assert.equal(
        receiptNames.some((name) => name.includes(`${changeId}.sdd-transition-journal-stage-`)),
        cleanupKind === "visible",
      );
      assert.equal(
        receiptNames.some((name) => name.includes(`${changeId}.sdd-transition-proof-`)),
        cleanupKind !== "proof",
      );
      assert.equal(await readFile(tasksPath, "utf8"), originalTasks);

      const result = await transitionChange(root, "sample", changeId, {
        repositories: ["sample-web"],
        from: "in_progress",
        to: "in_review",
      });

      assert.equal(result.command, "change-transition");
      assert.match(await readFile(tasksPath, "utf8"), /^status: in_review$/m);
      assert.equal(
        (await readdir(getChangesRoot(root)))
          .some((name) => name.includes(`${changeId}.sdd-transition-`)),
        false,
      );
    });
  }
});

test("status recovers a published transition after process death", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-15-transition-status-recovery";
  await writeCanonicalChange(root, "sample-web", changeId, "in_progress");
  const tasksPath = join(root, ".sdd", "changes", changeId, "tasks.md");

  await interruptTransitionProcess(root, changeId, "published");
  const result = await getStatus(root, "sample");

  assert.equal(result.command, "status");
  assert.match(await readFile(tasksPath, "utf8"), /^status: in_review$/m);
  assert.equal(
    (await readdir(getChangesRoot(root)))
      .some((entry) => entry.includes("sdd-transition")),
    false,
  );
});

test("change transition removes only its publication when closed history wins after publish", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-15-transition-closed-after-publish";
  await writeCanonicalChange(root, "sample-web", changeId, "in_progress");
  const activeTasksPath = join(root, ".sdd", "changes", changeId, "tasks.md");
  const closedPath = join(root, ".sdd", "changes", "closed", changeId);
  const closedTasks = "---\nstatus: in_review\nspace: sample\nrepositories:\n  - sample-web\n---\n# Tasks: closed winner after publish\n";

  await assert.rejects(
    () => transitionChange(root, "sample", changeId, {
      repositories: ["sample-web"],
      from: "in_progress",
      to: "in_review",
      afterTransitionTransactionPhase: async ({ phase }) => {
        if (phase !== "published") return;
        await mkdir(closedPath, { recursive: true });
        await writeFile(join(closedPath, "tasks.md"), closedTasks, "utf8");
      },
    }),
    (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
  );

  assert.equal(await pathExists(activeTasksPath), false);
  assert.equal(await readFile(join(closedPath, "tasks.md"), "utf8"), closedTasks);
  assert.equal(
    (await readdir(getChangesRoot(root)))
      .some((entry) => entry.includes(`${changeId}.sdd-transition`)),
    true,
  );
});

test("change transition rejects an active Change through an external symlink ancestor", async (t) => {
  const root = await createMappedWorkspace();
  const external = await createWorkspace("sdd-cli-change-external-");
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(external, { recursive: true, force: true }));
  await initWorkspace(root);
  await rm(join(root, ".sdd", "changes"), { recursive: true });
  await symlink(external, join(root, ".sdd", "changes"));
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

test("an explicit workspace override ignores a nested unrelated workspace configuration", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-15-explicit-workspace";
  await writeCanonicalChange(root, "sample-web", changeId, "in_progress");
  const tasksPath = join(root, ".sdd", "changes", changeId, "tasks.md");
  const before = await readFile(tasksPath, "utf8");
  const nestedRoot = join(root, "code", "sample-web", "untrusted");
  const nestedConfig = await readWorkspaceConfig(root);
  nestedConfig.ideas.forged = {
    status: "active",
    repositories: [{ root: "code", path: "sample-web", status: "active" }],
  };
  await mkdir(nestedRoot, { recursive: true });
  await writeWorkspaceConfig(nestedRoot, nestedConfig);

  const inspection = await inspectWorkspaceConfiguration(nestedRoot, {
    workspaceRoot: root,
  });
  assert.equal(inspection.workspaceRoot, root);
  await assert.rejects(
    () => transitionChange(nestedRoot, "forged", changeId, {
      from: "in_progress",
      to: "in_review",
      workspaceRoot: root,
    }),
    (error) => error instanceof SddError && error.code === "SPACE_NOT_FOUND",
  );
  assert.equal(await readFile(tasksPath, "utf8"), before);
});

test("change transition preserves and can retry a concurrent pre-backup tasks edit", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-15-concurrent-transition";
  await writeCanonicalChange(root, "sample-web", changeId, "in_progress");
  const tasksPath = join(root, ".sdd", "changes", changeId, "tasks.md");
  const latestTasks = "---\nstatus: in_progress\nspace: sample\nrepositories:\n  - sample-web\n---\n# Tasks: concurrent latest edit\n";

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

  const retry = await transitionChange(root, "sample", changeId, {
    repositories: ["sample-web"],
    from: "in_progress",
    to: "in_review",
  });
  const retriedTasks = await readFile(tasksPath, "utf8");
  assert.equal(retry.command, "change-transition");
  assert.match(retriedTasks, /^status: in_review$/m);
  assert.match(retriedTasks, /# Tasks: concurrent latest edit/);
});

test("change transition rejects an identical-byte pre-backup inode replacement", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-15-identical-inode-transition-race";
  await writeCanonicalChange(root, "sample-web", changeId, "in_progress");
  const tasksPath = join(root, ".sdd", "changes", changeId, "tasks.md");
  const displacedPath = `${tasksPath}.displaced`;
  const originalTasks = await readFile(tasksPath, "utf8");

  await assert.rejects(
    () => transitionChange(root, "sample", changeId, {
      repositories: ["sample-web"],
      from: "in_progress",
      to: "in_review",
      beforeCommit: async () => {
        await rename(tasksPath, displacedPath);
        await writeFile(tasksPath, originalTasks, "utf8");
      },
    }),
    (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
  );
  assert.equal(await readFile(tasksPath, "utf8"), originalTasks);
  assert.equal(await readFile(displacedPath, "utf8"), originalTasks);
  assert.notEqual((await lstat(tasksPath)).ino, (await lstat(displacedPath)).ino);

  await transitionChange(root, "sample", changeId, {
    repositories: ["sample-web"],
    from: "in_progress",
    to: "in_review",
  });
  assert.match(await readFile(tasksPath, "utf8"), /^status: in_review$/m);
});

test("change transition classifies a pre-backup tasks disappearance as concurrent", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-15-pre-backup-disappearance";
  await writeCanonicalChange(root, "sample-web", changeId, "in_progress");
  const tasksPath = join(root, ".sdd", "changes", changeId, "tasks.md");
  const concurrentPath = `${tasksPath}.concurrent-move`;
  const originalTasks = await readFile(tasksPath, "utf8");

  await assert.rejects(
    () => transitionChange(root, "sample", changeId, {
      repositories: ["sample-web"],
      from: "in_progress",
      to: "in_review",
      beforeCommit: () => rename(tasksPath, concurrentPath),
    }),
    (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
  );

  assert.equal(await pathExists(tasksPath), false);
  assert.equal(await readFile(concurrentPath, "utf8"), originalTasks);
});

test("change transition preserves an opaque preexisting backup destination", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-15-backup-destination-race";
  await writeCanonicalChange(root, "sample-web", changeId, "in_progress");
  const tasksPath = join(root, ".sdd", "changes", changeId, "tasks.md");
  const originalTasks = await readFile(tasksPath, "utf8");
  const backupWinner = "opaque concurrent backup content\n";
  let plantedBackupPath;

  await assert.rejects(
    () => transitionChange(root, "sample", changeId, {
      repositories: ["sample-web"],
      from: "in_progress",
      to: "in_review",
      beforeCommit: ({ backupPath }) => {
        plantedBackupPath = backupPath;
        return writeFile(backupPath, backupWinner, "utf8");
      },
    }),
    (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
  );

  assert.equal(await readFile(tasksPath, "utf8"), originalTasks);
  assert.equal(await readFile(plantedBackupPath, "utf8"), backupWinner);

  await transitionChange(root, "sample", changeId, {
    repositories: ["sample-web"],
    from: "in_progress",
    to: "in_review",
  });
  assert.match(await readFile(tasksPath, "utf8"), /^status: in_review$/m);
  assert.equal(await readFile(plantedBackupPath, "utf8"), backupWinner);
});

test("change transition never publishes a staging path swapped to a symlink", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-15-staging-symlink-race";
  await writeCanonicalChange(root, "sample-web", changeId, "in_progress");
  const tasksPath = join(root, ".sdd", "changes", changeId, "tasks.md");
  const originalTasks = await readFile(tasksPath, "utf8");
  const externalPath = join(root, "concurrent-transition-staging");
  const concurrentSource = "concurrent staging content\n";
  await writeFile(externalPath, concurrentSource, "utf8");
  let temporaryPath;
  let ownedRetainedPath;

  await assert.rejects(
    () => transitionChange(root, "sample", changeId, {
      repositories: ["sample-web"],
      from: "in_progress",
      to: "in_review",
      afterTemporaryWrite: async ({ temporaryPath: path }) => {
        temporaryPath = path;
        ownedRetainedPath = `${path}.owned-by-transition`;
        await rename(path, ownedRetainedPath);
        await symlink(externalPath, path, "file");
      },
    }),
    (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
  );

  assert.equal((await lstat(temporaryPath)).isSymbolicLink(), true);
  assert.equal(await readFile(temporaryPath, "utf8"), concurrentSource);
  assert.match(await readFile(ownedRetainedPath, "utf8"), /^status: in_review$/m);
  assert.equal(await readFile(tasksPath, "utf8"), originalTasks);
});

test("change transition preserves a tasks edit published after backup and remains retryable", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-15-post-backup-transition-race";
  await writeCanonicalChange(root, "sample-web", changeId, "in_progress");
  const tasksPath = join(root, ".sdd", "changes", changeId, "tasks.md");
  const originalTasks = await readFile(tasksPath, "utf8");
  const latestTasks = "---\nstatus: in_progress\nspace: sample\nrepositories:\n  - sample-web\n---\n# Tasks: published after backup\n";
  let retainedBackupPath;

  await assert.rejects(
    () => transitionChange(root, "sample", changeId, {
      repositories: ["sample-web"],
      from: "in_progress",
      to: "in_review",
      afterBackup: async ({ backupPath }) => {
        retainedBackupPath = backupPath;
        assert.equal(await readFile(backupPath, "utf8"), originalTasks);
        await writeFile(tasksPath, latestTasks, "utf8");
      },
    }),
    (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
  );
  assert.equal(await readFile(tasksPath, "utf8"), latestTasks);
  assert.equal(await readFile(retainedBackupPath, "utf8"), originalTasks);

  const retry = await transitionChange(root, "sample", changeId, {
    repositories: ["sample-web"],
    from: "in_progress",
    to: "in_review",
  });
  const retriedTasks = await readFile(tasksPath, "utf8");
  assert.equal(retry.command, "change-transition");
  assert.match(retriedTasks, /^status: in_review$/m);
  assert.match(retriedTasks, /# Tasks: published after backup/);
  assert.equal(await readFile(retainedBackupPath, "utf8"), originalTasks);
  const retainedBackups = (await readdir(dirname(tasksPath)))
    .filter((entry) => entry.startsWith(".tasks.md.sdd-backup-"));
  assert.deepEqual(
    retainedBackups.map((entry) => join(dirname(tasksPath), entry)),
    [retainedBackupPath],
  );
});

test("change transition rejects a closed-location collision created after backup", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-15-post-backup-closed-race";
  await writeCanonicalChange(root, "sample-web", changeId, "in_progress");
  const tasksPath = join(root, ".sdd", "changes", changeId, "tasks.md");
  const originalTasks = await readFile(tasksPath, "utf8");
  const closedPath = join(root, ".sdd", "changes", "closed", changeId);
  const closedTasks = "---\nstatus: in_review\nspace: sample\nrepositories:\n  - sample-web\n---\n# Tasks: concurrently closed\n";
  let retainedBackupPath;

  await assert.rejects(
    () => transitionChange(root, "sample", changeId, {
      repositories: ["sample-web"],
      from: "in_progress",
      to: "in_review",
      afterBackup: async ({ backupPath }) => {
        retainedBackupPath = backupPath;
        await mkdir(closedPath, { recursive: true });
        await writeFile(join(closedPath, "tasks.md"), closedTasks, "utf8");
      },
    }),
    (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
  );

  assert.equal(await pathExists(tasksPath), false);
  assert.equal(await readFile(retainedBackupPath, "utf8"), originalTasks);
  assert.equal(await readFile(join(closedPath, "tasks.md"), "utf8"), closedTasks);
  assert.equal(
    (await readdir(getChangesRoot(root)))
      .some((entry) => entry.includes(`${changeId}.sdd-transition`)),
    true,
  );
});

test("change transition reports incomplete recovery when its backup is replaced", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-15-post-backup-recovery-race";
  await writeCanonicalChange(root, "sample-web", changeId, "in_progress");
  const tasksPath = join(root, ".sdd", "changes", changeId, "tasks.md");
  const originalTasks = await readFile(tasksPath, "utf8");
  const opaqueBackup = "opaque replacement backup\n";
  let backupPath;
  let retainedOriginalPath;

  await assert.rejects(
    () => transitionChange(root, "sample", changeId, {
      repositories: ["sample-web"],
      from: "in_progress",
      to: "in_review",
      afterBackup: async ({ backupPath: path }) => {
        backupPath = path;
        retainedOriginalPath = `${path}.retained-original`;
        await rename(path, retainedOriginalPath);
        await writeFile(path, opaqueBackup, "utf8");
        throw new Error("injected post-backup interruption");
      },
    }),
    (error) =>
      error instanceof SddError
      && error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.includes("Original error: injected post-backup interruption")
      && error.details.some((detail) => detail.includes(backupPath)),
  );

  assert.equal(await pathExists(tasksPath), false);
  assert.equal(await readFile(backupPath, "utf8"), opaqueBackup);
  assert.equal(await readFile(retainedOriginalPath, "utf8"), originalTasks);
});

test("change transition retains committed recovery when final tasks inspection fails", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-15-transition-final-inspection-error";
  await writeCanonicalChange(root, "sample-web", changeId, "in_progress");
  const tasksPath = join(root, ".sdd", "changes", changeId, "tasks.md");
  let backupPath;

  await assert.rejects(
    () => transitionChange(root, "sample", changeId, {
      repositories: ["sample-web"],
      from: "in_progress",
      to: "in_review",
      afterBackup: ({ backupPath: path }) => {
        backupPath = path;
      },
      inspectFinalTasks: async () => {
        throw Object.assign(new Error("injected tasks read failure"), { code: "EIO" });
      },
    }),
    (error) =>
      error instanceof SddError
      && error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes("injected tasks read failure")),
  );

  assert.match(await readFile(tasksPath, "utf8"), /^status: in_review$/m);
  assert.equal(await pathExists(backupPath), true);
  assert.equal(
    (await readdir(getChangesRoot(root)))
      .some((name) => name.includes(`${changeId}.sdd-transition-journal`)),
    true,
  );

  const retry = await transitionChange(root, "sample", changeId, {
    repositories: ["sample-web"],
    from: "in_progress",
    to: "in_review",
  });

  assert.equal(retry.command, "change-transition");
  assert.equal(await pathExists(backupPath), false);
  assert.equal(
    (await readdir(getChangesRoot(root)))
      .some((name) => name.includes(`${changeId}.sdd-transition-`)),
    false,
  );
});

test("change transition cleanup never deletes a concurrently swapped file", async (t) => {
  for (const cleanupKind of ["backup", "temporary"]) {
    for (const cleanupPhase of [
      "before-quarantine",
      "before-source-remove",
      "before-remove",
    ]) {
      const root = await createMappedWorkspace();
      t.after(() => rm(root, { recursive: true, force: true }));
      await initWorkspace(root);
      const changeId = `2026-07-15-${cleanupKind}-${cleanupPhase}-race`;
      await writeCanonicalChange(root, "sample-web", changeId, "in_progress");
      const tasksPath = join(root, ".sdd", "changes", changeId, "tasks.md");
      const concurrentSource = `concurrent ${cleanupKind} ${cleanupPhase} content\n`;
      let cleanupPath;
      let ownedRetainedPath;

      await assert.rejects(
        () => transitionChange(root, "sample", changeId, {
          repositories: ["sample-web"],
          from: "in_progress",
          to: "in_review",
          beforeCleanup: async ({ kind, phase, path }) => {
            if (kind !== cleanupKind || phase !== cleanupPhase) return;
            cleanupPath = path;
            ownedRetainedPath = `${path}.owned-by-transition`;
            await rename(path, ownedRetainedPath);
            await writeFile(path, concurrentSource, "utf8");
          },
        }),
        (error) =>
          error instanceof SddError
          && error.code === "MUTATION_RECOVERY_FAILED"
          && error.details.includes(`Concurrent content retained at ${cleanupPath}.`),
      );

      assert.equal(await readFile(cleanupPath, "utf8"), concurrentSource);
      assert.equal(await pathExists(ownedRetainedPath), true);
      assert.match(await readFile(tasksPath, "utf8"), /^status: in_review$/m);
    }
  }
});

test("change transition cleanup preserves an opaque quarantine destination", async (t) => {
  for (const cleanupKind of ["backup", "temporary"]) {
    const root = await createMappedWorkspace();
    t.after(() => rm(root, { recursive: true, force: true }));
    await initWorkspace(root);
    const changeId = `2026-07-15-${cleanupKind}-quarantine-claim-race`;
    await writeCanonicalChange(root, "sample-web", changeId, "in_progress");
    const tasksPath = join(root, ".sdd", "changes", changeId, "tasks.md");
    const quarantineWinner = `opaque ${cleanupKind} quarantine content\n`;
    let ownedCleanupPath;
    let plantedQuarantinePath;

    await assert.rejects(
      () => transitionChange(root, "sample", changeId, {
        repositories: ["sample-web"],
        from: "in_progress",
        to: "in_review",
        beforeCleanup: async ({ kind, phase, path, quarantinePath }) => {
          if (kind !== cleanupKind || phase !== "before-quarantine-claim") return;
          ownedCleanupPath = path;
          plantedQuarantinePath = quarantinePath;
          await writeFile(quarantinePath, quarantineWinner, "utf8");
        },
      }),
      (error) =>
        error instanceof SddError
        && error.code === "MUTATION_RECOVERY_FAILED"
        && error.details.includes(`Concurrent content retained at ${plantedQuarantinePath}.`),
    );

    assert.equal(await pathExists(ownedCleanupPath), true);
    assert.equal(await readFile(plantedQuarantinePath, "utf8"), quarantineWinner);
    assert.match(await readFile(tasksPath, "utf8"), /^status: in_review$/m);
  }
});

test("change transition preserves its primary collision when cleanup also races", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-15-primary-and-cleanup-race";
  await writeCanonicalChange(root, "sample-web", changeId, "in_progress");
  const tasksPath = join(root, ".sdd", "changes", changeId, "tasks.md");
  const latestTasks = "---\nstatus: in_progress\nspace: sample\nrepositories:\n  - sample-web\n---\n# Tasks: primary winner\n";
  const concurrentTemporary = "concurrent temporary cleanup content\n";
  let cleanupPath;
  let ownedRetainedPath;

  await assert.rejects(
    () => transitionChange(root, "sample", changeId, {
      repositories: ["sample-web"],
      from: "in_progress",
      to: "in_review",
      afterBackup: () => writeFile(tasksPath, latestTasks, "utf8"),
      beforeCleanup: async ({ kind, path }) => {
        if (kind !== "temporary") return;
        cleanupPath = path;
        ownedRetainedPath = `${path}.owned-by-transition`;
        await rename(path, ownedRetainedPath);
        await writeFile(path, concurrentTemporary, "utf8");
      },
    }),
    (error) =>
      error instanceof SddError
      && error.code === "CONCURRENT_CHANGE"
      && error.details.includes(
        `Cleanup recovery: Concurrent content retained at ${cleanupPath}.`,
      ),
  );

  assert.equal(await readFile(tasksPath, "utf8"), latestTasks);
  assert.equal(await readFile(cleanupPath, "utf8"), concurrentTemporary);
  assert.equal(await pathExists(ownedRetainedPath), true);
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
    await readFile(join(root, ".sdd", "changes", changeId, "tasks.md"), "utf8"),
    /^status: in_review$/m,
  );
});

test("change transition ignores an unrelated mapped repository without portable identity", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await rm(join(root, "code", "sample-web", ".sdd"), { recursive: true });

  const healthyChangeId = "2026-07-15-transition-healthy-target";
  await writeChange(root, "sample-mobile", healthyChangeId, "in_progress");
  const result = await transitionChange(root, "sample", healthyChangeId, {
    from: "in_progress",
    to: "in_review",
  });

  assert.deepEqual(result.repositories.map((repository) => repository.id), ["sample-mobile"]);
  assert.match(
    await readFile(join(root, ".sdd", "changes", healthyChangeId, "tasks.md"), "utf8"),
    /^status: in_review$/m,
  );

  const unresolvedChangeId = "2026-07-15-transition-unresolved-target";
  await writeChange(root, "sample-web", unresolvedChangeId, "in_progress");
  await assert.rejects(
    () => transitionChange(root, "sample", unresolvedChangeId, {
      from: "in_progress",
      to: "in_review",
    }),
    (error) => error instanceof SddError
      && error.code === "REPOSITORY_ID_REQUIRED"
      && error.details.includes("code/sample-web: REPOSITORY_ID_REQUIRED"),
  );
  assert.match(
    await readFile(join(root, ".sdd", "changes", unresolvedChangeId, "tasks.md"), "utf8"),
    /^status: in_progress$/m,
  );
});

test("change transition reports unknown and duplicate target identities deterministically", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);

  const unknownChangeId = "2026-07-15-transition-unknown-target";
  await writeChange(root, "missing-repository", unknownChangeId, "in_progress");
  await assert.rejects(
    () => transitionChange(root, "sample", unknownChangeId, {
      from: "in_progress",
      to: "in_review",
    }),
    (error) => error instanceof SddError
      && error.code === "REPOSITORY_NOT_FOUND"
      && error.details.includes("Available repository: sample-web (code/sample-web)")
      && error.details.includes("Available repository: sample-mobile (code/sample-mobile)"),
  );

  await writeRepositoryConfig(
    join(root, "code", "sample-web"),
    createRepositoryConfig("shared-app"),
  );
  await writeRepositoryConfig(
    join(root, "code", "sample-mobile"),
    createRepositoryConfig("shared-app"),
  );
  const duplicateChangeId = "2026-07-15-transition-duplicate-target";
  await writeChange(root, "shared-app", duplicateChangeId, "in_progress");
  await assert.rejects(
    () => transitionChange(root, "sample", duplicateChangeId, {
      from: "in_progress",
      to: "in_review",
    }),
    (error) => error instanceof SddError
      && error.code === "REPOSITORY_ID_COLLISION"
      && error.message === "Repository ID shared-app is claimed by multiple mapped repositories."
      && error.details[0] === "code/sample-web"
      && error.details[1] === "code/sample-mobile",
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
    "--from",
    "in_review",
    "--to",
    "in_progress",
    "--json",
  ], { cwd: root });
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
    "--json",
  ], { cwd: root });
  const result = JSON.parse(stdout);

  assert.equal(result.command, "change-close");
  assert.equal(result.repositories[0].resolvedPath, "code/sample-web");
  assert.equal(result.path, `.sdd/changes/closed/${changeId}`);
});

test("CLI exposes change command-group help", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "change",
    "--help",
  ]);

  assert.match(stdout, /sdd change create/);
  assert.doesNotMatch(stdout, /sdd change promote/);
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

test("explicit Change validation resolves only repositories declared by its central metadata", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await mkdir(join(root, "ideas", "other"), { recursive: true });
  await mkdir(join(root, "code", "other-web"), { recursive: true });
  const config = await readWorkspaceConfig(root);
  config.ideas.other = {
    status: "active",
    repositories: [{ root: "code", path: "other-web", status: "active" }],
  };
  await writeWorkspaceConfig(root, config);

  const changeId = "2026-08-09-authoritative-change-scope";
  await writeCanonicalChange(root, "sample-web", changeId, "in_progress");

  const { stdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "validate",
    "--change",
    changeId,
    "--repo",
    "code/sample-web",
    "--workspace",
    root,
    "--json",
  ], { cwd: root });
  const withoutSpace = JSON.parse(stdout);
  assert.equal(withoutSpace.valid, true);
  assert.equal(withoutSpace.summary.repositories, 1);
  assert.deepEqual(withoutSpace.scope.repositories, ["code/sample-web"]);

  const withOwningSpace = await validateArtifacts(root, {
    spaceId: "sample",
    changeId,
  });
  assert.equal(withOwningSpace.valid, true);
  assert.deepEqual(withOwningSpace.scope.repositories, ["code/sample-web"]);

  const withWrongSpace = await validateArtifacts(root, {
    spaceId: "other",
    changeId,
  });
  assert.equal(withWrongSpace.valid, false);
  assert.ok(withWrongSpace.findings.some((finding) =>
    finding.code === "CHANGE_SPACE_MISMATCH"
    && finding.spaceId === "other"));

  await assert.rejects(
    () => validateArtifacts(root, {
      repositories: ["code/sample-mobile"],
      changeId,
    }),
    (error) => error instanceof SddError && error.code === "REPOSITORY_NOT_FOUND",
  );
  await assert.rejects(
    () => validateArtifacts(root),
    (error) => error instanceof SddError && error.code === "REPOSITORY_ID_REQUIRED",
  );
});

test("validate scopes equal repository IDs by owning Space", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const sampleRepository = join(root, "code", "sample-web");
  const otherRepository = join(root, "code", "other-web");
  await writeRepositoryConfig(sampleRepository, createRepositoryConfig("app"));
  await mkdir(join(root, "ideas", "other"), { recursive: true });
  await mkdir(otherRepository, { recursive: true });
  await writeRepositoryConfig(otherRepository, createRepositoryConfig("app"));
  const config = await readWorkspaceConfig(root);
  config.ideas.other = {
    status: "active",
    repositories: [{ root: "code", path: "other-web", status: "active" }],
  };
  await writeWorkspaceConfig(root, config);

  await mkdir(join(sampleRepository, "docs", "epics", "sample-e999-missing"), {
    recursive: true,
  });
  await mkdir(join(otherRepository, "docs", "epics", "other-e999-missing"), {
    recursive: true,
  });

  const completeInventory = await validateArtifacts(root);
  assert.equal(completeInventory.summary.repositories, 3);
  assert.deepEqual(
    completeInventory.findings
      .filter((finding) => finding.code === "MISSING_EPIC_FILE")
      .map((finding) => ({
        spaceId: finding.spaceId,
        repository: finding.repository,
        path: finding.path,
      }))
      .sort((left, right) => left.spaceId.localeCompare(right.spaceId)),
    [
      {
        spaceId: "other",
        repository: "code/other-web",
        path: "code/other-web/docs/epics/other-e999-missing/epic.md",
      },
      {
        spaceId: "sample",
        repository: "code/sample-web",
        path: "code/sample-web/docs/epics/sample-e999-missing/epic.md",
      },
    ],
  );

  const selectedInventory = await validateArtifacts(root, {
    repositories: ["code/sample-web", "code/other-web"],
  });
  assert.equal(selectedInventory.summary.repositories, 2);
  assert.deepEqual(
    selectedInventory.findings
      .filter((finding) => finding.code === "MISSING_EPIC_FILE")
      .map((finding) => finding.repository)
      .sort(),
    ["code/other-web", "code/sample-web"],
  );

  const sampleChangeId = "2026-08-08-sample-app";
  const otherChangeId = "2026-08-08-other-app";
  await writeCanonicalChange(root, "app", sampleChangeId, "in_progress");
  await writeCanonicalChange(root, "app", otherChangeId, "in_progress");
  const otherTasksPath = join(root, ".sdd", "changes", otherChangeId, "tasks.md");
  await writeFile(
    otherTasksPath,
    (await readFile(otherTasksPath, "utf8")).replace("space: sample", "space: other"),
    "utf8",
  );
  const sampleProposalPath = join(root, ".sdd", "changes", sampleChangeId, "proposal.md");
  const otherProposalPath = join(root, ".sdd", "changes", otherChangeId, "proposal.md");
  await writeFile(
    sampleProposalPath,
    `${await readFile(sampleProposalPath, "utf8")}\n## Epic Actions\n\n### New Epic Directories\n\n- Create \`docs/epics/sample-e001-projected/epic.md\`.\n`,
    "utf8",
  );
  await writeFile(
    otherProposalPath,
    `${await readFile(otherProposalPath, "utf8")}\n## Epic Actions\n\n### New Epic Directories\n\n- Create \`docs/epics/other-e001-projected/epic.md\`.\n`,
    "utf8",
  );

  const sampleProjection = await validateArtifacts(root, { changeId: sampleChangeId });
  const otherProjection = await validateArtifacts(root, { changeId: otherChangeId });
  assert.equal(sampleProjection.summary.repositories, 1);
  assert.equal(otherProjection.summary.repositories, 1);
  assert.deepEqual(
    sampleProjection.findings
      .filter((finding) => finding.code === "AFFECTED_EPIC_NOT_FOUND")
      .map((finding) => ({
        spaceId: finding.spaceId,
        repository: finding.repository,
        path: finding.path,
      })),
    [{
      spaceId: "sample",
      repository: "code/sample-web",
      path: "code/sample-web/docs/epics/sample-e001-projected/epic.md",
    }],
  );
  assert.deepEqual(
    otherProjection.findings
      .filter((finding) => finding.code === "AFFECTED_EPIC_NOT_FOUND")
      .map((finding) => ({
        spaceId: finding.spaceId,
        repository: finding.repository,
        path: finding.path,
      })),
    [{
      spaceId: "other",
      repository: "code/other-web",
      path: "code/other-web/docs/epics/other-e001-projected/epic.md",
    }],
  );
});

test("validate rejects equal repository IDs within one Space", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeRepositoryConfig(
    join(root, "code", "sample-web"),
    createRepositoryConfig("app"),
  );
  await writeRepositoryConfig(
    join(root, "code", "sample-mobile"),
    createRepositoryConfig("app"),
  );

  await assert.rejects(
    () => validateArtifacts(root, { spaceId: "sample" }),
    (error) => error instanceof SddError
      && error.code === "REPOSITORY_ID_COLLISION"
      && /Repository ID app is claimed by multiple mapped repositories/.test(error.message),
  );
});

test("validate rejects absent and cross-Space Change repository IDs deterministically", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await mkdir(join(root, "ideas", "other"), { recursive: true });
  await mkdir(join(root, "code", "other-web"), { recursive: true });
  await writeRepositoryConfig(join(root, "code", "other-web"), createRepositoryConfig("other-web"));
  const config = await readWorkspaceConfig(root);
  config.ideas.other = {
    status: "active",
    repositories: [{ root: "code", path: "other-web", status: "active" }],
  };
  await writeWorkspaceConfig(root, config);

  const changeId = "2026-08-07-invalid-repository-ownership";
  await writeCanonicalChange(root, "sample-web", changeId, "in_progress");
  const tasksPath = join(root, ".sdd", "changes", changeId, "tasks.md");
  await writeFile(
    tasksPath,
    (await readFile(tasksPath, "utf8")).replace(
      "  - sample-web",
      "  - other-web\n  - missing-repository",
    ),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    changeId,
  });
  const repositoryFindings = result.findings.filter(
    (finding) => finding.code === "REPOSITORY_NOT_FOUND",
  );

  assert.equal(result.valid, false);
  assert.equal(result.summary.changes, 1);
  assert.deepEqual(
    repositoryFindings.map((finding) => ({
      repositoryId: finding.repositoryId,
      spaceId: finding.spaceId,
      path: finding.path,
      message: finding.message,
    })),
    [
      {
        repositoryId: "missing-repository",
        spaceId: "sample",
        path: `.sdd/changes/${changeId}/tasks.md`,
        message: "Change references repository ID missing-repository, which is not owned by Space sample.",
      },
      {
        repositoryId: "other-web",
        spaceId: "sample",
        path: `.sdd/changes/${changeId}/tasks.md`,
        message: "Change references repository ID other-web, which is not owned by Space sample.",
      },
    ],
  );
});

test("validate rejects a central Change owned by an unknown Space", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-08-07-unknown-space";
  await writeCanonicalChange(root, "sample-web", changeId, "proposed");
  const tasksPath = join(root, ".sdd", "changes", changeId, "tasks.md");
  await writeFile(
    tasksPath,
    (await readFile(tasksPath, "utf8")).replace(
      "space: sample\nrepositories:\n  - sample-web",
      "space: deleted-space\nrepositories: []",
    ),
    "utf8",
  );

  const result = await validateArtifacts(root);
  assert.equal(result.valid, false);
  assert.equal(result.summary.changes, 1);
  assert.deepEqual(
    result.findings
      .filter((finding) => finding.code === "SPACE_NOT_FOUND")
      .map((finding) => ({
        spaceId: finding.spaceId,
        path: finding.path,
        message: finding.message,
      })),
    [{
      spaceId: "deleted-space",
      path: `.sdd/changes/${changeId}/tasks.md`,
      message: "Change references unknown Space ID deleted-space.",
    }],
  );
});

test("change-scoped validation includes Epic paths declared by the Change", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-14-affected-epic";
  await writeCanonicalChange(root, "sample-web", changeId, "in_review");
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  const changePath = join(root, ".sdd", "changes", changeId);
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
  const proposalPath = join(root, ".sdd", "changes", changeId, "proposal.md");
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

test("change-scoped Epic IDs resolve once across all declared repositories", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-08-09-cross-repository-affected-epic";
  await writeCanonicalChange(root, "sample-web", changeId, "in_review");
  const tasksPath = join(root, ".sdd", "changes", changeId, "tasks.md");
  await writeFile(
    tasksPath,
    (await readFile(tasksPath, "utf8")).replace(
      "  - sample-web",
      "  - sample-web\n  - sample-mobile",
    ),
    "utf8",
  );
  await writeCanonicalEpic(root, "sample-web");
  const proposalPath = join(root, ".sdd", "changes", changeId, "proposal.md");
  await writeFile(
    proposalPath,
    `${await readFile(proposalPath, "utf8")}\n## Epic Actions\n\n### Existing Epic Directory Updates\n\n- Revise \`SAMPLE-E001\`.\n`,
    "utf8",
  );

  const result = await validateArtifacts(root, { changeId });

  assert.equal(result.valid, true);
  assert.equal(result.summary.repositories, 2);
  assert.equal(result.summary.epics, 1);
  assert.ok(!result.findings.some((finding) =>
    finding.code === "AFFECTED_EPIC_NOT_FOUND"));
});

test("change-scoped Epic paths report one missing finding across all declared repositories", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-08-09-cross-repository-missing-epic";
  await writeCanonicalChange(root, "sample-web", changeId, "in_review");
  const tasksPath = join(root, ".sdd", "changes", changeId, "tasks.md");
  await writeFile(
    tasksPath,
    (await readFile(tasksPath, "utf8")).replace(
      "  - sample-web",
      "  - sample-web\n  - sample-mobile",
    ),
    "utf8",
  );
  const proposalPath = join(root, ".sdd", "changes", changeId, "proposal.md");
  await writeFile(
    proposalPath,
    `${await readFile(proposalPath, "utf8")}\n## Epic Actions\n\n### Existing Epic Directory Updates\n\n- Revise \`docs/epics/sample-e001-core/epic.md\`.\n`,
    "utf8",
  );

  const result = await validateArtifacts(root, { changeId });
  const missing = result.findings.filter((finding) =>
    finding.code === "AFFECTED_EPIC_NOT_FOUND");

  assert.equal(result.valid, false);
  assert.equal(result.summary.epics, 0);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].path, "docs/epics/sample-e001-core/epic.md");
});

test("change-scoped Epic paths reject ambiguous matches across declared repositories", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-08-09-cross-repository-ambiguous-epic";
  await writeCanonicalChange(root, "sample-web", changeId, "in_review");
  const tasksPath = join(root, ".sdd", "changes", changeId, "tasks.md");
  await writeFile(
    tasksPath,
    (await readFile(tasksPath, "utf8")).replace(
      "  - sample-web",
      "  - sample-web\n  - sample-mobile",
    ),
    "utf8",
  );
  await writeCanonicalEpic(root, "sample-web");
  await writeCanonicalEpic(root, "sample-mobile");
  const proposalPath = join(root, ".sdd", "changes", changeId, "proposal.md");
  await writeFile(
    proposalPath,
    `${await readFile(proposalPath, "utf8")}\n## Epic Actions\n\n### Existing Epic Directory Updates\n\n- Revise \`docs/epics/sample-e001-core/epic.md\`.\n`,
    "utf8",
  );

  const result = await validateArtifacts(root, { changeId });
  const ambiguous = result.findings.filter((finding) =>
    finding.code === "AFFECTED_EPIC_AMBIGUOUS");

  assert.equal(result.valid, false);
  assert.equal(result.summary.epics, 0);
  assert.equal(ambiguous.length, 1);
  assert.deepEqual(
    ambiguous[0].repositories,
    ["code/sample-mobile", "code/sample-web"],
  );
});

test("validate accepts the documented lightweight interactive Change shape", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-14-interactive-shape";
  const changePath = join(root, ".sdd", "changes", changeId);
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
      "space: sample",
      "repositories:",
      "  - sample-web",
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
  const proposalPath = join(root, ".sdd", "changes", "closed", changeId, "proposal.md");
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
  const created = await createChange(root, "sample", "planned-validation", {
    date: "2026-07-14",
    repositories: ["sample-web"],
  });

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    changeId: created.changeId,
  });

  assert.equal(result.summary.changes, 1);
  assert.ok(result.findings.some((finding) => finding.code === "UNRESOLVED_TEMPLATE_PLACEHOLDER"));
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
  assert.equal(result.summary.changes, 0);
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

test("Space-scoped validation reports global Change collisions across metadata Spaces", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await mkdir(join(root, "ideas", "other"), { recursive: true });
  await mkdir(join(root, "code", "other-web"), { recursive: true });
  await writeRepositoryConfig(join(root, "code", "other-web"), createRepositoryConfig("other-web"));
  const config = await readWorkspaceConfig(root);
  config.ideas.other = {
    status: "active",
    repositories: [{ root: "code", path: "other-web", status: "active" }],
  };
  await writeWorkspaceConfig(root, config);

  const changeId = "2026-08-07-cross-space-location-collision";
  await writeCanonicalChange(root, "sample-web", changeId, "in_review");
  await writeCanonicalChange(root, "other-web", changeId, "in_review", { closed: true });
  const closedTasksPath = join(root, ".sdd", "changes", "closed", changeId, "tasks.md");
  await writeFile(
    closedTasksPath,
    (await readFile(closedTasksPath, "utf8")).replace("space: sample", "space: other"),
    "utf8",
  );

  const result = await validateArtifacts(root, {
    spaceId: "sample",
    repositories: ["sample-web"],
    changeId,
  });
  const collisions = result.findings.filter(
    (finding) => finding.code === "CHANGE_LOCATION_COLLISION",
  );

  assert.equal(result.valid, false);
  assert.equal(result.summary.changes, 1);
  assert.deepEqual(
    collisions.map((finding) => ({
      artifactId: finding.artifactId,
      path: finding.path,
    })),
    [{
      artifactId: changeId,
      path: `.sdd/changes/closed/${changeId}`,
    }],
  );
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

test("validate accepts equals-form governing options in aligned proof", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeCanonicalEpic(root, "sample-web");
  const report = await writeEpicVerificationReport(root, "sample-web");
  await writeFile(
    report,
    (await readFile(report, "utf8"))
      .replaceAll("--epic SAMPLE-E001", "--epic=SAMPLE-E001")
      .replaceAll("--repo code/sample-web", "--repo=code/sample-web")
      .replaceAll(
        "--changed-from aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "--changed-from=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ),
    "utf8",
  );

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
  const proposalPath = join(root, ".sdd", "changes", changeId, "proposal.md");
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


test("validate accepts every active central Change status", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-07-14-active-statuses";
  await writeCanonicalChange(root, "sample-web", changeId, "proposed");
  const tasksPath = join(root, ".sdd", "changes", changeId, "tasks.md");

  for (const status of ["proposed", "planned", "in_progress", "in_review"]) {
    const source = await readFile(tasksPath, "utf8");
    await writeFile(tasksPath, source.replace(/^status: \S+$/m, `status: ${status}`), "utf8");
    const result = await validateArtifacts(root, {
      spaceId: "sample",
      changeId,
    });
    assert.equal(result.valid, true, status);
  }
});

test("validate reports broken Markdown links to SDD artifacts", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicPath = await writeCanonicalEpic(root, "sample-web");
  await writeFile(
    epicPath,
    `${await readFile(epicPath, "utf8")}\n[Missing Epic](../missing-epic/epic.md)\n`,
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
    && finding.message.includes("docs/epics/missing-epic/epic.md")));
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
  ], { cwd: root });
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
    ], { cwd: root }),
    (error) => {
      const result = JSON.parse(error.stdout);
      return error.code === 1
        && result.valid === false
        && result.findings.some((finding) => finding.code === "MISSING_CHANGE_FILE");
    },
  );
});

test("workspace-local skill installation cannot escape the setup root", async (t) => {
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
  const config = await readWorkspaceConfig(root);
  config.ideas.sample.repositories[0].path = "../outside";
  await writeWorkspaceConfig(root, config);

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
  const config = await readWorkspaceConfig(root);
  config.ideas.sample.status = "building";
  config.ideas.sample.repositories[0].status = "retired";
  await writeWorkspaceConfig(root, config);

  const diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, false);
  assert.ok(diagnosis.findings.some((finding) => finding.message.includes("active, inactive, archived")));
  await assert.rejects(
    () => getStatus(root),
    (error) => error instanceof SddError && error.code === "INVALID_CONFIG",
  );
});

test("CLI update keeps a positional target across explicit, environment, target, and cwd authority precedence", async (t) => {
  const root = await createWorkspace("sdd-update-authority-routing-");
  const environmentWorkspace = join(root, "environment-workspace");
  const cwdWorkspace = join(root, "cwd-workspace");
  const targetWorkspace = join(root, "target-workspace");
  const externalRepository = join(root, "external-code", "sample-web");
  const unmappedTarget = join(root, "unmapped-target");
  await Promise.all([
    populateMappedWorkspace(environmentWorkspace),
    populateMappedWorkspace(cwdWorkspace),
    populateMappedWorkspace(targetWorkspace),
    mkdir(externalRepository, { recursive: true }),
    mkdir(unmappedTarget, { recursive: true }),
  ]);
  await writeRepositoryConfig(externalRepository, createRepositoryConfig("sample-web"));
  await Promise.all([
    initWorkspace(environmentWorkspace),
    initWorkspace(cwdWorkspace),
    initWorkspace(targetWorkspace),
  ]);
  for (const workspaceRoot of [environmentWorkspace, cwdWorkspace, targetWorkspace]) {
    const config = await readWorkspaceConfig(workspaceRoot);
    config.ideas.sample.repositories = [{
      path: externalRepository,
      role: "web",
      status: "active",
    }];
    await writeWorkspaceConfig(workspaceRoot, config);
  }
  t.after(() => rm(root, { recursive: true, force: true }));

  const command = [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "update",
    externalRepository,
    "--dry-run",
    "--json",
  ];
  const cwdEnv = { ...process.env };
  delete cwdEnv.SDD_WORKSPACE_ROOT;
  const cwdResult = JSON.parse((await execFileAsync(
    process.execPath,
    command,
    { cwd: cwdWorkspace, env: cwdEnv },
  )).stdout);
  const environmentResult = JSON.parse((await execFileAsync(
    process.execPath,
    command,
    {
      cwd: cwdWorkspace,
      env: { ...cwdEnv, SDD_WORKSPACE_ROOT: environmentWorkspace },
    },
  )).stdout);
  const targetResult = JSON.parse((await execFileAsync(
    process.execPath,
    [
      join(PACKAGE_ROOT, "bin", "sdd.js"),
      "update",
      join(targetWorkspace, "ideas", "sample"),
      "--dry-run",
      "--json",
    ],
    { cwd: cwdWorkspace, env: cwdEnv },
  )).stdout);
  const explicitResult = JSON.parse((await execFileAsync(
    process.execPath,
    [...command, "--workspace", targetWorkspace],
    {
      cwd: cwdWorkspace,
      env: { ...cwdEnv, SDD_WORKSPACE_ROOT: environmentWorkspace },
    },
  )).stdout);

  for (const { args, env, cwd } of [
    {
      args: [
        join(PACKAGE_ROOT, "bin", "sdd.js"),
        "update",
        ".",
        "--dry-run",
        "--json",
      ],
      env: { ...cwdEnv, SDD_WORKSPACE_ROOT: environmentWorkspace },
      cwd: unmappedTarget,
    },
    {
      args: [
        join(PACKAGE_ROOT, "bin", "sdd.js"),
        "update",
        ".",
        "--workspace",
        targetWorkspace,
        "--dry-run",
        "--json",
      ],
      env: { ...cwdEnv, SDD_WORKSPACE_ROOT: environmentWorkspace },
      cwd: unmappedTarget,
    },
  ]) {
    await assert.rejects(
      execFileAsync(process.execPath, args, { cwd, env }),
      (error) => {
        assert.equal(JSON.parse(error.stderr).error.code, "WORKSPACE_TARGET_UNMAPPED");
        return true;
      },
    );
  }

  assert.equal(cwdResult.workspaceRoot, cwdWorkspace);
  assert.equal(environmentResult.workspaceRoot, environmentWorkspace);
  assert.equal(targetResult.workspaceRoot, targetWorkspace);
  assert.equal(explicitResult.workspaceRoot, targetWorkspace);
  assert.equal(cwdResult.dryRun, true);
  assert.equal(environmentResult.dryRun, true);
});

test("CLI update validates explicit legacy and current targets against authority before decoy cwd", async (t) => {
  const root = await createWorkspace("sdd-update-legacy-target-routing-");
  const decoyWorkspace = join(root, "decoy-workspace");
  await populateMappedWorkspace(decoyWorkspace);
  await initWorkspace(decoyWorkspace);
  const decoyCwd = join(decoyWorkspace, "code", "sample-web");
  const decoyConfigBefore = await readFile(getWorkspaceConfigPath(decoyWorkspace), "utf8");
  const legacyArtifacts = {
    activeChanges: "docs/changes",
    closedChanges: "docs/changes/closed",
    epics: "docs/epics",
    adrs: "docs/adrs",
    audits: "docs/audits",
  };
  const cases = [
    { label: "v1", version: 1 },
    { label: "v2", version: 2 },
    { label: "v3", version: 3 },
  ];
  t.after(() => rm(root, { recursive: true, force: true }));

  for (const scenario of cases) {
    const workspaceRoot = join(root, `${scenario.label}-workspace`);
    const planningRoot = join(root, `${scenario.label}-planning`);
    const repositoryCollection = join(root, `${scenario.label}-repositories`);
    const repositoryRoot = join(repositoryCollection, "sample-web");
    const unmappedTarget = join(root, `${scenario.label}-unmapped`);
    await populateMappedWorkspace(workspaceRoot);
    await initWorkspace(workspaceRoot);
    await Promise.all([
      mkdir(join(planningRoot, "sample"), { recursive: true }),
      mkdir(repositoryRoot, { recursive: true }),
      mkdir(unmappedTarget, { recursive: true }),
    ]);
    await writeRepositoryConfig(repositoryRoot, createRepositoryConfig("sample-web"));

    const currentConfig = await readWorkspaceConfig(workspaceRoot);
    let sourceConfig;
    if (scenario.version === 1) {
      sourceConfig = {
        version: 1,
        schema: "sdd-v1",
        skills: { directory: ".agents/skills" },
        planning: { root: planningRoot },
        repositories: { roots: [repositoryCollection] },
        repositoryArtifacts: legacyArtifacts,
        ideas: {
          sample: {
            status: "active",
            planning: join(planningRoot, "sample"),
            repositories: [{
              path: repositoryRoot,
              role: "web",
              status: "active",
            }],
          },
        },
      };
    } else if (scenario.version === 2) {
      sourceConfig = {
        version: 2,
        schema: "sdd-v2",
        skills: { directory: ".agents/skills" },
        planning: {
          root: planningRoot,
          plannedChangesDirectory: "planned-changes",
        },
        repositories: { roots: { code: repositoryCollection } },
        repositoryArtifacts: legacyArtifacts,
        ideas: {
          sample: {
            status: "active",
            planningPath: join(planningRoot, "sample"),
            repositories: [{
              root: "code",
              path: "sample-web",
              role: "web",
              status: "active",
            }],
          },
        },
      };
    } else {
      sourceConfig = currentConfig;
      sourceConfig.planning.root = planningRoot;
      sourceConfig.repositories.roots = { code: repositoryCollection };
      sourceConfig.ideas.sample.planningPath = join(planningRoot, "sample");
      sourceConfig.ideas.sample.repositories = [{
        root: "code",
        path: "sample-web",
        role: "web",
        status: "active",
      }];
    }
    await writeFile(
      getWorkspaceConfigPath(workspaceRoot),
      `${JSON.stringify(sourceConfig, null, 2)}\n`,
      "utf8",
    );

    for (const authority of ["explicit", "environment"]) {
      const assertionLabel = `${scenario.label}-${authority}`;
      const authorityArgs = authority === "explicit"
        ? ["--workspace", workspaceRoot]
        : [];
      const env = {
        ...process.env,
        HOME: decoyWorkspace,
        SDD_USER_HOME: decoyWorkspace,
        SDD_WORKSPACE_ROOT: authority === "environment"
          ? workspaceRoot
          : decoyWorkspace,
      };
      const command = (target) => [
        join(PACKAGE_ROOT, "bin", "sdd.js"),
        "update",
        target,
        ...authorityArgs,
        "--dry-run",
        "--json",
      ];
      await assert.rejects(
        execFileAsync(process.execPath, command(unmappedTarget), { cwd: decoyCwd, env }),
        (error) => {
          assert.equal(JSON.parse(error.stderr).error.code, "WORKSPACE_TARGET_UNMAPPED");
          return true;
        },
        assertionLabel,
      );
      const { stdout } = await execFileAsync(
        process.execPath,
        command(repositoryRoot),
        { cwd: decoyCwd, env },
      );
      const result = JSON.parse(stdout);
      assert.equal(result.workspaceRoot, workspaceRoot, assertionLabel);
      assert.equal(result.dryRun, true, assertionLabel);
    }
    assert.equal(
      (await readWorkspaceConfig(workspaceRoot)).version,
      scenario.version,
      scenario.label,
    );
  }

  assert.equal(
    await readFile(getWorkspaceConfigPath(decoyWorkspace), "utf8"),
    decoyConfigBefore,
  );
});

test("CLI configure keeps its positional scan target under environment and explicit workspace authority", async (t) => {
  const root = await createWorkspace("sdd-configure-target-routing-");
  const workspaceRoot = join(root, "workspace");
  const scanRoot = join(root, "relocated-layout");
  const planningRoot = join(scanRoot, "product-planning");
  const repositoryRoot = join(scanRoot, "source-code");
  const outside = join(root, "outside");
  await populateMappedWorkspace(workspaceRoot);
  await initWorkspace(workspaceRoot);
  await Promise.all([
    mkdir(join(planningRoot, "sample"), { recursive: true }),
    mkdir(join(repositoryRoot, "sample-web"), { recursive: true }),
    mkdir(join(repositoryRoot, "sample-mobile"), { recursive: true }),
    mkdir(outside, { recursive: true }),
  ]);
  const config = await readWorkspaceConfig(workspaceRoot);
  config.planning.root = "missing-planning";
  config.repositories.roots = { code: "missing-code" };
  delete config.ideas.sample.planning;
  delete config.ideas.sample.planningPath;
  config.ideas.sample.repositories = [
    { root: "code", path: "sample-web", role: "web", status: "active" },
    { root: "code", path: "sample-mobile", role: "mobile", status: "active" },
  ];
  await writeWorkspaceConfig(workspaceRoot, config);
  t.after(() => rm(root, { recursive: true, force: true }));

  const { stdout: environmentStdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "configure",
    scanRoot,
    "--yes",
    "--json",
  ], {
    cwd: outside,
    env: { ...process.env, SDD_WORKSPACE_ROOT: workspaceRoot },
  });
  const environmentResult = JSON.parse(environmentStdout);
  assert.equal(environmentResult.workspaceRoot, workspaceRoot);
  assert.equal(environmentResult.planningRoot, planningRoot);
  assert.equal(environmentResult.repositoryRoots.code, repositoryRoot);
  const environmentStored = await readWorkspaceConfig(workspaceRoot);
  assert.equal(environmentStored.planning.root, planningRoot);
  assert.equal(environmentStored.repositories.roots.code, repositoryRoot);
  await writeWorkspaceConfig(workspaceRoot, config);

  const { stdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "configure",
    scanRoot,
    "--workspace",
    workspaceRoot,
    "--yes",
    "--json",
  ], {
    cwd: outside,
    env: { ...process.env, SDD_WORKSPACE_ROOT: outside },
  });
  const result = JSON.parse(stdout);

  assert.equal(result.workspaceRoot, workspaceRoot);
  assert.equal(result.planningRoot, planningRoot);
  assert.equal(result.repositoryRoots.code, repositoryRoot);
  assert.equal(result.planningRoot.startsWith("../"), false);
  assert.equal(result.repositoryRoots.code.startsWith("../"), false);
  const stored = await readWorkspaceConfig(workspaceRoot);
  assert.equal(stored.planning.root, planningRoot);
  assert.equal(stored.repositories.roots.code, repositoryRoot);
});

test("CLI configure scans the discovered workspace from a nested default cwd", async (t) => {
  const workspaceRoot = await createMappedWorkspace();
  const nestedCwd = join(workspaceRoot, "tools", "nested");
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  await initWorkspace(workspaceRoot);
  await moveWorkspaceRoots(workspaceRoot);
  await mkdir(nestedCwd, { recursive: true });

  const { stdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "configure",
    "--yes",
    "--dry-run",
    "--json",
  ], { cwd: nestedCwd });
  const result = JSON.parse(stdout);

  assert.equal(result.workspaceRoot, workspaceRoot);
  assert.equal(result.planningRoot, "spaces/ideas");
  assert.deepEqual(result.repositoryRoots, { code: "spaces/code" });
});

test("explicit workspace routes repository-only CLI operations without borrowing unrelated cwd", async (t) => {
  const root = await createWorkspace("sdd-repository-only-routing-");
  const workspaceRoot = join(root, "workspace");
  const repositoryRoot = join(root, "standalone-repository");
  const malformedCwd = join(root, "malformed-unrelated-checkout");
  const differentRepositoryCwd = join(root, "different-repository");
  const repositoryId = "standalone-repository";
  const changeId = "2026-08-09-repository-only-routing";
  await populateMappedWorkspace(workspaceRoot);
  await initWorkspace(workspaceRoot);
  await Promise.all([
    mkdir(repositoryRoot, { recursive: true }),
    mkdir(join(malformedCwd, ".sdd"), { recursive: true }),
    mkdir(differentRepositoryCwd, { recursive: true }),
  ]);
  await writeRepositoryConfig(repositoryRoot, createRepositoryConfig(repositoryId));
  await writeFile(getRepositoryConfigPath(malformedCwd), "schema: [\n", "utf8");
  await writeRepositoryConfig(
    differentRepositoryCwd,
    createRepositoryConfig("different-repository"),
  );
  const authorityConfig = await readWorkspaceConfig(workspaceRoot);
  authorityConfig.repositories.roots.standalone = repositoryRoot;
  await writeWorkspaceConfig(workspaceRoot, authorityConfig);
  await writeCanonicalChange(workspaceRoot, repositoryId, changeId, "in_review");
  const tasksPath = join(workspaceRoot, ".sdd", "changes", changeId, "tasks.md");
  await writeFile(
    tasksPath,
    (await readFile(tasksPath, "utf8")).replace("space: sample", `space: ${repositoryId}`),
    "utf8",
  );
  t.after(() => rm(root, { recursive: true, force: true }));

  const runJson = async (cwd, ...args) => {
    const { stdout } = await execFileAsync(process.execPath, [
      join(PACKAGE_ROOT, "bin", "sdd.js"),
      ...args,
      "--workspace",
      workspaceRoot,
      "--json",
    ], { cwd });
    return JSON.parse(stdout);
  };
  const targetlessMappedStatus = await runJson(repositoryRoot, "status");
  const targetlessUnrelatedStatus = await runJson(differentRepositoryCwd, "status");
  const status = await runJson(malformedCwd, "status", repositoryId);
  const validation = await runJson(
    differentRepositoryCwd,
    "validate",
    repositoryId,
    "--repo",
    repositoryId,
  );
  const epic = await runJson(
    malformedCwd,
    "epic",
    "create",
    repositoryId,
    "STANDALONE-E001",
    "repository-only-routing",
    "--repo",
    repositoryId,
    "--date",
    "2026-08-09",
    "--dry-run",
  );
  const stableIdCreate = await runJson(
    differentRepositoryCwd,
    "change",
    "create",
    repositoryId,
    "stable-id-routing",
    "--repo",
    repositoryId,
    "--date",
    "2026-08-09",
    "--dry-run",
  );
  const inferredCreate = await runJson(
    malformedCwd,
    "change",
    "create",
    repositoryId,
    "inferred-routing",
    "--date",
    "2026-08-09",
    "--dry-run",
  );
  const transitioned = await runJson(
    differentRepositoryCwd,
    "change",
    "transition",
    repositoryId,
    changeId,
    "--from",
    "in_review",
    "--to",
    "in_progress",
    "--dry-run",
  );
  const closed = await runJson(
    malformedCwd,
    "change",
    "close",
    repositoryId,
    changeId,
    "--dry-run",
  );

  assert.equal(targetlessMappedStatus.mode, "space");
  assert.equal(targetlessMappedStatus.spaceId, repositoryId);
  assert.equal(targetlessUnrelatedStatus.mode, "summary");
  assert.equal(targetlessUnrelatedStatus.workspaceRoot, workspaceRoot);
  assert.equal(status.spaceId, repositoryId);
  assert.deepEqual(validation.scope.repositories, [repositoryRoot]);
  assert.equal(epic.repository.resolvedPath, repositoryRoot);
  assert.equal(stableIdCreate.repositories[0].id, repositoryId);
  assert.equal(inferredCreate.repositories[0].id, repositoryId);
  assert.equal(transitioned.repositories[0].id, repositoryId);
  assert.equal(closed.repositories[0].id, repositoryId);
});

test("observational status falls back to workspace authority past an unrelated cyclic mapping", async (t) => {
  const workspaceRoot = await createMappedWorkspace();
  const outside = await createWorkspace("sdd-status-cyclic-mapping-cwd-");
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const repositoryId = "solo";
  const changeId = "2026-08-09-solo-unresolved";
  await initWorkspace(workspaceRoot);
  const config = await readWorkspaceConfig(workspaceRoot);
  const loopPath = join(workspaceRoot, "code", "looped-app");
  config.ideas.sample.repositories[1].path = "looped-app";
  await writeWorkspaceConfig(workspaceRoot, config);
  await symlink("looped-app", loopPath);
  await writeCanonicalChange(workspaceRoot, repositoryId, changeId, "in_review");
  const tasksPath = join(workspaceRoot, ".sdd", "changes", changeId, "tasks.md");
  await writeFile(
    tasksPath,
    (await readFile(tasksPath, "utf8")).replace("space: sample", `space: ${repositoryId}`),
    "utf8",
  );

  const { stdout } = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "status",
    repositoryId,
    "--workspace",
    workspaceRoot,
    "--json",
  ], { cwd: outside });
  const result = JSON.parse(stdout);

  assert.equal(result.mode, "space");
  assert.equal(result.spaceId, repositoryId);
  assert.deepEqual(result.unresolvedRepositoryIds, [repositoryId]);
  assert.equal(result.change.changeId, changeId);
});

test("environment authority routes targetless and configured CLI operations without retargeting context", async (t) => {
  const workspaceRoot = await createMappedWorkspace();
  const outside = await createWorkspace("sdd-environment-authority-cwd-");
  const changeId = "2026-08-09-environment-authority";
  await initWorkspace(workspaceRoot);
  await writeCanonicalChange(workspaceRoot, "sample-web", changeId, "in_review");
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const env = {
    ...process.env,
    HOME: outside,
    SDD_USER_HOME: outside,
    SDD_WORKSPACE_ROOT: workspaceRoot,
  };
  const runJson = async (...args) => {
    const { stdout } = await execFileAsync(process.execPath, [
      join(PACKAGE_ROOT, "bin", "sdd.js"),
      ...args,
      "--json",
    ], { cwd: outside, env });
    return JSON.parse(stdout);
  };

  const diagnosis = await runJson("doctor");
  const status = await runJson("status");
  const fullValidation = await runJson("validate");
  const selectedValidation = await runJson(
    "validate",
    "sample",
    "--repo",
    "sample-web",
  );
  const epic = await runJson(
    "epic",
    "create",
    "sample",
    "SAMPLE-E920",
    "environment-authority",
    "--repo",
    "sample-web",
    "--date",
    "2026-08-09",
    "--dry-run",
  );
  const created = await runJson(
    "change",
    "create",
    "sample",
    "environment-authority-create",
    "--repo",
    "sample-web",
    "--date",
    "2026-08-09",
    "--dry-run",
  );
  const transitioned = await runJson(
    "change",
    "transition",
    "sample",
    changeId,
    "--from",
    "in_review",
    "--to",
    "in_progress",
    "--dry-run",
  );
  const closed = await runJson(
    "change",
    "close",
    "sample",
    changeId,
    "--dry-run",
  );

  assert.equal(diagnosis.workspaceRoot, workspaceRoot);
  assert.equal(status.workspaceRoot, workspaceRoot);
  assert.equal(fullValidation.workspaceRoot, workspaceRoot);
  assert.deepEqual(selectedValidation.scope.repositories, ["code/sample-web"]);
  assert.equal(epic.repository.resolvedPath, "code/sample-web");
  assert.equal(created.repositories[0].id, "sample-web");
  assert.equal(transitioned.repositories[0].id, "sample-web");
  assert.equal(closed.repositories[0].id, "sample-web");
  await assert.rejects(
    execFileAsync(process.execPath, [
      join(PACKAGE_ROOT, "bin", "sdd.js"),
      "context",
      "--json",
    ], { cwd: outside, env }),
    (error) => {
      assert.equal(JSON.parse(error.stderr).error.code, "WORKSPACE_TARGET_UNMAPPED");
      return true;
    },
  );
});

test("workspace-root inventory retains repository-only Change history without inventing a locator", async (t) => {
  const root = await createWorkspace("sdd-repository-only-central-inventory-");
  const workspaceRoot = join(root, "workspace");
  const repositoryRoot = join(root, "external-repository");
  const repositoryId = "external-repository";
  const changeId = "2026-08-09-central-inventory";
  await populateMappedWorkspace(workspaceRoot);
  await initWorkspace(workspaceRoot);
  await mkdir(repositoryRoot, { recursive: true });
  await writeRepositoryConfig(repositoryRoot, createRepositoryConfig(repositoryId));
  t.after(() => rm(root, { recursive: true, force: true }));

  const runJson = async (cwd, ...args) => {
    const { stdout } = await execFileAsync(process.execPath, [
      join(PACKAGE_ROOT, "bin", "sdd.js"),
      ...args,
      "--workspace",
      workspaceRoot,
      "--json",
    ], { cwd });
    return JSON.parse(stdout);
  };

  const created = await runJson(
    repositoryRoot,
    "change",
    "create",
    repositoryId,
    "central-inventory",
    "--date",
    "2026-08-09",
  );
  assert.equal(created.path, `.sdd/changes/${changeId}`);
  assert.equal(created.repositories[0].id, repositoryId);
  assert.equal(
    Object.hasOwn((await readWorkspaceConfig(workspaceRoot)).ideas, repositoryId),
    false,
  );

  await writeCanonicalChange(workspaceRoot, repositoryId, changeId, "in_review");
  const tasksPath = join(workspaceRoot, ".sdd", "changes", changeId, "tasks.md");
  await writeFile(
    tasksPath,
    (await readFile(tasksPath, "utf8")).replace("space: sample", `space: ${repositoryId}`),
    "utf8",
  );

  const checkoutOutput = await execFileAsync(process.execPath, [
    join(PACKAGE_ROOT, "bin", "sdd.js"),
    "status",
    "--json",
  ], {
    cwd: repositoryRoot,
    env: { ...process.env, SDD_WORKSPACE_ROOT: workspaceRoot },
  });
  const checkoutStatus = JSON.parse(checkoutOutput.stdout);
  const checkoutSpace = checkoutStatus.spaces.find((space) => space.spaceId === repositoryId);
  assert.ok(checkoutSpace);
  assert.equal(checkoutSpace.repositories.length, 1);
  assert.deepEqual(checkoutSpace.unresolvedRepositoryIds, []);
  assert.deepEqual(
    checkoutSpace.activeChanges.map((change) => change.changeId),
    [changeId],
  );

  const activeStatus = await runJson(workspaceRoot, "status");
  const activeSpace = activeStatus.spaces.find((space) => space.spaceId === repositoryId);
  assert.ok(activeSpace);
  assert.equal(activeSpace.planningPath, null);
  assert.deepEqual(activeSpace.repositories, []);
  assert.deepEqual(activeSpace.repositoryActivity, []);
  assert.deepEqual(activeSpace.unresolvedRepositoryIds, [repositoryId]);
  assert.deepEqual(
    activeSpace.activeChanges.map((change) => change.changeId),
    [changeId],
  );
  assert.equal(JSON.stringify(activeSpace).includes(repositoryRoot), false);

  const activeDetail = await runJson(workspaceRoot, "status", repositoryId);
  assert.equal(activeDetail.change.changeId, changeId);
  assert.deepEqual(activeDetail.change.unresolvedRepositoryIds, [repositoryId]);

  const diagnosis = await runJson(workspaceRoot, "doctor");
  assert.equal(diagnosis.healthy, true);
  assert.equal(diagnosis.findings.some((finding) =>
    finding.code === "SPACE_NOT_FOUND"
    || /unknown Space/.test(finding.message)), false);
  assert.deepEqual(
    diagnosis.findings
      .filter((finding) => finding.code === "REPOSITORY_LOCATOR_UNAVAILABLE")
      .map((finding) => ({ level: finding.level, spaceId: finding.spaceId })),
    [{ level: "warning", spaceId: repositoryId }],
  );
  assert.match(
    diagnosis.findings.find((finding) =>
      finding.code === "REPOSITORY_LOCATOR_UNAVAILABLE").message,
    /Run repository-scoped commands from that checkout with --workspace/,
  );
  assert.equal(JSON.stringify(diagnosis).includes(repositoryRoot), false);

  const validation = await runJson(
    workspaceRoot,
    "validate",
    "--change",
    changeId,
  );
  assert.equal(validation.valid, true);
  assert.equal(validation.summary.changes, 1);
  assert.equal(validation.summary.repositories, 0);
  assert.deepEqual(validation.scope.repositories, []);
  assert.deepEqual(
    validation.findings.map((finding) => ({
      level: finding.level,
      code: finding.code,
      spaceId: finding.spaceId,
      repositoryId: finding.repositoryId,
    })),
    [{
      level: "warning",
      code: "REPOSITORY_LOCATOR_UNAVAILABLE",
      spaceId: repositoryId,
      repositoryId,
    }],
  );
  assert.equal(JSON.stringify(validation).includes(repositoryRoot), false);

  const selectedValidation = await runJson(
    workspaceRoot,
    "validate",
    repositoryId,
    "--change",
    changeId,
    "--repo",
    repositoryId,
  );
  assert.equal(selectedValidation.valid, true);
  assert.deepEqual(selectedValidation.scope.repositories, []);

  const closed = await runJson(
    repositoryRoot,
    "change",
    "close",
    repositoryId,
    changeId,
  );
  assert.equal(closed.repositories[0].id, repositoryId);

  const closedStatus = await runJson(workspaceRoot, "status");
  const closedSpace = closedStatus.spaces.find((space) => space.spaceId === repositoryId);
  assert.ok(closedSpace);
  assert.equal(closedSpace.activeChangeCount, 0);
  assert.deepEqual(
    closedSpace.recentChanges.map((change) => ({
      changeId: change.changeId,
      status: change.status,
      storedStatus: change.storedStatus,
      unresolvedRepositoryIds: change.unresolvedRepositoryIds,
    })),
    [{
      changeId,
      status: "closed",
      storedStatus: "in_review",
      unresolvedRepositoryIds: [repositoryId],
    }],
  );

  const closedValidation = await runJson(
    workspaceRoot,
    "validate",
    "--change",
    changeId,
  );
  assert.equal(closedValidation.valid, true);
  assert.equal(closedValidation.summary.changes, 1);
  assert.deepEqual(
    closedValidation.findings.map((finding) => finding.code),
    ["REPOSITORY_LOCATOR_UNAVAILABLE"],
  );
  assert.equal(
    Object.hasOwn((await readWorkspaceConfig(workspaceRoot)).ideas, repositoryId),
    false,
  );
});

test("central inventory does not broaden repository-only Space synthesis", async (t) => {
  const cases = [
    { label: "zero", repositoryIds: [] },
    { label: "different", repositoryIds: ["different-repository"] },
    { label: "multiple", repositoryIds: ["unknown-multiple", "different-repository"] },
  ];

  for (const [index, scenario] of cases.entries()) {
    const root = await createMappedWorkspace();
    const spaceId = `unknown-${scenario.label}`;
    const changeId = `2026-08-${String(index + 10).padStart(2, "0")}-${scenario.label}-ownership`;
    t.after(() => rm(root, { recursive: true, force: true }));
    await initWorkspace(root);
    await writeCanonicalChange(root, "sample-web", changeId, "in_review");
    const tasksPath = join(root, ".sdd", "changes", changeId, "tasks.md");
    const repositories = scenario.repositoryIds.length === 0
      ? "repositories: []"
      : ["repositories:", ...scenario.repositoryIds.map((id) => `  - ${id}`)].join("\n");
    await writeFile(
      tasksPath,
      (await readFile(tasksPath, "utf8")).replace(
        "space: sample\nrepositories:\n  - sample-web",
        `space: ${spaceId}\n${repositories}`,
      ),
      "utf8",
    );

    await assert.rejects(
      () => getStatus(root),
      (error) => error instanceof SddError && error.code === "SPACE_NOT_FOUND",
      scenario.label,
    );

    const diagnosis = await diagnoseWorkspace(root);
    assert.equal(diagnosis.healthy, false, scenario.label);
    assert.ok(diagnosis.findings.some((finding) =>
      finding.level === "error"
      && finding.code === "SPACE_NOT_FOUND"
      && finding.message.includes(spaceId)), scenario.label);
    assert.equal(diagnosis.findings.some((finding) =>
      finding.code === "REPOSITORY_LOCATOR_UNAVAILABLE"), false, scenario.label);

    const validation = await validateArtifacts(root, { changeId });
    assert.equal(validation.valid, false, scenario.label);
    assert.ok(validation.findings.some((finding) =>
      finding.level === "error"
      && finding.code === "SPACE_NOT_FOUND"
      && finding.spaceId === spaceId), scenario.label);
    assert.equal(validation.findings.some((finding) =>
      finding.code === "REPOSITORY_LOCATOR_UNAVAILABLE"), false, scenario.label);

    if (scenario.label === "multiple") {
      const repositoryRoot = await createWorkspace("sdd-invalid-repository-only-context-");
      t.after(() => rm(repositoryRoot, { recursive: true, force: true }));
      await writeRepositoryConfig(repositoryRoot, createRepositoryConfig(spaceId));

      await assert.rejects(
        () => getStatus(repositoryRoot, null, { workspaceRoot: root }),
        (error) => error instanceof SddError && error.code === "SPACE_NOT_FOUND",
      );

      const checkoutDiagnosis = await diagnoseWorkspace(repositoryRoot, {
        workspaceRoot: root,
      });
      assert.equal(checkoutDiagnosis.healthy, false);
      assert.ok(checkoutDiagnosis.findings.some((finding) =>
        finding.level === "error"
        && finding.code === "SPACE_NOT_FOUND"
        && finding.message.includes(spaceId)));

      const checkoutValidation = await validateArtifacts(repositoryRoot, {
        changeId,
        workspaceRoot: root,
      });
      assert.equal(checkoutValidation.valid, false);
      assert.ok(checkoutValidation.findings.some((finding) =>
        finding.level === "error"
        && finding.code === "SPACE_NOT_FOUND"
        && finding.spaceId === spaceId));
    }
  }
});

test("absolute --repo selectors drive contained and physical external CLI targets", async (t) => {
  const workspaceRoot = await createMappedWorkspace();
  const externalRoot = await createWorkspace("sdd-absolute-external-repository-");
  const externalRepository = join(externalRoot, "sample-external");
  const externalMapping = join(workspaceRoot, "code", "sample-external-link");
  const containedRepository = join(workspaceRoot, "code", "sample-web");
  await initWorkspace(workspaceRoot);
  await mkdir(externalRepository, { recursive: true });
  await writeRepositoryConfig(
    externalRepository,
    createRepositoryConfig("sample-external"),
  );
  await symlink(externalRepository, externalMapping);
  const config = await readWorkspaceConfig(workspaceRoot);
  config.ideas.sample.repositories.push({
    path: "code/sample-external-link",
    role: "external",
    status: "active",
  });
  await writeWorkspaceConfig(workspaceRoot, config);
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  t.after(() => rm(externalRoot, { recursive: true, force: true }));

  const runJson = async (...args) => {
    const { stdout } = await execFileAsync(process.execPath, [
      join(PACKAGE_ROOT, "bin", "sdd.js"),
      ...args,
      "--workspace",
      workspaceRoot,
      "--json",
    ], { cwd: tmpdir() });
    return JSON.parse(stdout);
  };
  const routes = [
    {
      label: "contained",
      selector: containedRepository,
      resolvedPath: "code/sample-web",
      epicId: "SAMPLE-E910",
    },
    {
      label: "external",
      selector: externalRepository,
      resolvedPath: "code/sample-external-link",
      epicId: "SAMPLE-E911",
    },
  ];
  for (const route of routes) {
    const validation = await runJson(
      "validate",
      "sample",
      "--repo",
      route.selector,
    );
    const epic = await runJson(
      "epic",
      "create",
      "sample",
      route.epicId,
      `${route.label}-absolute-selector`,
      "--repo",
      route.selector,
      "--date",
      "2026-08-09",
      "--dry-run",
    );
    const change = await runJson(
      "change",
      "create",
      "sample",
      `${route.label}-absolute-selector`,
      "--repo",
      route.selector,
      "--date",
      "2026-08-09",
      "--dry-run",
    );

    assert.equal(validation.valid, true);
    assert.deepEqual(validation.scope.repositories, [route.resolvedPath]);
    assert.equal(epic.repository.resolvedPath, route.resolvedPath);
    assert.equal(change.repositories[0].resolvedPath, route.resolvedPath);
  }
});

async function seedCreateCollisionEntry(kind, path, root) {
  let markerPath = null;
  if (kind === "empty directory") {
    await mkdir(path);
  } else if (kind === "file") {
    markerPath = path;
    await writeFile(path, "concurrent file\n", "utf8");
  } else if (kind === "symlink") {
    const linkTarget = join(root, "concurrent-link-target");
    markerPath = join(linkTarget, "marker.txt");
    await mkdir(linkTarget, { recursive: true });
    await writeFile(markerPath, "concurrent symlink\n", "utf8");
    await symlink(linkTarget, path);
  } else {
    markerPath = join(path, "marker.txt");
    await mkdir(path);
    await writeFile(markerPath, "concurrent directory\n", "utf8");
  }
  const state = await lstat(path, { bigint: true });
  return {
    identity: { dev: String(state.dev), ino: String(state.ino) },
    markerPath,
    markerSource: markerPath ? await readFile(markerPath, "utf8") : null,
  };
}

async function assertCreateCollisionEntry(path, expected) {
  const state = await lstat(path, { bigint: true });
  assert.deepEqual(
    { dev: String(state.dev), ino: String(state.ino) },
    expected.identity,
  );
  if (expected.markerPath) {
    assert.equal(await readFile(expected.markerPath, "utf8"), expected.markerSource);
  } else {
    assert.deepEqual(await readdir(path), []);
  }
}

function createRaceOperations() {
  return [
    {
      label: "Change",
      destination: (root) =>
        getActiveChangePath("2026-08-09-publication-race", root),
      create: (root, hooks = {}) => createChange(root, "sample", "publication-race", {
        date: "2026-08-09",
        repositories: ["sample-web"],
        ...hooks,
      }),
    },
    {
      label: "Epic",
      destination: (root) => join(
        root,
        "code",
        "sample-web",
        "docs",
        "epics",
        "sample-e901-publication-race",
      ),
      create: (root, hooks = {}) => createEpic(
        root,
        "sample",
        "SAMPLE-E901",
        "publication-race",
        {
          date: "2026-08-09",
          repositories: ["sample-web"],
          ...hooks,
        },
      ),
    },
  ];
}

test("Change and Epic creation preserve every destination type that appears before reservation", async (t) => {
  for (const operation of createRaceOperations()) {
    for (const kind of ["empty directory", "file", "symlink", "nonempty directory"]) {
      await t.test(`${operation.label}: ${kind}`, async (subtest) => {
        const root = await createMappedWorkspace();
        subtest.after(() => rm(root, { recursive: true, force: true }));
        await initWorkspace(root);
        const destination = operation.destination(root);
        let concurrentEntry;

        await assert.rejects(
          () => operation.create(root, {
            beforePublish: async ({ targetPath }) => {
              assert.equal(targetPath, destination);
              concurrentEntry = await seedCreateCollisionEntry(kind, targetPath, root);
            },
          }),
          (error) => error instanceof SddError
            && ["CONCURRENT_CHANGE", "UNSAFE_ARTIFACT_PATH"].includes(error.code),
        );
        await assertCreateCollisionEntry(destination, concurrentEntry);

        await rm(destination, { recursive: true, force: true });
        const retried = await operation.create(root);
        assert.equal(retried.command, operation.label === "Change" ? "change-create" : "epic-create");
      });
    }
  }
});

test("Change and Epic creation preserve a replacement of their owned destination reservation", async (t) => {
  for (const operation of createRaceOperations()) {
    await t.test(operation.label, async (subtest) => {
      const root = await createMappedWorkspace();
      subtest.after(() => rm(root, { recursive: true, force: true }));
      await initWorkspace(root);
      const destination = operation.destination(root);
      const displacedReservation = `${destination}.displaced-reservation`;
      let replacement;

      await assert.rejects(
        () => operation.create(root, {
          afterReservation: async ({ targetPath }) => {
            assert.equal(targetPath, destination);
            await rename(targetPath, displacedReservation);
            await mkdir(targetPath);
            await writeFile(join(targetPath, "marker.txt"), "newer reservation replacement\n", "utf8");
            const state = await lstat(targetPath, { bigint: true });
            replacement = {
              dev: String(state.dev),
              ino: String(state.ino),
            };
          },
        }),
        (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
      );

      const current = await lstat(destination, { bigint: true });
      assert.deepEqual(
        { dev: String(current.dev), ino: String(current.ino) },
        replacement,
      );
      assert.equal(
        await readFile(join(destination, "marker.txt"), "utf8"),
        "newer reservation replacement\n",
      );
      assert.deepEqual(await readdir(displacedReservation), []);

      await rm(destination, { recursive: true, force: true });
      await rm(displacedReservation, { recursive: true, force: true });
      assert.equal((await operation.create(root)).dryRun, false);
    });
  }
});

test("Change and Epic creation preserve a predictable temporary replacement after final proof", async (t) => {
  for (const operation of createRaceOperations()) {
    await t.test(operation.label, async (subtest) => {
      const root = await createMappedWorkspace();
      subtest.after(() => rm(root, { recursive: true, force: true }));
      await initWorkspace(root);
      const destination = operation.destination(root);
      let temporaryPath;
      let displacedTemporary;
      let replacement;

      await assert.rejects(
        () => operation.create(root, {
          afterTemporaryVerification: async (context) => {
            temporaryPath = context.temporaryPath;
            displacedTemporary = `${temporaryPath}.displaced-owned-tree`;
            await rename(temporaryPath, displacedTemporary);
            await mkdir(temporaryPath);
            await writeFile(join(temporaryPath, "marker.txt"), "newer temporary replacement\n", "utf8");
            const state = await lstat(temporaryPath, { bigint: true });
            replacement = {
              dev: String(state.dev),
              ino: String(state.ino),
            };
          },
        }),
        (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
      );

      const current = await lstat(temporaryPath, { bigint: true });
      assert.deepEqual(
        { dev: String(current.dev), ino: String(current.ino) },
        replacement,
      );
      assert.equal(
        await readFile(join(temporaryPath, "marker.txt"), "utf8"),
        "newer temporary replacement\n",
      );
      assert.ok((await readdir(displacedTemporary)).length > 0);
      assert.equal(await pathExists(destination), false);

      await rm(temporaryPath, { recursive: true, force: true });
      await rm(displacedTemporary, { recursive: true, force: true });
      assert.equal((await operation.create(root)).dryRun, false);
    });
  }
});

test("Epic validation rollback removes only its exact publication and preserves a replacement", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const epicDirectory = join(
    root,
    "code",
    "sample-web",
    "docs",
    "epics",
    "sample-e902-validation-rollback",
  );
  const displacedPublication = `${epicDirectory}.displaced-publication`;
  let replacement;

  await assert.rejects(
    () => createEpic(root, "sample", "SAMPLE-E902", "validation-rollback", {
      date: "2026-08-09",
      repositories: ["sample-web"],
      validate: async () => ({
        valid: false,
        findings: [{ code: "INJECTED_INVALID_EPIC", message: "Injected invalid Epic." }],
      }),
      beforeValidationRollback: async ({ path }) => {
        assert.equal(path, epicDirectory);
        await rename(path, displacedPublication);
        await mkdir(path);
        await writeFile(join(path, "marker.txt"), "newer Epic replacement\n", "utf8");
        const state = await lstat(path, { bigint: true });
        replacement = { dev: String(state.dev), ino: String(state.ino) };
      },
    }),
    (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
  );

  const current = await lstat(epicDirectory, { bigint: true });
  assert.deepEqual(
    { dev: String(current.dev), ino: String(current.ino) },
    replacement,
  );
  assert.equal(
    await readFile(join(epicDirectory, "marker.txt"), "utf8"),
    "newer Epic replacement\n",
  );
  assert.equal(await pathExists(join(displacedPublication, "epic.md")), true);

  await rm(epicDirectory, { recursive: true, force: true });
  await rm(displacedPublication, { recursive: true, force: true });
  const retried = await createEpic(root, "sample", "SAMPLE-E902", "validation-rollback", {
    date: "2026-08-09",
    repositories: ["sample-web"],
  });
  assert.equal(retried.validation.valid, true);
});

test("Epic create honors external portable identity and custom artifacts from unrelated cwd", async (t) => {
  const root = await createMappedWorkspace();
  const externalRoot = await createWorkspace("sdd-epic-create-external-");
  const repositoryRoot = join(externalRoot, "frontend");
  await mkdir(repositoryRoot, { recursive: true });
  const repositoryConfig = createRepositoryConfig("web-app");
  repositoryConfig.artifacts.epics = "custom/epics";
  await writeRepositoryConfig(repositoryRoot, repositoryConfig);
  await initWorkspace(root);
  await addRepositoryRootMapping(root, "external", externalRoot, "frontend");
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(externalRoot, { recursive: true, force: true }));

  const oldDirectory = join(repositoryRoot, "custom", "epics", "sample-e903-older");
  await mkdir(oldDirectory, { recursive: true });
  const template = await readFile(join(PACKAGE_ROOT, "docs", "templates", "epic.md"), "utf8");
  await writeFile(
    join(oldDirectory, "epic.md"),
    template
      .replaceAll("EPIC-ID", "SAMPLE-E903")
      .replaceAll("Epic Name", "Older")
      .replaceAll("yyyy-mm-dd", "2026-08-08"),
    "utf8",
  );

  const runCreate = async (epicId, slug, selector) => {
    const { stdout } = await execFileAsync(process.execPath, [
      join(PACKAGE_ROOT, "bin", "sdd.js"),
      "epic",
      "create",
      "sample",
      epicId,
      slug,
      "--workspace",
      root,
      "--repo",
      selector,
      "--date",
      "2026-08-09",
      "--json",
    ], { cwd: tmpdir() });
    return JSON.parse(stdout);
  };
  const duplicateDirectory = join(
    repositoryRoot,
    "custom",
    "epics",
    "sample-e903-duplicate",
  );
  await assert.rejects(
    () => runCreate("SAMPLE-E903", "duplicate", repositoryRoot),
  );
  assert.equal(await pathExists(duplicateDirectory), false);

  const absoluteSelected = await runCreate("SAMPLE-E904", "current", repositoryRoot);
  assert.equal(absoluteSelected.repository.id, "web-app");
  assert.equal(absoluteSelected.repository.resolvedPath, repositoryRoot);
  assert.equal(absoluteSelected.validation.summary.epics, 1);
  assert.equal(
    await pathExists(join(repositoryRoot, "custom", "epics", "sample-e904-current", "epic.md")),
    true,
  );
  assert.equal(
    await pathExists(join(repositoryRoot, "docs", "epics", "sample-e904-current", "epic.md")),
    false,
  );

  const idSelected = await runCreate("SAMPLE-E905", "stable-id", "web-app");
  assert.equal(idSelected.repository.id, "web-app");
  assert.equal(
    await pathExists(join(repositoryRoot, "custom", "epics", "sample-e905-stable-id", "epic.md")),
    true,
  );
});

test("explicit create targets ignore unrelated broken configs but reject targeted and duplicate claims", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await rename(join(root, "code", "sample-web"), join(root, "code", "web-app"));
  const workspaceConfig = await readWorkspaceConfig(root);
  workspaceConfig.ideas.sample.repositories.find(
    (repository) => repository.path === "sample-web",
  ).path = "web-app";
  await writeWorkspaceConfig(root, workspaceConfig);
  const brokenConfig = getRepositoryConfigPath(join(root, "code", "sample-mobile"));
  await writeFile(brokenConfig, "kind: repository\nartifacts: [\n", "utf8");

  const pathChange = await createChange(root, "sample", "healthy-path-target", {
    date: "2026-08-09",
    repositories: ["code/web-app"],
  });
  assert.deepEqual(pathChange.repositories.map((repository) => repository.id), ["sample-web"]);
  const idChange = await createChange(root, "sample", "healthy-id-target", {
    date: "2026-08-09",
    repositories: ["sample-web"],
  });
  assert.deepEqual(idChange.repositories.map((repository) => repository.id), ["sample-web"]);
  assert.equal((await createEpic(root, "sample", "SAMPLE-E905", "healthy-path", {
    date: "2026-08-09",
    repositories: ["code/web-app"],
  })).validation.valid, true);
  assert.equal((await createEpic(root, "sample", "SAMPLE-E906", "healthy-id", {
    date: "2026-08-09",
    repositories: ["sample-web"],
  })).validation.valid, true);
  await assert.rejects(
    () => createChange(root, "sample", "unknown-target", {
      date: "2026-08-09",
      repositories: ["unknown-repository"],
    }),
    (error) =>
      error instanceof SddError
      && error.code === "REPOSITORY_NOT_FOUND"
      && error.details.includes("Available repository: sample-web (code/web-app)")
      && error.details.includes("code/sample-mobile: INVALID_YAML"),
  );

  await assert.rejects(
    () => createChange(root, "sample", "broken-target", {
      date: "2026-08-09",
      repositories: ["sample-mobile"],
    }),
    (error) => error instanceof SddError && error.code === "INVALID_YAML",
  );
  await assert.rejects(
    () => createEpic(root, "sample", "SAMPLE-E907", "broken-target", {
      date: "2026-08-09",
      repositories: ["sample-mobile"],
    }),
    (error) => error instanceof SddError && error.code === "INVALID_YAML",
  );
  await rm(brokenConfig);
  await symlink(getRepositoryConfigPath(join(root, "code", "web-app")), brokenConfig);
  await assert.rejects(
    () => createEpic(root, "sample", "SAMPLE-E907", "symlink-config", {
      date: "2026-08-09",
      repositories: ["sample-mobile"],
    }),
    (error) => error instanceof SddError && error.code === "UNSAFE_CONFIG_PATH",
  );
  await rm(brokenConfig);

  await writeRepositoryConfig(
    join(root, "code", "sample-mobile"),
    createRepositoryConfig("sample-web"),
  );
  await assert.rejects(
    () => createChange(root, "sample", "duplicate-target", {
      date: "2026-08-09",
      repositories: ["code/web-app"],
    }),
    (error) => error instanceof SddError && error.code === "REPOSITORY_ID_COLLISION",
  );
  await assert.rejects(
    () => createEpic(root, "sample", "SAMPLE-E908", "duplicate-target", {
      date: "2026-08-09",
      repositories: ["code/web-app"],
    }),
    (error) => error instanceof SddError && error.code === "REPOSITORY_ID_COLLISION",
  );
});

test("Epic create allows a selected mapping without portable config and confines custom roots physically", async (t) => {
  const root = await createMappedWorkspace();
  const outside = await createWorkspace("sdd-epic-create-artifact-escape-");
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await initWorkspace(root);
  const repositoryRoot = join(root, "code", "sample-web");
  await rm(getRepositoryConfigPath(repositoryRoot));

  const missingConfig = await createEpic(root, "sample", "SAMPLE-E909", "missing-config", {
    date: "2026-08-09",
    repositories: ["sample-web"],
  });
  assert.equal(Object.hasOwn(missingConfig.repository, "id"), false);
  assert.equal(missingConfig.validation.valid, true);

  const unsafeConfig = createRepositoryConfig("sample-web");
  unsafeConfig.artifacts.epics = "custom/epics";
  await writeRepositoryConfig(repositoryRoot, unsafeConfig);
  await symlink(outside, join(repositoryRoot, "custom"));
  await assert.rejects(
    () => createEpic(root, "sample", "SAMPLE-E910", "escaped-root", {
      date: "2026-08-09",
      repositories: ["sample-web"],
    }),
    (error) => error instanceof SddError && error.code === "UNSAFE_ARTIFACT_PATH",
  );
  assert.equal((await readdir(outside)).length, 0);
});

async function captureLifecycleAuthorityFile(path) {
  const state = await lstat(path, { bigint: true });
  return {
    path,
    identity: { dev: String(state.dev), ino: String(state.ino) },
    source: await readFile(path, "utf8"),
  };
}

async function assertLifecycleAuthorityFileCurrent(expected) {
  const current = await captureLifecycleAuthorityFile(expected.path);
  assert.deepEqual(current.identity, expected.identity);
  assert.equal(current.source, expected.source);
}

async function replaceLifecycleAuthorityFile(path, source) {
  const previous = await captureLifecycleAuthorityFile(path);
  const replacementPath = `${path}.selection-authority-replacement`;
  await writeFile(replacementPath, source, "utf8");
  await rename(replacementPath, path);
  const replacement = await captureLifecycleAuthorityFile(path);
  assert.notDeepEqual(replacement.identity, previous.identity);
  return replacement;
}

function lifecycleSelectionAuthorityMutations() {
  return [
    {
      label: "workspace config with identical bytes and a new inode",
      replace: async (root) => {
        const path = getWorkspaceConfigPath(root);
        return {
          proof: await replaceLifecycleAuthorityFile(path, await readFile(path, "utf8")),
        };
      },
    },
    {
      label: "workspace repository mapping with changed bytes",
      replace: async (root) => {
        const config = await readWorkspaceConfig(root);
        config.ideas.sample.repositories[0].path = "sample-web-remapped";
        await writeWorkspaceConfig(root, config);
        return {
          proof: await captureLifecycleAuthorityFile(getWorkspaceConfigPath(root)),
          assertSemantic: async () => {
            const current = await readWorkspaceConfig(root);
            assert.equal(current.ideas.sample.repositories[0].path, "sample-web-remapped");
          },
        };
      },
    },
    {
      label: "selected repository config with identical bytes and a new inode",
      replace: async (root) => {
        const path = getRepositoryConfigPath(join(root, "code", "sample-web"));
        return {
          proof: await replaceLifecycleAuthorityFile(path, await readFile(path, "utf8")),
        };
      },
    },
    {
      label: "selected repository config with changed identity and artifacts",
      replace: async (root) => {
        const repositoryRoot = join(root, "code", "sample-web");
        const config = createRepositoryConfig("replacement-web");
        config.artifacts.epics = "replacement/epics";
        await writeRepositoryConfig(repositoryRoot, config);
        return {
          proof: await captureLifecycleAuthorityFile(getRepositoryConfigPath(repositoryRoot)),
          assertSemantic: async () => {
            const current = await readRepositoryConfig(repositoryRoot);
            assert.equal(current.id, "replacement-web");
            assert.equal(current.artifacts.epics, "replacement/epics");
          },
        };
      },
    },
    {
      label: "unselected repository config creates a duplicate selected ID",
      replace: async (root) => {
        const repositoryRoot = join(root, "code", "sample-mobile");
        await writeRepositoryConfig(
          repositoryRoot,
          createRepositoryConfig("sample-web"),
        );
        return {
          proof: await captureLifecycleAuthorityFile(getRepositoryConfigPath(repositoryRoot)),
          assertSemantic: async () => {
            assert.equal((await readRepositoryConfig(repositoryRoot)).id, "sample-web");
          },
        };
      },
    },
  ];
}

function lifecycleSelectionAuthorityOperations() {
  const transitionId = "2026-08-09-transition-selection-authority";
  const closeId = "2026-08-09-close-selection-authority";
  return [
    {
      label: "Change create",
      prepare: async () => null,
      run: (root, replaceAuthority) => createChange(
        root,
        "sample",
        "selection-authority",
        {
          date: "2026-08-09",
          repositories: ["sample-web"],
          beforePublish: replaceAuthority,
        },
      ),
      assertUncommitted: async (root) => {
        assert.equal(
          await pathExists(getActiveChangePath("2026-08-09-selection-authority", root)),
          false,
        );
      },
    },
    {
      label: "Epic create",
      prepare: async () => null,
      run: (root, replaceAuthority) => createEpic(
        root,
        "sample",
        "SAMPLE-E911",
        "selection-authority",
        {
          date: "2026-08-09",
          repositories: ["sample-web"],
          beforePublish: replaceAuthority,
        },
      ),
      assertUncommitted: async (root) => {
        assert.equal(
          await pathExists(join(
            root,
            "code",
            "sample-web",
            "docs",
            "epics",
            "sample-e911-selection-authority",
          )),
          false,
        );
      },
    },
    {
      label: "Change transition",
      prepare: async (root) => {
        await writeChange(root, "sample-web", transitionId, "in_progress");
        return captureLifecycleAuthorityFile(join(
          getActiveChangePath(transitionId, root),
          "tasks.md",
        ));
      },
      run: (root, replaceAuthority) => transitionChange(
        root,
        "sample",
        transitionId,
        {
          from: "in_progress",
          to: "in_review",
          beforeCommit: replaceAuthority,
        },
      ),
      assertUncommitted: async (root, tasksProof) => {
        await assertLifecycleAuthorityFileCurrent(tasksProof);
        assert.equal(await pathExists(getClosedChangePath(transitionId, root)), false);
      },
    },
    {
      label: "Change close",
      prepare: async (root) => {
        await writeChange(root, "sample-web", closeId, "in_review");
        return captureLifecycleAuthorityFile(join(
          getActiveChangePath(closeId, root),
          "tasks.md",
        ));
      },
      run: (root, replaceAuthority) => closeChange(
        root,
        "sample",
        closeId,
        { beforeCommit: replaceAuthority },
      ),
      assertUncommitted: async (root, tasksProof) => {
        await assertLifecycleAuthorityFileCurrent(tasksProof);
        assert.equal(await pathExists(getClosedChangePath(closeId, root)), false);
      },
    },
  ];
}

test("lifecycle mutations reject replaced workspace and selected repository authority before commit", async (t) => {
  for (const operation of lifecycleSelectionAuthorityOperations()) {
    for (const mutation of lifecycleSelectionAuthorityMutations()) {
      await t.test(`${operation.label}: ${mutation.label}`, async (subtest) => {
        const root = await createMappedWorkspace();
        subtest.after(() => rm(root, { recursive: true, force: true }));
        await initWorkspace(root);
        const uncommittedProof = await operation.prepare(root);
        let replacement;

        await assert.rejects(
          () => operation.run(root, async () => {
            replacement = await mutation.replace(root);
          }),
          (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
        );

        await assertLifecycleAuthorityFileCurrent(replacement.proof);
        if (replacement.assertSemantic) await replacement.assertSemantic();
        await operation.assertUncommitted(root, uncommittedProof);
      });
    }
  }
});

test("Epic creation rechecks that a selected repository contract remains absent", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const repositoryRoot = join(root, "code", "sample-web");
  const repositoryConfigPath = getRepositoryConfigPath(repositoryRoot);
  await rm(repositoryConfigPath);
  let replacement;

  await assert.rejects(
    () => createEpic(root, "sample", "SAMPLE-E912", "absent-authority", {
      date: "2026-08-09",
      repositories: ["sample-web"],
      beforePublish: async () => {
        const config = createRepositoryConfig("late-web");
        config.artifacts.epics = "late/epics";
        await writeRepositoryConfig(repositoryRoot, config);
        replacement = await captureLifecycleAuthorityFile(repositoryConfigPath);
      },
    }),
    (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
  );

  await assertLifecycleAuthorityFileCurrent(replacement);
  assert.equal((await readRepositoryConfig(repositoryRoot)).id, "late-web");
  assert.equal(
    await pathExists(join(
      repositoryRoot,
      "docs",
      "epics",
      "sample-e912-absent-authority",
    )),
    false,
  );
  assert.equal(
    await pathExists(join(
      repositoryRoot,
      "late",
      "epics",
      "sample-e912-absent-authority",
    )),
    false,
  );
});

const CREATE_CRASH_SCRIPT = `
  import { createChange } from ${JSON.stringify(pathToFileURL(join(PACKAGE_ROOT, "src", "commands", "change-create.js")).href)};
  import { createEpic } from ${JSON.stringify(pathToFileURL(join(PACKAGE_ROOT, "src", "commands", "epic-create.js")).href)};
  const crashCase = JSON.parse(process.env.SDD_CREATE_CRASH_CASE);
  const crash = () => process.exit(93);
  const hooks = crashCase.point === "stage-root-reservation"
    ? { afterStageRootReservation: crash }
    : crashCase.point === "stage-root"
      ? { afterStageRootMkdir: crash }
      : crashCase.point === "stage-payload"
        ? { afterStagedPayload: ({ entryIndex }) => {
            if (entryIndex === crashCase.entryIndex) crash();
          } }
        : crashCase.point === "stage-progress"
          ? { afterStagedProgress: ({ entryIndex }) => {
              if (entryIndex === crashCase.entryIndex) crash();
            } }
          : crashCase.point === "stage-entry"
            ? { afterStagedEntry: ({ entryIndex }) => {
                if (entryIndex === crashCase.entryIndex) crash();
              } }
            : crashCase.point === "stage-complete"
              ? { afterStagingComplete: crash }
              : crashCase.point === "pre-handoff"
                ? { beforeHandoff: crash }
                : crashCase.point === "publication-journal-mkdir"
                  ? { afterPublicationJournalMkdir: crash }
                  : crashCase.point === "publication-live-owner"
                    ? { afterPublicationLiveOwner: crash }
                    : crashCase.point === "reservation-receipt-write"
                      ? { afterReservationReceiptWrite: crash }
                      : crashCase.point === "reservation-receipt"
                        ? { afterReservationReceipt: crash }
                      : crashCase.point === "reservation"
                        ? { afterReservation: crash }
                        : crashCase.point === "entry"
                          ? { afterEntryPublication: ({ entryIndex }) => {
                              if (entryIndex === 0) crash();
                            } }
                          : crashCase.point === "prepared"
                            ? { afterPublicationPrepared: crash }
                            : crashCase.point === "source-cleanup"
                              ? { afterSourceCleanup: crash }
                              : crashCase.point === "handoff-cleanup"
                                ? { afterHandoffCleanup: crash }
                                : crashCase.point === "journal-cleanup"
                                  ? { afterJournalCleanup: crash }
                                  : { afterOwnerMarkerCleanup: crash };
  if (crashCase.kind === "Change") {
    await createChange(crashCase.root, "sample", crashCase.slug, {
      date: "2026-08-09",
      repositories: ["sample-web"],
      ...hooks,
    });
  } else {
    await createEpic(crashCase.root, "sample", crashCase.epicId, crashCase.slug, {
      date: "2026-08-09",
      repositories: ["sample-web"],
      ...hooks,
    });
  }
`;

function prepublicationCrashRecoveryCreateCases(root) {
  const changePoints = [
    ["stage-root-reservation", null],
    ["stage-root", null],
    ...["stage-payload", "stage-progress", "stage-entry"].flatMap((point) =>
      [0, 1, 2].map((entryIndex) => [point, entryIndex])),
    ["stage-complete", null],
    ["pre-handoff", null],
    ["publication-journal-mkdir", null],
    ["publication-live-owner", null],
  ];
  const changeCases = changePoints.map(([point, entryIndex]) => {
    const suffix = entryIndex === null ? point : `${point}-${entryIndex}`;
    const slug = `crash-${suffix}`;
    return {
      kind: "Change",
      point,
      entryIndex,
      slug,
      destination: getActiveChangePath(`2026-08-09-${slug}`, root),
      retry: () => createChange(root, "sample", slug, {
        date: "2026-08-09",
        repositories: ["sample-web"],
      }),
      expectedFiles: ["design.md", "proposal.md", "tasks.md"],
    };
  });
  const epicPoints = [
    ["stage-root-reservation", "SAMPLE-E930"],
    ["stage-root", "SAMPLE-E931"],
    ["stage-payload", "SAMPLE-E932"],
    ["stage-progress", "SAMPLE-E933"],
    ["stage-entry", "SAMPLE-E934"],
    ["stage-complete", "SAMPLE-E935"],
    ["pre-handoff", "SAMPLE-E936"],
    ["publication-journal-mkdir", "SAMPLE-E937"],
    ["publication-live-owner", "SAMPLE-E938"],
  ];
  const epicCases = epicPoints.map(([point, epicId]) => {
    const slug = `crash-${point}`;
    return {
      kind: "Epic",
      point,
      entryIndex: ["stage-payload", "stage-progress", "stage-entry"].includes(point) ? 0 : null,
      epicId,
      slug,
      destination: join(
        root,
        "code",
        "sample-web",
        "docs",
        "epics",
        `${epicId.toLowerCase()}-${slug}`,
      ),
      retry: () => createEpic(root, "sample", epicId, slug, {
        date: "2026-08-09",
        repositories: ["sample-web"],
      }),
      expectedFiles: ["epic.md"],
    };
  });
  return [...changeCases, ...epicCases];
}

function crashRecoveryCreateCases(root) {
  return [
    ...prepublicationCrashRecoveryCreateCases(root),
    {
      kind: "Change",
      point: "reservation",
      slug: "crash-after-reservation",
      destination: getActiveChangePath("2026-08-09-crash-after-reservation", root),
      retry: () => createChange(root, "sample", "crash-after-reservation", {
        date: "2026-08-09",
        repositories: ["sample-web"],
      }),
      expectedFiles: ["design.md", "proposal.md", "tasks.md"],
    },
    {
      kind: "Change",
      point: "entry",
      slug: "crash-after-first-link",
      destination: getActiveChangePath("2026-08-09-crash-after-first-link", root),
      retry: () => createChange(root, "sample", "crash-after-first-link", {
        date: "2026-08-09",
        repositories: ["sample-web"],
      }),
      expectedFiles: ["design.md", "proposal.md", "tasks.md"],
    },
    {
      kind: "Epic",
      point: "reservation",
      epicId: "SAMPLE-E913",
      slug: "crash-after-reservation",
      destination: join(
        root,
        "code",
        "sample-web",
        "docs",
        "epics",
        "sample-e913-crash-after-reservation",
      ),
      retry: () => createEpic(root, "sample", "SAMPLE-E913", "crash-after-reservation", {
        date: "2026-08-09",
        repositories: ["sample-web"],
      }),
      expectedFiles: ["epic.md"],
    },
    {
      kind: "Epic",
      point: "entry",
      committed: true,
      epicId: "SAMPLE-E914",
      slug: "crash-after-first-link",
      destination: join(
        root,
        "code",
        "sample-web",
        "docs",
        "epics",
        "sample-e914-crash-after-first-link",
      ),
      retry: () => createEpic(root, "sample", "SAMPLE-E914", "crash-after-first-link", {
        date: "2026-08-09",
        repositories: ["sample-web"],
      }),
      expectedFiles: ["epic.md"],
    },
    {
      kind: "Change",
      point: "source-cleanup",
      committed: true,
      slug: "crash-after-source-cleanup",
      destination: getActiveChangePath("2026-08-09-crash-after-source-cleanup", root),
      retry: () => createChange(root, "sample", "crash-after-source-cleanup", {
        date: "2026-08-09",
        repositories: ["sample-web"],
      }),
      expectedFiles: ["design.md", "proposal.md", "tasks.md"],
    },
    {
      kind: "Change",
      point: "handoff-cleanup",
      committed: true,
      slug: "crash-after-handoff-cleanup",
      destination: getActiveChangePath("2026-08-09-crash-after-handoff-cleanup", root),
      retry: () => createChange(root, "sample", "crash-after-handoff-cleanup", {
        date: "2026-08-09",
        repositories: ["sample-web"],
      }),
      expectedFiles: ["design.md", "proposal.md", "tasks.md"],
    },
    {
      kind: "Change",
      point: "journal-cleanup",
      committed: true,
      slug: "crash-after-journal-cleanup",
      destination: getActiveChangePath("2026-08-09-crash-after-journal-cleanup", root),
      retry: () => createChange(root, "sample", "crash-after-journal-cleanup", {
        date: "2026-08-09",
        repositories: ["sample-web"],
      }),
      expectedFiles: ["design.md", "proposal.md", "tasks.md"],
    },
    {
      kind: "Change",
      point: "owner-marker-cleanup",
      committed: true,
      slug: "crash-after-owner-marker-cleanup",
      destination: getActiveChangePath("2026-08-09-crash-after-owner-marker-cleanup", root),
      retry: () => createChange(root, "sample", "crash-after-owner-marker-cleanup", {
        date: "2026-08-09",
        repositories: ["sample-web"],
      }),
      expectedFiles: ["design.md", "proposal.md", "tasks.md"],
    },
    {
      kind: "Epic",
      point: "source-cleanup",
      committed: true,
      epicId: "SAMPLE-E928",
      slug: "crash-after-source-cleanup",
      destination: join(
        root,
        "code",
        "sample-web",
        "docs",
        "epics",
        "sample-e928-crash-after-source-cleanup",
      ),
      retry: () => createEpic(root, "sample", "SAMPLE-E928", "crash-after-source-cleanup", {
        date: "2026-08-09",
        repositories: ["sample-web"],
      }),
      expectedFiles: ["epic.md"],
    },
    {
      kind: "Epic",
      point: "handoff-cleanup",
      committed: true,
      epicId: "SAMPLE-E920",
      slug: "crash-after-handoff-cleanup",
      destination: join(
        root,
        "code",
        "sample-web",
        "docs",
        "epics",
        "sample-e920-crash-after-handoff-cleanup",
      ),
      retry: () => createEpic(root, "sample", "SAMPLE-E920", "crash-after-handoff-cleanup", {
        date: "2026-08-09",
        repositories: ["sample-web"],
      }),
      expectedFiles: ["epic.md"],
    },
    {
      kind: "Epic",
      point: "journal-cleanup",
      committed: true,
      epicId: "SAMPLE-E921",
      slug: "crash-after-journal-cleanup",
      destination: join(
        root,
        "code",
        "sample-web",
        "docs",
        "epics",
        "sample-e921-crash-after-journal-cleanup",
      ),
      retry: () => createEpic(root, "sample", "SAMPLE-E921", "crash-after-journal-cleanup", {
        date: "2026-08-09",
        repositories: ["sample-web"],
      }),
      expectedFiles: ["epic.md"],
    },
    {
      kind: "Epic",
      point: "owner-marker-cleanup",
      committed: true,
      epicId: "SAMPLE-E927",
      slug: "crash-after-owner-marker-cleanup",
      destination: join(
        root,
        "code",
        "sample-web",
        "docs",
        "epics",
        "sample-e927-crash-after-owner-marker-cleanup",
      ),
      retry: () => createEpic(
        root,
        "sample",
        "SAMPLE-E927",
        "crash-after-owner-marker-cleanup",
        {
          date: "2026-08-09",
          repositories: ["sample-web"],
        },
      ),
      expectedFiles: ["epic.md"],
    },
    {
      kind: "Change",
      point: "reservation-receipt-write",
      slug: "crash-after-reservation-receipt-write",
      destination: getActiveChangePath("2026-08-09-crash-after-reservation-receipt-write", root),
      retry: () => createChange(root, "sample", "crash-after-reservation-receipt-write", {
        date: "2026-08-09",
        repositories: ["sample-web"],
      }),
      expectedFiles: ["design.md", "proposal.md", "tasks.md"],
    },
    {
      kind: "Change",
      point: "reservation-receipt",
      slug: "crash-after-reservation-receipt",
      destination: getActiveChangePath("2026-08-09-crash-after-reservation-receipt", root),
      retry: () => createChange(root, "sample", "crash-after-reservation-receipt", {
        date: "2026-08-09",
        repositories: ["sample-web"],
      }),
      expectedFiles: ["design.md", "proposal.md", "tasks.md"],
    },
    {
      kind: "Change",
      point: "prepared",
      committed: true,
      slug: "crash-after-publication-prepared",
      destination: getActiveChangePath("2026-08-09-crash-after-publication-prepared", root),
      retry: () => createChange(root, "sample", "crash-after-publication-prepared", {
        date: "2026-08-09",
        repositories: ["sample-web"],
      }),
      expectedFiles: ["design.md", "proposal.md", "tasks.md"],
    },
    {
      kind: "Epic",
      point: "reservation-receipt-write",
      epicId: "SAMPLE-E941",
      slug: "crash-after-reservation-receipt-write",
      destination: join(
        root,
        "code",
        "sample-web",
        "docs",
        "epics",
        "sample-e941-crash-after-reservation-receipt-write",
      ),
      retry: () => createEpic(
        root,
        "sample",
        "SAMPLE-E941",
        "crash-after-reservation-receipt-write",
        {
          date: "2026-08-09",
          repositories: ["sample-web"],
        },
      ),
      expectedFiles: ["epic.md"],
    },
    {
      kind: "Epic",
      point: "reservation-receipt",
      epicId: "SAMPLE-E939",
      slug: "crash-after-reservation-receipt",
      destination: join(
        root,
        "code",
        "sample-web",
        "docs",
        "epics",
        "sample-e939-crash-after-reservation-receipt",
      ),
      retry: () => createEpic(
        root,
        "sample",
        "SAMPLE-E939",
        "crash-after-reservation-receipt",
        {
          date: "2026-08-09",
          repositories: ["sample-web"],
        },
      ),
      expectedFiles: ["epic.md"],
    },
    {
      kind: "Epic",
      point: "prepared",
      committed: true,
      epicId: "SAMPLE-E940",
      slug: "crash-after-publication-prepared",
      destination: join(
        root,
        "code",
        "sample-web",
        "docs",
        "epics",
        "sample-e940-crash-after-publication-prepared",
      ),
      retry: () => createEpic(
        root,
        "sample",
        "SAMPLE-E940",
        "crash-after-publication-prepared",
        {
          date: "2026-08-09",
          repositories: ["sample-web"],
        },
      ),
      expectedFiles: ["epic.md"],
    },
  ];
}

test("Change and Epic create recover durable publication after child-process death", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);

  for (const crashCase of crashRecoveryCreateCases(root)) {
    await t.test(`${crashCase.kind}: ${crashCase.point}`, async () => {
      await assert.rejects(
        () => execFileAsync(process.execPath, [
          "--input-type=module",
          "--eval",
          CREATE_CRASH_SCRIPT,
        ], {
          env: {
            ...process.env,
            SDD_CREATE_CRASH_CASE: JSON.stringify({
              kind: crashCase.kind,
              point: crashCase.point,
              root,
              slug: crashCase.slug,
              epicId: crashCase.epicId,
            }),
          },
        }),
        (error) => error.code === 93,
      );

      const result = await crashCase.retry();
      assert.equal(result.dryRun, false);
      assert.deepEqual(
        (await readdir(crashCase.destination)).sort((left, right) => left.localeCompare(right)),
        crashCase.expectedFiles,
      );
      const hiddenTransactions = (await readdir(dirname(crashCase.destination))).filter((name) =>
        name.startsWith(".")
        && name.includes(basename(crashCase.destination))
        && name.includes(".sdd-"));
      assert.deepEqual(hiddenTransactions, []);
    });
  }
});

function ancestorSwapCreateCases(root) {
  return [
    {
      label: "Change",
      destination: getActiveChangePath("2026-08-09-ancestor-swap", root),
      ancestor: getChangesRoot(root),
      create: (beforePublish) => createChange(root, "sample", "ancestor-swap", {
        date: "2026-08-09",
        repositories: ["sample-web"],
        beforePublish,
      }),
    },
    {
      label: "Epic",
      destination: join(
        root,
        "code",
        "sample-web",
        "docs",
        "epics",
        "sample-e915-ancestor-swap",
      ),
      ancestor: join(root, "code", "sample-web", "docs", "epics"),
      create: (beforePublish) => createEpic(root, "sample", "SAMPLE-E915", "ancestor-swap", {
        date: "2026-08-09",
        repositories: ["sample-web"],
        beforePublish,
      }),
    },
  ];
}

test("Change and Epic create never mutate a same-content external ancestor replacement", async (t) => {
  for (const label of ["Change", "Epic"]) {
    await t.test(label, async (subtest) => {
      const root = await createMappedWorkspace();
      subtest.after(() => rm(root, { recursive: true, force: true }));
      await initWorkspace(root);
      const operation = ancestorSwapCreateCases(root)
        .find((candidate) => candidate.label === label);
      const outside = await createWorkspace(`sdd-${label.toLowerCase()}-ancestor-swap-`);
      subtest.after(() => rm(outside, { recursive: true, force: true }));
      const displaced = `${operation.ancestor}.owned-before-swap`;
      let outsideHash;

      await assert.rejects(
        () => operation.create(async () => {
          await rename(operation.ancestor, displaced);
          await rm(outside, { recursive: true });
          await cp(displaced, outside, { recursive: true });
          outsideHash = await hashDirectory(outside);
          assert.equal(await hashDirectory(displaced), outsideHash);
          await symlink(outside, operation.ancestor);
        }),
        (error) => error instanceof SddError
          && ["CONCURRENT_CHANGE", "MUTATION_RECOVERY_FAILED", "UNSAFE_ARTIFACT_PATH"].includes(error.code),
      );

      assert.equal(await hashDirectory(outside), outsideHash);
      assert.equal(await pathExists(join(outside, basename(operation.destination))), false);
    });
  }
});

test("Change and Epic create roll back publication when authority changes before final commit", async (t) => {
  const operations = [
    {
      label: "Change",
      destination: (root) => getActiveChangePath("2026-08-09-final-authority", root),
      create: (root, hookName, hook) => createChange(root, "sample", "final-authority", {
        date: "2026-08-09",
        repositories: ["sample-web"],
        [hookName]: hook,
      }),
    },
    {
      label: "Epic",
      destination: (root) => join(
        root,
        "code",
        "sample-web",
        "docs",
        "epics",
        "sample-e916-final-authority",
      ),
      create: (root, hookName, hook) => createEpic(
        root,
        "sample",
        "SAMPLE-E916",
        "final-authority",
        {
          date: "2026-08-09",
          repositories: ["sample-web"],
          [hookName]: hook,
        },
      ),
    },
  ];
  for (const operation of operations) {
    for (const hookName of ["afterReservation", "afterHandoffCleanup"]) {
      await t.test(`${operation.label}: ${hookName}`, async (subtest) => {
        const root = await createMappedWorkspace();
        subtest.after(() => rm(root, { recursive: true, force: true }));
        await initWorkspace(root);
        const configPath = getWorkspaceConfigPath(root);
        let replacement;
        await assert.rejects(
          () => operation.create(root, hookName, async () => {
            replacement = await replaceLifecycleAuthorityFile(
              configPath,
              await readFile(configPath, "utf8"),
            );
          }),
          (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
        );
        await assertLifecycleAuthorityFileCurrent(replacement);
        assert.equal(await pathExists(operation.destination(root)), false);
      });
    }
  }
});

test("Change create treats dangling closed-history links as collisions and rolls back active publication", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-08-09-dangling-closed-collision";
  const activePath = getActiveChangePath(changeId, root);
  const closedPath = getClosedChangePath(changeId, root);
  const danglingTarget = join(root, "missing-closed-change");

  await assert.rejects(
    () => createChange(root, "sample", "dangling-closed-collision", {
      date: "2026-08-09",
      repositories: ["sample-web"],
      afterReservation: async () => symlink(danglingTarget, closedPath),
    }),
    (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
  );
  assert.equal(await pathExists(activePath), false);
  assert.equal(await readlink(closedPath), danglingTarget);
});

test("Change close rechecks selected authority at destination and retirement boundaries", async (t) => {
  const cases = [
    {
      label: "before destination claim",
      hook: "beforeDestinationClaim",
    },
    {
      label: "before recovery-backup claim",
      hook: "beforeBackupClaim",
    },
  ];
  for (const [index, race] of cases.entries()) {
    await t.test(race.label, async (subtest) => {
      const root = await createMappedWorkspace();
      subtest.after(() => rm(root, { recursive: true, force: true }));
      await initWorkspace(root);
      const changeId = `2026-08-09-close-late-authority-${index + 1}`;
      const activePath = getActiveChangePath(changeId, root);
      const closedPath = getClosedChangePath(changeId, root);
      const configPath = getRepositoryConfigPath(join(root, "code", "sample-web"));
      await writeChange(root, "sample-web", changeId, "in_review");
      const tasksProof = await captureLifecycleAuthorityFile(join(activePath, "tasks.md"));
      let replacement;
      let recoveryPath = null;

      await assert.rejects(
        () => closeChange(root, "sample", changeId, {
          [race.hook]: async (context) => {
            recoveryPath = context.recoveryPath ?? null;
            replacement = await replaceLifecycleAuthorityFile(
              configPath,
              await readFile(configPath, "utf8"),
            );
          },
        }),
        (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
      );

      await assertLifecycleAuthorityFileCurrent(replacement);
      await assertLifecycleAuthorityFileCurrent(tasksProof);
      assert.equal(await pathExists(activePath), true);
      assert.equal(await pathExists(closedPath), false);
      if (recoveryPath) assert.equal(await pathExists(recoveryPath), false);
    });
  }
});

test("Change transition restores the source when selected authority changes after backup", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-08-09-transition-late-authority";
  const activePath = getActiveChangePath(changeId, root);
  const tasksPath = join(activePath, "tasks.md");
  const configPath = getRepositoryConfigPath(join(root, "code", "sample-web"));
  await writeChange(root, "sample-web", changeId, "in_progress");
  const tasksProof = await captureLifecycleAuthorityFile(tasksPath);
  let replacement;
  let temporaryPath;
  let backupPath;

  await assert.rejects(
    () => transitionChange(root, "sample", changeId, {
      from: "in_progress",
      to: "in_review",
      afterBackup: async (context) => {
        temporaryPath = context.temporaryPath;
        backupPath = context.backupPath;
        replacement = await replaceLifecycleAuthorityFile(
          configPath,
          await readFile(configPath, "utf8"),
        );
      },
    }),
    (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
  );

  await assertLifecycleAuthorityFileCurrent(replacement);
  await assertLifecycleAuthorityFileCurrent(tasksProof);
  assert.equal(await pathExists(getClosedChangePath(changeId, root)), false);
  assert.equal(await pathExists(temporaryPath), false);
  assert.equal(await pathExists(backupPath), false);
});

test("Change close recovers the active Change when authority changes after retirement", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const changeId = "2026-08-09-close-post-move-authority";
  const activePath = getActiveChangePath(changeId, root);
  const closedPath = getClosedChangePath(changeId, root);
  const configPath = getRepositoryConfigPath(join(root, "code", "sample-web"));
  await writeChange(root, "sample-web", changeId, "in_review");
  const tasksProof = await captureLifecycleAuthorityFile(join(activePath, "tasks.md"));
  let replacement;

  await assert.rejects(
    () => closeChange(root, "sample", changeId, {
      afterMove: async () => {
        replacement = await replaceLifecycleAuthorityFile(
          configPath,
          await readFile(configPath, "utf8"),
        );
      },
    }),
    (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
  );

  await assertLifecycleAuthorityFileCurrent(replacement);
  await assertLifecycleAuthorityFileCurrent(tasksProof);
  assert.equal(await pathExists(activePath), true);
  assert.equal(await pathExists(closedPath), false);
});

test("Change and Epic publication never replace a raced handoff entry", async (t) => {
  for (const operation of createRaceOperations()) {
    for (const kind of ["empty directory", "file", "symlink", "nonempty directory"]) {
      await t.test(`${operation.label}: ${kind}`, async (subtest) => {
        const root = await createMappedWorkspace();
        subtest.after(() => rm(root, { recursive: true, force: true }));
        await initWorkspace(root);
        let handoffPath;
        let collision;
        await assert.rejects(
          () => operation.create(root, {
            afterTemporaryVerification: async (context) => {
              handoffPath = context.handoffPath;
              collision = await seedCreateCollisionEntry(kind, handoffPath, root);
            },
          }),
          (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
        );
        await assertCreateCollisionEntry(handoffPath, collision);
      });
    }
  }
});

test("Change and Epic publication do not adopt an immediate reservation replacement", async (t) => {
  for (const operation of createRaceOperations()) {
    await t.test(operation.label, async (subtest) => {
      const root = await createMappedWorkspace();
      subtest.after(() => rm(root, { recursive: true, force: true }));
      await initWorkspace(root);
      const destination = operation.destination(root);
      const displaced = `${destination}.immediate-owned-reservation`;
      let replacement;
      await assert.rejects(
        () => operation.create(root, {
          afterReservationMkdir: async ({ targetPath }) => {
            await rename(targetPath, displaced);
            await mkdir(targetPath);
            await writeFile(join(targetPath, "marker.txt"), "immediate replacement\n", "utf8");
            const state = await lstat(targetPath, { bigint: true });
            replacement = { dev: String(state.dev), ino: String(state.ino) };
          },
        }),
        (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
      );
      const current = await lstat(destination, { bigint: true });
      assert.deepEqual(
        { dev: String(current.dev), ino: String(current.ino) },
        replacement,
      );
      assert.equal(
        await readFile(join(destination, "marker.txt"), "utf8"),
        "immediate replacement\n",
      );
      const displacedNames = await readdir(displaced);
      assert.equal(displacedNames.length, 1);
      assert.equal(displacedNames[0].startsWith(".sdd-publication-reservation-"), true);
    });
  }
});

test("publication recovery preserves a same-mode replacement and its moved reservation", async (t) => {
  for (const operation of createRaceOperations()) {
    await t.test(operation.label, async (subtest) => {
      const root = await createMappedWorkspace();
      subtest.after(() => rm(root, { recursive: true, force: true }));
      await initWorkspace(root);
      const destination = operation.destination(root);
      const displaced = `${destination}.moved-reservation`;
      let replacementIdentity;
      await assert.rejects(
        () => operation.create(root, {
          afterReservation: async ({ targetPath }) => {
            const reserved = await lstat(targetPath, { bigint: true });
            await rename(targetPath, displaced);
            await mkdir(targetPath, { mode: Number(reserved.mode & 0o777n) });
            const replacement = await lstat(targetPath, { bigint: true });
            replacementIdentity = {
              dev: String(replacement.dev),
              ino: String(replacement.ino),
            };
          },
        }),
        (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
      );
      const current = await lstat(destination, { bigint: true });
      assert.deepEqual(
        { dev: String(current.dev), ino: String(current.ino) },
        replacementIdentity,
      );
      assert.deepEqual(await readdir(destination), []);
      assert.deepEqual(await readdir(displaced), []);
      const journalPath = join(
        dirname(destination),
        `.${basename(destination)}.sdd-publication`,
      );
      assert.equal(await pathExists(journalPath), true);
    });
  }
});

test("same-process publication recovery cannot take over a live operation token", async (t) => {
  const root = await createWorkspace("sdd-publication-live-token-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const targetPath = join(root, "published");
  const entries = [["entry.txt", "owned publication\n"]];
  const staged = await stageFlatDirectory(root, "published", entries, {
    ownerRoot: root,
  });
  let entered;
  let release;
  const enteredGate = new Promise((resolveEntered) => {
    entered = resolveEntered;
  });
  const releaseGate = new Promise((resolveRelease) => {
    release = resolveRelease;
  });
  const publishing = publishFlatDirectoryWithoutReplace(staged, targetPath, {
    beforePublish: async () => {
      await rm(staged.stagingJournal.path, { recursive: true, force: true });
      await rm(staged.stagingJournal.reservationPath, { force: true });
      entered();
      await releaseGate;
    },
  });
  await enteredGate;
  await assert.rejects(
    () => recoverFlatDirectoryPublication(targetPath, entries, {
      ownerRoot: root,
    }),
    (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
  );
  release();
  const prepared = await publishing;
  const finalized = await prepared.finalize();
  await assertPublishedFlatDirectory(finalized.publication);
});

const AGED_LIVE_PUBLICATION_OWNER_SCRIPT = `
  import { readFile, rm, writeFile } from "node:fs/promises";
  import { basename, dirname, join } from "node:path";
  import {
    publishFlatDirectoryWithoutReplace,
    stageFlatDirectory,
  } from ${JSON.stringify(pathToFileURL(join(PACKAGE_ROOT, "src", "directory-publication.js")).href)};
  const scenario = JSON.parse(process.env.SDD_AGED_LIVE_PUBLICATION_OWNER);
  const targetPath = join(scenario.root, "published");
  const entries = [["entry.txt", "aged live owner\\n"]];
  const staged = await stageFlatDirectory(scenario.root, "published", entries, {
    ownerRoot: scenario.root,
  });
  await publishFlatDirectoryWithoutReplace(staged, targetPath, {
    beforePublish: async () => {
      await rm(staged.stagingJournal.path, { recursive: true, force: true });
      await rm(staged.stagingJournal.reservationPath, { force: true });
      const journalPath = join(
        dirname(targetPath),
        \`.\${basename(targetPath)}.sdd-publication\`,
      );
      const intentPath = join(journalPath, "intent.json");
      const intent = JSON.parse(await readFile(intentPath, "utf8"));
      intent.createdAt = "2000-01-01T00:00:00.000Z";
      await writeFile(intentPath, \`\${JSON.stringify(intent)}\\n\`, "utf8");
      await writeFile(scenario.readyPath, "ready\\n", "utf8");
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    },
  });
`;

test("an aged publication journal remains owned across processes while its creator is live", async (t) => {
  const root = await createWorkspace("sdd-aged-live-publication-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const readyPath = join(root, "aged-live-owner.ready");
  const child = execFile(process.execPath, [
    "--input-type=module",
    "--eval",
    AGED_LIVE_PUBLICATION_OWNER_SCRIPT,
  ], {
    env: {
      ...process.env,
      SDD_AGED_LIVE_PUBLICATION_OWNER: JSON.stringify({ root, readyPath }),
    },
  });
  t.after(() => child.kill());
  for (let attempt = 0; attempt < 200 && !(await pathExists(readyPath)); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(await pathExists(readyPath), true);
  await assert.rejects(
    () => recoverFlatDirectoryPublication(
      join(root, "published"),
      [["entry.txt", "aged live owner\n"]],
      { ownerRoot: root },
    ),
    (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
  );
});

const RELEASED_PUBLICATION_OWNER_SCRIPT = `
  import { rm, mkdir, rename, writeFile } from "node:fs/promises";
  import { join } from "node:path";
  import { createEpic } from ${JSON.stringify(pathToFileURL(join(PACKAGE_ROOT, "src", "commands", "epic-create.js")).href)};
  const scenario = JSON.parse(process.env.SDD_RELEASED_PUBLICATION_OWNER);
  const destination = join(
    scenario.root,
    "code",
    "sample-web",
    "docs",
    "epics",
    "sample-e924-released-live-owner",
  );
  const displaced = destination + ".displaced";
  try {
    await createEpic(
      scenario.root,
      "sample",
      "SAMPLE-E924",
      "released-live-owner",
      {
        date: "2026-08-09",
        repositories: ["sample-web"],
        afterReservation: async ({ targetPath }) => {
          await rename(targetPath, displaced);
          await mkdir(targetPath);
          await writeFile(join(targetPath, "replacement.txt"), "replacement\\n");
        },
      },
    );
  } catch {
    await rm(destination, { recursive: true, force: true });
    await rm(displaced, { recursive: true, force: true });
  }
  await writeFile(scenario.readyPath, "ready\\n");
  await new Promise((resolve) => setTimeout(resolve, 60_000));
`;

test("cross-process recovery can claim a released token while its creator process remains alive", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const readyPath = join(root, "released-publication-owner.ready");
  const child = execFile(process.execPath, [
    "--input-type=module",
    "--eval",
    RELEASED_PUBLICATION_OWNER_SCRIPT,
  ], {
    env: {
      ...process.env,
      SDD_RELEASED_PUBLICATION_OWNER: JSON.stringify({ root, readyPath }),
    },
  });
  t.after(() => child.kill());
  for (let attempt = 0; attempt < 200 && !(await pathExists(readyPath)); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(await pathExists(readyPath), true);
  const recovered = await createEpic(
    root,
    "sample",
    "SAMPLE-E924",
    "released-live-owner",
    {
      date: "2026-08-09",
      repositories: ["sample-web"],
    },
  );
  assert.equal(recovered.validation.valid, true);
});

test("recovered complete Epic publication is validated before it is accepted", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const destination = join(
    root,
    "code",
    "sample-web",
    "docs",
    "epics",
    "sample-e925-recovered-validation",
  );
  await assert.rejects(
    () => execFileAsync(process.execPath, [
      "--input-type=module",
      "--eval",
      CREATE_CRASH_SCRIPT,
    ], {
      env: {
        ...process.env,
        SDD_CREATE_CRASH_CASE: JSON.stringify({
          kind: "Epic",
          point: "entry",
          root,
          slug: "recovered-validation",
          epicId: "SAMPLE-E925",
        }),
      },
    }),
    (error) => error.code === 93,
  );
  const duplicate = join(dirname(destination), "sample-e925-concurrent-duplicate");
  await mkdir(duplicate);
  await writeFile(
    join(duplicate, "epic.md"),
    await readFile(join(destination, "epic.md"), "utf8"),
    "utf8",
  );
  await assert.rejects(
    () => createEpic(root, "sample", "SAMPLE-E925", "recovered-validation", {
      date: "2026-08-09",
      repositories: ["sample-web"],
    }),
    (error) => error instanceof SddError
      && error.code === "INVALID_EPIC_TEMPLATE"
      && error.details.some((detail) => detail.includes("DUPLICATE_EPIC_ID")),
  );
  assert.equal(await pathExists(destination), false);
  assert.equal(await pathExists(join(duplicate, "epic.md")), true);
});

test("recovered complete Epic publication rolls back on final authority drift", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  const destination = join(
    root,
    "code",
    "sample-web",
    "docs",
    "epics",
    "sample-e926-recovered-authority",
  );
  await assert.rejects(
    () => execFileAsync(process.execPath, [
      "--input-type=module",
      "--eval",
      CREATE_CRASH_SCRIPT,
    ], {
      env: {
        ...process.env,
        SDD_CREATE_CRASH_CASE: JSON.stringify({
          kind: "Epic",
          point: "owner-marker-cleanup",
          root,
          slug: "recovered-authority",
          epicId: "SAMPLE-E926",
        }),
      },
    }),
    (error) => error.code === 93,
  );
  const configPath = getWorkspaceConfigPath(root);
  let replacement;
  await assert.rejects(
    () => createEpic(root, "sample", "SAMPLE-E926", "recovered-authority", {
      date: "2026-08-09",
      repositories: ["sample-web"],
      validate: async () => {
        replacement = await replaceLifecycleAuthorityFile(
          configPath,
          await readFile(configPath, "utf8"),
        );
        return { valid: true, findings: [] };
      },
    }),
    (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
  );
  await assertLifecycleAuthorityFileCurrent(replacement);
  assert.equal(await pathExists(destination), false);
});


test("lifecycle commit rechecks preserve unreadable and unsafe collision witnesses", async (t) => {
  const operations = lifecycleSelectionAuthorityOperations();
  const mutations = [
    {
      label: "unrelated config mode change",
      apply: async (root) => {
        const path = getRepositoryConfigPath(join(root, "code", "sample-mobile"));
        await chmod(path, 0o000);
        return async () => {
          const state = await lstat(path);
          assert.equal(Number(state.mode & 0o777), 0);
        };
      },
    },
    {
      label: "unrelated config becomes malformed",
      apply: async (root) => {
        const path = getRepositoryConfigPath(join(root, "code", "sample-mobile"));
        const source = "kind: repository\nid: [\n";
        await writeFile(path, source, "utf8");
        return async () => {
          assert.equal(await readFile(path, "utf8"), source);
        };
      },
    },
    {
      label: "unrelated config becomes a symlink to the selected identity",
      apply: async (root) => {
        const path = getRepositoryConfigPath(join(root, "code", "sample-mobile"));
        const selectedPath = getRepositoryConfigPath(join(root, "code", "sample-web"));
        const displacedPath = `${path}.collision-witness-original`;
        const originalSource = await readFile(path, "utf8");
        await rename(path, displacedPath);
        await symlink(selectedPath, path);
        return async () => {
          assert.equal(await readlink(path), selectedPath);
          assert.equal(await readFile(displacedPath, "utf8"), originalSource);
        };
      },
    },
  ];

  for (const operation of operations) {
    for (const mutation of mutations) {
      await t.test(`${operation.label}: ${mutation.label}`, async (subtest) => {
        const root = await createMappedWorkspace();
        subtest.after(() => rm(root, { recursive: true, force: true }));
        await initWorkspace(root);
        const uncommittedProof = await operation.prepare(root);
        let assertMutationPreserved;

        await assert.rejects(
          () => operation.run(root, async () => {
            assertMutationPreserved = await mutation.apply(root);
          }),
          (error) => error instanceof SddError
            && error.code === "CONCURRENT_CHANGE"
            && error.details.some((detail) => detail.includes("code/sample-mobile")),
        );

        await assertMutationPreserved();
        await operation.assertUncommitted(root, uncommittedProof);
      });
    }
  }
});