import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { stringify } from "yaml";

import { parseChangeMetadata } from "../src/change-status.js";
import { getActiveChangePath, getClosedChangePath } from "../src/change-store.js";
import {
  migrateRepositoryConfig,
  readConfig,
  readRepositoryConfig,
} from "../src/config.js";
import { updateWorkspace } from "../src/commands/update.js";
import { hashDirectory, pathExists } from "../src/fs.js";
import {
  applyUpdateMigration,
  planUpdateMigration,
} from "../src/update-migration.js";

const INTERRUPTED_UPDATE_EXIT_CODE = 86;
const CONFIG_MODULE_URL = new URL("../src/config.js", import.meta.url).href;
const MIGRATION_MODULE_URL = new URL("../src/update-migration.js", import.meta.url).href;
const MUTATION_MODULE_URL = new URL("../src/mutation.js", import.meta.url).href;
const execFileAsync = promisify(execFile);

async function writeYaml(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stringify(value, { lineWidth: 0, sortMapEntries: false }), "utf8");
}

function legacyWorkspaceConfig(repositoryNames = ["app", "worker"]) {
  return {
    version: 2,
    schema: "sdd-v2",
    skills: { directory: ".agents/skills" },
    planning: { root: "ideas", plannedChangesDirectory: "planned-changes" },
    repositories: { roots: { code: "code" } },
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
        repositories: repositoryNames.map((name) => ({
          root: "code",
          path: name,
          status: "active",
        })),
      },
    },
  };
}

function legacyRepositoryConfig(id) {
  return {
    kind: "repository",
    version: 1,
    schema: "sdd-repository-v1",
    id,
    artifacts: {
      activeChanges: "docs/changes",
      closedChanges: "docs/changes/closed",
      epics: "docs/epics",
      adrs: "docs/adrs",
      audits: "docs/audits",
    },
  };
}

function tasks(status, body = "") {
  return `---\nstatus: ${status}\n---\n# Tasks\n${body}`;
}

async function writeChange(path, status, body = "") {
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "proposal.md"), `# Proposal\n${body}`, "utf8");
  await writeFile(join(path, "design.md"), `# Design\n${body}`, "utf8");
  await writeFile(join(path, "tasks.md"), tasks(status, body), "utf8");
}

async function createFixture({ repositories = ["app", "worker"] } = {}) {
  const root = await mkdtemp(join(tmpdir(), "sdd-update-migration-"));
  await writeYaml(join(root, ".sdd", "config.yaml"), legacyWorkspaceConfig(repositories));
  await mkdir(join(root, "ideas", "sample"), { recursive: true });
  for (const repository of repositories) {
    await writeYaml(
      join(root, "code", repository, ".sdd", "config.yaml"),
      legacyRepositoryConfig(repository),
    );
  }
  return root;
}

async function interruptUpdate(root, migrationOptionsSource) {
  const script = `
    import { readConfig } from ${JSON.stringify(CONFIG_MODULE_URL)};
    import { withWorkspaceMutationLock } from ${JSON.stringify(MUTATION_MODULE_URL)};
    import {
      applyUpdateMigration,
      planUpdateMigration,
    } from ${JSON.stringify(MIGRATION_MODULE_URL)};

    const root = ${JSON.stringify(root)};
    await withWorkspaceMutationLock(root, async () => {
      const plan = await planUpdateMigration(root, await readConfig(root), { userRoot: root });
      await applyUpdateMigration(plan, ${migrationOptionsSource});
    });
  `;
  const error = await execFileAsync(
    process.execPath,
    ["--input-type=module", "--eval", script],
    { env: { ...process.env, SDD_USER_HOME: root } },
  ).then(() => null, (caught) => caught);
  assert.ok(error, "interrupted update process unexpectedly completed");
  assert.equal(error.code, INTERRUPTED_UPDATE_EXIT_CODE, error.stderr);
}

async function interruptRecovery(root, recoveryOptionsSource) {
  const script = `
    import { withWorkspaceMutationLock } from ${JSON.stringify(MUTATION_MODULE_URL)};
    import { recoverUpdateMigration } from ${JSON.stringify(MIGRATION_MODULE_URL)};

    const root = ${JSON.stringify(root)};
    await withWorkspaceMutationLock(root, async () => {
      await recoverUpdateMigration(root, {
        userRoot: root,
        ...${recoveryOptionsSource},
      });
    });
  `;
  const error = await execFileAsync(
    process.execPath,
    ["--input-type=module", "--eval", script],
    { env: { ...process.env, SDD_USER_HOME: root } },
  ).then(() => null, (caught) => caught);
  assert.ok(error, "interrupted recovery process unexpectedly completed");
  assert.equal(error.code, INTERRUPTED_UPDATE_EXIT_CODE, error.stderr);
}

async function mutateInterruptedJournal(root, mutate) {
  const changesRoot = join(root, ".sdd", "changes");
  const stagingEntries = (await readdir(changesRoot))
    .filter((entry) => entry.startsWith(".sdd-update-"));
  assert.equal(stagingEntries.length, 1);
  const journalPath = join(changesRoot, stagingEntries[0], "transaction.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  mutate(journal);
  await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
}

async function updateWithFixtureUserRoot(root) {
  const previousUserHome = process.env.SDD_USER_HOME;
  process.env.SDD_USER_HOME = root;
  try {
    return await updateWorkspace(root);
  } finally {
    if (previousUserHome === undefined) delete process.env.SDD_USER_HOME;
    else process.env.SDD_USER_HOME = previousUserHome;
  }
}

test("automatic update migration consolidates identical Changes, preserves briefs, upgrades configs, and reruns as a no-op", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const plannedId = "2026-08-01-planned-change";
  const sharedId = "2026-08-02-shared-change";
  const closedId = "2026-08-03-closed-change";
  const plannedRoot = join(root, "ideas", "sample", "planned-changes");
  await writeChange(join(plannedRoot, plannedId), "planned", "planned\n");
  await writeFile(
    join(plannedRoot, plannedId, "proposal.md"),
    "# Proposal\n\n## Target Repositories\n\n- `code/app`\n- `code/worker`\n",
    "utf8",
  );
  await writeFile(join(plannedRoot, "future-capability.md"), "# Future capability\n", "utf8");

  for (const repository of ["app", "worker"]) {
    await writeChange(
      join(root, "code", repository, "docs", "changes", sharedId),
      "in_progress",
      "identical\n",
    );
  }
  await writeChange(
    join(root, "code", "app", "docs", "changes", "closed", closedId),
    "in_review",
    "closed\n",
  );

  const rawConfig = await readConfig(root);
  const plan = await planUpdateMigration(root, rawConfig, { userRoot: root });
  assert.equal(plan.result.required, true);
  assert.deepEqual(
    plan.result.actions.filter((action) => action.kind === "change").map((action) => action.changeId),
    [plannedId, sharedId, closedId].sort(),
  );
  assert.equal(await pathExists(getActiveChangePath(plannedId, root)), false);
  assert.equal(await pathExists(join(root, "ideas", "sample", "change-briefs", "future-capability.md")), false);
  assert.equal((await readConfig(root)).schema, "sdd-v2");

  const transaction = await applyUpdateMigration(plan);
  await transaction.finalize();

  const upgraded = await readConfig(root);
  assert.equal(upgraded.version, 3);
  assert.equal(upgraded.schema, "sdd-v3");
  assert.deepEqual(upgraded.planning, { root: "ideas" });
  assert.deepEqual(upgraded.repositoryArtifacts, {
    epics: "docs/epics",
    adrs: "docs/adrs",
    audits: "docs/audits",
  });
  for (const repository of ["app", "worker"]) {
    const repositoryConfig = await readRepositoryConfig(join(root, "code", repository));
    assert.equal(repositoryConfig.version, 2);
    assert.equal(repositoryConfig.schema, "sdd-repository-v2");
    assert.deepEqual(repositoryConfig.artifacts, {
      epics: "docs/epics",
      adrs: "docs/adrs",
      audits: "docs/audits",
    });
    assert.equal(await pathExists(join(root, "code", repository, "docs", "changes")), false);
  }

  const plannedMetadata = parseChangeMetadata(
    await readFile(join(getActiveChangePath(plannedId, root), "tasks.md"), "utf8"),
  );
  assert.equal(plannedMetadata.error, null);
  assert.equal(plannedMetadata.space, "sample");
  assert.deepEqual(plannedMetadata.repositories, ["app", "worker"]);
  const sharedMetadata = parseChangeMetadata(
    await readFile(join(getActiveChangePath(sharedId, root), "tasks.md"), "utf8"),
  );
  assert.equal(sharedMetadata.error, null);
  assert.deepEqual(sharedMetadata.repositories, ["app", "worker"]);
  assert.equal(await pathExists(getClosedChangePath(closedId, root)), true);
  assert.equal(
    await readFile(join(root, "ideas", "sample", "change-briefs", "future-capability.md"), "utf8"),
    "# Future capability\n",
  );
  assert.equal(await pathExists(plannedRoot), false);

  const rerun = await planUpdateMigration(root, upgraded, { userRoot: root });
  assert.equal(rerun.result.required, false);
  assert.deepEqual(rerun.result.actions, []);
});

test("update dry-run plans every migration action without mutating config, Changes, briefs, sources, or installation", async (t) => {
  const root = await createFixture({ repositories: ["app"] });
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousUserHome = process.env.SDD_USER_HOME;
  process.env.SDD_USER_HOME = root;
  t.after(() => {
    if (previousUserHome === undefined) delete process.env.SDD_USER_HOME;
    else process.env.SDD_USER_HOME = previousUserHome;
  });

  const plannedRoot = join(root, "ideas", "sample", "planned-changes");
  await writeChange(join(plannedRoot, "2026-08-04-dry-run"), "planned");
  await writeFile(join(plannedRoot, "dry-run-brief.md"), "# Brief\n", "utf8");
  const before = await hashDirectory(root);

  const result = await updateWorkspace(root, { dryRun: true });

  assert.equal(result.dryRun, true);
  assert.ok(result.migration.actions.some((action) => action.kind === "change"));
  assert.ok(result.migration.actions.some((action) => action.kind === "brief"));
  assert.ok(result.migration.actions.some((action) => action.kind === "configuration"));
  assert.equal(await hashDirectory(root), before);
});

test("planned migration preserves recorded targets and rejects ambiguous expansion", async (t) => {
  await t.test("recorded target path selects only its repository", async (t) => {
    const root = await createFixture();
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-04-targeted";
    const changePath = join(root, "ideas", "sample", "planned-changes", id);
    await writeChange(changePath, "planned");
    await writeFile(
      join(changePath, "proposal.md"),
      "# Proposal\n\n## Target Repositories\n\n- `code/app` (primary)\n",
      "utf8",
    );
    const plan = await planUpdateMigration(root, await readConfig(root), { userRoot: root });
    assert.deepEqual(plan.changes.find((change) => change.changeId === id).repositories, ["app"]);
  });

  await t.test("planned-only target rejects a duplicated portable repository ID before writes", async (t) => {
    const root = await createFixture();
    t.after(() => rm(root, { recursive: true, force: true }));
    for (const repository of ["app", "worker"]) {
      await writeYaml(
        join(root, "code", repository, ".sdd", "config.yaml"),
        legacyRepositoryConfig("duplicate-id"),
      );
    }
    const id = "2026-08-04-duplicate-target";
    const changePath = join(root, "ideas", "sample", "planned-changes", id);
    await writeChange(changePath, "planned");
    await writeFile(
      join(changePath, "proposal.md"),
      "# Proposal\n\n## Target Repositories\n\n- `code/app` (primary)\n",
      "utf8",
    );

    await assert.rejects(
      planUpdateMigration(root, await readConfig(root), { userRoot: root }),
      (error) => error.code === "MIGRATION_IDENTITY_REQUIRED"
        && error.details.includes(join(root, "code", "app"))
        && error.details.includes(join(root, "code", "worker")),
    );

    assert.equal(await pathExists(getActiveChangePath(id, root)), false);
    assert.equal((await readConfig(root)).schema, "sdd-v2");
    assert.equal((await readRepositoryConfig(join(root, "code", "app"))).schema, "sdd-repository-v1");
    assert.equal((await readRepositoryConfig(join(root, "code", "worker"))).schema, "sdd-repository-v1");
  });

  await t.test("targetless multi-repository draft fails before writes", async (t) => {
    const root = await createFixture();
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-04-ambiguous";
    await writeChange(join(root, "ideas", "sample", "planned-changes", id), "planned");
    await assert.rejects(
      planUpdateMigration(root, await readConfig(root), { userRoot: root }),
      (error) => error.code === "MIGRATION_TARGET_REQUIRED",
    );
    assert.equal(await pathExists(getActiveChangePath(id, root)), false);
    assert.equal((await readConfig(root)).schema, "sdd-v2");
  });
});

test("migration blocks locator upgrades when legacy owners are unavailable", async (t) => {
  await t.test("mapped repository is unavailable", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    await rm(join(root, "code", "app"), { recursive: true, force: true });
    await assert.rejects(
      planUpdateMigration(root, await readConfig(root), { userRoot: root }),
      (error) => error.code === "MIGRATION_SOURCE_UNAVAILABLE"
        && error.details.includes(join(root, "code", "app")),
    );
    assert.equal((await readConfig(root)).schema, "sdd-v2");
  });

  await t.test("planning owner is unavailable", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    await rm(join(root, "ideas", "sample"), { recursive: true, force: true });
    await assert.rejects(
      planUpdateMigration(root, await readConfig(root), { userRoot: root }),
      (error) => error.code === "MIGRATION_SOURCE_UNAVAILABLE"
        && error.details.includes(join(root, "ideas", "sample")),
    );
    assert.equal((await readConfig(root)).schema, "sdd-v2");
  });
});

test("migration preflight fails before writes for divergent copies, cross-Space IDs, destination conflicts, brief collisions, missing identities, and symlink escapes", async (t) => {
  await t.test("divergent repository copies", async (t) => {
    const root = await createFixture();
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-05-divergent";
    await writeChange(join(root, "code", "app", "docs", "changes", id), "in_progress", "app\n");
    await writeChange(join(root, "code", "worker", "docs", "changes", id), "in_progress", "worker\n");
    await assert.rejects(
      planUpdateMigration(root, await readConfig(root), { userRoot: root }),
      (error) => error.code === "DIVERGENT_CHANGE_COPIES",
    );
    assert.equal(await pathExists(getActiveChangePath(id, root)), false);
    assert.equal((await readConfig(root)).schema, "sdd-v2");
  });

  await t.test("cross-Space global ID reuse", async (t) => {
    const root = await createFixture({ repositories: ["app", "worker"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const config = await readConfig(root);
    config.ideas = {
      first: { repositories: [{ root: "code", path: "app" }] },
      second: { repositories: [{ root: "code", path: "worker" }] },
    };
    await writeYaml(join(root, ".sdd", "config.yaml"), config);
    await mkdir(join(root, "ideas", "first"), { recursive: true });
    await mkdir(join(root, "ideas", "second"), { recursive: true });
    const id = "2026-08-06-cross-space";
    await writeChange(join(root, "code", "app", "docs", "changes", id), "in_progress", "same\n");
    await writeChange(join(root, "code", "worker", "docs", "changes", id), "in_progress", "same\n");
    await assert.rejects(
      planUpdateMigration(root, await readConfig(root), { userRoot: root }),
      (error) => error.code === "CROSS_SPACE_CHANGE_COLLISION",
    );
  });

  await t.test("mismatched central destination", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-07-destination";
    await writeChange(join(root, "code", "app", "docs", "changes", id), "in_progress", "legacy\n");
    await writeChange(getActiveChangePath(id, root), "in_progress", "different\n");
    await assert.rejects(
      planUpdateMigration(root, await readConfig(root), { userRoot: root }),
      (error) => error.code === "CHANGE_DESTINATION_CONFLICT",
    );
  });

  await t.test("Change Brief destination collision", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const plannedRoot = join(root, "ideas", "sample", "planned-changes");
    await mkdir(plannedRoot, { recursive: true });
    await writeFile(join(plannedRoot, "collision.md"), "legacy\n", "utf8");
    await mkdir(join(root, "ideas", "sample", "change-briefs"), { recursive: true });
    await writeFile(join(root, "ideas", "sample", "change-briefs", "collision.md"), "current\n", "utf8");
    await assert.rejects(
      planUpdateMigration(root, await readConfig(root), { userRoot: root }),
      (error) => error.code === "CHANGE_BRIEF_COLLISION",
    );
  });

  await t.test("missing portable repository identity", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    await rm(join(root, "code", "app", ".sdd", "config.yaml"));
    await writeChange(
      join(root, "code", "app", "docs", "changes", "2026-08-08-no-identity"),
      "in_progress",
    );
    await assert.rejects(
      planUpdateMigration(root, await readConfig(root), { userRoot: root }),
      (error) => error.code === "MIGRATION_IDENTITY_REQUIRED",
    );
  });

  await t.test("symbolic link inside a legacy Change", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-09-symlink";
    const changePath = join(root, "code", "app", "docs", "changes", id);
    await writeChange(changePath, "in_progress");
    await import("node:fs/promises").then(({ symlink }) => symlink(root, join(changePath, "escape")));
    await assert.rejects(
      planUpdateMigration(root, await readConfig(root), { userRoot: root }),
      (error) => error.code === "UNSAFE_ARTIFACT_PATH",
    );
  });
});

test("migration detects commit-time drift and rolls published state back on a later failure", async (t) => {
  await t.test("source drift aborts before writes", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-10-drift";
    const changePath = join(root, "code", "app", "docs", "changes", id);
    await writeChange(changePath, "in_progress");
    const plan = await planUpdateMigration(root, await readConfig(root), { userRoot: root });
    await assert.rejects(
      applyUpdateMigration(plan, {
        beforeCommit: () => writeFile(join(changePath, "tasks.md"), tasks("in_review"), "utf8"),
      }),
      (error) => error.code === "CONCURRENT_CHANGE",
    );
    assert.equal(await pathExists(getActiveChangePath(id, root)), false);
    assert.equal((await readConfig(root)).schema, "sdd-v2");
  });

  await t.test("later failure restores central publication and upgraded configs", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-11-rollback";
    const changePath = join(root, "code", "app", "docs", "changes", id);
    await writeChange(changePath, "in_progress");
    const plan = await planUpdateMigration(root, await readConfig(root), { userRoot: root });
    await assert.rejects(
      applyUpdateMigration(plan, {
        beforeSourceRemoval: () => {
          throw new Error("injected source-removal failure");
        },
      }),
      /injected source-removal failure/,
    );
    assert.equal(await pathExists(changePath), true);
    assert.equal(await pathExists(getActiveChangePath(id, root)), false);
    assert.equal((await readConfig(root)).schema, "sdd-v2");
    assert.equal((await readRepositoryConfig(join(root, "code", "app"))).schema, "sdd-repository-v1");
  });

  await t.test("concurrent destination edit is preserved and incomplete recovery is explicit", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-12-incomplete-recovery";
    const changePath = join(root, "code", "app", "docs", "changes", id);
    await writeChange(changePath, "in_progress");
    const destination = getActiveChangePath(id, root);
    const plan = await planUpdateMigration(root, await readConfig(root), { userRoot: root });
    await assert.rejects(
      applyUpdateMigration(plan, {
        beforeSourceRemoval: async () => {
          await writeFile(join(destination, "tasks.md"), tasks("in_review", "newer\n"), "utf8");
          throw new Error("injected failure after concurrent edit");
        },
      }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED"
        && error.details.some((detail) => detail.includes("Newer central Change preserved")),
    );
    assert.equal(await pathExists(changePath), true);
    assert.equal(await pathExists(destination), true);
    assert.equal((await readConfig(root)).schema, "sdd-v2");
  });
});

test("migration commit guards preserve concurrent data and retryability", async (t) => {
  await t.test("configuration edit at commit time is preserved", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-13-config-race";
    const changePath = join(root, "code", "app", "docs", "changes", id);
    await writeChange(changePath, "in_progress");
    const configPath = join(root, ".sdd", "config.yaml");
    const edited = `${await readFile(configPath, "utf8")}# concurrent edit\n`;
    const plan = await planUpdateMigration(root, await readConfig(root), { userRoot: root });
    await assert.rejects(
      applyUpdateMigration(plan, {
        beforeConfigWrite: async ({ write }) => {
          if (write.path === configPath) await writeFile(configPath, edited, "utf8");
        },
      }),
      (error) => error.code === "CONCURRENT_CHANGE",
    );
    assert.equal(await readFile(configPath, "utf8"), edited);
    assert.equal(await pathExists(changePath), true);
    assert.equal(await pathExists(getActiveChangePath(id, root)), false);
  });

  await t.test("destination deletion prevents legacy source removal", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-14-destination-race";
    const changePath = join(root, "code", "app", "docs", "changes", id);
    await writeChange(changePath, "in_progress");
    const destination = getActiveChangePath(id, root);
    const plan = await planUpdateMigration(root, await readConfig(root), { userRoot: root });
    await assert.rejects(
      applyUpdateMigration(plan, {
        beforeSourceRemoval: () => rm(destination, { recursive: true, force: true }),
      }),
      (error) => error.code === "CONCURRENT_CHANGE",
    );
    assert.equal(await pathExists(changePath), true);
    assert.equal(await pathExists(destination), false);
    assert.equal((await readConfig(root)).schema, "sdd-v2");
  });

  await t.test("partial Change publication is removed and can be retried", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-15-partial-change";
    const changePath = join(root, "code", "app", "docs", "changes", id);
    await writeChange(changePath, "in_progress");
    const destination = getActiveChangePath(id, root);
    const plan = await planUpdateMigration(root, await readConfig(root), { userRoot: root });
    await assert.rejects(
      applyUpdateMigration(plan, {
        beforeChangeEntryPublish: ({ index }) => {
          if (index === 1) throw new Error("injected partial publication");
        },
      }),
      /injected partial publication/,
    );
    assert.equal(await pathExists(changePath), true);
    assert.equal(await pathExists(destination), false);
    const retry = await planUpdateMigration(root, await readConfig(root), { userRoot: root });
    assert.equal(retry.changes.some((change) => change.changeId === id), true);
  });

  await t.test("concurrent brief destination is preserved", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const plannedRoot = join(root, "ideas", "sample", "planned-changes");
    const source = join(plannedRoot, "concurrent-brief.md");
    const destination = join(root, "ideas", "sample", "change-briefs", "concurrent-brief.md");
    await mkdir(plannedRoot, { recursive: true });
    await writeFile(source, "legacy\n", "utf8");
    const plan = await planUpdateMigration(root, await readConfig(root), { userRoot: root });
    await assert.rejects(
      applyUpdateMigration(plan, {
        beforeBriefLink: async () => {
          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, "newer\n", "utf8");
        },
      }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED"
        && error.details.some((detail) => detail.includes("Newer Change Brief preserved")),
    );
    assert.equal(await readFile(destination, "utf8"), "newer\n");
    assert.equal(await readFile(source, "utf8"), "legacy\n");
  });
});

test("interrupted migration recovers durably before replanning", async (t) => {
  await t.test("marker-owned partial Change publication rolls back and reruns", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-16-directory-restart";
    const changePath = join(root, "code", "app", "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    await writeChange(changePath, "in_progress", "directory restart\n");

    await interruptUpdate(root, `{
      beforeChangeEntryPublish: ({ index }) => {
        if (index === 1) process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
      },
    }`);

    assert.equal(await pathExists(join(destination, "design.md")), true);
    assert.equal(await pathExists(join(changePath, "proposal.md")), true);
    assert.ok((await readdir(destination)).some((entry) => entry.startsWith(".sdd-migration-owner-")));

    const recovered = await updateWithFixtureUserRoot(root);
    assert.equal(recovered.migration.required, true);
    assert.equal(await pathExists(changePath), false);
    assert.equal(await pathExists(destination), true);
    assert.match(await readFile(join(destination, "proposal.md"), "utf8"), /directory restart/);

    const settled = await updateWithFixtureUserRoot(root);
    assert.equal(settled.migration.required, false);
  });

  await t.test("already-linked identical Change Brief rolls back and reruns", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const plannedRoot = join(root, "ideas", "sample", "planned-changes");
    const briefRoot = join(root, "ideas", "sample", "change-briefs");
    await mkdir(plannedRoot, { recursive: true });
    await writeFile(join(plannedRoot, "a-first.md"), "first brief\n", "utf8");
    await writeFile(join(plannedRoot, "b-second.md"), "second brief\n", "utf8");

    await interruptUpdate(root, `{
      beforeBriefLink: (() => {
        let index = 0;
        return () => {
          if (index === 1) process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
          index += 1;
        };
      })(),
    }`);

    assert.equal(await readFile(join(briefRoot, "a-first.md"), "utf8"), "first brief\n");
    assert.equal(await pathExists(join(briefRoot, "b-second.md")), false);
    assert.equal(await readFile(join(plannedRoot, "a-first.md"), "utf8"), "first brief\n");

    await updateWithFixtureUserRoot(root);
    assert.equal(await readFile(join(briefRoot, "a-first.md"), "utf8"), "first brief\n");
    assert.equal(await readFile(join(briefRoot, "b-second.md"), "utf8"), "second brief\n");
    assert.equal(await pathExists(plannedRoot), false);
  });

  await t.test("published configuration rolls back before the retry plan is read", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-17-config-restart";
    const repositoryRoot = join(root, "code", "app");
    const changePath = join(repositoryRoot, "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    await writeChange(changePath, "in_progress", "config restart\n");

    await interruptUpdate(root, `{
      beforeConfigWrite: ({ index }) => {
        if (index === 1) process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
      },
    }`);

    assert.equal((await readConfig(root)).schema, "sdd-v3");
    assert.equal((await readRepositoryConfig(repositoryRoot)).schema, "sdd-repository-v1");
    assert.equal(await pathExists(destination), true);
    assert.equal(await pathExists(changePath), true);

    await updateWithFixtureUserRoot(root);
    assert.equal((await readConfig(root)).schema, "sdd-v3");
    assert.equal((await readRepositoryConfig(repositoryRoot)).schema, "sdd-repository-v2");
    assert.equal(await pathExists(changePath), false);
    assert.match(await readFile(join(destination, "proposal.md"), "utf8"), /config restart/);
  });

  await t.test("configuration missing between backup and link is restored before retry planning", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-17-config-backup-restart";
    const repositoryRoot = join(root, "code", "app");
    const repositoryConfigPath = join(repositoryRoot, ".sdd", "config.yaml");
    const changePath = join(repositoryRoot, "docs", "changes", id);
    await writeChange(changePath, "in_progress", "config backup restart\n");

    await interruptUpdate(root, `{
      afterConfigBackup: ({ index }) => {
        if (index === 1) process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
      },
    }`);

    assert.equal(await pathExists(repositoryConfigPath), false);
    await updateWithFixtureUserRoot(root);
    assert.equal((await readRepositoryConfig(repositoryRoot)).schema, "sdd-repository-v2");
    assert.equal(await pathExists(changePath), false);
  });

  await t.test("missing user configuration bootstraps recovery before discovery", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-17-user-config-backup-restart";
    const repositoryRoot = join(root, "code", "app");
    const changePath = join(repositoryRoot, "docs", "changes", id);
    await writeChange(changePath, "in_progress", "user config backup restart\n");

    await interruptUpdate(root, `{
      afterConfigBackup: ({ index }) => {
        if (index === 0) process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
      },
    }`);

    assert.equal(await pathExists(join(root, ".sdd", "config.yaml")), false);
    await updateWithFixtureUserRoot(root);
    assert.equal((await readConfig(root)).schema, "sdd-v3");
    assert.equal((await readRepositoryConfig(repositoryRoot)).schema, "sdd-repository-v2");
    assert.equal(await pathExists(changePath), false);
  });

  await t.test("interrupted config rollback remains recoverable", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-17-config-rollback-restart";
    const repositoryRoot = join(root, "code", "app");
    const changePath = join(repositoryRoot, "docs", "changes", id);
    await writeChange(changePath, "in_progress", "config rollback restart\n");

    await interruptUpdate(root, `{
      beforeConfigWrite: ({ index }) => {
        if (index === 1) process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
      },
    }`);
    await interruptRecovery(root, `{
      afterConfigRestoreBackup: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);

    assert.equal(await pathExists(join(root, ".sdd", "config.yaml")), false);
    await updateWithFixtureUserRoot(root);
    assert.equal((await readConfig(root)).schema, "sdd-v3");
    assert.equal((await readRepositoryConfig(repositoryRoot)).schema, "sdd-repository-v2");
    assert.equal(await pathExists(changePath), false);
  });

  await t.test("tampered config phase cannot bypass missing-target restoration", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const repositoryRoot = join(root, "code", "app");
    const repositoryConfigPath = join(repositoryRoot, ".sdd", "config.yaml");
    await writeChange(
      join(repositoryRoot, "docs", "changes", "2026-08-17-config-phase-tamper"),
      "in_progress",
    );

    await interruptUpdate(root, `{
      afterConfigBackup: ({ index }) => {
        if (index === 1) process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
      },
    }`);
    await mutateInterruptedJournal(root, (journal) => {
      journal.configs[1].phase = "pending";
    });

    assert.equal(await pathExists(repositoryConfigPath), false);
    await updateWithFixtureUserRoot(root);
    assert.equal((await readRepositoryConfig(repositoryRoot)).schema, "sdd-repository-v2");
  });

  await t.test("committed cleanup resumes from verified and partially cleaned records", async (t) => {
    const root = await createFixture({ repositories: ["app", "worker", "api"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    for (const repository of ["app", "worker", "api"]) {
      await writeChange(
        join(root, "code", repository, "docs", "changes", `2026-08-17-${repository}-committed-restart`),
        "in_progress",
        `${repository} committed restart\n`,
      );
    }

    await interruptUpdate(root, `{
      beforeSourceRemoval: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);

    let sourceRecords;
    await mutateInterruptedJournal(root, (journal) => {
      sourceRecords = journal.sources.map((record) => ({ ...record }));
    });
    assert.equal(sourceRecords.length, 3);
    for (const record of sourceRecords) {
      await rename(record.physicalPath, record.backup);
    }
    await Promise.all(sourceRecords.slice(0, 2).map(
      (record) => rm(record.backup, { recursive: true, force: true }),
    ));
    await mutateInterruptedJournal(root, (journal) => {
      journal.status = "committed";
      journal.sources.forEach((record, index) => {
        record.phase = index === 0 ? "cleaned" : "removed";
      });
    });

    await updateWithFixtureUserRoot(root);
    for (const record of sourceRecords) {
      assert.equal(await pathExists(record.backup), false);
    }
    const stagingEntries = (await readdir(join(root, ".sdd", "changes")))
      .filter((entry) => entry.startsWith(".sdd-update-"));
    assert.equal(stagingEntries.length, 0);
  });

  await t.test("contradictory committed journal retains recovery artifacts", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const repositoryRoot = join(root, "code", "app");
    const repositoryConfigPath = join(repositoryRoot, ".sdd", "config.yaml");
    await writeChange(
      join(repositoryRoot, "docs", "changes", "2026-08-17-config-status-tamper"),
      "in_progress",
    );

    await interruptUpdate(root, `{
      afterConfigBackup: ({ index }) => {
        if (index === 1) process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
      },
    }`);
    await mutateInterruptedJournal(root, (journal) => {
      journal.status = "committed";
    });

    await assert.rejects(
      updateWithFixtureUserRoot(root),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await pathExists(repositoryConfigPath), false);
    const stagingEntries = (await readdir(join(root, ".sdd", "changes")))
      .filter((entry) => entry.startsWith(".sdd-update-"));
    assert.equal(stagingEntries.length, 1);
  });

  await t.test("committed status cannot discard an unremoved legacy source", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const sourcePath = join(root, "code", "app", "docs", "changes");
    await writeChange(
      join(sourcePath, "2026-08-17-source-status-tamper"),
      "in_progress",
    );

    await interruptUpdate(root, `{
      beforeSourceRemoval: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);
    await mutateInterruptedJournal(root, (journal) => {
      journal.status = "committed";
      journal.sources.forEach((record) => {
        record.phase = "removed";
      });
    });

    await assert.rejects(
      updateWithFixtureUserRoot(root),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await pathExists(sourcePath), true);
    const stagingEntries = (await readdir(join(root, ".sdd", "changes")))
      .filter((entry) => entry.startsWith(".sdd-update-"));
    assert.equal(stagingEntries.length, 1);
  });

  await t.test("committed status cannot hide an incomplete destination", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    await writeChange(
      join(root, "code", "app", "docs", "changes", "2026-08-17-destination-status-tamper"),
      "in_progress",
    );

    await interruptUpdate(root, `{
      beforeSourceRemoval: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);
    let destination;
    await mutateInterruptedJournal(root, (journal) => {
      destination = journal.changes[0].destination;
      journal.status = "committed";
      journal.sources.forEach((record) => {
        record.phase = "removed";
      });
    });
    await rm(destination, { recursive: true, force: true });

    await assert.rejects(
      updateWithFixtureUserRoot(root),
      (error) => (
        error.code === "MUTATION_RECOVERY_FAILED"
        && error.details.some((detail) => detail.includes("Published central Change is incomplete"))
      ),
    );
    assert.equal(await pathExists(destination), false);
    const stagingEntries = (await readdir(join(root, ".sdd", "changes")))
      .filter((entry) => entry.startsWith(".sdd-update-"));
    assert.equal(stagingEntries.length, 1);
  });

  await t.test("tampered partial destination is preserved and recovery fails closed", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-18-foreign-restart";
    const changePath = join(root, "code", "app", "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    await writeChange(changePath, "in_progress", "foreign restart\n");

    await interruptUpdate(root, `{
      beforeChangeEntryPublish: ({ index }) => {
        if (index === 1) process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
      },
    }`);

    const marker = (await readdir(destination))
      .find((entry) => entry.startsWith(".sdd-migration-owner-"));
    assert.ok(marker);
    await rm(join(destination, marker));
    await writeFile(join(destination, "foreign.txt"), "unrelated\n", "utf8");

    await assert.rejects(
      updateWithFixtureUserRoot(root),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(join(destination, "foreign.txt"), "utf8"), "unrelated\n");
    assert.equal(await pathExists(changePath), true);
  });

  await t.test("tampered journal cannot overwrite an unrelated file", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-18-journal-config-target";
    await writeChange(join(root, "code", "app", "docs", "changes", id), "in_progress");
    const victim = join(root, "unrelated.txt");
    await writeFile(victim, "preserve me\n", "utf8");

    await interruptUpdate(root, `{
      beforeChangeEntryPublish: ({ index }) => {
        if (index === 1) process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
      },
    }`);
    await mutateInterruptedJournal(root, (journal) => {
      journal.configs[0].path = victim;
    });

    await assert.rejects(
      updateWithFixtureUserRoot(root),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(victim, "utf8"), "preserve me\n");
  });

  await t.test("tampered journal cannot remove an unrelated directory", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-18-journal-source-target";
    await writeChange(join(root, "code", "app", "docs", "changes", id), "in_progress");
    const victim = join(root, "unrelated-directory");
    await mkdir(victim);
    await writeFile(join(victim, "preserve.txt"), "preserve me\n", "utf8");

    await interruptUpdate(root, `{
      beforeChangeEntryPublish: ({ index }) => {
        if (index === 1) process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
      },
    }`);
    await mutateInterruptedJournal(root, (journal) => {
      journal.sources[0].backup = victim;
      journal.sources[0].phase = "removed";
    });

    await assert.rejects(
      updateWithFixtureUserRoot(root),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(join(victim, "preserve.txt"), "utf8"), "preserve me\n");
  });

  await t.test("foreign identical Change Brief remains a collision", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const plannedRoot = join(root, "ideas", "sample", "planned-changes");
    const source = join(plannedRoot, "same.md");
    const destination = join(root, "ideas", "sample", "change-briefs", "same.md");
    await mkdir(dirname(destination), { recursive: true });
    await mkdir(plannedRoot, { recursive: true });
    await writeFile(source, "identical\n", "utf8");
    await writeFile(destination, "identical\n", "utf8");

    await assert.rejects(
      updateWithFixtureUserRoot(root),
      (error) => error.code === "CHANGE_BRIEF_COLLISION",
    );
    assert.equal(await readFile(source, "utf8"), "identical\n");
    assert.equal(await readFile(destination, "utf8"), "identical\n");
    assert.equal((await readConfig(root)).schema, "sdd-v2");
  });
});


test("configuration replacement phases remain rollback-safe", async (t) => {
  await t.test("post-publication cleanup failure restores every advanced config", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-19-config-publication";
    const repositoryRoot = join(root, "code", "app");
    const changePath = join(repositoryRoot, "docs", "changes", id);
    await writeChange(changePath, "in_progress");
    const plan = await planUpdateMigration(root, await readConfig(root), { userRoot: root });

    await assert.rejects(
      applyUpdateMigration(plan, {
        afterConfigPublish: ({ index }) => {
          if (index === 0) throw new Error("injected post-publication cleanup failure");
        },
      }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );

    assert.equal((await readConfig(root)).schema, "sdd-v2");
    assert.equal((await readRepositoryConfig(repositoryRoot)).schema, "sdd-repository-v1");
    assert.equal(await pathExists(changePath), true);
    assert.equal(await pathExists(getActiveChangePath(id, root)), false);
  });

  await t.test("post-publication verification failure restores every advanced config", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-20-config-verification";
    const repositoryRoot = join(root, "code", "app");
    const changePath = join(repositoryRoot, "docs", "changes", id);
    await writeChange(changePath, "in_progress");
    const plan = await planUpdateMigration(root, await readConfig(root), { userRoot: root });

    await assert.rejects(
      applyUpdateMigration(plan, {
        afterConfigWrite: ({ index }) => {
          if (index === 0) throw new Error("injected post-publication verification failure");
        },
      }),
      /injected post-publication verification failure/,
    );

    assert.equal((await readConfig(root)).schema, "sdd-v2");
    assert.equal((await readRepositoryConfig(repositoryRoot)).schema, "sdd-repository-v1");
    assert.equal(await pathExists(changePath), true);
    assert.equal(await pathExists(getActiveChangePath(id, root)), false);
  });
});

test("source cleanup re-anchors its physical owner immediately before rename", async (t) => {
  const root = await createFixture({ repositories: ["app"] });
  const external = await mkdtemp(join(tmpdir(), "sdd-update-migration-external-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(external, { recursive: true, force: true }));
  const id = "2026-08-21-source-owner-race";
  const repositoryRoot = join(root, "code", "app");
  const movedRepositoryRoot = join(root, "code", "app-preflighted");
  const changePath = join(repositoryRoot, "docs", "changes", id);
  const externalChangeRoot = join(external, "docs", "changes");
  await writeChange(changePath, "in_progress");
  const currentRepositoryConfig = await readRepositoryConfig(repositoryRoot);
  await writeYaml(
    join(repositoryRoot, ".sdd", "config.yaml"),
    migrateRepositoryConfig(currentRepositoryConfig).config,
  );
  const plan = await planUpdateMigration(root, await readConfig(root), { userRoot: root });

  await assert.rejects(
    applyUpdateMigration(plan, {
      beforeSourceRename: async () => {
        await rename(repositoryRoot, movedRepositoryRoot);
        await cp(
          join(movedRepositoryRoot, "docs", "changes"),
          externalChangeRoot,
          { recursive: true },
        );
        await symlink(external, repositoryRoot);
      },
    }),
    (error) => error.code === "CONCURRENT_CHANGE",
  );

  assert.equal(await pathExists(join(externalChangeRoot, id, "tasks.md")), true);
  assert.equal(await pathExists(join(movedRepositoryRoot, "docs", "changes", id, "tasks.md")), true);
  assert.equal(await pathExists(getActiveChangePath(id, root)), false);
  assert.equal((await readConfig(root)).schema, "sdd-v2");
});