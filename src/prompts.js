import { createInterface } from "node:readline/promises";
import { inspectWorkspaceConfiguration } from "./commands/configure.js";
import { createInitialConfig, readWorkspaceConfigSnapshot } from "./config.js";
async function hasWorkspaceConfiguration(workspaceRoot) {
  try {
    await readWorkspaceConfigSnapshot(workspaceRoot);
    return true;
  } catch (error) {
    if (error?.code === "WORKSPACE_NOT_INITIALIZED") return false;
    throw error;
  }
}

function parseRepositoryRoots(value) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export async function collectSetupOptions(
  workspaceRoot,
  options,
  {
    interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY),
    ask,
  } = {},
) {
  if (options.fromUser || !interactive || (await hasWorkspaceConfiguration(workspaceRoot))) {
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
    const planningRoot = options.planningRoot ?? (
      (await prompt(
        `Planning documents path (relative to workspace root) [${detected.planning.root}]: `,
      )).trim()
      || detected.planning.root
    );
    let repositoryRoots = options.repositoryRoots;
    if (!repositoryRoots?.length) {
      const detectedRepositoryPaths = Object.values(detected.repositories.roots);
      const detectedRoots = detectedRepositoryPaths.join(", ") || "none";
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


export async function collectConfigureOptions(
  startPath,
  options,
  {
    interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY),
    ask,
  } = {},
) {
  if (!interactive) return options;

  const inspection = await inspectWorkspaceConfiguration(startPath, {
    ...(options.workspaceRoot ? { workspaceRoot: options.workspaceRoot } : {}),
  });
  let prompt = ask;
  let interfaceInstance;
  if (!prompt) {
    interfaceInstance = createInterface({ input: process.stdin, output: process.stdout });
    prompt = (question) => interfaceInstance.question(question);
  }

  try {
    let planningRoot = options.planningRoot;
    if (inspection.planning.missing && !planningRoot) {
      const defaultLabel = inspection.planning.suggestion
        ? ` [${inspection.planning.suggestion}]`
        : "";
      const response = (
        await prompt(
          `Planning root is missing: ${inspection.planning.from}\nPlanning documents path${defaultLabel}: `,
        )
      ).trim();
      planningRoot = response || inspection.planning.suggestion;
    }

    const repositoryRoots = { ...(options.repositoryRoots ?? {}) };
    for (const root of inspection.repositoryRoots) {
      if (!root.missing || repositoryRoots[root.rootId]) continue;
      const defaultLabel = root.suggestion ? ` [${root.suggestion}]` : "";
      const response = (
        await prompt(
          `Repository root "${root.rootId}" is missing: ${root.from}\nRepository path${defaultLabel}: `,
        )
      ).trim();
      const selected = response || root.suggestion;
      if (selected) repositoryRoots[root.rootId] = selected;
    }

    return { ...options, planningRoot, repositoryRoots };
  } finally {
    interfaceInstance?.close();
  }
}
