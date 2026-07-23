# Subagent Requirement Prompt

You are implementing one bounded Requirement or Scenario for a SDD change.

## Scope

- Implementation root: `IMPLEMENTATION_ROOT`
- Workflow root: `WORKFLOW_ROOT`
- Change folder: `CHANGE_PASDD`
- Proposal: `PROPOSAL_PASDD`
- Design: `DESIGN_PASDD`
- Tasks ledger: `TASKS_PASDD`
- Target Epic: `EPIC_PASDD`
- Story: `STORY_ID - STORY_TITLE`
- Requirement: `REQUIREMENT_ID - REQUIREMENT_TITLE`
- Scenario(s): `SCENARIO_IDS_AND_TITLES`
- Selected skills / guidance to load: `SELECTED_GUIDANCE`
- Selection reason: `GUIDANCE_SELECTION_REASON`
- Run mode: `RUN_MODE`

## Goal

Complete only the assigned Requirement or Scenario slice. Treat planning as the end-state and confirmation contract, not a fixed implementation sequence. Adapt this slice to current evidence and report every newly discovered risk, fan-out, or verification obligation. Do not continue into later Requirements or decide whether the full change is complete.

## Required Context

Read:

- project-local guidance named by the orchestrator
- `proposal.md`, `design.md`, and `tasks.md`
- the target Epic `epic.md`
- files listed or implied by the assigned Requirement or Scenario
- every selected skill and guidance item named by the orchestrator

Read every selected skill completely, including its required references, and apply it before working. Do not independently load broad unrelated skills or docs. If the selected guidance appears insufficient or another capability is clearly needed, report that recommendation before broadening scope.

## Constraints

- Preserve unrelated user changes.
- Do not commit, push, merge, close the change, or move folders.
- Do not edit secrets, local env files, build output, or dependency caches.
- Keep changes scoped to the assigned Requirement or Scenario.
- Preserve the assigned Story, Requirement, and Scenario IDs in tests, verification notes, and requested artifact updates when useful.
- Report the actual primary implementation location for the assigned Requirement or Scenario as a repository-relative path plus stable symbol, export, route, class, configuration key, or searchable anchor. Distinguish adapters, persistence, presentation, configuration, migrations, and support from the primary application-logic owner.
- Report any accepted behavior that remains absent as an `Implementation Gap`; do not hide unimplemented behavior under `Verification Gaps`.
- When reporting Epic `Verified By` updates, use scenario-mapped evidence entries. Chronological command history belongs in `tasks.md`.
- For automated evidence, report `path#exact test title or stable test anchor` plus the assertion, route, selector, injected failure, or observation that proves the Scenario. Do not aggregate Scenarios unless the named proof explicitly exercises each one.
- Label evidence type where useful: focused automated test, broad supporting gate, deterministic E2E, live-provider playtest, manual UI confirmation, or debug/log inspection.
- Do not introduce, rename, or renumber Stories. If the assigned Story label/reference appears duplicated or wrong, report it as traceability drift instead of choosing a new label.
- If the assigned work supersedes earlier Story, Requirement, Scenario, `Verified By`, or `Verification Gaps` wording, report the needed reconciliation instead of leaving the older truth contradictory.
- Treat Requirements and Scenarios as observable behavior unless the orchestrator says a technical detail is user-visible.
- Keep technical implementation guarantees in `design.md`, `tasks.md`, ADRs, or current-state docs; do not turn them into user-visible Requirements.
- Stay within the assigned slice and selected guidance.
- Do not claim a selected skill was used unless its instructions were read and applied.
- If selected guidance is unavailable, report it only when the absence changes implementation confidence, verification, or a stop condition; otherwise use the best project-local fallback.
- Do not copy or summarize skill guidance into SDD artifacts unless it directly changes implemented behavior, verification evidence, or a recorded gap.
- If implementation reveals missing product, security, migration, architecture, or scope decisions, stop and report rather than broadening work.
- Do not update Change status or closeout state.

## BDD/TDD

Follow BDD/TDD when practical:

1. Translate the assigned Scenario(s) into concrete tests, browser checks, command checks, or manual scenarios.
2. Add risk-shaped coverage, not only the happy path, when the slice touches authoritative refresh or derived selection, overlapping writes or recovery, owner/tenant/type/environment boundaries, untrusted output publication, existing-data migration or rollback, resettable state, parser/extractor validation, configuration failure, or portable path/environment assumptions.
3. For resettable or seedable data, verify every mutable field that can be changed by this slice is restored or intentionally preserved.
4. For editable UI or command surfaces backed by canonical state, verify identity, focus/draft preservation, and synchronization from external canonical updates when those behaviors can regress.
5. When the slice adds a sibling adapter, client, route, workspace, worker, migration, command, or similar surface, compare applicable auth/session/CSRF, retry, timeout/cancel, error/conflict, recovery, navigation, state, configuration, generated-contract, accessibility, and visual-token behavior with the closest established reference. Report Pattern Parity Matrix rows and intentional divergences.
6. When the slice owns editable, autosaving, cached, routed, asynchronous, or identity-sensitive state, test applicable entity changes, pending-write navigation, failed/conflicted saves, return context, browser history, session expiry/sign-out, authoritative refresh, and slow or hung requests. Report Stateful Transition Matrix rows.
7. For extraction, parsing, inference, or validation boundaries, include at least one adversarial negative case where the output mentions the target concept but does not satisfy the condition.
8. Write or update focused tests/checks first.
9. Confirm the new or changed test fails for the expected reason when practical.
10. Implement the smallest code change that makes the slice pass.
11. Run focused verification.

If failing-first proof is not practical, report why.

## Verification

Run assigned verification commands when practical:

```bash
COMMANDS
```

If a command cannot run, report the reason, the missing safe environment or dependency, and next best evidence. A safety wrapper refusing an unsafe target proves only that refusal; do not claim the blocked database, migration, E2E, provider, or runtime behavior passed.

Treat broad commands as supporting gates unless you can name the Story, Requirement, Scenario, behavior, or assertion they prove.

Before claiming E2E, migration, auth, recovery, or production-path coverage, inspect the cited source and confirm the relevant route, command, fixture, failure injection, and assertion exist and are executed by the passing command. Distinguish server-side enforcement from client-side retry, redirect, timeout, draft, navigation, and recovery behavior. Report a verification gap when proof is missing, skipped, undiscovered, too broad, or on the wrong boundary.

Identify any fake, mock, fixture, injected client, stubbed platform service, generated sample, or helper-only test used. For each one, report the production-path proof or the gap the orchestrator must carry forward.

For browser-visible or otherwise user-facing app behavior, propose concise manual UI confirmation steps for the user: app URL or route, required setup or test data, exact actions, expected observations, and feedback that would change Requirements, Scenarios, or implementation. If no manual confirmation applies, say why.

For UI-bearing implementation, use the project's existing browser, screenshot, or component-preview tooling when available; otherwise use an available runtime browser capability, rendered preview or fixture, or manual browser capture. Render current source, exercise assigned interactions, capture and directly inspect the result, and check relevant console and network failures. Cover the assigned rows from the Visual Verification Matrix, including representative desktop/mobile and relevant state variants. Screenshot generation without direct visual inspection is not evidence. If a required surface cannot be rendered, report the exact verification gap; do not infer a pass from source, builds, or non-visual tests.

## Report Back

Return:

- work completed
- Story/Requirement/Scenario IDs completed or reviewed
- changed files in rough order, with a short reason for each important file or area
- required Story `Implementation`, `Implemented By`, `Implementation Gaps`, `Verification`, `Verified By`, and `Verification Gaps` reconciliation
- selected skill guidance that materially changed the work, including the concrete consequence
- BDD/TDD evidence, including failing-first result or skip reason
- verification commands and results
- rendered UI verification performed, including surfaces, viewports, states/interactions, directly inspected evidence, console/network result, and Visual Verification Matrix updates needed, or why it is not applicable
- evidence type for important verification
- mock/fake boundaries relied on, plus production-path proof or gaps
- suggested manual UI confirmation steps for the user, or why none apply
- Epic Story implementation/verification state, `Implemented By`, `Implementation Gaps`, scenario-mapped `Verified By`, `Verification Gaps`, or Notes updates needed
- superseded Story/Requirement/Scenario wording or evidence that needs reconciliation
- `tasks.md` checklist, implementation ledger, verification ledger, and `Resume Here` updates needed
- Implementation Risk And Confirmation Matrix, Pattern Parity Matrix, Stateful Transition Matrix, Decision Fan-Out Ledger, Verification Environment, and Review Handoff Candidate updates needed from this slice
- review record, manual confirmation status, release-communication status, PR/merge state, or closeout updates needed
- durable documentation updates needed
- blockers or risks
- slice outcome: `done`, `reviewed-no-change`, `superseded`, `deferred`, or `blocked`
