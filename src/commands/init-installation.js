import { randomUUID } from "node:crypto";
import { link, lstat, open } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  assertValidConfig,
  assertWorkspaceConfigSnapshotCurrent,
  assertValidRepositoryConfig,
  createInitialConfig,
  createRepositoryConfig,
  createRepositoryRootMap,
  getRepositoryConfigPath,
  getWorkspaceConfigDirectory,
  getWorkspaceConfigPath,
  getWorkspaceInstallLockPath,
  normalizeWorkspaceConfiguredPath,
  readRepositoryConfigSnapshot,
  readWorkspaceConfigSnapshot,
  writeRepositoryConfig,
  writeWorkspaceConfig,
} from "../config.js";
import { assertChangeStoreConfinement } from "../change-store.js";
import {
  CHANGES_DIRECTORY_NAME,
  CLOSED_CHANGES_DIRECTORY_NAME,
  WORKFLOW_RELATIVE_PATH,
} from "../constants.js";
import { SddError } from "../errors.js";
import {
  createBoundDirectory,
  isPathPhysicallyInside,
  readBoundDirectory,
  readBoundRegularFile,
  sameBoundFileOwner,
  removeBoundDirectory,
  removeBoundRegularFile,
} from "../fs.js";
import { applyManagedInstallation } from "../installation.js";
import { withWorkspaceMutationLock } from "../mutation.js";
import { planSkillSync, readInstallLockSnapshot } from "../skills.js";
import { findOperationConfiguration } from "../workspace.js";
import { planWorkflowSync } from "../workflow.js";

function defaultRepositoryId(repositoryRoot) {
  return basename(repositoryRoot)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function installationResult(workspaceRoot, config, {
  createdWorkspaceConfig,
  dryRun,
  workflow,
  skills,
}) {
  return {
    command: "setup",
    mode: "workspace",
    workspaceRoot,
    createdWorkspaceConfig,
    dryRun,
    workspaceConfigPath: getWorkspaceConfigPath(workspaceRoot),
    config,
    workflowPath: resolve(workspaceRoot, WORKFLOW_RELATIVE_PATH),
    workflow,
    skills,
  };
}

async function lstatIfPresent(path) {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function boundFileMissing(snapshot) {
  return snapshot === null || snapshot?.missing === true;
}

function sameOptionalBoundFile(left, right) {
  if (boundFileMissing(left) || boundFileMissing(right)) {
    return boundFileMissing(left)
      && boundFileMissing(right)
      && sameBoundFileOwner(left?.ownerBinding ?? null, right?.ownerBinding ?? null);
  }
  return left.identity.dev === right.identity.dev
    && left.identity.ino === right.identity.ino
    && (right.mode === undefined || left.mode === right.mode)
    && left.bytes.equals(right.bytes)
    && sameBoundFileOwner(left.ownerBinding ?? null, right.ownerBinding ?? null);
}

function sameBoundFileOwnerExtension(previous, current) {
  if (
    !previous
    || !current
    || !Array.isArray(previous.ancestors)
    || !Array.isArray(current.ancestors)
    || previous.ancestors.length > current.ancestors.length
  ) {
    return false;
  }
  return sameBoundFileOwner(previous, {
    ...current,
    ancestors: current.ancestors.slice(0, previous.ancestors.length),
  });
}

function sameSetupLockAuthorityTransition(previous, current, configDirectorySnapshot) {
  if (!boundFileMissing(previous) || !boundFileMissing(current)) {
    return sameOptionalBoundFile(previous, current);
  }
  const configAncestor = current?.ownerBinding?.ancestors?.find(
    (ancestor) => ancestor.path === configDirectorySnapshot.path,
  );
  return sameBoundFileOwnerExtension(previous.ownerBinding, current.ownerBinding)
    && configAncestor?.lexicalType === "directory"
    && configAncestor.lexicalIdentity.dev === configDirectorySnapshot.identity.dev
    && configAncestor.lexicalIdentity.ino === configDirectorySnapshot.identity.ino;
}

function setupInvariantChanged(label, path, error = null) {
  return new SddError(`${label} changed before setup completed: ${path}`, {
    code: "CONCURRENT_CHANGE",
    ...(error ? { details: [error.message] } : {}),
  });
}

function sameSetupDirectoryIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino;
}

async function captureSetupDirectoryIdentity(workspaceRoot, path, label) {
  let first;
  let second;
  try {
    first = await lstat(path, { bigint: true });
    if (
      first.isSymbolicLink()
      || !first.isDirectory()
      || !(await isPathPhysicallyInside(workspaceRoot, path))
    ) {
      throw setupInvariantChanged(label, path);
    }
    second = await lstat(path, { bigint: true });
  } catch (error) {
    if (error?.code === "CONCURRENT_CHANGE") throw error;
    throw setupInvariantChanged(label, path, error);
  }
  const firstIdentity = { dev: String(first.dev), ino: String(first.ino) };
  const secondIdentity = { dev: String(second.dev), ino: String(second.ino) };
  if (
    second.isSymbolicLink()
    || !second.isDirectory()
    || !sameSetupDirectoryIdentity(firstIdentity, secondIdentity)
  ) {
    throw setupInvariantChanged(label, path);
  }
  return { label, path, identity: secondIdentity };
}

async function assertSetupDirectoriesCurrent(
  workspaceRoot,
  snapshots,
  closedChangesRoot,
) {
  for (const expected of snapshots) {
    const current = await captureSetupDirectoryIdentity(
      workspaceRoot,
      expected.path,
      expected.label,
    );
    if (!sameSetupDirectoryIdentity(current.identity, expected.identity)) {
      throw setupInvariantChanged(expected.label, expected.path);
    }
  }
  try {
    await assertChangeStoreConfinement(closedChangesRoot, workspaceRoot);
  } catch (error) {
    throw setupInvariantChanged("Workspace Change store", closedChangesRoot, error);
  }
}

async function assertOwnedSetupFilesCurrent(workspaceRoot, ownedFiles) {
  for (const record of ownedFiles) {
    let current;
    try {
      current = await readBoundRegularFile(record.path, {
        ownerRoot: workspaceRoot,
        label: record.label,
        unsafeCode: "CONCURRENT_CHANGE",
        expectedOwnerBinding: record.snapshot.ownerBinding,
      });
    } catch (error) {
      throw setupInvariantChanged(record.label, record.path, error);
    }
    if (!sameOptionalBoundFile(current, record.snapshot)) {
      throw setupInvariantChanged(record.label, record.path);
    }
  }
}


async function inspectFixedSetupFile(workspaceRoot, path, label) {
  const state = await lstatIfPresent(path);
  if (
    !(await isPathPhysicallyInside(workspaceRoot, path))
    || state?.isSymbolicLink()
    || (state && !state.isFile())
  ) {
    throw new SddError(`${label} must be a confined regular file: ${path}`, {
      code: "UNSAFE_CONFIG_PATH",
    });
  }
  return state;
}

async function ensureSetupDirectory(
  workspaceRoot,
  path,
  label,
  ownedDirectories,
  afterOwnershipCapture = null,
  expectedInitialSnapshot = undefined,
) {
  const initial = await lstatIfPresent(path);
  if (
    expectedInitialSnapshot !== undefined
    && (
      (expectedInitialSnapshot === null && initial !== null)
      || (
        expectedInitialSnapshot !== null
        && (
          initial === null
          || expectedInitialSnapshot.identity.dev !== String(initial.dev)
          || expectedInitialSnapshot.identity.ino !== String(initial.ino)
        )
      )
    )
  ) {
    throw setupInvariantChanged(label, path);
  }
  let createdManifest = null;
  if (initial === null) {
    try {
      createdManifest = await createBoundDirectory(path, {
        ownerRoot: workspaceRoot,
        label,
        unsafeCode: "UNSAFE_ARTIFACT_PATH",
        mode: 0o755,
      });
    } catch (error) {
      if (!(await lstatIfPresent(path))) throw error;
      const failure = new SddError(
        `${label} was created, but its ownership could not be verified; it was preserved.`,
        {
          code: "MUTATION_RECOVERY_FAILED",
          details: [
            `Original error: ${error?.code ? `${error.code}: ` : ""}${error.message}`,
            `Retained unverified directory: ${path}`,
          ],
        },
      );
      failure.errors = [error];
      failure.cause = error;
      throw failure;
    }
    ownedDirectories.push({
      kind: "directory",
      label,
      path,
      ownerRoot: workspaceRoot,
      manifest: createdManifest,
    });
    if (afterOwnershipCapture) await afterOwnershipCapture({ label, path });
  }
  const boundSnapshot = await readBoundDirectory(path, {
    ownerRoot: workspaceRoot,
    label,
    unsafeCode: "UNSAFE_ARTIFACT_PATH",
    expectedBinding: createdManifest?.binding,
  });

  const state = await lstatIfPresent(path);
  if (
    !state
    || state.isSymbolicLink()
    || !state.isDirectory()
    || !(await isPathPhysicallyInside(workspaceRoot, path))
  ) {
    throw new SddError(`${label} must be a confined real directory: ${path}`, {
      code: "UNSAFE_ARTIFACT_PATH",
    });
  }
  const expectedIdentity = createdManifest?.root.identity ?? {
    dev: String(initial.dev),
    ino: String(initial.ino),
  };
  if (
    expectedIdentity.dev !== String(state.dev)
    || expectedIdentity.ino !== String(state.ino)
  ) {
    throw new SddError(`${label} changed while setup captured its ownership: ${path}`, {
      code: "CONCURRENT_CHANGE",
    });
  }
  return {
    path,
    label,
    identity: expectedIdentity,
    binding: boundSnapshot.binding,
  };
}

function setupFilePublicationError(error, label, path) {
  if (["EEXIST", "EISDIR", "ENOENT", "ENOTDIR"].includes(error?.code)) {
    return new SddError(`${label} appeared or changed during setup: ${path}`, {
      code: "CONCURRENT_CHANGE",
      details: [error.message],
    });
  }
  return error;
}

async function createOwnedSetupFile(
  workspaceRoot,
  path,
  label,
  source,
  ownedFiles,
  beforePublish = null,
  beforeTemporaryCleanup = null,
) {
  const temporary = join(
    dirname(path),
    `.${basename(path)}.sdd-setup-${process.pid}-${randomUUID()}`,
  );
  const cleanupDetails = [];
  const cleanupErrors = [];
  let handle;
  let primaryError = null;
  let published = false;
  let temporaryCreated = false;
  let temporaryIdentity = null;
  try {
    handle = await open(temporary, "wx", 0o600);
    temporaryCreated = true;
    const state = await handle.stat({ bigint: true });
    temporaryIdentity = { dev: String(state.dev), ino: String(state.ino) };
    await handle.writeFile(source, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    if (beforePublish) await beforePublish({ label, path });
    try {
      await link(temporary, path);
    } catch (error) {
      throw setupFilePublicationError(error, label, path);
    }
    const snapshot = await readBoundRegularFile(path, {
      ownerRoot: workspaceRoot,
      label,
      unsafeCode: "CONCURRENT_CHANGE",
    });
    if (
      snapshot.identity.dev !== temporaryIdentity.dev
      || snapshot.identity.ino !== temporaryIdentity.ino
      || snapshot.source !== source
    ) {
      throw new SddError(`${label} changed while setup captured its ownership: ${path}`, {
        code: "CONCURRENT_CHANGE",
      });
    }
    ownedFiles.push({
      kind: "file",
      label,
      path,
      source,
      state,
      snapshot,
      ownerRoot: workspaceRoot,
    });
    published = true;
  } catch (error) {
    primaryError = error;
  }
  if (handle) {
    try {
      await handle.close();
    } catch (error) {
      cleanupErrors.push(error);
      appendCleanupFailure(cleanupDetails, `Close setup temporary file ${temporary}`, error);
    }
  }
  if (temporaryCreated) {
    try {
      if (temporaryIdentity === null) {
        throw new SddError(
          `${label} temporary-file identity could not be authenticated: ${temporary}`,
          { code: "CONCURRENT_CHANGE" },
        );
      }
      const temporarySnapshot = await readBoundRegularFile(temporary, {
        ownerRoot: workspaceRoot,
        label: `${label} temporary file`,
        unsafeCode: "CONCURRENT_CHANGE",
      });
      if (
        temporarySnapshot.identity.dev !== temporaryIdentity.dev
        || temporarySnapshot.identity.ino !== temporaryIdentity.ino
      ) {
        throw new SddError(`${label} temporary file was replaced: ${temporary}`, {
          code: "CONCURRENT_CHANGE",
        });
      }
      await beforeTemporaryCleanup?.({
        label,
        path,
        temporary,
        published,
      });
      await removeBoundRegularFile(temporary, temporarySnapshot, {
        ownerRoot: workspaceRoot,
        label: `${label} temporary file`,
      });
    } catch (error) {
      cleanupErrors.push(error);
      appendCleanupFailure(cleanupDetails, `Remove setup temporary file ${temporary}`, error);
      cleanupDetails.push(`Retained temporary path requiring inspection: ${temporary}`);
    }
  }
  if (!primaryError && cleanupErrors.length === 0) return;
  if (!primaryError) {
    primaryError = new SddError(
      `${label} was published but temporary-file cleanup failed.`,
      {
        code: "MUTATION_RECOVERY_FAILED",
        details: [`Published path: ${path}`, ...cleanupDetails],
      },
    );
  } else if (cleanupErrors.length > 0) {
    const publicationError = primaryError;
    primaryError = new SddError(`${label} creation failed and cleanup was incomplete.`, {
      code: "MUTATION_RECOVERY_FAILED",
      details: [
        `Original error: ${publicationError.message}`,
        ...(Array.isArray(publicationError.details)
          ? publicationError.details.map((detail) => `Original detail: ${detail}`)
          : []),
        ...cleanupDetails,
      ],
    });
    primaryError.errors = [publicationError, ...cleanupErrors];
    primaryError.cause = new AggregateError(primaryError.errors, primaryError.message);
  }
  if (published && cleanupErrors.length > 0 && !primaryError.errors) {
    primaryError.errors = cleanupErrors;
    primaryError.cause = new AggregateError(cleanupErrors, primaryError.message);
  }
  throw primaryError;
}

function setupDirectoryCleanupFailure(record, cleanup) {
  const errors = cleanup.failures.map(({ error }) => error);
  const retainedPaths = [...new Set(cleanup.retainedPaths)];
  const failure = new SddError(`${record.label} could not be removed safely during rollback.`, {
    code: "MUTATION_RECOVERY_FAILED",
    details: [
      ...cleanup.failures.flatMap(({ label, error }) => [
        `${label}: ${error.message}`,
        ...(error?.details ?? []).map((detail) => `${label}: ${detail}`),
      ]),
      ...retainedPaths.map((path) => `Retained path requiring inspection: ${path}`),
    ],
  });
  failure.errors = errors;
  failure.cause = new AggregateError(errors, failure.message);
  return failure;
}

async function removeOwnedSetupEntry(
  record,
  beforeQuarantine = null,
  beforeQuarantineRemoval = null,
) {
  if (!(await lstatIfPresent(record.path))) return;
  const beforeCleanup = beforeQuarantine
    ? () => beforeQuarantine({
        kind: record.kind,
        label: record.label,
        path: record.path,
      })
    : null;
  const afterQuarantine = beforeQuarantineRemoval
    ? ({ quarantine }) => beforeQuarantineRemoval({
        kind: record.kind,
        label: record.label,
        path: record.path,
        quarantine,
      })
    : null;

  if (record.kind === "file") {
    await removeBoundRegularFile(record.path, record.snapshot, {
      ownerRoot: record.ownerRoot,
      label: record.label,
      beforeCleanup,
      afterQuarantine,
    });
    return;
  }

  let directoryRemovalHookInvoked = false;
  const cleanup = await removeBoundDirectory(record.path, record.manifest, {
    ownerRoot: record.ownerRoot,
    label: record.label,
    unsafeCode: "CONCURRENT_CHANGE",
    beforeCleanup,
    beforeEntryCleanup: afterQuarantine
      ? async ({ quarantine }) => {
          if (directoryRemovalHookInvoked) return;
          directoryRemovalHookInvoked = true;
          await afterQuarantine({ quarantine });
        }
      : null,
  });
  if (cleanup.failures.length > 0) {
    throw setupDirectoryCleanupFailure(record, cleanup);
  }
}

function appendCleanupFailure(failures, action, error) {
  const code = error?.code ? `${error.code}: ` : "";
  failures.push(`${action}: ${code}${error?.message ?? String(error)}`);
  if (Array.isArray(error?.details)) {
    failures.push(...error.details.map((detail) => `${action}: ${detail}`));
  }
}

async function rollbackSetupCreation(
  error,
  workspaceRoot,
  ownedFiles,
  ownedDirectories,
  {
    initialInstallLockSnapshot,
    managedInstallationStarted,
    managedInstallationCommitted,
    beforeSetupRollbackQuarantine,
    beforeSetupRollbackQuarantineRemoval,
  },
) {
  const failures = [];
  const cleanupErrors = [];
  let canRollback = !managedInstallationCommitted;
  const installLockPath = getWorkspaceInstallLockPath(workspaceRoot);
  if (canRollback && managedInstallationStarted) {
    try {
      const currentLockSnapshot = await readBoundRegularFile(installLockPath, {
        ownerRoot: workspaceRoot,
        allowMissing: true,
        returnMissingBinding: initialInstallLockSnapshot?.missing === true,
        label: "Workspace installation lock",
        unsafeCode: "UNSAFE_CONFIG_PATH",
        expectedOwnerBinding: initialInstallLockSnapshot?.ownerBinding,
      });
      if (!sameOptionalBoundFile(currentLockSnapshot, initialInstallLockSnapshot)) {
        const cleanupError = new SddError(
          `Workspace installation lock was not restored after setup failed: ${installLockPath}`,
          {
            code: "MUTATION_RECOVERY_FAILED",
            details: [`Retained installation lock path: ${installLockPath}`],
          },
        );
        cleanupErrors.push(cleanupError);
        appendCleanupFailure(
          failures,
          `Inspect installation lock ${installLockPath}`,
          cleanupError,
        );
        canRollback = false;
      }
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
      appendCleanupFailure(failures, `Inspect installation lock ${installLockPath}`, cleanupError);
      canRollback = false;
    }
  }
  if (canRollback) {
    for (const record of [
      ...[...ownedFiles].reverse(),
      ...[...ownedDirectories].reverse(),
    ]) {
      try {
        await removeOwnedSetupEntry(
          record,
          beforeSetupRollbackQuarantine,
          beforeSetupRollbackQuarantineRemoval,
        );
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
        appendCleanupFailure(
          failures,
          `Remove setup-created ${record.kind} ${record.path}`,
          cleanupError,
        );
      }
    }
  }
  if (failures.length === 0) return error;
  const recoveryError = new SddError("Workspace setup failed and rollback was incomplete.", {
    code: "MUTATION_RECOVERY_FAILED",
    details: [
      `Original error: ${error?.code ? `${error.code}: ` : ""}${error?.message ?? String(error)}`,
      ...(Array.isArray(error?.details)
        ? error.details.map((detail) => `Original detail: ${detail}`)
        : []),
      ...failures,
    ],
  });
  recoveryError.errors = [error, ...cleanupErrors];
  recoveryError.cause = new AggregateError(recoveryError.errors, recoveryError.message);
  return recoveryError;
}

export async function setupInstallation(
  workspacePath = process.cwd(),
  options = {},
) {
  const workspaceRoot = resolve(workspacePath);
  if (options.dryRun) return setupInstallationUnlocked(workspaceRoot, options);
  return withWorkspaceMutationLock(
    workspaceRoot,
    () => setupInstallationUnlocked(workspaceRoot, options),
  );
}
function sameRepositoryRootMap(left, right) {
  const keys = Object.keys(left).sort((a, b) => a.localeCompare(b));
  const rightKeys = Object.keys(right).sort((a, b) => a.localeCompare(b));
  return keys.length === rightKeys.length
    && keys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}


async function setupInstallationUnlocked(
  workspaceRoot,
  {
    planningRoot,
    repositoryRoots,
    skillsDirectory,
    force = false,
    dryRun = false,
    writeLock = null,
    beforeSetupFilePublish = null,
    beforeSetupTemporaryCleanup = null,
    beforeSetupRollbackQuarantine = null,
    beforeSetupRollbackQuarantineRemoval = null,
    afterSetupDirectoryOwnershipCapture = null,
    beforeManagedInstallationSuccess = null,
  } = {},
) {
  const normalizedPlanningRoot = planningRoot === undefined
    ? undefined
    : normalizeWorkspaceConfiguredPath(workspaceRoot, planningRoot);
  const normalizedRepositoryRoots = repositoryRoots === undefined
    ? undefined
    : repositoryRoots.map((path) => normalizeWorkspaceConfiguredPath(workspaceRoot, path));
  const normalizedSkillsDirectory = skillsDirectory === undefined
    ? undefined
    : normalizeWorkspaceConfiguredPath(workspaceRoot, skillsDirectory);
  const configDirectory = getWorkspaceConfigDirectory(workspaceRoot);
  const configPath = getWorkspaceConfigPath(workspaceRoot);
  const ignorePath = join(configDirectory, ".gitignore");
  const existingConfigState = await inspectFixedSetupFile(
    workspaceRoot,
    configPath,
    "Workspace configuration",
  );
  const existingIgnoreState = await inspectFixedSetupFile(
    workspaceRoot,
    ignorePath,
    "Workspace SDD ignore file",
  );
  const existing = existingConfigState !== null;
  const ignoreExists = existingIgnoreState !== null;
  const installLockPath = getWorkspaceInstallLockPath(workspaceRoot);
  const initialInstallLockSnapshot = await readBoundRegularFile(installLockPath, {
    ownerRoot: workspaceRoot,
    allowMissing: true,
    label: "Workspace installation lock",
    unsafeCode: "UNSAFE_CONFIG_PATH",
  });
  const changesRoot = join(configDirectory, CHANGES_DIRECTORY_NAME);
  let rollbackInstallLockSnapshot = initialInstallLockSnapshot;
  const closedChangesRoot = join(changesRoot, CLOSED_CHANGES_DIRECTORY_NAME);
  let workspaceConfigSnapshot = existing
    ? await readWorkspaceConfigSnapshot(workspaceRoot)
    : null;
  const config = workspaceConfigSnapshot === null
    ? await createInitialConfig(workspaceRoot, {
        planningRoot: normalizedPlanningRoot,
        repositoryRoots: normalizedRepositoryRoots,
        skillsDirectory: normalizedSkillsDirectory,
      })
    : workspaceConfigSnapshot.config;
  if (existing) {
    const requestedRepositoryRoots = normalizedRepositoryRoots === undefined
      ? null
      : createRepositoryRootMap(normalizedRepositoryRoots);
    const hasConflictingOverride = (
      (normalizedPlanningRoot !== undefined && normalizedPlanningRoot !== config.planning.root)
      || (
        normalizedSkillsDirectory !== undefined
        && normalizedSkillsDirectory !== config.skills.directory
      )
      || (
        requestedRepositoryRoots !== null
        && !sameRepositoryRootMap(requestedRepositoryRoots, config.repositories.roots)
      )
    );
    if (hasConflictingOverride) {
      throw new SddError(
        "Workspace layout overrides only apply when creating .sdd/config.yaml. Edit the existing configuration directly.",
        { code: "CONFIG_ALREADY_EXISTS" },
      );
    }
  }
  assertValidConfig(config, "set up the workspace installation");
  await assertChangeStoreConfinement(closedChangesRoot, workspaceRoot);

  let installLockSnapshot = await readInstallLockSnapshot(workspaceRoot, {
    includeMissingBinding: true,
  });
  const skillPlan = await planSkillSync(workspaceRoot, config, {
    force,
    installLockSnapshot,
  });
  const workflowPlan = await planWorkflowSync(workspaceRoot, {
    force,
    installLockSnapshot,
  });
  await assertWorkspaceConfigSnapshotCurrent(workspaceRoot, workspaceConfigSnapshot);
  if (dryRun) {
    return installationResult(workspaceRoot, config, {
      createdWorkspaceConfig: !existing,
      dryRun: true,
      workflow: {
        path: WORKFLOW_RELATIVE_PATH,
        action: workflowPlan.action,
        hash: workflowPlan.sourceHash,
      },
      skills: {
        skillsDirectory: skillPlan.skillsDirectory,
        actions: skillPlan.actions.map(({ skillName, action, sourceHash }) => ({
          skillName,
          action,
          hash: sourceHash,
        })),
      },
    });
  }

  const ownedDirectories = [];
  const ownedFiles = [];
  let workflow;
  let skills;
  let managedInstallationStarted = false;
  let managedInstallationCommitted = false;
  let configDirectorySnapshot = (await lstatIfPresent(configDirectory)) === null
    ? null
    : await captureSetupDirectoryIdentity(
        workspaceRoot,
        configDirectory,
        "Workspace SDD directory",
      );
  try {
    configDirectorySnapshot = await ensureSetupDirectory(
      workspaceRoot,
      configDirectory,
      "Workspace SDD directory",
      ownedDirectories,
      afterSetupDirectoryOwnershipCapture,
      configDirectorySnapshot,
    );
    const changesDirectorySnapshot = await ensureSetupDirectory(
      workspaceRoot,
      changesRoot,
      "Workspace Change store",
      ownedDirectories,
      afterSetupDirectoryOwnershipCapture,
    );
    const closedChangesDirectorySnapshot = await ensureSetupDirectory(
      workspaceRoot,
      closedChangesRoot,
      "Workspace closed Change store",
      ownedDirectories,
      afterSetupDirectoryOwnershipCapture,
    );
    const configDirectoryAncestor = changesDirectorySnapshot.binding.ancestors.find(
      (ancestor) => ancestor.path === configDirectory,
    );
    if (
      configDirectoryAncestor?.lexicalType !== "directory"
      || configDirectoryAncestor.lexicalIdentity.dev !== configDirectorySnapshot.identity.dev
      || configDirectoryAncestor.lexicalIdentity.ino !== configDirectorySnapshot.identity.ino
    ) {
      throw setupInvariantChanged("Workspace SDD directory", configDirectory);
    }
    const setupDirectorySnapshots = [
      configDirectorySnapshot,
      changesDirectorySnapshot,
      closedChangesDirectorySnapshot,
    ];
    const currentInstallLockSnapshot = await readInstallLockSnapshot(workspaceRoot, {
      includeMissingBinding: true,
    });
    if (
      !sameSetupLockAuthorityTransition(
        installLockSnapshot,
        currentInstallLockSnapshot,
        configDirectorySnapshot,
      )
    ) {
      throw setupInvariantChanged("Workspace installation lock", installLockPath);
    }
    installLockSnapshot = currentInstallLockSnapshot;
    rollbackInstallLockSnapshot = currentInstallLockSnapshot;
    skillPlan.installLockSnapshot = currentInstallLockSnapshot;
    workflowPlan.installLockSnapshot = currentInstallLockSnapshot;
    if (!existing) {
      if (await inspectFixedSetupFile(workspaceRoot, configPath, "Workspace configuration")) {
        throw new SddError(`Workspace configuration appeared during setup: ${configPath}`, {
          code: "CONCURRENT_CHANGE",
        });
      }
      await writeWorkspaceConfig(workspaceRoot, config, {
        writeFile: (path, source) => createOwnedSetupFile(
          workspaceRoot,
          path,
          "Workspace configuration",
          source,
          ownedFiles,
          beforeSetupFilePublish,
          beforeSetupTemporaryCleanup,
        ),
      });
      const ownedConfig = ownedFiles.find((record) => record.path === configPath);
      if (!ownedConfig) {
        throw new SddError(`Workspace configuration ownership was not captured: ${configPath}`, {
          code: "MUTATION_RECOVERY_FAILED",
        });
      }
      workspaceConfigSnapshot = ownedConfig.snapshot;
    }
    if (!ignoreExists) {
      if (await inspectFixedSetupFile(workspaceRoot, ignorePath, "Workspace SDD ignore file")) {
        throw new SddError(`Workspace SDD ignore file appeared during setup: ${ignorePath}`, {
          code: "CONCURRENT_CHANGE",
        });
      }
      await createOwnedSetupFile(
        workspaceRoot,
        ignorePath,
        "Workspace SDD ignore file",
        "cache/\n",
        ownedFiles,
        beforeSetupFilePublish,
        beforeSetupTemporaryCleanup,
      );
    }
    await assertWorkspaceConfigSnapshotCurrent(workspaceRoot, workspaceConfigSnapshot);
    managedInstallationStarted = true;
    ({ workflow, skills } = await applyManagedInstallation(workspaceRoot, {
      skillPlan,
      workflowPlan,
      afterLockPublish: () => assertWorkspaceConfigSnapshotCurrent(
        workspaceRoot,
        workspaceConfigSnapshot,
      ),
      beforeSuccess: async (context) => {
        await beforeManagedInstallationSuccess?.(context);
        await assertWorkspaceConfigSnapshotCurrent(workspaceRoot, workspaceConfigSnapshot);
        await assertSetupDirectoriesCurrent(
          workspaceRoot,
          setupDirectorySnapshots,
          closedChangesRoot,
        );
        await assertOwnedSetupFilesCurrent(workspaceRoot, ownedFiles);
        await assertWorkspaceConfigSnapshotCurrent(workspaceRoot, workspaceConfigSnapshot);
      },
      onCommitted: () => {
        managedInstallationCommitted = true;
      },
      onFailure: (_error, { restoredInstallLockSnapshot } = {}) => {
        if (restoredInstallLockSnapshot !== undefined) {
          rollbackInstallLockSnapshot = restoredInstallLockSnapshot;
        }
      },
      ...(writeLock ? { writeLock } : {}),
    }));
  } catch (error) {
    throw await rollbackSetupCreation(
      error,
      workspaceRoot,
      ownedFiles,
      ownedDirectories,
      {
        initialInstallLockSnapshot: rollbackInstallLockSnapshot,
        managedInstallationStarted,
        managedInstallationCommitted,
        beforeSetupRollbackQuarantine,
        beforeSetupRollbackQuarantineRemoval,
      },
    );
  }

  return installationResult(workspaceRoot, config, {
    createdWorkspaceConfig: !existing,
    dryRun: false,
    workflow,
    skills,
  });
}

export async function initRepository(
  targetPath,
  { repositoryId, dryRun = false, workspaceRoot: explicitWorkspaceRoot } = {},
) {
  const repositoryRoot = resolve(targetPath);
  const operation = await findOperationConfiguration(repositoryRoot, {
    ...(explicitWorkspaceRoot ? { workspaceRoot: explicitWorkspaceRoot } : {}),
  });
  assertValidConfig(operation.config, "initialize a repository");
  const options = {
    repositoryId,
    dryRun,
    workspaceRoot: operation.workspaceRoot,
    workspaceConfig: operation.config,
  };
  if (dryRun) return initRepositoryUnlocked(repositoryRoot, options);
  return withWorkspaceMutationLock(
    repositoryRoot,
    () => initRepositoryUnlocked(repositoryRoot, options),
  );
}

async function initRepositoryUnlocked(
  repositoryRoot,
  { repositoryId, dryRun, workspaceRoot, workspaceConfig },
) {
  const targetConfigPath = getRepositoryConfigPath(repositoryRoot);
  const targetConfigSnapshot = await readRepositoryConfigSnapshot(repositoryRoot);
  const existingRepositoryConfig = targetConfigSnapshot?.config?.kind === "repository"
    ? targetConfigSnapshot.config
    : null;
  if (targetConfigSnapshot !== null && existingRepositoryConfig === null) {
    throw new SddError(
      `A non-repository SDD configuration already exists at ${targetConfigPath}.`,
      { code: "EXISTING_WORKSPACE_CONFIG" },
    );
  }
  const repositoryConfig = existingRepositoryConfig ?? createRepositoryConfig(
    repositoryId ?? defaultRepositoryId(repositoryRoot),
  );
  assertValidRepositoryConfig(repositoryConfig);
  if (!dryRun && !existingRepositoryConfig) {
    await writeRepositoryConfig(repositoryRoot, repositoryConfig, { expected: null });
  }
  return {
    command: "init",
    mode: "repository",
    workspaceRoot,
    repositoryRoot,
    createdRepositoryConfig: !existingRepositoryConfig,
    dryRun,
    workspaceConfigPath: getWorkspaceConfigPath(workspaceRoot),
    repositoryConfigPath: targetConfigPath,
    workspaceConfig,
    repositoryConfig,
    workflowPath: resolve(workspaceRoot, WORKFLOW_RELATIVE_PATH),
  };
}
