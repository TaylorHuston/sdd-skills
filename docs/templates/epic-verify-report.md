---
kind: sdd-epic-verify-report
epic: EPIC-ID
epic_path: docs/epics/key-000-epic-name/epic.md
created: yyyy-mm-dd
result: aligned
mode: default
---

# Epic Verify: EPIC-ID Epic Name

## Verdict

- Result: `aligned / changes-requested / needs artifact fix / needs implementation / needs verification / needs product decision / blocked`
- App root:
- Epic:
- Branch/ref:
- Delegation:
- Report mode:

## Gate Scorecard

| Gate | Result | Notes |
|---|---|---|
| SDD workflow adherence | TBD | TBD |
| Epic coherence | TBD | TBD |
| Epic template adherence | TBD | Include scoped `sdd validate` result. |
| Story shape | TBD | TBD |
| Story requirement completeness | TBD | TBD |
| Story reference traceability | TBD | TBD |
| Canonical map authority | TBD | Confirm exactly one current implementation map and one current verification map per Story. |
| Cold code navigation | TBD | Confirm primary source locations and stable anchors are usable from the Epic alone. |
| Semantic anchor ownership | TBD | Confirm anchors resolve to governing definitions/registrations, not imports, call sites, incidental handlers, or generic tokens. |
| Reverse traceability inventory | TBD | Include the full Epic-scoped current-working-tree inventory command and candidate classifications. |
| Requirement and Scenario truth | TBD | TBD |
| Implementation drift | TBD | TBD |
| Verification strength | TBD | TBD |
| Supporting truth freshness | TBD | Check Outcome tense, README/current-state docs, and active/closed Change claims. |
| Change status traceability | TBD | TBD |
| Docs and product alignment | TBD | TBD |
| Security and data safety | TBD | TBD |

## Behavior And Verification Matrix

| Story | Requirement | Scenario | Implementation State | Primary Location / Anchor | Implementation Gap | Verification State | Current Evidence | Evidence Type | Check Run | Result | Verification Gap |
|---|---|---|---|---|---|---|---|---|---|---|---|
| EPIC-ID/S1 | R1 | R1-S1 | TBD | TBD | TBD | TBD | TBD | focused automated test / broad supporting gate / deterministic E2E / live-provider playtest / manual UI confirmation / debug-log inspection / TBD | TBD | TBD | TBD |

## Findings

### BLOCKING

- None.

### REQUIRED

- None.

### SUGGESTION

- None.

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

## Tests And Checks

| Command / Scenario | Result | Proves | Notes |
|---|---|---|---|
| `sdd validate <space-id> --epic <epic-id> --repo <repository> --json` | TBD | Deterministic Epic shape, IDs, Story Index, traceability tables, evidence references, and artifact links. | Required structural baseline. |
| `python3 <sdd-orphan-audit-script> <app-root> --epic <epic-id> --format json` | TBD | Full reverse inventory of implementation and test candidates against Epic evidence. | Required; skipping blocks `aligned`. |
| TBD | TBD | TBD | TBD |

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
