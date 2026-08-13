---
name: sdd-apply
description: Select and implement one behavioral Requirement slice from a planned or in-progress central SDD Change. By default choose the next ready slice; accept an explicit slice ID when supplied. Resolve the slice's repository, read applicable workspace and repository AGENTS.md guidance, check branch policy, and warn before implementation when the current branch does not comply. This skill defines what to implement, not how: repository guidance and explicitly chained specialist skills own implementation method, verification, Epic or changelog updates, commits, review, and release work.
---

# SDD Apply

Select one behavioral slice from a central Change and make its implementation target unambiguous. Then implement that slice under the applicable workspace and repository guidance.

`/sdd-apply` owns **what comes next**. It does not impose a universal development method.

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

The Change must be `planned` or `in_progress`. Route `proposed` to `/sdd-change`. Treat `in_review` as review-owned unless another workflow has explicitly returned it to implementation.

Use repository IDs from `change.md`; never create or select a repository-local Change copy.

## Select The Slice

Prefer the new `## Requirement Slices` shape. For compatible legacy task files without Requirement slices, treat one coherent unchecked checklist item as the slice and warn that the Change still uses the legacy shape.

When a slice ID is explicit:

- require that exact slice to exist;
- report `done`, `blocked`, or `deferred` status instead of silently selecting another;
- select it only when its dependencies are complete or the user explicitly resolves the dependency conflict.

Otherwise choose in this order:

1. an `in progress` slice named by `Resume Here`;
2. a `ready` slice named by `Resume Here`;
3. the first `ready` slice whose dependencies are complete;
4. ask the user when several candidates require a product or sequencing choice that the artifacts do not settle.

Do not choose `done`, `blocked`, or `deferred` work. Ordering in `tasks.md` is advisory, but dependency and status truth is not.

If no actionable slice remains, report that fact. Do not transition to `in_review`, start review, close the Change, or invent more work.

## Build The Implementation Brief

Read enough authoritative repository-local Epic truth and Change context to make the selected slice independently understandable. Present a concise brief before editing:

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
- Constraints: <only accepted Change/ADR constraints that bound the outcome>
- Guidance: <applicable AGENTS.md paths, most specific last>
- Branch: <current branch and policy result>
```

This brief states **what must become true**. Do not add predicted files, modules, classes, functions, implementation steps, test architecture, framework techniques, commit plans, or specialist workflows that are not required by governing guidance.

If a cited Requirement or Scenario is missing or contradictory, stop and route the artifact gap to `/sdd-change` or the appropriate artifact-owning skill. Do not substitute an implementation guess for missing behavioral truth.

## Load Governing Guidance

Before implementation, read all applicable `AGENTS.md` files from the workspace root through the selected repository, plus any repository document those files require. More specific guidance wins.

Treat that guidance as the authority for:

- development process;
- required specialist skills and when to invoke them;
- test or verification method;
- documentation and generated-artifact updates;
- Epic, changelog, or other composed workflow handoffs;
- delegation policy;
- commit and branch policy.

Do not independently recreate those policies in this skill. Do not scan for or select specialist skills merely because they exist. Invoke another skill when applicable guidance or the user explicitly routes the selected slice through it.

When guidance does not prescribe a process, use the coding agent's normal project-aware implementation behavior. Missing optional methodology is not a reason for `/sdd-apply` to invent one.

## Check Branch Policy

Before changing repository files:

1. Read the selected repository's branch policy from applicable guidance.
2. Run `git branch --show-current` and `git status --short` in that repository.
3. Compare the current branch with the policy.

If the branch does not comply, warn the user with:

- repository ID;
- current branch;
- policy-required branch or branch class;
- the applicable guidance path.

Do not create, switch, reset, merge, or rebase branches automatically. Pause before implementation when policy disallows the current branch. If policy is absent or ambiguous, say that compliance could not be confirmed rather than inventing a branch model.

Always preserve unrelated dirty work. Stop when it overlaps the selected slice enough to make safe implementation uncertain.

## Apply The Selected Slice

After selection and branch preflight:

1. If the Change is `planned`, transition it once to `in_progress` with:

   ```bash
   sdd change transition <space-id> <change-id> --from planned --to in_progress --workspace <workspace-root>
   ```

2. Mark only the selected slice `in progress` and update `Resume Here` with the selected slice and immediate behavioral objective.
3. Implement the selected slice according to the loaded guidance. The repository's workflow—not this skill—decides how to design, test, delegate, document, or checkpoint the work.
4. Keep work inside the selected outcome, Requirements, Scenarios, dependencies, and accepted constraints.
5. If implementation reveals a genuine behavior, scope, repository-ownership, or unresolved technical-decision change, stop and route the same Change back to `/sdd-change` or `/sdd-adr` as appropriate.
6. Keep the selected slice's lightweight Implementation Ledger row current:
   - `in progress`: summarize only the actual implementation surface discovered so far;
   - `done`: summarize the observable result and important changed surface in one concise current-state entry;
   - `blocked`: state the implementation state reached and one concise blocker.
   Update the row's date whenever its state or summary changes. Keep exactly one current row per slice; replace stale text instead of appending history. Do not record commands, verification evidence, commit hashes, review state, or predicted implementation steps.
7. When the repository-defined workflow says the slice is complete, mark it `done`. When it cannot proceed, mark it `blocked` and record one concise reason.
8. Refresh `Resume Here`, `Remaining slices`, and blockers. Choose no additional slice during the same invocation.

If implementation naturally shows that a slice should be split or merged without changing accepted behavior, update the slice boundaries and references concisely. Route changed acceptance or scope back to `/sdd-change`.

## Composable Handoffs

`/sdd-apply` does not itself own:

- Epic or Story evidence reconciliation;
- changelog or release communication;
- commits, pushes, PRs, merges, or branch mutation;
- independent review or remediation review loops;
- release or deployment;
- Change transition to `in_review` or closeout.

When applicable repository guidance requires one of these, invoke the owning skill if available and authorized, or report the exact pending handoff. Do not absorb the other workflow's procedure into Apply.

A request to implement another slice is a new `/sdd-apply` invocation. A request to review implemented work routes to `/sdd-review`. A planning discovery routes to `/sdd-change`; a branching technical decision routes to `/sdd-adr`.

## Report

Report:

- selected Change and slice;
- repository and branch-policy result;
- behavioral outcome implemented or attempted;
- slice status: `done`, `blocked`, `deferred`, or still `in progress`;
- concise changed-surface summary matching the selected slice's current Implementation Ledger row;
- remaining slices and next ready slice, if determinable;
- composed handoffs required by repository guidance;
- blockers or scope discoveries.

Do not claim the whole Change is implementation-complete merely because one slice is done.
