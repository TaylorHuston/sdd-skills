# SDD Code Audit: CLI

Status: audit complete

## Snapshot

- Audit date: 2026-07-20
- Repository: `/Users/taylor/src/my-life/spaces/sdd-skills`
- Scope: CLI entry point, command implementations, configuration and workspace resolution, filesystem/install helpers, schemas, CLI tests, package verification, and CLI-facing SDD traceability
- Exclusions: broad bundled-skill prose review except where it defines CLI integration behavior; site UI; generated output; dependency source; production or credentialed systems
- Branch: `develop`
- HEAD: `b5590e8c89bab4d2916994d7a5a2a905e9d87ecc`
- Working tree: included; 39 tracked files modified, 2 untracked files, 0 staged files at audit start
- Audit depth: default; reviewer effort was runtime-managed because per-agent effort was not selectable
- SDD-managed: yes

## Context

- Architecture and package boundaries: ESM Node CLI with a six-line executable shim, central argument dispatch and human output in `src/cli.js`, command modules under `src/commands/`, shared configuration/workspace/filesystem/install modules under `src/`, three published JSON schemas, and one production dependency (`yaml`).
- Primary entry points: `bin/sdd.js`, `src/cli.js`, and the setup/init/configure/update/doctor/context/status/validate/Epic/Change command modules.
- Test and verification surfaces: 105 Node tests in `test/cli.test.js` and `test/orphan-audit.test.js`; package smoke gate; Node native coverage; package-content dry run; dependency audit; SDD validation; focused read-only reproductions.
- Relevant project guidance: repository `AGENTS.md`, parent workspace guidance, `.sdd/config.yaml`, and the workflow returned by `sdd context . --json`.

## Review Coverage

| Charter | Reviewer / method | Effort | Coverage and limitations |
|---|---|---|---|
| Code quality and architecture | Independent architecture reviewer plus orchestrator evidence checks | Runtime-managed | All CLI and shared modules, schemas, current source diff, and focused tests; broad skill semantics excluded. |
| Testing and behavioral correctness | Independent testing reviewer plus native coverage and focused probes | Runtime-managed | All 105 tests, negative-path coverage, validator invariants, repository-only context, and lifecycle collisions; no disk-failure injection. |
| Security and data safety | Independent safety/reliability reviewer plus controlled symlink reproduction | Runtime-managed | Path containment, destructive operations, configuration trust, install/update, lifecycle mutations, and evidence paths; no hostile external system. |
| Performance and reliability | Combined with safety/reliability reviewer plus orchestrator inspection | Runtime-managed | Git subprocesses, filesystem transactions, concurrency, package hashing, focused validation, and recovery paths; no large-repository benchmark. |

## Validated Findings

| Severity | Confidence | Finding | Evidence | Impact | Remediation direction |
|---|---|---|---|---|---|
| high | high | **Epic validation can certify behavior and evidence that do not exist.** A v2 Story is allowed to have zero Requirements and Scenarios; `stories: []` bypasses body/index parity; a blank `Verified By` row counts as scenario coverage; and file anchors/test claims are not checked beyond file existence. | `src/commands/validate.js:407-440`, `500-547`, `613-665`, `714-720`. The passing canonical fixture creates empty `src/core.js` and `test/core.test.js` but declares `#runCoreJourney` and a passing test (`test/cli.test.js:201-205`, `273-287`, `2419-2433`). Independent empty-Story and empty-evidence probes also returned valid. | The CLI's strongest SDD gate can report success for an Epic that gives a new developer no real behavior, implementation anchor, or test evidence. This directly undermines the repository's north-star traceability contract. | Require non-empty Story/Requirement/Scenario structure and exact frontmatter parity. Treat evidence rows as coverage only after required cells and evidence semantics pass. Verify anchors or stable searchable test identifiers, and add intentionally empty/fabricated negative fixtures. |
| high | high | **Lexical containment permits writes, moves, removals, and accepted evidence outside advertised roots through symlinked ancestors.** | `src/fs.js:100-131`, `src/skills.js:43-58`, `src/commands/change-promote.js:142-197`, `src/commands/change-close.js:80-122`, `src/commands/validate.js:516-537`, `654-665`. A controlled temporary-directory probe installed bundled skills outside the asserted root through a symlinked `.agents` parent. | Setup/update can replace or recursively remove external managed-skill directories; lifecycle commands can mutate external artifact paths; validation can accept external files as repository evidence. Trigger requires a symlink in a configured ancestor. | Introduce one realpath-aware mutation/evidence boundary. Resolve the nearest existing ancestor, reject or explicitly govern symlink components, recheck immediately before rename/removal, and test every mutating command with symlink fixtures. |
| medium | high | **Repository-only context invents a private planning destination.** Context correctly reports `idea: null` and `planningPath: null`, but `change create` derives a convention path anyway. | `src/workspace.js:45-75`, `src/commands/change-create.js:112-125`. `change create sdd-skills audit-probe --workspace . --date 2026-07-20 --dry-run --json` proposed `src/my-life/my-vault/spaces/ideas/sdd-skills/planned-changes/...`. | An initialized but unmapped repository can create planning artifacts under a private path with no configured Idea ownership. | Reject planning-owned create/promote operations for `_repositoryOnly` contexts and add repository-only create, promote, and validate tests. |
| medium | high | **Lifecycle and installation mutations are only best-effort transactions and can lose concurrent edits or conceal partial rollback.** | `src/commands/change-transition.js:102-170`, `src/commands/change-promote.js:163-199`, `src/commands/change-close.js:109-122`, `src/config.js:74-77`, `src/fs.js:29-31`, `src/commands/update.js:20-28`. Native coverage leaves the promote/transition/close recovery branches largely unexecuted. | Overlapping agents/editors can have post-read changes overwritten or deleted. Disk, permission, interruption, or rollback failures can leave hidden backups, duplicated/missing Changes, truncated config/lock files, or mixed skill versions without a precise recovery report. | Add operation locks or content-hash compare-and-set checks, atomic config/lock writes, durable recovery metadata, and fault-injection tests that assert the exact final state after each failed commit/rollback step. |
| medium | high | **Configuration validation does not enforce physical ownership or artifact-layout invariants.** Equivalent path spellings can claim one repository twice, and active/closed/Epic roots may be equal or invalidly overlap. | `src/config.js:466-522`, `529-555`; runtime context resolves aliases at `src/workspace.js:34-42`. Focused probes returned no findings for `~/src/app` and `/Users/taylor/src/app` resolving to the same path, or for `activeChanges`, `closedChanges`, and `epics` all set to `docs/changes`. | Context ownership becomes order-dependent; Space-scoped mutations can target an ambiguously owned repository; closeout or validation can become unusable under a configuration reported healthy. | Canonicalize ownership with the same physical-path resolver used at runtime and define central artifact relationship rules, including the one permitted active/closed nesting shape. |
| medium | high | **`change create` permits IDs already active or closed in selected repositories.** | `src/commands/change-create.js:112-125` checks only the planned destination. An isolated fixture accepted a draft whose ID already existed actively; immediate validation then returned `CHANGE_LOCATION_COLLISION`. Existing collision coverage checks only an existing planned draft. | A successful command can immediately leave the workspace invalid and make later promotion/closeout ambiguous. | Preflight active and closed roots in every selected repository before creating the draft; cover active, closed, multi-repository, and dry-run cases. |
| medium | high | **Runtime configuration validation contradicts the published closed schemas.** Unknown top-level and nested keys are silently accepted. | `schemas/workspace.schema.json`, `schemas/user.schema.json`, and `schemas/repository.schema.json` use `additionalProperties: false`; `src/config.js:406-555` does not enforce allowed keys. Focused workspace and repository probes with extra keys returned empty finding arrays. | `doctor` and operational commands can accept configuration that schema-aware tooling rejects; misspelled or stale settings appear healthy and are silently ignored. | Make the JSON schemas authoritative at runtime or generate strict runtime validators from the same definitions, then add schema/runtime parity fixtures. |
| medium | high | **Guidance diagnostics turn negated or historical mentions into blocking errors.** | `src/guidance.js:43-57` uses unconditional substring/regex matches. A focused probe containing “Do not use `/sdd-propose`” and “Never read `.sdd/story-driven-development.md`” produced two errors; current tests cover only direct obsolete instructions. | Correct migration guidance can make `sdd doctor` unhealthy and exit 1, teaching users to distrust the diagnostic. | Detect prescriptive use rather than raw mention, or define recognized migration/suppression forms. Add negated, historical, quoted-example, and mixed-content cases. |
| low | high | **One stalled Git process can block all status reporting.** | `src/commands/status.js:67-73` sets `maxBuffer` but no timeout or abort signal; Space construction waits for repository results. | A hung Git invocation or inaccessible filesystem can prevent `sdd status` from completing for the Space or workspace. | Add a bounded timeout, terminate the child, return degraded per-repository status, and cap repository concurrency. |
| low | high | **The most change-prone CLI logic is concentrated where branch evidence is weakest.** | `src/cli.js` is 881 lines, `src/commands/validate.js` is 1,214 lines, and `test/cli.test.js` is 2,988 lines. Native coverage was 85.69% line / 72.89% branch overall, but `src/cli.js` branch coverage was 22.88%; several mutation recovery branches were uncovered. | New flags, human-output variants, validator rules, and failure recovery are more likely to regress through shared dispatch/parser code and monolithic fixtures. | Split command specifications/printing from dispatch, decompose validator rules by artifact concern, and add table-driven CLI contract and fault-injection suites. Preserve behavior while refactoring. |

## Cross-Cutting Themes

- The CLI has strong happy-path breadth, but some tests prove that files exist rather than that claimed behavior or evidence exists.
- Logical path checks are reused as security/data-safety boundaries even when physical filesystem resolution matters.
- Configuration, context, and mutation modules each encode part of the topology contract; their invariants are not centralized.
- Multi-agent operation is normal for this workspace, but mutation commands do not yet treat concurrent edits as a first-class condition.
- Diagnostics are becoming policy-enforcement gates; false positives therefore carry workflow cost beyond ordinary warnings.

## Candidate Changes

| Priority | Desired outcome | Findings grouped | Likely scope | Dependencies | Verification direction |
|---|---|---|---|---|---|
| 1 | Make Epic validation prove usable implementation and verification evidence. | False-positive Epic validation | `src/commands/validate.js`, Epic fixtures/templates, CLI tests | Decide what constitutes a verifiable code anchor and test identifier across languages | Negative fixtures for empty Stories, empty cells/files, fabricated anchors, missing test titles, and frontmatter/body drift; all must fail for the intended reason. |
| 2 | Make every CLI filesystem boundary physical and data-safe. | Symlink escape; transaction/concurrency recovery | `src/fs.js`, skill/workflow install, lifecycle mutations, evidence-path checks | Cross-platform realpath and lock policy | Symlink matrices, concurrent-edit compare-and-set cases, and fault injection at each stage with exact-state assertions. |
| 3 | Make context and lifecycle routing reject ambiguous or invented ownership. | Repository-only planning path; aliased ownership; artifact overlap; Change ID collisions | `src/config.js`, `src/workspace.js`, Change create/promote/close, schemas | Canonical topology model | Alias, case, symlink, repository-only, active/closed collision, and artifact-overlap fixtures. |
| 4 | Establish one strict configuration contract. | Runtime/schema disagreement | Schemas and runtime config validation | Choose schema runtime or generated validator approach | Shared valid/invalid corpus executed against both schema and CLI validation. |
| 5 | Make diagnostics bounded and context-aware. | Guidance false positives; unbounded Git status | `src/guidance.js`, `src/commands/status.js`, CLI output | Define timeout and obsolete-guidance semantics | Negation/history corpus, hung-child test, degraded JSON/human output tests. |
| 6 | Reduce regression concentration without changing behavior. | Large dispatcher/validator/test surfaces and low CLI branch coverage | `src/cli.js`, `src/commands/validate.js`, test organization | Complete higher-priority behavioral tests first | Golden/table-driven command contracts and unchanged package gate before/after extraction. |

## SDD Traceability

- Result: gaps found
- Epic and evidence observations: `sdd validate sdd-skills --workspace . --json` passed with 0 Epics, 0 planned Changes, and 0 repository Changes. The repository-only context exposes no Idea or planning path. Consequently, current CLI behavior has no Epic/Story implementation map to verify against the repository's own north-star traceability standard.
- Orphan-audit evidence used: the packaged audit inventoried 85 source files and 2 test files but found 0 Epics. By design, it treats an Epic-less scope as unusable and does not classify all files as orphan candidates; its zero unowned counts must not be interpreted as traceability alignment.

## Challenged Or Unresolved Claims

- The symlink finding was rated medium by one reviewer and high by the safety reviewer. The orchestrator reproduced the boundary escape and retained high severity because the same unchecked boundary can feed recursive removal and lifecycle mutations outside the stated root.
- Schema/runtime drift was rated low by one reviewer and medium by another. Medium was retained because the CLI advertises the schemas while `doctor` can certify contradictory persisted configuration as healthy.
- No claim that “all 85 source files are orphaned” was accepted: with no Epic evidence, the orphan audit explicitly says the scope is unusable rather than proving individual orphan status.
- Filesystem interruption and rollback outcomes remain risk findings, not reproduced corruption. The vulnerable branches and missing fault-injection evidence are confirmed; exact platform-specific failure modes remain untested.

## Commands And Tools

| Command or tool | Result | Limitation |
|---|---|---|
| Git snapshot/worktree/submodule inspection | `develop`, pinned HEAD, one worktree, no submodules, dirty tree included | Dirty state cannot be reconstructed from HEAD alone. |
| `npm run check` | Passed: 105 tests and CLI help smoke test | Primarily happy-path and semantic validation; no fault injection. |
| `node --test --experimental-test-coverage test/*.test.js` | Passed; 85.69% line and 72.89% branch overall | Coverage is structural, not mutation quality; CLI branch coverage was 22.88%. |
| `npm audit --omit=dev --json` | 0 vulnerabilities | Registry advisory coverage only; one production dependency. |
| `npm pack --dry-run --json` | Package contained CLI, untracked current source, schemas, docs, skills, and bundled scripts as expected | Did not execute the packed artifact in a clean consumer project. |
| `node ./bin/sdd.js validate sdd-skills --workspace . --json` | Valid; 0 errors/warnings, 0 Epics/Changes | Cannot establish implementation traceability without artifacts. |
| Packaged orphan-audit script | 112 candidates, 85 source, 2 test, 0 Epics | Epic-less scope intentionally does not classify unowned files. |
| Focused temporary probes | Reproduced symlink escape, alias ownership, overlapping artifacts, schema drift, and repository-only planned destination | Temporary local fixtures only; no production state and no persistent repo writes. |
| `git diff --check` | Passed | Does not validate behavior. |

## Recommended First Action

- Recommendation: plan the validator evidence-integrity Change first, treating the empty/fabricated Epic cases above as release-blocking negative tests; follow immediately with the filesystem-boundary hardening Change before a CLI release.
- Why first: the current dirty work materially expands Epic validation, but the gate can still certify the absence of the very implementation and evidence it is meant to preserve. Fixing the contract and its adversarial fixtures gives every later CLI improvement a trustworthy SDD evidence baseline.
- Suggested next workflow: discuss, then `/sdd-change --plan` once the validator contract is accepted.

## Guardrail

This is a point-in-time advisory report for the snapshot above. Accepted behavior and implementation truth belong in the relevant Epics and Changes. No application code was modified by this audit.
