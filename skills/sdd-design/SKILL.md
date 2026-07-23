---
name: sdd-design
description: Plan or revise experience-design readiness for a UI-bearing SDD Change. Use `/sdd-design --plan` to converge unresolved flow, responsive, component/state, accessibility, or visual direction before implementation, and `/sdd-design --revise` when implementation, comparison, review, or manual feedback shows that an active Change's accepted experience needs another design pass without changing its accepted behavior. Uses available design and evidence tools without requiring a fixed toolchain, records the approved direction or design delta in existing Change artifacts, and stops before editing application or Storybook source.
---

# SDD Design

Turn accepted behavior into an approved, implementation-ready experience direction. Keep design work connected to SDD truth without making prototypes or visual tools the source of behavioral truth.

## Boundary

This is an optional design-readiness workflow for Changes with meaningful user-interface or interaction uncertainty.

- `/sdd-explore` owns open-ended visual or product exploration before a Change is ready.
- `/sdd-change --plan` owns scope, Stories, Requirements, Scenarios, and high-level technical planning.
- `/sdd-design --plan` owns initial experience convergence: flow, information architecture, responsive composition, component and state contracts, accessibility, and selected visual direction.
- `/sdd-design --revise` owns post-implementation experience revision when accepted behavior remains stable.
- `/sdd-apply` owns application code, production components, Storybook stories, and implementation evidence.
- `/sdd-review` independently checks the implemented experience against accepted behavior and the confirmed design direction.

Do not add a Change status or a mandatory `ui-design.md`. Use the existing `design.md` and `tasks.md`, plus app-level visual identity docs when the decision is broader than one Change.

## Modes

Use exactly one mode:

- `--plan`: converge the initial experience direction before implementation or promotion.
- `--revise`: revise an implemented or partially implemented experience after comparison, review, or manual feedback without changing accepted behavior.

When no flag is supplied, infer the mode only when the Change state and request make it unambiguous. Ask when choosing initial convergence versus post-implementation revision would change status handling or artifact history.

## Resolve Authority

1. Resolve the workspace, idea, repository, and Change from explicit user input or `sdd context <relevant-path> --json`.
2. Read the `workflowPath` returned by `sdd context` completely. If user setup is missing, direct the user to `sdd setup`; if the repository contract is missing, direct them to `sdd init` there. Use `sdd doctor` for an existing but unhealthy installation.
3. Require one selected planned or active Change:
   - planned draft: `<planning-path>/<plannedChangesDirectory>/<change-id>/`
   - active Change: the repository's configured active-Change path, normally `docs/changes/<change-id>/`
4. Ask when one idea maps to multiple plausible repositories or multiple Changes could own the design.
5. Treat a closed Change as history. Create or select a follow-up Change instead of rewriting closed intent.

This skill does not promote, start implementation, replan behavior, review, close, merge, or release a Change.

- `--plan` preserves the current status. A planned or active `proposed` Change is its normal entry point; `planned` is also valid when experience readiness remains the final pre-implementation gate.
- `--revise` requires an active repository Change in `in_progress` or `in_review` and an explicit user request, review finding, or recorded manual feedback identifying the experience concern.
- Keep an `in_review` Change in review while auditing, comparing, classifying feedback, and converging with the user. Do not transition it during setup merely because `--revise` was invoked.
- After feedback is confirmed as an experience revision within accepted behavior and the user confirms the revised direction, run `sdd change transition <space-id> <change-id> --from in_review --to in_progress` immediately before editing `design.md` or `tasks.md`, with explicit `--repo` selections when needed. Stop and refresh context if the compare-and-set transition fails.
- Route behavioral discovery from `in_review` directly to `/sdd-change --replan` without first transitioning it to `in_progress`.
- An active `in_progress` Change already has the correct status for `--revise`; do not perform a no-op transition.
- A `proposed` Change returns to `/sdd-change --plan` or `--replan` after `--plan` resolves its experience questions.
- A closed Change is never revised in place.

## Required Context

Read only the context that can materially change the design:

- `proposal.md`, `design.md`, and `tasks.md`
- affected Epic/Story/Requirement/Scenario definitions
- Product Brief, PRD, or relevant exploration conclusions
- app visual identity, project design guidance, and optional shared foundations
- current routes, components, styles, screenshots, and Storybook when implementation already exists
- existing prototype links, design-system assets, and prior user decisions
- accessibility, platform, framework, and client constraints relevant to the experience

Inspect current implementation before proposing replacement patterns. Project identity and usability needs override shared visual defaults.

## Design Readiness Workflow

### 1. Establish The Behavioral Anchor

Summarize the user outcome, in-scope Stories, observable Requirements, relevant Scenarios, non-goals, current clients, and known constraints. Do not reinterpret accepted behavior through a visual preference.

If the Change lacks enough behavioral clarity to design honestly, route it to `/sdd-change --plan` or `--replan` instead of filling gaps with assumptions.

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

1. Classify the feedback as `experience refinement`, `experience defect`, `accessibility correction`, `responsive correction`, or `behavioral discovery`.
2. Identify the stable reference: an accepted existing implementation, Storybook story, browser route, prototype, screenshot, design-system artifact, or explicit user direction.
3. Record what the target must **preserve**, **change**, and treat as an explicit **non-goal**.
4. Use rendered comparison and measurable evidence when practical: component geometry, hierarchy, wrapping, overflow, focus, contrast, states, and responsive behavior.
5. Preserve target-specific behavior and semantics even when another application is the visual reference.

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

For an `in_review` Change, perform the guarded `in_review -> in_progress` transition only after this classification and confirmation pass succeeds, and immediately before recording the revised contract.

### 8. Record The Experience Contract

Create or update one `## Experience Design` section in the Change's existing `design.md`. It is the canonical current accepted experience contract, not the revision history. Keep it proportional to the Change and use the canonical section in the installed `/sdd-change` `assets/design-template.md` when available. For an older or independently managed Change without that template, record the confirmed direction, user confirmation, stable reference artifacts, user flow and information architecture, responsive composition, component and state contract, material component strategies, accessibility and interaction behavior, visual direction, and open design questions.

Reference Requirements and Scenarios where the design contract clarifies how accepted behavior appears. Do not restate every Requirement or turn visual details into Stories.

Update `tasks.md` only as needed to preserve cold-resume state:

- selected direction and stable reference IDs
- material component strategies, initial ownership, and required preview states
- user-confirmation result
- unresolved design blockers or accepted gaps
- expected `/sdd-apply` starting point
- Storybook states or manual UI checks the implementation should create
- the Visual Verification Matrix covering affected surfaces, viewports, states, interactions, expected observations, and preferred tooling or fallback

For `--revise`, update `Experience Design` to the newly confirmed current contract and append a dated `Design Updates` entry containing the feedback, classification, reference and target, preserve/change/non-goal summary, artifacts changed, and exact `/sdd-apply` restart point. The ledger preserves the superseded direction and why it changed; `design.md` must not leave the old and revised directions competing as simultaneous current truth.

When a decision changes app-wide identity rather than only this Change, update or propose the project-resolved visual-identity document with user authorization and link it from `design.md`. Keep reusable cross-app foundations optional unless the user explicitly promotes a proven pattern.

## Behavioral Discovery

Design work often exposes missing or changed behavior. Classify it before editing SDD truth:

- **clarification or revision within accepted behavior**: update the current `Experience Design` contract and task handoff; in `--revise`, also append the historical `Design Updates` entry.
- **missing or changed Requirement/Scenario, scope, Epic ownership, client contract, data/auth rule, or technical constraint**: stop design finalization and route a planned draft back to `/sdd-change --plan` or an active Change to `/sdd-change --replan`.
- **adjacent future improvement**: recommend `/sdd-change --brief` without expanding the current design.
- **broader product-direction change**: route to `/sdd-prd` or `/sdd-explore`.
- **durable architecture decision**: route to `/sdd-adr`.

Do not edit actual Epic files from this skill. Planned Epic definitions inside `design.md` remain planning material; accepted Epic truth changes through the owning planning or implementation workflow.

## Validate And Hand Off

Before reporting design readiness:

1. Re-read `proposal.md`, `design.md`, and `tasks.md` for contradictions.
2. Confirm each material design decision traces to accepted behavior or is explicitly identified as a visual implementation choice.
3. Confirm desktop/mobile composition, required states, accessibility, and design-system deviations are sufficiently resolved for implementation.
4. Confirm the Visual Verification Matrix is proportional, covers every materially affected surface, and gives `/sdd-apply` and `/sdd-review` a reproducible rendered-state plan.
5. Confirm selected references use stable identifiers and their status is not ambiguous.
6. Run scoped `sdd validate` and resolve deterministic artifact errors caused by this work.
7. Confirm the Change status follows the selected mode and preserve git/branch policy.

In `--revise`, confirm the Change remains `in_progress`. `/sdd-design` does not return it to `in_review`; a fresh `/sdd-apply` must implement the revised contract, reconcile evidence and Epic truth, and perform the implementation handoff.

Choose the handoff from the Change location and status:

- A private planned draft remains ready for promotion and repository-specific reconciliation, not implementation.
- An active repository Change in `planned` may hand off to `/sdd-apply` when initial design readiness passes.
- An active repository Change revised in `in_progress` hands off to a fresh `/sdd-apply` at the exact affected Requirement/Scenario or presentation slice.
- An active repository Change in `proposed` returns to `/sdd-change --plan` or `--replan`; do not hand it to `/sdd-apply` until planning is complete and its status is `planned`.
- A Change still in `in_review` has not entered `--revise` correctly; transition it back to `in_progress` or route planning-level discovery through `/sdd-change --replan`.

The `/sdd-apply` handoff should name:

- the first Requirement/Scenario implementation slice
- selected reference artifacts
- material component strategies and their initial implementation owners
- required responsive and interaction states
- Storybook stories or equivalent previews to build
- the Visual Verification Matrix, including routes or fixtures, viewports, states, interactions, expected rendered behavior, and preferred tool or fallback
- accessibility and manual UI confirmation obligations
- unresolved accepted gaps or stop conditions

## Stop Conditions

Stop and ask or route appropriately when:

- the owning Change or repository is ambiguous
- accepted Requirements conflict with the requested design
- a material behavior or scope decision is unresolved
- the user has not confirmed a direction that would be expensive to reverse
- an external mutation requires confirmation
- design work would overwrite user-owned remote artifacts
- implementing the design would require application or Storybook source edits
- the Change is in `in_review` and no explicit revision request or review/manual-feedback record authorizes returning it to `in_progress`
- a closed Change would need to be rewritten
- privacy, accessibility, security, legal, or platform constraints cannot be satisfied safely

## Final Response

Report:

- selected Change and design-readiness result
- mode used and, for `--revise`, the feedback classification and status transition
- confirmed direction and stable reference artifacts
- major responsive, state, accessibility, and visual decisions
- planned rendered surfaces, viewports, states, interactions, and verification tooling or fallback
- files updated and validation result
- requirement discoveries routed elsewhere
- exact next workflow selected from the status-aware handoff and behavioral-discovery routes above
