# Design: Harden Audit Report Integrity

## Current Understanding

Free-form audit prose cannot safely distinguish current failures from historical failures. Epic `modified` freshness can only be validated deterministically when the caller supplies a Git baseline. Release scope must be reconciled from the actual staged or PR diff, not only from an intended file list.

## Technical Approach

- Introduce `sdd-epic-verify-report-v1` with explicit current findings, historical snapshot, remediation, and current-check sections.
- Validate versioned reports only, preserving compatibility with legacy unversioned reports.
- Require an aligned report to have passing/not-applicable current gates, no current blocking or required findings, coherent verdict metadata, and passing required checks.
- Resolve optional `supersedes` links within the same Epic review directory and reject missing or unsafe lineage targets.
- Add `sdd validate --changed-from <commit-ish>` and compare baseline Epic content to the working tree while ignoring only top-level `modified` and `last_verified` metadata.
- Update release and PR workflows to compute an exact source-to-target file allowlist and classify every unexpected path before publication.

## Affected Epic Truth

| Epic | Story | Requirement / Scenario | Impact | Needed Update |
|---|---|---|---|---|
| SDD-E001 | S1 | New report-coherence and metadata-freshness scenarios | Requirement refinement | Add implementation and verification evidence after the validator is green. |
| SDD-E001 | S5 | New immutable-report and exact publication-scope scenarios | New Story | Map packaged skill/template behavior and its contract tests. |

## Alternatives / Deferred

- Keyword scanning legacy reports is rejected because historical prose creates false positives.
- Automatic Git-baseline inference is deferred because it would make validation dependent on branch policy and repository topology.
- Rename detection across Epic paths is deferred; a newly absent baseline path is treated as a new Epic.

## Open Questions

- None.
