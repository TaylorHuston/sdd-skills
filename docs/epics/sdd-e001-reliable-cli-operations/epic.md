---
schema: sdd-epic-v2
id: SDD-E001
status: active
created: 2026-07-20
modified: 2026-08-09
last_verified: 2026-08-09
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
- Related ADRs: `docs/adrs/2026-08-07-centralize-change-storage.md`, `docs/adrs/2026-08-07-workspace-scoped-installation.md`.

Developers and agents rely on the CLI and packaged skills as one toolchain. Deterministic results must be trustworthy, mutations must remain inside declared ownership, audit reports must distinguish current from historical state, and review/release handoffs must contain only classified scope.

## Outcome

Developers can validate SDD artifacts, mutate lifecycle state, resolve topology, audit Epics, and prepare review/release handoffs with explicit evidence, physical containment, provenance-bounded recovery, current-state reporting, exact diff scope, and bounded diagnostics.

## Current Scope

- Trustworthy v2 Epic structure and evidence validation.
- Physically contained local filesystem mutation with provenance-bounded recovery.
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
| S2 | implemented | verified | Mutate only inside physical owner boundaries and recover authenticated state safely. | 2026-08-09 | Central lifecycle, migration, configuration, and managed-install mutations reject drift; `sdd update` committed partial cleanup fails closed and retains recovery artifacts when complete source-derived destination guards cannot be reconstructed. |
| S3 | implemented | verified | Route one workspace-unique central Change across portable repository targets. | 2026-08-09 | Creation, lifecycle, physical confinement, deterministic discovery, and explicit fail-closed user-v1/v2 migration use one workspace-owned store. |
| S4 | implemented | verified | Complete diagnostics within a bound without prose false positives. | 2026-07-20 | Guidance is affirmative-only and Git work is bounded. |
| S5 | implemented | verified | Preserve current audit truth and exact publication scope. | 2026-07-23 | Reports are versioned; PR/release paths are classified and rechecked; Git baselines are immutable and bounded. |
| S6 | implemented | verified | Carry one central multi-repository workflow through a complete evidence-backed handoff. | 2026-08-09 | Every shipped workflow shares one target set and one workspace-wide Change lifecycle while preserving repository-owned truth. |
| S7 | implemented | partial | Explain the portable method and package through accessible responsive documentation. | 2026-08-09 | User-v1/v2 and provenance-limited migration copy is current; current-source responsive rendering awaits Main capture and manual confirmation awaits the user. |

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
Modified: 2026-08-09
Last verified: 2026-08-09

As a developer, I want filesystem mutations to stay inside their physical repository or selected workspace owner and preserve concurrent work, so that setup and lifecycle commands cannot silently damage unrelated data.

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

##### Requirement R4: Workspace-Owned Managed Installation

The CLI SHALL keep workspace configuration, Change storage, recovery state, and installation evidence under `<workspace>/.sdd/`; install managed skills under `<workspace>/.agents/skills/` by default; and reject any configured managed-skill path whose physical target escapes the workspace.

###### Scenario R4-S1: Managed Skill Escape

- WHEN setup resolves a configured managed-skill directory outside the selected workspace through an absolute path, `..`, or symlink ancestry
- THEN it fails before writing the directory, workflow, configuration, or installation evidence.

###### Scenario R4-S2: No Home Mutation

- WHEN setup, update, or lifecycle mutation runs for an explicit disposable workspace
- THEN every SDD-owned write stays under that workspace or an explicitly targeted repository and no home-scoped SDD state is read or written.

#### Implemented By

| Requirement / Scenario | Location / Anchor | Kind | Responsibility |
|---|---|---|---|
| S2/R1 | `src/fs.js#isPathPhysicallyInside` | primary | Resolves existing ancestors before authorizing a child path. |
| S2/R1 | `src/skills.js#applySkillSync` | support | Rechecks every managed-skill target immediately before mutation. |
| S2/R1 | `src/config.js#writeWorkspaceConfig` | support | Refuses a configuration file below a symlinked external `.sdd` directory. |
| S2/R1 | `src/update-migration.js#collectTreeEntries` | support | Rejects symbolic links anywhere inside a legacy Change before migration reads or copies its content. |
| S2/R2 | `src/commands/change-transition.js#transitionChange` | primary | Compares staged `tasks.md` with commit-time content and preserves concurrent edits. |
| S2/R2 | `src/change-transition-transaction.js#createTransitionTransactionJournal` | support | Binds transition intent and recovery state to durable identity-checked receipts. |
| S2/R2 | `src/update-migration.js#applyUpdateMigration` | primary | Rechecks planned inputs, publishes without replacement, and rolls the multi-stage transaction back on failure. |
| S2/R2 | `src/commands/change-close.js#closeChange` | primary | Rechecks central status and ownership at commit time. |
| S2/R2 | `src/change-close-transaction.js#createCloseTransactionJournal` | support | Binds close intent and recovery state to durable identity-checked receipts. |
| S2/R2-S5 | `src/commands/init-installation.js#initRepository` | primary | Serializes first repository-contract publication under the physical repository owner lock. |
| S2/R2-S5 | `src/mutation.js#withWorkspaceMutationLock` | support | Exclusively reserves the repository mutation boundary and returns an actionable contention error. |
| S2/R3 | `src/fs.js#writeFileAtomically` | primary | Durably replaces configuration and JSON lock state through a synced temporary file. |
| S2/R3 | `src/fs.js#replaceFileAtomically` | primary | Publishes managed files with no-replace semantics and retains recovery state on a concurrent recreation. |
| S2/R3 | `src/fs.js#replaceDirectoryAtomically` | primary | Exclusively reserves managed directories before publishing their staged contents. |
| S2/R3 | `src/directory-publication.js#publishFlatDirectoryWithoutReplace` | primary | Publishes staged directory trees without replacement and retains identity-bound recovery state. |
| S2/R3 | `src/mutation.js#withWorkspaceMutationLock` | support | Serializes managed setup and update operations. |
| S2/R3 | `src/installation.js#applyManagedInstallation` | support | Treats workflow, skill, and install-lock updates as one recoverable unit. |
| S2/R3 | `src/update-migration.js#applyUpdateMigration` | support | Coordinates central publication, config upgrades, legacy-source removal, rollback, and explicit incomplete recovery. |
| S2/R3 | `src/update-migration.js#recoverUpdateMigration` | primary | Re-authorizes interrupted update state and completes committed cleanup only when the complete source-derived destination guard set remains reconstructable; otherwise retains recovery artifacts and reports failure. |
| S2/R3 | `src/commands/init-installation.js#setupInstallation` | support | Runs first-time workspace setup under the managed transaction and removes newly created durable state on failure. |
| S2/R3 | `src/commands/update.js#updateWorkspace` | support | Serializes workspace-local managed refresh through the shared installation transaction. |
| S2/R3 | `src/workflow.js#applyWorkflowSync` | support | Applies, verifies, rolls back, and finalizes managed workflow replacement. |
| S2/R3 | `src/update-migration.js#rollbackTransaction` | support | Restores sources and configs conservatively and reports any state it cannot safely replace. |
| S2/R3 | `src/legacy-user-migration.js#publish` | support | Persists backup and publication intent before each rename so rollback can distinguish not-started from completed moves. |
| S2/R3 | `src/legacy-user-migration.js#retire` | support | Persists deterministic home-migration source-retirement intent and resumes authenticated states on either side of the rename only after journal and provenance authorization. |
| S2/R3 | `src/legacy-user-migration.js#assertJournal` | support | Treats recovery journals as untrusted input and validates record states plus lexical and physical transaction confinement before mutation. |
| S2/R4 | `src/commands/init-installation.js#setupInstallation` | primary | Creates or migrates the selected workspace's configuration, workflow, install lock, and contained managed-skill registry. |
| S2/R4 | `src/config.js#resolveWorkspaceSkillsDirectory` | support | Rejects lexical or physical managed-skill paths outside the workspace owner. |

#### Implementation Gaps

- None.

#### Verified By

| Requirement / Scenario | Evidence | Proves | Status |
|---|---|---|---|
| S2/R1-S1 | Automated test `test/cli.test.js#setup rejects a managed skills path through an external symlink ancestor` | Install planning refuses an external symlink ancestor before writing. | Passing 2026-08-07 |
| S2/R1-S1 | Automated test `test/cli.test.js#change transition rejects an active Change through an external symlink ancestor` | Lifecycle mutation refuses an external artifact root and preserves its contents. | Passing 2026-07-20 |
| S2/R1-S1 | Automated test `test/cli.test.js#validate rejects implementation and test evidence that resolve outside the repository` | Evidence acceptance uses the same physical ownership rule. | Passing 2026-07-20 |
| S2/R1-S1 | Automated test `test/mutation.test.js#fixed SDD mutation paths reject a symlinked config directory` | Workflow, configuration, and lock paths cannot escape through `.sdd`. | Passing 2026-07-20 |
| S2/R1-S1 | Automated test `test/update-migration.test.js#migration preflight fails before writes for divergent copies, cross-Space IDs, destination conflicts, brief collisions, missing identities, and symlink escapes` | Migration rejects symbolic links inside legacy Changes before writing. | Passing 2026-08-07 |
| S2/R2-S1 | Automated tests `test/cli.test.js#change transition preserves and can retry a concurrent pre-backup tasks edit` and `test/change-file-authority.test.js#close and transition cannot commit after same-byte tasks inode substitution` | Commit-time drift and same-byte identity replacement abort without losing the latest `tasks.md`. | Passing 2026-08-10 |
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
| S2/R3-S1 | Automated test `test/mutation.test.js#managed installation rejects a same-byte skill inode swap before lock commit` | No-op/adopt skill targets are identity-rechecked before their hashes enter the lock. | Passing 2026-08-10 |
| S2/R3-S1 | Automated test `test/mutation.test.js#managed installation rejects a same-byte workflow inode swap before lock commit` | Adopted workflow content is identity-rechecked before its hash enters the lock. | Passing 2026-08-10 |
| S2/R3-S1 | Automated test `test/mutation.test.js#managed installation rolls back its lock when adopt drifts during lock persistence` | Targets are rechecked after lock persistence and a newly stale lock is removed. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/mutation.test.js#mutation lock cleans up a failed acquisition write` | Failed lock initialization does not leave a permanent lock or handle. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/mutation.test.js#mutation lock reports release failure and preserves a replacement owner` | Lock release removes only the caller's token and reports a retained replacement owner. | Passing 2026-08-09 |
| S2/R3-S1 | Automated test `test/mutation.test.js#first-time setup removes its new config when managed installation fails` | A failed initial setup remains retryable with no partial config or installed skill state. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/mutation.test.js#first-time setup rejects a dangling gitignore without replacing it` | Setup cannot create external content through a dangling fixed-child symlink. | Passing 2026-08-10 |
| S2/R3-S1 | Automated test `test/mutation.test.js#workflow replacement preserves an edit made inside the replacement window` | File replacement compares the moved target with the expected hash and preserves newer content. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/mutation.test.js#skill replacement preserves an edit made inside the replacement window` | Directory replacement compares the moved target with the expected hash and preserves newer content. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/mutation.test.js#file replacement preserves a target recreated at publish time` | Exclusive file publication cannot overwrite a target recreated after the original is moved. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/mutation.test.js#directory replacement preserves a target recreated at publish time` | Exclusive directory reservation cannot overwrite a target recreated after the original is moved. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/update-migration.test.js#migration detects commit-time drift and rolls published state back on a later failure` | Central migration rollback restores the pre-transaction state and reports incomplete recovery instead of overwriting newer data. | Passing 2026-08-07 |
| S2/R3-S1 | Automated test `test/update-migration.test.js#committed cleanup fails closed when an external receipt outlives source authority` | When an update journal is committed after partial cleanup and the complete source-derived destination guard set cannot be reconstructed, `sdd update` reports `MUTATION_RECOVERY_FAILED`, retains the remaining backup byte-for-byte, leaves source paths absent, and preserves the unchanged journal and staging directory rather than inferring cleanup authority. | Pending aggregate execution 2026-08-10 |
| S2/R3-S1 | Automated tests `test/legacy-user-migration.test.js#legacy user migration recovery rolls back an install interrupted after publication rename`, `test/legacy-user-migration.test.js#legacy user migration recovery removes only its owned empty publication reservation`, `test/legacy-user-migration.test.js#legacy user migration recovery completes an install interrupted after source-retirement rename`, and `test/legacy-user-migration.test.js#legacy user migration recovery completes a replacement interrupted after source-retirement rename` | Durable intent, exclusive file publication, authenticated directory reservations, and exact snapshots recover install and replacement transactions only across the publication and retirement boundaries authenticated by transaction-created evidence. | Passing 2026-08-07 |
| S2/R1-S1, S2/R3-S1 | Automated tests `test/legacy-user-migration.test.js#legacy user migration recovery rejects malformed journal records and states`, `test/legacy-user-migration.test.js#legacy user migration recovery rejects same-basename journal redirects outside configured owners`, `test/legacy-user-migration.test.js#legacy user migration recovery rejects configured owner paths through external symlinks`, `test/legacy-user-migration.test.js#legacy user migration preserves a replacement edited between its check and backup rename`, `test/legacy-user-migration.test.js#legacy user migration exclusively publishes without overwriting a destination that reappears`, `test/legacy-user-migration.test.js#legacy user migration restores a source edited immediately before retirement rename`, `test/legacy-user-migration.test.js#legacy user migration preserves a source that reappears after retirement rename`, and `test/legacy-user-migration.test.js#legacy user migration restores an opaque destination moved during rollback` | Untrusted journal paths stay bound to authenticated configured owners, and every injected destination/source rename race preserves concurrent regular, directory, or opaque state instead of overwriting or deleting it. | Passing 2026-08-07 |
| S2/R3-S1 | Automated test `test/legacy-user-migration.test.js#legacy user migration recovery completes a partially removed directory retirement` | A surviving subset of an interrupted directory retirement may complete when source-derived transaction provenance authenticates the original full directory and remaining entries and is independently bound outside the staged transaction. | Source-inspected 2026-08-09 |
| S2/R3-S1 | Automated test `test/legacy-user-migration.test.js#legacy user migration never recursively removes opaque transfer-tree replacements` | The `retiring source` subcase proves a concurrent opaque replacement fails closed, preserves both the replacement and displaced owned source, and retains the stage instead of inferring recursive ownership. | Pending aggregate execution 2026-08-10 |
| S2/R3-S1 | Automated test `test/cli.test.js#update refuses to overlap another managed mutation` | A held operation lock blocks updates without altering durable install state. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/cli.test.js#change transition preserves and can retry a concurrent pre-backup tasks edit` | Central lifecycle mutation returns a concurrent-change error, preserves the latest tasks content, and remains retryable. | Passing 2026-08-10 |
| S2/R4-S1 | Automated tests `test/workspace-config.test.js#managed skill directory is lexically and physically workspace-contained` and `test/cli.test.js#setup rejects a managed skills path through an external symlink ancestor` | Setup rejects absolute, traversal, and symlink escapes before installation writes. | Passing 2026-08-07 |
| S2/R4-S2 | Automated tests `test/cli.test.js#CLI setup owns only the explicit workspace and exposes workspace output fields` and `test/workspace-config.test.js#workspace discovery never falls back to HOME or SDD_USER_HOME` | Setup and discovery ignore decoy home installations and write only below the selected workspace. | Passing 2026-08-07 |

#### Verification Gaps

- None.

#### Story Notes

- Physical ownership is evaluated after resolving existing symlink ancestors; it is stronger than lexical `..` rejection.
- Dead-owner mutation locks are reclaimed from a matching ownership record. An alive or unknown PID is conservative: the CLI reports PID and creation time for manual inspection because PID reuse cannot be distinguished portably without platform-specific process-start identity.
- `sdd update` recovery has an explicit committed-cleanup limit. If partial cleanup has removed evidence needed to reconstruct the complete source-derived destination guard set, recovery fails closed with `MUTATION_RECOVERY_FAILED` and retains every recovery artifact still present, including the remaining backup, unchanged journal, and staging directory, for manual inspection.
- Home-migration recovery has a separate transaction-provenance contract. A partially removed retirement may resume only while transaction-created recursive proofs authenticate the original source and every surviving entry and an independent workspace authority binds the exact provenance bytes and stage identity. Missing complete authenticated provenance or an opaque, new, or replaced entry fails closed and leaves state for manual inspection; in particular, a committed stage residue whose journal/provenance was removed before stage-root cleanup has no automatic recovery path.

### Story S3: Unambiguous Topology And Lifecycle Routing

Implementation: implemented
Verification: verified
Created: 2026-07-20
Modified: 2026-08-09
Last verified: 2026-08-09

As a developer, I want one workspace-unique Change record with explicit portable repository targets, so that lifecycle commands cannot invent ownership, split status across copies, or mutate outside the selected workspace.

#### Requirements And Scenarios

##### Requirement R1: Portable Central Change Creation

The CLI SHALL create one central Change under `<workspace>/.sdd/changes/<change-id>/`, record its owning Space and stable repository IDs in `tasks.md`, and allow repository-only Spaces when a portable repository contract provides identity.

###### Scenario R1-S1: Repository-Only Change Create

- WHEN `change create` targets a repository-only synthetic Space with a valid `.sdd/config.yaml` repository ID
- THEN it creates one central Change with that Space and repository ID and writes no repository-local Change folder.

###### Scenario R1-S2: Ambiguous Repository Selection

- WHEN an Idea maps to multiple eligible repositories and no target set is supplied
- THEN creation refuses to guess and writes nothing.

##### Requirement R2: Strict Physical Configuration And Storage

The CLI SHALL reject unknown configuration keys, duplicate physical repository ownership, ambiguous repository IDs, and central Change paths that resolve outside the selected workspace.

###### Scenario R2-S1: Alias Or Shape Ambiguity

- WHEN different configured spellings resolve to one repository or an unknown configuration key is present
- THEN configuration validation reports the exact invariant before operational commands continue.

###### Scenario R2-S2: Portable Repository ID Collision

- WHEN a repository contract ID is already claimed by another mapped repository
- THEN context resolution rejects the collision instead of inventing another owner.

###### Scenario R2-S3: Central Store Escapes Its Owner

- WHEN `<workspace>/.sdd/changes` or a Change ancestor is symlinked outside the workspace
- THEN validation and lifecycle mutation reject the path before reading or writing the external target.

###### Scenario R2-S4: Stale Change Target

- WHEN a central Change names a repository ID that is absent from or owned by another Space
- THEN validation rejects that ownership while Space status keeps the Change visible and identifies each unresolved target.

##### Requirement R3: Workspace-Unique Change Identity And Lifecycle

The CLI SHALL enforce unique dated Change IDs across active and closed central storage within one workspace and SHALL mutate one status or folder location for the complete target set.

###### Scenario R3-S1: Existing Active Or Closed ID

- WHEN `change create` would duplicate an active or closed central Change ID
- THEN normal and dry-run commands report the collision and write nothing.

###### Scenario R3-S2: Compare-And-Set Transition

- WHEN `change transition` receives the expected current status
- THEN it updates the one central `tasks.md`; a stale expected status or concurrent edit leaves the record unchanged.

###### Scenario R3-S3: Central Close

- WHEN `change close` receives an `in_review` Change
- THEN it moves the one record to `<workspace>/.sdd/changes/closed/<change-id>/` without writing a synthetic `closed` status.

##### Requirement R4: Explicit Fail-Closed User Migration

`sdd setup <workspace> --from-user <old-user-root>` SHALL accept home-root workspace v1-v3 and released legacy `kind: user` version 1 and version 2 state only as explicit migration input, support a no-write `--dry-run`, preflight the complete source and destination before writing, preserve exact Change contents and safe relative topology, keep explicit external repository roots absolute, retire only SDD-owned legacy state after commit, and remain idempotent only for provenance-complete remaining work.

###### Scenario R4-S1: Dry-Run Migration

- WHEN a developer selects a valid legacy user root and passes `--dry-run`
- THEN setup reports the complete migration plan and conflicts without changing the source, destination, managed skills, workflow, or configuration.

###### Scenario R4-S2: Compatible Explicit Migration

- WHEN the legacy source is supported and every destination is unambiguous and unmodified
- THEN setup imports its configuration and Changes into the selected workspace, rebases contained paths, retains explicit external roots, installs workspace-managed assets, retires only SDD-owned source state after commit, and a rerun is a no-op.

###### Scenario R4-S3: Conflicting Or Modified Source

- WHEN source/destination state collides, a source changes after preflight, identity is ambiguous, or a path escapes its declared owner
- THEN migration fails closed without overwriting newer or unrelated data and reports any exact recovery action still required.

###### Scenario R4-S4: Interrupted Migration

- WHEN migration terminates after publishing destination state but before source retirement completes
- THEN the next locked non-dry-run migration recovers or safely resumes only when complete source-derived transaction provenance is independently bound outside the staged transaction and authenticates the remaining work; otherwise it fails closed and retains state for manual inspection, while dry-run reports the required recovery without mutation.

##### Requirement R5: Deterministic Workspace Discovery

The CLI SHALL resolve an explicit command workspace first, then `SDD_WORKSPACE_ROOT`, then the nearest workspace ancestor of the target, and only for a mapped external target the nearest workspace ancestor of the current directory; it SHALL never infer ownership from the operating-system home directory.

###### Scenario R5-S1: Contained Repository Discovery

- WHEN a target repository is physically contained by exactly one valid workspace ancestor
- THEN operational commands select that nearest workspace without a separate flag.

###### Scenario R5-S2: External Repository Requires Selection

- WHEN a target repository is outside every workspace ancestor and no explicit or environment workspace maps it
- THEN the command fails with workspace-selection guidance and performs no home-directory fallback or mutation.

#### Implemented By

| Requirement / Scenario | Location / Anchor | Kind | Responsibility |
|---|---|---|---|
| S3/R1, S3/R3-S1 | `src/commands/change-create.js#createChange` | primary | Creates the one central record, publishes Space/repository metadata in `tasks.md`, and rejects an active or closed ID both before staging and immediately before publication. |
| S3/R1 | `src/change-repositories.js#resolveRepositoryTargets` | support | Resolves stable mapped or repository-only target IDs without inventing repository-local Change ownership. |
| S3/R2 | `src/config.js#validateConfig` | primary | Enforces current config shape, portable repository IDs, and physical ownership invariants. |
| S3/R2 | `schemas/workspace.schema.json#sdd-v3` | support | Publishes the checked workspace configuration contract. |
| S3/R2 | `schemas/repository.schema.json#sdd-repository-v2` | support | Publishes the checked portable repository contract. |
| S3/R2 | `src/workspace.js#resolveWorkspaceContext` | primary | Rejects duplicate physical repositories and ambiguous portable identities while retaining valid repository-only context. |
| S3/R2-S3 | `src/change-store.js#assertChangeStoreConfinement` | primary | Confines active and closed central paths to the selected workspace. |
| S3/R3 | `src/change-store.js#listStoredChanges` | support | Enumerates the active and closed workspace inventory without assigning uniqueness-enforcement responsibility to the inventory helper. |
| S3/R3-S2 | `src/commands/change-transition.js#transitionChange` | primary | Applies compare-and-set status mutation to one central `tasks.md`. |
| S3/R3-S3 | `src/commands/change-close.js#closeChange` | primary | Moves one `in_review` central Change into closed history. |
| S3/R2-S4, S3/R3-S1 | `src/commands/validate.js#validateCentralChanges` | primary | Rejects missing and cross-Space repository metadata and reports an active/closed ID collision for every central Change. |
| S3/R2-S4 | `src/commands/status.js#buildSpace` | support | Keeps Space-owned Changes visible and reports unresolved target IDs when mappings drift. |
| S3/R3-S1 | `src/commands/status.js#readCentralChanges` | support | Refuses to project an active/closed duplicate as two independent status records. |
| S3/R3-S1 | `src/change-status.js#inspectChangeStatuses` | support | Reports active/closed duplicate identity through workspace diagnostics. |
| S3/R4 | `src/legacy-user-migration.js#planLegacyUserMigration` | primary | Preflights supported old home state, ownership, topology, collisions, exact Change contents, managed assets, and source-retirement scope. |
| S3/R4 | `src/legacy-user-migration.js#applyLegacyUserMigration` | primary | Stages, publishes, verifies, retires, and records one explicit home-to-workspace transaction. |
| S3/R4-S4 | `src/legacy-user-migration.js#recoverLegacyUserMigration` | primary | Authenticates source-derived transaction provenance against its independent workspace authority before completing or rolling back interrupted work; otherwise retains state fail-closed. |
| S3/R5 | `src/config.js#findWorkspaceRoot` | primary | Applies explicit, environment, target-ancestor, and mapped-current-workspace precedence with no home fallback. |

#### Implementation Gaps

- None.

#### Verified By

| Requirement / Scenario | Evidence | Proves | Status |
|---|---|---|---|
| S3/R1-S1 | Automated test `test/cli.test.js#change create scaffolds a planned Change for a selected repository` | Creation writes one central Change with Space/repository metadata and no repository-local lifecycle copy. | Passing 2026-08-07 |
| S3/R1-S2 | Automated test `test/cli.test.js#change create refuses to guess among multiple mapped repositories` | Ambiguous target selection fails before writes. | Passing 2026-08-07 |
| S3/R2-S1 | Automated tests `test/cli.test.js#runtime config validation rejects unknown keys`, `test/cli.test.js#context rejects physical aliases claimed as different repositories`, and `test/schema-contracts.test.js#workspace and repository schemas reuse the runtime lexical path contract` | Runtime and published schemas reject unknown or unsafe shape and duplicate physical ownership consistently. | Passing 2026-08-10 |
| S3/R2-S2 | Automated test `test/cli.test.js#context rejects a repository-only ID that collides with an existing Idea` | A duplicate portable ID cannot silently claim another owner. | Passing 2026-08-07 |
| S3/R2-S3 | Automated tests `test/cli.test.js#validation rejects a central Change store symlinked outside its owner` and `test/cli.test.js#change transition rejects an active Change through an external symlink ancestor` | Workspace-owned Change paths cannot traverse a physical owner boundary. | Passing 2026-08-07 |
| S3/R3-S1 | Automated tests `test/cli.test.js#change create infers a sole repository and refuses an existing Change` and `test/cli.test.js#validate reports an active and closed Change collision` | Active and closed Change IDs are unique inside the selected workspace. | Passing 2026-08-07 |
| S3/R3-S2 | Automated tests `test/cli.test.js#change transition updates an active Change with compare-and-set semantics`, `test/cli.test.js#change transition preserves and can retry a concurrent pre-backup tasks edit`, and `test/change-file-authority.test.js#close and transition cannot commit after same-byte tasks inode substitution` | Transition changes one expected status and preserves concurrent edits or identity substitutions without committing stale authority. | Passing 2026-08-10 |
| S3/R3-S3 | Automated tests `test/cli.test.js#change close moves an in-review Change without writing a closed status` and `test/cli.test.js#change close rechecks status at commit time` | Close uses folder location as terminal state and rechecks the commit-time status. | Passing 2026-08-07 |
| S3/R2-S4 | Automated tests `test/cli.test.js#validate rejects absent and cross-Space Change repository IDs deterministically` and `test/cli.test.js#status retains Space-owned Changes whose repository IDs no longer resolve` | Invalid ownership fails validation without hiding the Space-owned work from status. | Passing 2026-08-07 |
| S3/R4-S1, S3/R4-S2 | Automated tests `test/cli.test.js#CLI setup migrates a released legacy user v1 source through dry-run and apply`, `test/cli.test.js#CLI setup migrates an explicit legacy user v2 source and supports dry-run`, and `test/cli.test.js#CLI setup migrates an explicit legacy home-root v3 workspace` | Dry-run writes nothing; released user-v1/user-v2 and supported home-workspace sources migrate only through explicit setup into canonical workspace-v3 state and retire owned source state. | Passing 2026-08-10 |
| S3/R4-S2 | Automated tests `test/workspace-config.test.js#released legacy user v1 is migration-only and preserves source-relative topology in workspace v3` and `test/legacy-user-migration.test.js#legacy user migration plans and applies a released v1 install while retiring owned source state` | Released v1 input is rejected as current authority, converts without mutating its source object, rebases source-relative topology from the explicit old-user root, writes canonical workspace-v3 state, and retires only owned source state. | Passing 2026-08-10 |
| S3/R4-S3 | Automated test `test/cli.test.js#configure rejects released legacy user configurations as operational authority` | Both released user-v1 and user-v2 configurations require explicit migration and cannot become operational authority for configure. | Passing 2026-08-10 |
| S3/R4-S2 | Automated test `test/legacy-user-migration.test.js#legacy user migration retires only owned state and reruns as a completed no-op` | Migration writes canonical workspace config, Change, workflow, lock, and skills; preserves unrelated source files and skills; retires only checksum-owned state; and reruns without mutation. | Passing 2026-08-07 |
| S3/R4-S3 | Automated tests `test/workspace-config.test.js#released legacy user v1 rejects malformed layouts and unsupported signatures`, `test/workspace-config.test.js#legacy user v2 rejects every malformed present migration locator`, `test/legacy-user-migration.test.js#legacy user migration refuses an unresolved source-workspace locator before writing either tree`, `test/legacy-user-migration.test.js#legacy user migration refuses a divergent valid workspace config without mutation`, `test/legacy-user-migration.test.js#legacy user migration validates an existing destination config before writing either tree`, and `test/legacy-user-migration.test.js#legacy user migration aborts on source drift without overwriting or retiring source state` | Malformed or unsupported released v1/v2 input, unresolved prior migration ownership, divergent or invalid destination authority, and post-plan source drift all fail before destructive publication or retirement. | Passing 2026-08-10 |
| S3/R4-S4 | Automated tests `test/legacy-user-migration.test.js#legacy user migration recovery completes a durable destination-verified transaction`, `test/legacy-user-migration.test.js#legacy user migration recovery rejects malformed journal records and states`, `test/legacy-user-migration.test.js#legacy user migration recovery rejects external staged, backup, and retired paths`, `test/legacy-user-migration.test.js#legacy user migration recovery rejects same-basename journal redirects outside configured owners`, `test/legacy-user-migration.test.js#legacy user migration recovery rejects coherently authenticated workspace-root skill redirects`, `test/legacy-user-migration.test.js#legacy user migration does not overwrite a retirement path that appears concurrently`, `test/legacy-user-migration.test.js#legacy user migration preserves an opaque source replacement before retirement transfer`, and `test/legacy-user-migration.test.js#legacy user migration re-verifies destinations after source retirement` | Provenance-authenticated recovery rejects malformed, owner-mismatched, or path-redirected journals; resumes covered destination or source transfers; and preserves concurrent or opaque replacements. This evidence does not authorize cleanup when complete source-derived provenance is unavailable. | Passing 2026-08-07 |
| S3/R5-S1 | Automated tests `test/workspace-config.test.js#workspace discovery honors explicit, environment, target, and cwd precedence`, `test/workspace-config.test.js#cwd workspace resolves a physically mapped external repository`, and `test/cli.test.js#CLI context keeps cwd as the target when --workspace supplies external ownership` | Discovery selects the deterministic workspace owner while the explicit workspace option remains authority and never replaces the command's cwd target. | Passing 2026-08-07 |
| S3/R5-S2 | Automated tests `test/workspace-config.test.js#an unmapped external target cannot borrow the cwd workspace` and `test/workspace-config.test.js#workspace discovery never falls back to HOME or SDD_USER_HOME` | Unmapped external targets fail without borrowing cwd or home authority. | Passing 2026-08-07 |

#### Verification Gaps

- None.

#### Story Notes

- Repository-only context remains portable through its stable repository ID, but an external repository selects a workspace only through an explicit command root, `SDD_WORKSPACE_ROOT`, or an enclosing current-directory workspace that maps it.
- Legacy home-root workspace v1-v3 and released user-v1/v2 state are migration input only; `sdd setup <workspace> --from-user <old-user-root>` is the supported home-to-workspace cutover, while `sdd update` refreshes the already selected workspace.
- Interrupted migration resumes only from complete source-derived transaction provenance independently bound outside the staged transaction. A committed partial-cleanup residue without that authenticated proof fails closed and remains for manual inspection.

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
Modified: 2026-08-09
Last verified: 2026-08-09

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

Planning, Apply, Review, PR, Release, and Space Status SHALL select one workspace-unique central Change, derive its full stable repository target set from `tasks.md`, keep repository-owned Epics/code/tests distinct, and perform lifecycle transition or close exactly once after every target passes its gate.

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
| S6/R7 | `skills/sdd-apply/SKILL.md#Authority And Project Profile` | primary | Orchestrates implementation and the single workspace-wide transition across the complete target set. |
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
| S6/R7-S1 | Automated test `test/workflow-contracts.test.js#packaged workflows coordinate one central Change across every target repository` | All delivery workflows share the central layout, full target-set invariant, repository-free Change-wide lifecycle, and projection semantics without legacy Change paths. | Passing 2026-08-07 |

#### Verification Gaps

- None.

#### Story Notes

- Instruction source is executable package behavior for agent workflows; semantic contract tests should prove complete operative clauses rather than isolated strings.

### Story S7: Accessible Public Methodology Reference

Implementation: implemented
Verification: partial
Created: 2026-07-23
Modified: 2026-08-09
Last verified: 2026-08-09

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

The public package documentation SHALL distinguish one workspace-level central Change record from repository-local Epic/code/test truth, explain repository projections and workspace-wide lifecycle commands, document setup and deterministic workspace discovery, identify explicit `sdd setup <workspace> --from-user <old-user-root>` with `--dry-run` as the fail-closed path from legacy home-root workspace v1-v3 or user-v1/v2 installations, and explain that post-crash cleanup resumes only from complete source-derived transaction provenance.

###### Scenario R5-S1: Legacy User Installation Migration

- WHEN a developer reads the installation or lifecycle guide for an older home-scoped installation
- THEN the guide directs them to preview and run the explicit `sdd setup <workspace> --from-user <old-user-root> --dry-run` migration, explains workspace-owned destinations and conflicts, names both released user-v1 and user-v2 inputs, explains the source-derived provenance limit on interrupted cleanup, and never instructs them to preserve a user-global store or rely on automatic home discovery.


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
| S7/R5 | `README.md#Installation` | primary | Defines explicit workspace setup, canonical workspace ownership, contained managed skills, external-repository selection, and fail-closed home-root workspace v1-v3 or user-v1/v2 migration with provenance-bounded cleanup. |
| S7/R5 | `site/index.html#Planning, project truth, and Changes have distinct owners.` | primary | Presents the workspace lifecycle, explicit user-v1/v2 migration inputs, and source-derived recovery limit in the public guide. |

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
| S7/R2-S1 | Historical deterministic rendered inspection of committed candidate `666de8f` at 1440×900, 768×1024, 375×812, 320×812, and 812×375 | The prior candidate kept navigation reachable, mobile controls at 44px, long content contained, and document scroll/client width equal at every viewport. | Historical passing evidence 2026-07-23; not current-source proof |
| S7/R3-S1 | Deterministic browser interaction on `site/site.js` clipboard-fallback remediation with clipboard denial, missing command text, and keyboard skip-link interaction | Clipboard denial selects the full command and announces `Selected` when selection is available; missing command text announces `Copy failed` without a runtime error; the visible skip link moves focus to `main-content`. | Passing 2026-07-23 |
| S7/R4-S1 | Historical deterministic rendered inspection of committed candidate `666de8f` with reduced-motion emulation and direct screenshot review | The prior candidate used `auto` scrolling, reduced transitions to `0.00001s`, retained active navigation, and kept the Steel composition readable. | Historical passing evidence 2026-07-23; not current-source proof |
| S7/R5-S1 | Automated test `test/site.test.js#public guide documents workspace-owned Changes and explicit fail-closed user migration` | The source contract requires workspace-owned Change and skill paths, both released user-v1/v2 inputs, the dry-run command, provenance-limited cleanup, and no active user-global destination. | Current-source assertion updated 2026-08-09; execution pending Main |
| S7/R5-S1 | Prior current-source browser inspection at 1280px with full-page screenshot and WCAG 2 A/AA axe scan | Before the 2026-08-09 migration-copy update, the rendered guide exposed the workspace layout and migration command without layout breakage and axe reported zero violations. | Superseded 2026-08-09; fresh responsive render pending |

#### Verification Gaps

- S7/R2-S1, S7/R4-S1, S7/R5-S1: current-source responsive rendering of the 2026-08-09 migration copy is pending Main capture at representative desktop and mobile widths, including direct screenshot inspection and console/network results.

#### Story Notes

- README and changelog entries communicate S7; they do not own or prove the public-guide behavior.
- Owner manual confirmation of the current guide remains `pending user` and is tracked separately from technical verification.
- Current-source responsive-render evidence for the 2026-08-09 migration copy remains pending until Main captures and inspects it; prior committed-candidate renders are historical evidence only.

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

- Active and closed implementation records live in the selected workspace's central Change store. Historical home-root workspace v1-v3, user-v1/v2, and repository-local Change state is migration input only; Epics, ADRs, implementation, tests, and supporting docs remain repository-owned.
