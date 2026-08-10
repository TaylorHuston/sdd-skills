---
modified: 2026-07-22
---
# SDD Toolchain

CLI tooling and reusable Codex skills for Story-Driven Development: an LLM-friendly workflow for planning, implementing, reviewing, and releasing larger application changes without losing traceability between product behavior, code, and verification evidence.

This repository packages the current SDD workflow skills as portable OpenAI/Codex skill folders and includes a CLI that makes workspace topology, skill installation, repository contracts, status reporting, artifact validation, and Change-folder transitions deterministic. SDD remains file-based: normal YAML, JSON, Markdown, and Git repositories stay inspectable without a hosted service.

The framework-free [Story-Driven Development one-page guide](https://taylorhuston.me/sdd-skills/) separates the portable methodology from this repository's local-first reference implementation. It is published with GitHub Pages from the source in [`site/`](site/).

## What This Workflow Is For

SDD is designed for solo developers and small teams using LLM agents on non-trivial codebases.

The core idea is that SDD maintains an evidence-backed map from product behavior to implementation. Durable product behavior should live in Epics, Stories, Requirements, Scenarios, and evidence indexes that point back to the relevant implementation and tests. Agents can then resume work, review drift, debug broken behavior, and safely continue implementation without rediscovering the whole codebase every time.

## Installation

The CLI requires Node.js 20 or newer. Current pre-1.0 releases are installed from a GitHub checkout:

```bash
git clone https://github.com/TaylorHuston/sdd-skills.git
cd sdd-skills
npm install
npm link
```

The CLI installs packaged skills for one explicit workspace, stores that workspace's private directory and idea-to-repository map under `<workspace>/.sdd/`, and creates a small portable `.sdd/config.yaml` inside each participating repository. It reports current work, validates artifact structure, and performs deterministic Change-folder transitions without making product decisions on the user's behalf.

## Requirements And Optional Companions

Required for the documented installation and full workflow:

- **Node.js 20 or newer** and npm for the CLI package.
- **Git** for the checkout-based installation and repository-aware status, review, and release workflows.
- **An agent runtime that discovers OpenAI/Codex-style skills** to invoke the packaged skills. The CLI installs to `<workspace>/.agents/skills/` by default; use `sdd setup --skills-dir` when a runtime requires another workspace-contained location. The deterministic CLI can still be used independently.

The following integrations are optional. They are discovered from the consuming agent runtime or configured in individual application repositories; `npm install` does not install them.

| Companion capability | What it adds |
|---|---|
| Storybook or another component-preview system | Controlled UI states and comparable component surfaces for `/sdd-design`, implementation, manual confirmation, and review. SDD does not require Storybook or edit it from the design workflow. |
| Browser and screenshot automation | Rendered-state inspection, repeatable viewport comparisons, interaction checks, measurements, and visual evidence. Playwright and agent browser tools are common choices, not package dependencies. |
| Stitch, Penpot, Figma, or another design/prototyping tool | Divergent concepts, reusable visual references, and stable prototype identifiers. External accounts, connectors, or MCP configuration may be required by the selected tool. |
| Context7 or another current-documentation provider | Current library, framework, SDK, API, CLI, and cloud-platform documentation during exploration, planning, implementation, and debugging. Packaged workflows prefer this capability when version-sensitive external behavior matters, but SDD remains usable without it. |
| Security, accessibility, architecture, and framework specialist skills | Additional risk-specific guidance and review depth. `/sdd-apply` and related workflows select available capabilities by relevance instead of requiring named companion skills. |

Optional tools provide evidence and specialist guidance; they do not replace Epic/Story truth, Change artifacts, project-local instructions, or user confirmation. UI-bearing implementation and review require direct rendered-state inspection, but no named browser, screenshot, or preview product is required: use the project's existing tooling first, then an available runtime browser capability, rendered preview or fixture, or manual browser capture. If no available path can render a required surface, record the verification as blocked or explicitly accepted rather than treating source inspection, a green build, or generated-but-uninspected screenshots as visual proof.

## Quick Start

Set up SDD for one explicit workspace, then initialize each participating repository:

```bash
sdd setup /path/to/workspace

cd /path/to/workspace
sdd doctor

cd /path/to/workspace/spaces/repository
sdd init
sdd context
```

`sdd setup [workspace-path]` creates `<workspace>/.sdd/config.yaml`, the central Change store at `<workspace>/.sdd/changes/`, the managed workflow at `<workspace>/.sdd/story-driven-development.md`, and managed skills under `<workspace>/.agents/skills/` by default. Omitting the path selects the current directory; setup never infers the user's home. Repository roots may remain empty until repositories are ready to register. `sdd init` writes only the current repository's portable `.sdd/config.yaml`; repository contracts retain identity plus Epic, ADR, and audit paths and never contain a workspace pointer. Configure the workspace file with private planning roots, repository roots, Space mappings, lifecycle statuses, and roles that should participate in cross-repository commands such as `sdd status`. A repository remains usable for repository-local context and validation even when it is not registered in that private map.

Change commands represent separate workflow stages over one canonical workspace-level record, not copies that move between planning and repositories. This example derives the Change ID used by later commands so it does not depend on a copied date:

```bash
CHANGE_DATE="$(date +%F)"
CHANGE_ID="${CHANGE_DATE}-invoice-retry"

sdd change create billing invoice-retry --repo services/billing-api --date "$CHANGE_DATE"
```

`sdd change create` writes `<workspace>/.sdd/changes/$CHANGE_ID/` immediately and records the owning Space plus target repository IDs in `tasks.md`. Run `/sdd-change --plan` to refine that scaffold and set `status: planned` only when the Change is coherent and implementation-ready. Then validate the same canonical record:

```bash
sdd validate billing --change "$CHANGE_ID"
```

Invoking `/sdd-apply` against an explicitly selected canonical Change with `status: planned` begins implementation in place without moving or copying it. A Change with any other status stops with guidance to finish `/sdd-change --plan` or `--replan`; Apply never silently plans it. `/sdd-review` then runs the independent gate. Only after the Change is `in_review`, has a passing review record, and satisfies project-specific acceptance and merge requirements should it be closed:

`/sdd-review` reports technical readiness separately from manual acceptance. A `ready` verdict with manual confirmation `pending user` is not authorization to merge or close; `/sdd-pr` and `/sdd-release` carry that status forward and enforce the consuming project's policy for each requested action.

```bash
sdd change close billing "$CHANGE_ID"
```

When comparison, review, or manual feedback may require an experience revision, start with `/sdd-design --revise`. It classifies the feedback and confirms that accepted behavior remains unchanged. If artifact edits are required, the owning workflow then uses the guarded compare-and-set command immediately before recording the revision contract and returning the one central Change to implementation:

```bash
sdd change transition billing "$CHANGE_ID" \
  --from in_review \
  --to in_progress
```

Workspace topology and the canonical Change store created by `sdd setup` belong under `<workspace>/.sdd/`; managed skills belong under `<workspace>/.agents/skills/`; repository behavior created by `sdd init` belongs in each repository's `.sdd/config.yaml`. Workspace-contained paths are stored relative to the workspace root when possible. Explicit external repository roots may be absolute. The managed skills directory must remain lexically and physically inside the workspace, including after existing symlink ancestors are resolved. Use `sdd init --repo-id` when the directory name is not the desired stable repository ID.

For non-interactive workspace setup, use `sdd setup <workspace-path> --yes`. Explicit `--planning-root`, repeated `--repository-root`, and `--skills-dir` flags apply only to setup. Later setup and init invocations are idempotent, and managed skills are checksum-protected.

Operational commands select one workspace in this order:

1. an explicit `--workspace <path>`;
2. `SDD_WORKSPACE_ROOT`;
3. the nearest ancestor workspace of the command's target path;
4. the nearest ancestor workspace of the current directory when the target is an explicitly mapped external repository.

There is no home-directory fallback. If an external repository cannot discover its owning workspace from the target, run the command from inside the workspace or select it explicitly:

```bash
sdd context /path/to/external-repository --workspace /path/to/workspace
sdd validate billing --repo external-api --workspace /path/to/workspace
```

### Migrating A Home-Scoped Installation

A home-root installation using workspace schema v1-v3, or either released transitional `kind: user` schema (version 1 or version 2), is migration input only. Preview the complete home-to-workspace transaction, then apply the same explicit migration:

```bash
sdd setup /path/to/workspace \
  --from-user /path/to/old-user-root \
  --dry-run --json

sdd setup /path/to/workspace \
  --from-user /path/to/old-user-root
```

The source argument names the old home-root installation owner. The CLI reads `<old-user-root>/.sdd/config.yaml` and accepts supported workspace v1-v3 or user-v1/v2 shapes only as migration input. Before writing, setup checks source and destination identity, topology resolution, workspace-local Change-ID uniqueness, path and symlink confinement, managed-skill checksums, and every destination collision. Dry-run reports the full action list without mutation.

The normal migration stages a canonical workspace configuration, copies active and closed Changes plus recovery material, installs the workspace workflow and managed skills, publishes destination state transactionally, and verifies it before source retirement. Workspace-contained paths become relative to the destination; explicitly external roots remain absolute. Only checksum-owned old `sdd-*` skill directories and migrated old `.sdd` entries may be retired. Unrelated skills and unrelated files under the old `.agents` directory remain untouched. Automatic post-crash recovery and resumed cleanup require a complete durable journal plus source-derived transaction provenance whose exact bytes and stage identity are bound by an independent workspace-root authority record. A committed migration left with partial cleanup but incomplete or unauthenticated provenance fails closed, retains the remaining state for manual inspection, and never infers recursive ownership. With complete authenticated provenance, rerunning the same migration is idempotent.

After setup, use `sdd configure` when workspace planning or repository roots move. It changes only private mapper paths; Space IDs, lifecycle statuses, repository roles, mappings, and repository-owned Epic, ADR, and audit settings remain intact. Use `--dry-run` to inspect the proposed rewrite first. Use `sdd update [path]` to discover and reconcile the selected workspace's managed workflow, skills, and supported legacy artifact formats; it does not import an implicit home installation.

Checksum protection stops setup or update when a managed skill has local modifications. Reconcile those changes first, or use `--force` only when intentionally replacing them with packaged versions. Epic records stay repository-owned and are not moved by installation migration.

Available commands:

| Command | Purpose |
|---|---|
| `sdd setup [workspace-path]` | Create or reconcile `<workspace>/.sdd` and `<workspace>/.agents/skills`, or explicitly migrate supported home-root state with `--from-user`. |
| `sdd init [path]` | Create or reconcile one repository's portable `.sdd/config.yaml`; requires a resolved workspace installation. |
| `sdd configure [path]` | Detect and repair missing workspace planning or named repository roots without rebuilding mappings. |
| `sdd update [path]` | Discover one workspace, reconcile its workflow and managed skills, and safely upgrade supported workspace-local legacy artifacts. |
| `sdd doctor [path]` | Check workspace and repository configuration, paths, relationship ownership, installation lock, managed skill drift, active-repository guidance drift, and central Change ownership/status metadata. |
| `sdd context [path]` | Resolve a path to its workspace topology, central Change-store roots, Space ID, repository contract, lifecycle status, planning path, role, related repositories, and managed doctrine path. |
| `sdd status [space-id]` | List active Spaces and mapped repositories with current/recent canonical Change state, or show one Space's detailed inventory. Use `--all` for every lifecycle entry. |
| `sdd validate [space-id]` | Check canonical workspace Changes once, plus repository-owned Epics and versioned Epic verification reports, for deterministic structure, ownership, traceability, placeholders, and broken artifact links. |
| `sdd epic create <space-id> <epic-id> <slug>` | Atomically scaffold and structurally validate a canonical Epic in one selected active repository. |
| `sdd change create <space-id> <slug>` | Scaffold a workspace-unique canonical Change under `<workspace>/.sdd/changes/<change-id>/`; repeat `--repo` to record target repository IDs. |
| `sdd change transition <space-id> <change-id>` | Compare-and-set one allowed status transition on the canonical Change. |
| `sdd change close <space-id> <change-id>` | Move one `in_review` canonical Change to `<workspace>/.sdd/changes/closed/<change-id>/` after skill-owned closeout gates pass. |

Every operational command supports human-readable and `--json` output. `setup`, `init`, `configure`, `update`, `change create`, `change transition`, and `change close` also support `--dry-run`. Commands with a separate target accept `--workspace` to select the owning workspace explicitly. `validate` exits with status 1 when deterministic errors exist while still emitting the complete human or JSON report. Managed workspace skills are checksum-protected: local modifications produce a conflict instead of being silently overwritten, and `sdd setup --force` or `sdd update --force` is required to replace them. Operational skills read the workspace-managed doctrine path returned by `sdd context`.

An initialized workspace and repository look like:

```text
<workspace>/
  .sdd/
    config.yaml
    install-lock.json
    story-driven-development.md
    changes/
      yyyy-mm-dd-change-name/
        proposal.md
        design.md
        tasks.md
      closed/
        yyyy-mm-dd-change-name/
  .agents/
    skills/
      sdd-*/
  spaces/
    repository/
      .sdd/
        config.yaml
```

Example workspace topology:

```yaml
version: 3
schema: sdd-v3
skills:
  directory: .agents/skills
planning:
  root: product/ideas
repositories:
  roots:
    apps: spaces/apps
    services: spaces/services
repositoryArtifacts:
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

Each repository carries a public-safe contract:

```yaml
kind: repository
version: 2
schema: sdd-repository-v2
id: billing-api
artifacts:
  epics: docs/epics
  adrs: docs/adrs
  audits: docs/audits
```

Workspace-contained roots resolve from the workspace and are stored relative to it when possible; explicitly configured external roots may remain absolute. Each key under `ideas` is its stable, case-sensitive Space ID and is the identifier accepted by commands such as `sdd status billing`. A Space's planning directory defaults to `<planning.root>/<space-id>`; repository paths remain relative to their named workspace root. The committed repository contract owns its stable repository ID and its Epic, ADR, and audit paths. The workspace mapper owns private planning relationships, roles, and lifecycle status. Canonical Change locations are fixed under `<workspace>/.sdd/changes/`; each Change's `tasks.md` frontmatter supplies its owning `space` and target `repositories`.

Space and repository `status` use one shared vocabulary: `active`, `inactive`, or `archived`. `active` means current development; `inactive` retains paused or potential work; `archived` identifies historical/read-only material. Space and repository statuses are independent, so an active clean-rebuild Space can retain an archived MVP repository. Older supported configurations without explicit lifecycle status remain compatible and default to `active`; new initialization writes the fields explicitly.

`sdd status` reads configured Space relationships and enumerates the central Change store once. It does not infer that similarly named planning and code directories belong together. Map each implementation repository under its owning Space so central Change repository IDs and repository-owned Epics resolve deterministically. If a Change target later becomes absent or belongs to another Space, status keeps the Space-owned Change visible and reports the unresolved repository ID while validation rejects the stale ownership. The workspace summary groups every `active` Space with its mapped active repositories and projects each canonical Change's target activity without creating repository copies. Repository entries also report their current Git branch and whether the worktree is clean; dirty worktrees include staged, unstaged, untracked, and conflicted counts. `sdd status --all` includes inactive and archived Spaces and repositories, while `sdd status <space-id>` narrows the canonical active and recent closed Change inventory by `tasks.md` ownership metadata.

### Change Lifecycle

1. `/sdd-change --brief` captures an undated private outcome at `<planning-path>/change-briefs/<slug>.md`. A Change Brief is not a Change: it has no technical plan, Change status, or central ownership metadata and does not appear in `sdd status`.
2. `/sdd-change --plan` confirms that outcome against current project context, invokes `sdd change create <space-id> <slug>` with `status: proposed`, and refines the canonical `<workspace>/.sdd/changes/yyyy-mm-dd-<slug>/` record. `proposal.md`, `design.md`, and `tasks.md` describe the required end state, constraints, known risks, and confirmation obligations; `tasks.md` also records `space` and `repositories`. The dated Change ID is assigned when planning begins and is unique across active and closed history in that workspace. Status becomes `planned` only when the plan is coherent and implementation-ready.
3. When a UI-bearing Change still has material experience uncertainty, optional `/sdd-design --plan` converges the flow, responsive composition, state behavior, accessibility, visual direction, and rendered-state verification matrix in that same Change.
4. After scoped validation passes with `status: planned`, the planned Change supersedes the brief. `/sdd-apply` confirms readiness for every repository named in `tasks.md` and begins implementation without moving or copying the Change. It continually updates the living risk, decision fan-out, verification-environment, and handoff records as implementation evidence changes the path. Planning-level product or scope gaps route to `/sdd-change --replan` rather than being silently resolved during Apply.
5. After implementation sets `in_progress`, comparison, review, or manual feedback may route experience-only revision through `/sdd-design --revise`. After classifying and confirming a design-only revision, that workflow uses `sdd change transition <space-id> <change-id> --from in_review --to in_progress` once on the canonical record; changed behavior instead routes through `/sdd-change --replan` and `proposed`.
6. When review begins again at `in_review`, a passing review record plus acceptance and project-specific PR/merge gates allow `sdd change close <space-id> <change-id>` to move the one folder to `<workspace>/.sdd/changes/closed/<change-id>/`.

`change create` can infer a sole active mapped repository or accept repeated `--repo` options; it may create a central planning-only Change when no implementation repository is selected. It resolves stable repository IDs into `tasks.md` and rejects a workspace-local Change-ID collision in either active or closed storage before writing. `change transition` and `change close` take no repository selector: each validates the command's Space against `tasks.md`, preflights the one canonical record, and mutates it once. Close preserves the file's `in_review` status because `closed` is represented by the central path.

### Artifact Validation

`sdd validate` enumerates the canonical workspace Change store once, then scans configured repositories for Epics and versioned Epic verification reports. Pass a Space ID to narrow central Changes by their `tasks.md` ownership, repeat `--repo` to select mapped repository surfaces, or use exactly one of `--change <change-id>` and `--epic <epic-id>` for a focused gate. Add `--changed-from <commit-ish>` when validation should compare current Epic content with a known Git baseline and reject stale top-level `modified` metadata across dates; a second substantive edit on the same local date remains valid because the metadata has day-level precision. Change-scoped validation also validates Epic paths declared in the Change proposal's `Epic Actions`; a declared path must resolve in exactly one selected repository.

The command checks only facts derivable from the files: required Change files and core sections; `status`, `space`, and `repositories` frontmatter; central active/closed location consistency; workspace-local Change-ID uniqueness; target repository identity; unresolved scaffolding tokens; Epic schema/frontmatter and section shape; non-empty Story/Requirement/Scenario structure; Story Index alignment; Story/Requirement/Scenario identifier shape and uniqueness; independent Story implementation and verification state; one canonical behavior-mapped `Implemented By` and scenario-mapped `Verified By` pair per Story; explicit implementation and verification gap coverage; physically contained repository-relative implementation and automated-evidence paths; exact searchable `#anchor` values; path/anchor ownership at the Requirement or Scenario level; oversized-Story review signals; current Epic verification report truth; and optional Git-relative metadata freshness.

Validation is not review. A passing result does not prove that requirements are complete, code implements the Epic, evidence is strong, product intent is correct, or manual acceptance has passed. The SDD skills use scoped validation as a deterministic baseline and remain responsible for those contextual judgments.

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

`planningPath` and repository entries without `root` are workspace-relative overrides. `planning` is relative to `planning.root`. One idea may map to zero, one, or many repositories; duplicate resolved repository ownership is a validation error. Parent traversal is prohibited. Absolute repository roots are allowed only as explicit external mappings; managed skills must remain physically inside the workspace.

Workspace v1-v3 configurations under an old home root and released `kind: user` version 1 or version 2 configurations are explicit `sdd setup <workspace> --from-user <old-user-root>` migration input only, never current workspace contracts at that location. Legacy idea-planned or repository-local Change copies supported by the selected workspace are reconciled through `sdd update`; rerun its dry-run after repairing any missing portable repository identity. After a successful migration, no legacy location remains a live alternate store.

If a root directory is renamed after initialization, `sdd doctor` reports the missing parent root without repeating a warning for every derived Space or repository path. Run `sdd configure` to review detected replacements, or use explicit flags when the new path cannot be inferred safely.

The skills resolve workspace topology and repository identity through `sdd context`, then read the managed doctrine at the returned `workflowPath` when SDD semantics matter. `<workspace>/.sdd/config.yaml` owns private relationships, `<workspace>/.sdd/changes/` owns every dated Change in that workspace, and each repository's `.sdd/config.yaml` owns portable identity plus Epic, ADR, and audit paths.

## Packaged Skills

Primary workflow:

| Skill | Purpose |
|---|---|
| `/sdd-prd` | Create or revise product direction before implementation work depends on it. |
| `/sdd-change` | Capture durable intent with `--brief`, create a just-in-time end-state and confirmation contract with `--plan`, or revise an active Change with `--replan`. |
| `/sdd-apply` | Implement or continue a Change using adaptive Requirement/Scenario slices, living risk closure, decision fan-out, real verification environments, and committed phase boundaries. |
| `/sdd-review` | Run a systematic multi-pass local PR-style gate across intent, every changed path, propagated contracts, configured analyzers, risk-shaped reasoning, and integration-candidate proof. |
| `/sdd-release` | Prepare a production release handoff with checks, exact changed-file reconciliation, changelog review, version confirmation, release metadata, one normal source push, and the configured release PR; merge/deploy/tag/publish remain separately authorized. |

Support workflow:

| Skill | Purpose |
|---|---|
| `/sdd-adr` | Create, update, or assess ADRs for durable SDD architecture decisions. |
| `/sdd-explore` | Maintain a durable private exploration while discussing substantial product, business, design, technical, architecture, workflow, or requirement questions about a space. |
| `/sdd-design` | Use `--plan` for initial experience convergence or `--revise` for post-implementation revision within accepted behavior, without editing application or component-preview source. |
| `/sdd-interactive` | Track and implement small concrete changes in one working session. |
| `/sdd-epic-verify` | Audit an Epic against current implementation and evidence, preserving versioned current-state reports and explicit remediation lineage. |
| `/sdd-pr` | Open or steward SDD-backed pull requests, safely remediate narrow findings, reconcile the exact diff scope, and stop before merge for user approval. |
| `/sdd-space-status` | Produce a read-only re-entry brief; when targeting a Space, include recent local commits and deeper context for in-progress work. |
| `/sdd-code-audit` | Audit an entire repository or selected area with independent code quality, testing, security, performance, and relevant specialist reviewers. |
| `/sdd-orphan-audit` | Find likely orphaned code, tests, and stale traceability evidence. |

## Artifact Model

The managed workflow defines artifact roles and authority across one workspace-scoped Change store and the selected implementation repositories:

```text
<workspace>/.sdd/
  changes/
    yyyy-mm-dd-change-name/
      proposal.md
      design.md
      tasks.md
      review.md        # only when review finds deficiencies
    closed/
      yyyy-mm-dd-change-name/

repository/
  docs/
    epics/
      <key>-<###>-epic-name/
        epic.md
    adrs/
      yyyy-mm-dd-decision-title.md
    audits/
      yyyy-mm-dd-orphan-audit.md
      yyyy-mm-dd-code-audit.md
```

Epics are the durable behavior-to-code map. Stories, Requirements, Scenarios, behavior-mapped `Implemented By`, `Implementation Gaps`, scenario-mapped `Verified By`, and `Verification Gaps` live inside each Epic's `epic.md`. Story implementation state (`not implemented`, `partial`, or `implemented`) remains separate from verification state (`unverified`, `partial`, or `verified`). Each Story has one authoritative current implementation map and one authoritative current verification map. `Implemented By` identifies Requirement ownership through concrete repository-relative `path#anchor` locations; `primary` means governing behavior regardless of physical layer, with narrower multiple primaries allowed for genuinely split ownership. Anchors should identify behavior-owning definitions or registrations rather than imports, call sites, incidental handlers, or files cited for another symbol. Automated `Verified By` evidence uses a repository-relative `test/path#exact test title or stable named anchor` so the validator and a future developer can open the proof directly. `Verified By` is an evidence index, not a chronological command log. Broad gates such as lint, typecheck, build, or full CI are supporting evidence unless tied to a named Requirement or Scenario. If implemented behavior is not represented in an Epic/Story, treat it as undocumented drift until the map is updated or the code is removed through a tracked change.

Reverse traceability is tiered by workflow. `/sdd-apply` checks the changed surface before handoff, `/sdd-review` independently checks the source-vs-target diff, `/sdd-epic-verify` requires a full Epic-scoped inventory before it can report `aligned`, and `/sdd-orphan-audit` remains the repository-wide maintenance pass. The packaged audit script expands evidence globs, reads the current working tree rather than only the Git index, and separates likely behavior candidates from test harness, framework/configuration, and generated files. Its output is conservative candidate data for agent classification, never automatic deletion approval.

Review and handoff truth is equally explicit. `/sdd-review` generates candidates through separate intent, complete-diff, dependency/contract, deterministic-tool, risk, and blind-spot passes before validating findings. Versioned Epic verification reports keep historical failures separate from the current result and link later remediation through `supersedes`. `/sdd-pr` and `/sdd-release` classify the complete source-to-target changed-file inventory and recheck it after remediation or release-metadata commits so unrelated paths cannot enter a handoff silently.

`/sdd-code-audit` is the broader point-in-time codebase health assessment. It reviews a whole repository or selected area through independent specialist passes, validates their evidence, and groups confirmed findings into candidate improvements. It does not replace the Change-local `/sdd-review` gate, modify application code, or make its report a competing source of implementation truth. Accepted outcomes should move into Epics and Changes before implementation.

An undated Change Brief at the fixed `<planning-path>/change-briefs/<slug>.md` path captures desired outcome and scope without technical planning, Change status, or central ownership metadata. `/sdd-change --plan` consumes that intent into a dated canonical Change under `<workspace>/.sdd/changes/` only when implementation planning should begin.

Every active Change folder under `<workspace>/.sdd/changes/` is one canonical working record. `proposal.md` defines scope, `design.md` defines the intended end state, constraints, technical direction, and any confirmed experience-design contract, and `tasks.md` is the adaptive implementation ledger and resume surface. Its YAML frontmatter records `status`, owning `space`, and target `repositories`; the path never encodes Space or repository ownership. The Change ID is unique within its workspace, so an unrelated workspace may use the same date and slug without collision. The plan specifies what must be true and confirmed, not a fixed implementation sequence; Apply keeps the risk, decision fan-out, verification-environment, and immutable-handoff records current as it learns. The lifecycle is `proposed -> planned -> in_progress -> in_review -> closed`; the four pre-close states are machine-readable frontmatter values, while closure is represented by moving the directory once under `changes/closed/`.

When implementation adds a surface parallel to an established adapter, client, route, workspace, worker, migration, or command, Apply uses a triggered Pattern Parity Matrix instead of assuming similar code has equivalent safety and recovery behavior. Stateful surfaces use a triggered transition matrix for identity changes, pending writes, navigation, recovery, session changes, authoritative refresh, and slow or hung requests. New or high-risk verification claims name exact tests or stable anchors and important assertions; Review independently opens that evidence, confirms the passing command discovers it, and checks the claimed implementation boundary rather than trusting aggregate green gates.

When upgrading active work from the earlier vocabulary, map `review` and `ready_to_close` to `in_review`. Map `replanning` to `proposed` while decisions remain unresolved or to `planned` once the revised plan is coherent. Historical closed Changes do not need to be rewritten.

`/sdd-apply` has no fixed dependency on a catalog of companion skills. It discovers the skills exposed by the current runtime, selects the smallest set materially relevant to the active implementation slice, and enforces the selected guidance in both direct and delegated work. A consuming environment can have a different skill set, or no matching specialist skill at all; project guidance and normal engineering judgment remain the fallback.

### Shared Component References

Shared component or pattern catalogs are optional incubators, not mandatory application dependencies. Material UI decisions use one of five canonical strategies: `existing application component`, `adopted reference`, `application-specific`, `reference candidate`, or `deliberate divergence`.

A reusable pattern may move through `reference candidate -> controlled preview -> application-owned adoption -> consumer validation -> standardized reference`. Promotion requires evidence from an implemented consumer outside the catalog itself. Applications may remain application-specific or deliberately diverge, and foundation-first work should not block application delivery unless the active Change explicitly requires it.

For non-trivial changes, `design.md` should compare viable technical options before selecting an approach. When a change creates a durable architecture, data, dependency, integration, deployment, security, storage, or cross-cutting project decision, record it as an ADR under `docs/adrs/`.

Product Briefs/PRDs and app visual/style guidance are private planning artifacts. By default, an idea lives at `<planning-root>/<idea>/`, stores its PRD at `<planning-root>/<idea>/prd.md`, and maps zero or more implementation repositories through `.sdd/config.yaml`. Reference planning artifacts when product scope, UI identity, or release readiness depends on them; keep accepted implementation truth in each code repository's Epic and Story map.

Generated indexes are optional. If a project maintains `docs/epics/index.md` or `docs/epics/story-index.json`, treat them as generated navigation or validation artifacts, not canonical truth.

Canonical template examples are browsable in [docs/templates/](docs/templates/). These mirror the skill-local template assets used to create PRDs, Change Briefs, Epics, Changes, ADRs, review reports, audit reports, changelogs, and release PR notes.

## Current Development Shape

This package is currently developed in a meta-repo situation: the reusable `sdd-skills` package lives inside a larger private workspace that also contains planning docs, shared guidance, and multiple application repositories. That shape is useful for developing the workflow because the active skills can be tested against real projects before being generalized back into this package.

The package ships with the same general Space/repository relationship and workspace-central Change ownership as its default. A generic version looks like this:

```text
<workspace>/
  .sdd/
    config.yaml
    changes/
      yyyy-mm-dd-change-name/
      closed/
  .agents/
    skills/
      sdd-*/
  ideas/
    product-one/
      product-one.md
      prd.md
      visual-identity.md
      exploration/
      change-briefs/
  code/
    product-one-web/
      AGENTS.md
      README.md
      CHANGELOG.md
      docs/
        epics/
        adrs/
        audits/
    product-one-mobile/
      AGENTS.md
      README.md
      docs/
        epics/
    sdd-skills/
      README.md
      docs/
        story-driven-development.md
      skills/
        sdd-*/
  shared/
    visual-style-guide.md
```

After `sdd setup <workspace>`, `<workspace>/.sdd/config.yaml` owns the private relationship map and `<workspace>/.sdd/changes/` owns every dated Change in that workspace:

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

Start by defining project-local guidance. A good `AGENTS.md` should identify any exception to the default Space/repository mapping, branch and merge policy, required commands and release records, truth-bearing supporting docs, generated/framework/test-support conventions, and project constraints. It should not relocate the fixed workspace Change store or repository-owned Epic, ADR, and audit truth.

Common adaptation points:

- Idea/repository mapping: the skills resolve the one-idea-to-many-repositories mapping from `.sdd/config.yaml` through `sdd context`. Declare an exception in project guidance, or change the packaged default as described below.
- Planning docs: `/sdd-prd`, `/sdd-explore`, `/sdd-space-status`, `/sdd-change`, `/sdd-design`, `/sdd-apply`, `/sdd-review`, `/sdd-epic-verify`, and `/sdd-release` resolve private context from the owning idea when relevant.
- SDD artifact paths: `<workspace>/.sdd/changes/` is the fixed workspace home for dated Changes; repository contracts configure `docs/epics/`, `docs/adrs/`, and `docs/audits/`. These are package conventions, not `AGENTS.md` configuration points.
- Branch and merge policy: `/sdd-review`, `/sdd-pr`, and `/sdd-release` are intentionally conservative. Update them or your app `AGENTS.md` for trunk-based development, no-PR workflows, required PR workflows, nonstandard production branches, or release trains.
- Verification commands: `/sdd-apply`, `/sdd-review`, and `/sdd-release` should be aligned with your real test, lint, typecheck, security, build, migration, and manual acceptance gates.
- Available skills: `/sdd-apply` discovers relevant capabilities from the consuming runtime instead of requiring named companion skills. Keep that behavior capability-driven if you add local routing preferences, and avoid turning optional skills into package dependencies.
- Changelog and release records: define whether the project uses Keep a Changelog, generated release notes, changesets, provider releases, another record, or no changelog. The skills follow that policy instead of imposing one.
- UI and design guidance: optional `/sdd-design --plan` resolves material experience uncertainty before implementation, while `--revise` turns implementation comparison, review, or manual feedback into an explicit preserve/change/non-goal delta before another `/sdd-apply`. `/sdd-review` checks the implemented experience when UI changes are involved. Point them at your design system docs, brand guide, component guidelines, or remove that gate if the project does not need one.
- Re-entry and audit heuristics: `/sdd-space-status` uses configured topology, active Change artifacts, recent local history, and working-tree evidence for orientation, while `/sdd-orphan-audit` depends on traceability evidence. Tune support/generated/test-harness classification after you see the first few reports against your codebase; do not weaken the apply, review, or Epic-verification requirement to classify relevant candidates.

### Changing The Idea/Repository Model

The one-idea-to-many-repositories model is an opinionated default, not an SDD truth invariant.

- `<workspace>/.sdd/config.yaml` is the canonical private mapping source after setup. Idea Folder Notes may seed mappings during `sdd setup`; public code repositories should not contain reverse links to private idea paths.
- One idea may map to zero, one, or many repositories. Under the default model, one repository is claimed by at most one idea; shared tooling repositories may remain unlinked.
- Resolution is config-first through `sdd context`. Ambiguous target-repository selection requires user input.
- If one repository eventually needs to support multiple ideas, evolve the metadata and resolver deliberately into a many-to-many model instead of adding ad hoc reverse links.
- For one project, declare an explicit exception in `.sdd/config.yaml` or project guidance. For a package-wide change, edit `Default Idea-To-Repository Relationship` in `docs/story-driven-development.md` and update affected CLI resolution behavior.
- Keep operational skills expressed in terms of `<planning-root>` and `<implementation-root>` so changing roots or relationship metadata does not require rewriting every workflow.

Audit relationship-resolution assumptions after customization:

```bash
rg -n 'ideas/<idea>|code/<repo>|repositories:|<planning-root>|<implementation-root>' skills/sdd-* docs README.md
```

### Changing The SDD Artifact Layout

Using different repository-owned Epic, ADR, or audit paths requires a coordinated package customization. The workspace Change roots and Space-owned `change-briefs/` directory are fixed contracts rather than repository settings. Do not change only `AGENTS.md`; that can make skills read and write different sources of truth.

Update these locations together:

- `docs/story-driven-development.md`: `Core Doctrine And Project Profile`, `Core Terms`, and `Change Workflow`.
- `skills/sdd-change/SKILL.md`: `Outputs`, mode workflows, and `Artifact Rules`.
- `skills/sdd-apply/SKILL.md`: canonical artifact layout, Change selection, required context, and closeout path operations.
- `skills/sdd-review/SKILL.md`: Change and branch selection, required context, review-artifact output, and closeout path operations.
- `skills/sdd-epic-verify/SKILL.md`, `skills/sdd-adr/SKILL.md`, `skills/sdd-interactive/SKILL.md`, and `skills/sdd-orphan-audit/SKILL.md`: their `Location`, `Output`, and `Required Context` sections.
- `skills/sdd-explore/SKILL.md`, `skills/sdd-design/SKILL.md`, `skills/sdd-prd/SKILL.md`, `skills/sdd-pr/SKILL.md`, `skills/sdd-release/SKILL.md`, and `skills/sdd-space-status/SKILL.md`: context, capture, relationship, or landmark sections that locate SDD artifacts.
- `skills/sdd-*/assets/`, `docs/templates/`, and path-aware helper scripts.

Use this audit after customization:

```bash
rg -n '<workspace>/.sdd/changes|change-briefs|docs/(epics|adrs|audits)' skills/sdd-* docs/templates
```

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

[docs/story-driven-development.md](docs/story-driven-development.md) is the canonical package workflow. It ships with the NPM package rather than being copied into each project. `sdd context` returns its installed `workflowPath`; operational skills read that file when SDD semantics matter and combine it with the consuming repository's local guidance.

## Project Guidance Expected By The Skills

The skills work best when each application repo has:

- `AGENTS.md` with branch policy and project-specific guidance
- `README.md` with setup and verification commands
- a portable `.sdd/config.yaml` with stable repository identity and artifact paths
- a configured changelog, release-note, changeset, or equivalent release-communication policy when releases need one
- `docs/epics/` for durable capability truth
- `docs/adrs/` for durable architecture decisions when they need their own record
- `docs/audits/` for point-in-time audit reports when used
- an owning private planning path with Folder Note repository mappings when a PRD/Product Brief, exploration, Change Brief, or visual/style decision needs durable context

The workspace installation separately provides the canonical `<workspace>/.sdd/changes/` store and `<workspace>/.agents/skills/` registry. The skills prefer project-local guidance for operating policy, project constraints, and explicit relationship exceptions, while central Change ownership and the default Space/repository model remain package-owned contracts.

## Status

This package is under active pre-1.0 development. It is exercised against multiple working application repositories, but the CLI and artifact conventions may still change between minor releases.
