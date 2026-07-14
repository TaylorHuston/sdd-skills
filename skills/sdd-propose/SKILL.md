---
name: sdd-propose
description: Create or update a minimal SDD change artifact set with proposal.md, design.md, and tasks.md. Use when the user invokes /sdd-propose or /sdd-propose --replan, asks to propose, scope, define the technical design for, prepare a product change, or revise an active change after newly discovered Requirements, Scenarios, constraints, or scope concerns need planning before implementation resumes. Adapts from small fixes to whole-Epic changes while preserving concrete Stories, Requirements, Scenarios, evidence planning, manual confirmation, release-communication impact, and closeout-ready task ledgers.
---

# SDD Propose

Create or refresh one change folder. This is workflow-based like OpenSpec's propose step, but it does not depend on a CLI, schema engine, separate approach skill, or separate implementation record skill.

## Authority And Project Profile

Resolve the workspace, idea-owned planning path, and target implementation repository with `sdd context <relevant-path> --json`, then read `<workspaceRoot>/.sdd/story-driven-development.md` completely before defining Stories, Requirements, Scenarios, evidence, or Change status. Use the resolved topology unless project guidance declares an explicit exception, then enforce changes under `docs/changes/`, Epics under `docs/epics/`, and ADRs under `docs/adrs/` inside the implementation repository. Project guidance owns branch/write policy, release conventions, required supporting docs, technology constraints, and available specialist guidance. If the managed workflow document is missing, stop and direct the user to `sdd init` or `sdd doctor`.

Use `/sdd-interactive` instead when the user wants to create a lightweight tracked change and immediately work through small edits in the same interactive session.

Use `/sdd-propose --replan` when an active `/sdd-apply` run or manual feedback discovers new or changed Requirements, Scenarios, constraints, Epic ownership, or scope questions that need planning before more code changes. This mode updates the active change's planning artifacts, then hands back to a fresh `/sdd-apply`.

## Output

Write these files:

```text
<project-root>/docs/changes/<yyyy-mm-dd-change-name>/proposal.md
<project-root>/docs/changes/<yyyy-mm-dd-change-name>/design.md
<project-root>/docs/changes/<yyyy-mm-dd-change-name>/tasks.md
```

Also invoke `/sdd-adr` to draft ADRs when the proposal makes a durable architecture decision:

```text
<project-root>/docs/adrs/<yyyy-mm-dd-decision-title>.md
```

Use:

- `assets/proposal-template.md`
- `assets/design-template.md`
- `assets/tasks-template.md`
- `assets/epic-template.md` when proposing or creating a new Epic shape
- `/sdd-adr` and its `assets/adr-template.md` when an ADR is needed

## Workflow

1. Resolve the change input.
   - If invoked with `--replan`, select an existing active change folder instead of creating a new one.
   - In `--replan`, accept the discovery as prose, a `tasks.md` Manual Feedback entry, a review finding, failing test, implementation note, or explicit user instruction.
   - In `--replan`, stop and ask which active change to revise when multiple changes could own the discovery.
   - Accept either a kebab-case change name or a plain-language change description.
   - If no clear change is provided, ask what the user wants to build or change.
   - Derive a short kebab-case `<change-name>` when the user provides prose.
   - Prefix the change folder with today's local date from the shell clock: `yyyy-mm-dd-<change-name>`.
2. Locate the idea planning root and target implementation repository.
   - Prefer explicit idea or repository paths from the user.
   - Otherwise use the result of `sdd context <relevant-path> --json`, including its idea, planning path, repository, role, resolved path, and related repositories.
   - Apply explicit project guidance only when it intentionally overrides the configured topology for this operation.
   - Use a unique idea/repository basename match only as a compatibility fallback when no configured mapping exists; do not silently persist that fallback as canonical ownership.
   - Ask when an idea maps to multiple plausible target repositories, a repository is claimed by multiple ideas, or ownership remains ambiguous.
   - Otherwise use the nearest implementation root with `.git/`, `package.json`, `docs/`, `AGENTS.md`, or existing `docs/changes/` and continue without private planning context only when the change does not depend on it.
   - Do not write to the workflow root unless the workflow root itself is the intended project.
3. Load only the context needed to propose accurately.
   - Read project guidance such as `AGENTS.md`, `README.md`, and product/PRD context when present.
   - Read the project-defined release communication when it exists and the change may affect it.
   - Read project planning docs or PRD/Product Brief files when available; if product direction is missing or stale and the change depends on it, recommend `/sdd-prd` without blocking small experiments.
   - Inspect existing active changes under `docs/changes/` and closed changes under `docs/changes/closed/` only enough to avoid duplicate or conflicting scope.
   - In `--replan`, read the active change's `proposal.md`, `design.md`, `tasks.md`, any `review.md`, relevant implementation ledger entries, manual feedback, recent failing/passing checks, and enough current code or tests to understand the discovery.
   - Inspect legacy `changes/` only enough to avoid duplicate scope or identify migration input; do not continue or create SDD changes there.
   - Inspect existing Epic directories under `docs/epics/`.
   - Read existing `docs/epics/<key>-<###>-epic-name/epic.md` files when the change may modify them.
   - Scan target `docs/epics/**/epic.md` files for existing Story labels/references. New or normalized Epics should use Epic-scoped Story labels such as `S1`; legacy app-wide Story IDs may remain when existing references depend on them.
   - Read code only when current behavior needs accurate `Implemented By` or `Verified By` maps.
4. Create or continue the change folder.
   - In `--replan`, require an existing active `docs/changes/<yyyy-mm-dd-change-name>/` folder with `proposal.md`, `design.md`, and `tasks.md`.
   - In `--replan`, do not create a second change unless the discovery is outside the current change and should become follow-up scope.
   - Create `docs/changes/<yyyy-mm-dd-change-name>/` when it does not exist.
   - If any target artifact already exists, read the existing artifacts and continue only when the user's intent is clearly to revise the change. Otherwise ask whether to revise it or create a differently named change.
   - If a matching legacy `changes/<yyyy-mm-dd-change-name>/` exists, require migration to `docs/changes/` or use a differently named canonical change. Do not continue it in place or silently create duplicate active truth.
5. Interview and refine the proposal/design boundary.
   - First summarize the proposed scope boundary from the user's request, PRD/Product Brief, existing Epics, existing changes, and current implementation reality.
   - Ask the user all questions needed to properly design the proposal, Epic actions, Stories, Requirements, Scenarios, technical options, current and plausible future clients, API/frontend/backend boundaries, constraints, verification strategy, ADR needs, and task ledger.
   - Do not treat context synthesis as a substitute for interviewing. If Story boundaries, Requirement wording, Scenario coverage, client/API boundaries, data/auth/security constraints, ADR decisions, or verification strategy are materially unsettled by durable project docs, ask before drafting final artifacts.
   - Present the candidate Story/Requirement decomposition before finalizing it when the change affects user-visible behavior, durable Epic truth, public contracts, data, auth/security, or more than one plausible technical path.
   - Challenge each proposed Story before accepting it: it should describe a real user or system capability, belong in the named Epic, avoid UI-task fragmentation, and have Requirements/Scenarios that are observable enough to verify.
   - Challenge each Requirement and Scenario before accepting it: Requirements should be concrete `The system SHALL ...` behavior rules, and Scenarios should cover the relevant happy path, empty state, failure mode, permission/validation case, recovery path, integration boundary, or security-sensitive condition.
   - Challenge the verification plan before accepting it: `Verified By` should be able to become a scenario-mapped evidence index, not a command history or broad gate with no Requirement/Scenario mapping.
   - Keep questions inside the proposed change scope.
   - Do not ask questions that would materially expand product scope, user-visible behavior, Epic ownership, data model, auth/security model, public API, deployment behavior, or external-service state.
   - If a scope-expanding question seems relevant, name it as out of scope or future work instead of pulling it into the current proposal.
   - Do not treat user interest in a broader idea as permission to expand the current change unless the user explicitly says to expand this proposal's scope.
   - For MVP work, bias toward the smallest proof loop that satisfies the stated MVP question; record adjacent product ambitions as deferred scope.
   - Ask whether the scoped change should update public release communication only when that is not obvious from the proposal context or project policy.
   - Prefer one high-leverage question at a time when the answer materially affects the design. Batch only tightly related naming or yes/no details when waiting would not improve the proposal. Do not ask questions already answered by project docs, existing Epics, existing changes, implementation, tests, or PRD context.
   - If the user declines to answer or asks to proceed, record the unresolved decision as an assumption, open question, candidate Story, or deferred scope instead of silently promoting it into accepted Requirements.
   - Stop interviewing only when remaining uncertainty can be recorded as an open question without weakening the proposal.
   - A proposal is too weak to finalize when it contains generic Stories, generic Scenarios, unmapped verification, or silent assumptions about product scope, Epic ownership, API/client boundaries, data, auth/security, or durable architecture decisions.
   - In `--replan`, focus the interview only on the discovered requirement, why the current plan is insufficient, whether it belongs in the current change, and what must be true before `/sdd-apply` resumes.
6. Draft `proposal.md`.
   - Explain why the change exists and what it changes.
   - List proposed Epic actions: create a new Epic directory, update an existing Epic directory, or both.
   - Use Epic directory names shaped as `<key>-<###>-<epic-name>` and an `epic.md` file inside each directory.
   - Capture scope-expanding ideas from the interview as deferred scope or future work, not as current Epic actions.
   - Add release-communication impact: required, not required, or TBD; if required, name the configured record and likely section when known.
   - Capture open questions and impact without making low-confidence implementation claims.
7. Draft `design.md`.
   - Describe the target Epic changes and high-level technical approach in enough detail for review before implementation.
   - Start from the refined Story/Requirement decomposition produced by the interview. Do not invent final Stories, Requirements, or Scenarios solely from implementation guesses when material user or product choices remain open.
   - Record the planning interview results: scope decisions, user decisions, assumptions, deferred scope, Story/Requirement refinements, Scenario gaps considered, and any open questions that would block implementation.
   - For non-trivial changes, explore multiple viable technical paths before choosing one. Usually compare 2-3 options; use one option only when the decision is obvious and record why.
   - Compare options on user impact, implementation complexity, reversibility, client surfaces, API/contract shape, frontend/backend boundary, data/schema implications, auth/security implications, testability, operational risk, migration/rollout needs, and fit with project conventions.
   - Select one approach, explain why it is the best fit, and name what would cause the team to reconsider.
   - For each new or modified Epic, include capability-level Stories.
   - For new or normalized Epics, give each new Story a stable Epic-scoped label such as `S1`, `S2`, or `S3`, unique within that Epic. Use full references such as `EPIC-ID/S1` and `EPIC-ID/S1/R2-S3` outside the Epic.
   - Preserve existing legacy app-wide Story IDs, such as `OD-010`, when tests, reviews, generated indexes, commits, or migration history already depend on them. Do not invent UUID-like Story handles for new embedded Stories.
   - Write Story headings with the label visible, such as `### Story S1: Dashboard Vault Intelligence Tab`. Put the `As a ..., I want ..., so that ...` sentence directly under the Story heading.
   - Number Requirements locally inside each Story as `R1`, `R2`, `R3`, restarting at `R1` for each Story.
   - Number Scenarios locally under each Requirement as `R1-S1`, `R1-S2`, `R2-S1`, and so on.
   - Under each Story, write Requirements using `The system SHALL ...`.
   - Under each Requirement, write concrete Scenarios using `WHEN`, `THEN`, and optional `AND`.
   - Do not mechanically convert acceptance criteria into generic Scenarios. Each Scenario must name a concrete trigger, state, failure mode, permission case, empty state, recovery path, or observable condition.
   - Add one `Implemented By`, one `Verified By`, and one `Verification Gaps` section per Story.
   - Treat `Verified By` as a behavior evidence index: focused tests, checks, review artifacts, or manual scenarios should map to Story/Requirement/Scenario IDs. Chronological command history belongs in `tasks.md`.
   - Separate evidence types when planning verification: focused automated tests, broad supporting gates, deterministic E2E, live-provider playtests, manual UI confirmation, and debug/log inspection prove different things.
   - For unimplemented work, write `Not implemented yet.` and `Not verified yet.` rather than inventing future files or tests.
   - When creating a new Epic, identify its proposed directory and `epic.md` path.
   - When editing an existing Epic, identify the target `epic.md` path and distinguish added, modified, and removed Story/Requirement scope.
   - When editing an existing Epic, identify earlier Stories, Requirements, Scenarios, evidence, or gaps this change may supersede, and plan explicit reconciliation instead of relying on a later Story note to override old truth.
   - Include the chosen technical approach, intended client surfaces, API or typed-contract boundary, important constraints, alternatives considered, and why the chosen approach was selected.
   - When web, mobile, CLI, automation, admin, or integration clients are plausible, identify which product capabilities belong behind a reusable backend authority layer and which behavior is client-specific presentation or local state.
   - Add an ADR decision when the change chooses a durable architecture, API boundary, client/platform boundary, data, integration, deployment, dependency, auth/security, state-management, storage, or cross-cutting project convention that future changes should respect.
   - Do not create ADRs for ordinary implementation details, one-off tactical choices, reversible UI layout choices, or decisions that are already clearly governed by existing project guidance.
   - Do not turn deferred or scope-expanding ideas into Stories, Requirements, Scenarios, or tasks for this change.
   - Scale the detail to the change: one paragraph may be enough for a small change; broad or risky changes should capture architecture, client/API boundaries, data, auth, dependency, migration, state-transition, verification, and rollout implications as relevant.
8. Invoke `/sdd-adr` when needed.
   - Use `/sdd-adr` to create or update ADR drafts when the chosen technical approach creates a durable rule future work should follow.
   - ADR path is `docs/adrs/<yyyy-mm-dd-decision-title>.md`.
   - Link each ADR from `design.md` and list it in `proposal.md` impact when relevant.
   - Keep ADRs concise: context, decision, considered options, consequences, validation, and status.
   - Use status `Proposed` during `/sdd-propose`; `/sdd-apply` or `/sdd-review` can update status only when implementation and review justify it.
   - If an ADR seems useful but not enough is known, record an ADR candidate in `design.md` instead of inventing a final decision.
9. Draft `tasks.md`.
   - Treat `tasks.md` as the lightweight implementation ledger and resume surface for the change.
   - Start YAML frontmatter with `status: proposed`. Use only `proposed`, `in_progress`, `review`, `replanning`, or `ready_to_close`; never write `closed` as a status.
   - Keep tasks at artifact, Story/capability, verification, and review level; do not write a file-by-file execution script.
   - Include a `Resume Here` section that can be updated during implementation.
   - Include a compact task checklist, implementation ledger, verification ledger, open blockers, and closeout checklist.
   - Include a task to update the project-defined release communication when its impact is required or TBD.
   - Include tasks to create, update, or review ADRs when `design.md` names ADRs or ADR candidates.
   - Include a review task for `/sdd-review`, manual confirmation status using `not applicable`, `pending user`, `user confirmed`, or `accepted gap`, review record status, release-communication status, PR/merge state, ADR status, accepted deferred gaps, superseded-truth reconciliation, stale proposal/design status cleanup, and a closing task that moves the completed change folder to `docs/changes/closed/` only after review/PR/merge/acceptance state is clear.
   - In `--replan`, add a dated `Planning Updates` entry describing the discovery, classification, artifacts changed, and the next `/sdd-apply` starting point.
10. Verify the artifacts.
   - Confirm all three files exist.
   - Confirm any ADR files named by `proposal.md` or `design.md` exist, or that `design.md` clearly labels them as ADR candidates not yet created.
   - Re-read them before final response.
   - Check that `proposal.md` names intended Epic actions.
   - Check that `proposal.md` records release-communication impact.
   - Check that `proposal.md` and `design.md` record the interview results: confirmed scope decisions, deferred scope, assumptions, unresolved questions, and any user decisions that shaped the Story/Requirement decomposition.
   - Check that `design.md` gives each Story a stable Epic-scoped label or documented legacy Story ID, local Requirement IDs, local Scenario IDs, `Implemented By`, `Verified By`, and `Verification Gaps`, plus right-sized technical options, selected approach, constraints, and ADR decisions or ADR non-applicability.
   - Check that each Story has been challenged for user-path fit and Epic ownership, each Requirement is an observable behavior rule, each Scenario names a real trigger/state/result, and the verification strategy can map evidence to Story/Requirement/Scenario IDs.
   - Check that `design.md` records any existing Epic truth that may be superseded and the intended reconciliation.
   - Check that `tasks.md` can replace a separate implementation stub or ledger for this change and includes review record, manual confirmation status, release-communication status, PR/merge state, ADR status, accepted deferred gaps, superseded-truth reconciliation, stale proposal/design cleanup, and closeout fields.
   - Stop and ask a follow-up question instead of finalizing when a blocking ambiguity would make Stories, Requirements, Scenarios, or verification misleading.
   - In `--replan`, check that `Resume Here` points to the next `/sdd-apply` run and no stale checklist or blocker claims contradict the revised plan.

## Replan Mode

Use `/sdd-propose --replan` for mid-change discoveries that need planning before implementation continues.

Use this mode when:

- implementation or manual testing reveals a new Requirement or Scenario;
- an existing Requirement or Scenario needs a meaningful semantic change;
- a newly discovered constraint affects architecture, client surfaces, frontend/backend boundaries, data, auth, API, migration, rollout, verification, or Epic ownership;
- the discovery may still belong in the active change, but it is too substantive for the `/sdd-apply` manual feedback loop alone.

Do not use `--replan` for simple defects, missing tests, stale `Implemented By` / `Verified By` entries, small artifact drift, or narrow implementation fixes that `/sdd-apply` can handle directly.

In `--replan`:

1. Set `tasks.md` frontmatter to `status: replanning`, then classify the discovery as `in-scope refinement`, `scope expansion`, `product drift`, `Epic ownership change`, `technical constraint`, or `follow-up change`.
2. Preserve the current change when the discovery is necessary to satisfy the original goal or accepted manual feedback.
3. Recommend a new change when the discovery is adjacent follow-up work rather than required for the current change.
4. Recommend `/sdd-prd` when the discovery changes product direction rather than implementation scope.
5. Update `proposal.md` if scope, non-goals, Epic actions, impact, release-communication impact, or open questions changed.
6. Update `design.md` with revised Stories, Requirements, Scenarios, technical options, selected approach, alternatives, ADR needs, constraints, risks, and verification strategy.
7. Create or update ADR drafts when the discovery changes a durable architecture decision.
8. Update `tasks.md` with a `Planning Updates` entry, revised checklist items, ADR tasks, a refreshed `Resume Here`, and any manual feedback or blocker state that remains relevant.
9. Keep Story labels/references and Requirement/Scenario IDs stable when editing existing behavior. Add new IDs only for genuinely new behavior rules or scenarios.
10. Do not edit application code from this mode.
11. Do not edit actual Epic files unless the user explicitly asks to apply planning changes to durable Epic truth immediately.
12. When the revised artifacts are coherent and ready to apply, set `tasks.md` to `status: in_progress` and end by recommending the next `/sdd-apply` invocation. Leave `replanning` in place when unresolved planning decisions still block implementation.

## Artifact Rules

- Treat the change folder as proposed behavior and application guidance, not approval to edit Epics or code.
- Treat `docs/epics/<key>-<###>-<epic-name>/epic.md` as the durable Epic location.
- Keep Stories embedded inside Epic `epic.md` files; do not create `docs/stories/` or individual Story files in this workflow.
- Treat Epics and Stories as durable but revisable truth. Stories may be renamed, reordered, split, merged, or moved between Epics as product understanding improves.
- Treat moving a Story between Epics as an explicit Epic action: name the source Epic, destination Epic, old full Story reference, new full Story reference, and any Requirement/Scenario adjustments.
- Treat `docs/changes/closed/` as the home for completed change folders; do not use `archived/`.
- Treat root-level `changes/` as migration input only. Active SDD changes belong under `docs/changes/`.
- Keep Requirements user-visible or externally observable.
- Keep technical constraints out of Requirements unless they affect observable behavior.
- Keep Story labels as durable internal labels, not file-routing concerns or UUID-like handles. New or normalized Epics should use `S#` labels scoped to the Epic; full references include the Epic ID, such as `EPIC-ID/S1`.
- Preserve legacy app-wide Story IDs where existing references depend on them, but do not create new app-wide Story IDs unless project-local guidance explicitly requires that older convention.
- Keep `S#` labels unique within each Epic. Treat duplicate labels inside one Epic, duplicate full Story references, or duplicate legacy app-wide Story IDs as traceability drift unless this proposal is explicitly a migration cleanup to resolve the duplicate.
- Use local Requirement and Scenario IDs for traceability: `R1`, `R2`, and `R1-S1`, `R1-S2`. Verification evidence should refer to these IDs; tasks and ledgers should use them when useful.
- Avoid vague Scenario text such as "WHEN this Story's user-visible workflow is exercised". Rewrite it into a real condition/action and observable result.
- Treat project-defined release communication as a transition record, not SDD workflow truth. Follow its configured location and format.
- Keep public release communication free of private planning context, SDD implementation-ledger details, raw Requirement/Scenario lists, internal task IDs, secrets, and speculative roadmap promises.
- Flag conflicts with project planning docs or PRD/Product Brief files as product drift; do not update PRD direction from this skill unless the user explicitly asks.
- Put high-level technical approach, alternatives, constraints, transition contracts, and verification strategy in `design.md`, not in separate approach artifacts by default.
- Use `/sdd-adr` for durable architecture decisions that future changes should follow. ADRs complement `design.md`; they do not replace Epics, Stories, Requirements, Scenarios, or implementation evidence.
- Use `docs/adrs/<yyyy-mm-dd-decision-title>.md` for ADRs.
- Link ADRs from `design.md` and mention them in `tasks.md` closeout state when they affect implementation or review.
- Put implementation progress, resume state, task status, verification results, and closeout state in `tasks.md`, not in separate implementation stubs or ledgers by default.
- Keep the machine-readable `tasks.md` `status` current. Folder location, not a `closed` value, represents closed Changes.
- Put review outcome, review record path or clean-review note, manual confirmation status, release-communication status, PR/merge state, and accepted deferred gaps in `tasks.md` so closeout can be validated without a special mode.
- Do not create or edit actual Epic files, separate implementation records, separate approach reports, or code from this skill unless the user explicitly asks for that extra work.
- Do not use this skill as an interactive implementation loop. If the request is effectively `/sdd-propose --interactive` followed immediately by `/sdd-apply --interactive`, use `/sdd-interactive`.
- Use `/sdd-propose --replan` instead of `/sdd-interactive` when an active change already exists and the discovery needs revised planning before implementation resumes.
- Prefer a few coherent Stories over many UI-action Stories.
- Leave unresolved uncertainty explicit.

## Final Response

Summarize:

- change name and path
- artifacts created
- proposed Epic actions
- major open questions or gaps
- recommended next workflow
- for `--replan`, the discovery classification, artifacts updated, and exact `/sdd-apply` restart point
