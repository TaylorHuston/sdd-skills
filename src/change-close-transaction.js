import { createHash, randomUUID } from "node:crypto";
import { link, lstat, open, readdir } from "node:fs/promises";
import { basename, join } from "node:path";

import { assertValidChangeId } from "./change-id.js";
import { assertChangeStoreConfinement, getChangesRoot } from "./change-store.js";
import { getWorkspaceConfigDirectory } from "./config.js";
import { SddError } from "./errors.js";
import {
  readBoundRegularFile as readBoundFileSnapshot,
  removeBoundRegularFile,
} from "./fs.js";

const JOURNAL_VERSION = 2;
const JOURNAL_SUFFIX = ".sdd-close-journal.jsonl";
const JOURNAL_STAGE_MARKER = ".sdd-close-journal-stage-";
const JOURNAL_INTENT_SUFFIX = ".sdd-close-journal-intent.jsonl";
const PROOF_MARKER = ".sdd-close-proof-";
const BACKUP_MARKER = ".sdd-close-";

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

async function writeFully(handle, bytes, position) {
  let written = 0;
  while (written < bytes.length) {
    const result = await handle.write(bytes, written, bytes.length - written, position + written);
    if (result.bytesWritten < 1) throw new Error("Durable Change-close journal write made no progress.");
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

export async function syncCloseTransactionDirectory(path) {
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
    session.intentPath,
  ]);
}

function journalName(changeId) {
  return `.${changeId}${JOURNAL_SUFFIX}`;
}


function intentName(changeId) {
  return `.${changeId}${JOURNAL_INTENT_SUFFIX}`;
}
export function getCloseTransactionJournalPath(workspaceRoot, changeId) {
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
    throw changed(`Change-close ${label} name is invalid.`, [`Name: ${String(name)}`]);
  }
  return name;
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
    throw changed("Change-close recovery journal has an invalid record sequence or shape.");
  }
  const unhashed = { ...record };
  delete unhashed.hash;
  if (recordHash(unhashed) !== record.hash) {
    throw changed("Change-close recovery journal record integrity check failed.");
  }
  return record;
}

function parseJournal(bytes) {
  const completeEnd = bytes.lastIndexOf(0x0a) + 1;
  if (completeEnd === 0) {
    throw changed("Change-close recovery journal has no complete durable record.");
  }
  const completeBytes = Buffer.from(bytes.subarray(0, completeEnd));
  const lines = completeBytes.toString("utf8").split("\n").filter((line) => line.length > 0);
  let transactionId = null;
  let previousHash = null;
  let record = null;
  for (const [index, line] of lines.entries()) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw changed("Change-close recovery journal contains invalid JSON.", [error.message]);
    }
    record = requireRecord(parsed, index, transactionId, previousHash);
    transactionId = record.transactionId;
    previousHash = record.hash;
  }
  return {
    bytes: completeBytes,
    completeEnd,
    record,
    sequence: lines.length - 1,
  };
}

async function assertProofAuthority(workspaceRoot, proofPath, proof, { allowMissing = false } = {}) {
  const expectedBytes = Buffer.from(proof.proofSource, "utf8");
  const snapshot = await readBoundFileSnapshot(proofPath, {
    ownerRoot: workspaceRoot,
    allowMissing,
    label: "Change-close mutation-lock proof",
    unsafeCode: "CONCURRENT_CHANGE",
  });
  if (snapshot === null) {
    if (allowMissing) return null;
    throw changed(`Change-close mutation-lock proof is missing: ${proofPath}`);
  }
  if (!sameIdentity(snapshot.identity, proof.proofIdentity)) {
    throw changed(`Change-close mutation-lock proof changed physical identity: ${proofPath}`);
  }
  if (!snapshot.bytes.equals(expectedBytes)) {
    throw changed(`Change-close mutation-lock proof changed content: ${proofPath}`);
  }
  let owner;
  try {
    owner = JSON.parse(snapshot.source);
  } catch (error) {
    throw changed(`Change-close mutation-lock proof is invalid: ${proofPath}`, [error.message]);
  }
  const [workspaceState, configState] = await Promise.all([
    inspect(workspaceRoot),
    inspect(getWorkspaceConfigDirectory(workspaceRoot)),
  ]);
  if (!workspaceState?.isDirectory() || workspaceState.isSymbolicLink()
    || !sameIdentity(identity(workspaceState), owner?.workspaceIdentity)
    || !configState?.isDirectory() || configState.isSymbolicLink()
    || !sameIdentity(identity(configState), owner?.configIdentity)) {
    throw changed("Change-close mutation-lock proof no longer names the current workspace authority.");
  }
  return snapshot;
}

async function removeBoundFile(
  path,
  expectedSnapshot,
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
  if (!sameIdentity(snapshot.identity, expectedSnapshot.identity)
    || !snapshot.bytes.equals(expectedSnapshot.bytes)) {
    throw changed(`${label} changed physical identity or content: ${path}`);
  }
  await removeBoundRegularFile(path, expectedSnapshot, {
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

export async function createCloseTransactionJournal(
  workspaceRoot,
  changeId,
  mutationLock,
  initialState,
  { afterInitializationStep = null } = {},
) {
  if (!mutationLock?.path || !mutationLock?.source || !mutationLock?.identity) {
    throw new SddError("Change-close recovery requires a bound workspace mutation lock.", {
      code: "MUTATION_RECOVERY_FAILED",
    });
  }
  const root = getChangesRoot(workspaceRoot);
  const path = getCloseTransactionJournalPath(workspaceRoot, changeId);
  const transactionId = randomUUID();
  const bootstrapName = intentName(changeId);
  const intentPath = join(root, bootstrapName);
  const proofName = `.${changeId}${PROOF_MARKER}${transactionId}`;
  const proofPath = join(root, proofName);
  const stagingName = `.${changeId}${JOURNAL_STAGE_MARKER}${transactionId}`;
  const stagingPath = join(root, stagingName);
  const assertBoundary = () => assertReceiptConfinement(workspaceRoot, [
    path,
    intentPath,
    stagingPath,
    proofPath,
  ]);
  await assertBoundary();
  let proofSnapshot = null;
  let journalState = null;
  let journalBytes = null;
  let proofLinked = false;
  let staged = false;
  let published = false;
  let handle = null;
  try {
    handle = await open(intentPath, "wx+", 0o600);
    journalState = await handle.stat({ bigint: true });
    const state = {
      ...initialState,
      receipt: {
        journalIdentity: identity(journalState),
        intentName: bootstrapName,
        intentIdentity: identity(journalState),
        stagingName,
        proofName,
        proofIdentity: { ...mutationLock.identity },
        proofSource: mutationLock.source,
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
    journalBytes = Buffer.from(`${oneLineJson(record)}\n`, "utf8");
    await writeFully(handle, journalBytes, 0);
    await handle.sync();
    await syncDirectory(root);
    await assertBoundary();
    if (afterInitializationStep) {
      await afterInitializationStep({ step: "intent", intentPath, stagingPath, proofPath, path });
    }

    await link(mutationLock.path, proofPath);
    proofLinked = true;
    proofSnapshot = await readBoundFileSnapshot(proofPath, {
      ownerRoot: workspaceRoot,
      label: "Change-close mutation-lock proof",
      unsafeCode: "CONCURRENT_CHANGE",
    });
    if (!sameIdentity(proofSnapshot.identity, mutationLock.identity)
      || !proofSnapshot.bytes.equals(Buffer.from(mutationLock.source, "utf8"))) {
      throw changed(`Change-close could not bind its mutation-lock proof: ${proofPath}`);
    }
    await syncDirectory(root);
    await assertBoundary();
    if (afterInitializationStep) {
      await afterInitializationStep({ step: "proof", intentPath, stagingPath, proofPath, path });
    }

    await link(intentPath, stagingPath);
    staged = true;
    await syncDirectory(root);
    await assertBoundary();
    if (afterInitializationStep) {
      await afterInitializationStep({ step: "staged", intentPath, stagingPath, proofPath, path });
    }
    try {
      await link(stagingPath, path);
    } catch (error) {
      throw changed(`Change-close recovery journal already exists: ${path}`, [error.message]);
    }
    published = true;
    await syncDirectory(root);
    await assertBoundary();
    if (afterInitializationStep) {
      await afterInitializationStep({ step: "visible", intentPath, stagingPath, proofPath, path });
    }
    const [visibleJournal, visibleIntent, visibleStaging] = await Promise.all([
      readBoundFileSnapshot(path, {
        ownerRoot: workspaceRoot,
        label: "Change-close recovery journal",
        unsafeCode: "CONCURRENT_CHANGE",
      }),
      readBoundFileSnapshot(intentPath, {
        ownerRoot: workspaceRoot,
        label: "Change-close journal intent",
        unsafeCode: "CONCURRENT_CHANGE",
      }),
      readBoundFileSnapshot(stagingPath, {
        ownerRoot: workspaceRoot,
        label: "Change-close staged recovery journal",
        unsafeCode: "CONCURRENT_CHANGE",
      }),
    ]);
    if (![visibleJournal, visibleIntent, visibleStaging].every((snapshot) =>
      sameIdentity(snapshot.identity, identity(journalState))
      && snapshot.bytes.equals(journalBytes))) {
      throw changed(`Change-close recovery journal changed during publication: ${path}`);
    }
    return {
      root,
      workspaceRoot,
      path,
      intentPath,
      stagingPath,
      proofPath,
      handle,
      identity: identity(journalState),
      transactionId,
      sequence: 0,
      lastHash: record.hash,
      offset: journalBytes.length,
      journalBytes,
      proofBytes: Buffer.from(proofSnapshot.bytes),
      state,
    };
  } catch (error) {
    const cleanupFailures = [];
    await handle?.close().catch((closeError) =>
      cleanupFailures.push(`Journal handle: ${closeError.message}`));
    const journalSnapshot = journalState && journalBytes
      ? { identity: identity(journalState), bytes: journalBytes }
      : null;
    if (journalSnapshot && published) {
      await removeBoundFile(
        path,
        journalSnapshot,
        "Change-close recovery journal",
        { assertBoundary, ownerRoot: workspaceRoot },
      ).catch((cleanupError) => cleanupFailures.push(`Journal: ${cleanupError.message}`));
    }
    if (journalSnapshot && staged) {
      await removeBoundFile(
        stagingPath,
        journalSnapshot,
        "Change-close staged recovery journal",
        { assertBoundary, ownerRoot: workspaceRoot },
      ).catch((cleanupError) => cleanupFailures.push(`Staged journal: ${cleanupError.message}`));
    }
    if (proofLinked) {
      await removeBoundFile(
        proofPath,
        proofSnapshot ?? {
          identity: { ...mutationLock.identity },
          bytes: Buffer.from(mutationLock.source, "utf8"),
        },
        "Change-close mutation-lock proof",
        { assertBoundary, ownerRoot: workspaceRoot },
      ).catch((cleanupError) => cleanupFailures.push(`Mutation-lock proof: ${cleanupError.message}`));
    }
    if (journalSnapshot) {
      await removeBoundFile(
        intentPath,
        journalSnapshot,
        "Change-close journal intent",
        { assertBoundary, ownerRoot: workspaceRoot },
      ).catch((cleanupError) => cleanupFailures.push(`Journal intent: ${cleanupError.message}`));
    }
    await syncDirectory(root).catch((cleanupError) =>
      cleanupFailures.push(`Receipt directory: ${cleanupError.message}`));
    if (cleanupFailures.length > 0) {
      throw new SddError("Change-close journal initialization failed and cleanup was incomplete.", {
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

export async function loadCloseTransactionJournal(workspaceRoot, changeId) {
  const root = getChangesRoot(workspaceRoot);
  const path = getCloseTransactionJournalPath(workspaceRoot, changeId);
  const bootstrapName = intentName(changeId);
  const intentPath = join(root, bootstrapName);
  await assertReceiptConfinement(workspaceRoot, [path, intentPath]);
  let [journalSnapshot, intentSnapshot] = await Promise.all([
    readBoundFileSnapshot(path, {
      ownerRoot: workspaceRoot,
      allowMissing: true,
      label: "Change-close recovery journal",
      unsafeCode: "CONCURRENT_CHANGE",
    }),
    readBoundFileSnapshot(intentPath, {
      ownerRoot: workspaceRoot,
      allowMissing: true,
      label: "Change-close journal intent",
      unsafeCode: "CONCURRENT_CHANGE",
    }),
  ]);
  if (journalSnapshot === null && intentSnapshot === null) return null;
  const authoritySnapshot = journalSnapshot ?? intentSnapshot;
  const journalIdentity = authoritySnapshot.identity;
  const parsed = parseJournal(authoritySnapshot.bytes);
  const receipt = parsed.record.state.receipt;
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
    || JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify([
      "intentIdentity",
      "intentName",
      "journalIdentity",
      "proofIdentity",
      "proofName",
      "proofSource",
      "stagingName",
    ])
    || receipt.intentName !== bootstrapName
    || !sameIdentity(receipt.intentIdentity, journalIdentity)
    || !sameIdentity(receipt.journalIdentity, journalIdentity)
    || typeof receipt.proofSource !== "string") {
    throw changed(`Change-close recovery journal ownership proof is invalid: ${path}`);
  }
  if (journalSnapshot !== null
    && (!sameIdentity(journalSnapshot.identity, journalIdentity)
      || !journalSnapshot.bytes.equals(authoritySnapshot.bytes))) {
    throw changed(`Change-close recovery journal changed content: ${path}`);
  }
  if (intentSnapshot !== null
    && (!sameIdentity(intentSnapshot.identity, journalIdentity)
      || !intentSnapshot.bytes.equals(authoritySnapshot.bytes))) {
    throw changed(`Change-close journal intent changed content: ${intentPath}`);
  }
  if (intentSnapshot === null && parsed.record.state.phase !== "complete") {
    throw changed(`Change-close journal intent is missing: ${intentPath}`);
  }

  const stagingName = requireOwnedReceiptName(
    receipt.stagingName,
    `.${changeId}${JOURNAL_STAGE_MARKER}`,
    "staged journal",
  );
  const stagingPath = join(root, stagingName);
  const proofName = requireOwnedReceiptName(
    receipt.proofName,
    `.${changeId}${PROOF_MARKER}`,
    "mutation-lock proof",
  );
  const proofPath = join(root, proofName);
  const assertBoundary = () => assertReceiptConfinement(workspaceRoot, [
    path,
    intentPath,
    stagingPath,
    proofPath,
  ]);
  await assertBoundary();
  let stagingSnapshot = await readBoundFileSnapshot(stagingPath, {
    ownerRoot: workspaceRoot,
    allowMissing: true,
    label: "Change-close staged journal proof",
    unsafeCode: "CONCURRENT_CHANGE",
  });
  if (stagingSnapshot !== null
    && (!sameIdentity(stagingSnapshot.identity, journalIdentity)
      || !stagingSnapshot.bytes.equals(authoritySnapshot.bytes))) {
    throw changed(`Change-close staged journal proof changed: ${stagingPath}`);
  }
  let proofSnapshot = await assertProofAuthority(workspaceRoot, proofPath, receipt, {
    allowMissing: true,
  });

  if (journalSnapshot === null) {
    if (intentSnapshot === null) {
      throw changed(`Change-close journal bootstrap disappeared: ${intentPath}`);
    }
    if (proofSnapshot === null) {
      if (stagingSnapshot !== null) {
        await removeBoundFile(
          stagingPath,
          { identity: journalIdentity, bytes: authoritySnapshot.bytes },
          "Change-close staged journal proof",
          { assertBoundary, ownerRoot: workspaceRoot },
        );
      }
      await removeBoundFile(
        intentPath,
        { identity: journalIdentity, bytes: authoritySnapshot.bytes },
        "Change-close journal intent",
        { allowMissing: false, assertBoundary, ownerRoot: workspaceRoot },
      );
      await syncDirectory(root);
      return null;
    }
    if (stagingSnapshot === null) {
      await link(intentPath, stagingPath);
      await syncDirectory(root);
      stagingSnapshot = await readBoundFileSnapshot(stagingPath, {
        ownerRoot: workspaceRoot,
        label: "Change-close staged journal proof",
        unsafeCode: "CONCURRENT_CHANGE",
      });
      if (!sameIdentity(stagingSnapshot.identity, journalIdentity)
        || !stagingSnapshot.bytes.equals(authoritySnapshot.bytes)) {
        throw changed(`Change-close staged journal proof changed during recovery: ${stagingPath}`);
      }
    }
    try {
      await link(stagingPath, path);
    } catch (error) {
      throw changed(`Change-close recovery journal appeared during bootstrap: ${path}`, [
        error.message,
      ]);
    }
    await syncDirectory(root);
    journalSnapshot = await readBoundFileSnapshot(path, {
      ownerRoot: workspaceRoot,
      label: "Change-close recovery journal",
      unsafeCode: "CONCURRENT_CHANGE",
    });
    if (!sameIdentity(journalSnapshot.identity, journalIdentity)
      || !journalSnapshot.bytes.equals(authoritySnapshot.bytes)) {
      throw changed(`Change-close recovery journal changed during bootstrap: ${path}`);
    }
  } else {
    if (stagingSnapshot === null && parsed.record.state.phase !== "complete") {
      throw changed(`Change-close staged journal proof is missing: ${stagingPath}`);
    }
    if (proofSnapshot === null && parsed.record.state.phase !== "complete") {
      throw changed(`Change-close mutation-lock proof is missing: ${proofPath}`);
    }
  }

  await assertBoundary();
  const handle = await open(path, "r+");
  try {
    const openedState = await handle.stat({ bigint: true });
    if (!sameIdentity(identity(openedState), journalIdentity)) {
      throw changed(`Change-close recovery journal changed before it was opened: ${path}`);
    }
    if (parsed.completeEnd !== authoritySnapshot.bytes.length) {
      await handle.truncate(parsed.completeEnd);
      await handle.sync();
      await syncDirectory(root);
    }
    const expectedJournalSnapshot = {
      identity: journalIdentity,
      bytes: parsed.bytes,
    };
    const [visibleAfter, intentAfter, stagedAfter] = await Promise.all([
      readBoundFileSnapshot(path, {
        ownerRoot: workspaceRoot,
        label: "Change-close recovery journal",
        unsafeCode: "CONCURRENT_CHANGE",
      }),
      readBoundFileSnapshot(intentPath, {
        ownerRoot: workspaceRoot,
        allowMissing: parsed.record.state.phase === "complete",
        label: "Change-close journal intent",
        unsafeCode: "CONCURRENT_CHANGE",
      }),
      readBoundFileSnapshot(stagingPath, {
        ownerRoot: workspaceRoot,
        allowMissing: parsed.record.state.phase === "complete",
        label: "Change-close staged journal proof",
        unsafeCode: "CONCURRENT_CHANGE",
      }),
    ]);
    for (const snapshot of [visibleAfter, intentAfter, stagedAfter]) {
      if (snapshot !== null
        && (!sameIdentity(snapshot.identity, expectedJournalSnapshot.identity)
          || !snapshot.bytes.equals(expectedJournalSnapshot.bytes))) {
        throw changed(`Change-close recovery journal changed while it was opened: ${path}`);
      }
    }
    return {
      root,
      workspaceRoot,
      path,
      intentPath,
      stagingPath,
      proofPath,
      handle,
      identity: journalIdentity,
      transactionId: parsed.record.transactionId,
      sequence: parsed.sequence,
      lastHash: parsed.record.hash,
      offset: parsed.completeEnd,
      journalBytes: parsed.bytes,
      proofBytes: proofSnapshot
        ? Buffer.from(proofSnapshot.bytes)
        : Buffer.from(receipt.proofSource, "utf8"),
      state: parsed.record.state,
    };
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}
export async function appendCloseTransactionState(session, state) {
  const assertBoundary = receiptBoundary(session);
  await assertBoundary();
  const [visible, intent, staged] = await Promise.all([
    readBoundFileSnapshot(session.path, {
      ownerRoot: session.workspaceRoot,
      label: "Change-close recovery journal",
      unsafeCode: "CONCURRENT_CHANGE",
    }),
    readBoundFileSnapshot(session.intentPath, {
      ownerRoot: session.workspaceRoot,
      label: "Change-close journal intent",
      unsafeCode: "CONCURRENT_CHANGE",
    }),
    readBoundFileSnapshot(session.stagingPath, {
      ownerRoot: session.workspaceRoot,
      label: "Change-close staged journal proof",
      unsafeCode: "CONCURRENT_CHANGE",
    }),
  ]);
  if (![visible, intent, staged].every((snapshot) =>
    sameIdentity(snapshot.identity, session.identity)
    && snapshot.bytes.equals(session.journalBytes))
    || session.offset !== session.journalBytes.length) {
    throw changed(`Change-close recovery journal changed before append: ${session.path}`);
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
  const recordBytes = Buffer.from(`${oneLineJson(record)}\n`, "utf8");
  const nextJournalBytes = Buffer.concat([session.journalBytes, recordBytes]);
  await writeFully(session.handle, recordBytes, session.journalBytes.length);
  await assertBoundary();
  await session.handle.sync();
  await assertBoundary();
  const [visibleAfter, intentAfter, stagedAfter] = await Promise.all([
    readBoundFileSnapshot(session.path, {
      ownerRoot: session.workspaceRoot,
      label: "Change-close recovery journal",
      unsafeCode: "CONCURRENT_CHANGE",
    }),
    readBoundFileSnapshot(session.intentPath, {
      ownerRoot: session.workspaceRoot,
      label: "Change-close journal intent",
      unsafeCode: "CONCURRENT_CHANGE",
    }),
    readBoundFileSnapshot(session.stagingPath, {
      ownerRoot: session.workspaceRoot,
      label: "Change-close staged journal proof",
      unsafeCode: "CONCURRENT_CHANGE",
    }),
  ]);
  if (![visibleAfter, intentAfter, stagedAfter].every((snapshot) =>
    sameIdentity(snapshot.identity, session.identity)
    && snapshot.bytes.equals(nextJournalBytes))) {
    throw changed(`Change-close recovery journal changed during append: ${session.path}`);
  }
  session.sequence = sequence;
  session.lastHash = record.hash;
  session.offset = nextJournalBytes.length;
  session.journalBytes = nextJournalBytes;
  session.state = record.state;
  return session.state;
}

export async function cleanupCloseTransactionJournal(
  session,
  {
    afterProofCleanup = null,
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
        session.proofPath,
        { identity: session.state.receipt.proofIdentity, bytes: session.proofBytes },
        "Change-close mutation-lock proof",
        removalOptions("proof"),
      )) {
        await syncDirectory(session.root);
      }
    } catch (error) {
      failures.push(`Mutation-lock proof cleanup: ${error.message}`);
    }
  }
  if (failures.length === 0) {
    try {
      if (await removeBoundFile(
        session.stagingPath,
        { identity: session.identity, bytes: session.journalBytes },
        "Change-close staged journal proof",
        removalOptions("staged"),
      )) {
        await syncDirectory(session.root);
      }
    } catch (error) {
      failures.push(`Staged journal proof cleanup: ${error.message}`);
    }
  }
  if (failures.length === 0) {
    try {
      if (await removeBoundFile(
        session.intentPath,
        { identity: session.identity, bytes: session.journalBytes },
        "Change-close journal intent",
        removalOptions("intent"),
      )) {
        await syncDirectory(session.root);
      }
    } catch (error) {
      failures.push(`Journal intent cleanup: ${error.message}`);
    }
  }
  if (failures.length === 0 && afterProofCleanup) {
    await afterProofCleanup({
      journalPath: session.path,
      stagingPath: session.stagingPath,
      proofPath: session.proofPath,
      intentPath: session.intentPath,
    });
  }
  if (failures.length === 0) {
    try {
      if (await removeBoundFile(
        session.path,
        { identity: session.identity, bytes: session.journalBytes },
        "Change-close recovery journal",
        removalOptions("visible", false),
      )) {
        await syncDirectory(session.root);
      }
    } catch (error) {
      failures.push(`Recovery journal cleanup: ${error.message}`);
    }
  }
  return failures;
}

export async function closeCloseTransactionJournal(session) {
  if (!session?.handle) return;
  await session.handle.close();
  session.handle = null;
}

export async function inspectCloseTransactionReceipts(workspaceRoot) {
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
      || name.endsWith(JOURNAL_INTENT_SUFFIX)
      || name.includes(PROOF_MARKER)
      || name.includes(BACKUP_MARKER))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({
      level: "error",
      code: "CHANGE_CLOSE_RECOVERY_REQUIRED",
      message: `Interrupted Change-close recovery receipt requires attention: ${join(root, name)}. Retry the matching \`sdd change close\` command.`,
    }));
}
