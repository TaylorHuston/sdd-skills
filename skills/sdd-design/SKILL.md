---
name: sdd-design
description: Resolve experience-design readiness for a UI-bearing planned or active SDD Change before implementation. Use when the user invokes /sdd-design, asks to design or refine a Change's user experience, wants to compare UI directions against accepted Requirements and Scenarios, needs responsive/component/state/accessibility decisions, or wants a durable handoff from visual prototypes into /sdd-apply. Grounds work in current product and implementation context, uses available design tools without requiring a fixed toolchain, records the approved direction in existing Change artifacts, and stops before editing application or Storybook source.
---

# SDD Design

Turn accepted behavior into an approved, implementation-ready experience direction. Keep design work connected to SDD truth without making prototypes or visual tools the source of behavioral truth.

## Boundary

This is an optional design-readiness workflow for Changes with meaningful user-interface or interaction uncertainty.

- `/sdd-explore` owns open-ended visual or product exploration before a Change is ready.
- `/sdd-change --plan` owns scope, Stories, Requirements, Scenarios, and high-level technical planning.
- `/sdd-design` owns experience convergence: flow, information architecture, responsive composition, component and state contracts, accessibility, and selected visual direction.
- `/sdd-apply` owns application code, production components, Storybook stories, and implementation evidence.
- `/sdd-review` independently checks the implemented experience against accepted behavior and the confirmed design direction.

Do not add a Change status or a mandatory `ui-design.md`. Use the existing `design.md` and `tasks.md`, plus app-level visual identity docs when the decision is broader than one Change.

## Resolve Authority

1. Resolve the workspace, idea, repository, and Change from explicit user input or `sdd context <relevant-path> --json`.
2. Read `<workspace-root>/.sdd/story-driven-development.md` completely. If it is missing, direct the user to `sdd init` or `sdd doctor`.
3. Require one selected planned or active Change:
   - planned draft: `<planning-path>/<plannedChangesDirectory>/<change-id>/`
   - active Change: the repository's configured active-Change path, normally `docs/changes/<change-id>/`
4. Ask when one idea maps to multiple plausible repositories or multiple Changes could own the design.
5. Treat a closed Change as history. Create or select a follow-up Change instead of rewriting closed intent.

Preserve the current `tasks.md` status. This skill does not promote, start, replan, review, close, merge, or release a Change.

- A planned or active `proposed` Change is the normal entry point.
- An `in_progress` Change may pause for design when accepted behavior remains stable.
- A `replanning` Change may use this workflow to resolve experience questions, then returns to `/sdd-change --replan` for planning completion.
- A Change in `review` or `ready_to_close` must return through `/sdd-review` or `/sdd-change --replan` before material design edits; do not preserve a review-ready claim while changing its accepted direction.

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

Use screenshots or browser inspection when visual claims depend on rendered reality. Do not judge a running interface from source alone when direct inspection is practical.

### 3. Resolve Material Questions

Ask one consequential question at a time when user judgment is needed. Concentrate on choices that affect workflow, comprehension, responsive behavior, accessibility, identity, or implementation scope.

Compare two or more credible directions when the choice is non-trivial. One direction is sufficient when existing product conventions or accepted prototypes make the answer obvious; state why.

Do not ask the user to choose incidental CSS values the design system already resolves. Do not silently choose a product behavior because it makes a composition easier.

### 4. Use Available Design Capabilities

Inspect the skills and tools available in the current runtime and use the smallest materially useful set. Possible capabilities include UI/UX review, prompt enhancement, image generation, browser inspection, Stitch, Penpot, screenshots, or other prototyping systems. None is required.

- Use divergent visual generation for meaningfully different concepts, not cosmetic permutations.
- Use precision design tools when component geometry, reusable patterns, or interaction detail needs refinement.
- Use existing Storybook only as an implementation reference; do not edit Storybook or application source from this skill.
- Follow every selected tool skill's confirmation, external-mutation, and asset-handling rules.
- Never apply a design system to existing remote screens or overwrite a user's prototype without explicit authorization.
- Record stable project, file, asset, screen, or prototype identifiers for selected references. Do not identify the approved direction only as “the latest screen.”

If no design tooling is installed, produce a clear text, ASCII, or Markdown experience contract and continue. Missing optional tools are not blockers.

### 5. Converge With The User

Present the strongest direction, meaningful alternatives, and tradeoffs. Refine until the user confirms a direction. The user may explicitly accept an unresolved gap only when it is non-blocking, safely deferrable, and recorded with its implementation or verification consequence.

Confirmation applies to the experience direction, not to implementation details that remain safely reversible. Do not claim design readiness while a material user-flow, responsive, state, accessibility, or visual-identity decision remains unresolved; route that decision through the appropriate planning workflow instead of classifying it as an accepted gap.

### 6. Record The Experience Contract

Create or update one `## Experience Design` section in the Change's existing `design.md`. Keep it proportional to the Change and use the canonical section in the installed `/sdd-change` `assets/design-template.md` when available. For an older or independently managed Change without that template, record the confirmed direction, user confirmation, stable reference artifacts, user flow and information architecture, responsive composition, component and state contract, accessibility and interaction behavior, visual direction, and open design questions.

Reference Requirements and Scenarios where the design contract clarifies how accepted behavior appears. Do not restate every Requirement or turn visual details into Stories.

Update `tasks.md` only as needed to preserve cold-resume state:

- selected direction and stable reference IDs
- user-confirmation result
- unresolved design blockers or accepted gaps
- expected `/sdd-apply` starting point
- Storybook states or manual UI checks the implementation should create

When a decision changes app-wide identity rather than only this Change, update or propose the project-resolved visual-identity document with user authorization and link it from `design.md`. Keep reusable cross-app foundations optional unless the user explicitly promotes a proven pattern.

## Behavioral Discovery

Design work often exposes missing or changed behavior. Classify it before editing SDD truth:

- **clarification within accepted behavior**: record it in `Experience Design` and the task handoff.
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
4. Confirm selected references use stable identifiers and their status is not ambiguous.
5. Run scoped `sdd validate` and resolve deterministic artifact errors caused by this work.
6. Preserve the Change status and git/branch policy.

Choose the handoff from the Change location and status:

- A private planned draft remains ready for promotion and repository-specific reconciliation, not implementation.
- An active repository Change in `proposed` or `in_progress` may hand off to `/sdd-apply` when design readiness passes.
- An active repository Change in `replanning` returns to `/sdd-change --replan`; do not hand it to `/sdd-apply` until planning is complete and the status is reconciled.
- A Change that remains in `review` or `ready_to_close` returns through `/sdd-review` or `/sdd-change --replan` before material design work continues.

The `/sdd-apply` handoff should name:

- the first Requirement/Scenario implementation slice
- selected reference artifacts
- required responsive and interaction states
- Storybook stories or equivalent previews to build
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
- the Change is in `review` or `ready_to_close` and the requested work would materially revise its accepted direction
- a closed Change would need to be rewritten
- privacy, accessibility, security, legal, or platform constraints cannot be satisfied safely

## Final Response

Report:

- selected Change and design-readiness result
- confirmed direction and stable reference artifacts
- major responsive, state, accessibility, and visual decisions
- files updated and validation result
- requirement discoveries routed elsewhere
- exact next workflow selected from the status-aware handoff and behavioral-discovery routes above
