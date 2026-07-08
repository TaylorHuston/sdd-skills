---
modified: 2026-07-07
---
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

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
