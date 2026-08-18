# ADR: Use Risk-Triggered SDD Delivery

- Status: Accepted
- Date: 2026-08-17
- Related Change ID: `2026-08-17-replace-default-sdd-workflow`
- Related Epics / Stories: `SDD-E001/S6`, `SDD-E001/S7`

## Context

The current default stores candidate, Review, Scenario, visual, gap, acceptance, and commit facts across `tasks.md`, a fixed 14-gate slice Review, a Review digest, a closure receipt, repository evidence descriptors, and final Change Review. The package can mechanically cross-check those copies, but ordinary work pays the full cost even when most gates are irrelevant. This creates closure-only remediation and makes the workflow harder to explain and resume.

Two Home Hunt trials retained exact-candidate verification, independent Review, bounded remediation, gap honesty, manual-acceptance separation, and authority limits with only central `tasks.md` and `review.md` updates. The S13 trial also proved that a smaller process still discovers and closes a real missing-evidence finding.

The package now needs one durable default artifact and validation boundary. It must preserve historical evidence without maintaining two competing current workflows.

## Decision

Use one versioned, risk-triggered delivery contract as the default.

### Current artifacts

- `change.md` owns intent, lifecycle, technical planning, durable constraints, and expected risk triggers.
- `tasks.md` owns the adaptive vertical-outcome queue, dependencies, current status, and one replaceable Resume checkpoint. It does not duplicate candidate verdicts, gap disposition, or commit facts in separate ledgers.
- `review.md` owns exact candidate identity, the five universal gate results, behavior/Scenario coverage, executed triggered checks, findings, technical gaps and dated acceptance, manual product acceptance, remediation history, and the final reviewed commit/tree.

Use per-outcome sections inside the one `review.md`; do not introduce per-slice Review files or an archive threshold until real document-size evidence requires another projection. Final Change-wide Review updates the same current record rather than creating a second Review authority.

### Gate model

Every reviewed outcome executes five universal gates:

1. scope and exact candidate;
2. observable behavior;
3. fresh verification;
4. independent Spec Adherence and Implementation Quality review;
5. integrity and authority, including selective staging and reviewed-tree/final-tree equality.

Planning names expected triggered checks when behavior intersects UI/accessibility, security/privacy, persistence/migrations/contracts, concurrency/recovery/provider behavior, multi-repository integration, manual acceptance, or release. Review must execute every declared trigger and may add independently discovered triggers. A triggered check records its reason, concrete falsifiable check, result, and evidence. The CLI validates structural coverage and candidate relationships; Review owns semantic judgment about whether risks and evidence are sufficient.

### Version and compatibility boundary

New Changes identify the contract with `schema: sdd-change-v2` in `change.md` frontmatter. Schema-less existing Changes remain on the legacy validation path. Historical `sdd-slice-review-v1` and `sdd-slice-closure-v1/v2` readers remain available when those artifacts exist, but creation, planning, Apply, Review, and templates stop generating them for v2 Changes.

The replacement Change was created by the legacy CLI. It may use the existing planning transition as a bootstrap, but its implementation candidate must upgrade its own central records to v2 and complete without generating a new receipt, digest, descriptor, or closure-only commit.

### Delivery unit and reconciliation

Plan the smallest coherent vertical outcome that can be implemented, freshly verified, independently reviewed, and committed in one fresh session. One Requirement is a useful default, not a universal rule; combine behavior when separate completion would publish an incoherent contract and state why.

Reconcile Epic truth immediately only when the candidate changes accepted behavior, completes a Story, or changes a contract or gap consumed by later work. Otherwise defer reconciliation to Change completion. Manual product acceptance remains distinct from technical gaps and readiness.

The current full protocol remains a historical compatibility and implementation reference. Do not expose a second named high-assurance profile unless later evidence shows that behavior-derived triggers cannot reliably express a necessary escalation.

## Options Considered

### Fixed High-Assurance Default

- Summary: Keep mandatory ledgers, 14 gates, exact Scenario/visual closure tables, per-slice Reviews, hashes, receipts, and Git seals for every slice.
- Pros: Maximum deterministic cross-checking and explicit uniformity.
- Cons: Duplicates facts, forces irrelevant rows, creates closure-only repair, and makes ordinary delivery disproportionately expensive.

### Risk-Triggered Three-Artifact Default

- Summary: Keep five universal controls and add concrete checks only when behavior or boundaries trigger them, with one canonical owner for each current fact.
- Pros: Preserves the controls that found real defects while reducing drift, duplicate evidence, and ritual work; scales assurance with actual risk.
- Cons: Requires stronger reviewer judgment and focused tests that prevent declared or obvious triggers from disappearing.

### Configurable Standard And High-Assurance Profiles

- Summary: Ship both the simpler workflow and the current protocol as selectable profiles.
- Pros: Offers an explicit escalation bundle for sensitive work.
- Cons: Doubles documentation, validation, test, migration, and support paths before evidence proves the second profile necessary.

### Reviewer Judgment Without Structured Triggers

- Summary: Keep three artifacts but let Review choose checks without planned trigger declarations or structural validation.
- Pros: Smallest implementation and maximum flexibility.
- Cons: Makes under-review difficult to detect and weakens resumability and deterministic validation.

## Consequences

- Positive: ordinary Changes have three current records and one Review authority.
- Positive: assurance remains exact-candidate, evidence-based, independently reviewed, gap-honest, and authority-bounded.
- Positive: UI, security, migration, concurrency, provider, and integration risks still receive concrete checks when relevant.
- Positive: historical closure evidence remains readable without driving new artifact generation.
- Negative: the validator can prove declared structural coverage but cannot replace independent semantic judgment about omitted risks.
- Negative: the package must maintain a bounded legacy read path until historical v1/v2 records are deliberately retired.
- Negative: the replacement Change has a bootstrap interval where the installed legacy workflow and intended v2 contract differ.
- Follow-up: revise `SDD-E001/S6`, templates, packaged skills, validators, tests, doctrine, README/site guidance, and the replacement Change's own records together.

## Validation

Implementation and Review must prove:

- v2 Change creation, planning, transition, Apply, Review, and completion use only `change.md`, `tasks.md`, and `review.md` as current records;
- every v2 Review has all five universal gates, every declared trigger, exact candidate identity, coherent verdict/gaps, and final tree equality;
- undeclared independently discovered risks can be added without changing the schema;
- v2 completion rejects stale verification, missing independent review, required unaccepted gaps, unrelated staged files, candidate/tree mismatch, or unauthorized handoff;
- historical v1/v2 Review and receipt fixtures remain readable but are never generated for v2 Changes;
- the first source-changing replacement slice completes without a receipt, digest, descriptor, or closure-only commit;
- package tests, scoped validation, Doctor, package dry-run, managed-source synchronization, and applicable current-source guide rendering pass.

## Reconsider When

- repeated Reviews omit material risks despite explicit planning and independent-review duties;
- regulated or production evidence retention requires a stable assurance bundle beyond behavior-derived triggers;
- one `review.md` becomes measurably hard to navigate or update across real multi-slice or multi-repository Changes;
- legacy readers materially constrain maintenance after all known historical records are closed or converted;
- SDD becomes a hosted multi-user system whose evidence and signing requirements exceed Git plus workspace-central records.
