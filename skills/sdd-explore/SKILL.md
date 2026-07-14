---
name: sdd-explore
description: Enter SDD explore mode as a thinking partner for product ideas, technical options, codebase investigation, architecture decisions, and requirement clarification before or during a SDD change. Use when the user invokes /sdd-explore, wants to think through a vague idea, compare approaches, inspect existing changes, investigate relevant code or Epic specs, decide whether to run sdd-propose, or decide whether an ADR is warranted. Do not implement code; optionally write a dated exploration summary under the project's private planning docs or draft an ADR when the user wants durable conclusions remembered.
---

# SDD Explore

Explore mode is a stance, not a fixed workflow. Think with the user, investigate when useful, and help the shape of the problem emerge before forcing it into proposal artifacts.

## Authority And Project Profile

Load `$sdd-doctrine` when the discussion depends on SDD artifact roles, authority, or lifecycle. Resolve the idea-owned planning root and relevant implementation repository through the doctrine relationship model unless project guidance explicitly maps them differently. When an idea maps to multiple repositories, inspect or ask for only those relevant to the exploration. Enforce changes under `docs/changes/`, Epics under `docs/epics/`, and ADRs under `docs/adrs/` inside the selected implementation repository; project guidance owns privacy and write-authorization rules.

Do not implement code in this mode. Reading files, searching code, sketching options, and updating exploration or change artifacts by request is allowed.

## Stance

- Be curious, direct, and grounded in the actual project.
- Ask questions that naturally reduce uncertainty; do not run a scripted interview.
- Surface options and tradeoffs without forcing an early decision.
- Use diagrams, state sketches, tables, and concrete examples when they clarify the discussion.
- Challenge assumptions when doing so would materially improve the outcome.
- Let small questions stay small; do not turn every thought into a change proposal.

## Context Check

At the start, orient lightly instead of auditing everything.

Read or inspect only what is relevant:

- `AGENTS.md`, `README.md`, or PRD/Product Brief context when project direction matters
- active changes under `docs/changes/yyyy-mm-dd-change-name/`
- closed changes under `docs/changes/closed/` when prior decisions may matter
- legacy changes under `changes/` only when pre-migration decisions may matter
- Epic specs under `docs/epics/*/epic.md`
- code paths only when the question depends on current implementation reality
- project private planning docs or `exploration/` notes when prior exploration summaries are likely relevant

If the project is unclear and the answer would affect where a summary is written, ask the user which project owns the exploration.

## Capture Options

Do not auto-capture decisions. Offer to capture when the discussion produces something worth preserving.

Use this routing:

| Insight | Capture Target |
|---|---|
| Product motivation, scope, or affected Epic actions | `docs/changes/yyyy-mm-dd-change-name/proposal.md` |
| Technical approach, alternatives, risks, constraints, or verification strategy | `docs/changes/yyyy-mm-dd-change-name/design.md` |
| Durable architecture, data, dependency, integration, deployment, security, storage, or cross-cutting project decision | `docs/adrs/yyyy-mm-dd-<decision-title>.md` |
| Work item, blocker, resume state, implementation note, or verification result | `docs/changes/yyyy-mm-dd-change-name/tasks.md` |
| Durable exploratory conclusion that should not become a change yet | `<planning-root>/exploration/yyyy-mm-dd-<slug>.md` |

If no change exists and the idea has crystallized enough to formalize, offer to run `sdd-propose`.

If the discussion reaches a durable architecture decision, offer to draft an ADR. Do not auto-create one. Use the canonical ADR location:

```text
<project-root>/docs/adrs/yyyy-mm-dd-<decision-title>.md
```

Use `/sdd-adr` to draft the ADR when the user wants to capture it. The ADR should cover context, decision, options considered, consequences, validation, and reconsideration signals. Keep status `Proposed` unless the user explicitly accepts the decision or project guidance defines another status workflow.

Use an ADR when the decision should constrain future implementation or review. Do not suggest an ADR for ordinary implementation details, minor UI layout choices, reversible tactical choices, or decisions already covered by project guidance.

## Exploration Summaries

Write a summary only when the user asks to save, capture, summarize, remember, or otherwise preserve the exploration.

Default location:

```text
<planning-root>/exploration/yyyy-mm-dd-<slug>.md
```

Use the local shell date for `yyyy-mm-dd`. Keep the slug short and based on the topic. Create the `exploration/` directory if needed. If a same-day file already exists for the topic, update it when clearly continuing the same exploration; otherwise use a more specific slug.

Use this concise shape:

```markdown
---
kind: sdd-exploration
status: active
project: <project>
created: yyyy-mm-dd
updated: yyyy-mm-dd
---

# <Topic>

## Summary

<What we figured out.>

## Options Considered

- <Option>: <tradeoff.>

## Decisions

- <Only decisions the user actually made.>

## Open Questions

- <Unresolved question.>

## Possible Next Steps

- <Run sdd-propose / keep exploring / no action yet.>
```

If the exploration later becomes a SDD change, leave the summary as source context and link or mention the resulting `docs/changes/yyyy-mm-dd-change-name/` folder when useful.

## Guardrails

- Do not implement application code.
- Do not edit Epic specs unless the user explicitly asks to apply a change.
- Do not create `proposal.md`, `design.md`, or `tasks.md` unless the user asks to propose or capture into an existing change.
- Do not create an ADR unless the user asks to capture or draft the architecture decision.
- Do not create a mandatory discussion record.
- Do not pressure the user to formalize; offer and move on.
- Keep summaries in private planning docs, not in public app docs.

## Ending

When the discussion reaches a useful pause, optionally summarize:

- what we figured out
- remaining uncertainty
- whether this is ready for `sdd-propose`
- whether anything should be captured in a change artifact, ADR, or exploration summary
