import { join } from "node:path";

import {
  findWorkspaceRoot,
  readConfig,
  resolveIdeaPlanningPath,
  resolveRepositoryPath,
  resolveWorkspacePath,
  validateConfig,
} from "../config.js";
import { isDirectory } from "../fs.js";
import { inspectChangeStatuses } from "../change-status.js";
import { inspectSkillInstallation } from "../skills.js";
import { inspectWorkflowInstallation } from "../workflow.js";
import { resolveOperationConfiguration } from "../workspace.js";

export async function diagnoseWorkspace(startPath) {
  const workspaceRoot = await findWorkspaceRoot(startPath);
  let config = await readConfig(workspaceRoot);
  const findings = [...validateConfig(config)];

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

  config = (await resolveOperationConfiguration(startPath)).config;

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
