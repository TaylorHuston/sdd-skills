---
schema: sdd-epic-verify-report-v1
kind: sdd-epic-verify-report
epic: EPIC-ID
epic_path: docs/epics/key-000-epic-name/epic.md
created: yyyy-mm-dd
initial_result: blocked
result: blocked
mode: default
audited_ref: COMMIT-SHA
verified_ref: COMMIT-SHA
supersedes: null
---

# Epic Verify: EPIC-ID Epic Name

## Verdict

- Initial result: `blocked`
- Current result: `blocked`
- App root:
- Epic:
- Audited ref:
- Verified ref:
- Delegation:
- Report mode:
- Aggregate/runtime verification required: yes / no
- Trigger or not-applicable reason:
- Project-defined aggregate command or authoritative constituent source:

## Current Gate Scorecard

Use only `pass`, `findings`, `blocked`, or `not applicable`. `aligned` requires every current gate to be `pass` or `not applicable`.

| Gate | Result | Notes |
|---|---|---|
| SDD workflow adherence | blocked | Replace with the current result. |
| Epic coherence | blocked | Replace with the current result. |
| Epic template adherence | blocked | Include scoped `sdd validate` result. |
| Story shape | blocked | Replace with the current result. |
| Story requirement completeness | blocked | Replace with the current result. |
| Story reference traceability | blocked | Replace with the current result. |
| Canonical map authority | blocked | Confirm exactly one current implementation map and one current verification map per Story. |
| Cold code navigation | blocked | Confirm primary source locations and stable anchors are usable from the Epic alone. |
| Semantic anchor ownership | blocked | Confirm anchors resolve to governing definitions/registrations, not imports, call sites, incidental handlers, or generic tokens. |
| Reverse traceability inventory | blocked | Include the full Epic-scoped current-working-tree inventory command and candidate classifications. |
| Requirement and Scenario truth | blocked | Replace with the current result. |
| Implementation drift | blocked | Replace with the current result. |
| Verification strength | blocked | Replace with the current result. |
| Aggregate/runtime verification scope | blocked | Record the required exact-ref gate or why it is not applicable. |
| Supporting truth freshness | blocked | Check Outcome tense, README/current-state docs, and active/closed Change claims. |
| Change status traceability | blocked | Replace with the current result. |
| Docs and product alignment | blocked | Replace with the current result. |
| Security and data safety | blocked | Replace with the current result. |

## Behavior And Verification Matrix

| Story | Requirement | Scenario | Implementation State | Primary Location / Anchor | Implementation Gap | Verification State | Current Evidence | Evidence Type | Check Run | Result | Verification Gap |
|---|---|---|---|---|---|---|---|---|---|---|---|
| EPIC-ID/S1 | R1 | R1-S1 | TBD | TBD | TBD | TBD | TBD | focused automated test / broad supporting gate / deterministic E2E / live-provider playtest / manual UI confirmation / debug-log inspection / TBD | TBD | TBD | TBD |

## Current Findings

### BLOCKING

- Replace with current findings or `None.`

### REQUIRED

- Replace with current findings or `None.`

### SUGGESTION

- None.

## Initial Findings (Historical)

- Record the initial audit snapshot. Do not present remediated failures as current findings.

## Remediation And Recheck

- Record remediation completed before the current verdict and the gates rerun afterward. Use `No remediation was required.` when the result did not change.

## Drift Summary

- Doctrine drift:
- Template drift:
- Artifact drift:
- Implementation drift:
- Requirement drift:
- Verification drift:
- Canonical-map drift:
- Semantic-anchor drift:
- Reverse-traceability drift:
- Scope drift:
- Product drift:
- Lifecycle drift:
- Superseded-truth drift:
- Security drift:

## Current Tests And Checks

| Command / Scenario | Result | Proves | Notes |
|---|---|---|---|
| `sdd validate <space-id> --epic <epic-id> --repo <repository> --changed-from <audited-ref> --json` | blocked | Deterministic current Epic/report shape, IDs, traceability, evidence, artifact links, and Git-relative `modified` freshness. | Required structural baseline. |
| `python3 <sdd-orphan-audit-script> <app-root> --epic <epic-id> --format json` | blocked | Full reverse inventory of implementation and test candidates against Epic evidence. | Required; skipping blocks `aligned`. |
| Project-defined aggregate command or authoritative equivalent | blocked / not applicable | Current runtime confidence across the audited scope on `verified_ref`. | Record meaningful execution/count and cache/freshness evidence, or the not-applicable reason. |
| TBD | blocked | TBD | Mark required checks explicitly. |

## Reverse Traceability

- Inventory scope:
- Missing evidence references:
- Source candidates classified:
- Test candidates classified:
- Test-support exclusions reviewed:
- Framework/configuration/generated exclusions reviewed:
- Gaps or cleanup routed:

## Delegated Audits

- Epic coherence:
- Story audits:
- Claims verified by main agent:

## Remediation Plan

| Finding | Recommended Workflow | Owner Decision Needed |
|---|---|---|
| TBD | `ask to apply safe artifact fixes / sdd-change --brief or --plan -> sdd-apply -> sdd-review / sdd-prd / manual decision` | TBD |

## Evidence Inspected

- Epic:
- Change artifacts:
- Code:
- Tests:
- Anchor definitions/registrations and exact assertions opened:
- Docs:
- Project-defined supporting-doc inventory:
- PRD/Product Brief:

## Residual Risks

- None.

## Next Action

- TBD.
