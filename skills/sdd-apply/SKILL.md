---
name: sdd-apply
description: Deliver exactly one next-ready or explicitly requested Requirement slice from a planned or in-progress central SDD Change. Resolve its repository, load governing guidance, establish the exact candidate, implement and freshly verify the slice inline or through one optional isolated worker, then compose candidate-bound SDD Review and Epic Update before marking the slice done. Review and Epic Update remain independently callable; Apply stops before another slice, final Change-wide review, changelog, commits, PRs, release, deployment, or closeout.
---

# SDD Apply

Deliver one independently green behavioral Requirement slice through implementation, fresh verification, independent slice Review, and Epic reconciliation. `/sdd-apply` owns this bounded composition; repository guidance and applicable specialist skills own implementation technique, while `/sdd-review` and `/sdd-epic-update` keep their normal public contracts and remain directly callable.

## Inputs

Accept:

```text
/sdd-apply [change-id-or-path] [slice-id]
/sdd-apply [change-id-or-path] --slice S2
```

A bare `S#` argument is a slice ID. When no slice is supplied, choose the next ready slice.

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
- for a slice labeled `done`, first validate that required implementation verification, slice Review, Epic Update, and any required post-Epic Review are present and current for the recorded final candidate; return `no-op` only when all gates are current, otherwise restore it to `in progress` and resume at the first stale or missing gate without reimplementing already valid work;
- return `blocked` for an explicit blocked slice;
- return `needs-user` for an explicit deferred slice when the user must confirm reactivation or sequencing;
- select it only when its dependencies are complete or the user explicitly resolves the dependency conflict.

Otherwise choose in this order:

1. an `in progress` slice named by `Resume Here`;
2. a `ready` slice named by `Resume Here`;
3. the first `ready` slice whose dependencies are complete;
4. return `needs-user` when several candidates require a product or sequencing choice that the artifacts do not settle.

Do not choose a fully current `done`, `blocked`, or `deferred` slice. A nominally `done` slice with missing or stale composed gates is incomplete state, not a no-op; resume it at the first stale gate and repair its status/checkpoint. Ordering in `tasks.md` is advisory, but dependency and status truth is not.

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

On resume, reload canonical artifacts and repository state. Validate the stored Change ID, slice ID, each repository envelope and baseline, current candidates, phase, latest verification, Review, Epic-update, changelog, and acceptance candidates, and open finding or blocker against Git and current artifacts. Never trust remembered or stale state. A `done` label is not proof: when its verification, implementation Review, Epic Update, or required post-Epic Review is missing or stale, restore the slice and ledger row to `in progress`, preserve valid implementation, and resume at the first stale, blocked, or incomplete gate. If an exact pre-slice baseline for already-started work cannot be recovered unambiguously, return `needs-user` or `blocked` instead of guessing.

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
6. Run fresh, proportional verification for the current candidate. Cover the slice's referenced Requirements and Scenarios, its verification intent, affected interface contracts, and repository-required checks. Record the command or observation, result, exact candidate watermark, coverage, and whether evidence is automated or manual in the result or owning evidence artifact—not in the Implementation Ledger.
7. Any candidate change makes affected verification stale. Rerun proportionate proof before claiming completion. Manual acceptance remains separate and returns `needs-user` when required now; never present automated verification as human acceptance.
8. Keep the slice `in progress` after implementation verification. Do not mark it `done` until the composed Review and Epic Update gates below succeed.
9. Keep the selected slice's lightweight Implementation Ledger row current:
   - `in progress`: summarize only the actual implementation surface discovered so far;
   - `done`: summarize the observable result and important changed surface in one concise entry;
   - `blocked`: state the implementation state reached and one concise blocker.
   Replace stale text and update the date. Keep exactly one row per slice. Do not record commands, detailed verification evidence, commit hashes, review state, or predicted implementation steps.
10. Refresh `Resume Here`, `Remaining slices`, and blockers after each candidate mutation or composed capability result. Record the latest candidate, verification, Review, Epic-update, changelog, and acceptance watermarks plus any open finding or blocker in the replaceable current checkpoint. Choose no additional slice during this invocation.

## Compose Slice Review

After fresh implementation verification passes, invoke `/sdd-review` through its public candidate-bound contract in **implementation-phase slice-checkpoint mode**. Supply the exact repository envelope, Change and slice IDs, Requirement/Scenario references, implementation verification, manual-acceptance state, and any prior Review finding IDs. Do not use the implementer as the only reviewer; use a fresh-context reviewer when available and independently validate its concrete findings.

Slice-checkpoint Review is narrower than the later final Change-wide integration review:

- Spec Adherence covers the selected slice's Requirements, Scenarios, binding constraints, and interface contracts.
- Implementation Quality inspects the complete candidate and relevant regression surface, including security, data safety, rendered UI, and repository policy where applicable.
- It does not transition the Change to `in_review`, assess whole-Change closeout, create a PR, merge, commit, release, deploy, or close the Change.
- Direct `/sdd-review` invocation remains valid with or without Apply and uses the same public inputs and result vocabulary.

Handle the Review result explicitly:

- `ready`: refresh the implementation Review candidate and continue to Epic Update. `epic-update-required` is an expected companion result when implementation and evidence are sound but affected Epic mappings are still stale; it is not permission to skip Epic Update.
- `changes-requested`: keep the slice `in progress`. By default, perform at most one bounded same-slice remediation batch for valid findings that do not require product, behavior, design, architecture, destructive, credential, production, or user-authority decisions. Rerun affected implementation verification, re-resolve the candidate, and invoke scoped re-review with prior finding IDs plus old/new candidate watermarks.
- `blocked`: keep the slice `in progress` or `blocked` according to the concrete condition and return `blocked` after recording it.
- findings that change accepted behavior route to `/sdd-change`; unresolved experience direction routes to `/sdd-design --revise`; consequential technical alternatives route to `/sdd-adr`; user decisions or authority return `needs-user`.

If the bounded remediation and scoped re-review do not produce `ready`, stop this Apply invocation. Do not loop indefinitely or proceed to Epic Update with unresolved `BLOCKING` or `REQUIRED` findings.

## Compose Epic Update

After slice-checkpoint Review is `ready` for the exact implementation candidate, invoke `/sdd-epic-update` through its public candidate-bound contract. Supply the same implementation baseline/candidate envelope, Change and slice IDs, Requirements/Scenarios, current Review result, and durable verification evidence.

Epic Update remains independently callable with or without Apply. Within Apply:

- scope reconciliation to behavior affected by the selected slice while allowing necessary correction of directly contradictory neighboring Epic truth;
- accept `complete` or evidence-based `no-op` as a passing gate;
- handle `needs-user`, `blocked`, or `routed` exactly as the capability reports and do not mark the slice done;
- after Epic mutations, re-resolve the repository candidate and record both the reviewed implementation-input watermark and post-Epic-update repository watermark;
- when Epic Update returns `complete`, invoke `/sdd-review --slice-checkpoint --phase post-epic` against the post-reconciliation candidate. Scope this rereview to affected Epic truth, anchors, durable evidence, candidate attribution, and regressions introduced by the Epic-only change; the final Review watermark must cover the actual post-Epic candidate;
- when Epic Update returns `no-op`, the implementation-phase Review remains current because the repository candidate did not change;
- do not invoke Changelog, commit the Epic edits, or perform lifecycle/closeout work.

Mark the slice `done` only when required implementation verification is fresh, implementation-phase slice Review is `ready`, Epic Update returned `complete` or evidence-based `no-op`, and any required post-Epic slice Review is `ready` for the final repository candidate. Manual acceptance remains separate and may remain `pending user`; record it without claiming acceptance.

If implementation shows that a slice should be split or merged without changing accepted behavior, update the boundaries and references concisely. Route changed acceptance or scope back to `/sdd-change`.

## Terminal Handoffs

`/sdd-apply` stops after one complete slice pipeline. It composes slice-checkpoint Review and Epic Update, but it does not automatically cross into:

- another Requirement slice;
- final Change-wide integration Review or transition to `in_review`;
- changelog or release communication;
- commits, pushes, PRs, merges, or branch mutation;
- release or deployment;
- closeout.

A request to implement another slice is a new `/sdd-apply` invocation. When no actionable slice remains, recommend a directly invoked final `/sdd-review` across the complete Change; that review is not replaced by the per-slice Review result. Changed behavior routes to Change, unresolved experience direction to Design, and durable technical tradeoffs to ADR. Report exact pending handoffs without executing them implicitly.

## Result Contract

Return exactly one composable status:

- `complete` — the selected slice is `done`, required implementation verification is fresh, implementation-phase slice Review is `ready`, Epic Update is `complete` or evidence-based `no-op`, and any required post-Epic slice Review is `ready` for the final candidate; report pending manual acceptance and whether another Apply slice or final Change-wide Review comes next;
- `no-op` — the explicit slice was already done or no actionable slice remains, and no mutation was needed;
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
- composed Review mode, verdict, finding IDs/counts, reviewed implementation watermark, remediation/re-review result, and remaining findings;
- composed Epic Update result, affected Epic references, implementation-input and post-reconciliation watermarks, validation/idempotence result, and stale downstream gates;
- manual acceptance state;
- remaining slices and next ready slice, if determinable;
- blockers, concerns, scope discoveries, and recommended next workflow.

Do not claim the whole Change is implementation-complete merely because one slice is done. Verification and worker evidence are candidate-bound; identify stale evidence rather than carrying it forward.

## Self Improvement
After completing this skill ask yourself "what improvements to this skill could be made that would improve our overall SDD workflow?" Report any suggestions to the user.