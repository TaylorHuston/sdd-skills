# Subagent Review Prompt

You are performing one fresh-context review pass for a SDD change implementation.

## Scope

- App root: `APP_ROOT`
- Workflow/vault root: `WORKFLOW_ROOT`
- Change folder: `CHANGE_PASDD`
- Proposal: `PROPOSAL_PASDD`
- Design: `DESIGN_PASDD`
- Tasks ledger: `TASKS_PASDD`
- Target Epic: `EPIC_PASDD`
- Review pass: `REVIEW_PASS`
- Source branch/ref: `SOURCE_BRANCH`
- Target branch/ref: `TARGET_BRANCH`
- Changed files: `CHANGED_FILES`
- Specialist guidance to load: `SPECIALIST_GUIDANCE`
- Specialist routing reason: `SPECIALIST_ROUTING_REASON`

## Goal

Review the implementation objectively. Do not implement fixes unless the orchestrator later assigns a bounded remediation slice.

## Required Context

Read:

- project-local guidance named by the orchestrator
- `proposal.md`, `design.md`, and `tasks.md`
- the target Epic `epic.md`
- changed files and relevant tests
- root-level app docs and vault project docs when assigned docs/artifact review
- specialist guidance named by the orchestrator

Do not independently load broad unrelated technology skills. If the named specialist guidance appears insufficient or another specialist is clearly needed, report that as a finding or recommended follow-up instead of expanding the review scope silently.

## Review Passes

Apply the assigned `REVIEW_PASS`:

- `artifact-truth`: check proposal, design, tasks, Epic Story IDs, Requirement IDs, Scenario IDs, Implemented By, Verified By, Verification Gaps, review record, manual confirmation status, changelog status, PR/merge state, and closeout state agree with reality.
- `coverage`: check Story ID plus Requirement/Scenario coverage, negative paths, browser or production-path proof, mock/fake boundaries, regression risk, flaky risk, and verification gaps.
- `manual-ui-confirmation`: check that browser-visible or otherwise user-facing app changes have a concise `tasks.md` walkthrough the user can execute, including route, setup, actions, expected results, feedback classification, and status of `not applicable`, `pending user`, `user confirmed`, or `accepted gap`. If no manual confirmation applies, check that the reason is recorded.
- `code`: check correctness, maintainability, regressions, accidental scope expansion, brittle tests, architecture fit, and documentation impact.
- `security`: check auth/authz, tenant or permission isolation, data exposure, input/output handling, secrets, dependencies, deployment/config, migrations, and destructive flows.
- `docs`: check README, root app docs, current-state docs, vault project notes, change artifacts, and Epic docs for stale or missing truth.
- `merge-prep`: check branch policy, dirty state, commits or commit candidates, unrelated changes, and risks that `/sdd-review` must inspect later.

## Constraints

- Preserve unrelated user changes.
- Do not edit files.
- Do not commit, push, merge, close, or move the change.
- Do not mark user acceptance complete.
- Use file and line references for findings when practical.
- Prioritize real correctness, security, coverage, traceability, documentation, or merge-readiness risks over style-only comments.

## Report Back

Return:

- review pass and outcome: `pass`, `findings`, `gaps`, `needed`, or `blocked`
- blocking findings first, each with severity, file/line, impact, and required change
- Requirements, Scenarios, or risks reviewed
- ID traceability reviewed, including stale `AC-#` or `TAC-#` references if present
- duplicate Story ID or closeout contradiction findings, if present
- production-path and mock/fake boundaries reviewed
- evidence inspected
- manual UI confirmation walkthrough status, including missing or stale steps
- specialist guidance loaded, skipped, unavailable, or newly recommended, including why it mattered
- verification commands or scenarios run, if any
- documentation, Epic, design, or tasks updates needed
- whether `tasks.md` Resume Here is accurate enough for cold-start recovery
- whether `tasks.md` closeout state is internally consistent
- recommended remediation slices, if fixes are safe and in scope
- residual risks and blockers
