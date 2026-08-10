import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  cp,
  link,
  mkdir,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  writeFile,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { promisify } from "node:util";

import {
  createWorkspaceConfigFromLegacyHome,
  readWorkspaceConfig,
} from "../src/config.js";
import { setupInstallation } from "../src/commands/init-installation.js";
import {
  BUNDLED_SKILLS_DIRECTORY,
  CLOSED_CHANGES_DIRECTORY_NAME,
  WORKFLOW_RELATIVE_PATH,
  WORKFLOW_SOURCE_PATH,
} from "../src/constants.js";
import { hashDirectory, hashFile, pathExists } from "../src/fs.js";
import { serializeManagedInstallationLock } from "../src/installation.js";
import {
  applyLegacyUserMigration,
  cleanupRetiredLegacyDirectories,
  planLegacyUserMigration,
  recoverLegacyUserMigration,
} from "../src/legacy-user-migration.js";

const CHANGE_ID = "2026-08-07-legacy-user-transaction";
const OWNED_SKILL = "sdd-change";
const UNRELATED_SKILL = "personal-helper";
const INTERRUPTION_EXIT_CODE = 87;
const MIGRATION_MODULE_URL = new URL("../src/legacy-user-migration.js", import.meta.url).href;
const execFileAsync = promisify(execFile);

const LEGACY_CONFIG = {
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

function workspaceConfigFor(fixture) {
  return createWorkspaceConfigFromLegacyHome(
    LEGACY_CONFIG,
    fixture.legacyUserRoot,
    fixture.workspaceRoot,
  );
}

async function releasedLegacyDirectoryEntries(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  const collected = [];
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    const relativePath = relative(root, absolutePath).split(sep).join("/");
    if (entry.isDirectory()) {
      collected.push({ type: "directory", relativePath, absolutePath });
      collected.push(...await releasedLegacyDirectoryEntries(root, absolutePath));
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

async function releasedLegacyDirectoryHash(root) {
  const hash = createHash("sha256");
  for (const entry of await releasedLegacyDirectoryEntries(root)) {
    hash.update(`${entry.type}\0${entry.relativePath}\0`);
    if (entry.type === "file") hash.update(await readFile(entry.absolutePath));
    else if (entry.type === "symlink") hash.update(await readlink(entry.absolutePath));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

test("released directory hash fixture matches the develop golden digest", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sdd-released-directory-hash-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "SKILL.md"), "released skill\n", "utf8");

  assert.equal(
    await releasedLegacyDirectoryHash(root),
    "sha256:88f5273f09670ad8f1e007f56ff03a4e2bbcf42cd950bbb797f1c149d4e7bdeb",
  );
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "sdd-legacy-user-transaction-"));
  const legacyUserRoot = join(root, "legacy-user");
  const workspaceRoot = join(root, "workspace");
  const legacySddRoot = join(legacyUserRoot, ".sdd");
  const legacySkillsRoot = join(legacyUserRoot, ".agents", "skills");
  const workspaceSddRoot = join(workspaceRoot, ".sdd");
  const workspaceSkillsRoot = join(workspaceRoot, ".agents", "skills");
  const paths = {
    legacyConfig: join(legacySddRoot, "config.yaml"),
    legacyLock: join(legacySddRoot, "install-lock.json"),
    legacyChanges: join(legacySddRoot, "changes"),
    legacyChangeFile: join(legacySddRoot, "changes", CHANGE_ID, "state.txt"),
    legacyOwnedSkill: join(legacySkillsRoot, OWNED_SKILL),
    legacyUnrelatedSkill: join(legacySkillsRoot, UNRELATED_SKILL),
    legacyUnrelatedSkillFile: join(legacySkillsRoot, UNRELATED_SKILL, "SKILL.md"),
    legacyUnrelatedFile: join(legacyUserRoot, "keep.txt"),
    workspaceConfig: join(workspaceSddRoot, "config.yaml"),
    workspaceChanges: join(workspaceSddRoot, "changes"),
    workspaceChangeFile: join(workspaceSddRoot, "changes", CHANGE_ID, "state.txt"),
    workspaceWorkflow: join(workspaceSddRoot, "story-driven-development.md"),
    workspaceLock: join(workspaceSddRoot, "install-lock.json"),
    workspaceReceipt: join(workspaceSddRoot, "migrations", "from-user.json"),
    workspaceSkills: workspaceSkillsRoot,
    workspaceOwnedSkill: join(workspaceSkillsRoot, OWNED_SKILL),
  };

  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(dirname(paths.legacyChangeFile), { recursive: true });
  await writeFile(paths.legacyConfig, `${JSON.stringify(LEGACY_CONFIG, null, 2)}\n`, "utf8");
  await writeFile(paths.legacyChangeFile, "legacy change state\n", "utf8");
  await cp(
    join(BUNDLED_SKILLS_DIRECTORY, OWNED_SKILL),
    paths.legacyOwnedSkill,
    { recursive: true, verbatimSymlinks: true },
  );
  const ownedSkillHash = await hashDirectory(paths.legacyOwnedSkill);
  const releasedOwnedSkillHash = await releasedLegacyDirectoryHash(paths.legacyOwnedSkill);
  await mkdir(paths.legacyUnrelatedSkill, { recursive: true });
  await writeFile(paths.legacyUnrelatedSkillFile, "unrelated legacy skill\n", "utf8");
  await writeFile(paths.legacyUnrelatedFile, "unrelated legacy file\n", "utf8");
  await writeFile(
    paths.legacyLock,
    `${JSON.stringify({
      version: 2,
      packageVersion: "legacy-fixture",
      schemaVersion: "sdd-user-v2",
      skillsDirectory: ".agents/skills",
      managedSkills: { [OWNED_SKILL]: releasedOwnedSkillHash },
    }, null, 2)}\n`,
    "utf8",
  );

  return {
    root,
    legacyUserRoot,
    workspaceRoot,
    paths,
    ownedSkillHash,
    releasedOwnedSkillHash,
  };
}

async function createMigrationPackageCopy(t) {
  const sourcePackageRoot = dirname(BUNDLED_SKILLS_DIRECTORY);
  const packageRoot = await mkdtemp(join(sourcePackageRoot, ".legacy-recovery-package-"));
  t.after(() => rm(packageRoot, { recursive: true, force: true }));
  await Promise.all([
    cp(join(sourcePackageRoot, "src"), join(packageRoot, "src"), {
      recursive: true,
      verbatimSymlinks: true,
    }),
    cp(BUNDLED_SKILLS_DIRECTORY, join(packageRoot, "skills"), {
      recursive: true,
      verbatimSymlinks: true,
    }),
    cp(join(sourcePackageRoot, "docs"), join(packageRoot, "docs"), {
      recursive: true,
      verbatimSymlinks: true,
    }),
    cp(join(sourcePackageRoot, "package.json"), join(packageRoot, "package.json")),
  ]);
  return {
    packageRoot,
    moduleUrl: pathToFileURL(join(packageRoot, "src", "legacy-user-migration.js")).href,
    workflowPath: join(packageRoot, "docs", "story-driven-development.md"),
    skillFile: join(packageRoot, "skills", OWNED_SKILL, "SKILL.md"),
    packageJsonPath: join(packageRoot, "package.json"),
  };
}

async function stagingDirectories(workspaceRoot) {
  return (await readdir(workspaceRoot))
    .filter((entry) => entry.startsWith(".sdd-from-user-"))
    .sort();
}
async function installTransientAuthority(fixture, path, name, substitutedSource) {
  const originalSource = await readFile(path, "utf8");
  const originalPath = join(fixture.root, `${name}.original`);
  const substitutedPath = join(fixture.root, `${name}.substituted`);
  await rename(path, originalPath);
  await writeFile(path, substitutedSource, "utf8");
  let restored = false;
  return {
    restore: async () => {
      assert.equal(restored, false, `${name} authority was restored more than once`);
      await rename(path, substitutedPath);
      await rename(originalPath, path);
      restored = true;
    },
    assertPreserved: async () => {
      assert.equal(restored, true, `${name} authority read did not reach its deterministic swap hook`);
      assert.equal(await readFile(path, "utf8"), originalSource);
      assert.equal(await readFile(substitutedPath, "utf8"), substitutedSource);
    },
  };
}


async function assertLegacySourcePresent(fixture) {
  const { paths, ownedSkillHash } = fixture;
  assert.deepEqual(JSON.parse(await readFile(paths.legacyConfig, "utf8")), LEGACY_CONFIG);
  assert.equal(await pathExists(paths.legacyLock), true);
  assert.equal(await readFile(paths.legacyChangeFile, "utf8"), "legacy change state\n");
  assert.equal(await hashDirectory(paths.legacyOwnedSkill), ownedSkillHash);
  assert.equal(await readFile(paths.legacyUnrelatedSkillFile, "utf8"), "unrelated legacy skill\n");
  assert.equal(await readFile(paths.legacyUnrelatedFile, "utf8"), "unrelated legacy file\n");
}

async function assertLegacySourceRetired(fixture) {
  const { paths } = fixture;
  assert.equal(await pathExists(paths.legacyConfig), false);
  assert.equal(await pathExists(paths.legacyLock), false);
  assert.equal(await pathExists(paths.legacyChanges), false);
  assert.equal(await pathExists(paths.legacyOwnedSkill), false);
  assert.equal(await readFile(paths.legacyUnrelatedSkillFile, "utf8"), "unrelated legacy skill\n");
  assert.equal(await readFile(paths.legacyUnrelatedFile, "utf8"), "unrelated legacy file\n");
}

async function assertCanonicalDestination(fixture, { receipt = true } = {}) {
  const { legacyUserRoot, workspaceRoot, paths, ownedSkillHash } = fixture;
  assert.deepEqual(
    await readWorkspaceConfig(workspaceRoot),
    workspaceConfigFor(fixture),
  );
  assert.equal(await readFile(paths.workspaceChangeFile, "utf8"), "legacy change state\n");
  assert.equal(
    await readFile(paths.workspaceWorkflow, "utf8"),
    await readFile(WORKFLOW_SOURCE_PATH, "utf8"),
  );
  assert.equal(await hashDirectory(paths.workspaceOwnedSkill), ownedSkillHash);

  const lock = JSON.parse(await readFile(paths.workspaceLock, "utf8"));
  assert.equal(lock.version, 3);
  assert.equal(lock.schemaVersion, "sdd-v3");
  assert.equal(lock.skillsDirectory, ".agents/skills");
  assert.equal(lock.managedSkills[OWNED_SKILL], ownedSkillHash);
  assert.deepEqual(lock.managedWorkflow, {
    path: ".sdd/story-driven-development.md",
    hash: await hashFile(WORKFLOW_SOURCE_PATH),
  });

  assert.equal(await pathExists(paths.workspaceReceipt), receipt);
  if (receipt) {
    const migrationReceipt = JSON.parse(await readFile(paths.workspaceReceipt, "utf8"));
    assert.equal(migrationReceipt.version, 1);
    assert.equal(migrationReceipt.workspaceRoot, workspaceRoot);
    assert.equal(migrationReceipt.legacyUserRoot, legacyUserRoot);
    assert.equal(Number.isNaN(Date.parse(migrationReceipt.completedAt)), false);
    assert.deepEqual(
      (await readdir(workspaceRoot)).filter(
        (name) => name.startsWith(".sdd-user-migration-authority-"),
      ),
      [],
    );
  }
}

async function interruptAfterDestinationVerification(fixture) {
  const script = `
    import {
      applyLegacyUserMigration,
      planLegacyUserMigration,
    } from ${JSON.stringify(MIGRATION_MODULE_URL)};

    const workspaceRoot = ${JSON.stringify(fixture.workspaceRoot)};
    const legacyUserRoot = ${JSON.stringify(fixture.legacyUserRoot)};
    const plan = await planLegacyUserMigration(workspaceRoot, legacyUserRoot);
    await applyLegacyUserMigration(plan, {
      afterDestinationVerified: () => process.exit(${INTERRUPTION_EXIT_CODE}),
    });
  `;
  const error = await execFileAsync(
    process.execPath,
    ["--input-type=module", "--eval", script],
    { env: process.env },
  ).then(() => null, (caught) => caught);
  assert.ok(error, "interrupted legacy migration unexpectedly completed");
  assert.equal(error.code, INTERRUPTION_EXIT_CODE, error.stderr);
}

async function interruptDuringRename(
  fixture,
  {
    publicationKind = null,
    publicationLinkKind = null,
    publicationReservationKind = null,
    publicationBackupMoveKind = null,
    publicationBackupWitnessKind = null,
    retirementKind = null,
    retirementMoveKind = null,
    retirementPayloadCopyKind = null,
    retirementRemovalSnapshotKind = null,
    retirementCrossDeviceRemovalKind = null,
    retirementWitnessKind = null,
  } = {},
  migrationModuleUrl = MIGRATION_MODULE_URL,
) {
  const script = `
    import {
      applyLegacyUserMigration,
      planLegacyUserMigration,
    } from ${JSON.stringify(migrationModuleUrl)};

    const workspaceRoot = ${JSON.stringify(fixture.workspaceRoot)};
    const legacyUserRoot = ${JSON.stringify(fixture.legacyUserRoot)};
    const publicationKind = ${JSON.stringify(publicationKind)};
    const publicationLinkKind = ${JSON.stringify(publicationLinkKind)};
    const publicationReservationKind = ${JSON.stringify(publicationReservationKind)};
    const publicationBackupMoveKind = ${JSON.stringify(publicationBackupMoveKind)};
    const publicationBackupWitnessKind = ${JSON.stringify(publicationBackupWitnessKind)};
    const retirementKind = ${JSON.stringify(retirementKind)};
    const retirementMoveKind = ${JSON.stringify(retirementMoveKind)};
    const retirementPayloadCopyKind = ${JSON.stringify(retirementPayloadCopyKind)};
    const retirementRemovalSnapshotKind = ${JSON.stringify(retirementRemovalSnapshotKind)};
    const retirementCrossDeviceRemovalKind = ${JSON.stringify(retirementCrossDeviceRemovalKind)};
    const retirementWitnessKind = ${JSON.stringify(retirementWitnessKind)};
    const interrupt = ({ record }) => {
      if (
        record.kind === publicationKind
        || record.kind === publicationLinkKind
        || record.kind === publicationReservationKind
        || record.kind === publicationBackupMoveKind
        || record.kind === publicationBackupWitnessKind
        || record.kind === retirementKind
        || record.kind === retirementMoveKind
        || record.kind === retirementPayloadCopyKind
        || record.kind === retirementRemovalSnapshotKind
        || record.kind === retirementCrossDeviceRemovalKind
        || record.kind === retirementWitnessKind
      ) {
        process.exit(${INTERRUPTION_EXIT_CODE});
      }
    };
    const forceCrossDevice = ({ record }) => {
      if (record.kind !== retirementCrossDeviceRemovalKind) return;
      const error = new Error("forced cross-device transfer");
      error.code = "EXDEV";
      throw error;
    };
    const forceBackupCrossDevice = ({ record }) => {
      if (record.kind !== publicationBackupWitnessKind) return;
      const error = new Error("forced cross-device backup transfer");
      error.code = "EXDEV";
      throw error;
    };
    const plan = await planLegacyUserMigration(workspaceRoot, legacyUserRoot);
    await applyLegacyUserMigration(plan, {
      afterPublicationRename: publicationKind ? interrupt : undefined,
      afterPublicationLink: publicationLinkKind ? interrupt : undefined,
      afterPublicationReservation: publicationReservationKind ? interrupt : undefined,
      afterPublicationBackupMove: publicationBackupMoveKind ? interrupt : undefined,
      beforePublicationBackupRenameAttempt: publicationBackupWitnessKind
        ? forceBackupCrossDevice
        : undefined,
      beforePublicationBackupWitness: publicationBackupWitnessKind ? interrupt : undefined,
      afterSourceRetirementRename: retirementKind ? interrupt : undefined,
      afterSourceRetirementMove: retirementMoveKind ? interrupt : undefined,
      afterSourceRetirementPayloadCopy: retirementPayloadCopyKind ? interrupt : undefined,
      beforeSourceRetirementWitness: retirementWitnessKind ? interrupt : undefined,
      beforeSourceRetirementRenameAttempt: retirementCrossDeviceRemovalKind
        ? forceCrossDevice
        : undefined,
      afterSourceRetirementCrossDeviceRemoval: retirementCrossDeviceRemovalKind
        ? interrupt
        : undefined,
      afterSourceRetirementRemovalSnapshot: retirementRemovalSnapshotKind ? interrupt : undefined,
    });
  `;
  const error = await execFileAsync(
    process.execPath,
    ["--input-type=module", "--eval", script],
    { env: process.env },
  ).then(() => null, (caught) => caught);
  assert.ok(error, "interrupted legacy migration unexpectedly completed");
  assert.equal(error.code, INTERRUPTION_EXIT_CODE, error.stderr);
}

async function interruptDuringRollbackRestore(fixture, { partialDirectory = false } = {}) {
  const script = `
    import {
      applyLegacyUserMigration,
      planLegacyUserMigration,
    } from ${JSON.stringify(MIGRATION_MODULE_URL)};

    const workspaceRoot = ${JSON.stringify(fixture.workspaceRoot)};
    const legacyUserRoot = ${JSON.stringify(fixture.legacyUserRoot)};
    const partialDirectory = ${JSON.stringify(partialDirectory)};
    const plan = await planLegacyUserMigration(workspaceRoot, legacyUserRoot);
    await applyLegacyUserMigration(plan, {
      afterPublicationRename: ({ record }) => {
        if (record.kind === "workflow") throw new Error("force rollback");
      },
      afterPublicationRollbackRestore: ({ record }) => {
        if (!partialDirectory && record.kind === "changes") {
          process.exit(${INTERRUPTION_EXIT_CODE});
        }
      },
      afterPublicationRollbackRestoreEntryCopy: ({ record }) => {
        if (partialDirectory && record.kind === "changes") {
          process.exit(${INTERRUPTION_EXIT_CODE});
        }
      },
    });
  `;
  const error = await execFileAsync(
    process.execPath,
    ["--input-type=module", "--eval", script],
    { env: process.env },
  ).then(() => null, (caught) => caught);
  assert.ok(error, "interrupted rollback unexpectedly completed");
  assert.equal(error.code, INTERRUPTION_EXIT_CODE, error.stderr);
}

async function readInterruptedJournal(fixture) {
  const staging = await stagingDirectories(fixture.workspaceRoot);
  assert.equal(staging.length, 1);
  const stageRoot = join(fixture.workspaceRoot, staging[0]);
  const journalPath = join(stageRoot, "transaction.json");
  return {
    stageRoot,
    journalPath,
    journal: JSON.parse(await readFile(journalPath, "utf8")),
  };
}

async function rewriteInterruptedJournals(interrupted, rewrite) {
  for (const name of await readdir(interrupted.stageRoot)) {
    if (!/^transaction(?:\.\d{12})?\.json$/.test(name)) continue;
    const path = join(interrupted.stageRoot, name);
    const journal = JSON.parse(await readFile(path, "utf8"));
    rewrite(journal);
    await writeFile(path, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
  }
}
async function rewriteInterruptedProvenance(
  interrupted,
  provenance,
  { rewriteAuthority = false } = {},
) {
  const source = `${JSON.stringify(provenance, null, 2)}\n`;
  await writeFile(join(interrupted.stageRoot, "transaction-provenance.json"), source, "utf8");
  await writeFile(join(interrupted.stageRoot, "transaction-provenance.proof.json"), source, "utf8");
  if (!rewriteAuthority) return;
  const workspaceRoot = dirname(interrupted.stageRoot);
  const authorityNames = (await readdir(workspaceRoot)).filter(
    (name) => name.startsWith(".sdd-user-migration-authority-") && name.endsWith(".json"),
  );
  assert.equal(authorityNames.length, 1);
  const authority = {
    version: 1,
    stageRoot: interrupted.stageRoot,
    stageIdentity: provenance.stageIdentity,
    provenanceHash: createHash("sha256").update(source).digest("hex"),
  };
  await writeFile(
    join(workspaceRoot, authorityNames[0]),
    `${JSON.stringify(authority, null, 2)}\n`,
    "utf8",
  );
}


async function seedOwnedLegacyWorkflow(fixture) {
  const workflowPath = join(fixture.legacyUserRoot, WORKFLOW_RELATIVE_PATH);
  await cp(WORKFLOW_SOURCE_PATH, workflowPath);
  const lock = JSON.parse(await readFile(fixture.paths.legacyLock, "utf8"));
  lock.managedWorkflow = {
    path: WORKFLOW_RELATIVE_PATH,
    hash: await hashFile(workflowPath),
  };
  await writeFile(fixture.paths.legacyLock, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  return workflowPath;
}

async function seedReplacementDestination(fixture) {
  const existingFile = join(
    fixture.paths.workspaceChanges,
    "2026-08-06-existing-workspace-change",
    "state.txt",
  );
  await mkdir(dirname(existingFile), { recursive: true });
  await writeFile(existingFile, "existing workspace change\n", "utf8");
  return existingFile;
}

async function assertInstallDestinationRolledBack(fixture) {
  assert.equal(await pathExists(fixture.paths.workspaceConfig), false);
  assert.equal(await pathExists(fixture.paths.workspaceChanges), false);
  assert.equal(await pathExists(fixture.paths.workspaceWorkflow), false);
  assert.equal(await pathExists(fixture.paths.workspaceLock), false);
  assert.equal(await pathExists(fixture.paths.workspaceReceipt), false);
  assert.equal(await pathExists(fixture.paths.workspaceOwnedSkill), false);
}

test("legacy user migration refuses an unresolved source-workspace locator before writing either tree", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const sourceWorkspace = join(fixture.root, "legacy-workspace");
  const legacyConfig = structuredClone(LEGACY_CONFIG);
  legacyConfig.migration = { sourceWorkspace };
  const legacySource = `${JSON.stringify(legacyConfig, null, 2)}\n`;
  await writeFile(fixture.paths.legacyConfig, legacySource, "utf8");
  const sourceBefore = await hashDirectory(fixture.legacyUserRoot);
  const destinationBefore = await hashDirectory(fixture.workspaceRoot);

  await assert.rejects(
    () => planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
    (error) => error.code === "MIGRATION_SOURCE_UNAVAILABLE"
      && error.message.includes("migration.sourceWorkspace")
      && error.message.includes("Complete that source-workspace migration")
      && error.details.includes(sourceWorkspace),
  );

  assert.equal(await hashDirectory(fixture.legacyUserRoot), sourceBefore);
  assert.equal(await hashDirectory(fixture.workspaceRoot), destinationBefore);
  assert.equal(await readFile(fixture.paths.legacyConfig, "utf8"), legacySource);
  assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
});

test("legacy user migration rejects mixed and unknown install-lock hash versions", async (t) => {
  const variants = [
    {
      label: "mixed",
      mutate: (lock) => {
        lock.managedSkills["sdd-other"] = `sha256-directory-v2:${"0".repeat(64)}`;
      },
    },
    {
      label: "unknown",
      mutate: (lock) => {
        lock.managedSkills[OWNED_SKILL] = `sha256-directory-v99:${"0".repeat(64)}`;
      },
    },
  ];
  for (const variant of variants) {
    await t.test(variant.label, async (t) => {
      const fixture = await createFixture();
      t.after(() => rm(fixture.root, { recursive: true, force: true }));
      const lock = JSON.parse(await readFile(fixture.paths.legacyLock, "utf8"));
      variant.mutate(lock);
      await writeFile(
        fixture.paths.legacyLock,
        `${JSON.stringify(lock, null, 2)}\n`,
        "utf8",
      );
      const sourceBefore = await hashDirectory(fixture.legacyUserRoot);
      const destinationBefore = await hashDirectory(fixture.workspaceRoot);

      await assert.rejects(
        () => planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
        (error) => error.code === "INVALID_INSTALL_LOCK",
      );

      assert.equal(await hashDirectory(fixture.legacyUserRoot), sourceBefore);
      assert.equal(await hashDirectory(fixture.workspaceRoot), destinationBefore);
      assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
    });
  }
});

test("legacy user migration plans and applies a released v1 install while retiring owned source state", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const legacyConfig = {
    kind: "user",
    version: 1,
    schema: "sdd-user-v1",
    skills: { directory: "~/.agents/skills" },
    planning: {
      root: "../planning",
      plannedChangesDirectory: "planned-changes",
    },
    repositories: { roots: { source: "../repositories" } },
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
        planning: "sample",
        repositories: [
          { root: "source", path: "sample-app", status: "active" },
          { path: "~/standalone", status: "inactive" },
        ],
      },
    },
  };
  await writeFile(
    fixture.paths.legacyConfig,
    `${JSON.stringify(legacyConfig, null, 2)}\n`,
    "utf8",
  );
  const legacyLock = JSON.parse(await readFile(fixture.paths.legacyLock, "utf8"));
  legacyLock.version = 1;
  legacyLock.schemaVersion = "sdd-user-v1";
  legacyLock.skillsDirectory = "~/.agents/skills";
  assert.equal(legacyLock.managedSkills[OWNED_SKILL], fixture.releasedOwnedSkillHash);
  await writeFile(
    fixture.paths.legacyLock,
    `${JSON.stringify(legacyLock, null, 2)}\n`,
    "utf8",
  );
  const repositoryRoot = join(fixture.root, "repositories", "sample-app");
  await mkdir(join(repositoryRoot, ".sdd"), { recursive: true });
  await writeFile(
    join(repositoryRoot, ".sdd", "config.yaml"),
    `${JSON.stringify({
      kind: "repository",
      version: 2,
      schema: "sdd-repository-v2",
      id: "sample-app",
      artifacts: {
        epics: "docs/epics",
        adrs: "docs/adrs",
        audits: "docs/audits",
      },
    }, null, 2)}\n`,
    "utf8",
  );
  const plannedChangeId = "2026-08-08-v1-planned-change";
  const plannedRoot = join(fixture.root, "planning", "sample", "planned-changes");
  const plannedChange = join(plannedRoot, plannedChangeId);
  const plannedBriefName = `${plannedChangeId}.md`;
  const plannedBrief = join(plannedRoot, plannedBriefName);
  const migratedBrief = join(
    fixture.root,
    "planning",
    "sample",
    "change-briefs",
    plannedBriefName,
  );
  await mkdir(plannedChange, { recursive: true });
  await writeFile(
    join(plannedChange, "proposal.md"),
    "# Proposal\n\n## Target Repositories\n- `../repositories/sample-app`\n",
    "utf8",
  );
  await writeFile(join(plannedChange, "design.md"), "# Design\n", "utf8");
  await writeFile(
    join(plannedChange, "tasks.md"),
    "---\nstatus: planned\n---\n# Tasks\n",
    "utf8",
  );
  await writeFile(plannedBrief, "# Future capability\n", "utf8");
  const sourceBefore = await hashDirectory(fixture.legacyUserRoot);
  const destinationBefore = await hashDirectory(fixture.workspaceRoot);

  const plan = await planLegacyUserMigration(
    fixture.workspaceRoot,
    fixture.legacyUserRoot,
  );
  const expectedConfig = createWorkspaceConfigFromLegacyHome(
    legacyConfig,
    fixture.legacyUserRoot,
    fixture.workspaceRoot,
  );

  assert.equal(plan.completed, false);
  assert.deepEqual(plan.config, expectedConfig);
  assert.equal(plan.ownership.skillsRoot, dirname(fixture.paths.legacyOwnedSkill));
  assert.equal(plan.config.planning.root, join(fixture.root, "planning"));
  assert.equal(plan.config.repositories.roots.source, join(fixture.root, "repositories"));
  assert.equal(
    plan.config.ideas.sample.repositories[1].path,
    join(fixture.legacyUserRoot, "standalone"),
  );
  assert.equal(Object.hasOwn(plan.config.planning, "plannedChangesDirectory"), false);
  assert.equal(Object.hasOwn(plan.config.repositoryArtifacts, "activeChanges"), false);
  assert.equal(Object.hasOwn(plan.config.repositoryArtifacts, "closedChanges"), false);
  assert.ok(plan.result.actions.some((action) => action.kind === "workspace-config"));
  assert.ok(plan.result.actions.some((action) => action.kind === "legacy-config"));
  assert.ok(plan.result.actions.some((action) =>
    action.kind === "planned-change" && action.changeId === plannedChangeId));
  assert.ok(plan.result.actions.some((action) =>
    action.kind === "brief" && action.to === migratedBrief));
  assert.equal(await hashDirectory(fixture.legacyUserRoot), sourceBefore);
  assert.equal(await hashDirectory(fixture.workspaceRoot), destinationBefore);
  assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);

  await interruptAfterDestinationVerification(fixture);
  const recoveryPreview = await recoverLegacyUserMigration(
    fixture.workspaceRoot,
    fixture.legacyUserRoot,
    { dryRun: true },
  );
  assert.equal(recoveryPreview.recovered, 1);
  assert.equal(recoveryPreview.actions[0].action, "complete");
  assert.equal(await pathExists(plannedRoot), true);
  await recoverLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);

  assert.deepEqual(await readWorkspaceConfig(fixture.workspaceRoot), expectedConfig);
  assert.equal(
    await readFile(fixture.paths.workspaceChangeFile, "utf8"),
    "legacy change state\n",
  );
  const migratedTasks = await readFile(
    join(fixture.paths.workspaceChanges, plannedChangeId, "tasks.md"),
    "utf8",
  );
  assert.match(migratedTasks, /space:\s+sample/);
  assert.match(migratedTasks, /sample-app/);
  assert.equal(await readFile(migratedBrief, "utf8"), "# Future capability\n");
  assert.equal(await pathExists(plannedRoot), false);
  assert.equal(
    await hashDirectory(fixture.paths.workspaceOwnedSkill),
    fixture.ownedSkillHash,
  );
  assert.equal(await pathExists(fixture.paths.workspaceReceipt), true);
  await assertLegacySourceRetired(fixture);
  assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
});

test("legacy user migration accepts a semantically identical existing workspace config", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const migratedConfig = workspaceConfigFor(fixture);
  const reorderedConfig = {
    ideas: migratedConfig.ideas,
    repositoryArtifacts: {
      audits: migratedConfig.repositoryArtifacts.audits,
      adrs: migratedConfig.repositoryArtifacts.adrs,
      epics: migratedConfig.repositoryArtifacts.epics,
    },
    repositories: migratedConfig.repositories,
    planning: migratedConfig.planning,
    skills: migratedConfig.skills,
    schema: migratedConfig.schema,
    version: migratedConfig.version,
  };
  await mkdir(dirname(fixture.paths.workspaceConfig), { recursive: true });
  await writeFile(
    fixture.paths.workspaceConfig,
    `${JSON.stringify(reorderedConfig, null, 2)}\n`,
    "utf8",
  );
  const sourceBefore = await hashDirectory(fixture.legacyUserRoot);
  const destinationBefore = await hashDirectory(fixture.workspaceRoot);

  const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);

  assert.deepEqual(plan.config, migratedConfig);
  assert.equal(
    plan.result.actions.find((action) => action.kind === "workspace-config")?.action,
    "reconcile",
  );
  assert.equal(await hashDirectory(fixture.legacyUserRoot), sourceBefore);
  assert.equal(await hashDirectory(fixture.workspaceRoot), destinationBefore);
  assert.deepEqual(await readWorkspaceConfig(fixture.workspaceRoot), reorderedConfig);
  assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
  await assertLegacySourcePresent(fixture);
});

test("legacy user migration refuses a divergent valid workspace config without mutation", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const divergentConfig = structuredClone(workspaceConfigFor(fixture));
  divergentConfig.ideas.existing = {
    status: "active",
    repositories: [],
  };
  const destinationSource = `${JSON.stringify(divergentConfig, null, 2)}\n`;
  await mkdir(dirname(fixture.paths.workspaceConfig), { recursive: true });
  await writeFile(fixture.paths.workspaceConfig, destinationSource, "utf8");
  const sourceBefore = await hashDirectory(fixture.legacyUserRoot);
  const destinationBefore = await hashDirectory(fixture.workspaceRoot);

  await assert.rejects(
    () => planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
    (error) => error.code === "MIGRATION_DESTINATION_COLLISION"
      && error.message.includes("differs from the migrated legacy configuration"),
  );

  assert.equal(await hashDirectory(fixture.legacyUserRoot), sourceBefore);
  assert.equal(await hashDirectory(fixture.workspaceRoot), destinationBefore);
  assert.equal(await readFile(fixture.paths.workspaceConfig, "utf8"), destinationSource);
  assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
  await assertLegacySourcePresent(fixture);
});

test("legacy user migration validates an existing destination config before writing either tree", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const collision = "version: 3\nschema: sdd-v3\nideas: not-a-mapping\n";
  await mkdir(dirname(fixture.paths.workspaceConfig), { recursive: true });
  await writeFile(fixture.paths.workspaceConfig, collision, "utf8");
  const sourceBefore = await hashDirectory(fixture.legacyUserRoot);
  const destinationBefore = await hashDirectory(fixture.workspaceRoot);

  await assert.rejects(
    () => planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
    (error) => error.code === "MIGRATION_DESTINATION_COLLISION"
      && error.message.includes("not a valid workspace configuration"),
  );

  assert.equal(await hashDirectory(fixture.legacyUserRoot), sourceBefore);
  assert.equal(await hashDirectory(fixture.workspaceRoot), destinationBefore);
  assert.equal(await readFile(fixture.paths.workspaceConfig, "utf8"), collision);
  assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
  await assertLegacySourcePresent(fixture);
});

test("legacy user migration refuses divergent same-ID Change destinations before writing either tree", async (t) => {
  for (const { name, destinationSegments } of [
    { name: "active destination", destinationSegments: [] },
    { name: "closed destination", destinationSegments: ["closed"] },
  ]) {
    await t.test(name, async (t) => {
      const fixture = await createFixture();
      t.after(() => rm(fixture.root, { recursive: true, force: true }));
      const destinationChangeFile = join(
        fixture.paths.workspaceChanges,
        ...destinationSegments,
        CHANGE_ID,
        "state.txt",
      );
      await mkdir(dirname(destinationChangeFile), { recursive: true });
      await writeFile(destinationChangeFile, "divergent workspace change state\n", "utf8");
      const sourceBefore = await hashDirectory(fixture.legacyUserRoot);
      const destinationBefore = await hashDirectory(fixture.workspaceRoot);

      await assert.rejects(
        () => planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
        (error) => error.code === "CHANGE_DESTINATION_CONFLICT"
          && error.message.includes(CHANGE_ID),
      );

      assert.equal(await hashDirectory(fixture.legacyUserRoot), sourceBefore);
      assert.equal(await hashDirectory(fixture.workspaceRoot), destinationBefore);
      assert.equal(await readFile(fixture.paths.legacyChangeFile, "utf8"), "legacy change state\n");
      assert.equal(await readFile(destinationChangeFile, "utf8"), "divergent workspace change state\n");
      assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
    });
  }
});

test("legacy user migration rejects lexical and physical aliases between retired skills and workspace skills", async (t) => {
  for (const { name, physicalAlias } of [
    { name: "lexically identical skill roots", physicalAlias: false },
    { name: "physically aliased skill roots", physicalAlias: true },
  ]) {
    await t.test(name, async (t) => {
      const fixture = await createFixture();
      t.after(() => rm(fixture.root, { recursive: true, force: true }));
      const legacySkillsRoot = dirname(fixture.paths.legacyOwnedSkill);
      const nestedWorkspaceRoot = join(fixture.legacyUserRoot, "src", "workspace");
      const workspaceSkillsRoot = join(nestedWorkspaceRoot, ".agents", "skills");
      await mkdir(dirname(workspaceSkillsRoot), { recursive: true });
      await rename(legacySkillsRoot, workspaceSkillsRoot);

      const configuredDirectory = physicalAlias
        ? ".agents/skills"
        : "src/workspace/.agents/skills";
      if (physicalAlias) {
        await symlink(workspaceSkillsRoot, legacySkillsRoot, "dir");
      }
      const legacyConfig = structuredClone(LEGACY_CONFIG);
      legacyConfig.skills.directory = configuredDirectory;
      await writeFile(
        fixture.paths.legacyConfig,
        `${JSON.stringify(legacyConfig, null, 2)}\n`,
        "utf8",
      );
      const legacyLock = JSON.parse(await readFile(fixture.paths.legacyLock, "utf8"));
      legacyLock.skillsDirectory = configuredDirectory;
      await writeFile(
        fixture.paths.legacyLock,
        `${JSON.stringify(legacyLock, null, 2)}\n`,
        "utf8",
      );
      const retirementSource = physicalAlias ? legacySkillsRoot : workspaceSkillsRoot;
      const sourceBefore = await hashDirectory(fixture.legacyUserRoot);
      const destinationBefore = await hashDirectory(nestedWorkspaceRoot);

      await assert.rejects(
        () => planLegacyUserMigration(nestedWorkspaceRoot, fixture.legacyUserRoot),
        (error) => error.code === "INVALID_MIGRATION_SOURCE"
          && error.message.includes("Legacy skill cleanup root")
          && error.details.includes(`Retirement source: ${retirementSource}`)
          && error.details.includes(`Workspace destination: ${workspaceSkillsRoot}`),
      );

      assert.equal(await hashDirectory(fixture.legacyUserRoot), sourceBefore);
      assert.equal(await hashDirectory(nestedWorkspaceRoot), destinationBefore);
      assert.equal(await pathExists(join(nestedWorkspaceRoot, ".sdd")), false);
      assert.deepEqual(await stagingDirectories(nestedWorkspaceRoot), []);
    });
  }
});

test("legacy user migration permits a disjoint workspace beneath the nonrecursive skill parent cleanup root", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const nestedWorkspaceRoot = join(
    fixture.legacyUserRoot,
    ".agents",
    "workspace",
  );
  await mkdir(nestedWorkspaceRoot, { recursive: true });
  const sourceBefore = await hashDirectory(fixture.legacyUserRoot);
  const destinationBefore = await hashDirectory(nestedWorkspaceRoot);

  const plan = await planLegacyUserMigration(
    nestedWorkspaceRoot,
    fixture.legacyUserRoot,
  );

  assert.equal(
    plan.skillPlan.skillsDirectory,
    join(nestedWorkspaceRoot, ".agents", "skills"),
  );
  assert.equal(await hashDirectory(fixture.legacyUserRoot), sourceBefore);
  assert.equal(await hashDirectory(nestedWorkspaceRoot), destinationBefore);
  assert.equal(await pathExists(join(nestedWorkspaceRoot, ".sdd")), false);
  assert.deepEqual(await stagingDirectories(nestedWorkspaceRoot), []);
});


test("legacy user migration rejects nested symlinks in Change and recovery trees before writes", async (t) => {
  for (const { name, linkPath } of [
    {
      name: "legacy Change descendant",
      linkPath: (fixture) => join(
        fixture.paths.legacyChanges,
        CHANGE_ID,
        "nested",
        "tasks.md",
      ),
    },
    {
      name: "legacy recovery descendant",
      linkPath: (fixture) => join(
        fixture.legacyUserRoot,
        ".sdd",
        "session-state",
        "nested",
        "tasks.md",
      ),
    },
    {
      name: "canonical Change descendant",
      linkPath: (fixture) => join(
        fixture.paths.workspaceChanges,
        "2026-08-08-existing-workspace-change",
        "nested",
        "tasks.md",
      ),
    },
  ]) {
    await t.test(name, async (t) => {
      const fixture = await createFixture();
      t.after(() => rm(fixture.root, { recursive: true, force: true }));
      const externalTasks = join(fixture.root, `${name.replaceAll(" ", "-")}-tasks.md`);
      const nestedLink = linkPath(fixture);
      await writeFile(externalTasks, "external task authority\n", "utf8");
      await mkdir(dirname(nestedLink), { recursive: true });
      await symlink(externalTasks, nestedLink);
      const sourceBefore = await hashDirectory(fixture.legacyUserRoot);
      const destinationBefore = await hashDirectory(fixture.workspaceRoot);

      await assert.rejects(
        () => planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
        (error) => error.code === "UNSAFE_MIGRATION_PATH"
          && error.message.includes("symbolic link")
          && error.message.includes(nestedLink),
      );

      assert.equal(await hashDirectory(fixture.legacyUserRoot), sourceBefore);
      assert.equal(await hashDirectory(fixture.workspaceRoot), destinationBefore);
      assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
    });
  }
});

test("legacy user migration rejects unsupported Change descendants before writes", async (t) => {
  if (process.platform === "win32") {
    t.skip("named pipes require a POSIX filesystem");
    return;
  }
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const unsupportedPath = join(
    fixture.paths.legacyChanges,
    CHANGE_ID,
    "nested",
    "artifact.pipe",
  );
  await mkdir(dirname(unsupportedPath), { recursive: true });
  await execFileAsync("mkfifo", [unsupportedPath]);
  const sourceBefore = await hashDirectory(fixture.legacyUserRoot);
  const destinationBefore = await hashDirectory(fixture.workspaceRoot);

  await assert.rejects(
    () => planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
    (error) => error.code === "UNSAFE_MIGRATION_PATH"
      && error.message.includes("unsupported filesystem entry")
      && error.message.includes(unsupportedPath),
  );

  assert.equal(await hashDirectory(fixture.legacyUserRoot), sourceBefore);
  assert.equal(await hashDirectory(fixture.workspaceRoot), destinationBefore);
  assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
});

test("released v2 legacy user lock migrates ordinary nested Change and recovery trees", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const releasedLock = JSON.parse(await readFile(fixture.paths.legacyLock, "utf8"));
  assert.equal(releasedLock.version, 2);
  assert.equal(
    releasedLock.managedSkills[OWNED_SKILL],
    fixture.releasedOwnedSkillHash,
  );
  const changeTasks = join(
    fixture.paths.legacyChanges,
    CHANGE_ID,
    "nested",
    "tasks.md",
  );
  const recoveryState = join(
    fixture.legacyUserRoot,
    ".sdd",
    "session-state",
    "nested",
    "state.json",
  );
  await mkdir(dirname(changeTasks), { recursive: true });
  await mkdir(dirname(recoveryState), { recursive: true });
  await writeFile(changeTasks, "- [ ] migrate safely\n", "utf8");
  await writeFile(recoveryState, "{\"safe\":true}\n", "utf8");

  const plan = await planLegacyUserMigration(
    fixture.workspaceRoot,
    fixture.legacyUserRoot,
  );
  await applyLegacyUserMigration(plan);

  await assertCanonicalDestination(fixture);
  assert.equal(
    await readFile(join(
      fixture.paths.workspaceChanges,
      CHANGE_ID,
      "nested",
      "tasks.md",
    ), "utf8"),
    "- [ ] migrate safely\n",
  );
  assert.equal(
    await readFile(join(
      fixture.workspaceRoot,
      ".sdd",
      "session-state",
      "nested",
      "state.json",
    ), "utf8"),
    "{\"safe\":true}\n",
  );
  assert.equal(await pathExists(changeTasks), false);
  assert.equal(await pathExists(recoveryState), false);
  assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
});

test("legacy migration receipt metadata is reserved from recovery publication", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const legacyMigrations = join(fixture.legacyUserRoot, ".sdd", "migrations");
  const legacyReceipt = join(legacyMigrations, "from-user.json");
  const legacyMetadata = join(legacyMigrations, "keep-metadata.json");
  const receiptSource = `${JSON.stringify({
    version: 1,
    workspaceRoot: "/previous/workspace",
    legacyUserRoot: fixture.legacyUserRoot,
    marker: "legacy transaction metadata",
  }, null, 2)}\n`;
  await mkdir(legacyMigrations, { recursive: true });
  await writeFile(legacyReceipt, receiptSource, "utf8");
  await writeFile(legacyMetadata, "{\"reserved\":true}\n", "utf8");

  const plan = await planLegacyUserMigration(
    fixture.workspaceRoot,
    fixture.legacyUserRoot,
  );
  await applyLegacyUserMigration(plan);

  await assertCanonicalDestination(fixture);
  const publishedReceipt = JSON.parse(
    await readFile(fixture.paths.workspaceReceipt, "utf8"),
  );
  assert.equal(publishedReceipt.marker, undefined);
  assert.equal(await readFile(legacyReceipt, "utf8"), receiptSource);
  assert.equal(await readFile(legacyMetadata, "utf8"), "{\"reserved\":true}\n");
  assert.equal(
    await pathExists(join(fixture.workspaceRoot, ".sdd", "migrations", "keep-metadata.json")),
    false,
  );
  assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
});

test("legacy user migration requires the exact completed receipt schema", async (t) => {
  const variants = [
    {
      label: "missing completedAt",
      mutate: ({ completedAt: _completedAt, ...receipt }) => receipt,
    },
    {
      label: "unexpected field",
      mutate: (receipt) => ({ ...receipt, unexpected: true }),
    },
  ];
  for (const variant of variants) {
    await t.test(variant.label, async (t) => {
      const fixture = await createFixture();
      t.after(() => rm(fixture.root, { recursive: true, force: true }));
      await rm(fixture.paths.legacyConfig);
      const receipt = variant.mutate({
        version: 1,
        workspaceRoot: fixture.workspaceRoot,
        legacyUserRoot: fixture.legacyUserRoot,
        completedAt: "2026-08-09T00:00:00.000Z",
      });
      await mkdir(dirname(fixture.paths.workspaceReceipt), { recursive: true });
      await writeFile(
        fixture.paths.workspaceReceipt,
        `${JSON.stringify(receipt, null, 2)}\n`,
        "utf8",
      );

      await assert.rejects(
        () => planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
        (error) => error.code === "INVALID_MIGRATION_RECEIPT",
      );

      assert.deepEqual(
        JSON.parse(await readFile(fixture.paths.workspaceReceipt, "utf8")),
        receipt,
      );
      assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
    });
  }
});


test("legacy user migration binds config and install-lock authority to stable file bytes", async (t) => {
  await t.test("planning rejects a transient valid config substitution", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const substitutedConfig = structuredClone(LEGACY_CONFIG);
    substitutedConfig.planning.root = "transient-redirect";
    const substitutedSource = `${JSON.stringify(substitutedConfig, null, 2)}\n`;
    const sourceBefore = await hashDirectory(fixture.legacyUserRoot);
    const destinationBefore = await hashDirectory(fixture.workspaceRoot);
    const transient = await installTransientAuthority(
      fixture,
      fixture.paths.legacyConfig,
      "planning-config-authority",
      substitutedSource,
    );

    await assert.rejects(
      () => planLegacyUserMigration(
        fixture.workspaceRoot,
        fixture.legacyUserRoot,
        { hooks: { afterLegacyConfigAuthorityRead: transient.restore } },
      ),
      (error) => error.code === "CONCURRENT_CHANGE"
        && error.message.includes("authority bytes"),
    );

    await transient.assertPreserved();
    assert.equal(await hashDirectory(fixture.legacyUserRoot), sourceBefore);
    assert.equal(await hashDirectory(fixture.workspaceRoot), destinationBefore);
    await assertInstallDestinationRolledBack(fixture);
    assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
  });

  await t.test("planning rejects a transient valid install-lock substitution", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const victimName = "sdd-transient-victim";
    const victimPath = join(fixture.paths.legacyOwnedSkill, "..", victimName);
    await mkdir(victimPath, { recursive: true });
    await writeFile(join(victimPath, "SKILL.md"), "transient victim\n", "utf8");
    const victimHash = await hashDirectory(victimPath);
    const substitutedLock = JSON.parse(await readFile(fixture.paths.legacyLock, "utf8"));
    substitutedLock.managedSkills[victimName] = victimHash;
    const substitutedSource = `${JSON.stringify(substitutedLock, null, 2)}\n`;
    const sourceBefore = await hashDirectory(fixture.legacyUserRoot);
    const destinationBefore = await hashDirectory(fixture.workspaceRoot);
    const transient = await installTransientAuthority(
      fixture,
      fixture.paths.legacyLock,
      "planning-lock-authority",
      substitutedSource,
    );

    await assert.rejects(
      () => planLegacyUserMigration(
        fixture.workspaceRoot,
        fixture.legacyUserRoot,
        { hooks: { afterLegacyInstallLockAuthorityRead: transient.restore } },
      ),
      (error) => error.code === "CONCURRENT_CHANGE"
        && error.message.includes("authority bytes"),
    );

    await transient.assertPreserved();
    assert.equal(await hashDirectory(victimPath), victimHash);
    assert.equal(await hashDirectory(fixture.legacyUserRoot), sourceBefore);
    assert.equal(await hashDirectory(fixture.workspaceRoot), destinationBefore);
    await assertInstallDestinationRolledBack(fixture);
    assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
  });

  await t.test("apply rejects a transient config substitution during bound revalidation", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
    const substitutedConfig = structuredClone(LEGACY_CONFIG);
    substitutedConfig.planning.root = "transient-redirect";
    const substitutedSource = `${JSON.stringify(substitutedConfig, null, 2)}\n`;
    const sourceBefore = await hashDirectory(fixture.legacyUserRoot);
    const destinationBefore = await hashDirectory(fixture.workspaceRoot);
    const transient = await installTransientAuthority(
      fixture,
      fixture.paths.legacyConfig,
      "apply-config-authority",
      substitutedSource,
    );

    await assert.rejects(
      () => applyLegacyUserMigration(plan, {
        afterLegacyConfigAuthorityVerificationRead: transient.restore,
      }),
      (error) => error.code === "CONCURRENT_CHANGE"
        && error.message.includes("authority bytes"),
    );

    await transient.assertPreserved();
    assert.equal(await hashDirectory(fixture.legacyUserRoot), sourceBefore);
    assert.equal(await hashDirectory(fixture.workspaceRoot), destinationBefore);
    await assertInstallDestinationRolledBack(fixture);
    assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
  });

  await t.test("apply rejects a transient install-lock substitution before retiring its claimed skill", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const victimName = "sdd-transient-victim";
    const victimPath = join(fixture.paths.legacyOwnedSkill, "..", victimName);
    await mkdir(victimPath, { recursive: true });
    await writeFile(join(victimPath, "SKILL.md"), "transient victim\n", "utf8");
    const victimHash = await hashDirectory(victimPath);
    const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
    const substitutedLock = JSON.parse(await readFile(fixture.paths.legacyLock, "utf8"));
    substitutedLock.managedSkills[victimName] = victimHash;
    const substitutedSource = `${JSON.stringify(substitutedLock, null, 2)}\n`;
    const sourceBefore = await hashDirectory(fixture.legacyUserRoot);
    const destinationBefore = await hashDirectory(fixture.workspaceRoot);
    const transient = await installTransientAuthority(
      fixture,
      fixture.paths.legacyLock,
      "apply-lock-authority",
      substitutedSource,
    );

    await assert.rejects(
      () => applyLegacyUserMigration(plan, {
        afterLegacyInstallLockAuthorityVerificationRead: transient.restore,
      }),
      (error) => error.code === "CONCURRENT_CHANGE"
        && error.message.includes("authority bytes"),
    );

    await transient.assertPreserved();
    assert.equal(await hashDirectory(victimPath), victimHash);
    assert.equal(await hashDirectory(fixture.legacyUserRoot), sourceBefore);
    assert.equal(await hashDirectory(fixture.workspaceRoot), destinationBefore);
    await assertInstallDestinationRolledBack(fixture);
    assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
  });

  await t.test("planning preserves a divergent destination config through a transient equal substitution", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const canonicalConfig = workspaceConfigFor(fixture);
    const divergentConfig = {
      ...canonicalConfig,
      planning: { root: "workspace-owned-planning" },
    };
    await mkdir(dirname(fixture.paths.workspaceConfig), { recursive: true });
    await writeFile(
      fixture.paths.workspaceConfig,
      `${JSON.stringify(divergentConfig, null, 2)}\n`,
      "utf8",
    );
    const sourceBefore = await hashDirectory(fixture.legacyUserRoot);
    const destinationBefore = await hashDirectory(fixture.workspaceRoot);
    const substitutedSource = `${JSON.stringify(canonicalConfig, null, 2)}\n`;
    const transient = await installTransientAuthority(
      fixture,
      fixture.paths.workspaceConfig,
      "planning-destination-config-authority",
      substitutedSource,
    );

    await assert.rejects(
      () => planLegacyUserMigration(
        fixture.workspaceRoot,
        fixture.legacyUserRoot,
        { hooks: { afterDestinationConfigAuthorityRead: transient.restore } },
      ),
      (error) => error.code === "CONCURRENT_CHANGE"
        && error.message.includes("authority bytes"),
    );

    await transient.assertPreserved();
    assert.deepEqual(
      JSON.parse(await readFile(fixture.paths.workspaceConfig, "utf8")),
      divergentConfig,
    );
    assert.equal(await hashDirectory(fixture.legacyUserRoot), sourceBefore);
    assert.equal(await hashDirectory(fixture.workspaceRoot), destinationBefore);
    assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
    assert.equal(await pathExists(fixture.paths.workspaceReceipt), false);
  });
});


test("legacy user migration aborts on source drift without overwriting or retiring source state", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const sourceState = join(fixture.legacyUserRoot, ".sdd", "session-state.json");
  const destinationState = join(fixture.workspaceRoot, ".sdd", "session-state.json");
  const existingDestinationFile = join(fixture.workspaceRoot, "keep.txt");
  await writeFile(sourceState, "state at planning\n", "utf8");
  await writeFile(existingDestinationFile, "existing workspace content\n", "utf8");
  const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
  await writeFile(sourceState, "state changed after planning\n", "utf8");
  const changedSource = await hashDirectory(fixture.legacyUserRoot);

  await assert.rejects(
    () => applyLegacyUserMigration(plan),
    (error) => error.code === "CONCURRENT_CHANGE",
  );

  assert.equal(await hashDirectory(fixture.legacyUserRoot), changedSource);
  assert.equal(await readFile(sourceState, "utf8"), "state changed after planning\n");
  assert.equal(await readFile(existingDestinationFile, "utf8"), "existing workspace content\n");
  assert.equal(await pathExists(destinationState), false);
  assert.equal(await pathExists(fixture.paths.workspaceConfig), false);
  assert.equal(await pathExists(fixture.paths.workspaceChanges), false);
  assert.equal(await pathExists(fixture.paths.workspaceWorkflow), false);
  assert.equal(await pathExists(fixture.paths.workspaceLock), false);
  assert.equal(await pathExists(fixture.paths.workspaceReceipt), false);
  assert.equal(await pathExists(fixture.paths.workspaceOwnedSkill), false);
  assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
  await assertLegacySourcePresent(fixture);
});

test("legacy user migration quarantines partial staging writes and retries cleanly", async (t) => {
  for (const { name, hooks } of [
    {
      name: "staging write",
      hooks: {
        beforeStagingWrite: () => {
          throw new Error("injected staging write failure");
        },
      },
    },
    {
      name: "staging copy",
      hooks: {
        beforeStagingCopy: ({ kind }) => {
          if (kind === "changes") throw new Error("injected staging copy failure");
        },
      },
    },
  ]) {
    await t.test(name, async (t) => {
      const fixture = await createFixture();
      t.after(() => rm(fixture.root, { recursive: true, force: true }));
      const plan = await planLegacyUserMigration(
        fixture.workspaceRoot,
        fixture.legacyUserRoot,
      );

      await assert.rejects(
        () => applyLegacyUserMigration(plan, hooks),
        /injected staging (?:write|copy) failure/,
      );

      assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
      assert.equal(
        (await readdir(fixture.workspaceRoot))
          .filter((entry) => entry.startsWith(".sdd-user-migration-incomplete-"))
          .length,
        1,
      );
      await assertInstallDestinationRolledBack(fixture);
      await assertLegacySourcePresent(fixture);

      await applyLegacyUserMigration(plan);

      await assertCanonicalDestination(fixture);
      await assertLegacySourceRetired(fixture);
      assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
    });
  }
});

test("legacy user migration retires only owned state and reruns as a completed no-op", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);

  assert.equal(plan.completed, false);
  assert.equal(plan.destinationConfigPath, fixture.paths.workspaceConfig);
  assert.equal(plan.changes.target, fixture.paths.workspaceChanges);
  assert.equal(plan.workflowPlan.target, fixture.paths.workspaceWorkflow);
  assert.equal(plan.lockPath, fixture.paths.workspaceLock);
  assert.equal(plan.skillPlan.skillsDirectory, fixture.paths.workspaceSkills);
  await applyLegacyUserMigration(plan);

  await assertCanonicalDestination(fixture);
  await assertLegacySourceRetired(fixture);
  assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
  const destinationAfterMigration = await hashDirectory(fixture.workspaceRoot);
  const sourceAfterMigration = await hashDirectory(fixture.legacyUserRoot);
  const receiptAfterMigration = await readFile(fixture.paths.workspaceReceipt, "utf8");

  const rerunPlan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
  assert.equal(rerunPlan.completed, true);
  assert.deepEqual(rerunPlan.result, { required: false, actions: [], warnings: [] });
  const rerun = await applyLegacyUserMigration(rerunPlan);

  assert.equal(rerun.migration.required, false);
  assert.equal(rerun.workflow, null);
  assert.equal(rerun.skills, null);
  assert.equal(await hashDirectory(fixture.workspaceRoot), destinationAfterMigration);
  assert.equal(await hashDirectory(fixture.legacyUserRoot), sourceAfterMigration);
  assert.equal(await readFile(fixture.paths.workspaceReceipt, "utf8"), receiptAfterMigration);
  await assertLegacySourceRetired(fixture);
});

test("setup reports post-commit legacy cleanup failure without rolling back migration", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const cleanupFailure = Object.assign(
    new Error("injected retired-directory cleanup failure"),
    { code: "EACCES" },
  );
  let cleanupArguments = null;

  await assert.rejects(
    () => setupInstallation(fixture.workspaceRoot, {
      fromUser: fixture.legacyUserRoot,
      cleanupRetiredLegacyDirectories: async (...args) => {
        cleanupArguments = args;
        throw cleanupFailure;
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED"
      && error.cause === cleanupFailure
      && error.errors.includes(cleanupFailure)
      && error.details.some((detail) => detail.includes(
        "Committed workspace migration was preserved and was not rolled back",
      ))
      && error.details.some((detail) => detail.includes(dirname(fixture.paths.legacyOwnedSkill)))
      && error.details.some((detail) => detail.includes("EACCES")),
  );

  assert.equal(cleanupArguments[0], fixture.legacyUserRoot);
  const retiredDirectories = cleanupArguments[1];
  assert.deepEqual(
    retiredDirectories.map(({ path }) => path).sort(),
    [
      join(fixture.legacyUserRoot, ".agents"),
      dirname(fixture.paths.legacyOwnedSkill),
      join(fixture.legacyUserRoot, ".sdd"),
    ].sort(),
  );
  for (const { identity, ownerIdentity } of retiredDirectories) {
    assert.equal(identity.kind, "directory");
    assert.equal(typeof identity.device, "string");
    assert.equal(typeof identity.inode, "string");
    assert.equal(ownerIdentity.kind, "directory");
    assert.equal(typeof ownerIdentity.device, "string");
    assert.equal(typeof ownerIdentity.inode, "string");
  }
  await assertCanonicalDestination(fixture);
  await assertLegacySourceRetired(fixture);
  assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
  assert.equal(
    (await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot)).completed,
    true,
  );
});

test("setup preserves empty no-lock skills directories outside the legacy transaction owner", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const sharedRoot = join(fixture.root, "shared");
  const sharedSkills = join(sharedRoot, "skills");
  await mkdir(sharedSkills, { recursive: true });
  await rm(fixture.paths.legacyLock);
  await writeFile(
    fixture.paths.legacyConfig,
    `${JSON.stringify({
      ...LEGACY_CONFIG,
      skills: { directory: "../shared/skills" },
    }, null, 2)}\n`,
    "utf8",
  );

  await setupInstallation(fixture.workspaceRoot, {
    fromUser: fixture.legacyUserRoot,
  });

  assert.equal(await pathExists(sharedSkills), true);
  assert.equal(await pathExists(sharedRoot), true);
  await assertCanonicalDestination(fixture);
});

test("retired-directory cleanup preserves an atomically replaced proven directory", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
  const applied = await applyLegacyUserMigration(plan);
  const legacyConfigRoot = join(fixture.legacyUserRoot, ".sdd");
  const displaced = join(fixture.root, "retired-legacy-sdd");
  const evidence = applied.retiredDirectories.find(({ path }) => path === legacyConfigRoot);
  assert.ok(evidence);
  await rename(legacyConfigRoot, displaced);
  await mkdir(legacyConfigRoot);

  await assert.rejects(
    () => cleanupRetiredLegacyDirectories(
      fixture.legacyUserRoot,
      applied.retiredDirectories,
    ),
    (error) => error.code === "CONCURRENT_CHANGE",
  );

  assert.equal(await pathExists(legacyConfigRoot), true);
  assert.equal(await pathExists(displaced), true);
});

test("retired-directory cleanup rejects a captured ancestor moved out and symlinked back", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
  const applied = await applyLegacyUserMigration(plan);
  const legacyAgents = join(fixture.legacyUserRoot, ".agents");
  const legacySkills = join(legacyAgents, "skills");
  const displacedAgents = join(fixture.root, "external-agents");
  await rm(fixture.paths.legacyUnrelatedSkill, { recursive: true });
  assert.deepEqual(await readdir(legacySkills), []);
  await rename(legacyAgents, displacedAgents);
  await symlink(displacedAgents, legacyAgents, "dir");

  await assert.rejects(
    () => cleanupRetiredLegacyDirectories(
      fixture.legacyUserRoot,
      applied.retiredDirectories,
    ),
    (error) => error.code === "CONCURRENT_CHANGE",
  );

  assert.equal((await lstat(legacyAgents)).isSymbolicLink(), true);
  assert.equal(await pathExists(join(displacedAgents, "skills")), true);
  assert.deepEqual(await readdir(join(displacedAgents, "skills")), []);
});

test("legacy planning, dry-run, and apply reject aliased fixed destinations before staging", async (t) => {
  const boundaries = [
    { label: "configuration root", parent: [], child: ".sdd" },
    { label: "Change-store root", parent: [".sdd"], child: "changes" },
    { label: "managed-skills root", parent: [], child: ".agents" },
  ];
  for (const boundary of boundaries) {
    for (const dryRun of [true, false]) {
      await t.test(`${boundary.label} ${dryRun ? "dry-run" : "apply"}`, async (t) => {
        const fixture = await createFixture();
        t.after(() => rm(fixture.root, { recursive: true, force: true }));
        const plan = dryRun
          ? null
          : await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
        const external = join(fixture.root, "external-destination");
        const parent = join(fixture.workspaceRoot, ...boundary.parent);
        const destination = join(parent, boundary.child);
        await mkdir(external, { recursive: true });
        await mkdir(parent, { recursive: true });
        await symlink(external, destination, "dir");
        const sourceBefore = await hashDirectory(fixture.legacyUserRoot);
        const destinationBefore = await hashDirectory(fixture.workspaceRoot);
        if (dryRun) {
          await assert.rejects(
            () => planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
            (error) => error.code === "UNSAFE_MIGRATION_PATH",
          );
        }
        const operation = dryRun
          ? () => setupInstallation(fixture.workspaceRoot, {
              fromUser: fixture.legacyUserRoot,
              dryRun: true,
            })
          : () => applyLegacyUserMigration(plan);
        await assert.rejects(
          operation,
          (error) => error.code === "UNSAFE_MIGRATION_PATH",
        );

        assert.equal(await hashDirectory(fixture.legacyUserRoot), sourceBefore);
        assert.equal(await hashDirectory(fixture.workspaceRoot), destinationBefore);
        assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
        assert.deepEqual(await readdir(external), []);
        await assertLegacySourcePresent(fixture);
      });
    }
  }
});

test("legacy user migration recovery completes a durable destination-verified transaction", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  await interruptAfterDestinationVerification(fixture);

  await assertCanonicalDestination(fixture, { receipt: false });
  await assertLegacySourcePresent(fixture);
  const staging = await stagingDirectories(fixture.workspaceRoot);
  assert.equal(staging.length, 1);
  const destinationBeforeRecovery = {
    config: await readFile(fixture.paths.workspaceConfig, "utf8"),
    changes: await hashDirectory(fixture.paths.workspaceChanges),
    workflow: await readFile(fixture.paths.workspaceWorkflow, "utf8"),
    lock: await readFile(fixture.paths.workspaceLock, "utf8"),
    skills: await hashDirectory(fixture.paths.workspaceSkills),
  };

  const recovery = await recoverLegacyUserMigration(
    fixture.workspaceRoot,
    fixture.legacyUserRoot,
  );

  assert.deepEqual(recovery, {
    recovered: 1,
    actions: [{
      stageRoot: join(fixture.workspaceRoot, staging[0]),
      action: "complete",
    }],
  });
  assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
  assert.deepEqual({
    config: await readFile(fixture.paths.workspaceConfig, "utf8"),
    changes: await hashDirectory(fixture.paths.workspaceChanges),
    workflow: await readFile(fixture.paths.workspaceWorkflow, "utf8"),
    lock: await readFile(fixture.paths.workspaceLock, "utf8"),
    skills: await hashDirectory(fixture.paths.workspaceSkills),
  }, destinationBeforeRecovery);
  await assertCanonicalDestination(fixture);
  await assertLegacySourceRetired(fixture);
});

test("legacy user migration recovery rolls back an install interrupted after publication rename", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  await interruptDuringRename(fixture, { publicationKind: "workspace-config" });

  const interrupted = await readInterruptedJournal(fixture);
  const record = interrupted.journal.publications.find(({ kind }) => kind === "workspace-config");
  assert.equal(record.state, "publish-intent");
  assert.equal(await pathExists(fixture.paths.workspaceConfig), true);

  const recovery = await recoverLegacyUserMigration(
    fixture.workspaceRoot,
    fixture.legacyUserRoot,
  );

  assert.deepEqual(recovery.actions, [{
    stageRoot: interrupted.stageRoot,
    action: "rollback",
  }]);
  await assertInstallDestinationRolledBack(fixture);
  await assertLegacySourcePresent(fixture);
  assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
  assert.deepEqual(
    await recoverLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
    { recovered: 0, actions: [] },
  );
});

test("legacy user migration recovery unlinks an interrupted owned file publication", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  await interruptDuringRename(fixture, { publicationLinkKind: "workspace-config" });

  const interrupted = await readInterruptedJournal(fixture);
  const record = interrupted.journal.publications.find(({ kind }) => kind === "workspace-config");
  assert.equal(record.state, "publish-intent");
  assert.equal(await pathExists(fixture.paths.workspaceConfig), true);
  assert.equal(await pathExists(record.staged), true);

  const recovery = await recoverLegacyUserMigration(
    fixture.workspaceRoot,
    fixture.legacyUserRoot,
  );

  assert.deepEqual(recovery.actions, [{
    stageRoot: interrupted.stageRoot,
    action: "rollback",
  }]);
  await assertInstallDestinationRolledBack(fixture);
  await assertLegacySourcePresent(fixture);
  assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
});

test("legacy user migration recovery rolls back a file backup interrupted after its atomic move", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const previousDestination = `${JSON.stringify(workspaceConfigFor(fixture), null, 2)}\n`;
  await mkdir(dirname(fixture.paths.workspaceConfig), { recursive: true });
  await writeFile(fixture.paths.workspaceConfig, previousDestination, "utf8");

  await interruptDuringRename(fixture, { publicationBackupMoveKind: "workspace-config" });

  const interrupted = await readInterruptedJournal(fixture);
  const record = interrupted.journal.publications.find(({ kind }) => kind === "workspace-config");
  const recoveryPath = join(`${record.backup}.transfer`, "payload");
  assert.equal(record.state, "backup-intent");
  assert.equal(await pathExists(fixture.paths.workspaceConfig), false);
  assert.equal(await readFile(recoveryPath, "utf8"), previousDestination);

  const recovery = await recoverLegacyUserMigration(
    fixture.workspaceRoot,
    fixture.legacyUserRoot,
  );

  assert.deepEqual(recovery.actions, [{
    stageRoot: interrupted.stageRoot,
    action: "rollback",
  }]);
  assert.equal(await readFile(fixture.paths.workspaceConfig, "utf8"), previousDestination);
  assert.equal(await pathExists(fixture.paths.workspaceChanges), false);
  assert.equal(await pathExists(fixture.paths.workspaceWorkflow), false);
  assert.equal(await pathExists(fixture.paths.workspaceLock), false);
  await assertLegacySourcePresent(fixture);
  assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
});

test("legacy user migration recovery resumes a cross-device file backup interrupted before source-witness creation", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const previousDestination = `${JSON.stringify(workspaceConfigFor(fixture), null, 2)}\n`;
  await mkdir(dirname(fixture.paths.workspaceConfig), { recursive: true });
  await writeFile(fixture.paths.workspaceConfig, previousDestination, "utf8");
  await interruptDuringRename(fixture, {
    publicationBackupWitnessKind: "workspace-config",
  });
  const interrupted = await readInterruptedJournal(fixture);
  const record = interrupted.journal.publications.find(
    ({ kind }) => kind === "workspace-config",
  );
  const witnessNames = (await readdir(fixture.workspaceRoot))
    .filter((name) => name.startsWith(".sdd-transfer-witness-"));

  assert.equal(record.state, "backup-intent");
  assert.equal(await pathExists(record.target), true);
  assert.equal(witnessNames.length, 1);
  assert.deepEqual(await readdir(join(fixture.workspaceRoot, witnessNames[0])), []);

  const recovery = await recoverLegacyUserMigration(
    fixture.workspaceRoot,
    fixture.legacyUserRoot,
  );

  assert.deepEqual(recovery.actions, [{
    stageRoot: interrupted.stageRoot,
    action: "rollback",
  }]);
  assert.equal(await readFile(fixture.paths.workspaceConfig, "utf8"), previousDestination);
  await assertLegacySourcePresent(fixture);
  assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
  assert.deepEqual(
    (await readdir(fixture.workspaceRoot))
      .filter((name) => name.startsWith(".sdd-transfer-witness-")),
    [],
  );
});

test("legacy user migration recovery restores a replacement interrupted after publication rename", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const existingFile = await seedReplacementDestination(fixture);

  await interruptDuringRename(fixture, { publicationKind: "changes" });

  const interrupted = await readInterruptedJournal(fixture);
  const record = interrupted.journal.publications.find(({ kind }) => kind === "changes");
  assert.equal(record.state, "publish-intent");
  assert.equal(record.previous.kind, "directory");
  assert.equal(await readFile(existingFile, "utf8"), "existing workspace change\n");
  assert.equal(
    await readFile(fixture.paths.workspaceChangeFile, "utf8"),
    "legacy change state\n",
  );

  const recovery = await recoverLegacyUserMigration(
    fixture.workspaceRoot,
    fixture.legacyUserRoot,
  );

  assert.deepEqual(recovery.actions, [{
    stageRoot: interrupted.stageRoot,
    action: "rollback",
  }]);
  assert.equal(await pathExists(fixture.paths.workspaceConfig), false);
  assert.equal(await readFile(existingFile, "utf8"), "existing workspace change\n");
  assert.equal(await pathExists(fixture.paths.workspaceChangeFile), false);
  assert.equal(await pathExists(fixture.paths.workspaceWorkflow), false);
  assert.equal(await pathExists(fixture.paths.workspaceLock), false);
  assert.equal(await pathExists(fixture.paths.workspaceReceipt), false);
  assert.equal(await pathExists(fixture.paths.workspaceOwnedSkill), false);
  await assertLegacySourcePresent(fixture);
  assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
});

test("legacy user migration recovery resumes after a durably journaled rollback restore", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const existingFile = await seedReplacementDestination(fixture);

  await interruptDuringRollbackRestore(fixture);

  const interrupted = await readInterruptedJournal(fixture);
  const record = interrupted.journal.publications.find(({ kind }) => kind === "changes");
  assert.equal(record.rollbackState, "restored");
  assert.match(record.rollbackRestoreIdentity.device, /^\d+$/);
  assert.match(record.rollbackRestoreIdentity.inode, /^\d+$/);
  assert.equal(await readFile(existingFile, "utf8"), "existing workspace change\n");

  const recovery = await recoverLegacyUserMigration(
    fixture.workspaceRoot,
    fixture.legacyUserRoot,
  );

  assert.deepEqual(recovery.actions, [{
    stageRoot: interrupted.stageRoot,
    action: "rollback",
  }]);
  assert.equal(await readFile(existingFile, "utf8"), "existing workspace change\n");
  assert.equal(await pathExists(fixture.paths.workspaceChangeFile), false);
  await assertLegacySourcePresent(fixture);
  assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
});

test("legacy user migration recovery resumes an identity-bound partial directory rollback", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const existingFile = await seedReplacementDestination(fixture);
  const secondExistingFile = join(
    fixture.paths.workspaceChanges,
    "2026-08-07-second-workspace-change",
    "state.txt",
  );
  await mkdir(dirname(secondExistingFile), { recursive: true });
  await writeFile(secondExistingFile, "second existing workspace change\n", "utf8");

  await interruptDuringRollbackRestore(fixture, { partialDirectory: true });

  const interrupted = await readInterruptedJournal(fixture);
  const record = interrupted.journal.publications.find(({ kind }) => kind === "changes");
  assert.equal(record.rollbackState, "restore-intent");
  assert.match(record.rollbackRestoreIdentity.device, /^\d+$/);
  assert.match(record.rollbackRestoreIdentity.inode, /^\d+$/);
  assert.equal((await readdir(fixture.paths.workspaceChanges)).length, 1);

  const recovery = await recoverLegacyUserMigration(
    fixture.workspaceRoot,
    fixture.legacyUserRoot,
  );

  assert.deepEqual(recovery.actions, [{
    stageRoot: interrupted.stageRoot,
    action: "rollback",
  }]);
  assert.equal(await readFile(existingFile, "utf8"), "existing workspace change\n");
  assert.equal(
    await readFile(secondExistingFile, "utf8"),
    "second existing workspace change\n",
  );
  assert.equal(await pathExists(fixture.paths.workspaceChangeFile), false);
  await assertLegacySourcePresent(fixture);
  assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
});

test("legacy user migration recovery removes only its owned empty publication reservation", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  await interruptDuringRename(fixture, { publicationReservationKind: "changes" });

  const interrupted = await readInterruptedJournal(fixture);
  const record = interrupted.journal.publications.find(({ kind }) => kind === "changes");
  assert.equal(record.state, "publish-intent");
  assert.match(record.reservation.device, /^\d+$/);
  assert.match(record.reservation.inode, /^\d+$/);
  assert.deepEqual(await readdir(fixture.paths.workspaceChanges), []);
  assert.equal(await pathExists(record.staged), true);

  const recovery = await recoverLegacyUserMigration(
    fixture.workspaceRoot,
    fixture.legacyUserRoot,
  );

  assert.deepEqual(recovery.actions, [{
    stageRoot: interrupted.stageRoot,
    action: "rollback",
  }]);
  await assertInstallDestinationRolledBack(fixture);
  await assertLegacySourcePresent(fixture);
  assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
});

test("legacy user migration recovery completes an install interrupted after source-retirement rename", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  await interruptDuringRename(fixture, { retirementKind: "changes" });

  const interrupted = await readInterruptedJournal(fixture);
  const record = interrupted.journal.retirements.find(({ kind }) => kind === "changes");
  assert.equal(interrupted.journal.phase, "retiring-source");
  assert.equal(record.state, "retire-intent");
  assert.equal(await pathExists(fixture.paths.legacyChanges), false);
  assert.equal(await pathExists(record.retired), true);

  const recovery = await recoverLegacyUserMigration(
    fixture.workspaceRoot,
    fixture.legacyUserRoot,
  );

  assert.deepEqual(recovery.actions, [{
    stageRoot: interrupted.stageRoot,
    action: "complete",
  }]);
  await assertCanonicalDestination(fixture);
  await assertLegacySourceRetired(fixture);
  assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
  assert.deepEqual(
    await recoverLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
    { recovered: 0, actions: [] },
  );
});

test("legacy user migration recovery completes from authenticated staged assets after a package upgrade", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const packageCopy = await createMigrationPackageCopy(t);
  const stagedPackage = JSON.parse(await readFile(packageCopy.packageJsonPath, "utf8"));

  await interruptDuringRename(
    fixture,
    { retirementKind: "changes" },
    packageCopy.moduleUrl,
  );
  const interrupted = await readInterruptedJournal(fixture);
  assert.equal(interrupted.journal.phase, "retiring-source");

  await writeFile(
    packageCopy.workflowPath,
    `${await readFile(packageCopy.workflowPath, "utf8")}\nUpgraded workflow asset.\n`,
    "utf8",
  );
  await writeFile(
    packageCopy.skillFile,
    `${await readFile(packageCopy.skillFile, "utf8")}\nUpgraded skill asset.\n`,
    "utf8",
  );
  await writeFile(
    packageCopy.packageJsonPath,
    `${JSON.stringify({ ...stagedPackage, version: "999.0.0" }, null, 2)}\n`,
    "utf8",
  );
  assert.notEqual(await hashFile(packageCopy.workflowPath), await hashFile(WORKFLOW_SOURCE_PATH));
  assert.notEqual(
    await hashDirectory(join(packageCopy.packageRoot, "skills", OWNED_SKILL)),
    fixture.ownedSkillHash,
  );

  const upgradedMigration = await import(packageCopy.moduleUrl);
  const recovery = await upgradedMigration.recoverLegacyUserMigration(
    fixture.workspaceRoot,
    fixture.legacyUserRoot,
  );

  assert.deepEqual(recovery.actions, [{
    stageRoot: interrupted.stageRoot,
    action: "complete",
  }]);
  await assertCanonicalDestination(fixture);
  await assertLegacySourceRetired(fixture);
  assert.equal(
    JSON.parse(await readFile(fixture.paths.workspaceLock, "utf8")).packageVersion,
    stagedPackage.version,
  );
  assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
});

test("legacy user migration recovery completes a file retirement interrupted after its atomic move", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  await interruptDuringRename(fixture, { retirementMoveKind: "config" });

  const interrupted = await readInterruptedJournal(fixture);
  const record = interrupted.journal.retirements.find(({ kind }) => kind === "config");
  const recoveryPath = join(`${record.retired}.transfer`, "payload");
  assert.equal(interrupted.journal.phase, "retiring-source");
  assert.equal(record.state, "retire-intent");
  assert.equal(await pathExists(fixture.paths.legacyConfig), false);
  assert.equal(await pathExists(record.retired), false);
  assert.deepEqual(JSON.parse(await readFile(recoveryPath, "utf8")), LEGACY_CONFIG);

  const recovery = await recoverLegacyUserMigration(
    fixture.workspaceRoot,
    fixture.legacyUserRoot,
  );

  assert.deepEqual(recovery.actions, [{
    stageRoot: interrupted.stageRoot,
    action: "complete",
  }]);

  await assertCanonicalDestination(fixture);
  await assertLegacySourceRetired(fixture);
  assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
});
test("legacy user migration recovery resumes a cross-device file retirement interrupted before source-witness creation", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await interruptDuringRename(fixture, {
    retirementCrossDeviceRemovalKind: "config",
    retirementWitnessKind: "config",
  });
  const interrupted = await readInterruptedJournal(fixture);
  const record = interrupted.journal.retirements.find(({ kind }) => kind === "config");

  assert.equal(record.state, "retire-intent");
  assert.equal(await pathExists(record.path), true);
  const witnessNames = (await readdir(fixture.legacyUserRoot))
    .filter((name) => name.startsWith(".sdd-transfer-witness-"));
  assert.equal(witnessNames.length, 1);
  assert.deepEqual(await readdir(join(fixture.legacyUserRoot, witnessNames[0])), []);

  const recovery = await recoverLegacyUserMigration(
    fixture.workspaceRoot,
    fixture.legacyUserRoot,
  );

  assert.equal(recovery.recovered, 1);
  await assertCanonicalDestination(fixture);
  await assertLegacySourceRetired(fixture);
  assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
  assert.deepEqual(
    (await readdir(fixture.legacyUserRoot))
      .filter((name) => name.startsWith(".sdd-transfer-witness-")),
    [],
  );
});

test("legacy user migration recovery completes a replacement interrupted after source-retirement rename", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const existingFile = await seedReplacementDestination(fixture);

  await interruptDuringRename(fixture, { retirementKind: "changes" });

  const interrupted = await readInterruptedJournal(fixture);
  const record = interrupted.journal.retirements.find(({ kind }) => kind === "changes");
  assert.equal(record.state, "retire-intent");
  assert.equal(await pathExists(fixture.paths.legacyChanges), false);
  assert.equal(await pathExists(record.retired), true);

  const recovery = await recoverLegacyUserMigration(
    fixture.workspaceRoot,
    fixture.legacyUserRoot,
  );

  assert.deepEqual(recovery.actions, [{
    stageRoot: interrupted.stageRoot,
    action: "complete",
  }]);
  await assertCanonicalDestination(fixture);
  assert.equal(await readFile(existingFile, "utf8"), "existing workspace change\n");
  await assertLegacySourceRetired(fixture);
  assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
});

test("legacy user migration preserves a replacement edited between its check and backup rename", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const existingFile = await seedReplacementDestination(fixture);
  const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
  let injected = false;

  await assert.rejects(
    () => applyLegacyUserMigration(plan, {
      beforePublicationBackupTransfer: async ({ record }) => {
        if (record.kind !== "changes") return;
        injected = true;
        await writeFile(existingFile, "concurrent destination edit\n", "utf8");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED",
  );

  assert.equal(injected, true);
  assert.equal(await readFile(existingFile, "utf8"), "concurrent destination edit\n");
  await assertLegacySourcePresent(fixture);
  assert.equal((await stagingDirectories(fixture.workspaceRoot)).length, 1);
});

test("legacy user migration preserves a file destination replaced before its exclusive backup link", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await mkdir(dirname(fixture.paths.workspaceConfig), { recursive: true });
  await writeFile(
    fixture.paths.workspaceConfig,
    `${JSON.stringify(workspaceConfigFor(fixture), null, 2)}\n`,
    "utf8",
  );
  const replacement = join(fixture.root, "pre-move-workspace-config");
  const replacementSource = "workspace config replaced before move\n";
  await writeFile(replacement, replacementSource, "utf8");
  const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
  let recoveryPath = null;

  await assert.rejects(
    () => applyLegacyUserMigration(plan, {
      beforePublicationBackupMove: async ({ record, recoveryPath: movedPath }) => {
        if (record.kind !== "workspace-config") return;
        recoveryPath = movedPath;
        await rename(replacement, record.target);
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED",
  );

  assert.ok(recoveryPath);
  assert.equal(await readFile(fixture.paths.workspaceConfig, "utf8"), replacementSource);
  assert.equal(await pathExists(recoveryPath), false);
});

test("legacy user migration rejects a publication parent symlink swap before its exclusive link", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const externalParent = join(fixture.root, "external-publication-parent");
  const displacedParent = join(fixture.root, "displaced-publication-parent");
  const externalSentinel = join(externalParent, "keep.txt");
  await mkdir(externalParent);
  await writeFile(externalSentinel, "external publication state\n", "utf8");
  const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
  let injected = false;

  await assert.rejects(
    () => applyLegacyUserMigration(plan, {
      beforePublicationLinkAttempt: async ({ record }) => {
        if (record.kind !== "workspace-config") return;
        injected = true;
        const parent = dirname(record.target);
        await rename(parent, displacedParent);
        await symlink(externalParent, parent, "dir");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED",
  );

  assert.equal(injected, true);
  assert.equal(await pathExists(join(externalParent, "config.yaml")), false);
  assert.equal(await readFile(externalSentinel, "utf8"), "external publication state\n");
  assert.equal(await pathExists(displacedParent), true);
  assert.equal((await stagingDirectories(fixture.workspaceRoot)).length, 1);
});

test("legacy user migration binds the rollback restoration parent before its exclusive link", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const previousDestination = `${JSON.stringify(workspaceConfigFor(fixture), null, 2)}\n`;
  await mkdir(dirname(fixture.paths.workspaceConfig), { recursive: true });
  await writeFile(fixture.paths.workspaceConfig, previousDestination, "utf8");
  const externalParent = join(fixture.root, "external-rollback-parent");
  const displacedParent = join(fixture.root, "displaced-rollback-parent");
  const externalSentinel = join(externalParent, "keep.txt");
  await mkdir(externalParent);
  await writeFile(externalSentinel, "external rollback state\n", "utf8");
  const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
  let injected = false;

  await assert.rejects(
    () => applyLegacyUserMigration(plan, {
      beforePublicationPublish: ({ record }) => {
        if (record.kind === "changes") throw new Error("force rollback");
      },
      beforePublicationRollbackRestoreLinkAttempt: async ({ record }) => {
        if (record.kind !== "workspace-config") return;
        injected = true;
        const parent = dirname(record.target);
        await rename(parent, displacedParent);
        await symlink(externalParent, parent, "dir");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED",
  );

  assert.equal(injected, true);
  assert.equal(await pathExists(join(externalParent, "config.yaml")), false);
  assert.equal(await readFile(externalSentinel, "utf8"), "external rollback state\n");
  const interrupted = await readInterruptedJournal(fixture);
  const record = interrupted.journal.publications.find(
    ({ kind }) => kind === "workspace-config",
  );
  assert.equal(record.rollbackState, "restore-intent");
  assert.equal(await readFile(record.backup, "utf8"), previousDestination);
  assert.equal((await stagingDirectories(fixture.workspaceRoot)).length, 1);
});

test("legacy user migration does not overwrite a file backup path that appears concurrently", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const previousDestination = `${JSON.stringify(workspaceConfigFor(fixture), null, 2)}\n`;
  await mkdir(dirname(fixture.paths.workspaceConfig), { recursive: true });
  await writeFile(fixture.paths.workspaceConfig, previousDestination, "utf8");
  const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
  let concurrentBackup = null;

  await assert.rejects(
    () => applyLegacyUserMigration(plan, {
      beforePublicationBackupMove: async ({ record }) => {
        if (record.kind !== "workspace-config") return;
        concurrentBackup = record.backup;
        await writeFile(record.backup, "concurrent backup path\n", "utf8");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED",
  );

  assert.ok(concurrentBackup);
  assert.equal(await readFile(concurrentBackup, "utf8"), "concurrent backup path\n");
  assert.equal(await readFile(fixture.paths.workspaceConfig, "utf8"), previousDestination);
  assert.equal((await stagingDirectories(fixture.workspaceRoot)).length, 1);
});

test("legacy user migration preserves a file destination atomically replaced after its backup move", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const previousDestination = `${JSON.stringify(workspaceConfigFor(fixture), null, 2)}\n`;
  const replacement = join(fixture.root, "concurrent-workspace-config");
  const replacementSource = "concurrent workspace config replacement\n";
  await mkdir(dirname(fixture.paths.workspaceConfig), { recursive: true });
  await writeFile(fixture.paths.workspaceConfig, previousDestination, "utf8");
  await writeFile(replacement, replacementSource, "utf8");
  const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
  let recoveryPath = null;

  await assert.rejects(
    () => applyLegacyUserMigration(plan, {
      afterPublicationBackupMove: async ({ record, recoveryPath: movedPath }) => {
        if (record.kind !== "workspace-config") return;
        recoveryPath = movedPath;
        await rename(replacement, record.target);
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED",
  );

  assert.ok(recoveryPath);
  assert.equal(await readFile(fixture.paths.workspaceConfig, "utf8"), replacementSource);
  assert.equal(await readFile(recoveryPath, "utf8"), previousDestination);
  const interrupted = await readInterruptedJournal(fixture);
  const record = interrupted.journal.publications.find(({ kind }) => kind === "workspace-config");
  assert.equal(record.state, "backup-intent");
});

test("legacy user migration preserves a file destination atomically replaced after transfer publication", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const previousDestination = `${JSON.stringify(workspaceConfigFor(fixture), null, 2)}\n`;
  const replacementSource = "concurrent workspace config after transfer\n";
  const replacement = join(fixture.root, "workspace-config-transfer-replacement");
  const displaced = join(fixture.root, "workspace-config-transfer-displaced");
  await mkdir(dirname(fixture.paths.workspaceConfig), { recursive: true });
  await writeFile(fixture.paths.workspaceConfig, previousDestination, "utf8");
  await writeFile(replacement, replacementSource, "utf8");
  const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
  let injected = false;

  await assert.rejects(
    () => applyLegacyUserMigration(plan, {
      beforePublicationBackupSourceMove: async ({ record }) => {
        if (record.kind !== "workspace-config") return;
        injected = true;
        await rename(record.target, displaced);
        await rename(replacement, record.target);
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED",
  );

  assert.equal(injected, true);
  assert.equal(await readFile(fixture.paths.workspaceConfig, "utf8"), replacementSource);
  assert.equal(await readFile(displaced, "utf8"), previousDestination);
  assert.equal((await stagingDirectories(fixture.workspaceRoot)).length, 1);
});

test("legacy user migration exclusively publishes without overwriting a destination that reappears", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const existingFile = await seedReplacementDestination(fixture);
  const concurrentFile = join(fixture.paths.workspaceChanges, "concurrent-change", "state.txt");
  const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
  let injected = false;

  await assert.rejects(
    () => applyLegacyUserMigration(plan, {
      beforePublicationPublish: async ({ record }) => {
        if (record.kind !== "changes") return;
        injected = true;
        await mkdir(dirname(concurrentFile), { recursive: true });
        await writeFile(concurrentFile, "concurrent destination\n", "utf8");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED",
  );

  assert.equal(injected, true);
  assert.equal(await readFile(concurrentFile, "utf8"), "concurrent destination\n");
  const interrupted = await readInterruptedJournal(fixture);
  const record = interrupted.journal.publications.find(({ kind }) => kind === "changes");
  assert.equal(record.state, "publish-intent");
  assert.equal(
    await readFile(
      join(record.backup, "2026-08-06-existing-workspace-change", "state.txt"),
      "utf8",
    ),
    "existing workspace change\n",
  );
  assert.equal(await pathExists(existingFile), false);
  await assertLegacySourcePresent(fixture);
});

test("legacy user migration restores a source edited immediately before retirement rename", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
  let injected = false;

  await assert.rejects(
    () => applyLegacyUserMigration(plan, {
      beforeSourceRetirementRename: async ({ record }) => {
        if (record.kind !== "changes") return;
        injected = true;
        await writeFile(fixture.paths.legacyChangeFile, "concurrent source edit\n", "utf8");
      },
    }),
    (error) => error.code === "CONCURRENT_CHANGE",
  );

  assert.equal(injected, true);
  assert.equal(await readFile(fixture.paths.legacyChangeFile, "utf8"), "concurrent source edit\n");
  await assertCanonicalDestination(fixture, { receipt: false });
  const interrupted = await readInterruptedJournal(fixture);
  const record = interrupted.journal.retirements.find(({ kind }) => kind === "changes");
  assert.equal(interrupted.journal.phase, "retiring-source");
  assert.equal(record.state, "pending");
  assert.equal(record.retired, null);
});

test("legacy user migration preserves a source that reappears after retirement rename", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
  let injected = false;

  await assert.rejects(
    () => applyLegacyUserMigration(plan, {
      afterSourceRetirementRename: async ({ record }) => {
        if (record.kind !== "changes") return;
        injected = true;
        await mkdir(dirname(fixture.paths.legacyChangeFile), { recursive: true });
        await writeFile(fixture.paths.legacyChangeFile, "concurrent source reappearance\n", "utf8");
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED",
  );

  assert.equal(injected, true);
  assert.equal(
    await readFile(fixture.paths.legacyChangeFile, "utf8"),
    "concurrent source reappearance\n",
  );
  await assertCanonicalDestination(fixture, { receipt: false });
  const interrupted = await readInterruptedJournal(fixture);
  const record = interrupted.journal.retirements.find(({ kind }) => kind === "changes");
  assert.equal(record.state, "retire-intent");
  assert.equal(
    await readFile(join(record.retired, CHANGE_ID, "state.txt"), "utf8"),
    "legacy change state\n",
  );
});

test("legacy user migration preserves a file source replaced before its exclusive retirement copy", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const replacement = join(fixture.root, "pre-move-legacy-config");
  const replacementSource = "legacy config replaced before move\n";
  await writeFile(replacement, replacementSource, "utf8");
  const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
  let recoveryPath = null;

  await assert.rejects(
    () => applyLegacyUserMigration(plan, {
      beforeSourceRetirementMove: async ({ record, recoveryPath: movedPath }) => {
        if (record.kind !== "config") return;
        recoveryPath = movedPath;
        await rename(replacement, record.path);
      },
    }),
    (error) => error.code === "CONCURRENT_CHANGE",
  );

  assert.ok(recoveryPath);
  assert.equal(await readFile(fixture.paths.legacyConfig, "utf8"), replacementSource);
  assert.equal(await pathExists(recoveryPath), false);
  const interrupted = await readInterruptedJournal(fixture);
  const record = interrupted.journal.retirements.find(({ kind }) => kind === "config");
  assert.equal(record.state, "retire-intent");
});

test("legacy user migration preserves a file source atomically replaced after its retirement move", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const replacement = join(fixture.root, "concurrent-legacy-config");
  const replacementSource = "concurrent legacy config replacement\n";
  await writeFile(replacement, replacementSource, "utf8");
  const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
  let recoveryPath = null;

  await assert.rejects(
    () => applyLegacyUserMigration(plan, {
      afterSourceRetirementMove: async ({ record, recoveryPath: movedPath }) => {
        if (record.kind !== "config") return;
        recoveryPath = movedPath;
        await rename(replacement, record.path);
      },
    }),
    (error) => error.code === "CONCURRENT_CHANGE",
  );

  assert.ok(recoveryPath);
  assert.equal(await readFile(fixture.paths.legacyConfig, "utf8"), replacementSource);
  assert.deepEqual(JSON.parse(await readFile(recoveryPath, "utf8")), LEGACY_CONFIG);
  const interrupted = await readInterruptedJournal(fixture);
  const record = interrupted.journal.retirements.find(({ kind }) => kind === "config");
  assert.equal(record.state, "retire-intent");
});

test("legacy user migration preserves a file source atomically replaced after witness publication", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const originalSource = await readFile(fixture.paths.legacyConfig, "utf8");
  const replacementSource = "concurrent legacy config after witness\n";
  const replacement = join(fixture.root, "legacy-config-witness-replacement");
  const displaced = join(fixture.root, "legacy-config-witness-displaced");
  await writeFile(replacement, replacementSource, "utf8");
  const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
  let injected = false;

  await assert.rejects(
    () => applyLegacyUserMigration(plan, {
      beforeSourceRetirementWitnessMove: async ({ record }) => {
        if (record.kind !== "config") return;
        injected = true;
        await rename(record.path, displaced);
        await rename(replacement, record.path);
      },
    }),
    (error) => error.code === "CONCURRENT_CHANGE",
  );

  assert.equal(injected, true);
  assert.equal(await readFile(fixture.paths.legacyConfig, "utf8"), replacementSource);
  assert.equal(await readFile(displaced, "utf8"), originalSource);
  assert.equal((await stagingDirectories(fixture.workspaceRoot)).length, 1);
});

test("legacy user migration completes forced cross-device file transfers with source-bound witnesses", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const existingFile = await seedReplacementDestination(fixture);
  await writeFile(
    fixture.paths.workspaceConfig,
    `${JSON.stringify(workspaceConfigFor(fixture), null, 2)}\n`,
    "utf8",
  );
  const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
  const forceCrossDevice = ({ record }) => {
    if (!["workspace-config", "config"].includes(record.kind)) return;
    const error = new Error("forced cross-device transfer");
    error.code = "EXDEV";
    throw error;
  };

  await applyLegacyUserMigration(plan, {
    beforePublicationBackupRenameAttempt: forceCrossDevice,
    beforeSourceRetirementRenameAttempt: forceCrossDevice,
    forceCrossDeviceProof: ({ record }) => record.kind === "changes",
  });

  await assertCanonicalDestination(fixture);
  await assertLegacySourceRetired(fixture);
  assert.equal(await readFile(existingFile, "utf8"), "existing workspace change\n");
  assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
  for (const root of [
    fixture.workspaceRoot,
    fixture.paths.workspaceSddRoot,
    fixture.legacyUserRoot,
    fixture.paths.legacySddRoot,
  ]) {
    assert.deepEqual(
      (await readdir(root)).filter((name) => name.startsWith(".sdd-transfer-witness-")),
      [],
    );
  }
});

test("legacy user migration restores an opaque destination moved during rollback", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const externalFile = join(fixture.root, "concurrent-workspace-config.txt");
  const concurrentChange = join(fixture.paths.workspaceChanges, "concurrent", "state.txt");
  await writeFile(externalFile, "opaque concurrent destination\n", "utf8");
  const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
  let injected = false;

  await assert.rejects(
    () => applyLegacyUserMigration(plan, {
      beforePublicationPublish: async ({ record }) => {
        if (record.kind !== "changes") return;
        await mkdir(dirname(concurrentChange), { recursive: true });
        await writeFile(concurrentChange, "force rollback\n", "utf8");
      },
      beforePublicationRollbackRename: async ({ record }) => {
        if (record.kind !== "workspace-config") return;
        injected = true;
        await rm(record.target);
        await symlink(externalFile, record.target);
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED",
  );

  assert.equal(injected, true);
  assert.equal(await readFile(fixture.paths.workspaceConfig, "utf8"), "opaque concurrent destination\n");
  assert.equal(await readFile(externalFile, "utf8"), "opaque concurrent destination\n");
  assert.equal((await stagingDirectories(fixture.workspaceRoot)).length, 1);
});

test("legacy user migration does not overwrite a retirement path that appears concurrently", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
  let concurrentRetired = null;

  await assert.rejects(
    () => applyLegacyUserMigration(plan, {
      beforeSourceRetirementRename: async ({ record }) => {
        if (record.kind !== "config") return;
        concurrentRetired = record.retired;
        await writeFile(record.retired, "concurrent retired path\n", "utf8");
      },
    }),
    (error) => error.code === "CONCURRENT_CHANGE",
  );

  assert.ok(concurrentRetired);
  assert.deepEqual(JSON.parse(await readFile(fixture.paths.legacyConfig, "utf8")), LEGACY_CONFIG);
  assert.equal(await readFile(concurrentRetired, "utf8"), "concurrent retired path\n");
  assert.equal(await pathExists(fixture.paths.workspaceReceipt), false);
});

test("legacy user migration preserves an opaque source replacement before retirement transfer", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const externalDirectory = join(fixture.root, "opaque-legacy-changes");
  const externalFile = join(externalDirectory, "opaque.txt");
  await mkdir(externalDirectory, { recursive: true });
  await writeFile(externalFile, "opaque concurrent source\n", "utf8");
  const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
  let injected = false;

  await assert.rejects(
    () => applyLegacyUserMigration(plan, {
      beforeSourceRetirementRename: async ({ record }) => {
        if (record.kind !== "changes") return;
        injected = true;
        await rm(record.path, { recursive: true });
        await symlink(externalDirectory, record.path, "dir");
      },
    }),
    (error) => error.code === "CONCURRENT_CHANGE",
  );

  assert.equal(injected, true);
  assert.equal(
    await readFile(join(fixture.paths.legacyChanges, "opaque.txt"), "utf8"),
    "opaque concurrent source\n",
  );
  const interrupted = await readInterruptedJournal(fixture);
  const record = interrupted.journal.retirements.find(({ kind }) => kind === "changes");
  assert.equal(record.state, "pending");
  assert.equal(record.retired, null);
});

test("legacy user migration re-verifies destinations after source retirement", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
  let injected = false;

  await assert.rejects(
    () => applyLegacyUserMigration(plan, {
      afterSourceRetirementRename: async ({ record }) => {
        if (record.kind !== "changes") return;
        injected = true;
        await writeFile(fixture.paths.workspaceConfig, "concurrent destination after retirement\n", "utf8");
      },
    }),
    (error) => error.code === "CONCURRENT_CHANGE",
  );

  assert.equal(injected, true);
  assert.equal(
    await readFile(fixture.paths.workspaceConfig, "utf8"),
    "concurrent destination after retirement\n",
  );
  assert.equal(await pathExists(fixture.paths.workspaceReceipt), false);
  assert.equal((await stagingDirectories(fixture.workspaceRoot)).length, 1);
});

test("legacy user migration retains authenticated copies when preserved destinations drift before commit", async (t) => {
  const variants = [
    {
      label: "Change",
      guardKind: "change",
      publicationKind: "changes",
      arrange: async (fixture) => {
        const target = dirname(fixture.paths.workspaceChangeFile);
        await mkdir(target, { recursive: true });
        await writeFile(fixture.paths.workspaceChangeFile, "legacy change state\n", "utf8");
        await mkdir(
          join(fixture.paths.workspaceChanges, CLOSED_CHANGES_DIRECTORY_NAME),
          { recursive: true },
        );
        return {
          target,
          mutate: () => rm(target, { recursive: true }),
        };
      },
    },
    {
      label: "recovery entry",
      guardKind: "recovery",
      publicationKind: "recovery",
      arrange: async (fixture) => {
        const source = join(dirname(fixture.paths.legacyConfig), "recovery-note.txt");
        const target = join(dirname(fixture.paths.workspaceConfig), "recovery-note.txt");
        await writeFile(source, "legacy recovery note\n", "utf8");
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, "legacy recovery note\n", "utf8");
        return {
          target,
          mutate: () => writeFile(target, "concurrent recovery edit\n", "utf8"),
        };
      },
    },
    {
      label: "workflow",
      guardKind: "workflow",
      publicationKind: "workflow",
      arrange: async (fixture) => {
        await seedOwnedLegacyWorkflow(fixture);
        await mkdir(dirname(fixture.paths.workspaceWorkflow), { recursive: true });
        await cp(WORKFLOW_SOURCE_PATH, fixture.paths.workspaceWorkflow);
        return {
          target: fixture.paths.workspaceWorkflow,
          mutate: () => rm(fixture.paths.workspaceWorkflow),
        };
      },
    },
    {
      label: "skill",
      guardKind: `skill:${OWNED_SKILL}`,
      publicationKind: `skill:${OWNED_SKILL}`,
      arrange: async (fixture) => {
        await mkdir(fixture.paths.workspaceSkills, { recursive: true });
        await cp(
          join(BUNDLED_SKILLS_DIRECTORY, OWNED_SKILL),
          fixture.paths.workspaceOwnedSkill,
          { recursive: true, verbatimSymlinks: true },
        );
        return {
          target: fixture.paths.workspaceOwnedSkill,
          mutate: () => writeFile(
            join(fixture.paths.workspaceOwnedSkill, "SKILL.md"),
            "concurrent skill edit\n",
            "utf8",
          ),
        };
      },
    },
    {
      label: "installation lock",
      guardKind: "installation-lock",
      publicationKind: "installation-lock",
      arrange: async (fixture) => {
        const initialPlan = await planLegacyUserMigration(
          fixture.workspaceRoot,
          fixture.legacyUserRoot,
        );
        await mkdir(dirname(fixture.paths.workspaceLock), { recursive: true });
        await writeFile(
          fixture.paths.workspaceLock,
          serializeManagedInstallationLock(initialPlan.skillPlan, initialPlan.workflowPlan),
          "utf8",
        );
        return {
          target: fixture.paths.workspaceLock,
          mutate: () => rm(fixture.paths.workspaceLock),
        };
      },
    },
  ];

  for (const variant of variants) {
    await t.test(variant.label, async (t) => {
      const fixture = await createFixture();
      t.after(() => rm(fixture.root, { recursive: true, force: true }));
      const { target, mutate } = await variant.arrange(fixture);
      const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
      let injected = false;

      await assert.rejects(
        () => applyLegacyUserMigration(plan, {
          beforeReceiptCommit: async () => {
            injected = true;
            await mutate();
          },
        }),
        (error) => error.code === "CONCURRENT_CHANGE",
      );

      assert.equal(injected, true);
      const interrupted = await readInterruptedJournal(fixture);
      assert.equal(interrupted.journal.phase, "retiring-source");
      assert.equal(
        interrupted.journal.publications.some(({ kind }) => kind === variant.publicationKind),
        false,
      );
      const guard = interrupted.journal.destinationGuards.find(
        (record) => record.kind === variant.guardKind && record.target === target,
      );
      assert.ok(guard, `missing preserved ${variant.label} destination guard`);
      assert.equal(
        guard.desired.kind === "directory"
          ? await hashDirectory(guard.staged)
          : await hashFile(guard.staged),
        guard.desired.hash,
      );
      assert.equal(
        interrupted.journal.retirements.every(({ state }) => state === "retired"),
        true,
      );
      assert.equal(await pathExists(fixture.paths.workspaceReceipt), false);
      assert.equal(await pathExists(interrupted.stageRoot), true);
    });
  }
});

test("legacy user migration rechecks preserved targets and retired sources at receipt publication", async (t) => {
  const variants = [
    {
      label: "preserved destination deletion",
      arrange: async (fixture) => {
        const target = dirname(fixture.paths.workspaceChangeFile);
        await mkdir(target, { recursive: true });
        await writeFile(fixture.paths.workspaceChangeFile, "legacy change state\n", "utf8");
        await mkdir(
          join(fixture.paths.workspaceChanges, CLOSED_CHANGES_DIRECTORY_NAME),
          { recursive: true },
        );
        return () => rm(target, { recursive: true });
      },
    },
    {
      label: "retired source reappearance",
      arrange: async (fixture) => async () => {
        await mkdir(dirname(fixture.paths.legacyConfig), { recursive: true });
        await writeFile(fixture.paths.legacyConfig, "concurrent source\n", "utf8");
      },
    },
  ];

  for (const variant of variants) {
    await t.test(variant.label, async (t) => {
      const fixture = await createFixture();
      t.after(() => rm(fixture.root, { recursive: true, force: true }));
      const mutate = await variant.arrange(fixture);
      const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
      let injected = false;

      await assert.rejects(
        () => applyLegacyUserMigration(plan, {
          beforeReceiptLink: async () => {
            injected = true;
            await mutate();
          },
        }),
        (error) => error.code === "CONCURRENT_CHANGE",
      );

      assert.equal(injected, true);
      const interrupted = await readInterruptedJournal(fixture);
      assert.equal(interrupted.journal.phase, "retiring-source");
      assert.equal(
        interrupted.journal.retirements.every(({ state }) => state === "retired"),
        true,
      );
      assert.equal(await pathExists(fixture.paths.workspaceReceipt), false);
      assert.equal(await pathExists(interrupted.stageRoot), true);
    });
  }
});

test("legacy user migration revokes its receipt when final stage-deletion verification fails", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const target = dirname(fixture.paths.workspaceChangeFile);
  await mkdir(target, { recursive: true });
  await writeFile(fixture.paths.workspaceChangeFile, "legacy change state\n", "utf8");
  await mkdir(
    join(fixture.paths.workspaceChanges, CLOSED_CHANGES_DIRECTORY_NAME),
    { recursive: true },
  );
  const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
  let injected = false;

  await assert.rejects(
    () => applyLegacyUserMigration(plan, {
      afterStageCleanupSnapshot: async () => {
        injected = true;
        await rm(target, { recursive: true });
      },
    }),
    (error) => error.code === "CONCURRENT_CHANGE",
  );

  assert.equal(injected, true);
  const interrupted = await readInterruptedJournal(fixture);
  assert.equal(
    interrupted.journal.retirements.every(({ state }) => state === "retired"),
    true,
  );
  assert.equal(await pathExists(fixture.paths.workspaceReceipt), false);
  assert.equal(await pathExists(interrupted.stageRoot), true);
});

test("legacy user migration recovery rejects a missing preserved destination after staging", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const recoverySource = join(dirname(fixture.paths.legacyConfig), "recovery-note.txt");
  const recoveryTarget = join(dirname(fixture.paths.workspaceConfig), "recovery-note.txt");
  await writeFile(recoverySource, "legacy recovery note\n", "utf8");
  await mkdir(dirname(recoveryTarget), { recursive: true });
  await writeFile(recoveryTarget, "legacy recovery note\n", "utf8");

  await interruptAfterDestinationVerification(fixture);
  const interrupted = await readInterruptedJournal(fixture);
  const guard = interrupted.journal.destinationGuards.find(({ kind }) => kind === "recovery");
  assert.ok(guard);
  assert.equal(
    interrupted.journal.publications.some(({ kind }) => kind === "recovery"),
    false,
  );
  await rm(recoveryTarget);

  await assert.rejects(
    () => recoverLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
    (error) => error.code === "CONCURRENT_CHANGE",
  );

  assert.equal(await readFile(recoverySource, "utf8"), "legacy recovery note\n");
  assert.equal(await readFile(guard.staged, "utf8"), "legacy recovery note\n");
  assert.equal(await pathExists(fixture.paths.workspaceReceipt), false);
  assert.equal(await pathExists(interrupted.stageRoot), true);
});

test("legacy user migration recovery rejects a removed preserved Change guard before retirement", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const target = dirname(fixture.paths.workspaceChangeFile);
  await mkdir(target, { recursive: true });
  await writeFile(fixture.paths.workspaceChangeFile, "legacy change state\n", "utf8");
  await mkdir(
    join(fixture.paths.workspaceChanges, CLOSED_CHANGES_DIRECTORY_NAME),
    { recursive: true },
  );

  await interruptAfterDestinationVerification(fixture);
  const interrupted = await readInterruptedJournal(fixture);
  const guard = interrupted.journal.destinationGuards.find(({ kind }) => kind === "change");
  assert.ok(guard);
  const provenancePath = join(interrupted.stageRoot, "transaction-provenance.json");
  const provenance = JSON.parse(await readFile(provenancePath, "utf8"));
  await rewriteInterruptedJournals(interrupted, (journal) => {
    journal.destinationGuards = journal.destinationGuards.filter(
      ({ kind }) => kind !== "change",
    );
  });
  provenance.destinationGuards = provenance.destinationGuards.filter(
    ({ kind }) => kind !== "change",
  );
  await rm(guard.staged, { recursive: true });
  await rm(target, { recursive: true });
  await rewriteInterruptedProvenance(interrupted, provenance, { rewriteAuthority: true });

  await assert.rejects(
    () => recoverLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
    (error) => error.code === "INVALID_MIGRATION_JOURNAL",
  );

  assert.equal(await readFile(fixture.paths.legacyChangeFile, "utf8"), "legacy change state\n");
  assert.equal(await pathExists(fixture.paths.workspaceReceipt), false);
  assert.equal(await pathExists(interrupted.stageRoot), true);
});

test("legacy user migration recovery binds rewritten preserved guards to source authority", async (t) => {
  const variants = [
    {
      label: "workflow",
      kind: "workflow",
      arrange: async (fixture) => {
        const sourcePath = await seedOwnedLegacyWorkflow(fixture);
        await mkdir(dirname(fixture.paths.workspaceWorkflow), { recursive: true });
        await cp(WORKFLOW_SOURCE_PATH, fixture.paths.workspaceWorkflow);
        return {
          sourcePath,
          sourceKind: "file",
          sourceHash: await hashFile(sourcePath),
        };
      },
      rewrite: async (fixture, guard) => {
        await writeFile(fixture.paths.workspaceWorkflow, "forged workflow\n", "utf8");
        await writeFile(guard.staged, "forged workflow\n", "utf8");
        return hashFile(guard.staged);
      },
    },
    {
      label: "skill",
      kind: `skill:${OWNED_SKILL}`,
      arrange: async (fixture) => {
        await mkdir(fixture.paths.workspaceSkills, { recursive: true });
        await cp(
          join(BUNDLED_SKILLS_DIRECTORY, OWNED_SKILL),
          fixture.paths.workspaceOwnedSkill,
          { recursive: true, verbatimSymlinks: true },
        );
        return {
          sourcePath: fixture.paths.legacyOwnedSkill,
          sourceKind: "directory",
          sourceHash: fixture.ownedSkillHash,
        };
      },
      rewrite: async (fixture, guard) => {
        await writeFile(
          join(fixture.paths.workspaceOwnedSkill, "SKILL.md"),
          "forged skill\n",
          "utf8",
        );
        await writeFile(join(guard.staged, "SKILL.md"), "forged skill\n", "utf8");
        return hashDirectory(guard.staged);
      },
    },
    {
      label: "installation lock",
      kind: "installation-lock",
      arrange: async (fixture) => {
        const initialPlan = await planLegacyUserMigration(
          fixture.workspaceRoot,
          fixture.legacyUserRoot,
        );
        await mkdir(dirname(fixture.paths.workspaceLock), { recursive: true });
        await writeFile(
          fixture.paths.workspaceLock,
          serializeManagedInstallationLock(initialPlan.skillPlan, initialPlan.workflowPlan),
          "utf8",
        );
        return {
          sourcePath: fixture.paths.legacyLock,
          sourceKind: "file",
          sourceHash: await hashFile(fixture.paths.legacyLock),
        };
      },
      rewrite: async (fixture, guard) => {
        const workspaceConfig = workspaceConfigFor(fixture);
        const forged = `${JSON.stringify({
          version: workspaceConfig.version,
          packageVersion: "forged",
          schemaVersion: workspaceConfig.schema,
          skillsDirectory: workspaceConfig.skills.directory,
          managedSkills: {},
          managedWorkflow: {
            path: WORKFLOW_RELATIVE_PATH,
            hash: `sha256:${"0".repeat(64)}`,
          },
        }, null, 2)}\n`;
        await writeFile(fixture.paths.workspaceLock, forged, "utf8");
        await writeFile(guard.staged, forged, "utf8");
        return hashFile(guard.staged);
      },
    },
  ];

  for (const variant of variants) {
    await t.test(variant.label, async (t) => {
      const fixture = await createFixture();
      t.after(() => rm(fixture.root, { recursive: true, force: true }));
      const source = await variant.arrange(fixture);
      await interruptAfterDestinationVerification(fixture);
      const interrupted = await readInterruptedJournal(fixture);
      const guard = interrupted.journal.destinationGuards.find(
        ({ kind }) => kind === variant.kind,
      );
      assert.ok(guard);
      const provenancePath = join(interrupted.stageRoot, "transaction-provenance.json");
      const provenance = JSON.parse(await readFile(provenancePath, "utf8"));
      const provenGuard = provenance.destinationGuards.find(
        ({ kind }) => kind === variant.kind,
      );
      assert.ok(provenGuard);

      guard.desired.hash = await variant.rewrite(fixture, guard);
      provenGuard.desired = structuredClone(guard.desired);
      await rewriteInterruptedJournals(interrupted, (journal) => {
        const rewrittenGuard = journal.destinationGuards.find(
          ({ kind }) => kind === variant.kind,
        );
        rewrittenGuard.desired = structuredClone(guard.desired);
      });
      await rewriteInterruptedProvenance(interrupted, provenance, { rewriteAuthority: true });

      await assert.rejects(
        () => recoverLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
        (error) => error.code === "INVALID_MIGRATION_JOURNAL",
      );

      assert.equal(
        source.sourceKind === "directory"
          ? await hashDirectory(source.sourcePath)
          : await hashFile(source.sourcePath),
        source.sourceHash,
      );
      assert.equal(await pathExists(fixture.paths.workspaceReceipt), false);
      assert.equal(await pathExists(interrupted.stageRoot), true);
    });
  }
});

test("legacy user migration guards the complete unchanged Change root before retirement", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const opaqueName = "opaque.txt";
  const legacyOpaque = join(fixture.paths.legacyChanges, opaqueName);
  await writeFile(legacyOpaque, "legacy opaque state\n", "utf8");
  await mkdir(
    join(fixture.paths.legacyChanges, CLOSED_CHANGES_DIRECTORY_NAME),
    { recursive: true },
  );
  await mkdir(dirname(fixture.paths.workspaceChanges), { recursive: true });
  await cp(fixture.paths.legacyChanges, fixture.paths.workspaceChanges, {
    recursive: true,
    verbatimSymlinks: true,
  });
  const workspaceOpaque = join(fixture.paths.workspaceChanges, opaqueName);
  const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
  let guard = null;

  await assert.rejects(
    () => applyLegacyUserMigration(plan, {
      beforeReceiptCommit: async ({ state }) => {
        guard = state.destinationGuards.find(({ kind }) => kind === "changes-root");
        assert.ok(guard);
        await rm(workspaceOpaque);
      },
    }),
    (error) => error.code === "CONCURRENT_CHANGE",
  );

  const interrupted = await readInterruptedJournal(fixture);
  assert.equal(
    interrupted.journal.publications.some(({ kind }) => kind === "changes"),
    false,
  );
  assert.equal(await readFile(join(guard.staged, opaqueName), "utf8"), "legacy opaque state\n");
  const retirement = interrupted.journal.retirements.find(({ kind }) => kind === "changes");
  assert.ok(retirement);
  assert.equal(await readFile(join(retirement.retired, opaqueName), "utf8"), "legacy opaque state\n");
  assert.equal(await pathExists(fixture.paths.workspaceReceipt), false);
  assert.equal(await pathExists(interrupted.stageRoot), true);
});

test("legacy user migration recovery binds workspace config to authenticated legacy config", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await interruptAfterDestinationVerification(fixture);
  const interrupted = await readInterruptedJournal(fixture);
  const publication = interrupted.journal.publications.find(
    ({ kind }) => kind === "workspace-config",
  );
  assert.ok(publication);
  const forgedConfig = {
    ...workspaceConfigFor(fixture),
    planning: { root: "attacker-planning" },
  };
  const forgedSource = `${JSON.stringify(forgedConfig, null, 2)}\n`;
  await writeFile(publication.staged, forgedSource, "utf8");
  await writeFile(publication.target, forgedSource, "utf8");
  const forgedHash = await hashFile(publication.staged);
  const provenancePath = join(interrupted.stageRoot, "transaction-provenance.json");
  const provenance = JSON.parse(await readFile(provenancePath, "utf8"));
  const provenPublication = provenance.publications.find(
    ({ kind }) => kind === "workspace-config",
  );
  assert.ok(provenPublication);
  provenPublication.desired.hash = forgedHash;
  await rewriteInterruptedJournals(interrupted, (journal) => {
    const rewritten = journal.publications.find(({ kind }) => kind === "workspace-config");
    rewritten.desired.hash = forgedHash;
  });
  await rewriteInterruptedProvenance(interrupted, provenance, { rewriteAuthority: true });

  await assert.rejects(
    () => recoverLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
    (error) => error.code === "INVALID_MIGRATION_JOURNAL",
  );

  assert.deepEqual(JSON.parse(await readFile(fixture.paths.legacyConfig, "utf8")), LEGACY_CONFIG);
  assert.equal(await pathExists(fixture.paths.workspaceReceipt), false);
  assert.equal(await pathExists(interrupted.stageRoot), true);
});

test("legacy user migration rechecks every retired source immediately before receipt commit", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
  let injected = false;

  await assert.rejects(
    () => applyLegacyUserMigration(plan, {
      beforeReceiptCommit: async ({ state }) => {
        const changes = state.retirements.find(({ kind }) => kind === "changes");
        assert.equal(changes.state, "retired");
        assert.equal(state.retirements.every(({ state: status }) => status === "retired"), true);
        injected = true;
        await mkdir(dirname(fixture.paths.legacyChangeFile), { recursive: true });
        await writeFile(fixture.paths.legacyChangeFile, "reappeared legacy change\n", "utf8");
      },
    }),
    (error) => error.code === "CONCURRENT_CHANGE",
  );

  assert.equal(injected, true);
  assert.equal(
    await readFile(fixture.paths.legacyChangeFile, "utf8"),
    "reappeared legacy change\n",
  );
  const interrupted = await readInterruptedJournal(fixture);
  const changes = interrupted.journal.retirements.find(({ kind }) => kind === "changes");
  assert.equal(changes.state, "retired");
  assert.equal(
    await readFile(join(changes.retired, CHANGE_ID, "state.txt"), "utf8"),
    "legacy change state\n",
  );
  assert.equal(await pathExists(fixture.paths.workspaceReceipt), false);
  assert.equal(await pathExists(interrupted.stageRoot), true);
});

test("legacy user migration recovery binds each recovery retirement to one destination", async (t) => {
  const variants = [
    ["traversal retirement", async ({ fixture, retirement }) => {
      retirement.kind = "recovery:../keep.txt";
      retirement.path = fixture.paths.legacyUnrelatedFile;
      retirement.expected = {
        kind: "file",
        hash: await hashFile(fixture.paths.legacyUnrelatedFile),
      };
    }],
    ["mismatched publication basename", async ({ fixture, publication }) => {
      publication.target = join(dirname(fixture.paths.workspaceConfig), "different-recovery.txt");
    }],
    ["mismatched publication snapshot", async ({ retirement }) => {
      retirement.expected = {
        kind: "file",
        hash: `sha256:${"0".repeat(64)}`,
      };
    }],
    ["unpaired publication", async ({ journal, retirement }) => {
      journal.retirements = journal.retirements.filter((record) => record !== retirement);
    }],
    ["unpaired retirement", async ({ journal, publication }) => {
      journal.publications = journal.publications.filter((record) => record !== publication);
    }],
  ];

  for (const [label, mutate] of variants) {
    await t.test(label, async (t) => {
      const fixture = await createFixture();
      t.after(() => rm(fixture.root, { recursive: true, force: true }));
      const recoverySource = join(dirname(fixture.paths.legacyConfig), "recovery-note.txt");
      const recoveryTarget = join(dirname(fixture.paths.workspaceConfig), "recovery-note.txt");
      await writeFile(recoverySource, "legacy recovery note\n", "utf8");
      await interruptAfterDestinationVerification(fixture);
      const { journalPath, journal } = await readInterruptedJournal(fixture);
      assert.equal(journal.phase, "destination-verified");
      const publication = journal.publications.find(({ kind }) => kind === "recovery");
      const retirement = journal.retirements.find(({ kind }) => kind === "recovery:recovery-note.txt");
      assert.ok(publication);
      assert.ok(retirement);

      await mutate({ fixture, journal, publication, retirement });
      await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8");

      await assert.rejects(
        () => recoverLegacyUserMigration(
          fixture.workspaceRoot,
          fixture.legacyUserRoot,
          { dryRun: true },
        ),
        (error) => error.code === "INVALID_MIGRATION_JOURNAL",
      );
      assert.equal(await readFile(recoverySource, "utf8"), "legacy recovery note\n");
      assert.equal(await readFile(recoveryTarget, "utf8"), "legacy recovery note\n");
      assert.equal(
        await readFile(fixture.paths.legacyUnrelatedFile, "utf8"),
        "unrelated legacy file\n",
      );
    });
  }
});

test("legacy user migration recovery rejects malformed journal records and states", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await interruptDuringRename(fixture, { publicationKind: "workspace-config" });
  const { journalPath, journal } = await readInterruptedJournal(fixture);
  const variants = [
    ["phase", (value) => { value.phase = "unknown"; }],
    ["publication state", (value) => { value.publications[0].state = "almost-published"; }],
    ["publication snapshot", (value) => { value.publications[0].desired.hash = "not-a-hash"; }],
    ["unknown directory hash version", (value) => {
      value.publications.find(({ kind }) => kind === `skill:${OWNED_SKILL}`).desired.hash =
        `sha256-directory-v99:${"0".repeat(64)}`;
    }],
    ["mixed directory hash versions", (value) => {
      value.publications.find(({ kind }) => kind === `skill:${OWNED_SKILL}`).desired.hash =
        `sha256:${"0".repeat(64)}`;
    }],
    ["workspace config snapshot kind", (value) => {
      value.publications.find(({ kind }) => kind === "workspace-config").desired.kind = "directory";
    }],
    ["skill snapshot kind", (value) => {
      value.publications.find(({ kind }) => kind === `skill:${OWNED_SKILL}`).desired.kind = "file";
    }],
    ["legacy config snapshot kind", (value) => {
      value.retirements.find(({ kind }) => kind === "config").expected.kind = "directory";
    }],
    ["missing publication field", (value) => { delete value.publications[0].kind; }],
    ["retirement state", (value) => { value.retirements[0].state = "almost-retired"; }],
    ["unknown publication field", (value) => { value.publications[0].unexpected = true; }],
  ];

  for (const [label, mutate] of variants) {
    const invalid = JSON.parse(JSON.stringify(journal));
    mutate(invalid);
    await writeFile(journalPath, `${JSON.stringify(invalid, null, 2)}\n`, "utf8");
    await assert.rejects(
      () => recoverLegacyUserMigration(
        fixture.workspaceRoot,
        fixture.legacyUserRoot,
        { dryRun: true },
      ),
      (error) => error.code === "INVALID_MIGRATION_JOURNAL",
      label,
    );
  }

  assert.equal(await pathExists(fixture.paths.workspaceConfig), true);
  await assertLegacySourcePresent(fixture);
});

test("legacy user migration recovery rejects external staged, backup, and retired paths", async (t) => {
  await t.test("staged path", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    await interruptDuringRename(fixture, { publicationKind: "workspace-config" });
    const { journalPath, journal } = await readInterruptedJournal(fixture);
    const externalFile = join(fixture.root, "external-staged");
    await writeFile(externalFile, "external staged data\n", "utf8");
    journal.publications.find(({ kind }) => kind === "workspace-config").staged = externalFile;
    await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8");

    await assert.rejects(
      () => recoverLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
      (error) => error.code === "INVALID_MIGRATION_JOURNAL",
    );

    assert.equal(await readFile(externalFile, "utf8"), "external staged data\n");
    assert.equal(await pathExists(fixture.paths.workspaceConfig), true);
    await assertLegacySourcePresent(fixture);
  });

  await t.test("backup path", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    await seedReplacementDestination(fixture);
    await interruptDuringRename(fixture, { publicationKind: "changes" });
    const { journalPath, journal } = await readInterruptedJournal(fixture);
    const externalBackup = join(fixture.root, "external-backup");
    const externalFile = join(externalBackup, "outside.txt");
    await mkdir(externalBackup, { recursive: true });
    await writeFile(externalFile, "external backup data\n", "utf8");
    journal.publications.find(({ kind }) => kind === "changes").backup = externalBackup;
    await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8");

    await assert.rejects(
      () => recoverLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
      (error) => error.code === "INVALID_MIGRATION_JOURNAL",
    );

    assert.equal(await readFile(externalFile, "utf8"), "external backup data\n");
    assert.equal(
      await readFile(fixture.paths.workspaceChangeFile, "utf8"),
      "legacy change state\n",
    );
    await assertLegacySourcePresent(fixture);
  });

  await t.test("retired path", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    await interruptDuringRename(fixture, { retirementKind: "changes" });
    const { journalPath, journal } = await readInterruptedJournal(fixture);
    const record = journal.retirements.find(({ kind }) => kind === "changes");
    const deterministicRetired = record.retired;
    const externalRetired = join(fixture.root, "external-retired");
    const externalFile = join(externalRetired, "outside.txt");
    await mkdir(externalRetired, { recursive: true });
    await writeFile(externalFile, "external retired data\n", "utf8");
    record.retired = externalRetired;
    await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8");

    await assert.rejects(
      () => recoverLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
      (error) => error.code === "INVALID_MIGRATION_JOURNAL",
    );

    assert.equal(await readFile(externalFile, "utf8"), "external retired data\n");
    assert.equal(await pathExists(deterministicRetired), true);
    assert.equal(await pathExists(fixture.paths.legacyChanges), false);
  });
});

test("legacy user migration recovery rejects a deterministic backup path through an external symlink", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await seedReplacementDestination(fixture);
  await interruptDuringRename(fixture, { publicationKind: "changes" });
  const { stageRoot, journal } = await readInterruptedJournal(fixture);
  const publicationIndex = journal.publications.findIndex(({ kind }) => kind === "changes");
  const record = journal.publications[publicationIndex];
  const backupRoot = dirname(record.backup);
  const externalBackupRoot = join(fixture.root, "external-backups");
  await rename(backupRoot, externalBackupRoot);
  await symlink(externalBackupRoot, backupRoot, "dir");
  const externalFile = join(
    externalBackupRoot,
    String(publicationIndex),
    "2026-08-06-existing-workspace-change",
    "state.txt",
  );

  await assert.rejects(
    () => recoverLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
    (error) => error.code === "INVALID_MIGRATION_JOURNAL",
  );

  assert.equal(await readFile(externalFile, "utf8"), "existing workspace change\n");
  assert.equal(
    await readFile(fixture.paths.workspaceChangeFile, "utf8"),
    "legacy change state\n",
  );
  assert.equal(await pathExists(stageRoot), true);
  await assertLegacySourcePresent(fixture);
});

test("legacy user migration recovery rejects coherently authenticated workspace-root skill redirects", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await interruptDuringRename(fixture, { publicationKind: "workspace-config" });
  const { stageRoot, journalPath, journal } = await readInterruptedJournal(fixture);
  const configRecord = journal.publications.find(({ kind }) => kind === "workspace-config");
  const forgedConfig = {
    ...workspaceConfigFor(fixture),
    skills: { directory: "." },
  };
  const forgedConfigSource = `${JSON.stringify(forgedConfig, null, 2)}\n`;
  await writeFile(configRecord.staged, forgedConfigSource, "utf8");
  await writeFile(configRecord.target, forgedConfigSource, "utf8");
  configRecord.desired.hash = await hashFile(configRecord.staged);

  const forgedTarget = join(fixture.workspaceRoot, OWNED_SKILL);
  const sentinel = join(forgedTarget, "keep.txt");
  await mkdir(forgedTarget, { recursive: true });
  await writeFile(sentinel, "workspace-root sentinel\n", "utf8");
  journal.workspaceSkillsRoot = fixture.workspaceRoot;
  journal.publications.find(({ kind }) => kind === `skill:${OWNED_SKILL}`).target = forgedTarget;
  await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8");

  await assert.rejects(
    () => recoverLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
    (error) => error.code === "INVALID_MIGRATION_JOURNAL",
  );

  assert.equal(await readFile(sentinel, "utf8"), "workspace-root sentinel\n");
  assert.equal(await pathExists(stageRoot), true);
});

test("legacy user migration recovery rejects same-basename journal redirects outside configured owners", async (t) => {
  await t.test("workspace skill publication", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    await interruptDuringRename(fixture, { publicationKind: "workspace-config" });
    const { journalPath, journal } = await readInterruptedJournal(fixture);
    const unrelatedRoot = join(fixture.workspaceRoot, "unrelated-managed-skills");
    const unrelatedTarget = join(unrelatedRoot, OWNED_SKILL);
    const sentinel = join(unrelatedTarget, "keep.txt");
    await mkdir(unrelatedTarget, { recursive: true });
    await writeFile(sentinel, "unrelated workspace skill\n", "utf8");
    journal.workspaceSkillsRoot = unrelatedRoot;
    journal.publications.find(({ kind }) => kind === `skill:${OWNED_SKILL}`).target = unrelatedTarget;
    await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8");

    await assert.rejects(
      () => recoverLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
      (error) => error.code === "INVALID_MIGRATION_JOURNAL",
    );

    assert.equal(await readFile(sentinel, "utf8"), "unrelated workspace skill\n");
  });

  await t.test("legacy skill retirement", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    await interruptDuringRename(fixture, { publicationKind: "workspace-config" });
    const { journalPath, journal } = await readInterruptedJournal(fixture);
    const unrelatedRoot = join(fixture.legacyUserRoot, "unrelated-managed-skills");
    const unrelatedTarget = join(unrelatedRoot, OWNED_SKILL);
    const sentinel = join(unrelatedTarget, "keep.txt");
    await mkdir(unrelatedTarget, { recursive: true });
    await writeFile(sentinel, "unrelated legacy skill\n", "utf8");
    journal.legacySkillsRoot = unrelatedRoot;
    journal.retirements.find(({ kind }) => kind === `skill:${OWNED_SKILL}`).path = unrelatedTarget;
    await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8");

    await assert.rejects(
      () => recoverLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
      (error) => error.code === "INVALID_MIGRATION_JOURNAL",
    );

    assert.equal(await readFile(sentinel, "utf8"), "unrelated legacy skill\n");
  });

  await t.test("workflow publication", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    await interruptDuringRename(fixture, { publicationKind: "workspace-config" });
    const { journalPath, journal } = await readInterruptedJournal(fixture);
    const unrelatedTarget = join(
      fixture.workspaceRoot,
      "unrelated-workflow",
      "story-driven-development.md",
    );
    await mkdir(dirname(unrelatedTarget), { recursive: true });
    await writeFile(unrelatedTarget, "unrelated workspace workflow\n", "utf8");
    journal.publications.find(({ kind }) => kind === "workflow").target = unrelatedTarget;
    await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8");

    await assert.rejects(
      () => recoverLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
      (error) => error.code === "INVALID_MIGRATION_JOURNAL",
    );

    assert.equal(await readFile(unrelatedTarget, "utf8"), "unrelated workspace workflow\n");
  });

  await t.test("workflow retirement", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    await seedOwnedLegacyWorkflow(fixture);
    await interruptDuringRename(fixture, { publicationKind: "workspace-config" });
    const { journalPath, journal } = await readInterruptedJournal(fixture);
    const unrelatedTarget = join(
      fixture.legacyUserRoot,
      "unrelated-workflow",
      "story-driven-development.md",
    );
    await mkdir(dirname(unrelatedTarget), { recursive: true });
    await writeFile(unrelatedTarget, "unrelated legacy workflow\n", "utf8");
    journal.retirements.find(({ kind }) => kind === "workflow").path = unrelatedTarget;
    await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8");

    await assert.rejects(
      () => recoverLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
      (error) => error.code === "INVALID_MIGRATION_JOURNAL",
    );

    assert.equal(await readFile(unrelatedTarget, "utf8"), "unrelated legacy workflow\n");
  });
});

test("legacy user migration recovery rejects configured owner paths through external symlinks", async (t) => {
  await t.test("workspace workflow publication", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    await interruptDuringRename(fixture, { publicationKind: "workspace-config" });
    const externalWorkflow = join(fixture.root, "external-workspace-workflow.md");
    await writeFile(externalWorkflow, "external workspace workflow\n", "utf8");
    await symlink(externalWorkflow, fixture.paths.workspaceWorkflow, "file");

    await assert.rejects(
      () => recoverLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
      (error) => error.code === "UNSAFE_MIGRATION_PATH",
    );

    assert.equal(await readFile(externalWorkflow, "utf8"), "external workspace workflow\n");
  });

  await t.test("workspace skill publication", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    await interruptDuringRename(fixture, { publicationKind: "workspace-config" });
    const externalSkillsRoot = join(fixture.root, "external-workspace-skills");
    const sentinel = join(externalSkillsRoot, OWNED_SKILL, "keep.txt");
    await mkdir(dirname(sentinel), { recursive: true });
    await writeFile(sentinel, "external workspace skill\n", "utf8");
    await mkdir(dirname(fixture.paths.workspaceSkills), { recursive: true });
    await symlink(externalSkillsRoot, fixture.paths.workspaceSkills, "dir");

    await assert.rejects(
      () => recoverLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
      (error) => error.code === "UNSAFE_MIGRATION_PATH",
    );

    assert.equal(await readFile(sentinel, "utf8"), "external workspace skill\n");
  });

  await t.test("legacy workflow retirement", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const legacyWorkflow = await seedOwnedLegacyWorkflow(fixture);
    await interruptDuringRename(fixture, { publicationKind: "workspace-config" });
    const externalWorkflow = join(fixture.root, "external-legacy-workflow.md");
    await rename(legacyWorkflow, externalWorkflow);
    await symlink(externalWorkflow, legacyWorkflow, "file");

    await assert.rejects(
      () => recoverLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
      (error) => error.code === "INVALID_MIGRATION_JOURNAL",
    );

    assert.equal(
      await readFile(externalWorkflow, "utf8"),
      await readFile(WORKFLOW_SOURCE_PATH, "utf8"),
    );
  });

  await t.test("legacy skill retirement", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    await interruptDuringRename(fixture, { publicationKind: "workspace-config" });
    const legacySkillsRoot = dirname(fixture.paths.legacyOwnedSkill);
    const externalSkillsRoot = join(fixture.root, "external-legacy-skills");
    await rename(legacySkillsRoot, externalSkillsRoot);
    await symlink(externalSkillsRoot, legacySkillsRoot, "dir");
    const externalSkill = join(externalSkillsRoot, OWNED_SKILL);

    await assert.rejects(
      () => recoverLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
      (error) => error.code === "INVALID_MIGRATION_JOURNAL",
    );

    assert.equal(await hashDirectory(externalSkill), fixture.ownedSkillHash);
  });
});

test("legacy user migration preserves concurrent directory entries at transfer reservations", async (t) => {
  await t.test("publication entry", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
    let concurrentEntry = null;

    await assert.rejects(
      () => applyLegacyUserMigration(plan, {
        beforePublicationEntryCopy: async ({ record, target, entry }) => {
          if (record.kind !== "changes" || concurrentEntry) return;
          concurrentEntry = join(target, entry);
          await mkdir(concurrentEntry);
        },
      }),
      (error) => ["CONCURRENT_CHANGE", "MUTATION_RECOVERY_FAILED"].includes(error.code),
    );

    assert.ok(concurrentEntry);
    assert.deepEqual(await readdir(concurrentEntry), []);
    assert.equal((await stagingDirectories(fixture.workspaceRoot)).length, 1);
  });

  await t.test("backup entry", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    await seedReplacementDestination(fixture);
    const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
    let concurrentEntry = null;

    await assert.rejects(
      () => applyLegacyUserMigration(plan, {
        beforePublicationBackupEntryCopy: async ({ record, target, entry }) => {
          if (record.kind !== "changes" || concurrentEntry) return;
          concurrentEntry = join(target, entry);
          await mkdir(concurrentEntry);
        },
      }),
      (error) => ["CONCURRENT_CHANGE", "MUTATION_RECOVERY_FAILED"].includes(error.code),
    );

    assert.ok(concurrentEntry);
    assert.deepEqual(await readdir(concurrentEntry), []);
    assert.equal((await stagingDirectories(fixture.workspaceRoot)).length, 1);
  });

  await t.test("retirement entry", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
    let concurrentEntry = null;

    await assert.rejects(
      () => applyLegacyUserMigration(plan, {
        beforeSourceRetirementEntryCopy: async ({ record, target, entry }) => {
          if (record.kind !== "changes" || concurrentEntry) return;
          concurrentEntry = join(target, entry);
          await mkdir(concurrentEntry);
        },
      }),
      (error) => ["CONCURRENT_CHANGE", "MUTATION_RECOVERY_FAILED"].includes(error.code),
    );

    assert.ok(concurrentEntry);
    assert.deepEqual(await readdir(concurrentEntry), []);
    assert.equal(await readFile(fixture.paths.legacyChangeFile, "utf8"), "legacy change state\n");
    assert.equal((await stagingDirectories(fixture.workspaceRoot)).length, 1);
  });

  await t.test("publication root replacement", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
    const displaced = join(fixture.root, "owned-publication-reservation");
    let concurrentRoot = null;

    await assert.rejects(
      () => applyLegacyUserMigration(plan, {
        afterPublicationReservation: async ({ record }) => {
          if (record.kind !== "changes") return;
          concurrentRoot = record.target;
          await rename(record.target, displaced);
          await mkdir(record.target);
        },
      }),
      (error) => ["CONCURRENT_CHANGE", "MUTATION_RECOVERY_FAILED"].includes(error.code),
    );

    assert.ok(concurrentRoot);
    assert.deepEqual(await readdir(concurrentRoot), []);
    assert.deepEqual(await readdir(displaced), []);
  });

  await t.test("backup root replacement", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    await seedReplacementDestination(fixture);
    const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
    const displaced = join(fixture.root, "owned-backup-reservation");
    let concurrentBackup = null;

    await assert.rejects(
      () => applyLegacyUserMigration(plan, {
        beforePublicationBackupTransfer: async ({ record }) => {
          if (record.kind !== "changes") return;
          concurrentBackup = record.backup;
          await rename(record.backup, displaced);
          await mkdir(record.backup);
        },
      }),
      (error) => ["CONCURRENT_CHANGE", "MUTATION_RECOVERY_FAILED"].includes(error.code),
    );

    assert.ok(concurrentBackup);
    assert.deepEqual(await readdir(concurrentBackup), []);
    assert.deepEqual(await readdir(displaced), []);
  });

  await t.test("retirement root replacement", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
    const displaced = join(fixture.root, "owned-retirement-reservation");
    let concurrentRetired = null;

    await assert.rejects(
      () => applyLegacyUserMigration(plan, {
        afterSourceRetirementReservation: async ({ record }) => {
          if (record.kind !== "changes") return;
          concurrentRetired = record.retired;
          await rename(record.retired, displaced);
          await mkdir(record.retired);
        },
      }),
      (error) => ["CONCURRENT_CHANGE", "MUTATION_RECOVERY_FAILED"].includes(error.code),
    );

    assert.ok(concurrentRetired);
    assert.deepEqual(await readdir(concurrentRetired), []);
    assert.deepEqual(await readdir(displaced), []);
    assert.equal(await readFile(fixture.paths.legacyChangeFile, "utf8"), "legacy change state\n");
  });
});

test("legacy user migration never overwrites concurrent file transfer entries", async (t) => {
  await t.test("publication backup payload", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    await mkdir(dirname(fixture.paths.workspaceConfig), { recursive: true });
    await writeFile(
      fixture.paths.workspaceConfig,
      `${JSON.stringify(workspaceConfigFor(fixture), null, 2)}\n`,
      "utf8",
    );
    const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
    let concurrentTransfer = null;

    await assert.rejects(
      () => applyLegacyUserMigration(plan, {
        beforePublicationBackupMove: async ({ record, recoveryPath }) => {
          if (record.kind !== "workspace-config") return;
          concurrentTransfer = recoveryPath;
          await writeFile(recoveryPath, "concurrent backup transfer\n", "utf8");
        },
      }),
      (error) => ["CONCURRENT_CHANGE", "MUTATION_RECOVERY_FAILED"].includes(error.code),
    );

    assert.ok(concurrentTransfer);
    assert.equal(await readFile(concurrentTransfer, "utf8"), "concurrent backup transfer\n");
  });

  await t.test("source retirement payload", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
    let concurrentTransfer = null;

    await assert.rejects(
      () => applyLegacyUserMigration(plan, {
        beforeSourceRetirementMove: async ({ record, recoveryPath }) => {
          if (record.kind !== "config") return;
          concurrentTransfer = recoveryPath;
          await writeFile(recoveryPath, "concurrent retirement transfer\n", "utf8");
        },
      }),
      (error) => ["CONCURRENT_CHANGE", "MUTATION_RECOVERY_FAILED"].includes(error.code),
    );

    assert.ok(concurrentTransfer);
    assert.equal(await readFile(concurrentTransfer, "utf8"), "concurrent retirement transfer\n");
    assert.deepEqual(JSON.parse(await readFile(fixture.paths.legacyConfig, "utf8")), LEGACY_CONFIG);
  });
});

test("legacy user migration does not replace a concurrent rollback quarantine", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
  let concurrentQuarantine = null;

  await assert.rejects(
    () => applyLegacyUserMigration(plan, {
      beforePublicationPublish: async ({ record }) => {
        if (record.kind !== "changes") return;
        await writeFile(join(record.target, "concurrent.txt"), "force rollback\n", "utf8");
      },
      beforePublicationRollbackRename: async ({ record, quarantine }) => {
        if (record.kind !== "workspace-config") return;
        concurrentQuarantine = quarantine;
        await mkdir(quarantine);
      },
    }),
    (error) => error.code === "MUTATION_RECOVERY_FAILED",
  );

  assert.ok(concurrentQuarantine);
  assert.deepEqual(await readdir(concurrentQuarantine), []);
  assert.equal((await stagingDirectories(fixture.workspaceRoot)).length, 1);
});


test("legacy user migration binds its receipt parent across the pre-link hook", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const externalParent = join(fixture.root, "external-receipt-parent");
  const displacedParent = join(fixture.root, "displaced-receipt-parent");
  const externalSentinel = join(externalParent, "keep.txt");
  await mkdir(externalParent);
  await writeFile(externalSentinel, "external receipt state\n", "utf8");
  const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
  let injected = false;

  await assert.rejects(
    () => applyLegacyUserMigration(plan, {
      beforeReceiptLink: async ({ receiptPath }) => {
        injected = true;
        const parent = dirname(receiptPath);
        await rename(parent, displacedParent);
        await symlink(externalParent, parent, "dir");
      },
    }),
    (error) => error.code === "INVALID_MIGRATION_JOURNAL",
  );

  assert.equal(injected, true);
  assert.equal(await pathExists(join(externalParent, "from-user.json")), false);
  assert.equal(await readFile(externalSentinel, "utf8"), "external receipt state\n");
  const retainedTemporaries = (await readdir(displacedParent))
    .filter((name) => name.startsWith(".from-user.sdd-receipt-"));
  assert.equal(retainedTemporaries.length, 1);
  assert.equal((await stagingDirectories(fixture.workspaceRoot)).length, 1);
});
test("legacy user migration exclusively publishes receipts and recovers after receipt-link interruption", async (t) => {
  await t.test("opaque concurrent receipt", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const externalReceipt = join(fixture.root, "external-receipt.json");
    await writeFile(externalReceipt, "opaque concurrent receipt\n", "utf8");
    const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
    let injected = false;

    await assert.rejects(
      () => applyLegacyUserMigration(plan, {
        beforeReceiptLink: async ({ receiptPath }) => {
          injected = true;
          await symlink(externalReceipt, receiptPath, "file");
        },
      }),
      (error) => error.code === "CONCURRENT_CHANGE",
    );

    assert.equal(injected, true);
    assert.equal(await readFile(fixture.paths.workspaceReceipt, "utf8"), "opaque concurrent receipt\n");
    assert.equal(await readFile(externalReceipt, "utf8"), "opaque concurrent receipt\n");
    assert.equal((await stagingDirectories(fixture.workspaceRoot)).length, 1);
  });

  await t.test("opaque receipt replacement after exclusive link", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const externalReceipt = join(fixture.root, "post-link-receipt");
    await writeFile(externalReceipt, "post-link concurrent receipt\n", "utf8");
    const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);

    await assert.rejects(
      () => applyLegacyUserMigration(plan, {
        afterReceiptLink: async ({ receiptPath }) => {
          await rm(receiptPath);
          await symlink(externalReceipt, receiptPath, "file");
        },
      }),
      (error) => error.code === "CONCURRENT_CHANGE",
    );

    assert.equal(
      await readFile(fixture.paths.workspaceReceipt, "utf8"),
      "post-link concurrent receipt\n",
    );
    assert.equal(await readFile(externalReceipt, "utf8"), "post-link concurrent receipt\n");
    assert.equal((await stagingDirectories(fixture.workspaceRoot)).length, 1);
  });

  await t.test("recovery adopts an exclusively linked receipt", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
    let interrupted = false;

    await assert.rejects(
      () => applyLegacyUserMigration(plan, {
        afterReceiptLink: () => {
          interrupted = true;
          throw new Error("interrupt after receipt link");
        },
      }),
      /interrupt after receipt link/,
    );

    assert.equal(interrupted, true);
    assert.equal(await pathExists(fixture.paths.workspaceReceipt), true);
    assert.equal((await stagingDirectories(fixture.workspaceRoot)).length, 1);
    await assert.rejects(
      () => planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
      (error) => error.code === "MIGRATION_RECOVERY_REQUIRED",
    );

    const recovery = await recoverLegacyUserMigration(
      fixture.workspaceRoot,
      fixture.legacyUserRoot,
    );
    assert.equal(recovery.recovered, 1);
    await assertCanonicalDestination(fixture);
    assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
  });
});

test("legacy user migration preserves concurrent journal and stage replacements during cleanup", async (t) => {
  await t.test("journal replacement during persistence", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
    let concurrentJournal = null;
    let injected = false;

    await assert.rejects(
      () => applyLegacyUserMigration(plan, {
        beforeJournalLink: async ({ generation, journalPath }) => {
          if (generation !== 2 || injected) return;
          injected = true;
          concurrentJournal = journalPath;
          await rm(journalPath);
          await writeFile(journalPath, "concurrent journal replacement\n", "utf8");
        },
      }),
      (error) => ["CONCURRENT_CHANGE", "MUTATION_RECOVERY_FAILED"].includes(error.code),
    );

    assert.equal(injected, true);
    assert.equal(await readFile(concurrentJournal, "utf8"), "concurrent journal replacement\n");
    assert.equal((await stagingDirectories(fixture.workspaceRoot)).length, 1);
  });

  await t.test("journal replacement after exclusive link", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
    let concurrentJournal = null;

    await assert.rejects(
      () => applyLegacyUserMigration(plan, {
        afterJournalLink: async ({ generation, journalPath }) => {
          if (generation !== 2 || concurrentJournal) return;
          concurrentJournal = journalPath;
          await rm(journalPath);
          await writeFile(journalPath, "post-link journal replacement\n", "utf8");
        },
      }),
      (error) => ["CONCURRENT_CHANGE", "MUTATION_RECOVERY_FAILED"].includes(error.code),
    );

    assert.ok(concurrentJournal);
    assert.equal(await readFile(concurrentJournal, "utf8"), "post-link journal replacement\n");
    assert.equal((await stagingDirectories(fixture.workspaceRoot)).length, 1);
  });

  await t.test("opaque stage entry added before the ownership snapshot survives fail-closed cleanup", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
    const externalEntry = join(fixture.root, "opaque-stage-entry");
    await writeFile(externalEntry, "opaque concurrent stage entry\n", "utf8");
    let concurrentEntry = null;

    await assert.rejects(
      () => applyLegacyUserMigration(plan, {
        beforeStageCleanup: async ({ state }) => {
          concurrentEntry = join(state.stageRoot, "concurrent-stage-entry");
          await symlink(externalEntry, concurrentEntry, "file");
        },
      }),
      (error) => error.code === "CONCURRENT_CHANGE",
    );

    assert.ok(concurrentEntry);
    assert.equal((await lstat(concurrentEntry)).isSymbolicLink(), true);
    assert.equal(await readFile(externalEntry, "utf8"), "opaque concurrent stage entry\n");
    assert.equal(await pathExists(fixture.paths.workspaceReceipt), false);
    assert.equal((await stagingDirectories(fixture.workspaceRoot)).length, 1);
  });

  await t.test("opaque pre-snapshot bytes inside an evidence namespace are never adopted", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
    const externalEntry = join(fixture.root, "opaque-evidence-entry");
    await writeFile(externalEntry, "opaque evidence entry\n", "utf8");
    let concurrentEntry = null;

    await assert.rejects(
      () => applyLegacyUserMigration(plan, {
        beforeStageCleanup: async ({ state }) => {
          const evidenceRoot = join(state.stageRoot, "transfer-evidence");
          await mkdir(evidenceRoot, { recursive: true });
          concurrentEntry = join(evidenceRoot, "unowned-namespace");
          await symlink(externalEntry, concurrentEntry, "file");
        },
      }),
      (error) => error.code === "CONCURRENT_CHANGE",
    );

    assert.ok(concurrentEntry);
    assert.equal((await lstat(concurrentEntry)).isSymbolicLink(), true);
    assert.equal(await readFile(externalEntry, "utf8"), "opaque evidence entry\n");
    assert.equal(await pathExists(fixture.paths.workspaceReceipt), false);
    assert.equal((await stagingDirectories(fixture.workspaceRoot)).length, 1);
  });

  await t.test("opaque stage entry added after the ownership snapshot survives fail-closed cleanup", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
    const externalEntry = join(fixture.root, "post-snapshot-opaque-stage-entry");
    await writeFile(externalEntry, "post-snapshot opaque entry\n", "utf8");
    let concurrentEntry = null;

    await assert.rejects(
      () => applyLegacyUserMigration(plan, {
        afterStageCleanupSnapshot: async ({ state }) => {
          concurrentEntry = join(state.stageRoot, "post-snapshot-concurrent-entry");
          await symlink(externalEntry, concurrentEntry, "file");
        },
      }),
      (error) => error.code === "CONCURRENT_CHANGE",
    );

    assert.ok(concurrentEntry);
    assert.equal((await lstat(concurrentEntry)).isSymbolicLink(), true);
    assert.equal(await readFile(externalEntry, "utf8"), "post-snapshot opaque entry\n");
    assert.equal(await pathExists(fixture.paths.workspaceReceipt), false);
    assert.equal((await stagingDirectories(fixture.workspaceRoot)).length, 1);
  });

  await t.test("stage root replacement after cleanup snapshot", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
    const concurrentStage = join(fixture.root, "concurrent-stage");
    const concurrentSentinel = join(concurrentStage, "keep.txt");
    const displacedStage = join(fixture.root, "owned-stage");
    const preservedConcurrentStage = join(fixture.root, "preserved-concurrent-stage");
    await mkdir(concurrentStage);
    await writeFile(concurrentSentinel, "concurrent stage\n", "utf8");
    let stageRoot = null;

    await assert.rejects(
      () => applyLegacyUserMigration(plan, {
        afterStageCleanupSnapshot: async ({ state }) => {
          stageRoot = state.stageRoot;
          await rename(state.stageRoot, displacedStage);
          await rename(concurrentStage, state.stageRoot);
        },
      }),
      (error) => error.code === "CONCURRENT_CHANGE",
    );

    assert.ok(stageRoot);
    assert.equal(await readFile(join(stageRoot, "keep.txt"), "utf8"), "concurrent stage\n");
    await rename(stageRoot, preservedConcurrentStage);
    await rename(displacedStage, stageRoot);

    const recovery = await recoverLegacyUserMigration(
      fixture.workspaceRoot,
      fixture.legacyUserRoot,
    );
    assert.equal(recovery.recovered, 1);
    assert.equal(
      await readFile(join(preservedConcurrentStage, "keep.txt"), "utf8"),
      "concurrent stage\n",
    );
    assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
    await assertCanonicalDestination(fixture);
  });

  await t.test("journal replacement after cleanup snapshot", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const externalJournal = join(fixture.root, "external-journal");
    await writeFile(externalJournal, "opaque journal replacement\n", "utf8");
    const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
    let ownedJournal = null;
    let journalPath = null;

    await assert.rejects(
      () => applyLegacyUserMigration(plan, {
        afterStageCleanupSnapshot: async ({ state }) => {
          journalPath = state.journalPath;
          ownedJournal = join(state.stageRoot, "owned-transaction.json");
          await rename(journalPath, ownedJournal);
          await symlink(externalJournal, journalPath, "file");
        },
      }),
      (error) => error.code === "CONCURRENT_CHANGE",
    );

    assert.equal(await readFile(journalPath, "utf8"), "opaque journal replacement\n");
    assert.equal(await readFile(externalJournal, "utf8"), "opaque journal replacement\n");
    await rm(journalPath);
    await rename(ownedJournal, journalPath);

    const recovery = await recoverLegacyUserMigration(
      fixture.workspaceRoot,
      fixture.legacyUserRoot,
    );
    assert.equal(recovery.recovered, 1);
    assert.equal(await readFile(externalJournal, "utf8"), "opaque journal replacement\n");
    assert.deepEqual(await stagingDirectories(fixture.workspaceRoot), []);
    await assertCanonicalDestination(fixture);
  });
});

test("legacy user migration never recursively removes opaque transfer-tree replacements", async (t) => {
  await t.test("published destination rollback", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
    const displaced = join(fixture.root, "owned-published-entry");
    let concurrentSentinel = null;

    await assert.rejects(
      () => applyLegacyUserMigration(plan, {
        afterPublicationRename: ({ record }) => {
          if (record.kind === "changes") throw new Error("force publication rollback");
        },
        afterPublicationCleanupSnapshot: async ({ record }) => {
          if (record.kind !== "changes" || concurrentSentinel) return;
          const entry = (await readdir(record.target)).sort()[0];
          const target = join(record.target, entry);
          await rename(target, displaced);
          await mkdir(target);
          concurrentSentinel = join(target, "keep.txt");
          await writeFile(concurrentSentinel, "concurrent publication entry\n", "utf8");
        },
      }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );

    assert.ok(concurrentSentinel);
    assert.equal(await readFile(concurrentSentinel, "utf8"), "concurrent publication entry\n");
    assert.equal(await pathExists(displaced), true);
    assert.equal((await stagingDirectories(fixture.workspaceRoot)).length, 1);
  });

  await t.test("backup rollback", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    await seedReplacementDestination(fixture);
    const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
    const displaced = join(fixture.root, "owned-backup-entry");
    let concurrentSentinel = null;

    await assert.rejects(
      () => applyLegacyUserMigration(plan, {
        afterPublicationBackupCopy: ({ record }) => {
          if (record.kind === "changes") throw new Error("force backup rollback");
        },
        afterPublicationBackupCleanupSnapshot: async ({ record }) => {
          if (record.kind !== "changes" || concurrentSentinel) return;
          const entry = (await readdir(record.backup)).sort()[0];
          const target = join(record.backup, entry);
          await rename(target, displaced);
          await mkdir(target);
          concurrentSentinel = join(target, "keep.txt");
          await writeFile(concurrentSentinel, "concurrent backup entry\n", "utf8");
        },
      }),
      (error) => error.code === "MUTATION_RECOVERY_FAILED",
    );

    assert.ok(concurrentSentinel);
    assert.equal(await readFile(concurrentSentinel, "utf8"), "concurrent backup entry\n");
    assert.equal(await pathExists(displaced), true);
    assert.equal((await stagingDirectories(fixture.workspaceRoot)).length, 1);
  });

  await t.test("retiring source", async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
    const displaced = join(fixture.root, "owned-retirement-entry");
    let concurrentSentinel = null;

    await assert.rejects(
      () => applyLegacyUserMigration(plan, {
        afterSourceRetirementRemovalSnapshot: async ({ record }) => {
          if (record.kind !== "changes" || concurrentSentinel) return;
          const target = fixture.paths.legacyChangeFile;
          await rename(target, displaced);
          await writeFile(target, "legacy change state\n", "utf8");
          concurrentSentinel = target;
        },
      }),
      (error) => ["CONCURRENT_CHANGE", "MUTATION_RECOVERY_FAILED"].includes(error.code),
    );

    assert.ok(concurrentSentinel);
    assert.equal(await readFile(concurrentSentinel, "utf8"), "legacy change state\n");
    assert.equal(await pathExists(displaced), true);
    assert.equal((await stagingDirectories(fixture.workspaceRoot)).length, 1);
  });
});

test("legacy user migration recovery authenticates provenance before preserving a foreign config publication", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await interruptDuringRename(fixture, { publicationLinkKind: "workspace-config" });
  const interrupted = await readInterruptedJournal(fixture);
  const { stageRoot, journal } = interrupted;
  const record = journal.publications.find(({ kind }) => kind === "workspace-config");
  const canonicalSource = await readFile(record.target, "utf8");

  await rm(record.target);
  await writeFile(record.target, canonicalSource, "utf8");
  await rm(record.staged);
  await link(record.target, record.staged);
  const forgedState = await lstat(record.staged, { bigint: true });
  const provenancePath = join(stageRoot, "transaction-provenance.json");
  const provenanceProofPath = join(stageRoot, "transaction-provenance.proof.json");
  const provenance = JSON.parse(await readFile(provenancePath, "utf8"));
  const provenPublication = provenance.publications.find(
    ({ kind }) => kind === "workspace-config",
  );
  provenPublication.stagedIdentity = {
    device: String(forgedState.dev),
    inode: String(forgedState.ino),
    kind: "file",
  };
  await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, "utf8");
  await writeFile(provenanceProofPath, `${JSON.stringify(provenance, null, 2)}\n`, "utf8");
  await rewriteInterruptedJournals(interrupted, (candidate) => {
    candidate.publications.find(({ kind }) => kind === "workspace-config").state = "published";
  });
  const workspaceBeforeRecovery = await hashDirectory(fixture.workspaceRoot);

  await assert.rejects(
    () => recoverLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
    (error) => error.code === "INVALID_MIGRATION_JOURNAL",
  );

  assert.equal(await readFile(record.target, "utf8"), canonicalSource);
  assert.equal(await hashDirectory(fixture.workspaceRoot), workspaceBeforeRecovery);
  assert.equal(await pathExists(stageRoot), true);
  await assertLegacySourcePresent(fixture);
});

test("legacy user migration recovery preserves a same-content foreign Change publication", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await interruptDuringRename(fixture, { publicationKind: "changes" });
  const interrupted = await readInterruptedJournal(fixture);
  const { stageRoot, journal } = interrupted;
  const record = journal.publications.find(({ kind }) => kind === "changes");
  const foreignCopy = join(fixture.root, "foreign-canonical-changes");

  await cp(record.target, foreignCopy, {
    recursive: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });
  await rm(record.target, { recursive: true });
  await rename(foreignCopy, record.target);
  await rewriteInterruptedJournals(interrupted, (candidate) => {
    const rewritten = candidate.publications.find(({ kind }) => kind === "changes");
    rewritten.state = "published";
    rewritten.reservation = null;
  });
  const workspaceBeforeRecovery = await hashDirectory(fixture.workspaceRoot);

  await assert.rejects(
    () => recoverLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
    (error) => error.code === "INVALID_MIGRATION_JOURNAL",
  );

  assert.equal(await hashDirectory(fixture.workspaceRoot), workspaceBeforeRecovery);
  assert.equal(await readFile(fixture.paths.workspaceChangeFile, "utf8"), "legacy change state\n");
  assert.equal(await pathExists(stageRoot), true);
  await assertLegacySourcePresent(fixture);
});

test("legacy user migration recovery rejects an appended unowned skill retirement", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await interruptAfterDestinationVerification(fixture);
  const interrupted = await readInterruptedJournal(fixture);
  const { stageRoot } = interrupted;
  const victim = join(dirname(fixture.paths.legacyOwnedSkill), "sdd-victim");
  const sentinel = join(victim, "SKILL.md");
  await mkdir(victim);
  await writeFile(sentinel, "unowned victim skill\n", "utf8");
  const expected = { kind: "directory", hash: await hashDirectory(victim) };
  const retirement = {
    kind: "skill:sdd-victim",
    path: victim,
    expected,
    state: "pending",
    retired: null,
    reservation: null,
  };
  await rewriteInterruptedJournals(interrupted, (candidate) => {
    candidate.retirements.push(structuredClone(retirement));
  });
  const fixtureBeforeRecovery = await hashDirectory(fixture.root);

  await assert.rejects(
    () => recoverLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
    (error) => error.code === "INVALID_MIGRATION_JOURNAL",
  );

  assert.equal(await readFile(sentinel, "utf8"), "unowned victim skill\n");
  assert.equal(await hashDirectory(fixture.root), fixtureBeforeRecovery);
  assert.equal(await pathExists(stageRoot), true);
});

test("legacy user migration recovery requires install-lock ownership after coherent retirement tampering", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await interruptAfterDestinationVerification(fixture);
  const interrupted = await readInterruptedJournal(fixture);
  const { stageRoot } = interrupted;
  const victim = join(dirname(fixture.paths.legacyOwnedSkill), "sdd-victim");
  const sentinel = join(victim, "SKILL.md");
  await mkdir(victim);
  await writeFile(sentinel, "coherently forged victim skill\n", "utf8");
  const expected = { kind: "directory", hash: await hashDirectory(victim) };
  const retirement = {
    kind: "skill:sdd-victim",
    path: victim,
    expected,
    state: "pending",
    retired: null,
    reservation: null,
  };
  await rewriteInterruptedJournals(interrupted, (candidate) => {
    candidate.retirements.push(structuredClone(retirement));
  });

  const provenancePath = join(stageRoot, "transaction-provenance.json");
  const provenance = JSON.parse(await readFile(provenancePath, "utf8"));
  const victimState = await lstat(victim, { bigint: true });
  const sentinelState = await lstat(sentinel, { bigint: true });
  provenance.retirements.push({
    kind: retirement.kind,
    path: retirement.path,
    expected: retirement.expected,
    sourceIdentity: {
      device: String(victimState.dev),
      inode: String(victimState.ino),
      kind: "directory",
    },
    sourceTree: {
      identity: {
        device: String(victimState.dev),
        inode: String(victimState.ino),
        kind: "directory",
      },
      children: [{
        name: "SKILL.md",
        tree: {
          identity: {
            device: String(sentinelState.dev),
            inode: String(sentinelState.ino),
            kind: "file",
          },
          children: null,
        },
      }],
    },
  });
  await rewriteInterruptedProvenance(interrupted, provenance, { rewriteAuthority: true });
  const fixtureBeforeRecovery = await hashDirectory(fixture.root);

  await assert.rejects(
    () => recoverLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
    (error) => error.code === "INVALID_MIGRATION_JOURNAL",
  );

  assert.equal(await readFile(sentinel, "utf8"), "coherently forged victim skill\n");
  assert.equal(await hashDirectory(fixture.root), fixtureBeforeRecovery);
  assert.equal(await pathExists(stageRoot), true);
});

test("legacy user migration refuses same-content retirement source replacements", async (t) => {
  const variants = [
    { label: "file", kind: "config", directory: false },
    { label: "directory", kind: "changes", directory: true },
  ];

  for (const variant of variants) {
    await t.test(variant.label, async (t) => {
      const fixture = await createFixture();
      t.after(() => rm(fixture.root, { recursive: true, force: true }));
      const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
      const replacement = join(fixture.root, `${variant.label}-replacement`);
      const displaced = join(fixture.root, `${variant.label}-displaced`);
      let replacementIdentity = null;
      let sourcePath = null;

      await assert.rejects(
        () => applyLegacyUserMigration(plan, {
          beforeSourceRetirement: async ({ record }) => {
            if (record.kind !== variant.kind || replacementIdentity) return;
            sourcePath = record.path;
            await cp(record.path, replacement, {
              recursive: variant.directory,
              preserveTimestamps: true,
              verbatimSymlinks: true,
            });
            replacementIdentity = await lstat(replacement, { bigint: true });
            await rename(record.path, displaced);
            await rename(replacement, record.path);
          },
        }),
        (error) => error.code === "CONCURRENT_CHANGE",
      );

      assert.ok(replacementIdentity);
      const currentIdentity = await lstat(sourcePath, { bigint: true });
      assert.equal(currentIdentity.dev, replacementIdentity.dev);
      assert.equal(currentIdentity.ino, replacementIdentity.ino);
      assert.equal(await pathExists(displaced), true);
      assert.equal(
        variant.directory ? await hashDirectory(sourcePath) : await hashFile(sourcePath),
        variant.directory ? await hashDirectory(displaced) : await hashFile(displaced),
      );
    });
  }
});

test("legacy user migration rechecks preserved destination identity before receipt commit", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await mkdir(dirname(fixture.paths.workspaceChanges), { recursive: true });
  await cp(fixture.paths.legacyChanges, fixture.paths.workspaceChanges, {
    recursive: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });
  const plan = await planLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot);
  const expectedHash = await hashDirectory(fixture.paths.workspaceChanges);
  let replacementIdentity = null;

  await assert.rejects(
    () => applyLegacyUserMigration(plan, {
      beforeReceiptCommit: async ({ state }) => {
        const guard = state.destinationGuards.find(({ kind }) => kind === "changes-root");
        assert.ok(guard);
        const replacement = join(fixture.root, "same-content-guard-replacement");
        await cp(guard.target, replacement, {
          recursive: true,
          preserveTimestamps: true,
          verbatimSymlinks: true,
        });
        replacementIdentity = await lstat(replacement, { bigint: true });
        await rm(guard.target, { recursive: true });
        await rename(replacement, guard.target);
      },
    }),
    (error) => error.code === "CONCURRENT_CHANGE",
  );

  assert.ok(replacementIdentity);
  const currentIdentity = await lstat(fixture.paths.workspaceChanges, { bigint: true });
  assert.equal(currentIdentity.dev, replacementIdentity.dev);
  assert.equal(currentIdentity.ino, replacementIdentity.ino);
  assert.equal(await hashDirectory(fixture.paths.workspaceChanges), expectedHash);
  assert.equal(await pathExists(fixture.paths.workspaceReceipt), false);
});

test("legacy user migration recovery resumes preserved Change guards", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await mkdir(dirname(fixture.paths.workspaceChanges), { recursive: true });
  await cp(fixture.paths.legacyChanges, fixture.paths.workspaceChanges, {
    recursive: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });

  await interruptAfterDestinationVerification(fixture);
  const recovery = await recoverLegacyUserMigration(
    fixture.workspaceRoot,
    fixture.legacyUserRoot,
  );

  assert.equal(recovery.recovered, 1);
  await assertCanonicalDestination(fixture);
  await assertLegacySourceRetired(fixture);
});

test("legacy user migration recovery reconciles a copied file retirement payload", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await interruptDuringRename(fixture, { retirementPayloadCopyKind: "config" });
  const interrupted = await readInterruptedJournal(fixture);
  const index = interrupted.journal.retirements.findIndex(({ kind }) => kind === "config");
  assert.notEqual(index, -1);
  const record = interrupted.journal.retirements[index];
  assert.equal(record.state, "retire-intent");
  assert.equal(
    await pathExists(join(
      interrupted.stageRoot,
      "provenance-evidence",
      "retirement-payload",
      `${String(index).padStart(6, "0")}.json`,
    )),
    true,
  );

  const recovery = await recoverLegacyUserMigration(
    fixture.workspaceRoot,
    fixture.legacyUserRoot,
  );

  assert.equal(recovery.recovered, 1);
  await assertCanonicalDestination(fixture);
  await assertLegacySourceRetired(fixture);
});

test("legacy user migration recovery rejects a forged file retirement sidecar after cross-device source removal", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const expectedSource = await readFile(fixture.paths.legacyConfig, "utf8");
  await interruptDuringRename(fixture, {
    retirementCrossDeviceRemovalKind: "config",
  });
  const interrupted = await readInterruptedJournal(fixture);
  const index = interrupted.journal.retirements.findIndex(({ kind }) => kind === "config");
  assert.notEqual(index, -1);
  const record = interrupted.journal.retirements[index];
  const transferPath = join(`${record.retired}.transfer`, "payload");
  const evidenceRoot = join(
    interrupted.stageRoot,
    "transfer-evidence",
    "retirement",
    String(index),
  );
  const manifestPath = join(evidenceRoot, "000000.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const transferState = await lstat(transferPath, { bigint: true });
  const forgedIdentity = {
    device: String(transferState.dev),
    inode: String(transferState.ino),
    kind: "file",
  };
  manifest.source.identity = forgedIdentity;
  manifest.source.proofIdentity = forgedIdentity;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const fixtureBeforeRecovery = await hashDirectory(fixture.root);

  await assert.rejects(
    () => recoverLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
    (error) => error.code === "CONCURRENT_CHANGE",
  );

  assert.equal(await pathExists(record.path), false);
  assert.equal(await readFile(transferPath, "utf8"), expectedSource);
  assert.equal(await hashDirectory(fixture.root), fixtureBeforeRecovery);
});

test("legacy user migration recovery completes a partially removed directory retirement", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await interruptDuringRename(fixture, { retirementRemovalSnapshotKind: "changes" });
  const interrupted = await readInterruptedJournal(fixture);
  const record = interrupted.journal.retirements.find(({ kind }) => kind === "changes");
  assert.equal(record.state, "retire-intent");
  const [removedEntry] = await readdir(record.path);
  assert.ok(removedEntry);
  await rm(join(record.path, removedEntry), { recursive: true, force: true });

  const recovery = await recoverLegacyUserMigration(
    fixture.workspaceRoot,
    fixture.legacyUserRoot,
  );

  assert.equal(recovery.recovered, 1);
  await assertCanonicalDestination(fixture);
  await assertLegacySourceRetired(fixture);
});

test("legacy user migration recovery rejects a forged manifest after partial directory source deletion", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const secondName = "2026-08-08-second-legacy-change";
  const secondFile = join(fixture.paths.legacyChanges, secondName, "state.txt");
  await mkdir(dirname(secondFile), { recursive: true });
  await writeFile(secondFile, "second legacy change\n", "utf8");
  await interruptDuringRename(fixture, { retirementRemovalSnapshotKind: "changes" });
  const interrupted = await readInterruptedJournal(fixture);
  const index = interrupted.journal.retirements.findIndex(({ kind }) => kind === "changes");
  assert.notEqual(index, -1);
  const record = interrupted.journal.retirements[index];
  const currentNames = (await readdir(record.path)).sort((left, right) => left.localeCompare(right));
  assert.equal(currentNames.length, 2);
  const [removedName, remainingName] = currentNames;
  await rm(join(record.path, removedName), { recursive: true });
  const remainingFile = join(record.path, remainingName, "state.txt");
  const replacement = join(fixture.root, "same-byte-retirement-replacement");
  const displaced = join(fixture.root, "original-retirement-file");
  await writeFile(replacement, await readFile(remainingFile, "utf8"), "utf8");
  const replacementIdentity = await lstat(replacement, { bigint: true });
  await rename(remainingFile, displaced);
  await rename(replacement, remainingFile);

  const evidenceRoot = join(
    interrupted.stageRoot,
    "transfer-evidence",
    "retirement",
    String(index),
  );
  const manifests = (await readdir(evidenceRoot))
    .filter((name) => /^\d{6}\.json$/.test(name))
    .sort((left, right) => left.localeCompare(right));
  let manifestPath = null;
  let manifest = null;
  for (const name of manifests) {
    const candidatePath = join(evidenceRoot, name);
    const candidate = JSON.parse(await readFile(candidatePath, "utf8"));
    if (candidate.entry !== remainingName) continue;
    manifestPath = candidatePath;
    manifest = candidate;
    break;
  }
  assert.ok(manifestPath);
  const fileNode = manifest.source.children.find(({ name }) => name === "state.txt").node;
  const forgedIdentity = {
    device: String(replacementIdentity.dev),
    inode: String(replacementIdentity.ino),
    kind: "file",
  };
  fileNode.identity = forgedIdentity;
  fileNode.proofIdentity = forgedIdentity;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const fixtureBeforeRecovery = await hashDirectory(fixture.root);

  await assert.rejects(
    () => recoverLegacyUserMigration(fixture.workspaceRoot, fixture.legacyUserRoot),
    (error) => error.code === "CONCURRENT_CHANGE",
  );

  const currentIdentity = await lstat(remainingFile, { bigint: true });
  assert.equal(currentIdentity.dev, replacementIdentity.dev);
  assert.equal(currentIdentity.ino, replacementIdentity.ino);
  assert.equal(await readFile(remainingFile, "utf8"), await readFile(displaced, "utf8"));
  assert.equal(await pathExists(join(record.path, removedName)), false);
  assert.equal(await hashDirectory(fixture.root), fixtureBeforeRecovery);
});
