import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PACKAGE_JSON_PATH = resolve(PACKAGE_ROOT, "package.json");
export const BUNDLED_SKILLS_DIRECTORY = resolve(PACKAGE_ROOT, "skills");
export const WORKFLOW_SOURCE_PATH = resolve(PACKAGE_ROOT, "docs", "story-driven-development.md");

export const CONFIG_DIRECTORY_NAME = ".sdd";
export const CONFIG_FILE_NAME = "config.yaml";
export const INSTALL_LOCK_FILE_NAME = "install-lock.json";
export const WORKFLOW_RELATIVE_PATH = ".sdd/story-driven-development.md";
export const WORKSPACE_CONFIG_VERSION = 3;
export const WORKSPACE_SCHEMA_VERSION = "sdd-v3";
export const REPOSITORY_CONFIG_VERSION = 2;
export const REPOSITORY_SCHEMA_VERSION = "sdd-repository-v2";

export const CHANGES_DIRECTORY_NAME = "changes";
export const CLOSED_CHANGES_DIRECTORY_NAME = "closed";

export const DEFAULT_ARTIFACT_PATHS = Object.freeze({
  epics: "docs/epics",
  adrs: "docs/adrs",
  audits: "docs/audits",
});
