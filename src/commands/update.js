import { resolve } from "node:path";

import {
  assertValidConfig,
  getWorkspaceConfigPath,
} from "../config.js";
import { setupInstallation } from "./init-installation.js";
import { resolveOperationConfiguration } from "../workspace.js";

export async function updateWorkspace(
  startPath = process.cwd(),
  {
    workspaceRoot: explicitWorkspaceRoot,
    force = false,
    dryRun = false,
    installationOptions = {},
    targetSpecified = false,
  } = {},
) {
  const invocationCwd = process.cwd();
  const requestedWorkspaceRoot = explicitWorkspaceRoot
    ? resolve(invocationCwd, explicitWorkspaceRoot)
    : typeof process.env.SDD_WORKSPACE_ROOT === "string" && process.env.SDD_WORKSPACE_ROOT.length > 0
      ? resolve(invocationCwd, process.env.SDD_WORKSPACE_ROOT)
      : null;
  const targetPath = !targetSpecified && requestedWorkspaceRoot
    ? requestedWorkspaceRoot
    : resolve(invocationCwd, startPath);
  const operation = await resolveOperationConfiguration(targetPath, {
    ...(requestedWorkspaceRoot
      ? { workspaceRoot: requestedWorkspaceRoot }
      : {}),
  });
  assertValidConfig(operation.config, "update the SDD installation");

  const installation = await setupInstallation(operation.workspaceRoot, {
    force,
    dryRun,
    ...installationOptions,
  });
  return {
    command: "update",
    mode: "workspace",
    workspaceRoot: operation.workspaceRoot,
    workspaceConfigPath: getWorkspaceConfigPath(operation.workspaceRoot),
    dryRun,
    workflow: installation.workflow,
    skills: installation.skills,
  };
}
