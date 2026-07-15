import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { initWorkspace } from "../src/commands/init.js";
import { getStatus } from "../src/commands/status.js";
import { validateArtifacts } from "../src/commands/validate.js";
import { statusSummaryRows } from "../src/cli.js";
import { updateWorkspace } from "../src/commands/update.js";
import { getConfigPath, getInstallLockPath, readConfig, writeConfig } from "../src/config.js";
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
  const epicPath = join(root, "code", repository, "docs", "epics", "sample-e001-core");
  await mkdir(epicPath, { recursive: true });
  await writeFile(
    join(epicPath, "epic.md"),
    [
      "---",
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
      "| Story | Status | Capability | Last Verified | Notes |",
      "|---|---|---|---|---|",
      "| S1 | active | Core behavior. | 2026-07-14 | |",
      "",
      "## Stories",
      "",
      "### Story S1: Core Journey",
      "",
      "Status: active",
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
      "| Path | Role | Recheck Trigger |",
      "|---|---|---|",
      "| `src/core.js` | Primary | Recheck when the journey changes. |",
      "",
      "#### Verified By",
      "",
      "| Requirement / Scenario | Evidence | Proves | Status |",
      "|---|---|---|---|",
      "| S1/R1-S1 | `test/core.test.js` | Successful completion. | Passing 2026-07-14 |",
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

test("init creates a local workspace contract and imports one-to-many mappings", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await initWorkspace(root);
  assert.equal(result.created, true);
  assert.equal(result.ideasImported, 1);
  assert.equal(result.skills.actions.length, 13);
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

test("init dry-run reports work without writing workspace files", async (t) => {
  const root = await createWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await initWorkspace(root, { dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(await pathExists(join(root, ".sdd")), false);
  assert.equal(await pathExists(join(root, ".agents")), false);
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
  assert.match(source, /^id: SAMPLE-E002$/m);
  assert.match(source, /^# SAMPLE-E002 Saved Searches$/m);
  assert.match(source, /^## Notes$/m);
  assert.match(source, /^#### Story Notes$/m);
  assert.match(source, /^\| Path \| Role \| Recheck Trigger \|$/m);
  assert.match(source, /^\| Requirement \/ Scenario \| Evidence \| Proves \| Status \|$/m);
  assert.doesNotMatch(source, /EPIC-ID|Epic Name|yyyy-mm-dd/);
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
  await writeFile(epicPath, source.replace("| S1 | active |", "| S9 | active |"), "utf8");

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
