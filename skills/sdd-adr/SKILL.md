---
name: sdd-adr
description: Create, update, or assess Architecture Decision Records for SDD projects. Use when the user invokes /sdd-adr, asks to draft an ADR, asks whether a technical decision needs an ADR, wants to record architecture options and tradeoffs, or when another SDD skill reaches a durable architecture, data, dependency, integration, deployment, security, storage, state-management, or cross-cutting project decision that future work should respect. Keeps ADRs linked to SDD changes, Epics, Stories, implementation evidence, and verification without replacing Epic/Story truth.
---

# SDD ADR

Create or update Architecture Decision Records for durable technical decisions in an SDD project.

## Authority And Project Profile

Resolve the workspace, Space ID, repository, and stable repository ID with `sdd context <relevant-path> --json`, then read the `workflowPath` returned by `sdd context` completely before interpreting SDD artifact roles or Change status. Use the resolved repository and keep ADRs under its `docs/adrs/`. When Change context matters, run `sdd status <space-id> --json` and select relevant central Change records through that repository's filtered projection and their `change.md` metadata. Project guidance still owns ADR status vocabulary, required links, and write policy. If user setup is missing, direct the user to `sdd setup`; if the repository contract is missing, direct them to `sdd init` there. Use `sdd doctor` for an existing but unhealthy installation.

Use this skill from `/sdd-explore` when a discussion reaches a durable architecture decision. `/sdd-change` must invoke it whenever technical planning reveals two or more meaningfully different viable technical approaches; this skill owns their comparison, recommendation, user decision, and ADR-threshold assessment before returning the result to Change planning. Do not create an ADR during intent capture before technical decisions are understood.

ADRs complement SDD artifacts. They do not replace Product Briefs/PRDs, Epics, Stories, Requirements, Scenarios, `Implemented By`, `Verified By`, progressive `change.md`, the behavioral queue in `tasks.md`, review reports, changelogs, or release records.

## Gather Context

Invoke `/sdd-gather-context` with action `adr`, the focused decision question, known Space/repository IDs, and the invoking exploration or Change path. It owns the shared minimum-read contract. Use its evidence-linked result to compare approaches; deepen only where the decision exposes a remaining gap.

Do not recommend or record a decision while the result is insufficient for the focused question.

## ADR Threshold

Create or update an ADR only when all of these are true:

- at least two meaningfully different approaches are viable;
- the decision is consequential enough that future implementation or review must respect it;
- the selected direction is surprising or difficult to reconstruct without the tradeoff context;
- the comparison is grounded in current project evidence rather than invented alternatives.

When only one approach is viable, state the constraining reason and return `no-op` without creating a ceremonial ADR.

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

When unsure, return `needs-user` with the threshold uncertainty instead of writing a committed decision. An explicitly requested draft may use status `Proposed`, but it must remain clearly undecided.

## Location

Use the canonical SDD ADR location:

```text
<project-root>/docs/adrs/yyyy-mm-dd-decision-title.md
```

Use the local shell date for `yyyy-mm-dd`. Keep the slug short and decision-oriented.

If the project has no `docs/adrs/`, create it only when the user has asked to draft or capture the ADR. Do not create ADR folders just because an idea might eventually need one. A deliberately different ADR root requires modifying this skill and the managed workflow source; an `AGENTS.md` path override alone is not sufficient.

## Workflow

1. Resolve project root and decision context.
   - Start from the `/sdd-gather-context` result.
   - If invoked from another skill, preserve the stable Change ID, progressive planning context, focused decision question, relevant constraints, and approaches already discovered.
2. Establish the real choice.
   - Confirm that at least two meaningfully different approaches remain viable under current evidence. Do not invent alternatives merely to justify an ADR.
   - Compare viable options and their tradeoffs, recommend one, and ask the user to settle the choice. A clear selection or acceptance already given by the user in the current discussion counts as confirmation; otherwise do not silently choose.
   - If context is insufficient, return `blocked`. If the choice or ADR threshold remains unresolved, return `needs-user`. When invoked by `/sdd-change`, the Change remains `proposed` until the choice is settled.
3. Apply the ADR threshold.
   - If the decision does not warrant an ADR, return `no-op` with the selected direction, constraining reason or tradeoff summary, and caller follow-up for the technical-planning sections of `change.md` or the exploration record.
   - If an ADR is warranted but the user requested only a draft, write a clearly undecided candidate with status `Proposed` and return `needs-user`.
4. Create or update the ADR after confirmation.
   - Use `assets/adr-template.md`.
   - Preserve existing ADR status unless the user or project workflow explicitly changes it.
   - Use status values that match the project when present; otherwise use `Proposed`, `Accepted`, `Superseded`, or `Rejected`.
5. Link repository-owned truth.
   - Link related Changes by stable Change ID, and link repository-local Epics, Stories, Requirements, Scenarios, PRs, or implementation evidence when known. Never put a private absolute central Change path in a repository-local ADR.
   - Return the repository ID, repository-relative ADR path, selected direction, and binding consequences to the caller. The caller owns any corresponding update to `change.md`, an exploration record, or a Requirement slice; do not mutate those artifacts from this skill.
6. Verify the ADR.
   - Re-read the ADR.
   - Confirm it states context, decision, options considered, consequences, validation, and reconsideration signals.
   - Confirm it does not include secrets, private credentials, raw environment values, speculative roadmap promises, or unrelated private notes.
7. Stop at the decision boundary.
   - Do not plan a Change, edit `tasks.md`, update Epic behavior, implement code, review, commit, release, or invoke the next workflow automatically.
   - Return control to the caller. Any recommended next workflow is a terminal handoff for this invocation.

## Content Rules

- State the decision plainly.
- Include options considered and why the selected option won.
- Record tradeoffs honestly; an ADR with no downside is usually weak.
- Name validation evidence needed to prove the decision works.
- Include "Reconsider When" so future agents know when the decision may be stale.
- Keep ADRs concise. Put implementation progress in the central Change's `tasks.md`, not in the ADR.
- Refer to related Changes by stable Change ID, not by an installation-specific absolute `<workspace>/.sdd/changes/...` path.
- Keep Epic/Story truth authoritative for behavior. ADRs explain technical decisions and constraints, not user behavior truth.

## Result Contract

Return exactly one status:

- `complete` — the decision was confirmed and the warranted ADR was created or updated;
- `no-op` — the assessment completed but no ADR mutation was warranted or the existing ADR already expresses the confirmed decision;
- `needs-user` — the choice, threshold judgment, or requested draft remains undecided;
- `blocked` — setup or evidence is insufficient to assess the decision safely;
- `routed` — the discovered issue belongs to another workflow, such as behavioral scope returning to `/sdd-change`.

Summarize:

- result status and why
- repository ID and ADR path, when one exists
- ADR status
- selected or unresolved decision
- viable options considered and decisive tradeoffs
- links to related stable Change IDs and repository-local SDD artifacts
- caller-owned follow-up for `change.md`, an exploration record, Requirement-slice constraints, Epic truth, or review
- recommended next workflow, if any

An ADR result is terminal for this invocation. Return the selected direction and reference without implementing it or crossing into the caller's artifact boundary.
