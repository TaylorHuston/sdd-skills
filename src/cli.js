import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

import { resolveCandidateEnvelope } from "./commands/candidate-resolve.js";
import { configureWorkspace } from "./commands/configure.js";
import { getWorkspaceContext } from "./commands/context.js";
import { closeChange } from "./commands/change-close.js";
import { createChange } from "./commands/change-create.js";
import { transitionChange } from "./commands/change-transition.js";
import { diagnoseWorkspace } from "./commands/doctor.js";
import { createEpic } from "./commands/epic-create.js";
import { resolveEpicUpdateInput } from "./commands/epic-update-input.js";
import { initRepository, setupInstallation } from "./commands/init-installation.js";
import { getStatus } from "./commands/status.js";
import { updateWorkspace } from "./commands/update.js";
import { validateArtifacts } from "./commands/validate.js";
import { repositoryMatchesSelector } from "./change-repositories.js";
import {
  assertValidConfig,
  assertValidRepositoryConfig,
  findRepositoryRoot,
  readRepositoryConfig,
  readWorkspaceConfig,
  resolveRepositoryPath,
  resolveWorkspacePath,
} from "./config.js";
import { isPathPhysicallyInside, resolvePhysicalPath } from "./fs.js";
import { PACKAGE_JSON_PATH } from "./constants.js";
import { SddError } from "./errors.js";
import {
  collectConfigureOptions,
  collectSetupOptions,
} from "./prompts.js";
import { findOperationConfiguration } from "./workspace.js";

const HELP = `Story-Driven Development CLI

Usage:
  sdd setup [workspace-path] [options]  Set up one workspace installation and managed skills
  sdd init [path] [options]             Initialize one repository
  sdd configure [path] [options]        Repair configured workspace topology paths
  sdd update [path] [options]           Reconcile managed workflow and skills
  sdd doctor [path] [options]           Validate the workspace installation and mapped artifacts
  sdd context [path] [options]          Resolve planning/repository context in one workspace
  sdd status [space-id] [options]       List Space status or show one Space in detail
  sdd validate [space-id] [options]     Validate SDD artifact structure and references
  sdd candidate resolve [options]       Resolve one exact repository diff envelope
  sdd epic create [options]             Scaffold a canonical Epic in one repository
  sdd epic update-input [options]       Resolve one exact Epic-update diff envelope
  sdd change create [options]           Scaffold a workspace-central Change for a Space
  sdd change transition [options]       Guard one active Change status transition
  sdd change close [options]            Move an in-review Change into workspace closed history
  sdd --version                         Print the package version

Setup options:
  --planning-root <path>          Override detected planning root
  --repository-root <path>        Add a repository root; may be repeated
  --skills-dir <path>             Managed skill directory inside the workspace (default: .agents/skills)
  --yes                           Accept detected paths without interactive questions
  --dry-run                       Report without writing files
  --force                         Replace conflicting destination managed workflow or skills
  --json                          Emit machine-readable JSON

Init options:
  --repo-id <id>                  Override the repository ID derived from the directory name
  --workspace <path>              Select the owning workspace explicitly
  --dry-run                       Report without writing files
  --json                          Emit machine-readable JSON

Configure options:
  --workspace <path>              Select the owning workspace explicitly
  --planning-root <path>          Set the planning root
  --repository-root <name=path>   Set a named repository root; may be repeated
  --yes                           Accept detected replacements without prompting
  --dry-run                       Report changes without writing configuration
  --json                          Emit machine-readable JSON

Doctor and context options:
  --workspace <path>              Select the owning workspace explicitly
  --json                          Emit machine-readable JSON

Update options:
  --workspace <path>              Select the owning workspace explicitly
  --dry-run                       Report without writing files
  --force                         Replace conflicting managed workflow or skills
  --json                          Emit machine-readable JSON

Status options:
  --workspace <path>              Select the owning workspace explicitly
  --all                           Include inactive and archived ideas and repositories
  --json                          Emit machine-readable JSON

Validate options:
  --workspace <path>              Select the owning workspace explicitly
  --repo <path>                   Select a mapped repository; may be repeated
  --change <change-id>            Validate one active or closed Change
  --epic <epic-id>                Validate one Epic
  --changed-from <commit-ish>     Check Epic modified metadata against a Git baseline
  --json                          Emit machine-readable JSON

Candidate resolve usage:
  sdd candidate resolve [repository-path] --baseline <commit-ish> [options]

Candidate resolve options:
  --workspace <path>              Select the owning workspace explicitly
  --baseline <commit-ish>         Resolve the immutable beginning of the candidate range
  --candidate <value>             working-tree (default) or an explicit commit/ref
  --json                          Emit machine-readable JSON

Epic create usage:
  sdd epic create <space-id> <epic-id> <slug> [options]

Epic create options:
  --workspace <path>              Select the owning workspace explicitly
  --repo <path>                   Select the target mapped repository
  --date <yyyy-mm-dd>             Override the local creation date
  --dry-run                       Report the scaffold without writing files
  --json                          Emit machine-readable JSON

Epic update-input usage:
  sdd epic update-input [repository-path] --baseline <commit-ish> [options]

Epic update-input options:
  --workspace <path>              Select the owning workspace explicitly
  --baseline <commit-ish>         Resolve the immutable beginning of the candidate range
  --candidate <value>             working-tree (default) or an explicit commit/ref
  --json                          Emit machine-readable JSON

Change create usage:
  sdd change create <space-id> <slug> [options]

Change create options:
  --workspace <path>              Select the owning workspace explicitly
  --repo <path>                   Select a mapped repository; may be repeated
  --date <yyyy-mm-dd>             Override the local creation date
  --dry-run                       Report the scaffold without writing files
  --json                          Emit machine-readable JSON


Change transition usage:
  sdd change transition <space-id> <change-id> --from <status> --to <status> [options]

Change transition options:
  --workspace <path>              Select the owning workspace explicitly
  --from <status>                 Require the current active Change status
  --to <status>                   Set the next allowed active Change status
  --dry-run                       Report the transition without writing change.md
  --json                          Emit machine-readable JSON

Change close usage:
  sdd change close <space-id> <change-id> [options]

Change close options:
  --workspace <path>              Select the owning workspace explicitly
  --dry-run                       Report the closeout without moving files
  --json                          Emit machine-readable JSON
`;

const UPDATE_HELP = `SDD Update

Usage:
  sdd update [path] [options]

Reconcile the selected workspace's checksum-managed workflow and packaged skills.

Options:
  --workspace <path>  Select the owning workspace explicitly
  --dry-run           Report changes without writing files
  --force             Replace conflicting managed workflow or skills
  --json              Emit machine-readable JSON
  --help, -h          Show this help
`;

const VALIDATE_HELP = `SDD Validate

Usage:
  sdd validate [space-id] [options]

Validate central Changes, structured Requirement slices and checkpoints, repository Epics, verification reports, ownership, references, and optional Git-relative freshness.

Options:
  --workspace <path>          Select the owning workspace explicitly
  --repo <path>               Select a mapped repository; may be repeated
  --change <change-id>        Validate one active or closed Change
  --epic <epic-id>            Validate one Epic
  --changed-from <commit-ish> Check Epic modified metadata against a Git baseline
  --json                      Emit machine-readable JSON
  --help, -h                  Show this help
`;

const CHANGE_HELP = `SDD Change commands

Usage:
  sdd change create <space-id> <slug> [options]
  sdd change transition <space-id> <change-id> --from <status> --to <status> [options]
  sdd change close <space-id> <change-id> [options]

Commands:
  create      Scaffold one canonical workspace-central Change
  transition  Guard and apply an allowed active Change status transition
  close       Move an in-review Change into workspace closed history

Shared options:
  --workspace <path>  Select the owning workspace explicitly
  --dry-run           Report without writing files
  --json              Emit machine-readable JSON
`;

const CANDIDATE_HELP = `SDD Candidate commands

Usage:
  sdd candidate resolve [repository-path] --baseline <commit-ish> [options]

Commands:
  resolve  Resolve a safe read-only diff envelope for candidate-bound capabilities

Resolve options:
  --workspace <path>  Select the owning workspace explicitly
  --baseline <ref>    Resolve the immutable beginning of the candidate range
  --candidate <value> working-tree (default) or an explicit commit/ref
  --json              Emit machine-readable JSON
`;

const EPIC_HELP = `SDD Epic commands

Usage:
  sdd epic create <space-id> <epic-id> <slug> [options]
  sdd epic update-input [repository-path] --baseline <commit-ish> [options]

Commands:
  create        Scaffold and structurally validate a canonical Epic
  update-input  Resolve a safe read-only diff envelope for /sdd-epic-update

Create options:
  --workspace <path>  Resolve the initialized workspace (default: current directory)
  --repo <path>       Select the target mapped repository
  --date <yyyy-mm-dd> Override the local creation date
  --dry-run           Report without writing files

Update-input options:
  --workspace <path>  Select the owning workspace explicitly
  --baseline <ref>    Resolve the immutable beginning of the candidate range
  --candidate <value> working-tree (default) or an explicit commit/ref

Shared options:
  --json              Emit machine-readable JSON
`;

function commandOptions(extra = {}) {
  return {
    help: { type: "boolean", short: "h" },
    json: { type: "boolean" },
    ...extra,
  };
}

function parseCommandArgs(args, options) {
  return parseArgs({ args, options, allowPositionals: true, strict: true });
}
function requireNonEmptyPath(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SddError(`${label} requires a non-empty path.`, { code: "USAGE" });
  }
  return value;
}

function pathOption(values, name) {
  if (values[name] === undefined) return undefined;
  return requireNonEmptyPath(values[name], `--${name}`);
}

function terminalSafe(value) {
  return JSON.stringify(String(value));
}

function pathOptionValues(values, name) {
  if (values[name] === undefined) return undefined;
  if (!Array.isArray(values[name])) {
    throw new SddError(`--${name} requires a non-empty path.`, { code: "USAGE" });
  }
  return values[name].map((value) => requireNonEmptyPath(value, `--${name}`));
}

function resolvePathOption(values, name) {
  const value = pathOption(values, name);
  return value === undefined ? null : resolve(value);
}
function environmentWorkspaceAuthority() {
  const value = process.env.SDD_WORKSPACE_ROOT;
  return typeof value === "string" && value.trim().length > 0 ? resolve(value) : null;
}

function effectiveWorkspaceAuthority(requestedWorkspaceRoot = null) {
  return requestedWorkspaceRoot ?? environmentWorkspaceAuthority();
}



function requireAtMostOnePath(positionals, command) {
  if (positionals.length > 1) {
    throw new SddError(`${command} accepts at most one path.`, { code: "USAGE" });
  }
  return positionals[0] === undefined
    ? resolve(process.cwd())
    : resolve(requireNonEmptyPath(positionals[0], `${command} path`));
}
async function resolveConfiguredRepositoryStartPath(
  workspaceRoot,
  repositories,
  spaceId,
  { tolerateUnresolvedMappings = false } = {},
) {
  const config = assertValidConfig(
    await readWorkspaceConfig(workspaceRoot),
    "resolve a CLI repository target",
  );
  const configuredRepositoryRoots = Object.values(config.repositories.roots ?? {}).map(
    (configuredRoot) => resolveWorkspacePath(workspaceRoot, configuredRoot),
  );
  const hasConfiguredSpace = spaceId !== null
    && spaceId !== undefined
    && Object.hasOwn(config.ideas ?? {}, spaceId);
  const selector = repositories.length === 1
    ? repositories[0]
    : repositories.length === 0 && !hasConfiguredSpace
      && spaceId !== null && spaceId !== undefined
      ? spaceId
      : null;
  if (selector === null) {
    return { configuredRepositoryRoots, hasConfiguredSpace, targetPath: null };
  }

  const spaces = hasConfiguredSpace
    ? [[spaceId, config.ideas[spaceId]]]
    : Object.entries(config.ideas ?? {});
  const candidates = spaces.flatMap(([, space]) =>
    (space.repositories ?? []).map((repository) => ({
      ...repository,
      resolvedPath: resolveRepositoryPath(config, repository),
    })));

  const pathMatchResults = await Promise.allSettled(
    candidates.map((repository) =>
      repositoryMatchesSelector(workspaceRoot, repository, selector)),
  );
  const pathMatches = candidates.filter(
    (_, index) => pathMatchResults[index].status === "fulfilled"
      && pathMatchResults[index].value,
  );
  const pathMatchError = pathMatchResults.find((result) => result.status === "rejected");
  if (pathMatches.length === 1) {
    return {
      configuredRepositoryRoots,
      hasConfiguredSpace,
      targetPath: resolveWorkspacePath(workspaceRoot, pathMatches[0].resolvedPath),
    };
  }
  if (pathMatches.length > 1) {
    return { configuredRepositoryRoots, hasConfiguredSpace, targetPath: null };
  }

  const identityTargets = new Set([
    ...candidates.map((repository) =>
      resolveWorkspacePath(workspaceRoot, repository.resolvedPath)),
    ...configuredRepositoryRoots,
  ]);
  const identityMatches = [];
  for (const targetPath of identityTargets) {
    try {
      if ((await readRepositoryConfig(targetPath))?.id === selector) {
        identityMatches.push(targetPath);
      }
    } catch {
      // Selection reports malformed configured identities after target routing is settled.
    }
  }
  if (
    identityMatches.length === 0
    && pathMatchError
    && !tolerateUnresolvedMappings
  ) {
    throw pathMatchError.reason;
  }
  return {
    configuredRepositoryRoots,
    hasConfiguredSpace,
    targetPath: identityMatches.length === 1 ? identityMatches[0] : null,
  };
}

async function repositoryIsWithinConfiguredRoots(repositoryRoot, configuredRoots) {
  for (const configuredRoot of configuredRoots) {
    if (await isPathPhysicallyInside(configuredRoot, repositoryRoot)) return true;
  }
  return false;
}

// Configured authority must not erase an explicitly identified repository target,
// but it also must not turn an unrelated checkout into an implicit target.
async function resolveCommandStartPath(
  workspaceRoot = null,
  repositories = [],
  spaceId = null,
  { observational = false } = {},
) {
  if (repositories.length === 1 && isAbsolute(repositories[0])) {
    return resolve(repositories[0]);
  }
  const cwd = resolve(process.cwd());
  const authorityWorkspaceRoot = effectiveWorkspaceAuthority(workspaceRoot);
  if (authorityWorkspaceRoot === null) return cwd;
  const configured = await resolveConfiguredRepositoryStartPath(
    authorityWorkspaceRoot,
    repositories,
    spaceId,
    { tolerateUnresolvedMappings: observational },
  );
  if (configured.targetPath) return configured.targetPath;
  if (configured.hasConfiguredSpace) return authorityWorkspaceRoot;

  let cwdRepositoryRoot = null;
  let cwdRepositoryConfig = null;
  try {
    cwdRepositoryRoot = await findRepositoryRoot(cwd);
    cwdRepositoryConfig = cwdRepositoryRoot
      ? assertValidRepositoryConfig(await readRepositoryConfig(cwdRepositoryRoot))
      : null;
  } catch {
    // An unrelated malformed checkout cannot override configured workspace authority.
  }
  if (
    (spaceId === null || spaceId === undefined)
    && repositories.length === 0
    && cwdRepositoryConfig
  ) {
    const configuredCwd = await resolveConfiguredRepositoryStartPath(
      authorityWorkspaceRoot,
      [cwdRepositoryConfig.id],
      null,
      { tolerateUnresolvedMappings: observational },
    );
    if (configuredCwd.targetPath) {
      const [physicalCwdRepository, physicalConfiguredTarget] = await Promise.all([
        resolvePhysicalPath(cwdRepositoryRoot),
        resolvePhysicalPath(configuredCwd.targetPath),
      ]);
      if (physicalCwdRepository === physicalConfiguredTarget) {
        return configuredCwd.targetPath;
      }
    }
    if (await repositoryIsWithinConfiguredRoots(
      cwdRepositoryRoot,
      configured.configuredRepositoryRoots,
    )) {
      return cwdRepositoryRoot;
    }
    return authorityWorkspaceRoot;
  }
  if (
    (
      cwdRepositoryConfig?.id === spaceId
      || repositories.includes(cwdRepositoryConfig?.id)
    )
    && await repositoryIsWithinConfiguredRoots(
      cwdRepositoryRoot,
      configured.configuredRepositoryRoots,
    )
  ) {
    return cwdRepositoryRoot;
  }
  return authorityWorkspaceRoot;
}

// Contained selectors use portable workspace paths; external selectors retain absolute identity.
function normalizeRepositorySelectors(workspaceRoot = null, repositories = []) {
  if (!workspaceRoot) return repositories;
  const resolvedWorkspaceRoot = resolve(workspaceRoot);
  return repositories.map((repository) => {
    if (!isAbsolute(repository)) return repository;
    const resolvedRepository = resolve(repository);
    const workspaceRelative = relative(resolvedWorkspaceRoot, resolvedRepository)
      .split("\\")
      .join("/");
    return workspaceRelative === ".." || workspaceRelative.startsWith("../")
      ? resolvedRepository.split("\\").join("/")
      : workspaceRelative || ".";
  });
}

function requireCommandPath(positionals, command, defaultPath = null) {
  if (positionals.length > 1) {
    throw new SddError(`${command} accepts at most one path.`, { code: "USAGE" });
  }
  const selected = positionals[0] !== undefined
    ? positionals[0]
    : defaultPath ?? process.cwd();
  return resolve(requireNonEmptyPath(selected, `${command} path`));
}



function parseRepositoryRootOverrides(values = []) {
  const roots = {};
  for (const value of values) {
    const separator = value.indexOf("=");
    const rootId = separator === -1 ? "" : value.slice(0, separator).trim();
    const path = separator === -1 ? "" : value.slice(separator + 1).trim();
    if (!rootId || !path) {
      throw new SddError(`Invalid repository root override: ${value}`, {
        code: "USAGE",
        details: ["Use --repository-root <name=path>, for example code=spaces/code."],
      });
    }
    roots[rootId] = path;
  }
  return roots;
}

function printSkillActions(actions) {
  const changed = actions.filter((entry) => !["unchanged", "adopt"].includes(entry.action));
  const adopted = actions.filter((entry) => entry.action === "adopt");
  console.log(`Managed skills: ${actions.length} (${changed.length} changed, ${adopted.length} adopted)`);
  for (const entry of actions.filter((item) => item.action !== "unchanged")) {
    console.log(`  ${entry.action}: ${entry.skillName}`);
  }
}

function printWorkflowAction(workflow) {
  console.log(`Workflow: ${workflow.action} (${workflow.path})`);
}

export function statusSummaryRows(result) {
  return result.spaces.flatMap((space) => {
    const projectedChangeIds = new Set();
    const repositoryRows = space.repositoryActivity.map((repository) => {
      const change = repository.activeChanges[0] ?? repository.change;
      if (change) projectedChangeIds.add(change.changeId);
      return [
        space.spaceId,
        space.status,
        repository.status,
        repository.role ?? "-",
        change?.status ?? "-",
        change?.changeId ?? "-",
        repository.resolvedPath,
        repository.activeChangeCount,
      ];
    });
    const changes = space.activeChanges.length > 0
      ? space.activeChanges
      : space.recentChanges;
    const spaceRows = changes
      .filter((change) => change.unresolvedRepositoryIds.length > 0
        || !projectedChangeIds.has(change.changeId))
      .map((change) => {
        const unresolved = change.unresolvedRepositoryIds.length > 0;
        return [
          space.spaceId,
          space.status,
          "-",
          unresolved ? "unresolved" : "space",
          change.status,
          change.changeId,
          (unresolved ? change.unresolvedRepositoryIds : change.repositories).join(",") || "-",
          0,
        ];
      });
    if (repositoryRows.length + spaceRows.length > 0) {
      return [...repositoryRows, ...spaceRows];
    }
    return [[space.spaceId, space.status, "-", "-", "-", "-", "-", 0]];
  });
}

function formatGitStatus(git) {
  if (!git?.available) return `unavailable (${git?.error ?? "unknown error"})`;
  const location = git.detached
    ? `detached at ${git.head?.slice(0, 12) ?? "unknown commit"}`
    : git.branch ?? "unknown branch";
  if (!git.dirty) return `${location}, clean`;
  const counts = [
    git.staged > 0 ? `${git.staged} staged` : null,
    git.unstaged > 0 ? `${git.unstaged} unstaged` : null,
    git.untracked > 0 ? `${git.untracked} untracked` : null,
    git.conflicted > 0 ? `${git.conflicted} conflicted` : null,
  ].filter(Boolean);
  return `${location}, dirty${counts.length > 0 ? ` (${counts.join(", ")})` : ""}`;
}

function printRepositoryDiagnostics(diagnostics, indent = "") {
  for (const diagnostic of diagnostics ?? []) {
    console.log(`${indent}Repository diagnostic [${diagnostic.code}]: ${diagnostic.message}`);
  }
}

function printStatus(result) {
  if (result.mode === "summary") {
    console.log(`SDD workspace: ${result.workspaceRoot}`);
    if (result.spaces.length === 0) {
      console.log(result.filter === "all" ? "No configured ideas." : "No active ideas.");
      return;
    }
    console.log(`Ideas (${result.spaces.length}, ${result.filter}):`);
    for (const space of result.spaces) {
      console.log("");
      console.log(`${space.spaceId} [${space.status}]`);
      console.log(`  Planning: ${space.planningPath}`);
      console.log(`  Active Changes: ${space.activeChangeCount}`);
      const projectedChangeIds = new Set(
        space.repositoryActivity
          .map((repository) => repository.activeChanges[0] ?? repository.change)
          .filter(Boolean)
          .map((change) => change.changeId),
      );
      const changes = space.activeChanges.length > 0
        ? space.activeChanges
        : space.recentChanges;
      for (const change of changes.filter(
        (entry) => entry.unresolvedRepositoryIds.length > 0
          || !projectedChangeIds.has(entry.changeId),
      )) {
        const unresolved = change.unresolvedRepositoryIds.length > 0;
        const paths = unresolved
          ? change.unresolvedRepositoryIds
          : change.repositories;
        console.log(
          `    Space Change: ${change.changeId} [${change.status}] (${paths.join(", ") || "-"})`,
        );
      }
      printRepositoryDiagnostics(space.repositoryDiagnostics, "  ");
      if (space.repositoryActivity.length === 0) {
        console.log("  Repositories: none");
        continue;
      }
      for (const repository of space.repositoryActivity) {
        const change = repository.activeChanges[0] ?? repository.change;
        console.log(
          `  Repository: ${repository.resolvedPath} [${repository.status}]${repository.role ? ` (${repository.role})` : ""}`,
        );
        console.log(`    Git: ${formatGitStatus(repository.git)}`);
        if (!change) {
          console.log("    Change: none");
        } else {
          console.log(
            `    ${change.closed ? "Latest Change" : "Active Change"}: ${change.changeId} [${change.status}]`,
          );
        }
        if (repository.activeChangeCount > 1) {
          console.log(`    Active Changes: ${repository.activeChangeCount}`);
        }
      }
    }
    return;
  }

  console.log(`Space: ${result.spaceId} [${result.status}]`);
  console.log(`Planning path: ${result.planningPath}`);
  console.log(`Active Changes (${result.activeChangeCount}):`);
  if (result.activeChangeCount === 0) console.log("  none");
  for (const change of result.activeChanges) {
    const unresolved = change.unresolvedRepositoryIds.length > 0
      ? `; unresolved: ${change.unresolvedRepositoryIds.join(", ")}`
      : "";
    console.log(`  ${change.changeId} [${change.status}${unresolved}]`);
  }
  printRepositoryDiagnostics(result.repositoryDiagnostics);
  if (result.repositoryDetails.length === 0) {
    console.log("Repositories: none");
    return;
  }
  for (const repository of result.repositoryDetails) {
    console.log("");
    console.log(
      `Repository: ${repository.resolvedPath}${repository.role ? ` (${repository.role})` : ""} [${repository.status}]`,
    );
    console.log(`Git: ${formatGitStatus(repository.git)}`);
    console.log(`Active Changes (${repository.activeChangeCount}):`);
    if (repository.activeChangeCount === 0) console.log("  none");
    for (const change of repository.activeChanges) {
      console.log(`  ${change.changeId} [${change.status}]`);
    }
    console.log(`Epics (${repository.epics.length}):`);
    if (repository.epics.length === 0) console.log("  none");
    for (const epic of repository.epics) {
      console.log(`  ${epic.id}${epic.status ? ` [${epic.status}]` : ""} ${epic.title}`);
    }
    console.log(`Recent Changes (${repository.recentChanges.length}):`);
    if (repository.recentChanges.length === 0) console.log("  none");
    for (const change of repository.recentChanges) {
      console.log(`  ${change.changeId} [${change.status}]`);
    }
  }
}

function printHuman(result) {
  if (result.command === "setup") {
    const verb = result.dryRun
      ? "Would set up"
      : result.createdWorkspaceConfig
        ? "Set up"
        : "Reconciled";
    console.log(`${verb} workspace SDD: ${result.workspaceConfigPath}`);
    console.log(`Workspace: ${result.workspaceRoot}`);
    console.log(`Workflow: ${result.workflowPath}`);
    if (result.skills?.actions) printSkillActions(result.skills.actions);
    return;
  }
  if (result.command === "init") {
    console.log(`${result.dryRun ? "Would initialize" : result.createdRepositoryConfig ? "Initialized" : "Reconciled"} repository SDD: ${result.repositoryConfigPath}`);
    console.log(`Repository ID: ${result.repositoryConfig.id}`);
    console.log(`Workspace: ${result.workspaceRoot}`);
    console.log(`Workspace configuration: ${result.workspaceConfigPath}`);
    console.log(`Doctrine: bundled with @taylorhuston/sdd`);
    return;
  }
  if (result.command === "update") {
    console.log(`${result.dryRun ? "Would update" : "Updated"} SDD workspace: ${result.workspaceRoot}`);
    printWorkflowAction(result.workflow);
    printSkillActions(result.skills.actions);
    return;
  }
  if (result.command === "configure") {
    console.log(
      `${result.dryRun ? "Would configure" : result.changed ? "Configured" : "Checked"} SDD workspace: ${result.workspaceRoot}`,
    );
    if (result.changes.length === 0) {
      console.log("No path changes required.");
      return;
    }
    for (const change of result.changes) {
      const label = change.kind === "planning" ? "Planning root" : `Repository root ${change.rootId}`;
      console.log(`${label}: ${change.from} -> ${change.to}`);
    }
    if (result.dryRun) console.log("Configuration was not written.");
    return;
  }
  if (result.command === "doctor") {
    console.log(`SDD workspace: ${result.workspaceRoot}`);
    if (result.findings.length === 0) {
      console.log("Healthy: no findings");
    } else {
      for (const finding of result.findings) {
        console.log(`${finding.level.toUpperCase()}: ${finding.message}`);
      }
      console.log(`Findings: ${result.counts.errors} error(s), ${result.counts.warnings} warning(s)`);
      for (const remediation of result.remediations ?? []) {
        console.log(`Next: ${remediation.message} Run \`${remediation.command}\`.`);
      }
    }
    return;
  }
  if (result.command === "context") {
    console.log(`Workspace: ${result.workspaceRoot}`);
    console.log(`Path: ${result.relativePath}`);
    console.log(`Context: ${result.kind}`);
    if (result.spaceId) console.log(`Space ID: ${result.spaceId}`);
    if (result.ideaStatus) console.log(`Idea status: ${result.ideaStatus}`);
    if (result.planningPath) console.log(`Planning path: ${result.planningPath}`);
    if (result.repository) {
      console.log(`Repository: ${result.repository.resolvedPath}`);
      if (result.repository.role) console.log(`Role: ${result.repository.role}`);
      console.log(`Repository status: ${result.repository.status}`);
    }
    return;
  }
  if (result.command === "status") {
    printStatus(result);
    console.log("");
    return;
  }
  if (result.command === "validate") {
    console.log(`SDD validation: ${result.valid ? "pass" : "findings"}`);
    console.log(`Workspace: ${result.workspaceRoot}`);
    if (result.scope.spaceId) console.log(`Space: ${result.scope.spaceId}`);
    if (result.scope.changeId) console.log(`Change: ${result.scope.changeId}`);
    if (result.scope.epicId) console.log(`Epic: ${result.scope.epicId}`);
    console.log(
      `Artifacts: ${result.summary.changes} Change(s), ${result.summary.epics} Epic(s)`,
    );
    for (const entry of result.findings) {
      console.log(`${entry.level.toUpperCase()} [${entry.code}] ${entry.path}: ${entry.message}`);
    }
    console.log(`Findings: ${result.summary.errors} error(s), ${result.summary.warnings} warning(s)`);
    return;
  }
  if (result.command === "candidate-resolve") {
    console.log(`Candidate: ${result.repository.id}`);
    console.log(`Repository: ${result.repository.root}`);
    console.log(`Baseline: ${result.baseline}`);
    console.log(`Candidate watermark: ${result.candidate.watermark}`);
    console.log(`Changed paths: ${result.changedPaths.length}`);
    for (const entry of result.changedPaths) {
      console.log(`  ${entry.status} ${entry.from ? `${terminalSafe(entry.from)} -> ` : ""}${terminalSafe(entry.path)}`);
    }
    return;
  }
  if (result.command === "epic-create") {
    console.log(`${result.dryRun ? "Would create" : "Created"} Epic: ${result.epicId}`);
    console.log(`Space: ${result.spaceId}`);
    console.log(`Repository: ${result.repository.resolvedPath}`);
    console.log(`Path: ${result.path}`);
    if (result.validation) {
      console.log(`Structural validation: ${result.validation.valid ? "pass" : "findings"}`);
    }
    return;
  }
  if (result.command === "epic-update-input") {
    console.log(`Epic update input: ${result.repository.id}`);
    console.log(`Repository: ${result.repository.root}`);
    console.log(`Baseline: ${result.baseline}`);
    console.log(`Candidate: ${result.candidate.watermark}`);
    console.log(`Changed paths: ${result.changedPaths.length}`);
    for (const entry of result.changedPaths) {
      console.log(`  ${entry.status} ${entry.from ? `${terminalSafe(entry.from)} -> ` : ""}${terminalSafe(entry.path)}`);
    }
    console.log(`Validate: ${result.validation.display}`);
    return;
  }
  if (result.command === "change-create") {
    console.log(`${result.dryRun ? "Would create" : "Created"} Change: ${result.changeId}`);
    console.log(`Space: ${result.spaceId}`);
    console.log(`Path: ${result.path}`);
    console.log(
      `Repositories: ${result.repositories.length > 0
        ? result.repositories.map((repository) => repository.resolvedPath).join(", ")
        : "none"}`,
    );
    console.log(`Files: ${result.files.join(", ")}`);
    return;
  }
  if (result.command === "change-transition") {
    console.log(
      `${result.dryRun ? "Would transition" : "Transitioned"} Change: ${result.changeId} (${result.from} -> ${result.to})`,
    );
    console.log(`Space: ${result.spaceId}`);
    console.log(`Change: ${result.changeFilePath}`);
    console.log(
      `Repositories: ${result.repositories.map((repository) => repository.resolvedPath).join(", ") || "none"}`,
    );
    return;
  }
  if (result.command === "change-close") {
    console.log(`${result.dryRun ? "Would close" : "Closed"} Change: ${result.changeId}`);
    console.log(`Space: ${result.spaceId}`);
    console.log(`Source: ${result.sourcePath}`);
    console.log(`Closed: ${result.path}`);
    console.log(
      `Repositories: ${result.repositories.map((repository) => repository.resolvedPath).join(", ") || "none"}`,
    );
  }
}

async function packageVersion() {
  return JSON.parse(await readFile(PACKAGE_JSON_PATH, "utf8")).version;
}

async function executeCommand(command, args) {
  if (command === "setup") {
    const { values, positionals } = parseCommandArgs(
      args,
      commandOptions({
        "planning-root": { type: "string" },
        "repository-root": { type: "string", multiple: true },
        "skills-dir": { type: "string" },
        yes: { type: "boolean", short: "y" },
        "dry-run": { type: "boolean" },
        force: { type: "boolean" },
      }),
    );
    if (values.help) return { help: true };
    const workspaceRoot = requireAtMostOnePath(positionals, command);
    const planningRoot = pathOption(values, "planning-root");
    const repositoryRoots = pathOptionValues(values, "repository-root");
    const skillsDirectory = pathOption(values, "skills-dir");
    const setupOptions = await collectSetupOptions(
      workspaceRoot,
      {
        planningRoot,
        repositoryRoots,
        skillsDirectory,
        dryRun: values["dry-run"] ?? false,
        force: values.force ?? false,
      },
      { interactive: !values.yes && Boolean(process.stdin.isTTY && process.stdout.isTTY) },
    );
    return {
      result: await setupInstallation(workspaceRoot, setupOptions),
      json: values.json ?? false,
    };
  }

  if (command === "init") {
    const { values, positionals } = parseCommandArgs(
      args,
      commandOptions({
        workspace: { type: "string" },
        "repo-id": { type: "string" },
        "dry-run": { type: "boolean" },
      }),
    );
    if (values.help) return { help: true };
    const repositoryRoot = requireAtMostOnePath(positionals, command);
    const requestedWorkspaceRoot = resolvePathOption(values, "workspace");
    const result = await initRepository(repositoryRoot, {
      repositoryId: values["repo-id"],
      workspaceRoot: requestedWorkspaceRoot,
      dryRun: values["dry-run"] ?? false,
    });
    return { result, json: values.json ?? false };
  }

  if (command === "configure") {
    const { values, positionals } = parseCommandArgs(
      args,
      commandOptions({
        workspace: { type: "string" },
        "planning-root": { type: "string" },
        "repository-root": { type: "string", multiple: true },
        yes: { type: "boolean", short: "y" },
        "dry-run": { type: "boolean" },
      }),
    );
    if (values.help) return { help: true };
    const positionalStartPath = requireAtMostOnePath(positionals, command);
    const requestedWorkspaceRoot = resolvePathOption(values, "workspace");
    const planningRoot = pathOption(values, "planning-root");
    const repositoryRootOverrides = pathOptionValues(values, "repository-root");
    const discoveredWorkspaceRoot = positionals.length === 0 && requestedWorkspaceRoot === null
      ? (await findOperationConfiguration(positionalStartPath)).workspaceRoot
      : null;
    const scanStartPath = positionals.length === 1
      ? positionalStartPath
      : requestedWorkspaceRoot ?? discoveredWorkspaceRoot;
    const configureOptions = await collectConfigureOptions(
      scanStartPath,
      {
        planningRoot,
        repositoryRoots: parseRepositoryRootOverrides(repositoryRootOverrides),
        acceptSuggestions: values.yes ?? false,
        dryRun: values["dry-run"] ?? false,
        workspaceRoot: requestedWorkspaceRoot,
      },
      {
        interactive: !values.yes && Boolean(process.stdin.isTTY && process.stdout.isTTY),
      },
    );
    return {
      result: await configureWorkspace(scanStartPath, configureOptions),
      json: values.json ?? false,
    };
  }

  if (command === "update") {
    const { values, positionals } = parseCommandArgs(
      args,
      commandOptions({
        workspace: { type: "string" },
        "dry-run": { type: "boolean" },
        force: { type: "boolean" },
      }),
    );
    if (values.help) return { help: true, helpText: UPDATE_HELP };
    const requestedWorkspaceRoot = resolvePathOption(values, "workspace");
    const result = await updateWorkspace(
      requireAtMostOnePath(positionals, command),
      {
        workspaceRoot: requestedWorkspaceRoot,
        targetSpecified: positionals.length === 1,
        dryRun: values["dry-run"] ?? false,
        force: values.force ?? false,
      },
    );
    return { result, json: values.json ?? false };
  }

  if (command === "doctor") {
    const { values, positionals } = parseCommandArgs(
      args,
      commandOptions({ workspace: { type: "string" } }),
    );
    if (values.help) return { help: true };
    const requestedWorkspaceRoot = resolvePathOption(values, "workspace");
    return {
      result: await diagnoseWorkspace(
        requireCommandPath(
          positionals,
          command,
          effectiveWorkspaceAuthority(requestedWorkspaceRoot),
        ),
        { workspaceRoot: requestedWorkspaceRoot },
      ),
      json: values.json ?? false,
    };
  }

  if (command === "context") {
    const { values, positionals } = parseCommandArgs(
      args,
      commandOptions({ workspace: { type: "string" } }),
    );
    if (values.help) return { help: true };
    const requestedWorkspaceRoot = resolvePathOption(values, "workspace");
    return {
      result: await getWorkspaceContext(
        requireCommandPath(positionals, command),
        { workspaceRoot: requestedWorkspaceRoot },
      ),
      json: values.json ?? false,
    };
  }

  if (command === "status") {
    const { values, positionals } = parseCommandArgs(
      args,
      commandOptions({ workspace: { type: "string" }, all: { type: "boolean" } }),
    );
    if (values.help) return { help: true };
    if (positionals.length > 1) {
      throw new SddError("status accepts at most one Space ID.", { code: "USAGE" });
    }
    const requestedWorkspaceRoot = resolvePathOption(values, "workspace");
    return {
      result: await getStatus(
        await resolveCommandStartPath(
          requestedWorkspaceRoot,
          [],
          positionals[0] ?? null,
          { observational: true },
        ),
        positionals[0] ?? null,
        {
          includeAll: values.all ?? false,
          workspaceRoot: requestedWorkspaceRoot,
        },
      ),
      json: values.json ?? false,
    };
  }

  if (command === "validate") {
    const { values, positionals } = parseCommandArgs(
      args,
      commandOptions({
        workspace: { type: "string" },
        repo: { type: "string", multiple: true },
        change: { type: "string" },
        epic: { type: "string" },
        "changed-from": { type: "string" },
      }),
    );
    if (values.help) return { help: true, helpText: VALIDATE_HELP };
    if (positionals.length > 1) {
      throw new SddError("validate accepts at most one Space ID.", { code: "USAGE" });
    }
    const requestedWorkspaceRoot = resolvePathOption(values, "workspace");
    const repositories = pathOptionValues(values, "repo") ?? [];
    return {
      result: await validateArtifacts(
        await resolveCommandStartPath(
          requestedWorkspaceRoot,
          repositories,
          positionals[0] ?? null,
        ),
        {
          spaceId: positionals[0] ?? null,
          repositories: normalizeRepositorySelectors(requestedWorkspaceRoot, repositories),
          changeId: values.change ?? null,
          epicId: values.epic ?? null,
          changedFrom: values["changed-from"] ?? null,
          workspaceRoot: requestedWorkspaceRoot,
        },
      ),
      json: values.json ?? false,
    };
  }

  if (command === "candidate") {
    const subcommand = args[0];
    if (["--help", "-h", "help"].includes(subcommand)) {
      return { help: true, helpText: CANDIDATE_HELP };
    }
    if (subcommand !== "resolve") {
      throw new SddError(
        subcommand ? `Unknown candidate command: ${subcommand}` : "candidate requires a subcommand.",
        { code: "USAGE", details: ["Available command: candidate resolve"] },
      );
    }
    const { values, positionals } = parseCommandArgs(
      args.slice(1),
      commandOptions({
        workspace: { type: "string" },
        baseline: { type: "string" },
        candidate: { type: "string" },
      }),
    );
    if (values.help) return { help: true, helpText: CANDIDATE_HELP };
    if (positionals.length > 1) {
      throw new SddError("candidate resolve accepts at most one repository path.", { code: "USAGE" });
    }
    if (!values.baseline) {
      throw new SddError("candidate resolve requires --baseline <commit-ish>.", { code: "USAGE" });
    }
    const requestedWorkspaceRoot = resolvePathOption(values, "workspace");
    return {
      result: await resolveCandidateEnvelope(
        requireCommandPath(positionals, "candidate resolve"),
        {
          workspaceRoot: requestedWorkspaceRoot,
          baseline: values.baseline,
          candidate: values.candidate ?? "working-tree",
        },
      ),
      json: values.json ?? false,
    };
  }

  if (command === "epic") {
    const subcommand = args[0];
    if (["--help", "-h", "help"].includes(subcommand)) {
      return { help: true, helpText: EPIC_HELP };
    }
    if (!["create", "update-input"].includes(subcommand)) {
      throw new SddError(
        subcommand ? `Unknown epic command: ${subcommand}` : "epic requires a subcommand.",
        { code: "USAGE", details: ["Available commands: epic create, epic update-input"] },
      );
    }
    if (subcommand === "update-input") {
      const { values, positionals } = parseCommandArgs(
        args.slice(1),
        commandOptions({
          workspace: { type: "string" },
          baseline: { type: "string" },
          candidate: { type: "string" },
        }),
      );
      if (values.help) return { help: true, helpText: EPIC_HELP };
      if (positionals.length > 1) {
        throw new SddError("epic update-input accepts at most one repository path.", { code: "USAGE" });
      }
      if (!values.baseline) {
        throw new SddError("epic update-input requires --baseline <commit-ish>.", { code: "USAGE" });
      }
      const requestedWorkspaceRoot = resolvePathOption(values, "workspace");
      return {
        result: await resolveEpicUpdateInput(
          requireCommandPath(positionals, "epic update-input"),
          {
            workspaceRoot: requestedWorkspaceRoot,
            baseline: values.baseline,
            candidate: values.candidate ?? "working-tree",
          },
        ),
        json: values.json ?? false,
      };
    }
    const { values, positionals } = parseCommandArgs(
      args.slice(1),
      commandOptions({
        workspace: { type: "string" },
        repo: { type: "string", multiple: true },
        date: { type: "string" },
        "dry-run": { type: "boolean" },
      }),
    );
    if (values.help) return { help: true, helpText: EPIC_HELP };
    if (positionals.length !== 3) {
      throw new SddError("epic create requires <space-id>, <epic-id>, and <slug>.", {
        code: "USAGE",
      });
    }
    const requestedWorkspaceRoot = resolvePathOption(values, "workspace");
    const repositories = pathOptionValues(values, "repo") ?? [];
    return {
      result: await createEpic(
        await resolveCommandStartPath(requestedWorkspaceRoot, repositories, positionals[0]),
        positionals[0],
        positionals[1],
        positionals[2],
        {
          repositories: normalizeRepositorySelectors(requestedWorkspaceRoot, repositories),
          date: values.date ?? null,
          dryRun: values["dry-run"] ?? false,
          workspaceRoot: requestedWorkspaceRoot,
        },
      ),
      json: values.json ?? false,
    };
  }

  if (command === "change") {
    const subcommand = args[0];
    if (["--help", "-h", "help"].includes(subcommand)) {
      return { help: true, helpText: CHANGE_HELP };
    }
    if (!["create", "transition", "close"].includes(subcommand)) {
      throw new SddError(
        subcommand ? `Unknown change command: ${subcommand}` : "change requires a subcommand.",
        {
          code: "USAGE",
          details: ["Available commands: change create, change transition, change close"],
        },
      );
    }
    const { values, positionals } = parseCommandArgs(
      args.slice(1),
      commandOptions({
        workspace: { type: "string" },
        ...(subcommand === "create"
          ? { repo: { type: "string", multiple: true }, date: { type: "string" } }
          : {}),
        ...(subcommand === "transition"
          ? { from: { type: "string" }, to: { type: "string" } }
          : {}),
        "dry-run": { type: "boolean" },
      }),
    );
    if (values.help) return { help: true, helpText: CHANGE_HELP };
    if (positionals.length !== 2) {
      throw new SddError(
        `change ${subcommand} requires <space-id> and <${subcommand === "create" ? "slug" : "change-id"}>.`,
        { code: "USAGE" },
      );
    }
    const requestedWorkspaceRoot = resolvePathOption(values, "workspace");
    const repositories = subcommand === "create"
      ? pathOptionValues(values, "repo") ?? []
      : [];
    if (subcommand === "close") {
      return {
        result: await closeChange(
          await resolveCommandStartPath(requestedWorkspaceRoot, [], positionals[0]),
          positionals[0],
          positionals[1],
          {
            dryRun: values["dry-run"] ?? false,
            workspaceRoot: requestedWorkspaceRoot,
          },
        ),
        json: values.json ?? false,
      };
    }
    if (subcommand === "transition") {
      if (!values.from || !values.to) {
        throw new SddError("change transition requires --from <status> and --to <status>.", {
          code: "USAGE",
        });
      }
      return {
        result: await transitionChange(
          await resolveCommandStartPath(requestedWorkspaceRoot, [], positionals[0]),
          positionals[0],
          positionals[1],
          {
            from: values.from,
            to: values.to,
            dryRun: values["dry-run"] ?? false,
            workspaceRoot: requestedWorkspaceRoot,
          },
        ),
        json: values.json ?? false,
      };
    }
    return {
      result: await createChange(
        await resolveCommandStartPath(requestedWorkspaceRoot, repositories, positionals[0]),
        positionals[0],
        positionals[1],
        {
          repositories: normalizeRepositorySelectors(requestedWorkspaceRoot, repositories),
          date: values.date ?? null,
          dryRun: values["dry-run"] ?? false,
          workspaceRoot: requestedWorkspaceRoot,
        },
      ),
      json: values.json ?? false,
    };
  }

  throw new SddError(`Unknown command: ${command}`, { code: "USAGE" });
}

export async function runCli(args) {
  const jsonRequested = args.includes("--json");
  try {
    if (args.length === 0 || args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
      console.log(HELP);
      return 0;
    }
    if (args[0] === "--version" || args[0] === "-V") {
      console.log(await packageVersion());
      return 0;
    }

    const { result, json, help, helpText } = await executeCommand(args[0], args.slice(1));
    if (help) {
      console.log(helpText ?? HELP);
      return 0;
    }
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printHuman(result);
    }
    return (
      (result.command === "doctor" && !result.healthy)
      || (result.command === "validate" && !result.valid)
    ) ? 1 : 0;
  } catch (error) {
    const isArgumentError = typeof error?.code === "string" && error.code.startsWith("ERR_PARSE_ARGS_");
    const normalized =
      error instanceof SddError
        ? error
        : new SddError(error.message, {
            code: isArgumentError ? "USAGE" : error.code ?? "UNEXPECTED_ERROR",
          });
    if (jsonRequested) {
      console.error(
        JSON.stringify(
          { error: { code: normalized.code, message: normalized.message, details: normalized.details } },
          null,
          2,
        ),
      );
    } else {
      console.error(`Error [${normalized.code}]: ${normalized.message}`);
      for (const detail of normalized.details) console.error(`  - ${detail}`);
    }
    return normalized.code === "USAGE" ? 2 : 1;
  }
}
