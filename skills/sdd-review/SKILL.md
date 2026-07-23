---
name: sdd-review
description: Run the independent local integration review after /sdd-apply or before closing. Complete every applicable review gate across the source-vs-target diff, reverse traceability, SDD artifacts, implementation, verification, security, UI, docs, product truth, branch policy, and closeout state before issuing one consolidated verdict; never stop discovery at the first ordinary finding. Use when the user invokes /sdd-review or asks to verify, review, prepare integration readiness, address findings, finish, close, or perform a non-production integration handoff. Use /sdd-release for production promotion.
---

# SDD Review

Review a SDD change like a local pull request. This is the final independent gate after `/sdd-apply`: confirm the implemented change satisfies its artifacts, the durable Epic is current, verification is strong enough, and the source branch is ready for local integration, PR, or merge according to the app's branch policy.

## Authority And Project Profile

Resolve the workspace, idea-owned planning path, and target implementation repository with `sdd context <relevant-path> --json`, then read the `workflowPath` returned by `sdd context` completely before judging artifact authority, traceability, evidence, reconciliation, or closeout. Use the resolved topology unless project guidance declares an explicit exception, then enforce Epics under `docs/epics/` and active/closed changes under `docs/changes/` inside the implementation repository. Project guidance owns source and target policy, required checks, merge/PR rules, truth-bearing supporting-doc requirements, release conventions, technology constraints, available review skills, and permissions. If user setup is missing, direct the user to `sdd setup`; if the repository contract is missing, direct them to `sdd init` there. Use `sdd doctor` for an existing but unhealthy installation.

Default behavior is deep review. A clean `/sdd-review` means the source branch and its evidence are technically ready for the selected target, not merely that the active change folder looks plausible. Required manual acceptance and explicit integration authorization remain separate readiness gates. The primary review surface is the source-vs-target diff plus the SDD artifacts that claim to explain it. When default review returns `ready` for a non-production target and closeout readiness passes, treat merge-and-close as the obvious recommended next action and ask the user to confirm it. Use cheaper or narrower modes only when the user asks for them explicitly.

Full-review invariant: complete the entire applicable discovery surface before issuing a verdict or beginning ordinary remediation. A `BLOCKING` or `REQUIRED` finding in one gate is evidence for the final verdict, not permission to skip later gates. Continue all independent read-only inspection, verification, and delegated passes even when integration is already known to be blocked. Halt the whole discovery wave early only when further inspection itself is unsafe or impossible, such as unresolved change/branch selection, inaccessible required inputs, an active destructive or production hazard, or required authorization for the next inspection step. When mutation, credentials, or user judgment block one gate, mark that gate `blocked` and finish every other independent gate that remains safe.

Execution-continuity invariant: a running, yielded, or just-completed command is pending review work, not a handoff boundary. Resume or poll long-running command sessions until they complete, provide a concise progress update at least every 60 seconds while work continues, and then immediately continue the next unfinished gate. If the user asks for status while the review is active, answer the status question and continue unless the user cancels or replaces the review. A missed progress update is a process failure to correct, never an explanation for returning control early. Do not send the final response until the complete gate scorecard and consolidated verdict are ready or a genuine Stop Condition makes further safe inspection impossible.

Use `/sdd-release` instead when the task is production-target promotion, full release checks, release-artifact finalization, or the project-defined release handoff.

Use `assets/review-template.md` when creating or refreshing `review.md`.

Use `/sdd-review` to prepare routine changes for the project-defined integration target. Whether that requires a PR or direct local integration belongs to project policy; production-target promotion belongs to `/sdd-release`.

Do not treat this as more implementation planning. In default mode, run the complete PR-style review before beginning remediation. Launch materially relevant fresh-context review passes together, collect all results, validate and deduplicate their findings, and publish one consolidated finding set. Then fix the complete safe subset as one batch, rerun affected verification, and perform one regression-focused rereview of the updated diff. Do not stop between those stages merely to report ordinary findings. Stop only for a defined stop condition, user judgment, or an unsafe remediation boundary. If deficiencies remain outside safe review remediation, write or update `review.md` so one later `/sdd-apply` can address the consolidated batch.

Delegation authorization: invoking `/sdd-review`, naming `sdd-review`, asking to review an SDD change, or asking to close/finish/merge a SDD change is explicit permission to use bounded SDD review subagents under this skill's delegation model. If the local tool policy requires an explicit user request before spawning subagents, this skill invocation satisfies that requirement for non-trivial artifact, code, verification, security, UI, docs, or branch-readiness review passes that remain inside the selected change. Do not ask for separate subagent permission unless the user passed `--no-delegate`, the requested delegation would exceed the selected change, the tool requires a more specific approval than normal spawning, or a stop condition applies.

Always validate closeout readiness as part of review. If the user asks to finish, close, merge-and-close, or otherwise complete the change, perform the closeout mutation only after review passes, branch/PR/merge/acceptance state is clear, and the change-local artifacts agree with reality.

## Inputs And Modes

Start from an explicit change folder, change name, source branch, target branch, or active change inferred from the conversation.

Supported modes:

- Default: run one complete deep PR-style discovery wave against the selected target branch, finish every applicable gate even after findings are known, consolidate and validate the full finding set, fix the complete safe in-scope subset as one batch, rerun affected checks, perform one regression-focused rereview, commit only the verified safe-fix batch, and report one resulting verdict. Long-running or completed commands do not change this terminal condition. Do not pause after individual findings or require another `/sdd-review` invocation to discover omitted review categories. Do not create a PR, merge, push, or close the change without confirmation. If the verdict is `ready` but manual confirmation is `pending user`, present the prepared walkthrough and report closeout readiness separately. If the verdict is `ready`, the target is non-production, and closeout readiness passes, ask whether to perform the policy-defined merge-and-close next.
- `--deep`: explicit alias for default behavior.
- `--fast`: run a lightweight review on the main thread only. Still check source-vs-target diff, required SDD artifacts, branch policy, dirty state, security, and verification evidence, but skip delegated review passes and broad optional checks unless a risk is obvious.
- `--artifact-only`: review SDD artifacts, Epic truth, Change status, manual confirmation status, release-communication status, and PRD alignment when applicable. Do not review application code beyond what is necessary to confirm artifact claims. Do not return `ready` for integration from this mode; use `artifact-ready`, `changes-requested`, or `blocked`.
- `--diff-only`: review the source-vs-target code/config/test/docs diff, branch readiness, security, and verification evidence. Do not reconcile full Epic or PRD truth beyond obvious contradictions. Do not return full SDD closeout readiness from this mode.
- `--no-delegate`: use the main thread only. Use when subagent tooling is unavailable, the change is tiny, or delegation would add more noise than useful independent review.
- `--check`: review only and do not edit any files, including `review.md`.
- `--no-fix`: review only, write or update `review.md` when deficiencies exist, and report the verdict.
- `--until-ready`: after the default full discovery, batch remediation, and regression rereview, allow additional bounded remediation cycles until all gates pass or a stop condition occurs. This changes only the number of remediation cycles; it must end with the same complete Final Response as a single review loop. Per-cycle updates are progress messages, not substitute verdicts.
- `--max-iterations N`: cap `--until-ready`; default to `5`.
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
- available PR description, linked issue, review discussion, relevant source-only commit history, and related-repository context; record material context that is unavailable rather than silently assuming it does not exist
- project-configured linters, typecheckers, static/security/dependency analyzers, generated-contract checks, and CI commands relevant to the changed surface
- the project-defined aggregate gate or authoritative constituent commands, their source of truth, and any documented optional checks
- the Verification Scope Decision, including risk or policy triggers, exact candidate ref, freshness/cache treatment, and recorded result
- the prospective integration tree and whether it materially differs from the reviewed source candidate
- active `review.md`, `tasks.md` review state, manual confirmation state, release-communication state, PR/merge state, and closeout state
- JSON reverse-traceability inventory for the source working tree since the selected target or merge base, produced by the packaged `sdd-orphan-audit` script with `--changed-from`; run one `--epic` pass per affected Epic when ownership needs to be distinguished

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

## Resolve Verification Scope

Keep focused behavior proof, aggregate candidate proof, and integration-candidate proof distinct. Focused tests establish individual Requirements and Scenarios; broad gates support them but do not replace their exact evidence.

Resolve the project-defined aggregate command from project guidance, testing/CI docs, workflow files, and package scripts. Require aggregate proof when project policy requires it or when the reviewed diff crosses multiple capabilities, persistence or migrations, auth/security/privacy boundaries, process-global state, shared contracts, concurrency/workers/recovery, or another surface where isolated checks can conceal integration failures. Do not impose one universal command name or constituent list. Prefer one project-owned command; otherwise record and run the authoritative equivalent constituents. If materially required proof cannot be identified or run safely, block `ready` unless the user explicitly accepts the gap.

Run every required aggregate gate freshly against the exact committed source candidate after the final review remediation. Bypass caches or prove meaningful fresh execution, and record the command, commit, constituent/test counts or equivalent execution evidence, and result. A later evidence-record-only commit may reuse that result only after its diff is classified and every gate that observes the changed artifacts is rerun; any behavior, test, dependency, configuration, migration, generated, executable, or gate-observed change invalidates the prior result. An earlier behavior candidate, a green command that skipped meaningful work, remote CI for another ref, focused suites, or structural SDD validation cannot satisfy this gate.

Require integration-candidate proof when the target has advanced, contains accumulated Changes, requires conflict resolution, or produces a materially different prospective tree. Materialize that result through a safe disposable worktree or equivalent non-destructive project mechanism, record its tree/ref, and run the required aggregate gate there. Recheck source and target refs immediately before integration. Reuse source-candidate proof only when the prospective integration content is demonstrably identical; otherwise a changed tree requires fresh proof. After integration, confirm the actual integrated tree matches the tested tree or rerun the gate before closeout.

## Required Context

Before reviewing, read:

- `docs/changes/yyyy-mm-dd-change-name/proposal.md`
- `docs/changes/yyyy-mm-dd-change-name/design.md`
- `docs/changes/yyyy-mm-dd-change-name/tasks.md`
- existing `docs/changes/yyyy-mm-dd-change-name/review.md`, if present

Validate that active `tasks.md` frontmatter uses `proposed`, `planned`, `in_progress`, or `in_review`. In mutating modes, run `sdd change transition <space-id> <change-id> --from in_progress --to in_review` when independent review begins from completed implementation; retain `in_review` when review is already underway. In `--check`, report a stale or invalid status without editing it.
- Run `sdd validate <space-id> --change <change-id> --repo <resolved-repository-path> --workspace <workspace-root> --json` before the broad review wave and again after artifact remediation. Treat deterministic errors as review findings and inspect warnings, but continue the independent diff, implementation-truth, evidence-strength, security, docs, and acceptance review even when validation passes.
- project-defined release communication when the proposal or task ledger says it is affected, or implementation changes public release meaning
- relevant target Epic files under `docs/epics/*/epic.md`
- enough of every active `docs/epics/*/epic.md` to detect duplicate Story labels inside an Epic, duplicate full Story references, or conflicting legacy app-wide Story IDs
- vault, workspace, and app `AGENTS.md`, especially app branch policy
- the resolved Idea planning path's current entry-point docs, such as its Folder Note, README, current-status note, or equivalent; reconcile their repository links, active/archived labels, current implementation claims, and current focus against `.sdd/config.yaml`, the selected repository, and implementation reality
- the PRD/Product Brief and other product-direction docs when product scope changed, the change claims product direction, or product drift was flagged
- project visual/style guidance, design-system notes, or app visual identity docs when the change affects app UI, layout, styling, component density, interaction polish, or visual identity
- the Change's `Experience Design` section and stable prototype/design references when present or required by `tasks.md`
- application component previews and any project-configured shared reference catalog when the `Experience Design` records adopted references, reference candidates, deliberate divergences, or promotion claims
- the project-defined truth-bearing supporting-doc set; when none is declared, inspect the README, changed docs, and documents whose current claims intersect the diff, including architecture, testing, security, deployment, style, data/API contracts, operations, and current-state docs
- source-vs-target diff and changed file list
- code, tests, generated files, docs, and configuration touched by the change

Check git status in every repo that may change. Preserve unrelated dirty files. Treat app/source repo changes separately from vault/workflow artifact changes unless they live in the same repository.

For review readiness, uncommitted files outside the implementation/source repo do not block review, PR, or merge readiness unless they are explicitly part of the requested change, target repo, or branch operation. Report related workflow-artifact or adjacent-repo dirty state clearly, but do not classify it as blocking merely because it is uncommitted. Source-repo dirty state still blocks readiness when it is part of the change and not committed or explicitly deferred.

## Systematic Review Search

Default and deep review must generate candidates through distinct passes instead of relying on one salience-driven reading of the diff. Scale the work to the change, but complete every applicable pass before consolidating findings:

1. **Intent and history**: derive promised behavior and constraints from the Change artifacts, diff, source-only commits, and available PR description, linked issue, review discussion, or related-repository context. Treat missing external context as a blind spot, not evidence that no constraint exists.
2. **Complete diff coverage**: inspect every changed path and behavior-bearing hunk, including deleted and renamed code, tests, configuration, schemas, migrations, generated contracts, and supporting docs. Classify generated or mechanical changes explicitly rather than skipping them implicitly.
3. **Dependency and contract propagation**: for every changed public or behavior-owning symbol, trace materially relevant callers, consumers, registrations, imports, routes, persistence, schemas, configuration, generated boundaries, and downstream tests. Check both upstream inputs and downstream effects; existing Epic paths and search/index results are starting points, not complete coverage.
4. **Deterministic tool pass**: discover relevant configured tools from project guidance, package scripts, CI workflows, and checked-in configuration, then run the applicable lint, typecheck, static/security/dependency, generated-contract, and test checks. Do not install or impose a new scanner merely to make the review look broader. Treat tool output as finding candidates that still require impact and diff validation.
5. **Risk-shaped reasoning passes**: separately challenge correctness and regressions; typed-result preservation across service/plugin/transport/client boundaries; security and data safety; capability authority and content-budget/provenance conservation; filesystem mutation order and confinement; concurrency, async timing, retry, cancellation, restart, and recovery; API/schema/configuration compatibility and migrations; test/evidence strength; and rendered UI behavior when applicable. A green aggregate command does not replace these passes.
6. **Blind-spot accounting**: record unavailable metadata, providers, related repositories, external contracts, runtime environments, scanners, or rendered surfaces that could materially change confidence. Mark the affected gate `blocked` or record an explicit accepted gap when the missing surface is required.

Keep the union of candidates until the discovery wave is complete. Validate each candidate against the actual source-vs-target diff, concrete code path, executable reproduction, deterministic tool result, or artifact contract before promoting it to a finding. Record inspected surfaces and rejected material candidates in reviewer output when that is necessary to show coverage; do not inflate the final report with preference-only or disproved concerns.

## Delegated Review Model

Default to an orchestrator-and-reviewers model when subagent tooling is available and the change is not trivial. The main agent remains responsible for the final verdict, git safety, branch policy, artifact mutation, safe fixes, and validating delegated claims.

The user's invocation of this skill is the standing delegation authorization for the selected SDD review. Keep work local when `--no-delegate` is active, tooling is unavailable, the change is tiny, isolation would add risk, or another explicit stop condition applies. Do not turn delegation selection into required ledger telemetry.

Use delegated fresh-context passes for:

- artifact truth and Change-status consistency
- source-vs-target code review
- verification and Requirement/Scenario coverage
- evidence falsification for new or high-risk completion, `Verified By`, E2E, security, recovery, and production-path claims
- pattern conformance when the diff adds or changes an adapter, client, route, workspace, worker, migration, command, or other surface parallel to an established implementation
- boundary-contract review when important typed results, errors, statuses, permissions, or retry decisions cross service, plugin/capability, adapter, transport, or client layers
- stateful transition review when the diff owns editable, autosaving, cached, routed, asynchronous, durable, or identity-sensitive behavior
- risk-shaped evidence review for deterministic edge cases the happy path may miss
- security review
- UI/UX and visual identity review when the diff affects user-visible UI
- experience-contract review when a confirmed design direction exists, including flow, responsive composition, required states, accessibility behavior, and accepted deviations
- documentation, release communication, Idea-side repository/current-state truth, and PRD alignment
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

A confirmed critical security issue, destructive-data risk, or active production hazard may stop mutations, runtime checks, or integration immediately. Continue the remaining safe read-only review gates unless the hazard or unresolved ambiguity makes further inspection itself unsafe. Ordinary code, test, security, accessibility, documentation, CI, integration-readiness, or artifact findings must be accumulated instead of surfaced as serial interruptions.

Keep delegated review waits bounded. Continue independent review work after spawning, and wait only when the next required decision depends on delegated evidence. Never wait silently for more than 60 seconds; report which gates are complete and which review pass remains. After roughly three minutes of cumulative waiting on one pass or review wave, interrupt or close the slow reviewer and complete that gate locally, or re-delegate a narrower question. An optional reviewer must never prevent a concise status response. Close completed or abandoned reviewers promptly.

Use `assets/subagent-pr-review-prompt.md` for delegated passes when structured prompts help. Each delegated review prompt must include:

- implementation root and workflow root
- change folder and artifact paths
- source branch/ref, target branch/ref, and merge base
- changed files and any narrowed file scope
- assigned review pass
- relevant Story, Requirement, and Scenario IDs when known
- branch policy summary
- available PR/issue/review-history and related-repository context, or an explicit note that it is unavailable
- configured deterministic review tools relevant to the assigned pass
- selected available skills and guidance to load, with selection reasons
- explicit instruction not to edit, commit, push, merge, close, or update Change status
- required report shape

Treat subagent output as evidence, not final truth. Validate important claims by inspecting the referenced files, checking the source-vs-target diff, rerunning focused commands when practical, and rejecting vague findings without concrete impact.

## Review Gates

Run every gate that applies and record `pass`, `findings`, `blocked`, or `not applicable`. Do not short-circuit this list because an earlier gate already guarantees `changes-requested` or `blocked`; complete later independent gates so the user receives one comprehensive finding set. Before finalizing, confirm that every gate has an explicit result and that no delegated or main-thread review pass remains uncollected. Apply the detailed semantics from the managed workflow document, the canonical templates, selected available review skills, and project guidance instead of restating them here.

1. **Artifact truth**: proposal, design, task ledger, Epic/Story truth, Requirements, Scenarios, independent implementation/verification state, behavior and evidence maps, implementation/verification gaps, and Change status agree with implementation reality.
2. **Canonical map authority and cold navigation**: confirm every Story has one current `Implemented By` map and one current `Verified By` map, with no competing `Prior`, `Detailed`, `Legacy`, or migration-era maps. For every changed Requirement, and for Scenarios with distinct owners, start from the Epic and identify the primary governing definition, registration, or configuration plus stable anchor without a repository-wide rediscovery search. Treat imports, call sites, incidental handlers, broad file tokens, files cited for a different symbol, undifferentiated dumps, mappings that stop at UI/tests, missing paths/anchors, and unclassified support files as findings.
3. **Source-vs-target code review**: review the actual diff and source-only commits for correctness, regressions, maintainability, accidental scope, project-pattern fit, and user-visible state handling.
4. **Pattern conformance**: when the diff adds or changes a surface parallel to an established adapter, client, route, workspace, worker, migration, command, or similar implementation, identify the closest current reference and compare applicable auth/session/CSRF, retry, timeout/cancel, error/conflict, recovery, pending-write, identity, route-context, configuration, generated-contract, accessibility, and visual-token behavior plus focused tests. Unexplained divergence or copied defects are findings.
5. **Boundary contracts**: when important typed results, errors, statuses, permissions, or retry decisions cross service, plugin/capability, adapter, transport, or client layers, trace each origin condition through the domain result, every mapping, client-visible behavior and retryability, and exact proof. Generic fallbacks or exception handlers that erase a required distinction are findings.
6. **Reverse traceability**: classify every behavior-bearing source/test candidate from the diff inventory as Epic-owned, supporting/generated/framework infrastructure, an explicit gap, or tracked cleanup. For refactors, check stranded routes, registrations, imports, dependencies, tests, migrations, generated bindings, and obsolete files. Skipping this inventory blocks `ready`.
7. **Verification**: scenario-mapped focused evidence exists, broad gates are not substituted for behavior proof, production/mock boundaries are honest, the Verification Scope Decision is explicit, and required aggregate candidate checks pass freshly on the exact reviewed commit or have explicit blocking gaps.
8. **Evidence falsification**: for every new or high-risk completion, `Verified By`, E2E, security, recovery, or production-path claim, open the cited proof and confirm its exact test title or stable named anchor, important assertion/observation, and discovery by the command that passed. Reject generic framework anchors such as `#it(`, unsupported Scenario aggregation, missing/skipped/undiscovered evidence, and server-side proof used to imply untested client retry, redirect, timeout, draft, navigation, or recovery behavior.
9. **Risk-shaped evidence and stateful transitions**: challenge important deterministic claims against plausible failure modes. For editable, autosaving, cached, routed, asynchronous, durable, or identity-sensitive surfaces, inspect applicable concurrent starts before and after the first await, cancel/disconnect while pending, late or stale completion after replacement, terminal retry, mounted refresh, remount, process restart, durable work whose identifier never reached the client, entity changes, pending-write navigation, failed/conflicted save recovery, return context, browser history, session expiry/sign-out, authoritative refresh, and slow or hung requests. Require tests, controlled runtime evidence, restart fixtures, source inspection that directly establishes the property, or an explicit gap.
10. **Security and data safety**: use relevant available security guidance and inspect the risk surfaces identified by the diff and project policy. For capability-style identifiers, prove issuer, scope, lifetime, and rejection of guessed, pasted, stale, cross-run, or cross-owner use. For bounded or provider-visible content, prove all content-bearing paths consume the same budget and provenance accounting. For filesystem writes, prove every existing ancestor and confinement boundary is validated before descendants are created, mutable roots are revalidated when necessary, and fail-closed rejection leaves no unauthorized writes.
11. **Rendered UI verification**: for every UI-bearing change, independently render current source, open the affected surfaces, exercise changed interactions, directly inspect screenshots or rendered results, and inspect relevant console and network failures. Cover the proportional Visual Verification Matrix, including representative desktop/mobile viewports and applicable default, loading, empty, error, populated, long-content, focus, selected, disabled, permission, and recovery states. Prefer project-owned browser, screenshot, or preview tooling, then an available runtime browser capability, rendered preview or fixture, or manual browser capture. A green build, passing non-visual tests, apply-side screenshots alone, or generated-but-uninspected images cannot pass this gate. If no available path can render a required surface, mark the gate `blocked` unless the user explicitly accepts the gap.
12. **Manual acceptance**: user-facing changes have the workflow-defined walkthrough and status when applicable. A complete current walkthrough with status `pending user` does not make the review `changes-requested`, though project policy may keep integration or closeout pending until confirmation. Owner manual acceptance is distinct from the reviewer's rendered UI verification and does not substitute for it.
13. **Supporting truth**: required project docs, release communication, generated indexes, ADRs, and product direction do not contradict the implementation or Epic map. The resolved Idea's current entry-point docs must identify the selected repository and repository lifecycle correctly, agree with `.sdd/config.yaml`, and avoid describing implemented replacement work as future or an archived repository as active. Clearly dated exploration, decisions, and historical sections may preserve their original point-in-time language when they are recognizable as history rather than current routing guidance.
14. **Integration readiness**: source, target, reviewed commit, prospective integration tree, dirty state, conflict state, required checks, authorization, and the project-defined PR/merge/closeout path are unambiguous; required integration-candidate proof passes for the exact tree that will be integrated.

For UI-bearing changes with a recorded component strategy, verify that required component-state evidence exists through configured previews or equivalent rendered-route, fixture, browser, or manual evidence; adopted source follows the project's ownership model; application-specific behavior did not leak into a generic reference; deliberate divergences preserve accepted product behavior; and anything described as shared or standardized has implemented consumer use outside the catalog itself at the level required by project guidance. A candidate that remains explicitly experimental is not a finding merely because it has not yet been promoted. Use apply-side visual evidence to target the independent review, but reproduce and directly inspect representative current rendering rather than accepting that evidence on trust.

Before finalizing the discovery wave, explicitly challenge cross-cutting failure classes that commonly escape happy-path tests when they are relevant to the diff: sibling-pattern drift; typed-result collapse across layers; concurrent start/cancel/replacement/retry; mounted refresh, remount, restart, and durable records unknown to the client; capability issuer/scope/lifetime; content-budget or provenance bypass; filesystem mutation before ancestor validation; entity identity changes; pending-write navigation; session expiry and sign-out; retry/timeout behavior; upgrade paths and migration immutability; existing-data compatibility; async focus or draft preservation; responsive interaction targets and accessibility; dependency or CI action validity; generated-contract drift; and fresh-install versus existing-install behavior. Keep this framework-neutral and mark irrelevant classes `not applicable`; do not manufacture work where the diff creates no such risk.

Select the smallest materially relevant set of available skills for these gates, read them completely, pass them into delegated review work, and validate their consequences. Absence of an optional skill is not a blocker; unresolved risk is.

Use verdict `ready` when the independent review is clean: no `BLOCKING` or `REQUIRED` finding remains, required non-manual gates—including applicable aggregate and integration-candidate gates—pass for the recorded exact candidate, and any required manual walkthrough is complete and current. Manual confirmation may still be `pending user`; record that separately as an acceptance and closeout gate rather than converting a clean technical review into `changes-requested` or `blocked`. A `ready` review with pending required confirmation is not yet ready to merge or close.

Do not classify required live-provider, production-path, deterministic E2E, integration, or other non-manual verification as manual acceptance merely because a person must trigger or observe it. Pending required non-manual evidence blocks `ready` unless project policy explicitly marks it optional or the user explicitly accepts it as a gap. State whether each pending live-provider check is required verification, optional confidence evidence, or manual acceptance, and make the verdict agree.

Use `changes-requested` when code, artifacts, verification, documentation, or the manual walkthrough itself needs correction. Narrow modes may report narrower outcomes but must not imply full integration readiness.

## Review Findings

Classify findings as:

- `BLOCKING`: must be resolved before integration.
- `REQUIRED`: should be resolved unless the user explicitly accepts the risk.
- `SUGGESTION`: non-blocking improvement.

When unresolved `BLOCKING` or `REQUIRED` findings remain after consolidated safe remediation and regression rereview, create or update the review artifact at the project-resolved change location using `assets/review-template.md`. Do not duplicate the template in this skill.

If the review is clean, a separate review artifact is optional unless project policy requires one. Record the verdict, date, review scope, source and target, exact reviewed source commit, and manual confirmation status in the task ledger so later PR stewardship can detect review staleness.

## Remediation

Default mode performs one consolidated safe-remediation batch after the complete discovery wave. Only include findings that are:

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

If the safe-fix diff cannot be isolated from unrelated dirty files, affected verification fails, or the local commit fails, stop remediation and integration. If the full discovery wave is not yet complete, continue every remaining safe read-only gate before reporting the consolidated blocker and findings.

If findings require implementation work beyond safe review remediation, leave them in `review.md` and recommend returning to `/sdd-apply`.

If a finding is specifically unresolved experience direction within already accepted behavior, run `sdd change transition <space-id> <change-id> --from in_review --to in_progress` with explicit repository selection when needed, then route it through `/sdd-design --revise` before more UI implementation. If resolving the design would change Requirements, Scenarios, scope, ownership, contracts, data, auth, or technical constraints, return it to `proposed` and use `/sdd-change --replan` instead.

Set `tasks.md` status from the verdict using guarded `sdd change transition` calls: use `in_review -> in_progress` when implementation or ordinary remediation remains, `in_review -> proposed` when product/Requirement/Scenario/scope/ownership decisions must be revised through `/sdd-change --replan`, and retain `in_review` while review is incomplete, awaits manual confirmation, or has passed the full review and closeout gates. The review verdict, manual confirmation status, and closeout record distinguish technical readiness from full closeout readiness; do not invent an additional Change lifecycle status.

## PR, Merge, And Closeout

When verdict is `ready` but required manual confirmation is `pending user`, do not offer or perform PR, merge, or closeout actions that require that confirmation. Present the concise manual walkthrough, record the review as technically ready and acceptance as `pending user`, and state that resuming closeout after confirmation must recheck review staleness.

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
3. After the merge/integration step succeeds, confirm the actual integrated tree matches the reviewed integration candidate. If it differs, rerun every required integration-candidate gate before closeout. Update the closeout record with the tested and actual tree/commit, aggregate result, PR/merge status, target branch, date, review outcome, manual confirmation status, release-communication status, and remaining accepted risks.
4. Run `sdd change close <space-id> <change-id> --repo <resolved-repository-path> --workspace <workspace-root>`, then commit the closeout mutation in the repo and branch required by app policy.
5. Verify the target branch has the closed change path, no active duplicate path, and no contradictory references to the old active path.

When closing:

1. Ensure `tasks.md` has `status: in_review` and its closeout reflects a passing review outcome, review record, manual confirmation status, release-communication status, PR/merge state, remaining accepted risks, and that no contradictory checklist or Resume Here state remains.
2. Run `sdd change close <space-id> <change-id> --repo <resolved-repository-path> --workspace <workspace-root>`. Use repeated `--repo` selections only for a coordinated close after every selected repository passes its own contextual gates.
3. Do not write `status: closed`; folder location is the closed state. Verify references to the active path are historical or updated.

## Stop Conditions

These conditions block remediation, integration, readiness, or a specific gate; they do not automatically end the review discovery wave. Unless the condition makes further inspection unsafe or impossible, record it, mark the affected gate `blocked` or `findings`, and complete every other independent gate before reporting. Never return immediately after encountering the first item in this list.

Stop and report when:

- change or branch selection is ambiguous.
- required artifacts are missing or contradictory.
- branch policy is missing with no documented fallback, violated for implementation changes, or unclear for a requested PR/merge/closeout.
- unrelated app/source-repo dirty files block safe review, fixes, PR, or merge.
- required checks fail without a safe in-scope fix.
- the Verification Scope Decision is absent or understates an applicable project-policy or cross-cutting trigger; a required aggregate or integration-candidate gate is missing, stale, cached without freshness proof, ran against a different commit/tree, skipped meaningful constituents, or failed.
- security review finds unresolved risk.
- Epic truth or Requirement/Scenario evidence is stale, incomplete, or unmapped.
- a deterministic implementation claim is important to readiness but is only asserted in artifacts, not supported by concrete source inspection, automated verification, manual/browser evidence, or an explicit accepted gap.
- a new or high-risk evidence claim lacks an inspected exact test title or stable anchor, important assertion or observation, or proof that the passing command discovers it; several Scenarios are aggregated without one named proof that exercises each one; or one implementation boundary is used to imply untested behavior at another boundary.
- a Story retains competing current and historical implementation/evidence maps, or an implementation anchor resolves only to an import, call site, incidental handler, broad token, or a file mapped for a different symbol.
- a new sibling implementation lacks an inspected pattern-conformance comparison, has an unexplained safety or recovery divergence, or its Pattern Parity Matrix contradicts the code and focused tests.
- an important typed result crosses service, plugin/capability, adapter, transport, or client boundaries without a complete mapping and exact proof, or a generic fallback erases status, retryability, permission, recovery, or other client-relevant meaning.
- an editable, autosaving, cached, routed, asynchronous, durable, or identity-sensitive surface lacks direct proof or an explicit gap for applicable interleavings such as concurrent start, cancellation/disconnect, late or stale completion, replacement, terminal retry, mounted refresh, remount, process restart, client-unknown durable records, entity changes, pending-write navigation, failed/conflicted saves, session expiry/sign-out, authoritative refresh, or slow/hung requests.
- a capability-style identifier can be used outside its issuer/scope/lifetime authority; a content-bearing path bypasses required budget or provenance accounting; or filesystem descendants can be written before existing ancestors and confinement are validated or remain after a fail-closed rejection.
- later implementation or Stories superseded earlier Epic truth without reconciling the earlier Story wording, evidence, or gaps.
- duplicate Story labels inside one Epic, duplicate full Story references, or duplicate legacy app-wide Story IDs exist without an explicit migration/blocking note and cannot be safely corrected mechanically during the review pass.
- new or modified Stories lack stable Epic-scoped labels or documented legacy Story IDs, local Requirement IDs, local Scenario IDs, or concrete non-generic Scenarios.
- user-facing app changes lack a useful manual UI confirmation walkthrough, the walkthrough is stale relative to the implementation, or the review does not explicitly state which manual UI tests the user should confirm next.
- a UI-bearing change lacks a proportional Visual Verification Matrix, the reviewer did not independently render and directly inspect the affected current UI, representative viewports or relevant states/interactions were skipped without justification, console/network failures were not checked, or the only visual evidence is source inspection or generated-but-uninspected screenshots.
- a required or claimed `Experience Design` is unconfirmed, identifies its selected direction only through an unstable reference such as “latest,” contradicts accepted Requirements, or is materially absent from the implemented responsive/state/accessibility behavior without an explicit accepted deviation.
- a required component strategy is absent or materially contradicted by implementation, required component-state evidence is missing, adopted ownership conflicts with project guidance, or a component is claimed as shared or standardized without implemented consumer use at the level required by project guidance.
- manual confirmation status, review record, release-communication state, PR/merge state, or closeout state is contradictory.
- closed or closing change artifacts still contain stale implementation-pending or verification-pending language that contradicts accepted Epic truth.
- affected existing or locally required project docs under `docs/` contradict implementation, Epic truth, branch/release policy, testing commands, architecture, data/API contracts, deployment behavior, operations, or visual style.
- the resolved Idea's current entry-point docs contradict `.sdd/config.yaml` or implementation reality about repository ownership, active/archived status, current architecture, implemented foundation, or where new work belongs; do not flag clearly marked historical records merely for preserving their point-in-time language.
- required release communication is missing, misleading, private when it should be public, or inconsistent with the project's configured format.
- PRD/product-direction drift is unresolved when the change depends on it.
- PR/merge targets the production branch; route to `/sdd-release` instead.
- PR/merge/closeout would require push, rebase, destructive action, production credentials, deployment, target-branch changes beyond an explicitly authorized `--merge-and-close` closeout commit, or human approval not already granted.
- findings need product, architecture, data, auth, or scope judgment from the user.

## Final Response

Final-report invariant: default, `--deep`, `--no-fix`, `--until-ready`, and a run that reaches `--max-iterations` all use the same complete report structure below. Never replace it with a short narrative such as “review is ready,” a list of resolved themes, test totals, or key commits. Iteration summaries and progress updates may be concise, but the last response must independently contain the complete review result. If the iteration cap is reached, issue the full report with the resulting `changes-requested` or `blocked` verdict and every residual finding.

For a full review, lead with the exact line `Verdict: ready`, `Verdict: changes-requested`, or `Verdict: blocked`. Narrow modes use their documented narrower verdict vocabulary but retain the applicable report fields.

Include:

- complete gate scorecard covering every applicable Review Gate with `pass`, `findings`, `blocked`, or `not applicable`; no gate may be silently omitted because another gate already failed
- selected change path, source branch, exact reviewed source commit, and target branch
- the final post-remediation reviewed source commit as the review watermark; list remediation, review-record, ledger, and planning-document commits separately rather than substituting a “key commits” summary for the watermark
- blocking and required findings, ordered by severity
- consolidated remediation performed across all cycles, plus residual suggestions and accepted gaps
- whether `review.md` was created or updated
- Requirement/Scenario coverage result
- Story reference traceability result
- Epic truth result
- test and verification commands/results, with every pending live-provider or production-path check classified as required verification, optional confidence evidence, or manual acceptance and reflected in the verdict
- rendered UI verification result, including surfaces, viewports, states/interactions, directly inspected evidence, console/network outcome, and any blocked or accepted rows; say `not applicable` with a reason when the change is not UI-bearing
- manual UI confirmation walkthrough status, plus a concise `Suggested manual UI testing` list with route/setup/actions/expected result for anything the user should confirm; say `none` when no manual UI confirmation is useful
- Change status, closeout readiness, and any contradictory state
- formal security review result
- docs result
- Idea-side repository and current-state truth result
- release-communication result
- PRD alignment result when checked
- branch and merge readiness result
- PR, merge, or closeout action taken, offered for confirmation, or blocked
- remaining risks and next action
