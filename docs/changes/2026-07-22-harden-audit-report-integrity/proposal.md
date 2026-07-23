# Proposal: Harden Audit Report Integrity

## Why

Recent review feedback showed that a remediation report can claim an Epic is aligned while still presenting pre-remediation failures as current, and that substantive Epic edits can leave `modified` metadata stale. Release preparation also needs a deterministic way to prove that staged files match the declared scope.

## Interactive Scope Boundary

- In scope: versioned Epic verification reports with explicit current and historical state; validator checks for report/result coherence and report lineage; opt-in Git-relative Epic metadata validation; exact release and PR file-scope reconciliation; package skills, templates, doctrine, tests, README, changelog, and public one-page guide.
- Also in scope: reconcile the pre-existing trust-boundary Change ledger after its implementation commit made the recorded commit blocker stale.
- Out of scope: rewriting legacy reports, enforcing date freshness without an explicit Git baseline, changing application repositories, or automating Git staging.
- Stop and route to `/sdd-change --plan` if: the work requires a broader report storage migration, a new cross-repository state model, or destructive repair of historical artifacts.

## Epic / Story Impact

- Known affected Epics: `SDD-E001`.
- Known affected Stories: `S1` Trustworthy Artifact Validation and `S5` Trustworthy Audit And Handoff Guidance.
- Unknown until implementation: none.

## Epic Actions

- Update `docs/epics/sdd-e001-reliable-cli-operations/epic.md` Story S1 with current-report coherence and Git-relative metadata-freshness Requirements, and add Story S5 for immutable audit-report and exact-diff handoff guidance.

## Release Communication Impact

Update the package README, Unreleased changelog, and public one-page guide because the validator and review/handoff workflows gain new user-visible contracts.

## Open Questions

- None. The user approved applying the reviewed workflow improvements.
