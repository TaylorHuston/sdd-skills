---
modified: 2026-06-30
---
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once versioned releases begin.

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
