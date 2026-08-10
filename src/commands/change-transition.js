import { randomUUID } from "node:crypto";
import { link, lstat, open, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { assertValidChangeId } from "../change-id.js";
import {
  assertChangeStoreConfinement,
  assertRequiredChangeFileSnapshotCurrent,
  getActiveChangePath,
  getClosedChangePath,
  readRequiredChangeFileSnapshot,
  relativeChangeStorePath,
} from "../change-store.js";
import {
  assertSelectedRepositorySnapshotsCurrent,
  resolveRepositoriesForMetadata,
} from "../change-repositories.js";
import {
  CHANGE_STATUSES,
  canTransitionChangeStatus,
  parseChangeMetadata,
  replaceChangeStatus,
} from "../change-status.js";
import {
  appendTransitionTransactionState,
  cleanupTransitionTransactionJournal,
  closeTransitionTransactionJournal,
  createTransitionTransactionJournal,
  listTransitionTransactionIds,
  loadTransitionTransactionJournal,
  reconcileTransitionTransactionReceipts,
} from "../change-transition-transaction.js";
import { assertValidConfig, resolveWorkspaceStatus } from "../config.js";
import {
  assertOperationConfigurationCurrent,
  resolveOperationConfiguration,
} from "../workspace.js";
import { SddError } from "../errors.js";
import {
  isDirectory,
  pathExists,
  readBoundRegularFile,
  removeBoundRegularFile,
} from "../fs.js";
import { withWorkspaceMutationLock } from "../mutation.js";

const NO_REPLACE_COLLISION_CODES = new Set(["EEXIST", "EISDIR", "ENOTEMPTY"]);

function fileIdentity(state) {
  return { dev: String(state.dev), ino: String(state.ino) };
}

function sameFileIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino;
}
function fileMode(state) {
  return Number(state.mode & 0o777n);
}

function serializeTransitionSnapshot(snapshot) {
  return {
    identity: snapshot.identity,
    mode: snapshot.mode,
    bytes: snapshot.bytes.toString("base64"),
  };
}


function deserializeTransitionSnapshot(snapshot) {
  if (snapshot === null) return null;
  const bytes = Buffer.from(snapshot.bytes, "base64");
  return {
    identity: snapshot.identity,
    mode: snapshot.mode,
    bytes,
    source: bytes.toString("utf8"),
  };
}

function nextTransitionTransactionState(session, updates) {
  const { receipt, ...state } = session.state;
  return { ...state, ...updates };
}
async function inspectTransitionFile(path) {
  try {
    const before = await lstat(path, { bigint: true });
    const identity = fileIdentity(before);
    const mode = fileMode(before);
    if (!before.isFile() || before.isSymbolicLink()) {
      return { identity, mode, bytes: null, source: null };
    }
    const bytes = await readFile(path);
    const source = bytes.toString("utf8");
    const after = await lstat(path, { bigint: true });
    if (!after.isFile() || after.isSymbolicLink()
      || !sameFileIdentity(identity, fileIdentity(after))
      || mode !== fileMode(after)) {
      return { identity: null, mode: null, bytes: null, source: null };
    }
    return { identity, mode, bytes, source };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function matchesTransitionFile(snapshot, expected) {
  return snapshot !== null
    && expected !== null
    && sameFileIdentity(snapshot.identity, expected.identity)
    && (expected.mode === undefined || snapshot.mode === expected.mode)
    && (
      expected.bytes === undefined
      || (Buffer.isBuffer(snapshot.bytes) && snapshot.bytes.equals(expected.bytes))
    )
    && (expected.source === undefined || snapshot.source === expected.source);
}

async function removeOwnedTransitionFile(
  path,
  expected,
  label,
  ownerRoot,
  cleanupHook = null,
) {
  const observed = await readBoundRegularFile(path, {
    ownerRoot,
    allowMissing: true,
    label,
    unsafeCode: "MUTATION_RECOVERY_FAILED",
  });
  if (observed === null) return;
  if (!matchesTransitionFile(observed, expected)) {
    throw new SddError(`${label} changed before cleanup.`, {
      code: "MUTATION_RECOVERY_FAILED",
      details: [`Concurrent content retained at ${path}.`],
    });
  }
  let cleanupMutationPath = path;
  try {
    await removeBoundRegularFile(path, observed, {
      ownerRoot,
      label,
      beforeCleanup: cleanupHook
        ? () => {
            cleanupMutationPath = path;
            return cleanupHook({ phase: "before-quarantine", path });
          }
        : null,
      beforeQuarantine: cleanupHook
        ? ({ quarantine }) => {
            cleanupMutationPath = quarantine;
            return cleanupHook({
              phase: "before-quarantine-claim",
              path,
              quarantinePath: quarantine,
            });
          }
        : null,
      beforeRemovalMutation: cleanupHook
        ? (mutation) => {
            if (mutation.action === "remove-canonical") {
              cleanupMutationPath = mutation.path;
              return cleanupHook({
                phase: "before-source-remove",
                path: mutation.path,
                quarantinePath: mutation.target,
              });
            }
            if (mutation.action === "remove") {
              cleanupMutationPath = mutation.path;
              return cleanupHook({
                phase: "before-remove",
                path: mutation.path,
                originalPath: path,
              });
            }
            return undefined;
          }
        : null,
    });
  } catch (error) {
    throw new SddError(`${label} changed during cleanup.`, {
      code: "MUTATION_RECOVERY_FAILED",
      details: [
        `Concurrent content retained at ${cleanupMutationPath}.`,
        ...(error.details ?? [error.message]),
      ],
    });
  }
}

async function removeRecoveryFile(path, expected, label, ownerRoot) {
  const current = await inspectTransitionFile(path);
  if (current === null) return;
  if (!matchesTransitionFile(current, expected)) {
    throw new SddError(`${label} changed before transition recovery.`, {
      code: "MUTATION_RECOVERY_FAILED",
      details: [`Concurrent content retained at ${path}.`],
    });
  }
  await removeOwnedTransitionFile(path, expected, label, ownerRoot);
}

async function finishRecoveredTransaction(
  session,
  phase,
  afterPhase = null,
  afterReceiptCleanup = null,
) {
  if (session.state.phase !== phase) {
    await appendTransitionTransactionState(
      session,
      nextTransitionTransactionState(session, { phase }),
    );
  }
  if (afterPhase) await afterPhase({ phase, recovery: true, state: session.state });
  const cleanupFailures = await cleanupTransitionTransactionJournal(session, {
    afterReceiptCleanup,
  });
  if (cleanupFailures.length > 0) {
    throw new SddError("Change transition recovery receipt cleanup was incomplete.", {
      code: "MUTATION_RECOVERY_FAILED",
      details: cleanupFailures,
    });
  }
}

export async function recoverPendingChangeTransition(
  workspaceRoot,
  changeId,
  {
    afterTransitionTransactionPhase = null,
    afterTransitionReceiptStageCleanup = null,
    afterTransitionReceiptCleanup = null,
  } = {},
) {
  await reconcileTransitionTransactionReceipts(workspaceRoot, changeId, {
    afterStagedCleanup: afterTransitionReceiptStageCleanup,
  });
  const session = await loadTransitionTransactionJournal(workspaceRoot, changeId);
  if (session === null) return null;
  const state = session.state;
  const expectedChangePath = getActiveChangePath(changeId, workspaceRoot);
  const expectedClosedPath = getClosedChangePath(changeId, workspaceRoot);
  const expectedTasksPath = join(expectedChangePath, "tasks.md");
  if (
    state.changePath !== expectedChangePath
    || state.closedPath !== expectedClosedPath
    || state.tasksPath !== expectedTasksPath
    || dirname(state.temporaryPath) !== dirname(expectedTasksPath)
    || dirname(state.backupPath) !== dirname(expectedTasksPath)
    || !basename(state.temporaryPath).startsWith(".tasks.md.sdd-transition-")
    || !basename(state.backupPath).startsWith(".tasks.md.sdd-backup-")
  ) {
    await closeTransitionTransactionJournal(session).catch(() => {});
    throw new SddError(`Change transition recovery paths are not canonical: ${changeId}`, {
      code: "MUTATION_RECOVERY_FAILED",
      details: [`Recovery journal retained at ${session.path}.`],
    });
  }
  const original = deserializeTransitionSnapshot(state.originalSnapshot);
  const temporary = deserializeTransitionSnapshot(state.temporarySnapshot);
  const backup = deserializeTransitionSnapshot(state.backupSnapshot);
  try {
    await Promise.all([
      assertChangeStoreConfinement(state.changePath, workspaceRoot),
      assertChangeStoreConfinement(state.closedPath, workspaceRoot),
      assertChangeStoreConfinement(state.tasksPath, workspaceRoot),
      assertChangeStoreConfinement(state.temporaryPath, workspaceRoot),
      assertChangeStoreConfinement(state.backupPath, workspaceRoot),
    ]);
    const closedExists = await pathExists(state.closedPath);
    let tasks = await inspectTransitionFile(state.tasksPath);
    if (closedExists) {
      if (matchesTransitionFile(tasks, temporary)) {
        await removeOwnedTransitionFile(
          state.tasksPath,
          temporary,
          "Published active Change during closed-location recovery",
          workspaceRoot,
        );
        tasks = null;
      }
      if (!["closed-collision", "complete", "rolled-back"].includes(state.phase)) {
        await appendTransitionTransactionState(
          session,
          nextTransitionTransactionState(session, { phase: "closed-collision" }),
        );
        if (afterTransitionTransactionPhase) {
          await afterTransitionTransactionPhase({
            phase: "closed-collision",
            recovery: true,
            state: session.state,
          });
        }
      }
      await closeTransitionTransactionJournal(session);
      throw new SddError(`Closed Change appeared during transition recovery: ${changeId}`, {
        code: "CONCURRENT_CHANGE",
        details: [
          `Closed winner preserved at ${state.closedPath}.`,
          `Recovery journal retained at ${session.path}.`,
          ...(tasks === null ? [] : [`Active content retained at ${state.tasksPath}.`]),
        ],
      });
    }

    const tasksArePublished = matchesTransitionFile(tasks, temporary);
    if (tasks !== null && !tasksArePublished && !matchesTransitionFile(tasks, original)) {
      throw new SddError(`Active Change changed during transition recovery: ${changeId}`, {
        code: "MUTATION_RECOVERY_FAILED",
        details: [
          `Concurrent content retained at ${state.tasksPath}.`,
          `Recovery journal retained at ${session.path}.`,
        ],
      });
    }

    if (!tasksArePublished && tasks === null) {
      const currentBackup = await inspectTransitionFile(state.backupPath);
      if (!backup || !matchesTransitionFile(currentBackup, backup)) {
        throw new SddError(`Original Change cannot be restored during recovery: ${changeId}`, {
          code: "MUTATION_RECOVERY_FAILED",
          details: [
            `Expected recovery backup at ${state.backupPath}.`,
            `Recovery journal retained at ${session.path}.`,
          ],
        });
      }
      try {
        await link(state.backupPath, state.tasksPath);
      } catch (error) {
        if (!NO_REPLACE_COLLISION_CODES.has(error?.code)) throw error;
      }
      tasks = await inspectTransitionFile(state.tasksPath);
      if (!matchesTransitionFile(tasks, original)) {
        throw new SddError(`Original Change restoration raced during recovery: ${changeId}`, {
          code: "MUTATION_RECOVERY_FAILED",
          details: [
            `Concurrent content retained at ${state.tasksPath}.`,
            `Recovery backup retained at ${state.backupPath}.`,
            `Recovery journal retained at ${session.path}.`,
          ],
        });
      }
    }

    if (backup !== null) {
      await removeRecoveryFile(
        state.backupPath,
        backup,
        "Change transition recovery backup",
        workspaceRoot,
      );
    } else if (await pathExists(state.backupPath)) {
      throw new SddError(`Unexpected transition recovery backup: ${state.backupPath}`, {
        code: "MUTATION_RECOVERY_FAILED",
        details: [`Recovery journal retained at ${session.path}.`],
      });
    }
    await removeRecoveryFile(
      state.temporaryPath,
      temporary,
      "Change transition recovery temporary file",
      workspaceRoot,
    );
    const completed = tasksArePublished;
    await finishRecoveredTransaction(
      session,
      completed ? "complete" : "rolled-back",
      afterTransitionTransactionPhase,
      afterTransitionReceiptCleanup,
    );
    return { recovered: true, completed, state };
  } catch (error) {
    await closeTransitionTransactionJournal(session).catch(() => {});
    throw error;
  }
}

export async function recoverPendingChangeTransitions(
  workspaceRoot,
  options = {},
) {
  const changeIds = await listTransitionTransactionIds(workspaceRoot);
  const recovered = [];
  for (const changeId of changeIds) {
    const result = await recoverPendingChangeTransition(workspaceRoot, changeId, options);
    if (result) recovered.push(result);
  }
  return recovered;
}

function assertTransition(from, to) {
  if (!CHANGE_STATUSES.includes(from) || !CHANGE_STATUSES.includes(to)) {
    throw new SddError("Change transition requires valid --from and --to statuses.", {
      code: "INVALID_CHANGE_TRANSITION",
      details: [`Expected one of: ${CHANGE_STATUSES.join(", ")}`],
    });
  }
  if (!canTransitionChangeStatus(from, to)) {
    throw new SddError(`Change status cannot transition from ${from} to ${to}.`, {
      code: "INVALID_CHANGE_TRANSITION",
      details: [
        "Allowed transitions follow proposed -> planned -> in_progress -> in_review,",
        "with planning invalidation returning to proposed and review remediation returning to in_progress.",
      ],
    });
  }
}

export async function transitionChange(
  startPath,
  spaceId,
  changeId,
  {
    from,
    to,
    dryRun = false,
    beforeCommit = null,
    afterTemporaryWrite = null,
    afterBackup = null,
    beforeCleanup = null,
    afterTransitionTransactionPhase = null,
    beforeTransitionTransactionPublish = null,
    afterTransitionReceiptStageCleanup = null,
    afterTransitionReceiptCleanup = null,
    workspaceRoot: requestedWorkspaceRoot = null,
    lockToken = null,
    inspectFinalTasks = null,
  } = {},
) {
  assertValidChangeId(changeId);
  assertTransition(from, to);
  const operation = await resolveOperationConfiguration(
    startPath,
    requestedWorkspaceRoot ? { workspaceRoot: requestedWorkspaceRoot } : {},
  );
  const { workspaceRoot, config } = operation;
  if (!dryRun && lockToken === null) {
    return withWorkspaceMutationLock(workspaceRoot, (mutationLock) =>
      transitionChange(startPath, spaceId, changeId, {
        from,
        to,
        dryRun,
        beforeCommit,
        afterTemporaryWrite,
        afterBackup,
        beforeCleanup,
        afterTransitionTransactionPhase,
        beforeTransitionTransactionPublish,
        afterTransitionReceiptStageCleanup,
        afterTransitionReceiptCleanup,
        inspectFinalTasks,
        workspaceRoot,
        lockToken: mutationLock,
      }));
  }
  assertValidConfig(config, "transition a Change");
  const space = config.ideas[spaceId];
  if (!space) {
    throw new SddError(`Unknown Space ID: ${spaceId}`, {
      code: "SPACE_NOT_FOUND",
      details: Object.keys(config.ideas).sort().map((id) => `Available Space ID: ${id}`),
    });
  }
  if (resolveWorkspaceStatus(space.status) !== "active") {
    throw new SddError(`Space ${spaceId} is not active. Update its .sdd status before transitioning work.`, {
      code: "SPACE_NOT_ACTIVE",
    });
  }

  const changePath = getActiveChangePath(changeId, workspaceRoot);
  const closedPath = getClosedChangePath(changeId, workspaceRoot);
  await assertChangeStoreConfinement(changePath, workspaceRoot);
  await assertChangeStoreConfinement(closedPath, workspaceRoot);
  const recoveredTransition = !dryRun
    ? await recoverPendingChangeTransition(workspaceRoot, changeId, {
        afterTransitionTransactionPhase,
        afterTransitionReceiptStageCleanup,
        afterTransitionReceiptCleanup,
      })
    : null;
  const displayPath = relativeChangeStorePath(changePath, workspaceRoot);
  if (await pathExists(closedPath)) {
    throw new SddError(`Change ID exists in closed history: ${changeId}`, {
      code: await isDirectory(changePath) ? "CHANGE_LOCATION_COLLISION" : "CHANGE_ALREADY_CLOSED",
    });
  }
  if (!(await isDirectory(changePath))) {
    throw new SddError(`Active Change does not exist: ${displayPath}`, { code: "CHANGE_NOT_FOUND" });
  }
  const tasksAbsolutePath = join(changePath, "tasks.md");
  const tasksPath = relativeChangeStorePath(tasksAbsolutePath, workspaceRoot);
  const initialSnapshot = await readRequiredChangeFileSnapshot(
    changePath,
    "tasks.md",
    workspaceRoot,
  );
  if (initialSnapshot === null) {
    throw new SddError(`Active Change is missing tasks.md: ${displayPath}`, {
      code: "INCOMPLETE_CHANGE",
    });
  }
  const initialModeState = await lstat(tasksAbsolutePath, { bigint: true });
  if (
    !initialModeState.isFile()
    || initialModeState.isSymbolicLink()
    || !sameFileIdentity(fileIdentity(initialModeState), initialSnapshot.identity)
  ) {
    throw new SddError(`Change tasks mode changed while preparing transition: ${tasksPath}`, {
      code: "CONCURRENT_CHANGE",
    });
  }
  const originalMode = fileMode(initialModeState);
  const initialTransitionSnapshot = { ...initialSnapshot, mode: originalMode };
  const source = initialSnapshot.source;
  const metadata = parseChangeMetadata(source);
  if (metadata.error) {
    throw new SddError(`Cannot parse Change metadata in ${tasksPath}: ${metadata.error}`, {
      code: "INVALID_CHANGE_METADATA",
    });
  }
  if (metadata.space !== spaceId) {
    throw new SddError(`Change belongs to Space ${metadata.space}, not ${spaceId}.`, {
      code: "CHANGE_SPACE_MISMATCH",
    });
  }
  const selectedRepositories = await resolveRepositoriesForMetadata(
    workspaceRoot,
    config,
    space,
    metadata.repositories,
  );
  const recoveredCompletion = recoveredTransition?.completed === true
    && recoveredTransition.state.changeId === changeId
    && recoveredTransition.state.spaceId === spaceId
    && recoveredTransition.state.from === from
    && recoveredTransition.state.to === to;
  if (metadata.status !== from && !(recoveredCompletion && metadata.status === to)) {
    throw new SddError(`Change status no longer matches --from ${from}: ${tasksPath}`, {
      code: "CHANGE_STATUS_MISMATCH",
      details: [`Current status: ${metadata.status}`],
    });
  }
  if (recoveredCompletion) {
    return {
      command: "change-transition",
      workspaceRoot,
      dryRun,
      spaceId,
      changeId,
      from,
      to,
      path: displayPath,
      tasksPath,
      repositories: selectedRepositories,
    };
  }
  const updatedSource = replaceChangeStatus(source, to);
  if (updatedSource === null) {
    throw new SddError(`Change must contain exactly one status field in ${tasksPath}.`, {
      code: "INVALID_CHANGE_STATUS",
    });
  }

  if (!dryRun) {
    const nonce = `${process.pid}-${Date.now()}-${randomUUID()}`;
    const temporaryPath = join(dirname(tasksAbsolutePath), `.tasks.md.sdd-transition-${nonce}`);
    const backupPath = join(dirname(tasksAbsolutePath), `.tasks.md.sdd-backup-${nonce}`);
    let temporaryHandle = null;
    let temporarySnapshot = null;
    let backupSnapshot = null;
    let committed = false;
    let restoredOriginal = false;
    let primaryError = null;
    let transactionSession = null;
    let preserveTransactionJournal = false;
    const persistTransactionPhase = async (phase, updates = {}) => {
      await appendTransitionTransactionState(
        transactionSession,
        nextTransitionTransactionState(transactionSession, { ...updates, phase }),
      );
      if (afterTransitionTransactionPhase) {
        await afterTransitionTransactionPhase({
          phase,
          recovery: false,
          state: transactionSession.state,
        });
      }
    };
    try {
      await assertChangeStoreConfinement(temporaryPath, workspaceRoot);
      temporaryHandle = await open(temporaryPath, "wx", 0o600);
      const temporaryState = await temporaryHandle.stat({ bigint: true });
      temporarySnapshot = {
        identity: fileIdentity(temporaryState),
        mode: undefined,
        source: undefined,
      };
      await temporaryHandle.writeFile(updatedSource, "utf8");
      await temporaryHandle.sync();
      await temporaryHandle.chmod(originalMode);
      await temporaryHandle.sync();
      await temporaryHandle.close();
      temporaryHandle = null;
      if (afterTemporaryWrite) {
        await afterTemporaryWrite({ tasksPath: tasksAbsolutePath, temporaryPath, backupPath });
      }
      const writtenTemporarySnapshot = await inspectTransitionFile(temporaryPath);
      if (!matchesTransitionFile(writtenTemporarySnapshot, temporarySnapshot)
        || writtenTemporarySnapshot.source !== updatedSource
        || writtenTemporarySnapshot.mode !== originalMode) {
        throw new SddError(`Transition staging changed after creation: ${temporaryPath}`, {
          code: "CONCURRENT_CHANGE",
          details: [`Concurrent content retained at ${temporaryPath}.`],
        });
      }
      temporarySnapshot = writtenTemporarySnapshot;
      transactionSession = await createTransitionTransactionJournal(
        workspaceRoot,
        changeId,
        lockToken,
        {
          phase: "prepared",
          changeId,
          spaceId,
          from,
          to,
          changePath,
          closedPath,
          tasksPath: tasksAbsolutePath,
          temporaryPath,
          backupPath,
          originalSnapshot: serializeTransitionSnapshot(initialTransitionSnapshot),
          temporarySnapshot: serializeTransitionSnapshot(temporarySnapshot),
          backupSnapshot: null,
        },
        { beforePublish: beforeTransitionTransactionPublish },
      );
      if (afterTransitionTransactionPhase) {
        await afterTransitionTransactionPhase({
          phase: "prepared",
          recovery: false,
          state: transactionSession.state,
        });
      }
      if (beforeCommit) await beforeCommit({ tasksPath: tasksAbsolutePath, temporaryPath, backupPath });
      await assertOperationConfigurationCurrent(operation);
      await assertSelectedRepositorySnapshotsCurrent(
        workspaceRoot,
        config,
        space,
        selectedRepositories,
      );
      await assertChangeStoreConfinement(tasksAbsolutePath, workspaceRoot);
      if (await pathExists(closedPath)) {
        await persistTransactionPhase("closed-collision");
        preserveTransactionJournal = true;
        throw new SddError(`Change moved to closed history during transition: ${changeId}`, {
          code: "CONCURRENT_CHANGE",
          details: [
            `Closed winner preserved at ${closedPath}.`,
            `Recovery journal retained at ${transactionSession.path}.`,
          ],
        });
      }
      await assertRequiredChangeFileSnapshotCurrent(
        changePath,
        "tasks.md",
        workspaceRoot,
        initialSnapshot,
      );
      try {
        await link(tasksAbsolutePath, backupPath);
      } catch (error) {
        if (NO_REPLACE_COLLISION_CODES.has(error?.code)) {
          throw new SddError(`Transition backup destination appeared: ${backupPath}`, {
            code: "CONCURRENT_CHANGE",
            details: [`Concurrent content retained at ${backupPath}.`],
          });
        }
        if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
          throw new SddError(`Change disappeared during transition: ${tasksPath}`, {
            code: "CONCURRENT_CHANGE",
          });
        }
        throw error;
      }
      backupSnapshot = await inspectTransitionFile(backupPath);
      if (!matchesTransitionFile(backupSnapshot, initialTransitionSnapshot)) {
        throw new SddError(`Change changed during transition: ${tasksPath}`, {
          code: "CONCURRENT_CHANGE",
          details: [`Recoverable backup retained at ${backupPath}.`],
        });
      }
      await persistTransactionPhase("backed-up", {
        backupSnapshot: serializeTransitionSnapshot(backupSnapshot),
      });
      try {
        await removeOwnedTransitionFile(
          tasksAbsolutePath,
          initialTransitionSnapshot,
          "Change transition source",
          workspaceRoot,
        );
      } catch (error) {
        if (error?.code === "MUTATION_RECOVERY_FAILED") {
          throw new SddError(`Change changed during transition: ${tasksPath}`, {
            code: "CONCURRENT_CHANGE",
            details: error.details,
          });
        }
        throw error;
      }
      await persistTransactionPhase("source-retired");
      if (afterBackup) await afterBackup({ tasksPath: tasksAbsolutePath, temporaryPath, backupPath });
      await assertOperationConfigurationCurrent(operation);
      await assertSelectedRepositorySnapshotsCurrent(
        workspaceRoot,
        config,
        space,
        selectedRepositories,
      );
      await assertChangeStoreConfinement(closedPath, workspaceRoot);
      if (await pathExists(closedPath)) {
        await persistTransactionPhase("closed-collision");
        preserveTransactionJournal = true;
        throw new SddError(`Change moved to closed history during transition: ${changeId}`, {
          code: "CONCURRENT_CHANGE",
          details: [
            `Closed winner preserved at ${closedPath}.`,
            `Original backup retained at ${backupPath}.`,
            `Recovery journal retained at ${transactionSession.path}.`,
          ],
        });
      }
      if (!matchesTransitionFile(
        await inspectTransitionFile(temporaryPath),
        temporarySnapshot,
      )) {
        throw new SddError(`Transition staging changed before publication: ${temporaryPath}`, {
          code: "CONCURRENT_CHANGE",
        });
      }
      try {
        await link(temporaryPath, tasksAbsolutePath);
        const publishedSnapshot = await inspectTransitionFile(tasksAbsolutePath);
        if (!matchesTransitionFile(publishedSnapshot, temporarySnapshot)
          || publishedSnapshot.mode !== originalMode) {
          throw new SddError(`Published Change mode or identity changed: ${tasksPath}`, {
            code: "CONCURRENT_CHANGE",
          });
        }
        await persistTransactionPhase("published");
        await assertChangeStoreConfinement(closedPath, workspaceRoot);
        if (await pathExists(closedPath)) {
          await removeOwnedTransitionFile(
            tasksAbsolutePath,
            temporarySnapshot,
            "Published active Change after closed-location collision",
            workspaceRoot,
          );
          await persistTransactionPhase("closed-collision");
          preserveTransactionJournal = true;
          throw new SddError(`Closed Change appeared during transition publication: ${changeId}`, {
            code: "CONCURRENT_CHANGE",
            details: [
              `Closed winner preserved at ${closedPath}.`,
              `Recovery journal retained at ${transactionSession.path}.`,
              `Original backup retained at ${backupPath}.`,
            ],
          });
        }
        committed = true;
      } catch (error) {
        if (NO_REPLACE_COLLISION_CODES.has(error?.code)) {
          throw new SddError(`Change changed during transition: ${tasksPath}`, {
            code: "CONCURRENT_CHANGE",
          });
        }
        throw error;
      }
    } catch (error) {
      const recoveryFailures = [];
      if (!preserveTransactionJournal && !committed && backupSnapshot && !(await pathExists(tasksAbsolutePath))) {
        let recoverySnapshot;
        try {
          recoverySnapshot = await inspectTransitionFile(backupPath);
        } catch (recoveryError) {
          recoveryFailures.push(`Inspect recovery backup ${backupPath}: ${recoveryError.message}`);
        }
        if (matchesTransitionFile(recoverySnapshot, backupSnapshot)) {
          try {
            await link(backupPath, tasksAbsolutePath);
            restoredOriginal = true;
          } catch (recoveryError) {
            if (!NO_REPLACE_COLLISION_CODES.has(recoveryError?.code)) {
              recoveryFailures.push(`Restore ${tasksPath}: ${recoveryError.message}`);
            }
          }
        } else if (recoveryFailures.length === 0) {
          recoveryFailures.push(
            `${tasksPath}: original is absent and recovery backup changed or disappeared at ${backupPath}.`,
          );
        }
      }
      if (recoveryFailures.length > 0) {
        preserveTransactionJournal = transactionSession !== null;
        primaryError = new SddError("Change transition failed and recovery was incomplete.", {
          code: "MUTATION_RECOVERY_FAILED",
          details: [`Original error: ${error.message}`, ...recoveryFailures],
        });
        throw primaryError;
      }
      primaryError = error;
      throw error;
    } finally {
      const cleanupFailures = [];
      if (temporaryHandle) {
        try {
          await temporaryHandle.close();
        } catch (error) {
          cleanupFailures.push(`Close transition staging handle ${temporaryPath}: ${error.message}`);
        }
        temporaryHandle = null;
      }
      let tasksSnapshot = null;
      let tasksInspectionFailed = false;
      try {
        tasksSnapshot = await (inspectFinalTasks ?? inspectTransitionFile)(tasksAbsolutePath);
      } catch (error) {
        if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") {
          tasksInspectionFailed = true;
          cleanupFailures.push(`Inspect published Change ${tasksAbsolutePath}: ${error.message}`);
        }
      }
      if (!tasksInspectionFailed
        && (committed && !matchesTransitionFile(tasksSnapshot, temporarySnapshot)
          || restoredOriginal && !matchesTransitionFile(tasksSnapshot, backupSnapshot))) {
        cleanupFailures.push(`Published Change changed before cleanup: ${tasksAbsolutePath}`);
      }
      const mayRemoveBackup = backupSnapshot && (
        committed && matchesTransitionFile(tasksSnapshot, temporarySnapshot)
        || restoredOriginal && matchesTransitionFile(tasksSnapshot, backupSnapshot)
      );
      if (mayRemoveBackup) {
        try {
          await removeOwnedTransitionFile(
            backupPath,
            backupSnapshot,
            "Change transition backup",
            workspaceRoot,
            beforeCleanup
              ? (event) => beforeCleanup({ kind: "backup", ...event })
              : null,
          );
        } catch (error) {
          cleanupFailures.push(
            ...(error.details?.length ? error.details : [`${error.message}: ${backupPath}`]),
          );
        }
      }
      try {
        await removeOwnedTransitionFile(
          temporaryPath,
          temporarySnapshot,
          "Change transition temporary file",
          workspaceRoot,
          beforeCleanup
            ? (event) => beforeCleanup({ kind: "temporary", ...event })
            : null,
        );
      } catch (error) {
        cleanupFailures.push(
          ...(error.details?.length ? error.details : [`${error.message}: ${temporaryPath}`]),
        );
      }
      if (cleanupFailures.length > 0) preserveTransactionJournal = true;
      if (transactionSession) {
        if (preserveTransactionJournal) {
          try {
            await closeTransitionTransactionJournal(transactionSession);
          } catch (error) {
            cleanupFailures.push(`Close transition journal: ${error.message}`);
          }
        } else {
          try {
            await persistTransactionPhase(committed ? "complete" : "rolled-back");
            const receiptFailures = await cleanupTransitionTransactionJournal(
              transactionSession,
              { afterReceiptCleanup: afterTransitionReceiptCleanup },
            );
            cleanupFailures.push(...receiptFailures);
          } catch (error) {
            cleanupFailures.push(
              ...(error.details?.length
                ? error.details
                : [`Transition receipt cleanup: ${error.message}`]),
            );
          }
        }
      }
      if (cleanupFailures.length > 0) {
        if (primaryError) {
          primaryError.details = [
            ...(Array.isArray(primaryError.details) ? primaryError.details : []),
            ...cleanupFailures.map((failure) => `Cleanup recovery: ${failure}`),
          ];
        } else {
          throw new SddError("Change transition cleanup preserved concurrent content.", {
            code: "MUTATION_RECOVERY_FAILED",
            details: cleanupFailures,
          });
        }
      }
    }
  }

  return {
    command: "change-transition",
    workspaceRoot,
    dryRun,
    spaceId,
    changeId,
    from,
    to,
    path: displayPath,
    tasksPath,
    repositories: selectedRepositories,
  };
}
