---
name: sdd-apply
description: Select and implement exactly one next-ready or explicitly requested Requirement slice from a planned or in-progress central SDD Change. Resolve its repository, load governing guidance, check branch policy and dirty state, establish the exact pre-slice baseline, choose inline or optional isolated delegated execution, implement and freshly verify only that slice, inspect the resulting candidate, and update lightweight resume state. Return before independent review, Epic reconciliation, changelog, commits, PR, release, or closeout.
---

# SDD Apply

Select and implement one independently green behavioral Requirement slice. `/sdd-apply` owns the bounded slice-delivery contract; repository guidance and applicable specialist skills own implementation technique.

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
- return `no-op` when it is already done;
- return `blocked` for an explicit blocked slice;
- return `needs-user` for an explicit deferred slice when the user must confirm reactivation or sequencing;
- select it only when its dependencies are complete or the user explicitly resolves the dependency conflict.

Otherwise choose in this order:

1. an `in progress` slice named by `Resume Here`;
2. a `ready` slice named by `Resume Here`;
3. the first `ready` slice whose dependencies are complete;
4. return `needs-user` when several candidates require a product or sequencing choice that the artifacts do not settle.

Do not choose `done`, `blocked`, or `deferred` work. Ordering in `tasks.md` is advisory, but dependency and status truth is not.

If no actionable slice remains, return `no-op`. Do not transition to `in_review`, start review, close the Change, or invent more work.

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

Record a current checkpoint under `Resume Here` with the selected Change and slice, one repository envelope per affected repository, current phase, latest verification, review, Epic-update, changelog, and acceptance candidates, and open finding or blocker. For a working-tree candidate, its watermark identifies HEAD plus the staged, unstaged, and relevant untracked snapshot; for a committed candidate, record the resolved candidate SHA. This is replaceable resumption state, not a chronological command or evidence log.

On resume, reload canonical artifacts and repository state. Validate the stored Change ID, slice ID, each repository envelope and baseline, current candidates, phase, latest verification, review, Epic-update, changelog, and acceptance candidates, and open finding or blocker against Git and current artifacts. Never trust remembered or stale state. Resume at the first stale, blocked, or incomplete gate. If an exact pre-slice baseline for already-started work cannot be recovered unambiguously, return `needs-user` or `blocked` instead of guessing.

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
8. Mark the slice `done` only when its current candidate has passing required automated verification and no unresolved implementation blocker. If verification fails or implementation cannot safely proceed, leave it `in progress` or mark it `blocked` with one concise reason.
9. Keep the selected slice's lightweight Implementation Ledger row current:
   - `in progress`: summarize only the actual implementation surface discovered so far;
   - `done`: summarize the observable result and important changed surface in one concise entry;
   - `blocked`: state the implementation state reached and one concise blocker.
   Replace stale text and update the date. Keep exactly one row per slice. Do not record commands, detailed verification evidence, commit hashes, review state, or predicted implementation steps.
10. Refresh `Resume Here`, `Remaining slices`, and blockers. Record the latest candidate, verification, and review watermarks plus any open finding or blocker in the replaceable current checkpoint. Choose no additional slice during this invocation.

If implementation shows that a slice should be split or merged without changing accepted behavior, update the boundaries and references concisely. Route changed acceptance or scope back to `/sdd-change`.

## Terminal Handoffs

`/sdd-apply` stops after one slice. It does not own or automatically cross into:

- independent review or remediation review loops;
- Epic or Story truth reconciliation;
- changelog or release communication;
- commits, pushes, PRs, merges, or branch mutation;
- release or deployment;
- Change transition to `in_review` or closeout.

A request to implement another slice is a new `/sdd-apply` invocation. Implemented work normally recommends separately invoked `/sdd-review`. When Apply addresses prior review findings, carry the prior finding IDs, previously reviewed candidate watermark, current fix candidate watermark, and focused fix verification into a separately invoked scoped re-review; do not silently substitute that scoped pass for a separately requested full review. Changed behavior routes to Change, and durable technical tradeoffs route to ADR. Report exact pending handoffs without executing them implicitly.

## Result Contract

Return exactly one composable status:

- `complete` — the selected slice is `done`, the current candidate was independently inspected, and required automated verification is fresh; report pending manual acceptance and recommended Review separately;
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
- manual acceptance state;
- remaining slices and next ready slice, if determinable;
- blockers, concerns, scope discoveries, and recommended next workflow.

Do not claim the whole Change is implementation-complete merely because one slice is done. Verification and worker evidence are candidate-bound; identify stale evidence rather than carrying it forward.
