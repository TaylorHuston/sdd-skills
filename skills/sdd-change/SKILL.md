---
name: sdd-change
description: Capture or plan an SDD Change. Use when the user wants to preserve a desired outcome, create a Change, continue planning a proposed Change, or revise a plan after new information changes it.
---

# SDD Change

Turn a desired outcome into a bounded, testable Change. This skill plans work; it does not implement application code.

A Change begins as captured intent and becomes implementation-ready only after technical planning. Keep planning proportional: record what must be true, the important decisions, and how the result can be verified. Do not predict an exhaustive implementation sequence.

## Artifact Model

Every Change starts in the central workspace store:

```text
<workspace>/.sdd/changes/<change-id>/
  change.md
  design.md    # added during technical planning
  tasks.md     # added during technical planning
```

`change.md` is the durable intent and lifecycle record. Its frontmatter contains `status`, `space`, and `repositories`.

- `proposed`: intent exists, but ownership or technical planning may be incomplete.
- `planned`: repositories, behavior, approach, and verification are settled enough to implement.

Target repositories contain Epics, ADRs, code, and tests—not copies of the Change.

## Select Or Create The Change

1. Resolve the Space and central Change store with `sdd context <path> --json`.
2. Prefer an explicitly named Change.
3. Otherwise resume a relevant `proposed` Change inferred from the conversation and `sdd status <space-id> --json`.
4. Ask when several Changes could match.
5. If none applies, derive a short slug and run:

```text
sdd change create <space-id> <slug> [--repo <repository-id> ...]
```

Repository selection is optional while the Change is proposed. Announce the selected Change and allow the user to correct the choice.

## Capture Intent

Before technical planning, ensure `change.md` captures:

- the problem or opportunity;
- the desired observable outcome;
- scope and non-goals;
- success signals;
- durable constraints;
- open product questions.

Use `assets/change-template.md`. Ask only what is needed to make the intent durable. Do not choose libraries, define APIs, or invent implementation tasks during this step.

Persist confirmed intent immediately. Then ask whether the user wants to continue into technical planning now. If not, leave the Change as `proposed` and report its path.

When resuming an existing proposed Change, read it first and continue from the next unresolved question instead of repeating the intake.

## Technical Planning

### 1. Understand the current system

Read only the project guidance, product context, Epics, ADRs, code, tests, dependencies, and prior Changes needed to plan this outcome accurately. Use current vendor documentation when a decision depends on version-specific behavior.

Confirm the target repositories before finalizing the plan.

### 2. Define observable behavior

Describe the affected Stories, Requirements, and concrete Scenarios. Cover important success and failure paths without enumerating every imaginable edge case.

Keep technical constraints in `design.md` unless users or external clients can observe them. Do not invent implementation locations or verification evidence for work that does not exist yet.

### 3. Choose the technical approach

Identify decisions that materially affect architecture, contracts, data, dependencies, security, operations, or future work.

For each non-trivial decision:

1. Present two or three viable approaches.
2. Compare their meaningful tradeoffs in this project.
3. Recommend one and explain why.
4. Ask the user to settle the choice.

When only one approach is sensible, state why instead of inventing alternatives. Record the selected approach, rejected alternatives, and reconsideration triggers in `design.md`. Use `/sdd-adr` when future Changes should respect the decision.

Do not finalize while a material product or technical choice remains unresolved.

### 4. Plan verification and work

Identify the public seams where behavior will be tested and any manual confirmation still needed. Prefer focused behavioral evidence over implementation-coupled tests or generic checklists.

Create:

- `design.md`: behavior, selected approach, alternatives, constraints, risks, and verification strategy;
- `tasks.md`: a short capability-level implementation ledger, blockers, verification obligations, and resume point.

Use the templates in `assets/`. Keep tasks adaptive and outcome-oriented, not a file-by-file script.

### 5. Validate and hand off

Check that `change.md`, `design.md`, and `tasks.md` agree, then run:

```text
sdd change transition <space-id> <change-id> --from proposed --to planned
sdd validate <space-id> --change <change-id> --workspace <workspace-root> --json
```

Resolve deterministic errors and inspect warnings. If planning remains incomplete, keep the Change `proposed` and state the next decision. A coherent planned Change proceeds to `/sdd-apply`.

## Revising An Existing Plan

When implementation, review, or feedback changes scope, observable behavior, repository or Epic ownership, a material technical decision, or verification strategy:

1. Confirm that the discovery belongs to the current Change.
2. Return the Change to `proposed` with `sdd change transition` when needed.
3. Update `change.md`, `design.md`, `tasks.md`, and relevant ADRs.
4. Preserve stable Story, Requirement, and Scenario IDs when their meaning has not changed.
5. Record what changed and the `/sdd-apply` restart point.
6. Transition back to `planned` only when the revised plan is coherent.

Create another Change for adjacent future work. Route changed product direction through `/sdd-prd`.

## Guardrails

- Maintain one central Change.
- Do not silently broaden or narrow confirmed intent.
- Keep unresolved uncertainty explicit.
- Do not claim planned behavior is implemented or verified.
- Do not edit application code from this skill.
- Let project guidance own branch, release, documentation, and technology policy.

## Final Response

Report the Change path and status, Space, repositories, important decisions, unresolved questions, validation result, and next step.
