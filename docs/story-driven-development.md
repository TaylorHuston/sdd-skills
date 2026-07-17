---
created: 2026-06-13
modified: 2026-07-15
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

Each skill must read the project profile before acting and apply this workflow through that profile. Once the idea planning path and target implementation repository are resolved, this package requires Epics under `docs/epics/`, active changes under `docs/changes/`, closed changes under `docs/changes/closed/`, ADRs under `docs/adrs/`, and package-defined audit/report locations under the implementation repository's relevant `docs/` subtree. Project guidance may override idea/repository resolution explicitly, but it may not silently relocate canonical SDD artifacts inside the implementation repository. A project that intentionally uses another repository-internal layout must modify the canonical workflow source, affected skills, and templates together. Operational customization must not weaken artifact authority, behavior-to-code traceability, evidence honesty, or reconciliation requirements.

### Default Idea-To-Repository Relationship

Private product direction is idea-owned, and an idea may map to zero, one, or many implementation repositories. Workspace topology is defined in `.sdd/config.yaml`:

```text
<workspace-root>/
  .sdd/
    config.yaml
    story-driven-development.md
  <planning-root>/
    <idea>/
  <repository-root>/
    <repo-a>/
    <repo-b>/
```

- **Planning root**: `planning.root` in `.sdd/config.yaml`. An idea defaults to `<planning.root>/<idea-key>` and may declare `planning` relative to that root or exceptional workspace-relative `planningPath`. This is the private product surface, including `prd.md`, Feature/Capability Briefs, exploration summaries, visual identity, research, private navigation, Change Briefs, and planned Change drafts under the configured `plannedChangesDirectory`.
- **Repository roots**: named entries under `repositories.roots` in `.sdd/config.yaml`. Each points to a workspace-relative directory containing implementation repositories.
- **Canonical relationship**: each `ideas.<idea>` entry declares lifecycle `status`, and each repository entry declares a `path`, lifecycle `status`, optional named `root`, and optional concise `role`. A rooted path resolves relative to that named repository root; an entry without `root` is an explicit workspace-relative exception.

```yaml
planning:
  root: ideas
repositories:
  roots:
    code: code
ideas:
  product:
    status: active
    repositories:
      - root: code
        path: product-web
        role: web-client
        status: active
      - root: code
        path: product-mobile
        role: mobile-client
        status: inactive
```

The mapping is intentionally private-workspace-owned. Do not require public code repositories to contain reverse links to private idea paths.

Idea and repository lifecycle status uses exactly `active`, `inactive`, or `archived`. `active` means current development and is included in default workspace status and new Change targeting. `inactive` retains a potential or paused mapping without surfacing it as current work. `archived` is historical/read-only reference. Missing status in an older v2 config is treated as `active` for backward compatibility, but new and maintained configurations should write it explicitly. An idea and each mapped repository have independent status: an active replacement effort may retain an archived predecessor repository.

Resolve roots in this order:

1. Run `sdd context <relevant-path> --json` and use its workspace, idea, idea status, `planningPath`, repository, repository status, role, resolved path, and related repositories.
2. Prefer an explicit user-selected repository when more than one mapped repository is relevant.
3. Apply declared project guidance only when it intentionally overrides the configured topology for the active operation.
4. Ask when multiple target repositories remain plausible or ownership cannot be resolved safely. Do not infer or persist an undeclared relationship silently.

One idea may map to many repositories. Under the current model, one repository should be claimed by at most one idea, and shared tooling repositories may remain unlinked. If real usage requires one repository to support multiple ideas, evolve the config schema and resolver deliberately into a many-to-many model rather than adding ad hoc reverse links.

Idea Folder Note metadata may be imported by `sdd init`, but `.sdd/config.yaml` is authoritative afterward. Do not create a missing idea directory during read-only work. When a configured planning or repository root moves, use `sdd configure` to repair the root while preserving Space IDs, statuses, roles, mappings, and artifact settings. Change configured relationships only when the active workflow is authorized to modify workspace topology. To change the packaged model, update this section, the config schema, CLI resolution behavior, and affected skills together.

Default inventory commands include only active ideas and active repositories. Use `sdd status --all` for lifecycle auditing and historical inventory. Explicit `sdd status <space-id>` remains able to show every repository mapped to that Space. Do not create or apply new work against an inactive idea or inactive/archived repository; update the workspace lifecycle status first when work intentionally resumes.

The planning root is not a second implementation source of truth. Product direction and private context live there; accepted implemented behavior, code maps, and verification maps remain in Epics and Stories under the implementation repository's `docs/` tree.

## Core Terms

- **Space / Space ID**: A planning-owned product or work area represented by one key under `.sdd/config.yaml` `ideas`. That exact, case-sensitive key is the stable Space ID used by CLI commands and may map to zero, one, or many implementation repositories. Treat it as an opaque identifier, not a display title.
- **Product Brief/PRD**: Private product context stored by default at `<planning-root>/prd.md`. It describes product purpose, audience, scope, principles, market context when useful, and open product questions. It guides SDD work but is not an implementation checklist.
- **Epic**: The durable capability file. It lives at `docs/epics/<key>-<###>-epic-name>/epic.md` and contains the capability narrative, embedded Stories, Requirements, Scenarios, `Implemented By`, `Verified By`, and known gaps.
- **Story**: A durable user-path contract embedded inside an Epic. New Epics should use Epic-scoped Story labels such as `S1`, `S2`, and full references such as `EPIC-ID/S1`; legacy app-wide Story IDs may remain when existing tests, reports, or history depend on them. Stories should usually use "As a <actor>, I want to <action/path>, so that <user-facing value/outcome>." A Story should describe a meaningful user action or outcome, not a tiny UI requirement.
- **Requirement**: A concrete behavior expectation under a Story. Prefer `SHALL` wording.
- **Scenario**: A BDD-style example under a Requirement. Prefer `WHEN` / `THEN` wording, including important failure modes.
- **Implemented By**: A developer starting index for the important files, modules, routes, components, APIs, migrations, or support files that implement or materially support the Story.
- **Verified By**: A behavior evidence index. It should name concrete tests, assertions, browser/manual scenarios, review artifacts, or other proof tied to the Requirement or Scenario. It is not a chronological command log.
- **Verification Gaps**: Known missing, deferred, or accepted gaps. Empty or stale gaps are misleading and should be cleaned up.
- **Change Brief**: An undated private outcome capture at `<planning-path>/<plannedChangesDirectory>/<change-slug>.md`. It records why a change may matter, the desired observable outcome, scope boundaries, success signals, durable constraints, and open product questions without choosing a technical approach. It has no Change status and does not authorize planning, promotion, or implementation by itself.
- **Planned Change Draft**: A private implementation-ready scaffold under `<planning-path>/<plannedChangesDirectory>/yyyy-mm-dd-change-name/` containing `proposal.md`, `design.md`, and `tasks.md` with `status: proposed`. It is not an active repository Change, does not authorize implementation, and does not override Epic/Story truth.
- **Change**: A tracked working artifact set under `docs/changes/yyyy-mm-dd-change-name/` containing `proposal.md`, `design.md`, and `tasks.md`. The change may create a new Epic, update an existing Epic, or both. Its active status is machine-readable from `tasks.md`; its closed state is derived from folder location.

## Artifact Authority

When artifacts disagree, reconcile them instead of allowing parallel truths.

Use this authority order:

1. Running implementation and tests reveal what the application actually does.
2. Epic files are the durable written map for accepted implemented capabilities, embedded Stories, Requirements, Scenarios, implementation evidence, verification evidence, and known gaps.
3. Active change folders are working records for proposed or in-progress changes.
4. Product Briefs/PRDs and confirmed Change Briefs guide product intent, audience, scope, principles, desired outcomes, and open product questions. They never override current implementation or Epic truth.
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

Use just-in-time elaboration instead of making early technical assumptions durable:

1. `/sdd-change --brief` captures an undated private Change Brief containing durable product intent only. Briefs are not Changes, do not use the Change status vocabulary, and may wait in the backlog without technical plans becoming stale.
2. `/sdd-change --plan` confirms the brief's outcome, refreshes current project and implementation context, and uses `sdd change create <space-id> <slug>` to scaffold the dated Planned Change Draft with `status: proposed`. When the Change introduces an Epic, use `sdd epic create <space-id> <epic-id> <slug>` so the repository artifact starts from the canonical validated shape rather than an agent-authored approximation. The skill then refines `proposal.md`, `design.md`, and `tasks.md` through product and technical planning and sets `status: planned` only when the Change is coherent and implementation-ready. Assign the dated Change ID at this point, not when the brief is first captured.
3. When a UI-bearing Change has material experience uncertainty, `/sdd-design --plan` may converge user flow, responsive composition, component/state behavior, accessibility, and visual direction into the existing `design.md` and `tasks.md`. After implementation begins, `/sdd-design --revise` may reopen an accepted experience direction when comparison, review, or manual feedback shows that its visual or interaction expression needs another pass without changing accepted behavior. Classify and confirm the revision before moving an `in_review` Change back to `in_progress`; behavioral discovery routes directly through `/sdd-change --plan` or `--replan` instead. Neither mode authorizes application or component-preview edits.
4. Once the planned artifacts validate and `proposal.md` preserves the brief's durable intent, the brief is consumed so there is no duplicate live planning truth. Planned drafts are not included in active repository status and must not be passed to `/sdd-apply` in place.
5. `sdd change promote <space-id> <change-id>` promotes the settled draft with explicit `--repo` selections when needed. Promotion requires `status: planned`, creates each selected repository Change under its configured active-Change path, removes private planning-path references, and removes the planning draft only after every selected destination succeeds.
6. `/sdd-change --plan` reconciles repository-specific scope after promotion before handing the Change to `/sdd-apply`. There must be only one active truth for each repository Change.

When implementation is expected immediately, `--plan` may capture and confirm the brief-level outcome in the same invocation before technical planning. It must not silently skip the intent boundary merely because the brief is short-lived.

Use the canonical dated change layout:

```text
docs/changes/yyyy-mm-dd-change-name/
  proposal.md
  design.md
  tasks.md
  review.md        # only when review finds deficiencies
```

`proposal.md` defines the problem, goal, scope, non-goals, affected Epics, and expected user/product outcome.

`design.md` is the high-level solution approach. It should explain the chosen technical approach, important alternatives considered, risks, dependencies, migration or data implications, and how the Epic/Story/Requirement truth will change. For UI-bearing Changes, its concise `Experience Design` section is the current accepted experience contract linking the user-confirmed flow, responsive composition, component/state behavior, accessibility, visual direction, and stable prototype references. Revision history belongs in the `tasks.md` `Design Updates` ledger so superseded and current directions do not compete. `design.md` should not become a step-by-step implementation plan or duplicate behavioral truth.

`tasks.md` is the adaptive implementation ledger. It records `Resume Here`, task progress, implementation evidence, verification evidence, planning updates, design revisions, manual UI confirmation status, release-communication impact, review status, branch/PR/merge state, deferred gaps, and closeout readiness.

### Change Status

Every Change `tasks.md`, active or closed, must begin with YAML frontmatter containing exactly one `status` value:

```yaml
---
status: proposed
---
```

The lifecycle is `proposed -> planned -> in_progress -> in_review -> closed`:

- `proposed`: the dated Change artifacts are being drafted and may still contain unresolved planning decisions.
- `planned`: the Change is coherent, validated, and ready for promotion or implementation.
- `in_progress`: implementation, verification, ordinary remediation, or active plan reconciliation is underway.
- `in_review`: implementation is believed complete and the Change is awaiting or undergoing independent review and closeout gates.
- `closed`: the Change folder has moved under `docs/changes/closed/`; this is a location-derived state, not a stored `tasks.md` status.

The active status values may move backward when reality demands it. Review findings return ordinary implementation work to `in_progress`. A discovery that invalidates the plan returns the Change to `proposed` while `/sdd-change --replan` revises it, then to `planned` before implementation resumes. Do not add separate activity states such as `replanning` or readiness assertions such as `ready_to_close`; those facts belong in the task ledger and review record.

Use `sdd change transition <space-id> <change-id> --from <status> --to <status>` when a skill changes an active Change status. The command is a compare-and-set filesystem primitive: it preflights every selected repository, refuses stale or invalid lifecycle edges, supports dry-run and JSON output, and changes only `tasks.md` frontmatter. The owning skill still decides why a transition is justified and must reconcile `Resume Here`, planning or design updates, evidence, review state, and Epic truth. In particular, `/sdd-design --revise` classifies feedback and confirms that it stays within accepted behavior before using `in_review -> in_progress`; planning invalidation routes directly to `proposed`; and implementation handoff uses `in_progress -> in_review` only after its contextual gates pass.

Moving the entire Change folder to `docs/changes/closed/` is the canonical and machine-readable closed transition. After contextual review, acceptance, PR/merge, and authorization gates pass, use `sdd change close <space-id> <change-id>` with explicit `--repo` selections when needed. The command requires `status: in_review`, preflights every selected destination, and performs only the configured folder transition; it does not decide readiness, merge branches, commit files, or reconcile product truth. The moved `tasks.md` retains `in_review`; folder location takes precedence. Historical closed Changes may retain status values that were valid under an earlier workflow version.

Closeout must reconcile both forward and backward. Updating the current Story is not sufficient when a change changes the meaning of earlier Stories, Requirements, Scenarios, `Verified By`, `Verification Gaps`, or closed change records. Before closing, scan affected Epics and related active/closed change artifacts for stale assumptions such as "Not implemented yet", "Not verified yet", outdated manual confirmation status, old boundary wording, or accepted gaps that no longer match reality.

Changes may be small or large. Small fixes still deserve enough tracking to keep Epic truth accurate. Large changes should remain adaptable rather than pretending every implementation phase is knowable up front.

Planning artifacts are documentation, but their allowed branch and commit behavior belongs to project policy. Before writing them, follow the consuming project's documentation policy. Before changing application code, tests, schemas, configuration, generated project artifacts, or runtime behavior, follow its implementation branch and authorization policy.

When implementation or manual feedback discovers a new or meaningfully changed Requirement, Scenario, constraint, or Epic ownership question that needs planning before more code changes, use `/sdd-change --replan` against the active change. That mode returns `tasks.md` to `status: proposed`, updates `proposal.md`, `design.md`, and `tasks.md`, records the planning update, sets `status: planned` when the revised plan is coherent, and then hands back to a fresh `/sdd-apply`.

## Deterministic Artifact Validation

Use `sdd validate` as the machine-readable structural baseline for SDD work. It checks only facts derivable from workspace files: required Change files and core sections, valid status and folder placement, duplicate planned/active/closed locations, unresolved scaffolding, Epic template shape, Story Index alignment, Story/Requirement/Scenario identifier shape and uniqueness, traceability table headers, evidence references to declared Requirements/Scenarios, and broken local Markdown links to Epic or Change artifacts. Scope it by Space, repository, Change, or Epic when a workflow owns a narrower surface. A Change-scoped run also validates Epic paths declared under its proposal's `Epic Actions` and reports a missing affected Epic rather than silently returning `epics: 0`. Closed history still receives strict file, status, collision, and reference checks, but older title, section, and placeholder shape is reported as compatibility warnings so a newer template does not retroactively invalidate completed work.

A passing validation result does not establish product completeness, implementation truth, test strength, manual acceptance, review readiness, or release readiness. Skills remain responsible for those contextual judgments and must not convert a structural pass into a semantic claim. A failing result is actionable workflow drift unless the finding is an intentional compatibility warning that the owning skill explicitly records.

`/sdd-change --plan` and `--replan` validate the planned or replanned Change before handoff. `/sdd-apply` validates the selected Change and affected Epics during Discovery and again after reconciliation. `/sdd-review` treats scoped validation as one input to its independent diff and truth review. `/sdd-epic-verify` begins with scoped Epic validation before auditing completeness, implementation, and evidence quality.

## Implementation And Review

Implementation should usually follow a BDD/TDD loop around each Requirement or Scenario:

1. Write or identify the failing or characterizing test when practical.
2. Implement the smallest slice that satisfies the Requirement or Scenario.
3. Run the focused verification.
4. Update `tasks.md` and affected Epic truth.
5. Commit the slice when commits are authorized and the app branch policy allows it.

Use subagents for isolated implementation slices, specialist guidance, and fresh-context review when the work is non-trivial. The orchestrating agent remains responsible for validating subagent claims, reconciling artifacts, and deciding whether to stop.

Delegation must not make the workflow appear stuck. After spawning a subagent, continue independent local work instead of waiting immediately. When the main thread is genuinely blocked on delegated output, wait at most 60 seconds without a user-visible status update. If the subagent is still running, report what is complete and what remains, then continue any available work. Treat roughly three minutes of cumulative waiting on one delegated task or wave as a recovery threshold: interrupt or close the agent and finish locally, or delegate the remaining question again with a narrower scope. Do not repeatedly poll, silently wait on optional verification, or let a slow reviewer prevent a concise status response. Close completed or abandoned agents promptly.

Manual UI confirmation is part of the workflow for browser-visible or otherwise user-facing changes. The agent should walk the user through what to manually confirm, record the status in `tasks.md`, and classify feedback as implementation bug, experience revision, requirement change, follow-up, or accepted gap. Experience revision within accepted behavior routes through `/sdd-design --revise`; changed behavior routes through `/sdd-change --replan`.

Manual confirmation status must use the same vocabulary everywhere: `not applicable`, `pending user`, `user confirmed`, or `accepted gap`.

`/sdd-apply` should treat Epic/Story truth as non-negotiable while implementation is happening. Behavior changes, stale Story wording, changed Requirement or Scenario meaning, moved Epic ownership, and changed verification confidence must be reconciled into affected Epics during the apply work or called out as a blocker before claiming progress. `/sdd-apply` should end implementation with an implementation self-check: confirm the slice is complete, verified, reconciled into Epic truth, and ready for independent review. The self-check should gather its materially relevant specialist findings before remediation, apply the safe set as one batch, and run one regression-focused validation pass rather than surfacing findings serially. This self-check does not replace `/sdd-review`.

`/sdd-review` is the local PR-style gate after implementation. It independently checks proposal/design/tasks, Epic truth, Requirements, Scenarios, tests, manual confirmation, code quality, security, docs, release-communication impact, branch policy, and closeout consistency. Review should be comprehensive rather than serial: complete the materially relevant review wave, validate and consolidate all findings, remediate the complete safe subset as one batch, then perform one regression-focused rereview. It should not require repeated user invocations merely to reveal the next review category. If deficiencies remain, it creates or updates `review.md` with the consolidated set. When the independent review is clean and a complete, current walkthrough only awaits manual confirmation, report verdict `ready` and manual confirmation `pending user`; do not misclassify the pending acceptance gate as `changes-requested`. Required manual confirmation may still block integration or closeout. If review and closeout gates are fully clean for a non-production integration target, it should offer the policy-defined merge-and-close as the recommended next action, but must ask the user before merging, moving the change folder, pushing, or taking any other integration action.

`/sdd-pr` and `/sdd-release` must preserve that distinction. They may continue a PR or release handoff with manual confirmation pending only when project policy permits that exact action, and must carry the acceptance status forward explicitly. Neither workflow may call a candidate merge-ready, merge, deploy, close, or perform another acceptance-dependent action while required confirmation remains `pending user`.

Status transitions must accompany the work that justifies them: `/sdd-change --brief` creates no status; `/sdd-change --plan` creates `proposed` and sets `planned` when planning is complete; `/sdd-apply` changes `planned` to `in_progress` and then `in_review` at implementation handoff; `/sdd-review` keeps `in_review`, returns implementation or experience deficiencies to `in_progress`, or routes invalidated planning through `proposed` and `/sdd-change --replan`; `/sdd-design --revise` works in `in_progress` and never restores `in_review` itself. Use guarded `sdd change transition` calls for these active-status mutations. Closing is represented only by the folder move performed through `sdd change close` after the owning skill has completed the contextual gates and obtained required authorization.

`/sdd-release` prepares promotion to the project-defined production target. It runs the project-defined release checks, updates required release communication according to project policy, and opens or prepares the required release handoff. It does not merge, deploy, tag, publish, or mutate production state without explicit authorization.

PR feedback does not bypass Epic truth or invalidate review silently. `/sdd-review` records the immutable source commit it covered. `/sdd-pr` classifies every accepted change after that commit, reconciles Epic/Story truth, evidence, supporting docs and release communication when affected, and requires a fresh `/sdd-review` for material behavior, contract, security, data, API, architecture, or risk-surface changes. A PR is merge-ready only when its current head is the latest reconciled head and no post-review commits remain unclassified.

## Branching

Each application repo owns its branch policy in its local `AGENTS.md`. Read it before creating branches, choosing merge targets, opening PRs, running reviews, or planning implementation.

SDD does not prescribe branch names, branch count, integration topology, PR usage, merge strategy, or release target. Skills must resolve those facts from project guidance and stop before branch, PR, merge, closeout, or release mutations when the policy is missing or ambiguous. SDD does require the review surface and Change status to identify the actual source, target, and reviewed commit precisely enough that later changes cannot silently invalidate readiness.

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
| `/sdd-prd` | Create or revise the private Product Brief/PRD that guides product scope, audience, principles, market context, monetization, and open product questions. |
| `/sdd-explore` | Think through product ideas, technical options, codebase findings, or requirement questions before deciding whether to create a change. |
| `/sdd-adr` | Create, update, or assess ADRs for durable technical decisions that future SDD work should respect. |
| `/sdd-change` | Capture durable intent with `--brief`, create a just-in-time dated plan with `--plan`, or revise an active Change with `--replan`. |
| `/sdd-design` | Plan initial experience readiness or revise an implemented experience within accepted behavior without editing application or component-preview code. |
| `/sdd-interactive` | Create and apply a lightweight tracked change in one working session for small concrete changes that do not need a full upfront proposal pass. |
| `/sdd-apply` | Implement or continue an active change using Requirement/Scenario-driven slices, subagent delegation when useful, verification, artifact reconciliation, and manual UI confirmation. |
| `/sdd-review` | Run the local PR-style integration gate after implementation or before closing a change. |
| `/sdd-epic-verify` | Audit an Epic end to end against current implementation, tests, evidence, Change status, and Story/Requirement/Scenario quality. |
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

Current documentation is capability-driven as well. When exploration, planning, implementation, or debugging depends on version-sensitive library, framework, SDK, API, CLI, or cloud-platform behavior, prefer an available current-documentation provider such as Context7 over model memory. Scope lookups to the exact concept and installed version when known. No named provider is required; use primary vendor documentation when one is unavailable.

Design tooling is also capability-driven. `/sdd-design` may use installed visual-review, browser, prototyping, design-system, component-preview, screenshot, measurement, image, or accessibility capabilities, but portable SDD must not require Stitch, Penpot, Storybook, Playwright, Figma, or any other named product. For revisions, prefer equivalent states, fixtures, viewports, and component crops when comparing implementations. Stable references to selected external artifacts belong in the Change; prototypes and screenshots remain design evidence rather than behavioral or implementation truth.

If this document and a skill disagree, update the skill or this document so they align rather than treating the disagreement as acceptable drift.

Do not duplicate full canonical templates here. Templates belong in the relevant skill assets.
