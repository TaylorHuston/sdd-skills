---
name: sdd-apply
description: Apply or continue an active SDD change using a main orchestrator with subagents for non-trivial BDD/TDD implementation, discovery, verification, changed-surface reverse traceability, self-check, and manual UI confirmation. Discovers materially relevant skills available in the current runtime, loads and enforces their guidance without assuming a fixed skill catalog, and passes selected guidance into delegated slices. Reads the change proposal, design, and task ledger, updates application code and Epic truth, reconciles implementation and verification evidence, validates subagent claims, and stops for ambiguity or unsafe changes. Use when the user invokes /sdd-apply, asks to apply, implement, continue, review-only, delegate implementation, use available specialist guidance, walk through UI confirmation, or close a SDD change.
---

# SDD Apply

Apply a SDD change from its change folder. This is the implementation-side companion to `/sdd-change --plan`: `proposal.md` defines scope, `design.md` defines the high-level technical approach and Epic changes, and `tasks.md` is the adaptive implementation ledger and cold-resume surface.

## Authority And Project Profile

Resolve the workspace, idea-owned planning path, and target implementation repository with `sdd context <relevant-path> --json`, then read `<workspaceRoot>/.sdd/story-driven-development.md` completely before interpreting SDD artifact authority, evidence, reconciliation, or closeout. Use the resolved topology unless project guidance declares an explicit exception, then enforce the canonical `docs/epics/`, `docs/changes/`, and `docs/changes/closed/` layout inside the implementation repository. Project guidance owns branch and commit policy, verification commands, truth-bearing supporting-doc requirements, release conventions, technology constraints, and permissions. If the managed workflow document is missing, stop and direct the user to `sdd init` or `sdd doctor`.

Non-negotiable invariant: Epic/Story truth must stay aligned with implementation reality as the work proceeds. If implementation changes behavior, reveals stale Story wording, changes Requirement or Scenario meaning, moves Epic ownership, or changes verification confidence, update the affected Epic/Story truth in the same run or stop before claiming implementation progress.

Branch invariant: before changing application code, tests, schemas, configuration, generated project artifacts, or runtime behavior, read and follow the implementation repo's local `AGENTS.md` and branch/merge policy. If project-local policy is absent, fall back to documented project or workspace guidance. Do not begin code or runtime edits on a branch that violates policy; stop or ask before creating or switching branches unless the user already authorized it.

Do not create a separate implementation record, Story approach report, Epic approach report, or CLI state. Fold those responsibilities into the existing change artifacts.

Use `/sdd-interactive` instead when no suitable change folder exists yet and the user wants a lightweight tracked working session that creates the change artifacts and immediately applies small edits.

Default to an orchestrator-and-subagents model. The main agent owns change selection, artifact truth, branch/git safety, phase selection, subagent scoping, validation of child claims, `tasks.md`, Epic reconciliation, commits, stop conditions, and user-facing decisions. Delegate non-trivial implementation, discovery, verification, and implementation self-check slices to subagents when the tooling is available and safe.

Delegation authorization: invoking `/sdd-apply`, naming `sdd-apply`, or asking to apply/continue an active SDD change is explicit permission to use bounded SDD subagents under this skill's delegation model. If the local tool policy requires an explicit user request before spawning subagents, this skill invocation satisfies that requirement for non-trivial Discovery, implementation, verification, and self-check slices that remain inside the selected change. Do not ask for separate subagent permission unless the user passed `--no-delegate`, the requested delegation would exceed the selected change, the tool requires a more specific approval than normal spawning, or a stop condition applies.

Use `references/specialist-routing.md` to discover and apply materially relevant guidance available in the current runtime. Do not assume particular skills are installed, and do not copy their domain guidance into this skill.

Use `assets/changelog-template.md` only when project policy calls for a Keep a Changelog-style release record and no compatible file exists yet.

Use `assets/epic-template.md` when creating a new Epic or normalizing an Epic file shape.

## Canonical Repository Layout

Required SDD layout inside the implementation repository:

- active changes: `docs/changes/<yyyy-mm-dd-change-name>/`
- closed changes: `docs/changes/closed/<yyyy-mm-dd-change-name>/`
- Epics: `docs/epics/<key>-<###>-<epic-name>/epic.md`
- release communication: whatever changelog, release-note, changeset, or equivalent record project guidance requires

Project-local guidance may adapt branch policy, release-communication location, test commands, and supporting-doc inventory. It may not relocate canonical SDD artifacts. A deliberately different SDD layout requires modifying this section, every affected path operation in this skill, the managed workflow source, and corresponding templates.

## Inputs And Modes

Start from an explicit change folder, change name, or active change inferred from the conversation.

Supported modes:

- Default: implement all safe remaining tasks, update artifacts as reality changes, make local commits when authorized, and stop only for defined stop conditions.
- `--step`: run Discovery or one coherent slice, report, and ask before continuing.
- `--no-commit`: keep changes commit-shaped and record commit candidates instead of committing.
- `--review-only`: skip new implementation slices and run the implementation self-check against current implementation and artifacts. This mode does not replace `/sdd-review`.
- `--no-delegate`: use the main thread only. This opt-out overrides the skill's default delegation authorization. Also skip delegation when subagent tooling is unavailable, the slice is tiny, or isolation would create more risk than value.
- `--max-review-iterations N`: cap hands-off remediation attempts; default to `3`.

Default and explicit full mode authorize local commits for completed, verified slices only when the current user request and project branch policy allow them. They do not authorize push, merge, deploy, rebase, destructive data changes, deleting branches, touching credentials, or marking user acceptance complete.

Closeout is not a special correctness mode. Always maintain closeout readiness as normal workflow truth. Move a change to `docs/changes/closed/` only when the user asks to close, finish, merge-and-close, or otherwise complete it, and only after implementation completion plus a completed `/sdd-review` or an explicit user override that review is not needed.

## Select The Change

Use the explicit path or name if provided. Otherwise:

1. Infer from conversation context when a change was just discussed.
2. List active folders under `docs/changes/`, excluding `docs/changes/closed/`.
3. If no canonical active change is found, inspect legacy `changes/` only as migration input. Do not apply it in place; stop and require migration into `docs/changes/` before implementation continues.
4. Do not select a Change Brief or private Planned Change Draft from the idea planning path. Stop and require `/sdd-change --plan` for a brief, or `sdd change promote <space-id> <change-id>` plus repository-specific `/sdd-change --plan` reconciliation for a planned draft, before implementation continues.
5. Auto-select only when exactly one active change exists.
6. Ask the user when multiple active changes match or no change can be inferred.

Always announce the selected change and how to override it.

## Required Context

Before editing, read:

- `docs/changes/yyyy-mm-dd-change-name/proposal.md`
- `docs/changes/yyyy-mm-dd-change-name/design.md`
- `docs/changes/yyyy-mm-dd-change-name/tasks.md`
- the project-defined release communication when the proposal says release-note impact is required or TBD, or implementation proves the change affects public release meaning
- relevant `AGENTS.md`, README, project-local branch/merge policy, and PRD/Product Brief under the resolved idea planning root when present; if no project-local policy exists, use documented project or workspace guidance as fallback
- the project-defined truth-bearing supporting-doc set; when none is declared, inspect the README, changed docs, and documents whose current claims intersect the changed surface rather than inventing a universal inventory
- target Epic files under `docs/epics/*/epic.md`
- enough of every active `docs/epics/*/epic.md` to detect duplicate Story labels within an Epic, duplicate full Story references, or conflicting legacy app-wide Story IDs
- code, tests, docs, and generated artifacts named by `design.md`, `tasks.md`, or current implementation reality
- the application's component previews and any project-configured shared reference catalog when a UI-bearing Change introduces or materially changes reusable components or patterns
- routes, commands, seed data, test accounts, browser setup, screenshots, or local dev URLs needed to give the user a useful manual UI confirmation walkthrough when the change is user-facing

Check git status in every repo that may change. Preserve unrelated dirty files. Before code or runtime edits, confirm the current branch satisfies the project-local policy or documented fallback policy. If the change touches an implementation repo associated with the workflow root, read that repo's local guidance before editing.

## Discovery

Start every run with Discovery, even when resuming.

Check that:

- `sdd validate <space-id> --change <change-id> --repo <resolved-repository-path> --workspace <workspace-root> --json` has no unresolved deterministic errors. Inspect warnings and classify intentional compatibility exceptions instead of ignoring them. This structural gate does not replace the semantic Discovery checks below.
- `proposal.md`, `design.md`, and `tasks.md` agree about the change scope.
- `tasks.md` frontmatter has exactly one valid active `status`: `proposed`, `planned`, `in_progress`, or `in_review`. Start implementation only from `planned`; run `sdd change transition <space-id> <change-id> --from planned --to in_progress` before implementation begins. Route `proposed` Changes back to `/sdd-change --plan` or `--replan`, and treat `in_review` as review-owned unless the requested work explicitly returns it to implementation through the corresponding guarded transition.
- `design.md` identifies whether the change creates new Epic directories, edits existing Epic directories, or both.
- For UI-bearing changes, any required `Experience Design` direction is confirmed, uses stable references, and resolves material responsive, state, accessibility, and visual questions before implementation begins.
- For UI-bearing changes with material component decisions, the `Experience Design` classifies each affected pattern as an existing application component, adopted reference, application-specific component, reference candidate, or deliberate divergence, and names its initial owner plus required preview states. Do not invent a shared-catalog dependency when none is configured.
- each targeted Epic path follows `docs/epics/key-###-epic-name/epic.md`.
- Stories stay embedded in Epic `epic.md` files; do not create `docs/stories/`.
- Epics and Stories are durable but revisable truth; proposed Story moves, splits, merges, renames, and reorders are explicit Epic changes, not accidental implementation cleanup.
- Epic/Story truth is non-negotiable. Do not continue implementation if affected Epic truth is stale, contradictory, or no longer mapped to the behavior being changed unless the current run is actively reconciling it.
- each Story has a stable Epic-scoped label or documented legacy Story ID, local Requirement IDs, local Scenario IDs, `Implemented By`, `Verified By`, and `Verification Gaps`.
- implemented Stories use `Verified By` as a scenario-mapped evidence index, not as a chronological command log.
- `Verified By` evidence distinguishes focused automated tests, broad supporting gates, deterministic E2E, live-provider playtests, manual UI confirmation, and debug/log inspection instead of collapsing them into one vague "verified" bucket.
- `S#` Story labels are unique within each Epic, full Story references are traceable, and legacy app-wide Story IDs remain unique unless a temporary migration duplicate is explicitly documented as blocking further implementation.
- later Stories or Requirements do not silently supersede earlier Epic truth. If this change revises an earlier boundary, update the older Story wording, `Verified By`, and `Verification Gaps` or record an explicit supersession note.
- Requirements and Scenarios describe observable behavior unless a technical detail is itself user-visible.
- Scenarios are concrete enough to drive tests or manual checks. Do not proceed with generic Scenarios such as "WHEN this Story's workflow is exercised"; patch the artifact or stop for scope clarification.
- the technical approach is sufficient for the next implementation slice.
- `tasks.md` has a usable `Resume Here`, Requirement/Scenario checklist, implementation ledger, verification ledger, blockers/open questions, and closeout area.
- the current branch satisfies project-local policy or documented fallback policy, and dirty state allows safe edits.
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
   - `artifact drift`: Epic, design, tasks, docs, or release communication no longer describe reality.
   - `requirement refinement`: feedback changes wording, edge cases, or acceptance expectations while staying inside the proposal.
   - `planning discovery`: implementation or feedback reveals a new or meaningfully changed Requirement, Scenario, constraint, or Epic ownership question that needs design work before more code changes.
   - `scope expansion`: feedback adds new user-visible behavior, product scope, data/auth/API semantics, Epic ownership, or release expectations beyond the proposal.
   - `product drift`: feedback changes product direction or contradicts the PRD/Product Brief.
3. Choose the action.
   - For `defect`, add or update the relevant Scenario/test, fix the implementation, verify, and update `tasks.md` plus Story `Verified By` or `Verification Gaps`.
   - For `verification gap`, run or add the missing proof before claiming completion.
   - For `artifact drift`, update the stale artifact and record the reconciliation in `tasks.md`.
   - For small `requirement refinement`, update `design.md` and the target Epic Story Requirement/Scenario IDs before implementation, then add matching `tasks.md` checklist entries.
   - For `planning discovery`, stop implementation and recommend `/sdd-change --replan` against the active change. Resume with a fresh `/sdd-apply` only after `proposal.md`, `design.md`, and `tasks.md` are updated.
   - For material experience-design uncertainty that does not yet change accepted behavior, stop the UI slice and recommend `/sdd-design --plan` before implementation or `/sdd-design --revise` after implementation or manual comparison has begun. If design discovery changes Requirements, Scenarios, scope, ownership, contracts, data, auth, or technical constraints, route through `/sdd-change --replan` before returning to design or implementation.
   - For `scope expansion`, stop unless the user explicitly accepts expanding this change. If accepted and the expansion needs planning, route to `/sdd-change --replan`; otherwise update `proposal.md`, `design.md`, Epic truth, and `tasks.md`. If not accepted, recommend `/sdd-change --brief` for a follow-up change.
   - For `product drift`, stop or recommend `/sdd-prd` unless the user explicitly authorizes product-direction updates in the same run.

When feedback changes a Requirement or Scenario, preserve the stable Story label/reference and local Requirement/Scenario ID when the behavior is an edit to existing truth. Add a new `R#` or `R#-S#` only when it is a genuinely new behavior rule or scenario. Do not silently renumber completed Requirements or Scenarios just to keep labels tidy.

When feedback or implementation reveals that a Story belongs in a different Epic, treat it as Epic ownership change. Record the old full Story reference and the new full Story reference, update both source and destination Epic truth, and record the move in `tasks.md`; if the move was not in the proposal, stop or require explicit scope acceptance before applying it.

Manual feedback is not `/sdd-review` by default. Create or update `review.md` only when the feedback is explicitly a review finding or comes from `/sdd-review`; otherwise keep the active record in `tasks.md` and the durable truth in `design.md` plus the Epic. When the feedback becomes planning-level discovery, let `/sdd-change --replan` revise the planning artifacts before implementation resumes.

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

The user's invocation of this skill is the standing delegation authorization for the selected SDD change. Keep work in the main thread when `--no-delegate` is active, tooling is unavailable, the slice is tiny, isolation would add risk, or another explicit stop condition applies. Do not turn the delegation choice into required ledger telemetry.

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

Keep delegated waits bounded:

- Continue non-overlapping main-thread work immediately after spawning.
- Wait only when the next required action genuinely depends on the result.
- Never wait silently for more than 60 seconds; give the user a concise status update that distinguishes completed work from the delegated result still pending.
- After roughly three minutes of cumulative waiting on one task or wave, interrupt or close the slow agent and finish locally, or re-delegate a narrower question.
- Do not let an optional self-check or reviewer block a status response, and close completed or abandoned agents promptly.

## Available Skill Use

Before a non-trivial implementation, verification, or self-check slice:

1. Inspect the Story/Requirement/Scenario, touched surfaces, project guidance, and material risks.
2. Inspect the skills exposed by the current runtime and select the smallest set whose stated capabilities could materially change implementation, verification, or stop conditions.
3. Read each selected skill completely, including required referenced guidance, before acting. Follow that guidance unless it conflicts with higher-priority instructions or project-local authority.
4. If delegating, pass selected skills through the tool's supported skill/path/mention mechanism and explicitly require the worker to load and apply them before working.
5. If no relevant skill is installed, continue with project-local guidance, current framework/platform documentation, and sound engineering judgment. Missing optional skills are not blockers and must not be invented.
6. Treat guidance that reveals unapproved product, security, data, migration, deployment, destructive, or external-service scope as a stop condition.

When implementation or debugging depends on version-sensitive library, framework, SDK, API, CLI, or cloud-platform behavior, prefer an available current-documentation capability such as Context7 before editing. Scope the lookup to the exact concept and installed version when known. If no provider is available, use primary vendor documentation; the missing optional capability is not a blocker unless project policy makes it a gate.

Do not load every vaguely related skill. Do not claim a skill was used unless its instructions were actually read and applied. Record only concrete consequences that change the approach, verification, a durable artifact, or a stop condition; use the existing Implementation or Verification Ledger instead of a separate specialist-activity table.

Every delegated implementation prompt must include:

- implementation root and workflow root
- change folder and `proposal.md`, `design.md`, `tasks.md` paths
- target Epic path and the exact Story label/reference, Requirement ID, and Scenario ID scope
- relevant technical approach, constraints, and stop conditions
- selected available skills and other required guidance to load
- confirmed experience-design references and UI stop conditions when the slice is user-facing
- why each selected skill or guidance item applies to this slice
- expected files or surfaces to inspect
- allowed toolsets and edit permissions
- explicit instruction not to commit, push, merge, close, or update Change status
- BDD/TDD expectation, including failing-first proof when practical
- verification commands or browser/manual checks to run
- required report shape

Use `assets/subagent-requirement-prompt.md` for delegated implementation slices and `assets/subagent-review-prompt.md` for delegated review passes when structured prompts help.

The orchestrator must verify important subagent claims before committing or updating durable truth:

- inspect file diffs and git status
- read changed files
- rerun focused tests or commands when practical
- confirm `Implemented By`, `Verified By`, and `Verification Gaps` updates are accurate
- confirm selected skill guidance was actually applied and any material conflict or departure was explicit
- reject or stop on subagent output that is too broad, unsafe, stale, or unsupported

## Apply Loop

Implement one coherent behavior or capability slice at a time.

For UI-bearing slices, follow the recorded component strategy. Inspect existing application previews and configured reference catalogs before creating a materially reusable pattern. Adopt references using the consuming project's ownership model; when no shared runtime ownership model is configured, copy and adapt them into application ownership. Keep application-specific behavior in the application. Treat reference candidates as follow-up signals: do not edit another repository, block the application, or claim standardization unless the accepted Change explicitly includes that work and project policy permits it. Satisfy required preview states through configured component previews or equivalent rendered-route, fixture, browser, or manual evidence; do not introduce a preview tool solely to satisfy this workflow.

1. Apply Epic artifact work first when needed.
   - Create or update `docs/epics/key-###-epic-name/epic.md`.
   - Keep Stories embedded in the Epic.
   - Use `assets/epic-template.md` for new or normalized Epic files unless project-local guidance intentionally keeps a legacy shape.
   - Preserve room for future supporting artifacts beside `epic.md`, but do not create extra folders unless needed.
2. Select the next pending Requirement or Scenario from `tasks.md` and `design.md`.
   - Prefer Requirement-shaped phases.
   - Split by Scenario when a Requirement is too large, has distinct failure modes, or crosses separate technical surfaces.
   - Use file-shaped work only as an enabling phase tied to the next Requirement.
   - Use the stable labels in reports and commits: `EPIC-ID/S1 R1`, `EPIC-ID/S1/R1-S1`, or the documented legacy Story ID form.
   - If the next slice came from manual feedback, confirm `tasks.md`, `design.md`, and the target Epic reflect the feedback classification before editing code.
3. Delegate the selected Requirement or Scenario when it is non-trivial and delegation is available.
   - Scope the subagent with `assets/subagent-requirement-prompt.md`.
   - Pass every selected available skill or required guidance item and require the subagent to load and apply it.
   - Allow edits only for the assigned slice.
   - Require the subagent to report needed artifact updates instead of making Change-status or closeout decisions.
4. Follow BDD/TDD for the selected Requirement or Scenario when practical.
   - Translate Scenarios into concrete tests, browser checks, command checks, or manual scenarios.
   - Preserve Requirement and Scenario IDs in test names, verification notes, or `tasks.md` entries when that improves traceability.
   - Shape tests around the changed risk, not only the happy path. When relevant, include deterministic negative and edge cases for resettable state, external state refresh, overlapping async writes, debounced or autosaved edits, parser/extractor validation, permission/configuration failure, and portable path/environment assumptions.
   - For resettable or seedable data, verify every mutable field that the change can edit is restored or intentionally preserved.
   - For editable UI or command surfaces backed by canonical state, verify identity, focus/draft preservation, and synchronization from external canonical updates when those behaviors can regress.
   - For extraction, parsing, inference, or validation boundaries, include at least one adversarial negative case where the output mentions the target concept but does not satisfy the condition.
   - Write or update focused tests/checks first.
   - Confirm the new or changed test fails for the expected reason when practical.
   - If a failing-first check is not practical, record why in `tasks.md`.
5. Make scoped code, test, doc, or Epic changes.
   - Keep implementation aligned with `design.md`, but update the artifacts when implementation reality proves the design stale.
   - Treat Epic/Story reconciliation as part of implementation, not documentation cleanup after the fact.
   - Update existing or locally required project docs under `docs/` when the change makes them stale. Do not create a broad standard doc inventory unless project-local guidance or the change itself requires it.
   - Do not silently expand product scope or user-visible behavior.
6. Run focused verification.
   - Name the Story label/reference, Requirement ID, Scenario ID, behavior, assertion, route, browser path, command, or manual check being proved.
   - Record chronological command results in `tasks.md` under the Verification Ledger.
   - Label the evidence type where it matters: focused automated test, broad supporting gate, deterministic E2E, live-provider playtest, manual UI confirmation, or debug/log inspection.
   - Treat broad commands as supporting evidence unless they map to named behavior.
   - Leave the repo green before committing; do not commit a merely expected failing-test state unless the user explicitly asks for a checkpoint.
7. Reconcile the Epic Story entry.
   - Update Story-level `Implemented By` with important current files and their roles.
   - Update Story-level `Verified By` as a scenario-mapped evidence index. Each entry should name the concrete test, check, manual scenario, browser path, or review artifact and the Story/Requirement/Scenario IDs it proves.
   - Do not append chronological verification logs to `Verified By`; broad gates such as lint, typecheck, build, codegen, or full CI can appear only as supporting evidence.
   - Keep `Verification Gaps` limited to real gaps, deferrals, or weaker-than-required evidence.
   - Search affected Epic Stories for older wording that this slice supersedes. Reconcile stale Requirements, Scenarios, `Implemented By`, `Verified By`, `Verification Gaps`, and notes before claiming the current Story is done.
8. Update the manual UI confirmation checklist.
   - When the slice changes browser-visible UI, user flows, interaction behavior, empty/error/loading states, permissions, data entry, navigation, or other manually observable app behavior, add or refresh a `Manual UI Confirmation` section in `tasks.md`.
   - Walk the user through the exact app URL or route, required local server state, seed/test data or account, steps to perform, expected observations, known acceptable rough edges, and what feedback would count as a defect, requirement refinement, verification gap, artifact drift, scope expansion, or product drift.
   - Keep the checklist short enough to execute. Prefer a few high-value end-to-end confirmations over repeating every automated assertion.
   - If no manual UI confirmation applies, record `Not applicable` with the reason.
   - Record manual confirmation status in `tasks.md` as `not applicable`, `pending user`, `user confirmed`, or `accepted gap`.
   - Treat the user's response to the checklist as Manual Feedback Loop input for the same change.
9. Update project-defined release communication when warranted.
   - Follow the configured location and format; do not impose a changelog convention the project has not adopted.
   - Add only content required by project policy, keep it public-safe when public, and ensure every behavior claim matches Epic truth and evidence.
   - Use `assets/changelog-template.md` only for a project that selected Keep a Changelog and needs an initial file.
   - If no release-communication update is needed, record the reason in `tasks.md`.
10. Reconcile affected project docs under `docs/`.
   - Treat project docs as supporting documentation, not canonical Epic/Story truth.
   - Update docs whose truth value changed, including architecture, testing, deployment, style, data/API contracts, operations, README, or current-state docs.
   - If a relevant doc is missing, create it only when project-local guidance requires it or when the change needs a new durable support document.
   - If no project docs need updates, record the reason in `tasks.md`.
11. Update `tasks.md`.
   - Refresh `Resume Here`.
   - Mark completed Requirement and Scenario checklist items.
   - Add a short implementation ledger entry.
   - Add verification ledger entries.
   - Add or refresh manual UI confirmation steps and status.
   - Keep closeout fields consistent with reality: review record, manual confirmation status, release-communication status, PR/merge state, deferred gaps, and folder location.
   - Record any superseded Story/Requirement/Scenario wording and the artifact reconciliation performed.
   - Keep old proposal/design status text from contradicting completed work. If design sections still say `Not implemented yet`, `Not verified yet`, or implementation is pending after implementation has landed, update or clearly mark that text as historical before closeout.
   - Record consequential skill guidance or delegation outcomes only when they changed implementation, verification, artifacts, or stop conditions; also record blockers, departures, and commit hashes or commit candidates.
   - Keep `status: in_progress` while implementation, verification, remediation, or unresolved blockers remain. Run `sdd change transition <space-id> <change-id> --from in_progress --to in_review` only after implementation is complete and the Change is ready for independent `/sdd-review`.
   - Before the implementation commit exists, record the relevant ledger rows as `commit pending`, `uncommitted`, or a clear commit candidate rather than inventing a hash.
12. Commit locally when authorized, the slice is verified, and changes are commit-shaped.
   - Do not stage unrelated dirty files.
   - Keep app/source commits separate from vault/workflow commits unless they are the same repo.
   - After a commit succeeds, immediately update `tasks.md` so `Resume Here`, the implementation ledger, verification ledger, closeout state, and PR/merge state reference the real commit hash.
   - If that post-commit ledger update changes `tasks.md`, make a small ledger-only follow-up commit. This keeps cold-resume state accurate instead of leaving `tasks.md` with stale `uncommitted` or `commit pending` entries.
   - In `--no-commit` mode, do not make either commit; keep `tasks.md` on commit candidates and say that hashes remain pending.

Continue until all safe tasks are done, a stop condition is hit, or `--step` completes one slice.

## Verification And Implementation Self-Check

Before reporting the change as implemented or ready for `/sdd-review`, run an implementation self-check. This is the apply-side sanity check that the implementation slice is complete, reconciled, and ready for independent review; it is not the local PR-style `/sdd-review` gate. Cover:

- Proposal Scope: implemented work matches the proposed change or recorded approved departures.
- Design Fidelity: technical approach, alternatives, constraints, decisions, and risks remain accurate.
- Epic Truth: Epic Stories, Requirements, Scenarios, `Implemented By`, scenario-mapped `Verified By`, and `Verification Gaps` match reality.
- Supersession Reconciliation: later work has not left earlier Stories, Requirements, Scenarios, `Verified By`, or `Verification Gaps` with stale assumptions.
- Story Reference Traceability: new or modified Stories keep stable Epic-scoped labels or documented legacy Story IDs; Requirements use local `R#` IDs; Scenarios use local `R#-S#` IDs; verification evidence does not rely on stale `AC-#` labels unless they are explicitly marked as legacy references.
- Story Reference Uniqueness: no duplicate `S#` labels exist within a single Epic, no duplicate full Story references exist, and no duplicate legacy app-wide Story IDs exist unless an explicit migration note blocks relying on the duplicate.
- Test And Coverage: user-visible behavior has concrete proof, and risky fake/mock/helper boundaries have production-path proof or explicit gaps.
- Risk-Shaped Evidence: deterministic edge cases introduced by the implementation are proved or explicitly carried as gaps. Do not treat an artifact claim such as "reset works", "stable identity", "autosave flushes", "validation rejects bad output", or "remote configuration fails clearly" as verified unless a test, browser/manual check, or source inspection directly supports that exact property.
- Evidence Typing: deterministic E2E, live-provider playtests, manual UI confirmation, broad gates, and debug/log inspection are recorded as distinct evidence types.
- Manual UI Confirmation: for browser-visible or otherwise user-facing app changes, `tasks.md` includes a clear walkthrough the user can execute, with expected results and how feedback should be classified.
- Code Quality: changed code is scoped, maintainable, and avoids speculative rewrites.
- Security And Data Safety: auth, permissions, persistence, migrations, secrets, and destructive paths are handled or explicitly out of scope.
- Docs And Artifacts: affected project docs under `docs/`, README/current-state docs, generated indexes, and change artifacts are reconciled when affected, without inventing a fixed docs inventory.
- Release Communication: the project-defined release record is updated when required, or `tasks.md` records why no entry is needed.
- Review Handoff Readiness: branch, dirty state, commits or commit candidates, remaining gaps, and later `/sdd-review` needs are clear.
- Closeout Readiness: `tasks.md` has no contradictory Resume Here, checklist, review record, manual confirmation status, release-communication status, PR/merge state, deferred-gap, or folder-location claims.
- Closed-Artifact Readiness: related proposal/design/tasks/review files do not still claim implemented work is unimplemented, unverified, pending, or accepted under obsolete status vocabulary.
- Changed-Surface Reverse Traceability: run the packaged `sdd-orphan-audit` script in JSON mode with `--changed-from <integration-target-or-merge-base>` and one `--epic <epic-id>` pass per affected Epic. Classify every behavior-test and source candidate as Epic-owned, supporting/generated/framework infrastructure, an explicit gap, or tracked cleanup before handoff. If the script is unavailable, perform and record an equivalent current-working-tree inventory; do not silently skip the gate.
- Refactor Stranding: when the change removes, replaces, or relocates implementation, explicitly search for old imports, routes, registrations, constructors/dependencies, tests, migrations, generated bindings, and files left behind by the previous path.

Use fresh-context delegated self-check passes by default for substantial changes and whenever practical for normal implementation. Delegate at least coverage, code, security, and docs/artifact checks when the changed surface is non-trivial. This implementation self-check does not replace `/sdd-review` as the local PR gate. The orchestrator remains responsible for final judgment and verification of important claims.

Run the implementation self-check as one complete discovery wave before remediation: start materially relevant passes together, collect their complete results, validate and deduplicate findings, and group them by root cause. Explicitly check relevant cross-cutting risks such as migration immutability and upgrade behavior, existing-data compatibility, async focus or draft preservation, responsive accessibility, CI/dependency validity, generated-contract drift, and fresh-install versus existing-install behavior. Mark irrelevant classes `not applicable` rather than expanding scope.

Automatically remediate the complete safe, in-scope finding set as one batch. Then run the union of affected focused checks and required broad gates once, followed by one regression-focused self-check of changed surfaces. Do not stop after each finding, ask the user to resume between ordinary remediation slices, or rerun unaffected specialist passes without a concrete reason. Stop after the review iteration limit, when remediation introduces a genuinely new unresolved regression, or when a finding needs user judgment or crosses another stop condition.

## Completion And Closeout

A change is implementation-complete only when:

- all required tasks are complete or explicitly deferred with a reason.
- targeted Epic files exist and match the implemented behavior.
- new or modified Stories, Requirements, and Scenarios follow the stable label/reference convention.
- Story-level `Implemented By`, scenario-mapped `Verified By`, and `Verification Gaps` are current.
- superseded or revised earlier Story truth has been reconciled, not merely contradicted by a later Story.
- meaningful verification has passed or gaps are explicit.
- manual UI confirmation steps are recorded for user-facing app changes, or `tasks.md` explains why no manual confirmation applies.
- the implementation self-check has no unresolved safe fixes.
- the changed-surface reverse-traceability inventory ran and every relevant candidate was reconciled or recorded as a gap.
- scoped `sdd validate` passes after the final Epic and Change reconciliation; warnings are either resolved or explicitly classified.
- `tasks.md` has an accurate final `Resume Here`, implementation ledger, verification ledger, blockers/open questions, and closeout state.
- `tasks.md` records the review outcome as a `review.md` path, a clean review recorded in `tasks.md`, or an explicit user-approved review waiver before closeout.
- `tasks.md` records manual UI confirmation status as `not applicable`, `pending user`, `user confirmed`, or `accepted gap`.
- related proposal/design/tasks/review artifacts do not contain stale implementation-pending language or contradictory manual confirmation status unless clearly marked historical.
- affected existing or locally required project docs under `docs/` no longer contradict implementation, Epic truth, branch/release policy, testing commands, architecture, data/API contracts, deployment behavior, operations, or visual style.
- when `design.md` contains a confirmed `Experience Design`, implementation and Storybook/manual evidence reflect its required flow, responsive composition, states, accessibility behavior, and explicitly accepted deviations.
- when `design.md` records material component strategies, implementation ownership, preview states, and any promotion claims agree with the implemented result; a shared or standardized claim has implemented consumer use outside the catalog itself at the level required by project guidance, or remains explicitly a candidate.
- project-defined release communication is current when required.
- commits or commit candidates are recorded.

Implementation-complete means ready for `/sdd-review`. Do not treat implementation completion as local PR readiness.

Do not move the change to `docs/changes/closed/` unless the user explicitly asks to close, finish, merge-and-close, or otherwise complete the change. Closing from `/sdd-apply` requires implementation completion plus a completed `/sdd-review`, or an explicit user override that review is not needed.

When closing:

1. Ensure `tasks.md` has `status: in_review` and its closeout reflects a passing review outcome, review record, manual confirmation status, release-communication status, PR/merge state, remaining accepted risks, and no contradictory checklist or Resume Here state.
   - Confirm manual confirmation status uses only `not applicable`, `pending user`, `user confirmed`, or `accepted gap`.
   - Confirm related active and closed artifacts no longer contradict the accepted Epic state, including stale `Not implemented yet`, `Not verified yet`, old boundary wording, or obsolete manual status vocabulary.
2. Run `sdd change close <space-id> <change-id> --repo <resolved-repository-path> --workspace <workspace-root>`. Use repeated `--repo` selections only after every coordinated repository Change is independently ready.
3. Update the moved `tasks.md` closeout section without changing status to `closed`; folder location is the closed state.
4. Verify no active references still point to the old active path unless they intentionally describe history.

## Stop Conditions

Stop and report when:

- change selection is ambiguous.
- required artifacts are missing or contradictory.
- the next slice would change product scope, user-visible behavior beyond the proposal, auth/security model, data model, public API, or Epic ownership.
- implementation reveals meaningful PRD/product-direction drift that the user has not accepted.
- branch policy is missing with no documented fallback, or violated.
- unrelated dirty files block safe edits.
- verification fails without a safe in-scope fix.
- duplicate Story labels inside one Epic, duplicate full Story references, or duplicate legacy app-wide Story IDs exist without an explicit migration/blocking note.
- a later Story or implementation slice supersedes earlier Epic truth that has not been reconciled.
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
- Change status, closeout readiness, and any contradictory state
- whether `/sdd-review`, closeout, or acceptance remains pending

Before reporting success, confirm that Discovery ran, branch/git state was checked, focused verification ran, applicable manual UI confirmation steps were produced, Epic and change artifacts were reconciled, `tasks.md` can cold-resume the work, and no disallowed git/deploy/destructive action occurred.
