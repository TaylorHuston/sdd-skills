---
modified: 2026-08-16
---
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added durable `sdd-slice-review-v1` records under `slice-reviews/` and generated minimal `sdd-slice-closure-v2` receipts under `slice-closures/`. New and reopened slices declare `Closure receipt: required`; deterministic validation checks exact Review/receipt identity, raw Review SHA-256, canonical gate and Scenario/visual sets, planned visual contract equality, durable proof-reference resolution, passing Scenario proof agreement with the Epic, accepted-gap consistency, and reviewed-tree/final-tree equality while leaving proof sufficiency and semantic quality to Review. Legacy v1 receipts, completed unmarked slices, Checklist tasks, five-column ledgers, and historical records remain compatible.
- Added a compact per-slice Gate Ledger that persists exact verification, Review, Epic Update, semantic/evidence closure, required-versus-explicitly-accepted gap, and final-commit state outside the replaceable Resume checkpoint. New structured Changes include it; Checklist tasks and five-column ledgers remain compatible, while resumed current-workflow slices reconstruct required gate state before completion.
- Added a compact evidence-closure gate across Epic Update, post-Epic Review, and Apply. Scenario evidence must exercise the behavior boundary it claims—backend/data, rendered interaction, live multi-context/realtime, provider/production, or manual acceptance—or remain an explicit verification gap.
- Changed Apply's same-slice review remediation to one discovery Review, one consolidated remediation batch, and one fresh final Review. Required findings need explicit contract, material-safety, project-policy, false-closure, or deterministic-gate grounds; another pre-existing finding after remediation returns `needs-user`, while only remediation-introduced regressions receive one narrow correction.
- Added a compact semantic-closure gate across Epic Update, post-Epic Review, and Apply so affected Story index rows, body states, maps, and gaps cannot contradict one another while a slice is marked done; deterministic validation alone no longer satisfies this gate.
- Clarified that Product Briefs/PRDs are directional starting points for deliberate periodic review, not continuously synchronized implementation truth. Ordinary PRD drift is advisory and cannot block Apply, Review, integration, or closeout unless the current Change explicitly depends on an unresolved product decision or project guidance grants the PRD stronger authority.
- Added `/sdd-changelog`, an independently callable candidate-bound capability that follows each repository's native changelog, changeset, generated-note, or no-record policy; creates or updates one reviewed user/operator entry when warranted; returns `no-op` for internal-only, duplicate, generated, or speculative work; proves its release-record-only edit preserves the reviewed implementation projection; and stops before versioning, staging, commits, PRs, release, or deployment.
- Added read-only `sdd candidate resolve` as the shared immutable committed/working-tree envelope primitive for candidate-bound skills. It inventories staged, unstaged, and relevant untracked state with content-sensitive watermarks while disabling external diff, text conversion, and configured clean/process filters. `sdd epic update-input` now preserves its existing contract as an Epic-specific wrapper.
- Added `/sdd-epic-update`, an independently callable and Apply-composable candidate-bound capability that reconciles repository-owned Epic, Story, Requirement, Scenario, implementation-map, gap, and verification-map truth after reviewed or manual work. It works without fabricated Apply history, returns `complete`, `no-op`, `needs-user`, `blocked`, or `routed`, proves same-candidate idempotence, and stops before code review, code fixes, Change lifecycle changes, changelog work, and commits.
- Added read-only `sdd epic update-input` to resolve immutable baselines and committed or working-tree candidates, reject non-ancestor committed ranges, inventory changed paths plus staged/unstaged/untracked state, and return configured Epic roots and scoped validation commands without making semantic decisions or mutating artifacts.
- Added `/sdd-gather-context`, a lightweight same-session shared skill that reads and reconciles the action-specific minimum planning, decision, behavior, implementation, test, and Git evidence before Explore, ADR, or Change proceeds.
- Added one progressive Change record per outcome under `<workspace>/.sdd/changes/`; `change.md` owns intent, lifecycle status, Space, and repository IDs from intent capture through close.
- Added complete README matrices for every packaged skill and CLI command, including their lifecycle responsibilities and handoffs.
- Added deterministic parsing for structured Requirement slices, dependency graphs, one-row-per-slice Implementation Ledgers, and fixed-label Resume checkpoints with repository candidate envelopes.

### Changed

- Apply, Review, and Epic Update now reject temporary-only, placeholder, generic, missing, and unanchored technical evidence plus conclusion-leading reviewer prompts. Completion-consuming reviews require candidate-bound anchored evidence that appears in canonical Epic proof, a Gate Execution Manifest with gate-specific outcomes and dated accepted-Scenario mappings, an actually run diff-scoped reverse-traceability audit, and explicit accounting for exact triggered visual obligations and observations such as long content and failure recovery.
- Structured Change validation now rejects duplicate Scenario references and unsupported multi-Requirement slices without explicit coupling justification, constrains Gate Ledger candidates to canonical commit or content-sensitive working-tree watermarks, checks candidate identity across verification, implementation Review, Epic Update, and post-Epic Review, and validates gap references plus dated user acceptance. Slices marked `Closure receipt: required` cannot validate as `done` without complete gate, durable Review, and minimal receipt state; legacy v1 and unmarked completed slices remain compatible.
- Apply, Epic Update, and slice Review now require exact affected-Scenario coverage with one claimed-boundary/proven-boundary closure row per Scenario. Scoped remediation must end with a fresh comprehensive slice review; required rendered, realtime, provider, or other technical gaps cannot pass as manual acceptance or an unaccepted partial state.
- Apply now treats absent explicit semantic/evidence closure results as stale even when a slice is nominally `done`, preventing an early `no-op` from bypassing newly required closure gates.
- `/sdd-design --plan` now starts only after `/sdd-change` has produced a validated `planned` Change, while `--revise` binds feedback to exact repository candidate envelopes, reopens every affected slice while preserving dependency order when implementation must change, refreshes the current checkpoint instead of accumulating a design diary, returns the shared composable statuses, and stops before separately invoked Apply, Review, Epic Update, or Changelog work. Prototypes and named design tools remain optional.
- **Breaking:** New structured `tasks.md` files add a `Commit` column to the Implementation Ledger. Apply leaves it `pending` until the reviewed slice is committed, then records the full 40-character SHA; the validator continues to accept the earlier five-column ledger for existing Changes.
- **Breaking:** `/sdd-apply` now owns exactly one atomic Requirement slice per invocation, with multi-Requirement slices permitted only when planning records genuine coupling. It states a transient proof sketch before coding, records an exact pre-slice diff envelope, implements inline or through one optional isolated worker, independently verifies, runs one discovery Review, applies one admitted remediation batch, then persists one final candidate-bound slice Review before Epic Update and sealing. New slices use a minimal v2 receipt; Apply still stops before another slice, final Change-wide Review, Changelog, push, PR, release, deployment, or closeout.
- **Breaking:** `/sdd-change` is now one adaptive workflow: it creates or resumes a proposed Change, captures intent, and asks before continuing into technical planning. Proposed Changes require only `change.md`; planning progressively expands that record and adds `tasks.md`. It returns `complete`, `no-op`, `needs-user`, `blocked`, or `routed` and stops before Design, Apply, or another workflow's mutation boundary. Future workflows do not create `design.md`; existing records remain compatible.
- Future `tasks.md` records are concise adaptive one-Requirement queues: each slice must be atomically completable in one fresh session with an observable outcome, Scenario-based test cycle, meaningful review verdict, repository, dependencies, applicable binding constraints and `Consumes`/`Produces` contracts, focused verification intent, and manual acceptance need. Multiple Requirements need an explicit coupling justification; broad Requirements are split during planning rather than partially completed. A lightweight current-state Implementation Ledger keeps one row per slice and is maintained by `/sdd-apply` without becoming a command, verification, or review log; its commit cell records only the final durable slice boundary.
- `/sdd-change` now composes with `/sdd-adr` whenever planning reveals two or more meaningfully different viable technical approaches. `/sdd-adr` now verifies that the alternatives are genuinely viable, confirms consequential decisions with the user, writes only warranted repository-owned ADRs, returns `complete`, `no-op`, `needs-user`, `blocked`, or `routed`, and stops before caller-owned Change, exploration, Epic, or implementation mutations.
- `/sdd-explore` now serves any substantial discussion the user wants preserved beyond chat, uses the shared context capability before substantive claims, defaults idea-owned records to `<idea>/explorations/` and workspace-owned records to `<workspace>/.sdd/explorations/`, returns an explicit composable result, and stops at a routed handoff instead of automatically crossing into PRD, Change, ADR, or another workflow.
- **Breaking:** `sdd change create` now creates only the proposed `change.md` record and allows repository ownership to remain empty until planning settles the target set.
- **Breaking:** Change status and ownership metadata moved from `tasks.md` to `change.md`; status, validation, `sdd change transition`, and `sdd change close` read the progressive record, and lifecycle mutations now use proportional workspace-locked local filesystem operations instead of bespoke crash-recovery journals.
- `sdd validate` now applies lifecycle-aware Change requirements: proposed Changes need only `change.md`, while later states require repository ownership, technical-planning sections in `change.md`, and `tasks.md`. Structured Requirement-slice Changes additionally receive deterministic slice, reference, dependency, ledger, and Resume-checkpoint validation; Checklist-based legacy and Interactive task shapes remain compatible. Existing `design.md` files remain accepted and validated.
- `sdd change transition proposed -> planned` now rejects malformed structured Requirement-slice plans before mutating lifecycle state, and `sdd validate --help` plus `sdd update --help` now provide focused command-specific usage.
- **Breaking:** installation ownership moves from the operating-system user to one explicit workspace; configuration, Changes, managed workflow state, and recovery live under `<workspace>/.sdd/`, while managed skills default to `<workspace>/.agents/skills/`.
- `sdd update` now performs one bounded job: reconcile the current workspace's checksum-managed doctrine and skills.
- Planning, Apply, Review, PR, Release, Interactive, Epic verification, audits, and Space status now share one workspace-central Change record and treat repository entries only as stable targets or filtered projections.
- Status and validation keep Space-owned Changes visible when repository mappings go stale, reject unresolved repository ownership, and report active/closed ID collisions within the selected workspace even through scoped projections.
- `/sdd-release` now records repository-keyed candidates, checks, authorization, and handoffs for the complete target set, with one aggregate coordination and closeout gate.
- `/sdd-review` now classifies candidate release impact and rejects misleading existing claims without treating a separately pending Changelog entry as an implementation defect. `/sdd-release` now requires current candidate-specific Changelog entries or evidence-based `no-op` results where policy calls for them, then owns release-wide aggregation and version intent instead of silently drafting missing per-change entries.

### Removed

- Removed `/sdd-apply`'s universal TDD/subagent methodology, risk and evidence matrices, verification ledger, chronological implementation diary, phase-commit policy, self-review loop, changelog/Epic templates, and closeout procedure.
- Removed obsolete no-op Change-transition recovery exports and the status command's unnecessary mutation-lock wrapper.
- Removed separate Change Brief storage, `--brief`/`--plan`/`--replan` modes, and the brief/proposal templates.
- Removed Change transition and close transaction-journal machinery that was disproportionate for the local pre-1.0 workflow.
- Removed programmatic migration of pre-1.0 home installations, configuration schemas, and legacy Change locations, including `sdd setup --from-user` and the update migration/recovery subsystem. Alpha data must be recreated or converted manually.
- Removed `sdd change promote` and repository-configured Change roots; transition and close now operate once on the canonical central record.
- Removed `schemas/user.schema.json` and all user-v1/v2 compatibility handling.

## [0.12.0] - 2026-07-23

### Added

- Added versioned Epic verification reports with deterministic current-result, remediation, and lineage validation, plus opt-in `sdd validate --changed-from <commit-ish>` checks for stale Epic `modified` metadata.
- `sdd doctor` now inspects recognized root guidance files in active mapped repositories and reports obsolete managed-workflow locations or retired `/sdd-propose` instructions.
- Added the versioned `sdd-epic-v2` template with independent implementation and verification state, behavior-mapped implementation locations, and separate implementation gaps.

### Changed

- `/sdd-review` now uses a systematic candidate-generation pipeline across intent and history, complete diff coverage, dependency and contract propagation, configured deterministic analyzers, risk-shaped reasoning passes, and explicit blind-spot accounting before consolidating findings.
- Epic verification now separates historical audit failures from current findings and requires a full final recheck before `aligned`; PR and release workflows now reconcile an exact source-to-target file allowlist before handoff.
- `/sdd-pr` now performs safe narrow remediation by default and no longer exposes a redundant `--fix` mode.
- Epic traceability now requires one authoritative current implementation/verification map per Story, behavior-owning primary anchors, narrower mapping for distinct governing boundaries, exact named test evidence instead of framework tokens, current-tense implemented Outcomes, and reconciliation of stale supporting docs and closed Change claims.
- `sdd validate` now rejects competing prior/detailed/legacy Story traceability sections and generic automated evidence anchors such as `#it(`, `#test(`, and `#describe(`.
- CLI validation now rejects empty v2 behavior structure, incomplete evidence rows, fabricated or unanchored source/test claims, external symlink evidence, and unrelated Epic reads during a focused validation.
- Configuration and lifecycle commands now reject unknown keys, physical repository aliases, invalid repository-artifact overlap or escape, repository-only planning guesses, active/closed Change ID collisions, and planned Changes paths that lexically or physically escape their planning owner.
- Managed configuration and lock writes are atomic, managed updates are serialized, lifecycle mutations detect commit-time drift and report incomplete recovery, guidance diagnostics ignore non-affirmative historical/negated examples, and Git status degrades after a bounded timeout.
- `sdd validate` now checks v2 Story Index/body consistency, implementation and verification coverage, repository-relative implementation paths, gap contradictions, strict automated evidence paths, and oversized-Story review signals while retaining legacy Epic compatibility warnings.
- SDD planning, apply, review, Epic verification, and orphan-audit guidance now treats cold-start code navigation as a required traceability outcome.
- `/sdd-apply` default/full mode now persists through all safe implementation and self-remediation work until the Change is transitioned to `in_review` and ready for independent review, unless an explicit bounded mode or genuine stop condition applies.
- `/sdd-apply` now treats local commits as regular phase boundaries: commit every completed, verified Requirement/Scenario slice before beginning the next, and use coherent green checkpoints for unusually long phases unless `--no-commit`, the user, repository policy, or file-isolation safety prevents it.
- Planning now defines the required end state and confirmation obligations without freezing an implementation sequence; `/sdd-apply` maintains living risk, decision fan-out, verification-environment, phase-closure, and immutable review-handoff records as implementation reveals the real path.
- `/sdd-release` now reviews the changelog against release scope, recommends and confirms the project-policy version increment, and treats default/full invocation as scoped authorization for one normal source push and the configured release PR after all gates pass without extending that permission to merge, tag, publish, or deploy.
- `/sdd-review` now requires every applicable review gate to finish before one consolidated verdict, treating ordinary blocking findings as verdict evidence rather than a reason to stop discovery at the first issue.
- `/sdd-review --until-ready` now defaults to at most five remediation iterations.
- `/sdd-review` now treats long-running commands, yielded command sessions, progress updates, and status questions as continuation points rather than accidental review boundaries.
- `/sdd-review --until-ready` now has the same mandatory full final-report contract as a single review loop, including a complete gate scorecard, final reviewed commit, cumulative remediation, residual findings, and explicit classification of pending live-provider evidence.
- UI-bearing planning, apply, and review now use a proportional Visual Verification Matrix and require agents to render current source, exercise changed interactions, directly inspect screenshots or rendered results, check console/network failures, and cover representative viewports and relevant states before review readiness. The workflow remains tool-agnostic and keeps owner manual acceptance separate.
- `/sdd-apply` now uses triggered Pattern Parity and Stateful Transition matrices for new sibling implementations and stateful surfaces, while `/sdd-review` adds independent pattern-conformance, transition, and evidence-falsification gates. New or high-risk evidence claims must identify exact test anchors and important assertions, survive test-discovery and boundary checks, and cannot rely on aggregate green commands or unsupported Scenario aggregation.
- Planning, apply, and review now add triggered Boundary Contract coverage, concurrent and durable lifecycle interleavings, capability-authority and content-budget/provenance conservation, and filesystem ancestor/confinement validation before mutation.
- `/sdd-release` now requires a fresh-context cumulative release-candidate review for initial, multi-Change, materially post-review, or high-risk combined diffs, while `/sdd-pr` and release handoffs track required/optional remote reviewer and check watermarks against exact PR heads.
- The framework-free one-page guide now uses the shared UI Foundations Steel identity profile, canonical semantic tokens, and a dark documentation shell with a persistent table of contents, bounded reading column, compact section hierarchy, and inline references. Narrative sections rely on type, spacing, and rules rather than stacks of decorative cards; contained surfaces are reserved for rendered documents, evidence, code, and controls. Its first half explains the context-loss problem, portable SDD model, general workflow, durable Story semantics, and a minimal complete Epic; it makes explicit that behavior changes update the existing Story and that new Stories represent distinct durable user outcomes rather than implementation tasks. Its second half documents this package's default layouts, CLI, agent skills, and lifecycle conventions. The page also adds responsive section navigation, active-location feedback, accessible touch targets and copy status, a navigable Epic outline, readable mobile type, and a sequential heading structure. It links to the original essay.

### Removed

- Removed the redundant `/sdd-review --fix` alias. Safe consolidated remediation remains the default, while `--until-ready` now works directly.

## [0.11.0] - 2026-07-18

### Added

- Added `/sdd-code-audit` for read-only repository or subsystem health audits using independent specialist reviewers and evidence-validated improvement planning.
- Added `sdd setup` for one-time user configuration and global skill installation.
- Added `sdd setup --from-workspace` to dry-run or apply a non-destructive conversion of pre-1.0 workspace topology into user-level configuration.

### Changed

- `sdd init` now creates only the current repository's portable `.sdd/config.yaml`; the package doctrine is resolved through `sdd context` instead of copied into a parent workspace.
- User-level skills default to the cross-agent `~/.agents/skills/` directory; `--skills-dir` remains available for Codex-specific or custom installations.
- Existing pre-1.0 workspace-local configurations remain readable during migration, with explicit `sdd init --legacy-workspace` support for compatibility testing.
- Invoking `/sdd-apply` against an explicitly selected private Planned Change now authorizes automatic promotion into its unambiguous implementation repository; Changes that are not `planned` stop with planning guidance instead of being promoted.
- Reframed the public one-page guide to distinguish portable Story-Driven Development principles from this package's Markdown, CLI, and agent-skill implementation.

### Removed

- Removed the legacy direct skill-sync script; use `sdd setup` and `sdd update` so managed installations retain configuration, checksums, and conflict protection.

## [0.10.1] - 2026-07-17

### Changed

- UI planning, design, apply, and review workflows now classify material component strategies, keep shared catalogs optional, follow project ownership models for adopted references, and require implemented consumer evidence before claiming standardization.

## [0.10.0] - 2026-07-17

### Added

- Added a responsive, accessible, framework-free introduction to the SDD process, configured for GitHub Pages deployment.
- Added tiered reverse-traceability gates for changed-surface implementation, source-vs-target review, full Epic verification, and repository-wide orphan audits.
- Added Epic and changed-ref scoping to the conservative orphan-audit inventory, including working-tree awareness, evidence-glob expansion, and separate test-support/framework/generated candidate categories.

### Changed

- Updated `/sdd-review` to keep a clean technical verdict as `ready` when only the user's manual confirmation remains, while reporting acceptance and closeout readiness separately instead of requesting implementation changes.
- Updated `/sdd-pr` and `/sdd-release` to carry manual acceptance separately from technical review readiness and prevent acceptance-dependent actions while required confirmation remains pending.
- Automated `Verified By` evidence now names existing repository-relative test paths; deterministic validation warns on generic suite labels and missing paths.
- Project guidance now identifies truth-bearing supporting docs and project-specific support/generated/test-harness conventions used during reconciliation.

## [0.9.0] - 2026-07-15

### Added

- Added `/sdd-design --revise` for reopening an implemented experience direction after comparison, review, or manual feedback while preserving accepted behavior and recording the current contract plus revision history in Change artifacts.
- Added `sdd change transition` for guarded compare-and-set active Change status updates with multi-repository preflight, dry-run behavior, and JSON output.

### Changed

- Expanded `/sdd-review` supporting-truth review to reconcile the owning Idea's current entry-point documentation with configured repository mappings, active/archive lifecycle, and implementation reality.
- Updated exploration, planning, and implementation workflows to prefer an available current-documentation capability such as Context7 for version-sensitive external behavior, with primary vendor documentation as the fallback.

## [0.8.2] - 2026-07-15

### Changed

- Expanded `/sdd-space-status` direct-Space re-entry with the last three local commits per active repository and deeper reconciliation of `in_progress` Change records against recent code activity.

## [0.8.1] - 2026-07-15

### Changed

- Simplified the Change lifecycle to `proposed`, `planned`, `in_progress`, `in_review`, and folder-derived `closed`; promotion now requires a completed plan and closeout requires an independently reviewed Change.

### Fixed

- Fixed detailed `sdd status` output and JSON so all `activeChanges` are separate from the five most recent closed `recentChanges`.

## [0.8.0] - 2026-07-15

### Added

- Added optional `/sdd-design` for converging user flow, responsive composition, component/state behavior, accessibility, and visual direction in existing Change artifacts before UI implementation.
- Added `sdd change close` for collision-safe, multi-repository transition of `ready_to_close` Changes into configured closed history, with dry-run and JSON output.
- Added `sdd validate` for deterministic workspace, Space, repository, Change, and Epic artifact checks with scoped filters, structured findings, and automation-friendly exit status.
- Added `sdd epic create` for atomic canonical Epic scaffolding with immediate structural validation, dry-run support, and JSON output.

### Changed

- Split change intake into `/sdd-change --brief`, `--plan`, and `--replan`, keeping undated intent capture separate from just-in-time technical planning.
- Integrated scoped CLI validation into planning, implementation, review, and Epic verification, including validation of Epic paths declared by a Change.

### Removed

- Removed `/sdd-propose`; use `/sdd-change --plan` for implementation-ready planning. `sdd update` removes unchanged package-managed copies during upgrade.

### Fixed

- Fixed `sdd change --help` so the Change command group prints its available subcommands.

## [0.7.0] - 2026-07-14

### Added

- Added the `sdd` CLI with workspace initialization, configuration repair, managed updates, diagnostics, context resolution, status reporting, and planned-Change commands.
- Added workspace-local `.sdd/config.yaml` topology with stable Space IDs, one-to-many idea/repository mappings, and independent `active`, `inactive`, and `archived` lifecycle status.
- Added checksum-protected installation and updates for the managed workflow and workspace-local SDD skills without overwriting unrelated or locally modified skills by default.
- Added `sdd status` summary and Space-detail views with active Change state plus repository branch and clean/dirty Git metadata.
- Added `sdd change create` and `sdd change promote` for private planning drafts and collision-safe promotion into one or more active implementation repositories.
- Added human-readable and machine-readable JSON output, with dry-run support for mutating workspace and Change commands.

### Changed

- Expanded the package from a skills-only distribution into an early SDD toolchain while retaining the legacy sync script for pre-CLI installations.
- Expanded `/sdd-explore` into a durable space-level discussion workflow that maintains idea-owned exploration records, routes mature conclusions to stronger artifacts, and resolves workspace ownership through configurable CLI topology when available.
- Made first-time `sdd init` collect workspace-relative planning and repository roots interactively or through explicit automation flags.
- Replaced repeated idea and repository paths with a v2 derived-path configuration while preserving explicit overrides and automatic v1 migration.
- Updated every SDD workflow skill to resolve topology through `sdd context` and load the CLI-managed workspace workflow instead of a support skill.
- Simplified `/sdd-space-status` into a read-only semantic wrapper around `sdd status --json`, leaving deterministic discovery and ordering to the CLI.
- Grouped status by idea and repository, including active entries without current Changes; `--all` retains inactive and archived inventory.
- Changed `/sdd-review` and `/sdd-apply` to collect complete specialist findings before editing, remediate safe findings as one consolidated batch, and use a regression-focused validation pass instead of serial review/apply loops.
- Made `sdd doctor` report moved topology roots once and recommend `sdd configure` for remediation.

### Removed

- Removed the `/sdd-doctrine` support skill; its canonical content now ships from `docs/story-driven-development.md` into the workspace `.sdd/` directory.

### Fixed

- Improved human-readable status output spacing.

## [0.6.0] - 2026-07-14

### Added

- Added `/sdd-doctrine` as an installable support skill so the portable SDD semantic contract ships with the workflow skills.

### Changed

- Updated `/sdd-pr` to classify every post-review change, reconcile affected Epic/Story truth and evidence, and require fresh SDD review for material behavior, contract, security, data, API, architecture, or risk changes.
- Added immutable reviewed-source and latest-reconciled commit watermarks to `/sdd-review`, `/sdd-release`, and their public templates so PR readiness cannot silently outlive the reviewed diff.
- Kept remote review configuration provider-neutral instead of assuming a specific review service.
- Generalized `/sdd-apply` to discover and enforce materially relevant skills exposed by the consuming runtime without requiring a fixed companion-skill catalog.
- Removed mandatory skill-selection telemetry from `/sdd-apply`; only consequential guidance outcomes belong in the existing implementation and verification record.
- Separated portable SDD doctrine from consuming-project policy across the skill suite. The doctrine now enforces canonical SDD artifacts under the repository `docs/` tree, while branches, commands, release conventions, technology constraints, explicit idea/repository relationship exceptions, and local preferences resolve from project guidance.
- Added a default idea-owned one-to-many repository model: private planning lives under `ideas/<idea>/`, Folder Note metadata maps zero or more `code/<repo>` repositories, basename matching is fallback-only, and public repos do not need private reverse links.
- Generalized `/sdd-pr` and `/sdd-release` around the configured review provider, production target, versioning policy, and release-record format instead of requiring GitHub, `main`, SemVer inference, or Keep a Changelog.

## [0.5.0] - 2026-07-07

### Added

- Added a packaged `/sdd-review` report template and browsable template example.

### Changed

- Added delegation authorization guidance across `/sdd-review`, `/sdd-epic-verify`, and `/sdd-interactive`.
- Strengthened `/sdd-review` and `/sdd-release` around risk-shaped evidence, deterministic release-readiness claims, and manual UI testing handoffs.
- Updated the packaged SDD doctrine for project docs, evidence discipline, superseded Story reconciliation, and package-neutral workflow wording.

## [0.4.0] - 2026-07-02

### Added

- Added `scripts/epic_template_check.py` to `/sdd-epic-verify` for repeatable Epic template-shape checks.

### Changed

- Updated `/sdd-epic-verify` reports to include the Epic template checker as a required template-adherence gate.
- Tightened `/sdd-propose` so proposal work requires explicit planning interview, Story/Requirement challenge, scope-decision capture, and scenario-mapped verification planning before artifacts are finalized.
- Updated `/sdd-apply` promotion guidance for package-neutral workflow roots, user confirmation vocabulary, default-layout adaptation, explicit delegation authorization, risk-shaped evidence, and category-first specialist routing.

## [0.3.0] - 2026-07-01

### Added

- Added `/sdd-adr` for durable architecture decision records and `/sdd-pr` for SDD-backed pull request stewardship.
- Added canonical template examples under `docs/templates/` for easy browsing.
- Added canonical Epic and ADR templates for packaged SDD workflows.
- Added stronger Epic verification checks for doctrine adherence, template adherence, missing Stories, missing Requirements, and missing Scenarios.

### Changed

- Updated SDD doctrine and skills to use Epic-scoped Story labels such as `S1` instead of requiring globally unique Story IDs for new embedded Stories.
- Tightened Epic evidence guidance so `Verified By` is a scenario-mapped evidence index, while chronological command history stays in change ledgers.
- Made `/sdd-propose` a more thorough planning action with technical option comparison, client/API boundary planning, and ADR routing for durable decisions.
- Updated `/sdd-explore`, `/sdd-release`, and `/sdd-pr` routing around ADR capture and PR stewardship.
- Refocused `/sdd-space-status` into a read-only app re-entry brief.
- Softened `/sdd-release` so full E2E is required by project policy or release risk, not merely by default.
- Clarified `/sdd-interactive` artifacts as lightweight subsets of `/sdd-propose` templates.
- Tightened package `AGENTS.md`, README, and doctrine guidance for public, portable use.

## [0.2.1] - 2026-06-30

### Fixed

- Removed unused Obsidian frontmatter fields from the packaged SDD doctrine document.

## [0.2.0] - 2026-06-30

### Added

- Added deep `/sdd-review` behavior as the default local PR-style gate, including review bundles, delegated review pass guidance, and a reusable PR review subagent prompt.
- Added package doctrine that treats SDD as an evidence-backed behavior-to-code map, with undocumented implemented behavior treated as drift until represented in Epic/Story truth.
- Added `/sdd-propose --replan` for mid-change discoveries that need revised planning before `/sdd-apply` resumes.
- Added a `Planning Updates` ledger section to the generated `tasks.md` template.
- Added README guidance for the current meta-repo development shape and adapting the packaged skills to different repository and documentation layouts.

### Changed

- Clarified that packaged skills follow the `.agents/` skill-folder convention.
- Generalized PRD/planning references around project planning docs instead of a vault-specific path.
- Updated `/sdd-review` to use `git merge-tree --write-tree` exit status as the preferred merge-conflict check.
- Fixed the README doctrine link.

## [0.1.0] - 2026-06-29

### Added

- Initial reusable SDD skill package with 10 workflow skills.
- Packaged SDD doctrine in `docs/story-driven-development.md`.
- Sync script for installing packaged skills into project-local or user-level skill directories.
- README explaining the workflow, artifact model, installation, validation, and expected project guidance.

### Changed

- Generalized copied skills to remove local user and machine-specific references.
