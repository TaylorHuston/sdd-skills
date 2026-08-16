---
name: sdd-apply
description: Deliver exactly one next-ready or explicitly requested Requirement slice from a planned or in-progress central SDD Change. Resolve its repository, load governing guidance, establish the exact candidate, implement and freshly verify the slice inline or through one optional isolated worker, compose candidate-bound SDD Review and Epic Update, then create and record the final reviewed slice commit before marking it done. Review and Epic Update remain independently callable; Apply stops before another slice, final Change-wide review, changelog, push, PR, release, deployment, or closeout.
---

# SDD Apply

Deliver one independently green behavioral Requirement slice through implementation, fresh verification, independent slice Review, Epic reconciliation, and one final local commit per affected repository. `/sdd-apply` owns this bounded composition; repository guidance and applicable specialist skills own implementation technique, while `/sdd-review` and `/sdd-epic-update` keep their normal public contracts and remain directly callable.

## Inputs

Accept:

```text
/sdd-apply [change-id-or-path] [slice-id]
/sdd-apply [change-id-or-path] --slice S2
```

A bare `S#` argument is a slice ID. When no slice is supplied, choose the next ready slice. Completed slices default to deterministic seal audit; renewed adversarial discovery requires an explicit deep re-review request.

Default mode applies exactly one slice. Do not interpret an ordinary invocation as permission to consume every slice in the Change. Autonomous or all-slices execution is a future explicit mode; if requested before that mode exists, say so and continue only with one user-confirmed slice.

## Resolve The Change

1. Use an explicit central Change path or workspace-unique Change ID when supplied.
2. Otherwise infer the Change from the conversation, then from the top-level `activeChanges` returned by `sdd status <space-id> --json`.
3. Auto-select only when exactly one compatible central Change is unambiguous. Ask when multiple Changes match.
4. Resolve the workspace, Space, and target repositories with `sdd context <relevant-path> --json`.
5. Read the returned `workflowPath`, central `change.md`, `tasks.md`, and an existing `design.md` only when that Change already has one.

The Change must be `planned` or `in_progress`. Return `routed` to `/sdd-change` for `proposed`. Treat `in_review` as review-owned unless another workflow has explicitly returned it to implementation.

Use repository IDs from `change.md`; never create or select a repository-local Change copy.

## Select The Slice

Prefer the `## Requirement Slices` shape. For compatible legacy task files without Requirement slices, treat one coherent unchecked checklist item as the slice and warn that the Change still uses the legacy shape.

When a slice ID is explicit:

- require that exact slice to exist;
- for a slice labeled `done`, default to seal audit: validate its recorded Review/receipt identity and digest, exact Scenario/visual sets and gaps, Epic agreement, commit reachability, and tree equality without launching new adversarial discovery or imposing later ceremony. Only an explicit deep re-review may seek new semantic or implementation findings. First validate its recorded verification, Review, Epic Update, semantic/evidence closure, gap disposition, and final commit. If the slice declares current `Closure receipt: required`, require its durable slice Review and minimal v2 receipt; if it declares legacy `Completion certificate: required`, validate its v1 certificate. Existing completed slices without either marker are grandfathered and do not need retrofitting unless they reopen. Return `no-op` only when the applicable state is current; otherwise restore the slice to `in progress` and resume at the first stale or missing gate without reimplementing already valid work; persist the marker when reopening a legacy slice;
- return `blocked` for an explicit blocked slice;
- return `needs-user` for an explicit deferred slice when the user must confirm reactivation or sequencing;
- select it only when every dependency is fully complete, including its recorded final commit, or the user explicitly resolves the dependency conflict without weakening required gates.

Otherwise choose in this order:

1. an `in progress` slice named by `Resume Here`;
2. the earliest nominally `done` slice whose verification, Review, Epic Update, explicit semantic/evidence closure results, required post-Epic `EPIC-CLOSURE`/`EVIDENCE-CLOSURE` Review, or final commit is missing or stale, especially when it is a dependency of the named ready slice;
3. a `ready` slice named by `Resume Here` whose dependencies are fully complete and committed;
4. the first `ready` slice whose dependencies are fully complete and committed;
5. return `needs-user` when several candidates require a product or sequencing choice that the artifacts do not settle.

Do not choose a fully current `done`, `blocked`, or `deferred` slice. A nominally `done` slice with missing or stale composed gates, missing explicit semantic/evidence closure results, or no recorded slice commit is incomplete state, not a no-op; resume it at the first stale gate and repair its status/checkpoint. Ordering in `tasks.md` is advisory, but dependency and status truth is not.

If no actionable or stale-gate slice remains, return `no-op`. Do not transition to `in_review`, start review, close the Change, or invent more work.

## Build The Behavioral Brief

Read enough authoritative repository-local Epic truth and Change context to make the selected slice independently understandable. Present this concise brief before editing:

```markdown
## Selected Slice

- Change: <id and path>
- Slice: <S# and title>
- Repository: <stable ID and resolved root>
- Outcome: <observable result>
- Requirements: <new/revised references and summaries>
- Story changes: <create/update references>
- Scenarios: <authoritative IDs and relevant behavior>
- Dependencies: <satisfied dependencies or none>
- Binding constraints: <accepted Change/ADR constraints or none>
- Consumes: <applicable interface contracts or none>
- Produces: <applicable interface contracts or none>
- Verification intent: <focused Scenario-based proof>
- Manual acceptance: <required observation or not required>
- Guidance: <applicable AGENTS.md paths, most specific last>
- Branch: <current branch and policy result>
```

This brief states **what must become true**. Do not add predicted files, modules, classes, functions, implementation steps, test architecture, framework techniques, commit plans, or specialist workflows that are not required by governing guidance.

Default to exactly one Requirement. When the slice contains several Requirements, require its recorded `Coupling justification` to establish that separate completion would be incoherent and confirm that one fresh session can implement, verify, review, reconcile, and commit the whole slice atomically. Otherwise return `routed` to `/sdd-change` to split it.

Before editing, state a transient proof sketch: for each Scenario, name what it must demonstrate, one credible focused check, and any explicit failure, recovery, responsive, authorization, or acceptance state that check must cover. Keep it concise, do not persist another matrix or schema, and do not give it to Review as an authoritative interpretation. If credible proof is unavailable, return `needs-user` before implementation.

If a cited Requirement, Scenario, binding constraint, or relied-upon `Consumes`/`Produces` contract is missing or contradictory, return `routed` to `/sdd-change` or the appropriate artifact owner. Do not substitute an implementation guess for missing behavioral truth.

## Load Governing Guidance

Before implementation, read all applicable `AGENTS.md` files from the workspace root through the selected repository, plus any repository document those files require. More specific guidance wins.

Treat that guidance as the authority for:

- development process;
- required specialist skills and when to invoke them;
- test or verification method;
- documentation and generated-artifact updates;
- delegation and isolation policy;
- commit and branch policy.

Do not independently recreate those policies in this skill. Do not scan for or select specialist skills merely because they exist. Invoke another skill when applicable guidance, an observable trigger, or the user routes the selected slice through it.

When guidance does not prescribe a process, use normal project-aware implementation behavior. Missing optional methodology is not a reason to invent one.

## Required Trigger Checks

Use safeguards only when their observable trigger is present:

- **Active bug, failing test, or regression:** require a reproducible root cause through the applicable diagnosis workflow before a speculative fix. Establish a failing regression Scenario or test where practical. Return `routed` when diagnosis owns the next work.
- **Risk, repository policy, or specialist method requires TDD:** preserve RED/GREEN evidence where practical. Apply does not impose universal TDD.
- **Wide mechanical transition:** when no independently green vertical slice is possible, require explicit expand–migrate–contract slices rather than hiding a broad migration inside one slice.
- **Behavior, scope, ownership, or acceptance changes:** return `routed` to `/sdd-change`.
- **A consequential choice between viable technical approaches:** return `routed` to `/sdd-adr`.

Repeated failed hypotheses are not permission to accumulate speculative edits. Return `needs-user`, `blocked`, or `routed` with the evidence gathered.

## Preflight Branch, Dirty State, And Baseline

Before changing repository files:

1. Read branch policy from applicable guidance.
2. Run `git branch --show-current`, `git rev-parse HEAD`, and `git status --short` in the selected repository.
3. Compare the current branch with policy.
4. Inventory staged, unstaged, and relevant untracked state. Preserve unrelated user work.
5. Record one exact pre-slice diff envelope per repository the slice will mutate: stable repository ID/root, baseline commit SHA, candidate kind, and staged, unstaged, and relevant untracked state.

If the branch does not comply, warn the user with the repository ID, current branch, required branch or branch class, and guidance path. Return `needs-user` before implementation only when policy disallows work on the current branch or branch resolution requires user authority. Do not create, switch, reset, merge, or rebase branches automatically. If policy is absent or ambiguous, report that compliance could not be confirmed rather than inventing a branch model.

Stop with `blocked` when overlapping dirty work makes safe implementation or attribution uncertain. A dirty tree is otherwise a valid candidate; do not discard, overwrite, or silently absorb pre-existing edits.

Update the fixed-label current checkpoint under `Resume Here` with the selected Change and slice, one row in its repository-envelope table per affected repository, current phase, latest verification, review, Epic-update, changelog, and acceptance candidates, and open finding or blocker. For a working-tree candidate, its watermark identifies HEAD plus the staged, unstaged, and relevant untracked snapshot; for a committed candidate, record the resolved candidate SHA. This is replaceable resumption state, not a chronological command or evidence log.

On resume, reload canonical artifacts and repository state. Validate the stored Change ID, slice ID, each repository envelope and baseline, current candidates, phase, latest verification, Review, Epic-update, changelog, and acceptance candidates, the Implementation Ledger commit, the Slice Gate Ledger row, any required slice Review and closure receipt (or legacy completion certificate), and open finding or blocker against Git and current artifacts. Never trust remembered or stale state. A `done` label is not proof: when its verification, implementation Review, Epic Update, explicit `Semantic closure: pass` or `Evidence closure: pass` result, required post-Epic `EPIC-CLOSURE`/`EVIDENCE-CLOSURE` Review, required-gap disposition, or final recorded commit is missing or stale, restore the slice and both ledger rows to `in progress`, preserve valid implementation, and resume at the first stale, blocked, or incomplete gate. If an exact pre-slice baseline for already-started work cannot be recovered unambiguously, return `needs-user` or `blocked` instead of guessing.

## Choose Execution Strategy

Choose one proportional strategy without changing Apply's public result contract:

### Inline

The primary agent implements the slice directly. Prefer inline execution when the slice is small, context-sensitive, already in a safely dirty working tree, or delegation adds no value.

### Delegated

Use at most one fresh-context implementer when the harness supports it, repository policy permits it, the slice is safely bounded, and a dedicated isolated workspace with one-writer ownership is available. Detect existing harness or Git isolation first. Follow recorded user preference or repository policy; when neither authorizes creating isolation, ask before creating it. Prefer harness-native isolation and use a Git worktree only as an authorized fallback. Preserve delegated workspaces needed for review or PR feedback, and never remove them without explicit authorization.

Delegation is optional and harness-agnostic. Supply only:

- the behavioral brief;
- binding constraints and relevant `Consumes`/`Produces` contracts;
- repository guidance and working directory;
- baseline and permitted candidate surface;
- required verification and report contract;
- explicit stop conditions.

Do not inherit the full conversation, permit recursive delegation, or run parallel writers against shared files or state. Parallelize only independent read-only investigation or mutations isolated in separate workspaces. Use one writer per working tree.

Require the implementer to return `complete`, `complete-with-concerns`, `needs-context`, or `blocked`, plus actual changed surfaces and candidate-bound verification evidence. These are worker statuses, not Apply's public result. The primary agent remains responsible for scope, state, integration, candidate inspection, and final judgment. Independently inspect the diff and evidence; never treat the worker report as proof.

Fall back cleanly to inline execution when delegation is unavailable, unsafe, or unnecessary.

## Apply And Verify The Selected Slice

After preflight:

1. If the Change is `planned`, transition it once to `in_progress`:

   ```bash
   sdd change transition <space-id> <change-id> --from planned --to in_progress --workspace <workspace-root>
   ```

2. Mark only the selected slice `in progress`; update `Resume Here` with its immediate behavioral objective and current checkpoint.
3. Implement only that slice using the selected execution strategy and governing repository process.
4. Keep work inside its outcome, Requirements, Scenarios, dependencies, binding constraints, and interface contracts.
5. Inspect the complete resulting candidate against the pre-slice baseline, including staged, unstaged, and relevant untracked changes. Confirm every changed surface is attributable to the slice or identified as pre-existing.
6. Run fresh, proportional verification for the current candidate. Cover the slice's referenced Requirements and Scenarios, its verification intent, affected interface contracts, and repository-required checks. For every affected Scenario, classify the claimed boundary as `backend/data`, `rendered interaction`, `live multi-context/realtime`, `provider/production`, or `manual acceptance`, open the cited proof, and record whether the proof exercises that same boundary. Record the command or observation, result, exact candidate watermark, coverage, evidence type, and durability in the result or owning evidence artifact—not in the Implementation Ledger. Technical proof that depends on an interactive, rendered, live-provider, or multi-context observation must survive the current session through either a repository-owned deterministic test/artifact or a durable reproducible descriptor naming the candidate, environment or fixture, actors/contexts, route or entry point, actions, assertions or observations, console/network outcome when applicable, and stable artifact path or content hash. A `/tmp` path, chat transcript, reviewer summary, or bare phrase such as “local observation” is supporting context only and cannot be the sole completion evidence.
7. Any candidate change makes affected verification stale. Rerun proportionate proof before claiming completion. Manual acceptance remains separate and returns `needs-user` when required now; never present automated verification as human acceptance.
8. Keep the slice `in progress` after implementation verification. Do not mark it `done` until the composed Review and Epic Update gates below succeed and the final slice commit is created and recorded.
9. Keep the selected slice's lightweight Implementation Ledger row current:
   - `in progress`: summarize only the actual implementation surface discovered so far and keep Commit `pending`;
   - `done`: summarize the observable result and important changed surface in one concise entry and record the full final slice commit SHA;
   - `blocked`: state the implementation state reached and one concise blocker; keep Commit `pending` unless a previously recorded slice commit remains the exact current boundary.
   Replace stale text and update the date. Keep exactly one row per slice. Do not record commands, detailed verification evidence, review transcripts, or predicted implementation steps.
10. Refresh `Resume Here`, its repository-envelope table, the selected slice's Slice Gate Ledger row, `Remaining slices`, and blockers after each candidate mutation, remediation cycle, or composed capability result. If an older structured Change lacks a Slice Gate Ledger, create the compact canonical section before recording a completed gate; keep one row per slice and preserve existing compatible history. Derive staged, unstaged, and relevant untracked state from the live repository; never describe a dirty working-tree candidate as clean merely because its baseline was clean. Record the latest candidate, verification, Review, Epic-update, changelog, and acceptance watermarks plus any open finding or blocker in the replaceable current checkpoint. Choose no additional slice during this invocation.

## Compose Slice Review

After fresh implementation verification passes, invoke `/sdd-review` through its public candidate-bound contract in **implementation-phase slice-checkpoint mode**. Supply the exact repository envelope, Change and slice IDs, the complete affected Requirement/Scenario list, the per-Scenario claimed/proven boundary classification, durable implementation evidence, manual-acceptance state, and any prior Review finding IDs. Present prior verdicts, finding dispositions, screenshots, and runtime observations as untrusted claims to falsify; never tell the reviewer that all findings are resolved, evidence is closed, only manual acceptance remains, or the expected verdict is `ready`. Require the result to contain one Scenario Evidence Closure row for every supplied Scenario plus a Gate Execution Manifest naming each applicable gate, method or command, candidate, result, and durable proof reference. Missing, duplicated, scope-narrowed, non-durable, or unattested rows make the Review incomplete rather than `ready`. Do not use the implementer as the only reviewer; use a fresh-context reviewer when available and independently validate its concrete findings.

Slice-checkpoint Review is narrower than the later final Change-wide integration review:

- Spec Adherence covers the selected slice's Requirements, Scenarios, binding constraints, and interface contracts.
- Implementation Quality inspects the complete candidate and relevant regression surface, including security, data safety, rendered UI, and repository policy where applicable.
- It does not transition the Change to `in_review`, assess whole-Change closeout, create a PR, merge, commit, release, deploy, or close the Change.
- Direct `/sdd-review` invocation remains valid with or without Apply and uses the same public inputs and result vocabulary.

Handle the Review result explicitly:

- `ready`: accept only when Implementation Quality and Spec Adherence are both `pass`, every affected Scenario has exactly one closure row with durable same-boundary proof, the Gate Execution Manifest accounts for every applicable gate, the diff-scoped reverse-traceability inventory actually ran and every behavior-bearing source/test candidate is classified, every triggered visual-matrix state is exercised or recorded as a gap, every required technical gap is resolved or explicitly accepted by the user with date, and no applicable gate is omitted, `cannot-verify`, or `blocked`. Re-open a sample of high-risk cited proof and reject the verdict when its manifest contradicts tool evidence or the candidate. Refresh the implementation Review candidate and continue to Epic Update. `epic-update-required` is an expected companion result when implementation and evidence are sound but affected Epic mappings are still stale; it is not permission to skip Epic Update.
- `changes-requested`: admit each required finding only when it has explicit accepted-contract, material-safety, project-policy, false-closure, or deterministic-gate grounds. Classify it as `product-defect` or `closure-repair`, keep the slice `in progress`, and remediate the complete safe set in one consolidated batch. Rerun affected verification, re-resolve the candidate, refresh current state, then invoke one fresh comprehensive final slice Review. If that final Review finds another pre-existing issue, return `needs-user`; permit one narrow correction only when the finding is demonstrably a regression introduced by the remediation batch.
- `blocked`: keep the slice `in progress` or `blocked` according to the concrete condition and return `blocked` after recording it.
- findings that change accepted behavior route to `/sdd-change`; unresolved experience direction routes to `/sdd-design --revise`; consequential technical alternatives route to `/sdd-adr`; user decisions or authority return `needs-user`.

After the one consolidated remediation batch, run one fresh-context comprehensive implementation-phase slice Review across the complete Scenario list and all applicable gates before Epic Update. Give it the candidate, accepted behavior, raw evidence descriptors, and unresolved or previously reported finding IDs as claims—not prior `ready` conclusions or language asserting closure. This final implementation review must rediscover and falsify the whole slice rather than merely confirm prior finding IDs, must run the diff-scoped reverse-traceability inventory, and must explicitly account for every applicable visual-matrix state including long-content and failure/recovery states. Continue only when that comprehensive final Review is `ready`; otherwise record the candidate and exact findings and return `blocked`, `routed`, or `needs-user`. Never proceed to Epic Update with unresolved `BLOCKING` or `REQUIRED` findings, and never begin another broad review/remediation cycle in the same invocation.

## Compose Epic Update

After slice-checkpoint Review is `ready` for the exact implementation candidate, invoke `/sdd-epic-update` through its public candidate-bound contract. Supply the same implementation baseline/candidate envelope, Change and slice IDs, Requirements/Scenarios, current Review result, and durable verification evidence.

Epic Update remains independently callable with or without Apply. Within Apply:

- scope reconciliation to behavior affected by the selected slice while allowing necessary correction of directly contradictory neighboring Epic truth;
- accept `complete` or evidence-based `no-op` only when Epic Update reports both `Semantic closure: pass` and `Evidence closure: pass` for every affected Story and returns one Scenario Evidence Closure row for every affected Scenario, including claimed boundary, cited proof, proven boundary, result, and gap classification; a missing row or closure result is a stale/incomplete gate, not success;
- classify every remaining gap as `required`, `optional confidence`, `manual acceptance`, or `user accepted YYYY-MM-DD`; an unresolved required technical gap blocks `ready` and slice completion, while manual acceptance remains separate;
- handle `needs-user`, `blocked`, or `routed` exactly as the capability reports and do not mark the slice done;
- after Epic mutations, re-resolve the repository candidate and record both the reviewed implementation-input watermark and post-Epic-update repository watermark plus the semantic-closure result in the `Epic-update candidate` checkpoint;
- when Epic Update returns `complete`, invoke `/sdd-review --slice-checkpoint --phase post-epic` against the post-reconciliation candidate. This is a fresh comprehensive closure review, not a scoped finding-disposition pass: give the reviewer raw artifacts and evidence descriptors without asserting that Epic closure passed or that only manual gaps remain; require the reviewer to enumerate every affected Scenario, independently apply `EPIC-CLOSURE` across each affected Story's index row, body states, maps, and gaps, apply `EVIDENCE-CLOSURE` row by row across each Scenario's claimed and proven boundary, and return a complete Gate Execution Manifest. Structural validation, Epic Update's claimed status, prior reviewer wording, prior `ready` verdicts, and aggregate green commands are insufficient. The final Review watermark must cover the actual post-Epic candidate;
- when Epic Update returns `no-op`, the implementation-phase Review remains current because the repository candidate did not change;
- do not invoke Changelog or perform lifecycle/closeout work; Epic Update itself never commits, because Apply owns the final slice commit after all composed gates pass.

Do not mark the slice `done` yet. Once required implementation verification is fresh, comprehensive implementation-phase slice Review is `ready`, Epic Update returned `complete` or evidence-based `no-op` with semantic and evidence closure passed, and any required comprehensive post-Epic slice Review is `ready` without `EPIC-CLOSURE` or `EVIDENCE-CLOSURE` for the final repository candidate, independently reconcile every affected Scenario Evidence Closure row and both Review Gate Execution Manifests against the actual cited proof. Require exact Scenario-set equality, matching claimed/proven boundaries, durable reproducible evidence that survives the session, complete reverse-traceability and triggered visual-matrix accounting, no unresolved required technical gap, and explicit dated user acceptance for any accepted gap before continuing to the commit gate below. Manual acceptance remains separate and may remain `pending user`; record it without claiming acceptance.

If implementation shows that a slice should be split or merged without changing accepted behavior, update the boundaries and references concisely. Route changed acceptance or scope back to `/sdd-change`.

## Commit The Completed Slice

After every candidate-bound gate above passes, create one normal local commit in each repository affected by the selected slice. This commit is the final step of Apply and is part of the workflow authorization granted by invoking `/sdd-apply`; do not ask again merely to create the slice commit. This standing authorization is limited to the selected slice's attributable repository-local implementation, tests, generated files required by repository policy, supporting docs, and Epic reconciliation. It never authorizes staging the workspace-local central Change record, unrelated dirty work, another slice, another repository, secrets, push, amend, rebase, merge, tag, PR, release, deployment, or destructive action.

For each affected repository:

1. Reconfirm branch policy permits a local commit on the current branch, Git identity is available, the reviewed candidate watermark is unchanged, and every path intended for the commit is attributable to this slice. Return `needs-user` or `blocked` rather than committing when policy disallows it, identity is unavailable, attribution is ambiguous, or unrelated work overlaps a slice-owned path.
2. Capture the final reviewed working-tree watermark and exact slice-owned path manifest. Stage only those attributable paths. Never use broad staging when unrelated changes exist. Inspect the staged diff and run `git diff --cached --check` plus any repository-required staged/generated check.
3. Record the staged tree with `git write-tree`, create one concise project-conforming commit without amending earlier history, and resolve its full SHA. Use repository guidance for message format; otherwise name the observable slice outcome rather than an implementation mechanism.
4. Prove the commit is a content-preserving seal of the reviewed candidate: the commit's tree from `git rev-parse <sha>^{tree}` must equal the staged tree assembled from the reviewed slice-owned content and recorded immediately before commit, the committed path manifest must equal the approved staged manifest, and no slice-owned path may remain staged or unstaged afterward. A metadata-only transition from that exact staged tree to its commit does not require another slice Review; any content difference, hook rewrite, generated mutation, or leftover slice-owned change makes the prior gates stale and requires fresh verification plus the applicable Review/Epic sequence.
5. For a slice marked `Closure receipt: required`, first require the final candidate-bound Review at `<change-path>/slice-reviews/<slice-id>.md` using `sdd-slice-review-v1`. It owns the detailed 14-gate manifest, Scenario boundary reasoning, visual observations, findings, and proof references. After the content-preserving commit, generate `<change-path>/slice-closures/<slice-id>.yaml` from `assets/slice-closure-template.yaml` using `sdd-slice-closure-v2`. The minimal receipt records identity, final Review path/candidate/`ready` verdict/raw-file SHA-256, exactly one compact result/gap/Review-anchor row per Scenario and visual obligation, and the final commit with reviewed-tree/final-tree equality. It never copies test details, boundary analysis, visual observations, commands, changed paths, or Review reasoning. A working-tree Review candidate must name the final commit's sole parent as HEAD; a committed candidate must equal the final commit. A user-accepted technical gap uses `accepted-gap` and `user-accepted:YYYY-MM-DD` consistently. Continue to accept legacy v1 certificates for already completed slices; explicitly reopened slices adopt the current Review/receipt contract.
6. Preserve and report unrelated remaining dirty state. Re-resolve the repository state, but use the immutable full commit SHA as the completed slice candidate. Update `Resume Here`, the selected Implementation Ledger row, and the selected Slice Gate Ledger row with that SHA; confirm both ledgers record the same commit and the gate row still records closure pass with no required gaps. Run scoped `sdd validate`; when current closure is required, it must validate Review identity and raw-file digest, the exact gate/Scenario/visual sets, unique Review anchors, accepted-gap reconciliation, Epic agreement, final-commit reachability, and reviewed-tree/final-tree equality. Set the row and slice to `done` only after validation passes, and only then select the next ready slice for recommendation.

If the commit or closure-receipt validation fails, keep the slice `in progress`; leave or restore its completion claims to pending/stale as appropriate and return `blocked` or `needs-user` with the exact failure. Never claim `complete` from an uncommitted working-tree slice.

## Terminal Handoffs

`/sdd-apply` stops after one reviewed, Epic-reconciled, committed slice pipeline. It does not automatically cross into:

- another Requirement slice;
- final Change-wide integration Review or transition to `in_review`;
- changelog or release communication;
- pushes, PRs, merges, rebases, or other branch/history mutation;
- release or deployment;
- closeout.

A request to implement another slice is a new `/sdd-apply` invocation. When no actionable slice remains, recommend a directly invoked final `/sdd-review` across the complete Change; that review is not replaced by the per-slice Review result. Changed behavior routes to Change, unresolved experience direction to Design, and durable technical tradeoffs to ADR. Report exact pending handoffs without executing them implicitly.

## Result Contract

Return exactly one composable status:

- `complete` — the selected slice is `done`, required implementation verification is fresh, comprehensive implementation-phase slice Review is `ready`, Epic Update is `complete` or evidence-based `no-op`, any required comprehensive post-Epic slice Review is `ready`, every affected Scenario has same-boundary proof or an explicitly dated user-accepted gap, no required technical gap remains, and each affected repository has one content-identical final slice commit recorded by full SHA in both ledgers; report pending manual acceptance and whether another Apply slice or final Change-wide Review comes next;
- `no-op` — the explicit slice was already done or no actionable slice remains, every required gate includes current explicit semantic/evidence closure results, and no mutation was needed;
- `needs-user` — slice choice, deferred-slice reactivation, branch or isolation resolution, overlapping-state disposition, required context, authorization, or manual acceptance requires the user;
- `blocked` — safe implementation or required verification cannot complete with current state or evidence;
- `routed` — diagnosis, Change, ADR, Design, or another owner must act before implementation can continue.

Also report:

- selected Change and slice;
- artifacts read and written;
- one diff envelope per affected repository with exact baseline, candidate kind and watermark, staged/unstaged/relevant-untracked state when applicable, and branch-policy result;
- execution strategy: inline or delegated, including isolation mode when delegated;
- behavioral outcome implemented or attempted;
- slice state: `done`, `blocked`, `deferred`, or `in progress`;
- concise changed-surface summary matching the current Implementation Ledger row;
- verification observations with Requirement/Scenario coverage and candidate watermark;
- the complete Scenario Evidence Closure table: Scenario, claimed boundary, cited proof, proven boundary, evidence type, durability or reproduction reference, result, and required/optional/manual/accepted-gap classification;
- each composed Review's Gate Execution Manifest with gate, method or command, candidate, result, and durable proof reference, including reverse-traceability and visual-matrix accounting; the manifest remains Review output rather than being copied into the minimal receipt;
- composed Review mode, verdict, finding IDs/counts and admission grounds, `product-defect` versus `closure-repair` classification, reviewed implementation watermark, consolidated remediation result, final Review result, and remaining findings;
- composed Epic Update result, affected Epic references, semantic-closure and evidence-closure results plus remaining gaps, implementation-input and post-reconciliation watermarks, validation/idempotence result, and stale downstream gates;
- final slice commit per affected repository, including full SHA, commit tree, reviewed pre-commit watermark, staged-manifest equivalence result, and preserved unrelated dirty state;
- manual acceptance state;
- remaining slices and next ready slice, if determinable;
- blockers, concerns, scope discoveries, and recommended next workflow.

Do not claim the whole Change is implementation-complete merely because one slice is done. Verification and worker evidence are candidate-bound; identify stale evidence rather than carrying it forward.

## Self Improvement
After completing this skill ask yourself "what improvements to this skill could be made that would improve our overall SDD workflow?" Report any suggestions to the user.