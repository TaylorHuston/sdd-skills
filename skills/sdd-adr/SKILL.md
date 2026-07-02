---
name: sdd-adr
description: Create, update, or assess Architecture Decision Records for SDD projects. Use when the user invokes /sdd-adr, asks to draft an ADR, asks whether a technical decision needs an ADR, wants to record architecture options and tradeoffs, or when another SDD skill reaches a durable architecture, data, dependency, integration, deployment, security, storage, state-management, or cross-cutting project decision that future work should respect. Keeps ADRs linked to SDD changes, Epics, Stories, implementation evidence, and verification without replacing Epic/Story truth.
---

# SDD ADR

Create or update Architecture Decision Records for durable technical decisions in an SDD project.

Use this skill from `/sdd-explore` when a discussion reaches a durable architecture decision, and from `/sdd-propose` when the selected technical approach creates a rule future work should follow.

ADRs complement SDD artifacts. They do not replace Product Briefs/PRDs, Epics, Stories, Requirements, Scenarios, `Implemented By`, `Verified By`, proposal/design/tasks files, review reports, changelogs, or release records.

## ADR Threshold

Create or update an ADR when the decision is durable enough that future implementation or review should respect it.

Good ADR candidates:

- architecture boundaries or module ownership
- data model, storage, indexing, persistence, or migration strategy
- auth, permission, privacy, or security model decisions
- external service, dependency, framework, or platform adoption
- API, event, queue, job, deployment, or integration contracts
- state-management, caching, offline, sync, or concurrency strategy
- project-wide conventions that affect future changes

Do not create an ADR for:

- ordinary implementation details
- small reversible UI layout choices
- one-off tactical choices that do not constrain future work
- decisions already governed clearly by project-local guidance
- ideas the user has not decided or asked to preserve

When unsure, offer an ADR candidate instead of writing a committed decision.

## Location

Prefer project-local ADR guidance first. If none exists, use:

```text
<project-root>/docs/adrs/yyyy-mm-dd-decision-title.md
```

Use the local shell date for `yyyy-mm-dd`. Keep the slug short and decision-oriented.

If the project has no `docs/adrs/`, create it only when the user has asked to draft or capture the ADR. Do not create ADR folders just because an idea might eventually need one.

## Workflow

1. Resolve project root and decision context.
   - Read project `AGENTS.md`, README, existing ADRs, relevant SDD change artifacts, and relevant Epic files only as needed.
   - If invoked from another skill, use the change folder, design notes, explored options, and selected approach already in context.
2. Decide whether an ADR is warranted.
   - If not warranted, report why and suggest recording the decision in `design.md`, `tasks.md`, or an exploration summary instead.
   - If warranted but undecided, draft an ADR candidate with status `Proposed`.
3. Create or update the ADR.
   - Use `assets/adr-template.md`.
   - Preserve existing ADR status unless the user or project workflow explicitly changes it.
   - Use status values that match the project when present; otherwise use `Proposed`, `Accepted`, `Superseded`, or `Rejected`.
4. Link the ADR.
   - Link related SDD change folders, Epics, Stories, Requirements, Scenarios, PRs, or implementation evidence when known.
   - If invoked during `/sdd-propose`, ensure `design.md` and `tasks.md` mention the ADR path or ADR candidate.
   - If invoked during `/sdd-explore`, offer to link the ADR from an exploration summary or later `/sdd-propose`.
5. Verify the ADR.
   - Re-read the ADR.
   - Confirm it states context, decision, options considered, consequences, validation, and reconsideration signals.
   - Confirm it does not include secrets, private credentials, raw environment values, speculative roadmap promises, or unrelated private notes.

## Content Rules

- State the decision plainly.
- Include options considered and why the selected option won.
- Record tradeoffs honestly; an ADR with no downside is usually weak.
- Name validation evidence needed to prove the decision works.
- Include "Reconsider When" so future agents know when the decision may be stale.
- Keep ADRs concise. Put implementation progress in `tasks.md`, not in the ADR.
- Keep Epic/Story truth authoritative for behavior. ADRs explain technical decisions and constraints, not user behavior truth.

## Final Response

Summarize:

- ADR path
- status
- decision
- options considered
- links to related SDD artifacts
- follow-up needed in `design.md`, `tasks.md`, Epic truth, or review

## Final Self-Improvement Action

After completing or stopping this workflow, end the final user response with a concise self-improvement conclusion:

- Ask yourself: "How well did this work, and what could have been improved?"
- Tell the user the conclusion in 1-3 sentences.
- Name any concrete skill, template, doctrine, or process improvement worth considering.
- If no specific improvement is evident, say so plainly.
