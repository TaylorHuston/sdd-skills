---
modified: 2026-07-07
---
# SDD Skills

Reusable Codex skills for Story-Driven Development: an LLM-friendly workflow for planning, implementing, reviewing, and releasing larger application changes without losing traceability between product behavior, code, and verification evidence.

This repository packages the current SDD workflow skills as portable OpenAI/Codex skill folders. The skills are opinionated, but intentionally file-based: they work by reading and writing normal project artifacts such as Markdown specs, Epic files, change folders, task ledgers, review reports, and changelogs.

## What This Workflow Is For

SDD is designed for solo developers and small teams using LLM agents on non-trivial codebases.

The core idea is that SDD maintains an evidence-backed map from product behavior to implementation. Durable product behavior should live in Epics, Stories, Requirements, Scenarios, and evidence indexes that point back to the relevant implementation and tests. Agents can then resume work, review drift, debug broken behavior, and safely continue implementation without rediscovering the whole codebase every time.

## Packaged Skills

Primary workflow:

| Skill | Purpose |
|---|---|
| `/sdd-prd` | Create or revise product direction before implementation work depends on it. |
| `/sdd-propose` | Create a dated change folder with `proposal.md`, `design.md`, and `tasks.md`; use `--replan` for planning-level discoveries during implementation. |
| `/sdd-apply` | Implement or continue a change using Requirement/Scenario-driven slices. |
| `/sdd-review` | Run the deep local PR-style integration gate against the target branch after implementation. |
| `/sdd-release` | Prepare a production-branch release PR with checks and changelog updates. |

Support workflow:

| Skill | Purpose |
|---|---|
| `/sdd-adr` | Create, update, or assess ADRs for durable SDD architecture decisions. |
| `/sdd-explore` | Think through ideas, compare approaches, investigate context, and offer ADR capture when durable architecture decisions emerge. |
| `/sdd-interactive` | Track and implement small concrete changes in one working session. |
| `/sdd-epic-verify` | Audit an Epic against current implementation and evidence. |
| `/sdd-pr` | Open or steward SDD-backed pull requests, process review comments/checks, and stop before merge for user approval. |
| `/sdd-space-status` | Produce a read-only re-entry brief when returning to an app after time away. |
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

Epics are the durable behavior-to-code map. Stories, Requirements, Scenarios, `Implemented By`, `Verified By`, and `Verification Gaps` live inside each Epic's `epic.md`. `Verified By` is a scenario-mapped evidence index, not a chronological command log; broad gates such as lint, typecheck, build, or full CI are supporting evidence unless tied to a named Requirement or Scenario. If implemented behavior is not represented in an Epic/Story, treat it as undocumented drift until the map is updated or the code is removed through a tracked change.

Change folders are working records. `proposal.md` defines scope, `design.md` defines the technical approach, and `tasks.md` is the adaptive implementation ledger and resume surface.

For non-trivial changes, `design.md` should compare viable technical options before selecting an approach. When a change creates a durable architecture, data, dependency, integration, deployment, security, storage, or cross-cutting project decision, record it as an ADR under `docs/adrs/` unless project-local guidance uses a different ADR location.

Product Briefs/PRDs and app visual/style guidance are project planning artifacts. Store them wherever the project keeps private planning docs, and reference them from SDD skills when product scope, UI identity, or release-readiness depends on them.

Generated indexes are optional. If a project maintains `docs/epics/index.md` or `docs/epics/story-index.json`, treat them as generated navigation or validation artifacts, not canonical truth.

Canonical template examples are browsable in [docs/templates/](docs/templates/). These mirror the skill-local template assets used to create PRDs, Epics, changes, ADRs, review reports, audit reports, changelogs, and release PR notes.

## Current Development Shape

This package is currently developed in a meta-repo situation: the reusable `sdd-skills` package lives inside a larger private workspace that also contains planning docs, shared guidance, and multiple application repositories. That shape is useful for developing the workflow because the active skills can be tested against real projects before being generalized back into this package.

The package should not require that exact shape. A generic version of the development layout looks like this:

```text
workspace/
  meta-vault/
    spaces/
      shared/
        visual-style-guide.md
        memories/
      docs/
        app-one/
          prd.md
          visual-identity.md
      code/
        app-one/
          AGENTS.md
          README.md
          CHANGELOG.md
          docs/
            epics/
            changes/
        sdd-skills/
          README.md
          docs/
            story-driven-development.md
          skills/
            sdd-*/
```

In that example, `meta-vault/` is the private workspace, `spaces/docs/` holds planning context, `spaces/code/app-one/` is an application repo with its own Git history, and `spaces/code/sdd-skills/` is this package repo. Other users might keep everything in one app repo, split planning docs into a separate private repo, or install the skills only at the user level.

## Adapting The Skills To Your Shape

Start by using project-local guidance before changing the packaged skills. A good `AGENTS.md` can usually teach the skills where your docs live, which branch policy applies, which checks matter, and what counts as done. Fork or edit the skills when your layout or workflow differs enough that local guidance would become repetitive or ambiguous.

Common adaptation points:

- Planning docs: `/sdd-prd`, `/sdd-propose`, `/sdd-review`, and `/sdd-release` may need updated language if Product Briefs, PRDs, visual identity docs, or design notes live outside the app repo.
- SDD artifact paths: most skills assume `docs/epics/`, `docs/changes/`, and `docs/adrs/`. Alter `/sdd-propose`, `/sdd-apply`, `/sdd-review`, `/sdd-adr`, `/sdd-epic-verify`, `/sdd-space-status`, and `/sdd-orphan-audit` if your canonical paths differ.
- Branch and merge policy: `/sdd-review`, `/sdd-pr`, and `/sdd-release` are intentionally conservative. Update them or your app `AGENTS.md` for trunk-based development, no-PR workflows, required PR workflows, nonstandard production branches, or release trains.
- Verification commands: `/sdd-apply`, `/sdd-review`, and `/sdd-release` should be aligned with your real test, lint, typecheck, security, build, migration, and manual acceptance gates.
- Changelog and release records: `/sdd-review` and `/sdd-release` assume a Keep a Changelog-style `CHANGELOG.md`. Adjust if you use generated release notes, changesets, GitHub releases only, or another release record.
- UI and design guidance: `/sdd-review` looks for project visual/style guidance when UI changes are involved. Point it at your design system docs, brand guide, component guidelines, or remove that gate if the project does not need one.
- Re-entry and audit heuristics: `/sdd-space-status` depends on naming conventions and recent workflow artifacts for orientation, while `/sdd-orphan-audit` depends on traceability evidence. Tune them after you see the first few reports against your codebase.

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

The workflow doctrine is in [docs/story-driven-development.md](docs/story-driven-development.md). Skills operationalize that doctrine. If a skill and the doctrine disagree, update one or both so the package stays internally consistent.

## Project Guidance Expected By The Skills

The skills work best when each application repo has:

- `AGENTS.md` with branch policy and project-specific guidance
- `README.md` with setup and verification commands
- `CHANGELOG.md` following Keep a Changelog
- `docs/epics/` for durable capability truth
- `docs/changes/` for active and closed changes
- private planning docs for PRD/Product Brief and visual/style guidance when product or UI decisions need durable context
- `docs/adrs/` or another project-local ADR location when durable architecture decisions need their own record

The skills prefer project-local guidance over package defaults.

## Status

This package is early. It was extracted from a working local workflow and lightly generalized for reuse. Expect the skill set and artifact conventions to keep tightening as real projects expose rough edges.
