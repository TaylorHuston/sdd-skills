# Design: CHANGE TITLE

## Context

Describe current behavior and the product or technical context needed to review the change.

## Goals / Non-Goals

**Goals:**

- TBD.

**Non-Goals:**

- TBD.

## Planning Interview / Story Refinement

- Scope boundary reviewed:
- User decisions:
- Assumptions:
- Deferred scope:
- Story boundaries challenged:
- Requirements refined:
- Scenario gaps considered:
- Open questions that block implementation:

## Epic Changes

### Create Epic: EPIC TITLE

Use this section only when the change proposes a new Epic.

- Proposed directory: `docs/epics/<key>-<###>-epic-name/`
- Proposed file: `docs/epics/<key>-<###>-epic-name/epic.md`
- Supporting artifacts may later live beside `epic.md` in the same Epic directory.

#### Epic

Describe the broader user or system journey in one concise narrative.

#### Story S1: STORY TITLE

As a ACTOR, I want to CAPABILITY, so that OUTCOME.

##### Requirement R1: REQUIREMENT TITLE

The system SHALL describe one durable behavior rule.

###### Scenario R1-S1: SCENARIO TITLE

- WHEN a concrete condition or action occurs
- THEN an observable result happens
- AND optional additional observable result happens

##### Implemented By

Not implemented yet.

##### Verified By

Not verified yet.

When implemented, replace this with a scenario-mapped evidence index, not a command log:

- `path/to/test-or-check`
  - Covers `EPIC-ID/S1/R1-S1`: short behavior or assertion summary.
- Supporting gate: `command` passed for the implementing change.

##### Verification Gaps

- Implementation and verification are pending.

### Update Epic: EXISTING EPIC TITLE

Use this section only when the change proposes edits to an existing Epic.

- Target Epic: `docs/epics/<key>-<###>-epic-name>/epic.md`
- Change Type: added / modified / removed scope

#### Story Changes

- Added:
- Modified:
- Removed:

#### Supersedes / Reconciles

- Earlier Story, Requirement, Scenario, or boundary wording this change supersedes:
- Story implementation/verification state, `Implemented By`, `Implementation Gaps`, `Verified By`, or `Verification Gaps` entries that must be rewritten or reclassified:
- Closed or active Change artifacts likely to need status cleanup:
- Manual confirmation status updates expected:

## Epic File Rules

- Stories live inside the Epic `epic.md` file.
- Do not create `docs/stories/` or individual Story files.
- Preserve the Epic directory as the future home for supporting artifacts such as mockups, screenshots, research, or design notes.
- Use `assets/epic-template.md` as the canonical target shape for new or normalized Epic files.
- Epics and Stories are durable but revisable; Stories may be renamed, reordered, split, merged, or moved between Epics as the product matures.
- Treat Story moves as explicit Epic changes that name the source Epic, destination Epic, old full Story reference, new full Story reference, and affected Requirements/Scenarios.
- For new or normalized Epics, use Epic-scoped Story labels such as `S1`, `S2`, and `S3`. Full references include the Epic ID, such as `EPIC-ID/S1`.
- Preserve legacy app-wide Story IDs, such as `OD-010`, only when existing tests, reviews, generated indexes, commits, or migration history depend on them.
- Keep `S#` labels unique within each Epic. Before assigning a new label, scan the target Epic for existing labels.
- Restart Requirement IDs inside each Story: `R1`, `R2`, `R3`.
- Scope Scenario IDs to their Requirement: `R1-S1`, `R1-S2`, `R2-S1`.
- Do not use generic Scenarios such as "WHEN this Story's workflow is exercised"; name the real trigger, state, failure mode, or observable condition.
- Keep exactly one canonical `Implemented By` and one canonical `Verified By` section per Story. Consolidate still-current rows from prior/detailed/legacy maps; retain historical explanation only in `Story Notes`.
- Plan narrower Requirement/Scenario rows when route/auth, application policy, persistence, provider/runtime configuration, deployment, or presentation have distinct governing owners.
- Require implementation anchors to identify behavior-owning definitions, registrations, or configuration rather than imports, call sites, incidental handlers, or broad file tokens.
- Require automated evidence anchors to name an exact test title or stable named test anchor, never generic syntax such as `#it(`, `#test(`, or `#describe(`.

## Technical Options

Use this section for non-trivial changes. If only one path is reasonable, record why the choice is obvious.

### Option 1: OPTION NAME

- Summary:
- User impact:
- Implementation complexity:
- Reversibility:
- Client surfaces:
- API / contract shape:
- Frontend/backend boundary:
- Data / schema impact:
- Auth / security impact:
- Testability:
- Operational risk:
- Fit with project conventions:

### Option 2: OPTION NAME

- Summary:
- User impact:
- Implementation complexity:
- Reversibility:
- Client surfaces:
- API / contract shape:
- Frontend/backend boundary:
- Data / schema impact:
- Auth / security impact:
- Testability:
- Operational risk:
- Fit with project conventions:

## Selected Approach

Describe the chosen technical approach at the level needed to review and implement safely. Keep this high-level: architecture, data ownership, API/routes/functions, UI integration, auth/security, state transitions, dependencies, migrations, rollout, and verification strategy when relevant. For a small change, a short paragraph is enough.

## Experience Design

Use this section only when the Change has material UI or interaction design. Remove it when it does not apply; use `/sdd-design` when the direction needs user-guided convergence.

- Applicability: required / not required
- Confirmed direction:
- User confirmation:
- Reference artifacts:

### User Flow And Information Architecture

### Responsive Composition

### Component And State Contract

#### Component Strategy

Record only materially affected components or patterns. Use `existing application component`, `adopted reference`, `application-specific`, `reference candidate`, or `deliberate divergence`. A reference candidate does not create a cross-repository dependency unless this Change explicitly says so.

`Required Preview States` names the states that need evidence, not a required tool. Evidence may come from component previews, rendered routes or fixtures, browser checks, or a manual walkthrough.

| Component Or Pattern | Strategy | Initial Owner Or Reference | Required Preview States | Follow-Up |
|---|---|---|---|---|
| TBD | TBD | TBD | TBD | TBD |

### Accessibility And Interaction

### Visual Direction

### Open Design Questions

## Client And API Boundary

- Current clients:
- Plausible future clients:
- Reusable product capabilities:
- API or typed contract:
- OpenAPI plan, if HTTP-facing:
- Backend platform exposed directly to clients?:
- Client-specific presentation or local state:
- Rationale:

## Alternatives Considered

- Option:
  - Why not:

## Why This Approach

Explain why the chosen approach is the right fit for this change.

## ADRs

- Required: no / yes / candidate
- ADR path: `docs/adrs/yyyy-mm-dd-decision-title.md` or not applicable
- Decision summary:
- Reconsider when:

## Implementation Constraints

- None identified yet.

## Verification Strategy

- Describe the proof needed for the user-visible Requirements and risky technical boundaries.
- Separate evidence types instead of treating all proof as interchangeable:
  - Focused automated tests:
  - Broad supporting gates:
  - Deterministic E2E:
  - Live-provider or external-service playtests:
  - Manual UI confirmation:
  - Debug/log inspection:

## Decisions

- None yet.

## Risks / Trade-Offs

- None identified yet.
