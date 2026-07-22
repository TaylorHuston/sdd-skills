---
schema: sdd-epic-v2
id: SDD-E001
status: active
created: 2026-07-20
modified: 2026-07-20
last_verified: 2026-07-20
stories:
  - S1
  - S2
  - S3
  - S4
---

# SDD-E001 Reliable CLI Operations

## Product Context

- PRD: not applicable; this is a repository-only toolchain package.
- Related docs: `README.md`, `docs/story-driven-development.md`, `docs/audits/2026-07-20-code-audit.md`
- Related ADRs: none.

Developers and agents rely on the CLI as the deterministic boundary beneath the SDD skills. Its successful results must be trustworthy, its mutations must remain inside declared ownership, and its diagnostics must fail safely without inventing private topology.

## Outcome

Developers will be able to validate SDD artifacts, mutate lifecycle state, resolve topology, and diagnose repositories with explicit evidence, physical containment, recoverable transitions, and bounded diagnostics.

## Current Scope

- Trustworthy v2 Epic structure and evidence validation.
- Physically contained and recoverable local filesystem mutation.
- Unambiguous configuration, topology, and Change lifecycle routing.
- Bounded, context-aware `doctor` and `status` diagnostics.

## Deferred Scope

- Hosted or cross-machine coordination.
- UI, browser, database, provider, deployment, or production behavior.
- Broad refactoring that does not materially strengthen these contracts.

## Candidate Stories

Candidate Stories are planning signals only. They are not accepted Epic/Story truth until promoted into `## Stories`, and they do not receive `S#` labels until promotion.

| Candidate | Status | Story Shape | Acceptance Signals |
|---|---|---|---|
| None | deferred | No candidate Stories currently identified. | Revisit when another CLI workflow has a distinct developer outcome. |

## Story Index

| Story | Implementation | Verification | Capability | Last Verified | Notes |
|---|---|---|---|---|---|
| S1 | implemented | verified | Validate navigable behavior and real evidence. | 2026-07-20 | Structure, anchors, containment, and focused reads are enforced. |
| S2 | implemented | verified | Mutate only inside physical owner boundaries and recover safely. | 2026-07-20 | Atomic state, locking, commit checks, and recovery reporting are enforced. |
| S3 | implemented | verified | Reject ambiguous topology and lifecycle routing. | 2026-07-20 | Shape, physical ownership, planning, and collision ambiguity are rejected. |
| S4 | implemented | verified | Complete diagnostics within a bound without prose false positives. | 2026-07-20 | Guidance is affirmative-only and Git work is bounded. |

## Stories

### Story S1: Trustworthy Artifact Validation

Implementation: implemented
Verification: verified
Created: 2026-07-20
Modified: 2026-07-20
Last verified: 2026-07-20

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

#### Implementation Gaps

- None.

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

#### Verification Gaps

- None.

#### Story Notes

- Structural validation remains a deterministic baseline, but it must not certify empty or fabricated navigation/evidence claims.

### Story S2: Safe And Recoverable Mutation

Implementation: implemented
Verification: verified
Created: 2026-07-20
Modified: 2026-07-20
Last verified: 2026-07-20

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

###### Scenario R2-S2: Concurrent Promotion Edit

- WHEN a planned draft changes while promotion copies are staged
- THEN promotion aborts, removes staged destinations, and restores the latest draft.

###### Scenario R2-S3: Post-Commit Edit During Multi-Target Recovery

- WHEN a writer edits an already committed target before a later target fails
- THEN rollback preserves that newer target content and reports the retained recovery state.

###### Scenario R2-S4: Close-Time Status Drift

- WHEN an in-review Change is reopened after close preflight
- THEN close aborts and preserves the reopened Change in its active location.

##### Requirement R3: Atomic Durable State And Recovery Reporting

The CLI SHALL atomically replace configuration and installation-lock files, serialize managed updates, and report rollback failures with the resulting state.

###### Scenario R3-S1: Interrupted Or Failed Mutation

- WHEN an update or multi-repository lifecycle step fails
- THEN prior durable files remain parseable and the error identifies any recovery action that did not complete.

#### Implemented By

| Requirement / Scenario | Location / Anchor | Kind | Responsibility |
|---|---|---|---|
| S2/R1 | `src/fs.js#isPathPhysicallyInside` | primary | Resolves existing ancestors before authorizing a child path. |
| S2/R1 | `src/skills.js#applySkillSync` | support | Rechecks every managed-skill target immediately before mutation. |
| S2/R1 | `src/config.js#writeConfig` | support | Refuses a configuration file below a symlinked external `.sdd` directory. |
| S2/R1 | `src/commands/change-promote.js#assertNoSymlinks` | support | Prevents private or external draft content from entering a repository through nested symlinks. |
| S2/R2 | `src/commands/change-transition.js#transitionChange` | primary | Compares staged `tasks.md` with commit-time content and preserves concurrent edits. |
| S2/R2 | `src/commands/change-promote.js#promotePlannedChange` | primary | Holds and hashes the draft while staging and committing promotion. |
| S2/R2 | `src/commands/change-close.js#closeChange` | primary | Rechecks status and ownership at commit time and reports incomplete multi-target recovery. |
| S2/R3 | `src/fs.js#writeFileAtomically` | primary | Durably replaces configuration and JSON lock state through a synced temporary file. |
| S2/R3 | `src/fs.js#replaceFileAtomically` | primary | Publishes managed files with no-replace semantics and retains recovery state on a concurrent recreation. |
| S2/R3 | `src/fs.js#replaceDirectoryAtomically` | primary | Exclusively reserves managed directories before publishing their staged contents. |
| S2/R3 | `src/mutation.js#withWorkspaceMutationLock` | support | Serializes managed setup and update operations. |
| S2/R3 | `src/installation.js#applyManagedInstallation` | support | Treats workflow, skill, and install-lock updates as one recoverable unit. |
| S2/R3 | `src/commands/init.js#initWorkspace` | support | Restores the exact pre-migration configuration or reports retained migrated state when recovery fails. |
| S2/R3 | `src/commands/init-installation.js#setupInstallation` | support | Runs first-time user setup under the managed transaction and removes newly created durable state on failure. |
| S2/R3 | `src/commands/update.js#updateWorkspace` | support | Serializes user and legacy updates through the shared managed-install transaction. |
| S2/R3 | `src/workflow.js#applyWorkflowSync` | support | Applies, verifies, rolls back, and finalizes managed workflow replacement. |
| S2/R3 | `src/commands/change-transition.js#MUTATION_RECOVERY_FAILED` | support | Reports original and recovery failures with affected paths. |

#### Implementation Gaps

- None.

#### Verified By

| Requirement / Scenario | Evidence | Proves | Status |
|---|---|---|---|
| S2/R1-S1 | Automated test `test/cli.test.js#init rejects a managed skills path through an external symlink ancestor` | Install planning refuses an external symlink ancestor before writing. | Passing 2026-07-20 |
| S2/R1-S1 | Automated test `test/cli.test.js#change transition rejects an active Change through an external symlink ancestor` | Lifecycle mutation refuses an external artifact root and preserves its contents. | Passing 2026-07-20 |
| S2/R1-S1 | Automated test `test/cli.test.js#validate rejects implementation and test evidence that resolve outside the repository` | Evidence acceptance uses the same physical ownership rule. | Passing 2026-07-20 |
| S2/R1-S1 | Automated test `test/mutation.test.js#fixed SDD mutation paths reject a symlinked config directory` | Workflow, configuration, and lock paths cannot escape through `.sdd`. | Passing 2026-07-20 |
| S2/R1-S1 | Automated test `test/cli.test.js#change promote rejects symbolic links anywhere in the planned draft` | Promotion refuses nested links before copying private external content. | Passing 2026-07-20 |
| S2/R2-S1 | Automated test `test/cli.test.js#change transition preserves a concurrent tasks edit` | Commit-time drift aborts and restores the latest `tasks.md`. | Passing 2026-07-20 |
| S2/R2-S2 | Automated test `test/cli.test.js#change promote preserves a concurrent replacement of the planned draft` | Promotion aborts without a destination and retains the replacement draft. | Passing 2026-07-20 |
| S2/R2-S3 | Automated test `test/cli.test.js#change transition preserves an edit made after an earlier repository commit` | A later failure does not erase newer content in an earlier repository. | Passing 2026-07-20 |
| S2/R2-S3 | Automated test `test/cli.test.js#change promote preserves a destination edited after commit when a later destination fails` | Promotion recovery preserves an edited committed destination. | Passing 2026-07-20 |
| S2/R2-S4 | Automated test `test/cli.test.js#change close rechecks status at commit time` | Close refuses a Change reopened after preflight. | Passing 2026-07-20 |
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
| S2/R3-S1 | Automated test `test/mutation.test.js#failed installation after v1 migration restores the original config` | Installation failure restores the exact pre-migration configuration bytes. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/mutation.test.js#failed v1 config restoration reports incomplete recovery` | A failed config restore reports the retained migrated path and recovery failure. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/cli.test.js#update refuses to overlap another managed mutation` | A held operation lock blocks updates without altering durable install state. | Passing 2026-07-20 |
| S2/R3-S1 | Automated test `test/cli.test.js#change transition reports incomplete rollback with the affected path` | Recovery failure returns an explicit code and affected repository path. | Passing 2026-07-20 |

#### Verification Gaps

- None.

#### Story Notes

- Physical ownership is evaluated after resolving existing symlink ancestors; it is stronger than lexical `..` rejection.
- Dead-owner mutation locks are reclaimed from a matching ownership record. An alive or unknown PID is conservative: the CLI reports PID and creation time for manual inspection because PID reuse cannot be distinguished portably without platform-specific process-start identity.

### Story S3: Unambiguous Topology And Lifecycle Routing

Implementation: implemented
Verification: verified
Created: 2026-07-20
Modified: 2026-07-20
Last verified: 2026-07-20

As a developer, I want invalid or unmapped topology rejected before artifact creation, so that commands cannot invent ownership or leave duplicate Change truth.

#### Requirements And Scenarios

##### Requirement R1: Repository-Only Planning Refusal

The CLI SHALL refuse idea-owned Change creation and promotion when repository context has no configured Idea/planning mapping.

###### Scenario R1-S1: Unmapped Change Create

- WHEN `change create` targets a repository-only synthetic Space
- THEN it returns a mapping-required error and writes nothing.

###### Scenario R1-S2: Unmapped Change Promotion

- WHEN `change promote` targets the same repository-only synthetic Space
- THEN it returns the same mapping-required error before looking for or moving a private draft.

##### Requirement R2: Strict Physical Configuration

The CLI SHALL reject unknown configuration keys, duplicate physical repository ownership, and artifact paths whose relationships are equal or invalidly overlap.

###### Scenario R2-S1: Alias Or Shape Ambiguity

- WHEN different configured spellings resolve to one repository, an unknown key is present, or artifact roles overlap invalidly
- THEN configuration validation reports the exact invariant before operational commands continue.

##### Requirement R3: Cross-Location Change Collision

The CLI SHALL refuse a planned Change ID that already exists in any selected repository's active or closed roots.

###### Scenario R3-S1: Existing Active Or Closed ID

- WHEN `change create` would duplicate an active or closed Change ID
- THEN normal and dry-run commands report the collision and write nothing.

#### Implemented By

| Requirement / Scenario | Location / Anchor | Kind | Responsibility |
|---|---|---|---|
| S3/R1 | `src/commands/change-create.js#createPlannedChange` | primary | Refuses planned Change creation without Idea planning ownership. |
| S3/R1 | `src/commands/change-promote.js#promotePlannedChange` | support | Refuses promotion without the same planning ownership. |
| S3/R2 | `src/config.js#validateConfig` | primary | Enforces schema-shape parity and artifact relationships. |
| S3/R2 | `src/workspace.js#resolveWorkspaceContext` | primary | Rejects duplicate physical repository ownership and physical artifact ambiguity. |
| S3/R3 | `src/commands/change-create.js#createPlannedChange` | primary | Preflights selected repositories' active and closed roots. |

#### Implementation Gaps

- None.

#### Verified By

| Requirement / Scenario | Evidence | Proves | Status |
|---|---|---|---|
| S3/R1-S1 | Automated test `test/cli.test.js#CLI init requires setup and creates only a portable repository contract` | Repository-only `change create --dry-run` returns `PLANNING_MAPPING_REQUIRED`. | Passing 2026-07-20 |
| S3/R1-S2 | Automated test `test/cli.test.js#CLI init requires setup and creates only a portable repository contract` | Repository-only `change promote --dry-run` returns `PLANNING_MAPPING_REQUIRED`. | Passing 2026-07-20 |
| S3/R2-S1 | Automated test `test/cli.test.js#runtime config validation rejects unknown keys and ambiguous artifact roots` | Runtime validation matches strict shapes and rejects overlap. | Passing 2026-07-20 |
| S3/R2-S1 | Automated test `test/cli.test.js#context rejects physical aliases claimed as different repositories` | Two configured paths cannot claim one physical repository. | Passing 2026-07-20 |
| S3/R3-S1 | Automated test `test/cli.test.js#change create refuses IDs already active or closed in a selected repository` | Active and closed collisions fail even in dry-run before planning writes. | Passing 2026-07-20 |

#### Verification Gaps

- None.

#### Story Notes

- Repository-only context remains valid for repository-local Epic, validation, status, and active Change operations.

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

- The active implementation record is `docs/changes/2026-07-20-harden-cli-trust-boundaries/`.
