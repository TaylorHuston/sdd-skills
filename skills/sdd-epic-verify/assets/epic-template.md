---
id: EPIC-ID
status: draft
created: yyyy-mm-dd
modified: yyyy-mm-dd
last_verified:
stories:
  - S1
---

# EPIC-ID Epic Name

## Product Context

- PRD: `<planning-root>/prd.md`
- Related docs:
- Related ADRs:

Briefly explain why this capability exists and what product direction constrains it.

## Outcome

Users can... [one concise paragraph describing the accepted capability outcome].

## Current Scope

- In-scope behavior the embedded Stories currently own.
- Include important API, backend, client, data, auth, or integration boundaries when they affect ownership.

## Deferred Scope

- Explicitly out-of-scope or later behavior.
- Link to another Epic when ownership is known.

## Candidate Stories

Candidate Stories are planning signals only. They are not accepted Epic/Story truth until promoted into `## Stories`, and they do not receive `S#` labels until promotion.

| Candidate | Status | Story Shape | Acceptance Signals |
|---|---|---|---|
| `TBD-short-name` | proposed/deferred | As a..., I want..., so that... | Observable signals that would justify promotion. |

## Story Index

| Story | Status | Capability | Last Verified | Notes |
|---|---|---|---|---|
| S1 | draft | Short user-path summary. |  |  |

## Stories

### Story S1: Story Title

Status: draft
Created: yyyy-mm-dd
Modified: yyyy-mm-dd
Last verified:

As a `<actor>`, I want to `<action/path>`, so that `<user-facing outcome>`.

#### Requirements And Scenarios

##### Requirement R1: Requirement Name

The system SHALL describe one durable behavior rule.

###### Scenario R1-S1: Scenario Name

- WHEN a concrete condition or action occurs
- THEN an observable result happens
- AND optional additional observable result happens

###### Scenario R1-S2: Failure Or Edge Case Name

- WHEN an important failure, empty, validation, permission, recovery, migration, or security-sensitive case occurs
- THEN the observable result or explicit gap is clear

#### Implemented By

| Path | Role | Recheck Trigger |
|---|---|---|
| `src/path/file.ts` | Primary/supporting/test/support | Recheck when... |

#### Verified By

| Requirement / Scenario | Evidence | Proves | Status |
|---|---|---|---|
| S1/R1-S1 | `tests/path.test.ts` - `test name` | Specific behavior assertion. | Passing yyyy-mm-dd |
| S1/R1-S2 | Manual/browser/review artifact or `tests/path.test.ts` - `test name` | Specific failure or edge-case proof. | Pending / Passing / Gap |

#### Verification Gaps

- None remaining.
- Or: `S1/R1-S2` lacks production-path proof because...

#### Story Notes

- Durable context future implementers need.
- Avoid chronological command history here; put command logs in change `tasks.md`.

## Cross-Story Concerns

- Shared auth, data, API, UI, migration, security, sequencing, or dependency concerns.

## Open Decisions

- Decision still needed, with owner/context if known.

## Completion Criteria

This Epic is healthy when:

- Embedded Stories cover the current scope.
- Requirements and Scenarios describe implemented behavior or intentional gaps.
- `Implemented By` points to the important starting files.
- `Verified By` maps concrete evidence to Requirements/Scenarios; automated evidence names existing repository-relative test paths.
- `Verification Gaps` are real, current, and explicit.
- Related changes, docs, indexes, reviews, and release communication do not contradict this Epic.

## Notes

- Migration notes, naming conventions, generated-index notes, or historical context.
