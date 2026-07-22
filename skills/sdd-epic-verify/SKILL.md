---
name: sdd-epic-verify
description: Audit a SDD Epic end to end against current implementation reality with subagent delegation, mandatory full reverse traceability, systematic Requirement/Scenario testing, Epic coherence review, missing Story/Requirement/Scenario detection, Story label/reference traceability checks, Change-status and evidence drift detection, and an Epic-local verification report. Use when the user invokes /sdd-epic-verify, asks whether an Epic is still accurate, asks to detect implementation drift across an Epic, asks to test every Story/Requirement/Scenario in an Epic, or wants to know what needs a SDD change, artifact fix, verification pass, or PRD update before continuing.
---

# SDD Epic Verify

Audit one Epic as a durable capability truth source. It works with embedded Stories inside `docs/epics/<key>-<###>-epic-name>/epic.md`.

## Authority And Project Profile

Resolve the workspace, idea-owned planning path, and target implementation repository with `sdd context <relevant-path> --json`, then read the `workflowPath` returned by `sdd context` completely before judging artifact authority, traceability, evidence, or Change-status drift. Use the resolved topology unless project guidance declares an explicit exception, then enforce Epics and their verification reports under `docs/epics/` and related changes under `docs/changes/` inside the implementation repository. Project guidance owns test, security, and truth-bearing supporting-doc commands and requirements. If user setup is missing, direct the user to `sdd setup`; if the repository contract is missing, direct them to `sdd init` there. Use `sdd doctor` for an existing but unhealthy installation.

This skill verifies truth; it does not implement missing behavior and does not replace `/sdd-review` for a specific change. Use `/sdd-review` for change-local PR readiness. Use `/sdd-epic-verify` when the question is whether the whole Epic still matches product intent, current code, tests, docs, and evidence.

Delegation authorization: invoking `/sdd-epic-verify`, naming `sdd-epic-verify`, asking to verify or audit an SDD Epic, or asking to detect Epic drift is explicit permission to use bounded SDD audit subagents under this skill's delegation model. If the local tool policy requires an explicit user request before spawning subagents, this skill invocation satisfies that requirement for Epic coherence, Story drift, implementation, verification, security, docs, or Change-status audit passes that remain inside the selected Epic/app scope. Do not ask for separate subagent permission unless the user passed a no-delegation mode, the requested delegation would exceed the selected Epic/app scope, the tool requires a more specific approval than normal spawning, or a stop condition applies.

## Modes

- Default: run a full Epic audit, run practical verification, write an Epic-local report, and report findings. Do not edit source artifacts except the report.
- `--check`: read-only terminal output only. Do not write a report or edit files.
- `--propose-fixes`: after reporting findings, create or update a scoped `docs/changes/yyyy-mm-dd-<epic>-drift-fixes/` proposal/design/tasks for findings that require implementation, tests, product behavior, or risky docs changes.

If mode is ambiguous, default to the full audit report.

## Output

Default output is a report under the Epic directory:

```text
<app-root>/docs/epics/<key>-<###>-epic-name>/reviews/<yyyy-mm-dd-HHMM>-epic-verify.md
```

Use `assets/epic-verify-report-template.md` for the report and `assets/epic-template.md` as the canonical Epic shape reference. Create `reviews/` only when writing a report.

Use `sdd validate <space-id> --epic <epic-id> --repo <resolved-repository-path> --workspace <workspace-root> --json` for the repeatable Epic structure and traceability scan. Use `sdd validate <space-id> --repo <resolved-repository-path> --workspace <workspace-root> --json` when the user asks for an app-wide artifact assessment.

The report is the durable audit record. Findings are addressed through the workflow named in the report:

- `artifact-only`: after reporting, ask the user whether to apply the listed safe artifact fixes in the same thread.
- `needs-change`: run `/sdd-change --plan` or `/sdd-epic-verify --propose-fixes`, then `/sdd-apply`, then `/sdd-review`. Use `/sdd-change --brief` instead when the remediation should be retained but not planned yet.
- `needs-verification`: add or run the missing checks through a SDD change unless no source files need to change.
- `needs-prd`: run `/sdd-prd` before changing Epic scope.
- `blocked`: ask the user for the named decision.

## Required Context

Before auditing, read:

- app/workspace `AGENTS.md`, especially branch policy and test commands
- the already loaded package workflow at `workflowPath` plus any explicit project SDD overlay
- parent or workspace guidance when the project points to it
- this skill's `assets/epic-template.md`, to check the target Epic against the canonical template shape
- target `docs/epics/<key>-<###>-epic-name>/epic.md`
- relevant `docs/changes/**/proposal.md`, `design.md`, `tasks.md`, and `review.md` when they mention the Epic, its Story labels, full Story references, or legacy Story IDs
- enough of every active `docs/epics/*/epic.md` to detect duplicate Story labels inside an Epic, duplicate full Story references, or conflicting legacy app-wide Story IDs
- planning-root docs or the PRD/Product Brief when product direction exists or drift is suspected
- the project-defined truth-bearing supporting-doc set; when none is declared, inspect the README and documents whose current claims intersect the Epic, such as testing, architecture, ADR, data-model, current-state, or release docs
- source files, tests, configs, generated artifacts, and runtime surfaces listed in Story `Implemented By` and `Verified By`

Check git status in every repo that may be inspected or touched. Preserve unrelated dirty files. In default mode, do not stage or commit.

## Operating Sequence

1. Select the Epic.
   - Prefer an explicit Epic path or ID.
   - Otherwise list `docs/epics/*/epic.md` and ask only if selection is ambiguous.
2. Parse the Epic.
   - Identify Epic ID and schema, current status, Story labels or documented legacy Story IDs, Story titles, independent implementation and verification state, Requirements, Scenarios, behavior-mapped `Implemented By`, `Implementation Gaps`, scenario-mapped `Verified By`, and `Verification Gaps`.
   - Compare the Epic to the canonical template shape: frontmatter, Product Context, Outcome, Current Scope, Deferred Scope, Candidate Stories, Story Index, Stories, Cross-Story Concerns, Open Decisions, Completion Criteria, and Notes.
   - Run scoped `sdd validate` and treat deterministic errors as `template-drift`, `status-drift`, or `verification-drift` findings according to their code and affected artifact. Inspect warnings rather than silently discarding them. For app-wide assessments, run Space/repository-scoped validation and summarize every Epic with findings.
   - The CLI baseline checks top-level section spine, required frontmatter keys, Epic schema compatibility, Story Index state alignment, promoted Story metadata lines, Story subsection presence, Story/Requirement/Scenario ID shape and duplicates, competing traceability sections, behavior-mapped `Implemented By`, `Implementation Gaps`, scenario-mapped `Verified By`, `Verification Gaps`, implementation/evidence path existence, generic framework evidence anchors, coverage and state contradictions, Story-size review signals, evidence-reference integrity, broken SDD artifact links, and legacy/migration Story label warnings. Continue the semantic audit even when it passes.
   - Summarize the intended Epic behavior from outcome, current scope, completion criteria, PRD/product docs, public docs, and known runtime surfaces.
   - Confirm Story labels or documented legacy Story IDs are stable, Requirements use local `R#`, and Scenarios use local `R#-S#`.
   - Confirm `S#` Story labels are unique within each Epic, full Story references are traceable, and legacy app-wide Story IDs remain unique unless a temporary migration duplicate is explicitly documented as blocking further implementation.
   - Confirm candidate Stories are unlabeled until promoted and that promoted Story sections use the current shape: Story statement, independent implementation/verification state, Requirements And Scenarios, behavior-mapped `Implemented By`, `Implementation Gaps`, scenario-mapped `Verified By`, `Verification Gaps`, and Story Notes.
   - Confirm each Story has exactly one current `Implemented By` map and one current `Verified By` map. Treat `Prior`, `Detailed`, `Legacy`, reconciliation, or migration-era maps beside the canonical sections as authority drift even when they contain more useful detail; consolidate current rows into the canonical sections and keep only non-competing history in notes.
   - If a legacy Epic has materially edited behavior, state, ownership, gaps, or evidence, flag the whole file for `sdd-epic-v2` normalization. Do not accept a partly converted Epic or infer both new states from one legacy `Status`.
   - Confirm every implemented Requirement has a concrete repository-relative primary application-logic location and stable symbol, export, route, class, configuration key, or searchable anchor. Open the anchor and confirm it identifies the definition, registration, or configuration that governs the claimed behavior rather than an import, call site, incidental handler, broad file token, or another symbol in an already-cited file. Treat `primary` as the governing behavior owner regardless of physical layer, and allow multiple narrower primary rows when ownership genuinely splits across layers or Scenarios. Flag maps that stop at incidental UI/tests while hiding governing logic or flatten primary and supporting files into one list.
   - Confirm Story Index state exactly matches each Story body and that `implemented` or `verified` does not contradict its respective gaps.
   - Treat more than six Requirements or twelve Scenarios as a split-review signal. Decide semantically whether the Story still represents one primary user path rather than failing it by count alone.
   - When retaining an oversized Story, confirm its implementation map is subdivided enough that each distinct governing owner remains directly navigable; conceptual coherence alone does not excuse an umbrella map.
   - Detect `Verified By` sections that are chronological command logs, broad-only gates, or unmapped evidence lists.
   - Reject automated evidence anchors that are generic framework syntax such as `#it(`, `#test(`, or `#describe(` even when the token exists in the file. Open the named proof and confirm the cited title/anchor identifies the Scenario assertion.
   - Detect `Verified By` sections that blur focused automated tests, broad supporting gates, deterministic E2E, live-provider playtests, manual UI confirmation, and debug/log inspection into one undifferentiated proof bucket.
   - For behavior-preserving refactors, confirm changed anchors were reconciled and affected focused proof was rerun. Prior evidence remains current only when its assertion and relevant behavior boundary are unchanged and the check still passes; otherwise require a verification downgrade or explicit gap.
   - Detect older Stories whose Requirements, Scenarios, evidence, or gaps were superseded by later Stories without being reconciled.
3. Run the mandatory reverse-traceability inventory.
   - Run the packaged `sdd-orphan-audit` script against the current working tree with `--epic <epic-id> --format json` and no changed-surface filter.
   - Review all `tests_without_verified_by`, `source_without_implemented_by`, missing references, test-support exclusions, and framework/configuration/generated exclusions against project conventions.
   - Classify relevant candidates as Epic-owned, intentionally shared/supporting/generated/framework infrastructure, an explicit gap, another Epic's responsibility, or tracked cleanup. The script proposes candidates; it does not authorize deletion or artifact edits.
   - Record the exact command, scope, counts, and classification in the report. If the script cannot run, perform an equivalent full inventory and record why; if neither inventory occurs, the audit is `blocked` and must not report `aligned`.
4. Build a verification matrix.
   - One row per declared Scenario, with Story label/reference, Requirement ID, Scenario ID, Story implementation/verification state, claimed primary implementation location and anchor, supporting locations, implementation gap, claimed verification mapping, verification gap, and planned check.
   - Add candidate rows for suspected missing Stories, Requirements, or Scenarios when Epic outcome, Story capability, product/docs claims, UI/API/runtime surfaces, tests, or implementation imply behavior that is not represented in the Epic.
   - Include failure, empty, permission, validation, recovery, migration, and security-sensitive paths.
5. Delegate by default when subagent tooling is available.
   - The user's invocation of this skill is standing delegation authorization for bounded Epic audit subagents.
   - Use one Epic coherence audit subagent.
   - Use one Story implementation-drift subagent per Story when practical.
   - Use small Story batches when the Epic is large or subagent capacity is limited.
   - Use `assets/epic-coherence-subagent-prompt.md` and `assets/story-drift-subagent-prompt.md`.
   - Record skipped delegation only when tooling is unavailable, the Epic is tiny, isolation would add risk, or another explicit stop condition applies; do not cite generic lack of subagent permission.
   - Continue independent matrix and evidence work after spawning. Never wait silently for more than 60 seconds; report completed audit work and the delegated passes still pending.
   - After roughly three minutes of cumulative waiting on one agent or audit wave, interrupt or close the slow agent and finish that audit locally, or re-delegate a narrower Story batch. Do not let an optional audit pass prevent a status response, and close completed or abandoned agents promptly.
6. Systematically test the Epic.
   - Run focused tests named in `Verified By` when safe.
   - Treat automated evidence without a concrete repository-relative test path as verification drift even when `sdd validate` reports it only as a warning.
   - Run broader project checks when changed or claimed surfaces warrant them: unit tests, integration tests, typecheck, lint, build, codegen, migration checks, browser checks, CLI smoke checks, or manual Obsidian/Vercel/Convex checks as appropriate.
   - Do not mutate production services, secrets, remote branches, deployments, or external data without explicit authorization.
   - If a check cannot run, record why, the fallback evidence, and whether the gap blocks alignment.
   - Run a cold-navigation check from the Epic for every implemented Requirement and every Scenario that declares or implies a distinct owner. Follow the anchor into source and identify the owning definition or registration; an existing string match alone is not a pass. If locating the governing application logic requires repository-wide rediscovery, record forward-traceability drift.
7. Verify delegated claims.
   - Re-read important files, inspect relevant diffs, and rerun or spot-check critical commands when practical.
   - Treat subagent findings as evidence, not final truth.
8. Classify drift.
   - `workflow-drift`: Epic truth, artifact authority, Change status, or behavior evidence violates the SDD north star or anti-patterns.
   - `template-drift`: Epic file shape, frontmatter, canonical sections, Story headings, candidate Story handling, or per-Story subsections diverge from the current Epic template without a documented migration reason.
   - `artifact-drift`: Epic/docs are stale but implementation is likely correct.
   - `implementation-drift`: code behavior no longer satisfies Epic truth.
   - `requirement-drift`: a Story is missing Requirements or Scenarios needed to cover its stated capability, implemented behavior, product/docs claims, important modes, or runtime surfaces; or a declared Requirement/Scenario is misplaced, overloaded, too broad, or too narrow.
   - `verification-drift`: evidence is stale, broad, missing, unmapped, no longer proves the Scenario, or `Verified By` is shaped as a chronological command log instead of a scenario-mapped evidence index.
   - `scope-drift`: Story/Requirement/Scenario no longer belongs, is missing, has moved to another Epic, or is too broad/narrow for the Epic or Story.
   - `product-drift`: Epic conflicts with PRD/product direction or current product reality.
   - `security-drift`: security, privacy, auth, data, dependency, or destructive-flow risk is unresolved.
   - `status-drift`: related Change `tasks.md` status, folder location, review records, manual confirmation status, release-communication state, PR/merge state, or deferred gaps contradict each other. Active status must be `proposed`, `planned`, `in_progress`, or `in_review`; folder location under `closed/` means closed. Historical closed Changes may retain an older status that was valid when they closed. This also includes completed or closed artifacts that still say work is `Not implemented yet`, `Not verified yet`, pending implementation/verification, or use obsolete manual confirmation status vocabulary.
   - `superseded-truth-drift`: later Stories, Requirements, Scenarios, implementation, or docs changed a boundary but earlier Epic truth still reads as current.
9. Write or print the report.
   - Include the exact scoped `sdd validate` command and result in `Tests And Checks`.
   - Summarize template-shape findings in the Epic template adherence gate and `Template drift` line.
10. In `--propose-fixes`, create a scoped SDD change for findings that require implementation or risky decisions after the report exists.
11. After every non-`--check` run, ask the user whether to apply any safe artifact fixes identified by the audit. Do not apply those fixes until the user explicitly agrees.

## Gates

Use `pass`, `findings`, `blocked`, or `not applicable`. Apply the managed workflow document, `assets/epic-template.md`, scoped CLI validation, selected available skills, and project guidance instead of restating their detailed rules here.

1. **Doctrine and authority**: the Epic remains the durable accepted map from product behavior to implementation and evidence, and no supporting artifact contradicts or outranks it.
2. **Epic coherence and completeness**: outcome, scope, Story ownership, Story ordering, cross-Story concerns, open decisions, and completion criteria form a coherent capability; missing Stories, Requirements, or Scenarios are findings.
3. **Canonical shape**: the Epic passes scoped `sdd validate` or every reported warning/deviation is intentional and documented.
4. **Forward traceability**: Story references and local Requirement/Scenario IDs are stable and unique; each Story has one authoritative current implementation and verification map; implementation and verification state agree with the Story Index and gap sections; every implemented Requirement has a concrete primary code location whose anchor resolves to the governing definition/registration rather than an incidental occurrence; a cold developer can navigate from behavior to governing logic without repository-wide rediscovery; and moves or legacy identifiers remain traceable.
5. **Reverse traceability**: a full Epic-scoped working-tree inventory was run and every relevant source/test candidate, missing reference, support exclusion, and generated/framework exclusion was classified. This gate is mandatory and cannot be inferred from declared Epic paths alone.
6. **Implementation truth**: observable runtime behavior satisfies, defers, gaps, or exposes drift for every declared and materially missing behavior path.
7. **Verification strength**: `Verified By` is scenario-mapped, automated evidence names repository-relative test paths plus exact titles or stable named anchors rather than framework tokens, cited assertions prove the mapped behavior, evidence types remain distinct, broad gates are supporting evidence, production/mock boundaries are honest, and gaps state the remaining risk.
8. **Supporting alignment and status**: project docs, product direction, ADRs, active/closed Changes, machine-readable Change status, manual confirmation, release communication, generated indexes, and review/merge state do not contradict the Epic.
9. **Security and data safety**: apply relevant available security guidance to auth, permissions, secrets, user data, migrations, destructive actions, dependencies, and external services implicated by the Epic.

Do not report `aligned` merely because the declared Scenarios pass. The audit must also look for implemented behavior missing from the Epic and behavior the Epic needs but has not represented.

## Finding Severity

- `BLOCKING`: Epic truth is misleading enough to block implementation, review, acceptance, or release.
- `REQUIRED`: should be fixed before relying on the Epic for future work.
- `SUGGESTION`: improves clarity or maintainability but does not block use.

Every finding should include:

- severity
- drift type
- Story label/reference plus Requirement/Scenario ID when applicable
- file/path reference
- impact
- recommended workflow to address it

## Post-Run Artifact Fixes

After reporting, ask the user whether to apply safe artifact fixes when the audit found unambiguous documentation or workflow drift. If the user agrees, the same thread may edit:

- Epic wording, status, notes, canonical section ordering, Candidate Stories naming, Story ordering, Story labels/references, Requirement/Scenario labels, `Verification Gaps`, stale evidence notes, safe `Verified By` normalization when existing evidence can be mapped without changing behavior semantics, and missing Requirement/Scenario additions that describe already-implemented behavior or explicit gaps without changing product semantics
- active or closed change artifact wording that clearly contradicts accepted Epic truth, such as stale implementation-pending text, stale verification-pending text, obsolete manual confirmation status vocabulary, or old active-folder references
- README/docs references that clearly point at moved Epic anchors
- report files created by this run

Do not edit these as post-run artifact fixes:

- app code, tests, generated bundles, migrations, lockfiles, secrets, env files
- PRD/product direction
- external services, deployments, branches, PRs, git history
- behavior semantics that need the user judgment

If a finding requires code, tests, product behavior, or a debatable scope change, leave it in the report and recommend `/sdd-change --plan`, or `/sdd-change --brief` when implementation should be deferred.

## Result Labels

End every report with one result:

- `aligned`
- `changes-requested`
- `needs artifact fix`
- `needs implementation`
- `needs verification`
- `needs product decision`
- `blocked`

Use `aligned` only when all gates pass or remaining issues are explicitly non-blocking. A skipped full reverse-traceability inventory is always `blocked`, not a non-blocking exception.

## Final Response

Lead with the result.

Include:

- selected Epic path
- report path, unless `--check`
- most important findings ordered by severity
- verification commands/results
- delegation shape
- whether a SDD change was created
- exact next action
