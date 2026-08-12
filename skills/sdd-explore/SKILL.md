---
name: sdd-explore
description: Create or resume a durable synthesized record for any substantial discussion the user wants preserved beyond chat. Use when the user invokes /sdd-explore or asks to discuss, think through, investigate, compare, brainstorm, or reason about something with a lasting record—such as technical feasibility, marketing strategy, future features, product direction, architecture, operations, design, business questions, or workflows. Choose the record location deliberately, usually the owning idea's explorations directory, and route mature outcomes to sdd-prd, sdd-change, sdd-adr, or another appropriate workflow without implementing application code.
---

# SDD Explore

Maintain a durable thinking record for any substantial discussion the user wants to survive the chat session. Topic does not determine eligibility. The discussion may concern technical feasibility, marketing strategy, future capabilities, product direction, architecture, design, operations, business models, research, workflows, requirements, or something not anticipated here.

The trigger is durable-discussion intent: the user wants to investigate, compare, challenge, or refine something and retain the resulting understanding. Do not require the discussion to begin as a software Change or even as a settled project initiative.

## Boundaries

Use this skill when a discussion is worth synthesizing for future continuation or reuse. Let ordinary questions, quick decisions, and disposable brainstorming stay in chat unless the user explicitly asks for a durable record.

Do not implement application code in this mode. Reading files, searching code, conducting research, sketching options, and maintaining the discussion record are allowed. If the user wants implementation, route a settled outcome to the appropriate execution workflow.

An exploration is source context, not a mandatory stage or a weaker copy of another artifact. Do not use one to override a PRD, ADR, Change, Epic, repository guide, implementation, or verification record.

## Resolve Context And Ownership

Start with the topic and the user's durable-record intent, then resolve only enough context to place and inform the record.

When the topic may belong to an SDD Space, resolve the idea-owned planning root, Space ID, and related repositories from the nearest workspace `.sdd/config.yaml`. Prefer `sdd context <relevant-path> --json` when available. One idea may relate to zero, one, or many repositories; inspect only those material to the discussion. Ask when idea or repository ownership is genuinely ambiguous and changes where the record should live.

When the discussion depends on artifact authority, Epic or Story truth, Change status, or repository artifact locations, read the `workflowPath` returned by `sdd context` completely and use `sdd status <space-id> --json` as needed. Do not require a healthy SDD installation merely to preserve a discussion. If no Space owns the topic, follow workspace or vault guidance for private durable records rather than inventing an idea mapping.

## Gather Context

Invoke `/sdd-gather-context` with action `exploration`, the focused discussion question, known Space/repository IDs, and the selected or candidate record path. It owns the shared minimum-read contract. Use its evidence-linked result as the discussion baseline and deepen only where the exploration exposes a remaining gap.

A record may still be created to preserve the discussion when repository context is unavailable, but name that gap rather than implying feasibility or current-state claims are grounded.

## Choose The Record Destination

Choose the destination before creating a file. Explain a non-obvious recommendation and ask the user when two plausible locations have materially different ownership or privacy.

Use this priority:

1. **Explicit user destination:** use a safe, appropriate path the user named.
2. **Matching existing discussion:** resume the existing record instead of creating a duplicate.
3. **Established topic home:** when project or vault guidance, an existing folder, or a maintained note clearly owns this kind of discussion, suggest that location. Examples include an established marketing-strategy area, research directory, feature-ideas collection, or decision log.
4. **Idea-owned default:** when an SDD idea owns the discussion and no better home applies, use:

   ```text
   <idea>/explorations/yyyy-mm-dd-<topic>.md
   ```

5. **No idea owner:** use the workspace's documented private discussion location or ask the user where the record belongs. Do not place speculative private discussion in a public application repository by default.

For matching records, inspect the recommended directory and any existing idea-owned `explorations/` or `exploration/` directory. Resume a clearly matching active or paused record wherever it already lives. New idea-owned records default to the plural `explorations/` directory; do not bulk-move older records merely to normalize the folder name.

A stronger artifact can be the better destination when the user is no longer exploring—for example, they explicitly want to revise settled product direction, capture an architecture decision, or define a bounded desired outcome. Recommend and invoke the owning skill rather than creating a redundant exploration first. When uncertainty or discussion itself remains valuable, create or continue the exploration and route later.

Do not create a second ledger under `.llm/discussions/` or another generic location for the same discussion.

## Explore Deliberately

- Be curious, direct, and grounded in available evidence.
- Ask questions that naturally reduce uncertainty; do not run a scripted interview.
- Surface options and tradeoffs without forcing an early decision.
- Use diagrams, state sketches, tables, examples, or lightweight calculations when useful.
- Challenge assumptions when doing so materially improves the outcome.
- Distinguish evidence, hypotheses, suggestions, tentative conclusions, and user decisions.
- Match investigation depth to the question. Durable does not have to mean exhaustive.

Start from the `/sdd-gather-context` result. Follow additional references only when they can materially change the discussion. For version-sensitive technical questions, use an available current-documentation capability or primary vendor documentation. For market, marketing, business, or competitive questions, distinguish sourced facts from inference and date-sensitive assumptions.

## Record Shape

Use this concise default unless the selected destination has a stronger local template:

```markdown
---
kind: sdd-exploration
status: active
space: <space, when applicable>
created: yyyy-mm-dd
updated: yyyy-mm-dd
related_repositories:
  - <stable repository ID, when relevant>
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

Omit `space` and `related_repositories` when they do not apply. Add topic-specific sections—such as Evidence, Feasibility Findings, Audience Hypotheses, Campaign Ideas, Risks, Experiments, or Future Capabilities—when they make the record easier to resume. Use `- None yet.` for empty list sections. The record is a synthesized working document, not a transcript.

## Maintain The Record

Re-read and update the record at meaningful checkpoints, including when:

- research or investigation changes the current understanding;
- the user accepts, rejects, or materially revises a direction;
- an option becomes favored, ruled out, or newly important;
- an important question is answered or a blocker emerges;
- the discussion changes direction, pauses, or reaches a conclusion;
- a stronger destination becomes appropriate.

Keep the synthesis, decisions, options, questions, next steps, status, and `updated` date mutually consistent. Preserve rejected options and superseded assumptions only when they explain the resulting direction. Do not mirror every conversational turn or append a paraphrased transcript.

If the record cannot be updated, say so rather than implying the durable record is current.

## Route Mature Outcomes

An exploration may remain useful indefinitely, end with no action, or produce one or more stronger artifacts. Recommend and invoke the appropriate skill when the outcome matures and the user authorizes the handoff.

| Mature Outcome | Preferred Handoff |
|---|---|
| Settled product purpose, audience, principles, scope, market, or monetization direction | `/sdd-prd` |
| A bounded desired outcome, including a possible future feature | `/sdd-change` |
| A durable architecture, data, dependency, integration, deployment, security, storage, or cross-cutting technical decision | `/sdd-adr` |
| Material experience direction for a planned or active Change | `/sdd-design` |
| Concrete implementation work for an already planned Change | `/sdd-apply` |
| A maintained strategy, research, marketing, operations, or repository document with a clear owner | The applicable local workflow or direct document update with user authorization |
| Context still worth preserving but not ready for stronger authority | Continue the exploration |

When invoking another skill, pass the exploration path, stand-alone current understanding, explicit user decisions, unresolved questions, and relevant evidence. Let the receiving skill apply its own readiness and artifact rules. Link the destination from the exploration and mark whether the exploration remains active, is resolved, or has been superseded.

Do not call an ADR or Change a conversion of the exploration. The exploration remains source context; the new artifact owns its own decision or lifecycle truth.

## Guardrails

- Do not implement application code.
- Do not create duplicate records for the same discussion.
- Do not force every discussion into an SDD artifact.
- Do not hand-create central Change files; invoke `/sdd-change` and its CLI workflow.
- Do not hand-create an ADR when `/sdd-adr` is available; invoke it so decision readiness and durability are assessed consistently.
- Do not edit Epic truth merely because an exploration suggests future behavior.
- Keep speculative or private planning out of public repositories unless the user approves that destination.
- Do not claim a handoff occurred unless the receiving artifact was actually created or updated.

## Pause Or Finish

At a useful pause:

1. Make `Current Understanding` stand alone.
2. Reconcile decisions, options, open questions, and realistic next steps.
3. Set status to `paused`, `resolved`, or `superseded` as appropriate.
4. Report the record path.
5. State whether the discussion should continue, move through another skill, update a different maintained document, or take no further action.
