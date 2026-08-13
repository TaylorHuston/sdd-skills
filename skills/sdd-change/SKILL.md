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
  tasks.md     # adaptive requirements-oriented delivery slices added during planning
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

For each affected behavior, decide whether it creates a new Requirement or revises existing Requirement truth. Preserve stable Story, Requirement, and Scenario IDs for genuine revisions; allocate new IDs only for genuinely new behavior. Name every Story that must be created or updated and ensure the owning Epic contains the cited Requirements and Scenarios before planning is called complete.

Keep technical constraints in the technical-planning sections of `change.md` unless users or external clients can observe them. Do not invent implementation locations or verification evidence for work that does not exist yet.

### 3. Resolve technical approach decisions

Identify decisions that materially affect architecture, contracts, data, dependencies, security, operations, or future work.

When current evidence reveals two or more meaningfully different viable technical approaches, invoke `/sdd-adr` before selecting or finalizing the approach. Pass it the stable Change ID, owning repository, decision question, relevant constraints, and approaches already discovered. `/sdd-adr` owns option comparison, recommendation, user decision, and the judgment about whether to create or update a durable ADR. Treat its public result explicitly:

- `complete`: incorporate the confirmed direction and repository-relative ADR path.
- `no-op`: incorporate the confirmed direction and note that no durable ADR was warranted.
- `needs-user` or `blocked`: keep the Change `proposed`, record the unresolved decision or blocker, and return that status.
- `routed`: return control with the owning workflow named; do not cross its mutation boundary.

A meaningful difference changes an important boundary, contract, data or state model, dependency, security posture, operational model, migration path, or future constraint. Do not invoke `/sdd-adr` merely to manufacture alternatives for a straightforward implementation detail. Route unresolved product direction to `/sdd-prd` and material experience-design choices to `/sdd-design`.

When only one technical approach is viable, state the constraining reason in `change.md`; do not invent alternatives or invoke `/sdd-adr` ceremonially. After a completed ADR handoff, record the selected approach and any repository-relative ADR path in `change.md`; reflect only resulting behavioral work or binding decision constraints in `tasks.md`. Do not duplicate `/sdd-adr`'s full option analysis or add a technical decision summary to `tasks.md`.

Do not finalize while a material product or technical choice remains unresolved.

### 4. Plan verification and requirement slices

Identify the public seams where behavior will be tested and any manual confirmation still needed. Prefer focused behavioral evidence over implementation-coupled tests or generic checklists.

Progressively append or update the sections from `assets/planning-sections.md` in `change.md`: current context, behavioral changes, technical decision handoffs, selected approach, applicable experience design, alternatives, constraints, verification strategy, and risks.

Create `tasks.md` from its template as a requirements-oriented delivery queue:

- each slice covers one distinct Requirement or a small group of closely related Requirements as the smallest practical vertical unit that can become independently green;
- require an observable outcome, a focused Scenario-based test cycle, and a meaningful independent review verdict so one slice may be rejected without necessarily rejecting adjacent slices;
- identify each Requirement as new or revised and cite its full Epic/Story/Requirement reference;
- name every Story to create or update;
- include one short stand-alone outcome summary and cite authoritative Scenario IDs instead of duplicating their full acceptance text;
- state only behavioral or decision dependencies and binding constraints needed to know whether the slice is ready;
- add concise `Consumes` and `Produces` contracts only when another slice or repository relies on that interface;
- state focused verification intent and whether manual acceptance is required, while leaving implementation-time evidence to the owning workflows;
- make each slice independently understandable so a future isolated subagent can gather fresh implementation context and deliver it;
- fold setup, configuration, migrations, and documentation into the behavioral slice that requires them; batch only same-shape work that shares one acceptance and review surface;
- describe what must be implemented, never how to implement it;
- initialize one lightweight Implementation Ledger row per slice with repository, `not started` status, `None yet.` summary, and the current date;
- initialize the fixed-label `Resume Here` checkpoint with this Change ID, current slice and phase, pending downstream candidate watermarks, one repository envelope per selected slice repository, and no fabricated baseline or evidence.

The checkpoint and Implementation Ledger are current-state resume aids that `/sdd-apply` maintains. Do not predict files or steps in it. Do not prescribe files, modules, functions, components, schemas, framework techniques, implementation order inside a slice, test architecture, subagent specialization, or speculative enabling work. Do not add generic engineering checklists, universal risk matrices, or verification ledgers. Add conditional coordination or evidence sections only when this particular Change already requires them.

Slice order is advisory, not a frozen implementation sequence. `/sdd-apply` may select any ready slice and may resequence, split, or merge slices when implementation discoveries warrant it, while preserving Requirement and Scenario truth. A discovery that changes accepted behavior or scope returns to `/sdd-change`.

Do not create `design.md` for future Changes. If the selected Change already has one, treat it as compatible source context: update it only when continuing that existing record would otherwise leave two contradictory current plans.

### 5. Validate and hand off

Check that `change.md` and `tasks.md` agree, including any compatible existing `design.md`, then run:

```text
sdd change transition <space-id> <change-id> --from proposed --to planned
sdd validate <space-id> --change <change-id> --workspace <workspace-root> --json
```

Resolve deterministic errors and inspect warnings. If planning remains incomplete, keep the Change `proposed` and return `needs-user` or `blocked` with the next decision or blocker. When the coherent Change reaches `planned`, return `complete` and recommend `/sdd-design` when material experience uncertainty remains or `/sdd-apply` otherwise. This is a terminal handoff: return control before either workflow's mutation boundary rather than invoking it automatically.

## Revising An Existing Plan

When implementation, review, or feedback changes scope, observable behavior, repository or Epic ownership, a material technical decision, or verification strategy:

1. Confirm that the discovery belongs to the current Change.
2. Return the Change to `proposed` with `sdd change transition` when needed.
3. Update the intent and technical-planning sections of `change.md`, affected Epic Story/Requirement/Scenario truth, requirement slices in `tasks.md`, and relevant ADRs. Reconcile an existing `design.md` only when the Change already has one.
4. Preserve stable Story, Requirement, and Scenario IDs when their meaning has not changed.
5. Reconcile slice boundaries and record the `/sdd-apply` restart point without adding a technical implementation recipe.
6. Transition back to `planned` only when the revised plan is coherent.

Create another Change for adjacent future work. Route changed product direction through `/sdd-prd`.

## Guardrails

- Maintain one central Change.
- Do not silently broaden or narrow confirmed intent.
- Keep unresolved uncertainty explicit.
- Do not claim planned behavior is implemented or verified.
- Do not turn `tasks.md` into a second technical plan or a chronological engineering diary.
- Do not edit application code from this skill.
- Let project guidance own branch, release, documentation, and technology policy.

## Result Contract

Return exactly one composable status:

- `complete` — intent capture or requested technical planning finished and the artifacts are coherent for that checkpoint;
- `no-op` — the selected Change already satisfies the requested capture or planning checkpoint and no mutation was needed;
- `needs-user` — product direction, repository ownership, a tradeoff, or permission to continue planning requires the user;
- `blocked` — current evidence, validation, ownership, or repository state prevents safe completion;
- `routed` — PRD, ADR, Design, or another workflow owns the discovered question.

Report the checkpoint covered, Change path and lifecycle status, Space, repositories, artifacts read and written, important decisions, unresolved questions or blockers, validation result, and recommended next workflow. A result is terminal for this invocation: do not automatically invoke Design, Apply, implementation, review, commit, release, or closeout.

## Final Response

Return the result contract above concisely.

## Self Improvement
After completing this skill ask yourself "what improvements to this skill could be made that would improve our overall SDD workflow?" Report any suggestions to the user.