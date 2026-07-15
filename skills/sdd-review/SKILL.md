---
name: sdd-review
description: Review a SDD change as the independent local integration gate after /sdd-apply or before closing. Verifies the source-vs-target diff, proposal, design, task ledger, Epic truth, template adherence, Stories, Requirements, Scenarios, tests, manual confirmation, code quality, security, supporting docs, release communication, branch policy, merge readiness, and closeout consistency. Use when the user invokes /sdd-review, asks to verify a SDD change, run a local PR-style review, prepare integration readiness, address findings, close or finish a change, or perform a policy-defined integration handoff. Use /sdd-release for production-target promotion and release handoff.
---

# SDD Review

Review a SDD change like a local pull request. This is the final independent gate after `/sdd-apply`: confirm the implemented change satisfies its artifacts, the durable Epic is current, verification is strong enough, and the source branch is ready for local integration, PR, or merge according to the app's branch policy.

## Authority And Project Profile

Resolve the workspace, idea-owned planning path, and target implementation repository with `sdd context <relevant-path> --json`, then read `<workspaceRoot>/.sdd/story-driven-development.md` completely before judging artifact authority, traceability, evidence, reconciliation, or closeout. Use the resolved topology unless project guidance declares an explicit exception, then enforce Epics under `docs/epics/` and active/closed changes under `docs/changes/` inside the implementation repository. Project guidance owns source and target policy, required checks, merge/PR rules, supporting-doc requirements, release conventions, technology constraints, available review skills, and permissions. If the managed workflow document is missing, stop and direct the user to `sdd init` or `sdd doctor`.

Default behavior is deep review. A clean `/sdd-review` means the source branch is ready to integrate into the selected target branch, not merely that the active change folder looks plausible. The primary review surface is the source-vs-target diff plus the SDD artifacts that claim to explain it. When default review returns `ready` for a non-production target and closeout readiness passes, treat merge-and-close as the obvious recommended next action and ask the user to confirm it. Use cheaper or narrower modes only when the user asks for them explicitly.

Use `/sdd-release` instead when the task is production-target promotion, full release checks, release-artifact finalization, or the project-defined release handoff.

Use `assets/review-template.md` when creating or refreshing `review.md`.

Use `/sdd-review` to prepare routine changes for the project-defined integration target. Whether that requires a PR or direct local integration belongs to project policy; production-target promotion belongs to `/sdd-release`.

Do not treat this as more implementation planning. In default mode, run the complete PR-style review before beginning remediation. Launch materially relevant fresh-context review passes together, collect all results, validate and deduplicate their findings, and publish one consolidated finding set. Then fix the complete safe subset as one batch, rerun affected verification, and perform one regression-focused rereview of the updated diff. Do not stop between those stages merely to report ordinary findings. Stop only for a defined stop condition, user judgment, or an unsafe remediation boundary. If deficiencies remain outside safe review remediation, write or update `review.md` so one later `/sdd-apply` can address the consolidated batch.

Delegation authorization: invoking `/sdd-review`, naming `sdd-review`, asking to review an SDD change, or asking to close/finish/merge a SDD change is explicit permission to use bounded SDD review subagents under this skill's delegation model. If the local tool policy requires an explicit user request before spawning subagents, this skill invocation satisfies that requirement for non-trivial artifact, code, verification, security, UI, docs, or branch-readiness review passes that remain inside the selected change. Do not ask for separate subagent permission unless the user passed `--no-delegate`, the requested delegation would exceed the selected change, the tool requires a more specific approval than normal spawning, or a stop condition applies.

Always validate closeout readiness as part of review. If the user asks to finish, close, merge-and-close, or otherwise complete the change, perform the closeout mutation only after review passes, branch/PR/merge/acceptance state is clear, and the change-local artifacts agree with reality.

## Inputs And Modes

Start from an explicit change folder, change name, source branch, target branch, or active change inferred from the conversation.

Supported modes:

- Default: run one complete deep PR-style discovery wave against the selected target branch, consolidate and validate all findings, fix the complete safe in-scope subset as one batch, rerun affected checks, perform one regression-focused rereview, commit only the verified safe-fix batch, and report the resulting verdict. Do not pause after individual findings or require the user to invoke `/sdd-review` again merely to discover the next review category. Do not create a PR, merge, push, or close the change without confirmation. If the verdict is `ready`, the target is non-production, and closeout readiness passes, ask whether to perform the policy-defined merge-and-close next.
- `--deep`: explicit alias for default behavior.
- `--fast`: run a lightweight review on the main thread only. Still check source-vs-target diff, required SDD artifacts, branch policy, dirty state, security, and verification evidence, but skip delegated review passes and broad optional checks unless a risk is obvious.
- `--artifact-only`: review SDD artifacts, Epic truth, Change status, manual confirmation status, release-communication status, and PRD alignment when applicable. Do not review application code beyond what is necessary to confirm artifact claims. Do not return `ready` for integration from this mode; use `artifact-ready`, `changes-requested`, or `blocked`.
- `--diff-only`: review the source-vs-target code/config/test/docs diff, branch readiness, security, and verification evidence. Do not reconcile full Epic or PRD truth beyond obvious contradictions. Do not return full SDD closeout readiness from this mode.
- `--no-delegate`: use the main thread only. Use when subagent tooling is unavailable, the change is tiny, or delegation would add more noise than useful independent review.
- `--check`: review only and do not edit any files, including `review.md`.
- `--no-fix`: review only, write or update `review.md` when deficiencies exist, and report the verdict.
- `--fix`: same consolidated safe-fix behavior as default, kept as an explicit alias for callers that want to signal remediation intent. Do not broaden scope.
- `--until-ready`: after the default full discovery, batch remediation, and regression rereview, allow additional bounded remediation cycles until all gates pass or a stop condition occurs. Requires `--fix`.
- `--max-iterations N`: cap `--until-ready`; default to `3`.
- `--pr`: when all gates pass, create a non-production pull request following the app's branch policy. If the target is the production branch, use `/sdd-release` instead.
- `--merge`: when all gates pass, merge to the non-production integration branch following the app's branch policy. If the target is the production branch, use `/sdd-release` instead.
- `--merge-and-close`: when all gates pass, complete the policy-defined non-production merge path and close the change. Treat this as explicit authorization for both the non-production merge/integration action and the closeout mutation, but not for push, rebase, branch deletion, deployment, production action, or remote PR merge unless the request or app policy explicitly covers that action.
PR creation, merge, merge-and-close, push, rebase, branch deletion, deployment, destructive data changes, credentials, production actions, and moving a change folder to `docs/changes/closed/` require explicit user authorization through the request or active workflow context. A request to create a PR or merge into the production branch is a release request and should route to `/sdd-release` unless the user explicitly states otherwise. A local commit containing only safe review fixes is part of default review remediation and does not require separate authorization. If branch or merge policy is unclear, stop before PR, merge, or closeout.

## Select The Change And Branches

Use explicit inputs first. Otherwise:

1. Infer the active change from conversation context.
2. List active folders under `docs/changes/`, excluding `docs/changes/closed/`.
3. If no canonical active change is found, inspect legacy `changes/` only as migration input. Do not review or close it in place; stop and require migration into `docs/changes/` first.
4. Auto-select only when exactly one active change exists.
5. Ask the user when selection is ambiguous.

Resolve source and target branches from explicit input, then project-local `AGENTS.md` branch and merge policy. Use the current branch as source only when that matches the policy. Do not assume `main`, `develop`, branch prefixes, merge strategy, closeout branch, or merge direction from another app.

If the requested PR or merge target is the production branch, stop and route to `/sdd-release` unless project-local policy defines a different non-release production-branch workflow and the user explicitly confirms it.

Always announce the selected change, source branch, target branch, and whether PR, merge, and closeout actions are authorized.

## Build The Review Bundle

Before deciding any verdict, build a review bundle for the selected source and target. Prefer explicit refs from the user or app policy; otherwise infer conservatively and stop if the target is ambiguous.

Capture:

- app root and workflow root
- selected change folder
- source branch or ref
- exact source commit SHA covered by the review
- target branch or ref
- merge base
- source-only commits
- target-only commits, when useful for behind-state risk
- changed file list from `target...source`
- source-vs-target diff stat
- source-vs-target diff
- working tree dirty state, separated into app/source repo, workflow artifact repo, and unrelated repos
- untracked files relevant to the app/source repo
- conflict check result without performing a merge
- branch policy and whether the current source/target pair satisfies it
- active `review.md`, `tasks.md` review state, manual confirmation state, release-communication state, PR/merge state, and closeout state

Use commands like these when the repo supports them, adjusting refs to the app policy:

```bash
git status --short
git branch --show-current
git rev-parse SOURCE^{commit}
git merge-base TARGET SOURCE
git log --oneline TARGET..SOURCE
git log --oneline SOURCE..TARGET
git diff --name-status TARGET...SOURCE
git diff --stat TARGET...SOURCE
git diff TARGET...SOURCE
git merge-tree --write-tree TARGET SOURCE
```

Prefer `git merge-tree --write-tree TARGET SOURCE` for conflict checks. Treat exit code `0` plus a printed tree object as clean, and a non-zero exit as a conflict or mergeability failure that needs inspection. Avoid piping human-readable merge output through broad `rg "CONFLICT|<<<<<<<|changed in both"` checks as the primary signal; those searches can self-match review artifacts or command text and create false positives.

Treat `TARGET...SOURCE` as the primary PR-style review diff. Use the working tree diff only to understand uncommitted review fixes, local artifact edits, generated files, or blockers. Do not allow unrelated dirty files outside the source repo to obscure the source-vs-target review.

Record the bundle summary, including the immutable reviewed source commit, in `review.md` when findings exist, or in `tasks.md` when the review is clean and no `review.md` is required. A branch name alone is not a sufficient review watermark because it can advance after review.

## Required Context

Before reviewing, read:

- `docs/changes/yyyy-mm-dd-change-name/proposal.md`
- `docs/changes/yyyy-mm-dd-change-name/design.md`
- `docs/changes/yyyy-mm-dd-change-name/tasks.md`
- existing `docs/changes/yyyy-mm-dd-change-name/review.md`, if present

Validate that active `tasks.md` frontmatter uses `proposed`, `in_progress`, `review`, `replanning`, or `ready_to_close`. In mutating modes, set `status: review` when independent review begins. In `--check`, report a stale or invalid status without editing it.
- Run `sdd validate <space-id> --change <change-id> --repo <resolved-repository-path> --workspace <workspace-root> --json` before the broad review wave and again after artifact remediation. Treat deterministic errors as review findings and inspect warnings, but continue the independent diff, implementation-truth, evidence-strength, security, docs, and acceptance review even when validation passes.
- project-defined release communication when the proposal or task ledger says it is affected, or implementation changes public release meaning
- relevant target Epic files under `docs/epics/*/epic.md`
- enough of every active `docs/epics/*/epic.md` to detect duplicate Story labels inside an Epic, duplicate full Story references, or conflicting legacy app-wide Story IDs
- vault, workspace, and app `AGENTS.md`, especially app branch policy
- planning-root docs or the PRD/Product Brief when product scope changed, the change claims product direction, or PRD drift was flagged
- project visual/style guidance, design-system notes, or app visual identity docs when the change affects app UI, layout, styling, component density, interaction polish, or visual identity
- the Change's `Experience Design` section and stable prototype/design references when present or required by `tasks.md`
- project README and existing or locally required docs under `docs/` when affected, including architecture, testing, security, deployment, style, data/API contracts, operations, and current-state docs
- source-vs-target diff and changed file list
- code, tests, generated files, docs, and configuration touched by the change

Check git status in every repo that may change. Preserve unrelated dirty files. Treat app/source repo changes separately from vault/workflow artifact changes unless they live in the same repository.

For review readiness, uncommitted files outside the implementation/source repo do not block review, PR, or merge readiness unless they are explicitly part of the requested change, target repo, or branch operation. Report related workflow-artifact or adjacent-repo dirty state clearly, but do not classify it as blocking merely because it is uncommitted. Source-repo dirty state still blocks readiness when it is part of the change and not committed or explicitly deferred.

## Delegated Review Model

Default to an orchestrator-and-reviewers model when subagent tooling is available and the change is not trivial. The main agent remains responsible for the final verdict, git safety, branch policy, artifact mutation, safe fixes, and validating delegated claims.

The user's invocation of this skill is the standing delegation authorization for the selected SDD review. Keep work local when `--no-delegate` is active, tooling is unavailable, the change is tiny, isolation would add risk, or another explicit stop condition applies. Do not turn delegation selection into required ledger telemetry.

Use delegated fresh-context passes for:

- artifact truth and Change-status consistency
- source-vs-target code review
- verification and Requirement/Scenario coverage
- risk-shaped evidence review for deterministic edge cases the happy path may miss
- security review
- UI/UX and visual identity review when the diff affects user-visible UI
- experience-contract review when a confirmed design direction exists, including flow, responsive composition, required states, accessibility behavior, and accepted deviations
- documentation, release communication, and PRD alignment
- branch, conflict, and integration readiness

Use the main thread only when:

- `--no-delegate`, `--fast`, `--artifact-only`, or `--diff-only` narrows the task
- the change is tiny enough that subagents would add process noise
- the review surface is too ambiguous to delegate safely
- subagent tooling is unavailable
- the user needs to answer a question before a reviewer can be scoped

Parallelize read-only delegated review passes when their scopes do not overlap. Do not delegate Change-status decisions, commits, PR creation, merges, closeout moves, branch operations, or final verdicts.

Treat all materially relevant delegated passes plus the orchestrator's own inspection as one review discovery wave. Do not begin ordinary remediation while required passes are still outstanding. Once the wave completes or reaches the bounded fallback threshold:

1. Validate findings against the actual source-vs-target diff and artifacts.
2. Deduplicate findings that describe the same root cause.
3. Resolve contradictions between reviewers before editing.
4. Classify the complete set by severity and remediation boundary.
5. Create one ordered remediation batch grouped by root cause and affected verification.

A confirmed critical security issue, destructive-data risk, active production hazard, or ambiguity that makes continued inspection unsafe may stop the wave early. Ordinary code, test, accessibility, documentation, CI, or artifact findings should be accumulated instead of surfaced as serial interruptions.

Keep delegated review waits bounded. Continue independent review work after spawning, and wait only when the next required decision depends on delegated evidence. Never wait silently for more than 60 seconds; report which gates are complete and which review pass remains. After roughly three minutes of cumulative waiting on one pass or review wave, interrupt or close the slow reviewer and complete that gate locally, or re-delegate a narrower question. An optional reviewer must never prevent a concise status response. Close completed or abandoned reviewers promptly.

Use `assets/subagent-pr-review-prompt.md` for delegated passes when structured prompts help. Each delegated review prompt must include:

- implementation root and workflow root
- change folder and artifact paths
- source branch/ref, target branch/ref, and merge base
- changed files and any narrowed file scope
- assigned review pass
- relevant Story, Requirement, and Scenario IDs when known
- branch policy summary
- selected available skills and guidance to load, with selection reasons
- explicit instruction not to edit, commit, push, merge, close, or update Change status
- required report shape

Treat subagent output as evidence, not final truth. Validate important claims by inspecting the referenced files, checking the source-vs-target diff, rerunning focused commands when practical, and rejecting vague findings without concrete impact.

## Review Gates

Run every gate that applies and record `pass`, `findings`, `blocked`, or `not applicable`. Apply the detailed semantics from the managed workflow document, the canonical templates, selected available review skills, and project guidance instead of restating them here.

1. **Artifact truth**: proposal, design, task ledger, Epic/Story truth, Requirements, Scenarios, evidence maps, gaps, and Change status agree with implementation reality.
2. **Source-vs-target code review**: review the actual diff and source-only commits for correctness, regressions, maintainability, accidental scope, project-pattern fit, and user-visible state handling.
3. **Verification**: scenario-mapped focused evidence exists, broad gates are not substituted for behavior proof, production/mock boundaries are honest, and required project checks pass or have explicit blocking gaps.
4. **Risk-shaped evidence**: important deterministic claims are challenged against plausible failure modes and supported by tests, source inspection, repeatable runtime evidence, or an explicit gap.
5. **Security and data safety**: use relevant available security guidance and inspect the risk surfaces identified by the diff and project policy.
6. **Manual acceptance**: user-facing changes have the workflow-defined walkthrough and status when applicable; project policy decides whether confirmation itself blocks readiness.
7. **Supporting truth**: required project docs, release communication, generated indexes, ADRs, and product direction do not contradict the implementation or Epic map.
8. **Integration readiness**: source, target, reviewed commit, dirty state, conflict state, required checks, authorization, and the project-defined PR/merge/closeout path are unambiguous.

Before finalizing the discovery wave, explicitly challenge cross-cutting failure classes that commonly escape happy-path tests when they are relevant to the diff: upgrade paths and migration immutability, existing-data compatibility, async focus or draft preservation, responsive interaction targets and accessibility, dependency or CI action validity, generated-contract drift, and fresh-install versus existing-install behavior. Keep this framework-neutral and mark irrelevant classes `not applicable`; do not manufacture work where the diff creates no such risk.

Select the smallest materially relevant set of available skills for these gates, read them completely, pass them into delegated review work, and validate their consequences. Absence of an optional skill is not a blocker; unresolved risk is.

Do not use verdict `ready` unless the complete review bundle and every required gate pass with no unresolved blocking finding. Narrow modes may report narrower outcomes but must not imply full integration readiness.

## Review Findings

Classify findings as:

- `BLOCKING`: must be resolved before integration.
- `REQUIRED`: should be resolved unless the user explicitly accepts the risk.
- `SUGGESTION`: non-blocking improvement.

When unresolved `BLOCKING` or `REQUIRED` findings remain after consolidated safe remediation and regression rereview, create or update the review artifact at the project-resolved change location using `assets/review-template.md`. Do not duplicate the template in this skill.

If the review is clean, a separate review artifact is optional unless project policy requires one. Record the verdict, date, review scope, source and target, and exact reviewed source commit in the task ledger so later PR stewardship can detect review staleness.

## Remediation

Default mode performs one consolidated safe-remediation batch after the complete discovery wave. With default mode or `--fix`, only include findings that are:

- clearly in scope for the SDD change
- small enough to verify in the same review pass
- not product decisions, architecture rewrites, data migrations, destructive actions, secrets, branch operations, or broad refactors

Safe automatic fixes include stale generated indexes, stale task-ledger checkboxes, missing verification entries for checks already run, small Epic evidence/date corrections, mechanical release-communication placement, formatting/lint fixes with obvious local intent, mechanical duplicate Story reference cleanup when ownership is obvious, and similarly narrow artifact drift.

After the finding set is consolidated:

1. Update `review.md` with the complete validated finding set and planned safe batch when a review artifact is required.
2. Apply all independent safe fixes in one remediation phase, ordered so shared root causes are corrected before dependent symptoms.
3. Rerun the union of affected focused verification and required broad gates once after the batch, not once per finding unless an intermediate check is necessary to avoid compounding risk.
4. Perform one regression-focused rereview of the updated diff. Recheck code, security, data, artifacts, and any gate touched by remediation; do not repeat unaffected discovery work without a concrete reason.
5. Reconcile `review.md`, `tasks.md`, and Epic evidence with the post-remediation truth.
6. Confirm the working tree contains only the intended safe-fix files plus any unrelated pre-existing dirty files, and stage only the intended safe-fix files.
7. Create one local commit for the verified safe review batch with a concise message, such as `Address sdd-review findings`, scoped to the current repo. Do not stage unrelated dirty files, do not amend earlier commits, and do not push.
8. Report the final verdict, consolidated fixes, commit hash, residual findings, and unrelated dirty files that were preserved.

The regression rereview is a validation pass, not a second broad discovery wave. If it reveals a genuinely new safe regression introduced by the batch, fix it within the same run when practical and rerun only affected checks. If it reveals pre-existing review scope that the original complete wave should have covered, record the process miss and consolidate the remainder before stopping; do not drip-feed one finding per invocation. Additional broad review-fix cycles require `--until-ready`.

If the safe-fix diff cannot be isolated from unrelated dirty files, affected verification fails, or the local commit fails, stop and report the blocker instead of continuing.

If findings require implementation work beyond safe review remediation, leave them in `review.md` and recommend returning to `/sdd-apply`.

If a finding is specifically unresolved experience direction within already accepted behavior, return the Change to `in_progress` and route it through `/sdd-design` before more UI implementation. If resolving the design would change Requirements, Scenarios, scope, ownership, contracts, data, auth, or technical constraints, use `replanning` and `/sdd-change --replan` instead.

Set `tasks.md` status from the verdict: use `in_progress` when implementation or ordinary remediation remains, `replanning` when product/Requirement/Scenario/scope/ownership decisions must be revised, `review` when review is incomplete or blocked without requiring replanning, and `ready_to_close` only when the full review and closeout gates pass.

## PR, Merge, And Closeout

When all gates pass:

- If the target is the production branch, do not create the PR or merge from `/sdd-review`; report that the change is locally ready and hand off to `/sdd-release`.
- If `--pr` is authorized, create a PR following app branch policy. Include the change path, summary, Requirements/Scenarios covered, verification evidence, security review result, and remaining non-blocking risks.
- If `--merge` is authorized, merge following app branch policy. Recheck target branch, conflict state, dirty state, and required checks immediately before merging.
- If `--merge-and-close` is authorized, merge and close following app policy. Recheck target branch, conflict state, dirty state, required checks, and closeout state immediately before merging or closing. If app policy requires a PR, push, rebase, remote PR merge, or another action not explicitly authorized, stop before that action and report the remaining policy step.
- If neither `--pr`, `--merge`, nor `--merge-and-close` is authorized and the ready verdict targets a non-production branch, ask the user whether to perform the policy-defined merge-and-close now. Spell out the source branch, target branch, merge strategy or policy requirement, `sdd change close` transition, closeout commit location, and any action that still requires separate authorization such as push, rebase, branch deletion, remote PR merge, deployment, or production promotion.
- If neither `--pr`, `--merge`, nor `--merge-and-close` is authorized and the ready verdict targets production, report that the change is locally ready and hand off to `/sdd-release`.

Do not push unless explicitly authorized or required by an explicitly requested PR workflow. Do not close the change folder until PR/merge/acceptance state is clear and the user has explicitly asked to close, finish, merge-and-close, or otherwise complete the change.

When merge-and-closing:

1. Follow the app's local `AGENTS.md` merge policy for target branch, merge strategy, PR requirements, and whether direct integration-branch commits are allowed.
2. Perform the non-production merge/integration step before closeout unless project policy explicitly says to close on the source branch first.
3. After the merge/integration step succeeds, update the closeout record with the actual PR/merge status, target branch, date, commit or PR reference when available, review outcome, manual confirmation status, release-communication status, and remaining accepted risks.
4. Run `sdd change close <space-id> <change-id> --repo <resolved-repository-path> --workspace <workspace-root>`, then commit the closeout mutation in the repo and branch required by app policy.
5. Verify the target branch has the closed change path, no active duplicate path, and no contradictory references to the old active path.

When closing:

1. Ensure `tasks.md` has `status: ready_to_close` and its closeout reflects review outcome, review record, manual confirmation status, release-communication status, PR/merge state, remaining accepted risks, and that no contradictory checklist or Resume Here state remains.
2. Run `sdd change close <space-id> <change-id> --repo <resolved-repository-path> --workspace <workspace-root>`. Use repeated `--repo` selections only for a coordinated close after every selected repository passes its own contextual gates.
3. Do not write `status: closed`; folder location is the closed state. Verify references to the active path are historical or updated.

## Stop Conditions

Stop and report when:

- change or branch selection is ambiguous.
- required artifacts are missing or contradictory.
- branch policy is missing with no documented fallback, violated for implementation changes, or unclear for a requested PR/merge/closeout.
- unrelated app/source-repo dirty files block safe review, fixes, PR, or merge.
- required checks fail without a safe in-scope fix.
- security review finds unresolved risk.
- Epic truth or Requirement/Scenario evidence is stale, incomplete, or unmapped.
- a deterministic implementation claim is important to readiness but is only asserted in artifacts, not supported by concrete source inspection, automated verification, manual/browser evidence, or an explicit accepted gap.
- later implementation or Stories superseded earlier Epic truth without reconciling the earlier Story wording, evidence, or gaps.
- duplicate Story labels inside one Epic, duplicate full Story references, or duplicate legacy app-wide Story IDs exist without an explicit migration/blocking note and cannot be safely corrected mechanically during the review pass.
- new or modified Stories lack stable Epic-scoped labels or documented legacy Story IDs, local Requirement IDs, local Scenario IDs, or concrete non-generic Scenarios.
- user-facing app changes lack a useful manual UI confirmation walkthrough, the walkthrough is stale relative to the implementation, or the review does not explicitly state which manual UI tests the user should confirm next.
- a required or claimed `Experience Design` is unconfirmed, identifies its selected direction only through an unstable reference such as “latest,” contradicts accepted Requirements, or is materially absent from the implemented responsive/state/accessibility behavior without an explicit accepted deviation.
- manual confirmation status, review record, release-communication state, PR/merge state, or closeout state is contradictory.
- closed or closing change artifacts still contain stale implementation-pending or verification-pending language that contradicts accepted Epic truth.
- affected existing or locally required project docs under `docs/` contradict implementation, Epic truth, branch/release policy, testing commands, architecture, data/API contracts, deployment behavior, operations, or visual style.
- required release communication is missing, misleading, private when it should be public, or inconsistent with the project's configured format.
- PRD/product-direction drift is unresolved when the change depends on it.
- PR/merge targets the production branch; route to `/sdd-release` instead.
- PR/merge/closeout would require push, rebase, destructive action, production credentials, deployment, target-branch changes beyond an explicitly authorized `--merge-and-close` closeout commit, or human approval not already granted.
- findings need product, architecture, data, auth, or scope judgment from the user.

## Final Response

Lead with verdict.

Include:

- verdict: `ready`, `changes-requested`, or `blocked`
- selected change path, source branch, exact reviewed source commit, and target branch
- blocking and required findings, ordered by severity
- whether `review.md` was created or updated
- Requirement/Scenario coverage result
- Story reference traceability result
- Epic truth result
- test and verification commands/results
- manual UI confirmation walkthrough status, plus a concise `Suggested manual UI testing` list with route/setup/actions/expected result for anything the user should confirm; say `none` when no manual UI confirmation is useful
- Change status, closeout readiness, and any contradictory state
- formal security review result
- docs result
- release-communication result
- PRD alignment result when checked
- branch and merge readiness result
- PR, merge, or closeout action taken, offered for confirmation, or blocked
- remaining risks and next action
