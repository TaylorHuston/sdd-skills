---
name: sdd-change
description: Capture, plan, or revise one workspace-central SDD Change. Use when the user wants to preserve a desired outcome, create a Change, continue a proposed Change into implementation-ready outcomes, or revise remaining work after new evidence changes the plan.
---

# SDD Change

Create or revise the smallest durable record of what should change. This skill owns intent and delivery planning, not application implementation.

## Current Contract

A current Change uses `schema: sdd-change-v2` and three workspace-central records:

```text
<workspace>/.sdd/changes/<change-id>/
  change.md   # intent, lifecycle, constraints, accepted approach, expected risks
  tasks.md    # coherent delivery outcomes and one replaceable Resume checkpoint
  review.md   # candidate-bound results; created with planning and updated by Review/Apply
```

Repository-owned Epics remain the durable behavior map. Code, tests, ADRs, and supporting docs stay in their owning repositories. Schema-less Changes and slice Review/receipt formats are unsupported history; do not migrate or retrofit them unless the user asks for a specific manual correction.

## Select Or Create

1. Resolve the workspace, Space, repositories, and managed workflow with `sdd context <path> --json`.
2. Prefer an explicit Change. Otherwise inspect the top-level `activeChanges` from `sdd status <space-id> --json` and ask when selection is ambiguous.
3. Create a missing Change with:

```bash
sdd change create <space-id> <slug> [--repo <repository-id> ...]
```

Creation writes a v2 `change.md` with `status: proposed`. Repository selection may remain empty until planning.

## Gather Only Needed Context

Invoke `/sdd-gather-context` for action `change` when planning claims depend on current product, repository, decision, implementation, test, or Git truth. Deepen only where its result identifies a real gap.

Read applicable `AGENTS.md` files and project documentation before making repository claims. Do not inspect unrelated systems or manufacture alternatives.

## Capture Intent

Use `assets/change-template.md`. Record:

- why the Change exists;
- desired observable outcome;
- in-scope and out-of-scope boundaries;
- success signals;
- durable constraints;
- repository and Epic impact;
- unresolved questions.

Persist confirmed intent immediately. Leave the Change `proposed` when the user wants only backlog capture or when a material decision remains unresolved.

## Plan Delivery

When the user wants implementation-ready planning:

1. Confirm target repositories and existing Epic/Story/Requirement/Scenario ownership.
2. Describe observable behavior and important success, failure, authorization, recovery, or acceptance cases without enumerating every possible edge.
3. Preserve stable references for genuine revisions; allocate new IDs only for new accepted behavior.
4. Route a consequential choice among viable technical approaches to `/sdd-adr`. Route unresolved product direction to `/sdd-prd` and unresolved experience direction to `/sdd-design`.
5. Expand `change.md` with current context, behavioral changes, decision handoffs, selected approach, alternatives considered, implementation constraints, verification strategy, experience design when applicable, and risks.
6. Create `tasks.md` from `assets/tasks-template.md` and `review.md` from the Review template.

Each `tasks.md` outcome states what must become true:

- stable `S#`, status, repository, Requirements, Story changes, outcome, and authoritative Scenarios;
- dependencies and binding constraints;
- expected risk triggers with a concrete reason;
- `Consumes` or `Produces` only when another outcome or repository relies on the contract;
- focused verification intent;
- manual acceptance requirement.

Prefer one Requirement when it forms a useful vertical result. Combine Requirements when separate completion would publish an incoherent producer/consumer or user-visible contract, and record a concise coupling justification. Every outcome must fit one fresh implementation, verification, independent Review, and local-commit session.

Do not plan files, modules, classes, framework techniques, test architecture, delegation topology, command transcripts, ledgers, fixed gate manifests, receipts, digests, descriptors, or reseal work. Repository guidance and specialist workflows own how implementation happens.

## Risk And Verification Policy

Every outcome will later receive five universal Review results:

1. scope and exact candidate;
2. observable behavior;
3. fresh verification;
4. independent Spec Adherence and Implementation Quality review;
5. integrity and authority.

Planning declares only material expected triggers, such as UI/accessibility, security/privacy, persistence/contracts, concurrency/recovery/provider behavior, multi-repository integration, manual acceptance, or release. Review may add material discovered triggers.

Verification is proportional. Prefer focused behavior-derived and repository-required checks. Require a broad aggregate suite only when candidate breadth, repository policy, integration risk, or release risk makes it useful.

## Validate And Hand Off

Before declaring planning complete:

- ensure `change.md`, `tasks.md`, `review.md`, affected Epic references, and ADR decisions agree;
- ensure no unsupported legacy artifact is part of the current plan;
- run the proposed-to-planned transition and focused validation:

```bash
sdd change transition <space-id> <change-id> --from proposed --to planned --workspace <workspace-root>
sdd validate <space-id> --change <change-id> --workspace <workspace-root> --json
```

Resolve deterministic errors and inspect warnings. Return control before implementation. Recommend `/sdd-design --plan` only when material experience uncertainty remains; otherwise recommend `/sdd-apply`.

## Revising Remaining Work

When new evidence changes remaining scope, behavior, ownership, a durable decision, or verification intent:

- preserve completed outcome and Review history;
- return to `proposed` only when the whole current plan is no longer coherent;
- revise affected future outcomes and their references without rewriting completed facts;
- restore `planned` only after focused validation passes.

Create another Change for adjacent future work.

## Result

Return exactly one status: `complete`, `no-op`, `needs-user`, `blocked`, or `routed`.

Report the Change path and status, Space/repositories, artifacts read and written, important decisions, unresolved blockers, validation result, and recommended next workflow. Do not implement, commit, push, open a PR, release, deploy, or close the Change.

## Self Improvement

Report one concrete workflow improvement only when the session revealed recurring friction rather than speculative process expansion.
