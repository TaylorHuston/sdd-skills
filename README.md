---
modified: 2026-08-15
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
| Security, accessibility, architecture, and framework specialist skills | Additional risk-specific guidance and review depth. Root and repository `AGENTS.md` files route implementation work to the appropriate capabilities instead of making `/sdd-apply` depend on named companion skills. |

Optional tools provide evidence and specialist guidance; they do not replace Epic/Story truth, Change artifacts, project-local instructions, or user confirmation. UI-bearing implementation and review require direct rendered-state inspection, but no named browser, screenshot, or preview product is required: use the project's existing tooling first, then an available runtime browser capability, rendered preview or fixture, or manual browser capture. If no available path can render a required surface, record the verification as blocked or explicitly accepted rather than treating source inspection, a green build, or generated-but-uninspected screenshots as visual proof.

## Reference Development Harness

Most development and testing of these skills has been performed with OpenAI reasoning models inside the [Pi coding agent](https://pi.dev) harness. This is provenance, not a runtime requirement or a claim that other models and harnesses are unsupported. The packaged skills and managed doctrine intentionally describe public capabilities—fresh-context review, optional isolated implementation, browser evidence, deterministic commands, and explicit mutation boundaries—rather than Pi tool names or one model catalog.

The current Pi development environment adds the following harness-local configuration outside this repository:

- Pi discovers the workspace-managed skills from `.agents/skills/` and loads workspace and repository `AGENTS.md` files as operating policy.
- The `@gotgenes/pi-subagents` package provides fresh-context foreground/background subagents. The primary agent remains responsible for scope, candidate inspection, evidence validation, integration, and final judgment.
- A global read-only `sdd-reviewer` agent profile uses `openai-codex/gpt-5.6-terra` with `high` reasoning, a 30-turn bound, and read/search-only tools. Pi policy routes independent SDD candidate, outcome, implementation-quality, spec-adherence, security, verification, traceability, and UI review passes to this profile instead of its cheaper generic exploration profile.
- A global read-only `Explore` override also uses `openai-codex/gpt-5.6-terra`; ordinary exploration remains distinct from the higher-assurance `sdd-reviewer` contract.
- Pi policy requires exact `provider/model` identifiers for overrides, fresh context for independent review, one writer per working tree, no recursive delegation, no secrets in delegated prompts, and primary-agent validation of all delegated claims.
- Subagent failure, timeout, or turn-limit exhaustion is treated as missing or partial evidence, never silently converted into a passing review gate.

These profiles are deliberately not installed by `sdd setup` and are not included in the npm package. Another harness does not need to reproduce the filenames or model choice, but should review its equivalents for:

- skill discovery and project-guidance loading
- fresh-context and preferably read-only reviewers
- model and reasoning controls appropriate to consequential review
- a sufficient or unlimited review budget, with visible timeout/abort status
- one-writer or isolated-workspace guarantees for delegated implementation
- candidate-bound command and artifact evidence
- browser or rendered-state inspection for UI-bearing work
- explicit authorization boundaries for commits, pushes, merges, releases, deployments, destructive actions, and secrets

If a harness cannot provide one of these capabilities, keep the workflow honest: run the work inline, mark the affected gate `cannot-verify` or `blocked`, obtain explicit acceptance where the project allows it, or adapt the local project guidance without weakening the portable artifact and candidate-freshness contracts.

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

`sdd change create` writes a central `change.md` immediately with `status: proposed`. Repository selection is optional at this stage. Run `/sdd-change` to capture intent and, when the user chooses, continue into technical planning. Planning expands `change.md` with the technical plan and adds `tasks.md`; the Change becomes `planned` only when ownership and the plan are coherent. Then validate the same record:

```bash
sdd validate billing --change "$CHANGE_ID"
```

Invoking `/sdd-apply` against a planned or in-progress v2 Change delivers exactly one ready outcome. Repository guidance and specialist workflows determine implementation method. Apply protects unrelated work, states a transient Scenario proof sketch, runs focused behavior-derived verification, and composes independent `/sdd-review` into the one central `review.md`. Review records five universal gates plus only the concrete checks triggered by the candidate. Apply may perform one consolidated remediation batch and one fresh final Review. It reconciles Epic truth immediately only when accepted behavior, Story completion, or a consumed contract/gap changed; otherwise reconciliation waits for Change completion. After the exact candidate is ready, Apply selectively creates one content-identical local commit, records its SHA and tree centrally, marks the outcome done, and stops. It never creates per-slice Reviews, receipts, digests, duplicate ledgers, or reseal commits. A separate final `/sdd-review` after all outcomes owns Change-wide integration readiness. Only after the Change is `in_review`, has a passing final review record, and satisfies project-specific acceptance and merge requirements should it be closed:

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

After setup, use `sdd configure` when workspace planning or repository roots move. It changes only private mapper paths; Space IDs, lifecycle statuses, repository roles, mappings, and repository-owned Epic, ADR, and audit settings remain intact. Use `--dry-run` to inspect the proposed rewrite first. Use `sdd update [path]` to reconcile the selected current workspace's managed workflow and skills.

Checksum protection stops setup or update when a managed skill has local modifications. Reconcile those changes first, or use `--force` only when intentionally replacing them with packaged versions. Epic records stay repository-owned and are not moved by installation migration.

## CLI Command Matrix

The CLI supplies deterministic filesystem and validation operations; skills supply product and engineering judgment. Skills should use the CLI rather than reproducing its topology, lifecycle, or structural checks by hand.

| Command | Deterministic responsibility | Relationship to skills |
|---|---|---|
| `sdd setup [workspace-path]` | Create or reconcile current workspace config, the central Change store, managed doctrine, installation lock, and managed skills. | Bootstrap before using any packaged skill. Skills route here when no workspace installation exists. |
| `sdd init [path]` | Create or reconcile one repository's portable `.sdd/config.yaml`. | Enables repository-aware context, Epic operations, validation, and every skill that works against application code. |
| `sdd configure [path]` | Detect or explicitly repair moved planning and named repository roots without rebuilding Space mappings. | Topology-repair utility used before resuming skills when `doctor` or `context` identifies moved roots. |
| `sdd update [path]` | Reconcile the current workspace's checksum-managed workflow and skills. | Maintenance command for managed drift or package upgrades. It does not migrate product artifacts or make product decisions. |
| `sdd doctor [path]` | Diagnose workspace/repository config, paths, ownership, installation lock, managed drift, guidance drift, and central Change metadata. | Preflight and troubleshooting command. Skills use it when setup or topology is incomplete or inconsistent. |
| `sdd context [path]` | Resolve workspace, Space, repository, artifact roots, lifecycle state, related repositories, and managed doctrine for a path. | Foundational resolver used by all packaged skills before reading or writing durable SDD truth. |
| `sdd status [space-id]` | List Spaces and repositories or return one Space's active and recent canonical Change inventory. `--all` includes inactive and archived entries. | Selection and re-entry input for `/sdd-space-status` and any skill that must select or resume existing work. |
| `sdd validate [space-id]` | Validate canonical Changes, repository Epics, verification reports, ownership, traceability, placeholders, and artifact links. | Structural gate used by `/sdd-change`, `/sdd-design`, `/sdd-interactive`, `/sdd-review`, and `/sdd-epic-verify`, or by Apply when repository guidance requires it; it does not replace contextual review. |
| `sdd epic create <space-id> <epic-id> <slug>` | Atomically scaffold and structurally validate a canonical Epic in one selected active repository. | Low-level creation primitive for planning workflows when a genuinely new Epic is accepted. The planning skill still owns its product content. |
| `sdd change create <space-id> <slug>` | Create one workspace-unique proposed Change containing `change.md`; repeated `--repo` options may establish initial repository ownership. | Creation primitive used by `/sdd-change`, `/sdd-interactive`, and remediation flows that need a new central Change. |
| `sdd change transition <space-id> <change-id> --from <status> --to <status>` | Compare-and-set one allowed lifecycle transition in `change.md`. `proposed -> planned` requires repository ownership, technical-planning sections in `change.md`, and `tasks.md`. | Lifecycle primitive used by planning, design revision, interactive implementation, Apply, and Review. It never decides whether the work is actually ready. |
| `sdd change close <space-id> <change-id>` | Move one `in_review` Change to `changes/closed/` after skill-owned closeout gates pass. | Final storage transition used only after `/sdd-review` and any required `/sdd-pr` or `/sdd-release` policy gates; the command itself does not prove acceptance. |
| `sdd --version` | Print the installed package version. | Diagnostic utility independent of the workflow lifecycle. |

All operational commands support human-readable and `--json` output. `setup`, `init`, `configure`, `update`, `epic create`, `change create`, `change transition`, and `change close` support `--dry-run`. Commands with a target accept `--workspace` where explicit workspace selection is needed. `validate` exits with status 1 when deterministic errors exist while still emitting its complete report. Managed workspace skills are checksum-protected: local modifications produce a conflict instead of being silently overwritten, and `sdd setup --force` or `sdd update --force` is required to replace them. Run `sdd <command> --help` for the complete option list.

An initialized workspace and repository look like:

```text
<workspace>/
  .sdd/
    config.yaml
    install-lock.json
    story-driven-development.md
    changes/
      yyyy-mm-dd-change-name/
        change.md
        tasks.md     # compact delivery outcomes and Resume checkpoint
        review.md    # outcome and final Change Review authority
        design.md    # optional compatibility context for an existing Change
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

Workspace-contained roots resolve from the workspace and are stored relative to it when possible; explicitly configured external roots may remain absolute. Each key under `ideas` is its stable, case-sensitive Space ID and is the identifier accepted by commands such as `sdd status billing`. A Space's planning directory defaults to `<planning.root>/<space-id>`; repository paths remain relative to their named workspace root. The committed repository contract owns its stable repository ID and its Epic, ADR, and audit paths. The workspace mapper owns private planning relationships, roles, and lifecycle status. Canonical Change locations are fixed under `<workspace>/.sdd/changes/`; each Change's `change.md` frontmatter supplies its status, owning `space`, and target `repositories`.

Space and repository `status` use one shared vocabulary: `active`, `inactive`, or `archived`. `active` means current development; `inactive` retains paused or potential work; `archived` identifies historical/read-only material. Space and repository statuses are independent, so an active clean-rebuild Space can retain an archived MVP repository. Older supported configurations without explicit lifecycle status remain compatible and default to `active`; new initialization writes the fields explicitly.

`sdd status` reads configured Space relationships and enumerates the central Change store once. It does not infer that similarly named planning and code directories belong together. Map each implementation repository under its owning Space so central Change repository IDs and repository-owned Epics resolve deterministically. If a Change target later becomes absent or belongs to another Space, status keeps the Space-owned Change visible and reports the unresolved repository ID while validation rejects the stale ownership. The workspace summary groups every `active` Space with its mapped active repositories and projects each canonical Change's target activity without creating repository copies. Repository entries also report their current Git branch and whether the worktree is clean; dirty worktrees include staged, unstaged, untracked, and conflicted counts. `sdd status --all` includes inactive and archived Spaces and repositories, while `sdd status <space-id>` narrows the canonical active and recent closed Change inventory by `change.md` ownership metadata.

### Change Lifecycle

1. `/sdd-change` creates or resumes one central `change.md` in `proposed` status and captures the desired outcome, scope, success signals, constraints, and open questions.
2. The skill asks whether to continue into technical planning. If the user stops, the proposed Change remains the backlog record and can be resumed later.
3. Technical planning settles repository ownership and observable behavior, routes branching viable technical approaches through `/sdd-adr`, expands `change.md`, and adds coherent delivery outcomes to compact `tasks.md` plus pending sections in central `review.md`.
4. After scoped validation passes, `/sdd-change` moves the Change to `planned` and returns a terminal result. When material experience uncertainty remains, separately invoked `/sdd-design --plan` preserves `planned`; otherwise the next owner is `/sdd-apply`.
5. `/sdd-design --revise` works only from an exact `in_progress` or `in_review` repository candidate and returns control before separately invoked Apply or Review. `/sdd-apply` selects one next-ready or explicitly requested outcome without moving or copying the Change. Planning-level discoveries return to `/sdd-change`.
6. When review and project-specific integration gates pass at `in_review`, `sdd change close` moves the one folder to closed history.

`change create` accepts optional repeated `--repo` selections and otherwise leaves repository ownership empty while proposed. `change transition` and `change close` read status, Space, and repositories from `change.md`. The `proposed -> planned` transition requires at least one repository, technical-planning sections in `change.md`, and `tasks.md`; a compatible existing `design.md` remains accepted. Close preserves `status: in_review` because closure is represented by the directory location.

### Artifact Validation

`sdd validate` enumerates the canonical workspace Change store once, then scans configured repositories for Epics and versioned Epic verification reports. Pass a Space ID to narrow central Changes by their `change.md` ownership, repeat `--repo` to select mapped repository surfaces, or use exactly one of `--change <change-id>` and `--epic <epic-id>` for a focused gate. Add `--changed-from <commit-ish>` when validation should compare current Epic content with a known Git baseline and reject stale top-level `modified` metadata across dates; a second substantive edit on the same local date remains valid because the metadata has day-level precision. Change-scoped validation requires `schema: sdd-change-v2`, compact outcome IDs and fields, unique full Scenario references, dependency graphs, a fixed-label Resume checkpoint, and central `review.md` for completed outcomes. Review validation checks the five universal gates, exact planned-trigger and Scenario sets, coherent verdicts and dated gaps, content-sensitive candidate identity, reachable final commits, and reviewed-tree/final-tree equality. Schema-less Changes and per-slice Review/receipt formats are unsupported history rather than a second validation contract. Declared Epic paths in `change.md` must still resolve in exactly one selected repository.

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

Pre-1.0 home-scoped installations, older workspace/repository schemas, and legacy Change locations are unsupported. Recreate the current workspace contract with `sdd setup` and `sdd init`, then manually preserve any alpha data still worth keeping in the current artifact shape. `sdd update` never treats a legacy location as a live alternate store.

If a root directory is renamed after initialization, `sdd doctor` reports the missing parent root without repeating a warning for every derived Space or repository path. Run `sdd configure` to review detected replacements, or use explicit flags when the new path cannot be inferred safely.

The skills resolve workspace topology and repository identity through `sdd context`, then read the managed doctrine at the returned `workflowPath` when SDD semantics matter. `<workspace>/.sdd/config.yaml` owns private relationships, `<workspace>/.sdd/changes/` owns every dated Change in that workspace, and each repository's `.sdd/config.yaml` owns portable identity plus Epic, ADR, and audit paths.

## Workflow And Skill Matrix

The usual path is:

```text
/sdd-space-status or /sdd-explore
        -> /sdd-prd when product direction is unresolved
        -> /sdd-change -> optional /sdd-design; required /sdd-adr for branching technical approaches
        -> /sdd-apply [one outcome: implement -> focused verification -> central Review -> conditional Epic Update -> commit]
        -> repeat Apply per remaining outcome
        -> final /sdd-review on current Epic truth -> /sdd-changelog when warranted
        -> /sdd-release -> /sdd-pr when production handoff uses a PR
        -> sdd change close
```

`/sdd-gather-context` is a lightweight shared-reference skill invoked inside Explore, ADR, and Change. It reads the action-specific minimum evidence in the same session, creates no artifact, and returns an evidence-linked sufficiency result to its caller. Explore stores idea-owned discussions under the idea's `explorations/`; workspace-owned discussions without one idea default to `.sdd/explorations/`. When an outcome matures, Explore names the owning workflow and returns control before that workflow's mutation boundary. `/sdd-interactive` is the narrow-change shortcut across Change creation and Apply-style implementation. The three audit skills can enter the flow at any time: they report evidence, then route accepted remediation into `/sdd-change` or `/sdd-interactive`. Skills do not automatically authorize commits, pushes, merges, releases, deployments, or closure unless their own contract and the user's request explicitly do so. Invoking `/sdd-apply` grants the narrow contract-owned authorization for its final reviewed local outcome commit only; it does not authorize broad staging, push, amend, rebase, merge, PR, release, deployment, or central-Change commit.

| Skill | Use it for | Durable output or effect | Main CLI relationship | Typical relationship to other skills |
|---|---|---|---|---|
| `/sdd-space-status` | Read-only re-entry after time away or when current state is unclear. | Concise status brief; no artifact mutation. | Wraps `sdd status --json` and uses `sdd context`. | Usually first; routes to the active skill or next useful workflow. |
| `/sdd-gather-context` | Shared minimum context acquisition for an exploration, ADR, or Change. | Evidence-linked same-session context result; no durable artifact or mutation. | Uses `context` and `status` for deterministic topology and inventory. | Invoked by `/sdd-explore`, `/sdd-adr`, and `/sdd-change`; returns control without taking over their judgment. |
| `/sdd-explore` | Any substantial discussion the user wants preserved beyond chat, including feasibility, marketing, future features, product, technical, operational, design, business, or workflow topics. | One synthesized durable record, usually under the owning idea's `explorations/` directory but placed elsewhere when authority or local guidance makes another home more appropriate. | Uses `context` and `status` only when SDD ownership or artifact truth matters. | May invoke `/sdd-prd`, `/sdd-change`, `/sdd-adr`, or another owning workflow when conclusions mature; never implements code. |
| `/sdd-prd` | Create, revise, or check private Product Brief/PRD direction. | Planning-root `prd.md` or feature/capability brief. | Uses `context` and `status`; routes setup drift to `doctor`, `setup`, `init`, or `update`. | Precedes `/sdd-change` when product direction is not settled; may receive drift from audits or review. |
| `/sdd-change` | Capture intent, continue technical planning, or revise an existing plan. | V2 `change.md`, compact outcome queue in `tasks.md`, and pending central `review.md`. | Uses `change create`, `validate`, and `change transition`, with `context`/`status` for selection. | Invokes `/sdd-adr` for consequential branching approaches; otherwise hands planned work to `/sdd-design` or `/sdd-apply`. |
| `/sdd-design` | Converge initial experience design or revise one exact UI candidate without changing accepted behavior. | Current experience contract and visual verification matrix in existing Change artifacts; explicit `complete`, `no-op`, `needs-user`, `blocked`, or `routed` result. | Uses `context`, `status`, `validate`, `candidate resolve` for revisions, and guarded `change transition` only after a confirmed `in_review` revision. | Runs separately after `/sdd-change` reaches `planned`, or after candidate-bound implementation/review feedback; stops before application edits and recommends exactly one next owner such as Apply or Review. |
| `/sdd-adr` | Compare genuinely viable technical approaches and assess or record the resulting durable architecture, data, dependency, integration, deployment, security, storage, or cross-cutting decision. | Explicit `complete`, `no-op`, `needs-user`, `blocked`, or `routed` result and, only when warranted, a repository-owned ADR linked to Changes and Epic truth. | Invokes `/sdd-gather-context`, then uses `context`/`status`; setup commands only when project structure is missing. | Required handoff from `/sdd-change` for branching viable technical approaches; confirms the decision with the user and returns the selected direction and ADR reference without editing caller-owned artifacts or implementing it. |
| `/sdd-interactive` | Small UI tweaks, narrow defects, polish, or minor behavior refinements in one tracked session. | The same three v2 records plus one committed Apply outcome. | Uses `change create`, `change transition`, and `validate`; final closeout remains separately authorized. | Thin shortcut through normal Change and Apply contracts; routes broader scope to `/sdd-change`. |
| `/sdd-apply` | Deliver the next ready or explicitly requested outcome. | One implemented, freshly verified, independently reviewed, conditionally Epic-reconciled, locally committed outcome recorded in `tasks.md` and `review.md`. | Uses `context`, `status`, candidate resolution, and `change transition` only to enter `in_progress`; composes public Review and Epic Update contracts. | Follows repository guidance, runs proportional proof, seals one reviewed tree in one local commit, and stops before another outcome, final Review, Changelog, push, PR, or release. |
| `/sdd-review` | Independently review an exact outcome candidate or the complete Change candidate. | Five universal gates, concrete triggered checks, Scenario coverage, findings, gaps, and final commit/tree in one central `review.md`. | Uses exact candidate envelopes; final lifecycle/handoff actions remain separately authorized. | Directly callable or composed by Apply; final direct invocation owns Change-wide integration readiness. |
| `/sdd-epic-update` | Reconcile repository-owned Epic truth to one exact candidate. | Idempotent Epic/Story implementation, gap, and verification-map updates when durable truth changed. | Uses `epic update-input`, candidate resolution, and scoped validation. | Directly callable; Apply composes it when behavior, Story completion, or a consumed contract/gap changed, otherwise defers it. |
| `/sdd-epic-verify` | Audit an entire Epic against current implementation, scenarios, and traceability. | Versioned repository-owned Epic verification report and any factual Epic reconciliation. | Uses `context`, `status`, `validate`; may use `change create` for accepted remediation. | Broader than Change review; routes product drift to `/sdd-prd`, implementation work to `/sdd-change`, then `/sdd-apply` and `/sdd-review`. |
| `/sdd-code-audit` | Point-in-time health audit of a repository or subsystem across code quality and specialist concerns. | Repository-owned code-audit report; no application-code mutation. | Uses `context`/`status`; routes legacy/drift prerequisites to `update`. | Independent of one Change; accepted findings become `/sdd-change` work or ADR decisions. |
| `/sdd-orphan-audit` | Conservative search for likely dead code, orphaned tests, and stale reverse traceability. | Repository-owned orphan-audit report; never automatic deletion. | Uses `context`/`status`; routes legacy/drift prerequisites to `update`. | Accepted cleanup moves to `/sdd-change` or `/sdd-interactive`; Epic-wide uncertainty may move to `/sdd-epic-verify`. |
| `/sdd-release` | Prepare coordinated production handoffs, checks, changelog/version intent, and release metadata without merging or deploying. | Project-defined release communication, metadata, commits, and handoff state when authorized. | Uses `context`/`status`; may use `change close` only after all release and closeout gates pass. | Follows `/sdd-review`; precedes `/sdd-pr` when the production handoff is a PR. |
| `/sdd-pr` | Open and steward SDD-backed pull requests, address accepted review feedback, and preserve review freshness. | Provider PRs, review-thread responses, remediation commits, and reconciled Epic/Change evidence when authorized. | Uses `context` and `status`; lifecycle mutation remains owned by review/release closeout. | Usually follows `/sdd-review`; follows `/sdd-release` for production PRs; feedback may return to `/sdd-apply` and `/sdd-review`; always stops before merge approval. |

## Artifact Model

The managed workflow defines artifact roles and authority across one workspace-scoped Change store and the selected implementation repositories:

```text
<workspace>/.sdd/
  changes/
    yyyy-mm-dd-change-name/
      change.md        # intent, lifecycle, constraints, accepted approach
      tasks.md         # compact outcomes and one Resume checkpoint
      review.md        # per-outcome and final candidate-bound Review
      design.md        # optional compatibility context for an existing Change
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

Epics are the durable behavior-to-code map. Stories, Requirements, Scenarios, behavior-mapped `Implemented By`, `Implementation Gaps`, scenario-mapped `Verified By`, and `Verification Gaps` live inside each Epic's `epic.md`. Story implementation state (`not implemented`, `partial`, or `implemented`) remains separate from verification state (`unverified`, `partial`, or `verified`). Each Story has one authoritative current implementation map and one authoritative current verification map. `Implemented By` identifies Requirement ownership through concrete repository-relative `path#anchor` locations; `primary` means governing behavior regardless of physical layer, with narrower multiple primaries allowed for genuinely split ownership. Anchors should identify behavior-owning definitions or registrations rather than imports, call sites, incidental handlers, or files cited for another symbol. Automated `Verified By` evidence uses a repository-relative `test/path#exact test title or stable named anchor` so the validator and a future developer can open the proof directly. Interactive, rendered, live-provider, or multi-context evidence needs a stable project artifact or durable reproducible descriptor tied to the exact candidate; `/tmp` paths, ephemeral browser profiles, chat transcripts, and bare “local observation” phrases cannot be sole completion evidence. `Verified By` is an evidence index, not a chronological command log. Broad gates such as lint, typecheck, build, or full CI are supporting evidence unless tied to a named Requirement or Scenario. If implemented behavior is not represented in an Epic/Story, treat it as undocumented drift until the map is updated or the code is removed through a tracked change.

Reverse traceability belongs to the workflows that own evidence and review. Apply composes public outcome-checkpoint `/sdd-review` and conditionally composes `/sdd-epic-update`; final `/sdd-review` independently checks the complete source-vs-target diff, `/sdd-epic-verify` requires a full Epic-scoped inventory before it can report `aligned`, and `/sdd-orphan-audit` remains the repository-wide maintenance pass. Repository guidance may require additional checks during implementation. The packaged audit script expands evidence globs, reads the current working tree rather than only the Git index, and separates likely behavior candidates from test harness, framework/configuration, and generated files. Its output is conservative candidate data for agent classification, never automatic deletion approval.

Review and handoff truth is equally explicit. `/sdd-review` generates candidates through separate intent, complete-diff, dependency/contract, deterministic-tool, risk, and blind-spot passes before validating findings. Versioned Epic verification reports keep historical failures separate from the current result and link later remediation through `supersedes`. `/sdd-pr` and `/sdd-release` classify the complete source-to-target changed-file inventory and recheck it after remediation or release-metadata commits so unrelated paths cannot enter a handoff silently.

`/sdd-code-audit` is the broader point-in-time codebase health assessment. It reviews a whole repository or selected area through independent specialist passes, validates their evidence, and groups confirmed findings into candidate improvements. It does not replace the Change-local `/sdd-review` gate, modify application code, or make its report a competing source of implementation truth. Accepted outcomes should move into Epics and Changes before implementation.

Every active Change folder under `<workspace>/.sdd/changes/` is one canonical working record from initial intent onward. Current records use `schema: sdd-change-v2`. `change.md` defines intent, lifecycle, ownership, constraints, accepted approach, and expected risks. `tasks.md` is a compact adaptive queue of coherent delivery outcomes plus one replaceable Resume checkpoint. One Requirement is a useful default, not a universal rule; coupled Requirements need a concise reason. `review.md` owns exact candidate identity, five universal gates, concrete planned/discovered triggers, Scenario coverage, separate Spec and Quality judgments, findings, gaps, acceptance, remediation, and final commit/tree. A candidate change stales affected evidence. Proposed Changes begin with `change.md`; planning adds `tasks.md` and `review.md`. Schema-less and receipt-based Changes are unsupported history. Existing `design.md` files may remain as context, but current workflows do not create them. The lifecycle is `proposed -> planned -> in_progress -> in_review -> closed`, with closure represented by moving the directory once under `changes/closed/`.

When upgrading active work from the earlier vocabulary, map `review` and `ready_to_close` to `in_review`. Map `replanning` to `proposed` while decisions remain unresolved or to `planned` once the revised plan is coherent. Historical closed Changes do not need to be rewritten.

`/sdd-apply` reads applicable workspace and repository `AGENTS.md` files before implementation. Those files decide development method, specialist implementation skills, verification technique, and required documentation. Apply itself protects scope/candidate integrity, focused fresh verification, independent Review, gap honesty, selective local commit authority, and tree equality. It does not maintain a universal implementation recipe or companion-skill catalog.

### Shared Component References

Shared component or pattern catalogs are optional incubators, not mandatory application dependencies. Material UI decisions use one of five canonical strategies: `existing application component`, `adopted reference`, `application-specific`, `reference candidate`, or `deliberate divergence`.

A reusable pattern may move through `reference candidate -> controlled preview -> application-owned adoption -> consumer validation -> standardized reference`. Promotion requires evidence from an implemented consumer outside the catalog itself. Applications may remain application-specific or deliberately diverge, and foundation-first work should not block application delivery unless the active Change explicitly requires it.

When `/sdd-change` finds two or more meaningfully different viable technical approaches, it invokes `/sdd-adr` rather than duplicating technical option analysis. `/sdd-adr` verifies that the alternatives are real, compares their tradeoffs, recommends a direction, asks the user to decide, and creates an ADR under `docs/adrs/` only when the consequential choice would be surprising or difficult to reconstruct without that context. Straightforward implementation details with one viable path return `no-op` without a ceremonial ADR. ADR then returns the selected direction and repository-relative reference; the caller owns any Change or exploration update, and implementation remains a separate invocation.

Product Briefs/PRDs and app visual/style guidance are private planning artifacts. By default, an idea lives at `<planning-root>/<idea>/`, stores its PRD at `<planning-root>/<idea>/prd.md`, and maps zero or more implementation repositories through `.sdd/config.yaml`. A PRD is a directional starting point to revisit deliberately, not a continuously synchronized implementation source or ordinary Apply/Review gate. Reference planning artifacts when the current Change explicitly depends on an unresolved product decision or UI identity; keep accepted delivery scope in the active Change and accepted implementation truth in each code repository's Epic and Story map.

Generated indexes are optional. If a project maintains `docs/epics/index.md` or `docs/epics/story-index.json`, treat them as generated navigation or validation artifacts, not canonical truth.

Canonical template examples are browsable in [docs/templates/](docs/templates/). These mirror the skill-local template assets used to create PRDs, Changes, Epics, ADRs, review reports, audit reports, changelogs, and release PR notes.

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
      explorations/
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
- Planning docs: `/sdd-gather-context` centralizes the minimum-read policy used by Explore, ADR, and Change; `/sdd-explore` chooses a durable discussion destination deliberately and usually defaults to the owning idea's `explorations/`; the other planning and delivery skills resolve private context from the owning idea when relevant.
- SDD artifact paths: `<workspace>/.sdd/changes/` is the fixed workspace home for dated Changes; repository contracts configure `docs/epics/`, `docs/adrs/`, and `docs/audits/`. These are package conventions, not `AGENTS.md` configuration points.
- Branch and merge policy: `/sdd-review`, `/sdd-pr`, and `/sdd-release` are intentionally conservative. Update them or your app `AGENTS.md` for trunk-based development, no-PR workflows, required PR workflows, nonstandard production branches, or release trains.
- Verification commands: encode implementation-time verification expectations in repository guidance; keep `/sdd-review` and `/sdd-release` aligned with your integration and release gates.
- Available skills: route specialist implementation skills from root or repository `AGENTS.md` guidance. `/sdd-apply` follows that guidance instead of maintaining a package-owned capability router.
- Changelog and release records: define whether the project uses Keep a Changelog, generated release notes, changesets, provider releases, another record, or no changelog. The skills follow that policy instead of imposing one.
- UI and design guidance: after Change planning reaches `planned`, optional `/sdd-design --plan` resolves material experience uncertainty before implementation. `--revise` binds implementation comparison, review, or manual feedback to an exact candidate envelope and explicit preserve/change/non-goal delta before separately invoked Apply or Review. Prototypes remain optional; `/sdd-review` independently checks the implemented experience when UI changes are involved. Point these workflows at your design-system docs, brand guide, component guidelines, or remove the optional Design gate if the project does not need one.
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

Using different repository-owned Epic, ADR, or audit paths requires a coordinated package customization. The workspace Change roots are fixed contracts rather than repository settings. Do not change only `AGENTS.md`; that can make skills read and write different sources of truth.

Update these locations together:

- `docs/story-driven-development.md`: `Core Doctrine And Project Profile`, `Core Terms`, and `Change Workflow`.
- `skills/sdd-gather-context/SKILL.md`: shared minimum reads, action profiles, evidence reconciliation, and same-session return contract.
- `skills/sdd-change/SKILL.md`: artifact model, adaptive planning workflow, and guardrails.
- `skills/sdd-apply/SKILL.md`: central Change outcome selection, behavioral brief, repository guidance, focused proof, independent central Review, conditional Epic reconciliation, and final content-identical local commit.
- `skills/sdd-review/SKILL.md`: Change and branch selection, required context, review-artifact output, and closeout path operations.
- `skills/sdd-epic-verify/SKILL.md`, `skills/sdd-adr/SKILL.md`, `skills/sdd-interactive/SKILL.md`, and `skills/sdd-orphan-audit/SKILL.md`: their `Location`, `Output`, and `Required Context` sections.
- `skills/sdd-explore/SKILL.md`, `skills/sdd-design/SKILL.md`, `skills/sdd-prd/SKILL.md`, `skills/sdd-pr/SKILL.md`, `skills/sdd-release/SKILL.md`, and `skills/sdd-space-status/SKILL.md`: context, capture, relationship, or landmark sections that locate SDD artifacts.
- `skills/sdd-*/assets/`, `docs/templates/`, and path-aware helper scripts.

Use this audit after customization:

```bash
rg -n '<workspace>/.sdd/changes|docs/(epics|adrs|audits)' skills/sdd-* docs/templates
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
- an owning private planning path with Folder Note repository mappings when a PRD/Product Brief, exploration, proposed Change, or visual/style decision needs durable context

The workspace installation separately provides the canonical `<workspace>/.sdd/changes/` store and `<workspace>/.agents/skills/` registry. The skills prefer project-local guidance for operating policy, project constraints, and explicit relationship exceptions, while central Change ownership and the default Space/repository model remain package-owned contracts.

## Status

This package is under active pre-1.0 development. It is exercised against multiple working application repositories, but the CLI and artifact conventions may still change between minor releases.
