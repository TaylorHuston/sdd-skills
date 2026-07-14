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

export async function diagnoseWorkspace(startPath) {
  const workspaceRoot = await findWorkspaceRoot(startPath);
  const config = await readConfig(workspaceRoot);
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
      healthy: false,
    };
  }

  const checkDirectory = async (label, configuredPath, level = "warning") => {
    if (!(await isDirectory(resolveWorkspacePath(workspaceRoot, configuredPath)))) {
      findings.push({ level, message: `${label} does not exist: ${configuredPath}.` });
    }
  };

  if (typeof config.planning?.root === "string") {
    await checkDirectory("Planning root", config.planning.root);
  }
  for (const [rootId, repositoryRoot] of Object.entries(config.repositories?.roots ?? {})) {
    await checkDirectory(`Repository root ${rootId}`, repositoryRoot);
  }
  for (const [ideaId, idea] of Object.entries(config.ideas ?? {})) {
    await checkDirectory(
      `Planning directory for ${ideaId}`,
      resolveIdeaPlanningPath(config, ideaId, idea),
    );
    for (const repository of idea.repositories ?? []) {
      await checkDirectory(`Repository for ${ideaId}`, resolveRepositoryPath(config, repository));
    }
  }

  findings.push(...(await inspectSkillInstallation(workspaceRoot, config)));
  findings.push(...(await inspectWorkflowInstallation(workspaceRoot)));
  findings.push(...(await inspectChangeStatuses(workspaceRoot, config)));

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
    healthy: counts.errors === 0,
  };
}
