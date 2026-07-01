---
name: sdd-epic-verify
description: Audit a SDD Epic end to end against current implementation reality with subagent delegation, systematic Requirement/Scenario testing, Epic coherence review, duplicate Story ID detection, lifecycle and evidence drift detection, and an Epic-local verification report. Use when the user invokes /sdd-epic-verify, asks whether an Epic is still accurate, asks to detect implementation drift across an Epic, asks to test every Story/Requirement/Scenario in an Epic, or wants to know what needs a SDD change, artifact fix, verification pass, or PRD update before continuing.
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

Use `assets/epic-verify-report-template.md`. Create `reviews/` only when writing a report.

The report is the durable audit record. Findings are addressed through the workflow named in the report:

- `artifact-only`: after reporting, ask the user whether to apply the listed safe artifact fixes in the same thread.
- `needs-change`: run `/sdd-propose` or `/sdd-epic-verify --propose-fixes`, then `/sdd-apply`, then `/sdd-review`.
- `needs-verification`: add or run the missing checks through a SDD change unless no source files need to change.
- `needs-prd`: run `/sdd-prd` before changing Epic scope.
- `blocked`: ask the user for the named decision.

## Required Context

Before auditing, read:

- app/workspace `AGENTS.md`, especially branch policy and test commands
- `developer-guide.md` from the vault root when available
- target `docs/epics/<key>-<###>-epic-name>/epic.md`
- relevant `docs/changes/**/proposal.md`, `design.md`, `tasks.md`, and `review.md` when they mention the Epic or its Story IDs
- enough of every active `docs/epics/*/epic.md` to detect duplicate Story IDs across the app
- project planning docs or PRD/Product Brief files when product direction exists or drift is suspected
- README, testing docs, architecture docs, ADRs, data-model docs, current-state docs, and root `CHANGELOG.md` when they claim behavior owned by the Epic
- source files, tests, configs, generated artifacts, and runtime surfaces listed in Story `Implemented By` and `Verified By`

Check git status in every repo that may be inspected or touched. Preserve unrelated dirty files. In default mode, do not stage or commit.

## Operating Sequence

1. Select the Epic.
   - Prefer an explicit Epic path or ID.
   - Otherwise list `docs/epics/*/epic.md` and ask only if selection is ambiguous.
2. Parse the Epic.
   - Identify Epic ID, current status, Story IDs, Story titles, Requirements, Scenarios, `Implemented By`, `Verified By`, and `Verification Gaps`.
   - Confirm Story IDs are stable, Requirements use local `R#`, and Scenarios use local `R#-S#`.
   - Confirm Story IDs are unique across active app Epics unless a temporary migration duplicate is explicitly documented as blocking further implementation.
3. Build a verification matrix.
   - One row per Scenario, with Story ID, Requirement ID, Scenario ID, claimed implementation files, claimed verification, current status, and planned check.
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
   - `artifact-drift`: Epic/docs are stale but implementation is likely correct.
   - `implementation-drift`: code behavior no longer satisfies Epic truth.
   - `verification-drift`: evidence is stale, broad, missing, or no longer proves the Scenario.
   - `scope-drift`: Story/Requirement/Scenario no longer belongs, is missing, has moved to another Epic, or is too broad/narrow.
   - `product-drift`: Epic conflicts with PRD/product direction or current product reality.
   - `security-drift`: security, privacy, auth, data, dependency, or destructive-flow risk is unresolved.
   - `lifecycle-drift`: related change folders, review records, manual confirmation status, changelog state, PR/merge state, deferred gaps, or closed-folder state contradict each other.
8. Write or print the report.
9. In `--propose-fixes`, create a scoped SDD change for findings that require implementation or risky decisions after the report exists.
10. After every non-`--check` run, ask the user whether to apply any safe artifact fixes identified by the audit. Do not apply those fixes until the user explicitly agrees.
11. End with the final self-improvement action.

## Gates

Use `pass`, `findings`, `blocked`, or `not applicable`.

1. Epic Coherence
   - Description, Outcome, Current Scope, Deferred Scope, Cross-Story Concerns, Open Decisions, Notes, and Completion Criteria still match embedded Stories.
   - Story ownership still makes sense for this Epic; MVP/container Epics may need Stories moved into more focused Epics as the product matures.
2. Story Shape
   - Stories are capability-level user outcomes, not tiny UI actions or implementation tasks.
   - Stories normally use `As a <actor>, I want <capability>, so that <outcome>`.
3. ID Traceability
   - Story IDs are stable.
   - Story IDs are unique across active Epics in the app.
   - Story IDs survive rename, reorder, and Epic moves unless deliberate renumbering is documented.
   - Requirements use local `R#`.
   - Scenarios use local `R#-S#`.
   - Stale `AC-#` or `TAC-#` labels are mapped to current IDs or marked legacy.
4. Requirement And Scenario Truth
   - Requirements and Scenarios are observable and concrete.
   - Generic Scenarios such as "WHEN this Story's workflow is exercised" are findings.
   - Failure, empty, validation, permission, recovery, and security-sensitive modes are covered where relevant.
5. Implementation Drift
   - `Implemented By` maps point to current files and meaningful roles.
   - Current code behavior satisfies or explicitly defers every in-scope Scenario.
6. Verification Strength
   - `Verified By` evidence is current, concrete, and mapped to Story/Requirement/Scenario IDs.
   - Tests prove production paths where risk warrants it, not only helper or mock behavior.
   - Stale `AC-#` or `TAC-#` evidence references are mapped to current IDs or marked legacy.
7. Docs And Product Alignment
   - README, ADRs, data docs, current-state docs, PRD, and changelog do not contradict the Epic.
   - Related active and closed SDD changes do not contradict their folder state, review outcome, manual confirmation status, changelog status, PR/merge state, or deferred gaps.
   - Generated Story indexes are treated as optional project-local validation artifacts, not durable source of truth. When a project intentionally maintains them, confirm they are current and do not point to missing evidence paths.
8. Security And Data Safety
   - Auth, permissions, secrets, user data, generated content, migrations, destructive operations, and external services are safe or explicitly out of scope.

## Finding Severity

- `BLOCKING`: Epic truth is misleading enough to block implementation, review, acceptance, or release.
- `REQUIRED`: should be fixed before relying on the Epic for future work.
- `SUGGESTION`: improves clarity or maintainability but does not block use.

Every finding should include:

- severity
- drift type
- Story/Requirement/Scenario ID when applicable
- file/path reference
- impact
- recommended workflow to address it

## Post-Run Artifact Fixes

After reporting, ask the user whether to apply safe artifact fixes when the audit found unambiguous documentation or workflow drift. If the user agrees, the same thread may edit:

- Epic wording, status, notes, Story ordering, ID labels, Requirement/Scenario labels, `Verification Gaps`, and stale evidence notes
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
