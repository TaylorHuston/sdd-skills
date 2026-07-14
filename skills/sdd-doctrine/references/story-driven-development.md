---
created: 2026-06-13
modified: 2026-07-11
---
# Story-Driven Development

Story-Driven Development is our workflow for helping solo developers and small teams use LLMs on larger codebases without losing track of what the application actually does or where that behavior lives in the codebase.

The north star is an evidence-backed map from product behavior to implementation. Running behavior and tests reveal reality; Epic/Story truth is the durable written map. SDD's job is to keep those aligned so future work starts from the right behavior, the right files, and the right verification evidence instead of rediscovering the system from scratch.

The durable source of truth is not an implementation plan, external report, chat transcript, Confluence-style page, or game of telephone. It is the current product behavior recorded in Epics, embedded Stories, Requirements, Scenarios, `Implemented By`, `Verified By`, and known gaps. If a behavior is not represented in an Epic/Story, it is not accepted as durable implemented product truth until the Epic/Story map is updated.

The goals are:

1. Make it clear what users can and cannot currently do.
2. Give future developers and agents a reliable map from behavior to implementation files and verification evidence.
3. Make "what is actually implemented?" answerable from Epic/Story truth without hunting through stale reports or relying on memory.
4. Keep change work scoped, reviewable, and recoverable across sessions.
5. Preserve enough process structure to avoid drift without turning every change into heavyweight waterfall planning.

## Core Doctrine And Project Profile

SDD separates portable process semantics from the consuming project's operating profile.

This doctrine owns the portable core:

- artifact roles and authority
- default one-to-many relationship from private product ideas to implementation repositories
- canonical repository layout under `docs/`
- Epic, Story, Requirement, and Scenario semantics
- implementation and verification traceability
- evidence typing and gap honesty
- change, review, reconciliation, and closeout semantics
- BDD/TDD and independent-review defaults
- coordination between the shipped SDD skills

Project or workspace guidance owns the operating profile:

- explicit exceptions to the default idea/repository relationship and non-SDD supporting-doc locations
- branch topology, merge strategy, PR requirements, and commit policy
- test, build, lint, security, migration, deployment, and release commands
- changelog location, format, and release-note policy
- required supporting docs and architecture, API, UI, security, or platform constraints
- available tools and skills, external-service permissions, and local reporting preferences

Each skill must read the project profile before acting and apply this doctrine through that profile. Once the idea planning root and target implementation repository are resolved, this package requires Epics under `docs/epics/`, active changes under `docs/changes/`, closed changes under `docs/changes/closed/`, ADRs under `docs/adrs/`, and package-defined audit/report locations under the implementation repository's relevant `docs/` subtree. Project guidance may override idea/repository resolution explicitly, but it may not silently relocate canonical SDD artifacts inside the implementation repository. A project that intentionally uses another repository-internal layout must modify the shipped doctrine, affected skills, and templates together. Operational customization must not weaken artifact authority, behavior-to-code traceability, evidence honesty, or reconciliation requirements.

### Default Idea-To-Repository Relationship

By default, private product direction is idea-owned and an idea may map to zero, one, or many implementation repositories:

```text
<workspace-root>/
  ideas/
    <idea>/
      <idea>.md
  code/
    <repo-a>/
    <repo-b>/
```

- **Planning root**: `<workspace-root>/ideas/<idea>/`. This is the private product surface, including `prd.md`, Feature/Capability Briefs, exploration summaries, visual identity, research, and private navigation.
- **Implementation root**: `<workspace-root>/code/<repo>/`. This is one selected Git repository containing application code and canonical SDD artifacts under `docs/`.
- **Canonical relationship**: the idea Folder Note at `<planning-root>/<idea>.md` owns a YAML `repositories` list. Each entry requires a workspace-relative `path` to `code/<repo>` and may include a concise `role`.

```yaml
repositories:
  - path: code/product-web
    role: web-client
  - path: code/product-mobile
    role: mobile-client
```

The mapping is intentionally private-workspace-owned. Do not require public code repositories to contain reverse links to private idea paths.

Resolve roots in this order:

1. Prefer explicit idea and repository paths from the user or project guidance.
2. When starting from an idea, read its Folder Note mapping. Auto-select only when one repository is mapped or the requested work identifies one repository unambiguously; otherwise ask which repository is the target.
3. When starting from a code repository, scan `ideas/*/*.md` Folder Note frontmatter for a matching repository path.
4. If no metadata mapping exists, use a unique idea/repository basename match only as a compatibility fallback. Do not silently create or persist a relationship from that fallback.
5. Ask when multiple ideas claim one repository, multiple target repositories remain plausible, or ownership cannot be resolved safely.

One idea may map to many repositories. Under the default model, one repository should be claimed by at most one idea, and shared tooling repositories may remain unlinked. If real usage requires one repository to support multiple ideas, evolve the metadata and resolver deliberately into a many-to-many model rather than adding ad hoc reverse links.

Do not create a missing idea directory during read-only work. Create or change relationship metadata only when the active workflow is authorized to write private planning artifacts. If a workspace uses different roots or mapping metadata, declare the resolution rule in project guidance; to change the packaged default, edit this section and keep the shipped doctrine mirror synchronized.

The planning root is not a second implementation source of truth. Product direction and private context live there; accepted implemented behavior, code maps, and verification maps remain in Epics and Stories under the implementation repository's `docs/` tree.

## Core Terms

- **Product Brief/PRD**: Private product context stored by default at `<planning-root>/prd.md`. It describes product purpose, audience, scope, principles, market context when useful, and open product questions. It guides SDD work but is not an implementation checklist.
- **Epic**: The durable capability file. It lives at `docs/epics/<key>-<###>-epic-name>/epic.md` and contains the capability narrative, embedded Stories, Requirements, Scenarios, `Implemented By`, `Verified By`, and known gaps.
- **Story**: A durable user-path contract embedded inside an Epic. New Epics should use Epic-scoped Story labels such as `S1`, `S2`, and full references such as `EPIC-ID/S1`; legacy app-wide Story IDs may remain when existing tests, reports, or history depend on them. Stories should usually use "As a <actor>, I want to <action/path>, so that <user-facing value/outcome>." A Story should describe a meaningful user action or outcome, not a tiny UI requirement.
- **Requirement**: A concrete behavior expectation under a Story. Prefer `SHALL` wording.
- **Scenario**: A BDD-style example under a Requirement. Prefer `WHEN` / `THEN` wording, including important failure modes.
- **Implemented By**: A developer starting index for the important files, modules, routes, components, APIs, migrations, or support files that implement or materially support the Story.
- **Verified By**: A behavior evidence index. It should name concrete tests, assertions, browser/manual scenarios, review artifacts, or other proof tied to the Requirement or Scenario. It is not a chronological command log.
- **Verification Gaps**: Known missing, deferred, or accepted gaps. Empty or stale gaps are misleading and should be cleaned up.
- **Change**: A tracked working artifact set under `docs/changes/yyyy-mm-dd-change-name/` containing `proposal.md`, `design.md`, and `tasks.md`. The change may create a new Epic, update an existing Epic, or both.

## Artifact Authority

When artifacts disagree, reconcile them instead of allowing parallel truths.

Use this authority order:

1. Running implementation and tests reveal what the application actually does.
2. Epic files are the durable written map for accepted implemented capabilities, embedded Stories, Requirements, Scenarios, implementation evidence, verification evidence, and known gaps.
3. Active change folders are working records for proposed or in-progress changes.
4. Product Briefs/PRDs guide product intent, audience, scope, principles, and open product questions.
5. Reviews, release notes, changelogs, and exploration notes are evidence and transition records.
6. READMEs and general docs are supporting documentation and must not contradict active Epic truth.

There should be no separate durable answer to "what is implemented?" outside Epic/Story truth. If code exists but no Epic/Story records the behavior, treat it as undocumented drift. Either add it to the appropriate Epic/Story with `Implemented By` and `Verified By` evidence, explicitly record it as a gap or orphan, or remove it through a tracked change.

Generated Story indexes, such as `docs/epics/index.md` or `docs/epics/story-index.json`, are optional project-local validation or navigation artifacts. They are not canonical. If a project intentionally maintains them, keep them generated and current; do not hand-maintain them.

Legacy root-level `changes/`, standalone Story files under `docs/stories/`, old Story implementation records, non-Story Task records, and `.llm/plans` or `.llm/reviews` artifacts are migration inputs only. Canonical SDD workflows must migrate root-level changes into `docs/changes/` before applying, reviewing, or closing them unless the package itself has been deliberately customized for another layout.

## Project Docs

Project docs outside the canonical Epic and change artifacts are supporting documentation. They are useful for architecture, testing, deployment, style, data/API contracts, operations, and onboarding, but they must not become a competing source of truth for implemented behavior.

Do not require every app to carry the same `docs/` inventory unless project-local guidance says so. Existing or locally required docs must stay truthful when implementation changes affect them. Missing docs are findings only when project-local `AGENTS.md`, `docs/README.md`, another app-local guide, or workspace guidance explicitly requires them.

`/sdd-apply` should update affected project docs as part of implementation. `/sdd-review` should treat stale project docs, or missing locally required docs, as review findings before ready, merge, or closeout.

## Evidence Discipline

`Verified By` should be scenario-mapped. Prefer entries that say which Story/Requirement/Scenario is proved, what test/check/manual path proves it, and what assertion or observation matters.

Keep evidence types distinct:

- **Focused automated evidence**: unit, integration, route, Convex, browser, or smoke tests that assert a named Scenario.
- **Broad supporting gates**: lint, typecheck, build, codegen, full CI, migration checks, or broad test commands. These support confidence but do not replace Scenario proof unless the exact Scenario assertion is named.
- **Deterministic E2E evidence**: browser or end-to-end tests with controlled providers, fixtures, seeded data, or stable mocks. This proves integration behavior, not live model quality.
- **Live-provider evidence**: playtests against real models or external services. This is useful empirical evidence but should be recorded separately from deterministic proof.
- **Manual UI confirmation**: user-visible walkthrough evidence. Its status vocabulary is exactly `not applicable`, `pending user`, `user confirmed`, or `accepted gap`.
- **Log or debug evidence**: local logs, persisted debug rows, screenshots, traces, or console output. Use this to support a Scenario only when the inspected artifact is named and repeatable enough for future diagnosis.

Chronological command output belongs in `tasks.md` verification ledgers. Epic `Verified By` should summarize only durable, scenario-mapped evidence. If evidence is missing, stale, live-only, manual-only, or weaker than the Scenario needs, put that in `Verification Gaps` rather than smoothing it over with a broad command list.

## Epic And Story Shape

Epics are capability-sized. A useful Epic might cover browsing a catalog, adding items to a cart, purchasing, creating an order, and notifying fulfillment.

Stories are user-path-sized. A useful Story might be: "As a shopper, I want to browse, search, and filter the catalog, so that I can find items I want to buy."

Avoid Stories that are just UI details, such as "As a user, I want to click the plus icon." That detail may belong in a Requirement or Scenario if it matters, but it is rarely a Story by itself.

Stories are not immutable. They may be renamed, reordered, split, merged, moved between Epics, or revised as the product understanding improves. For new or normalized Epics, use Epic-scoped Story labels such as `S1`, `S2`, and `S3`; labels must be unique within the Epic, and full references such as `EPIC-ID/S1/R2-S3` are unique because they include the Epic ID. Candidate Stories should not receive a Story label until promoted into the embedded Story set.

Historical app-wide Story IDs such as `DASH-008` or `SQ-003` can remain when existing tests, review reports, generated indexes, or commits depend on them. Do not create UUID-like Story handles for new embedded Stories. If a Story moves between Epics and outside references exist, record a short migration note from the old full reference to the new one instead of pretending the move was invisible.

When later work supersedes an earlier Story boundary, update the earlier Story too. A superseding Story may add a note, but it is not enough to leave the older Requirements or Scenarios reading as current truth if their assumptions changed. Treat cross-Story reconciliation as part of the change, not as optional documentation polish.

Requirements and Scenarios should be concrete enough to drive BDD/TDD:

```text
Requirement R1: The catalog SHALL support filtering by item category.

Scenario R1-S1:
WHEN a shopper selects a category filter
THEN the catalog shows only items in that category.
```

Capture important failure modes as Scenarios when they affect user-visible behavior, data integrity, permissions, payment flow, destructive actions, or recovery.

## Change Workflow

Use the canonical dated change layout:

```text
docs/changes/yyyy-mm-dd-change-name/
  proposal.md
  design.md
  tasks.md
  review.md        # only when review finds deficiencies
```

`proposal.md` defines the problem, goal, scope, non-goals, affected Epics, and expected user/product outcome.

`design.md` is the high-level technical approach. It should explain the chosen approach, important alternatives considered, risks, dependencies, migration or data implications, and how the Epic/Story/Requirement truth will change. It should not become a step-by-step implementation plan.

`tasks.md` is the adaptive implementation ledger. It records `Resume Here`, task progress, implementation evidence, verification evidence, manual UI confirmation status, release-communication impact, review status, branch/PR/merge state, deferred gaps, and closeout readiness.

Closeout must reconcile both forward and backward. Updating the current Story is not sufficient when a change changes the meaning of earlier Stories, Requirements, Scenarios, `Verified By`, `Verification Gaps`, or closed change records. Before closing, scan affected Epics and related active/closed change artifacts for stale assumptions such as "Not implemented yet", "Not verified yet", outdated manual confirmation status, old boundary wording, or accepted gaps that no longer match reality.

Changes may be small or large. Small fixes still deserve enough tracking to keep Epic truth accurate. Large changes should remain adaptable rather than pretending every implementation phase is knowable up front.

Planning artifacts are documentation, but their allowed branch and commit behavior belongs to project policy. Before writing them, follow the consuming project's documentation policy. Before changing application code, tests, schemas, configuration, generated project artifacts, or runtime behavior, follow its implementation branch and authorization policy.

When implementation or manual feedback discovers a new or meaningfully changed Requirement, Scenario, constraint, or Epic ownership question that needs planning before more code changes, use `/sdd-propose --replan` against the active change. That mode updates `proposal.md`, `design.md`, and `tasks.md`, records the planning update, and then hands back to a fresh `/sdd-apply`.

## Implementation And Review

Implementation should usually follow a BDD/TDD loop around each Requirement or Scenario:

1. Write or identify the failing or characterizing test when practical.
2. Implement the smallest slice that satisfies the Requirement or Scenario.
3. Run the focused verification.
4. Update `tasks.md` and affected Epic truth.
5. Commit the slice when commits are authorized and the app branch policy allows it.

Use subagents for isolated implementation slices, specialist guidance, and fresh-context review when the work is non-trivial. The orchestrating agent remains responsible for validating subagent claims, reconciling artifacts, and deciding whether to stop.

Manual UI confirmation is part of the workflow for browser-visible or otherwise user-facing changes. The agent should walk the user through what to manually confirm, record the status in `tasks.md`, and classify feedback as implementation bug, requirement change, follow-up, or accepted gap.

Manual confirmation status must use the same vocabulary everywhere: `not applicable`, `pending user`, `user confirmed`, or `accepted gap`.

`/sdd-apply` should treat Epic/Story truth as non-negotiable while implementation is happening. Behavior changes, stale Story wording, changed Requirement or Scenario meaning, moved Epic ownership, and changed verification confidence must be reconciled into affected Epics during the apply work or called out as a blocker before claiming progress. `/sdd-apply` should end implementation with an implementation self-check: confirm the slice is complete, verified, reconciled into Epic truth, and ready for independent review. This self-check does not replace `/sdd-review`.

`/sdd-review` is the local PR-style gate after implementation. It independently checks proposal/design/tasks, Epic truth, Requirements, Scenarios, tests, manual confirmation, code quality, security, docs, release-communication impact, branch policy, and closeout consistency. If it finds deficiencies, it creates or updates `review.md`. If it returns clean for a non-production integration target, it should offer the policy-defined merge-and-close as the recommended next action, but must ask the user before merging, moving the change folder, pushing, or taking any other integration action.

`/sdd-release` prepares promotion to the project-defined production target. It runs the project-defined release checks, updates required release communication according to project policy, and opens or prepares the required release handoff. It does not merge, deploy, tag, publish, or mutate production state without explicit authorization.

PR feedback does not bypass Epic truth or invalidate review silently. `/sdd-review` records the immutable source commit it covered. `/sdd-pr` classifies every accepted change after that commit, reconciles Epic/Story truth, evidence, supporting docs and release communication when affected, and requires a fresh `/sdd-review` for material behavior, contract, security, data, API, architecture, or risk-surface changes. A PR is merge-ready only when its current head is the latest reconciled head and no post-review commits remain unclassified.

## Branching

Each application repo owns its branch policy in its local `AGENTS.md`. Read it before creating branches, choosing merge targets, opening PRs, running reviews, or planning implementation.

SDD does not prescribe branch names, branch count, integration topology, PR usage, merge strategy, or release target. Skills must resolve those facts from project guidance and stop before branch, PR, merge, closeout, or release mutations when the policy is missing or ambiguous. SDD does require the review surface and lifecycle state to identify the actual source, target, and reviewed commit precisely enough that later changes cannot silently invalidate readiness.

## Definition Of Done For A Story

A Story is ready for handoff only when:

- It describes the current user path and observable outcome.
- Requirements and Scenarios match implemented behavior or clearly identify known gaps.
- `Implemented By` points to the important files a developer should inspect first.
- `Verified By` contains scenario-mapped concrete evidence tied to Requirements or Scenarios.
- `Verification Gaps` contains only real remaining gaps.
- Evidence type is clear enough to distinguish deterministic tests, broad gates, live-provider playtests, manual confirmation, and debug/log inspection.
- Production-path and mock-boundary risks have proof or explicit gaps.
- Manual UI confirmation is complete, not applicable, pending user, or recorded as an accepted gap.
- The active change's `tasks.md` does not contradict Epic truth, review state, release-communication state, PR/merge state, folder state, or accepted deferred gaps.

## Definition Of Done For An Epic

An Epic is healthy only when:

- Its outcome and current scope match what the embedded Stories actually provide.
- Stories are in a logical order and remain appropriately scoped.
- Story labels are unique within each Epic, and full Story references remain traceable. Historical app-wide Story IDs remain unique across active Epics unless a documented migration is resolving a duplicate.
- Requirements and Scenarios are concrete enough to guide implementation and verification.
- `Implemented By`, `Verified By`, and `Verification Gaps` are current enough that a future developer can start investigation from the Epic instead of rediscovering the relevant code.
- Related active or closed changes do not contradict Epic truth.
- Earlier Stories are reconciled when later Stories supersede their assumptions.
- Closed change artifacts do not still claim accepted work is unimplemented, unverified, pending, or located in an active folder unless that language is explicitly historical and non-authoritative.
- Any maintained generated indexes are current and do not point to missing evidence.
- Deferred scope and open decisions remain accurate.

## Anti-Patterns

Avoid:

- Creating a new Story to avoid fixing a stale existing Story.
- Allowing implemented behavior to live only in code, chat, a stale report, or a private memory instead of the relevant Epic/Story.
- Treating `proposal.md`, `design.md`, or `tasks.md` as more authoritative than implementation reality or Epic truth.
- Turning Stories into tiny UI control requirements.
- Hiding product scope expansion inside technical design or implementation tasks.
- Recording only generic command logs in `Verified By`.
- Treating broad gates as a substitute for Scenario-specific evidence.
- Blurring deterministic E2E, live-provider playtests, manual confirmation, and debug/log evidence into one undifferentiated "verified" bucket.
- Treating fake-backed tests as full production-path proof when the real boundary is risky.
- Hand-maintaining generated indexes.
- Leaving completed `design.md`, `tasks.md`, or review records with stale "Not implemented yet", "Not verified yet", old manual status vocabulary, or superseded boundary wording.
- Closing, merging, or promoting a change while Epic truth, tasks, review status, release-communication state, PR/merge state, or manual confirmation status remains contradictory.

## Skill Workflow

Use the skills to apply this doctrine consistently:

| Skill | Purpose |
|---|---|
| `/sdd-doctrine` | Supply the portable semantic contract and separate core SDD invariants from project operating policy. |
| `/sdd-prd` | Create or revise the private Product Brief/PRD that guides product scope, audience, principles, market context, monetization, and open product questions. |
| `/sdd-explore` | Think through product ideas, technical options, codebase findings, or requirement questions before deciding whether to create a change. |
| `/sdd-adr` | Create, update, or assess ADRs for durable technical decisions that future SDD work should respect. |
| `/sdd-propose` | Create or update a dated change folder with `proposal.md`, `design.md`, and `tasks.md`; use `/sdd-propose --replan` for mid-change discoveries that need planning before `/sdd-apply` resumes. |
| `/sdd-interactive` | Create and apply a lightweight tracked change in one working session for small concrete changes that do not need a full upfront proposal pass. |
| `/sdd-apply` | Implement or continue an active change using Requirement/Scenario-driven slices, subagent delegation when useful, verification, artifact reconciliation, and manual UI confirmation. |
| `/sdd-review` | Run the local PR-style integration gate after implementation or before closing a change. |
| `/sdd-epic-verify` | Audit an Epic end to end against current implementation, tests, evidence, change lifecycle state, and Story/Requirement/Scenario quality. |
| `/sdd-space-status` | Produce a read-only re-entry brief for returning to an app after time away. |
| `/sdd-orphan-audit` | Find likely orphaned code/tests and SDD traceability gaps conservatively. |
| `/sdd-release` | Prepare the project-defined production release handoff, including release checks and required release communication. |
| `/sdd-pr` | Steward an existing or non-production SDD-backed PR through comments, checks, accepted fixes, and final merge handoff. |
| `/sdd-skills-promote` | Promote local SDD workflow changes into the public reusable `sdd-skills` package with public-safe reconciliation. |

Do not create separate compatibility-wrapper skills for older command names. Canonical new work should use the current `/sdd-*` skill names directly.

## Skill Enforcement Boundary

This document defines the durable doctrine for Story-Driven Development. Skills operationalize the doctrine for specific workflows.

Keep SDD skills focused on workflow procedure: what to read, what decisions to make, what artifacts to update, what verification to run, and what to report. Put portable SDD semantics, the default idea-to-repository relationship, and the canonical `docs/` repository layout in this doctrine. Put explicit relationship exceptions and user, technology, branch, command, release, and reporting preferences in project or workspace guidance instead of repeating them in skills or treating them as SDD requirements.

Put project-specific branch, merge, release, deployment, and repository rules in the app repo's local `AGENTS.md` or equivalent project guidance. SDD skills should read and enforce those rules, falling back to documented workspace guidance when local policy is absent, instead of restating a branch model inside each workflow.

Strong portable defaults such as BDD/TDD, orchestrator/subagent use for non-trivial work when tooling allows it, manual confirmation semantics, and Epic/Story truth discipline belong in this doctrine. Individual skills should explain how their workflow applies those defaults only where procedure or stop conditions differ.

Skill-assisted implementation is capability-driven. `/sdd-apply` should inspect the skills available in the current runtime, select only those materially relevant to the active slice, read and enforce their guidance, and pass selected guidance into delegated work. The workflow must not require any named optional skill to be installed. When no matching skill is available, continue from project guidance, current SDD artifacts, and sound engineering judgment. Record concrete consequences of applied guidance in the existing implementation and verification record, not a separate skill-selection inventory.

If this document and a skill disagree, update the skill or this document so they align rather than treating the disagreement as acceptable drift.

Do not duplicate full canonical templates here. Templates belong in the relevant skill assets.
