---
name: sdd-epic-verify
description: Audit a SDD Epic end to end against current implementation reality with subagent delegation, systematic Requirement/Scenario testing, Epic coherence review, missing Story/Requirement/Scenario detection, Story label/reference traceability checks, lifecycle and evidence drift detection, and an Epic-local verification report. Use when the user invokes /sdd-epic-verify, asks whether an Epic is still accurate, asks to detect implementation drift across an Epic, asks to test every Story/Requirement/Scenario in an Epic, or wants to know what needs a SDD change, artifact fix, verification pass, or PRD update before continuing.
---

# SDD Epic Verify

Audit one Epic as a durable capability truth source. It works with embedded Stories inside `docs/epics/<key>-<###>-epic-name>/epic.md`.

This skill verifies truth; it does not implement missing behavior and does not replace `/sdd-review` for a specific change. Use `/sdd-review` for change-local PR readiness. Use `/sdd-epic-verify` when the question is whether the whole Epic still matches product intent, current code, tests, docs, and evidence.

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

The report is the durable audit record. Findings are addressed through the workflow named in the report:

- `artifact-only`: after reporting, ask the user whether to apply the listed safe artifact fixes in the same thread.
- `needs-change`: run `/sdd-propose` or `/sdd-epic-verify --propose-fixes`, then `/sdd-apply`, then `/sdd-review`.
- `needs-verification`: add or run the missing checks through a SDD change unless no source files need to change.
- `needs-prd`: run `/sdd-prd` before changing Epic scope.
- `blocked`: ask the user for the named decision.

## Required Context

Before auditing, read:

- app/workspace `AGENTS.md`, especially branch policy and test commands
- canonical SDD doctrine named by workspace or project guidance, or the packaged `docs/story-driven-development.md` when available
- `developer-guide.md` from the vault root when available
- this skill's `assets/epic-template.md`, to check the target Epic against the canonical template shape
- target `docs/epics/<key>-<###>-epic-name>/epic.md`
- relevant `docs/changes/**/proposal.md`, `design.md`, `tasks.md`, and `review.md` when they mention the Epic, its Story labels, full Story references, or legacy Story IDs
- enough of every active `docs/epics/*/epic.md` to detect duplicate Story labels inside an Epic, duplicate full Story references, or conflicting legacy app-wide Story IDs
- project planning docs or PRD/Product Brief files when product direction exists or drift is suspected
- README, testing docs, architecture docs, ADRs, data-model docs, current-state docs, and root `CHANGELOG.md` when they claim behavior owned by the Epic
- source files, tests, configs, generated artifacts, and runtime surfaces listed in Story `Implemented By` and `Verified By`

Check git status in every repo that may be inspected or touched. Preserve unrelated dirty files. In default mode, do not stage or commit.

## Operating Sequence

1. Select the Epic.
   - Prefer an explicit Epic path or ID.
   - Otherwise list `docs/epics/*/epic.md` and ask only if selection is ambiguous.
2. Parse the Epic.
   - Identify Epic ID, current status, Story labels or documented legacy Story IDs, Story titles, Requirements, Scenarios, `Implemented By`, `Verified By`, and `Verification Gaps`.
   - Compare the Epic to the canonical template shape: frontmatter, Product Context, Outcome, Current Scope, Deferred Scope, Candidate Stories, Story Index, Stories, Cross-Story Concerns, Open Decisions, Completion Criteria, and Notes.
   - Summarize the intended Epic behavior from outcome, current scope, completion criteria, PRD/product docs, public docs, and known runtime surfaces.
   - Confirm Story labels or documented legacy Story IDs are stable, Requirements use local `R#`, and Scenarios use local `R#-S#`.
   - Confirm `S#` Story labels are unique within each Epic, full Story references are traceable, and legacy app-wide Story IDs remain unique unless a temporary migration duplicate is explicitly documented as blocking further implementation.
   - Confirm candidate Stories are unlabeled until promoted and that promoted Story sections use the current shape: Story statement, Requirements And Scenarios, `Implemented By`, scenario-mapped `Verified By`, `Verification Gaps`, and Story Notes.
   - Detect `Verified By` sections that are chronological command logs, broad-only gates, or unmapped evidence lists.
   - Detect `Verified By` sections that blur focused automated tests, broad supporting gates, deterministic E2E, live-provider playtests, manual UI confirmation, and debug/log inspection into one undifferentiated proof bucket.
   - Detect older Stories whose Requirements, Scenarios, evidence, or gaps were superseded by later Stories without being reconciled.
3. Build a verification matrix.
   - One row per declared Scenario, with Story label/reference, Requirement ID, Scenario ID, claimed implementation files, claimed verification mapping, current status, and planned check.
   - Add candidate rows for suspected missing Stories, Requirements, or Scenarios when Epic outcome, Story capability, product/docs claims, UI/API/runtime surfaces, tests, or implementation imply behavior that is not represented in the Epic.
   - Include failure, empty, permission, validation, recovery, migration, and security-sensitive paths.
4. Delegate by default when subagent tooling is available.
   - Use one Epic coherence audit subagent.
   - Use one Story implementation-drift subagent per Story when practical.
   - Use small Story batches when the Epic is large or subagent capacity is limited.
   - Use `assets/epic-coherence-subagent-prompt.md` and `assets/story-drift-subagent-prompt.md`.
5. Systematically test the Epic.
   - Run focused tests named in `Verified By` when safe.
   - Run broader project checks when changed or claimed surfaces warrant them: unit tests, integration tests, typecheck, lint, build, codegen, migration checks, browser checks, CLI smoke checks, or manual Obsidian/Vercel/Convex checks as appropriate.
   - Do not mutate production services, secrets, remote branches, deployments, or external data without explicit authorization.
   - If a check cannot run, record why, the fallback evidence, and whether the gap blocks alignment.
6. Verify delegated claims.
   - Re-read important files, inspect relevant diffs, and rerun or spot-check critical commands when practical.
   - Treat subagent findings as evidence, not final truth.
7. Classify drift.
   - `doctrine-drift`: Epic truth, artifact authority, change lifecycle, or behavior evidence violates the SDD north star or anti-patterns.
   - `template-drift`: Epic file shape, frontmatter, canonical sections, Story headings, candidate Story handling, or per-Story subsections diverge from the current Epic template without a documented migration reason.
   - `artifact-drift`: Epic/docs are stale but implementation is likely correct.
   - `implementation-drift`: code behavior no longer satisfies Epic truth.
   - `requirement-drift`: a Story is missing Requirements or Scenarios needed to cover its stated capability, implemented behavior, product/docs claims, important modes, or runtime surfaces; or a declared Requirement/Scenario is misplaced, overloaded, too broad, or too narrow.
   - `verification-drift`: evidence is stale, broad, missing, unmapped, no longer proves the Scenario, or `Verified By` is shaped as a chronological command log instead of a scenario-mapped evidence index.
   - `scope-drift`: Story/Requirement/Scenario no longer belongs, is missing, has moved to another Epic, or is too broad/narrow for the Epic or Story.
   - `product-drift`: Epic conflicts with PRD/product direction or current product reality.
   - `security-drift`: security, privacy, auth, data, dependency, or destructive-flow risk is unresolved.
   - `lifecycle-drift`: related change folders, review records, manual confirmation status, changelog state, PR/merge state, deferred gaps, or closed-folder state contradict each other. This includes completed or closed artifacts that still say work is `Not implemented yet`, `Not verified yet`, pending implementation/verification, or use obsolete manual confirmation status vocabulary.
   - `superseded-truth-drift`: later Stories, Requirements, Scenarios, implementation, or docs changed a boundary but earlier Epic truth still reads as current.
8. Write or print the report.
9. In `--propose-fixes`, create a scoped SDD change for findings that require implementation or risky decisions after the report exists.
10. After every non-`--check` run, ask the user whether to apply any safe artifact fixes identified by the audit. Do not apply those fixes until the user explicitly agrees.
11. End with the final self-improvement action.

## Gates

Use `pass`, `findings`, `blocked`, or `not applicable`.

1. SDD Doctrine Adherence
   - The Epic supports the SDD north star: an evidence-backed map from product behavior to implementation files and verification evidence.
   - Epic/Story truth remains the durable answer to "what is actually implemented?" Accepted behavior does not live only in code, chat, stale reports, private memory, README text, generated indexes, or change ledgers.
   - Artifact authority is respected: running behavior and tests reveal reality, Epic files are durable accepted truth, active changes are working records, and PRDs/product docs guide intent without replacing Epic truth.
   - `proposal.md`, `design.md`, `tasks.md`, reviews, release notes, changelogs, and generated indexes do not contradict or outrank the Epic.
   - The audit flags core SDD anti-patterns: creating a new Story to avoid fixing stale truth, hiding product scope expansion inside design or implementation tasks, turning Stories into tiny UI controls, hand-maintaining generated indexes, and closing or promoting work with contradictory Epic/change/review/changelog/manual-confirmation state.
2. Epic Coherence
   - Description, Outcome, Current Scope, Deferred Scope, Cross-Story Concerns, Open Decisions, Notes, and Completion Criteria still match embedded Stories.
   - The Story set is complete enough to fulfill the Epic's stated behavior, product/docs claims, and observable runtime surface. Missing Stories are findings.
   - Story ownership still makes sense for this Epic; MVP/container Epics may need Stories moved into more focused Epics as the product matures.
3. Epic Template Adherence
   - Frontmatter includes the canonical Epic metadata fields when available: `id`, `status`, `created`, `modified`, `last_verified`, and `stories`.
   - The Epic uses the canonical section spine: Product Context, Outcome, Current Scope, Deferred Scope, Candidate Stories, Story Index, Stories, Cross-Story Concerns, Open Decisions, Completion Criteria, and Notes.
   - Candidate Stories remain unlabeled until promoted. Labels are assigned only inside the accepted `Stories` section.
   - Promoted Story headings use `### Story S#` for new or normalized Epics, or a documented legacy app-wide Story ID when existing references depend on it.
   - Each promoted Story follows the canonical subsection shape: Story statement, Requirements And Scenarios, `#### Requirement R#`, `##### Scenario R#-S#`, `Implemented By`, scenario-mapped `Verified By`, `Verification Gaps`, and Story Notes.
   - Older headings such as `Potential Stories`, standalone Acceptance Criteria sections, chronological command logs as Story evidence, or UUID-like Story handles are findings unless explicitly marked as historical migration material.
4. Story Shape
   - Stories are capability-level user outcomes, not tiny UI actions or implementation tasks.
   - Stories normally use `As a <actor>, I want <capability>, so that <outcome>`.
5. Story Requirement Completeness
   - Each Story's Requirements cover the full stated capability, current implementation behavior, relevant UI/API/CLI/runtime surfaces, and product/docs claims.
   - Each Story's Scenarios cover the important happy path plus relevant failure, empty, validation, permission, recovery, migration, and security-sensitive modes.
   - Missing Requirements or Scenarios are findings even when the existing declared Scenarios pass.
   - Requirements and Scenarios are not overloaded catch-alls that hide multiple behaviors, nor tiny implementation tasks that obscure the user path.
   - Do not mark the Story aligned when implemented behavior is broader than the declared Requirements/Scenarios unless the extra behavior is explicitly recorded as a gap, deferred scope, or orphan.
6. Story Reference Traceability
   - Story labels or documented legacy Story IDs are stable.
   - `S#` Story labels are unique within each Epic, full Story references are traceable, and legacy app-wide Story IDs remain unique across active Epics in the app.
   - Story labels or legacy Story IDs survive rename, reorder, and Epic moves unless deliberate renumbering is documented.
   - Requirements use local `R#`.
   - Scenarios use local `R#-S#`.
   - Stale `AC-#` or `TAC-#` labels are mapped to current IDs or marked legacy.
7. Requirement And Scenario Truth
   - Requirements and Scenarios are observable and concrete.
   - Generic Scenarios such as "WHEN this Story's workflow is exercised" are findings.
   - Failure, empty, validation, permission, recovery, and security-sensitive modes are covered where relevant.
8. Implementation Drift
   - `Implemented By` maps point to current files and meaningful roles.
   - Current code behavior satisfies or explicitly defers every in-scope Scenario.
9. Verification Strength
   - `Verified By` evidence is current, concrete, and mapped to Story label/reference plus Requirement/Scenario IDs.
   - Broad gates such as lint, typecheck, build, codegen, or full CI are supporting evidence unless mapped to a named Scenario or behavior assertion.
   - Chronological command history lives in change `tasks.md` ledgers, not as the primary Epic `Verified By` shape.
   - Evidence type is explicit where it matters: focused automated tests, broad supporting gates, deterministic E2E, live-provider playtests, manual UI confirmation, and debug/log inspection are not treated as interchangeable.
   - Tests prove production paths where risk warrants it, not only helper or mock behavior.
   - Stale `AC-#` or `TAC-#` evidence references are mapped to current IDs or marked legacy.
10. Docs And Product Alignment
   - README, ADRs, data docs, current-state docs, PRD, and changelog do not contradict the Epic.
   - Related active and closed SDD changes do not contradict their folder state, review outcome, manual confirmation status, changelog status, PR/merge state, or deferred gaps.
   - Manual confirmation status uses canonical vocabulary: `not applicable`, `pending user`, `user confirmed`, or `accepted gap`.
   - Completed active or closed changes do not retain stale proposal/design/task wording that contradicts accepted Epic truth unless explicitly historical and non-authoritative.
   - Generated Story indexes are treated as optional project-local validation artifacts, not durable source of truth. When a project intentionally maintains them, confirm they are current and do not point to missing evidence paths.
11. Security And Data Safety
   - Auth, permissions, secrets, user data, generated content, migrations, destructive operations, and external services are safe or explicitly out of scope.

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

If a finding requires code, tests, product behavior, or a debatable scope change, leave it in the report and recommend `/sdd-propose`.

## Result Labels

End every report with one result:

- `aligned`
- `changes-requested`
- `needs artifact fix`
- `needs implementation`
- `needs verification`
- `needs product decision`
- `blocked`

Use `aligned` only when all gates pass or remaining issues are explicitly non-blocking.

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

## Final Self-Improvement Action

After completing or stopping this workflow, end the final user response with a concise self-improvement conclusion:

- Ask yourself: "How well did this work, and what could have been improved?"
- Tell the user the conclusion in 1-3 sentences.
- Name any concrete skill, template, doctrine, or process improvement worth considering.
- If no specific improvement is evident, say so plainly.
