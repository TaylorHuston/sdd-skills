import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("packaged change replan preserves a coherent planned handoff and exact Apply restart", async () => {
  const changeSkill = await readPackageFile("skills", "sdd-change", "SKILL.md");
  const replan = markdownSection(changeSkill, "Replan Mode");

  assertContractClauses("Replan mode", replan, [
    [
      "route planning-level discoveries from implementation, review, or manual feedback before implementation continues",
      /Use `--replan` when implementation, review, or manual feedback discovers a new or meaningfully changed Requirement, Scenario, constraint, Epic owner, contract, data\/auth rule, architecture decision, rollout need, or verification obligation that must be planned before implementation continues\./,
    ],
    [
      "leave narrow implementation corrections with Apply",
      /Do not use it for narrow defects, missing tests, stale evidence indexes, or routine implementation corrections that `\/sdd-apply` can safely reconcile\./,
    ],
    [
      "guard the return to proposed before replanning",
      /For an active Change not already `proposed`, run `sdd change transition <space-id> <change-id> --from <current-status> --to proposed` with explicit repository selection when needed\./,
    ],
    [
      "update every planning and resume artifact affected by the discovery",
      /Update `proposal\.md`, `design\.md`, ADRs, and `tasks\.md` wherever scope, behavior, approach, evidence, risks, decision fan-out, verification-environment obligations, or resume state changed\./,
    ],
    [
      "record a dated planning update with the exact Apply restart",
      /Add a dated `Planning Updates` entry with the discovery, classification, decisions, artifacts changed, and exact `\/sdd-apply` restart point\./,
    ],
    [
      "return to planned only after coherence and scoped validation",
      /Set `status: planned` only when the revised plan is coherent\. For an active Change, use `sdd change transition <space-id> <change-id> --from proposed --to planned`; then run scoped `sdd validate`\./,
    ],
  ]);

  const canonicalTasks = await readPackageFile("docs", "templates", "tasks.md");
  const packagedTasks = await readPackageFile(
    "skills",
    "sdd-change",
    "assets",
    "tasks-template.md",
  );
  assert.equal(packagedTasks, canonicalTasks, "the packaged Change ledger must mirror the canonical template");

  const planningUpdates = markdownSection(canonicalTasks, "Planning Updates");
  assertContractClauses("Planning Updates", planningUpdates, [
    [
      "identify replanning as the response to planning-level discovery",
      /Record `\/sdd-change --replan` updates when implementation or feedback discovers planning-level requirements\./,
    ],
    [
      "capture the discovery, classification, changed artifacts, and next Apply starting point",
      /\| Date \| Discovery \| Classification \| Planning Updates \| Next Apply Starting Point \| .* \| YYYY-MM-DD \| TBD \| in-scope refinement \/ scope expansion \/ product drift \/ Epic ownership change \/ technical constraint \/ follow-up change \| proposal\.md \/ design\.md \/ tasks\.md \| `\/sdd-apply` TBD \|/,
    ],
  ]);
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
      "commit each completed verified reconciled phase before the next one",
      /in default\/full mode, make a local commit after every completed, verified, artifact-reconciled Requirement\/Scenario phase before starting the next phase\./,
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
      "finish the phase commit before selecting later work",
      /Finish each phase with its local commit before selecting or delegating the next phase\./,
    ],
  ]);

  const applyLoop = markdownSection(applySkill, "Apply Loop");
  assertContractClauses("Apply loop", applyLoop, [
    [
      "keep incomplete implementation in progress",
      /Keep `status: in_progress` while implementation, verification, remediation, or unresolved blockers remain\./,
    ],
    [
      "commit an authorized verified commit-shaped slice",
      /Commit locally when authorized, the slice is verified, and changes are commit-shaped\./,
    ],
    [
      "loop to the next accepted slice after the phase boundary",
      /In default\/full mode, loop back to the next pending Requirement or Scenario after every completed phase\./,
    ],
    [
      "continue until independent review readiness or a genuine stop condition",
      /Continue until the Change is ready for independent `\/sdd-review` or a genuine stop condition is hit\./,
    ],
  ]);

  const riskClosure = await readPackageFile(
    "skills",
    "sdd-apply",
    "references",
    "risk-closure.md",
  );
  const phaseCommit = markdownSection(riskClosure, "Phase Commit");
  assertContractClauses("Risk-closure phase commit", phaseCommit, [
    [
      "falsify exact evidence and reconcile gaps before committing",
      /falsify the phase's important evidence claims against their exact tests, assertions, routes, or observations .* prove each applicable risk row or record its explicit gap .* update Epic truth, supporting docs, ledgers, and current-state claims/,
    ],
    [
      "commit the coherent green slice before later work",
      /commit the coherent green slice before beginning the next phase/,
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
      /complete gate scorecard covering every applicable Review Gate .* the final post-remediation reviewed source commit as the review watermark/,
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
      "record focused proof separately from fresh exact-candidate aggregate and integration results",
      /Keep focused behavior proof distinct from aggregate and integration-candidate proof\. .* Aggregate gate required before `in_review`: yes \/ no \/ pending .* Exact committed source candidate: .* Freshness and cache treatment: .* Aggregate result and meaningful execution\/count evidence: .* Prospective integration gate required: yes \/ no \/ pending/,
    ],
  ]);
});

test("packaged Interactive workflow tracks one lightweight request through an honest review handoff", async () => {
  const interactiveSkill = await readPackageFile("skills", "sdd-interactive", "SKILL.md");

  assertContractClauses("Interactive workflow", interactiveSkill, [
    [
      "limit the mode to a tracked lightweight session rather than substantial replanning",
      /This skill is for tracked working sessions\. It is not a replacement for `\/sdd-change --plan` when the change needs substantial product scoping, architecture design, data\/auth\/API changes, migration planning, or cross-Epic coordination\./,
    ],
    [
      "create the minimal durable Change artifacts and an in-progress cold-resume ledger",
      /Create the lightweight change artifacts\. .* `proposal\.md`: record why the session exists, in-scope work, explicit out-of-scope work, known Epic\/Story impact, release-communication impact, and when to stop and route to `\/sdd-change --plan`\. .* `design\.md`: record the current understanding, high-level technical approach, alternatives or deferred approaches when relevant, affected Epic truth, and open questions\. .* `tasks\.md`: begin with `status: in_progress` YAML frontmatter and record `Resume Here`, the interactive request log, task checklist, implementation ledger, verification ledger, manual UI confirmation checklist, artifact updates, open questions, and closeout state\./,
    ],
    [
      "stop scope expansion unless the user explicitly accepts it",
      /If the user request would materially expand product scope, user-visible behavior, Epic ownership, data model, auth\/security model, public API, deployment behavior, or external-service state, stop and recommend `\/sdd-change --plan` unless the user explicitly accepts expanding the active change\./,
    ],
    [
      "process and record one classified request at a time",
      /Take one user request, manual-testing note, or tweak at a time\. .* Record it in `tasks\.md` before or immediately after acting\. .* Classify it as `cosmetic`, `defect`, `verification gap`, `artifact drift`, `requirement refinement`, `small in-scope behavior`, `scope expansion`, or `product drift`\./,
    ],
    [
      "require focused proof for defects and missing evidence",
      /For `defect` changes, add or update a focused failing-first test\/check when practical, fix the defect, verify, and update scenario-mapped Story evidence\. .* For `verification gap`, produce the missing proof before claiming completion\./,
    ],
    [
      "update accepted behavior before or with implementation",
      /For `requirement refinement`, update `design\.md` and the target Epic Requirement\/Scenario before or alongside implementation\. .* For `small in-scope behavior`, add or update the relevant Requirement\/Scenario, then implement and verify it\./,
    ],
    [
      "reconcile implementation ownership, scenario proof, and release communication",
      /Update affected Epic `Implementation`, behavior-mapped `Implemented By`, `Implementation Gaps`, `Verification`, scenario-mapped `Verified By`, and `Verification Gaps` when implementation or verification reality changes\. .* Update the project-defined release communication when project policy requires it\./,
    ],
    [
      "keep work in progress until it is actually ready for independent review",
      /Keep status `in_progress` while work or remediation remains; set it to `in_review` when implementation is ready for independent review\. .* Recommend `\/sdd-review` before merge or closeout when code, user-visible behavior, security, data, or release state changed\./,
    ],
  ]);

  const artifactShapeStart = interactiveSkill.indexOf("## Artifact Shape");
  const artifactShapeEnd = interactiveSkill.indexOf("## Stop Conditions", artifactShapeStart);
  assert.notEqual(artifactShapeStart, -1, "Interactive must define its lightweight artifact shape");
  assert.notEqual(artifactShapeEnd, -1, "Interactive artifact shape must end before stop conditions");
  const taskShape = interactiveSkill.slice(artifactShapeStart, artifactShapeEnd);
  for (const requiredLedgerSection of [
    "## Resume Here",
    "## Interactive Log",
    "## Implementation Ledger",
    "## Verification Ledger",
    "## Manual UI Confirmation",
    "## Artifact Updates",
    "## Closeout",
  ]) {
    assert.match(taskShape, new RegExp(`^${requiredLedgerSection.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}$`, "m"));
  }
  assert.match(
    taskShape,
    /^- Status: pending user \/ user confirmed \/ accepted gap \/ not applicable$/m,
    "the lightweight ledger must preserve explicit manual-confirmation state",
  );
});
