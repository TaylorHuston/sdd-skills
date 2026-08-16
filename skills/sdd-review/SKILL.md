---
name: sdd-review
description: Independently review an exact SDD candidate, audit a completed slice seal, or complete the final Change-wide integration gate. Slice Review persists candidate-bound reasoning without mutating repository code or lifecycle; final mode completes every applicable gate across all targeted repositories. Use for candidate review, seal audit, explicit deep re-review, integration readiness, or closeout assessment; use /sdd-release for production handoff.
---

# SDD Review

Review an exact SDD candidate independently from its implementer. The same public capability supports a slice checkpoint composed by `/sdd-apply` and a directly invoked final Change-wide local-PR gate. Composition never makes Review private or removes direct invocation.

## Authority And Project Profile

Resolve the workspace installation, Space, one central Change, and every target repository with `sdd context <relevant-path> --json`; use `sdd status <space-id> --json` when Change selection is needed. Retain the resolved workspace root and pass `--workspace <workspace-root>` to subsequent SDD commands whenever the target repository is external to the workspace or the command's current directory is not inside that workspace. Read the `workflowPath` returned by `sdd context` completely before judging artifact authority, traceability, evidence, reconciliation, or closeout. The one canonical active Change lives at `<workspace>/.sdd/changes/<change-id>/`, closed history lives at `<workspace>/.sdd/changes/closed/<change-id>/`, and `change.md` names the Space plus stable target repository IDs. If workspace setup is missing, direct the user to `sdd setup [workspace-path]`.

Default behavior is deep review. A clean `/sdd-review` means every targeted repository and the central evidence are technically ready for their selected targets, not merely that one repository or the Change folder looks plausible. Required manual acceptance and explicit integration authorization remain separate readiness gates. The primary review surface is every repository's source-vs-target diff plus the one central artifact set that claims to explain them. When default review returns `ready` for non-production targets and closeout readiness passes everywhere, treat merge-and-close as the obvious recommended next action and ask the user to confirm it. Use cheaper or narrower modes only when the user asks for them explicitly.

Multi-repository invariant: derive the complete target set from `change.md` frontmatter, inspect every listed repository, and record repository-specific refs, gates, findings, verification, review freshness, PR/merge state, and closeout state in the one central review and ledger. A passing repository never makes the Change ready by itself. Transition or close the central Change only once, and only after every target repository has met the applicable Change-wide gate.

Full-review invariant: complete the entire applicable discovery surface before issuing a verdict or beginning ordinary remediation. A `BLOCKING` or `REQUIRED` finding in one gate is evidence for the final verdict, not permission to skip later gates. Continue all independent read-only inspection, verification, and delegated passes even when integration is already known to be blocked. Halt the whole discovery wave early only when further inspection itself is unsafe or impossible, such as unresolved change/branch selection, inaccessible required inputs, an active destructive or production hazard, or required authorization for the next inspection step. When mutation, credentials, or user judgment block one gate, mark that gate `blocked` and finish every other independent gate that remains safe.

Execution-continuity invariant: a running, yielded, or just-completed command is pending review work, not a handoff boundary. Resume or poll long-running command sessions until they complete, provide a concise progress update at least every 60 seconds while work continues, and then immediately continue the next unfinished gate. If the user asks for status while the review is active, answer the status question and continue unless the user cancels or replaces the review. A missed progress update is a process failure to correct, never an explanation for returning control early. Do not send the final response until the complete gate scorecard and consolidated verdict are ready or a genuine Stop Condition makes further safe inspection impossible.

Use `/sdd-release` instead when the task is a production-target release handoff, full release checks, release-artifact finalization, or the project-defined release handoff.

Use `assets/slice-review-template.md` for durable `slice-reviews/<slice-id>.md`. Use `assets/review-template.md` only for final Change-wide `review.md`.

Use `/sdd-review` to prepare routine changes for the project-defined integration target. Whether that requires a PR or direct local integration belongs to project policy; production-target release handoff belongs to `/sdd-release`.

Do not treat this as more implementation planning. In default mode, run the complete PR-style review before beginning remediation. Launch materially relevant fresh-context review passes together, collect all results, validate and deduplicate their findings, and publish one consolidated finding set. Then fix the complete safe subset as one batch, rerun affected verification, and perform one regression-focused rereview of the updated diff. Do not stop between those stages merely to report ordinary findings. Stop only for a defined stop condition, user judgment, or an unsafe remediation boundary. If deficiencies remain outside safe review remediation, write or update `review.md` so one later `/sdd-apply` can address the consolidated batch.

Delegation authorization: invoking `/sdd-review`, naming `sdd-review`, asking to review an SDD change, or asking to close/finish/merge an SDD change is explicit permission to use bounded SDD review subagents under this skill's delegation model. If the local tool policy requires an explicit user request before spawning subagents, this skill invocation satisfies that requirement for non-trivial artifact, code, verification, security, UI, docs, or branch-readiness review passes that remain inside the selected central Change and its targeted repositories. Do not ask for separate subagent permission unless the user passed `--no-delegate`, the requested delegation would exceed that scope, the tool requires a more specific approval than normal spawning, or a stop condition applies.

Always validate closeout readiness as part of review. If the user asks to finish, close, merge-and-close, or otherwise complete the Change, perform the one central closeout mutation only after every targeted repository passes review and its branch/PR/merge/acceptance state is clear, and after the central artifacts agree with repository reality.

## Inputs And Modes

Start from an explicit central Change path, workspace-unique Change ID, source/target branches, or a standalone repository diff envelope. A Change is optional for direct candidate review; never fabricate Change, slice, or Apply history for manual work.

Supported modes:

- `--candidate-review <repository-path> --baseline <commit-ish> [--candidate working-tree|<commit-ish>]`: directly review an exact manual or otherwise Change-less candidate through the shared diff contract. Return the overall verdict, separate Implementation Quality and Spec Adherence axes where accepted Requirements/Scenarios are supplied, finding IDs, `cannot-verify`, and the reviewed watermark. Without accepted behavior inputs, mark Spec Adherence `cannot-verify` rather than inventing a Change. Remain read-only and perform no lifecycle or closeout work.
- `--slice-checkpoint --slice S# --baseline <commit-ish> [--candidate working-tree|<commit-ish>] [--phase implementation|post-epic]`: independently review one selected slice against the exact shared diff envelope. Scope Spec Adherence to that slice's Requirements, Scenarios, constraints, and interfaces, while inspecting the complete candidate and relevant regression surface for Implementation Quality, security, data safety, rendered UI, and repository-policy defects. In `implementation` phase, report stale or missing Epic mappings as `epic-update-required` rather than `changes-requested` when implementation and durable evidence support the accepted slice. In `post-epic` phase, independently require semantic and evidence closure for every affected Story and Scenario. Write or replace the candidate-bound result at `slice-reviews/<slice-id>.md` using the slice Review template; this is the only central artifact mutation authorized by slice-checkpoint mode. Do not mutate repository code, remediate, commit, transition lifecycle state, assess whole-Change closeout, create a PR, merge, release, deploy, or close. Return `ready`, `changes-requested`, or `blocked`, finding IDs, the exact 14-gate manifest, reviewed watermark/tree, complete Scenario and visual rows, gaps, and whether Epic Update is required.
- Default: run one complete deep PR-style discovery wave across every targeted repository and its selected target branch, finish every applicable gate even after findings are known, consolidate and validate the full finding set in the central Change, fix the complete safe in-scope subset as one batch, rerun affected checks, perform one regression-focused rereview, commit only verified repository-local safe-fix batches, and report one consolidated verdict with repository-specific results. Long-running commands are continuation points, not stopping points.
- `--deep`: explicit alias for default behavior.
- `--fast`: run a lightweight review on the main thread only. Still check source-vs-target diff, required SDD artifacts, branch policy, dirty state, security, and verification evidence, but skip delegated review passes and broad optional checks unless a risk is obvious.
- `--artifact-only`: review SDD artifacts, Epic truth, Change status, manual confirmation status, release-communication status, and any explicit unresolved product-decision dependency. A PRD may supply directional context but is not a continuous alignment gate. Do not review application code beyond what is necessary to confirm artifact claims. Do not return `ready` for integration from this mode; use `artifact-ready`, `changes-requested`, or `blocked`.
- `--diff-only`: review the source-vs-target code/config/test/docs diff, branch readiness, security, and verification evidence. Do not reconcile full Epic or PRD truth beyond obvious contradictions. Do not return full SDD closeout readiness from this mode.
- `--no-delegate`: use the main thread only. Use when subagent tooling is unavailable, the change is tiny, or delegation would add more noise than useful independent review.
- `--check`: review only and do not edit any files, including `review.md`.
- `--no-fix`: review only, write or update `review.md` when deficiencies exist, and report the verdict.
- `--seal-audit --slice S#`: default completed-slice check. Validate durable Review/receipt identity and digest, exact Scenario/visual sets and gaps, commit reachability, and tree equality without launching new adversarial discovery or retroactively imposing later ceremony.
- `--deep-re-review --slice S#`: explicitly run renewed adversarial discovery against a completed slice. Admit required findings only under the criteria below; suggestions and later ceremony alone never reopen the slice.
- `--pr`: when all gates pass, create a non-production pull request following the app's branch policy. If the target is the production branch, use `/sdd-release` instead.
- `--merge`: when all gates pass, merge to the non-production integration branch following the app's branch policy. If the target is the production branch, use `/sdd-release` instead.
- `--merge-and-close`: when all gates pass, complete the policy-defined non-production merge path and close the change. Treat this as explicit authorization for both the non-production merge/integration action and the closeout mutation, but not for push, rebase, branch deletion, deployment, production action, or remote PR merge unless the request or app policy explicitly covers that action.
`--slice-checkpoint` authorizes only its canonical central `slice-reviews/<slice-id>.md` write; it never authorizes repository mutation, remediation, commits, lifecycle transitions, PRs, merges, release, deployment, or closeout. In final modes, PR creation, merge, merge-and-close, push, rebase, branch deletion, deployment, destructive data changes, credentials, production actions, and `sdd change close` require explicit user authorization through the request or active workflow context. A request to create a PR or merge into a production branch is a release request and should route to `/sdd-release` unless the user explicitly states otherwise. A local commit containing only safe review fixes in a target repository is part of default review remediation and does not require separate authorization. The workspace-local central Change record is never staged, committed, or pushed with a target repository. If branch or merge policy is unclear in any target repository, stop before PR, merge, or closeout.

## Select The Change And Repository Branches

Use explicit inputs first. For `--candidate-review`, resolve the repository and exact envelope directly and skip central Change selection. Otherwise:

1. Infer the central active Change from conversation context.
2. Run `sdd status <space-id> --json` and select from the top-level `activeChanges`, which contains each central active Change once. Treat per-repository `activeChanges` as filtered projections of those records and `recentChanges` as central closed history, never as additional owners.
3. Treat idea-owned planned folders and repository-local active or closed Change folders as unsupported historical data. Do not review or close them in place; recreate worthwhile intent through `/sdd-change`.
4. Auto-select only when exactly one central active Change exists.
5. Ask the user when selection is ambiguous.
6. Read the selected `change.md`, verify its `space` and stable `repositories` frontmatter, and resolve every listed repository ID to its configured root. Stop on an unknown, duplicate, or contradictory target rather than silently narrowing the Change.

Resolve source and target branches separately for every targeted repository from explicit input, then that repository's `AGENTS.md` branch and merge policy. Use a current branch as source only when that matches the local policy. Do not assume `main`, `develop`, branch prefixes, merge strategy, closeout branch, or merge direction from another repository.

If a requested PR or merge target is a production branch, stop that repository's integration action and route it to `/sdd-release` unless project-local policy defines a different non-release production-branch workflow and the user explicitly confirms it.

Always announce the selected central Change path and ID, the full target repository set, each repository's source and target branches, and whether PR, merge, and Change-wide closeout actions are authorized.

## Build The Review Bundle

Before deciding any verdict, build one central review bundle plus one branch/diff bundle for every target repository. Prefer explicit refs from the user or each repository's policy; otherwise infer conservatively and stop if any required target is ambiguous.

Capture centrally:

- workspace root, managed `workflowPath`, Space ID, central Change ID and path, stored status, and stable target repository IDs
- central progressive change, task-ledger, compatible existing design, and review state
- repository-specific manual confirmation, release-communication, review, PR/merge, accepted-gap, and closeout state from the one ledger
- available PR descriptions, linked issues, review discussion, and cross-repository coordination context; record material context that is unavailable rather than silently assuming it does not exist

Capture for every targeted repository:

- repository ID and root
- source branch or ref and exact source commit SHA covered by review
- target branch or ref and merge base
- source-only commits
- target-only commits, when useful for behind-state risk
- changed file list from `target...source`
- source-vs-target diff stat and diff
- working-tree and relevant untracked-file state
- conflict check result without performing a merge
- branch policy and whether the source/target pair satisfies it
- project-configured linters, typecheckers, static/security/dependency analyzers, generated-contract checks, and CI commands relevant to the changed surface
- project-defined aggregate gate or authoritative constituent commands, their source of truth, and any documented optional checks
- Verification Scope Decision, including risk or policy triggers, exact candidate ref, freshness/cache treatment, and recorded result
- prospective integration tree and whether it materially differs from the reviewed source candidate
- JSON reverse-traceability inventory since the selected target or merge base, produced by the packaged `sdd-orphan-audit` script with `--changed-from`; run one `--epic` pass per affected Epic when ownership needs to be distinguished

Run commands like these in each targeted repository when it supports them, adjusting refs to its policy:

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

Prefer `git merge-tree --write-tree TARGET SOURCE` for each conflict check. Treat exit code `0` plus a printed tree object as clean, and a non-zero exit as a conflict or mergeability failure that needs inspection. Avoid piping human-readable merge output through broad `rg "CONFLICT|<<<<<<<|changed in both"` checks as the primary signal; those searches can self-match review artifacts or command text and create false positives.

Treat each repository's `TARGET...SOURCE` as its primary PR-style review diff. Use working-tree diffs only to understand uncommitted repository fixes, generated files, or blockers. Do not allow unrelated dirty files outside a target repository to obscure its source-vs-target review.

Record every slice-checkpoint result in `slice-reviews/<slice-id>.md`, whether ready or not. Record final Change-wide review state in `review.md`; `tasks.md` remains a compact current-state queue and ledger. Record immutable reviewed source commits per repository; branch names alone are not sufficient watermarks. Never place the workspace-local central Change files in a repository diff.

## Resolve Verification Scope

Keep focused behavior proof, aggregate candidate proof, and integration-candidate proof distinct. Focused tests establish individual Requirements and Scenarios; broad gates support them but do not replace their exact evidence. Before issuing a verdict, derive the complete affected Scenario set from the slice or accepted behavior inputs and build a Scenario Evidence Closure table with columns `Scenario`, `Claimed boundary`, `Cited proof`, `Proven boundary`, `Evidence type`, `Durability / reproduction reference`, `Result`, and `Gap classification`. Exact Scenario-set equality is required: missing, duplicate, aggregated-without-full-exercise, extra, or non-durable rows are findings. Use machine-stable results `pass`, `accepted-gap`, `findings`, or `blocked` and gap values `none`, `required`, `optional-confidence:<durable-policy-reference>`, `manual-acceptance`, or `user-accepted:YYYY-MM-DD`. A technical waiver is always `accepted-gap` plus the dated `user-accepted` value; never relabel it as manual acceptance or `none`.

Technical proof must remain independently inspectable or reproducible after the current session. A repository-owned deterministic test or stable project-defined artifact is preferred. An interactive, rendered, live-provider, or multi-context observation may count only when its durable descriptor records the exact candidate, date, environment or fixture, actors/contexts, route or entry point, actions, assertions or observations, console/network outcome when applicable, and a stable artifact path or content hash plus enough setup to reproduce it without retained credentials. A `/tmp` path, ephemeral browser profile, chat transcript, reviewer summary, screenshot hash without a retained artifact or reproducible procedure, or bare “local observation” phrase is supporting context only and cannot close a required technical boundary.

Resolve the project-defined aggregate command from project guidance, testing/CI docs, workflow files, and package scripts. Require aggregate proof when project policy requires it or when the reviewed diff crosses multiple capabilities, persistence or migrations, auth/security/privacy boundaries, process-global state, shared contracts, concurrency/workers/recovery, or another surface where isolated checks can conceal integration failures. Do not impose one universal command name or constituent list. Prefer one project-owned command; otherwise record and run the authoritative equivalent constituents. If materially required proof cannot be identified or run safely, block `ready` unless the user explicitly accepts the gap.

Run every required aggregate gate freshly against the exact committed source candidate after the final review remediation. Bypass caches or prove meaningful fresh execution, and record the command, commit, constituent/test counts or equivalent execution evidence, and result. A later evidence-record-only commit may reuse that result only after its diff is classified and every gate that observes the changed artifacts is rerun; any behavior, test, dependency, configuration, migration, generated, executable, or gate-observed change invalidates the prior result. An earlier behavior candidate, a green command that skipped meaningful work, remote CI for another ref, focused suites, or structural SDD validation cannot satisfy this gate.

Require integration-candidate proof separately in each repository whose target has advanced, contains accumulated Changes, requires conflict resolution, or produces a materially different prospective tree. Materialize each result through a safe disposable worktree or equivalent non-destructive project mechanism, record its tree/ref, and run that repository's required aggregate gate there. Recheck all source and target refs immediately before integration. Reuse source-candidate proof only when the prospective integration content is demonstrably identical; otherwise a changed tree requires fresh proof. After integration, confirm every actual integrated tree matches its tested tree or rerun the applicable gate before global closeout.

## Required Context

Before reviewing, read:

- `<workspace>/.sdd/changes/<change-id>/change.md`
- `<workspace>/.sdd/changes/<change-id>/tasks.md`
- an existing `<workspace>/.sdd/changes/<change-id>/design.md` when this compatible Change already has one
- existing `<workspace>/.sdd/changes/<change-id>/review.md`, if present

Validate that active `change.md` frontmatter uses `proposed`, `planned`, `in_progress`, or `in_review`, names the selected Space, and lists every target repository by stable portable ID. In final mutating modes, run `sdd change transition <space-id> <change-id> --from in_progress --to in_review` once when implementation is complete in every targeted repository and independent review begins; retain `in_review` when review is already underway. Never transition lifecycle state in `--slice-checkpoint` mode. Do not transition targets independently or pass repository flags. If a Change ID collides in the selected workspace's active and closed stores, stop rather than selecting either record.
- Run `sdd validate <space-id> --change <change-id> --workspace <workspace-root> --json` before the broad review wave and again after central artifact remediation. Use `--repo <repository-id>` to project the same central record into each target repository when contextual validation is needed; this validation filter does not create a repository-owned Change. Treat deterministic errors as review findings and inspect warnings, but continue the independent diff, implementation-truth, evidence-strength, security, docs, and acceptance review even when validation passes.
- project-defined release communication in each affected repository when the proposal or task ledger says it is affected, or implementation changes public release meaning
- relevant target Epic files under each repository's canonical Epic path
- enough of every active Epic in each target repository to detect duplicate Story labels inside an Epic, duplicate full Story references, or conflicting legacy app-wide Story IDs
- vault, workspace, and every target repository's `AGENTS.md`, especially repository-specific branch policy
- the resolved Idea planning path's current operational entry-point docs, such as its Folder Note or current-status note, when they route agents to repositories or claim active/archived lifecycle; reconcile those routing facts against `.sdd/config.yaml` and the target set, but do not require conceptual feature summaries or historical planning prose to track every slice
- the PRD/Product Brief and other product-direction docs only when the current Change explicitly depends on an unresolved product decision, the user requests a PRD assessment, or project guidance grants that document stronger authority; otherwise a PRD is optional directional context, not a Review gate
- project visual/style guidance, design-system notes, or app visual identity docs in each affected repository when the Change affects app UI, layout, styling, component density, interaction polish, or visual identity
- the central Change's `Experience Design` section and stable prototype/design references when present or required by `tasks.md`
- application component previews and any project-configured shared reference catalog when `Experience Design` records adopted references, reference candidates, deliberate divergences, or standardization claims
- each repository's project-defined truth-bearing supporting-doc set; when none is declared, inspect its README, changed docs, and documents whose current claims intersect its diff, including architecture, testing, security, deployment, style, data/API contracts, operations, and current-state docs
- every source-vs-target diff and changed file list
- code, tests, generated files, docs, and configuration touched by the Change in every target repository

Check git status in every target repository that may change. Preserve unrelated dirty files. The central Change record is workspace-local state outside those repositories: update it as the single ledger, but never stage, commit, or push it with repository work.

For review readiness, uncommitted files outside a targeted source repository do not block that repository's review, PR, or merge readiness unless they are explicitly part of the requested branch operation. Report adjacent-repository dirty state clearly without treating it as a second Change owner. Target-repository dirty state still blocks readiness when it is part of the Change and is not committed or explicitly deferred.

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
- documentation, release communication, Idea-side operational routing truth, and explicit unresolved product-decision dependencies
- branch, conflict, and integration readiness

Use the main thread only when:

- `--no-delegate`, `--fast`, `--artifact-only`, or `--diff-only` narrows the task
- the change is tiny enough that subagents would add process noise
- the review surface is too ambiguous to delegate safely
- subagent tooling is unavailable
- the user needs to answer a question before a reviewer can be scoped

Parallelize read-only delegated review passes when their scopes do not overlap. Do not delegate Change-wide status decisions, commits, PR creation, merges, central closeout, branch operations, or final verdicts.

Treat all materially relevant delegated passes plus the orchestrator's own inspection as one review discovery wave. Do not begin ordinary remediation while required passes are still outstanding. Once the wave completes or reaches the bounded fallback threshold:

1. Validate findings against the actual source-vs-target diff and artifacts.
2. Deduplicate findings that describe the same root cause.
3. Resolve contradictions between reviewers before editing.
4. Classify the complete set by severity and remediation boundary.
5. Create one ordered remediation batch grouped by root cause and affected verification.

A confirmed critical security issue, destructive-data risk, or active production hazard may stop mutations, runtime checks, or integration immediately. Continue the remaining safe read-only review gates unless the hazard or unresolved ambiguity makes further inspection itself unsafe. Ordinary code, test, security, accessibility, documentation, CI, integration-readiness, or artifact findings must be accumulated instead of surfaced as serial interruptions.

Keep delegated review waits bounded. Continue independent review work after spawning, and wait only when the next required decision depends on delegated evidence. Never wait silently for more than 60 seconds; report which gates are complete and which review pass remains. After roughly three minutes of cumulative waiting on one pass or review wave, interrupt or close the slow reviewer and complete that gate locally, or re-delegate a narrower question. An optional reviewer must never prevent a concise status response. Close completed or abandoned reviewers promptly.

Use `assets/subagent-pr-review-prompt.md` for delegated passes when structured prompts help. Keep every prompt conclusion-neutral: describe prior verdicts, finding dispositions, screenshots, runtime observations, and Epic claims as untrusted claims to falsify. Never say that all findings are resolved, evidence is closed, only manual acceptance remains, or `ready` is expected. Each delegated review prompt must include:

- central Change path and artifact paths
- complete target repository ID/root list and the repository assigned to this pass
- assigned repository's source branch/ref, target branch/ref, and merge base
- assigned repository's changed files and any narrowed file scope
- repository-keyed review state already recorded for other targets when relevant to cross-repository coordination
- assigned review pass
- relevant Story, Requirement, and Scenario IDs when known
- assigned repository's branch policy summary
- available PR/issue/review-history and related-repository context, or an explicit note that it is unavailable
- configured deterministic review tools relevant to the assigned pass
- selected available skills and guidance to load, with selection reasons
- explicit instruction not to edit, commit, push, merge, close, or update the central Change status
- required report shape

Treat subagent output as evidence, not final truth. Validate important claims by inspecting the referenced files, checking the source-vs-target diff, rerunning focused commands when practical, and rejecting vague findings without concrete impact. Reject a `ready` result whose Gate Execution Manifest omits an applicable gate, does not show that reverse traceability actually ran, leaves triggered visual-matrix states unaccounted, or relies on temporary-only evidence.

## Review Gates

Run every gate that applies and record `pass`, `findings`, `blocked`, or `not-applicable`. Build a Gate Execution Manifest with exactly one row for each canonical machine ID, in this order: `artifact-truth`, `canonical-map-authority`, `source-vs-target`, `pattern-conformance`, `boundary-contracts`, `reverse-traceability`, `verification`, `evidence-falsification`, `risk-shaped-evidence`, `security-data-safety`, `rendered-ui`, `manual-acceptance`, `supporting-truth`, and `integration-readiness`. Each row contains `Gate`, `Method / command`, `Candidate`, `Result`, and `Durable proof reference`. Keep gap classification in the Scenario Evidence Closure rows rather than duplicating it across gate rows. The manifest remains detailed Review output; Apply references and hashes the final durable slice Review from its minimal `sdd-slice-closure-v2` receipt instead of serializing the manifest again. Do not rename, omit, aggregate, or add gate rows. “Inspected” without the inspected surface, command, or proof reference is not an attestation. Do not short-circuit this list because an earlier gate already guarantees `changes-requested` or `blocked`; complete later independent gates so the user receives one comprehensive finding set. Before finalizing, confirm that every gate has an explicit manifest row and that no delegated or main-thread review pass remains uncollected. Apply the detailed semantics from the managed workflow document, the canonical templates, selected available review skills, and project guidance instead of restating them here.

1. **Artifact truth**: the one central progressive change, task ledger, compatible existing design, and review; repository-local Epic/Story truth; Requirements; Scenarios; independent implementation/verification state; behavior and evidence maps; implementation/verification gaps; target repository metadata; repository-specific ledger results; and Change-wide status agree with implementation reality in every target. In post-Epic slice review, explicitly apply the `EPIC-CLOSURE` comparison across each affected Story's index, body states, maps, and gaps; a deterministic validation pass alone cannot satisfy this gate.
2. **Canonical map authority and cold navigation**: confirm every Story has one current `Implemented By` map and one current `Verified By` map, with no competing `Prior`, `Detailed`, `Legacy`, or migration-era maps. For every changed Requirement, and for Scenarios with distinct owners, start from the Epic and identify the primary governing definition, registration, or configuration plus stable anchor without a repository-wide rediscovery search. Treat imports, call sites, incidental handlers, broad file tokens, files cited for a different symbol, undifferentiated dumps, mappings that stop at UI/tests, missing paths/anchors, and unclassified support files as findings.
3. **Source-vs-target code review**: review the actual diff and source-only commits for correctness, regressions, maintainability, accidental scope, project-pattern fit, and user-visible state handling.
4. **Pattern conformance**: when the diff adds or changes a surface parallel to an established adapter, client, route, workspace, worker, migration, command, or similar implementation, identify the closest current reference and compare applicable auth/session/CSRF, retry, timeout/cancel, error/conflict, recovery, pending-write, identity, route-context, configuration, generated-contract, accessibility, and visual-token behavior plus focused tests. Unexplained divergence or copied defects are findings.
5. **Boundary contracts**: when important typed results, errors, statuses, permissions, or retry decisions cross service, plugin/capability, adapter, transport, or client layers, trace each origin condition through the domain result, every mapping, client-visible behavior and retryability, and exact proof. Generic fallbacks or exception handlers that erase a required distinction are findings.
6. **Reverse traceability**: run the packaged diff-scoped orphan audit with `--changed-from` and one `--epic` pass per affected Epic when an Epic is available, then classify every behavior-bearing source/test candidate as Epic-owned, supporting/generated/framework infrastructure, an explicit gap, or tracked cleanup. Record the command, candidate, counts, and every unresolved source/test candidate in the Gate Execution Manifest. For refactors, check stranded routes, registrations, imports, dependencies, tests, migrations, generated bindings, and obsolete files. Searching filenames or reading only existing Epic anchors is not a substitute; skipping this inventory blocks `ready`.
7. **Verification**: scenario-mapped focused evidence exists for every affected Scenario, broad gates are not substituted for behavior proof, production/mock boundaries are honest, the Verification Scope Decision is explicit, and required aggregate candidate checks pass freshly on the exact reviewed commit or have explicit blocking gaps. Record every unresolved gap as `required`, `optional confidence`, `manual acceptance`, or `user accepted YYYY-MM-DD`; an unresolved required technical gap blocks `ready`.
8. **Evidence falsification**: for every affected Scenario—not only new, high-risk, recently repaired, or previously disputed claims—and every `Verified By`, E2E/security/recovery/production-path claim, open the cited proof and confirm its exact test title or stable named anchor, important assertion/observation, discovery by the command that passed, production call-site use when a helper or formatter is cited, and durable reproduction reference for interactive/runtime evidence. Reject generic framework anchors such as `#it(`, unsupported Scenario aggregation, missing/skipped/undiscovered evidence, a test-only helper used to imply production presentation, temporary-only screenshots or browser profiles, and server-side proof used to imply untested client retry, redirect, timeout, draft, navigation, recovery, rendered interaction, user confirmation/cancellation, or active multi-context/realtime behavior. Evidence must exercise the same boundary the Scenario claims and survive the current session; otherwise return `EVIDENCE-CLOSURE` and retain a verification gap.
9. **Risk-shaped evidence and stateful transitions**: challenge important deterministic claims against plausible failure modes. For editable, autosaving, cached, routed, asynchronous, durable, or identity-sensitive surfaces, inspect applicable concurrent starts before and after the first await, cancel/disconnect while pending, late or stale completion after replacement, terminal retry, mounted refresh, remount, process restart, durable work whose identifier never reached the client, entity changes, pending-write navigation, failed/conflicted save recovery, return context, browser history, session expiry/sign-out, authoritative refresh, and slow or hung requests. Require tests, controlled runtime evidence, restart fixtures, source inspection that directly establishes the property, or an explicit gap.
10. **Security and data safety**: use relevant available security guidance and inspect the risk surfaces identified by the diff and project policy. For capability-style identifiers, prove issuer, scope, lifetime, and rejection of guessed, pasted, stale, cross-run, or cross-owner use. For bounded or provider-visible content, prove all content-bearing paths consume the same budget and provenance accounting. For filesystem writes, prove every existing ancestor and confinement boundary is validated before descendants are created, mutable roots are revalidated when necessary, and fail-closed rejection leaves no unauthorized writes.
11. **Rendered UI verification**: for every UI-bearing change, independently render current source, open the affected surfaces, exercise changed interactions, directly inspect screenshots or rendered results, and inspect relevant console and network failures. Convert the proportional Visual Verification Matrix into an explicit accounting table with one row per triggered viewport/state/interaction, including representative desktop/mobile viewports and applicable default, loading, empty, error, populated, long-content (including the accepted maximum or adversarial unbroken content), focus, selected, disabled, permission, and recovery states. Each row names the candidate, setup, observation, and durable proof or reproduction reference. Prefer project-owned browser, screenshot, or preview tooling, then an available runtime browser capability, rendered preview or fixture, or manual browser capture. A green build, passing non-visual tests, apply-side screenshots alone, happy-path fixtures that omit a triggered state, temporary-only images, or generated-but-uninspected images cannot pass this gate. If no available path can render or durably describe a required surface, mark the gate `blocked` unless the user explicitly accepts the gap.
12. **Manual acceptance**: user-facing changes have the workflow-defined walkthrough and status when applicable. A complete current walkthrough with status `pending user` does not make the review `changes-requested`, though project policy may keep integration or closeout pending until confirmation. Owner manual acceptance is distinct from the reviewer's rendered UI verification and does not substitute for it.
13. **Supporting truth**: required project docs, existing release communication, generated indexes, ADRs, and any product decision explicitly accepted by the current Change do not contradict the implementation or Epic map. Review classifies whether the candidate appears user-visible, operator-relevant, or internal-only and flags an existing misleading claim, but the separately invoked `/sdd-changelog` capability owns creating or updating one candidate-specific release entry after Review and Epic Update. A missing not-yet-authored entry alone does not make otherwise clean implementation `changes-requested`. The resolved Idea's operational entry points must identify selected repositories and active/archived lifecycle correctly when they claim those facts. Concept summaries, PRDs, explorations, decisions, and historical sections may remain broader, aspirational, phased differently, or point-in-time; ordinary divergence is at most a `prd-revisit-suggested` advisory and never changes the verdict unless the Change explicitly depends on an unresolved product decision.
14. **Integration readiness**: each repository's source, target, reviewed commit, prospective integration tree, dirty state, conflict state, required checks, authorization, and policy-defined PR/merge path are unambiguous; required integration-candidate proof passes for every exact tree that will be integrated; the central ledger contains no missing target; and Change-wide closeout remains gated on the complete target set.

For UI-bearing changes with a recorded component strategy, verify that required component-state evidence exists through configured previews or equivalent rendered-route, fixture, browser, or manual evidence; adopted source follows the project's ownership model; application-specific behavior did not leak into a generic reference; deliberate divergences preserve accepted product behavior; and anything described as shared or standardized has implemented consumer use outside the catalog itself at the level required by project guidance. A candidate that remains explicitly experimental is not a finding merely because it has not yet been promoted. Use apply-side visual evidence to target the independent review, but reproduce and directly inspect representative current rendering rather than accepting that evidence on trust.

Before finalizing the discovery wave, explicitly challenge cross-cutting failure classes that commonly escape happy-path tests when they are relevant to the diff: sibling-pattern drift; typed-result collapse across layers; concurrent start/cancel/replacement/retry; mounted refresh, remount, restart, and durable records unknown to the client; capability issuer/scope/lifetime; content-budget or provenance bypass; filesystem mutation before ancestor validation; entity identity changes; pending-write navigation; session expiry and sign-out; retry/timeout behavior; upgrade paths and migration immutability; existing-data compatibility; async focus or draft preservation; responsive interaction targets and accessibility; dependency or CI action validity; generated-contract drift; and fresh-install versus existing-install behavior. Keep this framework-neutral and mark irrelevant classes `not applicable`; do not manufacture work where the diff creates no such risk.

Select the smallest materially relevant set of available skills for these gates, read them completely, pass them into delegated review work, and validate their consequences. Absence of an optional skill is not a blocker; unresolved risk is.

Use overall verdict `ready` when the independent technical review is clean: Implementation Quality and Spec Adherence are both `pass`; no `cannot-verify`, `blocked`, `BLOCKING`, or `REQUIRED` result remains; every affected Scenario has exactly one durable same-boundary closure row; the Gate Execution Manifest accounts for every applicable gate; diff-scoped reverse traceability actually ran and all behavior-bearing candidates are classified; every triggered visual-matrix row is accounted for; and every required non-manual gate—including applicable rendered UI, live multi-context/realtime, provider/production, aggregate, and integration-candidate gates—passes for the recorded exact candidate or has explicit dated user acceptance. Report manual acceptance separately; a current required walkthrough may remain `pending user`, which blocks acceptance-dependent integration or closeout but does not convert a clean technical Review into `changes-requested`. In implementation-phase slice-checkpoint Review only, an `epic-update-required` result may accompany `ready` because the next composed capability owns that expected reconciliation; it must be followed by Epic Update and a post-Epic slice-checkpoint Review whenever Epic files change. Manual confirmation may still be `pending user`; record that separately as an acceptance and closeout gate rather than converting a clean technical review into `changes-requested` or `blocked`. A `ready` review with pending required confirmation is not yet ready to merge or close.

Do not classify required rendered interaction, live multi-context/realtime, live-provider, production-path, deterministic E2E, integration, or other non-manual verification as manual acceptance merely because a person must trigger or observe it. Pending required non-manual evidence blocks `ready` unless project policy explicitly marks it optional or the user explicitly accepts it as a gap. State whether each pending live-provider check is required verification, optional confidence evidence, or manual acceptance, and make the verdict agree.

Use `changes-requested` when code, artifacts, verification, documentation, or the manual walkthrough itself needs correction. Narrow modes may report narrower outcomes but must not imply full integration readiness.

## Review Findings

Admit a `BLOCKING` or `REQUIRED` finding only when concrete current-candidate evidence establishes at least one of these grounds:

1. a reproducible violation of an accepted Requirement, Scenario, binding constraint, or visual obligation;
2. a material security, privacy, authorization, data-loss, corruption, irreversible-action, or broken-recovery risk;
3. a violation of applicable repository policy or a governing architecture decision;
4. a demonstrably false implementation, evidence, candidate, gap, or completion claim; or
5. failure of a required deterministic test, build, validation, conflict, or tree-equivalence gate.

Style preferences, speculative edges without a concrete path and material impact, confidence beyond the accepted contract, support-file classification with no navigation harm, and ceremony introduced after a valid legacy seal remain suggestions or future-Change candidates. They never reopen a completed slice by themselves.

Classify admitted findings as:

- `BLOCKING`: must be resolved before integration.
- `REQUIRED`: should be resolved unless the user explicitly accepts the risk.
- `SUGGESTION`: non-blocking improvement.

Also classify remediation ownership:

- `product-defect`: repository code, runtime behavior, or required technical proof violates accepted behavior and reopens implementation.
- `closure-repair`: implementation behavior remains sound, but Review, Epic, receipt, Tasks, supporting evidence descriptors, or gap linkage is incomplete or stale. An unchanged repository commit may be re-reviewed and resealed without a meaningless application commit.

For a slice checkpoint, always create or update `<change>/slice-reviews/<slice-id>.md` using `assets/slice-review-template.md`. For final Change-wide review, create or update `<change>/review.md` using `assets/review-template.md`. Never create repository-local review copies.

If the review is clean, a separate central review artifact is optional unless project policy requires one. Record the consolidated verdict, date, review scope, and manual confirmation status plus each repository's source, target, exact reviewed source commit, and gate result in the central task ledger so later PR stewardship can detect review staleness.

## Remediation

Default mode performs one consolidated safe-remediation batch after the complete discovery wave, followed by one fresh final Review. If that final Review finds a new pre-existing issue, return `needs-user` with the exact finding set rather than beginning another broad cycle. Permit one narrow correction and focused rerun only when the final finding is demonstrably a regression introduced by the remediation batch. Only include findings that are:

- clearly in scope for the SDD change
- small enough to verify in the same review pass
- not product decisions, architecture rewrites, data migrations, destructive actions, secrets, branch operations, or broad refactors

Safe automatic fixes include stale task-ledger checkboxes, mechanical release-communication placement, formatting/lint fixes with obvious local intent, and similarly narrow review-owned drift. Route generated Epic indexes, Epic evidence/date corrections, Story reference cleanup, implementation maps, gaps, and verification maps to a separately invoked `/sdd-epic-update` against the reviewed candidate.

After the finding set is consolidated:

1. Update the selected slice's `slice-reviews/<slice-id>.md`, or final Change-wide `review.md`, with the complete validated finding set and planned safe batch.
2. Apply all independent safe fixes in one remediation phase, ordered so shared root causes are corrected before dependent symptoms.
3. Rerun the union of affected focused verification and required broad gates once per affected repository after the batch, not once per finding unless an intermediate check is necessary to avoid compounding risk.
4. Perform one regression-focused rereview of every updated repository diff. Recheck code, security, data, central artifacts, repository-local truth, and any gate touched by remediation. If this is a slice checkpoint and the scoped rereview becomes `ready`, follow it with one fresh-context comprehensive slice closure review that re-enumerates every affected Scenario and every applicable gate before the verdict can be consumed; this final pass is deliberately not limited to prior finding IDs.
5. Reconcile the owning slice Review or final Change-wide Review with `tasks.md`; route each affected repository's Epic evidence to `/sdd-epic-update` after the implementation candidate is stable. Any non-`no-op` Epic Update changes the repository candidate and requires a post-Epic `/sdd-review` before the final readiness watermark may be recorded or consumed by PR, Changelog, Release, merge, or closeout.
6. Confirm every affected repository working tree contains only its intended safe-fix files plus unrelated pre-existing dirty files, and stage only the repository-local intended safe-fix files.
7. Create one local commit per affected repository for its verified safe review batch with a concise message, such as `Address sdd-review findings`. Do not stage the central Change record, unrelated dirty files, or files from another repository; do not amend earlier commits or push.
8. Report the final global verdict, repository-specific fixes and commit hashes, central ledger changes, residual findings, and unrelated dirty files that were preserved.

The final Review is a fresh comprehensive validation of the complete selected slice or Change, not an invitation to repeat broad discovery indefinitely. If it reveals a safe regression introduced by the remediation batch, correct that regression and rerun only affected checks. If it reveals a pre-existing issue that the discovery wave should have covered, record the process miss and return `needs-user`; do not drip-feed or begin another broad cycle in the same invocation.

If the safe-fix diff cannot be isolated from unrelated dirty files, affected verification fails, or the local commit fails, stop remediation and integration. If the full discovery wave is not yet complete, continue every remaining safe read-only gate before reporting the consolidated blocker and findings.

If findings require implementation work beyond safe review remediation, leave them in the owning slice Review or final Change-wide Review and recommend returning to `/sdd-apply`.

If a finding in any target is specifically unresolved experience direction within already accepted behavior, run `sdd change transition <space-id> <change-id> --from in_review --to in_progress` once for the central Change, then route the affected repository context through `/sdd-design --revise` before more UI implementation. If resolving the design would change Requirements, Scenarios, scope, ownership, contracts, data, auth, or technical constraints, transition the central Change once to `proposed` and use `/sdd-change` instead.

Set the one central `change.md` status from the combined verdict using guarded `sdd change transition` calls without repository flags: use `in_review -> in_progress` when implementation or ordinary remediation remains in any target, `in_review -> proposed` when product/Requirement/Scenario/scope/ownership decisions must be revised through `/sdd-change`, and retain `in_review` while review is incomplete, awaits manual confirmation, or has passed the full review and closeout gates. Record target-specific work and review state in the one ledger; never transition repositories independently. The review verdict, manual confirmation status, and closeout record distinguish technical readiness from full closeout readiness; do not invent an additional Change lifecycle status.

## PR, Merge, And Closeout

When the global verdict is `ready` but required manual confirmation is `pending user`, do not offer or perform PR, merge, or closeout actions that require that confirmation. Present the concise manual walkthrough, record the review as technically ready and acceptance as `pending user` in the central ledger, and state that resuming closeout after confirmation must recheck every repository's review watermark.

When all gates pass in every targeted repository:

- If any selected target is a production branch, do not create that PR or merge from `/sdd-review`; record that repository as locally ready, hand it to `/sdd-release`, and keep Change-wide closeout pending.
- If `--pr` is authorized, create each policy-required non-production PR in the authorized target repositories. Include a public-safe Change ID, summary, Requirements/Scenarios covered, verification evidence, security review result, and remaining non-blocking risks; never expose the workspace-local central path.
- If `--merge` is authorized, merge the authorized target repositories following each repository's policy. Recheck target branch, conflict state, dirty state, and required checks immediately before every merge.
- If `--merge-and-close` is authorized, complete every policy-defined non-production integration first, then close the central Change once. Recheck each repository's target branch, conflict state, dirty state, required checks, and closeout row immediately before its merge and recheck the complete ledger before close. If any repository policy requires a PR, push, rebase, remote PR merge, or another action not explicitly authorized, stop before that action and keep Change-wide closeout pending.
- If neither `--pr`, `--merge`, nor `--merge-and-close` is authorized and every ready target is non-production, ask the user whether to perform the policy-defined merge-and-close now. Spell out each repository's source branch, target branch, merge strategy or policy requirement, the single `sdd change close <space-id> <change-id>` transition, and any action that still requires separate authorization such as push, rebase, branch deletion, remote PR merge, or deployment.
- If neither `--pr`, `--merge`, nor `--merge-and-close` is authorized and any ready target is production, report the repository-specific readiness and hand off to `/sdd-release`.

Do not push unless explicitly authorized or required by an explicitly requested PR workflow. Do not close the central Change until every target repository's PR/merge/acceptance state is clear and passing and the user has explicitly asked to close, finish, merge-and-close, or otherwise complete the Change.

When merge-and-closing:

1. Follow each target repository's local `AGENTS.md` merge policy for target branch, merge strategy, PR requirements, and whether direct integration-branch commits are allowed.
2. Perform every required non-production merge/integration step before Change-wide closeout unless project policy explicitly says otherwise. One completed repository does not authorize early close.
3. After each integration succeeds, confirm its actual integrated tree matches the reviewed integration candidate. If it differs, rerun that repository's required integration-candidate gates. Update the one central closeout record with repository-keyed tested and actual trees/commits, aggregate results, PR/merge status, target branches, dates, review outcomes, manual confirmation, release communication, and accepted risks.
4. Only after every targeted repository row passes, run `sdd change close <space-id> <change-id>` once. Do not pass `--repo`, do not repeat the command per target, and do not stage, commit, or push the workspace-local central closeout mutation.
5. Verify the central record now exists only at `<workspace>/.sdd/changes/closed/<change-id>/`, no active central duplicate remains, and repository-local references are current or clearly historical.

When closing without an integration action:

1. Ensure central `change.md` has `status: in_review` and `tasks.md` closeout records a passing result for every targeted repository, the global review outcome, review record, manual confirmation, release-communication status, PR/merge state, remaining accepted risks, and no contradictory checklist or `Resume Here` state.
2. Run `sdd change close <space-id> <change-id>` once. Lifecycle close has no repository-scoped form; repository filters belong only to contextual validation.
3. Do not write `status: closed`; central folder location is the closed state. Verify references to the active central path are historical or updated.

## Stop Conditions

These conditions block remediation, integration, readiness, or a specific gate; they do not automatically end the review discovery wave. Unless the condition makes further inspection unsafe or impossible, record it, mark the affected gate `blocked` or `findings`, and complete every other independent gate before reporting. Never return immediately after encountering the first item in this list.

Stop and report when:

- central Change, target repository, or branch selection is ambiguous.
- required central artifacts, target metadata, or repository-specific ledger state are missing or contradictory.
- branch policy is missing with no documented fallback, violated for implementation changes, or unclear for a requested PR/merge/closeout in any target repository.
- unrelated dirty files in a targeted source repository block safe review, fixes, PR, or merge.
- required checks fail without a safe in-scope fix.
- the Verification Scope Decision is absent or understates an applicable project-policy or cross-cutting trigger; a required aggregate or integration-candidate gate is missing, stale, cached without freshness proof, ran against a different commit/tree, skipped meaningful constituents, or failed.
- security review finds unresolved risk.
- Epic truth or Requirement/Scenario evidence is stale, incomplete, or unmapped. In implementation-phase `--slice-checkpoint` only, stale affected Epic mappings that are fully explained by the selected implementation and durable evidence produce `ready` plus `epic-update-required`; contradictory accepted behavior, missing implementation proof, or unrelated Epic drift still blocks readiness, and post-Epic phase requires the mappings current.
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
- manual confirmation status, central review record, repository-specific release-communication state, PR/merge state, or closeout state is contradictory.
- central closed or closing Change artifacts still contain stale implementation-pending or verification-pending language that contradicts accepted Epic truth in any target.
- affected existing or locally required project docs under a target repository's `docs/` contradict implementation, Epic truth, branch/release policy, testing commands, architecture, data/API contracts, deployment behavior, operations, or visual style.
- the resolved Idea's operational entry-point docs contradict `.sdd/config.yaml` about repository ownership, active/archived status, or where new work belongs; do not flag conceptual feature summaries or clearly marked historical records merely for preserving broader or point-in-time language.
- existing release communication is misleading, leaks private context, or contradicts the reviewed candidate; a separately pending candidate-specific `/sdd-changelog` entry is a terminal handoff rather than an implementation-review defect.
- the current Change explicitly depends on an unresolved product decision that must be settled to assess its accepted behavior. Ordinary PRD/product-direction drift alone is advisory and cannot produce `changes-requested` or `blocked`.
- a PR/merge targets a production branch; route that repository to `/sdd-release` instead.
- PR/merge/global closeout would require push, rebase, destructive action, production credentials, deployment, target-branch changes beyond an explicitly authorized `--merge-and-close` integration, or human approval not already granted; or any target repository has not met its recorded gate.
- findings need product, architecture, data, auth, or scope judgment from the user.

## Final Response

Final-report invariant: default, `--deep`, `--no-fix`, slice checkpoint, seal audit, and explicit deep re-review all use the applicable complete report structure below. Never replace it with a short narrative such as “review is ready,” a list of resolved themes, test totals, or key commits. Progress updates may be concise, but the last response must independently contain the complete review result and every residual finding.

For a full review, lead with the exact line `Verdict: ready`, `Verdict: changes-requested`, or `Verdict: blocked`, then report separate `Implementation Quality: pass|findings|cannot-verify` and `Spec Adherence: pass|findings|cannot-verify` axes. These axes inform the overall verdict; they are not additional lifecycle statuses. Slice-checkpoint and candidate-review modes use the same overall verdict line and axes, identify the exact reviewed candidate, report every proportionate gate plus finding IDs and `cannot-verify` gaps, and explicitly state that final Change-wide integration readiness was not assessed. Other narrow modes use their documented narrower verdict vocabulary but retain the applicable report fields.

Include:

- complete Gate Execution Manifest covering exactly the 14 canonical gate IDs with method or command, exact candidate, result, and durable proof reference; no gate may be silently omitted because another gate already failed; keep this manifest in the durable slice Review rather than duplicating it into the minimal `sdd-slice-closure-v2` receipt
- central Change path and ID, full target repository set, and each repository's source branch, exact reviewed source commit, and target branch
- final post-remediation reviewed source commit per repository as the review watermarks; list repository remediation commits and central review/ledger updates separately rather than substituting a “key commits” summary for the watermarks
- blocking and required findings, ordered by severity
- the one consolidated remediation batch, final Review result, residual suggestions, and accepted gaps
- whether `slice-reviews/<slice-id>.md` or final Change-wide `review.md` was created or updated and which repository rows changed
- Requirement/Scenario coverage result
- the complete Scenario Evidence Closure table with exact Scenario-set equality, claimed/proven boundaries, cited proof, evidence type, durability or reproduction reference, result, and required/optional/manual/dated-user-accepted gap classification
- Story reference traceability result
- Epic truth finding result and the separately pending or current `/sdd-epic-update` candidate; when Epic Update mutated files, the post-Epic Review result and final candidate watermark
- test and verification commands/results, with every pending rendered, live multi-context/realtime, provider/production, or other technical check classified as required verification, optional confidence evidence, manual acceptance, or explicitly dated user-accepted gap and reflected in the verdict
- rendered UI verification result, including the explicit triggered Visual Verification Matrix accounting table, surfaces, viewports, states/interactions, directly inspected evidence, durable proof or reproduction references, console/network outcome, and any blocked or accepted rows; say `not applicable` with a reason when the change is not UI-bearing
- manual UI confirmation walkthrough status, plus a concise `Suggested manual UI testing` list with route/setup/actions/expected result for anything the user should confirm; say `none` when no manual UI confirmation is useful
- Change-wide status, repository-specific closeout readiness, and any contradictory state
- formal security review result
- docs result
- Idea-side repository and current-state truth result
- release-communication result
- explicit unresolved product-decision result when applicable, plus any non-blocking `prd-revisit-suggested` advisory
- branch and merge readiness result for every targeted repository
- PR, merge, or single central closeout action taken, offered for confirmation, or blocked, reported by repository where applicable
- remaining risks and next action, including the repository that owns each unresolved gate
