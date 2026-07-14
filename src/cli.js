import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { getWorkspaceContext } from "./commands/context.js";
import { diagnoseWorkspace } from "./commands/doctor.js";
import { initWorkspace } from "./commands/init.js";
import { getStatus } from "./commands/status.js";
import { updateWorkspace } from "./commands/update.js";
import { PACKAGE_JSON_PATH } from "./constants.js";
import { SddError } from "./errors.js";
import { collectInitOptions } from "./prompts.js";

const HELP = `Story-Driven Development CLI

Usage:
  sdd init [path] [options]       Initialize or reconcile an SDD workspace
  sdd update [path] [options]     Update the managed workflow and SDD skills
  sdd doctor [path] [--json]      Validate workspace, installation, and Change statuses
  sdd context [path] [--json]     Resolve the current planning/repository context
  sdd status [space-id] [options] List Space status or show one Space in detail
  sdd --version                   Print the package version

Init options:
  --planning-root <path>          Override detected planning root
  --repository-root <path>        Add a repository root; may be repeated
  --skills-dir <path>             Skill installation directory (default: .agents/skills)
  --yes                           Accept detected paths without interactive questions
  --dry-run                       Report without writing files
  --force                         Replace conflicting managed workflow or skills
  --json                          Emit machine-readable JSON

Update options:
  --dry-run                       Report without writing files
  --force                         Replace conflicting managed workflow or skills
  --json                          Emit machine-readable JSON

Status options:
  --workspace <path>              Resolve status from this workspace (default: current directory)
  --json                          Emit machine-readable JSON
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

function printRows(headers, rows) {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => String(row[index]).length)),
  );
  const printRow = (row) =>
    console.log(row.map((value, index) => String(value).padEnd(widths[index])).join("  ").trimEnd());
  printRow(headers);
  printRow(widths.map((width) => "-".repeat(width)));
  for (const row of rows) printRow(row);
}

export function statusSummaryRows(result) {
  return result.spaces.flatMap((space) => {
    const activeRepositories = space.repositoryActivity.filter(
      (repository) => repository.activeChangeCount > 0,
    );
    if (activeRepositories.length > 0) {
      return activeRepositories.map((repository) => {
        const change = repository.activeChanges[0];
        return [
          space.spaceId,
          repository.role ?? "-",
          change?.status ?? "-",
          change?.changeId ?? "-",
          repository.resolvedPath,
          repository.activeChangeCount,
        ];
      });
    }
    return [];
  });
}

function printStatus(result) {
  if (result.mode === "summary") {
    console.log(`SDD workspace: ${result.workspaceRoot}`);
    const rows = statusSummaryRows(result);
    if (rows.length === 0) {
      console.log("No active Changes in mapped repositories.");
      return;
    }
    printRows(["SPACE ID", "ROLE", "STATUS", "CHANGE", "REPOSITORY", "ACTIVE"], rows);
    return;
  }

  console.log(`Space: ${result.spaceId}`);
  console.log(`Planning path: ${result.planningPath}`);
  if (result.repositoryDetails.length === 0) {
    console.log("Repositories: none");
    return;
  }
  for (const repository of result.repositoryDetails) {
    console.log("");
    console.log(`Repository: ${repository.resolvedPath}${repository.role ? ` (${repository.role})` : ""}`);
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
    console.log(`Recent Changes (${repository.changes.length}):`);
    if (repository.changes.length === 0) console.log("  none");
    for (const change of repository.changes) {
      console.log(`  ${change.changeId} [${change.status}]`);
    }
  }
}

function printHuman(result) {
  if (result.command === "init") {
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
    console.log(`${result.dryRun ? "Would update" : "Updated"} SDD workspace: ${result.workspaceRoot}`);
    printWorkflowAction(result.workflow);
    printSkillActions(result.skills.actions);
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
    }
    return;
  }
  if (result.command === "context") {
    console.log(`Workspace: ${result.workspaceRoot}`);
    console.log(`Path: ${result.relativePath}`);
    console.log(`Context: ${result.kind}`);
    if (result.spaceId) console.log(`Space ID: ${result.spaceId}`);
    if (result.planningPath) console.log(`Planning path: ${result.planningPath}`);
    if (result.repository) {
      console.log(`Repository: ${result.repository.resolvedPath}`);
      if (result.repository.role) console.log(`Role: ${result.repository.role}`);
    }
    return;
  }
  if (result.command === "status") {
    printStatus(result);
  }
}

async function packageVersion() {
  return JSON.parse(await readFile(PACKAGE_JSON_PATH, "utf8")).version;
}

async function executeCommand(command, args) {
  if (command === "init") {
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
    const initOptions = await collectInitOptions(workspaceRoot, {
      planningRoot: values["planning-root"],
      repositoryRoots: values["repository-root"],
      skillsDirectory: values["skills-dir"],
      dryRun: values["dry-run"] ?? false,
      force: values.force ?? false,
    }, {
      interactive: !values.yes && Boolean(process.stdin.isTTY && process.stdout.isTTY),
    });
    const result = await initWorkspace(workspaceRoot, initOptions);
    return { result, json: values.json ?? false };
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
      commandOptions({ workspace: { type: "string" } }),
    );
    if (values.help) return { help: true };
    if (positionals.length > 1) {
      throw new SddError("status accepts at most one Space ID.", { code: "USAGE" });
    }
    return {
      result: await getStatus(resolve(values.workspace ?? process.cwd()), positionals[0] ?? null),
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

    const { result, json, help } = await executeCommand(args[0], args.slice(1));
    if (help) {
      console.log(HELP);
      return 0;
    }
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printHuman(result);
    }
    return result.command === "doctor" && !result.healthy ? 1 : 0;
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
