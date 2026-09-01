import { resolveWorkspaceContext } from "../workspace.js";

export async function getWorkspaceContext(
  startPath,
  { workspaceRoot: requestedWorkspaceRoot = null } = {},
) {
  const context = await resolveWorkspaceContext(
    startPath,
    requestedWorkspaceRoot ? { workspaceRoot: requestedWorkspaceRoot } : {},
  );
  const { config: _config, ...publicContext } = context;
  return { command: "context", ...publicContext };
}
