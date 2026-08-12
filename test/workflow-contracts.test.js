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
  assert.doesNotMatch(changeSkill, /--brief|--plan|--replan|proposal\.md|change-briefs/);
  assert.match(changeTemplate, /status: proposed/);
  assert.match(changeTemplate, /space: <space-id>/);
  assert.match(changeTemplate, /repositories: \[\]/);
  assert.match(planningSections, /## Technical Decision Handoffs/);
  assert.match(
    planningSections,
    /invoke `\/sdd-adr` and summarize its result here instead of duplicating the full option analysis/,
  );
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
    /Established topic home:[\s\S]*Idea-owned default:[\s\S]*<idea>\/explorations\/yyyy-mm-dd-<topic>\.md/,
  );
  assert.match(
    exploreSkill,
    /New idea-owned records default to the plural `explorations\/` directory; do not bulk-move older records merely to normalize the folder name/,
  );
  assert.match(
    exploreSkill,
    /An exploration may remain useful indefinitely, end with no action, or produce one or more stronger artifacts/,
  );
  assert.match(exploreSkill, /\| A bounded desired outcome, including a possible future feature \| `\/sdd-change` \|/);
  assert.match(exploreSkill, /\| A durable architecture,[^\n]+\| `\/sdd-adr` \|/);
  assert.match(
    exploreSkill,
    /The exploration remains source context; the new artifact owns its own decision or lifecycle truth/,
  );
  assert.doesNotMatch(exploreSkill, /<planning-root>\/exploration\/yyyy-mm-dd/);
  assert.match(exploreAgent, /Keep a durable discussion record/);
  assert.match(readme, /owning idea's `explorations\/` directory/);
  assert.match(doctrine, /Preserve any substantial discussion the user wants to survive chat/);
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
    /stable repository IDs in the central `change\.md` frontmatter as the target set[\s\S]*transition <space-id> <change-id> --from in_progress --to in_review` once, with no `--repo`/,
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

test("multi-repository handoff templates key integration proof and repeated blocks by repository ID", async () => {
  const [tasks, review] = await Promise.all([
    readPackageFile("docs", "templates", "tasks.md"),
    readPackageFile("docs", "templates", "review.md"),
  ]);

  const verificationScope = markdownSection(tasks, "Verification Scope Decision");
  assert.match(
    verificationScope,
    /Repository-key every integration handoff\.[\s\S]*\| Repository ID \| Tested Integration Tree \/ Ref \| Actual Integrated Tree \/ Ref \| Match \| Required Aggregate Rerun \/ Evidence \| Result \|/,
  );
  assert.match(
    markdownSection(review, "Review Bundle: <repository-id>"),
    /^- Repository ID: <repository-id>$/m,
  );
  assert.match(
    markdownSection(review, "PR / Merge Readiness: <repository-id>"),
    /^- Repository ID: <repository-id>$/m,
  );
});

test("packaged Apply continues after a verified slice and commits the phase before later work", async () => {
  const applySkill = await readPackageFile("skills", "sdd-apply", "SKILL.md");

  assertContractClauses("Apply outcome contract", applySkill, [
    [
      "treat full mode as an outcome request rather than a one-slice request",
      /Persistence invariant: a default or explicit full-mode invocation is an outcome request, not permission to complete only one slice\./,
    ],
    [
      "continue implementation, verification, reconciliation, and safe remediation through the review handoff",
      /Continue implementing, verifying, reconciling, and safely remediating until every implementation-completion criterion is satisfied and the Change has transitioned to `in_review`, ready for independent `\/sdd-review`\./,
    ],
    [
      "reject ordinary phase completion and fixable failures as terminal conditions",
      /A completed phase, passing focused test, subagent handoff, commentary update, or ordinary fixable failure is not a terminal condition\./,
    ],
    [
      "commit each completed verified reconciled phase in every affected target before the next one",
      /in default\/full mode, make a local commit in each affected target repository after every completed, verified, artifact-reconciled Requirement\/Scenario phase before starting the next phase\./,
    ],
    [
      "allow only explicit opt-outs or isolation constraints to defer that phase commit",
      /`--no-commit`, an explicit user prohibition, repository policy, or an inability to isolate the intended files are the only reasons to keep a completed phase as a commit candidate\./,
    ],
  ]);

  const phaseBoundary = markdownSection(applySkill, "Phase Boundary");
  assertContractClauses("Apply phase boundary", phaseBoundary, [
    [
      "define a phase as completed behavior plus proof and artifact reconciliation",
      /A phase is the smallest committable slice that completes one Requirement, or a coherent subset of that Requirement's Scenarios, with verification evidence and artifact updates\./,
    ],
    [
      "finish every participating repository commit and central ledger update before selecting later work",
      /Finish each phase with its local commit in every participating repository and an updated central ledger before selecting or delegating the next phase\./,
    ],
  ]);

  const applyLoop = markdownSection(applySkill, "Apply Loop");
  assertContractClauses("Apply loop", applyLoop, [
    [
      "keep the central Change in progress while any target has unfinished handoff work",
      /Keep `status: in_progress` while any target repository still has implementation, verification, remediation, review-handoff preparation, or unresolved blockers\./,
    ],
    [
      "commit an authorized verified commit-shaped slice in every affected target",
      /Commit locally in each affected target repository when authorized, the slice is verified, and its changes are commit-shaped\./,
    ],
    [
      "loop across the central target set after each completed phase",
      /In default\/full mode, loop back to the next pending Requirement or Scenario anywhere in the central target set after every completed phase\./,
    ],
    [
      "continue until every target is independently review-ready and the central transition is complete",
      /Continue until every target repository is ready for independent `\/sdd-review` and the central Change has transitioned once, or a genuine stop condition is hit\./,
    ],
  ]);

  const riskClosure = await readPackageFile(
    "skills",
    "sdd-apply",
    "references",
    "risk-closure.md",
  );
  const phaseCommit = markdownSection(riskClosure, "Phase Commits");
  assertContractClauses("Risk-closure phase commit", phaseCommit, [
    [
      "falsify exact evidence and reconcile gaps before committing",
      /falsify the phase's important evidence claims against their exact tests, assertions, routes, or observations[\s\S]*prove each applicable risk row or record its explicit gap[\s\S]*update repository-local Epic truth and supporting docs plus the central ledgers and current-state claims/,
    ],
    [
      "commit the coherent green slice before later work",
      /commit the coherent green slice in every participating repository before beginning the next phase/,
    ],
  ]);
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
      /Run every gate that applies and record `pass`, `findings`, `blocked`, or `not applicable`\./,
    ],
    [
      "forbid short-circuiting after an earlier finding",
      /Do not short-circuit this list because an earlier gate already guarantees `changes-requested` or `blocked`; complete later independent gates so the user receives one comprehensive finding set\./,
    ],
    [
      "require a complete scorecard before finalization",
      /Before finalizing, confirm that every gate has an explicit result and that no delegated or main-thread review pass remains uncollected\./,
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
  const scorecard = markdownSection(canonicalReview, "Gate Scorecard");
  for (const requiredGate of [
    "Change artifacts",
    "Epic truth",
    "Reverse traceability",
    "Tests and verification",
    "Evidence falsification",
    "Pattern conformance",
    "Boundary contracts",
    "Stateful transitions",
    "Rendered UI verification",
    "Security review",
    "Documentation",
    "Branch and merge readiness",
    "Prospective integration candidate",
  ]) {
    assert.match(scorecard, new RegExp(`^\\| ${requiredGate} \\|`, "m"));
  }
});

test("packaged Review resumes yielded commands and preserves the full until-ready report contract", async () => {
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

  const modes = markdownSection(reviewSkill, "Inputs And Modes");
  assertContractClauses("Review until-ready mode", modes, [
    [
      "change only the number of bounded remediation cycles",
      /`--until-ready`: after the default full discovery, batch remediation, and regression rereview, allow additional bounded remediation cycles until all gates pass or a stop condition occurs\. This changes only the number of remediation cycles/,
    ],
    [
      "require the same complete final report as one review loop",
      /it must end with the same complete Final Response as a single review loop\. Per-cycle updates are progress messages, not substitute verdicts\./,
    ],
    [
      "default the remediation cap to five iterations",
      /`--max-iterations N`: cap `--until-ready`; default to `5`\./,
    ],
  ]);

  const finalResponse = markdownSection(reviewSkill, "Final Response");
  assertContractClauses("Review final response", finalResponse, [
    [
      "apply one complete report shape to all full-review modes and the iteration cap",
      /Final-report invariant: default, `--deep`, `--no-fix`, `--until-ready`, and a run that reaches `--max-iterations` all use the same complete report structure below\./,
    ],
    [
      "forbid a short narrative from replacing the full result",
      /Never replace it with a short narrative such as “review is ready,” a list of resolved themes, test totals, or key commits\./,
    ],
    [
      "require the capped run to report every residual finding",
      /If the iteration cap is reached, issue the full report with the resulting `changes-requested` or `blocked` verdict and every residual finding\./,
    ],
    [
      "include every gate and the final reviewed watermark",
      /complete gate scorecard covering every applicable Review Gate[\s\S]*final post-remediation reviewed source commit per repository as the review watermarks/,
    ],
  ]);
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
  const applyLoop = markdownSection(applySkill, "Apply Loop");
  assertContractClauses("Apply rendered verification", applyLoop, [
    [
      "require rendered verification before review handoff",
      /For every UI-bearing slice, rendered UI verification is required before review handoff\./,
    ],
    [
      "render current source and inspect interactions, captures, console, and network",
      /Start the representative runtime, open the affected surfaces, exercise changed interactions, capture and directly inspect the result, and inspect relevant console and network failures\./,
    ],
    [
      "reject source, build, non-visual tests, and uninspected screenshots as rendered proof",
      /A green build, passing non-visual tests, or generated-but-uninspected screenshots are not rendered evidence\./,
    ],
    [
      "record unavailable rendering as blocked verification or an explicit accepted gap",
      /if no available path can render a required surface, record the exact blocked verification or accepted gap\./,
    ],
  ]);

  const reviewSkill = await readPackageFile("skills", "sdd-review", "SKILL.md");
  const reviewGates = markdownSection(reviewSkill, "Review Gates");
  assertContractClauses("Independent rendered review", reviewGates, [
    [
      "independently reproduce and inspect the current UI",
      /\*\*Rendered UI verification\*\*: for every UI-bearing change, independently render current source, open the affected surfaces, exercise changed interactions, directly inspect screenshots or rendered results, and inspect relevant console and network failures\./,
    ],
    [
      "reject non-rendered and apply-only evidence",
      /A green build, passing non-visual tests, apply-side screenshots alone, or generated-but-uninspected images cannot pass this gate\./,
    ],
    [
      "block an unavailable required surface unless the gap is accepted",
      /If no available path can render a required surface, mark the gate `blocked` unless the user explicitly accepts the gap\./,
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
  assert.equal(packagedTasks, canonicalTasks, "the UI evidence ledger must use the canonical tasks template");
  const matrix = markdownSection(canonicalTasks, "Visual Verification Matrix");
  assertContractClauses("Visual Verification Matrix", matrix, [
    [
      "remain pending until directly inspected evidence and console or network results are recorded",
      /\| Surface \/ Route or Fixture \| Viewport \| State \/ Interaction \| Expected Rendered Behavior \| Tool \/ Setup \| Inspected Evidence \| Console \/ Network \| Result \| .* \| TBD \| desktop \/ mobile \| .* \| screenshot, trace, or direct observation \| clean \/ findings \/ not applicable \| pending \|/,
    ],
  ]);
});

test("packaged evidence closure keeps high-risk Scenarios unverified when only an aggregate gate passes", async () => {
  const riskClosure = await readPackageFile(
    "skills",
    "sdd-apply",
    "references",
    "risk-closure.md",
  );
  const evidenceIntegrity = markdownSection(riskClosure, "Evidence Claim Integrity");
  assertContractClauses("Evidence claim integrity", evidenceIntegrity, [
    [
      "treat completion and verification statements as falsifiable claims",
      /Treat every completion checkbox, `Verified By` row, E2E claim, security claim, and review-handoff statement as a falsifiable claim\./,
    ],
    [
      "require an exact named proof and its meaningful assertion or observation",
      /For automated evidence, name `path#exact test title or stable test anchor` and identify the assertion, route, selector, injected failure, or observation that matters\./,
    ],
    [
      "forbid Scenario aggregation unless the named proof exercises each Scenario",
      /Do not aggregate several Scenarios into one evidence row unless the named test or parameterized case explicitly exercises each one\./,
    ],
    [
      "limit a broad green command to behavior it directly asserted",
      /A file path, test count, broad green command, manual walkthrough, or reviewer statement is evidence only for what was directly inspected or asserted\./,
    ],
    [
      "reopen weak claims and record the verification gap",
      /If the cited proof is missing, too broad, skipped, undiscovered, or weaker than the claim, reopen the checklist item and record a verification gap instead of preserving a green label\./,
    ],
  ]);

  const applySkill = await readPackageFile("skills", "sdd-apply", "SKILL.md");
  const applyLoop = markdownSection(applySkill, "Apply Loop");
  assertContractClauses("Apply evidence closure", applyLoop, [
    [
      "treat broad commands as support unless mapped to named behavior",
      /Label the evidence type where it matters; treat broad commands as supporting evidence unless they map to named behavior\./,
    ],
    [
      "inspect exact proof, execution discovery, and the claimed boundary",
      /Before claiming E2E, migration, auth, recovery, or production-path coverage, confirm the cited source contains the relevant route, command, fixture, failure injection, and assertion, the passing command discovers it, and the evidence proves the claimed implementation boundary\./,
    ],
    [
      "reopen missing, broad, undiscovered, or boundary-mismatched proof",
      /Reopen claims with missing, skipped, broad, undiscovered, or boundary-mismatched proof\./,
    ],
    [
      "derive Verification state from current scenario evidence and explicit gaps",
      /Update `Verification` to `unverified`, `partial`, or `verified` according to current scenario evidence and `Verification Gaps`; do not use it as an implementation-progress state\./,
    ],
  ]);

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
      /\*\*Verification\*\*: scenario-mapped focused evidence exists, broad gates are not substituted for behavior proof, production\/mock boundaries are honest, the Verification Scope Decision is explicit, and required aggregate candidate checks pass freshly on the exact reviewed commit or have explicit blocking gaps\./,
    ],
    [
      "open high-risk proof and reject unsupported aggregation or boundary substitution",
      /\*\*Evidence falsification\*\*: for every new or high-risk completion, `Verified By`, E2E, security, recovery, or production-path claim, open the cited proof and confirm its exact test title or stable named anchor, important assertion\/observation, and discovery by the command that passed\. Reject generic framework anchors such as `#it\(`, unsupported Scenario aggregation, missing\/skipped\/undiscovered evidence, and server-side proof used to imply untested client retry, redirect, timeout, draft, navigation, or recovery behavior\./,
    ],
  ]);

  const canonicalTasks = await readPackageFile("docs", "templates", "tasks.md");
  const verificationScope = markdownSection(canonicalTasks, "Verification Scope Decision");
  assertContractClauses("Verification Scope Decision", verificationScope, [
    [
      "record focused proof separately from by-repository aggregate and integration results",
      /Keep focused behavior proof distinct from aggregate and integration-candidate proof\. .* Project-defined aggregate commands or authoritative constituent sources by repository: .* Aggregate gates required before `in_review`: yes \/ no \/ pending, by repository .* Exact committed source candidates by repository: .* Freshness and cache treatment: .* Aggregate results and meaningful execution\/count evidence: .* Prospective integration gates required: yes \/ no \/ pending, by repository/,
    ],
  ]);
});

test("packaged Interactive workflow tracks one lightweight progressive Change", async () => {
  const interactiveSkill = await readPackageFile("skills", "sdd-interactive", "SKILL.md");

  assert.match(interactiveSkill, /sdd change create <space-id> <slug>/);
  assert.match(interactiveSkill, /`change\.md`: record why the session exists[\s\S]*high-level technical approach/);
  assert.match(interactiveSkill, /Status, Space, and repositories remain in `change\.md`/);
  assert.doesNotMatch(interactiveSkill, /<yyyy-mm-dd-change-name>\/design\.md/);
  assert.match(interactiveSkill, /sdd change transition <space-id> <change-id> --from proposed --to planned/);
  assert.match(interactiveSkill, /Recommend `\/sdd-review` before merge or closeout/);
  assert.doesNotMatch(interactiveSkill, /proposal\.md|--brief|\/sdd-change --plan|--replan/);
});
