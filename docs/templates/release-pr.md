# Release PR: <Title>

## Release Scope

- Source branch:
- Target branch:
- Changelog reviewed:
- Version decision: version update / no version update
- Current version:
- Suggested version and increment:
- User-confirmed release version/date:
- Included SDD changes:

## File Scope Reconciliation

- Source-to-target diff command/ref:
- Intended product paths:
- SDD and supporting-truth paths:
- Authorized release-metadata paths:
- Required generated paths:
- Excluded or unrelated paths: none
- Final allowlist match: pass / fail

## Release Communication

- Release communication updated:
- Public release notes summary:

## Verification

- Full e2e:
- Lint:
- Typecheck:
- Unit tests:
- Integration tests:
- Build:
- Migration/schema/codegen checks:
- Other:

## SDD Readiness

- `/sdd-review` status:
- Reviewed source commit:
- Cumulative release-candidate review required: yes / no
- Cumulative review trigger or proportional-scan reason:
- Cumulative reviewed commit, gates, and result:
- Latest reconciled PR head:
- Post-review change classifications: none
- Epic/Story truth status:
- Manual UI confirmation:

## Remote Review Watermarks

| Reviewer / Check | Required / Optional | Triggered Head | Completed Head | State / Result |
|---|---|---|---|---|
| TBD | required / optional | TBD | TBD / pending / unavailable | pending / pass / findings / failed / unavailable / not configured |

## Documentation And SDD Integrity

- Scoped `sdd validate`:
- Epic verification report state:
- Epic `modified` freshness baseline:
- Release communication matches current behavior:
- Contradictory or stale supporting truth: none

## Security / Data / Operations

- Security review:
- Data or migration impact:
- Deployment or external-service impact:
- Known risks:

## Release Actions

- [ ] CI passed
- [ ] Required remote reviewer/check watermarks are current and successful
- [ ] Optional pending, unavailable, or stale review is explicitly classified
- [ ] Approved for merge
- [ ] Merge completed
- [ ] Deployment completed, if applicable
- [ ] Tags/package publishing completed, if applicable
