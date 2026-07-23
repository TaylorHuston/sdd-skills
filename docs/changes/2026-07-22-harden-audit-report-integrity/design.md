# Design: Harden Audit Report Integrity

## Context

Free-form audit prose cannot safely distinguish current failures from historical failures. Epic `modified` freshness can only be validated deterministically when the caller supplies a Git baseline. Release scope must be reconciled from the actual source-to-target diff, not only from an intended file list.

The independent cumulative review also found an ownership problem: behavior now ships through several workflow skills and the public site, but `SDD-E001` only owns the validator, immutable Epic verification, and PR/release handoff slices. The plan must distinguish genuinely new durable outcomes from implementation support while leaving trust-boundary defects with the earlier active Change that already owns them.

## Goals / Non-Goals

**Goals:**

- Make the report validator, canonical report template, and packaged template asset one coherent contract.
- Add exact negative proof for missing schemas, wrong-Epic evidence, self/non-versioned lineage, and unsafe Git baselines.
- Give every shipped workflow and public-site behavior a predictable durable Story owner.
- Keep the two active Changes coordinated without duplicating responsibility for the same defects.
- Require a fresh aggregate candidate and rendered UI matrix before returning to review.

**Non-Goals:**

- Rewriting historical unversioned reports.
- Inferring a Git baseline from branch policy.
- Moving reports or planning state into a new cross-repository service.
- Turning every skill or site file into its own Story.
- Taking over S2/S3 implementation defects already owned by `2026-07-20-harden-cli-trust-boundaries`.

## Planning Interview / Story Refinement

- Scope boundary reviewed: cumulative review findings plus the behavior advertised in Unreleased.
- User decisions: durable Stories are updated when behavior changes; new Stories represent distinct durable outcomes rather than implementation tasks.
- Assumptions: `SDD-E001` remains the single capability owner; local repository context is authoritative.
- Deferred scope: legacy migration, automatic baseline inference, optional favicon/touch polish.
- Story boundaries challenged:
  - S5 remains focused on audits and publication handoffs.
  - S6 owns the developer path through planning, implementation, and comprehensive review.
  - S7 owns the public reader's path through learning, navigation, and command discovery.
- Requirements refined: report integrity, immutable Git selection, workflow persistence, evidence/risk closure, visual verification, public content/navigation/accessibility.
- Scenario gaps considered: malformed/missing schema, wrong Epic, self/non-versioned lineage, option injection, hung subprocess, long-running review continuation, iteration exhaustion, clipboard failure, narrow viewport, keyboard focus, and console/network regression.
- Open questions that block implementation: none.

## Epic Changes

### Update Epic: Reliable CLI Operations

- Target Epic: `docs/epics/sdd-e001-reliable-cli-operations/epic.md`
- Change Type: modified and added scope

#### Story Changes

- Added:
  - `S6` Reliable Workflow Execution.
  - `S7` Accessible Public Methodology Reference.
- Modified:
  - `S1/R4` gains complete report-schema, canonical gate-set, Epic-scope, and lineage Scenarios.
  - `S5` gains safe immutable Git-baseline behavior and explicit validator/template boundary reconciliation.
- Removed:
  - None.

#### Planned Story S6: Reliable Workflow Execution

As a developer, I want SDD planning, implementation, and review workflows to carry work through a complete evidence-backed handoff, so that an agent does not stop at a partial task, a green command, or the first finding.

##### Requirement R1: Adaptive Planning And Handoff Records

The packaged planning workflow SHALL define accepted end-state behavior and seed risk, decision fan-out, verification-environment, visual-verification, and candidate-scope obligations without freezing a file-by-file implementation sequence.

###### Scenario R1-S1: Replanning After Review

- WHEN review invalidates Story ownership or verification scope
- THEN `/sdd-change --replan` returns the Change to a coherent planned state with a dated planning update and exact Apply restart point.

##### Requirement R2: Persistent Verified Implementation

Default/full Apply SHALL continue through safe implementation and self-remediation until the Change is ready for independent review or reaches a genuine stop condition, and SHALL commit completed verified slices when policy and isolation permit.

###### Scenario R2-S1: Long Multi-Slice Change

- WHEN one Requirement finishes while more accepted work remains
- THEN Apply reconciles and commits the green slice before continuing instead of reporting the Change ready early.

##### Requirement R3: Comprehensive Independent Review

Review SHALL complete every applicable discovery and verification gate before one consolidated verdict, SHALL treat yielded or long-running commands as continuation points, and SHALL give `--until-ready` the same full final-report contract with a default maximum of five remediation iterations.

###### Scenario R3-S1: Early Blocking Finding

- WHEN one review pass finds a blocking defect
- THEN the reviewer retains it and continues the materially relevant discovery wave before consolidating the verdict.

###### Scenario R3-S2: Yielded Aggregate Gate

- WHEN a required command yields a resumable session or runs longer than a progress interval
- THEN review reports progress, resumes the command, and does not mistake the yield for completion.

##### Requirement R4: Rendered UI Verification

UI-bearing planning SHALL define a proportional Visual Verification Matrix, and Apply/Review SHALL render current source, exercise changed interactions, inspect representative desktop/mobile states and console/network results, and keep owner manual confirmation separate.

###### Scenario R4-S1: Source-Only UI Confidence

- WHEN a UI change passes source, build, or static checks without rendered inspection
- THEN the workflow records rendered verification as pending or blocked rather than review-ready.

##### Requirement R5: Risk-Shaped Evidence Closure

Apply and Review SHALL trigger pattern-parity, boundary-contract, stateful-transition, capability-authority, provenance/budget, filesystem-confinement, aggregate-candidate, and evidence-falsification checks when those boundaries intersect the Change.

###### Scenario R5-S1: Aggregate Green With Weak Scenario Proof

- WHEN a broad gate passes but a high-risk Scenario citation does not assert the claimed boundary
- THEN the workflow keeps the Scenario unverified and records the exact proof gap.

#### Planned Story S7: Accessible Public Methodology Reference

As a developer or coding agent, I want one readable public guide to explain the SDD problem, durable behavior model, general workflow, and package implementation, so that I can understand the method and find the correct entry point without reverse-engineering the repository.

##### Requirement R1: Methodology And Implementation Separation

The public guide SHALL explain the context-loss problem, portable SDD model, durable Story semantics, and a complete example before describing this package's document layout, CLI, and agent skills.

###### Scenario R1-S1: Behavior Changes After Implementation

- WHEN the guide explains how accepted behavior evolves
- THEN it says to update the existing durable Story and reserve new Stories for distinct user outcomes rather than implementation tasks.

##### Requirement R2: Navigable Responsive Documentation

The guide SHALL provide sequential headings, current-location navigation, readable bounded content, and contained long-form evidence/examples across representative desktop and mobile widths without page-level overflow.

###### Scenario R2-S1: Narrow Viewport Navigation

- WHEN the guide is opened at the minimum supported mobile width
- THEN navigation and controls remain reachable without collision or horizontal page overflow.

##### Requirement R3: Accessible Interaction Feedback

The guide SHALL expose visible keyboard focus, a working skip link, touch-sized controls, canonical labels, and announced copy success or selectable fallback behavior.

###### Scenario R3-S1: Clipboard Failure

- WHEN command copying is unavailable
- THEN the command text is selected and the control exposes temporary visible feedback instead of failing silently.

##### Requirement R4: Steel Documentation Presentation

The guide SHALL use the shared Steel semantic identity as restrained documentation, with readable contrast, balanced headings, reduced-motion behavior, and contained surfaces reserved for documents, evidence, code, and controls.

###### Scenario R4-S1: Reduced Motion

- WHEN the user prefers reduced motion
- THEN smooth scrolling and nonessential transition duration are reduced without breaking navigation feedback.

#### Supersedes / Reconciles

- Earlier Story, Requirement, Scenario, or boundary wording this change supersedes:
  - S1/R4's incomplete claim that all lineage cases were already verified.
  - S5's narrower assumption that only Epic Verify, PR, and Release define shipped workflow behavior.
- Story implementation/verification state, `Implemented By`, `Implementation Gaps`, `Verified By`, or `Verification Gaps` entries that must be rewritten or reclassified:
  - S1/R4 remains implemented but must be downgraded to partial verification until every negative case passes.
  - S5 must map the canonical template/runtime boundary and safe orphan-audit Git selection.
  - S6 and S7 must be derived independently from current source and exact proof during Apply; planning does not predeclare them verified.
- Closed or active Change artifacts likely to need status cleanup:
  - Both active Change ledgers and both review records.
- Manual confirmation status updates expected:
  - S7 remains `pending user` after rendered verification until the owner confirms the exact final Steel candidate.

## Technical Options

### Option 1: Expand S5 Into One Workflow Umbrella

- Summary: map every skill and site behavior under the existing audit/handoff Story.
- User impact: one apparent owner, but the Story title does not predict planning, Apply, Design, or public-guide behavior.
- Implementation complexity: low artifact churn.
- Reversibility: easy.
- Client surfaces: CLI users, agent workflows, public guide.
- API / contract shape: unchanged.
- Frontend/backend boundary: blurred.
- Data / schema impact: none.
- Auth / security impact: Git and filesystem boundaries remain hidden inside the umbrella.
- Testability: evidence rows become broad and difficult to falsify.
- Operational risk: high documentation drift.
- Fit with project conventions: poor; violates capability-sized durable Story guidance.

### Option 2: Add S6 Workflow Execution And S7 Public Reference

- Summary: keep S1/S5 focused, add one Story for the developer delivery loop and one for the public reader experience.
- User impact: predictable navigation from outcome to owning skills/site behavior.
- Implementation complexity: moderate Epic reconciliation.
- Reversibility: Story wording can evolve without moving implementation.
- Client surfaces: CLI/agent users and public-guide readers remain distinct.
- API / contract shape: no new API.
- Frontend/backend boundary: package workflow and presentation responsibilities stay explicit.
- Data / schema impact: none.
- Auth / security impact: Git and filesystem safety remain mapped to narrow Requirements.
- Testability: package contract tests and rendered browser proof can map to specific Scenarios.
- Operational risk: manageable.
- Fit with project conventions: strong.

### Option 3: Create A Separate Documentation Epic

- Summary: move the public guide into its own Epic.
- User impact: clear UI ownership but fragments one small package capability across Epics.
- Implementation complexity: highest.
- Reversibility: possible but noisy.
- Client surfaces: public guide only.
- API / contract shape: unchanged.
- Frontend/backend boundary: explicit.
- Data / schema impact: none.
- Auth / security impact: none.
- Testability: good.
- Operational risk: unnecessary artifact overhead.
- Fit with project conventions: premature for one maintained public surface.

## Selected Approach

Use Option 2. Treat the report validator/template pair as one shared contract with distinct S1 runtime and S5 workflow/template responsibilities. Add S6 and S7 to represent two genuinely different user paths. Keep trust-boundary remediation in the earlier Change, then let Apply reconcile the actual Epic maps and evidence from current source.

Implementation should first establish the missing report/Git falsification tests, then reconcile workflow and site ownership from the behavior that already exists. The phase order remains adaptive; this is a restart point, not a rigid file sequence.

## Experience Design

- Applicability: required for S7.
- Confirmed direction: preserve the current Steel documentation treatment and information architecture; fix only behavior, accessibility, and truth drift found by Apply/review.
- User confirmation: direction previously confirmed; exact final candidate remains `pending user`.
- Reference artifacts: `site/index.html`, `site/styles.css`, `site/site.js`, `../shared/visual-style-guide.md`.

### User Flow And Information Architecture

Readers move from the context-loss problem, through the portable behavior/evidence model and example Epic, into this package's artifacts, CLI, skills, and lifecycle. Navigation exposes the current section without replacing document semantics.

### Responsive Composition

Desktop uses a persistent table of contents and bounded reading column. Tablet/mobile collapse navigation while retaining direct access to methodology and implementation halves. Long tables/examples scroll inside their own containers rather than the page.

### Component And State Contract

#### Component Strategy

| Component Or Pattern | Strategy | Initial Owner Or Reference | Required Preview States | Follow-Up |
|---|---|---|---|---|
| Documentation shell and section navigation | application-specific | `site/index.html`, `site/styles.css`, `site/site.js` | desktop, tablet, mobile, active section, long content | preserve Steel tokens and direct document semantics |
| Copy command control | application-specific | `site/site.js` | idle, copied, clipboard failure/selected, keyboard focus | add deterministic interaction proof where practical |
| Epic/evidence example | application-specific rendered document | `site/index.html` | desktop/mobile, long table, keyboard scroll | keep canonical SDD IDs and readable containment |

### Accessibility And Interaction

Preserve sequential headings, skip-link behavior, visible focus, minimum touch targets, canonical labels, announced copy feedback, reduced motion, contrast, and keyboard-scrollable overflow regions.

### Visual Direction

Use the established Steel semantic identity: dark documentation shell, restrained rules and spacing, limited contained surfaces, no SaaS card pile, no decorative shadows, and balanced readable headings.

### Open Design Questions

- None.

## Client And API Boundary

- Current clients: CLI users, agent runtimes consuming packaged skills, and browser readers of the static guide.
- Plausible future clients: other agent runtimes and a Dashboard/plugin UI consuming the same deterministic CLI contracts.
- Reusable product capabilities: structural validation, immutable audit records, workflow guidance, machine-readable CLI results, and public methodology reference.
- API or typed contract: CLI JSON and Markdown/schema contracts; no new HTTP API.
- OpenAPI plan, if HTTP-facing: not applicable.
- Backend platform exposed directly to clients?: not applicable.
- Client-specific presentation or local state: static-guide navigation/copy feedback only.
- Rationale: durable behavior remains in package contracts while the site presents it without becoming a second implementation truth.

## Alternatives Considered

- Keyword scanning legacy reports: rejected because historical prose creates false positives.
- Automatic Git-baseline inference: deferred because it would couple validation to branch policy and topology.
- One Story per skill: rejected because files are implementation surfaces, not durable user outcomes.

## Why This Approach

It follows the north star directly: a future developer can start from S1 for validator behavior, S5 for audit/publication behavior, S6 for the delivery workflow, and S7 for the public guide. The split is small enough to remain usable and precise enough that implementation/evidence maps do not become undifferentiated file lists.

## ADRs

- Required: no.
- ADR path: not applicable.
- Decision summary: Story ownership is artifact reconciliation within the existing package architecture.
- Reconsider when: workflow behavior becomes a separately versioned package or the public guide becomes an independent application.

## Implementation Constraints

- Do not edit installed skills directly; change package source and refresh through `sdd update`.
- Keep template/asset pairs byte-identical where the package defines mirrors.
- Treat Git refs and paths as untrusted input; use option barriers, immutable resolution, timeouts, and physical containment.
- Preserve unrelated dirty `CHANGELOG.md` and site work when commits cannot isolate it safely.
- Do not duplicate S2/S3 implementation work across the two active Changes.

## Verification Strategy

- Focused automated tests:
  - Template-derived aligned report, missing schema, wrong-Epic proof, self/non-versioned lineage, safe/unsafe Git baseline, and subprocess timeout.
  - Package contract tests for S5/S6 Requirements using exact named anchors.
  - Static DOM/fragment/ID checks and deterministic interaction coverage where practical for S7.
- Broad supporting gates:
  - `npm run check`, `npm audit --omit=dev --json`, `npm pack --dry-run --json`, all changed-skill validators, template parity, `git diff --check`, `sdd doctor`, and scoped SDD validation.
- Deterministic E2E:
  - Current one-pager rendered at representative desktop, tablet, mobile, and mobile-landscape viewports; keyboard, copy, overflow, reduced-motion, console, and network states exercised.
- Live-provider or external-service playtests: not applicable.
- Manual UI confirmation: `pending user` for the exact final Steel candidate.
- Debug/log inspection: inspect exact structured findings and subprocess failure/timeout results for negative CLI cases.

## Decisions

- Keep S1 and S5 stable; add S6 and S7.
- Route S2/S3 remediation through the earlier active Change.
- Require the aggregate package gate because the cumulative scope crosses CLI, security, workflow contracts, and UI.
- Require a prospective `develop -> main` integration-tree check before release because `main` is the production target.

## Risks / Trade-Offs

- Two active Changes share one cumulative candidate; both ledgers must name the same final source watermark while preserving single ownership for each finding.
- Package-string tests can pass while actual workflow semantics drift; Apply/Review must inspect the exact named behavior and template parity.
- Static site behavior can look correct at one viewport; the Visual Verification Matrix is required.
- Updating Epic ownership from already-shipped code can accidentally overstate verification; S6/S7 must begin partial/unverified where exact proof is missing.
