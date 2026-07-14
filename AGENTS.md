---
modified: 2026-07-14
---
# SDD Toolchain Agent Guide

Guidance for assistants working in this repository.

## Purpose

This repository packages the Story-Driven Development CLI, configuration schemas, and reusable Codex skills. Keep the package portable: the CLI, skills, schemas, and docs should make sense outside the private workspace where they are developed.

The packaged skills follow the `.agents/` skill-folder convention and should be usable by tools that respect that structure.

## Read First

- Read `README.md` for package purpose, artifact model, installation, and validation guidance.
- Read `skills/sdd-doctrine/SKILL.md` and its doctrine reference before changing SDD artifact semantics or workflow behavior; keep `docs/story-driven-development.md` as a synchronized browsable mirror.
- Check `CHANGELOG.md` when changing public package behavior, the packaged skill set, or release-facing docs.
- Prefer package-local files and public workflow doctrine over assumptions from any surrounding workspace.

## Branch Policy

- `main` is the stable release branch.
- Use short-lived branches for scoped package work when branch work is requested.
- Prefer `change/<short-slug>` for planned package behavior changes, `fix/<short-slug>` for defects, and `misc/<short-slug>` for docs, chores, tooling, and low-risk maintenance.
- Do not commit, push, amend, rebase, tag, publish, or open PRs unless the user explicitly asks in the current conversation.
- Inspect `git status` before editing, staging, committing, publishing, or release work. Keep unrelated dirty files out of the change.

## Repository Shape

```text
bin/
  sdd.js
src/
  cli.js
  commands/
schemas/
  workspace.schema.json
skills/
  sdd-*/
docs/
  story-driven-development.md
scripts/
  sync-skills.sh
test/
```

## Package Rules

- Keep skills self-contained and compliant with the OpenAI/Codex skill format.
- Keep CLI behavior deterministic and expose machine-readable JSON for agent-facing commands.
- Treat `.sdd/config.yaml` as the CLI workspace topology and `.sdd/install-lock.json` as generated installation evidence, not a second product-behavior source of truth.
- Never overwrite locally modified managed skills without an explicit `--force` operation.
- Keep the checked workspace schema, runtime validation, README examples, and generated configuration shape aligned.
- Keep package docs public-safe. Do not add private vault notes, local paths, credentials, or project-specific secrets.
- Prefer project-neutral wording. Use "the user", "project owner", or "application repo" instead of a specific person's name.
- Assume the documented idea-owned one-to-many repository mapping by default, but never assume a specific machine path. Keep project overrides possible through local guidance and keep package-wide customization instructions accurate.
- Keep README and CHANGELOG aligned with the actual package contents.
- Do not add broad framework-specific guidance directly into `SKILL.md` files unless it is core to the skill. Prefer progressively loaded references.
- If a skill, `skills/sdd-doctrine/references/story-driven-development.md`, and `docs/story-driven-development.md` disagree, reconcile them so the package stays internally consistent.

## Validation

Run the Node package checks for CLI, schema, installer, or package changes:

```bash
npm run check
```

Validate every changed skill with `quick_validate.py` before calling the work done:

```bash
for d in skills/sdd-*; do
  python3 /path/to/skill-creator/scripts/quick_validate.py "$d"
done
```

Use a temporary `PYTHONPATH` for `PyYAML` if needed. Do not add Python dependency folders to this repository.

For docs-only changes that do not alter skill files, skill metadata, or package behavior, state why skill validation was not run.

## Resources

Keep these references in mind when working on this package:

- `skills/sdd-doctrine/references/story-driven-development.md` - doctrine that actually ships with installed skills.
- `schemas/workspace.schema.json` - checked shape of workspace `.sdd/config.yaml` files.
- `src/commands/` - CLI command behavior and workspace mutations.
- `docs/story-driven-development.md` - browsable mirror of the shipped doctrine.
- `README.md` - package overview, installation, artifact model, and adaptation guidance.
- `CHANGELOG.md` - public release history and release-facing behavior notes.
- The local `skill-creator` system skill, when available - canonical guidance for OpenAI/Codex skill structure and validation.
- A consuming project's `.agents/skills/sdd-*` or user-level Codex skills directory - compare when syncing or debugging install drift.
- `https://github.com/Fission-AI/OpenSpec` - useful comparison point for proposal/change/spec workflow ideas.
- `https://keepachangelog.com/en/1.1.0/` - changelog format this repo should follow.

This list is informal context, not policy. Prefer the branch policy, package rules, validator, and current package files when instructions conflict.
