---
name: sdd-review
description: Review a SDD change as the local integration gate after /sdd-apply or before closing, creating a docs/changes/yyyy-mm-dd-change-name/review.md file when deficiencies are found, verifying proposal.md, design.md, tasks.md, Epic truth, unique Story IDs, Requirements, Scenarios, tests, manual confirmation status, code quality, security, documentation, changelog, branch policy, source-vs-target merge readiness, and closeout consistency. Use when the user invokes /sdd-review, asks to verify a SDD change, run a local PR-style review, prepare integration readiness, address review findings, close or finish a change, create a non-production PR, or merge a SDD change into an integration branch. Use /sdd-release instead for main/production promotion, release PRs, full release checks, changelog finalization, or remote CI / AI-assisted review for production acceptance.
---

# SDD Review

Review a SDD change like a local pull request. This is the final independent gate after `/sdd-apply`: confirm the implemented change satisfies its artifacts, the durable Epic is current, verification is strong enough, and the source branch is ready for local integration, PR, or merge according to the app's branch policy.

Use `/sdd-release` instead when the task is preparing a release PR to `main`, running full release checks, finalizing `CHANGELOG.md`, or cutting a release.

For the default solo-developer workflow, use `/sdd-review` to prepare routine changes for the project integration branch. Remote PRs are optional for routine integration unless project-local policy or the user explicitly requires one; production-branch promotion belongs to `/sdd-release`.

Do not treat this as more implementation planning. In default mode, fix narrow, clearly safe deficiencies as they are found, commit those fixes after affected verification passes, report what was fixed and committed, and stop. The user may rerun `/sdd-review` manually for a fresh-context pass until it reports clean. If the review finds deficiencies that are unsafe to fix automatically, write or update `review.md` in the active change folder so the findings can be addressed in a later `/sdd-apply` or targeted review pass.

Always validate closeout readiness as part of review. If the user asks to finish, close, merge-and-close, or otherwise complete the change, perform the closeout mutation only after review passes, branch/PR/merge/acceptance state is clear, and the change-local artifacts agree with reality.

## Inputs And Modes

Start from an explicit change folder, change name, source branch, target branch, or active change inferred from the conversation.

Supported modes:

- Default: review, fix narrow clearly safe in-scope findings once, rerun affected checks, commit only the safe-fix diff, report what was fixed and committed, and stop with the current verdict. Do not create a PR, merge, push, or close the change.
- `--check`: review only and do not edit any files, including `review.md`.
- `--no-fix`: review only, write or update `review.md` when deficiencies exist, and report the verdict.
- `--fix`: same safe-fix behavior as default, kept as an explicit alias for callers that want to signal remediation intent. Do not broaden scope.
- `--until-ready`: run a bounded review-fix-reverify loop until all gates pass or a stop condition occurs. Requires `--fix`.
- `--max-iterations N`: cap `--until-ready`; default to `3`.
- `--pr`: when all gates pass, create a non-production pull request following the app's branch policy. If the target is the production branch, use `/sdd-release` instead.
- `--merge`: when all gates pass, merge to the non-production integration branch following the app's branch policy. If the target is the production branch, use `/sdd-release` instead.
PR creation, merge, push, rebase, branch deletion, deployment, destructive data changes, credentials, production actions, and moving a change folder to `docs/changes/closed/` require explicit user authorization through the request or active workflow context. A request to create a PR or merge into the production branch is a release request and should route to `/sdd-release` unless the user explicitly states otherwise. A local commit containing only safe review fixes is part of default review remediation and does not require separate authorization. If branch policy is unclear, stop before PR, merge, or closeout.

## Select The Change And Branches

Use explicit inputs first. Otherwise:

1. Infer the active change from conversation context.
2. List active folders under `docs/changes/`, excluding `docs/changes/closed/`.
3. If no canonical active change is found, inspect legacy `changes/`, excluding `changes/closed/`, only to continue pre-migration work. Announce that the selected folder is legacy and recommend moving it to `docs/changes/` before new work.
4. Auto-select only when exactly one active change exists.
5. Ask the user when selection is ambiguous.

Resolve source and target branches from explicit input, then project-local `AGENTS.md` branch policy. Use the current branch as source only when that matches the policy. Do not assume `main`, `develop`, branch prefixes, or merge direction from another app.

If the requested PR or merge target is the production branch, stop and route to `/sdd-release` unless project-local policy defines a different non-release production-branch workflow and the user explicitly confirms it.

Always announce the selected change, source branch, target branch, and whether PR/merge actions are authorized.

## Required Context

Before reviewing, read:

- `docs/changes/yyyy-mm-dd-change-name/proposal.md`
- `docs/changes/yyyy-mm-dd-change-name/design.md`
- `docs/changes/yyyy-mm-dd-change-name/tasks.md`
- existing `docs/changes/yyyy-mm-dd-change-name/review.md`, if present
- root `CHANGELOG.md` when `proposal.md` says changelog impact is required or TBD, `tasks.md` references changelog work, or the implemented change is user-facing, release-relevant, security-relevant, migration-relevant, operationally notable, or public documentation-worthy
- relevant target Epic files under `docs/epics/*/epic.md`
- enough of every active `docs/epics/*/epic.md` to detect duplicate Story IDs across the app
- vault, workspace, and app `AGENTS.md`, especially app branch policy
- `06 Projects/<project>/prd.md` when product scope changed, the change claims product direction, or PRD drift was flagged
- project README, test docs, security docs, deployment docs, and current-state docs when affected
- source-vs-target diff and changed file list
- code, tests, generated files, docs, and configuration touched by the change

Check git status in every repo that may change. Preserve unrelated dirty files. Treat app/source repo changes separately from vault/workflow artifact changes unless they live in the same repository.

For app review readiness, uncommitted files outside the app/source repo do not block review, PR, or merge readiness unless they are explicitly part of the requested app change, target repo, or branch operation. Report related root-vault or workflow-artifact dirty state clearly, but do not classify it as blocking merely because it is uncommitted. App/source repo dirty state still blocks readiness when it is part of the change and not committed or explicitly deferred.

If the selected change is in legacy `changes/`, keep using that explicit path for the current run unless the user asks to migrate it. Do not create a second active copy silently.

## Review Gates

Run all gates that apply. Use `pass`, `findings`, `blocked`, or `not applicable`.

1. Change Artifact Gate
   - `proposal.md`, `design.md`, and `tasks.md` agree on scope.
   - `tasks.md` checkboxes, Resume Here, implementation ledger, verification ledger, blockers, and closeout state match repo reality.
   - Any departures from the proposal or design are recorded and justified.
   - Closed changes, or changes the user has asked to close, have no contradictory lifecycle state: `Resume Here`, checklist, review state, manual confirmation status, changelog status, PR/merge state, deferred gaps, and folder location all agree.
   - No required closeout checkbox remains unchecked unless it is explicitly recorded as an accepted deferred gap with an owner decision.
   - `tasks.md` records the review outcome as either a `review.md` path, a clean review recorded in `tasks.md`, or an explicit user-approved review waiver.
2. Epic Truth Gate
   - Target Epic directories and `epic.md` files exist.
   - Each Story has a stable Story ID, current Requirements, Scenarios, `Implemented By`, `Verified By`, and `Verification Gaps`.
   - Story IDs are unique across active `docs/epics/**/epic.md` files in the app unless a temporary migration duplicate is explicitly documented and blocked from further implementation.
   - When duplicate Story IDs are found during default or `--fix` review, clean them up automatically if the intended owner is obvious, the fix is a mechanical renumber inside the active change's target Epic or recently added Story set, and all affected references are local to the app docs/change artifacts. Record the renumbering in `tasks.md` or `review.md`.
   - Any Story rename, reorder, split, merge, or move between Epics is intentional, documented in the change artifacts, and reconciled in every affected Epic.
   - Story IDs are preserved across Epic moves unless deliberate renumbering is documented.
   - Requirements and Scenarios match implemented user-visible behavior and known failure modes.
   - `Implemented By` is a useful code map, not a full dependency list.
   - `Verified By` names concrete evidence, not only broad commands.
3. Requirement And Scenario Gate
   - New or modified Requirements use local `R#` IDs inside their Story.
   - New or modified Scenarios use local `R#-S#` IDs under their Requirement.
   - Scenarios name concrete conditions, actions, state, failure modes, empty states, permission cases, validation paths, or recovery paths. Generic Scenarios such as "WHEN this Story's user-visible workflow is exercised" are findings.
   - Every in-scope Requirement is implemented or explicitly deferred.
   - Every Scenario, including failure, empty, permission, validation, and recovery paths, is implemented or explicitly listed as a gap.
   - Evidence proves the production path where risk warrants it, not only helper or mock behavior.
4. Test And Verification Gate
   - Run focused tests/checks tied to Requirements and Scenarios.
   - Confirm verification evidence maps to Story ID plus Requirement/Scenario IDs when possible.
   - Treat stale `AC-#` or `TAC-#` references as findings unless they are explicitly preserved as legacy acceptance references and mapped to current Requirement/Scenario IDs.
   - Run broader lint, typecheck, build, codegen, migration, browser, or integration checks when changed files warrant them.
   - Record skipped checks with the reason, fallback evidence, and whether the skip blocks readiness.
5. Manual UI Confirmation Gate
   - For browser-visible or otherwise user-facing app changes, confirm `tasks.md` includes a clear `Manual UI Confirmation` walkthrough for the user.
   - The walkthrough should name app URL or route, required local server state, seed/test data or account, exact steps, expected results, known acceptable rough edges, and how feedback should be classified.
   - Missing, stale, or too-vague walkthroughs are findings because they prevent useful human acceptance.
   - Confirm `tasks.md` records manual confirmation status: `not applicable`, `pending user`, `user confirmed`, or `accepted gap`.
   - If the change has no manually observable UI or app behavior, confirm `tasks.md` records why manual UI confirmation is not applicable.
   - Do not require the user to have completed manual confirmation unless the project branch policy, change artifacts, or user request makes human acceptance a readiness gate.
6. Local PR Code Review Gate
   - Review the source-vs-target diff for correctness, regressions, maintainability, accidental scope, error/loading/empty states, and consistency with project patterns.
   - Findings need file/line references when practical, user or maintenance impact, and concrete remediation.
7. Security Review Gate
   - Perform a formal security pass every time, scaled to risk.
   - At minimum inspect auth/authz, data exposure, input/output handling, secrets, dependency changes, config/deployment changes, persistence, migrations, and unsafe actions.
   - Use a security specialist skill or subagent when the changed surface affects auth, secrets, payments, external services, permissions, dependency supply chain, sensitive data, or a public attack surface.
8. Documentation Gate
   - Check README, root docs, current-state docs, testing/deployment docs, and vault project notes only when the change affects their truth value.
   - Require docs updates when stale docs would mislead future development or operation.
9. Changelog Gate
   - Confirm root `CHANGELOG.md` exists and is updated when the change is public/release relevant.
   - Follow Keep a Changelog 1.1.0 conventions: `Unreleased` first, newest releases first, ISO dates for releases, and grouped entry types `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, and `Security`.
   - Confirm entries are public-safe and human-facing, not SDD workflow logs, raw Requirement/Scenario lists, internal task IDs, private vault context, secrets, or speculative roadmap promises.
   - If no changelog entry is needed, confirm `tasks.md` or the review report records the reason.
10. Branch And Merge Readiness Gate
   - Confirm branch policy, source branch, target branch, dirty state, commit shape, and unrelated changes.
   - Confirm whether the target is an integration branch or production branch.
   - Confirm remote PRs are optional for routine integration unless project-local policy requires them.
   - Check source-vs-target merge conflicts without performing the merge.
   - Confirm all related app and workflow changes are committed or explicitly documented as blockers before PR/merge.
11. PRD Alignment Gate
   - When product scope changed or a PRD drift concern exists, confirm the implemented change still fits `06 Projects/<project>/prd.md`.
   - If product intent changed, require a `/sdd-prd` update or explicit user acceptance before ready verdict.

Do not use verdict `ready` unless the code review and security review gates are complete and have no blocking findings.

## Review Findings

Classify findings:

- `BLOCKING`: must be fixed before PR or merge.
- `REQUIRED`: should be fixed before PR or merge unless the user explicitly accepts the risk.
- `SUGGESTION`: non-blocking improvement.

When any unresolved `BLOCKING` or `REQUIRED` finding exists after the safe-fix pass, create or update:

```text
docs/changes/yyyy-mm-dd-change-name/review.md
```

Use this shape:

```markdown
# Review: CHANGE TITLE

## Verdict

changes-requested | blocked | ready

## Gate Scorecard

| Gate | Result | Notes |
|---|---|---|
| Change artifacts | TBD | TBD |
| Epic truth | TBD | TBD |
| Requirements and Scenarios | TBD | TBD |
| ID traceability | TBD | TBD |
| Tests and verification | TBD | TBD |
| Manual UI confirmation | TBD | TBD |
| Code review | TBD | TBD |
| Security review | TBD | TBD |
| Documentation | TBD | TBD |
| Changelog | TBD | TBD |
| Branch and merge readiness | TBD | TBD |
| PRD alignment | TBD | TBD |

## Findings

### BLOCKING

- [ ] FILE:LINE - Finding and impact. Recommendation: concrete fix.

### REQUIRED

- [ ] FILE:LINE - Finding and impact. Recommendation: concrete fix.

### SUGGESTION

- [ ] FILE:LINE - Finding and impact. Recommendation: concrete fix.

## Verification Evidence

- COMMAND_OR_SCENARIO: result and what it proves.

## PR / Merge Readiness

- Source branch:
- Target branch:
- Conflict check:
- Commit state:
- PR status:
- Merge status:

## Review Log

- YYYY-MM-DD: Review created or updated.
```

If there are no deficiencies, `review.md` is not required. If an older `review.md` exists, update it with the all-clear result or the remaining findings so it does not become stale.

When no `review.md` is created for a clean review, record the ready verdict, review date, and review scope in `tasks.md` so closeout remains auditable.

## Remediation

Default mode may fix findings once. With default mode or `--fix`, only fix findings that are:

- clearly in scope for the SDD change
- small enough to verify in the same review pass
- not product decisions, architecture rewrites, data migrations, destructive actions, secrets, branch operations, or broad refactors

Safe automatic fixes include stale generated indexes, stale task ledger checkboxes, missing verification ledger entries for checks already run, small Epic evidence/date corrections, changelog category placement, formatting/lint fixes with obvious local intent, mechanical duplicate Story ID renumbering when ownership and references are obvious, and similarly mechanical artifact drift.

After every fix:

1. Update `review.md`.
2. Rerun affected verification.
3. Rerun code and security review on the updated diff.
4. Confirm the working tree contains only the intended safe-fix files plus any unrelated pre-existing dirty files, and stage only the intended safe-fix files.
5. Create a local commit for the safe review fix with a concise message, such as `Address sdd-review findings`, scoped to the current repo. Do not stage unrelated dirty files, do not amend earlier commits, and do not push.
6. Stop and report what was fixed, the commit hash, and any unrelated dirty files that were preserved. Do not immediately loop to a clean verdict unless `--until-ready` is explicitly set; the user can rerun `/sdd-review` for a fresh-context pass.

If the safe-fix diff cannot be isolated from unrelated dirty files, affected verification fails, or the local commit fails, stop and report the blocker instead of continuing.

If findings require implementation work beyond safe review remediation, leave them in `review.md` and recommend returning to `/sdd-apply`.

## PR, Merge, And Closeout

When all gates pass:

- If the target is the production branch, do not create the PR or merge from `/sdd-review`; report that the change is locally ready and hand off to `/sdd-release`.
- If `--pr` is authorized, create a PR following app branch policy. Include the change path, summary, Requirements/Scenarios covered, verification evidence, security review result, and remaining non-blocking risks.
- If `--merge` is authorized, merge following app branch policy. Recheck target branch, conflict state, dirty state, and required checks immediately before merging.
- If neither `--pr` nor `--merge` is authorized, report that the change is ready for the project's normal integration path. Note that `/sdd-release` should be used later for promotion to `main`.

Do not push unless explicitly authorized or required by an explicitly requested PR workflow. Do not close the change folder until PR/merge/acceptance state is clear and the user has explicitly asked to close, finish, merge-and-close, or otherwise complete the change.

When closing:

1. Ensure `tasks.md` closeout reflects review outcome, review record, manual confirmation status, changelog status, PR/merge state, remaining accepted risks, and that no contradictory checklist or Resume Here state remains.
2. Move `docs/changes/yyyy-mm-dd-change-name/` to `docs/changes/closed/yyyy-mm-dd-change-name/`.
   - If the selected change is in legacy `changes/`, ask whether to migrate it into `docs/changes/closed/` during closeout rather than preserving the legacy root-level location.
3. Verify references to the active path are historical or updated.

## Stop Conditions

Stop and report when:

- change or branch selection is ambiguous.
- required artifacts are missing or contradictory.
- branch policy is missing or violated.
- unrelated app/source-repo dirty files block safe review, fixes, PR, or merge.
- required checks fail without a safe in-scope fix.
- security review finds unresolved risk.
- Epic truth or Requirement/Scenario evidence is stale or incomplete.
- duplicate Story IDs exist across active Epics without an explicit migration/blocking note and cannot be safely renumbered mechanically during the review pass.
- new or modified Stories lack stable Story IDs, local Requirement IDs, local Scenario IDs, or concrete non-generic Scenarios.
- user-facing app changes lack a useful manual UI confirmation walkthrough, or the walkthrough is stale relative to the implementation.
- manual confirmation status, review record, changelog state, PR/merge state, or closeout state is contradictory.
- required public changelog entry is missing, misleading, private, or not Keep a Changelog-shaped.
- PRD/product-direction drift is unresolved when the change depends on it.
- PR/merge targets the production branch; route to `/sdd-release` instead.
- PR/merge would require push, rebase, destructive action, production credentials, deployment, target-branch changes, or human approval not already granted.
- findings need product, architecture, data, auth, or scope judgment from the user.

## Final Response

Lead with verdict.

Include:

- verdict: `ready`, `changes-requested`, or `blocked`
- selected change path, source branch, and target branch
- blocking and required findings, ordered by severity
- whether `review.md` was created or updated
- Requirement/Scenario coverage result
- ID traceability result
- Epic truth result
- test and verification commands/results
- manual UI confirmation walkthrough status and any steps the user should perform
- closeout readiness and any contradictory lifecycle state
- formal security review result
- docs result
- changelog result
- PRD alignment result when checked
- branch and merge readiness result
- PR or merge action taken, offered, or blocked
- remaining risks and next action

## Final Self-Improvement Action

After completing or stopping this workflow, end the final user response with a concise self-improvement conclusion:

- Ask yourself: "How well did this work, and what could have been improved?"
- Tell the user the conclusion in 1-3 sentences.
- Name any concrete skill, template, doctrine, or process improvement worth considering.
- If no specific improvement is evident, say so plainly.
