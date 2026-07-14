---
name: sdd-explore
description: Explore substantial product, technical, architectural, design, business, workflow, or requirement questions about a space before or during SDD work. Use when the user invokes /sdd-explore or wants a sustained discussion grounded in an idea and its related repositories with a durable private record. Create or resume a living exploration note under the owning idea's planning root, investigate only relevant context, and route mature conclusions toward sdd-prd, sdd-propose, sdd-adr, or another appropriate artifact without implementing application code.
---

# SDD Explore

Explore mode is a durable thinking partnership for a space. Help the user investigate, compare, challenge, and refine ideas without forcing every discussion into a change proposal.

The discussion may concern product direction, user needs, business model, visual direction, architecture, technology, implementation boundaries, operations, workflow, or SDD Requirements. It does not need to begin as a software change.

## Authority And Space Ownership

Resolve the idea-owned planning root and related implementation repositories from the nearest workspace `.sdd/config.yaml`. When the `sdd` CLI is available, prefer `sdd context <relevant-path> --json` and use its idea, planning, repository, role, and related-repository results. If the workspace is not initialized or the CLI is unavailable, use project guidance and explicit relationship metadata; ask when ownership remains ambiguous. Never assume fixed workspace directory names. One idea may relate to zero, one, or many repositories; inspect only those relevant to the discussion.

Read applicable project SDD guidance when the discussion depends on artifact authority, Epic or Story truth, Requirements and Scenarios, evidence, change lifecycle, or repository artifact locations. Do not require SDD artifacts merely to discuss a space.

Do not implement application code in this mode. Reading files, searching code, conducting research, sketching options, and maintaining the exploration record are allowed. If the user wants implementation, route the settled outcome to the appropriate execution workflow.

## Stance

- Be curious, direct, and grounded in the actual space.
- Ask questions that naturally reduce uncertainty; do not run a scripted interview.
- Surface options and tradeoffs without forcing an early decision.
- Use diagrams, state sketches, tables, and concrete examples when they clarify the discussion.
- Challenge assumptions when doing so would materially improve the outcome.
- Preserve uncertainty and distinguish suggestions, tentative conclusions, and user decisions.
- Let small questions stay small; reserve this workflow for discussions worth retaining.

## Start Or Resume The Record

For a substantial discussion using this skill, create or resume a durable exploration record.

1. Resolve the owning idea and planning root. If ownership is genuinely unclear and determines the record location, ask which space owns the discussion.
2. Inspect existing files under `<planning-root>/exploration/` for a clearly matching active or paused discussion.
3. Resume a matching record when the user is continuing the same exploration. Otherwise create:

```text
<planning-root>/exploration/yyyy-mm-dd-<topic>.md
```

4. Use the local shell date for `yyyy-mm-dd`. Keep the topic slug short, lowercase, and hyphenated.
5. Create the `exploration/` directory when needed and report the selected record path once.

Do not create a second discussion ledger under `.llm/discussions/` for the same exploration.

## Context Check

Orient lightly instead of auditing everything. Read only what can materially inform the discussion:

- the idea's README, PRD/Product Brief, project brief, prior explorations, and related private notes
- relevant `AGENTS.md`, README, architecture, style, testing, or operating guidance in related repositories
- active or closed changes when prior implementation decisions matter
- Epic specs when current or proposed behavior matters
- code and tests when the question depends on implementation reality
- external sources when the question requires current research

When an idea maps to multiple repositories, identify which repositories are relevant in the exploration record. Do not inspect every related repository by default.

## Exploration Record

Use this concise shape:

```markdown
---
kind: sdd-exploration
status: active
space: <space>
created: yyyy-mm-dd
updated: yyyy-mm-dd
related_repositories:
  - <repository, when relevant>
---

# <Topic>

## Current Understanding

<A stand-alone synthesis of the discussion so far.>

## Decisions

- <Only decisions the user actually made.>

## Options Considered

- <Option>: <tradeoff and current disposition.>

## Open Questions

- <Unresolved question.>

## Possible Next Steps

- <Continue exploring, create another artifact, or take no action yet.>

## Meaningful Developments

- yyyy-mm-dd: <Concise milestone, finding, or material direction change.>
```

Use `- None yet.` for empty list sections. The record is a synthesized working document, not a transcript.

## Maintaining The Record

Keep the exploration record current at meaningful checkpoints, including when:

- research or code investigation changes the understanding of the problem;
- the user accepts, rejects, or materially revises a direction;
- an option becomes favored, ruled out, or newly important;
- an important question is answered or a new blocker emerges;
- the discussion changes direction, pauses, or reaches a conclusion.

Re-read the record before updating it. Keep `Current Understanding`, decisions, options, questions, next steps, status, and `updated` mutually consistent. Preserve material rejected options and superseded assumptions when they explain the resulting direction.

Do not rewrite the record after every conversational turn. Do not add a turn-by-turn conversation log or duplicate chat history. Add a `Meaningful Developments` entry only when it will help a future reader understand how the direction changed.

If the record cannot be updated because of a tool or filesystem failure, say so rather than implying the durable record is current.

## Routing Mature Conclusions

The exploration record remains source context. When a stronger artifact becomes appropriate, recommend it and create or update it only with user authorization.

| Conclusion | Preferred Destination |
|---|---|
| Durable product purpose, audience, principles, scope, market, or monetization direction | Idea-owned PRD/Product Brief through `/sdd-prd` |
| A bounded product or implementation change | `docs/changes/yyyy-mm-dd-change-name/` through `/sdd-propose` |
| Technical approach, alternatives, risks, constraints, or verification strategy for an active change | The change's `design.md` |
| Durable architecture, data, dependency, integration, deployment, security, storage, or cross-cutting repository decision | `docs/adrs/yyyy-mm-dd-<decision-title>.md` through `/sdd-adr` |
| Work item, blocker, resume state, implementation note, or verification result for an active change | The change's `tasks.md` |
| Unsettled or contextual insight that should remain private planning context | Continue in the exploration record |

When an exploration produces a stronger artifact, link or mention that destination from `Possible Next Steps` or `Meaningful Developments`. Do not treat the exploration record as canonical Epic, Story, Requirement, implementation, or verification truth.

## Guardrails

- Do not implement application code.
- Do not edit Epic specs unless the user explicitly asks to apply a settled change through an appropriate workflow.
- Do not create `proposal.md`, `design.md`, or `tasks.md` unless the user asks to propose or capture into an existing change.
- Do not create an ADR unless the user asks to capture or draft the architecture decision.
- Do not pressure the user to formalize; offer the appropriate destination and continue or pause.
- Keep exploration records in private idea-owned planning docs, not public application docs.
- Do not let an exploration record override canonical PRD, Epic, Story, ADR, implementation, or verification truth.

## Pause Or Finish

When the discussion reaches a useful pause:

1. Update the record so `Current Understanding` stands alone.
2. Record final decisions, unresolved questions, and realistic next steps.
3. Set status to `paused`, `resolved`, or `superseded` as appropriate.
4. Report the record path and whether the discussion appears ready for `/sdd-prd`, `/sdd-propose`, `/sdd-adr`, another workflow, or no further action.
