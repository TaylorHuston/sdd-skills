import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { PACKAGE_ROOT } from "../src/constants.js";

function packagePath(...parts) {
  return join(PACKAGE_ROOT, ...parts);
}

async function source(...parts) {
  return readFile(packagePath(...parts), "utf8");
}

async function missing(...parts) {
  try {
    await access(packagePath(...parts));
    return false;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
}

const legacyProducerPatterns = [
  /Closure receipt: required/,
  /^## Implementation Ledger$/m,
  /^## Slice Gate Ledger$/m,
  /slice-reviews\/<slice-id>/,
  /slice-closures\/<slice-id>/,
  /sdd-slice-review-v1/,
  /sdd-slice-closure-v2/,
];

test("current Change templates use one v2 three-artifact contract", async () => {
  const [changeSkill, changeTemplate, docsChange, tasksTemplate, docsTasks, reviewTemplate, docsReview] = await Promise.all([
    source("skills", "sdd-change", "SKILL.md"),
    source("skills", "sdd-change", "assets", "change-template.md"),
    source("docs", "templates", "change.md"),
    source("skills", "sdd-change", "assets", "tasks-template.md"),
    source("docs", "templates", "tasks.md"),
    source("skills", "sdd-review", "assets", "review-template.md"),
    source("docs", "templates", "review.md"),
  ]);

  assert.equal(changeTemplate, docsChange);
  assert.equal(tasksTemplate, docsTasks);
  assert.equal(reviewTemplate, docsReview);
  assert.match(changeTemplate, /^schema: sdd-change-v2$/m);
  assert.match(tasksTemplate, /^## Resume Here$/m);
  assert.match(tasksTemplate, /^## Delivery Outcomes$/m);
  assert.match(tasksTemplate, /^## Closeout$/m);
  assert.match(reviewTemplate, /^schema: sdd-review-v2$/m);
  assert.match(changeSkill, /three workspace-central records/);
  assert.match(changeSkill, /focused behavior-derived and repository-required checks/);
  assert.match(changeSkill, /Repository guidance and specialist workflows own how implementation happens/);
  for (const pattern of legacyProducerPatterns) assert.doesNotMatch(tasksTemplate, pattern);
});

test("Apply delivers one reviewed outcome without legacy closure machinery", async () => {
  const [applySkill, applyAgent] = await Promise.all([
    source("skills", "sdd-apply", "SKILL.md"),
    source("skills", "sdd-apply", "agents", "openai.yaml"),
  ]);

  assert.match(applySkill, /Deliver one coherent outcome/);
  assert.match(applySkill, /repository guidance and specialist workflows own implementation method/i);
  assert.match(applySkill, /run fresh focused Scenario and repository-required checks/);
  assert.match(applySkill, /five universal gate results/);
  assert.match(applySkill, /one consolidated safe remediation batch/);
  assert.match(applySkill, /Reconcile repository-owned Epic truth now when/);
  assert.match(applySkill, /selectively stage only reviewed outcome paths/);
  assert.match(applySkill, /commit tree equals the reviewed staged tree/);
  assert.match(applySkill, /Do not generate per-outcome Review files, closure receipts/);
  assert.match(applyAgent, /one content-identical local commit/);
});

test("Review uses five universal gates and concrete planned or discovered triggers", async () => {
  const [reviewSkill, reviewTemplate, reviewAgent] = await Promise.all([
    source("skills", "sdd-review", "SKILL.md"),
    source("skills", "sdd-review", "assets", "review-template.md"),
    source("skills", "sdd-review", "agents", "openai.yaml"),
  ]);
  const gateIds = [
    "scope-candidate",
    "behavior",
    "fresh-verification",
    "independent-review",
    "integrity-authority",
  ];

  for (const gate of gateIds) assert.match(reviewTemplate, new RegExp(`^\\| ${gate} \\|`, "m"));
  assert.equal((reviewTemplate.match(/^\| (?:scope-candidate|behavior|fresh-verification|independent-review|integrity-authority) \|/gm) ?? []).length, 5);
  assert.match(reviewSkill, /Execute every expected trigger declared by the outcome/);
  assert.match(reviewSkill, /UI\/accessibility trigger requires current-source rendering/);
  assert.match(reviewSkill, /A blocking finding does not justify skipping other safe/);
  assert.match(reviewSkill, /running or yielded command remains pending Review work/);
  assert.match(reviewSkill, /Generic `not-applicable` rows/);
  assert.match(reviewSkill, /Spec Adherence `pass`/);
  assert.match(reviewSkill, /Implementation Quality `pass`/);
  assert.match(reviewSkill, /central `review\.md`/);
  assert.match(reviewAgent, /five universal gates/);
});

test("Interactive reuses normal v2 records and Apply", async () => {
  const interactive = await source("skills", "sdd-interactive", "SKILL.md");

  assert.match(interactive, /thin convenience route through the same Change, Apply, Review, and Epic contracts/);
  assert.match(interactive, /change\.md\n  tasks\.md\n  review\.md/);
  assert.match(interactive, /compose `\/sdd-apply S1`/);
  assert.match(interactive, /Do not add request logs, implementation ledgers, verification ledgers/);
  assert.doesNotMatch(interactive, /^## Interactive Log$/m);
});

test("Epic Update is conditional and records current truth rather than implementation method", async () => {
  const epicUpdate = await source("skills", "sdd-epic-update", "SKILL.md");

  assert.match(epicUpdate, /Reconcile immediately when the candidate/);
  assert.match(epicUpdate, /Otherwise return an evidence-based `no-op` and defer broad Epic reconciliation/);
  assert.match(epicUpdate, /Skills record what is implemented, what proves it, and what remains/);
  assert.match(epicUpdate, /Repository guidance and specialist workflows own how code and tests are built/);
  assert.doesNotMatch(epicUpdate, /Slice Gate Ledger|closure receipt|post-Epic/);
});

test("supporting workflows preserve central ownership and independent capability boundaries", async () => {
  const [gather, explore, adr, changelog, prd, pr, release, status] = await Promise.all([
    source("skills", "sdd-gather-context", "SKILL.md"),
    source("skills", "sdd-explore", "SKILL.md"),
    source("skills", "sdd-adr", "SKILL.md"),
    source("skills", "sdd-changelog", "SKILL.md"),
    source("skills", "sdd-prd", "SKILL.md"),
    source("skills", "sdd-pr", "SKILL.md"),
    source("skills", "sdd-release", "SKILL.md"),
    source("skills", "sdd-space-status", "SKILL.md"),
  ]);

  assert.match(gather, /same-session/);
  assert.match(gather, /creates no artifact|create no artifact/i);
  assert.match(explore, /Choose The Record Destination/);
  assert.match(explore, /Route Mature Outcomes/);
  assert.match(adr, /do not mutate those artifacts from this skill/);
  assert.match(changelog, /candidate kind: current working tree or explicit commit\/ref/i);
  assert.match(changelog, /never fabricate Apply history/);
  assert.match(prd, /directional/i);
  assert.match(prd, /review\.md/);
  for (const text of [pr, release, status]) assert.match(text, /central Change/i);
  assert.match(pr, /candidate and acceptance truth in central `review\.md`/);
  assert.match(pr, /PR URLs, heads, checks, remote-review watermarks, and merge state in provider-native PR records/);
  assert.match(release, /candidate, accepted-gap, or manual-acceptance truth[\s\S]*central `review\.md`/);
  assert.match(status, /candidate, Review, gap, acceptance, and final-commit truth in `review\.md`/);
  assert.doesNotMatch(pr, /central `tasks\.md` records canonical manual-confirmation/);
  assert.doesNotMatch(release, /update the one central `tasks\.md` with repository-keyed release, PR, merge, acceptance/);
});

test("active release and guide acceptance truth match current v2", async () => {
  const [changelog, guideVerification, epic] = await Promise.all([
    source("CHANGELOG.md"),
    source("docs", "verification", "s3-risk-triggered-guide.md"),
    source("docs", "epics", "sdd-e001-reliable-cli-operations", "epic.md"),
  ]);
  const unreleased = changelog.slice(
    changelog.indexOf("## [Unreleased]"),
    changelog.indexOf("## [0.12.0]"),
  );

  assert.match(unreleased, /central `review\.md` owns exact candidates, five universal gates/);
  assert.match(unreleased, /receipt-based records are unsupported pre-1\.0 history/);
  assert.match(unreleased, /Removed generated Implementation and Gate ledgers/);
  assert.doesNotMatch(
    unreleased,
    /sdd-slice-review-v1|sdd-slice-closure-v2|slice-reviews\/|slice-closures\/|Closure receipt: required|remain compatible|minimal v2 receipt|Commit column to the Implementation Ledger/,
  );
  assert.match(guideVerification, /Technical result: pass\./);
  assert.match(guideVerification, /Manual product acceptance: user confirmed 2026-08-18\./);
  assert.match(epic, /owner product acceptance was separately confirmed on 2026-08-18/);
  assert.match(epic, /Owner manual confirmation of the current guide was `user confirmed` on 2026-08-18/);
  assert.doesNotMatch(epic, /Owner manual confirmation of the current guide remains `pending user`/);
});

test("public doctrine describes one supported current workflow", async () => {
  const [readme, doctrine, templatesReadme, design, historicalGuideEvidence] = await Promise.all([
    source("README.md"),
    source("docs", "story-driven-development.md"),
    source("docs", "templates", "README.md"),
    source("skills", "sdd-design", "SKILL.md"),
    source("docs", "verification", "s1-progressive-workflow.md"),
  ]);

  for (const text of [readme, doctrine]) {
    assert.match(text, /schema: sdd-change-v2/);
    assert.match(text, /five universal gates/i);
    assert.match(text, /focused behavior-derived/i);
    assert.match(text, /unsupported history/i);
  }
  assert.match(templatesReadme, /Central Change Review/);
  assert.match(design, /central `review\.md` candidate, verification, verdict, and final commit\/tree pending or stale/);
  assert.match(design, /first dependency-ready outcome/);
  assert.doesNotMatch(design, /Design Revision Context|starting slices|Requirement\/Scenario implementation slice|reopened slices/);
  assert.doesNotMatch(doctrine, /Apply selects one slice|reopens every affected slice/);
  assert.match(historicalGuideEvidence, /historical visual and interaction evidence/i);
  assert.match(historicalGuideEvidence, /not current workflow guidance/i);
  assert.doesNotMatch(historicalGuideEvidence, /test\/(?:change-tasks|slice-review|slice-closure)\.test\.js|detailed Review\/minimal receipt boundary/);
  assert.equal(await missing("docs", "templates", "slice-review.md"), true);
  assert.equal(await missing("docs", "templates", "slice-closure.yaml"), true);
  assert.equal(await missing("skills", "sdd-review", "assets", "slice-review-template.md"), true);
  assert.equal(await missing("skills", "sdd-review", "assets", "subagent-pr-review-prompt.md"), true);
  assert.equal(await missing("skills", "sdd-apply", "assets", "slice-closure-template.yaml"), true);
  assert.equal(await missing("src", "change-tasks.js"), true);
  assert.equal(await missing("src", "slice-review.js"), true);
  assert.equal(await missing("src", "slice-closure.js"), true);
  assert.equal(await missing("test", "slice-closure.test.js"), true);
});
