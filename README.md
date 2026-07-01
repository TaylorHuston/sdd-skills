# SDD Skills

Reusable Codex skills for Story-Driven Development: an LLM-friendly workflow for planning, implementing, reviewing, and releasing larger application changes without losing traceability between product behavior, code, and verification evidence.

This repository packages the current SDD workflow skills as portable OpenAI/Codex skill folders. The skills are opinionated, but intentionally file-based: they work by reading and writing normal project artifacts such as Markdown specs, Epic files, change folders, task ledgers, review reports, and changelogs.

## What This Workflow Is For

SDD is designed for solo developers and small teams using LLM agents on non-trivial codebases.

The core idea is that durable product behavior should live in Epics, Stories, Requirements, Scenarios, and evidence indexes that point back to the relevant implementation and tests. Agents can then resume work, review drift, and safely continue implementation without rediscovering the whole codebase every time.

## Packaged Skills

Primary workflow:

| Skill | Purpose |
|---|---|
| `/sdd-prd` | Create or revise product direction before implementation work depends on it. |
| `/sdd-propose` | Create a dated change folder with `proposal.md`, `design.md`, and `tasks.md`; use `--replan` for planning-level discoveries during implementation. |
| `/sdd-apply` | Implement or continue a change using Requirement/Scenario-driven slices. |
| `/sdd-review` | Run the local PR-style integration gate after implementation. |
| `/sdd-release` | Prepare a production-branch release PR with checks and changelog updates. |

Support workflow:

| Skill | Purpose |
|---|---|
| `/sdd-explore` | Think through ideas or investigate context before proposing a change. |
| `/sdd-interactive` | Track and implement small concrete changes in one working session. |
| `/sdd-epic-verify` | Audit an Epic against current implementation and evidence. |
| `/sdd-space-status` | Summarize current SDD status across a project. |
| `/sdd-orphan-audit` | Find likely orphaned code, tests, and stale traceability evidence. |

## Artifact Model

The default project shape is:

```text
docs/
  epics/
    <key>-<###>-epic-name/
      epic.md
  changes/
    yyyy-mm-dd-change-name/
      proposal.md
      design.md
      tasks.md
      review.md        # only when review finds deficiencies
    closed/
```

Epics are the durable source of behavior truth. Stories, Requirements, Scenarios, `Implemented By`, `Verified By`, and `Verification Gaps` live inside each Epic's `epic.md`.

Change folders are working records. `proposal.md` defines scope, `design.md` defines the technical approach, and `tasks.md` is the adaptive implementation ledger and resume surface.

Generated indexes are optional. If a project maintains `docs/epics/index.md` or `docs/epics/story-index.json`, treat them as generated navigation or validation artifacts, not canonical truth.

## Installation

Copy the skill folders into a Codex-discoverable skills directory.

For a project-local install:

```bash
./scripts/sync-skills.sh /path/to/project/.agents/skills
```

For a user-level install:

```bash
./scripts/sync-skills.sh "${CODEX_HOME:-$HOME/.codex}/skills"
```

The sync script copies every `skills/sdd-*` folder into the target and removes stale files inside those target skill folders. It does not delete unrelated skills.

## Validation

Validate with Codex's `skill-creator` validator:

```bash
for d in skills/sdd-*; do
  python3 /path/to/skill-creator/scripts/quick_validate.py "$d"
done
```

If `PyYAML` is not installed globally, install it into a temporary directory and set `PYTHONPATH` for the validation command.

## Doctrine

The workflow doctrine is in [docs/story-driven-development.md](03-spaces/spaces-code/sdd-skills/docs/story-driven-development.md). Skills operationalize that doctrine. If a skill and the doctrine disagree, update one or both so the package stays internally consistent.

## Project Guidance Expected By The Skills

The skills work best when each application repo has:

- `AGENTS.md` with branch policy and project-specific guidance
- `README.md` with setup and verification commands
- `CHANGELOG.md` following Keep a Changelog
- `docs/epics/` for durable capability truth
- `docs/changes/` for active and closed changes

The skills prefer project-local guidance over package defaults.

## Status

This package is early. It was extracted from a working local workflow and lightly generalized for reuse. Expect the skill set and artifact conventions to keep tightening as real projects expose rough edges.
