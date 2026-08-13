import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { assertValidRepositoryConfig } from "../config.js";
import { SddError } from "../errors.js";
import { resolveWorkspaceContext } from "../workspace.js";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;
const SAFE_GIT_CONFIG = Object.freeze([
  "-c", "core.fsmonitor=false",
  "-c", "diff.external=",
  "-c", "diff.trustExitCode=false",
]);
const safeRepositoryConfig = new Map();

function normalizePath(value) {
  return value.split("\\").join("/");
}

function gitFailure(message, details = []) {
  return new SddError(message, { code: "GIT_CANDIDATE_UNAVAILABLE", details });
}

function gitEnvironment() {
  return {
    ...process.env,
    GIT_EXTERNAL_DIFF: "",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_OPTIONAL_LOCKS: "0",
  };
}

async function execGit(repositoryRoot, config, args, { allowExitCodeOne = false } = {}) {
  try {
    return await execFileAsync(
      "git",
      [...SAFE_GIT_CONFIG, ...config, "-C", repositoryRoot, ...args],
      {
        encoding: "utf8",
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
        killSignal: "SIGTERM",
        env: gitEnvironment(),
      },
    );
  } catch (error) {
    if (allowExitCodeOne && error?.code === 1) return error;
    const detail = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    throw gitFailure(`Git could not resolve the candidate in ${repositoryRoot}.`, [
      `Git operation: ${args[0] ?? "unknown"}`,
      ...(detail ? [detail] : []),
    ]);
  }
}

async function repositoryFilterOverrides(repositoryRoot) {
  if (safeRepositoryConfig.has(repositoryRoot)) return safeRepositoryConfig.get(repositoryRoot);
  const result = await execGit(
    repositoryRoot,
    [],
    ["config", "--null", "--name-only", "--get-regexp", "^filter\\..*\\.(clean|process|required)$"],
    { allowExitCodeOne: true },
  );
  const names = result?.code === 1
    ? []
    : result.stdout.split("\0").filter(Boolean).flatMap((key) => {
      const match = /^filter\.(.+)\.(?:clean|process|required)$/.exec(key);
      return match ? [match[1]] : [];
    });
  const config = [...new Set(names)].flatMap((name) => [
    "-c", `filter.${name}.clean=cat`,
    "-c", `filter.${name}.process=`,
    "-c", `filter.${name}.required=false`,
  ]);
  safeRepositoryConfig.set(repositoryRoot, config);
  return config;
}

async function git(repositoryRoot, args, options = {}) {
  return execGit(repositoryRoot, await repositoryFilterOverrides(repositoryRoot), args, options);
}

async function resolveCommit(repositoryRoot, ref, label) {
  if (typeof ref !== "string" || ref.trim().length === 0 || ref.startsWith("-")) {
    throw new SddError(`${label} requires a non-empty Git ref that does not begin with option syntax.`, {
      code: "INVALID_GIT_REF",
    });
  }
  try {
    const { stdout } = await git(repositoryRoot, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${ref}^{commit}`,
    ]);
    return stdout.trim();
  } catch (error) {
    if (error instanceof SddError) {
      throw new SddError(`Cannot resolve ${label} as an immutable commit: ${ref}`, {
        code: "GIT_REF_NOT_FOUND",
        details: error.details,
      });
    }
    throw error;
  }
}

function parseNameStatus(source) {
  const fields = source.split("\0");
  if (fields.at(-1) === "") fields.pop();
  const rows = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!status) continue;
    if (status.startsWith("R") || status.startsWith("C")) {
      const from = normalizePath(fields[index++] ?? "");
      const path = normalizePath(fields[index++] ?? "");
      rows.push({ status, from, path });
    } else {
      rows.push({ status, path: normalizePath(fields[index++] ?? "") });
    }
  }
  return rows;
}

function parsePaths(source) {
  return source.split("\0").filter(Boolean).map(normalizePath).sort((left, right) => left.localeCompare(right));
}

async function assertAncestor(repositoryRoot, baseline, candidate) {
  const result = await git(
    repositoryRoot,
    ["merge-base", "--is-ancestor", baseline, candidate],
    { allowExitCodeOne: true },
  );
  if (result?.code === 1) {
    throw new SddError("Candidate baseline is not an ancestor of the committed candidate.", {
      code: "BASELINE_NOT_ANCESTOR",
      details: [`Baseline: ${baseline}`, `Candidate: ${candidate}`],
    });
  }
}

async function committedCandidate(repositoryRoot, baseline, candidateRef) {
  const commit = await resolveCommit(repositoryRoot, candidateRef, "--candidate");
  await assertAncestor(repositoryRoot, baseline, commit);
  const { stdout } = await git(repositoryRoot, [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--name-status",
    "-z",
    "--find-renames",
    baseline,
    commit,
    "--",
  ]);
  return {
    candidate: { kind: "commit", commit, watermark: commit },
    changedPaths: parseNameStatus(stdout),
  };
}

async function untrackedEntries(repositoryRoot, paths) {
  const entries = [];
  for (const path of paths) {
    const absolutePath = resolve(repositoryRoot, path);
    const state = await lstat(absolutePath);
    if (!state.isFile()) {
      throw new SddError(`Candidate contains an unsupported untracked filesystem entry: ${path}`, {
        code: "UNSUPPORTED_UNTRACKED_ENTRY",
      });
    }
    const bytes = await readFile(absolutePath);
    entries.push({
      path,
      type: "file",
      mode: state.mode & 0o777,
      size: bytes.length,
      hash: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return entries;
}

async function captureWorkingTree(repositoryRoot, baseline) {
  const head = await resolveCommit(repositoryRoot, "HEAD", "working-tree HEAD");
  await assertAncestor(repositoryRoot, baseline, head);
  const [
    { stdout: stagedSource },
    { stdout: unstagedSource },
    { stdout: untrackedSource },
    { stdout: diffSource },
    { stdout: trackedPatch },
  ] = await Promise.all([
    git(repositoryRoot, ["diff", "--no-ext-diff", "--no-textconv", "--cached", "--name-only", "-z", "--"]),
    git(repositoryRoot, ["diff", "--no-ext-diff", "--no-textconv", "--name-only", "-z", "--"]),
    git(repositoryRoot, ["ls-files", "-z", "--others", "--exclude-standard"]),
    git(repositoryRoot, ["diff", "--no-ext-diff", "--no-textconv", "--name-status", "-z", "--find-renames", baseline, "--"]),
    git(repositoryRoot, ["diff", "--no-ext-diff", "--no-textconv", "--binary", baseline, "--"]),
  ]);
  const staged = parsePaths(stagedSource);
  const unstaged = parsePaths(unstagedSource);
  const untracked = parsePaths(untrackedSource);
  const changedPaths = parseNameStatus(diffSource);
  const represented = new Set(changedPaths.flatMap((entry) => [entry.from, entry.path].filter(Boolean)));
  for (const path of untracked) {
    if (!represented.has(path)) changedPaths.push({ status: "?", path });
  }
  changedPaths.sort((left, right) => left.path.localeCompare(right.path) || left.status.localeCompare(right.status));
  const untrackedState = await untrackedEntries(repositoryRoot, untracked);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ head, staged, unstaged, untrackedState, changedPaths }))
    .update("\0")
    .update(trackedPatch)
    .digest("hex");
  return {
    candidate: {
      kind: "working-tree",
      head,
      watermark: `working-tree:${head}:sha256:${fingerprint}`,
      staged,
      unstaged,
      untracked,
    },
    changedPaths,
  };
}

async function workingTreeCandidate(repositoryRoot, baseline) {
  const first = await captureWorkingTree(repositoryRoot, baseline);
  const second = await captureWorkingTree(repositoryRoot, baseline);
  if (first.candidate.watermark !== second.candidate.watermark) {
    throw new SddError("Working-tree candidate changed while its envelope was being resolved.", {
      code: "CONCURRENT_CHANGE",
      details: [
        `First candidate: ${first.candidate.watermark}`,
        `Second candidate: ${second.candidate.watermark}`,
      ],
    });
  }
  return second;
}

export async function resolveCandidateEnvelope(
  startPath,
  {
    workspaceRoot: requestedWorkspaceRoot = null,
    baseline: baselineRef,
    candidate: candidateRef = "working-tree",
  } = {},
) {
  const context = await resolveWorkspaceContext(
    resolve(startPath),
    requestedWorkspaceRoot ? { workspaceRoot: requestedWorkspaceRoot } : {},
  );
  if (context.kind !== "repository" || !context.repositoryConfig || !context.repository) {
    throw new SddError("candidate resolve requires an initialized repository target.", {
      code: "REPOSITORY_REQUIRED",
    });
  }
  const repositoryConfig = assertValidRepositoryConfig(context.repositoryConfig);
  const repositoryRoot = resolve(context.workspaceRoot, context.repository.resolvedPath);
  const baseline = await resolveCommit(repositoryRoot, baselineRef, "--baseline");
  const resolvedCandidate = candidateRef === "working-tree"
    ? await workingTreeCandidate(repositoryRoot, baseline)
    : await committedCandidate(repositoryRoot, baseline, candidateRef);

  return {
    command: "candidate-resolve",
    workspaceRoot: context.workspaceRoot,
    spaceId: context.spaceId,
    repository: {
      id: repositoryConfig.id,
      root: repositoryRoot,
    },
    baseline,
    ...resolvedCandidate,
  };
}
