import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parse } from "yaml";

import { getActiveChangePath, getClosedChangePath } from "../src/change-store.js";
import { setChangeMetadata } from "../src/change-status.js";
import { closeChange } from "../src/commands/change-close.js";
import { createChange } from "../src/commands/change-create.js";
import { setupInstallation } from "../src/commands/init-installation.js";
import { getStatus } from "../src/commands/status.js";
import { transitionChange } from "../src/commands/change-transition.js";
import { validateArtifacts } from "../src/commands/validate.js";
import { createRepositoryConfig, writeRepositoryConfig } from "../src/config.js";
import { SddError } from "../src/errors.js";
import { pathExists } from "../src/fs.js";

async function createWorkspace(t) {
  const root = await mkdtemp(join(tmpdir(), "sdd-change-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "ideas", "sample"), { recursive: true });
  await mkdir(join(root, "code", "sample-web"), { recursive: true });
  await writeRepositoryConfig(
    join(root, "code", "sample-web"),
    createRepositoryConfig("sample-web"),
  );
  await writeFile(
    join(root, "ideas", "sample", "sample.md"),
    [
      "---",
      "repositories:",
      "  - path: code/sample-web",
      "---",
      "# Sample",
      "",
    ].join("\n"),
  );
  await setupInstallation(root, { skillsDirectory: ".agents/skills" });
  return root;
}

function frontmatter(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "expected YAML frontmatter");
  return parse(match[1]);
}

async function completePlanning(changePath) {
  const changePathname = join(changePath, "change.md");
  const source = await readFile(changePathname, "utf8");
  const withRepository = setChangeMetadata(source, {
    space: "sample",
    repositories: ["sample-web"],
  });
  assert.notEqual(withRepository, null);
  await writeFile(
    changePathname,
    [
      withRepository.trimEnd(),
      "",
      "## Current Context",
      "",
      "The current system has been inspected.",
      "",
      "## Behavioral Changes",
      "",
      "The public behavior changes observably.",
      "",
      "## Technical Decision Handoffs",
      "",
      "Only one path is viable because the public boundary already exists.",
      "",
      "## Selected Approach",
      "",
      "Use the existing public boundary.",
      "",
      "## Alternatives Considered",
      "",
      "None beyond the constrained path.",
      "",
      "## Implementation Constraints",
      "",
      "Preserve the public boundary.",
      "",
      "## Verification Strategy",
      "",
      "Exercise the public behavior.",
      "",
      "## Risks / Trade-Offs",
      "",
      "The change is intentionally small.",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(changePath, "tasks.md"),
    [
      "# Tasks: Capture Intent",
      "",
      "## Resume Here",
      "",
      "Ready to implement.",
      "",
      "## Requirement Slices",
      "",
      "### S1: Expose the public behavior",
      "",
      "- Status: ready",
      "- Repository: `sample-web`",
      "- Requirements:",
      "  - New: `SAMPLE-E001/S1 R1` — The behavior is available through the public boundary.",
      "- Story changes:",
      "  - Update: `SAMPLE-E001/S1` — Add the new behavior.",
      "- Outcome: Callers can observe the behavior through the public boundary.",
      "- Scenarios: `SAMPLE-E001/S1 R1-S1`",
      "- Dependencies: none",
      "",
      "## Blockers / Open Questions",
      "",
      "None.",
      "",
      "## Closeout",
      "",
      "Pending.",
      "",
    ].join("\n"),
  );
}

test("change create captures proposed intent in one central change.md", async (t) => {
  const root = await createWorkspace(t);
  const result = await createChange(root, "sample", "capture-intent", {
    date: "2026-08-10",
  });

  assert.deepEqual(result.files, ["change.md"]);
  assert.deepEqual(result.repositories, []);

  const changePath = getActiveChangePath(result.changeId, root);
  const source = await readFile(join(changePath, "change.md"), "utf8");
  assert.deepEqual(frontmatter(source), {
    status: "proposed",
    space: "sample",
    repositories: [],
  });
  assert.match(source, /^# Change: Capture Intent$/m);
  assert.match(source, /^## Desired Outcome$/m);
  assert.equal(await pathExists(join(changePath, "design.md")), false);
  assert.equal(await pathExists(join(changePath, "tasks.md")), false);

  const status = await getStatus(root, "sample");
  assert.equal(status.activeChanges[0].status, "proposed");
  assert.deepEqual(status.activeChanges[0].repositories, []);

  const validation = await validateArtifacts(root, { changeId: result.changeId });
  assert.equal(
    validation.findings.some((finding) => finding.code === "MISSING_CHANGE_FILE"),
    false,
  );
});

test("planning completes the same Change before lifecycle work continues", async (t) => {
  const root = await createWorkspace(t);
  const result = await createChange(root, "sample", "capture-intent", {
    date: "2026-08-10",
  });
  const changePath = getActiveChangePath(result.changeId, root);

  await assert.rejects(
    () => transitionChange(root, "sample", result.changeId, {
      from: "proposed",
      to: "planned",
    }),
    (error) => error instanceof SddError && error.code === "INCOMPLETE_CHANGE",
  );

  const changeFilePath = join(changePath, "change.md");
  const proposedSource = await readFile(changeFilePath, "utf8");
  await writeFile(changeFilePath, proposedSource.replace("status: proposed", "status: planned"));
  const invalidPlan = await validateArtifacts(root, { changeId: result.changeId });
  assert.deepEqual(
    invalidPlan.findings
      .filter((finding) => finding.code === "MISSING_CHANGE_FILE")
      .map((finding) => finding.path),
    [`.sdd/changes/${result.changeId}/tasks.md`],
  );
  const plannedWithoutDesignOrSections = await validateArtifacts(root, {
    changeId: result.changeId,
  });
  assert.match(
    plannedWithoutDesignOrSections.findings.find((finding) =>
      finding.code === "MISSING_ARTIFACT_SECTION" && finding.path.endsWith("change.md"))?.message ?? "",
    /technical planning sections/,
  );
  await writeFile(changeFilePath, proposedSource);

  await completePlanning(changePath);
  assert.equal(await pathExists(join(changePath, "design.md")), false);
  await writeFile(join(changePath, "design.md"), "# Design: Incomplete\n");
  await assert.rejects(
    () => transitionChange(root, "sample", result.changeId, {
      from: "proposed",
      to: "planned",
    }),
    (error) => error instanceof SddError
      && error.code === "INCOMPLETE_CHANGE"
      && error.details.some((detail) => detail.startsWith("design.md:")),
  );
  await rm(join(changePath, "design.md"));
  await transitionChange(root, "sample", result.changeId, {
    from: "proposed",
    to: "planned",
  });
  await assert.rejects(
    () => transitionChange(root, "sample", result.changeId, {
      from: "planned",
      to: "in_progress",
      beforeCommit: async ({ changeFilePath: currentPath }) => {
        await writeFile(currentPath, `${await readFile(currentPath, "utf8")}\nConcurrent note.\n`);
      },
    }),
    (error) => error instanceof SddError && error.code === "CONCURRENT_CHANGE",
  );
  assert.equal(frontmatter(await readFile(changeFilePath, "utf8")).status, "planned");

  await transitionChange(root, "sample", result.changeId, {
    from: "planned",
    to: "in_progress",
  });
  await transitionChange(root, "sample", result.changeId, {
    from: "in_progress",
    to: "in_review",
  });

  const changeSource = await readFile(join(changePath, "change.md"), "utf8");
  assert.equal(frontmatter(changeSource).status, "in_review");
  assert.doesNotMatch(await readFile(join(changePath, "tasks.md"), "utf8"), /^---$/m);

  await closeChange(root, "sample", result.changeId);
  assert.equal(await pathExists(changePath), false);
  assert.equal(await pathExists(getClosedChangePath(result.changeId, root)), true);
  await assert.rejects(
    () => createChange(root, "sample", "capture-intent", { date: "2026-08-10" }),
    (error) => error instanceof SddError && error.code === "CHANGE_EXISTS",
  );
});
