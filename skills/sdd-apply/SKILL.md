---
name: sdd-apply
description: Apply or continue a SDD change from an active docs/changes/yyyy-mm-dd-change-name folder with one main orchestrating agent coordinating subagents in isolated contexts for non-trivial Requirement-driven BDD/TDD implementation, focused discovery, specialist-guided implementation, verification, fresh-context review slices, and manual UI confirmation walkthroughs for the user. Reads proposal.md, design.md, and tasks.md, updates Epic directories and application code, keeps tasks.md as the resume and implementation ledger, reconciles Story-level Implemented By, Verified By, Verification Gaps, manual confirmation status, changelog status, and closeout readiness, validates subagent claims before commits, runs final review, and stops for ambiguity or unsafe changes. Use when the user invokes /sdd-apply, asks to apply, implement, continue, review-only, delegate implementation, use specialist technology guidance, walk through UI confirmation, or close a SDD change.
---

# SDD Apply

Apply a SDD change from its change folder. This is the implementation-side companion to `/sdd-propose`: `proposal.md` defines scope, `design.md` defines the high-level technical approach and Epic changes, and `tasks.md` is the adaptive implementation ledger and cold-resume surface.

Do not create a separate implementation record, Story approach report, Epic approach report, or CLI state. Fold those responsibilities into the existing change artifacts.

Use `/sdd-interactive` instead when no suitable change folder exists yet and the user wants a lightweight tracked working session that creates the change artifacts and immediately applies small edits.

Default to an orchestrator-and-subagents model. The main agent owns change selection, artifact truth, branch/git safety, phase selection, subagent scoping, validation of child claims, `tasks.md`, Epic reconciliation, commits, stop conditions, and user-facing decisions. Delegate non-trivial implementation, discovery, verification, and review slices to subagents when the tooling is available and safe.

Use `references/specialist-routing.md` during specialist checkpoints. Keep technology guidance canonical in the specialist skills; do not copy stack-specific rules into this skill except for routing criteria.

Use `assets/changelog-template.md` when a release-relevant change needs a root `CHANGELOG.md` and the application does not have one yet.

## Inputs And Modes

Start from an explicit change folder, change name, or active change inferred from the conversation.

Supported modes:

- Default: implement all safe remaining tasks, update artifacts as reality changes, make local commits when authorized, and stop only for defined stop conditions.
- `--step`: run Discovery or one coherent slice, report, and ask before continuing.
- `--no-commit`: keep changes commit-shaped and record commit candidates instead of committing.
- `--review-only`: skip new implementation slices and run final review against current implementation and artifacts.
- `--no-delegate`: use the main thread only. Use when subagent tooling is unavailable, the slice is tiny, or isolation would create more risk than value.
- `--max-review-iterations N`: cap hands-off remediation attempts; default to `3`.

Default and explicit full mode authorize local commits for completed, verified slices. They do not authorize push, merge, deploy, rebase, destructive data changes, deleting branches, touching credentials, or marking user acceptance complete.

Closeout is not a special correctness mode. Always maintain closeout readiness as normal workflow truth. Move a change to `docs/changes/closed/` only when the user asks to close, finish, merge-and-close, or otherwise complete it, and only after implementation completion plus a completed `/sdd-review` or an explicit user override that review is not needed.

## Select The Change

Use the explicit path or name if provided. Otherwise:

1. Infer from conversation context when a change was just discussed.
2. List active folders under `docs/changes/`, excluding `docs/changes/closed/`.
3. If no canonical active change is found, inspect legacy `changes/`, excluding `changes/closed/`, only to continue pre-migration work. Announce that the selected folder is legacy and recommend moving it to `docs/changes/` before new work.
4. Auto-select only when exactly one active change exists.
5. Ask the user when multiple active changes match or no change can be inferred.

Always announce the selected change and how to override it.

## Required Context

Before editing, read:

- `docs/changes/yyyy-mm-dd-change-name/proposal.md`
- `docs/changes/yyyy-mm-dd-change-name/design.md`
- `docs/changes/yyyy-mm-dd-change-name/tasks.md`
- root `CHANGELOG.md` when `proposal.md` says changelog impact is required or TBD, or when implementation proves the change is user-facing, release-relevant, security-relevant, migration-relevant, operationally notable, or public documentation-worthy
- relevant `AGENTS.md`, README, PRD/Product Brief, and project-local branch policy
- target Epic files under `docs/epics/*/epic.md`
- enough of every active `docs/epics/*/epic.md` to detect duplicate Story IDs across the app
- code, tests, docs, and generated artifacts named by `design.md`, `tasks.md`, or current implementation reality
- routes, commands, seed data, test accounts, browser setup, screenshots, or local dev URLs needed to give the user a useful manual UI confirmation walkthrough when the change is user-facing

If the selected change is in legacy `changes/`, keep using that explicit path for the current run unless the user asks to migrate it. Do not create a second active copy silently.

Check git status in every repo that may change. Preserve unrelated dirty files. If the change touches an app repo under or beside the vault, read that repo's local guidance before editing.

## Discovery

Start every run with Discovery, even when resuming.

Check that:

- `proposal.md`, `design.md`, and `tasks.md` agree about the change scope.
- `design.md` identifies whether the change creates new Epic directories, edits existing Epic directories, or both.
- each targeted Epic path follows `docs/epics/key-###-epic-name/epic.md`.
- Stories stay embedded in Epic `epic.md` files; do not create `docs/stories/`.
- Epics and Stories are durable but revisable truth; proposed Story moves, splits, merges, renames, and reorders are explicit Epic changes, not accidental implementation cleanup.
- each Story has a stable Story ID, local Requirement IDs, local Scenario IDs, `Implemented By`, `Verified By`, and `Verification Gaps`.
- Story IDs are unique across active app Epics unless a temporary migration duplicate is explicitly documented as blocking further implementation.
- Requirements and Scenarios describe observable behavior unless a technical detail is itself user-visible.
- Scenarios are concrete enough to drive tests or manual checks. Do not proceed with generic Scenarios such as "WHEN this Story's workflow is exercised"; patch the artifact or stop for scope clarification.
- the technical approach is sufficient for the next implementation slice.
- `tasks.md` has a usable `Resume Here`, Requirement/Scenario checklist, implementation ledger, verification ledger, blockers/open questions, and closeout area.
- the current branch and dirty state allow safe edits.
- stale or already-implemented behavior cannot satisfy the new Requirements by accident.
- tests and verification plans can prove the production path, not only helper or mock behavior.

Update `tasks.md` after Discovery with current state, branch/ref, expected dirty files, last passing checks, blockers, and the next intended action.

Stop before code edits if the change artifacts are missing, contradictory, too ambiguous for the next slice, or require a product/scope decision. If the issue is a small artifact repair and the user has asked to apply the change, patch the artifact and continue.

If implementation reveals meaningful product drift from project planning docs or a PRD/Product Brief, stop or record the drift and recommend `/sdd-prd` unless the user has explicitly authorized updating product direction in the same run.

## Manual Feedback Loop

Treat the user's manual testing feedback after an initial `/sdd-apply` run as continuation input for the same active change unless the user explicitly asks for a new change.

Before acting on feedback:

1. Record the feedback in `tasks.md`.
   - Create a `Manual Feedback` section if the task ledger does not already have one.
   - Add it to blockers/open questions, the implementation ledger, or the verification ledger depending on its shape.
   - Update `Resume Here` with the current manual feedback state and next action.
2. Classify the feedback.
   - `defect`: implemented behavior fails an existing Requirement or Scenario.
   - `verification gap`: behavior may work, but evidence is missing, stale, too broad, or too mock-bound.
   - `artifact drift`: Epic, design, tasks, docs, or changelog no longer describe reality.
   - `requirement refinement`: feedback changes wording, edge cases, or acceptance expectations while staying inside the proposal.
   - `planning discovery`: implementation or feedback reveals a new or meaningfully changed Requirement, Scenario, constraint, or Epic ownership question that needs design work before more code changes.
   - `scope expansion`: feedback adds new user-visible behavior, product scope, data/auth/API semantics, Epic ownership, or release expectations beyond the proposal.
   - `product drift`: feedback changes product direction or contradicts the PRD/Product Brief.
3. Choose the action.
   - For `defect`, add or update the relevant Scenario/test, fix the implementation, verify, and update `tasks.md` plus Story `Verified By` or `Verification Gaps`.
   - For `verification gap`, run or add the missing proof before claiming completion.
   - For `artifact drift`, update the stale artifact and record the reconciliation in `tasks.md`.
   - For small `requirement refinement`, update `design.md` and the target Epic Story Requirement/Scenario IDs before implementation, then add matching `tasks.md` checklist entries.
   - For `planning discovery`, stop implementation and recommend `/sdd-propose --replan` against the active change. Resume with a fresh `/sdd-apply` only after `proposal.md`, `design.md`, and `tasks.md` are updated.
   - For `scope expansion`, stop unless the user explicitly accepts expanding this change. If accepted and the expansion needs planning, route to `/sdd-propose --replan`; otherwise update `proposal.md`, `design.md`, Epic truth, and `tasks.md`. If not accepted, recommend `/sdd-propose` for a follow-up change.
   - For `product drift`, stop or recommend `/sdd-prd` unless the user explicitly authorizes product-direction updates in the same run.

When feedback changes a Requirement or Scenario, preserve the stable Story ID and local Requirement/Scenario ID when the behavior is an edit to existing truth. Add a new `R#` or `R#-S#` only when it is a genuinely new behavior rule or scenario. Do not silently renumber completed Requirements or Scenarios just to keep labels tidy.

When feedback or implementation reveals that a Story belongs in a different Epic, treat it as Epic ownership change. Preserve the Story ID unless the user explicitly accepts renumbering, update both source and destination Epic truth, and record the move in `tasks.md`; if the move was not in the proposal, stop or require explicit scope acceptance before applying it.

Manual feedback is not `/sdd-review` by default. Create or update `review.md` only when the feedback is explicitly a review finding or comes from `/sdd-review`; otherwise keep the active record in `tasks.md` and the durable truth in `design.md` plus the Epic. When the feedback becomes planning-level discovery, let `/sdd-propose --replan` revise the planning artifacts before implementation resumes.

## Phase Boundary

Use Requirements as the default implementation phase boundary.

A phase is the smallest committable slice that completes one Requirement, or a coherent subset of that Requirement's Scenarios, with verification evidence and artifact updates.

Prefer this order:

1. One Requirement per phase.
2. One or more Scenarios from a Requirement when the full Requirement is too large for one clean commit.
3. A short enabling phase only when setup is required before a Requirement can be tested or implemented.

Do not let enabling phases become vague infrastructure work. Tie them to the next Requirement, record why they are necessary in `tasks.md`, and return to Requirement/Scenario slices immediately afterward.

## Delegation Model

Use subagents heavily, but keep the main agent as orchestrator.

Prefer delegation for:

- codebase discovery over a broad or unfamiliar surface
- BDD/TDD test design for a Requirement or Scenario
- one bounded Requirement/Scenario implementation phase
- focused verification, especially browser, integration, or production-path checks
- fresh-context review of coverage, code quality, security, docs, or artifact reconciliation

Use the main thread directly when:

- the slice is tiny
- user interaction is required
- a subagent would need broad undefined scope
- tool/session constraints make edits unsafe
- `--no-delegate` is active

Parallelize read-only discovery and review subagents when their scopes do not overlap. Serialize implementation subagents unless the slices touch clearly independent files and the tool environment can isolate or merge their work safely.

Before each delegated phase or review pass, run a specialist checkpoint:

1. Inspect the selected Story ID, Requirement ID, Scenario ID(s), touched files, package/config files, project guidance, and risk surface.
2. Read `references/specialist-routing.md` when technology, platform, security, UX, architecture, migration, or verification guidance may materially affect the slice.
3. Select only specialist skills or subagent roles that can materially affect implementation, testing, security, migration, UX, performance, backend behavior, or architecture.
4. Prefer router skills when the exact specialist skill is unclear.
5. Record subagents used, specialist guidance loaded, skipped guidance, unavailable guidance, and concrete consequences in `tasks.md`.
6. Treat new migration, security, product-risk, deployment, external-service, or data-risk requirements as stop conditions unless the user already authorized them.

Do not load every matching skill, copy specialist skill bodies into this skill, or spawn broad generic agents. Each subagent gets one bounded job.

Every delegated implementation prompt must include:

- app root and workflow/vault root
- change folder and `proposal.md`, `design.md`, `tasks.md` paths
- target Epic path and the exact Story ID, Requirement ID, and Scenario ID scope
- relevant technical approach, constraints, and stop conditions
- named specialist guidance to load
- the reason each specialist skill or guidance item applies to this slice
- expected files or surfaces to inspect
- allowed toolsets and edit permissions
- explicit instruction not to commit, push, merge, close, or update lifecycle state
- BDD/TDD expectation, including failing-first proof when practical
- verification commands or browser/manual checks to run
- required report shape

Use `assets/subagent-requirement-prompt.md` for delegated implementation slices and `assets/subagent-review-prompt.md` for delegated review passes when structured prompts help.

The orchestrator must verify important subagent claims before committing or updating durable truth:

- inspect file diffs and git status
- read changed files
- rerun focused tests or commands when practical
- confirm `Implemented By`, `Verified By`, and `Verification Gaps` updates are accurate
- reject or stop on subagent output that is too broad, unsafe, stale, or unsupported

## Apply Loop

Implement one coherent behavior or capability slice at a time.

1. Apply Epic artifact work first when needed.
   - Create or update `docs/epics/key-###-epic-name/epic.md`.
   - Keep Stories embedded in the Epic.
   - Preserve room for future supporting artifacts beside `epic.md`, but do not create extra folders unless needed.
2. Select the next pending Requirement or Scenario from `tasks.md` and `design.md`.
   - Prefer Requirement-shaped phases.
   - Split by Scenario when a Requirement is too large, has distinct failure modes, or crosses separate technical surfaces.
   - Use file-shaped work only as an enabling phase tied to the next Requirement.
   - Use the stable labels in reports and commits: `STORY-ID R1`, `STORY-ID R1-S1`, and so on.
   - If the next slice came from manual feedback, confirm `tasks.md`, `design.md`, and the target Epic reflect the feedback classification before editing code.
3. Delegate the selected Requirement or Scenario when it is non-trivial and delegation is available.
   - Scope the subagent with `assets/subagent-requirement-prompt.md`.
   - Allow edits only for the assigned slice.
   - Require the subagent to report needed artifact updates instead of making lifecycle or closeout decisions.
   - If delegation is skipped, record the reason in `tasks.md`.
4. Follow BDD/TDD for the selected Requirement or Scenario when practical.
   - Translate Scenarios into concrete tests, browser checks, command checks, or manual scenarios.
   - Preserve Requirement and Scenario IDs in test names, verification notes, or `tasks.md` entries when that improves traceability.
   - Write or update focused tests/checks first.
   - Confirm the new or changed test fails for the expected reason when practical.
   - If a failing-first check is not practical, record why in `tasks.md`.
5. Make scoped code, test, doc, or Epic changes.
   - Keep implementation aligned with `design.md`, but update the artifacts when implementation reality proves the design stale.
   - Do not silently expand product scope or user-visible behavior.
6. Run focused verification.
   - Name the Story ID, Requirement ID, Scenario ID, behavior, assertion, route, browser path, command, or manual check being proved.
   - Treat broad commands as supporting evidence unless they map to named behavior.
   - Leave the repo green before committing; do not commit a merely expected failing-test state unless the user explicitly asks for a checkpoint.
7. Reconcile the Epic Story entry.
   - Update Story-level `Implemented By` with important current files and their roles.
   - Update Story-level `Verified By` with concrete evidence.
   - Keep `Verification Gaps` limited to real gaps, deferrals, or weaker-than-required evidence.
8. Update the manual UI confirmation checklist.
   - When the slice changes browser-visible UI, user flows, interaction behavior, empty/error/loading states, permissions, data entry, navigation, or other manually observable app behavior, add or refresh a `Manual UI Confirmation` section in `tasks.md`.
   - Walk the user through the exact app URL or route, required local server state, seed/test data or account, steps to perform, expected observations, known acceptable rough edges, and what feedback would count as a defect, requirement refinement, verification gap, artifact drift, scope expansion, or product drift.
   - Keep the checklist short enough to execute. Prefer a few high-value end-to-end confirmations over repeating every automated assertion.
   - If no manual UI confirmation applies, record `Not applicable` with the reason.
   - Record manual confirmation status in `tasks.md` as `not applicable`, `pending user`, `user confirmed`, or `accepted gap`.
   - Treat the user's response to the checklist as Manual Feedback Loop input for the same change.
9. Update root `CHANGELOG.md` when warranted.
   - Follow Keep a Changelog 1.1.0 conventions: `Unreleased` first, newest releases first, ISO dates for releases, and grouped entry types `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, and `Security`.
   - Add entries under `Unreleased`; do not invent a release version or release date unless the user or the app's release workflow authorizes it.
   - Create root `CHANGELOG.md` from `assets/changelog-template.md` if the file is missing and the change requires a public changelog entry.
   - Keep entries public-safe and human-facing. Do not mention private vault context, SDD implementation ledgers, raw Requirement/Scenario lists, internal task IDs, secrets, or speculative roadmap promises.
   - If no changelog entry is needed, record the reason in `tasks.md`.
10. Update `tasks.md`.
   - Refresh `Resume Here`.
   - Mark completed Requirement and Scenario checklist items.
   - Add a short implementation ledger entry.
   - Add verification ledger entries.
   - Add or refresh manual UI confirmation steps and status.
   - Keep closeout fields consistent with reality: review record, manual confirmation status, changelog status, PR/merge state, deferred gaps, and folder location.
   - Record subagents used, specialist skills loaded, blockers, departures, and commit hashes or commit candidates.
11. Commit locally when authorized, the slice is verified, and changes are commit-shaped.
   - Do not stage unrelated dirty files.
   - Keep app/source commits separate from vault/workflow commits unless they are the same repo.

Continue until all safe tasks are done, a stop condition is hit, or `--step` completes one slice.

## Verification And Final Review

Before reporting the change as implemented or ready for closeout, run final review. Cover:

- Proposal Scope: implemented work matches the proposed change or recorded approved departures.
- Design Fidelity: technical approach, alternatives, constraints, decisions, and risks remain accurate.
- Epic Truth: Epic Stories, Requirements, Scenarios, `Implemented By`, `Verified By`, and `Verification Gaps` match reality.
- ID Traceability: new or modified Stories keep stable Story IDs; Requirements use local `R#` IDs; Scenarios use local `R#-S#` IDs; verification evidence does not rely on stale `AC-#` labels unless they are explicitly marked as legacy references.
- Story ID Uniqueness: no duplicate Story IDs exist across active `docs/epics/**/epic.md` files unless an explicit migration note blocks relying on the duplicate.
- Test And Coverage: user-visible behavior has concrete proof, and risky fake/mock/helper boundaries have production-path proof or explicit gaps.
- Manual UI Confirmation: for browser-visible or otherwise user-facing app changes, `tasks.md` includes a clear walkthrough the user can execute, with expected results and how feedback should be classified.
- Code Quality: changed code is scoped, maintainable, and avoids speculative rewrites.
- Security And Data Safety: auth, permissions, persistence, migrations, secrets, and destructive paths are handled or explicitly out of scope.
- Docs And Artifacts: README/current-state docs, generated indexes, and change artifacts are reconciled when affected.
- Changelog: root `CHANGELOG.md` is updated when the implemented change is release-relevant, or `tasks.md` records why no public entry is needed.
- Merge Readiness: branch, dirty state, commits or commit candidates, remaining gaps, and later review needs are clear.
- Closeout Readiness: `tasks.md` has no contradictory Resume Here, checklist, review record, manual confirmation status, changelog status, PR/merge state, deferred-gap, or folder-location claims.

Use fresh-context delegated reviewers by default for substantial changes and whenever practical for normal implementation. Delegate at least coverage, code, security, and docs/artifact review when the changed surface is non-trivial. This is implementation self-review and does not replace `/sdd-review` as the local PR gate. The orchestrator remains responsible for final judgment and verification of important claims.

Automatically remediate findings that are safe, in scope, and clearly tied to the change. Stop after the review iteration limit or when a finding needs the user's judgment.

## Completion And Closeout

A change is implementation-complete only when:

- all required tasks are complete or explicitly deferred with a reason.
- targeted Epic files exist and match the implemented behavior.
- new or modified Stories, Requirements, and Scenarios follow the stable ID convention.
- Story-level `Implemented By`, `Verified By`, and `Verification Gaps` are current.
- meaningful verification has passed or gaps are explicit.
- manual UI confirmation steps are recorded for user-facing app changes, or `tasks.md` explains why no manual confirmation applies.
- final review has no unresolved safe fixes.
- `tasks.md` has an accurate final `Resume Here`, implementation ledger, verification ledger, blockers/open questions, and closeout state.
- `tasks.md` records the review outcome as a `review.md` path, a clean review recorded in `tasks.md`, or an explicit user-approved review waiver before closeout.
- `tasks.md` records manual UI confirmation status as `not applicable`, `pending user`, `user confirmed`, or `accepted gap`.
- root `CHANGELOG.md` is current when required, using Keep a Changelog categories under `Unreleased`.
- commits or commit candidates are recorded.

Implementation-complete means ready for `/sdd-review`. Do not treat implementation completion as local PR readiness.

Do not move the change to `docs/changes/closed/` unless the user explicitly asks to close, finish, merge-and-close, or otherwise complete the change. Closing from `/sdd-apply` requires implementation completion plus a completed `/sdd-review`, or an explicit user override that review is not needed.

When closing:

1. Ensure `tasks.md` closeout reflects review outcome, review record, manual confirmation status, changelog status, PR/merge state, remaining accepted risks, and no contradictory checklist or Resume Here state.
2. Move `docs/changes/yyyy-mm-dd-change-name/` to `docs/changes/closed/yyyy-mm-dd-change-name/`.
   - If the selected change is in legacy `changes/`, ask whether to migrate it into `docs/changes/closed/` during closeout rather than preserving the legacy root-level location.
3. Update the moved `tasks.md` closeout section.
4. Verify no active references still point to the old active path unless they intentionally describe history.

## Stop Conditions

Stop and report when:

- change selection is ambiguous.
- required artifacts are missing or contradictory.
- the next slice would change product scope, user-visible behavior beyond the proposal, auth/security model, data model, public API, or Epic ownership.
- implementation reveals meaningful PRD/product-direction drift that the user has not accepted.
- branch policy is missing or violated.
- unrelated dirty files block safe edits.
- verification fails without a safe in-scope fix.
- duplicate Story IDs exist across active Epics without an explicit migration/blocking note.
- risky production-path behavior is only covered by mocks/helpers and no explicit gap is acceptable.
- subagent output is unsafe, unsupported, stale, or too broad to integrate.
- required credentials, live services, migrations, production data, destructive actions, push, merge, rebase, deploy, or branch deletion need approval.
- review remediation repeats the same blocker or hits the iteration cap.

## Reports

In `--step`, report the completed slice, files changed by repo, artifact updates, verification, commit made or commit candidate, blockers, and proposed next slice.

When stopping or completing, report:

- change path and final state
- manual feedback handled, if any, including its classification and artifact updates
- completed tasks and remaining tasks
- Epic files updated
- implementation and verification evidence
- manual UI confirmation walkthrough for the user, or why none applies
- commits by repo or commit candidates
- remaining gaps or blockers
- closeout readiness and any contradictory lifecycle state
- whether `/sdd-review`, closeout, or acceptance remains pending

Before reporting success, confirm that Discovery ran, branch/git state was checked, focused verification ran, applicable manual UI confirmation steps were produced, Epic and change artifacts were reconciled, `tasks.md` can cold-resume the work, and no disallowed git/deploy/destructive action occurred.

## Final Self-Improvement Action

After completing or stopping this workflow, end the final user response with a concise self-improvement conclusion:

- Ask yourself: "How well did this work, and what could have been improved?"
- Tell the user the conclusion in 1-3 sentences.
- Name any concrete skill, template, doctrine, or process improvement worth considering.
- If no specific improvement is evident, say so plainly.
