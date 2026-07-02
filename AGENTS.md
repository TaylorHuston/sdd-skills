---
modified: 2026-06-30
---
# SDD Skills Agent Guide

Guidance for assistants working in this repository.

## Purpose

This repository packages reusable Codex skills for Story-Driven Development. Keep the package portable: the skills and docs should make sense outside the private workspace where they are developed.

The packaged skills follow the `.agents/` skill-folder convention and should be usable by tools that respect that structure.

## Read First

- Read `README.md` for package purpose, artifact model, installation, and validation guidance.
- Read `docs/story-driven-development.md` before changing SDD doctrine, artifact semantics, or workflow behavior.
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
skills/
  sdd-*/
docs/
  story-driven-development.md
scripts/
  sync-skills.sh
```

## Package Rules

- Keep skills self-contained and compliant with the OpenAI/Codex skill format.
- Keep package docs public-safe. Do not add private vault notes, local paths, credentials, or project-specific secrets.
- Prefer project-neutral wording. Use "the user", "project owner", or "application repo" instead of a specific person's name.
- Do not assume a consuming project has a private workspace, a specific machine path, or the same docs layout as this package's development environment.
- Keep README and CHANGELOG aligned with the actual package contents.
- Do not add broad framework-specific guidance directly into `SKILL.md` files unless it is core to the skill. Prefer progressively loaded references.
- If a skill and `docs/story-driven-development.md` disagree, update one or both so the package stays internally consistent.

## Validation

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

- `docs/story-driven-development.md` - source of truth for the public SDD workflow this repo distributes.
- `README.md` - package overview, installation, artifact model, and adaptation guidance.
- `CHANGELOG.md` - public release history and release-facing behavior notes.
- The local `skill-creator` system skill, when available - canonical guidance for OpenAI/Codex skill structure and validation.
- A consuming project's `.agents/skills/sdd-*` or user-level Codex skills directory - compare when syncing or debugging install drift.
- `https://github.com/Fission-AI/OpenSpec` - useful comparison point for proposal/change/spec workflow ideas.
- `https://keepachangelog.com/en/1.1.0/` - changelog format this repo should follow.

This list is informal context, not policy. Prefer the branch policy, package rules, validator, and current package files when instructions conflict.
