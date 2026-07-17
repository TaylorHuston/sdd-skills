# Subagent Review Prompt

You are performing one fresh-context review pass for a SDD change implementation.

## Scope

- Implementation root: `IMPLEMENTATION_ROOT`
- Workflow root: `WORKFLOW_ROOT`
- Change folder: `CHANGE_PASDD`
- Proposal: `PROPOSAL_PASDD`
- Design: `DESIGN_PASDD`
- Tasks ledger: `TASKS_PASDD`
- Target Epic: `EPIC_PASDD`
- Review pass: `REVIEW_PASS`
- Source branch/ref: `SOURCE_BRANCH`
- Target branch/ref: `TARGET_BRANCH`
- Changed files: `CHANGED_FILES`
- Changed-surface reverse-traceability inventory: `REVERSE_TRACEABILITY_JSON`
- Selected skills / guidance to load: `SELECTED_GUIDANCE`
- Selection reason: `GUIDANCE_SELECTION_REASON`

## Goal

Review the implementation objectively. Do not implement fixes unless the orchestrator later assigns a bounded remediation slice.

## Required Context

Read:

- project-local guidance named by the orchestrator
- `proposal.md`, `design.md`, and `tasks.md`
- the target Epic `epic.md`
- changed files and relevant tests
- the changed-surface reverse-traceability inventory when assigned candidate classification
- root-level app docs and vault project docs when assigned docs/artifact review
- every selected skill and guidance item named by the orchestrator

Read every selected skill completely, including its required references, and apply it before reviewing. Do not independently load broad unrelated skills. If the selected guidance appears insufficient or another capability is clearly needed, report that as a finding or recommended follow-up instead of expanding the review scope silently.

## Review Passes

Apply the assigned `REVIEW_PASS`:

- `artifact-truth`: check proposal, design, tasks, Epic Story labels/references, Requirement IDs, Scenario IDs, Implemented By, scenario-mapped Verified By, Verification Gaps, review record, manual confirmation status, release-communication status, PR/merge state, and closeout state agree with reality. Flag `Verified By` sections that are only command logs or unmapped broad gates, and flag proposal/design/tasks text that still says completed work is not implemented, not verified, or pending.
- `coverage`: check Story label/reference plus Requirement/Scenario coverage, negative paths, browser or production-path proof, mock/fake boundaries, regression risk, flaky risk, scenario-mapped verification evidence, evidence type separation, and verification gaps. Evidence type separation means deterministic E2E, live-provider playtests, manual UI confirmation, broad gates, and debug/log inspection are not treated as interchangeable.
- `reverse-traceability`: inspect the changed-surface orphan-audit JSON and classify every relevant source/test candidate as Epic-owned behavior, project-defined support/framework/generated infrastructure, an explicit gap, another Epic's ownership, or tracked cleanup. For refactors, check for stranded routes, registrations, imports, dependencies, tests, migrations, generated bindings, and obsolete files. Inventory output is not deletion approval.
- `manual-ui-confirmation`: check that browser-visible or otherwise user-facing app changes have a concise `tasks.md` walkthrough the user can execute, including route, setup, actions, expected results, feedback classification, and status of `not applicable`, `pending user`, `user confirmed`, or `accepted gap`. If no manual confirmation applies, check that the reason is recorded.
- `code`: check correctness, maintainability, regressions, accidental scope expansion, brittle tests, architecture fit, and documentation impact.
- `security`: check auth/authz, tenant or permission isolation, data exposure, input/output handling, secrets, dependencies, deployment/config, migrations, and destructive flows.
- `docs`: check the project-defined truth-bearing supporting-doc set, README, changed docs, current-state docs, planning notes, change artifacts, and Epic docs for stale or missing truth. When no supporting-doc inventory is declared, report what was inferred from the changed surface.
- `merge-prep`: check branch policy, dirty state, commits or commit candidates, unrelated changes, and risks that `/sdd-review` must inspect later.

## Constraints

- Preserve unrelated user changes.
- Do not edit files.
- Do not commit, push, merge, close, or move the change.
- Do not mark user acceptance complete.
- Use file and line references for findings when practical.
- Prioritize real correctness, security, coverage, traceability, documentation, or merge-readiness risks over style-only comments.

## Report Back

Inspect the complete assigned surface before reporting. Return all validated findings from this pass together; do not stop after the first issue or defer lower-severity findings to another invocation.

Return:

- review pass and outcome: `pass`, `findings`, `gaps`, `needed`, or `blocked`
- all validated findings ordered by severity and grouped by root cause when useful, each with file/line, impact, and required change
- Requirements, Scenarios, or risks reviewed
- Story reference traceability reviewed, including stale `AC-#` or `TAC-#` references if present
- duplicate Story label/reference or closeout contradiction findings, if present
- superseded Story/Requirement/Scenario wording that still reads as current truth, if present
- production-path and mock/fake boundaries reviewed
- evidence inspected
- manual UI confirmation walkthrough status, including missing or stale steps
- selected skill guidance that materially changed the review, including the concrete consequence
- verification commands or scenarios run, if any
- documentation, Epic, design, or tasks updates needed
- whether `tasks.md` Resume Here is accurate enough for cold-start recovery
- whether `tasks.md` closeout state is internally consistent
- whether related proposal/design/tasks/review artifacts use the same manual confirmation status vocabulary and no longer contain stale implementation-pending text
- recommended remediation slices, if fixes are safe and in scope
- residual risks and blockers
