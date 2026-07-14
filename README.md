---
modified: 2026-07-14
---
# SDD Toolchain

CLI tooling and reusable Codex skills for Story-Driven Development: an LLM-friendly workflow for planning, implementing, reviewing, and releasing larger application changes without losing traceability between product behavior, code, and verification evidence.

This repository packages the current SDD workflow skills as portable OpenAI/Codex skill folders and includes a CLI that makes workspace topology, skill installation, status reporting, and planned-Change scaffolding deterministic. SDD remains file-based: normal YAML, JSON, Markdown, and Git repositories stay inspectable without a hosted service.

## What This Workflow Is For

SDD is designed for solo developers and small teams using LLM agents on non-trivial codebases.

The core idea is that SDD maintains an evidence-backed map from product behavior to implementation. Durable product behavior should live in Epics, Stories, Requirements, Scenarios, and evidence indexes that point back to the relevant implementation and tests. Agents can then resume work, review drift, debug broken behavior, and safely continue implementation without rediscovering the whole codebase every time.

## CLI

The `0.7.0` CLI requires Node.js 20 or newer. It manages the workspace-level `.sdd/` contract, installs packaged skills under `.agents/skills/`, resolves idea-to-repository ownership, reports current work, and moves planned Changes into implementation repositories without making product decisions on the user's behalf.

From a local checkout:

```bash
npm install
npm link

cd /path/to/workspace
sdd init
sdd doctor
sdd context
sdd status
sdd status billing
sdd change create billing invoice-retry --repo services/billing-api
sdd change promote billing 2026-07-14-invoice-retry --repo services/billing-api
```

On first initialization in an interactive terminal, `sdd init` asks where planning documents and implementation repositories live. Enter paths relative to the workspace root, meaning the directory that will contain `.sdd/`, not relative to the `.sdd/` directory itself. Detected paths are offered as defaults, and multiple repository roots may be entered as a comma-separated list.

For scripts or users who want to accept detected defaults without questions, use `sdd init --yes`. Explicit `--planning-root` and repeated `--repository-root` flags bypass their corresponding questions. Non-interactive input also uses detection automatically.

After initialization, use `sdd configure` when planning or repository directories move. It asks only about missing roots and offers likely replacements based on directory names and configured child projects. Use `sdd configure --yes` to accept every available suggestion, or provide `--planning-root <path>` and repeated `--repository-root <name=path>` overrides. The command changes only root paths; Space IDs, lifecycle statuses, repository roles, mappings, and artifact settings remain intact. Use `--dry-run` to inspect the proposed rewrite first.

Available commands:

| Command | Purpose |
|---|---|
| `sdd init [path]` | Ask for workspace paths, create `.sdd/config.yaml`, import detectable mappings, and safely install the workflow and skills. |
| `sdd configure [path]` | Detect and repair missing planning or named repository roots without rebuilding the workspace configuration. |
| `sdd update [path]` | Reconcile the managed workflow and installed skills with the current package version. |
| `sdd doctor [path]` | Check configuration, paths, relationship ownership, installation lock, workflow integrity, managed skill drift, and Change status frontmatter; suggest `sdd configure` when topology roots are missing. |
| `sdd context [path]` | Resolve a path to its workspace, Space ID, lifecycle status, planning path, repository, role, and related repositories. |
| `sdd status [space-id]` | List active ideas with their active repositories and current/recent Change state, or show one Space's detailed inventory. Use `--all` for every lifecycle entry. |
| `sdd change create <space-id> <slug>` | Scaffold a dated private Change draft under the Space's configured `planned-changes/` directory. |
| `sdd change promote <space-id> <change-id>` | Move a proposed private draft into one or more selected repositories as an active Change. |

Every operational command supports human-readable and `--json` output. `init`, `configure`, `update`, `change create`, and `change promote` also support `--dry-run`. Managed skills and `.sdd/story-driven-development.md` are checksum-protected: local modifications produce a conflict instead of being silently overwritten, and `--force` is required to replace them.

An initialized workspace looks like:

```text
workspace/
  .sdd/
    config.yaml
    install-lock.json
    story-driven-development.md
  .agents/
    skills/
      sdd-*/
```

Example topology:

```yaml
version: 2
schema: sdd-v2
skills:
  directory: .agents/skills
planning:
  root: product/ideas
  plannedChangesDirectory: planned-changes
repositories:
  roots:
    apps: apps
    services: services
repositoryArtifacts:
  activeChanges: docs/changes
  closedChanges: docs/changes/closed
  epics: docs/epics
  adrs: docs/adrs
  audits: docs/audits
ideas:
  billing:
    status: active
    repositories:
      - root: services
        path: billing-api
        role: api
        status: active
      - root: apps
        path: customer-portal
        role: web-client
        status: inactive
```

Top-level roots are relative to the initialized workspace. Each key under `ideas` is its stable, case-sensitive Space ID and is the identifier accepted by commands such as `sdd status billing`. Treat it as an opaque identifier rather than a display title. A Space's planning directory defaults to `<planning.root>/<space-id>`; set `planning` only when its directory differs from the Space ID. Repository paths are relative to their named root. This keeps root changes centralized instead of repeating full paths for every Space. Keep `repositoryArtifacts` at the packaged defaults unless you are making the coordinated package customization described under [Changing The Repository-Internal SDD Layout](#changing-the-repository-internal-sdd-layout).

Idea and repository `status` use one shared vocabulary: `active`, `inactive`, or `archived`. `active` means current development; `inactive` retains paused or potential work; `archived` identifies historical/read-only material. Idea and repository statuses are independent, so an active clean-rebuild idea can retain an archived MVP repository. Older v2 configurations without explicit lifecycle status remain compatible and default to `active`; new initialization writes the fields explicitly.

`sdd status` reads only configured Space relationships. It does not infer that similarly named planning and code directories belong together. Map each implementation repository under the owning Space when it should contribute Epics or Changes to that Space's status. The default workspace summary groups every `active` idea and then every `active` repository mapped beneath it, even when the idea has no repository yet or a repository has no unclosed Change. Each repository also reports its current Git branch and whether the worktree is clean; dirty worktrees include staged, unstaged, untracked, and conflicted counts. Change state is displayed within the repository; it does not control lifecycle visibility. `sdd status --all` uses the same grouped view for every active, inactive, and archived idea and repository. A detailed `sdd status <space-id>` intentionally shows every repository mapped to that Space and groups its active Changes, Epics, and recent Changes. JSON exposes lifecycle `status`, repository `git` metadata, aggregate fields, `repositoryActivity`, and `repositoryDetails`.

### Planned Change Lifecycle

1. `sdd change create <space-id> <slug>` scaffolds `proposal.md`, `design.md`, and `tasks.md` under `<planning-path>/<plannedChangesDirectory>/yyyy-mm-dd-<slug>/` with `status: proposed`.
2. `/sdd-propose` refines the private draft through product and technical planning. The draft is not active implementation truth and does not appear in `sdd status`.
3. `sdd change promote <space-id> <change-id>` moves the settled draft into each selected active repository's configured active-Change directory.
4. `/sdd-propose` confirms repository-specific scope after promotion, then `/sdd-apply` may begin implementation.

Both commands infer a sole active mapped repository. When several active repositories are available, use one or more `--repo` options. `change create` may also create a planning-only draft when no active implementation repository exists. `change promote` requires at least one active repository, validates the three required artifacts and `status: proposed`, rejects every destination collision before writing, rewrites private planning paths, preserves `status: proposed`, and removes the private draft only after all selected destinations succeed. Both commands support `--dry-run` and `--json`; `change create` also supports `--date`.

Project-specific exceptions remain explicit:

```yaml
ideas:
  renamed-product:
    status: active
    planning: legacy-product-name
    repositories:
      - root: apps
        path: renamed-product
  external-layout:
    planningPath: private/special-plans/external-layout
    repositories:
      - path: integrations/external-layout
        role: integration
        status: active
```

`planningPath` and repository entries without `root` are workspace-relative overrides. `planning` is relative to `planning.root`. One idea may map to zero, one, or many repositories; duplicate resolved repository ownership is a validation error. Parent traversal and absolute paths remain prohibited.

`sdd init` automatically migrates the original v1 repeated-path shape to this derived-path v2 shape.

If a root directory is renamed after initialization, `sdd doctor` reports the missing parent root without repeating a warning for every derived Space or repository path. Run `sdd configure` to review detected replacements, or use explicit flags when the new path cannot be inferred safely.

The skills resolve workspace topology through `sdd context` and read the managed `.sdd/story-driven-development.md` contract when SDD semantics matter. Folder Note mappings remain an initialization import source; `.sdd/config.yaml` is authoritative after initialization.

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
| `/sdd-explore` | Maintain a durable private exploration while discussing substantial product, business, design, technical, architecture, workflow, or requirement questions about a space. |
| `/sdd-interactive` | Track and implement small concrete changes in one working session. |
| `/sdd-epic-verify` | Audit an Epic against current implementation and evidence. |
| `/sdd-pr` | Open or steward SDD-backed pull requests, process review comments/checks, and stop before merge for user approval. |
| `/sdd-space-status` | Produce a read-only re-entry brief when returning to an app after time away. |
| `/sdd-orphan-audit` | Find likely orphaned code, tests, and stale traceability evidence. |

## Artifact Model

The managed workflow defines artifact roles, authority, and the required repository layout. Once an implementation repository is selected, the packaged skills expect this shape:

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

Active Change folders are working records. `proposal.md` defines scope, `design.md` defines the technical approach, and `tasks.md` is the adaptive implementation ledger and resume surface. Every `tasks.md` has a machine-readable YAML `status`: `proposed`, `in_progress`, `review`, `replanning`, or `ready_to_close`. There is no `closed` status value; moving the folder under `docs/changes/closed/` is the closed state, and the file retains its last active status. Private planned Change drafts may use the same three-file shape before repository and branch work begins, but they are planning inputs rather than canonical active Change truth.

`/sdd-apply` has no fixed dependency on a catalog of companion skills. It discovers the skills exposed by the current runtime, selects the smallest set materially relevant to the active implementation slice, and enforces the selected guidance in both direct and delegated work. A consuming environment can have a different skill set, or no matching specialist skill at all; project guidance and normal engineering judgment remain the fallback.

For non-trivial changes, `design.md` should compare viable technical options before selecting an approach. When a change creates a durable architecture, data, dependency, integration, deployment, security, storage, or cross-cutting project decision, record it as an ADR under `docs/adrs/`.

Product Briefs/PRDs and app visual/style guidance are private planning artifacts. By default, an idea lives at `<planning-root>/<idea>/`, stores its PRD at `<planning-root>/<idea>/prd.md`, and maps zero or more implementation repositories through `.sdd/config.yaml`. Reference planning artifacts when product scope, UI identity, or release readiness depends on them; keep accepted implementation truth in each code repository's Epic and Story map.

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

After `sdd init`, `.sdd/config.yaml` owns the relationship:

```yaml
planning:
  root: ideas
repositories:
  roots:
    code: code
ideas:
  product-one:
    status: active
    repositories:
      - root: code
        path: product-one-web
        role: web-client
        status: active
      - root: code
        path: product-one-mobile
        role: mobile-client
        status: inactive
```

In that example, `ideas/product-one/` is the private planning path, the two mapped directories under `code/` are independent implementation repositories, and `code/sdd-skills/` is this package repository. Product and repository names do not need to match. Idea Folder Note metadata can seed this mapping during initialization, but it is not authoritative afterward.

## Adapting The Skills To Your Shape

Start by defining project-local guidance. A good `AGENTS.md` should identify any exception to the default idea-owned repository mapping, branch and merge policy, required commands and release records, supporting docs, and project constraints. It should not relocate canonical SDD artifacts from an implementation repository's `docs/` tree.

Common adaptation points:

- Idea/repository mapping: the skills resolve the one-idea-to-many-repositories mapping from `.sdd/config.yaml` through `sdd context`. Declare an exception in project guidance, or change the packaged default as described below.
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

- `.sdd/config.yaml` is the canonical mapping source after initialization. Idea Folder Notes may supply mappings during `sdd init`; public code repositories should not contain reverse links to private idea paths.
- One idea may map to zero, one, or many repositories. Under the default model, one repository is claimed by at most one idea; shared tooling repositories may remain unlinked.
- Resolution is config-first through `sdd context`. Ambiguous target-repository selection requires user input.
- If one repository eventually needs to support multiple ideas, evolve the metadata and resolver deliberately into a many-to-many model instead of adding ad hoc reverse links.
- For one project, declare an explicit exception in `.sdd/config.yaml` or project guidance. For a package-wide change, edit `Default Idea-To-Repository Relationship` in `docs/story-driven-development.md` and update affected CLI resolution behavior.
- Keep operational skills expressed in terms of `<planning-root>` and `<implementation-root>` so changing roots or relationship metadata does not require rewriting every workflow.

Audit relationship-resolution assumptions after customization:

```bash
rg -n 'ideas/<idea>|code/<repo>|repositories:|<planning-root>|<implementation-root>' skills/sdd-* docs README.md
```

### Changing The Repository-Internal SDD Layout

Using a different SDD artifact layout requires a coordinated package customization. Do not change only `AGENTS.md`; that can make skills read and write different sources of truth.

Update these locations together:

- `docs/story-driven-development.md`: `Core Doctrine And Project Profile`, `Core Terms`, and `Change Workflow`.
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

## Legacy Skills Sync

Current skills require an initialized CLI workspace and its managed workflow document. The legacy sync script remains only for maintaining pre-CLI `0.6.x` installations; it is not a complete current installation method.

For a project-local install:

```bash
./scripts/sync-skills.sh /path/to/project/.agents/skills
```

For a user-level install:

```bash
./scripts/sync-skills.sh "${CODEX_HOME:-$HOME/.codex}/skills"
```

The sync script copies current `skills/sdd-*` folders into the target and removes stale files inside those target skill folders. It does not install `.sdd/story-driven-development.md`, manage retired skills, or delete unrelated skills.

## Validation

Run the CLI package checks:

```bash
npm run check
```

When skill files change, also validate them with Codex's `skill-creator` validator:

```bash
for d in skills/sdd-*; do
  python3 /path/to/skill-creator/scripts/quick_validate.py "$d"
done
```

If `PyYAML` is not installed globally, install it into a temporary directory and set `PYTHONPATH` for the validation command.

## Managed Workflow

[docs/story-driven-development.md](docs/story-driven-development.md) is the canonical package workflow. `sdd init` installs it at `.sdd/story-driven-development.md`; `sdd update` refreshes it safely; and `sdd doctor` verifies its checksum. Operational skills resolve the workspace with `sdd context`, load that managed document when SDD semantics matter, and combine it with the consuming project's local guidance.

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

This package is under active pre-1.0 development. It is exercised against multiple working application repositories, but the CLI and artifact conventions may still change between minor releases.
