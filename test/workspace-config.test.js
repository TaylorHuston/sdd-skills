import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  assertValidConfig,
  assertWorkspaceConfigSnapshotCurrent,
  assertWorkspaceRootIsNotLegacyHome,
  createRepositoryConfig,
  createInitialConfig,
  createWorkspaceConfigFromLegacyHome,
  getLegacyUserConfigPath,
  getRepositoryConfigPath,
  getWorkspaceConfigDirectory,
  getWorkspaceConfigPath,
  findRepositoryRoot,
  findWorkspaceRoot,
  resolveIdeaPlanningPath,
  resolveRepositoryPath,
  migrateWorkspaceConfig,
  readLegacyUserConfig,
  readRepositoryConfig,
  readWorkspaceConfig,
  readWorkspaceConfigSnapshot,
  toWorkspaceConfigPath,
  resolveRepositoryArtifactPath,
  resolveWorkspacePath,
  resolveWorkspaceSkillsDirectory,
  validateConfig,
  validateLegacyUserConfig,
  validateRepositoryConfig,
  writeRepositoryConfig,
  writeWorkspaceConfig,
} from "../src/config.js";
import { setupInstallation } from "../src/commands/init-installation.js";
import { assertRepositoryArtifactRoots } from "../src/change-repositories.js";
import { pathExists } from "../src/fs.js";
import { planUpdateMigration } from "../src/update-migration.js";
import {
  assertDistinctRepositoryOwnership,
  resolveWorkspaceContext,
} from "../src/workspace.js";

function workspaceConfig(repositoryRoot = "repositories") {
  return {
    version: 3,
    schema: "sdd-v3",
    skills: { directory: ".agents/skills" },
    planning: { root: "planning" },
    repositories: { roots: { code: repositoryRoot } },
    repositoryArtifacts: {
      epics: "docs/epics",
      adrs: "docs/adrs",
      audits: "docs/audits",
    },
    ideas: {
      sample: {
        status: "active",
        repositories: [{ root: "code", path: ".", status: "active" }],
      },
    },
  };
}

function releasedLegacyUserV1Config() {
  return {
    kind: "user",
    version: 1,
    schema: "sdd-user-v1",
    skills: { directory: "~/.agents/skills" },
    planning: {
      root: "../shared-planning",
      plannedChangesDirectory: "planned-changes",
    },
    repositories: {
      roots: {
        source: "repositories",
        shared: "../shared-repositories",
        home: "~/external-repositories",
      },
    },
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
        planning: "~/sample",
        repositories: [
          { root: "source", path: "~/apps/sample", role: "primary", status: "active" },
          { root: "source", path: "../detached", status: "inactive" },
          { root: "home", path: "sample-worker", status: "active" },
          { path: "../shared-standalone", status: "archived" },
        ],
      },
      detached: {
        status: "inactive",
        planning: "../../detached-planning",
        repositories: [],
      },
    },
  };
}

async function temporaryRoot(t, prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("workspace discovery honors explicit, environment, target, and cwd precedence", async (t) => {
  const root = await temporaryRoot(t, "sdd-workspace-discovery-");
  const targetWorkspace = join(root, "target-workspace");
  const environmentWorkspace = join(root, "environment-workspace");
  const explicitWorkspace = join(root, "explicit-workspace");
  const target = join(targetWorkspace, "repositories", "nested");
  await Promise.all([
    mkdir(target, { recursive: true }),
    mkdir(environmentWorkspace, { recursive: true }),
    mkdir(explicitWorkspace, { recursive: true }),
  ]);

  await writeWorkspaceConfig(targetWorkspace, workspaceConfig());
  await writeWorkspaceConfig(environmentWorkspace, workspaceConfig(join(targetWorkspace, "repositories")));
  await writeWorkspaceConfig(explicitWorkspace, workspaceConfig(join(targetWorkspace, "repositories")));

  assert.equal(
    await findWorkspaceRoot(target, {
      workspaceRoot: explicitWorkspace,
      cwd: targetWorkspace,
      env: { SDD_WORKSPACE_ROOT: environmentWorkspace },
    }),
    explicitWorkspace,
  );
  assert.equal(
    await findWorkspaceRoot(target, {
      cwd: targetWorkspace,
      env: { SDD_WORKSPACE_ROOT: environmentWorkspace },
    }),
    environmentWorkspace,
  );
  assert.equal(await findWorkspaceRoot(target, { cwd: root, env: {} }), targetWorkspace);
});

test("ancestor discovery starts from file parents and rejects symbolic-link files", async (t) => {
  const root = await temporaryRoot(t, "sdd-workspace-file-discovery-");
  const workspaceRoot = join(root, "workspace");
  const repositoryRoot = join(workspaceRoot, "repositories", "sample");
  const sourceRoot = join(repositoryRoot, "src");
  const sourcePath = join(sourceRoot, "entry.js");
  const missingPath = join(sourceRoot, "future", "entry.js");
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(sourcePath, "export {};\n", "utf8");
  await writeWorkspaceConfig(workspaceRoot, workspaceConfig("repositories"));
  await writeRepositoryConfig(repositoryRoot, createRepositoryConfig("sample"));

  assert.equal(
    await findWorkspaceRoot(sourcePath, { cwd: root, env: {} }),
    workspaceRoot,
  );
  assert.equal(await findRepositoryRoot(sourcePath), repositoryRoot);
  assert.equal(
    await findWorkspaceRoot(missingPath, { cwd: root, env: {} }),
    workspaceRoot,
  );
  assert.equal(await findRepositoryRoot(missingPath), repositoryRoot);

  const sourceAlias = join(sourceRoot, "entry-alias.js");
  const danglingAlias = join(sourceRoot, "dangling-alias.js");
  await symlink(sourcePath, sourceAlias);
  await symlink(join(sourceRoot, "absent.js"), danglingAlias);
  for (const alias of [sourceAlias, danglingAlias]) {
    await assert.rejects(
      findWorkspaceRoot(alias, { cwd: root, env: {} }),
      (error) => error?.code === "UNSAFE_CONFIG_PATH",
    );
    await assert.rejects(
      findRepositoryRoot(alias),
      (error) => error?.code === "UNSAFE_CONFIG_PATH",
    );
  }
});

test("config writers reject missing and non-directory authority roots without creating them", async (t) => {
  const root = await temporaryRoot(t, "sdd-config-owner-required-");
  const missingOwner = join(root, "missing-owner");
  await assert.rejects(
    writeWorkspaceConfig(missingOwner, workspaceConfig()),
    (error) => error?.code === "UNSAFE_CONFIG_PATH"
      && error.message.includes("must already exist as a real directory")
      && error.details.includes(missingOwner),
  );
  assert.equal(await pathExists(missingOwner), false);

  const fileOwner = join(root, "file-owner");
  await writeFile(fileOwner, "not a directory\n", "utf8");
  await assert.rejects(
    writeRepositoryConfig(fileOwner, createRepositoryConfig("sample")),
    (error) => error?.code === "UNSAFE_CONFIG_PATH"
      && error.message.includes("must be a real directory")
      && error.details.includes(fileOwner),
  );
});

test("cwd workspace resolves a physically mapped external repository", async (t) => {
  const root = await temporaryRoot(t, "sdd-workspace-external-");
  const workspaceRoot = join(root, "workspace");
  const cwd = join(workspaceRoot, "tools", "nested");
  const repositoryRoot = join(root, "external-repository");
  const target = join(repositoryRoot, "src", "nested");
  await Promise.all([
    mkdir(cwd, { recursive: true }),
    mkdir(target, { recursive: true }),
  ]);
  await writeWorkspaceConfig(workspaceRoot, workspaceConfig(repositoryRoot));
  await writeRepositoryConfig(repositoryRoot, createRepositoryConfig("external-repository"));

  const context = await resolveWorkspaceContext(target, { cwd, env: {} });

  assert.equal(context.workspaceRoot, workspaceRoot);
  assert.equal(context.workspaceConfigPath, join(workspaceRoot, ".sdd", "config.yaml"));
  assert.equal(context.kind, "repository");
  assert.equal(context.repository.id, "external-repository");
  assert.equal(
    context.workflowPath,
    join(workspaceRoot, ".sdd", "story-driven-development.md"),
  );
});

test("physical containment ranking prefers an exact nested repository over a longer parent alias", async (t) => {
  const root = await temporaryRoot(t, "sdd-workspace-nested-repository-");
  const workspaceRoot = join(root, "workspace");
  const physicalParent = join(root, "repositories", "parent");
  const nestedRepository = join(physicalParent, "nested");
  const target = join(nestedRepository, "src", "feature");
  const parentAlias = join(
    workspaceRoot,
    "mapped-parent-repository-alias-with-a-deliberately-long-logical-path",
  );
  await Promise.all([
    mkdir(workspaceRoot, { recursive: true }),
    mkdir(target, { recursive: true }),
  ]);
  await symlink(physicalParent, parentAlias, "dir");
  await writeWorkspaceConfig(workspaceRoot, workspaceConfig(parentAlias));
  await writeRepositoryConfig(
    nestedRepository,
    createRepositoryConfig("nested-repository"),
  );

  const context = await resolveWorkspaceContext(target, {
    workspaceRoot,
    cwd: workspaceRoot,
    env: {},
  });

  assert.equal(context.kind, "repository");
  assert.equal(context.idea, null);
  assert.equal(context.spaceId, "nested-repository");
  assert.equal(context.repository.id, "nested-repository");
  assert.equal(context.repository.resolvedPath, nestedRepository);
});

test("an unmapped external target cannot borrow the cwd workspace", async (t) => {
  const root = await temporaryRoot(t, "sdd-workspace-unmapped-");
  const workspaceRoot = join(root, "workspace");
  const cwd = join(workspaceRoot, "nested");
  const externalTarget = join(root, "unmapped", "src");
  await Promise.all([
    mkdir(cwd, { recursive: true }),
    mkdir(externalTarget, { recursive: true }),
  ]);
  await writeWorkspaceConfig(workspaceRoot, workspaceConfig());

  await assert.rejects(
    findWorkspaceRoot(externalTarget, { cwd, env: {} }),
    (error) => error?.code === "WORKSPACE_TARGET_UNMAPPED",
  );
});

test("cwd fallback migrates a legacy v1 workspace before mapping an absolute external target", async (t) => {
  const root = await temporaryRoot(t, "sdd-workspace-legacy-cwd-");
  const workspaceRoot = join(root, "workspace");
  const cwd = join(workspaceRoot, "tools");
  const externalRoot = join(root, "external-repositories");
  const externalRepository = join(externalRoot, "sample");
  const externalTarget = join(externalRepository, "src", "entry.js");
  await Promise.all([
    mkdir(cwd, { recursive: true }),
    mkdir(join(externalRepository, "src"), { recursive: true }),
  ]);
  await writeFile(externalTarget, "export {};\n", "utf8");
  await writeWorkspaceConfig(workspaceRoot, {
    version: 1,
    schema: "sdd-v1",
    skills: { directory: ".agents/skills" },
    planning: { root: "ideas" },
    repositories: { roots: [externalRoot] },
    repositoryArtifacts: {
      epics: "docs/epics",
      adrs: "docs/adrs",
      audits: "docs/audits",
    },
    ideas: {
      sample: {
        status: "active",
        planning: "ideas/sample",
        repositories: [{ path: externalRepository, status: "active" }],
      },
    },
  });

  assert.equal(
    await findWorkspaceRoot(externalTarget, { cwd, env: {} }),
    workspaceRoot,
  );
});

test("cwd fallback validates malformed workspace authority before target containment", async (t) => {
  const root = await temporaryRoot(t, "sdd-workspace-malformed-cwd-");
  const workspaceRoot = join(root, "workspace");
  const cwd = join(workspaceRoot, "tools");
  const externalTarget = join(root, "external", "entry.js");
  await Promise.all([
    mkdir(cwd, { recursive: true }),
    mkdir(join(root, "external"), { recursive: true }),
  ]);
  await writeFile(externalTarget, "export {};\n", "utf8");
  const malformed = {
    version: 1,
    schema: "sdd-v1",
    skills: { directory: ".agents/skills" },
    planning: { root: "ideas" },
    repositories: { roots: [join(root, "external")] },
    repositoryArtifacts: {
      epics: "docs/epics",
      adrs: "docs/adrs",
      audits: "docs/audits",
    },
    ideas: {
      sample: {
        status: "active",
        planning: "ideas/sample",
        repositories: { path: externalTarget },
      },
    },
  };
  await writeWorkspaceConfig(workspaceRoot, malformed);

  await assert.rejects(
    findWorkspaceRoot(externalTarget, { cwd, env: {} }),
    (error) => error?.code === "INVALID_CONFIG" && !(error instanceof TypeError),
  );
});

test("workspace discovery never falls back to HOME or SDD_USER_HOME", async (t) => {
  const root = await temporaryRoot(t, "sdd-workspace-no-home-");
  const fakeHome = join(root, "home");
  const cwd = join(root, "cwd");
  const target = join(root, "target");
  await Promise.all([
    mkdir(cwd, { recursive: true }),
    mkdir(target, { recursive: true }),
    mkdir(fakeHome, { recursive: true }),
  ]);
  await writeWorkspaceConfig(fakeHome, workspaceConfig());

  await assert.rejects(
    findWorkspaceRoot(target, {
      cwd,
      env: { HOME: fakeHome, SDD_USER_HOME: fakeHome },
    }),
    (error) => error?.code === "WORKSPACE_NOT_FOUND",
  );
});

test("home-root v3 is explicit migration input rather than ancestor authority", async (t) => {
  const root = await temporaryRoot(t, "sdd-workspace-home-authority-");
  const legacyHomeRoot = join(root, "home");
  const target = join(legacyHomeRoot, "src", "uninitialized");
  await mkdir(target, { recursive: true });
  await writeWorkspaceConfig(legacyHomeRoot, workspaceConfig());
  const env = { HOME: legacyHomeRoot, SDD_USER_HOME: legacyHomeRoot };

  await assert.rejects(
    findWorkspaceRoot(target, { cwd: target, env }),
    (error) => error?.code === "LEGACY_USER_MIGRATION_REQUIRED"
      && error.message.includes("--from-user <legacy-user-root>"),
  );
  await assert.rejects(
    findWorkspaceRoot(target, { workspaceRoot: legacyHomeRoot, cwd: target, env }),
    (error) => error?.code === "LEGACY_USER_MIGRATION_REQUIRED"
      && error.message.includes("--from-user <legacy-user-root>"),
  );
});

test("nested config files are authority boundaries even when their YAML is falsey or malformed", async (t) => {
  const root = await temporaryRoot(t, "sdd-workspace-config-boundary-");
  const workspaceRoot = join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  await writeWorkspaceConfig(workspaceRoot, workspaceConfig());

  const cases = [
    ["empty", "", "INVALID_CONFIG"],
    ["empty-mapping", "{}\n", "INVALID_CONFIG"],
    ["null", "null\n", "INVALID_CONFIG"],
    ["false", "false\n", "INVALID_CONFIG"],
    ["malformed", "invalid: [\n", "INVALID_YAML"],
  ];
  for (const [label, source, expectedCode] of cases) {
    const nestedRoot = join(workspaceRoot, label);
    const target = join(nestedRoot, "target");
    const configPath = join(nestedRoot, ".sdd", "config.yaml");
    await mkdir(target, { recursive: true });
    await mkdir(join(nestedRoot, ".sdd"), { recursive: true });
    await writeFile(configPath, source, "utf8");

    if (expectedCode === "INVALID_CONFIG") {
      assert.equal(
        await findWorkspaceRoot(target, { cwd: target, env: {} }),
        nestedRoot,
      );
    }
    await assert.rejects(
      resolveWorkspaceContext(target, { cwd: target, env: {} }),
      (error) => error?.code === expectedCode,
    );
  }
});

test("a physical alias of HOME remains migration-only workspace input", async (t) => {
  const root = await temporaryRoot(t, "sdd-workspace-home-alias-");
  const legacyHomeRoot = join(root, "home");
  const homeAlias = join(root, "home-alias");
  const target = join(homeAlias, "src", "uninitialized");
  await mkdir(join(legacyHomeRoot, "src", "uninitialized"), { recursive: true });
  await writeWorkspaceConfig(legacyHomeRoot, workspaceConfig());
  await symlink(legacyHomeRoot, homeAlias, "dir");
  const env = { HOME: legacyHomeRoot };

  await assert.rejects(
    findWorkspaceRoot(target, { cwd: target, env }),
    (error) => error?.code === "LEGACY_USER_MIGRATION_REQUIRED"
      && error.message.includes("--from-user <legacy-user-root>"),
  );
  await assert.rejects(
    findWorkspaceRoot(target, { workspaceRoot: homeAlias, cwd: target, env }),
    (error) => error?.code === "LEGACY_USER_MIGRATION_REQUIRED",
  );
});

test("the OS home remains migration-only when home environment variables are absent", async () => {
  await assert.rejects(
    assertWorkspaceRootIsNotLegacyHome(homedir(), {}),
    (error) => error?.code === "LEGACY_USER_MIGRATION_REQUIRED"
      && error.message.includes("--from-user <legacy-user-root>"),
  );
});

test("setup refuses direct and physical aliases of HOME before creating state", async (t) => {
  const root = await temporaryRoot(t, "sdd-workspace-setup-home-");
  const legacyHomeRoot = join(root, "home");
  const homeAlias = join(root, "home-alias");
  await mkdir(legacyHomeRoot, { recursive: true });
  await symlink(legacyHomeRoot, homeAlias, "dir");

  const cases = [
    [legacyHomeRoot, { HOME: legacyHomeRoot }],
    [homeAlias, { SDD_USER_HOME: legacyHomeRoot }],
  ];
  for (const [workspaceRoot, env] of cases) {
    await assert.rejects(
      setupInstallation(workspaceRoot, { env }),
      (error) => error?.code === "LEGACY_USER_MIGRATION_REQUIRED"
        && error.message.includes("--from-user <legacy-user-root>"),
    );
    assert.equal(await pathExists(join(legacyHomeRoot, ".sdd")), false);
    assert.equal(await pathExists(join(legacyHomeRoot, ".agents")), false);
  }
});

test("released legacy user v1 is migration-only and preserves source-relative topology in workspace v3", () => {
  const legacy = releasedLegacyUserV1Config();
  const original = structuredClone(legacy);

  assert.throws(
    () => assertValidConfig(legacy),
    (error) => error?.code === "LEGACY_USER_MIGRATION_REQUIRED",
  );
  const migrated = createWorkspaceConfigFromLegacyHome(
    legacy,
    "/legacy-user",
    "/workspace",
  );

  assert.deepEqual(legacy, original);
  assert.equal(migrated.kind, undefined);
  assert.equal(migrated.version, 3);
  assert.equal(migrated.schema, "sdd-v3");
  assert.deepEqual(migrated.skills, { directory: ".agents/skills" });
  assert.deepEqual(migrated.planning, { root: "/shared-planning" });
  assert.deepEqual(migrated.repositories.roots, {
    source: "/legacy-user/repositories",
    shared: "/shared-repositories",
    home: "/legacy-user/external-repositories",
  });
  assert.deepEqual(migrated.repositoryArtifacts, {
    epics: "docs/epics",
    adrs: "docs/adrs",
    audits: "docs/audits",
  });
  assert.deepEqual(migrated.ideas.sample, {
    status: "active",
    planning: "./~/sample",
    repositories: [
      { root: "source", path: "./~/apps/sample", role: "primary", status: "active" },
      { path: "/legacy-user/detached", status: "inactive" },
      { root: "home", path: "sample-worker", status: "active" },
      { path: "/shared-standalone", status: "archived" },
    ],
  });
  assert.deepEqual(migrated.ideas.detached, {
    status: "inactive",
    planningPath: "/detached-planning",
    repositories: [],
  });
  assert.deepEqual(validateConfig(migrated), []);
});

test("released legacy user v1 rejects malformed layouts and unsupported signatures", () => {
  const invalidLayouts = [
    (config) => { delete config.planning.plannedChangesDirectory; },
    (config) => { config.planning.plannedChangesDirectory = "../planned-changes"; },
    (config) => { config.planning.plannedChangesDirectory = "."; },
    (config) => { delete config.repositoryArtifacts.activeChanges; },
    (config) => { config.repositoryArtifacts.closedChanges = "closed\0changes"; },
    (config) => { config.repositoryArtifacts.activeChanges = "../changes"; },
    (config) => { config.skills.directory = "skills\0directory"; },
    (config) => { config.skills.directory = ""; },
    (config) => { config.planning.root = "planning\0root"; },
    (config) => { config.planning.root = null; },
    (config) => { config.repositories.roots.source = "repositories\0root"; },
    (config) => { config.repositoryArtifacts.epics = "../epics"; },
    (config) => { config.repositoryArtifacts.activeChanges = "docs/epics"; },
    (config) => { config.ideas.sample.repositories[0].path = ""; },
    (config) => {
      config.repositories.roots = {};
      config.ideas.sample.repositories = [{ root: "workspace", path: "sample" }];
    },
    (config) => { config.planning.unexpected = "planning"; },
    (config) => { config.migration = { sourceWorkspace: "/invented-locator" }; },
  ];
  for (const invalidate of invalidLayouts) {
    const legacy = releasedLegacyUserV1Config();
    invalidate(legacy);
    const before = structuredClone(legacy);
    assert.throws(
      () => createWorkspaceConfigFromLegacyHome(
        legacy,
        "/legacy-user",
        "/workspace",
      ),
      (error) => error?.code === "INVALID_LEGACY_USER_CONFIG",
    );
    assert.deepEqual(legacy, before);
  }

  for (const [version, schema] of [
    [0, "sdd-user-v1"],
    [1, "sdd-user-v2"],
    [2, "sdd-user-v1"],
    [3, "sdd-user-v3"],
  ]) {
    const legacy = releasedLegacyUserV1Config();
    legacy.version = version;
    legacy.schema = schema;
    assert.throws(
      () => createWorkspaceConfigFromLegacyHome(
        legacy,
        "/legacy-user",
        "/workspace",
      ),
      (error) => error?.code === "INVALID_LEGACY_USER_CONFIG",
    );
  }
});

test("built-in idea manifests resolve repository paths from the workspace root", async (t) => {
  const root = await temporaryRoot(t, "sdd-workspace-import-built-in-");
  const workspaceRoot = join(root, "workspace");
  const ideaRoot = join(workspaceRoot, "spaces", "ideas", "sample");
  const repositoryRoot = join(workspaceRoot, "spaces", "code", "sample-app");
  await mkdir(ideaRoot, { recursive: true });
  await mkdir(repositoryRoot, { recursive: true });
  await writeFile(
    join(ideaRoot, "sample.md"),
    "---\nrepositories:\n  - path: spaces/code/sample-app\n---\n# Sample\n",
    "utf8",
  );

  const config = await createInitialConfig(workspaceRoot);

  assert.equal(config.planning.root, "spaces/ideas");
  assert.deepEqual(config.repositories.roots, { code: "spaces/code" });
  assert.deepEqual(config.ideas.sample.repositories, [{
    root: "code",
    path: "sample-app",
    status: "active",
  }]);
});

test("idea manifests resolve workspace-relative paths into external configured roots", async (t) => {
  const root = await temporaryRoot(t, "sdd-workspace-import-external-");
  const workspaceRoot = join(root, "workspace");
  const ideaRoot = join(workspaceRoot, "spaces", "ideas", "sample");
  const externalRoot = join(root, "external-code");
  const repositoryRoot = join(externalRoot, "sample-app");
  await mkdir(ideaRoot, { recursive: true });
  await mkdir(repositoryRoot, { recursive: true });
  await writeFile(
    join(ideaRoot, "sample.md"),
    [
      "---",
      "repositories:",
      "  - path: ../external-code/sample-app",
      "---",
      "# Sample",
      "",
    ].join("\n"),
    "utf8",
  );

  const config = await createInitialConfig(workspaceRoot, {
    planningRoot: "spaces/ideas",
    repositoryRoots: [externalRoot],
  });

  assert.deepEqual(config.repositories.roots, {
    "external-code": externalRoot,
  });
  assert.deepEqual(config.ideas.sample.repositories, [{
    root: "external-code",
    path: "sample-app",
    status: "active",
  }]);
});

test("legacy user v2 is migration-only and converts to canonical workspace v3", () => {
  const legacyUserRoot = "/legacy-user";
  const workspaceRoot = "/workspace";
  const externalRoot = "/external/repositories";
  const legacy = {
    kind: "user",
    version: 2,
    schema: "sdd-user-v2",
    skills: { directory: ".agents/skills" },
    planning: { root: "planning" },
    repositories: {
      roots: {
        local: "/workspace/repositories",
        source: "repositories",
        external: externalRoot,
      },
    },
    repositoryArtifacts: {
      epics: "docs/epics",
      adrs: "docs/adrs",
      audits: "docs/audits",
    },
    ideas: {
      sample: {
        status: "active",
        planningPath: "planning/sample",
        repositories: [
          { root: "local", path: "sample", status: "active" },
          { root: "source", path: "source-app", status: "active" },
          { path: "standalone", status: "active" },
          { path: "/external/standalone", status: "inactive" },
        ],
      },
    },
  };

  assert.throws(
    () => assertValidConfig(legacy),
    (error) => error?.code === "LEGACY_USER_MIGRATION_REQUIRED",
  );
  const migrated = createWorkspaceConfigFromLegacyHome(
    legacy,
    legacyUserRoot,
    workspaceRoot,
  );
  assert.equal(migrated.kind, undefined);
  assert.equal(migrated.version, 3);
  assert.equal(migrated.schema, "sdd-v3");
  assert.equal(migrated.planning.root, "/legacy-user/planning");
  assert.equal(migrated.repositories.roots.local, "repositories");
  assert.equal(migrated.repositories.roots.source, "/legacy-user/repositories");
  assert.equal(migrated.repositories.roots.external, externalRoot);
  assert.equal(migrated.ideas.sample.planningPath, "/legacy-user/planning/sample");
  assert.equal(migrated.ideas.sample.repositories[1].path, "source-app");
  assert.equal(migrated.ideas.sample.repositories[2].path, "/legacy-user/standalone");
  assert.deepEqual(validateConfig(migrated), []);
});

test("legacy user v2 accepts owner-relative sibling topology and rebases it canonically", () => {
  const legacy = {
    kind: "user",
    version: 2,
    schema: "sdd-user-v2",
    skills: { directory: "../managed-skills" },
    planning: { root: "../planning" },
    repositories: { roots: { source: "../repositories" } },
    repositoryArtifacts: {
      epics: "docs/epics",
      adrs: "docs/adrs",
      audits: "docs/audits",
    },
    ideas: {
      sample: {
        status: "active",
        planningPath: "../planning/sample",
        repositories: [
          { root: "source", path: "sample-app", status: "active" },
          { path: "../standalone", status: "inactive" },
        ],
      },
    },
  };

  assert.deepEqual(validateLegacyUserConfig(legacy), []);
  const migrated = createWorkspaceConfigFromLegacyHome(
    legacy,
    "/legacy-owner/home",
    "/workspace",
  );
  assert.equal(migrated.skills.directory, ".agents/skills");
  assert.equal(migrated.planning.root, "/legacy-owner/planning");
  assert.equal(migrated.repositories.roots.source, "/legacy-owner/repositories");
  assert.equal(migrated.ideas.sample.planningPath, "/legacy-owner/planning/sample");
  assert.equal(migrated.ideas.sample.repositories[0].path, "sample-app");
  assert.equal(migrated.ideas.sample.repositories[1].path, "/legacy-owner/standalone");
  assert.deepEqual(validateConfig(migrated), []);
});

test("legacy user v2 distinguishes literal root children from owner-level home paths", () => {
  const legacy = {
    kind: "user",
    version: 2,
    schema: "sdd-user-v2",
    skills: { directory: "~/.agents/skills" },
    planning: { root: "~/planning" },
    repositories: { roots: { source: "~/repositories" } },
    repositoryArtifacts: {
      epics: "~/docs/epics",
      adrs: "~/docs/adrs",
      audits: "~/docs/audits",
    },
    ideas: {
      sample: {
        status: "active",
        planning: "~/sample",
        repositories: [
          { root: "source", path: "~/sample-app", status: "active" },
          { path: "~/standalone", status: "inactive" },
        ],
      },
      detached: {
        status: "inactive",
        planningPath: "~/detached-planning",
        repositories: [],
      },
    },
  };

  const migrated = createWorkspaceConfigFromLegacyHome(
    legacy,
    "/legacy-user",
    "/workspace",
  );

  assert.equal(migrated.planning.root, "/legacy-user/planning");
  assert.equal(migrated.repositories.roots.source, "/legacy-user/repositories");
  assert.deepEqual(migrated.repositoryArtifacts, {
    epics: "./~/docs/epics",
    adrs: "./~/docs/adrs",
    audits: "./~/docs/audits",
  });
  assert.equal(migrated.ideas.sample.planning, "./~/sample");
  assert.equal(migrated.ideas.sample.repositories[0].path, "./~/sample-app");
  assert.equal(migrated.ideas.sample.repositories[1].path, "/legacy-user/standalone");
  assert.equal(migrated.ideas.detached.planningPath, "/legacy-user/detached-planning");
  assert.deepEqual(validateConfig(migrated), []);
});

test("legacy user v2 preserves the exact source-workspace locator contract", () => {
  const legacy = {
    kind: "user",
    version: 2,
    schema: "sdd-user-v2",
    migration: { sourceWorkspace: "/source-workspace" },
    skills: { directory: ".agents/skills" },
    planning: { root: "planning" },
    repositories: { roots: {} },
    repositoryArtifacts: {
      epics: "docs/epics",
      adrs: "docs/adrs",
      audits: "docs/audits",
    },
    ideas: {},
  };

  assert.throws(
    () => createWorkspaceConfigFromLegacyHome(legacy, "/legacy-user", "/workspace"),
    (error) => error?.code === "MIGRATION_SOURCE_UNAVAILABLE"
      && error.details.includes("/source-workspace"),
  );
});

test("legacy user v2 rejects every malformed present migration locator", () => {
  const legacy = {
    kind: "user",
    version: 2,
    schema: "sdd-user-v2",
    skills: { directory: ".agents/skills" },
    planning: { root: "planning" },
    repositories: { roots: {} },
    repositoryArtifacts: {
      epics: "docs/epics",
      adrs: "docs/adrs",
      audits: "docs/audits",
    },
    ideas: {},
  };
  const cases = [
    {
      migration: null,
      detail: "Legacy migration must be a mapping.",
    },
    {
      migration: [],
      detail: "Legacy migration must be a mapping.",
    },
    {
      migration: "/source-workspace",
      detail: "Legacy migration must be a mapping.",
    },
    {
      migration: {},
      detail: "Legacy migration.sourceWorkspace must be a non-empty path.",
    },
    {
      migration: { sourceWorkpace: "/source-workspace" },
      detail: "Legacy migration contains unknown key: sourceWorkpace.",
    },
    {
      migration: { sourceWorkspace: "" },
      detail: "Legacy migration.sourceWorkspace must be a non-empty path.",
    },
    {
      migration: { sourceWorkspace: "   " },
      detail: "Legacy migration.sourceWorkspace must be a non-empty path.",
    },
    {
      migration: { sourceWorkspace: "/source-workspace", unexpected: true },
      detail: "Legacy migration contains unknown key: unexpected.",
    },
    {
      migration: { sourceWorkspace: "../source-workspace" },
      detail: "Legacy migration.sourceWorkspace cannot traverse to a parent directory.",
    },
    {
      migration: { sourceWorkspace: "/source\0workspace" },
      detail: "Legacy migration.sourceWorkspace must not contain NUL bytes.",
    },
  ];

  for (const { migration, detail } of cases) {
    const candidate = structuredClone(legacy);
    candidate.migration = migration;
    const before = structuredClone(candidate);
    assert.throws(
      () => createWorkspaceConfigFromLegacyHome(candidate, "/legacy-user", "/workspace"),
      (error) => error?.code === "INVALID_LEGACY_USER_CONFIG"
        && error.details.includes(detail),
    );
    assert.deepEqual(candidate, before);
  }
});

test("legacy workspace migration canonicalizes contained paths without changing external owners", () => {
  const workspaceRoot = "/workspace";
  const legacy = workspaceConfig("/workspace/code");
  legacy.version = 2;
  legacy.schema = "sdd-v2";
  legacy.skills.directory = "/workspace/.agents/skills";
  legacy.planning.root = "/workspace/planning";
  legacy.repositories.roots.external = "/external/code";
  legacy.ideas.sample.planningPath = "/workspace/planning/sample";
  legacy.ideas.sample.repositories.push(
    { path: "/workspace/standalone", status: "active" },
    { path: "/external/standalone", status: "inactive" },
  );

  const migrated = migrateWorkspaceConfig(legacy, workspaceRoot);

  assert.equal(migrated.migratedFrom, 2);
  assert.equal(migrated.config.version, 3);
  assert.equal(migrated.config.schema, "sdd-v3");
  assert.equal(migrated.config.skills.directory, ".agents/skills");
  assert.equal(migrated.config.planning.root, "planning");
  assert.deepEqual(migrated.config.repositories.roots, {
    code: "code",
    external: "/external/code",
  });
  assert.equal(migrated.config.ideas.sample.planningPath, "planning/sample");
  assert.equal(migrated.config.ideas.sample.repositories[1].path, "standalone");
  assert.equal(migrated.config.ideas.sample.repositories[2].path, "/external/standalone");
  assert.deepEqual(validateConfig(migrated.config), []);
});

test("workspace path serialization uses physical containment for aliases", async (t) => {
  const root = await temporaryRoot(t, "sdd-workspace-portable-alias-");
  const workspaceRoot = join(root, "workspace");
  const internalPath = join(workspaceRoot, "repositories", "internal");
  const internalAlias = join(root, "internal-alias");
  const externalPath = join(root, "external");
  const workspaceAliasToExternal = join(workspaceRoot, "external-alias");
  await Promise.all([
    mkdir(internalPath, { recursive: true }),
    mkdir(externalPath, { recursive: true }),
  ]);
  await symlink(internalPath, internalAlias, "dir");
  await symlink(externalPath, workspaceAliasToExternal, "dir");
  const blockingFile = join(workspaceRoot, "blocking-file");
  const blockedChild = join(blockingFile, "child");
  await writeFile(blockingFile, "not a directory\n", "utf8");

  assert.equal(
    toWorkspaceConfigPath(workspaceRoot, internalAlias),
    "repositories/internal",
  );
  assert.equal(
    toWorkspaceConfigPath(workspaceRoot, workspaceAliasToExternal),
    workspaceAliasToExternal,
  );
  assert.equal(
    toWorkspaceConfigPath(workspaceRoot, externalPath),
    externalPath,
  );
  assert.equal(
    toWorkspaceConfigPath(workspaceRoot, blockedChild),
    blockedChild,
  );
});

test("legacy workspace v1 and v2 tilde paths expand against their source owner before rebasing", () => {
  const legacyHomeRoot = "/legacy-home";
  const workspaceRoot = "/legacy-home/workspace";
  const legacyV1 = {
    version: 1,
    schema: "sdd-v1",
    skills: { directory: "~/workspace/.agents/skills" },
    planning: { root: "~/workspace/planning" },
    repositories: {
      roots: ["~/workspace/code", "~/shared", "/external/external"],
    },
    repositoryArtifacts: {
      epics: "~/docs/epics",
      adrs: "docs/adrs",
      audits: "docs/audits",
    },
    ideas: {
      sample: {
        status: "active",
        planning: "~/workspace/planning/sample",
        repositories: [
          { path: "~/workspace/code/sample", status: "active" },
          { path: "~/workspace/standalone", status: "active" },
          { path: "/external/standalone", status: "inactive" },
        ],
      },
    },
  };
  const legacyV2 = workspaceConfig("~/workspace/code");
  legacyV2.version = 2;
  legacyV2.schema = "sdd-v2";
  legacyV2.skills.directory = "~/workspace/.agents/skills";
  legacyV2.planning.root = "~/workspace/planning";
  legacyV2.repositories.roots.external = "/external/external";
  legacyV2.repositories.roots.shared = "~/shared";
  legacyV2.repositoryArtifacts.epics = "~/docs/epics";
  legacyV2.ideas.sample.planningPath = "~/workspace/planning/sample";
  legacyV2.ideas.sample.repositories.push(
    { path: "~/workspace/standalone", status: "active" },
    { path: "/external/standalone", status: "inactive" },
  );
  legacyV2.ideas.literal = {
    status: "active",
    planning: "~/literal-planning",
    repositories: [{
      root: "code",
      path: "~/literal-repository",
      status: "active",
    }],
  };

  for (const legacy of [legacyV1, legacyV2]) {
    const original = structuredClone(legacy);
    const migrated = migrateWorkspaceConfig(
      legacy,
      legacyHomeRoot,
      { legacyHomeRoot },
    );

    assert.deepEqual(legacy, original);
    assert.equal(migrated.config.skills.directory, "workspace/.agents/skills");
    assert.equal(migrated.config.planning.root, "workspace/planning");
    assert.equal(migrated.config.repositories.roots.code, "workspace/code");
    assert.equal(migrated.config.repositories.roots.external, "/external/external");
    assert.equal(migrated.config.repositories.roots.shared, "shared");
    assert.equal(migrated.config.repositoryArtifacts.epics, "./~/docs/epics");
    if (legacy.version === 2) {
      assert.equal(migrated.config.ideas.literal.planning, "./~/literal-planning");
      assert.equal(
        migrated.config.ideas.literal.repositories[0].path,
        "./~/literal-repository",
      );
    }

    const rebased = createWorkspaceConfigFromLegacyHome(
      migrated.config,
      legacyHomeRoot,
      workspaceRoot,
    );
    assert.equal(rebased.skills.directory, ".agents/skills");
    assert.equal(rebased.planning.root, "planning");
    assert.equal(rebased.repositories.roots.code, "code");
    assert.equal(rebased.repositories.roots.external, "/external/external");
    assert.equal(rebased.repositories.roots.shared, "/legacy-home/shared");
    assert.equal(
      rebased.ideas.sample.planningPath
        ?? join(rebased.planning.root, rebased.ideas.sample.planning ?? "sample"),
      "planning/sample",
    );
    assert.equal(
      rebased.ideas.sample.repositories[0].path,
      legacy.version === 1 ? "sample" : ".",
    );
    assert.equal(rebased.ideas.sample.repositories[1].path, "standalone");
    assert.equal(rebased.ideas.sample.repositories[2].path, "/external/standalone");
    assert.equal(rebased.repositoryArtifacts.epics, "./~/docs/epics");
    if (legacy.version === 2) {
      assert.equal(rebased.ideas.literal.planning, "./~/literal-planning");
      assert.equal(
        rebased.ideas.literal.repositories[0].path,
        "./~/literal-repository",
      );
    }
    assert.deepEqual(validateConfig(rebased), []);
  }
});

test("legacy workspace tildes default to their source owner rather than process HOME", () => {
  const workspaceRoot = "/projects/workspace";
  const legacyHomeRoot = "/users/legacy";
  const legacy = workspaceConfig("~/repositories");
  legacy.version = 2;
  legacy.schema = "sdd-v2";
  legacy.planning.root = "~/planning";
  legacy.ideas.sample.planningPath = "~/planning/sample";
  legacy.ideas.sample.repositories.push({
    path: "~/standalone",
    status: "inactive",
  });

  const migrated = migrateWorkspaceConfig(
    legacy,
    workspaceRoot,
    { legacyHomeRoot },
  ).config;
  assert.equal(migrated.planning.root, "/users/legacy/planning");
  assert.equal(migrated.repositories.roots.code, "/users/legacy/repositories");
  assert.equal(migrated.ideas.sample.planningPath, "/users/legacy/planning/sample");
  assert.equal(migrated.ideas.sample.repositories[1].path, "/users/legacy/standalone");
  assert.deepEqual(validateConfig(migrated), []);

  const defaultMigrated = migrateWorkspaceConfig(legacy, workspaceRoot).config;
  assert.equal(defaultMigrated.planning.root, "planning");
  assert.equal(defaultMigrated.repositories.roots.code, "repositories");
  assert.equal(defaultMigrated.ideas.sample.planningPath, "planning/sample");
  assert.equal(defaultMigrated.ideas.sample.repositories[1].path, "standalone");

  assert.throws(
    () => migrateWorkspaceConfig(legacy, workspaceRoot, { legacyHomeRoot: null }),
    (error) => error?.code === "INVALID_CONFIG"
      && error.details.includes("~/planning"),
  );
});

test("legacy migration preflight rejects lexical and physical repository aliases deterministically", async (t) => {
  const root = await temporaryRoot(t, "sdd-workspace-duplicate-repository-");
  const workspaceRoot = join(root, "workspace");
  const repositoryRoot = join(workspaceRoot, "repositories", "primary");
  const repositoryAlias = join(workspaceRoot, "repositories", "alias");
  await mkdir(repositoryRoot, { recursive: true });
  await symlink(repositoryRoot, repositoryAlias, "dir");

  const legacy = workspaceConfig("repositories/primary");
  legacy.version = 2;
  legacy.schema = "sdd-v2";
  legacy.repositories.roots.alias = "repositories/alias";
  legacy.ideas.sample.repositories.push(
    { root: "code", path: ".", status: "inactive" },
    { root: "alias", path: ".", status: "active" },
  );
  const config = migrateWorkspaceConfig(legacy, workspaceRoot).config;

  await assert.rejects(
    planUpdateMigration(workspaceRoot, legacy),
    (error) => error?.code === "INVALID_CONFIG"
      && error?.message === "Cannot resolve context with duplicate physical repository ownership."
      && error?.details.length === 2,
  );

  const errors = [];
  for (const repositories of [
    config.ideas.sample.repositories,
    [...config.ideas.sample.repositories].reverse(),
  ]) {
    const candidate = structuredClone(config);
    candidate.ideas.sample.repositories = repositories;
    try {
      await assertDistinctRepositoryOwnership(workspaceRoot, candidate);
      assert.fail("duplicate repository ownership was accepted");
    } catch (error) {
      assert.equal(error?.code, "INVALID_CONFIG");
      assert.equal(error?.message, "Cannot resolve context with duplicate physical repository ownership.");
      assert.equal(error?.details.length, 2);
      errors.push(error.details);
    }
  }
  assert.deepEqual(errors[0], errors[1]);
});

test("runtime relative paths reject cross-platform roots and home shorthand", () => {
  const invalidRelativePaths = [
    "/rooted",
    String.raw`\rooted`,
    String.raw`C:\rooted`,
    String.raw`C:relative\skills`,
    String.raw`\\server\share`,
    String.raw`\\?\C:\rooted`,
    String.raw`\\.\device\rooted`,
    "~",
    "~/rooted",
    String.raw`~\rooted`,
  ];

  for (const path of invalidRelativePaths) {
    const workspace = workspaceConfig();
    workspace.skills.directory = path;
    workspace.repositoryArtifacts.epics = path;
    workspace.ideas.sample.planning = path;
    workspace.ideas.sample.repositories[0].path = path;
    const workspaceFindings = validateConfig(workspace);
    for (const label of [
      "skills.directory",
      "repositoryArtifacts.epics",
      "ideas.sample.planning",
      "ideas.sample.repositories path",
    ]) {
      assert.ok(
        workspaceFindings.some((finding) => finding.message.includes(label)),
        `${label} accepted ${path}`,
      );
    }

    const repository = createRepositoryConfig("sample");
    repository.artifacts.epics = path;
    assert.ok(
      validateRepositoryConfig(repository)
        .some((finding) => finding.message.includes("artifacts.epics")),
      `repository artifacts accepted ${path}`,
    );
  }
});

test("configured path resolution never reinterprets foreign absolute syntax", async () => {
  const posixWorkspace = "/workspace";
  for (const configuredPath of [
    String.raw`C:\external`,
    String.raw`\\server\share`,
  ]) {
    assert.throws(
      () => resolveWorkspacePath(posixWorkspace, configuredPath, { platform: "linux" }),
      (error) => error?.code === "UNSUPPORTED_CONFIG_PATH"
        && error.details.includes(configuredPath),
    );
  }
  assert.equal(
    resolveWorkspacePath(posixWorkspace, "/external", { platform: "linux" }),
    "/external",
  );

  const windowsWorkspace = String.raw`C:\workspace`;
  assert.throws(
    () => resolveWorkspacePath(windowsWorkspace, "/external", { platform: "win32" }),
    (error) => error?.code === "UNSUPPORTED_CONFIG_PATH"
      && error.details.includes("/external"),
  );
  assert.equal(
    resolveWorkspacePath(
      windowsWorkspace,
      String.raw`D:\external`,
      { platform: "win32" },
    ),
    String.raw`D:\external`,
  );

  assert.throws(
    () => resolveRepositoryArtifactPath(
      posixWorkspace,
      String.raw`C:\external`,
      { platform: "linux" },
    ),
    (error) => error?.code === "UNSUPPORTED_CONFIG_PATH",
  );

  const foreignConfig = workspaceConfig(String.raw`C:\external`);
  foreignConfig.planning.root = String.raw`C:\external-planning`;
  assert.throws(
    () => resolveIdeaPlanningPath(
      foreignConfig,
      "sample",
      foreignConfig.ideas.sample,
      { platform: "linux" },
    ),
    (error) => error?.code === "UNSUPPORTED_CONFIG_PATH",
  );
  assert.throws(
    () => resolveRepositoryPath(
      foreignConfig,
      foreignConfig.ideas.sample.repositories[0],
      { platform: "linux" },
    ),
    (error) => error?.code === "UNSUPPORTED_CONFIG_PATH",
  );
  await assert.rejects(
    assertRepositoryArtifactRoots(
      "/missing-repository",
      { epics: String.raw`C:\external` },
      { platform: "linux" },
    ),
    (error) => error?.code === "UNSUPPORTED_CONFIG_PATH",
  );
});

test("managed skill directory is lexically and physically workspace-contained", async (t) => {
  const root = await temporaryRoot(t, "sdd-workspace-containment-");
  const workspaceRoot = join(root, "workspace");
  const outside = join(root, "outside");
  await Promise.all([
    mkdir(workspaceRoot, { recursive: true }),
    mkdir(outside, { recursive: true }),
  ]);

  const invalidDirectories = [
    ["/absolute/skills", "UNSAFE_SKILL_DIRECTORY"],
    [String.raw`\absolute\skills`, "UNSUPPORTED_CONFIG_PATH"],
    [String.raw`C:\external\skills`, "UNSUPPORTED_CONFIG_PATH"],
    [String.raw`\\server\skills`, "UNSUPPORTED_CONFIG_PATH"],
    [String.raw`\\?\C:\skills`, "UNSUPPORTED_CONFIG_PATH"],
    [String.raw`C:relative\skills`, "UNSUPPORTED_CONFIG_PATH"],
    ["~/skills", "UNSAFE_SKILL_DIRECTORY"],
    ["../skills", "UNSAFE_SKILL_DIRECTORY"],
  ];
  for (const [directory, expectedCode] of invalidDirectories) {
    const config = workspaceConfig();
    config.skills.directory = directory;
    assert.ok(
      validateConfig(config).some((finding) => finding.message.includes("skills.directory")),
    );
    await assert.rejects(
      resolveWorkspaceSkillsDirectory(
        workspaceRoot,
        directory,
        { platform: "linux" },
      ),
      (error) => error?.code === expectedCode,
    );
  }

  await symlink(outside, join(workspaceRoot, ".agents"));
  await assert.rejects(
    resolveWorkspaceSkillsDirectory(workspaceRoot, ".agents/skills"),
    (error) => error?.code === "UNSAFE_SKILL_DIRECTORY",
  );
});

test("config authority readers reject external, internal, and dangling symlinks", async (t) => {
  const root = await temporaryRoot(t, "sdd-config-authority-symlinks-");

  const externalOwner = join(root, "external-owner");
  const workspaceRoot = join(root, "workspace");
  const workspaceTarget = join(workspaceRoot, "nested", "target");
  await mkdir(externalOwner, { recursive: true });
  await writeWorkspaceConfig(externalOwner, workspaceConfig());
  await mkdir(join(workspaceRoot, ".sdd"), { recursive: true });
  await mkdir(workspaceTarget, { recursive: true });
  await symlink(
    getWorkspaceConfigPath(externalOwner),
    getWorkspaceConfigPath(workspaceRoot),
  );
  await assert.rejects(
    readWorkspaceConfig(workspaceRoot),
    (error) => error?.code === "UNSAFE_CONFIG_PATH",
  );
  await assert.rejects(
    findWorkspaceRoot(workspaceTarget, { cwd: workspaceTarget, env: {} }),
    (error) => error?.code === "UNSAFE_CONFIG_PATH",
  );

  const repositoryRoot = join(root, "repository");
  const internalRepositoryConfig = join(repositoryRoot, ".sdd", "repository-real.yaml");
  await mkdir(join(repositoryRoot, ".sdd"), { recursive: true });
  await writeFile(internalRepositoryConfig, "kind: repository\n", "utf8");
  await symlink(internalRepositoryConfig, getRepositoryConfigPath(repositoryRoot));
  await assert.rejects(
    readRepositoryConfig(repositoryRoot),
    (error) => error?.code === "UNSAFE_CONFIG_PATH",
  );
  await assert.rejects(
    findRepositoryRoot(join(repositoryRoot, "nested")),
    (error) => error?.code === "UNSAFE_CONFIG_PATH",
  );

  const legacyUserRoot = join(root, "legacy-user");
  await mkdir(join(legacyUserRoot, ".sdd"), { recursive: true });
  await symlink(join(root, "missing-config.yaml"), getLegacyUserConfigPath(legacyUserRoot));
  await assert.rejects(
    readLegacyUserConfig(legacyUserRoot),
    (error) => error?.code === "UNSAFE_CONFIG_PATH",
  );
  await assert.rejects(
    findWorkspaceRoot(legacyUserRoot, { cwd: legacyUserRoot, env: {} }),
    (error) => error?.code === "UNSAFE_CONFIG_PATH",
  );
});

test("workspace config snapshots bind parsing and rechecks to exact bytes and identity", async (t) => {
  const root = await temporaryRoot(t, "sdd-config-authority-substitution-");
  const workspaceRoot = join(root, "workspace");
  const replacementRoot = join(root, "replacement");
  const originalConfig = workspaceConfig();
  const replacementConfig = workspaceConfig();
  replacementConfig.planning.root = "replacement-planning";
  await Promise.all([
    mkdir(workspaceRoot, { recursive: true }),
    mkdir(replacementRoot, { recursive: true }),
  ]);
  await writeWorkspaceConfig(workspaceRoot, originalConfig);
  await writeWorkspaceConfig(replacementRoot, replacementConfig);

  const configPath = getWorkspaceConfigPath(workspaceRoot);
  const displacedPath = join(workspaceRoot, ".sdd", "displaced-config.yaml");
  await assert.rejects(
    readWorkspaceConfigSnapshot(workspaceRoot, {
      afterRead: async () => {
        await rename(configPath, displacedPath);
        await rename(getWorkspaceConfigPath(replacementRoot), configPath);
      },
    }),
    (error) => error?.code === "CONCURRENT_CHANGE",
  );
  assert.deepEqual(await readWorkspaceConfig(workspaceRoot), replacementConfig);

  const snapshot = await readWorkspaceConfigSnapshot(workspaceRoot);
  const sameBytesReplacement = join(workspaceRoot, ".sdd", "same-bytes-config.yaml");
  await writeFile(sameBytesReplacement, snapshot.source, "utf8");
  await rename(sameBytesReplacement, configPath);
  await assert.rejects(
    assertWorkspaceConfigSnapshotCurrent(workspaceRoot, snapshot),
    (error) => error?.code === "CONCURRENT_CHANGE",
  );
  assert.equal(await readFile(configPath, "utf8"), snapshot.source);
});

test("workspace config reads reject an owner-root replacement around the same file inode", async (t) => {
  const root = await temporaryRoot(t, "sdd-config-owner-identity-swap-");
  const workspaceRoot = join(root, "workspace");
  const displacedWorkspace = join(root, "workspace-displaced");
  await mkdir(workspaceRoot);
  await writeWorkspaceConfig(workspaceRoot, workspaceConfig());
  const configPath = getWorkspaceConfigPath(workspaceRoot);
  const originalOwner = await lstat(workspaceRoot, { bigint: true });
  const originalConfig = await lstat(configPath, { bigint: true });

  await assert.rejects(
    readWorkspaceConfigSnapshot(workspaceRoot, {
      afterRead: async () => {
        await rename(workspaceRoot, displacedWorkspace);
        await mkdir(workspaceRoot);
        await rename(
          getWorkspaceConfigDirectory(displacedWorkspace),
          getWorkspaceConfigDirectory(workspaceRoot),
        );
      },
    }),
    (error) => error?.code === "CONCURRENT_CHANGE",
  );

  const currentOwner = await lstat(workspaceRoot, { bigint: true });
  const currentConfig = await lstat(configPath, { bigint: true });
  assert.notEqual(String(currentOwner.ino), String(originalOwner.ino));
  assert.equal(String(currentConfig.dev), String(originalConfig.dev));
  assert.equal(String(currentConfig.ino), String(originalConfig.ino));
});

test("workspace config rechecks retain their original owner-root authority", async (t) => {
  const root = await temporaryRoot(t, "sdd-config-owner-recheck-swap-");
  const workspaceRoot = join(root, "workspace");
  const displacedWorkspace = join(root, "workspace-displaced");
  await mkdir(workspaceRoot);
  await writeWorkspaceConfig(workspaceRoot, workspaceConfig());
  const configPath = getWorkspaceConfigPath(workspaceRoot);
  const snapshot = await readWorkspaceConfigSnapshot(workspaceRoot);
  const originalConfig = await lstat(configPath, { bigint: true });

  await rename(workspaceRoot, displacedWorkspace);
  await mkdir(workspaceRoot);
  await rename(
    getWorkspaceConfigDirectory(displacedWorkspace),
    getWorkspaceConfigDirectory(workspaceRoot),
  );

  await assert.rejects(
    assertWorkspaceConfigSnapshotCurrent(workspaceRoot, snapshot),
    (error) => error?.code === "CONCURRENT_CHANGE",
  );
  const currentConfig = await lstat(configPath, { bigint: true });
  assert.equal(String(currentConfig.dev), String(originalConfig.dev));
  assert.equal(String(currentConfig.ino), String(originalConfig.ino));
});

test("workspace config rechecks retain their original owner-local ancestor chain", async (t) => {
  const root = await temporaryRoot(t, "sdd-config-ancestor-recheck-swap-");
  const workspaceRoot = join(root, "workspace");
  const configDirectory = getWorkspaceConfigDirectory(workspaceRoot);
  const displacedDirectory = join(workspaceRoot, ".sdd-displaced");
  await mkdir(workspaceRoot);
  await writeWorkspaceConfig(workspaceRoot, workspaceConfig());
  const configPath = getWorkspaceConfigPath(workspaceRoot);
  const snapshot = await readWorkspaceConfigSnapshot(workspaceRoot);
  const originalConfig = await lstat(configPath, { bigint: true });

  await rename(configDirectory, displacedDirectory);
  await mkdir(configDirectory);
  await rename(join(displacedDirectory, "config.yaml"), configPath);

  await assert.rejects(
    assertWorkspaceConfigSnapshotCurrent(workspaceRoot, snapshot),
    (error) => error?.code === "CONCURRENT_CHANGE",
  );
  const currentConfig = await lstat(configPath, { bigint: true });
  assert.equal(String(currentConfig.dev), String(originalConfig.dev));
  assert.equal(String(currentConfig.ino), String(originalConfig.ino));
});

test("expected-absent config publication preserves a file that appears before publish", async (t) => {
  const root = await temporaryRoot(t, "sdd-config-authority-create-race-");
  const workspaceRoot = join(root, "workspace");
  const winnerRoot = join(root, "winner");
  const requestedConfig = workspaceConfig();
  requestedConfig.planning.root = "requested-planning";
  const winnerConfig = workspaceConfig();
  winnerConfig.planning.root = "winner-planning";
  await Promise.all([
    mkdir(workspaceRoot, { recursive: true }),
    mkdir(winnerRoot, { recursive: true }),
  ]);
  await writeWorkspaceConfig(winnerRoot, winnerConfig);
  const winnerSource = await readFile(getWorkspaceConfigPath(winnerRoot), "utf8");

  let injected = false;
  await assert.rejects(
    writeWorkspaceConfig(workspaceRoot, requestedConfig, {
      expected: null,
      beforePublish: async () => {
        injected = true;
        await writeFile(getWorkspaceConfigPath(workspaceRoot), winnerSource, "utf8");
      },
    }),
    (error) => error?.code === "CONCURRENT_CHANGE",
  );
  assert.equal(injected, true);
  assert.deepEqual(await readWorkspaceConfig(workspaceRoot), winnerConfig);
});

test("expected-absent repository config publication preserves a file that appears before publish", async (t) => {
  const root = await temporaryRoot(t, "sdd-repository-config-create-race-");
  const repositoryRoot = join(root, "repository");
  const winnerRoot = join(root, "winner");
  const requestedConfig = createRepositoryConfig("requested");
  const winnerConfig = createRepositoryConfig("winner");
  await Promise.all([
    mkdir(repositoryRoot, { recursive: true }),
    mkdir(winnerRoot, { recursive: true }),
  ]);
  await writeRepositoryConfig(winnerRoot, winnerConfig);
  const winnerSource = await readFile(getRepositoryConfigPath(winnerRoot), "utf8");

  await assert.rejects(
    writeRepositoryConfig(repositoryRoot, requestedConfig, {
      expected: null,
      beforePublish: () => writeFile(
        getRepositoryConfigPath(repositoryRoot),
        winnerSource,
        "utf8",
      ),
    }),
    (error) => error?.code === "CONCURRENT_CHANGE",
  );
  assert.deepEqual(await readRepositoryConfig(repositoryRoot), winnerConfig);
});

test("expected config publication preserves a concurrent mode change", async (t) => {
  const root = await temporaryRoot(t, "sdd-config-mode-race-");
  const workspaceRoot = join(root, "workspace");
  await mkdir(workspaceRoot);
  const original = workspaceConfig();
  const requested = workspaceConfig();
  requested.planning.root = "requested-planning";
  await writeWorkspaceConfig(workspaceRoot, original);
  const configPath = getWorkspaceConfigPath(workspaceRoot);
  const snapshot = await readWorkspaceConfigSnapshot(workspaceRoot);
  const originalMode = Number((await lstat(configPath, { bigint: true })).mode) & 0o777;
  const winnerMode = originalMode ^ 0o100;

  await assert.rejects(
    writeWorkspaceConfig(workspaceRoot, requested, {
      expected: snapshot,
      beforePublish: () => chmod(configPath, winnerMode),
    }),
    (error) => error?.code === "CONCURRENT_CHANGE",
  );
  assert.equal(await readFile(configPath, "utf8"), snapshot.source);
  assert.equal(
    Number((await lstat(configPath, { bigint: true })).mode) & 0o777,
    winnerMode,
  );
});

test("atomic config write rejects a config-directory replacement before publication", async (t) => {
  const root = await temporaryRoot(t, "sdd-config-parent-swap-");
  const workspaceRoot = join(root, "workspace");
  const externalRoot = join(root, "external");
  const displacedDirectory = join(workspaceRoot, ".sdd-owned");
  const original = workspaceConfig();
  const requested = workspaceConfig();
  const winner = workspaceConfig();
  requested.planning.root = "requested-planning";
  winner.planning.root = "winner-planning";
  await Promise.all([
    mkdir(workspaceRoot, { recursive: true }),
    mkdir(externalRoot, { recursive: true }),
  ]);
  await writeWorkspaceConfig(workspaceRoot, original);
  await writeWorkspaceConfig(externalRoot, winner);
  const snapshot = await readWorkspaceConfigSnapshot(workspaceRoot);
  const externalConfigPath = getWorkspaceConfigPath(externalRoot);
  const winnerSource = await readFile(externalConfigPath, "utf8");

  await assert.rejects(
    writeWorkspaceConfig(workspaceRoot, requested, {
      expected: snapshot,
      beforePublish: async () => {
        await rename(getWorkspaceConfigDirectory(workspaceRoot), displacedDirectory);
        await symlink(
          getWorkspaceConfigDirectory(externalRoot),
          getWorkspaceConfigDirectory(workspaceRoot),
          "dir",
        );
      },
    }),
    (error) => ["CONCURRENT_CHANGE", "MUTATION_RECOVERY_FAILED"].includes(error?.code),
  );

  assert.equal(await readFile(externalConfigPath, "utf8"), winnerSource);
  assert.equal(
    await readFile(join(displacedDirectory, "config.yaml"), "utf8"),
    snapshot.source,
  );
});

test("atomic config write reports close failures and identity-cleans its temporary", async (t) => {
  const root = await temporaryRoot(t, "sdd-config-close-failure-");
  const workspaceRoot = join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });

  const openWithCloseFailure = async (...args) => {
    const handle = await open(...args);
    let failed = false;
    return {
      stat: (...statArgs) => handle.stat(...statArgs),
      writeFile: (...writeArgs) => handle.writeFile(...writeArgs),
      sync: (...syncArgs) => handle.sync(...syncArgs),
      close: async () => {
        if (!failed) {
          failed = true;
          throw new Error("injected temporary close failure");
        }
        return handle.close();
      },
    };
  };

  await assert.rejects(
    writeWorkspaceConfig(workspaceRoot, workspaceConfig(), {
      expected: null,
      openFile: openWithCloseFailure,
    }),
    (error) => error?.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) => detail.includes("temporary close failure")),
  );
  assert.equal(await pathExists(getWorkspaceConfigPath(workspaceRoot)), false);
  assert.deepEqual(await readdir(join(workspaceRoot, ".sdd")), []);
});

test("atomic config write retains its owned temporary when cleanup fails", async (t) => {
  const root = await temporaryRoot(t, "sdd-config-cleanup-failure-");
  const workspaceRoot = join(root, "workspace");
  const config = workspaceConfig();
  await mkdir(workspaceRoot, { recursive: true });
  let temporary;

  await assert.rejects(
    writeWorkspaceConfig(workspaceRoot, config, {
      expected: null,
      afterPublish: (publication) => {
        temporary = publication.temporary;
      },
      cleanupRename: async () => {
        throw new Error("injected temporary cleanup failure");
      },
    }),
    (error) => error?.code === "MUTATION_RECOVERY_FAILED"
      && error.details.includes(`Retained path: ${temporary}`),
  );
  assert.deepEqual(await readWorkspaceConfig(workspaceRoot), config);
  assert.equal(await readFile(temporary, "utf8"), await readFile(
    getWorkspaceConfigPath(workspaceRoot),
    "utf8",
  ));
});

test("atomic config write preserves an opaque temporary replacement after publication", async (t) => {
  const root = await temporaryRoot(t, "sdd-config-temporary-swap-");
  const workspaceRoot = join(root, "workspace");
  const config = workspaceConfig();
  await mkdir(workspaceRoot, { recursive: true });
  let temporary;

  await assert.rejects(
    writeWorkspaceConfig(workspaceRoot, config, {
      expected: null,
      afterPublish: async (publication) => {
        temporary = publication.temporary;
        await rename(temporary, `${temporary}.owned`);
        await writeFile(temporary, "opaque replacement\n", "utf8");
      },
    }),
    (error) => error?.code === "MUTATION_RECOVERY_FAILED"
      && error.details.includes(`Retained path: ${temporary}`),
  );
  assert.deepEqual(await readWorkspaceConfig(workspaceRoot), config);
  assert.equal(await readFile(temporary, "utf8"), "opaque replacement\n");
});

test("config replacement never overwrites an opaque backup-path collision", async (t) => {
  const root = await temporaryRoot(t, "sdd-config-backup-collision-");
  const workspaceRoot = join(root, "workspace");
  const original = workspaceConfig();
  const requested = workspaceConfig();
  requested.planning.root = "requested-planning";
  await mkdir(workspaceRoot, { recursive: true });
  await writeWorkspaceConfig(workspaceRoot, original);
  const snapshot = await readWorkspaceConfigSnapshot(workspaceRoot);
  let collidedBackup;

  await assert.rejects(
    writeWorkspaceConfig(workspaceRoot, requested, {
      expected: snapshot,
      beforePublish: async ({ backup }) => {
        collidedBackup = backup;
        await writeFile(backup, "opaque backup winner\n", "utf8");
      },
    }),
    (error) => error?.code === "CONCURRENT_CHANGE"
      && error.details.includes(`Retained path: ${collidedBackup}`),
  );
  assert.deepEqual(await readWorkspaceConfig(workspaceRoot), original);
  assert.equal(await readFile(collidedBackup, "utf8"), "opaque backup winner\n");
});

test("config replacement retains the authenticated backup when a winner appears before link", async (t) => {
  const root = await temporaryRoot(t, "sdd-config-restore-race-");
  const workspaceRoot = join(root, "workspace");
  const winnerRoot = join(root, "winner");
  const original = workspaceConfig();
  const requested = workspaceConfig();
  requested.planning.root = "requested-planning";
  const winner = workspaceConfig();
  winner.planning.root = "winner-planning";
  await Promise.all([
    mkdir(workspaceRoot, { recursive: true }),
    mkdir(winnerRoot, { recursive: true }),
  ]);
  await writeWorkspaceConfig(workspaceRoot, original);
  await writeWorkspaceConfig(winnerRoot, winner);
  const snapshot = await readWorkspaceConfigSnapshot(workspaceRoot);
  const winnerSource = await readFile(getWorkspaceConfigPath(winnerRoot), "utf8");
  let retainedBackup;

  await assert.rejects(
    writeWorkspaceConfig(workspaceRoot, requested, {
      expected: snapshot,
      afterBackup: async ({ target, backup }) => {
        retainedBackup = backup;
        await writeFile(target, winnerSource, "utf8");
      },
    }),
    (error) => error?.code === "CONCURRENT_CHANGE"
      && error.details.includes(`Retained original: ${retainedBackup}`),
  );
  assert.deepEqual(await readWorkspaceConfig(workspaceRoot), winner);
  assert.equal(await readFile(retainedBackup, "utf8"), snapshot.source);
});

test("config replacement verifies its linked target before deleting the original backup", async (t) => {
  const root = await temporaryRoot(t, "sdd-config-post-link-race-");
  const workspaceRoot = join(root, "workspace");
  const winnerRoot = join(root, "winner");
  const original = workspaceConfig();
  const requested = workspaceConfig();
  requested.planning.root = "requested-planning";
  const winner = workspaceConfig();
  winner.planning.root = "winner-planning";
  await Promise.all([
    mkdir(workspaceRoot, { recursive: true }),
    mkdir(winnerRoot, { recursive: true }),
  ]);
  await writeWorkspaceConfig(workspaceRoot, original);
  await writeWorkspaceConfig(winnerRoot, winner);
  const snapshot = await readWorkspaceConfigSnapshot(workspaceRoot);
  const winnerSource = await readFile(getWorkspaceConfigPath(winnerRoot), "utf8");
  let retainedBackup;

  await assert.rejects(
    writeWorkspaceConfig(workspaceRoot, requested, {
      expected: snapshot,
      afterPublish: async ({ target, backup }) => {
        retainedBackup = backup;
        await rename(target, `${target}.requested`);
        await writeFile(target, winnerSource, "utf8");
      },
    }),
    (error) => error?.code === "CONCURRENT_CHANGE"
      && error.details.includes(`Retained original: ${retainedBackup}`),
  );
  assert.deepEqual(await readWorkspaceConfig(workspaceRoot), winner);
  assert.equal(await readFile(retainedBackup, "utf8"), snapshot.source);
});

test("expected-absent config publication verifies the linked target before success", async (t) => {
  const root = await temporaryRoot(t, "sdd-config-create-post-link-race-");
  const workspaceRoot = join(root, "workspace");
  const winnerRoot = join(root, "winner");
  const requested = workspaceConfig();
  requested.planning.root = "requested-planning";
  const winner = workspaceConfig();
  winner.planning.root = "winner-planning";
  await Promise.all([
    mkdir(workspaceRoot, { recursive: true }),
    mkdir(winnerRoot, { recursive: true }),
  ]);
  await writeWorkspaceConfig(winnerRoot, winner);
  const winnerSource = await readFile(getWorkspaceConfigPath(winnerRoot), "utf8");

  await assert.rejects(
    writeWorkspaceConfig(workspaceRoot, requested, {
      expected: null,
      afterPublish: async ({ target }) => {
        await rename(target, `${target}.requested`);
        await writeFile(target, winnerSource, "utf8");
      },
    }),
    (error) => error?.code === "CONCURRENT_CHANGE",
  );
  assert.deepEqual(await readWorkspaceConfig(workspaceRoot), winner);
});
