import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rmdir,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { SddError } from "./errors.js";
import { isPathInside, resolvePhysicalPath } from "./fs.js";

function entryIdentity(state) {
  return { dev: String(state.dev), ino: String(state.ino) };
}

function sameIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino;
}

function modeOf(state) {
  return Number(state.mode & 0o777n);
}

function sameObservation(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function concurrentChange(message, details = []) {
  return new SddError(message, { code: "CONCURRENT_CHANGE", details });
}

const PUBLICATION_JOURNAL_VERSION = 2;
const PUBLICATION_INTENT_NAME = "intent.json";
const PUBLICATION_INITIALIZATION_NAME = "initialization.json";
const PUBLICATION_RECEIPT_NAME = "reservation-receipt.json";
const PUBLICATION_LIVE_OWNER_NAME = "live-owner.json";
const PUBLICATION_RECOVERY_CLAIM_NAME = "recovery-claim.json";
const STAGING_INTENT_NAME = "staging-intent.json";
const STAGING_ROOT_NAME = "staging-root.json";
const STAGING_PROGRESS_PREFIX = "staging-entry-";
const STAGING_PAYLOAD_PREFIX = "staging-payload-";
const STAGING_ROOT_MARKER_NAME = ".sdd-staging-owner";
const PUBLICATION_OWNER_MARKER_PREFIX = ".sdd-publication-owner-";
const PUBLICATION_RESERVATION_MARKER_PREFIX = ".sdd-publication-reservation-";
const PUBLICATION_OPERATION_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const livePublicationOperations = new Set();

function digestBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function publicationJournalPath(targetPath) {
  return join(dirname(targetPath), `.${basename(targetPath)}.sdd-publication`);
}
function publicationInitializationPath(targetPath) {
  return join(dirname(targetPath), `.${basename(targetPath)}.sdd-publication-init.json`);
}

function publicationRecoveryClaimPath(targetPath) {
  return join(dirname(targetPath), `.${basename(targetPath)}.sdd-publication-recovery.json`);
}
function publicationLiveOwnerPath(targetPath, operationToken) {
  return join(
    dirname(targetPath),
    `.${basename(targetPath)}.sdd-live-owner-${operationToken}`,
  );
}

function stagingJournalPath(targetPath) {
  return join(dirname(targetPath), `.${basename(targetPath)}.sdd-staging`);
}

function stagingLiveOwnerPath(targetPath, operationToken) {
  return join(
    dirname(targetPath),
    `.${basename(targetPath)}.sdd-staging-owner-${operationToken}`,
  );
}

function stagingReservationPath(targetPath) {
  return join(dirname(targetPath), `.${basename(targetPath)}.sdd-staging-reservation.json`);
}

function publicationTerminalPath(targetPath) {
  return join(dirname(targetPath), `.${basename(targetPath)}.sdd-publication-terminal.json`);
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function validOperationToken(token) {
  return typeof token === "string" && PUBLICATION_OPERATION_TOKEN_PATTERN.test(token);
}

function publicationOwnerIsLive(creatorPid, operationToken, durableOwnerHeld) {
  if (creatorPid === process.pid) return livePublicationOperations.has(operationToken);
  return durableOwnerHeld && processIsAlive(creatorPid);
}

async function lstatIfPresent(path) {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error?.code)) return null;
    throw error;
  }
}

async function captureCreatedDirectory(path, label, assertPath = null) {
  await assertBoundary(assertPath, path);
  let handle;
  try {
    handle = await open(path, "r");
    const opened = await handle.stat({ bigint: true });
    const visible = await lstatIfPresent(path);
    if (!opened.isDirectory()
      || !visible?.isDirectory()
      || visible.isSymbolicLink()
      || !sameIdentity(entryIdentity(opened), entryIdentity(visible))) {
      throw concurrentChange(`${label} changed while its directory identity was captured: ${path}`);
    }
    return { identity: entryIdentity(opened), mode: modeOf(opened) };
  } finally {
    await handle?.close();
  }
}

async function captureRegularEntry(path, name, label) {
  const before = await lstatIfPresent(path);
  if (!before?.isFile() || before.isSymbolicLink()) {
    throw concurrentChange(`${label} contains a non-regular entry: ${path}`);
  }
  const bytes = await readFile(path);
  const after = await lstatIfPresent(path);
  if (!after?.isFile()
    || after.isSymbolicLink()
    || !sameObservation(before, after)) {
    throw concurrentChange(`${label} entry changed while its proof was captured: ${path}`);
  }
  return {
    name,
    identity: entryIdentity(after),
    mode: modeOf(after),
    bytes,
  };
}

async function captureFlatDirectory(path, label) {
  const before = await lstatIfPresent(path);
  if (!before?.isDirectory() || before.isSymbolicLink()) {
    throw concurrentChange(`${label} is not a real directory: ${path}`);
  }
  const names = (await readdir(path)).sort((left, right) => left.localeCompare(right));
  const entries = [];
  for (const name of names) {
    entries.push(await captureRegularEntry(join(path, name), name, label));
  }
  const [after, afterNames] = await Promise.all([
    lstatIfPresent(path),
    readdir(path).then((values) => values.sort((left, right) => left.localeCompare(right))),
  ]);
  if (!after?.isDirectory()
    || after.isSymbolicLink()
    || !sameObservation(before, after)
    || JSON.stringify(names) !== JSON.stringify(afterNames)) {
    throw concurrentChange(`${label} changed while its directory proof was captured: ${path}`);
  }
  return {
    root: { identity: entryIdentity(after), mode: modeOf(after) },
    entries,
  };
}

function sameRegularEntry(left, right) {
  return left?.name === right?.name
    && left?.mode === right?.mode
    && sameIdentity(left?.identity, right?.identity)
    && Buffer.isBuffer(left?.bytes)
    && Buffer.isBuffer(right?.bytes)
    && left.bytes.equals(right.bytes);
}

function sameDirectoryProof(left, right) {
  return sameIdentity(left?.root?.identity, right?.root?.identity)
    && left?.root?.mode === right?.root?.mode
    && left?.entries?.length === right?.entries?.length
    && left.entries.every((entry, index) => sameRegularEntry(entry, right.entries[index]));
}

async function directoryMatchesProof(path, proof, label) {
  try {
    return sameDirectoryProof(await captureFlatDirectory(path, label), proof);
  } catch (error) {
    if (error?.code === "CONCURRENT_CHANGE") return false;
    throw error;
  }
}

async function regularEntryMatches(path, expected, label) {
  try {
    return sameRegularEntry(await captureRegularEntry(path, expected.name, label), expected);
  } catch (error) {
    if (error?.code === "CONCURRENT_CHANGE") return false;
    throw error;
  }
}

async function assertBoundary(assertPath, path) {
  if (assertPath) await assertPath(path);
}
function pathInsideOrEqual(parent, child) {
  return resolve(parent) === resolve(child) || isPathInside(resolve(parent), resolve(child));
}

function unsafeOwnerBoundary(label, path, message) {
  return new SddError(`${label} ${message}: ${path}`, {
    code: "UNSAFE_ARTIFACT_PATH",
  });
}

async function captureOwnerBoundary(ownerRoot, parent, label) {
  if (typeof ownerRoot !== "string" || ownerRoot.length === 0) {
    throw new TypeError(`${label} requires an ownerRoot.`);
  }
  const logicalOwnerRoot = resolve(ownerRoot);
  const logicalParent = resolve(parent);
  if (!pathInsideOrEqual(logicalOwnerRoot, logicalParent)) {
    throw unsafeOwnerBoundary(label, logicalParent, "parent is outside its logical owner root");
  }

  const logicalOwnerState = await lstatIfPresent(logicalOwnerRoot);
  if (!logicalOwnerState
    || (!logicalOwnerState.isDirectory() && !logicalOwnerState.isSymbolicLink())) {
    throw unsafeOwnerBoundary(label, logicalOwnerRoot, "owner root is not a directory");
  }
  const physicalOwnerRoot = await resolvePhysicalPath(logicalOwnerRoot);
  const physicalOwnerState = await lstatIfPresent(physicalOwnerRoot);
  if (!physicalOwnerState?.isDirectory() || physicalOwnerState.isSymbolicLink()) {
    throw unsafeOwnerBoundary(label, physicalOwnerRoot, "physical owner root is not a real directory");
  }

  const ancestors = [];
  let current = logicalOwnerRoot;
  const relation = relative(logicalOwnerRoot, logicalParent);
  for (const segment of relation.split(sep).filter(Boolean)) {
    current = join(current, segment);
    const state = await lstatIfPresent(current);
    if (!state?.isDirectory() || state.isSymbolicLink()) {
      throw unsafeOwnerBoundary(label, current, "publication ancestor is not a real directory");
    }
    ancestors.push({
      path: current,
      identity: entryIdentity(state),
      mode: modeOf(state),
    });
  }

  const physicalParent = await resolvePhysicalPath(logicalParent);
  if (!pathInsideOrEqual(physicalOwnerRoot, physicalParent)) {
    throw unsafeOwnerBoundary(label, logicalParent, "parent escapes its physical owner root");
  }
  return {
    label,
    logicalOwnerRoot,
    logicalOwnerIdentity: entryIdentity(logicalOwnerState),
    logicalOwnerMode: modeOf(logicalOwnerState),
    logicalOwnerIsSymlink: logicalOwnerState.isSymbolicLink(),
    physicalOwnerRoot,
    physicalOwnerIdentity: entryIdentity(physicalOwnerState),
    physicalOwnerMode: modeOf(physicalOwnerState),
    logicalParent,
    physicalParent,
    ancestors,
  };
}

async function assertOwnerBoundary(boundary, path) {
  const absolutePath = resolve(path);
  if (!pathInsideOrEqual(boundary.logicalParent, absolutePath)) {
    throw unsafeOwnerBoundary(boundary.label, absolutePath, "mutation path left its bound parent");
  }
  const logicalOwnerState = await lstatIfPresent(boundary.logicalOwnerRoot);
  const physicalOwnerRoot = await resolvePhysicalPath(boundary.logicalOwnerRoot);
  const physicalOwnerState = await lstatIfPresent(physicalOwnerRoot);
  if (!logicalOwnerState
    || !sameIdentity(entryIdentity(logicalOwnerState), boundary.logicalOwnerIdentity)
    || modeOf(logicalOwnerState) !== boundary.logicalOwnerMode
    || logicalOwnerState.isSymbolicLink() !== boundary.logicalOwnerIsSymlink
    || physicalOwnerRoot !== boundary.physicalOwnerRoot
    || !physicalOwnerState?.isDirectory()
    || physicalOwnerState.isSymbolicLink()
    || !sameIdentity(entryIdentity(physicalOwnerState), boundary.physicalOwnerIdentity)
    || modeOf(physicalOwnerState) !== boundary.physicalOwnerMode) {
    throw concurrentChange(`${boundary.label} owner root changed before mutation: ${absolutePath}`);
  }
  for (const ancestor of boundary.ancestors) {
    const state = await lstatIfPresent(ancestor.path);
    if (!state?.isDirectory()
      || state.isSymbolicLink()
      || !sameIdentity(entryIdentity(state), ancestor.identity)
      || modeOf(state) !== ancestor.mode) {
      throw concurrentChange(`${boundary.label} ancestor changed before mutation: ${ancestor.path}`);
    }
  }
  const physicalPath = await resolvePhysicalPath(absolutePath);
  if (!pathInsideOrEqual(boundary.physicalParent, physicalPath)
    || !pathInsideOrEqual(boundary.physicalOwnerRoot, physicalPath)) {
    throw unsafeOwnerBoundary(boundary.label, absolutePath, "mutation path escapes its bound owner");
  }
}

function boundPathAssertion(boundary, assertPath) {
  return async (path) => {
    await assertOwnerBoundary(boundary, path);
    await assertBoundary(assertPath, path);
  };
}

function ownerBoundaryRecord(boundary) {
  return {
    logicalOwnerRoot: boundary.logicalOwnerRoot,
    logicalOwnerIdentity: boundary.logicalOwnerIdentity,
    logicalOwnerMode: boundary.logicalOwnerMode,
    logicalOwnerIsSymlink: boundary.logicalOwnerIsSymlink,
    physicalOwnerRoot: boundary.physicalOwnerRoot,
    physicalOwnerIdentity: boundary.physicalOwnerIdentity,
    physicalOwnerMode: boundary.physicalOwnerMode,
    logicalParent: boundary.logicalParent,
    physicalParent: boundary.physicalParent,
    ancestors: boundary.ancestors.map((ancestor) => ({
      path: ancestor.path,
      identity: ancestor.identity,
      mode: ancestor.mode,
    })),
  };
}

function sameOwnerBoundaryRecord(boundary, record) {
  const expected = ownerBoundaryRecord(boundary);
  return record?.logicalOwnerRoot === expected.logicalOwnerRoot
    && sameIdentity(record?.logicalOwnerIdentity, expected.logicalOwnerIdentity)
    && record?.logicalOwnerMode === expected.logicalOwnerMode
    && record?.logicalOwnerIsSymlink === expected.logicalOwnerIsSymlink
    && record?.physicalOwnerRoot === expected.physicalOwnerRoot
    && sameIdentity(record?.physicalOwnerIdentity, expected.physicalOwnerIdentity)
    && record?.physicalOwnerMode === expected.physicalOwnerMode
    && record?.logicalParent === expected.logicalParent
    && record?.physicalParent === expected.physicalParent
    && Array.isArray(record?.ancestors)
    && record.ancestors.length === expected.ancestors.length
    && record.ancestors.every((ancestor, index) => {
      const expectedAncestor = expected.ancestors[index];
      return ancestor?.path === expectedAncestor.path
        && sameIdentity(ancestor?.identity, expectedAncestor.identity)
        && ancestor?.mode === expectedAncestor.mode;
    });
}

async function ensureOwnerParent(ownerRoot, parent, label, assertPath = null) {
  const logicalOwnerRoot = resolve(ownerRoot);
  const logicalParent = resolve(parent);
  if (!pathInsideOrEqual(logicalOwnerRoot, logicalParent)) {
    throw unsafeOwnerBoundary(label, logicalParent, "parent is outside its logical owner root");
  }
  let current = logicalOwnerRoot;
  const relation = relative(logicalOwnerRoot, logicalParent);
  for (const segment of relation.split(sep).filter(Boolean)) {
    const candidate = join(current, segment);
    const state = await lstatIfPresent(candidate);
    if (!state) {
      const parentBoundary = await captureOwnerBoundary(ownerRoot, current, label);
      const assertMutationPath = boundPathAssertion(parentBoundary, assertPath);
      await assertMutationPath(candidate);
      try {
        await mkdir(candidate);
      } catch (error) {
        throw concurrentChange(`${label} parent changed during bounded creation: ${candidate}`, [
          error.message,
        ]);
      }
      await assertMutationPath(candidate);
    } else if (!state.isDirectory() || state.isSymbolicLink()) {
      throw unsafeOwnerBoundary(label, candidate, "publication ancestor is not a real directory");
    }
    current = candidate;
  }
  return captureOwnerBoundary(ownerRoot, logicalParent, label);
}

async function syncDirectory(path, assertPath = null) {
  await assertBoundary(assertPath, path);
  let handle;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } finally {
    await handle?.close();
  }
}

async function assertDirectoryRoot(path, expected, label, expectedNames = null) {
  const current = await lstatIfPresent(path);
  if (!current?.isDirectory()
    || current.isSymbolicLink()
    || !sameIdentity(entryIdentity(current), expected.identity)
    || modeOf(current) !== expected.mode) {
    throw concurrentChange(`${label} changed physical identity: ${path}`);
  }
  if (expectedNames !== null) {
    const names = (await readdir(path)).sort((left, right) => left.localeCompare(right));
    const sortedExpected = [...expectedNames].sort((left, right) => left.localeCompare(right));
    if (JSON.stringify(names) !== JSON.stringify(sortedExpected)) {
      throw concurrentChange(`${label} gained or lost content: ${path}`);
    }
  }
}

async function createQuarantineSlot(parent, subject, label, assertPath = null) {
  const root = join(
    parent,
    `.${basename(subject)}.sdd-cleanup-${process.pid}-${randomUUID()}`,
  );
  await assertBoundary(assertPath, root);
  try {
    await mkdir(root, { mode: 0o700 });
  } catch (error) {
    throw concurrentChange(`${label} could not reserve an exclusive cleanup quarantine: ${root}`, [
      error.message,
    ]);
  }
  await assertBoundary(assertPath, root);
  const captured = await captureCreatedDirectory(
    root,
    `${label} cleanup quarantine`,
    assertPath,
  );
  await syncDirectory(parent, assertPath);
  return {
    root,
    entry: join(root, "entry"),
    identity: captured.identity,
    mode: captured.mode,
  };
}

async function releaseQuarantineSlot(slot, label, assertPath = null) {
  const state = await lstatIfPresent(slot.root);
  if (!state) return { removed: true, concurrent: false, details: [] };
  const names = state.isDirectory() && !state.isSymbolicLink()
    ? await readdir(slot.root)
    : ["opaque"];
  if (!state.isDirectory()
    || state.isSymbolicLink()
    || !sameIdentity(entryIdentity(state), slot.identity)
    || modeOf(state) !== slot.mode
    || names.length !== 0) {
    return {
      removed: false,
      concurrent: true,
      details: [`Newer ${label} cleanup quarantine preserved: ${slot.root}`],
    };
  }
  await assertBoundary(assertPath, slot.root);
  await assertDirectoryRoot(slot.root, slot, `${label} cleanup quarantine`, []);
  await assertBoundary(assertPath, slot.root);
  await rmdir(slot.root);
  await syncDirectory(dirname(slot.root), assertPath);
  return { removed: true, concurrent: false, details: [] };
}


async function removeOwnedRegularEntry(
  parent,
  parentProof,
  entry,
  label,
  assertPath = null,
) {
  await assertDirectoryRoot(parent, parentProof, label);
  const path = join(parent, entry.name);
  if (!(await regularEntryMatches(path, entry, label))) {
    return {
      removed: false,
      concurrent: true,
      details: [`Newer ${label} entry preserved: ${path}`],
    };
  }
  try {
    await assertBoundary(assertPath, path);
    await assertDirectoryRoot(parent, parentProof, label);
    if (!(await regularEntryMatches(path, entry, label))) {
      throw concurrentChange(`${label} entry changed before cleanup: ${path}`);
    }
    await unlink(path);
    await syncDirectory(parent, assertPath);
  } catch (error) {
    return {
      removed: false,
      concurrent: true,
      details: [`Newer ${label} entry preserved: ${path}`, error.message],
    };
  }
  const newer = await lstatIfPresent(path);
  return {
    removed: true,
    concurrent: Boolean(newer),
    details: newer ? [`Newer ${label} entry preserved: ${path}`] : [],
  };
}

async function removeEmptyOwnedDirectory(path, rootProof, label, assertPath = null) {
  const current = await lstatIfPresent(path);
  if (!current) return { removed: true, concurrent: false, details: [] };
  if (!current.isDirectory()
    || current.isSymbolicLink()
    || !sameIdentity(entryIdentity(current), rootProof.identity)
    || modeOf(current) !== rootProof.mode
    || (await readdir(path)).length !== 0) {
    return {
      removed: false,
      concurrent: true,
      details: [`Newer ${label} preserved: ${path}`],
    };
  }
  try {
    await assertBoundary(assertPath, path);
    await assertDirectoryRoot(path, rootProof, label, []);
    await rmdir(path);
    await syncDirectory(dirname(path), assertPath);
  } catch (error) {
    return {
      removed: false,
      concurrent: true,
      details: [`Newer ${label} preserved: ${path}`, error.message],
    };
  }
  const newer = await lstatIfPresent(path);
  return {
    removed: true,
    concurrent: Boolean(newer),
    details: newer ? [`Newer ${label} preserved: ${path}`] : [],
  };
}

async function rollbackPartialDirectory(
  path,
  rootProof,
  entries,
  label,
  assertPath = null,
) {
  const current = await lstatIfPresent(path);
  if (!current) return { removed: true, concurrent: false, details: [] };
  if (!current.isDirectory()
    || current.isSymbolicLink()
    || !sameIdentity(entryIdentity(current), rootProof.identity)
    || modeOf(current) !== rootProof.mode) {
    return {
      removed: false,
      concurrent: true,
      details: [`Newer ${label} preserved: ${path}`],
    };
  }

  const details = [];
  let concurrent = false;
  for (const entry of entries) {
    const outcome = await removeOwnedRegularEntry(
      path,
      rootProof,
      entry,
      label,
      assertPath,
    );
    details.push(...outcome.details);
    concurrent ||= outcome.concurrent;
    if (!outcome.removed) concurrent = true;
  }
  const remaining = await lstatIfPresent(path);
  if (!remaining?.isDirectory()
    || remaining.isSymbolicLink()
    || !sameIdentity(entryIdentity(remaining), rootProof.identity)
    || modeOf(remaining) !== rootProof.mode) {
    return {
      removed: false,
      concurrent: true,
      details: [...details, `Newer ${label} preserved: ${path}`],
    };
  }
  if ((await readdir(path)).length !== 0) {
    return {
      removed: false,
      concurrent: true,
      details: [...details, `Newer ${label} content preserved: ${path}`],
    };
  }
  const rootOutcome = await removeEmptyOwnedDirectory(
    path,
    rootProof,
    label,
    assertPath,
  );
  return {
    removed: rootOutcome.removed,
    concurrent: concurrent || rootOutcome.concurrent,
    details: [...details, ...rootOutcome.details],
  };
}

async function removeExactFlatDirectory(
  path,
  proof,
  {
    label,
    afterVerification = null,
    assertPath = null,
  },
) {
  await assertBoundary(assertPath, path);
  if (!(await directoryMatchesProof(path, proof, label))) {
    return {
      removed: false,
      concurrent: true,
      details: [`Newer ${label} preserved: ${path}`],
    };
  }
  if (afterVerification) await afterVerification({ path });
  const slot = await createQuarantineSlot(dirname(path), path, label, assertPath);
  let slotEntryRoot = null;
  try {
    await assertBoundary(assertPath, path);
    await assertBoundary(assertPath, slot.entry);
    await mkdir(slot.entry, { mode: proof.root.mode });
    slotEntryRoot = await captureCreatedDirectory(
      slot.entry,
      `${label} cleanup handoff`,
      assertPath,
    );
    const transferred = [];
    for (const entry of proof.entries) {
      await assertDirectoryRoot(
        slot.entry,
        slotEntryRoot,
        `${label} cleanup handoff`,
        transferred.map((value) => value.name),
      );
      const sourcePath = join(path, entry.name);
      const handoffPath = join(slot.entry, entry.name);
      if (!(await regularEntryMatches(sourcePath, entry, label))) {
        throw concurrentChange(`${label} changed before cleanup handoff: ${sourcePath}`);
      }
      await link(sourcePath, handoffPath);
      if (!(await regularEntryMatches(sourcePath, entry, label))
        || !(await regularEntryMatches(handoffPath, entry, label))) {
        throw concurrentChange(`${label} changed during cleanup handoff: ${sourcePath}`);
      }
      transferred.push(entry);
      await syncDirectory(slot.entry, assertPath);
    }
    const sourceOutcome = await removeCommittedFlatDirectory(
      path,
      proof,
      label,
      assertPath,
    );
    if (!sourceOutcome.removed || sourceOutcome.concurrent) {
      throw concurrentChange(`${label} source was retained during cleanup handoff.`, sourceOutcome.details);
    }
    const handoffOutcome = await removeCommittedFlatDirectory(
      slot.entry,
      { root: slotEntryRoot, entries: proof.entries },
      `${label} cleanup handoff`,
      assertPath,
    );
    if (!handoffOutcome.removed || handoffOutcome.concurrent) {
      return {
        removed: true,
        concurrent: true,
        details: handoffOutcome.details,
      };
    }
    const released = await releaseQuarantineSlot(slot, label, assertPath);
    return {
      removed: true,
      concurrent: released.concurrent || !released.removed,
      details: released.details,
    };
  } catch (error) {
    const details = [error.message];
    if (slotEntryRoot) {
      const cleanup = await removeCommittedFlatDirectory(
        slot.entry,
        { root: slotEntryRoot, entries: proof.entries },
        `${label} cleanup handoff`,
        assertPath,
      );
      details.push(...cleanup.details);
    }
    const released = await releaseQuarantineSlot(slot, label, assertPath);
    return {
      removed: false,
      concurrent: true,
      details: [`Newer ${label} preserved: ${path}`, ...details, ...released.details],
    };
  }
}

function cleanupFailure(label, primaryError, cleanupErrors, details) {
  const failure = new SddError(`${label} failed and cleanup was incomplete.`, {
    code: "MUTATION_RECOVERY_FAILED",
    details: [
      `Original error: ${primaryError?.code ? `${primaryError.code}: ` : ""}${primaryError.message}`,
      ...cleanupErrors.map((error) => `Cleanup error: ${error.message}`),
      ...details,
    ],
  });
  failure.errors = [primaryError, ...cleanupErrors];
  failure.cause = new AggregateError(failure.errors, failure.message);
  return failure;
}

function appendConcurrentDetails(error, label, details) {
  if (details.length === 0) return error;
  if (error instanceof SddError) {
    error.details = [...error.details, ...details];
    return error;
  }
  const failure = concurrentChange(`${label} changed concurrently.`, [
    `Original error: ${error.message}`,
    ...details,
  ]);
  failure.cause = error;
  return failure;
}

function normalizedEntries(entries) {
  const names = new Set();
  return entries.map(([name, source]) => {
    if (typeof name !== "string"
      || name.length === 0
      || basename(name) !== name
      || name === "."
      || name === ".."
      || names.has(name)) {
      throw new TypeError(`Invalid staged directory entry name: ${String(name)}`);
    }
    names.add(name);
    return [name, Buffer.isBuffer(source) ? source : Buffer.from(source, "utf8")];
  });
}

function proofRecord(proof) {
  return {
    root: {
      identity: proof.root.identity,
      mode: proof.root.mode,
    },
    entries: proof.entries.map((entry) => ({
      name: entry.name,
      identity: entry.identity,
      mode: entry.mode,
      bytes: entry.bytes.toString("base64"),
    })),
  };
}

function validIdentity(value) {
  return typeof value?.dev === "string"
    && value.dev.length > 0
    && typeof value?.ino === "string"
    && value.ino.length > 0;
}

function hydratedProof(record) {
  if (!record
    || !validIdentity(record.root?.identity)
    || !Number.isInteger(record.root?.mode)
    || !Array.isArray(record.entries)) {
    return null;
  }
  const names = new Set();
  const entries = [];
  for (const entry of record.entries) {
    if (typeof entry?.name !== "string"
      || entry.name.length === 0
      || basename(entry.name) !== entry.name
      || names.has(entry.name)
      || !validIdentity(entry.identity)
      || !Number.isInteger(entry.mode)
      || typeof entry.bytes !== "string") {
      return null;
    }
    const bytes = Buffer.from(entry.bytes, "base64");
    if (bytes.toString("base64") !== entry.bytes) return null;
    names.add(entry.name);
    entries.push({
      name: entry.name,
      identity: entry.identity,
      mode: entry.mode,
      bytes,
    });
  }
  return {
    root: {
      identity: record.root.identity,
      mode: record.root.mode,
    },
    entries,
  };
}

function proofMatchesSources(proof, sources) {
  if (proof.entries.length !== sources.length) return false;
  const sourcesByName = new Map(sources);
  return proof.entries.every((entry) => sourcesByName.get(entry.name)?.equals(entry.bytes));
}

function recoveryFailure(label, details, retainedPaths, errors = []) {
  const failure = new SddError(`${label} publication recovery could not safely finish.`, {
    code: "MUTATION_RECOVERY_FAILED",
    details: [
      ...details,
      ...[...new Set(retainedPaths)].map((path) => `Retained path requiring inspection: ${path}`),
    ],
  });
  if (errors.length > 0) {
    failure.errors = errors;
    failure.cause = new AggregateError(errors, failure.message);
  }
  return failure;
}

async function writeDurableJournalEntry(path, name, bytes, label, assertPath, mode = 0o600) {
  await assertBoundary(assertPath, path);
  let handle;
  let ownerIdentity;
  try {
    handle = await open(path, "wx", mode);
    ownerIdentity = entryIdentity(await handle.stat({ bigint: true }));
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle?.close();
  }
  await assertBoundary(assertPath, path);
  const entry = await captureRegularEntry(path, name, label);
  if (!sameIdentity(entry.identity, ownerIdentity) || !entry.bytes.equals(bytes)) {
    throw concurrentChange(`${label} changed after its durable write: ${path}`);
  }
  return entry;
}

async function writeDurableJournalValue(path, name, createValue, label, assertPath) {
  await assertBoundary(assertPath, path);
  let handle;
  let value;
  let bytes;
  let ownerIdentity;
  try {
    handle = await open(path, "wx", 0o600);
    ownerIdentity = entryIdentity(await handle.stat({ bigint: true }));
    value = createValue(ownerIdentity);
    bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle?.close();
  }
  await assertBoundary(assertPath, path);
  const entry = await captureRegularEntry(path, name, label);
  if (!sameIdentity(entry.identity, ownerIdentity) || !entry.bytes.equals(bytes)) {
    throw concurrentChange(`${label} changed after its durable write: ${path}`);
  }
  return { entry, value, bytes };
}

async function createPublicationJournal(
  staged,
  targetPath,
  handoff,
  operationToken,
  label,
  assertPath,
  onLiveOwnerClaim = null,
  afterJournalMkdir = null,
  afterLiveOwnerClaim = null,
) {
  const path = publicationJournalPath(targetPath);
  const initializationPath = publicationInitializationPath(targetPath);
  const liveOwnerPath = publicationLiveOwnerPath(targetPath, operationToken);
  const serializedProof = proofRecord(staged.proof);
  const proofBytes = Buffer.from(JSON.stringify(serializedProof), "utf8");
  const handoffRecord = {
    root: resolve(handoff.root),
    entry: resolve(handoff.entry),
    identity: handoff.identity,
    mode: handoff.mode,
    entryRoot: handoff.entryRoot,
  };
  let initialization;
  try {
    initialization = await writeDurableJournalValue(
      initializationPath,
      basename(initializationPath),
      (ownerIdentity) => ({
        version: PUBLICATION_JOURNAL_VERSION,
        kind: "directory-publication-initialization",
        creatorPid: process.pid,
        operationToken,
        createdAt: new Date().toISOString(),
        ownerIdentity,
        targetPath: resolve(targetPath),
        temporaryPath: resolve(staged.temporaryPath),
        journalPath: resolve(path),
        initializationPath: resolve(initializationPath),
        liveOwnerPath: resolve(liveOwnerPath),
        handoff: handoffRecord,
        ownerBoundary: ownerBoundaryRecord(staged.ownerBoundary),
        proof: serializedProof,
        proofDigest: digestBytes(proofBytes),
      }),
      `${label} publication initialization`,
      assertPath,
    );
  } catch (error) {
    throw concurrentChange(`${label} publication initialization could not be reserved.`, [
      error.message,
      `Collision preserved: ${initializationPath}`,
    ]);
  }
  await syncDirectory(dirname(initializationPath), assertPath);
  await assertBoundary(assertPath, path);
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    await removeExactRegularEntry(
      initializationPath,
      initialization.entry,
      `${label} publication initialization`,
      assertPath,
    );
    throw concurrentChange(`${label} publication journal could not be reserved: ${path}`, [
      error.message,
    ]);
  }
  await assertBoundary(assertPath, path);
  const root = await captureCreatedDirectory(
    path,
    `${label} publication journal`,
    assertPath,
  );
  const journal = {
    path,
    root,
    initializationPath,
    initializationExternal: initialization.entry,
    initializationMarker: null,
    liveOwner: null,
    liveOwnerBytes: null,
    heldLiveOwner: null,
    liveOwnerPath,
    liveOwnerValue: null,
    intent: null,
    intentBytes: null,
    intentValue: null,
    receipt: null,
  };
  if (onLiveOwnerClaim) onLiveOwnerClaim(journal);
  await syncDirectory(path, assertPath);
  await syncDirectory(dirname(path), assertPath);
  if (afterJournalMkdir) {
    await afterJournalMkdir({ journalPath: path, targetPath, operationToken });
  }
  await link(initializationPath, join(path, PUBLICATION_INITIALIZATION_NAME));
  journal.initializationMarker = await captureRegularEntry(
    join(path, PUBLICATION_INITIALIZATION_NAME),
    PUBLICATION_INITIALIZATION_NAME,
    `${label} publication initialization marker`,
  );
  if (!sameEntryIdentityAndBytes(
    journal.initializationMarker,
    { ...initialization.entry, name: PUBLICATION_INITIALIZATION_NAME },
  )) {
    throw concurrentChange(`${label} publication initialization marker was replaced.`);
  }
  await syncDirectory(path, assertPath);

  const liveOwnerValue = {
    version: PUBLICATION_JOURNAL_VERSION,
    creatorPid: process.pid,
    operationToken,
    targetPath: resolve(targetPath),
    journalPath: resolve(path),
    liveOwnerPath: resolve(liveOwnerPath),
  };
  const liveOwnerBytes = Buffer.from(`${JSON.stringify(liveOwnerValue)}\n`, "utf8");
  await assertDirectoryRoot(
    path,
    root,
    `${label} publication journal`,
    [PUBLICATION_INITIALIZATION_NAME],
  );
  const liveOwner = await writeDurableJournalEntry(
    join(path, PUBLICATION_LIVE_OWNER_NAME),
    PUBLICATION_LIVE_OWNER_NAME,
    liveOwnerBytes,
    `${label} live publication owner`,
    assertPath,
  );
  journal.liveOwner = liveOwner;
  journal.liveOwnerBytes = liveOwnerBytes;
  journal.liveOwnerValue = liveOwnerValue;
  await syncDirectory(path, assertPath);
  await assertBoundary(assertPath, liveOwnerPath);
  try {
    await link(join(path, PUBLICATION_LIVE_OWNER_NAME), liveOwnerPath);
  } catch (error) {
    throw concurrentChange(`${label} live publication owner could not be claimed.`, [
      error.message,
      `Owner claim preserved: ${liveOwnerPath}`,
    ]);
  }
  const heldLiveOwner = await captureRegularEntry(
    liveOwnerPath,
    basename(liveOwnerPath),
    `${label} held live publication owner`,
  );
  if (!sameEntryIdentityAndBytes(heldLiveOwner, liveOwner)) {
    throw concurrentChange(`${label} live publication owner claim was replaced.`);
  }
  journal.heldLiveOwner = heldLiveOwner;
  await syncDirectory(dirname(liveOwnerPath), assertPath);
  if (afterLiveOwnerClaim) {
    await afterLiveOwnerClaim({ journalPath: path, targetPath, operationToken });
  }

  const intentValue = {
    version: PUBLICATION_JOURNAL_VERSION,
    operationToken,
    creatorPid: process.pid,
    createdAt: new Date().toISOString(),
    reservationMarkerName: `${PUBLICATION_RESERVATION_MARKER_PREFIX}${operationToken}`,
    targetPath: resolve(targetPath),
    temporaryPath: resolve(staged.temporaryPath),
    journalPath: resolve(path),
    journalRoot: root,
    liveOwner: {
      path: resolve(liveOwnerPath),
      identity: liveOwner.identity,
      mode: liveOwner.mode,
      digest: digestBytes(liveOwnerBytes),
    },
    handoff: handoffRecord,
    ownerBoundary: ownerBoundaryRecord(staged.ownerBoundary),
    proof: serializedProof,
    proofDigest: digestBytes(proofBytes),
  };
  const intentBytes = Buffer.from(`${JSON.stringify(intentValue)}\n`, "utf8");
  await assertDirectoryRoot(
    path,
    root,
    `${label} publication journal`,
    [PUBLICATION_INITIALIZATION_NAME, PUBLICATION_LIVE_OWNER_NAME],
  );
  const intent = await writeDurableJournalEntry(
    join(path, PUBLICATION_INTENT_NAME),
    PUBLICATION_INTENT_NAME,
    intentBytes,
    `${label} publication intent`,
    assertPath,
  );
  await syncDirectory(path, assertPath);
  await syncDirectory(dirname(path), assertPath);
  journal.intent = intent;
  journal.intentBytes = intentBytes;
  journal.intentValue = intentValue;
  await removeExactRegularEntry(
    join(path, PUBLICATION_INITIALIZATION_NAME),
    initializationMarker,
    `${label} publication initialization marker`,
    assertPath,
  );
  journal.initializationMarker = null;
  await releasePublicationInitialization(journal, label, assertPath);
  return journal;
}

async function writeReservationReceipt(
  journal,
  targetPath,
  reservation,
  proof,
  label,
  assertPath,
  afterReceiptWrite = null,
) {
  await assertDirectoryRoot(
    journal.path,
    journal.root,
    `${label} publication journal`,
    [PUBLICATION_INTENT_NAME, PUBLICATION_LIVE_OWNER_NAME],
  );
  if (!(await regularEntryMatches(
    join(journal.path, PUBLICATION_INTENT_NAME),
    journal.intent,
    `${label} publication intent`,
  ))) {
    throw concurrentChange(`${label} publication intent changed before its receipt was written.`);
  }
  if (!(await regularEntryMatches(
    join(journal.path, PUBLICATION_LIVE_OWNER_NAME),
    journal.liveOwner,
    `${label} live publication owner`,
  ))) {
    throw concurrentChange(`${label} live publication owner changed before its receipt was written.`);
  }
  const ownerMarkerName = `${PUBLICATION_OWNER_MARKER_PREFIX}${journal.intentValue.operationToken}`;
  const terminalPath = publicationTerminalPath(targetPath);
  const written = await writeDurableJournalValue(
    join(journal.path, PUBLICATION_RECEIPT_NAME),
    PUBLICATION_RECEIPT_NAME,
    (ownerIdentity) => ({
      version: PUBLICATION_JOURNAL_VERSION,
      creatorPid: journal.intentValue.creatorPid,
      operationToken: journal.intentValue.operationToken,
      targetPath: resolve(targetPath),
      temporaryPath: journal.intentValue.temporaryPath,
      journalPath: journal.intentValue.journalPath,
      journalRoot: journal.root,
      ownerIdentity,
      ownerMarkerName,
      terminalPath,
      reservationMarkerName: journal.intentValue.reservationMarkerName,
      intentIdentity: journal.intent.identity,
      intentDigest: digestBytes(journal.intentBytes),
      liveOwner: journal.intentValue.liveOwner,
      proof: journal.intentValue.proof,
      proofDigest: journal.intentValue.proofDigest,
      handoff: journal.intentValue.handoff,
      ownerBoundary: journal.intentValue.ownerBoundary,
      reservation: {
        identity: reservation.identity,
        mode: reservation.mode,
      },
      entryNames: proof.entries.map((entry) => entry.name),
    }),
    `${label} reservation receipt`,
    assertPath,
  );
  await syncDirectory(journal.path, assertPath);
  journal.receipt = written.entry;
  journal.receiptBytes = written.bytes;
  journal.receiptValue = written.value;
  journal.terminalPath = terminalPath;
  if (afterReceiptWrite) {
    await afterReceiptWrite({
      journalPath: journal.path,
      targetPath,
      terminalPath,
    });
  }
  await assertBoundary(assertPath, terminalPath);
  try {
    await link(join(journal.path, PUBLICATION_RECEIPT_NAME), terminalPath);
  } catch (error) {
    throw concurrentChange(`${label} terminal receipt could not be claimed.`, [
      error.message,
      `Terminal collision preserved: ${terminalPath}`,
    ]);
  }
  const terminalCandidate = await captureRegularEntry(
    terminalPath,
    basename(terminalPath),
    `${label} terminal receipt`,
  );
  if (!sameEntryIdentityAndBytes(
    terminalCandidate,
    { ...written.entry, name: basename(terminalPath) },
  )) {
    throw concurrentChange(`${label} terminal receipt was replaced.`);
  }
  await syncDirectory(dirname(terminalPath), assertPath);
  journal.terminal = terminalCandidate;
  return written.entry;
}

async function removePublicationJournal(journal, label, assertPath) {
  const state = await lstatIfPresent(journal.path);
  if (!state) return { removed: true, concurrent: false, details: [] };
  if (!state.isDirectory()
    || state.isSymbolicLink()
    || !sameIdentity(entryIdentity(state), journal.root.identity)
    || modeOf(state) !== journal.root.mode) {
    return {
      removed: false,
      concurrent: true,
      details: [`Newer ${label} publication journal preserved: ${journal.path}`],
    };
  }
  const expectedEntries = [
    journal.initializationMarker,
    journal.liveOwner,
    journal.intent,
    journal.receipt,
  ].filter(Boolean);
  const expectedByName = new Map(expectedEntries.map((entry) => [entry.name, entry]));
  const names = (await readdir(journal.path)).sort((left, right) => {
    if (left === PUBLICATION_RECEIPT_NAME) return 1;
    if (right === PUBLICATION_RECEIPT_NAME) return -1;
    return left.localeCompare(right);
  });
  if (names.some((name) => !expectedByName.has(name))) {
    return {
      removed: false,
      concurrent: true,
      details: [`Newer ${label} publication journal content preserved: ${journal.path}`],
    };
  }
  for (const name of names) {
    const entry = expectedByName.get(name);
    const path = join(journal.path, name);
    if (!(await regularEntryMatches(path, entry, `${label} publication journal`))) {
      return {
        removed: false,
        concurrent: true,
        details: [`Newer ${label} publication journal entry preserved: ${path}`],
      };
    }
    await assertBoundary(assertPath, path);
    if (!(await regularEntryMatches(path, entry, `${label} publication journal`))) {
      return {
        removed: false,
        concurrent: true,
        details: [`Newer ${label} publication journal entry preserved: ${path}`],
      };
    }
    await unlink(path);
    await syncDirectory(journal.path, assertPath);
  }
  await assertDirectoryRoot(
    journal.path,
    journal.root,
    `${label} publication journal`,
    [],
  );
  await rmdir(journal.path);
  await syncDirectory(dirname(journal.path), assertPath);
  return { removed: true, concurrent: false, details: [] };
}

async function observePublicationLiveOwner(
  journalPath,
  expected,
  creatorPid,
  operationToken,
  label,
  assertPath = null,
) {
  const path = typeof expected?.path === "string" ? resolve(expected.path) : null;
  if (!path) throw concurrentChange(`${label} has no durable held-token path.`);
  await assertBoundary(assertPath, path);
  const state = await lstatIfPresent(path);
  if (!state) return { held: false, entry: null };
  const entry = await captureRegularEntry(path, basename(path), label);
  let value;
  try {
    value = JSON.parse(entry.bytes.toString("utf8"));
  } catch {
    throw concurrentChange(`${label} is not valid JSON: ${path}`);
  }
  if (!sameIdentity(entry.identity, expected?.identity)
    || entry.mode !== expected?.mode
    || digestBytes(entry.bytes) !== expected?.digest
    || value?.version !== PUBLICATION_JOURNAL_VERSION
    || value.creatorPid !== creatorPid
    || value.operationToken !== operationToken
    || value.targetPath === undefined
    || value.liveOwnerPath !== expected.path
    || value.journalPath !== resolve(journalPath)) {
    throw concurrentChange(`${label} does not match its durable operation token: ${path}`);
  }
  return { held: true, entry };
}

async function releasePublicationInitialization(journal, label, assertPath) {
  if (!journal?.initializationExternal || !journal.initializationPath) return;
  await removeExactRegularEntry(
    journal.initializationPath,
    journal.initializationExternal,
    `${label} publication initialization`,
    assertPath,
  );
  journal.initializationExternal = null;
}

async function acquirePublicationRecoveryClaim(
  targetPath,
  journalPath,
  sourceOperationToken,
  boundary,
  label,
  assertPath,
) {
  const path = publicationRecoveryClaimPath(targetPath);
  await assertBoundary(assertPath, path);
  for (;;) {
    await assertBoundary(assertPath, path);
    const existingState = await lstatIfPresent(path);
    if (existingState) {
      let existing;
      let value;
      try {
        existing = await captureRegularEntry(
          path,
          PUBLICATION_RECOVERY_CLAIM_NAME,
          `${label} publication recovery claim`,
        );
        value = JSON.parse(existing.bytes.toString("utf8"));
      } catch (error) {
        throw concurrentChange(`${label} publication recovery claim is unauthenticated.`, [
          error.message,
          `Collision preserved: ${path}`,
        ]);
      }
      if (value?.version !== PUBLICATION_JOURNAL_VERSION
        || value.kind !== "directory-publication-recovery-claim"
        || !validOperationToken(value.recoveryToken)
        || !Number.isSafeInteger(value.creatorPid)
        || value.creatorPid <= 0
        || value.targetPath !== resolve(targetPath)
        || value.journalPath !== resolve(journalPath)
        || value.sourceOperationToken !== sourceOperationToken
        || !sameIdentity(value.ownerIdentity, existing.identity)
        || !sameOwnerBoundaryRecord(boundary, value.ownerBoundary)) {
        throw concurrentChange(`${label} publication recovery claim does not match this operation.`, [
          `Collision preserved: ${path}`,
        ]);
      }
      if (publicationOwnerIsLive(value.creatorPid, value.recoveryToken, true)) {
        throw concurrentChange(`${label} publication recovery is owned by a live operation.`, [
          `Recovery owner token: ${value.recoveryToken}`,
          `Recovery claim retained: ${path}`,
        ]);
      }
      await removeExactRegularEntry(
        path,
        existing,
        `${label} released publication recovery claim`,
        assertPath,
      );
      continue;
    }

    const recoveryToken = randomUUID();
    let written;
    try {
      written = await writeDurableJournalValue(
        path,
        PUBLICATION_RECOVERY_CLAIM_NAME,
        (ownerIdentity) => ({
          version: PUBLICATION_JOURNAL_VERSION,
          kind: "directory-publication-recovery-claim",
          creatorPid: process.pid,
          recoveryToken,
          sourceOperationToken,
          targetPath: resolve(targetPath),
          journalPath: resolve(journalPath),
          ownerIdentity,
          ownerBoundary: ownerBoundaryRecord(boundary),
        }),
        `${label} publication recovery claim`,
        assertPath,
      );
    } catch (error) {
      if (error?.code === "EEXIST") continue;
      throw error;
    }
    await syncDirectory(dirname(path), assertPath);
    livePublicationOperations.add(recoveryToken);
    return {
      path,
      entry: written.entry,
      value: written.value,
      recoveryToken,
    };
  }
}

async function assertPublicationRecoveryClaim(claim, label, assertPath) {
  if (!claim || !livePublicationOperations.has(claim.recoveryToken)) {
    throw concurrentChange(`${label} publication recovery claim is no longer current.`);
  }
  await assertBoundary(assertPath, claim.path);
  if (!(await regularEntryMatches(
    claim.path,
    claim.entry,
    `${label} publication recovery claim`,
  ))) {
    throw concurrentChange(`${label} publication recovery claim is no longer current.`);
  }
  await assertBoundary(assertPath, claim.path);
  if (!(await regularEntryMatches(
    claim.path,
    claim.entry,
    `${label} publication recovery claim`,
  ))) {
    throw concurrentChange(`${label} publication recovery claim changed before commit.`);
  }
}

async function releasePublicationRecoveryClaim(claim, label, assertPath) {
  if (!claim) return;
  try {
    await removeExactRegularEntry(
      claim.path,
      claim.entry,
      `${label} publication recovery claim`,
      assertPath,
    );
  } finally {
    livePublicationOperations.delete(claim.recoveryToken);
  }
}

async function releasePublicationLiveOwner(journal, label, assertPath) {
  if (!journal?.heldLiveOwner || !journal.liveOwnerPath) return;
  const path = journal.liveOwnerPath;
  const current = await lstatIfPresent(path);
  if (!current) {
    journal.heldLiveOwner = null;
    return;
  }
  if (!(await regularEntryMatches(
    path,
    journal.heldLiveOwner,

    `${label} held live publication owner`,
  ))) {
    throw concurrentChange(`${label} live publication owner was replaced before release.`);
  }
  await assertBoundary(assertPath, path);
  if (!(await regularEntryMatches(
    path,
    journal.heldLiveOwner,
    `${label} held live publication owner`,
  ))) {
    throw concurrentChange(`${label} live publication owner was replaced before release.`);
  }
  await unlink(path);
  await syncDirectory(dirname(path), assertPath);
  journal.heldLiveOwner = null;
}
async function releasePublicationTerminal(journal, label, assertPath) {
  if (!journal?.terminal || !journal.terminalPath) return;
  const assertTerminalLink = async () => {
    await assertBoundary(assertPath, journal.terminalPath);
    const state = await lstatIfPresent(journal.terminalPath);
    if (!state?.isFile()
      || state.isSymbolicLink()
      || !sameIdentity(entryIdentity(state), journal.terminal.identity)
      || modeOf(state) !== journal.terminal.mode
      || !(await regularEntryMatches(
        journal.terminalPath,
        journal.terminal,
        `${label} terminal receipt`,
      ))) {
      throw concurrentChange(`${label} terminal receipt was replaced before release.`);
    }
  };
  await assertTerminalLink();
  await assertTerminalLink();
  await unlink(journal.terminalPath);
  await syncDirectory(dirname(journal.terminalPath), assertPath);
  journal.terminal = null;
}

async function removeCommittedFlatDirectory(path, proof, label, assertPath) {
  const state = await lstatIfPresent(path);
  if (!state) return { removed: true, concurrent: false, details: [] };
  if (!state.isDirectory()
    || state.isSymbolicLink()
    || !sameIdentity(entryIdentity(state), proof.root.identity)
    || modeOf(state) !== proof.root.mode) {
    return {
      removed: false,
      concurrent: true,
      details: [`Newer ${label} preserved: ${path}`],
    };
  }
  const entriesByName = new Map(proof.entries.map((entry) => [entry.name, entry]));
  const names = (await readdir(path)).sort((left, right) => left.localeCompare(right));
  if (names.some((name) => !entriesByName.has(name))) {
    return {
      removed: false,
      concurrent: true,
      details: [`Newer ${label} content preserved: ${path}`],
    };
  }
  for (const name of names) {
    const entry = entriesByName.get(name);
    const entryPath = join(path, name);
    if (!(await regularEntryMatches(entryPath, entry, label))) {
      return {
        removed: false,
        concurrent: true,
        details: [`Newer ${label} entry preserved: ${entryPath}`],
      };
    }
    await assertBoundary(assertPath, entryPath);
    if (!(await regularEntryMatches(entryPath, entry, label))) {
      return {
        removed: false,
        concurrent: true,
        details: [`Newer ${label} entry preserved: ${entryPath}`],
      };
    }
    await unlink(entryPath);
    await syncDirectory(path, assertPath);
  }
  await assertDirectoryRoot(path, proof.root, label, []);
  await rmdir(path);
  await syncDirectory(dirname(path), assertPath);
  return { removed: true, concurrent: false, details: [] };
}

function sameEntryIdentityAndBytes(left, right) {
  return left?.mode === right?.mode
    && sameIdentity(left?.identity, right?.identity)
    && Buffer.isBuffer(left?.bytes)
    && Buffer.isBuffer(right?.bytes)
    && left.bytes.equals(right.bytes);
}

async function restorePublicationOwnerMarkerFromTerminal(
  targetPath,
  sources,
  boundary,
  label,
  assertPath,
) {
  const terminalPath = publicationTerminalPath(targetPath);
  const [terminalState, targetState] = await Promise.all([
    lstatIfPresent(terminalPath),
    lstatIfPresent(targetPath),
  ]);
  if (!terminalState || !targetState) return false;
  if (!targetState.isDirectory() || targetState.isSymbolicLink()) return false;
  let terminal;
  let receiptValue;
  try {
    terminal = await captureRegularEntry(
      terminalPath,
      basename(terminalPath),
      `${label} terminal receipt`,
    );
    receiptValue = JSON.parse(terminal.bytes.toString("utf8"));
  } catch {
    return false;
  }
  const proof = hydratedProof(receiptValue?.proof);
  const proofBytes = receiptValue?.proof
    ? Buffer.from(JSON.stringify(receiptValue.proof), "utf8")
    : Buffer.alloc(0);
  const root = { identity: entryIdentity(targetState), mode: modeOf(targetState) };
  const markerName = receiptValue?.ownerMarkerName;
  const temporaryPath = typeof receiptValue?.temporaryPath === "string"
    ? resolve(receiptValue.temporaryPath)
    : null;
  const handoffRoot = typeof receiptValue?.handoff?.root === "string"
    ? resolve(receiptValue.handoff.root)
    : null;
  const handoffEntry = typeof receiptValue?.handoff?.entry === "string"
    ? resolve(receiptValue.handoff.entry)
    : null;
  if (receiptValue?.version !== PUBLICATION_JOURNAL_VERSION
    || terminalState.nlink !== 1n
    || !validOperationToken(receiptValue.operationToken)
    || !Number.isSafeInteger(receiptValue.creatorPid)
    || receiptValue.creatorPid <= 0
    || receiptValue.targetPath !== resolve(targetPath)
    || receiptValue.terminalPath !== terminalPath
    || receiptValue.journalPath !== publicationJournalPath(targetPath)
    || markerName !== `${PUBLICATION_OWNER_MARKER_PREFIX}${receiptValue.operationToken}`
    || !sameIdentity(receiptValue.ownerIdentity, terminal.identity)
    || !sameIdentity(receiptValue.reservation?.identity, root.identity)
    || receiptValue.reservation?.mode !== root.mode
    || !sameOwnerBoundaryRecord(boundary, receiptValue.ownerBoundary)
    || !temporaryPath
    || dirname(temporaryPath) !== dirname(targetPath)
    || !basename(temporaryPath).startsWith(`.${basename(targetPath)}.sdd-new-`)
    || !handoffRoot
    || dirname(handoffRoot) !== dirname(targetPath)
    || !basename(handoffRoot).startsWith(`.${basename(temporaryPath)}.sdd-cleanup-`)
    || handoffEntry !== join(handoffRoot, "entry")
    || !validIdentity(receiptValue.handoff?.identity)
    || !Number.isInteger(receiptValue.handoff?.mode)
    || !validIdentity(receiptValue.handoff?.entryRoot?.identity)
    || !Number.isInteger(receiptValue.handoff?.entryRoot?.mode)
    || !validIdentity(receiptValue.journalRoot?.identity)
    || !Number.isInteger(receiptValue.journalRoot?.mode)
    || !validIdentity(receiptValue.liveOwner?.identity)
    || !Number.isInteger(receiptValue.liveOwner?.mode)
    || typeof receiptValue.liveOwner?.digest !== "string"
    || !proof
    || !proofMatchesSources(proof, sources)
    || receiptValue.proofDigest !== digestBytes(proofBytes)
    || JSON.stringify(receiptValue.entryNames)
      !== JSON.stringify(proof.entries.map((entry) => entry.name))
    || receiptValue.liveOwner?.path
      !== publicationLiveOwnerPath(targetPath, receiptValue.operationToken)) {
    return false;
  }
  const durableOwner = await observePublicationLiveOwner(
    receiptValue.journalPath,
    receiptValue.liveOwner,
    receiptValue.creatorPid,
    receiptValue.operationToken,
    `${label} live publication owner`,
    assertPath,
  );
  if (publicationOwnerIsLive(
    receiptValue.creatorPid,
    receiptValue.operationToken,
    durableOwner.held,
  )) {
    throw concurrentChange(`${label} publication is still owned by a live operation.`, [
      `Publication owner token: ${receiptValue.operationToken}`,
      `Terminal receipt retained: ${terminalPath}`,
    ]);
  }
  const names = (await readdir(targetPath)).sort((left, right) => left.localeCompare(right));
  const expectedNames = proof.entries.map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) return false;
  for (const entry of proof.entries) {
    if (!(await regularEntryMatches(
      join(targetPath, entry.name),
      entry,
      `${label} terminal destination`,
    ))) return false;
  }
  await assertBoundary(assertPath, targetPath);
  await assertDirectoryRoot(targetPath, root, `${label} terminal destination`, expectedNames);
  const markerPath = join(targetPath, markerName);
  await assertBoundary(assertPath, markerPath);
  try {
    await link(terminalPath, markerPath);
  } catch (error) {
    throw concurrentChange(`${label} terminal owner-marker restoration collided.`, [
      error.message,
      `Collision preserved: ${markerPath}`,
    ]);
  }
  const restored = await captureRegularEntry(
    markerPath,
    markerName,
    `${label} restored publication owner marker`,
  );
  if (!sameEntryIdentityAndBytes(restored, { ...terminal, name: markerName })) {
    throw concurrentChange(`${label} restored publication owner marker was replaced.`);
  }
  await syncDirectory(targetPath, assertPath);
  return true;
}

async function removeTerminalPublicationWithoutTarget(
  targetPath,
  sources,
  boundary,
  label,
  assertPath,
) {
  const terminalPath = publicationTerminalPath(targetPath);
  const terminal = await captureRegularEntry(
    terminalPath,
    basename(terminalPath),
    `${label} terminal receipt`,
  );
  let receiptValue;
  try {
    receiptValue = JSON.parse(terminal.bytes.toString("utf8"));
  } catch (error) {
    throw recoveryFailure(
      label,
      [`Terminal receipt is invalid: ${error.message}`],
      [terminalPath],
      [error],
    );
  }
  const proof = hydratedProof(receiptValue?.proof);
  const proofBytes = receiptValue?.proof
    ? Buffer.from(JSON.stringify(receiptValue.proof), "utf8")
    : Buffer.alloc(0);
  const temporaryPath = typeof receiptValue?.temporaryPath === "string"
    ? resolve(receiptValue.temporaryPath)
    : null;
  const handoffRoot = typeof receiptValue?.handoff?.root === "string"
    ? resolve(receiptValue.handoff.root)
    : null;
  const handoffEntry = typeof receiptValue?.handoff?.entry === "string"
    ? resolve(receiptValue.handoff.entry)
    : null;
  const state = await lstat(terminalPath, { bigint: true });
  if (receiptValue?.version !== PUBLICATION_JOURNAL_VERSION
    || state.nlink !== 1n
    || !validOperationToken(receiptValue.operationToken)
    || !Number.isSafeInteger(receiptValue.creatorPid)
    || receiptValue.creatorPid <= 0
    || receiptValue.targetPath !== resolve(targetPath)
    || receiptValue.terminalPath !== terminalPath
    || receiptValue.journalPath !== publicationJournalPath(targetPath)
    || receiptValue.ownerMarkerName
      !== `${PUBLICATION_OWNER_MARKER_PREFIX}${receiptValue.operationToken}`
    || !sameIdentity(receiptValue.ownerIdentity, terminal.identity)
    || !sameOwnerBoundaryRecord(boundary, receiptValue.ownerBoundary)
    || !validIdentity(receiptValue.reservation?.identity)
    || !Number.isInteger(receiptValue.reservation?.mode)
    || !validIdentity(receiptValue.journalRoot?.identity)
    || !Number.isInteger(receiptValue.journalRoot?.mode)
    || !temporaryPath
    || dirname(temporaryPath) !== dirname(targetPath)
    || !basename(temporaryPath).startsWith(`.${basename(targetPath)}.sdd-new-`)
    || !handoffRoot
    || dirname(handoffRoot) !== dirname(targetPath)
    || !basename(handoffRoot).startsWith(`.${basename(temporaryPath)}.sdd-cleanup-`)
    || handoffEntry !== join(handoffRoot, "entry")
    || !validIdentity(receiptValue.handoff?.identity)
    || !Number.isInteger(receiptValue.handoff?.mode)
    || !validIdentity(receiptValue.handoff?.entryRoot?.identity)
    || !Number.isInteger(receiptValue.handoff?.entryRoot?.mode)
    || !validIdentity(receiptValue.liveOwner?.identity)
    || !Number.isInteger(receiptValue.liveOwner?.mode)
    || typeof receiptValue.liveOwner?.digest !== "string"
    || receiptValue.liveOwner?.path
      !== publicationLiveOwnerPath(targetPath, receiptValue.operationToken)
    || !proof
    || !proofMatchesSources(proof, sources)
    || receiptValue.proofDigest !== digestBytes(proofBytes)
    || JSON.stringify(receiptValue.entryNames)
      !== JSON.stringify(proof.entries.map((entry) => entry.name))) {
    throw recoveryFailure(
      label,
      ["Terminal-only publication receipt does not authenticate the requested operation."],
      [terminalPath],
    );
  }
  const durableOwner = await observePublicationLiveOwner(
    receiptValue.journalPath,
    receiptValue.liveOwner,
    receiptValue.creatorPid,
    receiptValue.operationToken,
    `${label} terminal publication owner`,
    assertPath,
  );
  if (publicationOwnerIsLive(
    receiptValue.creatorPid,
    receiptValue.operationToken,
    durableOwner.held,
  )) {
    throw concurrentChange(`${label} publication is still owned by a live operation.`, [
      `Publication owner token: ${receiptValue.operationToken}`,
      `Terminal receipt retained: ${terminalPath}`,
    ]);
  }
  await releasePublicationLiveOwner({
    heldLiveOwner: durableOwner.entry,
    liveOwnerPath: receiptValue.liveOwner.path,
  }, label, assertPath);
  await releasePublicationTerminal({ terminal, terminalPath }, label, assertPath);
  return true;
}

async function capturePublicationOwnerMarker(
  targetPath,
  sources,
  label,
  assertPath,
) {
  const state = await lstatIfPresent(targetPath);
  if (!state?.isDirectory() || state.isSymbolicLink()) return null;
  const names = (await readdir(targetPath)).sort((left, right) => left.localeCompare(right));
  const markerNames = names.filter((name) => name.startsWith(PUBLICATION_OWNER_MARKER_PREFIX));
  if (markerNames.length !== 1) return null;
  const markerName = markerNames[0];
  let marker;
  let receiptValue;
  try {
    marker = await captureRegularEntry(
      join(targetPath, markerName),
      markerName,
      `${label} publication owner marker`,
    );
    receiptValue = JSON.parse(marker.bytes.toString("utf8"));
  } catch {
    return null;
  }
  const proof = hydratedProof(receiptValue?.proof);
  const proofBytes = receiptValue?.proof
    ? Buffer.from(JSON.stringify(receiptValue.proof), "utf8")
    : Buffer.alloc(0);
  const root = { identity: entryIdentity(state), mode: modeOf(state) };
  if (receiptValue?.version !== PUBLICATION_JOURNAL_VERSION
    || !Number.isSafeInteger(receiptValue.creatorPid)
    || receiptValue.creatorPid <= 0
    || !validOperationToken(receiptValue.operationToken)
    || receiptValue.targetPath !== resolve(targetPath)
    || receiptValue.ownerMarkerName !== markerName
    || markerName
      !== `${PUBLICATION_OWNER_MARKER_PREFIX}${receiptValue.operationToken}`
    || receiptValue.terminalPath !== publicationTerminalPath(targetPath)
    || !sameIdentity(receiptValue.ownerIdentity, marker.identity)
    || !sameIdentity(receiptValue.reservation?.identity, root.identity)
    || receiptValue.reservation?.mode !== root.mode
    || !validIdentity(receiptValue.journalRoot?.identity)
    || !Number.isInteger(receiptValue.journalRoot?.mode)
    || !proof
    || !proofMatchesSources(proof, sources)
    || receiptValue.proofDigest !== digestBytes(proofBytes)
    || JSON.stringify(receiptValue.entryNames)
      !== JSON.stringify(proof.entries.map((entry) => entry.name))) {
    return null;
  }
  let terminal = null;
  const terminalState = await lstatIfPresent(receiptValue.terminalPath);
  if (terminalState) {
    try {
      terminal = await captureRegularEntry(
        receiptValue.terminalPath,
        basename(receiptValue.terminalPath),
        `${label} terminal receipt`,
      );
    } catch {
      return null;
    }
    if (!sameEntryIdentityAndBytes(
      terminal,
      { ...marker, name: basename(receiptValue.terminalPath) },
    )) return null;
  }
  const expectedNames = [...receiptValue.entryNames, markerName]
    .sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) return null;
  for (const entry of proof.entries) {
    if (!(await regularEntryMatches(
      join(targetPath, entry.name),
      entry,
      `${label} published destination`,
    ))) {
      return null;
    }
  }
  await assertBoundary(assertPath, targetPath);
  await assertDirectoryRoot(targetPath, root, `${label} published destination`, expectedNames);
  return {
    root,
    marker,
    markerName,
    receiptValue,
    proof: { root, entries: proof.entries },
    sourceProof: proof,
    terminal,
    terminalPath: receiptValue.terminalPath,
  };
}

async function assertCommittedPublicationCurrent(committed, label, assertPath) {
  const expectedNames = [
    committed.marker.name,
    ...committed.sourceProof.entries.map((entry) => entry.name),
  ];
  await assertBoundary(assertPath, committed.receiptValue.targetPath);
  await assertDirectoryRoot(
    committed.receiptValue.targetPath,
    committed.root,
    `${label} committed destination`,
    expectedNames,
  );
  if (!(await regularEntryMatches(
    join(committed.receiptValue.targetPath, committed.marker.name),
    committed.marker,
    `${label} publication owner marker`,
  ))) {
    throw concurrentChange(`${label} publication owner marker changed before final decision.`);
  }
  for (const entry of committed.sourceProof.entries) {
    if (!(await regularEntryMatches(
      join(committed.receiptValue.targetPath, entry.name),
      entry,
      `${label} committed destination`,
    ))) {
      throw concurrentChange(`${label} committed destination changed before final decision.`);
    }
  }
}

async function removePublicationOwnerMarker(targetPath, committed, label, assertPath) {
  const markerPath = join(targetPath, committed.marker.name);
  await assertDirectoryRoot(
    targetPath,
    committed.root,
    `${label} publication owner marker`,
  );
  await assertBoundary(assertPath, markerPath);
  if (!(await regularEntryMatches(
    markerPath,
    committed.marker,
    `${label} publication owner marker`,
  ))) {
    throw concurrentChange(
      `${label} publication owner marker cleanup detected a concurrent replacement.`,
    );
  }
  await assertBoundary(assertPath, markerPath);
  if (!(await regularEntryMatches(
    markerPath,
    committed.marker,
    `${label} publication owner marker`,
  ))) {
    throw concurrentChange(
      `${label} publication owner marker cleanup detected a concurrent replacement.`,
    );
  }
  await unlink(markerPath);
  await syncDirectory(targetPath, assertPath);
}

async function removeCommittedPublicationJournal(
  journalPath,
  committed,
  label,
  assertPath,
) {
  const state = await lstatIfPresent(journalPath);
  if (!state) return { removed: true, concurrent: false, details: [] };
  if (!state.isDirectory()
    || state.isSymbolicLink()
    || !sameIdentity(entryIdentity(state), committed.receiptValue.journalRoot.identity)
    || modeOf(state) !== committed.receiptValue.journalRoot.mode) {
    return {
      removed: false,
      concurrent: true,
      details: [`Newer ${label} publication journal preserved: ${journalPath}`],
    };
  }
  const names = (await readdir(journalPath)).sort((left, right) => left.localeCompare(right));
  if (names.some((name) => ![
    PUBLICATION_INTENT_NAME,
    PUBLICATION_LIVE_OWNER_NAME,
    PUBLICATION_RECEIPT_NAME,
  ].includes(name))) {
    return {
      removed: false,
      concurrent: true,
      details: [`Newer ${label} publication journal content preserved: ${journalPath}`],
    };
  }
  let intent = null;
  if (names.includes(PUBLICATION_INTENT_NAME)) {
    intent = await captureRegularEntry(
      join(journalPath, PUBLICATION_INTENT_NAME),
      PUBLICATION_INTENT_NAME,
      `${label} publication intent`,
    );
    if (!sameIdentity(intent.identity, committed.receiptValue.intentIdentity)
      || digestBytes(intent.bytes) !== committed.receiptValue.intentDigest) {
      return {
        removed: false,
        concurrent: true,
        details: [`Newer ${label} publication intent preserved: ${journalPath}`],
      };
    }
  }
  let liveOwner = null;
  if (names.includes(PUBLICATION_LIVE_OWNER_NAME)) {
    liveOwner = await captureRegularEntry(
      join(journalPath, PUBLICATION_LIVE_OWNER_NAME),
      PUBLICATION_LIVE_OWNER_NAME,
      `${label} journal live publication owner`,
    );
    if (!sameIdentity(liveOwner.identity, committed.receiptValue.liveOwner.identity)
      || liveOwner.mode !== committed.receiptValue.liveOwner.mode
      || digestBytes(liveOwner.bytes) !== committed.receiptValue.liveOwner.digest) {
      return {
        removed: false,
        concurrent: true,
        details: [`Newer ${label} journal live-owner entry preserved: ${journalPath}`],
      };
    }
  }
  let receipt = null;
  if (names.includes(PUBLICATION_RECEIPT_NAME)) {
    receipt = await captureRegularEntry(
      join(journalPath, PUBLICATION_RECEIPT_NAME),
      PUBLICATION_RECEIPT_NAME,
      `${label} reservation receipt`,
    );
    if (!sameEntryIdentityAndBytes(receipt, {
      ...committed.marker,
      name: PUBLICATION_RECEIPT_NAME,
    })) {
      return {
        removed: false,
        concurrent: true,
        details: [`Newer ${label} reservation receipt preserved: ${journalPath}`],
      };
    }
  }
  return removePublicationJournal({
    path: journalPath,
    root: committed.receiptValue.journalRoot,
    liveOwner,
    intent,
    receipt,
  }, label, assertPath);
}

async function finishCommittedPublicationRecovery(
  committed,
  boundary,
  journalPath,
  label,
  assertPath,
  defer = false,
  {
    ownedOperationToken = null,
    afterSourceCleanup = null,
    afterHandoffCleanup = null,
    afterJournalCleanup = null,
    afterOwnerMarkerCleanup = null,
    beforeCommit = null,
    recoveryClaim = null,
  } = {},
) {
  const { receiptValue, sourceProof } = committed;
  const targetPath = receiptValue.targetPath;
  const temporaryPath = typeof receiptValue.temporaryPath === "string"
    ? resolve(receiptValue.temporaryPath)
    : null;
  const handoffRoot = typeof receiptValue.handoff?.root === "string"
    ? resolve(receiptValue.handoff.root)
    : null;
  const handoffEntry = typeof receiptValue.handoff?.entry === "string"
    ? resolve(receiptValue.handoff.entry)
    : null;
  const entryRoot = receiptValue.handoff?.entryRoot;
  const validPaths = receiptValue.journalPath === journalPath
    && sameOwnerBoundaryRecord(boundary, receiptValue.ownerBoundary)
    && temporaryPath
    && dirname(temporaryPath) === dirname(targetPath)
    && basename(temporaryPath).startsWith(`.${basename(targetPath)}.sdd-new-`)
    && handoffRoot
    && dirname(handoffRoot) === dirname(targetPath)
    && basename(handoffRoot).startsWith(`.${basename(temporaryPath)}.sdd-cleanup-`)
    && handoffEntry === join(handoffRoot, "entry")
    && validIdentity(receiptValue.handoff?.identity)
    && Number.isInteger(receiptValue.handoff?.mode)
    && validIdentity(entryRoot?.identity)
    && Number.isInteger(entryRoot?.mode)
    && validIdentity(receiptValue.liveOwner?.identity)
    && Number.isInteger(receiptValue.liveOwner?.mode)
    && typeof receiptValue.liveOwner?.digest === "string"
    && receiptValue.liveOwner?.path
      === publicationLiveOwnerPath(targetPath, receiptValue.operationToken)
    && receiptValue.terminalPath === publicationTerminalPath(targetPath);
  const retainedPaths = [
    targetPath,
    journalPath,
    receiptValue.terminalPath,
    ...(temporaryPath ? [temporaryPath] : []),
    ...(handoffRoot ? [handoffRoot] : []),
    ...(typeof receiptValue.liveOwner?.path === "string"
      ? [resolve(receiptValue.liveOwner.path)]
      : []),
  ];
  if (!validPaths) {
    throw recoveryFailure(
      label,
      ["Committed publication marker does not match its owner boundary or transaction paths."],
      retainedPaths,
    );
  }
  const durableOwner = await observePublicationLiveOwner(
    journalPath,
    receiptValue.liveOwner,
    receiptValue.creatorPid,
    receiptValue.operationToken,
    `${label} live publication owner`,
    assertPath,
  );
  const ownedLiveOperation = ownedOperationToken === receiptValue.operationToken
    && livePublicationOperations.has(receiptValue.operationToken);
  if (!ownedLiveOperation && publicationOwnerIsLive(
    receiptValue.creatorPid,
    receiptValue.operationToken,
    durableOwner.held,
  )) {
    throw concurrentChange(`${label} publication is still owned by a live operation.`, [
      `Publication owner token: ${receiptValue.operationToken}`,
      `Publication journal retained: ${journalPath}`,
    ]);
  }
  await assertCommittedPublicationCurrent(committed, label, assertPath);
  let heldRecoveryClaim = recoveryClaim;
  let acquiredRecoveryClaim = false;
  if (!ownedLiveOperation) {
    if (heldRecoveryClaim) {
      await assertPublicationRecoveryClaim(heldRecoveryClaim, label, assertPath);
    } else {
      heldRecoveryClaim = await acquirePublicationRecoveryClaim(
        targetPath,
        journalPath,
        receiptValue.operationToken,
        boundary,
        label,
        assertPath,
      );
      acquiredRecoveryClaim = true;
    }
  }
  try {
    await assertCommittedPublicationCurrent(committed, label, assertPath);
  } catch (error) {
    if (acquiredRecoveryClaim) {
      try {
        await releasePublicationRecoveryClaim(heldRecoveryClaim, label, assertPath);
      } catch (releaseError) {
        throw cleanupFailure(label, error, [releaseError], [
          `Publication recovery claim retained: ${heldRecoveryClaim.path}`,
        ]);
      }
    }
    throw error;
  }
  const authenticatedPublication = {
    path: targetPath,
    proof: committed.proof,
    label,
    assertPath,
  };
  if (defer) {
    return {
      recovered: true,
      committed: true,
      targetPath,
      journalPath,
      publication: authenticatedPublication,
      assertCurrent: async () => {
        await assertPublicationRecoveryClaim(heldRecoveryClaim, label, assertPath);
        await assertCommittedPublicationCurrent(committed, label, assertPath);
      },
      finalize: (options = {}) => finishCommittedPublicationRecovery(
        committed,
        boundary,
        journalPath,
        label,
        assertPath,
        false,
        { ...options, recoveryClaim: heldRecoveryClaim },
      ),
      rollback: () => rollbackCommittedPublicationRecovery(
        committed,
        boundary,
        journalPath,
        label,
        assertPath,
        heldRecoveryClaim,
      ),
    };
  }

  const details = [];
  const errors = [];
  const temporaryState = await lstatIfPresent(temporaryPath);
  if (temporaryState) {
    const outcome = await removeCommittedFlatDirectory(
      temporaryPath,
      sourceProof,
      `${label} recovery temporary directory`,
      assertPath,
    );
    details.push(...outcome.details);
    if (!outcome.removed || outcome.concurrent) {
      errors.push(concurrentChange(`${label} recovery retained the temporary source.`));
    }
  }
  if (errors.length === 0 && afterSourceCleanup) {
    await afterSourceCleanup({ temporaryPath, targetPath });
  }

  const handoffState = await lstatIfPresent(handoffRoot);
  if (errors.length === 0 && handoffState) {
    if (!handoffState.isDirectory()
      || handoffState.isSymbolicLink()
      || !sameIdentity(entryIdentity(handoffState), receiptValue.handoff.identity)
      || modeOf(handoffState) !== receiptValue.handoff.mode) {
      errors.push(concurrentChange(`${label} recovery handoff root was replaced.`));
    } else if (await lstatIfPresent(handoffEntry)) {
      const outcome = await removeCommittedFlatDirectory(
        handoffEntry,
        { root: entryRoot, entries: sourceProof.entries },
        `${label} recovery handoff`,
        assertPath,
      );
      details.push(...outcome.details);
      if (!outcome.removed || outcome.concurrent) {
        errors.push(concurrentChange(`${label} recovery retained the handoff entry.`));
      }
    }
  }
  if (errors.length === 0 && handoffState) {
    const released = await releaseQuarantineSlot(
      {
        root: handoffRoot,
        entry: handoffEntry,
        identity: receiptValue.handoff.identity,
        mode: receiptValue.handoff.mode,
      },
      `${label} recovery handoff`,
      assertPath,
    );
    details.push(...released.details);
    if (!released.removed || released.concurrent) {
      errors.push(concurrentChange(`${label} recovery retained the handoff root.`));
    }
  }
  if (errors.length === 0 && afterHandoffCleanup) {
    await afterHandoffCleanup({ handoffPath: handoffRoot, targetPath });
  }

  if (errors.length === 0) {
    const journalOutcome = await removeCommittedPublicationJournal(
      journalPath,
      committed,
      label,
      assertPath,
    );
    details.push(...journalOutcome.details);
    if (!journalOutcome.removed || journalOutcome.concurrent) {
      errors.push(concurrentChange(`${label} recovery retained the publication journal.`));
    }
  }
  if (errors.length === 0 && afterJournalCleanup) {
    await afterJournalCleanup({ journalPath, targetPath });
  }
  if (errors.length > 0) {
    throw recoveryFailure(label, details, retainedPaths, errors);
  }

  await removePublicationOwnerMarker(targetPath, committed, label, assertPath);
  if (afterOwnerMarkerCleanup) {
    await afterOwnerMarkerCleanup({ targetPath, terminalPath: committed.terminalPath });
  }
  const publication = {
    path: targetPath,
    proof: committed.proof,
    label,
    assertPath,
  };
  await assertPublishedFlatDirectory(publication);
  if (beforeCommit) {
    await beforeCommit({ targetPath, journalPath, publication });
  }
  await releasePublicationRecoveryClaim(heldRecoveryClaim, label, assertPath);
  await releasePublicationLiveOwner({
    heldLiveOwner: durableOwner.entry,
    liveOwnerPath: receiptValue.liveOwner.path,
  }, label, assertPath);
  await releasePublicationTerminal({
    terminal: committed.terminal,
    terminalPath: committed.terminalPath,
  }, label, assertPath);
  return {
    recovered: true,
    published: true,
    targetPath,
    journalPath,
    publication,
  };
}

async function rollbackCommittedPublicationRecovery(
  committed,
  boundary,
  journalPath,
  label,
  assertPath,
  recoveryClaim = null,
) {
  const targetPath = committed.receiptValue.targetPath;
  if (recoveryClaim) {
    await assertPublicationRecoveryClaim(recoveryClaim, label, assertPath);
  }
  if (!(await lstatIfPresent(join(targetPath, committed.marker.name)))
    && await lstatIfPresent(committed.terminalPath)) {
    await restorePublicationOwnerMarkerFromTerminal(
      targetPath,
      committed.sourceProof.entries.map((entry) => [entry.name, entry.bytes]),
      boundary,
      label,
      assertPath,
    );
  }
  await assertCommittedPublicationCurrent(committed, label, assertPath);
  const targetOutcome = await removeCommittedFlatDirectory(
    targetPath,
    {
      root: committed.root,
      entries: [committed.marker, ...committed.sourceProof.entries],
    },
    `${label} rejected committed destination`,
    assertPath,
  );
  if (!targetOutcome.removed || targetOutcome.concurrent) {
    throw recoveryFailure(
      label,
      targetOutcome.details,
      [targetPath, journalPath],
    );
  }
  if (!(await lstatIfPresent(journalPath))) {
    const durableOwner = await observePublicationLiveOwner(
      journalPath,
      committed.receiptValue.liveOwner,
      committed.receiptValue.creatorPid,
      committed.receiptValue.operationToken,
      `${label} rejected publication owner`,
      assertPath,
    );
    await releasePublicationRecoveryClaim(recoveryClaim, label, assertPath);
    await releasePublicationLiveOwner({
      heldLiveOwner: durableOwner.entry,
      liveOwnerPath: committed.receiptValue.liveOwner.path,
    }, label, assertPath);
    await releasePublicationTerminal({
      terminal: committed.terminal,
      terminalPath: committed.terminalPath,
    }, label, assertPath);
    return {
      removed: true,
      concurrent: false,
      details: targetOutcome.details,
    };
  }
  await releasePublicationRecoveryClaim(recoveryClaim, label, assertPath);
  const sources = committed.sourceProof.entries.map((entry) => [entry.name, entry.bytes]);
  const recovered = await recoverFlatDirectoryPublication(targetPath, sources, {
    label,
    assertPath,
    ownerRoot: boundary.logicalOwnerRoot,
  });
  if (recovered.committed) {
    throw recoveryFailure(
      label,
      ["Rejected committed publication unexpectedly remained visible after rollback."],
      [targetPath, journalPath],
    );
  }
  return {
    removed: true,
    concurrent: false,
    details: targetOutcome.details,
  };
}

function stagingSourceRecords(sources) {
  return sources.map(([name, source]) => {
    const bytes = Buffer.from(source, "utf8");
    return { name, length: bytes.length, digest: digestBytes(bytes) };
  });
}

function stagingSourcesMatch(records, sources) {
  return JSON.stringify(records) === JSON.stringify(stagingSourceRecords(sources));
}

function stagingTemporaryPath(targetPath, operationToken) {

  return join(
    dirname(targetPath),
    `.${basename(targetPath)}.sdd-new-${operationToken}`,
  );
}
async function captureStagingReservation(
  targetPath,
  sources,
  boundary,
  assertPath,
) {
  const path = stagingReservationPath(targetPath);
  await assertBoundary(assertPath, path);
  const entry = await captureRegularEntry(path, basename(path), "Staging reservation");
  let value;
  try {
    value = JSON.parse(entry.bytes.toString("utf8"));
  } catch (error) {
    throw recoveryFailure(
      "Directory staging",
      [`Staging reservation is invalid: ${error.message}`],
      [path],
    );
  }
  if (value?.version !== PUBLICATION_JOURNAL_VERSION
    || value.kind !== "directory-staging-reservation"
    || !validOperationToken(value.operationToken)
    || !Number.isSafeInteger(value.creatorPid)
    || value.creatorPid <= 0
    || !sameIdentity(value.ownerIdentity, entry.identity)
    || value.targetPath !== targetPath
    || value.temporaryPath !== stagingTemporaryPath(targetPath, value.operationToken)
    || value.journalPath !== stagingJournalPath(targetPath)
    || value.liveOwnerPath !== stagingLiveOwnerPath(targetPath, value.operationToken)
    || !sameOwnerBoundaryRecord(boundary, value.ownerBoundary)
    || !stagingSourcesMatch(value.sources, sources)) {
    throw recoveryFailure(
      "Directory staging",
      ["Staging reservation does not bind its owner, target, and source bytes."],
      [path],
    );
  }
  return { path, entry, value };
}

async function removeExactRegularEntry(path, expected, label, assertPath) {
  await assertBoundary(assertPath, path);
  if (!(await regularEntryMatches(path, expected, label))) {
    throw concurrentChange(`${label} was replaced before cleanup: ${path}`);
  }
  await assertBoundary(assertPath, path);
  if (!(await regularEntryMatches(path, expected, label))) {
    throw concurrentChange(`${label} was replaced before cleanup: ${path}`);
  }
  await unlink(path);
  await syncDirectory(dirname(path), assertPath);
}

async function recoverStagingJournal(
  targetPath,
  sources,
  reservation,
  boundary,
  journalPath,
  label,
  assertPath,
) {
  const retainedPaths = [journalPath, targetPath];
  retainedPaths.push(reservation.path);
  const journalRoot = await captureCreatedDirectory(
    journalPath,
    `${label} staging recovery journal`,
    assertPath,
  );
  const names = (await readdir(journalPath)).sort((left, right) =>
    left.localeCompare(right));
  const payloadNames = names.filter((name) => name.startsWith(STAGING_PAYLOAD_PREFIX));
  const progressNames = names.filter((name) => name.startsWith(STAGING_PROGRESS_PREFIX));
  if (!names.includes(PUBLICATION_LIVE_OWNER_NAME)
    || !names.includes(STAGING_INTENT_NAME)
    || names.some((name) => ![
      PUBLICATION_LIVE_OWNER_NAME,
      STAGING_INTENT_NAME,
      ...payloadNames,
      STAGING_ROOT_NAME,
      ...progressNames,
    ].includes(name))) {
    throw recoveryFailure(
      label,
      ["Staging journal contains unauthenticated entries."],
      retainedPaths,
    );
  }
  const liveOwner = await captureRegularEntry(
    join(journalPath, PUBLICATION_LIVE_OWNER_NAME),
    PUBLICATION_LIVE_OWNER_NAME,
    `${label} staging live owner`,
  );
  const intent = await captureRegularEntry(
    join(journalPath, STAGING_INTENT_NAME),
    STAGING_INTENT_NAME,
    `${label} staging intent`,
  );
  let intentValue;
  try {
    intentValue = JSON.parse(intent.bytes.toString("utf8"));
  } catch (error) {
    throw recoveryFailure(label, [`Staging intent is invalid: ${error.message}`], retainedPaths);
  }
  const validIntent = intentValue?.version === PUBLICATION_JOURNAL_VERSION
    && intentValue.kind === "directory-staging"
    && intentValue.operationToken === reservation.value.operationToken
    && intentValue.creatorPid === reservation.value.creatorPid
    && validOperationToken(intentValue.operationToken)
    && Number.isSafeInteger(intentValue.creatorPid)
    && intentValue.creatorPid > 0
    && intentValue.targetPath === targetPath
    && intentValue.journalPath === journalPath
    && intentValue.temporaryPath
      === stagingTemporaryPath(targetPath, intentValue.operationToken)
    && sameIdentity(intentValue.journalRoot?.identity, journalRoot.identity)
    && intentValue.journalRoot?.mode === journalRoot.mode
    && intentValue.reservation?.path === reservation.path
    && sameIdentity(intentValue.reservation?.identity, reservation.entry.identity)
    && intentValue.reservation?.mode === reservation.entry.mode
    && intentValue.reservation?.digest === digestBytes(reservation.entry.bytes)
    && sameOwnerBoundaryRecord(boundary, intentValue.ownerBoundary)
    && stagingSourcesMatch(intentValue.sources, sources)
    && intentValue.liveOwner?.path
      === stagingLiveOwnerPath(targetPath, intentValue.operationToken)
    && sameIdentity(intentValue.liveOwner?.identity, liveOwner.identity)
    && intentValue.liveOwner?.mode === liveOwner.mode
    && intentValue.liveOwner?.digest === digestBytes(liveOwner.bytes);
  if (!validIntent) {
    throw recoveryFailure(
      label,
      ["Staging intent does not bind the requested target, source bytes, and owner."],
      retainedPaths,
    );
  }
  retainedPaths.push(intentValue.temporaryPath, intentValue.liveOwner.path);
  const durableOwner = await observePublicationLiveOwner(
    journalPath,
    intentValue.liveOwner,
    intentValue.creatorPid,
    intentValue.operationToken,
    `${label} staging live owner`,
    assertPath,
  );
  if (publicationOwnerIsLive(
    intentValue.creatorPid,
    intentValue.operationToken,
    durableOwner.held,
  )) {
    throw concurrentChange(`${label} staging is still owned by a live operation.`, [
      `Staging owner token: ${intentValue.operationToken}`,
      `Staging journal retained: ${journalPath}`,
    ]);
  }

  const journalEntries = [liveOwner, intent];
  const payloads = [];
  for (const [payloadIndex, payloadName] of payloadNames.entries()) {
    const expectedName = `${STAGING_PAYLOAD_PREFIX}${String(payloadIndex).padStart(4, "0")}`;
    if (payloadName !== expectedName) {
      throw recoveryFailure(label, ["Staging payload is not a contiguous owned prefix."], retainedPaths);
    }
    const payload = await captureRegularEntry(
      join(journalPath, payloadName),
      payloadName,
      `${label} staging payload`,
    );
    const source = intentValue.sources[payloadIndex];
    if (!source
      || payload.bytes.length !== source.length
      || digestBytes(payload.bytes) !== source.digest) {
      throw recoveryFailure(label, ["Staging payload does not match its write-ahead source."], retainedPaths);
    }
    payloads.push(payload);
    journalEntries.push(payload);
  }
  if (progressNames.length > payloads.length) {
    throw recoveryFailure(label, ["Staging progress has no authenticated payload."], retainedPaths);
  }
  let rootBinding = null;
  let rootValue = null;
  if (names.includes(STAGING_ROOT_NAME)) {
    rootBinding = await captureRegularEntry(
      join(journalPath, STAGING_ROOT_NAME),
      STAGING_ROOT_NAME,
      `${label} staging root binding`,
    );
    journalEntries.push(rootBinding);
    try {
      rootValue = JSON.parse(rootBinding.bytes.toString("utf8"));
    } catch (error) {
      throw recoveryFailure(label, [`Staging root binding is invalid: ${error.message}`], retainedPaths);
    }
    if (rootValue?.version !== PUBLICATION_JOURNAL_VERSION
      || rootValue.operationToken !== intentValue.operationToken
      || !sameIdentity(rootValue.ownerIdentity, rootBinding.identity)
      || !sameIdentity(rootValue.intentIdentity, intent.identity)
      || rootValue.intentDigest !== digestBytes(intent.bytes)
      || !validIdentity(rootValue.root?.identity)
      || !Number.isInteger(rootValue.root?.mode)) {
      throw recoveryFailure(label, ["Staging root binding was replaced."], retainedPaths);
    }
  }

  const sourceRecords = intentValue.sources;
  const progress = [];
  for (const [progressIndex, progressName] of progressNames.entries()) {
    const expectedName = `${STAGING_PROGRESS_PREFIX}${String(progressIndex).padStart(4, "0")}.json`;
    if (progressName !== expectedName) {
      throw recoveryFailure(label, ["Staging progress is not a contiguous owned prefix."], retainedPaths);
    }
    const entry = await captureRegularEntry(
      join(journalPath, progressName),
      progressName,
      `${label} staging progress`,
    );
    journalEntries.push(entry);
    let value;
    try {
      value = JSON.parse(entry.bytes.toString("utf8"));
    } catch (error) {
      throw recoveryFailure(label, [`Staging progress is invalid: ${error.message}`], retainedPaths);
    }
    if (value?.version !== PUBLICATION_JOURNAL_VERSION
      || value.operationToken !== intentValue.operationToken
      || !sameIdentity(value.ownerIdentity, entry.identity)
      || value.entryIndex !== progressIndex
      || value.entryName !== sourceRecords[progressIndex]?.name
      || value.entryDigest !== sourceRecords[progressIndex]?.digest
      || value.payloadName !== payloads[progressIndex]?.name
      || !sameIdentity(value.payloadIdentity, payloads[progressIndex]?.identity)
      || value.payloadMode !== payloads[progressIndex]?.mode
      || value.payloadDigest !== digestBytes(payloads[progressIndex]?.bytes)
      || !sameIdentity(value.entryIdentity, payloads[progressIndex]?.identity)
      || value.entryMode !== payloads[progressIndex]?.mode
      || !validIdentity(value.entryIdentity)
      || !Number.isInteger(value.entryMode)
      || !rootBinding
      || !sameIdentity(value.rootBindingIdentity, rootBinding.identity)
      || value.rootBindingDigest !== digestBytes(rootBinding.bytes)) {
      throw recoveryFailure(label, ["Staging progress was replaced."], retainedPaths);
    }
    progress.push(value);
  }

  const temporaryState = await lstatIfPresent(intentValue.temporaryPath);
  if (temporaryState) {
    if (!temporaryState.isDirectory() || temporaryState.isSymbolicLink()) {
      throw recoveryFailure(
        label,
        ["Staging reservation was replaced; the replacement was preserved."],
        retainedPaths,
      );
    }
    const markerPath = join(intentValue.temporaryPath, STAGING_ROOT_MARKER_NAME);
    const markerState = await lstatIfPresent(markerPath);
    let marker = null;
    if (markerState) {
      marker = await captureRegularEntry(
        markerPath,
        STAGING_ROOT_MARKER_NAME,
        `${label} staging root marker`,
      );
      if (!sameEntryIdentityAndBytes(
        marker,
        { ...reservation.entry, name: STAGING_ROOT_MARKER_NAME },
      )) {
        throw recoveryFailure(
          label,
          ["Staging root marker was replaced; the replacement was preserved."],
          retainedPaths,
        );
      }
    }
    if (!rootValue) {
      if (!marker || (await readdir(intentValue.temporaryPath)).length !== 1) {
        throw recoveryFailure(
          label,
          ["Staging root has no authenticated binding; it was preserved."],
          retainedPaths,
        );
      }
      const rootProof = {
        root: { identity: entryIdentity(temporaryState), mode: modeOf(temporaryState) },
        entries: [marker],
      };
      const outcome = await removeExactFlatDirectory(
        intentValue.temporaryPath,
        rootProof,
        { label: `${label} staging reserved root`, assertPath },
      );
      if (!outcome.removed || outcome.concurrent) {
        throw recoveryFailure(label, outcome.details, retainedPaths);
      }
    } else {
      if (!sameIdentity(entryIdentity(temporaryState), rootValue.root.identity)
        || modeOf(temporaryState) !== rootValue.root.mode) {
        throw recoveryFailure(
          label,
          ["Staging reservation was replaced; the replacement was preserved."],
          retainedPaths,
        );
      }
      if (marker) {
        await removeExactRegularEntry(
          markerPath,
          marker,
          `${label} staging root marker`,
          assertPath,
        );
      }
      const stagedProof = await captureFlatDirectory(
        intentValue.temporaryPath,
        `${label} staging recovery source`,
      );
      const progressByName = new Map(progress.map((entry) => [entry.entryName, entry]));
      const sourceByName = new Map(sourceRecords.map((entry) => [entry.name, entry]));
      if (!sameIdentity(stagedProof.root.identity, rootValue.root.identity)
        || stagedProof.root.mode !== rootValue.root.mode
        || stagedProof.entries.length > progress.length
        || stagedProof.entries.some((entry) => {
          const source = sourceByName.get(entry.name);
          const stagedProgress = progressByName.get(entry.name);
          return !source
            || !stagedProgress
            || digestBytes(entry.bytes) !== source.digest
            || !sameIdentity(entry.identity, stagedProgress.entryIdentity)
            || entry.mode !== stagedProgress.entryMode;
        })) {
        throw recoveryFailure(
          label,
          ["Staging directory contains unbound or replaced content; it was preserved."],
          retainedPaths,
        );
      }
      const outcome = await removeExactFlatDirectory(
        intentValue.temporaryPath,
        stagedProof,
        { label: `${label} staging recovery source`, assertPath },
      );
      if (!outcome.removed || outcome.concurrent) {
        throw recoveryFailure(label, outcome.details, retainedPaths);
      }
    }
  }

  const journalOutcome = await removeExactFlatDirectory(
    journalPath,
    { root: journalRoot, entries: journalEntries.sort((left, right) =>
      left.name.localeCompare(right.name)) },
    { label: `${label} staging recovery journal`, assertPath },
  );
  if (!journalOutcome.removed || journalOutcome.concurrent) {
    throw recoveryFailure(label, journalOutcome.details, retainedPaths);
  }
  await releasePublicationLiveOwner({
    heldLiveOwner: durableOwner.entry,
    liveOwnerPath: intentValue.liveOwner.path,
  }, `${label} staging`, assertPath);
  await removeExactRegularEntry(
    reservation.path,
    reservation.entry,
    `${label} staging reservation`,
    assertPath,
  );
  return true;
}

async function capturePublicationInitialization(
  targetPath,
  sources,
  boundary,
  label,
  assertPath,
) {
  const path = publicationInitializationPath(targetPath);
  const entry = await captureRegularEntry(
    path,
    basename(path),
    `${label} publication initialization`,
  );
  let value;
  try {
    value = JSON.parse(entry.bytes.toString("utf8"));
  } catch (error) {
    throw recoveryFailure(
      label,
      [`Publication initialization is invalid: ${error.message}`],
      [path],
      [error],
    );
  }
  const proof = hydratedProof(value?.proof);
  const proofBytes = value?.proof
    ? Buffer.from(JSON.stringify(value.proof), "utf8")
    : Buffer.alloc(0);
  const temporaryPath = typeof value?.temporaryPath === "string"
    ? resolve(value.temporaryPath)
    : null;
  const handoffRoot = typeof value?.handoff?.root === "string"
    ? resolve(value.handoff.root)
    : null;
  const handoffEntry = typeof value?.handoff?.entry === "string"
    ? resolve(value.handoff.entry)
    : null;
  if (value?.version !== PUBLICATION_JOURNAL_VERSION
    || value.kind !== "directory-publication-initialization"
    || !validOperationToken(value.operationToken)
    || !Number.isSafeInteger(value.creatorPid)
    || value.creatorPid <= 0
    || !sameIdentity(value.ownerIdentity, entry.identity)
    || value.targetPath !== resolve(targetPath)
    || value.initializationPath !== path
    || value.journalPath !== publicationJournalPath(targetPath)
    || value.liveOwnerPath !== publicationLiveOwnerPath(targetPath, value.operationToken)
    || !sameOwnerBoundaryRecord(boundary, value.ownerBoundary)
    || !proof
    || !proofMatchesSources(proof, sources)
    || value.proofDigest !== digestBytes(proofBytes)
    || !temporaryPath
    || dirname(temporaryPath) !== dirname(targetPath)
    || !basename(temporaryPath).startsWith(`.${basename(targetPath)}.sdd-new-`)
    || !handoffRoot
    || dirname(handoffRoot) !== dirname(targetPath)
    || !basename(handoffRoot).startsWith(`.${basename(temporaryPath)}.sdd-cleanup-`)
    || handoffEntry !== join(handoffRoot, "entry")
    || !validIdentity(value.handoff?.identity)
    || !Number.isInteger(value.handoff?.mode)
    || !validIdentity(value.handoff?.entryRoot?.identity)
    || !Number.isInteger(value.handoff?.entryRoot?.mode)) {
    throw recoveryFailure(
      label,
      ["Publication initialization does not bind the requested target and staged sources."],
      [path],
    );
  }
  return {
    path,
    entry,
    value,
    proof,
    temporaryPath,
    handoffRoot,
    handoffEntry,
  };
}

export async function recoverFlatDirectoryPublication(
  targetPath,
  entries,
  {
    label = "Directory publication",
    assertPath: requestedAssertPath = null,
    ownerRoot,
  } = {},
) {
  const sources = normalizedEntries(entries);
  const absoluteTargetPath = resolve(targetPath);
  const parent = dirname(absoluteTargetPath);
  const journalPath = publicationJournalPath(absoluteTargetPath);
  const initializationPath = publicationInitializationPath(absoluteTargetPath);
  const stagedJournalPath = stagingJournalPath(absoluteTargetPath);
  const stagedReservationPath = stagingReservationPath(absoluteTargetPath);
  const terminalPath = publicationTerminalPath(absoluteTargetPath);
  const [
    journalState,
    initializationState,
    stagedJournalState,
    stagedReservationState,
    terminalState,
    targetStateAtStart,
  ] = await Promise.all([
    lstatIfPresent(journalPath),
    lstatIfPresent(initializationPath),
    lstatIfPresent(stagedJournalPath),
    lstatIfPresent(stagedReservationPath),
    lstatIfPresent(terminalPath),
    lstatIfPresent(absoluteTargetPath),
  ]);
  if (!journalState
    && !initializationState
    && !stagedJournalState
    && !stagedReservationState
    && !terminalState
    && !targetStateAtStart) {
    return { recovered: false, targetPath: absoluteTargetPath };
  }

  const retainedPaths = [
    journalPath,
    initializationPath,
    stagedJournalPath,
    stagedReservationPath,
    terminalPath,
    absoluteTargetPath,
  ];
  let boundary;
  try {
    boundary = await captureOwnerBoundary(ownerRoot, parent, `${label} recovery`);
  } catch (error) {
    throw recoveryFailure(
      label,
      [`Recovery owner boundary could not be authenticated: ${error.message}`],
      retainedPaths,
      [error],
    );
  }
  const assertPath = boundPathAssertion(boundary, requestedAssertPath);
  try {
    await assertBoundary(assertPath, absoluteTargetPath);
    if (journalState) await assertBoundary(assertPath, journalPath);
    if (initializationState) await assertBoundary(assertPath, initializationPath);
    if (stagedJournalState) await assertBoundary(assertPath, stagedJournalPath);
    if (stagedReservationState) await assertBoundary(assertPath, stagedReservationPath);
    if (terminalState) await assertBoundary(assertPath, terminalPath);
  } catch (error) {
    throw recoveryFailure(
      label,
      [`Recovery transaction escaped its authenticated owner: ${error.message}`],
      retainedPaths,
      [error],
    );
  }
  let stagingReservation = null;
  if (stagedReservationState) {
    stagingReservation = await captureStagingReservation(
      absoluteTargetPath,
      sources,
      boundary,
      assertPath,
    );
    if (publicationOwnerIsLive(
      stagingReservation.value.creatorPid,
      stagingReservation.value.operationToken,
      true,
    )) {
      throw concurrentChange(`${label} staging is still owned by a live operation.`, [
        `Staging owner token: ${stagingReservation.value.operationToken}`,
        `Staging reservation retained: ${stagingReservation.path}`,
      ]);
    }
  }
  if (stagedJournalState && !stagingReservation) {
    throw recoveryFailure(
      label,
      ["Staging journal has no authenticated write-ahead reservation."],
      retainedPaths,
    );
  }
  let stagingRecovered = false;
  if (stagedJournalState) {
    if (!stagedJournalState.isDirectory() || stagedJournalState.isSymbolicLink()) {
      throw recoveryFailure(
        label,
        ["Staging journal is not an owned real directory."],
        retainedPaths,
      );
    }
    stagingRecovered = await recoverStagingJournal(
      absoluteTargetPath,
      sources,
      stagingReservation,
      boundary,
      stagedJournalPath,
      label,
      assertPath,
    );
  }
  if (stagingReservation && !stagedJournalState) {
    const stagedTemporaryState = await lstatIfPresent(stagingReservation.value.temporaryPath);
    if (stagedTemporaryState) {
      throw recoveryFailure(
        label,
        ["Staging reservation has an unbound temporary entry; it was preserved."],
        retainedPaths,
      );
    }
    const durableOwner = await observePublicationLiveOwner(
      stagingReservation.value.journalPath,
      {
        path: stagingReservation.value.liveOwnerPath,
        identity: stagingReservation.entry.identity,
        mode: stagingReservation.entry.mode,
        digest: digestBytes(stagingReservation.entry.bytes),
      },
      stagingReservation.value.creatorPid,
      stagingReservation.value.operationToken,
      `${label} terminal staging owner`,
      assertPath,
    );
    await releasePublicationLiveOwner({
      heldLiveOwner: durableOwner.entry,
      liveOwnerPath: stagingReservation.value.liveOwnerPath,
    }, `${label} staging`, assertPath);
    await removeExactRegularEntry(
      stagingReservation.path,
      stagingReservation.entry,
      `${label} staging reservation`,
      assertPath,
    );
    stagingRecovered = true;
  }

  if (initializationState) {
    const initialization = await capturePublicationInitialization(
      absoluteTargetPath,
      sources,
      boundary,
      label,
      assertPath,
    );
    let initializationJournalRoot = null;
    let initializationMarker = null;
    let initializationLiveOwner = null;
    let initializationHeldOwner = null;
    let initializationNames = [];
    if (journalState) {
      if (!journalState.isDirectory() || journalState.isSymbolicLink()) {
        throw recoveryFailure(
          label,
          ["Initialized publication journal is not a real directory."],
          retainedPaths,
        );
      }
      initializationJournalRoot = await captureCreatedDirectory(
        journalPath,
        `${label} initialized publication journal`,
        assertPath,
      );
      initializationNames = (await readdir(journalPath))
        .sort((left, right) => left.localeCompare(right));
      const initializedIntentPresent = initializationNames.includes(PUBLICATION_INTENT_NAME);
      if (!initializationNames.includes(PUBLICATION_INITIALIZATION_NAME)
        && !initializedIntentPresent) {
        throw recoveryFailure(
          label,
          ["Publication initialization is not bound into its journal."],
          retainedPaths,
        );
      }
      if (initializationNames.includes(PUBLICATION_INITIALIZATION_NAME)) {
        initializationMarker = await captureRegularEntry(
          join(journalPath, PUBLICATION_INITIALIZATION_NAME),
          PUBLICATION_INITIALIZATION_NAME,
          `${label} publication initialization marker`,
        );
        if (!sameEntryIdentityAndBytes(
          initializationMarker,
          { ...initialization.entry, name: PUBLICATION_INITIALIZATION_NAME },
        )) {
          throw recoveryFailure(
            label,
            ["Publication initialization marker was replaced."],
            retainedPaths,
          );
        }
      }
      if (initializedIntentPresent) {
        const initializedIntent = await captureRegularEntry(
          join(journalPath, PUBLICATION_INTENT_NAME),
          PUBLICATION_INTENT_NAME,
          `${label} initialized publication intent`,
        );
        let initializedIntentValue;
        try {
          initializedIntentValue = JSON.parse(initializedIntent.bytes.toString("utf8"));
        } catch (error) {
          throw recoveryFailure(
            label,
            [`Initialized publication intent is invalid: ${error.message}`],
            retainedPaths,
            [error],
          );
        }
        if (initializedIntentValue?.version !== PUBLICATION_JOURNAL_VERSION
          || initializedIntentValue.operationToken !== initialization.value.operationToken
          || initializedIntentValue.creatorPid !== initialization.value.creatorPid
          || initializedIntentValue.targetPath !== initialization.value.targetPath
          || initializedIntentValue.temporaryPath !== initialization.value.temporaryPath
          || initializedIntentValue.journalPath !== initialization.value.journalPath
          || initializedIntentValue.proofDigest !== initialization.value.proofDigest
          || JSON.stringify(initializedIntentValue.proof)
            !== JSON.stringify(initialization.value.proof)
          || JSON.stringify(initializedIntentValue.handoff)
            !== JSON.stringify(initialization.value.handoff)
          || JSON.stringify(initializedIntentValue.ownerBoundary)
            !== JSON.stringify(initialization.value.ownerBoundary)) {
          throw recoveryFailure(
            label,
            ["Initialized publication intent does not match its reservation."],
            retainedPaths,
          );
        }
      }
      if (initializationNames.includes(PUBLICATION_LIVE_OWNER_NAME)) {
        initializationLiveOwner = await captureRegularEntry(
          join(journalPath, PUBLICATION_LIVE_OWNER_NAME),
          PUBLICATION_LIVE_OWNER_NAME,
          `${label} initialized live publication owner`,
        );
        let liveOwnerValue;
        try {
          liveOwnerValue = JSON.parse(initializationLiveOwner.bytes.toString("utf8"));
        } catch (error) {
          throw recoveryFailure(
            label,
            [`Initialized live owner is invalid: ${error.message}`],
            retainedPaths,
            [error],
          );
        }
        if (liveOwnerValue?.version !== PUBLICATION_JOURNAL_VERSION
          || liveOwnerValue.creatorPid !== initialization.value.creatorPid
          || liveOwnerValue.operationToken !== initialization.value.operationToken
          || liveOwnerValue.targetPath !== absoluteTargetPath
          || liveOwnerValue.journalPath !== journalPath
          || liveOwnerValue.liveOwnerPath !== initialization.value.liveOwnerPath) {
          throw recoveryFailure(
            label,
            ["Initialized live owner does not match its publication reservation."],
            retainedPaths,
          );
        }
        const expectedLiveOwner = {
          path: initialization.value.liveOwnerPath,
          identity: initializationLiveOwner.identity,
          mode: initializationLiveOwner.mode,
          digest: digestBytes(initializationLiveOwner.bytes),
        };
        const durableOwner = await observePublicationLiveOwner(
          journalPath,
          expectedLiveOwner,
          initialization.value.creatorPid,
          initialization.value.operationToken,
          `${label} initialized live publication owner`,
          assertPath,
        );
        initializationHeldOwner = durableOwner.entry;
      }
    }
    const heldOwnerState = await lstatIfPresent(initialization.value.liveOwnerPath);
    if (!initializationLiveOwner && heldOwnerState) {
      if (journalState) {
        throw recoveryFailure(
          label,
          ["Initialized held owner has no matching journal entry."],
          retainedPaths,
        );
      }
      const heldOwner = await captureRegularEntry(
        initialization.value.liveOwnerPath,
        basename(initialization.value.liveOwnerPath),
        `${label} initialized held publication owner`,
      );
      let heldValue;
      try {
        heldValue = JSON.parse(heldOwner.bytes.toString("utf8"));
      } catch (error) {
        throw recoveryFailure(
          label,
          [`Initialized held owner is invalid: ${error.message}`],
          retainedPaths,
          [error],
        );
      }
      if (heldValue?.version !== PUBLICATION_JOURNAL_VERSION
        || heldValue.creatorPid !== initialization.value.creatorPid
        || heldValue.operationToken !== initialization.value.operationToken
        || heldValue.targetPath !== absoluteTargetPath
        || heldValue.journalPath !== journalPath
        || heldValue.liveOwnerPath !== initialization.value.liveOwnerPath) {
        throw recoveryFailure(
          label,
          ["Initialized held owner does not match its publication reservation."],
          retainedPaths,
        );
      }
      initializationHeldOwner = heldOwner;
    }
    if (publicationOwnerIsLive(
      initialization.value.creatorPid,
      initialization.value.operationToken,
      true,
    )) {
      throw concurrentChange(`${label} publication initialization is still live.`, [
        `Publication owner token: ${initialization.value.operationToken}`,
        `Initialization retained: ${initialization.path}`,
      ]);
    }

    if (initializationNames.includes(PUBLICATION_INTENT_NAME)) {
      if (initializationMarker) {
        await removeExactRegularEntry(
          join(journalPath, PUBLICATION_INITIALIZATION_NAME),
          initializationMarker,
          `${label} publication initialization marker`,
          assertPath,
        );
      }
      await removeExactRegularEntry(
        initialization.path,
        initialization.entry,
        `${label} publication initialization`,
        assertPath,
      );
      stagingRecovered = true;
    } else {
      if (targetStateAtStart) {
        throw recoveryFailure(
          label,
          ["Pre-intent publication initialization unexpectedly has a destination."],
          retainedPaths,
        );
      }
      if (journalState && initializationNames.some((name) => ![
        PUBLICATION_INITIALIZATION_NAME,
        PUBLICATION_LIVE_OWNER_NAME,
      ].includes(name))) {
        throw recoveryFailure(
          label,
          ["Pre-intent publication journal contains unauthenticated entries."],
          retainedPaths,
        );
      }
      const temporaryState = await lstatIfPresent(initialization.temporaryPath);
      if (temporaryState) {
        const outcome = await removeCommittedFlatDirectory(
          initialization.temporaryPath,
          initialization.proof,
          `${label} initialized temporary source`,
          assertPath,
        );
        if (!outcome.removed || outcome.concurrent) {
          throw recoveryFailure(label, outcome.details, retainedPaths);
        }
      }
      const handoffState = await lstatIfPresent(initialization.handoffRoot);
      if (handoffState) {
        if (!handoffState.isDirectory()
          || handoffState.isSymbolicLink()
          || !sameIdentity(entryIdentity(handoffState), initialization.value.handoff.identity)
          || modeOf(handoffState) !== initialization.value.handoff.mode) {
          throw recoveryFailure(
            label,
            ["Initialized publication handoff was replaced."],
            retainedPaths,
          );
        }
        if (await lstatIfPresent(initialization.handoffEntry)) {
          const outcome = await removeCommittedFlatDirectory(
            initialization.handoffEntry,
            {
              root: initialization.value.handoff.entryRoot,
              entries: initialization.proof.entries,
            },
            `${label} initialized publication handoff`,
            assertPath,
          );
          if (!outcome.removed || outcome.concurrent) {
            throw recoveryFailure(label, outcome.details, retainedPaths);
          }
        }
        const released = await releaseQuarantineSlot(
          {
            root: initialization.handoffRoot,
            entry: initialization.handoffEntry,
            identity: initialization.value.handoff.identity,
            mode: initialization.value.handoff.mode,
          },
          `${label} initialized publication handoff`,
          assertPath,
        );
        if (!released.removed || released.concurrent) {
          throw recoveryFailure(label, released.details, retainedPaths);
        }
      }
      if (journalState) {
        const journalOutcome = await removePublicationJournal({
          path: journalPath,
          root: initializationJournalRoot,
          initializationMarker,
          liveOwner: initializationLiveOwner,
          intent: null,
          receipt: null,
        }, label, assertPath);
        if (!journalOutcome.removed || journalOutcome.concurrent) {
          throw recoveryFailure(label, journalOutcome.details, retainedPaths);
        }
      }
      await releasePublicationLiveOwner({
        heldLiveOwner: initializationHeldOwner,
        liveOwnerPath: initialization.value.liveOwnerPath,
      }, label, assertPath);
      await removeExactRegularEntry(
        initialization.path,
        initialization.entry,
        `${label} publication initialization`,
        assertPath,
      );
      return { recovered: true, targetPath: absoluteTargetPath };
    }
  } else if (journalState) {
    const earlyNames = journalState.isDirectory() && !journalState.isSymbolicLink()
      ? await readdir(journalPath)
      : [];
    if (earlyNames.includes(PUBLICATION_INITIALIZATION_NAME)) {
      throw recoveryFailure(
        label,
        ["Publication journal initialization has no authenticated external reservation."],
        retainedPaths,
      );
    }
  }

  if (terminalState) {
    await restorePublicationOwnerMarkerFromTerminal(
      absoluteTargetPath,
      sources,
      boundary,
      label,
      assertPath,
    );
  }
  const committed = await capturePublicationOwnerMarker(
    absoluteTargetPath,
    sources,
    label,
    assertPath,
  );
  if (committed) {
    return finishCommittedPublicationRecovery(
      committed,
      boundary,
      journalPath,
      label,
      assertPath,
      true,
    );
  }
  if (!journalState) {
    if (terminalState) {
      if (await lstatIfPresent(absoluteTargetPath)) {
        throw recoveryFailure(
          label,
          ["Terminal receipt did not authenticate the existing destination; both were preserved."],
          [absoluteTargetPath, terminalPath],
        );
      }
      await removeTerminalPublicationWithoutTarget(
        absoluteTargetPath,
        sources,
        boundary,
        label,
        assertPath,
      );
      stagingRecovered = true;
    }
    return { recovered: stagingRecovered, targetPath: absoluteTargetPath };
  }
  if (!journalState.isDirectory() || journalState.isSymbolicLink()) {
    throw recoveryFailure(
      label,
      ["Publication journal is not an owned real directory."],
      retainedPaths,
    );
  }

  let journalRoot;
  let names;
  let intent;
  let intentValue;
  try {
    journalRoot = await captureCreatedDirectory(
      journalPath,
      `${label} recovery journal`,
      assertPath,
    );
    names = (await readdir(journalPath)).sort((left, right) => left.localeCompare(right));
    const allowedNames = [
      PUBLICATION_INTENT_NAME,
      PUBLICATION_LIVE_OWNER_NAME,
      PUBLICATION_RECEIPT_NAME,
    ];
    if (!names.includes(PUBLICATION_INTENT_NAME)
      || !names.includes(PUBLICATION_LIVE_OWNER_NAME)
      || names.some((name) => !allowedNames.includes(name))) {
      throw concurrentChange(`${label} recovery journal contains unauthenticated entries.`);
    }
    intent = await captureRegularEntry(
      join(journalPath, PUBLICATION_INTENT_NAME),
      PUBLICATION_INTENT_NAME,
      `${label} recovery intent`,
    );
    intentValue = JSON.parse(intent.bytes.toString("utf8"));
  } catch (error) {
    throw recoveryFailure(
      label,
      [`Publication intent could not be authenticated: ${error.message}`],
      retainedPaths,
      [error],
    );
  }

  const proof = hydratedProof(intentValue?.proof);
  const proofBytes = intentValue?.proof
    ? Buffer.from(JSON.stringify(intentValue.proof), "utf8")
    : Buffer.alloc(0);
  const expectedTemporaryPrefix = `.${basename(absoluteTargetPath)}.sdd-new-`;
  const temporaryPath = typeof intentValue?.temporaryPath === "string"
    ? resolve(intentValue.temporaryPath)
    : null;
  const handoffRoot = typeof intentValue?.handoff?.root === "string"
    ? resolve(intentValue.handoff.root)
    : null;
  const handoffEntry = typeof intentValue?.handoff?.entry === "string"
    ? resolve(intentValue.handoff.entry)
    : null;
  if (temporaryPath) retainedPaths.push(temporaryPath);
  if (handoffRoot) retainedPaths.push(handoffRoot);
  const creatorStartedAt = Date.parse(intentValue?.createdAt);
  const validIntent = intentValue?.version === PUBLICATION_JOURNAL_VERSION
    && validOperationToken(intentValue.operationToken)
    && intentValue.reservationMarkerName
      === `${PUBLICATION_RESERVATION_MARKER_PREFIX}${intentValue.operationToken}`
    && Number.isSafeInteger(intentValue.creatorPid)
    && intentValue.creatorPid > 0
    && Number.isFinite(creatorStartedAt)
    && creatorStartedAt <= Date.now() + 60_000
    && intentValue.targetPath === absoluteTargetPath
    && intentValue.journalPath === journalPath
    && sameIdentity(intentValue.journalRoot?.identity, journalRoot.identity)
    && intentValue.journalRoot?.mode === journalRoot.mode
    && validIdentity(intentValue.liveOwner?.identity)
    && Number.isInteger(intentValue.liveOwner?.mode)
    && typeof intentValue.liveOwner?.digest === "string"
    && intentValue.liveOwner?.path
      === publicationLiveOwnerPath(absoluteTargetPath, intentValue.operationToken)
    && sameOwnerBoundaryRecord(boundary, intentValue.ownerBoundary)
    && proof
    && proofMatchesSources(proof, sources)
    && intentValue.proofDigest === digestBytes(proofBytes)
    && temporaryPath
    && dirname(temporaryPath) === parent
    && basename(temporaryPath).startsWith(expectedTemporaryPrefix)
    && handoffRoot
    && dirname(handoffRoot) === parent
    && basename(handoffRoot).startsWith(`.${basename(temporaryPath)}.sdd-cleanup-`)
    && handoffEntry === join(handoffRoot, "entry")
    && validIdentity(intentValue.handoff?.identity)
    && Number.isInteger(intentValue.handoff?.mode)
    && validIdentity(intentValue.handoff?.entryRoot?.identity)
    && Number.isInteger(intentValue.handoff?.entryRoot?.mode);
  if (!validIntent) {
    throw recoveryFailure(
      label,
      ["Publication intent does not match the requested target, staged sources, or owner identities."],
      retainedPaths,
    );
  }
  retainedPaths.push(intentValue.liveOwner.path);
  const journalLiveOwner = await captureRegularEntry(
    join(journalPath, PUBLICATION_LIVE_OWNER_NAME),
    PUBLICATION_LIVE_OWNER_NAME,
    `${label} journal live publication owner`,
  );
  if (!sameIdentity(journalLiveOwner.identity, intentValue.liveOwner.identity)
    || journalLiveOwner.mode !== intentValue.liveOwner.mode
    || digestBytes(journalLiveOwner.bytes) !== intentValue.liveOwner.digest) {
    throw recoveryFailure(
      label,
      ["Journal live-owner proof was replaced; recovery artifacts were preserved."],
      retainedPaths,
    );
  }
  const durableOwner = await observePublicationLiveOwner(
    journalPath,
    intentValue.liveOwner,
    intentValue.creatorPid,
    intentValue.operationToken,
    `${label} live publication owner`,
    assertPath,
  );
  if (publicationOwnerIsLive(
    intentValue.creatorPid,
    intentValue.operationToken,
    durableOwner.held,
  )) {
    throw concurrentChange(`${label} publication is still owned by a live operation.`, [
      `Publication owner token: ${intentValue.operationToken}`,
      `Publication journal retained: ${journalPath}`,
    ]);
  }

  let receipt = null;
  let receiptValue = null;
  if (names.includes(PUBLICATION_RECEIPT_NAME)) {
    try {
      receipt = await captureRegularEntry(
        join(journalPath, PUBLICATION_RECEIPT_NAME),
        PUBLICATION_RECEIPT_NAME,
        `${label} recovery receipt`,
      );
      receiptValue = JSON.parse(receipt.bytes.toString("utf8"));
    } catch (error) {
      throw recoveryFailure(
        label,
        [`Reservation receipt could not be authenticated: ${error.message}`],
        retainedPaths,
        [error],
      );
    }
    const expectedNames = proof.entries.map((entry) => entry.name);
    if (receiptValue?.version !== PUBLICATION_JOURNAL_VERSION
      || receiptValue.creatorPid !== intentValue.creatorPid
      || receiptValue.operationToken !== intentValue.operationToken
      || receiptValue.ownerMarkerName
        !== `${PUBLICATION_OWNER_MARKER_PREFIX}${intentValue.operationToken}`
      || receiptValue.terminalPath !== terminalPath
      || receiptValue.reservationMarkerName !== intentValue.reservationMarkerName
      || !sameIdentity(receiptValue.ownerIdentity, receipt.identity)
      || receiptValue.targetPath !== absoluteTargetPath
      || !sameIdentity(receiptValue.journalRoot?.identity, journalRoot.identity)
      || receiptValue.journalRoot?.mode !== journalRoot.mode
      || !sameIdentity(receiptValue.intentIdentity, intent.identity)
      || receiptValue.intentDigest !== digestBytes(intent.bytes)
      || JSON.stringify(receiptValue.liveOwner)
        !== JSON.stringify(intentValue.liveOwner)
      || receiptValue.proofDigest !== intentValue.proofDigest
      || receiptValue.temporaryPath !== intentValue.temporaryPath
      || receiptValue.journalPath !== intentValue.journalPath
      || JSON.stringify(receiptValue.proof) !== JSON.stringify(intentValue.proof)
      || JSON.stringify(receiptValue.handoff) !== JSON.stringify(intentValue.handoff)
      || JSON.stringify(receiptValue.ownerBoundary)
        !== JSON.stringify(intentValue.ownerBoundary)
      || !validIdentity(receiptValue.reservation?.identity)
      || !Number.isInteger(receiptValue.reservation?.mode)
      || JSON.stringify(receiptValue.entryNames) !== JSON.stringify(expectedNames)) {
      throw recoveryFailure(
        label,
        ["Reservation receipt does not bind the durable publication intent and staged proof."],
        retainedPaths,
      );
    }
  }
  let terminalReceipt = null;
  if (receipt) {
    const observedTerminal = await lstatIfPresent(terminalPath);
    if (observedTerminal) {
      try {
        terminalReceipt = await captureRegularEntry(
          terminalPath,
          basename(terminalPath),
          `${label} recovery terminal receipt`,
        );
      } catch (error) {
        throw recoveryFailure(
          label,
          [`Terminal receipt could not be authenticated: ${error.message}`],
          retainedPaths,
          [error],
        );
      }
      if (!sameEntryIdentityAndBytes(
        terminalReceipt,
        { ...receipt, name: basename(terminalPath) },
      )) {
        throw recoveryFailure(
          label,
          ["Terminal receipt does not match the authenticated reservation receipt."],
          retainedPaths,
        );
      }
    } else {
      const bootstrapTarget = await lstatIfPresent(absoluteTargetPath);
      const reservationMarkerName = receiptValue.reservationMarkerName;
      if (!bootstrapTarget?.isDirectory()
        || bootstrapTarget.isSymbolicLink()
        || !sameIdentity(entryIdentity(bootstrapTarget), receiptValue.reservation.identity)
        || modeOf(bootstrapTarget) !== receiptValue.reservation.mode
        || JSON.stringify(
          (await readdir(absoluteTargetPath)).sort((left, right) => left.localeCompare(right)),
        ) !== JSON.stringify([reservationMarkerName])) {
        throw recoveryFailure(
          label,
          ["Receipt without a terminal claim has no exact destination reservation."],
          retainedPaths,
        );
      }
      const reservationMarker = await captureRegularEntry(
        join(absoluteTargetPath, reservationMarkerName),
        reservationMarkerName,
        `${label} recovery reservation marker`,
      );
      if (!sameEntryIdentityAndBytes(
        reservationMarker,
        { ...intent, name: reservationMarkerName },
      )) {
        throw recoveryFailure(
          label,
          ["Receipt bootstrap reservation marker was replaced."],
          retainedPaths,
        );
      }
      await assertDirectoryRoot(
        absoluteTargetPath,
        {
          identity: receiptValue.reservation.identity,
          mode: receiptValue.reservation.mode,
        },
        `${label} receipt bootstrap reservation`,
        [reservationMarkerName],
      );
      await assertBoundary(assertPath, terminalPath);
      try {
        await link(join(journalPath, PUBLICATION_RECEIPT_NAME), terminalPath);
      } catch (error) {
        throw concurrentChange(`${label} terminal receipt bootstrap collided.`, [
          error.message,
          `Collision preserved: ${terminalPath}`,
        ]);
      }
      terminalReceipt = await captureRegularEntry(
        terminalPath,
        basename(terminalPath),
        `${label} recovery terminal receipt`,
      );
      if (!sameEntryIdentityAndBytes(
        terminalReceipt,
        { ...receipt, name: basename(terminalPath) },
      )) {
        throw recoveryFailure(
          label,
          ["Bootstrapped terminal receipt was replaced."],
          retainedPaths,
        );
      }
      await syncDirectory(dirname(terminalPath), assertPath);
    }
  }

  let targetNames = [];
  let authenticatedOwnerMarker = null;
  let targetRecoveredWithoutReceipt = false;
  const targetState = await lstatIfPresent(absoluteTargetPath);
  if (!receipt && targetState) {
    const markerName = intentValue.reservationMarkerName;
    const targetNamesWithoutReceipt = (await readdir(absoluteTargetPath))
      .sort((left, right) => left.localeCompare(right));
    if (!targetState.isDirectory()
      || targetState.isSymbolicLink()
      || JSON.stringify(targetNamesWithoutReceipt) !== JSON.stringify([markerName])) {
      throw recoveryFailure(
        label,
        ["Receiptless destination has no exact authenticated reservation marker."],
        retainedPaths,
      );
    }
    const marker = await captureRegularEntry(
      join(absoluteTargetPath, markerName),
      markerName,
      `${label} recovery destination reservation marker`,
    );
    if (!sameEntryIdentityAndBytes(marker, { ...intent, name: markerName })) {
      throw recoveryFailure(
        label,
        ["Destination reservation marker was replaced; the replacement was preserved."],
        retainedPaths,
      );
    }
    const outcome = await removeExactFlatDirectory(
      absoluteTargetPath,
      {
        root: { identity: entryIdentity(targetState), mode: modeOf(targetState) },
        entries: [marker],
      },
      { label: `${label} receiptless destination reservation`, assertPath },
    );
    if (!outcome.removed || outcome.concurrent) {
      throw recoveryFailure(label, outcome.details, retainedPaths);
    }
    targetRecoveredWithoutReceipt = true;
  }
  if (receipt && targetState) {
    if (!targetState.isDirectory()
      || targetState.isSymbolicLink()
      || !sameIdentity(entryIdentity(targetState), receiptValue.reservation.identity)
      || modeOf(targetState) !== receiptValue.reservation.mode) {
      throw recoveryFailure(
        label,
        ["Destination reservation was replaced; the replacement was preserved."],
        retainedPaths,
      );
    }
    let allTargetNames = (await readdir(absoluteTargetPath))
      .sort((left, right) => left.localeCompare(right));
    const markerName = receiptValue.ownerMarkerName;
    if (allTargetNames.includes(markerName)) {
      const marker = await captureRegularEntry(
        join(absoluteTargetPath, markerName),
        markerName,
        `${label} recovery owner marker`,
      );
      if (!sameEntryIdentityAndBytes(marker, receipt)) {
        throw recoveryFailure(
          label,
          ["Destination owner marker was replaced; the replacement was preserved."],
          retainedPaths,
        );
      }
      authenticatedOwnerMarker = marker;
    }
    const reservationMarkerName = receiptValue.reservationMarkerName;
    if (allTargetNames.includes(reservationMarkerName)) {
      const reservationMarker = await captureRegularEntry(
        join(absoluteTargetPath, reservationMarkerName),
        reservationMarkerName,
        `${label} recovery reservation marker`,
      );
      if (!sameEntryIdentityAndBytes(
        reservationMarker,
        { ...intent, name: reservationMarkerName },
      )) {
        throw recoveryFailure(
          label,
          ["Destination reservation marker was replaced; the replacement was preserved."],
          retainedPaths,
        );
      }
      await assertDirectoryRoot(
        absoluteTargetPath,
        { identity: receiptValue.reservation.identity, mode: receiptValue.reservation.mode },
        `${label} recovery reservation marker`,
        allTargetNames,
      );
      await removeExactRegularEntry(
        join(absoluteTargetPath, reservationMarkerName),
        reservationMarker,
        `${label} recovery reservation marker`,
        assertPath,
      );
      allTargetNames = allTargetNames.filter((name) => name !== reservationMarkerName);
    }
    targetNames = allTargetNames.filter((name) => name !== markerName);
    const entriesByName = new Map(proof.entries.map((entry) => [entry.name, entry]));
    for (const name of targetNames) {
      const expected = entriesByName.get(name);
      if (!expected
        || !(await regularEntryMatches(
          join(absoluteTargetPath, name),
          expected,
          `${label} recovery destination`,
        ))) {
        throw recoveryFailure(
          label,
          ["Destination contains replaced or unauthenticated content; it was preserved."],
          retainedPaths,
        );
      }
    }
  }

  const temporaryState = await lstatIfPresent(temporaryPath);
  const temporaryExact = temporaryState
    ? await directoryMatchesProof(temporaryPath, proof, `${label} recovery temporary directory`)
    : false;
  if (temporaryState && !temporaryExact) {
    throw recoveryFailure(
      label,
      ["Temporary publication source was replaced; the replacement was preserved."],
      retainedPaths,
    );
  }

  const handoffState = await lstatIfPresent(handoffRoot);
  let handoffExact = false;
  if (handoffState) {
    if (!handoffState.isDirectory()
      || handoffState.isSymbolicLink()
      || !sameIdentity(entryIdentity(handoffState), intentValue.handoff.identity)
      || modeOf(handoffState) !== intentValue.handoff.mode) {
      throw recoveryFailure(
        label,
        ["Publication handoff root was replaced; the replacement was preserved."],
        retainedPaths,
      );
    }
    const handoffNames = (await readdir(handoffRoot))
      .sort((left, right) => left.localeCompare(right));
    if (handoffNames.some((name) => name !== "entry")) {
      throw recoveryFailure(
        label,
        ["Publication handoff contains unauthenticated content; it was preserved."],
        retainedPaths,
      );
    }
    if (handoffNames.includes("entry")) {
      handoffExact = await directoryMatchesProof(
        handoffEntry,
        { root: intentValue.handoff.entryRoot, entries: proof.entries },
        `${label} recovery handoff`,
      );
      if (!handoffExact) {
        throw recoveryFailure(
          label,
          ["Publication handoff entry was replaced; the replacement was preserved."],
          retainedPaths,
        );
      }
    }
  }

  const details = [];
  const recoveryErrors = [];
  if (targetState && !targetRecoveredWithoutReceipt) {
    if (authenticatedOwnerMarker) {
      const markerOutcome = await removeOwnedRegularEntry(
        absoluteTargetPath,
        receiptValue.reservation,
        authenticatedOwnerMarker,
        `${label} recovery owner marker`,
        assertPath,
      );
      details.push(...markerOutcome.details);
      if (!markerOutcome.removed || markerOutcome.concurrent) {
        throw concurrentChange(`${label} recovery retained the owner marker.`);
      }
    }
    try {
      const entriesByName = new Map(proof.entries.map((entry) => [entry.name, entry]));
      const outcome = await rollbackPartialDirectory(
        absoluteTargetPath,
        receiptValue.reservation,
        targetNames.map((name) => entriesByName.get(name)),
        `${label} recovery destination`,
        assertPath,
      );
      details.push(...outcome.details);
      if (!outcome.removed || outcome.concurrent) {
        throw concurrentChange(`${label} destination recovery retained concurrent content.`);
      }
    } catch (error) {
      recoveryErrors.push(error);
    }
  }
  if (recoveryErrors.length === 0 && temporaryExact) {
    try {
      const outcome = await removeCommittedFlatDirectory(
        temporaryPath,
        proof,
        `${label} recovery temporary directory`,
        assertPath,
      );
      details.push(...outcome.details);
      if (!outcome.removed || outcome.concurrent) {
        throw concurrentChange(`${label} temporary recovery retained concurrent content.`);
      }
    } catch (error) {
      recoveryErrors.push(error);
    }
  }
  if (recoveryErrors.length === 0 && handoffExact) {
    try {
      const outcome = await removeCommittedFlatDirectory(
        handoffEntry,
        { root: intentValue.handoff.entryRoot, entries: proof.entries },
        `${label} recovery handoff`,
        assertPath,
      );
      details.push(...outcome.details);
      if (!outcome.removed || outcome.concurrent) {
        throw concurrentChange(`${label} handoff recovery retained concurrent content.`);
      }
    } catch (error) {
      recoveryErrors.push(error);
    }
  }
  if (recoveryErrors.length === 0 && handoffState) {
    try {
      const released = await releaseQuarantineSlot(
        {
          root: handoffRoot,
          entry: handoffEntry,
          identity: intentValue.handoff.identity,
          mode: intentValue.handoff.mode,
        },
        `${label} recovery handoff`,
        assertPath,
      );
      details.push(...released.details);
      if (!released.removed || released.concurrent) {
        throw concurrentChange(`${label} handoff root recovery retained concurrent content.`);
      }
    } catch (error) {
      recoveryErrors.push(error);
    }
  }
  if (recoveryErrors.length > 0) {
    throw recoveryFailure(label, details, retainedPaths, recoveryErrors);
  }

  const journal = {
    path: journalPath,
    root: journalRoot,
    liveOwner: journalLiveOwner,
    heldLiveOwner: durableOwner.entry,
    liveOwnerPath: intentValue.liveOwner.path,
    intent,
    receipt,
    terminal: terminalReceipt,
    terminalPath: receiptValue?.terminalPath ?? null,
  };
  const journalOutcome = await removePublicationJournal(journal, label, assertPath);
  if (!journalOutcome.removed || journalOutcome.concurrent) {
    throw recoveryFailure(
      label,
      [...details, ...journalOutcome.details],
      retainedPaths,
    );
  }
  await releasePublicationLiveOwner(journal, label, assertPath);
  await releasePublicationTerminal(journal, label, assertPath);
  return {
    recovered: true,
    targetPath: absoluteTargetPath,
    journalPath,
  };
}

export async function stageFlatDirectory(
  parent,
  directoryName,
  entries,
  {
    label = "Staged directory",
    assertPath = null,
    ownerRoot,
    afterStageRootMkdir = null,
    afterStageRootReservation = null,
    afterStagedPayload = null,
    afterStagedProgress = null,
    afterStagedEntry = null,
    afterStagingComplete = null,
  } = {},
) {
  const sources = normalizedEntries(entries);
  const targetPath = resolve(parent, directoryName);
  const operationToken = randomUUID();
  const temporaryPath = stagingTemporaryPath(targetPath, operationToken);
  const journalPath = stagingJournalPath(targetPath);
  const liveOwnerPath = stagingLiveOwnerPath(targetPath, operationToken);
  const reservationPath = stagingReservationPath(targetPath);
  const ownerBoundary = await ensureOwnerParent(ownerRoot, parent, label, assertPath);
  const assertMutationPath = boundPathAssertion(ownerBoundary, assertPath);
  livePublicationOperations.add(operationToken);

  let root = null;
  const createdEntries = [];
  let stagingJournal = null;
  let stagingReservation = null;
  let primaryError = null;
  let completed = false;
  try {
    await assertMutationPath(reservationPath);
    stagingReservation = await writeDurableJournalValue(
      reservationPath,
      basename(reservationPath),
      (identity) => ({
        version: PUBLICATION_JOURNAL_VERSION,
        kind: "directory-staging-reservation",
        creatorPid: process.pid,
        operationToken,
        ownerIdentity: identity,
        targetPath,
        temporaryPath,
        journalPath,
        liveOwnerPath,
        ownerBoundary: ownerBoundaryRecord(ownerBoundary),
        sources: stagingSourceRecords(sources),
      }),
      `${label} staging reservation`,
      assertMutationPath,
    );
    await syncDirectory(dirname(reservationPath), assertMutationPath);
    await assertMutationPath(journalPath);
    try {
      await mkdir(journalPath, { mode: 0o700 });
    } catch (error) {
      throw concurrentChange(`${label} staging journal could not be reserved: ${journalPath}`, [
        error.message,
      ]);
    }
    const journalRoot = await captureCreatedDirectory(
      journalPath,
      `${label} staging journal`,
      assertMutationPath,
    );
    const journalOwnerPath = join(journalPath, PUBLICATION_LIVE_OWNER_NAME);
    try {
      await link(reservationPath, journalOwnerPath);
    } catch (error) {
      throw concurrentChange(`${label} staging journal owner could not be bound.`, [
        error.message,
      ]);
    }
    const liveOwner = await captureRegularEntry(
      journalOwnerPath,
      PUBLICATION_LIVE_OWNER_NAME,
      `${label} staging live owner`,
    );
    if (!sameEntryIdentityAndBytes(
      liveOwner,
      { ...stagingReservation.entry, name: PUBLICATION_LIVE_OWNER_NAME },
    )) {
      throw concurrentChange(`${label} staging journal owner was replaced.`);
    }
    stagingJournal = {
      path: journalPath,
      root: journalRoot,
      entries: [liveOwner],
      liveOwner,
      heldLiveOwner: null,
      liveOwnerPath,
      operationToken,
      intent: null,
      reservationPath,
      reservation: stagingReservation.entry,
      reservationValue: stagingReservation.value,
    };
    await syncDirectory(journalPath, assertMutationPath);
    await assertMutationPath(liveOwnerPath);
    try {
      await link(join(journalPath, PUBLICATION_LIVE_OWNER_NAME), liveOwnerPath);
    } catch (error) {
      throw concurrentChange(`${label} staging owner claim could not be reserved.`, [
        error.message,
        `Owner claim preserved: ${liveOwnerPath}`,
      ]);
    }
    const heldLiveOwner = await captureRegularEntry(
      liveOwnerPath,
      basename(liveOwnerPath),
      `${label} held staging owner`,
    );
    if (!sameEntryIdentityAndBytes(heldLiveOwner, liveOwner)) {
      throw concurrentChange(`${label} staging owner claim was replaced.`);
    }
    stagingJournal.heldLiveOwner = heldLiveOwner;
    await syncDirectory(dirname(liveOwnerPath), assertMutationPath);

    const intentValue = {
      version: PUBLICATION_JOURNAL_VERSION,
      kind: "directory-staging",
      creatorPid: process.pid,
      operationToken,
      createdAt: new Date().toISOString(),
      targetPath,
      temporaryPath,
      journalPath,
      journalRoot,
      reservation: {
        path: reservationPath,
        identity: stagingReservation.entry.identity,
        mode: stagingReservation.entry.mode,
        digest: digestBytes(stagingReservation.entry.bytes),
      },
      liveOwner: {
        path: liveOwnerPath,
        identity: liveOwner.identity,
        mode: liveOwner.mode,
        digest: digestBytes(liveOwner.bytes),
      },
      ownerBoundary: ownerBoundaryRecord(ownerBoundary),
      sources: stagingSourceRecords(sources),
    };
    const intentBytes = Buffer.from(`${JSON.stringify(intentValue)}\n`, "utf8");
    const intent = await writeDurableJournalEntry(
      join(journalPath, STAGING_INTENT_NAME),
      STAGING_INTENT_NAME,
      intentBytes,
      `${label} staging intent`,
      assertMutationPath,
    );
    stagingJournal.intent = intent;
    stagingJournal.intentValue = intentValue;
    stagingJournal.entries.push(intent);
    await syncDirectory(journalPath, assertMutationPath);
    await syncDirectory(dirname(journalPath), assertMutationPath);

    await assertMutationPath(temporaryPath);
    await mkdir(temporaryPath);
    const stageRootMarkerPath = join(temporaryPath, STAGING_ROOT_MARKER_NAME);
    await link(reservationPath, stageRootMarkerPath);
    const stageRootMarker = await captureRegularEntry(
      stageRootMarkerPath,
      STAGING_ROOT_MARKER_NAME,
      `${label} staging root marker`,
    );
    if (!sameEntryIdentityAndBytes(
      stageRootMarker,
      { ...stagingReservation.entry, name: STAGING_ROOT_MARKER_NAME },
    )) {
      throw concurrentChange(`${label} staging root marker was replaced.`);
    }
    createdEntries.push(stageRootMarker);
    root = await captureCreatedDirectory(temporaryPath, label, assertMutationPath);
    await syncDirectory(parent, assertMutationPath);
    await syncDirectory(temporaryPath, assertMutationPath);
    if (afterStageRootReservation) {
      await afterStageRootReservation({ temporaryPath, targetPath, operationToken });
    }
    const rootBinding = await writeDurableJournalValue(
      join(journalPath, STAGING_ROOT_NAME),
      STAGING_ROOT_NAME,
      (identity) => ({
        version: PUBLICATION_JOURNAL_VERSION,
        operationToken,
        ownerIdentity: identity,
        intentIdentity: intent.identity,
        intentDigest: digestBytes(intent.bytes),
        root,
      }),
      `${label} staging root binding`,
      assertMutationPath,
    );
    stagingJournal.rootBinding = rootBinding.entry;
    stagingJournal.entries.push(rootBinding.entry);
    await syncDirectory(journalPath, assertMutationPath);
    await removeExactRegularEntry(
      stageRootMarkerPath,
      stageRootMarker,
      `${label} staging root marker`,
      assertMutationPath,
    );
    createdEntries.pop();
    if (afterStageRootMkdir) {
      await afterStageRootMkdir({ temporaryPath, targetPath, operationToken });
    }

    for (const [entryIndex, [name, source]] of sources.entries()) {
      const indexName = String(entryIndex).padStart(4, "0");
      const payloadName = `${STAGING_PAYLOAD_PREFIX}${indexName}`;
      const payloadPath = join(journalPath, payloadName);
      const payload = await writeDurableJournalEntry(
        payloadPath,
        payloadName,
        source,
        `${label} staging payload`,
        assertMutationPath,
        0o666,
      );
      stagingJournal.entries.push(payload);
      await syncDirectory(journalPath, assertMutationPath);
      if (afterStagedPayload) {
        await afterStagedPayload({
          entryIndex,
          entryName: name,
          payloadPath,
          temporaryPath,
          targetPath,
          operationToken,
        });
      }

      const progressName = `${STAGING_PROGRESS_PREFIX}${indexName}.json`;
      const progress = await writeDurableJournalValue(
        join(journalPath, progressName),
        progressName,
        (identity) => ({
          version: PUBLICATION_JOURNAL_VERSION,
          operationToken,
          ownerIdentity: identity,
          entryIndex,
          entryName: name,
          entryIdentity: payload.identity,
          entryMode: payload.mode,
          entryDigest: digestBytes(payload.bytes),
          payloadName,
          payloadIdentity: payload.identity,
          payloadMode: payload.mode,
          payloadDigest: digestBytes(payload.bytes),
          rootBindingIdentity: rootBinding.entry.identity,
          rootBindingDigest: digestBytes(rootBinding.entry.bytes),
        }),
        `${label} staging entry progress`,
        assertMutationPath,
      );
      stagingJournal.entries.push(progress.entry);
      await syncDirectory(journalPath, assertMutationPath);
      if (afterStagedProgress) {
        await afterStagedProgress({
          entryIndex,
          entryName: name,
          payloadPath,
          progressPath: join(journalPath, progressName),
          temporaryPath,
          targetPath,
          operationToken,
        });
      }

      await assertDirectoryRoot(
        temporaryPath,
        root,
        label,
        createdEntries.map((entry) => entry.name),
      );
      const path = join(temporaryPath, name);
      await assertMutationPath(path);
      try {
        await link(payloadPath, path);
      } catch (error) {
        throw concurrentChange(`${label} staged entry could not be claimed without replacement.`, [
          error.message,
        ]);
      }
      const entry = await captureRegularEntry(path, name, label);
      if (!sameEntryIdentityAndBytes(entry, { ...payload, name })) {
        throw concurrentChange(`${label} staged entry changed after its no-replace link: ${path}`);
      }
      createdEntries.push(entry);
      await syncDirectory(temporaryPath, assertMutationPath);
      if (afterStagedEntry) {
        await afterStagedEntry({
          entryIndex,
          entryName: name,
          temporaryPath,
          targetPath,
          operationToken,
        });
      }
    }
    await syncDirectory(temporaryPath, assertMutationPath);
    const proof = await captureFlatDirectory(temporaryPath, label);
    const sourcesByName = new Map(sources);
    if (proof.entries.length !== sources.length
      || proof.entries.some((entry) =>
        !sourcesByName.get(entry.name)?.equals(entry.bytes))) {
      throw concurrentChange(`${label} no longer matches its staged sources: ${temporaryPath}`);
    }
    if (afterStagingComplete) {
      await afterStagingComplete({ temporaryPath, targetPath, operationToken });
    }
    completed = true;
    return {
      temporaryPath,
      proof,
      label,
      assertPath,
      ownerBoundary,
      stagingJournal,
      stagingOperationToken: operationToken,
    };
  } catch (error) {
    primaryError = error;
  } finally {
    if (!completed) {
      const cleanupErrors = [];
      const details = [];
      let stagingArtifactsRemoved = !stagingJournal;
      if (root) {
        try {
          const outcome = await rollbackPartialDirectory(
            temporaryPath,
            root,
            createdEntries,
            label,
            assertMutationPath,
          );
          details.push(...outcome.details);
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (stagingJournal && !(await lstatIfPresent(temporaryPath).catch(() => true))) {
        try {
          const outcome = await removeExactFlatDirectory(
            stagingJournal.path,
            {
              root: stagingJournal.root,
              entries: [...stagingJournal.entries].sort((left, right) =>
                left.name.localeCompare(right.name)),
            },
            { label: `${label} staging journal`, assertPath: assertMutationPath },
          );
          details.push(...outcome.details);
          stagingArtifactsRemoved = outcome.removed && !outcome.concurrent;
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      try {
        await releasePublicationLiveOwner(stagingJournal, `${label} staging`, assertMutationPath);
      } catch (error) {
        cleanupErrors.push(error);
      } finally {
        livePublicationOperations.delete(operationToken);
      }
      if (cleanupErrors.length === 0
        && stagingArtifactsRemoved
        && stagingReservation
        && !(await lstatIfPresent(temporaryPath))) {
        try {
          await removeExactRegularEntry(
            reservationPath,
            stagingReservation.entry,
            `${label} staging reservation`,
            assertMutationPath,
          );
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (cleanupErrors.length > 0) {
        throw cleanupFailure(label, primaryError, cleanupErrors, details);
      }
    }
  }
  throw primaryError;
}

async function finishStagingOperation(staged, label, assertPath) {
  const journal = staged?.stagingJournal;
  if (!journal) return;
  let cleanupError = null;
  try {
    if (!(await lstatIfPresent(staged.temporaryPath))) {
      const state = await lstatIfPresent(journal.path);
      if (state) {
        const outcome = await removeExactFlatDirectory(
          journal.path,
          {
            root: journal.root,
            entries: [...journal.entries].sort((left, right) =>
              left.name.localeCompare(right.name)),
          },
          { label: `${label} staging journal`, assertPath },
        );
        if (!outcome.removed || outcome.concurrent) {
          throw concurrentChange(`${label} staging journal cleanup retained content.`, outcome.details);
        }
      }
    }
  } catch (error) {
    cleanupError = error;
  }
  let ownerReleased = false;
  try {
    await releasePublicationLiveOwner(journal, `${label} staging`, assertPath);
    ownerReleased = true;
  } finally {
    livePublicationOperations.delete(staged.stagingOperationToken);
    if (ownerReleased
      && !cleanupError
      && journal.reservation
      && !(await lstatIfPresent(staged.temporaryPath))
      && await lstatIfPresent(journal.reservationPath)) {
      await removeExactRegularEntry(
        journal.reservationPath,
        journal.reservation,
        `${label} staging reservation`,
        assertPath,
      );
    }
  }
  if (cleanupError) throw cleanupError;
}

export async function publishFlatDirectoryWithoutReplace(
  staged,
  targetPath,
  {
    label = "Directory publication",
    beforePublish = null,
    beforeHandoff = null,
    afterPublicationJournalMkdir = null,
    afterPublicationLiveOwner = null,
    afterReservationMkdir = null,
    afterReservationReceiptWrite = null,
    afterReservationReceipt = null,
    afterReservation = null,
    afterEntryPublication = null,
    afterTemporaryVerification = null,
    afterSourceCleanup = null,
    afterHandoffCleanup = null,
    afterJournalCleanup = null,
    afterOwnerMarkerCleanup = null,
    assertPath: requestedAssertPath = staged.assertPath ?? null,
  } = {},
) {
  const { temporaryPath, proof } = staged;
  if (!staged.ownerBoundary) {
    throw new TypeError(`${label} requires a staged owner boundary.`);
  }
  const assertPath = boundPathAssertion(staged.ownerBoundary, requestedAssertPath);
  const operationToken = randomUUID();
  livePublicationOperations.add(operationToken);
  let handoff = null;
  let handoffAuthenticated = false;
  let temporaryCleaned = false;
  let handoffCleaned = false;
  let handoffReleased = false;
  let journal = null;
  let journalCleaned = false;
  let reservation = null;
  let reservationMarker = null;
  let ownerMarker = null;
  let publicationComplete = false;
  let terminalMayRelease = false;
  let preparedReturned = false;
  const publishedEntries = [];
  let primaryError = null;
  try {

  try {
    await assertBoundary(assertPath, temporaryPath);
    if (!(await directoryMatchesProof(temporaryPath, proof, label))) {
      throw concurrentChange(`${label} temporary directory changed before publication: ${temporaryPath}`);
    }
    if (beforeHandoff) {
      await beforeHandoff({ temporaryPath, targetPath });
    }
    handoff = await createQuarantineSlot(
      dirname(temporaryPath),
      temporaryPath,
      `${label} handoff`,
      assertPath,
    );
    if (afterTemporaryVerification) {
      await afterTemporaryVerification({
        temporaryPath,
        stagedPath: handoff.entry,
        handoffPath: handoff.entry,
        targetPath,
      });
    }
    await assertBoundary(assertPath, temporaryPath);
    await assertBoundary(assertPath, handoff.entry);
    await assertDirectoryRoot(
      handoff.root,
      handoff,
      `${label} handoff`,
      [],
    );
    if (!(await directoryMatchesProof(temporaryPath, proof, label))) {
      throw concurrentChange(`${label} temporary directory changed before authenticated handoff.`);
    }
    try {
      await mkdir(handoff.entry, { mode: proof.root.mode });
    } catch (error) {
      throw concurrentChange(`${label} handoff entry appeared before exclusive reservation.`, [
        error.message,
      ]);
    }
    handoff.entryRoot = await captureCreatedDirectory(
      handoff.entry,
      `${label} handoff entry`,
      assertPath,
    );
    const handoffEntries = [];
    for (const entry of proof.entries) {
      await assertDirectoryRoot(
        handoff.entry,
        handoff.entryRoot,
        `${label} handoff entry`,
        handoffEntries.map((published) => published.name),
      );
      await link(join(temporaryPath, entry.name), join(handoff.entry, entry.name));
      handoffEntries.push(entry);
      if (!(await regularEntryMatches(
        join(handoff.entry, entry.name),
        entry,
        `${label} handoff entry`,
      ))) {
        throw concurrentChange(`${label} handoff entry changed during no-replace transfer.`);
      }
      await syncDirectory(handoff.entry, assertPath);
    }
    const handoffProof = { root: handoff.entryRoot, entries: proof.entries };
    if (!(await directoryMatchesProof(handoff.entry, handoffProof, label))) {
      throw concurrentChange(`${label} handoff directory changed during authenticated transfer.`);
    }
    handoffAuthenticated = true;
    journal = await createPublicationJournal(
      staged,
      targetPath,
      handoff,
      operationToken,
      label,
      assertPath,
      (claimedJournal) => {
        journal = claimedJournal;
      },
      afterPublicationJournalMkdir,
      afterPublicationLiveOwner,
    );
    if (beforePublish) {
      await beforePublish({ temporaryPath, stagedPath: handoff.entry, targetPath });
    }
    await assertBoundary(assertPath, targetPath);
    try {
      await mkdir(targetPath, { mode: proof.root.mode });
    } catch (error) {
      if (["EEXIST", "EISDIR", "ENOTDIR", "ELOOP", "ENOENT"].includes(error?.code)) {
        throw concurrentChange(`${label} destination appeared before exclusive reservation: ${targetPath}`, [
          error.message,
        ]);
      }
      throw error;
    }
    reservation = await captureCreatedDirectory(
      targetPath,
      `${label} destination reservation`,
      assertPath,
    );
    await assertDirectoryRoot(
      targetPath,
      reservation,
      `${label} destination reservation`,
      [],
    );
    const reservationMarkerPath = join(targetPath, journal.intentValue.reservationMarkerName);
    await link(join(journal.path, PUBLICATION_INTENT_NAME), reservationMarkerPath);
    const reservationMarkerCandidate = await captureRegularEntry(
      reservationMarkerPath,
      journal.intentValue.reservationMarkerName,
      `${label} destination reservation marker`,
    );
    if (!sameEntryIdentityAndBytes(reservationMarkerCandidate, journal.intent)) {
      throw concurrentChange(`${label} destination reservation marker was replaced.`);
    }
    reservationMarker = reservationMarkerCandidate;
    await assertDirectoryRoot(
      targetPath,
      reservation,
      `${label} destination reservation`,
      [reservationMarker.name],
    );
    await syncDirectory(dirname(targetPath), assertPath);
    await syncDirectory(targetPath, assertPath);
    if (afterReservationMkdir) {
      await afterReservationMkdir({
        temporaryPath,
        stagedPath: handoff.entry,
        targetPath,
        reservationIdentity: reservation.identity,
      });
    }
    await writeReservationReceipt(
      journal,
      targetPath,
      reservation,
      proof,
      label,
      assertPath,
      afterReservationReceiptWrite,
    );
    if (afterReservationReceipt) {
      await afterReservationReceipt({
        temporaryPath,
        stagedPath: handoff.entry,
        targetPath,
        reservationIdentity: reservation.identity,
        journalPath: journal.path,
      });
    }
    await removeExactRegularEntry(
      reservationMarkerPath,
      reservationMarker,
      `${label} destination reservation marker`,
      assertPath,
    );
    reservationMarker = null;
    await assertDirectoryRoot(targetPath, reservation, `${label} destination reservation`, []);
    if (afterReservation) {
      await afterReservation({
        temporaryPath,
        stagedPath: handoff.entry,
        targetPath,
        reservationIdentity: reservation.identity,
      });
    }
    await assertDirectoryRoot(targetPath, reservation, `${label} destination reservation`, []);
    const ownerMarkerPath = join(targetPath, journal.receiptValue.ownerMarkerName);
    await link(join(journal.path, PUBLICATION_RECEIPT_NAME), ownerMarkerPath);
    const ownerMarkerCandidate = await captureRegularEntry(
      ownerMarkerPath,
      journal.receiptValue.ownerMarkerName,
      `${label} publication owner marker`,
    );
    if (!sameEntryIdentityAndBytes(ownerMarkerCandidate, journal.receipt)) {
      throw concurrentChange(`${label} publication owner marker was not bound to its receipt.`);
    }
    ownerMarker = ownerMarkerCandidate;
    await syncDirectory(targetPath, assertPath);
    await assertBoundary(assertPath, targetPath);
    await assertDirectoryRoot(
      targetPath,
      reservation,
      `${label} destination reservation`,
      [ownerMarker.name],
    );

    for (const [entryIndex, entry] of proof.entries.entries()) {
      await assertBoundary(assertPath, targetPath);
      await assertDirectoryRoot(
        targetPath,
        reservation,
        `${label} destination reservation`,
        [ownerMarker.name, ...publishedEntries.map((published) => published.name)],
      );
      if (!(await directoryMatchesProof(handoff.entry, handoffProof, label))) {
        throw concurrentChange(`${label} temporary directory changed during publication: ${handoff.entry}`);
      }
      const sourcePath = join(handoff.entry, entry.name);
      const destinationPath = join(targetPath, entry.name);
      await assertBoundary(assertPath, sourcePath);
      await assertBoundary(assertPath, destinationPath);
      try {
        await link(sourcePath, destinationPath);
      } catch (error) {
        throw concurrentChange(`${label} destination changed during no-replace transfer: ${targetPath}`, [
          error.message,
        ]);
      }
      publishedEntries.push(entry);
      if (!(await regularEntryMatches(destinationPath, entry, label))) {
        throw concurrentChange(`${label} published entry changed during transfer: ${destinationPath}`);
      }
      await syncDirectory(targetPath, assertPath);
      if (afterEntryPublication) {
        await afterEntryPublication({
          entryIndex,
          entryName: entry.name,
          temporaryPath,
          stagedPath: handoff.entry,
          targetPath,
        });
      }
    }

    await assertDirectoryRoot(
      targetPath,
      reservation,
      `${label} published destination`,
      [ownerMarker.name, ...proof.entries.map((entry) => entry.name)],
    );
    for (const entry of proof.entries) {
      if (!(await regularEntryMatches(join(targetPath, entry.name), entry, label))) {
        throw concurrentChange(`${label} changed before committed cleanup.`);
      }
    }
    publicationComplete = true;

    const committed = {
      root: reservation,
      marker: ownerMarker,
      markerName: ownerMarker.name,
      receiptValue: journal.receiptValue,
      proof: {
        root: { identity: reservation.identity, mode: reservation.mode },
        entries: proof.entries,
      },
      sourceProof: proof,
      terminal: journal.terminal,
      terminalPath: journal.terminalPath,
    };
    const publication = {
      path: targetPath,
      proof: committed.proof,
      label,
      assertPath,
    };
    let deciding = false;
    let settled = false;
    const beginDecision = () => {
      if (deciding || settled) {
        throw concurrentChange(`${label} prepared publication already has a final decision.`);
      }
      deciding = true;
    };
    const releasePreparedOwnership = async () => {
      let releaseError = null;
      try {
        await releasePublicationLiveOwner(journal, label, assertPath);
      } catch (error) {
        releaseError = error;
      }
      try {
        await finishStagingOperation(staged, label, assertPath);
      } catch (error) {
        releaseError ??= error;
      } finally {
        livePublicationOperations.delete(operationToken);
      }
      if (releaseError) throw releaseError;
    };
    const finalize = async ({ beforeCommit = null } = {}) => {
      beginDecision();
      try {
        const outcome = await finishCommittedPublicationRecovery(
          committed,
          staged.ownerBoundary,
          journal.path,
          label,
          assertPath,
          false,
          {
            ownedOperationToken: operationToken,
            afterSourceCleanup,
            afterHandoffCleanup,
            afterJournalCleanup,
            afterOwnerMarkerCleanup,
            beforeCommit,
          },
        );
        await releasePreparedOwnership();
        settled = true;
        return outcome;
      } catch (error) {
        try {
          await releasePreparedOwnership();
        } catch (releaseError) {
          throw cleanupFailure(label, error, [releaseError], [
            `Prepared publication retained for recovery: ${targetPath}`,
          ]);
        }
        deciding = false;
        throw error;
      }
    };
    const rollback = async () => {
      beginDecision();
      let ownershipReleased = false;
      try {
        if (!(await lstatIfPresent(join(targetPath, committed.marker.name)))
          && await lstatIfPresent(committed.terminalPath)) {
          await restorePublicationOwnerMarkerFromTerminal(
            targetPath,
            committed.sourceProof.entries.map((entry) => [entry.name, entry.bytes]),
            staged.ownerBoundary,
            label,
            assertPath,
          );
        }
        await assertCommittedPublicationCurrent(committed, label, assertPath);
        const targetOutcome = await removeCommittedFlatDirectory(
          targetPath,
          {
            root: committed.root,
            entries: [committed.marker, ...committed.sourceProof.entries],
          },
          `${label} rejected prepared destination`,
          assertPath,
        );
        if (!targetOutcome.removed || targetOutcome.concurrent) {
          throw recoveryFailure(
            label,
            targetOutcome.details,
            [targetPath, journal.path, journal.terminalPath],
          );
        }
        await releasePreparedOwnership();
        ownershipReleased = true;
        const recovered = await recoverFlatDirectoryPublication(
          targetPath,
          committed.sourceProof.entries.map((entry) => [entry.name, entry.bytes]),
          {
            label,
            assertPath,
            ownerRoot: staged.ownerBoundary.logicalOwnerRoot,
          },
        );
        if (recovered.committed) {
          throw recoveryFailure(
            label,
            ["Rejected prepared publication unexpectedly remained visible after rollback."],
            [targetPath, journal.path],
          );
        }
        settled = true;
        return {
          removed: true,
          concurrent: false,
          details: targetOutcome.details,
        };
      } catch (error) {
        if (!ownershipReleased) {
          try {
            await releasePreparedOwnership();
          } catch (releaseError) {
            throw cleanupFailure(label, error, [releaseError], [
              `Prepared publication retained for recovery: ${targetPath}`,
            ]);
          }
        }
        throw error;
      }
    };
    preparedReturned = true;
    return {
      prepared: true,
      targetPath,
      journalPath: journal.path,
      publication,
      assertCurrent: () => assertCommittedPublicationCurrent(committed, label, assertPath),
      finalize,
      rollback,
    };
  } catch (error) {
    primaryError = error;
  }

  const cleanupErrors = [];
  const details = [];
  let retainedRecovery = false;
  if (reservation && !publicationComplete) {
    try {
      const cleanupTarget = await lstatIfPresent(targetPath);
      const ownsCleanupTarget = cleanupTarget?.isDirectory()
        && !cleanupTarget.isSymbolicLink()
        && sameIdentity(entryIdentity(cleanupTarget), reservation.identity)
        && modeOf(cleanupTarget) === reservation.mode;
      if (!ownsCleanupTarget) {
        retainedRecovery = true;
        details.push(`Replacement ${label} destination preserved: ${targetPath}`);
      } else {
        if (reservationMarker) {
          await removeExactRegularEntry(
            join(targetPath, reservationMarker.name),
            reservationMarker,
            `${label} destination reservation marker`,
            assertPath,
          );
          reservationMarker = null;
        }
        if (ownerMarker) {
          await removePublicationOwnerMarker(
            targetPath,
            { root: reservation, marker: ownerMarker },
            label,
            assertPath,
          );
          ownerMarker = null;
        }
        const outcome = await rollbackPartialDirectory(
          targetPath,
          { identity: reservation.identity, mode: reservation.mode },
          publishedEntries,
          `${label} destination`,
          assertPath,
        );
        details.push(...outcome.details);
        retainedRecovery ||= outcome.concurrent || !outcome.removed;
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
  } else if (publicationComplete) {
    retainedRecovery = true;
    details.push(`Committed ${label} destination preserved: ${targetPath}`);
  }
  if (!temporaryCleaned && await lstatIfPresent(temporaryPath)) {
    try {
      const outcome = publicationComplete
        ? await removeCommittedFlatDirectory(
            temporaryPath,
            proof,
            `${label} staged source`,
            assertPath,
          )
        : await removeExactFlatDirectory(temporaryPath, proof, {
            label: `${label} staged source`,
            assertPath,
          });
      details.push(...outcome.details);
      temporaryCleaned = outcome.removed;
      retainedRecovery ||= outcome.concurrent || !outcome.removed;
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (!handoffCleaned && handoffAuthenticated && await lstatIfPresent(handoff?.entry)) {
    try {
      const handoffProof = { root: handoff.entryRoot, entries: proof.entries };
      const outcome = publicationComplete
        ? await removeCommittedFlatDirectory(
            handoff.entry,
            handoffProof,
            `${label} handoff entry`,
            assertPath,
          )
        : await removeExactFlatDirectory(handoff.entry, handoffProof, {
            label: `${label} handoff entry`,
            assertPath,
          });
      details.push(...outcome.details);
      handoffCleaned = outcome.removed;
      retainedRecovery ||= outcome.concurrent || !outcome.removed;
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (handoff && !handoffReleased) {
    try {
      const released = await releaseQuarantineSlot(handoff, `${label} handoff`, assertPath);
      details.push(...released.details);
      handoffReleased = released.removed;
      retainedRecovery ||= released.concurrent || !released.removed;
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (journal && !journalCleaned) {
    if (retainedRecovery || cleanupErrors.length > 0) {
      details.push(`Authenticated ${label} publication journal retained: ${journal.path}`);
    } else {
      try {
        const journalOutcome = await removePublicationJournal(journal, label, assertPath);
        details.push(...journalOutcome.details);
        journalCleaned = journalOutcome.removed;
        retainedRecovery ||= journalOutcome.concurrent || !journalOutcome.removed;
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
  }
  if (publicationComplete
    && journalCleaned
    && ownerMarker
    && cleanupErrors.length === 0
    && !retainedRecovery) {
    try {
      await removePublicationOwnerMarker(
        targetPath,
        { root: reservation, marker: ownerMarker },
        label,
        assertPath,
      );
      ownerMarker = null;
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  terminalMayRelease ||= Boolean(
    journalCleaned
    && !publicationComplete
    && !retainedRecovery
    && cleanupErrors.length === 0,
  );
  if (cleanupErrors.length > 0) {
    throw cleanupFailure(label, primaryError, cleanupErrors, details);
  }
  throw appendConcurrentDetails(primaryError, label, details);
  } finally {
    if (!preparedReturned) {
      try {
        if (terminalMayRelease) {
          await releasePublicationTerminal(journal, label, assertPath);
        }
        await releasePublicationLiveOwner(journal, label, assertPath);
        if (journalCleaned) {
          await releasePublicationInitialization(journal, label, assertPath);
        }
      } finally {
        try {
          await finishStagingOperation(staged, label, assertPath);
        } finally {
          livePublicationOperations.delete(operationToken);
        }
      }
    }
  }
}

export async function assertPublishedFlatDirectory(publication) {
  await assertBoundary(publication.assertPath, publication.path);
  if (!(await directoryMatchesProof(publication.path, publication.proof, publication.label))) {
    throw concurrentChange(`${publication.label} changed after publication: ${publication.path}`);
  }
  return true;
}

export async function removePublishedFlatDirectory(
  publication,
  { afterVerification = null } = {},
) {
  return removeExactFlatDirectory(publication.path, publication.proof, {
    label: publication.label,
    afterVerification,
    assertPath: publication.assertPath,
  });
}
