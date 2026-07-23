---
name: sdd-apply
description: Apply or continue an SDD change with orchestrated BDD/TDD implementation, verification, artifact reconciliation, reverse traceability, self-check, and bounded subagents. In default/full mode, persist through every safe implementation and remediation slice until the Change is implementation-complete, transitioned to in_review, and ready for independent /sdd-review; pause only for an explicit bounded mode or genuine stop condition. May promote an unambiguous planned private Change. Use when the user invokes /sdd-apply or asks to apply, implement, continue, review-only, delegate, verify, prepare for review, handle manual feedback, or close an SDD change.
---

# SDD Apply

Apply a SDD change from its change folder. This is the implementation-side companion to `/sdd-change --plan`: `proposal.md` defines scope, `design.md` defines the end state, constraints, and Epic changes, and `tasks.md` is the adaptive implementation ledger and cold-resume surface. Treat the plan as a contract for what must be true and confirmed, not a fixed implementation script; revise the path, risks, and evidence as implementation teaches you more.

## Authority And Project Profile

Resolve the workspace, idea-owned planning path, and target implementation repository with `sdd context <relevant-path> --json`, then read the `workflowPath` returned by `sdd context` completely before interpreting SDD artifact authority, evidence, reconciliation, or closeout. Use the resolved topology unless project guidance declares an explicit exception, then enforce the canonical `docs/epics/`, `docs/changes/`, and `docs/changes/closed/` layout inside the implementation repository. Project guidance owns branch and commit policy, verification commands, truth-bearing supporting-doc requirements, release conventions, technology constraints, and permissions. If user setup is missing, direct the user to `sdd setup`; if the repository contract is missing, direct them to `sdd init` there. Use `sdd doctor` for an existing but unhealthy installation.

Non-negotiable invariant: Epic/Story truth must stay aligned with implementation reality as the work proceeds. If implementation changes behavior, reveals stale Story wording, changes Requirement or Scenario meaning, moves Epic ownership, or changes verification confidence, update the affected Epic/Story truth in the same run or stop before claiming implementation progress.

Persistence invariant: a default or explicit full-mode invocation is an outcome request, not permission to complete only one slice. Continue implementing, verifying, reconciling, and safely remediating until every implementation-completion criterion is satisfied and the Change has transitioned to `in_review`, ready for independent `/sdd-review`. A completed phase, passing focused test, subagent handoff, commentary update, or ordinary fixable failure is not a terminal condition. Give concise progress updates while continuing. Stop short of review readiness only for `--step`, an explicit user-imposed bound, or a genuine Stop Condition that cannot be safely resolved inside the accepted Change.

Branch invariant: before changing application code, tests, schemas, configuration, generated project artifacts, or runtime behavior, read and follow the implementation repo's local `AGENTS.md` and branch/merge policy. If project-local policy is absent, fall back to documented project or workspace guidance. Do not begin code or runtime edits on a branch that violates policy; stop or ask before creating or switching branches unless the user already authorized it.

Commit cadence invariant: in default/full mode, make a local commit after every completed, verified, artifact-reconciled Requirement/Scenario phase before starting the next phase. Treat the commit as part of the phase boundary, not final cleanup. Do not accumulate multiple independently reviewable phases in one working-tree batch. When one phase is unusually long, create additional checkpoint commits at coherent, green, safely reviewable milestones. Do not create noisy per-file or command-by-command commits, and never commit an expected failing or internally contradictory state. `--no-commit`, an explicit user prohibition, repository policy, or an inability to isolate the intended files are the only reasons to keep a completed phase as a commit candidate.

Do not create a separate implementation record, Story approach report, Epic approach report, or CLI state. Fold those responsibilities into the existing change artifacts.

Use `/sdd-interactive` instead when no suitable change folder exists yet and the user wants a lightweight tracked working session that creates the change artifacts and immediately applies small edits.

Default to an orchestrator-and-subagents model. The main agent owns change selection, artifact truth, branch/git safety, phase selection, subagent scoping, validation of child claims, `tasks.md`, Epic reconciliation, commits, stop conditions, and user-facing decisions. Delegate non-trivial implementation, discovery, verification, and implementation self-check slices to subagents when the tooling is available and safe.

Delegation authorization: invoking `/sdd-apply`, naming `sdd-apply`, or asking to apply/continue an active SDD change is explicit permission to use bounded SDD subagents under this skill's delegation model. If the local tool policy requires an explicit user request before spawning subagents, this skill invocation satisfies that requirement for non-trivial Discovery, implementation, verification, and self-check slices that remain inside the selected change. Do not ask for separate subagent permission unless the user passed `--no-delegate`, the requested delegation would exceed the selected change, the tool requires a more specific approval than normal spawning, or a stop condition applies.

Promotion authorization: invoking `/sdd-apply` against an explicitly selected or unambiguously inferred private Planned Change is permission to run `sdd change promote` without asking for separate confirmation. This authorization applies only when `tasks.md` has exactly `status: planned`, the destination repository is unambiguous, validation passes, no destination collision exists, and project policy permits the operation. It does not authorize planning a Proposed Change, choosing arbitrarily among repositories or drafts, overwriting an existing Change, expanding scope, or bypassing branch and repository policy.

Use `references/specialist-routing.md` to discover and apply materially relevant guidance available in the current runtime. Do not assume particular skills are installed, and do not copy their domain guidance into this skill.

Use `references/risk-closure.md` for every non-trivial Change and whenever work crosses state, persistence, security, configuration, migration, provider, publication, or UI/application boundaries. Maintain its living risk, decision fan-out, verification-environment, verification-scope, phase-closure, and immutable-handoff records in the existing `tasks.md`; planning seeds what is knowable, and Apply adds or revises rows from current implementation evidence.

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

- Default: implement all safe remaining tasks, update artifacts as reality changes, commit every completed verified phase before starting the next one, complete the implementation self-check and remediation loop, transition the Change to `in_review`, and return only when it is ready for independent `/sdd-review` or a defined stop condition blocks that outcome.
- `--step`: run Discovery or one coherent slice, report, and ask before continuing.
- `--no-commit`: keep changes commit-shaped and record commit candidates instead of committing.
- `--review-only`: skip new implementation slices and run the implementation self-check against current implementation and artifacts. This mode does not replace `/sdd-review`.
- `--no-delegate`: use the main thread only. This opt-out overrides the skill's default delegation authorization. Also skip delegation when subagent tooling is unavailable, the slice is tiny, or isolation would create more risk than value.
- `--max-review-iterations N`: explicitly cap hands-off remediation attempts. Without this option, use no fixed iteration cap: continue while safe, in-scope remediation is making progress, and stop only when review readiness is reached or a genuine stop condition remains.

Invoking `/sdd-apply` in default or explicit full mode authorizes local commits for completed, verified slices when project branch policy allows them. A user instruction not to commit or the `--no-commit` flag overrides that authorization. This permission does not authorize push, merge, deploy, rebase, destructive data changes, deleting branches, touching credentials, or marking user acceptance complete.

Closeout is not a special correctness mode. Always maintain closeout readiness as normal workflow truth. Move a change to `docs/changes/closed/` only when the user asks to close, finish, merge-and-close, or otherwise complete it, and only after implementation completion plus a completed `/sdd-review` or an explicit user override that review is not needed.

## Select The Change

Use the explicit path or name if provided. Otherwise:

1. Infer from conversation context when a change was just discussed.
2. List active folders under `docs/changes/`, excluding `docs/changes/closed/`.
3. If no canonical active change is found, inspect legacy `changes/` only as migration input. Do not apply it in place; stop and require migration into `docs/changes/` before implementation continues.
4. Do not apply a Change Brief. Stop and require `/sdd-change --plan`.
5. A dated private Change Draft may be selected only when it is explicit in the request or unambiguous from the conversation. Read `tasks.md` before promotion. If its status is not exactly `planned`, stop, report the current status, and direct the user to `/sdd-change --plan` or `--replan` as appropriate. If it is `planned`, promote it under the authorization above.
6. Auto-select a repository Change only when exactly one active Change exists. Do not arbitrarily auto-select among private drafts.
7. Ask the user when multiple active Changes or destination repositories match, or no Change can be inferred.

Always announce the selected change and how to override it.

## Promote A Planned Change When Needed

When the selected Change is still in the idea-owned private planning path:

1. Confirm it is a dated Change folder with `proposal.md`, `design.md`, and `tasks.md`, and that `tasks.md` has exactly `status: planned`.
2. If the status is anything else, stop and tell the user what it is. Do not silently plan, replan, or promote it.
3. Resolve the active destination repository from workspace configuration. Ask when more than one repository is eligible and the request does not select one.
4. Read destination repository guidance, inspect Git and branch state, and check for a destination Change collision before writing.
5. Run focused validation, then `sdd change promote <space-id> <change-id>` with explicit `--repo` selection when needed. The `/sdd-apply` invocation supplies promotion permission; validation, CLI, collision, and policy failures remain stop conditions.
6. Continue from the promoted repository Change. Discovery must reconcile any repository-specific readiness issue before implementation; route planning-level gaps back to `/sdd-change --replan` instead of inventing scope during apply.

Promotion permission does not authorize push, merge, deploy, rebase, destructive data changes, deleting branches, touching credentials, or any other operation excluded by this skill or project policy.

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
- recent `review.md` findings for the same Epic, subsystem, or behavior boundary when they can reveal a recurring failure class; do not turn unrelated review history into generic scope

Check git status in every repo that may change. Preserve unrelated dirty files. Before code or runtime edits, confirm the current branch satisfies the project-local policy or documented fallback policy. If the change touches an implementation repo associated with the workflow root, read that repo's local guidance before editing.

## Discovery

Start every run with Discovery, even when resuming.

Check that:

- `sdd validate <space-id> --change <change-id> --repo <resolved-repository-path> --workspace <workspace-root> --json` has no unresolved deterministic errors. Inspect warnings and classify intentional compatibility exceptions instead of ignoring them. This structural gate does not replace the semantic Discovery checks below.
- `proposal.md`, `design.md`, and `tasks.md` agree about the change scope.
- `tasks.md` frontmatter has exactly one valid active `status`: `proposed`, `planned`, `in_progress`, or `in_review`. Start implementation only from `planned`; run `sdd change transition <space-id> <change-id> --from planned --to in_progress` before implementation begins. Route a private `proposed` Change to `/sdd-change --plan`; route an active repository `proposed` Change to `/sdd-change --replan`; and treat `in_review` as review-owned unless the requested work explicitly returns it to implementation through the corresponding guarded transition.
- `design.md` identifies whether the change creates new Epic directories, edits existing Epic directories, or both.
- For UI-bearing changes, any required `Experience Design` direction is confirmed, uses stable references, and resolves material responsive, state, accessibility, and visual questions before implementation begins.
- For UI-bearing changes with material component decisions, the `Experience Design` classifies each affected pattern as an existing application component, adopted reference, application-specific component, reference candidate, or deliberate divergence, and names its initial owner plus required preview states. Do not invent a shared-catalog dependency when none is configured.
- For UI-bearing changes, `tasks.md` contains a proportional Visual Verification Matrix naming affected surfaces, routes or fixtures, representative desktop/mobile viewports, relevant states and interactions, expected rendered behavior, and the preferred project tooling or portable fallback. Fill a missing matrix before implementation rather than leaving visual proof implicit.
- each targeted Epic path follows `docs/epics/key-###-epic-name/epic.md`.
- Stories stay embedded in Epic `epic.md` files; do not create `docs/stories/`.
- Epics and Stories are durable but revisable truth; proposed Story moves, splits, merges, renames, and reorders are explicit Epic changes, not accidental implementation cleanup.
- Epic/Story truth is non-negotiable. Do not continue implementation if affected Epic truth is stale, contradictory, or no longer mapped to the behavior being changed unless the current run is actively reconciling it.
- each Story has a stable Epic-scoped label or documented legacy Story ID, local Requirement IDs, local Scenario IDs, independent `Implementation` and `Verification` state, behavior-mapped `Implemented By`, `Implementation Gaps`, scenario-mapped `Verified By`, and `Verification Gaps`.
- each Story has exactly one authoritative current `Implemented By` section and one authoritative current `Verified By` section. Consolidate still-current rows from `Prior`, `Detailed`, `Legacy`, or migration-era maps and move only non-competing history into `Story Notes`.
- each Story normally represents one primary user path. Treat several actors, independently valuable outcomes, separately releasable workflows, title/scope mismatch, more than six Requirements, or more than twelve Scenarios as a split-review signal rather than silently growing a container Story.
- each implemented Requirement has a concrete repository-relative primary application-logic location and stable symbol, export, route, class, configuration key, or searchable anchor. Confirm the anchor identifies the behavior-owning definition, registration, or configuration rather than an import, call site, incidental handler, broad file token, or another symbol in an already-cited file. Supporting adapters, persistence, presentation, configuration, migrations, and support remain distinguishable from the primary owner.
- implemented Stories use `Verified By` as a scenario-mapped evidence index, not as a chronological command log.
- automated evidence names an exact test title or stable named test anchor, not a generic framework token such as `#it(`, `#test(`, or `#describe(`.
- `Verified By` evidence distinguishes focused automated tests, broad supporting gates, deterministic E2E, live-provider playtests, manual UI confirmation, and debug/log inspection instead of collapsing them into one vague "verified" bucket.
- `S#` Story labels are unique within each Epic, full Story references are traceable, and legacy app-wide Story IDs remain unique unless a temporary migration duplicate is explicitly documented as blocking further implementation.
- later Stories or Requirements do not silently supersede earlier Epic truth. If this change revises an earlier boundary, update the older Story wording, implementation/verification state, `Implemented By`, `Implementation Gaps`, `Verified By`, and `Verification Gaps` or record an explicit supersession note.
- Requirements and Scenarios describe observable behavior unless a technical detail is itself user-visible.
- Scenarios are concrete enough to drive tests or manual checks. Do not proceed with generic Scenarios such as "WHEN this Story's workflow is exercised"; patch the artifact or stop for scope clarification.
- the technical approach is sufficient for the next implementation slice without pretending the full implementation sequence is knowable.
- `tasks.md` has a usable `Resume Here`, Requirement/Scenario checklist, implementation and verification ledgers, living risk/confirmation matrix, decision fan-out ledger, verification-environment record, review-handoff candidate, blockers/open questions, and closeout area. Seed missing rows from current artifacts, code, and relevant recent reviews; do not require planning to have predicted every implementation discovery.
- the current branch satisfies project-local policy or documented fallback policy, and dirty state allows safe edits.
- stale or already-implemented behavior cannot satisfy the new Requirements by accident.
- tests and verification plans can prove the production path, not only helper or mock behavior.
- triggered risk contracts are identified: use a Pattern Parity Matrix for new surfaces parallel to established implementations; a Boundary Contract Matrix when important typed results cross service, plugin/capability, adapter, transport, or client layers; and a Stateful Transition Matrix for editable, autosaving, cached, routed, asynchronous, durable, or identity-sensitive state.

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

Finish each phase with its local commit before selecting or delegating the next phase. If a phase grows beyond one coherent review surface, split it at the next green milestone and commit that checkpoint rather than carrying a large undifferentiated working tree.

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
- confirm Story implementation/verification state, `Implemented By`, `Implementation Gaps`, `Verified By`, and `Verification Gaps` updates are accurate
- confirm selected skill guidance was actually applied and any material conflict or departure was explicit
- reject or stop on subagent output that is too broad, unsafe, stale, or unsupported

## Apply Loop

Implement one coherent behavior or capability slice at a time. Before selecting and before closing each slice, re-evaluate the living records in `references/risk-closure.md`; add, split, retire, or strengthen rows as actual code paths, failures, decisions, and available environments become clear.

For UI-bearing slices, follow the recorded component strategy. Inspect existing application previews and configured reference catalogs before creating a materially reusable pattern. Adopt references using the consuming project's ownership model; when no shared runtime ownership model is configured, copy and adapt them into application ownership. Keep application-specific behavior in the application. Treat reference candidates as follow-up signals: do not edit another repository, block the application, or claim standardization unless the accepted Change explicitly includes that work and project policy permits it. Satisfy required preview states through configured component previews or equivalent rendered-route, fixture, browser, or manual evidence; do not introduce a preview tool solely to satisfy this workflow.

For every UI-bearing slice, rendered UI verification is required before review handoff. Prefer existing project browser, screenshot, or component-preview tooling; then use an available runtime browser capability, rendered preview or fixture, or manual browser capture. Start the representative runtime, open the affected surfaces, exercise changed interactions, capture and directly inspect the result, and inspect relevant console and network failures. Cover the proportional Visual Verification Matrix in `tasks.md`, including representative desktop and mobile viewports and applicable default, loading, empty, error, populated, long-content, focus, selected, disabled, permission, and recovery states. A green build, passing non-visual tests, or generated-but-uninspected screenshots are not rendered evidence. Do not add a named tool merely to satisfy SDD; if no available path can render a required surface, record the exact blocked verification or accepted gap.

1. Apply Epic artifact work first when needed.
   - Create or update `docs/epics/key-###-epic-name/epic.md`.
   - Keep Stories embedded in the Epic.
   - Use `assets/epic-template.md` for new or normalized Epic files. When materially editing behavior, implementation/verification state, ownership, gaps, or evidence in an unversioned legacy Epic, normalize the whole file to `sdd-epic-v2`; the schema is Epic-wide, not Story-local. Cosmetic or history-only edits may leave the legacy shape intact.
   - During normalization, do not copy legacy `Status` into both new states. Treat legacy planned/draft/not-implemented states as `Implementation: not implemented` and `Verification: unverified`; inspect code and evidence independently for partial/in-progress/implemented/complete states.
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
   - Use `references/risk-closure.md` to shape deterministic negative, edge, Pattern Parity, Boundary Contract, concurrent/durable Stateful Transition, capability-authority, content-budget/provenance, and filesystem mutation-order coverage around the boundaries the slice actually changes; update the triggered matrices with exact proof and intentional divergences.
   - For resettable or seedable data, verify every mutable field is restored or intentionally preserved; for extraction, parsing, inference, or validation, include an adversarial negative case that mentions the target concept without satisfying it.
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
   - Label the evidence type where it matters; treat broad commands as supporting evidence unless they map to named behavior.
   - For automated evidence, inspect the cited source and record `path#exact test title or stable test anchor` plus the assertion, route, selector, injected failure, or observation that proves the Scenario.
   - Before claiming E2E, migration, auth, recovery, or production-path coverage, confirm the cited source contains the relevant route, command, fixture, failure injection, and assertion, the passing command discovers it, and the evidence proves the claimed implementation boundary. Reopen claims with missing, skipped, broad, undiscovered, or boundary-mismatched proof.
   - Confirm the required safe verification environment actually ran the behavior. A safety wrapper correctly refusing an unsafe target proves the wrapper, not the database-backed, migration, E2E, or live-provider behavior it prevented from running.
   - Leave the repo green before committing; do not commit a merely expected failing-test state unless the user explicitly asks for a checkpoint.
7. Reconcile the Epic Story entry.
   - Update `Implementation` independently from `Verification`: use `not implemented`, `partial`, or `implemented` according to actual Requirement/Scenario coverage.
   - Update behavior-mapped `Implemented By` so every implemented Requirement names its concrete repository-relative primary application-logic location and stable symbol or searchable anchor. `primary` means the governing behavior owner regardless of physical layer. Use multiple narrower primary rows when ownership genuinely splits across layers or Scenarios; classify adapters, persistence, presentation, configuration, migrations, and support separately when they have distinct supporting responsibilities.
   - Inspect the cited source at each changed or newly relied-on primary anchor. Confirm it owns the claimed behavior rather than merely importing, calling, rendering, or sharing a file with the real owner. A file already mapped for one symbol does not cover an unmapped behavior-owning symbol in that file.
   - Keep one canonical implementation and verification map per Story. Merge still-current legacy/detail rows into `Implemented By` or `Verified By` and remove competing map sections; keep historical explanation only in `Story Notes`.
   - Update `Implementation Gaps` with only accepted Requirement/Scenario behavior that does not currently exist. An `implemented` Story has no implementation gaps.
   - Update Story-level `Verified By` as a scenario-mapped evidence index. Each entry should name the concrete test, check, manual scenario, browser path, or review artifact and the Story/Requirement/Scenario IDs it proves. Automated evidence must use `path#exact test title or stable named test anchor`, never a generic framework token such as `#it(`, and include the important assertion or observation. Aggregate Scenarios only when the named proof explicitly exercises each one.
   - Update `Verification` to `unverified`, `partial`, or `verified` according to current scenario evidence and `Verification Gaps`; do not use it as an implementation-progress state.
   - Do not append chronological verification logs to `Verified By`; broad gates such as lint, typecheck, build, codegen, or full CI can appear only as supporting evidence.
   - Keep `Verification Gaps` limited to real gaps, deferrals, or weaker-than-required evidence.
   - After a behavior-preserving refactor, update changed code anchors and rerun focused proof for affected Requirement/Scenario rows. Preserve prior verification only when the assertion and relevant behavior boundary remain unchanged and the check still passes; otherwise downgrade `Verification` or record the gap. Update `last_verified` only from current proof.
   - Search affected Epic Stories for older wording that this slice supersedes. Reconcile stale Requirements, Scenarios, implementation/verification state, `Implemented By`, `Implementation Gaps`, `Verified By`, `Verification Gaps`, and notes before claiming the current Story is done.
   - Reconcile the Epic Outcome tense with reality: implemented behavior reads as current capability, wholly unimplemented behavior as future capability, and partial behavior states both the current capability and explicit gap.
   - Recheck related README/current-state docs and active or closed Change artifacts for stale implementation, verification, pending-closeout, branch, manual-confirmation, or active-folder claims.
8. Run rendered UI verification for UI-bearing changes.
   - Reconcile or create the `Visual Verification Matrix` in `tasks.md` before running it; keep rows proportional to affected surfaces and risks.
   - Use current source and representative data. Exercise changed interactions instead of capturing only a static launch state.
   - Directly inspect every captured screenshot or rendered result for hierarchy, clipping, overlap, wrapping, overflow, density, state clarity, focus, disabled behavior, accessibility basics, and visual identity as applicable.
   - Inspect browser console errors and relevant failed or unexpected network requests. Record whether each was clean, explained, or a finding.
   - Record the surface, route or fixture, viewport, state or interaction, tool/setup, inspected evidence, console/network result, and outcome in the matrix. Evidence may remain local unless project policy requires committing it.
   - Treat missing required rendered access as a verification gap that blocks review readiness unless the user explicitly accepts it; never silently replace it with source inspection.
9. Update the manual UI confirmation checklist.
   - When the slice changes browser-visible UI, user flows, interaction behavior, empty/error/loading states, permissions, data entry, navigation, or other manually observable app behavior, add or refresh a `Manual UI Confirmation` section in `tasks.md`.
   - Walk the user through the exact app URL or route, required local server state, seed/test data or account, steps to perform, expected observations, known acceptable rough edges, and what feedback would count as a defect, requirement refinement, verification gap, artifact drift, scope expansion, or product drift.
   - Keep the checklist short enough to execute. Prefer a few high-value end-to-end confirmations over repeating every automated assertion.
   - If no manual UI confirmation applies, record `Not applicable` with the reason.
   - Record manual confirmation status in `tasks.md` as `not applicable`, `pending user`, `user confirmed`, or `accepted gap`.
   - Treat the user's response to the checklist as Manual Feedback Loop input for the same change.
10. Update project-defined release communication when warranted.
   - Follow the configured location and format; do not impose a changelog convention the project has not adopted.
   - Add only content required by project policy, keep it public-safe when public, and ensure every behavior claim matches Epic truth and evidence.
   - Use `assets/changelog-template.md` only for a project that selected Keep a Changelog and needs an initial file.
   - If no release-communication update is needed, record the reason in `tasks.md`.
11. Reconcile affected project docs under `docs/`.
   - Treat project docs as supporting documentation, not canonical Epic/Story truth.
   - Update docs whose truth value changed, including architecture, testing, deployment, style, data/API contracts, operations, README, or current-state docs.
   - If a relevant doc is missing, create it only when project-local guidance requires it or when the change needs a new durable support document.
   - If no project docs need updates, record the reason in `tasks.md`.
12. Update `tasks.md`.
   - Refresh `Resume Here`.
   - Mark completed Requirement and Scenario checklist items.
   - Add a short implementation ledger entry.
   - Add verification ledger entries.
   - Update the Implementation Risk And Confirmation Matrix, triggered Pattern Parity Matrix, triggered Boundary Contract Matrix, triggered Stateful Transition Matrix, Decision Fan-Out Ledger, Verification Environment, Verification Scope Decision, and Review Handoff Candidate from the slice's discoveries and evidence.
   - Add or refresh the Visual Verification Matrix and rendered-verification status.
   - Add or refresh manual UI confirmation steps and status.
   - Keep closeout fields consistent with reality: review record, manual confirmation status, release-communication status, PR/merge state, deferred gaps, and folder location.
   - Record any superseded Story/Requirement/Scenario wording and the artifact reconciliation performed.
   - Keep old proposal/design status text from contradicting completed work. If design sections still say `Not implemented yet`, `Not verified yet`, or implementation is pending after implementation has landed, update or clearly mark that text as historical before closeout.
   - Record consequential skill guidance or delegation outcomes only when they changed implementation, verification, artifacts, or stop conditions; also record blockers, departures, and commit hashes or commit candidates.
   - Keep `status: in_progress` while implementation, verification, remediation, or unresolved blockers remain. Run `sdd change transition <space-id> <change-id> --from in_progress --to in_review` only after implementation is complete and the Change is ready for independent `/sdd-review`.
   - Before the implementation commit exists, record the relevant ledger rows as `commit pending`, `uncommitted`, or a clear commit candidate rather than inventing a hash.
13. Commit locally when authorized, the slice is verified, and changes are commit-shaped.
   - In default/full mode, this is a required phase-boundary action before selecting, delegating, or implementing the next Requirement/Scenario. Do not postpone all commits until implementation completion or review handoff.
   - Prefer one focused commit for each coherent Requirement/Scenario phase. Combine slices only when they are inseparable to build or verify; split an unusually long phase into additional coherent, green checkpoint commits.
   - Recheck the diff and `git status`, stage only the exact intended files, and confirm the commit includes the implementation, tests, and truthful artifact reconciliation needed for that phase.
   - Do not stage unrelated dirty files.
   - Keep app/source commits separate from vault/workflow commits unless they are the same repo.
   - After a commit succeeds, immediately update `tasks.md` so `Resume Here`, the implementation ledger, verification ledger, closeout state, and PR/merge state reference the real commit hash.
   - After the commit boundary exists, run any commit-sensitive, generated-contract, clean-tree, migration, or exact-candidate checks whose result could differ from the uncommitted working tree.
   - If that post-commit ledger update changes `tasks.md`, make a small ledger-only follow-up commit. This keeps cold-resume state accurate instead of leaving `tasks.md` with stale `uncommitted` or `commit pending` entries.
   - In `--no-commit` mode, do not make either commit; keep `tasks.md` on commit candidates and say that hashes remain pending.

In default/full mode, loop back to the next pending Requirement or Scenario after every completed phase. Do not end the run while safe in-scope tasks, verification, artifact reconciliation, self-check findings, or the final guarded transition to `in_review` remain. Continue until the Change is ready for independent `/sdd-review` or a genuine stop condition is hit. In `--step`, stop after the requested bounded slice.

## Verification Scope And Candidate Gates

Keep three proof layers distinct:

- **Focused proof** establishes individual Requirements and Scenarios and remains the basis of Epic `Verified By` maps.
- **Aggregate candidate proof** establishes that the complete committed source candidate passes the project-required combined gate. Resolve the command from project guidance, testing/CI docs, workflow files, and package scripts. Require it when project policy says so or when the final diff crosses multiple capabilities, persistence or migrations, auth/security/privacy boundaries, process-global state, shared contracts, concurrency/workers/recovery, or another surface where isolated checks can conceal integration failures.
- **Integration-candidate proof** establishes the prospective source-plus-current-target result when the target has advanced, contains accumulated Changes, requires conflict resolution, or otherwise produces a materially different tree. `/sdd-review` owns final integration-candidate judgment, but Apply must record the known obligation and target baseline.

Do not require every project to expose the same command name or constituent list. Prefer one project-defined aggregate command when available; otherwise record the authoritative constituent commands and why they are equivalent. Run required aggregate proof after the final implementation commit, against that exact commit, with caches bypassed or freshness proved. Record the command, commit, meaningful execution/count evidence, cache/freshness treatment, and result in `tasks.md`. A later evidence-record-only commit may reuse that result only after its diff is classified and every gate that observes the changed artifacts is rerun; any behavior, test, dependency, configuration, migration, generated, executable, or gate-observed change invalidates the prior result. A focused pass, a green command that skipped meaningful work, an earlier behavior candidate's result, structural SDD validation, or unavailable remote CI does not satisfy a required aggregate gate.

## Verification And Implementation Self-Check

Before reporting the change as implemented or ready for `/sdd-review`, run an implementation self-check. This is the apply-side sanity check that the implementation slice is complete, reconciled, and ready for independent review; it is not the local PR-style `/sdd-review` gate. Cover:

- Proposal Scope: implemented work matches the proposed change or recorded approved departures.
- Design Fidelity: technical approach, alternatives, constraints, decisions, and risks remain accurate.
- Epic Truth: Epic Stories, Requirements, Scenarios, implementation/verification state, behavior-mapped `Implemented By`, `Implementation Gaps`, scenario-mapped `Verified By`, and `Verification Gaps` match reality.
- Canonical Map Authority: every Story has one current implementation map and one current verification map; no `Prior`, `Detailed`, `Legacy`, or migration-era map competes with the canonical sections.
- Cold Navigation: beginning from each changed Requirement or Scenario, a fresh developer can identify the primary governing code location and verification evidence without a repository-wide rediscovery search. Missing primary anchors, anchors that land only on imports/call sites/incidental handlers, undifferentiated file dumps, already-cited files that hide unmapped symbols, or mappings that stop at tests/UI while hiding application logic are findings.
- Supersession Reconciliation: later work has not left earlier Stories, Requirements, Scenarios, implementation/verification state, `Implemented By`, `Implementation Gaps`, `Verified By`, or `Verification Gaps` with stale assumptions.
- Story Reference Traceability: new or modified Stories keep stable Epic-scoped labels or documented legacy Story IDs; Requirements use local `R#` IDs; Scenarios use local `R#-S#` IDs; verification evidence does not rely on stale `AC-#` labels unless they are explicitly marked as legacy references.
- Story Reference Uniqueness: no duplicate `S#` labels exist within a single Epic, no duplicate full Story references exist, and no duplicate legacy app-wide Story IDs exist unless an explicit migration note blocks relying on the duplicate.
- Test And Coverage: user-visible behavior has concrete proof, risky fake/mock/helper boundaries have production-path proof or explicit gaps, and the Verification Scope Decision correctly distinguishes focused, aggregate-candidate, and integration-candidate obligations.
- Pattern Parity, Boundary Contracts, And Stateful Transitions: every triggered matrix has an inspected reference or starting state, applicable concern, mapping, edge or interleaving, focused proof, and explicit divergence or gap. Cross-layer error collapse, static rendering, source-shape similarity, or a broad green suite is not enough.
- Risk-Shaped Evidence: the living risk matrix covers the actual changed boundaries and every row is proved, explicitly accepted, or blocking. Do not treat an artifact claim such as "reset works", "stable identity", "autosave flushes", "validation rejects bad output", or "remote configuration fails clearly" as verified unless a test, browser/manual check, or source inspection directly supports that exact property.
- Evidence Claim Integrity And Typing: important claims were falsified against the cited source, exact test/anchor, assertion or observation, discovery path, and implementation boundary; generic framework anchors such as `#it(` are rejected; deterministic E2E, live-provider, manual, broad-gate, and debug evidence remain distinct. Missing, skipped, broad, or boundary-mismatched proof is a gap, not a pass.
- Rendered UI Verification: every UI-bearing surface affected by the Change was rendered from current source, relevant interactions were exercised, screenshots or rendered results were directly inspected, representative desktop/mobile and applicable state rows were covered, console/network findings were checked, and the Visual Verification Matrix records the evidence. Screenshot generation alone is a finding, not a pass.
- Manual UI Confirmation: for browser-visible or otherwise user-facing app changes, `tasks.md` includes a clear walkthrough the user can execute, with expected results and how feedback should be classified.
- Code Quality: changed code is scoped, maintainable, and avoids speculative rewrites.
- Security And Data Safety: auth, permissions, untrusted-output publication, persistence, existing-data migrations and rollback, secrets, and destructive paths are handled or explicitly out of scope. Capability-style identifiers retain issuer/scope/lifetime authority, every provider-visible content path participates in required budget/provenance accounting, and filesystem writes validate existing ancestors and confinement before mutation with fail-closed no-write proof.
- Docs And Artifacts: the decision fan-out ledger reconciles affected runtime defaults, configuration examples, generated contracts, project docs under `docs/`, README/current-state docs, and change artifacts without inventing a fixed docs inventory.
- Release Communication: the project-defined release record is updated when required, or `tasks.md` records why no entry is needed.
- Review Handoff Readiness: the exact committed candidate differs from its integration target, intended implementation is committed, unrelated dirty state is identified, required environments actually ran, commit-sensitive checks and any required aggregate candidate gate pass on that exact commit, and remaining integration-candidate obligations plus later `/sdd-review` needs are clear.
- Commit Cadence: every completed verified phase has its own coherent local commit, or `tasks.md` records the exact `--no-commit`, user-policy, repository-policy, or isolation reason it remains a commit candidate. Multiple independently reviewable phases have not been accumulated into one undifferentiated commit.
- Closeout Readiness: `tasks.md` has no contradictory Resume Here, checklist, review record, manual confirmation status, release-communication status, PR/merge state, deferred-gap, or folder-location claims.
- Closed-Artifact Readiness: related proposal/design/tasks/review files do not still claim implemented work is unimplemented, unverified, pending, or accepted under obsolete status vocabulary.
- Changed-Surface Reverse Traceability: run the packaged `sdd-orphan-audit` script in JSON mode with `--changed-from <integration-target-or-merge-base>` and one `--epic <epic-id>` pass per affected Epic. Classify every behavior-test and source candidate as Epic-owned, supporting/generated/framework infrastructure, an explicit gap, or tracked cleanup before handoff. If the script is unavailable, perform and record an equivalent current-working-tree inventory; do not silently skip the gate.
- Refactor Stranding: when the change removes, replaces, or relocates implementation, explicitly search for old imports, routes, registrations, constructors/dependencies, tests, migrations, generated bindings, and files left behind by the previous path.

Use fresh-context delegated self-check passes by default for substantial changes and whenever practical for normal implementation. Delegate at least pattern parity when sibling implementations changed, boundary-contract preservation when typed results cross layers, concurrent/durable behavior and state transitions, evidence-claim integrity, code, authority/budget/mutation safety, and fan-out/supporting-truth checks when the changed surface is non-trivial; include environment and immutable-candidate readiness where relevant. This implementation self-check does not replace `/sdd-review` as the local PR gate. The orchestrator remains responsible for final judgment and verification of important claims.

Run the implementation self-check as one complete discovery wave before remediation: start materially relevant passes together, collect their complete results, validate and deduplicate findings, and group them by root cause. Explicitly compare new sibling surfaces with established behavior contracts and challenge relevant cross-cutting risks such as typed-result preservation across layers; concurrent start/cancel/replacement/retry; mounted refresh, remount, restart, and durable records unknown to the client; capability issuer/scope/lifetime; content-budget and provenance bypass; filesystem ancestor validation before mutation; identity changes; pending-write navigation; session expiry; retry/timeout behavior; migration immutability and upgrade behavior; existing-data compatibility; async focus or draft preservation; responsive accessibility; CI/dependency validity; generated-contract drift; and fresh-install versus existing-install behavior. Independently open the cited proof for high-risk evidence claims instead of accepting the ledger or a green aggregate command. Mark irrelevant classes `not applicable` rather than expanding scope.

Automatically remediate the complete safe, in-scope finding set as one batch. Then run the union of affected focused checks and required broad gates once, followed by one regression-focused self-check of changed surfaces. Do not stop after each finding, ask the user to resume between ordinary remediation slices, or rerun unaffected specialist passes without a concrete reason. Without an explicit `--max-review-iterations`, repeat this remediation and focused recheck loop while safe progress remains until the self-check is clean. Stop only when an explicit iteration cap is reached, remediation introduces a genuinely unresolved regression, or a finding needs user judgment or crosses another stop condition.

## Completion And Closeout

A change is implementation-complete only when:

- all required tasks are complete or explicitly deferred with a reason.
- targeted Epic files exist and match the implemented behavior.
- new or modified Stories, Requirements, and Scenarios follow the stable label/reference convention.
- Story implementation/verification state, behavior-mapped `Implemented By`, `Implementation Gaps`, scenario-mapped `Verified By`, and `Verification Gaps` are current.
- superseded or revised earlier Story truth has been reconciled, not merely contradicted by a later Story.
- meaningful verification has passed or gaps are explicit.
- triggered Pattern Parity, Boundary Contract, and Stateful Transition Matrix rows are resolved; applicable capability authority, budget/provenance conservation, and filesystem mutation-order claims are proved; and new or high-risk evidence claims survive inspection of their exact test/anchor, important assertion or observation, discovery path, and implementation boundary.
- required rendered UI verification is complete and directly inspected for UI-bearing changes, or an unavailable surface is recorded as a blocking or explicitly accepted gap.
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
- every completed verified phase has been committed at a coherent boundary, or its commit candidate and exact blocking/opt-out reason are recorded.
- every living risk row and decision fan-out row is resolved, explicitly accepted, or blocking; every required verification environment actually ran or has an explicit accepted gap.
- the Verification Scope Decision is current; every required aggregate candidate gate passed freshly on the exact final committed candidate, with meaningful execution evidence, or remains an explicit blocker rather than an implied focused-test substitution.
- the review handoff names an immutable committed candidate, its integration target/merge base, unrelated dirty state, and passing commit-sensitive checks; intended implementation is not stranded only in the working tree.

Implementation-complete means ready for `/sdd-review`. Do not treat implementation completion as local PR readiness.

In default/full mode, do not report a partial-success handoff while any implementation-completion criterion remains safely achievable. Once every criterion is satisfied, run the guarded `in_progress` to `in_review` transition, rerun scoped validation, and only then report the Change as ready for `/sdd-review`. If readiness cannot be reached, name the exact Stop Condition and the evidence showing why continued safe in-scope work cannot resolve it.

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
- a required aggregate candidate gate is missing, stale, cached without freshness proof, ran against a different commit, skipped meaningful constituents, or fails without a safe in-scope fix.
- duplicate Story labels inside one Epic, duplicate full Story references, or duplicate legacy app-wide Story IDs exist without an explicit migration/blocking note.
- a later Story or implementation slice supersedes earlier Epic truth that has not been reconciled.
- risky production-path behavior is only covered by mocks/helpers and no explicit gap is acceptable.
- a required safe verification environment is unavailable, its evidence obligation has no accepted gap, and no remaining independent slice can make safe progress.
- a required UI-bearing surface cannot be rendered or directly inspected with available project or runtime capabilities and the gap has not been explicitly accepted.
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
- risk/confirmation closure, decision fan-out reconciliation, required verification-environment results, and the immutable review candidate
- rendered UI verification matrix result, inspected evidence, viewports/states covered, and console/network outcome, or why it is not applicable
- manual UI confirmation walkthrough for the user, or why none applies
- commits by repo or commit candidates
- remaining gaps or blockers
- Change status, closeout readiness, and any contradictory state
- whether `/sdd-review`, closeout, or acceptance remains pending

Before reporting success, confirm that Discovery ran, branch/git state was checked, focused verification ran, required rendered UI evidence was directly inspected, applicable manual UI confirmation steps were produced, Epic and change artifacts were reconciled, `tasks.md` can cold-resume the work, and no disallowed git/deploy/destructive action occurred.
