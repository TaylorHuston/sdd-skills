---
created: 2026-06-13
modified: 2026-08-15
---
# Story-Driven Development

Story-Driven Development is our workflow for helping solo developers and small teams use LLMs on larger codebases without losing track of what the application actually does or where that behavior lives in the codebase.

The north star is an evidence-backed map from product behavior to implementation. Running behavior and tests reveal reality; Epic/Story truth is the durable written map. SDD's job is to keep those aligned so future work starts from the right behavior, the right files, and the right verification evidence instead of rediscovering the system from scratch.

The durable source of truth is not an implementation plan, external report, chat transcript, Confluence-style page, or game of telephone. It is current and accepted product behavior recorded in Epics, embedded Stories, Requirements, Scenarios, independent implementation and verification state, behavior-mapped `Implemented By`, `Implementation Gaps`, scenario-mapped `Verified By`, and `Verification Gaps`. If a behavior is not represented in an Epic/Story, it is not accepted as durable implemented product truth until the Epic/Story map is updated.

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
- fixed central Change storage and canonical repository-local artifact topology
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

Each skill must read the project profile before acting and apply this workflow through that profile. Change storage is fixed within the resolved workspace: active Changes live only at `<workspace>/.sdd/changes/<change-id>/`, from initial intent onward, and closed Changes live only at `<workspace>/.sdd/changes/closed/<change-id>/`. Epics remain under `docs/epics/`, ADRs remain under `docs/adrs/`, and implementation, tests, and supporting docs remain in each target repository. Package-defined audits and reports also remain under the relevant repository's `docs/` subtree. Project guidance may override idea/repository resolution explicitly and may define allowed repository-local supporting-doc layouts, but it may not relocate, duplicate, or re-scope the workspace-central Change store.

### Default Space, Change, And Repository Topology

Private product direction is idea-owned, dated Change coordination is workspace-central, and accepted implementation truth is repository-local. An idea may map to zero, one, or many implementation repositories:

```text
<workspace>/
  .sdd/
    config.yaml
    install-lock.json
    story-driven-development.md
    changes/
      <change-id>/
        change.md        # intent, lifecycle, constraints, accepted approach
        tasks.md         # compact outcomes and one Resume checkpoint
        review.md        # outcome and final Change Review authority
        design.md        # optional context retained by an existing Change
      closed/
        <change-id>/
  .agents/
    skills/
      sdd-*/
  <planning-root>/
    <idea>/
      prd.md
  <repository-root>/
    <repo-a>/
      .sdd/config.yaml
      docs/epics/
      docs/adrs/
    <repo-b>/
      .sdd/config.yaml
      docs/epics/
      docs/adrs/
```

- **Workspace configuration**: `<workspace>/.sdd/config.yaml` contains private planning roots, named repository roots, `ideas` mappings, roles, and lifecycle status. The current contract is `version: 3`, `schema: sdd-v3`, with no `kind`. Workspace-contained paths serialize relative to the workspace when possible; explicitly mapped external repository roots may remain absolute.
- **Managed skills**: `<workspace>/.agents/skills/` is the default registry. A configured `skills.directory` must remain lexically and physically inside the workspace, including after existing symlink ancestors are resolved.
- **Central Change store**: `<workspace>/.sdd/changes/` is the sole owner of dated Change records in that workspace. Active Change directories are direct children; closed Change directories are direct children of `<workspace>/.sdd/changes/closed/`. A Change ID is unique across both locations within that workspace and is never nested under, prefixed by, or scoped through a Space or repository. Unrelated workspaces have independent namespaces.
- **Repository configuration**: each participating repository commits `.sdd/config.yaml` with `kind: repository`, a stable portable repository ID, and paths for repository-owned artifacts such as Epics, ADRs, audits, and reports. It contains no private planning path, central Change content, dated Change path, managed-skill path, or reverse workspace link.
- **Canonical relationship**: each workspace `ideas.<idea>` entry declares lifecycle `status`, and each mapped repository declares a `path`, lifecycle `status`, optional named `root`, and optional concise `role`. The private mapper may associate one idea with many repositories; the repository contract remains independently cloneable.
- **Artifact ownership**: the one central Change may coordinate one or many repositories by stable repository ID. Epics, ADRs, implementation, tests, migrations, generated contracts, and supporting docs stay in the repository that owns them. A repository view of a Change is a projection of the central record, never another stored record.

```yaml
version: 3
schema: sdd-v3
skills:
  directory: .agents/skills
planning:
  root: product/ideas
repositories:
  roots:
    code: products
repositoryArtifacts:
  epics: docs/epics
  adrs: docs/adrs
  audits: docs/audits
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

`sdd setup [workspace-path]` creates or reconciles the workspace configuration, central active and closed Change directories, installation lock and recovery state, managed doctrine, and managed skills. Omitting the path selects the current directory; setup never infers the user's home.

Resolve workspace ownership in this order:

1. an explicit command `--workspace <path>`;
2. `SDD_WORKSPACE_ROOT`;
3. the nearest ancestor workspace of the command's target path;
4. the nearest ancestor workspace of the current directory when the target is an explicitly mapped external repository.

There is no home-directory fallback. An external repository that is outside the workspace tree must be mapped by the selected workspace and invoked with an explicit `--workspace` or from a current directory inside that workspace. Ambiguous or unmapped ownership fails without selecting another installation.

Pre-1.0 home-scoped installations and older workspace or repository configuration schemas are unsupported. Recreate a current workspace with `sdd setup`, initialize repositories with `sdd init`, and manually preserve only alpha data still worth keeping. No operational command treats an older configuration or Change namespace as current.

Idea and mapped-repository lifecycle status uses exactly `active`, `inactive`, or `archived`. `active` means current development and is included in default workspace status and new Change targeting. `inactive` retains paused or potential work; `archived` is historical/read-only reference. The portable repository contract does not prescribe workspace lifecycle state.

For an existing Change, treat its `change.md` `space` and `repositories` frontmatter as the declared scope; resolve those repository IDs through the selected workspace rather than deriving a different target set from the current directory. Repository ownership may remain empty while `proposed`, but it is required before `planned`. Ask when ownership cannot be resolved safely.

One idea may map to many repositories. Under the current model, one repository should be claimed by at most one idea, and shared tooling repositories may remain unlinked. If real usage requires one repository to support multiple ideas, evolve the config schema and resolver deliberately into a many-to-many model rather than adding ad hoc reverse links.

`<workspace>/.sdd/config.yaml` is authoritative for the workspace's private relationship map; `<repository>/.sdd/config.yaml` is authoritative for portable repository identity and repository-local artifact locations; `<workspace>/.sdd/changes/` is authoritative for every Change in that workspace. A repository-only context with no mapped Idea planning path may use its repository ID as the Space ID and may own a central Change. Do not create a missing idea directory during read-only work. When a workspace root moves, use `sdd configure` to repair it while preserving Space IDs, statuses, roles, and mappings.

Default inventory commands include only active ideas and active mapped repositories. Use `sdd status --all` for lifecycle auditing and historical inventory. Explicit `sdd status <space-id>` remains able to show every repository mapped to that Space. Do not create or apply new work against an inactive idea or inactive/archived mapping; update the workspace lifecycle status first when work intentionally resumes.

Neither the planning root nor the central Change store is a second implementation source of truth. Product direction and private context live in the planning root; the central Change is the working coordination record; accepted implemented behavior, code maps, and verification maps remain in Epics and Stories under each implementation repository's `docs/` tree.

## Core Terms

- **Space / Space ID**: A planning-owned product or work area represented by one key under `<workspace>/.sdd/config.yaml` `ideas`. That exact, case-sensitive key is the stable Space ID used by cross-repository CLI commands and may map to zero, one, or many implementation repositories. A standalone repository defaults to its repository ID when no private mapping exists.
- **Product Brief/PRD**: Private product context stored by default at `<planning-path>/prd.md`. It is a starting point for product purpose, audience, scope, principles, market context when useful, and open product questions, and should be revisited deliberately as the product evolves. It is not an implementation checklist, continuously synchronized status artifact, or ordinary Apply/Review gate.
- **Epic**: The durable capability file. It lives at `docs/epics/<key>-<###>-epic-name>/epic.md` and contains the capability narrative, embedded Stories, Requirements, Scenarios, independent implementation and verification state, behavior and evidence maps, and known gaps.
- **Story**: A durable user-path contract embedded inside an Epic. New Epics should use Epic-scoped Story labels such as `S1`, `S2`, and full references such as `EPIC-ID/S1`; legacy app-wide Story IDs may remain when existing tests, reports, or history depend on them. Stories should usually use "As a <actor>, I want to <action/path>, so that <user-facing value/outcome>." A Story should describe one primary user path to a meaningful action or outcome, not a tiny UI requirement or a container for several independently valuable workflows. Its `Implementation` state is `not implemented`, `partial`, or `implemented`; its independent `Verification` state is `unverified`, `partial`, or `verified`.
- **Requirement**: A concrete behavior expectation under a Story. Prefer `SHALL` wording.
- **Scenario**: A BDD-style example under a Requirement. Prefer `WHEN` / `THEN` wording, including important failure modes.
- **Implemented By**: A behavior-mapped developer index from each Requirement, and distinct Scenarios when needed, to concrete repository-relative source locations and stable symbols or searchable anchors. It distinguishes the primary application-logic owner from adapters, persistence, presentation, configuration, migrations, and support.
- **Implementation Gaps**: Accepted Story behavior that does not currently exist. An implemented Story has no implementation gaps; a partial Story names the missing Requirement or Scenario references explicitly.
- **Verified By**: A behavior evidence index. It should name concrete tests, assertions, browser/manual scenarios, review artifacts, or other proof tied to the Requirement or Scenario. Automated evidence uses a repository-relative `path#exact test title or stable anchor` so a future developer can rerun and inspect it. It is not a chronological command log.
- **Verification Gaps**: Known missing, deferred, or accepted gaps. Empty or stale gaps are misleading and should be cleaned up.
- **Change**: One dated tracked record at `<workspace>/.sdd/changes/<change-id>/` while active or `<workspace>/.sdd/changes/closed/<change-id>/` after close. Current Changes use `schema: sdd-change-v2`. `change.md` captures intent, lifecycle, ownership, constraints, accepted approach, and expected risks. Planning adds compact outcome coordination in `tasks.md` and pending candidate-bound sections in one central `review.md`. Existing Changes may retain `design.md` as context, but current workflows do not create it. Schema-less and receipt-based Changes are unsupported history.
- **Repository projection**: A filtered view of a central Change for one targeted repository. Status, validation, implementation, review, PR, and release workflows may use projections to operate on repository-local artifacts, but a projection is never a stored Change copy or an independent lifecycle owner.

## Artifact Authority

When artifacts disagree, reconcile them instead of allowing parallel truths.

Use this authority order:

1. Running implementation and tests reveal what the application actually does.
2. Epic files are the durable written map for accepted implemented capabilities, embedded Stories, Requirements, Scenarios, implementation evidence, verification evidence, and known gaps.
3. The one central active Change record is the working coordination truth for proposed, planned, in-progress, or in-review work across all of its target repositories.
4. Product Briefs/PRDs provide directional starting context and may intentionally remain broader, older, aspirational, or phased differently. They never override current implementation, accepted active Change scope, or Epic truth, and ordinary drift does not block implementation or Review. A current Change blocks only when it explicitly depends on an unresolved product decision.
5. Reviews, release notes, changelogs, and exploration notes are evidence and transition records.
6. READMEs and general docs are supporting documentation and must not contradict active Epic truth.

There should be no separate durable answer to "what is implemented?" outside Epic/Story truth. Embedded Stories may preserve accepted behavior that is not implemented yet, but their implementation and verification states plus gap sections must make that distinction explicit. If code exists but no Epic/Story records the behavior, treat it as undocumented drift. Either add it to the appropriate Epic/Story with `Implemented By` and `Verified By` evidence, explicitly record it as a gap or orphan, or remove it through a tracked change.

Generated Story indexes, such as `docs/epics/index.md` or `docs/epics/story-index.json`, are optional project-local validation or navigation artifacts. They are not canonical. If a project intentionally maintains them, keep them generated and current; do not hand-maintain them.

Legacy idea-owned planned Change directories and repository-local active or closed dated Change directories—including root-level `changes/`, `docs/changes/`, and `docs/changes/closed/`—are unsupported historical data. Canonical workflows must never treat them as live owners or edit them in place. Recreate worthwhile intent through `/sdd-change` or manually convert records into the current central artifact shape. Standalone Story files under `docs/stories/`, old Story implementation records, non-Story Task records, and `.llm/plans` or `.llm/reviews` artifacts are likewise non-canonical historical context.

## Project Docs

Repository docs outside canonical Epic artifacts are supporting documentation. They are useful for architecture, testing, deployment, style, data/API contracts, operations, and onboarding, but they must not become a competing source of truth for implemented behavior or a stored copy of the central Change.

`sdd doctor` may inspect recognized root guidance files in active mapped repositories for deterministic package drift, such as references to retired SDD commands or obsolete managed-workflow locations. It does not require a particular agent-guidance file to exist, interpret arbitrary prose, or enforce project-specific branch, framework, or documentation policy.

Do not require every app to carry the same `docs/` inventory unless project-local guidance says so. Project-local guidance should identify the supporting documents that make current-state, architecture, API, data, deployment, testing, security, or product-routing claims and therefore must be reconciled by apply and review. Existing or locally required docs must stay truthful when implementation changes affect them. Missing docs are findings only when project-local `AGENTS.md`, `docs/README.md`, another app-local guide, or workspace guidance explicitly requires them. When no inventory is declared, inspect the README, changed docs, and documents whose current claims intersect the changed surface; record the ambiguity instead of inventing a universal doc set.

Repository guidance should route affected project-doc updates through the appropriate implementation or documentation workflow. `/sdd-review` should treat stale project docs, or missing locally required docs, as review findings before ready, merge, or closeout.

## Implementation Map Discipline

`Implemented By` should let a new developer reach the governing application logic without rediscovering the subsystem. Map every Requirement to at least one primary repository-relative location after implementation. `primary` means the code that governs the behavior, regardless of whether that code lives in a service, domain module, route, React component, or another layer. When ownership genuinely splits across layers or Scenarios, use multiple primary rows with narrower Requirement/Scenario references instead of inventing one umbrella owner. Add supporting rows for adapters, persistence, presentation, configuration, migrations, and support only when they describe a distinct responsibility.

Prefer a stable symbol, export, route, class, configuration key, or searchable anchor such as `src/path/file.ts#saveJournal` over line numbers. The anchor must identify the definition, registration, or configuration that owns the claimed behavior; an import, call site, incidental handler, broad file token, or symbol listed only because the same file owns another behavior is not sufficient. When a Requirement spans independently governing boundaries such as routing/auth, application policy, persistence, provider/runtime configuration, deployment, or presentation, map each boundary to the narrowest applicable Requirement or Scenario instead of hiding them behind one umbrella primary row.

Each Story has exactly one current `Implemented By` map and one current `Verified By` map. Do not preserve a second `Prior`, `Detailed`, `Legacy`, or migration-era map beside the canonical sections. Consolidate still-current rows into the canonical maps and move genuinely historical explanation into `Story Notes` without retaining a competing answer to where behavior lives.

Do not flatten primary behavior, UI, tests, migrations, package manifests, and support files into an undifferentiated list. A future developer should be able to identify the first code location to inspect and understand why each supporting location participates. A file-level reverse inventory is a discovery aid, not semantic coverage: a file already cited for one symbol does not prove that another behavior-owning symbol in that file is mapped.

Every Requirement must appear in `Implemented By` or `Implementation Gaps`. Keep missing behavior separate from missing proof: implementation gaps say what does not exist; verification gaps say what exists but is not adequately proven.

## Evidence Discipline

`Verified By` should be scenario-mapped. Prefer entries that say which Story/Requirement/Scenario is proved, what test/check/manual path proves it, and what assertion or observation matters. Automated evidence must include a concrete existing repository-relative `path#exact test title or stable named test anchor`; labels such as "backend unit tests", stale bare filenames, fabricated anchors, and framework syntax tokens such as `#it(`, `#test(`, or `#describe(` are not durable evidence indexes. The anchor should identify one inspectable proof rather than merely occur somewhere in a file. Include the important assertion, route, selector, injected failure, or observation in the `Proves` cell. Aggregate several Scenarios only when the named test or parameterized case explicitly exercises each one.

Keep evidence types distinct:

- **Focused automated evidence**: unit, integration, route, Convex, browser, or smoke tests that assert a named Scenario.
- **Broad supporting gates**: lint, typecheck, build, codegen, full CI, migration checks, or broad test commands. These support confidence but do not replace Scenario proof unless the exact Scenario assertion is named.
- **Deterministic E2E evidence**: browser or end-to-end tests with controlled providers, fixtures, seeded data, or stable mocks. This proves integration behavior, not live model quality.
- **Live-provider evidence**: playtests against real models or external services. This is useful empirical evidence but should be recorded separately from deterministic proof.
- **Manual UI confirmation**: user-visible walkthrough evidence. Its status vocabulary is exactly `not applicable`, `pending user`, `user confirmed`, or `accepted gap`.
- **Rendered UI verification**: agent-executed evidence for UI-bearing changes. Render the affected surface, exercise the changed interactions, capture and directly inspect the resulting UI, and inspect relevant console and network failures. Cover representative desktop and mobile viewports plus applicable default, loading, empty, error, populated, long-content, focus, selected, and disabled states. A green build, passing non-visual tests, or generated-but-uninspected screenshots do not satisfy this evidence type.
- **Log or debug evidence**: local logs, persisted debug rows, screenshots, traces, or console output. Use this to support a Scenario only when the inspected artifact is named and repeatable enough for future diagnosis.

Chronological command output is transient unless the Change needs a conditional evidence section; durable scenario-mapped proof belongs in Epic `Verified By`. Technical proof must remain independently inspectable or reproducible after the current session. Interactive, rendered, live-provider, or multi-context evidence therefore needs either a repository-owned deterministic test/stable project artifact or a durable descriptor naming the exact candidate, date, environment or fixture, actors/contexts, route or entry point, actions, assertions or observations, console/network outcome when applicable, and stable artifact path or content hash plus enough non-secret setup to reproduce it. A `/tmp` path, ephemeral browser profile, chat transcript, reviewer summary, screenshot hash without a retained artifact or reproducible procedure, or bare “local observation” phrase is supporting context only and cannot close a required technical boundary. Before claiming E2E, migration, auth, recovery, security, or production-path coverage, inspect the cited source and confirm the relevant route, command, fixture, failure injection, and assertion exist and are discovered by the passing command. Distinguish server-side enforcement from client-side retry, redirect, timeout, draft, navigation, and recovery behavior. If evidence is missing, stale, skipped, undiscovered, live-only, manual-only, boundary-mismatched, or weaker than the Scenario needs, put that in `Verification Gaps` and reopen any contradictory completion claim rather than smoothing it over with a broad command list. Use canonical gap markers after a local Scenario reference: `[required]`, `[optional confidence:<durable-policy-reference>]`, `[manual acceptance]`, or `[user accepted YYYY-MM-DD]`. Central Review uses the corresponding machine values `optional-confidence:<reference>`, `manual-acceptance`, or `user-accepted:YYYY-MM-DD`; unresolved required gaps keep the outcome open. Dated accepted technical gaps must agree between central Review and Epic truth.

## Epic And Story Shape

Epics are capability-sized. A useful Epic might cover browsing a catalog, adding items to a cart, purchasing, creating an order, and notifying fulfillment.

Stories are user-path-sized. Use one primary user path to an action or outcome as the default boundary. A useful Story might be: "As a shopper, I want to find an item by browsing or filtering the catalog, so that I can decide whether to inspect it." Failure, empty, permission, and recovery cases for that path belong in its Scenarios.

Reconsider the boundary when one Story has several actors, independently valuable outcomes, separately releasable workflows, behavior its title no longer predicts, or enough technical surfaces that its implementation map stops being navigable. More than six Requirements or twelve Scenarios is a review signal, not an automatic failure.

Avoid Stories that are just UI details, such as "As a user, I want to click the plus icon." That detail may belong in a Requirement or Scenario if it matters, but it is rarely a Story by itself.

Stories are not immutable. They may be renamed, reordered, split, merged, moved between Epics, or revised as the product understanding improves. For new or normalized Epics, use Epic-scoped Story labels such as `S1`, `S2`, and `S3`; labels must be unique within the Epic, and full references such as `EPIC-ID/S1/R2-S3` are unique because they include the Epic ID. Candidate Stories should not receive a Story label until promoted into the embedded Story set.

Write the Epic Outcome as current product truth. Use present tense for implemented behavior, future tense only for wholly unimplemented behavior, and explicit current-plus-gap wording for partial behavior. Do not leave a fully implemented Epic sounding like a plan.

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

1. `/sdd-change` uses `sdd change create <space-id> <slug>` to create one central v2 `change.md` in `proposed` status as soon as durable intent is captured. Repository ownership may remain empty while proposed.
2. The skill asks whether the user wants to continue into technical planning. If not, the proposed Change remains the backlog record.
3. Technical planning settles repository ownership and observable behavior, expands `change.md`, creates compact `tasks.md` outcomes, and initializes one central `review.md`. Outcomes describe what must become true, not implementation technique. One Requirement is a useful default; several may be coupled when separate delivery would publish an incoherent contract. Material branching technical choices route to `/sdd-adr`.
4. After focused validation, `/sdd-change` transitions the Change to `planned` and returns control. Material experience uncertainty may route next to `/sdd-design --plan`; otherwise `/sdd-apply` is next.
5. Apply selects one ready outcome and follows repository guidance and specialist workflows. Planning-level discoveries return to `/sdd-change`. Candidate mutation stales affected verification and Review.

Use the canonical central dated Change layout:

```text
<workspace>/.sdd/changes/<change-id>/
  change.md        # intent, lifecycle, constraints, accepted approach
  tasks.md         # compact delivery outcomes and Resume checkpoint
  review.md        # outcome and final Change Review authority
  design.md        # optional context retained by an existing Change
```

`change.md` defines the problem, desired outcome, scope, non-goals, success signals, durable constraints, target repositories, affected repository-local Epics, open questions, lifecycle metadata, and—once planning proceeds—the current context, behavior changes, selected technical approach, alternatives, constraints, verification strategy, risks, and applicable experience design.

The technical-planning sections of `change.md` are the high-level solution approach. They explain the chosen approach, important alternatives, risks, dependencies, migration or data implications, repository boundaries, and intended repository-local Epic/Story/Requirement changes. `/sdd-change` hands meaningfully different viable approaches to `/sdd-adr`, then records the returned decision summary and repository-relative ADR path when warranted. For UI-bearing Changes, `Experience Design` is the current accepted experience contract. Existing `design.md` files remain valid source context for their current Changes, but future Changes do not create them.

`tasks.md` is the compact delivery queue for the whole Change. It contains one replaceable `Resume Here` checkpoint, `Delivery Outcomes`, and concise `Closeout` state. Each outcome identifies its repository, new or revised Requirements, Story changes, observable result, authoritative Scenarios, dependencies, binding constraints, expected risk triggers, focused verification intent, and manual acceptance. Add `Consumes` and `Produces` only when another outcome or repository relies on that contract. One Requirement is a useful default; combine Requirements when separate completion would publish an incoherent contract and record a concise coupling justification. Outcomes describe what must be implemented, not files, framework techniques, test architecture, delegation, or an engineered-up-front sequence.

Outcome order is advisory. `/sdd-apply` may select any ready outcome and may resequence or reshape future outcomes when implementation evidence warrants it, while preserving accepted Requirement and Scenario truth. Genuine behavior or scope changes return through `/sdd-change`. `tasks.md` does not own candidate verdicts, gap disposition, commit facts, implementation ledgers, gate ledgers, per-slice Review paths, receipts, or command history.

`Resume Here` contains fixed labels for Change, current outcome, phase, next action, and blocker. Replace stale values rather than adding session history. Candidate, Review, findings, gaps, acceptance, remediation, and final commit/tree belong in one central `review.md`. Durable implementation and verification ownership remains in repository-local Epic maps. `tasks.md` must not become a second technical plan or engineering diary.

Each reviewed outcome executes five universal gates: scope/candidate, behavior, fresh verification, independent Spec Adherence and Implementation Quality review, and integrity/authority. Planning declares expected risk triggers; Review executes them and may add material discovered triggers. Trigger rows name a reason, concrete falsifiable check, result, gap treatment, and evidence. Do not create fixed `not-applicable` manifests. Focused behavior-derived and repository-required verification is the default; broad aggregate suites are triggered by candidate breadth, project policy, integration, or release risk.

Apply records one exact candidate, permits one consolidated remediation batch and one fresh final Review, conditionally reconciles Epic truth, selectively creates one content-identical local commit, records the full SHA and matching tree in central `review.md`, marks the outcome done, and stops. It does not create per-slice Review files, receipts, digests, verification descriptors, duplicate ledgers, or closure-only commits.

### Change Status

Every current active or closed Change `change.md` must begin with complete YAML frontmatter:

```yaml
---
schema: sdd-change-v2
status: proposed
space: product
repositories:
  - product-web
  - product-mobile
---
```

`space` is the stable Space ID. `repositories` lists stable portable repository IDs, not paths, roles, remotes, or display names. It may be empty while the Change is `proposed`; at least one repository is required before `planned`. The metadata is shared by planning, implementation, review, status, validation, PR, release, and closeout workflows.

The stored Change status vocabulary is exactly `proposed`, `planned`, `in_progress`, or `in_review`:

- `proposed`: the central dated Change artifacts are being drafted and may still contain unresolved planning decisions.
- `planned`: the whole Change is coherent, validated, and every targeted repository is ready for implementation to begin.
- `in_progress`: implementation, verification, ordinary remediation, or active plan reconciliation is underway across the targeted repositories.
- `in_review`: every targeted repository has completed its implementation handoff and the whole Change is awaiting or undergoing independent review and closeout gates.

Closure is not a fifth stored status. A Change is closed only when its directory is under `<workspace>/.sdd/changes/closed/<change-id>/`; the moved `change.md` retains `status: in_review`, and location-derived closure takes precedence. Active status values may move backward when reality demands it. A review deficiency may return the Change to `in_progress`; invalidated planning returns it to `proposed` and resumes `/sdd-change`.

Use `sdd change transition <space-id> <change-id> --from <status> --to <status>` when a workflow changes an active Change status. The command updates only the `status` field in central `change.md`. The `proposed -> planned` transition additionally requires repository ownership, the technical-planning sections in `change.md`, and `tasks.md`. A compatible existing `design.md` can satisfy the technical-plan shape for an older Change. It takes no `--repo` flags and performs no repository-local mutation.

`sdd status` reports central Changes once at the workspace level: `activeChanges` contains unique active central records and `recentChanges` contains unique recent central history. Per-repository status entries are filtered projections of those same records by `change.md` `repositories`; they must retain the same workspace-local Change ID and must not be counted, stored, or mutated as independent Changes. Active versus recent/closed classification comes from the central directory location, not from a stored `closed` status.

After contextual review, acceptance, PR/merge, release, and authorization gates applicable to every targeted repository pass, use `sdd change close <space-id> <change-id>`. The command requires central `status: in_review`, takes no `--repo` flags, preflights the one central record, and moves the whole directory once from `<workspace>/.sdd/changes/<change-id>/` to `<workspace>/.sdd/changes/closed/<change-id>/`. It does not decide readiness, merge branches, commit files, release code, or reconcile product truth. Repository-specific gates remain recorded in the one ledger; the Change-wide close must wait until all targeted repositories meet them.

Closeout must reconcile both forward and backward across every targeted repository. Updating the current Story is not sufficient when a Change alters the meaning of earlier Stories, Requirements, Scenarios, `Implemented By`, `Implementation Gaps`, `Verified By`, `Verification Gaps`, repository-specific ledger state, or closed Change records. Before closing, scan all affected repository-local Epics and the related central active and closed Change history for stale assumptions such as "Not implemented yet", "Not verified yet", outdated manual confirmation status, old boundary wording, or accepted gaps that no longer match reality.

Changes may be small or large. Small fixes still deserve enough tracking to keep behavioral truth accurate. Large changes should remain adaptable rather than pretending every implementation phase is knowable up front. Planning describes what must be true; Apply selects one ready outcome, while repository guidance decides how to implement it.

Central Change records are workspace-local workflow state and do not inherit any one repository's branch or documentation-storage policy. Before changing repository-local Epics, ADRs, application code, tests, schemas, configuration, generated artifacts, or runtime behavior, follow the branch, commit, documentation, and authorization policy of each affected repository.

Central storage does not waive validation, target-repository disambiguation, workspace-local ID collision checks, repository guidance, branch policy, or any separate permission required for commits, pushes, merges, deployments, releases, or destructive operations.

When implementation or feedback changes a Requirement, Scenario, constraint, technical approach, or Epic ownership question, return the same `change.md` to `proposed` and resume `/sdd-change`. Update `change.md` and `tasks.md`, plus any compatible existing `design.md`, then restore `planned` only when the revised plan is coherent.

## Deterministic Artifact Validation

Use `sdd validate` as the machine-readable structural baseline for SDD work. It reads dated Changes from the selected workspace's central store and checks facts derivable from workspace files: Change IDs unique across central active and closed locations; current `sdd-change-v2` metadata; required Change files and core sections; valid lifecycle and location-derived closure; compact outcome IDs, fields, references, dependencies, and Resume shape; central Review gate/trigger/Scenario sets; candidate, gap, commit, and tree coherence; Epic template/schema shape; Story Index alignment; Story/Requirement/Scenario identifiers; independent implementation and verification state; canonical implementation/evidence maps; path and anchor validity; explicit gaps; current Epic verification report truth; and optional Git-relative freshness.

Epic verification reports use `schema: sdd-epic-verify-report-v1`. Current gates, findings, and checks must remain separate from historical audit failures. An `aligned` result means every current gate passes or is not applicable, current blocking and required findings are empty, required current checks pass, and the verdict matches the verified source. A later remediation creates a successor report with an explicit repository-relative `supersedes` link; it does not rewrite historical failure into an apparently always-aligned report.

For a done outcome, validation requires one matching central Review section whose committed candidate equals the final commit, five universal gates pass, planned triggers and Scenarios match exactly, gaps are coherent and dated where accepted, the final commit is reachable, and reviewed/final trees are equal. Validation rejects stale candidates, missing gates or trigger/Scenario rows, gap mismatches, unrelated current legacy directories, and technical waivers relabeled as manual acceptance or `none`. It intentionally does not judge semantic sufficiency; independent Review owns that judgment.

A passing validation result does not establish that outcomes are well chosen, product completeness, implementation truth, test strength, manual acceptance, review readiness, or release readiness. Skills remain responsible for those contextual judgments. Schema-less Changes, checklist task shapes, slice Reviews, and closure receipts are unsupported history and are not a second current workflow. New Epics use `schema: sdd-epic-v2`; unversioned legacy Epics remain readable with a compatibility warning until materially edited.

During normalization, do not mechanically copy a legacy `Status` into both new states. Legacy `planned`, `draft`, or `not implemented` normally begins as `Implementation: not implemented` and `Verification: unverified`. Legacy `partial` or `in progress` requires separate inspection of code coverage and evidence. Legacy `implemented` or `complete` may support `Implementation: implemented` only after current code inspection; `Verification` is independently `verified`, `partial`, or `unverified` according to current scenario evidence and gaps.

Structural validation is primarily forward traceability: it checks whether declared artifact references are well formed. SDD workflows must also perform reverse traceability so implementation and tests cannot exist outside the durable Epic map:

- Repository guidance may require changed-surface or traceability checks during implementation and should route them through the appropriate skill.
- `/sdd-review` independently inventories the source-vs-target diff and treats unexplained behavior-bearing files, tests, routes, registrations, or stale supporting truth as review findings.
- `/sdd-epic-verify` inventories the full Epic scope, not only paths already named by the Epic, and cannot report `aligned` when that reverse inventory was skipped.
- `/sdd-orphan-audit` remains the repository-wide maintenance pass for candidates outside a current Change or Epic audit.

The universal inventory is intentionally conservative. It expands path globs, reads the current working tree rather than only the Git index, and separates likely test harness, framework/configuration, and generated files from behavior candidates. These are candidate classifications, not deletion decisions. The reviewing agent must inspect relevant conventions and runtime connections before updating Epic ownership or proposing removal. After refactors, explicitly check for stranded routes, registrations, imports, constructor dependencies, tests, migrations, and files that the old path left behind.

A behavior-preserving refactor still invalidates navigation claims and may invalidate verification confidence. Update code anchors immediately, rerun the focused proof for every affected Requirement/Scenario, and update `last_verified` only from current evidence. Prior evidence may remain current only when its assertion and relevant behavior boundary are unchanged and the check still passes; otherwise downgrade `Verification` or record the explicit gap.

## Candidate-Bound Epic Reconciliation

`/sdd-epic-update` is the independently callable mutation capability that reconciles repository-owned Epic truth to one exact committed or working-tree candidate. It accepts the shared diff envelope with or without an active Change, outcome, or Apply session. Manual behavioral work, behavior-preserving refactors, and traceability-only drift use the same public contract without invented Apply history.

The generic CLI command `sdd candidate resolve <repository-path> --baseline <commit-ish> [--candidate working-tree|<commit-ish>]` resolves refs to immutable SHAs, rejects a committed baseline that is not an ancestor of its candidate, and inventories committed or staged/unstaged/untracked changed paths with a content-sensitive watermark. `sdd epic update-input` preserves that envelope and adds the configured Epic root plus a scoped validation command. Both helpers are read-only and deliberately do not infer affected behavior, release significance, or mutate artifacts; semantic ownership remains with the invoking skill.

Epic Update derives affected behavior from inspected implementation and symbol propagation rather than filenames alone. It mutates only repository-owned Epics and directly owned generated Epic indexes. `Implemented By` comes from actual governing surfaces; `Verified By` changes only when durable candidate-bound evidence directly proves its Requirement or Scenario; missing or weaker proof remains an explicit verification gap. Before success, semantic closure compares each affected Story's index row, body states, implementation/evidence maps, and gap sections so mapped behavior cannot remain described as missing and every partial state has a matching remaining gap. Evidence closure enumerates every affected Scenario and records claimed boundary, cited proof, proven boundary, result, and gap classification. Backend/data, rendered interaction, live multi-context/realtime, provider/production, and manual acceptance are distinct boundaries: a helper result or source inspection does not prove rendered feedback/focus, a direct backend confirmation flag does not prove a user's confirmation/cancellation interaction, and a later query does not prove an active subscription. Required technical gaps remain blocking unless project policy makes them optional or the user explicitly accepts the named gap with a date. Deterministic validation is necessary but does not replace either check. A same-candidate second invocation should normally return `no-op`.

Behavioral change or disputed intent routes to `/sdd-change`, branching durable tradeoffs route to `/sdd-adr`, missing implementation or proof routes to implementation/verification work, and full-Epic coherence uncertainty routes to `/sdd-epic-verify`. Epic Update stops before code review, code fixes, Change/task/review mutation, lifecycle transitions, changelog work, commits, PRs, releases, deployment, or closeout. It returns `complete`, `no-op`, `needs-user`, `blocked`, or `routed`, along with affected Epic references, artifacts written, validation results, candidate watermarks, stale downstream gates, and the recommended next workflow.

## Candidate-Bound Changelog Entries

`/sdd-changelog` is the independently callable mutation capability that creates or updates the release communication owned by one completed Change or clearly scoped manual candidate. It accepts the same exact committed or working-tree diff envelope without requiring Apply history. It requires current Review evidence and, whenever behavior, ownership, or durable proof changed, a current `/sdd-epic-update` result or evidence-based `no-op`.

The capability reads project guidance and native records to resolve whether the repository uses Keep a Changelog, changesets, generated provider notes, another release record, or intentionally no per-change record. This policy remains project-owned rather than a repository-schema path because release systems may be files, directories, generators, or provider workflows. Changelog classifies the reviewed result as user-visible, operator-relevant, internal-only, or speculative/unverified. It returns `no-op` for internal-only work the project does not record, generated/no-record policies, duplicate accurate entries, and bookkeeping-only candidates.

When an entry is warranted, Changelog writes exactly one native unreleased or per-change entry in product language. It never versions or dates an unreleased section, edits released history, claims deployment or availability, or copies private SDD bookkeeping. It re-resolves the candidate with `sdd candidate resolve`, proves that only authorized release-record paths changed and that the non-changelog implementation projection is unchanged, runs native record validation, and normally returns `no-op` on a same-candidate second invocation. The expected changelog-only repository watermark does not invalidate Review or Epic Update when this projection is proved.

Changelog stops before implementation, code review, Epic/Change mutation, version selection, staging, commits, PRs, release, or deployment. It returns `complete`, `no-op`, `needs-user`, `blocked`, or `routed`. `/sdd-release` remains the owner of release-wide aggregation, version recommendation and confirmation, promotion of unreleased records, and production handoff.

`/sdd-change` validates a planned or revised Change before handoff. `/sdd-apply` reads the selected Change and outcome, follows repository-defined checks, and requires fresh candidate-bound verification before it can report that outcome complete. `/sdd-review` treats scoped validation and Apply evidence as inputs to—not substitutes for—its independent diff and truth review. `/sdd-epic-verify` begins with scoped Epic validation before auditing completeness, implementation, and evidence quality.

## Implementation And Review

`/sdd-apply` selects one ready or explicitly requested outcome. It does not consume the full Change. A completed outcome defaults to deterministic central Review/commit/tree audit; renewed semantic discovery requires an explicit deep re-review.

Before implementation, Apply reads applicable workspace and repository guidance. Those sources own development method, specialist skills, test architecture, documentation, generated artifacts, delegation, isolation, commit style, and branch policy. Apply states only the behavioral brief: outcome, Requirements, Story changes, Scenarios, dependencies, constraints, contracts, verification intent, manual acceptance, repository, and branch result. A transient proof sketch may guide the session but is not another durable artifact.

Apply records the exact baseline and dirty state, preserves unrelated work, and stops when attribution is unsafe. It moves a planned Change to `in_progress`, marks only the selected outcome `in progress`, implements under project guidance, and runs fresh proportional verification on the exact candidate. Focused behavior-derived and repository-required checks are the default. Broad suites are added only when repository policy, candidate breadth, integration, or release risk triggers them. Candidate mutation stales affected evidence.

Apply then composes independent `/sdd-review` for the exact candidate. Review records five universal gates in the one central `review.md`: scope/candidate, behavior, fresh verification, independent Spec and Quality judgment, and integrity/authority. It executes every planned trigger and may add material discovered triggers, each with a concrete check, result, gap treatment, and evidence. Every declared Scenario receives one same-boundary coverage row. Fixed `not-applicable` manifests are not used.

When Review returns required findings grounded in accepted behavior, material safety, project policy, false closure, or deterministic contract failure, Apply may perform one consolidated safe remediation batch, rerun affected proof, and request one fresh comprehensive final Review. It does not enter an unlimited review/fix loop.

Epic reconciliation runs immediately when accepted behavior, Story completion, or a contract/gap consumed by another outcome changes, or when current maps became false. Otherwise it waits for Change completion. Any Epic mutation changes the candidate and requires fresh affected verification and Review.

After the final candidate is ready, Apply selectively stages only outcome-owned paths, creates one normal local commit, and proves the commit tree equals the reviewed staged tree. It records the immutable commit SHA and matching tree in central `review.md`, marks the outcome done in `tasks.md`, refreshes Resume/Closeout, validates the Change, and stops. It does not create per-slice Reviews, receipts, digests, verification descriptors, duplicate ledgers, or reseal commits. Another outcome requires another Apply invocation.

Apply returns `complete`, `no-op`, `needs-user`, `blocked`, or `routed`. Its standing commit authority covers only the selected outcome's reviewed local repository commit. It does not authorize broad staging, central workspace files, push, amend, rebase, merge, PR, release, deployment, destructive action, or another repository.

`/sdd-review` remains independently callable for direct candidates, active outcomes, completed-outcome seal audits, explicit deep re-review, and final Change-wide integration readiness. It returns `ready`, `changes-requested`, or `blocked`, with separate Spec Adherence and Implementation Quality results. Required manual acceptance may remain `pending user` while technical Review is ready, but acceptance-dependent integration or closeout remains blocked.

Status transitions accompany the work that justifies them: Change creates `proposed` and plans `planned`; Apply enters `in_progress`; outcome Review does not change lifecycle; final Change Review may enter `in_review` or route deficiencies back to implementation/planning. Every transition acts once on the workspace-central record.

## Branching

Each application repo owns its branch policy in its local `AGENTS.md`. Read it before creating branches, choosing merge targets, opening PRs, running reviews, or planning implementation.

SDD does not prescribe branch names, branch count, integration topology, PR usage, merge strategy, or release target. Skills must resolve those facts from project guidance and stop before branch, PR, merge, closeout, or release mutations when the policy is missing or ambiguous. SDD does require the review surface and Change status to identify the actual source, target, and reviewed commit precisely enough that later changes cannot silently invalidate readiness.

## Definition Of Done For A Story

A Story is ready for handoff only when:

- It describes the current user path and observable outcome.
- Its independent implementation and verification states use the canonical vocabulary and match the Story Index.
- Requirements and Scenarios match implemented behavior or clearly identify known gaps.
- Every Requirement has a primary `Implemented By` location with a stable anchor or an explicit `Implementation Gap`.
- `Verified By` contains scenario-mapped concrete evidence tied to Requirements or Scenarios.
- New or high-risk automated evidence names an exact test title or stable test anchor plus the important assertion or observation, is discovered by the passing command, and does not aggregate Scenarios the proof does not exercise.
- Triggered Pattern Parity, Boundary Contract, and Stateful Transition Matrix rows are proved, explicitly accepted, blocking, or not applicable with an inspected reason.
- Capability authority, content-budget/provenance conservation, and pre-mutation filesystem confinement are proved when those boundaries apply.
- `Verification Gaps` contains only real remaining gaps.
- Evidence type is clear enough to distinguish deterministic tests, broad gates, live-provider playtests, manual confirmation, and debug/log inspection.
- Production-path and mock-boundary risks have proof or explicit gaps.
- Required rendered UI verification is complete, not applicable with a reason, or recorded as a blocking or explicitly dated user-accepted gap.
- Required live multi-context/realtime, provider/production, and other non-manual evidence is complete, policy-optional, or explicitly accepted by the user with a date; it is never relabeled as manual acceptance merely because a person must trigger or observe it.
- Manual UI confirmation is complete, not applicable, pending user, or recorded as an accepted gap.
- The central active Change's `tasks.md` does not contradict any targeted repository's Epic truth, review state, release-communication state, PR/merge state, the central location-derived lifecycle, or accepted deferred gaps.

## Definition Of Done For An Epic

An Epic is healthy only when:

- Its outcome and current scope match what the embedded Stories actually provide.
- Stories are in a logical order and remain appropriately scoped.
- Story labels are unique within each Epic, and full Story references remain traceable. Historical app-wide Story IDs remain unique across active Epics unless a documented migration is resolving a duplicate.
- Requirements and Scenarios are concrete enough to guide implementation and verification.
- `Implemented By`, `Implementation Gaps`, `Verified By`, and `Verification Gaps` are current enough that a future developer can start investigation from the Epic instead of rediscovering the relevant code.
- Every Story has one authoritative current implementation map and one authoritative current verification map; historical maps do not compete with them.
- Primary anchors resolve to the definitions or registrations that govern the claimed behavior, and distinct governing boundaries are mapped at Requirement or Scenario granularity.
- Automated evidence uses an exact test title or stable named test anchor rather than a generic framework token, and the cited proof actually asserts the mapped Scenario.
- Related central active or closed Changes do not contradict Epic truth.
- Earlier Stories are reconciled when later Stories supersede their assumptions.
- Closed central Change artifacts do not still claim accepted work is unimplemented, unverified, pending, or located at `<workspace>/.sdd/changes/<change-id>/` unless that language is explicitly historical and non-authoritative.
- Any maintained generated indexes are current and do not point to missing evidence.
- Deferred scope and open decisions remain accurate.

## Anti-Patterns

Avoid:

- Creating a new Story to avoid fixing a stale existing Story.
- Allowing implemented behavior to live only in code, chat, a stale report, or a private memory instead of the relevant Epic/Story.
- Treating `change.md`, `tasks.md`, or a compatible existing `design.md` as more authoritative than implementation reality or Epic truth.
- Turning Stories into tiny UI control requirements.
- Hiding product scope expansion inside technical design or implementation tasks.
- Recording only generic command logs in `Verified By`.
- Treating `Implemented By` as an undifferentiated file dump without Requirement ownership, primary entry points, or stable anchors.
- Keeping `Prior`, `Detailed`, or `Legacy` implementation/evidence maps beside the canonical Story maps.
- Treating an import, call site, generic syntax token, incidental UI handler, or a file cited for another symbol as proof of governing ownership.
- Using one Story status to blur implementation completeness, verification confidence, and active Change work.
- Recording unimplemented behavior under `Verification Gaps` instead of `Implementation Gaps`.
- Treating broad gates as a substitute for Scenario-specific evidence.
- Claiming E2E, security, recovery, or production-path coverage without opening the cited proof and confirming its exact assertion, discovery path, and implementation boundary.
- Adding a sibling adapter, client, route, workspace, worker, migration, or command without comparing its safety, recovery, navigation, state, configuration, and focused-test contract with the closest established implementation.
- Collapsing typed domain failures into one generic adapter, transport, plugin, or client result without proving preserved status, retryability, and recovery behavior.
- Verifying only static states for editable, autosaving, cached, routed, asynchronous, durable, or identity-sensitive behavior while leaving concurrency, cancellation, stale completion, remount, restart, unknown-client identifiers, session expiry, or hung requests unproved.
- Accepting a capability identifier outside the authority that issued it, bypassing a declared content budget or provenance path, or mutating filesystem descendants before validating existing ancestors and confinement.
- Blurring deterministic E2E, live-provider playtests, manual confirmation, and debug/log evidence into one undifferentiated "verified" bucket.
- Treating fake-backed tests as full production-path proof when the real boundary is risky.
- Hand-maintaining generated indexes.
- Leaving completed `change.md`, `tasks.md`, compatible existing `design.md`, or review records with stale "Not implemented yet", "Not verified yet", old manual status vocabulary, or superseded boundary wording.
- Creating or keeping a dated Change anywhere except `<workspace>/.sdd/changes/<change-id>/` or `<workspace>/.sdd/changes/closed/<change-id>/`, including beside its undated Brief or inside a repository.
- Giving one Change repository-specific IDs or stored copies instead of one workspace-unique ID and one central multi-repository ledger.
- Treating a per-repository status or validation projection as an independently mutable Change owner.
- Applying, reviewing, transitioning, or closing an idea-planned or repository-local legacy Change in place instead of recreating or manually converting worthwhile intent into the current central store.
- Using repository filters with `sdd change transition` or `sdd change close`, or advancing the Change-wide lifecycle before every targeted repository has met the gate.
- Closing or merging a Change while Epic truth, central tasks, repository-specific review/release/PR/merge state, or manual confirmation status remains contradictory.

## Shared Context Gathering

Before `/sdd-explore`, `/sdd-adr`, or `/sdd-change` makes substantive claims, it invokes `/sdd-gather-context` in the same session with an action and focused question. The shared skill owns the minimum-read policy across planning direction, governing decisions, accepted behavior, current implementation/tests, and repository state. It reuses current reads, opens missing evidence, surfaces authority/freshness conflicts and gaps, and returns an evidence-linked sufficiency result without creating an artifact or taking over the caller's judgment.

The minimum is action-shaped rather than repository-wide. Exploration emphasizes prior discussion and relevant planning; ADR work emphasizes governing decisions and the affected technical seam; Change work emphasizes accepted intent and behavior, overlapping work, implementation, tests, contracts, and Git state. The caller deepens only where the shared result leaves a material gap.

## Skill Workflow

Use the skills to apply this doctrine consistently:

| Skill | Purpose |
|---|---|
| `/sdd-gather-context` | Read and reconcile the minimum evidence required for an exploration, ADR, or Change in the caller's current session; create no artifact and make no parent-workflow decision. |
| `/sdd-prd` | Create or revise the private Product Brief/PRD that guides product scope, audience, principles, market context, monetization, and open product questions. |
| `/sdd-explore` | Preserve any substantial discussion the user wants to survive chat as one synthesized durable record. Choose its destination deliberately—usually the owning idea's `explorations/`, or workspace `.sdd/explorations/` when no one idea owns it—and return a routed handoff to `/sdd-prd`, `/sdd-change`, `/sdd-adr`, or another owner when conclusions mature. |
| `/sdd-adr` | Compare real viable technical approaches, obtain user confirmation, and create or update an ADR only for consequential decisions whose tradeoff context future work must preserve. Return an explicit result and stop before caller-owned planning or implementation. |
| `/sdd-change` | Create or resume one central v2 Change, capture intent, and optionally plan coherent observable outcomes plus pending central Review. Return `complete`, `no-op`, `needs-user`, `blocked`, or `routed`, and stop before implementation. |
| `/sdd-design` | After Change reaches `planned`, confirm initial experience readiness; or revise one exact `in_progress`/`in_review` implementation candidate within accepted behavior. Return `complete`, `no-op`, `needs-user`, `blocked`, or `routed`, and stop before application/component-preview edits or downstream workflow mutations. |
| `/sdd-interactive` | Capture a lightweight Change with the same three v2 records and compose exactly one public Apply outcome; do not create an Interactive-only workflow. |
| `/sdd-apply` | Deliver one ready or explicitly requested outcome, follow repository implementation guidance, run focused proof, compose independent central Review and conditional Epic reconciliation, seal one reviewed local commit, record its SHA/tree, and stop. |
| `/sdd-review` | Independently review an exact candidate or outcome with five universal gates and concrete triggered checks in central `review.md`; final mode owns Change-wide integration readiness. |
| `/sdd-epic-update` | Directly or Apply-composed, reconcile repository-owned Epic/Story behavior, implementation maps, gaps, and verification maps to one exact candidate; stop before code review, implementation, lifecycle changes, changelog work, or commits. |
| `/sdd-changelog` | Create or update one reviewed candidate's native user/operator release entry, or return an evidence-based `no-op`; stop before versioning, staging, commits, PRs, release, or deployment. |
| `/sdd-epic-verify` | Audit an Epic end to end against current implementation, tests, evidence, Change status, and Story/Requirement/Scenario quality. |
| `/sdd-space-status` | Produce a read-only re-entry brief for returning to an app after time away. |
| `/sdd-code-audit` | Audit repository or subsystem health through independent specialist review and synthesize validated findings into candidate improvements. |
| `/sdd-orphan-audit` | Find likely orphaned code/tests and SDD traceability gaps conservatively. |
| `/sdd-release` | Prepare the project-defined production release handoff, including release checks, changelog review, version recommendation and confirmation, and required release communication. |
| `/sdd-pr` | Steward an existing or non-production SDD-backed PR through comments, checks, accepted fixes, and final merge handoff. |
Do not create separate compatibility-wrapper skills for older command names. Canonical new work should use the current `/sdd-*` skill names directly.

## Skill Enforcement Boundary

This document defines the durable doctrine for Story-Driven Development. Skills operationalize the doctrine for specific workflows.

Keep SDD skills focused on workflow procedure: what to read, what decisions to make, what artifacts to update, what verification to run, and what to report. Put portable SDD semantics, the default idea-to-repository relationship, fixed workspace-central Change storage, workspace-local Change identity, projection semantics, and canonical repository-local Epic/ADR ownership in this doctrine. Put private relationships in `<workspace>/.sdd/config.yaml`, the one central dated Change record under `<workspace>/.sdd/changes/`, portable repository facts in `<repository>/.sdd/config.yaml`, and technology, branch, command, release, and reporting preferences in project guidance instead of repeating them in skills or treating them as SDD requirements.

Skills must resolve every dated Change through the selected workspace's central store and mutate its lifecycle once. Repository selection may filter implementation, validation, review, PR, or release work, but it must not create a repository-local Change or reinterpret a projection as authority. `sdd change transition` and `sdd change close` are repository-free, workspace-scoped single-record operations. Schema-less, idea-planned, repository-local, and receipt-based Change formats are unsupported history; current workflows neither migrate them nor treat them as live. `sdd update` reconciles only current managed doctrine and skills.

Put project-specific branch, merge, release, deployment, and repository rules in the app repo's local `AGENTS.md` or equivalent project guidance. SDD skills should read and enforce those rules, falling back to documented workspace guidance when local policy is absent, instead of restating a branch model inside each workflow.

Portable defaults are behavioral and authority boundaries, not one prescribed engineering method. Keep Epic/Story truth, candidate freshness, proportional proof, independent Review, gap honesty, manual-acceptance separation, selective commit integrity, and explicit handoff authority in this doctrine. Repository guidance and specialist workflows own TDD/BDD use, architecture, test design, delegation, and technology-specific procedure.

Skill-assisted implementation is guidance-driven. `/sdd-apply` reads applicable workspace and repository `AGENTS.md` files, which decide specialist skills, development method, verification, documentation, delegation, isolation, commit message, and branch policy for the selected outcome. Apply owns exact baseline/candidate tracking, fresh proportional verification, independent central Review, conditional Epic reconciliation, one content-identical local outcome commit, and its terminal result. Review and Epic Update remain independently callable; composition does not create private variants.

Current documentation is capability-driven as well. When exploration, planning, implementation, or debugging depends on version-sensitive library, framework, SDK, API, CLI, or cloud-platform behavior, prefer an available current-documentation provider such as Context7 over model memory. Scope lookups to the exact concept and installed version when known. No named provider is required; use primary vendor documentation when one is unavailable.

Design tooling is also capability-driven. `/sdd-design` may use installed visual-review, browser, prototyping, design-system, component-preview, screenshot, measurement, image, or accessibility capabilities, but portable SDD must not require Stitch, Penpot, Storybook, Playwright, Figma, a runnable prototype, or any other named product. For revisions, Design resolves one exact baseline/candidate envelope per affected repository with `sdd candidate resolve`, prefers equivalent states, fixtures, viewports, and component crops, and records one replaceable preserve/change/non-goal handoff rather than a chronological design diary. Stable references to selected external artifacts belong in the Change; prototypes and screenshots remain optional design evidence rather than behavioral or implementation truth. When implementation must change, Design reopens every affected outcome, preserves dependency order for Apply selection, makes downstream candidate-sensitive claims stale, and recommends a separately invoked Apply. When the candidate already satisfies the corrected contract, it recommends a fresh Review without fabricating implementation work. Epic Update and Changelog remain separate candidate-bound capabilities. For UI-bearing Changes, design planning defines representative surfaces, viewports, states, interactions, and expected rendered behavior; repository guidance decides how implementation verifies them, and `/sdd-review` independently checks the implemented experience.

Shared component and pattern catalogs are optional incubators rather than mandatory dependencies. When a project uses one, design work should classify material components as existing application components, adopted references, application-specific components, reference candidates, or deliberate divergences. Adopted references follow the consuming project's ownership model. Consumer evidence means implemented use outside the catalog artifact itself; project guidance decides how much use justifies promotion or a standardized claim. Required component-state evidence may come from a component preview, rendered route or fixture, browser evidence, or a manual walkthrough. Foundation-first work should not block an application unless the accepted Change explicitly requires it.

If this document and a skill disagree, update the skill or this document so they align rather than treating the disagreement as acceptable drift.

Do not duplicate full canonical templates here. Templates belong in the relevant skill assets.
