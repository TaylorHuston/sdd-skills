import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmod,
  cp,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rmdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { stringify } from "yaml";

import { parseChangeMetadata, setChangeMetadata } from "../src/change-status.js";
import { getActiveChangePath, getClosedChangePath } from "../src/change-store.js";
import {
  migrateRepositoryConfig,
  migrateWorkspaceConfig,
  readRepositoryConfig,
  readWorkspaceConfig,
} from "../src/config.js";
import { updateWorkspace } from "../src/commands/update.js";
import { hashDirectory, hashFile, pathExists } from "../src/fs.js";
import {
  applyUpdateMigration,
  planUpdateMigration,
  recoverUpdateMigration,
} from "../src/update-migration.js";

const INTERRUPTED_UPDATE_EXIT_CODE = 86;
const CONFIG_MODULE_URL = new URL("../src/config.js", import.meta.url).href;
const MIGRATION_MODULE_URL = new URL("../src/update-migration.js", import.meta.url).href;
const MUTATION_MODULE_URL = new URL("../src/mutation.js", import.meta.url).href;
const execFileAsync = promisify(execFile);

async function finalizeMigrationTransaction(transaction) {
  await transaction.assertCommitReady();
  await transaction.commit();
  await transaction.finalizeCleanup();
}

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

async function interruptUpdate(root, migrationOptionsSource, { finalize = false } = {}) {
  const script = `
    import { readWorkspaceConfig } from ${JSON.stringify(CONFIG_MODULE_URL)};
    import { withWorkspaceMutationLock } from ${JSON.stringify(MUTATION_MODULE_URL)};
    import {
      applyUpdateMigration,
      planUpdateMigration,
    } from ${JSON.stringify(MIGRATION_MODULE_URL)};

    const root = ${JSON.stringify(root)};
    await withWorkspaceMutationLock(root, async (mutationLock) => {
      const plan = await planUpdateMigration(root, await readWorkspaceConfig(root), { destinationWorkspaceRoot: root });
      const transaction = await applyUpdateMigration(plan, {
        ...${migrationOptionsSource},
        mutationLock,
      });
      if (${JSON.stringify(finalize)}) {
        await transaction.assertCommitReady();
        await transaction.commit();
        await transaction.finalizeCleanup();
      }
    });
  `;
  const error = await execFileAsync(
    process.execPath,
    ["--input-type=module", "--eval", script],
    { env: process.env },
  ).then(() => null, (caught) => caught);
  assert.ok(error, "interrupted update process unexpectedly completed");
  assert.equal(error.code, INTERRUPTED_UPDATE_EXIT_CODE, error.stderr);
}

async function interruptRecovery(root, recoveryOptionsSource) {
  const script = `
    import { withWorkspaceMutationLock } from ${JSON.stringify(MUTATION_MODULE_URL)};
    import { recoverUpdateMigration } from ${JSON.stringify(MIGRATION_MODULE_URL)};

    const root = ${JSON.stringify(root)};
    await withWorkspaceMutationLock(root, async (mutationLock) => {
      await recoverUpdateMigration(root, {
        destinationWorkspaceRoot: root,
        ...${recoveryOptionsSource},
        mutationLock,
      });
    });
  `;
  const error = await execFileAsync(
    process.execPath,
    ["--input-type=module", "--eval", script],
    { env: process.env },
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
  return {
    stagingRoot: dirname(journalPath),
    journalPath,
    journal,
  };
}

async function mutateInterruptedDestinationManifest(root, mutate) {
  const changesRoot = join(root, ".sdd", "changes");
  const [stagingName] = (await readdir(changesRoot))
    .filter((entry) => entry.startsWith(".sdd-update-"));
  assert.ok(stagingName);
  const stagingRoot = join(changesRoot, stagingName);
  const manifestPath = join(stagingRoot, "destinations.json");
  const digestPath = join(root, ".sdd", `${stagingName}-destinations.digest`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  mutate(manifest);
  await chmod(manifestPath, 0o600);
  await chmod(digestPath, 0o600);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(digestPath, `${await hashFile(manifestPath)}\n`, "utf8");
  await chmod(manifestPath, 0o400);
  await chmod(digestPath, 0o400);
  return { stagingName, stagingRoot, manifest };
}

async function mutateInterruptedSourceDerivedManifest(root, mutate) {
  const changesRoot = join(root, ".sdd", "changes");
  const [stagingName] = (await readdir(changesRoot))
    .filter((entry) => entry.startsWith(".sdd-update-"));
  assert.ok(stagingName);
  const stagingRoot = join(changesRoot, stagingName);
  const manifestPath = join(stagingRoot, "source-derived-destinations.json");
  const digestPath = join(
    root,
    ".sdd",
    `${stagingName}-source-derived-destinations.digest`,
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  mutate(manifest);
  await chmod(manifestPath, 0o600);
  await chmod(digestPath, 0o600);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(digestPath, `${await hashFile(manifestPath)}\n`, "utf8");
  await chmod(manifestPath, 0o400);
  await chmod(digestPath, 0o400);
  return {
    snapshot: JSON.stringify({
      changes: manifest.changes,
      briefs: manifest.briefs,
    }),
  };
}

async function moveInterruptedSourcesToBackups(records) {
  for (const [index, record] of records.entries()) {
    await mkdir(record.backup, { mode: 0o700 });
    const backupState = await lstat(record.backup);
    record.backupIdentity = {
      dev: String(backupState.dev),
      ino: String(backupState.ino),
    };
    record.backupMode = backupState.mode & 0o777;
    const payloadPath = join(record.backup, `payload-${index}`);
    await rename(record.physicalPath, payloadPath);
    const payloadState = await lstat(payloadPath);
    record.backupPayloadIdentity = {
      dev: String(payloadState.dev),
      ino: String(payloadState.ino),
    };
  }
}

async function prepareInterruptedSourceCleanup(record) {
  record.cleanupPath = join(record.backup, `.sdd-cleanup-${randomUUID()}`);
  await mkdir(record.cleanupPath, { mode: 0o700 });
  const cleanupState = await lstat(record.cleanupPath);
  record.cleanupIdentity = {
    dev: String(cleanupState.dev),
    ino: String(cleanupState.ino),
  };
  record.cleanupMode = cleanupState.mode & 0o777;
  await rm(record.backup, { recursive: true, force: true });
}

async function updateFixture(root) {
  return updateWorkspace(root, { workspaceRoot: root });
}

test("automatic update migration consolidates identical Changes, preserves briefs, upgrades configs, and reruns as a no-op", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const plannedId = "2026-08-01-planned-change";
  const sharedId = "2026-08-02-shared-change";
  const closedId = "2026-08-03-closed-change";
  const briefName = "2026-08-04-future-capability.md";
  const plannedRoot = join(root, "ideas", "sample", "planned-changes");
  await writeChange(join(plannedRoot, plannedId), "planned", "planned\n");
  await writeFile(
    join(plannedRoot, plannedId, "proposal.md"),
    "# Proposal\n\n## Target Repositories\n\n- `code/app`\n- `code/worker`\n",
    "utf8",
  );
  await writeFile(join(plannedRoot, briefName), "# Future capability\n", "utf8");

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

  const rawConfig = await readWorkspaceConfig(root);
  const plan = await planUpdateMigration(root, rawConfig, { destinationWorkspaceRoot: root });
  assert.equal(plan.result.required, true);
  assert.deepEqual(
    plan.result.actions.filter((action) => action.kind === "change").map((action) => action.changeId),
    [plannedId, sharedId, closedId].sort(),
  );
  assert.deepEqual(plan.briefs.map((brief) => basename(brief.sourcePath)), [briefName]);
  assert.equal(await pathExists(getActiveChangePath(plannedId, root)), false);
  assert.equal(await pathExists(join(root, "ideas", "sample", "change-briefs", briefName)), false);
  assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v2");

  const transaction = await applyUpdateMigration(plan);
  await finalizeMigrationTransaction(transaction);

  const upgraded = await readWorkspaceConfig(root);
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
    await readFile(join(root, "ideas", "sample", "change-briefs", briefName), "utf8"),
    "# Future capability\n",
  );
  assert.equal(await pathExists(plannedRoot), false);

  const rerun = await planUpdateMigration(root, upgraded, { destinationWorkspaceRoot: root });
  assert.equal(rerun.result.required, false);
  assert.deepEqual(rerun.result.actions, []);
});

test("normal legacy Change migration verifies the canonical hash with fs.hashDirectory", async (t) => {
  const root = await createFixture({ repositories: ["app"] });
  t.after(() => rm(root, { recursive: true, force: true }));

  const id = "2026-08-04-canonical-hash";
  const source = join(root, "code", "app", "docs", "changes", id);
  await writeChange(source, "in_progress", "canonical hash\n");

  const config = await readWorkspaceConfig(root);
  const plan = await planUpdateMigration(root, config, { destinationWorkspaceRoot: root });
  const change = plan.changes.find((candidate) => candidate.changeId === id);
  assert.ok(change);

  const transaction = await applyUpdateMigration(plan);
  await finalizeMigrationTransaction(transaction);

  const destination = getActiveChangePath(id, root);
  assert.equal(await pathExists(source), false);
  assert.equal(await hashDirectory(destination), change.canonicalHash);
});

test("normal legacy Change migration preserves exact directory and file modes", async (t) => {
  const root = await createFixture({ repositories: ["app"] });
  t.after(() => rm(root, { recursive: true, force: true }));

  const id = "2026-08-04-mode-preservation";
  const source = join(root, "code", "app", "docs", "changes", id);
  const nested = join(source, "evidence", "restricted");
  const note = join(nested, "note.txt");
  await writeChange(source, "in_progress", "mode preservation\n");
  await mkdir(nested, { recursive: true, mode: 0o710 });
  await writeFile(note, "mode-bound evidence\n", { mode: 0o640 });
  await chmod(source, 0o750);
  await chmod(join(source, "evidence"), 0o751);
  await chmod(nested, 0o710);
  await chmod(note, 0o640);

  await updateFixture(root);

  const destination = getActiveChangePath(id, root);
  assert.equal((await lstat(destination)).mode & 0o777, 0o750);
  assert.equal((await lstat(join(destination, "evidence"))).mode & 0o777, 0o751);
  assert.equal((await lstat(join(destination, "evidence", "restricted"))).mode & 0o777, 0o710);
  assert.equal((await lstat(join(destination, "evidence", "restricted", "note.txt"))).mode & 0o777, 0o640);
  assert.equal(await pathExists(source), false);
});

async function legacyNulDelimitedFlatTreeHash(root) {
  const hash = createHash("sha256");
  const entries = await readdir(root, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    assert.equal(entry.isFile(), true);
    hash.update(`file\0${entry.name}\0`);
    hash.update(await readFile(join(root, entry.name)));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

test("canonical Change hashing length-prefixes separator-like names and control bytes", async (t) => {
  const root = await createFixture({ repositories: ["app"] });
  t.after(() => rm(root, { recursive: true, force: true }));

  const firstId = "2026-08-04-hash-frame-a";
  const secondId = "2026-08-04-hash-frame-b";
  const first = join(root, "code", "app", "docs", "changes", firstId);
  const second = join(root, "code", "app", "docs", "changes", secondId);
  await writeChange(first, "in_progress", "same canonical bytes\n");
  await writeChange(second, "in_progress", "same canonical bytes\n");

  const anchorName = "y-anchor.bin";
  const edgeName = "z\\separator\u001fcontrol.md";
  const prefix = Buffer.from("prefix");
  const suffix = Buffer.from("suffix");
  await writeFile(
    join(first, anchorName),
    Buffer.concat([
      prefix,
      Buffer.from(`\0file\0${edgeName}\0`, "utf8"),
      suffix,
    ]),
  );
  await writeFile(join(second, anchorName), prefix);
  await writeFile(join(second, edgeName), suffix);

  assert.equal(
    await legacyNulDelimitedFlatTreeHash(first),
    await legacyNulDelimitedFlatTreeHash(second),
    "the regression fixture must collide under the retired NUL-delimited framing",
  );

  const config = await readWorkspaceConfig(root);
  const plan = await planUpdateMigration(root, config, { destinationWorkspaceRoot: root });
  const changes = new Map(plan.changes.map((change) => [change.changeId, change]));
  const firstChange = changes.get(firstId);
  const secondChange = changes.get(secondId);
  assert.ok(firstChange);
  assert.ok(secondChange);
  assert.notEqual(firstChange.canonicalHash, secondChange.canonicalHash);

  const transaction = await applyUpdateMigration(plan);
  await finalizeMigrationTransaction(transaction);

  assert.equal(
    await hashDirectory(getActiveChangePath(firstId, root)),
    firstChange.canonicalHash,
  );
  assert.equal(
    await hashDirectory(getActiveChangePath(secondId, root)),
    secondChange.canonicalHash,
  );
  assert.deepEqual(
    await readFile(join(getActiveChangePath(secondId, root), edgeName)),
    suffix,
  );
});

test("persisted migration evidence rejects an incompatible canonical Change hash scheme", async (t) => {
  const root = await createFixture({ repositories: ["app"] });
  t.after(() => rm(root, { recursive: true, force: true }));

  const id = "2026-08-04-hash-journal";
  const source = join(root, "code", "app", "docs", "changes", id);
  await writeChange(source, "in_progress", "versioned canonical hash\n");
  await interruptUpdate(root, `{
    beforeSourceRemoval: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
  }`);

  const transaction = await mutateInterruptedJournal(root, (journal) => {
    assert.equal(journal.version, 8);
    assert.equal(journal.canonicalChangeHashScheme, "sha256-directory-v2");
    journal.canonicalChangeHashScheme = "sha256-nul-delimited-tree-v0";
  });
  for (const name of ["destinations.json", "source-derived-destinations.json"]) {
    const manifest = JSON.parse(await readFile(join(transaction.stagingRoot, name), "utf8"));
    assert.equal(manifest.version, 2);
    assert.equal(manifest.canonicalChangeHashScheme, "sha256-directory-v2");
  }

  await assert.rejects(
    recoverUpdateMigration(root, { destinationWorkspaceRoot: root }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.details.some((detail) =>
        detail.includes("Journal canonical Change hash scheme is unsupported.")),
  );
  assert.equal(await pathExists(source), true);
  assert.equal(await pathExists(getActiveChangePath(id, root)), true);
  assert.equal(await pathExists(transaction.stagingRoot), true);
});

test("update dry-run plans every migration action without mutating config, Changes, briefs, sources, or installation", async (t) => {
  const root = await createFixture({ repositories: ["app"] });
  t.after(() => rm(root, { recursive: true, force: true }));

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
    const plan = await planUpdateMigration(root, await readWorkspaceConfig(root), { destinationWorkspaceRoot: root });
    assert.deepEqual(plan.changes.find((change) => change.changeId === id).repositories, ["app"]);
  });

  await t.test("recorded inactive and archived target paths preserve repository identities", async (t) => {
    const root = await createFixture();
    t.after(() => rm(root, { recursive: true, force: true }));
    const config = legacyWorkspaceConfig();
    config.ideas.sample.repositories[0].status = "inactive";
    config.ideas.sample.repositories[1].status = "archived";
    await writeYaml(join(root, ".sdd", "config.yaml"), config);
    const id = "2026-08-04-inactive-targeted";
    const changePath = join(root, "ideas", "sample", "planned-changes", id);
    await writeChange(changePath, "planned");
    await writeFile(
      join(changePath, "proposal.md"),
      "# Proposal\n\n## Target Repositories\n\n- `code/app`\n- `code/worker`\n",
      "utf8",
    );

    const plan = await planUpdateMigration(root, await readWorkspaceConfig(root), { destinationWorkspaceRoot: root });

    assert.deepEqual(plan.changes.find((change) => change.changeId === id).repositories, ["app", "worker"]);
  });

  await t.test("targetless draft preserves the sole inactive mapping identity", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const config = legacyWorkspaceConfig(["app"]);
    config.ideas.sample.repositories[0].status = "inactive";
    await writeYaml(join(root, ".sdd", "config.yaml"), config);
    const id = "2026-08-04-inactive-deterministic";
    await writeChange(join(root, "ideas", "sample", "planned-changes", id), "planned");

    const plan = await planUpdateMigration(root, await readWorkspaceConfig(root), { destinationWorkspaceRoot: root });

    assert.deepEqual(plan.changes.find((change) => change.changeId === id).repositories, ["app"]);
  });

  await t.test("targetless draft fails closed when only inactive and archived mappings exist", async (t) => {
    const root = await createFixture();
    t.after(() => rm(root, { recursive: true, force: true }));
    const config = legacyWorkspaceConfig();
    config.ideas.sample.repositories[0].status = "inactive";
    config.ideas.sample.repositories[1].status = "archived";
    await writeYaml(join(root, ".sdd", "config.yaml"), config);
    const id = "2026-08-04-inactive-ambiguous";
    await writeChange(join(root, "ideas", "sample", "planned-changes", id), "planned");

    await assert.rejects(
      planUpdateMigration(root, await readWorkspaceConfig(root), { destinationWorkspaceRoot: root }),
      (error) => error.code === "MIGRATION_TARGET_REQUIRED"
        && error.details.includes("code/app")
        && error.details.includes("code/worker"),
    );
    assert.equal(await pathExists(getActiveChangePath(id, root)), false);
    assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v2");
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
      planUpdateMigration(root, await readWorkspaceConfig(root), { destinationWorkspaceRoot: root }),
      (error) => error.code === "MIGRATION_IDENTITY_REQUIRED"
        && error.details.includes(join(root, "code", "app"))
        && error.details.includes(join(root, "code", "worker")),
    );

    assert.equal(await pathExists(getActiveChangePath(id, root)), false);
    assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v2");
    assert.equal((await readRepositoryConfig(join(root, "code", "app"))).schema, "sdd-repository-v1");
    assert.equal((await readRepositoryConfig(join(root, "code", "worker"))).schema, "sdd-repository-v1");
  });

  await t.test("targetless multi-repository draft fails before writes", async (t) => {
    const root = await createFixture();
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-04-ambiguous";
    await writeChange(join(root, "ideas", "sample", "planned-changes", id), "planned");
    await assert.rejects(
      planUpdateMigration(root, await readWorkspaceConfig(root), { destinationWorkspaceRoot: root }),
      (error) => error.code === "MIGRATION_TARGET_REQUIRED",
    );
    assert.equal(await pathExists(getActiveChangePath(id, root)), false);
    assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v2");
  });
});

test("migration blocks locator upgrades when legacy owners are unavailable", async (t) => {
  await t.test("mapped repository is unavailable", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    await rm(join(root, "code", "app"), { recursive: true, force: true });
    await assert.rejects(
      planUpdateMigration(root, await readWorkspaceConfig(root), { destinationWorkspaceRoot: root }),
      (error) => error.code === "MIGRATION_SOURCE_UNAVAILABLE"
        && error.details.includes(join(root, "code", "app")),
    );
    assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v2");
  });

  await t.test("planning owner is unavailable", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    await rm(join(root, "ideas", "sample"), { recursive: true, force: true });
    await assert.rejects(
      planUpdateMigration(root, await readWorkspaceConfig(root), { destinationWorkspaceRoot: root }),
      (error) => error.code === "MIGRATION_SOURCE_UNAVAILABLE"
        && error.details.includes(join(root, "ideas", "sample")),
    );
    assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v2");
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
      planUpdateMigration(root, await readWorkspaceConfig(root), { destinationWorkspaceRoot: root }),
      (error) => error.code === "DIVERGENT_CHANGE_COPIES",
    );
    assert.equal(await pathExists(getActiveChangePath(id, root)), false);
    assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v2");
  });

  await t.test("cross-Space global ID reuse", async (t) => {
    const root = await createFixture({ repositories: ["app", "worker"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const config = await readWorkspaceConfig(root);
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
      planUpdateMigration(root, await readWorkspaceConfig(root), { destinationWorkspaceRoot: root }),
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
      planUpdateMigration(root, await readWorkspaceConfig(root), { destinationWorkspaceRoot: root }),
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
      planUpdateMigration(root, await readWorkspaceConfig(root), { destinationWorkspaceRoot: root }),
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
      planUpdateMigration(root, await readWorkspaceConfig(root), { destinationWorkspaceRoot: root }),
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
      planUpdateMigration(root, await readWorkspaceConfig(root), { destinationWorkspaceRoot: root }),
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
    const plan = await planUpdateMigration(root, await readWorkspaceConfig(root), { destinationWorkspaceRoot: root });
    await assert.rejects(
      applyUpdateMigration(plan, {
        beforeCommit: () => writeFile(join(changePath, "tasks.md"), tasks("in_review"), "utf8"),
      }),
      (error) => error.code === "CONCURRENT_CHANGE",
    );
    assert.equal(await pathExists(getActiveChangePath(id, root)), false);
    assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v2");
  });

  await t.test("later failure restores central publication and upgraded configs", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-11-rollback";
    const changePath = join(root, "code", "app", "docs", "changes", id);
    await writeChange(changePath, "in_progress");
    const plan = await planUpdateMigration(root, await readWorkspaceConfig(root), { destinationWorkspaceRoot: root });
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
    assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v2");
    assert.equal((await readRepositoryConfig(join(root, "code", "app"))).schema, "sdd-repository-v1");
  });

  await t.test("concurrent destination edit is preserved and incomplete recovery is explicit", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-12-incomplete-recovery";
    const changePath = join(root, "code", "app", "docs", "changes", id);
    await writeChange(changePath, "in_progress");
    const destination = getActiveChangePath(id, root);
    const plan = await planUpdateMigration(root, await readWorkspaceConfig(root), { destinationWorkspaceRoot: root });
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
    assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v2");
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
    const plan = await planUpdateMigration(root, await readWorkspaceConfig(root), { destinationWorkspaceRoot: root });
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

  await t.test("committed destination failure retains every backup without restoring legacy sources", async (t) => {
    const root = await createFixture({ repositories: ["app", "worker"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const ids = {
      app: "2026-08-13-finalize-restore-app",
      worker: "2026-08-13-finalize-restore-worker",
    };
    for (const [repository, id] of Object.entries(ids)) {
      await writeChange(
        join(root, "code", repository, "docs", "changes", id),
        "in_progress",
        `${repository} finalize restore\n`,
      );
    }

    let pending;
    let collisionRecord;
    let collisionBackupFile;
    let collisionRelativeParts;
    let collisionFile;
    let collisionBytes;
    let collisionBackupIdentity;
    let collisionCopyIdentity;
    let backupHashes;
    let injected = false;
    const driftedDestination = getActiveChangePath(ids.app, root);
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );
    const transaction = await applyUpdateMigration(plan, {
      afterSourceBackupVerification: async () => {
        if (injected) return;
        injected = true;
        backupHashes = await Promise.all(
          pending.journal.sources.map((record) => hashDirectory(record.backup)),
        );
        collisionFile = join(collisionRecord.physicalPath, ...collisionRelativeParts);
        collisionBytes = await readFile(collisionBackupFile);
        collisionBackupIdentity = await lstat(collisionBackupFile);
        await mkdir(dirname(collisionFile), { recursive: true });
        await cp(collisionBackupFile, collisionFile);
        collisionCopyIdentity = await lstat(collisionFile);
        await writeFile(
          join(driftedDestination, "tasks.md"),
          tasks("in_review", "destination drift during finalization\n"),
          "utf8",
        );
      },
    });
    pending = await mutateInterruptedJournal(root, () => {});
    assert.ok(pending.journal.sources.length > 1);
    const findFirstBackupFile = async (path, relativeParts = []) => {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        if (entry.isFile()) {
          return { path: join(path, entry.name), relativeParts: [...relativeParts, entry.name] };
        }
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          const found = await findFirstBackupFile(
            join(path, entry.name),
            [...relativeParts, entry.name],
          );
          if (found) return found;
        }
      }
      return null;
    };
    for (const record of pending.journal.sources.slice(0, -1)) {
      const payloadEntry = (await readdir(record.backup, { withFileTypes: true }))
        .find((entry) => !entry.name.startsWith(".sdd-cleanup-"));
      if (!payloadEntry?.isDirectory() || payloadEntry.isSymbolicLink()) continue;
      const found = await findFirstBackupFile(join(record.backup, payloadEntry.name));
      if (!found) continue;
      collisionRecord = record;
      collisionBackupFile = found.path;
      collisionRelativeParts = found.relativeParts;
      break;
    }
    assert.ok(collisionRecord);

    await assert.rejects(
      finalizeMigrationTransaction(transaction),
      (error) => error.code === "MUTATION_RECOVERY_FAILED"
        && error.details.some((detail) => detail.includes("Central Change destination changed")),
    );

    assert.equal(injected, true);
    assert.deepEqual(await readFile(collisionFile), collisionBytes);
    assert.notEqual(String(collisionCopyIdentity.ino), String(collisionBackupIdentity.ino));
    for (const [index, record] of pending.journal.sources.entries()) {
      assert.equal(await hashDirectory(record.backup), backupHashes[index]);
      assert.equal(await pathExists(record.physicalPath), record === collisionRecord);
    }
    assert.equal(await pathExists(driftedDestination), true);
    assert.equal(await pathExists(pending.stagingRoot), true);
    assert.equal(await pathExists(pending.journalPath), true);
  });

  await t.test("repository config loaded for migration cannot be replaced before its write guard", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-13-repository-config-race";
    const changePath = join(root, "code", "app", "docs", "changes", id);
    const repositoryRoot = join(root, "code", "app");
    const configPath = join(repositoryRoot, ".sdd", "config.yaml");
    await writeChange(changePath, "in_progress");
    const edited = `${await readFile(configPath, "utf8")}# concurrent repository edit\n`;

    const plan = await planUpdateMigration(root, await readWorkspaceConfig(root), {
      destinationWorkspaceRoot: root,
      afterRepositoryConfigLoaded: async ({ repositoryRoot: loadedRoot }) => {
        if (loadedRoot === repositoryRoot) await writeFile(configPath, edited, "utf8");
      },
    });
    await assert.rejects(
      applyUpdateMigration(plan),
      (error) => error.code === "CONCURRENT_CHANGE",
    );
    assert.equal(await readFile(configPath, "utf8"), edited);
    assert.equal(await pathExists(changePath), true);
    assert.equal(await pathExists(getActiveChangePath(id, root)), false);
  });

  await t.test("workspace update preserves an install lock edited before publication", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const lockPath = join(root, ".sdd", "install-lock.json");
    const original = "{\"managedSkills\":{},\"owner\":\"original\"}\n";
    const winner = "{\"managedSkills\":{},\"owner\":\"external\"}\n";
    await writeFile(lockPath, original, "utf8");

    await assert.rejects(
      updateWorkspace(root, {
        workspaceRoot: root,
        migrationOptions: {
          beforeCommit: () => writeFile(lockPath, winner, "utf8"),
        },
      }),
      (error) => error?.code === "CONCURRENT_CHANGE",
    );
    assert.equal(await readFile(lockPath, "utf8"), winner);
    assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v2");
  });

  await t.test("workspace update rejects a config replacement between migration handoff and consumption", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    await updateWorkspace(root, { workspaceRoot: root });
    const configPath = join(root, ".sdd", "config.yaml");
    const displacedConfig = join(root, "pre-handoff-config.yaml");
    const lockPath = join(root, ".sdd", "install-lock.json");
    const workflowPath = join(root, ".sdd", "story-driven-development.md");
    const skillsPath = join(root, ".agents", "skills");
    const configSource = await readFile(configPath, "utf8");
    const lockSource = await readFile(lockPath, "utf8");
    const workflowHash = await hashFile(workflowPath);
    const skillsHash = await hashDirectory(skillsPath);
    let handedOffSnapshot;
    let winnerIdentity;

    await assert.rejects(
      updateWorkspace(root, {
        workspaceRoot: root,
        installationOptions: {
          afterMigrationApply: async ({ workspaceConfigSnapshot }) => {
            handedOffSnapshot = workspaceConfigSnapshot;
            await rename(configPath, displacedConfig);
            await writeFile(configPath, workspaceConfigSnapshot.source, "utf8");
            winnerIdentity = await lstat(configPath);
          },
        },
      }),
      (error) => error?.code === "CONCURRENT_CHANGE",
    );

    assert.equal(handedOffSnapshot.source, configSource);
    assert.notEqual(String(winnerIdentity.ino), handedOffSnapshot.identity.ino);
    assert.equal(await readFile(configPath, "utf8"), configSource);
    assert.equal(await readFile(displacedConfig, "utf8"), configSource);
    assert.equal(await readFile(lockPath, "utf8"), lockSource);
    assert.equal(await hashFile(workflowPath), workflowHash);
    assert.equal(await hashDirectory(skillsPath), skillsHash);
    assert.equal(
      (await readdir(join(root, ".sdd", "changes")))
        .filter((entry) => entry.startsWith(".sdd-update-")).length,
      0,
    );
  });

  await t.test("workspace update rolls back installation when config identity changes after lock publication", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const configPath = join(root, ".sdd", "config.yaml");
    const displacedConfig = join(root, "published-config.yaml");
    const lockPath = join(root, ".sdd", "install-lock.json");
    const originalLock = "{\"managedSkills\":{},\"owner\":\"original\"}\n";
    let winnerSource;
    let publishedIdentity;
    let winnerIdentity;
    await writeFile(lockPath, originalLock, "utf8");

    await assert.rejects(
      updateWorkspace(root, {
        workspaceRoot: root,
        installationOptions: {
          afterLockPublish: async () => {
            winnerSource = await readFile(configPath, "utf8");
            publishedIdentity = await lstat(configPath);
            await rename(configPath, displacedConfig);
            await writeFile(configPath, winnerSource, "utf8");
            winnerIdentity = await lstat(configPath);
          },
        },
      }),
      (error) => error?.code === "MUTATION_RECOVERY_FAILED",
    );

    assert.notEqual(winnerIdentity.ino, publishedIdentity.ino);
    assert.equal(await readFile(configPath, "utf8"), winnerSource);
    assert.equal(await readFile(displacedConfig, "utf8"), winnerSource);
    assert.equal(await readFile(lockPath, "utf8"), originalLock);
    assert.equal(await pathExists(join(root, ".sdd", "story-driven-development.md")), false);
    assert.equal(await pathExists(join(root, ".agents", "skills", "sdd-change")), false);
    assert.deepEqual(
      (await readdir(join(root, ".sdd")))
        .filter((entry) => entry.startsWith(".install-lock.json.sdd-write-backup-")),
      [],
    );
    assert.equal(
      (await readdir(join(root, ".sdd", "changes")))
        .filter((entry) => entry.startsWith(".sdd-update-")).length,
      1,
    );
  });

  await t.test("destination deletion prevents legacy source removal", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-14-destination-race";
    const changePath = join(root, "code", "app", "docs", "changes", id);
    await writeChange(changePath, "in_progress");
    const destination = getActiveChangePath(id, root);
    const plan = await planUpdateMigration(root, await readWorkspaceConfig(root), { destinationWorkspaceRoot: root });
    await assert.rejects(
      applyUpdateMigration(plan, {
        beforeSourceRemoval: () => rm(destination, { recursive: true, force: true }),
      }),
      (error) => error.code === "CONCURRENT_CHANGE",
    );
    assert.equal(await pathExists(changePath), true);
    assert.equal(await pathExists(destination), false);
    assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v2");
  });

  await t.test("destination truncation after commit retains recovery state without restoring source", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-14-finalize-destination-race";
    const changePath = join(root, "code", "app", "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    await writeChange(changePath, "in_progress", "source must survive\n");
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );
    const tamperedTasks = tasks("in_review", "truncated after commit verification\n");
    let cleanupStarted = false;
    const transaction = await applyUpdateMigration(plan, {
      beforeSourceBackupDelete: async () => {
        cleanupStarted = true;
        await writeFile(join(destination, "tasks.md"), tamperedTasks, "utf8");
      },
    });
    assert.equal(await pathExists(changePath), false);
    await assert.rejects(
      finalizeMigrationTransaction(transaction),
      (error) => error.code === "MUTATION_RECOVERY_FAILED"
        && error.details.some((detail) => detail.includes("Central Change destination changed")),
    );
    assert.equal(cleanupStarted, true);

    assert.equal(await pathExists(changePath), false);
    assert.equal(await readFile(join(destination, "tasks.md"), "utf8"), tamperedTasks);
    const stagingEntries = (await readdir(join(root, ".sdd", "changes")))
      .filter((entry) => entry.startsWith(".sdd-update-"));
    assert.equal(stagingEntries.length, 1);
  });

  await t.test("destination deletion after commit retains recovery state without restoring source", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-14-finalize-destination-deletion";
    const changePath = join(root, "code", "app", "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    await writeChange(changePath, "in_progress", "deleted destination fallback\n");
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );
    const transaction = await applyUpdateMigration(plan);
    assert.equal(await pathExists(changePath), false);
    await transaction.assertCommitReady();
    await transaction.commit();

    await rm(destination, { recursive: true, force: true });
    await assert.rejects(
      transaction.finalizeCleanup(),
      (error) => error.code === "MUTATION_RECOVERY_FAILED"
        && error.details.some((detail) => detail.includes("Central Change destination changed")),
    );

    assert.equal(await pathExists(changePath), false);
    assert.equal(await pathExists(destination), false);
    const stagingEntries = (await readdir(join(root, ".sdd", "changes")))
      .filter((entry) => entry.startsWith(".sdd-update-"));
    assert.equal(stagingEntries.length, 1);
    const journal = JSON.parse(await readFile(
      join(root, ".sdd", "changes", stagingEntries[0], "transaction.json"),
      "utf8",
    ));
    assert.equal(journal.status, "committed");
  });

  await t.test("partial Change publication is removed and can be retried", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-15-partial-change";
    const changePath = join(root, "code", "app", "docs", "changes", id);
    await writeChange(changePath, "in_progress");
    const destination = getActiveChangePath(id, root);
    const plan = await planUpdateMigration(root, await readWorkspaceConfig(root), { destinationWorkspaceRoot: root });
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
    const retry = await planUpdateMigration(root, await readWorkspaceConfig(root), { destinationWorkspaceRoot: root });
    assert.equal(retry.changes.some((change) => change.changeId === id), true);
  });


  await t.test("a swapped Change reservation with a recreated marker is never populated", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-15-reservation-swap";
    const source = join(root, "code", "app", "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    const ownedAside = `${destination}.owned`;
    await writeChange(source, "in_progress", "reservation swap\n");
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );

    await assert.rejects(
      applyUpdateMigration(plan, {
        beforeChangeEntryPublish: async ({ target, record, index }) => {
          if (index !== 0) return;
          await rename(target, ownedAside);
          await mkdir(target);
          await link(
            record.proofPath,
            join(target, `.sdd-migration-owner-${record.ownerToken}`),
          );
          await writeFile(join(target, "opaque.txt"), "opaque reservation\n", "utf8");
        },
      }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(join(destination, "opaque.txt"), "utf8"), "opaque reservation\n");
    assert.equal(await pathExists(join(destination, "proposal.md")), false);
    assert.equal(await pathExists(source), true);
    assert.equal(await pathExists(ownedAside), true);
  });

  await t.test("a swapped nested destination directory is never populated", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-15-nested-reservation-swap";
    const source = join(root, "code", "app", "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    await writeChange(source, "in_progress", "nested reservation swap\n");
    await mkdir(join(source, "nested"));
    await writeFile(join(source, "nested", "a.txt"), "a\n", "utf8");
    await writeFile(join(source, "nested", "b.txt"), "b\n", "utf8");
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );
    let swapped = false;
    let ownedAside;

    await assert.rejects(
      applyUpdateMigration(plan, {
        beforeChangeTransferMutation: async ({ target }) => {
          if (swapped || basename(target) !== "b.txt") return;
          swapped = true;
          const nestedTarget = dirname(target);
          ownedAside = `${nestedTarget}.owned`;
          await rename(nestedTarget, ownedAside);
          await mkdir(nestedTarget);
          await writeFile(join(nestedTarget, "opaque.txt"), "opaque nested directory\n", "utf8");
        },
      }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(
      await readFile(join(destination, "nested", "opaque.txt"), "utf8"),
      "opaque nested directory\n",
    );
    assert.equal(await pathExists(join(destination, "nested", "b.txt")), false);
    assert.equal(await pathExists(ownedAside), true);
    assert.equal(await pathExists(source), true);
  });
  await t.test("concurrent brief destination is preserved", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const plannedRoot = join(root, "ideas", "sample", "planned-changes");
    const source = join(plannedRoot, "concurrent-brief.md");
    const destination = join(root, "ideas", "sample", "change-briefs", "concurrent-brief.md");
    await mkdir(plannedRoot, { recursive: true });
    await writeFile(source, "legacy\n", "utf8");
    const plan = await planUpdateMigration(root, await readWorkspaceConfig(root), { destinationWorkspaceRoot: root });
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

  await t.test("a Change Brief replacement after rollback verification is preserved", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const plannedRoot = join(root, "ideas", "sample", "planned-changes");
    const source = join(plannedRoot, "rollback-brief.md");
    const destination = join(root, "ideas", "sample", "change-briefs", "rollback-brief.md");
    const ownedAside = `${destination}.owned`;
    await mkdir(plannedRoot, { recursive: true });
    await writeFile(source, "legacy brief\n", "utf8");
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );

    await assert.rejects(
      applyUpdateMigration(plan, {
        beforeSourceRemoval: () => {
          throw new Error("trigger brief rollback");
        },
        afterBriefRollbackVerification: async () => {
          await rename(destination, ownedAside);
          await writeFile(destination, "opaque replacement\n", "utf8");
        },
      }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(destination, "utf8"), "opaque replacement\n");
    assert.equal(await readFile(ownedAside, "utf8"), "legacy brief\n");
    assert.equal(await readFile(source, "utf8"), "legacy brief\n");
  });
});

test("interrupted migration recovers durably before replanning", async (t) => {
  await t.test("ledger-owned partial Change publication rolls back and reruns", async (t) => {
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
    const interrupted = await mutateInterruptedJournal(root, () => {});
    const published = interrupted.journal.changes.find(
      (record) => record.destination === destination,
    );
    assert.equal(published.copyRoot, destination);
    assert.equal(
      published.copyTargetManifest.some((entry) => entry.type === "file"),
      true,
    );

    const recovery = await recoverUpdateMigration(root, { destinationWorkspaceRoot: root });
    assert.deepEqual(recovery, { recovered: 1 });
    assert.equal(await pathExists(join(changePath, "proposal.md")), true);
    assert.equal(await pathExists(destination), false);

    const recovered = await updateFixture(root);
    assert.equal(recovered.migration.required, true);
    assert.equal(await pathExists(changePath), false);
    assert.equal(await pathExists(destination), true);
    assert.match(await readFile(join(destination, "proposal.md"), "utf8"), /directory restart/);

    const settled = await updateFixture(root);
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

    await updateFixture(root);
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

    assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v3");
    assert.equal((await readRepositoryConfig(repositoryRoot)).schema, "sdd-repository-v1");
    assert.equal(await pathExists(destination), true);
    assert.equal(await pathExists(changePath), true);

    await updateFixture(root);
    assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v3");
    assert.equal((await readRepositoryConfig(repositoryRoot)).schema, "sdd-repository-v2");
    assert.equal(await pathExists(changePath), false);
    assert.match(await readFile(join(destination, "proposal.md"), "utf8"), /config restart/);
  });

  await t.test("current workspace-v3 configuration authorizes committed recovery", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-17-current-config-authority";
    const changePath = join(root, "code", "app", "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    await writeChange(changePath, "in_progress", "current config authority\n");

    await interruptUpdate(root, `{
      beforeSourceRemoval: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);

    let stagedLegacyCandidates;
    let sourceRecords;
    let stagingRoot;
    await mutateInterruptedJournal(root, (journal) => {
      const workspaceConfigPath = join(root, ".sdd", "config.yaml");
      const workspaceConfig = journal.configs.find(
        (record) => record.path === workspaceConfigPath,
      );
      assert.ok(workspaceConfig);
      stagedLegacyCandidates = [workspaceConfig.originalPath, workspaceConfig.nextPath];
      sourceRecords = journal.sources.map((record) => ({ ...record }));
      stagingRoot = journal.stagingRoot;
    });
    await moveInterruptedSourcesToBackups(sourceRecords);
    await mutateInterruptedJournal(root, (journal) => {
      journal.status = "committed";
      journal.sources.forEach((record, index) => {
        record.backupIdentity = sourceRecords[index].backupIdentity;
        record.backupMode = sourceRecords[index].backupMode;
        record.backupPayloadIdentity = sourceRecords[index].backupPayloadIdentity;
        record.phase = "removed";
      });
    });
    await Promise.all(stagedLegacyCandidates.map(
      (path) => writeFile(path, "version: invalid\nschema: invalid\n", "utf8"),
    ));

    assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v3");
    const recovered = await updateFixture(root);
    assert.equal(recovered.migration.required, false);
    assert.equal(await pathExists(destination), true);
    assert.equal(await pathExists(stagingRoot), false);
    for (const record of sourceRecords) {
      assert.equal(await pathExists(record.backup), false);
    }
  });

  await t.test("invalid recovery authority candidates retain durable recovery state", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-17-invalid-config-authority";
    const changePath = join(root, "code", "app", "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    await writeChange(changePath, "in_progress", "invalid config authority\n");

    await interruptUpdate(root, `{
      beforeSourceRemoval: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);

    let authorityCandidates;
    let sourcePaths;
    let stagingRoot;
    await mutateInterruptedJournal(root, (journal) => {
      const workspaceConfigPath = join(root, ".sdd", "config.yaml");
      const workspaceConfig = journal.configs.find(
        (record) => record.path === workspaceConfigPath,
      );
      assert.ok(workspaceConfig);
      authorityCandidates = [
        workspaceConfigPath,
        workspaceConfig.originalPath,
        workspaceConfig.nextPath,
      ];
      sourcePaths = journal.sources.map((record) => record.physicalPath);
      stagingRoot = journal.stagingRoot;
    });
    await Promise.all(authorityCandidates.map(
      (path) => writeFile(path, "version: 3\nschema: sdd-v3\nideas: {}\n", "utf8"),
    ));

    await assert.rejects(
      updateFixture(root),
      (error) => (
        error.code === "MUTATION_RECOVERY_FAILED"
        && error.details.some((detail) =>
          detail.includes("Cannot establish workspace topology authority"))
      ),
    );
    assert.equal(await pathExists(destination), true);
    assert.equal(await pathExists(stagingRoot), true);
    for (const path of sourcePaths) {
      assert.equal(await pathExists(path), true);
    }
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
    await updateFixture(root);
    assert.equal((await readRepositoryConfig(repositoryRoot)).schema, "sdd-repository-v2");
    assert.equal(await pathExists(changePath), false);
  });

  await t.test("missing workspace configuration recovers from a mapped repository descendant only", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-17-user-config-backup-restart";
    const repositoryRoot = join(root, "code", "app");
    const repositoryDescendant = join(repositoryRoot, "src", "feature");
    const unmappedDescendant = join(root, "unmapped");
    const externalPath = await mkdtemp(join(tmpdir(), "sdd-unmapped-update-"));
    t.after(() => rm(externalPath, { recursive: true, force: true }));
    const changePath = join(repositoryRoot, "docs", "changes", id);
    await mkdir(repositoryDescendant, { recursive: true });
    await mkdir(unmappedDescendant, { recursive: true });
    await writeChange(changePath, "in_progress", "user config backup restart\n");

    await interruptUpdate(root, `{
      afterConfigBackup: ({ index }) => {
        if (index === 0) process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
      },
    }`);
    const stagingEntries = (await readdir(join(root, ".sdd", "changes")))
      .filter((entry) => entry.startsWith(".sdd-update-"));
    assert.equal(stagingEntries.length, 1);
    const journalPath = join(
      root,
      ".sdd",
      "changes",
      stagingEntries[0],
      "transaction.json",
    );
    const journalBeforeUnmappedAttempts = await readFile(journalPath, "utf8");

    assert.equal(await pathExists(join(root, ".sdd", "config.yaml")), false);
    await assert.rejects(
      updateWorkspace(unmappedDescendant),
      (error) => error.code === "WORKSPACE_NOT_FOUND"
        && error.message.includes(unmappedDescendant),
    );
    await assert.rejects(
      updateWorkspace(externalPath),
      (error) => error.code === "WORKSPACE_NOT_FOUND"
        && error.message.includes(externalPath),
    );
    assert.equal(await pathExists(join(root, ".sdd", "config.yaml")), false);
    assert.equal(await readFile(journalPath, "utf8"), journalBeforeUnmappedAttempts);

    const result = await updateWorkspace(repositoryDescendant);
    assert.equal(result.workspaceRoot, root);
    assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v3");
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
    await updateFixture(root);
    assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v3");
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
    await updateFixture(root);
    assert.equal((await readRepositoryConfig(repositoryRoot)).schema, "sdd-repository-v2");
  });

  await t.test("pending source state restores a sole interrupted backup before discarding the journal", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-17-pending-source-backup";
    const sourcePath = join(root, "code", "app", "docs", "changes");
    await writeChange(join(sourcePath, id), "in_progress", "pending source backup\n");

    await interruptUpdate(root, `{
      afterSourceBackupReservation: async ({ root: source, reservation }) => {
        const { rename } = await import("node:fs/promises");
        const { randomUUID } = await import("node:crypto");
        const { join } = await import("node:path");
        await rename(source.physicalPath, join(reservation, randomUUID()));
        process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
      },
    }`);

    let sourceRecord;
    let stagingRoot;
    await mutateInterruptedJournal(root, (journal) => {
      assert.equal(journal.sources.length, 1);
      assert.equal(journal.sources[0].phase, "removing");
      journal.sources[0].phase = "pending";
      sourceRecord = { ...journal.sources[0] };
      stagingRoot = journal.stagingRoot;
    });
    assert.equal(await pathExists(sourceRecord.physicalPath), false);
    assert.equal(await pathExists(sourceRecord.backup), true);

    const recovered = await recoverUpdateMigration(root, { destinationWorkspaceRoot: root });
    assert.deepEqual(recovered, { recovered: 1 });
    assert.equal(await hashDirectory(sourceRecord.physicalPath), sourceRecord.hash);
    assert.equal(await pathExists(sourceRecord.backup), false);
    assert.equal(await pathExists(stagingRoot), false);
    assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v2");
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
      updateFixture(root),
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
      updateFixture(root),
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
      updateFixture(root),
      (error) => (
        error.code === "MUTATION_RECOVERY_FAILED"
        && error.details.some((detail) => detail.includes("Central Change destination changed"))
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

    await writeFile(join(destination, "foreign.txt"), "unrelated\n", "utf8");

    await assert.rejects(
      updateFixture(root),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(join(destination, "foreign.txt"), "utf8"), "unrelated\n");
    assert.equal(await pathExists(changePath), true);
  });

  await t.test("a replaced published child directory is retained across crash recovery", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-18-child-replacement";
    const changePath = join(root, "code", "app", "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    const publishedChild = join(destination, "evidence");
    const retainedChild = join(destination, "evidence-owned");
    await writeChange(changePath, "in_progress", "child replacement\n");
    await mkdir(join(changePath, "evidence"));
    await writeFile(join(changePath, "evidence", "proof.txt"), "owned proof\n", "utf8");

    await interruptUpdate(root, `{
      beforeChangeEntryPublish: ({ index }) => {
        if (index === 2) process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
      },
    }`);
    await rename(publishedChild, retainedChild);
    await mkdir(publishedChild);
    await writeFile(join(publishedChild, "opaque.txt"), "concurrent child\n", "utf8");

    await assert.rejects(
      updateFixture(root),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(
      await readFile(join(publishedChild, "opaque.txt"), "utf8"),
      "concurrent child\n",
    );
    assert.equal(
      await readFile(join(retainedChild, "proof.txt"), "utf8"),
      "owned proof\n",
    );
    assert.equal(await pathExists(changePath), true);
  });

  await t.test("source-derived rollback target rejects a coherent hard-linked retarget", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const sourceId = "2026-08-18-forged-owner-source";
    const source = join(root, "code", "app", "docs", "changes", sourceId);
    const sourceDestination = getActiveChangePath(sourceId, root);
    const victim = getClosedChangePath(sourceId, root);
    await writeChange(source, "in_progress", "identical ownership bytes\n");
    const planned = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );
    const plannedChange = planned.changes.find((change) => change.changeId === sourceId);
    assert.ok(plannedChange);
    await writeChange(victim, "in_progress", "identical ownership bytes\n");
    await writeFile(join(victim, "tasks.md"), plannedChange.canonicalTasksSource, "utf8");
    const victimHash = await hashDirectory(victim);
    assert.equal(victimHash, plannedChange.canonicalHash);

    await interruptUpdate(root, `{
      beforeConfigWrite: ({ index }) => {
        if (index === 0) process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
      },
    }`);
    const victimState = await lstat(victim);
    let guardIndex;
    const transaction = await mutateInterruptedJournal(root, (journal) => {
      const record = journal.changes.find(
        (change) => change.destination === sourceDestination,
      );
      assert.ok(record);
      guardIndex = journal.destinationGuards.findIndex(
        (candidate) => candidate.destination === record.destination,
      );
      assert.notEqual(guardIndex, -1);
      record.destination = victim;
      record.reservationIdentity = {
        dev: String(victimState.dev),
        ino: String(victimState.ino),
      };
      record.reserved = true;
      record.published = true;
      record.phase = "verified";
      journal.destinationGuards[guardIndex].destination = victim;
      journal.destinationGuards[guardIndex].existing = false;
    });
    await mutateInterruptedDestinationManifest(root, (manifest) => {
      manifest.destinationGuards[guardIndex].destination = victim;
      manifest.destinationGuards[guardIndex].existing = false;
    });
    const guardProof = join(transaction.stagingRoot, `.destination-${guardIndex}-guard`);
    await rm(guardProof);
    await link(join(victim, "tasks.md"), guardProof);

    await assert.rejects(
      updateFixture(root),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await hashDirectory(victim), victimHash);
    assert.match(await readFile(join(victim, "proposal.md"), "utf8"), /identical ownership bytes/);
    assert.equal(await pathExists(sourceDestination), true);
    assert.equal(await pathExists(source), true);
  });

  await t.test("external digest fails before the next coherent provenance gate", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-18-existing-guard-witness";
    const source = join(root, "code", "app", "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    await writeChange(source, "in_progress", "existing guard witness\n");
    const planned = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );
    const plannedChange = planned.changes.find((change) => change.changeId === id);
    assert.ok(plannedChange);
    await writeChange(destination, "in_progress", "existing guard witness\n");
    await writeFile(join(destination, "tasks.md"), plannedChange.canonicalTasksSource, "utf8");
    const destinationHash = await hashDirectory(destination);
    assert.equal(destinationHash, plannedChange.canonicalHash);

    await interruptUpdate(root, `{
      beforeSourceBackupDelete: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`, { finalize: true });
    const changesRoot = join(root, ".sdd", "changes");
    const [stagingName] = (await readdir(changesRoot))
      .filter((entry) => entry.startsWith(".sdd-update-"));
    const stagingRoot = join(changesRoot, stagingName);
    const digestPath = join(root, ".sdd", `${stagingName}-destinations.digest`);
    const manifestPath = join(stagingRoot, "destinations.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const guardIndex = manifest.destinationGuards.findIndex(
      (guard) => guard.destination === destination,
    );
    assert.notEqual(guardIndex, -1);
    manifest.destinationGuards.splice(guardIndex, 1);
    await mutateInterruptedJournal(root, (journal) => {
      journal.destinationGuards = journal.destinationGuards.filter(
        (guard) => guard.destination !== destination,
      );
      journal.changes = journal.changes.filter(
        (change) => change.destination !== destination,
      );
    });
    await chmod(manifestPath, 0o600);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await chmod(manifestPath, 0o400);
    await rm(join(stagingRoot, `.destination-${guardIndex}-guard`));
    await rm(destination, { recursive: true, force: true });

    await assert.rejects(
      updateFixture(root),
      (error) => error.code === "MUTATION_RECOVERY_FAILED"
        && error.details.some((detail) =>
          detail.includes("Destination manifest bytes do not match its digest witness.")),
    );
    await chmod(digestPath, 0o600);
    await writeFile(digestPath, `${await hashFile(manifestPath)}\n`, "utf8");
    await chmod(digestPath, 0o400);
    await assert.rejects(
      updateFixture(root),
      (error) => error.code === "MUTATION_RECOVERY_FAILED"
        && error.details.some((detail) =>
          detail.includes("Source-derived manifest does not match the journal destination records.")),
    );
    assert.equal(await pathExists(source), false);
    assert.equal(await pathExists(destination), false);
  });

  await t.test("pending configuration proof rejects a same-byte inode swap after crash", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-18-pending-config-identity";
    const changePath = join(root, "code", "app", "docs", "changes", id);
    const configPath = join(root, ".sdd", "config.yaml");
    const originalAside = join(root, ".sdd", "config-original.yaml");
    await writeChange(changePath, "in_progress", "pending config identity\n");
    const originalSource = await readFile(configPath, "utf8");

    await interruptUpdate(root, `{
      beforeTransactionJournalReplace: (() => {
        let calls = 0;
        return async ({ temporaryPath, proofPath }) => {
          calls += 1;
          if (calls !== 2) return;
          const { rm } = await import("node:fs/promises");
          await rm(proofPath, { force: true });
          await rm(temporaryPath, { force: true });
          process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
        };
      })(),
    }`);
    await rename(configPath, originalAside);
    await writeFile(configPath, originalSource, "utf8");
    const [stagingName] = (await readdir(join(root, ".sdd", "changes")))
      .filter((entry) => entry.startsWith(".sdd-update-"));
    assert.ok(stagingName);

    await assert.rejects(
      updateFixture(root),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(configPath, "utf8"), originalSource);
    assert.equal(await pathExists(originalAside), true);
    assert.equal(await pathExists(changePath), true);
    assert.equal(await pathExists(join(root, ".sdd", "changes", stagingName)), true);
  });

  await t.test("tampered staged original and journal hashes cannot replace live configuration", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const source = join(
      root,
      "code",
      "app",
      "docs",
      "changes",
      "2026-08-18-staged-config-provenance",
    );
    await writeChange(source, "in_progress", "staged config provenance\n");
    const configPath = join(root, ".sdd", "config.yaml");

    await interruptUpdate(root, `{
      beforeConfigWrite: ({ index }) => {
        if (index === 1) process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
      },
    }`);
    const liveSource = await readFile(configPath, "utf8");
    const liveHash = await hashFile(configPath);
    let originalPath;
    await mutateInterruptedJournal(root, (journal) => {
      const record = journal.configs.find((config) => config.path === configPath);
      assert.ok(record);
      originalPath = record.originalPath;
    });
    const attackerSource = "attacker-controlled rollback bytes\n";
    await writeFile(originalPath, attackerSource, "utf8");
    const attackerHash = await hashFile(originalPath);
    await mutateInterruptedJournal(root, (journal) => {
      const record = journal.configs.find((config) => config.path === configPath);
      record.originalHash = attackerHash;
      record.nextHash = liveHash;
    });

    await assert.rejects(
      updateFixture(root),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(configPath, "utf8"), liveSource);
    assert.equal(await readFile(originalPath, "utf8"), attackerSource);
  });

  await t.test("configuration proof cleanup preserves a pre-existing deterministic decoy", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    await writeChange(
      join(root, "code", "app", "docs", "changes", "2026-08-18-config-cleanup-decoy"),
      "in_progress",
    );
    await interruptUpdate(root, `{
      beforeSourceRemoval: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);
    const changesRoot = join(root, ".sdd", "changes");
    const [stagingName] = (await readdir(changesRoot))
      .filter((entry) => entry.startsWith(".sdd-update-"));
    let configRecord;
    let configIndex;
    await mutateInterruptedJournal(root, (journal) => {
      configIndex = journal.configs.findIndex((record) => record.path === join(root, ".sdd", "config.yaml"));
      configRecord = journal.configs[configIndex];
    });
    assert.notEqual(configIndex, -1);
    const proofPath = join(
      dirname(configRecord.path),
      `.${basename(configRecord.path)}${stagingName}-config-${configIndex}-original`,
    );
    const deterministicDecoy = `${proofPath}-cleanup`;
    await writeFile(deterministicDecoy, "opaque concurrent state\n", "utf8");

    await updateFixture(root);

    assert.equal(await readFile(deterministicDecoy, "utf8"), "opaque concurrent state\n");
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
      updateFixture(root),
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
      updateFixture(root),
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
      updateFixture(root),
      (error) => error.code === "CHANGE_BRIEF_COLLISION",
    );
    assert.equal(await readFile(source, "utf8"), "identical\n");
    assert.equal(await readFile(destination, "utf8"), "identical\n");
    assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v2");
  });

  await t.test("incomplete multi-source restoration preserves every complete destination", async (t) => {
    const root = await createFixture({ repositories: ["app", "worker"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const ids = {
      app: "2026-08-18-app-last-copy",
      worker: "2026-08-18-worker-last-copy",
    };
    for (const [repository, id] of Object.entries(ids)) {
      await writeChange(
        join(root, "code", repository, "docs", "changes", id),
        "in_progress",
        `${repository} last copy\n`,
      );
    }
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );
    assert.equal(plan.sourceRoots.length, 2);
    const [restoredRoot, unavailableRoot] = plan.sourceRoots;
    const idForRoot = (sourceRoot) => (
      sourceRoot.ownerRoot === join(root, "code", "app") ? ids.app : ids.worker
    );
    const restoredId = idForRoot(restoredRoot);
    const unavailableId = idForRoot(unavailableRoot);
    const restoredDestination = getActiveChangePath(restoredId, root);
    const unavailableDestination = getActiveChangePath(unavailableId, root);
    const restoredDestinationHash = plan.changes.find(
      (change) => change.changeId === restoredId,
    ).canonicalHash;
    const unavailableDestinationHash = plan.changes.find(
      (change) => change.changeId === unavailableId,
    ).canonicalHash;

    await assert.rejects(
      applyUpdateMigration(plan, {
        afterSourceBackupReservation: async ({ root: sourceRoot }) => {
          if (sourceRoot.path !== unavailableRoot.path) return;
          await rm(sourceRoot.physicalPath, { recursive: true });
          throw new Error("injected source loss after the other source was backed up");
        },
      }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await hashDirectory(restoredRoot.physicalPath), restoredRoot.hash);
    assert.equal(await pathExists(unavailableRoot.physicalPath), false);
    assert.equal(await hashDirectory(restoredDestination), restoredDestinationHash);
    assert.equal(await hashDirectory(unavailableDestination), unavailableDestinationHash);
    const stagingEntries = (await readdir(join(root, ".sdd", "changes")))
      .filter((entry) => entry.startsWith(".sdd-update-"));
    assert.equal(stagingEntries.length, 1);
    const pendingJournal = JSON.parse(await readFile(
      join(root, ".sdd", "changes", stagingEntries[0], "transaction.json"),
      "utf8",
    ));
    for (const record of pendingJournal.sources) {
      assert.equal(await pathExists(record.backup), true);
    }
    assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v2");
  });

  await t.test("committed guard metadata comes from authenticated legacy tasks and topology", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-18-source-owned-metadata";
    const source = join(root, "code", "app", "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    await writeChange(source, "in_progress", "source-owned metadata\n");
    await interruptUpdate(root, `{
      beforeSourceBackupDelete: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`, { finalize: true });

    const destinationTasks = await readFile(join(destination, "tasks.md"), "utf8");
    const forgedTasks = setChangeMetadata(destinationTasks, {
      space: "forged-space",
      repositories: ["app"],
    });
    assert.ok(forgedTasks);
    await writeFile(join(destination, "tasks.md"), forgedTasks, "utf8");
    const forgedHash = await hashDirectory(destination);
    let guardIndex;
    const transaction = await mutateInterruptedJournal(root, (journal) => {
      guardIndex = journal.destinationGuards.findIndex(
        (guard) => guard.destination === destination,
      );
      assert.notEqual(guardIndex, -1);
      journal.destinationGuards[guardIndex].canonicalHash = forgedHash;
      const change = journal.changes.find((record) => record.destination === destination);
      assert.ok(change);
      change.canonicalHash = forgedHash;
    });
    await mutateInterruptedDestinationManifest(root, (manifest) => {
      manifest.destinationGuards[guardIndex].canonicalHash = forgedHash;
    });

    await assert.rejects(
      updateFixture(root),
      (error) => error.code === "MUTATION_RECOVERY_FAILED"
        && error.details.some((detail) => detail.includes("source-derived destination guard")),
    );
    assert.equal(await pathExists(source), false);
    assert.equal(await readFile(join(destination, "tasks.md"), "utf8"), forgedTasks);
    assert.equal(await pathExists(transaction.stagingRoot), true);
  });

  await t.test("committed Change Brief journals biject to authenticated source files", async (t) => {
    async function createCommittedBriefFixture(childT, suffix) {
      const root = await createFixture({ repositories: ["app"] });
      childT.after(() => rm(root, { recursive: true, force: true }));
      const plannedRoot = join(root, "ideas", "sample", "planned-changes");
      const ownerRoot = dirname(plannedRoot);
      const name = `${suffix}.md`;
      const source = join(plannedRoot, name);
      const destination = join(ownerRoot, "change-briefs", name);
      await mkdir(plannedRoot, { recursive: true });
      await writeFile(source, `${suffix} source\n`, "utf8");
      await interruptUpdate(root, `{
        beforeSourceBackupDelete: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
      }`, { finalize: true });
      const transaction = await mutateInterruptedJournal(root, () => {});
      assert.equal(transaction.journal.status, "committed");
      assert.equal(transaction.journal.briefs.length, 1);
      return { root, ownerRoot, source, destination, transaction };
    }

    async function assertBriefRecoveryFailsClosed(fixture) {
      await assert.rejects(
        updateFixture(fixture.root),
        (error) => error.code === "MUTATION_RECOVERY_FAILED",
      );
      assert.equal(await pathExists(fixture.source), false);
      assert.equal(await pathExists(fixture.destination), true);
      assert.equal(await pathExists(fixture.transaction.stagingRoot), true);
      for (const record of fixture.transaction.journal.sources) {
        assert.equal(await pathExists(record.backup), true);
      }
    }

    await t.test("a Markdown brief with a Change-ID stem remains source-authenticated", async (t) => {
      const fixture = await createCommittedBriefFixture(t, "2026-08-18-valid-brief-source");
      await updateFixture(fixture.root);
      assert.equal(await pathExists(fixture.source), false);
      assert.equal(await pathExists(fixture.destination), true);
      assert.equal(await pathExists(fixture.transaction.stagingRoot), false);
    });

    await t.test("altered record", async (t) => {
      const fixture = await createCommittedBriefFixture(t, "altered-brief");
      const victim = join(fixture.ownerRoot, "change-briefs", "altered-victim.md");
      await writeFile(victim, "altered victim\n", "utf8");
      const victimHash = await hashFile(victim);
      const victimState = await lstat(victim);
      const victimIdentity = { dev: String(victimState.dev), ino: String(victimState.ino) };
      await mutateInterruptedJournal(fixture.root, (journal) => {
        journal.briefs[0].destination = victim;
        journal.briefs[0].hash = victimHash;
        journal.briefs[0].stagedIdentity = victimIdentity;
        journal.briefs[0].publishedIdentity = victimIdentity;
      });
      await rm(fixture.transaction.journal.briefs[0].stagedPath);
      await link(victim, fixture.transaction.journal.briefs[0].stagedPath);
      await assertBriefRecoveryFailsClosed(fixture);
      assert.equal(await readFile(victim, "utf8"), "altered victim\n");
    });

    await t.test("journal and manifest cannot retarget a byte-identical brief", async (t) => {
      const fixture = await createCommittedBriefFixture(t, "coherent-brief-retarget");
      const victim = join(fixture.ownerRoot, "change-briefs", "coherent-victim.md");
      const sourceBytes = await readFile(fixture.destination);
      await writeFile(victim, sourceBytes);
      const victimState = await lstat(victim);
      const victimIdentity = { dev: String(victimState.dev), ino: String(victimState.ino) };
      const forgedManifest = await mutateInterruptedSourceDerivedManifest(
        fixture.root,
        (manifest) => {
          manifest.briefs[0].destination = victim;
        },
      );
      await mutateInterruptedJournal(fixture.root, (journal) => {
        journal.briefs[0].destination = victim;
        journal.briefs[0].stagedIdentity = victimIdentity;
        journal.briefs[0].publishedIdentity = victimIdentity;
        journal.sourceDerivedDestinationGuards = forgedManifest.snapshot;
      });
      await rm(fixture.transaction.journal.briefs[0].stagedPath);
      await link(victim, fixture.transaction.journal.briefs[0].stagedPath);

      await assertBriefRecoveryFailsClosed(fixture);
      assert.deepEqual(await readFile(victim), sourceBytes);
      assert.deepEqual(await readFile(fixture.destination), sourceBytes);
    });

    await t.test("appended record", async (t) => {
      const fixture = await createCommittedBriefFixture(t, "appended-brief");
      const victim = join(fixture.ownerRoot, "change-briefs", "appended-victim.md");
      const stagedPath = join(fixture.transaction.stagingRoot, ".brief-1");
      await writeFile(victim, "appended victim\n", "utf8");
      await link(victim, stagedPath);
      const victimHash = await hashFile(victim);
      const ownerState = await lstat(fixture.ownerRoot);
      const victimState = await lstat(victim);
      const ownerAnchor = {
        logicalPath: fixture.ownerRoot,
        physicalPath: fixture.ownerRoot,
        dev: String(ownerState.dev),
        ino: String(ownerState.ino),
      };
      const victimIdentity = { dev: String(victimState.dev), ino: String(victimState.ino) };
      await mutateInterruptedJournal(fixture.root, (journal) => {
        journal.briefs.push({
          destination: victim,
          ownerRoot: fixture.ownerRoot,
          ownerAnchor,
          stagedPath,
          stagedIdentity: victimIdentity,
          stagingProofIdentity: victimIdentity,
          briefIntentIdentity: victimIdentity,
          stagingBindingIdentity: victimIdentity,
          publicationBindingIdentity: victimIdentity,
          publishedIdentity: victimIdentity,
          publicationProofIdentity: victimIdentity,
          publicationProofCleanupPath: null,
          publicationProofCleanupIdentity: null,
          publicationProofPhase: "present",
          hash: victimHash,
          published: true,
          phase: "verified",
        });
      });
      await assertBriefRecoveryFailsClosed(fixture);
      assert.equal(await readFile(victim, "utf8"), "appended victim\n");
    });

    await t.test("dropped record", async (t) => {
      const fixture = await createCommittedBriefFixture(t, "dropped-brief");
      await rm(fixture.transaction.journal.briefs[0].stagedPath);
      await mutateInterruptedJournal(fixture.root, (journal) => {
        journal.briefs = [];
      });
      await assertBriefRecoveryFailsClosed(fixture);
    });
  });

  await t.test("committed Brief proof retirement rejects a same-byte destination inode swap", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const plannedRoot = join(root, "ideas", "sample", "planned-changes");
    const source = join(plannedRoot, "retired-proof-identity.md");
    const destination = join(
      dirname(plannedRoot),
      "change-briefs",
      basename(source),
    );
    await mkdir(plannedRoot, { recursive: true });
    await writeFile(source, "retired Brief proof identity\n", "utf8");

    await interruptUpdate(root, `{
      afterTransactionDirectoryVerification: () => {
        process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
      },
    }`, { finalize: true });
    const pending = await readPendingTransaction(root);
    const brief = pending.journal.briefs.find(
      (record) => record.destination === destination,
    );
    assert.ok(brief);
    assert.equal(brief.publicationProofPhase, "removed");
    const bytes = await readFile(destination);
    const mode = (await lstat(destination)).mode & 0o777;
    const retained = `${destination}.transaction-owned`;
    await rename(destination, retained);
    await writeFile(destination, bytes, { mode });
    const replacementState = await lstat(destination);
    const replacementIdentity = {
      dev: String(replacementState.dev),
      ino: String(replacementState.ino),
    };
    assert.notDeepEqual(replacementIdentity, brief.publishedIdentity);

    await assert.rejects(
      recoverUpdateMigration(root, { destinationWorkspaceRoot: root }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    const retainedReplacementState = await lstat(destination);
    assert.deepEqual(
      {
        dev: String(retainedReplacementState.dev),
        ino: String(retainedReplacementState.ino),
      },
      replacementIdentity,
    );
    assert.deepEqual(await readFile(destination), bytes);
    assert.deepEqual(await readFile(retained), bytes);
    assert.equal(await pathExists(pending.stagingRoot), true);
  });

  await t.test("current workspace authority remap before source retirement fails closed", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-18-current-authority-remap";
    const source = join(root, "code", "app", "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    const configPath = join(root, ".sdd", "config.yaml");
    await writeChange(source, "in_progress", "current authority remap\n");
    const currentConfig = migrateWorkspaceConfig(
      await readWorkspaceConfig(root),
      root,
    ).config;
    await writeYaml(configPath, currentConfig);
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );
    assert.equal(plan.configWrites.some((write) => write.path === configPath), false);
    assert.equal(plan.readGuards.some((guard) => guard.path === configPath), true);
    const remappedConfig = structuredClone(currentConfig);
    remappedConfig.ideas.sample.repositories[0].path = "replacement";
    const displacedConfig = join(root, ".sdd", "config-before-remap.yaml");

    await assert.rejects(
      applyUpdateMigration(plan, {
        beforeSourceRename: async () => {
          await rename(configPath, displacedConfig);
          await writeYaml(configPath, remappedConfig);
        },
      }),
      (error) => error.code === "CONCURRENT_CHANGE",
    );
    assert.equal(await pathExists(source), true);
    assert.equal(await pathExists(destination), false);
    assert.equal(
      (await readWorkspaceConfig(root)).ideas.sample.repositories[0].path,
      "replacement",
    );
  });

  await t.test("current workspace authority substitution blocks committed cleanup recovery", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-18-current-authority-recovery";
    const source = join(root, "code", "app", "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    const configPath = join(root, ".sdd", "config.yaml");
    await writeChange(source, "in_progress", "current recovery authority\n");
    const currentConfig = migrateWorkspaceConfig(
      await readWorkspaceConfig(root),
      root,
    ).config;
    await writeYaml(configPath, currentConfig);
    await interruptUpdate(root, `{
      beforeSourceBackupDelete: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`, { finalize: true });
    const displacedConfig = join(root, ".sdd", "config-before-substitution.yaml");
    const remappedConfig = structuredClone(currentConfig);
    remappedConfig.ideas.sample.repositories[0].path = "replacement";
    await rename(configPath, displacedConfig);
    await writeYaml(configPath, remappedConfig);

    await assert.rejects(
      updateFixture(root),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await pathExists(source), false);
    assert.equal(await pathExists(destination), true);
    assert.equal(await pathExists(displacedConfig), true);
    const stagingEntries = (await readdir(join(root, ".sdd", "changes")))
      .filter((entry) => entry.startsWith(".sdd-update-"));
    assert.equal(stagingEntries.length, 1);
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
    const plan = await planUpdateMigration(root, await readWorkspaceConfig(root), { destinationWorkspaceRoot: root });

    await assert.rejects(
      applyUpdateMigration(plan, {
        afterConfigPublish: ({ index }) => {
          if (index === 0) throw new Error("injected post-publication cleanup failure");
        },
      }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );

    assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v2");
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
    const plan = await planUpdateMigration(root, await readWorkspaceConfig(root), { destinationWorkspaceRoot: root });

    await assert.rejects(
      applyUpdateMigration(plan, {
        afterConfigWrite: ({ index }) => {
          if (index === 0) throw new Error("injected post-publication verification failure");
        },
      }),
      /injected post-publication verification failure/,
    );

    assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v2");
    assert.equal((await readRepositoryConfig(repositoryRoot)).schema, "sdd-repository-v1");
    assert.equal(await pathExists(changePath), true);
    assert.equal(await pathExists(getActiveChangePath(id, root)), false);
  });
});

test("recovery journals and staged files remain identity-bound across restarts", async (t) => {
  await t.test("an interrupted journal candidate survives a second crash during evidence cleanup", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-21-double-journal-crash";
    const source = join(root, "code", "app", "docs", "changes", id);
    await writeChange(source, "in_progress", "double journal crash\n");

    await interruptUpdate(root, `{
      beforeTransactionJournalReplace: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);
    const [stagingName] = (await readdir(join(root, ".sdd", "changes")))
      .filter((entry) => entry.startsWith(".sdd-update-"));
    const stagingRoot = join(root, ".sdd", "changes", stagingName);
    assert.equal(await pathExists(join(stagingRoot, "transaction.json")), false);

    await interruptRecovery(root, `{
      afterTransactionJournalCleanupHandoff: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);
    assert.equal(await pathExists(stagingRoot), true);
    const journalCleanupRoot = join(
      stagingRoot,
      ".transaction.json.sdd-write-cleanup",
    );
    assert.equal(await pathExists(journalCleanupRoot), true);
    assert.equal(
      (await readdir(journalCleanupRoot))
        .includes(".transaction.json.sdd-write-temporary-cleanup"),
      true,
    );
    assert.equal(
      (await readdir(journalCleanupRoot))
        .some((entry) => entry.startsWith(".sdd-remove-")),
      true,
    );

    assert.deepEqual(
      await recoverUpdateMigration(root, { destinationWorkspaceRoot: root }),
      { recovered: 1 },
    );
    assert.equal(await pathExists(source), true);
    assert.equal(await pathExists(stagingRoot), false);
  });

  await t.test("a replaced staged Change Brief inode is retained and rejected", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const plannedRoot = join(root, "ideas", "sample", "planned-changes");
    const source = join(plannedRoot, "staged-brief.md");
    await mkdir(plannedRoot, { recursive: true });
    await writeFile(source, "staged brief identity\n", "utf8");

    await interruptUpdate(root, `{
      beforeBriefLink: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);
    const transaction = await mutateInterruptedJournal(root, () => {});
    const stagedPath = transaction.journal.briefs[0].stagedPath;
    const stagedSource = await readFile(stagedPath, "utf8");
    const ownedAside = join(root, "owned-staged-brief.md");
    await rename(stagedPath, ownedAside);
    await writeFile(stagedPath, stagedSource, "utf8");

    await assert.rejects(
      updateFixture(root),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(stagedPath, "utf8"), stagedSource);
    assert.equal(await pathExists(ownedAside), true);
    assert.equal(await pathExists(source), true);
    assert.equal(await pathExists(transaction.stagingRoot), true);
  });

  for (const stagedKind of ["original", "next"]) {
    await t.test(`a same-byte replacement of staged config ${stagedKind} is retained and rejected`, async (t) => {
      const root = await createFixture({ repositories: ["app"] });
      t.after(() => rm(root, { recursive: true, force: true }));
      const id = `2026-08-21-staged-config-${stagedKind}`;
      const source = join(root, "code", "app", "docs", "changes", id);
      await writeChange(source, "in_progress", `${stagedKind} staged config identity\n`);

      await interruptUpdate(root, `{
        beforeConfigWrite: ({ index }) => {
          if (index === 0) process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
        },
      }`);
      const transaction = await mutateInterruptedJournal(root, () => {});
      const record = transaction.journal.configs[0];
      const stagedPath = stagedKind === "original" ? record.originalPath : record.nextPath;
      const sourceBytes = await readFile(stagedPath);
      const ownedAside = join(root, `owned-staged-config-${stagedKind}.yaml`);
      await rename(stagedPath, ownedAside);
      await writeFile(stagedPath, sourceBytes);

      await assert.rejects(
        updateFixture(root),
        (error) => error.code === "MUTATION_RECOVERY_FAILED",
      );
      assert.deepEqual(await readFile(stagedPath), sourceBytes);
      assert.equal(await pathExists(ownedAside), true);
      assert.equal(await pathExists(source), true);
      assert.equal(await pathExists(transaction.stagingRoot), true);
    });
  }
});

test("partial source restoration resumes only through authenticated backup entries", async (t) => {
  async function createInterruptedRestore(childT, suffix) {
    const root = await createFixture({ repositories: ["app", "worker"] });
    childT.after(() => rm(root, { recursive: true, force: true }));
    const records = [];
    for (const repository of ["app", "worker"]) {
      for (const index of [1, 2]) {
        const id = `2026-08-21-${suffix}-${repository}-${index}`;
        const source = join(root, "code", repository, "docs", "changes", id);
        await writeChange(source, "in_progress", `${suffix} ${repository} ${index}\n`);
        const directoryMode = index === 1 ? 0o750 : 0o711;
        const designMode = index === 1 ? 0o640 : 0o604;
        await chmod(source, directoryMode);
        await chmod(join(source, "design.md"), designMode);
        records.push({
          repository,
          id,
          source,
          destination: getActiveChangePath(id, root),
          directoryMode,
          designMode,
        });
      }
    }
    const repositoryRoots = ["app", "worker"].map(
      (repository) => join(root, "code", repository, "docs", "changes"),
    );
    const rootModes = new Map(repositoryRoots.map((candidate, index) => [
      candidate,
      index === 0 ? 0o751 : 0o710,
    ]));
    for (const [candidate, mode] of rootModes) await chmod(candidate, mode);
    await interruptUpdate(root, `{
      beforeSourceRename: (() => {
        let calls = 0;
        return () => {
          calls += 1;
          if (calls === 2) process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
        };
      })(),
    }`);
    const rootStates = await Promise.all(repositoryRoots.map((candidate) => pathExists(candidate)));
    const missingIndex = rootStates.findIndex((exists) => !exists);
    assert.notEqual(missingIndex, -1);
    return {
      root,
      records,
      missingRoot: repositoryRoots[missingIndex],
      missingRootMode: rootModes.get(repositoryRoots[missingIndex]),
    };
  }

  await t.test("a crash after the first restored entry resumes to a complete rollback", async (t) => {
    const fixture = await createInterruptedRestore(t, "resume");
    await interruptRecovery(fixture.root, `{
      afterSourceRestoreEntry: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);
    assert.equal(await pathExists(fixture.missingRoot), true);
    assert.equal((await readdir(fixture.missingRoot)).length, 1);

    assert.deepEqual(
      await recoverUpdateMigration(fixture.root, { destinationWorkspaceRoot: fixture.root }),
      { recovered: 1 },
    );
    assert.equal((await lstat(fixture.missingRoot)).mode & 0o777, fixture.missingRootMode);
    for (const record of fixture.records) {
      assert.equal(await pathExists(record.source), true);
      assert.equal((await lstat(record.source)).mode & 0o777, record.directoryMode);
      assert.equal(
        (await lstat(join(record.source, "design.md"))).mode & 0o777,
        record.designMode,
      );
      assert.equal(await pathExists(record.destination), false);
    }
  });

  await t.test("an opaque collision in a partial restore fails closed without destination cleanup", async (t) => {
    const fixture = await createInterruptedRestore(t, "opaque");
    await interruptRecovery(fixture.root, `{
      afterSourceRestoreEntry: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);
    const restoredNames = new Set(await readdir(fixture.missingRoot));
    const missingRecord = fixture.records.find(
      (record) => dirname(record.source) === fixture.missingRoot && !restoredNames.has(record.id),
    );
    assert.ok(missingRecord);
    await mkdir(missingRecord.source);
    const opaquePath = join(missingRecord.source, "opaque.txt");
    await writeFile(opaquePath, "opaque partial restore\n", "utf8");

    await assert.rejects(
      recoverUpdateMigration(fixture.root, { destinationWorkspaceRoot: fixture.root }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(opaquePath, "utf8"), "opaque partial restore\n");
    for (const record of fixture.records) {
      assert.equal(await pathExists(record.destination), true);
    }
    const [stagingName] = (await readdir(join(fixture.root, ".sdd", "changes")))
      .filter((entry) => entry.startsWith(".sdd-update-"));
    assert.ok(stagingName);
  });

  await t.test("an opaque empty directory cannot be adopted during partial restore", async (t) => {
    const fixture = await createInterruptedRestore(t, "empty-opaque");
    await interruptRecovery(fixture.root, `{
      afterSourceRestoreEntry: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);
    const restoredNames = new Set(await readdir(fixture.missingRoot));
    const missingRecord = fixture.records.find(
      (record) => dirname(record.source) === fixture.missingRoot && !restoredNames.has(record.id),
    );
    assert.ok(missingRecord);
    await mkdir(missingRecord.source);

    await assert.rejects(
      recoverUpdateMigration(fixture.root, { destinationWorkspaceRoot: fixture.root }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );

    assert.deepEqual(await readdir(missingRecord.source), []);
    for (const record of fixture.records) {
      assert.equal(await pathExists(record.destination), true);
    }
    const [stagingName] = (await readdir(join(fixture.root, ".sdd", "changes")))
      .filter((entry) => entry.startsWith(".sdd-update-"));
    assert.ok(stagingName);
  });

  await t.test("a crash after restore reservation initialization resumes safely", async (t) => {
    const fixture = await createInterruptedRestore(t, "reservation-resume");
    await interruptRecovery(fixture.root, `{
      afterSourceRestoreReservation: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);

    assert.deepEqual(
      await recoverUpdateMigration(fixture.root, { destinationWorkspaceRoot: fixture.root }),
      { recovered: 1 },
    );
    for (const record of fixture.records) {
      assert.equal(await pathExists(record.source), true);
      assert.equal(await pathExists(record.destination), false);
    }
  });

  await t.test("a crashed empty restore reservation cannot adopt an injected child", async (t) => {
    const root = await createFixture({ repositories: ["app", "worker"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-21-restore-reservation-injection";
    const source = join(root, "code", "app", "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    await writeChange(source, "in_progress", "restore reservation injection\n");
    await writeChange(
      join(root, "code", "worker", "docs", "changes", `${id}-worker`),
      "in_progress",
      "restore reservation injection worker\n",
    );

    await interruptUpdate(root, `{
      beforeSourceRename: (() => {
        let calls = 0;
        return () => {
          calls += 1;
          if (calls === 2) throw new Error("trigger source rollback");
        };
      })(),
      afterSourceRestoreReservation: async ({ record }) => {
        const { mkdir, writeFile } = await import("node:fs/promises");
        const foreign = record.physicalPath + "/foreign";
        await mkdir(foreign);
        await writeFile(foreign + "/opaque.txt", "opaque reservation child\\n", "utf8");
        process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
      },
    }`);

    await assert.rejects(
      recoverUpdateMigration(root, { destinationWorkspaceRoot: root }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(
      await readFile(join(dirname(source), "foreign", "opaque.txt"), "utf8"),
      "opaque reservation child\n",
    );
    assert.equal(await pathExists(destination), true);
    const stagingNames = (await readdir(join(root, ".sdd", "changes")))
      .filter((entry) => entry.startsWith(".sdd-update-"));
    assert.equal(stagingNames.length, 1);
  });
  await t.test("a same-byte restored child replacement blocks all destination cleanup", async (t) => {
    const root = await createFixture({ repositories: ["app", "worker"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const records = [];
    for (const repository of ["app", "worker"]) {
      const id = `2026-08-21-restored-child-swap-${repository}`;
      const source = join(root, "code", repository, "docs", "changes", id);
      await writeChange(source, "in_progress", `restored child swap ${repository}\n`);
      records.push({ source, destination: getActiveChangePath(id, root) });
    }
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );
    const restoredFile = join(plan.sourceRoots[0].physicalPath, basename(records[0].source), "tasks.md");
    const retainedFile = `${restoredFile}.owned`;
    let swapped = false;

    await assert.rejects(
      applyUpdateMigration(plan, {
        beforeSourceRename: (() => {
          let calls = 0;
          return () => {
            calls += 1;
            if (calls === 2) throw new Error("trigger rollback after one source removal");
          };
        })(),
        afterConfigRestoreBackup: async () => {
          if (swapped || !(await pathExists(restoredFile))) return;
          swapped = true;
          const bytes = await readFile(restoredFile);
          const mode = (await lstat(restoredFile)).mode & 0o777;
          await rename(restoredFile, retainedFile);
          await writeFile(restoredFile, bytes, { mode });
        },
      }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );

    assert.equal(swapped, true);
    assert.equal(await pathExists(retainedFile), true);
    assert.deepEqual(await readFile(restoredFile), await readFile(retainedFile));
    for (const record of records) {
      assert.equal(await pathExists(record.destination), true);
    }
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
  const plan = await planUpdateMigration(root, await readWorkspaceConfig(root), { destinationWorkspaceRoot: root });

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
  assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v2");
});

test("Change directory reservations are identity-bound and crash-recoverable", async (t) => {
  await t.test("crash after exclusive mkdir rolls the reservation back and retries", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-21-change-reservation-crash";
    const source = join(root, "code", "app", "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    await writeChange(source, "in_progress", "reservation crash\n");

    await interruptUpdate(root, `{
      afterChangeReservationMkdir: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);

    assert.deepEqual(await readdir(destination), []);
    const stagingRoots = (await readdir(join(root, ".sdd", "changes")))
      .filter((entry) => entry.startsWith(".sdd-update-"));
    assert.equal(stagingRoots.length, 1);
    const reservationEvidence = (await readdir(join(root, ".sdd", "changes", stagingRoots[0])))
      .filter((entry) => entry.startsWith(".change-reservation-"));
    assert.equal(reservationEvidence.some((entry) => entry.endsWith(".intent.json")), true);
    assert.equal(reservationEvidence.some((entry) => entry.endsWith(".mutation-lock")), true);
    assert.equal(reservationEvidence.some((entry) => entry.endsWith(".binding.json")), true);
    const recovered = await updateFixture(root);
    assert.equal(recovered.migration.required, true);
    assert.equal(await pathExists(source), false);
    assert.match(await readFile(join(destination, "proposal.md"), "utf8"), /reservation crash/);
  });

  await t.test("replacement of an owned empty reservation is preserved", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-21-change-reservation-race";
    const source = join(root, "code", "app", "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    await writeChange(source, "in_progress", "reservation replacement\n");
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );

    await assert.rejects(
      applyUpdateMigration(plan, {
        afterChangeReservationMkdir: async ({ target }) => {
          await rm(target, { recursive: true });
          await mkdir(target);
        },
      }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );

    assert.deepEqual(await readdir(destination), []);
    assert.equal(await pathExists(source), true);
  });
});

test("source backup and restore transfers preserve concurrent path types", async (t) => {
  async function createCollision(fixtureRoot, path, kind) {
    if (kind === "directory") {
      await mkdir(path);
      return;
    }
    if (kind === "file") {
      await writeFile(path, "concurrent file\n", "utf8");
      return;
    }
    const target = join(fixtureRoot, "concurrent-symlink-target");
    await writeFile(target, "concurrent symlink\n", "utf8");
    await symlink(target, path);
  }

  async function assertCollision(path, kind) {
    const state = await lstat(path);
    if (kind === "directory") {
      assert.equal(state.isDirectory(), true);
      assert.equal(state.isSymbolicLink(), false);
      assert.deepEqual(await readdir(path), []);
    } else if (kind === "file") {
      assert.equal(state.isFile(), true);
      assert.equal(state.isSymbolicLink(), false);
      assert.equal(await readFile(path, "utf8"), "concurrent file\n");
    } else {
      assert.equal(state.isSymbolicLink(), true);
      assert.equal(await readFile(path, "utf8"), "concurrent symlink\n");
    }
  }

  for (const kind of ["directory", "file", "symlink"]) {
    await t.test(`source-to-backup preserves a concurrent ${kind}`, async (t) => {
      const root = await createFixture({ repositories: ["app"] });
      t.after(() => rm(root, { recursive: true, force: true }));
      const id = `2026-08-21-backup-${kind}`;
      const source = join(root, "code", "app", "docs", "changes");
      await writeChange(join(source, id), "in_progress", `${kind} backup collision\n`);
      const plan = await planUpdateMigration(
        root,
        await readWorkspaceConfig(root),
        { destinationWorkspaceRoot: root },
      );
      let collisionPath;

      await assert.rejects(
        applyUpdateMigration(plan, {
          beforeSourceRename: async ({ root: record }) => {
            collisionPath = record.backup;
            await createCollision(root, collisionPath, kind);
          },
        }),
        (error) => error.code === "CONCURRENT_CHANGE",
      );

      await assertCollision(collisionPath, kind);
      assert.equal(await pathExists(join(source, id, "tasks.md")), true);
    });
  }

  for (const kind of ["directory", "file", "symlink"]) {
    await t.test(`backup-to-source preserves a concurrent ${kind}`, async (t) => {
      const root = await createFixture({ repositories: ["app", "worker"] });
      t.after(() => rm(root, { recursive: true, force: true }));
      for (const repository of ["app", "worker"]) {
        await writeChange(
          join(root, "code", repository, "docs", "changes", `2026-08-21-restore-${repository}-${kind}`),
          "in_progress",
          `${kind} restore collision\n`,
        );
      }
      const plan = await planUpdateMigration(
        root,
        await readWorkspaceConfig(root),
        { destinationWorkspaceRoot: root },
      );
      let removedRecord = null;
      let collisionPath = null;

      await assert.rejects(
        applyUpdateMigration(plan, {
          beforeSourceRename: async ({ root: record }) => {
            if (removedRecord === null) {
              removedRecord = record;
              return;
            }
            collisionPath = removedRecord.physicalPath;
            await createCollision(root, collisionPath, kind);
            throw new Error("injected failure after concurrent source creation");
          },
        }),
        (error) => error.code === "MUTATION_RECOVERY_FAILED",
      );

      await assertCollision(collisionPath, kind);
      const payloads = await readdir(removedRecord.backup);
      assert.equal(payloads.length, 1);
      assert.equal(
        await hashDirectory(join(removedRecord.backup, payloads[0])),
        removedRecord.hash,
      );
    });
  }
});

test("transaction initialization re-anchors the Change store before creating staging state", async (t) => {
  const root = await createFixture({ repositories: ["app"] });
  const external = await mkdtemp(join(tmpdir(), "sdd-update-store-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(external, { recursive: true, force: true }));
  const id = "2026-08-22-change-store-swap";
  const source = join(root, "code", "app", "docs", "changes", id);
  const changesRoot = join(root, ".sdd", "changes");
  const capturedChangesRoot = join(root, ".sdd", "changes-captured");
  await writeChange(source, "in_progress");
  await mkdir(changesRoot);
  const plan = await planUpdateMigration(
    root,
    await readWorkspaceConfig(root),
    { destinationWorkspaceRoot: root },
  );

  await assert.rejects(
    applyUpdateMigration(plan, {
      beforeTransactionInitialize: async () => {
        await rename(changesRoot, capturedChangesRoot);
        await symlink(external, changesRoot);
      },
    }),
    (error) => error.code === "CONCURRENT_CHANGE",
  );

  assert.deepEqual(await readdir(external), []);
  assert.equal(await pathExists(source), true);
  assert.deepEqual(await readdir(capturedChangesRoot), []);
});

test("recovery rejects unknown journal schema and staging payloads without cleanup", async (t) => {
  async function createInterruptedTransaction(t, suffix) {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    await writeChange(
      join(root, "code", "app", "docs", "changes", `2026-08-23-${suffix}`),
      "in_progress",
    );
    await interruptUpdate(root, `{
      beforeSourceRemoval: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);
    return root;
  }

  async function expectRecoveryRejection(root, transaction) {
    await assert.rejects(
      updateFixture(root),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await pathExists(transaction.stagingRoot), true);
    assert.equal(await pathExists(transaction.journalPath), true);
  }

  await t.test("copy manifests require an exact mode field", async (t) => {
    const root = await createInterruptedTransaction(t, "missing-copy-mode");
    const transaction = await mutateInterruptedJournal(root, (journal) => {
      const [entry] = journal.changes[0].copyTargetManifest;
      assert.ok(entry);
      delete entry.mode;
    });

    await expectRecoveryRejection(root, transaction);
    const retained = JSON.parse(await readFile(transaction.journalPath, "utf8"));
    assert.equal("mode" in retained.changes[0].copyTargetManifest[0], false);
  });

  await t.test("copy provenance rejects a mode outside 0777", async (t) => {
    const root = await createInterruptedTransaction(t, "invalid-copy-provenance-mode");
    const transaction = await mutateInterruptedJournal(root, (journal) => {
      const [entry] = journal.changes[0].copyTargetProvenance;
      assert.ok(entry);
      entry.mode = 0o1000;
    });

    await expectRecoveryRejection(root, transaction);
    const retained = JSON.parse(await readFile(transaction.journalPath, "utf8"));
    assert.equal(retained.changes[0].copyTargetProvenance[0].mode, 0o1000);
  });

  await t.test("unknown top-level payload", async (t) => {
    const root = await createInterruptedTransaction(t, "unknown-payload");
    const transaction = await mutateInterruptedJournal(root, (journal) => {
      journal.payload = [];
    });

    await expectRecoveryRejection(root, transaction);
    const retained = JSON.parse(await readFile(transaction.journalPath, "utf8"));
    assert.deepEqual(retained.payload, []);
  });

  await t.test("unknown record action", async (t) => {
    const root = await createInterruptedTransaction(t, "unknown-action");
    const transaction = await mutateInterruptedJournal(root, (journal) => {
      journal.changes[0].action = "cleanup";
    });

    await expectRecoveryRejection(root, transaction);
    const retained = JSON.parse(await readFile(transaction.journalPath, "utf8"));
    assert.equal(retained.changes[0].action, "cleanup");
  });

  await t.test("unknown record phase", async (t) => {
    const root = await createInterruptedTransaction(t, "unknown-phase");
    const transaction = await mutateInterruptedJournal(root, (journal) => {
      journal.changes[0].phase = "cleanup";
    });

    await expectRecoveryRejection(root, transaction);
    const retained = JSON.parse(await readFile(transaction.journalPath, "utf8"));
    assert.equal(retained.changes[0].phase, "cleanup");
  });

  await t.test("untracked staging directory", async (t) => {
    const root = await createInterruptedTransaction(t, "unknown-staging");
    const transaction = await mutateInterruptedJournal(root, () => {});
    const opaqueRoot = join(transaction.stagingRoot, "opaque");
    const opaquePath = join(opaqueRoot, "preserve.txt");
    await mkdir(opaqueRoot);
    await writeFile(opaquePath, "preserve me\n", "utf8");

    await expectRecoveryRejection(root, transaction);
    assert.equal(await readFile(opaquePath, "utf8"), "preserve me\n");
  });
});

test("transaction writes re-anchor the staging root after an ancestor swap", async (t) => {
  const root = await createFixture({ repositories: ["app"] });
  const external = await mkdtemp(join(tmpdir(), "sdd-update-staging-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(external, { recursive: true, force: true }));
  const plannedRoot = join(root, "ideas", "sample", "planned-changes");
  const briefName = "staging-swap.md";
  await mkdir(plannedRoot, { recursive: true });
  await writeFile(join(plannedRoot, briefName), "staging swap\n", "utf8");
  const plan = await planUpdateMigration(
    root,
    await readWorkspaceConfig(root),
    { destinationWorkspaceRoot: root },
  );
  let capturedStagingRoot;

  await assert.rejects(
    applyUpdateMigration(plan, {
      beforeBriefLink: async ({ stagedPath }) => {
        const stagingRoot = dirname(stagedPath);
        capturedStagingRoot = `${stagingRoot}-captured`;
        await rename(stagingRoot, capturedStagingRoot);
        await symlink(external, stagingRoot);
      },
    }),
    (error) => error.code === "CONCURRENT_CHANGE",
  );

  assert.deepEqual(await readdir(external), []);
  assert.ok(capturedStagingRoot);
  assert.equal(await pathExists(join(plannedRoot, briefName)), true);
  assert.equal(await pathExists(join(capturedStagingRoot, "transaction.json")), true);
});

test("migration directory cleanup is identity-bound across post-verification windows", async (t) => {
  async function assertJournalRetained(root) {
    const changesRoot = join(root, ".sdd", "changes");
    const stagingEntries = (await readdir(changesRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(".sdd-update-"))
      .map((entry) => entry.name);
    assert.equal(stagingEntries.length, 1);
    const journalPath = join(changesRoot, stagingEntries[0], "transaction.json");
    assert.equal(await pathExists(journalPath), true);
    return { stagingRoot: dirname(journalPath), journalPath };
  }

  await t.test("source-backup cleanup preserves an opaque directory added after destination verification", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-24-source-cleanup-window";
    const source = join(root, "code", "app", "docs", "changes", id);
    await writeChange(source, "in_progress", "source cleanup window\n");
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );
    let opaquePath;
    const transaction = await applyUpdateMigration(plan, {
      afterSourceBackupVerification: async ({ payloadPath }) => {
        const opaqueRoot = join(payloadPath, "opaque-concurrent");
        opaquePath = join(opaqueRoot, "preserve.txt");
        await mkdir(opaqueRoot);
        await writeFile(opaquePath, "opaque source backup state\n", "utf8");
      },
    });

    await assert.rejects(
      finalizeMigrationTransaction(transaction),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(opaquePath, "utf8"), "opaque source backup state\n");
    assert.equal(await pathExists(source), false);
    await assertJournalRetained(root);
  });

  await t.test("Change rollback preserves a replacement installed after ownership verification", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-24-change-rollback-window";
    const source = join(root, "code", "app", "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    const opaquePath = join(destination, "opaque.txt");
    await writeChange(source, "in_progress", "rollback replacement\n");
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );

    await assert.rejects(
      applyUpdateMigration(plan, {
        beforeSourceRemoval: () => {
          throw new Error("trigger verified Change rollback");
        },
        afterChangeRollbackVerification: async ({ destination: ownedDestination }) => {
          await rm(ownedDestination, { recursive: true });
          await mkdir(ownedDestination);
          await writeFile(opaquePath, "opaque replacement\n", "utf8");
        },
      }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED"
        && error.details.some((detail) => detail.includes("Newer central Change preserved")),
    );
    assert.equal(await readFile(opaquePath, "utf8"), "opaque replacement\n");
    assert.equal(await pathExists(source), true);
    await assertJournalRetained(root);
  });

  await t.test("non-copy Change rollback resumes from an exact durable removal ledger", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-24-change-rollback-ledger";
    const source = join(root, "code", "app", "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    await writeChange(source, "in_progress", "rollback removal ledger\n");

    await interruptUpdate(root, `{
      beforeSourceRemoval: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);
    const beforeRollback = await mutateInterruptedJournal(root, (journal) => {
      const [record] = journal.changes;
      assert.ok(record.copyTargetProvenance.length > 0);
      record.copyRoot = null;
      record.copySourceRoot = null;
      record.copySourceManifest = null;
      record.copyTargetManifest = null;
      record.copyProvenanceToken = null;
      record.copyIntent = null;
    });

    await interruptRecovery(root, `{
      afterChangeRollbackRemovalEntry: ({ progress }) => {
        if (progress.length === 1) process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
      },
    }`);
    const interrupted = await mutateInterruptedJournal(root, () => {});
    const [record] = interrupted.journal.changes;
    assert.equal(record.removalMode, "staging");
    assert.equal(record.removalRoot, destination);
    assert.ok(record.removalManifest.length > 1);
    assert.equal(record.removalProgress.length, 1);
    const [removedRelativePath] = record.removalProgress;
    assert.notEqual(removedRelativePath, ".");
    assert.equal(await pathExists(join(destination, removedRelativePath)), false);
    assert.equal(await pathExists(destination), true);
    assert.equal(await pathExists(beforeRollback.stagingRoot), true);

    assert.deepEqual(
      await recoverUpdateMigration(root, { destinationWorkspaceRoot: root }),
      { recovered: 1 },
    );
    assert.equal(await pathExists(source), true);
    assert.equal(await pathExists(destination), false);
    assert.equal(await pathExists(beforeRollback.stagingRoot), false);
  });

  await t.test("non-copy rollback rejects mode drift before its first removal manifest", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-24-change-rollback-pre-manifest-mode";
    const source = join(root, "code", "app", "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    await writeChange(source, "in_progress", "rollback pre-manifest mode\n");

    await interruptUpdate(root, `{
      beforeSourceRemoval: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);
    const interrupted = await mutateInterruptedJournal(root, (journal) => {
      const [record] = journal.changes;
      assert.equal(record.removalManifest, null);
      record.copyRoot = null;
      record.copySourceRoot = null;
      record.copySourceManifest = null;
      record.copyTargetManifest = null;
      record.copyProvenanceToken = null;
      record.copyIntent = null;
    });
    const originalMode = (await lstat(destination)).mode & 0o777;
    const changedMode = originalMode ^ 0o200;
    await chmod(destination, changedMode);

    await assert.rejects(
      recoverUpdateMigration(root, { destinationWorkspaceRoot: root }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await pathExists(destination), true);
    assert.equal((await lstat(destination)).mode & 0o777, changedMode);
    assert.equal(await pathExists(interrupted.stagingRoot), true);
  });

  for (const entryType of ["file", "directory"]) {
    await t.test(`source cleanup detects an immediate ${entryType} chmod before removal`, async (t) => {
      const root = await createFixture({ repositories: ["app"] });
      t.after(() => rm(root, { recursive: true, force: true }));
      const id = `2026-08-24-source-immediate-${entryType}-mode`;
      const sourceRoot = join(root, "code", "app", "docs", "changes");
      const source = join(sourceRoot, id);
      const directoryPath = join(source, "mode-target");
      const filePath = join(directoryPath, "note.txt");
      const changedPath = entryType === "file" ? filePath : directoryPath;
      await writeChange(source, "in_progress", `immediate ${entryType} mode\n`);
      await mkdir(directoryPath);
      await writeFile(filePath, "mode-bound removal\n", { mode: 0o640 });
      await chmod(directoryPath, 0o710);
      const plan = await planUpdateMigration(
        root,
        await readWorkspaceConfig(root),
        { destinationWorkspaceRoot: root },
      );
      let changedMode = null;

      await assert.rejects(
        applyUpdateMigration(plan, {
          beforeSourceRemovalMutation: async ({ entry, path, phase }) => {
            const expectedPhase = entryType === "file" ? "original" : "directory";
            if (changedMode !== null
              || phase !== expectedPhase
              || entry.type !== entryType
              || path !== changedPath) return;
            changedMode = (await lstat(changedPath)).mode & 0o777;
            changedMode ^= entryType === "file" ? 0o100 : 0o200;
            await chmod(changedPath, changedMode);
          },
        }),
        (error) => error.code === "MUTATION_RECOVERY_FAILED",
      );
      assert.notEqual(changedMode, null);
      assert.equal(await pathExists(changedPath), true);
      assert.equal((await lstat(changedPath)).mode & 0o777, changedMode);
      await assertJournalRetained(root);
    });
  }

  await t.test("non-copy rollback rejects a file mode change after its first durable removal", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-24-change-rollback-mode-ledger";
    const source = join(root, "code", "app", "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    await writeChange(source, "in_progress", "rollback mode ledger\n");

    await interruptUpdate(root, `{
      beforeSourceRemoval: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);
    await mutateInterruptedJournal(root, (journal) => {
      const [record] = journal.changes;
      record.copyRoot = null;
      record.copySourceRoot = null;
      record.copySourceManifest = null;
      record.copyTargetManifest = null;
      record.copyProvenanceToken = null;
      record.copyIntent = null;
    });
    await interruptRecovery(root, `{
      afterChangeRollbackRemovalEntry: ({ progress }) => {
        if (progress.length === 1) process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
      },
    }`);

    const interrupted = await mutateInterruptedJournal(root, () => {});
    const [record] = interrupted.journal.changes;
    const removed = new Set(record.removalProgress);
    const remainingFile = record.removalManifest.find(
      (entry) => entry.type === "file" && !removed.has(entry.relativePath),
    );
    assert.ok(remainingFile);
    const remainingPath = join(destination, remainingFile.relativePath);
    await chmod(remainingPath, remainingFile.mode ^ 0o100);

    await assert.rejects(
      recoverUpdateMigration(root, { destinationWorkspaceRoot: root }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await pathExists(destination), true);
    assert.equal(await pathExists(interrupted.stagingRoot), true);
    assert.equal((await lstat(remainingPath)).mode & 0o777, remainingFile.mode ^ 0o100);
  });

  await t.test("non-copy rollback rejects a directory mode change after its first durable removal", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-24-change-rollback-directory-mode-ledger";
    const source = join(root, "code", "app", "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    await writeChange(source, "in_progress", "rollback directory mode ledger\n");

    await interruptUpdate(root, `{
      beforeSourceRemoval: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);
    await mutateInterruptedJournal(root, (journal) => {
      const [record] = journal.changes;
      record.copyRoot = null;
      record.copySourceRoot = null;
      record.copySourceManifest = null;
      record.copyTargetManifest = null;
      record.copyProvenanceToken = null;
      record.copyIntent = null;
    });
    await interruptRecovery(root, `{
      afterChangeRollbackRemovalEntry: ({ progress }) => {
        if (progress.length === 1) process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
      },
    }`);

    const interrupted = await mutateInterruptedJournal(root, () => {});
    const [record] = interrupted.journal.changes;
    const removed = new Set(record.removalProgress);
    const remainingDirectory = record.removalManifest.find(
      (entry) => entry.type === "directory"
        && entry.relativePath !== "."
        && !removed.has(entry.relativePath),
    );
    assert.ok(remainingDirectory);
    const remainingPath = join(destination, remainingDirectory.relativePath);
    await chmod(remainingPath, remainingDirectory.mode ^ 0o200);

    await assert.rejects(
      recoverUpdateMigration(root, { destinationWorkspaceRoot: root }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await pathExists(destination), true);
    assert.equal(await pathExists(interrupted.stagingRoot), true);
    assert.equal(
      (await lstat(remainingPath)).mode & 0o777,
      remainingDirectory.mode ^ 0o200,
    );
  });

  await t.test("multiple rollback failures retain authority and recover on retry", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const ids = [
      "2026-08-24-change-rollback-retry-one",
      "2026-08-24-change-rollback-retry-two",
    ];
    const destinations = ids.map((id) => getActiveChangePath(id, root));
    for (const id of ids) {
      await writeChange(
        join(root, "code", "app", "docs", "changes", id),
        "in_progress",
        `${id} retry authority\n`,
      );
    }
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );

    let failure;
    await assert.rejects(
      applyUpdateMigration(plan, {
        beforeSourceRemoval: () => {
          throw new Error("trigger multiple verified Change rollback failures");
        },
        afterChangeRollbackVerification: async ({ destination }) => {
          await rm(destination, { recursive: true });
          await mkdir(destination);
          await writeFile(join(destination, "opaque.txt"), `opaque ${basename(destination)}\n`, "utf8");
        },
      }),
      (error) => {
        failure = error;
        return error.code === "MUTATION_RECOVERY_FAILED";
      },
    );
    for (const destination of destinations) {
      assert.ok(failure.details.some((detail) => detail.includes(destination)));
      assert.match(await readFile(join(destination, "opaque.txt"), "utf8"), /^opaque /);
    }
    const pending = await assertJournalRetained(root);

    for (const destination of destinations) {
      await rm(destination, { recursive: true });
    }
    await updateFixture(root);
    for (const [index, id] of ids.entries()) {
      assert.equal(await pathExists(join(root, "code", "app", "docs", "changes", id)), false);
      assert.equal(await pathExists(destinations[index]), true);
    }
    assert.equal(await pathExists(pending.stagingRoot), false);
  });

  await t.test("staged Change cleanup preserves content added after its final hash verification", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-24-staged-cleanup-window";
    const source = join(root, "code", "app", "docs", "changes", id);
    await writeChange(source, "in_progress", "staged cleanup window\n");
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );
    let opaquePath;

    await assert.rejects(
      applyUpdateMigration(plan, {
        afterStagedChangeVerification: async ({ stagedPath }) => {
          opaquePath = join(stagedPath, "opaque-staged.txt");
          await writeFile(opaquePath, "opaque staged state\n", "utf8");
        },
      }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(opaquePath, "utf8"), "opaque staged state\n");
    assert.equal(await pathExists(source), true);
    await assertJournalRetained(root);
  });

  await t.test("transaction directory cleanup preserves content added after entry verification", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-24-transaction-cleanup-window";
    const source = join(root, "code", "app", "docs", "changes", id);
    await writeChange(source, "in_progress", "transaction cleanup window\n");
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );
    let opaquePath;

    await assert.rejects(
      applyUpdateMigration(plan, {
        beforeChangeEntryPublish: () => {
          throw new Error("trigger staged transaction cleanup");
        },
        afterTransactionDirectoryVerification: async ({ path }) => {
          if (opaquePath) return;
          opaquePath = join(path, "opaque-transaction.txt");
          await writeFile(opaquePath, "opaque transaction state\n", "utf8");
        },
      }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(opaquePath, "utf8"), "opaque transaction state\n");
    assert.equal(await pathExists(source), true);
    await assertJournalRetained(root);
  });

  await t.test("a file quarantine collision is preserved without replacing the journal", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-24-file-quarantine-collision";
    const source = join(root, "code", "app", "docs", "changes", id);
    await writeChange(source, "in_progress", "file quarantine collision\n");
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );
    let collisionPath;
    const transaction = await applyUpdateMigration(plan, {
      beforeCleanupQuarantine: async ({ label, quarantinePath }) => {
        if (label !== "Transaction journal" || collisionPath) return;
        collisionPath = quarantinePath;
        await writeFile(collisionPath, "opaque quarantine collision\n", "utf8");
      },
    });

    await assert.rejects(
      finalizeMigrationTransaction(transaction),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(collisionPath, "utf8"), "opaque quarantine collision\n");
    await assertJournalRetained(root);
  });

  await t.test("a manifest-entry quarantine replacement is preserved with its original", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-24-manifest-quarantine-replacement";
    const source = join(root, "code", "app", "docs", "changes", id);
    await writeChange(source, "in_progress", "manifest quarantine replacement\n");
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );
    let originalPath;
    let replacementPath;
    const transaction = await applyUpdateMigration(plan, {
      afterCleanupQuarantine: async ({
        label,
        path,
        quarantinePath,
      }) => {
        if (label !== "Migration backup payload"
          || basename(path) !== "proposal.md"
          || replacementPath) return;
        originalPath = path;
        replacementPath = quarantinePath;
        await rm(quarantinePath);
        await writeFile(quarantinePath, "opaque manifest quarantine\n", "utf8");
      },
    });

    await assert.rejects(
      finalizeMigrationTransaction(transaction),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await pathExists(originalPath), true);
    assert.equal(await readFile(replacementPath, "utf8"), "opaque manifest quarantine\n");
    await assertJournalRetained(root);
  });

  await t.test("a tree entry replaced after quarantine is never unlinked", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-24-tree-post-quarantine-replacement";
    const source = join(root, "code", "app", "docs", "changes", id);
    await writeChange(source, "in_progress", "tree post-quarantine replacement\n");
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );
    let replacementPath;
    let ownedQuarantine;
    const transaction = await applyUpdateMigration(plan, {
      afterCleanupQuarantine: async ({
        label,
        path,
        quarantinePath,
      }) => {
        if (label !== "Migration backup payload" || replacementPath) return;
        replacementPath = path;
        ownedQuarantine = quarantinePath;
        await rm(path);
        await writeFile(path, "opaque tree replacement\n", "utf8");
      },
    });

    await assert.rejects(
      finalizeMigrationTransaction(transaction),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(replacementPath, "utf8"), "opaque tree replacement\n");
    assert.equal(await pathExists(ownedQuarantine), true);
    await assertJournalRetained(root);
  });

  await t.test("a file quarantine replaced after handoff is preserved with the journal", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-24-file-quarantine-replacement";
    const source = join(root, "code", "app", "docs", "changes", id);
    await writeChange(source, "in_progress", "file quarantine replacement\n");
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );
    let replacementPath;
    const transaction = await applyUpdateMigration(plan, {
      afterCleanupQuarantine: async ({ label, quarantinePath }) => {
        if (label !== "Transaction journal" || replacementPath) return;
        replacementPath = quarantinePath;
        await rm(quarantinePath);
        await writeFile(quarantinePath, "opaque file quarantine\n", "utf8");
      },
    });

    await assert.rejects(
      finalizeMigrationTransaction(transaction),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(replacementPath, "utf8"), "opaque file quarantine\n");
    await assertJournalRetained(root);
  });

  await t.test("a file replacement immediately before unlink is preserved", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-24-file-pre-unlink-replacement";
    const source = join(root, "code", "app", "docs", "changes", id);
    await writeChange(source, "in_progress", "file pre-unlink replacement\n");
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );
    let replacementPath;
    const transaction = await applyUpdateMigration(plan, {
      beforeCleanupRemovalMutation: async ({ label, path, phase }) => {
        if (label !== "Transaction journal"
          || phase !== "original"
          || replacementPath) return;
        replacementPath = path;
        await rm(path);
        await writeFile(path, "opaque journal replacement\n", "utf8");
      },
    });

    await assert.rejects(
      finalizeMigrationTransaction(transaction),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(replacementPath, "utf8"), "opaque journal replacement\n");
    await assertJournalRetained(root);
  });

  await t.test("a directory replacement immediately before rmdir is preserved", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-24-directory-pre-rmdir-replacement";
    const source = join(root, "code", "app", "docs", "changes", id);
    const nestedSource = join(source, "nested");
    await writeChange(source, "in_progress", "directory pre-rmdir replacement\n");
    await mkdir(nestedSource);
    await writeFile(join(nestedSource, "owned.txt"), "owned\n", "utf8");
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );
    let replacementPath;
    const transaction = await applyUpdateMigration(plan, {
      beforeCleanupRemovalMutation: async ({
        label,
        path,
        phase,
      }) => {
        if (label !== "Migration backup payload"
          || phase !== "directory"
          || basename(path) !== "nested"
          || replacementPath) return;
        replacementPath = path;
        await rmdir(path);
        await mkdir(path);
        await writeFile(join(path, "opaque.txt"), "opaque directory replacement\n", "utf8");
      },
    });

    await assert.rejects(
      finalizeMigrationTransaction(transaction),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(
      await readFile(join(replacementPath, "opaque.txt"), "utf8"),
      "opaque directory replacement\n",
    );
    await assertJournalRetained(root);
  });

  await t.test("a manifest-entry quarantine collision preserves both paths", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-24-manifest-quarantine-collision";
    const source = join(root, "code", "app", "docs", "changes", id);
    await writeChange(source, "in_progress", "manifest quarantine collision\n");
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );
    let originalPath;
    let collisionPath;
    const transaction = await applyUpdateMigration(plan, {
      beforeCleanupQuarantine: async ({
        label,
        path,
        quarantinePath,
      }) => {
        if (label !== "Migration backup payload"
          || basename(path) !== "proposal.md"
          || collisionPath) return;
        originalPath = path;
        collisionPath = quarantinePath;
        await writeFile(quarantinePath, "opaque manifest collision\n", "utf8");
      },
    });

    await assert.rejects(
      finalizeMigrationTransaction(transaction),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await pathExists(originalPath), true);
    assert.equal(await readFile(collisionPath, "utf8"), "opaque manifest collision\n");
    await assertJournalRetained(root);
  });

  await t.test("a staged tasks quarantine collision is retained without replacing it", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-24-staged-tasks-quarantine-collision";
    const source = join(root, "code", "app", "docs", "changes", id);
    await writeChange(source, "in_progress", "staged tasks quarantine collision\n");
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );
    let tasksPath;
    let collisionPath;

    await assert.rejects(
      applyUpdateMigration(plan, {
        beforeStagedTasksQuarantine: async ({
          tasksPath: currentTasksPath,
          quarantinePath,
        }) => {
          tasksPath = currentTasksPath;
          collisionPath = quarantinePath;
          await writeFile(quarantinePath, "opaque staged tasks collision\n", "utf8");
        },
      }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await pathExists(tasksPath), true);
    assert.equal(await readFile(collisionPath, "utf8"), "opaque staged tasks collision\n");
    assert.equal(await pathExists(source), true);
    await assertJournalRetained(root);
  });
});

test("terminal cleanup receipts survive every destructive handoff", async (t) => {
  async function createTerminalTransaction(testContext, suffix, options = {}) {
    const root = await createFixture({ repositories: ["app"] });
    testContext.after(() => rm(root, { recursive: true, force: true }));
    const id = `2026-08-24-terminal-cleanup-${suffix}`;
    const source = join(root, "code", "app", "docs", "changes", id);
    await writeChange(source, "in_progress", `terminal cleanup ${suffix}\n`);
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );
    const transaction = await applyUpdateMigration(plan, options);
    return { root, transaction };
  }

  async function readTerminalReceipt(root) {
    const changesRoot = join(root, ".sdd", "changes");
    const receiptName = (await readdir(changesRoot))
      .find((entry) => entry.endsWith(".terminal-cleanup.json"));
    assert.ok(receiptName);
    const path = join(changesRoot, receiptName);
    return { path, value: JSON.parse(await readFile(path, "utf8")) };
  }

  async function assertTerminalArtifactsRemoved(root) {
    assert.deepEqual(
      (await readdir(join(root, ".sdd", "changes")))
        .filter((entry) => entry.startsWith(".sdd-update-")),
      [],
    );
    assert.deepEqual(
      (await readdir(join(root, ".sdd")))
        .filter((entry) => entry.startsWith(".sdd-update-")),
      [],
    );
  }

  await t.test("normal cleanup deletes the receipt after every owned artifact", async (t) => {
    const fixture = await createTerminalTransaction(t, "normal");
    await finalizeMigrationTransaction(fixture.transaction);
    await assertTerminalArtifactsRemoved(fixture.root);
  });
  for (const [suffix, hook, label] of [
    ["child-receipt-stage", "afterTransactionCleanupReceiptStage", "receipt staging"],
    ["child-receipt-proof", "afterTransactionCleanupReceiptProof", "receipt identity proof"],
    ["child-receipt", "afterTransactionCleanupReceipt", "receipt publication"],
    ["child-journal", "afterTransactionJournalUnlink", "journal unlink"],
    ["child-staging-root", "afterTransactionStagingRootRemoval", "staging-root removal"],
    ["child-witness", "afterTransactionWitnessUnlink", "external-witness unlink"],
  ]) {
    await t.test(`a child exit after ${label} remains recoverable`, async (t) => {
      const root = await createFixture({ repositories: ["app"] });
      t.after(() => rm(root, { recursive: true, force: true }));
      const id = `2026-08-24-terminal-cleanup-${suffix}`;
      await writeChange(
        join(root, "code", "app", "docs", "changes", id),
        "in_progress",
        `terminal cleanup ${suffix}\n`,
      );
      await interruptUpdate(
        root,
        `{
          ${hook}: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
        }`,
        { finalize: true },
      );

      assert.deepEqual(
        await recoverUpdateMigration(root, { destinationWorkspaceRoot: root }),
        { recovered: 1 },
      );
      await assertTerminalArtifactsRemoved(root);
    });
  }

  await t.test("a crash after receipt staging authenticates and finishes publication", async (t) => {
    let exposure;
    const fixture = await createTerminalTransaction(t, "receipt-stage", {
      afterTransactionCleanupReceiptStage: (details) => {
        exposure = details;
        throw new Error("crash after terminal receipt staging");
      },
    });
    await assert.rejects(
      finalizeMigrationTransaction(fixture.transaction),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.ok(exposure);
    assert.equal(await pathExists(exposure.receiptStagingPath), true);
    assert.equal(await pathExists(exposure.receiptProofPath), false);
    assert.equal(await pathExists(exposure.receiptPath), false);

    assert.deepEqual(
      await recoverUpdateMigration(fixture.root, { destinationWorkspaceRoot: fixture.root }),
      { recovered: 1 },
    );
    await assertTerminalArtifactsRemoved(fixture.root);
  });

  await t.test("a crash after receipt identity proof remains discoverable", async (t) => {
    let exposure;
    const fixture = await createTerminalTransaction(t, "receipt-proof", {
      afterTransactionCleanupReceiptProof: (details) => {
        exposure = details;
        throw new Error("crash after terminal receipt proof");
      },
    });
    await assert.rejects(
      finalizeMigrationTransaction(fixture.transaction),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.ok(exposure);
    assert.equal(await pathExists(exposure.receiptStagingPath), true);
    assert.equal(await pathExists(exposure.receiptProofPath), true);
    assert.equal(await pathExists(exposure.receiptPath), false);

    assert.deepEqual(
      await recoverUpdateMigration(fixture.root, { destinationWorkspaceRoot: fixture.root }),
      { recovered: 1 },
    );
    await assertTerminalArtifactsRemoved(fixture.root);
  });


  await t.test("a receipt and journal duplicate handoff resumes idempotently", async (t) => {
    const fixture = await createTerminalTransaction(t, "duplicate", {
      afterTransactionCleanupReceipt: () => {
        throw new Error("crash after terminal receipt publication");
      },
    });
    await assert.rejects(
      finalizeMigrationTransaction(fixture.transaction),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    const receipt = await readTerminalReceipt(fixture.root);
    assert.equal(await pathExists(receipt.value.plan.journal.path), true);

    assert.deepEqual(
      await recoverUpdateMigration(fixture.root, { destinationWorkspaceRoot: fixture.root }),
      { recovered: 1 },
    );
    await assertTerminalArtifactsRemoved(fixture.root);
  });

  await t.test("a crash after journal unlink remains receipt-discoverable", async (t) => {
    const fixture = await createTerminalTransaction(t, "journal", {
      afterTransactionJournalUnlink: () => {
        throw new Error("crash after journal unlink");
      },
    });
    await assert.rejects(
      finalizeMigrationTransaction(fixture.transaction),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    const receipt = await readTerminalReceipt(fixture.root);
    assert.equal(await pathExists(receipt.value.plan.journal.path), false);

    assert.deepEqual(
      await recoverUpdateMigration(fixture.root, { destinationWorkspaceRoot: fixture.root }),
      { recovered: 1 },
    );
    await assertTerminalArtifactsRemoved(fixture.root);
  });

  await t.test("a crash after staging-root removal remains receipt-discoverable", async (t) => {
    let removedRoot;
    const fixture = await createTerminalTransaction(t, "staging-root", {
      afterTransactionStagingRootRemoval: ({ stagingRoot }) => {
        removedRoot = stagingRoot;
        throw new Error("crash after staging root removal");
      },
    });
    await assert.rejects(
      finalizeMigrationTransaction(fixture.transaction),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.ok(removedRoot);
    assert.equal(await pathExists(removedRoot), false);
    await readTerminalReceipt(fixture.root);

    assert.deepEqual(
      await recoverUpdateMigration(fixture.root, { destinationWorkspaceRoot: fixture.root }),
      { recovered: 1 },
    );
    await assertTerminalArtifactsRemoved(fixture.root);
  });

  await t.test("a crash during external witness unlink resumes its durable quarantine", async (t) => {
    let interruptedWitness;
    const fixture = await createTerminalTransaction(t, "witness", {
      afterTransactionWitnessUnlink: ({ kind, path }) => {
        if (interruptedWitness) return;
        interruptedWitness = { kind, path };
        throw new Error("crash during witness cleanup");
      },
    });
    await assert.rejects(
      finalizeMigrationTransaction(fixture.transaction),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.ok(interruptedWitness);
    assert.equal(await pathExists(interruptedWitness.path), false);
    await readTerminalReceipt(fixture.root);

    assert.deepEqual(
      await recoverUpdateMigration(fixture.root, { destinationWorkspaceRoot: fixture.root }),
      { recovered: 1 },
    );
    await assertTerminalArtifactsRemoved(fixture.root);
  });

  await t.test("an opaque external-witness replacement is retained and fails closed", async (t) => {
    const fixture = await createTerminalTransaction(t, "opaque-witness", {
      afterTransactionStagingRootRemoval: () => {
        throw new Error("crash before witness cleanup");
      },
    });
    await assert.rejects(
      finalizeMigrationTransaction(fixture.transaction),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    const receipt = await readTerminalReceipt(fixture.root);
    const witnessPath = receipt.value.plan.externalWitnesses[0].path;
    await rm(witnessPath);
    await writeFile(witnessPath, "opaque witness replacement\n", "utf8");

    await assert.rejects(
      recoverUpdateMigration(fixture.root, { destinationWorkspaceRoot: fixture.root }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(witnessPath, "utf8"), "opaque witness replacement\n");
    assert.equal(await pathExists(receipt.path), true);
  });
  await t.test("same-byte manifest witness replacements are never adopted", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-24-terminal-cleanup-manifest-identity";
    await writeChange(
      join(root, "code", "app", "docs", "changes", id),
      "in_progress",
      "terminal cleanup manifest identity\n",
    );
    await interruptUpdate(
      root,
      `{
        beforeSourceBackupDelete: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
      }`,
      { finalize: true },
    );
    const changesRoot = join(root, ".sdd", "changes");
    const stagingEntry = (await readdir(changesRoot, { withFileTypes: true }))
      .find((entry) => entry.isDirectory() && entry.name.startsWith(".sdd-update-"));
    assert.ok(stagingEntry);
    const stagingRoot = join(changesRoot, stagingEntry.name);
    const manifestPath = join(stagingRoot, "destinations.json");
    const witnessPath = join(root, ".sdd", `${stagingEntry.name}-destinations`);
    const source = await readFile(manifestPath, "utf8");
    await rm(manifestPath);
    await rm(witnessPath);
    await writeFile(manifestPath, source, "utf8");
    await chmod(manifestPath, 0o400);
    await link(manifestPath, witnessPath);

    await assert.rejects(
      recoverUpdateMigration(root, { destinationWorkspaceRoot: root }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(manifestPath, "utf8"), source);
    assert.equal(await readFile(witnessPath, "utf8"), source);
    assert.equal(await pathExists(join(stagingRoot, "transaction.json")), true);
  });
});

test("staging and backup reservations retain crash ownership evidence", async (t) => {
  await t.test("an authenticated source-backup mkdir recovers and retries", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-24-backup-reservation-crash";
    const source = join(root, "code", "app", "docs", "changes", id);
    await writeChange(source, "in_progress", "backup reservation crash\n");
    await interruptUpdate(root, `{
      afterSourceBackupReservationMkdir: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);
    let sourceRecord;
    const transaction = await mutateInterruptedJournal(root, (journal) => {
      sourceRecord = { ...journal.sources.find((record) => record.physicalPath === dirname(source)) };
    });
    assert.ok(sourceRecord);

    assert.notEqual(sourceRecord.backupIdentity, null);
    const recovered = await updateFixture(root);
    assert.equal(recovered.migration.required, true);
    assert.equal(await pathExists(source), false);
    assert.equal(await pathExists(getActiveChangePath(id, root)), true);
    assert.equal(await pathExists(sourceRecord.backup), false);
    assert.equal(await pathExists(transaction.journalPath), false);
  });

  await t.test("a crash after staging-reservation identity persistence fails closed without a payload proof", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-24-staging-reservation-crash";
    const source = join(root, "code", "app", "docs", "changes", id);
    await writeChange(source, "in_progress", "staging reservation crash\n");
    await interruptUpdate(root, `{
      afterChangeStagingReservationMkdir: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);
    let stagingPath;
    const transaction = await mutateInterruptedJournal(root, (journal) => {
      stagingPath = journal.changes[0].stagingPath;
    });

    await assert.rejects(
      updateFixture(root),
      (error) => error.code === "MUTATION_RECOVERY_FAILED"
        && error.details.some((detail) => detail.includes("transaction-created hardlink ownership proof")),
    );
    assert.equal(await pathExists(stagingPath), true);
    assert.equal(await pathExists(transaction.journalPath), true);
    assert.equal(await pathExists(source), true);
  });

  await t.test("a copied tasks symlink swap never writes through to its external target", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    const external = await mkdtemp(join(tmpdir(), "sdd-staging-symlink-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    t.after(() => rm(external, { recursive: true, force: true }));
    const id = "2026-08-24-staging-child-symlink";
    const source = join(root, "code", "app", "docs", "changes", id);
    const externalTasks = join(external, "tasks.md");
    let stagedTasksPath;
    await writeChange(source, "in_progress", "staging child symlink\n");
    await writeFile(externalTasks, "external must survive\n", "utf8");
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );

    await assert.rejects(
      applyUpdateMigration(plan, {
        afterChangeStagingCopy: async ({ tasksPath }) => {
          stagedTasksPath = tasksPath;
          await rm(tasksPath);
          await symlink(externalTasks, tasksPath);
        },
      }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(externalTasks, "utf8"), "external must survive\n");
    assert.equal((await lstat(stagedTasksPath)).isSymbolicLink(), true);
    assert.equal(await readFile(stagedTasksPath, "utf8"), "external must survive\n");
    assert.equal(await pathExists(source), true);
    assert.equal(await pathExists(getActiveChangePath(id, root)), false);
  });

  await t.test("an opaque file added to the copied payload is retained", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-24-staging-opaque-file";
    const source = join(root, "code", "app", "docs", "changes", id);
    await writeChange(source, "in_progress", "staging opaque file\n");
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );
    let opaquePath;

    await assert.rejects(
      applyUpdateMigration(plan, {
        afterChangeStagingCopy: async ({ stagingPath }) => {
          opaquePath = join(stagingPath, "opaque.txt");

          await writeFile(opaquePath, "opaque copied state\n", "utf8");
        },
      }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(opaquePath, "utf8"), "opaque copied state\n");
    assert.equal(await pathExists(source), true);
    const changesRoot = join(root, ".sdd", "changes");
    const retained = (await readdir(changesRoot))
      .filter((entry) => entry.startsWith(".sdd-update-"));
    assert.equal(retained.length, 1);
  });
});

test("transaction journal atomic temporaries are identity-owned", async (t) => {
  await t.test("a crash after an authenticated journal write is recoverable", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-24-journal-write-crash";
    const source = join(root, "code", "app", "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    await writeChange(source, "in_progress", "journal write crash\n");
    await interruptUpdate(root, `{
      beforeTransactionJournalReplace: ({ state }) => {
        if (state.publishedChanges[0]?.phase === "publishing") {
          process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
        }
      },
    }`);
    const changesRoot = join(root, ".sdd", "changes");
    const [stagingName] = (await readdir(changesRoot))
      .filter((entry) => entry.startsWith(".sdd-update-"));
    const stagingEntries = await readdir(join(changesRoot, stagingName));
    assert.equal(
      stagingEntries.some(
        (entry) => entry.startsWith(".transaction.json.sdd-write-")
          && ![
            ".transaction.json.sdd-write-proof",
            ".transaction.json.sdd-write-authority",
            ".transaction.json.sdd-write-cleanup",
          ].includes(entry),
      ),
      true,
    );
    assert.equal(stagingEntries.includes(".transaction.json.sdd-write-proof"), true);

    await updateFixture(root);
    assert.equal(await pathExists(source), false);
    assert.match(await readFile(join(destination, "proposal.md"), "utf8"), /journal write crash/);
  });

  await t.test("an opaque atomic-looking decoy is retained and fails recovery closed", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    await writeChange(
      join(root, "code", "app", "docs", "changes", "2026-08-24-journal-write-decoy"),
      "in_progress",
      "journal write decoy\n",
    );
    await interruptUpdate(root, `{
      beforeSourceRemoval: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);
    const transaction = await mutateInterruptedJournal(root, () => {});
    const decoyPath = join(
      transaction.stagingRoot,
      `.transaction.json.sdd-write-999-${randomUUID()}`,
    );
    await writeFile(decoyPath, "opaque journal state\n", "utf8");

    await assert.rejects(
      updateFixture(root),
      (error) => error.code === "MUTATION_RECOVERY_FAILED"
        && error.details.some((detail) => detail.includes("atomic-write state must be preserved")),
    );
    assert.equal(await readFile(decoyPath, "utf8"), "opaque journal state\n");
    assert.equal(await pathExists(transaction.journalPath), true);
  });

  await t.test("a concurrent journal replacement is preserved with its recovery candidate", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-24-journal-replacement";
    const source = join(root, "code", "app", "docs", "changes", id);
    await writeChange(source, "in_progress", "journal replacement\n");
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );
    let replacementPath;
    let replaced = false;

    await assert.rejects(
      applyUpdateMigration(plan, {
        beforeTransactionJournalReplace: async ({ state }) => {
          if (replaced || state.publishedChanges[0]?.phase !== "publishing") return;
          replaced = true;
          replacementPath = state.journalPath;
          await rm(replacementPath);
          await writeFile(replacementPath, "opaque concurrent journal\n", "utf8");
        },
      }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(replacementPath, "utf8"), "opaque concurrent journal\n");
    const stagingEntries = await readdir(dirname(replacementPath));
    assert.equal(stagingEntries.includes(".transaction.json.sdd-write-proof"), true);
    assert.equal(
      stagingEntries.some((entry) => entry.startsWith(".transaction.json.sdd-write-")
        && ![
          ".transaction.json.sdd-write-proof",
          ".transaction.json.sdd-write-authority",
          ".transaction.json.sdd-write-cleanup",
        ].includes(entry)),
      true,
    );
  });

  await t.test("a same-byte live journal inode replacement is preserved with its candidate", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-24-journal-same-bytes";
    const source = join(root, "code", "app", "docs", "changes", id);
    await writeChange(source, "in_progress", "same-byte journal replacement\n");
    await interruptUpdate(root, `{
      beforeTransactionJournalReplace: ({ state }) => {
        if (state.publishedChanges[0]?.phase === "publishing") {
          process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
        }
      },
    }`);

    const changesRoot = join(root, ".sdd", "changes");
    const [stagingName] = (await readdir(changesRoot))
      .filter((entry) => entry.startsWith(".sdd-update-"));
    const stagingRoot = join(changesRoot, stagingName);
    const journalPath = join(stagingRoot, "transaction.json");
    const journalSource = await readFile(journalPath, "utf8");
    const retainedJournalPath = join(root, "retained-original-journal.json");
    await rename(journalPath, retainedJournalPath);
    await writeFile(journalPath, journalSource, "utf8");
    const [retainedState, replacementState] = await Promise.all([
      lstat(retainedJournalPath),
      lstat(journalPath),
    ]);
    assert.notEqual(String(retainedState.ino), String(replacementState.ino));

    const stagingEntries = await readdir(stagingRoot);
    const [candidateName] = stagingEntries.filter(
      (entry) => entry.startsWith(".transaction.json.sdd-write-")
        && ![
          ".transaction.json.sdd-write-proof",
          ".transaction.json.sdd-write-authority",
          ".transaction.json.sdd-write-cleanup",
        ].includes(entry),
    );
    assert.ok(candidateName);
    const candidatePath = join(stagingRoot, candidateName);
    const candidateSource = await readFile(candidatePath, "utf8");
    const proofPath = join(stagingRoot, ".transaction.json.sdd-write-proof");
    const authorityPath = join(stagingRoot, ".transaction.json.sdd-write-authority");
    const proofSource = await readFile(proofPath, "utf8");
    const authoritySource = await readFile(authorityPath, "utf8");

    await assert.rejects(
      updateFixture(root),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(journalPath, "utf8"), journalSource);
    assert.equal(await readFile(retainedJournalPath, "utf8"), journalSource);
    assert.equal(await readFile(candidatePath, "utf8"), candidateSource);
    assert.equal(await readFile(proofPath, "utf8"), proofSource);
    assert.equal(await readFile(authorityPath, "utf8"), authoritySource);
    assert.equal(await pathExists(stagingRoot), true);
    assert.equal(await pathExists(source), true);
  });

  await t.test("a forged journal candidate is preserved with its authenticated proof", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-24-journal-forged-candidate";
    const source = join(root, "code", "app", "docs", "changes", id);
    await writeChange(source, "in_progress", "forged journal candidate\n");
    await interruptUpdate(root, `{
      beforeTransactionJournalReplace: ({ state }) => {
        if (state.publishedChanges[0]?.phase === "publishing") {
          process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
        }
      },
    }`);

    const changesRoot = join(root, ".sdd", "changes");
    const [stagingName] = (await readdir(changesRoot))
      .filter((entry) => entry.startsWith(".sdd-update-"));
    const stagingRoot = join(changesRoot, stagingName);
    const journalPath = join(stagingRoot, "transaction.json");
    const journalSource = await readFile(journalPath, "utf8");
    const stagingEntries = await readdir(stagingRoot);
    const [candidateName] = stagingEntries.filter(
      (entry) => entry.startsWith(".transaction.json.sdd-write-")
        && ![
          ".transaction.json.sdd-write-proof",
          ".transaction.json.sdd-write-authority",
          ".transaction.json.sdd-write-cleanup",
        ].includes(entry),
    );
    assert.ok(candidateName);
    const candidatePath = join(stagingRoot, candidateName);
    const authenticCandidatePath = join(root, "retained-authentic-journal-candidate.json");
    const authenticCandidateSource = await readFile(candidatePath, "utf8");
    const forgedJournal = JSON.parse(authenticCandidateSource);
    forgedJournal.status = forgedJournal.status === "applying" ? "committed" : "applying";
    const forgedSource = `${JSON.stringify(forgedJournal, null, 2)}\n`;
    await rename(candidatePath, authenticCandidatePath);
    await writeFile(candidatePath, forgedSource, "utf8");
    const proofPath = join(stagingRoot, ".transaction.json.sdd-write-proof");
    const authorityPath = join(stagingRoot, ".transaction.json.sdd-write-authority");
    const proofSource = await readFile(proofPath, "utf8");
    const authoritySource = await readFile(authorityPath, "utf8");

    await assert.rejects(
      updateFixture(root),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(journalPath, "utf8"), journalSource);
    assert.equal(await readFile(candidatePath, "utf8"), forgedSource);
    assert.equal(await readFile(authenticCandidatePath, "utf8"), authenticCandidateSource);
    assert.equal(await readFile(proofPath, "utf8"), proofSource);
    assert.equal(await readFile(authorityPath, "utf8"), authoritySource);
    assert.equal(await pathExists(stagingRoot), true);
    assert.equal(await pathExists(source), true);
  });

  await t.test("staged directory evidence closes the pre-publication journal crash window", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-24-staged-identity-evidence-crash";
    const source = join(root, "code", "app", "docs", "changes", id);
    await writeChange(source, "in_progress", "staged identity evidence crash\n");
    await interruptUpdate(root, `{
      afterStagedIdentityEvidence: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);

    const transaction = await mutateInterruptedJournal(root, () => {});
    const [change] = transaction.journal.changes;
    assert.equal(change.phase, "publishing");
    assert.equal(typeof change.stagedIdentity.dev, "string");
    assert.equal(typeof change.proofIdentity.dev, "string");
    assert.equal(change.copyRoot, null);
    assert.equal(change.copyProvenanceToken, null);
    assert.equal(await pathExists(change.stagedPath), true);
    const evidencePrefix = `.change-staged-identity-${change.ownerToken}-`;
    assert.equal(
      (await readdir(transaction.stagingRoot))
        .filter((entry) => entry.startsWith(evidencePrefix))
        .length,
      1,
    );

    assert.deepEqual(
      await recoverUpdateMigration(root, { destinationWorkspaceRoot: root }),
      { recovered: 1 },
    );
    assert.equal(await pathExists(source), true);
    assert.equal(await pathExists(getActiveChangePath(id, root)), false);
    assert.equal(await pathExists(transaction.stagingRoot), false);
  });

  await t.test("a same-hash staged tree cannot replace its authenticated directory identity", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-24-forged-staging-identity";
    const source = join(root, "code", "app", "docs", "changes", id);
    await writeChange(source, "in_progress", "forged staging identity\n");
    await interruptUpdate(root, `{
      beforeChangeEntryPublish: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);
    let stagedPath;
    const transaction = await mutateInterruptedJournal(root, (journal) => {
      stagedPath = journal.changes[0].stagedPath;
    });
    const ownedAside = `${stagedPath}.owned`;
    await rename(stagedPath, ownedAside);
    await cp(ownedAside, stagedPath, { recursive: true });
    const replacementTasks = join(stagedPath, "tasks.md");
    await rm(replacementTasks);
    await link(
      join(transaction.stagingRoot, ".destination-0-guard"),
      replacementTasks,
    );
    const replacementState = await lstat(stagedPath);
    await mutateInterruptedJournal(root, (journal) => {
      journal.changes[0].stagedIdentity = {
        dev: String(replacementState.dev),
        ino: String(replacementState.ino),
      };
    });
    assert.equal(await hashDirectory(stagedPath), await hashDirectory(ownedAside));

    await assert.rejects(
      updateFixture(root),
      (error) => error.code === "MUTATION_RECOVERY_FAILED"
        && error.details.some((detail) => detail.includes("external identity proof")),
    );
    assert.equal(await pathExists(stagedPath), true);
    assert.equal(await pathExists(ownedAside), true);
    assert.equal(await pathExists(transaction.journalPath), true);
    assert.equal(await pathExists(source), true);
  });
});

test("migration readiness failure remains explicitly rollback-capable", async (t) => {
  const root = await createFixture({ repositories: ["app"] });
  t.after(() => rm(root, { recursive: true, force: true }));
  const id = "2026-08-24-readiness-rollback";
  const source = join(root, "code", "app", "docs", "changes", id);
  const destination = getActiveChangePath(id, root);
  await writeChange(source, "in_progress", "readiness rollback\n");
  const plan = await planUpdateMigration(
    root,
    await readWorkspaceConfig(root),
    { destinationWorkspaceRoot: root },
  );
  const transaction = await applyUpdateMigration(plan, {
    beforeCommitReady: () => {
      throw new Error("injected readiness failure");
    },
  });

  await assert.rejects(transaction.assertCommitReady(), /injected readiness failure/);
  assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v3");
  assert.equal(await pathExists(source), false);
  assert.equal(await pathExists(destination), true);
  const changesRoot = join(root, ".sdd", "changes");
  assert.equal(
    (await readdir(changesRoot)).filter((entry) => entry.startsWith(".sdd-update-")).length,
    1,
  );
  await transaction.rollback();
  assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v2");
  assert.equal(await pathExists(source), true);
  assert.equal(await pathExists(destination), false);
  assert.deepEqual(
    (await readdir(changesRoot)).filter((entry) => entry.startsWith(".sdd-update-")),
    [],
  );
});

test("committed migration handles reject rollback before and after cleanup", async (t) => {
  const root = await createFixture({ repositories: ["app"] });
  t.after(() => rm(root, { recursive: true, force: true }));
  const id = "2026-08-24-committed-rollback-rejection";
  const source = join(root, "code", "app", "docs", "changes", id);
  const destination = getActiveChangePath(id, root);
  await writeChange(source, "in_progress", "committed rollback rejection\n");
  const plan = await planUpdateMigration(
    root,
    await readWorkspaceConfig(root),
    { destinationWorkspaceRoot: root },
  );
  const transaction = await applyUpdateMigration(plan);

  await transaction.assertCommitReady();
  await transaction.commit();
  await assert.rejects(
    transaction.rollback(),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.message.includes("cannot be rolled back"),
  );
  assert.equal(await pathExists(source), false);
  assert.equal(await pathExists(destination), true);

  await transaction.finalizeCleanup();
  await assert.rejects(
    transaction.rollback(),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.message.includes("cannot be rolled back"),
  );
});

test("update rolls both subsystems back when migration readiness fails before shared commit", async (t) => {
  const root = await createFixture({ repositories: ["app"] });
  t.after(() => rm(root, { recursive: true, force: true }));
  const id = "2026-08-24-precommit-destination-swap";
  const source = join(root, "code", "app", "docs", "changes", id);
  const destination = getActiveChangePath(id, root);
  await writeChange(source, "in_progress", "source survives readiness failure\n");

  let failure;
  await assert.rejects(
    updateWorkspace(root, {
      workspaceRoot: root,
      migrationOptions: {
        beforeCommitReady: async () => {
          await writeFile(
            join(destination, "tasks.md"),
            tasks("in_review", "concurrent destination\n"),
            "utf8",
          );
        },
      },
    }),
    (error) => {
      failure = error;
      return error.code === "MUTATION_RECOVERY_FAILED";
    },
  );

  assert.notEqual(failure.committed, true);
  assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v2");
  assert.equal(await pathExists(source), true);
  assert.match(await readFile(join(destination, "tasks.md"), "utf8"), /concurrent destination/);
  assert.equal(await pathExists(join(root, ".agents", "skills", "sdd-change")), false);
  assert.ok(failure.details.some((detail) => detail.includes("Central Change destination changed")));

  await rm(destination, { recursive: true });
  await updateFixture(root);
  assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v3");
  assert.equal(await pathExists(getActiveChangePath(id, root)), true);
});

test("update retains a committed migration when its destination changes before cleanup", async (t) => {
  const root = await createFixture({ repositories: ["app"] });
  t.after(() => rm(root, { recursive: true, force: true }));
  const id = "2026-08-24-postcommit-destination-swap";
  const source = join(root, "code", "app", "docs", "changes", id);
  const destination = getActiveChangePath(id, root);
  await writeChange(source, "in_progress", "committed source\n");
  const expectedTasks = await readFile(join(source, "tasks.md"), "utf8");

  let failure;
  await assert.rejects(
    updateWorkspace(root, {
      workspaceRoot: root,
      migrationOptions: {
        beforeFinalizeCleanup: async () => {
          await writeFile(
            join(destination, "tasks.md"),
            tasks("in_review", "postcommit destination\n"),
            "utf8",
          );
        },
      },
    }),
    (error) => {
      failure = error;
      return error.code === "MUTATION_RECOVERY_FAILED";
    },
  );

  assert.equal(failure.committed, true);
  assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v3");
  assert.equal(await pathExists(source), false);
  assert.match(await readFile(join(destination, "tasks.md"), "utf8"), /postcommit destination/);
  assert.equal(await pathExists(join(root, ".agents", "skills", "sdd-change")), true);
  const changesRoot = join(root, ".sdd", "changes");
  assert.equal(
    (await readdir(changesRoot)).filter((entry) => entry.startsWith(".sdd-update-")).length,
    1,
  );

  await writeFile(join(destination, "tasks.md"), expectedTasks, "utf8");
  await updateFixture(root);
  assert.equal(await pathExists(source), false);
  assert.equal(await pathExists(destination), true);
  assert.equal(await readFile(join(destination, "tasks.md"), "utf8"), expectedTasks);
  assert.deepEqual(
    (await readdir(changesRoot)).filter((entry) => entry.startsWith(".sdd-update-")),
    [],
  );
});

test("update preserves managed-install and migration-finalization failures together", async (t) => {
  const root = await createFixture({ repositories: ["app"] });
  const skillsDirectory = join(root, ".agents", "skills");
  let skillsDirectoryRestricted = false;
  t.after(async () => {
    if (skillsDirectoryRestricted) await chmod(skillsDirectory, 0o700).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  const existingSkill = join(skillsDirectory, "sdd-change");
  await mkdir(existingSkill, { recursive: true });
  await writeFile(
    join(existingSkill, "SKILL.md"),
    "locally modified managed skill\n",
    "utf8",
  );
  await writeChange(
    join(root, "code", "app", "docs", "changes", "2026-08-24-dual-finalization-failure"),
    "in_progress",
  );

  let failure;
  await assert.rejects(
    updateWorkspace(root, {
      workspaceRoot: root,
      force: true,
      migrationOptions: {
        beforeSourceRemoval: async () => {
          await chmod(skillsDirectory, 0o500);
          skillsDirectoryRestricted = true;
        },
        beforeSourceBackupDelete: () => {
          throw new Error("injected migration finalization failure");
        },
      },
    }),
    (error) => {
      failure = error;
      return error.code === "MUTATION_RECOVERY_FAILED";
    },
  );

  assert.equal(failure.committed, true);
  assert.equal(failure.errors.length, 2);
  assert.ok(failure.details.some((detail) =>
    detail === "Shared commit finalization [MUTATION_RECOVERY_FAILED]: "
      + "Update migration committed but cleanup was incomplete."));
  assert.ok(failure.details.some((detail) =>
    /^Shared commit finalization detail: Remove migration backup .*: injected migration finalization failure$/
      .test(detail)));
  assert.ok(failure.details.some((detail) =>
    detail.startsWith("Managed skills finalization")
      && detail.includes(".sdd-sync-backup-")));
  const retainedSkillBackup = failure.retainedPaths
    .find((path) => path.includes(".sdd-sync-backup-"));
  assert.ok(retainedSkillBackup);
  assert.equal(await pathExists(retainedSkillBackup), true);

  const changesRoot = join(root, ".sdd", "changes");
  const retainedStaging = (await readdir(changesRoot))
    .filter((entry) => entry.startsWith(".sdd-update-"));
  assert.equal(retainedStaging.length, 1);
  assert.equal(
    await pathExists(join(changesRoot, retainedStaging[0], "transaction.json")),
    true,
  );

  await chmod(skillsDirectory, 0o700);
  skillsDirectoryRestricted = false;
  await updateFixture(root);
  assert.deepEqual(
    (await readdir(changesRoot)).filter((entry) => entry.startsWith(".sdd-update-")),
    [],
  );
});

test("EXDEV migration transfers retain source-derived authority across external owners", async (t) => {
  async function createExternalTopology(testContext, suffix) {
    const root = await createFixture({ repositories: ["app"] });
    const external = await mkdtemp(join(tmpdir(), `sdd-update-exdev-${suffix}-`));
    testContext.after(() => rm(root, { recursive: true, force: true }));
    testContext.after(() => rm(external, { recursive: true, force: true }));
    const planningRoot = join(external, "planning");
    const repositoriesRoot = join(external, "repositories");
    const repositoryRoot = join(repositoriesRoot, "app");
    await mkdir(planningRoot, { recursive: true });
    await writeYaml(
      join(repositoryRoot, ".sdd", "config.yaml"),
      migrateRepositoryConfig(legacyRepositoryConfig("app")).config,
    );
    const config = legacyWorkspaceConfig(["app"]);
    config.repositories.roots.code = repositoriesRoot;
    config.ideas.sample.planningPath = planningRoot;
    await writeYaml(join(root, ".sdd", "config.yaml"), config);
    return {
      root,
      external,
      planningRoot,
      plannedRoot: join(planningRoot, "planned-changes"),
      repositoryRoot,
      repositoryConfigPath: join(repositoryRoot, ".sdd", "config.yaml"),
    };
  }

  function mockedExdev() {
    const error = new Error("mocked cross-device link");
    error.code = "EXDEV";
    return error;
  }

  async function readPendingTransaction(root) {
    const changesRoot = join(root, ".sdd", "changes");
    const entries = (await readdir(changesRoot))
      .filter((entry) => entry.startsWith(".sdd-update-"));
    assert.equal(entries.length, 1);
    const stagingRoot = join(changesRoot, entries[0]);
    return {
      changesRoot,
      stagingRoot,
      journal: JSON.parse(await readFile(join(stagingRoot, "transaction.json"), "utf8")),
    };
  }
  async function briefPublicationProofPaths(stagingRoot, destination, index = 0) {
    const prefix = `${basename(stagingRoot)}-brief-${index}-identity-`;
    return (await readdir(dirname(destination)))
      .filter((name) => name.startsWith(prefix))
      .map((name) => join(dirname(destination), name))
      .sort((left, right) => left.localeCompare(right));
  }
  async function briefStagingProofPaths(stagingRoot, index = 0) {
    const prefix = `.brief-${index}-identity-`;
    return (await readdir(stagingRoot))
      .filter((name) => name.startsWith(prefix))
      .map((name) => join(stagingRoot, name))
      .sort((left, right) => left.localeCompare(right));
  }


  await t.test("external planning, read guards, and brief publication use exclusive verified copies", async (t) => {
    const fixture = await createExternalTopology(t, "success");
    const id = "2026-08-30-cross-volume-success";
    const changeSource = join(fixture.plannedRoot, id);
    const briefSource = join(fixture.plannedRoot, "cross-volume-brief.md");
    const briefDestination = join(
      fixture.planningRoot,
      "change-briefs",
      "cross-volume-brief.md",
    );
    await writeChange(changeSource, "planned", "cross-volume staged Change\n");
    await writeFile(briefSource, "cross-volume brief\n", "utf8");
    const plan = await planUpdateMigration(
      fixture.root,
      await readWorkspaceConfig(fixture.root),
      { destinationWorkspaceRoot: fixture.root },
    );
    assert.ok(plan.readGuards.some((guard) => guard.path === fixture.repositoryConfigPath));
    const stagingPrefix = join(fixture.root, ".sdd", "changes", ".sdd-update-");
    const copied = new Set();
    const linkFile = async (source, target) => {
      let category = null;
      if (target.startsWith(stagingPrefix)
        && basename(target).startsWith(".read-guard-")
        && source === fixture.repositoryConfigPath) {
        category = "read-guard";
      } else if (target.startsWith(stagingPrefix) && source.startsWith(changeSource)) {
        category = "change-staging";
      } else if (target === briefDestination) {
        category = "brief-publication";
      }
      if (category !== null) {
        copied.add(category);
        throw mockedExdev();
      }
      return link(source, target);
    };

    const transaction = await applyUpdateMigration(plan, { linkFile });

    assert.deepEqual(
      [...copied].sort(),
      ["brief-publication", "change-staging", "read-guard"],
    );
    const pending = await readPendingTransaction(fixture.root);
    const guardIndex = pending.journal.readGuards
      .findIndex((guard) => guard.path === fixture.repositoryConfigPath);
    assert.notEqual(guardIndex, -1);
    const guard = pending.journal.readGuards[guardIndex];
    const guardProofPath = join(pending.stagingRoot, `.read-guard-${guardIndex}`);
    const guardProofState = await lstat(guardProofPath);
    assert.deepEqual(guard.proofIdentity, {
      dev: String(guardProofState.dev),
      ino: String(guardProofState.ino),
    });
    assert.notDeepEqual(guard.proofIdentity, guard.identity);
    assert.equal(await hashFile(guardProofPath), guard.hash);
    const briefRecord = pending.journal.briefs
      .find((record) => record.destination === briefDestination);
    assert.ok(briefRecord);
    const briefState = await lstat(briefDestination);
    assert.deepEqual(briefRecord.publishedIdentity, {
      dev: String(briefState.dev),
      ino: String(briefState.ino),
    });
    assert.notDeepEqual(briefRecord.publishedIdentity, briefRecord.stagedIdentity);
    assert.equal(briefRecord.ownerAnchor.logicalPath, fixture.planningRoot);
    const briefProofPaths = await briefPublicationProofPaths(
      pending.stagingRoot,
      briefDestination,
    );
    assert.equal(briefProofPaths.length, 1);
    const briefProofState = await lstat(briefProofPaths[0]);
    assert.deepEqual(briefRecord.publicationProofIdentity, {
      dev: String(briefProofState.dev),
      ino: String(briefProofState.ino),
    });
    assert.equal(briefRecord.publicationProofPhase, "present");
    assert.equal(briefRecord.publicationProofCleanupPath, null);
    assert.equal(briefProofState.dev, briefState.dev);
    assert.equal(briefProofState.ino, briefState.ino);
    assert.equal(await hashFile(briefProofPaths[0]), briefRecord.hash);
    assert.equal(
      await readFile(join(getActiveChangePath(id, fixture.root), "proposal.md"), "utf8"),
      "# Proposal\ncross-volume staged Change\n",
    );
    assert.equal(await readFile(briefDestination, "utf8"), "cross-volume brief\n");

    await finalizeMigrationTransaction(transaction);

    assert.equal(await pathExists(fixture.plannedRoot), false);
    assert.equal(await pathExists(briefProofPaths[0]), false);
    assert.deepEqual(
      (await readdir(join(fixture.root, ".sdd", "changes")))
        .filter((entry) => entry.startsWith(".sdd-update-")),
      [],
    );
    assert.equal(
      (await readRepositoryConfig(fixture.repositoryRoot)).schema,
      "sdd-repository-v2",
    );
  });

  await t.test("restart recovery authenticates copied proofs and copied brief ownership", async (t) => {
    const fixture = await createExternalTopology(t, "recovery");
    const id = "2026-08-30-cross-volume-recovery";
    const changeSource = join(fixture.plannedRoot, id);
    const briefSource = join(fixture.plannedRoot, "recovery-brief.md");
    const briefDestination = join(
      fixture.planningRoot,
      "change-briefs",
      "recovery-brief.md",
    );
    await writeChange(changeSource, "planned", "cross-volume recovery\n");
    await writeFile(briefSource, "cross-volume recovery brief\n", "utf8");
    const stagingPrefix = join(fixture.root, ".sdd", "changes", ".sdd-update-");
    await interruptUpdate(fixture.root, `{
      linkFile: async (source, target) => {
        if (
          target.startsWith(${JSON.stringify(stagingPrefix)})
          || target === ${JSON.stringify(briefDestination)}
        ) {
          const error = new Error("mocked cross-device link");
          error.code = "EXDEV";
          throw error;
        }
        return (await import("node:fs/promises")).link(source, target);
      },
      beforeSourceRename: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);

    const pending = await readPendingTransaction(fixture.root);
    const guardIndex = pending.journal.readGuards
      .findIndex((guard) => guard.path === fixture.repositoryConfigPath);
    assert.notEqual(guardIndex, -1);
    const guard = pending.journal.readGuards[guardIndex];
    const guardProofState = await lstat(join(pending.stagingRoot, `.read-guard-${guardIndex}`));
    assert.deepEqual(guard.proofIdentity, {
      dev: String(guardProofState.dev),
      ino: String(guardProofState.ino),
    });
    assert.notDeepEqual(guard.proofIdentity, guard.identity);
    assert.equal(await pathExists(getActiveChangePath(id, fixture.root)), true);
    assert.equal(await readFile(briefDestination, "utf8"), "cross-volume recovery brief\n");

    const recovery = await recoverUpdateMigration(
      fixture.root,
      { destinationWorkspaceRoot: fixture.root },
    );

    assert.deepEqual(recovery, { recovered: 1 });
    assert.equal(await pathExists(getActiveChangePath(id, fixture.root)), false);
    assert.equal(await pathExists(briefDestination), false);
    assert.equal(await pathExists(changeSource), true);
    assert.equal(await readFile(briefSource, "utf8"), "cross-volume recovery brief\n");
    assert.equal((await readWorkspaceConfig(fixture.root)).schema, "sdd-v2");
    assert.equal(
      (await readRepositoryConfig(fixture.repositoryRoot)).schema,
      "sdd-repository-v2",
    );
    assert.deepEqual(
      (await readdir(join(fixture.root, ".sdd", "changes")))
        .filter((entry) => entry.startsWith(".sdd-update-")),
      [],
    );
  });

  await t.test("restart cleans an owner-bound staged Brief after write before proof persistence", async (t) => {
    const fixture = await createExternalTopology(t, "brief-staging-proof-adoption");
    const briefSource = join(fixture.plannedRoot, "staging-proof-adoption.md");
    const briefDestination = join(
      fixture.planningRoot,
      "change-briefs",
      "staging-proof-adoption.md",
    );
    const briefSourceText = "staged Brief proof adoption\n";
    await mkdir(fixture.plannedRoot, { recursive: true });
    await writeFile(briefSource, briefSourceText, "utf8");

    await interruptUpdate(fixture.root, `{
      afterBriefStagingWriteReceipt: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);

    const pending = await readPendingTransaction(fixture.root);
    const briefRecord = pending.journal.briefs
      .find((record) => record.destination === briefDestination);
    assert.ok(briefRecord);
    assert.equal(briefRecord.phase, "pending");
    assert.equal(briefRecord.stagedIdentity, null);
    assert.equal(briefRecord.stagingProofIdentity, null);
    assert.notEqual(briefRecord.briefIntentIdentity, null);
    assert.equal(briefRecord.stagingBindingIdentity, null);
    const proofPaths = await briefStagingProofPaths(pending.stagingRoot);
    assert.equal(proofPaths.length, 0);
    const intentPath = join(pending.stagingRoot, ".brief-0-ownership-intent");
    const bindingPath = join(pending.stagingRoot, ".brief-0-staging-binding");
    const [stagedState, intentState, bindingState] = await Promise.all([
      lstat(briefRecord.stagedPath),
      lstat(intentPath),
      lstat(bindingPath),
    ]);
    assert.deepEqual(briefRecord.briefIntentIdentity, {
      dev: String(intentState.dev),
      ino: String(intentState.ino),
    });
    const binding = JSON.parse(await readFile(bindingPath, "utf8"));
    assert.deepEqual(binding.targetIdentity, {
      dev: String(stagedState.dev),
      ino: String(stagedState.ino),
    });
    assert.equal(bindingState.isFile(), true);

    assert.deepEqual(
      await recoverUpdateMigration(
        fixture.root,
        { destinationWorkspaceRoot: fixture.root },
      ),
      { recovered: 1 },
    );
    assert.equal(await pathExists(briefSource), true);
    assert.equal(await pathExists(briefDestination), false);
    assert.equal(await pathExists(pending.stagingRoot), false);
    assert.equal(await pathExists(intentPath), false);
    assert.equal(await pathExists(bindingPath), false);
  });

  await t.test("restart rejects a same-byte staged Brief replacement detached from its proof", async (t) => {
    const fixture = await createExternalTopology(t, "brief-staging-proof-replacement");
    const briefSource = join(fixture.plannedRoot, "staging-proof-replacement.md");
    const briefDestination = join(
      fixture.planningRoot,
      "change-briefs",
      "staging-proof-replacement.md",
    );
    const briefSourceText = "same-byte staged Brief replacement\n";
    await mkdir(fixture.plannedRoot, { recursive: true });
    await writeFile(briefSource, briefSourceText, "utf8");

    await interruptUpdate(fixture.root, `{
      afterBriefStagingProof: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);

    const pending = await readPendingTransaction(fixture.root);
    const briefRecord = pending.journal.briefs
      .find((record) => record.destination === briefDestination);
    assert.ok(briefRecord);
    const proofPaths = await briefStagingProofPaths(pending.stagingRoot);
    assert.equal(proofPaths.length, 1);
    const retainedStagedPath = `${briefRecord.stagedPath}-retained`;
    await rename(briefRecord.stagedPath, retainedStagedPath);
    await writeFile(briefRecord.stagedPath, briefSourceText, "utf8");
    const [replacementState, retainedState, proofState] = await Promise.all([
      lstat(briefRecord.stagedPath),
      lstat(retainedStagedPath),
      lstat(proofPaths[0]),
    ]);
    assert.notEqual(replacementState.ino, proofState.ino);
    assert.equal(retainedState.dev, proofState.dev);
    assert.equal(retainedState.ino, proofState.ino);

    await assert.rejects(
      recoverUpdateMigration(
        fixture.root,
        { destinationWorkspaceRoot: fixture.root },
      ),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(briefRecord.stagedPath, "utf8"), briefSourceText);
    assert.equal(await readFile(retainedStagedPath, "utf8"), briefSourceText);
    assert.equal(await readFile(proofPaths[0], "utf8"), briefSourceText);
    assert.equal(await pathExists(briefDestination), false);
  });

  await t.test("restart adopts an EXDEV Brief proof after target write before journal persistence", async (t) => {
    const fixture = await createExternalTopology(t, "brief-proof-adoption");
    const briefSource = join(fixture.plannedRoot, "proof-adoption.md");
    const briefDestination = join(
      fixture.planningRoot,
      "change-briefs",
      "proof-adoption.md",
    );
    const briefSourceText = "copied Brief proof adoption\n";
    await mkdir(fixture.plannedRoot, { recursive: true });
    await writeFile(briefSource, briefSourceText, "utf8");

    await interruptUpdate(fixture.root, `{
      linkFile: async (source, target) => {
        if (target === ${JSON.stringify(briefDestination)}) {
          const error = new Error("mocked cross-device link");
          error.code = "EXDEV";
          throw error;
        }
        return (await import("node:fs/promises")).link(source, target);
      },
      afterBriefPublicationProof: ({ method }) => {
        if (method !== "copy") throw new Error("Brief did not use the copy path");
        process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
      },
    }`);

    const pending = await readPendingTransaction(fixture.root);
    const briefRecord = pending.journal.briefs
      .find((record) => record.destination === briefDestination);
    assert.ok(briefRecord);
    assert.equal(briefRecord.phase, "prepared");
    assert.equal(briefRecord.published, false);
    assert.equal(briefRecord.publishedIdentity, null);
    assert.equal(briefRecord.publicationProofPhase, "pending");
    assert.equal(briefRecord.publicationProofIdentity, null);
    const proofPaths = await briefPublicationProofPaths(
      pending.stagingRoot,
      briefDestination,
    );
    assert.equal(proofPaths.length, 1);
    const [destinationState, proofState] = await Promise.all([
      lstat(briefDestination),
      lstat(proofPaths[0]),
    ]);
    assert.equal(destinationState.dev, proofState.dev);
    assert.equal(destinationState.ino, proofState.ino);
    assert.equal(await readFile(proofPaths[0], "utf8"), briefSourceText);

    assert.deepEqual(
      await recoverUpdateMigration(
        fixture.root,
        { destinationWorkspaceRoot: fixture.root },
      ),
      { recovered: 1 },
    );

    assert.equal(await pathExists(briefDestination), false);
    assert.equal(await pathExists(proofPaths[0]), false);
    assert.equal(await readFile(briefSource, "utf8"), briefSourceText);
    assert.deepEqual(
      (await readdir(join(fixture.root, ".sdd", "changes")))
        .filter((entry) => entry.startsWith(".sdd-update-")),
      [],
    );
  });

  await t.test("recovery rejects a same-byte live read-guard source replacement", async (t) => {
    const fixture = await createExternalTopology(t, "read-guard-source-swap");
    const briefSource = join(fixture.plannedRoot, "read-guard-source-swap.md");
    const retainedConfig = join(fixture.external, "retained-repository-config.yaml");
    await mkdir(fixture.plannedRoot, { recursive: true });
    await writeFile(briefSource, "read guard source swap\n", "utf8");
    const stagingPrefix = join(fixture.root, ".sdd", "changes", ".sdd-update-");
    await interruptUpdate(fixture.root, `{
      linkFile: async (source, target) => {
        if (
          source === ${JSON.stringify(fixture.repositoryConfigPath)}
          && target.startsWith(${JSON.stringify(stagingPrefix)})
        ) {
          const error = new Error("mocked cross-device link");
          error.code = "EXDEV";
          throw error;
        }
        return (await import("node:fs/promises")).link(source, target);
      },
      beforeBriefLink: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);
    const configBytes = await readFile(fixture.repositoryConfigPath);
    await rename(fixture.repositoryConfigPath, retainedConfig);
    await writeFile(fixture.repositoryConfigPath, configBytes);

    await assert.rejects(
      recoverUpdateMigration(fixture.root, { destinationWorkspaceRoot: fixture.root }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );

    assert.deepEqual(await readFile(fixture.repositoryConfigPath), configBytes);
    assert.deepEqual(await readFile(retainedConfig), configBytes);
    const [replacementState, retainedState] = await Promise.all([
      lstat(fixture.repositoryConfigPath),
      lstat(retainedConfig),
    ]);
    assert.notDeepEqual(
      { dev: String(replacementState.dev), ino: String(replacementState.ino) },
      { dev: String(retainedState.dev), ino: String(retainedState.ino) },
    );
    assert.equal(await readFile(briefSource, "utf8"), "read guard source swap\n");
    await readPendingTransaction(fixture.root);
  });

  await t.test("committed cleanup fails closed when an external receipt outlives source authority", async (t) => {
    const fixture = await createExternalTopology(t, "source-receipt-restart");
    const plannedId = "2026-08-30-receipt-planned";
    const repositoryId = "2026-08-30-receipt-repository";
    const plannedSource = join(fixture.plannedRoot, plannedId);
    const repositorySource = join(
      fixture.repositoryRoot,
      "docs",
      "changes",
      repositoryId,
    );
    await writeChange(plannedSource, "planned", "receipt planned source\n");
    await writeChange(repositorySource, "in_progress", "receipt repository source\n");

    await interruptUpdate(fixture.root, `{
      beforeSourceBackupDelete: (() => {
        let calls = 0;
        return () => {
          calls += 1;
          if (calls === 2) process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
        };
      })(),
    }`, { finalize: true });

    const pending = await readPendingTransaction(fixture.root);
    assert.equal(pending.journal.status, "committed");
    assert.equal(typeof pending.journal.sourceDerivedDestinationGuards, "string");
    const cleanedRecords = pending.journal.sources.filter((record) => record.phase === "cleaned");
    const remainingRecords = pending.journal.sources.filter((record) => record.phase === "removed");
    assert.equal(cleanedRecords.length, 1);
    assert.equal(remainingRecords.length, 1);
    assert.equal(await pathExists(cleanedRecords[0].backup), false);
    assert.equal(await pathExists(remainingRecords[0].backup), true);

    const receiptName = "source-derived-destinations";
    const retainedReceiptPaths = [
      join(pending.stagingRoot, `${receiptName}.json`),
      join(
        fixture.root,
        ".sdd",
        `${basename(pending.stagingRoot)}-${receiptName}`,
      ),
      join(
        fixture.root,
        ".sdd",
        `${basename(pending.stagingRoot)}-${receiptName}.digest`,
      ),
    ];
    const receiptBytes = await Promise.all(
      retainedReceiptPaths.map((path) => readFile(path)),
    );
    const remainingBackupHashes = await Promise.all(
      remainingRecords.map((record) => hashDirectory(record.backup)),
    );
    const stagingHash = await hashDirectory(pending.stagingRoot);
    const sourcePresence = await Promise.all(
      pending.journal.sources.map((record) => pathExists(record.physicalPath)),
    );

    await assert.rejects(
      recoverUpdateMigration(fixture.root, { destinationWorkspaceRoot: fixture.root }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED"
        && error.details.some((detail) =>
          detail.includes("cannot reconstruct the complete source-derived destination guard set")),
    );

    assert.equal(await hashDirectory(pending.stagingRoot), stagingHash);
    for (const [index, record] of remainingRecords.entries()) {
      assert.equal(await hashDirectory(record.backup), remainingBackupHashes[index]);
    }
    for (const [index, path] of retainedReceiptPaths.entries()) {
      assert.deepEqual(await readFile(path), receiptBytes[index]);
    }
    for (const [index, record] of pending.journal.sources.entries()) {
      assert.equal(await pathExists(record.physicalPath), sourcePresence[index]);
    }
    assert.equal(await pathExists(getActiveChangePath(plannedId, fixture.root)), true);
    assert.equal(await pathExists(getActiveChangePath(repositoryId, fixture.root)), true);
    assert.equal(await pathExists(pending.stagingRoot), true);
  });
  await t.test("restart adopts an authenticated receipt journal candidate", async (t) => {
    const fixture = await createExternalTopology(t, "receipt-candidate");
    const briefSource = join(fixture.plannedRoot, "receipt-candidate.md");
    await mkdir(fixture.plannedRoot, { recursive: true });
    await writeFile(briefSource, "receipt candidate source\n", "utf8");

    await interruptUpdate(fixture.root, `{
      beforeTransactionJournalReplace: async ({ temporaryPath }) => {
        const candidate = JSON.parse(
          await (await import("node:fs/promises")).readFile(temporaryPath, "utf8"),
        );
        if (candidate.sourceDerivedDestinationGuards !== null) {
          process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
        }
      },
    }`);

    const pending = await readPendingTransaction(fixture.root);
    assert.equal(pending.journal.sourceDerivedDestinationGuards, null);
    assert.equal(
      await pathExists(join(pending.stagingRoot, "source-derived-destinations.json")),
      true,
    );
    assert.deepEqual(
      await recoverUpdateMigration(fixture.root, { destinationWorkspaceRoot: fixture.root }),
      { recovered: 1 },
    );
    assert.equal(await readFile(briefSource, "utf8"), "receipt candidate source\n");
    assert.deepEqual(
      (await readdir(join(fixture.root, ".sdd", "changes")))
        .filter((entry) => entry.startsWith(".sdd-update-")),
      [],
    );
  });


  await t.test("a same-byte source inode swap prevents copy publication", async (t) => {
    const fixture = await createExternalTopology(t, "source-swap");
    const id = "2026-08-30-cross-volume-source-swap";
    const changeSource = join(fixture.plannedRoot, id);
    await writeChange(changeSource, "planned", "same bytes, new inode\n");
    const sourceFile = join(changeSource, "proposal.md");
    const sourceBytes = await readFile(sourceFile);
    const retainedOriginal = join(fixture.external, "retained-original-proposal.md");
    const stagingPrefix = join(fixture.root, ".sdd", "changes", ".sdd-update-");
    let swapped = false;
    const plan = await planUpdateMigration(
      fixture.root,
      await readWorkspaceConfig(fixture.root),
      { destinationWorkspaceRoot: fixture.root },
    );

    await assert.rejects(
      applyUpdateMigration(plan, {
        linkFile: async (source, target) => {
          if (!swapped && source === sourceFile && target.startsWith(stagingPrefix)) {
            swapped = true;
            await rename(sourceFile, retainedOriginal);
            await writeFile(sourceFile, sourceBytes);
            throw mockedExdev();
          }
          return link(source, target);
        },
      }),
      (error) => error.code === "CONCURRENT_CHANGE",
    );

    assert.equal(swapped, true);
    assert.deepEqual(await readFile(sourceFile), sourceBytes);
    assert.deepEqual(await readFile(retainedOriginal), sourceBytes);
    const [sourceState, retainedState] = await Promise.all([
      lstat(sourceFile),
      lstat(retainedOriginal),
    ]);
    assert.notDeepEqual(
      { dev: String(sourceState.dev), ino: String(sourceState.ino) },
      { dev: String(retainedState.dev), ino: String(retainedState.ino) },
    );
    assert.equal(await pathExists(getActiveChangePath(id, fixture.root)), false);
    assert.deepEqual(
      (await readdir(join(fixture.root, ".sdd", "changes")))
        .filter((entry) => entry.startsWith(".sdd-update-")),
      [],
    );
  });

  await t.test("a concurrent same-byte brief destination remains opaque after EXDEV", async (t) => {
    const fixture = await createExternalTopology(t, "destination-race");
    const briefSource = join(fixture.plannedRoot, "same-byte-destination.md");
    const briefDestination = join(
      fixture.planningRoot,
      "change-briefs",
      "same-byte-destination.md",
    );
    const briefSourceText = "same-byte concurrent destination\n";
    await mkdir(fixture.plannedRoot, { recursive: true });
    await writeFile(briefSource, briefSourceText, "utf8");
    const plan = await planUpdateMigration(
      fixture.root,
      await readWorkspaceConfig(fixture.root),
      { destinationWorkspaceRoot: fixture.root },
    );
    let linkAttempted = false;

    await assert.rejects(
      applyUpdateMigration(plan, {
        beforeBriefLink: async () => {
          await writeFile(briefDestination, briefSourceText, "utf8");
        },
        linkFile: async (source, target) => {
          if (target === briefDestination) {
            linkAttempted = true;
            throw mockedExdev();
          }
          return link(source, target);
        },
      }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );

    assert.equal(linkAttempted, true);
    assert.equal(await readFile(briefDestination, "utf8"), briefSourceText);
    assert.equal(await readFile(briefSource, "utf8"), briefSourceText);
    const pending = await readPendingTransaction(fixture.root);
    const briefRecord = pending.journal.briefs
      .find((record) => record.destination === briefDestination);
    assert.ok(briefRecord);
    assert.equal(briefRecord.publishedIdentity, null);
    const destinationState = await lstat(briefDestination);
    assert.notDeepEqual(briefRecord.stagedIdentity, {
      dev: String(destinationState.dev),
      ino: String(destinationState.ino),
    });
  });

  await t.test("a same-byte replacement after copied publication blocks source retirement", async (t) => {
    const fixture = await createExternalTopology(t, "post-publication-swap");
    const briefSource = join(fixture.plannedRoot, "post-publication-swap.md");
    const briefDestination = join(
      fixture.planningRoot,
      "change-briefs",
      "post-publication-swap.md",
    );
    const retainedPublished = `${briefDestination}-published`;
    const briefSourceText = "same bytes after publication\n";
    await mkdir(fixture.plannedRoot, { recursive: true });
    await writeFile(briefSource, briefSourceText, "utf8");
    const plan = await planUpdateMigration(
      fixture.root,
      await readWorkspaceConfig(fixture.root),
      { destinationWorkspaceRoot: fixture.root },
    );
    let swapped = false;

    await assert.rejects(
      applyUpdateMigration(plan, {
        linkFile: async (source, target) => {
          if (target === briefDestination) throw mockedExdev();
          return link(source, target);
        },
        beforeSourceRemoval: async () => {
          swapped = true;
          await rename(briefDestination, retainedPublished);
          await writeFile(briefDestination, briefSourceText, "utf8");
        },
      }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );

    assert.equal(swapped, true);
    assert.equal(await readFile(briefDestination, "utf8"), briefSourceText);
    assert.equal(await readFile(retainedPublished, "utf8"), briefSourceText);
    assert.equal(await readFile(briefSource, "utf8"), briefSourceText);
    const pending = await readPendingTransaction(fixture.root);
    const briefRecord = pending.journal.briefs
      .find((record) => record.destination === briefDestination);
    assert.ok(briefRecord);
    const [replacementState, publishedState] = await Promise.all([
      lstat(briefDestination),
      lstat(retainedPublished),
    ]);
    assert.deepEqual(briefRecord.publishedIdentity, {
      dev: String(publishedState.dev),
      ino: String(publishedState.ino),
    });
    assert.notDeepEqual(briefRecord.publishedIdentity, {
      dev: String(replacementState.dev),
      ino: String(replacementState.ino),
    });
  });

  await t.test("an owner-bound receipt rejects coherent same-byte Brief proof and journal forgery", async (t) => {
    const fixture = await createExternalTopology(t, "forged-brief-publication-identity");
    const briefSource = join(fixture.plannedRoot, "forged-publication-identity.md");
    const briefDestination = join(
      fixture.planningRoot,
      "change-briefs",
      "forged-publication-identity.md",
    );
    const retainedPublished = `${briefDestination}-transaction-published`;
    const briefSourceText = "same bytes with forged journal identity\n";
    await mkdir(fixture.plannedRoot, { recursive: true });
    await writeFile(briefSource, briefSourceText, "utf8");

    await interruptUpdate(fixture.root, `{
      linkFile: async (source, target) => {
        if (target === ${JSON.stringify(briefDestination)}) {
          const error = new Error("mocked cross-device link");
          error.code = "EXDEV";
          throw error;
        }
        return (await import("node:fs/promises")).link(source, target);
      },
      beforeSourceRemoval: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);

    const pending = await readPendingTransaction(fixture.root);
    const briefRecord = pending.journal.briefs
      .find((record) => record.destination === briefDestination);
    assert.ok(briefRecord);
    assert.equal(briefRecord.phase, "verified");
    assert.equal(briefRecord.publicationProofPhase, "present");
    const proofPaths = await briefPublicationProofPaths(
      pending.stagingRoot,
      briefDestination,
    );
    assert.equal(proofPaths.length, 1);
    const originalDestinationState = await lstat(briefDestination);
    const proofState = await lstat(proofPaths[0]);
    assert.equal(originalDestinationState.dev, proofState.dev);
    assert.equal(originalDestinationState.ino, proofState.ino);

    await rename(briefDestination, retainedPublished);
    await writeFile(briefDestination, briefSourceText, "utf8");
    const replacementState = await lstat(briefDestination);
    assert.notEqual(replacementState.ino, originalDestinationState.ino);
    const forgedPublishedIdentity = {
      dev: String(replacementState.dev),
      ino: String(replacementState.ino),
    };
    await rm(proofPaths[0]);
    const forgedProofPath = join(
      dirname(briefDestination),
      `${basename(pending.stagingRoot)}-brief-0-identity-${forgedPublishedIdentity.dev}-${forgedPublishedIdentity.ino}.proof`,
    );
    await link(briefDestination, forgedProofPath);
    await mutateInterruptedJournal(fixture.root, (journal) => {
      journal.briefs[0].publishedIdentity = forgedPublishedIdentity;
      journal.briefs[0].publicationProofIdentity = forgedPublishedIdentity;
    });

    await assert.rejects(
      recoverUpdateMigration(
        fixture.root,
        { destinationWorkspaceRoot: fixture.root },
      ),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );

    assert.equal(await readFile(briefDestination, "utf8"), briefSourceText);
    assert.equal(await readFile(retainedPublished, "utf8"), briefSourceText);
    assert.equal(await readFile(forgedProofPath, "utf8"), briefSourceText);
    assert.equal(await readFile(briefSource, "utf8"), briefSourceText);
    const forgedProofState = await lstat(forgedProofPath);
    assert.equal(replacementState.dev, forgedProofState.dev);
    assert.equal(replacementState.ino, forgedProofState.ino);
    assert.equal(await pathExists(pending.stagingRoot), true);
  });

  await t.test("rollback proof cleanup rejects a published inode relinked to its destination", async (t) => {
    const fixture = await createExternalTopology(t, "brief-proof-relink");
    const briefSource = join(fixture.plannedRoot, "proof-relink.md");
    const briefDestination = join(
      fixture.planningRoot,
      "change-briefs",
      "proof-relink.md",
    );
    const briefSourceText = "rollback proof relink\n";
    await mkdir(fixture.plannedRoot, { recursive: true });
    await writeFile(briefSource, briefSourceText, "utf8");

    await interruptUpdate(fixture.root, `{
      linkFile: async (source, target) => {
        if (target === ${JSON.stringify(briefDestination)}) {
          const error = new Error("mocked cross-device link");
          error.code = "EXDEV";
          throw error;
        }
        return (await import("node:fs/promises")).link(source, target);
      },
      beforeSourceRemoval: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);

    const pending = await readPendingTransaction(fixture.root);
    const proofPaths = await briefPublicationProofPaths(
      pending.stagingRoot,
      briefDestination,
    );
    assert.equal(proofPaths.length, 1);
    await rm(briefDestination);
    await rename(proofPaths[0], briefDestination);
    await mutateInterruptedJournal(fixture.root, (journal) => {
      journal.status = "rolling-back";
      journal.briefs[0].phase = "removed";
      journal.briefs[0].publicationProofPhase = "cleaning";
    });

    await assert.rejects(
      recoverUpdateMigration(
        fixture.root,
        { destinationWorkspaceRoot: fixture.root },
      ),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(briefDestination, "utf8"), briefSourceText);
    assert.equal(await pathExists(proofPaths[0]), false);
    assert.equal(await readFile(briefSource, "utf8"), briefSourceText);
    assert.equal(await pathExists(pending.stagingRoot), true);
  });

  await t.test("rollback rejects a published Brief inode relinked after proof removal", async (t) => {
    const fixture = await createExternalTopology(t, "brief-post-proof-relink");
    const briefSource = join(fixture.plannedRoot, "post-proof-relink.md");
    const briefDestination = join(
      fixture.planningRoot,
      "change-briefs",
      "post-proof-relink.md",
    );
    const retainedPublished = join(fixture.root, "retained-post-proof-brief.md");
    const briefSourceText = "rollback post-proof relink\n";
    await mkdir(fixture.plannedRoot, { recursive: true });
    await writeFile(briefSource, briefSourceText, "utf8");

    await interruptUpdate(fixture.root, `{
      linkFile: async (source, target) => {
        if (target === ${JSON.stringify(briefDestination)}) {
          const error = new Error("mocked cross-device link");
          error.code = "EXDEV";
          throw error;
        }
        return (await import("node:fs/promises")).link(source, target);
      },
      beforeSourceRemoval: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);

    const pending = await readPendingTransaction(fixture.root);
    const proofPaths = await briefPublicationProofPaths(
      pending.stagingRoot,
      briefDestination,
    );
    assert.equal(proofPaths.length, 1);
    await link(briefDestination, retainedPublished);
    await rm(briefDestination);
    await rm(proofPaths[0]);
    await link(retainedPublished, briefDestination);
    await mutateInterruptedJournal(fixture.root, (journal) => {
      journal.status = "rolling-back";
      journal.briefs[0].phase = "removed";
      journal.briefs[0].publicationProofIdentity = null;
      journal.briefs[0].publicationProofCleanupPath = null;
      journal.briefs[0].publicationProofCleanupIdentity = null;
      journal.briefs[0].publicationProofPhase = "removed";
    });

    await assert.rejects(
      recoverUpdateMigration(
        fixture.root,
        { destinationWorkspaceRoot: fixture.root },
      ),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(briefDestination, "utf8"), briefSourceText);
    assert.equal(await readFile(retainedPublished, "utf8"), briefSourceText);
    assert.equal(await readFile(briefSource, "utf8"), briefSourceText);
    assert.equal(await pathExists(pending.stagingRoot), true);
  });

  await t.test("a swapped Change Brief ancestor cannot redirect publication or rollback", async (t) => {
    const fixture = await createExternalTopology(t, "ancestor-swap");
    const decoy = await mkdtemp(join(tmpdir(), "sdd-update-brief-decoy-"));
    t.after(() => rm(decoy, { recursive: true, force: true }));
    const briefSource = join(fixture.plannedRoot, "ancestor-swap.md");
    const briefDestination = join(
      fixture.planningRoot,
      "change-briefs",
      "ancestor-swap.md",
    );
    const briefRoot = dirname(briefDestination);
    const retainedBriefRoot = `${briefRoot}-retained`;
    await mkdir(fixture.plannedRoot, { recursive: true });
    await writeFile(briefSource, "ancestor swap source\n", "utf8");
    const plan = await planUpdateMigration(
      fixture.root,
      await readWorkspaceConfig(fixture.root),
      { destinationWorkspaceRoot: fixture.root },
    );
    let linkAttempted = false;

    await assert.rejects(
      applyUpdateMigration(plan, {
        beforeBriefLink: async () => {
          await rename(briefRoot, retainedBriefRoot);
          await symlink(decoy, briefRoot);
        },
        linkFile: async (source, target) => {
          if (target === briefDestination) {
            linkAttempted = true;
            throw mockedExdev();
          }
          return link(source, target);
        },
      }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );

    assert.equal(linkAttempted, false);
    assert.deepEqual(await readdir(decoy), []);
    assert.equal(await pathExists(briefDestination), false);
    assert.equal(await readFile(briefSource, "utf8"), "ancestor swap source\n");
    assert.equal((await lstat(briefRoot)).isSymbolicLink(), true);
    assert.equal((await lstat(retainedBriefRoot)).isDirectory(), true);
    await readPendingTransaction(fixture.root);
  });

  await t.test("an EXDEV link race cannot redirect copy fallback through a swapped ancestor", async (t) => {
    const fixture = await createExternalTopology(t, "exdev-ancestor-race");
    const decoy = await mkdtemp(join(tmpdir(), "sdd-update-brief-exdev-decoy-"));
    t.after(() => rm(decoy, { recursive: true, force: true }));
    const briefSource = join(fixture.plannedRoot, "exdev-ancestor-race.md");
    const briefDestination = join(
      fixture.planningRoot,
      "change-briefs",
      "exdev-ancestor-race.md",
    );
    const briefRoot = dirname(briefDestination);
    const retainedBriefRoot = `${briefRoot}-retained`;
    await mkdir(fixture.plannedRoot, { recursive: true });
    await writeFile(briefSource, "EXDEV ancestor race source\n", "utf8");
    const plan = await planUpdateMigration(
      fixture.root,
      await readWorkspaceConfig(fixture.root),
      { destinationWorkspaceRoot: fixture.root },
    );
    let linkAttempted = false;

    await assert.rejects(
      applyUpdateMigration(plan, {
        linkFile: async (source, target) => {
          if (target === briefDestination) {
            linkAttempted = true;
            await rename(briefRoot, retainedBriefRoot);
            await symlink(decoy, briefRoot);
            throw mockedExdev();
          }
          return link(source, target);
        },
      }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );

    assert.equal(linkAttempted, true);
    assert.deepEqual(await readdir(decoy), []);
    assert.equal(await pathExists(briefDestination), false);
    assert.equal(await readFile(briefSource, "utf8"), "EXDEV ancestor race source\n");
    assert.equal((await lstat(briefRoot)).isSymbolicLink(), true);
    assert.equal((await lstat(retainedBriefRoot)).isDirectory(), true);
    await readPendingTransaction(fixture.root);
  });
});

test("copy ledgers recover staged and source-backup EXDEV interruptions", async (t) => {
  const exdevLinkSource = `async (source, target) => {
    if (target.includes(".change-stage-") || target.includes(".sdd-migration-")) {
      const error = new Error("forced EXDEV");
      error.code = "EXDEV";
      throw error;
    }
    const { link } = await import("node:fs/promises");
    return link(source, target);
  }`;

  for (const timing of ["before", "after"]) {
    await t.test(`staged copy recovers when interrupted ${timing} its first file`, async (t) => {
      const root = await createFixture({ repositories: ["app"] });
      t.after(() => rm(root, { recursive: true, force: true }));
      const id = `2026-08-25-stage-copy-${timing}`;
      const source = join(root, "code", "app", "docs", "changes", id);
      const destination = getActiveChangePath(id, root);
      await writeChange(source, "in_progress", `stage copy ${timing}\n`);
      const hookName = timing === "before"
        ? "beforeChangeStagingCopyEntry"
        : "afterChangeStagingCopyEntry";

      await interruptUpdate(root, `{
        linkFile: ${exdevLinkSource},
        ${hookName}: (() => {
          let interrupted = false;
          return ({ type }) => {
            if (!interrupted && type === "file") {
              interrupted = true;
              process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
            }
          };
        })(),
      }`);
      const transaction = await mutateInterruptedJournal(root, () => {});
      const change = transaction.journal.changes[0];
      assert.equal(change.phase, "copying");
      assert.equal(typeof change.copyRoot, "string");
      assert.equal(typeof change.copySourceRoot, "string");
      assert.ok(change.copyTargetManifest.length >= 1);
      if (timing === "before") {
        assert.equal(change.copyIntent.type, "file");
      } else {
        assert.equal(change.copyIntent, null);
        assert.equal(
          change.copyTargetManifest.some((entry) => entry.type === "file"),
          true,
        );
      }

      const recovered = await updateFixture(root);
      assert.equal(recovered.migration.required, true);
      assert.equal(await pathExists(source), false);
      assert.equal(await pathExists(destination), true);
      assert.equal(await pathExists(transaction.stagingRoot), false);
    });
  }

  await t.test("staged copy adopts external child proof written before its journal entry", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-25-stage-copy-proof-window";
    const source = join(root, "code", "app", "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    await writeChange(source, "in_progress", "stage copy proof window\n");

    await interruptUpdate(root, `{
      afterChangeCopyTargetProvenance: ({ record, sourceEntry }) => {
        if (record.phase === "copying" && sourceEntry.type === "file") {
          process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
        }
      },
    }`);
    const transaction = await readPendingTransaction(root);
    const change = transaction.journal.changes[0];
    assert.equal(change.phase, "copying");
    assert.equal(change.copyIntent.type, "file");
    assert.equal(
      change.copyTargetManifest.some((entry) => entry.relativePath === change.copyIntent.relativePath),
      false,
    );
    assert.equal(
      (await readdir(transaction.stagingRoot))
        .some((entry) => entry.startsWith(`.change-copy-provenance-${change.ownerToken}-`)),
      true,
    );

    const recovered = await updateFixture(root);
    assert.equal(recovered.migration.required, true);
    assert.equal(await pathExists(source), false);
    assert.equal(await pathExists(destination), true);
    assert.equal(await pathExists(transaction.stagingRoot), false);
  });

  await t.test("staged copy with missing external child proof fails closed", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-25-stage-copy-missing-proof";
    const source = join(root, "code", "app", "docs", "changes", id);
    await writeChange(source, "in_progress", "stage copy missing proof\n");

    await interruptUpdate(root, `{
      afterChangeCopyTargetProvenance: ({ record, sourceEntry }) => {
        if (record.phase === "copying" && sourceEntry.type === "file") {
          process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
        }
      },
    }`);
    const transaction = await readPendingTransaction(root);
    const change = transaction.journal.changes[0];
    const proofPrefix = `.change-copy-provenance-${change.ownerToken}-`;
    const targetProof = (await readdir(transaction.stagingRoot))
      .find((entry) => entry.startsWith(proofPrefix) && entry.endsWith(".target"));
    assert.equal(typeof targetProof, "string");
    await rm(join(transaction.stagingRoot, targetProof));

    await assert.rejects(
      updateFixture(root),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await pathExists(source), true);
    assert.equal(await pathExists(change.copyRoot), true);
    assert.equal(await pathExists(transaction.journalPath), true);
  });

  await t.test("same-byte replacement cannot claim an externally proven staged child", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-25-stage-copy-proof-replacement";
    const source = join(root, "code", "app", "docs", "changes", id);
    await writeChange(source, "in_progress", "stage copy proof replacement\n");

    await interruptUpdate(root, `{
      afterChangeCopyTargetProvenance: ({ record, sourceEntry }) => {
        if (record.phase === "copying" && sourceEntry.type === "file") {
          process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
        }
      },
    }`);
    const transaction = await readPendingTransaction(root);
    const change = transaction.journal.changes[0];
    const target = join(change.copyRoot, change.copyIntent.relativePath);
    const retained = `${target}-transaction-created`;
    const bytes = await readFile(target);
    await rename(target, retained);
    await writeFile(target, bytes);

    await assert.rejects(
      updateFixture(root),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.deepEqual(await readFile(target), bytes);
    assert.deepEqual(await readFile(retained), bytes);
    const [replacementState, retainedState] = await Promise.all([
      lstat(target),
      lstat(retained),
    ]);
    assert.notDeepEqual(
      { dev: String(replacementState.dev), ino: String(replacementState.ino) },
      { dev: String(retainedState.dev), ino: String(retainedState.ino) },
    );
    assert.equal(await pathExists(transaction.journalPath), true);
  });

  await t.test("forged journal identity cannot claim a replaced staged directory", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-25-stage-directory-proof-replacement";
    const source = join(root, "code", "app", "docs", "changes", id);
    const nestedSource = join(source, "evidence");
    await writeChange(source, "in_progress", "directory proof replacement\n");
    await mkdir(nestedSource);
    await writeFile(join(nestedSource, "note.txt"), "nested evidence\n", "utf8");

    await interruptUpdate(root, `{
      afterChangeCopyTargetProvenance: ({ record, sourceEntry }) => {
        if (
          record.phase === "copying"
          && sourceEntry.type === "directory"
          && sourceEntry.relativePath === "evidence"
        ) {
          process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
        }
      },
    }`);
    let transaction = await readPendingTransaction(root);
    const change = transaction.journal.changes[0];
    const target = join(change.copyRoot, "evidence");
    const retained = `${target}-transaction-created`;
    await rename(target, retained);
    await mkdir(target);
    const replacementState = await lstat(target);
    const replacementIdentity = {
      dev: String(replacementState.dev),
      ino: String(replacementState.ino),
    };
    transaction = await mutateInterruptedJournal(root, (journal) => {
      const record = journal.changes[0];
      const index = record.copySourceManifest
        .findIndex((entry) => entry.relativePath === "evidence");
      record.copyTargetProvenance.push({
        token: record.copyProvenanceToken,
        index,
        relativePath: "evidence",
        type: "directory",
        mode: record.copySourceManifest[index].mode,
        targetIdentity: replacementIdentity,
      });
      record.copyTargetManifest.push({
        relativePath: "evidence",
        type: "directory",
        identity: replacementIdentity,
        mode: record.copySourceManifest[index].mode,
        hash: null,
        target: null,
        quarantineRelativePath: null,
      });
      record.copyIntent = null;
    });

    await assert.rejects(
      updateFixture(root),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal((await lstat(target)).isDirectory(), true);
    assert.equal((await lstat(retained)).isDirectory(), true);
    assert.equal(await pathExists(transaction.journalPath), true);
  });

  await t.test("raw tasks canonicalization recovers after its owner proof exposure", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-25-tasks-owner-proof-window";
    const source = join(root, "code", "app", "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    await writeChange(source, "in_progress", "canonical owner proof window\n");

    await interruptUpdate(root, `{
      afterStagedTasksCanonicalProof: ({ stage }) => {
        if (stage === "owner") process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
      },
    }`);
    const transaction = await readPendingTransaction(root);
    const change = transaction.journal.changes[0];
    assert.equal(change.tasksCanonicalizationPhase, "quarantined");
    assert.equal(change.proofIdentity, null);
    assert.equal(await pathExists(change.proofPath), false);
    assert.equal(
      (await readdir(transaction.stagingRoot))
        .some((entry) => entry.startsWith(".change-tasks-canonical-owner-")),
      true,
    );

    const recovered = await updateFixture(root);
    assert.equal(recovered.migration.required, true);
    assert.equal(await pathExists(source), false);
    assert.equal(await pathExists(destination), true);
    assert.equal(await pathExists(transaction.stagingRoot), false);
  });

  await t.test("raw tasks canonicalization completes a source proof interrupted before its receipt", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-25-tasks-source-proof-window";
    const source = join(root, "code", "app", "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    await writeChange(source, "in_progress", "canonical source proof window\n");

    await interruptUpdate(root, `{
      afterStagedTasksCanonicalProof: ({ stage }) => {
        if (stage === "source") process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
      },
    }`);
    const transaction = await readPendingTransaction(root);
    const change = transaction.journal.changes[0];
    assert.equal(change.tasksCanonicalizationPhase, "quarantined");
    assert.equal(change.proofIdentity, null);
    assert.equal(await pathExists(change.proofPath), true);
    assert.equal(
      (await readdir(transaction.stagingRoot))
        .some((entry) => entry.startsWith(".change-tasks-canonical-proof-")),
      false,
    );

    const recovered = await updateFixture(root);
    assert.equal(recovered.migration.required, true);
    assert.equal(await pathExists(source), false);
    assert.equal(await pathExists(destination), true);
    assert.equal(await pathExists(transaction.stagingRoot), false);
  });

  await t.test("raw tasks canonicalization adopts its external proof before journal persistence", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-25-tasks-canonical-proof-window";
    const source = join(root, "code", "app", "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    await writeChange(source, "in_progress", "canonical proof window\n");

    await interruptUpdate(root, `{
      afterStagedTasksCanonicalProof: ({ stage }) => {
        if (stage === "complete") process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
      },
    }`);
    const transaction = await readPendingTransaction(root);
    const change = transaction.journal.changes[0];
    assert.equal(change.phase, "copying");
    assert.equal(change.tasksCanonicalizationPhase, "quarantined");
    assert.equal(change.tasksCanonicalizationIdentity, null);
    assert.equal(change.proofIdentity, null);
    assert.equal(await pathExists(change.proofPath), true);
    assert.equal(
      (await readdir(transaction.stagingRoot))
        .some((entry) => entry.startsWith(".change-tasks-canonical-proof-")),
      true,
    );

    const recovered = await updateFixture(root);
    assert.equal(recovered.migration.required, true);
    assert.equal(await pathExists(source), false);
    assert.equal(await pathExists(destination), true);
    assert.equal(await pathExists(transaction.stagingRoot), false);
  });

  for (const timing of ["before", "after"]) {
    await t.test(`source-backup copy recovers when interrupted ${timing} its first file`, async (t) => {
      const root = await createFixture({ repositories: ["app"] });
      t.after(() => rm(root, { recursive: true, force: true }));
      const id = `2026-08-25-backup-copy-${timing}`;
      const source = join(root, "code", "app", "docs", "changes", id);
      const destination = getActiveChangePath(id, root);
      await writeChange(source, "in_progress", `backup copy ${timing}\n`);
      const hookName = timing === "before"
        ? "beforeSourceBackupCopyEntry"
        : "afterSourceBackupCopyEntry";

      await interruptUpdate(root, `{
        linkFile: ${exdevLinkSource},
        ${hookName}: (() => {
          let interrupted = false;
          return ({ type }) => {
            if (!interrupted && type === "file") {
              interrupted = true;
              process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
            }
          };
        })(),
      }`);
      const transaction = await mutateInterruptedJournal(root, () => {});
      const sourceRecord = transaction.journal.sources.find(
        (record) => record.physicalPath === dirname(source),
      );
      assert.ok(sourceRecord);
      assert.equal(sourceRecord.phase, "removing");
      assert.equal(sourceRecord.copySourceRoot, sourceRecord.physicalPath);
      assert.equal(typeof sourceRecord.copyRoot, "string");
      assert.equal(sourceRecord.backupProofPhase, "copying");
      assert.equal(typeof sourceRecord.backupProofRoot, "string");
      assert.equal(typeof sourceRecord.backupProofOwnerPath, "string");
      assert.equal(await pathExists(sourceRecord.backupProofRoot), true);
      assert.equal(await pathExists(sourceRecord.backupProofOwnerPath), true);
      assert.ok(sourceRecord.backupEntryProvenance.length >= 1);
      assert.ok(sourceRecord.copyTargetManifest.length >= 1);
      if (timing === "before") {
        assert.equal(sourceRecord.copyIntent.type, "file");
      } else {
        assert.equal(sourceRecord.copyIntent, null);
        assert.equal(
          sourceRecord.copyTargetManifest.some((entry) => entry.type === "file"),
          true,
        );
      }

      const recovered = await updateFixture(root);
      assert.equal(recovered.migration.required, true);
      assert.equal(await pathExists(source), false);
      assert.equal(await pathExists(destination), true);
      assert.equal(await pathExists(transaction.stagingRoot), false);
      assert.equal(await pathExists(sourceRecord.backupProofRoot), false);
      assert.equal(await pathExists(sourceRecord.backupProofOwnerPath), false);
      assert.equal(await pathExists(sourceRecord.backupProofReceiptPath), false);
    });
  }

  await t.test("a missing source-backup entry witness fails closed across restart", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-25-backup-copy-missing-proof";
    const source = join(root, "code", "app", "docs", "changes", id);
    await writeChange(source, "in_progress", "backup copy missing proof\n");

    await interruptUpdate(root, `{
      linkFile: ${exdevLinkSource},
      afterSourceBackupCopyEntry: ({ type }) => {
        if (type === "file") {
          process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
        }
      },
    }`);
    const transaction = await mutateInterruptedJournal(root, () => {});
    const sourceRecord = transaction.journal.sources.find(
      (record) => record.physicalPath === dirname(source),
    );
    assert.ok(sourceRecord);
    const fileProof = sourceRecord.backupEntryProvenance.find(
      (entry) => entry.type === "file",
    );
    assert.ok(fileProof);
    assert.equal(await pathExists(fileProof.targetWitnessPath), true);
    await rm(fileProof.targetWitnessPath);

    await assert.rejects(
      updateFixture(root),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await pathExists(source), true);
    assert.equal(await pathExists(sourceRecord.copyRoot), true);
    assert.equal(await pathExists(sourceRecord.backupProofRoot), true);
    assert.equal(await pathExists(sourceRecord.backupProofOwnerPath), true);
    assert.equal(await pathExists(transaction.journalPath), true);
  });

  await t.test("a forged journal cannot authorize a same-byte source-backup replacement", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-25-backup-forged-replacement";
    const source = join(root, "code", "app", "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    await writeChange(source, "in_progress", "backup forged replacement\n");

    await interruptUpdate(root, `{
      linkFile: ${exdevLinkSource},
      beforeSourceBackupDelete: () => {
        process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
      },
    }`, { finalize: true });
    let transaction = await mutateInterruptedJournal(root, () => {});
    let sourceRecord = transaction.journal.sources.find(
      (record) => record.physicalPath === dirname(source),
    );
    assert.ok(sourceRecord);
    assert.equal(sourceRecord.backupProofPhase, "present");
    assert.equal(sourceRecord.phase, "removed");
    assert.equal(await pathExists(source), false);
    assert.equal(await pathExists(destination), true);
    const payloadName = (await readdir(sourceRecord.backup)).find(
      (name) => join(sourceRecord.backup, name) !== sourceRecord.cleanupPath,
    );
    assert.equal(typeof payloadName, "string");
    const replaced = join(sourceRecord.backup, payloadName, id, "proposal.md");
    const retained = `${replaced}-transaction-created`;
    const bytes = await readFile(replaced);
    await rename(replaced, retained);
    await writeFile(replaced, bytes);
    const replacementState = await lstat(replaced);
    const replacementIdentity = {
      dev: String(replacementState.dev),
      ino: String(replacementState.ino),
    };
    const canonical = (value) => {
      if (value === null) return "n";
      if (typeof value === "boolean") return value ? "b1" : "b0";
      if (typeof value === "number") return `d${String(value).length}:${String(value)}`;
      if (typeof value === "string") return `s${Buffer.byteLength(value, "utf8")}:${value}`;
      if (Array.isArray(value)) {
        return `a${value.length}[${value.map((entry) => canonical(entry)).join("")}]`;
      }
      const keys = Object.keys(value).sort((left, right) => left.localeCompare(right));
      return `o${keys.length}{${keys.map((key) => `${canonical(key)}${canonical(value[key])}`).join("")}}`;
    };

    transaction = await mutateInterruptedJournal(root, (journal) => {
      const forgedSource = journal.sources.find(
        (record) => record.physicalPath === dirname(source),
      );
      const entry = forgedSource.backupEntryProvenance.find(
        (candidate) => candidate.relativePath === `${id}/proposal.md`,
      );
      assert.ok(entry);
      entry.targetIdentity = replacementIdentity;
      const digest = createHash("sha256").update(canonical({
        token: entry.token,
        index: entry.index,
        relativePath: entry.relativePath,
        type: entry.type,
        sourceIdentity: entry.sourceIdentity,
        sourceHash: entry.sourceHash,
        sourceTarget: entry.sourceTarget,
        targetIdentity: entry.targetIdentity,
        targetHash: entry.targetHash,
        targetTarget: entry.targetTarget,
      })).digest("hex");
      entry.digest = digest;
      const stem = `.entry-${entry.index}-${entry.type}-${entry.targetIdentity.dev}-${entry.targetIdentity.ino}-${digest}`;
      entry.ownerWitnessPath = join(forgedSource.backupProofRoot, `${stem}.owner`);
      entry.targetWitnessPath = join(forgedSource.backupProofRoot, `${stem}.target`);
    });
    sourceRecord = transaction.journal.sources.find(
      (record) => record.physicalPath === dirname(source),
    );

    await assert.rejects(
      updateFixture(root),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.deepEqual(await readFile(replaced), bytes);
    assert.deepEqual(await readFile(retained), bytes);
    assert.equal(await pathExists(sourceRecord.backup), true);
    assert.equal(await pathExists(sourceRecord.backupProofRoot), true);
    assert.equal(await pathExists(sourceRecord.backupProofOwnerPath), true);
    assert.equal(await pathExists(sourceRecord.backupProofReceiptPath), true);
    assert.equal(await pathExists(transaction.journalPath), true);
  });

  await t.test("source-backup proof receipt cleanup resumes after its final unlink", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-25-backup-proof-receipt-resume";
    const source = join(root, "code", "app", "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    await writeChange(source, "in_progress", "backup proof receipt resume\n");

    await interruptUpdate(root, `{
      beforeCleanupRemovalMutation: ({ label, phase }) => {
        if (label === "Migration backup owner receipt" && phase === "quarantine") {
          process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
        }
      },
    }`, { finalize: true });
    const transaction = await mutateInterruptedJournal(root, () => {});
    const sourceRecord = transaction.journal.sources.find(
      (record) => record.physicalPath === dirname(source),
    );
    assert.ok(sourceRecord);
    assert.equal(sourceRecord.backupProofPhase, "cleaning");
    assert.equal(await pathExists(sourceRecord.backup), false);
    assert.equal(await pathExists(sourceRecord.backupProofRoot), false);
    assert.equal(await pathExists(sourceRecord.backupProofReceiptPath), false);
    assert.equal(await pathExists(sourceRecord.backupProofReceiptCleanupPath), false);
    assert.equal(await pathExists(sourceRecord.backupProofOwnerPath), false);
    assert.equal(await pathExists(sourceRecord.backupProofOwnerCleanupPath), true);

    await rm(sourceRecord.backupProofOwnerCleanupPath);
    const recovered = await updateFixture(root);
    assert.equal(recovered.migration.required, true);
    assert.equal(await pathExists(source), false);
    assert.equal(await pathExists(destination), true);
    assert.equal(await pathExists(sourceRecord.backupProofRoot), false);
    assert.equal(await pathExists(sourceRecord.backupProofOwnerPath), false);
    assert.equal(await pathExists(sourceRecord.backupProofReceiptPath), false);
    assert.equal(await pathExists(transaction.journalPath), false);
  });


  await t.test("an intent-window hardlink collision is retained as unproven", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-25-copy-intent-collision";
    const source = join(root, "code", "app", "docs", "changes", id);
    await writeChange(source, "in_progress", "copy intent collision\n");
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );
    let collision;

    await assert.rejects(
      applyUpdateMigration(plan, {
        beforeChangeStagingCopyEntry: async ({ type, source: entrySource, target }) => {
          if (collision || type !== "file") return;
          collision = target;
          await link(entrySource, target);
        },
      }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await pathExists(collision), true);
    assert.equal(await pathExists(source), true);
    await readPendingTransaction(root);
  });
  await t.test("a forged same-byte target ledger is retained when its source is absent", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const id = "2026-08-25-forged-copy-ledger";
    const source = join(root, "code", "app", "docs", "changes", id);
    await writeChange(source, "in_progress", "forged copy ledger\n");

    await interruptUpdate(root, `{
      beforeChangeStagingCopyEntry: ({ type }) => {
        if (type === "file") process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
      },
    }`);
    let interrupted = await mutateInterruptedJournal(root, () => {});
    const change = interrupted.journal.changes[0];
    const intent = change.copyIntent;
    assert.equal(intent.type, "file");
    const sourceEntry = join(change.copySourceRoot, intent.relativePath);
    const forgedTarget = join(change.copyRoot, intent.relativePath);
    const sourceBytes = await readFile(sourceEntry);
    await writeFile(forgedTarget, sourceBytes);
    const forgedState = await lstat(forgedTarget);
    interrupted = await mutateInterruptedJournal(root, (journal) => {
      const record = journal.changes[0];
      record.copyTargetManifest.push({
        relativePath: intent.relativePath,
        type: "file",
        identity: {
          dev: String(forgedState.dev),
          ino: String(forgedState.ino),
        },
        mode: intent.mode,
        hash: intent.hash,
        target: null,
        quarantineRelativePath: `.sdd-remove-${process.pid}-${randomUUID()}`,
      });
      record.copyIntent = null;
    });
    const retainedSource = `${change.copySourceRoot}-retained`;
    await rename(change.copySourceRoot, retainedSource);

    await assert.rejects(
      updateFixture(root),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.deepEqual(await readFile(forgedTarget), sourceBytes);
    assert.equal(await pathExists(retainedSource), true);
    assert.equal(await pathExists(interrupted.journalPath), true);
  });
});

test("workspace update preserves a managed skill inode swapped during its final success guard", async (t) => {
  const root = await createFixture({ repositories: ["app"] });
  t.after(() => rm(root, { recursive: true, force: true }));
  const skillPath = join(root, ".agents", "skills", "sdd-change");
  const displacedSkill = join(root, "published-sdd-change");
  let publishedIdentity;
  let winnerIdentity;
  let publishedHash;
  let failure;

  await assert.rejects(
    updateWorkspace(root, {
      workspaceRoot: root,
      installationOptions: {
        beforeSuccess: async () => {
          publishedHash = await hashDirectory(skillPath);
          const publishedState = await lstat(skillPath, { bigint: true });
          publishedIdentity = `${publishedState.dev}:${publishedState.ino}`;
          await rename(skillPath, displacedSkill);
          await cp(displacedSkill, skillPath, { recursive: true });
          const winnerState = await lstat(skillPath, { bigint: true });
          winnerIdentity = `${winnerState.dev}:${winnerState.ino}`;
        },
      },
    }),
    (error) => {
      failure = error;
      return error?.code === "MUTATION_RECOVERY_FAILED";
    },
  );
  assert.equal(failure.originalError.code, "CONCURRENT_CHANGE");
  assert.equal(failure.errors[0], failure.originalError);
  assert.equal(failure.cause instanceof AggregateError, true);
  assert.equal(
    failure.failures.some(({ label, error }) =>
      label === "Managed skills rollback"
      && error.code === "MUTATION_RECOVERY_FAILED"),
    true,
  );
  assert.equal(failure.retainedPaths.includes(skillPath), true);

  assert.notEqual(winnerIdentity, publishedIdentity);
  assert.equal(await hashDirectory(skillPath), publishedHash);
  assert.equal(await hashDirectory(displacedSkill), publishedHash);
  assert.equal(await pathExists(join(root, ".sdd", "install-lock.json")), false);
  assert.equal(
    await pathExists(join(root, ".sdd", "story-driven-development.md")),
    false,
  );
  assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v2");
});

test("workspace update preserves an install-lock inode swapped during its final success guard", async (t) => {
  const root = await createFixture({ repositories: ["app"] });
  t.after(() => rm(root, { recursive: true, force: true }));
  const displacedLock = join(root, "published-install-lock.json");
  let lockPath;
  let lockSource;
  let publishedIdentity;
  let winnerIdentity;

  await assert.rejects(
    updateWorkspace(root, {
      workspaceRoot: root,
      installationOptions: {
        beforeSuccess: async (context) => {
          lockPath = context.lockPath;
          lockSource = await readFile(lockPath, "utf8");
          const publishedState = await lstat(lockPath, { bigint: true });
          publishedIdentity = `${publishedState.dev}:${publishedState.ino}`;
          await rename(lockPath, displacedLock);
          await writeFile(lockPath, lockSource, "utf8");
          const winnerState = await lstat(lockPath, { bigint: true });
          winnerIdentity = `${winnerState.dev}:${winnerState.ino}`;
        },
      },
    }),
    (error) => error?.code === "MUTATION_RECOVERY_FAILED",
  );

  assert.notEqual(winnerIdentity, publishedIdentity);
  assert.equal(await readFile(lockPath, "utf8"), lockSource);
  assert.equal(await readFile(displacedLock, "utf8"), lockSource);
  assert.equal(
    await pathExists(join(root, ".sdd", "story-driven-development.md")),
    false,
  );
  assert.equal(
    await pathExists(join(root, ".agents", "skills", "sdd-change")),
    false,
  );
  assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v2");
});

test("configuration proof initialization and cleanup resume only from durable intent", async (t) => {
  await t.test("EXDEV read-guard proof is adopted only while its live source remains exact", async (t) => {
    const fixture = await createExternalTopology(t, "read-guard-create-crash");
    const briefSource = join(fixture.plannedRoot, "read-guard-create-crash.md");
    await mkdir(fixture.plannedRoot, { recursive: true });
    await writeFile(briefSource, "read guard create crash\n", "utf8");
    const stagingPrefix = join(fixture.root, ".sdd", "changes", ".sdd-update-");

    await interruptUpdate(fixture.root, `{
      linkFile: async (source, target) => {
        if (
          source === ${JSON.stringify(fixture.repositoryConfigPath)}
          && target.startsWith(${JSON.stringify(stagingPrefix)})
        ) {
          const error = new Error("mocked cross-device link");
          error.code = "EXDEV";
          throw error;
        }
        return (await import("node:fs/promises")).link(source, target);
      },
      afterReadGuardProofCreate: ({ guard }) => {
        if (guard.path === ${JSON.stringify(fixture.repositoryConfigPath)}) {
          process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
        }
      },
    }`);
    const pending = await readPendingTransaction(fixture.root);
    const guardIndex = pending.journal.readGuards.findIndex(
      (guard) => guard.path === fixture.repositoryConfigPath,
    );
    assert.notEqual(guardIndex, -1);
    const guard = pending.journal.readGuards[guardIndex];
    assert.equal(guard.proofPhase, "creating");
    assert.ok(guard.proofIdentity);
    const proofState = await lstat(join(pending.stagingRoot, `.read-guard-${guardIndex}`));
    assert.deepEqual(
      { dev: String(proofState.dev), ino: String(proofState.ino) },
      guard.proofIdentity,
    );
    assert.notDeepEqual(guard.proofIdentity, guard.identity);

    assert.deepEqual(
      await recoverUpdateMigration(
        fixture.root,
        { destinationWorkspaceRoot: fixture.root },
      ),
      { recovered: 1 },
    );
    assert.equal(await readFile(briefSource, "utf8"), "read guard create crash\n");
    assert.equal(await pathExists(pending.stagingRoot), false);
  });
  await t.test("EXDEV read-guard recovery rejects a same-byte replacement inode", async (t) => {
    const fixture = await createExternalTopology(t, "read-guard-inode-swap");
    const briefSource = join(fixture.plannedRoot, "read-guard-inode-swap.md");
    await mkdir(fixture.plannedRoot, { recursive: true });
    await writeFile(briefSource, "read guard inode swap\n", "utf8");
    const stagingPrefix = join(fixture.root, ".sdd", "changes", ".sdd-update-");

    await interruptUpdate(fixture.root, `{
      linkFile: async (source, target) => {
        if (
          source === ${JSON.stringify(fixture.repositoryConfigPath)}
          && target.startsWith(${JSON.stringify(stagingPrefix)})
        ) {
          const error = new Error("mocked cross-device link");
          error.code = "EXDEV";
          throw error;
        }
        return (await import("node:fs/promises")).link(source, target);
      },
      afterReadGuardProofCreate: ({ guard }) => {
        if (guard.path === ${JSON.stringify(fixture.repositoryConfigPath)}) {
          process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
        }
      },
    }`);

    const pending = await readPendingTransaction(fixture.root);
    const guardIndex = pending.journal.readGuards.findIndex(
      (guard) => guard.path === fixture.repositoryConfigPath,
    );
    assert.notEqual(guardIndex, -1);
    const guard = pending.journal.readGuards[guardIndex];
    assert.ok(guard.proofIdentity);
    const proofPath = join(pending.stagingRoot, `.read-guard-${guardIndex}`);
    const displaced = `${proofPath}.owned`;
    const proofBytes = await readFile(proofPath);
    await rename(proofPath, displaced);
    await writeFile(proofPath, proofBytes, { mode: guard.mode });
    const replacementState = await lstat(proofPath);
    const replacementIdentity = {
      dev: String(replacementState.dev),
      ino: String(replacementState.ino),
    };
    assert.notDeepEqual(replacementIdentity, guard.proofIdentity);

    await assert.rejects(
      recoverUpdateMigration(
        fixture.root,
        { destinationWorkspaceRoot: fixture.root },
      ),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    const retainedState = await lstat(proofPath);
    assert.deepEqual(
      { dev: String(retainedState.dev), ino: String(retainedState.ino) },
      replacementIdentity,
    );
    assert.equal(await readFile(briefSource, "utf8"), "read guard inode swap\n");
  });

  for (const [name, hook, expectedPhase] of [
    ["proof creation", "afterConfigProofCreate", "pending"],
    ["original staging", "afterConfigOriginalStage", "preparing-original"],
    ["next staging", "afterConfigNextStage", "preparing-next"],
  ]) {
    await t.test(`config recovery resumes after ${name} exposure`, async (t) => {
      const root = await createFixture({ repositories: ["app"] });
      t.after(() => rm(root, { recursive: true, force: true }));

      await interruptUpdate(root, `{
        ${hook}: ({ write }) => {
          if (write.path === ${JSON.stringify(join(root, ".sdd", "config.yaml"))}) {
            process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
          }
        },
      }`);

      const pending = await readPendingTransaction(root);
      const config = pending.journal.configs.find(
        (record) => record.path === join(root, ".sdd", "config.yaml"),
      );
      assert.ok(config);
      assert.equal(config.phase, expectedPhase);
      if (hook === "afterConfigProofCreate") assert.equal(config.proofPhase, "creating");

      assert.deepEqual(
        await recoverUpdateMigration(root, { destinationWorkspaceRoot: root }),
        { recovered: 1 },
      );
      assert.equal((await readWorkspaceConfig(root)).schema, "sdd-v2");
      assert.equal(await pathExists(pending.stagingRoot), false);
    });
  }

  await t.test("published config proof recovery rejects a same-byte replacement inode", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const configPath = join(root, ".sdd", "config.yaml");
    await interruptUpdate(root, `{
      afterConfigNextProofCreate: ({ write }) => {
        if (write.path === ${JSON.stringify(configPath)}) {
          process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
        }
      },
    }`);

    const pending = await readPendingTransaction(root);
    const config = pending.journal.configs.find((record) => record.path === configPath);
    assert.ok(config?.nextProofIntentIdentity);
    const configIndex = pending.journal.configs.indexOf(config);
    const configuredProofPath = join(
      dirname(configPath),
      `.${basename(configPath)}${basename(pending.stagingRoot)}-config-${configIndex}-next`,
    );
    const proofBytes = await readFile(configuredProofPath);
    const displaced = `${configuredProofPath}.owned`;
    await rename(configuredProofPath, displaced);
    await writeFile(configuredProofPath, proofBytes, { mode: config.originalMode });
    const replacementState = await lstat(configuredProofPath);
    const replacementIdentity = {
      dev: String(replacementState.dev),
      ino: String(replacementState.ino),
    };
    assert.notDeepEqual(replacementIdentity, config.nextProofIntentIdentity);

    await assert.rejects(
      recoverUpdateMigration(root, { destinationWorkspaceRoot: root }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    const retainedState = await lstat(configuredProofPath);
    assert.deepEqual(
      { dev: String(retainedState.dev), ino: String(retainedState.ino) },
      replacementIdentity,
    );
  });

  for (const proofPhase of ["cleaning", "removed"]) {
    await t.test(`committed config cleanup resumes from proof phase ${proofPhase}`, async (t) => {
      const root = await createFixture({ repositories: ["app"] });
      t.after(() => rm(root, { recursive: true, force: true }));

      await interruptUpdate(root, `{
        beforeTransactionJournalReplace: ({ state }) => {
          if (
            state.status === "committed"
            && state.writtenConfigs.some((record) => record.proofPhase === ${JSON.stringify(proofPhase)})
          ) {
            process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
          }
        },
      }`, { finalize: true });

      const pending = await readPendingTransaction(root);
      assert.equal(
        pending.journal.configs.some((record) => record.proofPhase === proofPhase),
        true,
      );
      assert.deepEqual(
        await recoverUpdateMigration(root, { destinationWorkspaceRoot: root }),
        { recovered: 1 },
      );
      assert.equal((await readWorkspaceConfig(root)).version, 3);
      assert.equal(await pathExists(pending.stagingRoot), false);
    });
  }

  await t.test("committed config proof retirement rejects a same-byte live inode swap", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const configPath = join(root, ".sdd", "config.yaml");

    await interruptUpdate(root, `{
      afterTransactionDirectoryVerification: () => {
        process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
      },
    }`, { finalize: true });
    const pending = await readPendingTransaction(root);
    const config = pending.journal.configs.find((record) => record.path === configPath);
    assert.ok(config);
    assert.equal(config.phase, "verified");
    assert.equal(config.proofPhase, "removed");
    assert.ok(config.nextProofIntentIdentity);
    const bytes = await readFile(configPath);
    const mode = (await lstat(configPath)).mode & 0o777;
    const retained = `${configPath}.transaction-owned`;
    await rename(configPath, retained);
    await writeFile(configPath, bytes, { mode });
    const replacementState = await lstat(configPath);
    const replacementIdentity = {
      dev: String(replacementState.dev),
      ino: String(replacementState.ino),
    };
    assert.notDeepEqual(replacementIdentity, config.nextProofIntentIdentity);

    await assert.rejects(
      recoverUpdateMigration(root, { destinationWorkspaceRoot: root }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    const retainedReplacementState = await lstat(configPath);
    assert.deepEqual(
      {
        dev: String(retainedReplacementState.dev),
        ino: String(retainedReplacementState.ino),
      },
      replacementIdentity,
    );
    assert.deepEqual(await readFile(configPath), bytes);
    assert.deepEqual(await readFile(retained), bytes);
    assert.equal(await pathExists(pending.stagingRoot), true);
  });

  await t.test("config-only restart authenticates original-proof cleanup link intent", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));

    await interruptUpdate(root, `{
      afterConfigProofCleanupLink: ({ label }) => {
        if (label === "Original configuration proof") {
          process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
        }
      },
    }`, { finalize: true });

    const pending = await readPendingTransaction(root);
    const cleaning = pending.journal.configs.find(
      (record) => record.originalProofCleanupPath !== null,
    );
    assert.ok(cleaning);
    assert.equal(cleaning.proofPhase, "cleaning");
    assert.equal(cleaning.originalProofCleanupIdentity, null);
    assert.equal(await pathExists(cleaning.originalProofCleanupPath), true);

    assert.deepEqual(
      await recoverUpdateMigration(root, { destinationWorkspaceRoot: root }),
      { recovered: 1 },
    );
    assert.equal((await readWorkspaceConfig(root)).version, 3);
    assert.equal(await pathExists(pending.stagingRoot), false);
  });
  await t.test("config proof cleanup rejects a mode swap after its cleanup hook", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const configPath = join(root, ".sdd", "config.yaml");
    const originalMode = (await lstat(configPath)).mode & 0o777;
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );
    let tampered = false;
    const transaction = await applyUpdateMigration(plan, {
      afterConfigProofCleanupLink: async ({ cleanupPath, label }) => {
        if (!tampered && label === "Original configuration proof") {
          tampered = true;
          await chmod(cleanupPath, originalMode ^ 0o100);
        }
      },
    });

    await assert.rejects(
      finalizeMigrationTransaction(transaction),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(tampered, true);
    assert.equal(await pathExists(transaction.stagingRoot), true);
  });

  await t.test("rollback retains config proofs after a same-byte restored inode swap", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const configPath = join(root, ".sdd", "config.yaml");
    const retainedPath = `${configPath}.owned`;
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );
    let swapped = false;

    await assert.rejects(
      applyUpdateMigration(plan, {
        beforeSourceRemoval: () => {
          throw new Error("trigger configuration rollback");
        },
        afterConfigProofCleanupLink: async ({ label }) => {
          if (swapped || label !== "Original configuration proof") return;
          swapped = true;
          const bytes = await readFile(configPath);
          const mode = (await lstat(configPath)).mode & 0o777;
          await rename(configPath, retainedPath);
          await writeFile(configPath, bytes, { mode });
        },
      }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );

    assert.equal(swapped, true);
    assert.deepEqual(await readFile(configPath), await readFile(retainedPath));
    const stagingNames = (await readdir(join(root, ".sdd", "changes")))
      .filter((entry) => entry.startsWith(".sdd-update-"));
    assert.equal(stagingNames.length, 1);
  });

  await t.test("rollback restart rejects a same-byte restored config inode swap", async (t) => {
    const root = await createFixture({ repositories: ["app"] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const configPath = join(root, ".sdd", "config.yaml");

    await interruptUpdate(root, `{
      beforeSourceRemoval: () => {
        throw new Error("trigger durable configuration rollback");
      },
      afterTransactionDirectoryVerification: () => {
        process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
      },
    }`);
    const pending = await readPendingTransaction(root);
    const config = pending.journal.configs.find((record) => record.path === configPath);
    assert.ok(config);
    assert.equal(config.proofPhase, "removed");
    assert.ok(config.restoredIdentity);
    const bytes = await readFile(configPath);
    const mode = (await lstat(configPath)).mode & 0o777;
    const retained = `${configPath}.rollback-owned`;
    await rename(configPath, retained);
    await writeFile(configPath, bytes, { mode });
    const replacementState = await lstat(configPath);
    const replacementIdentity = {
      dev: String(replacementState.dev),
      ino: String(replacementState.ino),
    };
    assert.notDeepEqual(replacementIdentity, config.restoredIdentity);

    await assert.rejects(
      recoverUpdateMigration(root, { destinationWorkspaceRoot: root }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    const retainedReplacementState = await lstat(configPath);
    assert.deepEqual(
      {
        dev: String(retainedReplacementState.dev),
        ino: String(retainedReplacementState.ino),
      },
      replacementIdentity,
    );
    assert.deepEqual(await readFile(configPath), bytes);
    assert.deepEqual(await readFile(retained), bytes);
    assert.equal(await pathExists(pending.stagingRoot), true);
  });
});

test("existing destination guard proofs recover only from identity-bound creation intent", async (t) => {
  async function createExistingGuardFixture(testContext, suffix) {
    const root = await createFixture({ repositories: ["app"] });
    testContext.after(() => rm(root, { recursive: true, force: true }));
    const id = `2026-08-27-destination-guard-${suffix}`;
    const source = join(root, "code", "app", "docs", "changes", id);
    const destination = getActiveChangePath(id, root);
    await writeChange(source, "in_progress", `${suffix}\n`);
    const plan = await planUpdateMigration(
      root,
      await readWorkspaceConfig(root),
      { destinationWorkspaceRoot: root },
    );
    const plannedChange = plan.changes.find((change) => change.changeId === id);
    assert.ok(plannedChange);
    await writeChange(destination, "in_progress", `${suffix}\n`);
    await writeFile(
      join(destination, "tasks.md"),
      plannedChange.canonicalTasksSource,
      "utf8",
    );
    assert.equal(await hashDirectory(destination), plannedChange.canonicalHash);
    return {
      root,
      source,
      destination,
      canonicalHash: plannedChange.canonicalHash,
    };
  }

  async function readGuardTransaction(root, destination) {
    const changesRoot = join(root, ".sdd", "changes");
    const stagingNames = (await readdir(changesRoot))
      .filter((entry) => entry.startsWith(".sdd-update-"));
    assert.equal(stagingNames.length, 1);
    const stagingRoot = join(changesRoot, stagingNames[0]);
    const journal = JSON.parse(
      await readFile(join(stagingRoot, "transaction.json"), "utf8"),
    );
    const guardIndex = journal.destinationGuards.findIndex(
      (guard) => guard.destination === destination,
    );
    assert.notEqual(guardIndex, -1);
    return {
      changesRoot,
      stagingRoot,
      guardIndex,
      guard: journal.destinationGuards[guardIndex],
      proofPath: join(stagingRoot, `.destination-${guardIndex}-guard`),
    };
  }

  for (const [hook, proofExists, suffix] of [
    ["beforeDestinationGuardProofCreate", false, "before-link"],
    ["afterDestinationGuardProofCreate", true, "after-link"],
  ]) {
    await t.test(`a child exit ${suffix} exact-cleans its guard intent`, async (childT) => {
      const fixture = await createExistingGuardFixture(childT, suffix);
      await interruptUpdate(fixture.root, `{
        ${hook}: ({ guard }) => {
          if (guard.destination === ${JSON.stringify(fixture.destination)}) {
            process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
          }
        },
      }`);

      const pending = await readGuardTransaction(
        fixture.root,
        fixture.destination,
      );
      const tasksState = await lstat(join(fixture.destination, "tasks.md"));
      const tasksIdentity = {
        dev: String(tasksState.dev),
        ino: String(tasksState.ino),
      };
      assert.equal(pending.guard.proofPhase, "creating");
      assert.deepEqual(pending.guard.proofIdentity, tasksIdentity);
      assert.equal(await pathExists(pending.proofPath), proofExists);
      if (proofExists) {
        const proofState = await lstat(pending.proofPath);
        assert.deepEqual(
          { dev: String(proofState.dev), ino: String(proofState.ino) },
          tasksIdentity,
        );
      }

      assert.deepEqual(
        await recoverUpdateMigration(
          fixture.root,
          { destinationWorkspaceRoot: fixture.root },
        ),
        { recovered: 1 },
      );
      assert.equal(await pathExists(pending.stagingRoot), false);
      assert.equal(await pathExists(fixture.source), true);
      assert.equal(await hashDirectory(fixture.destination), fixture.canonicalHash);

      await updateFixture(fixture.root);
      assert.equal(await pathExists(fixture.source), false);
      assert.equal(await hashDirectory(fixture.destination), fixture.canonicalHash);
      assert.deepEqual(
        (await readdir(pending.changesRoot))
          .filter((entry) => entry.startsWith(".sdd-update-")),
        [],
      );
    });
  }

  await t.test("a same-byte different-inode proof replacement survives failed recovery", async (childT) => {
    const fixture = await createExistingGuardFixture(childT, "replacement");
    await interruptUpdate(fixture.root, `{
      afterDestinationGuardProofCreate: ({ guard }) => {
        if (guard.destination === ${JSON.stringify(fixture.destination)}) {
          process.exit(${INTERRUPTED_UPDATE_EXIT_CODE});
        }
      },
    }`);

    const pending = await readGuardTransaction(fixture.root, fixture.destination);
    const proofSource = await readFile(pending.proofPath, "utf8");
    await rm(pending.proofPath);
    await writeFile(pending.proofPath, proofSource, "utf8");
    const replacementState = await lstat(pending.proofPath);
    const replacementIdentity = {
      dev: String(replacementState.dev),
      ino: String(replacementState.ino),
    };
    assert.notDeepEqual(replacementIdentity, pending.guard.proofIdentity);

    await assert.rejects(
      recoverUpdateMigration(
        fixture.root,
        { destinationWorkspaceRoot: fixture.root },
      ),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    const retainedState = await lstat(pending.proofPath);
    assert.deepEqual(
      { dev: String(retainedState.dev), ino: String(retainedState.ino) },
      replacementIdentity,
    );
    assert.equal(await readFile(pending.proofPath, "utf8"), proofSource);
    assert.equal(await pathExists(pending.stagingRoot), true);
    assert.equal(await pathExists(fixture.source), true);
    assert.equal(await hashDirectory(fixture.destination), fixture.canonicalHash);
  });

  await t.test("a same-hash live destination inode swap blocks source retirement", async (t) => {
    const fixture = await createExistingGuardFixture(t, "live-inode-swap");
    const tasksPath = join(fixture.destination, "tasks.md");
    const retainedTasks = `${tasksPath}.guard-owned`;
    const tasksBytes = await readFile(tasksPath);
    const tasksMode = (await lstat(tasksPath)).mode & 0o777;
    const plan = await planUpdateMigration(
      fixture.root,
      await readWorkspaceConfig(fixture.root),
      { destinationWorkspaceRoot: fixture.root },
    );
    let replacementIdentity;

    await assert.rejects(
      applyUpdateMigration(plan, {
        beforeSourceRemoval: async () => {
          await rename(tasksPath, retainedTasks);
          await writeFile(tasksPath, tasksBytes, { mode: tasksMode });
          const state = await lstat(tasksPath);
          replacementIdentity = {
            dev: String(state.dev),
            ino: String(state.ino),
          };
        },
      }),
      (error) => error.code === "CONCURRENT_CHANGE",
    );
    assert.ok(replacementIdentity);
    assert.deepEqual(await readFile(tasksPath), tasksBytes);
    assert.deepEqual(await readFile(retainedTasks), tasksBytes);
    assert.equal(await pathExists(fixture.source), true);
    assert.equal(await hashDirectory(fixture.destination), fixture.canonicalHash);
    assert.deepEqual(
      (await readdir(join(fixture.root, ".sdd", "changes")))
        .filter((entry) => entry.startsWith(".sdd-update-")),
      [],
    );
  });
});

test("transaction initialization crash states are authenticated before publication", async (t) => {
  async function createInitializationFixture(testContext, suffix) {
    const root = await createFixture({ repositories: ["app"] });
    testContext.after(() => rm(root, { recursive: true, force: true }));
    const id = `2026-08-09-init-${randomUUID()}`;
    const source = join(root, "code", "app", "docs", "changes", id);
    await writeChange(source, "in_progress", `${suffix}\n`);
    return { root, source, destination: getActiveChangePath(id, root) };
  }

  async function initializationArtifacts(root) {
    const configRoot = join(root, ".sdd");
    const changesRoot = join(configRoot, "changes");
    const reservationNames = (await readdir(configRoot)).filter(
      (entry) => entry.startsWith(".sdd-update-")
        && entry.endsWith("-initialization.guard"),
    );
    const stagingNames = (await readdir(changesRoot))
      .filter((entry) => entry.startsWith(".sdd-update-"));
    assert.ok(reservationNames.length <= 1);
    assert.ok(stagingNames.length <= 1);
    const stagingName = stagingNames[0]
      ?? reservationNames[0]?.slice(0, -"-initialization.guard".length);
    assert.ok(stagingName);
    if (reservationNames.length === 1 && stagingNames.length === 1) {
      assert.equal(reservationNames[0], `${stagingName}-initialization.guard`);
    }
    const stagingRoot = join(changesRoot, stagingName);
    return {
      configRoot,
      changesRoot,
      stagingRoot,
      journalPath: join(stagingRoot, "transaction.json"),
      manifestPath: join(stagingRoot, "destinations.json"),
      digestPath: join(configRoot, `${stagingName}-destinations.digest`),
      witnessPath: join(configRoot, `${stagingName}-destinations`),
      reservationPath: join(configRoot, `${stagingName}-initialization.guard`),
      bindingPath: join(configRoot, `${stagingName}-initialization.binding.json`),
    };
  }

  async function assertInitializationCleaned(artifacts) {
    assert.deepEqual(
      (await readdir(artifacts.changesRoot))
        .filter((entry) => entry.startsWith(".sdd-update-")),
      [],
    );
    assert.deepEqual(
      (await readdir(artifacts.configRoot))
        .filter((entry) => entry.includes("-initialization.guard")
          || entry.includes("-initialization.binding.json")),
      [],
    );
  }

  for (const [hook, expected] of [
    ["afterTransactionInitializationReservation", {
      staging: false, binding: false, journal: false, manifest: false,
      digest: false, witness: false, phase: null, reservation: true,
    }],
    ["afterTransactionInitializationBinding", {
      staging: false, binding: true, journal: false, manifest: false,
      digest: false, witness: false, phase: null, reservation: true,
    }],
    ["afterTransactionStagingRootCreate", {
      staging: true, binding: true, journal: false, manifest: false,
      digest: false, witness: false, phase: null, reservation: true,
    }],
    ["afterTransactionStagingReservation", {
      staging: true, binding: true, journal: false, manifest: false,
      digest: false, witness: false, phase: null, reservation: true,
    }],
    ["afterTransactionInitialJournal", {
      staging: true, binding: true, journal: true, manifest: false,
      digest: false, witness: false, phase: "journaled", reservation: true,
    }],
    ["afterDestinationManifestCreate", {
      staging: true, binding: true, journal: true, manifest: true,
      digest: false, witness: false, phase: "journaled", reservation: true,
    }],
    ["afterDestinationManifestDigestCreate", {
      staging: true, binding: true, journal: true, manifest: true,
      digest: true, witness: false, phase: "journaled", reservation: true,
    }],
    ["afterDestinationManifestWitnessCreate", {
      staging: true, binding: true, journal: true, manifest: true,
      digest: true, witness: true, phase: "journaled", reservation: true,
    }],
    ["afterTransactionInitializationEvidenceRelease", {
      staging: true, binding: false, journal: true, manifest: true,
      digest: true, witness: true, phase: "releasing", reservation: false,
    }],
  ]) {
    await t.test(`${hook} child exit recovers exact initialization state`, async (childT) => {
      const fixture = await createInitializationFixture(childT, hook);
      await interruptUpdate(fixture.root, `{
        ${hook}: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
      }`);
      const artifacts = await initializationArtifacts(fixture.root);
      assert.equal(await pathExists(artifacts.stagingRoot), expected.staging);
      assert.equal(await pathExists(artifacts.bindingPath), expected.binding);
      assert.equal(await pathExists(artifacts.journalPath), expected.journal);
      assert.equal(await pathExists(artifacts.manifestPath), expected.manifest);
      assert.equal(await pathExists(artifacts.digestPath), expected.digest);
      assert.equal(await pathExists(artifacts.witnessPath), expected.witness);
      assert.equal(await pathExists(artifacts.reservationPath), expected.reservation);
      if (expected.phase !== null) {
        const journal = JSON.parse(await readFile(artifacts.journalPath, "utf8"));
        assert.equal(journal.version, 8);
        assert.equal(journal.initializationPhase, expected.phase);
      }

      assert.deepEqual(
        await recoverUpdateMigration(
          fixture.root,
          { destinationWorkspaceRoot: fixture.root },
        ),
        { recovered: 1 },
      );
      assert.equal(await pathExists(fixture.source), true);
      assert.equal(await pathExists(fixture.destination), false);
      await assertInitializationCleaned(artifacts);

      await updateFixture(fixture.root);
      assert.equal(await pathExists(fixture.source), false);
      assert.equal(await pathExists(fixture.destination), true);
      await assertInitializationCleaned(artifacts);
    });
  }

  await t.test("an opaque staging replacement survives failed pre-journal recovery", async (childT) => {
    const fixture = await createInitializationFixture(childT, "opaque-root");
    await interruptUpdate(fixture.root, `{
      afterTransactionStagingReservation: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);
    const artifacts = await initializationArtifacts(fixture.root);
    const ownedAside = join(artifacts.configRoot, "owned-initialization-root");
    await rename(artifacts.stagingRoot, ownedAside);
    await mkdir(artifacts.stagingRoot);
    const opaquePath = join(artifacts.stagingRoot, "opaque.txt");
    await writeFile(opaquePath, "opaque replacement\n", "utf8");

    await assert.rejects(
      recoverUpdateMigration(
        fixture.root,
        { destinationWorkspaceRoot: fixture.root },
      ),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(opaquePath, "utf8"), "opaque replacement\n");
    assert.equal(await pathExists(ownedAside), true);
    assert.equal(await pathExists(artifacts.reservationPath), true);
    assert.equal(await pathExists(artifacts.bindingPath), true);
  });

  await t.test("a same-byte reservation replacement survives failed recovery", async (childT) => {
    const fixture = await createInitializationFixture(childT, "forged-reservation");
    await interruptUpdate(fixture.root, `{
      afterTransactionInitializationReservation: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);
    const artifacts = await initializationArtifacts(fixture.root);
    const source = await readFile(artifacts.reservationPath, "utf8");
    await rm(artifacts.reservationPath);
    await writeFile(artifacts.reservationPath, source, "utf8");
    const replacement = await lstat(artifacts.reservationPath);

    await assert.rejects(
      recoverUpdateMigration(
        fixture.root,
        { destinationWorkspaceRoot: fixture.root },
      ),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    const retained = await lstat(artifacts.reservationPath);
    assert.deepEqual(
      { dev: String(retained.dev), ino: String(retained.ino) },
      { dev: String(replacement.dev), ino: String(replacement.ino) },
    );
    assert.equal(await readFile(artifacts.reservationPath, "utf8"), source);
  });

  await t.test("authority mode drift survives failed pre-journal recovery", async (childT) => {
    const fixture = await createInitializationFixture(childT, "authority-mode");
    await interruptUpdate(fixture.root, `{
      afterTransactionStagingReservation: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);
    const artifacts = await initializationArtifacts(fixture.root);
    const configPath = join(fixture.root, ".sdd", "config.yaml");
    const before = await lstat(configPath);
    await chmod(configPath, (before.mode & 0o777) ^ 0o040);

    await assert.rejects(
      recoverUpdateMigration(
        fixture.root,
        { destinationWorkspaceRoot: fixture.root },
      ),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await pathExists(artifacts.stagingRoot), true);
    assert.equal(await pathExists(artifacts.reservationPath), true);
    assert.equal(await pathExists(artifacts.bindingPath), true);
  });

  await t.test("a forged initial journal survives failed recovery", async (childT) => {
    const fixture = await createInitializationFixture(childT, "forged-journal");
    await interruptUpdate(fixture.root, `{
      afterTransactionInitialJournal: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);
    const artifacts = await initializationArtifacts(fixture.root);
    const journal = JSON.parse(await readFile(artifacts.journalPath, "utf8"));
    journal.stagingIdentity = { dev: "0", ino: "0" };
    const forged = `${JSON.stringify(journal, null, 2)}\n`;
    await writeFile(artifacts.journalPath, forged, "utf8");

    await assert.rejects(
      recoverUpdateMigration(
        fixture.root,
        { destinationWorkspaceRoot: fixture.root },
      ),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(artifacts.journalPath, "utf8"), forged);
    assert.equal(await pathExists(artifacts.stagingRoot), true);
  });

  await t.test("a forged manifest replacement survives failed recovery", async (childT) => {
    const fixture = await createInitializationFixture(childT, "forged-manifest");
    await interruptUpdate(fixture.root, `{
      afterDestinationManifestCreate: () => process.exit(${INTERRUPTED_UPDATE_EXIT_CODE}),
    }`);
    const artifacts = await initializationArtifacts(fixture.root);
    const ownedAside = join(artifacts.stagingRoot, "owned-destinations.json");
    await rename(artifacts.manifestPath, ownedAside);
    await writeFile(artifacts.manifestPath, "{\"forged\":true}\n", "utf8");

    await assert.rejects(
      recoverUpdateMigration(
        fixture.root,
        { destinationWorkspaceRoot: fixture.root },
      ),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );
    assert.equal(await readFile(artifacts.manifestPath, "utf8"), "{\"forged\":true}\n");
    assert.equal(await pathExists(ownedAside), true);
    assert.equal(await pathExists(artifacts.reservationPath), true);
  });
});