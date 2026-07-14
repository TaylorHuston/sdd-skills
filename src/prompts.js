import { createInterface } from "node:readline/promises";

import { createInitialConfig, getConfigPath } from "./config.js";
import { pathExists } from "./fs.js";

function parseRepositoryRoots(value) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export async function collectInitOptions(
  workspaceRoot,
  options,
  {
    interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY),
    ask,
  } = {},
) {
  if (!interactive || (await pathExists(getConfigPath(workspaceRoot)))) {
    return options;
  }

  const detected = await createInitialConfig(workspaceRoot, options);
  let prompt = ask;
  let interfaceInstance;
  if (!prompt) {
    interfaceInstance = createInterface({ input: process.stdin, output: process.stdout });
    prompt = (question) => interfaceInstance.question(question);
  }

  try {
    const planningRoot =
      options.planningRoot ??
      ((await prompt(
        `Planning documents path (relative to workspace root) [${detected.planning.root}]: `,
      )).trim() || detected.planning.root);

    let repositoryRoots = options.repositoryRoots;
    if (!repositoryRoots?.length) {
      const detectedRepositoryPaths = Object.values(detected.repositories.roots);
      const detectedRoots = detectedRepositoryPaths.join(", ");
      const response = (
        await prompt(
          `Code/repository roots (comma-separated, relative to workspace root) [${detectedRoots}]: `,
        )
      ).trim();
      repositoryRoots = response ? parseRepositoryRoots(response) : detectedRepositoryPaths;
    }

    return { ...options, planningRoot, repositoryRoots };
  } finally {
    interfaceInstance?.close();
  }
}
