import { createHash, randomUUID } from "node:crypto";
import { link, lstat, open, readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";

import { assertValidChangeId } from "./change-id.js";
import { assertChangeStoreConfinement, getChangesRoot } from "./change-store.js";
import { getWorkspaceConfigDirectory } from "./config.js";
import { SddError } from "./errors.js";
import {
  readBoundRegularFile as readBoundFileSnapshot,
  removeBoundRegularFile,
} from "./fs.js";

const JOURNAL_VERSION = 1;
const JOURNAL_SUFFIX = ".sdd-transition-journal.jsonl";
const JOURNAL_STAGE_MARKER = ".sdd-transition-journal-stage-";
const PROOF_MARKER = ".sdd-transition-proof-";
const BACKUP_MARKER = ".sdd-transition-";
const TRANSITION_PHASES = new Set([
  "prepared",
  "backed-up",
  "source-retired",
  "published",
  "rolled-back",
  "complete",
  "closed-collision",
]);
const TRANSITION_PHASE_EDGES = new Map([
  ["prepared", new Set(["backed-up", "rolled-back", "closed-collision"])],
  ["backed-up", new Set(["source-retired", "rolled-back"])],
  ["source-retired", new Set(["published", "rolled-back", "closed-collision"])],
  ["published", new Set(["complete", "rolled-back", "closed-collision"])],
  ["rolled-back", new Set()],
  ["complete", new Set()],
  ["closed-collision", new Set()],
]);
const TRANSITION_STATE_KEYS = [
  "backupPath",
  "backupSnapshot",
  "changeId",
  "changePath",
  "closedPath",
  "from",
  "originalSnapshot",
  "phase",
  "spaceId",
  "tasksPath",
  "temporaryPath",
  "temporarySnapshot",
  "to",
];
const TRANSITION_SNAPSHOT_KEYS = ["bytes", "identity", "mode"];
const TRANSITION_IDENTITY_KEYS = ["dev", "ino"];

function exactKeys(value, expected) {
  return value
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected);
}

function validBase64(value) {
  return typeof value === "string"
    && Buffer.from(value, "base64").toString("base64") === value;
}

function requireSnapshot(snapshot, label) {
  if (!exactKeys(snapshot, TRANSITION_SNAPSHOT_KEYS)
    || !exactKeys(snapshot.identity, TRANSITION_IDENTITY_KEYS)
    || typeof snapshot.identity.dev !== "string"
    || snapshot.identity.dev.length < 1
    || typeof snapshot.identity.ino !== "string"
    || snapshot.identity.ino.length < 1
    || !Number.isInteger(snapshot.mode)
    || snapshot.mode < 0
    || snapshot.mode > 0o777
    || !validBase64(snapshot.bytes)) {
    throw changed(`Change-transition recovery journal has an invalid ${label}.`);
  }
}

function stateWithoutReceipt(state) {
  const { receipt: _receipt, ...externalState } = state;
  return externalState;
}

function requireTransitionState(state, expectedChangeId, previousState = null, withReceipt = false) {
  const expectedKeys = withReceipt
    ? [...TRANSITION_STATE_KEYS, "receipt"].sort()
    : TRANSITION_STATE_KEYS;
  if (!exactKeys(state, expectedKeys)
    || !TRANSITION_PHASES.has(state.phase)
    || state.changeId !== expectedChangeId
    || typeof state.spaceId !== "string"
    || state.spaceId.length < 1
    || typeof state.from !== "string"
    || state.from.length < 1
    || typeof state.to !== "string"
    || state.to.length < 1
    || typeof state.changePath !== "string"
    || state.changePath.length < 1
    || typeof state.closedPath !== "string"
    || state.closedPath.length < 1
    || typeof state.tasksPath !== "string"
    || state.tasksPath.length < 1
    || typeof state.temporaryPath !== "string"
    || state.temporaryPath.length < 1
    || typeof state.backupPath !== "string"
    || state.backupPath.length < 1) {
    throw changed("Change-transition recovery journal has an invalid state shape.");
  }
  requireSnapshot(state.originalSnapshot, "original snapshot");
  requireSnapshot(state.temporarySnapshot, "temporary snapshot");
  if (state.backupSnapshot !== null) {
    requireSnapshot(state.backupSnapshot, "backup snapshot");
  }
  if (previousState !== null) {
    if (!TRANSITION_PHASE_EDGES.get(previousState.phase)?.has(state.phase)) {
      throw changed(
        `Change-transition recovery journal phase regressed from ${previousState.phase} to ${state.phase}.`,
      );
    }
    const previous = stateWithoutReceipt(previousState);
    const current = stateWithoutReceipt(state);
    for (const key of TRANSITION_STATE_KEYS) {
      if (key === "phase" || key === "backupSnapshot") continue;
      if (oneLineJson(current[key]) !== oneLineJson(previous[key])) {
        throw changed(`Change-transition recovery journal immutable field changed: ${key}.`);
      }
    }
    if (previous.backupSnapshot !== null
      && oneLineJson(current.backupSnapshot) !== oneLineJson(previous.backupSnapshot)) {
      throw changed("Change-transition recovery journal backup snapshot changed after binding.");
    }
    if (withReceipt
      && oneLineJson(state.receipt) !== oneLineJson(previousState.receipt)) {
      throw changed("Change-transition recovery journal receipt ownership changed.");
    }
  }
  return state;
}

function identity(state) {
  return { dev: String(state.dev), ino: String(state.ino) };
}

function sameIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino;
}

function changed(message, details = []) {
  return new SddError(message, { code: "CONCURRENT_CHANGE", details });
}

async function inspect(path) {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function oneLineJson(value) {
  return JSON.stringify(value);
}

function recordHash(record) {
  return createHash("sha256").update(oneLineJson(record)).digest("hex");
}

async function writeFully(handle, source, position) {
  const bytes = Buffer.from(source);
  let written = 0;
  while (written < bytes.length) {
    const result = await handle.write(bytes, written, bytes.length - written, position + written);
    if (result.bytesWritten < 1) throw new Error("Durable Change-transition journal write made no progress.");
    written += result.bytesWritten;
  }
}

async function syncDirectory(path) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function syncTransitionTransactionDirectory(path) {
  await syncDirectory(path);
}

async function assertReceiptConfinement(workspaceRoot, paths) {
  for (const path of paths) {
    await assertChangeStoreConfinement(path, workspaceRoot);
  }
}

function receiptBoundary(session) {
  return () => assertReceiptConfinement(session.workspaceRoot, [
    session.path,
    session.stagingPath,
    session.proofPath,
  ]);
}

function journalName(changeId) {
  return `.${changeId}${JOURNAL_SUFFIX}`;
}

export function getTransitionTransactionJournalPath(workspaceRoot, changeId) {
  assertValidChangeId(changeId);
  return join(getChangesRoot(workspaceRoot), journalName(changeId));
}

function requireOwnedReceiptName(name, expectedPrefix, label) {
  if (typeof name !== "string"
    || basename(name) !== name
    || !name.startsWith(expectedPrefix)
    || name.includes("/")
    || name.includes("\\")
    || name.includes("\0")) {
    throw changed(`Change-transition ${label} name is invalid.`, [`Name: ${String(name)}`]);
  }
  return name;
}

async function readBoundRegularFile(path, expectedIdentity, label) {
  const before = await inspect(path);
  if (!before?.isFile() || before.isSymbolicLink() || !sameIdentity(identity(before), expectedIdentity)) {
    throw changed(`${label} changed physical identity: ${path}`);
  }
  const source = await readFile(path, "utf8");
  const after = await inspect(path);
  if (!after?.isFile() || after.isSymbolicLink() || !sameIdentity(identity(after), expectedIdentity)) {
    throw changed(`${label} changed while it was read: ${path}`);
  }
  return source;
}

function requireRecord(record, expectedSequence, expectedTransactionId, previousHash) {
  if (!record || typeof record !== "object" || Array.isArray(record)
    || record.version !== JOURNAL_VERSION
    || record.sequence !== expectedSequence
    || typeof record.transactionId !== "string"
    || record.transactionId.length < 1
    || (expectedTransactionId !== null && record.transactionId !== expectedTransactionId)
    || record.previousHash !== previousHash
    || !record.state || typeof record.state !== "object" || Array.isArray(record.state)
    || typeof record.hash !== "string") {
    throw changed("Change-transition recovery journal has an invalid record sequence or shape.");
  }
  const unhashed = { ...record };
  delete unhashed.hash;
  if (recordHash(unhashed) !== record.hash) {
    throw changed("Change-transition recovery journal record integrity check failed.");
  }
  return record;
}

function parseJournal(source, changeId) {
  const completeEnd = source.lastIndexOf("\n") + 1;
  if (completeEnd === 0) {
    throw changed("Change-transition recovery journal has no complete durable record.");
  }
  const lines = source.slice(0, completeEnd).split("\n").filter((line) => line.length > 0);
  let transactionId = null;
  let previousHash = null;
  let previousState = null;
  let record = null;
  for (const [index, line] of lines.entries()) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw changed("Change-transition recovery journal contains invalid JSON.", [error.message]);
    }
    record = requireRecord(parsed, index, transactionId, previousHash);
    requireTransitionState(record.state, changeId, previousState, true);
    transactionId = record.transactionId;
    previousHash = record.hash;
    previousState = record.state;
  }
  return {
    completeEnd: Buffer.byteLength(source.slice(0, completeEnd)),
    record,
    sequence: lines.length - 1,
  };
}

async function assertProofAuthority(workspaceRoot, proofPath, proof, { allowMissing = false } = {}) {
  const state = await inspect(proofPath);
  if (!state) {
    if (allowMissing) return null;
    throw changed(`Change-transition mutation-lock proof is missing: ${proofPath}`);
  }
  if (!state.isFile()
    || state.isSymbolicLink()
    || !sameIdentity(identity(state), proof.proofIdentity)) {
    throw changed(`Change-transition mutation-lock proof changed physical identity: ${proofPath}`);
  }
  const source = await readBoundRegularFile(
    proofPath,
    proof.proofIdentity,
    "Change-transition mutation-lock proof",
  );
  if (source !== proof.proofSource) {
    throw changed(`Change-transition mutation-lock proof changed content: ${proofPath}`);
  }
  let owner;
  try {
    owner = JSON.parse(source);
  } catch (error) {
    throw changed(`Change-transition mutation-lock proof is invalid: ${proofPath}`, [error.message]);
  }
  const [workspaceState, configState] = await Promise.all([
    inspect(workspaceRoot),
    inspect(getWorkspaceConfigDirectory(workspaceRoot)),
  ]);
  if (!workspaceState?.isDirectory() || workspaceState.isSymbolicLink()
    || !sameIdentity(identity(workspaceState), owner?.workspaceIdentity)
    || !configState?.isDirectory() || configState.isSymbolicLink()
    || !sameIdentity(identity(configState), owner?.configIdentity)) {
    throw changed("Change-transition mutation-lock proof no longer names the current workspace authority.");
  }
  return state;
}

async function removeBoundFile(
  path,
  expectedIdentity,
  label,
  {
    allowMissing = true,
    ownerRoot,
    assertBoundary = null,
    beforeCleanup = null,
    beforeQuarantine = null,
    beforeRemovalMutation = null,
    afterQuarantine = null,
  } = {},
) {
  if (assertBoundary) await assertBoundary();
  const snapshot = await readBoundFileSnapshot(path, {
    ownerRoot,
    allowMissing,
    label,
    unsafeCode: "CONCURRENT_CHANGE",
  });
  if (snapshot === null) {
    if (allowMissing) return false;
    throw changed(`${label} is missing: ${path}`);
  }
  if (!sameIdentity(snapshot.identity, expectedIdentity)) {
    throw changed(`${label} changed physical identity: ${path}`);
  }
  await removeBoundRegularFile(path, snapshot, {
    ownerRoot,
    beforeQuarantine: beforeQuarantine
      ? async (context) => {
          if (assertBoundary) await assertBoundary();
          await beforeQuarantine(context);
          if (assertBoundary) await assertBoundary();
        }
      : null,
    label,
    beforeCleanup: async (context) => {
      if (assertBoundary) await assertBoundary();
      if (beforeCleanup) await beforeCleanup(context);
      if (assertBoundary) await assertBoundary();
    },
    beforeRemovalMutation: beforeRemovalMutation
      ? async (context) => {
          if (assertBoundary) await assertBoundary();
          await beforeRemovalMutation(context);
          if (assertBoundary) await assertBoundary();
        }
      : null,
    afterQuarantine: async (context) => {
      if (assertBoundary) await assertBoundary();
      if (afterQuarantine) await afterQuarantine(context);
      if (assertBoundary) await assertBoundary();
    },
  });
  if (assertBoundary) await assertBoundary();
  return true;
}

export async function reconcileTransitionTransactionReceipts(
  workspaceRoot,
  changeId,
  { afterStagedCleanup = null } = {},
) {
  assertValidChangeId(changeId);
  const root = getChangesRoot(workspaceRoot);
  const visiblePath = getTransitionTransactionJournalPath(workspaceRoot, changeId);
  await assertReceiptConfinement(workspaceRoot, [visiblePath]);
  if (await inspect(visiblePath)) return false;
  let names;
  try {
    names = await readdir(root);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  const stagePrefix = `.${changeId}${JOURNAL_STAGE_MARKER}`;
  const proofPrefix = `.${changeId}${PROOF_MARKER}`;
  const stageNames = names.filter((name) => name.startsWith(stagePrefix));
  const proofNames = names.filter((name) => name.startsWith(proofPrefix));
  if (stageNames.length > 1 || proofNames.length > 1) {
    throw changed(`Change-transition has ambiguous pre-publication receipts: ${changeId}`);
  }
  if (stageNames.length === 0 && proofNames.length === 0) return false;
  if (stageNames.length === 0) {
    const proofPath = join(root, proofNames[0]);
    await assertReceiptConfinement(workspaceRoot, [proofPath]);
    const proofState = await inspect(proofPath);
    if (!proofState?.isFile() || proofState.isSymbolicLink()) {
      throw changed(`Change-transition pre-publication proof is unsafe: ${proofPath}`);
    }
    const proofIdentity = identity(proofState);
    const proofSource = await readBoundRegularFile(
      proofPath,
      proofIdentity,
      "Change-transition pre-publication mutation-lock proof",
    );
    await assertProofAuthority(workspaceRoot, proofPath, {
      proofIdentity,
      proofSource,
    });
    await removeBoundFile(
      proofPath,
      proofIdentity,
      "Change-transition pre-publication mutation-lock proof",
      { ownerRoot: workspaceRoot, allowMissing: false },
    );
    await syncDirectory(root);
    return true;
  }
  const stagingPath = join(root, stageNames[0]);
  await assertReceiptConfinement(workspaceRoot, [stagingPath]);
  const stagingState = await inspect(stagingPath);
  if (!stagingState?.isFile() || stagingState.isSymbolicLink()) {
    throw changed(`Change-transition pre-publication journal is unsafe: ${stagingPath}`);
  }
  const journalIdentity = identity(stagingState);
  const source = await readBoundRegularFile(
    stagingPath,
    journalIdentity,
    "Change-transition pre-publication journal",
  );
  const parsed = parseJournal(source, changeId);
  const receipt = parsed.record.state.receipt;
  if (!sameIdentity(receipt?.journalIdentity, journalIdentity)
    || receipt?.stagingName !== stageNames[0]
    || receipt?.proofName !== proofNames[0]
    || typeof receipt?.proofSource !== "string") {
    throw changed(`Change-transition pre-publication receipt is unauthenticated: ${stagingPath}`);
  }
  const proofPath = join(root, receipt.proofName);
  await assertReceiptConfinement(workspaceRoot, [proofPath]);
  await assertProofAuthority(workspaceRoot, proofPath, receipt);
  await removeBoundFile(
    stagingPath,
    journalIdentity,
    "Change-transition pre-publication staged journal",
    { ownerRoot: workspaceRoot, allowMissing: false },
  );
  await syncDirectory(root);
  if (afterStagedCleanup) {
    await afterStagedCleanup({ stagingPath, proofPath });
  }
  await removeBoundFile(
    proofPath,
    receipt.proofIdentity,
    "Change-transition pre-publication mutation-lock proof",
    { ownerRoot: workspaceRoot, allowMissing: false },
  );
  await syncDirectory(root);
  return true;
}

export async function createTransitionTransactionJournal(
  workspaceRoot,
  changeId,
  mutationLock,
  initialState,
  { beforePublish = null } = {},
) {
  if (!mutationLock?.path || !mutationLock?.source || !mutationLock?.identity) {
    throw new SddError("Change-transition recovery requires a bound workspace mutation lock.", {
      code: "MUTATION_RECOVERY_FAILED",
    });
  }
  requireTransitionState(initialState, changeId);
  const root = getChangesRoot(workspaceRoot);
  await reconcileTransitionTransactionReceipts(workspaceRoot, changeId);
  const path = getTransitionTransactionJournalPath(workspaceRoot, changeId);
  const transactionId = randomUUID();
  const proofName = `.${changeId}${PROOF_MARKER}${transactionId}`;
  const proofPath = join(root, proofName);
  const stagingName = `.${changeId}${JOURNAL_STAGE_MARKER}${transactionId}`;
  const stagingPath = join(root, stagingName);
  const assertBoundary = () => assertReceiptConfinement(workspaceRoot, [
    path,
    stagingPath,
    proofPath,
  ]);
  await assertBoundary();
  let proofState = null;
  let journalState = null;
  let published = false;
  let handle = null;
  try {
    await assertBoundary();
    await link(mutationLock.path, proofPath);
    proofState = await inspect(proofPath);
    if (!proofState?.isFile() || proofState.isSymbolicLink()
      || !sameIdentity(identity(proofState), mutationLock.identity)) {
      throw changed(`Change-transition could not bind its mutation-lock proof: ${proofPath}`);
    }
    const proofSource = await readBoundRegularFile(
      proofPath,
      identity(proofState),
      "Change-transition mutation-lock proof",
    );
    if (proofSource !== mutationLock.source) {
      throw changed(`Change-transition mutation-lock proof changed content: ${proofPath}`);
    }
    await syncDirectory(root);

    await assertBoundary();
    handle = await open(stagingPath, "wx+", 0o600);
    journalState = await handle.stat({ bigint: true });
    const state = {
      ...initialState,
      receipt: {
        journalIdentity: identity(journalState),
        stagingName,
        proofName,
        proofIdentity: identity(proofState),
        proofSource,
      },
    };
    const unhashed = {
      version: JOURNAL_VERSION,
      sequence: 0,
      transactionId,
      previousHash: null,
      state,
    };
    const record = { ...unhashed, hash: recordHash(unhashed) };
    const source = `${oneLineJson(record)}\n`;
    await writeFully(handle, source, 0);
    await handle.sync();
    await syncDirectory(root);
    await assertBoundary();
    if (beforePublish) {
      await beforePublish({ stagingPath, proofPath, journalPath: path });
    }
    try {
      await link(stagingPath, path);
    } catch (error) {
      throw changed(`Change-transition recovery journal already exists: ${path}`, [error.message]);
    }
    published = true;
    await assertBoundary();
    await syncDirectory(root);
    const [visibleJournal, visibleStaging] = await Promise.all([
      inspect(path),
      inspect(stagingPath),
    ]);
    if (!visibleJournal?.isFile() || visibleJournal.isSymbolicLink()
      || !visibleStaging?.isFile() || visibleStaging.isSymbolicLink()
      || !sameIdentity(identity(visibleJournal), identity(journalState))
      || !sameIdentity(identity(visibleStaging), identity(journalState))) {
      throw changed(`Change-transition recovery journal changed during publication: ${path}`);
    }
    return {
      root,
      workspaceRoot,
      path,
      stagingPath,
      proofPath,
      handle,
      identity: identity(journalState),
      transactionId,
      sequence: 0,
      lastHash: record.hash,
      offset: Buffer.byteLength(source),
      state,
    };
  } catch (error) {
    const cleanupFailures = [];
    await handle?.close().catch((closeError) =>
      cleanupFailures.push(`Journal handle: ${closeError.message}`));
    if (journalState && published) {
      await removeBoundFile(
        path,
        identity(journalState),
        "Change-transition recovery journal",
        { assertBoundary, ownerRoot: workspaceRoot },
      ).catch((cleanupError) => cleanupFailures.push(`Journal: ${cleanupError.message}`));
    }
    if (journalState) {
      await removeBoundFile(
        stagingPath,
        identity(journalState),
        "Change-transition staged recovery journal",
        { assertBoundary, ownerRoot: workspaceRoot },
      ).catch((cleanupError) => cleanupFailures.push(`Staged journal: ${cleanupError.message}`));
    }
    if (proofState) {
      await removeBoundFile(
        proofPath,
        identity(proofState),
        "Change-transition mutation-lock proof",
        { assertBoundary, ownerRoot: workspaceRoot },
      ).catch((cleanupError) => cleanupFailures.push(`Mutation-lock proof: ${cleanupError.message}`));
    }
    await syncDirectory(root).catch((cleanupError) =>
      cleanupFailures.push(`Receipt directory: ${cleanupError.message}`));
    if (cleanupFailures.length > 0) {
      throw new SddError("Change-transition journal initialization failed and cleanup was incomplete.", {
        code: "MUTATION_RECOVERY_FAILED",
        details: [
          `Original error: ${error.message}`,
          ...cleanupFailures,
        ],
      });
    }
    throw error;
  }
}

export async function loadTransitionTransactionJournal(workspaceRoot, changeId) {
  const root = getChangesRoot(workspaceRoot);
  const path = getTransitionTransactionJournalPath(workspaceRoot, changeId);
  await assertReceiptConfinement(workspaceRoot, [path]);
  const initialJournalState = await inspect(path);
  if (!initialJournalState) return null;
  if (!initialJournalState.isFile() || initialJournalState.isSymbolicLink()) {
    throw changed(`Change-transition recovery journal is not one regular file: ${path}`);
  }
  const journalIdentity = identity(initialJournalState);
  const source = await readBoundRegularFile(path, journalIdentity, "Change-transition recovery journal");
  const parsed = parseJournal(source, changeId);
  const receipt = parsed.record.state.receipt;
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
    || JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify([
      "journalIdentity",
      "proofIdentity",
      "proofName",
      "proofSource",
      "stagingName",
    ])
    || !sameIdentity(receipt.journalIdentity, journalIdentity)
    || typeof receipt.proofSource !== "string") {
    throw changed(`Change-transition recovery journal ownership proof is invalid: ${path}`);
  }
  const stagingName = requireOwnedReceiptName(
    receipt.stagingName,
    `.${changeId}${JOURNAL_STAGE_MARKER}`,
    "staged journal",
  );
  const stagingPath = join(root, stagingName);
  await assertReceiptConfinement(workspaceRoot, [path, stagingPath]);
  const stagingState = await inspect(stagingPath);
  if (!stagingState) {
    if (parsed.record.state.phase !== "complete") {
      throw changed(`Change-transition staged journal proof is missing: ${stagingPath}`);
    }
  } else {
    if (!stagingState.isFile() || stagingState.isSymbolicLink()
      || !sameIdentity(identity(stagingState), journalIdentity)) {
      throw changed(`Change-transition staged journal proof changed: ${stagingPath}`);
    }
    const stagedSource = await readBoundRegularFile(
      stagingPath,
      journalIdentity,
      "Change-transition staged journal proof",
    );
    if (stagedSource !== source) {
      throw changed(`Change-transition staged journal proof changed content: ${stagingPath}`);
    }
  }
  const proofName = requireOwnedReceiptName(
    receipt.proofName,
    `.${changeId}${PROOF_MARKER}`,
    "mutation-lock proof",
  );
  const proofPath = join(root, proofName);
  const assertBoundary = () => assertReceiptConfinement(workspaceRoot, [
    path,
    stagingPath,
    proofPath,
  ]);
  await assertBoundary();
  await assertProofAuthority(workspaceRoot, proofPath, receipt, {
    allowMissing: parsed.record.state.phase === "complete",
  });

  await assertBoundary();
  const handle = await open(path, "r+");
  try {
    const openedState = await handle.stat({ bigint: true });
    if (!sameIdentity(identity(openedState), journalIdentity)) {
      throw changed(`Change-transition recovery journal changed before it was opened: ${path}`);
    }
    if (parsed.completeEnd !== Buffer.byteLength(source)) {
      await handle.truncate(parsed.completeEnd);
      await handle.sync();
      await syncDirectory(root);
    }
    return {
      root,
      workspaceRoot,
      path,
      stagingPath,
      proofPath,
      handle,
      identity: journalIdentity,
      transactionId: parsed.record.transactionId,
      sequence: parsed.sequence,
      lastHash: parsed.record.hash,
      offset: parsed.completeEnd,
      state: parsed.record.state,
    };
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

export async function appendTransitionTransactionState(session, state) {
  requireTransitionState(state, session.state.changeId, session.state);
  const assertBoundary = receiptBoundary(session);
  await assertBoundary();
  const [visible, staged] = await Promise.all([
    inspect(session.path),
    inspect(session.stagingPath),
  ]);
  if (!visible?.isFile() || visible.isSymbolicLink()
    || !staged?.isFile() || staged.isSymbolicLink()
    || !sameIdentity(identity(visible), session.identity)
    || !sameIdentity(identity(staged), session.identity)) {
    throw changed(`Change-transition recovery journal changed before append: ${session.path}`);
  }
  const sequence = session.sequence + 1;
  const unhashed = {
    version: JOURNAL_VERSION,
    sequence,
    transactionId: session.transactionId,
    previousHash: session.lastHash,
    state: { ...state, receipt: session.state.receipt },
  };
  await assertBoundary();
  const record = { ...unhashed, hash: recordHash(unhashed) };
  const source = `${oneLineJson(record)}\n`;
  await writeFully(session.handle, source, session.offset);
  await assertBoundary();
  await session.handle.sync();
  await assertBoundary();
  session.sequence = sequence;
  session.lastHash = record.hash;
  session.offset += Buffer.byteLength(source);
  session.state = record.state;
  return session.state;
}

export async function cleanupTransitionTransactionJournal(
  session,
  {
    afterProofCleanup = null,
    afterReceiptCleanup = null,
    beforeReceiptCleanup = null,
    beforeReceiptQuarantine = null,
    afterReceiptQuarantine = null,
    beforeReceiptRemovalMutation = null,
  } = {},
) {
  const failures = [];
  const assertBoundary = receiptBoundary(session);
  const removalOptions = (kind, allowMissing = true) => ({
    allowMissing,
    assertBoundary,
    ownerRoot: session.workspaceRoot,
    beforeCleanup: beforeReceiptCleanup
      ? (context) => beforeReceiptCleanup({ kind, ...context })
      : null,
    beforeQuarantine: beforeReceiptQuarantine
      ? (context) => beforeReceiptQuarantine({ kind, ...context })
      : null,
    afterQuarantine: afterReceiptQuarantine
      ? (context) => afterReceiptQuarantine({ kind, ...context })
      : null,
    beforeRemovalMutation: beforeReceiptRemovalMutation
      ? (context) => beforeReceiptRemovalMutation({ kind, ...context })
      : null,
  });
  try {
    await assertBoundary();
  } catch (error) {
    failures.push(`Receipt confinement: ${error.message}`);
  }
  await session.handle.close().catch((error) =>
    failures.push(`Close journal handle: ${error.message}`));
  session.handle = null;
  if (failures.length === 0) {
    try {
      if (await removeBoundFile(
        session.path,
        session.identity,
        "Change-transition recovery journal",
        removalOptions("visible", false),
      )) {
        await syncDirectory(session.root);
        if (afterReceiptCleanup) {
          await afterReceiptCleanup({
            kind: "visible",
            journalPath: session.path,
            stagingPath: session.stagingPath,
            proofPath: session.proofPath,
          });
        }
      }
    } catch (error) {
      failures.push(`Recovery journal cleanup: ${error.message}`);
    }
  }
  if (failures.length === 0) {
    try {
      if (await removeBoundFile(
        session.stagingPath,
        session.identity,
        "Change-transition staged journal proof",
        removalOptions("staged"),
      )) {
        await syncDirectory(session.root);
        if (afterReceiptCleanup) {
          await afterReceiptCleanup({
            kind: "staged",
            journalPath: session.path,
            stagingPath: session.stagingPath,
            proofPath: session.proofPath,
          });
        }
      }
    } catch (error) {
      failures.push(`Staged journal proof cleanup: ${error.message}`);
    }
  }
  if (failures.length === 0) {
    try {
      if (await removeBoundFile(
        session.proofPath,
        session.state.receipt.proofIdentity,
        "Change-transition mutation-lock proof",
        removalOptions("proof"),
      )) {
        await syncDirectory(session.root);
        if (afterReceiptCleanup) {
          await afterReceiptCleanup({
            kind: "proof",
            journalPath: session.path,
            stagingPath: session.stagingPath,
            proofPath: session.proofPath,
          });
        }
      }
    } catch (error) {
      failures.push(`Mutation-lock proof cleanup: ${error.message}`);
    }
  }
  if (failures.length === 0 && afterProofCleanup) {
    await afterProofCleanup({
      journalPath: session.path,
      stagingPath: session.stagingPath,
      proofPath: session.proofPath,
    });
  }
  return failures;
}

export async function closeTransitionTransactionJournal(session) {
  if (!session?.handle) return;
  await session.handle.close();
  session.handle = null;
}
export async function listTransitionTransactionIds(workspaceRoot) {
  const root = getChangesRoot(workspaceRoot);
  await assertChangeStoreConfinement(root, workspaceRoot);
  let names;
  try {
    names = await readdir(root);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const changeIds = new Set();
  for (const name of names) {
    if (!name.startsWith(".")) continue;
    let changeId = null;
    if (name.endsWith(JOURNAL_SUFFIX)) {
      changeId = name.slice(1, -JOURNAL_SUFFIX.length);
    } else {
      for (const marker of [JOURNAL_STAGE_MARKER, PROOF_MARKER]) {
        const markerIndex = name.indexOf(marker);
        if (markerIndex > 1) {
          changeId = name.slice(1, markerIndex);
          break;
        }
      }
    }
    if (changeId === null) continue;
    try {
      assertValidChangeId(changeId);
      changeIds.add(changeId);
    } catch {
      // Invalid receipt names are diagnostics, never recovery targets.
    }
  }
  return [...changeIds].sort((left, right) => left.localeCompare(right));
}


export async function inspectTransitionTransactionReceipts(workspaceRoot) {
  const root = getChangesRoot(workspaceRoot);
  await assertChangeStoreConfinement(root, workspaceRoot);
  let names;
  try {
    names = await readdir(root);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return names
    .filter((name) => name.endsWith(JOURNAL_SUFFIX)
      || name.includes(PROOF_MARKER)
      || name.includes(BACKUP_MARKER))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({
      level: "error",
      code: "CHANGE_TRANSITION_RECOVERY_REQUIRED",
      message: `Interrupted Change-transition recovery receipt requires attention: ${join(root, name)}. Retry the matching \`sdd change transition\` command.`,
    }));
}
