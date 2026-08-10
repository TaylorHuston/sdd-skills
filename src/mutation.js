import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { getWorkspaceConfigDirectory } from "./config.js";
import { SddError } from "./errors.js";
import { isPathPhysicallyInside } from "./fs.js";

function sameFileIdentity(left, right) {
  return left && right && left.dev === right.dev && left.ino === right.ino;
}

function observedLockMatches(observed, expected) {
  return observed?.regular === true
    && sameFileIdentity(observed.state, expected?.state)
    && (expected?.source === undefined || observed.source === expected.source);
}

async function lstatOrNull(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function statOrNull(path) {
  try {
    return await stat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function observeLock(path) {
  const before = await lstatOrNull(path);
  if (!before) return null;
  if (!before.isFile() || before.isSymbolicLink()) {
    return { source: null, state: before, regular: false };
  }

  let handle;
  try {
    handle = await open(path, "r");
    const state = await handle.stat();
    const source = await handle.readFile("utf8");
    const after = await lstatOrNull(path);
    return {
      source,
      state,
      regular: Boolean(
        state.isFile()
        && after?.isFile()
        && !after.isSymbolicLink()
        && sameFileIdentity(before, state)
        && sameFileIdentity(after, state)
      ),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

function describeFileIdentity(state) {
  return state ? `${String(state.dev)}:${String(state.ino)}` : "missing";
}

function unsafeMutationAuthorityError(workspaceRoot, configDirectory, cause = null) {
  const failure = new SddError(
    `Workspace mutation authority is not an owner-local directory: ${configDirectory}`,
    {
      code: "UNSAFE_CONFIG_PATH",
      details: [
        `Workspace root: ${workspaceRoot}`,
        `Configuration directory: ${configDirectory}`,
        ...(cause ? [`Observation error: ${describeMutationFailure(cause)}`] : []),
      ],
    },
  );
  if (cause) failure.cause = cause;
  return failure;
}

async function captureMutationAuthority(workspaceRoot, configDirectory) {
  let workspaceState;
  let configState;
  try {
    [workspaceState, configState] = await Promise.all([
      stat(workspaceRoot),
      lstatOrNull(configDirectory),
    ]);
  } catch (error) {
    throw unsafeMutationAuthorityError(workspaceRoot, configDirectory, error);
  }
  if (!workspaceState.isDirectory()
    || (configState && (!configState.isDirectory() || configState.isSymbolicLink()))) {
    throw unsafeMutationAuthorityError(workspaceRoot, configDirectory);
  }
  return { workspaceRoot, workspaceState, configDirectory, configState };
}

function mutationAuthorityChangedError(binding, expectedLock, observed, phase, cause = null) {
  const configChanged = binding.configState
    ? !sameFileIdentity(observed.configState, binding.configState)
      || !observed.configState?.isDirectory()
      || observed.configState?.isSymbolicLink()
    : observed.configState !== null;
  const changes = [
    ...(!sameFileIdentity(observed.workspaceState, binding.workspaceState)
      || !observed.workspaceState?.isDirectory()
      ? [
          `Workspace root identity changed from ${describeFileIdentity(binding.workspaceState)}`
          + ` to ${describeFileIdentity(observed.workspaceState)}: ${binding.workspaceRoot}`,
        ]
      : []),
    ...(configChanged
      ? [
          `Configuration directory identity changed from ${describeFileIdentity(binding.configState)}`
          + ` to ${describeFileIdentity(observed.configState)}: ${binding.configDirectory}`,
        ]
      : []),
    ...(!observedLockMatches(observed.lock, expectedLock)
      ? [`Mutation lock identity changed or became non-regular: ${expectedLock.path}`]
      : []),
    ...(expectedLock.legacyPath
      && !observedLockMatches(observed.legacyLock, expectedLock)
      ? [`Legacy mutation guard identity changed or became non-regular: ${expectedLock.legacyPath}`]
      : []),
  ];
  const retainedPaths = [
    expectedLock.path,
    ...(expectedLock.legacyPath ? [expectedLock.legacyPath] : []),
  ];
  const failure = new SddError(
    `Workspace mutation authority changed ${phase}: ${binding.workspaceRoot}`,
    {
      code: "MUTATION_RECOVERY_FAILED",
      details: [
        `Lock: ${expectedLock.path}`,
        ...changes,
        ...(cause ? [`Observation error: ${describeMutationFailure(cause)}`] : []),
        ...retainedPaths.map((path) => `Retained lock path requiring inspection: ${path}`),
        "The mutation stopped because its workspace directory and visible lock must retain one physical identity.",
      ],
    },
  );
  failure.retainedPaths = retainedPaths;
  if (cause) failure.cause = cause;
  return failure;
}

async function observeMutationAuthority(binding, expectedLock, phase) {
  try {
    const [workspaceState, configState, lock, legacyLock] = await Promise.all([
      statOrNull(binding.workspaceRoot),
      lstatOrNull(binding.configDirectory),
      observeLock(expectedLock.path),
      expectedLock.legacyPath ? observeLock(expectedLock.legacyPath) : null,
    ]);
    return { workspaceState, configState, lock, legacyLock };
  } catch (error) {
    throw mutationAuthorityChangedError(binding, expectedLock, {
      workspaceState: null,
      configState: null,
      lock: null,
      legacyLock: null,
    }, phase, error);
  }
}

async function assertMutationAuthority(binding, expectedLock, phase) {
  const observed = await observeMutationAuthority(binding, expectedLock, phase);
  const configMatches = binding.configState
    ? sameFileIdentity(observed.configState, binding.configState)
      && observed.configState?.isDirectory()
      && !observed.configState.isSymbolicLink()
    : observed.configState === null;
  if (!sameFileIdentity(observed.workspaceState, binding.workspaceState)
    || !observed.workspaceState?.isDirectory()
    || !configMatches
    || !observedLockMatches(observed.lock, expectedLock)
    || (expectedLock.legacyPath
      && !observedLockMatches(observed.legacyLock, expectedLock))) {
    throw mutationAuthorityChangedError(binding, expectedLock, observed, phase);
  }
}

async function createConfigDirectory(path) {
  await mkdir(path);
  return lstat(path);
}

async function createAndBindConfigDirectory(binding, expectedLock, createDirectory) {
  let configState = null;
  try {
    configState = await createDirectory(binding.configDirectory);
    if (!configState?.isDirectory() || configState.isSymbolicLink()) {
      throw unsafeMutationAuthorityError(binding.workspaceRoot, binding.configDirectory);
    }
    const visibleState = await lstat(binding.configDirectory);
    if (!sameFileIdentity(visibleState, configState)
      || !visibleState.isDirectory()
      || visibleState.isSymbolicLink()) {
      throw mutationAuthorityChangedError(
        binding,
        expectedLock,
        {
          workspaceState: await statOrNull(binding.workspaceRoot),
          configState: visibleState,
          lock: await observeLock(expectedLock.path),
          legacyLock: null,
        },
        "while binding the created configuration directory",
      );
    }
    binding.configState = configState;
  } catch (error) {
    if (error?.retainedPaths?.includes(expectedLock.path)) throw error;
    if (configState) {
      const observed = await observeMutationAuthority(
        binding,
        expectedLock,
        "while binding the created configuration directory",
      );
      throw mutationAuthorityChangedError(
        binding,
        expectedLock,
        observed,
        "while binding the created configuration directory",
        error,
      );
    }
    try {
      await assertMutationAuthority(
        binding,
        expectedLock,
        "while creating the configuration directory",
      );
    } catch (authorityError) {
      throw authorityError;
    }
    throw error;
  }
}

function createMutationLockSource(binding, token) {
  return `${JSON.stringify({
    pid: process.pid,
    token,
    createdAt: new Date().toISOString(),
    workspaceIdentity: {
      dev: String(binding.workspaceState.dev),
      ino: String(binding.workspaceState.ino),
    },
    configIdentity: binding.configState
      ? {
          dev: String(binding.configState.dev),
          ino: String(binding.configState.ino),
        }
      : null,
  })}\n`;
}

async function rewriteMutationLockSource(handle, expectedLock, binding, token) {
  const source = createMutationLockSource(binding, token);
  const bytes = Buffer.from(source);
  try {
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesWritten } = await handle.write(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (bytesWritten <= 0) {
        throw new Error(`Mutation lock rewrite made no progress: ${expectedLock.path}`);
      }
      offset += bytesWritten;
    }
    await handle.truncate(bytes.length);
    await handle.sync();
  } catch (error) {
    try {
      await assertMutationAuthority(
        binding,
        expectedLock,
        "while persisting the configuration-directory identity",
      );
    } catch (authorityError) {
      throw authorityError;
    }
    throw error;
  }
  expectedLock.source = source;
  await assertMutationAuthority(
    binding,
    expectedLock,
    "after persisting the configuration-directory identity",
  );
  return source;
}

function parseLockOwner(source) {
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}

function isLockOwnerAlive(owner) {
  if (!Number.isInteger(owner?.pid) || owner.pid <= 0) return true;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function lockIdentityMatchesState(identity, state) {
  return identity
    && typeof identity.dev === "string"
    && typeof identity.ino === "string"
    && identity.dev === String(state?.dev)
    && identity.ino === String(state?.ino);
}

function canonicalLockOwnerMatchesAuthority(owner, binding) {
  if (!owner || typeof owner !== "object") return false;
  if (!lockIdentityMatchesState(owner.workspaceIdentity, binding.workspaceState)
    || !Object.hasOwn(owner, "configIdentity")) {
    return false;
  }
  if (owner.configIdentity === null) return binding.configState === null;
  return lockIdentityMatchesState(owner.configIdentity, binding.configState);
}

function legacyLockOwnerMatchesAuthority(owner, binding) {
  if (!owner || typeof owner !== "object") return false;
  if (Object.hasOwn(owner, "workspaceIdentity")
    || Object.hasOwn(owner, "configIdentity")) {
    return canonicalLockOwnerMatchesAuthority(owner, binding);
  }
  return Number.isInteger(owner.pid)
    && owner.pid > 0
    && typeof owner.token === "string"
    && owner.token.length > 0
    && typeof owner.createdAt === "string"
    && owner.createdAt.length > 0;
}

function operationInProgressError(lockPath, owner, details = []) {
  return new SddError(`Another SDD mutation is already in progress: ${lockPath}`, {
    code: "OPERATION_IN_PROGRESS",
    details: [
      `Lock: ${lockPath}`,
      Number.isInteger(owner?.pid) ? `Owner PID: ${owner.pid}` : "Owner PID: unknown",
      owner?.createdAt ? `Created: ${owner.createdAt}` : "Created: unknown",
      ...details,
      "Inspect the adjacent .reclaim guard and any .sdd-reclaim-* file. Remove them manually only after confirming no SDD mutation is active.",
    ],
  });
}
function describeMutationFailure(error) {
  const codePrefix = error?.code ? `${error.code}: ` : "";
  return `${codePrefix}${error?.message ?? String(error)}`;
}

function mutationLockCleanupError(lockPath, retainedPaths, cause = null, causeLabel = "Release") {
  const uniqueRetainedPaths = [...new Set(retainedPaths)];
  const failure = new SddError(`Mutation lock could not be released safely: ${lockPath}`, {
    code: "MUTATION_RECOVERY_FAILED",
    details: [
      `Lock: ${lockPath}`,
      ...uniqueRetainedPaths.map((path) => `Retained lock path requiring inspection: ${path}`),
      ...(cause
        ? [`${causeLabel} error: ${describeMutationFailure(cause)}`]
        : ["The lock no longer matched this operation's ownership record."]),
      "Remove a retained lock only after confirming no SDD mutation is active and the ownership record does not belong to another operation.",
    ],
  });
  failure.retainedPaths = uniqueRetainedPaths;
  if (cause) failure.cause = cause;
  return failure;
}

function mutationLockAggregateError(lockPath, originalError, failures) {
  const errors = [
    ...(originalError ? [originalError] : []),
    ...failures.map(({ error }) => error),
  ];
  const failure = new SddError(
    originalError
      ? `SDD mutation failed and its lock cleanup also failed: ${lockPath}`
      : `Mutation lock cleanup failed in multiple ways: ${lockPath}`,
    {
      code: "MUTATION_RECOVERY_FAILED",
      details: [
        `Lock: ${lockPath}`,
        ...(originalError
          ? [
              `Original error: ${describeMutationFailure(originalError)}`,
              ...(Array.isArray(originalError?.details)
                ? originalError.details.map((detail) => `Original detail: ${detail}`)
                : []),
            ]
          : []),
        ...failures.flatMap(({ label, error }) => [
          `${label} error: ${describeMutationFailure(error)}`,
          ...(Array.isArray(error?.details) ? error.details : []),
        ]),
        "Inspect every retained lock path and cleanup error before retrying the mutation.",
      ],
    },
  );
  failure.errors = errors;
  failure.cause = new AggregateError(errors, failure.message);
  return failure;
}


async function restoreQuarantinedLock(quarantinePath, lockPath, expected) {
  const current = await observeLock(quarantinePath);
  if (!observedLockMatches(current, expected)) return false;
  try {
    await link(quarantinePath, lockPath);
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
  const restored = await observeLock(lockPath);
  const remaining = await observeLock(quarantinePath);
  if (!observedLockMatches(restored, expected)
    || !observedLockMatches(remaining, expected)) {
    return false;
  }
  await rm(quarantinePath);
  return true;
}

async function removeObservedLock(
  lockPath,
  expected,
  label,
  {
    afterLockObserved = null,
    afterLockQuarantined = null,
    hookContext = {},
  } = {},
) {
  const quarantinePath = join(
    dirname(lockPath),
    `.sdd-${label}-${process.pid}-${randomUUID()}`,
  );
  let current;
  try {
    current = await observeLock(lockPath);
  } catch (error) {
    throw mutationLockCleanupError(lockPath, [lockPath], error);
  }
  if (!observedLockMatches(current, expected)) {
    throw mutationLockCleanupError(lockPath, current ? [lockPath] : []);
  }
  if (afterLockObserved) {
    try {
      await afterLockObserved({
        lockPath,
        quarantinePath,
        ...hookContext,
      });
    } catch (error) {
      throw mutationLockCleanupError(
        lockPath,
        [lockPath, quarantinePath],
        error,
        "Release hook",
      );
    }
  }

  try {
    await link(lockPath, quarantinePath);
  } catch (error) {
    throw mutationLockCleanupError(
      lockPath,
      [
        ...(error?.code === "ENOENT" ? [] : [lockPath]),
        ...(error?.code === "EEXIST" ? [quarantinePath] : []),
      ],
      error,
      "Quarantine reservation",
    );
  }

  if (afterLockQuarantined) {
    try {
      await afterLockQuarantined({
        lockPath,
        quarantinePath,
        ...hookContext,
      });
    } catch (error) {
      throw mutationLockCleanupError(
        lockPath,
        [lockPath, quarantinePath],
        error,
        "Release hook",
      );
    }
  }

  let linkedLock;
  let quarantined;
  try {
    [linkedLock, quarantined] = await Promise.all([
      observeLock(lockPath),
      observeLock(quarantinePath),
    ]);
  } catch (error) {
    throw mutationLockCleanupError(
      lockPath,
      [lockPath, quarantinePath],
      error,
    );
  }
  if (!observedLockMatches(linkedLock, expected)
    || !observedLockMatches(quarantined, expected)) {
    throw mutationLockCleanupError(
      lockPath,
      [
        ...(linkedLock ? [lockPath] : []),
        ...(quarantined ? [quarantinePath] : []),
      ],
    );
  }

  try {
    await rm(lockPath);
  } catch (error) {
    throw mutationLockCleanupError(
      lockPath,
      [lockPath, quarantinePath],
      error,
    );
  }

  try {
    [linkedLock, quarantined] = await Promise.all([
      observeLock(lockPath),
      observeLock(quarantinePath),
    ]);
  } catch (error) {
    throw mutationLockCleanupError(
      lockPath,
      [lockPath, quarantinePath],
      error,
    );
  }
  if (linkedLock || !observedLockMatches(quarantined, expected)) {
    throw mutationLockCleanupError(
      lockPath,
      [
        ...(linkedLock ? [lockPath] : []),
        ...(quarantined ? [quarantinePath] : []),
      ],
    );
  }

  try {
    await rm(quarantinePath);
  } catch (error) {
    throw mutationLockCleanupError(lockPath, [quarantinePath], error);
  }
  return true;
}

async function removeOwnedPath(
  path,
  expected,
  lockPath,
  retainedPaths,
  causeLabel,
  {
    afterPathObserved = null,
    hookContext = {},
  } = {},
) {
  const retainedWithoutPath = retainedPaths.filter((retainedPath) => retainedPath !== path);
  const quarantinePath = join(
    dirname(path),
    `.sdd-owned-cleanup-${process.pid}-${randomUUID()}`,
  );
  let current;
  try {
    current = await observeLock(path);
  } catch (error) {
    throw mutationLockCleanupError(lockPath, retainedPaths, error, causeLabel);
  }
  if (!observedLockMatches(current, expected)) {
    throw mutationLockCleanupError(
      lockPath,
      current ? retainedPaths : retainedWithoutPath,
    );
  }

  if (afterPathObserved) {
    try {
      await afterPathObserved({
        path,
        quarantinePath,
        lockPath,
        causeLabel,
        ...hookContext,
      });
    } catch (error) {
      throw mutationLockCleanupError(
        lockPath,
        [...retainedPaths, quarantinePath],
        error,
        `${causeLabel} hook`,
      );
    }
  }

  try {
    current = await observeLock(path);
  } catch (error) {
    throw mutationLockCleanupError(lockPath, retainedPaths, error, causeLabel);
  }
  if (!observedLockMatches(current, expected)) {
    throw mutationLockCleanupError(
      lockPath,
      current ? retainedPaths : retainedWithoutPath,
    );
  }

  try {
    await link(path, quarantinePath);
  } catch (error) {
    throw mutationLockCleanupError(
      lockPath,
      [
        ...(error?.code === "ENOENT" ? retainedWithoutPath : retainedPaths),
        ...(error?.code === "EEXIST" ? [quarantinePath] : []),
      ],
      error,
      `${causeLabel} quarantine reservation`,
    );
  }

  let sourceAfterLink;
  let quarantined;
  try {
    [sourceAfterLink, quarantined] = await Promise.all([
      observeLock(path),
      observeLock(quarantinePath),
    ]);
  } catch (error) {
    throw mutationLockCleanupError(
      lockPath,
      [...retainedPaths, quarantinePath],
      error,
      causeLabel,
    );
  }
  if (!observedLockMatches(sourceAfterLink, expected)
    || !observedLockMatches(quarantined, expected)) {
    throw mutationLockCleanupError(
      lockPath,
      [
        ...retainedWithoutPath,
        ...(sourceAfterLink ? [path] : []),
        ...(quarantined ? [quarantinePath] : []),
      ],
    );
  }

  try {
    await rm(path);
  } catch (error) {
    throw mutationLockCleanupError(
      lockPath,
      [...retainedPaths, quarantinePath],
      error,
      causeLabel,
    );
  }

  try {
    [sourceAfterLink, quarantined] = await Promise.all([
      observeLock(path),
      observeLock(quarantinePath),
    ]);
  } catch (error) {
    throw mutationLockCleanupError(
      lockPath,
      [...retainedWithoutPath, path, quarantinePath],
      error,
      causeLabel,
    );
  }
  if (sourceAfterLink || !observedLockMatches(quarantined, expected)) {
    throw mutationLockCleanupError(
      lockPath,
      [
        ...retainedWithoutPath,
        ...(sourceAfterLink ? [path] : []),
        ...(quarantined ? [quarantinePath] : []),
      ],
    );
  }

  try {
    await rm(quarantinePath);
  } catch (error) {
    throw mutationLockCleanupError(
      lockPath,
      [...retainedWithoutPath, quarantinePath],
      error,
      causeLabel,
    );
  }
}

async function releaseObservedLock(
  lockPath,
  reclaimPath,
  expected,
  {
    afterReleaseGuardLinked,
    afterLockObserved,
    afterLockQuarantined,
    afterOwnedPathObserved,
  },
) {
  let current;
  try {
    current = await observeLock(lockPath);
  } catch (error) {
    throw mutationLockCleanupError(lockPath, [lockPath], error);
  }
  if (!observedLockMatches(current, expected)) {
    throw mutationLockCleanupError(lockPath, current ? [lockPath] : []);
  }

  try {
    await link(lockPath, reclaimPath);
  } catch (error) {
    throw mutationLockCleanupError(
      lockPath,
      [lockPath, ...(error?.code === "EEXIST" ? [reclaimPath] : [])],
      error,
      "Release guard",
    );
  }
  if (afterReleaseGuardLinked) {
    try {
      await afterReleaseGuardLinked({ lockPath, reclaimPath });
    } catch (error) {
      throw mutationLockCleanupError(
        lockPath,
        [lockPath, reclaimPath],
        error,
        "Release guard hook",
      );
    }
  }


  let claim;
  try {
    claim = await observeLock(reclaimPath);
  } catch (error) {
    throw mutationLockCleanupError(lockPath, [lockPath, reclaimPath], error, "Release guard");
  }
  if (!observedLockMatches(claim, expected)) {
    let replacement;
    try {
      replacement = await observeLock(lockPath);
    } catch (observationError) {
      throw mutationLockAggregateError(lockPath, null, [
        {
          label: "Release ownership",
          error: mutationLockCleanupError(
            lockPath,
            [lockPath, ...(claim ? [reclaimPath] : [])],
          ),
        },
        {
          label: "Canonical lock observation",
          error: mutationLockCleanupError(
            lockPath,
            [lockPath, ...(claim ? [reclaimPath] : [])],
            observationError,
            "Observation",
          ),
        },
      ]);
    }
    throw mutationLockCleanupError(
      lockPath,
      [
        ...(replacement ? [lockPath] : []),
        ...(claim ? [reclaimPath] : []),
      ],
    );
  }

  try {
    await removeObservedLock(
      lockPath,
      expected,
      "lock-release",
      {
        afterLockObserved,
        afterLockQuarantined,
        hookContext: { reclaimPath },
      },
    );
  } catch (releaseError) {
    let replacement;
    try {
      replacement = await observeLock(lockPath);
    } catch (observationError) {
      throw mutationLockAggregateError(lockPath, null, [
        { label: "Release", error: releaseError },
        { label: "Release recovery observation", error: observationError },
        {
          label: "Release guard retained",
          error: mutationLockCleanupError(lockPath, [reclaimPath]),
        },
      ]);
    }
    if (!replacement) {
      throw mutationLockAggregateError(lockPath, null, [
        { label: "Release", error: releaseError },
        {
          label: "Release guard retained",
          error: mutationLockCleanupError(lockPath, [reclaimPath]),
        },
      ]);
    }
    try {
      await removeOwnedPath(
        reclaimPath,
        claim,
        lockPath,
        [lockPath, reclaimPath],
        "Release guard cleanup",
        {
          afterPathObserved: afterOwnedPathObserved,
          hookContext: { reclaimPath },
        },
      );
    } catch (cleanupError) {
      throw mutationLockAggregateError(lockPath, null, [
        { label: "Release", error: releaseError },
        { label: "Release guard cleanup", error: cleanupError },
      ]);
    }
    throw releaseError;
  }

  await removeOwnedPath(
    reclaimPath,
    claim,
    lockPath,
    [reclaimPath],
    "Release guard",
    {
      afterPathObserved: afterOwnedPathObserved,
      hookContext: { reclaimPath },
    },
  );
}

async function reclaimStaleLock(
  lockPath,
  reclaimPath,
  observed,
  owner,
  afterStaleReclaimLinked,
  afterStaleLockQuarantined,
) {
  try {
    await link(lockPath, reclaimPath);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    if (error?.code === "EEXIST") {
      throw operationInProgressError(lockPath, owner, [
        `Stale-lock reclamation is already in progress: ${reclaimPath}`,
      ]);
    }
    throw error;
  }
  if (afterStaleReclaimLinked) {
    try {
      await afterStaleReclaimLinked({ lockPath, reclaimPath });
    } catch (error) {
      throw mutationLockCleanupError(
        lockPath,
        [lockPath, reclaimPath],
        error,
        "Stale-reclaim hook",
      );
    }
  }


  let claim;
  try {
    claim = await observeLock(reclaimPath);
  } catch (error) {
    throw mutationLockCleanupError(
      lockPath,
      [lockPath, reclaimPath],
      error,
      "Stale-reclaim claim observation",
    );
  }
  if (!observedLockMatches(claim, observed)) {
    const ownershipError = operationInProgressError(lockPath, owner, [
      "The lock changed before stale-lock reclamation could claim it.",
      ...(claim ? [`Reclaim retained for inspection: ${reclaimPath}`] : []),
    ]);
    try {
      const replacement = await observeLock(lockPath);
      if (replacement) {
        ownershipError.details.push(`Canonical lock retained for inspection: ${lockPath}`);
      }
    } catch (observationError) {
      throw mutationLockAggregateError(lockPath, ownershipError, [
        {
          label: "Canonical lock observation",
          error: mutationLockCleanupError(
            lockPath,
            [lockPath, ...(claim ? [reclaimPath] : [])],
            observationError,
            "Observation",
          ),
        },
      ]);
    }
    throw ownershipError;
  }

  let current;
  try {
    current = await observeLock(lockPath);
  } catch (error) {
    throw mutationLockCleanupError(
      lockPath,
      [lockPath, reclaimPath],
      error,
      "Stale-reclaim lock observation",
    );
  }
  if (!observedLockMatches(current, observed)) {
    const ownershipError = operationInProgressError(lockPath, owner, [
      "The lock changed before stale-lock reclamation could quarantine it.",
    ]);
    try {
      await removeOwnedPath(
        reclaimPath,
        claim,
        lockPath,
        current ? [lockPath, reclaimPath] : [reclaimPath],
        "Stale-reclaim claim cleanup",
      );
    } catch (cleanupError) {
      throw mutationLockAggregateError(lockPath, ownershipError, [
        { label: "Stale-reclaim claim cleanup", error: cleanupError },
      ]);
    }
    if (!current) return false;
    throw ownershipError;
  }

  const quarantinePath = join(
    dirname(lockPath),
    `.sdd-reclaim-${process.pid}-${randomUUID()}`,
  );
  try {
    await rename(lockPath, quarantinePath);
  } catch (error) {
    let cleanupError = null;
    try {
      await removeOwnedPath(
        reclaimPath,
        claim,
        lockPath,
        [reclaimPath],
        "Stale-reclaim claim cleanup",
      );
    } catch (cleanupFailure) {
      cleanupError = cleanupFailure;
    }
    if (cleanupError) {
      throw mutationLockAggregateError(lockPath, error, [
        { label: "Stale-reclaim claim cleanup", error: cleanupError },
      ]);
    }
    if (error?.code === "ENOENT") return false;
    throw error;
  }

  let quarantined;
  try {
    quarantined = await observeLock(quarantinePath);
  } catch (error) {
    throw mutationLockCleanupError(
      lockPath,
      [quarantinePath, reclaimPath],
      error,
      "Stale-reclaim quarantine observation",
    );
  }
  if (!observedLockMatches(quarantined, observed)
    || isLockOwnerAlive(parseLockOwner(quarantined?.source))) {
    const ownershipError = operationInProgressError(lockPath, owner, [
      "The quarantined lock did not match the observed dead-owner lock.",
    ]);
    let restored = false;
    let cleanupError = null;
    if (quarantined) {
      try {
        restored = await restoreQuarantinedLock(
          quarantinePath,
          lockPath,
          quarantined,
        );
      } catch (error) {
        cleanupError = error;
      }
    }
    if (restored) {
      try {
        await removeOwnedPath(
          reclaimPath,
          claim,
          lockPath,
          [lockPath, reclaimPath],
          "Stale-reclaim claim cleanup",
        );
      } catch (error) {
        cleanupError = cleanupError ?? error;
      }
    }
    if (cleanupError) {
      throw mutationLockAggregateError(lockPath, ownershipError, [
        { label: "Stale-reclaim cleanup", error: cleanupError },
      ]);
    }
    if (!restored) {
      ownershipError.details.push(
        `Reclaim retained for inspection: ${reclaimPath}`,
        ...(quarantined ? [`Quarantine retained for inspection: ${quarantinePath}`] : []),
      );
    }
    throw ownershipError;
  }

  let hookError = null;
  try {
    if (afterStaleLockQuarantined) {
      await afterStaleLockQuarantined({ lockPath, quarantinePath, reclaimPath });
    }
  } catch (error) {
    hookError = error;
  }

  let quarantinedAfterHook;
  let claimAfterHook;
  try {
    quarantinedAfterHook = await observeLock(quarantinePath);
    claimAfterHook = await observeLock(reclaimPath);
  } catch (observationError) {
    const cleanupError = mutationLockCleanupError(
      lockPath,
      [quarantinePath, reclaimPath],
      observationError,
      "Stale-reclaim cleanup observation",
    );
    if (hookError) {
      throw mutationLockAggregateError(lockPath, hookError, [
        { label: "Stale-reclaim cleanup", error: cleanupError },
      ]);
    }
    throw cleanupError;
  }

  const quarantineStillOwned = observedLockMatches(quarantinedAfterHook, quarantined);
  const claimStillOwned = observedLockMatches(claimAfterHook, claim);
  if (hookError) {
    if (!quarantineStillOwned || !claimStillOwned) {
      throw mutationLockAggregateError(lockPath, hookError, [
        {
          label: "Stale-reclaim cleanup",
          error: mutationLockCleanupError(
            lockPath,
            [
              ...(quarantinedAfterHook ? [quarantinePath] : []),
              ...(claimAfterHook ? [reclaimPath] : []),
            ],
          ),
        },
      ]);
    }
    let restored = false;
    let cleanupError = null;
    try {
      restored = await restoreQuarantinedLock(
        quarantinePath,
        lockPath,
        quarantinedAfterHook,
      );
      if (!restored) {
        cleanupError = mutationLockCleanupError(
          lockPath,
          [lockPath, quarantinePath, reclaimPath],
        );
      } else {
        await removeOwnedPath(
          reclaimPath,
          claimAfterHook,
          lockPath,
          [lockPath, reclaimPath],
          "Stale-reclaim claim cleanup",
        );
      }
    } catch (error) {
      cleanupError = error;
    }
    if (cleanupError) {
      throw mutationLockAggregateError(lockPath, hookError, [
        { label: "Stale-reclaim cleanup", error: cleanupError },
      ]);
    }
    throw hookError;
  }

  if (!quarantineStillOwned || !claimStillOwned) {
    throw mutationLockCleanupError(
      lockPath,
      [
        ...(quarantinedAfterHook ? [quarantinePath] : []),
        ...(claimAfterHook ? [reclaimPath] : []),
      ],
    );
  }

  await removeOwnedPath(
    quarantinePath,
    quarantinedAfterHook,
    lockPath,
    [quarantinePath, reclaimPath],
    "Stale-reclaim quarantine cleanup",
  );
  await removeOwnedPath(
    reclaimPath,
    claimAfterHook,
    lockPath,
    [reclaimPath],
    "Stale-reclaim claim cleanup",
  );
  return true;
}

export async function withWorkspaceMutationLock(
  workspaceRoot,
  callback,
  {
    openFile = open,
    createDirectory = createConfigDirectory,
    afterStaleLockObserved = null,
    afterStaleReclaimLinked = null,
    afterStaleLockQuarantined = null,
    afterReleaseGuardLinked = null,
    afterLockObserved = null,
    afterLockQuarantined = null,
    afterOwnedPathObserved = null,
  } = {},
) {
  const configDirectory = getWorkspaceConfigDirectory(workspaceRoot);
  const lockPath = join(workspaceRoot, ".sdd-mutation.lock");
  const reclaimPath = join(workspaceRoot, ".sdd-mutation.lock.reclaim");
  const legacyLockPath = join(configDirectory, "mutation.lock");
  const legacyReclaimPath = join(configDirectory, "mutation.lock.reclaim");
  if (!(await isPathPhysicallyInside(workspaceRoot, configDirectory))
    || !(await isPathPhysicallyInside(workspaceRoot, lockPath))
    || !(await isPathPhysicallyInside(workspaceRoot, reclaimPath))
    || !(await isPathPhysicallyInside(workspaceRoot, legacyLockPath))
    || !(await isPathPhysicallyInside(workspaceRoot, legacyReclaimPath))) {
    throw new SddError(`Mutation lock path resolves outside its owner root: ${lockPath}`, {
      code: "UNSAFE_CONFIG_PATH",
    });
  }
  const authorityBinding = await captureMutationAuthority(workspaceRoot, configDirectory);
  let handle;
  let openedState;
  const token = randomUUID();
  let lockSource = createMutationLockSource(authorityBinding, token);

  for (let attempt = 0; attempt < 4 && !handle; attempt += 1) {
    if (await lstat(reclaimPath).then(() => true, (error) => {
      if (error?.code === "ENOENT") return false;
      throw error;
    })) {
      throw operationInProgressError(lockPath, null, [
        `Stale-lock reclamation requires inspection: ${reclaimPath}`,
      ]);
    }
    try {
      handle = await openFile(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(lockSource);
        await handle.sync();
        openedState = await handle.stat();
      } catch (error) {
        const opened = await handle.stat().catch(() => null);
        const closeError = await handle.close().then(() => null, (closeFailure) => closeFailure);
        handle = null;
        let cleanupError = null;
        if (opened) {
          try {
            await releaseObservedLock(
              lockPath,
              reclaimPath,
              { state: opened },
              {},
            );
          } catch (cleanupFailure) {
            cleanupError = cleanupFailure;
          }
        } else {
          cleanupError = mutationLockCleanupError(lockPath, [lockPath]);
        }
        const cleanupFailures = [
          ...(cleanupError
            ? [{ label: "Acquisition cleanup", error: cleanupError }]
            : []),
          ...(closeError ? [{ label: "Close", error: closeError }] : []),
        ];
        if (cleanupFailures.length > 0) {
          throw mutationLockAggregateError(lockPath, error, cleanupFailures);
        }
        throw error;
      }
      if (await lstat(reclaimPath).then(() => true, (error) => {
        if (error?.code === "ENOENT") return false;
        throw error;
      })) {
        const ownershipError = operationInProgressError(lockPath, null, [
          `Stale-lock reclamation won the acquisition race: ${reclaimPath}`,
        ]);
        const closeError = await handle.close().then(
          () => null,
          (closeFailure) => closeFailure,
        );
        handle = null;
        let removalError = null;
        try {
          await removeObservedLock(
            lockPath,
            { state: openedState, source: lockSource },
            "lock-reclaim-race",
          );
        } catch (error) {
          removalError = error;
        }
        const cleanupFailures = [
          ...(removalError ? [{ label: "Acquisition cleanup", error: removalError }] : []),
          ...(closeError ? [{ label: "Close", error: closeError }] : []),
        ];
        if (cleanupFailures.length > 0) {
          throw mutationLockAggregateError(lockPath, ownershipError, cleanupFailures);
        }
        throw ownershipError;
      }
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const observed = await observeLock(lockPath);
      if (!observed) continue;
      const owner = parseLockOwner(observed.source);
      if (!observed.regular) {
        throw operationInProgressError(lockPath, owner, [
          "The visible mutation lock is not one bound regular file.",
        ]);
      }
      if (!canonicalLockOwnerMatchesAuthority(owner, authorityBinding)) {
        throw operationInProgressError(lockPath, owner, [
          "The canonical lock is missing or mismatches required workspace/configuration-directory identities.",
          "Opaque retained authority must be inspected manually instead of reclaimed as stale.",
        ]);
      }
      if (isLockOwnerAlive(owner)) throw operationInProgressError(lockPath, owner);
      if (afterStaleLockObserved) await afterStaleLockObserved({ lockPath, owner });
      if (await reclaimStaleLock(
        lockPath,
        reclaimPath,
        observed,
        owner,
        afterStaleReclaimLinked,
        afterStaleLockQuarantined,
      )) {
        continue;
      }
    }
  }

  if (!handle) {
    throw operationInProgressError(lockPath, null, [
      "The lock changed repeatedly while stale-lock recovery was attempted.",
    ]);
  }

  const expectedLock = {
    path: lockPath,
    state: openedState,
    source: lockSource,
  };
  let result;
  let callbackError = null;
  let callbackFailed = false;
  let authorityError = null;
  let callbackStarted = false;

  try {
    if (!authorityBinding.configState) {
      await assertMutationAuthority(authorityBinding, expectedLock, "during lock acquisition");
      await createAndBindConfigDirectory(authorityBinding, expectedLock, createDirectory);
      lockSource = await rewriteMutationLockSource(
        handle,
        expectedLock,
        authorityBinding,
        token,
      );
    }
    await assertMutationAuthority(authorityBinding, expectedLock, "before the callback");
  } catch (error) {
    if (error?.retainedPaths?.includes(lockPath)) {
      authorityError = error;
    } else {
      callbackFailed = true;
      callbackError = error;
    }
  }
  let legacyGuardLinked = false;
  for (
    let attempt = 0;
    attempt < 4 && !authorityError && !callbackFailed && !legacyGuardLinked;
    attempt += 1
  ) {
    if (await lstatOrNull(legacyReclaimPath)) {
      callbackFailed = true;
      callbackError = operationInProgressError(legacyLockPath, null, [
        `Legacy stale-lock reclamation requires inspection: ${legacyReclaimPath}`,
      ]);
      break;
    }
    try {
      await link(lockPath, legacyLockPath);
      legacyGuardLinked = true;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        callbackFailed = true;
        callbackError = error;
        break;
      }
      let legacyLock;
      try {
        legacyLock = await observeLock(legacyLockPath);
      } catch (observationError) {
        callbackFailed = true;
        callbackError = observationError;
        break;
      }
      if (!legacyLock) continue;
      const legacyOwner = parseLockOwner(legacyLock.source);
      if (!legacyLock.regular) {
        callbackFailed = true;
        callbackError = operationInProgressError(legacyLockPath, legacyOwner, [
          "The visible legacy mutation guard is not one bound regular file.",
        ]);
        break;
      }
      if (!legacyLockOwnerMatchesAuthority(legacyOwner, authorityBinding)) {
        callbackFailed = true;
        callbackError = operationInProgressError(legacyLockPath, legacyOwner, [
          "The legacy guard is bound to a different workspace or configuration-directory identity.",
          "Retained authority must be inspected manually instead of reclaimed as stale.",
        ]);
        break;
      }
      if (isLockOwnerAlive(legacyOwner)) {
        callbackFailed = true;
        callbackError = operationInProgressError(legacyLockPath, legacyOwner, [
          "A pre-existing config-directory lock was observed while the workspace-root guard was held.",
        ]);
        break;
      }
      try {
        await reclaimStaleLock(
          legacyLockPath,
          legacyReclaimPath,
          legacyLock,
          legacyOwner,
          null,
          null,
        );
      } catch (reclaimError) {
        callbackFailed = true;
        callbackError = reclaimError;
      }
    }
  }
  if (!authorityError && !callbackFailed && !legacyGuardLinked) {
    callbackFailed = true;
    callbackError = operationInProgressError(legacyLockPath, null, [
      "The legacy guard changed repeatedly while stale-lock recovery was attempted.",
    ]);
  }
  if (legacyGuardLinked) {
    let legacyGuard;
    try {
      legacyGuard = await observeLock(legacyLockPath);
    } catch (error) {
      authorityError = mutationLockCleanupError(
        lockPath,
        [lockPath, legacyLockPath],
        error,
        "Legacy guard acquisition",
      );
    }
    if (!authorityError && !observedLockMatches(legacyGuard, expectedLock)) {
      authorityError = mutationLockCleanupError(
        lockPath,
        [lockPath, ...(legacyGuard ? [legacyLockPath] : [])],
        null,
        "Legacy guard acquisition",
      );
    }
    if (!authorityError) expectedLock.legacyPath = legacyLockPath;
  }
  if (!authorityError && !callbackFailed) {
    try {
      await assertMutationAuthority(authorityBinding, expectedLock, "before the callback");
    } catch (error) {
      authorityError = error;
    }
  }
  if (!authorityError && !callbackFailed) {
    callbackStarted = true;
    try {
      result = await callback({
        path: lockPath,
        source: lockSource,
        identity: {
          dev: String(openedState.dev),
          ino: String(openedState.ino),
        },
      });
    } catch (error) {
      callbackFailed = true;
      callbackError = error;
    }
  }

  if (callbackStarted) {
    try {
      await assertMutationAuthority(authorityBinding, expectedLock, "during the callback");
    } catch (error) {
      authorityError = error;
    }
  }

  const closeError = await handle.close().then(() => null, (error) => error);
  let releaseError = null;
  if (!authorityError) {
    try {
      await releaseObservedLock(
        lockPath,
        reclaimPath,
        { state: openedState, source: lockSource },
        {
          afterReleaseGuardLinked,
          afterLockObserved,
          afterLockQuarantined,
          afterOwnedPathObserved,
        },
      );
    } catch (error) {
      releaseError = expectedLock.legacyPath
        ? mutationLockAggregateError(lockPath, null, [
            { label: "Root guard release", error },
            {
              label: "Legacy guard retained",
              error: mutationLockCleanupError(
                lockPath,
                [legacyLockPath],
                error,
                "Root guard release",
              ),
            },
          ])
        : error;
    }
  }
  let legacyReleaseError = null;
  if (!authorityError && !releaseError && expectedLock.legacyPath) {
    try {
      await releaseObservedLock(
        legacyLockPath,
        legacyReclaimPath,
        { state: openedState, source: lockSource },
        { afterOwnedPathObserved },
      );
    } catch (error) {
      legacyReleaseError = error;
    }
  }

  const primaryFailed = callbackFailed || Boolean(authorityError);
  const primaryError = callbackFailed
    ? callbackError ?? new Error("Mutation callback threw without an error value.")
    : authorityError;
  const cleanupFailures = [
    ...(callbackFailed && authorityError
      ? [{ label: "Authority binding", error: authorityError }]
      : []),
    ...(legacyReleaseError ? [{ label: "Legacy release", error: legacyReleaseError }] : []),
    ...(releaseError ? [{ label: "Release", error: releaseError }] : []),
    ...(closeError ? [{ label: "Close", error: closeError }] : []),
  ];
  if (primaryFailed) {
    if (cleanupFailures.length > 0) {
      throw mutationLockAggregateError(lockPath, primaryError, cleanupFailures);
    }
    throw primaryError;
  }
  if (cleanupFailures.length > 1) {
    throw mutationLockAggregateError(lockPath, null, cleanupFailures);
  }
  if (legacyReleaseError) throw legacyReleaseError;
  if (releaseError) throw releaseError;
  if (closeError) {
    throw mutationLockCleanupError(lockPath, [], closeError, "Close");
  }
  return result;
}
