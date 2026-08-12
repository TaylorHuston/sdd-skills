# Canonical Template Examples

These examples mirror the canonical template assets shipped inside the packaged SDD skills. They are copied here for easy browsing; when changing a template, update the skill asset and its matching docs example together.

| Template | Docs Example | Source Asset | Used By |
|---|---|---|---|
| ADR | [adr.md](adr.md) | `skills/sdd-adr/assets/adr-template.md` | `/sdd-adr`, `/sdd-change` ADR routing |
| Change intent | [change.md](change.md) | `skills/sdd-change/assets/change-template.md` | `/sdd-change`, `/sdd-interactive` subset |
| Change planning sections | [planning-sections.md](planning-sections.md) | `skills/sdd-change/assets/planning-sections.md` | Appended to `change.md` by `/sdd-change`; `/sdd-design` updates `Experience Design` |
| Changelog | [changelog.md](changelog.md) | `skills/sdd-apply/assets/changelog-template.md` | `/sdd-apply`, `/sdd-release` |
| Epic | [epic.md](epic.md) | `skills/sdd-apply/assets/epic-template.md` | `/sdd-change`, `/sdd-apply`, `/sdd-epic-verify` |
| Epic verification report | [epic-verify-report.md](epic-verify-report.md) | `skills/sdd-epic-verify/assets/epic-verify-report-template.md` | `/sdd-epic-verify` |
| Orphan audit report | [orphan-audit-report.md](orphan-audit-report.md) | `skills/sdd-orphan-audit/assets/orphan-audit-report-template.md` | `/sdd-orphan-audit` |
| Code audit report | [code-audit-report.md](code-audit-report.md) | `skills/sdd-code-audit/assets/code-audit-report-template.md` | `/sdd-code-audit` |
| Product Brief / PRD | [prd.md](prd.md) | `skills/sdd-prd/assets/canonical-prd-template.md` | `/sdd-prd` |
| Tasks ledger | [tasks.md](tasks.md) | `skills/sdd-change/assets/tasks-template.md` | `/sdd-change`, `/sdd-design --revise`, `/sdd-apply`, `/sdd-interactive` subset |
| Review report | [review.md](review.md) | `skills/sdd-review/assets/review-template.md` | `/sdd-review` |
| Release PR | [release-pr.md](release-pr.md) | `skills/sdd-release/assets/release-pr-template.md` | `/sdd-release` |

Duplicate skill-local assets, such as the Epic or changelog template copies, should stay byte-identical unless a skill intentionally needs a different template.
