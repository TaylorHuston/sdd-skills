---
schema: sdd-epic-v2
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

Describe current product truth: use present tense for implemented behavior, future tense only for wholly unimplemented behavior, and explicit current-plus-gap wording for partial behavior.

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

| Story | Implementation | Verification | Capability | Last Verified | Notes |
|---|---|---|---|---|---|
| S1 | not implemented | unverified | Short user-path summary. |  |  |

## Stories

### Story S1: Story Title

Implementation: not implemented
Verification: unverified
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

This is the Story's only authoritative current implementation map. Consolidate any still-current legacy or detailed maps here; keep historical explanation in `Story Notes`, never in a competing map.

Map every Requirement to its primary governing location after implementation. `primary` describes behavior ownership, not a physical layer; use narrower multiple primary rows when ownership genuinely splits across layers or Scenarios. Add supporting rows only for distinct adapter, persistence, presentation, configuration, migration, or support responsibilities. Prefer stable symbols, exports, routes, classes, or searchable anchors over line numbers. Point to the definition, registration, or configuration that owns the behavior—not merely an import, call site, incidental UI handler, broad file token, or a symbol cited because the same file owns something else.

| Requirement / Scenario | Location / Anchor | Kind | Responsibility |
|---|---|---|---|
| S1/R1 | Not implemented yet. | primary | Durable behavior owner after implementation. |

#### Implementation Gaps

- `S1/R1`: Not implemented yet.

#### Verified By

This is the Story's only authoritative current verification map. For automated evidence, use `path#exact test title or stable named test anchor` and name the important assertion, route, selector, injected failure, or observation. Never use a framework token such as `#it(`, `#test(`, or `#describe(`. Aggregate Scenarios only when the named proof explicitly exercises each one.

| Requirement / Scenario | Evidence | Proves | Status |
|---|---|---|---|

#### Verification Gaps

- `S1/R1-S1`: Not verified yet.
- `S1/R1-S2`: Not verified yet.

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
- Story implementation and verification state match the Story Index and their respective gap sections.
- `Implemented By` maps every implemented Requirement to a concrete repository-relative location and stable code anchor.
- Each Story has only one current `Implemented By` map and one current `Verified By` map; historical detail is consolidated or moved to notes.
- Primary anchors identify the behavior-owning definition, registration, or configuration, and distinct governing boundaries use narrower Requirement/Scenario rows.
- `Implementation Gaps` names accepted behavior that does not exist yet.
- `Verified By` maps concrete evidence to Requirements/Scenarios; automated evidence uses an existing repository-relative `path#exact test title or stable anchor`, and `Proves` names the important assertion or observation.
- Automated evidence does not use generic framework syntax anchors, and the cited proof actually asserts every mapped Scenario.
- `Verification Gaps` are real, current, and explicit.
- Related changes, docs, indexes, reviews, and release communication do not contradict this Epic.

## Notes

- Migration notes, naming conventions, generated-index notes, or historical context.
