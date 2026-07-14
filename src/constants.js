import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PACKAGE_JSON_PATH = resolve(PACKAGE_ROOT, "package.json");
export const BUNDLED_SKILLS_DIRECTORY = resolve(PACKAGE_ROOT, "skills");

export const CONFIG_DIRECTORY_NAME = ".sdd";
export const CONFIG_FILE_NAME = "config.yaml";
export const INSTALL_LOCK_FILE_NAME = "install-lock.json";
export const CONFIG_VERSION = 2;
export const SCHEMA_VERSION = "sdd-v2";

export const DEFAULT_ARTIFACT_PATHS = Object.freeze({
  activeChanges: "docs/changes",
  closedChanges: "docs/changes/closed",
  epics: "docs/epics",
  adrs: "docs/adrs",
  audits: "docs/audits",
});
