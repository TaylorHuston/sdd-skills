# Canonical Template Examples

These examples mirror the canonical template assets shipped inside the packaged SDD skills. They are copied here for easy browsing; when changing a template, update the skill asset and its matching docs example together.

| Template | Docs Example | Source Asset | Used By |
|---|---|---|---|
| ADR | [adr.md](adr.md) | `skills/sdd-adr/assets/adr-template.md` | `/sdd-adr`, `/sdd-change --plan` ADR routing |
| Change Brief | [brief.md](brief.md) | `skills/sdd-change/assets/brief-template.md` | `/sdd-change --brief` |
| Changelog | [changelog.md](changelog.md) | `skills/sdd-apply/assets/changelog-template.md` | `/sdd-apply`, `/sdd-release` |
| Epic | [epic.md](epic.md) | `skills/sdd-apply/assets/epic-template.md` | `/sdd-change --plan`, `/sdd-apply`, `/sdd-epic-verify` |
| Epic verification report | [epic-verify-report.md](epic-verify-report.md) | `skills/sdd-epic-verify/assets/epic-verify-report-template.md` | `/sdd-epic-verify` |
| Orphan audit report | [orphan-audit-report.md](orphan-audit-report.md) | `skills/sdd-orphan-audit/assets/orphan-audit-report-template.md` | `/sdd-orphan-audit` |
| Product Brief / PRD | [prd.md](prd.md) | `skills/sdd-prd/assets/canonical-prd-template.md` | `/sdd-prd` |
| Proposal | [proposal.md](proposal.md) | `skills/sdd-change/assets/proposal-template.md` | `/sdd-change --plan`, `/sdd-interactive` subset |
| Design | [design.md](design.md) | `skills/sdd-change/assets/design-template.md` | `/sdd-change --plan`, `/sdd-design --plan`, `/sdd-design --revise`, `/sdd-interactive` subset |
| Tasks ledger | [tasks.md](tasks.md) | `skills/sdd-change/assets/tasks-template.md` | `/sdd-change --plan`, `/sdd-design --revise`, `/sdd-apply`, `/sdd-interactive` subset |
| Review report | [review.md](review.md) | `skills/sdd-review/assets/review-template.md` | `/sdd-review` |
| Release PR | [release-pr.md](release-pr.md) | `skills/sdd-release/assets/release-pr-template.md` | `/sdd-release` |

Duplicate skill-local assets, such as the Epic or changelog template copies, should stay byte-identical unless a skill intentionally needs a different template.
