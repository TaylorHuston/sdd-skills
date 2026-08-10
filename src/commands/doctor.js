import { assertRepositoryArtifactRoots } from "../change-repositories.js";
import {
  getRepositoryConfigPath,
  getWorkspaceConfigPath,
  isSupportedLegacyWorkspaceConfig,
  readRepositoryConfig,
  resolveIdeaPlanningPath,
  resolveRepositoryPath,
  resolveWorkspacePath,
  validateConfig,
  validateRepositoryConfig,
} from "../config.js";
import { isDirectory, resolvePhysicalPath } from "../fs.js";
import { inspectChangeStatuses } from "../change-status.js";
import { inspectProjectGuidance } from "../guidance.js";
import { inspectSkillInstallation } from "../skills.js";
import { inspectWorkflowInstallation } from "../workflow.js";
import { findOperationConfiguration, resolveOperationConfiguration } from "../workspace.js";
import { inspectCloseTransactionReceipts } from "../change-close-transaction.js";
import { inspectTransitionTransactionReceipts } from "../change-transition-transaction.js";

function repositoryMappingLabel({ ideaId, resolvedPath }) {
  return `${ideaId} (${resolvedPath})`;
}

async function inspectRepositoryContracts(workspaceRoot, mappings, ideaIds) {
  const findings = [];
  const repositoryIdsByIdea = new Map(ideaIds.map((ideaId) => [ideaId, new Set()]));
  const claimedIds = new Map();
  const claimedPhysicalPaths = new Map();
  const orderedMappings = [...mappings].sort(
    (left, right) => left.ideaId.localeCompare(right.ideaId)
      || left.resolvedPath.localeCompare(right.resolvedPath),
  );

  for (const mapping of orderedMappings) {
    const repositoryRoot = resolveWorkspacePath(workspaceRoot, mapping.resolvedPath);
    const physicalPath = mapping.physicalPath;
    const previousPhysicalOwner = claimedPhysicalPaths.get(physicalPath);
    if (previousPhysicalOwner) {
      findings.push({
        level: "error",
        code: "REPOSITORY_OWNERSHIP_COLLISION",
        message: `Mapped repository physical ownership is duplicated by ${repositoryMappingLabel(previousPhysicalOwner)} and ${repositoryMappingLabel(mapping)}.`,
      });
    } else {
      claimedPhysicalPaths.set(physicalPath, mapping);
    }

    let repositoryConfig;
    try {
      repositoryConfig = await readRepositoryConfig(repositoryRoot);
    } catch (error) {
      findings.push({
        level: "error",
        code: error?.code ?? "INVALID_REPOSITORY_CONFIG",
        message: `Cannot read repository configuration for ${repositoryMappingLabel(mapping)}: ${error.message}`,
      });
      continue;
    }
    if (!repositoryConfig) {
      findings.push({
        level: "error",
        code: "REPOSITORY_ID_REQUIRED",
        message: `Mapped repository ${repositoryMappingLabel(mapping)} has no portable SDD repository identity at ${getRepositoryConfigPath(repositoryRoot)}.`,
      });
      continue;
    }

    const configErrors = validateRepositoryConfig(repositoryConfig)
      .filter((finding) => finding.level === "error");
    if (configErrors.length > 0) {
      findings.push(...configErrors.map((finding) => ({
        level: "error",
        code: "INVALID_REPOSITORY_CONFIG",
        message: `Invalid repository configuration for ${repositoryMappingLabel(mapping)}: ${finding.message}`,
      })));
      continue;
    }
    try {
      await assertRepositoryArtifactRoots(repositoryRoot, repositoryConfig.artifacts, {
        repositoryPath: mapping.resolvedPath,
      });
    } catch (error) {
      findings.push({
        level: "error",
        code: error?.code ?? "UNSAFE_ARTIFACT_PATH",
        message: `Invalid repository artifact topology for ${repositoryMappingLabel(mapping)}: ${error.message}`,
        details: Array.isArray(error?.details) ? [...error.details] : [],
      });
      continue;
    }

    repositoryIdsByIdea.get(mapping.ideaId)?.add(repositoryConfig.id);
    const repositoryIdKey = `${mapping.ideaId}\0${repositoryConfig.id}`;
    const previousIdOwner = claimedIds.get(repositoryIdKey);
    if (previousIdOwner) {
      findings.push({
        level: "error",
        code: "REPOSITORY_ID_COLLISION",
        message: `Repository ID ${repositoryConfig.id} is claimed by multiple mapped repositories: ${repositoryMappingLabel(previousIdOwner)}, ${repositoryMappingLabel(mapping)}.`,
      });
    } else {
      claimedIds.set(repositoryIdKey, mapping);
    }
  }

  return { findings, repositoryIdsByIdea };
}

export async function diagnoseWorkspace(
  startPath,
  {
    workspaceRoot: requestedWorkspaceRoot = null,
    afterChangeFileRead = null,
    afterClosedChangeInventory = null,
    afterStoredChangesInventory = null,
  } = {},
) {
  const discoveryOptions = {
    repositoryTopology: "observational",
    ...(requestedWorkspaceRoot ? { workspaceRoot: requestedWorkspaceRoot } : {}),
  };
  let { workspaceRoot, config } = await findOperationConfiguration(startPath, discoveryOptions);
  const migrationPending = isSupportedLegacyWorkspaceConfig(config);
  const findings = migrationPending
    ? [{
        level: "error",
        code: "CONFIG_MIGRATION_REQUIRED",
        message: "SDD workspace configuration migration is required. Run `sdd update` before using this workspace.",
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
      workspaceConfigPath: getWorkspaceConfigPath(workspaceRoot),
      findings,
      counts,
      remediations: [],
      healthy: false,
    };
  }

  const operation = await resolveOperationConfiguration(startPath, discoveryOptions);
  workspaceRoot = operation.workspaceRoot;
  config = operation.config;

  const checkDirectory = async (label, configuredPath, level = "warning") => {
    const exists = await isDirectory(resolveWorkspacePath(workspaceRoot, configuredPath));
    if (!exists) {
      findings.push({ level, message: `${label} does not exist: ${configuredPath}.` });
    }
    return exists;
  };
  const checkMappedRepositoryDirectory = async (label, configuredPath) => {
    const repositoryRoot = resolveWorkspacePath(workspaceRoot, configuredPath);
    let physicalPath;
    try {
      physicalPath = await resolvePhysicalPath(repositoryRoot);
    } catch (error) {
      findings.push({
        level: "error",
        code: error?.code ?? "REPOSITORY_CONFIG_UNAVAILABLE",
        message: `Cannot resolve ${label.toLowerCase()}: ${configuredPath}. ${error.message}`,
      });
      return null;
    }
    if (!(await isDirectory(physicalPath))) {
      findings.push({ level: "warning", message: `${label} does not exist: ${configuredPath}.` });
      return null;
    }
    return physicalPath;
  };

  let planningRootExists = true;
  if (typeof config.planning?.root === "string") {
    planningRootExists = await checkDirectory("Planning root", config.planning.root);
  }
  const repositoryRootExists = {};
  for (const [rootId, repositoryRoot] of Object.entries(config.repositories?.roots ?? {})) {
    repositoryRootExists[rootId] = await checkMappedRepositoryDirectory(
      `Repository root ${rootId}`,
      repositoryRoot,
    ) !== null;
  }
  const existingRepositoryMappings = [];
  for (const [ideaId, idea] of Object.entries(config.ideas ?? {})) {
    if (idea._repositoryOnly !== true && (planningRootExists || idea.planningPath !== undefined)) {
      await checkDirectory(
        `Planning directory for ${ideaId}`,
        resolveIdeaPlanningPath(config, ideaId, idea),
      );
    }
    for (const repository of idea.repositories ?? []) {
      if (repository.root && repositoryRootExists[repository.root] === false) continue;
      const resolvedPath = resolveRepositoryPath(config, repository);
      const physicalPath = await checkMappedRepositoryDirectory(
        `Repository for ${ideaId}`,
        resolvedPath,
      );
      if (physicalPath !== null) {
        existingRepositoryMappings.push({ ideaId, resolvedPath, physicalPath });
      }
    }
  }

  const repositoryContracts = await inspectRepositoryContracts(
    workspaceRoot,
    existingRepositoryMappings,
    Object.keys(config.ideas ?? {}),
  );
  findings.push(...repositoryContracts.findings);

  findings.push(...(await inspectSkillInstallation(workspaceRoot, config)));
  findings.push(...(await inspectWorkflowInstallation(workspaceRoot)));
  findings.push(...(await inspectProjectGuidance(workspaceRoot, config)));
  findings.push(...(await inspectCloseTransactionReceipts(workspaceRoot)));
  findings.push(...(await inspectTransitionTransactionReceipts(workspaceRoot)));
  findings.push(...(await inspectChangeStatuses(
    workspaceRoot,
    config,
    repositoryContracts.repositoryIdsByIdea,
    {
      afterChangeFileRead,
      afterClosedChangeInventory,
      afterStoredChangesInventory,
    },
  )));

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
    workspaceConfigPath: getWorkspaceConfigPath(workspaceRoot),
    findings,
    counts,
    remediations,
    healthy: counts.errors === 0,
  };
}
