import { resolve } from "node:path";

import { resolveRepositoryArtifacts } from "../config.js";
import { resolveWorkspaceContext } from "../workspace.js";
import { resolveCandidateEnvelope } from "./candidate-resolve.js";

export async function resolveEpicUpdateInput(startPath, options = {}) {
  const envelope = await resolveCandidateEnvelope(startPath, options);
  const context = await resolveWorkspaceContext(
    resolve(startPath),
    options.workspaceRoot ? { workspaceRoot: options.workspaceRoot } : {},
  );
  const artifacts = resolveRepositoryArtifacts(context.config, context.repository);
  const validationArgs = [
    "validate",
    envelope.spaceId,
    "--repo",
    envelope.repository.id,
    "--workspace",
    envelope.workspaceRoot,
    "--json",
  ];

  return {
    ...envelope,
    command: "epic-update-input",
    repository: {
      ...envelope.repository,
      artifacts,
    },
    validation: {
      command: "sdd",
      args: validationArgs,
      display: ["sdd", ...validationArgs].map(JSON.stringify).join(" "),
    },
  };
}
