---
modified: 2026-06-30
---
# AGENTS.md

Guidance for assistants working in this repository.

## Purpose

This repository packages reusable skills for Story-Driven Development.

The packaged skills follow the `.agents/` skill-folder convention and should be usable by tools that respect that structure.

## Resources

Keep these references in mind when working on this package:

- Packaged doctrine: `docs/story-driven-development.md` - source of truth for the public SDD workflow this repo distributes.
- Skill authoring guidance: the local `skill-creator` system skill when available - canonical guidance for OpenAI/Codex skill structure and validation.
- Installed skill copy: the consuming project's `.agents/skills/sdd-*` or user-level Codex skills directory - compare when syncing or debugging install drift.
- OpenSpec inspiration: `https://github.com/Fission-AI/OpenSpec` - useful comparison point for proposal/change/spec workflow ideas.
- Keep a Changelog: `https://keepachangelog.com/en/1.1.0/` - changelog format this repo should follow.

This list is informal context, not policy. Prefer the branch policy, editing rules, skill validator, and current package files when instructions conflict.

## Branch Policy

- `main` is the stable branch.
- Use short-lived branches for changes.
- Do not commit, push, amend, rebase, tag, publish, or open PRs unless the user explicitly asks in the current conversation.

## Editing Rules

- Keep skills self-contained and compliant with the OpenAI/Codex skill format.
- Validate every changed skill with `quick_validate.py` before calling the work done.
- Keep package docs public-safe. Do not add private vault notes, local paths, credentials, or project-specific secrets.
- Prefer project-neutral wording. Use "the user", "project owner", or "application repo" instead of a specific person's name.
- Keep README and CHANGELOG aligned with the actual package contents.
- Do not add broad framework-specific guidance directly into `SKILL.md` files unless it is core to the skill. Prefer progressively loaded references.

## Repository Shape

```text
skills/
  sdd-*/
docs/
  story-driven-development.md
scripts/
  sync-skills.sh
```

## Validation

Run:

```bash
for d in skills/sdd-*; do
  python3 /path/to/skill-creator/scripts/quick_validate.py "$d"
done
```

Use a temporary `PYTHONPATH` for `PyYAML` if needed. Do not add Python dependency folders to this repository.
