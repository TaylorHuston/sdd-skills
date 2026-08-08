import { join } from "node:path";

import {
  getUserRoot,
  isSupportedLegacyConfig,
  validateConfig,
  resolveIdeaPlanningPath,
  resolveRepositoryPath,
  resolveWorkspacePath,
} from "../config.js";
import { isDirectory } from "../fs.js";
import { inspectChangeStatuses } from "../change-status.js";
import { inspectProjectGuidance } from "../guidance.js";
import { inspectSkillInstallation } from "../skills.js";
import { inspectWorkflowInstallation } from "../workflow.js";
import { findOperationConfiguration, resolveOperationConfiguration } from "../workspace.js";

export async function diagnoseWorkspace(startPath, { userRoot = null } = {}) {
  let { workspaceRoot, config } = await findOperationConfiguration(
    startPath,
    userRoot ? { userRoot } : {},
  );
  const migrationPending = isSupportedLegacyConfig(config)
    || (config.kind === "user" && config.migration?.sourceWorkspace);
  const findings = migrationPending
    ? [{
        level: "error",
        code: "CONFIG_MIGRATION_REQUIRED",
        message: "SDD configuration migration is required. Run `sdd update` before using this installation.",
      }]
    : [...validateConfig(config)];

  if (findings.some((finding) => finding.level === "error")) {
    const counts = {
      errors: findings.filter((finding) => finding.level === "error").length,
      warnings: findings.filter((finding) => finding.level === "warning").length,
    };
    return {
      command: "doctor",
      workspaceRoot,
      configPath: join(workspaceRoot, ".sdd", "config.yaml"),
      findings,
      counts,
      remediations: [],
      healthy: false,
    };
  }

  userRoot ??= getUserRoot();
  const operation = await resolveOperationConfiguration(startPath, { userRoot });
  workspaceRoot = operation.workspaceRoot;
  config = operation.config;

  const checkDirectory = async (label, configuredPath, level = "warning") => {
    const exists = await isDirectory(resolveWorkspacePath(workspaceRoot, configuredPath));
    if (!exists) {
      findings.push({ level, message: `${label} does not exist: ${configuredPath}.` });
    }
    return exists;
  };

  let planningRootExists = true;
  if (typeof config.planning?.root === "string") {
    planningRootExists = await checkDirectory("Planning root", config.planning.root);
  }
  const repositoryRootExists = {};
  for (const [rootId, repositoryRoot] of Object.entries(config.repositories?.roots ?? {})) {
    repositoryRootExists[rootId] = await checkDirectory(
      `Repository root ${rootId}`,
      repositoryRoot,
    );
  }
  for (const [ideaId, idea] of Object.entries(config.ideas ?? {})) {
    if (idea._repositoryOnly !== true && (planningRootExists || idea.planningPath !== undefined)) {
      await checkDirectory(
        `Planning directory for ${ideaId}`,
        resolveIdeaPlanningPath(config, ideaId, idea),
      );
    }
    for (const repository of idea.repositories ?? []) {
      if (repository.root && repositoryRootExists[repository.root] === false) continue;
      await checkDirectory(`Repository for ${ideaId}`, resolveRepositoryPath(config, repository));
    }
  }

  findings.push(...(await inspectSkillInstallation(workspaceRoot, config)));
  if (config.kind !== "user") {
    findings.push(...(await inspectWorkflowInstallation(workspaceRoot)));
  }
  findings.push(...(await inspectProjectGuidance(workspaceRoot, config)));
  findings.push(...(await inspectChangeStatuses(workspaceRoot, config)));

  const counts = {
    errors: findings.filter((finding) => finding.level === "error").length,
    warnings: findings.filter((finding) => finding.level === "warning").length,
  };
  const remediations =
    !planningRootExists || Object.values(repositoryRootExists).some((exists) => !exists)
      ? [
          {
            command: "sdd configure",
            message: "Repair missing planning or repository roots using detected workspace paths.",
          },
        ]
      : [];
  return {
    command: "doctor",
    workspaceRoot,
    configPath: join(workspaceRoot, ".sdd", "config.yaml"),
    findings,
    counts,
    remediations,
    healthy: counts.errors === 0,
  };
}
