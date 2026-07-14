import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";

import { getWorkspaceContext } from "../src/commands/context.js";
import { diagnoseWorkspace } from "../src/commands/doctor.js";
import { initWorkspace } from "../src/commands/init.js";
import { getStatus } from "../src/commands/status.js";
import { statusSummaryRows } from "../src/cli.js";
import { updateWorkspace } from "../src/commands/update.js";
import { getConfigPath, getInstallLockPath, readConfig, writeConfig } from "../src/config.js";
import { WORKFLOW_SOURCE_PATH } from "../src/constants.js";
import { SddError } from "../src/errors.js";
import { hashDirectory, pathExists } from "../src/fs.js";
import { collectInitOptions } from "../src/prompts.js";

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

test("init creates a local workspace contract and imports one-to-many mappings", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await initWorkspace(root);
  assert.equal(result.created, true);
  assert.equal(result.ideasImported, 1);
  assert.equal(result.skills.actions.length, 12);
  assert.ok(result.skills.actions.every((entry) => entry.action === "install"));
  assert.equal(result.workflow.action, "install");

  const config = parse(await readFile(getConfigPath(root), "utf8"));
  assert.equal(config.planning.root, "ideas");
  assert.deepEqual(config.repositories.roots, { code: "code" });
  assert.equal(config.ideas.sample.planning, undefined);
  assert.deepEqual(config.ideas.sample.repositories, [
    { root: "code", path: "sample-web", role: "web" },
    { root: "code", path: "sample-mobile", role: "mobile" },
  ]);
  assert.equal(await pathExists(join(root, ".agents", "skills", "sdd-propose", "SKILL.md")), true);
  assert.equal(await pathExists(join(root, ".sdd", "install-lock.json")), true);
  assert.equal(
    await readFile(join(root, ".sdd", "story-driven-development.md"), "utf8"),
    await readFile(WORKFLOW_SOURCE_PATH, "utf8"),
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

  const managedSkill = join(root, ".agents", "skills", "sdd-propose", "SKILL.md");
  await writeFile(managedSkill, `${await readFile(managedSkill, "utf8")}\nlocal edit\n`, "utf8");

  await assert.rejects(
    () => updateWorkspace(root),
    (error) => error instanceof SddError && error.code === "SKILL_CONFLICT",
  );

  const diagnosis = await diagnoseWorkspace(root);
  assert.equal(diagnosis.healthy, false);
  assert.ok(diagnosis.findings.some((finding) => finding.message.includes("sdd-propose")));
});

test("forced update restores a conflicting managed skill", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);

  const managedSkill = join(root, ".agents", "skills", "sdd-propose", "SKILL.md");
  await writeFile(managedSkill, "local replacement\n", "utf8");

  const result = await updateWorkspace(root, { force: true });
  assert.equal(
    result.skills.actions.find((entry) => entry.skillName === "sdd-propose").action,
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

test("closed Change state comes from folder location, not a closed status value", async (t) => {
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
  assert.deepEqual(config.ideas.sample.repositories[0], {
    root: "code",
    path: "sample-web",
    role: "web",
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
  assert.equal(planning.relatedRepositories.length, 2);

  const repository = await getWorkspaceContext(join(root, "code", "sample-mobile"));
  assert.equal(repository.kind, "repository");
  assert.equal(repository.idea, "sample");
  assert.equal(repository.spaceId, "sample");
  assert.equal(repository.repository.role, "mobile");
  assert.equal(repository.repository.resolvedPath, "code/sample-mobile");
});

test("status summarizes every Space and prefers its newest active Change", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeChange(root, "sample-web", "2026-07-10-older-active", "in_progress");
  await writeChange(root, "sample-mobile", "2026-07-12-newer-active", "review");
  await writeChange(root, "sample-web", "2026-07-14-newest-closed", "ready_to_close", {
    closed: true,
  });

  const result = await getStatus(root);
  assert.equal(result.mode, "summary");
  assert.equal(result.spaces.length, 1);
  assert.equal(result.spaces[0].spaceId, "sample");
  assert.equal(result.spaces[0].activeChangeCount, 2);
  assert.equal(result.spaces[0].change.changeId, "2026-07-12-newer-active");
  assert.equal(result.spaces[0].change.status, "review");
  assert.deepEqual(
    result.spaces[0].repositoryActivity.map((repository) => ({
      repository: repository.resolvedPath,
      role: repository.role,
      activeChangeCount: repository.activeChangeCount,
      activeChanges: repository.activeChanges.map((change) => change.changeId),
    })),
    [
      {
        repository: "code/sample-web",
        role: "web",
        activeChangeCount: 1,
        activeChanges: ["2026-07-10-older-active"],
      },
      {
        repository: "code/sample-mobile",
        role: "mobile",
        activeChangeCount: 1,
        activeChanges: ["2026-07-12-newer-active"],
      },
    ],
  );
  assert.deepEqual(statusSummaryRows(result), [
    ["sample", "web", "in_progress", "2026-07-10-older-active", "code/sample-web", 1],
    ["sample", "mobile", "review", "2026-07-12-newer-active", "code/sample-mobile", 1],
  ]);
});

test("status summary omits Spaces without active Changes", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await initWorkspace(root);
  await writeChange(root, "sample-web", "2026-07-14-latest-closed", "ready_to_close", {
    closed: true,
  });

  const result = await getStatus(root);
  assert.deepEqual(statusSummaryRows(result), []);
});

test("status details one Space with Epics and its five newest Changes", async (t) => {
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
      day === 6 ? "review" : "ready_to_close",
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
      role: repository.role,
      activeChangeCount: repository.activeChangeCount,
    })),
    [
      { role: "web", activeChangeCount: 1 },
      { role: "mobile", activeChangeCount: 0 },
    ],
  );
  assert.equal(result.epics.length, 1);
  assert.equal(result.repositoryDetails.length, 2);
  assert.deepEqual(
    result.repositoryDetails.map((repository) => ({
      role: repository.role,
      activeChangeCount: repository.activeChangeCount,
      epicIds: repository.epics.map((epic) => epic.id),
      changeIds: repository.changes.map((change) => change.changeId),
    })),
    [
      {
        role: "web",
        activeChangeCount: 1,
        epicIds: ["SAMPLE-E001"],
        changeIds: ["2026-07-06-change-6", "2026-07-04-change-4", "2026-07-02-change-2"],
      },
      {
        role: "mobile",
        activeChangeCount: 0,
        epicIds: [],
        changeIds: ["2026-07-05-change-5", "2026-07-03-change-3", "2026-07-01-change-1"],
      },
    ],
  );
  assert.deepEqual(
    { id: result.epics[0].id, title: result.epics[0].title, status: result.epics[0].status },
    { id: "SAMPLE-E001", title: "Core Experience", status: "active" },
  );
  assert.equal(result.changes.length, 5);
  assert.equal(result.changes[0].changeId, "2026-07-06-change-6");
  assert.equal(result.changes[0].status, "review");
  assert.equal(result.changes[1].status, "closed");
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
