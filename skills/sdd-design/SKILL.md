---
name: sdd-design
description: Plan or revise experience-design readiness for a UI-bearing SDD Change. Use `/sdd-design --plan` after Change planning to converge unresolved flow, responsive, component/state, accessibility, or visual direction before implementation, and `/sdd-design --revise` when candidate-bound implementation, review, comparison, or manual feedback shows that an accepted experience needs another pass without changing behavior. Uses optional design and evidence tools, records the current approved direction and exact implementation handoff in existing Change artifacts, returns a composable result, and stops before application or Storybook source edits.
---

# SDD Design

Turn accepted behavior into an approved, implementation-ready experience direction. Keep design work connected to SDD truth without making prototypes or visual tools the source of behavioral truth.

## Boundary

This is an optional design-readiness workflow for Changes with meaningful user-interface or interaction uncertainty.

- `/sdd-explore` owns open-ended visual or product exploration before a Change is ready.
- `/sdd-change` owns scope, Stories, Requirements, Scenarios, and high-level technical planning.
- `/sdd-design --plan` owns initial experience convergence: flow, information architecture, responsive composition, component and state contracts, accessibility, and selected visual direction.
- `/sdd-design --revise` owns post-implementation experience revision when accepted behavior remains stable.
- `/sdd-apply` owns application code, production components, Storybook stories, and implementation evidence.
- `/sdd-review` independently checks the implemented experience against accepted behavior and the confirmed design direction.

Do not add a Change status, `design.md`, or `ui-design.md` for future Changes. Record the current accepted experience contract in `change.md` and keep `tasks.md` as replaceable resume and handoff state, plus app-level visual identity docs when the decision is broader than one Change. If an older Change already has `design.md`, continue using its existing `Experience Design` section rather than splitting that record across two current locations.

## Modes

Use exactly one mode:

- `--plan`: converge the initial experience direction before implementation.
- `--revise`: revise an implemented or partially implemented experience after comparison, review, or manual feedback without changing accepted behavior.

When no flag is supplied, infer the mode only when the Change state and request make it unambiguous. Ask when choosing initial convergence versus post-implementation revision would change status handling or artifact history.

## Resolve Authority

1. Resolve the workspace, owning Space, one central Change, and every relevant target repository ID from explicit user input or `sdd context <relevant-path> --json`. Retain the resolved workspace root and pass `--workspace <workspace-root>` to subsequent SDD commands whenever the target repository is external to the workspace or the command's current directory is not inside that workspace.
2. Read the `workflowPath` returned by `sdd context` completely. If workspace setup is missing, direct the user to `sdd setup [workspace-path]`; if a target repository contract is missing, direct them to `sdd init` there. Use `sdd doctor` for an existing but unhealthy installation.
3. Require one selected central open Change at `<workspace>/.sdd/changes/<change-id>/`, where the flat Change ID is unique within that workspace. Read `change.md` frontmatter, require `space` to match the resolved Space and `repositories` to contain stable portable target repository IDs, and verify status through `sdd status <space-id> --workspace <workspace-root> --json`. `--plan` requires `planned`; `--revise` requires `in_progress` or `in_review`. Return `routed` to `/sdd-change` for `proposed` rather than filling planning gaps inside Design.
4. Resolve repository paths from those IDs for repository-local implementation, visual identity, prototype, Storybook, Epic, ADR, and design-evidence context. Never create or use a repository-local Change copy.
5. Ask when one Space maps to multiple plausible Changes, or when the Change's target repository IDs do not resolve unambiguously.
6. Treat a Change under `<workspace>/.sdd/changes/closed/<change-id>/` as history. Create or select a follow-up Change instead of rewriting closed intent.

This skill does not start implementation, replan behavior, review, close, merge, or release a Change.

- `--plan` requires and preserves central `planned` status. Change owns the `proposed -> planned` transition before the separately invoked Design pass.
- `--revise` requires central `in_progress` or `in_review` status and an explicit user request, review finding, or recorded manual feedback identifying the concern and affected repository candidates.
- Keep an `in_review` Change in review while auditing, comparing, classifying feedback, and converging with the user. Do not transition it merely because `--revise` was invoked.
- After feedback is confirmed as an experience revision within accepted behavior and the user confirms the revised direction, run `sdd change transition <space-id> <change-id> --from in_review --to in_progress --workspace <workspace-root>` immediately before editing central Change artifacts. This repo-free compare-and-set mutates the one ledger once; never transition repository targets independently. Stop and refresh context if it fails.
- Route behavioral discovery from `in_review` directly to `/sdd-change` without first transitioning it to `in_progress`.
- A central `in_progress` Change already has the correct status for `--revise`; do not perform a no-op transition.
- A `proposed` Change returns `routed` to `/sdd-change`.
- A closed Change is never revised in place.

## Required Context

Read only the context that can materially change the design:

- central `change.md` and `tasks.md`, plus an existing `design.md` when this Change already has one
- affected repository-local Epic/Story/Requirement/Scenario definitions, grouped by target repository ID
- Product Brief, PRD, or relevant exploration conclusions
- repository-local visual identity, project design guidance, and optional shared foundations
- current routes, components, styles, screenshots, and Storybook in each affected target repository when implementation already exists
- existing prototype links, design-system assets, prior user decisions, and repository-local design evidence
- accessibility, platform, framework, and client constraints relevant to each affected repository experience
- for `--revise`, the originating feedback or review finding IDs and one exact baseline/candidate diff envelope per affected repository

For `--revise`, resolve each envelope with `sdd candidate resolve <repository-path> --baseline <commit-ish> --candidate <working-tree-or-commit-ish> --workspace <workspace-root> --json`. Take the baseline from explicit input, the Apply checkpoint, or the Review result; never guess it. Return `needs-user` when a required baseline, candidate, or finding scope is ambiguous. Inspect current implementation before proposing replacement patterns. Project identity and usability needs override shared visual defaults.

## Design Readiness Workflow

### 1. Establish The Behavioral Anchor

Summarize the user outcome, in-scope Stories, observable Requirements, relevant Scenarios, non-goals, current clients, and known constraints. Do not reinterpret accepted behavior through a visual preference.

If the Change lacks enough behavioral clarity to design honestly, return `routed` to `/sdd-change` instead of filling gaps with assumptions.

### 2. Audit The Existing Experience

Identify what should be retained, reconciled, or replaced:

- current user flow and navigation
- information hierarchy and primary work surface
- reusable versus app-specific components
- desktop, mobile, touch, and alternate-client behavior
- loading, empty, error, disabled, selected, permission, recovery, and destructive states
- keyboard, focus, screen-reader, contrast, motion, and content constraints
- visual identity and design-system alignment

For each materially affected component or pattern, classify the intended strategy:

- `existing application component`: retain or extend an application-owned component
- `adopted reference`: adopt an existing project or shared reference using the consuming project's ownership model
- `application-specific`: create or retain a component whose behavior belongs to this application
- `reference candidate`: record a possible reusable reference without claiming standardization
- `deliberate divergence`: depart from an existing reference for product-specific reasons

This classification prevents accidental duplication and premature centralization. It does not require a shared catalog, a cross-repository change, or a divergence rationale when the product need is already clear.

Use screenshots or browser inspection when visual claims depend on rendered reality. Do not judge a running interface from source alone when direct inspection is practical.

For `--revise`, establish a fair comparison surface before diagnosing the target. Prefer equivalent production-component states, fixtures, viewport dimensions, and component crops. Record which implementation is the reference and which is the target; do not imply that cross-application consistency requires shared runtime components or identical product semantics.

### 3. Diagnose The Revision Delta

In `--revise` mode:

1. Confirm the exact candidate envelope and originating feedback or finding IDs for every affected repository.
2. Classify the feedback as `experience refinement`, `experience defect`, `accessibility correction`, `responsive correction`, or `behavioral discovery`.
3. Identify the stable reference: an accepted existing implementation, Storybook story, browser route, prototype, screenshot, design-system artifact, or explicit user direction.
4. Record what the target must **preserve**, **change**, and treat as an explicit **non-goal**.
5. Use rendered comparison and measurable evidence when practical: component geometry, hierarchy, wrapping, overflow, focus, contrast, states, and responsive behavior.
6. Preserve target-specific behavior and semantics even when another application is the visual reference.

If the diagnosis is `behavioral discovery`, stop revision finalization and use the routing rules below. Leave an `in_review` Change in review until the owning replanning workflow performs the justified transition.

### 4. Resolve Material Questions

Ask one consequential question at a time when user judgment is needed. Concentrate on choices that affect workflow, comprehension, responsive behavior, accessibility, identity, or implementation scope.

Compare two or more credible directions when the choice is non-trivial. One direction is sufficient when existing product conventions or accepted prototypes make the answer obvious; state why.

Do not ask the user to choose incidental CSS values the design system already resolves. Do not silently choose a product behavior because it makes a composition easier.

### 5. Use Available Design Capabilities

Inspect the skills and tools available in the current runtime and use the smallest materially useful set. Possible capabilities include UI/UX review, prompt enhancement, image generation, browser inspection, Stitch, Penpot, screenshots, or other prototyping systems. None is required.

- Use divergent visual generation for meaningfully different concepts, not cosmetic permutations.
- Use precision design tools when component geometry, reusable patterns, or interaction detail needs refinement.
- Use existing Storybook or equivalent component previews as implementation references and controlled comparison surfaces; do not edit preview or application source from this skill.
- Treat configured shared component or pattern catalogs as optional incubators, not mandatory gates. A broadly reusable presentation pattern may begin there when multiple consumers are plausible; domain-specific components normally begin in the owning application. Do not make foundation-first work block the application unless the accepted Change explicitly chooses that dependency.
- Use browser automation or screenshot tooling for repeatable crops, viewports, interaction states, and computed measurements when available. Automated measurements inform design judgment but do not decide whether two products should be visually identical.
- Follow every selected tool skill's confirmation, external-mutation, and asset-handling rules.
- Never apply a design system to existing remote screens or overwrite a user's prototype without explicit authorization.
- Record stable project, file, asset, screen, or prototype identifiers for selected references. Do not identify the approved direction only as “the latest screen.”

If no design tooling is installed, produce a clear text, ASCII, or Markdown experience contract and continue. Missing optional tools are not blockers.

### 6. Define The Visual Verification Matrix

For every UI-bearing Change, define the smallest representative matrix that lets implementation and review detect obvious rendered regressions. Record:

- affected surface and route, fixture, preview, or setup entry point
- representative desktop and mobile viewports
- applicable default, loading, empty, error, populated, long-content, focus, selected, disabled, permission, and recovery states
- changed interactions to exercise
- expected rendered behavior and important accessibility observations
- preferred project-owned browser, screenshot, preview, or fixture command, plus the best portable fallback when that capability is unavailable

Keep the matrix proportional to the changed experience. Do not demand every state when the Change cannot affect it. The matrix is an implementation and review plan, not proof that rendering already passes.

### 7. Converge With The User

Present the strongest direction, meaningful alternatives, and tradeoffs. Refine until the user confirms a direction. The user may explicitly accept an unresolved gap only when it is non-blocking, safely deferrable, and recorded with its implementation or verification consequence.

Confirmation applies to the experience direction, not to implementation details that remain safely reversible. Do not claim design readiness while a material user-flow, responsive, state, accessibility, or visual-identity decision remains unresolved; route that decision through the appropriate planning workflow instead of classifying it as an accepted gap.

For an `in_review` Change, perform the guarded repo-free `in_review -> in_progress` transition only after this classification and confirmation pass succeeds, and immediately before recording the revised contract in the central Change.

### 8. Record The Experience Contract

Create or update one `## Experience Design` section in the central Change's `change.md`. It is the canonical current accepted experience contract, not the revision history. Keep it proportional to the Change and use the canonical section in the installed `/sdd-change` `assets/planning-sections.md` when available. For an older Change that already has `design.md`, update the existing `Experience Design` section there instead and do not create a competing section in `change.md`. Record the confirmed direction, user confirmation, stable reference artifacts, user flow and information architecture, responsive composition, component and state contract, material component strategies, accessibility and interaction behavior, visual direction, and open design questions.

Reference Requirements and Scenarios where the design contract clarifies how accepted behavior appears. Qualify repository-local artifacts and evidence with their stable target repository ID. Do not restate every Requirement or turn visual details into Stories.

Update `tasks.md` only as needed to preserve current cold-resume state:

- selected direction and stable reference IDs, qualified by target repository ID where the artifact is repository-local
- material component strategies, initial repository-local ownership, and required preview states
- user-confirmation result
- unresolved design blockers or accepted gaps
- expected `/sdd-apply` starting point and responsible target repository ID for each repository-specific slice
- repository-local Storybook states, screenshots, prototypes, or manual UI checks the implementation should create
- the Visual Verification Matrix covering affected repositories, surfaces, viewports, states, interactions, expected observations, and preferred tooling or fallback
- the fixed `Resume Here` phase, current slice, repository envelopes, downstream candidate freshness, acceptance state, and open finding or blocker

Initial `--plan` does not change slice or Implementation Ledger status. For `--revise`, update `Experience Design` to the newly confirmed current contract and keep one replaceable `Design Revision Context` block in `tasks.md`: originating feedback/finding IDs, repository and exact candidate envelope, reference, preserve/change/non-goal delta, user confirmation, and exact restart point. Replace stale revision context instead of accumulating a design diary.

When repository implementation must change, reopen every affected `done` slice coherently: set each to `ready`, set its matching Implementation Ledger row to `not started` with a concise `Revision pending for existing <surface>` summary, preserve the dependency graph, and name the first affected slice whose dependencies are complete in `Resume Here`. A later affected slice may remain `ready` while waiting on an earlier affected dependency; Apply's dependency check prevents premature selection and the slice becomes actionable when that dependency is done. Do not leave affected downstream slices `done`, because Apply would skip required revision work. Set `Closure receipt: required` on each reopened slice, remove any stale `slice-reviews/<slice-id>.md` Review and `slice-closures/<slice-id>.yaml` receipt, and mark prior verification, Review, Epic Update, Changelog, and acceptance candidates pending or stale as their candidate-sensitive claims require; stale closure artifacts for a reopened candidate are invalid state, not history. If the corrected contract already matches the repository candidate and only central design truth changed, do not fabricate an Apply slice; recommend fresh `/sdd-review`. If the revision cannot map cleanly to existing slices without changing behavior, ownership, or acceptance, return `routed` to `/sdd-change`.

Keep implementation and rendered-design evidence in the repository that owns it, and link or identify that evidence from the central record instead of copying it into another Change location.

When a decision changes app-wide identity rather than only this Change, update or propose the owning repository's resolved visual-identity document with user authorization and link it from the Change's current `Experience Design` section. After any authorized repository-local design-document mutation in `--revise`, rerun `sdd candidate resolve` for that repository, inspect that only the authorized design-doc surface joined the candidate, refresh its `Resume Here` envelope, and recalculate downstream freshness from the new watermark before reporting a result. Keep reusable cross-app foundations optional unless the user explicitly adopts a proven pattern as shared.

## Behavioral Discovery

Design work often exposes missing or changed behavior. Classify it before editing SDD truth:

- **clarification or revision within accepted behavior**: update the current `Experience Design` contract and replaceable task handoff; in `--revise`, also refresh the current `Design Revision Context`.
- **missing or changed Requirement/Scenario, scope, Epic ownership, client contract, data/auth rule, or technical constraint**: stop design finalization and route a central `proposed` Change to `/sdd-change`, or a central `planned`, `in_progress`, or `in_review` Change to `/sdd-change`.
- **adjacent future improvement**: recommend `/sdd-change` without expanding the current design.
- **broader product-direction change**: route to `/sdd-prd` or `/sdd-explore`.
- **durable architecture decision**: route to `/sdd-adr`.

Do not edit actual Epic files from this skill. Planned Epic definitions inside `change.md` or a compatible existing `design.md` remain planning material; candidate-bound repository Epic truth changes only through the separately invoked `/sdd-epic-update` capability.

## Validate And Hand Off

Before reporting design readiness:

1. Re-read `change.md` and `tasks.md`, plus any compatible existing `design.md`, for contradictions.
2. Confirm each material design decision traces to accepted behavior or is explicitly identified as a visual implementation choice.
3. Confirm desktop/mobile composition, required states, accessibility, and design-system deviations are sufficiently resolved for implementation.
4. Confirm the Visual Verification Matrix is proportional, covers every materially affected surface, and gives `/sdd-apply` and `/sdd-review` a reproducible rendered-state plan.
5. Confirm selected references use stable identifiers and their status is not ambiguous.
6. Run scoped `sdd validate` against the one central Change and resolve deterministic artifact errors caused by this work. Use `--repo` only as a validation projection filter for resolved target repositories; it never selects a lifecycle owner or Change copy.
7. Confirm the central Change status follows the selected mode and preserve each target repository's git/branch policy.

In `--revise`, confirm the Change remains `in_progress` after any confirmed revision mutation. `/sdd-design` does not return it to `in_review`, implement the revision, reconcile Epic truth, or write release communication.

Choose the terminal handoff or wait condition from the result:

- `complete` or `no-op` in `planned`: recommend separately invoked `/sdd-apply`.
- `complete` in `in_progress` with reopened implementation work: recommend separately invoked `/sdd-apply` at the exact first dependency-ready Requirement/Scenario or presentation slice.
- `complete` or `no-op` when the current repository candidate already satisfies the corrected contract: recommend separately invoked `/sdd-review` against that candidate; do not fabricate an Apply slice.
- `needs-user`: invoke no downstream workflow; state the exact design decision, candidate ambiguity, dependency disposition, permission, or acceptance response needed before resuming Design.
- `blocked`: invoke no downstream workflow; state the unblock condition and resume `/sdd-design` afterward.
- `routed`: name the one owning workflow and return control without invoking it. A central Change in `proposed` routes to `/sdd-change`.
- A central Change still in `in_review` has not recorded a confirmed revision mutation; preserve it there for `no-op`, `needs-user`, `blocked`, or `routed`, and do not recommend Apply.

For a multi-repository Change, the handoff identifies repository-specific starting slices and evidence obligations in the one ledger. Lifecycle transitions remain Change-wide and repo-free. Design stops before Apply, Review, Epic Update, Changelog, commits, PRs, release, deployment, or closeout; each remains separately invoked and candidate-bound where its own contract requires it.

The `/sdd-apply` handoff should name:

- the first Requirement/Scenario implementation slice and responsible target repository ID
- selected reference artifacts, qualified by repository ID when repository-local
- material component strategies and their initial repository-local implementation owners
- required responsive and interaction states
- repository-local Storybook stories or equivalent previews to build
- the Visual Verification Matrix, including repository IDs, routes or fixtures, viewports, states, interactions, expected rendered behavior, and preferred tool or fallback
- accessibility and manual UI confirmation obligations
- unresolved accepted gaps or stop conditions

## Stop Conditions

Stop and ask or route appropriately when:

- the owning central Change or any target repository ID is ambiguous
- accepted Requirements conflict with the requested design
- a material behavior or scope decision is unresolved
- the user has not confirmed a direction that would be expensive to reverse
- an external mutation requires confirmation
- design work would overwrite user-owned remote artifacts
- implementing the design would require application or Storybook source edits
- the Change is in `in_review` and no explicit revision request or review/manual-feedback record authorizes returning it to `in_progress`
- a closed Change would need to be rewritten
- privacy, accessibility, security, legal, or platform constraints cannot be satisfied safely

## Result Contract

Return exactly one composable status:

- `complete` — the confirmed experience contract is current, the checkpoint and handoff are coherent, and scoped validation passes;
- `no-op` — the requested direction already matches the current contract and candidate, so no mutation was needed;
- `needs-user` — direction, candidate scope, dependency disposition, external permission, or design acceptance requires user judgment;
- `blocked` — required context, safe artifact mutation, or validation cannot complete;
- `routed` — Change, PRD, Explore, ADR, or another owner must resolve a discovery before Design can complete.

A result is terminal for this invocation. Do not automatically invoke Apply, Review, Epic Update, Changelog, implementation, commits, PRs, release, deployment, or closeout.

## Final Response

Report:

- composable status, selected central Change path, owning Space, target repository IDs, and design-readiness result
- mode used and, for `--revise`, feedback/finding IDs, exact repository candidate envelopes, classification, and any repo-free central status transition
- confirmed direction and stable reference artifacts, qualified by repository ID where applicable
- major responsive, state, accessibility, and visual decisions
- planned repository-local rendered surfaces, viewports, states, interactions, and verification tooling or fallback
- central Change files updated, reopened slices or no-op determination, stale downstream candidates, and validation result
- requirement discoveries routed elsewhere
- exactly one recommended next owner, or the explicit wait/unblock condition when no downstream workflow is valid
