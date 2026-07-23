# Proposal: Harden Audit Report Integrity

## Why

Recent review feedback showed that a remediation report can claim an Epic is aligned while still presenting pre-remediation failures as current, that substantive Epic edits can leave `modified` metadata stale, and that a package can ship substantial workflow or documentation behavior without giving it a durable Story owner. Release preparation also needs a deterministic way to prove that the exact candidate matches the declared scope.

The accepted outcome is broader than report validation alone: the package should give a future developer or agent a reliable map from each shipped CLI, workflow, and public-guide behavior to the Epic/Story that owns it and the proof that keeps it trustworthy.

## What Changes

- Versioned Epic verification reports have one coherent runtime/template contract, explicit current and historical state, safe lineage, and Epic-scoped proof.
- PR, release, and orphan-audit workflows resolve and classify immutable Git scope without accepting option-like input or hanging indefinitely.
- Planning, Apply, Review, Design, and Interactive workflows have durable ownership for their persistence, evidence, risk, lifecycle, and rendered-verification behavior.
- The public one-page guide has durable ownership for its methodology/reference split, durable-Story explanation, responsive navigation, copy interaction, and accessible Steel documentation presentation.
- The earlier trust-boundary Change remains the owner of its implementation corrections; this Change records the coordination boundary rather than duplicating S2/S3 work.

## Target Repositories

- `/Users/taylor/src/my-life/spaces/sdd-skills` (`sdd-skills`, repository-only context).

## Epic Actions

### New Epic Directories

- None.

### Existing Epic Directory Updates

- Update `docs/epics/sdd-e001-reliable-cli-operations/epic.md`.

## Epic Story Changes

- Modify `SDD-E001/S1` without renumbering its existing Requirements: extend R4 with missing-schema, canonical gate-set, Epic-scoped proof, and complete lineage Scenarios.
- Modify `SDD-E001/S5`: preserve immutable audit and exact handoff behavior, add safe immutable Git-baseline handling for packaged audit scripts, and make the validator/template contract explicit across the S1/S5 boundary.
- Add `SDD-E001/S6` **Reliable Workflow Execution** for the package behavior implemented by Planning, Apply, Review, Design, Interactive, their templates, and shared doctrine.
- Add `SDD-E001/S7` **Accessible Public Methodology Reference** for the one-page guide's content model, navigation, copy feedback, responsive behavior, accessibility, and Steel presentation.
- Do not move or duplicate `SDD-E001/S2` or `SDD-E001/S3`. Concurrency, physical containment, and repository-only topology defects remain remediation work in `2026-07-20-harden-cli-trust-boundaries`.

## Scope Decisions

- Confirmed:
  - Existing Stories are updated when their behavior changes; S6 and S7 are new because they describe distinct durable developer outcomes, not because new files appeared.
  - Workflow skills are shipped product behavior rather than incidental prose.
  - The public site is a user-facing package surface and owns observable interaction/accessibility behavior; visual tokens remain presentation detail supporting that Story.
  - The same cumulative candidate may require both active Changes, but each implementation defect has one owning Change.
- Deferred:
  - Rewriting legacy reports, automatic Git-baseline inference, cross-repository report storage, automated staging, and destructive repair of historical artifacts.
  - Optional favicon and touch-highlight polish unless Apply accepts them as small S7 refinements.
- Assumptions:
  - `SDD-E001` remains the correct Epic because all affected behavior supports reliable use of the SDD package and CLI.
  - No new ADR is required; this replan clarifies existing package boundaries rather than introducing a durable architecture choice.
- User decisions that shaped the Story/Requirement split:
  - Stories are durable behavior records, not completed tasks.
  - A developer or LLM should be able to find what was implemented, where it lives, and what proves it.
  - UI changes require direct rendered inspection while owner acceptance remains a separate status.

## Change Folder

- Planned location: not applicable; this is an active repository Change.
- Active location: `docs/changes/2026-07-22-harden-audit-report-integrity/`
- Closed location: `docs/changes/closed/2026-07-22-harden-audit-report-integrity/`

## Impact

- Product: reliable reports, complete workflow ownership, and a navigable public explanation of the methodology.
- Code: report validation and packaged orphan-audit boundaries in this Change; trust-boundary CLI remediation remains coordinated through the earlier Change.
- Tests: focused falsification for every report/Git boundary, package contract tests for S5/S6, and deterministic browser/static checks for S7.
- Docs: Epic S1/S5/S6/S7, workflow doctrine, templates, README, changelog, one-page guide, both active Change ledgers, and review records.
- ADRs: not applicable.

## Release Communication Impact

- Required: yes.
- Record / section: `CHANGELOG.md` Unreleased, `README.md`, and the public one-page guide.
- Public summary: report validation and handoffs fail closed at their real boundaries; agent workflows persist through complete evidence-backed handoff; the public guide exposes the durable methodology and package implementation clearly.

## Open Questions

- None. The independent review supplied the missing ownership and verification constraints, and the existing Epic has unambiguous room for S6 and S7.
