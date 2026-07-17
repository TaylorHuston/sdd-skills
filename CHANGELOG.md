---
modified: 2026-07-17
---
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
