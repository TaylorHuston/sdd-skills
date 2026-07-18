import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { configureWorkspace } from "./commands/configure.js";
import { getWorkspaceContext } from "./commands/context.js";
import { closeChange } from "./commands/change-close.js";
import { createPlannedChange } from "./commands/change-create.js";
import { promotePlannedChange } from "./commands/change-promote.js";
import { transitionChange } from "./commands/change-transition.js";
import { diagnoseWorkspace } from "./commands/doctor.js";
import { createEpic } from "./commands/epic-create.js";
import { initRepository, setupInstallation } from "./commands/init-installation.js";
import { initWorkspace } from "./commands/init.js";
import { getStatus } from "./commands/status.js";
import { updateWorkspace } from "./commands/update.js";
import { validateArtifacts } from "./commands/validate.js";
import { PACKAGE_JSON_PATH } from "./constants.js";
import { SddError } from "./errors.js";
import {
  collectConfigureOptions,
  collectInitOptions,
  collectSetupOptions,
} from "./prompts.js";

const HELP = `Story-Driven Development CLI

Usage:
  sdd setup [options]             Set up user-level configuration and global skills
  sdd init [path] [options]       Initialize one repository
  sdd configure [path] [options]  Repair configured user topology paths
  sdd update [path] [options]     Update user skills or a legacy installation
  sdd doctor [path] [--json]      Validate SDD installation, topology, repository, and Changes
  sdd context [path] [--json]     Resolve the current planning/repository context
  sdd status [space-id] [options] List Space status or show one Space in detail
  sdd validate [space-id] [options] Validate SDD artifact structure and references
  sdd epic create [options]       Scaffold a canonical Epic in one repository
  sdd change create [options]     Scaffold a planned Change for a Space
  sdd change promote [options]    Promote a planned Change into repository work
  sdd change transition [options] Guard one active Change status transition
  sdd change close [options]      Move an in-review Change into closed history
  sdd --version                   Print the package version

Setup options:
  --from-workspace <path>         Migrate an existing pre-1.0 workspace configuration
  --planning-root <path>          Override detected planning root
  --repository-root <path>        Add a repository root; may be repeated
  --skills-dir <path>             User skill directory (default: ~/.agents/skills)
  --yes                           Accept detected paths without interactive questions
  --dry-run                       Report without writing files
  --force                         Replace conflicting managed skills
  --json                          Emit machine-readable JSON

Init options:
  --repo-id <id>                  Override the repository ID derived from the directory name
  --legacy-workspace              Initialize the deprecated pre-1.0 workspace contract
  --dry-run                       Report without writing files
  --json                          Emit machine-readable JSON

Configure options:
  --planning-root <path>          Set the planning root
  --repository-root <name=path>   Set a named repository root; may be repeated
  --yes                           Accept detected replacements without prompting
  --dry-run                       Report changes without writing configuration
  --json                          Emit machine-readable JSON

Update options:
  --dry-run                       Report without writing files
  --force                         Replace conflicting managed workflow or skills
  --json                          Emit machine-readable JSON

Status options:
  --workspace <path>              Resolve status from this path (default: current directory)
  --all                           Include inactive and archived ideas and repositories
  --json                          Emit machine-readable JSON

Validate options:
  --workspace <path>              Resolve SDD context from this path (default: current directory)
  --repo <path>                   Select a mapped repository; may be repeated
  --change <change-id>            Validate one planned, active, or closed Change
  --epic <epic-id>                Validate one Epic
  --json                          Emit machine-readable JSON

Epic create usage:
  sdd epic create <space-id> <epic-id> <slug> [options]

Epic create options:
  --workspace <path>              Resolve SDD context from this path (default: current directory)
  --repo <path>                   Select the target mapped repository
  --date <yyyy-mm-dd>             Override the local creation date
  --dry-run                       Report the scaffold without writing files
  --json                          Emit machine-readable JSON

Change create usage:
  sdd change create <space-id> <slug> [options]

Change create options:
  --workspace <path>              Resolve SDD context from this path (default: current directory)
  --repo <path>                   Select a mapped repository; may be repeated
  --date <yyyy-mm-dd>             Override the local creation date
  --dry-run                       Report the scaffold without writing files
  --json                          Emit machine-readable JSON

Change promote usage:
  sdd change promote <space-id> <change-id> [options]

Change promote options:
  --workspace <path>              Resolve SDD context from this path (default: current directory)
  --repo <path>                   Select a mapped repository; may be repeated
  --dry-run                       Report the promotion without writing files
  --json                          Emit machine-readable JSON

Change transition usage:
  sdd change transition <space-id> <change-id> --from <status> --to <status> [options]

Change transition options:
  --workspace <path>              Resolve SDD context from this path (default: current directory)
  --repo <path>                   Select a mapped repository; may be repeated
  --from <status>                 Require the current active Change status
  --to <status>                   Set the next allowed active Change status
  --dry-run                       Report the transition without writing tasks.md
  --json                          Emit machine-readable JSON

Change close usage:
  sdd change close <space-id> <change-id> [options]

Change close options:
  --workspace <path>              Resolve SDD context from this path (default: current directory)
  --repo <path>                   Select a mapped repository; may be repeated
  --dry-run                       Report the closeout without moving files
  --json                          Emit machine-readable JSON
`;

const CHANGE_HELP = `SDD Change commands

Usage:
  sdd change create <space-id> <slug> [options]
  sdd change promote <space-id> <change-id> [options]
  sdd change transition <space-id> <change-id> --from <status> --to <status> [options]
  sdd change close <space-id> <change-id> [options]

Commands:
  create   Scaffold a private planned Change
  promote  Move a proposed draft into repository work
  transition  Guard and apply an allowed active Change status transition
  close    Move an in-review Change into closed history

Shared options:
  --workspace <path>  Resolve the initialized workspace (default: current directory)
  --repo <path>       Select a mapped repository; may be repeated
  --dry-run           Report without writing files
  --json              Emit machine-readable JSON
`;

const EPIC_HELP = `SDD Epic commands

Usage:
  sdd epic create <space-id> <epic-id> <slug> [options]

Commands:
  create   Scaffold and structurally validate a canonical Epic

Options:
  --workspace <path>  Resolve the initialized workspace (default: current directory)
  --repo <path>       Select the target mapped repository
  --date <yyyy-mm-dd> Override the local creation date
  --dry-run           Report without writing files
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

function requireAtMostOnePath(positionals, command) {
  if (positionals.length > 1) {
    throw new SddError(`${command} accepts at most one path.`, { code: "USAGE" });
  }
  return resolve(positionals[0] ?? process.cwd());
}

function requireNoPositionals(positionals, command) {
  if (positionals.length > 0) {
    throw new SddError(`${command} does not accept a path.`, { code: "USAGE" });
  }
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
    const repositories = space.repositoryActivity;
    if (repositories.length > 0) {
      return repositories.map((repository) => {
        const change = repository.activeChanges[0] ?? repository.change;
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
    console.log(`${result.dryRun ? "Would set up" : result.createdUserConfig ? "Set up" : "Reconciled"} user SDD: ${result.userConfigPath}`);
    if (result.migratedFromWorkspace) {
      console.log(`Migration source: ${result.migratedFromWorkspace}`);
    }
    console.log(`Doctrine: bundled with @taylorhuston/sdd`);
    printSkillActions(result.skills.actions);
    return;
  }
  if (result.command === "init") {
    if (result.mode === "repository") {
      console.log(`${result.dryRun ? "Would initialize" : result.createdRepositoryConfig ? "Initialized" : "Reconciled"} repository SDD: ${result.repositoryConfigPath}`);
      console.log(`Repository ID: ${result.repositoryConfig.id}`);
      console.log(`Doctrine: bundled with @taylorhuston/sdd`);
      return;
    }
    console.log(`${result.dryRun ? "Would initialize" : result.created ? "Initialized" : "Reconciled"} SDD workspace: ${result.workspaceRoot}`);
    console.log(`Configuration: ${result.configPath}`);
    if (result.migratedFrom) console.log(`Migrated configuration: v${result.migratedFrom} -> v${result.config.version}`);
    console.log(`Planning root: ${result.config.planning.root}`);
    console.log(
      `Repository roots: ${Object.entries(result.config.repositories.roots)
        .map(([name, path]) => `${name}=${path}`)
        .join(", ")}`,
    );
    console.log(`Ideas mapped: ${result.ideasImported}`);
    printWorkflowAction(result.workflow);
    printSkillActions(result.skills.actions);
    return;
  }
  if (result.command === "update") {
    const label = result.mode === "user" ? "user SDD installation" : "legacy SDD workspace";
    console.log(`${result.dryRun ? "Would update" : "Updated"} ${label}: ${result.workspaceRoot}`);
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
      `Artifacts: ${result.summary.plannedChanges} planned Change(s), ${result.summary.changes} repository Change(s), ${result.summary.epics} Epic(s)`,
    );
    for (const entry of result.findings) {
      console.log(`${entry.level.toUpperCase()} [${entry.code}] ${entry.path}: ${entry.message}`);
    }
    console.log(`Findings: ${result.summary.errors} error(s), ${result.summary.warnings} warning(s)`);
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
  if (result.command === "change-create") {
    console.log(`${result.dryRun ? "Would create" : "Created"} planned Change: ${result.changeId}`);
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
  if (result.command === "change-promote") {
    console.log(`${result.dryRun ? "Would promote" : "Promoted"} planned Change: ${result.changeId}`);
    console.log(`Space: ${result.spaceId}`);
    console.log(`Source: ${result.sourcePath}${result.dryRun ? " (would remove)" : " (removed)"}`);
    for (const repository of result.repositories) {
      console.log(`Repository: ${repository.resolvedPath}${repository.role ? ` (${repository.role})` : ""}`);
      console.log(`  Change: ${repository.path}`);
    }
    console.log(`Files: ${result.files.join(", ")}`);
    return;
  }
  if (result.command === "change-transition") {
    console.log(
      `${result.dryRun ? "Would transition" : "Transitioned"} Change: ${result.changeId} (${result.from} -> ${result.to})`,
    );
    console.log(`Space: ${result.spaceId}`);
    for (const repository of result.repositories) {
      console.log(`Repository: ${repository.resolvedPath}${repository.role ? ` (${repository.role})` : ""}`);
      console.log(`  Tasks: ${repository.tasksPath}`);
    }
    return;
  }
  if (result.command === "change-close") {
    console.log(`${result.dryRun ? "Would close" : "Closed"} Change: ${result.changeId}`);
    console.log(`Space: ${result.spaceId}`);
    for (const repository of result.repositories) {
      console.log(`Repository: ${repository.resolvedPath}${repository.role ? ` (${repository.role})` : ""}`);
      console.log(`  Source: ${repository.sourcePath}`);
      console.log(`  Closed: ${repository.path}`);
    }
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
        "from-workspace": { type: "string" },
        "planning-root": { type: "string" },
        "repository-root": { type: "string", multiple: true },
        "skills-dir": { type: "string" },
        yes: { type: "boolean", short: "y" },
        "dry-run": { type: "boolean" },
        force: { type: "boolean" },
      }),
    );
    if (values.help) return { help: true };
    requireNoPositionals(positionals, command);
    if (
      values["from-workspace"] &&
      [values["planning-root"], values["repository-root"]].some((value) => value !== undefined)
    ) {
      throw new SddError(
        "--from-workspace cannot be combined with --planning-root or --repository-root.",
        { code: "USAGE" },
      );
    }
    const setupOptions = await collectSetupOptions(
      {
        fromWorkspace: values["from-workspace"],
        planningRoot: values["planning-root"],
        repositoryRoots: values["repository-root"],
        skillsDirectory: values["skills-dir"],
        dryRun: values["dry-run"] ?? false,
        force: values.force ?? false,
      },
      { interactive: !values.yes && Boolean(process.stdin.isTTY && process.stdout.isTTY) },
    );
    return {
      result: await setupInstallation(setupOptions),
      json: values.json ?? false,
    };
  }

  if (command === "init") {
    const { values, positionals } = parseCommandArgs(
      args,
      commandOptions({
        "planning-root": { type: "string" },
        "repository-root": { type: "string", multiple: true },
        "skills-dir": { type: "string" },
        "repo-id": { type: "string" },
        "legacy-workspace": { type: "boolean" },
        yes: { type: "boolean", short: "y" },
        "dry-run": { type: "boolean" },
        force: { type: "boolean" },
      }),
    );
    if (values.help) return { help: true };
    const repositoryRoot = requireAtMostOnePath(positionals, command);
    let result;
    if (values["legacy-workspace"]) {
      const initOptions = await collectInitOptions(
        repositoryRoot,
        {
          planningRoot: values["planning-root"],
          repositoryRoots: values["repository-root"],
          skillsDirectory: values["skills-dir"],
          dryRun: values["dry-run"] ?? false,
          force: values.force ?? false,
        },
        { interactive: !values.yes && Boolean(process.stdin.isTTY && process.stdout.isTTY) },
      );
      result = await initWorkspace(repositoryRoot, initOptions);
    } else {
      const setupOnlyOptions = [
        values["planning-root"],
        values["repository-root"],
        values["skills-dir"],
        values.yes,
        values.force,
      ];
      if (setupOnlyOptions.some((value) => value !== undefined)) {
        throw new SddError(
          "User-level setup options belong to `sdd setup`; repository init accepts only --repo-id, --dry-run, and --json.",
          { code: "USAGE" },
        );
      }
      result = await initRepository(repositoryRoot, {
        repositoryId: values["repo-id"],
        dryRun: values["dry-run"] ?? false,
      });
    }
    return { result, json: values.json ?? false };
  }

  if (command === "configure") {
    const { values, positionals } = parseCommandArgs(
      args,
      commandOptions({
        "planning-root": { type: "string" },
        "repository-root": { type: "string", multiple: true },
        yes: { type: "boolean", short: "y" },
        "dry-run": { type: "boolean" },
      }),
    );
    if (values.help) return { help: true };
    const workspaceRoot = requireAtMostOnePath(positionals, command);
    const configureOptions = await collectConfigureOptions(
      workspaceRoot,
      {
        planningRoot: values["planning-root"],
        repositoryRoots: parseRepositoryRootOverrides(values["repository-root"]),
        acceptSuggestions: values.yes ?? false,
        dryRun: values["dry-run"] ?? false,
      },
      {
        interactive: !values.yes && Boolean(process.stdin.isTTY && process.stdout.isTTY),
      },
    );
    return {
      result: await configureWorkspace(workspaceRoot, configureOptions),
      json: values.json ?? false,
    };
  }

  if (command === "update") {
    const { values, positionals } = parseCommandArgs(
      args,
      commandOptions({
        "dry-run": { type: "boolean" },
        force: { type: "boolean" },
      }),
    );
    if (values.help) return { help: true };
    const result = await updateWorkspace(requireAtMostOnePath(positionals, command), {
      dryRun: values["dry-run"] ?? false,
      force: values.force ?? false,
    });
    return { result, json: values.json ?? false };
  }

  if (command === "doctor") {
    const { values, positionals } = parseCommandArgs(args, commandOptions());
    if (values.help) return { help: true };
    return {
      result: await diagnoseWorkspace(requireAtMostOnePath(positionals, command)),
      json: values.json ?? false,
    };
  }

  if (command === "context") {
    const { values, positionals } = parseCommandArgs(args, commandOptions());
    if (values.help) return { help: true };
    return {
      result: await getWorkspaceContext(requireAtMostOnePath(positionals, command)),
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
    return {
      result: await getStatus(resolve(values.workspace ?? process.cwd()), positionals[0] ?? null, {
        includeAll: values.all ?? false,
      }),
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
      }),
    );
    if (values.help) return { help: true };
    if (positionals.length > 1) {
      throw new SddError("validate accepts at most one Space ID.", { code: "USAGE" });
    }
    return {
      result: await validateArtifacts(resolve(values.workspace ?? process.cwd()), {
        spaceId: positionals[0] ?? null,
        repositories: values.repo ?? [],
        changeId: values.change ?? null,
        epicId: values.epic ?? null,
      }),
      json: values.json ?? false,
    };
  }

  if (command === "epic") {
    const subcommand = args[0];
    if (["--help", "-h", "help"].includes(subcommand)) {
      return { help: true, helpText: EPIC_HELP };
    }
    if (subcommand !== "create") {
      throw new SddError(
        subcommand ? `Unknown epic command: ${subcommand}` : "epic requires a subcommand.",
        { code: "USAGE", details: ["Available command: epic create"] },
      );
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
    return {
      result: await createEpic(
        resolve(values.workspace ?? process.cwd()),
        positionals[0],
        positionals[1],
        positionals[2],
        {
          repositories: values.repo ?? [],
          date: values.date ?? null,
          dryRun: values["dry-run"] ?? false,
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
    if (!["create", "promote", "transition", "close"].includes(subcommand)) {
      throw new SddError(
        subcommand ? `Unknown change command: ${subcommand}` : "change requires a subcommand.",
        {
          code: "USAGE",
          details: ["Available commands: change create, change promote, change transition, change close"],
        },
      );
    }
    const { values, positionals } = parseCommandArgs(
      args.slice(1),
      commandOptions({
        workspace: { type: "string" },
        repo: { type: "string", multiple: true },
        ...(subcommand === "create" ? { date: { type: "string" } } : {}),
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
    if (subcommand === "promote") {
      return {
        result: await promotePlannedChange(
          resolve(values.workspace ?? process.cwd()),
          positionals[0],
          positionals[1],
          {
            repositories: values.repo ?? [],
            dryRun: values["dry-run"] ?? false,
          },
        ),
        json: values.json ?? false,
      };
    }
    if (subcommand === "close") {
      return {
        result: await closeChange(
          resolve(values.workspace ?? process.cwd()),
          positionals[0],
          positionals[1],
          {
            repositories: values.repo ?? [],
            dryRun: values["dry-run"] ?? false,
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
          resolve(values.workspace ?? process.cwd()),
          positionals[0],
          positionals[1],
          {
            repositories: values.repo ?? [],
            from: values.from,
            to: values.to,
            dryRun: values["dry-run"] ?? false,
          },
        ),
        json: values.json ?? false,
      };
    }
    return {
      result: await createPlannedChange(
        resolve(values.workspace ?? process.cwd()),
        positionals[0],
        positionals[1],
        {
          repositories: values.repo ?? [],
          date: values.date ?? null,
          dryRun: values["dry-run"] ?? false,
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
