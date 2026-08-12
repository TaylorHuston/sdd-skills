## Current Context

Summarize current behavior and the product or technical context needed to review the plan.

## Behavioral Changes

Describe affected Epics, Stories, Requirements, and concrete Scenarios. Keep observable behavior distinct from implementation detail.

## Technical Decision Handoffs

When two or more meaningfully different viable technical approaches exist, invoke `/sdd-adr` and summarize its result here instead of duplicating the full option analysis.

- Decision question:
- Repository ID:
- `/sdd-adr` result: selected / unresolved
- Selected approach or unresolved state:
- ADR path: `docs/adrs/yyyy-mm-dd-decision-title.md` / not warranted / pending
- Reconsider when:

If only one path is viable, record the constraining reason here without invoking `/sdd-adr` ceremonially.

## Selected Approach

Describe the chosen technical approach at the level needed to review and implement safely. Include architecture, repository boundaries, data/contracts, dependencies, migrations, rollout, and security only when relevant.

## Experience Design

Use this section only when the Change has material UI or interaction design. Remove it otherwise. Record the confirmed direction, stable references, user flow, responsive composition, component/state contract, accessibility, and visual direction.

## Alternatives Considered

- None beyond any `/sdd-adr` handoff.

## Implementation Constraints

- None identified yet.

## Verification Strategy

Describe focused behavioral proof, risky boundary checks, broad supporting gates, rendered or manual evidence, and any required external environment.

## Risks / Trade-Offs

- None identified yet.
