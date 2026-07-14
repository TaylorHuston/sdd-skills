---
modified: 2026-07-14
---
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added an npm-distributed `sdd` CLI preview with `init`, `update`, `doctor`, and `context` commands.
- Added workspace-local `.sdd/config.yaml` and installation-lock support for configurable planning roots, repository roots, repository artifact paths, and one-to-many idea mappings.
- Added checksum-managed skill installation that preserves unrelated skills, adopts matching installations, blocks local overwrites by default, and supports explicit dry-run and force modes.
- Added machine-readable JSON output and automated coverage for initialization, mapping import, diagnostics, context resolution, idempotency, and managed-skill safety.

### Changed

- Expanded the package from a skills-only distribution into an early SDD toolchain while retaining the legacy sync script and current doctrine-backed skills during migration.
- Expanded `/sdd-explore` into a durable space-level discussion workflow that maintains idea-owned exploration records, routes mature conclusions to stronger artifacts, and resolves workspace ownership through configurable CLI topology when available.
- Made first-time interactive `sdd init` ask for workspace-root-relative planning and repository paths, with detected defaults, multiple repository roots, explicit path flags, and a `--yes` automation mode.
- Replaced repeated idea and repository paths with a v2 derived-path configuration: idea planning defaults to the idea key, repositories reference named roots, explicit workspace-relative overrides remain available, and `sdd init` migrates v1 workspaces automatically.
### Deprecated

### Removed

### Fixed

### Security

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

### Deprecated

### Removed

### Fixed

### Security

## [0.5.0] - 2026-07-07

### Added

- Added a packaged `/sdd-review` report template and browsable template example.

### Changed

- Added delegation authorization guidance across `/sdd-review`, `/sdd-epic-verify`, and `/sdd-interactive`.
- Strengthened `/sdd-review` and `/sdd-release` around risk-shaped evidence, deterministic release-readiness claims, and manual UI testing handoffs.
- Updated the packaged SDD doctrine for project docs, evidence discipline, superseded Story reconciliation, and package-neutral workflow wording.

### Deprecated

### Removed

### Fixed

### Security

## [0.4.0] - 2026-07-02

### Added

- Added `scripts/epic_template_check.py` to `/sdd-epic-verify` for repeatable Epic template-shape checks.

### Changed

- Updated `/sdd-epic-verify` reports to include the Epic template checker as a required template-adherence gate.
- Tightened `/sdd-propose` so proposal work requires explicit planning interview, Story/Requirement challenge, scope-decision capture, and scenario-mapped verification planning before artifacts are finalized.
- Updated `/sdd-apply` promotion guidance for package-neutral workflow roots, user confirmation vocabulary, default-layout adaptation, explicit delegation authorization, risk-shaped evidence, and category-first specialist routing.

### Deprecated

### Removed

### Fixed

### Security

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
