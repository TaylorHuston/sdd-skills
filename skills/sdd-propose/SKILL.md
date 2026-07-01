---
name: sdd-propose
description: Create or update a minimal SDD change folder under docs/changes/yyyy-mm-dd-change-name with proposal.md, design.md, and tasks.md. Use when the user invokes /sdd-propose or /sdd-propose --replan, asks to propose, scope, define the technical design for, prepare a product change, or revise an active change after newly discovered Requirements, Scenarios, constraints, or scope concerns need planning before implementation resumes. Supports the experimental OpenSpec-inspired SDD workflow, including changes that create new Epic directories, update existing Epic directories, or both. This single workflow should adapt to small fixes or whole-Epic changes without requiring separate approach or implementation-stub skills, while preserving unique Story IDs, concrete Requirements/Scenarios, manual confirmation tracking, changelog impact, and closeout-ready task ledgers.
---

# SDD Propose

Create or refresh one change folder. This is workflow-based like OpenSpec's propose step, but it does not depend on a CLI, schema engine, separate approach skill, or separate implementation record skill.

Use `/sdd-interactive` instead when the user wants to create a lightweight tracked change and immediately work through small edits in the same interactive session.

Use `/sdd-propose --replan` when an active `/sdd-apply` run or manual feedback discovers new or changed Requirements, Scenarios, constraints, Epic ownership, or scope questions that need planning before more code changes. This mode updates the active change's planning artifacts, then hands back to a fresh `/sdd-apply`.

## Output

Write these files:

```text
<project-root>/docs/changes/<yyyy-mm-dd-change-name>/proposal.md
<project-root>/docs/changes/<yyyy-mm-dd-change-name>/design.md
<project-root>/docs/changes/<yyyy-mm-dd-change-name>/tasks.md
```

Use:

- `assets/proposal-template.md`
- `assets/design-template.md`
- `assets/tasks-template.md`

## Workflow

1. Resolve the change input.
   - If invoked with `--replan`, select an existing active change folder instead of creating a new one.
   - In `--replan`, accept the discovery as prose, a `tasks.md` Manual Feedback entry, a review finding, failing test, implementation note, or explicit user instruction.
   - In `--replan`, stop and ask which active change to revise when multiple changes could own the discovery.
   - Accept either a kebab-case change name or a plain-language change description.
   - If no clear change is provided, ask what the user wants to build or change.
   - Derive a short kebab-case `<change-name>` when the user provides prose.
   - Prefix the change folder with today's local date from the shell clock: `yyyy-mm-dd-<change-name>`.
2. Locate the project root.
   - Prefer an explicit path from the user.
   - Otherwise use the nearest root with `.git/`, `package.json`, `docs/`, `AGENTS.md`, existing `docs/changes/`, or legacy `changes/`.
   - Do not write to the vault root unless the vault itself is the intended project.
3. Load only the context needed to propose accurately.
   - Read project guidance such as `AGENTS.md`, `README.md`, and product/PRD context when present.
   - Read root `CHANGELOG.md` when it exists and the change may be user-facing, release-relevant, security-relevant, migration-relevant, operationally notable, or public documentation-worthy.
   - Read project planning docs or PRD/Product Brief files when available; if product direction is missing or stale and the change depends on it, recommend `/sdd-prd` without blocking small experiments.
   - Inspect existing active changes under `docs/changes/` and closed changes under `docs/changes/closed/` only enough to avoid duplicate or conflicting scope.
   - In `--replan`, read the active change's `proposal.md`, `design.md`, `tasks.md`, any `review.md`, relevant implementation ledger entries, manual feedback, recent failing/passing checks, and enough current code or tests to understand the discovery.
   - Inspect legacy `changes/` only enough to avoid duplicate scope or continue a pre-migration change; do not create new SDD changes there.
   - Inspect existing Epic directories under `docs/epics/`.
   - Read existing `docs/epics/<key>-<###>-epic-name/epic.md` files when the change may modify them.
   - Scan active `docs/epics/**/epic.md` files for existing Story IDs before proposing new Story IDs.
   - Read code only when current behavior needs accurate `Implemented By` or `Verified By` maps.
4. Create or continue the change folder.
   - In `--replan`, require an existing active `docs/changes/<yyyy-mm-dd-change-name>/` folder with `proposal.md`, `design.md`, and `tasks.md`.
   - In `--replan`, do not create a second change unless the discovery is outside the current change and should become follow-up scope.
   - Create `docs/changes/<yyyy-mm-dd-change-name>/` when it does not exist.
   - If any target artifact already exists, read the existing artifacts and continue only when the user's intent is clearly to revise the change. Otherwise ask whether to revise it or create a differently named change.
   - If a matching legacy `changes/<yyyy-mm-dd-change-name>/` exists, ask whether to continue that legacy change, migrate it to `docs/changes/`, or create a differently named change. Do not silently create duplicate active truth.
5. Interview for the proposal and design boundary.
   - First summarize the proposed scope boundary from the user's request, PRD/Product Brief, existing Epics, existing changes, and current implementation reality.
   - Ask the user all questions needed to properly design the proposal, Epic actions, Stories, Requirements, Scenarios, technical approach, constraints, verification strategy, and task ledger.
   - Keep questions inside the proposed change scope.
   - Do not ask questions that would materially expand product scope, user-visible behavior, Epic ownership, data model, auth/security model, public API, deployment behavior, or external-service state.
   - If a scope-expanding question seems relevant, name it as out of scope or future work instead of pulling it into the current proposal.
   - Do not treat user interest in a broader idea as permission to expand the current change unless the user explicitly says to expand this proposal's scope.
   - For MVP work, bias toward the smallest proof loop that satisfies the stated MVP question; record adjacent product ambitions as deferred scope.
   - Ask whether the scoped change should produce a public changelog entry only when that is not obvious from the proposal context.
   - Prefer one high-leverage question at a time when the answer materially affects the design. Do not ask questions already answered by project docs, existing Epics, existing changes, implementation, tests, or PRD context.
   - Stop interviewing when remaining uncertainty can be recorded as an open question without weakening the proposal.
   - In `--replan`, focus the interview only on the discovered requirement, why the current plan is insufficient, whether it belongs in the current change, and what must be true before `/sdd-apply` resumes.
6. Draft `proposal.md`.
   - Explain why the change exists and what it changes.
   - List proposed Epic actions: create a new Epic directory, update an existing Epic directory, or both.
   - Use Epic directory names shaped as `<key>-<###>-<epic-name>` and an `epic.md` file inside each directory.
   - Capture scope-expanding ideas from the interview as deferred scope or future work, not as current Epic actions.
   - Add changelog impact: required, not required, or TBD; if required, name the likely Keep a Changelog category.
   - Capture open questions and impact without making low-confidence implementation claims.
7. Draft `design.md`.
   - Describe the target Epic changes and high-level technical approach in enough detail for review before implementation.
   - For each new or modified Epic, include capability-level Stories.
   - Give each new Story a stable Story ID that follows the project's existing Epic/Story prefix and next-number convention, such as `OD-010`. Before assigning an ID, confirm it is not already used anywhere in active `docs/epics/**/epic.md` files. Keep the ID stable even if the Story is later renamed or reordered.
   - Write Story headings with the ID visible, such as `#### Story OD-010: Dashboard Vault Intelligence Tab`. Put the `As a ..., I want ..., so that ...` sentence directly under the Story heading.
   - Number Requirements locally inside each Story as `R1`, `R2`, `R3`, restarting at `R1` for each Story.
   - Number Scenarios locally under each Requirement as `R1-S1`, `R1-S2`, `R2-S1`, and so on.
   - Under each Story, write Requirements using `The system SHALL ...`.
   - Under each Requirement, write concrete Scenarios using `WHEN`, `THEN`, and optional `AND`.
   - Do not mechanically convert acceptance criteria into generic Scenarios. Each Scenario must name a concrete trigger, state, failure mode, permission case, empty state, recovery path, or observable condition.
   - Add one `Implemented By`, one `Verified By`, and one `Verification Gaps` section per Story.
   - For unimplemented work, write `Not implemented yet.` and `Not verified yet.` rather than inventing future files or tests.
   - When creating a new Epic, identify its proposed directory and `epic.md` path.
   - When editing an existing Epic, identify the target `epic.md` path and distinguish added, modified, and removed Story/Requirement scope.
   - Include the chosen technical approach, important constraints, alternatives considered, and why the chosen approach was selected.
   - Do not turn deferred or scope-expanding ideas into Stories, Requirements, Scenarios, or tasks for this change.
   - Scale the detail to the change: one paragraph may be enough for a small change; broad or risky changes should capture architecture, data, auth, dependency, migration, state-transition, verification, and rollout implications as relevant.
8. Draft `tasks.md`.
   - Treat `tasks.md` as the lightweight implementation ledger and resume surface for the change.
   - Keep tasks at artifact, Story/capability, verification, and review level; do not write a file-by-file execution script.
   - Include a `Resume Here` section that can be updated during implementation.
   - Include a compact task checklist, implementation ledger, verification ledger, open blockers, and closeout checklist.
   - Include a task to update root `CHANGELOG.md` when changelog impact is required or TBD.
   - Include a review task for `/sdd-review`, manual confirmation status, review record status, changelog status, PR/merge state, accepted deferred gaps, and a closing task that moves the completed change folder to `docs/changes/closed/` only after review/PR/merge/acceptance state is clear.
   - In `--replan`, add a dated `Planning Updates` entry describing the discovery, classification, artifacts changed, and the next `/sdd-apply` starting point.
9. Verify the artifacts.
   - Confirm all three files exist.
   - Re-read them before final response.
   - Check that `proposal.md` names intended Epic actions.
   - Check that `proposal.md` records changelog impact.
   - Check that `design.md` gives each Story a stable, app-unique ID, local Requirement IDs, local Scenario IDs, `Implemented By`, `Verified By`, and `Verification Gaps`, plus a right-sized technical approach.
   - Check that `tasks.md` can replace a separate implementation stub or ledger for this change and includes review record, manual confirmation status, changelog status, PR/merge state, accepted deferred gaps, and closeout fields.
   - In `--replan`, check that `Resume Here` points to the next `/sdd-apply` run and no stale checklist or blocker claims contradict the revised plan.

## Replan Mode

Use `/sdd-propose --replan` for mid-change discoveries that need planning before implementation continues.

Use this mode when:

- implementation or manual testing reveals a new Requirement or Scenario;
- an existing Requirement or Scenario needs a meaningful semantic change;
- a newly discovered constraint affects architecture, data, auth, API, migration, rollout, verification, or Epic ownership;
- the discovery may still belong in the active change, but it is too substantive for the `/sdd-apply` manual feedback loop alone.

Do not use `--replan` for simple defects, missing tests, stale `Implemented By` / `Verified By` entries, small artifact drift, or narrow implementation fixes that `/sdd-apply` can handle directly.

In `--replan`:

1. Classify the discovery as `in-scope refinement`, `scope expansion`, `product drift`, `Epic ownership change`, `technical constraint`, or `follow-up change`.
2. Preserve the current change when the discovery is necessary to satisfy the original goal or accepted manual feedback.
3. Recommend a new change when the discovery is adjacent follow-up work rather than required for the current change.
4. Recommend `/sdd-prd` when the discovery changes product direction rather than implementation scope.
5. Update `proposal.md` if scope, non-goals, Epic actions, impact, changelog impact, or open questions changed.
6. Update `design.md` with revised Stories, Requirements, Scenarios, technical approach, alternatives, constraints, risks, and verification strategy.
7. Update `tasks.md` with a `Planning Updates` entry, revised checklist items, a refreshed `Resume Here`, and any manual feedback or blocker state that remains relevant.
8. Keep Story IDs stable and Requirement/Scenario IDs stable when editing existing behavior. Add new IDs only for genuinely new behavior rules or scenarios.
9. Do not edit application code from this mode.
10. Do not edit actual Epic files unless the user explicitly asks to apply planning changes to durable Epic truth immediately.
11. End by recommending the next `/sdd-apply` invocation for the revised change.

## Artifact Rules

- Treat the change folder as proposed behavior and application guidance, not approval to edit Epics or code.
- Treat `docs/epics/<key>-<###>-<epic-name>/epic.md` as the durable Epic location.
- Keep Stories embedded inside Epic `epic.md` files; do not create `docs/stories/` or individual Story files in this workflow.
- Treat Epics and Stories as durable but revisable truth. Stories may be renamed, reordered, split, merged, or moved between Epics as product understanding improves.
- Treat moving a Story between Epics as an explicit Epic action: name the source Epic, destination Epic, preserved or changed Story ID, and any Requirement/Scenario adjustments.
- Treat `docs/changes/closed/` as the home for completed change folders; do not use `archived/`.
- Treat root-level `changes/` as a legacy fallback only. New SDD changes belong under `docs/changes/`.
- Keep Requirements user-visible or externally observable.
- Keep technical constraints out of Requirements unless they affect observable behavior.
- Keep Story IDs as durable internal labels, not file-routing concerns or permanent Epic ownership claims. Preserve Story IDs across moves unless deliberate renumbering is part of the proposed cleanup.
- Keep Story IDs unique across active Epics in the app. Treat duplicate Story IDs as blocking traceability drift unless this proposal is explicitly a migration cleanup to resolve the duplicate.
- Use local Requirement and Scenario IDs for traceability: `R1`, `R2`, and `R1-S1`, `R1-S2`. Verification evidence and tasks should refer to these IDs when useful.
- Avoid vague Scenario text such as "WHEN this Story's user-visible workflow is exercised". Rewrite it into a real condition/action and observable result.
- Treat root `CHANGELOG.md` as public release communication, not SDD workflow truth. Use Keep a Changelog 1.1.0 conventions: `Unreleased` first, newest releases first, ISO dates for releases, and grouped entry types `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, and `Security`.
- Do not put private vault context, SDD implementation ledger details, raw Requirement/Scenario lists, internal task IDs, secrets, or speculative roadmap promises in `CHANGELOG.md`.
- Flag conflicts with project planning docs or PRD/Product Brief files as product drift; do not update PRD direction from this skill unless the user explicitly asks.
- Put high-level technical approach, alternatives, constraints, transition contracts, and verification strategy in `design.md`, not in separate approach artifacts by default.
- Put implementation progress, resume state, task status, verification results, and closeout state in `tasks.md`, not in separate implementation stubs or ledgers by default.
- Put review outcome, review record path or clean-review note, manual confirmation status, changelog status, PR/merge state, and accepted deferred gaps in `tasks.md` so closeout can be validated without a special mode.
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

End with a concise self-improvement conclusion: ask "How well did this work, and what could have been improved?" and state one concrete improvement if evident.
