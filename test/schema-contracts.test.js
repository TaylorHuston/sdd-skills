import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, win32 } from "node:path";
import test from "node:test";

import { validateConfig, validateRepositoryConfig } from "../src/config.js";
import { PACKAGE_ROOT } from "../src/constants.js";

const VALID_RELATIVE_PATHS = Object.freeze([
  ".",
  "./docs",
  "docs/epics",
  "docs\\epics",
  "~owner/docs",
  ".../docs",
]);

const INVALID_RELATIVE_PATHS = Object.freeze([
  "",
  "nul\0path",
  "~",
  "~/skills",
  "~\\skills",
  "/absolute",
  "\\absolute",
  "C:/absolute",
  "C:\\absolute",
  "C:",
  "C:relative",
  "z:relative\\path",
  "..",
  "../outside",
  "..\\outside",
  "inside/../outside",
  "inside\\..\\outside",
]);

function matchesDefinition(schema, definitionName, value) {
  function matches(rule) {
    if (rule.$ref) {
      const prefix = "#/$defs/";
      assert.ok(rule.$ref.startsWith(prefix), `Unsupported schema reference: ${rule.$ref}`);
      return matches(schema.$defs[rule.$ref.slice(prefix.length)]);
    }
    if (rule.type === "string" && typeof value !== "string") return false;
    if (rule.minLength !== undefined && value.length < rule.minLength) return false;
    if (rule.pattern !== undefined && !new RegExp(rule.pattern, "u").test(value)) return false;
    if (rule.allOf && !rule.allOf.every(matches)) return false;
    if (rule.not && matches(rule.not)) return false;
    return true;
  }

  return matches(schema.$defs[definitionName]);
}

function workspaceConfig() {
  return {
    version: 3,
    schema: "sdd-v3",
    skills: { directory: ".agents/skills" },
    planning: { root: "planning" },
    repositories: { roots: { code: "repositories" } },
    repositoryArtifacts: {
      epics: "docs/epics",
      adrs: "docs/adrs",
      audits: "docs/audits",
    },
    ideas: {
      sample: {
        status: "active",
        repositories: [{ root: "code", path: ".", status: "active" }],
      },
    },
  };
}

function repositoryConfig(epics = "docs/epics") {
  return {
    kind: "repository",
    version: 2,
    schema: "sdd-repository-v2",
    id: "schema-contract",
    artifacts: {
      epics,
      adrs: "schema-contract/adrs",
      audits: "schema-contract/audits",
    },
  };
}

test("workspace and repository schemas reuse the runtime lexical path contract", async () => {
  const [workspaceSchema, repositorySchema] = await Promise.all([
    readFile(join(PACKAGE_ROOT, "schemas", "workspace.schema.json"), "utf8").then(JSON.parse),
    readFile(join(PACKAGE_ROOT, "schemas", "repository.schema.json"), "utf8").then(JSON.parse),
  ]);

  const ideaProperties = workspaceSchema.$defs.ideas.additionalProperties.properties;
  const repositoryItem = ideaProperties.repositories.items;
  const relativeReferences = [
    workspaceSchema.properties.skills.properties.directory,
    ...Object.values(workspaceSchema.$defs.repositoryArtifacts.properties),
    ideaProperties.planning,
    repositoryItem.allOf[0].then.properties.path,
  ];
  for (const property of relativeReferences) {
    assert.equal(property.$ref, "#/$defs/relativePath");
  }
  const configuredReferences = [
    workspaceSchema.properties.planning.properties.root,
    workspaceSchema.properties.repositories.properties.roots.additionalProperties,
    ideaProperties.planningPath,
    repositoryItem.properties.path,
  ];
  for (const property of configuredReferences) {
    assert.equal(property.$ref, "#/$defs/configuredPath");
  }
  assert.equal(
    workspaceSchema.properties.repositories.properties.roots.propertyNames.$ref,
    "#/$defs/nonEmptyNulFreeString",
  );
  assert.equal(
    workspaceSchema.$defs.ideas.propertyNames.$ref,
    "#/$defs/nonEmptyNulFreeString",
  );
  assert.equal(repositoryItem.properties.root.$ref, "#/$defs/nonEmptyNulFreeString");
  for (const property of Object.values(repositorySchema.properties.artifacts.properties)) {
    assert.equal(property.$ref, "#/$defs/relativePath");
  }

  for (const invalidName of ["", "nul\0name"]) {
    assert.equal(
      matchesDefinition(workspaceSchema, "nonEmptyNulFreeString", invalidName),
      false,
      `mapping key must be rejected: ${JSON.stringify(invalidName)}`,
    );
  }
  for (const path of INVALID_RELATIVE_PATHS) {
    assert.equal(
      matchesDefinition(workspaceSchema, "relativePath", path),
      false,
      `workspace-relative path must be rejected: ${JSON.stringify(path)}`,
    );
    assert.equal(
      matchesDefinition(repositorySchema, "relativePath", path),
      false,
      `repository-relative path must be rejected: ${JSON.stringify(path)}`,
    );
    const workspace = workspaceConfig();
    workspace.skills.directory = path;
    workspace.ideas.sample.planning = path;
    workspace.ideas.sample.repositories[0].path = path;
    assert.ok(
      validateConfig(workspace).some((finding) =>
        finding.message.includes("must be workspace-relative")
        || finding.message.includes("must be a non-empty path")
        || finding.message.includes("must not")
        || finding.message.includes("cannot traverse")),
      `workspace runtime must reject ${JSON.stringify(path)}`,
    );
    assert.ok(
      validateRepositoryConfig(repositoryConfig(path))
        .some((finding) => finding.message.includes("artifacts.epics")),
      `repository runtime must reject ${JSON.stringify(path)}`,
    );
  }
  for (const path of VALID_RELATIVE_PATHS) {
    assert.equal(matchesDefinition(workspaceSchema, "relativePath", path), true);
    assert.equal(matchesDefinition(repositorySchema, "relativePath", path), true);

    const workspace = workspaceConfig();
    workspace.skills.directory = path;
    workspace.ideas.sample.planning = path;
    workspace.ideas.sample.repositories[0].path = path;
    assert.deepEqual(validateConfig(workspace), [], `runtime must accept ${JSON.stringify(path)}`);

    assert.deepEqual(
      validateRepositoryConfig(repositoryConfig(`${path}/epics`)),
      [],
      `repository runtime must accept ${JSON.stringify(path)}`,
    );
  }
});

test("Windows drive roots remain external-only while every drive prefix is relative-path unsafe", async () => {
  const [workspaceSchema, repositorySchema] = await Promise.all([
    readFile(join(PACKAGE_ROOT, "schemas", "workspace.schema.json"), "utf8").then(JSON.parse),
    readFile(join(PACKAGE_ROOT, "schemas", "repository.schema.json"), "utf8").then(JSON.parse),
  ]);

  for (const path of ["C:", "C:relative", "z:relative\\path"]) {
    assert.equal(win32.isAbsolute(path), false);
    assert.equal(matchesDefinition(workspaceSchema, "relativePath", path), false);
    assert.equal(matchesDefinition(repositorySchema, "relativePath", path), false);
    assert.equal(matchesDefinition(workspaceSchema, "configuredPath", path), false);
    const config = workspaceConfig();
    config.planning.root = path;
    config.repositories.roots.code = path;
    config.ideas.sample.planningPath = path;
    config.ideas.sample.repositories = [{ path, status: "active" }];
    assert.ok(
      validateConfig(config).some((finding) =>
        finding.message.includes("must not use a drive-relative path")),
      `configured runtime path must reject ${JSON.stringify(path)}`,
    );
  }
  for (const path of ["C:/external/path", "C:\\external\\path"]) {
    assert.equal(win32.isAbsolute(path), true);
    assert.equal(matchesDefinition(workspaceSchema, "relativePath", path), false);
    assert.equal(matchesDefinition(repositorySchema, "relativePath", path), false);
    assert.equal(matchesDefinition(workspaceSchema, "configuredPath", path), true);
    const config = workspaceConfig();
    config.planning.root = path;
    config.repositories.roots.code = path;
    config.ideas.sample.repositories = [{ path, status: "active" }];
    assert.deepEqual(validateConfig(config), []);
  }
});

test("workspace schema distinguishes external configured paths from relative-only paths", async () => {
  const schema = JSON.parse(
    await readFile(join(PACKAGE_ROOT, "schemas", "workspace.schema.json"), "utf8"),
  );

  for (const path of ["relative/path", "/external/path", "C:\\external\\path"]) {
    assert.equal(matchesDefinition(schema, "configuredPath", path), true);
    const config = workspaceConfig();
    config.planning.root = path;
    config.repositories.roots.code = path;
    config.ideas.sample.repositories = [{ path, status: "active" }];
    assert.deepEqual(validateConfig(config), [], `runtime must accept ${JSON.stringify(path)}`);
  }
  for (const path of [
    "",
    "nul\0path",
    "~",
    "~/outside",
    "inside/../outside",
    "C:",
    "C:relative",
  ]) {
    assert.equal(matchesDefinition(schema, "configuredPath", path), false);
    const config = workspaceConfig();
    config.planning.root = path;
    assert.ok(
      validateConfig(config).some((finding) => finding.message.startsWith("planning.root")),
      `runtime must reject ${JSON.stringify(path)}`,
    );
  }

  assert.match(schema.description, /Runtime validation.*dynamic root references.*physical containment/i);
  const repositorySchema = JSON.parse(
    await readFile(join(PACKAGE_ROOT, "schemas", "repository.schema.json"), "utf8"),
  );
  assert.match(
    repositorySchema.description,
    /Runtime validation.*normalized ownership.*overlapping artifact owners.*physical owner/i,
  );
});
