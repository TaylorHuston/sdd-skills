# Release Handoff Set: <Title>

Use one aggregate record for the central Change and repeat the repository bundle for every target repository participating in the release. A one-repository release has one bundle. When policy requires separate PRs, each PR body may contain its own repository bundle plus the aggregate coordination and closeout state.

## Aggregate Release Scope

- Target repository IDs:
- Included central SDD Change IDs (do not include workspace-local paths):
- Version decision by repository or shared release train: version update / no version update
- User-confirmed release version/date, when applicable:
- Cross-repository ordering, compatibility, or atomicity constraints: none
- Aggregate release readiness: pending / ready / blocked
- Change-wide closeout eligibility: pending / ready / blocked

## Repository Handoff: <repository-id>

Repeat this complete section for every target repository.

### Branch And Version Scope

- Repository ID:
- Source branch and commit:
- Target branch and current commit:
- PR or equivalent handoff:
- Changelog reviewed:
- Current version:
- Suggested version and increment:
- Confirmed version decision:

### File Scope Reconciliation

- Source-to-target diff command/ref:
- Intended product paths:
- Repository-local SDD and supporting-truth paths:
- Authorized release-metadata paths:
- Required generated paths:
- Excluded or unrelated paths: none
- Final allowlist match: pass / fail

### Release Communication

- Release communication updated:
- Public release notes summary:

### Verification

| Gate | Exact command / evidence | Candidate commit or tree | Result |
|---|---|---|---|
| Full e2e | not applicable | TBD | pass / fail / skipped with reason |
| Lint | TBD | TBD | pass / fail / not configured |
| Typecheck | TBD | TBD | pass / fail / not configured |
| Unit tests | TBD | TBD | pass / fail / not configured |
| Integration tests | TBD | TBD | pass / fail / not configured |
| Build | TBD | TBD | pass / fail / not configured |
| Migration/schema/codegen | TBD | TBD | pass / fail / not applicable |
| Other | TBD | TBD | pass / fail / not applicable |

### SDD Readiness

- `/sdd-review` status:
- Reviewed source commit:
- Cumulative release-candidate review required: yes / no
- Cumulative review trigger or proportional-scan reason:
- Cumulative reviewed commit/tree, gates, and result:
- Latest reconciled PR head:
- Post-review change classifications: none
- Epic/Story truth status:
- Manual UI confirmation:
- Repository closeout gate: pending / pass / blocked

### Remote Review Watermarks

| Repository ID | Reviewer / Check | Required / Optional | Triggered Head | Completed Head | State / Result |
|---|---|---|---|---|---|
| `<repository-id>` | TBD | required / optional | TBD | TBD / pending / unavailable | pending / pass / findings / failed / unavailable / not configured |

### Documentation And SDD Integrity

- Scoped `sdd validate`:
- Epic verification report state:
- Epic `modified` freshness baseline:
- Release communication matches current behavior:
- Contradictory or stale supporting truth: none

### Security / Data / Operations

- Security review:
- Data or migration impact:
- Deployment or external-service impact:
- Known risks:

### Repository Release Actions

- [ ] Candidate commit and target are current
- [ ] Required local and integration-candidate gates passed
- [ ] Required remote reviewer/check watermarks are current and successful
- [ ] Optional pending, unavailable, or stale review is explicitly classified
- [ ] Approved for merge when approval is required
- [ ] Merge or equivalent handoff completed when authorized
- [ ] Deployment completed, if applicable and separately authorized
- [ ] Tags/package publishing completed, if applicable and separately authorized

## Cross-Repository Coordination

| Dependency / Gate | Repositories | Required order or shared candidate | Evidence | Result |
|---|---|---|---|---|
| None | — | — | — | not applicable |

## Aggregate Closeout

- [ ] Every target repository has a complete handoff bundle
- [ ] Every target repository's exact candidate and integration target are recorded
- [ ] Cross-repository compatibility and ordering gates passed or are not applicable with reason
- [ ] Repository-specific PR/merge/release/acceptance state is current in the one central ledger
- [ ] No required target remains pending or blocked
- [ ] Change-wide closeout performed once, only after authorization and all target gates pass
