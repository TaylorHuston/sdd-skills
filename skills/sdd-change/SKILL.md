---
name: sdd-change
description: Capture, plan, or replan an SDD change. Use when the user invokes /sdd-change --brief to preserve a durable desired outcome without technical planning, /sdd-change --plan to turn a confirmed brief or immediate change request into proposal.md, design.md, and tasks.md, or /sdd-change --replan to revise an active Change after implementation discovers new Requirements, Scenarios, constraints, Epic ownership, or scope concerns. Keeps intent capture separate from just-in-time technical planning while preserving Epic truth, BDD/TDD evidence planning, ADR and optional /sdd-design routing, and implementation-ready task ledgers.
---

# SDD Change

Manage a change from durable intent through implementation-ready planning. Keep outcome capture separate from technical planning so implementation choices are made against current code, dependencies, and project constraints.

Planning invariant: describe the accepted end state, observable behavior, durable constraints, important risks, and the checks or confirmations that must eventually support the result. Do not predict a fixed implementation sequence, exhaustive file list, or every failure mode up front. Seed only the obligations already knowable; keep `tasks.md` as a living Apply ledger that can be revised as current implementation reality reveals better slices, new risks, decision fan-out, and evidence needs.

## Authority And Project Profile

Resolve the user installation, Space, idea planning path, and target repositories with `sdd context <relevant-path> --json`. Read the `workflowPath` returned by `sdd context` completely before defining Change status, Stories, Requirements, Scenarios, evidence, or repository ownership. If user setup is missing, direct the user to `sdd setup`; if a repository contract is missing, direct them to `sdd init` there. Use `sdd doctor` for an existing but unhealthy installation.

The one canonical dated Change record lives under `~/.sdd/changes/`; target repositories are stable IDs in `tasks.md`, not copies of the Change. Project guidance owns branch and write policy, release conventions, supporting docs, technology constraints, and specialist guidance. Epics, ADRs, implementation, tests, and supporting docs remain repository-local under their canonical paths.

Use `/sdd-interactive` when the user wants to create and immediately implement a small tracked change in one session.

## Modes

Use exactly one mode:

- `--brief`: capture durable product intent only. Do not perform technical planning.
- `--plan`: create or finish an implementation-ready planned Change using current technical context.
- `--replan`: revise an existing central active Change after planning-level discovery.

When no flag is supplied, infer the mode only when the request is unambiguous. Ask whether the user wants to capture the outcome or plan implementation when that choice would materially change the work.

## Outputs

### Brief

`--brief` writes one undated private file:

```text
<planning-path>/change-briefs/<change-slug>.md
```

Use `assets/brief-template.md`. A Change Brief has no Change `status`, does not appear in `sdd status`, does not authorize implementation, and is not accepted by `/sdd-apply`.

### Planned Change

`--plan` writes the canonical planned artifact set:

```text
~/.sdd/changes/<yyyy-mm-dd-change-name>/proposal.md
~/.sdd/changes/<yyyy-mm-dd-change-name>/design.md
~/.sdd/changes/<yyyy-mm-dd-change-name>/tasks.md
```

Use:

- `assets/proposal-template.md`
- `assets/design-template.md`
- `assets/tasks-template.md`
- `assets/epic-template.md` for proposed new Epic shape
- `/sdd-adr` and its ADR template for durable architecture decisions

Assign the dated Change ID when planning begins, not when the brief is captured. Change IDs are globally unique across the user installation. Use `sdd change create <space-id> <slug>` with explicit `--repo` selections when needed; the command creates the one canonical central record and writes the Space and target repository IDs into `tasks.md`.

`--plan` refines that central record in place. It owns semantic scope, target-repository responsibilities, Epic actions, design, tasks, dependencies, and cross-repository coordination without creating repository copies.

### Replanned Change

`--replan` updates the existing central active Change under `~/.sdd/changes/<change-id>/`. It never creates a private brief, repository copy, or second Change for the same scope.

## Common Setup

1. Resolve the Space and every relevant target repository.
   - Prefer explicit paths and IDs from the user, then `sdd context`.
   - Ask when multiple mapped repositories are plausible targets or ownership remains ambiguous.
   - Do not write to the workflow root unless it is an intended target repository.
2. Resolve the input.
   - Accept a kebab-case slug, plain-language outcome, brief path, Change ID, or central active Change path as appropriate to the mode.
   - Derive a concise kebab-case slug from prose.
   - For `--replan`, require an existing central active Change and ask when multiple Changes could own the discovery.
3. Load only mode-relevant context.
   - Read project guidance, PRD/Product Brief context, and relevant exploration notes when present.
   - Flag product-direction conflicts; recommend `/sdd-prd` when the disagreement is broader than one Change.
   - Treat idea-owned planned folders and repository-local active or closed Change folders as migration input only. Do not continue work there; direct the user to `sdd update`.

## Brief Mode

The outcome is a durable reminder of what should improve, without assumptions that may expire before implementation.

1. Read product context and existing briefs only far enough to avoid duplicate intent.
2. Do not inspect implementation code, choose frameworks or libraries, define APIs or schemas, split implementation tasks, create ADRs, or select a technical approach.
3. Ask only the product questions needed to make the desired outcome durable:
   - What problem or opportunity motivates the change?
   - What should be observably better for the user or system?
   - What is in scope and explicitly out of scope?
   - What signals would show the outcome was achieved?
   - Which business, legal, accessibility, compatibility, or other durable constraints must survive later technical planning?
   - Which product questions remain open?
4. Prefer one high-leverage question at a time. Do not force detail that can safely wait until planning.
5. Create or update `<change-slug>.md`. Preserve the original `created` date and update `modified` using the local shell date.
6. Verify that the brief contains no technical plan, implementation checklist, Change status, speculative repository commitment, or invented Requirement/Scenario detail.

Likely repositories may be listed as nonbinding context only. A brief can remain in the backlog indefinitely without becoming stale merely because implementation technology changes.

## Plan Mode

The outcome is one coherent central planned Change that is ready to hand to `/sdd-apply`.

1. Establish confirmed intent.
   - Prefer an existing Change Brief.
   - If no brief exists, first capture the brief-level outcome and ask the user to confirm it before technical planning. This may happen in the same invocation when the user explicitly requested `--plan`.
   - Treat the confirmed desired outcome and scope boundaries as the planning anchor. Do not silently narrow, broaden, or reinterpret them.
2. Refresh current implementation context.
   - Read project guidance, README, relevant docs, PRD, central active and recent closed Changes, relevant Epics, current code, tests, contracts, and dependencies only as needed.
   - Read code when needed to avoid fictional `Implemented By` or `Verified By` plans and to compare viable approaches.
   - When planning depends on version-sensitive library, framework, SDK, API, CLI, or cloud-platform behavior, prefer an available current-documentation capability such as Context7. Query the exact concept and installed version when known; otherwise use primary vendor documentation rather than relying on model memory.
3. Create or continue the planned Change.
   - For a new plan, run `sdd change create <space-id> <slug>` with explicit `--repo` selections when needed. Confirm the globally unique ID, `space`, and stable `repositories` frontmatter before refinement.
   - For each new Epic named by the plan, run `sdd epic create <space-id> <epic-id> <slug>` against exactly one selected repository before refining the canonical scaffold. Do not hand-author a substitute Epic shape.
   - Update the one central Change in place. Divide repository-specific ownership and coordination obligations clearly while keeping shared scope, decisions, and lifecycle state in that record.
   - Never create or maintain repository-local Change copies.
4. Interview before finalizing.
   - Confirm Epic actions and capability-sized Story boundaries.
   - Refine observable Requirements and concrete happy-path, empty, failure, permission, recovery, integration, and security-sensitive Scenarios as relevant.
   - Identify current and plausible clients, API or typed-contract boundaries, data, auth/security, migration, rollout, and operational constraints.
   - Identify material user-flow, responsive, component-state, accessibility, or visual-direction uncertainty. Plan observable behavior here, then route experience convergence to `/sdd-design` instead of improvising a detailed UI without user confirmation.
   - For material component decisions, record the canonical `Component Strategy` labels from the design template even when the experience direction is already clear. Use `/sdd-design --plan` when the strategy needs convergence, not merely to fill a settled classification.
   - Compare viable technical approaches for non-trivial decisions. Usually compare two or three; use one only when the choice is genuinely obvious and say why.
   - Challenge the verification strategy so evidence can map to Story, Requirement, and Scenario IDs rather than becoming a command log. Keep focused behavior proof distinct from project-defined aggregate and integration-candidate gates.
   - Identify behavior that will have distinct governing owners across route/auth, application policy, persistence, provider/runtime configuration, deployment, and presentation boundaries. Plan narrower Requirement/Scenario ownership instead of one umbrella map row.
   - Seed known end-state invariants, risk/confirmation obligations, triggered boundary-contract applicability, decision fan-out concerns, verification-environment needs, and the Verification Scope Decision without pretending they form an exhaustive upfront implementation plan. Note known typed results that cross service/plugin/transport/client boundaries and known concurrent or durable recovery obligations, but leave the full matrices to `/sdd-apply`. Resolve a project-defined aggregate command when one exists. Seed aggregate or prospective-integration obligations when project policy requires them or the known scope crosses multiple capabilities, persistence or migrations, security or disclosure, process-global state, concurrency or workers, shared contracts, or accumulated integration work; leave final escalation to `/sdd-apply` and `/sdd-review` as the real diff emerges.
   - Ask before finalizing when material product, Story, contract, data, security, architecture, or verification choices remain unsettled.
5. Write `proposal.md`.
   - Preserve the brief's why, desired outcome, scope boundaries, success signals, durable constraints, and open questions.
   - Record stable target repository IDs matching `tasks.md` frontmatter, new or updated Epic directories in those repositories, Story moves or replacements, impact, deferred scope, assumptions, and release-communication impact.
6. Write `design.md`.
   - Record the selected technical approach, alternatives, reconsideration triggers, client and application boundaries, important constraints, risks, and verification strategy.
   - Define each new or modified Epic's Stories, Requirements, Scenarios, independent implementation and verification state, behavior-mapped `Implemented By`, `Implementation Gaps`, scenario-mapped `Verified By`, and `Verification Gaps` using the canonical template.
   - Preserve exactly one canonical `Implemented By` and one canonical `Verified By` section per Story. Plan consolidation of any `Prior`, `Detailed`, `Legacy`, or migration-era maps into those sections; retain only non-competing history in `Story Notes`.
   - Use Epic-scoped Story labels such as `S1`; preserve legacy app-wide Story IDs only when existing references depend on them.
   - Use local Requirement and Scenario IDs such as `R1` and `R1-S1`. Use `The system SHALL ...`, `WHEN`, and `THEN` for observable behavior.
   - Default each Story to one primary user path to an action or outcome. When a Story has several actors, independently valuable outcomes, separately releasable workflows, behavior its title does not predict, more than six Requirements, or more than twelve Scenarios, split it or record why one coherent path still requires the larger boundary.
   - Write `Not implemented yet.` under `Implementation Gaps` and `Not verified yet.` under `Verification Gaps` instead of inventing future files, symbols, or evidence. Planned technical ownership may remain in `design.md`; do not present it as an implemented Epic map.
   - Plan explicit reconciliation for existing Epic truth the Change may supersede.
7. Route durable decisions through `/sdd-adr`.
   - Create an ADR candidate or Proposed ADR for durable architecture, API, client, data, integration, deployment, dependency, auth/security, state, or storage decisions future work should respect.
   - Do not create ADRs for ordinary, reversible implementation details.
8. Write `tasks.md`.
   - Start with frontmatter containing `status: proposed`, the owning `space`, and the stable target `repositories` list. Use only `proposed`, `planned`, `in_progress`, or `in_review`; central folder location under `~/.sdd/changes/closed/` is the terminal state.
   - Keep tasks at end-state, artifact, Story/capability, verification, review, and closeout level rather than writing a file-by-file sequence or freezing an implementation order.
   - Seed the living Implementation Risk And Confirmation Matrix, Decision Fan-Out Ledger, Verification Environment table, and Verification Scope Decision with only the obligations currently knowable. Treat Pattern Parity, Boundary Contract, and Stateful Transition matrices as triggered Apply artifacts: mark known applicability when useful, but do not predict exhaustive sibling concerns, cross-layer mappings, or state interleavings before implementation. Maintain `Resume Here`, implementation and verification ledgers, blockers, manual confirmation, review record, release communication, PR/merge state, ADR state, deferred gaps, truth reconciliation, and closeout tasks.
9. Validate and hand off.
   - Set `status: planned` only after the proposal, design, tasks, Epic actions, and verification strategy are coherent and no planning decision remains unresolved.
   - Run `sdd validate <space-id> --change <change-id> --workspace <workspace-root> --json` and resolve deterministic errors. Inspect warnings; structural validity does not prove semantic completeness.
   - Re-read all artifacts and stop for a follow-up question when unresolved ambiguity would make Stories, Requirements, Scenarios, technical choices, or verification misleading.
   - When planning from a private brief, remove the source brief only after the validated `proposal.md` fully preserves its durable intent. Leave it intact if planning stops or fails.
   - A validated central Change in `planned` may proceed directly to `/sdd-apply`; there is no promotion stage or repository copy to reconcile.
   - When a UI-bearing Change still has material experience uncertainty, hand it to `/sdd-design --plan` before implementation. Use `/sdd-design --revise` only for an implemented or partially implemented experience whose accepted behavior remains stable. Design readiness does not add a Change status or authorize code edits.

## Replan Mode

Use `--replan` when implementation, review, or manual feedback discovers a new or meaningfully changed Requirement, Scenario, constraint, Epic owner, contract, data/auth rule, architecture decision, rollout need, or verification obligation that must be planned before implementation continues.

Do not use it for narrow defects, missing tests, stale evidence indexes, or routine implementation corrections that `/sdd-apply` can safely reconcile.

1. Read the active Change, relevant Epic truth, implementation ledger, review or manual feedback, current code, tests, and failing or passing evidence needed to understand the discovery.
2. For a Change not already `proposed`, run `sdd change transition <space-id> <change-id> --from <current-status> --to proposed`. This compare-and-set mutates the one central `tasks.md`; do not transition repository targets independently. Classify the discovery as `in-scope refinement`, `scope expansion`, `product drift`, `Epic ownership change`, `technical constraint`, or `follow-up change`.
3. Preserve the active Change when the discovery is required to achieve its accepted outcome. Recommend a new `/sdd-change --brief` for adjacent future work or `/sdd-prd` for changed product direction.
4. Ask only the questions needed to resolve the discovery and define what must be true before implementation resumes.
5. Update `proposal.md`, `design.md`, ADRs, and `tasks.md` wherever scope, behavior, approach, evidence, risks, decision fan-out, verification-environment obligations, or resume state changed. Keep existing Story, Requirement, and Scenario IDs stable unless the behavior is genuinely new; do not replace adaptive Apply work with a newly rigid implementation script.
6. Add a dated `Planning Updates` entry with the discovery, classification, decisions, artifacts changed, and exact `/sdd-apply` restart point.
7. Set `status: planned` only when the revised plan is coherent. Use `sdd change transition <space-id> <change-id> --from proposed --to planned`; then run scoped `sdd validate`. Otherwise leave `status: proposed` and keep the unresolved planning decision explicit.
8. Do not edit application code or actual Epic files from this mode unless the user explicitly asks for that additional work.

## Artifact Rules

- Change artifacts describe proposed behavior and approach; they do not authorize code or Epic edits.
- Planning records what must be true and confirmed at the end. Apply owns adapting phases, risk rows, triggered parity, boundary-contract, and transition rows, fan-out, and evidence from current implementation reality.
- Epics and embedded Stories are durable but revisable truth. Name Story moves, splits, merges, renames, and superseded Requirements explicitly.
- Requirements stay user-visible or externally observable. Technical constraints belong in `design.md` unless they affect observable behavior.
- Story `Implementation` uses `not implemented`, `partial`, or `implemented`; Story `Verification` independently uses `unverified`, `partial`, or `verified`. Neither field is a Change task state.
- `Implemented By` maps every implemented Requirement, and distinct Scenarios when needed, to concrete repository-relative locations plus stable symbols or searchable anchors. `primary` identifies governing behavior regardless of physical layer; genuine split ownership may use multiple narrower primary rows. Separate supporting adapters, persistence, presentation, configuration, migrations, and support by responsibility.
- An implementation anchor must identify the definition, registration, or configuration that owns the claimed behavior. Do not accept an import, call site, incidental UI handler, broad file token, or a file already cited for another symbol as semantic ownership.
- A material edit to behavior, state, ownership, gaps, or evidence in a legacy Epic requires whole-file normalization to `sdd-epic-v2`. Derive implementation and verification independently from current code, evidence, and gaps rather than copying a legacy status into both.
- `Verified By` is a scenario-mapped evidence index. Chronological checks and progress belong in `tasks.md`.
- Automated evidence uses an exact test title or stable named test anchor, never a generic framework token such as `#it(`, `#test(`, or `#describe(`.
- Keep deferred or scope-expanding ideas out of current Stories, Requirements, Scenarios, and tasks.
- Keep public release communication free of private planning context, raw SDD ledgers, secrets, and speculative roadmap claims.
- Do not edit application code, actual Epic files, or implementation records from this skill unless the user explicitly asks for that extra work.
- Leave unresolved uncertainty explicit.

## Final Response

Summarize the mode, central artifact path, owning Space, target repository IDs, durable outcome or planned Epic actions, important open questions, validation state, and exact next workflow. For `--replan`, include the discovery classification and `/sdd-apply` restart point.
