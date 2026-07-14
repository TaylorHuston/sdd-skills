---
modified: 2026-07-11
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
| `/sdd-doctrine` | Supply the portable SDD semantic contract consumed by the other skills. |
| `/sdd-adr` | Create, update, or assess ADRs for durable SDD architecture decisions. |
| `/sdd-explore` | Think through ideas, compare approaches, investigate context, and offer ADR capture when durable architecture decisions emerge. |
| `/sdd-interactive` | Track and implement small concrete changes in one working session. |
| `/sdd-epic-verify` | Audit an Epic against current implementation and evidence. |
| `/sdd-pr` | Open or steward SDD-backed pull requests, process review comments/checks, and stop before merge for user approval. |
| `/sdd-space-status` | Produce a read-only re-entry brief when returning to an app after time away. |
| `/sdd-orphan-audit` | Find likely orphaned code, tests, and stale traceability evidence. |

## Artifact Model

The portable doctrine defines artifact roles, authority, and the required repository layout. Once an implementation repository is selected, the packaged skills expect this shape:

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
  adrs/
    yyyy-mm-dd-decision-title.md
  audits/
    yyyy-mm-dd-orphan-audit.md
```

Epics are the durable behavior-to-code map. Stories, Requirements, Scenarios, `Implemented By`, `Verified By`, and `Verification Gaps` live inside each Epic's `epic.md`. `Verified By` is a scenario-mapped evidence index, not a chronological command log; broad gates such as lint, typecheck, build, or full CI are supporting evidence unless tied to a named Requirement or Scenario. If implemented behavior is not represented in an Epic/Story, treat it as undocumented drift until the map is updated or the code is removed through a tracked change.

Change folders are working records. `proposal.md` defines scope, `design.md` defines the technical approach, and `tasks.md` is the adaptive implementation ledger and resume surface.

`/sdd-apply` has no fixed dependency on a catalog of companion skills. It discovers the skills exposed by the current runtime, selects the smallest set materially relevant to the active implementation slice, and enforces the selected guidance in both direct and delegated work. A consuming environment can have a different skill set, or no matching specialist skill at all; project guidance and normal engineering judgment remain the fallback.

For non-trivial changes, `design.md` should compare viable technical options before selecting an approach. When a change creates a durable architecture, data, dependency, integration, deployment, security, storage, or cross-cutting project decision, record it as an ADR under `docs/adrs/`.

Product Briefs/PRDs and app visual/style guidance are private planning artifacts. By default, an idea lives at `<workspace-root>/ideas/<idea>/`, stores its PRD at `<planning-root>/prd.md`, and maps zero or more implementation repositories under `<workspace-root>/code/` through its Folder Note metadata. Reference planning artifacts when product scope, UI identity, or release readiness depends on them; keep accepted implementation truth in each code repository's Epic and Story map.

Generated indexes are optional. If a project maintains `docs/epics/index.md` or `docs/epics/story-index.json`, treat them as generated navigation or validation artifacts, not canonical truth.

Canonical template examples are browsable in [docs/templates/](docs/templates/). These mirror the skill-local template assets used to create PRDs, Epics, changes, ADRs, review reports, audit reports, changelogs, and release PR notes.

## Current Development Shape

This package is currently developed in a meta-repo situation: the reusable `sdd-skills` package lives inside a larger private workspace that also contains planning docs, shared guidance, and multiple application repositories. That shape is useful for developing the workflow because the active skills can be tested against real projects before being generalized back into this package.

The package ships with the same general idea/repository relationship as its default. A generic version looks like this:

```text
workspace/
  ideas/
    product-one/
      product-one.md
      prd.md
      visual-identity.md
      exploration/
  code/
    product-one-web/
      AGENTS.md
      README.md
      CHANGELOG.md
      docs/
        epics/
        changes/
        adrs/
        audits/
    product-one-mobile/
      AGENTS.md
      README.md
      docs/
        epics/
        changes/
    sdd-skills/
      README.md
      docs/
        story-driven-development.md
      skills/
        sdd-*/
  shared/
    visual-style-guide.md
```

The idea Folder Note owns the relationship:

```yaml
repositories:
  - path: code/product-one-web
    role: web-client
  - path: code/product-one-mobile
    role: mobile-client
```

In that example, `ideas/product-one/` is the private planning root, the two mapped directories under `code/` are independent implementation repositories, and `code/sdd-skills/` is this package repository. Product and repository names do not need to match.

## Adapting The Skills To Your Shape

Start by defining project-local guidance. A good `AGENTS.md` should identify any exception to the default idea-owned repository mapping, branch and merge policy, required commands and release records, supporting docs, and project constraints. It should not relocate canonical SDD artifacts from an implementation repository's `docs/` tree.

Common adaptation points:

- Idea/repository mapping: the skills assume `ideas/<idea>/<idea>.md` owns a `repositories` list that may point to multiple `code/<repo>` repositories. Declare an exception in project guidance, or change the packaged default as described below.
- Planning docs: `/sdd-prd`, `/sdd-explore`, `/sdd-space-status`, `/sdd-propose`, `/sdd-apply`, `/sdd-review`, `/sdd-epic-verify`, and `/sdd-release` resolve private context from the owning idea when relevant.
- SDD artifact paths: `docs/epics/`, `docs/changes/`, `docs/changes/closed/`, `docs/adrs/`, and `docs/audits/` are package conventions, not `AGENTS.md` configuration points.
- Branch and merge policy: `/sdd-review`, `/sdd-pr`, and `/sdd-release` are intentionally conservative. Update them or your app `AGENTS.md` for trunk-based development, no-PR workflows, required PR workflows, nonstandard production branches, or release trains.
- Verification commands: `/sdd-apply`, `/sdd-review`, and `/sdd-release` should be aligned with your real test, lint, typecheck, security, build, migration, and manual acceptance gates.
- Available skills: `/sdd-apply` discovers relevant capabilities from the consuming runtime instead of requiring named companion skills. Keep that behavior capability-driven if you add local routing preferences, and avoid turning optional skills into package dependencies.
- Changelog and release records: define whether the project uses Keep a Changelog, generated release notes, changesets, provider releases, another record, or no changelog. The skills follow that policy instead of imposing one.
- UI and design guidance: `/sdd-review` looks for project visual/style guidance when UI changes are involved. Point it at your design system docs, brand guide, component guidelines, or remove that gate if the project does not need one.
- Re-entry and audit heuristics: `/sdd-space-status` depends on naming conventions and recent workflow artifacts for orientation, while `/sdd-orphan-audit` depends on traceability evidence. Tune them after you see the first few reports against your codebase.

### Changing The Idea/Repository Model

The one-idea-to-many-repositories model is an opinionated default, not an SDD truth invariant.

- The idea Folder Note is the canonical and only mapping source. Public code repositories should not contain reverse links to private idea paths.
- One idea may map to zero, one, or many repositories. Under the default model, one repository is claimed by at most one idea; shared tooling repositories may remain unlinked.
- Resolution is metadata-first, with a unique basename match only as a compatibility fallback. Ambiguous ownership or target-repository selection requires user input.
- If one repository eventually needs to support multiple ideas, evolve the metadata and resolver deliberately into a many-to-many model instead of adding ad hoc reverse links.
- For one project, declare an explicit exception in project guidance. For a package-wide change, edit `Default Idea-To-Repository Relationship` in `skills/sdd-doctrine/references/story-driven-development.md`, then keep `docs/story-driven-development.md` synchronized.
- Keep operational skills expressed in terms of `<planning-root>` and `<implementation-root>` so changing roots or relationship metadata does not require rewriting every workflow.

Audit relationship-resolution assumptions after customization:

```bash
rg -n 'ideas/<idea>|code/<repo>|repositories:|<planning-root>|<implementation-root>' skills/sdd-* docs README.md
```

### Changing The Repository-Internal SDD Layout

Using a different SDD artifact layout requires a coordinated package customization. Do not change only `AGENTS.md`; that can make skills read and write different sources of truth.

Update these locations together:

- `skills/sdd-doctrine/references/story-driven-development.md`: `Core Doctrine And Project Profile`, `Core Terms`, and `Change Workflow`; keep `docs/story-driven-development.md` synchronized.
- `skills/sdd-propose/SKILL.md`: `Output`, `Workflow`, and `Artifact Rules`.
- `skills/sdd-apply/SKILL.md`: `Canonical Repository Layout`, `Select The Change`, `Required Context`, and closeout path operations.
- `skills/sdd-review/SKILL.md`: `Select The Change And Branches`, `Required Context`, review-artifact output, and closeout path operations.
- `skills/sdd-epic-verify/SKILL.md`, `skills/sdd-adr/SKILL.md`, `skills/sdd-interactive/SKILL.md`, and `skills/sdd-orphan-audit/SKILL.md`: their `Location`, `Output`, and `Required Context` sections.
- `skills/sdd-explore/SKILL.md`, `skills/sdd-prd/SKILL.md`, `skills/sdd-pr/SKILL.md`, `skills/sdd-release/SKILL.md`, and `skills/sdd-space-status/SKILL.md`: context, capture, relationship, or landmark sections that locate SDD artifacts.
- `skills/sdd-*/assets/`, `docs/templates/`, and path-aware helper scripts.

Use this audit after customization:

```bash
rg -n 'docs/(epics|changes|adrs|audits)' skills/sdd-* docs/templates
```

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

The sync script copies every `skills/sdd-*` folder, including the `sdd-doctrine` support skill, into the target and removes stale files inside those target skill folders. It does not delete unrelated skills.

## Validation

Validate with Codex's `skill-creator` validator:

```bash
for d in skills/sdd-*; do
  python3 /path/to/skill-creator/scripts/quick_validate.py "$d"
done
```

If `PyYAML` is not installed globally, install it into a temporary directory and set `PYTHONPATH` for the validation command.

## Doctrine

The workflow doctrine ships in the [`sdd-doctrine` support skill](skills/sdd-doctrine/SKILL.md), with a browsable mirror in [docs/story-driven-development.md](docs/story-driven-development.md). Operational skills load that doctrine, then apply it through the consuming project's local profile. If a skill, the support-skill reference, and the docs mirror disagree, reconcile them before release.

## Project Guidance Expected By The Skills

The skills work best when each application repo has:

- `AGENTS.md` with branch policy and project-specific guidance
- `README.md` with setup and verification commands
- a configured changelog, release-note, changeset, or equivalent release-communication policy when releases need one
- `docs/epics/` for durable capability truth
- `docs/changes/` and `docs/changes/closed/` for active and closed changes
- an owning private `ideas/<idea>/` root with Folder Note repository mappings when PRD/Product Brief, exploration, or visual/style decisions need durable context
- `docs/adrs/` when durable architecture decisions need their own record

The skills prefer project-local guidance for operating policy, project constraints, and explicit relationship exceptions. The default idea/repository model and canonical SDD artifact layout remain package-owned defaults.

## Status

This package is early. It was extracted from a working local workflow and lightly generalized for reuse. Expect the skill set and artifact conventions to keep tightening as real projects expose rough edges.
