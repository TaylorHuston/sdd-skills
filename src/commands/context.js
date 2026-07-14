import { resolveWorkspaceContext } from "../workspace.js";

export async function getWorkspaceContext(startPath) {
  const context = await resolveWorkspaceContext(startPath);
  const { config: _config, ...publicContext } = context;
  return { command: "context", ...publicContext };
}
