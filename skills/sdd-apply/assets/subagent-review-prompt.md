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

- `artifact-truth`: check proposal, design, tasks, Epic Story labels/references, Requirement IDs, Scenario IDs, independent implementation/verification state, behavior-mapped Implemented By, Implementation Gaps, scenario-mapped Verified By, Verification Gaps, review record, manual confirmation status, release-communication status, PR/merge state, and closeout state agree with reality. Require one current implementation map and one current verification map per Story; flag competing prior/detailed/legacy maps. Flag `Verified By` sections that are only command logs or unmapped broad gates, and flag proposal/design/tasks text that still says completed work is not implemented, not verified, or pending.
- `cold-navigation`: begin from each changed Requirement and any Scenario with a distinct owner. Confirm the Epic names a concrete repository-relative primary code location, stable symbol or searchable anchor, responsibility, and concrete verification evidence without repository-wide rediscovery. Open the anchor and reject imports, call sites, incidental handlers, broad tokens, or files cited for another symbol as governing ownership. Flag missing paths, missing anchors, undifferentiated file dumps, and maps that stop at UI/tests while hiding application logic.
- `coverage`: check Story label/reference plus Requirement/Scenario coverage, negative paths, browser or production-path proof, mock/fake boundaries, regression risk, flaky risk, scenario-mapped verification evidence, evidence type separation, and verification gaps. Evidence type separation means deterministic E2E, live-provider playtests, manual UI confirmation, broad gates, and debug/log inspection are not treated as interchangeable.
- `evidence-integrity`: treat completion checkboxes, `Verified By` rows, E2E/security/recovery claims, and review-handoff statements as falsifiable. Open the cited tests or runtime evidence; identify the exact test title or stable named anchor and important assertion, route, selector, injected failure, or observation; reject generic framework tokens such as `#it(`; confirm the passing command discovers it; reject Scenario aggregation that the named proof does not exercise; and distinguish server-side enforcement from client-side retry, redirect, timeout, draft, navigation, and recovery behavior.
- `pattern-parity`: for every new adapter, client, route, workspace, worker, migration, command, or other sibling surface in scope, identify the closest current reference and compare applicable auth/session/CSRF, retry, timeout/cancel, error/conflict, recovery, pending-write, identity, route-context, configuration, generated-contract, accessibility, and visual-token behavior. Inspect both implementations and their focused tests. Flag unexplained divergence or copied defects.
- `stateful-transitions`: for editable, autosaving, cached, routed, asynchronous, or identity-sensitive surfaces, challenge applicable entity A-to-B isolation, pending-write navigation, failed/conflicted save recovery, historical return context, browser history, session expiry/sign-out, authoritative refresh, and slow or hung requests. Require direct deterministic or runtime proof rather than static-state screenshots.
- `reverse-traceability`: inspect the changed-surface orphan-audit JSON and classify every relevant source/test candidate as Epic-owned behavior, project-defined support/framework/generated infrastructure, an explicit gap, another Epic's ownership, or tracked cleanup. For refactors, check for stranded routes, registrations, imports, dependencies, tests, migrations, generated bindings, and obsolete files. Inventory output is not deletion approval.
- `manual-ui-confirmation`: check that browser-visible or otherwise user-facing app changes have a concise `tasks.md` walkthrough the user can execute, including route, setup, actions, expected results, feedback classification, and status of `not applicable`, `pending user`, `user confirmed`, or `accepted gap`. If no manual confirmation applies, check that the reason is recorded.
- `rendered-ui-verification`: for UI-bearing changes, render current source with the project's existing browser, screenshot, or preview tooling when available, otherwise use an available runtime browser capability, rendered preview or fixture, or manual browser capture. Exercise changed interactions; directly inspect screenshots or rendered results at representative desktop/mobile viewports and relevant states; check console and network failures; and compare the result with the Visual Verification Matrix. Source review, green builds, non-visual tests, or generated-but-uninspected screenshots cannot pass this review. Report an exact gap when rendering is unavailable.
- `code`: check correctness, maintainability, regressions, accidental scope expansion, brittle tests, architecture fit, and documentation impact.
- `security`: check auth/authz, tenant or permission isolation, data exposure, input/output handling, secrets, dependencies, deployment/config, migrations, and destructive flows.
- `docs`: check the project-defined truth-bearing supporting-doc set, README, changed docs, current-state docs, planning notes, change artifacts, and Epic docs for stale or missing truth. When no supporting-doc inventory is declared, report what was inferred from the changed surface.
- `risk-closure`: challenge the living risk matrix against the actual diff and behavior under four lenses: state transitions and recovery; authority, isolation, and untrusted publication; existing-data migration and rollback; and decision fan-out across runtime defaults, config/examples, generated contracts, tests, and docs. Flag risks discovered by implementation but absent from the ledger, weak evidence, unresolved fan-out, and safety refusals misreported as functional proof.
- `merge-prep`: check branch policy, exact source commit and target/merge base, whether the candidate differs from target, whether all intended implementation is committed, unrelated dirty state, required verification environments, commit-sensitive/generated-contract checks, and risks that `/sdd-review` must inspect later.

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
- exact tests or stable anchors and important assertions/observations inspected for high-risk claims
- sibling references, parity concerns, and intentional divergences inspected when applicable
- stateful transition edges inspected when applicable
- manual UI confirmation walkthrough status, including missing or stale steps
- rendered UI verification result, surfaces/viewports/states/interactions directly inspected, console/network outcome, and Visual Verification Matrix gaps
- selected skill guidance that materially changed the review, including the concrete consequence
- verification commands or scenarios run, if any
- documentation, Epic, design, or tasks updates needed
- whether `tasks.md` Resume Here is accurate enough for cold-start recovery
- whether `tasks.md` closeout state is internally consistent
- whether the risk matrix, Pattern Parity Matrix, Stateful Transition Matrix, decision fan-out ledger, verification-environment record, evidence claims, and immutable review-handoff candidate match the actual implementation and evidence
- whether related proposal/design/tasks/review artifacts use the same manual confirmation status vocabulary and no longer contain stale implementation-pending text
- recommended remediation slices, if fixes are safe and in scope
- residual risks and blockers
