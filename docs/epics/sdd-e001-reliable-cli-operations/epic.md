---
schema: sdd-epic-v2
id: SDD-E001
status: active
created: 2026-07-20
modified: 2026-08-07
last_verified: 2026-08-07
stories:
  - S1
  - S2
  - S3
  - S4
  - S5
  - S6
  - S7
---

# SDD-E001 Reliable Toolchain Operations

## Product Context

- PRD: not applicable; this is a repository-only toolchain package.
- Related docs: `README.md`, `docs/story-driven-development.md`, `docs/audits/2026-07-20-code-audit.md`
- Related ADRs: `docs/adrs/2026-08-07-centralize-change-storage.md`.

Developers and agents rely on the CLI and packaged skills as one toolchain. Deterministic results must be trustworthy, mutations must remain inside declared ownership, audit reports must distinguish current from historical state, and review/release handoffs must contain only classified scope.

## Outcome

Developers can validate SDD artifacts, mutate lifecycle state, resolve topology, audit Epics, and prepare review/release handoffs with explicit evidence, physical containment, recoverable transitions, current-state reporting, exact diff scope, and bounded diagnostics.

## Current Scope

- Trustworthy v2 Epic structure and evidence validation.
- Physically contained and recoverable local filesystem mutation.
- Unambiguous configuration, topology, and Change lifecycle routing.
- Bounded, context-aware `doctor` and `status` diagnostics.
- Current-state Epic audit reports and exact-diff PR/release handoffs.
- Persistent evidence-backed planning, implementation, review, design, and interactive workflows.
- An accessible public methodology reference with restrained Steel documentation presentation.

## Deferred Scope

- Hosted or cross-machine coordination.
- Application UI, database, provider, deployment, or production behavior outside this package's public guide.
- Broad refactoring that does not materially strengthen these contracts.

## Candidate Stories

Candidate Stories are planning signals only. They are not accepted Epic/Story truth until promoted into `## Stories`, and they do not receive `S#` labels until promotion.

| Candidate | Status | Story Shape | Acceptance Signals |
|---|---|---|---|
| None | deferred | No candidate Stories currently identified. | Revisit when another CLI workflow has a distinct developer outcome. |

## Story Index

| Story | Implementation | Verification | Capability | Last Verified | Notes |
|---|---|---|---|---|---|
| S1 | implemented | verified | Validate navigable behavior and real evidence. | 2026-07-23 | Structure, anchors, evidence, report integrity, metadata, and focused reads fail closed with current proof. |
| S2 | implemented | verified | Mutate only inside physical owner boundaries and recover safely. | 2026-08-07 | Central lifecycle, migration, configuration, and managed-install mutations reject drift and preserve newer state. |
| S3 | implemented | verified | Route one globally unique central Change across portable repository targets. | 2026-08-07 | Creation, lifecycle, physical confinement, and fail-closed automatic migration use one user-level store. |
| S4 | implemented | verified | Complete diagnostics within a bound without prose false positives. | 2026-07-20 | Guidance is affirmative-only and Git work is bounded. |
| S5 | implemented | verified | Preserve current audit truth and exact publication scope. | 2026-07-23 | Reports are versioned; PR/release paths are classified and rechecked; Git baselines are immutable and bounded. |
| S6 | implemented | verified | Carry one central multi-repository workflow through a complete evidence-backed handoff. | 2026-08-07 | Every shipped workflow shares one target set and one global lifecycle while preserving repository-owned truth. |
| S7 | implemented | verified | Explain the portable method and package through accessible responsive documentation. | 2026-08-07 | The guide documents central Change ownership and automatic migration; prior rendered accessibility evidence remains current for unchanged layout behavior. |

## Stories

### Story S1: Trustworthy Artifact Validation

Implementation: implemented
Verification: verified
Created: 2026-07-20
Modified: 2026-07-23
Last verified: 2026-07-23

As a developer, I want successful Epic validation to point to real behavior, implementation, and tests, so that I can navigate and trust the durable SDD map.

#### Requirements And Scenarios

##### Requirement R1: Non-Empty Behavior Structure

The CLI SHALL reject a v2 Epic whose declared Stories do not exactly match body Stories or whose promoted Stories lack Requirements or Scenarios.

###### Scenario R1-S1: Empty Story Declaration

- WHEN a v2 Epic declares no Stories while a body Story exists
- THEN validation returns a deterministic error instead of success.

###### Scenario R1-S2: Empty Behavior Body

- WHEN a promoted Story has no Requirement or a Requirement has no Scenario
- THEN validation reports the missing behavior structure.

##### Requirement R2: Navigable Implementation Anchors

The CLI SHALL accept implemented ownership only when the repository-relative file and declared searchable anchor exist inside the physical repository boundary.

###### Scenario R2-S1: Fabricated Or External Anchor

- WHEN an Implemented By row names a missing anchor or a symlink target outside the repository
- THEN validation rejects the implementation evidence.

##### Requirement R3: Usable Verification Evidence

The CLI SHALL count scenario coverage only from complete evidence rows whose automated test path and searchable anchor exist inside the physical repository boundary.

###### Scenario R3-S1: Empty Evidence Row

- WHEN a Verified By row contains only a valid Scenario reference
- THEN validation requires an explicit Verification Gap instead of treating the row as coverage.

###### Scenario R3-S2: Fabricated Automated Evidence

- WHEN automated evidence names an empty, missing, external, or unanchored test location
- THEN validation rejects the evidence with a deterministic finding.

###### Scenario R3-S3: Focused Epic Read

- WHEN validation is scoped to one Epic
- THEN unrelated Epics are not opened or allowed to abort the focused result.

##### Requirement R4: Coherent Epic Verification Reports

The CLI SHALL validate versioned Epic verification reports as current-state audit records whose verdict, complete canonical gate set, findings, scoped checks, identity, and predecessor link agree.

###### Scenario R4-S1: Contradictory Aligned Result

- WHEN a versioned report declares `aligned` while a current gate still contains findings
- THEN validation rejects the report instead of accepting the frontmatter result alone.

###### Scenario R4-S2: Broken Report Lineage

- WHEN a versioned report names a missing, external, self, or non-versioned predecessor, or its initial result disagrees with the predecessor's current result
- THEN validation reports a broken `supersedes` link.

###### Scenario R4-S3: Missing Report Schema

- WHEN an artifact identifies itself as an Epic verification report but omits its schema
- THEN validation reports the missing schema and counts the artifact as a report instead of silently ignoring it.

###### Scenario R4-S4: Mis-Scoped Alignment Evidence

- WHEN an aligned report cites structural or orphan-audit evidence for another Epic or repository, or repeats a governing `--epic`, `--repo`, or `--changed-from` option
- THEN validation rejects the report instead of accepting unrelated proof.

###### Scenario R4-S5: Spoofed Check Command

- WHEN report evidence merely contains the text of a required command inside another executable or argument
- THEN validation rejects it unless the approved executable and argument shape begin the parsed command.

###### Scenario R4-S6: Incoherent Non-Aligned Result

- WHEN a blocked or changes-requested report omits the complete scorecard, result-appropriate findings, blocked gate, or current checks
- THEN validation rejects the internally incomplete report instead of treating non-alignment as an evidence exemption; current checks require recognized results.

###### Scenario R4-S7: Malformed Or External Report Identity

- WHEN report identity fields have invalid types, the reviews directory resolves outside the physical repository, or a report-shaped entry is symlinked or nonregular
- THEN validation returns deterministic findings without crashing or trusting the external artifact.

##### Requirement R5: Git-Relative Epic Metadata Freshness

When the caller supplies `--changed-from`, the CLI SHALL compare substantive baseline Epic content with the current working tree and reject a changed Epic whose top-level `modified` value is stale, while avoiding a false failure when both edits share the current local date.

###### Scenario R5-S1: Stale Modified Metadata

- WHEN substantive Epic content differs from the selected Git baseline while `modified` is unchanged
- THEN validation returns `STALE_EPIC_MODIFIED_DATE`.

###### Scenario R5-S2: Verification-Only Metadata Update

- WHEN only top-level verification metadata differs from the selected Git baseline
- THEN validation does not report stale substantive-change metadata.

###### Scenario R5-S3: Invalid Git Baseline

- WHEN the requested commit-ish cannot be resolved in a selected repository
- THEN validation returns a deterministic repository finding instead of crashing or silently skipping the check.

###### Scenario R5-S4: Same-Day Substantive Edit

- WHEN the selected baseline already has today's `modified` date and the Epic changes again that day
- THEN validation accepts the date-granularity limitation instead of requiring a future date.

#### Implemented By

Map every Requirement to its primary governing location after implementation. `primary` describes behavior ownership, not a physical layer; use narrower multiple primary rows when ownership genuinely splits across layers or Scenarios. Add supporting rows only for distinct adapter, persistence, presentation, configuration, migration, or support responsibilities. Prefer stable symbols, exports, routes, classes, or searchable anchors over line numbers.

| Requirement / Scenario | Location / Anchor | Kind | Responsibility |
|---|---|---|---|
| S1/R1 | `src/commands/validate.js#validateEpic` | primary | Validates declared and body behavior structure. |
| S1/R2 | `src/commands/validate.js#validateEpic` | primary | Governs implementation ownership acceptance and deterministic findings. |
| S1/R2 | `src/epic-evidence.js#readRegularText` | support | Requires anchors to resolve in readable regular files. |
| S1/R2-S1 | `src/fs.js#isPathPhysicallyInside` | support | Resolves physical ownership through existing symlink ancestors. |
| S1/R3 | `src/epic-evidence.js#validateVerifiedEvidenceRow` | primary | Governs complete evidence-row coverage, mixed-reference validity, and every automated path-plus-anchor claim. |
| S1/R3 | `src/commands/validate.js#validateEpic` | support | Orchestrates Story coverage and merges the focused evidence validator result. |
| S1/R3-S3 | `src/commands/validate.js#validateRepository` | support | Narrows focused Epic directories before opening artifacts. |
| S1/R3 | `skills/sdd-orphan-audit/scripts/sdd_orphan_audit.py#parse_epic_refs` | support | Keeps reverse traceability aligned with canonical path-plus-anchor evidence rows. |
| S1/R4 | `src/epic-verify-report.js#validateEpicVerifyReports` | primary | Validates versioned report identity, current-result coherence, remediation sections, and predecessor containment. |
| S1/R4-S7 | `src/epic-verify-report.js#validateEpicVerifyReports` | primary | Counts and rejects report-shaped entries that are symlinked, nonregular, or physically outside the reviews directory. |
| S1/R4 | `src/epic-verify-report.js#CANONICAL_GATES` | support | Keeps aligned-report coverage synchronized with the canonical shipped scorecard. |
| S1/R4-S4 | `src/epic-verify-report.js#commandHasUniqueOptionValue` | support | Requires report checks to carry exactly one exact Epic, repository, and immutable baseline option value in either supported option syntax. |
| S1/R4-S4 | `src/epic-verify-report.js#orphanAuditHasRepositoryRoot` | support | Binds reverse-inventory proof to the exact repository root instead of accepting another checkout. |
| S1/R4-S5 | `src/epic-verify-report.js#isStructuralValidationCommand` | support | Accepts structural proof only when the parsed command starts with the approved executable and argument shape. |
| S1/R4-S5 | `src/epic-verify-report.js#isOrphanAuditCommand` | support | Accepts reverse-inventory proof only when the parsed command starts with the approved executable and audit subcommand. |
| S1/R4 | `src/commands/validate.js#validateRepository` | support | Discovers and merges report findings only for selected Epics. |
| S1/R5 | `src/epic-history.js#validateEpicHistory` | primary | Compares substantive baseline and working-tree Epic content while excluding top-level freshness metadata. |
| S1/R5 | `src/epic-history.js#resolveChangedFrom` | support | Resolves the requested commit-ish without shell evaluation before repository validation. |

#### Implementation Gaps


#### Verified By

For automated evidence, use `path#exact test title or stable test anchor` and name the important assertion, route, selector, injected failure, or observation. Aggregate Scenarios only when the named proof explicitly exercises each one.

| Requirement / Scenario | Evidence | Proves | Status |
|---|---|---|---|
| S1/R1-S1 | Automated test `test/cli.test.js#validate rejects an empty v2 Story declaration when a promoted Story exists` | Empty declarations cannot bypass Story parity. | Passing 2026-07-20 |
| S1/R1-S1 | Automated test `test/cli.test.js#validate rejects duplicate Story declarations that mask a missing Story` | Duplicate declarations cannot satisfy ordered Story parity. | Passing 2026-07-20 |
| S1/R1-S1 | Automated test `test/cli.test.js#validate rejects duplicate Story Index rows that mask a missing Story` | Duplicate index rows cannot hide an omitted Story. | Passing 2026-07-20 |
| S1/R1-S2 | Automated test `test/cli.test.js#validate rejects a v2 Story without Requirements` | A promoted Story requires behavior Requirements. | Passing 2026-07-20 |
| S1/R1-S2 | Automated test `test/cli.test.js#validate rejects a v2 Requirement without Scenarios` | Every Requirement requires a Scenario. | Passing 2026-07-20 |
| S1/R2-S1 | Automated test `test/cli.test.js#validate rejects fabricated implementation anchors` | Existing files cannot substantiate fabricated symbols. | Passing 2026-07-20 |
| S1/R2-S1 | Automated test `test/cli.test.js#validate rejects implementation and test evidence that resolve outside the repository` | Symlinked implementation ownership outside the repository is rejected. | Passing 2026-07-20 |
| S1/R3-S1 | Automated test `test/cli.test.js#validate does not count incomplete Verified By rows as coverage` | Incomplete rows produce findings and do not cover Scenarios. | Passing 2026-07-20 |
| S1/R3-S1 | Automated test `test/cli.test.js#validate does not credit a mixed valid and broken Verified By reference` | A valid Scenario cannot receive credit from a row that also names an unknown behavior. | Passing 2026-07-20 |
| S1/R3-S2 | Automated test `test/cli.test.js#validate rejects a missing v2 Verified By automated test path` | Missing automated test files are rejected. | Passing 2026-07-20 |
| S1/R3-S2 | Automated test `test/cli.test.js#validate rejects a missing v2 Verified By automated test anchor` | Fabricated automated test anchors are rejected. | Passing 2026-07-20 |
| S1/R3-S2 | Automated test `test/cli.test.js#validate rejects v2 automated Verified By evidence without a concrete test path` | Generic automated evidence cannot receive coverage credit. | Passing 2026-07-20 |
| S1/R3-S2 | Automated test `test/cli.test.js#validate rejects mixed automated evidence with an unsafe extra citation` | One valid test cannot hide an unsafe or fabricated extra citation. | Passing 2026-07-20 |
| S1/R3-S2 | Automated test `test/cli.test.js#validate reports directory evidence and implementation paths without throwing` | Non-file citations become findings instead of uncaught read errors. | Passing 2026-07-20 |
| S1/R3-S2 | Automated test `test/cli.test.js#validate rejects implementation and test evidence that resolve outside the repository` | External symlink test evidence is rejected. | Passing 2026-07-20 |
| S1/R3-S3 | Automated test `test/cli.test.js#focused Epic validation does not open unrelated Epic artifacts` | An unrelated unreadable Epic cannot abort a focused result. | Passing 2026-07-20 |
| S1/R3-S3 | Automated test `test/orphan-audit.test.js#orphan audit parses canonical test anchors and ignores prose filenames` | Reverse traceability recognizes spaced test anchors and reads only the evidence column. | Passing 2026-07-20 |
| S1/R4-S1 | Automated test `test/cli.test.js#validate rejects an aligned Epic verification report with current findings` | An aligned frontmatter result cannot override contradictory current gate state. | Passing 2026-07-22 |
| S1/R4-S1 | Automated test `test/cli.test.js#validate rejects an aligned Epic verification report with incomplete gate coverage` | A partial scorecard cannot be certified as aligned. | Passing 2026-07-22 |
| S1/R4-S1 | Automated test `test/cli.test.js#validate accepts a coherent current Epic verification report` | A report derived from the canonical shipped template with every current gate and correctly scoped proof is accepted. | Passing 2026-07-23 |
| S1/R4-S1 | Automated test `test/cli.test.js#validate rejects Epic verification Verdict metadata drift` | Initial/current results and audited/verified refs cannot contradict frontmatter. | Passing 2026-07-22 |
| S1/R4-S1 | Automated test `test/cli.test.js#validate rejects mutable Epic verification refs` | Branch names and symbolic refs cannot serve as immutable audit watermarks. | Passing 2026-07-22 |
| S1/R4-S1 | Automated test `test/cli.test.js#validate rejects an aligned Epic verification report without its audited baseline check` | Alignment requires scoped structural validation against the report's immutable audited ref. | Passing 2026-07-22 |
| S1/R4 | Automated test `test/cli.test.js#validate rejects malformed versioned Epic verification report frontmatter` | A report cannot evade versioned validation through malformed YAML. | Passing 2026-07-22 |
| S1/R4-S2 | Automated test `test/cli.test.js#validate rejects a missing superseded Epic verification report` | A missing predecessor cannot establish report lineage. | Passing 2026-07-22 |
| S1/R4-S2 | Automated test `test/cli.test.js#validate rejects an absolute Epic verification report predecessor` | Report lineage must remain repository-relative even when an absolute target points into the same reviews directory. | Passing 2026-07-22 |
| S1/R4-S2 | Automated test `test/cli.test.js#validate rejects a self-referential Epic verification report predecessor` | A report cannot establish lineage by naming itself. | Passing 2026-07-23 |
| S1/R4-S2 | Automated test `test/cli.test.js#validate rejects a non-versioned Epic verification report predecessor` | A report predecessor must be another immutable versioned audit snapshot. | Passing 2026-07-23 |
| S1/R4-S3 | Automated test `test/cli.test.js#validate rejects a recognized Epic verification report without a schema` | A recognized schema-less report produces a deterministic finding and remains in the report count. | Passing 2026-07-23 |
| S1/R4-S4 | Automated test `test/cli.test.js#validate rejects aligned proof scoped to another Epic` | Alignment cannot reuse structural or orphan-audit evidence for a different Epic. | Passing 2026-07-23 |
| S1/R4-S4 | Automated test `test/cli.test.js#validate rejects aligned proof scoped to another repository` | Alignment cannot use a prefix-confusable or otherwise different repository path. | Passing 2026-07-23 |
| S1/R4-S4 | Automated test `test/cli.test.js#validate rejects orphan-audit proof scoped to another repository` | A current structural check cannot hide reverse-inventory proof run against another repository root. | Passing 2026-07-23 |
| S1/R4-S4 | Automated test `test/cli.test.js#validate accepts quoted repository paths in aligned proof` | Exact repository scoping remains portable when command arguments require shell quoting. | Passing 2026-07-23 |
| S1/R4-S4 | Automated test `test/cli.test.js#validate accepts equals-form governing options in aligned proof` | Aligned proof accepts `--option=value` syntax when the underlying validation and audit commands accept it. | Passing 2026-07-24 |
| S1/R4-S4 | Automated test `test/cli.test.js#validate rejects duplicate governing options in aligned report proof` | Repeated `--epic`, `--repo`, or `--changed-from` options cannot misrepresent last-wins downstream command scope. | Passing 2026-07-23 |
| S1/R4-S5 | Automated test `test/cli.test.js#validate rejects spoofed report check commands` | Required command text embedded inside another executable or argument cannot certify a report. | Passing 2026-07-23 |
| S1/R4-S6 | Automated test `test/cli.test.js#validate rejects incoherent non-aligned Epic verification reports` | `changes-requested` requires a current REQUIRED finding and recognized check results; `blocked` requires a current BLOCKING finding. | Passing 2026-07-23 |
| S1/R4-S7 | Automated test `test/cli.test.js#validate fails closed on malformed raw report identity` | Malformed raw kind/schema identity cannot evade report validation. | Passing 2026-07-23 |
| S1/R4-S7 | Automated test `test/cli.test.js#validate rejects an external Epic verification reviews directory` | A physically external reviews directory cannot supply trusted report artifacts. | Passing 2026-07-23 |
| S1/R4-S7 | Automated test `test/cli.test.js#validate rejects a symlinked Epic verification report file` | A symlinked report-shaped entry is counted and rejected instead of silently disappearing from audit validation. | Passing 2026-07-23 |
| S1/R4-S7 | Automated test `test/cli.test.js#validate reports typed Epic verification paths without crashing` | Invalid typed path fields produce deterministic findings rather than exceptions. | Passing 2026-07-23 |
| S1/R4-S2 | Automated test `test/cli.test.js#validate rejects successor result discontinuity` | A successor's initial result must continue from its predecessor's current result. | Passing 2026-07-23 |
| S1/R5-S1 | Automated test `test/cli.test.js#validate changed-from rejects substantive Epic edits with stale modified metadata` | Working-tree Epic changes require advanced `modified` metadata relative to the selected baseline. | Passing 2026-07-22 |
| S1/R5-S2 | Automated test `test/cli.test.js#validate changed-from accepts verification-only metadata changes` | Top-level verification freshness updates do not create a false substantive-change finding. | Passing 2026-07-22 |
| S1/R5-S3 | Automated test `test/cli.test.js#validate changed-from reports an invalid Git baseline as a finding` | Invalid commit-ish input becomes a deterministic validation error. | Passing 2026-07-22 |
| S1/R5-S4 | Automated test `test/cli.test.js#validate changed-from accepts a second substantive Epic edit on the same day` | Date-only metadata does not force an impossible future date for a same-day edit. | Passing 2026-07-22 |

#### Verification Gaps


#### Story Notes

- Structural validation remains a deterministic baseline, but it must not certify empty or fabricated navigation/evidence claims.

### Story S2: Safe And Recoverable Mutation

Implementation: implemented
Verification: verified
Created: 2026-07-20
Modified: 2026-08-07
Last verified: 2026-08-07

As a developer, I want filesystem mutations to stay inside their physical owner and preserve concurrent work, so that setup and lifecycle commands cannot silently damage unrelated data.

#### Requirements And Scenarios

##### Requirement R1: Physical Containment

The CLI SHALL reject managed-skill, artifact, and evidence paths whose existing symlink ancestry resolves outside the declared physical owner root.

###### Scenario R1-S1: Symlink Ancestor Escape

- WHEN a configured child path traverses a symlink to an external directory
- THEN the operation fails before writing, moving, removing, or accepting the external target.

##### Requirement R2: Commit-Time Concurrency Safety

The CLI SHALL compare the commit-time Change state with the state it prepared and abort without discarding newer content when they differ.

###### Scenario R2-S1: Concurrent Transition Edit

- WHEN `tasks.md` changes after transition preflight but before replacement
- THEN the transition restores the current content and reports concurrent modification.

###### Scenario R2-S2: Concurrent Migration Source Edit

- WHEN a legacy Change source changes after migration preflight
- THEN migration aborts before publication and preserves the newer source.

###### Scenario R2-S3: Post-Publication Failure During Migration

- WHEN a later migration stage fails after central publication or configuration upgrade
- THEN rollback restores prior sources and configs without overwriting newer destination content, or reports exact incomplete recovery.

###### Scenario R2-S4: Close-Time Status Drift

- WHEN an in-review Change is reopened after close preflight
- THEN close aborts and preserves the reopened Change in its active location.

###### Scenario R2-S5: Concurrent First Initialization

- WHEN two processes initialize the same repository before either portable contract exists
- THEN at most one initialization succeeds and the other reports the conflict without losing either writer's accepted durable state.

##### Requirement R3: Atomic Durable State And Recovery Reporting

The CLI SHALL atomically replace configuration and installation-lock files, serialize managed updates, and report rollback failures with the resulting state.

###### Scenario R3-S1: Interrupted Or Failed Mutation

- WHEN an update, central lifecycle command, or managed installation step fails
- THEN prior durable files remain parseable and the error identifies any recovery action that did not complete.

#### Implemented By

| Requirement / Scenario | Location / Anchor | Kind | Responsibility |
|---|---|---|---|
| S2/R1 | `src/fs.js#isPathPhysicallyInside` | primary | Resolves existing ancestors before authorizing a child path. |
| S2/R1 | `src/skills.js#applySkillSync` | support | Rechecks every managed-skill target immediately before mutation. |
| S2/R1 | `src/config.js#writeConfig` | support | Refuses a configuration file below a symlinked external `.sdd` directory. |
| S2/R1 | `src/update-migration.js#collectTreeEntries` | support | Rejects symbolic links anywhere inside a legacy Change before migration reads or copies its content. |
| S2/R2 | `src/commands/change-transition.js#transitionChange` | primary | Compares staged `tasks.md` with commit-time content and preserves concurrent edits. |
| S2/R2 | `src/update-migration.js#applyUpdateMigration` | primary | Rechecks planned inputs, publishes without replacement, and rolls the multi-stage transaction back on failure. |
| S2/R2 | `src/commands/change-close.js#closeChange` | primary | Rechecks central status and ownership at commit time. |
| S2/R2-S5 | `src/commands/init-installation.js#initRepository` | primary | Serializes first repository-contract publication under the physical repository owner lock. |
| S2/R2-S5 | `src/mutation.js#withWorkspaceMutationLock` | support | Exclusively reserves the repository mutation boundary and returns an actionable contention error. |
| S2/R3 | `src/fs.js#writeFileAtomically` | primary | Durably replaces configuration and JSON lock state through a synced temporary file. |
| S2/R3 | `src/fs.js#replaceFileAtomically` | primary | Publishes managed files with no-replace semantics and retains recovery state on a concurrent recreation. |
| S2/R3 | `src/fs.js#replaceDirectoryAtomically` | primary | Exclusively reserves managed directories before publishing their staged contents. |
| S2/R3 | `src/mutation.js#withWorkspaceMutationLock` | support | Serializes managed setup and update operations. |
| S2/R3 | `src/installation.js#applyManagedInstallation` | support | Treats workflow, skill, and install-lock updates as one recoverable unit. |
| S2/R3 | `src/update-migration.js#applyUpdateMigration` | support | Coordinates central publication, config upgrades, legacy-source removal, rollback, and explicit incomplete recovery. |
| S2/R3 | `src/commands/init-installation.js#setupInstallation` | support | Runs first-time user setup under the managed transaction and removes newly created durable state on failure. |
| S2/R3 | `src/commands/update.js#updateWorkspace` | support | Serializes user and legacy updates through the shared managed-install transaction. |
| S2/R3 | `src/workflow.js#applyWorkflowSync` | support | Applies, verifies, rolls back, and finalizes managed workflow replacement. |
| S2/R3 | `src/update-migration.js#rollbackTransaction` | support | Restores sources and configs conservatively and reports any state it cannot safely replace. |

#### Implementation Gaps

- None.

#### Verified By

| Requirement / Scenario | Evidence | Proves | Status |
|---|---|---|---|
| S2/R1-S1 | Automated test `test/cli.test.js#init rejects a managed skills path through an external symlink ancestor` | Install planning refuses an external symlink ancestor before writing. | Passing 2026-07-20 |
| S2/R1-S1 | Automated test `test/cli.test.js#change transition rejects an active Change through an external symlink ancestor` | Lifecycle mutation refuses an external artifact root and preserves its contents. | Passing 2026-07-20 |
| S2/R1-S1 | Automated test `test/cli.test.js#validate rejects implementation and test evidence that resolve outside the repository` | Evidence acceptance uses the same physical ownership rule. | Passing 2026-07-20 |
| S2/R1-S1 | Automated test `test/mutation.test.js#fixed SDD mutation paths reject a symlinked config directory` | Workflow, configuration, and lock paths cannot escape through `.sdd`. | Passing 2026-07-20 |
| S2/R1-S1 | Automated test `test/update-migration.test.js#migration preflight fails before writes for divergent copies, cross-Space IDs, destination conflicts, brief collisions, missing identities, and symlink escapes` | Migration rejects symbolic links inside legacy Changes before writing. | Passing 2026-08-07 |
| S2/R2-S1 | Automated test `test/cli.test.js#change transition preserves a concurrent tasks edit` | Commit-time drift aborts and restores the latest `tasks.md`. | Passing 2026-07-20 |
| S2/R2-S2 | Automated test `test/update-migration.test.js#migration detects commit-time drift and rolls published state back on a later failure` | A source edit after preflight aborts before publication and preserves the newer source. | Passing 2026-08-07 |
| S2/R2-S3 | Automated test `test/update-migration.test.js#migration detects commit-time drift and rolls published state back on a later failure` | A later failure restores published central state, upgraded configs, and legacy sources while preserving concurrent destination edits. | Passing 2026-08-07 |
| S2/R2-S4 | Automated test `test/cli.test.js#change close rechecks status at commit time` | Close refuses a Change reopened after preflight. | Passing 2026-07-20 |
| S2/R2-S5 | Automated test `test/cli.test.js#repository init rejects concurrent first initialization without losing the winner` | One initial repository contract wins; the concurrent caller receives `OPERATION_IN_PROGRESS`, and no mutation lock remains. | Passing 2026-07-23 |
| S2/R3-S1 | Automated test `test/mutation.test.js#atomic JSON writes leave one complete parseable document` | Competing lock writes leave one whole parseable document. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/mutation.test.js#atomic JSON writes preserve the existing file mode` | Atomic replacement retains existing permissions. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/mutation.test.js#workspace mutation lock recovers a stale dead-owner lock` | A crashed owner does not permanently block managed mutation. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/mutation.test.js#managed installation rolls back workflow and skills when lock persistence fails` | Workflow and skills roll back if the installation lock cannot commit. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/mutation.test.js#managed installation removes workflow recovery backups after update rollback` | Update rollback restores the old workflow without leaking hidden recovery artifacts. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/mutation.test.js#workflow sync restores the old target when replacement commits then throws` | A post-commit helper failure does not escape workflow recovery. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/mutation.test.js#skill sync restores the old target when replacement commits then throws` | A post-commit helper failure does not escape skill recovery. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/mutation.test.js#managed installation refuses adopt drift before committing its lock` | No-op/adopt targets are rechecked before their hashes enter the lock. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/mutation.test.js#managed installation refuses workflow adopt drift before committing its lock` | Adopted workflow content is rechecked before its hash enters the lock. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/mutation.test.js#managed installation rolls back its lock when adopt drifts during lock persistence` | Targets are rechecked after lock persistence and a newly stale lock is removed. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/mutation.test.js#mutation lock cleans up a failed acquisition write` | Failed lock initialization does not leave a permanent lock or handle. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/mutation.test.js#mutation lock preserves a replacement owned by another operation` | Lock release removes only the caller's token. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/mutation.test.js#first-time setup removes its new config when managed installation fails` | A failed initial setup remains retryable with no partial config or installed skill state. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/mutation.test.js#first-time setup does not follow a dangling gitignore symlink` | Setup cannot create external content through a dangling fixed-child symlink. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/mutation.test.js#first-time legacy init removes new durable state when installation fails` | Failed legacy initialization leaves no partial config, workflow, lock, or skill state. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/mutation.test.js#workflow replacement preserves an edit made inside the replacement window` | File replacement compares the moved target with the expected hash and preserves newer content. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/mutation.test.js#skill replacement preserves an edit made inside the replacement window` | Directory replacement compares the moved target with the expected hash and preserves newer content. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/mutation.test.js#file replacement preserves a target recreated at publish time` | Exclusive file publication cannot overwrite a target recreated after the original is moved. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/mutation.test.js#directory replacement preserves a target recreated at publish time` | Exclusive directory reservation cannot overwrite a target recreated after the original is moved. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/update-migration.test.js#migration detects commit-time drift and rolls published state back on a later failure` | Central migration rollback restores the pre-transaction state and reports incomplete recovery instead of overwriting newer data. | Passing 2026-08-07 |
| S2/R3-S1 | Automated test `test/cli.test.js#update refuses to overlap another managed mutation` | A held operation lock blocks updates without altering durable install state. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/cli.test.js#change transition preserves a concurrent tasks edit` | Central lifecycle mutation returns a concurrent-change error and preserves the latest tasks content. | Passing 2026-08-07 |

#### Verification Gaps

- None.

#### Story Notes

- Physical ownership is evaluated after resolving existing symlink ancestors; it is stronger than lexical `..` rejection.
- Dead-owner mutation locks are reclaimed from a matching ownership record. An alive or unknown PID is conservative: the CLI reports PID and creation time for manual inspection because PID reuse cannot be distinguished portably without platform-specific process-start identity.

### Story S3: Unambiguous Topology And Lifecycle Routing

Implementation: implemented
Verification: verified
Created: 2026-07-20
Modified: 2026-08-07
Last verified: 2026-08-07

As a developer, I want one globally unique Change record with explicit portable repository targets, so that lifecycle commands cannot invent ownership, split status across copies, or mutate outside user-local storage.

#### Requirements And Scenarios

##### Requirement R1: Portable Central Change Creation

The CLI SHALL create one central Change under `~/.sdd/changes/<change-id>/`, record its owning Space and stable repository IDs in `tasks.md`, and allow repository-only Spaces when a portable repository contract provides identity.

###### Scenario R1-S1: Repository-Only Change Create

- WHEN `change create` targets a repository-only synthetic Space with a valid `.sdd/config.yaml` repository ID
- THEN it creates one central Change with that Space and repository ID and writes no repository-local Change folder.

###### Scenario R1-S2: Ambiguous Repository Selection

- WHEN an Idea maps to multiple eligible repositories and no target set is supplied
- THEN creation refuses to guess and writes nothing.

##### Requirement R2: Strict Physical Configuration And Storage

The CLI SHALL reject unknown configuration keys, duplicate physical repository ownership, ambiguous repository IDs, and central Change paths that resolve outside the configured user root.

###### Scenario R2-S1: Alias Or Shape Ambiguity

- WHEN different configured spellings resolve to one repository or an unknown configuration key is present
- THEN configuration validation reports the exact invariant before operational commands continue.

###### Scenario R2-S2: Portable Repository ID Collision

- WHEN a repository contract ID is already claimed by another mapped repository
- THEN context resolution rejects the collision instead of inventing another owner.

###### Scenario R2-S3: Central Store Escapes Its Owner

- WHEN `~/.sdd/changes` or a Change ancestor is symlinked outside the user root
- THEN validation and lifecycle mutation reject the path before reading or writing the external target.

###### Scenario R2-S4: Stale Change Target

- WHEN a central Change names a repository ID that is absent from or owned by another Space
- THEN validation rejects that ownership while Space status keeps the Change visible and identifies each unresolved target.

##### Requirement R3: Global Change Identity And Lifecycle

The CLI SHALL enforce globally unique dated Change IDs across active and closed central storage and SHALL mutate one status or folder location for the complete target set.

###### Scenario R3-S1: Existing Active Or Closed ID

- WHEN `change create` would duplicate an active or closed central Change ID
- THEN normal and dry-run commands report the collision and write nothing.

###### Scenario R3-S2: Compare-And-Set Transition

- WHEN `change transition` receives the expected current status
- THEN it updates the one central `tasks.md`; a stale expected status or concurrent edit leaves the record unchanged.

###### Scenario R3-S3: Central Close

- WHEN `change close` receives an `in_review` Change
- THEN it moves the one record to `~/.sdd/changes/closed/<change-id>/` without writing a synthetic `closed` status.

##### Requirement R4: Fail-Closed Legacy Migration

`sdd update` SHALL preflight every legacy planned, active, and closed Change source plus undated Change Briefs before writing; consolidate only byte-identical copies; publish central records and fixed idea-local briefs atomically with config upgrades; and remain idempotent.

###### Scenario R4-S1: Compatible Automatic Migration

- WHEN legacy copies have unambiguous Space/repository ownership and identical content
- THEN `sdd update` migrates them to the central store, moves undated briefs to `<planning-path>/change-briefs/`, removes retired sources, upgrades config, and a rerun performs no migration.

###### Scenario R4-S2: Conflicting Legacy Sources

- WHEN copies diverge, a Change ID crosses Spaces, target identity is missing, a destination conflicts, a brief collides, or a source escapes through a symlink
- THEN preflight fails before any config, Change, brief, source, or managed installation write.

###### Scenario R4-S3: Commit-Time Failure

- WHEN a source changes after preflight or a later migration step fails
- THEN the transaction rejects concurrent state and restores published central records, upgraded configs, and legacy sources without overwriting newer data.

###### Scenario R4-S4: Process Interruption

- WHEN the updater terminates after publishing a Change, brief, or configuration but before completing source retirement
- THEN the next locked non-dry-run update recovers the durable transaction before replanning, while dry-run reports required recovery without mutating state.

#### Implemented By

| Requirement / Scenario | Location / Anchor | Kind | Responsibility |
|---|---|---|---|
| S3/R1 | `src/commands/change-create.js#createChange` | primary | Creates the one central record and publishes Space/repository metadata in `tasks.md`. |
| S3/R1 | `src/change-repositories.js#resolveRepositoryTargets` | support | Resolves stable mapped or repository-only target IDs without inventing repository-local Change ownership. |
| S3/R2 | `src/config.js#validateConfig` | primary | Enforces current config shape, portable repository IDs, and physical ownership invariants. |
| S3/R2 | `src/workspace.js#resolveWorkspaceContext` | primary | Rejects duplicate physical repositories and ambiguous portable identities while retaining valid repository-only context. |
| S3/R2-S3 | `src/change-store.js#assertChangeStoreConfinement` | primary | Confines active and closed central paths to the configured user root. |
| S3/R3 | `src/change-store.js#listStoredChanges` | primary | Provides one active/closed global inventory and rejects duplicate identity. |
| S3/R3-S2 | `src/commands/change-transition.js#transitionChange` | primary | Applies compare-and-set status mutation to one central `tasks.md`. |
| S3/R3-S3 | `src/commands/change-close.js#closeChange` | primary | Moves one `in_review` central Change into closed history. |
| S3/R4 | `src/update-migration.js#planUpdateMigration` | primary | Discovers and validates the complete legacy source set before writes. |
| S3/R4 | `src/update-migration.js#applyUpdateMigration` | primary | Stages, publishes, removes, rolls back, and reports one atomic migration transaction. |
| S3/R4 | `src/commands/update.js#updateWorkspace` | support | Integrates mandatory migration with managed skill and workflow update. |
| S3/R2-S4 | `src/commands/validate.js#validateCentralChanges` | primary | Rejects missing and cross-Space repository metadata for every central Change. |
| S3/R2-S4 | `src/commands/status.js#buildSpace` | support | Keeps Space-owned Changes visible and reports unresolved target IDs when mappings drift. |
| S3/R4-S4 | `src/update-migration.js#recoverUpdateMigration` | primary | Recovers a physically matched durable migration journal before a new plan reads configuration. |

#### Implementation Gaps

- None.

#### Verified By

| Requirement / Scenario | Evidence | Proves | Status |
|---|---|---|---|
| S3/R1-S1 | Automated test `test/cli.test.js#change create scaffolds a planned Change for a selected repository` | Creation writes one central Change with Space/repository metadata and no repository-local lifecycle copy. | Passing 2026-08-07 |
| S3/R1-S2 | Automated test `test/cli.test.js#change create refuses to guess among multiple mapped repositories` | Ambiguous target selection fails before writes. | Passing 2026-08-07 |
| S3/R2-S1 | Automated tests `test/cli.test.js#runtime config validation rejects unknown keys` and `test/cli.test.js#context rejects physical aliases claimed as different repositories` | Runtime validation rejects unknown shape and duplicate physical ownership. | Passing 2026-08-07 |
| S3/R2-S2 | Automated test `test/cli.test.js#context rejects a repository-only ID that collides with an existing Idea` | A duplicate portable ID cannot silently claim another owner. | Passing 2026-08-07 |
| S3/R2-S3 | Automated tests `test/cli.test.js#validation rejects a central Change store symlinked outside its owner` and `test/cli.test.js#change transition rejects an active Change through an external symlink ancestor` | Reads and mutations cannot escape the user-owned central store. | Passing 2026-08-07 |
| S3/R3-S1 | Automated tests `test/cli.test.js#change create infers a sole repository and refuses an existing Change` and `test/cli.test.js#validate reports an active and closed Change collision` | Active and closed central IDs are globally unique. | Passing 2026-08-07 |
| S3/R3-S2 | Automated tests `test/cli.test.js#change transition updates an active Change with compare-and-set semantics` and `test/cli.test.js#change transition preserves a concurrent tasks edit` | Transition changes one expected status and preserves concurrent edits. | Passing 2026-08-07 |
| S3/R3-S3 | Automated tests `test/cli.test.js#change close moves an in-review Change without writing a closed status` and `test/cli.test.js#change close rechecks status at commit time` | Close uses folder location as terminal state and rechecks the commit-time status. | Passing 2026-08-07 |
| S3/R4-S1 | Automated test `test/update-migration.test.js#automatic update migration consolidates identical Changes, preserves briefs, upgrades configs, and reruns as a no-op` | Compatible legacy state migrates completely and idempotently. | Passing 2026-08-07 |
| S3/R4-S2 | Automated test `test/update-migration.test.js#migration preflight fails before writes for divergent copies, cross-Space IDs, destination conflicts, brief collisions, missing identities, and symlink escapes` | Every named unsafe legacy condition fails before writes. | Passing 2026-08-07 |
| S3/R4-S3 | Automated test `test/update-migration.test.js#migration detects commit-time drift and rolls published state back on a later failure` | Drift and injected failure preserve or restore the complete transaction. | Passing 2026-08-07 |
| S3/R2-S4 | Automated tests `test/cli.test.js#validate rejects absent and cross-Space Change repository IDs deterministically` and `test/cli.test.js#status retains Space-owned Changes whose repository IDs no longer resolve` | Invalid ownership fails validation without hiding the Space-owned work from status. | Passing 2026-08-07 |
| S3/R3-S1 | Automated test `test/cli.test.js#Space-scoped validation reports global Change collisions across metadata Spaces` | A Space projection cannot hide a globally conflicting active/closed ID. | Passing 2026-08-07 |
| S3/R4-S4 | Automated test `test/update-migration.test.js#interrupted migration recovers durably before replanning` | Real child-process termination after Change, brief, and config publication recovers before replanning; tampered or foreign state fails closed. | Passing 2026-08-07 |

#### Verification Gaps

- None.

#### Story Notes

- Repository-only context is a valid portable owner when its repository contract supplies a stable ID.
- Legacy repository Change folders and idea-local dated Change directories are migration inputs only; `sdd update` is the sole supported cutover path.

### Story S4: Bounded And Context-Aware Diagnostics

Implementation: implemented
Verification: verified
Created: 2026-07-20
Modified: 2026-07-20
Last verified: 2026-07-20

As a developer, I want diagnostics to finish within a bound and distinguish obsolete instructions from discussion, so that health checks remain actionable.

#### Requirements And Scenarios

##### Requirement R1: Affirmative Guidance Detection

The CLI SHALL report affirmative obsolete workflow instructions without treating negated, historical, migration, or quoted examples as active guidance.

###### Scenario R1-S1: Negated Or Historical Mention

- WHEN recognized guidance says not to use an obsolete path/command or discusses it historically
- THEN doctor does not report that mention as an active instruction.

##### Requirement R2: Bounded Repository Status

The CLI SHALL time out a stalled Git status process, return degraded metadata for that repository, and continue reporting other repositories.

###### Scenario R2-S1: Hung Git Child

- WHEN one repository's Git status exceeds the configured internal bound
- THEN status completes with a timeout result for that repository.

#### Implemented By

| Requirement / Scenario | Location / Anchor | Kind | Responsibility |
|---|---|---|---|
| S4/R1 | `src/guidance.js#findObsoleteGuidanceReferences` | primary | Classifies only affirmative obsolete instructions outside ignored prose contexts. |
| S4/R1 | `src/commands/doctor.js#diagnoseWorkspace` | support | Integrates guidance classification into repository health findings. |
| S4/R1 | `src/cli.js#HELP` | support | Exposes guidance validation as part of the doctor contract. |
| S4/R2 | `src/commands/status.js#readGitStatus` | primary | Applies the Git child timeout and structured degraded result. |
| S4/R2 | `src/commands/status.js#mapWithConcurrency` | support | Caps concurrent repository Git processes while preserving result order. |

#### Implementation Gaps

- None.

#### Verified By

| Requirement / Scenario | Evidence | Proves | Status |
|---|---|---|---|
| S4/R1-S1 | Automated test `test/diagnostics.test.js#guidance diagnostics ignore negated historical and quoted obsolete references` | Negated, historical, blockquoted, and fenced examples do not become findings. | Passing 2026-07-20 |
| S4/R1-S1 | Automated test `test/diagnostics.test.js#guidance diagnostics still report affirmative obsolete instructions` | Affirmative obsolete instructions remain actionable findings. | Passing 2026-07-20 |
| S4/R2-S1 | Automated test `test/cli.test.js#status degrades one stalled Git repository without blocking its siblings` | One timed-out repository degrades while its sibling returns branch state. | Passing 2026-07-20 |

#### Verification Gaps

- None.

#### Story Notes

- Doctor remains deterministic and does not attempt general natural-language interpretation.

### Story S5: Trustworthy Audit And Handoff Guidance

Implementation: implemented
Verification: verified
Created: 2026-07-22
Modified: 2026-07-23
Last verified: 2026-07-23

As a developer, I want Epic audits and PR/release handoffs to describe the final verified source and exact changed-file scope, so that historical failures or unrelated files cannot be mistaken for a clean candidate.

#### Requirements And Scenarios

##### Requirement R1: Current-State Epic Audit Records

The Epic verification workflow SHALL write versioned immutable reports that separate historical findings from current gates/findings/checks, link later remediation reports to their predecessor, and reconcile multi-Epic report batches before assigning the final result.

###### Scenario R1-S1: Historical Failure After Remediation

- WHEN remediation changes the initial audit result
- THEN the final report keeps the initial failure in an explicitly historical section and derives its verdict only from rerun current gates.

###### Scenario R1-S2: Later Remediation Run

- WHEN a later run changes a previously written report result
- THEN it writes a successor with `supersedes` instead of rewriting the prior audit snapshot.

##### Requirement R2: Exact Publication Scope

The PR and release workflows SHALL classify the complete source-to-target changed-file inventory and recheck it after remediation or release-metadata commits before publication.

###### Scenario R2-S1: Accepted PR Remediation

- WHEN review feedback adds or changes files after the reviewed commit
- THEN `/sdd-pr` recomputes the diff, classifies every path, and stops on unexplained scope before pushing.

###### Scenario R2-S2: Release Candidate Handoff

- WHEN release metadata is committed before the production handoff
- THEN `/sdd-release` compares the final diff path-for-path with the recorded allowlist and reports the reconciliation in the release PR.

##### Requirement R3: Safe Immutable Git Baselines

The orphan-audit workflow SHALL resolve a caller-supplied Git baseline to an immutable commit before diffing, separate revisions from options, and bound every Git subprocess.

###### Scenario R3-S1: Option-Like Baseline

- WHEN `--changed-from` begins with option syntax or otherwise cannot resolve as a commit
- THEN the audit rejects it before diffing and does not permit Git option side effects.

###### Scenario R3-S2: Hung Git Subprocess

- WHEN a Git subprocess exceeds the configured execution bound
- THEN the audit stops promptly with a deterministic actionable failure instead of hanging the workflow.

###### Scenario R3-S3: Changed-Surface Git Failure

- WHEN any required baseline, unstaged, staged, or untracked Git query fails
- THEN the audit fails closed with actionable diagnostics instead of treating missing output as an empty changed surface.

##### Requirement R4: Clean Portable Audit Packaging

The published package SHALL include the orphan-audit source and universal bundled scripts without generated local Python bytecode or cache directories.

###### Scenario R4-S1: Local Compile Before Packaging

- WHEN a local verification run creates Python bytecode beside a bundled audit script
- THEN the package manifest excludes the generated cache while retaining the portable script source.

#### Implemented By

| Requirement / Scenario | Location / Anchor | Kind | Responsibility |
|---|---|---|---|
| S5/R1 | `skills/sdd-epic-verify/SKILL.md#immutable audit snapshot` | primary | Governs immutable report lifecycle, current/historical separation, reruns, successor creation, and final multi-Epic batch coherence. |
| S5/R1 | `skills/sdd-epic-verify/assets/epic-verify-report-template.md#Current Gate Scorecard` | support | Makes current verdict inputs and historical/remediation sections explicit in every new report. |
| S5/R2-S1 | `skills/sdd-pr/SKILL.md#exact source-to-target changed-file inventory` | primary | Requires full PR path classification before creation, remediation commits, and merge readiness. |
| S5/R2-S2 | `skills/sdd-release/SKILL.md#exact source-to-target changed-file inventory` | primary | Establishes and rechecks the release allowlist before commit and publication. |
| S5/R2-S2 | `skills/sdd-release/assets/release-pr-template.md#File Scope Reconciliation` | support | Carries file-scope and documentation/SDD integrity evidence into the handoff. |
| S5/R3 | `skills/sdd-orphan-audit/scripts/sdd_orphan_audit.py#changed_files` | primary | Resolves the baseline to a validated immutable commit and diffs behind an option barrier. |
| S5/R3-S2 | `skills/sdd-orphan-audit/scripts/sdd_orphan_audit.py#run_git_paths` | support | Applies the bounded Git execution contract and actionable timeout failure. |
| S5/R3-S2 | `skills/sdd-orphan-audit/scripts/sdd_orphan_audit.py#git_timeout_seconds` | support | Provides a bounded default with a constrained test/operation override. |
| S5/R3-S3 | `skills/sdd-orphan-audit/scripts/sdd_orphan_audit.py#require_git_paths` | support | Converts every required changed-surface Git query failure into an actionable fail-closed audit result. |
| S5/R4 | `package.json#!**/__pycache__/**` | primary | Excludes generated Python cache directories and bytecode from the published universal skill package. |
| S5/R1, S5/R2 | `docs/story-driven-development.md#Epic verification reports use` | support | Defines the shared package doctrine for report integrity and exact publication scope. |

#### Implementation Gaps

- None.

#### Verified By

| Requirement / Scenario | Evidence | Proves | Status |
|---|---|---|---|
| S5/R1-S1, S5/R1-S2 | Automated test `test/cli.test.js#packaged audit and handoff skills preserve current-state and file-scope gates` | The packaged Epic verification skill retains immutable/current-state and successor requirements. | Passing 2026-07-22 |
| S5/R1-S1 | Automated test `test/cli.test.js#packaged workflow templates preserve boundary, transition, and evidence-integrity contracts` | The canonical report template is versioned, defaults blocked, exposes current findings, and matches the skill asset. | Passing 2026-07-22 |
| S5/R2-S1, S5/R2-S2 | Automated test `test/cli.test.js#packaged audit and handoff skills preserve current-state and file-scope gates` | Both handoff skills retain exact diff inventory gates and the PR skill has no separate `--fix` mode. | Passing 2026-07-22 |
| S5/R2-S2 | Automated test `test/cli.test.js#packaged workflow templates preserve boundary, transition, and evidence-integrity contracts` | The release template mirrors its skill asset and includes file-scope plus SDD-integrity sections. | Passing 2026-07-22 |
| S5/R3-S1 | Automated test `test/orphan-audit.test.js#orphan audit rejects option-like changed-from input without Git side effects` | Option-like baselines are rejected before diffing and cannot create an external output file. | Passing 2026-07-23 |
| S5/R3-S2 | Automated test `test/orphan-audit.test.js#orphan audit fails promptly with an actionable Git timeout` | A stalled Git child is bounded and returns deterministic recovery guidance. | Passing 2026-07-23 |
| S5/R3-S3 | Automated test `test/orphan-audit.test.js#orphan audit fails closed when any changed-surface Git command fails` | Baseline, unstaged, staged, and untracked query failures cannot silently erase changed-surface evidence. | Passing 2026-07-23 |
| S5/R4-S1 | Automated test `test/package.test.js#package manifest excludes generated Python bytecode` | The publish manifest explicitly excludes Python cache directories and `.pyc` files while the dry-run retains the source script. | Passing 2026-07-23 |

#### Verification Gaps

- None.

#### Story Notes

- Workflow skills are implemented package behavior, not incidental documentation; their source files must remain traceable from this Epic.

### Story S6: Reliable Workflow Execution

Implementation: implemented
Verification: verified
Created: 2026-07-23
Modified: 2026-08-07
Last verified: 2026-08-07

As a developer, I want SDD planning, implementation, and review workflows to carry work through a complete evidence-backed handoff, so that an agent does not stop at a partial task, a green command, or the first finding.

#### Requirements And Scenarios

##### Requirement R1: Adaptive Planning And Handoff Records

The packaged planning workflow SHALL define accepted end-state behavior and seed risk, decision fan-out, verification-environment, visual-verification, and candidate-scope obligations without freezing a file-by-file implementation sequence.

###### Scenario R1-S1: Replanning After Review

- WHEN review invalidates Story ownership or verification scope
- THEN `/sdd-change --replan` returns the Change to a coherent planned state with a dated planning update and exact Apply restart point.

##### Requirement R2: Persistent Verified Implementation

Default/full Apply SHALL continue through safe implementation and self-remediation until the Change is ready for independent review or reaches a genuine stop condition, and SHALL commit completed verified slices when policy and isolation permit.

###### Scenario R2-S1: Long Multi-Slice Change

- WHEN one Requirement finishes while more accepted work remains
- THEN Apply reconciles and commits the green slice before continuing instead of reporting the Change ready early.

##### Requirement R3: Comprehensive Independent Review

Review SHALL complete every applicable discovery and verification gate before one consolidated verdict, SHALL treat yielded or long-running commands as continuation points, and SHALL give `--until-ready` the same full final-report contract with a default maximum of five remediation iterations.

###### Scenario R3-S1: Early Blocking Finding

- WHEN one review pass finds a blocking defect
- THEN the reviewer retains it and continues the materially relevant discovery wave before consolidating the verdict.

###### Scenario R3-S2: Yielded Aggregate Gate

- WHEN a required command yields a resumable session or runs longer than a progress interval
- THEN review reports progress, resumes the command, and does not mistake the yield for completion.

##### Requirement R4: Rendered UI Verification

UI-bearing planning SHALL define a proportional Visual Verification Matrix, and Apply/Review SHALL render current source, exercise changed interactions, inspect representative desktop/mobile states and console/network results, and keep owner manual confirmation separate.

###### Scenario R4-S1: Source-Only UI Confidence

- WHEN a UI change passes source, build, or static checks without rendered inspection
- THEN the workflow records rendered verification as pending or blocked rather than review-ready.

##### Requirement R5: Risk-Shaped Evidence Closure

Apply and Review SHALL trigger pattern-parity, boundary-contract, stateful-transition, capability-authority, provenance/budget, filesystem-confinement, aggregate-candidate, and evidence-falsification checks when those boundaries intersect the Change.

###### Scenario R5-S1: Aggregate Green With Weak Scenario Proof

- WHEN a broad gate passes but a high-risk Scenario citation does not assert the claimed boundary
- THEN the workflow keeps the Scenario unverified and records the exact proof gap.

##### Requirement R6: Lightweight Tracked Sessions

The Interactive workflow SHALL create the minimum shared Change artifacts, apply the narrow behavior change immediately, reconcile durable Epic truth, and preserve the same verification and closeout invariants without creating an independent template family.

###### Scenario R6-S1: Small Durable Behavior Change

- WHEN a narrow change deserves a durable record but not a full planning pass
- THEN `/sdd-interactive` creates the trimmed shared artifacts, applies and verifies the work, and routes broader scope back to `/sdd-change --plan`.

##### Requirement R7: One Central Multi-Repository Workflow

Planning, Apply, Review, PR, Release, and Space Status SHALL select one globally unique central Change, derive its full stable repository target set from `tasks.md`, keep repository-owned Epics/code/tests distinct, and perform lifecycle transition or close exactly once after every target passes its gate.

###### Scenario R7-S1: Coordinated Multi-Repository Delivery

- WHEN one Change targets multiple repositories
- THEN every workflow uses the same central artifacts and repository-keyed evidence, never creates or selects a repository-local copy, and never treats one target's completion as global completion.


#### Implemented By

| Requirement / Scenario | Location / Anchor | Kind | Responsibility |
|---|---|---|---|
| S6/R1 | `skills/sdd-change/SKILL.md#Replan Mode` | primary | Governs review-driven replanning, guarded lifecycle transitions, dated planning updates, and the exact Apply restart. |
| S6/R1 | `docs/templates/tasks.md#Decision Fan-Out Ledger` | support | Carries planning decisions and their affected surfaces into delivery. |
| S6/R1 | `docs/templates/tasks.md#Verification Environment` | support | Records required setups and safety boundaries before evidence is claimed. |
| S6/R1 | `docs/templates/tasks.md#Verification Scope Decision` | support | Records aggregate and prospective-integration candidate obligations. |
| S6/R1 | `docs/templates/tasks.md#Visual Verification Matrix` | support | Records proportional rendered states and interactions for UI-bearing work. |
| S6/R1 | `docs/templates/tasks.md#Review Handoff Candidate` | support | Carries immutable candidate identity and remaining obligations into review. |
| S6/R2 | `skills/sdd-apply/SKILL.md#Persistence invariant` | primary | Defines full Apply as an outcome request that continues until review readiness or a genuine stop. |
| S6/R2-S1 | `skills/sdd-apply/SKILL.md#Commit cadence invariant` | primary | Makes a verified artifact-reconciled phase commit part of each completed slice. |
| S6/R2 | `skills/sdd-apply/references/risk-closure.md#Phase Commit` | support | Defines coherent green phase boundaries and immutable handoff behavior. |
| S6/R3 | `skills/sdd-review/SKILL.md#Full-review invariant` | primary | Requires complete applicable discovery despite early findings. |
| S6/R3-S2 | `skills/sdd-review/SKILL.md#Execution-continuity invariant` | primary | Requires yielded and long-running commands to be resumed through completion. |
| S6/R4 | `skills/sdd-design/SKILL.md#Define The Visual Verification Matrix` | primary | Defines proportional rendered states, interactions, viewports, and evidence before implementation. |
| S6/R4 | `skills/sdd-apply/SKILL.md#Apply Loop` | primary | Requires direct rendered inspection of current UI source during implementation. |
| S6/R4 | `skills/sdd-review/SKILL.md#Review Gates` | primary | Keeps deterministic rendered verification distinct from owner manual confirmation. |
| S6/R5 | `skills/sdd-apply/SKILL.md#Verification And Implementation Self-Check` | primary | Runs risk-shaped implementation closure and evidence reconciliation. |
| S6/R5 | `skills/sdd-apply/references/risk-closure.md#Pattern Parity` | support | Requires sibling implementations to preserve shared policy and lifecycle shape. |
| S6/R5 | `skills/sdd-apply/references/risk-closure.md#Boundary Contracts` | support | Requires exact boundary, adapter, failure, and retry mapping. |
| S6/R5 | `skills/sdd-apply/references/risk-closure.md#Stateful Transitions` | support | Requires concurrent and durable state interleavings to be proved. |
| S6/R5 | `skills/sdd-apply/references/risk-closure.md#Authority, Budget, And Mutation Safety` | support | Requires authority, provenance, budget, and filesystem mutation invariants. |
| S6/R5 | `skills/sdd-apply/references/risk-closure.md#Evidence Claim Integrity` | support | Requires exact claimed-boundary evidence to survive falsification. |
| S6/R5 | `skills/sdd-review/SKILL.md#Systematic Review Search` | primary | Independently falsifies claimed behavior and evidence across the candidate. |
| S6/R6 | `skills/sdd-interactive/SKILL.md#Workflow` | primary | Implements a trimmed shared-artifact session with immediate Apply-style execution and routing for broader scope. |
| S6/R7 | `skills/sdd-change/SKILL.md#Common Setup` | primary | Creates and plans one central Change with stable target repository IDs. |
| S6/R7 | `skills/sdd-apply/SKILL.md#Authority And Project Profile` | primary | Orchestrates implementation and the single global transition across the complete target set. |
| S6/R7 | `skills/sdd-review/SKILL.md#Authority And Project Profile` | primary | Reviews all target repositories and records one consolidated verdict and closeout state. |
| S6/R7 | `skills/sdd-pr/SKILL.md#Authority And Project Profile` | primary | Stewards the coordinated repository PR set without duplicating lifecycle ownership. |
| S6/R7 | `skills/sdd-space-status/SKILL.md#Workflow` | support | Presents top-level unique Changes and repository-filtered projections without double-counting. |
| S6/R7 | `skills/sdd-release/SKILL.md#Operating Sequence` | primary | Resolves release readiness from canonical central records and repository-specific gates. |
#### Implementation Gaps

- None.

#### Verified By

| Requirement / Scenario | Evidence | Proves | Status |
|---|---|---|---|
| S6/R1-S1 | Semantic source inspection of `skills/sdd-change/SKILL.md#Replan Mode` and `docs/templates/tasks.md#Planning Updates` | The shipped planning workflow and ledger define guarded replan state, dated discovery, and an exact restart. | Passing 2026-07-23 |
| S6/R2-S1 | Semantic source inspection of `skills/sdd-apply/SKILL.md#Persistence invariant` and `skills/sdd-apply/SKILL.md#Commit cadence invariant` | Apply continues beyond a green slice and commits an isolated reconciled phase before later work. | Passing 2026-07-23 |
| S6/R3-S1, S6/R3-S2 | Semantic source inspection of `skills/sdd-review/SKILL.md#Full-review invariant` and `skills/sdd-review/SKILL.md#Execution-continuity invariant` | Review retains early findings while completing discovery and resumes yielded commands. | Passing 2026-07-23 |
| S6/R4-S1 | Semantic source inspection of `skills/sdd-design/SKILL.md#Define The Visual Verification Matrix`, `skills/sdd-apply/SKILL.md#Apply Loop`, and `skills/sdd-review/SKILL.md#Review Gates` | Design, Apply, and Review jointly reject source-only UI confidence. | Passing 2026-07-23 |
| S6/R5-S1 | Semantic source inspection of `skills/sdd-apply/references/risk-closure.md#Evidence Claim Integrity` and `skills/sdd-review/SKILL.md#Review Gates` | Aggregate success cannot substitute for exact high-risk Scenario proof. | Passing 2026-07-23 |
| S6/R6-S1 | Semantic source inspection of `skills/sdd-interactive/SKILL.md#Workflow` and `skills/sdd-interactive/SKILL.md#Artifact Shape` | Interactive uses trimmed shared artifacts, immediate execution, durable Epic reconciliation, and broader-scope routing. | Passing 2026-07-23 |
| S6/R1-S1 | Automated test `test/workflow-contracts.test.js#packaged change replan preserves a coherent planned handoff and exact Apply restart` | Replan preserves guarded state, complete planning ledgers, template parity, and an exact Apply restart. | Passing 2026-07-23 |
| S6/R2-S1 | Automated test `test/workflow-contracts.test.js#packaged Apply continues after a verified slice and commits the phase before later work` | Full Apply persists beyond one slice and commits each isolated verified artifact-reconciled phase. | Passing 2026-07-23 |
| S6/R3-S1 | Automated test `test/workflow-contracts.test.js#packaged Review completes every applicable gate after an early blocking finding` | Review retains early findings while completing all applicable discovery and scorecard gates. | Passing 2026-07-23 |
| S6/R3-S2 | Automated test `test/workflow-contracts.test.js#packaged Review resumes yielded commands and preserves the full until-ready report contract` | Yielded work resumes, the default cap remains five, and every mode returns the same complete report. | Passing 2026-07-23 |
| S6/R4-S1 | Automated test `test/workflow-contracts.test.js#packaged UI workflows reject source-only confidence without rendered current-source evidence` | Design, Apply, Review, templates, and doctrine consistently require current-source rendered evidence. | Passing 2026-07-23 |
| S6/R5-S1 | Automated test `test/workflow-contracts.test.js#packaged evidence closure keeps high-risk Scenarios unverified when only an aggregate gate passes` | Risk closure and review require exact claimed-boundary proof beyond an aggregate green result. | Passing 2026-07-23 |
| S6/R6-S1 | Automated test `test/workflow-contracts.test.js#packaged Interactive workflow tracks one lightweight request through an honest review handoff` | Interactive keeps trimmed shared artifacts, immediate tracked execution, validation, and honest handoff semantics. | Passing 2026-07-23 |
| S6/R7-S1 | Automated test `test/workflow-contracts.test.js#packaged workflows coordinate one central Change across every target repository` | All delivery workflows share the central layout, full target-set invariant, repo-free global lifecycle, and projection semantics without legacy Change paths. | Passing 2026-08-07 |

#### Verification Gaps

- None.

#### Story Notes

- Instruction source is executable package behavior for agent workflows; semantic contract tests should prove complete operative clauses rather than isolated strings.

### Story S7: Accessible Public Methodology Reference

Implementation: implemented
Verification: verified
Created: 2026-07-23
Modified: 2026-08-07
Last verified: 2026-08-07

As a developer or coding agent, I want one readable public guide to explain the SDD problem, durable behavior model, general workflow, and package implementation, so that I can understand the method and find the correct entry point without reverse-engineering the repository.

#### Requirements And Scenarios

##### Requirement R1: Methodology And Implementation Separation

The public guide SHALL explain the context-loss problem, portable SDD model, durable Story semantics, and a complete example before describing this package's document layout, CLI, and agent skills.

###### Scenario R1-S1: Behavior Changes After Implementation

- WHEN the guide explains how accepted behavior evolves
- THEN it says to update the existing durable Story and reserve new Stories for distinct user outcomes rather than implementation tasks.

##### Requirement R2: Navigable Responsive Documentation

The guide SHALL provide sequential headings, current-location navigation, readable bounded content, and contained long-form evidence/examples across representative desktop and mobile widths without page-level overflow.

###### Scenario R2-S1: Narrow Viewport Navigation

- WHEN the guide is opened at the minimum supported mobile width
- THEN navigation and controls remain reachable without collision or horizontal page overflow.

##### Requirement R3: Accessible Interaction Feedback

The guide SHALL expose visible keyboard focus, a working skip link, touch-sized controls, canonical labels, and announced copy success or selectable fallback behavior.

###### Scenario R3-S1: Clipboard Failure

- WHEN command copying is unavailable
- THEN the command text is selected and the control exposes temporary visible feedback instead of failing silently.

##### Requirement R4: Steel Documentation Presentation

The guide SHALL use the shared Steel semantic identity as restrained documentation, with readable contrast, balanced headings, reduced-motion behavior, and contained surfaces reserved for documents, evidence, code, and controls.

###### Scenario R4-S1: Reduced Motion

- WHEN the user prefers reduced motion
- THEN smooth scrolling and nonessential transition duration are reduced without breaking navigation feedback.

##### Requirement R5: Canonical Change Lifecycle Documentation

The public package documentation SHALL distinguish one user-level central Change record from repository-local Epic/code/test truth, explain repository projections and global lifecycle commands, and document `sdd update` as the automatic fail-closed migration path for legacy Changes and briefs.

###### Scenario R5-S1: Legacy Workspace Upgrade

- WHEN a developer reads the installation or lifecycle guide for an older workspace
- THEN the guide directs them to preview and run `sdd update`, names compatible consolidation and blocking conflicts, and never instructs them to promote or maintain repository-local Change copies.


#### Implemented By

| Requirement / Scenario | Location / Anchor | Kind | Responsibility |
|---|---|---|---|
| S7/R1 | `site/index.html#A Change updates the Story. It does not replace it.` | primary | Presents the portable problem, method, durable Story semantics, generalized workflow, and complete Epic example before package-specific material. |
| S7/R2 | `site/index.html#Documentation navigation` | primary | Defines the sequential document structure and reachable section navigation. |
| S7/R2 | `site/site.js#updateCurrentNavigation` | primary | Tracks the current visible section and synchronizes desktop and mobile navigation. |
| S7/R2 | `site/styles.css#Documentation shell` | primary | Bounds the reading layout and contains responsive navigation, tables, and code examples. |
| S7/R3 | `site/index.html#Skip to content` | primary | Defines keyboard bypass, canonical labels, command target, and announced feedback surface. |
| S7/R3-S1 | `site/site.js#copyButton?.addEventListener` | primary | Copies the command or selects it on clipboard failure when selection is available; otherwise exposes temporary failure feedback without throwing. |
| S7/R3 | `site/styles.css#:focus-visible` | support | Provides visible focus and touch-sized interactive treatment. |
| S7/R4 | `site/styles.css#UI Foundations: Steel identity profile` | primary | Implements the Steel semantic palette and restrained documentation composition. |
| S7/R4-S1 | `site/styles.css#@media (prefers-reduced-motion: reduce)` | primary | Reduces smooth scrolling and transition duration while preserving state. |
| S7/R5 | `README.md#Upgrading From 0.10.1 Or Earlier` | primary | Defines central ownership, fixed brief storage, global lifecycle commands, projections, and update migration behavior. |
| S7/R5 | `site/index.html#Planning, project truth, and Changes have distinct owners.` | primary | Presents the same lifecycle and migration contract in the public guide. |

#### Implementation Gaps

- None.

#### Verified By

| Requirement / Scenario | Evidence | Proves | Status |
|---|---|---|---|
| S7/R1-S1 | Semantic source inspection of `site/index.html#A Change updates the Story. It does not replace it.` | The portable methodology and durable behavior example precede package implementation detail. | Passing 2026-07-23 |
| S7/R2-S1 | Historical rendered review of candidate `c477e4a` at desktop, tablet, and mobile widths | The prior Steel candidate retained reachable navigation and avoided page-level overflow. | Provisional 2026-07-22 |
| S7/R4-S1 | Historical rendered review of candidate `c477e4a` with reduced-motion emulation | The prior Steel candidate reduced motion without losing active navigation state. | Provisional 2026-07-22 |
| S7/R1-S1 | Automated test `test/site.test.js#public guide separates portable methodology from package implementation and preserves durable Story semantics` | Portable method sections and a canonical durable Story example precede package-specific implementation. | Passing 2026-07-23 |
| S7/R2-S1 | Automated test `test/site.test.js#public guide has unique fragment targets and sequential navigable sections` | IDs are unique, same-page fragments resolve, and skip/document navigation targets exist. | Passing 2026-07-23 |
| S7/R3-S1, S7/R4-S1 | Automated test `test/site.test.js#public guide preserves clipboard fallback feedback and reduced-motion behavior` | Source retains selectable announced clipboard fallback when its DOM and selection APIs exist, announces a safe failure otherwise, and preserves focus and reduced-motion rules. | Passing 2026-07-23 |
| S7/R2-S1 | Deterministic rendered inspection of committed candidate `666de8f` at 1440×900, 768×1024, 375×812, 320×812, and 812×375 | Navigation remains reachable, mobile controls measure 44px, long content is contained, and every viewport has equal document scroll/client width. | Passing 2026-07-23 |
| S7/R3-S1 | Deterministic browser interaction on `site/site.js` clipboard-fallback remediation with clipboard denial, missing command text, and keyboard skip-link interaction | Clipboard denial selects the full command and announces `Selected` when selection is available; missing command text announces `Copy failed` without a runtime error; the visible skip link moves focus to `main-content`. | Passing 2026-07-23 |
| S7/R4-S1 | Deterministic rendered inspection of committed candidate `666de8f` with reduced-motion emulation and direct screenshot review | Scroll behavior becomes `auto`, transitions reduce to `0.00001s`, active navigation remains intact, and the restrained Steel composition remains readable. | Passing 2026-07-23 |
| S7/R5-S1 | Automated test `test/site.test.js#public guide documents central Change ownership and fail-closed automatic migration` | The guide names the central store, fixed brief directory, metadata ownership, projection semantics, and complete fail-closed migration contract without retired promotion guidance. | Passing 2026-08-07 |

#### Verification Gaps

- None.

#### Story Notes

- README and changelog entries communicate S7; they do not own or prove the public-guide behavior.
- Owner preference confirmation of the exact final Steel candidate remains `pending user` and is tracked separately from deterministic Story verification.

## Cross-Story Concerns

- Structured JSON errors/results remain stable enough for agent and future Dashboard/plugin clients.
- Path, topology, and evidence checks share one ownership model across commands.
- Focused tests use disposable fixtures and never mutate external user data.

## Open Decisions

- None.

## Completion Criteria

This Epic is healthy when:

- Embedded Stories cover the current scope.
- Requirements and Scenarios describe implemented behavior or intentional gaps.
- Story implementation and verification state match the Story Index and their respective gap sections.
- `Implemented By` maps every implemented Requirement to a concrete repository-relative location and stable code anchor.
- `Implementation Gaps` names accepted behavior that does not exist yet.
- `Verified By` maps concrete evidence to Requirements/Scenarios; automated evidence uses an existing repository-relative `path#exact test title or stable anchor`, and `Proves` names the important assertion or observation.
- `Verification Gaps` are real, current, and explicit.
- Related changes, docs, indexes, reviews, and release communication do not contradict this Epic.

## Notes

- Active and closed implementation records live in the user-level central Change store. Historical repository-local Change directories are migration inputs and are removed by `sdd update`.
