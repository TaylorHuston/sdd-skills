import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";

import { getWorkspaceContext } from "../src/commands/context.js";
import { diagnoseWorkspace } from "../src/commands/doctor.js";
import { initWorkspace } from "../src/commands/init.js";
import { updateWorkspace } from "../src/commands/update.js";
import { getConfigPath, readConfig, writeConfig } from "../src/config.js";
import { SddError } from "../src/errors.js";
import { pathExists } from "../src/fs.js";
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

test("init creates a local workspace contract and imports one-to-many mappings", async (t) => {
  const root = await createMappedWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await initWorkspace(root);
  assert.equal(result.created, true);
  assert.equal(result.ideasImported, 1);
  assert.equal(result.skills.actions.length, 13);
  assert.ok(result.skills.actions.every((entry) => entry.action === "install"));

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
  assert.equal(planning.planningPath, "ideas/sample");
  assert.equal(planning.relatedRepositories.length, 2);

  const repository = await getWorkspaceContext(join(root, "code", "sample-mobile"));
  assert.equal(repository.kind, "repository");
  assert.equal(repository.idea, "sample");
  assert.equal(repository.repository.role, "mobile");
  assert.equal(repository.repository.resolvedPath, "code/sample-mobile");
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
