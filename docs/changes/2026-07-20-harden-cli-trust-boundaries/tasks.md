---
status: in_progress
---
# Tasks: Harden CLI Trust Boundaries

## Resume Here

- Last completed action: the follow-up Apply resolved shared S1 report integrity, S5 orphan-audit Git handling, lineage proof, workflow/site ownership, package gates, and reverse traceability through `develop@1485103`.
- Next action: apply this Change's remaining S2/S3 findings: synthetic repository-ID collision, concurrent initialization, and owner-relative planned-path confinement; then rerun the cumulative 197-test source/integration gates.
- Active branch/ref: current shared candidate includes S1/S5 remediation through `develop@83ff3a1`; the original implementation remains in `main@7e9a2be`.
- Expected dirty files: both active Change ledgers and the shared Epic while current truth is reconciled; implementation should start from the next clean ledger commit.
- Known blockers: three current S2/S3 implementation defects and their adversarial proof; the S1/S5/S6/S7 findings are resolved by the follow-up Change and must not be duplicated here.

## Task Checklist

### 1. Planning Quality

- [x] 1.1 Scope and audit findings reconciled into four developer-workflow Stories.
- [x] 1.2 Requirements and adversarial Scenarios describe observable CLI outcomes.
- [x] 1.3 Selected shared-invariant approach compared with targeted patches and new dependencies.
- [x] 1.4 Known risk, decision fan-out, and verification environments seeded without freezing implementation order.
- [x] 1.5 UI and manual UI confirmation classified not applicable.
- [x] 1.6 Change set to `planned` after artifact coherence review.

### 2. Epic Artifacts

- [x] 2.1 Reconcile `SDD-E001` planned Stories with implementation after each Requirement.
- [x] 2.2 Keep Story Index, implementation/verification state, anchors, evidence, and gaps current.
- [x] 2.3 No earlier Epic truth exists to supersede; this is the repository's first Epic.

### 3. Implementation

- [x] 3.1 `SDD-E001/S1` trustworthy structural and evidence validation.
  - [x] R1 rejects missing or duplicate Story declarations/index rows, missing Requirements, and missing Scenarios.
  - [x] R2 rejects missing, external, non-file, or fabricated implementation anchors.
  - [x] R3 validates every automated citation, rejects empty/fabricated evidence, and scopes `--epic` reads.
- [ ] 3.2 `SDD-E001/S2` physically contained and recoverable mutation.
  - [x] R1 rejects symlink escape for install, artifact mutation, and evidence paths.
  - [x] R2 detects pre-commit and post-commit Change edits and reports retained recovery state.
  - [x] R3 atomically writes configuration/lock state, preserves modes, reclaims verified dead-owner locks, reports conservative manual recovery for alive/unknown ownership, serializes managed updates, and rolls workflow/skills back when lock commit fails.
  - [x] R2-S5 serializes or CAS-publishes concurrent first repository initialization without silent writer loss.
- [ ] 3.3 `SDD-E001/S3` unambiguous topology and lifecycle routing.
  - [x] R1 refuses idea-owned Change creation and promotion from repository-only context.
  - [x] R2 rejects physical repository aliases, unknown keys, and invalid artifact overlap.
  - [x] R3 rejects planned Change IDs already active or closed in any target repository.
  - [ ] R2-S2 rejects synthetic repository IDs that collide with existing Idea/configuration ownership.
  - [ ] R2-S3 constrains `plannedChangesDirectory` lexically and physically to its planning owner.
- [x] 3.4 `SDD-E001/S4` bounded, context-aware diagnostics.
  - [x] R1 ignores negated, historical, migration, imported-document, and quoted obsolete-guidance mentions while reporting affirmative/modal instructions.
  - [x] R2 bounds Git status and returns degraded per-repository results on timeout.
- [ ] 3.5 Keep new rules in bounded helpers/tests and avoid worsening dispatcher/validator/test concentration. Evidence-row rules and mutation/diagnostic tests are extracted, but the integration validator cases still enlarge `test/cli.test.js`; retain this as an explicit maintainability gap rather than claim it is resolved.

### 4. Verification And Reconciliation

- [x] 4.1 Run focused failing-first tests and inspect exact assertions for each Scenario.
- [x] 4.2 Run `npm run check`, native coverage, `git diff --check`, package dry run, skill validation, and scoped SDD validation.
- [x] 4.3 Reconcile README, workflow doctrine, schemas, CHANGELOG, Change ledgers, and Epic truth.
- [x] 4.4 Run changed-surface reverse traceability and fresh-context implementation self-check passes.
- [x] 4.5 Record coherent commit candidates because commits are not currently authorized.

### 5. Review And Closeout

- [ ] 5.1 Commit the complete verified S2/S3 remediation.
- [ ] 5.2 Transition to `in_review` after implementation is committed and the complete Apply self-check is clean.
- [ ] 5.3 Run independent `/sdd-review`; do not close from Apply.

## Implementation Ledger

| Date | Slice | Agent / Guidance | Files / Areas | Result | Commit / Ref |
|---|---|---|---|---|---|
| 2026-07-20 | Planning bootstrap | main; `sdd-change`, `sdd-apply` | audit, Change, `SDD-E001` | Accepted audit translated into adaptive end-state contract. | `a7eeb06` |
| 2026-07-20 | Validator and topology hardening | main; TDD | validator, config/workspace, lifecycle commands, fixtures | Structural parity, real anchors, strict topology, focused reads, and planning ownership are enforced. | `a7eeb06` |
| 2026-07-20 | Mutation and diagnostics hardening | main; security finding remediation | filesystem, locks, install transaction, lifecycle recovery, doctor/status | Physical boundaries, atomic state, recovery visibility, bounded Git, and guidance classification are enforced. | `a7eeb06` |
| 2026-07-23 | S2/R2-S5 concurrent repository initialization | main; TDD | repository initialization, shared mutation lock, CLI test, S2 Epic truth | The first repository contract is published only while its physical owner lock is held; a simultaneous initializer receives `OPERATION_IN_PROGRESS` and cannot silently win later. | commit pending |
| 2026-07-20 | Fresh-review remediation | main plus independent review waves | validator helpers, transaction boundary, recovery races, migration rollback, package allowlist, docs/tests | Duplicate/mixed evidence bypasses, post-commit data loss, recreated-target overwrite, silent migration recovery failure, stale locks, internal package leakage, and doctrine drift resolved. | `a7eeb06` |
| 2026-07-20 | User skill synchronization | package CLI | `/Users/taylor/.agents/skills` | `sdd update` updated Apply, Change, Epic Verify, and then Orphan Audit after its final parser correction; immediate final dry-run reported all 14 managed skills unchanged. | installed state only; no repository commit |

## Verification Ledger

| Date | Check | Evidence Type | What It Proves | Result |
|---|---|---|---|---|
| 2026-07-20 | Audit reproductions and `npm run check` | focused probes and broad supporting gate | Baseline: 105 tests pass; symlink escape, alias ownership, overlap, schema drift, empty evidence, and repository-only routing findings reproduce. | passed baseline / findings confirmed |
| 2026-07-20 | `npm run check` | broad automated gate | CLI behavior, test suite, and help surface remain coherent. | passed; 160 tests |
| 2026-07-20 | `node --test --experimental-test-coverage test/*.test.js` | native coverage | Changed branches execute within the repository-wide safety net. | passed; 86.63% lines, 76.53% branches, 86.53% functions |
| 2026-07-20 | `npm pack --dry-run --json` | package manifest inspection | Published package contains runtime docs/templates/skills/code but not internal audits, active Changes, or Epics. | passed; 104 files, no internal SDD work records |
| 2026-07-20 | `npm audit --omit=dev --json` | dependency advisory gate | Production dependency graph has no known registry advisories. | passed; 0 vulnerabilities |
| 2026-07-20 | `git diff --check` | diff-integrity gate | Touched text contains no whitespace errors. | passed |
| 2026-07-20 | packaged skill validation | package skill gate | Every bundled SDD skill remains structurally valid after guidance changes. | passed; 14 skills |
| 2026-07-20 | scoped `sdd validate` | Change and Epic integrity | Current ownership, anchors, evidence, and Change references are coherent. | passed; 0 errors, 0 warnings |
| 2026-07-20 | fresh-context failure-seeking review | independent review | Review continued through validator, package, and mutation surfaces and rechecked remediations. | passed; no remaining blockers |
| 2026-07-20 | changed-surface orphan audit | reverse traceability | Current Change runtime modules and test files resolve through `SDD-E001`; preserved pre-Change skill/template edits remain separate classification candidates. | passed; 21 implementation refs, 4 test refs, 0 missing refs, 0 unverified tests |
| 2026-07-20 | `sdd update` plus immediate dry-run | installed-skill synchronization | Universal user skills are updated only through the package CLI and match package hashes. | passed; 4 updated across two reconciled passes, then 14 unchanged |

## Manual Feedback

| Date | Feedback | Classification | Action / Artifact Updates | Status |
|---|---|---|---|---|
| 2026-07-20 | Apply the validated audit fixes. | requirement confirmation | Created Change and `SDD-E001`; all validated findings included. | reconciled |

## Planning Updates

| Date | Discovery | Classification | Planning Updates | Next Apply Starting Point |
|---|---|---|---|---|
| 2026-07-20 | Repository is unmapped and current `change create` invents a private path. | technical constraint | Bootstrapped canonical repository Change directly and recorded the exception. | `SDD-E001/S1 R1` |

## Design Updates

- Not applicable; no UI or experience-design surface.

## Implementation Risk And Confirmation Matrix

| Requirement / Surface | End-State Invariant | Risk / Failure Mode | Check Or Confirmation Needed | Evidence / Finding | Status |
|---|---|---|---|---|---|
| S1 validation | A valid Epic contains navigable behavior and real evidence. | Empty/duplicate Stories, mixed citations, directories, or fabricated anchors pass. | Adversarial negative fixtures plus one real anchored pass fixture. | Ordered parity and all-citation regular-file checks pass focused and broad tests. | resolved |
| S2 physical boundaries | Every mutation/evidence path remains physically under its owner root. | Symlink ancestor escapes lexical check. | Real symlink fixtures for install, lifecycle, and validation. | Shared physical resolver rejects all exercised escapes. | resolved |
| S2 mutation recovery | Concurrent edits are not silently overwritten and partial rollback is visible. | Preflight snapshot becomes stale; a recreated publish target is overwritten; rollback erases post-commit edits; install or migrated-config recovery fails. | Pre/post-commit drift injection, no-replace publication races, lock failure, exact migration rollback, and rollback-state assertions. | Newer content is preserved, exact prior config bytes are restored, and incomplete recovery is explicit. | resolved |
| S3 topology | One physical repository has one owner and artifact roots have one unambiguous role. | Aliases/overlaps/unknown keys pass runtime validation. | Shared valid/invalid config corpus and physical alias fixture. | Strict runtime/schema parity and physical ownership tests pass. | resolved |
| S3 lifecycle | A successful create never introduces a location collision or private destination. | ID exists active/closed or repository-only context invents planning. | Create/promote mapping refusal plus active, closed, multi-repo, and dry-run fixtures. | All collision and mapping-required paths fail before mutation. | resolved |
| S4 diagnostics | Diagnostics finish within a bound and report only affirmative obsolete instructions. | Hung Git blocks all; examples or migration prose block doctor; modal requirements are missed. | Fake Git timeout and affirmative/negative guidance corpus. | Bounded Git and refined clause classification pass. | resolved |

## Pattern Parity Matrix

| Concern | Reference Location / Contract | New Location / Contract | Focused Proof | Intentional Divergence / Gap | Status |
|---|---|---|---|---|---|
| Path checks across commands | `src/fs.js#isPathInside` and command-local joins | shared physical containment helper used by every touched boundary | symlink fixture matrix | none | resolved |
| Lifecycle atomicity | create/Epic atomic directory replacement | promote/transition/close commit-time compare-and-set and recovery reporting | injected pre/post-commit drift and rollback tests | multi-repo operations report partial recovery rather than claim impossible global atomicity | resolved |
| Installation atomicity | independent workflow, skills, and lock writes | recoverable managed-install transaction | forced lock-persistence failure | newer third-party edits are preserved and surfaced rather than overwritten | resolved |
| Configuration contract | checked schemas | strict runtime shape plus relational checks | shared config corpus | no new schema dependency | resolved |

## Stateful Transition Matrix

| Start State | Trigger / Transition | Expected Invariant | Focused Test Or Runtime Observation | Result |
|---|---|---|---|---|
| Change status snapshot | another writer changes `tasks.md` before or after an earlier commit | transition aborts and preserves latest content | injected pre-commit and post-commit edits | passed |
| Planned draft snapshot | another writer changes draft or committed destination during promotion | promotion aborts while preserving newer content and an explicit recovery location | staged-copy and post-commit drift fixtures | passed |
| Close status snapshot | review status changes immediately before close commit | close aborts and leaves the active Change intact | commit-time status injection | passed |
| Multi-repository mutation | one destination or rollback step fails | exact resulting locations and recovery failures are reported | fault-injected rename/remove and install-lock fixtures | passed |
| Repository status | one Git child stalls | other repositories return and stalled repository degrades after timeout | fake hung Git executable | passed |

## Decision Fan-Out Ledger

| Date | Decision / Discovery | End-State Consequence | Affected Surfaces To Reconcile | Evidence / Artifact Updates | Status |
|---|---|---|---|---|---|
| 2026-07-20 | v2 anchors become structurally checkable. | README/workflow/templates/tests must use path-plus-`#anchor` evidence. | validator, Epic template, README, workflow, CHANGELOG, tests | all surfaces reconciled and package parity tests pass | resolved |
| 2026-07-20 | Physical containment becomes a shared mutation/evidence rule. | install, Change/Epic commands, and validation must call one helper. | `fs.js`, `skills.js`, commands, tests | shared resolver and symlink matrix pass | resolved |
| 2026-07-20 | Repository-only context cannot own private planning. | `change create`/promote error contract and docs must state mapping requirement. | workspace/change commands, README, workflow, tests | both commands and doctrine now agree | resolved |
| 2026-07-20 | Runtime configuration is strict and relational. | schemas, validator, doctor, examples, and tests must agree. | config, schemas, README, tests | strict-shape and overlap corpus passes | resolved |
| 2026-07-20 | Internal SDD work records are not package runtime assets. | NPM allowlist must exclude audits, active Changes, and repository Epics. | `package.json`, pack inspection | dry-run tarball contains no internal records | resolved |

## Verification Environment

| Evidence Obligation | Required Setup / Safety Boundary | Needed For | Current Readiness | Result / Resolution |
|---|---|---|---|---|
| Filesystem safety and recovery | disposable temporary directories only | S2 | ready | Node test fixtures; never touch external user data |
| CLI subprocess behavior | local Node and fake executables/config roots | S3/S4 | ready | existing Node test harness |
| Package gates | local npm checkout and skill validator | all Stories | ready | baseline `npm run check` passed |
| UI/browser/provider/database | none | none | not applicable | CLI-only Change |

## Manual UI Confirmation

- Status: not applicable
- App URL / route: not applicable
- Required setup or test data: not applicable
- Steps for the user: none; behavior is covered through CLI and filesystem fixtures.
- Expected result: not applicable
- Feedback that would change artifacts: any desired compatibility exception for symlinked child roots, repository-only planning, or evidence-anchor syntax would require replanning.

## Visual Verification Matrix

- Not applicable: this Change has no rendered UI surface.

## Blockers / Open Questions

- Current blockers: S2 repository collision/concurrent initialization and S3 planned-path confinement remain implementation findings from the cumulative review.
- Accepted maintainability gap: the highest-risk evidence-row logic now lives in `src/epic-evidence.js` and mutation/diagnostic cases have focused suites, but the established end-to-end workspace fixture remains coupled to `test/cli.test.js`. Extracting the full Epic validator integration fixture is deferred rather than mixing a broad test-harness move into this safety Change.

## Review Handoff Candidate

- Historical candidate `a7eeb06` was invalidated by the cumulative review and is not a current review watermark.
- Current integration target: `main@7e9a2bef9811f623583232c554417ae08ddc9373`.
- Current candidate source commit: pending S2/S3 remediation.
- Intended implementation fully committed: no; S2/R2-S5 and S3/R2-S2/R2-S3 remain gaps.
- Required risk, fan-out, environment, verification, and integration rows still pending or blocked: concurrent initialization, synthetic ownership collision, planned-path confinement, and the final cumulative candidate gates.
- Fresh-context failure-seeking passes completed: historical passes are retained as evidence; new adversarial and cumulative passes are required after remediation.

## Closeout

- Change status: in_progress
- Epic files updated: current S2/S3 gaps and partial state reconciled; implementation/evidence rows remain pending.
- Story labels/references and Requirement/Scenario IDs current: yes
- Implemented By maps current: yes
- Scenario-mapped Verified By maps current: yes; scoped Change+Epic validation passed with zero findings
- Superseded earlier Epic truth reconciled: not applicable; no earlier Epics
- ADR status: not applicable
- Release communication current: README, canonical workflow, templates, and CHANGELOG reconciled; no release requested
- `sdd-review` verdict: `changes-requested` on historical snapshot `c477e4a`; fresh review required after remediation.
- Review record: `review.md`.
- `review.md` findings resolved: shared S1/S5 findings yes; S2/S3 findings no.
- Planning updates resolved: yes
- Implementation risk and confirmation rows resolved: no; three S2/S3 rows remain.
- Pattern parity and stateful transition rows resolved: no; concurrent first initialization remains.
- Evidence-claim integrity checked: existing proof retained; current gaps are explicit and unverified.
- Decision fan-out reconciled: yes
- Verification environment obligations resolved: yes; all local CLI/filesystem/package gates executed
- Immutable review handoff candidate: pending.
- Manual UI confirmation status: not applicable
- Rendered UI verification status: not applicable
- PR / merge state: no PR or merge requested
- Deferred scope accepted: broad non-behavioral refactor and cross-machine transactions only
- Change moved to `docs/changes/closed/`: no
