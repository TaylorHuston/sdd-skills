import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import test from "node:test";
import { parse } from "yaml";

import {
  assertValidConfig,
  assertWorkspaceConfigSnapshotCurrent,
  createRepositoryConfig,
  createInitialConfig,
  getRepositoryConfigPath,
  getWorkspaceConfigDirectory,
  getWorkspaceConfigPath,
  findRepositoryRoot,
  findWorkspaceRoot,
  resolveIdeaPlanningPath,
  resolveRepositoryPath,
  readRepositoryConfig,
  readWorkspaceConfig,
  readWorkspaceConfigSnapshot,
  toWorkspaceConfigPath,
  resolveRepositoryArtifactPath,
  resolveWorkspacePath,
  resolveWorkspaceSkillsDirectory,
  validateConfig,
  validateRepositoryConfig,
  writeRepositoryConfig,
  writeWorkspaceConfig,
} from "../src/config.js";
import { setupInstallation } from "../src/commands/init-installation.js";
import { assertRepositoryArtifactRoots } from "../src/change-repositories.js";
import { pathExists } from "../src/fs.js";
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

test("config publication rejects an owner-local ancestor replacement", async (t) => {
  const root = await temporaryRoot(t, "sdd-config-publication-ancestor-swap-");
  const workspaceRoot = join(root, "workspace");
  const configDirectory = getWorkspaceConfigDirectory(workspaceRoot);
  const displacedDirectory = join(workspaceRoot, ".sdd-displaced");
  await mkdir(workspaceRoot);
  const original = workspaceConfig();
  const requested = workspaceConfig();
  requested.planning.root = "requested-planning";
  await writeWorkspaceConfig(workspaceRoot, original);
  const configPath = getWorkspaceConfigPath(workspaceRoot);
  const snapshot = await readWorkspaceConfigSnapshot(workspaceRoot);
  let recordedStagingPath;
  let failure;

  await assert.rejects(
    writeWorkspaceConfig(workspaceRoot, requested, {
      expected: snapshot,
      beforePublish: async ({ temporary }) => {
        recordedStagingPath = temporary;
        await rename(configDirectory, displacedDirectory);
        await mkdir(configDirectory);
        await rename(join(displacedDirectory, "config.yaml"), configPath);
      },
    }),
    (error) => {
      failure = error;
      return error?.code === "MUTATION_RECOVERY_FAILED"
        && error.cause?.code === "CONCURRENT_CHANGE"
        && error.recordedResiduePaths?.includes(recordedStagingPath);
    },
  );

  const actualStagingPath = join(displacedDirectory, basename(recordedStagingPath));
  assert.equal(await readFile(configPath, "utf8"), snapshot.source);
  await assert.rejects(lstat(recordedStagingPath), (error) => error?.code === "ENOENT");
  assert.equal(parse(await readFile(actualStagingPath, "utf8")).planning.root, "requested-planning");
  assert.equal(failure.retainedPaths.includes(recordedStagingPath), true);
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
    (error) => error?.code === "CONCURRENT_CHANGE"
      && error.details.some((detail) => detail.includes("retry")),
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
    (error) => error?.code === "CONCURRENT_CHANGE"
      && error.details.some((detail) => detail.includes("retry")),
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
    (error) => error?.code === "CONCURRENT_CHANGE"
      && error.details.some((detail) => detail.includes("retry")),
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
    (error) => ["CONCURRENT_CHANGE", "MUTATION_RECOVERY_FAILED", "UNSAFE_CONFIG_PATH"].includes(error?.code),
  );

  assert.equal(await readFile(externalConfigPath, "utf8"), winnerSource);
  assert.equal(
    await readFile(join(displacedDirectory, "config.yaml"), "utf8"),
    snapshot.source,
  );
});

test("configuration replacement preserves winners after displacement and publication", async (t) => {
  for (const phase of ["after-displace", "after-publish"]) {
    await t.test(phase, async (t) => {
      const root = await temporaryRoot(t, `sdd-config-${phase}-winner-`);
      const workspaceRoot = join(root, "workspace");
      const winnerRoot = join(root, "winner");
      await Promise.all([
        mkdir(workspaceRoot, { recursive: true }),
        mkdir(winnerRoot, { recursive: true }),
      ]);
      const original = workspaceConfig();
      const requested = workspaceConfig();
      requested.planning.root = "requested-planning";
      const winner = workspaceConfig();
      winner.planning.root = "winner-planning";
      await writeWorkspaceConfig(workspaceRoot, original);
      await writeWorkspaceConfig(winnerRoot, winner);
      const snapshot = await readWorkspaceConfigSnapshot(workspaceRoot);
      const winnerSource = await readFile(getWorkspaceConfigPath(winnerRoot), "utf8");
      const requestedPath = `${getWorkspaceConfigPath(workspaceRoot)}.requested`;
      let failure;

      await assert.rejects(
        writeWorkspaceConfig(workspaceRoot, requested, {
          expected: snapshot,
          ...(phase === "after-displace"
            ? { afterDisplace: ({ target }) => writeFile(target, winnerSource, "utf8") }
            : {
                afterPublish: async ({ target }) => {
                  await rename(target, requestedPath);
                  await writeFile(target, winnerSource, "utf8");
                },
              }),
        }),
        (error) => {
          failure = error;
          return error?.code === "MUTATION_RECOVERY_FAILED"
            && error.details.some((detail) => detail.includes("retry"))
            && error.retainedPaths.length > 0;
        },
      );

      assert.deepEqual(await readWorkspaceConfig(workspaceRoot), winner);
      assert.deepEqual(parse(await readFile(failure.retainedPaths[0], "utf8")), original);
      if (phase === "after-publish") {
        assert.deepEqual(parse(await readFile(requestedPath, "utf8")), requested);
      }
    });
  }
});

test("configuration publication writes complete YAML and preserves file mode", async (t) => {
  const root = await temporaryRoot(t, "sdd-config-complete-mode-");
  const workspaceRoot = join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const original = workspaceConfig();
  await writeWorkspaceConfig(workspaceRoot, original);
  const configPath = getWorkspaceConfigPath(workspaceRoot);
  await chmod(configPath, 0o640);
  const snapshot = await readWorkspaceConfigSnapshot(workspaceRoot);
  const updated = structuredClone(original);
  updated.planning.root = "updated-planning";

  await writeWorkspaceConfig(workspaceRoot, updated, { expected: snapshot });

  assert.deepEqual(await readWorkspaceConfig(workspaceRoot), updated);
  assert.equal(Number((await lstat(configPath, { bigint: true })).mode & 0o777n), 0o640);
  assert.equal((await readFile(configPath, "utf8")).endsWith("\n"), true);
});
