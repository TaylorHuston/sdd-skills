import { readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import {
  resolveRepositoryPath,
  resolveWorkspacePath,
  resolveWorkspaceStatus,
} from "./config.js";
import { isDirectory, pathExists } from "./fs.js";

const PROJECT_GUIDANCE_PATHS = Object.freeze([
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  join(".github", "copilot-instructions.md"),
]);

function normalizeDisplayPath(path) {
  return path.split(sep).join("/");
}

function configuredRepositoryPaths(workspaceRoot, config) {
  const paths = new Set();
  for (const idea of Object.values(config.ideas ?? {})) {
    if (resolveWorkspaceStatus(idea.status) !== "active") continue;
    for (const repository of idea.repositories ?? []) {
      if (resolveWorkspaceStatus(repository.status) !== "active") continue;
      paths.add(resolveWorkspacePath(workspaceRoot, resolveRepositoryPath(config, repository)));
    }
  }
  return [...paths];
}

export async function inspectProjectGuidance(workspaceRoot, config) {
  const findings = [];
  for (const repositoryPath of configuredRepositoryPaths(workspaceRoot, config)) {
    if (!(await isDirectory(repositoryPath))) continue;

    for (const relativeGuidancePath of PROJECT_GUIDANCE_PATHS) {
      const guidancePath = join(repositoryPath, relativeGuidancePath);
      if (!(await pathExists(guidancePath))) continue;

      const source = (await readFile(guidancePath, "utf8")).replaceAll("\\", "/");
      const displayPath = normalizeDisplayPath(relative(workspaceRoot, guidancePath));
      const references = findObsoleteGuidanceReferences(source);
      if (references.has("workflow")) {
        findings.push({
          level: "error",
          message: `${displayPath} references the obsolete SDD workflow location. Run \`sdd context <path> --json\` and read the returned \`workflowPath\`.`,
        });
      }
      if (references.has("command")) {
        findings.push({
          level: "error",
          message: `${displayPath} references the retired /sdd-propose command. Use /sdd-change --plan instead.`,
        });
      }
    }
  }
  return findings;
}

export function findObsoleteGuidanceReferences(source) {
  const references = new Set();
  let fenced = false;
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || !trimmed || trimmed.startsWith(">")) continue;
    for (const clause of trimmed.split(/[.;](?:\s+|$)/)) {
      if (/\b(?:do not|don't|never|avoid|must not|should not)\b/i.test(clause)) continue;
      if (/\bnot\s+(?:required|necessary|correct)\b/i.test(clause)) continue;
      if (/\b(?:incorrect|wrong)\s+to\b/i.test(clause)) continue;
      if (/\b(?:historically|previously|formerly|former|old|retired|obsolete|example)\b/i.test(clause)) continue;
      if (/\bmigrat(?:ed|ing)\s+from\b/i.test(clause)) continue;
      if (/\breplac(?:ed|ing)\b[^!?]{0,100}\bwith\b/i.test(clause)) continue;
      if (/\b(?:appears?|quoted|copied)\b[^!?]{0,80}\b(?:imported|external|quoted)\s+documentation\b/i.test(clause)) continue;
      if (
        /\b(?:read|open|load|use|follow|consult)\b[^!?]{0,100}\.sdd\/story-driven-development\.md\b/i.test(clause)
        || /\.sdd\/story-driven-development\.md\b[^!?]{0,100}\b(?:must|should|is required to)\s+be\s+(?:read|opened|loaded|followed|consulted)\b/i.test(clause)
        || /\.sdd\/story-driven-development\.md\b[^!?]{0,50}\b(?:is\s+)?(?:required|mandatory)\s+reading\b/i.test(clause)
      ) {
        references.add("workflow");
      }
      if (
        /\b(?:use|run|invoke|call|execute)\b[^!?]{0,100}\/sdd-propose\b/i.test(clause)
        || /\/sdd-propose\b[^!?]{0,100}\b(?:is|required|must|should)\b[^!?]{0,30}\b(?:required|run|used|invoked|called|executed)\b/i.test(clause)
      ) {
        references.add("command");
      }
    }
  }
  return references;
}
