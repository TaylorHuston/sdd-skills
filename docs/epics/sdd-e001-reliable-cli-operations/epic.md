---
schema: sdd-epic-v2
id: SDD-E001
status: active
created: 2026-07-20
modified: 2026-08-19
last_verified: 2026-08-18
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
- Related ADRs: `docs/adrs/2026-08-07-centralize-change-storage.md`, `docs/adrs/2026-08-07-workspace-scoped-installation.md`, `docs/adrs/2026-08-10-progressive-change-record.md`, `docs/adrs/2026-08-17-use-risk-triggered-delivery.md`, `docs/adrs/2026-08-19-use-current-consumer-cli-primitives.md`.

Developers and agents rely on the CLI and packaged skills as one toolchain. Deterministic results must be trustworthy, mutations must remain inside declared ownership, audit reports must distinguish current from historical state, and review/release handoffs must contain only classified scope.

## Outcome

Developers can validate SDD artifacts, mutate lifecycle state, resolve topology, audit Epics, and prepare review/release handoffs with explicit evidence, physical containment, bounded preserved-state recovery, current-state reporting, exact diff scope, and bounded diagnostics.

## Current Scope

- Trustworthy v2 Epic structure and evidence validation.
- Physically contained local filesystem mutation with no silent overwrite, parseable durable files, exclusive creation where required, and actionable preserved-state recovery.
- Unambiguous configuration, topology, and Change lifecycle routing.
- Bounded, context-aware `doctor` and `status` diagnostics.
- Current-state Epic audit reports and exact-diff PR/release handoffs.
- Persistent evidence-backed planning, implementation, review, design, and interactive workflows.
- Shared same-session minimum context acquisition for exploration, ADR, and Change planning.
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
| S2 | partial | partial | Mutate only inside physical owner boundaries and preserve concurrent state safely. | 2026-08-21 | Configuration, Epic creation, and Change lifecycle commands use bounded current-consumer primitives; the dated accepted local-filesystem gaps remain explicit, while managed installation remains later work. |
| S3 | partial | partial | Route one workspace-unique central Change across portable repository targets. | 2026-08-21 | Lifecycle commands no longer consume the managed-install lock and preserve every tested pre-syscall conflict; exact final path-based syscall races are dated accepted gaps rather than claimed atomicity. |
| S4 | implemented | verified | Complete diagnostics within a bound without prose false positives. | 2026-07-20 | Guidance is affirmative-only and Git work is bounded. |
| S5 | implemented | verified | Preserve current audit truth and exact publication scope. | 2026-07-23 | Reports are versioned; PR/release paths are classified and rechecked; Git baselines are immutable and bounded. |
| S6 | implemented | partial | Carry one progressive central Change through focused planning, risk-triggered Review, conditional Epic reconciliation, and a content-identical local outcome commit. | 2026-08-17 | The one supported current workflow is v2; the unrelated accepted aggregate NUL-path gap remains explicit. |
| S7 | implemented | verified | Explain the portable method and package through accessible responsive documentation. | 2026-08-18 | Current guide and durable desktop/mobile evidence explain and prove the v2 workflow; owner product acceptance remains separately pending. |

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

Implementation: partial
Verification: partial
Created: 2026-07-20
Modified: 2026-08-21
Last verified: 2026-08-21

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

- WHEN `change.md` changes after transition preflight but before replacement
- THEN the transition preserves the current content and reports concurrent modification.

###### Scenario R2-S4: Close-Time Status Drift

- WHEN an in-review Change is reopened after close preflight
- THEN close aborts and preserves the reopened Change in its active location.

###### Scenario R2-S5: Concurrent First Initialization

- WHEN two processes initialize the same repository before either portable contract exists
- THEN at most one initialization succeeds and the other reports the conflict without losing either writer's accepted durable state.

##### Requirement R3: Bounded Durable Mutation And Recovery Reporting

The CLI SHALL publish individual durable files atomically, refuse unexpected replacement, use exclusive creation where a new directory must not replace an existing target, serialize only current one-writer operations, and report preserved state plus an actionable retry or manual-recovery step when a mutation cannot complete. It does not guarantee replay, arbitrary partial-cleanup continuation, or cross-artifact rollback to a prior global state.

###### Scenario R3-S1: Individual Durable File Conflict Or Failure

- WHEN configuration or installation evidence changes after preparation, or its publication cannot complete
- THEN the CLI does not overwrite newer content, leaves each resulting durable file complete and parseable, and identifies preserved state plus the next safe action.

###### Scenario R3-S2: Epic Scaffold Collision Or Interruption

- WHEN an Epic target appears during creation or scaffolding cannot complete
- THEN the CLI does not replace an existing target, preserves any target or residue needed for inspection, and reports a typed retry or manual-recovery action without requiring journal replay.

###### Scenario R3-S3: Partial Managed Workflow Refresh

- WHEN managed workflow or installation-evidence refresh cannot complete
- THEN the CLI preserves newer content, leaves individual durable files complete and parseable, and identifies the resulting state plus the next safe action without promising global rollback.

###### Scenario R3-S4: Partial Managed Skill Refresh

- WHEN a managed skill conflicts or a multi-skill refresh cannot complete
- THEN the CLI preserves locally modified or newer targets, identifies completed and residual state, and reports the safe retry, force, or manual-recovery action without promising aggregate rollback.

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
| S2/R2 | `src/commands/change-transition.js#transitionChange` | primary | Rechecks the bounded `change.md`, workspace, and repository snapshots after staging and immediately before its mode-preserving atomic replacement. |
| S2/R2 | `src/commands/change-close.js#closeChange` | primary | Rechecks status, ownership, and destination absence immediately before the direct active-to-closed rename. |
| S2/R2-S5 | `src/commands/init-installation.js#initRepository` | primary | Publishes the first portable repository contract through the exclusive no-replace configuration boundary so one concurrent writer wins without a generalized workspace lock. |
| S2/R3-S1 | `src/config-publication.js#publishConfigFile` | primary | Publishes complete configuration YAML, preserves unexpected targets, retains inspectable recovery state when needed, and reports a safe retry/manual action. |
| S2/R3-S1 | `src/fs.js#writeFileAtomically` | support | Continues publishing complete JSON installation evidence until the managed-install boundary is replaced by S8. |
| S2/R3-S2 | `src/commands/epic-create.js#publishEpicScaffold` | primary | Exclusively creates one owner-contained Epic directory and fsynced `epic.md`, preserves collisions or incomplete state for inspection, and reports a typed retry/manual-recovery action without journal replay. |
| S2/R3-S3 | `src/fs.js#replaceFileAtomically` | primary | Currently publishes managed workflow files with no-replace and preserved-state behavior. |
| S2/R3-S4 | `src/fs.js#replaceDirectoryAtomically` | primary | Currently reserves and publishes managed skill directories without replacing a concurrent target. |
| S2/R3-S3, S2/R3-S4 | `src/mutation.js#withWorkspaceMutationLock` | support | Serializes current managed setup and update operations. |
| S2/R3-S3, S2/R3-S4 | `src/installation.js#applyManagedInstallation` | support | Coordinates current workflow, skill, and installation-evidence refresh. |
| S2/R3-S1, S2/R3-S3, S2/R3-S4 | `src/commands/init-installation.js#setupInstallation` | support | Preserves a successfully published workspace configuration with retry guidance if the remaining managed installation cannot complete, while setup/update serialization remains for S8-S9. |
| S2/R3-S3, S2/R3-S4 | `src/commands/update.js#updateWorkspace` | support | Refreshes current workspace-managed artifacts. |
| S2/R3-S3 | `src/workflow.js#applyWorkflowSync` | support | Applies and verifies current managed workflow replacement. |
| S2/R3-S4 | `src/skills.js#applySkillSync` | support | Applies and verifies current managed skill replacement. |
| S2/R4 | `src/commands/init-installation.js#setupInstallation` | primary | Creates or reconciles the selected workspace's configuration, workflow, install lock, and contained managed-skill registry. |
| S2/R4 | `src/config.js#resolveWorkspaceSkillsDirectory` | support | Rejects lexical or physical managed-skill paths outside the workspace owner. |

#### Implementation Gaps

- `S2/R2-S1`, `S2/R2-S4`: plain Node path APIs cannot atomically bind the final observed Change file/source directory and absent destination to the subsequent replacement or move syscall; a same-user actor can change those paths after the last explicit recheck.

#### Verified By

| Requirement / Scenario | Evidence | Proves | Status |
|---|---|---|---|
| S2/R1-S1 | Automated test `test/cli.test.js#setup rejects a managed skills path through an external symlink ancestor` | Install planning refuses an external symlink ancestor before writing. | Passing 2026-08-07 |
| S2/R1-S1 | Automated tests `test/cli.test.js#Epic create allows a selected mapping without portable config and confines custom roots physically`, `test/cli.test.js#Epic create never mutates a same-content external ancestor replacement`, and `test/cli.test.js#Epic creation rechecks authority before creating a missing artifact parent` | Epic scaffolding rejects configured and commit-window physical-owner escapes before writing the external target, and authority drift cannot create a missing artifact parent. | Passing 2026-08-19 |
| S2/R1-S1 | Automated test `test/cli.test.js#change transition rejects an active Change through an external symlink ancestor` | Lifecycle mutation refuses an external artifact root and preserves its contents. | Passing 2026-07-20 |
| S2/R1-S1 | Automated test `test/cli.test.js#validate rejects implementation and test evidence that resolve outside the repository` | Evidence acceptance uses the same physical ownership rule. | Passing 2026-07-20 |
| S2/R1-S1 | Automated test `test/mutation.test.js#fixed SDD mutation paths reject a symlinked config directory` | Workflow, configuration, and lock paths cannot escape through `.sdd`. | Passing 2026-07-20 |
| S2/R2-S1 | Automated tests `test/change-contract.test.js#planning completes the same Change before lifecycle work continues` and `test/cli.test.js#change transition preserves an edit made at the final replacement boundary` | Edits injected before the last snapshot recheck abort with `CONCURRENT_CHANGE`, preserve current content, and remove staged replacement residue. | Passing 2026-08-21 |
| S2/R2-S4 | Automated tests `test/cli.test.js#change close rechecks status at commit time` and `test/cli.test.js#change close preserves a destination that appears before the final move` | A reopen or nonempty destination injected before the last move recheck remains canonical. | Passing 2026-08-21 |
| S2/R2-S5 | Automated test `test/cli.test.js#repository init rejects concurrent first initialization without losing the winner` | Two overlapping initializers leave one complete accepted repository contract; the prepared loser receives an actionable `CONCURRENT_CHANGE`, and no publication residue remains. | Passing 2026-08-19 |
| S2/R3-S1 | Automated tests `test/workspace-config.test.js#expected-absent config publication preserves a file that appears before publish` and `test/workspace-config.test.js#expected-absent repository config publication preserves a file that appears before publish` | Exclusive first publication preserves a complete concurrent workspace or repository winner. | Passing 2026-08-19 |
| S2/R3-S1 | Automated test `test/workspace-config.test.js#configuration publication writes complete YAML and preserves file mode` | Configuration replacement remains parseable and preserves accepted permissions. | Passing 2026-08-19 |
| S2/R3-S1 | Automated test `test/workspace-config.test.js#config publication rejects an owner-local ancestor replacement` | Publication remains bound to the prepared physical owner-local ancestor chain. | Passing 2026-08-19 |
| S2/R3-S1 | Automated test `test/workspace-config.test.js#configuration replacement preserves winners after displacement and publication` | A winner appearing after displacement or after staged publication remains canonical; retained original/requested files stay parseable and the error identifies safe recovery. | Passing 2026-08-19 |
| S2/R3-S1 | Automated test `test/cli.test.js#configure preserves a config that replaces its preflight snapshot before publish` | Configuration publication preserves a newer concurrent target and reports the conflict. | Passing 2026-08-19 |
| S2/R3-S1 | Automated test `test/mutation.test.js#first-time setup preserves its complete config and reports a safe retry` | A later managed-install failure retains parseable workspace configuration, identifies it, and the same setup command completes safely on retry. | Passing 2026-08-19 |
| S2/R3-S1 | Automated test `test/mutation.test.js#atomic JSON writes leave one complete parseable document` | Current installation-evidence publication still leaves one whole parseable JSON document pending S8. | Passing 2026-07-20 |
| S2/R3-S2 | Automated test `test/cli.test.js#epic create refuses ambiguous repositories, collisions, and dry-run writes` | Epic creation refuses a colliding target and leaves it unchanged. | Passing 2026-08-19 |
| S2/R3-S2 | Automated test `test/cli.test.js#epic create scaffolds and validates a canonical Epic in one repository` | A successful exclusive scaffold publishes one structurally valid Epic. | Passing 2026-08-19 |
| S2/R3-S2 | Automated test `test/cli.test.js#CLI exposes epic create with JSON output` | Epic creation preserves current JSON fields and human dry-run output without mutation. | Passing 2026-08-19 |
| S2/R3-S2 | Automated test `test/cli.test.js#Epic creation preserves every destination type that appears before exclusive creation` | A raced file, directory, symlink, or nonempty directory remains the canonical target; retry succeeds only after explicit removal. | Passing 2026-08-19 |
| S2/R3-S2 | Automated test `test/cli.test.js#Epic creation rejects a target replacement after exclusive directory creation` | The freshly created directory is identity-bound before payload write; a replacement is preserved empty and reported instead of being adopted. | Passing 2026-08-19 |
| S2/R3-S2 | Automated test `test/cli.test.js#Epic validation failure retains complete inspectable state and reports manual recovery` | Failed structural validation retains complete inspectable scaffold state, reports `MUTATION_RECOVERY_FAILED`, names the retained path, and provides manual retry guidance. | Passing 2026-08-19 |
| S2/R3-S2 | Automated test `test/cli.test.js#Epic validation recovery preserves a replacement and the displaced scaffold` | A target replacement after failed validation remains untouched while the displaced complete scaffold remains inspectable. | Passing 2026-08-19 |
| S2/R3-S3 | Automated test `test/mutation.test.js#workflow replacement preserves an edit made inside the replacement window` | Managed workflow publication preserves newer content that appears during replacement. | Passing 2026-07-20 |
| S2/R3-S3 | Automated test `test/cli.test.js#update refuses to overlap another managed mutation` | A held current-writer boundary blocks update without altering durable installation state. | Passing 2026-07-20 |
| S2/R3-S4 | Automated test `test/mutation.test.js#skill replacement preserves an edit made inside the replacement window` | Managed skill publication preserves newer content that appears during replacement. | Passing 2026-07-20 |
| S2/R3-S4 | Automated tests `test/cli.test.js#update refuses to overwrite locally modified managed skills` and `test/cli.test.js#update removes a retired skill only when it matches its managed hash` | Skill refresh preserves local modifications and removes only content still owned by installation evidence. | Passing 2026-07-20 |
| S2/R4-S1 | Automated tests `test/workspace-config.test.js#managed skill directory is lexically and physically workspace-contained` and `test/cli.test.js#setup rejects a managed skills path through an external symlink ancestor` | Setup rejects absolute, traversal, and symlink escapes before installation writes. | Passing 2026-08-07 |
| S2/R4-S2 | Automated tests `test/cli.test.js#CLI setup owns only the explicit workspace and exposes workspace output fields` and `test/workspace-config.test.js#workspace discovery never falls back to HOME or SDD_USER_HOME` | Setup and discovery ignore decoy home installations and write only below the selected workspace. | Passing 2026-08-07 |

#### Verification Gaps

- `S2/R2-S1`: [user accepted 2026-08-21] Portable Node cannot atomically condition final `change.md` replacement on the exact snapshot observed immediately before `rename`; a concurrent same-user path replacement in that final window can be overwritten. Acceptance is limited to the owner-operated local CLI and does not claim atomic compare-and-set.
- `S2/R2-S4`: [user accepted 2026-08-21] Portable Node cannot atomically condition the active-to-closed directory move on the exact status/source/destination state observed immediately before `rename`; a final-window reopen or empty destination can be moved or replaced. Acceptance is limited to the owner-operated local CLI and does not claim atomic move-if-current.
- `S2/R3-S2`: [user accepted 2026-08-19] Portable Node path APIs cannot bind the later `epic.md` creation to the exact empty directory inode returned by `mkdir`; a concurrent same-user process can replace that directory between syscalls. This accepted technical gap is limited to the owner-operated local CLI boundary and does not claim protection from that exact interleaving.

#### Story Notes

- Physical ownership is evaluated after resolving existing symlink ancestors; it is stronger than lexical `..` rejection.
- The accepted recovery boundary is recorded in `docs/adrs/2026-08-19-use-current-consumer-cli-primitives.md`. Physical containment, no silent overwrite, complete individual durable files, required exclusive creation, and actionable preserved-state reporting remain required; migration-grade replay and cross-artifact rollback are not accepted guarantees.
- Remaining managed-install and lifecycle seams may temporarily provide stronger recovery while the active simplification Change replaces one current command boundary at a time.
- Epic creation now uses exclusive owner-contained target creation and actionable preserved-state recovery; the generalized directory journal/replay implementation has no current consumer and was removed.
- First repository configuration and central Change lifecycle commands now use their narrow no-overwrite boundaries rather than the generalized mutation lock. Only setup/update managed-install serialization remains current until S8-S9 replace that boundary.

### Story S3: Unambiguous Topology And Lifecycle Routing

Implementation: partial
Verification: partial
Created: 2026-07-20
Modified: 2026-08-21
Last verified: 2026-08-21

As a developer, I want one workspace-unique Change record with explicit portable repository targets, so that lifecycle commands cannot invent ownership, split status across copies, or mutate outside the selected workspace.

#### Requirements And Scenarios

##### Requirement R1: Portable Central Change Creation

The CLI SHALL create one proposed central `change.md` under `<workspace>/.sdd/changes/<change-id>/`, record its owning Space there, allow repository ownership to remain empty until planning, and use stable repository IDs when targets are selected.

###### Scenario R1-S1: Repository-Only Change Create

- WHEN `change create` targets a repository-only synthetic Space with a valid `.sdd/config.yaml` repository ID
- THEN it creates one central Change with that Space and repository ID and writes no repository-local Change folder.

###### Scenario R1-S2: Deferred Repository Selection

- WHEN a Space maps to multiple eligible repositories and no target set is supplied
- THEN creation writes one proposed Change with an empty repository list instead of guessing.

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
- THEN it updates the one central `change.md`; a stale expected status or concurrent edit leaves the record unchanged.

###### Scenario R3-S3: Central Close

- WHEN `change close` receives an `in_review` Change
- THEN it moves the one record to `<workspace>/.sdd/changes/closed/<change-id>/` without writing a synthetic `closed` status.

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
| S3/R1, S3/R3-S1 | `src/commands/change-create.js#createChange` | primary | Exclusively creates one proposed central Change, preserves a concurrent or replaced target, and rejects active or closed identity collisions without a workspace mutation lock. |
| S3/R1 | `src/change-repositories.js#resolveRepositoryTargets` | support | Resolves stable mapped or repository-only target IDs without inventing repository-local Change ownership. |
| S3/R2 | `src/config.js#validateConfig` | primary | Enforces current config shape, portable repository IDs, and physical ownership invariants. |
| S3/R2 | `schemas/workspace.schema.json#sdd-v3` | support | Publishes the checked workspace configuration contract. |
| S3/R2 | `schemas/repository.schema.json#sdd-repository-v2` | support | Publishes the checked portable repository contract. |
| S3/R2 | `src/workspace.js#resolveWorkspaceContext` | primary | Rejects duplicate physical repositories and ambiguous portable identities while retaining valid repository-only context. |
| S3/R2-S3 | `src/change-store.js#assertChangeStoreConfinement` | primary | Confines active and closed central paths to the selected workspace. |
| S3/R3 | `src/change-store.js#listStoredChanges` | support | Enumerates the active and closed workspace inventory without assigning uniqueness-enforcement responsibility to the inventory helper. |
| S3/R3-S2 | `src/commands/change-transition.js#transitionChange` | primary | Applies a mode-preserving compare-and-set status replacement after final workspace, repository, and file snapshot checks. |
| S3/R3-S3 | `src/commands/change-close.js#closeChange` | primary | Rechecks current authority and destination absence, then directly moves one `in_review` central Change into closed history. |
| S3/R2-S4, S3/R3-S1 | `src/commands/validate.js#validateCentralChanges` | primary | Rejects missing and cross-Space repository metadata and reports an active/closed ID collision for every central Change. |
| S3/R2-S4 | `src/commands/status.js#buildSpace` | support | Keeps Space-owned Changes visible and reports unresolved target IDs when mappings drift. |
| S3/R3-S1 | `src/commands/status.js#readCentralChanges` | support | Refuses to project an active/closed duplicate as two independent status records. |
| S3/R3-S1 | `src/change-status.js#inspectChangeStatuses` | support | Reports active/closed duplicate identity through workspace diagnostics. |
| S3/R5 | `src/config.js#findWorkspaceRoot` | primary | Applies explicit, environment, target-ancestor, and mapped-current-workspace precedence with no home fallback. |

#### Implementation Gaps

- `S3/R3-S1`, `S3/R3-S2`, `S3/R3-S3`: lifecycle commands preserve tested current-writer conflicts without the generalized lock, but portable path-based creation/replacement/move cannot atomically bind the last observed active/closed identity across the final syscall.

#### Verified By

| Requirement / Scenario | Evidence | Proves | Status |
|---|---|---|---|
| S3/R1-S1, S3/R1-S2 | Automated test `test/change-contract.test.js#change create captures proposed intent in one central change.md` | Creation writes only one metadata-bearing proposed `change.md`, permits deferred repository selection, and creates no repository-local lifecycle copy. | Passing 2026-08-16 |
| S3/R2-S1 | Automated tests `test/cli.test.js#runtime config validation rejects unknown keys`, `test/cli.test.js#context rejects physical aliases claimed as different repositories`, and `test/schema-contracts.test.js#workspace and repository schemas reuse the runtime lexical path contract` | Runtime and published schemas reject unknown or unsafe shape and duplicate physical ownership consistently. | Passing 2026-08-10 |
| S3/R2-S2 | Automated test `test/cli.test.js#context rejects a repository-only ID that collides with an existing Idea` | A duplicate portable ID cannot silently claim another owner. | Passing 2026-08-07 |
| S3/R2-S3 | Automated tests `test/cli.test.js#validation rejects a central Change store symlinked outside its owner` and `test/cli.test.js#change transition rejects an active Change through an external symlink ancestor` | Workspace-owned Change paths cannot traverse a physical owner boundary. | Passing 2026-08-07 |
| S3/R3-S1 | Automated tests `test/cli.test.js#Change creation treats a dangling closed-history entry as an identity collision`, `test/cli.test.js#concurrent Change creation preserves one complete central winner`, and `test/cli.test.js#Change creation preserves a replacement after exclusive directory creation` | Pre-existing active/closed entries, concurrent same-ID creation, and a replacement injected after exclusive directory creation remain canonical through the tested rechecks. | Passing 2026-08-21 |
| S3/R3-S2 | Automated tests `test/change-contract.test.js#planning completes the same Change before lifecycle work continues`, `test/cli.test.js#change transition updates an active Change with compare-and-set semantics`, and `test/cli.test.js#change transition preserves an edit made at the final replacement boundary` | One central `change.md` transitions with preserved mode, while stale or injected pre-rename content remains canonical. | Passing 2026-08-21 |
| S3/R3-S3 | Automated tests `test/change-contract.test.js#planning completes the same Change before lifecycle work continues`, `test/cli.test.js#change close rechecks status at commit time`, and `test/cli.test.js#change close preserves a destination that appears before the final move` | Close moves a current `in_review` record and preserves reopened active or nonempty closed state observed by the final explicit recheck. | Passing 2026-08-21 |
| S3/R3-S1, S3/R3-S2, S3/R3-S3 | Automated test `test/cli.test.js#Change lifecycle commands do not consume the managed-install mutation lock` | Create, transition, and close complete through their narrow boundaries while the separate managed-install lock remains present and unchanged. | Passing 2026-08-21 |
| S3/R2-S4 | Automated tests `test/cli.test.js#validate rejects absent and cross-Space Change repository IDs deterministically` and `test/cli.test.js#status retains Space-owned Changes whose repository IDs no longer resolve` | Invalid ownership fails validation without hiding the Space-owned work from status. | Passing 2026-08-07 |
| S3/R5-S1 | Automated tests `test/workspace-config.test.js#workspace discovery honors explicit, environment, target, and cwd precedence`, `test/workspace-config.test.js#cwd workspace resolves a physically mapped external repository`, and `test/cli.test.js#CLI context keeps cwd as the target when --workspace supplies external ownership` | Discovery selects the deterministic workspace owner while the explicit workspace option remains authority and never replaces the command's cwd target. | Passing 2026-08-07 |
| S3/R5-S2 | Automated tests `test/workspace-config.test.js#an unmapped external target cannot borrow the cwd workspace` and `test/workspace-config.test.js#workspace discovery never falls back to HOME or SDD_USER_HOME` | Unmapped external targets fail without borrowing cwd or home authority. | Passing 2026-08-07 |

#### Verification Gaps

- `S3/R3-S1`: [user accepted 2026-08-21] Portable Node cannot bind successful creation to the exact active/closed identity across the final `change.md` write and post-publication checks; a same-user final-window replacement or active/closed duplicate remains possible. Acceptance is limited to the owner-operated local CLI and does not claim final publication identity binding.
- `S3/R3-S2`: [user accepted 2026-08-21] Portable Node ordinary `rename` is not a final compare-and-set primitive; a same-user replacement after the last snapshot check can be overwritten. Acceptance is limited to the owner-operated local CLI and does not claim atomic compare-and-set.
- `S3/R3-S3`: [user accepted 2026-08-21] Portable Node ordinary directory `rename` cannot atomically require both the exact active source and an absent destination; a same-user final-window reopen or empty destination remains possible. Acceptance is limited to the owner-operated local CLI and does not claim atomic move-if-current.

#### Story Notes

- The focused progressive lifecycle contract passes through every explicit recheck; the exact final path-based syscall windows are user-accepted 2026-08-21 rather than claimed atomicity. A clean aggregate package run remains a Change-level release gate rather than missing Scenario evidence.
- Repository-only context remains portable through its stable repository ID, but an external repository selects a workspace only through an explicit command root, `SDD_WORKSPACE_ROOT`, or an enclosing current-directory workspace that maps it.

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
| S5/R1-S1 | Automated test `test/cli.test.js#packaged audit and handoff skills preserve current-state and file-scope gates` | The canonical report template is versioned and matches the skill asset. | Passing 2026-08-17 |
| S5/R2-S1, S5/R2-S2 | Automated test `test/cli.test.js#packaged audit and handoff skills preserve current-state and file-scope gates` | Both handoff skills retain exact diff inventory gates and the PR skill has no separate `--fix` mode. | Passing 2026-07-22 |
| S5/R2-S2 | Automated test `test/cli.test.js#packaged audit and handoff skills preserve current-state and file-scope gates` | The release template mirrors its skill asset and includes file-scope plus SDD-integrity sections. | Passing 2026-08-17 |
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
Verification: partial
Created: 2026-07-23
Modified: 2026-08-17
Last verified: 2026-08-17

As a developer, I want SDD planning, implementation, and review workflows to carry work through a complete evidence-backed handoff, so that an agent does not stop at a partial task, a green command, or the first finding.

#### Requirements And Scenarios

##### Requirement R1: Progressive Planning And Handoff Records

The packaged planning workflow SHALL create or resume one workspace-central `change.md`, capture durable intent before technical planning, ask whether the user wants to continue, progressively add the technical plan to the same record, and create `tasks.md` only when planning proceeds. A v2 plan SHALL use the smallest coherent vertical outcomes that can be implemented, freshly verified, independently reviewed, and committed in one fresh session; one Requirement is a default rather than a universal constraint. Each outcome SHALL identify new or revised Requirements, affected Stories, authoritative Scenarios, observable results, dependencies, binding constraints, expected risk triggers, focused verification, and manual-acceptance needs without predicting implementation mechanics. `tasks.md` SHALL own only the delivery queue, dependencies, current status, and one replaceable Resume checkpoint; it SHALL NOT duplicate candidate verdicts, gap disposition, or commit facts in Implementation and Gate ledgers.

###### Scenario R1-S1: Deferred Technical Planning

- WHEN the user captures a desired outcome but does not want to plan implementation yet
- THEN `/sdd-change` leaves one central `proposed` Change containing `change.md` and can resume it later without repeating intake.

###### Scenario R1-S2: Replanning After Review

- WHEN review invalidates Story ownership or verification scope
- THEN `/sdd-change` returns the same Change to a coherent planned state with reconciled vertical outcomes and an exact Apply restart point.

###### Scenario R1-S3: Adaptive Vertical Outcomes

- WHEN technical planning makes the affected behavioral truth implementation-ready
- THEN `/sdd-change` creates independently understandable outcomes that identify new or revised Requirements, affected Stories, authoritative Scenarios, observable results, behavioral dependencies, and expected risk triggers without predicting files, modules, framework techniques, or implementation order.

###### Scenario R1-S4: Minimal V2 Planning State

- WHEN a `schema: sdd-change-v2` Change becomes planned
- THEN its current planning state is carried by `change.md` and a queue-and-Resume `tasks.md` without closure markers, duplicate ledgers, per-slice Review files, receipts, digests, or repository verification descriptors.

##### Requirement R2: Guidance-Driven Outcome Application

Apply SHALL select exactly one coherent vertical outcome from a planned or in-progress central Change, defaulting to the next dependency-ready outcome while accepting an explicit ID, SHALL state a concise transient Scenario proof sketch before coding without persisting another matrix or treating it as Review authority, SHALL defer implementation method to applicable workspace and repository guidance, SHALL freshly verify and independently review the exact candidate, and SHALL create at most one selectively staged content-identical local commit before stopping.

###### Scenario R2-S1: Default Next Outcome

- WHEN the user invokes `/sdd-apply` without an outcome ID
- THEN Apply selects one `in progress` or `ready` dependency-satisfied outcome using `Resume Here` before queue order, updates its current status, and does not continue into another outcome in the same invocation.

###### Scenario R2-S2: Explicit Outcome

- WHEN the user invokes `/sdd-apply` with a valid actionable outcome ID
- THEN Apply selects that exact outcome instead of silently substituting another.

###### Scenario R2-S3: Branch Policy Mismatch

- WHEN the selected repository's current branch does not satisfy its applicable `AGENTS.md` branch policy
- THEN Apply warns with the repository, current branch, required branch or branch class, and guidance path, and does not automatically switch or create a branch.

##### Requirement R3: Comprehensive Independent Review

Review SHALL record one exact candidate in the central `review.md`, complete the five universal scope/candidate, behavior, fresh-verification, independent Spec/Quality, and integrity/authority gates plus every declared or independently discovered triggered check before one consolidated verdict, and keep detailed candidate verdict, gap, acceptance, remediation, and final commit/tree facts in that one authority. It SHALL treat yielded or long-running commands as continuation points, admit BLOCKING or REQUIRED findings only for explicit accepted-contract, material-safety, project-policy, false-closure, or deterministic-gate grounds, classify remediation as product defect or closure repair, and bound one invocation to one discovery Review, one consolidated remediation batch, and one fresh final Review. Another pre-existing issue in the final Review SHALL return `needs-user`; only a regression introduced by the remediation batch receives one narrow correction.

###### Scenario R3-S1: Early Blocking Finding

- WHEN one review pass finds a blocking defect
- THEN the reviewer retains it and continues the materially relevant discovery wave before consolidating the verdict.

###### Scenario R3-S2: Yielded Aggregate Gate

- WHEN a required command yields a resumable session or runs longer than a progress interval
- THEN review reports progress, resumes the command, and does not mistake the yield for completion.

###### Scenario R3-S3: Risk-Triggered Review Record

- WHEN an outcome reaches Review
- THEN `review.md` records all five universal gates, both independent review axes, every planned trigger, any additional discovered trigger, concrete falsifiable checks, one exact candidate, and one coherent verdict without fixed not-applicable rows or a second Review authority.

##### Requirement R4: Rendered UI Verification

UI-bearing behavior SHALL trigger proportional rendered and accessibility checks named during planning or added by independent Review. Repository guidance SHALL determine implementation-time technique, while Review SHALL independently render current source, exercise changed interactions, inspect representative desktop/mobile states and console/network results, and keep owner manual confirmation separate.

###### Scenario R4-S1: Source-Only UI Confidence

- WHEN a UI change passes source, build, or static checks without rendered inspection
- THEN the workflow records rendered verification as pending or blocked rather than review-ready.

##### Requirement R5: Risk-Shaped Evidence Closure

Planning SHALL declare expected checks when behavior intersects UI/accessibility, security/privacy, persistence/migrations/contracts, concurrency/recovery/provider behavior, multi-repository integration, manual acceptance, or release. Review SHALL execute every declared trigger, add material independently discovered triggers, and record each trigger's reason, concrete falsifiable check, result, and evidence. Behavior closure SHALL map every affected Scenario to sufficient proof, compare claimed and proven boundaries where risk makes that distinction material, and prevent required technical gaps from passing as manual acceptance or an unaccepted partial state.

###### Scenario R5-S1: Aggregate Green With Weak Scenario Proof

- WHEN a broad gate passes but a high-risk Scenario citation does not assert the claimed boundary
- THEN the workflow keeps the Scenario unverified and records the exact proof gap.

###### Scenario R5-S2: Trigger Coverage Changes During Review

- WHEN a declared trigger lacks a concrete result or independent Review discovers another material boundary
- THEN Review cannot return ready until the missing check is executed or the exact technical gap is explicitly accepted with a date.

##### Requirement R6: Lightweight Tracked Sessions

The Interactive workflow SHALL use the same v2 `change.md`, queue-and-Resume `tasks.md`, and central `review.md` contract, apply one narrow coherent behavior change immediately, and preserve the same verification, independent Review, risk-trigger, gap, integrity, and authority invariants without creating an independent template family.

###### Scenario R6-S1: Small Durable Behavior Change

- WHEN a narrow change deserves a durable record but not a full planning pass
- THEN `/sdd-interactive` creates the trimmed shared v2 records, applies and independently reviews the work, and routes broader scope back to `/sdd-change`.

##### Requirement R7: One Central Multi-Repository Workflow

Planning, Apply, Review, PR, Release, and Space Status SHALL select one workspace-unique central Change, derive its full stable repository target set from `change.md`, keep repository-owned Epics/code/tests distinct, and perform lifecycle transition or close exactly once after every target passes its gate.

###### Scenario R7-S1: Coordinated Multi-Repository Delivery

- WHEN one Change targets multiple repositories
- THEN every workflow uses the same central artifacts and repository-keyed evidence, never creates or selects a repository-local copy, and never treats one target's completion as global completion.

##### Requirement R8: Shared Minimum Context

Explore, ADR, and Change SHALL invoke one read-only same-session context workflow with a focused question, SHALL read or explicitly mark missing the action-specific planning and repository minimum, and SHALL surface authority/freshness conflicts and gaps before making substantive claims.

###### Scenario R8-S1: Planning Begins With Partial Context

- WHEN the current session has read only part of the evidence required for an exploration, ADR, or Change
- THEN the shared context workflow reuses current reads, opens the missing minimum, and returns an evidence-linked sufficiency result without creating another artifact or context boundary.

##### Requirement R9: Candidate-Bound Epic Reconciliation

Epic Update SHALL accept one exact committed or working-tree diff envelope with or without active Change or Apply history, derive affected behavior from actual implementation, mutate only repository-owned Epic truth and directly owned generated indexes, and remain idempotent for the same candidate. Apply SHALL reconcile immediately when the candidate changes accepted behavior, completes a Story, or changes a contract or gap consumed by later work; otherwise the Change SHALL defer reconciliation until final completion rather than require a per-outcome Epic and post-Epic Review cycle.

###### Scenario R9-S1: Reviewed Or Manual Candidate Needs Traceability

- WHEN reviewed or manual implementation changes affect behavior ownership or durable proof
- THEN `/sdd-epic-update` reconciles Stories, Requirements, Scenarios, implementation maps, gaps, and verification maps from inspected candidate evidence without fabricating Apply history or changing code, Change lifecycle, changelog content, or Git history.

###### Scenario R9-S2: Deterministic Working-Tree Envelope

- WHEN Epic Update targets a dirty working tree
- THEN `sdd epic update-input` resolves an immutable baseline and HEAD, inventories staged, unstaged, and non-ignored untracked paths, returns a content-sensitive candidate watermark, and performs no artifact mutation.

###### Scenario R9-S3: Same Candidate Repeated

- WHEN Epic Update runs again after repository-owned truth already matches the same candidate
- THEN it returns `no-op` without rewriting the Epic.

###### Scenario R9-S4: Reconciliation Is Deferred

- WHEN a reviewed outcome changes no accepted behavior, completed Story, consumed contract, or consumed gap
- THEN Apply records that Epic reconciliation is deferred and does not create an otherwise unnecessary post-Epic Review cycle.

##### Requirement R10: Candidate-Bound Release Communication

Changelog SHALL accept one exact reviewed committed or working-tree candidate with current Epic reconciliation when behavior or traceability changed, SHALL follow the repository's native release-record policy, SHALL create or update one user-visible or operator-relevant entry only when warranted, and SHALL preserve the reviewed implementation projection while stopping before versioning or Git/release handoff mutations.

###### Scenario R10-S1: Reviewed Candidate Needs One Entry

- WHEN a reviewed candidate has a current Epic Update result and changes user-visible or operator-relevant behavior
- THEN `/sdd-changelog` creates or corrects exactly one native unreleased or per-change entry aligned with the reviewed outcome and accepted gaps.

###### Scenario R10-S2: Internal Or Existing Entry

- WHEN policy does not record the internal-only result or an accurate entry already exists for the same candidate
- THEN Changelog returns `no-op` without manufacturing public release communication.

###### Scenario R10-S3: Shared Read-Only Candidate Envelope

- WHEN Epic Update or Changelog targets committed or dirty work
- THEN `sdd candidate resolve` returns one immutable, content-sensitive, read-only diff envelope while `sdd epic update-input` preserves its Epic-specific validation contract.

##### Requirement R11: Candidate-Bound Outcome Closure

Apply and Review SHALL keep one canonical current closure record in central `review.md`: exact candidate, five universal gate results, behavior/Scenario coverage, executed triggered checks, findings, technical gaps and dated acceptance, separate manual product acceptance, bounded remediation, and the final local commit/tree. A v2 outcome SHALL NOT require Implementation or Gate ledgers, fixed 14-gate manifests, per-slice Reviews, Review digests, closure receipts, repository verification descriptors, or closure-only reseal commits. Completion SHALL require fresh evidence, independent Spec Adherence and Implementation Quality passes, no unaccepted required gap, selective staging, and equality between the reviewed content tree and the final commit tree.

###### Scenario R11-S1: Bounded Remediation Reaches Ready

- WHEN the discovery Review returns one or more admitted safe in-scope findings
- THEN Apply remediates the complete set in one batch, reruns affected verification, and obtains one fresh final independent Review across the complete outcome before any commit without beginning another broad cycle.

###### Scenario R11-S2: Required Technical Evidence Is Missing

- WHEN rendered interaction, live multi-context/realtime, provider/production, or other required technical proof is absent
- THEN Review returns findings, blocked, or cannot-verify and the outcome cannot become done unless the user explicitly accepts the named gap with a date.

###### Scenario R11-S3: V2 Completion Uses One Review Authority

- WHEN a v2 outcome claims `done`
- THEN `review.md` contains its exact candidate, universal and triggered gate results, Scenario coverage, independent verdicts, gaps and acceptance state, and final commit/tree while `tasks.md` contains only the matching outcome status and Resume state.

###### Scenario R11-S4: Reviewed Content Equals The Final Commit

- WHEN Apply creates the authorized local outcome commit
- THEN unrelated paths are excluded, the final commit is single-parent and reachable, and its tree equals the tree independently reviewed before commit without requiring a self-referential repository seal.

###### Scenario R11-S5: Historical Closure Is Not Current

- WHEN current validation or lifecycle mutation encounters a schema-less or receipt-based Change
- THEN it reports the record as unsupported history and does not migrate it, generate replacement closure artifacts, or treat it as a second current workflow.

##### Requirement R12: Durable Exploration Placement And Handoff

Explore SHALL preserve a substantial discussion requested for durable retention as one synthesized record, SHALL choose its destination by artifact authority and ownership before writing, SHALL default to the owning idea's plural `explorations/` directory when the final artifact is unsettled, and SHALL route mature outcomes to their owning workflow without creating duplicate canonical truth.

###### Scenario R12-S1: Discussion Needs A Durable Home

- WHEN the user asks to preserve a substantial discussion and no stronger artifact already owns its conclusions
- THEN `/sdd-explore` creates or resumes one synthesized record in an authority-appropriate location, defaulting to the owning idea's `explorations/` directory when its final artifact remains unsettled.

###### Scenario R12-S2: Exploration Reaches A Mature Outcome

- WHEN an exploration reaches a product, architecture, delivery, or other conclusion with a stronger owning workflow
- THEN Explore offers or invokes that workflow with user authorization and links the result without treating the exploration as competing canonical truth.

##### Requirement R13: Directional Product Planning

PRDs SHALL remain directional product-planning inputs rather than continuously synchronized implementation truth unless the current Change or project guidance explicitly grants them stronger authority. Ordinary PRD drift SHALL be advisory and SHALL NOT by itself block Apply, Review, integration, or closeout.

###### Scenario R13-S1: Accepted Change Differs From PRD Phasing

- WHEN an accepted Change and current Epic truth intentionally phase behavior differently from an older or broader PRD
- THEN delivery continues from the accepted Change, Review may suggest a deliberate PRD revisit, and ordinary drift does not produce a blocking verdict.

##### Requirement R14: One Current Change Contract

The CLI SHALL create new work with explicit `schema: sdd-change-v2`, SHALL use the compact v2 task and central Review contract for current lifecycle and validation, and SHALL treat schema-less or receipt-based Changes as unsupported history without a migration or backward-compatibility promise.

###### Scenario R14-S1: V2 Is The Default

- WHEN the CLI creates and plans a current Change
- THEN it emits and validates the three-artifact v2 contract with universal gates, declared triggers, candidate relationships, gaps, and final tree equality without legacy closure files.

###### Scenario R14-S2: Unsupported Historical Record

- WHEN current lifecycle mutation or validation encounters a schema-less historical Change
- THEN it reports `UNSUPPORTED_CHANGE_SCHEMA` and does not convert the record or invoke its task, Review, or receipt contract.

#### Implemented By

| Requirement / Scenario | Location / Anchor | Kind | Responsibility |
|---|---|---|---|
| S6/R1 | `skills/sdd-change/SKILL.md#Plan Delivery` | primary | Defines proportional intent capture, coherent outcomes, expected triggers, and implementation-agnostic planning. |
| S6/R1-S1 | `src/commands/change-create.js#createChange` | primary | Creates one workspace-central proposed Change from the current v2 template. |
| S6/R1-S2 | `skills/sdd-change/SKILL.md#Revising Remaining Work` | primary | Preserves completed facts while revising incoherent remaining work. |
| S6/R1-S3, S6/R1-S4 | `docs/templates/tasks.md#Delivery Outcomes` | primary | Defines compact v2 outcomes and excludes duplicate closure state. |
| S6/R2 | `skills/sdd-apply/SKILL.md#Inputs And Selection` | primary | Selects exactly one explicit or dependency-ready outcome. |
| S6/R2 | `skills/sdd-apply/SKILL.md#Behavioral Brief` | primary | States what must become true without predicting implementation method. |
| S6/R2-S3 | `skills/sdd-apply/SKILL.md#Preflight` | primary | Enforces branch/dirty-state attribution without automatic branch mutation. |
| S6/R3 | `skills/sdd-review/SKILL.md#Review Work` | primary | Performs independent complete-candidate inspection and continues safe checks after findings or command yields. |
| S6/R3-S3 | `skills/sdd-review/SKILL.md#Five Universal Gates` | primary | Defines the five-gate current Review contract. |
| S6/R4 | `skills/sdd-review/SKILL.md#Triggered Checks` | primary | Requires current-source rendered and accessibility checks when UI risk triggers them. |
| S6/R4 | `skills/sdd-design/SKILL.md#Define The Visual Verification Matrix` | support | Records proportional expected rendered behavior when design planning is needed. |
| S6/R5 | `skills/sdd-change/SKILL.md#Risk And Verification Policy` | primary | Declares behavior-derived triggers and focused verification as the planning default. |
| S6/R5 | `skills/sdd-review/SKILL.md#Triggered Checks` | primary | Executes every planned trigger and adds material discovered risks with concrete proof. |
| S6/R6 | `skills/sdd-interactive/SKILL.md#Create The Minimal Current Records` | primary | Reuses the same v2 records and one Apply outcome without a second template family. |
| S6/R7 | `skills/sdd-review/SKILL.md#Resolve The Candidate` | primary | Resolves every target repository from one central Change and keeps separate candidate envelopes. |
| S6/R7 | `skills/sdd-pr/SKILL.md#Authority And Project Profile` | support | Stewards repository handoffs without duplicating Change lifecycle ownership. |
| S6/R7 | `skills/sdd-release/SKILL.md#Operating Sequence` | support | Aggregates production handoff readiness from the central Change target set. |
| S6/R8 | `skills/sdd-gather-context/SKILL.md#Common Minimum` | primary | Defines the shared read-only same-session planning context contract. |
| S6/R8-S1 | `skills/sdd-gather-context/SKILL.md#Completion Criterion` | primary | Returns evidence-linked sufficiency without creating an artifact. |
| S6/R9 | `skills/sdd-epic-update/SKILL.md#When To Run` | primary | Makes reconciliation immediate only when durable behavior or consumed contracts/gaps changed. |
| S6/R9-S1, S6/R9-S3 | `skills/sdd-epic-update/SKILL.md#Determine Affected Truth` | primary | Derives affected behavior from the exact candidate and returns idempotent results. |
| S6/R9-S2, S6/R10-S3 | `src/commands/candidate-resolve.js#resolveCandidateEnvelope` | primary | Resolves immutable content-sensitive committed or working-tree envelopes. |
| S6/R10 | `skills/sdd-changelog/SKILL.md#Decide Whether An Entry Is Warranted` | primary | Owns one candidate-specific native release entry or evidence-based no-op. |
| S6/R11 | `skills/sdd-apply/SKILL.md#Independent Review` | primary | Composes independent central Review and one bounded remediation batch. |
| S6/R11-S2 | `skills/sdd-review/SKILL.md#Findings And Verdict` | primary | Keeps required technical gaps non-passing and product acceptance separate. |
| S6/R11-S3 | `src/change-review.js#validateV2ChangeReviewSource` | primary | Validates exact candidate, five gates, triggers, Scenarios, gaps, acceptance, and completion fields. |
| S6/R11-S3 | `skills/sdd-pr/SKILL.md#Initial Setup`, `skills/sdd-release/SKILL.md#Operating Sequence`, `skills/sdd-space-status/SKILL.md#Workflow` | support | Keep candidate/acceptance truth in `review.md`, queue/Resume truth in `tasks.md`, and remote handoff telemetry in provider-native records. |
| S6/R11-S4 | `skills/sdd-apply/SKILL.md#Commit And Record` | primary | Selectively seals the reviewed tree in one local commit and records it centrally. |
| S6/R11-S4 | `src/commands/validate.js#validateV2ReviewRepositoryState` | support | Enforces reachable single-parent commit and reviewed/final tree equality. |
| S6/R11-S5, S6/R14-S2 | `src/commands/validate.js#validateChange` | primary | Reports schema-less Changes as unsupported and never selects their task/Review/receipt contract. |
| S6/R12 | `skills/sdd-explore/SKILL.md#Choose The Record Destination` | primary | Places durable exploration by authority and ownership. |
| S6/R12-S2 | `skills/sdd-explore/SKILL.md#Route Mature Outcomes` | primary | Routes mature conclusions without duplicating canonical truth. |
| S6/R13 | `skills/sdd-prd/SKILL.md#SDD Relationship` | primary | Keeps PRDs directional unless explicit authority says otherwise. |
| S6/R14-S1 | `skills/sdd-change/assets/change-template.md#sdd-change-v2` | primary | Makes v2 the default creation contract. |
| S6/R14-S1 | `src/change-tasks-v2.js#parseV2ChangeTasks` | primary | Validates compact outcomes, dependencies, Resume, and planned triggers. |
| S6/R14-S1 | `src/commands/change-transition.js#assertPlanningComplete` | support | Uses only the current v2 task parser for planning transitions. |
| S6/R14-S2 | `src/commands/change-close.js#closeChange` | support | Rejects schema-less closeout as unsupported history. |
#### Implementation Gaps

- None.

#### Verified By

| Requirement / Scenario | Evidence | Proves | Status |
|---|---|---|---|
| S6/R1-S1, S6/R1-S2 | Automated tests `test/change-contract.test.js#change create captures proposed intent in one central change.md` and `test/change-contract.test.js#planning completes the same Change before lifecycle work continues` | Current creation is workspace-central v2; planning remains guarded and resumable. | Passing 2026-08-17 |
| S6/R1-S3, S6/R1-S4 | Automated tests `test/change-tasks-v2.test.js#v2 tasks parse a compact delivery queue without legacy ledgers`, `test/change-tasks-v2.test.js#v2 tasks reject legacy ledgers and closure markers`, and `test/workflow-contracts.test.js#current Change templates use one v2 three-artifact contract` | Compact outcomes retain references, dependencies, Resume, triggers, and implementation-agnostic wording without closure state. | Passing 2026-08-17 |
| S6/R2-S1, S6/R2-S2, S6/R2-S3 | Automated test `test/workflow-contracts.test.js#Apply delivers one reviewed outcome without legacy closure machinery` | Apply selects one outcome, follows guidance, verifies proportionally, independently reviews, selectively commits, and stops. | Passing 2026-08-17 |
| S6/R3-S1, S6/R3-S2, S6/R3-S3, S6/R4-S1, S6/R5-S1, S6/R5-S2 | Automated test `test/workflow-contracts.test.js#Review uses five universal gates and concrete planned or discovered triggers` | Review completes safe relevant inspection after findings/yields, uses five gates, executes concrete triggers including UI risk, and separates Spec/Quality judgments. | Passing 2026-08-17 |
| S6/R6-S1 | Automated test `test/workflow-contracts.test.js#Interactive reuses normal v2 records and Apply` | Interactive has no second log, ledger, template family, or closure mechanism. | Passing 2026-08-17 |
| S6/R7-S1, S6/R8-S1, S6/R10-S1, S6/R10-S2 | Automated test `test/workflow-contracts.test.js#supporting workflows preserve central ownership and independent capability boundaries` | Context, Changelog, PR, Release, and Status retain central ownership and independent mutation boundaries. | Passing 2026-08-17 |
| S6/R9-S1, S6/R9-S3 | Automated test `test/workflow-contracts.test.js#Epic Update is conditional and records current truth rather than implementation method` | Epic Update reconciles only when durable truth changed and otherwise returns evidence-based no-op. | Passing 2026-08-17 |
| S6/R9-S2, S6/R10-S3 | Automated tests `test/candidate-resolve.test.js#candidate resolve resolves an immutable committed candidate and changed paths`, `test/candidate-resolve.test.js#candidate resolve inventories staged, unstaged, and untracked working-tree state`, and `test/epic-update-input.test.js#epic update input resolves an immutable committed candidate and changed paths` | Candidate helpers remain immutable, content-sensitive, and read-only. | Passing 2026-08-13 |
| S6/R9-S4 | Semantic source inspection of `skills/sdd-epic-update/SKILL.md#When To Run` and `skills/sdd-apply/SKILL.md#Epic Reconciliation` | Apply defers reconciliation when no accepted behavior, Story completion, consumed contract/gap, or stale map requires it. | Passing 2026-08-17 |
| S6/R11-S1, S6/R11-S2 | Automated tests `test/workflow-contracts.test.js#Apply delivers one reviewed outcome without legacy closure machinery` and `test/workflow-contracts.test.js#Review uses five universal gates and concrete planned or discovered triggers` | Apply permits one remediation batch and Review blocks unaccepted required gaps while keeping manual acceptance separate. | Passing 2026-08-17 |
| S6/R11-S3, S6/R11-S4, S6/R14-S1 | Automated tests `test/change-review.test.js#done v2 outcomes require final commit and tree equality`, `test/change-contract.test.js#done v2 outcomes require a reachable content-identical review seal`, and `test/workflow-contracts.test.js#supporting workflows preserve central ownership and independent capability boundaries` | Done outcomes require a committed candidate, reachable single-parent commit, reviewed/final tree equality, and downstream consumers preserve central Review authority. | Passing 2026-08-17 |
| S6/R11-S5, S6/R14-S2 | Automated test `test/change-contract.test.js#schema-less Changes are unsupported history` | Current validation and lifecycle mutation reject schema-less records without conversion or compatibility parsing. | Passing 2026-08-17 |
| S6/R12-S1, S6/R12-S2, S6/R13-S1 | Automated test `test/workflow-contracts.test.js#supporting workflows preserve central ownership and independent capability boundaries` | Explore routes durable records by authority and PRDs remain directional rather than delivery gates. | Passing 2026-08-17 |
| S6/R14-S1 | Automated tests `test/change-contract.test.js#v2 creation and planning use compact current records`, `test/change-tasks-v2.test.js#v2 tasks parse a compact delivery queue without legacy ledgers`, `test/change-review.test.js#v2 review validates one ready exact-candidate outcome without a receipt`, and `test/package.test.js#package dry run includes the current workflow without legacy closure templates` | New Changes default to v2, lifecycle/Review enforce the three-artifact contract, and the package omits retired receipt-era source and assets. | Passing 2026-08-17 |
#### Verification Gaps

- `S6/R14` [user accepted 2026-08-17]: the full package run passes the original stable-missing-file regression but exposes the unrelated pre-existing `runtime config validation rejects NUL path values without filesystem errors` failure and exceeds 1,800 seconds. Focused R14 proof is passing; this accepted aggregate gap does not claim the NUL-path behavior is correct.

#### Story Notes

- Instruction source is executable package behavior for agent workflows; semantic contract tests should prove complete operative clauses rather than isolated strings.
- The former aggregate `Change consumers still report a stable missing required file` failure was a deterministic status/inspection regression, not a race; S1 now restores status-aware `tasks.md` checks while preserving concurrent move retries.
- Owner feedback on 2026-08-17 rejects full slow aggregate suites as a universal per-slice gate; v2 verification should select concrete behavior-derived checks and reserve broad suites for a material breadth or release trigger.

### Story S7: Accessible Public Methodology Reference

Implementation: implemented
Verification: verified
Created: 2026-07-23
Modified: 2026-08-18
Last verified: 2026-08-18

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

The public package documentation SHALL distinguish one progressive workspace-level central Change record from repository-local Epic/code/test truth, explain repository projections and workspace-wide lifecycle commands, document current setup and deterministic workspace discovery, and state that pre-1.0 installation and Change formats are unsupported history without a migration or backward-compatibility promise. It SHALL explain the v2 three-artifact default, five universal gates, behavior-derived triggered checks, exact-candidate independent Review, bounded remediation, technical-gap and manual-acceptance separation, and selective local commit authority without presenting the former receipt protocol as a second current profile.

###### Scenario R5-S1: Unsupported Alpha Format

- WHEN a developer encounters a pre-1.0 installation or Change record
- THEN the guide identifies it as unsupported alpha data, directs the developer to recreate current workspace and repository contracts, and reserves `sdd update` for managed doctrine and skill reconciliation.

###### Scenario R5-S2: Risk-Triggered Default

- WHEN a developer reads the package workflow guidance
- THEN the three current artifacts, five universal gates, concrete behavior-derived triggers, independent Review, bounded remediation, gap honesty, selective commit, and authority limits are explained without requiring or advertising receipt-based closure for new work.


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
| S7/R5-S1 | `README.md#Quick Start` | primary | Explains the current three-artifact outcome workflow, focused verification, independent Review, and selective local commit boundary. |
| S7/R5-S1 | `docs/story-driven-development.md#Change Workflow` | primary | Defines one current v2 contract, five universal gates, behavior-derived triggers, unsupported history, and authority limits. |
| S7/R5-S1 | `docs/templates/README.md#Canonical Template Examples` | support | Exposes only current Change, outcome queue, and central Review templates. |
| S7/R5-S2 | `site/index.html#Planning, project truth, and Changes have distinct owners.` | primary | Presents the three-artifact, five-gate, risk-triggered v2 workflow and its gap, acceptance, commit, and authority boundaries. |

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
| S7/R5-S1 | Automated tests `test/workflow-contracts.test.js#public doctrine describes one supported current workflow`, `test/cli.test.js#packaged templates define compact v2 outcomes and one central Review`, and `test/package.test.js#package dry run includes the current workflow without legacy closure templates` | README, doctrine, templates, skills, and package inventory expose one v2 three-artifact workflow without current legacy closure assets. | Passing 2026-08-17 |
| S7/R5-S1 | Prior current-source browser inspection at 1280px with full-page screenshot and WCAG 2 A/AA axe scan | The earlier rendered guide had no layout breakage and axe reported zero violations, but its lifecycle copy is now superseded. | Historical; superseded by current evidence |
| S7/R2-S1 | Automated test `test/site.test.js#public guide has unique fragment targets and sequential navigable sections` | Current source has unique reachable navigation and skip targets. | Passing 2026-08-18 |
| S7/R2-S1 | Rendered verification `docs/verification/s3-risk-triggered-guide.md#S3 Risk-Triggered Guide Verification` | Desktop and 320px renders retain reachable 44px mobile controls, contained long surfaces, and no page-level overflow. | Passing 2026-08-18 |
| S7/R3-S1 | Automated test `test/site.test.js#public guide preserves clipboard fallback feedback and reduced-motion behavior` | Current source retains skip-link focus, selectable fallback, and announced feedback. | Passing 2026-08-18 |
| S7/R3-S1 | Rendered verification `docs/verification/s3-risk-triggered-guide.md#S3 Risk-Triggered Guide Verification` | Deterministic browser interaction proves visible skip-link focus and announced full-command selection when clipboard access is unavailable. | Passing 2026-08-18 |
| S7/R4-S1 | Automated test `test/site.test.js#public guide preserves clipboard fallback feedback and reduced-motion behavior` | Current source retains reduced-motion and focus treatment. | Passing 2026-08-18 |
| S7/R4-S1 | Rendered verification `docs/verification/s3-risk-triggered-guide.md#S3 Risk-Triggered Guide Verification` | Current reduced-motion rendering uses auto scrolling and negligible transition duration while Steel navigation feedback remains functional and readable. | Passing 2026-08-18 |
| S7/R5-S2 | Automated tests `test/site.test.js#public guide presents Change as coherent outcome planning`, `test/site.test.js#public guide presents Apply as one focused reviewed outcome`, and `test/site.test.js#public guide distinguishes deterministic v2 validation from independent judgment` | Current guide source explains the three artifacts, five gates, concrete triggers, bounded Review, gap and acceptance separation, conditional Epic timing, selective commit, and authority limits without current receipt closure. | Passing 2026-08-18 |
| S7/R5-S2 | Rendered verification `docs/verification/s3-risk-triggered-guide.md#S3 Risk-Triggered Guide Verification` | The current v2 workflow copy remains readable and contained on desktop and minimum-width mobile renders. | Passing 2026-08-18 |
| S7/R2-S1 | Historical rendered verification `docs/verification/s1-progressive-workflow.md#Rendered Guide Evidence` | The 2026-08-16 Steel candidate retained reachable responsive navigation and zero page overflow; this is a visual baseline, not current workflow-copy proof. | Historical passing evidence 2026-08-16; not current-source proof |
| S7/R3-S1 | Historical rendered verification `docs/verification/s1-progressive-workflow.md#Rendered Guide Evidence` | The 2026-08-16 candidate retained a working skip link, 44px mobile controls, keyboard-reachable code regions, and selectable clipboard fallback. | Historical passing evidence 2026-08-16; not current-source proof |
| S7/R4-S1 | Historical rendered verification `docs/verification/s1-progressive-workflow.md#Rendered Guide Evidence` | The 2026-08-16 candidate retained Steel colors, zero axe violations, reduced motion, and no page overflow at both primary viewports. | Historical passing evidence 2026-08-16; not current-source proof |

#### Verification Gaps

- None.

#### Story Notes

- README and changelog entries communicate S7; they do not own or prove the public-guide behavior.
- Owner manual confirmation of the current guide remains `pending user` and is tracked separately from technical verification.
- Current source-bound rendered evidence is retained under `docs/verification/artifacts/s3/2026-08-18/` and described by `docs/verification/s3-risk-triggered-guide.md`.
- Historical responsive, accessibility, and Steel-presentation evidence remains under `docs/verification/artifacts/s1/reseal-2026-08-16/`; its workflow copy is superseded.

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

- Active and closed implementation records live in the selected workspace's central Change store. Pre-1.0 home-scoped, older-schema, and repository-local Change state is unsupported historical data; Epics, ADRs, implementation, tests, and supporting docs remain repository-owned.
