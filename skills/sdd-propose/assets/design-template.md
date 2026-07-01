# Design: CHANGE TITLE

## Context

Describe current behavior and the product or technical context needed to review the change.

## Goals / Non-Goals

**Goals:**

- TBD.

**Non-Goals:**

- TBD.

## Epic Changes

### Create Epic: EPIC TITLE

Use this section only when the change proposes a new Epic.

- Proposed directory: `docs/epics/<key>-<###>-epic-name/`
- Proposed file: `docs/epics/<key>-<###>-epic-name/epic.md`
- Supporting artifacts may later live beside `epic.md` in the same Epic directory.

#### Epic

Describe the broader user or system journey in one concise narrative.

#### Story STORY-ID: STORY TITLE

As a ACTOR, I want to CAPABILITY, so that OUTCOME.

##### R1: REQUIREMENT TITLE

The system SHALL describe one durable behavior rule.

###### Scenario R1-S1: SCENARIO TITLE

- WHEN a concrete condition or action occurs
- THEN an observable result happens
- AND optional additional observable result happens

##### Implemented By

Not implemented yet.

##### Verified By

Not verified yet.

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

## Epic File Rules

- Stories live inside the Epic `epic.md` file.
- Do not create `docs/stories/` or individual Story files.
- Preserve the Epic directory as the future home for supporting artifacts such as mockups, screenshots, research, or design notes.
- Epics and Stories are durable but revisable; Stories may be renamed, reordered, split, merged, or moved between Epics as the product matures.
- Treat Story moves as explicit Epic changes that name the source Epic, destination Epic, preserved or changed Story ID, and affected Requirements/Scenarios.
- Keep Story IDs stable even when Story titles change or Stories move between Epics, such as `OD-010`.
- Keep Story IDs unique across active Epics in the app. Before assigning a new Story ID, scan `docs/epics/**/epic.md` for existing IDs.
- Restart Requirement IDs inside each Story: `R1`, `R2`, `R3`.
- Scope Scenario IDs to their Requirement: `R1-S1`, `R1-S2`, `R2-S1`.
- Do not use generic Scenarios such as "WHEN this Story's workflow is exercised"; name the real trigger, state, failure mode, or observable condition.

## Technical Approach

Describe the chosen technical approach at the level needed to review and implement safely. Keep this high-level: architecture, data ownership, API/routes/functions, UI integration, auth/security, state transitions, dependencies, migrations, rollout, and verification strategy when relevant. For a small change, a short paragraph is enough.

## Alternatives Considered

- Option:
  - Why not:

## Why This Approach

Explain why the chosen approach is the right fit for this change.

## Implementation Constraints

- None identified yet.

## Verification Strategy

- Describe the proof needed for the user-visible Requirements and risky technical boundaries.

## Decisions

- None yet.

## Risks / Trade-Offs

- None identified yet.
