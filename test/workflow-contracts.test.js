import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { PACKAGE_ROOT } from "../src/constants.js";

async function readPackageFile(...segments) {
  return readFile(join(PACKAGE_ROOT, ...segments), "utf8");
}

function markdownSection(source, title) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    return match?.[2] === title;
  });

  assert.notEqual(start, -1, `Expected Markdown section "${title}"`);

  const level = /^(#{1,6})\s+/.exec(lines[start])[1].length;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const nextHeading = /^(#{1,6})\s+/.exec(lines[index]);
    if (nextHeading && nextHeading[1].length <= level) {
      end = index;
      break;
    }
  }

  return lines.slice(start, end).join("\n");
}

function compact(source) {
  return source.replace(/\s+/g, " ").trim();
}

function assertContractClauses(label, source, clauses) {
  const normalized = compact(source);
  let cursor = 0;

  for (const [description, pattern] of clauses) {
    const match = pattern.exec(normalized.slice(cursor));
    assert.ok(match, `${label} must ${description}`);
    cursor += match.index + match[0].length;
  }
}

test("packaged change workflow progresses one central intent record into planning", async () => {
  const changeSkill = await readPackageFile("skills", "sdd-change", "SKILL.md");
  const changeTemplate = await readPackageFile("docs", "templates", "change.md");
  const packagedChangeTemplate = await readPackageFile(
    "skills",
    "sdd-change",
    "assets",
    "change-template.md",
  );
  const planningSections = await readPackageFile("docs", "templates", "planning-sections.md");
  const packagedPlanningSections = await readPackageFile(
    "skills",
    "sdd-change",
    "assets",
    "planning-sections.md",
  );
  const tasksTemplate = await readPackageFile("docs", "templates", "tasks.md");

  assert.equal(packagedChangeTemplate, changeTemplate);
  assert.equal(packagedPlanningSections, planningSections);
  assert.match(changeSkill, /Select Or Create The Change/);
  assert.match(changeSkill, /## Capture Intent/);
  assert.match(changeSkill, /## Technical Planning/);
  assert.match(
    changeSkill,
    /two or more meaningfully different viable technical approaches, invoke `\/sdd-adr` before selecting or finalizing the approach/,
  );
  assert.match(
    changeSkill,
    /`\/sdd-adr` owns option comparison, recommendation, user decision, and the judgment about whether to create or update a durable ADR/,
  );
  assert.match(
    changeSkill,
    /When only one technical approach is viable, state the constraining reason in `change\.md`; do not invent alternatives or invoke `\/sdd-adr` ceremonially/,
  );
  assert.match(changeSkill, /Revising An Existing Plan/);
  assert.match(changeSkill, /`proposed`: intent exists, but ownership or technical planning may be incomplete/);
  assert.match(changeSkill, /Progressively append or update the sections from `assets\/planning-sections\.md` in `change\.md`/);
  assert.match(changeSkill, /Do not create `design\.md` for future Changes/);
  assert.match(changeSkill, /smallest practical vertical unit that can become independently green/);
  assert.match(changeSkill, /focused Scenario-based test cycle/);
  assert.match(changeSkill, /meaningful independent review verdict/);
  assert.match(changeSkill, /one slice may be rejected without necessarily rejecting adjacent slices/);
  assert.match(changeSkill, /identify each Requirement as new or revised/);
  assert.match(changeSkill, /name every Story to create or update/);
  assert.match(changeSkill, /cite authoritative Scenario IDs/);
  assert.match(changeSkill, /binding constraints/);
  assert.match(changeSkill, /`Consumes` and `Produces` contracts/);
  assert.match(changeSkill, /focused verification intent and whether manual acceptance is required/);
  assert.match(changeSkill, /what must be implemented, never how to implement it/);
  assert.match(changeSkill, /initialize one lightweight Implementation Ledger row per slice/);
  assert.match(changeSkill, /initialize one compact Slice Gate Ledger row per slice/);
  assert.match(changeSkill, /current-state resume aids that `\/sdd-apply` maintains/);
  assert.match(changeSkill, /resequence, split, or merge slices/);
  assert.doesNotMatch(changeSkill, /--brief|--plan|--replan|proposal\.md|change-briefs/);
  assert.match(changeTemplate, /status: proposed/);
  assert.match(changeTemplate, /space: <space-id>/);
  assert.match(changeTemplate, /repositories: \[\]/);
  assert.match(tasksTemplate, /^## Resume Here$/m);
  assert.match(tasksTemplate, /- Change: `<change-id>`/);
  assert.match(tasksTemplate, /- Verification candidate: pending/);
  assert.match(tasksTemplate, /- Epic-update candidate: pending/);
  assert.match(tasksTemplate, /^\| Repository \| Root \| Baseline \| Candidate kind \| Candidate watermark \|$/m);
  assert.match(tasksTemplate, /^## Requirement Slices$/m);
  assert.match(tasksTemplate, /independently green/);
  assert.match(tasksTemplate, /Focused Scenario-based proof expected/);
  assert.match(tasksTemplate, /- Binding constraints:/);
  assert.match(tasksTemplate, /- Consumes:/);
  assert.match(tasksTemplate, /- Produces:/);
  assert.match(tasksTemplate, /- Verification intent:/);
  assert.match(tasksTemplate, /- Manual acceptance:/);
  assert.match(tasksTemplate, /^## Implementation Ledger$/m);
  assert.match(tasksTemplate, /^\| Slice \| Repository \| Status \| Implementation Summary \/ Changed Surface \| Commit \| Updated \|$/m);
  assert.match(tasksTemplate, /full 40-character SHA/);
  assert.match(tasksTemplate, /^## Slice Gate Ledger$/m);
  assert.match(tasksTemplate, /^\| Slice \| Verification Candidate \| Implementation Review \| Epic Update \| Semantic Closure \| Evidence Closure \| Post-Epic Review \| Required Gaps \| Accepted Gaps \| Final Commit \| Updated \|$/m);
  assert.match(tasksTemplate, /Record accepted gaps only after the user explicitly accepts the named gap and include the acceptance date/);
  assert.match(planningSections, /## Technical Decision Handoffs/);
  assert.match(
    planningSections,
    /invoke `\/sdd-adr` and summarize its result here instead of duplicating the full option analysis/,
  );
  assert.match(planningSections, /`\/sdd-adr` result: complete \/ no-op \/ needs-user \/ blocked \/ routed/);
  assert.match(changeSkill, /Treat its public result explicitly/);
  assert.match(changeSkill, /`complete`:[\s\S]*`no-op`:[\s\S]*`needs-user` or `blocked`:[\s\S]*`routed`:/);
  assert.match(changeSkill, /## Result Contract/);
  assert.match(changeSkill, /Return exactly one composable status/);
  assert.match(changeSkill, /`complete`[\s\S]*`no-op`[\s\S]*`needs-user`[\s\S]*`blocked`[\s\S]*`routed`/);
  assert.match(changeSkill, /This is a terminal handoff/);
  assert.match(changeSkill, /return control before either workflow's mutation boundary/);
  assert.match(changeSkill, /do not automatically invoke Design, Apply, implementation, review, commit, release, or closeout/);
});

test("packaged planning workflows share one same-session minimum context contract", async () => {
  const [gather, explore, adr, change, doctrine] = await Promise.all([
    readPackageFile("skills", "sdd-gather-context", "SKILL.md"),
    readPackageFile("skills", "sdd-explore", "SKILL.md"),
    readPackageFile("skills", "sdd-adr", "SKILL.md"),
    readPackageFile("skills", "sdd-change", "SKILL.md"),
    readPackageFile("docs", "story-driven-development.md"),
  ]);

  assert.match(gather, /action: `exploration`, `adr`, or `change`/);
  assert.match(gather, /## Common Minimum/);
  assert.match(gather, /### `exploration`/);
  assert.match(gather, /### `adr`/);
  assert.match(gather, /### `change`/);
  assert.match(
    gather,
    /Reuse files already read in the current session when they are current and complete/,
  );
  assert.match(
    gather,
    /every applicable minimum above was read or explicitly marked missing or not applicable/,
  );
  assert.match(
    gather,
    /For an exploration with no SDD or repository owner, mark SDD-only entries `not applicable`/,
  );
  assert.match(gather, /Sufficiency: sufficient \/ insufficient for <focused question>/);
  assert.match(
    gather,
    /Stay read-only\. Create no artifact, mutate no lifecycle, make no product or architecture decision, and launch no subagent/,
  );
  assert.match(explore, /Invoke `\/sdd-gather-context` with action `exploration`/);
  assert.match(adr, /Invoke `\/sdd-gather-context` with action `adr`/);
  assert.match(change, /Invoke `\/sdd-gather-context` with action `change`/);
  assert.match(doctrine, /## Shared Context Gathering/);
  assert.match(
    doctrine,
    /invokes `\/sdd-gather-context` in the same session with an action and focused question/,
  );
});

test("packaged ADR preserves the decision boundary and returns composable results", async () => {
  const [adrSkill, readme, doctrine] = await Promise.all([
    readPackageFile("skills", "sdd-adr", "SKILL.md"),
    readPackageFile("README.md"),
    readPackageFile("docs", "story-driven-development.md"),
  ]);

  assert.match(adrSkill, /at least two meaningfully different approaches are viable/);
  assert.match(adrSkill, /surprising or difficult to reconstruct without the tradeoff context/);
  assert.match(adrSkill, /Do not invent alternatives merely to justify an ADR/);
  assert.match(adrSkill, /recommend one, and ask the user to settle the choice/);
  assert.match(adrSkill, /return `no-op` without creating a ceremonial ADR/);
  assert.match(adrSkill, /The caller owns any corresponding update to `change\.md`/);
  assert.match(adrSkill, /do not mutate those artifacts from this skill/);
  assert.match(adrSkill, /`complete`[\s\S]*`no-op`[\s\S]*`needs-user`[\s\S]*`blocked`[\s\S]*`routed`/);
  assert.match(adrSkill, /An ADR result is terminal for this invocation/);
  assert.match(adrSkill, /without implementing it or crossing into the caller's artifact boundary/);
  assert.doesNotMatch(adrSkill, /central design notes/);
  assert.doesNotMatch(adrSkill, /change\/design\/tasks files/);
  assert.doesNotMatch(adrSkill, /ensure the central `change\.md` and `tasks\.md` identify/);
  assert.match(readme, /Explicit `complete`, `no-op`, `needs-user`, `blocked`, or `routed` result/);
  assert.match(readme, /without editing caller-owned artifacts or implementing it/);
  assert.match(doctrine, /Return an explicit result and stop before caller-owned planning or implementation/);
});

test("packaged PRD stays directional without becoming an implementation gate", async () => {
  const [prd, review, doctrine, readme] = await Promise.all([
    readPackageFile("skills", "sdd-prd", "SKILL.md"),
    readPackageFile("skills", "sdd-review", "SKILL.md"),
    readPackageFile("docs", "story-driven-development.md"),
    readPackageFile("README.md"),
  ]);

  assert.match(prd, /starting point for product direction/);
  assert.match(prd, /not continuously synchronized with every implementation slice/);
  assert.match(prd, /ordinary PRD staleness, breadth, or different phasing is advisory and never by itself blocks a slice, Review verdict, integration, or closeout/);
  assert.match(prd, /continue from the accepted Change unless the user reopens its scope/);
  assert.match(review, /ordinary divergence is at most a `prd-revisit-suggested` advisory and never changes the verdict/);
  assert.match(review, /Ordinary PRD\/product-direction drift alone is advisory and cannot produce `changes-requested` or `blocked`/);
  assert.match(doctrine, /ordinary drift does not block implementation or Review/);
  assert.match(readme, /A PRD is a directional starting point to revisit deliberately, not a continuously synchronized implementation source or ordinary Apply\/Review gate/);
});

test("packaged Explore preserves generalized durable discussions and routes mature outcomes", async () => {
  const [exploreSkill, exploreAgent, readme, doctrine] = await Promise.all([
    readPackageFile("skills", "sdd-explore", "SKILL.md"),
    readPackageFile("skills", "sdd-explore", "agents", "openai.yaml"),
    readPackageFile("README.md"),
    readPackageFile("docs", "story-driven-development.md"),
  ]);

  assert.match(
    exploreSkill,
    /any substantial discussion the user wants to survive the chat session/,
  );
  assert.match(
    exploreSkill,
    /technical feasibility, marketing strategy, future capabilities/,
  );
  assert.match(exploreSkill, /## Choose The Record Destination/);
  assert.match(
    exploreSkill,
    /Established topic home:[\s\S]*Idea-owned default:[\s\S]*<idea>\/explorations\/yyyy-mm-dd-<topic>\.md[\s\S]*Workspace-owned default:[\s\S]*<workspace>\/\.sdd\/explorations\/yyyy-mm-dd-<topic>\.md/,
  );
  assert.match(
    exploreSkill,
    /New idea-owned records default to the plural `explorations\/` directory; do not bulk-move older records merely to normalize the folder name/,
  );
  assert.match(
    exploreSkill,
    /An exploration may remain useful indefinitely, end with no action, or produce one or more stronger artifacts/,
  );
  assert.match(exploreSkill, /A mature outcome is a route or recommended-next edge, not an automatic cascade/);
  assert.match(exploreSkill, /return `routed`, name the owning skill and context to pass, and stop before that skill's mutation boundary/);
  assert.match(exploreSkill, /`complete`[\s\S]*`no-op`[\s\S]*`needs-user`[\s\S]*`blocked`[\s\S]*`routed`/);
  assert.match(exploreSkill, /A route is a terminal handoff for this invocation/);
  assert.match(exploreSkill, /\| A bounded desired outcome, including a possible future feature \| `\/sdd-change` \|/);
  assert.match(exploreSkill, /\| A durable architecture,[^\n]+\| `\/sdd-adr` \|/);
  assert.match(
    exploreSkill,
    /The exploration remains source context; the new artifact owns its own decision or lifecycle truth/,
  );
  assert.doesNotMatch(exploreSkill, /<planning-root>\/exploration\/yyyy-mm-dd/);
  assert.match(exploreAgent, /Keep a durable discussion record/);
  assert.match(readme, /workspace-owned discussions without one idea default to `\.sdd\/explorations\/`/);
  assert.match(readme, /returns control before that workflow's mutation boundary/);
  assert.match(doctrine, /workspace `\.sdd\/explorations\/` when no one idea owns it/);
});

test("packaged workflows coordinate one central Change across every target repository", async () => {
  const skillNames = (await readdir(join(PACKAGE_ROOT, "skills"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("sdd-"))
    .map((entry) => entry.name)
    .sort();
  const skillSources = new Map(
    await Promise.all(
      skillNames.map(async (skill) => [skill, await readPackageFile("skills", skill, "SKILL.md")]),
    ),
  );
  const change = skillSources.get("sdd-change");
  const apply = skillSources.get("sdd-apply");
  const review = skillSources.get("sdd-review");
  const pr = skillSources.get("sdd-pr");
  const release = skillSources.get("sdd-release");
  const spaceStatus = skillSources.get("sdd-space-status");

  for (const [skill, source] of skillSources) {
    assert.doesNotMatch(
      source,
      /docs\/changes|planned-changes|sdd change promote/i,
      `${skill} must not restore a retired Change location or promotion command`,
    );
  }

  assert.match(
    change,
    /Every Change starts in the central workspace store:[\s\S]*Target repositories contain Epics, ADRs, code, and tests—not copies of the Change/,
  );
  assert.match(
    apply,
    /Use repository IDs from `change\.md`; never create or select a repository-local Change copy\.[\s\S]*sdd change transition <space-id> <change-id> --from planned --to in_progress/,
  );
  assert.match(
    review,
    /derive the complete target set from `change\.md` frontmatter[\s\S]*Transition or close the central Change only once/,
  );
  assert.match(
    pr,
    /derive the complete target set from central `change\.md` frontmatter[\s\S]*A clean or merged PR never makes the Change complete by itself/,
  );
  assert.match(
    release,
    /top-level `sdd status <space-id> --json` output[\s\S]*canonical `<workspace>\/\.sdd\/changes\/\*\*` locations/,
  );
  assert.match(
    spaceStatus,
    /top-level `activeChanges` and `recentChanges` as the unique canonical Change inventories[\s\S]*not copies or independent lifecycle owners/,
  );
});

test("requirement slices remain repository-qualified while review handoffs key repeated blocks by repository ID", async () => {
  const [tasks, review] = await Promise.all([
    readPackageFile("docs", "templates", "tasks.md"),
    readPackageFile("docs", "templates", "review.md"),
  ]);

  const slices = markdownSection(tasks, "Requirement Slices");
  assert.match(slices, /^### S1: <Behavioral outcome>$/m);
  assert.match(slices, /^- Repository: `<repository-id>`$/m);
  assert.match(slices, /^- Requirements:$/m);
  assert.match(slices, /^  - New: `EPIC-ID\/S3 R1` — <requirement summary>$/m);
  assert.match(slices, /Default to exactly one Requirement/);
  assert.match(slices, /Coupling justification/);
  assert.match(slices, /^- Story changes:$/m);
  assert.match(slices, /^  - Create: `EPIC-ID\/S3` — <Story title>$/m);
  assert.match(slices, /Every slice must be completable atomically in one fresh Apply session/);
  assert.match(slices, /^- Scenarios: `EPIC-ID\/S3 R1-S1`$/m);
  assert.match(
    markdownSection(review, "Repository Review Bundle: <repository-id>"),
    /^- Repository ID:$/m,
  );
  assert.match(review, /final Change-wide integration Review/);
});

test("packaged Epic Update reconciles only repository-owned truth for an exact candidate", async () => {
  const [epicUpdate, epicUpdateAgent, doctrine] = await Promise.all([
    readPackageFile("skills", "sdd-epic-update", "SKILL.md"),
    readPackageFile("skills", "sdd-epic-update", "agents", "openai.yaml"),
    readPackageFile("docs", "story-driven-development.md"),
  ]);

  assert.match(epicUpdate, /with or without an active Change[\s\S]*Apply history/);
  assert.match(epicUpdate, /public mutation capability may be invoked directly or composed by Apply/);
  assert.match(epicUpdate, /When Apply composes this capability, it supplies the selected slice, exact reviewed implementation envelope, Review result, and durable verification evidence through this same public contract/);
  assert.match(epicUpdate, /shared diff envelope per repository/);
  assert.match(epicUpdate, /sdd epic update-input <repository-path>/);
  assert.match(epicUpdate, /Derive affected behavior from actual implementation, not filenames alone/);
  assert.match(epicUpdate, /Mutate only repository-owned `epic\.md` files/);
  assert.match(epicUpdate, /Update `Implemented By` from inspected actual changed surfaces/);
  assert.match(epicUpdate, /Update `Verified By` only from durable evidence that directly proves/);
  assert.match(epicUpdate, /A `\/tmp` path, ephemeral browser profile, chat transcript, reviewer summary, screenshot hash without a retained artifact or reproducible procedure, or bare “local observation” phrase cannot be the sole passing evidence/);
  assert.match(epicUpdate, /Classify every behavior-bearing source\/test candidate in the supplied diff\/reverse-traceability inventory/);
  assert.match(epicUpdate, /prior Review verdict, caller statement that evidence is closed, or prompt claim that only manual acceptance remains is untrusted input/);
  assert.match(epicUpdate, /## Prove Semantic Closure/);
  assert.match(epicUpdate, /compare each affected Story's Story Index row, body-level Implementation and Verification states, `Implemented By`, `Implementation Gaps`, `Verified By`, and `Verification Gaps`/);
  assert.match(epicUpdate, /mapped behavior is still described in an index note or other current summary as not implemented or remaining work/);
  assert.match(epicUpdate, /classify the claimed boundary as backend\/data, rendered interaction, live multi-context\/realtime, provider\/production, or manual acceptance/);
  assert.match(epicUpdate, /a later backend query does not prove an active subscription, source inspection does not prove rendered interaction, a helper return value does not prove rendered field feedback or focus, and direct confirmed\/unconfirmed backend calls do not prove a user's confirmation\/cancellation interaction/);
  assert.match(epicUpdate, /Require exact Scenario-set equality/);
  assert.match(epicUpdate, /named required technical gap is honest but still prevents a completion-consuming `ready` result/);
  assert.match(epicUpdate, /Report `Semantic closure: pass` and `Evidence closure: pass`/);
  assert.match(epicUpdate, /scoped deterministic validation pass is necessary but cannot substitute/);
  assert.match(epicUpdate, /second invocation should normally produce no Epic\/index changes and return `no-op`/);
  assert.match(epicUpdate, /Do not:[\s\S]*review implementation quality[\s\S]*modify application code[\s\S]*Change lifecycle state[\s\S]*write changelog[\s\S]*commit/);
  assert.match(epicUpdate, /`complete`[\s\S]*`no-op`[\s\S]*`needs-user`[\s\S]*`blocked`[\s\S]*`routed`/);
  assert.match(epicUpdateAgent, /public directly callable or Apply-composed contract/);
  assert.match(epicUpdateAgent, /report semantic closure across each affected Story's index, body states, maps, and gaps plus a complete Scenario Evidence Closure table/);
  assert.match(doctrine, /## Candidate-Bound Epic Reconciliation/);
  assert.match(doctrine, /`\/sdd-epic-update`/);
});

test("packaged Changelog writes only one reviewed candidate's native release entry", async () => {
  const [changelog, changelogAgent, doctrine, release, review] = await Promise.all([
    readPackageFile("skills", "sdd-changelog", "SKILL.md"),
    readPackageFile("skills", "sdd-changelog", "agents", "openai.yaml"),
    readPackageFile("docs", "story-driven-development.md"),
    readPackageFile("skills", "sdd-release", "SKILL.md"),
    readPackageFile("skills", "sdd-review", "SKILL.md"),
  ]);

  assert.match(changelog, /Apply session[\s\S]*is optional[\s\S]*never fabricate Apply history/);
  assert.match(changelog, /sdd candidate resolve <repository-path>/);
  assert.match(changelog, /Require current review evidence/);
  assert.match(changelog, /require a current `\/sdd-epic-update` result/);
  assert.match(changelog, /`user-visible`[\s\S]*`operator-relevant`[\s\S]*`internal-only`[\s\S]*`speculative-or-unverified`/);
  assert.match(changelog, /Return `no-op` when/);
  assert.match(changelog, /For Keep a Changelog, edit only the appropriate `Unreleased` category/);
  assert.match(changelog, /implementation-input projection remains unchanged/);
  assert.match(changelog, /second invocation should normally produce no release-record changes and return `no-op`/);
  assert.match(changelog, /Do not:[\s\S]*modify application code[\s\S]*choose or write a release version[\s\S]*stage, commit, push/);
  assert.match(changelog, /`complete`[\s\S]*`no-op`[\s\S]*`needs-user`[\s\S]*`blocked`[\s\S]*`routed`/);
  assert.match(changelogAgent, /one reviewed candidate's release entry/);
  assert.match(doctrine, /## Candidate-Bound Changelog Entries/);
  assert.match(doctrine, /`\/sdd-changelog`/);
  assert.match(release, /Route missing or stale per-change entries to `\/sdd-changelog`/);
  assert.match(review, /missing not-yet-authored entry alone does not make otherwise clean implementation `changes-requested`/);
});

test("packaged Apply delivers one candidate-bound slice with optional isolated delegation", async () => {
  const [applySkill, applyAgent, doctrine, readme] = await Promise.all([
    readPackageFile("skills", "sdd-apply", "SKILL.md"),
    readPackageFile("skills", "sdd-apply", "agents", "openai.yaml"),
    readPackageFile("docs", "story-driven-development.md"),
    readPackageFile("README.md"),
  ]);

  assert.match(applySkill, /Default mode applies exactly one slice\./);
  assert.match(applySkill, /A bare `S#` argument is a slice ID/);
  assert.match(applySkill, /If the slice declares current `Closure receipt: required`, require its durable slice Review and minimal v2 receipt/);
  assert.match(applySkill, /Existing completed slices without either marker are grandfathered/);
  assert.match(applySkill, /Return `no-op` only when the applicable state is current/);
  assert.match(applySkill, /A nominally `done` slice with missing or stale composed gates, missing explicit semantic\/evidence closure results, or no recorded slice commit is incomplete state, not a no-op/);
  assert.match(doctrine, /A nominally `done` slice with either closure result absent is stale and resumes at that gate rather than returning `no-op`/);
  assert.match(applySkill, /When no slice is supplied, choose the next ready slice/);
  assert.match(applySkill, /an `in progress` slice named by `Resume Here`[\s\S]*earliest nominally `done` slice[\s\S]*first `ready` slice whose dependencies are fully complete and committed/);
  assert.match(applySkill, /## Build The Behavioral Brief/);
  assert.match(applySkill, /Binding constraints:[\s\S]*Consumes:[\s\S]*Produces:[\s\S]*Verification intent:[\s\S]*Manual acceptance:/);
  assert.match(applySkill, /This brief states \*\*what must become true\*\*/);
  assert.match(applySkill, /Do not add predicted files, modules, classes, functions, implementation steps, test architecture, framework techniques, commit plans, or specialist workflows/);
  assert.match(applySkill, /read all applicable `AGENTS\.md` files from the workspace root through the selected repository/);
  assert.match(applySkill, /Do not scan for or select specialist skills merely because they exist/);
  assert.match(applySkill, /## Required Trigger Checks/);
  assert.match(applySkill, /Active bug, failing test, or regression:[\s\S]*reproducible root cause/);
  assert.match(applySkill, /preserve RED\/GREEN evidence where practical/);
  assert.match(applySkill, /expand–migrate–contract slices/);
  assert.match(applySkill, /Run `git branch --show-current`, `git rev-parse HEAD`, and `git status --short`/);
  assert.match(applySkill, /Record one exact pre-slice diff envelope per repository the slice will mutate/);
  assert.match(applySkill, /warn the user with the repository ID, current branch, required branch or branch class, and guidance path/);
  assert.match(applySkill, /Return `needs-user` before implementation only when policy disallows work on the current branch/);
  assert.match(applySkill, /Do not create, switch, reset, merge, or rebase branches automatically/);
  assert.match(applySkill, /working-tree candidate[\s\S]*HEAD plus the staged, unstaged, and relevant untracked snapshot/);
  assert.match(applySkill, /latest verification, review, Epic-update, changelog, and acceptance candidates/);
  assert.match(applySkill, /Validate the stored Change ID, slice ID, each repository envelope and baseline, current candidates, phase/);
  assert.match(applySkill, /## Choose Execution Strategy/);
  assert.match(applySkill, /### Inline[\s\S]*### Delegated/);
  assert.match(applySkill, /Use at most one fresh-context implementer/);
  assert.match(applySkill, /dedicated isolated workspace with one-writer ownership/);
  assert.match(applySkill, /when neither authorizes creating isolation, ask before creating it/);
  assert.match(applySkill, /never remove them without explicit authorization/);
  assert.match(applySkill, /Do not inherit the full conversation, permit recursive delegation, or run parallel writers against shared files or state/);
  assert.match(applySkill, /Use one writer per working tree/);
  assert.match(applySkill, /`complete`, `complete-with-concerns`, `needs-context`, or `blocked`/);
  assert.match(applySkill, /Independently inspect the diff and evidence; never treat the worker report as proof/);
  assert.match(applySkill, /Run fresh, proportional verification for the current candidate/);
  assert.match(applySkill, /For every affected Scenario, classify the claimed boundary as `backend\/data`, `rendered interaction`, `live multi-context\/realtime`, `provider\/production`, or `manual acceptance`/);
  assert.match(applySkill, /A `\/tmp` path, chat transcript, reviewer summary, or bare phrase such as “local observation” is supporting context only and cannot be the sole completion evidence/);
  assert.match(applySkill, /Present prior verdicts, finding dispositions, screenshots, and runtime observations as untrusted claims to falsify/);
  assert.match(applySkill, /Gate Execution Manifest naming each applicable gate, method or command, candidate, result, and durable proof reference/);
  assert.match(applySkill, /diff-scoped reverse-traceability inventory actually ran/);
  assert.match(applySkill, /every triggered visual-matrix state is exercised or recorded as a gap/);
  assert.match(applySkill, /Any candidate change makes affected verification stale/);
  assert.match(applySkill, /Manual acceptance remains separate/);
  assert.match(applySkill, /Keep exactly one row per slice/);
  assert.match(applySkill, /Choose no additional slice during this invocation/);
  assert.match(applySkill, /## Compose Slice Review/);
  assert.match(applySkill, /invoke `\/sdd-review` through its public candidate-bound contract in \*\*implementation-phase slice-checkpoint mode\*\*/);
  assert.match(applySkill, /Direct `\/sdd-review` invocation remains valid with or without Apply/);
  assert.match(applySkill, /admit each required finding only when it has explicit accepted-contract, material-safety, project-policy, false-closure, or deterministic-gate grounds/);
  assert.match(applySkill, /remediate the complete safe set in one consolidated batch/);
  assert.match(applySkill, /one fresh-context comprehensive implementation-phase slice Review across the complete Scenario list and all applicable gates before Epic Update/);
  assert.match(applySkill, /If that final Review finds another pre-existing issue, return `needs-user`/);
  assert.match(applySkill, /one narrow correction only when the finding is demonstrably a regression introduced by the remediation batch/);
  assert.match(applySkill, /never describe a dirty working-tree candidate as clean merely because its baseline was clean/);
  assert.match(applySkill, /unresolved or previously reported finding IDs as claims—not prior `ready` conclusions/);
  assert.match(applySkill, /## Compose Epic Update/);
  assert.match(applySkill, /invoke `\/sdd-epic-update` through its public candidate-bound contract/);
  assert.match(applySkill, /Epic Update remains independently callable with or without Apply/);
  assert.match(applySkill, /accept `complete` or evidence-based `no-op` only when Epic Update reports both `Semantic closure: pass` and `Evidence closure: pass`/);
  assert.match(applySkill, /one Scenario Evidence Closure row for every affected Scenario/);
  assert.match(applySkill, /an unresolved required technical gap blocks `ready` and slice completion/);
  assert.match(applySkill, /record both the reviewed implementation-input watermark and post-Epic-update repository watermark plus the semantic-closure result/);
  assert.match(applySkill, /when Epic Update returns `complete`, invoke `\/sdd-review --slice-checkpoint --phase post-epic`/);
  assert.match(applySkill, /require the reviewer to enumerate every affected Scenario, independently apply `EPIC-CLOSURE`[\s\S]*apply `EVIDENCE-CLOSURE` row by row/);
  assert.match(applySkill, /This is a fresh comprehensive closure review, not a scoped finding-disposition pass/);
  assert.match(applySkill, /Require exact Scenario-set equality, matching claimed\/proven boundaries, durable reproducible evidence that survives the session/);
  assert.match(applySkill, /## Commit The Completed Slice/);
  assert.match(applySkill, /create one normal local commit in each repository affected by the selected slice/);
  assert.match(applySkill, /part of the workflow authorization granted by invoking `\/sdd-apply`/);
  assert.match(applySkill, /Stage only those attributable paths\. Never use broad staging when unrelated changes exist/);
  assert.match(applySkill, /Record the staged tree with `git write-tree`/);
  assert.match(applySkill, /commit's tree from `git rev-parse <sha>\^\{tree\}` must equal the staged tree/);
  assert.match(applySkill, /final candidate-bound Review at `<change-path>\/slice-reviews\/<slice-id>\.md`/);
  assert.match(applySkill, /generate `<change-path>\/slice-closures\/<slice-id>\.yaml`/);
  assert.match(applySkill, /never copies test details, boundary analysis, visual observations, commands, changed paths, or Review reasoning/);
  assert.match(applySkill, /validate Review identity and raw-file digest, the exact gate\/Scenario\/visual sets, unique Review anchors, accepted-gap reconciliation, Epic agreement, final-commit reachability, and reviewed-tree\/final-tree equality/);
  assert.match(applySkill, /Update `Resume Here`, the selected Implementation Ledger row, and the selected Slice Gate Ledger row with that SHA/);
  assert.match(applySkill, /Never claim `complete` from an uncommitted working-tree slice/);
  assert.match(applySkill, /## Terminal Handoffs/);
  assert.match(applySkill, /stops after one reviewed, Epic-reconciled, committed slice pipeline/);
  assert.match(applySkill, /final Change-wide integration Review/);
  assert.match(applySkill, /## Result Contract/);
  assert.match(applySkill, /Return exactly one composable status/);
  assert.match(applySkill, /`complete`[\s\S]*`no-op`[\s\S]*`needs-user`[\s\S]*`blocked`[\s\S]*`routed`/);
  assert.match(applySkill, /artifacts read and written/);
  assert.match(applySkill, /one diff envelope per affected repository/);
  assert.match(applyAgent, /exactly one next-ready or explicitly named atomic Requirement slice/);
  assert.match(applyAgent, /state a transient Scenario proof sketch/);
  assert.match(applyAgent, /one consolidated remediation batch/);
  assert.match(applyAgent, /one fresh final candidate-bound Review/);
  assert.match(applyAgent, /new pre-existing issue after remediation returns needs-user/);
  assert.match(applyAgent, /persist slice-reviews\/S#\.md/);
  assert.match(applyAgent, /minimal sdd-slice-closure-v2 receipt with the Review digest and Git tree seal/);
  assert.match(doctrine, /one fresh-context implementer/);
  assert.match(doctrine, /requires fresh candidate-bound verification/);
  assert.match(doctrine, /structured Requirement-slice IDs, fields, references, dependency graphs, ledger alignment, and Resume checkpoint shape/);
  assert.match(doctrine, /creates one normal local commit per affected repository/);
  assert.match(doctrine, /records each full commit SHA in the Implementation Ledger/);
  assert.match(readme, /implements inline or with one optional isolated worker/);
  assert.match(readme, /transient proof sketch/);
  assert.match(readme, /one consolidated remediation batch/);
  assert.match(readme, /final Review writes `slice-reviews\/<slice-id>\.md`/);
  assert.match(readme, /minimal `sdd-slice-closure-v2` receipt/);

  assert.doesNotMatch(applySkill, /Persistence invariant|Commit cadence invariant|Pattern Parity Matrix|Boundary Contract Matrix|Stateful Transition Matrix|Verification Ledger|--review-only|--no-delegate|--no-commit|transition <space-id> <change-id> --from in_progress --to in_review|sdd change close/);
});

test("packaged Review stays directly callable and supports read-only slice composition", async () => {
  const [reviewSkill, reviewAgent, reviewSubagentPrompt] = await Promise.all([
    readPackageFile("skills", "sdd-review", "SKILL.md"),
    readPackageFile("skills", "sdd-review", "agents", "openai.yaml"),
    readPackageFile("skills", "sdd-review", "assets", "subagent-pr-review-prompt.md"),
  ]);
  const modes = markdownSection(reviewSkill, "Inputs And Modes");

  assert.match(reviewSkill, /same public capability supports a slice checkpoint composed by `\/sdd-apply` and a directly invoked final Change-wide local-PR gate/);
  assert.match(reviewSkill, /A Change is optional for direct candidate review; never fabricate Change, slice, or Apply history/);
  assert.match(modes, /`--candidate-review <repository-path> --baseline <commit-ish>/);
  assert.match(modes, /Without accepted behavior inputs, mark Spec Adherence `cannot-verify` rather than inventing a Change/);
  assert.match(modes, /`--slice-checkpoint --slice S# --baseline <commit-ish>[\s\S]*--phase implementation\|post-epic/);
  assert.match(modes, /Scope Spec Adherence to that slice's Requirements, Scenarios, constraints, and interfaces/);
  assert.match(modes, /report stale or missing Epic mappings as `epic-update-required` rather than `changes-requested`/);
  assert.match(modes, /In `post-epic` phase, independently require semantic and evidence closure for every affected Story and Scenario/);
  assert.match(modes, /Write or replace the candidate-bound result at `slice-reviews\/<slice-id>\.md`/);
  assert.match(modes, /only central artifact mutation authorized by slice-checkpoint mode/);
  assert.match(reviewSkill, /explicitly apply the `EPIC-CLOSURE` comparison across each affected Story's index, body states, maps, and gaps/);
  assert.match(reviewSkill, /a deterministic validation pass alone cannot satisfy this gate/);
  assert.match(reviewSkill, /otherwise return `EVIDENCE-CLOSURE` and retain a verification gap/);
  assert.match(reviewSkill, /complete Scenario Evidence Closure table with exact Scenario-set equality/);
  assert.match(reviewSkill, /an unresolved required technical gap blocks `ready`/);
  assert.match(reviewSkill, /Never transition lifecycle state in `--slice-checkpoint` mode/);
  assert.match(reviewSkill, /In implementation-phase `--slice-checkpoint` only, stale affected Epic mappings[\s\S]*produce `ready` plus `epic-update-required`/);
  assert.match(reviewAgent, /public candidate-bound contract/);
  assert.match(reviewAgent, /active --slice-checkpoint, independently derive the Requirement\/Scenario expectations/);
  assert.match(reviewAgent, /Persist final ready slice Reviews at slice-reviews\/S#\.md/);
  assert.match(reviewAgent, /minimal sdd-slice-closure-v2 receipt/);
  assert.match(reviewSubagentPrompt, /treat every affected Scenario—not only new, high-risk, recently repaired, or previously disputed completion claims/);
  assert.match(reviewSubagentPrompt, /Prior verdicts, finding dispositions, and evidence claims to treat as untrusted/);
  assert.match(reviewSubagentPrompt, /Falsify the supplied claims from current source and proof/);
  assert.match(reviewSubagentPrompt, /Gate Execution Manifest with exactly one row per canonical gate/);
  assert.match(reviewSubagentPrompt, /complete Scenario Evidence Closure table with Scenario, claimed boundary, cited proof, proven boundary, evidence type, durability or reproduction reference, result/);
  assert.match(reviewSkill, /Technical proof must remain independently inspectable or reproducible after the current session/);
  assert.match(reviewSkill, /run the packaged diff-scoped orphan audit with `--changed-from`/);
  assert.match(reviewSkill, /explicit accounting table with one row per triggered viewport\/state\/interaction/);
  assert.match(reviewSkill, /Exact Scenario-set equality is required/);
  assert.match(reviewSkill, /Implementation Quality and Spec Adherence are both `pass`/);
  assert.match(reviewSkill, /Do not classify required rendered interaction, live multi-context\/realtime/);
});

test("packaged Review completes every applicable gate after an early blocking finding", async () => {
  const reviewSkill = await readPackageFile("skills", "sdd-review", "SKILL.md");

  assertContractClauses("Review discovery contract", reviewSkill, [
    [
      "complete the applicable discovery surface before a verdict or ordinary remediation",
      /Full-review invariant: complete the entire applicable discovery surface before issuing a verdict or beginning ordinary remediation\./,
    ],
    [
      "retain blocking and required findings without skipping later gates",
      /A `BLOCKING` or `REQUIRED` finding in one gate is evidence for the final verdict, not permission to skip later gates\./,
    ],
    [
      "continue independent inspection even when integration is already blocked",
      /Continue all independent read-only inspection, verification, and delegated passes even when integration is already known to be blocked\./,
    ],
    [
      "reserve an early halt for unsafe or impossible inspection",
      /Halt the whole discovery wave early only when further inspection itself is unsafe or impossible/,
    ],
  ]);

  const search = markdownSection(reviewSkill, "Systematic Review Search");
  assertContractClauses("Systematic review search", search, [
    [
      "generate candidates through distinct passes",
      /Default and deep review must generate candidates through distinct passes instead of relying on one salience-driven reading of the diff\./,
    ],
    [
      "cover intent, the complete diff, propagated contracts, tools, risks, and blind spots",
      /\*\*Intent and history\*\*: .* \*\*Complete diff coverage\*\*: .* \*\*Dependency and contract propagation\*\*: .* \*\*Deterministic tool pass\*\*: .* \*\*Risk-shaped reasoning passes\*\*: .* \*\*Blind-spot accounting\*\*:/,
    ],
    [
      "retain the candidate union until the complete wave is validated",
      /Keep the union of candidates until the discovery wave is complete\. Validate each candidate against the actual source-vs-target diff, concrete code path, executable reproduction, deterministic tool result, or artifact contract before promoting it to a finding\./,
    ],
  ]);

  const gates = markdownSection(reviewSkill, "Review Gates");
  assertContractClauses("Review gates", gates, [
    [
      "record an explicit result for every applicable gate",
      /Run every gate that applies and record `pass`, `findings`, `blocked`, or `not-applicable`\./,
    ],
    [
      "forbid short-circuiting after an earlier finding",
      /Do not short-circuit this list because an earlier gate already guarantees `changes-requested` or `blocked`; complete later independent gates so the user receives one comprehensive finding set\./,
    ],
    [
      "require a complete scorecard before finalization",
      /Before finalizing, confirm that every gate has an explicit manifest row and that no delegated or main-thread review pass remains uncollected\./,
    ],
  ]);

  const canonicalReview = await readPackageFile("docs", "templates", "review.md");
  const packagedReview = await readPackageFile(
    "skills",
    "sdd-review",
    "assets",
    "review-template.md",
  );
  assert.equal(packagedReview, canonicalReview, "the packaged review record must mirror the canonical template");
  const manifest = markdownSection(canonicalReview, "Gate Execution Manifest");
  for (const requiredGate of [
    "artifact-truth",
    "canonical-map-authority",
    "source-vs-target",
    "pattern-conformance",
    "boundary-contracts",
    "reverse-traceability",
    "verification",
    "evidence-falsification",
    "risk-shaped-evidence",
    "security-data-safety",
    "rendered-ui",
    "manual-acceptance",
    "supporting-truth",
    "integration-readiness",
  ]) {
    assert.match(manifest, new RegExp(`^\\| ${requiredGate} \\|`, "m"));
  }
});

test("packaged Review resumes yielded commands and enforces one bounded remediation batch", async () => {
  const reviewSkill = await readPackageFile("skills", "sdd-review", "SKILL.md");

  assertContractClauses("Review execution continuity", reviewSkill, [
    [
      "treat running, yielded, and just-completed commands as pending review work",
      /Execution-continuity invariant: a running, yielded, or just-completed command is pending review work, not a handoff boundary\./,
    ],
    [
      "resume long-running sessions with timely progress until completion",
      /Resume or poll long-running command sessions until they complete, provide a concise progress update at least every 60 seconds while work continues, and then immediately continue the next unfinished gate\./,
    ],
    [
      "continue after a status question unless the review is cancelled or replaced",
      /If the user asks for status while the review is active, answer the status question and continue unless the user cancels or replaces the review\./,
    ],
    [
      "withhold the final response until the scorecard and verdict are complete",
      /Do not send the final response until the complete gate scorecard and consolidated verdict are ready or a genuine Stop Condition makes further safe inspection impossible\./,
    ],
  ]);

  const remediation = markdownSection(reviewSkill, "Remediation");
  assertContractClauses("Review bounded remediation", remediation, [
    [
      "perform one consolidated remediation batch",
      /one consolidated safe-remediation batch after the complete discovery wave, followed by one fresh final Review/,
    ],
    [
      "stop on another pre-existing issue",
      /If that final Review finds a new pre-existing issue, return `needs-user`/,
    ],
    [
      "allow only a remediation-introduced regression correction",
      /one narrow correction and focused rerun only when the final finding is demonstrably a regression introduced by the remediation batch/,
    ],
  ]);
  assert.doesNotMatch(reviewSkill, /--until-ready|--max-iterations/);

  const finalResponse = markdownSection(reviewSkill, "Final Response");
  assertContractClauses("Review final response", finalResponse, [
    [
      "apply one complete report shape to all review modes",
      /Final-report invariant: default, `--deep`, `--no-fix`, slice checkpoint, seal audit, and explicit deep re-review all use the applicable complete report structure below\./,
    ],
    [
      "forbid a short narrative from replacing the full result",
      /Never replace it with a short narrative such as “review is ready,” a list of resolved themes, test totals, or key commits\./,
    ],
    [
      "require the final response to report every residual finding",
      /last response must independently contain the complete review result and every residual finding/,
    ],
    [
      "include every gate and the final reviewed watermark",
      /complete Gate Execution Manifest covering exactly the 14 canonical gate IDs[\s\S]*final post-remediation reviewed source commit per repository as the review watermarks/,
    ],
  ]);
  assert.match(finalResponse, /Implementation Quality: pass\|findings\|cannot-verify/);
  assert.match(finalResponse, /Spec Adherence: pass\|findings\|cannot-verify/);
});

test("packaged Design composes through planned and candidate-bound terminal handoffs", async () => {
  const designSkill = await readPackageFile("skills", "sdd-design", "SKILL.md");

  assertContractClauses("Design composition", designSkill, [
    [
      "require and preserve planned status for initial design",
      /`--plan` requires and preserves central `planned` status/,
    ],
    [
      "transition review only immediately before confirmed edits",
      /After feedback is confirmed as an experience revision within accepted behavior and the user confirms the revised direction,[\s\S]*immediately before editing central Change artifacts/,
    ],
    [
      "route proposed work back to Change",
      /A `proposed` Change returns `routed` to `\/sdd-change`/,
    ],
    [
      "resolve exact revision candidates",
      /sdd candidate resolve <repository-path> --baseline <commit-ish> --candidate <working-tree-or-commit-ish> --workspace <workspace-root> --json/,
    ],
    [
      "never guess a revision baseline",
      /Take the baseline from explicit input, the Apply checkpoint, or the Review result; never guess it/,
    ],
    [
      "keep prototypes optional",
      /If no design tooling is installed, produce a clear text, ASCII, or Markdown experience contract and continue\. Missing optional tools are not blockers/,
    ],
    [
      "preserve the fixed checkpoint and downstream freshness",
      /fixed `Resume Here` phase, current slice, repository envelopes, downstream candidate freshness, acceptance state, and open finding or blocker/,
    ],
    [
      "reopen every affected slice while preserving dependency selection",
      /When repository implementation must change, reopen every affected `done` slice coherently:[\s\S]*Do not leave affected downstream slices `done`, because Apply would skip required revision work/,
    ],
    [
      "refresh envelopes after repository-local design-doc mutation",
      /After any authorized repository-local design-document mutation in `--revise`, rerun `sdd candidate resolve`[\s\S]*recalculate downstream freshness from the new watermark/,
    ],
    [
      "define terminal wait and route behavior for every result",
      /Choose the terminal handoff or wait condition from the result:[\s\S]*`needs-user`: invoke no downstream workflow[\s\S]*`blocked`: invoke no downstream workflow[\s\S]*`routed`: name the one owning workflow/,
    ],
    [
      "return the shared composable result vocabulary",
      /Return exactly one composable status:[\s\S]*`complete`[\s\S]*`no-op`[\s\S]*`needs-user`[\s\S]*`blocked`[\s\S]*`routed`/,
    ],
    [
      "stop before downstream workflow mutations",
      /A result is terminal for this invocation\. Do not automatically invoke Apply, Review, Epic Update, Changelog, implementation, commits, PRs, release, deployment, or closeout/,
    ],
  ]);

  assert.doesNotMatch(designSkill, /--replan/);
});

test("packaged UI workflows reject source-only confidence without rendered current-source evidence", async () => {
  const designSkill = await readPackageFile("skills", "sdd-design", "SKILL.md");
  const designMatrix = markdownSection(designSkill, "6. Define The Visual Verification Matrix");
  assertContractClauses("Design visual matrix", designMatrix, [
    [
      "define a reproducible rendered matrix for every UI-bearing Change",
      /For every UI-bearing Change, define the smallest representative matrix that lets implementation and review detect obvious rendered regressions\./,
    ],
    [
      "cover affected entry points, representative viewports, states, interactions, observations, and tooling",
      /affected surface and route, fixture, preview, or setup entry point .* representative desktop and mobile viewports .* applicable default, loading, empty, error, populated, long-content, focus, selected, disabled, permission, and recovery states .* changed interactions to exercise .* expected rendered behavior and important accessibility observations .* preferred project-owned browser, screenshot, preview, or fixture command, plus the best portable fallback/,
    ],
    [
      "keep the matrix as a plan rather than predeclared proof",
      /The matrix is an implementation and review plan, not proof that rendering already passes\./,
    ],
  ]);

  const applySkill = await readPackageFile("skills", "sdd-apply", "SKILL.md");
  assert.match(applySkill, /Treat that guidance as the authority for:[\s\S]*test or verification method/);
  assert.doesNotMatch(applySkill, /rendered UI verification is required|Visual Verification Matrix/);

  const reviewSkill = await readPackageFile("skills", "sdd-review", "SKILL.md");
  const reviewGates = markdownSection(reviewSkill, "Review Gates");
  assertContractClauses("Independent rendered review", reviewGates, [
    [
      "independently reproduce and inspect the current UI",
      /\*\*Rendered UI verification\*\*: for every UI-bearing change, independently render current source, open the affected surfaces, exercise changed interactions, directly inspect screenshots or rendered results, and inspect relevant console and network failures\./,
    ],
    [
      "reject non-rendered and apply-only evidence",
      /A green build, passing non-visual tests, apply-side screenshots alone, happy-path fixtures that omit a triggered state, temporary-only images, or generated-but-uninspected images cannot pass this gate\./,
    ],
    [
      "block an unavailable required surface unless the gap is accepted",
      /If no available path can render or durably describe a required surface, mark the gate `blocked` unless the user explicitly accepts the gap\./,
    ],
    [
      "keep owner acceptance distinct from reviewer rendering",
      /Owner manual acceptance is distinct from the reviewer's rendered UI verification and does not substitute for it\./,
    ],
  ]);

  const canonicalTasks = await readPackageFile("docs", "templates", "tasks.md");
  const packagedTasks = await readPackageFile(
    "skills",
    "sdd-change",
    "assets",
    "tasks-template.md",
  );
  assert.equal(packagedTasks, canonicalTasks, "the Change workflow must use the canonical tasks template");
  const canonicalClosure = await readPackageFile("docs", "templates", "slice-closure.yaml");
  const packagedClosure = await readPackageFile("skills", "sdd-apply", "assets", "slice-closure-template.yaml");
  assert.equal(packagedClosure, canonicalClosure, "Apply must use the canonical slice closure template");
  assert.match(canonicalTasks, /- Visual requirements:/);
  assert.match(canonicalTasks, /slice-closures\/<slice-id>\.yaml/);
  assert.doesNotMatch(canonicalTasks, /^## Visual Verification Matrix$/m);
  assert.match(
    canonicalTasks,
    /Add only the conditional coordination or evidence sections that this Change actually needs during delivery or review\./,
  );
});

test("packaged evidence closure keeps high-risk Scenarios unverified when only an aggregate gate passes", async () => {
  const applySkill = await readPackageFile("skills", "sdd-apply", "SKILL.md");
  assert.match(applySkill, /Treat that guidance as the authority for:[\s\S]*test or verification method/);
  assert.doesNotMatch(applySkill, /Evidence Claim Integrity|Keep three proof layers distinct|Verification Scope And Candidate Gates/);

  const reviewSkill = await readPackageFile("skills", "sdd-review", "SKILL.md");
  const scope = markdownSection(reviewSkill, "Resolve Verification Scope");
  assertContractClauses("Review verification scope", scope, [
    [
      "keep focused, aggregate, and integration proof distinct",
      /Keep focused behavior proof, aggregate candidate proof, and integration-candidate proof distinct\./,
    ],
    [
      "prevent broad gates from replacing exact Scenario evidence",
      /Focused tests establish individual Requirements and Scenarios; broad gates support them but do not replace their exact evidence\./,
    ],
  ]);

  const reviewGates = markdownSection(reviewSkill, "Review Gates");
  assertContractClauses("Review evidence falsification", reviewGates, [
    [
      "require scenario-mapped evidence in addition to aggregate candidate checks",
      /\*\*Verification\*\*: scenario-mapped focused evidence exists for every affected Scenario, broad gates are not substituted for behavior proof, production\/mock boundaries are honest, the Verification Scope Decision is explicit, and required aggregate candidate checks pass freshly on the exact reviewed commit or have explicit blocking gaps\./,
    ],
    [
      "open high-risk proof and reject unsupported aggregation or boundary substitution",
      /\*\*Evidence falsification\*\*: for every affected Scenario—not only new, high-risk, recently repaired, or previously disputed claims—and every `Verified By`, E2E\/security\/recovery\/production-path claim, open the cited proof and confirm its exact test title or stable named anchor, important assertion\/observation, discovery by the command that passed, production call-site use when a helper or formatter is cited, and durable reproduction reference for interactive\/runtime evidence\.[\s\S]*Evidence must exercise the same boundary the Scenario claims and survive the current session;/,
    ],
  ]);

  const canonicalTasks = await readPackageFile("docs", "templates", "tasks.md");
  assert.doesNotMatch(canonicalTasks, /^## Verification Scope Decision$/m);
  assert.match(
    canonicalTasks,
    /Durable implementation and verification evidence belongs in the affected Stories' `Implemented By` and `Verified By` maps; candidate-bound slice reasoning belongs in `slice-reviews\/<slice-id>\.md`; final Change-wide integration Review remains `review\.md`\./,
  );
});

test("packaged Interactive workflow tracks one lightweight progressive Change", async () => {
  const interactiveSkill = await readPackageFile("skills", "sdd-interactive", "SKILL.md");

  assert.match(interactiveSkill, /sdd change create <space-id> <slug>/);
  assert.match(interactiveSkill, /`change\.md`: record why the session exists[\s\S]*high-level technical approach/);
  assert.match(interactiveSkill, /Status, Space, and repositories remain in `change\.md`/);
  assert.doesNotMatch(interactiveSkill, /<yyyy-mm-dd-change-name>\/design\.md/);
  assert.match(interactiveSkill, /sdd change transition <space-id> <change-id> --from proposed --to planned/);
  assert.match(interactiveSkill, /compose exactly one bounded Apply-style slice/);
  assert.match(interactiveSkill, /including its composed slice Review and Epic Update gates/);
  assert.match(interactiveSkill, /For `cosmetic` changes, record one narrow presentation Requirement slice and execute the public `\/sdd-apply` contract/);
  assert.match(interactiveSkill, /Recommend final `\/sdd-review` when the lightweight Change is implementation-complete/);
  assert.match(interactiveSkill, /Do not commit, close, merge, release, or deploy from this wrapper/);
  assert.doesNotMatch(interactiveSkill, /proposal\.md|--brief|\/sdd-change --plan|--replan/);
});
