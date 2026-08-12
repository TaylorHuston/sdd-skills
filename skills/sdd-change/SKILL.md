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
  change.md    # intent, lifecycle, and progressively added technical plan
  tasks.md     # added during technical planning
```

`change.md` is the durable intent, lifecycle, and technical-planning record. Its frontmatter contains `status`, `space`, and `repositories`. Existing Changes may also contain a legacy `design.md`; read and reconcile it when present, but do not create one for new or newly planned Changes.

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

## Gather Context

Invoke `/sdd-gather-context` with action `change`, the focused desired outcome, the selected Change path, and known Space/repository IDs. It owns the shared minimum-read contract. Use its evidence-linked result for intent capture and planning, and deepen only where this Change exposes a remaining gap.

Do not finalize intent or technical planning while the result is insufficient for the focused outcome.

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

Start from the `/sdd-gather-context` result. Resolve its gaps and inspect additional implementation or current vendor evidence only when needed to plan this outcome accurately.

Confirm the target repositories before finalizing the plan.

### 2. Define observable behavior

Describe the affected Stories, Requirements, and concrete Scenarios. Cover important success and failure paths without enumerating every imaginable edge case.

Keep technical constraints in the technical-planning sections of `change.md` unless users or external clients can observe them. Do not invent implementation locations or verification evidence for work that does not exist yet.

### 3. Resolve technical approach decisions

Identify decisions that materially affect architecture, contracts, data, dependencies, security, operations, or future work.

When current evidence reveals two or more meaningfully different viable technical approaches, invoke `/sdd-adr` before selecting or finalizing the approach. Pass it the stable Change ID, owning repository, decision question, relevant constraints, and approaches already discovered. `/sdd-adr` owns option comparison, recommendation, user decision, and the judgment about whether to create or update a durable ADR. Resume `/sdd-change` after it returns the selected decision or an explicit unresolved state.

A meaningful difference changes an important boundary, contract, data or state model, dependency, security posture, operational model, migration path, or future constraint. Do not invoke `/sdd-adr` merely to manufacture alternatives for a straightforward implementation detail. Route unresolved product direction to `/sdd-prd` and material experience-design choices to `/sdd-design`.

When only one technical approach is viable, state the constraining reason in `change.md`; do not invent alternatives or invoke `/sdd-adr` ceremonially. After the handoff, record the selected approach and any repository-relative ADR path in `change.md`, and record follow-up work in `tasks.md`. Do not duplicate `/sdd-adr`'s full option analysis in the central Change.

Do not finalize while a material product or technical choice remains unresolved.

### 4. Plan verification and work

Identify the public seams where behavior will be tested and any manual confirmation still needed. Prefer focused behavioral evidence over implementation-coupled tests or generic checklists.

Progressively append or update the sections from `assets/planning-sections.md` in `change.md`: current context, behavioral changes, technical decision handoffs, selected approach, applicable experience design, alternatives, constraints, verification strategy, and risks. Create `tasks.md` as a short capability-level implementation ledger, blockers, verification obligations, and resume point using its template.

Do not create `design.md` for future Changes. If the selected Change already has one, treat it as compatible source context: update it only when continuing that existing record would otherwise leave two contradictory current plans. Keep tasks adaptive and outcome-oriented, not a file-by-file script.

### 5. Validate and hand off

Check that `change.md` and `tasks.md` agree, including any compatible existing `design.md`, then run:

```text
sdd change transition <space-id> <change-id> --from proposed --to planned
sdd validate <space-id> --change <change-id> --workspace <workspace-root> --json
```

Resolve deterministic errors and inspect warnings. If planning remains incomplete, keep the Change `proposed` and state the next decision. A coherent planned Change proceeds to `/sdd-apply`.

## Revising An Existing Plan

When implementation, review, or feedback changes scope, observable behavior, repository or Epic ownership, a material technical decision, or verification strategy:

1. Confirm that the discovery belongs to the current Change.
2. Return the Change to `proposed` with `sdd change transition` when needed.
3. Update the intent and technical-planning sections of `change.md`, `tasks.md`, and relevant ADRs. Reconcile an existing `design.md` only when the Change already has one.
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
